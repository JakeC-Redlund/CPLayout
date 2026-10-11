import {
  mergeRetainedReferenceOrigins, operationalObservationPayloads, OperationalFixedGgaEvidenceSchema, parseFieldLayoutTarget,
  createDesignDraftEditorState, createFieldDesignEditorState, createProjectEditorState,
  parseAppSettings, defaultAppSettings, type AppSettings,
  parseLayoutSessionDocument, parseStrictJson, parseSurveyCollectionDocument,
  serializeDesignDraftDocument, serializeFieldDesignDocument, serializeProjectDocument,
  type DesignDraft, type FieldDesign, type PivotProject, type SurveyCollection,
} from "@cplayout/core";
import { readSurveyDesignDocument, assertRecordedReferenceAttachments } from "../../../../packages/core/src/surveyCollectionApplication";
import { proposeSurveyMembershipRestore } from "../../../../packages/core/src/surveyCollection";
import { assertSurvivingRecordedReferenceHistory, assertNewRecordedReferenceHistory } from "../../../../packages/project-store/src/recordedReferenceAttachments";
import { validateWorkspaceDocument, type WorkspaceDocument } from "../../../../packages/project-store/src/workspaceDocument";
import { readWorkspaceDesign } from "../../../../packages/project-store/src/versionedProjectRepository";
import { parseUnifiedWorkspaceResume, resolveUnifiedWorkspaceResume, type UnifiedWorkspaceResume } from "../navigation/unifiedWorkspaceResume";
import { editableFromSavedDesign, type WorkspaceEditableDocument } from "./workspaceDocumentAdapters";
import { workspaceDocumentIdentityKey, type WorkspaceDocumentIdentity } from "./workspacePresentation";
import { workspaceMapContextKey, type WorkspaceMapContext } from "./workspaceMapContext";
import type { WorkspaceHistorySnapshot } from "./workspaceIntegration";
import type { MapViewport } from "../../../../packages/geometry/src/mapInteraction";
import type { WorkspaceSceneLayer } from "../../../../packages/map-adapters/src/workspaceMapScene";
import { viewportForScreen } from "../../../../packages/map-adapters/src/mapFit";

/** Separate from both context hints, durable workspace documents and recovery exports. */
export const WORKSPACE_EDIT_RECOVERY_V1_VERSION = "cplayout-unified-edit-recovery-v1" as const;
export const WORKSPACE_EDIT_RECOVERY_VERSION = "cplayout-unified-edit-recovery-v2" as const;
export type WorkspaceEditRecoveryVersion = typeof WORKSPACE_EDIT_RECOVERY_V1_VERSION | typeof WORKSPACE_EDIT_RECOVERY_VERSION;
const V1_CATALOG_FORM_KINDS = ["client", "project", "fieldMap", "design", "edit_client", "rename_project"] as const;
export type WorkspaceRecoveryCatalogFormKindV1 = typeof V1_CATALOG_FORM_KINDS[number];
export type WorkspaceRecoveryCatalogFormKind = WorkspaceRecoveryCatalogFormKindV1 | "rename_field_map";
export const WORKSPACE_EDIT_RECOVERY_MAX_BYTES = 8 * 1024 * 1024;
export const WORKSPACE_EDIT_RECOVERY_LIMITS = Object.freeze({ history: 512, collections: 1024, inputs: 4096, cameras: 128, vertices: 32768, depth: 64, nodes: 150000 });
export type WorkspaceRecoveryJson = null | boolean | number | string | WorkspaceRecoveryJson[] | { [key: string]: WorkspaceRecoveryJson };
export interface WorkspaceRecoveryInputEntry {
  readonly key: string;
  /** These are canonical raw-value fingerprints, never proof that Apply was accepted. */
  readonly baselineFingerprint: string;
  readonly cleanFingerprint: string;
  readonly value: WorkspaceRecoveryJson;
}
export interface WorkspaceRecoveryInputs {
  readonly entries: readonly WorkspaceRecoveryInputEntry[];
  /** Inert logical field address, including fields within aggregate entries.
   * Only a fresh mounted field registry may activate it and clamp its caret. */
  readonly focus: null | { readonly key: string; readonly selection?: { readonly start: number; readonly end: number } };
}
export interface WorkspaceRecoveryEditable {
  readonly identity: WorkspaceDocumentIdentity;
  readonly sourceDocument: string;
  readonly originalProjectDocument: string | null;
  readonly designRevision: number | null;
  readonly workingDocument: string;
  readonly editor: { readonly past: readonly string[]; readonly future: readonly string[];
    readonly revision: number; readonly savedRevision: number; readonly lastError: string | null;
    readonly lockedCrs: string | null; readonly selectedMachineId: string | null };
}
export interface WorkspaceRecoveryCollectionAnchor { readonly id: string; readonly revision: number; readonly document: string }
export interface WorkspaceRecoveryLayoutAnchor {
  readonly id: string; readonly revision: number; readonly persistenceRevision: number;
  readonly document: string; readonly fieldMapId: string; readonly targetHash: string; readonly targetDocument: string;
}
export interface WorkspaceRecoveryImport {
  readonly filename: string; readonly bytesBase64: string; readonly byteLength: number; readonly sha256: string;
}
export interface WorkspaceRecoveryDrawing {
  readonly geometryType: "Point" | "LineString" | "Polygon" | "Circle" | null;
  readonly vertices: readonly { readonly x: number; readonly y: number }[];
  readonly vertexRecordedAt: readonly string[]; readonly stage: "drawing" | "classification";
  readonly selectionId: string; readonly name: string; readonly notes: string;
  readonly detailsOpen: boolean; readonly choicesOpen: boolean; readonly error: string | null;
  readonly replacing: boolean; readonly captureId: string | null; readonly paused: boolean;
}
export interface WorkspaceRecoveryClientForm {
  readonly companyName: string; readonly primaryContactFirstName: string; readonly primaryContactMiddleInitial: string;
  readonly primaryContactLastName: string; readonly primaryContactSuffix: string; readonly email: string;
  readonly phone: string; readonly location: string; readonly notes: string;
}
/** Literal fields from UnifiedWorkspaceEntry, WorkspaceModePanels, WorkspaceCatalog,
 * ProjectCatalogDialog and UnifiedWorkspace. No arbitrary UI blob or callback state. */
