import * as polygonClipping from "polygon-clipping";

import type {
  AdvisoryCornerArmConfig,
  AdvisorySourceReference,
  MultiPolygonXY,
  PivotMachine,
  PivotProject,
  PivotSweep,
  ProjectMapFeature,
  XY,
} from "@cplayout/core";
import { feetToMeters, squareMetersToAcres } from "@cplayout/core";
import { completeCalculation, type Calculation } from "./calculation";

import {
  buildLayoutPathOverlaysSteps,
  createAnnularSector,
  createCirclePolygon,
  createSectorPolygon,
  evaluateCornerArmPathSteps,
  evaluatePathBoundaryDistance,
  machineRadiusMeters,
  multiPolygonAreaSquareMeters,
  polygonAreaSquareMeters,
  type LayoutPathOverlay,
  type PathBoundaryDistanceEvaluation,
} from "./geometry";

type ClipPosition = [number, number];
type ClipPolygon = ClipPosition[][];
type ClipMultiPolygon = ClipPolygon[];
type AdvisoryMachineInstanceBuild = {
  instance: AdvisoryMachineRenderInstance | null;
  feature: ProjectMapFeature;
  outline: XY[];
  warnings: string[];
  blockers: string[];
};
type CompleteAdvisoryMachineInstanceBuild = AdvisoryMachineInstanceBuild & {
  instance: AdvisoryMachineRenderInstance;
};

const DEFAULT_END_GUN_THROW_METERS = 30.48;
const DEFAULT_TOWER_SPAN_METERS = 54;
const DEFAULT_VFLEX_WHEEL_TRACK_EXTENSION_METERS = 66;
const DEFAULT_VFLEX_OVERHANG_EXTENSION_METERS = 25;
const DEFAULT_SAFETY_ZONE_METERS = feetToMeters(15);
const AREA_EPSILON_SQUARE_METERS = 0.000001;

export interface AdvisoryMachineRenderOptions {
  featureIds?: string[];
  maxInstances?: number;
  endGunThrowMeters?: number;
  includePublicVflexFallbackCornerArm?: boolean;
  safetyZoneMeters?: number;
  sourceRefs?: AdvisorySourceReference[];
}

export interface AdvisoryMachineRenderInstance {
  id: string;
  label: string;
  pivotCenter: XY;
  machine: PivotMachine;
  sweep: PivotSweep;
  sourceFeatureIds: string[];
  advisoryOnly: true;
  canonicalGeometryMutation: false;
}

export interface AdvisoryMachineRenderSurface {
  instanceId: string;
  label: string;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  sourceFeatureIds: string[];
  preferredOutlinePath: XY[];
  standardPivotCoverage: MultiPolygonXY;
  endGunWetAnnulus: MultiPolygonXY;
  cornerArmCoverage: MultiPolygonXY;
  clippedWetCoverage: MultiPolygonXY;
  physicalEnvelope: MultiPolygonXY;
  lrduPath: LayoutPathOverlay | null;
  towerPaths: LayoutPathOverlay[];
  cornerArmWheelPath: LayoutPathOverlay | null;
  cornerArmOverhangEndPath: LayoutPathOverlay | null;
  safetyZoneMeters: number;
  pathBoundaryShortfalls: AdvisoryMachinePathBoundaryShortfall[];
  standardPivotAcres: number;
  endGunAcres: number;
  cornerArmAcres: number;
  wetCoverageAcres: number;
  physicalEnvelopeAcres: number;
  outsideFieldWetAcres: number;
  verifiedBlockedAcres: number;
  warnings: string[];
}

export interface AdvisoryMachinePathBoundaryShortfall {
  kind: "lrdu" | "tower" | "corner_arm_wheel_track" | "corner_arm_overhang_end" | "end_gun_reach";
  label: string;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  radiusMeters: number;
  pathBufferMeters: number;
  safetyZoneMeters: number;
  minimumSignedDistanceToBoundaryMeters: number;
  minimumShortfallMeters: number;
  shortfallSampleCount: number;
  sampledPointCount: number;
  evaluationMethod: PathBoundaryDistanceEvaluation["method"];
  boundaryDistanceEvaluation: PathBoundaryDistanceEvaluation;
  clearanceStatus: "meets_required_clearance" | "shortfall" | "unresolved";
  shortfallEnvelopeAcres: number;
  towerIndex?: number;
  warnings: string[];
}

