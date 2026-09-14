import assert from "node:assert/strict";
import { test } from "node:test";

import {
  availableTransportSwitchSelections,
  createTransportSwitchState,
  qualifyTransportSwitchContract,
  transitionTransportSwitch,
  transportSwitchCaptureDecision,
  type SwitchEpochAssessment,
  type TransportSwitchContract,
  type TransportSwitchEffect,
  type TransportSwitchEvent,
  type TransportSwitchPhase,
  type TransportSwitchSelection,
  type TransportSwitchState,
} from "./transportSwitchController";

// Synthetic evidence exercises the contract only; it does not qualify any manufacturer's hardware.
function contract(): TransportSwitchContract {
  const sources = (source: string | null) => [{ groupId: "corrections", sourceId: source }, { groupId: "commands", sourceId: null }];
  return {
    status: "qualified", id: "synthetic-contract", ownershipScopeId: "synthetic-fixture", receiverProfileId: "synthetic-profile",
    identities: { receiver: "synthetic-receiver", receiverFirmware: "test-1", evaluationBoard: "synthetic-board",
      evaluationBoardRevision: "test-1", relayBoard: "synthetic-relay", routeController: "synthetic-controller", routeControllerFirmware: "test-1" },
    review: { reviewerId: "test-reviewer", evidenceReferences: ["synthetic:electrical-review", "synthetic:timing-review"],
      levelAndPowerReviewed: true, exclusiveGroupsReviewed: true, safeDefaultsReviewed: true, timingReviewed: true },
    control: { channelId: "independent-control", independentOfGnss: true, survivesRouteChanges: true,
      authenticatedCommands: true, idempotentRequests: true, stateQuery: true, safeOnPowerLossAndRestart: true,
      safeOnWatchdogAndControlLoss: true, confirmationKind: "contact_feedback" },
    exclusiveSourceGroups: [{ id: "corrections", sourceIds: ["source-usb", "source-bluetooth", "source-wifi"] },
      { id: "commands", sourceIds: ["source-command"] }],
    allOpenRoute: { id: "all-open", sources: sources(null) },
    safeDefaultRoute: { id: "all-open", sources: sources(null) },
    routes: [
      { selection: "usb", transportKind: "android_usb", gnssChannelId: "usb-data", route: { id: "usb-route", sources: sources("source-usb") } },
      { selection: "bluetooth", transportKind: "android_spp", gnssChannelId: "bluetooth-data", route: { id: "bluetooth-route", sources: sources("source-bluetooth") } },
      { selection: "local_wifi", transportKind: "local_tcp", gnssChannelId: "wifi-data", route: { id: "wifi-route", sources: sources("source-wifi") } },
    ],
    timing: { operationTimeoutMs: 100, breakBeforeMakeMs: 10, settleMs: 20, waitTimeoutMs: 80,
      freshDataTimeoutMs: 100, maxObservationAgeMs: 50 },
  };
}

type EventWithoutTime = TransportSwitchEvent extends infer T ? T extends TransportSwitchEvent ? Omit<T, "nowMonotonicMs"> : never : never;

class Fixture {
  now = 0;
  state: TransportSwitchState;
  effects: readonly TransportSwitchEffect[] = [];
  history: TransportSwitchEffect[] = [];
  openSessions = new Set<string>();
  correctionsStopped = false;
  activeSources: readonly (string | null)[] = [];
  safeConfirmedAt: number | null = null;
  lastCommand: TransportSwitchEffect | null = null;

  constructor(readonly hardware = contract(), runId = "run-1") {
    this.state = createTransportSwitchState({ runId, controlSessionId: "control-session-1", nowMonotonicMs: 0,
      contract: hardware, observedIdentities: hardware.identities });
  }