export interface WorkspaceEditRecoveryUi<FormKind extends WorkspaceRecoveryCatalogFormKind = WorkspaceRecoveryCatalogFormKind> {
  /** Presentation/application preferences only. Local paths do not prove that
   * map packages or imagery assets are present on this machine. */
  readonly settings: AppSettings;
  readonly entry: { readonly designTask: "drawing" | "inputs" | "machines" | "review";
    readonly drawing: WorkspaceRecoveryDrawing | null; readonly toolsOpen: boolean; readonly receiverOpen: boolean;
    readonly diagnosticOpen: boolean; readonly layerVisibility: readonly { readonly layer: WorkspaceSceneLayer; readonly visible: boolean }[] };
  readonly receiver: { readonly method: "usb" | "bluetooth_spp" | "network"; readonly baudRate: string;
    readonly protocol: "tcp" | "udp"; readonly address: string; readonly port: string;
    readonly sourceAddress: string; readonly settingsOpen: boolean };
  readonly survey: { readonly purposeId: string; readonly label: string; readonly referenceName: string;
    readonly referenceNotes: string; readonly referenceBaselineName: string; readonly referenceBaselineNotes: string;
    readonly referenceDetails: boolean };
  readonly layout: { readonly name: string; readonly nameBaseline: string; readonly label: string;
    readonly copyName: string; readonly details: boolean };
  readonly catalog: { readonly projectCrs: string; readonly units: string;
    readonly form: null | { readonly kind: FormKind;
      readonly context: UnifiedWorkspaceResume["catalogSelection"]; readonly baselineFingerprint: string;
      readonly defaultName: string; readonly name: string; readonly fieldName: string;
      readonly client: WorkspaceRecoveryClientForm | null; readonly detailsOpen: boolean;
      readonly errors: readonly { readonly field: string; readonly message: string }[];
      readonly error: string | null; readonly fieldError: string | null; readonly saveError: string | null };
    readonly moveOpen: boolean; readonly moveCustomerId: string;
    readonly import: WorkspaceRecoveryImport | null; readonly savedImportId: string | null;
    readonly importFieldId: string; readonly importName: string;
    readonly message: string | null; readonly failed: boolean };
  readonly file: { readonly dialog: "copy" | "rename" | "preferences" | null;
    readonly text: string; readonly baseline: string; readonly savedCopyId: string | null };
}
export interface WorkspaceRecoveryCamera {
  readonly context: WorkspaceMapContext; readonly viewport: MapViewport; readonly initialized: boolean;
}
interface WorkspaceEditRecoveryCandidateValues {
  readonly writerId: string; readonly sequence: number; readonly capturedAt: string;
  readonly context: UnifiedWorkspaceResume; readonly workspaceRevision: number | null;
  readonly editable: WorkspaceRecoveryEditable | null;
  readonly collections: readonly WorkspaceRecoveryCollectionAnchor[];
  readonly layout: WorkspaceRecoveryLayoutAnchor | null;
  readonly controller: { readonly historyPast: readonly WorkspaceHistorySnapshot[];
    readonly historyFuture: readonly WorkspaceHistorySnapshot[]; readonly selectedAddress: string | null };
  readonly inputs: WorkspaceRecoveryInputs;
  readonly cameras: readonly WorkspaceRecoveryCamera[];
}
export type WorkspaceEditRecoveryUiV1 = WorkspaceEditRecoveryUi<WorkspaceRecoveryCatalogFormKindV1>;
export type WorkspaceEditRecoveryCandidateV1 = WorkspaceEditRecoveryCandidateValues & {
  readonly recoveryVersion: typeof WORKSPACE_EDIT_RECOVERY_V1_VERSION; readonly ui: WorkspaceEditRecoveryUiV1;
};
export type WorkspaceEditRecoveryCandidateV2 = WorkspaceEditRecoveryCandidateValues & {
  readonly recoveryVersion: typeof WORKSPACE_EDIT_RECOVERY_VERSION; readonly ui: WorkspaceEditRecoveryUi;
};
export type WorkspaceEditRecoveryCandidate = WorkspaceEditRecoveryCandidateV1 | WorkspaceEditRecoveryCandidateV2;
export interface WorkspaceEditRecoveryAdmission {
  /** Original candidate remains byte-preserving. Staged advances only the workspace receipt. */
  readonly candidate: WorkspaceEditRecoveryCandidate; readonly staged: WorkspaceEditRecoveryCandidate;
  readonly editable: WorkspaceEditableDocument | null; readonly collections: readonly SurveyCollection[];
  readonly layout: null | { readonly session: ReturnType<typeof parseLayoutSessionDocument>; readonly persistenceRevision: number };
  readonly historyPast: readonly WorkspaceHistorySnapshot[]; readonly historyFuture: readonly WorkspaceHistorySnapshot[];
  readonly ui: WorkspaceEditRecoveryUi; readonly inputs: WorkspaceRecoveryInputs;
  readonly requiresImportReview: boolean; readonly requiresCatalogReview: boolean;
}
export type WorkspaceEditRecoveryResolution =
  | { readonly kind: "ready" | "reconcile_required"; readonly admission: WorkspaceEditRecoveryAdmission }
  | { readonly kind: "source_conflict" | "unsupported" | "invalid"; readonly reason: string };

export function emptyWorkspaceEditRecoveryUi(): WorkspaceEditRecoveryUi {
  return { settings: defaultAppSettings(), entry: { designTask: "drawing", drawing: null, toolsOpen: true, receiverOpen: false, diagnosticOpen: false, layerVisibility: [] },
    receiver: { method: "usb", baudRate: "115200", protocol: "tcp", address: "", port: "", sourceAddress: "", settingsOpen: true },
    survey: { purposeId: JSON.stringify({ kind: "point", role: "control" }), label: "", referenceName: "", referenceNotes: "",
      referenceBaselineName: "", referenceBaselineNotes: "", referenceDetails: false },
    layout: { name: "Layout session", nameBaseline: "Layout session", label: "", copyName: "", details: false },
    catalog: { projectCrs: "", units: "us_survey_feet", form: null, moveOpen: false, moveCustomerId: "", import: null, savedImportId: null,
      importFieldId: "", importName: "", message: null, failed: false }, file: { dialog: null, text: "", baseline: "", savedCopyId: null } };
}

/** Pure data helper for a capture. No storage or actor/owner authority is acquired. */
export function captureWorkspaceRecoveryEditable(editable: WorkspaceEditableDocument): WorkspaceRecoveryEditable {
  const write = (value: PivotProject | DesignDraft | FieldDesign) => editable.kind === "draft"
    ? serializeDesignDraftDocument(value as DesignDraft) : editable.kind === "field"
      ? serializeFieldDesignDocument(value as FieldDesign) : serializeProjectDocument(value as PivotProject);
  const current = editable.kind === "draft" ? editable.editor.draft : editable.kind === "field" ? editable.editor.field : editable.editor.project;
  return { identity: { ...editable.identity }, sourceDocument: editable.sourceDocument,
    originalProjectDocument: editable.kind === "field" ? editable.originalProjectDocument ?? null : null,
    designRevision: editable.designRevision, workingDocument: write(current), editor: {
      past: editable.editor.past.map(write), future: editable.editor.future.map(write), revision: editable.editor.revision,
      savedRevision: editable.savedEditorRevision, lastError: editable.editor.lastError,
      lockedCrs: editable.kind === "draft" ? editable.editor.lockedCrs : null,
      selectedMachineId: editable.kind === "field" ? editable.editor.selectedMachineId : null } };
}

const layers: readonly WorkspaceSceneLayer[] = ["boundary", "obstacle", "map_feature", "infrastructure", "machine", "saved_survey", "manual_capture", "survey_capture", "frozen_target", "layout_observation", "receiver", "preview"];
const clientFields = ["companyName", "primaryContactFirstName", "primaryContactMiddleInitial", "primaryContactLastName", "primaryContactSuffix", "email", "phone", "location", "notes"] as const;
function fail(message: string): never { throw new Error(message); }
function utf8Bytes(value: string, maximum = WORKSPACE_EDIT_RECOVERY_MAX_BYTES): number {
  let length = 0;
  for (const c of value) { const code = c.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) fail("Recovery requires valid Unicode scalars.");
    length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (length > maximum) fail("Recovery exceeds its UTF-8 byte limit."); }
  return length;
}
function rawText(input: unknown): string { if (typeof input !== "string") fail("Recovery text must be literal text."); utf8Bytes(input); return input; }
function id(input: unknown): string {
  const value = rawText(input);
  if (!value.trim() || value.length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail("Recovery identity must be bounded text without controls.");
  return value;
}
function nullableId(value: unknown): string | null { return value === null ? null : id(value); }
function nullableText(value: unknown): string | null { return value === null ? null : rawText(value); }
function integer(value: unknown, positive = false): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (positive ? 1 : 0)) fail("Recovery revision/sequence must be a bounded safe integer.");
  return value;
}
function nullableInteger(value: unknown): number | null { return value === null ? null : integer(value); }
function finite(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value)) fail("Recovery needs finite coordinates and camera state."); return value; }
function bool(value: unknown): boolean { if (typeof value !== "boolean") fail("Recovery presentation flags must be boolean."); return value; }
function choice<T extends string>(value: unknown, choices: readonly T[]): T { if (typeof value !== "string" || !choices.includes(value as T)) fail("Unsupported recovery choice."); return value as T; }
function object(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("Recovery requires explicit objects.");
  const actual = Object.keys(value);
  if (actual.some(key => !keys.includes(key) && !optional.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) fail("Unknown or missing recovery fields.");
  return value as Record<string, unknown>;
}
function array<T>(value: unknown, limit: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > limit) fail("Recovery array exceeds its count limit or is malformed.");
  return value.map(parse);
}
function unique<T>(values: T[], key: (value: T) => string): T[] { const set = new Set<string>(); for (const value of values) { const k = key(value); if (set.has(k)) fail("Duplicate recovery identity."); set.add(k); } return values; }
function date(value: unknown): string {
  const text = rawText(value), m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!m || !Number.isFinite(Date.parse(text))) fail("Recovery capture/vertex date is malformed.");
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59
    || m[7] !== "Z" && (+m[7].slice(1, 3) > 23 || +m[7].slice(4, 6) > 59)) fail("Recovery capture/vertex date is malformed.");
  return text;
}
function hash(value: unknown): string { const text = rawText(value); if (!/^[a-f0-9]{64}$/.test(text)) fail("Recovery requires canonical SHA256."); return text; }
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

