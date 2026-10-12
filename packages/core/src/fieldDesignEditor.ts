import { seedRecordedReferenceOrigins, mergeRetainedReferenceOrigins, isRecordedReferenceMetadataRecord } from "./drawingMetadata";
import { validateFieldDesign, type FieldDesign, type FieldPivotMachine } from "./fieldDesignDocument";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { projectDataKey } from "./projectDataComparison";
import { applyClassifiedFieldDrawing, type ClassifiedFieldDrawingCommand } from "./classifiedFieldDrawing";
import type { StraightLateralMachine } from "./straightLateral";

export interface FieldDesignEditorState {
  field: FieldDesign;
  past: FieldDesign[];
  future: FieldDesign[];
  revision: number;
  lastError: string | null;
  selectedMachineId: string | null;
}

export type FieldDesignEditorAction =
  | ClassifiedFieldDrawingCommand
  | { type: "load_field"; field: FieldDesign }
  | { type: "select_machine"; id: string | null }
  | { type: "select_lateral"; id: string | null }
  | { type: "add_lateral"; machine: StraightLateralMachine }
  | { type: "update_lateral"; machine: StraightLateralMachine }
  | { type: "remove_lateral"; id: string }
  | { type: "rename"; name: string }
  | { type: "add_machine"; machine: FieldPivotMachine }
  | { type: "update_machine"; machine: FieldPivotMachine }
  | { type: "remove_machine"; id: string }
  | { type: "adopt_plan"; expectedRevision: number; machines: FieldPivotMachine[]; allowedReplacementMachineIds?: string[] }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "clear_error" };

const actionKeys: Record<FieldDesignEditorAction["type"], readonly string[]> = {
  commit_manual_geometry: ["type", "fieldId", "projectCrs", "expectedRevision", "captureId", "geometryType", "vertices", "classification", "target"],
  select_lateral: ["type", "id"], add_lateral: ["type", "machine"], update_lateral: ["type", "machine"], remove_lateral: ["type", "id"],
  load_field: ["type", "field"],
  select_machine: ["type", "id"],
  rename: ["type", "name"],
  add_machine: ["type", "machine"],
  update_machine: ["type", "machine"],
  remove_machine: ["type", "id"],
  adopt_plan: ["type", "expectedRevision", "machines"],
  undo: ["type"],
  redo: ["type"],
  clear_error: ["type"],
};

export function createFieldDesignEditorState(field: FieldDesign): FieldDesignEditorState {
  return {
    field: validateFieldDesign(seedRecordedReferenceOrigins(validateFieldDesign(field))), past: [], future: [],
    revision: 0, lastError: null, selectedMachineId: null,
  };
}

/** Explicit field edits only; selection is view state and carries no design authority. */
export function reduceFieldDesignEditorState(state: FieldDesignEditorState, inputAction: FieldDesignEditorAction): FieldDesignEditorState {
  try {
    const action = snapshotAction(inputAction);
    switch (action.type) {
      case "load_field": return createFieldDesignEditorState(action.field.id === state.field.id ? mergeRetainedReferenceOrigins(state.field, action.field) : action.field);
      case "clear_error": return { ...state, lastError: null };
      case "rename": return commit(state, { ...state.field, name: action.name });
      case "commit_manual_geometry": return commit(state, applyClassifiedFieldDrawing(state.field, action, state.revision), false);
      case "select_lateral":
        if (action.id !== null && !state.field.lateralMachines?.some(machine => machine.id === action.id)) throw new Error("Selected lateral was not found.");
        return { ...state, selectedMachineId: action.id, lastError: null };
      case "select_machine":
        if (action.id !== null && ![...state.field.machines, ...(state.field.lateralMachines ?? [])].some(machine => machine.id === action.id)) {
          throw new Error("Selected machine was not found.");
        }
        return { ...state, selectedMachineId: action.id, lastError: null };
      case "undo":
      case "redo": return travel(state, action.type);
      case "add_lateral":
        if ([...state.field.machines, ...(state.field.lateralMachines ?? [])].some(machine => machine.id === action.machine.id)) throw new Error("Machine identity already exists.");
        return commit(state, { ...state.field, lateralMachines: [...(state.field.lateralMachines ?? []), action.machine] });
      case "update_lateral":
        if (!state.field.lateralMachines?.some(machine => machine.id === action.machine.id)) throw new Error("Lateral was not found.");
        return commit(state, { ...state.field, lateralMachines: state.field.lateralMachines.map(machine => machine.id === action.machine.id ? action.machine : machine) });
      case "remove_lateral":
        if (!state.field.lateralMachines?.some(machine => machine.id === action.id)) throw new Error("Lateral was not found.");
        return commit(state, { ...state.field, lateralMachines: state.field.lateralMachines.filter(machine => machine.id !== action.id) });
      case "add_machine":
        if (state.field.machines.some(machine => machine.id === action.machine.id)) {
          throw new Error("Machine identity already exists.");
        }
        return commit(state, { ...state.field, machines: [...state.field.machines, action.machine] });
      case "update_machine":
        if (!state.field.machines.some(machine => machine.id === action.machine.id)) {
          throw new Error("Machine was not found.");
        }
        return commit(state, {
          ...state.field,
          machines: state.field.machines.map(machine => machine.id === action.machine.id ? action.machine : machine),
        });
      case "adopt_plan": {
        if (!Number.isSafeInteger(action.expectedRevision) || action.expectedRevision < 0 || action.expectedRevision !== state.revision) {
          throw new Error("Field revision changed; regenerate or review the plan before adoption.");
        }
        const allowed = action.allowedReplacementMachineIds === undefined ? [] : action.allowedReplacementMachineIds;
        if (!Array.isArray(allowed) || new Set(allowed).size !== allowed.length
          || allowed.some(id => typeof id !== "string" || !state.field.machines.some(machine => machine.id === id))) {
          throw new Error("Replacement permission must name distinct existing machine identities.");
        }
        const candidate = validateMachineEdit(state.field, { ...state.field, machines: action.machines });
        for (const existing of state.field.machines) {
          if (allowed.includes(existing.id)) continue;
          const retained = candidate.machines.find(machine => machine.id === existing.id);
          if (!retained || projectDataKey(retained) !== projectDataKey(existing)) {
            throw new Error(`Existing machine ${existing.id} is pinned; explicit replacement permission is required.`);
          }
        }
        return commit(state, candidate);
      }
      case "remove_machine":
        if (!state.field.machines.some(machine => machine.id === action.id)) {
          throw new Error("Machine was not found.");
        }
        return commit(state, { ...state.field, machines: state.field.machines.filter(machine => machine.id !== action.id) });
      default: {
        const unsupported: never = action;
        throw new Error(`Unsupported field editor action: ${String(unsupported)}`);
      }
    }
  } catch (error) {
    return { ...state, lastError: error instanceof Error ? error.message : "Field edit was rejected." };
  }
}

