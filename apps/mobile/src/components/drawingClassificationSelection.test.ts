import assert from "node:assert/strict";
import { test } from "node:test";
import { createDesignDraftEditorState, reduceDesignDraftEditorState, type DesignDraft, type DraftDrawingCapture } from "@cplayout/core";
import { newDesignDraft } from "../newDesignDraft";
import { classificationForSelection, drawingSelectionReplaces, drawingSelections } from "./drawingClassificationSelection";

function capture(geometryType: DraftDrawingCapture["geometryType"] = "Polygon"): DraftDrawingCapture {
  return { id: "drawing", name: "Field boundary", geometryType, stage: "classification", projectCrs: "EPSG:32613", source: "map_digitized",
    vertices: (geometryType === "Polygon" ? [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }] : geometryType === "Point" ? [{ x: 2, y: 3 }] : [{ x: 2, y: 3 }, { x: 20, y: 25 }])
      .map(point => ({ point, recordedAt: "2026-09-28T00:00:00Z", elevation: null, wgs84: null })),
    classification: { purposeId: null, name: "Field boundary", notes: "" } };
}
function draft(): DesignDraft { return { ...newDesignDraft("draft", "Test", "us_survey_feet"), projectCrs: "EPSG:32613" }; }

test("every dropdown option builds a valid selection without a second form", () => {
  for (const geometry of ["Polygon", "LineString", "Point"] as const) {
    for (const option of drawingSelections(geometry)) {
      const selection = classificationForSelection(capture(geometry), option.id);
      assert.equal(selection.geometryType, geometry);
      assert.equal(selection.assetStatus, "unknown");
      assert.equal(selection.name, option.label);
    }
  }
});
test("exclusion menu choices state exactly which effects they apply", () => {
  const source = capture();
  assert.deepEqual(classificationForSelection(source, "exclusion_no_spray").effect, { mode: "exclusion", noSpray: true, hardConflict: false, bufferMeters: 0 });
  assert.deepEqual(classificationForSelection(source, "exclusion_machine").effect, { mode: "exclusion", noSpray: false, hardConflict: true, bufferMeters: 0 });
  assert.deepEqual(classificationForSelection(source, "exclusion_both").effect, { mode: "exclusion", noSpray: true, hardConflict: true, bufferMeters: 0 });
  assert.deepEqual(classificationForSelection(source, "building_footprint").effect, { mode: "informational" });
  assert.throws(() => classificationForSelection(source, "exclusion_area"));
});
test("saved draft names and notes remain exact", () => {
  const source = capture(); source.classification = { purposeId: "area_measurement", name: "Retained custom name", notes: "Retained notes" };
  const selection = classificationForSelection(source, "crop_zone");
  assert.equal(selection.name, "Retained custom name"); assert.equal(selection.notes, "Retained notes");
});
test("only replacing saved locations requires explicit replacement", () => {
  const source = draft();
  const selection = classificationForSelection(capture(), "field_boundary");
  assert.equal(drawingSelectionReplaces(source, selection), false);
  source.fieldBoundary = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }];
  assert.equal(drawingSelectionReplaces(source, selection), true);
  assert.equal(drawingSelectionReplaces(source, classificationForSelection(capture(), "area_measurement")), false);
});
test("a single purpose choice commits geometry and metadata atomically with undo", () => {
  const drawing = capture();
  const source = { ...draft(), drawingWorkflow: { schemaVersion: "draft-drawing-workflow-v1" as const,
    autosaveEnabled: true, activeCaptureId: drawing.id, lockedCrs: drawing.projectCrs, captures: [drawing] } };
  const before = createDesignDraftEditorState(source);
  const after = reduceDesignDraftEditorState(before, { type: "commit_classified_drawing", expectedRevision: before.revision,
    captureId: drawing.id, classification: classificationForSelection(drawing, "area_measurement"), entityId: "feature", replaceExisting: false });
  assert.equal(after.lastError, null); assert.equal(after.revision, before.revision + 1);
  assert.equal(after.draft.mapFeatures?.[0].name, "Area measurement");
  assert.deepEqual(after.draft.drawingWorkflow?.captures, []);
  assert.deepEqual(reduceDesignDraftEditorState(after, { type: "undo" }).draft, before.draft);
});
