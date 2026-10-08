import assert from "node:assert/strict";
import { test } from "node:test";
import { convertPivotProjectToFieldDesign, createFieldLayoutTarget, sampleProject, serializeFieldLayoutTarget, serializeProjectDocument } from "@cplayout/core";
import { layoutCoordinateLabel, layoutErrorMessage, layoutSessionFilename, layoutTargetViewport } from "./layoutSessionViewModel";

function fixture(projectCrs = "EPSG:32613") {
  const field = convertPivotProjectToFieldDesign(serializeProjectDocument(sampleProject), { fieldId: "layout-view-field", waterSourceId: "water", powerSourceId: "power" }).field;
  field.projectCrs = projectCrs;
  return createFieldLayoutTarget(field, { inputRevision: 8, expectedRevision: 8, selectedMachineIds: [field.machines[0].id] });
}

test("Layout viewport and unit display preserve exact target bytes", () => {
  const target = fixture();
  const original = serializeFieldLayoutTarget(target);
  const view = layoutTargetViewport(target);
  for (const point of target.field.fieldBoundary) {
    const display = view.point(point);
    assert(Number.isFinite(display.x) && Number.isFinite(display.y));
    assert(display.x >= 27 && display.x <= view.width - 27);
    assert(display.y >= 27 && display.y <= view.height - 27);
    assert.match(layoutCoordinateLabel(point, target), /ft/);
  }
  assert.equal(serializeFieldLayoutTarget(target), original);
  assert(Object.isFrozen(target.field.fieldBoundary));
});

test("unknown LOCAL units remain unknown in Layout rather than being called feet", () => {
  const target = fixture("LOCAL:feet-in-name-is-not-unit-evidence");
  assert.equal(layoutCoordinateLabel({ x: 123.4, y: 56.7 }, target), "X 123.400 · Y 56.700 (coordinate units unconfirmed)");
});

test("Layout projection preserves axis direction and scales both axes equally", () => {
  const view = layoutTargetViewport(fixture());
  const origin = view.point({ x: 0, y: 0 });
  const east = view.point({ x: 1, y: 0 });
  const north = view.point({ x: 0, y: 1 });
  assert(east.x > origin.x);
  assert(north.y < origin.y);
  assert(Math.abs((east.x - origin.x) - (origin.y - north.y)) < 1e-8);
});

test("Layout export filenames cannot escape the chosen download name", () => {
  assert.equal(layoutSessionFilename("../../North / field: 1", "zip"), "North-field-1.layout.zip");
  assert.equal(layoutSessionFilename("...", "json"), "layout-session.layout.json");
  assert.equal(layoutSessionFilename("A".repeat(200), "json").length, 92);
});

test("revision errors offer reload while keeping entered text", () => {
  assert.match(layoutErrorMessage(new Error("Workspace revision conflict")), /Reload saved work.*entered text has been kept/);
  assert.equal(layoutErrorMessage(new Error("Storage quota exceeded")), "Storage quota exceeded");
});
