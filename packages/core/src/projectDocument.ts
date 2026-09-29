import { hasOperationalGnssEvidence, refuseOperationalGnssEvidence } from "./operationalGnssEvidence";
import { z } from "zod";
import { ProjectDrawingMetadataSchema, validateProjectDrawingMetadata } from "./drawingMetadata";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { assertNoStrippedFields } from "./jsonFieldRetention";

import { MapPackageManifestSchema } from "./mapTilePackages";
import { ProjectSettingsSchema } from "./settings";
import type { LonLat, PivotProject, ProjectMapFeature, ProjectMapFeatureGeometry, ProjectWgs84Companion, XY } from "./types";
import { assertProjectedCrs } from "./units";
import { projectXyToLonLat } from "./coordinates";
import { GnssCaptureEvidenceSchema, gnssConfidenceExceedsV2Evidence, gnssV2CaptureConflicts, RtkQualitySchema } from "./gnssEvidence";
import { projectDataKey } from "./projectDataComparison";

export const LEGACY_PROJECT_DOCUMENT_VERSION = "pivot-project-v1";
export const PROJECT_DOCUMENT_VERSION = "pivot-project-v2";
export const OPERATIONAL_PROJECT_DOCUMENT_VERSION = "pivot-project-v3";
export const PROJECT_DOCUMENT_VERSIONS = [LEGACY_PROJECT_DOCUMENT_VERSION, PROJECT_DOCUMENT_VERSION, OPERATIONAL_PROJECT_DOCUMENT_VERSION] as const;

const XySchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const LonLatSchema = z.object({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
});

const SurveyPointSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  role: z.enum(["boundary", "pivot_center", "water_source", "power_source", "obstacle", "control", "note"]),
  projected: XySchema,
  wgs84: LonLatSchema.optional(),
  observedAt: z.string().min(1),
  source: z.enum(["device_gps", "external_gnss", "imported", "manual"]),
  confidence: z.enum(["rtk_fixed", "rtk_float", "dgps", "autonomous_gps", "imagery_digitized", "imported_cad", "user_estimated", "optimized"]),
  rtk: RtkQualitySchema.optional(),
  captureEvidence: GnssCaptureEvidenceSchema.optional(),
  notes: z.string().optional(),
}).superRefine((point, context) => {
  const evidence = point.captureEvidence;
  if (evidence?.schemaVersion !== "gnss-capture-v2") return;
  if (point.observedAt !== evidence.receiverObservedAt) {
    context.addIssue({ code: "custom", path: ["observedAt"], message: "V2 survey observedAt must exactly match receiverObservedAt." });
  }
  const rawQuality = evidence.qualityScreen.receiverQuality;
  const elapsed = (evidence.qualityScreen.evaluatedMonotonicMs - evidence.receivedMonotonicMs) / 1000;
  const captureQuality = {
    ...rawQuality,
    correctionAgeSeconds: rawQuality.correctionAgeSeconds === null ? null : rawQuality.correctionAgeSeconds + elapsed,
  };
  if (!point.rtk || projectDataKey(point.rtk) !== projectDataKey(captureQuality)) {
    context.addIssue({ code: "custom", path: ["rtk"], message: "V2 survey quality must match the raw receiver snapshot with capture elapsed correction age added." });
  }
  const confidence = rawQuality.fixType === "rtk_fixed" ? "rtk_fixed"
    : rawQuality.fixType === "rtk_float" ? "rtk_float"
      : rawQuality.fixType === "dgps" ? "dgps" : "autonomous_gps";
  if (point.confidence !== confidence) {
    context.addIssue({ code: "custom", path: ["confidence"], message: "V2 survey confidence must match its receiver fix type." });
  }
});

const PivotAngleRangeSchema = z.object({
  startAngleDegrees: z.number().finite(),
  stopAngleDegrees: z.number().finite(),
  direction: z.enum(["clockwise", "counterclockwise"]),
});

const AdvisorySourceReferenceSchema = z.object({
  sourceId: z.string().min(1),
  title: z.string().min(1).optional(),
  url: z.string().url().optional(),
  guideId: z.string().min(1).optional(),
  page: z.number().int().positive().optional(),
  lineRange: z.string().min(1).optional(),
  checkedAt: z.string().min(1).optional(),
  limit: z.string().min(1),
});

const AdvisoryCornerArmConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  advisoryOnly: z.literal(true),
  lengthMeters: z.number().positive(),
  wheelTrackLengthMeters: z.number().positive().optional(),
  overhangLengthMeters: z.number().min(0).optional(),
  maxSteerAngleDegrees: z.number().finite().optional(),
  minSteerAngleDegrees: z.number().finite().optional(),
  maxExtensionRateMetersPerMinute: z.number().positive().optional(),
  maxRetractionRateMetersPerMinute: z.number().positive().optional(),
  speedEvidenceSourceRefs: z.array(AdvisorySourceReferenceSchema).optional(),
  metadataSource: z.enum(["operator_supplied", "cornergpsmap_config", "manufacturer_public", "local_design_guide", "unknown"]).optional(),
  modelFamily: z.enum(["single_span_lrdu_sdu", "dualspan", "operator_supplied", "unknown"]).optional(),
  guidanceType: z.enum(["gps_guidance", "below_ground_guidance", "operator_supplied", "unknown"]),
  sequencingType: z.enum(["electronic", "mechanical", "operator_supplied", "unknown"]),
  orientation: z.enum(["leading", "trailing", "operator_supplied", "unknown"]),
  confidence: z.enum(["rtk_fixed", "rtk_float", "dgps", "autonomous_gps", "imagery_digitized", "imported_cad", "user_estimated", "optimized"]),
  sourceRefs: z.array(AdvisorySourceReferenceSchema).min(1),
  operatorConfirmedAt: z.string().min(1).optional(),
  notes: z.string().optional(),
});

const AdvisoryDriveUnitRoleSchema = z.enum(["lrdu", "sdu"]);

const AdvisoryTireOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  advisoryOnly: z.literal(true),
  roleCompatibility: z.array(AdvisoryDriveUnitRoleSchema).min(1),
  sourceRefs: z.array(AdvisorySourceReferenceSchema).min(1),
  caveats: z.array(z.string().min(1)).default([]),
  customValueFallback: z.boolean(),
});

const AdvisoryDriveMotorOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  advisoryOnly: z.literal(true),
  roleCompatibility: z.array(AdvisoryDriveUnitRoleSchema).min(1),
  rpm: z.number().positive().optional(),
  sourceRefs: z.array(AdvisorySourceReferenceSchema).min(1),
  caveats: z.array(z.string().min(1)).default([]),
  customValueFallback: z.boolean(),
});

const AdvisoryDriveUnitConfigSchema = z.object({
  role: AdvisoryDriveUnitRoleSchema,
  advisoryOnly: z.literal(true),
  tire: AdvisoryTireOptionSchema.optional(),
  driveMotor: AdvisoryDriveMotorOptionSchema.optional(),
  customTireLabel: z.string().min(1).optional(),
  customMotorRpm: z.number().positive().optional(),
  operatorMeasuredSpeedMetersPerMinute: z.number().positive().optional(),
  sourceRefs: z.array(AdvisorySourceReferenceSchema).min(1),
  caveats: z.array(z.string().min(1)).default([]),
}).superRefine((config, context) => {
  if (config.role === "lrdu" && config.tire && !config.tire.roleCompatibility.includes("lrdu")) {
    context.addIssue({ code: "custom", message: "LRDU tire option is not LRDU-compatible.", path: ["tire", "roleCompatibility"] });
  }
  if (config.role === "sdu" && config.tire && !config.tire.roleCompatibility.includes("sdu")) {
    context.addIssue({ code: "custom", message: "SDU tire option is not SDU-compatible.", path: ["tire", "roleCompatibility"] });
  }
  if (config.role === "lrdu" && config.driveMotor && !config.driveMotor.roleCompatibility.includes("lrdu")) {
    context.addIssue({ code: "custom", message: "LRDU drive motor option is not LRDU-compatible.", path: ["driveMotor", "roleCompatibility"] });
  }
  if (config.role === "sdu" && config.driveMotor && !config.driveMotor.roleCompatibility.includes("sdu")) {
    context.addIssue({ code: "custom", message: "SDU drive motor option is not SDU-compatible.", path: ["driveMotor", "roleCompatibility"] });
  }
});

const PivotMachineSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  spanLengthsMeters: z.array(z.number().positive()).min(1),
  overhangMeters: z.number().min(0),
  endGunThrowMeters: z.number().min(0),
  endGunAngleRanges: z.array(PivotAngleRangeSchema).optional().default([]),
  towerClearanceBufferMeters: z.number().min(0),
  machineClearanceBufferMeters: z.number().min(0),
  sweep: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("full_circle") }),
    z.object({
      mode: z.literal("partial_circle"),
      startAngleDegrees: z.number().finite(),
      stopAngleDegrees: z.number().finite(),
      direction: z.enum(["clockwise", "counterclockwise"]),
    }),
  ]),
  catalogSelection: z.object({
    catalogId: z.string().min(1),
    manufacturer: z.string().min(1),
    model: z.string().min(1),
    sourceUrl: z.string().url(),
    sourceAccessedAt: z.string().min(1),
    advisoryOnly: z.literal(true),
  }).optional(),
  cornerArm: AdvisoryCornerArmConfigSchema.optional(),
  driveUnits: z.object({
    lrdu: AdvisoryDriveUnitConfigSchema.optional(),
    sdu: AdvisoryDriveUnitConfigSchema.optional(),
  }).optional(),
});

const ObstacleZoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["road", "ditch", "fence", "building", "canal", "tree", "exclusion"]),
  polygon: z.array(XySchema).min(3),
  bufferMeters: z.number().min(0),
  hardConflict: z.boolean(),
  noSpray: z.boolean(),
  confidence: z.enum(["rtk_fixed", "rtk_float", "dgps", "autonomous_gps", "imagery_digitized", "imported_cad", "user_estimated", "optimized"]),
  vertexCaptureEvidence: z.array(GnssCaptureEvidenceSchema.nullable()).optional(),
}).superRefine((obstacle, context) => {
  if (obstacle.vertexCaptureEvidence && obstacle.vertexCaptureEvidence.length !== obstacle.polygon.length) {
    context.addIssue({ code: "custom", message: "Obstacle vertex capture evidence must align with polygon vertices.", path: ["vertexCaptureEvidence"] });
  }
  if (gnssConfidenceExceedsV2Evidence(obstacle.confidence, obstacle.vertexCaptureEvidence)) {
    context.addIssue({ code: "custom", message: "Obstacle GNSS confidence cannot exceed its weakest retained v2 fix.", path: ["confidence"] });
  }
});

const ProjectMapFeatureKindSchema = z.enum([
  "pump_location",
  "well_location",
  "underground_pipeline",
  "underground_wire",
  "power_pole",
  "power_line",
  "tree",
  "road",
  "access_lane",
  "ditch",
  "canal",
  "fence",
  "planning_boundary",
  "machine_zone",
  "linear_move_path",
  "measurement_line",
  "measurement_area",
  "end_gun_mark",
  "end_gun_arc",
  "corner_swing_limit",
]);

const ProjectMapFeatureGeometrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("Point"),
    point: XySchema,
  }),
  z.object({
    type: z.literal("LineString"),
    vertices: z.array(XySchema).min(2),
  }),
  z.object({
    type: z.literal("Polygon"),
    vertices: z.array(XySchema).min(3),
  }),
  z.object({
    type: z.literal("Circle"),
    center: XySchema,
    radiusMeters: z.number().positive(),
  }),
]);

const ProjectMapFeatureGeometryByKind: Record<string, Array<z.infer<typeof ProjectMapFeatureGeometrySchema>["type"]>> = {
  reference_point: ["Point"],
  reference_line: ["LineString"],
  reference_area: ["Polygon"],
  pump_location: ["Point"],
  well_location: ["Point"],
  underground_pipeline: ["LineString"],
  underground_wire: ["LineString"],
  power_pole: ["Point"],
  power_line: ["LineString"],
  tree: ["Point"],
  road: ["LineString"],
  access_lane: ["LineString"],
  ditch: ["LineString"],
  canal: ["LineString"],
  fence: ["LineString"],
  planning_boundary: ["Polygon"],
  machine_zone: ["Polygon", "Circle", "LineString"],
  linear_move_path: ["LineString"],
  measurement_line: ["LineString"],
  measurement_area: ["Polygon"],
  end_gun_mark: ["Point"],
  end_gun_arc: ["Circle", "LineString"],
  corner_swing_limit: ["Polygon", "LineString"],
};

const ProjectMapFeatureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: ProjectMapFeatureKindSchema,
  geometry: ProjectMapFeatureGeometrySchema,
  confidence: z.enum(["rtk_fixed", "rtk_float", "dgps", "autonomous_gps", "imagery_digitized", "imported_cad", "user_estimated", "optimized"]),
  vertexCaptureEvidence: z.array(GnssCaptureEvidenceSchema.nullable()).optional(),
  notes: z.string().optional(),
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});
function validateMapFeature(feature: ProjectMapFeature, context: z.RefinementCtx): void {
  const allowedGeometry = ProjectMapFeatureGeometryByKind[feature.kind];
  if (!allowedGeometry.includes(feature.geometry.type)) {
    context.addIssue({
      code: "custom",
      message: `${feature.kind} requires ${allowedGeometry.join(" or ")} geometry.`,
      path: ["geometry", "type"],
    });
  }
  const expectedEvidenceCount = feature.geometry.type === "Point" || feature.geometry.type === "Circle"
    ? 1
    : feature.geometry.vertices.length;
  if (feature.vertexCaptureEvidence && feature.vertexCaptureEvidence.length !== expectedEvidenceCount) {
    context.addIssue({ code: "custom", message: "Map feature capture evidence must align with geometry vertices.", path: ["vertexCaptureEvidence"] });
  }
  if (gnssConfidenceExceedsV2Evidence(feature.confidence, feature.vertexCaptureEvidence)) {
    context.addIssue({ code: "custom", message: "Map feature GNSS confidence cannot exceed its weakest retained v2 fix.", path: ["confidence"] });
  }
}


const ClassifiedProjectMapFeatureSchema = ProjectMapFeatureSchema.extend({
  kind: z.enum([...ProjectMapFeatureKindSchema.options, "reference_point", "reference_line", "reference_area"]),
}).superRefine(validateMapFeature);

const ProjectMapFeatureWgs84GeometrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("Point"),
    point: LonLatSchema,
  }),
  z.object({
    type: z.literal("LineString"),
    vertices: z.array(LonLatSchema).min(2),
  }),
  z.object({
    type: z.literal("Polygon"),
    vertices: z.array(LonLatSchema).min(3),
  }),
  z.object({
    type: z.literal("Circle"),
    center: LonLatSchema,
    radiusMeters: z.number().positive(),
  }),
]);

const ProjectWgs84CompanionSchema = z.object({
  status: z.enum(["projected", "unavailable"]),
  source: z.literal("derived_from_project_xy"),
  coordinateSystem: z.literal("decimal_degrees"),
  projectCrs: z.string().min(1),
  error: z.string().optional(),
  fieldBoundary: z.array(LonLatSchema).optional(),
  pivotCenter: LonLatSchema.optional(),
  waterSource: LonLatSchema.optional(),
  powerSource: LonLatSchema.optional(),
  obstacles: z.array(z.object({ id: z.string().min(1), polygon: z.array(LonLatSchema).min(3) })).optional(),
  mapFeatures: z.array(z.object({ id: z.string().min(1), geometry: ProjectMapFeatureWgs84GeometrySchema })).optional(),
});

