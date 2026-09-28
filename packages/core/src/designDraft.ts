import { z } from "zod";
import { DraftDrawingWorkflowSchema } from "./draftDrawingWorkflow";
import { PROJECT_DRAWING_METADATA_VERSION, validateProjectDrawingMetadata } from "./drawingMetadata";

import { qualifyProjectCrs, type CrsQualification } from "./crsQualification";
import { evaluateManualDesignReadiness } from "./manualDesign";
import { MapPackageManifestSchema } from "./mapTilePackages";
import { evaluateProjectCalculationSafety, isBoundaryWithinCalculationBudget } from "./projectCalculationSafety";
import { projectDataKey } from "./projectDataComparison";
import { gnssV2CaptureConflicts } from "./gnssEvidence";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { PivotProjectSchema, LegacyPivotProjectSchema } from "./projectDocument";
import { ProjectSettingsSchema } from "./settings";
import type { GnssCaptureEvidence, PivotProject, XY } from "./types";
import { assertProjectedCrs } from "./units";

export const LEGACY_DESIGN_DRAFT_DOCUMENT_VERSION = "design-draft-v1";
export const DRAWING_WORKFLOW_DESIGN_DRAFT_DOCUMENT_VERSION = "design-draft-v2";
export const DESIGN_DRAFT_DOCUMENT_VERSION = "design-draft-v3";
export const DESIGN_DRAFT_DOCUMENT_VERSIONS = [LEGACY_DESIGN_DRAFT_DOCUMENT_VERSION, DRAWING_WORKFLOW_DESIGN_DRAFT_DOCUMENT_VERSION, DESIGN_DRAFT_DOCUMENT_VERSION] as const;

const projectShape = PivotProjectSchema.shape;
const machineShape = projectShape.machine.shape;
const DraftMachineSchema = projectShape.machine.partial().extend({
  spanLengthsMeters: z.array(machineShape.spanLengthsMeters.element.nullable()).optional(),
  endGunAngleRanges: machineShape.endGunAngleRanges.removeDefault().optional(),
  sweep: z.discriminatedUnion("mode", [
    machineShape.sweep.options[0],
    machineShape.sweep.options[1].partial().required({ mode: true }),
  ]).optional(),
}).strict();

const DraftMapPackageSchema = z.object({
  ...MapPackageManifestSchema.shape,
  tileUrlTemplates: MapPackageManifestSchema.shape.tileUrlTemplates.removeDefault().optional(),
  installStatus: MapPackageManifestSchema.shape.installStatus.removeDefault().optional(),
}).superRefine((value, context) => {
  const result = MapPackageManifestSchema.safeParse(value);
  if (!result.success) result.error.issues.forEach((issue) => context.addIssue({ code: "custom", path: issue.path, message: issue.message }));
});

const LegacyDraftSchema = z.object({
  ...LegacyPivotProjectSchema.shape,
  projectCrs: projectShape.projectCrs.nullable(),
  settings: ProjectSettingsSchema,
  fieldBoundary: z.array(projectShape.fieldBoundary.element),
  pivotCenter: projectShape.pivotCenter.nullable(),
  waterSource: projectShape.waterSource.nullable(),
  powerSource: projectShape.powerSource.nullable(),
  machine: DraftMachineSchema,
  mapPackages: z.array(DraftMapPackageSchema).optional(),
  mapFeatures: LegacyPivotProjectSchema.shape.mapFeatures.removeDefault(),
}).strict();

const WorkflowDraftSchema = LegacyDraftSchema.extend({ drawingWorkflow: DraftDrawingWorkflowSchema.optional() }).strict();
const DraftSchema = WorkflowDraftSchema.extend({
  drawingMetadata: projectShape.drawingMetadata,
  mapFeatures: projectShape.mapFeatures.removeDefault(),
}).strict();

/** Missing machine fields are omitted; null span slots retain their intended order. */
export type DesignDraftMachine = z.output<typeof DraftMachineSchema>;
/** Settings and present optional components must be supplied without relying on legacy defaults. */
export type DesignDraft = z.output<typeof DraftSchema>;
export interface DesignDraftDocument {
  documentVersion: typeof DESIGN_DRAFT_DOCUMENT_VERSIONS[number];
  draft: DesignDraft;
}

export interface DesignDraftBlocker {
  path: string;
  code: string;
  message: string;
}

export interface DesignDraftCompleteness {
  /** Required inputs; topology is checked only within the numerical domain. Also require calculationEligible. */
  complete: boolean;
  blockers: DesignDraftBlocker[];
  /** CRS and derived-distance blockers do not make supplied inputs incomplete or unsaveable. */
  calculationBlockers: DesignDraftBlocker[];
  calculationEligible: boolean;
  crsQualification: CrsQualification | null;
  fieldQualified: false;
}

