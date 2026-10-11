import assert from "node:assert/strict";
import { test } from "node:test";
import type { PivotMachine, PivotProject } from "@cplayout/core";
import {
  buildPivotPlacementCandidates,
  planAdvisoryPivotTemplates,
  planAdvisoryPivotTemplatesSteps,
  planAdvisoryFieldPivots,
  analyzeAdvisoryMultiMachineLayout,
  type AdvisoryPivotTemplate,
  type AdvisoryTemplateFieldPlan,
  type AdvisoryTemplatePlanOptions,
} from "./advisoryPivotPlacement";
import type { Calculation } from "./calculation";
import { evaluatePivotPairSeparation } from "./machineSeparation";
import { createCirclePolygon, evaluateLayout, validateWetCoverageWithinField } from "./geometry";

const origin = { x: 500000.125, y: 4400000.25 };
const xy = (x: number, y: number) => ({ x: origin.x + x, y: origin.y + y });
const rectangle = (width: number, height: number) => [xy(0, 0), xy(width, 0), xy(width, height), xy(0, height)];

function fixture() {
  const large: PivotMachine = {
    id: "large-machine", name: "Synthetic unequal large pivot",
    spanLengthsMeters: [20, 25], overhangMeters: 5, endGunThrowMeters: 15,
    towerClearanceBufferMeters: 2, machineClearanceBufferMeters: 4,
    sweep: { mode: "full_circle" },
  };
  const small: PivotMachine = {
    ...structuredClone(large), id: "small-machine", name: "Synthetic unequal small pivot",
    spanLengthsMeters: [12, 18], machineClearanceBufferMeters: 7,
  };
  const templates: AdvisoryPivotTemplate[] = [
    { id: "large", machine: large, maximumCount: 1 },
    { id: "small", machine: small, maximumCount: 1 },
  ];
  const project: PivotProject = {
    id: "template-test", name: "Synthetic UTM template field", projectCrs: "EPSG:32613",
    unitSystem: "metric", fieldBoundary: rectangle(300, 240), pivotCenter: xy(100, 80),
    waterSource: xy(0, 0), powerSource: xy(0, 0), machine: structuredClone(large),
    obstacles: [], surveyPoints: [], mapFeatures: [],
  };
  const options: AdvisoryTemplatePlanOptions = {
    gridDivisions: 3, candidatePoolSize: 6, maxCandidates: 6, maxMachines: 3,
    includeMaximumInscribedCircleSeed: false, includeMachineZoneReviews: false,
  };
  return { project, templates, options };
}

type Fixture = ReturnType<typeof fixture>;

test("unequal separation rejects below and admits at/above the unrounded threshold", () => {
  const { templates } = fixture();
  for (const explicitMinimum of [0, 150.125]) {
    const required = Math.max(explicitMinimum, 50 + 35 + 7);
    for (const delta of [-0.00001, 0, 0.00001]) {
      const result = evaluatePivotPairSeparation(
        { machine: templates[0].machine, pivotCenter: xy(0, 0) },
        { machine: templates[1].machine, pivotCenter: xy(required + delta, 0) },
        { minimumMachineSeparationMeters: explicitMinimum, collisionBufferMeters: 2 });
      assert.equal(result.minimumRequiredSeparationMeters, required);
      assert.equal(result.pairBufferMeters, 7, "an explicit smaller gap cannot reduce configured clearance");
      assert.equal(result.centerDistanceMeters >= result.minimumRequiredSeparationMeters, delta >= 0);
    }
  }
});

