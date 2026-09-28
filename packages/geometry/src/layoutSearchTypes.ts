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
