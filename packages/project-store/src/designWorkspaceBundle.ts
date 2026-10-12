import { WorkflowConversionSchema, validateWorkflowConversion } from "./productionWorkflowSchemas";
import { parseSurveyReview } from "../../core/src/surveyReview";
import { strToU8, zipSync } from "fflate";
import { z } from "zod";
import { snapshotJsonValue } from "../../core/src/jsonDataSnapshot";
import { projectDataKey } from "../../core/src/projectDataComparison";
import { sha256Text } from "../../core/src/sha256";
import { parseSurveyCollectionDocument } from "../../core/src/surveyCollection";
import { readSurveyDesignDocument, assertRecordedReferenceAttachments } from "../../core/src/surveyCollectionApplication";
import { parseProjectDocument } from "../../core/src/projectDocument";
import { gnssV2CaptureConflicts } from "../../core/src/gnssEvidence";
import { operationalObservationPayloads } from "../../core/src/operationalGnssEvidence";
import { parseStrictJson } from "./strictJson";
import { readZipArchive } from "./zipArchive";
import { decodeUtf8Strict } from "./utf8";
import { validateWorkspaceDocument, workspaceDesignSource, assertSurveyHistoricalPayloads, type WorkspaceDocument } from "./workspaceDocument";

export const DESIGN_WORKSPACE_BUNDLE_VERSION = "cplayout-design-workspace-bundle-v1";
export const REVIEWED_DESIGN_WORKSPACE_BUNDLE_VERSION = "cplayout-design-workspace-bundle-v2";
const BundleSchema = z.object({
  bundleVersion: z.enum([DESIGN_WORKSPACE_BUNDLE_VERSION, REVIEWED_DESIGN_WORKSPACE_BUNDLE_VERSION]), designId: z.string().min(1),
  documentKind: z.enum(["draft", "project", "field"]), payloadId: z.string().min(1), fieldMapId: z.string().min(1),
  designRevision: z.number().int().nonnegative().safe().optional(),
  designDocument: z.string().min(1), surveyDocuments: z.array(z.string().min(1)).max(1024),
  originalProjectDocument: z.string().optional(),
  workflowSources: z.object({ reviews: z.array(z.string().min(1)), conversions: z.array(WorkflowConversionSchema), importedBundles: z.array(z.string().min(1)) }).strict().optional(),
  inventory: z.array(z.object({ filename: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(1027),
}).strict();
export type DesignWorkspaceBundle = z.infer<typeof BundleSchema>;
export function buildDesignWorkspaceBundle(workspace: WorkspaceDocument, designId: string): DesignWorkspaceBundle {
  const current = validateWorkspaceDocument(workspace), source = workspaceDesignSource(current, designId);
  const production = current.workspaceVersion === "cplayout-workspace-v5";
  const ancestors = new Set([designId]);
  let changed = true;
  while (changed) { changed = false; for (const conversion of current.workflowConversions ?? []) if (ancestors.has(conversion.destination.designId) && !ancestors.has(conversion.source.designId)) { ancestors.add(conversion.source.designId); changed = true; } }
  const body = { bundleVersion: production ? REVIEWED_DESIGN_WORKSPACE_BUNDLE_VERSION : DESIGN_WORKSPACE_BUNDLE_VERSION, designId, documentKind: source.kind,
    payloadId: source.payloadId, fieldMapId: source.design.fieldMapId, designDocument: source.document,
    surveyDocuments: (current.surveyCollections ?? []).filter(entry => parseSurveyCollectionDocument(entry.document).owner.designId === designId).map(entry => entry.document),
    ...(source.originalProjectDocument === undefined ? {} : { originalProjectDocument: source.originalProjectDocument }),
    ...(production ? { designRevision: source.design.revision, workflowSources: { reviews: (current.surveyReviews ?? []).filter(entry => parseSurveyReview(entry.document).owner.designId === designId).map(entry => entry.document),
      conversions: (current.workflowConversions ?? []).filter(entry => ancestors.has(entry.destination.designId)),
      importedBundles: (current.workflowBundleArchives ?? []).filter(entry => entry.designId === designId).map(entry => entry.document) } } : {}) };
  return parseDesignWorkspaceBundle({ ...body, inventory: inventory(body) });
}
export function parseDesignWorkspaceBundle(input: string | unknown, depth = 0): DesignWorkspaceBundle {
  if (depth > 16) throw new Error("Workflow source ancestry exceeds the bounded import depth; preserve the original file.");
  const snapshot = snapshotJsonValue(typeof input === "string" ? parseStrictJson(input) : input, "Design workspace bundle");
  const parsed = BundleSchema.parse(snapshot);
  if (projectDataKey(snapshot as object) !== projectDataKey(parsed)) throw new Error("Bundle contains unsupported or normalized data.");
  const bundle = snapshot as DesignWorkspaceBundle;
  if ((bundle.bundleVersion === REVIEWED_DESIGN_WORKSPACE_BUNDLE_VERSION) !== (bundle.workflowSources !== undefined && bundle.designRevision !== undefined) || (bundle.bundleVersion === DESIGN_WORKSPACE_BUNDLE_VERSION && bundle.designRevision !== undefined)) throw new Error("Workflow bundles must retain every review and conversion source explicitly; old bundles cannot contain them.");
  if (bundle.workflowSources) {
    const reviewIds = new Set<string>();
    for (const document of bundle.workflowSources.reviews) {
      const review = parseSurveyReview(document);
      if (reviewIds.has(review.id) || review.owner.designId !== bundle.designId || review.owner.payloadId !== bundle.payloadId || review.owner.documentKind !== bundle.documentKind || review.owner.fieldMapId !== bundle.fieldMapId) throw new Error("Bundled review has duplicate or foreign ownership.");
      reviewIds.add(review.id);
    }
    const ancestorIds = new Set([bundle.designId]), conversions = bundle.workflowSources.conversions.map(validateWorkflowConversion);
    let changed = true;
    while (changed) { changed = false; for (const conversion of conversions) if (ancestorIds.has(conversion.destination.designId) && !ancestorIds.has(conversion.source.designId)) { ancestorIds.add(conversion.source.designId); changed = true; } }
    if (new Set(conversions.map(entry => entry.id)).size !== conversions.length || conversions.some(entry => !ancestorIds.has(entry.destination.designId))) throw new Error("Bundle contains unrelated or duplicate conversion lineage.");
    for (const document of bundle.workflowSources.importedBundles) parseDesignWorkspaceBundle(document, depth + 1);
  }
  // Exchange/view is read-only. Unknown retained project fields must not be
  // discarded or made unreadable; command mutation admission remains strict.
  const design = bundle.documentKind === "project" ? parseProjectDocument(bundle.designDocument) : readSurveyDesignDocument(bundle.documentKind, bundle.designDocument);
  if (design.id !== bundle.payloadId) throw new Error("Bundle design payload identity differs from its document.");
  if (bundle.originalProjectDocument !== undefined) {
    if (bundle.documentKind !== "field") throw new Error("Original project provenance belongs to field documents.");
    parseProjectDocument(bundle.originalProjectDocument);
  }
  const ids = new Set<string>();
  const observations = [...design.surveyPoints];
  const collections = bundle.surveyDocuments.map(document => parseSurveyCollectionDocument(document));
  const payloads = operationalObservationPayloads(design);
  for (const document of bundle.surveyDocuments) {
    const collection = parseSurveyCollectionDocument(document);
    if (ids.has(collection.id)) throw new Error("Duplicate bundled Survey collection.");
    ids.add(collection.id);
    if (collection.owner.designId !== bundle.designId || collection.owner.documentKind !== bundle.documentKind || collection.owner.payloadId !== bundle.payloadId
      || collection.owner.fieldMapId !== bundle.fieldMapId || collection.owner.projectCrs !== design.projectCrs) throw new Error("Bundled Survey has foreign document/catalog/CRS ownership.");
    observations.push(...collection.observations);
    operationalObservationPayloads(collection, payloads);
  }
  collectWorkflowObservationPayloads(bundle, payloads, depth);
  const conflict = gnssV2CaptureConflicts({ projectCrs: design.projectCrs, fieldBoundary: [], obstacles: [], surveyPoints: observations })[0];
  if (conflict) throw new Error(conflict.message);
  assertSurveyHistoricalPayloads(observations);
  if (design.projectCrs !== null) assertRecordedReferenceAttachments(design.drawingMetadata?.records ?? [], collections, {
    designId: bundle.designId, documentKind: bundle.documentKind, payloadId: bundle.payloadId,
    fieldMapId: bundle.fieldMapId, projectCrs: design.projectCrs,
  });
  if (projectDataKey(bundle.inventory) !== projectDataKey(inventory(bundle))) throw new Error("Bundle inventory/hash is incomplete or corrupted.");
  contentFiles(bundle); // Enforce bounded exact text before accepting JSON or ZIP.
  return bundle;
}
export function serializeDesignWorkspaceBundle(bundle: DesignWorkspaceBundle): string { return JSON.stringify(parseDesignWorkspaceBundle(bundle)); }
export function exportDesignWorkspaceBundleZip(bundle: DesignWorkspaceBundle): Uint8Array {
  const checked = parseDesignWorkspaceBundle(bundle);
  const files = { ...contentFiles(checked), "bundle.json": serializeDesignWorkspaceBundle(checked) };
  const encoded = Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)]));
  const sizes = Object.values(encoded).map(value => value.byteLength);
  if (sizes.some(size => size > 16 * 1024 * 1024) || sizes.reduce((sum, size) => sum + size, 0) > 32 * 1024 * 1024) throw new Error("Workspace ZIP including its manifest exceeds the import byte budget.");
  const bytes = zipSync(encoded, { mtime: new Date("2026-01-01T00:00:00Z") });
  if (bytes.length > 16 * 1024 * 1024) throw new Error("Design workspace ZIP exceeds its compressed budget.");
  return bytes;
}
export function importDesignWorkspaceBundleZip(bytes: Uint8Array): DesignWorkspaceBundle {
  const raw = readZipArchive(bytes, { label: "Design workspace bundle", maxCompressedBytes: 16 * 1024 * 1024,
    maxEntryBytes: 16 * 1024 * 1024, maxUncompressedBytes: 32 * 1024 * 1024, maxFileCount: 1028, requiredFilenames: ["bundle.json", "design.json"],
    validateEntries: names => { if (names.some(name => !/^(bundle|design|original-project|workflow)\.json$|^survey-\d+\.json$/.test(name))) throw new Error("Unsupported workspace bundle file."); } });
  const files = new Map([...raw].map(([name, data]) => [name, decodeUtf8Strict(data, "Design workspace bundle")]));
  const bundle = parseDesignWorkspaceBundle(files.get("bundle.json")!);
  const expected = { ...contentFiles(bundle), "bundle.json": files.get("bundle.json")! };
  if (files.size !== Object.keys(expected).length || Object.entries(expected).some(([name, text]) => files.get(name) !== text)) throw new Error("Workspace ZIP is missing, foreign or differs from its complete bundle.");
  return bundle;
}
function contentFiles(bundle: Pick<DesignWorkspaceBundle, "designDocument" | "surveyDocuments" | "originalProjectDocument" | "workflowSources">): Record<string, string> {
  const files: Record<string, string> = { "design.json": bundle.designDocument };
  bundle.surveyDocuments.forEach((document, index) => { files[`survey-${index}.json`] = document; });
  if (bundle.originalProjectDocument !== undefined) files["original-project.json"] = bundle.originalProjectDocument;
  if (bundle.workflowSources !== undefined) files["workflow.json"] = JSON.stringify(bundle.workflowSources);
  let total = 0;
  for (const value of Object.values(files)) {
    const encoded = strToU8(value);
    if (decodeUtf8Strict(encoded, "Bundle") !== value) throw new Error("Bundle text cannot round-trip exact UTF-8.");
    if (encoded.length > 8 * 1024 * 1024) throw new Error("Bundle entry exceeds its byte budget.");
    total += encoded.length;
  }
  if (total > 16 * 1024 * 1024) throw new Error("Bundle contents exceed their byte budget.");
  return files;
}
function inventory(bundle: Pick<DesignWorkspaceBundle, "designDocument" | "surveyDocuments" | "originalProjectDocument" | "workflowSources">) {
  return Object.entries(contentFiles(bundle)).map(([filename, text]) => ({ filename, sha256: sha256Text(text) }));
}

