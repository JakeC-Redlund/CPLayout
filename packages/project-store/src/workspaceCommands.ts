import {
  OPERATIONAL_DESIGN_DRAFT_DOCUMENT_VERSION, PivotProjectSchema, parseDesignDraftDocument, parseProjectDocument,
  serializeDesignDraftDocument, serializeProjectDocument, validateFieldDesign, serializeFieldDesignDocument,
  parseFieldDesignDocument, convertPivotProjectToFieldDesign, createFieldDesignEditorState, reduceFieldDesignEditorState,
  tryBuildPivotProject, createLayoutSessionDocument, parseLayoutSessionDocument, serializeLayoutSessionDocument, LayoutObservationSchema,
} from "@cplayout/core";
import type { DesignDraft, FieldDesign, FieldPivotMachine, LayoutResult, PivotProject, LayoutSession, LayoutObservation } from "@cplayout/core";
import { z } from "zod";
import { parseStrictJson } from "./strictJson";
import { parseEditableProjectDocument } from "./projectDocumentEditing";

import {
  assertClientPrimaryContact, defaultDesignId, defaultFieldMapId, emptyClientProfileFields,
  formatPrimaryContactName, normalizeCatalogSortName, resolveClientDisplayName, resolveClientSortName,
} from "./projectCatalog";
import type {
  CatalogProjectRecord, ClientProfileInput, ClientProfileUpdateInput, ClientRecord,
  CreatedProjectFieldMapWorkspace, CreatedProjectWorkspace, CreateProjectWithInitialDesignInput,
  CreateProjectWithInitialFieldMapInput, DesignRecord, FieldMapRecord,
} from "./projectRepositoryTypes";
import {
  assertRetainedOperationalEvidence, createWorkspaceDesign, deleteWorkspaceDesign, saveWorkspaceDesign, validateWorkspaceDocument, WorkspaceDocumentError,
  serializeWorkspaceDocument, upgradeWorkspaceDocumentToV2, upgradeWorkspaceDocumentToV3, FIELD_WORKSPACE_DOCUMENT_VERSION, LAYOUT_WORKSPACE_DOCUMENT_VERSION,
  type WorkspaceDesignRecord, type WorkspaceDocument,
} from "./workspaceDocument";

type TimedCommand<T extends string> = { type: T; now: string };
export type SaveProjectCommand = TimedCommand<"save_project"> & { project: PivotProject; result?: LayoutResult; createOnly: boolean };
export type SaveDesignProjectCommand = TimedCommand<"save_design_project"> & { designId: string; project: PivotProject; result?: LayoutResult };
export type CreateDesignDraftCommand = TimedCommand<"create_design_draft"> & {
  designId: string; fieldMapId: string; name: string; draft: DesignDraft; isActive?: boolean;
};
export type SaveDesignDraftCommand = TimedCommand<"save_design_draft"> & {
  designId: string; expectedDesignRevision: number; draft: DesignDraft; syncCatalogName?: boolean;
};
export type DeleteDesignCommand = TimedCommand<"delete_design"> & { designId: string; expectedDesignRevision: number };
export type CopyProjectCommand = TimedCommand<"copy_project"> & {
  source: PivotProject; sourceStored: boolean; newProjectId: string; name: string;
};
export type DeleteProjectCommand = TimedCommand<"delete_project"> & { projectId: string };
export type CreateClientCommand = TimedCommand<"create_client"> & { id: string; input: ClientProfileInput };
export type UpdateClientCommand = TimedCommand<"update_client"> & { input: ClientProfileUpdateInput };
export type DeleteClientCommand = TimedCommand<"delete_client"> & { clientId: string };
export type CreateProjectWithInitialDesignCommand = TimedCommand<"create_project_with_initial_design"> & { input: CreateProjectWithInitialDesignInput };
export type CreateProjectWithInitialFieldMapCommand = TimedCommand<"create_project_with_initial_field_map"> & {
  input: CreateProjectWithInitialFieldMapInput & { projectId: string };
};
export type CreateProjectRecordCommand = TimedCommand<"create_project_record"> & {
  input: { id: string; clientId: string; name: string; projectCrs: string; unitSystem: string };
};
export type RenameProjectCommand = TimedCommand<"rename_project"> & { projectId: string; name: string };
export type MoveProjectToClientCommand = TimedCommand<"move_project_to_client"> & { projectId: string; clientId: string };
export type CreateFieldMapRecordCommand = TimedCommand<"create_field_map_record"> & { input: { id: string; projectId: string; name: string } };
export type CreateDesignRecordCommand = TimedCommand<"create_design_record"> & {
  input: { id: string; fieldMapId: string; name: string; pivotProjectId: string; isActive?: boolean };
};
export type UpgradeFieldWorkspaceCommand = TimedCommand<"upgrade_workspace_to_v2">;
export type CreateFieldDesignCommand = TimedCommand<"create_field_design"> & {
  designId: string; fieldMapId: string; name: string; field: FieldDesign; isActive?: boolean; originalProjectDocument?: string;
};
export type SaveFieldDesignCommand = TimedCommand<"save_field_design"> & {
  designId: string; expectedDesignRevision: number; field: FieldDesign;
};
export type CopyFieldDesignCommand = TimedCommand<"copy_field_design"> & {
  sourceDesignId: string; expectedDesignRevision: number; designId: string; fieldMapId: string; fieldId: string; name: string;
};
export type ConvertProjectToFieldDesignCommand = TimedCommand<"convert_project_to_field_design"> & {
  sourceDesignId: string; expectedDesignRevision: number; designId: string; fieldMapId: string; name: string;
  fieldId: string; waterSourceId: string; powerSourceId: string;
};
export type AdoptFieldPlanCommand = TimedCommand<"adopt_field_plan"> & {
  designId: string; expectedDesignRevision: number; machines: FieldPivotMachine[]; allowedReplacementMachineIds?: string[];
};
export type CreateCompleteDesignFromDraftCommand = TimedCommand<"create_complete_design_from_draft"> & {
  sourceDesignId: string; expectedDesignRevision: number; draft: DesignDraft; designId: string; projectId: string; name: string;
};
export type UpgradeLayoutWorkspaceCommand = TimedCommand<"upgrade_workspace_to_v3">;
export type CreateLayoutSessionCommand = TimedCommand<"create_layout_session"> & { sessionId: string; fieldMapId: string; name: string; targetDocument: string };
export type AppendLayoutObservationCommand = TimedCommand<"append_layout_observation"> & { sessionId: string; expectedSessionRevision: number; observation: LayoutObservation };
export type RenameLayoutSessionCommand = TimedCommand<"rename_layout_session"> & { sessionId: string; expectedSessionRevision: number; name: string };
export type ArchiveLayoutSessionCommand = TimedCommand<"archive_layout_session"> & { sessionId: string; expectedSessionRevision: number; archived: boolean };
export type CopyLayoutSessionCommand = TimedCommand<"copy_layout_session"> & { sourceSessionId: string; expectedSessionRevision: number; sessionId: string; name: string };
export type ImportLayoutSessionCommand = TimedCommand<"import_layout_session"> & { document: string; fieldMapId: string };
export type ImportDesignDocumentCommand = TimedCommand<"import_design_document"> & {
  fieldMapId: string; designId: string; payloadId: string; document: string; name?: string; originalProjectDocument?: string;
};
export type WorkspaceCommand = SaveProjectCommand | SaveDesignProjectCommand | CopyProjectCommand | DeleteProjectCommand
  | CreateClientCommand | UpdateClientCommand | DeleteClientCommand | CreateProjectWithInitialDesignCommand
  | CreateProjectWithInitialFieldMapCommand | CreateProjectRecordCommand | RenameProjectCommand
  | MoveProjectToClientCommand | CreateFieldMapRecordCommand | CreateDesignRecordCommand
  | CreateDesignDraftCommand | SaveDesignDraftCommand | DeleteDesignCommand
  | UpgradeFieldWorkspaceCommand | CreateFieldDesignCommand | SaveFieldDesignCommand | CopyFieldDesignCommand
  | ConvertProjectToFieldDesignCommand | AdoptFieldPlanCommand | CreateCompleteDesignFromDraftCommand
  | UpgradeLayoutWorkspaceCommand | CreateLayoutSessionCommand | AppendLayoutObservationCommand | RenameLayoutSessionCommand
  | ArchiveLayoutSessionCommand | CopyLayoutSessionCommand | ImportLayoutSessionCommand | ImportDesignDocumentCommand;
