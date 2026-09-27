import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createProjectEditorState,
  evaluateProjectEditorAction,
  reduceProjectEditorState,
  sampleProject,
  type ProjectEditorAction,
  type ProjectMutationResult,
} from "@cplayout/core";
import type { MapDraftOwner, PendingMapFeatureDraft } from "@cplayout/map-adapters";
import { createPendingMapDraftSession, type PendingMapDraftScope } from "./pendingMapDraft";

const successMessage = "Boundary committed. Use Save Local to persist this project.";
const accepted: ProjectMutationResult = { ok: true, revision: 1 };
const rejection = "Boundary rejected: vertices intersect.\nKeep all original coordinates and retry.";

function draft(): PendingMapFeatureDraft {
  return {
    geometryType: "Polygon",
    vertices: [{ x: 100, y: 200 }, { x: 110, y: 200 }, { x: 110, y: 210 }],
    sourceConfidence: "user_estimated",
    notes: "Original projected XY draft",
  };
}

function harness() {
  let scope: PendingMapDraftScope = {
    projectId: "A", projectCrs: "EPSG:26913", projectGeneration: 1, editable: true,
  };
  const session = createPendingMapDraftSession(() => scope);
  const begin = (value = draft()) => {
    const result = session.begin(value, { ...scope });
    if (!result.ok) throw new Error(result.error);
    return result.owner;
  };
  return {
    session,
    begin,
    captureScope: (): PendingMapDraftScope => ({ ...scope }),
    changeScope: (change: Partial<PendingMapDraftScope>) => { scope = { ...scope, ...change }; },
  };
}

test("begin refuses replacement and keeps the pending draft intact", () => {
  const { session, begin, captureScope } = harness();
  assert.equal(session.getSnapshot(), null);
  const owner = begin();
  const original = session.getSnapshot();
  assert.equal(session.begin({ ...draft(), notes: "Replacement" }, captureScope()).ok, false);
  assert.deepEqual(session.getSnapshot(), original);
  assert.deepEqual(session.getSnapshot()?.owner, owner);
});

test("begin, snapshots, apply, and receipts do not expose mutable owned data", () => {
  const { session, begin } = harness();
  const input = draft();
  const original = draft();
  const owner = begin(input);
  input.vertices[0].x = -1;
  input.vertices.push({ x: 0, y: 0 });
  input.notes = "Changed";
  const snapshot = session.getSnapshot()!;
  snapshot.draft.vertices[1].y = -2;
  snapshot.draft.vertices.length = 0;
  snapshot.owner.draftId = -1;
  const validOwner = { ...owner };
  owner.projectId = "Corrupted external token";
  assert.deepEqual(session.getSnapshot()?.draft, original);
  const receipt = session.save(validOwner, (value) => {
    assert.deepEqual(value, original);
    value.vertices[0].x = -3;
    value.notes = "Mutated during rejection";
    return { ok: false, error: rejection };
  }, successMessage)!;
  receipt.owner.draftId = -2;
  assert.deepEqual(session.getSnapshot(), { owner: validOwner, draft: original, error: rejection });
});

test("successful save retires synchronously and duplicate callbacks cannot dispatch", () => {
  const { session, begin } = harness();
  const owner = begin();
  let calls = 0;
  const save = () => session.save(owner, () => { calls++; return accepted; }, successMessage);
  assert.deepEqual(save(), { owner, sequence: 1, outcome: "committed", message: successMessage });
  assert.equal(session.getSnapshot(), null);
  assert.equal(save(), null);
  assert.equal(session.cancel(owner), null);
  assert.equal(calls, 1);
});

test("cancel retires synchronously with explicit unchanged-project feedback", () => {
  const { session, begin } = harness();
  const owner = begin();
  const receipt = session.cancel(owner)!;
  assert.equal(receipt.outcome, "cancelled");
  assert.match(receipt.message, /cancelled/i);
  assert.match(receipt.message, /project unchanged/i);
  assert.equal(session.getSnapshot(), null);
  assert.equal(session.cancel(owner), null);
  assert.equal(session.save(owner, () => assert.fail("cancelled draft dispatched"), successMessage), null);
});

test("rejection retains exact draft and full error, then permits retry", () => {
  const { session, begin } = harness();
  const owner = begin();
  const first = session.save(owner, () => ({ ok: false, error: rejection }), successMessage)!;
  assert.deepEqual(first, { owner, sequence: 1, outcome: "rejected", message: rejection });
  assert.deepEqual(session.getSnapshot(), { owner, draft: draft(), error: rejection });
  const second = session.save(owner, (value) => { assert.deepEqual(value, draft()); return accepted; }, successMessage)!;
  assert.equal(second.outcome, "committed");
  assert.equal(second.sequence, 2);
  assert.equal(session.getSnapshot(), null);
});

