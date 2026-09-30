import { operationalObservationPayloads, parseLayoutSessionDocument, parseDesignDraftDocument, parseFieldDesignDocument, parseProjectDocument, PROJECT_DOCUMENT_VERSIONS } from "@cplayout/core";
import { z } from "zod";

import type { CatalogProjectRecord, ClientRecord, DesignRecord, FieldMapRecord, ProjectSummary } from "./projectRepositoryTypes";
import { parseStrictJson } from "./strictJson";

export const WORKSPACE_DOCUMENT_VERSION = "cplayout-workspace-v1";
export const FIELD_WORKSPACE_DOCUMENT_VERSION = "cplayout-workspace-v2";
export const LAYOUT_WORKSPACE_DOCUMENT_VERSION = "cplayout-workspace-v3";

const id = z.string().min(1);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.iso.datetime({ offset: true });
const dated = { createdAt: timestamp, updatedAt: timestamp };
const ClientSchema: z.ZodType<ClientRecord> = z.object({
  id, displayName: id, sortName: id, companyName: z.string(), contactName: z.string(),
  primaryContactFirstName: z.string(), primaryContactMiddleInitial: z.string(), primaryContactLastName: z.string(),
  primaryContactSuffix: z.string(), email: z.string(), phone: z.string(), location: z.string(), notes: z.string(), ...dated,
}).strict();
const ProjectSchema: z.ZodType<CatalogProjectRecord> = z.object({
  id, clientId: id, name: id, projectCrs: z.string(), unitSystem: z.string(), ...dated,
}).strict();
const FieldMapSchema: z.ZodType<FieldMapRecord> = z.object({ id, projectId: id, name: id, ...dated }).strict();
const SummarySchema: z.ZodType<ProjectSummary> = z.object({
  id, name: id, projectCrs: id, unitSystem: id, updatedAt: timestamp,
}).strict();
const designFields = { id, fieldMapId: id, name: id, isActive: z.boolean(), revision, ...dated };
const DesignSchema = z.discriminatedUnion("kind", [
  z.object({ ...designFields, kind: z.literal("project"), pivotProjectId: id }).strict(),
  z.object({ ...designFields, kind: z.literal("draft"), draftId: id }).strict(),
  z.object({ ...designFields, kind: z.literal("field"), fieldDesignId: id }).strict(),
]);

export type WorkspaceDesignRecord = Omit<DesignRecord, "pivotProjectId"> & { revision: number } & (
  | { kind: "project"; pivotProjectId: string }
  | { kind: "draft"; draftId: string }
  | { kind: "field"; fieldDesignId: string }
);

const TombstoneSchema = z.object({
  entity: z.enum(["design", "project_document", "draft_document", "field_document"]), id, revision, deletedAt: timestamp,
}).strict();
const WorkspaceSchema = z.object({
  workspaceVersion: z.enum([WORKSPACE_DOCUMENT_VERSION, FIELD_WORKSPACE_DOCUMENT_VERSION, LAYOUT_WORKSPACE_DOCUMENT_VERSION]), revision,
  catalog: z.object({
    clients: z.array(ClientSchema), projects: z.array(ProjectSchema), fieldMaps: z.array(FieldMapSchema), designs: z.array(DesignSchema),
  }).strict(),
  projectDocuments: z.array(z.object({ summary: SummarySchema, document: z.string() }).strict()),
  draftDocuments: z.array(z.object({ id, document: z.string() }).strict()),
  tombstones: z.array(TombstoneSchema),
  fieldDocuments: z.array(z.object({ id, document: z.string(), originalProjectDocument: z.string().optional() }).strict()).optional(),
  originalV1Document: z.string().optional(),
  layoutSessions: z.array(z.object({ id, document: z.string() }).strict()).optional(),
  originalPreviousWorkspaceDocument: z.string().optional(),
}).strict();

export type WorkspaceDocument = z.output<typeof WorkspaceSchema>;
export type WorkspaceDocumentErrorCode = "invalid_document" | "unsupported_version" | "conflict" | "not_found" | "identity_mismatch" | "revision_exhausted";

export class WorkspaceDocumentError extends Error {
  constructor(public readonly code: WorkspaceDocumentErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceDocumentError";
  }
}

function fail(code: WorkspaceDocumentErrorCode, message: string): never {
  throw new WorkspaceDocumentError(code, message);
}

