import assert from "node:assert/strict";

import type { PivotProject, ProjectMapFeature, XY } from "@cplayout/core";

import { buildAdvisoryMachineRenderModel } from "./advisoryMachineRenderModel";

const fieldBoundary: XY[] = [
  { x: 0, y: 0 },
  { x: 360, y: 0 },
  { x: 360, y: 180 },
  { x: 0, y: 180 },
];

const southOutline: ProjectMapFeature = {
  id: "south-east-circle",
  name: "South East Circle",
  kind: "machine_zone",
  geometry: {
    type: "LineString",
    vertices: circleOutline({ x: 100, y: 90 }, 75),
  },
  confidence: "imagery_digitized",
  properties: {
    preferredMachineOutline: true,
    advisoryDesignRole: "preferred_machine_outline",
    canonicalGeometryMutation: false,
  },
};

const middleOutline: ProjectMapFeature = {
  id: "middle-part-circle",
  name: "Middle Part Circle",
  kind: "machine_zone",
  geometry: {
    type: "LineString",
    vertices: partialOutline({ x: 205, y: 90 }, 78, 225, 135),
  },
  confidence: "imagery_digitized",
  properties: {
    preferredMachineOutline: true,
    advisoryDesignRole: "preferred_machine_outline",
    canonicalGeometryMutation: false,
  },
};

const generatedLrduCircle: ProjectMapFeature = {
  id: "generated-lrdu-circle",
  name: "Generated LRDU circle",
  kind: "machine_zone",
  geometry: { type: "Circle", center: { x: 180, y: 90 }, radiusMeters: 55 },
  confidence: "imagery_digitized",
  properties: {
    generatedFromImportedMeasurement: true,
    canonicalGeometryMutation: false,
  },
};

const noSpray: PivotProject["obstacles"][number] = {
  id: "verified-exclusion",
  name: "Verified no-spray exclusion",
  kind: "exclusion",
  polygon: [
    { x: 190, y: 78 },
    { x: 220, y: 78 },
    { x: 220, y: 108 },
    { x: 190, y: 108 },
  ],
  bufferMeters: 0,
  hardConflict: true,
  noSpray: true,
  confidence: "imagery_digitized",
};

const project: PivotProject = {
  id: "advisory-render-test",
  name: "Advisory Render Test",
  // Synthetic metre-grid arithmetic, not georeferenced field evidence.
  projectCrs: "EPSG:32613",
  unitSystem: "us_survey_feet",
  fieldBoundary,
  pivotCenter: { x: 100, y: 90 },
  waterSource: { x: 100, y: 90 },
  powerSource: { x: 100, y: 90 },
  machine: {
    id: "machine-template",
    name: "Machine template",
    spanLengthsMeters: [54, 54],
    overhangMeters: 0,
    endGunThrowMeters: 0,
    towerClearanceBufferMeters: 3,
    machineClearanceBufferMeters: 5,
    sweep: { mode: "full_circle" },
  },
  obstacles: [noSpray],
  surveyPoints: [],
  mapPackages: [],
  mapFeatures: [southOutline, middleOutline, generatedLrduCircle],
};

const before = JSON.stringify(project);
const model = buildAdvisoryMachineRenderModel(project, { endGunThrowMeters: 30.48, includePublicVflexFallbackCornerArm: true });

