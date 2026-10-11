/** Run with: npx tsx packages/geometry/src/layoutSearch.benchmark.ts
 * Observations are local source-runtime evidence, never browser/device/field proof.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { convertPivotProjectToFieldDesign, willRheaJasonHarmelinkExampleProject } from "@cplayout/core";
import { planAdvisoryPivotTemplates } from "./advisoryPivotPlacement";
import { performance } from "node:perf_hooks";
import type { FieldDesign, PivotMachine, XY } from "@cplayout/core";
import { searchFieldLayout, searchFieldLayoutSteps, LAYOUT_SEARCH_MODEL_VERSION, LAYOUT_SEARCH_REQUEST_VERSION,
  searchFieldLayoutV2, searchFieldLayoutV2Steps, LAYOUT_SEARCH_REQUEST_VERSION_V2, LAYOUT_SEARCH_MODEL_VERSION_V2,
  type LayoutSearchRequest, type LayoutSearchRequestV2, type LayoutSearchResult, type LayoutSearchResultV2 } from "./layoutSearch";

function fixture(width: number, height: number, radii: number[], centers?: XY[]): LayoutSearchRequest {
  const field: FieldDesign = { id: "benchmark", name: "Synthetic benchmark", projectCrs: "EPSG:32613", unitSystem: "metric",
    fieldBoundary: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
    infrastructure: [{ id: "water", kind: "water_source", point: { x: 0, y: 0 } }, { id: "power", kind: "power_source", point: { x: 0, y: 0 } }],
    machines: [], obstacles: [], surveyPoints: [] };
  return { schemaVersion: LAYOUT_SEARCH_REQUEST_VERSION, modelVersion: LAYOUT_SEARCH_MODEL_VERSION,
    field, fieldRevision: 0, maxMachines: 8, budget: { maxCandidateCenters: 24, maxEvaluations: 1500, refinementLevels: 3 },
    ...(centers ? { candidateCenters: centers } : {}),
    templates: radii.map((radius, index) => {
      const machine: PivotMachine = { id: `machine-${index}`, name: `Exact synthetic radius ${radius}`,
        spanLengthsMeters: [radius * .4, radius * .6], overhangMeters: 0, endGunThrowMeters: 0,
        towerClearanceBufferMeters: 0, machineClearanceBufferMeters: 0, sweep: { mode: "full_circle" } };
      return { id: `template-${index}`, machine, maximumCount: 8, waterSourceId: "water", powerSourceId: "power" };
    }) };
}
function summary(result: LayoutSearchResult | LayoutSearchResultV2) {
  return { termination: result.termination, evaluations: result.evaluations, machines: result.best?.machineCount ?? 0,
    bestSquareMeters: result.best?.irrigatedUnionSquareMeters ?? 0,
    greedySquareMeters: result.greedyBaseline?.irrigatedUnionSquareMeters ?? 0,
    improvementSquareMeters: (result.best?.irrigatedUnionSquareMeters ?? 0) - (result.greedyBaseline?.irrigatedUnionSquareMeters ?? 0),
    rejectedReasons: [...new Set(result.rejected.map(row => row.reason))] };
}
const trap = fixture(110, 70, [31, 23], [{ x: 25, y: 35 }, { x: 55, y: 35 }, { x: 85, y: 35 }]);
trap.maxMachines = 2; trap.templates![0].maximumCount = 1; trap.templates![1].maximumCount = 2;
trap.budget = { maxCandidateCenters: 3, maxEvaluations: 3000, refinementLevels: 0 };
const bounded = fixture(1000, 800, [120, 90, 70, 50]);
const originalWillRhea = JSON.stringify(willRheaJasonHarmelinkExampleProject);
const willRhea = convertPivotProjectToFieldDesign(originalWillRhea, { fieldId: "will-rhea-search-comparison",
  waterSourceId: "source-water", powerSourceId: "source-power" }).field;
const originalWillRequest: LayoutSearchRequest = { ...bounded, field: willRhea, templates: [], maxMachines: 3,
  budget: { maxCandidateCenters: 8, maxEvaluations: 500, refinementLevels: 1 } };
const legacyStart = performance.now();
const legacyWill = planAdvisoryPivotTemplates(willRheaJasonHarmelinkExampleProject,
  [{ id: "retained-source-radius-template", machine: willRheaJasonHarmelinkExampleProject.machine, maximumCount: 3 }],
  { maxMachines: 3, gridDivisions: 3, candidatePoolSize: 6, maxCandidates: 6,
    includeMaximumInscribedCircleSeed: false, includeMachineZoneReviews: false });
const legacyWillRuntimeMs = performance.now() - legacyStart;
const hypotheticalWillRequest: LayoutSearchRequest = { ...originalWillRequest,
  field: { ...willRhea, machines: [] },
  templates: [{ id: "retained-source-radius-template", machine: willRheaJasonHarmelinkExampleProject.machine,
    maximumCount: 3, waterSourceId: "source-water", powerSourceId: "source-power" }],
  initialIncumbent: { optionalMachines: legacyWill.candidates.map(row => ({ templateId: row.templateId, pivotCenter: row.pivotCenter })) } };
const legacyRetentionRequest = fixture(240, 160, [20], [{ x: 30, y: 80 }]);
legacyRetentionRequest.maxMachines = 2;
const retainedLegacy = planAdvisoryPivotTemplates({ id: "synthetic-legacy", name: "Synthetic baseline retention",
  projectCrs: legacyRetentionRequest.field.projectCrs, unitSystem: "metric", fieldBoundary: legacyRetentionRequest.field.fieldBoundary,
  pivotCenter: { x: 60, y: 80 }, waterSource: { x: 0, y: 0 }, powerSource: { x: 0, y: 0 },
  machine: legacyRetentionRequest.templates![0].machine, obstacles: [], surveyPoints: [], mapFeatures: [] },
  legacyRetentionRequest.templates!.map(({ id, machine, maximumCount }) => ({ id, machine, maximumCount })),
  { maxMachines: 2, gridDivisions: 3, candidatePoolSize: 4, maxCandidates: 4,
    includeMaximumInscribedCircleSeed: false, includeMachineZoneReviews: false });
legacyRetentionRequest.initialIncumbent = { optionalMachines: retainedLegacy.candidates.map(row => ({ templateId: row.templateId, pivotCenter: row.pivotCenter })) };
const retainedLegacyResult = searchFieldLayout(legacyRetentionRequest);
assert(retainedLegacyResult.best && retainedLegacyResult.best.irrigatedUnionAcres >= retainedLegacy.modeledIrrigatedUnionAcres);
const legacyRetention = { legacyUnionAcres: retainedLegacy.modeledIrrigatedUnionAcres,
  retainedBestUnionAcres: retainedLegacyResult.best.irrigatedUnionAcres, initialIncumbentAccepted: retainedLegacyResult.incumbentHistory[0]?.phase === "initial" };
const toV2 = (input: LayoutSearchRequest): LayoutSearchRequestV2 => ({ ...input, schemaVersion: LAYOUT_SEARCH_REQUEST_VERSION_V2, modelVersion: LAYOUT_SEARCH_MODEL_VERSION_V2 });
const fixtureNames = ["greedy_trap", "four_templates_eight_machines_bounded", "will_rhea_original_pinned", "will_rhea_hypothetical_optional_exact_source_template"];
const reports = [trap, bounded, originalWillRequest, hypotheticalWillRequest].map((input, index) => {
  const before = process.memoryUsage();
  const start = performance.now();
  const result = searchFieldLayout(input);
  const runtimeMs = performance.now() - start;
  const after = process.memoryUsage();
  return { fixture: fixtureNames[index], runtimeMs,
    heapUsedBeforeBytes: before.heapUsed, heapUsedAfterBytes: after.heapUsed, heapDeltaBytes: after.heapUsed - before.heapUsed,
    rssAfterBytes: after.rss, processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
    ...summary(result) };
});
assert.equal(JSON.stringify(willRheaJasonHarmelinkExampleProject), originalWillRhea, "Original source fixture must remain exact.");
const willRheaComparison = { sourceSha256: createHash("sha256").update(originalWillRhea).digest("hex"), sourceUnchanged: true,
  legacyRuntimeMs: legacyWillRuntimeMs, legacyGreedyUnionAcres: legacyWill.modeledIrrigatedUnionAcres,
  retainedLegacyInitialIncumbent: legacyWill.candidates.length > 0,
  limitation: "Original geometry is retained. Optional copies are hypothetical uses of the supplied radius template, not verified installed equipment or a field design." };
const v2Reports = [trap, bounded, originalWillRequest, hypotheticalWillRequest].map((input, index) => {
  const trials = Array.from({ length: 5 }, () => {
    const before = process.memoryUsage(), start = performance.now();
    const result = searchFieldLayoutV2(toV2(input));
    const runtimeMs = performance.now() - start, after = process.memoryUsage();
    return { result, runtimeMs, heapDeltaBytes: after.heapUsed - before.heapUsed, rssAfterBytes: after.rss };
  });
  const times = trials.map(row => row.runtimeMs).sort((a, b) => a - b);
  const result = trials[0].result;
  for (const trial of trials.slice(1)) assert.deepEqual(trial.result, result, "Repeated v2 outcomes must match exactly.");
  return { fixture: fixtureNames[index], runtimeMedianMs: times[2], runtimeP95Ms: times[4],
    trials: trials.map(({ result: _result, ...observation }) => observation),
    ...summary(result), diagnostics: result.diagnostics, terminationReason: result.terminationReason,
    comparisonToleranceSquareMeters: result.comparisonToleranceSquareMeters,
    differenceFromV1SquareMeters: (result.best?.irrigatedUnionSquareMeters ?? 0) - reports[index].bestSquareMeters };
});
assert(v2Reports[1].evaluations.baseCenters >= 8);
assert(v2Reports[1].differenceFromV1SquareMeters >= -v2Reports[1].comparisonToleranceSquareMeters);
// A direct retained-result comparison is explicit and charged to the V2 budget.
const deepInput = toV2({ ...bounded, budget: { maxCandidateCenters: 128, maxEvaluations: 25000, refinementLevels: 6 } });
const deepBefore = process.memoryUsage(), deepStart = performance.now();
const deepResult = searchFieldLayoutV2(deepInput);
const deepRuntimeMs = performance.now() - deepStart, deepAfter = process.memoryUsage();
const deepReport = { ...summary(deepResult), runtimeMs: deepRuntimeMs, heapDeltaBytes: deepAfter.heapUsed - deepBefore.heapUsed,
  rssAfterBytes: deepAfter.rss, processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
  diagnostics: deepResult.diagnostics, terminationReason: deepResult.terminationReason };
assert(deepResult.evaluations.total <= 25000);
const previous = searchFieldLayout(bounded);
const previousMachines = previous.best!.machines;
const retentionInput = { ...bounded, initialIncumbent: {
  optionalMachines: previousMachines.filter(row => row.source.kind === "template")
    .map(row => ({ templateId: row.source.id, pivotCenter: row.machine.pivotCenter })),
} };
const retainedV2 = searchFieldLayoutV2(toV2(retentionInput));
assert(retainedV2.best!.irrigatedUnionSquareMeters + retainedV2.comparisonToleranceSquareMeters >= previous.best!.irrigatedUnionSquareMeters);
let cancelledV2 = false;
const v2Steps = searchFieldLayoutV2Steps(toV2(bounded), { isCancelled: () => cancelledV2 });
let v2MaxStepMs = 0, v2Yields = 0;
for (let i = 0; i < 150; i += 1) {
  const start = performance.now(); const step = v2Steps.next();
  v2MaxStepMs = Math.max(v2MaxStepMs, performance.now() - start);
  if (step.done) break;
  v2Yields += 1;
}
cancelledV2 = true;
const v2CancelStart = performance.now(), v2Cancellation = v2Steps.next();
const v2CancelResponseMs = performance.now() - v2CancelStart;
let cancelled = false;
const steps = searchFieldLayoutSteps(bounded, { isCancelled: () => cancelled });
let maxObservedStepMs = 0, yieldedSteps = 0;
for (let i = 0; i < 50; i += 1) {
  const start = performance.now();
  const step = steps.next();
  maxObservedStepMs = Math.max(maxObservedStepMs, performance.now() - start);
  if (step.done) break;
  yieldedSteps += 1;
}
cancelled = true;
const cancelStart = performance.now();
const cancellation = steps.next();
console.log(JSON.stringify({ version: "layout-search-benchmark-v2", timestamp: new Date().toISOString(),
  node: process.version, platform: process.platform, reports, v2Reports, deepReport, willRheaComparison, legacyRetention,
  v2PriorResultRetention: { priorSquareMeters: previous.best!.irrigatedUnionSquareMeters,
    retainedSquareMeters: retainedV2.best!.irrigatedUnionSquareMeters, evaluations: retainedV2.evaluations.total },
  v2Cancellation: { requestedAfterYields: v2Yields, responseMs: v2CancelResponseMs, maxObservedStepMs: v2MaxStepMs,
    termination: v2Cancellation.done ? v2Cancellation.value.termination : "not_finished" },
  cancellation: { requestedAfterYields: yieldedSteps, responseMs: performance.now() - cancelStart,
    maxObservedStepMs, termination: cancellation.done ? cancellation.value.termination : "not_finished" },
  limits: ["Memory deltas include garbage collection and are observations, not isolated allocations.",
    "Cooperative cancellation occurs between bounded geometry/combination operations; polygon-clipping calls cannot be interrupted mid-call.",
    "Same-pool greedy comparison only. Native/mobile/browser responsiveness remains unverified."] }, null, 2));
