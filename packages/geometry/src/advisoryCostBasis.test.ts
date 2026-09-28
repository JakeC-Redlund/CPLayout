import assert from "node:assert/strict";
import type { PivotMachine, PivotProject } from "@cplayout/core";
import {
  advisoryMachinePriceMatches,
  buildAdvisoryRadiusSensitivityReview,
  buildAdvisorySweepEfficiencyReview,
  buildPivotPlacementCandidates,
  compareAdvisoryMachineStrategies,
  planAdvisoryFieldPivots,
  type AdvisoryCostInput,
} from "./advisoryPivotPlacement";

const machine: PivotMachine = {
  id: "priced-machine",
  name: "Synthetic pivot",
  spanLengthsMeters: [20, 30],
  overhangMeters: 10,
  endGunThrowMeters: 0,
  towerClearanceBufferMeters: 2,
  machineClearanceBufferMeters: 3,
  sweep: { mode: "full_circle" },
};
const project: PivotProject = {
  id: "cost-basis-test",
  name: "Synthetic cost arithmetic",
  projectCrs: "EPSG:32613",
  unitSystem: "metric",
  fieldBoundary: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }],
  pivotCenter: { x: 150, y: 150 },
  waterSource: { x: 0, y: 0 },
  powerSource: { x: 0, y: 0 },
  obstacles: [],
  surveyPoints: [],
  machine,
};
const supplied: AdvisoryCostInput = {
  pricing: { kind: "machine_price", amount: 100000, machine: structuredClone(machine) },
  currencyCode: " USD ",
  notes: "Synthetic equipment-only amount; not a market price.",
};
const estimate: AdvisoryCostInput = {
  pricing: { kind: "length_tower_estimate", baseCost: 1000, costPerMeter: 200, costPerTower: 3000 },
};
const searchOptions = {
  gridDivisions: 3,
  maxCandidates: 2,
  includeMaximumInscribedCircleSeed: false,
  includeMachineZoneReviews: false,
};
const before = structuredClone({ project, supplied, estimate });
assert.equal(advisoryMachinePriceMatches(machine, structuredClone(machine)), true);
assert.equal(advisoryMachinePriceMatches(machine, { ...machine, id: "moved-instance" }), true);
assert.equal(advisoryMachinePriceMatches(machine, { ...machine, name: "Renamed" }), false);
assert.equal(advisoryMachinePriceMatches(null as unknown as PivotMachine, machine), false);
assert.equal(advisoryMachinePriceMatches(machine, {} as PivotMachine), false);
const optionalMachine = { ...machine, cornerArm: undefined, endGunAngleRanges: undefined };
assert.equal(advisoryMachinePriceMatches(JSON.parse(JSON.stringify(optionalMachine)) as PivotMachine, optionalMachine), true);
assert.equal(advisoryMachinePriceMatches(machine, { ...machine, endGunAngleRanges: [] }), false);

function currentCost(costInput: AdvisoryCostInput | undefined, evaluatedProject = project) {
  return buildAdvisorySweepEfficiencyReview(evaluatedProject, { costInput, comparisonRadiiMeters: [] }).rows[0].cost;
}

assert.equal(currentCost(supplied).status, "complete");
assert.equal(currentCost(supplied).estimatedCost, 100000);
assert.equal(currentCost(supplied).currencyCode, "USD");
assert.ok(currentCost(supplied).warnings.includes(supplied.notes!));
assert.equal(currentCost(supplied, { ...project, machine: { ...machine, id: "another-instance" } }).estimatedCost, 100000);
assert.equal(currentCost(supplied, { ...project, pivotCenter: { x: 120, y: 120 } }).estimatedCost, 100000);
assert.equal(currentCost(estimate).estimatedCost, 19000);
assert.equal(currentCost(undefined).status, "missing_cost_input");

