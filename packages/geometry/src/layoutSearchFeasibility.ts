import { createFieldCalculationInput, type FieldPivotMachine, type LayoutResult, type PivotProject, type XY } from "@cplayout/core";
import { evaluateLayout, validateWetCoverageWithinField, DEFAULT_BOUNDARY_EPSILON_SQUARE_METERS } from "./geometry";
import { evaluatePivotPairSeparation } from "./machineSeparation";
import { layoutSearchPointKey } from "./layoutSearchCandidates";
import type { LayoutSearchPrice, LayoutSearchRequest, LayoutSearchPairClearance } from "./layoutSearchTypes";

export interface LayoutSearchEquipment {
  key: string; origin: "existing" | "template"; id: string; machine: FieldPivotMachine;
  pinned: boolean; maximumCount: number; project: PivotProject; price?: LayoutSearchPrice;
}
export interface LayoutSearchCandidate { id: string; equipment: LayoutSearchEquipment; center: XY; layout: LayoutResult }

/** The field adapter keeps explicit supply/source links and suppresses implicit guidance inference. */
export function prepareLayoutSearchEquipment(request: LayoutSearchRequest,
  reject: (scope: "machine" | "template", id: string, reason: string) => void,
): { equipment: LayoutSearchEquipment[]; unsupportedExisting: boolean } {
  const equipment: LayoutSearchEquipment[] = [];
  let unsupportedExisting = false;
  const add = (machine: FieldPivotMachine, origin: "existing" | "template", id: string, maximumCount: number, price?: LayoutSearchPrice) => {
    const scope = origin === "existing" ? "machine" : "template";
    if (machine.configuration.cornerArm) {
      reject(scope, id, "corner_motion_and_collision_unresolved");
      unsupportedExisting ||= origin === "existing";
      return;
    }
    const field = origin === "existing" ? request.field : { ...request.field, machines: [...request.field.machines, machine] };
    const input = createFieldCalculationInput(field, { machineId: machine.id, inputRevision: request.fieldRevision, crsOptions: request.crsOptions ?? {} });
    if (input.status !== "ready") {
      input.blockers.forEach(blocker => reject(scope, id, blocker.code));
      unsupportedExisting ||= origin === "existing";
      return;
    }
    equipment.push({ key: JSON.stringify([origin, id]), origin, id, machine, maximumCount, project: input.project,
      pinned: origin === "existing" && !(request.unlockedMachineIds ?? []).includes(id), ...(price ? { price } : {}) });
  };
  for (const machine of request.field.machines) add(machine, "existing", machine.id, 1,
    request.existingMachinePrices?.find(value => value.machineId === machine.id)?.price);
  for (const template of request.templates ?? []) {
    let id = `layout-search-template:${template.id}`;
    while (request.field.machines.some(machine => machine.id === id)) id += ":new";
    const { id: _templateMachineId, ...configuration } = template.machine;
    const machine: FieldPivotMachine = { id, kind: "center_pivot", configuration,
      pivotCenter: request.field.fieldBoundary[0],
      ...(template.waterSourceId ? { waterSourceId: template.waterSourceId } : {}),
      ...(template.powerSourceId ? { powerSourceId: template.powerSourceId } : {}),
      ...(template.sourceFeatureIds ? { sourceFeatureIds: template.sourceFeatureIds } : {}) };
    add(machine, "template", template.id, template.maximumCount, template.price);
  }
  return { equipment, unsupportedExisting };
}

/** A modeled move must not carry an observation claiming the old center is still measured here. */
export function layoutSearchProjectAtCenter(equipment: LayoutSearchEquipment, center: XY): PivotProject {
  const project = { ...equipment.project, pivotCenter: center };
  if (center.x !== equipment.machine.pivotCenter.x || center.y !== equipment.machine.pivotCenter.y) {
    const refs = project.infrastructureObservationRefs;
    if (refs?.pivot_center !== undefined) {
      const { pivot_center: _originalObservation, ...supplies } = refs;
      project.infrastructureObservationRefs = supplies;
    }
  }
  return project;
}

/** Boolean hard admission has no score or acreage floor. */
export function evaluateLayoutSearchCandidate(request: LayoutSearchRequest, equipment: LayoutSearchEquipment, center: XY):
  { candidate: LayoutSearchCandidate; reasons: [] } | { candidate: null; reasons: string[] } {
  const project = layoutSearchProjectAtCenter(equipment, center);
  const layout = evaluateLayout(project, request.crsOptions ?? {});
  const wet = validateWetCoverageWithinField(project, request.boundaryEpsilonSquareMeters ?? DEFAULT_BOUNDARY_EPSILON_SQUARE_METERS, request.crsOptions ?? {});
  const reasons: string[] = [];
  if (layout.metrics.hardMechanicalConflictCount > 0) reasons.push("hard_mechanical_conflict");
  if (!wet.feasible) reasons.push("wet_coverage_outside_boundary");
  if (reasons.length > 0) return { candidate: null, reasons };
  return { candidate: { id: JSON.stringify([equipment.key, layoutSearchPointKey(center)]), equipment, center, layout }, reasons: [] };
}
export function layoutSearchCombinationFeasibility(request: LayoutSearchRequest, selected: LayoutSearchCandidate[], requiredIds: string[]):
  { feasible: boolean; reason?: string; pairs: LayoutSearchPairClearance[] } {
  const fail = (reason: string) => ({ feasible: false, reason, pairs: [] });
  if (selected.length > request.maxMachines) return fail("machine_count_limit");
  if (new Set(selected.map(item => item.id)).size !== selected.length) return fail("duplicate_candidate");
  for (const id of requiredIds) if (selected.filter(item => item.equipment.origin === "existing" && item.equipment.id === id).length !== 1) return fail("required_existing_machine_missing_or_duplicated");
  for (const item of selected) {
    if (selected.filter(value => value.equipment.key === item.equipment.key).length > item.equipment.maximumCount) return fail("equipment_count_limit");
  }
  const pairs: LayoutSearchPairClearance[] = [];
  for (let i = 0; i < selected.length; i += 1) for (let j = i + 1; j < selected.length; j += 1) {
    const left = selected[i], right = selected[j];
    const pair = evaluatePivotPairSeparation({ machine: left.equipment.project.machine, pivotCenter: left.center },
      { machine: right.equipment.project.machine, pivotCenter: right.center }, request);
    if (pair.centerDistanceMeters < pair.minimumRequiredSeparationMeters) return fail("structural_pair_clearance");
    pairs.push({ leftCandidateId: left.id, rightCandidateId: right.id, ...pair,
      clearanceBeyondRequiredMeters: pair.centerDistanceMeters - pair.minimumRequiredSeparationMeters });
  }
  return { feasible: true, pairs };
}