export interface AdvisoryMachineRenderConflict {
  id: string;
  leftInstanceId: string;
  rightInstanceId: string;
  status: "physical_envelope_overlap";
  severity: "collision_review";
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  operatorCollisionReviewRequired: true;
  collisionZone: MultiPolygonXY;
  collisionZoneAcres: number;
  warnings: string[];
}

export interface AdvisoryMachineRenderAcreLedger {
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  standardPivotAcres: number;
  endGunAcres: number;
  cornerArmAcres: number;
  deduplicatedTotalAcres: number;
  overlapAcres: number;
  outsideFieldAcres: number;
  verifiedBlockedAcres: number;
}

export interface AdvisoryMachineRenderModel {
  status: "ready" | "insufficient_evidence";
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  projectCrs: string;
  instances: AdvisoryMachineRenderInstance[];
  surfaces: AdvisoryMachineRenderSurface[];
  conflicts: AdvisoryMachineRenderConflict[];
  acreLedger: AdvisoryMachineRenderAcreLedger;
  sourceRefs: AdvisorySourceReference[];
  warnings: string[];
  blockers: string[];
}

export const DEFAULT_ADVISORY_MACHINE_RENDER_SOURCE_REFS: AdvisorySourceReference[] = [
  {
    sourceId: "SRC-KML-REFERENCE-VISUAL-INTERCHANGE",
    title: "Google KML Reference",
    url: "https://developers.google.com/kml/documentation/kmlreference",
    checkedAt: "2026-06-08",
    limit: "KML geometry and style metadata are visual interchange evidence only; they do not mutate canonical projected XY.",
  },
  {
    sourceId: "SRC-VALLEY-VFLEX-CORNER-PUBLIC-FALLBACK",
    title: "Valley VFlex Corner",
    url: "https://www.valleyirrigation.com/vflex-corner",
    checkedAt: "2026-06-08",
    limit: "Public fallback dimension metadata only; not field-specific compatibility, proprietary kinematics, or certified design.",
  },
];

export function buildAdvisoryMachineRenderModel(
  project: PivotProject,
  options: AdvisoryMachineRenderOptions = {},
): AdvisoryMachineRenderModel {
  return completeCalculation(buildAdvisoryMachineRenderModelSteps(project, options));
}

export function* buildAdvisoryMachineRenderModelSteps(
  project: PivotProject,
  options: AdvisoryMachineRenderOptions = {},
): Calculation<AdvisoryMachineRenderModel> {
  const sourceRefs = options.sourceRefs ?? DEFAULT_ADVISORY_MACHINE_RENDER_SOURCE_REFS;
  const preferredFeatures = preferredMachineOutlineFeatures(project, options);
  const maxInstances = Math.max(1, Math.floor(options.maxInstances ?? 2));
  const instanceBuilds = preferredFeatures.slice(0, maxInstances).map((feature) => instanceFromFeature(project, feature, options));
  const completeBuilds = instanceBuilds.filter(isCompleteInstanceBuild);
  const instances = completeBuilds.map((build) => build.instance);
  const surfaces: AdvisoryMachineRenderSurface[] = [];
  for (const build of completeBuilds) {
    surfaces.push(yield* surfaceForInstance(project, build.instance, build.outline, build.warnings, Math.max(0, options.safetyZoneMeters ?? DEFAULT_SAFETY_ZONE_METERS)));
  }
  const conflicts = buildPhysicalEnvelopeConflicts(surfaces);
  yield;
  const acreLedger = buildAcreLedger(surfaces);
  const blockers = instanceBuilds.flatMap((build) => build.blockers);
  const status = instances.length > 0 && blockers.length === 0 ? "ready" : "insufficient_evidence";

  return {
    status,
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    projectCrs: project.projectCrs,
    instances,
    surfaces,
    conflicts,
    acreLedger,
    sourceRefs,
    warnings: [
      "Advisory machine render model is display/report data only and does not create saved machines, move the active pivot, alter project storage, or change archive schemas.",
      "Preferred machine outlines are source evidence; rendered wet and physical surfaces are clipped to the full field boundary before display.",
      "End-gun wet annulus is reported as wet coverage only and is not used as a physical collision layer.",
      "Internal machine-zone edges remain advisory context, not blockers or containment limits.",
      ...instanceBuilds.flatMap((build) => build.warnings),
      ...conflicts.flatMap((conflict) => conflict.warnings),
    ],
    blockers,
  };
}

