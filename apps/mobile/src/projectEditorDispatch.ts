import { reduceProjectEditorState, type ProjectEditorAction, type ProjectEditorState, type ProjectMutationResult } from "@cplayout/core";

export function dispatchProjectEditorAction(
  editor: { current: ProjectEditorState },
  action: ProjectEditorAction,
  publish: (state: ProjectEditorState) => void,
): ProjectMutationResult {
  // Advance the same authoritative state used by the next action, before React renders.
  const next = reduceProjectEditorState(editor.current, action);
  editor.current = next;
  publish(next);
  return next.lastError ? { ok: false, error: next.lastError } : { ok: true, revision: next.revision };
}
