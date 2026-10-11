import { z } from "zod";
import { prepareClassifiedDrawing, type DrawingClassification } from "./drawingClassification";
import { createDraftDrawingWorkflow, type DraftDrawingGeometryType, type DraftDrawingVertex } from "./draftDrawingWorkflow";
import { isRecordedReferenceMetadataRecord, classifiedDrawingFeatureKind, drawingMetadataTargetKey, PROJECT_DRAWING_METADATA_VERSION, type DrawingMetadataTarget } from "./drawingMetadata";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { serializeProjectDocument } from "./projectDocument";
import type { PivotProject } from "./types";

export interface ClassifiedProjectDrawingCommand {
  type: "commit_classified_drawing";
  projectId: string;
  projectCrs: string;
  expectedRevision: number;
  captureId: string;
  geometryType: DraftDrawingGeometryType;
  /** Actual ordered map clicks; receiver evidence is a separate admission path. */
  vertices: DraftDrawingVertex[];
  classification: DrawingClassification;
  entityId?: string;
  replaceExisting?: boolean;
}
const id = z.string().min(1);
const CommandSchema = z.object({ type: z.literal("commit_classified_drawing"), projectId: id, projectCrs: id,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1), captureId: id,
  geometryType: z.enum(["Point", "LineString", "Polygon"]), vertices: z.unknown(), classification: z.unknown(),
  entityId: id.optional(), replaceExisting: z.boolean().optional(),
}).strict();

/** Uses the existing capture contract without creating a DesignDraft or completed Project. */
export function prepareClassifiedProjectDrawing(project: PivotProject, input: ClassifiedProjectDrawingCommand, editorRevision: number) {
  const command = CommandSchema.parse(snapshotJsonValue(input, "Project drawing command"));
  if (command.projectId !== project.id || command.projectCrs !== project.projectCrs) throw new Error("The drawing belongs to another Project or coordinate frame.");
  const workflow = createDraftDrawingWorkflow();
  workflow.autosaveEnabled = project.drawingMetadata?.autosaveEnabled ?? workflow.autosaveEnabled;
  workflow.lockedCrs = project.projectCrs;
  workflow.activeCaptureId = command.captureId;
  workflow.captures = [{ id: command.captureId, name: `${command.geometryType} drawing`, projectCrs: command.projectCrs,
    geometryType: command.geometryType, stage: "classification", source: "map_digitized", vertices: command.vertices as DraftDrawingVertex[],
    classification: { purposeId: null, name: `${command.geometryType} drawing`, notes: "" } }];
  return { command, prepared: prepareClassifiedDrawing({ workflow, projectCrs: project.projectCrs, captureId: command.captureId,
    editorRevision, expectedEditorRevision: command.expectedRevision, classification: command.classification as DrawingClassification }) };
}

/** One detached proposal: canonical geometry and its typed metadata are validated together. */
export function applyClassifiedProjectDrawing(previous: PivotProject, input: ClassifiedProjectDrawingCommand, editorRevision: number): PivotProject {
  const { command, prepared } = prepareClassifiedProjectDrawing(previous, input, editorRevision);
  if (previous.drawingMetadata?.records.some(record => !isRecordedReferenceMetadataRecord(record) && record.capture.captureId === prepared.captureId)) throw new Error("This capture identity already belongs to committed geometry.");
  const next = snapshotJsonValue(previous, "Project drawing source") as PivotProject;
  const geometry = prepared.geometry, classification = prepared.classification;
  let target: DrawingMetadataTarget;
  if (prepared.destination === "feature" || prepared.destination === "obstacle") {
    if (!command.entityId) throw new Error("Choose a new identity for the classified geometry.");
    if (command.replaceExisting) throw new Error("Classification cannot replace a separate feature or obstacle.");
    if ([...(next.mapFeatures ?? []), ...next.obstacles, ...next.surveyPoints].some(item => item.id === command.entityId)) throw new Error("Classified geometry identity already exists in this Project.");
    if (prepared.destination === "feature") {
      target = { kind: "map_feature", id: command.entityId };
      next.mapFeatures = [...(next.mapFeatures ?? []), { id: command.entityId, name: classification.name, notes: classification.notes,
        kind: classifiedDrawingFeatureKind(classification), geometry, confidence: "user_estimated" }];
    } else {
      if (geometry.type !== "Polygon" || classification.effect.mode !== "exclusion") throw new Error("Exclusions require a polygon and explicit effects.");
      target = { kind: "obstacle", id: command.entityId };
      next.obstacles.push({ id: command.entityId, name: classification.name, kind: "exclusion", polygon: geometry.vertices,
        confidence: "user_estimated", noSpray: classification.effect.noSpray, hardConflict: classification.effect.hardConflict, bufferMeters: classification.effect.bufferMeters });
    }
  } else {
    if (command.entityId !== undefined) throw new Error("Operational geometry uses its canonical target, not a duplicate entity identity.");
    if (!command.replaceExisting) throw new Error("Explicitly confirm replacing the saved Project location or boundary.");
    target = { kind: prepared.destination };
    if (prepared.destination === "field_boundary") {
      if (geometry.type !== "Polygon") throw new Error("Field boundary requires a polygon.");
      next.fieldBoundary = geometry.vertices;
      delete next.fieldBoundaryCaptureEvidence;
    } else {
      if (geometry.type !== "Point") throw new Error("Infrastructure requires a point.");
      const property = prepared.destination === "pivot_center" ? "pivotCenter" : prepared.destination === "water_source" ? "waterSource" : "powerSource";
      next[property] = geometry.point;
      if (next.infrastructureObservationRefs) delete next.infrastructureObservationRefs[prepared.destination];
    }
  }
  next.drawingMetadata ??= { schemaVersion: PROJECT_DRAWING_METADATA_VERSION, autosaveEnabled: true, records: [] };
  const key = drawingMetadataTargetKey(target);
  next.drawingMetadata.records = [...next.drawingMetadata.records.filter(record => drawingMetadataTargetKey(record.target) !== key), {
    target, classification, capture: { captureId: prepared.captureId, source: "map_digitized", vertexRecordedAt: prepared.vertices.map(vertex => vertex.recordedAt), wgs84: null, elevation: null },
  }];
  // Current serializer chooses v2 for metadata, or v3 when genuine operational evidence exists.
  // It also rejects unknown fields before a reducer parse could strip them.
  serializeProjectDocument(next);
  return next;
}