function preferredMachineOutlineFeatures(project: PivotProject, options: AdvisoryMachineRenderOptions): ProjectMapFeature[] {
  const featureIds = new Set(options.featureIds ?? []);
  return (project.mapFeatures ?? []).filter((feature) => {
    if (feature.kind !== "machine_zone") return false;
    if (featureIds.size > 0) return featureIds.has(feature.id);
    return feature.properties?.preferredMachineOutline === true
      || feature.properties?.advisoryDesignRole === "preferred_machine_outline";
  });
}

function instanceFromFeature(
  project: PivotProject,
  feature: ProjectMapFeature,
  options: AdvisoryMachineRenderOptions,
): AdvisoryMachineInstanceBuild {
  const outline = outlinePathForFeature(feature);
  if (outline.length < 3) {
    return {
      instance: null,
      feature,
      outline,
      warnings: [],
      blockers: [`${feature.name} does not have enough projected-XY outline vertices for advisory machine rendering.`],
    };
  }

  const circle = inferCircleFromOutline(outline);
  if (!circle) {
    return {
      instance: null,
      feature,
      outline,
      warnings: [],
      blockers: [`${feature.name} could not be fit to a finite advisory pivot circle.`],
    };
  }

  const sweep = inferSweep(feature, outline, circle.center);
  const radius = Math.max(1, circle.radiusMeters);
  const machine = buildRenderMachine(project.machine, feature, radius, sweep, options);
  const id = `advisory-render-${feature.id}`;
  return {
    instance: {
      id,
      label: feature.name,
      pivotCenter: circle.center,
      machine,
      sweep,
      sourceFeatureIds: [feature.id],
      advisoryOnly: true,
      canonicalGeometryMutation: false,
    },
    feature,
    outline,
    warnings: [
      `${feature.name} render instance uses source outline evidence only; it does not move the canonical pivot center.`,
      ...(sweep.mode === "partial_circle"
        ? [`${feature.name} is rendered as a part-circle because the source label or ordered outline geometry indicates partial sweep evidence.`]
        : []),
      ...(machine.cornerArm
        ? [`${feature.name} uses a public Valley VFlex advisory corner-arm fallback because no field-specific CornerGPSMap/FLT preset was selected.`]
        : []),
    ],
    blockers: [],
  };
}

function isCompleteInstanceBuild(build: AdvisoryMachineInstanceBuild): build is CompleteAdvisoryMachineInstanceBuild {
  return build.instance !== null;
}

function buildRenderMachine(
  projectMachine: PivotMachine,
  feature: ProjectMapFeature,
  radiusMeters: number,
  sweep: PivotSweep,
  options: AdvisoryMachineRenderOptions,
): PivotMachine {
  const spanLengthsMeters = spanSetForRadius(radiusMeters, averageSpanLength(projectMachine) ?? DEFAULT_TOWER_SPAN_METERS);
  const includeCornerArm = options.includePublicVflexFallbackCornerArm !== false;
  return {
    ...projectMachine,
    id: `${projectMachine.id}-${feature.id}-advisory-render`,
    name: `${feature.name} advisory render machine`,
    spanLengthsMeters,
    overhangMeters: 0,
    endGunThrowMeters: Math.max(0, options.endGunThrowMeters ?? DEFAULT_END_GUN_THROW_METERS),
    endGunAngleRanges: [],
    sweep,
    cornerArm: includeCornerArm ? publicVflexFallbackCornerArmConfig() : projectMachine.cornerArm,
  };
}

