import { formatDistanceInputValue, parseDistanceInput, qualifyProjectCrs,
  type CrsQualificationOptions, type FieldDesign, type FieldPivotMachine } from "@cplayout/core";

export interface FieldCoordinateContext { projectCrs: string; crsOptions?: CrsQualificationOptions }
/** A label such as LOCAL never establishes coordinate units. */
export function fieldCoordinatesInFeet(context?: FieldCoordinateContext): boolean {
  return !!context && qualifyProjectCrs(context.projectCrs, context.crsOptions).unit === "metre";
}
const feet = (value: number | undefined) => value === undefined ? "" : formatDistanceInputValue(value, "us_survey_feet");

export interface FieldMachineInputs {
  name: string; x: string; y: string; spans: string[]; overhang: string; endGun: string;
  towerClearance: string; machineClearance: string;
  sweep: "full_circle" | "partial_circle"; start: string; stop: string;
  direction: "clockwise" | "counterclockwise";
  water: string; power: string; guidance: string;
}
export function fieldMachineInputs(machine?: FieldPivotMachine, context?: FieldCoordinateContext): FieldMachineInputs {
  const config = machine?.configuration;
  const sweep = config?.sweep;
  return { name: config?.name ?? "", x: fieldCoordinatesInFeet(context) ? feet(machine?.pivotCenter.x) : "", y: fieldCoordinatesInFeet(context) ? feet(machine?.pivotCenter.y) : "",
    spans: config?.spanLengthsMeters.map(feet) ?? [""], overhang: feet(config?.overhangMeters),
    endGun: feet(config?.endGunThrowMeters), towerClearance: feet(config?.towerClearanceBufferMeters),
    machineClearance: feet(config?.machineClearanceBufferMeters), sweep: sweep?.mode ?? "full_circle",
    start: sweep?.mode === "partial_circle" ? String(sweep.startAngleDegrees) : "",
    stop: sweep?.mode === "partial_circle" ? String(sweep.stopAngleDegrees) : "",
    direction: sweep?.mode === "partial_circle" ? sweep.direction : "clockwise",
    water: machine?.waterSourceId ?? "", power: machine?.powerSourceId ?? "", guidance: machine?.cornerGuidanceFeatureId ?? "" };
}
export function parseFieldMachineInputs(values: FieldMachineInputs, id: string, existing?: FieldPivotMachine, context?: FieldCoordinateContext): FieldPivotMachine {
  const number = (text: string, label: string): number => {
    if (!text.trim() || !Number.isFinite(Number(text))) throw new Error(`${label} requires a finite number.`);
    return Number(text);
  };
  const initial = fieldMachineInputs(existing, context);
  const distance = (value: string, original: number | undefined, label: string) =>
    original !== undefined && value === feet(original) ? original : parseDistanceInput(value, "us_survey_feet", label);
  const coordinate = (key: "x" | "y") => {
    if (existing && values[key] === initial[key]) return existing.pivotCenter[key];
    if (!fieldCoordinatesInFeet(context)) throw new Error("Confirm the location units before entering a new machine location.");
    return parseDistanceInput(values[key], "us_survey_feet", `Center ${key.toUpperCase()}`);
  };
  if (values.spans.length === 0) throw new Error("Enter at least one span length.");
  if (!values.name.trim()) throw new Error("Enter a machine name.");
  const machine: FieldPivotMachine = {
    ...existing, id, kind: "center_pivot", pivotCenter: { x: coordinate("x"), y: coordinate("y") },
    configuration: { ...existing?.configuration, name: values.name,
      spanLengthsMeters: values.spans.map((value, index) => distance(value.trim(), existing?.configuration.spanLengthsMeters[index], "Every span length")),
      overhangMeters: distance(values.overhang, existing?.configuration.overhangMeters, "Overhang"), endGunThrowMeters: distance(values.endGun, existing?.configuration.endGunThrowMeters, "End gun"),
      towerClearanceBufferMeters: distance(values.towerClearance, existing?.configuration.towerClearanceBufferMeters, "Tower clearance"), machineClearanceBufferMeters: distance(values.machineClearance, existing?.configuration.machineClearanceBufferMeters, "Machine clearance"),
      sweep: values.sweep === "full_circle" ? { mode: "full_circle" } : { mode: "partial_circle", startAngleDegrees: number(values.start, "Start angle"),
        stopAngleDegrees: number(values.stop, "Stop angle"), direction: values.direction } },
  };
  for (const [key, value] of [["waterSourceId", values.water], ["powerSourceId", values.power], ["cornerGuidanceFeatureId", values.guidance]] as const) {
    if (value) machine[key] = value;
    else delete machine[key];
  }
  return machine;
}
/** Machine-only plan adoption must never quietly replace boundary, shared evidence, or infrastructure. */
export function assertSameFieldPlanContext(current: FieldDesign, imported: FieldDesign): void {
  const { machines: _currentMachines, ...currentContext } = current;
  const { machines: _importedMachines, ...importedContext } = imported;
  if (contextKey(currentContext) !== contextKey(importedContext)) {
    throw new Error("This archive has different field information. Open it as a separate design; only machine plans for this same field can be adopted here.");
  }
}

function contextKey(value: object): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
  });
}
