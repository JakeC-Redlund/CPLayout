import { projectXyToLonLat, type LayoutResult, type PivotProject, type ProjectMapFeature, type XY } from "@cplayout/core";
import {
  buildLayoutPathOverlays,
  type AdvisoryFieldPivotPlan,
  type AdvisoryMachineRenderModel,
  type AdvisoryMachineRenderSurface,
  type LayoutPathOverlay,
} from "@cplayout/geometry";

type GeoJsonFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: GeoJsonGeometry;
};

type GeoJsonGeometry =
  | { type: "MultiPolygon"; coordinates: [number, number][][][] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "Point"; coordinates: [number, number] };

export function projectLayoutToWgs84FeatureCollection(
  project: PivotProject,
  result: LayoutResult,
  draftVertices: XY[] = [],
  advisoryFieldPivotPlan?: AdvisoryFieldPivotPlan,
  advisoryMachineRenderModel?: AdvisoryMachineRenderModel,
): { type: "FeatureCollection"; features: GeoJsonFeature[] } {
  const advisoryFieldPivotFeatures = advisoryFieldPivotPlan && advisoryFieldPivotPlan.selectedMachineCount > 0
    ? [
      polygonFeature(project, "advisory_generated_field_pivot_coverage", advisoryFieldPivotPlan.modeledCoverageUnion, {
        advisoryOnly: true,
        canonicalGeometryMutation: false,
        qualifiedReviewRequired: true,
        requestedMachineCount: advisoryFieldPivotPlan.requestedMachineCount,
        selectedMachineCount: advisoryFieldPivotPlan.selectedMachineCount,
        fieldCoveragePercent: advisoryFieldPivotPlan.fieldCoveragePercent,
        modeledIrrigatedUnionAcres: advisoryFieldPivotPlan.modeledIrrigatedUnionAcres,
      }),
      ...advisoryFieldPivotPlan.candidates.map((candidate) => pointFeature(project, "advisory_generated_field_pivot_center", candidate.pivotCenter, {
        id: candidate.id,
        sequence: candidate.sequence,
        advisoryOnly: true,
        canonicalGeometryMutation: false,
        qualifiedReviewRequired: true,
        incrementalIrrigatedAcres: candidate.incrementalIrrigatedAcres,
        cumulativeFieldCoveragePercent: candidate.cumulativeFieldCoveragePercent,
        minimumRequiredSeparationMeters: candidate.minimumRequiredSeparationMeters,
      })),
    ]
    : [];
  const advisoryMachineRenderFeatures = advisoryMachineRenderModel
    ? advisoryMachineRenderModelFeatures(project, advisoryMachineRenderModel)
    : [];
  const readyTwoMachineAdvisoryRender = advisoryMachineRenderModel?.status === "ready"
    && advisoryMachineRenderModel.instances.length >= 2;
  const canonicalMachineLayersVisible = !readyTwoMachineAdvisoryRender;
  const layoutPathFeatures = buildLayoutPathOverlays(project).flatMap((overlay) => layoutPathOverlayFeatures(project, overlay));
  const visibleMapFeatures = readyTwoMachineAdvisoryRender
    ? (project.mapFeatures ?? []).filter((feature) => !isGeneratedMeasurementCircleFeature(feature))
    : (project.mapFeatures ?? []);
  return {
    type: "FeatureCollection",
    features: [
      polygonFeature(project, "field_boundary", [[project.fieldBoundary]], { name: "Field boundary" }),
      ...(canonicalMachineLayersVisible ? [
        polygonFeature(project, "allowed_coverage", result.allowedCoverage, { ...result.metrics }),
        polygonFeature(project, "outside_field_coverage", result.outsideFieldCoverage, { acres: result.metrics.outsideFieldAcres }),
        polygonFeature(project, "end_gun_coverage", result.endGunCoverage, { acres: result.metrics.endGunAcres }),
      ] : []),
      ...advisoryFieldPivotFeatures,
      ...advisoryMachineRenderFeatures,
      ...layoutPathFeatures,
      polygonFeature(project, "obstacle", result.obstacles, { count: project.obstacles.length }),
      pointFeature(project, "pivot_center", project.pivotCenter, { label: "Pivot" }),
      pointFeature(project, "water_source", project.waterSource, { label: "Water" }),
      pointFeature(project, "power_source", project.powerSource, { label: "Power" }),
      ...result.towers.map((tower) => pointFeature(project, "tower_location", tower.point, {
        towerIndex: tower.towerIndex,
        radiusMeters: tower.radiusMeters,
      })),
      ...visibleMapFeatures.map((feature) => {
        const properties = {
          ...feature.properties,
          id: feature.id,
          name: feature.name,
          kind: feature.kind,
          confidence: feature.confidence,
          notes: feature.notes ?? "",
        };
        if (feature.geometry.type === "Point") return pointFeature(project, "map_feature", feature.geometry.point, properties);
        if (feature.geometry.type === "LineString") return lineFeature(project, "map_feature", feature.geometry.vertices, properties);
        if (feature.geometry.type === "Polygon") return polygonFeature(project, "map_feature", [[feature.geometry.vertices]], properties);
        return polygonFeature(project, "map_feature", [[circleVertices(feature.geometry.center, feature.geometry.radiusMeters)]], {
          ...properties,
          mapFeatureGeometry: "Circle",
          radiusMeters: feature.geometry.radiusMeters,
        });
      }),
      ...(draftVertices.length === 1 ? [pointFeature(project, "draft_vertices", draftVertices[0], { count: 1 })] : []),
      ...(draftVertices.length >= 2 ? [lineFeature(project, "draft_vertices", draftVertices, { count: draftVertices.length })] : []),
    ],
  };
}