function publicVflexFallbackCornerArmConfig(): AdvisoryCornerArmConfig {
  return {
    id: "public-vflex-advisory-fallback",
    name: "Public VFlex advisory fallback",
    advisoryOnly: true,
    lengthMeters: DEFAULT_VFLEX_WHEEL_TRACK_EXTENSION_METERS + DEFAULT_VFLEX_OVERHANG_EXTENSION_METERS,
    wheelTrackLengthMeters: DEFAULT_VFLEX_WHEEL_TRACK_EXTENSION_METERS,
    overhangLengthMeters: DEFAULT_VFLEX_OVERHANG_EXTENSION_METERS,
    metadataSource: "manufacturer_public",
    modelFamily: "single_span_lrdu_sdu",
    guidanceType: "gps_guidance",
    sequencingType: "electronic",
    orientation: "unknown",
    confidence: "user_estimated",
    sourceRefs: DEFAULT_ADVISORY_MACHINE_RENDER_SOURCE_REFS.filter((source) => source.sourceId.includes("VFLEX")),
    notes: "Fallback dimensions for advisory rendering only; no field-specific compatibility or proprietary kinematics are claimed.",
  };
}

function* surfaceForInstance(
  project: PivotProject,
  instance: AdvisoryMachineRenderInstance,
  preferredOutlinePath: XY[],
  inheritedWarnings: string[],
  safetyZoneMeters: number,
): Calculation<AdvisoryMachineRenderSurface> {
  const field = toClipMultiPolygon([[project.fieldBoundary]]);
  const noSpray = toClipMultiPolygon(project.obstacles.filter((obstacle) => obstacle.noSpray).map((obstacle) => [obstacle.polygon]));
  const variantProject: PivotProject = {
    ...project,
    pivotCenter: instance.pivotCenter,
    machine: instance.machine,
  };
  const radius = machineRadiusMeters(instance.machine);
  const standardRaw = toClipMultiPolygon([[createSectorPolygon(instance.pivotCenter, radius, instance.sweep)]]);
  const endGunRaw = toClipMultiPolygon(createAnnularSector(
    instance.pivotCenter,
    radius,
    radius + Math.max(0, instance.machine.endGunThrowMeters),
    instance.sweep,
  ));
  const cornerArmPath = yield* evaluateCornerArmPathSteps(variantProject);
  yield;
  const cornerArmRaw = cornerArmPath ? toClipMultiPolygon(cornerArmPath.extensionEnvelope) : [];
  const wetRaw = unionClip([standardRaw, endGunRaw, cornerArmRaw]);
  yield;
  const physicalRaw = unionClip([
    standardRaw,
    cornerArmPath ? toClipMultiPolygon(cornerArmPath.overhangEndEnvelope) : [],
    cornerArmPath ? toClipMultiPolygon(cornerArmPath.wheelTrackEnvelope) : [],
  ]);
  const standardPivotCoverage = clipAllowedToField(standardRaw, field, noSpray);
  yield;
  const endGunWetAnnulus = clipAllowedToField(endGunRaw, field, noSpray);
  yield;
  const cornerArmCoverage = clipAllowedToField(cornerArmRaw, field, noSpray);
  yield;
  const clippedWetCoverage = clipAllowedToField(wetRaw, field, noSpray);
  yield;
  const physicalEnvelope = fromClipMultiPolygon(polygonClipping.intersection(physicalRaw, field) as ClipMultiPolygon | null ?? []);
  yield;
  const outsideWet = fromClipMultiPolygon(polygonClipping.difference(wetRaw, field) as ClipMultiPolygon);
  yield;
  const wetInsideField = fromClipMultiPolygon(polygonClipping.intersection(wetRaw, field) as ClipMultiPolygon | null ?? []);
  const blockedByNoSprayArea = Math.max(
    0,
    multiPolygonAreaSquareMeters(wetInsideField) - multiPolygonAreaSquareMeters(clippedWetCoverage),
  );
  const pathOverlays = yield* buildLayoutPathOverlaysSteps(variantProject);
  yield;
  const lrduPath = pathOverlays.find((overlay) => overlay.machinePathRoles.includes("last_wheel")) ?? null;
  const towerPaths = pathOverlays.filter((overlay) => overlay.kind === "wheel_track");
  const cornerArmWheelPath = pathOverlays.find((overlay) => overlay.kind === "corner_arm_wheel_track") ?? null;
  const cornerArmOverhangEndPath = pathOverlays.find((overlay) => overlay.kind === "corner_arm_overhang_end") ?? null;
  const pathBoundaryShortfalls: AdvisoryMachinePathBoundaryShortfall[] = [];
  const paths: { path: LayoutPathOverlay; kind: AdvisoryMachinePathBoundaryShortfall["kind"] }[] = [
    ...(lrduPath ? [{ path: lrduPath, kind: "lrdu" as const }] : []),
    ...towerPaths.map((path) => ({ path, kind: "tower" as const })),
    ...(cornerArmWheelPath ? [{ path: cornerArmWheelPath, kind: "corner_arm_wheel_track" as const }] : []),
    ...(cornerArmOverhangEndPath ? [{ path: cornerArmOverhangEndPath, kind: "corner_arm_overhang_end" as const }] : []),
  ];
  for (const { path, kind } of paths) {
    pathBoundaryShortfalls.push(pathBoundaryShortfall(variantProject, path, safetyZoneMeters, kind));
    yield;
  }
  const endGunShortfall = endGunPathBoundaryShortfall(variantProject, safetyZoneMeters);
  if (endGunShortfall) pathBoundaryShortfalls.push(endGunShortfall);

  return {
    instanceId: instance.id,
    label: instance.label,
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    sourceFeatureIds: instance.sourceFeatureIds,
    preferredOutlinePath,
    standardPivotCoverage,
    endGunWetAnnulus,
    cornerArmCoverage,
    clippedWetCoverage,
    physicalEnvelope,
    lrduPath,
    towerPaths,
    cornerArmWheelPath,
    cornerArmOverhangEndPath,
    safetyZoneMeters: round(safetyZoneMeters),
    pathBoundaryShortfalls,
    standardPivotAcres: round(squareMetersToAcres(multiPolygonAreaSquareMeters(standardPivotCoverage))),
    endGunAcres: round(squareMetersToAcres(multiPolygonAreaSquareMeters(endGunWetAnnulus))),
    cornerArmAcres: round(squareMetersToAcres(multiPolygonAreaSquareMeters(cornerArmCoverage))),
    wetCoverageAcres: round(squareMetersToAcres(multiPolygonAreaSquareMeters(clippedWetCoverage))),
    physicalEnvelopeAcres: round(squareMetersToAcres(multiPolygonAreaSquareMeters(physicalEnvelope))),
    outsideFieldWetAcres: round(squareMetersToAcres(multiPolygonAreaSquareMeters(outsideWet))),
    verifiedBlockedAcres: round(squareMetersToAcres(blockedByNoSprayArea)),
    warnings: [
      ...inheritedWarnings,
      ...(pathBoundaryShortfalls.some((shortfall) => shortfall.minimumShortfallMeters > 0)
        ? ["One or more advisory machine paths are short of the sampled boundary safety zone; review pathBoundaryShortfalls before operator approval."]
        : []),
    ],
  };
}

