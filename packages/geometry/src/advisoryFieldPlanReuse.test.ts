import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { PivotProject } from "@cplayout/core";
import {
  buildPivotPlacementCandidates,
  buildPivotPlacementCandidatesSteps,
  planAdvisoryFieldPivots,
  planAdvisoryFieldPivotsSteps,
  type AdvisoryFieldPivotPlanOptions,
} from "./advisoryPivotPlacement";
import type { Calculation } from "./calculation";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rectangle = (width: number, height: number) => [
  { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height },
];

function syntheticProject(): PivotProject {
  return {
    id: "field-plan-reuse-synthetic",
    name: "Synthetic field plan reuse",
    projectCrs: "EPSG:32613",
    unitSystem: "metric",
    fieldBoundary: rectangle(360, 240),
    pivotCenter: { x: 60, y: 60 },
    waterSource: { x: 0, y: 0 },
    powerSource: { x: 360, y: 240 },
    machine: {
      id: "synthetic-machine", name: "Synthetic machine",
      spanLengthsMeters: [20, 20], overhangMeters: 0, endGunThrowMeters: 0,
      towerClearanceBufferMeters: 2, machineClearanceBufferMeters: 4,
      sweep: { mode: "full_circle" },
    },
    obstacles: [], surveyPoints: [], mapFeatures: [],
  };
}

const baseline = syntheticProject();
const obstacles = syntheticProject();
obstacles.obstacles = [{
  id: "synthetic-obstacle", name: "Synthetic no-spray building", kind: "building",
  polygon: rectangle(35, 35).map(({ x, y }) => ({ x: x + 145, y: y + 100 })),
  bufferMeters: 8, hardConflict: true, noSpray: true, confidence: "user_estimated",
}];
const nearIds = syntheticProject();
nearIds.fieldBoundary = rectangle(0.024, 200);
nearIds.pivotCenter = { x: 0.0121, y: 100 };
nearIds.machine.spanLengthsMeters = [0.0014];
nearIds.machine.towerClearanceBufferMeters = 0;
nearIds.machine.machineClearanceBufferMeters = 0;
const changedMachine = syntheticProject();
changedMachine.machine.endGunThrowMeters = 8;
changedMachine.machine.sweep = {
  mode: "partial_circle", startAngleDegrees: 15, stopAngleDegrees: 285, direction: "counterclockwise",
};
const changedBoundary = syntheticProject();
changedBoundary.fieldBoundary = rectangle(310, 190);
const noBoundary = syntheticProject();
noBoundary.fieldBoundary = [];

const common: AdvisoryFieldPivotPlanOptions = { gridDivisions: 6, candidatePoolSize: 24, maxMachines: 3 };
const fixtures: { name: string; project: PivotProject; options: AdvisoryFieldPivotPlanOptions }[] = [
  { name: "baseline", project: baseline, options: { ...common, maxMachines: 1 } },
  { name: "multi-machine", project: baseline, options: common },
  { name: "obstacles-clearance", project: obstacles, options: {
    ...common, minimumBoundaryClearanceMeters: 45, minimumObstacleClearanceMeters: 12,
    obstacleBufferMeters: 10, obstacleCrossingProfiles: [{
      obstacleId: "synthetic-obstacle", crossingAllowed: false, reason: "Synthetic blocked profile", advisoryOnly: true,
    }],
  } },
  { name: "costs", project: baseline, options: {
    ...common, costInput: { fixedMachineCost: 100000, costPerMeter: 500, costPerTower: 2500, currencyCode: "USD" },
  } },
  { name: "near-coordinate-ids", project: nearIds, options: { ...common, maxCandidates: 100 } },
  { name: "changed-machine", project: changedMachine, options: common },
  { name: "changed-boundary", project: changedBoundary, options: common },
  { name: "no-feasible", project: baseline, options: { ...common, minimumBoundaryClearanceMeters: 1000 } },
  { name: "no-boundary", project: noBoundary, options: { ...common, includeMaximumInscribedCircleSeed: false } },
];

