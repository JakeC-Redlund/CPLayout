import assert from "node:assert/strict";
import test from "node:test";
import { convertPivotProjectToFieldDesign, createFieldLayoutTarget, createLayoutSessionDocument,
  defaultProjectSettings, sampleProject, serializeDesignDraftDocument, serializeFieldLayoutTarget,
  serializeFieldDesignDocument, type DesignDraft } from "@cplayout/core";
import { createVersionedProjectRepository, readWorkspaceDesign } from "../../../../packages/project-store/src/versionedProjectRepository";
import type { WorkspaceCommand } from "../../../../packages/project-store/src/workspaceCommands";
import { acceptCommittedWorkspaceDesign, acknowledgeWorkspaceSave, editableFromIndependentDocument,
  editableFromSavedDesign, reduceWorkspaceEditable, serializeWorkspaceEditable, workspaceEditableIsDirty } from "./workspaceDocumentAdapters";
import { acceptControllerLayoutReceipt, createWorkspaceControllerState, openControllerDocument,
  openControllerLayout, reduceControllerDocument, reduceControllerDocumentBatch, selectControllerMode } from "./workspaceControllerState";
import { captureWorkspaceOperationOwner, isWorkspaceOperationCurrent } from "./workspacePresentation";
import { mapContextForLayoutSession, workspaceMapContextKey } from "./workspaceMapContext";

const now = "2026-10-11T00:00:00.000Z";
const clear = { dirty: false, busy: false };
function draft(): DesignDraft {
  const settings = defaultProjectSettings();
  return { id: "synthetic-draft", name: "Synthetic incomplete design", projectCrs: "EPSG:32613",
    unitSystem: settings.unitSystem, settings, fieldBoundary: [], pivotCenter: null, waterSource: null,
    powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
}
async function fixture() {
  const values = new Map<string, string>();
  const api = createVersionedProjectRepository({ getStorage: () => ({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); } }),
    getLocks: () => ({ request: async (_name, _options, run) => run() }) }).versionedWorkspace!;
  let workspace = await api.readAsync();
  async function execute(command: unknown) {
    workspace = (await api.executeAsync(workspace.revision, { now, ...command as object } as WorkspaceCommand)).workspace;
  }
  await execute({ type: "create_client", id: "customer", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } });
  await execute({ type: "create_project_with_initial_field_map", input: { clientId: "customer", projectId: "folder",
    projectName: "Synthetic project", projectCrs: "EPSG:32613", unitSystem: "metric", fieldMapId: "field" } });
  await execute({ type: "create_design_draft", designId: "design", fieldMapId: "field", name: draft().name, draft: draft() });
  function read() { const result = readWorkspaceDesign(workspace, "design"); if (result.kind === "not_found") throw new Error("Missing synthetic design"); return result; }
  return { read, execute, workspace: () => workspace };
}
function layout(fieldMapId = "field", id = "session") {
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { fieldId: "frozen-source", waterSourceId: "water", powerSourceId: "power" }).field;
  const targetDocument = serializeFieldLayoutTarget(createFieldLayoutTarget(field, {
    inputRevision: 3, expectedRevision: 3, selectedMachineIds: [field.machines[0].id],
  }));
  return { session: createLayoutSessionDocument({ id, name: "Synthetic Layout", fieldMapId, targetDocument, now }), persistenceRevision: 9 };
}

test("mode cycles retain the actual draft, history, saved receipt, selection and camera context", async () => {
  const f = await fixture();
  let state = openControllerDocument(createWorkspaceControllerState(), editableFromSavedDesign(f.read()), clear);
  state = reduceControllerDocument(state, { kind: "draft", action: { type: "rename", name: "Unfinished design changes" } });
  state = { ...state, selectedAddress: "boundary" };
  const editable = state.editable, context = state.mapContext, selected = state.selectedAddress;
  const acceptedSave = captureWorkspaceOperationOwner(state.presentation, "document");
  const heldGesture = captureWorkspaceOperationOwner(state.presentation, "interaction");
  for (const mode of ["survey", "layout", "design"] as const) {
    state = selectControllerMode(state, mode);
    assert.equal(state.editable, editable); assert.equal(state.mapContext, context);
    assert.equal(state.selectedAddress, selected); assert.equal(state.savedState, "unsaved");
    assert.equal(isWorkspaceOperationCurrent(state.presentation, acceptedSave), true);
    assert.equal(isWorkspaceOperationCurrent(state.presentation, heldGesture), false);
  }
  assert.equal(state.editable?.editor.past.length, 1);
});

