import assert from "node:assert/strict";

import { VALLEY_CORNER_ARM_SCAFFOLD_CATALOG, willRheaJasonHarmelinkExampleProject, type ObstacleZone, type XY } from "@cplayout/core";
import { feetToMeters } from "@cplayout/core";

import {
  CORNER_ARM_MINIMUM_PHYSICAL_SAFETY_ZONE_METERS,
  evaluateCornerArmKinematics,
  type CornerArmKinematicDiagnosticCode,
  type CornerArmKinematicInputs,
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
      assert.ok(cycle.pathChecks.branchDiscontinuityStateIndices.length > 0);
      assert.ok(cycle.pathChecks.directionReversalStateIndices.length > 0);
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

function assertAdmissionBlocked(input: unknown, codes: CornerArmKinematicDiagnosticCode[]) {
  const before = structuredClone(input);
  let result: ReturnType<typeof evaluateCornerArmKinematics> | undefined;
  assert.doesNotThrow(() => { result = evaluateCornerArmKinematics(input as CornerArmKinematicInputs); });
  assert.ok(result);
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.infeasibleDiagnostics.map((diagnostic) => diagnostic.code).sort(), [...codes].sort());
  assert.deepEqual(result.lrduPath, []);
  assert.deepEqual(result.sduPath, []);
  assert.deepEqual(result.overhangEndpointPath, []);
  assert.deepEqual(result.sweptPhysicalEnvelope, []);
  assert.deepEqual(result.wettedEndGunEnvelope, []);
  assert.deepEqual(result.endGunControlRows, []);
  assert.equal(result.sweptPhysicalEnvelopeAcres, 0);
  assert.equal(result.wettedEndGunEnvelopeAcres, 0);
  assert.ok(Number.isFinite(result.safetyZoneMeters), "Rejected input must retain a finite safety-zone value.");
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.canonicalGeometryMutation, false);
  assert.ok(result.warnings.includes(sourceVerificationWarning));
  assert.deepEqual(input, before);
  return result;
}

const sourceVerificationWarning = "Declared source status and artifact metadata are not independently verified by this calculation; matching declared statuses are not artifact proof.";
for (const result of [ready, missing, unreachable, blockedByAngle]) {
  assert.ok(result.warnings.includes(sourceVerificationWarning));
}

for (const sweep of [readyInput.sweep, { mode: "full_circle" as const }]) {
  for (const [field, missingCode, invalidCode] of [
    ["rotationDirection", "missing_rotation_direction", "invalid_rotation_direction"],
    ["orientation", "missing_orientation", "invalid_orientation"],
  ] as const) {
    const omitted: CornerArmKinematicInputs = { ...readyInput, sweep };
    delete omitted[field];
    assertAdmissionBlocked(omitted, [missingCode]);
    for (const value of [undefined, null]) {
      assertAdmissionBlocked({ ...readyInput, sweep, [field]: value }, [missingCode]);
    }
    for (const value of ["", " ", "invalid", "CLOCKWISE", "LEADING", 0, 17, false, {}, []]) {
      assertAdmissionBlocked({ ...readyInput, sweep, [field]: value }, [invalidCode]);
    }
  }
  const omitted: CornerArmKinematicInputs = { ...readyInput, sweep };
  delete omitted.rotationDirection;
  delete omitted.orientation;
  assertAdmissionBlocked(omitted, ["missing_rotation_direction", "missing_orientation"]);
}
assertAdmissionBlocked({ ...readyInput, rotationDirection: "clockwise" }, ["geometry_invalid"]);
assertAdmissionBlocked({ ...readyInput, rotationDirection: "invalid", sweep: { ...readyInput.sweep, direction: "invalid" } },
  ["invalid_rotation_direction", "geometry_invalid"]);