test("legacy field and zone planners cannot reduce the configured pair gap", () => {
  const { project, options } = fixture();
  for (const collisionBufferMeters of [undefined, 2]) {
    const gapOptions = { ...options, ...(collisionBufferMeters === undefined ? {} : { collisionBufferMeters }) };
    const plan = planAdvisoryFieldPivots(project, gapOptions);
    assert.equal(plan.collisionBufferMeters, 4);
    assert.equal(plan.minimumRequiredSeparationMeters, 104);
    const zones = analyzeAdvisoryMultiMachineLayout({ ...project, mapFeatures: ["a", "b"].map(id => ({
      id, name: id, kind: "machine_zone" as const, confidence: "user_estimated" as const,
      geometry: { type: "Circle" as const, center: project.pivotCenter, radiusMeters: 20 },
    })) }, gapOptions);
    assert.equal(zones.conflicts.length, 1);
    assert.equal(zones.conflicts[0].minimumRequiredSeparationMeters, 104);
    assert.equal(zones.conflicts[0].collisionBufferMeters, 4);
  }
});

test("conservative containment rejects direct grid seeds despite contained display polygons", () => {
  const input = fixture();
  // The inscribed display circle exactly fits this retained boundary. The
  // independent conservative envelope extends beyond its chords by > 0.01 m2.
  input.project.fieldBoundary = createCirclePolygon(xy(75, 50), 50, 288);
  input.project.pivotCenter = xy(75, 50);
  input.templates = [input.templates[0]];
  input.templates[0].machine.endGunThrowMeters = 0;
  input.project.machine = structuredClone(input.templates[0].machine);
  input.options = { ...input.options, gridDivisions: 4, candidatePoolSize: 1, maxCandidates: 1, maxMachines: 1 };
  assert.equal(evaluateLayout(input.project).metrics.outsideFieldAcres, 0);
  assert.equal(validateWetCoverageWithinField(input.project).feasible, false);
  assert.equal(run(input).candidates.length, 0);
  const legacy = planAdvisoryFieldPivots(input.project, input.options);
  assert.equal(legacy.feasibleCandidateCount, 0, "the separately generated grid must use the conservative admission too");
});
const run = ({ project, templates, options }: Fixture) => planAdvisoryPivotTemplates(project, templates, options);
const steps = ({ project, templates, options }: Fixture) => planAdvisoryPivotTemplatesSteps(project, templates, options);
const reach = (machine: PivotMachine) => machine.spanLengthsMeters.reduce((sum, length) => sum + length, 0) + machine.overhangMeters;

function complete<T>(calculation: Calculation<T>): { result: T; yields: number } {
  let yields = 0;
  let step = calculation.next();
  while (!step.done) { yields += 1; step = calculation.next(); }
  return { result: step.value, yields };
}

function checkPairs(plan: AdvisoryTemplateFieldPlan, options: AdvisoryTemplatePlanOptions) {
  const candidates = plan.candidates;
  assert.equal(plan.pairChecks.length, candidates.length * (candidates.length - 1) / 2);
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = candidates[i], right = candidates[j];
      const checks = plan.pairChecks.filter(check => check.leftCandidateId === left.id && check.rightCandidateId === right.id);
      assert.equal(checks.length, 1, "every unordered selected pair has exactly one diagnostic");
      const gap = Math.max(options.collisionBufferMeters ?? 0, left.machine.machineClearanceBufferMeters, right.machine.machineClearanceBufferMeters);
      const minimum = Math.max(options.minimumMachineSeparationMeters ?? 0, reach(left.machine) + reach(right.machine) + gap);
      const distance = Math.hypot(left.pivotCenter.x - right.pivotCenter.x, left.pivotCenter.y - right.pivotCenter.y);
      assert.equal(checks[0].pairBufferMeters, gap);
      assert.equal(checks[0].minimumRequiredSeparationMeters, minimum);
      assert.equal(checks[0].centerDistanceMeters, distance, "pair diagnostics retain unrounded XY distance");
      assert.ok(distance >= minimum, "selected machines satisfy structural reach plus one maximum gap");
    }
  }
}

function price(template: AdvisoryPivotTemplate, amount: number, currencyCode = "USD") {
  template.costInput = {
    pricing: { kind: "machine_price", amount, machine: structuredClone(template.machine) }, currencyCode,
  };
}