test("a real same-ID reload retires callbacks; selecting the retained document does not", async () => {
  const f = await fixture(), editable = editableFromSavedDesign(f.read());
  const state = openControllerDocument(createWorkspaceControllerState(), editable, clear);
  const owner = captureWorkspaceOperationOwner(state.presentation, "document");
  assert.equal(openControllerDocument(state, editableFromSavedDesign(f.read()), clear), state);
  const reloaded = openControllerDocument(state, editableFromSavedDesign(f.read()), clear, true);
  assert.equal(isWorkspaceOperationCurrent(reloaded.presentation, owner), false);
  assert.deepEqual(reloaded.mapContext, state.mapContext);
  assert.throws(() => openControllerDocument(state, editable, { dirty: true, busy: false }, true), /preserve/);
});

test("independent incomplete imports stay truthful and cannot claim managed draft saving", () => {
  const source = draft(); source.projectCrs = null;
  const editable = editableFromIndependentDocument("draft", serializeDesignDraftDocument(source));
  const state = openControllerDocument(createWorkspaceControllerState(), editable, clear);
  assert.equal(state.editable?.kind, "draft"); assert.equal(state.presentation.document?.designId, null);
  assert.equal(state.mapContext?.kind, "independent"); assert.equal(state.presentation.document?.projectCrs, null);
  assert.equal(editable.kind === "draft" && editable.editor.draft.pivotCenter, null);
  assert.deepEqual(editable.kind === "draft" && editable.editor.draft.machine, {});
});

test("an unsupported independent Project cannot enter editable state and lose future fields", () => {
  const project = structuredClone(sampleProject);
  const document = JSON.stringify({ documentVersion: "pivot-project-v1", project: {
    ...project, futureField: "Retain opaque source", machine: { ...project.machine, futureCalibration: "unknown" },
  } });
  assert.throws(() => editableFromIndependentDocument("project", document), /unsupported|loss|retai|field/i);
  const current = createWorkspaceControllerState();
  assert.equal(current.editable, null);
});

test("Survey and Layout cannot run a manual geometry reducer; load actions cannot bypass replacement", async () => {
  const f = await fixture();
  const state = openControllerDocument(createWorkspaceControllerState(), editableFromSavedDesign(f.read()), clear);
  assert.throws(() => reduceControllerDocument(selectControllerMode(state, "survey"), { kind: "draft", action: { type: "set_infrastructure", role: "pivot_center", point: { x: 1, y: 2 } } }), /Design mode/);
  assert.throws(() => reduceWorkspaceEditable(state.editable!, { kind: "project", action: { type: "load_project", project: sampleProject } } as never), /another document kind/);
});

test("an admitted save acknowledges its own snapshot while later edits/history remain unsaved", async () => {
  const f = await fixture(); let editable = editableFromSavedDesign(f.read());
  editable = reduceWorkspaceEditable(editable, { kind: "draft", action: { type: "rename", name: "First admitted name" } });
  const request = { editorRevision: editable.editor.revision, document: serializeWorkspaceEditable(editable) };
  assert.equal(editable.kind, "draft"); if (editable.kind !== "draft") return;
  await f.execute({ type: "save_design_draft", designId: "design", expectedDesignRevision: f.read().design.revision, draft: editable.editor.draft });
  editable = reduceWorkspaceEditable(editable, { kind: "draft", action: { type: "rename", name: "Later unfinished name" } });
  const acknowledged = acknowledgeWorkspaceSave(editable, f.read(), request);
  assert.equal(acknowledged.editor, editable.editor); assert.equal(acknowledged.savedEditorRevision, 1);
  assert.equal(acknowledged.editor.past.length, 2); assert(workspaceEditableIsDirty(acknowledged));
  assert.equal(acknowledged.kind === "draft" && acknowledged.editor.draft.name, "Later unfinished name");
  assert.throws(() => acknowledgeWorkspaceSave(editable, f.read(), { ...request, document: "wrong source" }), /differs/);
});

