import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { forwardPose, generateTrajectory, orientation, pointInRing, pointSegmentDistance, segmentsIntersect, verifyTrajectory, type ResearchInput, type XY } from "./core";
import { baseInput, box, buildFixtures } from "./fixtures";
import { librarySanity, loadInput, runCli } from "./cli";

const near = (a: number, b: number, tolerance = 1e-10): void => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} within ${tolerance}`);
const fixture = (id: string): ResearchInput => loadInput(`fixtures/corner-arm-research/${id}.json`) as ResearchInput;
for (const { input, expected, purpose } of buildFixtures()) {
  test(`frozen fixture: ${input.id} — ${purpose}`, () => {
    const frozen = fixture(input.id);
    assert.deepEqual(frozen, input, "Frozen JSON differs from fixture construction; intentionally update both to change an experiment.");
    const result = verifyTrajectory(frozen);
    assert.equal(result.status, expected, JSON.stringify(result.issues));
    if (result.status === "verified_within_model") {
      assert.ok(result.stats.certifiedIntervals > 0);
      assert.ok(result.stats.minCertifiedMarginM! > 0);
    }
  });
}
test("manifest lists precisely the frozen suite", () => {
  const manifest = JSON.parse(readFileSync("fixtures/corner-arm-research/manifest.json", "utf8")) as Array<{ id: string }>;
  assert.deepEqual(manifest.map(m => m.id), buildFixtures().map(f => f.input.id));
});
test("analytic circles, main towers, arm length, and overhang length", () => {
  const input = baseInput(), alpha = 0.47;
  for (let n = 0; n <= 32; n++) {
    const t = n * 2 * Math.PI / 32, p = forwardPose(input, t, alpha);
    near(Math.hypot(...p.H.position), 10);
    near(Math.hypot(...p.S.position), Math.sqrt(100 + 16 + 80 * Math.cos(alpha)));
    near(Math.hypot(...p.E.position), Math.sqrt(100 + 25 + 100 * Math.cos(alpha)));
    near(Math.hypot(p.S.position[0] - p.H.position[0], p.S.position[1] - p.H.position[1]), 4);
    near(Math.hypot(p.E.position[0] - p.S.position[0], p.E.position[1] - p.S.position[1]), 1);
    p.towers.forEach((tower, i) => near(Math.hypot(...tower.position), input.model.towerRadiiM[i]));
  }
});
test("moving-frame offsets and analytic derivatives match independent finite differences", () => {
  const input = baseInput(), p = forwardPose(input, Math.PI / 2, -Math.PI / 2);
  near(p.wheels[0].position[0], 3); near(p.wheels[0].position[1], 10.4);
  near(p.wheels[0].dTheta[0], -10.4); near(p.wheels[0].dTheta[1], 3);
  for (const slope of [-1.2, 0, 0.7]) {
    const t = 0.31, a = -0.21, h = 1e-4;
    const mid = forwardPose(input, t, a, slope), before = forwardPose(input, t - h, a - slope * h, slope), after = forwardPose(input, t + h, a + slope * h, slope);
    for (const key of ["H", "S", "E", "antenna"] as const) for (const axis of [0, 1]) {
      near(mid[key].dTheta[axis], (after[key].position[axis] - before[key].position[axis]) / (2 * h), 2e-7);
      near(mid[key].ddTheta[axis], (after[key].position[axis] - 2 * mid[key].position[axis] + before[key].position[axis]) / (h * h), 2e-6);
    }
  }
});
test("shared SDU-relative antenna convention gives (-2,41) for R30 L10 at theta pi/2", () => {
  const input = baseInput(); input.model.mainRadiusM = 30; input.model.armLengthM = 10; input.model.antennaOffsetM = [1, 2];
  const antenna = forwardPose(input, Math.PI / 2, 0).antenna;
  near(antenna.position[0], -2); near(antenna.position[1], 41);
  near(antenna.dTheta[0], -41); near(antenna.dTheta[1], -2);
  near(antenna.ddTheta[0], 2); near(antenna.ddTheta[1], -41);
});
test("analytic straight SDU guide is honored at supplied knots only", () => {
  const input = fixture("straight-sdu-knot-guide");
  for (const k of input.trajectory.knots) near(forwardPose(input, k.thetaRad, k.alphaRad).S.position[1], 0);
  const [a, b] = input.trajectory.knots;
  assert.ok(Math.abs(forwardPose(input, (a.thetaRad + b.thetaRad) / 2, (a.alphaRad + b.alphaRad) / 2).S.position[1]) > 1e-7,
    "No unsupported continuous guide tracking claim may be inferred from the knot oracle.");
});
test("exact orientation and topology include tangencies and concave crossings", () => {
  assert.equal(orientation([1e12, 1e12], [1e12 + 10, 1e12 + 10], [1e12 + 20, 1e12 + 20]), 0);
  assert.equal(orientation([0, 0], [1, 1], [2, 2 + Number.EPSILON * 2]), 1);
  assert.equal(segmentsIntersect([0, 0], [2, 0], [1, 0], [1, 2]), true);
  assert.equal(segmentsIntersect([0, 0], [2, 0], [3, 0], [4, 0]), false);
  assert.equal(pointInRing([0, 1], box(0, 0, 2, 2)), 0);
  assert.equal(pointInRing([1, 1], box(0, 0, 2, 2)), 1);
  near(pointSegmentDistance([1, 2], [0, 0], [2, 0]), 2);
});
test("between-sample collision requires subdivision and is detected", () => {
  const result = verifyTrajectory(fixture("between-sample-collision"));
  assert.equal(result.status, "constraint_violated"); assert.equal(result.stats.deepestSubdivision, 1);
  assert.equal(result.issues[0].thetaRad, Math.PI / 8);
});
test("offset extent participates in the continuous displacement bound", () => {
  const input = baseInput("moving-offset"); input.model.antennaOffsetM = [0, 100]; input.field.outer = box(-200, -200, 200, 200);
  input.sweep = { startRad: 0, endRad: 0.2, fullCircle: false }; input.trajectory.knots = [{ thetaRad: 0, alphaRad: 0 }, { thetaRad: 0.2, alphaRad: 0 }];
  const target = forwardPose(input, 0.05, 0).antenna.position;
  input.obstacles = [box(target[0] - 0.1, target[1] - 0.1, target[0] + 0.1, target[1] + 0.1)];
  const result = verifyTrajectory(input); assert.equal(result.status, "constraint_violated");
  assert.equal(result.issues[0].thetaRad, 0.05);
});
test("tolerance is a stop threshold and never a clearance relaxation", () => {
  const tangent = fixture("tangent-buffer"); tangent.toleranceM = 100;
  assert.equal(verifyTrajectory(tangent).status, "numerically_unresolved");
  const collision = fixture("clipped-endpoint-negative"); collision.toleranceM = 100;
  assert.equal(verifyTrajectory(collision).status, "constraint_violated");
});
test("both winding orientations and metre scaling preserve ordinary verdicts", () => {
  for (const id of ["rectangle-open", "concave-interior-exit", "hole-interior-collision"]) {
    const input = fixture(id), expected = verifyTrajectory(input).status;
    input.field.outer.reverse(); input.field.holes.forEach(h => h.reverse());
    assert.equal(verifyTrajectory(input).status, expected);
    const factor = 17, point = (p: XY): XY => [p[0] * factor, p[1] * factor];
    input.model.pivot = point(input.model.pivot); input.model.antennaOffsetM = point(input.model.antennaOffsetM);
    input.model.wheelOffsetsM = input.model.wheelOffsetsM.map(point); input.model.towerRadiiM = input.model.towerRadiiM.map(r => r * factor);
    for (const k of ["mainRadiusM", "armLengthM", "overhangM", "bodyHalfWidthM"] as const) input.model[k] *= factor;
    input.field.outer = input.field.outer.map(point); input.field.holes = input.field.holes.map(h => h.map(point)); input.obstacles = input.obstacles.map(h => h.map(point));
    input.clearanceM *= factor; input.toleranceM *= factor;
    assert.equal(verifyTrajectory(input).status, expected);
  }
});
test("invalid inputs fail closed without throwing or emitting non-finite JSON", () => {
  for (const value of [null, {}, [], "missing", { ...baseInput(), clearanceM: Infinity }, { ...baseInput(), maxDepth: -1 }])
    assert.equal(verifyTrajectory(value).status, "missing_evidence");
  const mutations: Array<(i: ResearchInput) => void> = [
    i => { i.model.pivot[0] = NaN; }, i => { i.model.armLengthM = -1; }, i => { i.model.wheelOffsetsM.push([Infinity, 0]); },
    i => { i.field.outer.push(i.field.outer[0]); }, i => { i.field.holes = [box(30, 30, 31, 31)]; },
    i => { i.field.holes = [box(2, 2, 4, 4), box(3, 3, 5, 5)]; },
    i => { i.trajectory.knots[0].alphaRad = Infinity; }, i => { i.sweep.fullCircle = true; },
  ];
  for (const change of mutations) { const input = baseInput(); change(input); assert.equal(verifyTrajectory(input).status, "missing_evidence"); }
});
test("full-cycle derivative mismatch is rejected at large translated coordinates", () => {
  const input = fixture("derivative-cycle-open"); input.model.pivot = [1e9, 1e9]; input.field.outer = input.field.outer.map(p => [p[0] + 1e9, p[1] + 1e9]);
  const result = verifyTrajectory(input); assert.equal(result.status, "constraint_violated"); assert.equal(result.issues[0].code, "cycle_derivative_seam");
});
test("graph yields deterministic verified full cycles with useful finite search objective", () => {
  for (const id of ["roomy-circle", "square-layout"]) {
    const input = fixture(id), options = { layers: 32, states: 9, maxTransitions: 30000 };
    const a = generateTrajectory(input, options), b = generateTrajectory(input, options);
    assert.deepEqual(a, b); assert.equal(a.status, "candidate_found"); assert.equal(a.verification!.status, "verified_within_model");
    assert.equal(verifyTrajectory(a.candidate).status, "verified_within_model"); assert.ok(a.score! < 1 - Math.cos(0.8));
    assert.equal(a.stoppedAtBudget, false); assert.ok(a.transitionsChecked <= options.maxTransitions);
    assert.equal(input.trajectory.knots.length, 2, "Generator must not mutate supplied baseline.");
  }
});
test("graph supports partial/reverse paths and distinguishes finite failure from infeasibility", () => {
  const partial = fixture("reverse-open-offsets");
  assert.equal(generateTrajectory(partial, { layers: 5, states: 5 }).status, "candidate_found");
  const failed = generateTrajectory(fixture("obstacle-main-interior"), { layers: 5, states: 5 });
  assert.equal(failed.status, "search_found_no_candidate"); assert.match(failed.guarantee, /no global\/continuous optimality or infeasibility proof/);
  const budget = generateTrajectory(fixture("square-layout"), { maxTransitions: 1 });
  assert.equal(budget.status, "search_found_no_candidate"); assert.equal(budget.stoppedAtBudget, true);
  assert.equal(generateTrajectory(partial, { layers: Infinity }).status, "missing_evidence");
});
test("runner independently checks both polygon libraries and analytic projection", () => { assert.equal(librarySanity().pass, true); });
test("CLI exposes direct verifier/search results and input/source identity", () => {
  const result = runCli(["verify", "fixtures/corner-arm-research/rectangle-open.json"]) as Record<string, unknown>;
  assert.equal(result.status, "verified_within_model"); assert.ok(result.identity);
  const generated = runCli(["generate", "fixtures/corner-arm-research/rectangle-open.json", "--layers", "5", "--states", "5", "--max-transitions", "200"]) as Record<string, unknown>;
  assert.equal(generated.status, "candidate_found");
  assert.throws(() => runCli(["generate", "fixtures/corner-arm-research/rectangle-open.json", "--surprise", "1"]));
});