  send(event: EventWithoutTime) {
    const previous = this.state;
    const transition = transitionTransportSwitch(this.state, { ...event, nowMonotonicMs: this.now } as TransportSwitchEvent);
    this.state = transition.state;
    this.effects = transition.effects;
    this.history.push(...this.effects);
    for (const effect of this.effects) {
      if (["drain_corrections", "close_gnss", "set_route", "open_gnss", "quarantine"].includes(effect.type)) {
        assert.equal(transportSwitchCaptureDecision(this.state, this.now).accepted, false);
        this.lastCommand = effect;
      }
      if (effect.type === "drain_corrections") this.correctionsStopped = true;
      if (effect.type === "close_gnss") assert.equal(this.correctionsStopped, true);
      if (effect.type === "set_route") {
        assert.equal(this.openSessions.size, 0, "routing cannot occur before old session cleanup");
        assert.equal(this.correctionsStopped, true);
        assert.equal(new Set(effect.route.sources.map((binding) => binding.groupId)).size, this.hardware.exclusiveSourceGroups.length);
        if (effect.route.id !== this.hardware.allOpenRoute.id) {
          assert.ok(this.activeSources.every((source) => source === null), "target selection must follow all-open");
          assert.notEqual(this.safeConfirmedAt, null);
          assert.ok(this.now - this.safeConfirmedAt! >= this.hardware.timing.breakBeforeMakeMs);
        }
        this.activeSources = effect.route.sources.map((binding) => binding.sourceId);
      }
      if (effect.type === "open_gnss") {
        assert.equal(this.openSessions.size, 0, "at most one GNSS session may be open");
        assert.equal(previous.phase, "settling");
        assert.ok(this.now >= previous.notBeforeMonotonicMs!);
        this.openSessions.add(effect.correlation.sessionId);
      }
    }
    return transition;
  }

  request(selection: TransportSwitchSelection = "usb", requestId = "request-1") {
    return this.send({ type: "request", requestId, selection });
  }

  ack() {
    const pending = this.state.pending;
    assert.ok(pending);
    const correlation = pending.correlation;
    switch (pending.operation) {
      case "drain": return this.send({ type: "drained", correlation, writesStopped: true, drained: true });
      case "close":
        this.openSessions.clear();
        return this.send({ type: "closed", correlation, closed: true, priorOperationsFenced: true });
      case "safe_route":
      case "target_route": {
        const effect = this.lastCommand;
        assert.equal(effect?.type, "set_route");
        if (pending.operation === "safe_route") this.safeConfirmedAt = this.now;
        return this.send({ type: "route_confirmed", correlation, routeId: effect.route.id, sources: effect.route.sources,
          kind: effect.confirmationKind, evidenceId: `synthetic-evidence:${correlation.operationId}` });
      }
      case "open": return this.send({ type: "opened", correlation, sessionId: correlation.sessionId,
        bufferedInputDiscarded: true, newReceiverSessionStarted: true });
    }
  }

  wait() {
    assert.notEqual(this.state.notBeforeMonotonicMs, null);
    this.now = this.state.notBeforeMonotonicMs!;
    return this.send({ type: "tick" });
  }

  to(phase: TransportSwitchPhase) {
    for (let step = 0; step < 12 && this.state.phase !== phase; step += 1) {
      if (this.state.phase === "idle") this.request();
      else if (this.state.pending) this.ack();
      else if (this.state.notBeforeMonotonicMs !== null) this.wait();
      else assert.fail(`Cannot advance ${this.state.phase} to ${phase}`);
    }
    assert.equal(this.state.phase, phase);
    return this;
  }

  epoch(overrides: Partial<SwitchEpochAssessment> = {}) {
    this.now += 1;
    return this.send({ type: "epoch", observation: {
      sessionId: this.state.transaction!.sessionId, receiverProfileId: this.hardware.receiverProfileId,
      epochId: `epoch-${this.now}`, receiverEpochMs: 1_000_000 + this.now, firstReceivedMonotonicMs: this.now,
      coherent: true, qualityAccepted: true, referenceFrameConfirmed: true, heightReferenceConfirmed: true, ...overrides,
    } });
  }

  ready() {
    this.to("awaiting_data");
    this.epoch();
    assert.equal(this.state.phase, "ready");
    assert.equal(transportSwitchCaptureDecision(this.state, this.now).accepted, true);
    return this;
  }
}

function assertBlocked(fixture: Fixture, pattern?: RegExp) {
  assert.equal(fixture.state.phase, "blocked");
  assert.equal(fixture.state.observation, null);
  assert.equal(transportSwitchCaptureDecision(fixture.state, fixture.now).accepted, false);
  assert.deepEqual(availableTransportSwitchSelections(fixture.state), []);
  assert.ok(fixture.effects.every((effect) => effect.type === "invalidate_capture" || effect.type === "quarantine"));
  if (pattern) assert.match(fixture.state.reason, pattern);
}

