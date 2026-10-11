import { parseLayoutSessionDocument, parseFieldLayoutTarget, type LayoutSession } from "@cplayout/core";
import type { WorkspaceDocumentIdentity } from "./workspacePresentation";

/** Map ownership is independent from editable-document ownership. A target-only
 * session has a real field/CRS, without acquiring a fabricated design or customer. */
export type WorkspaceMapContext =
  | { readonly kind: "field"; readonly fieldMapId: string; readonly projectCrs: string | null }
  | { readonly kind: "independent"; readonly payloadId: string; readonly documentKind: WorkspaceDocumentIdentity["kind"]; readonly projectCrs: string | null }
  | { readonly kind: "target_preview"; readonly targetHash: string; readonly projectCrs: string };

export function mapContextForWorkspaceDocument(document: WorkspaceDocumentIdentity | null): WorkspaceMapContext | null {
  if (!document) return null;
  return document.fieldMapId === null
    ? Object.freeze({ kind: "independent", payloadId: document.payloadId, documentKind: document.kind, projectCrs: document.projectCrs })
    : Object.freeze({ kind: "field", fieldMapId: document.fieldMapId, projectCrs: document.projectCrs });
}

export function mapContextForLayoutSession(input: LayoutSession): WorkspaceMapContext {
  const session = parseLayoutSessionDocument(input);
  const target = parseFieldLayoutTarget(session.targetDocument);
  return Object.freeze({ kind: "field", fieldMapId: session.fieldMapId, projectCrs: target.field.projectCrs });
}

export function workspaceMapContextKey(context: WorkspaceMapContext | null, generation = 0): string {
  if (!Number.isSafeInteger(generation) || generation < 0) throw new Error("Map ownership generation must be a nonnegative safe integer.");
  if (!context) return JSON.stringify([null, generation]);
  const identity = context.kind === "field" ? [context.kind, context.fieldMapId, context.projectCrs]
    : context.kind === "independent" ? [context.kind, context.documentKind, context.payloadId, context.projectCrs]
      : [context.kind, context.targetHash, context.projectCrs];
  if (identity.slice(1).some(value => value !== null && (typeof value !== "string" || !value.trim()))) throw new Error("Map context requires its actual source identities.");
  return JSON.stringify([identity, generation]);
}

export function sameWorkspaceMapContext(a: WorkspaceMapContext | null, b: WorkspaceMapContext | null): boolean {
  return workspaceMapContextKey(a) === workspaceMapContextKey(b);
}