/** Creates no catalog identities, geometry, contacts or machine defaults. */
export function emptyWorkspaceDocument(): WorkspaceDocument {
  return {
    workspaceVersion: WORKSPACE_DOCUMENT_VERSION, revision: 0,
    catalog: { clients: [], projects: [], fieldMaps: [], designs: [] },
    projectDocuments: [], draftDocuments: [], tombstones: [],
  };
}

export function parseWorkspaceDocument(document: string): WorkspaceDocument {
  try {
    const value = parseStrictJson(document);
    if (value !== null && typeof value === "object" && "workspaceVersion" in value
      && value.workspaceVersion !== WORKSPACE_DOCUMENT_VERSION && value.workspaceVersion !== FIELD_WORKSPACE_DOCUMENT_VERSION && value.workspaceVersion !== LAYOUT_WORKSPACE_DOCUMENT_VERSION) fail("unsupported_version", "Workspace version is unsupported; preserve the original data for recovery.");
    return validateWorkspaceDocument(value);
  } catch (error) {
    if (error instanceof WorkspaceDocumentError) throw error;
    return fail("invalid_document", "Workspace is not valid JSON; preserve the original data for recovery.");
  }
}

/** Strict compatibility gate for adapters that only implement v1 storage. */
export function parseV1WorkspaceDocument(document: string): WorkspaceDocument {
  const value = parseWorkspaceDocument(document);
  if (value.workspaceVersion !== WORKSPACE_DOCUMENT_VERSION) fail("unsupported_version", "Field workspaces require a v2-aware reader; retain the original data.");
  return value;
}

/** Frozen v1/v2 readers cannot silently discard Layout sessions. */
export function parseV2WorkspaceDocument(document: string): WorkspaceDocument {
  const value = parseWorkspaceDocument(document);
  if (value.workspaceVersion === LAYOUT_WORKSPACE_DOCUMENT_VERSION) fail("unsupported_version", "Layout sessions require a v3-aware reader; preserve the original data.");
  return value;
}

export function upgradeWorkspaceDocumentToV3(originalDocument: string): WorkspaceDocument {
  const previous = parseV2WorkspaceDocument(originalDocument);
  return validateWorkspaceDocument({ ...previous, workspaceVersion: LAYOUT_WORKSPACE_DOCUMENT_VERSION,
    revision: increment(previous.revision), fieldDocuments: previous.fieldDocuments ?? [], layoutSessions: [],
    originalPreviousWorkspaceDocument: originalDocument });
}

/** Explicit version upgrade only: no project conversion or inferred machine adoption. */
export function upgradeWorkspaceDocumentToV2(originalDocument: string): WorkspaceDocument {
  const previous = parseV1WorkspaceDocument(originalDocument);
  return validateWorkspaceDocument({ ...previous, workspaceVersion: FIELD_WORKSPACE_DOCUMENT_VERSION,
    revision: increment(previous.revision), fieldDocuments: [], originalV1Document: originalDocument });
}

export function serializeWorkspaceDocument(workspace: WorkspaceDocument): string {
  return JSON.stringify(validateWorkspaceDocument(workspace));
}