export type WorkspaceCommandValue = void | ClientRecord | CatalogProjectRecord | FieldMapRecord | DesignRecord
  | CreatedProjectWorkspace | CreatedProjectFieldMapWorkspace | PivotProject | LayoutSession | Extract<WorkspaceDesignRecord, { kind: "draft" | "field" }>;
export interface WorkspaceCommandResult { workspace: WorkspaceDocument; value: WorkspaceCommandValue }

const id = z.string().min(1);
const now = z.iso.datetime({ offset: true });
const text = z.string();
const profileFields = {
  companyName: text.optional(), primaryContactFirstName: text, primaryContactLastName: text,
  primaryContactMiddleInitial: text.optional(), primaryContactSuffix: text.optional(), displayName: text.optional(),
  sortName: text.optional(), contactName: text.optional(), email: text.optional(), phone: text.optional(),
  location: text.optional(), notes: text.optional(),
};
const ProfileSchema = z.object(profileFields).strict();
const ProjectRecordInputSchema = z.object({ id, clientId: id, name: text, projectCrs: text, unitSystem: text }).strict();
const FieldMapInputSchema = z.object({ id, projectId: id, name: text }).strict();
const DesignInputSchema = z.object({ id, fieldMapId: id, name: text, pivotProjectId: id, isActive: z.boolean().optional() }).strict();
const xy = z.object({ x: z.number(), y: z.number() }).strict();
const coverage = z.array(z.array(z.array(xy)));
// Results are accepted for repository compatibility, but are not persisted in the workspace format.
const ResultSchema: z.ZodType<LayoutResult> = z.object({
  metrics: z.object({
    fieldAcres: z.number(), irrigatedAcres: z.number(), nonIrrigatedAcres: z.number(), coveragePercent: z.number(),
    standardPivotAcres: z.number().optional(), endGunAcres: z.number(), cornerArmAcres: z.number().optional(),
    outsideFieldAcres: z.number(), blockedByNoSprayAcres: z.number().optional(), obstacleConflictCount: z.number(),
    noSprayConflictCount: z.number(), hardMechanicalConflictCount: z.number(), towerTrackConflictCount: z.number(),
  }).strict(),
  baseCoverage: coverage, endGunCoverage: coverage, allowedCoverage: coverage, outsideFieldCoverage: coverage, obstacles: coverage,
  mechanicalConflicts: z.array(z.object({
    obstacleId: text, obstacleKind: z.enum(["road", "ditch", "fence", "building", "canal", "tree", "exclusion"]),
    obstacleName: text, conflictType: z.enum(["machine_path", "tower_track"]), areaSquareMeters: z.number(),
  }).strict()),
  towers: z.array(z.object({ towerIndex: z.number(), radiusMeters: z.number(), point: xy }).strict()), warnings: z.array(text),
}).strict();
const ProjectInputSchema = PivotProjectSchema;
const designRevision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const DraftInputSchema = z.unknown().transform((input): DesignDraft => {
  try {
    return parseDesignDraftDocument({ documentVersion: OPERATIONAL_DESIGN_DRAFT_DOCUMENT_VERSION, draft: input });
  } catch {
    return fail("invalid_document", "Invalid design draft command data.");
  }
});
const FieldInputSchema = z.unknown().transform((input): FieldDesign => {
  try { return validateFieldDesign(input); }
  catch { return fail("invalid_document", "Invalid field design command data."); }
});
const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("import_design_document"), now, fieldMapId: id, designId: id, payloadId: id, document: z.string(), name: z.string().trim().min(1).max(200).optional(), originalProjectDocument: z.string().optional() }).strict(),
  z.object({ type: z.literal("create_complete_design_from_draft"), now, sourceDesignId: id, expectedDesignRevision: designRevision,
    draft: DraftInputSchema, designId: id, projectId: id, name: z.string().trim().min(1).max(200) }).strict(),
  z.object({ type: z.literal("upgrade_workspace_to_v3"), now }).strict(),
  z.object({ type: z.literal("create_layout_session"), now, sessionId: id, fieldMapId: id, name: id, targetDocument: z.string() }).strict(),
  z.object({ type: z.literal("append_layout_observation"), now, sessionId: id, expectedSessionRevision: designRevision, observation: LayoutObservationSchema }).strict(),
  z.object({ type: z.literal("rename_layout_session"), now, sessionId: id, expectedSessionRevision: designRevision, name: id }).strict(),
  z.object({ type: z.literal("archive_layout_session"), now, sessionId: id, expectedSessionRevision: designRevision, archived: z.boolean() }).strict(),
  z.object({ type: z.literal("copy_layout_session"), now, sourceSessionId: id, expectedSessionRevision: designRevision, sessionId: id, name: id }).strict(),
  z.object({ type: z.literal("import_layout_session"), now, document: z.string(), fieldMapId: id }).strict(),
  z.object({ type: z.literal("upgrade_workspace_to_v2"), now }).strict(),
  z.object({ type: z.literal("create_field_design"), now, designId: id, fieldMapId: id, name: text,
    field: FieldInputSchema, isActive: z.boolean().optional(), originalProjectDocument: z.string().optional() }).strict(),
  z.object({ type: z.literal("save_field_design"), now, designId: id, expectedDesignRevision: designRevision, field: FieldInputSchema }).strict(),
  z.object({ type: z.literal("copy_field_design"), now, sourceDesignId: id, expectedDesignRevision: designRevision,
    designId: id, fieldMapId: id, fieldId: id, name: z.string().min(1) }).strict(),
  z.object({ type: z.literal("convert_project_to_field_design"), now, sourceDesignId: id, expectedDesignRevision: designRevision,
    designId: id, fieldMapId: id, name: text, fieldId: id, waterSourceId: id, powerSourceId: id }).strict(),
  z.object({ type: z.literal("adopt_field_plan"), now, designId: id, expectedDesignRevision: designRevision,
    machines: z.array(z.custom<FieldPivotMachine>(value => value !== null && typeof value === "object").transform(value => JSON.parse(JSON.stringify(value)) as FieldPivotMachine)),
    allowedReplacementMachineIds: z.array(id).optional() }).strict(),
  z.object({ type: z.literal("save_project"), now, project: ProjectInputSchema, result: ResultSchema.optional(), createOnly: z.boolean() }).strict(),
  z.object({ type: z.literal("save_design_project"), now, designId: id, project: ProjectInputSchema, result: ResultSchema.optional() }).strict(),
  z.object({ type: z.literal("create_design_draft"), now, designId: id, fieldMapId: id, name: text,
    draft: DraftInputSchema, isActive: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("save_design_draft"), now, designId: id, expectedDesignRevision: designRevision, draft: DraftInputSchema, syncCatalogName: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("delete_design"), now, designId: id, expectedDesignRevision: designRevision }).strict(),
  z.object({ type: z.literal("copy_project"), now, source: ProjectInputSchema, sourceStored: z.boolean(),
    newProjectId: id, name: z.string().trim().min(1).max(200) }).strict(),
  z.object({ type: z.literal("delete_project"), now, projectId: id }).strict(),
  z.object({ type: z.literal("create_client"), now, id, input: ProfileSchema }).strict(),
  z.object({ type: z.literal("update_client"), now, input: ProfileSchema.partial().extend({ id }).strict() }).strict(),
  z.object({ type: z.literal("delete_client"), now, clientId: id }).strict(),
  z.object({ type: z.literal("create_project_with_initial_design"), now, input: z.object({
    clientId: id, project: ProjectInputSchema, result: ResultSchema.optional(), fieldMapId: id.optional(),
    fieldMapName: text.optional(), designId: id.optional(), designName: text.optional(),
  }).strict() }).strict(),
  z.object({ type: z.literal("create_project_with_initial_field_map"), now, input: z.object({
    clientId: id, projectId: id, projectName: text, projectCrs: text, unitSystem: text,
    fieldMapId: id.optional(), fieldMapName: text.optional(),
  }).strict() }).strict(),
  z.object({ type: z.literal("create_project_record"), now, input: ProjectRecordInputSchema }).strict(),
  z.object({ type: z.literal("rename_project"), now, projectId: id, name: text }).strict(),
  z.object({ type: z.literal("move_project_to_client"), now, projectId: id, clientId: id }).strict(),
  z.object({ type: z.literal("create_field_map_record"), now, input: FieldMapInputSchema }).strict(),
  z.object({ type: z.literal("create_design_record"), now, input: DesignInputSchema }).strict(),
]);

