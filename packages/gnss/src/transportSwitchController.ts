import type { GnssTransportKind } from "@cplayout/core";

export type TransportSwitchSelection = "usb" | "bluetooth" | "local_wifi";
export type RoutingConfirmationKind = "firmware_ack" | "contact_feedback";

export interface TransportSwitchHardwareIdentities {
  receiver: string;
  receiverFirmware: string;
  evaluationBoard: string;
  evaluationBoardRevision: string;
  relayBoard: string;
  routeController: string;
  routeControllerFirmware: string;
}

export interface SourceBinding {
  readonly groupId: string;
  readonly sourceId: string | null;
}

export interface SwitchRoute {
  readonly id: string;
  readonly sources: readonly SourceBinding[];
}

export interface TransportSwitchContract {
  readonly status: "qualified";
  readonly id: string;
  readonly ownershipScopeId: string;
  readonly receiverProfileId: string;
  readonly identities: Readonly<TransportSwitchHardwareIdentities>;
  readonly review: {
    readonly reviewerId: string;
    readonly evidenceReferences: readonly string[];
    readonly levelAndPowerReviewed: true;
    readonly exclusiveGroupsReviewed: true;
    readonly safeDefaultsReviewed: true;
    readonly timingReviewed: true;
  };
  readonly control: {
    readonly channelId: string;
    readonly independentOfGnss: true;
    readonly survivesRouteChanges: true;
    readonly authenticatedCommands: true;
    readonly idempotentRequests: true;
    readonly stateQuery: true;
    readonly safeOnPowerLossAndRestart: true;
    readonly safeOnWatchdogAndControlLoss: true;
    readonly confirmationKind: RoutingConfirmationKind;
  };
  readonly exclusiveSourceGroups: readonly { readonly id: string; readonly sourceIds: readonly string[] }[];
  readonly allOpenRoute: SwitchRoute;
  readonly safeDefaultRoute: SwitchRoute;
  readonly routes: readonly {
    readonly selection: TransportSwitchSelection;
    readonly transportKind: GnssTransportKind;
    readonly gnssChannelId: string;
    readonly route: SwitchRoute;
  }[];
  readonly timing: {
    readonly operationTimeoutMs: number;
    readonly breakBeforeMakeMs: number;
    readonly settleMs: number;
    readonly waitTimeoutMs: number;
    readonly freshDataTimeoutMs: number;
    readonly maxObservationAgeMs: number;
  };
}

export interface SwitchCorrelation {
  readonly runId: string;
  readonly controlSessionId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly operationId: string;
}

// Upstream emits complete, distinct epochs and assesses quality, including vertical eligibility, frames and heights.
// A horizontal-only gate cannot supply these assessments; neither assessments nor this controller are field accuracy proof.
// firstReceivedMonotonicMs is stamped at receiver ingress, never refreshed when a queued epoch is dispatched.
export interface SwitchEpochAssessment {
  readonly sessionId: string;
  readonly receiverProfileId: string;
  readonly epochId: string;
  readonly receiverEpochMs: number;
  readonly firstReceivedMonotonicMs: number;
  readonly coherent: boolean;
  readonly qualityAccepted: boolean;
  readonly referenceFrameConfirmed: boolean;
  readonly heightReferenceConfirmed: boolean;
}

export type TransportSwitchEvent = { readonly nowMonotonicMs: number } & (
  | { readonly type: "request"; readonly requestId: string; readonly selection: TransportSwitchSelection }
  | { readonly type: "drained"; readonly correlation: SwitchCorrelation; readonly writesStopped: boolean; readonly drained: boolean }
  | { readonly type: "closed"; readonly correlation: SwitchCorrelation; readonly closed: boolean; readonly priorOperationsFenced: boolean }
  | { readonly type: "route_confirmed"; readonly correlation: SwitchCorrelation; readonly routeId: string;
      readonly sources: readonly SourceBinding[]; readonly kind: RoutingConfirmationKind; readonly evidenceId: string }
  | { readonly type: "opened"; readonly correlation: SwitchCorrelation; readonly sessionId: string;
      readonly bufferedInputDiscarded: boolean; readonly newReceiverSessionStarted: boolean }
  | { readonly type: "epoch"; readonly observation: SwitchEpochAssessment }
  | { readonly type: "failed"; readonly correlation: SwitchCorrelation; readonly reason: string }
  | { readonly type: "disconnect"; readonly channel: "control" | "gnss"; readonly sessionId: string }
  | { readonly type: "restart" }
  | { readonly type: "tick" }
);