function isGeneratedMeasurementCircleFeature(feature: ProjectMapFeature): boolean {
  return feature.geometry.type === "Circle"
    && feature.properties?.generatedFromImportedMeasurement === true;
}

function advisoryMachineRenderModelFeatures(project: PivotProject, model: AdvisoryMachineRenderModel): GeoJsonFeature[] {
  const modelProperties = {
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    renderOnly: true,
    modelStatus: model.status,
    modelInstanceCount: model.instances.length,
    standardPivotAcres: model.acreLedger.standardPivotAcres,
    endGunAcres: model.acreLedger.endGunAcres,
    cornerArmAcres: model.acreLedger.cornerArmAcres,
    deduplicatedTotalAcres: model.acreLedger.deduplicatedTotalAcres,
    overlapAcres: model.acreLedger.overlapAcres,
    outsideFieldAcres: model.acreLedger.outsideFieldAcres,
    verifiedBlockedAcres: model.acreLedger.verifiedBlockedAcres,
  };
  return [
    ...model.surfaces.flatMap((surface) => advisoryMachineSurfaceFeatures(project, surface, modelProperties)),
    ...model.instances.map((instance) => pointFeature(project, "advisory_machine_pivot_center", instance.pivotCenter, {
      ...modelProperties,
      instanceId: instance.id,
      label: instance.label,
      sourceFeatureIds: instance.sourceFeatureIds,
      sweepMode: instance.sweep.mode,
      endGunThrowMeters: instance.machine.endGunThrowMeters,
    })),
    ...model.conflicts.map((conflict) => polygonFeature(project, "advisory_machine_collision_conflict", conflict.collisionZone, {
      ...modelProperties,
      id: conflict.id,
      leftInstanceId: conflict.leftInstanceId,
      rightInstanceId: conflict.rightInstanceId,
      status: conflict.status,
      severity: conflict.severity,
      collisionZoneAcres: conflict.collisionZoneAcres,
      operatorCollisionReviewRequired: conflict.operatorCollisionReviewRequired,
    })),
  ];
}

