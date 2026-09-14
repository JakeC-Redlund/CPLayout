import assert from "node:assert/strict";

import { sampleProject } from "@cplayout/core";
import { rankLayoutAlternatives, scoreLayoutAlternative } from "./layoutScoring";

const originalPivotCenter = { ...sampleProject.pivotCenter };
const comparisonProject = { ...sampleProject, obstacles: [] };
const comparisonConstraints = { minCoveragePercent: 0, maxOutsideFieldAcres: Number.MAX_VALUE };

const lowerConfidence = scoreLayoutAlternative({
  id: "operator-draft",
  project: comparisonProject,
  confidence: 0.25,
  source: "operator",
}, comparisonConstraints);

const higherConfidence = scoreLayoutAlternative({
  id: "model-review",
  project: comparisonProject,
  confidence: 0.9,
  source: "model",
}, comparisonConstraints);

assert.ok(higherConfidence.score > lowerConfidence.score);
assert.equal(higherConfidence.project, comparisonProject);

const outsideFieldAlternative = {
  ...sampleProject,
  pivotCenter: { x: sampleProject.pivotCenter.x + 900, y: sampleProject.pivotCenter.y },
};

const ranked = rankLayoutAlternatives([
  { id: "outside-field", project: outsideFieldAlternative, confidence: 0.95, source: "model" },
  { id: "current-layout", project: sampleProject, confidence: 0.75, source: "operator" },
], {
  maxOutsideFieldAcres: 1,
  minCoveragePercent: 20,
});

assert.equal(ranked[0].id, "current-layout");
assert.ok(ranked[0].metrics.outsideFieldAcres <= ranked[1].metrics.outsideFieldAcres);
assert.deepEqual(sampleProject.pivotCenter, originalPivotCenter);

const hardBoundaryRanked = rankLayoutAlternatives([
  { id: "outside-field", project: outsideFieldAlternative, confidence: 1, source: "model" },
  { id: "current-layout", project: sampleProject, confidence: 0.1, source: "operator" },
], {
  hardBoundary: true,
  boundaryEpsilonSquareMeters: 0.01,
  maxOutsideFieldAcres: 0.0001,
  minCoveragePercent: 1,
});

assert.equal(hardBoundaryRanked.at(-1)?.id, "outside-field");
assert.equal(hardBoundaryRanked.at(-1)?.feasible, false);
assert.ok((hardBoundaryRanked.at(-1)?.disqualificationReasons.length ?? 0) > 0);

console.log("layout scoring tests passed");
