import { hasOperationalGnssEvidence, refuseOperationalGnssEvidence } from "./operationalGnssEvidence";
import { z } from "zod";

import { DrawingMetadataRecordSchema, PROJECT_DRAWING_METADATA_VERSION, validateProjectDrawingMetadata,
  type DrawingMetadataRecord, type DrawingMetadataTarget, type ProjectDrawingMetadata } from "./drawingMetadata";
import { gnssV2CaptureConflicts } from "./gnssEvidence";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { assertNoStrippedFields } from "./jsonFieldRetention";
import { MapPackageManifestSchema } from "./mapTilePackages";
import { projectDataKey } from "./projectDataComparison";
import { parseProjectDocument, PivotProjectSchema, PROJECT_DOCUMENT_VERSIONS } from "./projectDocument";
import { parseStrictJson } from "./strictJson";
import { StraightLateralMachineSchema, type StraightLateralMachine } from "./straightLateral";
import type { GnssCaptureEvidence, PivotMachine, PivotProject, XY } from "./types";
import { assertProjectedCrs } from "./units";

export const LEGACY_FIELD_DESIGN_DOCUMENT_VERSION = "field-design-v1";
export const FIELD_DESIGN_DOCUMENT_V2_VERSION = "field-design-v2";
export const FIELD_DESIGN_DOCUMENT_VERSION = "field-design-v3";
export const OPERATIONAL_FIELD_DESIGN_DOCUMENT_VERSION = "field-design-v4";
export const FIELD_DESIGN_DOCUMENT_VERSIONS = [LEGACY_FIELD_DESIGN_DOCUMENT_VERSION, FIELD_DESIGN_DOCUMENT_V2_VERSION, FIELD_DESIGN_DOCUMENT_VERSION, OPERATIONAL_FIELD_DESIGN_DOCUMENT_VERSION] as const;
export const FIELD_DRAWING_METADATA_VERSION = "field-drawing-metadata-v1";

const referenceId = z.string().min(1);
export const FieldDrawingMetadataTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field_boundary") }).strict(),
  z.object({ kind: z.literal("pivot_center"), machineId: referenceId }).strict(),
  z.object({ kind: z.literal("water_source"), infrastructureId: referenceId }).strict(),
  z.object({ kind: z.literal("power_source"), infrastructureId: referenceId }).strict(),
  z.object({ kind: z.literal("map_feature"), id: referenceId }).strict(),
  z.object({ kind: z.literal("obstacle"), id: referenceId }).strict(),
]);
export type FieldDrawingMetadataTarget = z.output<typeof FieldDrawingMetadataTargetSchema>;
export const FieldDrawingMetadataRecordSchema = DrawingMetadataRecordSchema.extend({ target: FieldDrawingMetadataTargetSchema });
export type FieldDrawingMetadataRecord = z.output<typeof FieldDrawingMetadataRecordSchema>;
export const FieldDrawingMetadataSchema = z.object({
  schemaVersion: z.literal(FIELD_DRAWING_METADATA_VERSION), autosaveEnabled: z.boolean(),
  records: z.array(FieldDrawingMetadataRecordSchema),
}).strict();
export type FieldDrawingMetadata = z.output<typeof FieldDrawingMetadataSchema>;

export interface FieldInfrastructurePoint {
  id: string;
  kind: "water_source" | "power_source";
  point: XY;
  /** Survey record ID, not the receiver capture observation ID. */
  observationId?: string;
}

export interface FieldPivotMachine {
  id: string;
  kind: "center_pivot";
  configuration: Omit<PivotMachine, "id">;
  pivotCenter: XY;
  pivotObservationId?: string;
  waterSourceId?: string;
  powerSourceId?: string;
  /** Explicit SDU line association, not a swept envelope or qualification claim. */
  cornerGuidanceFeatureId?: string;
  sourceFeatureIds?: string[];
}

export interface FieldDesign extends Pick<PivotProject,
  "id" | "name" | "projectCrs" | "unitSystem" | "settings" | "fieldBoundary"
  | "fieldBoundaryCaptureEvidence" | "obstacles" | "surveyPoints" | "mapPackages" | "mapFeatures"> {
  infrastructure: FieldInfrastructurePoint[];
  machines: FieldPivotMachine[];
  /** Separate explicit model; never disguised as a pivot or inferred from map lines. */
  lateralMachines?: StraightLateralMachine[];
  drawingMetadata?: FieldDrawingMetadata;
}