test("qualification is mandatory, matches observed identities, and exposes only qualified selections", () => {
  const fixture = new Fixture();
  assert.deepEqual(availableTransportSwitchSelections(fixture.state), ["usb", "bluetooth", "local_wifi"]);
  const partial = { ...contract(), routes: contract().routes.slice(0, 1) };
  assert.deepEqual(availableTransportSwitchSelections(new Fixture(partial).state), ["usb"]);
  for (const missing of [undefined, null, {}, { ...contract(), status: "proposed" }]) {
    const state = createTransportSwitchState({ runId: "new-run", controlSessionId: "control", nowMonotonicMs: 0,
      contract: missing, observedIdentities: contract().identities });
    assert.equal(state.phase, "blocked");
    assert.deepEqual(availableTransportSwitchSelections(state), []);
    assert.deepEqual(transitionTransportSwitch(state, { type: "request", selection: "usb", requestId: "request", nowMonotonicMs: 0 }).effects, []);
  }
  for (const key of Object.keys(contract().identities)) {
    const state = createTransportSwitchState({ runId: "new-run", controlSessionId: "control", nowMonotonicMs: 0,
      contract: contract(), observedIdentities: { ...contract().identities, [key]: "different" } });
    assert.equal(state.phase, "blocked", key);
  }
});

test("contract rejects missing reviews, control independence, ambiguous groups/routes and invalid timing", () => {
  const base = contract();
  const invalid: unknown[] = [
    { ...base, id: "unknown" }, { ...base, ownershipScopeId: "" }, { ...base, receiverProfileId: "" },
    { ...base, identities: null }, { ...base, review: null }, { ...base, control: null }, { ...base, timing: null },
    { ...base, review: { ...base.review, reviewerId: "" } }, { ...base, review: { ...base.review, evidenceReferences: [] } },
    { ...base, review: { ...base.review, evidenceReferences: Array(1) } },
    { ...base, exclusiveSourceGroups: [] }, { ...base, exclusiveSourceGroups: [null] },
    { ...base, exclusiveSourceGroups: Array(1) },
    { ...base, exclusiveSourceGroups: [{ id: "corrections", sourceIds: Array(1) }] },
    { ...base, exclusiveSourceGroups: [base.exclusiveSourceGroups[0], base.exclusiveSourceGroups[0]] },
    { ...base, exclusiveSourceGroups: [{ id: "corrections", sourceIds: ["same", "same"] }] },
    { ...base, allOpenRoute: base.routes[0].route }, { ...base, allOpenRoute: null }, { ...base, safeDefaultRoute: null },
    { ...base, allOpenRoute: { id: "all-open", sources: Array(2) } },
    { ...base, safeDefaultRoute: { id: "all-open", sources: base.routes[0].route.sources } },
    { ...base, routes: [] }, { ...base, routes: [null] }, { ...base, routes: [base.routes[0], base.routes[0]] },
    { ...base, routes: Array(1) },
    { ...base, routes: [{ ...base.routes[0], selection: "satellite" }] },
    { ...base, routes: [{ ...base.routes[0], transportKind: "replay" }] },
    { ...base, routes: [{ ...base.routes[0], gnssChannelId: base.control.channelId }] },
    { ...base, routes: [{ ...base.routes[0], route: base.allOpenRoute }] },
    { ...base, routes: [{ ...base.routes[0], route: { id: "bad", sources: [{ groupId: "corrections", sourceId: "missing-source" }] } }] },
    { ...base, routes: [{ ...base.routes[0], route: { id: "bad", sources: [base.routes[0].route.sources[0], base.routes[0].route.sources[0]] } }] },
    { ...base, control: { ...base.control, confirmationKind: "assumed" } },
    { ...base, timing: { ...base.timing, waitTimeoutMs: base.timing.settleMs } },
  ];
  for (const key of ["levelAndPowerReviewed", "exclusiveGroupsReviewed", "safeDefaultsReviewed", "timingReviewed"]) {
    invalid.push({ ...base, review: { ...base.review, [key]: false } });
  }
  for (const key of ["independentOfGnss", "survivesRouteChanges", "authenticatedCommands", "idempotentRequests", "stateQuery", "safeOnPowerLossAndRestart", "safeOnWatchdogAndControlLoss"]) {
    invalid.push({ ...base, control: { ...base.control, [key]: false } });
  }
  for (const key of Object.keys(base.timing)) for (const value of [0, -1, NaN, Infinity, "10", Number.MAX_VALUE]) {
    invalid.push({ ...base, timing: { ...base.timing, [key]: value } });
  }
  for (const value of invalid) {
    const result = qualifyTransportSwitchContract(value);
    assert.equal(result.contract, null, JSON.stringify(value));
    assert.ok(result.reasons.length > 0);
  }
});