function unavailable(plan: AdvisoryTemplateFieldPlan) {
  assert.deepEqual(plan.cost, { status: "unavailable", estimatedCost: null, costPerIrrigatedAcre: null, currencyCode: null });
}

test("unequal optional templates both survive with exact configurations and projected XY", () => {
  const input = fixture(), before = structuredClone(input);
  const plan = run(input);
  assert.equal(plan.status, "candidates_found");
  assert.equal(plan.templateRole, "optional_alternatives");
  assert.equal(plan.advisoryOnly, true);
  assert.equal(plan.canonicalGeometryMutation, false);
  assert.equal(plan.qualifiedReviewRequired, true);
  assert.equal(plan.projectCrs, "EPSG:32613");
  assert.deepEqual(plan.candidates.map(candidate => candidate.templateId).sort(), ["large", "small"]);
  assert.equal(new Set(plan.candidates.map(candidate => candidate.id)).size, 2);
  for (const candidate of plan.candidates) {
    const supplied = input.templates.find(template => template.id === candidate.templateId)!;
    assert.deepEqual(candidate.machine, supplied.machine);
    assert.notEqual(candidate.machine, supplied.machine);
    assert.equal(candidate.structuralReachMeters, reach(supplied.machine));
    assert.deepEqual(candidate.pivotCenter, candidate.placementCandidate.pivotCenter);
    assert.ok(candidate.pivotCenter.x >= origin.x && candidate.pivotCenter.x <= origin.x + 300);
    assert.ok(candidate.pivotCenter.y >= origin.y && candidate.pivotCenter.y <= origin.y + 240);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan, "serialization preserves unequal configurations and XY");
  checkPairs(plan, input.options);
  assert.deepEqual(input, before, "planning cannot mutate canonical inputs");
});

test("all selected pairs use structural sums and the maximum configured gap", () => {
  const input = fixture();
  input.project.fieldBoundary = rectangle(480, 360);
  input.templates.forEach(template => { template.maximumCount = 3; });
  input.options.gridDivisions = 6;
  input.options.candidatePoolSize = 12;
  input.options.collisionBufferMeters = 11.125;
  const plan = run(input);
  assert.equal(plan.candidates.length, 3, "exercise all three pairs, not just one adjacent pair");
  checkPairs(plan, input.options);
});

test("an explicit minimum separation can dominate structural reach", () => {
  const input = fixture();
  input.options.minimumMachineSeparationMeters = 150.125;
  const plan = run(input);
  assert.equal(plan.candidates.length, 2);
  checkPairs(plan, input.options);
  assert.equal(plan.pairChecks[0].minimumRequiredSeparationMeters, 150.125);
});

test("end-gun wet overlap is positive while structural pairing remains separate", () => {
  const input = fixture();
  input.project.fieldBoundary = rectangle(240, 150);
  input.project.pivotCenter = xy(80, 75);
  input.templates[0].machine.spanLengthsMeters = [10, 15];
  input.templates[1].machine.spanLengthsMeters = [10, 10];
  input.templates.forEach(template => { template.machine.endGunThrowMeters = 35; });
  input.templates.forEach(template => price(template, 100.123456789));
  input.options = { ...input.options, gridDivisions: 6, candidatePoolSize: 12, maxMachines: 2 };
  const plan = run(input);
  assert.equal(plan.candidates.length, 2);
  checkPairs(plan, input.options);
  const [left, right] = plan.candidates;
  const wetReachSum = reach(left.machine) + left.machine.endGunThrowMeters + reach(right.machine) + right.machine.endGunThrowMeters;
  assert.ok(plan.pairChecks[0].centerDistanceMeters < wetReachSum);
  assert.ok(plan.duplicateModeledCoverageAcres > 0);
  assert.ok(plan.modeledIrrigatedUnionAcres < plan.modeledIrrigatedAcresSum);
  assert.equal(plan.duplicateModeledCoverageAcres, plan.modeledIrrigatedAcresSum - plan.modeledIrrigatedUnionAcres);
  assert.equal(plan.cost.costPerIrrigatedAcre, (2 * 100.123456789) / plan.modeledIrrigatedUnionAcres);
});