test("recorded transaction retains domain history, rejects changed local inputs and refuses foreign ownership", async () => {
  const f = await fixture(), current = editableFromSavedDesign(f.read());
  const expected = { editorRevision: current.editor.revision, document: serializeWorkspaceEditable(current) };
  const source = draft(); source.name = "Synthetic persisted transaction";
  await f.execute({ type: "save_design_draft", designId: "design", expectedDesignRevision: 0, draft: source });
  const next = acceptCommittedWorkspaceDesign(current, f.read(), expected);
  assert.equal(next.editor.past.length, 1); assert.equal(next.editor.revision, 1); assert(!workspaceEditableIsDirty(next));
  const changed = reduceWorkspaceEditable(current, { kind: "draft", action: { type: "rename", name: "New local work" } });
  assert.throws(() => acceptCommittedWorkspaceDesign(changed, f.read(), expected), /Save|changed/);
  const foreign = { ...f.read(), context: { ...f.read().context, fieldMapId: "another-field" } };
  assert.throws(() => acceptCommittedWorkspaceDesign(current, foreign, expected), /another design/);
});

test("target-only Layout uses the actual field and immutable target without inventing an editable design", () => {
  const opened = layout("actual-associated-field");
  const state = openControllerLayout(createWorkspaceControllerState(), opened, clear);
  assert.equal(state.editable, null); assert.equal(state.presentation.document, null);
  assert.equal(state.presentation.mode, "layout"); assert.deepEqual(state.mapContext, mapContextForLayoutSession(opened.session));
  const key = workspaceMapContextKey(state.mapContext);
  assert.equal(workspaceMapContextKey(selectControllerMode(state, "survey").mapContext), key);
  assert.equal(state.layout?.session.targetDocument, opened.session.targetDocument);
  const tampered = { ...opened, session: { ...opened.session, targetHash: "0".repeat(64) } };
  assert.throws(() => acceptControllerLayoutReceipt(state, tampered), /hash/);
});

test("same-field target replacement retires held gestures; wrong-field target opening honors dirty admission", () => {
  const state = openControllerLayout(createWorkspaceControllerState(), layout(), clear);
  const gesture = captureWorkspaceOperationOwner(state.presentation, "interaction");
  const replaced = openControllerLayout(state, layout("field", "another-session"), clear);
  assert.equal(isWorkspaceOperationCurrent(replaced.presentation, gesture), false);
  assert.deepEqual(replaced.mapContext, state.mapContext);
  assert.throws(() => openControllerLayout(state, layout("another-field", "foreign-field-session"), { dirty: true, busy: false }), /preserve/);
  assert.equal(state.layout?.session.id, "session");
});

test("same-ID Layout selection cannot replace an immutable target or raw retained session contents", () => {
  const original = layout();
  const state = openControllerLayout(createWorkspaceControllerState(), original, clear);
  const selected = openControllerLayout(state, { ...original, session: { ...original.session, name: "Incoming changed name" } }, { dirty: true, busy: true });
  assert.equal(selected, state); assert.equal(selected.layout?.session.name, original.session.name);
  const changedField = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { fieldId: "another-source", waterSourceId: "water", powerSourceId: "power" }).field;
  const targetDocument = serializeFieldLayoutTarget(createFieldLayoutTarget(changedField, { inputRevision: 4, expectedRevision: 4, selectedMachineIds: [changedField.machines[0].id] }));
  const replacement = { session: createLayoutSessionDocument({ id: original.session.id, name: original.session.name, fieldMapId: original.session.fieldMapId, targetDocument, now }), persistenceRevision: 10 };
  assert.throws(() => openControllerLayout(state, replacement, { dirty: true, busy: true }), /immutable target/);
  assert.equal(state.layout?.session.targetDocument, original.session.targetDocument);
});

