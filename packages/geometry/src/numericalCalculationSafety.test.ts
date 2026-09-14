import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertLayoutResultFinite,
  createProjectEditorState,
  evaluateProjectCalculationSafety,
  parseProjectDocument,
  PROJECT_CALCULATION_NUMERIC_BUDGET,
  ProjectCalculationSafetyError,
  serializeProjectDocument,
  defaultProjectSettings,
  type AdvisoryCornerArmConfig,
  type LayoutResult,
  type PivotProject,
} from "@cplayout/core";
import * as geometry from "./geometry";

function fixture(): PivotProject {
  return {
    id: "numerical-admission", name: "Synthetic numerical admission", projectCrs: "EPSG:32613", unitSystem: "metric",
    fieldBoundary: [{ x: 500000, y: 4400000 }, { x: 500200, y: 4400000 }, { x: 500200, y: 4400200 }, { x: 500000, y: 4400200 }],
    pivotCenter: { x: 500100, y: 4400100 }, waterSource: { x: 500090, y: 4400100 }, powerSource: { x: 500080, y: 4400100 },
    machine: {
      id: "synthetic-machine", name: "Synthetic machine", spanLengthsMeters: [30, 30], overhangMeters: 5,
      endGunThrowMeters: 0, towerClearanceBufferMeters: 0, machineClearanceBufferMeters: 0, sweep: { mode: "full_circle" },
    },
    obstacles: [], surveyPoints: [],
  };
}

function legacyProject(project = fixture()): PivotProject {
  return parseProjectDocument({ documentVersion: "pivot-project-v1", project });
}

const validResult = geometry.evaluateLayout(legacyProject());
const calculations: Record<string, (project: PivotProject) => unknown> = {
  layout: geometry.evaluateLayout,
  mechanical: geometry.evaluateMechanicalConflicts,
  paths: geometry.buildLayoutPathOverlays,
  pathSteps: (p) => geometry.buildLayoutPathOverlaysSteps(p).next(),
  corner: geometry.evaluateCornerArmPath,
  cornerSteps: (p) => geometry.evaluateCornerArmPathSteps(p).next(),
  clearance: geometry.evaluateMachineBoundaryClearance,
  conservativeWetCoverage: geometry.validateWetCoverageWithinField,
  geoJson: (p) => geometry.exportScenarioGeoJson(p, validResult),
};

for (const [name, span, pivot, code] of [
  ["area overflow", 1e155, { x: 500100, y: 4400100 }, "geometry_product_range"],
  ["generated coordinate overflow", 1e308, { x: Number.MAX_VALUE, y: 0 }, "non_finite_geometry_extent"],
] as const) {
  test(`legacy ${name} repro remains recoverable but cannot enter geometry calculations`, () => {
    const raw = fixture();
    raw.pivotCenter = { ...pivot };
    raw.machine.spanLengthsMeters = [span];
    raw.machine.overhangMeters = 0;
    const envelope = { documentVersion: "pivot-project-v1", project: raw };
    const before = structuredClone(envelope);
    const parsed = parseProjectDocument(JSON.stringify(envelope));
    const editor = createProjectEditorState(parsed);
    assert.equal(editor.lastError, null);
    assert.deepEqual(editor.project.pivotCenter, raw.pivotCenter);
    assert.deepEqual(editor.project.machine.spanLengthsMeters, [span]);
    const savedBefore = serializeProjectDocument(editor.project);
    for (const [entrypoint, calculate] of Object.entries(calculations)) {
      assert.throws(() => calculate(editor.project), (error: unknown) => {
        assert.ok(error instanceof ProjectCalculationSafetyError, entrypoint);
        assert.ok(error.blockers.some((issue) => issue.code === code), entrypoint);
        return true;
      });
    }
    assert.equal(serializeProjectDocument(editor.project), savedBefore);
    const recovered = parseProjectDocument(savedBefore);
    assert.deepEqual(recovered.pivotCenter, raw.pivotCenter);
    assert.deepEqual(recovered.fieldBoundary, raw.fieldBoundary);
    assert.deepEqual(recovered.machine.spanLengthsMeters, raw.machine.spanLengthsMeters);
    assert.deepEqual(envelope, before);
  });
}