test("template quantities and the global machine limit are ceilings", () => {
  const input = fixture();
  input.options.maxMachines = 8;
  const capped = run(input);
  assert.equal(capped.candidates.length, 2);
  for (const template of input.templates) {
    assert.ok(capped.candidates.filter(candidate => candidate.templateId === template.id).length <= template.maximumCount);
  }
  input.options.maxMachines = 1;
  assert.equal(run(input).candidates.length, 1);
  input.options.maxMachines = 3;
  input.options.minimumMachineSeparationMeters = 10000;
  assert.equal(run(input).candidates.length, 1, "optional counts do not force unsafe placements");
});

test("empty, duplicate, invalid and excessive template inputs reject before iteration", () => {
  const invalid: Array<[string, (input: Fixture) => void]> = [
    ["empty", input => { input.templates = []; }],
    ["five templates", input => { input.templates = Array.from({ length: 5 }, (_, i) => ({ ...structuredClone(input.templates[0]), id: `template-${i}` })); }],
    ["duplicate ID", input => { input.templates[1].id = input.templates[0].id; }],
    ["blank ID", input => { input.templates[0].id = " "; }],
    ["unknown configuration", input => { Object.assign(input.templates[0].machine, { inventedRadiusMeters: 1 }); }],
    ["unknown nested configuration", input => { Object.assign(input.templates[0].machine.sweep, { inventedDirection: true }); }],
    ["unknown template field", input => { Object.assign(input.templates[0], { requiredCount: 1 }); }],
    ["global cost option", input => { Object.assign(input.options, { costInput: { fixedMachineCost: 100 } }); }],
  ];
  for (const count of [0, -1, 1.5, 9, NaN, Infinity, -Infinity, "1", null]) {
    invalid.push([`count ${String(count)}`, input => { input.templates[0].maximumCount = count as number; }]);
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    invalid.push([`span ${value}`, input => { input.templates[0].machine.spanLengthsMeters[0] = value; }]);
    invalid.push([`XY ${value}`, input => { input.project.fieldBoundary[0].x = value; }]);
    invalid.push([`option ${value}`, input => { input.options.collisionBufferMeters = value; }]);
  }
  for (const [label, change] of invalid) {
    const input = fixture();
    change(input);
    assert.throws(() => steps(input), label);
    assert.throws(() => run(input), `${label}: synchronous admission`);
  }
});

test("exactly four optional templates are admitted", () => {
  const input = fixture();
  input.templates = Array.from({ length: 4 }, (_, index) => ({ ...structuredClone(input.templates[0]), id: `template-${index}` }));
  input.options.maxMachines = 1;
  const plan = run(input);
  assert.equal(plan.templates.length, 4);
  assert.equal(plan.candidates.length, 1);
});

test("accessors and serialization hooks reject without being executed", () => {
  const targets = [
    (input: Fixture) => input.project,
    (input: Fixture) => input.templates[0],
    (input: Fixture) => input.templates[0].machine,
    (input: Fixture) => input.options,
  ];
  for (const target of targets) {
    for (const kind of ["accessor", "toJSON"] as const) {
      const input = fixture();
      let calls = 0;
      const hook = () => { calls += 1; return {}; };
      Object.defineProperty(target(input), kind === "accessor" ? "unexpected" : "toJSON", {
        enumerable: true, ...(kind === "accessor" ? { get: hook } : { value: hook }),
      });
      assert.throws(() => steps(input));
      assert.throws(() => run(input));
      assert.equal(calls, 0, `${kind} must never execute during admission`);
    }
  }
});