const shape = PivotProjectSchema.shape;
const id = z.string().min(1);
const InfrastructureSchema = z.object({
  id, kind: z.enum(["water_source", "power_source"]), point: shape.pivotCenter, observationId: id.optional(),
}).strict();
const MachineSchema = z.object({
  id, kind: z.literal("center_pivot"),
  configuration: shape.machine.omit({ id: true }).extend({
    endGunAngleRanges: shape.machine.shape.endGunAngleRanges.removeDefault(),
  }).strict(),
  pivotCenter: shape.pivotCenter,
  pivotObservationId: id.optional(), waterSourceId: id.optional(), powerSourceId: id.optional(),
  cornerGuidanceFeatureId: id.optional(), sourceFeatureIds: z.array(id).optional(),
}).strict();
const FieldMapPackageSchema = z.object({
  ...MapPackageManifestSchema.shape,
  tileUrlTemplates: MapPackageManifestSchema.shape.tileUrlTemplates.removeDefault().optional(),
  installStatus: MapPackageManifestSchema.shape.installStatus.removeDefault().optional(),
}).superRefine((value, context) => {
  const parsed = MapPackageManifestSchema.safeParse(value);
  if (!parsed.success) parsed.error.issues.forEach(issue => context.addIssue({ code: "custom", path: issue.path, message: issue.message }));
});
const FieldSchema = z.object({
  id, name: shape.name, projectCrs: shape.projectCrs, unitSystem: shape.unitSystem,
  settings: shape.settings, fieldBoundary: shape.fieldBoundary,
  fieldBoundaryCaptureEvidence: shape.fieldBoundaryCaptureEvidence,
  obstacles: shape.obstacles, surveyPoints: shape.surveyPoints,
  mapFeatures: shape.mapFeatures.removeDefault(), mapPackages: z.array(FieldMapPackageSchema).optional(),
  infrastructure: z.array(InfrastructureSchema), machines: z.array(MachineSchema),
  lateralMachines: z.array(StraightLateralMachineSchema).optional(),
  drawingMetadata: FieldDrawingMetadataSchema.optional(),
}).strict();
const EnvelopeSchema = z.object({ documentVersion: z.enum(FIELD_DESIGN_DOCUMENT_VERSIONS), field: z.unknown() }).strict();

/** Storage admission only: no topology, operating clearance, hydraulic or field qualification. */
export function validateFieldDesign(input: unknown): FieldDesign {
  const snapshot = snapshotJsonValue(input, "field");
  assertDefinedJson(snapshot);
  const parsed = FieldSchema.parse(snapshot);
  assertNoStrippedFields(snapshot, parsed, "Field contains unsupported data; refusing to discard it.");
  if (projectDataKey(snapshot as object) !== projectDataKey(parsed)) {
    throw new Error("Field values must be explicit; validation cannot insert defaults or normalize supplied data.");
  }
  const field = parsed as FieldDesign;
  assertProjectedCrs(field.projectCrs);
  if (field.settings && field.settings.unitSystem !== field.unitSystem) throw new Error("Field settings unit system must match the field.");
  if (field.fieldBoundaryCaptureEvidence && field.fieldBoundaryCaptureEvidence.length !== field.fieldBoundary.length) {
    throw new Error("Field boundary capture evidence must align with vertices.");
  }
  const observations = unique(field.surveyPoints, "survey point");
  unique(field.obstacles, "obstacle");
  const features = unique(field.mapFeatures ?? [], "map feature");
  unique(field.mapPackages ?? [], "map package");
  unique([...field.machines, ...(field.lateralMachines ?? [])], "machine");
  const infrastructure = unique(field.infrastructure, "infrastructure");
  const checkObservation = (reference: string | undefined, point: XY) => {
    if (reference === undefined) return;
    const observation = observations.get(reference);
    if (!observation || !samePoint(observation.projected, point)) {
      throw new Error(`Survey reference ${reference} must resolve to its exact projected XY coordinate.`);
    }
  };
  for (const item of field.infrastructure) checkObservation(item.observationId, item.point);
  for (const machine of field.machines) {
    checkObservation(machine.pivotObservationId, machine.pivotCenter);
    for (const [reference, kind] of [[machine.waterSourceId, "water_source"], [machine.powerSourceId, "power_source"]] as const) {
      if (reference !== undefined && infrastructure.get(reference)?.kind !== kind) throw new Error(`Machine ${machine.id}: ${kind} reference must resolve to the correct infrastructure kind.`);
    }
    if (machine.sourceFeatureIds) {
      if (new Set(machine.sourceFeatureIds).size !== machine.sourceFeatureIds.length) throw new Error(`Machine ${machine.id}: duplicate source feature reference.`);
      for (const reference of machine.sourceFeatureIds) if (!features.has(reference)) throw new Error(`Machine ${machine.id}: missing source feature ${reference}.`);
    }
    if (machine.cornerGuidanceFeatureId !== undefined) {
      const geometry = features.get(machine.cornerGuidanceFeatureId)?.geometry;
      if (geometry?.type !== "LineString" || !geometry.vertices.some(point => !samePoint(point, geometry.vertices[0]))) {
        throw new Error(`Machine ${machine.id}: corner guidance must reference a nondegenerate LineString.`);
      }
    }
  }
  for (const machine of field.lateralMachines ?? []) {
    for (const [reference, kind] of [[machine.waterSourceId, "water_source"], [machine.powerSourceId, "power_source"]] as const) {
      if (reference !== undefined && infrastructure.get(reference)?.kind !== kind) {
        throw new Error(`Straight lateral ${machine.id}: ${kind} reference must resolve to the correct infrastructure kind.`);
      }
    }
  }
  for (const item of field.mapPackages ?? []) {
    for (const uri of [item.uri, item.tileJsonUrl, ...(item.tileUrlTemplates ?? [])]) {
      if (uri === undefined) continue;
      let logical = false;
      try {
        const url = new URL(uri);
        logical = url.protocol === "app:" && url.hostname === "map-packages"
          && url.pathname.length > 1 && !url.username && !url.password && !url.port;
      } catch { /* Invalid and machine-local URIs are not portable field metadata. */ }
      if (!logical) throw new Error(`Map package ${item.id}: use logical app://map-packages/ references.`);
    }
  }
  assertCaptureConsistency(field);
  validateFieldDrawingMetadata(field);
  return field;
}

