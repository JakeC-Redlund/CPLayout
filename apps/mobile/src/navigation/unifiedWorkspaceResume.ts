import { parseFieldLayoutTarget, parseLayoutSessionDocument, parseStrictJson, parseSurveyCollectionDocument,
  type LayoutSession, type SurveyCollection } from "@cplayout/core";
import { readWorkspaceDesign, validateWorkspaceDocument, type WorkspaceDesignRead, type WorkspaceDocument } from "@cplayout/project-store";
import type { ProjectCatalogContext } from "../hooks/useProjectRepository";

export const UNIFIED_WORKSPACE_RESUME_KEY = "cplayout-unified-context-v2";
const MAX_BYTES = 8 * 1024, MAX_TEXT = 256;
type Mode = "design" | "survey" | "layout";
export interface UnifiedWorkspaceResume {
  version: 2;
  catalogVisible: boolean;
  catalogSelection: ProjectCatalogContext;
  workspace: {
    mode: Mode;
    design: null | { designId: string; documentKind: "draft" | "project" | "field"; payloadId: string; fieldMapId: string; projectCrs: string | null };
    layout: null | { sessionId: string; fieldMapId: string; projectCrs: string; targetHash: string };
    collectionId: string | null;
  };
}
type Reason = "invalid_hint" | "invalid_workspace" | "catalog_selection_changed" | "design_not_found"
  | "design_unsupported" | "design_identity_mismatch" | "design_crs_mismatch" | "layout_not_found" | "layout_identity_mismatch"
  | "layout_unsupported" | "layout_crs_mismatch" | "subjects_conflict" | "collection_not_found" | "collection_owner_mismatch";
export interface UnifiedWorkspaceResumeResolution {
  designRead: Exclude<WorkspaceDesignRead, { kind: "not_found" }> | null;
  layoutSession: LayoutSession | null;
  collections: SurveyCollection[];
  selectedCollectionId: string | null;
  catalogSelection: ProjectCatalogContext;
  catalogVisible: boolean;
  mode: Mode;
  reasons: Reason[];
}
interface ResumeStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
type ReadResult = { kind: "absent" | "invalid" | "unavailable" } | { kind: "success"; hint: UnifiedWorkspaceResume; raw: string };
type WriteResult = { kind: "invalid" | "unavailable" } | { kind: "success"; raw: string };
const emptySelection = (): ProjectCatalogContext => ({ clientId: null, projectId: null, fieldMapId: null, designId: null });