assert.equal(model.status, "ready");
assert.equal(model.advisoryOnly, true);
assert.equal(model.canonicalGeometryMutation, false);
assert.equal(model.qualifiedReviewRequired, true);
assert.equal(model.instances.length, 2);
assert.deepEqual(model.instances.map((instance) => instance.sourceFeatureIds[0]), ["south-east-circle", "middle-part-circle"]);
assert.equal(model.instances.find((instance) => instance.label === "South East Circle")?.sweep.mode, "full_circle");
assert.equal(model.instances.find((instance) => instance.label === "Middle Part Circle")?.sweep.mode, "partial_circle");
assert.equal(model.instances.every((instance) => instance.machine.endGunThrowMeters === 30.48), true);
assert.equal(model.instances.every((instance) => instance.machine.cornerArm?.lengthMeters === 91), true);
assert.equal(model.instances.every((instance) => instance.machine.cornerArm?.wheelTrackLengthMeters === 66), true);
assert.equal(model.instances.every((instance) => instance.machine.cornerArm?.overhangLengthMeters === 25), true);
assert.equal(model.surfaces.length, 2);
assert.equal(model.surfaces.every((surface) => surface.advisoryOnly === true && surface.canonicalGeometryMutation === false), true);
assert.equal(model.surfaces.every((surface) => surface.preferredOutlinePath.length > 3), true);
assert.equal(model.surfaces.every((surface) => surface.standardPivotAcres > 0), true);
assert.equal(model.surfaces.every((surface) => surface.endGunAcres > 0), true);
assert.equal(model.surfaces.every((surface) => surface.cornerArmAcres > 0), true);
assert.equal(model.surfaces.every((surface) => surface.lrduPath !== null), true);
assert.equal(model.surfaces.every((surface) => surface.towerPaths.length > 0), true);
assert.equal(model.surfaces.every((surface) => surface.cornerArmWheelPath !== null), true);
assert.equal(model.surfaces.every((surface) => surface.cornerArmOverhangEndPath !== null), true);
assert.equal(model.surfaces.every((surface) => surface.safetyZoneMeters === 4.572), true);
assert.equal(model.surfaces.every((surface) => surface.pathBoundaryShortfalls.some((shortfall) => shortfall.kind === "lrdu")), true);
assert.equal(model.surfaces.every((surface) => surface.pathBoundaryShortfalls.some((shortfall) => shortfall.kind === "end_gun_reach")), true);
assert.equal(model.surfaces.every((surface) => surface.pathBoundaryShortfalls.every((shortfall) => shortfall.canonicalGeometryMutation === false)), true);
assert.ok(model.surfaces.flatMap((surface) => surface.pathBoundaryShortfalls).some((shortfall) => shortfall.minimumShortfallMeters > 0));
assert.ok(model.acreLedger.standardPivotAcres > 0);
assert.ok(model.acreLedger.endGunAcres > 0);
assert.ok(model.acreLedger.cornerArmAcres > 0);
assert.ok(model.acreLedger.deduplicatedTotalAcres > 0);
assert.ok(model.acreLedger.overlapAcres >= 0);
assert.ok(model.acreLedger.verifiedBlockedAcres > 0);
assert.equal(model.warnings.some((warning) => warning.includes("End-gun wet annulus")), true);
assert.equal(model.warnings.some((warning) => warning.includes("Internal machine-zone edges")), true);
assert.equal(JSON.stringify(project), before);

const customSafetyModel = buildAdvisoryMachineRenderModel(project, { safetyZoneMeters: 9 });
assert.equal(customSafetyModel.surfaces.every((surface) => surface.safetyZoneMeters === 9), true);

const insufficient = buildAdvisoryMachineRenderModel({
  ...project,
  mapFeatures: [{
    ...middleOutline,
    geometry: { type: "LineString", vertices: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
  }],
});
assert.equal(insufficient.status, "insufficient_evidence");
assert.equal(insufficient.instances.length, 0);
assert.equal(insufficient.blockers.length, 1);

console.log("advisory machine render model tests passed");

function circleOutline(center: XY, radius: number): XY[] {
  return Array.from({ length: 73 }, (_value, index) => {
    const angle = (index / 72) * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
}

function partialOutline(center: XY, radius: number, startDegrees: number, stopDegrees: number): XY[] {
  const span = 270;
  return Array.from({ length: 55 }, (_value, index) => {
    const angleDegrees = startDegrees + ((stopDegrees - startDegrees + 360) % 360 || span) * (index / 54);
    const angle = (angleDegrees * Math.PI) / 180;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
}
