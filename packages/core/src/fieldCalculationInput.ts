import { z } from "zod";
import { qualifyProjectCrs, type CrsQualification, type CrsQualificationOptions } from "./crsQualification";
import { validateFieldDesign, type FieldDesign, type FieldInfrastructurePoint, type FieldPivotMachine } from "./fieldDesignDocument";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { evaluateProjectCalculationSafety, type ProjectCalculationBlocker } from "./projectCalculationSafety";
import type { PivotProject, ProjectMapFeature } from "./types";

export interface FieldCalculationKey {
  fieldId: string;
  machineId: string;
  inputRevision: number;
}

export interface FieldCalculationRequest {
  machineId: string;
  inputRevision: number;
  /** Compare against the current editor revision before using a prepared request. */
  expectedRevision?: number;
  crsOptions?: CrsQualificationOptions;
}

interface FieldCalculationContext {
  key: FieldCalculationKey;
  machine: FieldPivotMachine;
  crsOptions: CrsQualificationOptions;
  crsQualification: CrsQualification;
  waterSource?: FieldInfrastructurePoint;
  powerSource?: FieldInfrastructurePoint;
  /** Explicit line association only; never acreage, a radial envelope or certified wheel track. */
  guidanceFeature?: ProjectMapFeature;
  /** Evidence association only; these features are never broadcast into legacy geometry consumers. */
  sourceFeatures: ProjectMapFeature[];
}

export type FieldCalculationInput = FieldCalculationContext & (
  | { status: "ready"; project: PivotProject; blockers: [] }
  | { status: "unsupported"; blockers: ProjectCalculationBlocker[] }
);

export const FieldCalculationCrsOptionsSchema = z.object({
  localMetricDeclaration: z.object({
    projectCrs: z.string(), unit: z.literal("metre"), axes: z.literal("orthogonal_xy"), evidenceReference: z.string(),
  }).strict().optional(),
}).strict();
const requestSchema = z.object({
  machineId: z.string().min(1), inputRevision: z.number().int().nonnegative().safe(),
  expectedRevision: z.number().int().nonnegative().safe().optional(), crsOptions: FieldCalculationCrsOptionsSchema.optional(),
}).strict();

/**
 * Detached, exact per-machine calculation context. This does not alter the field,
 * reinterpret display units, infer connections, or qualify GNSS/ground accuracy.
 * Its project is a computational projection, not a persistence conversion.
 */
export function createFieldCalculationInput(inputField: FieldDesign, inputRequest: FieldCalculationRequest): FieldCalculationInput {
  const field = validateFieldDesign(inputField);
  const request = requestSchema.parse(snapshotJsonValue(inputRequest, "calculation request"));
  if (request.expectedRevision !== undefined && request.expectedRevision !== request.inputRevision) {
    throw new Error("Field revision changed; rebuild the calculation input from the current field.");
  }
  const machine = field.machines.find(item => item.id === request.machineId);
  if (!machine) throw new Error("Calculation machine was not found in this field.");
  const crsOptions: CrsQualificationOptions = request.crsOptions ?? {};
  const crsQualification = qualifyProjectCrs(field.projectCrs, crsOptions);
  const waterSource = field.infrastructure.find(item => item.id === machine.waterSourceId && item.kind === "water_source");
  const powerSource = field.infrastructure.find(item => item.id === machine.powerSourceId && item.kind === "power_source");
  const features = new Map((field.mapFeatures ?? []).map(feature => [feature.id, feature]));
  const guidanceFeature = machine.cornerGuidanceFeatureId === undefined ? undefined : features.get(machine.cornerGuidanceFeatureId);
  const context: FieldCalculationContext = {
    key: { fieldId: field.id, machineId: machine.id, inputRevision: request.inputRevision }, machine,
    crsOptions, crsQualification,
    ...(waterSource === undefined ? {} : { waterSource }), ...(powerSource === undefined ? {} : { powerSource }),
    ...(guidanceFeature === undefined ? {} : { guidanceFeature }),
    sourceFeatures: (machine.sourceFeatureIds ?? []).map(id => features.get(id)!),
  };
  const blockers: ProjectCalculationBlocker[] = crsQualification.calculation.blockers.map(code => ({
    path: "projectCrs", code, message: `Metric planar calculation is unavailable: ${code}. Stored XY is unchanged.`,
  }));
  if (!waterSource) blockers.push({ path: "machine.waterSourceId", code: "water_source_missing", message: "Select an explicit water source for this machine before calculation." });
  if (!powerSource) blockers.push({ path: "machine.powerSourceId", code: "power_source_missing", message: "Select an explicit power source for this machine before calculation." });
  if (!waterSource || !powerSource || blockers.length > 0) return { ...context, status: "unsupported", blockers };

  const infrastructureObservationRefs = {
    ...(machine.pivotObservationId === undefined ? {} : { pivot_center: machine.pivotObservationId }),
    ...(waterSource.observationId === undefined ? {} : { water_source: waterSource.observationId }),
    ...(powerSource.observationId === undefined ? {} : { power_source: powerSource.observationId }),
  };
  const project: PivotProject = {
    id: field.id, name: field.name, projectCrs: field.projectCrs, unitSystem: field.unitSystem,
    ...(field.settings === undefined ? {} : { settings: field.settings }),
    fieldBoundary: field.fieldBoundary,
    ...(field.fieldBoundaryCaptureEvidence === undefined ? {} : { fieldBoundaryCaptureEvidence: field.fieldBoundaryCaptureEvidence }),
    pivotCenter: machine.pivotCenter, waterSource: waterSource.point, powerSource: powerSource.point,
    ...(Object.keys(infrastructureObservationRefs).length === 0 ? {} : { infrastructureObservationRefs }),
    machine: { id: machine.id, ...machine.configuration }, obstacles: field.obstacles, surveyPoints: field.surveyPoints,
    // Legacy consumers infer radial reach from corner_swing_limit. Field guidance and
    // source associations remain explicit context, never silently reinterpreted here.
    mapFeatures: [],
  };
  const safety = evaluateProjectCalculationSafety(project);
  if (!safety.allowed) return { ...context, status: "unsupported", blockers: safety.blockers };
  return { ...context, status: "ready", project, blockers: [] };
}

/** Identity/revision checks for a delayed result; no geometry or field-readiness claim. */
export function fieldCalculationInputMatches(input: FieldCalculationInput, field: Pick<FieldDesign, "id">,
  machineId: string, inputRevision: number): boolean {
  return Number.isSafeInteger(inputRevision) && inputRevision >= 0
    && input.key.fieldId === field.id && input.key.machineId === machineId && input.key.inputRevision === inputRevision;
}
