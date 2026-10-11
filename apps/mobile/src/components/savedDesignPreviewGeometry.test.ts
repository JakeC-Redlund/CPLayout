import assert from "node:assert/strict";
import test from "node:test";
import { convertPivotProjectToFieldDesign, reduceDraftDrawingWorkflow, sampleProject, serializeDesignDraftDocument, serializeFieldDesignDocument, serializeProjectDocument } from "@cplayout/core";
import type { WorkspaceDesignRead } from "@cplayout/project-store";
import { newDesignDraft } from "../newDesignDraft";
import { savedDesignPreviewGeometry } from "./savedDesignPreviewGeometry";

const common = {
  workspaceRevision: 12,
  context: { clientId: "client", projectId: "folder", fieldMapId: "map", designId: "design" },
};
const record = { id: "design", fieldMapId: "map", name: "Saved", isActive: true, revision: 3, createdAt: "2026-09-29T00:00:00Z", updatedAt: "2026-09-29T00:00:00Z" };
function draftRead(points: Array<{ x: number; y: number }> = []): Extract<WorkspaceDesignRead, { kind: "draft" }> {
  const draft = newDesignDraft("draft", "Saved", "metric");
  if (points.length) draft.projectCrs = "LOCAL:METERS";
  draft.fieldBoundary = points;
  return { ...common, kind: "draft", design: { ...record, kind: "draft", draftId: draft.id }, document: serializeDesignDraftDocument(draft), draft };
}

test("empty saved drafts have no invented geometry", () => {
  assert.deepEqual(savedDesignPreviewGeometry(draftRead(), "design", 3), { status: "empty", label: "Draft", shapes: [] });
});

test("saved one, two and three point drafts remain exact points/open paths, without mutation", () => {
  const points = [{ x: 120, y: 300 }, { x: 250, y: 440 }, { x: 190, y: 510 }];
  for (const count of [1, 2, 3]) {
    const read = draftRead(points.slice(0, count));
    const before = JSON.stringify(read);
    const preview = savedDesignPreviewGeometry(read, "design", 3);
    assert.equal(preview.status, "ready");
    assert.deepEqual(preview.shapes[0], count === 1
      ? { kind: "point", point: points[0], role: "boundary" }
      : { kind: "path", points: points.slice(0, count), closed: false, role: "boundary" });
    assert.equal(JSON.stringify(read), before);
  }
});

test("preview reparses the saved document instead of accepting editor-like parsed geometry", () => {
  const read = draftRead([{ x: 10, y: 20 }]);
  read.draft.fieldBoundary = [{ x: 999, y: 999 }];
  assert.deepEqual(savedDesignPreviewGeometry(read, "design", 3).shapes[0], { kind: "point", point: { x: 10, y: 20 }, role: "boundary" });
});

test("retained draft capture vertices use their exact point coordinates without closing unfinished areas", () => {
  const read = draftRead();
  read.draft.projectCrs = "LOCAL:METERS";
  let workflow = reduceDraftDrawingWorkflow(undefined, "LOCAL:METERS", { type: "begin", id: "capture", name: "Area", geometryType: "Polygon" });
  const points = [{ x: 10, y: 20 }, { x: 50, y: 20 }];
  for (const point of points) workflow = reduceDraftDrawingWorkflow(workflow, "LOCAL:METERS", {
    type: "append_vertex", id: "capture", vertex: { point, recordedAt: "2026-09-29T12:00:00Z", wgs84: null, elevation: null },
  });
  read.draft.drawingWorkflow = workflow;
  read.document = serializeDesignDraftDocument(read.draft);
  const before = JSON.stringify(read);
  const preview = savedDesignPreviewGeometry(read, "design", 3);
  assert.equal(preview.status, "ready");
  assert.deepEqual(preview.shapes, [{ kind: "path", points, closed: false, role: "feature" }]);
  assert.equal(JSON.stringify(read), before);
});

test("different design, revision, document identity and unsupported documents fail closed", () => {
  const read = draftRead();
  assert.equal(savedDesignPreviewGeometry(read, "other", 3).status, "unavailable");
  assert.equal(savedDesignPreviewGeometry(read, "design", 4).status, "unavailable");
  assert.equal(savedDesignPreviewGeometry({ ...read, context: { ...read.context, designId: "other" } }, "design", 3).status, "unavailable");
  assert.equal(savedDesignPreviewGeometry({ ...read, design: { ...read.design, draftId: "other" } }, "design", 3).status, "unavailable");
  assert.equal(savedDesignPreviewGeometry({ ...read, document: '{"documentVersion":"future"}' }, "design", 3).status, "unavailable");
  assert.equal(savedDesignPreviewGeometry({ kind: "not_found", workspaceRevision: 13 }, "design", 3).status, "unavailable");
});

test("saved project and field previews preserve exact stored boundary and documents", () => {
  const project = structuredClone(sampleProject);
  const field = convertPivotProjectToFieldDesign(serializeProjectDocument(project), { fieldId: "field", waterSourceId: "water", powerSourceId: "power" }).field;
  const reads: WorkspaceDesignRead[] = [
    { ...common, kind: "project", design: { ...record, kind: "project", pivotProjectId: project.id }, document: serializeProjectDocument(project), project },
    { ...common, kind: "field", design: { ...record, kind: "field", fieldDesignId: field.id }, document: serializeFieldDesignDocument(field), field },
  ];
  for (const read of reads) {
    const before = JSON.stringify(read);
    const preview = savedDesignPreviewGeometry(read, "design", 3);
    assert.equal(preview.status, "ready");
    assert.deepEqual(preview.shapes[0], { kind: "path", points: project.fieldBoundary, closed: true, role: "boundary" });
    assert.equal(JSON.stringify(read), before);
  }
});