// Complete pre-reuse JSON digests and yield counts, captured from the dirty checkout.
const expected: Record<string, { plan: string; standalone: string; yields: number; standaloneYields: number }> = {
  baseline: {
    plan: "677d6944de8e06d31e44a406e905da2ffd55dbe09ecf4ddeaad0be426961a77a",
    standalone: "15bd950751ba899a15670ada74c3ab35f1432685fbd9629fdee3f966b5a9e949", yields: 278, standaloneYields: 75,
  },
  "multi-machine": {
    plan: "46b1e04df80bda83d51adeab8810f8b65f64e1cd9445d1cecd0d04b950d33428",
    standalone: "15bd950751ba899a15670ada74c3ab35f1432685fbd9629fdee3f966b5a9e949", yields: 315, standaloneYields: 75,
  },
  "obstacles-clearance": {
    plan: "2a3fb5e54a9ef46340ba95dbfdba613908b71c18a90ec31253b123d566597b97",
    standalone: "2b3b8c4e3e53f12e7eceaf36a0569c348858c5b9aeacefe3efd347c57e52d75e", yields: 269, standaloneYields: 75,
  },
  costs: {
    plan: "74e156f581598ab21cf26a0d3703d9e35aba461d19d460a5ee1e2e6f913ff09f",
    standalone: "8dcb33be62eaba6d575ac39498b79fec944c160bf4105e94f8de8c18b48f6c9d", yields: 315, standaloneYields: 75,
  },
  "near-coordinate-ids": {
    plan: "4899a4e6a64534716d40a7fa261f2dde4a9e29d8eb54c45e535144913e14e4c8",
    standalone: "d09422f658d8f7c7319f1027376a272e3617eac64f52bd45b60c4d2dac4fe18e", yields: 204, standaloneYields: 156,
  },
  "changed-machine": {
    plan: "24fbb96408dd13e1f880d1fbf35809499bf6d42f2d97b7c559be91de9e8b2bf3",
    standalone: "ad380cd6c42d16b84db2c4e6b1bbc606a77b29fa19a305d8beb51e443ffd90fa", yields: 294, standaloneYields: 75,
  },
  "changed-boundary": {
    plan: "31d9e12577198ba9d95e4b43a521a7dff330e5b893bde66118b11e4c0c7b5c9b",
    standalone: "885f0bc89e9576678d2d28e2d2e2afd2a9778d654736c42db04b51428ea17e69", yields: 296, standaloneYields: 75,
  },
  "no-feasible": {
    plan: "f15350159dc690d84236417f1030dcd5da606113e869f57560d71bbb3a92e583",
    standalone: "084fcf7d86f11153225f4fc3625807bb90941d3076a55673c45b27bf4de6aacb", yields: 233, standaloneYields: 75,
  },
  "no-boundary": {
    plan: "07dee63ddd37855ed1cef67054013970db92d94276d1b30cea691569a9246261",
    standalone: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", yields: 0, standaloneYields: 2,
  },
};

function drain<T>(calculation: Calculation<T>): { value: T; yields: number } {
  let yields = 0;
  let step = calculation.next();
  while (!step.done) { yields += 1; step = calculation.next(); }
  return { value: step.value, yields };
}

const signedZeroProject = syntheticProject();
signedZeroProject.fieldBoundary = rectangle(240, 240).map(({ x, y }) => ({ x: x - 120, y: y - 120 }));
signedZeroProject.pivotCenter = { x: 0, y: 0 };
signedZeroProject.machine.sweep = {
  mode: "partial_circle", startAngleDegrees: 0, stopAngleDegrees: 180, direction: "counterclockwise",
};
const signedZeroOptions = { ...common, candidatePoolSize: 100, maxMachines: 1, minimumBoundaryClearanceMeters: 120 };
const positiveZeroPlan = planAdvisoryFieldPivots(signedZeroProject, signedZeroOptions);
for (const pivotCenter of [{ x: 0, y: -0 }, { x: -0, y: 0 }, { x: -0, y: -0 }, { x: 0, y: 0 }]) {
  const project = { ...signedZeroProject, pivotCenter };
  const before = structuredClone(project);
  const plan = planAdvisoryFieldPivots(project, signedZeroOptions);
  const iterated = drain(planAdvisoryFieldPivotsSteps(project, signedZeroOptions));
  assert.deepEqual(iterated.value, plan, "signed-zero sync and iterator outputs agree strictly");
  assert.equal(plan.selectedMachineCount, 1);
  assert.deepEqual(plan.candidates[0].pivotCenter, { x: 0, y: 0 });
  // These positive-zero points were checked against the retained pre-reuse implementation.
  // JSON digests cannot distinguish -0 from +0; both axes need Object.is checks.
  const baselinePoints = {
    modeledCoverageUnion: plan.modeledCoverageUnion[0][0][1],
    dryCornerPolygons: plan.candidates[0].placementCandidate.dryCornerPolygons[0][1][145],
    modeledCoverage: plan.candidates[0].modeledCoverage[0][0][1],
  };
  for (const [name, point] of Object.entries(baselinePoints)) {
    assert.ok(Object.is(point.x, 0), `${name}: baseline X is positive zero`);
    assert.ok(Object.is(point.y, 0), `${name}: baseline Y is positive zero`);
  }
  assert.deepEqual(plan, positiveZeroPlan, "signed-zero inputs preserve the complete positive-center plan strictly");
  assert.deepEqual(project, before, "planning preserves input coordinate signs");
}

