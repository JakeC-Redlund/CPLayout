import type { FieldDesign } from "../../core/src/fieldDesignDocument";
import type { PivotProject } from "../../core/src/types";
import { z } from "zod";
import { parseSurveyReview } from "../../core/src/surveyReview";
import { parseSurveyCollectionDocument } from "../../core/src/surveyCollection";
import { readSurveyDesignDocument } from "../../core/src/surveyCollectionApplication";
import { snapshotJsonValue } from "../../core/src/jsonDataSnapshot";
import { projectDataKey } from "../../core/src/projectDataComparison";
import { sha256Text } from "../../core/src/sha256";
import { convertSurveyDraftToField } from "../../core/src/surveyDraftField";

const id = z.string().min(1), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const WorkflowWorkItemSchema = z.object({ designId: id, initialMode: z.enum(["design", "survey"]),
  siteDescription: z.string().optional(), locator: z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict().optional() }).strict();
const sourceSchema = z.object({ designId: id, kind: z.enum(["draft", "project", "field"]), payloadId: id, fieldMapId: id,
  revision: z.number().int().nonnegative().safe().nullable(), document: z.string().min(1), sha256: hash }).strict();
export const WorkflowConversionSchema = z.object({ id, createdAt: z.iso.datetime({ offset: true }), source: sourceSchema, destination: sourceSchema,
  collectionMappings: z.array(z.object({ sourceId: id, destinationId: id, sourceDocument: z.string().min(1), destinationDocument: z.string().min(1) }).strict()),
  sourceReviews: z.array(z.string().min(1)), qualification: z.literal("lossless_identity_conversion") }).strict();