/** Validate and detach synchronously, before the adapter waits for its storage lock. */
export function parseWorkspaceCommand(input: unknown): WorkspaceCommand {
  assertPlainData(input);
  const parsed = CommandSchema.safeParse(input);
  if (!parsed.success) fail("invalid_document", "Invalid workspace command arguments.");
  // Draft parsing already rejects unknown fields and may omit known optional undefined values.
  // Legacy payload schemas allow extras when reading, so their mutations need the retention check.
  if (parsed.data.type !== "create_design_draft" && parsed.data.type !== "save_design_draft" && parsed.data.type !== "create_complete_design_from_draft") {
    assertNoStrippedFields(input, parsed.data);
  }
  return parsed.data;
}

/** The adapter checks the caller's workspace revision under its storage lock before applying this transition. */
export function applyWorkspaceCommand(workspace: WorkspaceDocument, command: WorkspaceCommand): WorkspaceCommandResult {
  assertPlainData(workspace);
  let next = validateWorkspaceDocument(workspace);
  const cmd = parseWorkspaceCommand(command);
  const revision = increment(next.revision);
  let value: WorkspaceCommandValue = undefined;
  switch (cmd.type) {
    case "import_design_document": {
      assertUnused(next.catalog.projects, cmd.payloadId, "Project folder");
      const raw: unknown = parseStrictJson(cmd.document);
      if (!raw || typeof raw !== "object" || !("documentVersion" in raw) || typeof raw.documentVersion !== "string") fail("invalid_document", "Import a supported versioned project, draft or field document.");
      const shared = { id: cmd.designId, fieldMapId: cmd.fieldMapId, isActive: true, revision: 0, createdAt: cmd.now, updatedAt: cmd.now };
      if (raw.documentVersion.startsWith("pivot-project-")) {
        if (cmd.originalProjectDocument !== undefined) fail("invalid_document", "Original project provenance belongs to field archives only.");
        const source = parseEditableProjectDocument(cmd.document);
        const project = { ...source, id: cmd.payloadId, name: cmd.name ?? source.name };
        next = createWorkspaceDesign(next, { design: { ...shared, kind: "project", pivotProjectId: project.id, name: project.name }, document: serializeProjectDocument(project) });
      } else if (raw.documentVersion.startsWith("design-draft-")) {
        if (cmd.originalProjectDocument !== undefined) fail("invalid_document", "Original project provenance belongs to field archives only.");
        const source = parseDesignDraftDocument(cmd.document);
        const draft = { ...source, id: cmd.payloadId, name: cmd.name ?? source.name };
        next = createWorkspaceDesign(next, { design: { ...shared, kind: "draft", draftId: draft.id, name: draft.name }, document: serializeDesignDraftDocument(draft) });
      } else if (raw.documentVersion.startsWith("field-design-")) {
        const source = parseFieldDesignDocument(cmd.document);
        if (cmd.originalProjectDocument !== undefined) parseProjectDocument(cmd.originalProjectDocument);
        const field = { ...source, id: cmd.payloadId, name: cmd.name ?? source.name };
        const created = createField(next, { ...cmd, name: field.name }, field);
        next = created.workspace;
        if (cmd.originalProjectDocument !== undefined) next.fieldDocuments!.find(entry => entry.id === field.id)!.originalProjectDocument = cmd.originalProjectDocument;
      } else fail("unsupported_version", "This file is not a supported project, draft or field document. Use Layout target import for frozen targets.");
      break;
    }
    case "create_complete_design_from_draft": {
      const source = requireRecord(next.catalog.designs, cmd.sourceDesignId, "Source draft design");
      if (source.kind !== "draft" || source.draftId !== cmd.draft.id) fail("identity_mismatch", "Completion requires the selected draft and its original identity.");
      if (source.revision !== cmd.expectedDesignRevision) fail("conflict", "Draft revision changed; reopen it before completing.");
      assertUnused(next.catalog.designs, cmd.designId, "Complete design");
      if (next.tombstones.some(item => item.entity === "design" && item.id === cmd.designId)) fail("conflict", "Complete design identity was already deleted.");
      assertUnusedPayload(next, cmd.projectId);
      assertUnused(next.catalog.projects, cmd.projectId, "Project folder");
      const result = tryBuildPivotProject(cmd.draft);
      if (!result.ok) fail("invalid_document", "The applied draft is incomplete or cannot be calculated. Resolve its missing inputs before creating a complete design.");
      const project = { ...result.project, id: cmd.projectId, name: cmd.name };
      const previousDocument = next.draftDocuments.find(entry => entry.id === source.draftId)!.document;
      next = saveWorkspaceDesign(next, { designId: source.id, expectedRevision: source.revision,
        document: serializeDesignDraftDocument(cmd.draft), updatedAt: cmd.now });
      if (parseDesignDraftDocument(previousDocument).name !== cmd.draft.name) {
        next.catalog.designs.find(entry => entry.id === source.id)!.name = normalizeCatalogSortName(cmd.draft.name);
      }
      next.catalog.designs.push({ id: cmd.designId, kind: "project", pivotProjectId: project.id, fieldMapId: source.fieldMapId,
        name: cmd.name, isActive: true, revision: 0, createdAt: cmd.now, updatedAt: cmd.now });
      next.projectDocuments.push(projectEntry(project, cmd.now));
      value = project;
      break;
    }
    case "upgrade_workspace_to_v3":
      next = upgradeWorkspaceDocumentToV3(serializeWorkspaceDocument(next));
      break;
    case "create_layout_session": {
      requireLayoutWorkspace(next);
      const session = createLayoutSessionDocument({ id: cmd.sessionId, fieldMapId: cmd.fieldMapId, name: cmd.name, targetDocument: cmd.targetDocument, now: cmd.now });
      insertLayoutSession(next, session); value = session; break;
    }
    case "import_layout_session": {
      requireLayoutWorkspace(next);
      const session = parseLayoutSessionDocument(cmd.document);
      // Association is explicit; immutable target bytes, observation identities and history remain exact.
      const associated = parseLayoutSessionDocument({ ...session, fieldMapId: cmd.fieldMapId });
      insertLayoutSession(next, associated); value = associated; break;
    }
    case "copy_layout_session": {
      const source = readLayoutSession(next, cmd.sourceSessionId, cmd.expectedSessionRevision);
      const session = createLayoutSessionDocument({ id: cmd.sessionId, fieldMapId: source.fieldMapId, name: cmd.name, targetDocument: source.targetDocument, now: cmd.now });
      insertLayoutSession(next, session); value = session; break;
    }
    case "append_layout_observation":
    case "rename_layout_session":
    case "archive_layout_session": {
      const session = readLayoutSession(next, cmd.sessionId, cmd.expectedSessionRevision);
      if (cmd.type === "append_layout_observation") {
        if (session.archived) fail("conflict", "Restore the archived Layout session before collecting observations.");
        session.observations.push(cmd.observation);
      } else if (cmd.type === "rename_layout_session") session.name = cmd.name;
      else session.archived = cmd.archived;
      session.revision = increment(session.revision); session.updatedAt = cmd.now;
      const document = serializeLayoutSessionDocument(session);
      next.layoutSessions!.find(item => item.id === session.id)!.document = document;
      value = parseLayoutSessionDocument(document); break;
    }
    case "upgrade_workspace_to_v2":
      next = upgradeWorkspaceDocumentToV2(serializeWorkspaceDocument(next));
      break;
    case "create_field_design": {
      const created = createField(next, cmd, cmd.field);
      next = created.workspace; value = created.design;
      if (cmd.originalProjectDocument !== undefined) next.fieldDocuments!.find(item => item.id === cmd.field.id)!.originalProjectDocument = cmd.originalProjectDocument;
      break;
    }
    case "save_field_design": {
      fieldDesign(next, cmd.designId, cmd.expectedDesignRevision);
      next = saveWorkspaceDesign(next, { designId: cmd.designId, expectedRevision: cmd.expectedDesignRevision,
        document: serializeFieldDesignDocument(cmd.field), updatedAt: cmd.now });
      value = next.catalog.designs.find(item => item.id === cmd.designId)!;
      break;
    }
    case "copy_field_design": {
      const source = fieldDesign(next, cmd.sourceDesignId, cmd.expectedDesignRevision);
      const entry = next.fieldDocuments!.find(item => item.id === source.fieldDesignId)!;
      const copy = { ...parseFieldDesignDocument(entry.document), id: cmd.fieldId, name: cmd.name };
      const created = createField(next, cmd, copy);
      next = created.workspace; value = created.design;
      if (entry.originalProjectDocument !== undefined) next.fieldDocuments!.find(item => item.id === cmd.fieldId)!.originalProjectDocument = entry.originalProjectDocument;
      break;
    }
    case "convert_project_to_field_design": {
      const source = requireRecord(next.catalog.designs, cmd.sourceDesignId, "Source design");
      if (source.kind !== "project") fail("identity_mismatch", "Explicit conversion requires a project-backed source design.");
      if (source.revision !== cmd.expectedDesignRevision) fail("conflict", "Source design revision changed before conversion.");
      const original = next.projectDocuments.find(item => item.summary.id === source.pivotProjectId)!.document;
      let converted: ReturnType<typeof convertPivotProjectToFieldDesign>;
      try { converted = convertPivotProjectToFieldDesign(original, { fieldId: cmd.fieldId, waterSourceId: cmd.waterSourceId, powerSourceId: cmd.powerSourceId }); }
      catch { return fail("invalid_document", "Project conversion refused unsupported data; preserve the original project."); }
      const created = createField(next, cmd, { ...converted.field, name: cmd.name });
      next = created.workspace; value = created.design;
      next.fieldDocuments!.find(item => item.id === cmd.fieldId)!.originalProjectDocument = original;
      break;
    }
    case "adopt_field_plan": {
      const design = fieldDesign(next, cmd.designId, cmd.expectedDesignRevision);
      const field = parseFieldDesignDocument(next.fieldDocuments!.find(item => item.id === design.fieldDesignId)!.document);
      const editor = { ...createFieldDesignEditorState(field), revision: design.revision };
      const adopted = reduceFieldDesignEditorState(editor, { type: "adopt_plan", expectedRevision: cmd.expectedDesignRevision,
        machines: cmd.machines, ...(cmd.allowedReplacementMachineIds === undefined ? {} : { allowedReplacementMachineIds: cmd.allowedReplacementMachineIds }) });
      if (adopted.lastError) fail("conflict", adopted.lastError);
      next = saveWorkspaceDesign(next, { designId: cmd.designId, expectedRevision: cmd.expectedDesignRevision,
        document: serializeFieldDesignDocument(adopted.field), updatedAt: cmd.now });
      value = next.catalog.designs.find(item => item.id === cmd.designId)!;
      break;
    }
    case "save_project": {
      const existing = next.projectDocuments.find((entry) => entry.summary.id === cmd.project.id);
      if (cmd.createOnly) {
        assertUnusedPayload(next, cmd.project.id);
        assertUnused(next.catalog.projects, cmd.project.id, "Project folder");
      }
      else if (!existing) fail("not_found", "Project document no longer exists; saving cannot recreate it.");
      if (existing) assertStoredProjectEditable(existing.document);
      const owner = next.catalog.designs.find((design) => design.kind === "project" && design.pivotProjectId === cmd.project.id);
      if (owner) next = saveOwned(next, owner.id, cmd.project, cmd.now);
      else {
        if (existing && parseProjectDocument(existing.document).projectCrs !== cmd.project.projectCrs) {
          fail("identity_mismatch", "Stored coordinates require an explicit CRS transformation, not a label change.");
        }
        const entry = projectEntry(cmd.project, cmd.now);
        if (existing) next.projectDocuments[next.projectDocuments.indexOf(existing)] = entry;
        else next.projectDocuments.push(entry);
      }
      break;
    }
    case "copy_project": {
      if (cmd.newProjectId === cmd.source.id) fail("identity_mismatch", "A copy requires a new document identity.");
      assertUnusedPayload(next, cmd.newProjectId);
      assertUnused(next.catalog.projects, cmd.newProjectId, "Project folder");
      if (cmd.sourceStored) {
        const source = next.projectDocuments.find(entry => entry.summary.id === cmd.source.id);
        if (!source) fail("not_found", "The saved source no longer exists; retain the editor and export its recovery package.");
        assertStoredProjectEditable(source.document);
        if (parseProjectDocument(source.document).projectCrs !== cmd.source.projectCrs) {
          fail("identity_mismatch", "Copy cannot reinterpret stored coordinates by changing their CRS label.");
        }
      }
      const copy = { ...cmd.source, id: cmd.newProjectId, name: cmd.name };
      next.projectDocuments.push(projectEntry(copy, cmd.now));
      value = copy;
      break;
    }
    case "save_design_project":
      next = saveOwned(next, cmd.designId, cmd.project, cmd.now);
      break;
    case "create_design_draft": {
      const design: Extract<WorkspaceDesignRecord, { kind: "draft" }> = {
        id: cmd.designId, fieldMapId: cmd.fieldMapId, name: normalizeCatalogSortName(cmd.name),
        kind: "draft", draftId: cmd.draft.id, isActive: cmd.isActive ?? true,
        revision: 0, createdAt: cmd.now, updatedAt: cmd.now,
      };
      next = createWorkspaceDesign(next, { design, document: serializeDesignDraftDocument(cmd.draft) });
      value = design;
      break;
    }
    case "save_design_draft": {
      const design = requireRecord(next.catalog.designs, cmd.designId, "Design");
      if (design.kind !== "draft") fail("identity_mismatch", "Draft save requires a draft-backed design.");
      const previousDocument = next.draftDocuments.find(entry => entry.id === design.draftId)!.document;
      next = saveWorkspaceDesign(next, {
        designId: cmd.designId, expectedRevision: cmd.expectedDesignRevision,
        document: serializeDesignDraftDocument(cmd.draft), updatedAt: cmd.now,
      });
      value = next.catalog.designs.find((entry): entry is Extract<WorkspaceDesignRecord, { kind: "draft" }> =>
        entry.id === cmd.designId && entry.kind === "draft")!;
      // An applied document rename also renames its visible catalog entry. Other
      // saves retain any historical catalog alias. Compare only after the normal
      // revision and payload checks have succeeded, within this same transaction.
      if (cmd.syncCatalogName && parseDesignDraftDocument(previousDocument).name !== cmd.draft.name) value.name = normalizeCatalogSortName(cmd.draft.name);
      break;
    }
    case "delete_design":
      next = deleteWorkspaceDesign(next, {
        designId: cmd.designId, expectedRevision: cmd.expectedDesignRevision, deletedAt: cmd.now,
      });
      break;
    case "delete_project":
      deleteProject(next, cmd.projectId, cmd.now, revision);
      break;
    case "create_client": {
      assertUnused(next.catalog.clients, cmd.id, "Client");
      const record = normalizeClientInput({ ...emptyClientProfileFields(), ...cmd.input, id: cmd.id, createdAt: cmd.now, updatedAt: cmd.now });
      next.catalog.clients.push(record);
      value = record;
      break;
    }
    case "update_client": {
      const existing = requireRecord(next.catalog.clients, cmd.input.id, "Client");
      const record = normalizeClientInput({ ...existing, ...definedFields(cmd.input), updatedAt: cmd.now });
      next.catalog.clients[next.catalog.clients.indexOf(existing)] = record;
      value = record;
      break;
    }
    case "delete_client":
      requireRecord(next.catalog.clients, cmd.clientId, "Client");
      if (next.catalog.projects.some((record) => record.clientId === cmd.clientId)) fail("conflict", "Client still contains projects.");
      next.catalog.clients = next.catalog.clients.filter((record) => record.id !== cmd.clientId);
      break;
    case "create_project_with_initial_design": {
      const { input } = cmd;
      const project = input.project;
      assertUnusedPayload(next, project.id);
      const projectRecord = addProject(next, { id: project.id, clientId: input.clientId, name: project.name, projectCrs: project.projectCrs, unitSystem: project.unitSystem }, cmd.now);
      const fieldMap = addFieldMap(next, { id: input.fieldMapId ?? defaultFieldMapId(project.id), projectId: project.id, name: input.fieldMapName ?? "Primary Field Map" }, cmd.now);
      const design: WorkspaceDesignRecord = {
        id: input.designId ?? defaultDesignId(project.id), fieldMapId: fieldMap.id, name: normalizeCatalogSortName(input.designName ?? "Base Design"),
        kind: "project", pivotProjectId: project.id, isActive: true, revision: 0, createdAt: cmd.now, updatedAt: cmd.now,
      };
      next = createWorkspaceDesign(next, { design, document: serializeProjectDocument(project) });
      value = { project, projectRecord, fieldMap, design: legacyDesign(design) };
      break;
    }
    case "create_project_with_initial_field_map": {
      const { input } = cmd;
      const projectRecord = addProject(next, { id: input.projectId, clientId: input.clientId, name: input.projectName, projectCrs: input.projectCrs, unitSystem: input.unitSystem }, cmd.now);
      const fieldMap = addFieldMap(next, { id: input.fieldMapId ?? defaultFieldMapId(input.projectId), projectId: input.projectId, name: input.fieldMapName ?? "Primary Field Map" }, cmd.now);
      value = { projectRecord, fieldMap };
      break;
    }
    case "create_project_record":
      value = addProject(next, cmd.input, cmd.now);
      break;
    case "rename_project": {
      const record = requireRecord(next.catalog.projects, cmd.projectId, "Project folder");
      record.name = normalizeCatalogSortName(cmd.name);
      record.updatedAt = cmd.now;
      value = record;
      break;
    }
    case "move_project_to_client": {
      requireRecord(next.catalog.clients, cmd.clientId, "Client");
      const record = requireRecord(next.catalog.projects, cmd.projectId, "Project folder");
      record.clientId = cmd.clientId;
      record.updatedAt = cmd.now;
      value = record;
      break;
    }
    case "create_field_map_record":
      value = addFieldMap(next, cmd.input, cmd.now);
      break;
    case "create_design_record": {
      const { input } = cmd;
      assertUnused(next.catalog.designs, input.id, "Design");
      if (next.tombstones.some((entry) => entry.entity === "design" && entry.id === input.id)) fail("conflict", "Design identity was deleted.");
      requireRecord(next.catalog.fieldMaps, input.fieldMapId, "Field map");
      if (!next.projectDocuments.some((entry) => entry.summary.id === input.pivotProjectId)) fail("not_found", "Saved project document is required.");
      if (next.catalog.designs.some((entry) => payloadId(entry) === input.pivotProjectId)) fail("conflict", "Document already has an owning design.");
      const design: WorkspaceDesignRecord = { ...input, name: normalizeCatalogSortName(input.name), isActive: input.isActive ?? true, kind: "project", revision: 0, createdAt: cmd.now, updatedAt: cmd.now };
      next.catalog.designs.push(design);
      value = legacyDesign(design);
      break;
    }
  }
  next.revision = revision;
  assertRetainedOperationalEvidence(workspace, next);
  return { workspace: validateWorkspaceDocument(next), value };
}