const completePlans = new Map<string, ReturnType<typeof planAdvisoryFieldPivots>>();
for (const fixture of fixtures) {
  const before = structuredClone(fixture);
  const sync = planAdvisoryFieldPivots(fixture.project, fixture.options);
  const iterated = drain(planAdvisoryFieldPivotsSteps(fixture.project, fixture.options));
  assert.deepEqual(iterated.value, sync, `${fixture.name}: sync and iterator complete output`);
  const standalone = buildPivotPlacementCandidates(fixture.project, fixture.options);
  const standaloneSteps = drain(buildPivotPlacementCandidatesSteps(fixture.project, fixture.options));
  assert.deepEqual(standaloneSteps.value, standalone, `${fixture.name}: standalone sync and iterator`);
  assert.deepEqual(fixture, before, `${fixture.name}: inputs are unchanged`);
  completePlans.set(fixture.name, sync);
  if (fixture.name === "multi-machine") assert.equal(sync.selectedMachineCount, 3);
  if (fixture.name === "near-coordinate-ids") {
    assert.ok(standalone.some((candidate, index) => standalone.some((other, otherIndex) =>
      index !== otherIndex && candidate.id === other.id
      && (candidate.pivotCenter.x !== other.pivotCenter.x || candidate.pivotCenter.y !== other.pivotCenter.y))),
    "fixture exercises distinct exact XY sharing a rounded candidate ID");
  }
  assert.deepEqual({ plan: digest(sync), standalone: digest(standalone),
    yields: iterated.yields, standaloneYields: standaloneSteps.yields }, expected[fixture.name],
  `${fixture.name}: complete pre-reuse output and scheduling baseline`);
}

// Reusing both object identities must not retain results from an earlier request.
const reusedProject = syntheticProject();
const reusedOptions: AdvisoryFieldPivotPlanOptions = {};
for (const name of ["multi-machine", "obstacles-clearance", "changed-machine", "changed-boundary", "costs", "multi-machine"]) {
  const fixture = fixtures.find((item) => item.name === name)!;
  Object.assign(reusedProject, structuredClone(fixture.project));
  for (const key of Object.keys(reusedOptions)) delete reusedOptions[key as keyof AdvisoryFieldPivotPlanOptions];
  Object.assign(reusedOptions, structuredClone(fixture.options));
  const before = structuredClone({ project: reusedProject, options: reusedOptions });
  assert.deepEqual(planAdvisoryFieldPivots(reusedProject, reusedOptions), completePlans.get(name),
    `${name}: same project/options identities with changed inputs must recompute`);
  assert.deepEqual({ project: reusedProject, options: reusedOptions }, before);
}

// Suspended requests must own separate reuse state even when project IDs match.
const interleaved = ["multi-machine", "obstacles-clearance"].map((name) => {
  const fixture = fixtures.find((item) => item.name === name)!;
  return { name, calculation: planAdvisoryFieldPivotsSteps(fixture.project, fixture.options), done: false };
});
while (interleaved.some((request) => !request.done)) {
  for (const request of interleaved) {
    if (request.done) continue;
    const step = request.calculation.next();
    if (step.done) {
      request.done = true;
      assert.deepEqual(step.value, completePlans.get(request.name), `${request.name}: interleaved request isolation`);
    }
  }
}

const cancellationInput = syntheticProject();
const beforeCancellation = structuredClone(cancellationInput);
const cancelled = planAdvisoryFieldPivotsSteps(cancellationInput, common);
for (let index = 0; index < 220; index += 1) assert.equal(cancelled.next().done, false);
assert.equal(cancelled.return(undefined as never).done, true);
assert.deepEqual(cancellationInput, beforeCancellation, "cancellation during pool construction preserves input");
assert.deepEqual(planAdvisoryFieldPivots(cancellationInput, common), completePlans.get("multi-machine"),
  "a cancelled request cannot contaminate the next request");

const invalidCrs = { ...syntheticProject(), projectCrs: "EPSG:4326" };
assert.throws(() => planAdvisoryFieldPivots(invalidCrs, common));
assert.throws(() => planAdvisoryFieldPivotsSteps(invalidCrs, common).next());
assert.throws(() => buildPivotPlacementCandidates(invalidCrs, common));
assert.throws(() => buildPivotPlacementCandidatesSteps(invalidCrs, common).next());

const returnedPlan = planAdvisoryFieldPivots(baseline, common);
returnedPlan.candidates[0].placementCandidate.metrics.irrigatedAcres = -123;
returnedPlan.candidates[0].modeledCoverage[0][0][0].x = -123;
assert.deepEqual(planAdvisoryFieldPivots(baseline, common), completePlans.get("multi-machine"),
  "mutating returned geometry or metrics cannot poison another identical request");
console.log("Field plan reuse: complete outputs, scheduling, input immutability, cancellation and request isolation pass.");
