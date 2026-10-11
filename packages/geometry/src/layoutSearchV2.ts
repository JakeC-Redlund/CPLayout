import { qualifyProjectCrs, snapshotJsonValue, type XY } from "@cplayout/core";
import { completeCalculation, type Calculation } from "./calculation";
import { boundsForGeometry } from "./geometry";
import { validateLayoutSearchRequest } from "./layoutSearch";
import { layoutSearchPointKey, layoutSearchRefinementStep, LAYOUT_SEARCH_DIRECTIONS } from "./layoutSearchCandidates";
import { createLayoutSearchCenterSourceV2 } from "./layoutSearchV2Candidates";
import { layoutSearchExchangesV2, layoutSearchExhaustiveV2, layoutSearchGreedyV2, layoutSearchMultiStartV2,
  type LayoutSearchScalarHooks, type LayoutSearchScalarScore } from "./layoutSearchV2Combinations";
import { layoutSearchCoverageV2 } from "./layoutSearchCoverage";
import { layoutSearchPriceMatches, layoutSearchRejectionRecorder, layoutSearchScenario } from "./layoutSearchDiagnostics";
import { evaluateLayoutSearchCandidate, prepareLayoutSearchEquipment, type LayoutSearchCandidate, type LayoutSearchEquipment } from "./layoutSearchFeasibility";
import { evaluatePivotPairSeparation } from "./machineSeparation";
import { LAYOUT_SEARCH_REQUEST_VERSION, LAYOUT_SEARCH_MODEL_VERSION, LAYOUT_SEARCH_REQUEST_VERSION_V2,
  LAYOUT_SEARCH_RESULT_VERSION_V2, LAYOUT_SEARCH_MODEL_VERSION_V2, type LayoutSearchRequest,
  type LayoutSearchRequestV2, type LayoutSearchResultV2, type LayoutSearchControlV2,
  type LayoutSearchPhase, type LayoutSearchPairClearance, type LayoutSearchTermination, type LayoutSearchProgressV2 } from "./layoutSearchTypes";

/** Snapshot and validation occur before the first cooperative yield. */
export function searchFieldLayoutV2Steps(request: LayoutSearchRequestV2, control: LayoutSearchControlV2 = {}): Calculation<LayoutSearchResultV2> {
  const owned = snapshotJsonValue(request, "layout search v2") as LayoutSearchRequestV2;
  if (owned.schemaVersion !== LAYOUT_SEARCH_REQUEST_VERSION_V2) throw new Error("Unsupported layout search v2 request version.");
  const common: LayoutSearchRequest = { ...owned, schemaVersion: LAYOUT_SEARCH_REQUEST_VERSION, modelVersion: LAYOUT_SEARCH_MODEL_VERSION };
  validateLayoutSearchRequest(common);
  return searchOwned(common, owned.modelVersion, control);
}
export function searchFieldLayoutV2(request: LayoutSearchRequestV2, control: LayoutSearchControlV2 = {}): LayoutSearchResultV2 {
  return completeCalculation(searchFieldLayoutV2Steps(request, control));
}
class SearchStop { constructor(readonly termination: LayoutSearchTermination, readonly reason: string) {} }
interface CachedScore { areaSquareMeters: number; overlapSquareMeters: number; reason?: string }
const candidateOrder = (a: LayoutSearchCandidate, b: LayoutSearchCandidate) => a.equipment.key < b.equipment.key ? -1
  : a.equipment.key > b.equipment.key ? 1 : a.center.x - b.center.x || a.center.y - b.center.y;
const WORK_PER_PREFIX = 128;