function fieldDesign(workspace: WorkspaceDocument, designId: string, revision: number): Extract<WorkspaceDesignRecord, { kind: "field" }> {
  const design = requireRecord(workspace.catalog.designs, designId, "Field design");
  if (design.kind !== "field") fail("identity_mismatch", "Field operation requires a field-backed design.");
  if (design.revision !== revision) fail("conflict", "Field design revision changed; reload before saving.");
  return design;
}

function createField(workspace: WorkspaceDocument, command: { designId: string; fieldMapId: string; name: string; isActive?: boolean; now: string }, field: FieldDesign) {
  if (workspace.workspaceVersion !== FIELD_WORKSPACE_DOCUMENT_VERSION && workspace.workspaceVersion !== LAYOUT_WORKSPACE_DOCUMENT_VERSION) fail("unsupported_version", "Explicitly upgrade the workspace to v2 before creating field designs.");
  const design: Extract<WorkspaceDesignRecord, { kind: "field" }> = { id: command.designId, fieldMapId: command.fieldMapId,
    name: normalizeCatalogSortName(command.name), kind: "field", fieldDesignId: field.id, isActive: command.isActive ?? true,
    revision: 0, createdAt: command.now, updatedAt: command.now };
  return { design, workspace: createWorkspaceDesign(workspace, { design, document: serializeFieldDesignDocument(field) }) };
}

