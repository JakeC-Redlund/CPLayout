import assert from "node:assert/strict";

import { VALLEY_CORNER_ARM_SCAFFOLD_CATALOG, willRheaJasonHarmelinkExampleProject } from "@cplayout/core";
import { feetToMeters } from "@cplayout/core";

import {
  CORNER_ARM_MINIMUM_PHYSICAL_SAFETY_ZONE_METERS,
  evaluateCornerArmKinematics,
} from "./cornerArmKinematics";
import { createCirclePolygon } from "./geometry";

const model = {
  ...VALLEY_CORNER_ARM_SCAFFOLD_CATALOG[0],
  minCornerAngleDegrees: 0,
  maxCornerAngleDegrees: 180,
  maxOutwardSteeringAngleDegrees: 180,
  maxInwardSteeringAngleDegrees: 180,
  cornerSpeedRatio: 20,
};
const boundary = [
  { x: -500, y: -500 },
  { x: 500, y: -500 },
  { x: 500, y: 500 },
  { x: -500, y: 500 },
];
const guidancePath = [
  { x: -300, y: 55 },
  { x: 300, y: 55 },
];

const readyInput = {
  projectCrs: "EPSG:32613",
  pivotCenter: { x: 0, y: 0 },
  pivotCenterToLrduRadiusMeters: 100,
  lrduSpeedMetersPerMinuteAt100Percent: 10,
  modelSpec: model,
  rotationDirection: "counterclockwise" as const,
  orientation: "leading" as const,
  sweep: { mode: "partial_circle" as const, startAngleDegrees: 0, stopAngleDegrees: 20, direction: "counterclockwise" as const },
  fieldBoundary: boundary,
  guidancePath,
  sampleAngleStepDegrees: 10,
};

const missing = evaluateCornerArmKinematics({
  projectCrs: "EPSG:4326",
  rotationDirection: "counterclockwise",
  orientation: "leading",
});
assert.equal(missing.status, "blocked");
assert.ok(missing.infeasibleDiagnostics.some((diagnostic) => diagnostic.code === "missing_projected_crs"));
assert.ok(missing.infeasibleDiagnostics.some((diagnostic) => diagnostic.code === "missing_lrdu_radius"));
assert.ok(missing.infeasibleDiagnostics.some((diagnostic) => diagnostic.code === "missing_guidance_path"));
assert.equal(missing.safetyZoneMeters, Number(CORNER_ARM_MINIMUM_PHYSICAL_SAFETY_ZONE_METERS.toFixed(6)));

const willRheaBlocked = evaluateCornerArmKinematics({
  projectCrs: willRheaJasonHarmelinkExampleProject.projectCrs,
  pivotCenter: willRheaJasonHarmelinkExampleProject.pivotCenter,
  pivotCenterToLrduRadiusMeters: willRheaJasonHarmelinkExampleProject.machine.spanLengthsMeters.reduce((sum, span) => sum + span, 0),
  lrduSpeedMetersPerMinuteAt100Percent: willRheaJasonHarmelinkExampleProject.machine.driveUnits?.lrdu?.operatorMeasuredSpeedMetersPerMinute,
  modelSpec: undefined,
  rotationDirection: "counterclockwise",
  orientation: "leading",
  sweep: willRheaJasonHarmelinkExampleProject.machine.sweep,
  fieldBoundary: willRheaJasonHarmelinkExampleProject.fieldBoundary,
  guidancePath: undefined,
});
assert.equal(willRheaBlocked.status, "blocked");
assert.ok(willRheaBlocked.infeasibleDiagnostics.some((diagnostic) => diagnostic.code === "missing_lrdu_speed"));
assert.ok(willRheaBlocked.infeasibleDiagnostics.some((diagnostic) => diagnostic.code === "missing_model_spec"));
assert.ok(willRheaBlocked.infeasibleDiagnostics.some((diagnostic) => diagnostic.code === "missing_guidance_path"));
assert.equal(
  willRheaJasonHarmelinkExampleProject.mapFeatures?.some((feature) => feature.kind === "measurement_line" && feature.id === "will-rhea-lrdu-distance"),
  true,
);
assert.equal(willRheaJasonHarmelinkExampleProject.mapFeatures?.some((feature) => feature.kind === "linear_move_path"), false);

const ready = evaluateCornerArmKinematics(readyInput);
assert.equal(ready.status, "unresolved");
assert.ok(ready.qualificationBlockers.length > 0);
assert.ok(ready.sduPath.every((point) => Math.abs(point.y - 55) < 1e-6));
assert.ok(ready.sduPath.every((point, index) => Math.abs(Math.hypot(point.x - ready.lrduPath[index].x, point.y - ready.lrduPath[index].y) - model.spanLengthMeters) < 2e-6));
const unreachable = evaluateCornerArmKinematics({ ...readyInput, guidancePath: [{ x: -300, y: 120 }, { x: 300, y: 120 }] });
assert.equal(unreachable.status, "blocked");
assert.ok(unreachable.infeasibleDiagnostics.some((diagnostic) => diagnostic.code === "guidance_unreachable"));
assert.equal(unreachable.sduPath.length, 0);
assert.equal(ready.advisoryOnly, true);
assert.equal(ready.canonicalGeometryMutation, false);
assert.equal(ready.scaffoldSourceStatus, "scaffold_only");
assert.equal(ready.lrduPath.length, 3);
assert.equal(ready.sduPath.length, 3);
assert.equal(ready.overhangEndpointPath.length, 3);
assert.ok(ready.sweptPhysicalEnvelopeAcres > 0);
assert.equal(ready.wettedEndGunEnvelopeAcres, 0);