for (const mode of ["wrong configuration", "missing price", "mixed currency", "missing currency", "sum overflow"] as const) {
  test(`aggregate price is unavailable: ${mode}`, () => {
    const input = fixture();
    input.templates.forEach(template => price(template, mode === "sum overflow" ? Number.MAX_VALUE : 123.456789));
    if (mode === "wrong configuration") {
      const pricing = input.templates[1].costInput!.pricing!;
      assert.equal(pricing.kind, "machine_price");
      if (pricing.kind === "machine_price") pricing.machine.spanLengthsMeters[0] += 1;
    }
    if (mode === "missing price") delete input.templates[1].costInput;
    if (mode === "mixed currency") input.templates[1].costInput!.currencyCode = "CAD";
    if (mode === "missing currency") delete input.templates[1].costInput!.currencyCode;
    const plan = run(input);
    assert.equal(plan.candidates.length, 2, "cost is unavailable without dropping the unpriced configuration");
    unavailable(plan);
  });
}

test("aggregate cost adds unrounded supplied amounts and divides by union acres", () => {
  const input = fixture();
  const amounts = [100.123456789, 200.987654321];
  input.templates.forEach((template, index) => price(template, amounts[index], index ? "USD" : " usd "));
  const plan = run(input);
  assert.equal(plan.candidates.length, 2);
  assert.equal(plan.cost.status, "complete");
  assert.equal(plan.cost.currencyCode, "USD");
  assert.equal(plan.cost.estimatedCost, amounts[0] + amounts[1]);
  assert.equal(plan.cost.costPerIrrigatedAcre, (amounts[0] + amounts[1]) / plan.modeledIrrigatedUnionAcres);
});

test("synchronous and cooperative plans have complete parity and stable template identity", () => {
  const input = fixture();
  const expected = run(input);
  const actual = complete(steps(input));
  assert.ok(actual.yields > 0, "the cooperative API yields during calculation");
  assert.deepEqual(actual.result, expected);
  input.templates.reverse();
  assert.deepEqual(run(input), expected, "template order does not redefine identities or tie breaks");
});

test("Steps owns project, templates and options at invocation and throughout yields", () => {
  const input = fixture();
  input.templates.forEach(template => price(template, 123.456789));
  const expected = run(input);
  const calculation = steps(input);
  input.project.fieldBoundary[0].x += 5;
  input.project.pivotCenter.x += 8;
  input.project.machine.spanLengthsMeters[0] = 1;
  input.templates[0].machine.spanLengthsMeters[0] = 1;
  input.templates[0].maximumCount = 8;
  input.templates[0].costInput!.currencyCode = "CAD";
  input.options.maxMachines = 1;
  input.options.collisionBufferMeters = 9999;
  assert.equal(calculation.next().done, false);
  input.project.fieldBoundary = [];
  input.project.projectCrs = "LOCAL";
  input.templates[1].machine.sweep = { mode: "partial_circle", startAngleDegrees: 0, stopAngleDegrees: 90, direction: "clockwise" };
  input.templates.splice(0);
  input.options.gridDivisions = 6;
  input.options.candidatePoolSize = 12;
  assert.deepEqual(complete(calculation).result, expected);
});

test("returned instances own configurations independently of inputs, summaries and siblings", () => {
  const input = fixture();
  input.templates = [input.templates[0]];
  input.templates[0].maximumCount = 3;
  const before = structuredClone(input);
  const plan = run(input);
  assert.ok(plan.candidates.length >= 2, "exercise multiple instances of the same template");
  const siblingBefore = structuredClone(plan.candidates[1]);
  const summaryBefore = structuredClone(plan.templates[0]);
  const placementBefore = structuredClone(plan.candidates[0].placementCandidate);
  const first = plan.candidates[0];
  first.machine.spanLengthsMeters[0] = 999;
  first.machine.sweep.mode = "partial_circle";
  first.pivotCenter.x += 1;
  assert.deepEqual(plan.candidates[1], siblingBefore);
  assert.deepEqual(plan.templates[0], summaryBefore);
  assert.deepEqual(first.placementCandidate, placementBefore);
  assert.deepEqual(input, before);
});

