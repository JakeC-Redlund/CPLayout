import assert from "node:assert/strict";
import test from "node:test";

import { qualifyProjectCrs } from "./crsQualification";
import { evaluateDesignDraftCompleteness, type DesignDraft } from "./designDraft";
import {
  assertLayoutResultFinite,
  assertProjectCalculationSafe,
  evaluateProjectCalculationSafety,
  isBoundaryWithinCalculationBudget,
  PROJECT_CALCULATION_NUMERIC_BUDGET,
  ProjectCalculationSafetyError,
} from "./projectCalculationSafety";
import { parseProjectDocument, serializeProjectDocument } from "./projectDocument";
import { defaultProjectSettings } from "./settings";
import type { AdvisoryCornerArmConfig, LayoutResult, PivotProject } from "./types";

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

function corner(): AdvisoryCornerArmConfig {
  return { id: "corner", name: "Synthetic corner", advisoryOnly: true, lengthMeters: 30, guidanceType: "unknown",
    sequencingType: "unknown", orientation: "unknown", confidence: "user_estimated",
    sourceRefs: [{ sourceId: "synthetic-numerical-test", limit: "Regression fixture, not equipment evidence." }] };
}

test("numerical admission is read-only and independent of schema and CRS qualification", () => {
  const project = fixture();
  project.projectCrs = "LOCAL:TEST";
  const before = structuredClone(project);
  Object.freeze(project.machine.spanLengthsMeters);
  Object.freeze(project.machine);
  Object.freeze(project);
  assert.deepEqual(evaluateProjectCalculationSafety(project), { allowed: true, blockers: [] });
  assert.doesNotThrow(() => assertProjectCalculationSafe(project));
  assert.equal(qualifyProjectCrs(project.projectCrs).calculation.allowed, false);
  assert.deepEqual(project, before);
  assert.equal(Object.hasOwn(project, "settings"), false);
  assert.equal(Object.hasOwn(project.machine, "endGunAngleRanges"), false);
});

const unsafeCases = [
  { name: "span sum overflow", spans: [Number.MAX_VALUE, Number.MAX_VALUE], overhang: 0, endGun: 0, code: "non_finite_machine_distance", path: "machine.spanLengthsMeters" },
  { name: "overhang sum overflow", spans: [Number.MAX_VALUE], overhang: Number.MAX_VALUE, endGun: 0, code: "non_finite_machine_distance", path: "machine.overhangMeters" },
  { name: "end-gun sum overflow", spans: [Number.MAX_VALUE], overhang: 0, endGun: Number.MAX_VALUE, code: "non_finite_machine_distance", path: "machine.endGunThrowMeters" },
  { name: "area overflow repro", spans: [1e155], overhang: 0, endGun: 0, code: "geometry_product_range" },
  { name: "generated XY overflow repro", spans: [1e308], overhang: 0, endGun: 0, code: "non_finite_geometry_extent", pivotX: Number.MAX_VALUE },
];

for (const entry of unsafeCases) {
  test(`${entry.name} remains legacy-serializable and agrees with draft calculation blockers`, () => {
    const raw = fixture();
    raw.machine = { ...raw.machine, spanLengthsMeters: entry.spans, overhangMeters: entry.overhang, endGunThrowMeters: entry.endGun };
    if (entry.pivotX !== undefined) raw.pivotCenter = { x: entry.pivotX, y: 0 };
    const envelope = { documentVersion: "pivot-project-v1", project: raw };
    const before = structuredClone(envelope);
    const project = parseProjectDocument(envelope);
    const safety = evaluateProjectCalculationSafety(project);
    assert.equal(safety.allowed, false);
    assert.ok(safety.blockers.some((issue) => issue.code === entry.code && (entry.path === undefined || issue.path === entry.path)));
    assert.throws(() => assertProjectCalculationSafe(project), (error: unknown) => {
      assert.ok(error instanceof ProjectCalculationSafetyError);
      assert.deepEqual(error.blockers, safety.blockers);
      return true;
    });
    const recovered = parseProjectDocument(serializeProjectDocument(project));
    assert.deepEqual(recovered.machine, project.machine);
    assert.deepEqual(recovered.pivotCenter, raw.pivotCenter);
    assert.deepEqual(recovered.fieldBoundary, raw.fieldBoundary);
    assert.deepEqual(recovered.machine.spanLengthsMeters, raw.machine.spanLengthsMeters);
    assert.deepEqual(envelope, before);

    const settings = defaultProjectSettings();
    settings.unitSystem = "metric";
    const draft: DesignDraft = { ...raw, settings };
    const completeness = evaluateDesignDraftCompleteness(draft);
    assert.equal(completeness.complete, true);
    assert.deepEqual(completeness.blockers, []);
    assert.equal(completeness.calculationEligible, false);
    assert.deepEqual(completeness.calculationBlockers, safety.blockers);
  });
}