function saveOwned(workspace: WorkspaceDocument, designId: string, project: PivotProject, updatedAt: string): WorkspaceDocument {
  const design = requireRecord(workspace.catalog.designs, designId, "Design");
  if (design.kind !== "project" || design.pivotProjectId !== project.id) fail("identity_mismatch", "Save requires the selected project-backed design's original payload identity.");
  assertStoredProjectEditable(workspace.projectDocuments.find(entry => entry.summary.id === project.id)!.document);
  return saveWorkspaceDesign(workspace, { designId, expectedRevision: design.revision, document: serializeProjectDocument(project), updatedAt });
}

function assertStoredProjectEditable(document: string): void {
  try { parseEditableProjectDocument(document); }
  catch (error) {
    fail("invalid_document", `Stored project contains unsupported fields or invalid data; export recovery and use a compatible editor. ${error instanceof Error ? error.message : ""}`);
  }
}

function projectEntry(project: PivotProject, updatedAt: string): WorkspaceDocument["projectDocuments"][number] {
  return { summary: { id: project.id, name: project.name, projectCrs: project.projectCrs, unitSystem: project.unitSystem, updatedAt }, document: serializeProjectDocument(project) };
}

function addProject(workspace: WorkspaceDocument, input: CreateProjectRecordCommand["input"], timestamp: string): CatalogProjectRecord {
  assertUnused(workspace.catalog.projects, input.id, "Project folder");
  assertUnusedPayload(workspace, input.id);
  requireRecord(workspace.catalog.clients, input.clientId, "Client");
  const record = { ...input, name: normalizeCatalogSortName(input.name), createdAt: timestamp, updatedAt: timestamp };
  workspace.catalog.projects.push(record);
  return record;
}