test("each selection follows drain, close, safe confirmation, break, target confirmation, settle, open, fresh data", () => {
  for (const selection of ["usb", "bluetooth", "local_wifi"] as const) {
    const fixture = new Fixture();
    fixture.request(selection);
    assert.equal(fixture.effects[0].type, "invalidate_capture");
    const expected: TransportSwitchPhase[] = ["draining", "closing", "confirming_safe", "breaking", "confirming_target", "settling", "opening", "awaiting_data"];
    for (const phase of expected) {
      fixture.to(phase);
      assert.equal(transportSwitchCaptureDecision(fixture.state, fixture.now).accepted, false, phase);
    }
    fixture.epoch();
    assert.equal(transportSwitchCaptureDecision(fixture.state, fixture.now).accepted, true);
    assert.equal(fixture.state.transaction?.selection, selection);
    assert.deepEqual(fixture.history.filter((effect) => !["schedule_tick", "invalidate_capture"].includes(effect.type)).map((effect) => effect.type),
      ["drain_corrections", "close_gnss", "set_route", "set_route", "open_gnss"]);
    assert.equal(fixture.state.routingEvidence?.kind, "contact_feedback");
  }
});

test("switch revokes capture synchronously, retains old ownership through drain and close, and creates a new session", () => {
  const fixture = new Fixture().ready();
  const oldSession = fixture.state.transaction!.sessionId;
  const oldEpoch = fixture.state.observation!;
  fixture.request("local_wifi", "request-2");
  assert.equal(fixture.state.observation, null);
  assert.equal(fixture.effects[0].type, "invalidate_capture");
  assert.deepEqual(fixture.state.ownedSessionIds, [oldSession]);
  fixture.ack();
  assert.deepEqual(fixture.state.ownedSessionIds, [oldSession]);
  fixture.ack();
  assert.deepEqual(fixture.state.ownedSessionIds, []);
  fixture.to("awaiting_data");
  assert.notEqual(fixture.state.transaction!.sessionId, oldSession);
  fixture.send({ type: "epoch", observation: oldEpoch });
  assertBlocked(fixture, /Old/);
});

test("repeated successful switches never overlap drivers or reuse receiver sessions", () => {
  const fixture = new Fixture().ready();
  const sessions = new Set([fixture.state.transaction!.sessionId]);
  for (const [index, selection] of (["bluetooth", "local_wifi", "usb", "usb"] as const).entries()) {
    const previous = fixture.state;
    fixture.request(selection, `request-${index + 2}`);
    assert.equal(transportSwitchCaptureDecision(fixture.state, fixture.now).accepted, false);
    assert.equal(previous.phase, "ready");
    fixture.to("awaiting_data");
    fixture.epoch();
    assert.equal(fixture.state.phase, "ready");
    const sessionId = fixture.state.transaction!.sessionId;
    assert.equal(sessions.has(sessionId), false);
    sessions.add(sessionId);
    assert.deepEqual([...fixture.openSessions], [sessionId]);
  }
});

test("firmware acknowledgements stay firmware evidence and never satisfy a contact-feedback contract", () => {
  const base = contract();
  const firmware = new Fixture({ ...base, control: { ...base.control, confirmationKind: "firmware_ack" } }).ready();
  assert.equal(firmware.state.routingEvidence?.kind, "firmware_ack");
  const contacts = new Fixture().to("confirming_safe");
  contacts.send({ type: "route_confirmed", correlation: contacts.state.pending!.correlation, routeId: base.allOpenRoute.id,
    sources: base.allOpenRoute.sources, kind: "firmware_ack", evidenceId: "firmware-only" });
  assertBlocked(contacts, /evidence kind/);
});

