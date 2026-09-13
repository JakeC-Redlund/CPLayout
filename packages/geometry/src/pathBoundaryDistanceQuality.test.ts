import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { sampleProject, type PivotProject, type PivotSweep, type XY } from "@cplayout/core";
import { evaluatePathBoundaryDistance as evaluate, evaluateMachineBoundaryClearance } from "./geometry";
import { buildAdvisoryMachineRenderModel } from "./advisoryMachineRenderModel";

const notch: XY[] = [[0, 0], [4, 0], [4, 2.5], [1.5, 2.5], [1.5, 4], [0, 4]].map(([x, y]) => ({ x, y }));
const quarter: PivotSweep = { mode: "partial_circle", startAngleDegrees: 0, stopAngleDegrees: 90, direction: "counterclockwise" };
function project(ring = notch, center = { x: 1, y: 1 }, sweep = quarter): PivotProject {
  return { ...sampleProject, projectCrs: "LOCAL:TEST", fieldBoundary: ring, pivotCenter: center,
    machine: { ...sampleProject.machine, sweep }, obstacles: [], mapFeatures: [] };
}

// At the notch bisector, y - 2.5 = x - 1.5, hence sin(theta) - cos(theta) = 1/3.
const theta = Math.PI / 4 + Math.asin(1 / (3 * Math.SQRT2));
const analyticMinimum = -(Math.sqrt(17) - 2) / 2;
assert.ok(Math.abs((1 + 3 * Math.cos(theta) - 1.5) + analyticMinimum) < 1e-14);
const defect = evaluate(project(), 3);
console.log("analytic concavity", { analyticMinimum, result: defect });
assert.ok(defect.minimumBoundaryDistanceMeters <= analyticMinimum,
  "a conservative minimum must not overstate the analytic notch clearance");

function encloses(result: ReturnType<typeof evaluate>, expected: number, label: string): void {
  assert.ok(result.lowerBoundMeters <= expected && expected <= result.upperBoundMeters,
    `${label}: ${expected} must be in [${result.lowerBoundMeters}, ${result.upperBoundMeters}]`);
  assert.equal(result.minimumBoundaryDistanceMeters, result.lowerBoundMeters);
  assert.ok(result.evaluatedPointCount <= result.maxEvaluatedPointCount);
  assert.equal(result.converged, result.errorBoundMeters <= result.toleranceMeters);
  assert.equal(result.errorBoundMeters, result.upperBoundMeters - result.lowerBoundMeters);
}
encloses(defect, analyticMinimum, "notch");
assert.equal(defect.converged, true);
const preciseNotch = evaluate(project(), 3, { toleranceMeters: 1e-8 });
encloses(preciseNotch, analyticMinimum, "precise notch");
assert.equal(preciseNotch.converged, true);
console.log("precise notch", preciseNotch);

const square = (half: number): XY[] => [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, y]) => ({ x, y }));
const full: PivotSweep = { mode: "full_circle" };
const centered = project(square(10), { x: 0, y: 0 }, full);
const contained = evaluate(centered, 3);
encloses(contained, 7, "contained full circle");
assert.equal(contained.method, "exact_full_circle");
assert.equal(contained.evaluatedPointCount, 0);
encloses(evaluate(centered, 10), 0, "full circle tangent");
encloses(evaluate(centered, 11), -1, "full circle crossing square");
encloses(evaluate(project(square(1), { x: 2, y: 2 }, full), 1), -Math.SQRT2 - 1, "center outside");

const concaveFullRing: XY[] = [[-10, -10], [10, -10], [10, 2.5], [1.5, 2.5], [1.5, 10], [-10, 10]].map(([x, y]) => ({ x, y }));
const concaveFull = evaluate(project(concaveFullRing, { x: 1, y: 1 }, full), 3, { toleranceMeters: 1e-7 });
encloses(concaveFull, analyticMinimum, "concave full circle");
assert.equal(concaveFull.method, "bounded_arc_search");
assert.ok(Math.abs((Math.sqrt(2.5) - 3) - analyticMinimum) > 0.3,
  "center distance minus radius does not equal the signed full-circle minimum here");