// Property insertion order is irrelevant; span order and every non-ID field are not.
const reordered = Object.fromEntries(Object.entries(machine).reverse()) as unknown as PivotMachine;
assert.equal(currentCost({ pricing: { kind: "machine_price", amount: 100000, machine: reordered } }).status, "complete");
const changedConfigurations: Array<Partial<PivotMachine>> = [
  { name: "Renamed scope" },
  { spanLengthsMeters: [25, 30] },
  { spanLengthsMeters: [10, 10, 30] },
  { spanLengthsMeters: [30, 20] },
  { overhangMeters: 11 },
  { endGunThrowMeters: 5 },
  { endGunAngleRanges: [{ startAngleDegrees: 20, stopAngleDegrees: 100, direction: "clockwise" }] },
  { towerClearanceBufferMeters: 4 },
  { machineClearanceBufferMeters: 4 },
  { sweep: { mode: "partial_circle", startAngleDegrees: 0, stopAngleDegrees: 180, direction: "clockwise" } },
  { catalogSelection: { catalogId: "catalog", manufacturer: "Example", model: "Other", sourceUrl: "https://example.com", sourceAccessedAt: "2026-09-27", advisoryOnly: true } },
  { cornerArm: { id: "corner", name: "Corner", lengthMeters: 10, advisoryOnly: true, guidanceType: "unknown", sequencingType: "unknown", orientation: "unknown", confidence: "user_estimated", sourceRefs: [] } },
  { driveUnits: { lrdu: { role: "lrdu", advisoryOnly: true, customMotorRpm: 1200, sourceRefs: [], caveats: [] } } },
];
for (const change of changedConfigurations) {
  const assessment = currentCost(supplied, { ...project, machine: { ...machine, ...change } });
  assert.equal(assessment.status, "missing_cost_input", JSON.stringify(change));
  assert.equal(assessment.estimatedCost, null);
  assert.equal(assessment.costPerIrrigatedAcre, null);
  assert.ok(assessment.warnings.some((warning) => warning.includes("exact machine configuration")));
}
const cornerMachine: PivotMachine = {
  ...machine,
  cornerArm: {
    id: "priced-corner", name: "Synthetic corner", lengthMeters: 10, advisoryOnly: true,
    guidanceType: "unknown", sequencingType: "unknown", orientation: "unknown", confidence: "user_estimated",
    sourceRefs: [{ sourceId: "synthetic", limit: "Test fixture only." }],
  },
};
const cornerPrice: AdvisoryCostInput = { pricing: { kind: "machine_price", amount: 120000, machine: cornerMachine } };
assert.equal(currentCost(cornerPrice, { ...project, machine: structuredClone(cornerMachine) }).status, "complete");
assert.equal(currentCost(cornerPrice, {
  ...project, machine: { ...cornerMachine, cornerArm: { ...cornerMachine.cornerArm!, id: "another-corner" } },
}).status, "missing_cost_input");

const invalidInputs: unknown[] = [
  { pricing: null }, { pricing: [] }, { pricing: "machine_price" }, { pricing: {} },
  { pricing: { kind: "unknown" } },
  { pricing: { kind: "machine_price", amount: 100, machine: null } },
  { pricing: { kind: "machine_price", amount: 100, machine: {} } },
  { pricing: { kind: "machine_price", amount: 100, machine: { ...machine, spanLengthsMeters: [NaN] } } },
  { pricing: { kind: "machine_price", amount: 100, machine: { ...machine, sweep: null } } },
  { pricing: { kind: "machine_price", amount: 100, machine: { ...machine, driveUnits: { lrdu: {} } } } },
  { pricing: { kind: "length_tower_estimate", baseCost: 10 } },
  { pricing: { kind: "length_tower_estimate", baseCost: 0, costPerMeter: 0, costPerTower: 0 } },
  { pricing: { kind: "length_tower_estimate", baseCost: 0, costPerMeter: Number.MAX_VALUE, costPerTower: 0 } },
  { pricing: { kind: "length_tower_estimate", baseCost: Number.MAX_VALUE, costPerMeter: 0, costPerTower: Number.MAX_VALUE } },
];
for (const value of [undefined, null, "100", NaN, Infinity, -Infinity, -1, 0]) {
  invalidInputs.push({ pricing: { kind: "machine_price", amount: value, machine } });
}
for (const key of ["baseCost", "costPerMeter", "costPerTower"]) {
  for (const value of [undefined, null, "1", NaN, Infinity, -Infinity, -1]) {
    invalidInputs.push({ pricing: { ...estimate.pricing, [key]: value } });
  }
}
for (const costInput of [supplied, estimate]) {
  for (const key of ["fixedMachineCost", "costPerMeter", "costPerTower"]) {
    for (const value of [0, 1, NaN, null]) invalidInputs.push({ ...costInput, [key]: value });
  }
}
for (const input of invalidInputs) {
  const costInput = input as AdvisoryCostInput;
  const inputBefore = structuredClone(input);
  const assessment = currentCost(costInput);
  assert.equal(assessment.status, "invalid_cost_input", JSON.stringify(input));
  assert.equal(assessment.estimatedCost, null);
  assert.equal(assessment.costPerIrrigatedAcre, null);
  assert.equal(compareAdvisoryMachineStrategies({ ...project, fieldBoundary: [] }, { costInput }).costInputStatus, "invalid_cost_input");
  assert.deepEqual(input, inputBefore);
}

