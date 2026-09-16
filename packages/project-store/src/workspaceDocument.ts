import { parseDesignDraftDocument, parseProjectDocument, PROJECT_DOCUMENT_VERSION } from "@cplayout/core";
import { z } from "zod";

import type { CatalogProjectRecord, ClientRecord, DesignRecord, FieldMapRecord, ProjectSummary } from "./projectRepositoryTypes";

export const WORKSPACE_DOCUMENT_VERSION = "cplayout-workspace-v1";

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
]);

export type WorkspaceDesignRecord = Omit<DesignRecord, "pivotProjectId"> & { revision: number } & (
  | { kind: "project"; pivotProjectId: string }
  | { kind: "draft"; draftId: string }
);

const TombstoneSchema = z.object({
  entity: z.enum(["design", "project_document", "draft_document"]), id, revision, deletedAt: timestamp,
}).strict();
const WorkspaceSchema = z.object({
  workspaceVersion: z.literal(WORKSPACE_DOCUMENT_VERSION), revision,
  catalog: z.object({
    clients: z.array(ClientSchema), projects: z.array(ProjectSchema), fieldMaps: z.array(FieldMapSchema), designs: z.array(DesignSchema),
  }).strict(),
  projectDocuments: z.array(z.object({ summary: SummarySchema, document: z.string() }).strict()),
  draftDocuments: z.array(z.object({ id, document: z.string() }).strict()),
  tombstones: z.array(TombstoneSchema),
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
    const value: unknown = JSON.parse(document);
    if (value !== null && typeof value === "object" && "workspaceVersion" in value
      && value.workspaceVersion !== WORKSPACE_DOCUMENT_VERSION) fail("unsupported_version", "Workspace version is unsupported; preserve the original data for recovery.");
    return validateWorkspaceDocument(value);
  } catch (error) {
    if (error instanceof WorkspaceDocumentError) throw error;
    return fail("invalid_document", "Workspace is not valid JSON; preserve the original data for recovery.");
  }
}

export function serializeWorkspaceDocument(workspace: WorkspaceDocument): string {
  return JSON.stringify(validateWorkspaceDocument(workspace));
}

/** Validates and detaches the envelope; payload strings are never normalized or regenerated. */
export function validateWorkspaceDocument(input: unknown): WorkspaceDocument {
  try {
    const workspace = WorkspaceSchema.parse(input);
    const { catalog } = workspace;
    const clients = unique(catalog.clients, "client");
    const projects = unique(catalog.projects, "project");
    const maps = unique(catalog.fieldMaps, "field map");
    const designs = unique(catalog.designs, "design");
    const projectDocuments = unique(workspace.projectDocuments.map((entry) => ({ id: entry.summary.id, ...entry })), "project document");
    const draftDocuments = unique(workspace.draftDocuments, "draft document");
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
      if (parseDesignDraftDocument(entry.document).id !== entry.id) fail("identity_mismatch", "Draft identity differs from its stored document.");
    }
    const owned = new Set<string>();
    for (const design of catalog.designs) {
      requireReference(maps, design.fieldMapId, "design field map");
      const payloadId = designPayloadId(design);
      if (design.kind === "project") requireReference(projectDocuments, payloadId, "design project document");
      else requireReference(draftDocuments, payloadId, "design draft document");
      if (owned.has(payloadId)) fail("conflict", "A document cannot be owned by multiple designs.");
      owned.add(payloadId);
      if (design.revision > workspace.revision) fail("invalid_document", "Design revision exceeds workspace revision.");
    }
    for (const entry of workspace.draftDocuments) {
      if (!owned.has(entry.id)) fail("invalid_document", "A draft document requires an owning design.");
    }
    const deleted = new Set<string>();
    for (const tombstone of workspace.tombstones) {
      // Both payload kinds share an identity namespace, including deleted identities.
      const key = JSON.stringify([tombstone.entity === "design" ? "design" : "payload", tombstone.id]);
      if (deleted.has(key)) fail("conflict", "Duplicate deletion identity.");
      deleted.add(key);
      if (tombstone.revision > workspace.revision) fail("invalid_document", "Deletion revision exceeds workspace revision.");
      const occupied = tombstone.entity === "design" ? designs.has(tombstone.id)
        : projectDocuments.has(tombstone.id) || draftDocuments.has(tombstone.id);
      if (occupied) fail("conflict", "Deleted identity is still active.");
    }
    return workspace;
  } catch (error) {
    if (error instanceof WorkspaceDocumentError) throw error;
    return fail("invalid_document", "Workspace data or a stored document is invalid; preserve the original data for recovery.");
  }
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
  const previous = design.kind === "draft"
    ? parseDesignDraftDocument(next.draftDocuments.find((entry) => entry.id === design.draftId)!.document)
    : readStoredProject(next.projectDocuments.find((entry) => entry.summary.id === design.pivotProjectId)!.document);
  const supplied = readPayload(design, save.document);
  // A label-only save cannot reinterpret existing XY. Explicit transformation is a separate workflow.
  if (previous.projectCrs !== supplied.projectCrs && hasCoordinates(previous)) fail("identity_mismatch", "Stored coordinates require an explicit CRS transformation, not a label change.");
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
  else next.draftDocuments = next.draftDocuments.filter((item) => item.id !== payloadId);
  next.tombstones.push(
    { entity: "design", id: design.id, revision: deletedRevision, deletedAt: deletion.deletedAt },
    { entity: design.kind === "project" ? "project_document" : "draft_document", id: payloadId, revision: deletedRevision, deletedAt: deletion.deletedAt },
  );
  return validateWorkspaceDocument(next);
}

function parseMutation<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) fail("invalid_document", "Invalid workspace mutation arguments.");
  return parsed.data;
}

function readPayload(design: WorkspaceDesignRecord, document: string) {
  try {
    const payload = design.kind === "draft" ? parseDesignDraftDocument(document) : readStoredProject(document);
    if (payload.id !== designPayloadId(design)) fail("identity_mismatch", "A save cannot replace the selected document identity.");
    return payload;
  } catch (error) {
    if (error instanceof WorkspaceDocumentError) throw error;
    return fail("invalid_document", "Invalid design document or incompatible payload kind.");
  }
}

function setDocument(workspace: WorkspaceDocument, design: WorkspaceDesignRecord, document: string, updatedAt: string): void {
  const payload = readPayload(design, document);
  if (design.kind === "draft") {
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
  return payload.fieldBoundary.length > 0 || payload.pivotCenter !== null || payload.waterSource !== null
    || payload.powerSource !== null || payload.surveyPoints.length > 0 || payload.obstacles.length > 0
    || (payload.mapFeatures?.length ?? 0) > 0;
}

function readStoredProject(document: string) {
  const raw: unknown = JSON.parse(document);
  // Legacy bare projects remain readable, but a declared future version cannot fall back to that path.
  if (raw !== null && typeof raw === "object" && "documentVersion" in raw
    && raw.documentVersion !== PROJECT_DOCUMENT_VERSION) fail("unsupported_version", "Stored project document version is unsupported.");
  return parseProjectDocument(raw);
}

function designPayloadId(design: WorkspaceDesignRecord): string {
  return design.kind === "draft" ? design.draftId : design.pivotProjectId;
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