function endGunPathBoundaryShortfall(project: PivotProject, safetyZoneMeters: number): AdvisoryMachinePathBoundaryShortfall | null {
  const endGunRadius = radiusWithEndGun(project.machine);
  if (endGunRadius <= machineRadiusMeters(project.machine)) return null;
  return sampledPathShortfall({
    project,
    kind: "end_gun_reach",
    label: "End-gun wet reach",
    radiusMeters: endGunRadius,
    pathBufferMeters: 0,
    safetyZoneMeters,
    shortfallEnvelope: [],
    warnings: ["End-gun reach is wet coverage only and is not a physical collision path."],
  });
}

function pathBoundaryShortfall(
  project: PivotProject,
  overlay: LayoutPathOverlay,
  safetyZoneMeters: number,
  kind: AdvisoryMachinePathBoundaryShortfall["kind"],
): AdvisoryMachinePathBoundaryShortfall {
  return sampledPathShortfall({
    project,
    kind,
    label: overlay.label,
    radiusMeters: overlay.radiusMeters,
    pathBufferMeters: overlay.bufferMeters,
    safetyZoneMeters,
    shortfallEnvelope: overlay.outsideFieldEnvelope,
    towerIndex: overlay.towerIndex,
    warnings: overlay.warnings ?? [],
  });
}

