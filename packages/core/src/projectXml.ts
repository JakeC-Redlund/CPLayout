import { DOMParser } from "@xmldom/xmldom";

import { projectLonLatToXy } from "./coordinates";
import { defaultProjectSettings } from "./settings";
import { PivotProjectSchema, withWgs84Companion } from "./projectDocument";
import type {
  AdvisoryCornerArmConfig,
  AdvisoryDriveUnitConfig,
  AdvisoryDriveMotorOption,
  AdvisorySourceReference,
  AdvisoryTireOption,
  LonLat,
  ObstacleZone,
  PivotAngleRange,
  PivotMachine,
  PivotProject,
  ProjectMapFeature,
  ProjectMapFeatureKind,
  ProjectMapFeatureGeometry,
  SourceConfidence,
  SurveyPoint,
  UnitSystem,
  XY,
} from "./types";

export const CPLAYOUT_MAP_XML_VERSION = "cplayout-map-v1";
export const CPLAYOUT_MAP_XML_NAMESPACE = "https://cplayout.local/xml/map/v1";

const SOURCE_CONFIDENCES: SourceConfidence[] = [
  "rtk_fixed",
  "rtk_float",
  "dgps",
  "autonomous_gps",
  "imagery_digitized",
  "imported_cad",
  "user_estimated",
  "optimized",
];

const OBSTACLE_KINDS: ObstacleZone["kind"][] = ["road", "ditch", "fence", "building", "canal", "tree", "exclusion"];
const MAP_FEATURE_KINDS: ProjectMapFeatureKind[] = [
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
];
const SURVEY_ROLES: SurveyPoint["role"][] = ["boundary", "pivot_center", "water_source", "power_source", "obstacle", "control", "note"];
const SURVEY_SOURCES: SurveyPoint["source"][] = ["device_gps", "external_gnss", "imported", "manual"];

export interface CplayoutMapXmlImportResult {
  project: PivotProject;
  warnings: string[];
}

