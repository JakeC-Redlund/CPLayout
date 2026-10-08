import { assertNoStrippedFields, FieldCalculationCrsOptionsSchema, PivotProjectSchema, qualifyProjectCrs,
  snapshotJsonValue, validateFieldDesign, type XY } from "@cplayout/core";
import { completeCalculation, type Calculation } from "./calculation";
import { LAYOUT_SEARCH_DIRECTIONS, layoutSearchCandidateCenterSteps, layoutSearchPointKey, layoutSearchRefinementStep } from "./layoutSearchCandidates";
import { layoutSearchExchanges, layoutSearchExhaustive, layoutSearchGreedy, layoutSearchMultiStart, type LayoutSearchCombinationHooks,
  type LayoutSearchScored } from "./layoutSearchCombinations";
import { layoutSearchPriceMatches, layoutSearchRejectionRecorder, layoutSearchScenario } from "./layoutSearchDiagnostics";
import { evaluateLayoutSearchCandidate, layoutSearchCombinationFeasibility, prepareLayoutSearchEquipment,
  type LayoutSearchCandidate, type LayoutSearchEquipment } from "./layoutSearchFeasibility";
import { LAYOUT_SEARCH_LIMITS, LAYOUT_SEARCH_MODEL_VERSION, LAYOUT_SEARCH_REQUEST_VERSION, LAYOUT_SEARCH_RESULT_VERSION,
  type LayoutSearchControl, type LayoutSearchPhase, type LayoutSearchRequest, type LayoutSearchResult, type LayoutSearchTermination } from "./layoutSearchTypes";
export * from "./layoutSearchTypes";

/** Captures caller data now, before the first cooperative next()/scheduler yield. */
export function searchFieldLayoutSteps(request: LayoutSearchRequest, control: LayoutSearchControl = {}): Calculation<LayoutSearchResult> {
  const owned = snapshotJsonValue(request, "layout search") as LayoutSearchRequest;
  validateLayoutSearchRequest(owned);
  return searchOwned(owned, control);
}
export function searchFieldLayout(request: LayoutSearchRequest, control: LayoutSearchControl = {}): LayoutSearchResult {
  return completeCalculation(searchFieldLayoutSteps(request, control));
}
/** A delayed result is advisory only; adoption needs the editor's own atomic revision check. */
export function layoutSearchResultMatches(result: Pick<LayoutSearchResult, "requestKey">, current: { fieldId: string; fieldRevision: number; modelVersion: string }): boolean {
  return Number.isSafeInteger(current.fieldRevision) && current.fieldRevision >= 0
    && result.requestKey.fieldId === current.fieldId && result.requestKey.fieldRevision === current.fieldRevision
    && result.requestKey.modelVersion === current.modelVersion;
}
class SearchStop { constructor(readonly termination: LayoutSearchTermination) {} }

