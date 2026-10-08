/** Synthetic planar research only. No production solver, controller, or app dependency. */
export type XY = [number, number];
export interface Knot { thetaRad: number; alphaRad: number }
export interface ResearchInput {
  schemaVersion: "cplayout-corner-research-v1";
  id: string;
  model: { pivot: XY; mainRadiusM: number; armLengthM: number; overhangM: number;
    bodyHalfWidthM: number; antennaOffsetM: XY; wheelOffsetsM: XY[]; towerRadiiM: number[] };
  limits: { articulationRad: [number, number]; maxArticulationSlope: number };
  field: { outer: XY[]; holes: XY[][] };
  obstacles: XY[][];
  sweep: { startRad: number; endRad: number; fullCircle: boolean };
  clearanceM: number;
  maxDepth: number;
  toleranceM: number;
  trajectory: { interpolation: "linear"; knots: Knot[] };
}
export type Verdict = "verified_within_model" | "constraint_violated" | "missing_evidence" | "numerically_unresolved";
export interface Issue { code: string; message: string; interval?: number; thetaRad?: number }
export interface MovingPoint { position: XY; dTheta: XY; ddTheta: XY }
export interface Pose {
  thetaRad: number; alphaRad: number; alphaSlope: number;
  H: MovingPoint; S: MovingPoint; E: MovingPoint; antenna: MovingPoint;
  wheels: MovingPoint[]; towers: MovingPoint[];
}
export interface Verification {
  status: Verdict; id: string; issues: Issue[];
  stats: { visitedIntervals: number; certifiedIntervals: number; deepestSubdivision: number; minCertifiedMarginM: number | null };
  assumptions: readonly string[]; notEvaluated: readonly string[];
  interpolation: "linear"; poses: Pose[];
}
export const ASSUMPTIONS = [
  "Synthetic flat projected/local XY in metres; rigid single arm; hinge coincides with LRDU.",
  "Main member is pivot-to-hinge; corner member is hinge-to-overhang endpoint; both use the same circular body half-width plus clearance.",
  "Antenna and wheel offsets are measured from SDU in the moving arm frame and checked as buffered points, not wheel footprints.",
  "Trajectory angles are unwrapped and piecewise linear in theta; no smoothing is performed after verification.",
  "Continuous clearance uses midpoint distance lower bounds minus analytic displacement bounds and a floating-point guard; this is bounded numerical evidence, not exact-real certification.",
] as const;
export const NOT_EVALUATED = [
  "Manufacturer geometry, field suitability, rolling/no-slip constraints, wheel dimensions, steering limits, timing, speed, acceleration, terrain, hydraulics, and control readiness.",
  "Arbitrary imported SDU guide-path inversion, reachability, branch selection, and guide tracking between supplied angle knots.",
  "Derivative continuity at interior piecewise-linear knots; reported one-sided derivatives can jump.",
] as const;
const TAU = 2 * Math.PI;
export const MAX_VISITED_INTERVALS = 100_000;
const MAX_VERTICES = 512;
const MAX_KNOTS = 1025;
const ANGLE_GUARD = 128 * Number.EPSILON;
const add = (a: XY, b: XY): XY => [a[0] + b[0], a[1] + b[1]];
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const scale = (a: XY, s: number): XY => [a[0] * s, a[1] * s];
const norm = (a: XY): number => Math.hypot(a[0], a[1]);
const unit = (t: number): XY => [Math.cos(t), Math.sin(t)];
const rot90 = (a: XY): XY => [-a[1], a[0]];
const rotate = (a: XY, t: number): XY => [a[0] * Math.cos(t) - a[1] * Math.sin(t), a[0] * Math.sin(t) + a[1] * Math.cos(t)];

