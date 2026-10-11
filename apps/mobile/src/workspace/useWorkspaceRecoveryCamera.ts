import { useCallback, useEffect, useRef } from "react";
import type { WorkspaceCameraRecoveryHandle, WorkspaceCameraRecoveryEntry } from "@cplayout/map-adapters";
import type { useWorkspaceController } from "./useWorkspaceController";
import { workspaceMapContextKey, type WorkspaceMapContext } from "./workspaceMapContext";
import { useWorkspaceRecoveryParticipant } from "./workspaceRecoveryParticipants";
import type { WorkspaceRecoveryCamera } from "./workspaceEditRecovery";

/** Decode the actual Frame's nested key, without accepting an arbitrary key as
 * field authority. The fresh catalog/source filter below supplies that check. */
export function workspaceRecoveryCameraContext(key: string): WorkspaceMapContext {
  const outer = JSON.parse(key), inner = Array.isArray(outer) && typeof outer[0] === "string" ? JSON.parse(outer[0]) : null;
  if (!Array.isArray(outer) || outer.length !== 2 || !Array.isArray(inner) || inner.length !== 2 || inner[1] !== 0 || !Array.isArray(inner[0]))
    throw new Error("Unknown workspace camera cache key.");
  const identity = inner[0]; let context: WorkspaceMapContext;
  if (identity[0] === "field" && identity.length === 3) context = { kind: "field", fieldMapId: identity[1], projectCrs: identity[2] };
  else if (identity[0] === "independent" && identity.length === 4 && ["project", "draft", "field"].includes(identity[1]))
    context = { kind: "independent", documentKind: identity[1], payloadId: identity[2], projectCrs: identity[3] };
  else if (identity[0] === "target_preview" && identity.length === 3) context = { kind: "target_preview", targetHash: identity[1], projectCrs: identity[2] };
  else throw new Error("Unsupported workspace camera identity.");
  if (JSON.stringify([workspaceMapContextKey(context), context.projectCrs]) !== key) throw new Error("Camera CRS or identity encoding differs from its source frame.");
  return context;
}
export function useWorkspaceRecoveryCamera(controller: ReturnType<typeof useWorkspaceController>) {
  const current = useRef(controller); current.current = controller;
  const handle = useRef<WorkspaceCameraRecoveryHandle | null>(null);
  const parked = useRef<readonly WorkspaceCameraRecoveryEntry[] | null>(null);
  const waiting = useRef<{ apply(next: WorkspaceCameraRecoveryHandle): void; reject(error: Error): void } | null>(null);
  const onHandle = useCallback((next: WorkspaceCameraRecoveryHandle | null) => {
    if (!next && handle.current && parked.current === null) parked.current = handle.current.snapshot();
    handle.current = next;
    if (next && waiting.current) { const delivery = waiting.current; waiting.current = null; delivery.apply(next); }
    else if (next && parked.current !== null) {
      try { next.stage(parked.current).apply(); parked.current = null; }
      catch (error) { current.current.reportError(error); } // Exact parked views remain exportable; the actual map can still be fitted explicitly.
    }
    current.current.recoveryParticipants.refresh();
  }, []);
  useEffect(() => () => { waiting.current?.reject(new Error("The sole map unmounted during recovery.")); waiting.current = null; }, []);
  useWorkspaceRecoveryParticipant(controller.recoveryParticipants, "camera", {
    capture() {
      const snapshot = parked.current ?? handle.current?.snapshot() ?? [], root = current.current, catalog = root.repository.catalog;
      const cameras: WorkspaceRecoveryCamera[] = [];
      for (const entry of snapshot) {
        const context = workspaceRecoveryCameraContext(entry.contextKey);
        if (context.kind === "field") {
          const field = catalog.fieldMaps.find(item => item.id === context.fieldMapId), project = catalog.projects.find(item => item.id === field?.projectId);
          if (!field || !project || context.projectCrs !== project.projectCrs && workspaceMapContextKey(context) !== root.cameraContextKey) continue;
        } else if (workspaceMapContextKey(context) !== root.cameraContextKey) continue;
        cameras.push({ context, viewport: entry.viewport, initialized: entry.initialized });
      }
      return cameras;
    },
    stage(snapshot, target) {
      const owned = handle.current, entries = snapshot.map(camera => ({ contextKey: JSON.stringify([workspaceMapContextKey(camera.context), camera.context.projectCrs]),
        viewport: camera.viewport, initialized: camera.initialized }));
      const plan = owned?.stage(entries), parkedOwner = parked.current;
      return { isCurrent: () => handle.current === owned && parked.current === parkedOwner && (!plan || plan.isCurrent()),
        async consume(delivery) {
          if (!delivery.isCurrent() || delivery.target !== target) throw new Error("The recovered camera delivery retired.");
          if (!target.admission.editable && !target.admission.layout) { parked.current = entries; return; }
          if (owned && handle.current === owned && plan) { plan.apply(); parked.current = null; return; }
          if (handle.current) { handle.current.stage(entries).apply(); parked.current = null; return; }
          await new Promise<void>((resolve, reject) => {
            waiting.current = { reject, apply(next) {
              try { if (!delivery.isCurrent()) throw new Error("The map arrived after its recovery delivery retired."); next.stage(entries).apply(); parked.current = null; resolve(); }
              catch (error) { reject(error); }
            } };
          });
        } };
    },
  });
  return { onRecoveryCameraHandle: onHandle,
    onCameraChange: () => {
      if (!current.current.recoveryParticipants.canEdit()) return;
      if (parked.current !== null && handle.current) {
        const updated = new Map(parked.current.map(entry => [entry.contextKey, entry]));
        handle.current.snapshot().forEach(entry => updated.set(entry.contextKey, entry));
        parked.current = [...updated.values()];
      }
      current.current.noteUserIntent(); current.current.recoveryParticipants.notifyChanged();
    } };
}