for (const direction of ["clockwise", "counterclockwise"] as const) {
  for (const orientation of ["leading", "trailing"] as const) {
    const guide = createCirclePolygon({ x: 0, y: 0 }, 120, 72);
    for (const sweep of [
      { mode: "full_circle" as const },
      { mode: "partial_circle" as const, startAngleDegrees: 0, stopAngleDegrees: direction === "clockwise" ? 340 : 20, direction },
    ]) {
      const input = { ...readyInput, rotationDirection: direction, orientation, sweep, guidancePath: [...guide, guide[0]] };
      const before = structuredClone(input);
      const result = evaluateCornerArmKinematics(input);
      assert.equal(result.status, "unresolved");
      assert.deepEqual(result.infeasibleDiagnostics, []);
      assert.equal(result.lrduPath.length, sweep.mode === "full_circle" ? 37 : 3);
      assert.equal(Math.sign(result.lrduPath[1].y), direction === "clockwise" ? -1 : 1);
      const expectedArmSide = direction === "counterclockwise"
        ? (orientation === "leading" ? 1 : -1) : (orientation === "leading" ? -1 : 1);
      assert.equal(Math.sign(result.sduPath[0].y), expectedArmSide);
      assert.ok(result.qualificationBlockers.includes("Equipment specifications require source confirmation."));
      assert.deepEqual(input, before);
    }
  }
}

for (const [patch, code] of [
  [{ sourceStatus: undefined }, "missing_model_provenance"],
  [{ sourceStatus: null }, "missing_model_provenance"],
  [{ sourceStatus: "" }, "invalid_model_provenance"],
  [{ sourceStatus: "verified" }, "invalid_model_provenance"],
  [{ sourceRefs: undefined }, "missing_model_provenance"],
  [{ sourceRefs: null }, "missing_model_provenance"],
  [{ sourceRefs: [] }, "missing_model_provenance"],
  [{ sourceRefs: {} }, "invalid_model_provenance"],
  [{ sourceRefs: "malformed" }, "invalid_model_provenance"],
  [{ sourceRefs: [null] }, "invalid_model_provenance"],
  [{ sourceRefs: [undefined, 17, "malformed"] }, "invalid_model_provenance"],
  [{ sourceRefs: Array(1) }, "invalid_model_provenance"],
  [{ sourceRefs: [{ ...model.sourceRefs[0], sourceStatus: "verified" }] }, "invalid_model_provenance"],
  [{ sourceRefs: [{ ...model.sourceRefs[0], artifactSha256: "not-a-hash" }] }, "invalid_model_provenance"],
  [{ sourceRefs: [{ ...model.sourceRefs[0], localEvidencePath: " " }] }, "invalid_model_provenance"],
  [{ sourceRefs: [{ ...model.sourceRefs[0], sourceId: undefined }] }, "invalid_model_provenance"],
  [{ sourceRefs: [{ ...model.sourceRefs[0], limit: "" }] }, "invalid_model_provenance"],
  [{ productionReady: true }, "invalid_model_provenance"],
  [{ normalizedRecordStatus: "VERIFIED" }, "invalid_model_provenance"],
  [{ sourceStatus: "manufacturer_verified" }, "inconsistent_model_provenance"],
  [{ sourceStatus: "operator_confirmed" }, "inconsistent_model_provenance"],
  [{ sourceStatus: "manufacturer_verified", sourceRefs: [] }, "missing_model_provenance"],
] as const) {
  const result = assertAdmissionBlocked({ ...readyInput, modelSpec: { ...model, ...patch } }, [code]);
  assert.equal(result.scaffoldSourceStatus, "missing", "Rejected provenance cannot be reported as confirmed.");
}

for (const sourceStatus of ["operator_confirmed", "manufacturer_verified"] as const) {
  const result = evaluateCornerArmKinematics({ ...readyInput, modelSpec: {
    ...model, sourceStatus, sourceRefs: [...model.sourceRefs, { ...model.sourceRefs[0], sourceStatus }],
  } });
  assert.equal(result.status, "unresolved", "Consistent declared metadata does not establish field qualification.");
  assert.equal(result.scaffoldSourceStatus, sourceStatus);
  assert.ok(result.warnings.includes(sourceVerificationWarning));
  assert.deepEqual(result.infeasibleDiagnostics, []);
  assert.deepEqual(result.lrduPath, ready.lrduPath);
  assert.deepEqual(result.sduPath, ready.sduPath);
  assert.ok(result.qualificationBlockers.some((message) => message.includes("continuous swept clearance")));
}