const clockwise: PivotSweep = { ...quarter, startAngleDegrees: 90, stopAngleDegrees: 0, direction: "clockwise" };
encloses(evaluate(project(notch, { x: 1, y: 1 }, clockwise), 3), analyticMinimum, "clockwise notch");
for (const direction of ["clockwise", "counterclockwise"] as const) {
  const sweep: PivotSweep = { mode: "partial_circle", direction,
    startAngleDegrees: direction === "counterclockwise" ? 270.00000000000006 : 270,
    stopAngleDegrees: direction === "counterclockwise" ? 270 : 270.00000000000006 };
  const input = project(square(10), { x: 0, y: 2 }, sweep);
  input.machine = { ...input.machine, spanLengthsMeters: [9], overhangMeters: 0, endGunThrowMeters: 0, cornerArm: undefined };
  const almostFull = evaluate(input, 9);
  encloses(almostFull, -1, `${direction} nearly full sweep`);
  assert.equal(almostFull.method, "bounded_arc_search");
  const wheel = evaluateMachineBoundaryClearance(input).find((row) => row.kind === "wheel_track")!;
  assert.equal(wheel.meetsRequiredBoundaryClearance, false, "a nearly full sweep cannot become a safe single point");
}
for (const [start, stop, direction] of [
  [0, -Number.MIN_VALUE, "counterclockwise"],
  [-Number.MIN_VALUE, 0, "clockwise"],
  [Number.MIN_VALUE, -360, "counterclockwise"],
  [-360, Number.MIN_VALUE, "clockwise"],
  [-89.99999999999999, 270, "counterclockwise"],
  [270, -89.99999999999999, "clockwise"],
] as const) {
  const result = evaluate(project(square(10), { x: 0, y: 2 }, {
    mode: "partial_circle", startAngleDegrees: start, stopAngleDegrees: stop, direction,
  }), 9);
  encloses(result, -1, "subnormal angular gap cannot erase a full sweep");
  assert.equal(result.method, "bounded_arc_search");
}
for (const direction of ["clockwise", "counterclockwise"] as const) {
  const sweep: PivotSweep = { mode: "partial_circle", startAngleDegrees: direction === "clockwise" ? 10 : 350,
    stopAngleDegrees: direction === "clockwise" ? 350 : 10, direction };
  encloses(evaluate(project(square(10), { x: 0, y: 0 }, sweep), 3), 7, "wrapped sweep");
  const zero: PivotSweep = { ...sweep, startAngleDegrees: 360, stopAngleDegrees: 0 };
  const single = evaluate(project(square(10), { x: 0, y: 0 }, zero), 3);
  encloses(single, 7, "zero span");
  assert.equal(single.method, "single_point");
  assert.equal(single.evaluatedPointCount, 1);
}
encloses(evaluate(project(square(10), { x: 0, y: 0 }, { ...quarter, startAngleDegrees: 0, stopAngleDegrees: 0 }), 11), -1, "zero span outside");
encloses(evaluate(centered, 0), 10, "zero radius");
encloses(evaluate(project(square(10), { x: 10, y: 0 }, full), 0), 0, "zero radius on boundary");
for (const bad of [-1, NaN, Infinity, -Infinity]) assert.throws(() => evaluate(centered, bad), /finite and nonnegative/);
for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => evaluate(centered, 1, { toleranceMeters: bad }), /positive finite/);
for (const bad of [0, 2, 3.5, NaN, Infinity]) assert.throws(() => evaluate(centered, 1, { maxEvaluatedPointCount: bad }), /safe integer/);
assert.throws(() => evaluate(project(notch, { x: NaN, y: 0 }), 1), /finite center/);
assert.throws(() => evaluate(project([{ x: 0, y: 0 }]), 1), /finite center/);
assert.throws(() => evaluate(project([...notch, { x: Infinity, y: 0 }]), 1), /finite center/);
assert.throws(() => evaluate(project(notch, { x: 1, y: 1 }, { ...quarter, stopAngleDegrees: NaN }), 1), /finite full-circle/);
encloses(evaluate(project([...notch, notch[0]]), 3), analyticMinimum, "explicitly closed ring");
encloses(evaluate(project([...notch.slice(0, 2), notch[1], ...notch.slice(2)]), 3), analyticMinimum, "zero-length edge");
encloses(evaluate(project([...notch].reverse()), 3), analyticMinimum, "reversed ring winding");
for (const factor of [1e-100, 1e-9, 1e-6, 0.01, 1, 1000, 1e6, 1e100]) {
  const scaled = evaluate(project(notch.map(({ x, y }) => ({ x: x * factor, y: y * factor })),
    { x: factor, y: factor }), 3 * factor, { toleranceMeters: 1e-6 * factor });
  encloses(scaled, analyticMinimum * factor, `scale ${factor}`);
  assert.equal(scaled.converged, true);
}
for (const offset of [100, 1e6, 1e9, -1e9]) {
  const moved = evaluate(project(notch.map(({ x, y }) => ({ x: x + offset, y: y - offset })),
    { x: 1 + offset, y: 1 - offset }), 3);
  encloses(moved, analyticMinimum, `translation ${offset}`);
  assert.equal(moved.converged, true);
}

