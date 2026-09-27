import assert from "node:assert/strict";
import { test } from "node:test";
import { createProjectEditorState, sampleProject, type ProjectEditorState, type ProjectMapFeature } from "@cplayout/core";
import { dispatchProjectEditorAction } from "./projectEditorDispatch";
import { createPendingMapDraftSession } from "./pendingMapDraft";

const field = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const vertices = [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 25, y: 30 }];

function harness() {
  const editor = { current: createProjectEditorState({ ...sampleProject, fieldBoundary: field, mapFeatures: [] }) };
  const published: ProjectEditorState[] = [];
  const dispatch = (action: Parameters<typeof dispatchProjectEditorAction>[1]) =>
    dispatchProjectEditorAction(editor, action, (next) => { published.push(next); });
  return { editor, published, dispatch };
}

test("same-batch boundary shrink rejects a retained purpose save against current geometry", () => {
  const { editor, published, dispatch } = harness();
  const scope = { projectId: editor.current.project.id, projectCrs: editor.current.project.projectCrs, projectGeneration: 1, editable: true };
  const pending = createPendingMapDraftSession(() => scope);
  const accepted = pending.begin({ geometryType: "Polygon", vertices, sourceConfidence: "user_estimated" }, scope);
  if (!accepted.ok) throw new Error(accepted.error);
  const original = pending.getSnapshot();
  const save = () => pending.save(accepted.owner, (draft) => dispatch({ type: "add_map_feature", feature: {
    id: "corner", name: "Corner", kind: "corner_swing_limit", confidence: draft.sourceConfidence,
    geometry: { type: "Polygon", vertices: draft.vertices },
  } }), "Committed");
  dispatch({ type: "commit_boundary_draft", vertices: field.map((point) => ({ x: point.x / 10, y: point.y / 10 })) });
  const afterShrink = editor.current;
  assert.equal(save()?.outcome, "rejected");
  assert.equal(editor.current.project, afterShrink.project);
  assert.equal(editor.current.revision, afterShrink.revision);
  assert.deepEqual(pending.getSnapshot()?.draft, original?.draft);
  assert.match(pending.getSnapshot()?.error ?? "", /inside the field boundary/);
  assert.equal(published.at(-1), editor.current);
  dispatch({ type: "undo" });
  assert.equal(save()?.outcome, "committed");
  assert.equal(pending.getSnapshot(), null);
  assert.equal(editor.current.project.mapFeatures?.length, 1);
});

test("queued accepted changes, undo and redo publish exact reducer snapshots", () => {
  const { editor, published, dispatch } = harness();
  const feature = (id: string): ProjectMapFeature => ({ id, name: id, kind: "pump_location", confidence: "user_estimated",
    geometry: { type: "Point", point: { x: 20, y: 20 } } });
  assert.deepEqual(dispatch({ type: "add_map_feature", feature: feature("a") }), { ok: true, revision: 1 });
  assert.deepEqual(dispatch({ type: "add_map_feature", feature: feature("b") }), { ok: true, revision: 2 });
  assert.equal(editor.current.project.mapFeatures?.length, 2);
  assert.equal(published.at(-1), editor.current);
  dispatch({ type: "undo" });
  assert.equal(editor.current.project.mapFeatures?.length, 1);
  dispatch({ type: "redo" });
  assert.equal(editor.current.project.mapFeatures?.length, 2);
  assert.equal(dispatch({ type: "add_map_feature", feature: feature("a") }).ok, false);
  assert.equal(editor.current.project.mapFeatures?.length, 2);
  assert.equal(published.at(-1), editor.current);
});

test("replacement project is authoritative before the next queued action", () => {
  const { editor, dispatch } = harness();
  const replacement = { ...sampleProject, id: "replacement", mapFeatures: [] };
  dispatch({ type: "load_project", project: replacement });
  dispatch({ type: "commit_boundary_draft", vertices: field });
  assert.equal(editor.current.project.id, "replacement");
  assert.deepEqual(editor.current.project.fieldBoundary, field);
  assert.equal(editor.current.past[0].id, "replacement");
});