test("safe and target route confirmations must match their entire exclusive-source configuration", () => {
  for (const phase of ["confirming_safe", "confirming_target"] as const) for (const corrupt of ["route", "sources", "evidence"] as const) {
    const fixture = new Fixture().to(phase);
    const effect = fixture.lastCommand;
    assert.equal(effect?.type, "set_route");
    fixture.send({ type: "route_confirmed", correlation: fixture.state.pending!.correlation,
      routeId: corrupt === "route" ? "other-route" : effect.route.id,
      sources: corrupt === "sources" ? [{ groupId: "corrections", sourceId: "source-usb" }] : effect.route.sources,
      kind: "contact_feedback", evidenceId: corrupt === "evidence" ? "" : "synthetic-evidence" });
    assertBlocked(fixture);
  }
});

test("each acknowledgement rejects stale run, control-session, request, receiver-session or operation correlation", () => {
  for (const phase of ["draining", "closing", "confirming_safe", "confirming_target", "opening"] as const) {
    for (const key of ["runId", "controlSessionId", "requestId", "sessionId", "operationId"] as const) {
      const fixture = new Fixture().to(phase);
      fixture.send({ type: "failed", correlation: { ...fixture.state.pending!.correlation, [key]: "stale" }, reason: "test" });
      assertBlocked(fixture, /stale acknowledgement/);
    }
  }
  const wrongStage = new Fixture().to("draining");
  wrongStage.send({ type: "closed", correlation: wrongStage.state.pending!.correlation, closed: true, priorOperationsFenced: true });
  assertBlocked(wrongStage, /wrong operation/);
});

test("duplicates cannot repeat route commands or advance a later stage", () => {
  const fixture = new Fixture().to("draining");
  const correlation = fixture.state.pending!.correlation;
  fixture.ack();
  fixture.send({ type: "drained", correlation, writesStopped: true, drained: true });
  assertBlocked(fixture);
  assert.equal(fixture.history.filter((effect) => effect.type === "close_gnss").length, 1);
  assert.equal(fixture.history.filter((effect) => effect.type === "set_route").length, 0);
});

test("concurrent requests fail closed at every in-flight stage and never start a second operation", () => {
  for (const phase of ["draining", "closing", "confirming_safe", "breaking", "confirming_target", "settling", "opening", "awaiting_data"] as const) {
    const fixture = new Fixture().to(phase);
    const pending = fixture.state.pending;
    fixture.request("bluetooth", "competing-request");
    assertBlocked(fixture, /Concurrent/);
    assert.deepEqual(fixture.state.pending, pending);
    assert.equal(fixture.state.requestIds.length, 1);
  }
});

test("reused requests and unavailable or malformed selections revoke an already-ready capture", () => {
  const reused = new Fixture().ready();
  reused.request("usb", "request-1");
  assertBlocked(reused, /Reused/);
  const partial = new Fixture({ ...contract(), routes: contract().routes.slice(0, 1) }).ready();
  partial.request("bluetooth", "request-2");
  assertBlocked(partial, /qualified hardware/);
  const invalid = new Fixture().ready();
  invalid.request("invalid" as TransportSwitchSelection, "request-2");
  assertBlocked(invalid, /Malformed/);
});

test("drain and cleanup uncertainty retain ownership and veto all route/open effects", () => {
  for (const failure of ["writes", "drain", "close", "fence"]) {
    const fixture = new Fixture().ready();
    const sessionId = fixture.state.transaction!.sessionId;
    fixture.request("bluetooth", "request-2");
    if (failure === "close" || failure === "fence") fixture.ack();
    const correlation = fixture.state.pending!.correlation;
    fixture.send(failure === "writes" || failure === "drain"
      ? { type: "drained", correlation, writesStopped: failure !== "writes", drained: failure !== "drain" }
      : { type: "closed", correlation, closed: failure !== "close", priorOperationsFenced: failure !== "fence" });
    assertBlocked(fixture);
    assert.deepEqual(fixture.state.ownedSessionIds, [sessionId]);
    assert.equal(fixture.effects[1].type, "quarantine");
    const blocked = fixture.state;
    fixture.send({ type: "closed", correlation, closed: true, priorOperationsFenced: true });
    assert.equal(fixture.state, blocked);
    assert.deepEqual(fixture.effects, []);
    fixture.request("local_wifi", "cannot-recover-implicitly");
    assert.equal(fixture.state, blocked);
  }
});

