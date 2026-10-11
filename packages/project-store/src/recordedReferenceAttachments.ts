import {
  assertRecordedReferenceHistory, isRecordedReferenceMetadataRecord,
  remapRecordedReferenceAttachment, retireRecordedReferenceAttachment,
  seedRecordedReferenceOrigins, type RecordedReferenceOrigin,
  type DesignDraft, type FieldDesign, type PivotProject,
} from "@cplayout/core";
import type { SurveyCollection } from "../../core/src/surveyCollection";
import { projectDataKey } from "../../core/src/projectDataComparison";

type DesignPayload = PivotProject | DesignDraft | FieldDesign;

/** Only current locators change. Origins, ordered observations and receipts remain exact. */
export function mapRecordedReferenceAttachments<T extends DesignPayload>(payload: T,
  mappings?: readonly { sourceCollectionId: string; collectionId: string }[]): T {
  const admitted = seedRecordedReferenceOrigins(payload);
  if (!admitted.drawingMetadata) return admitted;
  const records = admitted.drawingMetadata.records.map(record => !isRecordedReferenceMetadataRecord(record) ? record
    : mappings === undefined ? retireRecordedReferenceAttachment(record) : remapRecordedReferenceAttachment(record, mappings));
  return { ...admitted, drawingMetadata: { ...admitted.drawingMetadata, records } } as T;
}

/** A missing/retyped metadata record is not deletion while its canonical feature survives. */
export function assertSurvivingRecordedReferenceHistory(before: DesignPayload, after: DesignPayload): void {
  const survivors = (before.drawingMetadata?.records ?? []).filter(isRecordedReferenceMetadataRecord)
    .filter(record => after.mapFeatures?.some(feature => feature.id === record.target.id));
  const records = after.drawingMetadata?.records ?? [];
  for (const previous of survivors) {
    if (!records.some(record => record.target.kind === "map_feature" && record.target.id === previous.target.id)) {
      throw new Error("A surviving recorded reference must retain its immutable origin and snapshots.");
    }
  }
  assertRecordedReferenceHistory(survivors, records);
}

function retainedOrigins(payload: DesignPayload): RecordedReferenceOrigin[] {
  const metadata = payload.drawingMetadata;
  return metadata && "retainedReferenceOrigins" in metadata ? metadata.retainedReferenceOrigins ?? [] : [];
}
function ledgerAuthorizesOrigin(origin: RecordedReferenceOrigin, collections: SurveyCollection[]): boolean {
  return collections.some(collection => {
    if (collection.id !== origin.collectionId || projectDataKey(collection.owner) !== projectDataKey(origin.owner)
      || collection.state !== "applied" || collection.revision < 1 || origin.sourceCollectionRevision !== collection.revision - 1
      || projectDataKey(collection.purpose) !== projectDataKey(origin.purpose)) return false;
    const receipts = collection.applications.filter(receipt => receipt.id === origin.receipt.id);
    if (receipts.length !== 1 || collection.applications.at(-1)?.id !== origin.receipt.id || projectDataKey(receipts[0]) !== projectDataKey(origin.receipt)) return false;
    const points = new Map(collection.observations.map(point => [point.id, point]));
    const observations = origin.receipt.sourcePointIds.map(id => points.get(id));
    return observations.every(point => point !== undefined) && projectDataKey(observations as object[]) === projectDataKey(origin.observations);
  });
}
/** Ordinary Save preserves accumulated authority exactly; only an exact new owned application can add it. */
export function assertRetainedReferenceAuthority(before: DesignPayload, after: DesignPayload, collections: SurveyCollection[]): void {
  // Current validated records are already admitted evidence. This detached view
  // also protects earlier unpublished v2 owners before their explicit seeded save.
  const previous = retainedOrigins(seedRecordedReferenceOrigins(before)), next = retainedOrigins(after);
  if (previous.some((origin, index) => !next[index] || projectDataKey(origin) !== projectDataKey(next[index]))) {
    throw new Error("A save cannot omit, reorder, retype or rewrite retained recorded reference authority.");
  }
  for (const origin of next.slice(previous.length)) {
    if (!ledgerAuthorizesOrigin(origin, collections)) throw new Error("A save cannot invent retained reference authority without its exact current owned Survey application.");
  }
}
/** Undo/Redo restore an exact prior retained origin or an exact newly admitted owned application. */
export function assertNewRecordedReferenceHistory(before: DesignPayload, after: DesignPayload, collections: SurveyCollection[]): void {
  assertRetainedReferenceAuthority(before, after, collections);
  const previous = (before.drawingMetadata?.records ?? []).filter(isRecordedReferenceMetadataRecord);
  const authority = retainedOrigins(seedRecordedReferenceOrigins(before));
  for (const record of (after.drawingMetadata?.records ?? []).filter(isRecordedReferenceMetadataRecord)) {
    if (previous.some(item => item.target.id === record.target.id)) continue;
    if (authority.some(origin => projectDataKey(origin) === projectDataKey(record.capture.origin))) continue;
    if (!ledgerAuthorizesOrigin(record.capture.origin, collections)) throw new Error("A save or Undo cannot invent recorded reference history outside prior retained authority or the exact owner's Survey ledger.");
  }
}

/** Capability detection includes historical provenance even without operational fixed-GGA. */
export function hasRecordedReferenceEvidence(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if ("schemaVersion" in value && ["project-drawing-metadata-v2", "field-drawing-metadata-v2"].includes(value.schemaVersion as string)) return true;
  if ("capture" in value && value.capture !== null && typeof value.capture === "object"
    && "source" in value.capture && value.capture.source === "recorded_survey") return true;
  return Object.values(value).some(hasRecordedReferenceEvidence);
}