export function parseFieldDesignDocument(input: string | unknown): FieldDesign {
  const raw = typeof input === "string" ? parseStrictJson(input) : input;
  const envelope = EnvelopeSchema.parse(snapshotJsonValue(raw, "document"));
  if (envelope.documentVersion !== OPERATIONAL_FIELD_DESIGN_DOCUMENT_VERSION) refuseOperationalGnssEvidence(envelope.field);
  if (envelope.documentVersion === LEGACY_FIELD_DESIGN_DOCUMENT_VERSION) return parseFieldDesignDocumentV1(envelope);
  if (envelope.documentVersion === FIELD_DESIGN_DOCUMENT_V2_VERSION) return parseFieldDesignDocumentV2(envelope);
  return validateFieldDesign(envelope.field);
}

/** Frozen legacy reader: classified data cannot be downgraded into v1. */
export function parseFieldDesignDocumentV1(input: string | unknown): FieldDesign {
  const raw = typeof input === "string" ? parseStrictJson(input) : input;
  const envelope = EnvelopeSchema.parse(snapshotJsonValue(raw, "document"));
  refuseOperationalGnssEvidence(envelope.field);
  if (envelope.documentVersion !== LEGACY_FIELD_DESIGN_DOCUMENT_VERSION) {
    throw new Error("Field document version is unsupported; preserve the original document and use a compatible editor.");
  }
  if (envelope.field && typeof envelope.field === "object" && "drawingMetadata" in envelope.field) {
    throw new Error("Field drawing metadata requires field-design-v2; preserve the original document.");
  }
  refuseLegacyLaterals(envelope.field);
  return validateFieldDesign(envelope.field);
}

/** Frozen pre-lateral reader: v1/v2 remain readable, v3 must never be downgraded. */
export function parseFieldDesignDocumentV2(input: string | unknown): FieldDesign {
  const raw = typeof input === "string" ? parseStrictJson(input) : input;
  const envelope = EnvelopeSchema.parse(snapshotJsonValue(raw, "document"));
  if (envelope.documentVersion !== OPERATIONAL_FIELD_DESIGN_DOCUMENT_VERSION) refuseOperationalGnssEvidence(envelope.field);
  if (envelope.documentVersion === LEGACY_FIELD_DESIGN_DOCUMENT_VERSION) return parseFieldDesignDocumentV1(envelope);
  if (envelope.documentVersion !== FIELD_DESIGN_DOCUMENT_V2_VERSION) {
    throw new Error("Field document version is unsupported by v2; preserve the original document and use a compatible editor.");
  }
  refuseLegacyLaterals(envelope.field);
  return validateFieldDesign(envelope.field);
}