test("adapter failure in every operation quarantines pending ownership, including an unacknowledged open", () => {
  for (const phase of ["draining", "closing", "confirming_safe", "confirming_target", "opening"] as const) {
    const fixture = new Fixture().to(phase);
    const pending = fixture.state.pending!;
    fixture.send({ type: "failed", correlation: pending.correlation, reason: "adapter rejected operation" });
    assertBlocked(fixture, /Adapter failure/);
    assert.deepEqual(fixture.state.pending, pending);
    if (phase === "opening") assert.deepEqual(fixture.state.ownedSessionIds, [pending.correlation.sessionId]);
  }
});

test("all asynchronous stages have deadlines, including late acknowledgements without timer delivery", () => {
  for (const phase of ["draining", "closing", "confirming_safe", "breaking", "confirming_target", "settling", "opening", "awaiting_data"] as const) {
    const fixture = new Fixture().to(phase);
    fixture.now = fixture.state.deadlineMonotonicMs!;
    fixture.send({ type: "tick" });
    assertBlocked(fixture, /Timed out/);
  }
  const late = new Fixture().to("closing");
  late.now = late.state.deadlineMonotonicMs!;
  late.send({ type: "closed", correlation: late.state.pending!.correlation, closed: true, priorOperationsFenced: true });
  assertBlocked(late, /Timed out/);
});

test("early ticks cannot shorten break-before-make or settling", () => {
  for (const phase of ["breaking", "settling"] as const) {
    const fixture = new Fixture().to(phase);
    assert.deepEqual(fixture.effects, [
      { type: "schedule_tick", atMonotonicMs: fixture.state.notBeforeMonotonicMs },
      { type: "schedule_tick", atMonotonicMs: fixture.state.deadlineMonotonicMs },
    ]);
    fixture.now = fixture.state.notBeforeMonotonicMs! - 1;
    fixture.send({ type: "tick" });
    assert.equal(fixture.state.phase, phase);
    assert.deepEqual(fixture.effects, []);
    fixture.wait();
    assert.equal(fixture.state.phase, phase === "breaking" ? "confirming_target" : "opening");
  }
});

test("restart and either-channel disconnect latch every phase closed and cannot adopt a previous ready state", () => {
  for (const phase of ["idle", "draining", "closing", "confirming_safe", "breaking", "confirming_target", "settling", "opening", "awaiting_data", "ready"] as const) {
    for (const kind of ["restart", "control", "gnss"] as const) {
      const fixture = phase === "ready" ? new Fixture().ready() : new Fixture().to(phase);
      fixture.send(kind === "restart" ? { type: "restart" } : { type: "disconnect", channel: kind,
        sessionId: kind === "control" ? fixture.state.controlSessionId : fixture.state.transaction?.sessionId ?? "unknown-session" });
      assertBlocked(fixture);
    }
  }
  const freshRun = new Fixture(contract(), "run-2");
  assert.equal(transportSwitchCaptureDecision(freshRun.state, 0).accepted, false);
  freshRun.request();
  assert.equal(freshRun.effects[1].type, "drain_corrections");
  assert.equal(freshRun.state.transaction?.sessionId, "run-2/session/1");
});

test("malformed, negative, infinite and regressing clocks fail closed, including capture-time checks", () => {
  for (const value of [NaN, Infinity, -1, "1", null, Number.MAX_VALUE]) {
    const fixture = new Fixture().ready();
    assert.equal(transportSwitchCaptureDecision(fixture.state, value as number).accepted, false);
    fixture.now = value as number;
    fixture.send({ type: "tick" });
    assertBlocked(fixture, /monotonic/);
  }
  const regressing = new Fixture().ready();
  regressing.now -= 1;
  regressing.send({ type: "tick" });
  assertBlocked(regressing, /regressing/);
  for (const nowMonotonicMs of [NaN, Infinity, -1]) {
    assert.equal(createTransportSwitchState({ runId: "run", controlSessionId: "control", nowMonotonicMs,
      contract: contract(), observedIdentities: contract().identities }).phase, "blocked");
  }
  const overflow = new Fixture();
  overflow.now = Number.MAX_SAFE_INTEGER;
  overflow.request();
  assertBlocked(overflow, /representable/);
});