const limitCases = [
  ["minCornerAngleDegrees", "Minimum corner angle"],
  ["maxCornerAngleDegrees", "Maximum corner angle"],
  ["maxOutwardSteeringAngleDegrees", "Maximum outward steering angle"],
  ["maxInwardSteeringAngleDegrees", "Maximum inward steering angle"],
  ["cornerSpeedRatio", "Maximum SDU/LRDU speed ratio"],
] as const;
for (const [key, label] of limitCases) {
  for (const value of [NaN, Infinity, -Infinity, null, "20"]) {
    assertAdmissionBlocked({ ...readyInput, modelSpec: { ...model, [key]: value } }, ["invalid_model_spec"]);
  }
  const withoutLimit = evaluateCornerArmKinematics({ ...readyInput, modelSpec: { ...model, [key]: undefined } });
  assert.deepEqual(withoutLimit, {
    ...ready, qualificationBlockers: [...ready.qualificationBlockers, `${label} is missing; this constraint was not evaluated.`],
  });
}
for (const patch of [
  { minCornerAngleDegrees: 181, maxCornerAngleDegrees: 180 },
  { maxOutwardSteeringAngleDegrees: -1 },
  { maxInwardSteeringAngleDegrees: -1 },
  { cornerSpeedRatio: 0 },
  { cornerSpeedRatio: -1 },
]) {
  assertAdmissionBlocked({ ...readyInput, modelSpec: { ...model, ...patch } }, ["invalid_model_spec"]);
}
const zeroSteering = evaluateCornerArmKinematics({ ...readyInput, modelSpec: {
  ...model, maxOutwardSteeringAngleDegrees: 0, maxInwardSteeringAngleDegrees: 0,
} });
assert.ok(zeroSteering.infeasibleDiagnostics.some((diagnostic) => diagnostic.code === "steering_angle_exceeded"));
assert.ok(!zeroSteering.infeasibleDiagnostics.some((diagnostic) => diagnostic.code === "invalid_model_spec"));
for (const catalogModel of VALLEY_CORNER_ARM_SCAFFOLD_CATALOG) {
  const result = evaluateCornerArmKinematics({ ...readyInput, modelSpec: catalogModel });
  assert.equal(result.scaffoldSourceStatus, "scaffold_only");
  assert.equal(result.lrduPath.length, 3);
  assert.ok(result.qualificationBlockers.includes("Equipment specifications require source confirmation."));
  for (const [key, label] of limitCases) {
    assert.equal(result.qualificationBlockers.includes(`${label} is missing; this constraint was not evaluated.`), catalogModel[key] === undefined);
  }
}

// The opening pose is independently known: pivot (0,0), LRDU (100,0),
// SDU (100,60), overhang (100,80). Tiny crossings are far from every endpoint.
const rectangle = (left: number, bottom: number, right: number, top: number): XY[] => [
  { x: left, y: bottom }, { x: right, y: bottom }, { x: right, y: top }, { x: left, y: top },
];
const obstacle = (polygon: XY[], bufferMeters = 0): ObstacleZone => ({
  id: "member-probe", name: "Member probe", kind: "exclusion", polygon, bufferMeters,
  hardConflict: true, noSpray: false, confidence: "user_estimated",
});
const memberInput: CornerArmKinematicInputs = {
  ...readyInput, modelSpec: { ...model, spanLengthMeters: 60, overhangLengthMeters: 20 },
  guidancePath: [{ x: -300, y: 60 }, { x: 300, y: 60 }],
  sweep: { mode: "partial_circle", startAngleDegrees: 0, stopAngleDegrees: 1, direction: "counterclockwise" },
  fieldBoundary: rectangle(-50, -50, 150, 150),
};
const hasPoseZeroDiagnostic = (input: CornerArmKinematicInputs, code: CornerArmKinematicDiagnosticCode) =>
  evaluateCornerArmKinematics(input).infeasibleDiagnostics.some((diagnostic) => diagnostic.stateIndex === 0 && diagnostic.code === code);