function refuseLegacyLaterals(field: unknown): void {
  if (field && typeof field === "object" && "lateralMachines" in field) {
    throw new Error("Straight lateral data requires field-design-v3; preserve the original document.");
  }
}

export function serializeFieldDesignDocument(field: FieldDesign): string {
  const admitted = validateFieldDesign(field);
  return JSON.stringify({ documentVersion: hasOperationalGnssEvidence(admitted) ? OPERATIONAL_FIELD_DESIGN_DOCUMENT_VERSION : admitted.lateralMachines !== undefined ? FIELD_DESIGN_DOCUMENT_VERSION
    : admitted.drawingMetadata === undefined ? LEGACY_FIELD_DESIGN_DOCUMENT_VERSION : FIELD_DESIGN_DOCUMENT_V2_VERSION, field: admitted }, null, 2);
}

/** Explicit detached conversion; the caller must retain the original text before persisting a new document. */
export function convertPivotProjectToFieldDesign(originalProjectDocument: string, identities: {
  fieldId: string; waterSourceId: string; powerSourceId: string;
}): { field: FieldDesign; originalProjectDocument: string } {
  if (typeof originalProjectDocument !== "string") throw new Error("Conversion requires original project JSON text.");
  const ids = z.object({ fieldId: id, waterSourceId: id, powerSourceId: id }).strict().parse(snapshotJsonValue(identities, "identities"));
  const raw = parseStrictJson(originalProjectDocument);
  const wrapped = raw !== null && typeof raw === "object" && "documentVersion" in raw;
  const source = wrapped
    ? z.object({ documentVersion: z.enum(PROJECT_DOCUMENT_VERSIONS), project: z.unknown() }).strict().parse(raw).project
    : raw;
  // Enforce the source-version boundary and root refinements before retaining its un-defaulted data.
  parseProjectDocument(raw);
  const admitted = PivotProjectSchema.parse(source);
  assertNoStrippedFields(source, admitted, "Legacy project contains unsupported fields; preserve it and use a compatible converter.");
  // Preserve absent optional values and original XY, rather than using the defaulted reader result.
  const project = snapshotJsonValue(source, "project") as PivotProject;
  if (ids.fieldId === project.id) throw new Error("Converted field requires a new document identity; preserve the original project.");
  const { pivotCenter, waterSource, powerSource, infrastructureObservationRefs, machine,
    wgs84Companion: _derivedCompanion, drawingMetadata, ...shared } = project;
  const { id: machineId, ...configuration } = machine;
  const field = validateFieldDesign({
    ...shared, id: ids.fieldId,
    infrastructure: [
      { id: ids.waterSourceId, kind: "water_source", point: waterSource,
        ...(infrastructureObservationRefs?.water_source === undefined ? {} : { observationId: infrastructureObservationRefs.water_source }) },
      { id: ids.powerSourceId, kind: "power_source", point: powerSource,
        ...(infrastructureObservationRefs?.power_source === undefined ? {} : { observationId: infrastructureObservationRefs.power_source }) },
    ],
    machines: [{ id: machineId, kind: "center_pivot", configuration, pivotCenter,
      waterSourceId: ids.waterSourceId, powerSourceId: ids.powerSourceId,
      ...(infrastructureObservationRefs?.pivot_center === undefined ? {} : { pivotObservationId: infrastructureObservationRefs.pivot_center }) }],
    ...(drawingMetadata === undefined ? {} : { drawingMetadata: {
      ...drawingMetadata, schemaVersion: FIELD_DRAWING_METADATA_VERSION,
      records: drawingMetadata.records.map(record => ({ ...record, target: projectTargetToField(record.target, machineId, ids) })),
    } }),
  });
  return { field, originalProjectDocument };
}

function projectTargetToField(target: DrawingMetadataTarget, machineId: string,
  ids: { waterSourceId: string; powerSourceId: string }): FieldDrawingMetadataTarget {
  if (target.kind === "pivot_center") return { kind: target.kind, machineId };
  if (target.kind === "water_source") return { kind: target.kind, infrastructureId: ids.waterSourceId };
  if (target.kind === "power_source") return { kind: target.kind, infrastructureId: ids.powerSourceId };
  return target;
}

