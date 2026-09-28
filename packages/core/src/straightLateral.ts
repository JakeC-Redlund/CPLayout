import { z } from "zod";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { assertNoStrippedFields } from "./jsonFieldRetention";
import { projectDataKey } from "./projectDataComparison";

const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const distance = z.number().finite().nonnegative();

/**
 * Explicit product model for a rigid member translated along one straight path.
 * This is not a manufacturer configuration, hydraulic design or bendable machine.
 * Lengths describe the existing projected/local metre plane, never display units.
 */
export const StraightLateralMachineSchema = z.object({
  id: z.string().min(1), kind: z.literal("straight_lateral"), name: z.string().min(1),
  /** Physical member extents to the left/right of travel, viewed from start toward end. */
  leftExtentMeters: distance, rightExtentMeters: distance,
  /** Travel direction: 0 = +X/east; angles increase counterclockwise toward +Y/north. */
  travelHeadingDegrees: z.number().finite().min(0).lt(360),
  /** Exactly two endpoints. The member remains perpendicular to this direction throughout. */
  travel: z.object({ start: point, end: point }).strict(),
  /** Explicit whole-member clearance; no manufacturer or equipment default is supplied. */
  machineClearanceBufferMeters: distance,
  waterSourceId: z.string().min(1).optional(), powerSourceId: z.string().min(1).optional(),
  /** Optional potential rectangular wet-envelope reach, NOT measured application or hydraulic capacity. */
  sprinklerReachMeters: distance.optional(),
}).strict().superRefine((machine, context) => {
  if (!(machine.leftExtentMeters > 0 || machine.rightExtentMeters > 0)) {
    context.addIssue({ code: "custom", path: ["leftExtentMeters"], message: "A straight lateral requires a positive physical member extent." });
  }
  if (machine.travel.start.x === machine.travel.end.x && machine.travel.start.y === machine.travel.end.y) {
    context.addIssue({ code: "custom", path: ["travel"], message: "Straight travel requires two distinct endpoints." });
  }
});
export type StraightLateralMachine = z.output<typeof StraightLateralMachineSchema>;

/** Strict detached storage admission; calculation separately checks CRS, heading and budgets. */
export function validateStraightLateralMachine(input: unknown): StraightLateralMachine {
  const snapshot = snapshotJsonValue(input, "straight lateral");
  assertDefined(snapshot);
  const machine = StraightLateralMachineSchema.parse(snapshot);
  assertNoStrippedFields(snapshot, machine, "Unsupported straight lateral data cannot be discarded.");
  if (projectDataKey(snapshot as object) !== projectDataKey(machine)) throw new Error("Straight lateral input must remain exact; defaults or normalization are not supported.");
  return machine;
}

function assertDefined(value: unknown): void {
  if (value === undefined) throw new Error("Undefined straight lateral values cannot survive JSON; omit absent optional fields.");
  if (value && typeof value === "object") Object.values(value).forEach(assertDefined);
}