function advisoryMachineSurfaceFeatures(
  project: PivotProject,
  surface: AdvisoryMachineRenderSurface,
  modelProperties: Record<string, unknown>,
): GeoJsonFeature[] {
  const baseProperties = {
    ...modelProperties,
    instanceId: surface.instanceId,
    label: surface.label,
    sourceFeatureIds: surface.sourceFeatureIds,
    standardPivotAcres: surface.standardPivotAcres,
    endGunAcres: surface.endGunAcres,
    cornerArmAcres: surface.cornerArmAcres,
    wetCoverageAcres: surface.wetCoverageAcres,
    physicalEnvelopeAcres: surface.physicalEnvelopeAcres,
    outsideFieldWetAcres: surface.outsideFieldWetAcres,
    verifiedBlockedAcres: surface.verifiedBlockedAcres,
    safetyZoneMeters: surface.safetyZoneMeters,
    pathShortfallCount: surface.pathBoundaryShortfalls.filter((shortfall) => shortfall.minimumShortfallMeters > 0).length,
    warningCount: surface.warnings.length,
  };
  return [
    lineFeature(project, "advisory_machine_preferred_outline", surface.preferredOutlinePath, baseProperties),
    polygonFeature(project, "advisory_machine_standard_coverage", surface.standardPivotCoverage, baseProperties),
    polygonFeature(project, "advisory_machine_end_gun_annulus", surface.endGunWetAnnulus, baseProperties),
    polygonFeature(project, "advisory_machine_corner_arm_coverage", surface.cornerArmCoverage, baseProperties),
    polygonFeature(project, "advisory_machine_wet_coverage", surface.clippedWetCoverage, baseProperties),
    polygonFeature(project, "advisory_machine_physical_envelope", surface.physicalEnvelope, baseProperties),
    ...(surface.lrduPath ? advisoryMachinePathOverlayFeatures(project, "advisory_machine_lrdu_path", surface.lrduPath, baseProperties) : []),
    ...surface.towerPaths.flatMap((overlay) => advisoryMachinePathOverlayFeatures(project, "advisory_machine_tower_path", overlay, baseProperties)),
    ...(surface.cornerArmWheelPath ? advisoryMachinePathOverlayFeatures(project, "advisory_machine_corner_arm_wheel_path", surface.cornerArmWheelPath, baseProperties) : []),
    ...(surface.cornerArmOverhangEndPath ? advisoryMachinePathOverlayFeatures(project, "advisory_machine_corner_arm_overhang_end_path", surface.cornerArmOverhangEndPath, baseProperties) : []),
  ];
}

function advisoryMachinePathOverlayFeatures(
  project: PivotProject,
  layerType: string,
  overlay: LayoutPathOverlay,
  baseProperties: Record<string, unknown>,
): GeoJsonFeature[] {
  return [
    ...centerlineFeatures(project, layerType, overlay, {
      ...baseProperties,
      kind: overlay.kind,
      pathLabel: overlay.label,
      radiusMeters: overlay.radiusMeters,
      bufferMeters: overlay.bufferMeters,
      centerline: true,
      warningEnvelope: false,
      ...(overlay.towerIndex === undefined ? {} : { towerIndex: overlay.towerIndex }),
      ...(overlay.anchorRadiusMeters === undefined ? {} : { anchorRadiusMeters: overlay.anchorRadiusMeters }),
      ...(overlay.pathModel === undefined ? {} : { pathModel: overlay.pathModel }),
      ...(overlay.modelFamily === undefined ? {} : { modelFamily: overlay.modelFamily }),
      ...(overlay.sampledPathPointCount === undefined ? {} : { sampledPathPointCount: overlay.sampledPathPointCount }),
      ...(overlay.maxExtensionMeters === undefined ? {} : { maxExtensionMeters: overlay.maxExtensionMeters }),
    }),
    ...(overlay.outsideFieldEnvelope.length === 0 ? [] : [
      polygonFeature(project, `${layerType}_outside_field`, overlay.outsideFieldEnvelope, {
        ...baseProperties,
        kind: overlay.kind,
        pathLabel: overlay.label,
        radiusMeters: overlay.radiusMeters,
        bufferMeters: overlay.bufferMeters,
        centerline: false,
        warningEnvelope: true,
        warning: "Path envelope extends outside the field boundary.",
      }),
    ]),
  ];
}

