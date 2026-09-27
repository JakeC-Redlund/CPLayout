import React, { StrictMode, useEffect, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { sampleProject } from "../../packages/core/src";
import { useEditorSaveCoordinator } from "../../apps/mobile/src/hooks/useEditorSaveCoordinator";

let root: Root | null = null;
let setups = 0;
let cleanups = 0;
let release: (() => void) | null = null;
let completion: { feedbackCurrent: boolean; saved: boolean } | null = null;
let probe: ReturnType<typeof createProbe> | null = null;
let pendingSave: Promise<void> | null = null;
const identities = new WeakMap<object, number>();
let nextIdentity = 0;

function identity(value: object) {
  if (!identities.has(value)) identities.set(value, ++nextIdentity);
  return identities.get(value)!;
}

function createProbe(state: ReturnType<typeof useEditorSaveCoordinator>, rerender: () => void) {
  const { saveCoordinator, saveSessionRef, saveOwnerMountedRef } = state;
  return {
    read: () => ({
      active: saveCoordinator.isCurrent(saveSessionRef.current), mounted: saveOwnerMountedRef.current,
      generation: saveSessionRef.current.generation,
      revision: saveCoordinator.receipt(saveSessionRef.current).workspaceRevision,
      coordinatorIdentity: identity(saveCoordinator), sessionIdentity: identity(saveSessionRef.current),
    }),
    async save(delayed = false) {
      const session = saveSessionRef.current;
      let feedbackCurrent = false;
      const outcome = await saveCoordinator.save({
        session, payload: { kind: "project", project: sampleProject }, editorRevision: 0,
        feedbackIsCurrent: () => saveOwnerMountedRef.current,
        write: async (_payload, target, owner) => {
          if (delayed) await new Promise<void>(resolve => { release = resolve; });
          feedbackCurrent = owner.isCurrent();
          return { saved: true, persistenceRevision: target.workspaceRevision! + 1 };
        },
      });
      completion = { saved: outcome.saved, feedbackCurrent };
    },
    replace() {
      saveSessionRef.current = saveCoordinator.open({
        kind: "project", payloadId: sampleProject.id, designId: null, workspaceRevision: 10,
      });
      rerender();
    },
    rerender,
  };
}

function Probe() {
  const state = useEditorSaveCoordinator({
    kind: "project", payloadId: sampleProject.id, designId: null, workspaceRevision: 0,
  });
  const [renderCount, setRenderCount] = useState(0);
  useLayoutEffect(() => {
    probe = createProbe(state, () => setRenderCount(value => value + 1));
  });
  useEffect(() => {
    setups++;
    return () => { cleanups++; };
  }, []);
  return <output data-testid="render-count">{renderCount}</output>;
}

export function mount() {
  if (root) throw new Error("Unmount the existing probe first.");
  probe = null;
  const container = document.getElementById("root");
  if (!container) throw new Error("Missing fixture root");
  root = createRoot(container);
  root.render(<StrictMode><Probe /></StrictMode>);
}
export function unmount() { root?.unmount(); root = null; }
export function read() { return { probe: probe?.read() ?? null, setups, cleanups, pending: release !== null, completion }; }
export function save() { if (!probe) throw new Error("Probe not mounted"); return probe.save(); }
export function startDelayedSave() {
  if (!probe || pendingSave) throw new Error("Missing probe or save already pending");
  pendingSave = probe.save(true);
  // Retain a rejected promise for finish() without an interim unhandled rejection.
  void pendingSave.catch(() => undefined);
}
export function replace() { probe?.replace(); }
export function rerender() { probe?.rerender(); }
export async function finish() {
  if (!pendingSave || !release) throw new Error("No delayed save to finish");
  const pending = pendingSave;
  const resolve = release;
  release = null;
  resolve();
  try { await pending; } finally { pendingSave = null; }
}