test("aggregate overflow rejects even entrypoints that otherwise return empty results", () => {
  const raw = fixture();
  raw.machine.spanLengthsMeters = [Number.MAX_VALUE, Number.MAX_VALUE];
  const project = legacyProject(raw);
  for (const [name, calculate] of Object.entries(calculations)) {
    assert.throws(() => calculate(project), /non_finite_machine_distance/, name);
  }
});

test("CRS guard stays first, before reading numerical data or optional calculation arguments", () => {
  const project = new Proxy({ projectCrs: "LOCAL:TEST" }, {
    get(target, key) {
      if (key === "projectCrs") return target.projectCrs;
      throw new Error(`Unexpected numeric input read: ${String(key)}`);
    },
  }) as PivotProject;
  for (const [name, calculate] of Object.entries(calculations)) {
    assert.throws(() => calculate(project), /Metric planar calculations unavailable/i, name);
  }
  const unreadOptions = new Proxy({}, { get: () => { throw new Error("Unexpected option read"); } });
  assert.throws(() => geometry.evaluatePathBoundaryDistance(project, NaN, unreadOptions), /Metric planar calculations unavailable/i);
  assert.throws(() => geometry.buildLayoutPathOverlays(project, unreadOptions), /Metric planar calculations unavailable/i);
  assert.throws(() => geometry.evaluateCornerArmPath(project, unreadOptions), /Metric planar calculations unavailable/i);
});

test("typed NaN and Infinity cannot bypass the project numeric guard", () => {
  const mutate: Array<(project: PivotProject, value: number) => void> = [
    (p, n) => { p.pivotCenter.x = n; },
    (p, n) => { p.fieldBoundary[1].y = n; },
    (p, n) => { p.machine.spanLengthsMeters[0] = n; },
    (p, n) => { p.machine.overhangMeters = n; },
    (p, n) => { p.machine.endGunThrowMeters = n; },
    (p, n) => { p.machine.towerClearanceBufferMeters = n; },
    (p, n) => { p.machine.sweep = { mode: "partial_circle", startAngleDegrees: n, stopAngleDegrees: 90, direction: "counterclockwise" }; },
    (p, n) => { p.machine.endGunAngleRanges = [{ startAngleDegrees: 0, stopAngleDegrees: n, direction: "counterclockwise" }]; },
  ];
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const change of mutate) {
      const project = legacyProject();
      change(project, value);
      const before = structuredClone(project);
      for (const [name, calculate] of Object.entries(calculations)) {
        assert.throws(() => calculate(project), ProjectCalculationSafetyError, name);
      }
      assert.deepEqual(project, before);
    }
  }
});

// Full result hashes captured from the unmodified geometry implementation before
// adding this gate, so coordinate arrays as well as metrics must stay unchanged.
const baselineHashes = [
  [false, 0, "6cd5bf4b80c1123d3f44b000064b6dacfb80559ed0a766095da6bb6b0b5c2b0e"],
  [false, 15, "d732177c4b90d9c241a26afc31433a3e61ac6ef901d76de127598623a0f873c5"],
  [true, 0, "67eed4e4b1ede6e707a4e6dbf7dbd8f329b597f7d9e028382b73130db5116ae6"],
  [true, 15, "a205225f19a779db62415003d21af9c0744e176a80e3c5e36709f3dd3e9a2365"],
] as const;