function* searchOwned(request: LayoutSearchRequest, modelVersion: string, control: LayoutSearchControlV2): Calculation<LayoutSearchResultV2> {
  const rejected = layoutSearchRejectionRecorder();
  const bounds = boundsForGeometry([request.field.fieldBoundary]);
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  // Geometry has already been quantized into absolute XY. Translating the clip
  // frame cannot recover those bits; include the coordinate ULP scale as well
  // as local extent in ranking ties. This is a numerical guard, not a field or
  // formal interval-arithmetic error certificate.
  const coordinateScale = Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX), Math.abs(bounds.minY), Math.abs(bounds.maxY));
  const tolerance = Math.max(1e-7, 128 * Number.EPSILON * extent * Math.max(extent, coordinateScale));
  const result: LayoutSearchResultV2 = {
    schemaVersion: LAYOUT_SEARCH_RESULT_VERSION_V2,
    requestKey: { fieldId: request.field.id, fieldRevision: request.fieldRevision, modelVersion },
    projectCrs: request.field.projectCrs, budget: request.budget, advisoryOnly: true, canonicalGeometryMutation: false,
    claim: "best_found", objective: "maximum_eligible_coverage_union", termination: "no_candidate_found", terminationReason: "not_started",
    comparisonToleranceSquareMeters: tolerance, best: null, greedyBaseline: null,
    evaluations: { total: 0, candidates: 0, combinations: 0, baseCenters: 0, completedPrefixes: 0 },
    diagnostics: { seedProbes: 0, candidateAttempts: 0, candidateCacheHits: 0, combinationAttempts: 0, combinationCacheHits: 0,
      pairChecks: 0, pairCacheHits: 0, pairCacheEvictions: 0, unionCalls: 0, scenariosMaterialized: 0,
      registryCandidates: 0, pendingJobs: 0, workSteps: 0, peakCandidateCacheEntries: 0, peakCombinationCacheEntries: 0, peakPairCacheEntries: 0 },
    incumbentHistory: [], rejected: [], warnings: [
      "Best found under this version's bounded search schedule; no global optimality certificate is available.",
      "Exact supplied equipment only. Saved machines remain mandatory and fixed unless explicitly unlocked; calculation never adopts a layout.",
      "Raw full-reach pair circles and one maximum configured gap are conservative for partial sweeps; hydraulics, terrain, controls and field safety are unverified.",
      "Polygon coverage is approximate. Missing exact prices remain unknown. Improvements within the reported numerical tolerance retain the earlier incumbent.",
      "V2 changes candidate generation and scheduling. Retain a previous feasible result through initialIncumbent for a direct no-regression comparison across versions.",
      "Cancellation is checked between geometry operations; an individual polygon operation cannot be interrupted.",
    ],
  };
  let incumbent: LayoutSearchScalarScore | null = null;
  let phase: LayoutSearchProgressV2["phase"] = "initial", finished = false, observer = control.onProgress;
  let lastProgressStep = -64;
  const stats = result.diagnostics;
  const cache = new Map<string, LayoutSearchCandidate | null>();
  const registry = new Map<string, LayoutSearchCandidate>();
  const combinations = new Map<string, CachedScore>();
  const pairs = new Map<string, LayoutSearchPairClearance>();
  const requiredIds = request.field.machines.map(machine => machine.id);
  const checkStop = () => { if (control.isCancelled?.()) throw new SearchStop("cancelled", "cancelled_by_caller"); };
  const count = (kind: "candidates" | "combinations") => {
    checkStop();
    if (result.evaluations.total >= request.budget.maxEvaluations) throw new SearchStop("budget_exhausted", "evaluation_limit_reached");
    result.evaluations.total += 1; result.evaluations[kind] += 1;
  };
  function progress(force = false) {
    if (!observer || (!force && stats.workSteps - lastProgressStep < 64)) return;
    lastProgressStep = stats.workSteps;
    try {
      observer(snapshotJsonValue({ phase, best: result.best, greedyBaseline: result.greedyBaseline,
        evaluations: result.evaluations, diagnostics: stats, termination: finished ? result.termination : null }, "search progress") as LayoutSearchProgressV2);
    } catch {
      result.warnings.push("Progress observer failed and was disabled; search continued with unchanged inputs."); observer = undefined;
    }
  }
  function* checkpoint(): Calculation<void> { stats.workSteps += 1; progress(); yield; checkStop(); }
  function* candidate(equipment: LayoutSearchEquipment, center: XY): Calculation<LayoutSearchCandidate | null> {
    checkStop(); stats.candidateAttempts += 1;
    const key = JSON.stringify([equipment.key, layoutSearchPointKey(center)]);
    if (cache.has(key)) { stats.candidateCacheHits += 1; yield* checkpoint(); return cache.get(key)!; }
    count("candidates");
    const evaluation = evaluateLayoutSearchCandidate(request, equipment, center);
    evaluation.reasons.forEach(reason => rejected.reject("candidate", equipment.id, reason));
    cache.set(key, evaluation.candidate);
    if (evaluation.candidate) registry.set(key, evaluation.candidate);
    stats.registryCandidates = registry.size; stats.peakCandidateCacheEntries = Math.max(stats.peakCandidateCacheEntries, cache.size);
    yield* checkpoint(); return evaluation.candidate;
  }
  function pair(left: LayoutSearchCandidate, right: LayoutSearchCandidate): LayoutSearchPairClearance {
    const key = JSON.stringify([left.id, right.id].sort());
    const cached = pairs.get(key);
    if (cached) { stats.pairCacheHits += 1; return cached; }
    stats.pairChecks += 1;
    const value = evaluatePivotPairSeparation({ machine: left.equipment.project.machine, pivotCenter: left.center },
      { machine: right.equipment.project.machine, pivotCenter: right.center }, request);
    const clearance = { leftCandidateId: left.id, rightCandidateId: right.id, ...value,
      clearanceBeyondRequiredMeters: value.centerDistanceMeters - value.minimumRequiredSeparationMeters };
    // FIFO eviction bounds pair memory even when many rejected combinations occur.
    if (pairs.size >= request.budget.maxEvaluations) { pairs.delete(pairs.keys().next().value!); stats.pairCacheEvictions += 1; }
    pairs.set(key, clearance); stats.peakPairCacheEntries = Math.max(stats.peakPairCacheEntries, pairs.size);
    return clearance;
  }
  function allPairs(selected: LayoutSearchCandidate[]) {
    const values: LayoutSearchPairClearance[] = [];
    for (let i = 0; i < selected.length; i += 1) for (let j = i + 1; j < selected.length; j += 1) values.push(pair(selected[i], selected[j]));
    return values;
  }
  function measured(selected: LayoutSearchCandidate[]) {
    if (selected.some(item => item.layout.allowedCoverage.length > 0)) stats.unionCalls += 1;
    return layoutSearchCoverageV2(selected.map(item => item.layout.allowedCoverage), tolerance);
  }
  const hooks: LayoutSearchScalarHooks = {
    tolerance, incumbent: () => incumbent,
    *evaluate(values, currentPhase, partial = false) {
      phase = currentPhase; count("combinations"); stats.combinationAttempts += 1;
      const selected = [...values].sort(candidateOrder);
      const complete = requiredIds.every(id => selected.filter(item => item.equipment.origin === "existing" && item.equipment.id === id).length === 1);
      if (!partial && !complete) {
        rejected.reject("combination", phase, "required_existing_machine_missing_or_duplicated"); yield* checkpoint(); return null;
      }
      const key = JSON.stringify(selected.map(item => item.id));
      let cached = combinations.get(key), coverage: ReturnType<typeof measured> | undefined;
      if (cached) stats.combinationCacheHits += 1;
      else {
        let reason: string | undefined;
        if (selected.length > request.maxMachines) reason = "machine_count_limit";
        else if (new Set(selected.map(item => item.id)).size !== selected.length) reason = "duplicate_candidate";
        else if (selected.some(item => selected.filter(other => other.equipment.key === item.equipment.key).length > item.equipment.maximumCount)) reason = "equipment_count_limit";
        else if (allPairs(selected).some(pair => pair.clearanceBeyondRequiredMeters < 0)) reason = "structural_pair_clearance";
        if (reason) cached = { areaSquareMeters: 0, overlapSquareMeters: 0, reason };
        else { coverage = measured(selected); cached = { areaSquareMeters: coverage.areaSquareMeters, overlapSquareMeters: coverage.overlapSquareMeters }; }
        combinations.set(key, cached); stats.peakCombinationCacheEntries = Math.max(stats.peakCombinationCacheEntries, combinations.size);
      }
      if (cached.reason) { rejected.reject("combination", phase, cached.reason); yield* checkpoint(); return null; }
      const scored: LayoutSearchScalarScore = { selected, areaSquareMeters: cached.areaSquareMeters, overlapSquareMeters: cached.overlapSquareMeters };
      const improves = complete && selected.length > 0 && scored.areaSquareMeters > 0
        && (!incumbent || scored.areaSquareMeters > incumbent.areaSquareMeters + tolerance);
      const improvesGreedy = complete && selected.length > 0 && scored.areaSquareMeters > 0 && phase === "greedy"
        && (!result.greedyBaseline || scored.areaSquareMeters > result.greedyBaseline.irrigatedUnionSquareMeters + tolerance);
      if (improves || improvesGreedy) {
        const scenario = layoutSearchScenario(request, selected, allPairs(selected), coverage ?? measured(selected)); stats.scenariosMaterialized += 1;
        if (improvesGreedy) result.greedyBaseline = scenario;
        if (improves) {
          incumbent = scored; result.best = scenario;
          result.incumbentHistory.push({ evaluation: result.evaluations.total, phase,
            irrigatedUnionSquareMeters: scored.areaSquareMeters, machineCount: selected.length, candidateIds: selected.map(item => item.id).sort() });
        }
        progress(true);
      }
      yield* checkpoint(); return scored;
    },
  };
  const jobs: Calculation<void>[] = [];
  try {
    checkStop(); progress(true);
    if (modelVersion !== LAYOUT_SEARCH_MODEL_VERSION_V2) throw new SearchStop("unsupported_inputs", "unsupported_model_version");
    if (request.field.lateralMachines?.length) throw new SearchStop("unsupported_inputs", "lateral_machine_envelopes_unsupported");
    if (request.expectedRevision !== undefined && request.expectedRevision !== request.fieldRevision) throw new SearchStop("unsupported_inputs", "stale_field_revision");
    const crs = qualifyProjectCrs(request.field.projectCrs, request.crsOptions ?? {});
    if (crs.calculation.blockers.length) {
      crs.calculation.blockers.forEach(reason => rejected.reject("request", request.field.id, reason));
      throw new SearchStop("unsupported_inputs", "crs_not_qualified");
    }
    if (request.field.fieldBoundary.length < 3) throw new SearchStop("unsupported_inputs", "complete_field_boundary_required");
    const prepared = prepareLayoutSearchEquipment(request, rejected.reject);
    if (prepared.unsupportedExisting || !prepared.equipment.length) throw new SearchStop("unsupported_inputs", "equipment_not_supported");
    const equipment = prepared.equipment;
    for (const item of equipment) if (item.price && !layoutSearchPriceMatches(item.price, item.machine)) rejected.reject("price", item.id, "price_does_not_match_exact_configuration_or_currency");
    const pinned: LayoutSearchCandidate[] = [];
    const movable = equipment.filter(item => !item.pinned), required = movable.filter(item => item.origin === "existing");
    for (const item of equipment.filter(value => value.origin === "existing")) {
      const initial = yield* candidate(item, item.machine.pivotCenter);
      if (initial && item.pinned) pinned.push(initial);
      else if (!initial && item.pinned) throw new SearchStop("no_candidate_found", "pinned_machine_is_infeasible");
    }
    if (request.initialIncumbent) {
      const selected: LayoutSearchCandidate[] = [...pinned]; let valid = true;
      for (const item of required) {
        const center = request.initialIncumbent.existingCenters?.find(row => row.machineId === item.id)?.pivotCenter ?? item.machine.pivotCenter;
        const value = yield* candidate(item, center); if (value) selected.push(value); else valid = false;
      }
      for (const row of request.initialIncumbent.existingCenters ?? []) {
        const machine = request.field.machines.find(machine => machine.id === row.machineId)!;
        if (!request.unlockedMachineIds?.includes(row.machineId) && layoutSearchPointKey(row.pivotCenter) !== layoutSearchPointKey(machine.pivotCenter)) {
          valid = false; rejected.reject("machine", row.machineId, "initial_incumbent_moves_pinned_machine");
        }
      }
      for (const row of request.initialIncumbent.optionalMachines ?? []) {
        const item = equipment.find(item => item.origin === "template" && item.id === row.templateId);
        if (!item) { valid = false; continue; }
        const value = yield* candidate(item, row.pivotCenter); if (value) selected.push(value); else valid = false;
      }
      if (valid) yield* hooks.evaluate(selected, "initial"); else rejected.reject("request", request.field.id, "initial_incumbent_rejected");
    }
    const pool = () => [...registry.values()].sort(candidateOrder);
    yield* layoutSearchGreedyV2(pinned, pool(), required, request.maxMachines, hooks, "greedy");
    function* pipeline(snapshot: LayoutSearchCandidate[]): Calculation<void> {
      yield* layoutSearchGreedyV2(pinned, snapshot, required, request.maxMachines, hooks, "greedy");
      yield* layoutSearchMultiStartV2(pinned, snapshot, required, request.maxMachines, hooks);
      yield* layoutSearchExchangesV2(snapshot, hooks);
      if (request.candidateCenters !== undefined) yield* layoutSearchExhaustiveV2(pinned, snapshot, request.maxMachines, hooks);
      for (let level = 0; level < (request.budget.refinementLevels ?? 6); level += 1) {
        const base = hooks.incumbent(); if (!base) break;
        const step = layoutSearchRefinementStep(request, level);
        for (const selected of base.selected) if (!selected.equipment.pinned) for (const direction of LAYOUT_SEARCH_DIRECTIONS) {
          phase = "refinement";
          const value = yield* candidate(selected.equipment, { x: selected.center.x + direction.x * step, y: selected.center.y + direction.y * step });
          if (value) yield* hooks.evaluate(base.selected.map(item => item.id === selected.id ? value : item), "refinement");
        }
        // Use refined positions in complete combinations even after the last base center.
        const refined = pool();
        yield* layoutSearchGreedyV2(pinned, refined, required, request.maxMachines, hooks, "greedy");
        yield* layoutSearchExchangesV2(refined, hooks);
      }
    }
    function* runJobs(limit: number): Calculation<void> {
      let turns = 0;
      while (jobs.length && turns < limit) {
        checkStop(); const job = jobs.shift()!;
        const next = job.next();
        if (!next.done) { jobs.push(job); turns += 1; yield; checkStop(); }
        stats.pendingJobs = jobs.length;
      }
    }
    const source = createLayoutSearchCenterSourceV2(request);
    while (movable.length && result.evaluations.baseCenters < request.budget.maxCandidateCenters) {
      phase = "generation";
      const steps = source.next(checkStop);
      let next = steps.next();
      while (!next.done) { stats.seedProbes = source.probes; yield* checkpoint(); next = steps.next(); }
      stats.seedProbes = source.probes;
      if (!next.value) break;
      result.evaluations.baseCenters += 1;
      for (const item of movable) yield* candidate(item, next.value);
      jobs.push(pipeline(pool())); stats.pendingJobs = jobs.length;
      yield* runJobs(WORK_PER_PREFIX);
      result.evaluations.completedPrefixes += 1;
    }
    // Intrinsic finite source exhaustion is budget independent. A requested
    // prefix limit never triggers extra polishing, preserving nested execution.
    if (source.complete) yield* runJobs(Infinity);
    if (source.probeExhausted) throw new SearchStop("budget_exhausted", "candidate_probe_limit_reached");
    if (movable.length && !source.complete) throw new SearchStop("budget_exhausted", "candidate_center_limit_reached");
    result.termination = result.best ? "completed" : "no_candidate_found";
    result.terminationReason = result.best ? "finite_search_completed" : "no_eligible_combination";
    finished = true;
  } catch (error) {
    finished = true;
    if (error instanceof SearchStop) { result.termination = error.termination; result.terminationReason = error.reason; }
    else { result.termination = "numerical_failure"; result.terminationReason = error instanceof Error ? error.message : "calculation_failed"; }
    rejected.reject("request", request.field.id, result.terminationReason);
  } finally {
    if (!finished) { result.termination = "cancelled"; result.terminationReason = "cancelled_by_scheduler"; finished = true; }
    stats.pendingJobs = jobs.length; jobs.length = 0;
    result.rejected = rejected.rows(); phase = "finished"; progress(true);
    return result;
  }
}