/** Validates and detaches the envelope; payload strings are never normalized or regenerated. */
export function validateWorkspaceDocument(input: unknown): WorkspaceDocument {
  try {
    rejectPrototypeMetadata(input);
    const workspace = WorkspaceSchema.parse(input);
    const { catalog } = workspace;
    if (workspace.workspaceVersion !== LAYOUT_WORKSPACE_DOCUMENT_VERSION && (workspace.layoutSessions !== undefined || workspace.originalPreviousWorkspaceDocument !== undefined)) {
      fail("unsupported_version", "Layout sessions require an explicit workspace v3 upgrade.");
    }
    if (workspace.workspaceVersion === LAYOUT_WORKSPACE_DOCUMENT_VERSION) {
      if (workspace.layoutSessions === undefined || workspace.originalPreviousWorkspaceDocument === undefined || workspace.fieldDocuments === undefined) fail("invalid_document", "Workspace v3 requires the exact previous workspace and session collection.");
      const raw = parseStrictJson(workspace.originalPreviousWorkspaceDocument);
      if (!raw || typeof raw !== "object" || !("workspaceVersion" in raw) || ![WORKSPACE_DOCUMENT_VERSION, FIELD_WORKSPACE_DOCUMENT_VERSION].includes(raw.workspaceVersion as string)) fail("invalid_document", "Layout upgrade source must be a v1 or v2 workspace.");
      const previous = validateWorkspaceDocument(raw);
      if (previous.revision >= workspace.revision) fail("invalid_document", "Workspace v3 must advance its retained previous revision.");
      if (workspace.originalV1Document !== previous.originalV1Document) fail("invalid_document", "Layout upgrade must retain the original v1 source unchanged.");
    }
    if (workspace.workspaceVersion === WORKSPACE_DOCUMENT_VERSION) {
      if (workspace.fieldDocuments !== undefined || workspace.originalV1Document !== undefined
        || catalog.designs.some(design => design.kind === "field")
        || workspace.tombstones.some(item => item.entity === "field_document")) {
        fail("unsupported_version", "Field payloads require an explicit workspace v2 upgrade.");
      }
    } else if (workspace.workspaceVersion === FIELD_WORKSPACE_DOCUMENT_VERSION) {
      if (workspace.fieldDocuments === undefined || workspace.originalV1Document === undefined) fail("invalid_document", "Workspace v2 requires its retained original v1 document and field collection.");
      // Check the outer version before recursive admission, so nested v2 envelopes cannot recurse.
      const source = parseStrictJson(workspace.originalV1Document);
      if (source === null || typeof source !== "object" || !("workspaceVersion" in source) || source.workspaceVersion !== WORKSPACE_DOCUMENT_VERSION) {
        fail("invalid_document", "Retained upgrade source must be an original v1 workspace.");
      }
      const original = validateWorkspaceDocument(source);
      if (original.revision >= workspace.revision) fail("invalid_document", "Workspace v2 must advance the retained v1 revision.");
    }
    const clients = unique(catalog.clients, "client");
    const projects = unique(catalog.projects, "project");
    const maps = unique(catalog.fieldMaps, "field map");
    const designs = unique(catalog.designs, "design");
    const projectDocuments = unique(workspace.projectDocuments.map((entry) => ({ id: entry.summary.id, ...entry })), "project document");
    const draftDocuments = unique(workspace.draftDocuments, "draft document");
    const fieldDocuments = unique(workspace.fieldDocuments ?? [], "field document");
    for (const record of catalog.projects) requireReference(clients, record.clientId, "project client");
    for (const record of catalog.fieldMaps) requireReference(projects, record.projectId, "field map project");
    for (const entry of workspace.projectDocuments) {
      const project = readStoredProject(entry.document);
      for (const key of ["id", "name", "projectCrs", "unitSystem"] as const) {
        if (entry.summary[key] !== project[key]) fail("identity_mismatch", `Project summary ${key} differs from its document.`);
      }
    }
    for (const entry of workspace.draftDocuments) {
      if (projectDocuments.has(entry.id)) fail("conflict", "A payload identity cannot select both draft and project documents.");
      if (readStoredDraft(entry.document).id !== entry.id) fail("identity_mismatch", "Draft identity differs from its stored document.");
    }
    for (const entry of workspace.fieldDocuments ?? []) {
      if (projectDocuments.has(entry.id) || draftDocuments.has(entry.id)) fail("conflict", "Field payload identity is already used by another kind.");
      if (parseFieldDesignDocument(entry.document).id !== entry.id) fail("identity_mismatch", "Field identity differs from its stored document.");
      if (entry.originalProjectDocument !== undefined) readStoredProject(entry.originalProjectDocument);
    }
    const owned = new Set<string>();
    for (const design of catalog.designs) {
      requireReference(maps, design.fieldMapId, "design field map");
      const payloadId = designPayloadId(design);
      if (design.kind === "project") requireReference(projectDocuments, payloadId, "design project document");
      else if (design.kind === "draft") requireReference(draftDocuments, payloadId, "design draft document");
      else requireReference(fieldDocuments, payloadId, "design field document");
      if (owned.has(payloadId)) fail("conflict", "A document cannot be owned by multiple designs.");
      owned.add(payloadId);
      if (design.revision > workspace.revision) fail("invalid_document", "Design revision exceeds workspace revision.");
    }
    for (const entry of workspace.draftDocuments) {
      if (!owned.has(entry.id)) fail("invalid_document", "A draft document requires an owning design.");
    }
    for (const entry of workspace.fieldDocuments ?? []) {
      if (!owned.has(entry.id)) fail("invalid_document", "A field document requires an owning design.");
    }
    unique(workspace.layoutSessions ?? [], "Layout session");
    for (const entry of workspace.layoutSessions ?? []) {
      const session = parseLayoutSessionDocument(entry.document);
      if (session.id !== entry.id) fail("identity_mismatch", "Layout session identity differs from its document.");
      requireReference(maps, session.fieldMapId, "Layout session field");
    }
    workspaceOperationalObservations(workspace);
    const deleted = new Set<string>();
    for (const tombstone of workspace.tombstones) {
      // Both payload kinds share an identity namespace, including deleted identities.
      const key = JSON.stringify([tombstone.entity === "design" ? "design" : "payload", tombstone.id]);
      if (deleted.has(key)) fail("conflict", "Duplicate deletion identity.");
      deleted.add(key);
      if (tombstone.revision > workspace.revision) fail("invalid_document", "Deletion revision exceeds workspace revision.");
      const occupied = tombstone.entity === "design" ? designs.has(tombstone.id)
        : projectDocuments.has(tombstone.id) || draftDocuments.has(tombstone.id) || fieldDocuments.has(tombstone.id);
      if (occupied) fail("conflict", "Deleted identity is still active.");
    }
    return workspace;
  } catch (error) {
    if (error instanceof WorkspaceDocumentError) throw error;
    return fail("invalid_document", "Workspace data or a stored document is invalid; preserve the original data for recovery.");
  }
}

