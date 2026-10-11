import assert from "node:assert/strict";

import type { MultiPolygonXY, PivotProject, ProjectMapFeature, XY } from "@cplayout/core";
import { squareMetersToAcres, willRheaJasonHarmelinkExampleProject } from "@cplayout/core";

import { buildAdvisoryMachineRenderModel } from "./advisoryMachineRenderModel";
import { multiPolygonAreaSquareMeters } from "./geometry";

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
assert.equal(insufficient.acreLedger.netAddedCornerAcres, 0);
assert.equal(insufficient.acreLedger.interMachineOverlapFootprintAcres, 0);

const willRheaBefore = JSON.stringify(willRheaJasonHarmelinkExampleProject);
const disjointWillRhea = buildAdvisoryMachineRenderModel(willRheaJasonHarmelinkExampleProject);
const willRheaRawAcres = disjointWillRhea.surfaces.reduce((sum, surface) => (
  sum + squareMetersToAcres(multiPolygonAreaSquareMeters(surface.clippedWetCoverage))
), 0);
assert.equal(disjointWillRhea.instances.length, 2);
assert.equal(disjointWillRhea.acreLedger.standardPivotAcres, roundedAcres(willRheaRawAcres));
assert.equal(disjointWillRhea.acreLedger.deduplicatedTotalAcres, roundedAcres(willRheaRawAcres));
assert.equal(disjointWillRhea.acreLedger.overlapAcres, 0, "rounding must not create overlap for disjoint Will Rhea machines");
assert.equal(disjointWillRhea.acreLedger.interMachineOverlapFootprintAcres, 0);
assert.equal(disjointWillRhea.acreLedger.netAddedCornerAcres, 0);
assert.equal(JSON.stringify(willRheaJasonHarmelinkExampleProject), willRheaBefore);

const identicalOutlines = [0, 1, 2].map((index) => ledgerCircle(`identical-${index}`, 20));
const identicalProject = ledgerProject(identicalOutlines);
const identicalBefore = JSON.stringify(identicalProject);
const single = buildAdvisoryMachineRenderModel(identicalProject, { maxInstances: 1 });
const identicalPair = buildAdvisoryMachineRenderModel(identicalProject, { maxInstances: 2 });
const identicalTriple = buildAdvisoryMachineRenderModel(identicalProject, { maxInstances: 3 });
const singleRawAcres = squareMetersToAcres(multiPolygonAreaSquareMeters(single.surfaces[0].clippedWetCoverage));
assert.equal(single.acreLedger.interMachineOverlapFootprintAcres, 0);
assert.equal(identicalPair.acreLedger.deduplicatedTotalAcres, roundedAcres(singleRawAcres));
assert.equal(identicalPair.acreLedger.overlapAcres, roundedAcres(singleRawAcres));
assert.equal(identicalPair.acreLedger.interMachineOverlapFootprintAcres, roundedAcres(singleRawAcres));
assert.equal(identicalTriple.acreLedger.deduplicatedTotalAcres, roundedAcres(singleRawAcres));
assert.equal(identicalTriple.acreLedger.standardPivotAcres, roundedAcres(3 * singleRawAcres));
assert.equal(identicalTriple.acreLedger.overlapAcres, roundedAcres(2 * singleRawAcres));
assert.equal(identicalTriple.acreLedger.interMachineOverlapFootprintAcres, roundedAcres(singleRawAcres), "triple overlap footprint counts land once");
assert.equal(JSON.stringify(identicalProject), identicalBefore);

