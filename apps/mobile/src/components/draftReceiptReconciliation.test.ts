import assert from "node:assert/strict";
import test from "node:test";
import { applyWorkspaceCommand, emptyWorkspaceDocument, readWorkspaceDesign } from "@cplayout/project-store";
import { newDesignDraft } from "../newDesignDraft";
import { captureDraftReceiptBaseline, reconcileDraftReceipt, type DraftSaveReceipt } from "./draftReceiptReconciliation";
const now = "2026-09-29T00:00:00.000Z";
function fixture() {
  let workspace = applyWorkspaceCommand(emptyWorkspaceDocument(), { type: "create_client", now, id: "customer", input: { primaryContactFirstName: "First", primaryContactLastName: "Last" } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_project_with_initial_field_map", now,
    input: { clientId: "customer", projectId: "project", projectName: "Field", projectCrs: "", unitSystem: "us_survey_feet", fieldMapId: "field" } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_design_draft", now, designId: "draft-design", fieldMapId: "field",
    name: "Draft", draft: newDesignDraft("draft-payload", "Draft", "us_survey_feet") }).workspace;
  const read = readWorkspaceDesign(workspace, "draft-design");
  if (read.kind !== "draft") throw new Error("Missing draft fixture");
  const target: DraftSaveReceipt = { kind: "draft", designId: read.design.id, payloadId: read.draft.id, designRevision: read.design.revision, workspaceRevision: read.workspaceRevision };
  const baseline = captureDraftReceiptBaseline(target, read.draft, read.context, read);
  return { workspace, read, target, baseline };
}
test("sibling customer write advances only workspace receipt and allows saving retained local edits", () => {
  const { workspace, read, target, baseline } = fixture();
  const before = JSON.stringify({ read, target, baseline });
  const next = applyWorkspaceCommand(workspace, { type: "create_client", now, id: "sibling", input: { primaryContactFirstName: "Other", primaryContactLastName: "Customer" } }).workspace;
  const reconciled = reconcileDraftReceipt(target, baseline, readWorkspaceDesign(next, target.designId));
  assert.deepEqual(reconciled, { target: { ...target, workspaceRevision: next.revision }, siblingWriteAdvanced: true });
  assert.equal(JSON.stringify({ read, target, baseline }), before);
  const saved = applyWorkspaceCommand(next, { type: "save_design_draft", now, designId: target.designId, expectedDesignRevision: reconciled.target.designRevision,
    draft: { ...read.draft, name: "Retained local draft" } }).workspace;
  const opened = readWorkspaceDesign(saved, target.designId);
  assert.equal(opened.kind === "draft" && opened.draft.name, "Retained local draft");
});
test("unchanged receipt does not authorize clearing a failed save retry guard", () => {
  const { target, baseline, read } = fixture();
  assert.equal(reconcileDraftReceipt(target, baseline, read).siblingWriteAdvanced, false);
});
test("foreign draft save, missing payload, bytes or context changes fail closed", () => {
  const { workspace, read, target, baseline } = fixture();
  const next = applyWorkspaceCommand(workspace, { type: "save_design_draft", now, designId: target.designId,
    expectedDesignRevision: target.designRevision, draft: { ...read.draft, name: "Foreign saved draft" } }).workspace;
  for (const changed of [readWorkspaceDesign(next, target.designId), { ...read, document: ` ${read.document}` },
    { ...read, context: { ...read.context, fieldMapId: "other" } }, { kind: "not_found" as const, workspaceRevision: target.workspaceRevision + 1 }]) {
    assert.throws(() => reconcileDraftReceipt(target, baseline, changed), /saved draft changed/);
  }
  assert.throws(() => captureDraftReceiptBaseline(target, { ...read.draft, name: "Unacknowledged edit" }, read.context, read), /saved draft changed/);
  assert.throws(() => captureDraftReceiptBaseline({ ...target, payloadId: "different" }, read.draft, read.context, read), /saved draft changed/);
});