export type WorkflowConversion = z.infer<typeof WorkflowConversionSchema>;
export function validateWorkflowConversion(input: unknown): WorkflowConversion {
  const raw = snapshotJsonValue(input), conversion = WorkflowConversionSchema.parse(raw);
  if (projectDataKey(raw as object) !== projectDataKey(conversion)) throw new Error("Conversion cannot strip or normalize original source snapshots.");
  const source = readSurveyDesignDocument(conversion.source.kind, conversion.source.document);
  const destination = readSurveyDesignDocument(conversion.destination.kind, conversion.destination.document);
  for (const entry of [conversion.source, conversion.destination]) {
    if (sha256Text(entry.document) !== entry.sha256 || readSurveyDesignDocument(entry.kind, entry.document).id !== entry.payloadId) throw new Error("Conversion source/destination identity or hash differs from its exact document.");
  }
  if (conversion.source.designId === conversion.destination.designId || source.projectCrs !== destination.projectCrs
    || projectDataKey(source.surveyPoints) !== projectDataKey(destination.surveyPoints)
    || projectDataKey(source.fieldBoundary) !== projectDataKey(destination.fieldBoundary)
    || projectDataKey(source.fieldBoundaryCaptureEvidence ?? []) !== projectDataKey(destination.fieldBoundaryCaptureEvidence ?? [])) throw new Error("Conversion must retain actual coordinates and complete observation evidence under a fresh owner.");
  for (const key of ["obstacles", "mapFeatures", "mapPackages", "settings", "unitSystem"] as const) {
    if (projectDataKey({ value: source[key] ?? null }) !== projectDataKey({ value: destination[key] ?? null })) throw new Error(`Conversion cannot discard or alter retained ${key} source data.`);
  }
  const sameKind = conversion.source.kind === conversion.destination.kind;
  if (!sameKind && !(conversion.source.kind === "draft" && conversion.destination.kind === "project")
    && !(conversion.source.kind === "draft" && conversion.destination.kind === "field")
    && !(conversion.source.kind === "project" && conversion.destination.kind === "field")) throw new Error("Unsupported conversion lineage must remain an original file, not a qualified identity conversion.");
  if ("machine" in source && "machine" in destination) {
    for (const [key, value] of Object.entries(source.machine)) if (projectDataKey({ value }) !== projectDataKey({ value: (destination.machine as unknown as Record<string, unknown>)[key] ?? null })) throw new Error("Conversion cannot change supplied machine configuration.");
    for (const key of ["pivotCenter", "waterSource", "powerSource"] as const) if (projectDataKey({ value: source[key] }) !== projectDataKey({ value: destination[key] })) throw new Error("Conversion cannot move supplied machine or infrastructure locations.");
  } else if (conversion.source.kind === "field" && conversion.destination.kind === "field") {
    const a = source as FieldDesign, b = destination as FieldDesign;
    for (const key of ["machines", "lateralMachines", "infrastructure"] as const) if (projectDataKey({ value: a[key] ?? null }) !== projectDataKey({ value: b[key] ?? null })) throw new Error("Copy cannot change independent machine or infrastructure configuration.");
  } else if (conversion.source.kind === "draft" && conversion.destination.kind === "field") {
    const b = destination as FieldDesign;
    const expected = convertSurveyDraftToField(conversion.source.document, { fieldId: b.id,
      waterSourceId: b.infrastructure.find(point => point.kind === "water_source")?.id ?? "unused-water-source",
      powerSourceId: b.infrastructure.find(point => point.kind === "power_source")?.id ?? "unused-power-source" }).field;
    if (projectDataKey({ ...expected, name: b.name }) !== projectDataKey(b)) throw new Error("Survey preparation cannot change or invent supplied machine, geometry or infrastructure information.");
  } else if (conversion.source.kind === "project" && conversion.destination.kind === "field") {
    const a = source as PivotProject, b = destination as FieldDesign;
    const machine = b.machines.find(item => item.id === a.machine.id);
    if (!machine || projectDataKey(machine.pivotCenter) !== projectDataKey(a.pivotCenter)
      || projectDataKey({ id: machine.id, ...machine.configuration }) !== projectDataKey(a.machine)) throw new Error("Project to Field must retain its actual machine configuration and pivot coordinates.");
    for (const key of ["water_source", "power_source"] as const) {
      const point = b.infrastructure.find(item => item.kind === key);
      if (!point || projectDataKey(point.point) !== projectDataKey(a[key === "water_source" ? "waterSource" : "powerSource"])) throw new Error("Project to Field must retain actual infrastructure coordinates.");
    }
  }
  const sourceIds = new Set<string>(), destinationIds = new Set<string>();
  for (const mapping of conversion.collectionMappings) {
    const a = parseSurveyCollectionDocument(mapping.sourceDocument), b = parseSurveyCollectionDocument(mapping.destinationDocument);
    if (sourceIds.has(a.id) || destinationIds.has(b.id) || a.id !== mapping.sourceId || b.id !== mapping.destinationId || a.id === b.id
      || a.owner.designId !== conversion.source.designId || b.owner.designId !== conversion.destination.designId
      || a.owner.payloadId !== conversion.source.payloadId || b.owner.payloadId !== conversion.destination.payloadId
      || a.owner.documentKind !== conversion.source.kind || b.owner.documentKind !== conversion.destination.kind
      || a.owner.fieldMapId !== conversion.source.fieldMapId || b.owner.fieldMapId !== conversion.destination.fieldMapId
      || a.owner.projectCrs !== b.owner.projectCrs) throw new Error("Conversion collection mappings must resolve exact fresh source and destination ownership.");
    const body = (collection: typeof a) => ({ purpose: collection.purpose, observations: collection.observations, activePointIds: collection.activePointIds,
      applications: collection.applications, state: collection.state, createdAt: collection.createdAt, updatedAt: collection.updatedAt });
    if (projectDataKey(body(a)) !== projectDataKey(body(b))) throw new Error("Conversion cannot rewrite receiver observations, membership or application history.");
    sourceIds.add(a.id); destinationIds.add(b.id);
  }
  for (const document of conversion.sourceReviews) {
    const review = parseSurveyReview(document);
    if (review.owner.designId !== conversion.source.designId || review.owner.payloadId !== conversion.source.payloadId) throw new Error("Conversion review belongs to another source.");
  }
  return conversion;
}