for (const [partial, endGun, expectedHash] of baselineHashes) {
  test(`normal UTM output is unchanged: partial=${partial}, endGun=${endGun}`, () => {
    const raw = fixture();
    raw.machine.endGunThrowMeters = endGun;
    raw.machine.sweep = partial
      ? { mode: "partial_circle", startAngleDegrees: 330, stopAngleDegrees: 100, direction: "counterclockwise" }
      : { mode: "full_circle" };
    raw.machine.endGunAngleRanges = endGun ? [{ startAngleDegrees: 355, stopAngleDegrees: 70, direction: "counterclockwise" }] : [];
    const project = legacyProject(raw);
    const before = serializeProjectDocument(project);
    const result = geometry.evaluateLayout(project);
    assertLayoutResultFinite(result);
    assert.equal(createHash("sha256").update(JSON.stringify(result)).digest("hex"), expectedHash);
    assert.ok(result.metrics.fieldAcres > 0);
    assert.ok(result.metrics.irrigatedAcres > 0);
    assert.equal(result.metrics.endGunAcres > 0, endGun > 0);
    const wet = geometry.validateWetCoverageWithinField(project);
    assert.equal(createHash("sha256").update(JSON.stringify(wet)).digest("hex"), "83e08e5a87d9eb0be75b535486cd9b599f18b9a789ec8b0b72df529c4386d9dc");
    assert.equal(wet.feasible, true);
    assert.doesNotThrow(() => geometry.exportScenarioGeoJson(project, result));
    assert.equal(serializeProjectDocument(project), before);
  });
}

function assertAllNumbersFinite(value: unknown): void {
  if (typeof value === "number") assert.ok(Number.isFinite(value));
  else if (Array.isArray(value)) value.forEach(assertAllNumbersFinite);
  else if (value !== null && typeof value === "object") Object.values(value).forEach(assertAllNumbersFinite);
}

test("large numerically safe radius produces finite layout, circle area and conservative coverage", () => {
  const raw = fixture();
  raw.machine.spanLengthsMeters = [50000, 50000];
  raw.machine.overhangMeters = 1000;
  raw.machine.endGunThrowMeters = 5000;
  raw.machine.machineClearanceBufferMeters = 100;
  const project = legacyProject(raw);
  assert.equal(evaluateProjectCalculationSafety(project).allowed, true);
  const result = geometry.evaluateLayout(project);
  assertLayoutResultFinite(result);
  assert.ok(result.metrics.outsideFieldAcres > 0);
  const circle = geometry.createCirclePolygon(project.pivotCenter, geometry.endGunRadiusMeters(project.machine));
  const circleArea = geometry.polygonAreaSquareMeters(circle);
  assert.ok(Number.isFinite(circleArea) && circleArea > 0);
  const wet = geometry.validateWetCoverageWithinField(project);
  assertAllNumbersFinite(wet);
  assert.equal(wet.feasible, false);
  assert.ok(wet.outsideFieldAreaSquareMeters > 0);
  assert.equal(geometry.GEOMETRY_TOLERANCE_METERS, PROJECT_CALCULATION_NUMERIC_BUDGET.toleranceMeters);
});

test("geometry checks active preview and external clearance", () => {
  const project = legacyProject();
  const before = structuredClone(project);
  const corner: AdvisoryCornerArmConfig = { id: "corner", name: "Synthetic corner", advisoryOnly: true, lengthMeters: 30,
    guidanceType: "unknown", sequencingType: "unknown", orientation: "unknown", confidence: "user_estimated",
    sourceRefs: [{ sourceId: "synthetic-numerical-test", limit: "Regression fixture, not equipment evidence." }] };
  for (const value of [NaN, Infinity, 1e6, Number.MAX_VALUE]) {
    const cornerArmPreview = { ...corner, lengthMeters: value };
    assert.throws(() => geometry.evaluateCornerArmPath(project, { cornerArmPreview }), ProjectCalculationSafetyError);
    assert.throws(() => geometry.buildLayoutPathOverlaysSteps(project, { cornerArmPreview }).next(), ProjectCalculationSafetyError);
    const settings = defaultProjectSettings();
    settings.layoutReview.requiredBoundaryClearanceMeters = value;
    assert.throws(() => geometry.evaluateMachineBoundaryClearance(project, settings), ProjectCalculationSafetyError);
    assert.throws(() => geometry.evaluateCornerArmPath(project, { cornerArmPreview: corner, settings }), ProjectCalculationSafetyError);
  }
  const paths = geometry.buildLayoutPathOverlays(project, { cornerArmPreview: corner });
  assert.ok(paths.some((path) => path.kind === "corner_arm_wheel_track"));
  assertAllNumbersFinite(paths);
  const distance = geometry.evaluatePathBoundaryDistance(project, 80);
  assertAllNumbersFinite(distance);
  assert.ok(distance.minimumBoundaryDistanceMeters > 0);
  assert.deepEqual(project, before);
});