function sampledPathShortfall(input: {
  project: PivotProject;
  kind: AdvisoryMachinePathBoundaryShortfall["kind"];
  label: string;
  radiusMeters: number;
  pathBufferMeters: number;
  safetyZoneMeters: number;
  shortfallEnvelope: MultiPolygonXY;
  towerIndex?: number;
  warnings: string[];
}): AdvisoryMachinePathBoundaryShortfall {
  const boundaryDistance = evaluatePathBoundaryDistance(input.project, input.radiusMeters);
  const minimumShortfall = boundaryDistance.minimumBoundaryDistanceMeters - input.pathBufferMeters - input.safetyZoneMeters;
  const upperShortfall = boundaryDistance.upperBoundMeters - input.pathBufferMeters - input.safetyZoneMeters;
  const clearanceStatus = upperShortfall < 0 ? "shortfall"
    : boundaryDistance.converged && minimumShortfall >= 0 ? "meets_required_clearance" : "unresolved";
  const shortfallSampleCount = upperShortfall < 0 && boundaryDistance.evaluatedPointCount > 0 ? 1 : 0;
  return {
    kind: input.kind,
    label: input.label,
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    radiusMeters: round(input.radiusMeters),
    pathBufferMeters: round(input.pathBufferMeters),
    safetyZoneMeters: round(input.safetyZoneMeters),
    minimumSignedDistanceToBoundaryMeters: boundaryDistance.lowerBoundMeters,
    minimumShortfallMeters: Math.max(0, -minimumShortfall),
    shortfallSampleCount,
    sampledPointCount: boundaryDistance.evaluatedPointCount,
    evaluationMethod: boundaryDistance.method,
    boundaryDistanceEvaluation: boundaryDistance,
    clearanceStatus,
    shortfallEnvelopeAcres: round(squareMetersToAcres(multiPolygonAreaSquareMeters(input.shortfallEnvelope))),
    ...(input.towerIndex === undefined ? {} : { towerIndex: input.towerIndex }),
    warnings: [
      boundaryDistance.method === "exact_full_circle"
        ? "Contained full-circle clearance uses the center-to-boundary formula with a numerical allowance."
        : "Path shortfall uses conservative signed-distance bounds over the complete sweep in projected/local XY.",
      ...boundaryDistance.warnings,
      ...(clearanceStatus === "shortfall" ? ["The path is short of the path buffer plus safety zone."] : []),
      ...(clearanceStatus === "unresolved" ? ["The clearance range does not establish the required path buffer plus safety zone."] : []),
      ...input.warnings,
    ],
  };
}

function buildPhysicalEnvelopeConflicts(surfaces: AdvisoryMachineRenderSurface[]): AdvisoryMachineRenderConflict[] {
  const conflicts: AdvisoryMachineRenderConflict[] = [];
  for (let leftIndex = 0; leftIndex < surfaces.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < surfaces.length; rightIndex += 1) {
      const left = surfaces[leftIndex];
      const right = surfaces[rightIndex];
      const collisionZone = intersectMultiPolygons(left.physicalEnvelope, right.physicalEnvelope);
      const collisionZoneAcres = round(squareMetersToAcres(multiPolygonAreaSquareMeters(collisionZone)));
      if (collisionZoneAcres <= 0.001) continue;
      conflicts.push({
        id: `advisory-render-conflict-${left.instanceId}-${right.instanceId}`,
        leftInstanceId: left.instanceId,
        rightInstanceId: right.instanceId,
        status: "physical_envelope_overlap",
        severity: "collision_review",
        advisoryOnly: true,
        canonicalGeometryMutation: false,
        qualifiedReviewRequired: true,
        operatorCollisionReviewRequired: true,
        collisionZone,
        collisionZoneAcres,
        warnings: [
          "Collision review uses physical machine and corner-arm envelopes only; end-gun wet coverage is excluded from collision geometry.",
          "Collision geometry is advisory projected-XY evidence and is not runtime collision prevention.",
        ],
      });
    }
  }
  return conflicts;
}