test("field input selection is presentation and does not mark a design changed", () => {
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { fieldId: "field-source", waterSourceId: "water", powerSourceId: "power" }).field;
  const independent = editableFromIndependentDocument("field", serializeFieldDesignDocument(field));
  const selected = reduceWorkspaceEditable(independent, { kind: "field", action: { type: "select_machine", id: field.machines[0].id } });
  assert.equal(selected.editor.revision, independent.editor.revision); assert.equal(selected.editor.past, independent.editor.past);
  assert(!workspaceEditableIsDirty(selected));
});

test("field rename is an actual undoable domain change preserving geometry, sources and machine selection", () => {
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { fieldId: "field-source", waterSourceId: "water", powerSourceId: "power" }).field;
  let editable = editableFromIndependentDocument("field", serializeFieldDesignDocument(field));
  editable = reduceWorkspaceEditable(editable, { kind: "field", action: { type: "select_machine", id: field.machines[0].id } });
  const renamed = reduceWorkspaceEditable(editable, { kind: "field", action: { type: "rename", name: "Operator field design name" } });
  assert.equal(renamed.kind, "field"); if (renamed.kind !== "field" || editable.kind !== "field") return;
  assert.equal(renamed.editor.field.name, "Operator field design name");
  assert.deepEqual(renamed.editor.field.fieldBoundary, editable.editor.field.fieldBoundary);
  assert.deepEqual(renamed.editor.field.machines, editable.editor.field.machines);
  assert.equal(renamed.editor.selectedMachineId, editable.editor.selectedMachineId);
  assert.equal(renamed.sourceDocument, editable.sourceDocument);
  const undone = reduceWorkspaceEditable(renamed, { kind: "field", action: { type: "undo" } });
  assert.equal(undone.kind === "field" && undone.editor.field.name, editable.editor.field.name);
});

test("begin+first vertex is one admitted gesture and one Undo; invalid second input cannot leave an empty started capture", async () => {
  const f = await fixture();
  const initial = openControllerDocument(createWorkspaceControllerState(), editableFromSavedDesign(f.read()), clear);
  const actions = [
    { kind: "draft", action: { type: "drawing", expectedRevision: 0, command: { type: "begin", id: "capture", name: "Boundary drawing", geometryType: "Polygon" } } },
    { kind: "draft", action: { type: "drawing", expectedRevision: 0, command: { type: "append_vertex", id: "capture", vertex: { point: { x: 1, y: 2 }, recordedAt: now, wgs84: null, elevation: null } } } },
  ] as const;
  const next = reduceControllerDocumentBatch(initial, actions);
  assert.equal(next.editable?.kind, "draft"); if (next.editable?.kind !== "draft") return;
  assert.equal(next.editable.editor.draft.drawingWorkflow?.captures[0].vertices.length, 1);
  assert.equal(next.editable.editor.past.length, 1); assert.equal(next.editable.editor.revision, 1);
  const undone = reduceControllerDocument(next, { kind: "draft", action: { type: "undo" } });
  assert.equal(undone.editable?.kind, "draft");
  if (undone.editable?.kind === "draft") {
    assert.deepEqual(undone.editable.editor.draft.drawingWorkflow?.captures, []);
    assert.equal(undone.editable.editor.draft.drawingWorkflow?.lockedCrs, draft().projectCrs);
  }
  assert.throws(() => reduceControllerDocumentBatch(initial, [actions[0], { ...actions[1], action: { ...actions[1].action, command: { ...actions[1].action.command, id: "wrong-capture" } } }]), /not found|active/i);
  assert.equal(initial.editable?.editor.revision, 0);
  assert.throws(() => reduceControllerDocumentBatch(initial, [{ ...actions[0], action: { ...actions[0].action, expectedRevision: 4 } }]), /earlier/);
});