// Exact dyadic orientation fallback for the supplied binary64 coordinates. Fast filter
// avoids BigInt for ordinary cases. It does not make transcendental kinematics exact.
function dyadic(n: number): [bigint, number] {
  const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, n);
  const bits = v.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (exponent === 0 ? 0n : 1n << 52n);
  return [(bits >> 63n) ? -mantissa : mantissa, exponent === 0 ? -1074 : exponent - 1075];
}
export function orientation(a: XY, b: XY, c: XY): number {
  const p = (b[0] - a[0]) * (c[1] - a[1]), q = (b[1] - a[1]) * (c[0] - a[0]);
  const d = p - q, err = 16 * Number.EPSILON * (Math.abs(p) + Math.abs(q));
  if (Math.abs(d) > err) return Math.sign(d);
  const values = [...a, ...b, ...c].map(dyadic), e = Math.min(...values.map(v => v[1]));
  const [ax, ay, bx, by, cx, cy] = values.map(v => v[0] << BigInt(v[1] - e));
  const exact = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return exact > 0n ? 1 : exact < 0n ? -1 : 0;
}
function onSegment(a: XY, b: XY, p: XY): boolean {
  return orientation(a, b, p) === 0 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0])
    && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}
export function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const abC = orientation(a, b, c), abD = orientation(a, b, d), cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0) || (abC === 0 && onSegment(a, b, c))
    || (abD === 0 && onSegment(a, b, d)) || (cdA === 0 && onSegment(c, d, a)) || (cdB === 0 && onSegment(c, d, b));
}
/** 1 strictly inside, 0 boundary, -1 outside. */
export function pointInRing(p: XY, ring: XY[]): number {
  let winding = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (onSegment(a, b, p)) return 0;
    if (a[1] <= p[1] && b[1] > p[1] && orientation(a, b, p) > 0) winding++;
    if (a[1] > p[1] && b[1] <= p[1] && orientation(a, b, p) < 0) winding--;
  }
  return winding ? 1 : -1;
}
export function pointSegmentDistance(p: XY, a: XY, b: XY): number {
  const v = sub(b, a), length = norm(v);
  if (length === 0) return norm(sub(p, a));
  const u = scale(v, 1 / length), w = sub(p, a), along = Math.max(0, Math.min(length, w[0] * u[0] + w[1] * u[1]));
  return norm(sub(w, scale(u, along)));
}
function segmentDistance(a: XY, b: XY, c: XY, d: XY): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}
function boundaryDistance(a: XY, b: XY, ring: XY[]): number {
  return Math.min(...ring.map((p, i) => segmentDistance(a, b, p, ring[(i + 1) % ring.length])));
}
function ringsTouch(a: XY[], b: XY[]): boolean {
  return a.some((p, i) => b.some((q, j) => segmentsIntersect(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])));
}
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const xy = (p: unknown): p is XY => Array.isArray(p) && p.length === 2 && p.every(v => finite(v) && Math.abs(v) <= 1e12);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function numericGuard(input: ResearchInput): number {
  const m = input.model;
  const coordinates = [m.pivot, ...input.field.outer, ...input.field.holes.flat(), ...input.obstacles.flat()];
  const angularScale = Math.max(1, Math.abs(input.sweep.startRad), Math.abs(input.sweep.endRad), ...input.limits.articulationRad.map(Math.abs));
  const size = Math.max(1, ...coordinates.flat().map(Math.abs), angularScale * (m.mainRadiusM + Math.max(m.armLengthM + m.overhangM,
    norm([m.armLengthM + m.antennaOffsetM[0], m.antennaOffsetM[1]]), ...m.wheelOffsetsM.map(q => norm([m.armLengthM + q[0], q[1]])))));
  // 4096 ulps of coordinate scale also absorbs trigonometric and distance arithmetic.
  return 4096 * Number.EPSILON * size;
}
export function validateInput(value: unknown): Issue[] {
  const bad = (message: string): Issue[] => [{ code: "invalid_input", message }];
  if (!object(value) || value.schemaVersion !== "cplayout-corner-research-v1" || typeof value.id !== "string" || !value.id || value.id.length > 200)
    return bad("Expected v1 synthetic research input with a nonempty id (at most 200 characters).");
  const { model: m, limits: l, field: f, sweep: s, trajectory: t } = value;
  if (!object(m) || !object(l) || !object(f) || !object(s) || !object(t)) return bad("Missing model, limits, field, sweep, or trajectory object.");
  if (!xy(m.pivot) || !xy(m.antennaOffsetM) || !Array.isArray(m.wheelOffsetsM) || m.wheelOffsetsM.length > 32 || !m.wheelOffsetsM.every(xy)
    || !Array.isArray(m.towerRadiiM) || m.towerRadiiM.length > 32) return bad("Malformed model coordinates or offset/tower count exceeds 32.");
  for (const k of ["mainRadiusM", "armLengthM", "overhangM", "bodyHalfWidthM"])
    if (!finite(m[k]) || (m[k] as number) < 0 || (m[k] as number) > 1e6) return bad(`Model ${k} must be finite in [0, 1000000].`);
  if ((m.mainRadiusM as number) <= 0 || (m.armLengthM as number) <= 0 || !m.towerRadiiM.every(r => finite(r) && r >= 0 && r <= (m.mainRadiusM as number)))
    return bad("Main radius and arm length must be positive; tower radii must be on the main member.");
  if ([m.antennaOffsetM, ...m.wheelOffsetsM].some(p => norm(p as XY) > 1e6)) return bad("Offset magnitude exceeds 1000000 metres.");
  if (!Array.isArray(l.articulationRad) || l.articulationRad.length !== 2 || !l.articulationRad.every(a => finite(a) && Math.abs(a) <= 1e4)
    || l.articulationRad[0] > l.articulationRad[1] || !finite(l.maxArticulationSlope) || l.maxArticulationSlope < 0 || l.maxArticulationSlope > 1e4)
    return bad("Malformed articulation bounds or slope limit.");
  if (![s.startRad, s.endRad].every(a => finite(a) && Math.abs(a) <= 1e4) || typeof s.fullCircle !== "boolean") return bad("Malformed sweep.");
  const sweepLength = Math.abs((s.endRad as number) - (s.startRad as number));
  if (!(sweepLength > 1e-12) || sweepLength > TAU + ANGLE_GUARD * 1e4) return bad("Sweep must be nonzero and at most one revolution.");
  if (s.fullCircle && Math.abs(sweepLength - TAU) > ANGLE_GUARD * Math.max(1, Math.abs(s.startRad as number), Math.abs(s.endRad as number)))
    return bad("Full circle requires one signed unwrapped revolution.");
  if (!finite(value.clearanceM) || value.clearanceM < 0 || value.clearanceM > 1e6
    || !finite(value.toleranceM) || value.toleranceM <= 0 || value.toleranceM > 1e6
    || !Number.isInteger(value.maxDepth) || (value.maxDepth as number) < 0 || (value.maxDepth as number) > 20)
    return bad("Clearance/tolerance must be finite; positive tolerance and integer maxDepth in [0,20] are required.");
  if (t.interpolation !== "linear" || !Array.isArray(t.knots) || t.knots.length < 2 || t.knots.length > MAX_KNOTS
    || !t.knots.every(k => object(k) && finite(k.thetaRad) && finite(k.alphaRad) && Math.abs(k.thetaRad) <= 1e4 && Math.abs(k.alphaRad) <= 1e4))
    return bad("Expected 2..1025 finite linear trajectory knots with bounded unwrapped angles.");
  if (!Array.isArray(f.outer) || !Array.isArray(f.holes) || !Array.isArray(value.obstacles)) return bad("Malformed polygon arrays.");
  const rings = [f.outer, ...f.holes, ...value.obstacles];
  if (rings.length > 64 || rings.some(r => !Array.isArray(r) || r.length < 3 || !r.every(xy)) || rings.reduce((n, r) => n + r.length, 0) > MAX_VERTICES)
    return bad("Use open polygon rings with >=3 points; at most 64 rings and 512 total vertices.");
  const guard = numericGuard(value as unknown as ResearchInput);
  for (const ring of rings as XY[][]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (norm(sub(a, b)) <= guard * 4 || orientation(ring[(i + ring.length - 1) % ring.length], a, b) === 0)
        return bad("Degenerate, repeated, collinear, or numerically inseparable polygon vertices.");
      for (let j = i + 1; j < ring.length; j++) {
        if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
        if (segmentsIntersect(a, b, ring[j], ring[(j + 1) % ring.length])) return bad("Self-intersecting polygon ring.");
      }
    }
  }
  const outer = f.outer as XY[], holes = f.holes as XY[][];
  for (let i = 0; i < holes.length; i++) {
    if (pointInRing(holes[i][0], outer) !== 1 || ringsTouch(holes[i], outer)) return bad("Holes must be strictly inside the outer ring.");
    for (let j = 0; j < i; j++) if (ringsTouch(holes[i], holes[j]) || pointInRing(holes[i][0], holes[j]) >= 0 || pointInRing(holes[j][0], holes[i]) >= 0)
      return bad("Holes must be disjoint and non-nested.");
  }
  return [];
}