test("thrown apply errors become full rejection messages and allow retry", () => {
  for (const thrown of [new Error(rejection), rejection]) {
    const { session, begin } = harness();
    const owner = begin();
    const receipt = session.save(owner, () => { throw thrown; }, successMessage)!;
    assert.equal(receipt.outcome, "rejected");
    assert.equal(receipt.message, rejection);
    assert.equal(session.getSnapshot()?.error, rejection);
    assert.equal(session.save(owner, () => accepted, successMessage)?.outcome, "committed");
  }
});

const scopeChanges: Array<[string, Partial<PendingMapDraftScope>]> = [
  ["same-ID reload", { projectGeneration: 2 }],
  ["new project", { projectId: "B" }],
  ["CRS change", { projectCrs: "EPSG:26914" }],
  ["Home/Layout/noneditable view", { editable: false }],
];

for (const [label, change] of scopeChanges) {
  test(`${label} invalidates pending ownership before any dispatch`, () => {
    for (const operation of ["save", "cancel", "snapshot"] as const) {
      const { session, begin, changeScope } = harness();
      const owner = begin();
      changeScope(change);
      if (operation === "save") {
        assert.equal(session.save(owner, () => assert.fail("stale callback dispatched"), successMessage), null);
      } else if (operation === "cancel") {
        assert.equal(session.cancel(owner), null);
      } else {
        assert.equal(session.getSnapshot(), null);
      }
      assert.equal(session.getSnapshot(), null);
    }
  });

  test(`${label} during apply cannot publish a receipt or retain the old draft`, () => {
    for (const result of [accepted, { ok: false, error: rejection } as const]) {
      const { session, begin, changeScope } = harness();
      const owner = begin();
      assert.equal(session.save(owner, () => { changeScope(change); return result; }, successMessage), null);
      assert.equal(session.getSnapshot(), null);
    }
  });
}

test("noneditable scope blocks handoff, and returning to editing does not revive observed stale work", () => {
  const { session, begin, changeScope, captureScope } = harness();
  const owner = begin();
  changeScope({ editable: false });
  assert.equal(session.begin(draft(), captureScope()).ok, false);
  assert.equal(session.getSnapshot(), null);
  changeScope({ editable: true });
  assert.equal(session.save(owner, () => assert.fail("revived stale draft"), successMessage), null);
  assert.ok(begin().draftId > owner.draftId);
});

test("retained A handlers cannot save or cancel B after retirement, reload, or project switch", () => {
  for (const transition of ["cancel", "commit", "invalidate", "reload", "new project"]) {
    const { session, begin, changeScope } = harness();
    const a = begin();
    const saveA = () => session.save(a, () => assert.fail("A dispatched after B began"), successMessage);
    const cancelA = () => session.cancel(a);
    if (transition === "cancel") session.cancel(a);
    if (transition === "commit") session.save(a, () => accepted, successMessage);
    if (transition === "invalidate") session.invalidate();
    if (transition === "reload") changeScope({ projectGeneration: 2 });
    if (transition === "new project") changeScope({ projectId: "B" });
    const b = begin({ ...draft(), notes: "B" });
    const snapshotB = session.getSnapshot();
    assert.equal(saveA(), null);
    assert.equal(cancelA(), null);
    assert.deepEqual(session.getSnapshot(), snapshotB);
    assert.ok(b.draftId > a.draftId);
  }
});

test("every owner field must match, while a copied current token is accepted", () => {
  const { session, begin } = harness();
  const owner = begin();
  const changes: Partial<MapDraftOwner>[] = [
    { projectId: "other" }, { projectCrs: "other" }, { projectGeneration: 99 }, { draftId: 99 },
  ];
  for (const change of changes) {
    const stale = { ...owner, ...change };
    assert.equal(session.save(stale, () => assert.fail("invalid owner dispatched"), successMessage), null);
    assert.equal(session.cancel(stale), null);
    assert.deepEqual(session.getSnapshot()?.owner, owner);
  }
  assert.equal(session.save({ ...owner }, () => accepted, successMessage)?.outcome, "committed");
});

test("reentrant save and cancel cannot dispatch or retire an in-flight draft", () => {
  const { session, begin, captureScope } = harness();
  const owner = begin();
  const receipt = session.save(owner, () => {
    assert.equal(session.save(owner, () => assert.fail("reentrant dispatch"), successMessage), null);
    assert.equal(session.cancel(owner), null);
    assert.equal(session.begin(draft(), captureScope()).ok, false);
    return accepted;
  }, successMessage);
  assert.equal(receipt?.outcome, "committed");
  assert.equal(session.getSnapshot(), null);
});