export type DesignDraftBuildResult =
  | { ok: true; project: PivotProject; completeness: DesignDraftCompleteness }
  | { ok: false; reason: "incomplete" | "calculation_ineligible"; completeness: DesignDraftCompleteness }
  | { ok: false; reason: "invalid_draft"; blockers: DesignDraftBlocker[] };

/** Validates a strict versioned envelope. Bare projects/drafts are not document imports. */
export function parseDesignDraftDocument(input: string | unknown): DesignDraft {
  const raw: unknown = typeof input === "string" ? JSON.parse(input) : input;
  const snapshot = snapshotJsonValue(raw, "document");
  const envelope = z.object({
    documentVersion: z.enum(DESIGN_DRAFT_DOCUMENT_VERSIONS),
    draft: z.unknown(),
  }).strict().parse(snapshot);
  if (envelope.documentVersion === LEGACY_DESIGN_DRAFT_DOCUMENT_VERSION) LegacyDraftSchema.parse(envelope.draft);
  if (envelope.documentVersion === DRAWING_WORKFLOW_DESIGN_DRAFT_DOCUMENT_VERSION) WorkflowDraftSchema.parse(envelope.draft);
  return validateDesignDraft(envelope.draft);
}

/** Frozen v1/v2 envelope reader refuses classified v3 documents rather than dropping data. */
export function parseDesignDraftDocumentV2(input: string | unknown): DesignDraft {
  const raw = snapshotJsonValue(typeof input === "string" ? JSON.parse(input) : input, "document");
  const envelope = z.object({ documentVersion: z.enum([LEGACY_DESIGN_DRAFT_DOCUMENT_VERSION, DRAWING_WORKFLOW_DESIGN_DRAFT_DOCUMENT_VERSION]), draft: z.unknown() }).strict().parse(raw);
  return parseDesignDraftDocument(envelope);
}

export function serializeDesignDraftDocument(draft: DesignDraft): string {
  const validated = validateDesignDraft(draft);
  return JSON.stringify({
    documentVersion: validated.drawingMetadata !== undefined ? DESIGN_DRAFT_DOCUMENT_VERSION
      : validated.drawingWorkflow !== undefined ? DRAWING_WORKFLOW_DESIGN_DRAFT_DOCUMENT_VERSION : LEGACY_DESIGN_DRAFT_DOCUMENT_VERSION,
    draft: validated,
  } satisfies DesignDraftDocument, null, 2);
}

/** Invalid present data throws; absent inputs and incomplete topology return blockers. */
export function evaluateDesignDraftCompleteness(draft: DesignDraft): DesignDraftCompleteness {
  return evaluateValidatedDraft(validateDesignDraft(draft));
}

/** Builds a detached, planar-eligible project without transforms, defaults, or draft mutation. */
export function tryBuildPivotProject(draft: DesignDraft): DesignDraftBuildResult {
  let validated: DesignDraft;
  try {
    validated = validateDesignDraft(draft);
  } catch (error) {
    return { ok: false, reason: "invalid_draft", blockers: errorBlockers(error) };
  }
  const completeness = evaluateValidatedDraft(validated);
  if (!completeness.complete) return { ok: false, reason: "incomplete", completeness };
  if (!completeness.calculationEligible) return { ok: false, reason: "calculation_ineligible", completeness };

  const { drawingWorkflow: _workflow, ...projectData } = validated;
  if (_workflow) projectData.drawingMetadata = {
    schemaVersion: PROJECT_DRAWING_METADATA_VERSION, records: projectData.drawingMetadata?.records ?? [],
    autosaveEnabled: _workflow.autosaveEnabled,
  };
  const admitted = PivotProjectSchema.parse(projectData);
  const project: PivotProject = {
    ...projectData,
    projectCrs: admitted.projectCrs,
    pivotCenter: admitted.pivotCenter,
    waterSource: admitted.waterSource,
    powerSource: admitted.powerSource,
    machine: admitted.machine,
  };
  // This legacy default is optional in PivotProject; preserve its absence in the draft.
  if (validated.machine.endGunAngleRanges === undefined) delete project.machine.endGunAngleRanges;
  return { ok: true, project, completeness };
}