/** Descriptor-only detachment; getters, toJSON, prototypes, cycles, sparse arrays,
 * non-finite values and excessive recursion are refused before any interpretation. */
function detach(input: unknown, maximumBytes = WORKSPACE_EDIT_RECOVERY_MAX_BYTES): unknown {
  let nodes = 0; const ancestry = new Set<object>();
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > WORKSPACE_EDIT_RECOVERY_LIMITS.nodes || depth > WORKSPACE_EDIT_RECOVERY_LIMITS.depth) fail("Recovery structure exceeds its bounded complexity.");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") { utf8Bytes(value, maximumBytes); return value; }
    if (typeof value === "number") return finite(value);
    if (typeof value !== "object" || !value) fail("Recovery requires defined plain JSON data.");
    if (ancestry.has(value)) fail("Recovery cannot contain cycles.");
    const proto = Object.getPrototypeOf(value), isArray = Array.isArray(value);
    if (isArray ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail("Recovery requires plain data prototypes.");
    if (Object.getOwnPropertySymbols(value).length) fail("Recovery cannot contain symbol fields.");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    ancestry.add(value);
    try {
      if (isArray) {
        if (Object.keys(descriptors).some(key => key !== "length" && (!/^\d+$/.test(key) || String(+key) !== key || +key >= value.length))) fail("Recovery arrays cannot contain extra fields.");
        const result: unknown[] = [];
        for (let i = 0; i < value.length; i++) { const d = descriptors[i]; if (!d || !d.enumerable || !Object.hasOwn(d, "value")) fail("Recovery arrays cannot be sparse or computed."); result.push(visit(d.value, depth + 1)); }
        return result;
      }
      const result: Record<string, unknown> = {};
      for (const [key, d] of Object.entries(descriptors)) { utf8Bytes(key, maximumBytes);
        if (!d.enumerable || !Object.hasOwn(d, "value")) fail("Recovery cannot contain computed or hidden fields.");
        Object.defineProperty(result, key, { value: visit(d.value, depth + 1), enumerable: true, configurable: true, writable: true }); }
      return result;
    } finally { ancestry.delete(value); }
  }
  const result = visit(input, 0); utf8Bytes(JSON.stringify(result), maximumBytes); return result;
}
function parseJsonBounded(text: string): unknown {
  utf8Bytes(text); let depth = 0, quoted = false, escaped = false;
  for (const c of text) { if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true; else if (c === "{" || c === "[") { if (++depth > WORKSPACE_EDIT_RECOVERY_LIMITS.depth) fail("Recovery JSON exceeds its depth limit."); }
    else if (c === "}" || c === "]") depth--; }
  return parseStrictJson(text);
}
export function workspaceRecoveryStableJson(value: unknown): string {
  const admitted = detach(value);
  const write = (v: unknown): string => v && typeof v === "object" ? Array.isArray(v) ? `[${v.map(write).join(",")}]`
    : `{${Object.keys(v).sort().map(key => `${JSON.stringify(key)}:${write((v as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(v);
  return write(admitted);
}
function fingerprint(value: unknown): string {
  const text = rawText(value);
  if (workspaceRecoveryStableJson(parseJsonBounded(text)) !== text) fail("Recovery fingerprint must be canonical raw JSON.");
  return text;
}
export function workspaceRecoveryInputDirty(entry: WorkspaceRecoveryInputEntry): boolean { return workspaceRecoveryStableJson(entry.value) !== entry.cleanFingerprint; }

function parseIdentity(value: unknown): WorkspaceDocumentIdentity {
  const d = object(value, ["clientId", "projectId", "fieldMapId", "designId", "payloadId", "kind", "projectCrs"]);
  const result = { clientId: nullableId(d.clientId), projectId: nullableId(d.projectId), fieldMapId: nullableId(d.fieldMapId), designId: nullableId(d.designId),
    payloadId: id(d.payloadId), kind: choice(d.kind, ["draft", "project", "field"] as const), projectCrs: nullableId(d.projectCrs) };
  const values = [result.clientId, result.projectId, result.fieldMapId, result.designId];
  if (!values.every(v => v === null) && values.some(v => v === null) || result.projectCrs === null && result.kind !== "draft") fail("Recovery identity must have exact managed or independent ancestry and document CRS.");
  return result;
}
function parseHistory(value: unknown): WorkspaceHistorySnapshot {
  const d = object(value, ["document", "memberships"]);
  return { document: rawText(d.document), memberships: unique(array(d.memberships, WORKSPACE_EDIT_RECOVERY_LIMITS.collections, input => {
    const m = object(input, ["collectionId", "activePointIds", "state"]);
    return { collectionId: id(m.collectionId), activePointIds: unique(array(m.activePointIds, WORKSPACE_EDIT_RECOVERY_LIMITS.vertices, id), item => item),
      state: choice(m.state, ["pending", "applied", "cleared"] as const) };
  }), item => item.collectionId) };
}
function parseInputs(value: unknown): WorkspaceRecoveryInputs {
  const d = object(value, ["entries", "focus"]), entries = unique(array(d.entries, WORKSPACE_EDIT_RECOVERY_LIMITS.inputs, input => {
    const entry = object(input, ["key", "baselineFingerprint", "cleanFingerprint", "value"]);
    const key = rawText(entry.key); if (!key || key.length > 2048) fail("Recovery input key is empty or exceeds its limit.");
    return { key, baselineFingerprint: fingerprint(entry.baselineFingerprint), cleanFingerprint: fingerprint(entry.cleanFingerprint), value: entry.value as WorkspaceRecoveryJson };
  }), entry => entry.key);
  let focus: WorkspaceRecoveryInputs["focus"] = null;
  if (d.focus !== null) { const f = object(d.focus, ["key"], ["selection"]), key = rawText(f.key);
    if (!key || key.length > 8192) fail("Recovery focus address is empty or exceeds its limit.");
    let selection: { start: number; end: number } | undefined;
    if (f.selection !== undefined) { const s = object(f.selection, ["start", "end"]); selection = { start: integer(s.start), end: integer(s.end) };
      if (selection.end < selection.start) fail("Recovery focus selection is not ordered."); }
    focus = { key, ...(selection ? { selection } : {}) };
  }
  return { entries, focus };
}
function parseDrawing(value: unknown): WorkspaceRecoveryDrawing | null {
  if (value === null) return null;
  const d = object(value, ["geometryType", "vertices", "vertexRecordedAt", "stage", "selectionId", "name", "notes", "detailsOpen", "choicesOpen", "error", "replacing", "captureId", "paused"]);
  const vertices = array(d.vertices, WORKSPACE_EDIT_RECOVERY_LIMITS.vertices, input => { const p = object(input, ["x", "y"]); return { x: finite(p.x), y: finite(p.y) }; });
  const times = array(d.vertexRecordedAt, WORKSPACE_EDIT_RECOVERY_LIMITS.vertices, date);
  if (vertices.length !== times.length || vertices.length && (d.geometryType === null || d.captureId === null)
    || d.geometryType === "Point" && vertices.length > 1 || d.geometryType === "Circle" && vertices.length > 2) fail("Recovery drawing coordinates and ordered timestamps do not align.");
  return { geometryType: d.geometryType === null ? null : choice(d.geometryType, ["Point", "LineString", "Polygon", "Circle"] as const), vertices, vertexRecordedAt: times,
    stage: choice(d.stage, ["drawing", "classification"] as const), selectionId: rawText(d.selectionId), name: rawText(d.name), notes: rawText(d.notes),
    detailsOpen: bool(d.detailsOpen), choicesOpen: bool(d.choicesOpen), error: nullableText(d.error), replacing: bool(d.replacing), captureId: nullableId(d.captureId), paused: bool(d.paused) };
}
function parseUi(value: unknown, version: WorkspaceEditRecoveryVersion): WorkspaceEditRecoveryUi {
  const d = object(value, ["settings", "entry", "receiver", "survey", "layout", "catalog", "file"]);
  const settings = parseAppSettings(d.settings);
  // Core schemas may strip unknown members, supply defaults or normalize inputs.
  // A recovery snapshot is the exact acknowledged settings shape, not a patch:
  // reject any lossy/implicit conversion instead of silently accepting it.
  if (workspaceRecoveryStableJson(settings) !== workspaceRecoveryStableJson(d.settings)) fail("Recovery settings contain unknown, missing or noncanonical fields.");
  const e = object(d.entry, ["designTask", "drawing", "toolsOpen", "receiverOpen", "diagnosticOpen", "layerVisibility"]);
  const s = object(d.survey, ["purposeId", "label", "referenceName", "referenceNotes", "referenceBaselineName", "referenceBaselineNotes", "referenceDetails"]);
  const l = object(d.layout, ["name", "nameBaseline", "label", "copyName", "details"]);
  const c = object(d.catalog, ["projectCrs", "units", "form", "moveOpen", "moveCustomerId", "import", "savedImportId", "importFieldId", "importName", "message", "failed"]);
  const f = object(d.file, ["dialog", "text", "baseline", "savedCopyId"]);
  const r = object(d.receiver, ["method", "baudRate", "protocol", "address", "port", "sourceAddress", "settingsOpen"]);
  let form: WorkspaceEditRecoveryUi["catalog"]["form"] = null;
  if (c.form !== null) { const p = object(c.form, ["kind", "context", "baselineFingerprint", "defaultName", "name", "fieldName", "client", "detailsOpen", "errors", "error", "fieldError", "saveError"]);
    let client: WorkspaceRecoveryClientForm | null = null;
    if (p.client !== null) { const input = object(p.client, clientFields); client = Object.fromEntries(clientFields.map(key => [key, rawText(input[key])])) as unknown as WorkspaceRecoveryClientForm; }
    const selection = parseUnifiedWorkspaceResume({ version: 2, catalogVisible: true, catalogSelection: p.context, workspace: { mode: "design", design: null, layout: null, collectionId: null } }).catalogSelection;
    const kinds: readonly WorkspaceRecoveryCatalogFormKind[] = version === WORKSPACE_EDIT_RECOVERY_V1_VERSION ? V1_CATALOG_FORM_KINDS : [...V1_CATALOG_FORM_KINDS, "rename_field_map"];
    form = { kind: choice(p.kind, kinds), context: selection,
      baselineFingerprint: rawText(p.baselineFingerprint), defaultName: rawText(p.defaultName), name: rawText(p.name), fieldName: rawText(p.fieldName), client,
      detailsOpen: bool(p.detailsOpen), errors: unique(array(p.errors, 32, input => { const err = object(input, ["field", "message"]);
        return { field: choice(err.field, [...clientFields, "name", "fieldName", "projectCrs", "units"]), message: rawText(err.message) }; }), error => error.field),
      error: nullableText(p.error), fieldError: nullableText(p.fieldError), saveError: nullableText(p.saveError) };
  }
  const savedImportId = nullableId(c.savedImportId);
  if (savedImportId !== null && c.import !== null) fail("An acknowledged Catalog import cannot be recovered as an unsubmitted upload.");
  return { settings, entry: { designTask: choice(e.designTask, ["drawing", "inputs", "machines", "review"] as const), drawing: parseDrawing(e.drawing),
      toolsOpen: bool(e.toolsOpen), receiverOpen: bool(e.receiverOpen), diagnosticOpen: bool(e.diagnosticOpen),
      layerVisibility: unique(array(e.layerVisibility, layers.length, input => { const v = object(input, ["layer", "visible"]); return { layer: choice(v.layer, layers), visible: bool(v.visible) }; }), v => v.layer) },
    receiver: { method: choice(r.method, ["usb", "bluetooth_spp", "network"] as const), baudRate: rawText(r.baudRate), protocol: choice(r.protocol, ["tcp", "udp"] as const),
      address: rawText(r.address), port: rawText(r.port), sourceAddress: rawText(r.sourceAddress), settingsOpen: bool(r.settingsOpen) },
    survey: { purposeId: rawText(s.purposeId), label: rawText(s.label), referenceName: rawText(s.referenceName), referenceNotes: rawText(s.referenceNotes),
      referenceBaselineName: rawText(s.referenceBaselineName), referenceBaselineNotes: rawText(s.referenceBaselineNotes), referenceDetails: bool(s.referenceDetails) },
    layout: { name: rawText(l.name), nameBaseline: rawText(l.nameBaseline), label: rawText(l.label), copyName: rawText(l.copyName), details: bool(l.details) },
    catalog: { projectCrs: rawText(c.projectCrs), units: rawText(c.units), form, moveOpen: bool(c.moveOpen), moveCustomerId: rawText(c.moveCustomerId),
      import: c.import === null ? null : parseWorkspaceRecoveryImport(c.import), savedImportId, importFieldId: rawText(c.importFieldId), importName: rawText(c.importName), message: nullableText(c.message), failed: bool(c.failed) },
    file: { dialog: f.dialog === null ? null : choice(f.dialog, ["copy", "rename", "preferences"] as const), text: rawText(f.text), baseline: rawText(f.baseline), savedCopyId: nullableId(f.savedCopyId) } };
}
function parseCamera(value: unknown): WorkspaceRecoveryCamera {
  const d = object(value, ["context", "viewport", "initialized"]), raw = object(d.context, ["kind"], ["fieldMapId", "payloadId", "documentKind", "projectCrs", "targetHash"]);
  let context: WorkspaceMapContext;
  if (raw.kind === "field") { const v = object(raw, ["kind", "fieldMapId", "projectCrs"]); context = { kind: "field", fieldMapId: id(v.fieldMapId), projectCrs: nullableId(v.projectCrs) }; }
  else if (raw.kind === "independent") { const v = object(raw, ["kind", "payloadId", "documentKind", "projectCrs"]); context = { kind: "independent", payloadId: id(v.payloadId), documentKind: choice(v.documentKind, ["draft", "project", "field"] as const), projectCrs: nullableId(v.projectCrs) }; }
  else { const v = object(raw, ["kind", "targetHash", "projectCrs"]); if (v.kind !== "target_preview") fail("Unsupported recovery camera context."); context = { kind: "target_preview", targetHash: hash(v.targetHash), projectCrs: id(v.projectCrs) }; }
  const v = object(d.viewport, ["center", "baseWidthMeters", "baseHeightMeters", "zoomLevel"]), p = object(v.center, ["x", "y"]);
  const viewport = { center: { x: finite(p.x), y: finite(p.y) }, baseWidthMeters: finite(v.baseWidthMeters), baseHeightMeters: finite(v.baseHeightMeters), zoomLevel: finite(v.zoomLevel) };
  // Use the actual camera-store admission guard, including finite visible corners
  // and screen adjustment. Finite components alone can still overflow its extent.
  if (!viewportForScreen(viewport, { width: 100, height: 100 })) fail("Recovery camera has invalid visible extent.");
  return { context, viewport, initialized: bool(d.initialized) };
}

/** Strict detached parsing validates structure and domain documents, but cannot
 * establish saved-source authority. Resolve against a fresh durable workspace next. */
export function parseWorkspaceEditRecovery(raw: string | unknown): WorkspaceEditRecoveryCandidate {
  const d = object(detach(typeof raw === "string" ? parseJsonBounded(raw) : raw), ["recoveryVersion", "writerId", "sequence", "capturedAt", "context", "workspaceRevision", "editable", "collections", "layout", "controller", "inputs", "ui", "cameras"]);
  if (d.recoveryVersion !== WORKSPACE_EDIT_RECOVERY_VERSION && d.recoveryVersion !== WORKSPACE_EDIT_RECOVERY_V1_VERSION) fail("Unsupported edit recovery version.");
  const recoveryVersion = d.recoveryVersion;
  const context = parseUnifiedWorkspaceResume(d.context), workspaceRevision = nullableInteger(d.workspaceRevision);
  let editable: WorkspaceRecoveryEditable | null = null;
  if (d.editable !== null) { const e = object(d.editable, ["identity", "sourceDocument", "originalProjectDocument", "designRevision", "workingDocument", "editor"]);
    const r = object(e.editor, ["past", "future", "revision", "savedRevision", "lastError", "lockedCrs", "selectedMachineId"]), identity = parseIdentity(e.identity);
    const revision = integer(r.revision), savedRevision = integer(r.savedRevision);
    if (savedRevision > revision) fail("Recovery saved editor revision cannot exceed current revision.");
    editable = { identity, sourceDocument: rawText(e.sourceDocument), originalProjectDocument: nullableText(e.originalProjectDocument), designRevision: nullableInteger(e.designRevision),
      workingDocument: rawText(e.workingDocument), editor: { past: array(r.past, WORKSPACE_EDIT_RECOVERY_LIMITS.history, rawText), future: array(r.future, WORKSPACE_EDIT_RECOVERY_LIMITS.history, rawText),
        revision, savedRevision, lastError: nullableText(r.lastError), lockedCrs: nullableId(r.lockedCrs), selectedMachineId: nullableId(r.selectedMachineId) } };
    if (identity.kind !== "draft" && editable.editor.lockedCrs !== null || identity.kind !== "field" && editable.editor.selectedMachineId !== null
      || identity.kind !== "field" && editable.originalProjectDocument !== null) fail("Recovery editor state belongs to another document kind.");
    const source = readSurveyDesignDocument(identity.kind, editable.sourceDocument);
    if (source.id !== identity.payloadId) fail("Recovery saved source payload identity differs.");
    if (editable.originalProjectDocument !== null) readSurveyDesignDocument("project", editable.originalProjectDocument);
    checkDocumentFrame(readSurveyDesignDocument(identity.kind, editable.workingDocument), editable);
    for (const document of [...editable.editor.past, ...editable.editor.future]) checkDocumentFrame(readSurveyDesignDocument(identity.kind, document), editable, true);
    const current = readSurveyDesignDocument(identity.kind, editable.workingDocument);
    if (identity.kind === "field" && editable.editor.selectedMachineId !== null && !(current as FieldDesign).machines.some(machine => machine.id === editable!.editor.selectedMachineId)) fail("Recovery selected machine does not belong to the current field.");
    if (context.workspace.design && (context.workspace.design.designId !== identity.designId || context.workspace.design.documentKind !== identity.kind
      || context.workspace.design.payloadId !== identity.payloadId || context.workspace.design.fieldMapId !== identity.fieldMapId || context.workspace.design.projectCrs !== identity.projectCrs)) fail("Recovery context and editor ownership disagree.");
    if (identity.designId !== null && context.workspace.design === null) fail("Recovery managed editor requires its validated saved context.");
  } else if (context.workspace.design !== null) fail("Recovery context design has no retained editor.");
  const collections = unique(array(d.collections, WORKSPACE_EDIT_RECOVERY_LIMITS.collections, value => { const a = object(value, ["id", "revision", "document"]);
    const anchor = { id: id(a.id), revision: integer(a.revision), document: rawText(a.document) }, collection = parseSurveyCollectionDocument(anchor.document);
    if (collection.id !== anchor.id || collection.revision !== anchor.revision || !editable || !matchesCollectionOwner(collection, editable.identity)) fail("Recovery Survey anchor has a different identity or owner.");
    return anchor; }), item => item.id);
  if (context.workspace.collectionId !== null && !collections.some(item => item.id === context.workspace.collectionId)) fail("Recovery selected Survey collection has no exact anchor.");
  let layout: WorkspaceRecoveryLayoutAnchor | null = null;
  if (d.layout !== null) { const a = object(d.layout, ["id", "revision", "persistenceRevision", "document", "fieldMapId", "targetHash", "targetDocument"]);
    layout = { id: id(a.id), revision: integer(a.revision), persistenceRevision: integer(a.persistenceRevision), document: rawText(a.document), fieldMapId: id(a.fieldMapId), targetHash: hash(a.targetHash), targetDocument: rawText(a.targetDocument) };
    const session = parseLayoutSessionDocument(layout.document), target = parseFieldLayoutTarget(layout.targetDocument), hint = context.workspace.layout;
    if (session.id !== layout.id || session.revision !== layout.revision || session.fieldMapId !== layout.fieldMapId || session.targetHash !== layout.targetHash || session.targetDocument !== layout.targetDocument
      || !hint || hint.sessionId !== layout.id || hint.fieldMapId !== layout.fieldMapId || hint.targetHash !== layout.targetHash || hint.projectCrs !== target.field.projectCrs) fail("Recovery Layout/session/target anchors disagree.");
    if (workspaceRevision !== null && layout.persistenceRevision > workspaceRevision) fail("Recovery Layout receipt exceeds captured workspace revision.");
  } else if (context.workspace.layout !== null) fail("Recovery Layout context has no exact saved anchor.");
  const c = object(d.controller, ["historyPast", "historyFuture", "selectedAddress"]), controller = {
    historyPast: array(c.historyPast, WORKSPACE_EDIT_RECOVERY_LIMITS.history, parseHistory), historyFuture: array(c.historyFuture, WORKSPACE_EDIT_RECOVERY_LIMITS.history, parseHistory), selectedAddress: nullableText(c.selectedAddress) };
  if (!editable && (controller.historyPast.length || controller.historyFuture.length || collections.length)) fail("Recovery document history requires an editor owner.");
  if (editable) for (const snapshot of [...controller.historyPast, ...controller.historyFuture]) checkDocumentFrame(readSurveyDesignDocument(editable.identity.kind, snapshot.document), editable, true);
  const values: WorkspaceEditRecoveryCandidateValues = { writerId: id(d.writerId), sequence: integer(d.sequence, true), capturedAt: date(d.capturedAt),
    context, workspaceRevision, editable, collections, layout, controller, inputs: parseInputs(d.inputs),
    cameras: unique(array(d.cameras, WORKSPACE_EDIT_RECOVERY_LIMITS.cameras, parseCamera), camera => workspaceMapContextKey(camera.context)) };
  const ui = parseUi(d.ui, recoveryVersion);
  // The version-specific enum check above is the v1 admission gate. Neither
  // parsing nor serialization promotes a legacy envelope to the current version.
  const result: WorkspaceEditRecoveryCandidate = recoveryVersion === WORKSPACE_EDIT_RECOVERY_V1_VERSION
    ? { ...values, recoveryVersion, ui: ui as WorkspaceEditRecoveryUiV1 } : { ...values, recoveryVersion, ui };
  if (result.ui.entry.drawing && (!editable || editable.identity.kind === "field" || editable.identity.kind === "draft" && result.ui.entry.drawing.vertices.length)) fail("Recovery pending drawing belongs to another editor owner.");
  if (result.ui.entry.drawing?.vertices.length && editable?.identity.projectCrs === null) fail("Recovery projected drawing requires its declared coordinate frame.");
  utf8Bytes(JSON.stringify(result)); return freeze(result);
}
export function serializeWorkspaceEditRecovery(candidate: WorkspaceEditRecoveryCandidate): string { return workspaceRecoveryStableJson(parseWorkspaceEditRecovery(candidate)); }

function draftHasCoordinates(draft: DesignDraft): boolean {
  return draft.fieldBoundary.length > 0 || draft.pivotCenter !== null || draft.waterSource !== null || draft.powerSource !== null
    || draft.obstacles.length > 0 || (draft.mapFeatures?.length ?? 0) > 0 || draft.surveyPoints.length > 0
    || (draft.drawingWorkflow?.captures.some(capture => capture.vertices.length > 0) ?? false);
}
function checkDocumentFrame(payload: PivotProject | DesignDraft | FieldDesign, editable: WorkspaceRecoveryEditable, history = false): void {
  // A coordinate-free older Draft has no projected frame to relabel. Its raw text
  // stays exact; hydration may supply the current declared frame and durable lock.
  const emptyUnknownHistory = history && editable.identity.kind === "draft" && payload.projectCrs === null
    && !draftHasCoordinates(payload as DesignDraft) && (payload as DesignDraft).drawingWorkflow?.lockedCrs == null;
  if (payload.id !== editable.identity.payloadId || payload.projectCrs !== editable.identity.projectCrs && !emptyUnknownHistory) fail("Recovery current/history payload identity or CRS differs.");
  if (editable.identity.kind === "draft") { const draft = payload as DesignDraft;
    const actualLock = draft.drawingWorkflow?.lockedCrs ?? null;
    if (editable.editor.lockedCrs !== null && payload.projectCrs !== editable.editor.lockedCrs && !emptyUnknownHistory || actualLock !== null && actualLock !== editable.editor.lockedCrs) fail("Recovery Draft history cannot relabel its locked drawing CRS.");
    const inferred = draftHasCoordinates(draft);
    if (inferred && editable.editor.lockedCrs === null) fail("Recovery Draft coordinates require the retained editor CRS lock.");
  }
}
function matchesCollectionOwner(collection: SurveyCollection, identity: WorkspaceDocumentIdentity): boolean {
  const o = collection.owner; return o.designId === identity.designId && o.documentKind === identity.kind && o.payloadId === identity.payloadId && o.fieldMapId === identity.fieldMapId && o.projectCrs === identity.projectCrs;
}

/** Source-bound staging only. The caller must still renew all runtime owners,
 * revalidate its fresh read/intent under its lease, then publish once. */
export function resolveWorkspaceEditRecovery(input: WorkspaceEditRecoveryCandidate | unknown, freshWorkspace: WorkspaceDocument): WorkspaceEditRecoveryResolution {
  let candidate: WorkspaceEditRecoveryCandidate, workspace: WorkspaceDocument;
  try { candidate = parseWorkspaceEditRecovery(input); } catch (error) { return freeze({ kind: "invalid", reason: error instanceof Error ? error.message : "Invalid recovery candidate." }); }
  if (candidate.ui.entry.diagnosticOpen) return freeze({ kind: "unsupported", reason: "Diagnostic panel state has no recovery participant owner; preserve the candidate for export." });
  if (candidate.workspaceRevision === null || candidate.editable && (candidate.editable.identity.designId === null || candidate.editable.designRevision === null)) return freeze({ kind: "unsupported", reason: "Independent or incomplete source receipts remain exportable; active hydration requires a managed saved source." });
  try { workspace = validateWorkspaceDocument(detach(freshWorkspace, 64 * 1024 * 1024)); } catch { return freeze({ kind: "invalid", reason: "Fresh durable workspace is invalid." }); }
  if (workspace.revision < candidate.workspaceRevision || candidate.layout && workspace.revision < candidate.layout.persistenceRevision) return freeze({ kind: "source_conflict", reason: "The acknowledged workspace receipt moved backwards." });
  try {
    // The context remains exact captured preference data. Saved source admission
    // uses the retained source frame, as the ordinary sibling proof does.
    const sourceCrs = candidate.editable ? readSurveyDesignDocument(candidate.editable.identity.kind, candidate.editable.sourceDocument).projectCrs : null;
    const savedContext = candidate.context.workspace.design ? { ...candidate.context, workspace: { ...candidate.context.workspace,
      design: { ...candidate.context.workspace.design, projectCrs: sourceCrs } } } : candidate.context;
    const resume = resolveUnifiedWorkspaceResume(savedContext, workspace);
    if (resume.reasons.some(reason => reason !== "catalog_selection_changed")) fail("Saved recovery ownership or context changed.");
    if (candidate.recoveryVersion === WORKSPACE_EDIT_RECOVERY_VERSION && candidate.ui.catalog.form?.kind === "rename_field_map") {
      const form = candidate.ui.catalog.form, context = form.context;
      const client = workspace.catalog.clients.find(item => item.id === context.clientId);
      const project = workspace.catalog.projects.find(item => item.id === context.projectId && item.clientId === client?.id);
      const field = workspace.catalog.fieldMaps.find(item => item.id === context.fieldMapId && item.projectId === project?.id);
      const design = context.designId === null ? null : workspace.catalog.designs.find(item => item.id === context.designId && item.fieldMapId === field?.id);
      if (!client || !project || !field || context.designId !== null && !design) fail("The recovered field rename requires its exact current client, project and field ancestry.");
      // The captured parent fingerprint is inert raw review context. Unrelated
      // Customer/Project metadata must not discard an exact retained editor.
      // Catalog must stage its fresh runtime baseline and explicitly Recheck;
      // recovery neither rebases this fingerprint nor grants submission authority.
      if (form.defaultName !== field.name)
        fail("The recovered field rename saved field name changed. Preserve its exact raw values and review the current field explicitly.");
    }
    // These are parked affordance pointers, not saved-operation/data authority.
    // Opening/importing still requires a new explicit action against fresh records.
    for (const [label, designId] of [["Catalog import", candidate.ui.catalog.savedImportId], ["File copy", candidate.ui.file.savedCopyId]] as const) {
      if (designId !== null && !workspace.catalog.designs.some(design => design.id === designId)) fail(`The acknowledged ${label} design pointer is no longer present in the fresh workspace.`);
    }
    const read = candidate.editable ? readWorkspaceDesign(workspace, candidate.editable.identity.designId!) : null;
    let hydrated: WorkspaceEditableDocument | null = null;
    let collections: SurveyCollection[] = [];
    const authorizedEvidence = new Map<string, string>();
    const authorizedCaptures = new Set<string>(), authorizedTimedCaptures = new Set<string>();
    let admitDocument: ((raw: string, history?: boolean) => PivotProject | DesignDraft | FieldDesign) | null = null;
    if (candidate.editable) {
      const held = candidate.editable;
      if (!read || read.kind === "not_found") fail("The saved design is no longer available.");
      const fresh = editableFromSavedDesign(read), trusted = readSurveyDesignDocument(read.kind, read.document);
      const canonicalSource = fresh.kind === "draft" ? fresh.editor.draft : fresh.kind === "field" ? fresh.editor.field : fresh.editor.project;
      const expectedIdentity = { ...held.identity, projectCrs: trusted.projectCrs };
      if (workspaceDocumentIdentityKey(fresh.identity) !== workspaceDocumentIdentityKey(expectedIdentity) || read.kind !== held.identity.kind
        || read.design.revision !== held.designRevision || read.document !== held.sourceDocument
        || (read.kind === "field" ? read.originalProjectDocument ?? null : null) !== held.originalProjectDocument) fail("The exact saved design/source/original identity, ancestry or revision changed.");
      // A genuinely empty Draft may acquire its first declared CRS in unfinished inputs.
      if (trusted.projectCrs !== held.identity.projectCrs && (read.kind !== "draft" || trusted.projectCrs !== null || draftHasCoordinates(trusted as DesignDraft)
        || (trusted as DesignDraft).drawingWorkflow?.lockedCrs !== undefined && (trusted as DesignDraft).drawingWorkflow?.lockedCrs !== null)) fail("Recovery changed its canonical saved coordinate frame.");
      const owned = (workspace.surveyCollections ?? []).map(entry => ({ entry, collection: parseSurveyCollectionDocument(entry.document) })).filter(item => matchesCollectionOwner(item.collection, fresh.identity));
      if (owned.length !== candidate.collections.length || owned.some(item => !candidate.collections.some(anchor => anchor.id === item.entry.id && anchor.revision === item.collection.revision && anchor.document === item.entry.document))) fail("The exact owned Survey collection set, receipts or observations changed.");
      collections = owned.map(item => item.collection);
      operationalObservationPayloads(trusted, authorizedEvidence);
      collections.forEach(collection => operationalObservationPayloads(collection, authorizedEvidence));
      if (held.originalProjectDocument !== null) operationalObservationPayloads(readSurveyDesignDocument("project", held.originalProjectDocument), authorizedEvidence);
      const authorizeCaptures = (value: unknown) => visitOperationalCaptures(value, (evidence, times) => {
        const capture = workspaceRecoveryStableJson(evidence); authorizedCaptures.add(capture);
        if (times !== null) authorizedTimedCaptures.add(workspaceRecoveryStableJson({ evidence, times }));
      });
      authorizeCaptures(trusted); collections.forEach(authorizeCaptures);
      if (held.originalProjectDocument !== null) authorizeCaptures(readSurveyDesignDocument("project", held.originalProjectDocument));
      admitDocument = (raw, history = false) => {
        let parsed = readSurveyDesignDocument(held.identity.kind, raw); checkDocumentFrame(parsed, held, history);
        if (history && held.identity.kind === "draft" && parsed.projectCrs === null && held.identity.projectCrs !== null) {
          const draft = parsed as DesignDraft;
          parsed = { ...draft, projectCrs: held.identity.projectCrs };
          if (held.editor.lockedCrs !== null) (parsed as DesignDraft).drawingWorkflow = { schemaVersion: "draft-drawing-workflow-v1", autosaveEnabled: false,
            activeCaptureId: null, captures: [], ...draft.drawingWorkflow, lockedCrs: held.editor.lockedCrs };
        }
        // Never let recovery itself seed trusted retained reference authority.
        const merged = mergeRetainedReferenceOrigins(trusted, parsed);
        assertSurvivingRecordedReferenceHistory(trusted, merged);
        assertNewRecordedReferenceHistory(trusted, merged, collections);
        if (merged.projectCrs !== null) assertRecordedReferenceAttachments(merged.drawingMetadata?.records ?? [], collections, {
          designId: held.identity.designId!, documentKind: held.identity.kind, payloadId: held.identity.payloadId, fieldMapId: held.identity.fieldMapId!, projectCrs: merged.projectCrs });
        for (const [identity, payload] of operationalObservationPayloads(merged)) if (authorizedEvidence.get(identity) !== payload) fail("Recovery cannot invent or rewrite operational receiver observation authority.");
        // The ordinary observation helper intentionally omits capture freshness.
        // Recovery has no recapture authority: every complete evidence occurrence
        // and its owner capture time must already occur in a fresh admitted source.
        visitOperationalCaptures(merged, (evidence, times) => {
          if (!authorizedCaptures.has(workspaceRecoveryStableJson(evidence)) || times !== null
            && !authorizedTimedCaptures.has(workspaceRecoveryStableJson({ evidence, times }))) fail("Recovery cannot invent or rewrite complete operational capture evidence or capture times.");
        });
        return parkAutosave(merged);
      };
      const current = admitDocument(held.workingDocument), past = held.editor.past.map(raw => admitDocument!(raw, true)), future = held.editor.future.map(raw => admitDocument!(raw, true));
      // Parking and retained-origin hydration can change persisted domain values.
      // Derive truthful dirty state from the final hydrated current document.
      const workingDataChanged = workspaceRecoveryStableJson(canonicalPayload(held.identity.kind, current)) !== workspaceRecoveryStableJson(canonicalSource);
      // Serialized counters are continuity data, not authority that working edits
      // were saved. Equal forged counters must not hide changed domain values.
      const revision = workingDataChanged && held.editor.revision === held.editor.savedRevision && held.editor.revision === 0 ? 1 : held.editor.revision;
      const savedRevision = workingDataChanged && revision === held.editor.savedRevision ? revision - 1 : held.editor.savedRevision;
      const common = { identity: { ...held.identity }, sourceDocument: held.sourceDocument, workspaceRevision: workspace.revision, designRevision: held.designRevision!, savedEditorRevision: savedRevision };
      const editor = { past, future, revision, lastError: held.editor.lastError };
      hydrated = held.identity.kind === "draft" ? { ...common, kind: "draft", editor: { ...editor, draft: current as DesignDraft, past: past as DesignDraft[], future: future as DesignDraft[], lockedCrs: held.editor.lockedCrs } }
        : held.identity.kind === "field" ? { ...common, kind: "field", ...(held.originalProjectDocument === null ? {} : { originalProjectDocument: held.originalProjectDocument }),
          editor: { ...editor, field: current as FieldDesign, past: past as FieldDesign[], future: future as FieldDesign[], selectedMachineId: held.editor.selectedMachineId } }
          : { ...common, kind: "project", editor: { ...editor, project: current as PivotProject, past: past as PivotProject[], future: future as PivotProject[] } };
    }
    let layout: WorkspaceEditRecoveryAdmission["layout"] = null;
    if (candidate.layout) { const held = candidate.layout, entry = workspace.layoutSessions?.find(item => item.id === held.id);
      if (!entry || entry.document !== held.document) fail("The exact saved Layout session changed.");
      const session = parseLayoutSessionDocument(entry.document);
      if (session.id !== held.id || session.revision !== held.revision || session.fieldMapId !== held.fieldMapId || session.targetHash !== held.targetHash || session.targetDocument !== held.targetDocument) fail("The immutable Layout target or session receipt changed.");
      layout = { session, persistenceRevision: workspace.revision };
    }
    const admitHistory = (snapshot: WorkspaceHistorySnapshot): WorkspaceHistorySnapshot => {
      if (!admitDocument) fail("Recovery history has no admitted document owner.");
      const document = admitDocument(snapshot.document, true);
      for (const m of snapshot.memberships) { const collection = collections.find(item => item.id === m.collectionId);
        if (!collection) fail("Recovery history membership belongs to another collection.");
        proposeSurveyMembershipRestore(collection, { expectedRevision: collection.revision, now: collection.updatedAt, activePointIds: [...m.activePointIds], state: m.state }); }
      return { document: writePayload(candidate.editable!.identity.kind, document), memberships: snapshot.memberships.map(m => ({ ...m, activePointIds: [...m.activePointIds] })) };
    };
    const historyPast = candidate.controller.historyPast.map(admitHistory), historyFuture = candidate.controller.historyFuture.map(admitHistory);
    for (const camera of candidate.cameras) {
      if (camera.context.kind === "field") { const context = camera.context, field = workspace.catalog.fieldMaps.find(item => item.id === context.fieldMapId), project = workspace.catalog.projects.find(item => item.id === field?.projectId);
        const emptyCurrentDraft = context.projectCrs === null && candidate.editable?.identity.kind === "draft" && candidate.editable.identity.fieldMapId === context.fieldMapId && candidate.editable.identity.projectCrs === null;
        if (!field || !project || context.projectCrs !== project.projectCrs && !emptyCurrentDraft) fail("Recovery camera field or coordinate frame changed."); }
      else if (camera.context.kind === "target_preview") { if (!candidate.layout || candidate.layout.targetHash !== camera.context.targetHash || parseFieldLayoutTarget(candidate.layout.targetDocument).field.projectCrs !== camera.context.projectCrs) fail("Recovery camera target context changed."); }
      else fail("Independent recovery cameras require explicit independent source review.");
    }
    const staged = { ...candidate, workspaceRevision: workspace.revision,
      layout: candidate.layout ? { ...candidate.layout, persistenceRevision: workspace.revision } : null };
    const ui = { ...candidate.ui, entry: { ...candidate.ui.entry, drawing: candidate.ui.entry.drawing ? { ...candidate.ui.entry.drawing, paused: true } : null } };
    const admission = detach({ candidate, staged, editable: hydrated, collections, layout, historyPast, historyFuture, ui, inputs: candidate.inputs,
      requiresImportReview: candidate.ui.catalog.import !== null, requiresCatalogReview: candidate.ui.catalog.form !== null || candidate.ui.catalog.moveOpen || resume.reasons.includes("catalog_selection_changed") }, 64 * 1024 * 1024) as WorkspaceEditRecoveryAdmission;
    return freeze({ kind: workspace.revision === candidate.workspaceRevision ? "ready" : "reconcile_required", admission });
  } catch (error) { return freeze({ kind: "source_conflict", reason: error instanceof Error ? error.message : "Saved recovery source changed." }); }
}
function writePayload(kind: WorkspaceDocumentIdentity["kind"], value: PivotProject | DesignDraft | FieldDesign): string { return kind === "draft" ? serializeDesignDraftDocument(value as DesignDraft) : kind === "field" ? serializeFieldDesignDocument(value as FieldDesign) : serializeProjectDocument(value as PivotProject); }
function canonicalPayload(kind: WorkspaceDocumentIdentity["kind"], value: PivotProject | DesignDraft | FieldDesign): PivotProject | DesignDraft | FieldDesign {
  return kind === "draft" ? createDesignDraftEditorState(value as DesignDraft).draft : kind === "field" ? createFieldDesignEditorState(value as FieldDesign).field : createProjectEditorState(value as PivotProject).project;
}
/** Only detached, validated domain sources participate. Ordered capture payloads
 * remain exact; complete tuples may have multiple authorized recapture occurrences. */
function visitOperationalCaptures(value: unknown, visit: (evidence: ReturnType<typeof OperationalFixedGgaEvidenceSchema.parse>,
  times: Record<string, unknown> | null) => void, parent: Record<string, unknown> | null = null): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(item => visitOperationalCaptures(item, visit)); return; }
  const object = value as Record<string, unknown>;
  if (object.schemaVersion === "gnss-operational-fixed-v1") {
    const evidence = OperationalFixedGgaEvidenceSchema.parse(object);
    const times = parent ? Object.fromEntries(["observedAt", "capturedAt", "recordedAt"].filter(key => Object.hasOwn(parent, key)).map(key => [key, parent[key]])) : {};
    visit(evidence, Object.keys(times).length ? times : null);
  } else Object.values(object).forEach(item => visitOperationalCaptures(item, visit, object));
}
function parkAutosave<T extends PivotProject | DesignDraft | FieldDesign>(payload: T): T {
  const result = { ...payload };
  if (result.drawingMetadata) result.drawingMetadata = { ...result.drawingMetadata, autosaveEnabled: false };
  if ("drawingWorkflow" in result && result.drawingWorkflow) result.drawingWorkflow = { ...result.drawingWorkflow, autosaveEnabled: false };
  return result;
}

const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail("Recovery import requires canonical base64 bytes.");
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0, bytes = new Uint8Array(value.length / 4 * 3 - padding);
  let offset = 0;
  for (let i = 0; i < value.length; i += 4) { const a = base64Alphabet.indexOf(value[i]), b = base64Alphabet.indexOf(value[i + 1]), c = value[i + 2] === "=" ? 0 : base64Alphabet.indexOf(value[i + 2]), d = value[i + 3] === "=" ? 0 : base64Alphabet.indexOf(value[i + 3]);
    if (offset < bytes.length) bytes[offset++] = a << 2 | b >>> 4;
    if (offset < bytes.length) bytes[offset++] = b << 4 | c >>> 2;
    if (offset < bytes.length) bytes[offset++] = c << 6 | d; }
  if (padding === 2 && (base64Alphabet.indexOf(value.at(-3)!) & 15) || padding === 1 && (base64Alphabet.indexOf(value.at(-2)!) & 3)) fail("Recovery import base64 has noncanonical padding bits.");
  return bytes;
}
/** Exact byte digest: binary ZIP bytes are not interpreted as UTF-8 text. */
export function workspaceRecoveryBytesSha256(input: Uint8Array): string {
  const count = Math.ceil((input.length + 9) / 64) * 64, bytes = new Uint8Array(count); bytes.set(input); bytes[input.length] = 128;
  const view = new DataView(bytes.buffer); view.setUint32(count - 8, Math.floor(input.length * 8 / 2 ** 32)); view.setUint32(count - 4, input.length * 8 >>> 0);
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], rotate = (n: number, b: number) => n >>> b | n << 32 - b;
  for (let offset = 0; offset < count; offset += 64) { const w = new Array<number>(64); for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = w[i - 16] + (rotate(a,7) ^ rotate(a,18) ^ a >>> 3) + w[i - 7] + (rotate(b,17) ^ rotate(b,19) ^ b >>> 10) | 0; }
    let [a,b,c,d,e,f,g,v] = h;
    for (let i = 0; i < 64; i++) { const x = v + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + ((e&f)^(~e&g)) + k[i] + w[i] | 0;
      const y = (rotate(a,2)^rotate(a,13)^rotate(a,22)) + ((a&b)^(a&c)^(b&c)) | 0; v=g;g=f;f=e;e=d+x|0;d=c;c=b;b=a;a=x+y|0; }
    [a,b,c,d,e,f,g,v].forEach((n,i) => h[i] = h[i] + n | 0); }
  return h.map(n => (n >>> 0).toString(16).padStart(8,"0")).join("");
}
export function parseWorkspaceRecoveryImport(input: unknown): WorkspaceRecoveryImport {
  const value = object(detach(input), ["filename", "bytesBase64", "byteLength", "sha256"]), result = {
    filename: rawText(value.filename), bytesBase64: rawText(value.bytesBase64), byteLength: integer(value.byteLength), sha256: hash(value.sha256) };
  if (!result.filename || result.filename.length > 4096 || result.byteLength > WORKSPACE_EDIT_RECOVERY_MAX_BYTES) fail("Recovery import filename or length exceeds its limit.");
  const bytes = decodeBase64(result.bytesBase64);
  if (bytes.length !== result.byteLength || workspaceRecoveryBytesSha256(bytes) !== result.sha256) fail("Recovery import exact bytes do not match their length/digest.");
  return freeze(result);
}
export function decodeWorkspaceRecoveryImport(input: WorkspaceRecoveryImport): Uint8Array { return decodeBase64(parseWorkspaceRecoveryImport(input).bytesBase64); }