type Operation = "drain" | "close" | "safe_route" | "target_route" | "open";
export type TransportSwitchPhase = "idle" | "draining" | "closing" | "confirming_safe"
  | "breaking" | "confirming_target" | "settling" | "opening" | "awaiting_data" | "ready" | "blocked";

export interface TransportSwitchState {
  readonly runId: string;
  readonly controlSessionId: string;
  readonly contract: TransportSwitchContract | null;
  readonly phase: TransportSwitchPhase;
  readonly reason: string;
  readonly lastNowMonotonicMs: number;
  readonly requestIds: readonly string[];
  readonly transaction: { readonly requestId: string; readonly sessionId: string; readonly selection: TransportSwitchSelection } | null;
  readonly pending: { readonly operation: Operation; readonly correlation: SwitchCorrelation } | null;
  readonly deadlineMonotonicMs: number | null;
  readonly notBeforeMonotonicMs: number | null;
  readonly ownedSessionIds: readonly string[];
  readonly receiverSessionStartedMonotonicMs: number | null;
  readonly lastReceiverEpochMs: number | null;
  readonly observation: SwitchEpochAssessment | null;
  readonly routingEvidence: { readonly routeId: string; readonly kind: RoutingConfirmationKind; readonly evidenceId: string } | null;
}

export type TransportSwitchEffect =
  | { readonly type: "invalidate_capture"; readonly reason: string }
  | { readonly type: "schedule_tick"; readonly atMonotonicMs: number }
  | { readonly type: "drain_corrections"; readonly correlation: SwitchCorrelation; readonly ownershipScopeId: string }
  | { readonly type: "close_gnss"; readonly correlation: SwitchCorrelation; readonly ownershipScopeId: string;
      readonly ownedSessionIds: readonly string[]; readonly fencePriorOperations: true }
  | { readonly type: "set_route"; readonly correlation: SwitchCorrelation; readonly controlChannelId: string;
      readonly route: SwitchRoute; readonly confirmationKind: RoutingConfirmationKind }
  | { readonly type: "open_gnss"; readonly correlation: SwitchCorrelation; readonly gnssChannelId: string;
      readonly selection: TransportSwitchSelection; readonly transportKind: GnssTransportKind;
      readonly receiverProfileId: string; readonly discardBufferedInput: true }
  // Quarantine must stop writes and fence/drain/close owned operations. It never authorizes routing or reopening.
  | { readonly type: "quarantine"; readonly ownershipScopeId: string; readonly ownedSessionIds: readonly string[];
      readonly pending: TransportSwitchState["pending"]; readonly reason: string };

export interface TransportSwitchTransition {
  readonly state: TransportSwitchState;
  readonly effects: readonly TransportSwitchEffect[];
}

const identityKeys = ["receiver", "receiverFirmware", "evaluationBoard", "evaluationBoardRevision", "relayBoard",
  "routeController", "routeControllerFirmware"] as const;
const reviewFlags = ["levelAndPowerReviewed", "exclusiveGroupsReviewed", "safeDefaultsReviewed", "timingReviewed"] as const;
const controlFlags = ["independentOfGnss", "survivesRouteChanges", "authenticatedCommands", "idempotentRequests", "stateQuery",
  "safeOnPowerLossAndRestart", "safeOnWatchdogAndControlLoss"] as const;
const timingKeys = ["operationTimeoutMs", "breakBeforeMakeMs", "settleMs", "waitTimeoutMs", "freshDataTimeoutMs", "maxObservationAgeMs"] as const;
const selections = ["usb", "bluetooth", "local_wifi"] as const;
const kinds: Record<TransportSwitchSelection, readonly GnssTransportKind[]> = {
  usb: ["web_serial", "android_usb"],
  bluetooth: ["android_ble", "android_spp", "ios_ble", "ios_mfi"],
  local_wifi: ["local_tcp"],
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0
    && !["unknown", "unverified", "pending", "todo", "tbd"].includes(value.toLowerCase());
}