function buildAcreLedger(surfaces: AdvisoryMachineRenderSurface[]): AdvisoryMachineRenderAcreLedger {
  const wetCoverages = surfaces.map((surface) => toClipMultiPolygon(surface.clippedWetCoverage));
  const wetUnion = unionClip(wetCoverages);
  const deduplicatedTotalAcres = round(squareMetersToAcres(multiPolygonAreaSquareMeters(fromClipMultiPolygon(wetUnion))));
  const acreSum = surfaces.reduce((sum, surface) => (
    sum + surface.standardPivotAcres + surface.endGunAcres + surface.cornerArmAcres
  ), 0);
  return {
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    standardPivotAcres: round(surfaces.reduce((sum, surface) => sum + surface.standardPivotAcres, 0)),
    endGunAcres: round(surfaces.reduce((sum, surface) => sum + surface.endGunAcres, 0)),
    cornerArmAcres: round(surfaces.reduce((sum, surface) => sum + surface.cornerArmAcres, 0)),
    deduplicatedTotalAcres,
    overlapAcres: round(Math.max(0, acreSum - deduplicatedTotalAcres)),
    outsideFieldAcres: round(surfaces.reduce((sum, surface) => sum + surface.outsideFieldWetAcres, 0)),
    verifiedBlockedAcres: round(surfaces.reduce((sum, surface) => sum + surface.verifiedBlockedAcres, 0)),
  };
}

function outlinePathForFeature(feature: ProjectMapFeature): XY[] {
  if (feature.geometry.type === "LineString") return feature.geometry.vertices;
  if (feature.geometry.type === "Polygon") return feature.geometry.vertices;
  if (feature.geometry.type === "Circle") return createCirclePolygon(feature.geometry.center, feature.geometry.radiusMeters, 144);
  return [feature.geometry.point];
}

function inferCircleFromOutline(outline: XY[]): { center: XY; radiusMeters: number } | null {
  const points = removeClosingDuplicate(outline);
  if (points.length < 3) return null;
  const first = points[0];
  const centered = points.map((point) => ({ x: point.x - first.x, y: point.y - first.y }));
  let sumX2 = 0;
  let sumXY = 0;
  let sumY2 = 0;
  let sumBx = 0;
  let sumBy = 0;
  for (const point of centered) {
    const b = point.x * point.x + point.y * point.y;
    sumX2 += point.x * point.x;
    sumXY += point.x * point.y;
    sumY2 += point.y * point.y;
    sumBx += point.x * b;
    sumBy += point.y * b;
  }
  const determinant = 4 * (sumX2 * sumY2 - sumXY * sumXY);
  if (Math.abs(determinant) < 1e-9) return null;
  const cxLocal = (2 * (sumBx * sumY2 - sumBy * sumXY)) / determinant;
  const cyLocal = (2 * (sumX2 * sumBy - sumXY * sumBx)) / determinant;
  const center = { x: first.x + cxLocal, y: first.y + cyLocal };
  const radii = points.map((point) => distance(point, center)).filter((value) => Number.isFinite(value) && value > 0);
  if (radii.length === 0) return null;
  const radiusMeters = median(radii);
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(radiusMeters) || radiusMeters <= 0) return null;
  return { center, radiusMeters };
}