for (const origin of [{ x: 0, y: 0 }, { x: 500000, y: 4500000 }]) {
  const shift = (point: XY): XY => ({ x: point.x + origin.x, y: point.y + origin.y });
  const input: CornerArmKinematicInputs = { ...memberInput, pivotCenter: origin,
    fieldBoundary: memberInput.fieldBoundary!.map(shift), guidancePath: memberInput.guidancePath!.map(shift) };
  const clear = evaluateCornerArmKinematics(input);
  assert.equal(clear.status, "unresolved");
  assert.deepEqual(clear.infeasibleDiagnostics, []);
  assert.deepEqual(clear.lrduPath[0], shift({ x: 100, y: 0 }));
  assert.deepEqual(clear.sduPath[0], shift({ x: 100, y: 60 }));
  assert.deepEqual(clear.overhangEndpointPath[0], shift({ x: 100, y: 80 }));
  assert.ok(clear.qualificationBlockers.some((message) => message.includes("continuous swept clearance")));
  const singlePose = evaluateCornerArmKinematics({ ...input,
    sweep: { mode: "partial_circle", startAngleDegrees: 0, stopAngleDegrees: 0, direction: "counterclockwise" } });
  const envelopePoints = singlePose.sweptPhysicalEnvelope.flat(2);
  assert.equal(Math.min(...envelopePoints.map((point) => point.y)), origin.y - 0.75,
    "The LRDU end cap extends behind the rigid member.");
  assert.equal(Math.max(...envelopePoints.map((point) => point.y)), origin.y + 80.75,
    "The overhang end cap extends beyond the member endpoint.");
  assert.ok(singlePose.sweptPhysicalEnvelopeAcres > 80 * 1.5 / 4046.8564224,
    "Physical envelope area includes cap area, beyond the member rectangle.");

  assert.equal(hasPoseZeroDiagnostic({ ...input, fieldBoundary: rectangle(10, -50, 150, 150).map(shift) },
    "outside_field_safety_zone"), true, "The pivot itself is outside while LRDU, SDU and overhang are inside.");

  for (const [x, y] of [[50, 0], [100, 30], [100, 70]]) {
    const crossing = { ...input, obstacles: [obstacle(rectangle(x - 0.001, y - 0.001, x + 0.001, y + 0.001).map(shift))] };
    assert.equal(hasPoseZeroDiagnostic(crossing, "obstacle_clearance_failed"), true,
      `A tiny obstacle crossing the member interior at ${x},${y} must block the sampled pose.`);
    assert.equal(evaluateCornerArmKinematics(crossing).status, "blocked");
  }
  const clearObstacle = evaluateCornerArmKinematics({ ...input, obstacles: [obstacle(rectangle(49, 10, 51, 11).map(shift))] });
  assert.equal(clearObstacle.status, "unresolved");
  assert.deepEqual(clearObstacle.infeasibleDiagnostics, []);
  const advisoryObstacle = evaluateCornerArmKinematics({ ...input,
    obstacles: [{ ...obstacle(rectangle(49, -1, 51, 1).map(shift)), hardConflict: false }] });
  assert.deepEqual(advisoryObstacle.infeasibleDiagnostics, []);

  const mainCutout = [
    { x: -50, y: -50 }, { x: 150, y: -50 }, { x: 150, y: 150 },
    { x: 50.001, y: 150 }, { x: 50.001, y: -1 }, { x: 49.999, y: -1 },
    { x: 49.999, y: 150 }, { x: -50, y: 150 },
  ];
  assert.equal(hasPoseZeroDiagnostic({ ...input, fieldBoundary: mainCutout.map(shift) }, "outside_field_safety_zone"), true);
  for (const y of [30, 70]) {
    const armCutout = [
      { x: -50, y: -50 }, { x: 150, y: -50 }, { x: 150, y: y - 0.001 },
      { x: 99, y: y - 0.001 }, { x: 99, y: y + 0.001 }, { x: 150, y: y + 0.001 },
      { x: 150, y: 150 }, { x: -50, y: 150 },
    ];
    assert.equal(hasPoseZeroDiagnostic({ ...input, fieldBoundary: armCutout.map(shift) }, "outside_field_safety_zone"), true);
  }

  // Neither the physical radius nor the obstacle setback alone reaches this
  // obstacle, but their sum does. No centerline or endpoint intersects it.
  const nearObstacle = { ...input, physicalBufferMeters: 0.75,
    obstacles: [obstacle(rectangle(49, 0.8, 51, 1).map(shift), 0.2)] };
  assert.equal(hasPoseZeroDiagnostic(nearObstacle, "obstacle_clearance_failed"), true);
  assert.equal(hasPoseZeroDiagnostic({ ...nearObstacle, physicalBufferMeters: 0.1 }, "obstacle_clearance_failed"), false);
  assert.equal(hasPoseZeroDiagnostic({ ...nearObstacle, obstacles: [obstacle(rectangle(49, 0.8, 51, 1).map(shift))] }, "obstacle_clearance_failed"), false);

  const nearBoundary = { ...input, physicalBufferMeters: 0.75, fieldBoundary: rectangle(-50, -0.8, 150, 150).map(shift) };
  assert.equal(hasPoseZeroDiagnostic(nearBoundary, "outside_field_safety_zone"), true);
  assert.equal(hasPoseZeroDiagnostic({ ...nearBoundary, physicalBufferMeters: 0.1 }, "outside_field_safety_zone"), false);
  assert.equal(hasPoseZeroDiagnostic({ ...nearBoundary, physicalBufferMeters: 0.1, safetyZoneMeters: 0.8 }, "outside_field_safety_zone"), true);
}

