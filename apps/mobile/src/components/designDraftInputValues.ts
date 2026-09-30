import { formatDistanceInputValue, parseDistanceInput, type DesignDraftMachine, type XY } from "@cplayout/core";

const feet = (value: number | null | undefined) => value == null ? "" : formatDistanceInputValue(value, "us_survey_feet");
function distance(text: string, original: number | null | undefined, label: string): number | undefined {
  if (!text.trim()) return undefined;
  if (original != null && text === feet(original)) return original;
  return parseDistanceInput(text, "us_survey_feet", label);
}

export const MACHINE_LENGTH_FIELDS = [
  ["overhangMeters", "Overhang (ft)"],
  ["endGunThrowMeters", "End gun throw (ft)"],
  ["towerClearanceBufferMeters", "Tower clearance buffer (ft)"],
  ["machineClearanceBufferMeters", "Machine clearance buffer (ft)"],
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
    overhangMeters: feet(machine.overhangMeters),
    endGunThrowMeters: feet(machine.endGunThrowMeters),
    towerClearanceBufferMeters: feet(machine.towerClearanceBufferMeters),
    machineClearanceBufferMeters: feet(machine.machineClearanceBufferMeters),
    spans: machine.spanLengthsMeters?.map(feet),
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
    const value = distance(values[key], original[key], label);
    if (value === undefined) delete machine[key];
    else machine[key] = value;
  }
  if (values.spans === undefined) delete machine.spanLengthsMeters;
  else machine.spanLengthsMeters = values.spans.map((value, index) => distance(value, original.spanLengthsMeters?.[index], `Span ${index + 1} (ft)`) ?? null);
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
