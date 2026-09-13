import { z } from "zod";

import { MapPackageManifestSchema } from "./mapTilePackages";
import { ProjectSettingsSchema } from "./settings";
import type { LonLat, PivotProject, ProjectMapFeatureGeometry, ProjectWgs84Companion, XY } from "./types";
import { assertProjectedCrs } from "./units";
import { projectXyToLonLat } from "./coordinates";

export const PROJECT_DOCUMENT_VERSION = "pivot-project-v1";

const XySchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const LonLatSchema = z.object({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
});

const RtkQualitySchema = z.object({
  fixType: z.enum(["invalid", "autonomous", "dgps", "rtk_float", "rtk_fixed", "ppp", "unknown"]),
  satellites: z.number().int().nullable(),
  hdop: z.number().nullable(),
  vdop: z.number().nullable(),
  pdop: z.number().nullable(),
  correctionAgeSeconds: z.number().nullable(),
  horizontalAccuracyMeters: z.number().nullable(),
  verticalAccuracyMeters: z.number().nullable(),
  baseStationId: z.string().optional(),
  roverId: z.string().optional(),
  nmeaQualityCode: z.number().optional(),
});

const GnssCaptureEvidenceSchema = z.object({
  schemaVersion: z.literal("gnss-capture-v1"),
  observationId: z.string().min(1),
  sessionId: z.string().min(1),
  transport: z.enum(["web_serial", "android_ble", "android_spp", "android_usb", "ios_ble", "ios_mfi", "local_tcp", "replay"]),
  receivedAt: z.string().min(1),
  receivedMonotonicMs: z.number().finite().min(0),
  receiverObservedAt: z.string().min(1).optional(),
  sourceCoordinateFrame: z.string().min(1),
  coordinateEpoch: z.number().finite().optional(),
  height: z.object({
    meters: z.number().finite(),
    type: z.enum(["ellipsoidal", "orthometric", "unknown"]),
    geoidSeparationMeters: z.number().finite().optional(),
  }).optional(),
  antennaReference: z.enum(["arp", "phase_center", "pole_tip", "tilt_compensated", "unknown"]),
  sentenceTypes: z.array(z.string().min(1)),
  coherent: z.boolean(),
  rawRecordHashes: z.array(z.string().min(1)).optional(),
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

const ProjectMapFeatureGeometryByKind: Record<z.infer<typeof ProjectMapFeatureKindSchema>, Array<z.infer<typeof ProjectMapFeatureGeometrySchema>["type"]>> = {
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
}).superRefine((feature, context) => {
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
});

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

export const PivotProjectSchema = z.object({
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
  mapFeatures: z.array(ProjectMapFeatureSchema).optional().default([]),
  wgs84Companion: ProjectWgs84CompanionSchema.optional(),
}).superRefine((project, context) => {
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
});

const ProjectDocumentSchema = z.object({
  documentVersion: z.literal(PROJECT_DOCUMENT_VERSION),
  project: PivotProjectSchema,
});

export function serializeProjectDocument(project: PivotProject): string {
  const parsedProject = PivotProjectSchema.parse(project);
  return JSON.stringify({
    documentVersion: PROJECT_DOCUMENT_VERSION,
    project: withWgs84Companion(parsedProject),
  }, null, 2);
}

export function parseProjectDocument(input: string | unknown): PivotProject {
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  if (isRecord(raw) && raw.documentVersion === PROJECT_DOCUMENT_VERSION) {
    return withWgs84Companion(ProjectDocumentSchema.parse(raw).project);
  }
  return withWgs84Companion(PivotProjectSchema.parse(raw));
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