for (const value of [NaN, Infinity, -Infinity, -1]) {
  assertAdmissionBlocked({ ...memberInput, physicalBufferMeters: value }, ["geometry_invalid"]);
  assertAdmissionBlocked({ ...memberInput, safetyZoneMeters: value }, ["geometry_invalid"]);
  assertAdmissionBlocked({ ...memberInput, obstacles: [obstacle(rectangle(49, 0.8, 51, 1), value)] }, ["geometry_invalid"]);
}
assertAdmissionBlocked({ ...memberInput, obstacles: [obstacle([{ x: 1, y: 1 }])] }, ["geometry_invalid"]);
assertAdmissionBlocked({ ...memberInput, obstacles: [obstacle([{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }])] }, ["geometry_invalid"]);

for (const value of [null, {}, "invalid", 1, false, [null], [undefined], [{}], Array(1)]) {
  assertAdmissionBlocked({ ...memberInput, obstacles: value }, ["geometry_invalid"]);
}
for (const polygon of [undefined, null, {}, "invalid", [null, null, null], [{}, {}, {}], Array(3)]) {
  assertAdmissionBlocked({ ...memberInput, obstacles: [{ ...obstacle([]), polygon }] }, ["geometry_invalid"]);
}
for (const field of ["fieldBoundary", "guidancePath"] as const) {
  for (const value of [{}, "invalid", [{ x: 0, y: 0 }, null, { x: 1, y: 1 }], Array(3)]) {
    assertAdmissionBlocked({ ...memberInput, [field]: value }, ["geometry_invalid"]);
  }
}
for (const value of [NaN, Infinity, -Infinity, null, "2", {}]) {
  const result = assertAdmissionBlocked({ ...memberInput, safetyZoneMeters: value }, ["geometry_invalid"]);
  assert.equal(result.safetyZoneMeters, Number(CORNER_ARM_MINIMUM_PHYSICAL_SAFETY_ZONE_METERS.toFixed(6)));
}

// Explicit local metric qualification is passed through; a LOCAL label alone is insufficient.
const localInput = { ...memberInput, projectCrs: "LOCAL:corner-test" };
assertAdmissionBlocked(localInput, ["missing_projected_crs"]);
const declaredLocal = { ...localInput, crsOptions: { localMetricDeclaration: {
  projectCrs: "LOCAL:corner-test", unit: "metre" as const, axes: "orthogonal_xy" as const, evidenceReference: "synthetic-metric-fixture",
} } };
assert.equal(evaluateCornerArmKinematics(declaredLocal).status, "unresolved");
assertAdmissionBlocked({ ...declaredLocal, crsOptions: { localMetricDeclaration: {
  ...declaredLocal.crsOptions.localMetricDeclaration, projectCrs: "LOCAL:another-frame",
} } }, ["missing_projected_crs"]);