// A caller converts per-foot rates to per-meter rates before entering this API.
const perFoot = 8;
const convertedRate = perFoot / 0.3048;
const footEquivalent = currentCost({ pricing: { kind: "length_tower_estimate", baseCost: 0, costPerMeter: convertedRate, costPerTower: 0 } });
assert.ok(Math.abs(footEquivalent.estimatedCost! - (60 / 0.3048) * perFoot) < 0.000001);

const moved = buildPivotPlacementCandidates(project, { ...searchOptions, costInput: supplied });
assert.ok(moved.length > 0);
assert.ok(moved.some((candidate) => candidate.pivotCenter.x !== project.pivotCenter.x || candidate.pivotCenter.y !== project.pivotCenter.y));
assert.ok(moved.every((candidate) => candidate.costAssessment.estimatedCost === 100000));
const fieldPlan = planAdvisoryFieldPivots(project, { ...searchOptions, candidatePoolSize: 2, maxMachines: 1, costInput: supplied });
assert.ok(fieldPlan.candidates.length > 0);
assert.ok(fieldPlan.candidates.every((candidate) => candidate.placementCandidate.costAssessment.estimatedCost === 100000));
const otherProject = { ...project, machine: { ...machine, endGunThrowMeters: 3 } };
const unpricedPlan = planAdvisoryFieldPivots(otherProject, { ...searchOptions, candidatePoolSize: 2, maxMachines: 1, costInput: supplied });
assert.ok(unpricedPlan.candidates.length > 0);
assert.ok(unpricedPlan.candidates.every((candidate) => candidate.placementCandidate.costAssessment.status === "missing_cost_input"));

const strategies = compareAdvisoryMachineStrategies(project, {
  ...searchOptions, costInput: supplied, generatedFullCircleRadiiMeters: [40], includeUnsupportedConceptPlaceholders: false,
});
assert.equal(strategies.strategies.find((strategy) => strategy.strategyKind === "current_machine")?.costAssessment?.estimatedCost, 100000);
assert.equal(strategies.strategies.find((strategy) => strategy.strategyKind === "full_circle_radius")?.costAssessment?.status, "missing_cost_input");
assert.equal(strategies.costInputStatus, "missing_cost_input");
assert.equal(compareAdvisoryMachineStrategies({ ...otherProject, fieldBoundary: [] }, { costInput: supplied }).costInputStatus, "missing_cost_input");
assert.equal(compareAdvisoryMachineStrategies({ ...project, fieldBoundary: [] }, { costInput: supplied }).costInputStatus, "complete");
assert.equal(compareAdvisoryMachineStrategies({ ...project, fieldBoundary: [] }, { costInput: estimate }).costInputStatus, "complete");