function addFieldMap(workspace: WorkspaceDocument, input: CreateFieldMapRecordCommand["input"], timestamp: string): FieldMapRecord {
  assertUnused(workspace.catalog.fieldMaps, input.id, "Field map");
  requireRecord(workspace.catalog.projects, input.projectId, "Project folder");
  const record = { ...input, name: normalizeCatalogSortName(input.name), createdAt: timestamp, updatedAt: timestamp };
  workspace.catalog.fieldMaps.push(record);
  return record;
}

function deleteProject(workspace: WorkspaceDocument, projectId: string, deletedAt: string, revision: number): void {
  const folder = workspace.catalog.projects.find((record) => record.id === projectId);
  const mapIds = new Set(folder ? workspace.catalog.fieldMaps.filter((record) => record.projectId === projectId).map((record) => record.id) : []);
  if (workspace.layoutSessions?.some(entry => mapIds.has(parseLayoutSessionDocument(entry.document).fieldMapId))) fail("conflict", "This project owns retained Layout sessions. Keep the project to preserve their field context.");
  // A matching payload owned by a different folder is outside this cascade.
  const removedDesigns = workspace.catalog.designs.filter((record) => folder ? mapIds.has(record.fieldMapId) : record.kind === "project" && record.pivotProjectId === projectId);
  const documents = new Set(removedDesigns.filter((record) => record.kind === "project").map(payloadId));
  const drafts = new Set(removedDesigns.filter((record) => record.kind === "draft").map(payloadId));
  const fields = new Set(removedDesigns.filter(record => record.kind === "field").map(payloadId));
  const matchingDocument = workspace.projectDocuments.some((entry) => entry.summary.id === projectId);
  const matchingOwner = workspace.catalog.designs.find((record) => record.kind === "project" && record.pivotProjectId === projectId);
  if (!folder) {
    if (!matchingDocument) fail("not_found", "Project folder or document no longer exists.");
    documents.add(projectId);
  } else if (matchingDocument && !matchingOwner) {
    documents.add(projectId);
    workspace.tombstones.push({ entity: "project_document", id: projectId, revision, deletedAt });
  }
  for (const design of removedDesigns) {
    const deletedRevision = increment(design.revision);
    workspace.tombstones.push({ entity: "design", id: design.id, revision: deletedRevision, deletedAt });
    workspace.tombstones.push({ entity: design.kind === "project" ? "project_document" : design.kind === "draft" ? "draft_document" : "field_document", id: payloadId(design), revision: deletedRevision, deletedAt });
  }
  if (!folder && removedDesigns.length === 0) workspace.tombstones.push({ entity: "project_document", id: projectId, revision, deletedAt });
  const designIds = new Set(removedDesigns.map((record) => record.id));
  workspace.catalog.designs = workspace.catalog.designs.filter((record) => !designIds.has(record.id));
  workspace.projectDocuments = workspace.projectDocuments.filter((entry) => !documents.has(entry.summary.id));
  workspace.draftDocuments = workspace.draftDocuments.filter((entry) => !drafts.has(entry.id));
  if (workspace.fieldDocuments) workspace.fieldDocuments = workspace.fieldDocuments.filter(entry => !fields.has(entry.id));
  if (folder) {
    workspace.catalog.projects = workspace.catalog.projects.filter((record) => record.id !== projectId);
    workspace.catalog.fieldMaps = workspace.catalog.fieldMaps.filter((record) => !mapIds.has(record.id));
  }
}