/** Retained review and conversion snapshots share the same immutable receiver identity namespace. */
export function designBundleOperationalObservationPayloads(bundle: DesignWorkspaceBundle, result = new Map<string, string>()): Map<string, string> {
  operationalObservationPayloads(parseStrictJson(bundle.designDocument), result);
  for (const document of bundle.surveyDocuments) operationalObservationPayloads(parseStrictJson(document), result);
  collectWorkflowObservationPayloads(bundle, result, 0);
  return result;
}
function collectWorkflowObservationPayloads(bundle: DesignWorkspaceBundle, result: Map<string, string>, depth: number): void {
  if (depth > 16) throw new Error("Workflow observation ancestry exceeds its bounded depth.");
  const reviews = [...(bundle.workflowSources?.reviews ?? []), ...(bundle.workflowSources?.conversions ?? []).flatMap(entry => entry.sourceReviews)];
  for (const document of reviews) {
    const review = parseSurveyReview(document);
    for (const source of [review.sourceDocument, ...review.collections.map(entry => entry.document)]) operationalObservationPayloads(parseStrictJson(source), result);
  }
  for (const conversion of bundle.workflowSources?.conversions ?? []) {
    for (const document of [conversion.source.document, conversion.destination.document, ...conversion.collectionMappings.flatMap(entry => [entry.sourceDocument, entry.destinationDocument])]) operationalObservationPayloads(parseStrictJson(document), result);
  }
  for (const document of bundle.workflowSources?.importedBundles ?? []) {
    const imported = parseDesignWorkspaceBundle(document, depth + 1);
    operationalObservationPayloads(parseStrictJson(imported.designDocument), result);
    for (const source of imported.surveyDocuments) operationalObservationPayloads(parseStrictJson(source), result);
    collectWorkflowObservationPayloads(imported, result, depth + 1);
  }
}

export function parseV1DesignWorkspaceBundle(input: string | unknown): DesignWorkspaceBundle {
  const bundle = parseDesignWorkspaceBundle(input);
  if (bundle.bundleVersion !== DESIGN_WORKSPACE_BUNDLE_VERSION) throw new Error("Workflow sources require a v2 bundle reader; preserve the original file.");
  return bundle;
}
