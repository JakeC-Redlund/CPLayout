import type { DesignDraftMachine, XY } from "@cplayout/core";

export const MACHINE_LENGTH_FIELDS = [
  ["overhangMeters", "Overhang (m)"],
  ["endGunThrowMeters", "End gun throw (m)"],
  ["towerClearanceBufferMeters", "Tower clearance buffer (m)"],
  ["machineClearanceBufferMeters", "Machine clearance buffer (m)"],
] as const;

type LengthField = typeof MACHINE_LENGTH_FIELDS[number][0];
export type MachineInputValues = Record<LengthField | "id" | "name" | "startAngleDegrees" | "stopAngleDegrees", string> & {
  spans: string[] | undefined;
  mode: "" | "full_circle" | "partial_circle";
  direction: "" | "clockwise" | "counterclockwise";
};

export function parseDraftNumber(text: string, label: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed) || !Number.isFinite(Number(trimmed))) {
    throw new Error(`${label}: enter a finite decimal number.`);
  }
  return Number(trimmed);
}

export function parseDraftPoint(xText: string, yText: string): XY | null {
  const x = parseDraftNumber(xText, "X");
  const y = parseDraftNumber(yText, "Y");
  if (x === undefined && y === undefined) return null;
  if (x === undefined || y === undefined) throw new Error("Supply both X and Y, or leave both blank.");
  return { x, y };
}

export function parseDraftBoundary(text: string): XY[] {
  if (!text.trim()) return [];
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    const columns = line.split(",");
    if (columns.length !== 2) throw new Error(`Boundary row ${index + 1}: supply two coordinates as X,Y.`);
    try {
      const point = parseDraftPoint(columns[0], columns[1]);
      if (point === null) throw new Error("Supply both X and Y.");
      return [point];
    } catch (error) {
      throw new Error(`Boundary row ${index + 1}: ${error instanceof Error ? error.message : "Invalid coordinates."}`);
    }
  });
}

export function machineInputValues(machine: DesignDraftMachine): MachineInputValues {
  const sector = machine.sweep?.mode === "partial_circle" ? machine.sweep : undefined;
  return {
    id: machine.id ?? "", name: machine.name ?? "",
    overhangMeters: machine.overhangMeters?.toString() ?? "",
    endGunThrowMeters: machine.endGunThrowMeters?.toString() ?? "",
    towerClearanceBufferMeters: machine.towerClearanceBufferMeters?.toString() ?? "",
    machineClearanceBufferMeters: machine.machineClearanceBufferMeters?.toString() ?? "",
    spans: machine.spanLengthsMeters?.map((span) => span?.toString() ?? ""),
    mode: machine.sweep?.mode ?? "", direction: sector?.direction ?? "",
    startAngleDegrees: sector?.startAngleDegrees?.toString() ?? "",
    stopAngleDegrees: sector?.stopAngleDegrees?.toString() ?? "",
  };
}

export function parseDraftMachine(values: MachineInputValues, original: DesignDraftMachine): DesignDraftMachine {
  // Preserve optional machine data owned by other editors; blanks remove only fields shown here.
  const machine = { ...original };
  for (const key of ["id", "name"] as const) {
    if (values[key].trim()) machine[key] = values[key];
    else delete machine[key];
  }
  for (const [key, label] of MACHINE_LENGTH_FIELDS) {
    const value = parseDraftNumber(values[key], label);
    if (value === undefined) delete machine[key];
    else machine[key] = value;
  }
  if (values.spans === undefined) delete machine.spanLengthsMeters;
  else machine.spanLengthsMeters = values.spans.map((value, index) => parseDraftNumber(value, `Span ${index + 1} (m)`) ?? null);
  if (values.mode === "") delete machine.sweep;
  else if (values.mode === "full_circle") machine.sweep = { mode: "full_circle" };
  else {
    const start = parseDraftNumber(values.startAngleDegrees, "Start angle (degrees)");
    const stop = parseDraftNumber(values.stopAngleDegrees, "Stop angle (degrees)");
    machine.sweep = {
      mode: "partial_circle",
      ...(start === undefined ? {} : { startAngleDegrees: start }),
      ...(stop === undefined ? {} : { stopAngleDegrees: stop }),
      ...(values.direction === "" ? {} : { direction: values.direction }),
    };
  }
  return machine;
}