export function forwardPose(input: ResearchInput, thetaRad: number, alphaRad: number, alphaSlope = 0): Pose {
  const m = input.model, radial = scale(unit(thetaRad), m.mainRadiusM), hinge = add(m.pivot, radial), psi = thetaRad + alphaRad, rate = 1 + alphaSlope;
  const attached = (offset: XY): MovingPoint => {
    const local = rotate(offset, psi);
    return { position: add(hinge, local), dTheta: add(rot90(radial), scale(rot90(local), rate)), ddTheta: add(scale(radial, -1), scale(local, -rate * rate)) };
  };
  return { thetaRad, alphaRad, alphaSlope, H: attached([0, 0]), S: attached([m.armLengthM, 0]), E: attached([m.armLengthM + m.overhangM, 0]),
    antenna: attached([m.armLengthM + m.antennaOffsetM[0], m.antennaOffsetM[1]]),
    wheels: m.wheelOffsetsM.map(q => attached([m.armLengthM + q[0], q[1]])), towers: m.towerRadiiM.map(r => {
      const v = scale(unit(thetaRad), r); return { position: add(m.pivot, v), dTheta: rot90(v), ddTheta: scale(v, -1) };
    }) };
}
/** Signed centerline clearance, checking entire straight members including concave edges. */
function memberClearance(input: ResearchInput, a: XY, b: XY): number {
  const outerDistance = boundaryDistance(a, b, input.field.outer);
  let distance = (pointInRing(a, input.field.outer) < 0 || pointInRing(b, input.field.outer) < 0) ? -outerDistance : outerDistance;
  for (const ring of [...input.field.holes, ...input.obstacles]) {
    const d = boundaryDistance(a, b, ring), inside = pointInRing(a, ring) > 0 || pointInRing(b, ring) > 0;
    distance = Math.min(distance, inside ? -d : d);
  }
  return distance;
}
function poseClearance(input: ResearchInput, p: Pose): number {
  return Math.min(memberClearance(input, input.model.pivot, p.H.position), memberClearance(input, p.H.position, p.E.position),
    ...[p.antenna, ...p.wheels].map(o => memberClearance(input, o.position, o.position)));
}
export function trajectoryPoses(input: ResearchInput): Pose[] {
  const k = input.trajectory.knots;
  // At every interior knot emit both derivatives rather than hiding a derivative jump.
  return k.slice(0, -1).flatMap((a, i) => {
    const b = k[i + 1], slope = (b.alphaRad - a.alphaRad) / (b.thetaRad - a.thetaRad);
    return [forwardPose(input, a.thetaRad, a.alphaRad, slope), forwardPose(input, b.thetaRad, b.alphaRad, slope)];
  });
}
function initialResult(input: unknown): Verification {
  return { status: "missing_evidence", id: object(input) && typeof input.id === "string" ? input.id : "invalid",
    issues: [], stats: { visitedIntervals: 0, certifiedIntervals: 0, deepestSubdivision: 0, minCertifiedMarginM: null },
    assumptions: ASSUMPTIONS, notEvaluated: NOT_EVALUATED, interpolation: "linear", poses: [] };
}
/** Shared proof primitive for supplied trajectories and every graph edge. */
function verifyInterval(input: ResearchInput, a: Knot, b: Knot, result: Verification, interval: number, guard: number): Verdict {
  const m = input.model, extent = Math.max(m.armLengthM + m.overhangM,
    norm([m.armLengthM + m.antennaOffsetM[0], m.antennaOffsetM[1]]), ...m.wheelOffsetsM.map(q => norm([m.armLengthM + q[0], q[1]])));
  const required = m.bodyHalfWidthM + input.clearanceM;
  const visit = (left: Knot, right: Knot, depth: number): Verdict => {
    if (result.stats.visitedIntervals >= MAX_VISITED_INTERVALS) return "numerically_unresolved";
    result.stats.visitedIntervals++; result.stats.deepestSubdivision = Math.max(result.stats.deepestSubdivision, depth);
    const mid = { thetaRad: (left.thetaRad + right.thetaRad) / 2, alphaRad: (left.alphaRad + right.alphaRad) / 2 };
    const c = poseClearance(input, forwardPose(input, mid.thetaRad, mid.alphaRad));
    if (c < required - guard) {
      result.issues.push({ code: "continuous_member_collision", message: "A checked midpoint violates whole-member/offset clearance.", interval, thetaRad: mid.thetaRad });
      return "constraint_violated";
    }
    // A midpoint inside the arithmetic uncertainty band cannot acquire a strict
    // positive clearance proof by subdividing around that same point.
    if (c <= required + guard) return "numerically_unresolved";
    const dTheta = Math.abs(right.thetaRad - left.thetaRad) / 2;
    const dPsi = Math.abs((right.thetaRad - left.thetaRad) + (right.alphaRad - left.alphaRad)) / 2;
    const displacement = m.mainRadiusM * dTheta + extent * dPsi;
    const margin = c - guard - displacement - required;
    if (margin > 0) {
      result.stats.certifiedIntervals++;
      result.stats.minCertifiedMarginM = Math.min(result.stats.minCertifiedMarginM ?? Infinity, margin);
      return "verified_within_model";
    }
    if (depth >= input.maxDepth || displacement <= input.toleranceM || mid.thetaRad === left.thetaRad || mid.thetaRad === right.thetaRad) return "numerically_unresolved";
    const first = visit(left, mid, depth + 1);
    if (first === "constraint_violated") return first;
    const second = visit(mid, right, depth + 1);
    return second === "constraint_violated" ? second : first === "numerically_unresolved" || second === "numerically_unresolved" ? "numerically_unresolved" : "verified_within_model";
  };
  return visit(a, b, 0);
}
export function verifyTrajectory(value: unknown): Verification {
  const result = initialResult(value), issues = validateInput(value);
  if (issues.length) { result.issues = issues; return result; }
  const input = value as ResearchInput, knots = input.trajectory.knots, dir = Math.sign(input.sweep.endRad - input.sweep.startRad), guard = numericGuard(input);
  const fail = (status: Verdict, code: string, message: string): Verification => { result.status = status; result.issues.push({ code, message }); return result; };
  // Exact endpoint coverage avoids silently omitting a tiny unverified interval.
  if (knots[0].thetaRad !== input.sweep.startRad || knots.at(-1)!.thetaRad !== input.sweep.endRad)
    return fail("missing_evidence", "incomplete_sweep", "First and last theta must equal the declared sweep endpoints exactly.");
  if (knots.some((k, i) => i > 0 && dir * (k.thetaRad - knots[i - 1].thetaRad) <= 0))
    return fail("missing_evidence", "knot_order", "Theta knots must be strictly ordered in the declared rotation direction.");
  if (knots.some(k => k.alphaRad < input.limits.articulationRad[0] || k.alphaRad > input.limits.articulationRad[1]))
    return fail("constraint_violated", "articulation_bound", "Linear trajectory articulation exceeds declared bounds.");
  const slopes = knots.slice(1).map((b, i) => (b.alphaRad - knots[i].alphaRad) / (b.thetaRad - knots[i].thetaRad));
  if (slopes.some(s => !Number.isFinite(s) || Math.abs(s) > input.limits.maxArticulationSlope))
    return fail("constraint_violated", "articulation_slope", "Linear trajectory exceeds the declared articulation slope bound.");
  result.poses = trajectoryPoses(input);
  if (input.sweep.fullCircle) {
    const first = result.poses[0], last = result.poses.at(-1)!;
    // Articulation is an unwrapped bounded joint coordinate; 2*pi joint winding is not assumed permissible.
    if (knots[0].alphaRad !== knots.at(-1)!.alphaRad)
      return fail("constraint_violated", "cycle_joint_seam", "Full-cycle articulation must close exactly without assumed joint winding.");
    const seamTolerance = Math.max(guard * 4, 1e-10);
    const points = (p: Pose) => [p.H, p.S, p.E, p.antenna, ...p.wheels, ...p.towers];
    if (points(first).some((p, i) => norm(sub(p.position, points(last)[i].position)) > seamTolerance))
      return fail("constraint_violated", "cycle_pose_seam", "Full-cycle poses do not close within the numerical guard.");
    const slopeGuard = ANGLE_GUARD * Math.max(1, Math.abs(slopes[0]), Math.abs(slopes.at(-1)!));
    if (Math.abs(slopes[0] - slopes.at(-1)!) > slopeGuard
      || points(first).some((p, i) => norm(sub(p.dTheta, points(last)[i].dTheta)) > seamTolerance))
      return fail("constraint_violated", "cycle_derivative_seam", "One-sided first derivatives do not close at the full-cycle seam.");
  }
  const required = input.model.bodyHalfWidthM + input.clearanceM;
  if (result.poses.some(p => poseClearance(input, p) < required - guard))
    return fail("constraint_violated", "knot_member_collision", "A supplied knot violates whole-member/offset clearance.");
  let status: Verdict = "verified_within_model";
  for (let i = 0; i < knots.length - 1; i++) {
    const intervalStatus = verifyInterval(input, knots[i], knots[i + 1], result, i, guard);
    if (intervalStatus === "constraint_violated") { result.status = intervalStatus; return result; }
    if (intervalStatus === "numerically_unresolved") status = intervalStatus;
  }
  result.status = status;
  if (status === "numerically_unresolved") result.issues.push({ code: "clearance_budget", message: "Strict clearance could not be established before depth, displacement tolerance, arithmetic, or operation budget was reached. Tolerance never relaxes clearance." });
  return result;
}