function rejectPrototypeMetadata(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value !== "object") {
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint"
      || (typeof value === "number" && !Number.isFinite(value))) fail("invalid_document", "Workspace values must be plain JSON data.");
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== (Array.isArray(value) ? Array.prototype : Object.prototype)) fail("invalid_document", "Unsupported workspace object prototype.");
  for (let inherited = prototype; inherited !== null; inherited = Object.getPrototypeOf(inherited)) {
    if (Object.getOwnPropertyDescriptor(inherited, "toJSON")) fail("invalid_document", "Workspace JSON hooks are unsupported.");
  }
  if (ancestors.has(value)) fail("invalid_document", "Workspace data cannot contain cycles.");
  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || key === "prototype" || Object.hasOwn(Object.prototype, key)
      || !descriptor.enumerable || !("value" in descriptor)
      || (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key))) fail("invalid_document", "Unsupported workspace property.");
    rejectPrototypeMetadata(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

const CreateSchema = z.object({ design: DesignSchema, document: z.string() }).strict();
const SaveSchema = z.object({ designId: id, expectedRevision: revision, document: z.string(), updatedAt: timestamp }).strict();
const DeleteSchema = z.object({ designId: id, expectedRevision: revision, deletedAt: timestamp }).strict();

/** Pure transition only: the adapter must read the latest envelope inside its storage lock/transaction. */
export function createWorkspaceDesign(workspace: WorkspaceDocument, input: z.input<typeof CreateSchema>): WorkspaceDocument {
  const next = validateWorkspaceDocument(workspace);
  const { design, document } = parseMutation(CreateSchema, input);
  if (design.revision !== 0) fail("conflict", "New designs must begin at revision zero.");
  const payloadId = designPayloadId(design);
  if (next.catalog.designs.some((item) => item.id === design.id)
    || next.tombstones.some((item) => item.entity === "design" && item.id === design.id)) fail("conflict", "Design identity is already used or deleted.");
  if (next.projectDocuments.some((item) => item.summary.id === payloadId) || next.draftDocuments.some((item) => item.id === payloadId)
    || (next.fieldDocuments ?? []).some(item => item.id === payloadId)
    || next.tombstones.some((item) => item.entity !== "design" && item.id === payloadId)) fail("conflict", "Document identity is already used or deleted.");
  if (!next.catalog.fieldMaps.some((item) => item.id === design.fieldMapId)) fail("not_found", "Selected field map does not exist.");
  next.revision = increment(next.revision);
  next.catalog.designs.push(design);
  setDocument(next, design, document, design.updatedAt);
  return validateWorkspaceDocument(next);
}

/** Does not reassign ownership, change payload kind, relabel CRS or promote complete drafts. */
export function saveWorkspaceDesign(workspace: WorkspaceDocument, input: z.input<typeof SaveSchema>): WorkspaceDocument {
  const next = validateWorkspaceDocument(workspace);
  const save = parseMutation(SaveSchema, input);
  const design = existingDesign(next, save.designId, save.expectedRevision);
  const previous = design.kind === "field"
    ? parseFieldDesignDocument(next.fieldDocuments!.find(entry => entry.id === design.fieldDesignId)!.document)
    : design.kind === "draft"
    ? readStoredDraft(next.draftDocuments.find((entry) => entry.id === design.draftId)!.document)
    : readStoredProject(next.projectDocuments.find((entry) => entry.summary.id === design.pivotProjectId)!.document);
  const supplied = readPayload(design, save.document);
  const previousObservations = operationalObservationPayloads(previous);
  for (const [identity, payload] of operationalObservationPayloads(supplied)) {
    if (previousObservations.has(identity) && previousObservations.get(identity) !== payload) fail("identity_mismatch", "A save cannot rewrite immutable operational receiver evidence.");
  }
  // A label-only save cannot reinterpret existing XY. Explicit transformation is a separate workflow.
  if (previous.projectCrs !== supplied.projectCrs && hasCoordinates(previous)) fail("identity_mismatch", "Stored coordinates require an explicit CRS transformation, not a label change.");
  if ("drawingWorkflow" in previous && previous.drawingWorkflow?.lockedCrs != null
    && (!("drawingWorkflow" in supplied) || supplied.drawingWorkflow?.lockedCrs !== previous.drawingWorkflow.lockedCrs)) {
    fail("identity_mismatch", "The stored drawing CRS lock must be preserved after cancel or undo.");
  }
  design.revision = increment(design.revision);
  design.updatedAt = save.updatedAt;
  next.revision = increment(next.revision);
  setDocument(next, design, save.document, save.updatedAt);
  return validateWorkspaceDocument(next);
}

export function deleteWorkspaceDesign(workspace: WorkspaceDocument, input: z.input<typeof DeleteSchema>): WorkspaceDocument {
  const next = validateWorkspaceDocument(workspace);
  const deletion = parseMutation(DeleteSchema, input);
  const design = existingDesign(next, deletion.designId, deletion.expectedRevision);
  const payloadId = designPayloadId(design);
  const deletedRevision = increment(design.revision);
  next.revision = increment(next.revision);
  next.catalog.designs = next.catalog.designs.filter((item) => item.id !== design.id);
  if (design.kind === "project") next.projectDocuments = next.projectDocuments.filter((item) => item.summary.id !== payloadId);
  else if (design.kind === "draft") next.draftDocuments = next.draftDocuments.filter((item) => item.id !== payloadId);
  else next.fieldDocuments = next.fieldDocuments!.filter(item => item.id !== payloadId);
  next.tombstones.push(
    { entity: "design", id: design.id, revision: deletedRevision, deletedAt: deletion.deletedAt },
    { entity: design.kind === "project" ? "project_document" : design.kind === "draft" ? "draft_document" : "field_document", id: payloadId, revision: deletedRevision, deletedAt: deletion.deletedAt },
  );
  return validateWorkspaceDocument(next);
}

function parseMutation<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  rejectPrototypeMetadata(input);
  const parsed = schema.safeParse(input);
  if (!parsed.success) fail("invalid_document", "Invalid workspace mutation arguments.");
  return parsed.data;
}