const LegacyProjectBaseSchema = z.object({
  drawingMetadata: z.never({ error: "Drawing metadata requires pivot-project-v2; preserve the original document." }).optional(),
  // Reserve future multi-machine roots so legacy normalization cannot lose machines.
  machines: z.never({ error: "Multiple-machine project data is unsupported by this document version; preserve the original document." }).optional(),
  selectedMachineId: z.never({ error: "Machine selection data is unsupported by this document version; preserve the original document." }).optional(),
  documentVersion: z.never({ error: "A versioned project requires a supported document envelope; preserve the original document." }).optional(),
  id: z.string().min(1),
  name: z.string().min(1),
  projectCrs: z.string().min(1),
  unitSystem: z.enum(["metric", "us_survey_feet"]),
  settings: ProjectSettingsSchema.optional(),
  fieldBoundary: z.array(XySchema).min(3),
  fieldBoundaryCaptureEvidence: z.array(GnssCaptureEvidenceSchema.nullable()).optional(),
  pivotCenter: XySchema,
  waterSource: XySchema,
  powerSource: XySchema,
  infrastructureObservationRefs: z.object({
    pivot_center: z.string().min(1).optional(),
    water_source: z.string().min(1).optional(),
    power_source: z.string().min(1).optional(),
  }).optional(),
  machine: PivotMachineSchema,
  obstacles: z.array(ObstacleZoneSchema),
  surveyPoints: z.array(SurveyPointSchema),
  mapPackages: z.array(MapPackageManifestSchema).optional(),
  mapFeatures: z.array(ProjectMapFeatureSchema.superRefine(validateMapFeature)).optional().default([]),
  wgs84Companion: ProjectWgs84CompanionSchema.optional(),
});
function validateProjectData(project: PivotProject, context: z.RefinementCtx): void {
  try {
    assertProjectedCrs(project.projectCrs);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Projected CRS required.",
      path: ["projectCrs"],
    });
  }
  if (project.fieldBoundaryCaptureEvidence && project.fieldBoundaryCaptureEvidence.length !== project.fieldBoundary.length) {
    context.addIssue({
      code: "custom",
      message: "Field-boundary capture evidence must align with boundary vertices.",
      path: ["fieldBoundaryCaptureEvidence"],
    });
  }
  const observations = new Map<string, typeof project.surveyPoints[number]>();
  project.surveyPoints.forEach((observation, index) => {
    if (observations.has(observation.id)) {
      context.addIssue({ code: "custom", message: `Duplicate survey observation ID ${observation.id}; explicit repair is required.`, path: ["surveyPoints", index, "id"] });
    }
    observations.set(observation.id, observation);
  });
  for (const [role, target] of [
    ["pivot_center", project.pivotCenter], ["water_source", project.waterSource], ["power_source", project.powerSource],
  ] as const) {
    const id = project.infrastructureObservationRefs?.[role];
    if (!id) continue;
    const observation = observations.get(id);
    if (!observation || observation.projected.x !== target.x || observation.projected.y !== target.y) {
      context.addIssue({ code: "custom", message: `Infrastructure observation reference ${id} must resolve to its exact projected XY coordinate.`, path: ["infrastructureObservationRefs", role] });
    }
  }
  for (const issue of gnssV2CaptureConflicts(project)) context.addIssue({ code: "custom", ...issue });
}


export const LegacyPivotProjectSchema = LegacyProjectBaseSchema.superRefine(validateProjectData);

/** Legacy shape remains frozen: new kinds and metadata are admitted only by the current schema. */
export const PivotProjectSchema = LegacyProjectBaseSchema.extend({
  drawingMetadata: ProjectDrawingMetadataSchema.optional(),
  mapFeatures: z.array(ClassifiedProjectMapFeatureSchema).optional().default([]),
}).superRefine(validateProjectData).superRefine((project, context) => {
  try { validateProjectDrawingMetadata(project); }
  catch (error) { context.addIssue({ code: "custom", path: ["drawingMetadata"], message: error instanceof Error ? error.message : "Invalid drawing metadata." }); }
});

const ProjectEnvelopeSchema = z.object({
  documentVersion: z.enum(PROJECT_DOCUMENT_VERSIONS), project: z.unknown(),
  machines: z.never({ error: "Multiple-machine project data is unsupported; preserve the original document." }).optional(),
  selectedMachineId: z.never({ error: "Machine selection data is unsupported; preserve the original document." }).optional(),
});

export function serializeProjectDocument(project: PivotProject): string {
  const snapshot = snapshotJsonValue(project);
  const parsedProject = PivotProjectSchema.parse(snapshot);
  if (parsedProject.drawingMetadata !== undefined) {
    assertNoStrippedFields(snapshot, parsedProject, "Project v2 contains unsupported fields; refusing to discard data. Preserve the original document.");
  }
  return JSON.stringify({
    documentVersion: hasOperationalGnssEvidence(parsedProject) ? OPERATIONAL_PROJECT_DOCUMENT_VERSION : parsedProject.drawingMetadata === undefined ? LEGACY_PROJECT_DOCUMENT_VERSION : PROJECT_DOCUMENT_VERSION,
    project: withWgs84Companion(parsedProject),
  }, null, 2);
}