function time(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function isSelection(value: unknown): value is TransportSwitchSelection {
  return selections.some((selection) => selection === value);
}

function uniqueStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && Array.from(value).every(identifier) && new Set(value).size === value.length;
}

function validBindings(value: unknown, groups: TransportSwitchContract["exclusiveSourceGroups"]): value is SourceBinding[] {
  return Array.isArray(value) && value.length === groups.length
    && Array.from(value).every((binding) => record(binding) && identifier(binding.groupId)
      && groups.some((group) => group.id === binding.groupId && (binding.sourceId === null || group.sourceIds.includes(binding.sourceId as string))))
    && new Set(value.map((binding) => binding.groupId)).size === groups.length;
}

function sameBindings(actual: unknown, expected: readonly SourceBinding[], contract: TransportSwitchContract): boolean {
  return validBindings(actual, contract.exclusiveSourceGroups)
    && expected.every((binding) => actual.some((item) => item.groupId === binding.groupId && item.sourceId === binding.sourceId));
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function copyRoute(route: SwitchRoute): SwitchRoute {
  return { id: route.id, sources: route.sources.map(({ groupId, sourceId }) => ({ groupId, sourceId })) };
}

/** Checks a supplied qualification record; it does not manufacture or independently verify hardware evidence. */
export function qualifyTransportSwitchContract(value: unknown): { contract: TransportSwitchContract | null; reasons: readonly string[] } {
  const reasons: string[] = [];
  if (!record(value)) return { contract: null, reasons: ["An explicitly qualified hardware contract is required."] };
  if (value.status !== "qualified" || !identifier(value.id) || !identifier(value.ownershipScopeId) || !identifier(value.receiverProfileId)) {
    reasons.push("Contract qualification, ownership scope and receiver profile identities are required.");
  }
  if (!record(value.identities) || !identityKeys.every((key) => identifier((value.identities as Record<string, unknown>)[key]))) {
    reasons.push("Exact receiver, board, relay and controller identities/revisions/firmware are required.");
  }
  if (!record(value.review) || !identifier(value.review.reviewerId) || !uniqueStrings(value.review.evidenceReferences)
    || !reviewFlags.every((key) => (value.review as Record<string, unknown>)[key] === true)) {
    reasons.push("Source-referenced level/power, exclusivity, safe-default and timing reviews are required.");
  }
  if (!record(value.control) || !identifier(value.control.channelId)
    || !controlFlags.every((key) => (value.control as Record<string, unknown>)[key] === true)
    || !["firmware_ack", "contact_feedback"].includes(value.control.confirmationKind as string)) {
    reasons.push("An independent, authenticated, recoverable control channel and explicit confirmation kind are required.");
  }
  const groups = value.exclusiveSourceGroups;
  if (!Array.isArray(groups) || groups.length === 0
    || !Array.from(groups).every((group) => record(group) && identifier(group.id) && uniqueStrings(group.sourceIds))
    || new Set(groups.map((group) => group.id)).size !== groups.length) {
    reasons.push("Explicit exclusive source groups with unique source identities are required.");
  }
  if (!record(value.timing) || !timingKeys.every((key) => time((value.timing as Record<string, unknown>)[key])
    && ((value.timing as Record<string, number>)[key] > 0))
    || !(value.timing.waitTimeoutMs as number > (value.timing.breakBeforeMakeMs as number))
    || !(value.timing.waitTimeoutMs as number > (value.timing.settleMs as number))) {
    reasons.push("Finite positive timing bounds must allow break-before-make and settling before timeout.");
  }
  if (reasons.length > 0) return { contract: null, reasons };
  const contract = value as unknown as TransportSwitchContract;
  const validRoute = (route: unknown): route is SwitchRoute => record(route) && identifier(route.id)
    && validBindings(route.sources, contract.exclusiveSourceGroups);
  if (!validRoute(contract.allOpenRoute) || !contract.allOpenRoute.sources.every((binding) => binding.sourceId === null)) {
    reasons.push("An explicit all-open route must disconnect every exclusive source group.");
  }
  if (!validRoute(contract.safeDefaultRoute)) reasons.push("A reviewed safe default route must cover every source group.");
  if (!Array.isArray(contract.routes) || contract.routes.length === 0 || !Array.from(contract.routes).every((route) => record(route)
    && isSelection(route.selection) && kinds[route.selection].includes(route.transportKind as GnssTransportKind)
    && identifier(route.gnssChannelId) && route.gnssChannelId !== contract.control.channelId && validRoute(route.route)
    && route.route.id !== contract.allOpenRoute?.id && route.route.sources.some((binding) => binding.sourceId !== null))) {
    reasons.push("Each available selection requires a qualified route and a separate compatible GNSS channel.");
  } else if (new Set(contract.routes.map((route) => route.selection)).size !== contract.routes.length
    || new Set(contract.routes.map((route) => route.route.id)).size !== contract.routes.length) {
    reasons.push("Selections and target route identities must be unambiguous.");
  }
  if (reasons.length > 0) return { contract: null, reasons };
  const allRoutes = [contract.allOpenRoute, contract.safeDefaultRoute, ...contract.routes.map((route) => route.route)];
  if (allRoutes.some((route) => allRoutes.some((other) => route.id === other.id && !sameBindings(route.sources, other.sources, contract)))) {
    return { contract: null, reasons: ["A route identity cannot describe different source configurations."] };
  }
  // Snapshot only the declared contract fields; caller-owned objects and unrelated data remain untouched.
  const snapshot: TransportSwitchContract = {
    status: "qualified", id: contract.id, ownershipScopeId: contract.ownershipScopeId, receiverProfileId: contract.receiverProfileId,
    identities: Object.fromEntries(identityKeys.map((key) => [key, contract.identities[key]])) as unknown as TransportSwitchHardwareIdentities,
    review: { reviewerId: contract.review.reviewerId, evidenceReferences: [...contract.review.evidenceReferences],
      levelAndPowerReviewed: true, exclusiveGroupsReviewed: true, safeDefaultsReviewed: true, timingReviewed: true },
    control: { channelId: contract.control.channelId, confirmationKind: contract.control.confirmationKind,
      independentOfGnss: true, survivesRouteChanges: true, authenticatedCommands: true, idempotentRequests: true,
      stateQuery: true, safeOnPowerLossAndRestart: true, safeOnWatchdogAndControlLoss: true },
    exclusiveSourceGroups: contract.exclusiveSourceGroups.map((group) => ({ id: group.id, sourceIds: [...group.sourceIds] })),
    allOpenRoute: copyRoute(contract.allOpenRoute), safeDefaultRoute: copyRoute(contract.safeDefaultRoute),
    routes: contract.routes.map(({ selection, transportKind, gnssChannelId, route }) => ({ selection, transportKind, gnssChannelId, route: copyRoute(route) })),
    timing: Object.fromEntries(timingKeys.map((key) => [key, contract.timing[key]])) as unknown as TransportSwitchContract["timing"],
  };
  return { contract: freeze(snapshot), reasons: [] };
}

/** runId and controlSessionId must be new for a new controller lifetime; persisted ready states must never be restored. */
export function createTransportSwitchState(input: {
  runId: string; controlSessionId: string; nowMonotonicMs: number; contract: unknown; observedIdentities: unknown;
}): TransportSwitchState {
  const qualification = qualifyTransportSwitchContract(input.contract);
  const reasons = [...qualification.reasons];
  if (!identifier(input.runId) || !identifier(input.controlSessionId)) reasons.push("New controller run and control session identities are required.");
  if (!time(input.nowMonotonicMs)) reasons.push("A finite nonnegative monotonic clock is required.");
  if (qualification.contract && (!record(input.observedIdentities) || !identityKeys.every((key) =>
    (input.observedIdentities as Record<string, unknown>)[key] === qualification.contract!.identities[key]))) {
    reasons.push("Observed hardware does not match the qualified identities.");
  }
  return freeze({
    runId: identifier(input.runId) ? input.runId : "", controlSessionId: identifier(input.controlSessionId) ? input.controlSessionId : "",
    contract: qualification.contract,
    phase: reasons.length ? "blocked" : "idle", reason: reasons.join(" ") || "Capture blocked until a complete switch and fresh receiver data.",
    lastNowMonotonicMs: time(input.nowMonotonicMs) ? input.nowMonotonicMs : 0, requestIds: [], transaction: null, pending: null,
    deadlineMonotonicMs: null, notBeforeMonotonicMs: null, ownedSessionIds: [], receiverSessionStartedMonotonicMs: null,
    lastReceiverEpochMs: null, observation: null, routingEvidence: null,
  });
}

export function availableTransportSwitchSelections(state: TransportSwitchState): readonly TransportSwitchSelection[] {
  return state.contract && (state.phase === "idle" || state.phase === "ready") ? state.contract.routes.map((route) => route.selection) : [];
}

function result(state: TransportSwitchState, effects: TransportSwitchEffect[] = []): TransportSwitchTransition {
  return freeze({ state, effects });
}

function block(state: TransportSwitchState, reason: string): TransportSwitchTransition {
  return result({ ...state, phase: "blocked", observation: null, reason }, [
    { type: "invalidate_capture", reason },
    ...(state.contract ? [{ type: "quarantine" as const, ownershipScopeId: state.contract.ownershipScopeId,
      ownedSessionIds: [...state.ownedSessionIds], pending: state.pending, reason }] : []),
  ]);
}

function startOperation(state: TransportSwitchState, operation: Operation): TransportSwitchTransition {
  const contract = state.contract!;
  const transaction = state.transaction!;
  const correlation: SwitchCorrelation = {
    runId: state.runId, controlSessionId: state.controlSessionId, requestId: transaction.requestId, sessionId: transaction.sessionId,
    operationId: `${transaction.sessionId}/${operation}`,
  };
  const deadline = state.lastNowMonotonicMs + contract.timing.operationTimeoutMs;
  if (!time(deadline) || deadline <= state.lastNowMonotonicMs) return block(state, "Operation deadline is not representable.");
  const target = contract.routes.find((route) => route.selection === transaction.selection)!;
  const phases: Record<Operation, TransportSwitchPhase> = { drain: "draining", close: "closing", safe_route: "confirming_safe", target_route: "confirming_target", open: "opening" };
  const effect: TransportSwitchEffect = operation === "drain"
    ? { type: "drain_corrections", correlation, ownershipScopeId: contract.ownershipScopeId }
    : operation === "close"
      ? { type: "close_gnss", correlation, ownershipScopeId: contract.ownershipScopeId, ownedSessionIds: [...state.ownedSessionIds], fencePriorOperations: true }
      : operation === "open"
        ? { type: "open_gnss", correlation, gnssChannelId: target.gnssChannelId, selection: target.selection, transportKind: target.transportKind,
          receiverProfileId: contract.receiverProfileId, discardBufferedInput: true }
        : { type: "set_route", correlation, controlChannelId: contract.control.channelId,
          route: operation === "safe_route" ? contract.allOpenRoute : target.route, confirmationKind: contract.control.confirmationKind };
  return result({ ...state, phase: phases[operation], pending: { operation, correlation }, deadlineMonotonicMs: deadline,
    notBeforeMonotonicMs: null, ownedSessionIds: operation === "open" ? [...state.ownedSessionIds, transaction.sessionId] : state.ownedSessionIds },
  [effect, { type: "schedule_tick", atMonotonicMs: deadline }]);
}

function waitFor(state: TransportSwitchState, phase: "breaking" | "settling" | "awaiting_data", duration: number): TransportSwitchTransition {
  const waitDeadline = state.lastNowMonotonicMs + (phase === "awaiting_data" ? duration : state.contract!.timing.waitTimeoutMs);
  const notBefore = phase === "awaiting_data" ? null : state.lastNowMonotonicMs + duration;
  if (!time(waitDeadline) || waitDeadline <= state.lastNowMonotonicMs
    || (notBefore !== null && (!time(notBefore) || notBefore - state.lastNowMonotonicMs < duration || notBefore >= waitDeadline))) {
    return block(state, "Wait deadline is not representable.");
  }
  return result({ ...state, phase, pending: null, deadlineMonotonicMs: waitDeadline, notBeforeMonotonicMs: notBefore },
    [{ type: "schedule_tick", atMonotonicMs: notBefore ?? waitDeadline },
      ...(notBefore === null ? [] : [{ type: "schedule_tick" as const, atMonotonicMs: waitDeadline }])]);
}

function matchesCorrelation(actual: unknown, expected: SwitchCorrelation): boolean {
  return record(actual) && (["runId", "controlSessionId", "requestId", "sessionId", "operationId"] as const)
    .every((key) => actual[key] === expected[key]);
}

function validEpoch(value: unknown): value is SwitchEpochAssessment {
  return record(value) && ["sessionId", "receiverProfileId", "epochId"].every((key) => identifier(value[key]))
    && time(value.receiverEpochMs) && time(value.firstReceivedMonotonicMs)
    && ["coherent", "qualityAccepted", "referenceFrameConfirmed", "heightReferenceConfirmed"].every((key) => value[key] === true);
}

/** Recheck at capture-command time. Transport eligibility supplements, never replaces, the core capture/geometry gates. */
export function transportSwitchCaptureDecision(state: TransportSwitchState, nowMonotonicMs: number): { accepted: boolean; reason: string; sessionId: string | null; epochId: string | null } {
  const epoch = state.observation;
  const accepted = state.phase === "ready" && state.contract !== null && epoch !== null && validEpoch(epoch)
    && time(nowMonotonicMs) && nowMonotonicMs >= state.lastNowMonotonicMs
    && state.deadlineMonotonicMs !== null && nowMonotonicMs < state.deadlineMonotonicMs
    && epoch.sessionId === state.transaction?.sessionId
    && state.receiverSessionStartedMonotonicMs !== null && epoch.firstReceivedMonotonicMs > state.receiverSessionStartedMonotonicMs
    && nowMonotonicMs >= epoch.firstReceivedMonotonicMs
    && nowMonotonicMs - epoch.firstReceivedMonotonicMs < state.contract.timing.maxObservationAgeMs;
  return { accepted, reason: accepted ? "Fresh coherent session; upstream quality/frame/height assessments accepted." : "Capture blocked: session, quality or freshness is not established.",
    sessionId: accepted ? epoch.sessionId : null, epochId: accepted ? epoch.epochId : null };
}

/** Publish returned state before executing effects. Effects are serialized, ownership-scoped intents, never hardware I/O. */
export function transitionTransportSwitch(state: TransportSwitchState, event: TransportSwitchEvent): TransportSwitchTransition {
  if (state.phase === "blocked") return result(state);
  if (!record(event) || !time(event.nowMonotonicMs) || event.nowMonotonicMs < state.lastNowMonotonicMs) {
    return block(state, "Malformed or regressing monotonic time; operator recovery is required.");
  }
  const next = { ...state, lastNowMonotonicMs: event.nowMonotonicMs };
  if (event.type === "restart") return block(next, "Restart invalidates the run. Fence prior operations before creating a new controller run.");
  if (event.type === "disconnect") return block(next, "A control or GNSS disconnect makes ownership uncertain; operator recovery is required.");
  if (next.deadlineMonotonicMs !== null && event.nowMonotonicMs >= next.deadlineMonotonicMs) {
    return block(next, `Timed out in ${next.phase}; ownership is retained until operations are fenced and cleaned up.`);
  }
  if (event.type === "request") {
    const revoked = { ...next, observation: null };
    if (!identifier(event.requestId) || !isSelection(event.selection)) return block(revoked, "Malformed switch request.");
    if (next.phase !== "idle" && next.phase !== "ready") return block(revoked, "Concurrent switch request; no additional route or transport may start.");
    if (next.requestIds.includes(event.requestId)) return block(revoked, "Reused request identity; a new request identity is required.");
    if (!next.contract?.routes.some((route) => route.selection === event.selection)) return block(revoked, "Requested route has no qualified hardware contract.");
    const switched = startOperation({ ...revoked, requestIds: [...next.requestIds, event.requestId],
      transaction: { requestId: event.requestId, sessionId: `${next.runId}/session/${next.requestIds.length + 1}`, selection: event.selection },
      receiverSessionStartedMonotonicMs: null, routingEvidence: null, reason: "Capture revoked while the transport switches." }, "drain");
    return result(switched.state, [{ type: "invalidate_capture", reason: "Switch requested; invalidate the current observation." }, ...switched.effects]);
  }
  if (event.type === "tick") {
    if ((next.phase === "breaking" || next.phase === "settling") && next.notBeforeMonotonicMs !== null && event.nowMonotonicMs >= next.notBeforeMonotonicMs) {
      return startOperation(next, next.phase === "breaking" ? "target_route" : "open");
    }
    return result(next);
  }
  if (event.type === "epoch") {
    const epoch = event.observation;
    if ((next.phase !== "awaiting_data" && next.phase !== "ready") || !validEpoch(epoch)
      || epoch.sessionId !== next.transaction?.sessionId || epoch.receiverProfileId !== next.contract?.receiverProfileId
      || next.receiverSessionStartedMonotonicMs === null || epoch.firstReceivedMonotonicMs <= next.receiverSessionStartedMonotonicMs
      || epoch.firstReceivedMonotonicMs > event.nowMonotonicMs
      || event.nowMonotonicMs - epoch.firstReceivedMonotonicMs >= next.contract.timing.maxObservationAgeMs
      || (next.lastReceiverEpochMs !== null && epoch.receiverEpochMs <= next.lastReceiverEpochMs)
      || (next.observation !== null && epoch.firstReceivedMonotonicMs <= next.observation.firstReceivedMonotonicMs)) {
      return block(next, "Old, malformed, incoherent or unqualified epoch cannot enable capture.");
    }
    const deadline = epoch.firstReceivedMonotonicMs + next.contract.timing.maxObservationAgeMs;
    if (!time(deadline) || deadline <= event.nowMonotonicMs) return block(next, "Observation expiry is not representable.");
    const observation: SwitchEpochAssessment = { sessionId: epoch.sessionId, receiverProfileId: epoch.receiverProfileId,
      epochId: epoch.epochId, receiverEpochMs: epoch.receiverEpochMs, firstReceivedMonotonicMs: epoch.firstReceivedMonotonicMs,
      coherent: true, qualityAccepted: true, referenceFrameConfirmed: true, heightReferenceConfirmed: true };
    return result({ ...next, phase: "ready", observation, lastReceiverEpochMs: epoch.receiverEpochMs,
      deadlineMonotonicMs: deadline, notBeforeMonotonicMs: null, reason: "Fresh receiver session is eligible for the upstream capture gate." },
    [{ type: "schedule_tick", atMonotonicMs: deadline }]);
  }
  if (!("correlation" in event) || !next.pending || !matchesCorrelation(event.correlation, next.pending.correlation)) {
    return block(next, "Unexpected or stale acknowledgement; request, session and operation must match.");
  }
  if (event.type === "failed") return block(next, `Adapter failure: ${identifier(event.reason) ? event.reason : "unspecified failure"}. Ownership remains quarantined.`);
  if (event.type === "drained" && next.pending.operation === "drain") {
    return event.writesStopped === true && event.drained === true
      ? startOperation(next, "close") : block(next, "Correction writes did not stop and drain conclusively.");
  }
  if (event.type === "closed" && next.pending.operation === "close") {
    return event.closed === true && event.priorOperationsFenced === true
      ? startOperation({ ...next, ownedSessionIds: [] }, "safe_route") : block(next, "Old transports or prior operations remain unfenced; routing is forbidden.");
  }
  if (event.type === "route_confirmed" && (next.pending.operation === "safe_route" || next.pending.operation === "target_route")) {
    const contract = next.contract!;
    const safe = next.pending.operation === "safe_route";
    const expectedRoute = safe ? contract.allOpenRoute : contract.routes.find((route) => route.selection === next.transaction!.selection)!.route;
    if (event.routeId !== expectedRoute.id || event.kind !== contract.control.confirmationKind || !identifier(event.evidenceId)
      || !sameBindings(event.sources, expectedRoute.sources, contract)) {
      return block(next, "Route confirmation does not match the qualified route or required evidence kind.");
    }
    return waitFor({ ...next, routingEvidence: { routeId: event.routeId, kind: event.kind, evidenceId: event.evidenceId } },
      safe ? "breaking" : "settling", safe ? contract.timing.breakBeforeMakeMs : contract.timing.settleMs);
  }
  if (event.type === "opened" && next.pending.operation === "open") {
    if (event.sessionId !== next.transaction!.sessionId || event.bufferedInputDiscarded !== true || event.newReceiverSessionStarted !== true) {
      return block(next, "A fresh receiver session with discarded buffered input was not established.");
    }
    return waitFor({ ...next, receiverSessionStartedMonotonicMs: event.nowMonotonicMs }, "awaiting_data", next.contract!.timing.freshDataTimeoutMs);
  }
  return block(next, "Acknowledgement belongs to the wrong operation stage.");
}