function readPayload(design: WorkspaceDesignRecord, document: string) {
  try {
    const payload = design.kind === "field" ? parseFieldDesignDocument(document)
      : design.kind === "draft" ? readStoredDraft(document) : readStoredProject(document);
    if (payload.id !== designPayloadId(design)) fail("identity_mismatch", "A save cannot replace the selected document identity.");
    return payload;
  } catch (error) {
    if (error instanceof WorkspaceDocumentError) throw error;
    return fail("invalid_document", "Invalid design document or incompatible payload kind.");
  }
}

function setDocument(workspace: WorkspaceDocument, design: WorkspaceDesignRecord, document: string, updatedAt: string): void {
  const payload = readPayload(design, document);
  if (design.kind === "field") {
    if (workspace.workspaceVersion === WORKSPACE_DOCUMENT_VERSION || workspace.fieldDocuments === undefined) fail("unsupported_version", "Upgrade the workspace explicitly before storing fields.");
    const index = workspace.fieldDocuments.findIndex(item => item.id === payload.id);
    const entry = { ...(index < 0 ? {} : workspace.fieldDocuments[index]), id: payload.id, document };
    if (index < 0) workspace.fieldDocuments.push(entry);
    else workspace.fieldDocuments[index] = entry;
  } else if (design.kind === "draft") {
    const entry = { id: payload.id, document };
    const index = workspace.draftDocuments.findIndex((item) => item.id === payload.id);
    if (index < 0) workspace.draftDocuments.push(entry);
    else workspace.draftDocuments[index] = entry;
  } else {
    if (payload.projectCrs === null) fail("invalid_document", "A project document requires its declared CRS.");
    const entry = { document, summary: { id: payload.id, name: payload.name, projectCrs: payload.projectCrs, unitSystem: payload.unitSystem, updatedAt } };
    const index = workspace.projectDocuments.findIndex((item) => item.summary.id === payload.id);
    if (index < 0) workspace.projectDocuments.push(entry);
    else workspace.projectDocuments[index] = entry;
  }
}