test("typed nonfinite scalar and XY inputs cannot disappear through NaN comparisons", () => {
  const mutations: Array<(project: PivotProject, value: number) => void> = [
    (p, n) => { p.machine.spanLengthsMeters[0] = n; },
    ...(["overhangMeters", "endGunThrowMeters", "towerClearanceBufferMeters", "machineClearanceBufferMeters"] as const).map((key) => (p: PivotProject, n: number) => { p.machine[key] = n; }),
    (p, n) => { p.pivotCenter.x = n; },
    (p, n) => { p.waterSource.y = n; },
    (p, n) => { p.powerSource.x = n; },
    (p, n) => { p.fieldBoundary[0].y = n; },
    (p, n) => { p.machine.sweep = { mode: "partial_circle", startAngleDegrees: n, stopAngleDegrees: 90, direction: "clockwise" }; },
    (p, n) => { p.machine.endGunAngleRanges = [{ startAngleDegrees: 0, stopAngleDegrees: n, direction: "clockwise" }]; },
    (p, n) => { p.machine.cornerArm = { ...corner(), lengthMeters: n }; },
    (p, n) => { p.machine.cornerArm = { ...corner(), wheelTrackLengthMeters: n }; },
    (p, n) => { p.machine.cornerArm = { ...corner(), minSteerAngleDegrees: n }; },
    (p, n) => { p.machine.cornerArm = { ...corner(), maxExtensionRateMetersPerMinute: n }; },
    (p, n) => { p.settings = defaultProjectSettings(); p.settings.layoutReview.requiredBoundaryClearanceMeters = n; },
    (p, n) => { p.obstacles = [{ id: "obstacle", name: "Obstacle", kind: "exclusion", polygon: p.fieldBoundary, bufferMeters: n, hardConflict: true, noSpray: true, confidence: "user_estimated" }]; },
    (p, n) => { p.mapFeatures = [{ id: "circle", name: "Circle", kind: "machine_zone", geometry: { type: "Circle", center: p.pivotCenter, radiusMeters: n }, confidence: "user_estimated" }]; },
    (p, n) => { p.surveyPoints = [{ id: "tail", label: "Tail", projected: { x: n, y: 0 }, role: "pivot_center", observedAt: "2026-09-14T00:00:00Z", source: "manual", confidence: "user_estimated" }]; },
  ];
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const mutate of mutations) {
      const project = fixture();
      mutate(project, value);
      const before = structuredClone(project);
      const safety = evaluateProjectCalculationSafety(project);
      assert.equal(safety.allowed, false);
      assert.ok(safety.blockers.some((issue) => issue.code === "non_finite_calculation_input"));
      assert.throws(() => assertProjectCalculationSafe(project), ProjectCalculationSafetyError);
      assert.deepEqual(project, before);
    }
  }
});

test("negative distances cannot cancel an otherwise unsafe numerical envelope", () => {
  const project = fixture();
  project.machine.spanLengthsMeters = [1e155, -1e155];
  assert.equal(evaluateProjectCalculationSafety(project).blockers[0]?.code, "invalid_calculation_distance");
});

