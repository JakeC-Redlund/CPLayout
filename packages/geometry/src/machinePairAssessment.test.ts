import assert from "node:assert/strict";
import test from "node:test";
import type { FieldDesign, FieldPivotMachine, StraightLateralMachine, XY } from "@cplayout/core";
import { evaluateFieldMachinePairs, machinePairAssessmentMatches } from "./machinePairAssessment";

const xy = (x: number, y: number): XY => ({ x, y });
function fixture(): FieldDesign {
  return { id: "pairs", name: "Mechanical pairs", projectCrs: "EPSG:32613", unitSystem: "us_survey_feet",
    fieldBoundary: [xy(-500, -500), xy(500, -500), xy(500, 500), xy(-500, 500)], machines: [], lateralMachines: [],
    infrastructure: [{ id: "water", kind: "water_source", point: xy(0, 0) }, { id: "power", kind: "power_source", point: xy(0, 0) }],
    obstacles: [], surveyPoints: [], mapFeatures: [] };
}
function lateral(id: string, y = 0): StraightLateralMachine {
  return { id, name: id, kind: "straight_lateral", leftExtentMeters: 10, rightExtentMeters: 20,
    travelHeadingDegrees: 0, travel: { start: xy(0, y), end: xy(100, y) }, machineClearanceBufferMeters: 2, waterSourceId: "water" };
}
function pivot(id: string, center: XY, radius = 20): FieldPivotMachine {
  return { id, kind: "center_pivot", pivotCenter: center, waterSourceId: "water", powerSourceId: "power",
    configuration: { name: id, spanLengthsMeters: [radius], overhangMeters: 0, endGunThrowMeters: 500,
      towerClearanceBufferMeters: 0, machineClearanceBufferMeters: 2, sweep: { mode: "full_circle" } } };
}
function pair(field: FieldDesign, gap = 0) {
  const result = evaluateFieldMachinePairs(field, { inputRevision: 4, expectedRevision: 4, minimumGapMeters: gap });
  assert.equal(result.status, "evaluated", JSON.stringify(result));
  assert.equal(result.pairs.length, 1);
  assert.equal(result.operatingSchedule, "not_assessed");
  assert.equal(result.fieldQualified, false);
  return result.pairs[0];
}

test("unequal laterals apply the greatest pair gap once and conservatively classify exact contact", () => {
  for (const delta of [-0.00001, 0, 0.00001]) {
    const f = fixture(); f.lateralMachines = [lateral("A"), { ...lateral("B", 34 + delta), machineClearanceBufferMeters: 3 }];
    const row = pair(f, 4);
    assert.equal(row.requiredGapMeters, 4);
    assert(Math.abs(row.minimumEnvelopeDistanceMeters! - (4 + delta)) < 1e-10);
    assert.equal(row.status, delta > 0 ? "separated" : "possible_sweep_overlap");
  }
});

test("crossed and wholly nested travel rectangles cannot hide an overlap between endpoints", () => {
  const f = fixture(); const crossing = lateral("B");
  crossing.travel = { start: xy(50, -100), end: xy(50, 100) }; crossing.travelHeadingDegrees = 90;
  f.lateralMachines = [lateral("A"), crossing];
  assert.equal(pair(f).minimumEnvelopeDistanceMeters, 0);
  assert.equal(pair(f).status, "possible_sweep_overlap");
  f.lateralMachines[1] = { ...lateral("B"), leftExtentMeters: 2, rightExtentMeters: 2, travel: { start: xy(40, 0), end: xy(60, 0) } };
  assert.equal(pair(f).status, "possible_sweep_overlap");
});

test("pivot-lateral distance uses physical reach, never wet reach or field clipping", () => {
  const f = fixture(); f.lateralMachines = [lateral("lateral")]; f.machines = [pivot("pivot", xy(150, 0))];
  const before = structuredClone(f);
  const row = pair(f);
  assert.equal(row.minimumEnvelopeDistanceMeters, 30);
  assert.equal(row.status, "separated");
  assert.deepEqual(f, before);
  f.machines[0].pivotCenter = xy(122, 0);
  assert.equal(pair(f).status, "possible_sweep_overlap");
  f.machines[0].pivotCenter.x += 0.00001;
  assert.equal(pair(f).status, "separated");
  f.fieldBoundary = [xy(-10, -10), xy(10, -10), xy(10, 10), xy(-10, 10)];
  assert.equal(pair(f).minimumEnvelopeDistanceMeters! > 2, true, "Mechanical distance is not field-clipped");
});