const capped = evaluate(project(), 3, { toleranceMeters: 1e-9, maxEvaluatedPointCount: 3 });
encloses(capped, analyticMinimum, "capped search");
assert.equal(capped.converged, false);
assert.equal(capped.terminationReason, "evaluation_budget");
assert.match(capped.warnings.join(" "), /unresolved.*do not approve/);
const belowResolution = evaluate(project(notch.map(({ x, y }) => ({ x: x + 1e12, y: y + 1e12 })),
  { x: 1 + 1e12, y: 1 + 1e12 }), 3, { toleranceMeters: 1e-6 });
encloses(belowResolution, analyticMinimum, "numerical precision limit");
assert.equal(belowResolution.converged, false);
assert.equal(belowResolution.terminationReason, "numerical_precision");
const subnormal = evaluate(project(notch.map(({ x, y }) => ({ x: x * 1e-320, y: y * 1e-320 })),
  { x: 1e-320, y: 1e-320 }), 3e-320, { toleranceMeters: 1e-323 });
encloses(subnormal, analyticMinimum * 1e-320, "subnormal numerical limit");
assert.equal(subnormal.converged, false);
assert.ok(subnormal.numericalErrorBudgetMeters > 0);

// Independent winding-number sign and line-distance projection, with no production helpers.
function oracleSignedDistance(point: XY, ring: XY[]): number {
  let winding = 0;
  let nearest = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const px = point.x - a.x;
    const py = point.y - a.y;
    const cross = dx * py - dy * px;
    if (a.y <= point.y && b.y > point.y && cross > 0) winding += 1;
    if (a.y > point.y && b.y <= point.y && cross < 0) winding -= 1;
    const length = Math.hypot(dx, dy);
    const along = length === 0 ? -1 : (px * dx + py * dy) / length;
    const distance = along < 0 ? Math.hypot(px, py) : along > length ? Math.hypot(point.x - b.x, point.y - b.y)
      : Math.abs(cross) / length;
    nearest = Math.min(nearest, distance);
  }
  return winding === 0 ? -nearest : nearest;
}
function denseOracle(input: PivotProject, radius: number, count = 32768): { lower: number; upper: number } {
  const sweep = input.machine.sweep;
  const sign = sweep.mode === "full_circle" || sweep.direction === "counterclockwise" ? 1 : -1;
  const start = sweep.mode === "full_circle" ? 0 : sweep.startAngleDegrees;
  const spanDegrees = sweep.mode === "full_circle" ? 360 : ((sign * (sweep.stopAngleDegrees - start) % 360) + 360) % 360;
  const span = spanDegrees * Math.PI / 180;
  let minimum = Infinity;
  for (let i = 0; i <= count; i += 1) {
    const angle = start * Math.PI / 180 + sign * span * i / count;
    minimum = Math.min(minimum, oracleSignedDistance({ x: input.pivotCenter.x + radius * Math.cos(angle),
      y: input.pivotCenter.y + radius * Math.sin(angle) }, input.fieldBoundary));
  }
  // Every arc point is at most half a sample interval away in arc length.
  const allowance = 1e-10;
  return { lower: minimum - radius * span / (2 * count) - allowance, upper: minimum + allowance };
}
let state = 0x173bcf;
const random = (): number => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 2 ** 32;
};
for (let index = 0; index < 24; index += 1) {
  const count = 5 + index % 14;
  const ring = Array.from({ length: count }, (_, vertex) => {
    const angle = vertex * 2 * Math.PI / count;
    const radius = 5 + 15 * random();
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
  const sweep: PivotSweep = index % 4 === 0 ? full : { ...quarter, startAngleDegrees: random() * 360,
    stopAngleDegrees: random() * 360, direction: index % 2 ? "clockwise" : "counterclockwise" };
  const input = project(ring, { x: random() * 30 - 15, y: random() * 30 - 15 }, sweep);
  const radius = 0.1 + random() * 30;
  const oracle = denseOracle(input, radius);
  const actual = evaluate(input, radius);
  assert.ok(actual.lowerBoundMeters <= oracle.upper && actual.upperBoundMeters >= oracle.lower,
    `independent oracle enclosure overlap, case ${index}`);
  assert.equal(actual.converged, true, `ordinary synthetic case ${index} converges`);
}
console.log("independent dense oracle: 24 synthetic cases, 32769 samples each, bounded interpolation error");

const tinyOutside = project(square(10), { x: 0, y: 0 }, { ...quarter, startAngleDegrees: 0, stopAngleDegrees: 0 });
tinyOutside.machine = { ...tinyOutside.machine, spanLengthsMeters: [10 + 2e-7], overhangMeters: 0, endGunThrowMeters: 0 };
const rows = evaluateMachineBoundaryClearance(tinyOutside);
const wheel = rows.find((row) => row.kind === "wheel_track");
assert.ok(wheel);
assert.equal(wheel.meetsRequiredBoundaryClearance, false, "rounding a sub-micrometer violation to zero must not approve clearance");
assert.ok(wheel.boundaryDistanceEvaluation!.upperBoundMeters < 0);

function renderInput(ring: XY[], center: XY, radius: number): PivotProject {
  const input = project(ring, center, full);
  input.machine = { ...input.machine, cornerArm: undefined, towerClearanceBufferMeters: 3 };
  input.mapFeatures = [{ id: "synthetic-circle", name: "Synthetic circle", kind: "machine_zone", confidence: "user_estimated",
    geometry: { type: "Circle", center, radiusMeters: radius }, properties: { preferredMachineOutline: true } }];
  return input;
}
const renderOptions = { includePublicVflexFallbackCornerArm: false, endGunThrowMeters: 0, safetyZoneMeters: 0 };
const concaveRenderInput = renderInput(concaveFullRing, { x: 1, y: 1 }, 3);
const renderBefore = JSON.stringify(concaveRenderInput);
const rendered = buildAdvisoryMachineRenderModel(concaveRenderInput, renderOptions);
assert.equal(JSON.stringify(concaveRenderInput), renderBefore);
const renderedRows = rendered.surfaces.flatMap((surface) => surface.pathBoundaryShortfalls);
assert.ok(renderedRows.length > 0);
for (const row of renderedRows) {
  assert.equal(row.evaluationMethod, "bounded_arc_search");
  assert.equal(row.minimumSignedDistanceToBoundaryMeters, row.boundaryDistanceEvaluation.lowerBoundMeters);
  assert.equal(row.clearanceStatus, "shortfall");
  assert.ok(row.boundaryDistanceEvaluation.upperBoundMeters < 0);
}
const thresholdModel = buildAdvisoryMachineRenderModel(renderInput(square(10), { x: 0, y: 0 }, 7), renderOptions);
const threshold = thresholdModel.surfaces.flatMap((surface) => surface.pathBoundaryShortfalls).find((row) => row.kind === "lrdu");
assert.ok(threshold);
assert.equal(threshold.clearanceStatus, "unresolved", "a numerical range across the required buffer cannot establish clearance");
assert.equal(threshold.shortfallSampleCount, 0, "uncertainty is not a witnessed shortfall");
assert.match(threshold.warnings.join(" "), /does not establish/);

const performanceRows = [];
for (const vertices of [32, 128, 512]) {
  const ring = Array.from({ length: vertices }, (_, i) => ({ x: (i % 2 ? 700 : 1000) * Math.cos(i * 2 * Math.PI / vertices),
    y: (i % 2 ? 700 : 1000) * Math.sin(i * 2 * Math.PI / vertices) }));
  const input = project(ring, { x: 0, y: 0 }, full);
  const oracle = denseOracle(input, 1010);
  const start = performance.now();
  const result = evaluate(input, 1010, { toleranceMeters: 1e-8, maxEvaluatedPointCount: 1001 });
  const elapsedMs = performance.now() - start;
  assert.ok(result.lowerBoundMeters <= oracle.upper && result.upperBoundMeters >= oracle.lower,
    `performance polygon ${vertices} intersects independent oracle bounds`);
  assert.ok(result.evaluatedPointCount <= 1001);
  assert.equal(result.converged, false);
  assert.equal(result.terminationReason, "evaluation_budget");
  performanceRows.push({ vertices, elapsedMs, evaluatedPointCount: result.evaluatedPointCount,
    errorBoundMeters: result.errorBoundMeters, converged: result.converged });
}
console.log("synthetic performance", performanceRows);
console.log("path boundary distance quality tests passed");
