import React, { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { assertProjectedCrs, parseStrictJson } from "@cplayout/core";
import { createCatalogId, importDesignWorkspaceBundleZip, parseDesignWorkspaceBundle,
  type ClientRecord, type DesignWorkspaceBundle, type WorkspaceCommand, type WorkspaceCommandValue } from "@cplayout/project-store";
import type { LocalIntentReceipt } from "./useWorkspaceController";
import type { ProjectCatalogContext, ProjectWorkspaceStatus } from "../hooks/useProjectRepository";
import { ClientProfileDialog, ConfirmActionDialog, ProjectCatalogDialog, validateCatalogFormRawState,
  type CatalogFormRawState, type CatalogFormRecoveryHandle, type CatalogFormRecoveryDelivery, type ClientProfileDialogValue } from "../components/ProjectCatalogDialog";
import { CATALOG_IMPORT_MAX_BYTES, previewCatalogImport, type CatalogImportPreview } from "../components/catalogArchivePayload";
import { newDesignDraft } from "../newDesignDraft";
import { decodeWorkspaceRecoveryImport, parseWorkspaceEditRecovery, workspaceRecoveryBytesSha256, workspaceRecoveryStableJson,
  WORKSPACE_EDIT_RECOVERY_MAX_BYTES, type WorkspaceEditRecoveryUi, type WorkspaceRecoveryImport } from "./workspaceEditRecovery";
import { useWorkspaceRecoveryParticipant, type WorkspaceRecoveryParticipants, type WorkspaceRecoveryParticipant,
  type WorkspaceRecoveryDelivery } from "./workspaceRecoveryParticipants";

export interface WorkspaceCatalogProps {
  repository: ProjectWorkspaceStatus;
  recoveryParticipants?: WorkspaceRecoveryParticipants;
  onUserIntent?: () => LocalIntentReceipt | void;
  getLocalIntentReceipt?: () => LocalIntentReceipt | null;
  onSelectionChange?: (context: ProjectCatalogContext, intent?: LocalIntentReceipt) => void;
  resumeSelection?: { generation: number; context: ProjectCatalogContext; isCurrent: () => boolean } | null;
  activeContext?: ProjectCatalogContext | null;
  currentFieldCreationRequest?: { readonly id: string | number; readonly context: ProjectCatalogContext; readonly isCurrent: () => boolean; readonly acknowledge: () => void } | null;
  activeLayoutFieldMapId?: string | null;
  visible?: boolean;
  presentation?: "embedded" | "dialog";
  busy?: boolean;
  onPendingStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
  executeCatalog: (command: WorkspaceCommand, review?: { expectedWorkspaceRevision: number; isCurrent: () => boolean }) => Promise<WorkspaceCommandValue>;
  openDesign: (designId: string, reload?: boolean) => Promise<boolean>;
  closeDesign: () => boolean;
  closeLayout?: () => boolean;
  importDesignWorkspace: (bundle: DesignWorkspaceBundle, fieldMapId: string, review?: { expectedWorkspaceRevision: number; isCurrent: () => boolean }) => Promise<string | null>;
  preparePackageStorageStep?: (bundle: DesignWorkspaceBundle, fieldMapId: string, review: { expectedWorkspaceRevision: number; isCurrent: () => boolean }) => Promise<{ workspaceRevision: number; workspaceVersion: string }>;
  onOpenLayoutCatalog?: () => void;
  onClose: (intent?: LocalIntentReceipt) => void;
}
export type CatalogCreateKind = "client" | "project" | "fieldMap" | "design";
export const EMPTY_CATALOG_SELECTION: ProjectCatalogContext = { clientId: null, projectId: null, fieldMapId: null, designId: null };
type Catalog = ProjectWorkspaceStatus["catalog"] | NonNullable<ProjectWorkspaceStatus["designCatalog"]>;
export function normalizeCatalogSelection(catalog: Catalog, input: ProjectCatalogContext): ProjectCatalogContext {
  const customer = catalog.clients.find(item => item.id === input.clientId);
  const project = customer && catalog.projects.find(item => item.id === input.projectId && item.clientId === customer.id);
  const field = project && catalog.fieldMaps.find(item => item.id === input.fieldMapId && item.projectId === project.id);
  const design = field && catalog.designs.find(item => item.id === input.designId && item.fieldMapId === field.id);
  return { clientId: customer?.id ?? null, projectId: project?.id ?? null, fieldMapId: field?.id ?? null, designId: design?.id ?? null };
}
export function nextCatalogCreate(catalog: Catalog, selection: ProjectCatalogContext): CatalogCreateKind {
  const current = normalizeCatalogSelection(catalog, selection);
  return !current.clientId ? "client" : !current.projectId ? "project" : !current.fieldMapId ? "fieldMap" : "design";
}
export function catalogDesignContext(catalog: Catalog, designId: string): ProjectCatalogContext {
  const design = catalog.designs.find(item => item.id === designId);
  const field = catalog.fieldMaps.find(item => item.id === design?.fieldMapId);
  const project = catalog.projects.find(item => item.id === field?.projectId);
  if (!design || !field || !project || !catalog.clients.some(item => item.id === project.clientId)) throw new Error("The saved design's customer/project/field context is missing. Refresh the catalog.");
  return { clientId: project.clientId, projectId: project.id, fieldMapId: field.id, designId };
}
export function createCatalogCommand(kind: Exclude<CatalogCreateKind, "client">, catalog: Catalog, selection: ProjectCatalogContext,
  values: { name: string; firstFieldName?: string; projectCrs?: string; unitSystem?: string },
  ids: { projectId?: string; fieldMapId?: string; designId?: string; payloadId?: string }, now: string): WorkspaceCommand {
  const current = normalizeCatalogSelection(catalog, selection), name = values.name.trim();
  if (!name) throw new Error("Enter a name.");
  if (kind === "project") {
    if (!current.clientId) throw new Error("Select a customer before creating a project.");
    const projectCrs = values.projectCrs?.trim(), fieldMapName = values.firstFieldName?.trim();
    if (!projectCrs) throw new Error("Enter the project's projected or local coordinate system. No location or CRS is supplied automatically.");
    assertProjectedCrs(projectCrs);
    if (!fieldMapName) throw new Error("Enter a name for the first field.");
    if (values.unitSystem !== "metric" && values.unitSystem !== "us_survey_feet") throw new Error("Choose Imperial or Metric units.");
    if (!ids.projectId || !ids.fieldMapId) throw new Error("Project and field identities are required.");
    return { type: "create_project_with_initial_field_map", now, input: { clientId: current.clientId, projectId: ids.projectId,
      projectName: name, projectCrs, unitSystem: values.unitSystem, fieldMapId: ids.fieldMapId, fieldMapName } };
  }
  if (kind === "fieldMap") {
    if (!current.projectId || !ids.fieldMapId) throw new Error("Select the destination project before creating a field.");
    return { type: "create_field_map_record", now, input: { id: ids.fieldMapId, projectId: current.projectId, name } };
  }
  const project = catalog.projects.find(item => item.id === current.projectId);
  if (!current.fieldMapId || !project || !ids.designId || !ids.payloadId) throw new Error("Select a field before creating a design.");
  if (project.unitSystem !== "metric" && project.unitSystem !== "us_survey_feet") throw new Error("The project units require repair before creating a design.");
  assertProjectedCrs(project.projectCrs);
  // Inherit only the actual operator-declared catalog CRS; an empty Draft gains no sample location or machine.
  const draft = { ...newDesignDraft(ids.payloadId, name, project.unitSystem), projectCrs: project.projectCrs };
  return { type: "create_design_draft", now, designId: ids.designId, fieldMapId: current.fieldMapId, draft, name };
}
export type WorkspaceCatalogImport = { format: "complete"; bundle: DesignWorkspaceBundle; name: string; projectCrs: string | null }
  | { format: "design_only"; preview: CatalogImportPreview; name: string; projectCrs: string | null };
export function previewWorkspaceCatalogImport(bytes: Uint8Array, filename: string): WorkspaceCatalogImport {
  if (!bytes.length || bytes.length > CATALOG_IMPORT_MAX_BYTES) throw new Error("Choose a nonempty CPLayout JSON or ZIP file no larger than 25 MB.");
  const zip = /\.zip$/i.test(filename) || (bytes[0] === 0x50 && bytes[1] === 0x4b);
  if (zip) {
    try {
      const bundle = importDesignWorkspaceBundleZip(bytes);
      const design = previewCatalogImport(new TextEncoder().encode(bundle.designDocument), "design.json");
      return { format: "complete", bundle, name: design.name, projectCrs: design.projectCrs };
    } catch (bundleFailure) {
      try { const preview = previewCatalogImport(bytes, filename); return { format: "design_only", preview, name: preview.name, projectCrs: preview.projectCrs }; }
      catch (designFailure) { throw new Error(`No supported complete package or design archive was found. ${designFailure instanceof Error ? designFailure.message : String(designFailure)} Keep the original file.`); }
    }
  }
  const document = new TextDecoder("utf-8", { fatal: true }).decode(bytes), raw = parseStrictJson(document);
  if (raw && typeof raw === "object" && "bundleVersion" in raw) {
    const bundle = parseDesignWorkspaceBundle(document), design = previewCatalogImport(new TextEncoder().encode(bundle.designDocument), "design.json");
    return { format: "complete", bundle, name: design.name, projectCrs: design.projectCrs };
  }
  const preview = previewCatalogImport(bytes, filename);
  return { format: "design_only", preview, name: preview.name, projectCrs: preview.projectCrs };
}

type FormSession = { sequence: number; kind: CatalogCreateKind | "edit_client" | "rename_project" | "rename_field_map"; context: ProjectCatalogContext;
  revision: number; defaultName: string; client?: ClientRecord; sourceFingerprint: string; recoveryNeedsReview?: boolean };
type Confirmation = { kind: "delete_client" | "delete_project" | "delete_design" | "close_import"; id: string; name: string; revision: number };
type MoveReview = { context: ProjectCatalogContext; revision: number; sourceFingerprint: string };
function contextFingerprint(catalog: Catalog, context: ProjectCatalogContext): string {
  return JSON.stringify([catalog.clients.find(item => item.id === context.clientId) ?? null,
    catalog.projects.find(item => item.id === context.projectId) ?? null,
    catalog.fieldMaps.find(item => item.id === context.fieldMapId) ?? null]);
}
function labelForKind(kind: CatalogCreateKind): string { return kind === "client" ? "customer" : kind === "fieldMap" ? "field" : kind; }

/** Supporting management only: shared status and controller commands own all storage and document opening. */
export function WorkspaceCatalog(props: WorkspaceCatalogProps): React.JSX.Element {
  const { repository, visible = true, presentation = "dialog", busy = false } = props;
  const catalog = repository.designCatalog ?? repository.catalog;
  const current = useRef(props); current.current = props;
  const actor = useRef<object>({}), renderedActor = actor.current;
  const recoveryEpoch = useRef(0), deliveryPending = useRef<WorkspaceRecoveryDelivery | null>(null);
  const [delivering, setDelivering] = useState(false);
  const formRecoveryHandle = useRef<CatalogFormRecoveryHandle | null>(null);
  const [childDelivery, setChildDelivery] = useState<CatalogFormRecoveryDelivery | null>(null);
  const childAcknowledgement = useRef<{ reject: (error: Error) => void } | null>(null);
  const viewAcknowledgement = useRef<{ id: string; snapshot: WorkspaceEditRecoveryUi["catalog"]; resolve: () => void; reject: (error: Error) => void } | null>(null);
  const [deliveryRender, setDeliveryRender] = useState<string | null>(null);
  const projectCrsInput = useRef<TextInput>(null), importNameInput = useRef<TextInput>(null);
  const moveNeedsReview = useRef(false), importIoPending = useRef(false);
  const originalUpload = useRef<{ name: string; bytes: Uint8Array } | null>(null);
  function canEditUser() { return actor.current === renderedActor && !deliveryPending.current && current.current.visible !== false && current.current.recoveryParticipants?.canEdit() !== false; }
  function changed() { recoveryEpoch.current++; current.current.recoveryParticipants?.notifyChanged(); }
  function userAction<T extends unknown[]>(action: (...args: T) => void): (...args: T) => void {
    return (...args) => { if (!canEditUser()) return; action(...args); changed(); };
  }
  const visibilityOwner = useRef({ visible, generation: 0 });
  if (visibilityOwner.current.visible !== visible) visibilityOwner.current = { visible, generation: visibilityOwner.current.generation + 1 };
  const mounted = useRef(true), operation = useRef(0), workingRef = useRef(false), formSequence = useRef(0);
  const [selection, renderSelection] = useState<ProjectCatalogContext>(() => normalizeCatalogSelection(catalog, props.activeContext ?? EMPTY_CATALOG_SELECTION));
  const selectionRef = useRef(selection), consumedResume = useRef(0);
  function setSelection(value: React.SetStateAction<ProjectCatalogContext>, publish = true) {
    const next = typeof value === "function" ? value(selectionRef.current) : value;
    selectionRef.current = next; renderSelection(next); if (publish && !deliveryPending.current && current.current.recoveryParticipants?.canEdit() !== false) current.current.onSelectionChange?.(next);
  }
  useEffect(() => {
    const delivery = current.current.resumeSelection;
    if (!delivery || consumedResume.current === delivery.generation || !delivery.isCurrent()
      || workingRef.current || formRef.current || moveReviewRef.current || importFilenameRef.current && !savedImportIdRef.current) return;
    consumedResume.current = delivery.generation;
    setSelection(normalizeCatalogSelection(current.current.repository.designCatalog ?? current.current.repository.catalog, delivery.context));
  }, [props.resumeSelection?.generation, repository.catalogRevision]);
  const [activity, setActivity] = useState<"catalog" | "guarded_open" | null>(null);
  const working = activity !== null;
  const [message, renderMessage] = useState<string | null>(null), [failed, renderFailed] = useState(false);
  const messageRef = useRef(message), failedRef = useRef(failed);
  function setMessage(value: string | null) { messageRef.current = value; renderMessage(value); }
  function setFailed(value: boolean) { failedRef.current = value; renderFailed(value); }
  const [form, setForm] = useState<FormSession | null>(null); const formRef = useRef(form);
  const [projectCrs, renderProjectCrs] = useState(""), [units, renderUnits] = useState("us_survey_feet");
  const projectCrsRef = useRef(projectCrs), unitsRef = useRef(units);
  function setProjectCrs(value: string) { projectCrsRef.current = value; renderProjectCrs(value); }
  function setUnits(value: string) { unitsRef.current = value; renderUnits(value); }
  const [confirmation, renderConfirmation] = useState<Confirmation | null>(null);
  const confirmationRef = useRef(confirmation);
  function setConfirmation(value: Confirmation | null) { confirmationRef.current = value; renderConfirmation(value); }
  const [moveOpen, renderMoveOpen] = useState(false), [moveCustomerId, renderMoveCustomerId] = useState("");
  const moveOpenRef = useRef(moveOpen), moveCustomerRef = useRef(moveCustomerId);
  function setMoveOpen(value: boolean) { moveOpenRef.current = value; renderMoveOpen(value); }
  function setMoveCustomerId(value: string) { moveCustomerRef.current = value; renderMoveCustomerId(value); }
  const [moveReview, setMoveReviewState] = useState<MoveReview | null>(null); const moveReviewRef = useRef(moveReview);
  const [importCandidate, setImportCandidateState] = useState<WorkspaceCatalogImport | null>(null), [importFilename, setImportFilenameState] = useState("");
  const importCandidateRef = useRef(importCandidate);
  const importFilenameRef = useRef(importFilename);
  function setMoveReview(value: MoveReview | null) { moveReviewRef.current = value; setMoveReviewState(value); }
  function setImportCandidate(value: WorkspaceCatalogImport | null) { importCandidateRef.current = value; setImportCandidateState(value); }
  function setImportFilename(value: string) { importFilenameRef.current = value; setImportFilenameState(value); }
  const [importFieldId, renderImportFieldId] = useState(""), [importName, renderImportName] = useState("");
  const importFieldRef = useRef(importFieldId), importNameRef = useRef(importName), importIntent = useRef(0);
  const [importRevision, renderImportRevision] = useState<number | null>(null), [savedImportId, setSavedImportIdState] = useState<string | null>(null);
  const importRevisionRef = useRef(importRevision);
  const [, renderImportIntent] = useState(0);
  function advanceImportIntent() { importIntent.current++; renderImportIntent(importIntent.current); }
  function setImportFieldId(value: string) { importFieldRef.current = value; advanceImportIntent(); renderImportFieldId(value); }
  function setImportName(value: string) { importNameRef.current = value; advanceImportIntent(); renderImportName(value); }
  function setImportRevision(value: number | null) { importRevisionRef.current = value; advanceImportIntent(); renderImportRevision(value); }
  const savedImportIdRef = useRef(savedImportId);
  function setSavedImportId(value: string | null) { savedImportIdRef.current = value; setSavedImportIdState(value); }
  const renderedImportIntent = importIntent.current, renderedVisibilityGeneration = visibilityOwner.current.generation;
  const unfinished = form !== null || moveOpen || (!!importFilename && !savedImportId);
  // The controller owns both Open replacement guards. Reporting its own read as
  // pending catalog work would make the second guard reject every clean Open.
  // Unfinished input remains dirty; unrelated catalog operations still report busy.
  useEffect(() => { props.onPendingStateChange?.({ dirty: unfinished, busy: activity === "catalog" }); }, [props.onPendingStateChange, unfinished, activity]);
  useEffect(() => () => { current.current.onPendingStateChange?.({ dirty: false, busy: false }); }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current++; const error = new Error("The catalog unmounted during recovery delivery."); childAcknowledgement.current?.reject(error); viewAcknowledgement.current?.reject(error); }; }, []);
  useEffect(() => { setSelection(value => normalizeCatalogSelection(catalog, value)); }, [repository.catalogRevision]);
  const selected = normalizeCatalogSelection(catalog, selection);
  const customer = catalog.clients.find(item => item.id === selected.clientId), project = catalog.projects.find(item => item.id === selected.projectId);
  const field = catalog.fieldMaps.find(item => item.id === selected.fieldMapId), design = catalog.designs.find(item => item.id === selected.designId);
  const blocked = busy || working || delivering || props.recoveryParticipants?.canEdit() === false || repository.catalogRevision === null;
  const nextCreate = nextCatalogCreate(catalog, selected);
  function liveCatalog(): Catalog { return current.current.repository.designCatalog ?? current.current.repository.catalog; }
  function readRevision(): number { const revision = current.current.repository.catalogRevision; if (revision === null) throw new Error("Refresh saved work before changing the catalog."); return revision; }
  function notice(error: unknown) { setFailed(true); setMessage(error instanceof Error ? error.message : String(error)); }
  function select(context: ProjectCatalogContext) {
    if (!canEditUser()) return;
    const intent = current.current.onUserIntent?.();
    if (blocked || workingRef.current || current.current.busy || current.current.visible === false || formRef.current || moveOpen) return;
    setSelection(normalizeCatalogSelection(catalog, context));
    current.current.onSelectionChange?.(selectionRef.current, intent || undefined); setMessage(null); setFailed(false);
    changed();
  }
  function showForm(kind: FormSession["kind"]) {
    if (!canEditUser()) return;
    const intent = current.current.onUserIntent?.();
    if (blocked || workingRef.current || current.current.busy || current.current.visible === false || formRef.current || moveOpen) return;
    const next: FormSession = { sequence: ++formSequence.current, kind, context: { ...selected }, revision: readRevision(),
      defaultName: kind === "rename_project" ? project?.name ?? "" : kind === "rename_field_map" ? field?.name ?? "" : "", ...(kind === "edit_client" && customer ? { client: customer } : {}), sourceFingerprint: contextFingerprint(catalog, selected) };
    formRef.current = next; setForm(next); setProjectCrs(""); setUnits("us_survey_feet"); setMessage(null); setFailed(false);
    changed();
  }
  function closeForm(session: FormSession) { if (!canEditUser() || workingRef.current || formRef.current !== session) return; formRef.current = null; setForm(null); setMessage(null); changed(); }
  function checkForm(session: FormSession) {
    if (formRef.current !== session || !current.current.visible && current.current.visible !== undefined) throw new Error("Return to this catalog form before submitting.");
    if (session.recoveryNeedsReview) throw new Error("Recheck the recovered form against its current saved destination before saving. Your raw values are retained.");
    if (readRevision() !== session.revision || contextFingerprint(liveCatalog(), session.context) !== session.sourceFingerprint) throw new Error("Saved catalog context changed. Recheck it before saving; your entered values are retained.");
  }
  function recheckForm(session: FormSession) {
    if (!canEditUser() || formRef.current !== session || workingRef.current) return;
    changed();
    try {
      const latest = liveCatalog();
      if (JSON.stringify(normalizeCatalogSelection(latest, session.context)) !== JSON.stringify(session.context)) throw new Error("The original customer/project/field selection changed. Keep your entry; cancel and select its current destination before reopening the form.");
      if ((session.kind === "edit_client" || session.kind === "rename_project" || session.kind === "rename_field_map") && contextFingerprint(latest, session.context) !== session.sourceFingerprint) throw new Error("This saved item changed while you edited it. Your entry is retained; cancel and reopen the current item before overwriting it.");
      const next = { ...session, revision: readRevision(), sourceFingerprint: contextFingerprint(latest, session.context), recoveryNeedsReview: false }; formRef.current = next; setForm(next); setMessage(null); setFailed(false);
    } catch (error) { notice(error); }
  }
  async function run<T>(action: (isCurrent: () => boolean) => Promise<T>, kind: "catalog" | "guarded_open" = "catalog"): Promise<T> {
    if (!canEditUser() || workingRef.current || current.current.busy || current.current.visible === false || !mounted.current) throw new Error("Return to the catalog and finish its current action before submitting.");
    const owner = ++operation.current; workingRef.current = true; setActivity(kind); setMessage(null); setFailed(false);
    const isCurrent = () => mounted.current && owner === operation.current && actor.current === renderedActor && current.current.recoveryParticipants?.canEdit() !== false;
    const initialIntent = current.current.onUserIntent?.();
    try {
      const pending = action(isCurrent);
      const intent = current.current.getLocalIntentReceipt?.() ?? initialIntent;
      const result = await pending;
      if (isCurrent() && intent) current.current.onSelectionChange?.(selectionRef.current, intent);
      return result;
    }
    catch (error) { if (mounted.current && owner === operation.current) notice(error); throw error; }
    finally { workingRef.current = false; if (mounted.current && owner === operation.current) setActivity(null); }
  }
  // Pin the actual UI owner and exact reviewed destination across the storage wait.
  function mutationCompletion(operationCurrent: () => boolean, ownsInput: () => boolean) {
    const epoch = recoveryEpoch.current, actorOwner = actor.current, visibility = visibilityOwner.current.generation;
    return () => operationCurrent() && mounted.current && actor.current === actorOwner && recoveryEpoch.current === epoch
      && visibilityOwner.current.generation === visibility && current.current.visible !== false && ownsInput();
  }
  function mutationReview(revision: number, operationCurrent: () => boolean, ownsInput: () => boolean) {
    const completionCurrent = mutationCompletion(operationCurrent, ownsInput);
    return { expectedWorkspaceRevision: revision, isCurrent: () => completionCurrent() && readRevision() === revision };
  }
  function formReview(session: FormSession, operationCurrent: () => boolean) {
    return mutationReview(session.revision, operationCurrent, () => formRef.current === session && !session.recoveryNeedsReview
      && contextFingerprint(liveCatalog(), session.context) === session.sourceFingerprint);
  }
  const consumedCreationRequest = useRef<string | number | null>(null);
  useEffect(() => {
    const request = current.current.currentFieldCreationRequest;
    if (!request || consumedCreationRequest.current === request.id || !request.isCurrent() || !canEditUser()
      || blocked || workingRef.current || formRef.current || moveReviewRef.current || importFilenameRef.current && !savedImportIdRef.current) return;
    const destination = normalizeCatalogSelection(liveCatalog(), request.context);
    if (!destination.fieldMapId || destination.designId !== null || JSON.stringify(destination) !== JSON.stringify(request.context)) return;
    const next: FormSession = { sequence: ++formSequence.current, kind: "design", context: { ...destination }, revision: readRevision(),
      defaultName: "", sourceFingerprint: contextFingerprint(liveCatalog(), destination) };
    if (!request.isCurrent()) return;
    formRef.current = next; setForm(next); setProjectCrs(""); setUnits("us_survey_feet"); setMessage(null); setFailed(false);
    consumedCreationRequest.current = request.id; changed(); request.acknowledge();
  }, [props.currentFieldCreationRequest?.id, visible, blocked, repository.catalogRevision]);
  async function submitProfile(session: FormSession, value: ClientProfileDialogValue) {
    await run(async isCurrent => {
      checkForm(session);
      const completionCurrent = mutationCompletion(isCurrent, () => formRef.current === session);
      const command: WorkspaceCommand = session.kind === "edit_client" && session.client
        ? { type: "update_client", now: new Date().toISOString(), input: { id: session.client.id, ...value } }
        : { type: "create_client", now: new Date().toISOString(), id: createCatalogId("client"), input: value };
      const result = await current.current.executeCatalog(command, formReview(session, isCurrent));
      if (completionCurrent()) {
        const id = session.client?.id ?? (result && typeof result === "object" && "id" in result ? result.id : command.type === "create_client" ? command.id : null);
        if (id) setSelection({ ...EMPTY_CATALOG_SELECTION, clientId: id });
        formRef.current = null; setForm(null); setMessage(session.kind === "edit_client" ? "Customer updated." : "Customer created. Select New project to continue.");
      }
    });
  }
  async function submitName(session: FormSession, name: string, firstFieldName?: string) {
    await run(async isCurrent => {
      checkForm(session);
      const completionCurrent = mutationCompletion(isCurrent, () => formRef.current === session);
      const ids = { projectId: createCatalogId("project"), fieldMapId: createCatalogId("field-map"), designId: createCatalogId("design"), payloadId: createCatalogId("draft") };
      const command = session.kind === "rename_project" ? { type: "rename_project" as const, now: new Date().toISOString(), projectId: session.context.projectId!, name }
        : session.kind === "rename_field_map" ? { type: "rename_field_map" as const, now: new Date().toISOString(), fieldMapId: session.context.fieldMapId!, name }
        : createCatalogCommand(session.kind as Exclude<CatalogCreateKind, "client">, liveCatalog(), session.context,
          { name, firstFieldName, projectCrs, unitSystem: units }, ids, new Date().toISOString());
      await current.current.executeCatalog(command, formReview(session, isCurrent));
      if (completionCurrent()) {
        if (session.kind !== "design") setSelection(command.type === "create_project_with_initial_field_map" ? { clientId: session.context.clientId, projectId: ids.projectId, fieldMapId: ids.fieldMapId, designId: null }
          : command.type === "create_field_map_record" ? { ...session.context, fieldMapId: ids.fieldMapId, designId: null }
            : command.type === "create_design_draft" ? { ...session.context, designId: ids.designId } : session.context);
        formRef.current = null; setForm(null); setMessage(command.type === "create_design_draft"
          ? `Draft “${command.name}” saved in field “${liveCatalog().fieldMaps.find(item => item.id === command.fieldMapId)?.name ?? command.fieldMapId}”. Use Open to begin editing it.`
          : "Saved catalog item.");
      }
    });
  }
  async function open(id: string) {
    if (!canEditUser()) return;
    changed();
    try {
      const visibleGeneration = visibilityOwner.current.generation;
      // Ref admission also rejects callbacks retained before the form/upload's
      // pending effect commits. This exception applies only to a clean Open read.
      if (formRef.current || moveReviewRef.current || (importFilenameRef.current && !savedImportIdRef.current)) throw new Error("Finish or discard the catalog's entered form or import review before opening a design.");
      await run(async isCurrent => {
        const pending = current.current.openDesign(id);
        const intent = current.current.getLocalIntentReceipt?.();
        const opened = await pending;
        if (!isCurrent() || current.current.visible === false || visibilityOwner.current.generation !== visibleGeneration) return;
        if (opened) {
          if (!intent || current.current.getLocalIntentReceipt?.() === intent) current.current.onClose(intent ?? undefined);
        } else notice("Open was blocked. Save or preserve your current work before opening this design.");
      }, "guarded_open");
    }
    catch (error) { if (mounted.current && current.current.visible !== false) notice(error); }
  }
  async function closeAffected(projectId: string, deleting: boolean) {
    const latest = liveCatalog(), fields = latest.fieldMaps.filter(item => item.projectId === projectId).map(item => item.id);
    if (deleting && current.current.repository.layoutSessions.some(item => fields.includes(item.fieldMapId))) throw new Error("Saved Layout sessions still reference this project's fields. Keep the project until those references are resolved.");
    if (current.current.activeLayoutFieldMapId && fields.includes(current.current.activeLayoutFieldMapId) && current.current.closeLayout?.() !== true) throw new Error("Finish the open Layout action and preserve its entered text before moving this project.");
    if (current.current.activeContext?.projectId === projectId && !current.current.closeDesign()) throw new Error("Save or discard the current design's unfinished work before changing its project.");
  }
  async function confirm() {
    if (!canEditUser()) return;
    changed();
    const intent = current.current.onUserIntent?.();
    const pending = confirmation; if (!pending || confirmationRef.current !== pending) return;
    if (pending.kind === "close_import") { originalUpload.current = null; setImportCandidate(null); setImportFilename(""); setSavedImportId(null); setConfirmation(null); current.current.onClose(intent || undefined); return; }
    try {
      await run(async isCurrent => {
        if (readRevision() !== pending.revision) throw new Error("Saved catalog changed. Cancel this action and review the current item before deleting it.");
        const completionCurrent = mutationCompletion(isCurrent, () => confirmationRef.current === pending);
        const latest = liveCatalog();
        const source = JSON.stringify([latest.clients, latest.projects, latest.fieldMaps, latest.designs]);
        const receipt = mutationReview(pending.revision, isCurrent, () => confirmationRef.current === pending
          && source === JSON.stringify([liveCatalog().clients, liveCatalog().projects, liveCatalog().fieldMaps, liveCatalog().designs]));
        if (pending.kind === "delete_project") await closeAffected(pending.id, true);
        if (pending.kind === "delete_design") {
          const ctx = catalogDesignContext(latest, pending.id);
          if (current.current.activeLayoutFieldMapId === ctx.fieldMapId && current.current.closeLayout?.() !== true) throw new Error("Preserve the open Layout action before deleting this design. Saved target references can still block deletion.");
          if (current.current.activeContext?.designId === pending.id && !current.current.closeDesign()) throw new Error("Preserve the open design's unfinished work before deleting it.");
        }
        const record = latest.designs.find(item => item.id === pending.id);
        const command: WorkspaceCommand = pending.kind === "delete_client" ? { type: "delete_client", clientId: pending.id, now: new Date().toISOString() }
          : pending.kind === "delete_project" ? { type: "delete_project", projectId: pending.id, now: new Date().toISOString() }
            : { type: "delete_design", designId: pending.id, expectedDesignRevision: record && "revision" in record ? record.revision : 0, now: new Date().toISOString() };
        await current.current.executeCatalog(command, receipt);
        if (completionCurrent()) { setConfirmation(null); setMessage("Catalog item deleted."); }
      });
    } catch { /* keep confirmation and feedback */ }
  }
  async function moveProject() {
    if (!canEditUser()) return;
    changed();
    if (moveNeedsReview.current) { notice("Recheck the recovered move against its current saved project and destination before submitting."); return; }
    const review = moveReview, id = review?.context.projectId; if (!review || !id || !moveCustomerId) return;
    try { await run(async isCurrent => {
      if (moveReviewRef.current !== review) throw new Error("This move review was retired. Submit the current review.");
      if (readRevision() !== review.revision || contextFingerprint(liveCatalog(), review.context) !== review.sourceFingerprint) throw new Error("Saved catalog changed. Recheck the move before submitting; your destination is retained.");
      if (!liveCatalog().clients.some(item => item.id === moveCustomerId)) throw new Error("The destination customer no longer exists. Select its current destination.");
      const completionCurrent = mutationCompletion(isCurrent, () => moveReviewRef.current === review && moveCustomerRef.current === moveCustomerId);
      const destinationId = moveCustomerId, destination = JSON.stringify(liveCatalog().clients.find(item => item.id === destinationId));
      const receipt = mutationReview(review.revision, isCurrent, () => moveReviewRef.current === review && moveOpenRef.current
        && moveCustomerRef.current === destinationId && !moveNeedsReview.current
        && contextFingerprint(liveCatalog(), review.context) === review.sourceFingerprint
        && JSON.stringify(liveCatalog().clients.find(item => item.id === destinationId)) === destination);
      await closeAffected(id, false); await current.current.executeCatalog({ type: "move_project_to_client", projectId: id, clientId: destinationId, now: new Date().toISOString() }, receipt);
      if (completionCurrent()) { setSelection({ ...EMPTY_CATALOG_SELECTION, clientId: moveCustomerId, projectId: id }); setMoveOpen(false); setMoveReview(null); setMessage("Project moved with its fields and designs."); }
    }); }
    catch { /* destination and error stay visible */ }
  }
  function recheckMove() {
    if (!canEditUser() || !moveReview || moveReviewRef.current !== moveReview || workingRef.current) return;
    changed();
    if (contextFingerprint(liveCatalog(), moveReview.context) !== moveReview.sourceFingerprint) { notice("The project or its original customer changed. Your destination is retained; cancel and reopen the current project before moving it."); return; }
    moveNeedsReview.current = false; setMoveReview({ ...moveReview, revision: readRevision() }); setMessage(null);
  }
  async function chooseImport() {
    if (!canEditUser()) return;
    changed();
    const intent = current.current.onUserIntent?.();
    try { await run(async isCurrent => {
      const visibilityGeneration = visibilityOwner.current.generation;
      // A rejected replacement must never leave an older admitted candidate available.
      originalUpload.current = null; setSavedImportId(null); setImportCandidate(null); setImportFilename(""); setImportRevision(null);
      const file = await pickCatalogFile(); if (!file || !isCurrent() || current.current.visible === false || visibilityOwner.current.generation !== visibilityGeneration) return;
      setImportFilename(file.name);
      // Keep detached original bytes before decoding, including malformed uploads.
      originalUpload.current = { name: file.name, bytes: new Uint8Array(file.bytes) };
      const candidate = previewWorkspaceCatalogImport(file.bytes, file.name);
      setImportCandidate(candidate); setImportName(`${candidate.name} copy`); setImportFieldId(selected.fieldMapId ?? ""); setImportRevision(readRevision());
    }); } catch { /* old candidate remains retired; source file stays untouched */ }
  }
  function importReviewOwner(candidate: WorkspaceCatalogImport, isCurrent: () => boolean) {
    const epoch = renderedImportIntent, visibilityGeneration = renderedVisibilityGeneration;
    const fieldId = importFieldId, name = importName, revision = importRevision;
    return () => isCurrent() && current.current.visible !== false && visibilityOwner.current.generation === visibilityGeneration
      && importCandidateRef.current === candidate && importIntent.current === epoch && importFieldRef.current === fieldId
      && importNameRef.current === name && importRevisionRef.current === revision;
  }
  async function prepareImportStorage() {
    if (!canEditUser()) return;
    changed();
    const candidate = importCandidate;
    if (candidate?.format !== "complete" || !importFieldId || importRevision === null || !current.current.preparePackageStorageStep) return;
    try { await run(async isCurrent => {
      const ownsReview = importReviewOwner(candidate, isCurrent);
      if (!ownsReview()) throw new Error("This import review changed. Recheck the current file and destination.");
      const receipt = await current.current.preparePackageStorageStep!(candidate.bundle, importFieldId,
        { expectedWorkspaceRevision: importRevision, isCurrent: ownsReview });
      if (!ownsReview()) return;
      setImportRevision(receipt.workspaceRevision);
      setMessage(receipt.workspaceVersion === "cplayout-workspace-v4"
        ? "Survey storage is prepared. Import saved copy will now save the package separately."
        : "Field and Layout storage is prepared. Prepare Survey storage next; each step retains its previous workspace for recovery.");
    }); } catch { /* file and destination stay available for recheck/retry */ }
  }
  async function saveImport() {
    if (!canEditUser()) return;
    changed();
    const candidate = importCandidate;
    if (!candidate || !importFieldId || importRevision === null) return;
    const submittedUpload = originalUpload.current; importIoPending.current = true;
    try { await run(async isCurrent => {
      const ownsReview = importReviewOwner(candidate, isCurrent);
      if (!ownsReview()) throw new Error("The import file, destination or entered name changed. Submit the current review; your inputs are retained.");
      if (importCandidateRef.current !== candidate) throw new Error("This upload review was replaced. Submit the current file.");
      if (readRevision() !== importRevision) throw new Error("Saved catalog changed. Recheck the destination before importing; the file and name are retained.");
      if (!liveCatalog().fieldMaps.some(item => item.id === importFieldId)) throw new Error("Select an existing destination field.");
      if (candidate.format === "design_only" && !importName.trim()) throw new Error("Enter a name for the imported copy.");
      let id: string | null;
      if (candidate.format === "complete") {
        // Complete import preserves its exact design, collections and original provenance. Rename is a separate supported operation.
        id = await current.current.importDesignWorkspace(candidate.bundle, importFieldId,
          { expectedWorkspaceRevision: importRevision, isCurrent: ownsReview });
      } else {
        id = createCatalogId("design");
        await current.current.executeCatalog({ type: "import_design_document", now: new Date().toISOString(), designId: id,
          payloadId: createCatalogId(candidate.preview.kind), fieldMapId: importFieldId, document: candidate.preview.document, name: importName.trim(),
          ...(candidate.preview.originalProjectDocument === undefined ? {} : { originalProjectDocument: candidate.preview.originalProjectDocument }) },
          { expectedWorkspaceRevision: importRevision, isCurrent: ownsReview });
      }
      if (id && mounted.current && originalUpload.current === submittedUpload) {
        const currentReview = ownsReview(); setSavedImportId(id);
        setMessage(currentReview ? "Imported copy saved. Use Open saved copy when your current design is ready to close."
          : "The submitted copy was saved. Your later entered values remain here; open its saved record or start a new import.");
      }
    }); } catch { /* exact source, raw name and destination remain */ } finally { importIoPending.current = false; }
  }
  function requestClose() {
    if (!canEditUser()) return;
    changed();
    const intent = current.current.onUserIntent?.();
    if (workingRef.current || busy || formRef.current || moveOpen) return;
    if ((importCandidate || importFilename) && !savedImportId) { setConfirmation({ kind: "close_import", id: "", name: "", revision: readRevision() }); return; }
    current.current.onClose(intent || undefined);
  }
  const recoveryParticipant: WorkspaceRecoveryParticipant<"catalog"> = {
    capture() {
      if (workingRef.current || importIoPending.current || childAcknowledgement.current || formRecoveryHandle.current?.isBusy()) throw new Error("Wait for the catalog's admitted action and fresh child form before checkpointing.");
      const session = formRef.current;
      if (session && !formRecoveryHandle.current) throw new Error("Recovery is waiting for the catalog form to finish mounting.");
      const raw = session ? formRecoveryHandle.current!.capture() : null;
      return JSON.parse(workspaceRecoveryStableJson({ projectCrs: projectCrsRef.current, units: unitsRef.current, moveOpen: moveOpenRef.current, moveCustomerId: moveCustomerRef.current, message: messageRef.current, failed: failedRef.current,
        form: session && raw ? { kind: session.kind, context: { ...session.context }, baselineFingerprint: session.sourceFingerprint,
          defaultName: session.defaultName, ...raw } : null,
        import: savedImportIdRef.current || !originalUpload.current ? null : catalogRecoveryUpload(originalUpload.current.bytes, originalUpload.current.name),
        importFieldId: importFieldRef.current, importName: importNameRef.current, savedImportId: savedImportIdRef.current,
      })) as WorkspaceEditRecoveryUi["catalog"];
    },
    stage(value, target) {
      if (!mounted.current || workingRef.current || importIoPending.current || childAcknowledgement.current || formRecoveryHandle.current?.isBusy()) throw new Error("Finish the catalog's current action before restoring another review.");
      // Validate the entire typed slice before creating any fresh local owner or setter.
      const snapshot = parseWorkspaceEditRecovery({ ...target.admission.staged,
        ui: { ...target.admission.staged.ui, catalog: value } }).ui.catalog;
      const catalog = target.workspace.catalog, selection = normalizeCatalogSelection(catalog, target.admission.staged.context.catalogSelection);
      let stagedForm: Omit<FormSession, "sequence"> | null = null, rawForm: CatalogFormRawState | null = null;
      if (snapshot.form) {
        const held = snapshot.form, context = normalizeCatalogSelection(catalog, held.context);
        if (JSON.stringify(context) !== JSON.stringify(held.context)) throw new Error("The recovered form's actual customer/project/field destination changed. Preserve its recovery export.");
        if (held.kind === "project" && !context.clientId || held.kind === "fieldMap" && !context.projectId
          || held.kind === "design" && !context.fieldMapId || held.kind === "edit_client" && !context.clientId
          || held.kind === "rename_project" && !context.projectId || held.kind === "rename_field_map" && !context.fieldMapId) throw new Error("The recovered form has no current saved destination.");
        rawForm = validateCatalogFormRawState({ name: held.name, fieldName: held.fieldName, client: held.client, detailsOpen: held.detailsOpen,
          errors: held.errors, error: held.error, fieldError: held.fieldError, saveError: held.saveError }, held.kind === "client" || held.kind === "edit_client");
        stagedForm = { kind: held.kind, context, revision: target.workspace.revision,
          defaultName: held.kind === "rename_project" ? catalog.projects.find(item => item.id === context.projectId)!.name
            : held.kind === "rename_field_map" ? catalog.fieldMaps.find(item => item.id === context.fieldMapId)!.name : held.defaultName,
          ...(held.kind === "edit_client" ? { client: catalog.clients.find(item => item.id === context.clientId)! } : {}),
          sourceFingerprint: contextFingerprint(catalog, context), recoveryNeedsReview: true };
      }
      if (snapshot.moveOpen && (!selection.projectId || !selection.clientId)) throw new Error("The recovered move has no current project owner.");
      if (snapshot.savedImportId !== null && !catalog.designs.some(item => item.id === snapshot.savedImportId)) throw new Error("The acknowledged imported copy no longer exists. Keep the recovery export.");
      if (snapshot.savedImportId !== null && snapshot.import !== null) throw new Error("A saved imported copy cannot also be an unsubmitted upload.");
      const upload = snapshot.import ? { name: snapshot.import.filename, bytes: decodeWorkspaceRecoveryImport(snapshot.import) } : null;
      let preview: WorkspaceCatalogImport | null = null;
      if (upload) { try { preview = previewWorkspaceCatalogImport(upload.bytes, upload.name); } catch { /* Invalid original uploads remain raw custody, never admitted imports. */ } }
      const epoch = recoveryEpoch.current, oldActor = actor.current, oldForm = formRef.current;
      const inputOwner = current.current.recoveryParticipants?.getInputOwner();
      const oldHandle = formRecoveryHandle.current, oldOperation = operation.current;
      const isCurrent = () => mounted.current && epoch === recoveryEpoch.current && actor.current === oldActor
        && operation.current === oldOperation && formRef.current === oldForm && formRecoveryHandle.current === oldHandle
        && current.current.recoveryParticipants?.getInputOwner() === inputOwner;
      return { isCurrent, async consume(delivery) {
        if (!delivery.isCurrent() || delivery.target !== target || !isCurrent()) throw new Error("The catalog recovery stage belongs to an earlier value owner.");
        actor.current = {}; operation.current++; deliveryPending.current = delivery; setDelivering(true);
        // No source/controller/user callbacks participate in this internal delivery.
        setSelection(selection, false); setConfirmation(null); setActivity(null); setProjectCrs(snapshot.projectCrs); setUnits(snapshot.units);
        setMoveOpen(snapshot.moveOpen); setMoveCustomerId(snapshot.moveCustomerId); moveNeedsReview.current = snapshot.moveOpen;
        setMoveReview(snapshot.moveOpen ? { context: { ...selection }, revision: target.workspace.revision, sourceFingerprint: contextFingerprint(catalog, selection) } : null);
        originalUpload.current = upload ? { name: upload.name, bytes: new Uint8Array(upload.bytes) } : null;
        setImportCandidate(preview); setImportFilename(upload?.name ?? ""); setImportFieldId(snapshot.importFieldId); setImportName(snapshot.importName);
        setImportRevision(null); setSavedImportId(snapshot.savedImportId); setMessage(snapshot.message); setFailed(snapshot.failed);
        const next = stagedForm ? { ...stagedForm, sequence: ++formSequence.current } : null;
        formRef.current = next; formRecoveryHandle.current = null; setForm(next);
        const viewCommitted = new Promise<void>((resolve, reject) => {
          viewAcknowledgement.current = { id: delivery.id, snapshot, resolve, reject }; setDeliveryRender(delivery.id);
        });
        try {
          const childCommitted = rawForm ? new Promise<void>((resolve, reject) => {
            let settled = false;
            const done = (error?: Error) => { if (settled) return; settled = true; childAcknowledgement.current = null; error ? reject(error) : resolve(); };
            childAcknowledgement.current = { reject: error => done(error) };
            setChildDelivery({ id: delivery.id, value: rawForm!, isCurrent: delivery.isCurrent, acknowledge: () => done(), reject: error => done(error) });
          }) : Promise.resolve();
          if (!rawForm) setChildDelivery(null);
          await Promise.all([viewCommitted, childCommitted]);
          if (!delivery.isCurrent()) throw new Error("The catalog changed before all child controls acknowledged recovery.");
        } finally { viewAcknowledgement.current = null; deliveryPending.current = null; if (mounted.current) setDelivering(false); }
      } };
    },
  };
  useEffect(() => {
    const waiting = viewAcknowledgement.current, delivery = deliveryPending.current;
    if (!waiting || waiting.id !== deliveryRender || !delivery) return;
    if (!delivery.isCurrent()) { waiting.reject(new Error("The catalog view retired before its recovery commit.")); return; }
    const s = waiting.snapshot;
    if (projectCrs !== s.projectCrs || units !== s.units || moveOpen !== s.moveOpen || moveCustomerId !== s.moveCustomerId
      || importFieldId !== s.importFieldId || importName !== s.importName || savedImportId !== s.savedImportId
      || message !== s.message || failed !== s.failed || form !== formRef.current) return;
    const focus = props.recoveryParticipants?.getFocus();
    const known = focus?.key === "catalog/project/crs" ? { input: projectCrsInput, text: projectCrs }
      : focus?.key === "catalog/import/name" ? { input: importNameInput, text: importName } : null;
    if (known) {
      known.input.current?.focus();
      if (focus?.selection) {
        const start = Math.min(known.text.length, Math.max(0, focus.selection.start)), end = Math.min(known.text.length, Math.max(start, focus.selection.end));
        const node = known.input.current as unknown as { setSelectionRange?: (start: number, end: number) => void; setNativeProps?: (props: unknown) => void } | null;
        if (node?.setSelectionRange) node.setSelectionRange(start, end); else node?.setNativeProps?.({ selection: { start, end } });
      }
    }
    waiting.resolve();
  });
  const feedback = message ? <Text accessibilityRole={failed ? "alert" : undefined} accessibilityLiveRegion="polite" style={failed ? styles.error : styles.message}>{message}</Text> : null;
  const needsFormRecheck = !!form && (form.recoveryNeedsReview || failed || form.revision !== repository.catalogRevision
    || form.sourceFingerprint !== contextFingerprint(catalog, form.context));
  const formDialogs = <>
      {form && (form.kind === "client" || form.kind === "edit_client") && <ClientProfileDialog key={form.sequence} visible={visible} mode={form.kind === "edit_client" ? "edit" : "create"} defaultDisplayName="" initialClient={form.client} onCancel={() => closeForm(form)} onSave={value => submitProfile(form, value)} submitting={working} recoveryHandle={formRecoveryHandle} recoveryDelivery={childDelivery} recoveryParticipants={props.recoveryParticipants} onRecoveryReady={() => props.recoveryParticipants?.refresh()} onRawInputChange={() => { if (formRef.current === form) changed(); }} feedback={<View>{feedback}{needsFormRecheck && <Button label="Recheck saved catalog" disabled={blocked} onPress={() => recheckForm(form)} testID="catalog-form-recheck" />}</View>} />}
      {form && form.kind !== "client" && form.kind !== "edit_client" && <ProjectCatalogDialog key={form.sequence} visible={visible} mode={form.kind === "rename_project" ? "project" : form.kind === "rename_field_map" ? "fieldMap" : form.kind} defaultName={form.defaultName} defaultFieldName={form.kind === "project" ? "Field 1" : undefined}
        title={form.kind === "rename_project" ? "Rename project" : form.kind === "rename_field_map" ? "Rename field" : undefined} createButtonLabel={form.kind === "rename_project" ? "Save project name" : form.kind === "rename_field_map" ? "Save field name" : undefined}
        cancelButtonLabel={form.kind === "rename_field_map" ? "Cancel field rename" : form.kind === "rename_project" ? "Cancel project rename" : undefined}
        helper={form.kind === "rename_field_map" ? "Changes this field’s catalog name. Saved design names, geometry, Survey history and Layout targets stay unchanged." : undefined}
        contextPreview={[catalog.clients.find(item => item.id === form.context.clientId)?.displayName, catalog.projects.find(item => item.id === form.context.projectId)?.name, catalog.fieldMaps.find(item => item.id === form.context.fieldMapId)?.name].filter(Boolean).join(" → ")} onCancel={() => closeForm(form)} onCreate={(name, firstFieldName) => submitName(form, name, firstFieldName)} submitting={working} recoveryHandle={formRecoveryHandle} recoveryDelivery={childDelivery} recoveryParticipants={props.recoveryParticipants} onRecoveryReady={() => props.recoveryParticipants?.refresh()} onRawInputChange={() => { if (formRef.current === form) changed(); }}
        feedback={<View style={{ gap: 8 }}>{feedback}{form.kind === "project" && <><Text style={styles.label}>Projected/local CRS (required)</Text><TextInput ref={projectCrsInput} onFocus={userAction(() => props.recoveryParticipants?.recordFocus("catalog/project/crs"))} onSelectionChange={userAction(event => props.recoveryParticipants?.recordFocus("catalog/project/crs", event.nativeEvent.selection))} value={projectCrs} onChangeText={userAction(setProjectCrs)} editable={!blocked} accessibilityLabel="Project coordinate system" placeholder="Your project CRS" style={styles.input} testID="catalog-project-crs" /><Text style={styles.meta}>Enter the actual coordinate system for this project. No location is inferred.</Text>
          <Text style={styles.label}>Display units</Text><View style={styles.actions}><Button label="Imperial (feet and inches)" selected={units === "us_survey_feet"} disabled={blocked} onPress={userAction(() => setUnits("us_survey_feet"))} testID="catalog-units-imperial" /><Button label="Metric (metres)" selected={units === "metric"} disabled={blocked} onPress={userAction(() => setUnits("metric"))} testID="catalog-units-metric" /></View></>}
          {needsFormRecheck && <Button label="Recheck saved catalog" disabled={blocked} onPress={() => recheckForm(form)} testID="catalog-form-recheck" />}</View>} />}
      {confirmation && <ConfirmActionDialog visible={visible} title={confirmation.kind === "close_import" ? "Close unfinished import?" : `Delete ${confirmation.name}?`} message={confirmation.kind === "close_import" ? "The file has not been saved as a copy. Closing discards this review; your original file is unchanged." : "This removes the saved catalog item. Linked evidence or Layout targets may block deletion. Preserve current unfinished work first."} confirmLabel={confirmation.kind === "close_import" ? "Close review" : "Delete"} onCancel={userAction(() => setConfirmation(null))} onConfirm={confirm} submitting={blocked} feedback={feedback} testID="workspace-catalog-confirm" />}
  </>;
  const content = <View style={styles.root} testID="workspace-catalog">
      <View style={styles.header}><Text style={styles.title}>My projects</Text>{presentation === "dialog" && <Button label="Close catalog" disabled={blocked || !!form || moveOpen} onPress={requestClose} testID="catalog-close" />}</View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.actions}><Button label={`New ${labelForKind(nextCreate)}`} disabled={blocked || !!form || moveOpen} onPress={() => showForm(nextCreate)} testID="catalog-new" />
          <Button label="Import JSON or ZIP" disabled={blocked || !!form || moveOpen || Platform.OS !== "web"} onPress={() => void chooseImport()} testID="catalog-import" />
          <Button label="Refresh saved work" disabled={blocked || !!form} onPress={userAction(() => { current.current.onUserIntent?.(); void repository.refreshProjects(); })} testID="catalog-refresh" />
          {props.onOpenLayoutCatalog && <Button label="Layout sessions" disabled={blocked || !!form} onPress={userAction(props.onOpenLayoutCatalog)} testID="catalog-layout-sessions" />}</View>
        {feedback}
        <Text style={styles.meta}>Select a customer, project, field or design to browse. Open loads a design into the current workspace.</Text>
        <View style={styles.card}><Text style={styles.heading}>Recent designs</Text>
          {[...catalog.designs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6).map(item => <View style={styles.row} key={item.id}>
            <Button label={item.name} selected={selected.designId === item.id} disabled={blocked || !!form || moveOpen} onPress={() => select(catalogDesignContext(catalog, item.id))} testID={`catalog-recent-${item.id}`} />
            <Button label={`Open ${item.name}`} disabled={blocked || !!form || moveOpen} onPress={() => void open(item.id)} testID={`catalog-recent-open-${item.id}`} /></View>)}
          {!catalog.designs.length && <Text style={styles.meta}>Create a customer and project to begin.</Text>}</View>
        {catalog.clients.map(client => <View style={styles.card} key={client.id}>
          <View style={styles.row}><Button label={client.displayName} selected={selected.clientId === client.id} disabled={blocked || !!form || moveOpen} onPress={() => select({ ...EMPTY_CATALOG_SELECTION, clientId: client.id })} testID={`catalog-client-${client.id}`} /></View>
          {selected.clientId === client.id && <>
            <View style={styles.actions}><Button label="Edit customer" disabled={blocked || !!form || moveOpen} onPress={() => showForm("edit_client")} testID="catalog-edit-customer" />
              <Button label="Delete empty customer" disabled={blocked || !!form || moveOpen || catalog.projects.some(item => item.clientId === client.id)} onPress={userAction(() => setConfirmation({ kind: "delete_client", id: client.id, name: client.displayName, revision: readRevision() }))} testID="catalog-delete-customer" /></View>
            {catalog.projects.filter(item => item.clientId === client.id).map(folder => <View style={styles.indent} key={folder.id}>
              <Button label={folder.name} selected={selected.projectId === folder.id} disabled={blocked || !!form || moveOpen} onPress={() => select({ clientId: client.id, projectId: folder.id, fieldMapId: null, designId: null })} testID={`catalog-project-${folder.id}`} />
              {selected.projectId === folder.id && <><Text style={styles.meta}>Coordinate system: {folder.projectCrs} · {folder.unitSystem === "us_survey_feet" ? "Imperial" : "Metric"}</Text>
                <View style={styles.actions}><Button label="Rename project" disabled={blocked || !!form || moveOpen} onPress={() => showForm("rename_project")} testID="catalog-rename-project" />
                  <Button label="Move project" disabled={blocked || !!form || moveOpen} onPress={userAction(() => { moveNeedsReview.current = false; setMoveCustomerId(""); setMoveReview({ context: { ...selected }, revision: readRevision(), sourceFingerprint: contextFingerprint(catalog, selected) }); setMoveOpen(true); })} testID="catalog-move-project" />
                  <Button label="Delete project" disabled={blocked || !!form || moveOpen} onPress={userAction(() => setConfirmation({ kind: "delete_project", id: folder.id, name: folder.name, revision: readRevision() }))} testID="catalog-delete-project" /></View>
                {catalog.fieldMaps.filter(item => item.projectId === folder.id).map(map => <View style={styles.indent} key={map.id}>
                  <Button label={map.name} selected={selected.fieldMapId === map.id} disabled={blocked || !!form || moveOpen} onPress={() => select({ clientId: client.id, projectId: folder.id, fieldMapId: map.id, designId: null })} testID={`catalog-field-${map.id}`} />
                  {selected.fieldMapId === map.id && <Button label="Rename field" disabled={blocked || !!form || moveOpen} onPress={() => showForm("rename_field_map")} testID="catalog-rename-field" />}
                  {selected.fieldMapId === map.id && catalog.designs.filter(item => item.fieldMapId === map.id).map(item => <View style={styles.row} key={item.id}>
                    <Button label={`${item.name}${props.activeContext?.designId === item.id ? " · Open" : ""}`} selected={selected.designId === item.id} disabled={blocked || !!form || moveOpen} onPress={() => select({ clientId: client.id, projectId: folder.id, fieldMapId: map.id, designId: item.id })} testID={`catalog-design-${item.id}`} />
                    <Button label={`Open ${item.name}`} disabled={blocked || !!form || moveOpen} onPress={() => void open(item.id)} testID={`catalog-design-open-${item.id}`} /></View>)}
                </View>)}
              </>}
            </View>)}
          </>}
        </View>)}
        {design && <View style={styles.card}><Text style={styles.heading}>Selected design: {design.name}</Text><Text style={styles.meta}>{"kind" in design ? design.kind === "project" ? "Complete design" : design.kind === "draft" ? "Design draft" : "Field design" : "Complete design"}</Text>
          <Button label="Delete selected design" disabled={blocked || !!form || moveOpen} onPress={userAction(() => setConfirmation({ kind: "delete_design", id: design.id, name: design.name, revision: readRevision() }))} testID="catalog-delete-design" /></View>}
        {moveOpen && <View style={styles.card} testID="catalog-move-form"><Text style={styles.heading}>Move {project?.name}</Text><Text style={styles.meta}>Choose its customer. Fields and designs remain with the project. Current saved work will close first; unfinished work blocks the move.</Text>
          {catalog.clients.filter(item => item.id !== selected.clientId).map(item => <Button key={item.id} label={item.displayName} selected={moveCustomerId === item.id} disabled={blocked} onPress={userAction(() => setMoveCustomerId(item.id))} testID={`catalog-move-to-${item.id}`} />)}
          <View style={styles.actions}><Button label="Recheck move" disabled={blocked} onPress={recheckMove} testID="catalog-move-recheck" /><Button label="Move project" disabled={blocked || !moveCustomerId} onPress={() => void moveProject()} testID="catalog-move-confirm" /><Button label="Cancel move" disabled={blocked} onPress={userAction(() => { setMoveOpen(false); setMoveReview(null); moveNeedsReview.current = false; })} testID="catalog-move-cancel" /></View></View>}
        {importFilename && <View style={styles.card} testID="catalog-import-review"><Text style={styles.heading}>{importFilename}</Text>
          {importCandidate && <><Text style={styles.meta}>{importCandidate.name} · {importCandidate.projectCrs ?? "CRS not supplied"} · {importCandidate.format === "complete" ? `Design and Survey package: ${importCandidate.bundle.surveyDocuments.length} retained Survey collections` : "Design-only exchange; unfinished Survey collections are not included"}</Text>
            {importCandidate.format === "complete" ? <Text style={styles.meta}>Imports a separately saved design with its Survey history and original provenance. Layout sessions are exported separately in RTK Layout.</Text> : <><Text style={styles.label}>Name for imported copy</Text><TextInput ref={importNameInput} onFocus={userAction(() => props.recoveryParticipants?.recordFocus("catalog/import/name"))} onSelectionChange={userAction(event => props.recoveryParticipants?.recordFocus("catalog/import/name", event.nativeEvent.selection))} value={importName} onChangeText={userAction(setImportName)} editable={!blocked && !savedImportId} style={styles.input} accessibilityLabel="Imported copy name" testID="workspace-import-name" /></>}
            <Text style={styles.label}>Destination field</Text>{catalog.fieldMaps.map(item => {
              const folder = catalog.projects.find(project => project.id === item.projectId), customer = catalog.clients.find(client => client.id === folder?.clientId);
              return <Button key={item.id} label={folder && customer ? `${customer.displayName} → ${folder.name} → ${item.name}` : `${item.name} · Destination unavailable`} selected={importFieldId === item.id}
                disabled={blocked || !!savedImportId || !folder || !customer} onPress={userAction(() => setImportFieldId(item.id))} testID={`workspace-import-field-${item.id}`} />;
            })}
            {importCandidate.format === "complete" && repository.workspaceVersion !== "cplayout-workspace-v4" && <View style={styles.card}>
              <Text style={styles.label}>Prepare saved Survey history</Text>
              <Text style={styles.meta}>Prepare storage before importing this package. Each required step is saved separately and retains its previous workspace for recovery. CPLayout versions without Survey storage support cannot open the prepared workspace.</Text>
              <Button label="Prepare storage for this import" disabled={blocked || !!savedImportId || !importFieldId || importRevision === null || !props.preparePackageStorageStep}
                onPress={() => void prepareImportStorage()} testID="workspace-import-prepare" />
            </View>}
            <View style={styles.actions}><Button label="Recheck destination" disabled={blocked || !!savedImportId} onPress={userAction(() => { setImportRevision(readRevision()); setMessage(null); })} testID="workspace-import-recheck" />
              <Button label="Import saved copy" disabled={blocked || !!savedImportId || !importFieldId || importRevision === null} onPress={() => void saveImport()} testID="workspace-import-save" />
              {savedImportId && <Button label="Open saved copy" disabled={blocked} onPress={() => void open(savedImportId)} testID="workspace-import-open" />}</View></>}
          {!importCandidate && <Text style={styles.error}>No file is admitted. Choose another compatible file; no catalog records were created.</Text>}
        </View>}
      </ScrollView>
      {savedImportId && !importCandidate && <View style={styles.card} testID="workspace-import-saved-receipt"><Text style={styles.heading}>Saved imported copy</Text>
        <Text style={styles.meta}>{catalog.designs.find(item => item.id === savedImportId)?.name ?? "Saved copy"}</Text>
        <Button label="Open saved copy" disabled={blocked} onPress={() => void open(savedImportId)} testID="workspace-import-open" /></View>}
      {!props.recoveryParticipants && formDialogs}
    </View>;
  const presentationView = presentation === "embedded" ? content : <Modal visible={visible} animationType="fade" onRequestClose={requestClose}>{content}</Modal>;
  // Runtime handles and child value owners survive the outer Modal's hidden-child boundary.
  return props.recoveryParticipants ? <><CatalogRecoveryBridge registry={props.recoveryParticipants} participant={recoveryParticipant} />{presentationView}{formDialogs}</> : presentationView;
}
function CatalogRecoveryBridge({ registry, participant }: { registry?: WorkspaceRecoveryParticipants; participant: WorkspaceRecoveryParticipant<"catalog"> }): null {
  useWorkspaceRecoveryParticipant(registry, "catalog", participant); return null;
}
/** Browser and native-neutral binary custody; original bytes are never reserialized as a design document. */
export function catalogRecoveryUpload(source: Uint8Array, filename: string): WorkspaceRecoveryImport {
  if (Math.ceil(source.length / 3) * 4 > WORKSPACE_EDIT_RECOVERY_MAX_BYTES) throw new Error("The original upload exceeds the edit-recovery byte budget. Keep its original file; no bytes were truncated.");
  const bytes = new Uint8Array(source), alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    chunks.push(alphabet[a >>> 2] + alphabet[(a & 3) << 4 | b >>> 4] + (i + 1 < bytes.length ? alphabet[(b & 15) << 2 | c >>> 6] : "=")
      + (i + 2 < bytes.length ? alphabet[c & 63] : "="));
  }
  return { filename, bytesBase64: chunks.join(""), byteLength: bytes.length, sha256: workspaceRecoveryBytesSha256(bytes) };
}
function Button({ label, onPress, disabled = false, selected, testID }: { label: string; onPress: () => void; disabled?: boolean; selected?: boolean; testID: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, ...(selected === undefined ? {} : { selected }) }}
    {...(Platform.OS === "web" && selected !== undefined ? { "aria-pressed": selected } : {})}
    disabled={disabled} onPress={onPress} testID={testID} style={[styles.button, selected && styles.selected, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
async function pickCatalogFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (Platform.OS !== "web" || typeof document === "undefined") throw new Error("Import files from the browser workspace.");
  return new Promise((resolve, reject) => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".json,.zip,application/json,application/zip";
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.addEventListener("change", () => {
      const file = input.files?.[0]; if (!file) { resolve(null); return; }
      if (!file.size || file.size > CATALOG_IMPORT_MAX_BYTES) { reject(new Error("Choose a nonempty CPLayout JSON or ZIP no larger than 25 MB.")); return; }
      void file.arrayBuffer().then(buffer => resolve({ name: file.name, bytes: new Uint8Array(buffer) }), reject);
    }, { once: true }); input.click();
  });
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f7f8f3" }, header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", padding: 12, gap: 8 },
  title: { fontSize: 22, fontWeight: "700", color: "#254234" }, content: { padding: 12, gap: 12 }, card: { padding: 12, gap: 8, borderWidth: 1, borderColor: "#d1d8cc", borderRadius: 8, backgroundColor: "white" },
  heading: { fontSize: 17, fontWeight: "600", color: "#254234" }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, indent: { paddingLeft: 12, gap: 8, marginTop: 8 },
  meta: { color: "#536153", fontSize: 13 }, label: { color: "#254234", fontWeight: "600" }, input: { minHeight: 44, padding: 8, borderWidth: 1, borderColor: "#9ba991", borderRadius: 6, backgroundColor: "white" },
  button: { minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, justifyContent: "center", borderWidth: 1, borderColor: "#aab9a5", borderRadius: 6, backgroundColor: "#f4f7f0" }, selected: { backgroundColor: "#deead4", borderColor: "#467139" }, disabled: { opacity: 0.5 }, buttonText: { color: "#254234", fontWeight: "600" }, error: { color: "#9c3022" }, message: { color: "#254234" },
});
