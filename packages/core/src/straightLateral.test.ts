import assert from "node:assert/strict";
import test from "node:test";
import { validateStraightLateralMachine, type StraightLateralMachine } from "./straightLateral";
import { createStraightLateralCalculationInput } from "./straightLateralCalculationInput";
import { convertPivotProjectToFieldDesign } from "./fieldDesignDocument";
import { sampleProject } from "./sampleProject";

function machine(): StraightLateralMachine {
  return { id: "linear", kind: "straight_lateral", name: "Explicit straight lateral", leftExtentMeters: 10,
    rightExtentMeters: 20, travelHeadingDegrees: 0, travel: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    machineClearanceBufferMeters: 2, waterSourceId: "water" };
}
function fixture() {
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), {
    fieldId: "linear-field", waterSourceId: "water", powerSourceId: "power",
  }).field;
  field.lateralMachines = [machine()];
  field.obstacles = [];
  return field;
}
const request = { machineId: "linear", inputRevision: 5, expectedRevision: 5 };

test("straight lateral storage requires explicit dimensions and supports asymmetric one-sided equipment", () => {
  const original = machine();
  const admitted = validateStraightLateralMachine(original);
  assert.deepEqual(admitted, original);
  assert.notStrictEqual(admitted.travel, original.travel);
  assert.equal(admitted.sprinklerReachMeters, undefined);
  assert.equal(admitted.powerSourceId, undefined);
  assert.doesNotThrow(() => validateStraightLateralMachine({ ...original, leftExtentMeters: 0 }));
  for (const key of ["id", "kind", "name", "leftExtentMeters", "rightExtentMeters", "travelHeadingDegrees", "travel", "machineClearanceBufferMeters"]) {
    const invalid: Record<string, unknown> = { ...original };
    delete invalid[key];
    assert.throws(() => validateStraightLateralMachine(invalid), key);
  }
});

test("bends, arbitrary guidance, relabeled pivots, defaults and unknown data cannot enter the model", () => {
  const original = machine();
  for (const patch of [{ kind: "center_pivot" }, { kind: "bender" }, { kind: "lateral_move" },
    { leftExtentMeters: 0, rightExtentMeters: 0 }, { rightExtentMeters: -1 }, { sprinklerReachMeters: undefined },
    { travelHeadingDegrees: 360 }, { travelHeadingDegrees: Infinity }, { machineClearanceBufferMeters: NaN },
    { travel: [original.travel.start, { x: 50, y: 1 }, original.travel.end] },
    { travel: { ...original.travel, guidanceVertices: [original.travel.start, original.travel.end] } },
    { travel: { start: original.travel.start, end: original.travel.start } }, { futureModel: true },
    { cornerArm: { lengthMeters: 10 } }, { driveType: "invented_default" }]) {
    assert.throws(() => validateStraightLateralMachine({ ...original, ...patch }));
  }
  let invoked = false;
  assert.throws(() => validateStraightLateralMachine(Object.defineProperty({ ...original }, "name", {
    enumerable: true, get() { invoked = true; return "bad"; },
  })));
  assert.equal(invoked, false);
});

test("water association is required for calculation while missing electrical supply remains unknown", () => {
  const field = fixture();
  const ready = createStraightLateralCalculationInput(field, request);
  assert.equal(ready.status, "ready");
  assert.equal(ready.powerSource, undefined);
  assert.equal(ready.waterSource?.id, "water");
  assert(ready.unknowns.includes("drive_power_requirement"));
  assert(ready.unknowns.includes("hydraulic_capacity"));
  assert(ready.unknowns.includes("machine_pair_clearance"));
  delete field.lateralMachines![0].waterSourceId;
  const unknown = createStraightLateralCalculationInput(field, request);
  assert.equal(unknown.status, "unsupported");
  assert(unknown.blockers.some(blocker => blocker.code === "water_source_missing"));
  assert.equal(unknown.waterSource, undefined);
});

test("heading mismatch, stale revisions and wrong machine classes reject without rotating XY", () => {
  const field = fixture();
  field.lateralMachines![0].travelHeadingDegrees = 90;
  const before = JSON.stringify(field);
  const input = createStraightLateralCalculationInput(field, request);
  assert.equal(input.status, "unsupported");
  assert(input.blockers.some(blocker => blocker.code === "travel_heading_mismatch"));
  assert.equal(JSON.stringify(field), before);
  assert.throws(() => createStraightLateralCalculationInput(field, { ...request, expectedRevision: 4 }), /revision changed/);
  assert.throws(() => createStraightLateralCalculationInput(field, { ...request, machineId: field.machines[0].id }), /not found/);
});

test("metric context is explicit, unchanged and never becomes hydraulic or field accuracy evidence", () => {
  const field = fixture();
  field.projectCrs = "LOCAL:linears";
  assert.equal(createStraightLateralCalculationInput(field, request).status, "unsupported");
  const local = { localMetricDeclaration: { projectCrs: field.projectCrs, unit: "metre" as const,
    axes: "orthogonal_xy" as const, evidenceReference: "operator declaration" } };
  const ready = createStraightLateralCalculationInput(field, { ...request, crsOptions: local });
  assert.equal(ready.status, "ready");
  assert.equal(ready.field.projectCrs, "LOCAL:linears");
  assert.deepEqual(ready.machine.travel, field.lateralMachines![0].travel);
  assert.equal(ready.crsQualification.field.qualified, false);
  assert.equal(ready.crsQualification.field.accuracy3dQualified, false);
  local.localMetricDeclaration.evidenceReference = "Changed caller";
  assert.notDeepEqual(ready.crsOptions, local);
  field.projectCrs = "EPSG:3857";
  assert(createStraightLateralCalculationInput(field, request).blockers.some(blocker => blocker.code === "web_mercator_display_only"));
});

test("finite but overflowing input and topology budgets refuse computation", () => {
  const field = fixture();
  field.lateralMachines![0].leftExtentMeters = Number.MAX_VALUE;
  const overflow = createStraightLateralCalculationInput(field, request);
  assert.equal(overflow.status, "unsupported");
  assert(overflow.blockers.some(blocker => blocker.code === "geometry_coordinate_resolution"));
  field.lateralMachines![0] = machine();
  field.fieldBoundary = Array.from({ length: 2049 }, (_, index) => ({ x: index, y: index % 2 }));
  assert(createStraightLateralCalculationInput(field, request).blockers.some(blocker => blocker.code === "geometry_vertex_budget"));
  field.fieldBoundary = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }];
  assert(createStraightLateralCalculationInput(field, request).blockers.some(blocker => blocker.code === "self_intersection"));
  const unresolved = fixture();
  unresolved.lateralMachines![0].leftExtentMeters = 1e-20;
  assert(createStraightLateralCalculationInput(unresolved, request).blockers.some(blocker => blocker.code === "geometry_dimension_resolution"));
});