function legacyDesign(design: WorkspaceDesignRecord & { kind: "project" }): DesignRecord {
  const { kind: _kind, revision: _revision, ...record } = design;
  return record;
}

function normalizeClientInput(input: Partial<ClientRecord> & Pick<ClientRecord, "id" | "createdAt" | "updatedAt">): ClientRecord {
  const line = (value: string | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
  const profile = {
    ...emptyClientProfileFields(), ...input,
    companyName: line(input.companyName), primaryContactFirstName: line(input.primaryContactFirstName),
    primaryContactLastName: line(input.primaryContactLastName),
    primaryContactMiddleInitial: line(input.primaryContactMiddleInitial).replace(/\./g, "").slice(0, 1).toUpperCase(),
    primaryContactSuffix: line(input.primaryContactSuffix), email: line(input.email), phone: line(input.phone),
    location: line(input.location), notes: (input.notes ?? "").trim(),
  };
  try { assertClientPrimaryContact(profile); } catch { fail("invalid_document", "Primary contact first and last name are required."); }
  const contactName = formatPrimaryContactName(profile);
  const displayName = normalizeCatalogSortName(resolveClientDisplayName(profile));
  return { ...profile, contactName, displayName, sortName: normalizeCatalogSortName(resolveClientSortName(profile)) };
}

function definedFields<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}

