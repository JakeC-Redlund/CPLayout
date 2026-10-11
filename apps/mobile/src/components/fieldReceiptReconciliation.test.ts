import assert from "node:assert/strict";
import test from "node:test";
import { convertPivotProjectToFieldDesign, createFieldLayoutTarget, sampleProject, serializeFieldLayoutTarget, serializeProjectDocument } from "@cplayout/core";
import { applyWorkspaceCommand, emptyWorkspaceDocument, readWorkspaceDesign, type WorkspaceCommand, type WorkspaceDocument } from "@cplayout/project-store";
import { captureFieldReceiptBaseline, layoutTargetSavedMatches, reconcileFieldReceipt, type FieldSaveReceipt } from "./fieldReceiptReconciliation";
const now = "2026-09-28T20:00:00.000Z";
const apply = (workspace: WorkspaceDocument, command: WorkspaceCommand) => applyWorkspaceCommand(workspace, command).workspace;
function fixture() {
  let workspace = apply(emptyWorkspaceDocument(), { type: "create_client", now, id: "customer", input: { primaryContactFirstName: "First", primaryContactLastName: "Last" } });
  workspace = apply(workspace, { type: "create_project_with_initial_design", now, input: { clientId: "customer", project: sampleProject, designId: "project-design", fieldMapId: "field" } });
  workspace = apply(workspace, { type: "upgrade_workspace_to_v2", now });
  const field = convertPivotProjectToFieldDesign(serializeProjectDocument(sampleProject), { fieldId: "field-payload", waterSourceId: "water", powerSourceId: "power" }).field;
  workspace = apply(workspace, { type: "create_field_design", now, designId: "field-design", fieldMapId: "field", name: field.name, field });
  const read = readWorkspaceDesign(workspace, "field-design");
  if (read.kind !== "field") throw new Error("Fixture field missing");
  const target: FieldSaveReceipt = { kind: "field", payloadId: field.id, designId: read.design.id, designRevision: read.design.revision, workspaceRevision: workspace.revision };
  const baseline = captureFieldReceiptBaseline(target, read.field, read.context, read.originalProjectDocument, read);
  return { workspace, read, target, baseline };
}

test("Layout upgrade, session create and rename rebase only the shared workspace receipt", () => {
  const { workspace, read, target, baseline } = fixture();
  const targetDocument = serializeFieldLayoutTarget(createFieldLayoutTarget(read.field, { inputRevision: read.design.revision, expectedRevision: read.design.revision, selectedMachineIds: [read.field.machines[0].id] }));
  let next = apply(workspace, { type: "upgrade_workspace_to_v3", now });
  next = apply(next, { type: "create_layout_session", now, sessionId: "layout", fieldMapId: "field", name: "Layout", targetDocument });
  next = apply(next, { type: "rename_layout_session", now, sessionId: "layout", expectedSessionRevision: 0, name: "Returned session" });
  const originalRead = JSON.stringify(read);
  const originalTarget = { ...target };
  const reconciled = reconcileFieldReceipt(target, baseline, readWorkspaceDesign(next, target.designId));
  assert.equal(reconciled.siblingWriteAdvanced, true);
  assert.deepEqual(reconciled.target, { ...target, workspaceRevision: next.revision });
  assert.deepEqual(target, originalTarget);
  assert.equal(JSON.stringify(read), originalRead);
  const changed = structuredClone(read.field);
  changed.machines[0].configuration.name = "Unsaved local machine edit";
  const saved = apply(next, { type: "save_field_design", now, designId: target.designId, expectedDesignRevision: reconciled.target.designRevision, field: changed });
  const reopened = readWorkspaceDesign(saved, target.designId);
  assert.equal(reopened.kind, "field");
  if (reopened.kind === "field") assert.equal(reopened.field.machines[0].configuration.name, changed.machines[0].configuration.name);
});

test("unchanged reads cannot reset a failed autosave attempt or create a persistent quota loop", () => {
  const { target, baseline, read } = fixture();
  let attempts = 1;
  let failed = true;
  let attemptedEditRevision: number | null = 3;
  for (let pass = 0; pass < 4; pass++) {
    const result = reconcileFieldReceipt(target, baseline, read);
    assert.equal(result.siblingWriteAdvanced, false);
    if (result.siblingWriteAdvanced) { attemptedEditRevision = null; failed = false; }
    if (attemptedEditRevision === null) { attempts++; attemptedEditRevision = 3; failed = true; }
  }
  assert.equal(attempts, 1);
  assert.equal(failed, true);
  assert.equal(attemptedEditRevision, 3);
});

test("external field saves, deletions, changed exact bytes and changed provenance refuse reconciliation", () => {
  const { workspace, read, target, baseline } = fixture();
  const saved = apply(workspace, { type: "save_field_design", now, designId: target.designId, expectedDesignRevision: target.designRevision, field: read.field });
  assert.throws(() => reconcileFieldReceipt(target, baseline, readWorkspaceDesign(saved, target.designId)), /saved field changed/);
  assert.throws(() => reconcileFieldReceipt(target, baseline, { ...read, document: ` ${read.document}`, workspaceRevision: read.workspaceRevision + 1 }), /saved field changed/);
  assert.throws(() => reconcileFieldReceipt(target, baseline, { ...read, originalProjectDocument: "changed" }), /saved field changed/);
  assert.throws(() => reconcileFieldReceipt(target, baseline, { kind: "not_found", workspaceRevision: target.workspaceRevision + 1 }), /saved field changed/);
  assert.throws(() => reconcileFieldReceipt(target, baseline, { ...read, context: { ...read.context, fieldMapId: "other" } }), /saved field changed/);
});

test("baseline cannot adopt a changed field, payload or saved revision", () => {
  const { read, target } = fixture();
  const changed = { ...read.field, name: "New value" };
  assert.throws(() => captureFieldReceiptBaseline(target, changed, read.context, undefined, read), /saved field changed/);
  assert.throws(() => captureFieldReceiptBaseline({ ...target, designRevision: target.designRevision + 1 }, read.field, read.context, undefined, read), /saved field changed/);
  assert.throws(() => captureFieldReceiptBaseline({ ...target, payloadId: "other" }, read.field, read.context, undefined, read), /saved field changed/);
});

test("only a persisted Layout acknowledgement with exact target bytes and field association releases the frozen target", () => {
  assert.equal(layoutTargetSavedMatches("exact target", "field", undefined), false);
  assert.equal(layoutTargetSavedMatches("exact target", "field", { fieldMapId: "field", targetDocument: "exact target" }), true);
  assert.equal(layoutTargetSavedMatches("exact target", "field", { fieldMapId: "other", targetDocument: "exact target" }), false);
  assert.equal(layoutTargetSavedMatches("exact target", "field", { fieldMapId: "field", targetDocument: "exact target " }), false);
  assert.equal(layoutTargetSavedMatches(undefined, "field", { fieldMapId: "field", targetDocument: "exact target" }), false);
});
