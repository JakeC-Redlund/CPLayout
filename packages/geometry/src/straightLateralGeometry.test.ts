import assert from "node:assert/strict";
import test from "node:test";
import { convertPivotProjectToFieldDesign, sampleProject, type FieldDesign, type XY } from "@cplayout/core";
import { evaluateStraightLateral } from "./straightLateralGeometry";

const box = (minX: number, minY: number, maxX: number, maxY: number): XY[] => [
  { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY },
];
function fixture(): FieldDesign {
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), {
    fieldId: "linear-geometry", waterSourceId: "water", powerSourceId: "power",
  }).field;
  field.machines = [];
  field.obstacles = [];
  field.fieldBoundary = box(-50, -50, 150, 50);
  delete field.settings;
  field.lateralMachines = [{ id: "linear", kind: "straight_lateral", name: "Explicit unequal lateral",
    leftExtentMeters: 10, rightExtentMeters: 20, travelHeadingDegrees: 0,
    travel: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }, machineClearanceBufferMeters: 2,
    waterSourceId: "water", sprinklerReachMeters: 3 }];
  return field;
}
function evaluated(field = fixture()) {
  const result = evaluateStraightLateral(field, { machineId: "linear", inputRevision: 2, expectedRevision: 2 });
  assert.equal(result.status, "evaluated", JSON.stringify(result));
  if (result.status !== "evaluated") throw new Error("Expected explicit straight lateral evaluation.");
  return result;
}
function obstacle(field: FieldDesign, polygon: XY[], bufferMeters = 0, hardConflict = true, noSpray = false) {
  field.obstacles.push({ id: `obstacle-${field.obstacles.length}`, name: "Explicit obstacle", kind: "exclusion",
    polygon, bufferMeters, hardConflict, noSpray, confidence: "user_estimated" });
}

test("complete straight translation has analytic unequal-width rectangles, independent physical and wet areas", () => {
  const field = fixture();
  const before = structuredClone(field);
  const result = evaluated(field);
  assert.equal(result.travelLengthMeters, 100);
  assert.equal(result.physicalWidthMeters, 30);
  assert.equal(result.rawSweptSquareMeters, 100 * 30);
  assert.equal(result.bufferedSweptSquareMeters, (100 + 2 * 2) * (30 + 2 * 2));
  assert.deepEqual(result.startMember, [{ x: 0, y: 10 }, { x: 0, y: -20 }]);
  assert.deepEqual(result.endMember, [{ x: 100, y: 10 }, { x: 100, y: -20 }]);
  assert.equal(result.rawSweptEnvelope[0][0].length, 5, "Analytic closed rectangle, no circle sampling");
  assert.equal(result.boundaryConstraint.status, "within_boundary");
  assert.equal(result.mechanicalConstraints.status, "no_conflicts_in_rectangular_model");
  assert.equal(result.mechanicalConstraints.scope, "hard_obstacles_only");
  assert.equal(result.wet.status, "potential_rectangular_envelope");
  if (result.wet.status !== "potential_rectangular_envelope") throw new Error("Expected explicit potential wet reach.");
  assert.equal(result.wet.rawSquareMeters, (100 + 2 * 3) * (30 + 2 * 3));
  assert.equal(result.wet.clippedSquareMeters, result.wet.rawSquareMeters);
  assert.equal(result.fieldQualified, false);
  assert.equal(result.supply.powerSourceId, undefined);
  assert(result.unknowns.includes("application_uniformity"));
  assert(result.unknowns.includes("machine_pair_clearance"));
  assert.deepEqual(field, before);
});

test("unknown reach produces no fabricated wet area and explicit zero remains distinct", () => {
  const field = fixture();
  delete field.lateralMachines![0].sprinklerReachMeters;
  assert.deepEqual(evaluated(field).wet, { status: "unknown", reason: "sprinkler_reach_missing" });
  field.lateralMachines![0].sprinklerReachMeters = 0;
  const wet = evaluated(field).wet;
  assert.equal(wet.status, "potential_rectangular_envelope");
  if (wet.status === "potential_rectangular_envelope") assert.equal(wet.rawSquareMeters, 3000);
});

test("whole-member mid-travel conflicts and exact buffer contact cannot hide between endpoints", () => {
  const field = fixture();
  obstacle(field, box(40, 9, 50, 11));
  assert.equal(evaluated(field).mechanicalConstraints.conflicts.length, 1);
  for (const delta of [-0.00001, 0, 0.00001]) {
    field.obstacles = [];
    obstacle(field, box(40, 12.5 + delta, 50, 13.5 + delta), 0.5);
    const result = evaluated(field);
    assert.equal(result.mechanicalConstraints.conflicts.length, delta <= 0 ? 1 : 0);
    if (delta === 0) {
      assert.equal(result.mechanicalConstraints.conflicts[0].combinedBufferMeters, 2.5);
      assert.equal(result.mechanicalConstraints.conflicts[0].overlapSquareMeters, 0);
      assert.equal(result.mechanicalConstraints.conflicts[0].touches, true);
    }
  }
  field.obstacles = [];
  obstacle(field, box(-10, -30, 110, 30));
  assert.equal(evaluated(field).mechanicalConstraints.conflicts.length, 1, "Contained whole machine conflicts without edge crossings");
});

