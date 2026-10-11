import { useLayoutEffect, useRef } from "react";
import type { WorkspaceDocument } from "@cplayout/project-store";
import type { InputRetentionStore } from "../inputRetention";
import type { UnifiedWorkspaceResume } from "../navigation/unifiedWorkspaceResume";
import { emptyWorkspaceEditRecoveryUi, workspaceRecoveryStableJson,
  type WorkspaceEditRecoveryAdmission, type WorkspaceEditRecoveryUi, type WorkspaceRecoveryCamera } from "./workspaceEditRecovery";

export interface WorkspaceRecoveryParts {
  entry: { entry: Pick<WorkspaceEditRecoveryUi["entry"], "designTask" | "drawing" | "layerVisibility">; file: WorkspaceEditRecoveryUi["file"] };
  frame: Pick<WorkspaceEditRecoveryUi["entry"], "toolsOpen" | "receiverOpen" | "diagnosticOpen">;
  survey: WorkspaceEditRecoveryUi["survey"];
  layout: WorkspaceEditRecoveryUi["layout"];
  catalog: WorkspaceEditRecoveryUi["catalog"];
  receiver: WorkspaceEditRecoveryUi["receiver"];
  camera: readonly WorkspaceRecoveryCamera[];
}
export type WorkspaceRecoveryPartName = keyof WorkspaceRecoveryParts;
export interface WorkspaceRecoveryTarget {
  readonly admission: WorkspaceEditRecoveryAdmission;
  readonly workspace: WorkspaceDocument;
  readonly documentGeneration: number;
}
export interface WorkspaceRecoveryDelivery {
  readonly id: string;
  readonly target: WorkspaceRecoveryTarget;
  readonly isCurrent: () => boolean;
}
export interface WorkspaceRecoveryPartStage {
  isCurrent(): boolean;
  consume(delivery: WorkspaceRecoveryDelivery): void | Promise<void>;
}
export interface WorkspaceRecoveryParticipant<K extends WorkspaceRecoveryPartName> {
  capture(): WorkspaceRecoveryParts[K];
  stage(value: WorkspaceRecoveryParts[K], target: WorkspaceRecoveryTarget): WorkspaceRecoveryPartStage | Promise<WorkspaceRecoveryPartStage>;
}
const names: WorkspaceRecoveryPartName[] = ["entry", "frame", "survey", "layout", "catalog", "receiver", "camera"];