test("invalidation during apply suppresses completion, including thrown rejection", () => {
  for (const outcome of ["accept", "reject", "throw"]) {
    const { session, begin } = harness();
    const owner = begin();
    const receipt = session.save(owner, () => {
      session.invalidate();
      if (outcome === "throw") throw new Error(rejection);
      return outcome === "accept" ? accepted : { ok: false, error: rejection };
    }, successMessage);
    assert.equal(receipt, null);
    assert.equal(session.getSnapshot(), null);
    const next = begin();
    assert.equal(session.cancel(next)?.sequence, 1, "stale completions do not consume receipt sequence");
  }
});

test("old apply completion cannot overwrite, retire, or unlock newer reentrant work", () => {
  for (const outcome of ["accept", "reject", "throw"]) {
    const { session, begin } = harness();
    const a = begin();
    let b!: MapDraftOwner;
    const receipt = session.save(a, () => {
      session.invalidate();
      b = begin({ ...draft(), notes: "B" });
      const bReceipt = session.save(b, () => ({ ok: false, error: "B error" }), successMessage);
      assert.equal(bReceipt?.sequence, 1);
      if (outcome === "throw") throw new Error("A error");
      return outcome === "accept" ? accepted : { ok: false, error: "A error" };
    }, successMessage);
    assert.equal(receipt, null);
    assert.deepEqual(session.getSnapshot(), { owner: b, draft: { ...draft(), notes: "B" }, error: "B error" });
    assert.equal(session.save(b, () => accepted, successMessage)?.sequence, 2);
  }
});

test("draft and receipt counters remain monotonic across cancellation and invalidation", () => {
  const { session, begin } = harness();
  const first = begin();
  assert.equal(session.cancel(first)?.sequence, 1);
  const second = begin();
  session.invalidate();
  session.invalidate();
  const third = begin();
  assert.ok(first.draftId < second.draftId && second.draftId < third.draftId);
  assert.equal(session.save(third, () => ({ ok: false, error: rejection }), successMessage)?.sequence, 2);
  assert.equal(session.cancel(third)?.sequence, 3);
});

test("geometry qualification beyond ownership is delegated to apply without changing coordinates", () => {
  const { session, begin } = harness();
  const incomplete: PendingMapFeatureDraft = { ...draft(), geometryType: "Polygon", vertices: [] };
  const owner = begin(incomplete);
  assert.equal(session.save(owner, (value) => {
    assert.deepEqual(value, incomplete);
    return { ok: false, error: "At least three vertices required." };
  }, successMessage)?.outcome, "rejected");
  assert.deepEqual(session.getSnapshot()?.draft, incomplete);
});

for (const [label, change] of scopeChanges) {
  test(`retained begin callback refuses ${label} before adopting live scope`, () => {
    const { session, begin, changeScope, captureScope } = harness();
    const expectedScope = captureScope();
    const retainedBegin = () => session.begin(draft(), expectedScope);
    changeScope(change);
    const rejected = retainedBegin();
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.ok(rejected.error.length > 0);
    assert.equal(session.getSnapshot(), null);
    if (change.editable === false) changeScope({ editable: true, projectGeneration: 2 });
    const owner = begin({ ...draft(), notes: "Current draft" });
    assert.equal(owner.draftId, 1, "rejected handoffs must not consume draft IDs");
    session.save(owner, () => ({ ok: false, error: rejection }), successMessage);
    const current = session.getSnapshot();
    assert.equal(retainedBegin().ok, false);
    assert.deepEqual(session.getSnapshot(), current, "stale handoff must preserve the newer draft and error");
    assert.equal(session.cancel(owner)?.sequence, 2);
  });
}

test("begin requires both expected and live scopes to be editable", () => {
  for (const expectedEditable of [false, true]) {
    for (const liveEditable of [false, true]) {
      const { session, changeScope, captureScope } = harness();
      changeScope({ editable: expectedEditable });
      const expectedScope = captureScope();
      const retainedBegin = () => session.begin(draft(), expectedScope);
      changeScope({ editable: liveEditable });
      assert.equal(retainedBegin().ok, expectedEditable && liveEditable);
    }
  }
});