const expectedDt = (100 * (10 * Math.PI / 180)) / 10;
assert.equal(ready.lrduPath[1].x, Number((100 * Math.cos(10 * Math.PI / 180)).toFixed(6)));
assert.equal(
  evaluateCornerArmKinematics({ ...readyInput, endGunThrowMeters: feetToMeters(40), endGunAngleRanges: [{ startAngleDegrees: 5, stopAngleDegrees: 15, direction: "counterclockwise" }] }).endGunControlRows.length,
  1,
);
assert.equal(
  Number(evaluateCornerArmKinematics(readyInput).infeasibleDiagnostics.length),
  0,
);

const timing = evaluateCornerArmKinematics({ ...readyInput, sampleAngleStepDegrees: 10 });
assert.equal(Number((timing.infeasibleDiagnostics.length).toFixed(0)), 0);
assert.equal(Number((timing.safetyZoneMeters).toFixed(6)), Number(CORNER_ARM_MINIMUM_PHYSICAL_SAFETY_ZONE_METERS.toFixed(6)));
assert.ok(Math.abs(timing.overhangEndpointPath[1].x - ready.overhangEndpointPath[1].x) < 0.000001);

const blockedByAngle = evaluateCornerArmKinematics({
  ...readyInput,
  modelSpec: { ...model, minCornerAngleDegrees: 120, maxCornerAngleDegrees: 121 },
});
assert.equal(blockedByAngle.status, "blocked");
assert.ok(blockedByAngle.infeasibleDiagnostics.some((diagnostic) => diagnostic.code === "corner_angle_below_min" || diagnostic.code === "corner_angle_above_max"));

const blockedBySpeed = evaluateCornerArmKinematics({
  ...readyInput,
  modelSpec: { ...model, cornerSpeedRatio: 0.01 },
});
assert.equal(blockedBySpeed.status, "blocked");
assert.ok(blockedBySpeed.infeasibleDiagnostics.some((diagnostic) => diagnostic.code === "speed_ratio_above_max"));

const blockedBySteering = evaluateCornerArmKinematics({
  ...readyInput,
  modelSpec: { ...model, maxOutwardSteeringAngleDegrees: 0.01, maxInwardSteeringAngleDegrees: 0.01 },
});
assert.equal(blockedBySteering.status, "blocked");
assert.ok(blockedBySteering.infeasibleDiagnostics.some((diagnostic) => diagnostic.code === "steering_angle_exceeded"));

const blockedBySafety = evaluateCornerArmKinematics({
  ...readyInput,
  fieldBoundary: [
    { x: -50, y: -50 },
    { x: 50, y: -50 },
    { x: 50, y: 50 },
    { x: -50, y: 50 },
  ],
});
assert.equal(blockedBySafety.status, "blocked");
assert.ok(blockedBySafety.infeasibleDiagnostics.some((diagnostic) => diagnostic.code === "outside_field_safety_zone"));

const withWetted = evaluateCornerArmKinematics({ ...readyInput, endGunThrowMeters: feetToMeters(40) });
assert.ok(withWetted.wettedEndGunEnvelopeAcres > 0);
assert.ok(withWetted.sweptPhysicalEnvelopeAcres > 0);
assert.notEqual(withWetted.wettedEndGunEnvelopeAcres, withWetted.sweptPhysicalEnvelopeAcres);
assert.ok(expectedDt > 0);

for (const direction of ["clockwise", "counterclockwise"] as const) {
  const guide = createCirclePolygon({ x: 0, y: 0 }, 120, 72);
  for (const sampleAngleStepDegrees of [10, 30]) {
    const cycle = evaluateCornerArmKinematics({ ...readyInput, rotationDirection: direction,
      sweep: { mode: "full_circle" }, guidancePath: [...guide, guide[0]], sampleAngleStepDegrees });
    assert.equal(cycle.lrduPath.length, 360 / sampleAngleStepDegrees + 1);
    assert.deepEqual(cycle.lrduPath[0], cycle.lrduPath.at(-1));
    assert.equal(Math.sign(cycle.lrduPath[1].y), direction === "clockwise" ? -1 : 1);
    if (sampleAngleStepDegrees === 10) {
      assert.equal(cycle.status, "unresolved", "sampled closure is not continuous physical feasibility");
      assert.equal(cycle.infeasibleDiagnostics.length, 0);
      assert.deepEqual(cycle.sduPath[0], cycle.sduPath.at(-1));
    } else {
      // Coarse nearest-intersection sampling can switch branches; it must retain its failure.
      assert.equal(cycle.status, "blocked");
      assert.ok(cycle.infeasibleDiagnostics.some((diagnostic) => diagnostic.code === "corner_angle_above_max"));
      assert.notDeepEqual(cycle.sduPath[0], cycle.sduPath.at(-1));
    }
    const origin = { x: 500000, y: 4500000 };
    const shifted = (point: { x: number; y: number }) => ({ x: point.x + origin.x, y: point.y + origin.y });
    const translated = evaluateCornerArmKinematics({ ...readyInput, pivotCenter: origin, rotationDirection: direction,
      sweep: { mode: "full_circle" }, fieldBoundary: boundary.map(shifted),
      guidancePath: [...guide, guide[0]].map(shifted), sampleAngleStepDegrees });
    assert.equal(translated.status, cycle.status);
    assert.deepEqual(translated.infeasibleDiagnostics, cycle.infeasibleDiagnostics);
    assert.equal(translated.lrduPath.length, cycle.lrduPath.length);
    assert.ok(Math.abs(translated.sweptPhysicalEnvelopeAcres - cycle.sweptPhysicalEnvelopeAcres) < 1e-5);
  }
}