function payloadId(design: WorkspaceDesignRecord): string { return design.kind === "field" ? design.fieldDesignId : design.kind === "project" ? design.pivotProjectId : design.draftId; }
function assertUnusedPayload(workspace: WorkspaceDocument, id: string): void {
  if (workspace.projectDocuments.some((entry) => entry.summary.id === id) || workspace.draftDocuments.some((entry) => entry.id === id)
    || (workspace.fieldDocuments ?? []).some(entry => entry.id === id)
    || workspace.tombstones.some((entry) => entry.entity !== "design" && entry.id === id)) fail("conflict", "Document identity is already used or deleted.");
}
function assertUnused(records: { id: string }[], id: string, label: string): void {
  if (records.some((record) => record.id === id)) fail("conflict", `${label} identity is already used.`);
}
function requireRecord<T extends { id: string }>(records: T[], id: string, label: string): T {
  const record = records.find((entry) => entry.id === id);
  if (!record) fail("not_found", `${label} does not exist.`);
  return record;
}
function increment(value: number): number {
  if (value === Number.MAX_SAFE_INTEGER) fail("revision_exhausted", "Persisted revision limit reached.");
  return value + 1;
}
function fail(code: ConstructorParameters<typeof WorkspaceDocumentError>[0], message: string): never { throw new WorkspaceDocumentError(code, message); }

/** Reject accessors, exotic prototypes, cycles and hidden fields before any parser can drop them. */
function assertPlainData(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value !== "object") {
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") fail("invalid_document", "Unsupported mutation value.");
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (Array.isArray(value) ? Array.prototype : Object.prototype) && prototype !== null) fail("invalid_document", "Unsupported object prototype.");
  for (let inherited = prototype; inherited !== null; inherited = Object.getPrototypeOf(inherited)) {
    if (Object.getOwnPropertyDescriptor(inherited, "toJSON")) fail("invalid_document", "Inherited JSON hooks are unsupported.");
  }
  if (ancestors.has(value)) fail("invalid_document", "Cyclic workspace arguments.");
  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || key === "prototype" || Object.hasOwn(Object.prototype, key)
      || !descriptor.enumerable || !("value" in descriptor)
      || (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key))) fail("invalid_document", "Unsupported mutation property.");
    assertPlainData(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

function assertNoStrippedFields(input: unknown, parsed: unknown, message = "Unknown mutation field would be discarded."): void {
  if (input === null || typeof input !== "object") return;
  for (const key of Object.keys(input)) {
    if (parsed === null || typeof parsed !== "object" || !Object.hasOwn(parsed, key)) fail("invalid_document", message);
    assertNoStrippedFields((input as Record<string, unknown>)[key], (parsed as Record<string, unknown>)[key], message);
  }
}

function requireLayoutWorkspace(workspace: WorkspaceDocument): void {
  if (workspace.workspaceVersion !== LAYOUT_WORKSPACE_DOCUMENT_VERSION || !workspace.layoutSessions) fail("unsupported_version", "Choose Upgrade workspace for Layout before creating or changing a Layout session.");
}
function readLayoutSession(workspace: WorkspaceDocument, sessionId: string, expectedRevision: number): LayoutSession {
  requireLayoutWorkspace(workspace);
  const entry = requireRecord(workspace.layoutSessions!, sessionId, "Layout session");
  const session = parseLayoutSessionDocument(entry.document);
  if (session.revision !== expectedRevision) fail("conflict", "Layout session changed; reopen it before saving.");
  return session;
}
function insertLayoutSession(workspace: WorkspaceDocument, session: LayoutSession): void {
  requireRecord(workspace.catalog.fieldMaps, session.fieldMapId, "Layout session field");
  assertUnused(workspace.layoutSessions!, session.id, "Layout session");
  workspace.layoutSessions!.push({ id: session.id, document: serializeLayoutSessionDocument(session) });
}