test("LOCAL and Web Mercator cannot authorize metric planning", () => {
  for (const crs of ["LOCAL", "EPSG:3857"]) {
    const input = fixture();
    input.project.projectCrs = crs;
    assert.throws(() => steps(input), crs);
    assert.throws(() => run(input), crs);
  }
});

test("corner templates stay excluded despite shared corner swing limit features", () => {
  const input = fixture();
  input.templates[1].machine.cornerArm = {
    id: "unsupported-corner", name: "Synthetic corner", lengthMeters: 15, advisoryOnly: true,
    guidanceType: "unknown", sequencingType: "unknown", orientation: "unknown", confidence: "user_estimated",
    sourceRefs: [{ sourceId: "synthetic-test-only", limit: "Invented fixture, not equipment evidence." }],
  };
  const withoutGuidance = run(input);
  input.project.mapFeatures = [{
    id: "legacy-shared-guidance", name: "Unscoped synthetic corner swing limit", kind: "corner_swing_limit",
    geometry: { type: "Polygon", vertices: rectangle(300, 240) }, confidence: "user_estimated",
  }];
  const withGuidance = run(input);
  for (const plan of [withoutGuidance, withGuidance]) {
    assert.equal(plan.candidates.length, 1);
    assert.equal(plan.candidates[0].templateId, "large");
    assert.equal(plan.excludedTemplates.length, 1);
    assert.equal(plan.excludedTemplates[0].id, "small");
    assert.match(plan.excludedTemplates[0].reason, /corner/i);
    assert.equal(plan.templates.find(template => template.id === "small")!.feasibleCount, 0);
  }
  assert.deepEqual(withGuidance.candidates, withoutGuidance.candidates, "unscoped corner guidance cannot affect the supported sibling");
});

test("legacy candidate API rejects a hard mechanical conflict outside the wetted circle", () => {
  const { project } = fixture();
  project.fieldBoundary = [{ x: -120, y: -120 }, { x: 120, y: -120 }, { x: 120, y: 120 }, { x: -120, y: 120 }];
  project.pivotCenter = { x: 0, y: 0 };
  project.waterSource = { x: 0, y: 0 };
  project.powerSource = { x: 0, y: 0 };
  project.machine.spanLengthsMeters = [100];
  project.machine.overhangMeters = 0;
  project.machine.endGunThrowMeters = 0;
  project.machine.machineClearanceBufferMeters = 5;
  project.obstacles = [{
    id: "outside-wet-inside-mechanical", name: "Synthetic mechanical-only obstacle", kind: "building",
    polygon: [{ x: 102, y: -1 }, { x: 104, y: -1 }, { x: 104, y: 1 }, { x: 102, y: 1 }],
    bufferMeters: 0, hardConflict: true, noSpray: true, confidence: "user_estimated",
  }];
  const before = structuredClone(project);
  const candidates = buildPivotPlacementCandidates(project, {
    gridDivisions: 3, maxCandidates: 128, includeMachineZoneReviews: false,
  });
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every(candidate => !candidate.feasible || candidate.metrics.hardMechanicalConflictCount === 0));
  // Coincident optimizer and maximum-inscribed-circle seeds may be deduplicated.
  const center = candidates.find(candidate => candidate.pivotCenter.x === 0 && candidate.pivotCenter.y === 0);
  assert.ok(center, "retain the center as an explanatory rejected result");
  assert.equal(center.metrics.hardMechanicalConflictCount, 1);
  assert.equal(center.metrics.obstacleConflictCount, 0, "the obstacle does not intersect wet coverage");
  assert.equal(center.feasible, false);
  assert.ok(center.disqualificationReasons.some(reason => /mechanical sweep/i.test(reason)));
  assert.deepEqual(project, before);
});