const cornerProject = ledgerProject([ledgerCircle("corner-only", 20)], true);
const corner = buildAdvisoryMachineRenderModel(cornerProject);
assert.ok(corner.acreLedger.netAddedCornerAcres! > 0);
assert.equal(corner.acreLedger.netAddedCornerAcres, corner.acreLedger.cornerArmAcres);
assert.equal(corner.acreLedger.interMachineOverlapFootprintAcres, 0);
const endGunCoversCorner = buildAdvisoryMachineRenderModel(cornerProject, { endGunThrowMeters: 20 });
assert.ok(endGunCoversCorner.acreLedger.cornerArmAcres > 0);
assert.equal(endGunCoversCorner.acreLedger.netAddedCornerAcres, 0, "existing end-gun coverage is part of the baseline");
assert.ok(endGunCoversCorner.acreLedger.overlapAcres > 0);
assert.equal(endGunCoversCorner.acreLedger.interMachineOverlapFootprintAcres, 0, "component overlap is not inter-machine overlap");

// The larger base covers the whole field; the small machine's corner adds no new land.
const containedProject: PivotProject = {
  ...ledgerProject([ledgerCircle("small", 20), ledgerCircle("large", 100)], true),
  fieldBoundary: [{ x: -70, y: -70 }, { x: 70, y: -70 }, { x: 70, y: 70 }, { x: -70, y: 70 }],
};
const contained = buildAdvisoryMachineRenderModel(containedProject);
assert.ok(contained.surfaces.find((surface) => surface.label === "small")!.cornerArmAcres > 0);
assert.equal(contained.surfaces.find((surface) => surface.label === "large")!.cornerArmAcres, 0);
assert.equal(contained.acreLedger.netAddedCornerAcres, 0);
assert.equal(contained.acreLedger.deduplicatedTotalAcres, roundedAcres(squareMetersToAcres(140 * 140)));
assert.equal(contained.acreLedger.interMachineOverlapFootprintAcres, contained.surfaces[0].wetCoverageAcres);
assert.deepEqual(buildAdvisoryMachineRenderModel({
  ...containedProject,
  mapFeatures: [...containedProject.mapFeatures!].reverse(),
}).acreLedger, contained.acreLedger);

const cornerExclusion = {
  ...noSpray,
  polygon: [{ x: 22, y: -2 }, { x: 26, y: -2 }, { x: 26, y: 2 }, { x: 22, y: 2 }],
};
const excludedProject: PivotProject = { ...cornerProject, obstacles: [cornerExclusion] };
const excludedBefore = JSON.stringify(excludedProject);
const excludedCorner = buildAdvisoryMachineRenderModel(excludedProject);
const rawCornerAcres = squareMetersToAcres(multiPolygonAreaSquareMeters(corner.surfaces[0].cornerArmCoverage));
assert.equal(excludedCorner.acreLedger.netAddedCornerAcres, roundedAcres(rawCornerAcres - squareMetersToAcres(16)));
assert.equal(excludedCorner.acreLedger.verifiedBlockedAcres, roundedAcres(squareMetersToAcres(16)));
assert.equal(JSON.stringify(excludedProject), excludedBefore);
const excludedPair = buildAdvisoryMachineRenderModel({
  ...excludedProject,
  mapFeatures: [ledgerCircle("excluded-a", 20), ledgerCircle("excluded-b", 20)],
});
assert.equal(excludedPair.acreLedger.netAddedCornerAcres, excludedCorner.acreLedger.netAddedCornerAcres);
assert.equal(excludedPair.acreLedger.interMachineOverlapFootprintAcres, excludedCorner.acreLedger.deduplicatedTotalAcres);
const hardOnly = buildAdvisoryMachineRenderModel({ ...cornerProject, obstacles: [{ ...cornerExclusion, noSpray: false }] });
assert.deepEqual(hardOnly.acreLedger, corner.acreLedger, "hard-conflict-only obstacles do not subtract irrigation coverage");