test("a begin callback retained from Home/Layout cannot replace a current editable draft", () => {
  const { session, begin, changeScope, captureScope } = harness();
  changeScope({ editable: false });
  const expectedScope = captureScope();
  const retainedBegin = () => session.begin(draft(), expectedScope);
  changeScope({ editable: true });
  const owner = begin();
  const current = session.getSnapshot();
  assert.equal(retainedBegin().ok, false);
  assert.deepEqual(session.getSnapshot(), current);
  assert.equal(session.cancel(owner)?.outcome, "cancelled");
  assert.equal(retainedBegin().ok, false, "noneditable captured scope stays blocked even without pending work");
  assert.equal(session.getSnapshot(), null);
});

test("returning to A with an invalidated generation never revives A's retained begin callback", () => {
  const { session, begin, changeScope, captureScope } = harness();
  const expectedScope = captureScope();
  const retainedBegin = () => session.begin(draft(), expectedScope);
  changeScope({ projectId: "B", projectGeneration: 2 });
  begin();
  session.invalidate();
  changeScope({ projectId: "A", projectGeneration: 3 });
  assert.equal(retainedBegin().ok, false);
  assert.equal(session.getSnapshot(), null);
  const currentOwner = begin({ ...draft(), notes: "Reloaded A" });
  const current = session.getSnapshot();
  assert.equal(retainedBegin().ok, false);
  assert.deepEqual(session.getSnapshot(), current);
  assert.equal(session.save(currentOwner, () => accepted, successMessage)?.outcome, "committed");
});

test("retained purpose save evaluates the current core editor after boundary shrink without changing draft ownership", () => {
  const center = sampleProject.pivotCenter;
  const square = (radius: number) => [
    { x: center.x - radius, y: center.y - radius },
    { x: center.x + radius, y: center.y - radius },
    { x: center.x + radius, y: center.y + radius },
    { x: center.x - radius, y: center.y + radius },
  ];
  const editorRef = { current: createProjectEditorState({
    ...sampleProject, fieldBoundary: square(100), obstacles: [], mapFeatures: [], surveyPoints: [],
  }) };
  assert.equal(editorRef.current.lastError, null);
  const scope = (): PendingMapDraftScope => ({
    projectId: editorRef.current.project.id,
    projectCrs: editorRef.current.project.projectCrs,
    projectGeneration: 1,
    editable: true,
  });
  const session = createPendingMapDraftSession(scope);
  const footprint: PendingMapFeatureDraft = { ...draft(), vertices: square(80) };
  const actionFor = (value: PendingMapFeatureDraft): ProjectEditorAction => ({
    type: "add_map_feature",
    feature: {
      id: "pending-corner-footprint",
      name: "Pending corner footprint",
      kind: "corner_swing_limit",
      geometry: { type: "Polygon", vertices: value.vertices },
      confidence: value.sourceConfidence,
      notes: value.notes,
    },
  });
  const capturedEditor = editorRef.current;
  assert.equal(evaluateProjectEditorAction(capturedEditor, actionFor(footprint)).ok, true);
  const handoff = session.begin(footprint, scope());
  if (!handoff.ok) throw new Error(handoff.error);
  const original = session.getSnapshot()!;
  let dispatched = 0;
  const retainedSave = () => session.save(handoff.owner, (value) => {
    const action = actionFor(value);
    const result = evaluateProjectEditorAction(editorRef.current, action);
    if (result.ok) {
      editorRef.current = reduceProjectEditorState(editorRef.current, action);
      dispatched++;
    }
    return result;
  }, successMessage);

  editorRef.current = reduceProjectEditorState(editorRef.current, {
    type: "commit_boundary_draft", vertices: square(20),
  });
  assert.equal(editorRef.current.lastError, null);
  assert.equal(editorRef.current.revision, capturedEditor.revision + 1);
  assert.deepEqual(session.getSnapshot(), original, "boundary edits do not change project-generation ownership");
  const shrunkEditor = editorRef.current;
  const expected = evaluateProjectEditorAction(shrunkEditor, actionFor(footprint));
  if (expected.ok) assert.fail("corner footprint outside the shrunk boundary must be rejected");
  assert.match(expected.error, /inside.*boundary/i);
  assert.equal(evaluateProjectEditorAction(capturedEditor, actionFor(footprint)).ok, true,
    "a captured editor would incorrectly accept this same footprint");
  assert.deepEqual(retainedSave(), {
    owner: handoff.owner, sequence: 1, outcome: "rejected", message: expected.error,
  });
  assert.equal(dispatched, 0);
  assert.equal(editorRef.current, shrunkEditor);
  assert.deepEqual(session.getSnapshot(), { ...original, error: expected.error });
  assert.deepEqual(session.getSnapshot()?.draft, footprint);
});
