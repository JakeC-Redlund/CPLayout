/** Presentation ownership only. Domain reducers, histories, inputs, saves and receiver
 * state live in the workspace controller and must not be recreated by these transitions. */
export type WorkspaceMode = "design" | "survey" | "layout";
export type WorkspaceDocumentKind = "project" | "draft" | "field";

export interface WorkspaceDocumentIdentity {
  /** Independent archive previews have no catalog association; never invent IDs. */
  readonly clientId: string | null;
  readonly projectId: string | null;
  readonly fieldMapId: string | null;
  readonly designId: string | null;
  readonly payloadId: string;
  readonly kind: WorkspaceDocumentKind;
  readonly projectCrs: string | null;
}

export interface WorkspacePresentation {
  readonly mode: WorkspaceMode;
  readonly document: WorkspaceDocumentIdentity | null;
  readonly documentGeneration: number;
  readonly interactionGeneration: number;
  readonly cameraGeneration: number;
}

export type WorkspaceOperationOwner =
  | { readonly scope: "document"; readonly identity: string; readonly documentGeneration: number }
  | { readonly scope: "interaction"; readonly identity: string; readonly documentGeneration: number;
      readonly mode: WorkspaceMode; readonly interactionGeneration: number };

export const WORKSPACE_MODES: readonly WorkspaceMode[] = Object.freeze(["design", "survey", "layout"]);

function nextGeneration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) {
    throw new Error("Workspace ownership generation is invalid or exhausted.");
  }
  return value + 1;
}

export function workspaceDocumentIdentityKey(document: WorkspaceDocumentIdentity | null): string {
  return JSON.stringify(document ? [document.clientId, document.projectId, document.fieldMapId,
    document.designId, document.payloadId, document.kind, document.projectCrs] : null);
}
const identityKey = workspaceDocumentIdentityKey;

/** Retire held gestures and automatic opening requests after an explicit target
 * replacement even when the editable design and visible mode remain the same. */
export function retireWorkspaceInteractions(state: WorkspacePresentation): WorkspacePresentation {
  return Object.freeze({ ...state, interactionGeneration: nextGeneration(state.interactionGeneration) });
}

function snapshotIdentity(document: WorkspaceDocumentIdentity | null): WorkspaceDocumentIdentity | null {
  if (!document) return null;
  const catalogKeys = ["clientId", "projectId", "fieldMapId", "designId"] as const;
  const independent = catalogKeys.every(key => document[key] === null);
  if (!independent) for (const key of catalogKeys) {
    if (typeof document[key] !== "string" || !document[key]?.trim()) throw new Error(`Workspace ${key} is required for a catalog association.`);
  }
  if (typeof document.payloadId !== "string" || !document.payloadId.trim()) throw new Error("Workspace payloadId is required.");
  if (!["project", "draft", "field"].includes(document.kind)) throw new Error("Unsupported workspace document kind.");
  if (document.projectCrs !== null && (typeof document.projectCrs !== "string" || !document.projectCrs.trim())) {
    throw new Error("Workspace CRS must be a declared value or unknown.");
  }
  return Object.freeze({ ...document });
}

export function createWorkspacePresentation(document: WorkspaceDocumentIdentity | null,
  mode: WorkspaceMode = "design"): WorkspacePresentation {
  if (!WORKSPACE_MODES.includes(mode)) throw new Error("Unsupported workspace mode.");
  return Object.freeze({ mode, document: snapshotIdentity(document), documentGeneration: 0, interactionGeneration: 0, cameraGeneration: 0 });
}

export function selectWorkspaceMode(state: WorkspacePresentation, mode: WorkspaceMode): WorkspacePresentation {
  if (!WORKSPACE_MODES.includes(mode)) throw new Error("Unsupported workspace mode.");
  if (state.mode === mode) return state;
  return Object.freeze({ ...state, mode, interactionGeneration: nextGeneration(state.interactionGeneration) });
}

/** Called only after the controller has checked its actual current dirty/busy guard.
 * This repeats the supplied guard fail-closed; it cannot prove that a caller sampled
 * the right controller, which remains the integration owner's responsibility. */
export function replaceWorkspaceDocument(state: WorkspacePresentation, document: WorkspaceDocumentIdentity | null,
  guard: { readonly dirty: boolean; readonly busy: boolean } | null): WorkspacePresentation {
  const next = snapshotIdentity(document);
  if (identityKey(state.document) === identityKey(next)) return state;
  if (!guard || guard.dirty !== false || guard.busy !== false) throw new Error("Finish or preserve the current workspace before opening another document.");
  const differentMapContext = cameraContextIdentity(state.document) !== cameraContextIdentity(next);
  return Object.freeze({ ...state, document: next, documentGeneration: nextGeneration(state.documentGeneration),
    interactionGeneration: nextGeneration(state.interactionGeneration),
    cameraGeneration: differentMapContext ? nextGeneration(state.cameraGeneration) : state.cameraGeneration });
}

/** A real same-ID reload replaces contents, unlike selecting the retained document.
 * Retire content callbacks while retaining the current field's camera identity. */
export function renewWorkspaceDocumentGeneration(state: WorkspacePresentation,
  guard: { readonly dirty: boolean; readonly busy: boolean } | null): WorkspacePresentation {
  if (!state.document) throw new Error("Open a document before reloading its contents.");
  if (!guard || guard.dirty !== false || guard.busy !== false) throw new Error("Finish or preserve the current workspace before reloading its contents.");
  return Object.freeze({ ...state, documentGeneration: nextGeneration(state.documentGeneration),
    interactionGeneration: nextGeneration(state.interactionGeneration) });
}

export function workspaceCameraIdentity(state: WorkspacePresentation): string {
  return JSON.stringify([cameraContextIdentity(state.document), state.cameraGeneration]);
}

function cameraContextIdentity(document: WorkspaceDocumentIdentity | null): string {
  return JSON.stringify(!document ? null : document.fieldMapId !== null
    ? ["field", document.fieldMapId, document.projectCrs]
    : ["independent", document.kind, document.payloadId, document.projectCrs]);
}

export function captureWorkspaceOperationOwner(state: WorkspacePresentation,
  scope: "document" | "interaction"): WorkspaceOperationOwner {
  const base = { identity: identityKey(state.document), documentGeneration: state.documentGeneration };
  return scope === "document" ? Object.freeze({ ...base, scope })
    : Object.freeze({ ...base, scope, mode: state.mode, interactionGeneration: state.interactionGeneration });
}

export function isWorkspaceOperationCurrent(state: WorkspacePresentation, owner: WorkspaceOperationOwner): boolean {
  return owner.identity === identityKey(state.document) && owner.documentGeneration === state.documentGeneration
    && (owner.scope === "document" || (owner.mode === state.mode && owner.interactionGeneration === state.interactionGeneration));
}

/** The old persisted value "layout" meant Inspect map, never an RTK session.
 * Only an explicit workspace-mode resume value may select the new Layout mode. */
export function initialWorkspaceMode(explicitResumeMode: unknown, _legacyEditInspectValue?: unknown): WorkspaceMode {
  return WORKSPACE_MODES.includes(explicitResumeMode as WorkspaceMode) ? explicitResumeMode as WorkspaceMode : "design";
}