/** Runtime handles read existing value owners; the registry owns no form values. */
export function createWorkspaceRecoveryParticipants(inputs?: Pick<InputRetentionStore, "recordFocus" | "recordSelection" | "retainedFocus">) {
  const handles = new Map<WorkspaceRecoveryPartName, WorkspaceRecoveryParticipant<WorkspaceRecoveryPartName>>();
  const listeners = new Set<() => void>();
  let revision = 0, signature: string | null = null, inputOwner: object = Object.freeze({}), blocked = false;
  let contextCapture: (() => Pick<UnifiedWorkspaceResume, "catalogSelection" | "catalogVisible">) | null = null;
  const notify = () => { revision++; listeners.forEach(listener => listener()); };
  function capture() {
    for (const name of names) if (!handles.has(name)) throw new Error(`Recovery is waiting for the ${name} controls to finish mounting.`);
    const value = <K extends WorkspaceRecoveryPartName>(name: K) => (handles.get(name) as WorkspaceRecoveryParticipant<K>).capture();
    const entry = value("entry"), frame = value("frame");
    return { ui: { ...emptyWorkspaceEditRecoveryUi(), entry: { ...entry.entry, ...frame }, file: entry.file,
      survey: value("survey"), layout: value("layout"), catalog: value("catalog"), receiver: value("receiver") }, cameras: value("camera") };
  }
  const registry = {
    capture,
    isReady: () => contextCapture !== null && names.every(name => handles.has(name)),
    captureContext() {
      if (!contextCapture) throw new Error("Recovery is waiting for the workspace navigation owner.");
      return contextCapture();
    },
    registerContextCapture(capture: NonNullable<typeof contextCapture>) {
      contextCapture = capture; registry.refresh();
      return () => { if (contextCapture === capture) { contextCapture = null; registry.refresh(); } };
    },
    canEdit: () => !blocked,
    getFocus: () => inputs?.retainedFocus() ?? null,
    recordFocus(key: string, selection?: { start: number; end: number }) {
      if (blocked) return;
      inputs?.recordFocus(key); if (selection) inputs?.recordSelection(key, selection);
    },
    setBlocked(value: boolean) { blocked = value; },
    getRevision: () => revision,
    getInputOwner: () => inputOwner,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Accepted user events retire a review even when the text returns to old bytes. */
    notifyChanged() { if (blocked) return; inputOwner = Object.freeze({}); signature = null; notify(); },
    refresh() {
      let next: string;
      try { next = workspaceRecoveryStableJson({ ...capture(), context: contextCapture?.() ?? null }); } catch { next = "participants-not-ready"; }
      if (signature !== next) { signature = next; notify(); }
    },
    register<K extends WorkspaceRecoveryPartName>(name: K, participant: WorkspaceRecoveryParticipant<K>) {
      const handle = participant as WorkspaceRecoveryParticipant<WorkspaceRecoveryPartName>;
      handles.set(name, handle); registry.refresh();
      return () => { if (handles.get(name) === handle) { handles.delete(name); registry.refresh(); } };
    },
    async stage(target: WorkspaceRecoveryTarget) {
      const ui = target.admission.ui;
      const values: WorkspaceRecoveryParts = { entry: { entry: ui.entry, file: ui.file }, frame: ui.entry,
        survey: ui.survey, layout: ui.layout, catalog: ui.catalog, receiver: ui.receiver, camera: target.admission.staged.cameras };
      const owners = names.map(name => {
        const handle = handles.get(name);
        if (!handle) throw new Error(`The ${name} recovery controls are not ready.`);
        return { name, handle };
      });
      const plans = await Promise.all(owners.map(async owner => ({ ...owner, plan: await owner.handle.stage(values[owner.name], target) })));
      return {
        isCurrent: () => plans.every(({ name, handle, plan }) => handles.get(name) === handle && plan.isCurrent()),
        async consume(delivery: WorkspaceRecoveryDelivery) {
          if (!delivery.isCurrent()) throw new Error("This recovery delivery belongs to an earlier workspace.");
          // All plans validate before publication. Normal controls remain gated
          // until every owner, including newly mounted form children, acknowledges.
          // Drain every started owner before rollback can restage previous raw
          // values. Early Promise.all rejection raced pending Catalog children.
          const results = await Promise.allSettled(plans.map(async ({ plan }) => plan.consume(delivery)));
          if (!delivery.isCurrent()) throw new Error("The workspace changed during recovery delivery.");
          const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
          if (failed) throw failed.reason;
        },
      };
    },
  };
  return registry;
}
export type WorkspaceRecoveryParticipants = ReturnType<typeof createWorkspaceRecoveryParticipants>;

/** Stable registration reads fresh render refs; source-reset effects run first. */
export function useWorkspaceRecoveryParticipant<K extends WorkspaceRecoveryPartName>(registry: WorkspaceRecoveryParticipants | undefined,
  name: K, participant: WorkspaceRecoveryParticipant<K>) {
  const latest = useRef(participant); latest.current = participant;
  const handle = useRef<WorkspaceRecoveryParticipant<K> | null>(null);
  if (!handle.current) handle.current = { capture: () => latest.current.capture(), stage: (value, target) => latest.current.stage(value, target) };
  useLayoutEffect(() => registry?.register(name, handle.current!), [registry, name]);
  useLayoutEffect(() => { registry?.refresh(); });
}
