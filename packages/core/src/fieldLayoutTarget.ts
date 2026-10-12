import { z } from "zod";
import type { CrsQualificationOptions } from "./crsQualification";
import { FieldCalculationCrsOptionsSchema } from "./fieldCalculationInput";
import { parseFieldDesignDocument, serializeFieldDesignDocument, validateFieldDesign, type FieldDesign } from "./fieldDesignDocument";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { parseStrictJson } from "./strictJson";
import { parseSurveyReview, serializeSurveyReview, surveyGeometrySignature, type SurveyReview } from "./surveyReview";
import { projectDataKey } from "./projectDataComparison";
import { sha256Text } from "./sha256";
import { qualifyProjectCrs } from "./crsQualification";

export const FIELD_LAYOUT_TARGET_DOCUMENT_VERSION = "field-layout-target-v1";
export const REVIEWED_FIELD_LAYOUT_TARGET_DOCUMENT_VERSION = "field-layout-target-v2";
export const LayoutTargetPointSchema = z.object({
  id: z.string().min(1), machineId: z.string().min(1), role: z.enum(["pivot_center", "corner_guidance", "lateral_start", "lateral_end"]),
  projected: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  sourceFeatureId: z.string().min(1).optional(), sourceVertexIndex: z.number().int().nonnegative().optional(),
}).strict();
export type LayoutTargetPoint = z.infer<typeof LayoutTargetPointSchema>;
const WorkflowSchema = z.object({ designId: z.string().min(1), fieldMapId: z.string().min(1), reviewId: z.string().min(1),
  surveyReviewDocument: z.string().min(1), sourceGeometrySignature: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type DeepReadonlyFieldTarget<T> = T extends (infer U)[] ? readonly DeepReadonlyFieldTarget<U>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonlyFieldTarget<T[K]> } : T;

export interface FieldLayoutTargetRequest {
  inputRevision: number;
  expectedRevision: number;
  selectedMachineIds: string[];
  crsOptions?: CrsQualificationOptions;
}

type TargetData = {
  documentVersion: typeof FIELD_LAYOUT_TARGET_DOCUMENT_VERSION | typeof REVIEWED_FIELD_LAYOUT_TARGET_DOCUMENT_VERSION;
  source: { fieldId: string; inputRevision: number; selectedMachineIds: string[] };
  field: FieldDesign;
  crsOptions: CrsQualificationOptions;
  /** Snapshot authority is identity and XY retention only, never installation or receiver guidance. */
  qualification: "design_snapshot_only";
  workflow?: z.infer<typeof WorkflowSchema>;
  targetPoints?: LayoutTargetPoint[];
};
export type FieldLayoutTarget = DeepReadonlyFieldTarget<TargetData>;
const revisionSchema = z.number().int().nonnegative().safe();
const selectionSchema = z.array(z.string().min(1)).min(1);
const requestSchema = z.object({
  inputRevision: revisionSchema, expectedRevision: revisionSchema, selectedMachineIds: selectionSchema,
  crsOptions: FieldCalculationCrsOptionsSchema.optional(),
}).strict();
const documentSchema = z.object({
  documentVersion: z.literal(FIELD_LAYOUT_TARGET_DOCUMENT_VERSION),
  source: z.object({ fieldId: z.string().min(1), inputRevision: revisionSchema, selectedMachineIds: selectionSchema }).strict(),
  fieldDocument: z.unknown(), crsOptions: FieldCalculationCrsOptionsSchema,
  qualification: z.literal("design_snapshot_only"),
}).strict();
const reviewedDocumentSchema = documentSchema.extend({ documentVersion: z.literal(REVIEWED_FIELD_LAYOUT_TARGET_DOCUMENT_VERSION),
  workflow: WorkflowSchema, targetPoints: z.array(LayoutTargetPointSchema).min(1) }).strict();

/** Immutable design handoff; later editing and caller mutation cannot change this target. */
export function createFieldLayoutTarget(inputField: FieldDesign, inputRequest: FieldLayoutTargetRequest): FieldLayoutTarget {
  const field = validateFieldDesign(inputField);
  const request = requestSchema.parse(snapshotJsonValue(inputRequest, "layout target request"));
  if (request.inputRevision !== request.expectedRevision) throw new Error("Field revision changed; review the current design before creating a Layout target.");
  assertSelectedMachines(field, request.selectedMachineIds);
  const crsOptions = request.crsOptions ?? {};
  // Keep even an unsupported CRS truthful: creating a snapshot is not metric admission.
  return freeze({ documentVersion: FIELD_LAYOUT_TARGET_DOCUMENT_VERSION,
    source: { fieldId: field.id, inputRevision: request.inputRevision, selectedMachineIds: request.selectedMachineIds },
    field, crsOptions, qualification: "design_snapshot_only" } satisfies TargetData);
}

/** Dedicated durable document, never sent through field/project storage writers. */
export function serializeFieldLayoutTarget(target: FieldLayoutTarget): string {
  const data = snapshotJsonValue(target, "layout target") as TargetData;
  // Round-trip through the public strict parser before emitting caller-supplied snapshots.
  const expectedKeys = ["documentVersion", "source", "field", "crsOptions", "qualification",
    ...(data.documentVersion === REVIEWED_FIELD_LAYOUT_TARGET_DOCUMENT_VERSION ? ["workflow", "targetPoints"] : [])];
  if (!data || typeof data !== "object" || Object.keys(data).length !== expectedKeys.length
    || Object.keys(data).some(key => !expectedKeys.includes(key))) throw new Error("Unsupported Layout target data.");
  const raw = { documentVersion: data.documentVersion, source: data.source,
    fieldDocument: parseStrictJson(serializeFieldDesignDocument(data.field)), crsOptions: data.crsOptions,
    qualification: data.qualification,
    ...(data.documentVersion === REVIEWED_FIELD_LAYOUT_TARGET_DOCUMENT_VERSION ? { workflow: data.workflow, targetPoints: data.targetPoints } : {}) };
  parseFieldLayoutTarget(raw);
  return JSON.stringify(raw, null, 2);
}

export function parseFieldLayoutTarget(input: string | unknown): FieldLayoutTarget {
  const raw = snapshotJsonValue(typeof input === "string" ? parseStrictJson(input) : input, "layout target document");
  const version = raw && typeof raw === "object" && "documentVersion" in raw ? raw.documentVersion : null;
  const document = version === REVIEWED_FIELD_LAYOUT_TARGET_DOCUMENT_VERSION ? reviewedDocumentSchema.parse(raw) : documentSchema.parse(raw);
  const field = parseFieldDesignDocument(document.fieldDocument);
  if (field.id !== document.source.fieldId) throw new Error("Layout target source identity does not match its retained field.");
  if (document.documentVersion === REVIEWED_FIELD_LAYOUT_TARGET_DOCUMENT_VERSION) {
    const reviewed = document as z.infer<typeof reviewedDocumentSchema>;
    const target = createReviewedFieldLayoutTarget(field, { inputRevision: reviewed.source.inputRevision, expectedRevision: reviewed.source.inputRevision,
      selectedMachineIds: reviewed.source.selectedMachineIds, crsOptions: reviewed.crsOptions,
      designId: reviewed.workflow.designId, fieldMapId: reviewed.workflow.fieldMapId,
      review: parseSurveyReview(reviewed.workflow.surveyReviewDocument) });
    if (projectDataKey(target.workflow!) !== projectDataKey(reviewed.workflow) || projectDataKey(target.targetPoints!) !== projectDataKey(reviewed.targetPoints)) throw new Error("Layout point inventory or reviewed source signature differs from its immutable source.");
    return target;
  }
  const target = createFieldLayoutTarget(field, {
    inputRevision: document.source.inputRevision, expectedRevision: document.source.inputRevision,
    selectedMachineIds: document.source.selectedMachineIds, crsOptions: document.crsOptions,
  });
  return target;
}

export function fieldLayoutTargetMatches(target: FieldLayoutTarget, field: Pick<FieldDesign, "id">, inputRevision: number): boolean {
  return Number.isSafeInteger(inputRevision) && inputRevision >= 0
    && target.source.fieldId === field.id && target.source.inputRevision === inputRevision;
}

function assertSelectedMachines(field: FieldDesign, selected: string[]): void {
  if (new Set(selected).size !== selected.length) throw new Error("Layout target machine identities must be distinct.");
  if (selected.some(id => !field.machines.some(machine => machine.id === id))) throw new Error("Layout target machine was not found in the source field.");
}

export function layoutTargetSourceSignature(field: FieldDesign, selectedMachineIds: readonly string[]): string {
  const checked = validateFieldDesign(field);
  const selected = new Set(selectedMachineIds);
  return sha256Text(projectDataKey({ geometry: surveyGeometrySignature("field", serializeFieldDesignDocument(checked)),
    machines: checked.machines.filter(machine => selected.has(machine.id)).map(machine => {
      const { name: _name, ...configuration } = machine.configuration;
      return { id: machine.id, configuration, cornerGuidanceFeatureId: machine.cornerGuidanceFeatureId ?? null, sourceFeatureIds: machine.sourceFeatureIds ?? null };
    }), laterals: (checked.lateralMachines ?? []).filter(machine => selected.has(machine.id)).map(machine => { const { name: _name, ...rest } = machine; return rest; }) }));
}
export function createReviewedFieldLayoutTarget(inputField: FieldDesign, request: FieldLayoutTargetRequest & { designId: string; fieldMapId: string; review: SurveyReview }): FieldLayoutTarget {
  const field = validateFieldDesign(inputField), review = parseSurveyReview(request.review);
  requestSchema.parse({ inputRevision: request.inputRevision, expectedRevision: request.expectedRevision, selectedMachineIds: request.selectedMachineIds,
    ...(request.crsOptions === undefined ? {} : { crsOptions: request.crsOptions }) });
  if (request.inputRevision !== request.expectedRevision) throw new Error("Review the current source before freezing Layout.");
  if (review.owner.designId !== request.designId || review.owner.fieldMapId !== request.fieldMapId || review.owner.documentKind !== "field"
    || review.owner.payloadId !== field.id || review.geometrySignature !== surveyGeometrySignature("field", serializeFieldDesignDocument(field))) throw new Error("Complete and review Survey for this exact field before creating Layout.");
  const selected = request.selectedMachineIds;
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(value => ![...field.machines, ...(field.lateralMachines ?? [])].some(machine => machine.id === value))) throw new Error("Choose distinct actual pivot or lateral machines for Layout.");
  const points: LayoutTargetPoint[] = [];
  for (const machineId of selected) {
    const pivot = field.machines.find(machine => machine.id === machineId);
    if (pivot) {
      points.push({ id: `${machineId}:pivot_center`, machineId, role: "pivot_center", projected: { ...pivot.pivotCenter } });
      if (pivot.cornerGuidanceFeatureId !== undefined) {
        const feature = field.mapFeatures?.find(item => item.id === pivot.cornerGuidanceFeatureId);
        if (feature?.geometry.type !== "LineString") throw new Error("Corner Layout requires its actual saved guidance line.");
        feature.geometry.vertices.forEach((point, index) => points.push({ id: `${machineId}:corner:${index}`, machineId, role: "corner_guidance", projected: { ...point }, sourceFeatureId: feature.id, sourceVertexIndex: index }));
      }
    } else {
      const lateral = field.lateralMachines!.find(machine => machine.id === machineId)!;
      points.push({ id: `${machineId}:lateral_start`, machineId, role: "lateral_start", projected: { ...lateral.travel.start } },
        { id: `${machineId}:lateral_end`, machineId, role: "lateral_end", projected: { ...lateral.travel.end } });
    }
  }
  return freeze({ documentVersion: REVIEWED_FIELD_LAYOUT_TARGET_DOCUMENT_VERSION,
    source: { fieldId: field.id, inputRevision: request.inputRevision, selectedMachineIds: [...selected] }, field,
    crsOptions: request.crsOptions ?? {}, qualification: "design_snapshot_only",
    workflow: { designId: request.designId, fieldMapId: request.fieldMapId, reviewId: review.id, surveyReviewDocument: serializeSurveyReview(review), sourceGeometrySignature: layoutTargetSourceSignature(field, selected) }, targetPoints: points });
}

export function layoutPointResidual(target: FieldLayoutTarget, targetPointId: string, position: { x: number; y: number }): {
  eastMeters: number; northMeters: number; distanceMeters: number; gridBearingDegrees: number;
} {
  const qualification = qualifyProjectCrs(target.field.projectCrs, target.crsOptions);
  if (!qualification.calculation.allowed || qualification.unit !== "metre" || qualification.wgs84Transform !== "projection_only") throw new Error("Layout distances require a supported projected metre coordinate frame.");
  const point = target.targetPoints?.find(item => item.id === targetPointId);
  if (!point) throw new Error("Choose an actual point from this immutable Layout target.");
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error("Layout position must be finite.");
  const eastMeters = point.projected.x - position.x, northMeters = point.projected.y - position.y;
  return { eastMeters, northMeters, distanceMeters: Math.hypot(eastMeters, northMeters), gridBearingDegrees: (Math.atan2(eastMeters, northMeters) * 180 / Math.PI + 360) % 360 };
}

function freeze<T>(value: T): DeepReadonlyFieldTarget<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonlyFieldTarget<T>;
}
