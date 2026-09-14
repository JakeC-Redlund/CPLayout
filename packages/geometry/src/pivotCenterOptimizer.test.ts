import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import type { ObstacleZone, PivotMachine, PivotProject, XY } from "@cplayout/core";

import { optimizePivotCenter, optimizePivotCenterSteps, type PivotCenterOptimizerOptions } from "./pivotCenterOptimizer";
import type { Calculation } from "./calculation";

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const concave = [
  { x: 0, y: 0 },
  { x: 120, y: 0 },
  { x: 120, y: 45 },
  { x: 65, y: 45 },
  { x: 65, y: 120 },
  { x: 0, y: 120 },
];

const narrow = [
  { x: 0, y: 0 },
  { x: 220, y: 0 },
  { x: 220, y: 35 },
  { x: 0, y: 35 },
];

const squareProject = makeProject("square", square, { x: 8, y: 50 });
const squareAlternatives = optimizePivotCenter(squareProject, { gridDivisions: 10, maxAlternatives: 5 });
assert.ok(squareAlternatives.length > 0);
assert.equal(squareAlternatives[0].feasible, true);
assert.ok(squareAlternatives[0].metrics.outsideFieldAcres <= 0.0001);
assert.equal(typeof squareAlternatives[0].scoreBreakdown.coverage, "number");
assert.equal(squareAlternatives[0].scoreBreakdown.feasibility > 0, true);
assert.deepEqual(squareProject.pivotCenter, { x: 8, y: 50 });

const repeatedSquareAlternatives = optimizePivotCenter(squareProject, { gridDivisions: 10, maxAlternatives: 5 });
assert.deepEqual(
  repeatedSquareAlternatives.map((alternative) => alternative.id),
  squareAlternatives.map((alternative) => alternative.id),
);

const concaveAlternatives = optimizePivotCenter(makeProject("concave", concave, { x: 10, y: 10 }), { gridDivisions: 12, maxAlternatives: 6 });
assert.ok(concaveAlternatives.some((alternative) => alternative.feasible));
assert.equal(concaveAlternatives[0].feasible, true);

const narrowAlternatives = optimizePivotCenter(makeProject("narrow", narrow, { x: 20, y: 17.5 }, { spanLengthsMeters: [12] }), {
  gridDivisions: 11,
  maxAlternatives: 4,
});
assert.ok(narrowAlternatives.some((alternative) => alternative.feasible));
assert.equal(narrowAlternatives[0].feasible, true);

const obstacle: ObstacleZone = {
  id: "center-exclusion",
  name: "Center exclusion",
  kind: "exclusion",
  polygon: [
    { x: 42, y: 42 },
    { x: 58, y: 42 },
    { x: 58, y: 58 },
    { x: 42, y: 58 },
  ],
  bufferMeters: 0,
  hardConflict: true,
  noSpray: true,
  confidence: "user_estimated",
};
const obstacleAlternatives = optimizePivotCenter(makeProject("obstacle", square, { x: 50, y: 50 }, {}, [obstacle]), {
  gridDivisions: 10,
  maxAlternatives: 6,
});
assert.equal(obstacleAlternatives[0].feasible, true);
assert.equal(obstacleAlternatives[0].metrics.obstacleConflictCount, 0);
assert.ok(obstacleAlternatives.some((alternative) => alternative.sourceSeed === "local_refinement"));
const obstacleConflictAlternative = obstacleAlternatives.find((alternative) => alternative.metrics.obstacleConflictCount > 0);
if (obstacleConflictAlternative) {
  assert.equal(obstacleConflictAlternative.feasible, false);
  assert.ok(obstacleConflictAlternative.disqualificationReasons.some((reason) => reason.includes("Obstacle conflicts")));
}

console.log("pivot center optimizer tests passed");

function makeProject(
  id: string,
  fieldBoundary: XY[],
  pivotCenter: XY,
  machineOverrides: Partial<PivotMachine> = {},
  obstacles: ObstacleZone[] = [],
): PivotProject {
  const machine: PivotMachine = {
    id: `${id}-machine`,
    name: "Test machine",
    spanLengthsMeters: [20],
    overhangMeters: 0,
    endGunThrowMeters: 0,
    towerClearanceBufferMeters: 0,
    machineClearanceBufferMeters: 0,
    sweep: { mode: "full_circle" },
    ...machineOverrides,
  };

  return {
    id,
    name: id,
    // Synthetic metre-grid arithmetic, not georeferenced field evidence.
    projectCrs: "EPSG:32613",
    unitSystem: "metric",
    fieldBoundary,
    pivotCenter,
    waterSource: pivotCenter,
    powerSource: pivotCenter,
    machine,
    obstacles,
    surveyPoints: [],
  };
}