function hasCoordinates(payload: ReturnType<typeof readPayload>): boolean {
  return payload.fieldBoundary.length > 0 || ("infrastructure" in payload && (payload.machines.length > 0 || payload.infrastructure.length > 0))
    || ("pivotCenter" in payload && (payload.pivotCenter !== null || payload.waterSource !== null || payload.powerSource !== null)) || payload.surveyPoints.length > 0 || payload.obstacles.length > 0
    || (payload.mapFeatures?.length ?? 0) > 0
    || ("drawingWorkflow" in payload && payload.drawingWorkflow !== undefined
      && (payload.drawingWorkflow.lockedCrs !== null || payload.drawingWorkflow.captures.some((capture) => capture.vertices.length > 0)));
}

function readStoredDraft(document: string) {
  return parseDesignDraftDocument(parseStrictJson(document));
}

function readStoredProject(document: string) {
  const raw = parseStrictJson(document);
  // Legacy bare projects remain readable, but a declared future version cannot fall back to that path.
  if (raw !== null && typeof raw === "object" && "documentVersion" in raw
    && !(PROJECT_DOCUMENT_VERSIONS as readonly unknown[]).includes(raw.documentVersion)) fail("unsupported_version", "Stored project document version is unsupported.");
  return parseProjectDocument(raw);
}

function designPayloadId(design: WorkspaceDesignRecord): string {
  return design.kind === "field" ? design.fieldDesignId : design.kind === "draft" ? design.draftId : design.pivotProjectId;
}

function existingDesign(workspace: WorkspaceDocument, designId: string, expectedRevision: number): WorkspaceDesignRecord {
  const design = workspace.catalog.designs.find((item) => item.id === designId);
  if (!design) fail("not_found", "Design no longer exists; a stale save cannot recreate it.");
  if (design.revision !== expectedRevision) fail("conflict", "Design revision changed; reload before saving.");
  return design;
}

function increment(value: number): number {
  if (value === Number.MAX_SAFE_INTEGER) fail("revision_exhausted", "Persisted revision limit reached.");
  return value + 1;
}

function unique<T extends { id: string }>(items: T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.id)) fail("conflict", `Duplicate ${label} identity.`);
    result.set(item.id, item);
  }
  return result;
}

function requireReference(items: Map<string, unknown>, key: string, label: string): void {
  if (!items.has(key)) fail("invalid_document", `Missing ${label} reference.`);
}

/** Operational observation identities are immutable across documents, copies, and standalone saves. */
export function workspaceOperationalObservations(workspace: WorkspaceDocument): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of [...workspace.projectDocuments, ...workspace.draftDocuments, ...(workspace.fieldDocuments ?? []), ...(workspace.layoutSessions ?? [])]) {
    operationalObservationPayloads(parseStrictJson(entry.document), result);
  }
  return result;
}
export function assertRetainedOperationalEvidence(previous: WorkspaceDocument, next: WorkspaceDocument): void {
  const existing = workspaceOperationalObservations(previous);
  for (const [identity, payload] of workspaceOperationalObservations(next)) {
    if (existing.has(identity) && existing.get(identity) !== payload) fail("identity_mismatch", "A transaction cannot rewrite immutable operational receiver evidence.");
  }
}