function validateDesignDraft(input: unknown): DesignDraft {
  const snapshot = snapshotJsonValue(input);
  const parsed = DraftSchema.parse(snapshot);
  // Legacy schemas may strip unknown keys or supply defaults. Neither is a draft save operation.
  assertSameFields(snapshot, parsed);
  // Only serialize detached data descriptors; never give caller objects to JSON.stringify.
  const draft: DesignDraft = JSON.parse(JSON.stringify(snapshot));
  if (draft.projectCrs !== null) assertProjectedCrs(draft.projectCrs);
  const hasXy = draft.fieldBoundary.length > 0 || draft.pivotCenter !== null
    || draft.waterSource !== null || draft.powerSource !== null || draft.surveyPoints.length > 0
    || draft.obstacles.length > 0 || (draft.mapFeatures?.length ?? 0) > 0
    || draft.drawingWorkflow?.captures.some(capture => capture.vertices.length > 0);
  if (hasXy && draft.projectCrs === null) throw new Error("projectCrs: Present XY requires an explicit projected/local CRS.");
  if (draft.drawingWorkflow?.lockedCrs != null && draft.drawingWorkflow.lockedCrs !== draft.projectCrs) {
    throw new Error("drawingWorkflow.lockedCrs: The retained coordinate frame must match the draft CRS.");
  }
  for (const capture of draft.drawingWorkflow?.captures ?? []) {
    if (capture.projectCrs !== draft.projectCrs) throw new Error("drawingWorkflow: Capture CRS must match the draft CRS.");
  }
  validateProjectDrawingMetadata(draft);
  if (draft.drawingMetadata && draft.drawingWorkflow && draft.drawingMetadata.autosaveEnabled !== draft.drawingWorkflow.autosaveEnabled) {
    throw new Error("drawingMetadata.autosaveEnabled: Must match the retained drawing workflow preference.");
  }
  if (draft.settings.unitSystem !== draft.unitSystem) throw new Error("settings.unitSystem: Must match the draft unitSystem.");
  for (const item of draft.mapPackages ?? []) {
    for (const uri of [item.uri, item.tileJsonUrl, ...(item.tileUrlTemplates ?? [])]) {
      if (uri === undefined) continue;
      let logical = false;
      try {
        const url = new URL(uri);
        logical = url.protocol === "app:" && url.hostname === "map-packages"
          && url.pathname.length > 1 && !url.username && !url.password && !url.port;
      } catch {
        // Machine-local paths are not portable draft metadata.
      }
      if (!logical) throw new Error(`mapPackages.${item.id}: Use logical app://map-packages/ references; machine-local paths remain local-only.`);
    }
  }
  if (draft.wgs84Companion && draft.wgs84Companion.projectCrs !== draft.projectCrs) {
    throw new Error("wgs84Companion.projectCrs: Must match the stored draft CRS; no relabeling or transform is performed.");
  }
  if (draft.fieldBoundaryCaptureEvidence && draft.fieldBoundaryCaptureEvidence.length !== draft.fieldBoundary.length) {
    throw new Error("fieldBoundaryCaptureEvidence: Capture evidence must align with boundary vertices.");
  }
  for (const [name, entities] of [
    ["surveyPoints", draft.surveyPoints], ["obstacles", draft.obstacles],
    ["mapFeatures", draft.mapFeatures ?? []], ["mapPackages", draft.mapPackages ?? []],
  ] as const) {
    const ids = new Set<string>();
    for (const entity of entities) {
      if (ids.has(entity.id)) throw new Error(`${name}: Duplicate ID ${entity.id}; explicit repair is required.`);
      ids.add(entity.id);
    }
  }
  for (const [role, point] of [
    ["pivot_center", draft.pivotCenter], ["water_source", draft.waterSource], ["power_source", draft.powerSource],
  ] as const) {
    const id = draft.infrastructureObservationRefs?.[role];
    if (id === undefined) continue;
    const observation = draft.surveyPoints.find((item) => item.id === id);
    if (!point || !observation || !samePoint(point, observation.projected)) {
      throw new Error(`infrastructureObservationRefs.${role}: Reference ${id} must resolve to its exact projected XY coordinate.`);
    }
  }
  const captures = new Map<string, { point: XY; evidence: GnssCaptureEvidence }>();
  const checkCapture = (point: XY, evidence: GnssCaptureEvidence | null | undefined) => {
    if (!evidence) return;
    const previous = captures.get(evidence.observationId);
    const compareLegacy = previous && (previous.evidence.schemaVersion === "gnss-capture-v1" || evidence.schemaVersion === "gnss-capture-v1");
    if (compareLegacy && (!samePoint(previous.point, point) || projectDataKey(previous.evidence) !== projectDataKey(evidence))) {
      throw new Error(`captureEvidence: Conflicting observation ${evidence.observationId}; explicit repair is required.`);
    }
    captures.set(evidence.observationId, { point, evidence });
  };
  draft.fieldBoundary.forEach((point, index) => checkCapture(point, draft.fieldBoundaryCaptureEvidence?.[index]));
  draft.surveyPoints.forEach((point) => checkCapture(point.projected, point.captureEvidence));
  draft.obstacles.forEach((obstacle) => obstacle.polygon.forEach((point, index) => checkCapture(point, obstacle.vertexCaptureEvidence?.[index])));
  draft.mapFeatures?.forEach((feature) => {
    const vertices = feature.geometry.type === "Point" ? [feature.geometry.point]
      : feature.geometry.type === "Circle" ? [feature.geometry.center] : feature.geometry.vertices;
    vertices.forEach((point, index) => checkCapture(point, feature.vertexCaptureEvidence?.[index]));
  });
  const conflict = gnssV2CaptureConflicts(draft)[0];
  if (conflict) throw new Error(`${conflict.path.join(".")}: ${conflict.message}`);
  return draft;
}