export interface SearchOptions { layers?: number; states?: number; maxTransitions?: number; alphaChangePenalty?: number }
export interface SearchResult {
  status: "candidate_found" | "search_found_no_candidate" | "missing_evidence";
  candidate?: ResearchInput; verification?: Verification; score?: number;
  transitionsChecked: number; proofIntervalsVisited: number; stoppedAtBudget: boolean; issues: Issue[];
  grid: { layers: number; states: number; maxTransitions: number; alphaChangePenalty: number };
  objective: string; guarantee: string;
}
export function generateTrajectory(value: unknown, options: SearchOptions = {}): SearchResult {
  const grid = { layers: options.layers ?? 33, states: options.states ?? 9, maxTransitions: options.maxTransitions ?? 30_000, alphaChangePenalty: options.alphaChangePenalty ?? 0.05 };
  const result: SearchResult = { status: "missing_evidence", transitionsChecked: 0, proofIntervalsVisited: 0, stoppedAtBudget: false, issues: [], grid,
    objective: "Minimize mean(1-cos(alpha)) + penalty*mean((dalpha/dtheta)^2), using trapezoidal alpha utility and exact piecewise-constant slope integration. Dimensionless extension/smoothness proxy, not irrigated area or water.",
    guarantee: "Finite deterministic angle-grid search only; no global/continuous optimality or infeasibility proof. Linear interpolation is retained and reverified." };
  result.issues = validateInput(value);
  if (result.issues.length) return result;
  if (!Number.isInteger(grid.layers) || grid.layers < 3 || grid.layers > 65 || !Number.isInteger(grid.states) || grid.states < 1 || grid.states > 21
    || !Number.isInteger(grid.maxTransitions) || grid.maxTransitions < 1 || grid.maxTransitions > 100_000 || !finite(grid.alphaChangePenalty) || grid.alphaChangePenalty < 0 || grid.alphaChangePenalty > 100) {
    result.issues.push({ code: "invalid_search_options", message: "Search requires layers 3..65, states 1..21, transitions 1..100000, penalty 0..100." }); return result;
  }
  const input = value as ResearchInput, [minAlpha, maxAlpha] = input.limits.articulationRad, n = grid.layers;
  const alphas = grid.states === 1 ? [(minAlpha + maxAlpha) / 2] : Array.from({ length: grid.states }, (_, i) => minAlpha + (maxAlpha - minAlpha) * i / (grid.states - 1));
  const theta = Array.from({ length: n }, (_, i) => i === n - 1 ? input.sweep.endRad : input.sweep.startRad + (input.sweep.endRad - input.sweep.startRad) * i / (n - 1));
  const guard = numericGuard(input);
  const utility = (a: number) => 1 - Math.cos(a);
  type Path = { indices: number[]; score: number };
  const edgeCache = new Map<string, boolean>();
  const edge = (layer: number, from: number, to: number): boolean => {
    const key = `${layer}:${from}:${to}`, cached = edgeCache.get(key); if (cached !== undefined) return cached;
    if (result.transitionsChecked >= grid.maxTransitions || result.proofIntervalsVisited >= MAX_VISITED_INTERVALS) { result.stoppedAtBudget = true; return false; }
    result.transitionsChecked++;
    const a = { thetaRad: theta[layer - 1], alphaRad: alphas[from] }, b = { thetaRad: theta[layer], alphaRad: alphas[to] };
    if (Math.abs((b.alphaRad - a.alphaRad) / (b.thetaRad - a.thetaRad)) > input.limits.maxArticulationSlope) { edgeCache.set(key, false); return false; }
    const proof = initialResult(input); proof.stats.visitedIntervals = result.proofIntervalsVisited;
    const clear = verifyInterval(input, a, b, proof, layer - 1, guard) === "verified_within_model";
    result.proofIntervalsVisited = proof.stats.visitedIntervals;
    edgeCache.set(key, clear); return clear;
  };
  let best: Path | undefined;
  // Closed paths pin both opening states. That retains the first edge needed to
  // enforce an equal closing slope instead of discarding seam history in DP.
  const starts: Array<[number | undefined, number | undefined]> = input.sweep.fullCircle
    ? alphas.flatMap((_, a) => alphas.map((__, b) => [a, b] as [number, number])) : [[undefined, undefined]];
  for (const [start, second] of starts) {
    let paths = new Map<number, Path>();
    alphas.forEach((_, i) => { if (start === undefined || start === i) paths.set(i, { indices: [i], score: 0 }); });
    for (let layer = 1; layer < n && paths.size; layer++) {
      const next = new Map<number, Path>();
      for (let to = 0; to < alphas.length; to++) {
        if (layer === 1 && second !== undefined && to !== second) continue;
        if (layer === n - 1 && start !== undefined && to !== start) continue;
        for (const [from, path] of paths) {
          if (layer === n - 1 && start !== undefined && second !== undefined) {
            const openingSlope = (alphas[second] - alphas[start]) / (theta[1] - theta[0]);
            const closingSlope = (alphas[to] - alphas[from]) / (theta[layer] - theta[layer - 1]);
            if (Math.abs(openingSlope - closingSlope) > ANGLE_GUARD * Math.max(1, Math.abs(openingSlope), Math.abs(closingSlope))) continue;
          }
          if (!edge(layer, from, to)) continue;
          const slope = (alphas[to] - alphas[from]) / (theta[layer] - theta[layer - 1]);
          const score = path.score + ((utility(alphas[from]) + utility(alphas[to])) / 2 + grid.alphaChangePenalty * slope * slope) / (n - 1);
          if (!next.has(to) || score < next.get(to)!.score) next.set(to, { indices: [...path.indices, to], score });
        }
      }
      paths = next;
      if (result.stoppedAtBudget) break;
    }
    for (const path of paths.values()) if (path.indices.length === n && (!best || path.score < best.score)) best = path;
    if (result.stoppedAtBudget) break;
  }
  result.status = "search_found_no_candidate";
  if (best) {
    const candidate = { ...input, trajectory: { interpolation: "linear" as const, knots: best.indices.map((a, i) => ({ thetaRad: theta[i], alphaRad: alphas[a] })) } };
    const verification = verifyTrajectory(candidate);
    if (verification.status === "verified_within_model") { result.status = "candidate_found"; result.candidate = candidate; result.verification = verification; result.score = best.score; }
    else result.issues.push({ code: "candidate_recheck_failed", message: `Best grid candidate failed whole-trajectory verification: ${verification.status}. No feasible-domain conclusion follows.` });
  }
  return result;
}