function inferSweep(feature: ProjectMapFeature, outline: XY[], center: XY): PivotSweep {
  const preferredSweep = feature.properties?.advisorySweepMode;
  const name = `${feature.name} ${feature.properties?.sourcePlacemark ?? ""}`.toLowerCase();
  const partialRequested = preferredSweep === "partial_circle" || name.includes("part");
  if (!partialRequested) return { mode: "full_circle" };

  const points = removeClosingDuplicate(outline);
  if (points.length < 3) {
    return {
      mode: "partial_circle",
      startAngleDegrees: 0,
      stopAngleDegrees: 0,
      direction: "counterclockwise",
    };
  }
  const angles = points.map((point) => normalizeDegrees(angleDegrees(center, point)));
  const signedDeltas = angles.slice(1).map((angle, index) => shortestSignedDelta(angles[index], angle));
  const direction: "clockwise" | "counterclockwise" = signedDeltas.reduce((sum, delta) => sum + delta, 0) >= 0
    ? "counterclockwise"
    : "clockwise";
  const gaps = angles.map((angle, index) => {
    const next = angles[(index + 1) % angles.length];
    return direction === "counterclockwise"
      ? normalizeDegrees(next - angle)
      : normalizeDegrees(angle - next);
  });
  const gapIndex = gaps.reduce((bestIndex, gap, index) => gap > gaps[bestIndex] ? index : bestIndex, 0);
  const startIndex = (gapIndex + 1) % angles.length;
  return {
    mode: "partial_circle",
    startAngleDegrees: round(angles[startIndex]),
    stopAngleDegrees: round(angles[gapIndex]),
    direction,
  };
}

function clipAllowedToField(envelope: ClipMultiPolygon, field: ClipMultiPolygon, noSpray: ClipMultiPolygon): MultiPolygonXY {
  if (envelope.length === 0) return [];
  const inside = polygonClipping.intersection(envelope, field) as ClipMultiPolygon | null;
  if (!inside || inside.length === 0) return [];
  if (noSpray.length === 0) return fromClipMultiPolygon(inside);
  return fromClipMultiPolygon(polygonClipping.difference(inside, noSpray) as ClipMultiPolygon);
}

function intersectMultiPolygons(left: MultiPolygonXY, right: MultiPolygonXY): MultiPolygonXY {
  if (left.length === 0 || right.length === 0) return [];
  return fromClipMultiPolygon(polygonClipping.intersection(toClipMultiPolygon(left), toClipMultiPolygon(right)) as ClipMultiPolygon | null ?? []);
}

function unionClip(parts: ClipMultiPolygon[]): ClipMultiPolygon {
  const nonEmpty = parts.filter((part) => part.length > 0);
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.length === 1) return nonEmpty[0];
  return nonEmpty.slice(1).reduce(
    (combined, part) => polygonClipping.union(combined, part) as ClipMultiPolygon,
    nonEmpty[0],
  );
}

function toClipMultiPolygon(multiPolygon: MultiPolygonXY): ClipMultiPolygon {
  return multiPolygon.map((polygon) => polygon.map((ring) => closeRing(ring).map((point) => [point.x, point.y] as ClipPosition)));
}

function fromClipMultiPolygon(multiPolygon: ClipMultiPolygon | null): MultiPolygonXY {
  if (!multiPolygon) return [];
  return multiPolygon
    .map((polygon) => polygon
      .map((ring) => ring.map(([x, y]) => ({ x, y })))
      .filter((ring) => polygonAreaSquareMeters(ring) > AREA_EPSILON_SQUARE_METERS || ring.length >= 2))
    .filter((polygon) => polygon.length > 0);
}

function closeRing(ring: XY[]): XY[] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first.x === last.x && first.y === last.y ? ring : [...ring, first];
}

function removeClosingDuplicate(points: XY[]): XY[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return distance(first, last) < 0.001 ? points.slice(0, -1) : points;
}

function spanSetForRadius(radiusMeters: number, targetSpanMeters: number): number[] {
  const spanCount = Math.max(1, Math.ceil(radiusMeters / Math.max(1, targetSpanMeters)));
  const spanLength = radiusMeters / spanCount;
  return Array.from({ length: spanCount }, () => round(spanLength));
}

function averageSpanLength(machine: PivotMachine): number | null {
  const spans = machine.spanLengthsMeters.filter((span) => Number.isFinite(span) && span > 0);
  if (spans.length === 0) return null;
  return spans.reduce((sum, span) => sum + span, 0) / spans.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function angleDegrees(center: XY, point: XY): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

function normalizeDegrees(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function shortestSignedDelta(from: number, to: number): number {
  const delta = normalizeDegrees(to - from);
  return delta > 180 ? delta - 360 : delta;
}

function radiusWithEndGun(machine: PivotMachine): number {
  return machineRadiusMeters(machine) + Math.max(0, machine.endGunThrowMeters);
}

function distance(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