/** Portable UTF-8 bound; does not require a browser encoder or accept lone surrogates. */
function assertUtf8Bound(value: string): void {
  let bytes = 0;
  for (const character of value) {
    const scalar = character.codePointAt(0)!;
    if (scalar >= 0xd800 && scalar <= 0xdfff) throw new Error("Resume text must contain valid Unicode scalars.");
    bytes += scalar <= 0x7f ? 1 : scalar <= 0x7ff ? 2 : scalar <= 0xffff ? 3 : 4;
    if (bytes > MAX_BYTES) throw new Error("Resume hint exceeds its UTF-8 limit.");
  }
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Resume hints require explicit objects.");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("Resume hints require plain data.");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length || Object.keys(descriptors).length !== keys.length
    || Object.keys(descriptors).some(key => !keys.includes(key))
    || keys.some(key => !Object.hasOwn(descriptors, key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value"))) throw new Error("Unsupported or missing resume hint fields.");
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_TEXT || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new Error("Resume IDs and CRS must be bounded text without controls.");
  assertUtf8Bound(value); return value;
}
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function parseSelection(input: unknown): ProjectCatalogContext {
  const data = object(input, ["clientId", "projectId", "fieldMapId", "designId"]);
  const result = { clientId: nullableText(data.clientId), projectId: nullableText(data.projectId), fieldMapId: nullableText(data.fieldMapId), designId: nullableText(data.designId) };
  let ended = false;
  for (const value of Object.values(result)) { if (value === null) ended = true; else if (ended) throw new Error("Catalog selection requires a hierarchical null suffix."); }
  return result;
}
/** Strict, bounded untrusted preference admission. Returned objects contain only the declared hint. */
export function parseUnifiedWorkspaceResume(input: string | unknown): UnifiedWorkspaceResume {
  if (typeof input === "string") { assertUtf8Bound(input); input = parseStrictJson(input); }
  const data = object(input, ["version", "catalogVisible", "catalogSelection", "workspace"]);
  if (data.version !== 2 || typeof data.catalogVisible !== "boolean") throw new Error("Unsupported resume hint version or visibility.");
  const context = object(data.workspace, ["mode", "design", "layout", "collectionId"]);
  if (!["design", "survey", "layout"].includes(context.mode as string)) throw new Error("Unsupported resume workspace mode.");
  let design: UnifiedWorkspaceResume["workspace"]["design"] = null, layout: UnifiedWorkspaceResume["workspace"]["layout"] = null;
  if (context.design !== null) {
    const value = object(context.design, ["designId", "documentKind", "payloadId", "fieldMapId", "projectCrs"]);
    if (!["draft", "project", "field"].includes(value.documentKind as string)) throw new Error("Unsupported design document kind.");
    const projectCrs = nullableText(value.projectCrs);
    if (projectCrs === null && value.documentKind !== "draft") throw new Error("Only a supported empty Draft can retain an unknown CRS.");
    design = { designId: text(value.designId), documentKind: value.documentKind as "draft" | "project" | "field", payloadId: text(value.payloadId), fieldMapId: text(value.fieldMapId), projectCrs };
  }
  if (context.layout !== null) {
    const value = object(context.layout, ["sessionId", "fieldMapId", "projectCrs", "targetHash"]);
    if (typeof value.targetHash !== "string" || !/^[a-f0-9]{64}$/.test(value.targetHash)) throw new Error("Resume target hash requires canonical lowercase SHA256.");
    layout = { sessionId: text(value.sessionId), fieldMapId: text(value.fieldMapId), projectCrs: text(value.projectCrs), targetHash: value.targetHash };
  }
  const collectionId = nullableText(context.collectionId);
  if (collectionId !== null && design === null) throw new Error("A selected Survey collection requires a managed design.");
  const hint: UnifiedWorkspaceResume = { version: 2, catalogVisible: data.catalogVisible, catalogSelection: parseSelection(data.catalogSelection),
    workspace: { mode: context.mode as Mode, design, layout, collectionId } };
  assertUtf8Bound(JSON.stringify(hint)); return hint;
}
export function readUnifiedWorkspaceResume(storage?: ResumeStorage | null): ReadResult {
  let raw: string | null;
  try {
    const selected = storage === undefined ? globalThis.localStorage : storage;
    if (!selected || typeof selected.getItem !== "function") return { kind: "unavailable" };
    raw = selected.getItem(UNIFIED_WORKSPACE_RESUME_KEY);
  } catch { return { kind: "unavailable" }; }
  if (raw === null) return { kind: "absent" };
  if (typeof raw !== "string") return { kind: "invalid" };
  try { return { kind: "success", hint: parseUnifiedWorkspaceResume(raw), raw }; }
  catch { return { kind: "invalid" }; }
}
/** Optional preference failures never throw into an acknowledged domain save. */
export function writeUnifiedWorkspaceResume(input: UnifiedWorkspaceResume, storage?: ResumeStorage | null): WriteResult {
  let raw: string;
  try { raw = JSON.stringify(parseUnifiedWorkspaceResume(input)); } catch { return { kind: "invalid" }; }
  try {
    const selected = storage === undefined ? globalThis.localStorage : storage;
    if (!selected || typeof selected.setItem !== "function") return { kind: "unavailable" };
    selected.setItem(UNIFIED_WORKSPACE_RESUME_KEY, raw); return { kind: "success", raw };
  } catch { return { kind: "unavailable" }; }
}
function normalizeSelection(selection: ProjectCatalogContext, workspace: WorkspaceDocument): ProjectCatalogContext {
  const client = workspace.catalog.clients.find(item => item.id === selection.clientId);
  const project = client && workspace.catalog.projects.find(item => item.id === selection.projectId && item.clientId === client.id);
  const field = project && workspace.catalog.fieldMaps.find(item => item.id === selection.fieldMapId && item.projectId === project.id);
  const design = field && workspace.catalog.designs.find(item => item.id === selection.designId && item.fieldMapId === field.id);
  return { clientId: client?.id ?? null, projectId: project?.id ?? null, fieldMapId: field?.id ?? null, designId: design?.id ?? null };
}
function emptyResolution(reason: Reason): UnifiedWorkspaceResumeResolution {
  return { designRead: null, layoutSession: null, collections: [], selectedCollectionId: null,
    catalogSelection: emptySelection(), catalogVisible: true, mode: "design", reasons: [reason] };
}
/** Consistency with current durable records only; no navigation, storage write, or receiver connection. */
export function resolveUnifiedWorkspaceResume(input: UnifiedWorkspaceResume, inputWorkspace: WorkspaceDocument): UnifiedWorkspaceResumeResolution {
  let hint: UnifiedWorkspaceResume, workspace: WorkspaceDocument;
  try { hint = parseUnifiedWorkspaceResume(input); } catch { return emptyResolution("invalid_hint"); }
  try { workspace = validateWorkspaceDocument(inputWorkspace); } catch { return { ...emptyResolution("invalid_workspace"), mode: hint.workspace.mode }; }
  const reasons: Reason[] = [], catalogSelection = normalizeSelection(hint.catalogSelection, workspace);
  if (JSON.stringify(catalogSelection) !== JSON.stringify(hint.catalogSelection)) reasons.push("catalog_selection_changed");
  let designRead: UnifiedWorkspaceResumeResolution["designRead"] = null, layoutSession: LayoutSession | null = null;
  if (hint.workspace.design) {
    try {
      const expected = hint.workspace.design, read = readWorkspaceDesign(workspace, expected.designId);
      if (read.kind === "not_found") reasons.push("design_not_found");
      else {
        const payload = read.kind === "project" ? read.project : read.kind === "draft" ? read.draft : read.field;
        const parent = workspace.catalog.projects.find(project => project.id === read.context.projectId && project.clientId === read.context.clientId);
        if (read.kind !== expected.documentKind || payload.id !== expected.payloadId || read.context.fieldMapId !== expected.fieldMapId || !parent) reasons.push("design_identity_mismatch");
        else if (payload.projectCrs !== expected.projectCrs || (payload.projectCrs !== null && parent.projectCrs !== payload.projectCrs)) reasons.push("design_crs_mismatch");
        else designRead = read;
      }
    } catch { reasons.push("design_unsupported"); }
  }
  if (hint.workspace.layout) {
    try {
      const expected = hint.workspace.layout, entry = workspace.layoutSessions?.find(item => item.id === expected.sessionId);
      if (!entry) reasons.push("layout_not_found");
      else {
        const session = parseLayoutSessionDocument(entry.document), target = parseFieldLayoutTarget(session.targetDocument);
        const field = workspace.catalog.fieldMaps.find(item => item.id === session.fieldMapId), parent = workspace.catalog.projects.find(item => item.id === field?.projectId);
        if (session.id !== expected.sessionId || session.fieldMapId !== expected.fieldMapId || session.targetHash !== expected.targetHash || !parent
          || !workspace.catalog.clients.some(client => client.id === parent.clientId)) reasons.push("layout_identity_mismatch");
        else if (target.field.projectCrs !== expected.projectCrs || parent.projectCrs !== target.field.projectCrs) reasons.push("layout_crs_mismatch");
        else layoutSession = session;
      }
    } catch { reasons.push("layout_unsupported"); }
  }
  if (designRead && layoutSession) {
    const payload = designRead.kind === "project" ? designRead.project : designRead.kind === "draft" ? designRead.draft : designRead.field;
    const target = parseFieldLayoutTarget(layoutSession.targetDocument);
    if (designRead.context.fieldMapId !== layoutSession.fieldMapId || payload.projectCrs !== target.field.projectCrs) {
      reasons.push("subjects_conflict"); if (hint.workspace.mode === "layout") designRead = null; else layoutSession = null;
    }
  }
  const mode = hint.workspace.mode;
  const collections: SurveyCollection[] = [];
  if (designRead) {
    const payload = designRead.kind === "project" ? designRead.project : designRead.kind === "draft" ? designRead.draft : designRead.field;
    for (const entry of workspace.surveyCollections ?? []) {
      const collection = parseSurveyCollectionDocument(entry.document), owner = collection.owner;
      if (owner.designId === designRead.design.id && owner.documentKind === designRead.kind && owner.payloadId === payload.id
        && owner.fieldMapId === designRead.context.fieldMapId && owner.projectCrs === payload.projectCrs) collections.push(collection);
    }
  }
  const selectedCollectionId = collections.find(collection => collection.id === hint.workspace.collectionId)?.id ?? null;
  if (hint.workspace.collectionId && !selectedCollectionId) reasons.push(workspace.surveyCollections?.some(entry => entry.id === hint.workspace.collectionId) ? "collection_owner_mismatch" : "collection_not_found");
  return { designRead, layoutSession, collections, selectedCollectionId, catalogSelection,
    catalogVisible: hint.catalogVisible || (mode === "layout" ? !designRead && !layoutSession : !designRead), mode, reasons };
}