function* searchOwned(request: LayoutSearchRequest, control: LayoutSearchControl): Calculation<LayoutSearchResult> {
  const diagnostics = layoutSearchRejectionRecorder();
  const result: LayoutSearchResult = {
    schemaVersion: LAYOUT_SEARCH_RESULT_VERSION,
    requestKey: { fieldId: request.field.id, fieldRevision: request.fieldRevision, modelVersion: request.modelVersion },
    projectCrs: request.field.projectCrs, budget: request.budget, advisoryOnly: true, canonicalGeometryMutation: false,
    claim: "best_found", objective: "maximum_eligible_coverage_union", termination: "no_candidate_found",
    best: null, greedyBaseline: null, evaluations: { total: 0, candidates: 0, combinations: 0, baseCenters: 0, completedPrefixes: 0 },
    incumbentHistory: [], rejected: [], warnings: [
      "Advisory sampled standard-pivot search; global optimality, hydraulics, terrain, controls and field accuracy are unverified.",
      "Structural pair checks use full reach circles and one maximum gap, including partial sweeps; this is conservative.",
      "Coverage is a polygon approximation. Hard admission uses conservative wet-boundary and mechanical checks; no-spray areas are removed from net coverage.",
      "Saved machines are mandatory; only explicitly unlocked centers can move. No machine is adopted or saved by calculation.",
      "Costs cover exact supplied machine prices only; missing or mismatched prices leave aggregate cost unavailable.",
      "Greedy baseline uses this run's candidate prefixes. Legacy results require an explicitly supplied, revalidated initialIncumbent for direct retention.",
    ],
  };
  let incumbent: LayoutSearchScored | null = null;
  const requiredIds = request.field.machines.map(machine => machine.id);
  const cache = new Map<string, LayoutSearchCandidate | null>();
  const checkStop = () => { if (control.isCancelled?.()) throw new SearchStop("cancelled"); };
  const count = (kind: "candidates" | "combinations") => {
    checkStop();
    if (result.evaluations.total >= request.budget.maxEvaluations) throw new SearchStop("budget_exhausted");
    result.evaluations.total += 1; result.evaluations[kind] += 1;
  };
  function* candidate(equipment: LayoutSearchEquipment, center: XY): Calculation<LayoutSearchCandidate | null> {
    checkStop();
    const key = JSON.stringify([equipment.key, layoutSearchPointKey(center)]);
    if (cache.has(key)) { yield; checkStop(); return cache.get(key)!; }
    count("candidates");
    const evaluation = evaluateLayoutSearchCandidate(request, equipment, center);
    evaluation.reasons.forEach(reason => diagnostics.reject("candidate", equipment.id, reason));
    cache.set(key, evaluation.candidate);
    yield; checkStop();
    return evaluation.candidate;
  }
  const hooks: LayoutSearchCombinationHooks = {
    incumbent: () => incumbent,
    *evaluate(selected, phase, partial = false) {
      count("combinations");
      const feasible = layoutSearchCombinationFeasibility(request, selected, partial ? [] : requiredIds);
      let scored: LayoutSearchScored | null = null;
      if (!feasible.feasible) diagnostics.reject("combination", phase, feasible.reason!);
      else {
        scored = { selected: [...selected], scenario: layoutSearchScenario(request, selected, feasible.pairs) };
        const complete = requiredIds.every(id => selected.some(item => item.equipment.origin === "existing" && item.equipment.id === id));
        if (complete && selected.length > 0 && scored.scenario.irrigatedUnionSquareMeters > 0) {
          if (phase === "greedy" && (!result.greedyBaseline || scored.scenario.irrigatedUnionSquareMeters > result.greedyBaseline.irrigatedUnionSquareMeters)) result.greedyBaseline = scored.scenario;
          if (!incumbent || scored.scenario.irrigatedUnionSquareMeters > incumbent.scenario.irrigatedUnionSquareMeters) {
            incumbent = scored;
            result.best = scored.scenario;
            result.incumbentHistory.push({ evaluation: result.evaluations.total, phase,
              irrigatedUnionSquareMeters: scored.scenario.irrigatedUnionSquareMeters, machineCount: selected.length,
              candidateIds: selected.map(item => item.id).sort() });
          }
        }
      }
      yield; checkStop();
      return scored;
    },
  };
  let finished = false;
  try {
    checkStop();
    if ("lateralMachines" in request.field && Array.isArray(request.field.lateralMachines) && request.field.lateralMachines.length > 0) {
      diagnostics.reject("request", request.field.id, "lateral_machine_envelopes_unsupported");
      throw new SearchStop("unsupported_inputs");
    }
    if (request.expectedRevision !== undefined && request.expectedRevision !== request.fieldRevision) {
      diagnostics.reject("request", request.field.id, "stale_field_revision");
      throw new SearchStop("unsupported_inputs");
    }
    if (request.modelVersion !== LAYOUT_SEARCH_MODEL_VERSION) {
      diagnostics.reject("request", request.field.id, "unsupported_model_version");
      throw new SearchStop("unsupported_inputs");
    }
    const crs = qualifyProjectCrs(request.field.projectCrs, request.crsOptions ?? {});
    if (crs.calculation.blockers.length) {
      crs.calculation.blockers.forEach(reason => diagnostics.reject("request", request.field.id, reason));
      throw new SearchStop("unsupported_inputs");
    }
    if (request.field.fieldBoundary.length < 3) {
      diagnostics.reject("request", request.field.id, "complete_field_boundary_required");
      throw new SearchStop("unsupported_inputs");
    }
    const prepared = prepareLayoutSearchEquipment(request, diagnostics.reject);
    if (prepared.unsupportedExisting || prepared.equipment.length === 0) throw new SearchStop("unsupported_inputs");
    const equipment = prepared.equipment;
    for (const item of equipment) if (item.price && !layoutSearchPriceMatches(item.price, item.machine)) diagnostics.reject("price", item.id, "price_does_not_match_exact_configuration_or_currency");
    const pinned: LayoutSearchCandidate[] = [], pool: LayoutSearchCandidate[] = [];
    const movable = equipment.filter(item => !item.pinned);
    const required = movable.filter(item => item.origin === "existing");
    for (const item of equipment.filter(value => value.origin === "existing")) {
      const initial = yield* candidate(item, item.machine.pivotCenter);
      if (initial) { pool.push(initial); if (item.pinned) pinned.push(initial); }
      else if (item.pinned) {
        diagnostics.reject("machine", item.id, "pinned_machine_is_infeasible");
        throw new SearchStop("no_candidate_found");
      }
    }
    // Optional prior baseline: identity, configuration, pinned centers, counts,
    // boundary, obstacles, supply associations and all pairs are rechecked.
    if (request.initialIncumbent) {
      const initial: LayoutSearchCandidate[] = [...pinned];
      let valid = true;
      for (const equipment of required) {
        const center = request.initialIncumbent.existingCenters?.find(row => row.machineId === equipment.id)?.pivotCenter ?? equipment.machine.pivotCenter;
        const value = yield* candidate(equipment, center);
        if (value) initial.push(value); else valid = false;
      }
      for (const row of request.initialIncumbent.existingCenters ?? []) {
        const machine = request.field.machines.find(machine => machine.id === row.machineId)!;
        if (!request.unlockedMachineIds?.includes(row.machineId) && layoutSearchPointKey(row.pivotCenter) !== layoutSearchPointKey(machine.pivotCenter)) {
          diagnostics.reject("machine", row.machineId, "initial_incumbent_moves_pinned_machine"); valid = false;
        }
      }
      for (const row of request.initialIncumbent.optionalMachines ?? []) {
        const item = equipment.find(item => item.origin === "template" && item.id === row.templateId);
        if (!item) { valid = false; continue; }
        const value = yield* candidate(item, row.pivotCenter);
        if (value) initial.push(value); else valid = false;
      }
      if (valid) yield* hooks.evaluate(initial, "initial");
      else diagnostics.reject("request", request.field.id, "initial_incumbent_rejected");
    }
    // Existing-only requests still get a complete baseline and retain exact centers.
    yield* layoutSearchGreedy(pinned, pool, required, request.maxMachines, hooks, "greedy");
    const generated = movable.length ? yield* layoutSearchCandidateCenterSteps(request, checkStop) : { centers: [], exhausted: false };
    const availableCenters = generated.centers;
    if (generated.exhausted) diagnostics.reject("request", request.field.id, "candidate_probe_limit_reached");
    const centers = availableCenters.slice(0, request.budget.maxCandidateCenters);
    for (const center of centers) {
      result.evaluations.baseCenters += 1;
      for (const item of movable) {
        const value = yield* candidate(item, center);
        if (value && !pool.some(prior => prior.id === value.id)) pool.push(value);
      }
      // A whole earlier prefix (including its refinement) finishes before the
      // next center is admitted. Neither budget ceiling affects choices/order.
      yield* layoutSearchGreedy(pinned, pool, required, request.maxMachines, hooks, "greedy");
      yield* layoutSearchMultiStart(pinned, pool, required, request.maxMachines, hooks);
      yield* layoutSearchExchanges(pool, hooks);
      // Exhaustive comparison is restricted to explicitly supplied tiny sets;
      // generated searches spend their budget on subsequent spatial prefixes.
      if (request.candidateCenters !== undefined) yield* layoutSearchExhaustive(pinned, pool, request.maxMachines, hooks);
      for (let level = 0; level < (request.budget.refinementLevels ?? 3); level += 1) {
        const base = hooks.incumbent();
        if (!base) break;
        const step = layoutSearchRefinementStep(request, level);
        for (const selected of base.selected) {
          if (selected.equipment.pinned) continue;
          for (const direction of LAYOUT_SEARCH_DIRECTIONS) {
            const value = yield* candidate(selected.equipment, { x: selected.center.x + direction.x * step, y: selected.center.y + direction.y * step });
            if (value) yield* hooks.evaluate(base.selected.map(item => item.id === selected.id ? value : item), "refinement");
          }
        }
      }
      result.evaluations.completedPrefixes += 1;
    }
    const candidateBudgetExhausted = generated.exhausted || (movable.length > 0 && centers.length === request.budget.maxCandidateCenters
      && (request.candidateCenters === undefined || availableCenters.length > centers.length));
    result.termination = candidateBudgetExhausted ? "budget_exhausted" : result.best ? "completed" : "no_candidate_found";
    finished = true;
  } catch (error) {
    finished = true;
    if (error instanceof SearchStop) result.termination = error.termination;
    else {
      result.termination = "numerical_failure";
      diagnostics.reject("request", request.field.id, error instanceof Error ? error.message : "calculation_failed");
    }
  } finally {
    // Scheduler return() after a yield also returns an explicit cancellation
    // result instead of silently turning partial work into completion.
    if (!finished) result.termination = "cancelled";
    result.rejected = diagnostics.rows();
    return result;
  }
}

