import assert from "node:assert/strict";

import { defaultAppSettings, resolveReferenceOverlaySource, sampleProject, willRheaJasonHarmelinkExampleProject } from "@cplayout/core";
import { buildAdvisoryMachineRenderModel, evaluateLayout, planAdvisoryFieldPivots } from "@cplayout/geometry";
import { projectLayoutToWgs84FeatureCollection, projectWgs84Bounds, projectWgs84Center } from "./mapOverlayGeoJson";
import { buildWorkbenchStyle } from "./mapWorkbenchStyle";

const beforeProjectGeometry = JSON.stringify({
  fieldBoundary: sampleProject.fieldBoundary,
  obstacles: sampleProject.obstacles,
  pivotCenter: sampleProject.pivotCenter,
});
const result = evaluateLayout(sampleProject);
const featureCollection = projectLayoutToWgs84FeatureCollection(sampleProject, result);
const advisoryFieldPivotPlan = planAdvisoryFieldPivots(sampleProject, {
  gridDivisions: 6,
  maxMachines: 3,
  candidatePoolSize: 24,
  collisionBufferMeters: sampleProject.machine.machineClearanceBufferMeters,
});
const featureCollectionWithAdvisoryPlan = projectLayoutToWgs84FeatureCollection(sampleProject, result, [], advisoryFieldPivotPlan);
const bounds = projectWgs84Bounds(sampleProject);
const center = projectWgs84Center(sampleProject);
const projectWithMapFeature = {
  ...sampleProject,
  mapFeatures: [
    {
      id: "pipeline-a",
      name: "Pipeline A",
      kind: "underground_pipeline" as const,
      geometry: { type: "LineString" as const, vertices: sampleProject.fieldBoundary.slice(0, 2) },
      confidence: "imagery_digitized" as const,
    },
    {
      id: "corner-footprint-a",
      name: "Corner Footprint A",
      kind: "corner_swing_limit" as const,
      geometry: { type: "Polygon" as const, vertices: sampleProject.fieldBoundary.slice(0, 3) },
      confidence: "user_estimated" as const,
    },
    {
      id: "end-gun-circle-a",
      name: "End Gun Circle A",
      kind: "end_gun_arc" as const,
      geometry: { type: "Circle" as const, center: sampleProject.pivotCenter, radiusMeters: 24 },
      confidence: "user_estimated" as const,
    },
    {
      id: "preferred-machine-outline-a",
      name: "Preferred Machine Outline A",
      kind: "machine_zone" as const,
      geometry: { type: "LineString" as const, vertices: sampleProject.fieldBoundary.slice(0, 4) },
      confidence: "imagery_digitized" as const,
      properties: {
        preferredMachineOutline: true,
        advisoryDesignRole: "preferred_machine_outline",
        canonicalGeometryMutation: false,
      },
    },
  ],
};
const featureCollectionWithMapFeature = projectLayoutToWgs84FeatureCollection(projectWithMapFeature, evaluateLayout(projectWithMapFeature));
const advisoryMachineRenderModel = buildAdvisoryMachineRenderModel(projectWithMapFeature, {
  featureIds: ["preferred-machine-outline-a"],
  includePublicVflexFallbackCornerArm: false,
});
const featureCollectionWithAdvisoryMachineRender = projectLayoutToWgs84FeatureCollection(
  projectWithMapFeature,
  evaluateLayout(projectWithMapFeature),
  [],
  undefined,
  advisoryMachineRenderModel,
);
const willRheaWithGeneratedCircle = {
  ...willRheaJasonHarmelinkExampleProject,
  mapFeatures: [
    ...(willRheaJasonHarmelinkExampleProject.mapFeatures ?? []),
    {
      id: "will-rhea-generated-lrdu-circle-test",
      name: "Generated LRDU Circle Test",
      kind: "machine_zone" as const,
      geometry: {
        type: "Circle" as const,
        center: willRheaJasonHarmelinkExampleProject.pivotCenter,
        radiusMeters: 462.9,
      },
      confidence: "imagery_digitized" as const,
      properties: {
        generatedFromImportedMeasurement: true,
        canonicalGeometryMutation: false,
      },
    },
  ],
};
const willRheaRenderModel = buildAdvisoryMachineRenderModel(willRheaWithGeneratedCircle, { maxInstances: 2 });
const willRheaFeatureCollectionWithReadyRender = projectLayoutToWgs84FeatureCollection(
  willRheaWithGeneratedCircle,
  evaluateLayout(willRheaWithGeneratedCircle),
  [],
  undefined,
  willRheaRenderModel,
);
const projectWithCornerArm = {
  ...sampleProject,
  machine: {
    ...sampleProject.machine,
    cornerArm: {
      id: "corner-arm-map-overlay",
      name: "Corner arm map overlay",
      advisoryOnly: true as const,
      lengthMeters: 91,
      wheelTrackLengthMeters: 78,
      overhangLengthMeters: 13,
      metadataSource: "operator_supplied" as const,
      modelFamily: "single_span_lrdu_sdu" as const,
      guidanceType: "operator_supplied" as const,
      sequencingType: "operator_supplied" as const,
      orientation: "operator_supplied" as const,
      confidence: "user_estimated" as const,
      sourceRefs: [{
        sourceId: "SRC-TEST-CORNER-ARM",
        limit: "Synthetic advisory map overlay test source only.",
      }],
    },
  },
};
const featureCollectionWithCornerArm = projectLayoutToWgs84FeatureCollection(projectWithCornerArm, evaluateLayout(projectWithCornerArm));
const boundsWithMapFeature = projectWgs84Bounds(projectWithMapFeature);
const settings = defaultAppSettings();
const workbenchStyleWithAdvisoryPlan = buildWorkbenchStyle(
  null,
  featureCollectionWithAdvisoryPlan,
  resolveReferenceOverlaySource({
    preferences: { ...settings.referenceOverlay, mode: "off" },
    mapPackages: [],
    target: "web_maplibre_gl_js",
  }),
  { ...settings.referenceOverlay, mode: "off" },
);
const workbenchStyleWithAdvisoryMachineRender = buildWorkbenchStyle(
  null,
  featureCollectionWithAdvisoryMachineRender,
  resolveReferenceOverlaySource({
    preferences: { ...settings.referenceOverlay, mode: "off" },
    mapPackages: [],
    target: "web_maplibre_gl_js",
  }),
  { ...settings.referenceOverlay, mode: "off" },
);