function optimizerReuseFixtures(): { name: string; project: PivotProject; options: PivotCenterOptimizerOptions }[] {
  const options = { gridDivisions: 4, maxAlternatives: 6 };
  const partialMachine: Partial<PivotMachine> = {
    spanLengthsMeters: [20, 20],
    sweep: { mode: "partial_circle", startAngleDegrees: 0, stopAngleDegrees: 180, direction: "counterclockwise" },
  };
  const centeredField = square.map(({ x, y }) => ({ x: x * 2.4 - 120, y: y * 2.4 - 120 }));
  return [
    { name: "valid", project: makeProject("reuse-valid", square, { x: 50, y: 50 }), options },
    { name: "blocked-boundary", project: makeProject("reuse-blocked", square, { x: 50, y: 50 }, { spanLengthsMeters: [60] }), options },
    { name: "obstacles", project: makeProject("reuse-obstacles", square, { x: 50, y: 50 }, {}, [{
      ...obstacle, polygon: square,
    }]), options },
    { name: "partial-end-gun", project: makeProject("reuse-partial", square, { x: 50, y: 50 }, {
      ...partialMachine, endGunThrowMeters: 12,
      endGunAngleRanges: [{ startAngleDegrees: 30, stopAngleDegrees: 150, direction: "counterclockwise" }],
    }), options },
    { name: "invalid-geometry", project: makeProject("reuse-invalid", square, { x: 50, y: 50 }, { spanLengthsMeters: [Number.NaN] }), options },
    { name: "missing-boundary", project: makeProject("reuse-missing", [], { x: 50, y: 50 }), options },
    { name: "invalid-tolerance", project: makeProject("reuse-tolerance", square, { x: 50, y: 50 }), options: {
      ...options, boundaryEpsilonSquareMeters: Number.NaN,
    } },
    ...[{ x: 0, y: -0 }, { x: -0, y: 0 }, { x: -0, y: -0 }, { x: 0, y: 0 }].map((pivotCenter, index) => ({
      name: `signed-zero-${index}`, project: makeProject(`reuse-zero-${index}`, centeredField, pivotCenter, partialMachine), options,
    })),
  ];
}

function drainOptimizer<T>(calculation: Calculation<T>): { output: T; yields: number } {
  let yields = 0;
  let step = calculation.next();
  while (!step.done) { yields += 1; step = calculation.next(); }
  return { output: step.value, yields };
}

function exactOptimizerDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "number") {
      if (Object.is(item, -0)) return { numericValue: "-0" };
      if (!Number.isFinite(item)) return { numericValue: String(item) };
    }
    return item === undefined ? { absentValue: true } : item;
  })).digest("hex");
}

// Captured before reusing ranked metrics; the digest preserves -0, NaN and undefined.
const optimizerReuseBaselines: Record<string, { digest: string; yields: number }> = {
  valid: { digest: "99abfe6b93850b9f4e3a875c58b2ef1a713680c682f4a49f1a3f2dc80f9cb830", yields: 45 },
  "blocked-boundary": { digest: "ce7fa99d86607b33f7b5d44cccc84cbe704f683818e9aa7ce61cadec34797422", yields: 45 },
  obstacles: { digest: "082dee504297f96063228677b9ecea24add7dabdb893412816ff7b89beca3372", yields: 45 },
  "partial-end-gun": { digest: "dbf53b7de3a0dfc17e3287cafd4af124956ee9941cf9f364540ebec0848aa617", yields: 45 },
  "invalid-geometry": { digest: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", yields: 9 },
  "missing-boundary": { digest: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", yields: 2 },
  "invalid-tolerance": { digest: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", yields: 9 },
  "signed-zero-0": { digest: "7d767a9c617ba89e70ca58f4da7bab89430d691dd89a9fd7365359555e092f07", yields: 45 },
  "signed-zero-1": { digest: "1edcfe62e0701ec851c4a6f7748d69eb9016e390a3ec4ea68b892ab8e23ebbf1", yields: 45 },
  "signed-zero-2": { digest: "b1dda33896f3390950138b8f85f22e7f25b68dfe83db2cc219790b0acb37b56e", yields: 45 },
  "signed-zero-3": { digest: "066d50a29616820737b06fb46a4fdb854d4c9bc649fc263793a278e82e861ea9", yields: 45 },
};
for (const fixture of optimizerReuseFixtures()) {
  const before = structuredClone(fixture);
  const output = optimizePivotCenter(fixture.project, fixture.options);
  const stepped = drainOptimizer(optimizePivotCenterSteps(fixture.project, fixture.options));
  assert.deepEqual(stepped.output, output, `${fixture.name}: strict sync/iterator parity`);
  assert.deepEqual(fixture, before, `${fixture.name}: inputs and numeric signs unchanged`);
  assert.deepEqual({ digest: exactOptimizerDigest(output), yields: stepped.yields }, optimizerReuseBaselines[fixture.name],
    `${fixture.name}: complete pre-reuse optimizer output and scheduling`);
  if (fixture.name === "blocked-boundary") {
    assert.ok(output.every((alternative) => !alternative.feasible));
    assert.deepEqual(output[0].disqualificationReasons, [
      "Outside-field acreage exceeds the permitted maximum.",
      "Wet coverage exceeds field boundary by 1800.716 square meters.",
    ]);
  }
  if (fixture.name === "obstacles") {
    assert.ok(output.every((alternative) => !alternative.feasible));
    assert.deepEqual(output[0].disqualificationReasons, [
      "Obstacle count exceeds the permitted maximum.",
      "A hard obstacle intersects the mechanical sweep.",
      "Coverage is below the required minimum.",
      "Obstacle conflicts are hard infeasible for pivot-center alternatives.",
    ]);
  }
  if (fixture.name.startsWith("signed-zero")) {
    const current = output.find((alternative) => alternative.sourceSeed === "current");
    assert.ok(current);
    assert.ok(Object.is(current.pivotCenter.x, fixture.project.pivotCenter.x));
    assert.ok(Object.is(current.pivotCenter.y, fixture.project.pivotCenter.y));
  }
}
console.log("Optimizer reuse: 11 complete pre-reuse outputs and yield counts, strict signed zeros and rejection reasons pass.");