test("clock precision cannot collapse operation, break, settle, fresh-data or observation bounds", () => {
  const base = contract();
  const tinyOperation = new Fixture({ ...base, timing: { ...base.timing, operationTimeoutMs: Number.MIN_VALUE } });
  tinyOperation.now = 1;
  tinyOperation.request();
  assertBlocked(tinyOperation, /representable/);

  for (const field of ["breakBeforeMakeMs", "settleMs", "freshDataTimeoutMs"] as const) {
    const fixture = new Fixture({ ...base, timing: { ...base.timing, [field]: Number.MIN_VALUE } });
    fixture.now = 1;
    fixture.to(field === "breakBeforeMakeMs" ? "confirming_safe" : field === "settleMs" ? "confirming_target" : "opening");
    fixture.ack();
    assertBlocked(fixture, /representable/);
  }

  const collapsedWait = new Fixture({ ...base, timing: { ...base.timing, breakBeforeMakeMs: 1, settleMs: 1, waitTimeoutMs: 1.25 } });
  collapsedWait.now = 2 ** 52;
  collapsedWait.to("confirming_safe");
  collapsedWait.ack();
  assertBlocked(collapsedWait, /representable/);

  const roundedEarly = new Fixture({ ...base, timing: { ...base.timing, breakBeforeMakeMs: 10.25 } });
  roundedEarly.now = 2 ** 52;
  roundedEarly.to("confirming_safe");
  roundedEarly.ack();
  assertBlocked(roundedEarly, /representable/);

  const tinyExpiry = new Fixture({ ...base, timing: { ...base.timing, maxObservationAgeMs: Number.MIN_VALUE } }).to("awaiting_data");
  tinyExpiry.epoch();
  assertBlocked(tinyExpiry, /representable/);
});

test("open requires new receiver-session identity and explicit buffer discard", () => {
  for (const field of ["sessionId", "bufferedInputDiscarded", "newReceiverSessionStarted"] as const) {
    const fixture = new Fixture().to("opening");
    fixture.send({ type: "opened", correlation: fixture.state.pending!.correlation, sessionId: fixture.state.transaction!.sessionId,
      bufferedInputDiscarded: true, newReceiverSessionStarted: true, [field]: field === "sessionId" ? "old-session" : false } as EventWithoutTime);
    assertBlocked(fixture, /fresh receiver session/);
  }
});

test("fresh coherent quality, explicit frame/height and first-reception timing are all required", () => {
  const invalid: Partial<SwitchEpochAssessment>[] = [
    { sessionId: "old-session" }, { receiverProfileId: "other-profile" }, { epochId: "" },
    { coherent: false }, { qualityAccepted: false }, { referenceFrameConfirmed: false }, { heightReferenceConfirmed: false },
    { receiverEpochMs: NaN }, { receiverEpochMs: Infinity }, { receiverEpochMs: -1 },
    { firstReceivedMonotonicMs: NaN }, { firstReceivedMonotonicMs: -1 }, { firstReceivedMonotonicMs: Infinity },
    { firstReceivedMonotonicMs: 0 }, { firstReceivedMonotonicMs: 1_000 },
  ];
  for (const override of invalid) {
    const fixture = new Fixture().to("awaiting_data");
    fixture.epoch(override);
    assertBlocked(fixture, /epoch/);
  }
  const equalStart = new Fixture().to("awaiting_data");
  equalStart.epoch({ firstReceivedMonotonicMs: equalStart.state.receiverSessionStartedMonotonicMs! });
  assertBlocked(equalStart);
  const expired = new Fixture().to("awaiting_data");
  const firstReceivedMonotonicMs = expired.now + 1;
  expired.now += expired.hardware.timing.maxObservationAgeMs;
  expired.epoch({ firstReceivedMonotonicMs });
  assertBlocked(expired);
});