function layoutPathOverlayFeatures(project: PivotProject, overlay: LayoutPathOverlay): GeoJsonFeature[] {
  const baseProperties = {
    kind: overlay.kind,
    label: overlay.label,
    radiusMeters: overlay.radiusMeters,
    bufferMeters: overlay.bufferMeters,
    advisoryOnly: overlay.advisoryOnly,
    renderOnly: true,
    canonicalGeometryMutation: false,
    designLayer: overlay.kind.startsWith("corner_arm") ? "advisory_proposal" : "derived_machine_path",
    machinePathRoles: overlay.machinePathRoles.join(","),
    coincidentPath: overlay.coincidentPath,
    provenance: overlay.kind.startsWith("corner_arm") ? "stored_or_explicit_preview" : "canonical_machine_specification",
    testId: `machine-path-${overlay.machinePathRoles.join("-")}-${overlay.towerIndex ?? "path"}`,
    ...(overlay.towerIndex === undefined ? {} : { towerIndex: overlay.towerIndex }),
    ...(overlay.evidenceFeatureIds === undefined ? {} : { evidenceFeatureIds: overlay.evidenceFeatureIds }),
    ...(overlay.wheelOverhangSeparationVerified === undefined ? {} : { wheelOverhangSeparationVerified: overlay.wheelOverhangSeparationVerified }),
    ...(overlay.anchorRadiusMeters === undefined ? {} : { anchorRadiusMeters: overlay.anchorRadiusMeters }),
    ...(overlay.pathModel === undefined ? {} : { pathModel: overlay.pathModel }),
    ...(overlay.modelFamily === undefined ? {} : { modelFamily: overlay.modelFamily }),
    ...(overlay.extensionEvidenceSource === undefined ? {} : { extensionEvidenceSource: overlay.extensionEvidenceSource }),
    ...(overlay.sampledPathPointCount === undefined ? {} : { sampledPathPointCount: overlay.sampledPathPointCount }),
    ...(overlay.maxExtensionMeters === undefined ? {} : { maxExtensionMeters: overlay.maxExtensionMeters }),
    ...(overlay.extensionSlopeDomain === undefined ? {} : { extensionSlopeDomain: overlay.extensionSlopeDomain }),
    ...(overlay.maxExtensionSlopeMetersPerDegree === undefined ? {} : { maxExtensionSlopeMetersPerDegree: overlay.maxExtensionSlopeMetersPerDegree }),
    ...(overlay.maxRetractionSlopeMetersPerDegree === undefined ? {} : { maxRetractionSlopeMetersPerDegree: overlay.maxRetractionSlopeMetersPerDegree }),
    ...(overlay.warnings === undefined ? {} : { warningCount: overlay.warnings.length }),
  };
  const insideLayer = layoutPathInsideLayerType(overlay);
  const outsideLayer = layoutPathOutsideLayerType(overlay);
  return [
    ...centerlineFeatures(project, insideLayer, overlay, {
      ...baseProperties,
      centerline: true,
      warningEnvelope: false,
      centerlineSegmentCount: overlay.centerlineSegments.length,
    }),
    ...(overlay.outsideFieldEnvelope.length === 0 ? [] : [polygonFeature(project, outsideLayer, overlay.outsideFieldEnvelope, {
      ...baseProperties,
      centerline: false,
      warningEnvelope: true,
      insideFieldEnvelope: false,
      outsideFieldEnvelope: true,
      warning: "Path envelope extends outside the field boundary.",
    })]),
  ];
}

function centerlineFeatures(
  project: PivotProject,
  layerType: string,
  overlay: LayoutPathOverlay,
  properties: Record<string, unknown>,
): GeoJsonFeature[] {
  return overlay.centerlineSegments
    .filter((segment) => segment.length >= 2)
    .map((segment, centerlineSegmentIndex) => lineFeature(project, layerType, segment, {
      ...properties,
      centerlineSegmentIndex,
    }));
}

