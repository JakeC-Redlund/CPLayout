import { z } from "zod";
import { prepareClassifiedDrawing, type DrawingClassification } from "./drawingClassification";
import { createDraftDrawingWorkflow, type DraftDrawingGeometryType, type DraftDrawingVertex } from "./draftDrawingWorkflow";
import { classifiedDrawingFeatureKind, isRecordedReferenceMetadataRecord } from "./drawingMetadata";
import { validateFieldDesign, FieldDrawingMetadataTargetSchema, FIELD_DRAWING_METADATA_VERSION, type FieldDesign, type FieldDrawingMetadataTarget } from "./fieldDesignDocument";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { projectDataKey } from "./projectDataComparison";

export interface ClassifiedFieldDrawingCommand {
  type: "commit_manual_geometry"; fieldId: string; projectCrs: string; expectedRevision: number; captureId: string;
  geometryType: DraftDrawingGeometryType; vertices: DraftDrawingVertex[]; classification: DrawingClassification;
  target: FieldDrawingMetadataTarget; replaceExisting?: boolean;
}
const id = z.string().min(1);
const CommandSchema = z.object({ type: z.literal("commit_manual_geometry"), fieldId: id, projectCrs: id,
  expectedRevision: z.number().int().nonnegative().safe(), captureId: id, geometryType: z.enum(["Point", "LineString", "Polygon"]),
  vertices: z.unknown(), classification: z.unknown(), target: FieldDrawingMetadataTargetSchema, replaceExisting: z.boolean().optional() }).strict();

/** Actual map clicks only, with typed Field targets. No receiver, fabricated Project or inferred machine is involved. */
export function applyClassifiedFieldDrawing(previous: FieldDesign, input: ClassifiedFieldDrawingCommand, editorRevision: number): FieldDesign {
  const command = CommandSchema.parse(snapshotJsonValue(input));
  if (command.fieldId !== previous.id || command.projectCrs !== previous.projectCrs) throw new Error("Drawing belongs to another field or coordinate frame.");
  const workflow = createDraftDrawingWorkflow(); workflow.lockedCrs = previous.projectCrs; workflow.activeCaptureId = command.captureId;
  workflow.captures = [{ id: command.captureId, name: `${command.geometryType} drawing`, projectCrs: previous.projectCrs,
    geometryType: command.geometryType, stage: "classification", source: "map_digitized", vertices: command.vertices as DraftDrawingVertex[],
    classification: { purposeId: null, name: `${command.geometryType} drawing`, notes: "" } }];
  const prepared = prepareClassifiedDrawing({ workflow, projectCrs: previous.projectCrs, captureId: command.captureId,
    editorRevision, expectedEditorRevision: command.expectedRevision, classification: command.classification as DrawingClassification });
  if (previous.drawingMetadata?.records.some(record => !isRecordedReferenceMetadataRecord(record) && record.capture.captureId === command.captureId)) throw new Error("Drawing capture identity is already committed.");
  const next = snapshotJsonValue(previous) as FieldDesign, target = command.target, geometry = prepared.geometry;
  if (target.kind !== prepared.destination && !(target.kind === "map_feature" && prepared.destination === "feature")) throw new Error("Drawing purpose does not match the selected field target.");
  if (target.kind === "map_feature" || target.kind === "obstacle") {
    if ([...next.obstacles, ...(next.mapFeatures ?? []), ...next.surveyPoints].some(item => item.id === target.id)) throw new Error("Choose a fresh field feature identity.");
    if (command.replaceExisting) throw new Error("A new feature cannot replace another saved identity.");
    if (target.kind === "map_feature") next.mapFeatures = [...(next.mapFeatures ?? []), { id: target.id, name: prepared.classification.name,
      notes: prepared.classification.notes, kind: classifiedDrawingFeatureKind(prepared.classification), geometry, confidence: "user_estimated" }];
    else {
      if (geometry.type !== "Polygon" || prepared.classification.effect.mode !== "exclusion") throw new Error("Exclusion needs actual polygon geometry and explicit effects.");
      next.obstacles.push({ id: target.id, name: prepared.classification.name, kind: "exclusion", polygon: geometry.vertices, confidence: "user_estimated",
        bufferMeters: prepared.classification.effect.bufferMeters, hardConflict: prepared.classification.effect.hardConflict, noSpray: prepared.classification.effect.noSpray });
    }
  } else {
    if (!command.replaceExisting) throw new Error("Confirm replacing the saved field boundary or location.");
    if (target.kind === "field_boundary") {
      if (geometry.type !== "Polygon") throw new Error("Field boundary needs a polygon.");
      next.fieldBoundary = geometry.vertices; delete next.fieldBoundaryCaptureEvidence;
    } else {
      if (geometry.type !== "Point") throw new Error("Field location needs one actual map point.");
      if (target.kind === "pivot_center") {
        const machine = next.machines.find(item => item.id === target.machineId);
        if (!machine) throw new Error("Select the actual pivot machine before drawing its center.");
        machine.pivotCenter = geometry.point; delete machine.pivotObservationId;
      } else {
        const infrastructure = next.infrastructure.find(item => item.id === target.infrastructureId && item.kind === target.kind);
        if (!infrastructure) throw new Error("Select the actual infrastructure point before replacing it.");
        infrastructure.point = geometry.point; delete infrastructure.observationId;
      }
    }
  }
  next.drawingMetadata ??= { schemaVersion: FIELD_DRAWING_METADATA_VERSION, autosaveEnabled: true, records: [] };
  next.drawingMetadata.records = [...next.drawingMetadata.records.filter(record => projectDataKey(record.target) !== projectDataKey(target)), {
    target, classification: prepared.classification, capture: { captureId: prepared.captureId, source: "map_digitized", vertexRecordedAt: prepared.vertices.map(vertex => vertex.recordedAt), wgs84: null, elevation: null } }];
  return validateFieldDesign(next);
}
