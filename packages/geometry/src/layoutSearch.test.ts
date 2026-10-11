import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { type FieldDesign, type FieldPivotMachine, type PivotMachine, type PivotProject, type XY } from "@cplayout/core";
import { completeCalculation } from "./calculation";
import { createCirclePolygon, createSectorPolygon, evaluateLayout, multiPolygonAreaSquareMeters, validateWetCoverageWithinField } from "./geometry";
import { layoutSearchCandidateCenters, layoutSearchCandidateCenterSteps, LAYOUT_SEARCH_DIRECTIONS } from "./layoutSearchCandidates";
import { layoutSearchExchanges, type LayoutSearchCombinationHooks, type LayoutSearchScored } from "./layoutSearchCombinations";
import { layoutSearchCombinationFeasibility, prepareLayoutSearchEquipment, evaluateLayoutSearchCandidate, layoutSearchProjectAtCenter } from "./layoutSearchFeasibility";
import { layoutSearchScenario } from "./layoutSearchDiagnostics";
import { planAdvisoryPivotTemplates } from "./advisoryPivotPlacement";
import { layoutSearchCoverage } from "./layoutSearchCoverage";
import { layoutSearchResultMatches, searchFieldLayout, searchFieldLayoutSteps,
  LAYOUT_SEARCH_MODEL_VERSION, LAYOUT_SEARCH_REQUEST_VERSION, type LayoutSearchRequest } from "./layoutSearch";

