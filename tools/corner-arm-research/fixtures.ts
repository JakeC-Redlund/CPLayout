import type { ResearchInput, Verdict, XY } from "./core";

export interface Fixture { input: ResearchInput; expected: Verdict; purpose: string }
export const box = (xmin: number, ymin: number, xmax: number, ymax: number): XY[] => [[xmin, ymin], [xmax, ymin], [xmax, ymax], [xmin, ymax]];
export function baseInput(id = "base"): ResearchInput {
  return { schemaVersion: "cplayout-corner-research-v1", id,
    model: { pivot: [0, 0], mainRadiusM: 10, armLengthM: 4, overhangM: 1, bodyHalfWidthM: 0.1,
      antennaOffsetM: [-2, 0.5], wheelOffsetsM: [[-1, 0.4], [-1, -0.4]], towerRadiiM: [3, 7, 10] },
    limits: { articulationRad: [-2, 2], maxArticulationSlope: 5 }, field: { outer: box(-25, -25, 25, 25), holes: [] }, obstacles: [],
    sweep: { startRad: -0.6, endRad: 0.6, fullCircle: false }, clearanceM: 0.1, maxDepth: 18, toleranceM: 1e-7,
    trajectory: { interpolation: "linear", knots: [{ thetaRad: -0.6, alphaRad: 0.3 }, { thetaRad: 0.6, alphaRad: 0.3 }] } };
}
function constant(input: ResearchInput, start: number, end: number, alpha: number, fullCircle = false): ResearchInput {
  input.sweep = { startRad: start, endRad: end, fullCircle };
  input.trajectory.knots = [{ thetaRad: start, alphaRad: alpha }, { thetaRad: end, alphaRad: alpha }]; return input;
}
export function buildFixtures(): Fixture[] {
  const out: Fixture[] = [];
  const add = (id: string, expected: Verdict, purpose: string, edit: (input: ResearchInput) => void = () => {}) => {
    const input = baseInput(id); edit(input); out.push({ input, expected, purpose });
  };
  for (const [id, edge, alphaMin] of [["roomy-circle", 60, -1.4], ["square-layout", 42, 0]] as const) {
    add(id, "verified_within_model", "Full-circle baseline and deterministic graph/SciPy comparison; hinge-coincident synthetic dimensions.", i => {
      i.model.mainRadiusM = 30; i.model.armLengthM = 10; i.model.overhangM = 3; i.model.bodyHalfWidthM = 0.25;
      i.model.towerRadiiM = [10, 20, 30]; i.model.wheelOffsetsM = [[0, -0.4], [0, 0.4]]; i.model.antennaOffsetM = [-0.5, 0.3];
      i.clearanceM = 0.5; i.field.outer = box(-edge, -edge, edge, edge); i.limits = { articulationRad: [alphaMin, 1.4], maxArticulationSlope: 1.5 };
      constant(i, 0, 2 * Math.PI, 0.8, true);
    });
  }
  add("rectangle-open", "verified_within_model", "Open partial sweep with buffered full members in a rectangle.");
  add("reverse-open-offsets", "verified_within_model", "Clockwise partial sweep; asymmetric antenna and wheel offsets.", i => { constant(i, 0.6, -0.6, -0.4); });
  add("reverse-full-circle", "verified_within_model", "Clockwise full revolution and derivative closure.", i => { constant(i, Math.PI, -Math.PI, -0.4, true); });
  add("straight-sdu-knot-guide", "verified_within_model", "Analytic y=0 SDU guide supplies reachable angle knots only; linear interpolation is not claimed to follow that guide between knots.", i => {
    constant(i, -0.2, 0.2, 0);
    i.trajectory.knots = Array.from({ length: 33 }, (_, n) => {
      const thetaRad = n === 32 ? 0.2 : -0.2 + 0.4 * n / 32;
      const alphaRad = Math.asin(-i.model.mainRadiusM * Math.sin(thetaRad) / i.model.armLengthM) - thetaRad;
      return { thetaRad, alphaRad: alphaRad === 0 ? 0 : alphaRad };
    });
  });
  add("concave-clear", "verified_within_model", "Concave field remains clear throughout the partial sweep.", i => { i.field.outer = [[-25, -25], [25, -25], [25, 25], [5, 25], [5, 20], [-25, 20]]; });
  add("concave-interior-exit", "constraint_violated", "Both member endpoints are inside but the main segment crosses a concave notch.", i => {
    constant(i, -0.01, 0.01, 0); i.field.outer = [[-20, -20], [20, -20], [20, 20], [7, 20], [7, -1], [3, -1], [3, 20], [-20, 20]];
  });
  add("hole-interior-collision", "constraint_violated", "Main member crosses a field hole although hinge and pivot are outside it.", i => {
    constant(i, -0.1, 0.1, 0); i.field.holes = [box(4.5, -0.25, 5.5, 0.25)];
  });
  add("obstacle-main-interior", "constraint_violated", "Whole-member interior obstacle collision.", i => { constant(i, -0.1, 0.1, 0); i.obstacles = [box(4.5, -0.25, 5.5, 0.25)]; });
  add("obstacle-overhang", "constraint_violated", "Overhang hits obstacle beyond SDU.", i => { constant(i, -0.01, 0.01, 0); i.obstacles = [box(14.4, -0.25, 14.6, 0.25)]; });
  add("between-sample-collision", "constraint_violated", "Endpoints and original interval midpoint are clear; recursive proof finds collision near pi/8.", i => {
    constant(i, 0, Math.PI / 2, 0); const x = 12.5 * Math.cos(Math.PI / 8), y = 12.5 * Math.sin(Math.PI / 8);
    i.obstacles = [box(x - 0.1, y - 0.1, x + 0.1, y + 0.1)];
  });
  add("offset-only-collision", "constraint_violated", "Buffered offset point collides outside the structural member centerlines.", i => {
    constant(i, -0.01, 0.01, 0); i.model.antennaOffsetM = [0, 8]; i.obstacles = [box(13.9, 7.9, 14.1, 8.1)];
  });
  add("close-positive-gap", "verified_within_model", "A small positive clearance is proven without relaxing the requested buffer.", i => {
    constant(i, -0.001, 0.001, 0); i.field.outer = box(-25, -25, 15.2001, 25);
  });
  add("tangent-buffer", "numerically_unresolved", "Exact tangent at the midpoint must never pass by epsilon slack.", i => {
    constant(i, -0.001, 0.001, 0); i.field.outer = box(-25, -25, 15.2, 25);
  });
  add("budget-unresolved", "numerically_unresolved", "Insufficient subdivision depth is an unresolved result, not infeasibility.", i => {
    constant(i, 0, 2 * Math.PI, 0, true); i.maxDepth = 0;
  });
  add("joint-cycle-open", "constraint_violated", "Full-cycle articulation seam remains open.", i => {
    constant(i, 0, 2 * Math.PI, 0, true); i.trajectory.knots[1].alphaRad = 0.2;
  });
  add("derivative-cycle-open", "constraint_violated", "Full-cycle positions close but first derivatives do not.", i => {
    constant(i, 0, 2 * Math.PI, 0, true); i.trajectory.knots.splice(1, 0, { thetaRad: Math.PI, alphaRad: 0.5 });
  });
  add("partial-no-closure-required", "verified_within_model", "An open partial sweep may end at a different articulation.", i => { i.trajectory.knots[1].alphaRad = 0.6; });
  add("large-translated-coordinates", "verified_within_model", "Same local problem translated to large projected coordinates.", i => {
    const shift = (p: XY): XY => [p[0] + 1e9, p[1] - 1e9]; i.model.pivot = shift(i.model.pivot); i.field.outer = i.field.outer.map(shift);
  });
  add("invalid-bowtie", "missing_evidence", "Reject a self-intersecting ring.", i => { i.field.outer = [[-25, -25], [25, 25], [-25, 25], [25, -25]]; });
  add("invalid-knot-order", "missing_evidence", "Reject unordered unwrapped theta knots.", i => { i.trajectory.knots.splice(1, 0, { thetaRad: 1, alphaRad: 0.3 }); });
  add("invalid-missing-sweep-end", "missing_evidence", "No epsilon-based omission of final sweep coverage.", i => { i.trajectory.knots[1].thetaRad -= 1e-12; });
  add("slope-limit", "constraint_violated", "Hard articulation-slope bound.", i => { i.limits.maxArticulationSlope = 0.1; i.trajectory.knots[1].alphaRad = 1; });
  add("articulation-limit", "constraint_violated", "Hard articulation bounds.", i => { i.trajectory.knots[1].alphaRad = 3; });
  add("clipped-endpoint-negative", "constraint_violated", "Illustrates why clipping visible endpoint/envelope to field cannot validate physical reach.", i => {
    constant(i, -0.01, 0.01, 0); i.field.outer = box(-20, -20, 14, 20);
  });
  return out;
}