const raw = evaluateCornerArmKinematics(readyInput);
assert.equal(raw.sampledStates.length, raw.lrduPath.length);
assert.equal(raw.sampledStates[1].deltaMinutes, expectedDt);
assert.notEqual(raw.sampledStates[1].deltaMinutes, Number(expectedDt.toFixed(6)));
assert.equal(raw.sampledStates[1].lrdu.x, 100 * Math.cos(Math.PI / 18));
assert.notEqual(raw.sampledStates[1].lrdu.x, raw.lrduPath[1].x);
assert.ok(Object.isFrozen(raw.sampledStates));
assert.ok(Object.isFrozen(raw.sampledStates[1]));
assert.ok(Object.isFrozen(raw.sampledStates[1].lrdu));
assert.deepEqual(raw.wheelTracks.sdu, raw.sduPath);
assert.ok(raw.sampledStructuralEnvelopeAcres > raw.sweptPhysicalEnvelopeAcres);
assert.equal(raw.footprintAccounting.netAdditionalFootprintAcres, null);
for (const [index, state] of raw.sampledStates.entries()) {
  if (index === 0) continue;
  assert.equal(state.sduToLrduSpeedRatio, Math.abs(state.signedGuidanceTravelMeters) / state.deltaMinutes / 10);
}

// Two clear base poses can hide a narrow conflict. A guidance-segment transition
// triggers a bounded midpoint sample that observes it; this is still not a proof
// of the entire between-pose trajectory.
const circularGuide = createCirclePolygon({ x: 0, y: 0 }, 120, 72);
const probe = { x: 50 * Math.cos(5 * Math.PI / 180), y: 50 * Math.sin(5 * Math.PI / 180) };
const refinementInput: CornerArmKinematicInputs = { ...readyInput,
  guidancePath: [...circularGuide, circularGuide[0]],
  sweep: { mode: "partial_circle", startAngleDegrees: 0, stopAngleDegrees: 10, direction: "counterclockwise" },
  obstacles: [obstacle(rectangle(probe.x - 0.001, probe.y - 0.001, probe.x + 0.001, probe.y + 0.001))],
};
const coarse = evaluateCornerArmKinematics(refinementInput);
assert.equal(coarse.status, "unresolved");
const reversedGuidance = evaluateCornerArmKinematics({ ...refinementInput, guidancePath: [...refinementInput.guidancePath!].reverse() });
assert.equal(reversedGuidance.status, coarse.status);
assert.ok(Math.abs(reversedGuidance.sampledStates[1].sduToLrduSpeedRatio - coarse.sampledStates[1].sduToLrduSpeedRatio) < 1e-9);
assert.equal(Math.sign(reversedGuidance.sampledStates[1].signedGuidanceTravelMeters), -Math.sign(coarse.sampledStates[1].signedGuidanceTravelMeters));
assert.ok(coarse.sampledStates.every(state => Number.isFinite(state.cornerAngularRateDegreesPerMinute)));
const refinedInput = { ...refinementInput, refinement: { maxAdditionalSamples: 7, minAngleStepDegrees: 0.1 } };
const refinedBefore = structuredClone(refinedInput);
const refined = evaluateCornerArmKinematics(refinedInput);
assert.equal(refined.status, "blocked");
assert.ok(refined.sampledStates.some(state => state.thetaDegrees === 5
  && state.infeasibleDiagnostics.some(item => item.code === "obstacle_clearance_failed")));
assert.equal(refined.sampling.baseSampleCount, 2);
assert.ok(refined.sampling.addedSampleCount > 0 && refined.sampling.addedSampleCount <= 7);
assert.equal(refined.sampling.betweenPoseClearance, "unresolved");
assert.deepEqual(evaluateCornerArmKinematics(refinedInput), refined, "Same input produces deterministic refinement, rates and accounting.");
assert.deepEqual(refinedInput, refinedBefore);
const oneExtra = evaluateCornerArmKinematics({ ...refinementInput, refinement: { maxAdditionalSamples: 1 } });
assert.equal(oneExtra.sampling.addedSampleCount, 1);
assert.equal(oneExtra.sampling.budgetExhausted, true);
assert.ok(oneExtra.warnings.some(message => message.includes("Refinement budget")));