export function validateLayoutSearchRequest(request: LayoutSearchRequest): void {
  exactKeys(request, ["schemaVersion", "modelVersion", "field", "fieldRevision", "expectedRevision", "crsOptions", "templates", "unlockedMachineIds", "existingMachinePrices", "maxMachines", "budget", "candidateCenters", "initialIncumbent", "collisionBufferMeters", "minimumMachineSeparationMeters", "boundaryEpsilonSquareMeters"]);
  if (request.schemaVersion !== LAYOUT_SEARCH_REQUEST_VERSION) throw new Error("Unsupported layout search request version.");
  if (typeof request.modelVersion !== "string" || !request.modelVersion) throw new Error("Explicit modelVersion is required.");
  request.field = validateFieldDesign(request.field);
  integer(request.fieldRevision, 0, Number.MAX_SAFE_INTEGER, "fieldRevision");
  if (request.expectedRevision !== undefined) integer(request.expectedRevision, 0, Number.MAX_SAFE_INTEGER, "expectedRevision");
  integer(request.maxMachines, 1, LAYOUT_SEARCH_LIMITS.machines, "maxMachines");
  if (request.field.machines.length > request.maxMachines) throw new Error("maxMachines cannot discard existing machines.");
  exactKeys(request.budget, ["maxCandidateCenters", "maxEvaluations", "refinementLevels"]);
  integer(request.budget.maxCandidateCenters, 1, LAYOUT_SEARCH_LIMITS.candidateCenters, "maxCandidateCenters");
  integer(request.budget.maxEvaluations, 1, LAYOUT_SEARCH_LIMITS.evaluations, "maxEvaluations");
  if (request.budget.refinementLevels !== undefined) integer(request.budget.refinementLevels, 0, LAYOUT_SEARCH_LIMITS.refinementLevels, "refinementLevels");
  if (request.crsOptions) FieldCalculationCrsOptionsSchema.parse(request.crsOptions);
  for (const key of ["collisionBufferMeters", "minimumMachineSeparationMeters", "boundaryEpsilonSquareMeters"] as const) {
    if (request[key] !== undefined && (!Number.isFinite(request[key]) || request[key]! < 0)) throw new Error(`${key} must be finite and nonnegative.`);
  }
  const templates = request.templates ?? [];
  if (!Array.isArray(templates) || templates.length > LAYOUT_SEARCH_LIMITS.templates) throw new Error("At most four exact optional templates are supported.");
  distinct(templates.map(template => template.id), "template IDs");
  for (const template of templates) {
    exactKeys(template, ["id", "machine", "maximumCount", "waterSourceId", "powerSourceId", "sourceFeatureIds", "price"]);
    const parsed = PivotProjectSchema.shape.machine.parse(template.machine);
    assertNoStrippedFields(template.machine, parsed);
    integer(template.maximumCount, 1, LAYOUT_SEARCH_LIMITS.machines, "maximumCount");
    for (const [key, kind] of [["waterSourceId", "water_source"], ["powerSourceId", "power_source"]] as const) {
      if (template[key] !== undefined && !request.field.infrastructure.some(item => item.id === template[key] && item.kind === kind)) throw new Error(`Template ${template.id}: ${key} must reference the correct infrastructure kind.`);
    }
    if (template.sourceFeatureIds) {
      distinct(template.sourceFeatureIds, "source feature IDs");
      if (template.sourceFeatureIds.some(id => !request.field.mapFeatures?.some(feature => feature.id === id))) throw new Error("Template source feature references must resolve.");
    }
    if (template.price) validatePrice(template.price);
  }
  distinct(request.unlockedMachineIds ?? [], "unlocked machine IDs");
  const existing = new Set(request.field.machines.map(machine => machine.id));
  if (request.unlockedMachineIds?.some(id => !existing.has(id))) throw new Error("Unlocked machine ID was not found in the field.");
  distinct((request.existingMachinePrices ?? []).map(value => value.machineId), "existing machine price IDs");
  for (const row of request.existingMachinePrices ?? []) {
    exactKeys(row, ["machineId", "price"]);
    if (!existing.has(row.machineId)) throw new Error("Price machine ID was not found in the field.");
    validatePrice(row.price);
  }
  if (request.candidateCenters) {
    if (!Array.isArray(request.candidateCenters) || request.candidateCenters.length > LAYOUT_SEARCH_LIMITS.candidateCenters) throw new Error("Too many explicit candidate centers.");
    request.candidateCenters.forEach(validatePoint);
  }
  if (request.initialIncumbent) {
    exactKeys(request.initialIncumbent, ["existingCenters", "optionalMachines"]);
    distinct((request.initialIncumbent.existingCenters ?? []).map(row => row.machineId), "initial machine IDs");
    for (const row of request.initialIncumbent.existingCenters ?? []) {
      exactKeys(row, ["machineId", "pivotCenter"]); validatePoint(row.pivotCenter);
      if (!existing.has(row.machineId)) throw new Error("Initial existing machine ID was not found in the field.");
    }
    if ((request.initialIncumbent.optionalMachines?.length ?? 0) > LAYOUT_SEARCH_LIMITS.machines) throw new Error("Initial incumbent exceeds eight optional machines.");
    for (const row of request.initialIncumbent.optionalMachines ?? []) {
      exactKeys(row, ["templateId", "pivotCenter"]); validatePoint(row.pivotCenter);
      if (!templates.some(template => template.id === row.templateId)) throw new Error("Initial template ID was not found in the request.");
    }
  }
  request.field.machines.sort((a, b) => compare(a.id, b.id));
  templates.sort((a, b) => compare(a.id, b.id));
}
function validatePrice(price: NonNullable<LayoutSearchRequest["templates"]>[number]["price"] & {}): void {
  exactKeys(price, ["machine", "amount", "currencyCode"]);
  const parsed = PivotProjectSchema.shape.machine.parse(price.machine); assertNoStrippedFields(price.machine, parsed);
  if (!Number.isFinite(price.amount) || price.amount < 0 || typeof price.currencyCode !== "string") throw new Error("Price must contain an explicit finite nonnegative amount and currency.");
}
function compare(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
function exactKeys(value: object, allowed: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Unsupported layout search data.");
}
function distinct(values: string[], name: string) {
  if (values.some(value => typeof value !== "string" || !value.trim()) || new Set(values).size !== values.length) throw new Error(`${name} must be nonempty and distinct.`);
}
function integer(value: number, min: number, max: number, name: string) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
}
function validatePoint(point: XY) {
  exactKeys(point, ["x", "y"]);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("Candidate center must be finite XY.");
}

export { searchFieldLayoutV2, searchFieldLayoutV2Steps } from "./layoutSearchV2";