function evaluateValidatedDraft(draft: DesignDraft): DesignDraftCompleteness {
  const blockers: DesignDraftBlocker[] = [];
  const { drawingWorkflow, ...projectData } = draft;
  for (const capture of drawingWorkflow?.captures ?? []) {
    blockers.push({ path: "drawingWorkflow", code: "unfinished_drawing", message: `Drawing ${capture.name} has not been committed or discarded.` });
  }
  const admission = PivotProjectSchema.safeParse(projectData);
  if (!admission.success) blockers.push(...errorBlockers(admission.error));
  const crsQualification = draft.projectCrs === null ? null : qualifyProjectCrs(draft.projectCrs);
  const calculationBlockers: DesignDraftBlocker[] = crsQualification?.calculation.blockers.map((code) => ({
    path: "projectCrs", code, message: `Metric planar calculations unavailable: ${code}.`,
  })) ?? [];
  const numericBlockers = admission.success ? evaluateProjectCalculationSafety(admission.data).blockers : [];
  calculationBlockers.push(...numericBlockers);
  const boundaryInRange = isBoundaryWithinCalculationBudget(draft.fieldBoundary);
  // Machine-only aggregate overflow still permits topology checks on a safe boundary.
  const topologyBlocked = numericBlockers.some((issue) => issue.code !== "non_finite_machine_distance");
  if (draft.projectCrs !== null && boundaryInRange && !topologyBlocked) {
    // Defer topology outside the numerical domain; never run overflowing predicates to infer completion.
    const readiness = evaluateManualDesignReadiness({
      projectId: draft.id, projectCrs: draft.projectCrs, baseRevision: 0,
      boundary: { vertices: draft.fieldBoundary, source: "projected_xy" },
      pivot: null, machine: null, radiusEvidence: [], selectedEvidenceFeatureIds: [],
    });
    blockers.push(...readiness.topologyIssues.map((issue) => ({ path: "fieldBoundary", code: issue.code, message: issue.message })));
  }
  return {
    complete: blockers.length === 0,
    blockers,
    calculationBlockers,
    calculationEligible: blockers.length === 0 && crsQualification?.calculation.allowed === true && calculationBlockers.length === 0,
    crsQualification,
    fieldQualified: false,
  };
}

function samePoint(left: XY, right: XY): boolean {
  return left.x === right.x && left.y === right.y;
}

function errorBlockers(error: unknown): DesignDraftBlocker[] {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message }));
  }
  return [{ path: "", code: "invalid_draft", message: error instanceof Error ? error.message : String(error) }];
}

function assertSameFields(input: unknown, parsed: unknown, path = "draft"): void {
  if (input === undefined && parsed !== undefined) throw new Error(`${path}: Supply this component value explicitly; draft validation cannot insert defaults.`);
  if (typeof input !== "object" || input === null || typeof parsed !== "object" || parsed === null) return;
  const original = input as Record<string, unknown>;
  const validated = parsed as Record<string, unknown>;
  for (const key of Object.keys(original)) {
    if (!Object.hasOwn(validated, key)) throw new Error(`${path}.${key}: Unsupported field; refusing to discard data.`);
    assertSameFields(original[key], validated[key], `${path}.${key}`);
  }
  for (const key of Object.keys(validated)) {
    if (!Object.hasOwn(original, key) && validated[key] !== undefined) throw new Error(`${path}.${key}: Supply this component value explicitly; draft validation cannot insert defaults.`);
  }
}