const tinyExclusion = { ...noSpray, polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
const tinyExcludedTriple = buildAdvisoryMachineRenderModel({ ...identicalProject, obstacles: [tinyExclusion] }, { maxInstances: 3 });
assert.equal(tinyExcludedTriple.surfaces.every((surface) => surface.verifiedBlockedAcres === 0), true);
assert.equal(tinyExcludedTriple.acreLedger.verifiedBlockedAcres, roundedAcres(squareMetersToAcres(3)), "aggregate exclusion acres before rounding each surface");

const fullyExcluded = buildAdvisoryMachineRenderModel({
  ...identicalProject,
  obstacles: [{ ...noSpray, polygon: identicalProject.fieldBoundary }],
}, { maxInstances: 3 });
assert.equal(fullyExcluded.acreLedger.deduplicatedTotalAcres, 0);
assert.equal(fullyExcluded.acreLedger.netAddedCornerAcres, 0);
assert.equal(fullyExcluded.acreLedger.interMachineOverlapFootprintAcres, 0);
assert.equal(fullyExcluded.acreLedger.overlapAcres, 0);

const variedOutlines = [ledgerCircle("varied-a", 20), ledgerCircle("varied-b", 25, { x: 20, y: 0 }), ledgerCircle("varied-c", 30, { x: 10, y: 20 })];
const variedProject = { ...ledgerProject(variedOutlines), obstacles: [cornerExclusion] };
const variedBefore = JSON.stringify(variedProject);
const varied = buildAdvisoryMachineRenderModel(variedProject, { maxInstances: 3, endGunThrowMeters: 5 });
for (const mapFeatures of [[variedOutlines[2], variedOutlines[1], variedOutlines[0]], [variedOutlines[1], variedOutlines[2], variedOutlines[0]]]) {
  const reordered = buildAdvisoryMachineRenderModel({ ...variedProject, mapFeatures }, { maxInstances: 3, endGunThrowMeters: 5 });
  assert.deepEqual(reordered.acreLedger, varied.acreLedger, "ledger is independent of machine order");
}
assert.equal(JSON.stringify(variedProject), variedBefore);

// Regression: intersecting these buffered corner envelopes previously threw an
// incomplete-output-ring error. The wet-area oracle below uses circle distances,
// independently of either polygon clipping implementation.
const overlappingCorners = { ...ledgerProject(variedOutlines, true), obstacles: [cornerExclusion] };
const overlappingBefore = JSON.stringify(overlappingCorners);
const overlappingOptions = { maxInstances: 3, endGunThrowMeters: 5 };
const overlapping = buildAdvisoryMachineRenderModel(overlappingCorners, overlappingOptions);
assert.equal(overlapping.status, "ready");
assert.equal(overlapping.conflicts.length, 3);
assert.equal(JSON.stringify(overlappingCorners), overlappingBefore);
for (const conflict of overlapping.conflicts) {
  const left = overlapping.surfaces.find(surface => surface.instanceId === conflict.leftInstanceId)!;
  const right = overlapping.surfaces.find(surface => surface.instanceId === conflict.rightInstanceId)!;
  const area = multiPolygonAreaSquareMeters(conflict.collisionZone);
  assert.ok(area > 0);
  assert.ok(area <= Math.min(multiPolygonAreaSquareMeters(left.mechanicalEnvelope), multiPolygonAreaSquareMeters(right.mechanicalEnvelope)) + 1e-8);
  assert.equal(conflict.qualifiedReviewRequired, true);
}
const reversedCorners = buildAdvisoryMachineRenderModel({
  ...overlappingCorners, mapFeatures: [...variedOutlines].reverse(),
}, overlappingOptions);
assert.deepEqual(reversedCorners.acreLedger, overlapping.acreLedger);
const conflictAreas = (result: typeof overlapping) => Object.fromEntries(result.conflicts.map(c => [
  [c.leftInstanceId, c.rightInstanceId].sort().join("|"), multiPolygonAreaSquareMeters(c.collisionZone),
]));
const forwardAreas = conflictAreas(overlapping);
assert.deepEqual(Object.keys(conflictAreas(reversedCorners)).sort(), Object.keys(forwardAreas).sort());
for (const [pair, area] of Object.entries(conflictAreas(reversedCorners))) {
  assert.ok(Math.abs(area - forwardAreas[pair]) < 1e-8, `${pair} preserves its own intersection area`);
}
const failingPair = overlapping.conflicts.find(c => [c.leftInstanceId, c.rightInstanceId].every(id => /varied-[ab]/.test(id)))!;
assert.ok(failingPair);
// Integrate the input envelopes independently: the repaired closing buffers
// legitimately change the old captured-input area of 1969.7399403769446 m2.
const pairInputs = [failingPair.leftInstanceId, failingPair.rightInstanceId].map(id =>
  overlapping.surfaces.find(surface => surface.instanceId === id)!.mechanicalEnvelope);
const integratedArea = intersectionAreaByVerticalSlices(pairInputs[0], pairInputs[1]);
assert.ok(Math.abs(multiPolygonAreaSquareMeters(failingPair.collisionZone) - integratedArea) < 1e-7,
  `collision area must match independent input-envelope integration: ${integratedArea}`);

const translatedCorners: PivotProject = structuredClone(overlappingCorners);
const translate = ({ x, y }: XY): XY => ({ x: x + 500000, y: y + 4400000 });
translatedCorners.fieldBoundary = translatedCorners.fieldBoundary.map(translate);
translatedCorners.pivotCenter = translate(translatedCorners.pivotCenter);
translatedCorners.waterSource = translate(translatedCorners.waterSource);
translatedCorners.powerSource = translate(translatedCorners.powerSource);
translatedCorners.obstacles = translatedCorners.obstacles.map(o => ({ ...o, polygon: o.polygon.map(translate) }));
translatedCorners.mapFeatures = translatedCorners.mapFeatures!.map(feature => {
  assert.equal(feature.geometry.type, "LineString");
  return { ...feature, geometry: { type: "LineString", vertices: (feature.geometry as { vertices: XY[] }).vertices.map(translate) } };
});
const translated = buildAdvisoryMachineRenderModel(translatedCorners, overlappingOptions);
assert.deepEqual(translated.acreLedger, overlapping.acreLedger, "UTM-sized offsets preserve displayed coverage");
translated.conflicts.forEach((conflict, index) => assert.ok(
  Math.abs(conflict.collisionZoneAcres - overlapping.conflicts[index].collisionZoneAcres) < 1e-8,
  "unrounded collision area is translation invariant within numerical precision"));
assert.deepEqual(Object.keys(conflictAreas(translated)).sort(), Object.keys(forwardAreas).sort());
for (const [pair, area] of Object.entries(conflictAreas(translated))) {
  assert.ok(Math.abs(area - forwardAreas[pair]) < 1e-5, `${pair} preserves geometric area after projected translation`);
}

let oracleWet = 0;
let oracleShared = 0;
let oracleCorner = 0;
const cells = 0.25;
for (let x = -40 + cells / 2; x < 60; x += cells) {
  for (let y = -40 + cells / 2; y < 60; y += cells) {
    if (x > 22 && x < 26 && y > -2 && y < 2) continue;
    const distances = [Math.hypot(x, y), Math.hypot(x - 20, y), Math.hypot(x - 10, y - 20)];
    const count = distances.filter((d, index) => d < [30, 35, 40][index]).length;
    const baselineCovered = distances.some((d, index) => d < [25, 30, 35][index]);
    if (count > 0) oracleWet += cells * cells;
    if (count > 1) oracleShared += cells * cells;
    if (count > 0 && !baselineCovered) oracleCorner += cells * cells;
  }
}
for (const [actual, expected] of [
  [overlapping.acreLedger.deduplicatedTotalAcres, oracleWet],
  [overlapping.acreLedger.interMachineOverlapFootprintAcres!, oracleShared],
  [overlapping.acreLedger.netAddedCornerAcres!, oracleCorner],
]) {
  assert.ok(Math.abs(actual - squareMetersToAcres(expected)) < 0.003, "circle-grid oracle within polygon and raster discretization allowance");
}

console.log("advisory machine render model tests passed");

function roundedAcres(acres: number): number {
  return Number(acres.toFixed(3));
}

function ledgerCircle(id: string, radius: number, center: XY = { x: 0, y: 0 }): ProjectMapFeature {
  return {
    ...southOutline,
    id,
    name: id,
    geometry: { type: "LineString", vertices: circleOutline(center, radius) },
  };
}

function ledgerProject(mapFeatures: ProjectMapFeature[], withCorner = false): PivotProject {
  return {
    ...project,
    fieldBoundary: [{ x: -200, y: -200 }, { x: 200, y: -200 }, { x: 200, y: 200 }, { x: -200, y: 200 }],
    pivotCenter: { x: 0, y: 0 },
    obstacles: [],
    mapFeatures,
    machine: {
      ...project.machine,
      cornerArm: withCorner ? {
        id: "synthetic-ledger-corner",
        name: "Synthetic ledger corner",
        advisoryOnly: true,
        lengthMeters: 10,
        wheelTrackLengthMeters: 8,
        overhangLengthMeters: 2,
        guidanceType: "operator_supplied",
        sequencingType: "operator_supplied",
        orientation: "operator_supplied",
        confidence: "user_estimated",
        sourceRefs: [{ sourceId: "SYNTHETIC-LEDGER-TEST", limit: "Synthetic arithmetic fixture, not vendor equipment parameters." }],
      } : undefined,
    },
  };
}

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

// Between vertex and crossing X coordinates, vertical overlap length is linear.
// Integrate that length without invoking either polygon overlay implementation.
function intersectionAreaByVerticalSlices(left: MultiPolygonXY, right: MultiPolygonXY): number {
  if (left.length === 0 || right.length === 0) return 0;
  const origin = left[0][0][0];
  const local = (shape: MultiPolygonXY) => shape.map(polygon => polygon.map(ring =>
    ring.map(point => ({ x: point.x - origin.x, y: point.y - origin.y }))));
  const a = local(left), b = local(right);
  const edges = (shape: MultiPolygonXY): Array<[XY, XY]> => shape.flatMap(polygon => polygon.flatMap(ring =>
    ring.map((point, index): [XY, XY] => [point, ring[(index + 1) % ring.length]])));
  const ae = edges(a), be = edges(b);
  const ys = [...ae, ...be].flatMap(([start, end]) => [start.y, end.y]);
  const height = Math.max(...ys) - Math.min(...ys);
  const xs = new Set([...ae, ...be].flatMap(([start, end]) => [start.x, end.x]));
  for (const [p, q] of ae) for (const [r, s] of be) {
    const dx = q.x - p.x, dy = q.y - p.y, ex = s.x - r.x, ey = s.y - r.y;
    const denominator = dx * ey - dy * ex;
    if (denominator === 0) continue;
    const t = ((r.x - p.x) * ey - (r.y - p.y) * ex) / denominator;
    const u = ((r.x - p.x) * dy - (r.y - p.y) * dx) / denominator;
    if (t > 0 && t < 1 && u > 0 && u < 1) xs.add(p.x + t * dx);
  }
  const intervals = (shape: MultiPolygonXY, x: number): Array<[number, number]> => {
    const spans: Array<[number, number]> = [];
    for (const polygon of shape) {
      const ys = edges([polygon]).flatMap(([p, q]) =>
        x > Math.min(p.x, q.x) && x < Math.max(p.x, q.x) ? [p.y + (x - p.x) * (q.y - p.y) / (q.x - p.x)] : []).sort((a, b) => a - b);
      assert.equal(ys.length % 2, 0, "valid rings have paired crossings away from vertex partitions");
      for (let index = 0; index < ys.length; index += 2) spans.push([ys[index], ys[index + 1]]);
    }
    const merged: Array<[number, number]> = [];
    for (const span of spans.sort((a, b) => a[0] - b[0])) {
      const last = merged.at(-1);
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else merged.push([...span]);
    }
    return merged;
  };
  const length = (x: number): number => {
    const leftSpans = intervals(a, x), rightSpans = intervals(b, x);
    let i = 0, j = 0, sum = 0;
    while (i < leftSpans.length && j < rightSpans.length) {
      const l = leftSpans[i], r = rightSpans[j];
      sum += Math.max(0, Math.min(l[1], r[1]) - Math.max(l[0], r[0]));
      if (l[1] < r[1]) i++; else j++;
    }
    return sum;
  };
  const knots = [...xs].sort((a, b) => a - b);
  let area = 0;
  let omittedAreaBound = 0;
  for (let i = 1; i < knots.length; i++) {
    const width = knots[i] - knots[i - 1];
    const x1 = knots[i - 1] + width / 3, x2 = knots[i - 1] + width * 2 / 3;
    if (x1 === knots[i - 1] || x2 === knots[i]) {
      omittedAreaBound += width * height;
      continue;
    }
    area += width * (length(x1) + length(x2)) / 2;
  }
  assert.ok(omittedAreaBound < 1e-8, "unrepresentable strips must stay below the oracle error allowance");
  return area;
}

const oracleRectangle = (x0: number, y0: number, x1: number, y1: number): XY[] =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const oracleDonut: MultiPolygonXY = [[oracleRectangle(0, 0, 10, 10), oracleRectangle(2, 2, 8, 8).reverse()]];
assert.equal(intersectionAreaByVerticalSlices([], oracleDonut), 0);
assert.equal(intersectionAreaByVerticalSlices(oracleDonut, [[oracleRectangle(5, 0, 15, 10)]]), 32);
assert.equal(intersectionAreaByVerticalSlices(oracleDonut, [[oracleRectangle(20, 0, 30, 10)]]), 0);
assert.equal(intersectionAreaByVerticalSlices([
  ...oracleDonut, ...oracleDonut.map(polygon => polygon.map(ring => ring.map(point => ({ ...point, x: point.x + 20 })))),
], [[oracleRectangle(5, 0, 25, 10)]]), 64);
assert.equal(intersectionAreaByVerticalSlices([[ [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] ]],
  [[ [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] ]]), 25);
const slopeEpsilon = 1e-6;
assert.ok(Math.abs(intersectionAreaByVerticalSlices(
  [[[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1 + slopeEpsilon }, { x: 0, y: 1 }]]],
  [[[{ x: 0, y: 1 + slopeEpsilon / 2 }, { x: 10, y: 1 - slopeEpsilon / 2 }, { x: 10, y: 2 }, { x: 0, y: 2 }]]],
) - 5.625 * slopeEpsilon) < 1e-12, "near-parallel crossing retains its analytic triangular overlap");
console.log(`Independent repaired collision intersection area: ${integratedArea} m2`);

