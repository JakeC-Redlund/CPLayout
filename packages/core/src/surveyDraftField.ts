import { parseDesignDraftDocument } from "./designDraft";
import { validateFieldDesign, projectTargetToField, FIELD_DRAWING_METADATA_VERSION, FIELD_DRAWING_METADATA_V2_VERSION, type FieldDesign } from "./fieldDesignDocument";
import { seedRecordedReferenceOrigins, isRecordedReferenceMetadataRecord, retireRecordedReferenceAttachment, PROJECT_DRAWING_METADATA_V2_VERSION } from "./drawingMetadata";

/** Uses only supplied geometry and configuration. No planning calculation,
 * inferred infrastructure, machine defaults, or inherited Survey completion. */
export function convertSurveyDraftToField(originalDraftDocument: string, identities: { fieldId: string; waterSourceId: string; powerSourceId: string }): { field: FieldDesign; originalDraftDocument: string } {
  if (typeof originalDraftDocument !== "string" || !identities.fieldId || !identities.waterSourceId || !identities.powerSourceId) throw new Error("Prepare field requires its exact saved source and fresh identities.");
  const draft = seedRecordedReferenceOrigins(parseDesignDraftDocument(originalDraftDocument));
  if (draft.id === identities.fieldId) throw new Error("Prepared field requires a fresh identity.");
  if (draft.projectCrs === null) throw new Error("Choose the actual field coordinate system before preparing Layout.");
  if (draft.drawingWorkflow?.captures.length) throw new Error("Finish or discard pending drawings before preparing the surveyed field.");
  const { pivotCenter, waterSource, powerSource, infrastructureObservationRefs, machine, wgs84Companion: _companion, drawingWorkflow: _workflow, drawingMetadata, ...shared } = draft;
  const hasMachine = Object.keys(machine).length > 0 || pivotCenter !== null;
  if (hasMachine && (!machine.id || pivotCenter === null)) throw new Error("Supply the machine information and collect its pivot center before preparing this field. Partial entries remain in the original work.");
  const { id: machineId, ...configuration } = machine;
  const infrastructure = [
    ...(waterSource === null ? [] : [{ id: identities.waterSourceId, kind: "water_source" as const, point: waterSource, ...(infrastructureObservationRefs?.water_source ? { observationId: infrastructureObservationRefs.water_source } : {}) }]),
    ...(powerSource === null ? [] : [{ id: identities.powerSourceId, kind: "power_source" as const, point: powerSource, ...(infrastructureObservationRefs?.power_source ? { observationId: infrastructureObservationRefs.power_source } : {}) }]),
  ];
  try {
    const field = validateFieldDesign({ ...shared, id: identities.fieldId,
      infrastructure, machines: hasMachine ? [{ id: machineId, kind: "center_pivot", configuration, pivotCenter,
        ...(waterSource === null ? {} : { waterSourceId: identities.waterSourceId }), ...(powerSource === null ? {} : { powerSourceId: identities.powerSourceId }),
        ...(infrastructureObservationRefs?.pivot_center ? { pivotObservationId: infrastructureObservationRefs.pivot_center } : {}) }] : [],
      ...(drawingMetadata === undefined ? {} : { drawingMetadata: { ...drawingMetadata,
        schemaVersion: drawingMetadata.schemaVersion === PROJECT_DRAWING_METADATA_V2_VERSION ? FIELD_DRAWING_METADATA_V2_VERSION : FIELD_DRAWING_METADATA_VERSION,
        records: drawingMetadata.records.map(record => isRecordedReferenceMetadataRecord(record) ? retireRecordedReferenceAttachment(record) : { ...record, target: projectTargetToField(record.target, machineId ?? "", identities) }) } }),
    });
    return { field, originalDraftDocument };
  } catch (error) { throw new Error("Supply a saved boundary with at least three positions and complete supplied machine values before preparing the field. Unknown water and power locations can remain unspecified."); }
}