test("corner, bender centers, map geometry and clearance extensions share the numerical domain", () => {
  const mutations: Array<(project: PivotProject) => void> = [
    (p) => { p.machine.cornerArm = { ...corner(), wheelTrackLengthMeters: Number.MAX_VALUE, overhangLengthMeters: Number.MAX_VALUE }; },
    (p) => { p.surveyPoints = [{ id: "tail", label: "Tail", projected: { x: 1e155, y: 0 }, role: "pivot_center", observedAt: "2026-09-14T00:00:00Z", source: "manual", confidence: "user_estimated" }]; },
    (p) => { p.mapFeatures = [{ id: "circle", name: "Circle", kind: "machine_zone", geometry: { type: "Circle", center: p.pivotCenter, radiusMeters: 1e6 }, confidence: "user_estimated" }]; },
    (p) => { p.mapFeatures = [{ id: "outline", name: "Outline", kind: "machine_zone", geometry: { type: "Polygon", vertices: [{ x: 0, y: 0 }, { x: 1e6, y: 0 }, { x: 0, y: 1e6 }] }, confidence: "user_estimated" }]; },
    (p) => { p.obstacles = [{ id: "obstacle", name: "Obstacle", kind: "exclusion", polygon: p.fieldBoundary, bufferMeters: 1e6, hardConflict: true, noSpray: true, confidence: "user_estimated" }]; },
    (p) => {
      const budget = PROJECT_CALCULATION_NUMERIC_BUDGET;
      const cosine = Math.cos(Math.PI / budget.maxConservativeSegments);
      const maximumSectorRadius = budget.toleranceMeters * cosine / (1 - cosine);
      p.machine.spanLengthsMeters = [maximumSectorRadius - 500];
      p.settings = defaultProjectSettings();
      p.settings.unitSystem = p.unitSystem;
      p.settings.layoutReview.requiredBoundaryClearanceMeters = 1000;
    },
  ];
  for (const mutate of mutations) {
    const project = fixture();
    mutate(project);
    const parsed = parseProjectDocument({ documentVersion: "pivot-project-v1", project });
    assert.equal(evaluateProjectCalculationSafety(parsed).allowed, false);
  }
});

test("active preview and external clearance are checked without inserting defaults", () => {
  const project = fixture();
  const before = structuredClone(project);
  for (const value of [NaN, Infinity, 1e155, 1e6]) {
    for (const inputs of [{ requiredBoundaryClearanceMeters: value }, { cornerArmPreview: { ...corner(), lengthMeters: value } }]) {
      assert.throws(() => assertProjectCalculationSafe(project, inputs), ProjectCalculationSafetyError);
    }
  }
  assert.doesNotThrow(() => assertProjectCalculationSafe(project, { requiredBoundaryClearanceMeters: 4, cornerArmPreview: corner() }));
  assert.deepEqual(project, before);
  // A stored corner takes precedence over an unused preview in the actual consumer.
  assert.doesNotThrow(() => assertProjectCalculationSafe({ ...project, machine: { ...project.machine, cornerArm: corner() } }, { cornerArmPreview: { ...corner(), lengthMeters: NaN } }));
});

test("finite measured speeds cannot produce an infinite corner constraint ratio", () => {
  const project = fixture();
  const sourceRefs = [{ sourceId: "synthetic-numerical-test", limit: "Regression fixture, not measured equipment evidence." }];
  project.machine.driveUnits = {
    lrdu: { role: "lrdu", advisoryOnly: true, operatorMeasuredSpeedMetersPerMinute: Number.MIN_VALUE, sourceRefs, caveats: [] },
    sdu: { role: "sdu", advisoryOnly: true, operatorMeasuredSpeedMetersPerMinute: Number.MAX_VALUE, sourceRefs, caveats: [] },
  };
  const parsed = parseProjectDocument(project);
  assert.ok(evaluateProjectCalculationSafety(parsed).blockers.some((issue) => issue.code === "non_finite_drive_speed_ratio"));
});