// Field clipping must not hide a physical intersection wholly beyond the field.
const outsideCollisionProject: PivotProject = {
  ...ledgerProject([ledgerCircle("outside-a", 20, { x: 0, y: 50 }), ledgerCircle("outside-b", 20, { x: 30, y: 50 })]),
  fieldBoundary: [{ x: -100, y: -100 }, { x: 100, y: -100 }, { x: 100, y: 0 }, { x: -100, y: 0 }],
};
const outsideCollision = buildAdvisoryMachineRenderModel(outsideCollisionProject);
assert.equal(outsideCollision.surfaces.every(surface => surface.physicalEnvelope.length === 0), true);
assert.equal(outsideCollision.conflicts.length, 1);
assert.ok(outsideCollision.conflicts[0].collisionZoneAcres > 0);

// A shallow lens (< 0.001 acre) still requires collision review. Buffer is 5 m.
const smallCollision = buildAdvisoryMachineRenderModel(ledgerProject([
  ledgerCircle("tiny-a", 20), ledgerCircle("tiny-b", 20, { x: 49.98, y: 0 }),
]));
assert.equal(smallCollision.conflicts.length, 1);
assert.ok(smallCollision.conflicts[0].collisionZoneAcres > 0);
assert.ok(smallCollision.conflicts[0].collisionZoneAcres < 0.001);