// Potential end-gun discs follow the actual articulated endpoint, not the old
// hypothetical fully extended annulus. Net acreage requires an explicit baseline.
const gunInput: CornerArmKinematicInputs = { ...memberInput, endGunThrowMeters: 5,
  sweep: { mode: "partial_circle", startAngleDegrees: 0, stopAngleDegrees: 0, direction: "counterclockwise" },
  baselineFootprints: [],
};
const gun = evaluateCornerArmKinematics(gunInput);
const gunPoints = gun.wettedEndGunEnvelope.flat(2);
assert.equal(Math.min(...gunPoints.map(point => point.x)), 95);
assert.equal(Math.max(...gunPoints.map(point => point.y)), 85);
const expectedDiscArea = 32 * 25 * Math.sin(2 * Math.PI / 64);
assert.ok(Math.abs(gun.footprintAccounting.potentialFootprintAcres * 4046.8564224 - expectedDiscArea) < 1e-8);
assert.equal(gun.footprintAccounting.netAdditionalFootprintAcres, gun.footprintAccounting.potentialFootprintAcres);
const coveredGun = evaluateCornerArmKinematics({ ...gunInput, baselineFootprints: [gun.wettedEndGunEnvelope] });
assert.equal(coveredGun.footprintAccounting.netAdditionalFootprintAcres, 0);
const unrestrictedGun = evaluateCornerArmKinematics({ ...readyInput, endGunThrowMeters: 5 });
const fullTurnGun = evaluateCornerArmKinematics({ ...readyInput, endGunThrowMeters: 5,
  endGunAngleRanges: [{ startAngleDegrees: 0, stopAngleDegrees: 360, direction: "counterclockwise" }] });
assert.deepEqual(fullTurnGun.wettedEndGunEnvelope, unrestrictedGun.wettedEndGunEnvelope);
assert.deepEqual(fullTurnGun.endGunControlRows, [], "A partial sweep cannot supply a completed full-turn control row.");
const control = evaluateCornerArmKinematics({ ...readyInput, endGunThrowMeters: 5,
  endGunAngleRanges: [{ startAngleDegrees: 5, stopAngleDegrees: 15, direction: "counterclockwise" }],
  refinement: { maxAdditionalSamples: 3 },
});
assert.equal(control.endGunControlRows.length, 1);
for (const [angle, coordinate] of [[5, control.endGunControlRows[0].startCoordinate], [15, control.endGunControlRows[0].stopCoordinate]] as const) {
  const state = control.sampledStates.find(item => item.thetaDegrees === angle)!;
  assert.ok(state);
  assert.deepEqual(coordinate, { x: Number(state.overhangEndpoint.x.toFixed(6)), y: Number(state.overhangEndpoint.y.toFixed(6)) });
}
assert.equal(control.sampledStates.at(-1)!.elapsedMinutes, 100 * (20 * Math.PI / 180) / 10);

for (const patch of [
  { endGunThrowMeters: -1 }, { endGunThrowMeters: NaN }, { endGunThrowMeters: Infinity },
  { endGunAngleRanges: null }, { endGunAngleRanges: {} }, { endGunAngleRanges: [null] }, { endGunAngleRanges: Array(1) },
  { endGunAngleRanges: [{ startAngleDegrees: -1, stopAngleDegrees: 10, direction: "clockwise" }] },
  { endGunAngleRanges: [{ startAngleDegrees: 0, stopAngleDegrees: NaN, direction: "clockwise" }] },
  { endGunAngleRanges: [{ startAngleDegrees: 0, stopAngleDegrees: 10, direction: "bad" }] },
  { refinement: null }, { refinement: {} }, { refinement: { maxAdditionalSamples: -1 } },
  { refinement: { maxAdditionalSamples: 513 } }, { refinement: { maxAdditionalSamples: 1.5 } },
  { refinement: { maxAdditionalSamples: Infinity } }, { refinement: { maxAdditionalSamples: 1, minAngleStepDegrees: NaN } },
  { refinement: { maxAdditionalSamples: 1, minAngleStepDegrees: 0 } },
  { baselineFootprints: null }, { baselineFootprints: {} }, { baselineFootprints: [null] },
  { baselineFootprints: [[[null]]] }, { baselineFootprints: [[[{ x: NaN, y: 0 }]]] },
  { crsOptions: null }, { crsOptions: [] }, { crsOptions: { localMetricDeclaration: null } },
  { sweep: null }, { sweep: "full_circle" }, { sweep: {} }, { sweep: { mode: "bad" } },
]) assertAdmissionBlocked({ ...readyInput, ...patch }, ["geometry_invalid"]);