test("repeated or regressing receiver epochs cannot refresh capture, even when relabelled with the new session", () => {
  for (const offset of [0, -1]) {
    const fixture = new Fixture().ready();
    fixture.epoch({ receiverEpochMs: fixture.state.lastReceiverEpochMs! + offset });
    assertBlocked(fixture);
  }
  const relabelled = new Fixture().ready();
  const oldEpochMs = relabelled.state.lastReceiverEpochMs!;
  relabelled.request("bluetooth", "request-2");
  relabelled.to("awaiting_data");
  relabelled.epoch({ receiverEpochMs: oldEpochMs });
  assertBlocked(relabelled);
});

test("capture expires without timer delivery and an expired scheduled tick cannot restore it", () => {
  const fixture = new Fixture().ready();
  const expiry = fixture.state.deadlineMonotonicMs!;
  assert.equal(transportSwitchCaptureDecision(fixture.state, expiry - 1).accepted, true);
  assert.equal(transportSwitchCaptureDecision(fixture.state, expiry).accepted, false);
  fixture.now = expiry;
  fixture.send({ type: "tick" });
  assertBlocked(fixture, /Timed out/);
});

test("new epochs advance freshness without an older scheduled tick expiring the new observation", () => {
  const fixture = new Fixture().ready();
  const oldExpiry = fixture.state.deadlineMonotonicMs!;
  fixture.now += 20;
  fixture.epoch();
  assert.equal(fixture.state.phase, "ready");
  assert.ok(fixture.state.deadlineMonotonicMs! > oldExpiry);
  fixture.now = oldExpiry;
  fixture.send({ type: "tick" });
  assert.equal(transportSwitchCaptureDecision(fixture.state, fixture.now).accepted, true);
});

test("malformed events are quarantined and effects never carry geometry or mutate caller data", () => {
  for (const event of [null, {}, { type: "unknown", nowMonotonicMs: 0 }, { type: "epoch", nowMonotonicMs: 0, observation: null }]) {
    const state = new Fixture().state;
    const transition = transitionTransportSwitch(state, event as TransportSwitchEvent);
    assert.equal(transition.state.phase, "blocked");
    assert.ok(transition.effects.every((effect) => effect.type === "invalidate_capture" || effect.type === "quarantine"));
  }
  const invalidIdentity = { unrelated: { mutable: true } };
  for (const field of ["runId", "controlSessionId"] as const) {
    const state = createTransportSwitchState({ runId: "run", controlSessionId: "control", nowMonotonicMs: 0,
      contract: contract(), observedIdentities: contract().identities, [field]: invalidIdentity as unknown as string });
    assert.equal(state.phase, "blocked");
    assert.equal(state[field], "");
    assert.equal(Object.isFrozen(invalidIdentity), false);
    assert.equal(Object.isFrozen(invalidIdentity.unrelated), false);
  }
  const hardware = contract();
  const geometry = { vertices: [{ x: 12, y: 34 }], capturedDraft: { sessionId: "old-session", epochId: "old-epoch" } };
  const geometryBefore = JSON.stringify(geometry);
  const callerContract = { ...hardware, unrelated: geometry };
  const fixture = new Fixture(callerContract);
  assert.equal(Object.isFrozen(callerContract), false);
  assert.equal(Object.isFrozen(geometry), false);
  (hardware.identities as { receiver: string }).receiver = "modified-after-qualification";
  assert.equal(fixture.state.contract!.identities.receiver, "synthetic-receiver");
  assert.equal("unrelated" in fixture.state.contract!, false);
  const previous = fixture.state;
  fixture.ready();
  assert.equal(previous.phase, "idle");
  assert.equal(previous.observation, null);
  assert.equal(Object.isFrozen(fixture.state), true);
  assert.equal(Object.isFrozen(fixture.state.contract!.routes[0].route.sources), true);
  assert.equal(JSON.stringify(geometry), geometryBefore);
  const permitted = new Set(["invalidate_capture", "schedule_tick", "drain_corrections", "close_gnss", "set_route", "open_gnss", "quarantine"]);
  assert.ok(fixture.history.every((effect) => permitted.has(effect.type)));
  assert.doesNotMatch(JSON.stringify(fixture.history), /vertices|projected|geometry|capturedDraft/);
});