export function exportProjectMapXml(project: PivotProject): string {
  const parsed = withWgs84Companion(PivotProjectSchema.parse(project));
  const companion = parsed.wgs84Companion;
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<cplayoutMap xmlns="${CPLAYOUT_MAP_XML_NAMESPACE}" version="${CPLAYOUT_MAP_XML_VERSION}" projectId="${escapeXml(parsed.id)}" projectName="${escapeXml(parsed.name)}" projectCrs="${escapeXml(parsed.projectCrs)}" unitSystem="${parsed.unitSystem}">`,
    `  <metadata canonicalGeometry="projected_xy" gpsCoordinateSystem="decimal_degrees" gpsCompanionStatus="${companion?.status ?? "unavailable"}" paidServicesRequired="false" offlineFirst="true"/>`,
    `  <configuration coordinateDisplayFormat="${escapeXml(parsed.settings?.coordinateDisplayFormat ?? "decimal_degrees")}" mapStyle="${escapeXml(parsed.settings?.mapStyle ?? "field_light")}" workflowMode="${escapeXml(parsed.settings?.mappingWorkflowMode ?? "design")}"/>`,
    `  <fieldBoundary>`,
    ...parsed.fieldBoundary.map((point, index) => `    <vertex index="${index}"${pointAttrs(point, companion?.fieldBoundary?.[index])}/>`),
    `  </fieldBoundary>`,
    `  <infrastructure>`,
    `    <point role="pivot_center"${pointAttrs(parsed.pivotCenter, companion?.pivotCenter)}/>`,
    `    <point role="water_source"${pointAttrs(parsed.waterSource, companion?.waterSource)}/>`,
    `    <point role="power_source"${pointAttrs(parsed.powerSource, companion?.powerSource)}/>`,
    `  </infrastructure>`,
    ...machineXml(parsed.machine),
    `  <obstacles>`,
    ...parsed.obstacles.flatMap((obstacle) => obstacleXml(obstacle, companion?.obstacles?.find((candidate) => candidate.id === obstacle.id)?.polygon)),
    `  </obstacles>`,
    `  <surveyPoints>`,
    ...parsed.surveyPoints.map(surveyPointXml),
    `  </surveyPoints>`,
    `  <mapFeatures>`,
    ...(parsed.mapFeatures ?? []).flatMap((feature) => mapFeatureXml(feature, companion?.mapFeatures?.find((candidate) => candidate.id === feature.id)?.geometry)),
    `  </mapFeatures>`,
    `</cplayoutMap>`,
  ];
  return `${lines.join("\n")}\n`;
}

export function importProjectMapXmlToProject(xmlText: string): CplayoutMapXmlImportResult {
  if (!xmlText.trim()) throw new Error("CPLayout XML import file is empty.");
  if (/<!DOCTYPE/i.test(xmlText)) throw new Error("CPLayout XML import does not allow DOCTYPE declarations.");
  const document = new DOMParser().parseFromString(xmlText, "text/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error("CPLayout XML could not be parsed: invalid XML.");
  }
  const root = document.documentElement as XmlElement | null;
  if (!root || localName(root) !== "cplayoutMap") throw new Error("CPLayout XML root element must be cplayoutMap.");
  const version = requiredAttr(root, "version");
  if (version !== CPLAYOUT_MAP_XML_VERSION) throw new Error(`Unsupported CPLayout XML version ${version}.`);

  const projectCrs = requiredAttr(root, "projectCrs");
  const unitSystem = enumAttr<UnitSystem>(root, "unitSystem", ["metric", "us_survey_feet"]);
  const fieldBoundaryElement = requiredChild(root, "fieldBoundary");
  const infrastructureElement = requiredChild(root, "infrastructure");
  const machineElement = requiredChild(root, "machine");
  const convertedGpsOnly = hasGpsOnlyCoordinate(root);

  const project: PivotProject = {
    id: requiredAttr(root, "projectId"),
    name: requiredAttr(root, "projectName"),
    projectCrs,
    unitSystem,
    settings: {
      ...defaultProjectSettings(),
      unitSystem,
    },
    fieldBoundary: verticesFrom(fieldBoundaryElement, projectCrs),
    pivotCenter: infrastructurePoint(infrastructureElement, "pivot_center", projectCrs),
    waterSource: infrastructurePoint(infrastructureElement, "water_source", projectCrs),
    powerSource: infrastructurePoint(infrastructureElement, "power_source", projectCrs),
    machine: machineFrom(machineElement),
    obstacles: children(optionalChild(root, "obstacles"), "obstacle").map((obstacle) => obstacleFrom(obstacle, projectCrs)),
    surveyPoints: children(optionalChild(root, "surveyPoints"), "surveyPoint").map((point) => surveyPointFrom(point, projectCrs)),
    mapPackages: [],
    mapFeatures: children(optionalChild(root, "mapFeatures"), "mapFeature").map((feature) => mapFeatureFrom(feature, projectCrs)),
  };

  return {
    project: withWgs84Companion(PivotProjectSchema.parse(project)),
    warnings: [
      "CPLayout XML imported projected XY as canonical geometry; decimal GPS values were treated as display companions.",
      ...(convertedGpsOnly ? ["GPS-only decimal-degree XML values were converted into projected XY using the project CRS before validation."] : []),
    ],
  };
}

function machineXml(machine: PivotMachine): string[] {
  return [
    `  <machine id="${escapeXml(machine.id)}" name="${escapeXml(machine.name)}" overhangMeters="${machine.overhangMeters}" endGunThrowMeters="${machine.endGunThrowMeters}" towerClearanceBufferMeters="${machine.towerClearanceBufferMeters}" machineClearanceBufferMeters="${machine.machineClearanceBufferMeters}">`,
    machine.catalogSelection
      ? `    <catalogSelection catalogId="${escapeXml(machine.catalogSelection.catalogId)}" manufacturer="${escapeXml(machine.catalogSelection.manufacturer)}" model="${escapeXml(machine.catalogSelection.model)}" sourceUrl="${escapeXml(machine.catalogSelection.sourceUrl)}" sourceAccessedAt="${escapeXml(machine.catalogSelection.sourceAccessedAt)}" advisoryOnly="true"/>`
      : `    <catalogSelection advisoryOnly="true"/>`,
    `    <spans>`,
    ...machine.spanLengthsMeters.map((lengthMeters, index) => `      <span index="${index}" lengthMeters="${lengthMeters}"/>`),
    `    </spans>`,
    machine.sweep.mode === "full_circle"
      ? `    <sweep mode="full_circle"/>`
      : `    <sweep mode="partial_circle" startAngleDegrees="${machine.sweep.startAngleDegrees}" stopAngleDegrees="${machine.sweep.stopAngleDegrees}" direction="${machine.sweep.direction}"/>`,
    `    <endGunAngleRanges>`,
    ...(machine.endGunAngleRanges ?? []).map((range, index) => `      <angleRange index="${index}" startAngleDegrees="${range.startAngleDegrees}" stopAngleDegrees="${range.stopAngleDegrees}" direction="${range.direction}"/>`),
    `    </endGunAngleRanges>`,
    ...cornerArmXml(machine.cornerArm),
    ...driveUnitsXml(machine.driveUnits),
    `  </machine>`,
  ];
}

function cornerArmXml(cornerArm: AdvisoryCornerArmConfig | undefined): string[] {
  if (!cornerArm) return [];
  const optionalAttrs = [
    cornerArm.wheelTrackLengthMeters !== undefined ? ` wheelTrackLengthMeters="${cornerArm.wheelTrackLengthMeters}"` : "",
    cornerArm.overhangLengthMeters !== undefined ? ` overhangLengthMeters="${cornerArm.overhangLengthMeters}"` : "",
    cornerArm.maxSteerAngleDegrees !== undefined ? ` maxSteerAngleDegrees="${cornerArm.maxSteerAngleDegrees}"` : "",
    cornerArm.minSteerAngleDegrees !== undefined ? ` minSteerAngleDegrees="${cornerArm.minSteerAngleDegrees}"` : "",
    cornerArm.maxExtensionRateMetersPerMinute !== undefined ? ` maxExtensionRateMetersPerMinute="${cornerArm.maxExtensionRateMetersPerMinute}"` : "",
    cornerArm.maxRetractionRateMetersPerMinute !== undefined ? ` maxRetractionRateMetersPerMinute="${cornerArm.maxRetractionRateMetersPerMinute}"` : "",
    cornerArm.metadataSource ? ` metadataSource="${cornerArm.metadataSource}"` : "",
    cornerArm.modelFamily ? ` modelFamily="${cornerArm.modelFamily}"` : "",
  ].join("");
  return [
    `    <cornerArm id="${escapeXml(cornerArm.id)}" name="${escapeXml(cornerArm.name)}" advisoryOnly="true" lengthMeters="${cornerArm.lengthMeters}"${optionalAttrs} guidanceType="${cornerArm.guidanceType}" sequencingType="${cornerArm.sequencingType}" orientation="${cornerArm.orientation}" confidence="${cornerArm.confidence}"${cornerArm.operatorConfirmedAt ? ` operatorConfirmedAt="${escapeXml(cornerArm.operatorConfirmedAt)}"` : ""}${cornerArm.notes ? ` notes="${escapeXml(cornerArm.notes)}"` : ""}>`,
    ...cornerArm.sourceRefs.map((sourceRef) => sourceRefXml(sourceRef)),
    ...(cornerArm.speedEvidenceSourceRefs ?? []).map((sourceRef) => sourceRefXml(sourceRef, "speedSourceRef")),
    `    </cornerArm>`,
  ];
}

function driveUnitsXml(driveUnits: PivotMachine["driveUnits"]): string[] {
  const units = [driveUnits?.lrdu, driveUnits?.sdu].filter((unit): unit is AdvisoryDriveUnitConfig => Boolean(unit));
  if (units.length === 0) return [];
  return [
    `    <driveUnits advisoryOnly="true">`,
    ...units.flatMap(driveUnitXml),
    `    </driveUnits>`,
  ];
}

function driveUnitXml(unit: AdvisoryDriveUnitConfig): string[] {
  const attrs = [
    `role="${unit.role}"`,
    `advisoryOnly="true"`,
    unit.customTireLabel ? `customTireLabel="${escapeXml(unit.customTireLabel)}"` : "",
    unit.customMotorRpm !== undefined ? `customMotorRpm="${unit.customMotorRpm}"` : "",
    unit.operatorMeasuredSpeedMetersPerMinute !== undefined ? `operatorMeasuredSpeedMetersPerMinute="${unit.operatorMeasuredSpeedMetersPerMinute}"` : "",
  ].filter(Boolean).join(" ");
  return [
    `      <driveUnit ${attrs}>`,
    ...(unit.tire ? [tireOptionXml(unit.tire)] : []),
    ...(unit.driveMotor ? [driveMotorOptionXml(unit.driveMotor)] : []),
    ...unit.sourceRefs.map((sourceRef) => sourceRefXml(sourceRef)),
    ...unit.caveats.map((caveat) => `        <caveat value="${escapeXml(caveat)}"/>`),
    `      </driveUnit>`,
  ];
}

function tireOptionXml(tire: AdvisoryTireOption): string {
  return [
    `        <tire id="${escapeXml(tire.id)}" label="${escapeXml(tire.label)}" advisoryOnly="true" roleCompatibility="${escapeXml(tire.roleCompatibility.join(","))}" customValueFallback="${tire.customValueFallback}">`,
    ...tire.sourceRefs.map((sourceRef) => sourceRefXml(sourceRef, "sourceRef", 10)),
    ...tire.caveats.map((caveat) => `          <caveat value="${escapeXml(caveat)}"/>`),
    `        </tire>`,
  ].join("\n");
}

function driveMotorOptionXml(motor: AdvisoryDriveMotorOption): string {
  return [
    `        <driveMotor id="${escapeXml(motor.id)}" label="${escapeXml(motor.label)}" advisoryOnly="true" roleCompatibility="${escapeXml(motor.roleCompatibility.join(","))}" customValueFallback="${motor.customValueFallback}"${motor.rpm !== undefined ? ` rpm="${motor.rpm}"` : ""}>`,
    ...motor.sourceRefs.map((sourceRef) => sourceRefXml(sourceRef, "sourceRef", 10)),
    ...motor.caveats.map((caveat) => `          <caveat value="${escapeXml(caveat)}"/>`),
    `        </driveMotor>`,
  ].join("\n");
}

function sourceRefXml(sourceRef: AdvisorySourceReference, tagName = "sourceRef", indent = 6): string {
  const pad = " ".repeat(indent);
  return [
    `${pad}<${tagName} sourceId="${escapeXml(sourceRef.sourceId)}"`,
    sourceRef.title ? ` title="${escapeXml(sourceRef.title)}"` : "",
    sourceRef.url ? ` url="${escapeXml(sourceRef.url)}"` : "",
    sourceRef.guideId ? ` guideId="${escapeXml(sourceRef.guideId)}"` : "",
    sourceRef.page ? ` page="${sourceRef.page}"` : "",
    sourceRef.lineRange ? ` lineRange="${escapeXml(sourceRef.lineRange)}"` : "",
    sourceRef.checkedAt ? ` checkedAt="${escapeXml(sourceRef.checkedAt)}"` : "",
    ` limit="${escapeXml(sourceRef.limit)}"/>`,
  ].join("");
}

function obstacleXml(obstacle: ObstacleZone, wgs84Ring: LonLat[] | undefined): string[] {
  return [
    `    <obstacle id="${escapeXml(obstacle.id)}" name="${escapeXml(obstacle.name)}" kind="${obstacle.kind}" bufferMeters="${obstacle.bufferMeters}" hardConflict="${obstacle.hardConflict}" noSpray="${obstacle.noSpray}" confidence="${obstacle.confidence}">`,
    `      <polygon>`,
    ...obstacle.polygon.map((point, index) => `        <vertex index="${index}"${pointAttrs(point, wgs84Ring?.[index])}/>`),
    `      </polygon>`,
    `    </obstacle>`,
  ];
}

function surveyPointXml(point: SurveyPoint): string {
  const attrs = [
    `id="${escapeXml(point.id)}"`,
    `label="${escapeXml(point.label)}"`,
    `role="${point.role}"`,
    `source="${point.source}"`,
    `confidence="${point.confidence}"`,
    `observedAt="${escapeXml(point.observedAt)}"`,
    point.notes ? `notes="${escapeXml(point.notes)}"` : "",
  ].filter(Boolean).join(" ");
  return `    <surveyPoint ${attrs}${pointAttrs(point.projected, point.wgs84)}/>`;
}

function mapFeatureXml(feature: ProjectMapFeature, wgs84Geometry: ProjectMapFeature["geometry"] | unknown): string[] {
  const properties = feature.properties ? Object.entries(feature.properties).map(([name, value]) => {
    const valueText = value === null ? "" : String(value);
    return `      <property name="${escapeXml(name)}" value="${escapeXml(valueText)}" null="${value === null}"/>`;
  }) : [];
  return [
    `    <mapFeature id="${escapeXml(feature.id)}" name="${escapeXml(feature.name)}" kind="${feature.kind}" confidence="${feature.confidence}"${feature.notes ? ` notes="${escapeXml(feature.notes)}"` : ""}>`,
    ...geometryXml(feature.geometry, wgs84Geometry),
    ...properties,
    `    </mapFeature>`,
  ];
}

function geometryXml(geometry: ProjectMapFeatureGeometry, wgs84Geometry: unknown): string[] {
  if (geometry.type === "Point") {
    const wgs84 = isPointWgs84(wgs84Geometry) ? wgs84Geometry.point : undefined;
    return [`      <geometry type="Point">`, `        <point${pointAttrs(geometry.point, wgs84)}/>`, `      </geometry>`];
  }
  if (geometry.type === "Circle") {
    const wgs84 = isCircleWgs84(wgs84Geometry) ? wgs84Geometry.center : undefined;
    return [`      <geometry type="Circle" radiusMeters="${geometry.radiusMeters}">`, `        <center${pointAttrs(geometry.center, wgs84)}/>`, `      </geometry>`];
  }
  const wgs84Vertices = isVertexWgs84(wgs84Geometry) && wgs84Geometry.type === geometry.type ? wgs84Geometry.vertices : undefined;
  return [
    `      <geometry type="${geometry.type}">`,
    ...geometry.vertices.map((point, index) => `        <vertex index="${index}"${pointAttrs(point, wgs84Vertices?.[index])}/>`),
    `      </geometry>`,
  ];
}

function pointAttrs(point: XY, wgs84?: LonLat): string {
  return [
    ` x="${point.x}"`,
    ` y="${point.y}"`,
    wgs84 ? ` longitude="${wgs84.longitude}"` : "",
    wgs84 ? ` latitude="${wgs84.latitude}"` : "",
  ].join("");
}

function machineFrom(element: XmlElement): PivotMachine {
  const sweepElement = requiredChild(element, "sweep");
  const catalogSelection = optionalChild(element, "catalogSelection");
  const machine: PivotMachine = {
    id: requiredAttr(element, "id"),
    name: requiredAttr(element, "name"),
    spanLengthsMeters: children(requiredChild(element, "spans"), "span").map((span) => positiveNumberAttr(span, "lengthMeters")),
    overhangMeters: nonNegativeNumberAttr(element, "overhangMeters"),
    endGunThrowMeters: nonNegativeNumberAttr(element, "endGunThrowMeters"),
    towerClearanceBufferMeters: nonNegativeNumberAttr(element, "towerClearanceBufferMeters"),
    machineClearanceBufferMeters: nonNegativeNumberAttr(element, "machineClearanceBufferMeters"),
    sweep: enumAttr(sweepElement, "mode", ["full_circle", "partial_circle"]) === "full_circle"
      ? { mode: "full_circle" }
      : {
        mode: "partial_circle",
        startAngleDegrees: finiteNumberAttr(sweepElement, "startAngleDegrees"),
        stopAngleDegrees: finiteNumberAttr(sweepElement, "stopAngleDegrees"),
        direction: enumAttr(sweepElement, "direction", ["clockwise", "counterclockwise"]),
      },
    endGunAngleRanges: children(optionalChild(element, "endGunAngleRanges"), "angleRange").map(angleRangeFrom),
  };
  if (catalogSelection && attr(catalogSelection, "catalogId")) {
    machine.catalogSelection = {
      catalogId: requiredAttr(catalogSelection, "catalogId"),
      manufacturer: requiredAttr(catalogSelection, "manufacturer"),
      model: requiredAttr(catalogSelection, "model"),
      sourceUrl: requiredAttr(catalogSelection, "sourceUrl"),
      sourceAccessedAt: requiredAttr(catalogSelection, "sourceAccessedAt"),
      advisoryOnly: true,
    };
  }
  const cornerArmElement = optionalChild(element, "cornerArm");
  if (cornerArmElement) {
    machine.cornerArm = cornerArmFrom(cornerArmElement);
  }
  const driveUnitElements = children(optionalChild(element, "driveUnits"), "driveUnit").map(driveUnitFrom);
  if (driveUnitElements.length > 0) {
    machine.driveUnits = {
      lrdu: driveUnitElements.find((unit) => unit.role === "lrdu"),
      sdu: driveUnitElements.find((unit) => unit.role === "sdu"),
    };
  }
  return machine;
}

function cornerArmFrom(element: XmlElement): AdvisoryCornerArmConfig {
  return {
    id: requiredAttr(element, "id"),
    name: requiredAttr(element, "name"),
    advisoryOnly: true,
    lengthMeters: positiveNumberAttr(element, "lengthMeters"),
    wheelTrackLengthMeters: attr(element, "wheelTrackLengthMeters") ? positiveNumberAttr(element, "wheelTrackLengthMeters") : undefined,
    overhangLengthMeters: attr(element, "overhangLengthMeters") ? nonNegativeNumberAttr(element, "overhangLengthMeters") : undefined,
    maxSteerAngleDegrees: attr(element, "maxSteerAngleDegrees") ? finiteNumberAttr(element, "maxSteerAngleDegrees") : undefined,
    minSteerAngleDegrees: attr(element, "minSteerAngleDegrees") ? finiteNumberAttr(element, "minSteerAngleDegrees") : undefined,
    maxExtensionRateMetersPerMinute: attr(element, "maxExtensionRateMetersPerMinute") ? positiveNumberAttr(element, "maxExtensionRateMetersPerMinute") : undefined,
    maxRetractionRateMetersPerMinute: attr(element, "maxRetractionRateMetersPerMinute") ? positiveNumberAttr(element, "maxRetractionRateMetersPerMinute") : undefined,
    metadataSource: attr(element, "metadataSource")
      ? enumAttr<NonNullable<AdvisoryCornerArmConfig["metadataSource"]>>(element, "metadataSource", ["operator_supplied", "cornergpsmap_config", "manufacturer_public", "local_design_guide", "unknown"])
      : undefined,
    modelFamily: attr(element, "modelFamily")
      ? enumAttr<NonNullable<AdvisoryCornerArmConfig["modelFamily"]>>(element, "modelFamily", ["single_span_lrdu_sdu", "dualspan", "operator_supplied", "unknown"])
      : undefined,
    guidanceType: enumAttr(element, "guidanceType", ["gps_guidance", "below_ground_guidance", "operator_supplied", "unknown"]),
    sequencingType: enumAttr(element, "sequencingType", ["electronic", "mechanical", "operator_supplied", "unknown"]),
    orientation: enumAttr(element, "orientation", ["leading", "trailing", "operator_supplied", "unknown"]),
    confidence: enumAttr(element, "confidence", SOURCE_CONFIDENCES),
    sourceRefs: children(element, "sourceRef").map(sourceRefFrom),
    speedEvidenceSourceRefs: children(element, "speedSourceRef").map(sourceRefFrom),
    operatorConfirmedAt: attr(element, "operatorConfirmedAt") || undefined,
    notes: attr(element, "notes") || undefined,
  };
}

function driveUnitFrom(element: XmlElement): AdvisoryDriveUnitConfig {
  const tire = optionalChild(element, "tire");
  const driveMotor = optionalChild(element, "driveMotor");
  return {
    role: enumAttr(element, "role", ["lrdu", "sdu"]),
    advisoryOnly: true,
    tire: tire ? tireOptionFrom(tire) : undefined,
    driveMotor: driveMotor ? driveMotorOptionFrom(driveMotor) : undefined,
    customTireLabel: attr(element, "customTireLabel") || undefined,
    customMotorRpm: attr(element, "customMotorRpm") ? positiveNumberAttr(element, "customMotorRpm") : undefined,
    operatorMeasuredSpeedMetersPerMinute: attr(element, "operatorMeasuredSpeedMetersPerMinute") ? positiveNumberAttr(element, "operatorMeasuredSpeedMetersPerMinute") : undefined,
    sourceRefs: children(element, "sourceRef").map(sourceRefFrom),
    caveats: children(element, "caveat").map((caveat) => requiredAttr(caveat, "value")),
  };
}

function tireOptionFrom(element: XmlElement): AdvisoryTireOption {
  return {
    id: requiredAttr(element, "id"),
    label: requiredAttr(element, "label"),
    advisoryOnly: true,
    roleCompatibility: roleCompatibilityFrom(element),
    sourceRefs: children(element, "sourceRef").map(sourceRefFrom),
    caveats: children(element, "caveat").map((caveat) => requiredAttr(caveat, "value")),
    customValueFallback: booleanAttr(element, "customValueFallback"),
  };
}

function driveMotorOptionFrom(element: XmlElement): AdvisoryDriveMotorOption {
  return {
    id: requiredAttr(element, "id"),
    label: requiredAttr(element, "label"),
    advisoryOnly: true,
    roleCompatibility: roleCompatibilityFrom(element),
    rpm: attr(element, "rpm") ? positiveNumberAttr(element, "rpm") : undefined,
    sourceRefs: children(element, "sourceRef").map(sourceRefFrom),
    caveats: children(element, "caveat").map((caveat) => requiredAttr(caveat, "value")),
    customValueFallback: booleanAttr(element, "customValueFallback"),
  };
}

function roleCompatibilityFrom(element: XmlElement): Array<AdvisoryDriveUnitConfig["role"]> {
  const roles = requiredAttr(element, "roleCompatibility").split(",").map((role) => role.trim()).filter(Boolean);
  return roles.map((role) => {
    if (role !== "lrdu" && role !== "sdu") throw new Error(`CPLayout XML ${localName(element)} has invalid roleCompatibility ${role}.`);
    return role;
  });
}

function sourceRefFrom(element: XmlElement): AdvisorySourceReference {
  return {
    sourceId: requiredAttr(element, "sourceId"),
    title: attr(element, "title") || undefined,
    url: attr(element, "url") || undefined,
    guideId: attr(element, "guideId") || undefined,
    page: attr(element, "page") ? positiveNumberAttr(element, "page") : undefined,
    lineRange: attr(element, "lineRange") || undefined,
    checkedAt: attr(element, "checkedAt") || undefined,
    limit: requiredAttr(element, "limit"),
  };
}

function angleRangeFrom(element: XmlElement): PivotAngleRange {
  return {
    startAngleDegrees: finiteNumberAttr(element, "startAngleDegrees"),
    stopAngleDegrees: finiteNumberAttr(element, "stopAngleDegrees"),
    direction: enumAttr(element, "direction", ["clockwise", "counterclockwise"]),
  };
}

function obstacleFrom(element: XmlElement, projectCrs: string): ObstacleZone {
  return {
    id: requiredAttr(element, "id"),
    name: requiredAttr(element, "name"),
    kind: enumAttr(element, "kind", OBSTACLE_KINDS),
    polygon: verticesFrom(requiredChild(element, "polygon"), projectCrs),
    bufferMeters: nonNegativeNumberAttr(element, "bufferMeters"),
    hardConflict: booleanAttr(element, "hardConflict"),
    noSpray: booleanAttr(element, "noSpray"),
    confidence: enumAttr(element, "confidence", SOURCE_CONFIDENCES),
  };
}

function surveyPointFrom(element: XmlElement, projectCrs: string): SurveyPoint {
  return {
    id: requiredAttr(element, "id"),
    label: requiredAttr(element, "label"),
    role: enumAttr(element, "role", SURVEY_ROLES),
    projected: pointFrom(element, projectCrs),
    wgs84: lonLatFrom(element),
    observedAt: requiredAttr(element, "observedAt"),
    source: enumAttr(element, "source", SURVEY_SOURCES),
    confidence: enumAttr(element, "confidence", SOURCE_CONFIDENCES),
    notes: attr(element, "notes") || undefined,
  };
}

function mapFeatureFrom(element: XmlElement, projectCrs: string): ProjectMapFeature {
  const geometryElement = requiredChild(element, "geometry");
  const feature: ProjectMapFeature = {
    id: requiredAttr(element, "id"),
    name: requiredAttr(element, "name"),
    kind: enumAttr(element, "kind", MAP_FEATURE_KINDS),
    geometry: geometryFrom(geometryElement, projectCrs),
    confidence: enumAttr(element, "confidence", SOURCE_CONFIDENCES),
    notes: attr(element, "notes") || undefined,
  };
  const properties = children(element, "property").reduce<Record<string, string | number | boolean | null>>((record, property) => {
    const name = requiredAttr(property, "name");
    record[name] = booleanAttr(property, "null", false) ? null : requiredAttr(property, "value");
    return record;
  }, {});
  if (Object.keys(properties).length > 0) feature.properties = properties;
  return feature;
}

function geometryFrom(element: XmlElement, projectCrs: string): ProjectMapFeatureGeometry {
  const type = enumAttr(element, "type", ["Point", "LineString", "Polygon", "Circle"]);
  if (type === "Point") return { type, point: pointFrom(requiredChild(element, "point"), projectCrs) };
  if (type === "Circle") return { type, center: pointFrom(requiredChild(element, "center"), projectCrs), radiusMeters: positiveNumberAttr(element, "radiusMeters") };
  return { type, vertices: verticesFrom(element, projectCrs) };
}

function infrastructurePoint(parent: XmlElement, role: string, projectCrs: string): XY {
  const point = children(parent, "point").find((candidate) => attr(candidate, "role") === role);
  if (!point) throw new Error(`CPLayout XML infrastructure is missing ${role}.`);
  return pointFrom(point, projectCrs);
}

function verticesFrom(parent: XmlElement, projectCrs: string): XY[] {
  return children(parent, "vertex").map((vertex) => pointFrom(vertex, projectCrs));
}

function pointFrom(element: XmlElement, projectCrs: string): XY {
  const x = attr(element, "x");
  const y = attr(element, "y");
  if (x !== null && y !== null) return { x: finiteNumber(x, "x"), y: finiteNumber(y, "y") };
  const wgs84 = lonLatFrom(element);
  if (!wgs84) throw new Error(`CPLayout XML ${localName(element)} is missing projected x/y or decimal longitude/latitude.`);
  try {
    return projectLonLatToXy(wgs84, projectCrs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`CPLayout XML ${localName(element)} GPS coordinates require project CRS/calibration before import: ${message}`);
  }
}

function lonLatFrom(element: XmlElement): LonLat | undefined {
  const longitude = attr(element, "longitude");
  const latitude = attr(element, "latitude");
  if (longitude === null || latitude === null) return undefined;
  return { longitude: finiteNumber(longitude, "longitude"), latitude: finiteNumber(latitude, "latitude") };
}

type XmlDocument = ReturnType<InstanceType<typeof DOMParser>["parseFromString"]>;
type XmlElement = NonNullable<XmlDocument["documentElement"]>;

function children(parent: XmlElement | null | undefined, tagName: string): XmlElement[] {
  if (!parent) return [];
  return Array.from(parent.childNodes)
    .filter((node): node is XmlElement => node.nodeType === 1 && localName(node as XmlElement) === tagName);
}

function requiredChild(parent: XmlElement, tagName: string): XmlElement {
  const child = optionalChild(parent, tagName);
  if (!child) throw new Error(`CPLayout XML is missing ${tagName}.`);
  return child;
}

function optionalChild(parent: XmlElement | null | undefined, tagName: string): XmlElement | null {
  return children(parent, tagName)[0] ?? null;
}

function hasGpsOnlyCoordinate(root: XmlElement): boolean {
  return Array.from(root.getElementsByTagName("*")).some((element) => {
    const xmlElement = element as XmlElement;
    return attr(xmlElement, "longitude") !== null
      && attr(xmlElement, "latitude") !== null
      && (attr(xmlElement, "x") === null || attr(xmlElement, "y") === null);
  });
}

function localName(element: XmlElement): string {
  return (element.localName || element.nodeName || "").replace(/^.*:/, "");
}

function requiredAttr(element: XmlElement, name: string): string {
  const value = attr(element, name);
  if (value === null || value.length === 0) throw new Error(`CPLayout XML ${localName(element)} is missing ${name}.`);
  return value;
}

function attr(element: XmlElement, name: string): string | null {
  const value = element.getAttribute(name);
  return value === null ? null : value.trim();
}

function enumAttr<T extends string>(element: XmlElement, name: string, values: readonly T[]): T {
  const value = requiredAttr(element, name);
  if (!values.includes(value as T)) throw new Error(`CPLayout XML ${localName(element)} has unsupported ${name}: ${value}.`);
  return value as T;
}

function finiteNumberAttr(element: XmlElement, name: string): number {
  return finiteNumber(requiredAttr(element, name), name);
}

function positiveNumberAttr(element: XmlElement, name: string): number {
  const value = finiteNumberAttr(element, name);
  if (value <= 0) throw new Error(`CPLayout XML ${name} must be positive.`);
  return value;
}

function nonNegativeNumberAttr(element: XmlElement, name: string): number {
  const value = finiteNumberAttr(element, name);
  if (value < 0) throw new Error(`CPLayout XML ${name} must not be negative.`);
  return value;
}

function finiteNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`CPLayout XML ${label} must be a finite number.`);
  return parsed;
}

function booleanAttr(element: XmlElement, name: string, fallback?: boolean): boolean {
  const value = attr(element, name);
  if (value === null || value.length === 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`CPLayout XML ${localName(element)} is missing ${name}.`);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`CPLayout XML ${name} must be true or false.`);
}

function isPointWgs84(value: unknown): value is { type: "Point"; point: LonLat } {
  return isRecord(value) && value.type === "Point" && isRecord(value.point);
}

function isCircleWgs84(value: unknown): value is { type: "Circle"; center: LonLat } {
  return isRecord(value) && value.type === "Circle" && isRecord(value.center);
}

function isVertexWgs84(value: unknown): value is { type: "LineString" | "Polygon"; vertices: LonLat[] } {
  return isRecord(value) && Array.isArray(value.vertices);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
