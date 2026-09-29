import assert from "node:assert/strict";
import { squareMetersToAcres, type MultiPolygonXY, type XY } from "@cplayout/core";
import { accountCornerFootprints } from "./cornerPathAccounting";

for (const origin of [{ x: 0, y: 0 }, { x: 500000, y: 4500000 }]) {
  const rectangle = (left: number, bottom: number, right: number, top: number): XY[] => [
    { x: origin.x + left, y: origin.y + bottom }, { x: origin.x + right, y: origin.y + bottom },
    { x: origin.x + right, y: origin.y + top }, { x: origin.x + left, y: origin.y + top },
  ];
  const candidates: MultiPolygonXY[] = [
    [[rectangle(0, 0, 10, 10)]], [[rectangle(5, 0, 15, 10)]], [[rectangle(7, 0, 12, 10)]],
  ];
  const baseline: MultiPolygonXY[] = [
    [[rectangle(0, 0, 4, 10)]], [[rectangle(2, 0, 8, 10)]], [[rectangle(3, 0, 6, 10)]],
  ];
  const field = rectangle(-1, -1, 14, 11);
  const before = structuredClone({ candidates, baseline, field });
  const result = accountCornerFootprints(candidates, field, baseline);
  // Candidate union is 150 m²; field clips 10 m²; baseline union is 80 m².
  assert.equal(result.potentialFootprintAcres, squareMetersToAcres(140));
  assert.equal(result.netAdditionalFootprintAcres, squareMetersToAcres(60));
  assert.equal(result.baselineStatus, "supplied");
  assert.equal(result.method, "sampled-potential-footprint-union-v1");
  assert.match(result.qualification, /not proven irrigated area/);
  assert.deepEqual({ candidates, baseline, field }, before);
  const reordered = accountCornerFootprints([...candidates].reverse(), field, [...baseline].reverse());
  assert.equal(reordered.netAdditionalFootprintAcres, result.netAdditionalFootprintAcres);
  const duplicates = accountCornerFootprints([...candidates, ...candidates], field, [...baseline, ...baseline]);
  assert.equal(duplicates.netAdditionalFootprintAcres, result.netAdditionalFootprintAcres);
  const unknown = accountCornerFootprints(candidates, field);
  assert.equal(unknown.netAdditionalFootprintAcres, null);
  assert.equal(unknown.netAdditionalFootprint, null);
  assert.equal(unknown.baselineStatus, "missing");
  assert.equal(accountCornerFootprints(candidates, field, []).netAdditionalFootprintAcres, squareMetersToAcres(140));
  assert.equal(accountCornerFootprints(candidates, field, [[[field]]]).netAdditionalFootprintAcres, 0);
  const tiny = accountCornerFootprints([[[rectangle(0, 0, 0.001, 0.001)]]], field, []);
  assert.ok(tiny.netAdditionalFootprintAcres! > 0);
  assert.equal(Number(tiny.netAdditionalFootprintAcres!.toFixed(6)), 0, "Raw accounting retains acreage smaller than display precision.");
}

// Independent rectangular conservation oracle, including overlapping exclusions and a hole.
for (const origin of [{ x: 0, y: 0 }, { x: 524288, y: 4194304 }]) {
  const ring = (x1: number, y1: number, x2: number, y2: number): XY[] => [
    { x: origin.x + x1, y: origin.y + y1 }, { x: origin.x + x2, y: origin.y + y1 },
    { x: origin.x + x2, y: origin.y + y2 }, { x: origin.x + x1, y: origin.y + y2 },
  ];
  const field = ring(0, 0, 10, 10);
  const wet: MultiPolygonXY[] = [[[ring(-2, 0, 12, 10)]]];
  const exclusions: MultiPolygonXY[] = [[[ring(0, 0, 3, 10)]], [[ring(2, 0, 4, 10)]]];
  const baseline: MultiPolygonXY[] = [[[ring(3, 0, 6, 10)]]];
  const result = accountCornerFootprints(wet, field, baseline, { noSprayFootprints: exclusions });
  assert.deepEqual(result.areasSquareMeters, { grossPotential: 140, outsideField: 40, insideField: 100,
    excludedNoSpray: 40, eligiblePotential: 60, baselineOverlap: 20, netAdditional: 40 });
  const duplicateExclusions = accountCornerFootprints(wet, field, baseline,
    { noSprayFootprints: [...exclusions].reverse().concat(exclusions) });
  assert.deepEqual(duplicateExclusions.areasSquareMeters, result.areasSquareMeters);
  const unknown = accountCornerFootprints(wet, field, [], { reachStatus: "missing" });
  assert.equal(unknown.potentialFootprintAcres, null);
  assert.equal(unknown.netAdditionalFootprint, null);
  assert.ok(Object.values(unknown.areasSquareMeters).every(value => value === null));
  assert.equal(unknown.convergence, "unknown_reach");
  const zero = accountCornerFootprints(wet, field, [], { reachStatus: "explicit_zero" });
  assert.equal(zero.potentialFootprintAcres, 0);
  assert.ok(Object.values(zero.areasSquareMeters).every(value => value === 0));
  assert.equal(accountCornerFootprints(wet, field, undefined, { reachStatus: "explicit_zero" }).netAdditionalFootprintAcres, null);
  // The no-spray polygon is a ring surrounding a 2 by 2 permitted hole.
  const hole = accountCornerFootprints([[[field]]], field, [], {
    noSprayFootprints: [[[ring(2, 2, 8, 8), ring(4, 4, 6, 6).reverse()]]],
  });
  assert.equal(hole.areasSquareMeters.excludedNoSpray, 32);
  assert.equal(hole.areasSquareMeters.eligiblePotential, 68);
}