const hardwareProject: PivotProject = {
  ...project,
  surveyPoints: [{ id: "hinge", label: "Bender second pivot", role: "pivot_center", projected: { x: 170, y: 150 }, observedAt: "2026-09-27T00:00:00.000Z", source: "manual", confidence: "user_estimated" }],
  mapFeatures: [{ id: "travel", name: "Linear travel", kind: "linear_move_path", geometry: { type: "LineString", vertices: [{ x: 100, y: 100 }, { x: 200, y: 100 }] }, confidence: "user_estimated" }],
};
for (const costInput of [supplied, estimate]) {
  const hardware = compareAdvisoryMachineStrategies(hardwareProject, {
    ...searchOptions, costInput, includeGeneratedRadiusStrategies: false, includeUnsupportedConceptPlaceholders: false,
  });
  for (const kind of ["bender_second_pivot", "linear_lateral_move"]) {
    const strategy = hardware.strategies.find((row) => row.strategyKind === kind);
    assert.ok(strategy);
    assert.equal(strategy.costAssessment?.status, costInput === supplied ? "missing_cost_input" : "complete");
  }
}

const radiusReview = buildAdvisoryRadiusSensitivityReview(project, {
  ...searchOptions, costInput: supplied, maxMachines: 1, radiiMeters: [40, 60],
  buildMachineForRadius: (_, radius) => radius === 60
    ? { ...machine, id: `radius-${radius}` }
    : { ...machine, id: `radius-${radius}`, spanLengthsMeters: [10, 30], overhangMeters: 0 },
});
assert.equal(radiusReview.rows.find((row) => row.radiusMeters === 60)?.cost.estimatedCost, 100000);
assert.equal(radiusReview.rows.find((row) => row.radiusMeters === 40)?.cost.status, "missing_cost_input");
assert.equal(radiusReview.bestByCostPerAcre?.radiusMeters, 60);

const partialProject: PivotProject = { ...project, machine: { ...machine, sweep: { mode: "partial_circle", startAngleDegrees: 0, stopAngleDegrees: 180, direction: "clockwise" } } };
const sweep = buildAdvisorySweepEfficiencyReview(partialProject, {
  costInput: { pricing: { kind: "machine_price", amount: 50000, machine: structuredClone(partialProject.machine) } },
  comparisonRadiiMeters: [40],
});
assert.equal(sweep.rows[0].cost.estimatedCost, 50000);
assert.ok(sweep.rows.slice(1).every((row) => row.cost.status === "missing_cost_input" && row.estimatedCostDeltaFromCurrent === null));
assert.equal(sweep.bestCostPerAcreRow?.kind, "current_sweep");
const estimatedSweep = buildAdvisorySweepEfficiencyReview(partialProject, { costInput: estimate, comparisonRadiiMeters: [40] });
assert.ok(estimatedSweep.rows.every((row) => row.cost.status === "complete"));

const outside = { ...project, pivotCenter: { x: 1000, y: 1000 } };
assert.equal(currentCost(supplied, outside).status, "no_irrigated_acres");
assert.equal(currentCost(supplied, outside).estimatedCost, 100000);
const tinyProject = { ...project, machine: { ...machine, spanLengthsMeters: [1], overhangMeters: 0 } };
assert.equal(currentCost({ pricing: { kind: "machine_price", amount: Number.MAX_VALUE, machine: tinyProject.machine } }, tinyProject).status, "invalid_cost_input");

const legacy = { fixedMachineCost: 1000, costPerMeter: 200, costPerTower: 3000 };
assert.equal(currentCost(legacy).estimatedCost, 19000);
assert.equal(currentCost({ fixedMachineCost: 1000 }).estimatedCost, 1000);
const legacyCandidates = buildPivotPlacementCandidates(project, { ...searchOptions, costInput: legacy });
const estimateCandidates = buildPivotPlacementCandidates(project, { ...searchOptions, costInput: estimate });
assert.deepEqual(legacyCandidates, estimateCandidates);
assert.deepEqual({ project, supplied, estimate }, before);
console.log(`Advisory cost basis tests passed: ${invalidInputs.length} invalid cases, exact configuration scope, unit conversion, assessment paths, and immutable legacy parity.`);