/** Reuses classification semantics while resolving each field target by its explicit identity. */
function validateFieldDrawingMetadata(field: FieldDesign): void {
  const metadata = field.drawingMetadata;
  const sharedRecords: DrawingMetadataRecord[] = [];
  const targets = new Set<string>();
  const captures = new Set<string>();
  for (const record of metadata?.records ?? []) {
    const target = record.target;
    const key = JSON.stringify([target.kind, "machineId" in target ? target.machineId
      : "infrastructureId" in target ? target.infrastructureId : "id" in target ? target.id : null]);
    if (targets.has(key)) throw new Error("Duplicate field drawing metadata target.");
    if (captures.has(record.capture.captureId)) throw new Error("Duplicate classified capture identity.");
    targets.add(key);
    captures.add(record.capture.captureId);
    if (target.kind === "pivot_center" || target.kind === "water_source" || target.kind === "power_source") {
      const point = target.kind === "pivot_center" ? field.machines.find(machine => machine.id === target.machineId)?.pivotCenter
        : field.infrastructure.find(item => item.id === target.infrastructureId && item.kind === target.kind)?.point;
      if (!point) throw new Error("Field drawing metadata target must resolve to its exact machine or infrastructure kind.");
      validateProjectDrawingMetadata({
        fieldBoundary: [], obstacles: [], pivotCenter: target.kind === "pivot_center" ? point : null,
        waterSource: target.kind === "water_source" ? point : null, powerSource: target.kind === "power_source" ? point : null,
        drawingMetadata: { schemaVersion: PROJECT_DRAWING_METADATA_VERSION, autosaveEnabled: metadata!.autosaveEnabled,
          records: [{ ...record, target: { kind: target.kind } }] },
      });
    } else sharedRecords.push({ ...record, target });
  }
  const sharedMetadata: ProjectDrawingMetadata | undefined = metadata === undefined ? undefined : {
    schemaVersion: PROJECT_DRAWING_METADATA_VERSION, autosaveEnabled: metadata.autosaveEnabled, records: sharedRecords,
  };
  validateProjectDrawingMetadata({ ...field, pivotCenter: null, waterSource: null, powerSource: null, drawingMetadata: sharedMetadata });
}

function unique<T extends { id: string }>(items: T[], name: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.id)) throw new Error(`Duplicate ${name} ID ${item.id}.`);
    result.set(item.id, item);
  }
  return result;
}

function samePoint(left: XY, right: XY): boolean { return left.x === right.x && left.y === right.y; }

function assertDefinedJson(value: unknown): void {
  if (value === undefined) throw new Error("Field JSON cannot retain an undefined value; omit absent optional fields.");
  if (value !== null && typeof value === "object") Object.values(value).forEach(assertDefinedJson);
}

function assertCaptureConsistency(field: FieldDesign): void {
  const captures = new Map<string, { point: XY; evidence: GnssCaptureEvidence }>();
  const check = (point: XY, evidence: GnssCaptureEvidence | null | undefined) => {
    if (!evidence) return;
    const previous = captures.get(evidence.observationId);
    if (previous && (previous.evidence.schemaVersion === "gnss-capture-v1" || evidence.schemaVersion === "gnss-capture-v1")
      && (!samePoint(previous.point, point) || projectDataKey(previous.evidence) !== projectDataKey(evidence))) {
      throw new Error(`Conflicting observation ${evidence.observationId}; explicit repair is required.`);
    }
    captures.set(evidence.observationId, { point, evidence });
  };
  field.fieldBoundary.forEach((point, index) => check(point, field.fieldBoundaryCaptureEvidence?.[index]));
  field.surveyPoints.forEach(point => check(point.projected, point.captureEvidence));
  field.obstacles.forEach(obstacle => obstacle.polygon.forEach((point, index) => check(point, obstacle.vertexCaptureEvidence?.[index])));
  field.mapFeatures?.forEach(feature => {
    const points = feature.geometry.type === "Point" ? [feature.geometry.point]
      : feature.geometry.type === "Circle" ? [feature.geometry.center] : feature.geometry.vertices;
    points.forEach((point, index) => check(point, feature.vertexCaptureEvidence?.[index]));
  });
  const conflict = gnssV2CaptureConflicts(field)[0];
  if (conflict) throw new Error(`${conflict.path.join(".")}: ${conflict.message}`);
}

export function parseFieldDesignDocumentV3(input: string | unknown): FieldDesign {
  const raw = snapshotJsonValue(typeof input === "string" ? parseStrictJson(input) : input, "document");
  refuseOperationalGnssEvidence(raw);
  if (raw && typeof raw === "object" && "documentVersion" in raw && raw.documentVersion === OPERATIONAL_FIELD_DESIGN_DOCUMENT_VERSION) throw new Error("Field version requires an operational-evidence-aware reader.");
  return parseFieldDesignDocument(raw);
}