test("field clipping and no-spray holes stay separate from hard machine constraints", () => {
  const field = fixture();
  field.fieldBoundary = box(0, -20, 100, 10);
  obstacle(field, box(40, -5, 60, 5), 0, false, true);
  const result = evaluated(field);
  assert.equal(result.mechanicalConstraints.conflicts.length, 0);
  assert.equal(result.boundaryConstraint.status, "outside_boundary");
  assert.equal(result.boundaryConstraint.outsideSquareMeters, 3536 - 3000);
  assert.equal(result.wet.status, "potential_rectangular_envelope");
  if (result.wet.status !== "potential_rectangular_envelope") throw new Error("Expected wet report.");
  assert.equal(result.wet.rawSquareMeters, 3816);
  assert.equal(result.wet.outsideSquareMeters, 816);
  assert.equal(result.wet.blockedNoSpraySquareMeters, 200);
  assert.equal(result.wet.clippedSquareMeters, 2800);
  assert.equal(result.wet.clippedCoverage[0].length, 2, "No-spray polygon becomes a retained hole");
  assert.equal(result.wet.rawSquareMeters, result.wet.outsideSquareMeters + result.wet.blockedNoSpraySquareMeters + result.wet.clippedSquareMeters);
});

test("concave boundary tests complete motion and stored required clearance applies once", () => {
  const field = fixture();
  field.lateralMachines![0].machineClearanceBufferMeters = 0;
  field.fieldBoundary = [{ x: -50, y: -50 }, { x: 150, y: -50 }, { x: 150, y: 50 }, { x: 60, y: 50 },
    { x: 60, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 50 }, { x: -50, y: 50 }];
  const concave = evaluated(field);
  assert.equal(concave.boundaryConstraint.status, "outside_boundary");
  assert.equal(concave.boundaryConstraint.outsideSquareMeters, 200);
  field.fieldBoundary = box(-2, -22, 102, 12);
  field.lateralMachines![0].machineClearanceBufferMeters = 2;
  assert.equal(evaluated(field).boundaryConstraint.status, "within_boundary");
  field.settings = JSON.parse(JSON.stringify(sampleProject.settings!));
  field.settings!.layoutReview.requiredBoundaryClearanceMeters = 1;
  const withClearance = evaluated(field);
  assert.equal(withClearance.boundaryConstraint.requiredClearanceMeters, 1);
  assert.equal(withClearance.boundaryConstraint.outsideSquareMeters, 106 * 36 - 104 * 34);
});

test("rotation and large translated XY preserve finite analytic rectangle dimensions", () => {
  for (const heading of [0, 90, 180, 270, 45, 13, 30]) {
    for (const offset of [0, 1e9, -1e9]) {
      const field = fixture();
      const radians = heading * Math.PI / 180;
      const transform = (point: XY): XY => ({
        x: offset + point.x * Math.cos(radians) - point.y * Math.sin(radians),
        y: -offset + point.x * Math.sin(radians) + point.y * Math.cos(radians),
      });
      field.fieldBoundary = field.fieldBoundary.map(transform);
      const machine = field.lateralMachines![0];
      machine.travel = { start: transform(machine.travel.start), end: transform(machine.travel.end) };
      machine.travelHeadingDegrees = heading;
      const result = evaluated(field);
      assert(Math.abs(result.rawSweptSquareMeters - 3000) < 0.00001);
      assert(Math.abs(result.bufferedSweptSquareMeters - 3536) < 0.00001);
      assert.equal(result.boundaryConstraint.status, "within_boundary");
      for (const point of result.rawSweptEnvelope.flat(2)) assert(Number.isFinite(point.x) && Number.isFinite(point.y));
    }
  }
});

test("reversing direction with swapped physical sides preserves the swept region", () => {
  const field = fixture();
  const before = evaluated(field);
  const machine = field.lateralMachines![0];
  [machine.travel.start, machine.travel.end] = [machine.travel.end, machine.travel.start];
  [machine.leftExtentMeters, machine.rightExtentMeters] = [machine.rightExtentMeters, machine.leftExtentMeters];
  machine.travelHeadingDegrees = 180;
  const reversed = evaluated(field);
  assert.equal(reversed.rawSweptSquareMeters, before.rawSweptSquareMeters);
  const keys = (points: XY[]) => [...new Set(points.map(point => JSON.stringify(point)))].sort();
  assert.deepEqual(keys(reversed.rawSweptEnvelope[0][0]), keys(before.rawSweptEnvelope[0][0]));
});

test("unsupported bend input, mismatched heading, missing water and huge XY never produce false clearance", () => {
  const field = fixture();
  const machine = field.lateralMachines![0];
  (machine.travel as unknown as Record<string, unknown>).vertices = [{ x: 0, y: 0 }, { x: 50, y: 2 }, { x: 100, y: 0 }];
  assert.throws(() => evaluated(field));
  delete (machine.travel as unknown as Record<string, unknown>).vertices;
  machine.travelHeadingDegrees = 1;
  const mismatch = evaluateStraightLateral(field, { machineId: "linear", inputRevision: 0 });
  assert.equal(mismatch.status, "unsupported");
  machine.travelHeadingDegrees = 0;
  delete machine.waterSourceId;
  assert.equal(evaluateStraightLateral(field, { machineId: "linear", inputRevision: 0 }).status, "unsupported");
  machine.waterSourceId = "water";
  machine.travel.end.x = 1e200;
  const huge = evaluateStraightLateral(field, { machineId: "linear", inputRevision: 0 });
  assert.equal(huge.status, "unsupported");
  if (huge.status === "unsupported") assert(huge.blockers.some(blocker => blocker.code === "geometry_coordinate_resolution"));
});