test("diagonal rectangles use Euclidean edge distance, not bounding boxes", () => {
  const f = fixture(); const second = lateral("B", 34);
  second.travel = { start: xy(103, 34), end: xy(203, 34) };
  f.lateralMachines = [lateral("A"), second];
  assert.equal(pair(f).minimumEnvelopeDistanceMeters, 5, "Independent 3-4-5 corner distance");
});

test("a rigid rotation retains the independent 3-4-5 rectangle separation", () => {
  for (const heading of [30, 45, 130, 270]) {
    const f = fixture(); const second = lateral("B", 34);
    second.travel = { start: xy(103, 34), end: xy(203, 34) };
    f.lateralMachines = [lateral("A"), second];
    const angle = heading * Math.PI / 180;
    const rotate = (point: XY) => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) });
    for (const machine of f.lateralMachines) {
      machine.travelHeadingDegrees = heading;
      machine.travel = { start: rotate(machine.travel.start), end: rotate(machine.travel.end) };
    }
    assert(Math.abs(pair(f).minimumEnvelopeDistanceMeters! - 5) < 1e-10);
    assert.equal(pair(f).status, "separated");
  }
});

test("pair identity and distances are symmetric, stable under input order and projected translation", () => {
  const f = fixture(); f.lateralMachines = [lateral("Z"), lateral("A", 60)]; f.machines = [pivot("M", xy(200, 100))];
  const first = evaluateFieldMachinePairs(f, { inputRevision: 4 });
  f.lateralMachines.reverse();
  assert.deepEqual(evaluateFieldMachinePairs(f, { inputRevision: 4 }), first);
  for (const point of [...f.fieldBoundary, ...f.infrastructure.map(value => value.point), ...f.machines.map(value => value.pivotCenter),
    ...f.lateralMachines.flatMap(value => [value.travel.start, value.travel.end])]) { point.x += 524288; point.y += 4194304; }
  const translated = evaluateFieldMachinePairs(f, { inputRevision: 4 });
  assert.deepEqual(translated.pairs.map(({ numericalGuardMeters: _, ...value }) => value), first.pairs.map(({ numericalGuardMeters: _, ...value }) => value));
  assert(machinePairAssessmentMatches(first, { fieldId: "pairs", inputRevision: 4 }));
  assert(!machinePairAssessmentMatches(first, { fieldId: "pairs", inputRevision: 5 }));
});

test("unknown coordinate units, stale revisions and missing supply never become separation", () => {
  const f = fixture(); f.lateralMachines = [lateral("A"), lateral("B", 100)];
  assert.equal(evaluateFieldMachinePairs(f, { inputRevision: 4, expectedRevision: 5 }).status, "unsupported");
  f.projectCrs = "LOCAL:field";
  assert.equal(evaluateFieldMachinePairs(f, { inputRevision: 4 }).status, "unsupported");
  const crsOptions = { localMetricDeclaration: { projectCrs: f.projectCrs, unit: "metre" as const, axes: "orthogonal_xy" as const, evidenceReference: "explicit synthetic fixture" } };
  assert.equal(evaluateFieldMachinePairs(f, { inputRevision: 4, crsOptions }).pairs[0].status, "separated");
  f.projectCrs = "EPSG:32613"; delete f.lateralMachines[1].waterSourceId;
  assert.equal(pair(f).status, "unresolved");
  assert(pair(f).reasons.includes("water_source_missing"));
  assert.throws(() => evaluateFieldMachinePairs(f, { inputRevision: 4, minimumGapMeters: -1 }));
});

test("corners need complete motion evidence and partial pivots use a declared conservative full reach", () => {
  const f = fixture(); f.machines = [pivot("corner", xy(250, 0))]; f.lateralMachines = [lateral("lateral")];
  f.machines[0].configuration.cornerArm = { id: "corner-arm", name: "Synthetic corner", advisoryOnly: true,
    lengthMeters: 10, guidanceType: "unknown", sequencingType: "unknown", orientation: "unknown", confidence: "user_estimated",
    sourceRefs: [{ sourceId: "synthetic", limit: "Test configuration only" }] };
  assert.equal(pair(f).status, "unresolved");
  assert(pair(f).reasons.includes("corner_complete_motion_unresolved"));
  delete f.machines[0].configuration.cornerArm;
  assert.equal(pair(f).status, "separated");
  f.machines = [pivot("A", xy(0, 0), 30), pivot("B", xy(62, 0), 30)]; f.lateralMachines = [];
  f.machines[0].configuration.sweep = { mode: "partial_circle", startAngleDegrees: 90, stopAngleDegrees: 180, direction: "counterclockwise" };
  assert.equal(pair(f).minimumEnvelopeDistanceMeters, 2);
  assert.equal(pair(f).status, "possible_sweep_overlap");
});