const xy = (x: number, y: number): XY => ({ x, y });
const rectangle = (width: number, height: number) => [xy(0, 0), xy(width, 0), xy(width, height), xy(0, height)];
function machine(id = "equipment", radius = 20): PivotMachine {
  return { id, name: id, spanLengthsMeters: [radius * .4, radius * .6], overhangMeters: 0, endGunThrowMeters: 0,
    towerClearanceBufferMeters: 0, machineClearanceBufferMeters: 0, sweep: { mode: "full_circle" } };
}
function field(width = 200, height = 100): FieldDesign {
  return { id: "search-field", name: "Synthetic exact equipment field", projectCrs: "EPSG:32613", unitSystem: "metric",
    fieldBoundary: rectangle(width, height), infrastructure: [
      { id: "water", kind: "water_source", point: xy(0, 0) }, { id: "power", kind: "power_source", point: xy(0, 0) },
    ], machines: [], obstacles: [], surveyPoints: [], mapFeatures: [] };
}
function saved(id: string, radius: number, center: XY): FieldPivotMachine {
  const { id: _id, ...configuration } = machine(id, radius);
  return { id, kind: "center_pivot", configuration, pivotCenter: center, waterSourceId: "water", powerSourceId: "power" };
}
function request(): LayoutSearchRequest {
  return { schemaVersion: LAYOUT_SEARCH_REQUEST_VERSION, modelVersion: LAYOUT_SEARCH_MODEL_VERSION,
    field: field(), fieldRevision: 7, maxMachines: 2,
    budget: { maxCandidateCenters: 3, maxEvaluations: 3000, refinementLevels: 0 },
    templates: [{ id: "pivot", machine: machine(), maximumCount: 2, waterSourceId: "water", powerSourceId: "power" }],
    candidateCenters: [xy(30, 50), xy(100, 50), xy(170, 50)] };
}
function trap(): LayoutSearchRequest {
  const input = request();
  input.field = field(110, 70);
  input.candidateCenters = [xy(25, 35), xy(55, 35), xy(85, 35)];
  input.templates = [
    { id: "large", machine: machine("large", 31), maximumCount: 1, waterSourceId: "water", powerSourceId: "power" },
    { id: "small", machine: machine("small", 23), maximumCount: 2, waterSourceId: "water", powerSourceId: "power" },
  ];
  return input;
}
const regularArea = (radius: number) => 288 * radius ** 2 * Math.sin(2 * Math.PI / 288) / 2;
function close(actual: number, expected: number, epsilon = 1e-7) { assert(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`); }

test("candidate generation is bounded on sub-ULP grids and remains cancellable", () => {
  const input = request();
  delete input.candidateCenters;
  input.budget.maxCandidateCenters = 8;
  input.field.fieldBoundary = [xy(524288, 4194304), xy(524288.0000000001, 4194304),
    xy(524288.0000000001, 4194304.000000001), xy(524288, 4194304.000000001)];
  // A separate process bounds the regression even if an unbounded loop returns.
  const script = `import { layoutSearchCandidateCenters } from './src/layoutSearchCandidates.ts';
    const centers = layoutSearchCandidateCenters(JSON.parse(process.argv[1]));
    if (centers.length > 4) process.exit(2);`;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script, JSON.stringify(input)],
    { cwd: new URL("..", import.meta.url), timeout: 10000, encoding: "utf8" });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  const result = searchFieldLayout(input);
  assert.equal(result.termination, "budget_exhausted");
  assert(result.rejected.some(row => row.reason === "candidate_probe_limit_reached"));
  let cancelled = false;
  const steps = layoutSearchCandidateCenterSteps(input, () => { if (cancelled) throw new Error("cancelled"); });
  assert.equal(steps.next().done, false);
  cancelled = true;
  assert.throws(() => steps.next(), /cancelled/);
});

// Independent finite set oracle: exact raw structural reach, conservative boundary,
// and a regular-polygon area formula for the nonoverlapping, zero-end-gun fixture.
function exhaustiveCircleOracle(input: LayoutSearchRequest) {
  const options: { center: XY; radius: number; templateId: string; max: number }[] = [];
  for (const template of input.templates!) for (const center of input.candidateCenters!) {
    const radius = template.machine.spanLengthsMeters.reduce((sum, value) => sum + value, 0) + template.machine.overhangMeters;
    const boundary = input.field.fieldBoundary;
    if (center.x - radius <= boundary[0].x || center.y - radius <= boundary[0].y
      || center.x + radius >= boundary[2].x || center.y + radius >= boundary[2].y) continue;
    options.push({ center, radius, templateId: template.id, max: template.maximumCount });
  }
  let best = 0;
  for (let mask = 0; mask < 2 ** options.length; mask += 1) {
    const selected = options.filter((_value, index) => mask & (1 << index));
    if (selected.length > input.maxMachines) continue;
    if (selected.some(value => selected.filter(other => other.templateId === value.templateId).length > value.max)) continue;
    if (selected.some((left, i) => selected.some((right, j) => j > i && Math.hypot(left.center.x - right.center.x, left.center.y - right.center.y) < left.radius + right.radius))) continue;
    best = Math.max(best, selected.reduce((sum, value) => sum + regularArea(value.radius), 0));
  }
  return best;
}

test("deterministic restarts improve a greedy trap and match a tiny independent exhaustive oracle", () => {
  const input = trap(), before = structuredClone(input);
  const result = searchFieldLayout(input);
  assert.equal(result.termination, "completed");
  close(result.greedyBaseline!.irrigatedUnionSquareMeters, regularArea(31));
  close(result.best!.irrigatedUnionSquareMeters, 2 * regularArea(23));
  close(result.best!.irrigatedUnionSquareMeters, exhaustiveCircleOracle(input));
  assert(result.best!.irrigatedUnionSquareMeters > result.greedyBaseline!.irrigatedUnionSquareMeters);
  assert.equal(result.best!.machineCount, 2);
  assert.deepEqual(input, before);
  assert.equal(result.claim, "best_found");
  for (let i = 1; i < result.incumbentHistory.length; i += 1) assert(result.incumbentHistory[i].irrigatedUnionSquareMeters > result.incumbentHistory[i - 1].irrigatedUnionSquareMeters);
});

test("synchronous/cooperative results match and capture input before the first yield", () => {
  const input = trap(), expected = searchFieldLayout(input);
  const steps = searchFieldLayoutSteps(input);
  input.field.fieldBoundary[1].x += 500;
  input.templates![0].machine.spanLengthsMeters[0] += 90;
  input.candidateCenters!.reverse();
  assert.deepEqual(completeCalculation(steps), expected);
});

test("template, machine and explicit candidate input order cannot change selected results", () => {
  const input = trap(), result = searchFieldLayout(input);
  input.templates!.reverse(); input.candidateCenters!.reverse(); input.field.infrastructure.reverse();
  assert.deepEqual(searchFieldLayout(input), result);
  const existing = request(); existing.templates = [];
  existing.field.machines = [saved("B", 10, xy(150, 50)), saved("A", 30, xy(50, 50))];
  const original = searchFieldLayout(existing);
  existing.field.machines.reverse();
  assert.deepEqual(searchFieldLayout(existing), original);
});

test("candidate and evaluation budgets preserve exact completed prefixes and monotonic incumbents", () => {
  const input = trap();
  let previous = 0;
  for (const maxCandidateCenters of [1, 2, 3]) {
    const result = searchFieldLayout({ ...input, budget: { ...input.budget, maxCandidateCenters } });
    assert(result.best!.irrigatedUnionSquareMeters >= previous);
    previous = result.best!.irrigatedUnionSquareMeters;
  }
  const full = searchFieldLayout(input);
  for (const maxEvaluations of [1, 2, 5, Math.floor(full.evaluations.total / 2), full.evaluations.total - 1]) {
    const partial = searchFieldLayout({ ...input, budget: { ...input.budget, maxEvaluations } });
    assert.equal(partial.termination, "budget_exhausted");
    assert.equal(partial.evaluations.total, maxEvaluations);
    assert.deepEqual(partial.incumbentHistory, full.incumbentHistory.filter(row => row.evaluation <= maxEvaluations));
    assert((partial.best?.irrigatedUnionSquareMeters ?? 0) <= full.best!.irrigatedUnionSquareMeters);
  }
  delete input.candidateCenters;
  const short = layoutSearchCandidateCenters({ ...input, budget: { ...input.budget, maxCandidateCenters: 7 } });
  const long = layoutSearchCandidateCenters({ ...input, budget: { ...input.budget, maxCandidateCenters: 17 } });
  assert.deepEqual(long.slice(0, short.length), short);
});

test("cancellation by control and scheduler returns a distinct termination without mutation", () => {
  const input = trap(), before = structuredClone(input);
  let cancelled = false;
  const steps = searchFieldLayoutSteps(input, { isCancelled: () => cancelled });
  assert.equal(steps.next().done, false); cancelled = true;
  assert.equal(steps.next().value!.termination, "cancelled");
  const scheduler = searchFieldLayoutSteps(input);
  assert.equal(scheduler.next().done, false);
  assert.equal(scheduler.return(undefined as never).value!.termination, "cancelled");
  assert.equal(searchFieldLayout(input, { isCancelled: () => true }).evaluations.total, 0);
  assert.deepEqual(input, before);
});

test("field identity, revision, model and stale request checks remain independent of feasibility", () => {
  const input = request(), result = searchFieldLayout(input);
  const key = { fieldId: input.field.id, fieldRevision: input.fieldRevision, modelVersion: input.modelVersion };
  assert(layoutSearchResultMatches(result, key));
  for (const other of [{ ...key, fieldId: "other" }, { ...key, fieldRevision: 8 }, { ...key, modelVersion: "later" }]) assert(!layoutSearchResultMatches(result, other));
  const stale = searchFieldLayout({ ...input, expectedRevision: 6 });
  assert.equal(stale.termination, "unsupported_inputs"); assert.equal(stale.best, null);
  assert(stale.rejected.some(row => row.reason === "stale_field_revision"));
});

test("two unequal pinned machines retain identities, configurations, XY and explicit source associations", () => {
  const input = request(); input.templates = [];
  input.field.machines = [saved("small", 12, xy(35, 50)), saved("large", 30, xy(140, 50))];
  input.field.mapFeatures = [{ id: "evidence", name: "Reference line", kind: "corner_swing_limit", confidence: "user_estimated",
    geometry: { type: "LineString", vertices: [xy(10, 20), xy(20, 30)] } }];
  input.field.machines[0].sourceFeatureIds = ["evidence"];
  input.field.machines[0].cornerGuidanceFeatureId = "evidence";
  const before = structuredClone(input);
  const result = searchFieldLayout(input);
  assert.equal(result.termination, "completed");
  assert(result.best!.machines.every(value => value.pinned));
  for (const value of result.best!.machines) assert.deepEqual(value.machine, input.field.machines.find(machine => machine.id === value.machine.id));
  assert.deepEqual(input, before);
  close(result.best!.irrigatedUnionSquareMeters, regularArea(12) + regularArea(30));
});

test("only explicitly unlocked existing centers can move, without optional substitution", () => {
  const input = request(); input.templates = []; input.maxMachines = 1;
  input.field.machines = [saved("required", 20, xy(10, 50))];
  const original = structuredClone(input.field.machines[0]);
  assert.equal(searchFieldLayout(input).termination, "no_candidate_found");
  input.unlockedMachineIds = ["required"];
  const result = searchFieldLayout(input);
  assert.equal(result.termination, "completed");
  assert.equal(result.best!.machines[0].machine.id, original.id);
  assert.deepEqual(result.best!.machines[0].machine.configuration, original.configuration);
  assert.notDeepEqual(result.best!.machines[0].machine.pivotCenter, original.pivotCenter);
  assert.deepEqual(input.field.machines[0], original);
});

test("CRS admission and options reach geometry unchanged; missing supplies never fabricate points", () => {
  const input = request(); input.field.projectCrs = "LOCAL:declared-grid";
  assert.equal(searchFieldLayout(input).termination, "unsupported_inputs");
  input.crsOptions = { localMetricDeclaration: { projectCrs: input.field.projectCrs, unit: "metre", axes: "orthogonal_xy", evidenceReference: "Synthetic grid definition" } };
  const result = searchFieldLayout(input);
  assert.equal(result.termination, "completed"); assert.equal(result.projectCrs, "LOCAL:declared-grid");
  delete input.templates![0].waterSourceId;
  const missing = searchFieldLayout(input);
  assert.equal(missing.termination, "unsupported_inputs");
  assert(missing.rejected.some(row => row.reason === "water_source_missing"));
  input.field.projectCrs = "EPSG:3857";
  assert(searchFieldLayout(input).rejected.some(row => row.reason === "web_mercator_display_only"));
});

test("corner templates are excluded and an existing corner machine makes the result unsupported", () => {
  const input = request();
  const corner: NonNullable<PivotMachine["cornerArm"]> = { id: "corner", name: "Explicit unsupported corner", advisoryOnly: true,
    lengthMeters: 10, guidanceType: "unknown", sequencingType: "unknown", orientation: "unknown", confidence: "user_estimated", sourceRefs: [{ sourceId: "synthetic", limit: "Test configuration only" }] };
  input.templates![0].machine.cornerArm = corner;
  const onlyCorner = searchFieldLayout(input);
  assert.equal(onlyCorner.termination, "unsupported_inputs");
  assert(onlyCorner.rejected.some(row => row.reason === "corner_motion_and_collision_unresolved"));
  input.field.machines = [saved("pinned-corner", 10, xy(100, 50))];
  input.field.machines[0].configuration.cornerArm = corner;
  assert.equal(searchFieldLayout(input).best, null);
});

test("prices bind the entire exact configuration and missing/mixed costs are unavailable", () => {
  const input = request();
  const template = input.templates![0];
  template.price = { machine: structuredClone(template.machine), amount: 1234, currencyCode: "USD" };
  let result = searchFieldLayout(input);
  assert.equal(result.best!.cost.amount, 2468);
  template.price.machine.spanLengthsMeters[0] += 1;
  result = searchFieldLayout(input);
  assert.deepEqual(result.best!.cost, { amount: null, currencyCode: null, costPerIrrigatedAcre: null });
  assert(result.rejected.some(row => row.scope === "price"));
  delete template.price;
  assert.equal(searchFieldLayout(input).best!.cost.amount, null);
});

test("net union removes no-spray holes, handles triple overlap, circles and partial sectors", () => {
  const ring = rectangle(10, 10), hole = [xy(2, 2), xy(8, 2), xy(8, 8), xy(2, 8)];
  const triple = layoutSearchCoverage([[[ring, hole]], [[ring, hole]], [[ring, hole]]]);
  assert.equal(triple.areaSquareMeters, 64); assert.equal(triple.overlapSquareMeters, 128);
  close(multiPolygonAreaSquareMeters([[createCirclePolygon(xy(0, 0), 20)]]), regularArea(20));
  close(multiPolygonAreaSquareMeters([[createSectorPolygon(xy(0, 0), 20,
    { mode: "partial_circle", startAngleDegrees: 0, stopAngleDegrees: 90, direction: "counterclockwise" })]]), regularArea(20) / 4);
  const input = request(); input.maxMachines = 1;
  input.candidateCenters = [xy(100, 50)];
  input.field.obstacles = [{ id: "no-spray", name: "No spray", kind: "exclusion", confidence: "user_estimated", hardConflict: false, noSpray: true,
    bufferMeters: 0, polygon: [xy(98, 48), xy(102, 48), xy(102, 52), xy(98, 52)] }];
  close(searchFieldLayout(input).best!.irrigatedUnionSquareMeters, regularArea(20) - 16);
});

test("hard mechanics and conservative containment reject candidates independent of wet acres", () => {
  const input = request(); input.maxMachines = 1; input.candidateCenters = [xy(100, 50)];
  input.field.obstacles = [{ id: "tiny", name: "Tiny hard obstacle", kind: "building", confidence: "user_estimated", hardConflict: true, noSpray: false,
    bufferMeters: 0, polygon: [xy(109.99, 49.99), xy(110.01, 49.99), xy(110.01, 50.01), xy(109.99, 50.01)] }];
  const blocked = searchFieldLayout(input);
  assert.equal(blocked.best, null); assert(blocked.rejected.some(row => row.reason === "hard_mechanical_conflict"));
  input.field.obstacles = []; input.field.fieldBoundary = createCirclePolygon(xy(100, 50), 20, 288);
  const { drawingMetadata: _metadata, ...shared } = input.field;
  const project: PivotProject = { ...shared, pivotCenter: xy(100, 50), waterSource: xy(0, 0), powerSource: xy(0, 0), machine: input.templates![0].machine };
  assert.equal(evaluateLayout(project).metrics.outsideFieldAcres, 0);
  assert.equal(validateWetCoverageWithinField(project).feasible, false);
  assert.equal(searchFieldLayout(input).best, null);
});

test("large projected XY retains physical results and eight-direction refinement is explicit", () => {
  const input = trap(), original = searchFieldLayout(input);
  const offset = xy(500000.125, 4400000.25);
  const translate = (point: XY) => { point.x += offset.x; point.y += offset.y; };
  input.field.fieldBoundary.forEach(translate); input.field.infrastructure.forEach(row => translate(row.point)); input.candidateCenters!.forEach(translate);
  const shifted = searchFieldLayout(input);
  close(shifted.best!.irrigatedUnionSquareMeters, original.best!.irrigatedUnionSquareMeters, 1e-5);
  assert.equal(new Set(LAYOUT_SEARCH_DIRECTIONS.map(point => JSON.stringify(point))).size, 8);
  const refinement = request(); refinement.maxMachines = 1; refinement.candidateCenters = [xy(100, 50)]; refinement.budget.refinementLevels = 2;
  const result = searchFieldLayout(refinement);
  assert.equal(result.evaluations.candidates, 17, "one center plus all eight directions at each of two shrinking levels");
});

test("a supplied baseline is revalidated and retained even when absent from generated candidates", () => {
  const input = request(); input.candidateCenters = [xy(30, 50)];
  input.initialIncumbent = { optionalMachines: [{ templateId: "pivot", pivotCenter: xy(50, 50) }, { templateId: "pivot", pivotCenter: xy(150, 50) }] };
  const result = searchFieldLayout(input);
  assert.equal(result.best!.machineCount, 2); assert.equal(result.incumbentHistory[0].phase, "initial");
  input.initialIncumbent.optionalMachines![0].pivotCenter = xy(1, 1);
  const rejected = searchFieldLayout(input);
  assert.equal(rejected.best!.machineCount, 1); assert(rejected.rejected.some(row => row.reason === "initial_incumbent_rejected"));
});

test("numerical failures and empty finite sets do not masquerade as completed searches", () => {
  const input = request(); input.candidateCenters = [xy(1e20, 1e20)];
  assert.equal(searchFieldLayout(input).termination, "numerical_failure");
  input.candidateCenters = [];
  assert.equal(searchFieldLayout(input).termination, "no_candidate_found");
  assert.throws(() => searchFieldLayout({ ...input, maxMachines: 9 }), /maxMachines/);
  assert.throws(() => searchFieldLayout({ ...input, unlockedMachineIds: ["unknown"] }), /not found/);
  assert.throws(() => searchFieldLayout({ ...input, candidateCenters: [xy(Infinity, 0)] }), /finite/);
});


test("one-for-one and one-for-two physical exchanges improve a retained incumbent", () => {
  const input = trap();
  const prepared = prepareLayoutSearchEquipment(input, () => { throw new Error("Unexpected unsupported fixture"); });
  const at = (id: string, center: XY) => {
    const value = evaluateLayoutSearchCandidate(input, prepared.equipment.find(item => item.id === id)!, center).candidate;
    assert(value); return value;
  };
  const large = at("large", xy(55, 35)), smallCenter = at("small", xy(55, 35));
  const left = at("small", xy(25, 35)), right = at("small", xy(85, 35));
  let incumbent: LayoutSearchScored = { selected: [smallCenter], scenario: layoutSearchScenario(input, [smallCenter], []) };
  const improvementPhases: string[] = [];
  const hooks: LayoutSearchCombinationHooks = { incumbent: () => incumbent,
    *evaluate(selected, phase) {
      const feasibility = layoutSearchCombinationFeasibility(input, selected, []);
      if (!feasibility.feasible) { yield; return null; }
      const scored = { selected, scenario: layoutSearchScenario(input, selected, feasibility.pairs) };
      if (scored.scenario.irrigatedUnionSquareMeters > incumbent.scenario.irrigatedUnionSquareMeters) {
        incumbent = scored; improvementPhases.push(phase);
      }
      yield; return scored;
    },
  };
  completeCalculation(layoutSearchExchanges([large], hooks));
  close(incumbent.scenario.irrigatedUnionSquareMeters, regularArea(31));
  completeCalculation(layoutSearchExchanges([left, right], hooks));
  close(incumbent.scenario.irrigatedUnionSquareMeters, 2 * regularArea(23));
  assert.deepEqual(improvementPhases, ["exchange_one", "exchange_two"]);
});

test("all pinned pairs use raw reach and exactly one maximum configured gap", () => {
  for (const delta of [-(2 ** -20), 0, 2 ** -20]) {
    const input = request(); input.templates = [];
    input.field.machines = [saved("left", 10.125, xy(50, 50)), saved("right", 20.0625, xy(50 + 10.125 + 20.0625 + 7.125 + delta, 50))];
    input.field.machines[0].configuration.machineClearanceBufferMeters = 7.125;
    input.field.machines[1].configuration.machineClearanceBufferMeters = 3;
    const result = searchFieldLayout(input);
    if (delta < 0) assert.equal(result.best, null);
    else {
      assert.equal(result.best!.pairClearances[0].minimumRequiredSeparationMeters, 37.3125);
      assert.equal(result.best!.pairClearances[0].pairBufferMeters, 7.125);
      close(result.best!.minimumPairClearanceMeters!, delta);
    }
  }
});

test("small positive footprints remain eligible; concave field cuts remain hard failures", () => {
  const input = request(); input.field = field(1000, 1000); input.maxMachines = 1;
  input.templates![0].machine = machine("tiny", 3);
  input.candidateCenters = [xy(100, 100)];
  close(searchFieldLayout(input).best!.irrigatedUnionSquareMeters, regularArea(3));
  input.field.fieldBoundary = [xy(0, 0), xy(200, 0), xy(200, 200), xy(101, 200), xy(101, 99), xy(99, 99), xy(99, 200), xy(0, 200)];
  const concave = searchFieldLayout(input);
  assert.equal(concave.best, null);
  assert(concave.rejected.some(row => row.reason === "wet_coverage_outside_boundary"));
});

test("generated center limits report exhaustion, including before any feasible candidate", () => {
  const input = request(); delete input.candidateCenters;
  input.budget.maxCandidateCenters = 1;
  assert.equal(searchFieldLayout(input).termination, "budget_exhausted");
  input.templates![0].machine = machine("too-large", 1000);
  const result = searchFieldLayout(input);
  assert.equal(result.best, null); assert.equal(result.termination, "budget_exhausted");
});

test("a corrected legacy template result can be supplied and retained under exact validation", () => {
  const input = request(); input.field = field(240, 160); input.maxMachines = 2;
  const project: PivotProject = { id: "legacy", name: "Synthetic baseline", projectCrs: input.field.projectCrs, unitSystem: "metric",
    fieldBoundary: input.field.fieldBoundary, pivotCenter: xy(60, 80), waterSource: xy(0, 0), powerSource: xy(0, 0),
    machine: input.templates![0].machine, obstacles: [], surveyPoints: [], mapFeatures: [] };
  const legacy = planAdvisoryPivotTemplates(project, input.templates!.map(({ id, machine, maximumCount }) => ({ id, machine, maximumCount })), { maxMachines: 2, gridDivisions: 3,
    candidatePoolSize: 4, maxCandidates: 4, includeMaximumInscribedCircleSeed: false, includeMachineZoneReviews: false });
  input.initialIncumbent = { optionalMachines: legacy.candidates.map(row => ({ templateId: row.templateId, pivotCenter: row.pivotCenter })) };
  input.candidateCenters = [];
  const result = searchFieldLayout(input);
  assert(result.best);
  close(result.best.irrigatedUnionAcres, legacy.modeledIrrigatedUnionAcres);
});


test("modeled movement clears obsolete observation bindings while source survey evidence stays intact", () => {
  const input = request(); input.templates = []; input.maxMachines = 1;
  input.field.machines = [saved("surveyed", 20, xy(10, 50))];
  input.field.machines[0].pivotObservationId = "original-center";
  input.field.surveyPoints = [{ id: "original-center", label: "Original center observation", role: "pivot_center", projected: xy(10, 50),
    observedAt: "2026-09-27T00:00:00Z", source: "manual", confidence: "user_estimated" }];
  input.unlockedMachineIds = ["surveyed"];
  const before = structuredClone(input.field);
  const prepared = prepareLayoutSearchEquipment(input, () => { throw new Error("Unsupported fixture"); });
  assert.equal(prepared.equipment[0].project.infrastructureObservationRefs!.pivot_center, "original-center");
  assert.equal(layoutSearchProjectAtCenter(prepared.equipment[0], xy(100, 50)).infrastructureObservationRefs?.pivot_center, undefined);
  assert.equal(layoutSearchProjectAtCenter(prepared.equipment[0], xy(10, 50)).infrastructureObservationRefs?.pivot_center, "original-center");
  const result = searchFieldLayout(input);
  assert.equal(result.best!.machines[0].machine.pivotObservationId, undefined);
  assert.deepEqual(input.field, before);
});

test("fields containing straight laterals cannot silently receive pivot-only feasibility", () => {
  const input = request();
  input.field.lateralMachines = [{ id: "lateral", kind: "straight_lateral", name: "Separate unsupported search equipment",
    leftExtentMeters: 10, rightExtentMeters: 10, travelHeadingDegrees: 0,
    travel: { start: xy(20, 20), end: xy(100, 20) }, machineClearanceBufferMeters: 0, waterSourceId: "water" }];
  const result = searchFieldLayout(input);
  assert.equal(result.termination, "unsupported_inputs"); assert.equal(result.best, null);
  assert(result.rejected.some(row => row.reason === "lateral_machine_envelopes_unsupported"));
});

// V2 regression expectations are analytic or compare a frozen v1 lane. They do
// not infer field safety or a global optimum from heuristic search results.
import { searchFieldLayoutV2, searchFieldLayoutV2Steps, LAYOUT_SEARCH_REQUEST_VERSION_V2,
  LAYOUT_SEARCH_MODEL_VERSION_V2, type LayoutSearchRequestV2 } from "./layoutSearch";
const v2 = (input: LayoutSearchRequest): LayoutSearchRequestV2 => ({ ...input,
  schemaVersion: LAYOUT_SEARCH_REQUEST_VERSION_V2, modelVersion: LAYOUT_SEARCH_MODEL_VERSION_V2 });

function boundedFixture(): LayoutSearchRequest {
  const input = request(); input.field = field(1000, 800); input.maxMachines = 8;
  delete input.candidateCenters;
  input.budget = { maxCandidateCenters: 24, maxEvaluations: 1500, refinementLevels: 3 };
  input.templates = [120, 90, 70, 50].map((radius, index) => ({ id: `template-${index}`, machine: machine(`machine-${index}`, radius),
    maximumCount: 8, waterSourceId: "water", powerSourceId: "power" }));
  return input;
}

test("v2 reuses initial positions when assembling later combinations", () => {
  const input = request(); input.field = field(200, 200); input.candidateCenters = [xy(140, 100)];
  input.initialIncumbent = { optionalMachines: [{ templateId: "pivot", pivotCenter: xy(40, 100) }] };
  const old = searchFieldLayout(input), result = searchFieldLayoutV2(v2(input));
  assert.equal(old.best!.machineCount, 1, "Frozen v1 reproduction remains explicit.");
  assert.equal(result.best!.machineCount, 2);
  close(result.best!.irrigatedUnionSquareMeters, 2 * regularArea(20));
  assert.equal(result.termination, "completed");
});

test("v2 reuses refined positions after the final base prefix", () => {
  const input = request(); input.field = field(400, 200); input.candidateCenters = [xy(200, 100)];
  input.budget = { maxCandidateCenters: 1, maxEvaluations: 3000, refinementLevels: 1 };
  const old = searchFieldLayout(input), result = searchFieldLayoutV2(v2(input));
  assert.equal(old.best!.machineCount, 1);
  assert.equal(result.best!.machineCount, 2);
  close(result.best!.irrigatedUnionSquareMeters, 2 * regularArea(20));
  assert(result.diagnostics.registryCandidates > result.evaluations.baseCenters);
});

test("v2 solves the independent tiny greedy trap and reports cached expensive work", () => {
  const input = trap(), result = searchFieldLayoutV2(v2(input));
  close(result.best!.irrigatedUnionSquareMeters, exhaustiveCircleOracle(input));
  // The baseline may itself improve as later prefixes are admitted. Retain the
  // independent central large-machine result to demonstrate the original trap.
  assert(result.best!.irrigatedUnionSquareMeters > regularArea(31) + 300);
  assert(result.diagnostics.combinationCacheHits > 0);
  assert(result.diagnostics.unionCalls < result.evaluations.combinations);
  assert(result.diagnostics.scenariosMaterialized <= result.incumbentHistory.length + result.evaluations.baseCenters + 1);
  assert.equal(result.diagnostics.combinationAttempts, result.evaluations.combinations);
  assert(result.diagnostics.peakPairCacheEntries <= input.budget.maxEvaluations);
  assert(result.diagnostics.peakCombinationCacheEntries <= input.budget.maxEvaluations);
});

test("v2 admits at least eight centers in the frozen four-template budget without losing baseline coverage", () => {
  const input = boundedFixture(), old = searchFieldLayout(input), result = searchFieldLayoutV2(v2(input));
  assert(result.evaluations.baseCenters >= 8, JSON.stringify(result.evaluations));
  assert(result.best!.irrigatedUnionSquareMeters + result.comparisonToleranceSquareMeters >= old.best!.irrigatedUnionSquareMeters,
    `${result.best!.irrigatedUnionSquareMeters} < frozen v1 ${old.best!.irrigatedUnionSquareMeters}`);
});

test("v2 nested prefix/evaluation budgets retain the same earlier incumbent history", () => {
  const input = boundedFixture(); input.budget.refinementLevels = 1;
  for (const centers of [2, 4, 8]) {
    const full = searchFieldLayoutV2(v2({ ...input, budget: { ...input.budget, maxCandidateCenters: centers, maxEvaluations: 1500 } }));
    for (const evaluations of [1, 10, 100, 300, 800]) {
      const limited = searchFieldLayoutV2(v2({ ...input, budget: { ...input.budget, maxCandidateCenters: centers, maxEvaluations: evaluations } }));
      assert.deepEqual(limited.incumbentHistory, full.incumbentHistory.filter(row => row.evaluation <= evaluations));
      assert((limited.best?.irrigatedUnionSquareMeters ?? 0) <= (full.best?.irrigatedUnionSquareMeters ?? 0));
    }
  }
  let prior: ReturnType<typeof searchFieldLayoutV2> | undefined;
  for (const centers of [1, 2, 4, 8, 16, 24]) {
    const result = searchFieldLayoutV2(v2({ ...input, budget: { ...input.budget, maxCandidateCenters: centers } }));
    if (prior) {
      assert((result.best?.irrigatedUnionSquareMeters ?? 0) >= (prior.best?.irrigatedUnionSquareMeters ?? 0));
      assert.deepEqual(result.incumbentHistory.slice(0, prior.incumbentHistory.length), prior.incumbentHistory);
    }
    prior = result;
  }
  const finite = trap(); let finiteArea = 0;
  for (const centers of [1, 2, 3, 5]) {
    const result = searchFieldLayoutV2(v2({ ...finite, budget: { ...finite.budget, maxCandidateCenters: centers } }));
    assert((result.best?.irrigatedUnionSquareMeters ?? 0) >= finiteArea);
    finiteArea = result.best?.irrigatedUnionSquareMeters ?? 0;
  }
});

test("v2 has deterministic cooperative snapshots, progress isolation and cancellation", () => {
  const input = v2(trap()), expected = searchFieldLayoutV2(input);
  let callbacks = 0, sawBest = false;
  const steps = searchFieldLayoutV2Steps(input, { onProgress(progress) {
    callbacks += 1;
    if (progress.best) { sawBest = true; progress.best.irrigatedUnionSquareMeters = -999; }
    progress.evaluations.total = -999;
  } });
  input.field.fieldBoundary[0].x -= 200;
  assert.deepEqual(completeCalculation(steps), expected); assert(callbacks > 2); assert(sawBest);
  let cancelled = false;
  const live = searchFieldLayoutV2Steps(v2(boundedFixture()), { isCancelled: () => cancelled });
  for (let index = 0; index < 40; index += 1) assert.equal(live.next().done, false);
  cancelled = true;
  const result = live.next(); assert(result.done); assert.equal(result.value.termination, "cancelled");
  const closed = searchFieldLayoutV2Steps(v2(trap())); closed.next();
  assert.equal(closed.return(undefined as never).value!.termination, "cancelled");
});

test("v2 bounds tiny-grid probes and can cancel during candidate generation", () => {
  const input = request(); delete input.candidateCenters; input.budget.maxCandidateCenters = 8;
  input.field.fieldBoundary = [xy(524288, 4194304), xy(524288.0000000001, 4194304),
    xy(524288.0000000001, 4194304.000000001), xy(524288, 4194304.000000001)];
  const result = searchFieldLayoutV2(v2(input));
  assert.equal(result.terminationReason, "candidate_probe_limit_reached");
  assert.equal(result.diagnostics.seedProbes, 8192);
  let cancelled = false;
  const steps = searchFieldLayoutV2Steps(v2(input), { isCancelled: () => cancelled,
    onProgress(progress) { if (progress.diagnostics.seedProbes > 0) cancelled = true; } });
  assert.equal(completeCalculation(steps).termination, "cancelled");
});

test("v2 interior seeds find a concave U arm within 24 centers and remain order stable", () => {
  const input = request(); input.field = field(300, 300); delete input.candidateCenters;
  input.field.fieldBoundary = [xy(0, 0), xy(300, 0), xy(300, 300), xy(220, 300), xy(220, 80), xy(80, 80), xy(80, 300), xy(0, 300)];
  input.maxMachines = 1; input.budget = { maxCandidateCenters: 24, maxEvaluations: 1500, refinementLevels: 0 };
  const result = searchFieldLayoutV2(v2(input)); assert(result.best); close(result.best.irrigatedUnionSquareMeters, regularArea(20));
  assert(result.evaluations.baseCenters <= 24);
  input.field.fieldBoundary = [...input.field.fieldBoundary.slice(3), ...input.field.fieldBoundary.slice(0, 3)].reverse();
  assert.deepEqual(searchFieldLayoutV2(v2(input)).best, result.best);
});

test("v2 supplied ordering and large coordinate translation do not create false improvements", () => {
  const input = trap(), original = searchFieldLayoutV2(v2(input));
  input.templates!.reverse(); input.candidateCenters!.reverse(); input.field.infrastructure.reverse();
  assert.deepEqual(searchFieldLayoutV2(v2(input)), original);
  const shift = xy(500000.125, 4400000.25);
  const translate = (point: XY) => { point.x += shift.x; point.y += shift.y; };
  input.field.fieldBoundary.forEach(translate); input.field.infrastructure.forEach(value => translate(value.point)); input.candidateCenters!.forEach(translate);
  const shifted = searchFieldLayoutV2(v2(input));
  close(shifted.best!.irrigatedUnionSquareMeters, original.best!.irrigatedUnionSquareMeters, 1e-5);
  assert.deepEqual(shifted.incumbentHistory.map(row => row.machineCount), original.incumbentHistory.map(row => row.machineCount));
  assert(shifted.comparisonToleranceSquareMeters >= original.comparisonToleranceSquareMeters);
});

test("v2 retains mandatory identities, metric qualification and below/at/above physical separation", () => {
  for (const delta of [-(2 ** -20), 0, 2 ** -20]) {
    const input = request(); input.templates = [];
    input.field.machines = [saved("left", 10.125, xy(50, 50)), saved("right", 20.0625, xy(87.3125 + delta, 50))];
    input.field.machines[0].configuration.machineClearanceBufferMeters = 7.125;
    input.field.machines[1].configuration.machineClearanceBufferMeters = 3;
    const result = searchFieldLayoutV2(v2(input));
    if (delta < 0) assert.equal(result.best, null);
    else {
      assert(result.best!.machines.every(row => row.pinned));
      for (const row of result.best!.machines) assert.deepEqual(row.machine, input.field.machines.find(item => item.id === row.machine.id));
      close(result.best!.minimumPairClearanceMeters!, delta);
      assert.equal(result.best!.pairClearances[0].minimumRequiredSeparationMeters, 37.3125);
    }
  }
  const local = request(); local.field.projectCrs = "LOCAL:unknown";
  assert.equal(searchFieldLayoutV2(v2(local)).termination, "unsupported_inputs");
  local.crsOptions = { localMetricDeclaration: { projectCrs: local.field.projectCrs, unit: "metre", axes: "orthogonal_xy", evidenceReference: "Synthetic declaration" } };
  assert(searchFieldLayoutV2(v2(local)).best);
  const stale = searchFieldLayoutV2(v2({ ...request(), expectedRevision: 6 }));
  assert.equal(stale.terminationReason, "stale_field_revision");
});

test("v2 explicitly revalidates and retains a v1 comparison result within its own work budget", () => {
  const input = boundedFixture(), prior = searchFieldLayout(input);
  input.initialIncumbent = { optionalMachines: prior.best!.machines.map(row => ({ templateId: row.source.id, pivotCenter: row.machine.pivotCenter })) };
  const result = searchFieldLayoutV2(v2(input));
  assert.equal(result.incumbentHistory[0].phase, "initial");
  assert(result.best!.irrigatedUnionSquareMeters + result.comparisonToleranceSquareMeters >= prior.best!.irrigatedUnionSquareMeters);
  assert(result.evaluations.total <= input.budget.maxEvaluations);
  assert(result.evaluations.candidates >= prior.best!.machineCount);
  input.initialIncumbent.optionalMachines![0].pivotCenter = xy(1, 1);
  const rejected = searchFieldLayoutV2(v2(input));
  assert(rejected.rejected.some(row => row.reason === "initial_incumbent_rejected"));
});

test("v2 no-spray, missing prices and invalid initial pinned moves stay explicit", () => {
  const input = request(); input.maxMachines = 1; input.candidateCenters = [xy(100, 50)];
  input.field.obstacles = [{ id: "no-spray", name: "No spray", kind: "exclusion", confidence: "user_estimated", hardConflict: false,
    noSpray: true, bufferMeters: 0, polygon: [xy(98, 48), xy(102, 48), xy(102, 52), xy(98, 52)] }];
  const result = searchFieldLayoutV2(v2(input)); close(result.best!.irrigatedUnionSquareMeters, regularArea(20) - 16);
  assert.deepEqual(result.best!.cost, { amount: null, currencyCode: null, costPerIrrigatedAcre: null });
  input.templates = []; input.field.machines = [saved("pinned", 20, xy(50, 50))];
  input.initialIncumbent = { existingCenters: [{ machineId: "pinned", pivotCenter: xy(100, 50) }] };
  const pinned = searchFieldLayoutV2(v2(input));
  assert(pinned.rejected.some(row => row.reason === "initial_incumbent_moves_pinned_machine"));
  assert.deepEqual(pinned.best!.machines[0].machine.pivotCenter, xy(50, 50));
});

test("v2 equal coverage at large projected offsets retains the first feasible incumbent", () => {
  const input = request(); input.field = field(1000, 800); input.maxMachines = 1;
  input.templates![0].machine = machine("exact", 80); input.templates![0].maximumCount = 1;
  input.budget = { maxCandidateCenters: 12, maxEvaluations: 3000, refinementLevels: 0 };
  input.candidateCenters = Array.from({ length: 12 }, (_, index) => xy(200.0107 + index * 3.1237, 300.0471 + index * 7.5671));
  const offset = xy(536870600.125, 440000000.25);
  const translate = (point: XY) => { point.x += offset.x; point.y += offset.y; };
  input.field.fieldBoundary.forEach(translate); input.field.infrastructure.forEach(row => translate(row.point)); input.candidateCenters.forEach(translate);
  const result = searchFieldLayoutV2(v2(input));
  assert(result.best);
  assert.equal(result.incumbentHistory.length, 1, JSON.stringify(result.incumbentHistory));
});
