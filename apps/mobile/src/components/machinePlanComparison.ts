import type { FieldPivotMachine, XY } from "@cplayout/core";

export interface MachineValueChange {
  path: string;
  before: unknown;
  after: unknown;
}
export interface MachinePlanChange {
  id: string;
  name: string;
  status: "added" | "removed" | "moved" | "updated" | "unchanged";
  current?: FieldPivotMachine;
  proposed?: FieldPivotMachine;
  moved: boolean;
  values: MachineValueChange[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Compare exact stored values; rounding is confined to the view. Object key order has no meaning. */
function changes(before: unknown, after: unknown, path: string, output: MachineValueChange[]): void {
  if (Object.is(before, after)) return;
  if (Array.isArray(before) || Array.isArray(after)) {
    // A container with another present type is a shape change, not an empty list.
    if ((!Array.isArray(before) && before !== undefined) || (!Array.isArray(after) && after !== undefined)) {
      output.push({ path, before, after }); return;
    }
    const left = Array.isArray(before) ? before : [];
    const right = Array.isArray(after) ? after : [];
    if (!left.length && !right.length && (before === undefined || after === undefined)) output.push({ path, before, after });
    for (let index = 0; index < Math.max(left.length, right.length); index++) changes(left[index], right[index], `${path}.${index}`, output);
  } else if (record(before) || record(after)) {
    if ((!record(before) && before !== undefined) || (!record(after) && after !== undefined)) {
      output.push({ path, before, after }); return;
    }
    const left = record(before) ? before : {};
    const right = record(after) ? after : {};
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    if (!keys.length && (before === undefined || after === undefined)) output.push({ path, before, after });
    for (const key of keys) changes(left[key], right[key], path ? `${path}.${key}` : key, output);
  } else output.push({ path, before, after });
}

/** Read-only review of a full pivot list. No solver, reducer, or persistence decisions live here. */
export function compareMachinePlan(current: readonly FieldPivotMachine[], proposed: readonly FieldPivotMachine[]): MachinePlanChange[] {
  const saved = new Map(current.map(machine => [machine.id, machine]));
  const next = new Map(proposed.map(machine => [machine.id, machine]));
  return [...new Set([...proposed.map(machine => machine.id), ...current.map(machine => machine.id)])].map(id => {
    const before = saved.get(id); const after = next.get(id);
    const values: MachineValueChange[] = [];
    changes(before?.configuration, after?.configuration, "configuration", values);
    for (const key of ["kind", "pivotObservationId", "waterSourceId", "powerSourceId", "cornerGuidanceFeatureId", "sourceFeatureIds"] as const) {
      changes(before?.[key], after?.[key], key, values);
    }
    const moved = !!before && !!after && (before.pivotCenter.x !== after.pivotCenter.x || before.pivotCenter.y !== after.pivotCenter.y);
    return { id, name: after?.configuration.name ?? before!.configuration.name,
      status: !before ? "added" : !after ? "removed" : moved ? "moved" : values.length ? "updated" : "unchanged",
      current: before, proposed: after, moved, values };
  });
}

/** One shared extent makes location differences visible without changing the stored XY coordinates. */
export function machinePlanPreviewFrame(boundary: readonly XY[], current: readonly FieldPivotMachine[], proposed: readonly FieldPivotMachine[]) {
  const points = [...boundary, ...current.map(machine => machine.pivotCenter), ...proposed.map(machine => machine.pivotCenter)];
  if (!points.length) return null;
  const minX = Math.min(...points.map(point => point.x)); const maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y)); const maxY = Math.max(...points.map(point => point.y));
  const scale = Math.min(196 / Math.max(maxX - minX, 1), 100 / Math.max(maxY - minY, 1));
  return (point: XY): XY => ({ x: 110 + (point.x - (minX + maxX) / 2) * scale, y: 62 - (point.y - (minY + maxY) / 2) * scale });
}