/** Frozen reader for compatibility checks; v2 data must never be normalized by v1. */
export function parseProjectDocumentV1(input: string | unknown): PivotProject {
  const raw = snapshotJsonValue(typeof input === "string" ? JSON.parse(input) : input);
  refuseOperationalGnssEvidence(raw);
  if (isRecord(raw) && "documentVersion" in raw) {
    if (raw.documentVersion !== LEGACY_PROJECT_DOCUMENT_VERSION) throw new Error("Project document version is unsupported; preserve the original document and use a compatible editor.");
    return withWgs84Companion(LegacyPivotProjectSchema.parse(ProjectEnvelopeSchema.parse(raw).project));
  }
  return withWgs84Companion(LegacyPivotProjectSchema.parse(raw));
}

export function parseProjectDocument(input: string | unknown): PivotProject {
  const raw = snapshotJsonValue(typeof input === "string" ? JSON.parse(input) : input);
  if (isRecord(raw) && "documentVersion" in raw) {
    if (!(PROJECT_DOCUMENT_VERSIONS as readonly unknown[]).includes(raw.documentVersion)) {
      throw new Error("Project document version is unsupported; preserve the original document and use a compatible editor.");
    }
    const envelope = ProjectEnvelopeSchema.parse(raw);
    if (envelope.documentVersion !== OPERATIONAL_PROJECT_DOCUMENT_VERSION) refuseOperationalGnssEvidence(envelope.project);
    if (envelope.documentVersion === LEGACY_PROJECT_DOCUMENT_VERSION) return parseProjectDocumentV1(raw);
    assertNoStrippedFields(raw, envelope, "Project v2 envelope contains unsupported fields; refusing to discard data. Preserve the original document.");
    const project = PivotProjectSchema.parse(envelope.project);
    assertNoStrippedFields(envelope.project, project, "Project v2 contains unsupported fields; refusing to discard data. Preserve the original document.");
    return withWgs84Companion(project);
  }
  // New classified data always requires a versioned envelope.
  return parseProjectDocumentV1(raw);
}

export function withWgs84Companion(project: PivotProject): PivotProject {
  return {
    ...project,
    wgs84Companion: deriveWgs84Companion(project),
  };
}

export function deriveWgs84Companion(project: PivotProject): ProjectWgs84Companion {
  try {
    const projectPoint = (point: XY): LonLat => projectXyToLonLat(point, project.projectCrs);
    const mapFeatureGeometry = (geometry: ProjectMapFeatureGeometry) => {
      switch (geometry.type) {
        case "Point":
          return { type: "Point" as const, point: projectPoint(geometry.point) };
        case "LineString":
          return { type: "LineString" as const, vertices: geometry.vertices.map(projectPoint) };
        case "Polygon":
          return { type: "Polygon" as const, vertices: geometry.vertices.map(projectPoint) };
        case "Circle":
          return { type: "Circle" as const, center: projectPoint(geometry.center), radiusMeters: geometry.radiusMeters };
      }
    };
    return {
      status: "projected",
      source: "derived_from_project_xy",
      coordinateSystem: "decimal_degrees",
      projectCrs: project.projectCrs,
      fieldBoundary: project.fieldBoundary.map(projectPoint),
      pivotCenter: projectPoint(project.pivotCenter),
      waterSource: projectPoint(project.waterSource),
      powerSource: projectPoint(project.powerSource),
      obstacles: project.obstacles.map((obstacle) => ({ id: obstacle.id, polygon: obstacle.polygon.map(projectPoint) })),
      mapFeatures: (project.mapFeatures ?? []).map((feature) => ({ id: feature.id, geometry: mapFeatureGeometry(feature.geometry) })),
    };
  } catch (error) {
    return {
      status: "unavailable",
      source: "derived_from_project_xy",
      coordinateSystem: "decimal_degrees",
      projectCrs: project.projectCrs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Frozen v1/v2 reader refuses operational evidence even in incorrectly labeled old envelopes. */
export function parseProjectDocumentV2(input: string | unknown): PivotProject {
  const raw = snapshotJsonValue(typeof input === "string" ? JSON.parse(input) : input);
  if (isRecord(raw) && "documentVersion" in raw && raw.documentVersion === OPERATIONAL_PROJECT_DOCUMENT_VERSION) throw new Error("Project version requires an operational-evidence-aware reader.");
  refuseOperationalGnssEvidence(raw);
  return parseProjectDocument(raw);
}