test("shared topology and clipping budgets reject unresolved coordinates and excessive range rings", () => {
  const budget = PROJECT_CALCULATION_NUMERIC_BUDGET;
  assert.equal(Object.isFrozen(budget), true);
  assert.equal(budget.toleranceMeters, 0.001);
  assert.equal(budget.maxConservativeSegments, 65536);
  assert.equal(budget.clippingEventBudget, 1_000_000);
  assert.equal(isBoundaryWithinCalculationBudget([]), true);
  assert.equal(isBoundaryWithinCalculationBudget(fixture().fieldBoundary.slice(0, 2)), true);
  assert.equal(isBoundaryWithinCalculationBudget([{ x: NaN, y: 0 }]), false);
  assert.equal(isBoundaryWithinCalculationBudget([{ x: 2 * budget.maxResolvedExtentMeters, y: 0 }]), false);
  const project = fixture();
  project.machine.endGunAngleRanges = Array.from({ length: 12 }, () => ({ startAngleDegrees: 0, stopAngleDegrees: 90, direction: "clockwise" as const }));
  assert.equal(evaluateProjectCalculationSafety(project).allowed, true);
  project.machine.spanLengthsMeters = [500000];
  assert.ok(evaluateProjectCalculationSafety(parseProjectDocument(project)).blockers.some((issue) => issue.code === "geometry_vertex_budget"));
});

test("large representable geometry remains numerically admitted without a physical maximum", () => {
  const project = fixture();
  project.machine.spanLengthsMeters = [50000, 50000];
  project.machine.overhangMeters = 1000;
  project.machine.endGunThrowMeters = 5000;
  project.machine.machineClearanceBufferMeters = 100;
  assert.deepEqual(evaluateProjectCalculationSafety(parseProjectDocument(project)), { allowed: true, blockers: [] });
});

function layoutFixture(): LayoutResult {
  const polygon = () => [[fixture().fieldBoundary]];
  return {
    metrics: { fieldAcres: 10, irrigatedAcres: 5, nonIrrigatedAcres: 5, coveragePercent: 50, endGunAcres: 0,
      outsideFieldAcres: 0, obstacleConflictCount: 0, noSprayConflictCount: 0, hardMechanicalConflictCount: 0, towerTrackConflictCount: 0 },
    baseCoverage: [[fixture().fieldBoundary, fixture().fieldBoundary]], endGunCoverage: polygon(), allowedCoverage: polygon(), outsideFieldCoverage: polygon(), obstacles: polygon(),
    towers: [{ towerIndex: 1, radiusMeters: 30, point: { x: 500100, y: 4400130 } }],
    mechanicalConflicts: [{ obstacleId: "obstacle", obstacleKind: "exclusion", obstacleName: "Obstacle", conflictType: "machine_path", areaSquareMeters: 1 }], warnings: [],
  };
}

test("result invariant includes all metrics, polygons, holes, towers and conflict areas", () => {
  const result = layoutFixture();
  const before = structuredClone(result);
  assert.doesNotThrow(() => assertLayoutResultFinite(result));
  assert.deepEqual(result, before);
  const mutations: Array<(value: LayoutResult, number: number) => void> = [
    ...Object.keys(result.metrics).map((key) => (r: LayoutResult, n: number) => { r.metrics[key as keyof LayoutResult["metrics"]] = n; }),
    (r, n) => { r.metrics.standardPivotAcres = n; },
    (r, n) => { r.metrics.cornerArmAcres = n; },
    (r, n) => { r.metrics.blockedByNoSprayAcres = n; },
    ...(["baseCoverage", "endGunCoverage", "allowedCoverage", "outsideFieldCoverage", "obstacles"] as const).map((key) => (r: LayoutResult, n: number) => { r[key][0][0][0].x = n; }),
    (r, n) => { r.baseCoverage[0][1][0].y = n; },
    (r, n) => { r.towers[0].towerIndex = n; },
    (r, n) => { r.towers[0].radiusMeters = n; },
    (r, n) => { r.towers[0].point.y = n; },
    (r, n) => { r.mechanicalConflicts[0].areaSquareMeters = n; },
  ];
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const mutate of mutations) {
      const invalid = structuredClone(result);
      mutate(invalid, value);
      assert.throws(() => assertLayoutResultFinite(invalid), /Layout result contains non-finite numeric data/);
    }
  }
});