assert.equal(featureCollection.type, "FeatureCollection");
assert.ok(featureCollection.features.some((feature) => feature.properties.layerType === "field_boundary"));
assert.ok(featureCollection.features.some((feature) => feature.properties.layerType === "wheel_track_path" && feature.properties.renderOnly === true && feature.properties.canonicalGeometryMutation === false));
assert.ok(featureCollection.features.some((feature) => feature.properties.layerType === "end_machine_path" && feature.properties.renderOnly === true && feature.properties.canonicalGeometryMutation === false));
assert.ok(featureCollection.features.some((feature) => feature.properties.layerType === "wheel_track_path" && feature.properties.advisoryOnly === true));
assert.ok(featureCollection.features.some((feature) => feature.properties.layerType === "wheel_track_path" && feature.geometry.type === "LineString" && feature.properties.centerline === true));
assert.ok(featureCollection.features.some((feature) => feature.properties.layerType === "end_machine_path" && feature.geometry.type === "LineString" && feature.properties.centerline === true));
assert.ok(featureCollectionWithCornerArm.features.some((feature) => feature.properties.layerType === "corner_arm_wheel_track_path" && feature.properties.advisoryOnly === true && feature.properties.canonicalGeometryMutation === false));
assert.ok(featureCollectionWithCornerArm.features.some((feature) => feature.properties.layerType === "corner_arm_overhang_end_path" && feature.properties.wheelOverhangSeparationVerified === true));
assert.ok(featureCollectionWithCornerArm.features.some((feature) => feature.properties.layerType === "corner_arm_wheel_track_path" && feature.properties.radiusMeters === lrduAnchorRadius(projectWithCornerArm) + 78));
assert.ok(featureCollectionWithCornerArm.features.some((feature) => feature.properties.layerType === "corner_arm_overhang_end_path" && feature.properties.radiusMeters === lrduAnchorRadius(projectWithCornerArm) + 91));
assert.ok(featureCollectionWithCornerArm.features.some((feature) => (
  feature.properties.layerType === "corner_arm_overhang_end_path"
  && feature.properties.anchorRadiusMeters === lrduAnchorRadius(projectWithCornerArm)
  && feature.properties.pathModel === "max_extension_envelope"
  && feature.properties.modelFamily === "single_span_lrdu_sdu"
  && feature.properties.extensionEvidenceSource === "none"
  && Number(feature.properties.sampledPathPointCount) > 0
  && feature.properties.maxExtensionMeters === 91
  && feature.properties.extensionSlopeDomain === "angle_degrees"
)));
assert.ok(featureCollectionWithAdvisoryPlan.features.some((feature) => feature.properties.layerType === "advisory_generated_field_pivot_coverage" && feature.properties.canonicalGeometryMutation === false));
assert.ok(featureCollectionWithAdvisoryPlan.features.some((feature) => feature.properties.layerType === "advisory_generated_field_pivot_center" && feature.properties.advisoryOnly === true));
assert.ok(workbenchStyleWithAdvisoryPlan.layers.some((layer) => layer.id === "advisory-generated-field-pivot-fill"));
assert.ok(workbenchStyleWithAdvisoryPlan.layers.some((layer) => layer.id === "advisory-generated-field-pivot-center"));
assert.equal(workbenchStyleWithAdvisoryPlan.layers.some((layer) => layer.id === "wheel-track-fill"), false);
assert.ok(workbenchStyleWithAdvisoryPlan.layers.some((layer) => layer.id === "wheel-track-line"));
assert.equal(workbenchStyleWithAdvisoryPlan.layers.some((layer) => layer.id === "end-machine-path-fill"), false);
assert.ok(workbenchStyleWithAdvisoryPlan.layers.some((layer) => layer.id === "end-machine-path-line"));
assert.ok(featureCollectionWithAdvisoryMachineRender.features.some((feature) => feature.properties.layerType === "advisory_machine_preferred_outline" && feature.geometry.type === "LineString"));
assert.ok(featureCollectionWithAdvisoryMachineRender.features.some((feature) => feature.properties.layerType === "advisory_machine_standard_coverage" && feature.properties.renderOnly === true && feature.properties.canonicalGeometryMutation === false));
assert.ok(featureCollectionWithAdvisoryMachineRender.features.some((feature) => feature.properties.layerType === "advisory_machine_end_gun_annulus" && feature.properties.endGunAcres !== undefined));
assert.ok(featureCollectionWithAdvisoryMachineRender.features.some((feature) => feature.properties.layerType === "advisory_machine_physical_envelope" && feature.properties.advisoryOnly === true));
assert.ok(featureCollectionWithAdvisoryMachineRender.features.some((feature) => feature.properties.layerType === "advisory_machine_lrdu_path" && feature.geometry.type === "LineString" && feature.properties.centerline === true));
assert.ok(featureCollectionWithAdvisoryMachineRender.features.some((feature) => feature.properties.layerType === "advisory_machine_lrdu_path_outside_field" && feature.geometry.type === "MultiPolygon" && feature.properties.warningEnvelope === true));
assert.ok(workbenchStyleWithAdvisoryMachineRender.layers.some((layer) => layer.id === "advisory-machine-preferred-outline-line"));
assert.ok(workbenchStyleWithAdvisoryMachineRender.layers.some((layer) => layer.id === "advisory-machine-pivot-center"));
assert.equal(willRheaRenderModel.status, "ready");
assert.equal(willRheaRenderModel.instances.length, 2);
assert.equal(willRheaFeatureCollectionWithReadyRender.features.some((feature) => feature.properties.layerType === "allowed_coverage"), false);
assert.equal(willRheaFeatureCollectionWithReadyRender.features.some((feature) => (
  (feature.properties.layerType === "wheel_track_path" || feature.properties.layerType === "combined_last_wheel_machine_end_path")
  && feature.properties.designLayer === "derived_machine_path"
  && feature.properties.provenance === "canonical_machine_specification"
)), true);
assert.equal(willRheaFeatureCollectionWithReadyRender.features.some((feature) => feature.properties.layerType === "tower_location"), true);
assert.equal(willRheaFeatureCollectionWithReadyRender.features.some((feature) => feature.properties.layerType === "corner_arm_wheel_track_path"), false);
assert.equal(willRheaFeatureCollectionWithReadyRender.features.some((feature) => feature.properties.id === "will-rhea-generated-lrdu-circle-test"), false);
assert.equal(willRheaFeatureCollectionWithReadyRender.features.some((feature) => feature.properties.id === "will-rhea-lrdu-distance" && feature.properties.kind === "measurement_line"), true);
assert.equal(willRheaFeatureCollectionWithReadyRender.features.some((feature) => feature.properties.layerType === "advisory_machine_lrdu_path"), true);
assert.ok(buildWorkbenchStyle(
  null,
  featureCollectionWithCornerArm,
  resolveReferenceOverlaySource({
    preferences: { ...settings.referenceOverlay, mode: "off" },
    mapPackages: [],
    target: "web_maplibre_gl_js",
  }),
  { ...settings.referenceOverlay, mode: "off" },
).layers.some((layer) => layer.id === "corner-arm-wheel-track-line"));
assert.ok(featureCollectionWithMapFeature.features.some((feature) => feature.properties.layerType === "map_feature" && feature.properties.name === "Pipeline A"));
assert.ok(featureCollectionWithMapFeature.features.some((feature) => feature.properties.layerType === "map_feature" && feature.properties.name === "Corner Footprint A" && feature.geometry.type === "MultiPolygon"));
assert.ok(featureCollectionWithMapFeature.features.some((feature) => feature.properties.layerType === "map_feature" && feature.properties.name === "End Gun Circle A" && feature.geometry.type === "MultiPolygon"));
assert.ok(featureCollectionWithMapFeature.features.some((feature) => (
  feature.properties.layerType === "map_feature"
  && feature.properties.id === "preferred-machine-outline-a"
  && feature.properties.preferredMachineOutline === true
  && feature.properties.canonicalGeometryMutation === false
)));
const mapFeaturePointLayer = workbenchStyleWithAdvisoryMachineRender.layers.find((layer) => layer.id === "map-feature-point");
assert.deepEqual(mapFeaturePointLayer && "filter" in mapFeaturePointLayer ? mapFeaturePointLayer.filter : undefined, ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "layerType"], "map_feature"]]);
assert.ok(bounds.every((value) => Number.isFinite(value)));
assert.ok(boundsWithMapFeature.every((value) => Number.isFinite(value)));
assert.ok(center.every((value) => Number.isFinite(value)));
assert.equal(JSON.stringify({
  fieldBoundary: sampleProject.fieldBoundary,
  obstacles: sampleProject.obstacles,
  pivotCenter: sampleProject.pivotCenter,
}), beforeProjectGeometry);

console.log("map overlay GeoJSON tests passed");

function lrduAnchorRadius(project: typeof projectWithCornerArm): number {
  return project.machine.spanLengthsMeters.reduce((sum, span) => sum + span, 0);
}
