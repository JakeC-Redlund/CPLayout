import type { PivotMachine, XY } from "@cplayout/core";

/** A requested pair gap is applied once, using the larger configured gap. */
export function evaluatePivotPairSeparation(
  left: { machine: PivotMachine; pivotCenter: XY },
  right: { machine: PivotMachine; pivotCenter: XY },
  options: { collisionBufferMeters?: number; minimumMachineSeparationMeters?: number } = {},
) {
  const reach = (machine: PivotMachine) => machine.spanLengthsMeters.reduce((sum, span) => sum + span, 0) + machine.overhangMeters;
  const pairBufferMeters = Math.max(options.collisionBufferMeters ?? 0,
    left.machine.machineClearanceBufferMeters, right.machine.machineClearanceBufferMeters);
  const minimumRequiredSeparationMeters = Math.max(options.minimumMachineSeparationMeters ?? 0,
    reach(left.machine) + reach(right.machine) + pairBufferMeters);
  const centerDistanceMeters = Math.hypot(left.pivotCenter.x - right.pivotCenter.x, left.pivotCenter.y - right.pivotCenter.y);
  if (![pairBufferMeters, minimumRequiredSeparationMeters, centerDistanceMeters].every(Number.isFinite)) {
    throw new RangeError("Pair separation must be finite.");
  }
  return { centerDistanceMeters, minimumRequiredSeparationMeters, pairBufferMeters };
}
