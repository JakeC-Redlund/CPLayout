import assert from "node:assert/strict";
import { test } from "node:test";

import { sampleProject, type PivotProject } from "@cplayout/core";
import {
  createCirclePolygon, evaluateLayout, polygonAreaSquareMeters, validateWetCoverageWithinField,
} from "./geometry";
import { scoreLayoutAlternative } from "./layoutScoring";
import { buildAdvisoryMachineRenderModel } from "./advisoryMachineRenderModel";

const project: PivotProject = {
  ...sampleProject,
  pivotCenter: { x: 0, y: 0 },
  fieldBoundary: [{ x: -200, y: -200 }, { x: 200, y: -200 }, { x: 200, y: 200 }, { x: -200, y: 200 }],
  machine: { ...sampleProject.machine, spanLengthsMeters: [50, 50], overhangMeters: 0,
    endGunThrowMeters: 0, cornerArm: undefined, sweep: { mode: "full_circle" } },
  obstacles: [], mapFeatures: [],
};

test("small areas are stable at projected coordinate offsets", () => {
  const ring = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 0.1 }, { x: 0, y: 0.1 }];
  const translated = ring.map(({ x, y }) => ({ x: x + 500000, y: y + 4500000 }));
  assert.ok(Math.abs(polygonAreaSquareMeters(translated) - 0.01) < 1e-9);
  assert.ok(Math.abs(polygonAreaSquareMeters([...translated].reverse()) - 0.01) < 1e-9);
});

test("hard obstacles between tower tracks remain mechanical conflicts", () => {
  const result = evaluateLayout({ ...project, obstacles: [{
    id: "between-tracks", name: "Between tracks", kind: "building", confidence: "user_estimated",
    polygon: [{ x: 74, y: -1 }, { x: 76, y: -1 }, { x: 76, y: 1 }, { x: 74, y: 1 }],
    bufferMeters: 0, hardConflict: true, noSpray: false,
  }] });
  assert.equal(result.metrics.hardMechanicalConflictCount, 1);
  assert.equal(result.metrics.towerTrackConflictCount, 0);
  assert.ok(result.mechanicalConflicts.some((conflict) => conflict.conflictType === "machine_path"));
});

test("sampled circle equality does not prove true-circle containment", () => {
  const result = validateWetCoverageWithinField({ ...project, fieldBoundary: createCirclePolygon(project.pivotCenter, 100) });
  assert.equal(result.feasible, false);
});

test("machine length and other explicit limits are hard constraints", () => {
  const alternative = { id: "limited", project, confidence: 1, source: "operator" as const };
  assert.equal(scoreLayoutAlternative(alternative, { minCoveragePercent: 0, maxMachineRadiusMeters: 100 }).feasible, true);
  for (const [limits, reason] of [
    [{ maxMachineRadiusMeters: 10 }, "Machine radius"], [{ minCoveragePercent: 90 }, "Coverage"],
  ] as const) {
    const result = scoreLayoutAlternative(alternative, { minCoveragePercent: 0, ...limits });
    assert.equal(result.feasible, false);
    assert.equal(result.score, 0);
    assert.ok(result.disqualificationReasons.some((message) => message.startsWith(reason)));
  }
});

test("nonfinite or negative ranking parameters cannot produce eligible scores", () => {
  const alternative = { id: "invalid", project, confidence: 1, source: "operator" as const };
  for (const value of [NaN, Infinity, -1]) {
    assert.throws(() => scoreLayoutAlternative(alternative, { maxMachineRadiusMeters: value }));
    assert.throws(() => scoreLayoutAlternative(alternative, {}, { coverage: value }));
  }
});

test("derived outline rendering preserves zero throw and does not install a corner arm", () => {
  const source: PivotProject = { ...project, mapFeatures: [{
    id: "outline", name: "Outline", kind: "machine_zone", confidence: "imagery_digitized",
    geometry: { type: "LineString", vertices: createCirclePolygon(project.pivotCenter, 100, 36) },
    properties: { preferredMachineOutline: true },
  }] };
  const before = JSON.stringify(source);
  const result = buildAdvisoryMachineRenderModel(source);
  assert.equal(result.instances.length, 1);
  assert.equal(result.instances[0].machine.endGunThrowMeters, 0);
  assert.equal(result.instances[0].machine.cornerArm, undefined);
  assert.equal(result.surfaces[0].endGunAcres, 0);
  assert.equal(result.surfaces[0].cornerArmAcres, 0);
  assert.equal(JSON.stringify(source), before);
});
