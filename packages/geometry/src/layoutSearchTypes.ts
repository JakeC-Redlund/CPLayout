import type { CrsQualificationOptions, FieldDesign, FieldPivotMachine, MultiPolygonXY, PivotMachine, XY } from "@cplayout/core";

export const LAYOUT_SEARCH_REQUEST_VERSION = "layout-search-request-v1";
export const LAYOUT_SEARCH_RESULT_VERSION = "layout-search-result-v1";
export const LAYOUT_SEARCH_MODEL_VERSION = "standard-pivot-search-v1";
export const LAYOUT_SEARCH_LIMITS = Object.freeze({ templates: 4, machines: 8, candidateCenters: 128, evaluations: 25000, refinementLevels: 6 });

export interface LayoutSearchPrice {
  /** A price for this exact configuration; top-level equipment identity may differ. */
  machine: PivotMachine;
  amount: number;
  currencyCode: string;
}
export interface LayoutSearchTemplate {
  id: string;
  machine: PivotMachine;
  maximumCount: number;
  waterSourceId?: string;
  powerSourceId?: string;
  sourceFeatureIds?: string[];
  price?: LayoutSearchPrice;
}
export interface LayoutSearchBudget {
  /** Number of nested base-center prefixes. Refinement probes consume evaluations separately. */
  maxCandidateCenters: number;
  /** Candidate geometry and complete combination evaluations share this hard ceiling. */
  maxEvaluations: number;
  /** Fixed by a comparison experiment; changing this changes the search schedule. Default 3. */
  refinementLevels?: number;
}
export interface LayoutSearchRequest {
  schemaVersion: typeof LAYOUT_SEARCH_REQUEST_VERSION;
  modelVersion: typeof LAYOUT_SEARCH_MODEL_VERSION;
  field: FieldDesign;
  fieldRevision: number;
  expectedRevision?: number;
  crsOptions?: CrsQualificationOptions;
  templates?: LayoutSearchTemplate[];
  unlockedMachineIds?: string[];
  existingMachinePrices?: { machineId: string; price: LayoutSearchPrice }[];
  maxMachines: number;
  budget: LayoutSearchBudget;
  /** Explicit finite candidate set, sorted by XY for order-independent experiments. Replaces generated base centers. */
  candidateCenters?: XY[];
  /** Optional known/legacy scenario, fully revalidated before use. No feasibility is trusted from the caller. */
  initialIncumbent?: { existingCenters?: { machineId: string; pivotCenter: XY }[];
    optionalMachines?: { templateId: string; pivotCenter: XY }[] };
  collisionBufferMeters?: number;
  minimumMachineSeparationMeters?: number;
  boundaryEpsilonSquareMeters?: number;
}
export interface LayoutSearchControl { isCancelled?: () => boolean }
export type LayoutSearchTermination = "completed" | "budget_exhausted" | "cancelled" | "no_candidate_found" | "unsupported_inputs" | "numerical_failure";
export type LayoutSearchPhase = "initial" | "greedy" | "multi_start" | "exchange_one" | "exchange_two" | "refinement" | "exhaustive";
export interface LayoutSearchRejection { scope: "request" | "machine" | "template" | "candidate" | "combination" | "price";
  id: string; reason: string; occurrences: number }
export interface LayoutSearchSelectedMachine {
  candidateId: string;
  source: { kind: "existing" | "template"; id: string };
  machine: FieldPivotMachine;
  pinned: boolean;
}
export interface LayoutSearchPairClearance {
  leftCandidateId: string; rightCandidateId: string;
  centerDistanceMeters: number; minimumRequiredSeparationMeters: number; pairBufferMeters: number;
  clearanceBeyondRequiredMeters: number;
}
export interface LayoutSearchScenario {
  machines: LayoutSearchSelectedMachine[];
  modeledCoverageUnion: MultiPolygonXY;
  irrigatedUnionSquareMeters: number;
  irrigatedUnionAcres: number;
  overlapSquareMeters: number;
  machineCount: number;
  minimumPairClearanceMeters: number | null;
  pairClearances: LayoutSearchPairClearance[];
  cost: { amount: number | null; currencyCode: string | null; costPerIrrigatedAcre: number | null };
}
export interface LayoutSearchResult {
  schemaVersion: typeof LAYOUT_SEARCH_RESULT_VERSION;
  requestKey: { fieldId: string; fieldRevision: number; modelVersion: string };
  projectCrs: string;
  budget: LayoutSearchBudget;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  claim: "best_found";
  objective: "maximum_eligible_coverage_union";
  termination: LayoutSearchTermination;
  best: LayoutSearchScenario | null;
  /** Best corrected greedy result evaluated by this run, using its own candidate prefixes. */
  greedyBaseline: LayoutSearchScenario | null;
  evaluations: { total: number; candidates: number; combinations: number; baseCenters: number; completedPrefixes: number };
  incumbentHistory: { evaluation: number; phase: LayoutSearchPhase; irrigatedUnionSquareMeters: number; machineCount: number; candidateIds: string[] }[];
  rejected: LayoutSearchRejection[];
  warnings: string[];
}

/** V2 changes scheduling and numerical comparison, independently of the field document. */
export const LAYOUT_SEARCH_REQUEST_VERSION_V2 = "layout-search-request-v2";
export const LAYOUT_SEARCH_RESULT_VERSION_V2 = "layout-search-result-v2";
export const LAYOUT_SEARCH_MODEL_VERSION_V2 = "standard-pivot-search-v2";
export const LAYOUT_SEARCH_DEEP_BUDGET: Readonly<Required<LayoutSearchBudget>> = Object.freeze({
  maxCandidateCenters: 128, maxEvaluations: 25000, refinementLevels: 6,
});
export interface LayoutSearchRequestV2 extends Omit<LayoutSearchRequest, "schemaVersion" | "modelVersion"> {
  schemaVersion: typeof LAYOUT_SEARCH_REQUEST_VERSION_V2;
  modelVersion: typeof LAYOUT_SEARCH_MODEL_VERSION_V2;
}
export interface LayoutSearchDiagnosticsV2 {
  seedProbes: number;
  candidateAttempts: number;
  candidateCacheHits: number;
  combinationAttempts: number;
  combinationCacheHits: number;
  pairChecks: number;
  pairCacheHits: number;
  pairCacheEvictions: number;
  unionCalls: number;
  scenariosMaterialized: number;
  registryCandidates: number;
  pendingJobs: number;
  workSteps: number;
  peakCandidateCacheEntries: number;
  peakCombinationCacheEntries: number;
  peakPairCacheEntries: number;
}
export interface LayoutSearchResultV2 extends Omit<LayoutSearchResult, "schemaVersion"> {
  schemaVersion: typeof LAYOUT_SEARCH_RESULT_VERSION_V2;
  diagnostics: LayoutSearchDiagnosticsV2;
  terminationReason: string;
  /** Area comparison guard based on local extent and absolute-coordinate floating precision. Not a certified error bound. */
  comparisonToleranceSquareMeters: number;
}
export interface LayoutSearchProgressV2 {
  phase: LayoutSearchPhase | "generation" | "finished";
  best: LayoutSearchScenario | null;
  greedyBaseline: LayoutSearchScenario | null;
  evaluations: LayoutSearchResult["evaluations"];
  diagnostics: LayoutSearchDiagnosticsV2;
  termination: LayoutSearchTermination | null;
}
export interface LayoutSearchControlV2 extends LayoutSearchControl {
  /** Detached snapshots. Observers cannot mutate search state. */
  onProgress?: (progress: LayoutSearchProgressV2) => void;
}
