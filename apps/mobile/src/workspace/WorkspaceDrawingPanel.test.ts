import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import { defaultProjectSettings } from "../../../../packages/core/src/settings";
import { serializeDesignDraftDocument } from "../../../../packages/core/src/designDraft";
import { serializeProjectDocument } from "../../../../packages/core/src/projectDocument";
import { sampleProject } from "../../../../packages/core/src/sampleProject";
import { isRecordedReferenceMetadataRecord, type DrawingMetadataRecord } from "../../../../packages/core/src/drawingMetadata";
import { editableFromIndependentDocument, reduceWorkspaceEditable, reduceWorkspaceEditableBatch, type WorkspaceEditableDocument } from "./workspaceDocumentAdapters";
import type { WorkspaceDrawingInteraction } from "./WorkspaceDrawingPanel";
const controls = new Map<string, Record<string, unknown>>();
const host = (tag: string) => (props: Record<string, unknown>) => { if (typeof props.testID === "string") controls.set(props.testID, props);
  return React.createElement(tag, { "data-testid": props.testID }, props.children as React.ReactNode); };
const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown }, original = loader._load;
const requireCurrent = createRequire(resolve(process.cwd(), "package.json"));
const { renderToStaticMarkup } = requireCurrent("react-dom/server") as { renderToStaticMarkup(node: React.ReactNode): string };
let drawing: typeof import("./WorkspaceDrawingPanel");
try { loader._load = function(request, parent, isMain) { return request === "react-native" ? {
  Platform: { OS: "native" }, View: host("div"), Text: host("span"), Pressable: host("button"), TextInput: host("input"), StyleSheet: { create: (value: unknown) => value },
} : original.call(this, request, parent, isMain); }; drawing = requireCurrent(resolve(__dirname, "WorkspaceDrawingPanel.tsx")); }
finally { loader._load = original; }
const now = "2026-10-10T12:00:00.000Z";
function digitized(record: DrawingMetadataRecord) {
  assert(!isRecordedReferenceMetadataRecord(record));
  assert.equal(record.capture.source, "map_digitized");
  return record;
}
function blank(): WorkspaceEditableDocument {
  const settings = defaultProjectSettings();
  return editableFromIndependentDocument("draft", serializeDesignDraftDocument({ id: "draft", name: "Actual incomplete fixture", projectCrs: "EPSG:32613", unitSystem: settings.unitSystem,
    settings, fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] }));
}
function point(editable: WorkspaceEditableDocument, interaction: WorkspaceDrawingInteraction, x: number, y: number) {
  const proposal = drawing.prepareWorkspaceDrawingPoint(editable, interaction, { x, y }, "capture", now);
  return { editable: reduceWorkspaceEditableBatch(editable, proposal.actions), interaction: proposal.interaction };
}
test("first Draft tap stages actual begin+append atomically with one history entry and no fabricated machine/location", () => {
  const initial = blank(), ui = { ...drawing.initialWorkspaceDrawingInteraction(initial), geometryType: "Polygon" as const };
  const proposal = drawing.prepareWorkspaceDrawingPoint(initial, ui, { x: 501000.123456789, y: 4506200.987654321 }, "capture", now);
  assert.equal(proposal.actions.length, 2); assert.deepEqual(proposal.actions.map(action => action.action.type), ["drawing", "drawing"]);
  const next = reduceWorkspaceEditableBatch(initial, proposal.actions);
  if (next.kind !== "draft") throw new Error("Expected real Draft.");
  assert.equal(next.editor.revision, 1); assert.equal(next.editor.past.length, 1);
  assert.deepEqual(next.editor.draft.drawingWorkflow!.captures[0].vertices[0], { point: { x: 501000.123456789, y: 4506200.987654321 }, recordedAt: now, wgs84: null, elevation: null });
  assert.deepEqual(next.editor.draft.machine, {}); assert.equal(next.editor.draft.pivotCenter, null); assert.deepEqual(proposal.interaction.vertices, []);
  const second = point(next, proposal.interaction, 501100, 4506200);
  if (second.editable.kind !== "draft") throw new Error("Expected Draft.");
  assert.equal(second.editable.editor.draft.drawingWorkflow!.captures[0].vertices.length, 2);
});
test("real paused Draft retains exact selected option/name/notes through core serialization and resume", () => {
  let { editable, interaction } = point(blank(), { ...drawing.initialWorkspaceDrawingInteraction(blank()), geometryType: "Polygon" }, 501000, 4506200);
  ({ editable, interaction } = point(editable, interaction, 501100, 4506200));
  ({ editable, interaction } = point(editable, interaction, 501100, 4506300));
  editable = reduceWorkspaceEditable(editable, { kind: "draft", action: { type: "drawing", expectedRevision: editable.editor.revision, command: { type: "finish", id: "capture" } } });
  interaction = { ...interaction, stage: "classification", selectionId: "exclusion_no_spray", name: "Exact raw name  ", notes: "Exact raw notes\nsecond line", detailsOpen: true };
  const dispatch = (action: Parameters<typeof reduceWorkspaceEditable>[1]) => { const next = reduceWorkspaceEditable(editable, action); if (next.editor.lastError) return false; editable = next; return true; };
  const dispatchBatch = (actions: Parameters<typeof reduceWorkspaceEditableBatch>[1]) => { editable = reduceWorkspaceEditableBatch(editable, actions); return true; };
  const render = () => { controls.clear(); return renderToStaticMarkup(React.createElement(drawing.WorkspaceDrawingPanel, { editable, interaction, onInteractionChange: next => { interaction = next; }, dispatch, dispatchBatch, createEntityId: () => "feature" })); };
  render(); (controls.get("drawing-tool-LineString")!.onPress as () => void)();
  if (editable.kind !== "draft") throw new Error("Expected Draft.");
  const workflow = editable.editor.draft.drawingWorkflow!;
  assert.equal(workflow.activeCaptureId, null); assert.equal(workflow.captures[0].classification.purposeId, "exclusion_no_spray");
  assert.equal(workflow.captures[0].classification.name, "Exact raw name  "); assert.equal(workflow.captures[0].classification.notes, "Exact raw notes\nsecond line");
  editable = editableFromIndependentDocument("draft", serializeDesignDraftDocument(editable.editor.draft));
  render(); (controls.get("drawing-resume-capture")!.onPress as () => void)();
  assert.equal(interaction.selectionId, "exclusion_no_spray"); assert.equal(interaction.name, "Exact raw name  "); assert.equal(interaction.notes, "Exact raw notes\nsecond line");
});
test("unfinished Draft pauses without premature classification and resumes exact actual ordered vertices/times", () => {
  let { editable, interaction } = point(blank(), { ...drawing.initialWorkspaceDrawingInteraction(blank()), geometryType: "Polygon" }, 501000.123456789, 4506200.987654321);
  const dispatch = (action: Parameters<typeof reduceWorkspaceEditable>[1]) => { const next = reduceWorkspaceEditable(editable, action); if (next.editor.lastError) return false; editable = next; return true; };
  const dispatchBatch = (actions: Parameters<typeof reduceWorkspaceEditableBatch>[1]) => { try { editable = reduceWorkspaceEditableBatch(editable, actions); return true; } catch { return false; } };
  const render = () => { controls.clear(); renderToStaticMarkup(React.createElement(drawing.WorkspaceDrawingPanel, { editable, interaction,
    onInteractionChange: next => { interaction = next; }, dispatch, dispatchBatch, createEntityId: () => "unused" })); };
  render(); (controls.get("drawing-pause")!.onPress as () => void)();
  if (editable.kind !== "draft") throw new Error("Expected Draft.");
  assert.equal(editable.editor.draft.drawingWorkflow!.activeCaptureId, null); assert.equal(editable.editor.draft.drawingWorkflow!.captures[0].stage, "drawing");
  render(); (controls.get("drawing-resume-capture")!.onPress as () => void)();
  assert.equal(editable.editor.draft.drawingWorkflow!.activeCaptureId, "capture"); assert.deepEqual(editable.editor.draft.drawingWorkflow!.captures[0].vertices, [{ point: { x: 501000.123456789, y: 4506200.987654321 }, recordedAt: now, wgs84: null, elevation: null }]);
});
test("Project actual classified action retains feature and infrastructure details, while legacy obstacle limitations remain explicit", () => {
  const editable = editableFromIndependentDocument("project", serializeProjectDocument(sampleProject));
  if (editable.kind !== "project") throw new Error("Expected Project.");
  const originalProject = structuredClone(editable.editor.project);
  let interaction: WorkspaceDrawingInteraction = { ...drawing.initialWorkspaceDrawingInteraction(editable), geometryType: "Point" as const };
  const proposed = drawing.prepareWorkspaceDrawingPoint(editable, interaction, { x: 501025.123456789, y: 4506235.987654321 }, "real-manual-id", now);
  assert.deepEqual(proposed.actions, []);
  interaction = { ...proposed.interaction, stage: "classification", selectionId: "well", name: "Actual well", notes: "Retain this note" };
  const action = drawing.workspaceProjectDrawingAction(editable, interaction, "new-feature");
  assert.equal(action.action.type, "commit_classified_drawing");
  const next = reduceWorkspaceEditable(editable, action);
  if (next.kind !== "project") throw new Error("Expected Project.");
  assert.equal(next.editor.project.mapFeatures!.at(-1)!.notes, "Retain this note"); assert.deepEqual(next.editor.project.mapFeatures!.at(-1)!.geometry, { type: "Point", point: proposed.interaction.vertices[0] });
  assert.deepEqual(digitized(next.editor.project.drawingMetadata!.records[0]).capture.vertexRecordedAt, [now]);
  const location = { ...interaction, selectionId: "project_water_source", replacing: true };
  const located = reduceWorkspaceEditable(editable, drawing.workspaceProjectDrawingAction(editable, location, "unused"));
  if (located.kind !== "project") throw new Error("Expected Project.");
  assert.equal(located.editor.lastError, null); assert.equal(digitized(located.editor.project.drawingMetadata!.records[0]).classification.notes, "Retain this note");
  const legacy = { ...interaction, geometryType: "Polygon" as const, selectionId: "obstacle:road" };
  assert.throws(() => drawing.workspaceProjectDrawingAction(editable, legacy, "unused"), /cannot store drawing notes/);
  assert.equal(legacy.notes, "Retain this note"); assert.deepEqual(editable.editor.project, originalProject);
});
test("Project Circle preview has source-bound real metric radius and unknown-unit circles are refused", () => {
  const editable = editableFromIndependentDocument("project", serializeProjectDocument(sampleProject));
  if (editable.kind !== "project") throw new Error("Expected Project.");
  const ui = { ...drawing.initialWorkspaceDrawingInteraction(editable), geometryType: "Circle" as const };
  const first = drawing.prepareWorkspaceDrawingPoint(editable, ui, { x: 501000, y: 4506200 }, "circle", now).interaction;
  const second = drawing.prepareWorkspaceDrawingPoint(editable, first, { x: 501003, y: 4506204 }, "ignored", now).interaction;
  const preview = drawing.workspaceDrawingPreview(editable, second)!;
  assert.deepEqual(preview.geometry, { type: "Circle", center: { x: 501000, y: 4506200 }, radiusMeters: 5 });
  assert.equal(preview.captureId, "circle"); assert.equal(preview.inputRevision, editable.editor.revision);
  const local = { ...editable, identity: { ...editable.identity, projectCrs: "LOCAL:units-unknown" }, editor: { ...editable.editor, project: { ...editable.editor.project, projectCrs: "LOCAL:units-unknown" } } };
  assert.throws(() => drawing.prepareWorkspaceDrawingPoint(local, { ...drawing.initialWorkspaceDrawingInteraction(local), geometryType: "Circle" }, { x: 1, y: 2 }, "circle", now), /metric/);
  assert.throws(() => drawing.prepareWorkspaceDrawingPoint(editable, { ...second, ownerKey: "foreign" }, { x: 1, y: 2 }, "circle", now), /another document/);
  const foreignAssociation = { ...editable, identity: { ...editable.identity, designId: "another-catalog-design" } };
  assert.throws(() => drawing.prepareWorkspaceDrawingPoint(foreignAssociation, second, { x: 1, y: 2 }, "circle", now), /another document/);
});
test("Project Pan preserves actual pending vertices/details and resumes without another geometry silently replacing them", () => {
  const editable = editableFromIndependentDocument("project", serializeProjectDocument(sampleProject));
  if (editable.kind !== "project") throw new Error("Expected Project.");
  const before = structuredClone(editable.editor.project);
  let interaction = drawing.prepareWorkspaceDrawingPoint(editable, { ...drawing.initialWorkspaceDrawingInteraction(editable), geometryType: "LineString" }, { x: 501025.123456789, y: 4506235.987654321 }, "pending", now).interaction;
  interaction = { ...interaction, name: "Pending name  ", notes: "Pending notes\nexact" };
  const render = () => { controls.clear(); renderToStaticMarkup(React.createElement(drawing.WorkspaceDrawingPanel, { editable, interaction,
    onInteractionChange: next => { interaction = next; }, dispatch: () => true, dispatchBatch: () => true, createEntityId: () => "unused" })); };
  render(); (controls.get("drawing-pan")!.onPress as () => void)();
  assert.equal(interaction.paused, true); assert.equal(interaction.geometryType, "LineString"); assert.equal(interaction.captureId, "pending");
  assert.deepEqual(interaction.vertexRecordedAt, [now]);
  assert.deepEqual(interaction.vertices, [{ x: 501025.123456789, y: 4506235.987654321 }]); assert.equal(interaction.name, "Pending name  "); assert.equal(interaction.notes, "Pending notes\nexact");
  assert.throws(() => drawing.prepareWorkspaceDrawingPoint(editable, interaction, { x: 5, y: 6 }, "other", now), /paused/);
  assert(drawing.workspaceDrawingPreview(editable, interaction));
  render(); (controls.get("drawing-tool-Polygon")!.onPress as () => void)(); assert.equal(interaction.geometryType, "LineString"); assert.equal(interaction.vertices.length, 1);
  render(); (controls.get("drawing-project-resume")!.onPress as () => void)(); assert.equal(interaction.paused, false);
  const later = "2026-10-10T12:00:01.250Z";
  interaction = drawing.prepareWorkspaceDrawingPoint(editable, interaction, { x: 501050, y: 4506250 }, "other", later).interaction; assert.equal(interaction.vertices.length, 2); assert.equal(interaction.captureId, "pending");
  assert.deepEqual(interaction.vertexRecordedAt, [now, later]);
  render(); (controls.get("drawing-remove-last")!.onPress as () => void)(); assert.equal(interaction.vertices.length, 1); assert.deepEqual(interaction.vertexRecordedAt, [now]);
  assert.deepEqual(editable.editor.project, before);
});
test("supported Project helper tool requests map to rich visible purpose and actual placement rather than unsupported selection IDs", () => {
  const editable = editableFromIndependentDocument("project", serializeProjectDocument(sampleProject));
  if (editable.kind !== "project") throw new Error("Expected Project.");
  const select = drawing.workspaceDrawingSelectionForLegacyTool;
  assert.equal(select(editable, "Polygon", "control_point", "corner_swing_limit"), "corner_arm_envelope");
  assert.equal(select(editable, "LineString", "control_point", "linear_move_path"), "linear_travel");
  assert.equal(select(editable, "Polygon", "exclusion"), "exclusion_both"); assert.equal(select(editable, "Polygon", "road"), "obstacle:road");
  assert.equal(select(editable, "Circle", "control_point", "end_gun_arc"), "feature:end_gun_arc");
  assert.equal(select(editable, "LineString", "control_point", "underground_pipeline"), "pipeline:underground");
  assert.equal(select(editable, "Point", "control_point", "underground_pipeline"), "");
  let interaction = drawing.prepareWorkspaceDrawingPoint(editable, { ...drawing.initialWorkspaceDrawingInteraction(editable), geometryType: "LineString" }, { x: 501010, y: 4506200 }, "actual-pipeline", now).interaction;
  interaction = drawing.prepareWorkspaceDrawingPoint(editable, interaction, { x: 501015.123456789, y: 4506250 }, "ignored", "2026-10-10T12:00:01.125Z").interaction;
  interaction = { ...interaction, stage: "classification", selectionId: "pipeline:underground", name: "Actual route  ", notes: "Actual raw notes\nretain" };
  const choices = drawing.workspaceDrawingChoices(editable, "LineString"); assert(choices.some(item => item.id === interaction.selectionId)); assert(choices.some(item => item.id === "subsurface_drain"));
  const next = reduceWorkspaceEditable(editable, drawing.workspaceProjectDrawingAction(editable, interaction, "actual-route"));
  if (next.kind !== "project") throw new Error("Expected Project.");
  assert.equal(next.editor.lastError, null); assert.equal(next.editor.project.mapFeatures!.at(-1)!.kind, "underground_pipeline");
  assert.equal(digitized(next.editor.project.drawingMetadata!.records[0]).classification.placement, "underground");
  assert.deepEqual(digitized(next.editor.project.drawingMetadata!.records[0]).capture.vertexRecordedAt, interaction.vertexRecordedAt);
});
test("Project operational classification asks for replacement consent and keeps exact optional name/notes in one admitted commit", () => {
  let editable = editableFromIndependentDocument("project", serializeProjectDocument(sampleProject));
  let interaction = drawing.prepareWorkspaceDrawingPoint(editable, { ...drawing.initialWorkspaceDrawingInteraction(editable), geometryType: "Point" }, { x: 501025.123456789, y: 4506235.987654321 }, "actual-water-capture", now).interaction;
  interaction = { ...interaction, stage: "classification", selectionId: "project_water_source", name: "Actual water label  ", notes: "Saved exact notes\nsecond line" };
  let admissions = 0;
  const dispatch = (action: Parameters<typeof reduceWorkspaceEditable>[1]) => { admissions++; const next = reduceWorkspaceEditable(editable, action); if (next.editor.lastError) return false; editable = next; return true; };
  const render = () => { controls.clear(); renderToStaticMarkup(React.createElement(drawing.WorkspaceDrawingPanel, { editable, interaction,
    onInteractionChange: next => { interaction = next; }, dispatch, dispatchBatch: () => false, createEntityId: () => "unused" })); };
  render(); (controls.get("drawing-classification-keep")!.onPress as () => void)(); assert.equal(admissions, 0); assert.equal(interaction.replacing, true);
  render(); (controls.get("drawing-classification-keep")!.onPress as () => void)();
  assert.equal(admissions, 1); assert.equal(editable.editor.revision, 1); assert.equal(editable.editor.past.length, 1);
  if (editable.kind !== "project") throw new Error("Expected Project.");
  const record = digitized(editable.editor.project.drawingMetadata!.records[0]); assert.equal(record.classification.name, "Actual water label  "); assert.equal(record.classification.notes, "Saved exact notes\nsecond line"); assert.deepEqual(record.capture.vertexRecordedAt, [now]);
  assert.equal(interaction.captureId, null); assert.deepEqual(interaction.vertices, []); assert.deepEqual(interaction.vertexRecordedAt, []);
});