test("standalone normalized clearance validates only the geometry and radius it consumes", () => {
  const project = legacyProject();
  const expected = geometry.evaluatePathBoundaryDistance(project, 80);
  project.machine.spanLengthsMeters = [Number.MAX_VALUE, Number.MAX_VALUE];
  project.machine.overhangMeters = NaN;
  project.waterSource.x = Infinity;
  project.obstacles = [{ id: "unused", name: "Unused", polygon: [{ x: NaN, y: 0 }], bufferMeters: Infinity }];
  const before = structuredClone(project);
  assert.deepEqual(geometry.evaluatePathBoundaryDistance(project, 80), expected);
  assert.throws(() => geometry.evaluateLayout(project), ProjectCalculationSafetyError);
  assert.throws(() => geometry.evaluateMachineBoundaryClearance(project), ProjectCalculationSafetyError);
  assert.throws(() => geometry.buildLayoutPathOverlays(project), ProjectCalculationSafetyError);
  assert.deepEqual(project, before);
});

test("standalone clearance retains its own finite range and uncertainty contract", () => {
  const project = legacyProject();
  for (const radius of [-1, NaN, Infinity, -Infinity]) {
    assert.throws(() => geometry.evaluatePathBoundaryDistance(project, radius), /finite and nonnegative/);
  }
  assert.throws(() => geometry.evaluatePathBoundaryDistance(project, Number.MAX_VALUE), /supported finite numerical range/);
  for (const radius of [1e6, 1e100, Number.MAX_VALUE / 32]) {
    const result = geometry.evaluatePathBoundaryDistance(project, radius);
    assertAllNumbersFinite(result);
    assert.ok(result.lowerBoundMeters <= result.upperBoundMeters);
    assert.ok(result.errorBoundMeters >= 0);
    assert.ok(result.upperBoundMeters < 0);
  }
});

test("geometry export rejects nonfinite result geometry even when every metric is finite", () => {
  const project = legacyProject();
  for (const change of [
    (r: LayoutResult) => { r.metrics.outsideFieldAcres = NaN; },
    (r: LayoutResult) => { r.baseCoverage[0][0][0].x = Infinity; },
    (r: LayoutResult) => { r.allowedCoverage[0][0][0].y = NaN; },
    (r: LayoutResult) => { r.towers[0].point.x = Infinity; },
  ]) {
    const result = structuredClone(validResult);
    change(result);
    const before = structuredClone(result);
    assert.throws(() => geometry.exportScenarioGeoJson(project, result), /Layout result contains non-finite numeric data/);
    assert.deepEqual(result, before);
  }
});

test("evaluateLayout itself refuses a nonfinite result before returning to the App", () => {
  const project = legacyProject();
  // Fault injection after ordinary numeric admission: tower generation uses map,
  // while the input guard and radius calculations use forEach/reduce.
  Object.defineProperty(project.machine.spanLengthsMeters, "map", { value: () => [
    { towerIndex: 1, radiusMeters: 30, point: { x: Infinity, y: 4400100 } },
  ] });
  assert.equal(evaluateProjectCalculationSafety(project).allowed, true);
  assert.throws(() => geometry.evaluateLayout(project), /Layout result contains non-finite numeric data at towers.0.point.x/);
});