function layoutPathInsideLayerType(overlay: LayoutPathOverlay): string {
  switch (overlay.kind) {
    case "wheel_track":
      return overlay.coincidentPath ? "combined_last_wheel_machine_end_path" : "wheel_track_path";
    case "end_of_machine":
      return "end_machine_path";
    case "end_gun_reach":
      return "end_gun_reach_path";
    case "corner_arm_wheel_track":
      return "corner_arm_wheel_track_path";
    case "corner_arm_overhang_end":
      return "corner_arm_overhang_end_path";
  }
}

function layoutPathOutsideLayerType(overlay: LayoutPathOverlay): string {
  switch (overlay.kind) {
    case "wheel_track":
      return overlay.coincidentPath ? "combined_last_wheel_machine_end_outside_field" : "wheel_track_outside_field";
    case "end_of_machine":
      return "end_machine_outside_field";
    case "end_gun_reach":
      return "end_gun_reach_outside_field";
    case "corner_arm_wheel_track":
      return "corner_arm_wheel_track_outside_field";
    case "corner_arm_overhang_end":
      return "corner_arm_overhang_end_outside_field";
  }
}

export function projectWgs84Bounds(project: PivotProject): [number, number, number, number] {
  const coordinates = [
    ...project.fieldBoundary,
    project.pivotCenter,
    project.waterSource,
    project.powerSource,
    ...project.obstacles.flatMap((obstacle) => obstacle.polygon),
    ...(project.mapFeatures ?? []).flatMap((feature) => {
      if (feature.geometry.type === "Point") return [feature.geometry.point];
      if (feature.geometry.type === "Circle") return [feature.geometry.center, ...circleVertices(feature.geometry.center, feature.geometry.radiusMeters, 16)];
      return feature.geometry.vertices;
    }),
  ].map((point) => projectXyToLonLat(point, project.projectCrs));
  const longitudes = coordinates.map((coordinate) => coordinate.longitude);
  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  return [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
}

export function projectWgs84Center(project: PivotProject): [number, number] {
  const center = projectXyToLonLat(project.pivotCenter, project.projectCrs);
  return [center.longitude, center.latitude];
}

function polygonFeature(
  project: PivotProject,
  layerType: string,
  multiPolygon: XY[][][],
  properties: Record<string, unknown>,
): GeoJsonFeature {
  return {
    type: "Feature",
    properties: { layerType, ...properties },
    geometry: {
      type: "MultiPolygon",
      coordinates: multiPolygon.map((polygon) => polygon.map((ring) => closedRing(ring).map((point) => lonLatTuple(project, point)))),
    },
  };
}

function lineFeature(project: PivotProject, layerType: string, vertices: XY[], properties: Record<string, unknown>): GeoJsonFeature {
  return {
    type: "Feature",
    properties: { layerType, ...properties },
    geometry: {
      type: "LineString",
      coordinates: vertices.map((point) => lonLatTuple(project, point)),
    },
  };
}

function pointFeature(project: PivotProject, layerType: string, point: XY, properties: Record<string, unknown>): GeoJsonFeature {
  return {
    type: "Feature",
    properties: { layerType, ...properties },
    geometry: {
      type: "Point",
      coordinates: lonLatTuple(project, point),
    },
  };
}

function lonLatTuple(project: PivotProject, point: XY): [number, number] {
  const coordinate = projectXyToLonLat(point, project.projectCrs);
  return [coordinate.longitude, coordinate.latitude];
}

function closedRing(ring: XY[]): XY[] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first.x === last.x && first.y === last.y ? ring : [...ring, first];
}

function circleVertices(center: XY, radiusMeters: number, segments = 72): XY[] {
  return Array.from({ length: segments }, (_value, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radiusMeters,
      y: center.y + Math.sin(angle) * radiusMeters,
    };
  });
}