function commit(state: FieldDesignEditorState, candidate: FieldDesign, reconcileMachineEdit = true): FieldDesignEditorState {
  const retained = mergeRetainedReferenceOrigins(state.field, candidate);
  const field = validateFieldDesign(seedRecordedReferenceOrigins(reconcileMachineEdit ? validateMachineEdit(state.field, retained) : retained));
  if (projectDataKey(field) === projectDataKey(state.field)) {
    return state.lastError ? { ...state, lastError: null } : state;
  }
  return {
    field, past: [...state.past, mergeRetainedReferenceOrigins(field, state.field)], future: [],
    revision: nextRevision(state.revision), lastError: null,
    selectedMachineId: retainedSelection(field, state.selectedMachineId),
  };
}

/** Machine edits reconcile only their own digitized point records; history retains the original capture. */
function validateMachineEdit(previous: FieldDesign, candidate: FieldDesign): FieldDesign {
  if (!candidate.drawingMetadata) return validateFieldDesign(candidate);
  const before = new Map(previous.machines.map(machine => [machine.id, machine]));
  const after = new Map(candidate.machines.map(machine => [machine.id, machine]));
  const records = candidate.drawingMetadata.records.flatMap(record => {
    if (isRecordedReferenceMetadataRecord(record) || record.target.kind !== "pivot_center") return [record];
    const oldMachine = before.get(record.target.machineId);
    const newMachine = after.get(record.target.machineId);
    // An already-invalid reference is not permission to discard unrelated metadata.
    if (!oldMachine) return [record];
    if (!newMachine) return [];
    if (oldMachine.pivotCenter.x === newMachine.pivotCenter.x && oldMachine.pivotCenter.y === newMachine.pivotCenter.y) return [record];
    return [{ ...record, capture: { ...record.capture, vertexRecordedAt: [null] } }];
  });
  return validateFieldDesign({ ...candidate, drawingMetadata: { ...candidate.drawingMetadata, records } });
}

function travel(state: FieldDesignEditorState, direction: "undo" | "redo"): FieldDesignEditorState {
  const candidate = direction === "undo" ? state.past.at(-1) : state.future[0];
  if (!candidate) return state;
  const field = validateFieldDesign(mergeRetainedReferenceOrigins(state.field, candidate));
  return {
    field, lastError: null, revision: nextRevision(state.revision),
    selectedMachineId: retainedSelection(field, state.selectedMachineId),
    past: direction === "undo" ? state.past.slice(0, -1) : [...state.past, state.field],
    future: direction === "undo" ? [state.field, ...state.future] : state.future.slice(1),
  };
}

function retainedSelection(field: FieldDesign, id: string | null): string | null {
  return [...field.machines, ...(field.lateralMachines ?? [])].some(machine => machine.id === id) ? id : null;
}

function snapshotAction(input: FieldDesignEditorAction): FieldDesignEditorAction {
  const action = snapshotJsonValue(input, "action") as FieldDesignEditorAction;
  if (!action || typeof action.type !== "string" || !Object.hasOwn(actionKeys, action.type)) {
    throw new Error("Unsupported field editor action.");
  }
  const keys = actionKeys[action.type];
  const optionalKeys = action.type === "adopt_plan" ? ["allowedReplacementMachineIds"] : action.type === "commit_manual_geometry" ? ["replaceExisting"] : [];
  if (Object.keys(action).some(key => !keys.includes(key) && !optionalKeys.includes(key)) || keys.some(key => !Object.hasOwn(action, key))
    || (action.type === "adopt_plan" && Object.hasOwn(action, "allowedReplacementMachineIds") && action.allowedReplacementMachineIds === undefined)) {
    throw new Error("Field editor action contains missing or unsupported properties.");
  }
  return action;
}

function nextRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER) {
    throw new Error("Field editor revision is exhausted or invalid; reopen explicitly before editing.");
  }
  return revision + 1;
}
