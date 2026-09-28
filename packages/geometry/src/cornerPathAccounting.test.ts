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
