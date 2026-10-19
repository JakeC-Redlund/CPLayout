import type { Feature, FeatureCollection, Geometry, GeometryCollection, LineString, MultiPolygon, Point, Polygon, Position } from "geojson";
import { toKML } from "@placemarkio/tokml";
import { kml as kmlToGeoJson } from "@tmcw/togeojson";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

import { projectLonLatToXy, projectXyToLonLat } from "./coordinates";
import { assertMetricCalculationCrs, qualifyProjectCrs } from "./crsQualification";
import { normalizeCrsName } from "./units";
import { admitProjectGeometryImport } from "./projectGeometryImport";
import type { LayoutResult, MultiPolygonXY, ObstacleZone, PivotProject, ProjectMapFeature, ProjectMapFeatureKind, SourceConfidence, SurveyPoint, XY } from "./types";

const OBSTACLE_KINDS = ["road", "ditch", "fence", "building", "canal", "tree", "exclusion"] as const;
const POINT_ROLES = ["boundary", "pivot_center", "water_source", "power_source", "obstacle", "control", "note"] as const;
const MAP_FEATURE_KINDS = [
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
] as const;
const CONFIDENCES = ["rtk_fixed", "rtk_float", "dgps", "autonomous_gps", "imagery_digitized", "imported_cad", "user_estimated", "optimized"] as const;
const KML_NAMESPACE = "http://www.opengis.net/kml/2.2";
const GX_NAMESPACE = "http://www.google.com/kml/ext/2.2";
const GX_LITERAL_CONSUMERS = new Set(["Track", "MultiTrack", "LatLonQuad", "altitudeMode"]);

interface GoogleEarthStyleDefinition {
  id: string;
  iconColor?: string;
  iconScale?: string;
  labelColor?: string;
  labelScale?: string;
  lineColor?: string;
  lineWidth?: string;
  polygonColor?: string;
  polygonFill?: "0" | "1";
  polygonOutline?: "0" | "1";
}

const GOOGLE_EARTH_KML_STYLES: GoogleEarthStyleDefinition[] = [
  {
    id: "cplayout-layout-base-coverage",
    labelColor: "ff174568",
    labelScale: "0.72",
    lineColor: "ff1c6ba0",
    lineWidth: "1.8",
    polygonColor: "334f9edc",
    polygonFill: "1",
    polygonOutline: "1",
  },
  {
    id: "cplayout-layout-end-gun",
    labelColor: "ff075985",
    labelScale: "0.72",
    lineColor: "ff0ea5e9",
    lineWidth: "1.6",
    polygonColor: "2846c7e8",
    polygonFill: "1",
    polygonOutline: "1",
  },
  {
    id: "cplayout-layout-allowed-coverage",
    labelColor: "ff14532d",
    labelScale: "0.78",
    lineColor: "ff16a34a",
    lineWidth: "2.2",
    polygonColor: "3d22c55e",
    polygonFill: "1",
    polygonOutline: "1",
  },
  {
    id: "cplayout-layout-outside-field",
    labelColor: "ff7c2d12",
    labelScale: "0.78",
    lineColor: "ffea580c",
    lineWidth: "2.4",
    polygonColor: "55f97316",
    polygonFill: "1",
    polygonOutline: "1",
  },
  {
    id: "cplayout-field-boundary",
    labelColor: "ff000000",
    labelScale: "1.05",
    lineColor: "ff000000",
    lineWidth: "4",
    polygonColor: "00000000",
    polygonFill: "0",
    polygonOutline: "1",
  },
  {
    id: "cplayout-obstacle-road",
    labelColor: "ff344054",
    labelScale: "0.9",
    lineColor: "ff475467",
    lineWidth: "2.4",
    polygonColor: "6657636f",
    polygonFill: "1",
    polygonOutline: "1",
  },
  {
    id: "cplayout-obstacle-water",
    labelColor: "ff164c63",
    labelScale: "0.9",
    lineColor: "ff0f80aa",
    lineWidth: "2.4",
    polygonColor: "6640a6cf",
    polygonFill: "1",
    polygonOutline: "1",
  },
  {
    id: "cplayout-obstacle-structure",
    labelColor: "ff42311f",
    labelScale: "0.9",
    lineColor: "ff8a572a",
    lineWidth: "2.4",
    polygonColor: "665c8cc7",
    polygonFill: "1",
    polygonOutline: "1",
  },
  {
    id: "cplayout-obstacle-vegetation",
    labelColor: "ff22543d",
    labelScale: "0.9",
    lineColor: "ff276749",
    lineWidth: "2.4",
    polygonColor: "6669a87d",
    polygonFill: "1",
    polygonOutline: "1",
  },
  {
    id: "cplayout-obstacle-exclusion",
    labelColor: "ff4a1d1d",
    labelScale: "0.9",
    lineColor: "ff9b1c1c",
    lineWidth: "2.4",
    polygonColor: "665f3dd9",
    polygonFill: "1",
    polygonOutline: "1",
  },
  {
    id: "cplayout-point-pivot",
    iconColor: "ff0f5db8",
    iconScale: "1.15",
    labelColor: "ff0f3d6e",
    labelScale: "1.0",
  },
  {
    id: "cplayout-point-water",
    iconColor: "ff0f93b8",
    iconScale: "1.05",
    labelColor: "ff0f4f6e",
    labelScale: "0.95",
  },
  {
    id: "cplayout-point-power",
    iconColor: "ff18a999",
    iconScale: "1.05",
    labelColor: "ff125e55",
    labelScale: "0.95",
  },
  {
    id: "cplayout-survey-point",
    iconColor: "ff2f6fed",
    iconScale: "0.9",
    labelColor: "ff1d4ed8",
    labelScale: "0.85",
  },
  {
    id: "cplayout-tower",
    iconColor: "ff5848d6",
    iconScale: "0.85",
    labelColor: "ff3f3cbb",
    labelScale: "0.82",
  },
  {
    id: "cplayout-map-point",
    iconColor: "ff1fa971",
    iconScale: "0.95",
    labelColor: "ff17634a",
    labelScale: "0.88",
  },
  {
    id: "cplayout-map-line-water",
    labelColor: "ff164c63",
    labelScale: "0.85",
    lineColor: "ff0f80aa",
    lineWidth: "3",
  },
  {
    id: "cplayout-map-line-power",
    labelColor: "ff125e55",
    labelScale: "0.85",
    lineColor: "ff18a999",
    lineWidth: "3",
  },
  {
    id: "cplayout-map-line-access",
    labelColor: "ff42311f",
    labelScale: "0.85",
    lineColor: "ff8a572a",
    lineWidth: "2.6",
  },
  {
    id: "cplayout-map-line-boundary",
    labelColor: "ff4a1d1d",
    labelScale: "0.85",
    lineColor: "ff9b1c1c",
    lineWidth: "2.6",
  },
];

export type GoogleEarthKmlImportClassification =
  | "field_boundary"
  | "planning_boundary"
  | "machine_zone"
  | "measurement_line"
  | "existing_pivot"
  | "obstacle"
  | "survey_point"
  | "map_feature"
  | "skipped";

export interface GoogleEarthKmlImportItem {
  id: string;
  name: string;
  classification: GoogleEarthKmlImportClassification;
  featureKind?: ProjectMapFeatureKind;
  geometryType: "Point" | "LineString" | "Polygon";
  selected: boolean;
  warning?: string;
}

export interface GoogleEarthKmlImportResult {
  project: PivotProject;
  importedBoundary: boolean;
  importedObstacleCount: number;
  importedSurveyPointCount: number;
  importedMapFeatureCount: number;
  skippedFeatureCount: number;
  items: GoogleEarthKmlImportItem[];
  warnings: string[];
}

export interface GoogleEarthKmlExportResult {
  kml: string;
  exportedFeatureCount: number;
  warnings: string[];
}

export interface GoogleEarthKmlImportOptions {
  observedAt?: string;
  selectedItemIds?: string[];
}

interface GoogleEarthLookAt {
  longitude: number;
  latitude: number;
  range: number;
}

interface PolygonCandidate {
  ring: XY[];
  name: string;
  properties: Record<string, unknown>;
  holeCount: number;
  source: "polygon" | "closed_linestring";
}

interface PointCandidate {
  projected: XY;
  wgs84: { longitude: number; latitude: number };
  name: string;
  properties: Record<string, unknown>;
}

interface LineCandidate {
  vertices: XY[];
  name: string;
  properties: Record<string, unknown>;
  source: "linestring" | "closed_linestring";
}

type ClassifiedCandidate =
  | { item: GoogleEarthKmlImportItem; kind: "field_boundary"; ring: XY[] }
  | { item: GoogleEarthKmlImportItem; kind: "obstacle"; candidate: PolygonCandidate }
  | { item: GoogleEarthKmlImportItem; kind: "survey_point"; candidate: PointCandidate }
  | { item: GoogleEarthKmlImportItem; kind: "map_feature"; feature: ProjectMapFeature };

export function importGoogleEarthKmlToProject(
  project: PivotProject,
  kmlText: string,
  options: GoogleEarthKmlImportOptions = {},
): GoogleEarthKmlImportResult {
  const geoJson = parseGoogleEarthKml(kmlText);
  const warnings: string[] = [];
  const polygonCandidates: PolygonCandidate[] = [];
  const pointCandidates: PointCandidate[] = [];
  const lineCandidates: LineCandidate[] = [];
  let skippedFeatureCount = 0;

  geoJson.features.forEach((feature, featureIndex) => {
    const properties = featureProperties(feature);
    const name = readStringProperty(properties, ["name", "label"]) ?? `KML feature ${featureIndex + 1}`;
    const extracted = extractCandidatesFromGeometry(feature.geometry, properties, name, project.projectCrs, warnings);
    polygonCandidates.push(...extracted.polygons);
    pointCandidates.push(...extracted.points);
    lineCandidates.push(...extracted.lines);
    skippedFeatureCount += extracted.skipped;
  });

  if (polygonCandidates.length === 0 && pointCandidates.length === 0 && lineCandidates.length === 0) {
    throw new Error("KML/KMZ import did not contain supported Polygon, LineString, or Point placemarks.");
  }

  const selectedItemIds = options.selectedItemIds ? new Set(options.selectedItemIds) : null;
  const classified: ClassifiedCandidate[] = [];
  const usedItemIds = new Set<string>();
  const reservedItemIds = new Set([...polygonCandidates, ...pointCandidates, ...lineCandidates]
    .map((candidate, index) => candidateItemId(candidate.properties, candidate.name, index + 1)));
  const nextItemId = (properties: Record<string, unknown>, name: string) => {
    const preferred = candidateItemId(properties, name, classified.length + 1);
    let itemId = preferred;
    let suffix = 2;
    while (usedItemIds.has(itemId)) {
      itemId = `${preferred}-${suffix++}`;
      while (reservedItemIds.has(itemId)) itemId = `${preferred}-${suffix++}`;
    }
    usedItemIds.add(itemId);
    return itemId;
  };

  for (const candidate of polygonCandidates) {
    const itemId = nextItemId(candidate.properties, candidate.name);
    if (isLayoutResultCandidate(candidate.properties)) {
      skippedFeatureCount += 1;
      continue;
    }
    const geometryWarning = candidate.holeCount > 0
      ? `KML polygon "${candidate.name}" contains inner rings (holes) that cannot be retained. Provide a single outer ring or exclude this item, and preserve the complete original input.` : undefined;
    if (geometryWarning && selectedByDefault(itemId, selectedItemIds)) throw new Error(geometryWarning);
    const mapFeatureKind = explicitMapFeatureKindFromProperties(candidate.properties) ?? polygonMapFeatureKindFromName(candidate.name);
    if (mapFeatureKind) {
      classified.push({
        item: {
          id: itemId,
          name: candidate.name,
          classification: importClassificationForMapFeatureKind(mapFeatureKind),
          featureKind: mapFeatureKind,
          geometryType: "Polygon",
          selected: selectedByDefault(itemId, selectedItemIds),
          warning: itemWarning(geometryWarning, mapFeatureImportWarning(mapFeatureKind)),
        },
        kind: "map_feature",
        feature: mapFeatureFromPolygon(project, candidate, itemId, mapFeatureKind),
      });
    } else if (isBoundaryCandidate(candidate.properties, candidate.name)) {
      const selected = selectedByDefault(itemId, selectedItemIds);
      classified.push({
        item: {
          id: itemId,
          name: candidate.name,
          classification: "field_boundary",
          geometryType: "Polygon",
          selected,
          warning: geometryWarning,
        },
        kind: "field_boundary",
        ring: candidate.ring,
      });
    } else {
      classified.push({
        item: {
          id: itemId,
          name: candidate.name,
          classification: "obstacle",
          geometryType: "Polygon",
          selected: selectedByDefault(itemId, selectedItemIds),
          warning: geometryWarning,
        },
        kind: "obstacle",
        candidate,
      });
    }
  }

  for (const candidate of pointCandidates) {
    const itemId = nextItemId(candidate.properties, candidate.name);
    const mapFeatureKind = mapFeatureKindFromProperties(candidate.properties, candidate.name);
    if (mapFeatureKind) {
      classified.push({
        item: {
          id: itemId,
          name: candidate.name,
          classification: importClassificationForMapFeatureKind(mapFeatureKind),
          featureKind: mapFeatureKind,
          geometryType: "Point",
          selected: selectedByDefault(itemId, selectedItemIds),
          warning: mapFeatureImportWarning(mapFeatureKind),
        },
        kind: "map_feature",
        feature: mapFeatureFromPoint(candidate, itemId, mapFeatureKind),
      });
    } else {
      const role = pointRoleFromProperties(candidate.properties, candidate.name);
      classified.push({
        item: {
          id: itemId,
          name: candidate.name,
          classification: role === "pivot_center" ? "existing_pivot" : "survey_point",
          geometryType: "Point",
          selected: selectedByDefault(itemId, selectedItemIds),
          warning: role === "pivot_center"
            ? "Existing pivot evidence only; applying the import adds a survey point and does not move the active pivot center."
            : undefined,
        },
        kind: "survey_point",
        candidate,
      });
    }
  }

  for (const candidate of lineCandidates) {
    const itemId = nextItemId(candidate.properties, candidate.name);
    const mapFeatureKind = mapFeatureKindFromProperties(candidate.properties, candidate.name) ?? lineMapFeatureKindFromName(candidate.name);
    if (isPolygonLineCandidate(candidate.properties, candidate.name) && candidate.source === "closed_linestring") {
      const polygonCandidate: PolygonCandidate = {
        ring: candidate.vertices,
        name: candidate.name,
        properties: candidate.properties,
        holeCount: 0,
        source: "closed_linestring",
      };
      const isBoundary = isBoundaryCandidate(candidate.properties, candidate.name);
      classified.push({
        item: {
          id: itemId,
          name: candidate.name,
          classification: isBoundary ? "field_boundary" : "obstacle",
          geometryType: "LineString",
          selected: selectedByDefault(itemId, selectedItemIds),
          warning: "Closed LineString polygonized by explicit boundary/obstacle classification.",
        },
        ...(isBoundary
          ? { kind: "field_boundary" as const, ring: candidate.vertices }
          : { kind: "obstacle" as const, candidate: polygonCandidate }),
      });
    } else if (isPolygonLineCandidate(candidate.properties, candidate.name)) {
      skippedFeatureCount += 1;
      warnings.push(`Skipped open LineString "${candidate.name}" because polygon boundary/obstacle imports must be closed.`);
    } else if (mapFeatureKind) {
      const warning = itemWarning(
        candidate.source === "closed_linestring" ? "Closed utility LineString kept as a line and closing duplicate removed." : undefined,
        mapFeatureImportWarning(mapFeatureKind),
      );
      if (warning) warnings.push(`${warning} "${candidate.name}".`);
      classified.push({
        item: {
          id: itemId,
          name: candidate.name,
          classification: importClassificationForMapFeatureKind(mapFeatureKind),
          featureKind: mapFeatureKind,
          geometryType: "LineString",
          selected: selectedByDefault(itemId, selectedItemIds),
          warning,
        },
        kind: "map_feature",
        feature: mapFeatureFromLine(project, candidate, itemId, mapFeatureKind),
      });
    } else {
      skippedFeatureCount += 1;
      warnings.push(`Skipped LineString "${candidate.name}" because it was not classified as a utility feature, boundary, or obstacle.`);
    }
  }

  // Classify closed boundary lines before considering the legacy first-polygon fallback.
  if (!classified.some(candidate => candidate.kind === "field_boundary")) {
    const firstPolygon = classified.find((candidate): candidate is Extract<ClassifiedCandidate, { kind: "obstacle" }> => candidate.kind === "obstacle");
    if (firstPolygon) {
      classified.splice(classified.indexOf(firstPolygon), 1, {
        item: {
          ...firstPolygon.item,
          classification: "field_boundary",
          selected: selectedByDefault(firstPolygon.item.id, selectedItemIds),
          warning: itemWarning(firstPolygon.item.warning, `No explicit field_boundary metadata found; "${firstPolygon.item.name}" is selected as the field boundary.`),
        },
        kind: "field_boundary",
        ring: firstPolygon.candidate.ring,
      });
      warnings.push(`No explicit field_boundary metadata found; imported "${firstPolygon.item.name}" as the field boundary.`);
    }
  }

  let fieldBoundary: XY[] | null = null;
  const selectedClassified = classified.filter((candidate) => candidate.item.selected);
  for (const candidate of selectedClassified) {
    if (candidate.kind !== "field_boundary") continue;
    if (fieldBoundary) {
      throw new Error("KML field boundary must be a single polygon ring from one boundary item. Select one boundary item or provide a single-component boundary, and preserve the complete original input.");
    } else {
      fieldBoundary = candidate.ring;
    }
  }

  const existingObstacleIds = new Set(project.obstacles.map((obstacle) => obstacle.id));
  const obstacles = selectedClassified.filter((candidate): candidate is Extract<ClassifiedCandidate, { kind: "obstacle" }> => candidate.kind === "obstacle").map(({ candidate }, index): ObstacleZone => {
    const kind = obstacleKindFromProperties(candidate.properties, candidate.name);
    const id = uniqueId(
      existingObstacleIds,
      readStringProperty(candidate.properties, ["id", "@id"]) ?? `${kind}-kml-${project.obstacles.length + index + 1}`,
    );
    if (candidate.source === "closed_linestring") {
      warnings.push(`Imported closed LineString "${candidate.name}" as a polygon ring.`);
    }
    return {
      id,
      name: candidate.name,
      kind,
      polygon: candidate.ring,
      bufferMeters: finiteNumber(readProperty(candidate.properties, ["bufferMeters", "buffer_meters"]), 0),
      hardConflict: booleanOrDefault(readProperty(candidate.properties, ["hardConflict", "hard_conflict"]), true),
      noSpray: booleanOrDefault(readProperty(candidate.properties, ["noSpray", "no_spray"]), true),
      confidence: confidenceOrDefault(readStringProperty(candidate.properties, ["confidence", "sourceConfidence"]), "imagery_digitized"),
    };
  });

  const existingSurveyIds = new Set(project.surveyPoints.map((point) => point.id));
  const observedAt = options.observedAt ?? new Date().toISOString();
  const surveyPoints = selectedClassified.filter((candidate): candidate is Extract<ClassifiedCandidate, { kind: "survey_point" }> => candidate.kind === "survey_point").map(({ candidate }, index): SurveyPoint => {
    const id = uniqueId(
      existingSurveyIds,
      readStringProperty(candidate.properties, ["id", "@id"]) ?? `kml-point-${project.surveyPoints.length + index + 1}`,
    );
    return {
      id,
      label: candidate.name,
      role: pointRoleFromProperties(candidate.properties, candidate.name),
      projected: candidate.projected,
      wgs84: candidate.wgs84,
      observedAt,
      source: "imported",
      confidence: confidenceOrDefault(readStringProperty(candidate.properties, ["confidence", "sourceConfidence"]), "imagery_digitized"),
      notes: readStringProperty(candidate.properties, ["description", "notes"]) ?? undefined,
    };
  });
  const existingMapFeatureIds = new Set((project.mapFeatures ?? []).map(feature => feature.id));
  const mapFeatures = selectedClassified
    .filter((candidate): candidate is Extract<ClassifiedCandidate, { kind: "map_feature" }> => candidate.kind === "map_feature")
    // Reserve only admitted features, across all geometry kinds, without changing discovery item IDs.
    .map(({ feature }) => ({ ...feature, id: uniqueId(existingMapFeatureIds, feature.id) }));

  const nextProject = admitProjectGeometryImport(project, {
    ...project,
    fieldBoundary: fieldBoundary ?? project.fieldBoundary,
    obstacles: [...project.obstacles, ...obstacles],
    surveyPoints: [...project.surveyPoints, ...surveyPoints],
    mapFeatures: [...(project.mapFeatures ?? []), ...mapFeatures],
  });

  return {
    project: nextProject,
    importedBoundary: Boolean(fieldBoundary),
    importedObstacleCount: obstacles.length,
    importedSurveyPointCount: surveyPoints.length,
    importedMapFeatureCount: mapFeatures.length,
    skippedFeatureCount,
    items: classified.map((candidate) => candidate.item),
    warnings: dedupe(warnings),
  };
}

export function exportProjectGoogleEarthKml(project: PivotProject, result?: LayoutResult): GoogleEarthKmlExportResult {
  if (project.drawingMetadata !== undefined) throw new Error("This format cannot retain classified drawing metadata; use the lossless project document or project ZIP archive.");
  if (result || (project.mapFeatures ?? []).some((feature) => feature.geometry.type === "Circle")) {
    assertMetricCalculationCrs(project.projectCrs);
  }
  const warnings: string[] = [];
  const features: Feature[] = [];

  if (result) {
    features.push(...layoutCoverageFeatures(project, result));
  }

  features.push(polygonFeature("Field boundary", "field_boundary", closeRing(project.fieldBoundary, project.projectCrs), {
    projectId: project.id,
    projectCrs: project.projectCrs,
  }));

  for (const obstacle of project.obstacles) {
    features.push(polygonFeature(obstacle.name, "obstacle", closeRing(obstacle.polygon, project.projectCrs), {
      id: obstacle.id,
      kind: obstacle.kind,
      confidence: obstacle.confidence,
      bufferMeters: String(obstacle.bufferMeters),
      hardConflict: String(obstacle.hardConflict),
      noSpray: String(obstacle.noSpray),
      projectId: project.id,
      projectCrs: project.projectCrs,
    }));
  }

  features.push(pointFeature("Pivot center", "pivot_center", project.pivotCenter, project.projectCrs, {
    projectId: project.id,
    projectCrs: project.projectCrs,
    ...cornerArmKmlProperties(project),
  }));
  features.push(pointFeature("Water source", "water_source", project.waterSource, project.projectCrs, { projectId: project.id, projectCrs: project.projectCrs }));
  features.push(pointFeature("Power source", "power_source", project.powerSource, project.projectCrs, { projectId: project.id, projectCrs: project.projectCrs }));

  for (const point of project.surveyPoints) {
    features.push(pointFeature(point.label, point.role, point.projected, project.projectCrs, {
      id: point.id,
      source: point.source,
      confidence: point.confidence,
      observedAt: point.observedAt,
      notes: point.notes ?? "",
      projectId: project.id,
      projectCrs: project.projectCrs,
    }));
  }

  for (const mapFeature of project.mapFeatures ?? []) {
    const baseProperties = {
      id: mapFeature.id,
      kind: mapFeature.kind,
      confidence: mapFeature.confidence,
      notes: mapFeature.notes ?? "",
      projectId: project.id,
      projectCrs: project.projectCrs,
      cplayoutFeatureType: "map_feature",
    };
    if (mapFeature.geometry.type === "Point") {
      features.push(pointFeature(mapFeature.name, mapFeature.kind, mapFeature.geometry.point, project.projectCrs, baseProperties));
    } else if (mapFeature.geometry.type === "LineString") {
      features.push(lineFeature(mapFeature.name, mapFeature.kind, mapFeature.geometry.vertices, project.projectCrs, baseProperties));
    } else if (mapFeature.geometry.type === "Polygon") {
      features.push(polygonFeature(mapFeature.name, mapFeature.kind, closeRing(mapFeature.geometry.vertices, project.projectCrs), baseProperties));
    } else {
      features.push(polygonFeature(mapFeature.name, mapFeature.kind, closeRing(circleVertices(mapFeature.geometry.center, mapFeature.geometry.radiusMeters), project.projectCrs), {
        ...baseProperties,
        mapFeatureGeometry: "Circle",
        centerX: String(mapFeature.geometry.center.x),
        centerY: String(mapFeature.geometry.center.y),
        radiusMeters: String(mapFeature.geometry.radiusMeters),
      }));
    }
  }

  if (result) {
    for (const tower of result.towers) {
      features.push(pointFeature(`Tower ${tower.towerIndex}`, "tower", tower.point, project.projectCrs, {
        towerIndex: String(tower.towerIndex),
        radiusMeters: String(tower.radiusMeters),
        projectId: project.id,
        projectCrs: project.projectCrs,
      }));
    }
  }

  const featureCollection: FeatureCollection = { type: "FeatureCollection", features };
  const kml = addGoogleEarthKmlStyles(toKML(featureCollection), googleEarthLookAt(project, result));
  return {
    kml,
    exportedFeatureCount: features.length,
    warnings,
  };
}

function cornerArmKmlProperties(project: PivotProject): Record<string, string> {
  const cornerArm = project.machine.cornerArm;
  const driveUnits = driveUnitKmlProperties(project);
  if (!cornerArm) return driveUnits;
  return {
    ...driveUnits,
    cornerArmAdvisoryOnly: "true",
    cornerArmCanonicalGeometryMutation: "false",
    cornerArmId: cornerArm.id,
    cornerArmName: cornerArm.name,
    cornerArmLengthMeters: String(cornerArm.lengthMeters),
    ...(cornerArm.wheelTrackLengthMeters !== undefined ? { cornerArmWheelTrackLengthMeters: String(cornerArm.wheelTrackLengthMeters) } : {}),
    ...(cornerArm.overhangLengthMeters !== undefined ? { cornerArmOverhangLengthMeters: String(cornerArm.overhangLengthMeters) } : {}),
    ...(cornerArm.maxSteerAngleDegrees !== undefined ? { cornerArmMaxSteerAngleDegrees: String(cornerArm.maxSteerAngleDegrees) } : {}),
    ...(cornerArm.minSteerAngleDegrees !== undefined ? { cornerArmMinSteerAngleDegrees: String(cornerArm.minSteerAngleDegrees) } : {}),
    ...(cornerArm.maxExtensionRateMetersPerMinute !== undefined ? { cornerArmMaxExtensionRateMetersPerMinute: String(cornerArm.maxExtensionRateMetersPerMinute) } : {}),
    ...(cornerArm.maxRetractionRateMetersPerMinute !== undefined ? { cornerArmMaxRetractionRateMetersPerMinute: String(cornerArm.maxRetractionRateMetersPerMinute) } : {}),
    ...(cornerArm.metadataSource ? { cornerArmMetadataSource: cornerArm.metadataSource } : {}),
    ...(cornerArm.modelFamily ? { cornerArmModelFamily: cornerArm.modelFamily } : {}),
    cornerArmGuidanceType: cornerArm.guidanceType,
    cornerArmSequencingType: cornerArm.sequencingType,
    cornerArmOrientation: cornerArm.orientation,
    cornerArmConfidence: cornerArm.confidence,
    cornerArmSourceIds: cornerArm.sourceRefs.map((sourceRef) => sourceRef.sourceId).join(","),
    ...(cornerArm.speedEvidenceSourceRefs?.length ? { cornerArmSpeedEvidenceSourceIds: cornerArm.speedEvidenceSourceRefs.map((sourceRef) => sourceRef.sourceId).join(",") } : {}),
    cornerArmLimit: "Visual interchange metadata only; advisory corner-arm config does not alter projected XY or layout coverage metrics.",
  };
}

function driveUnitKmlProperties(project: PivotProject): Record<string, string> {
  const units = [project.machine.driveUnits?.lrdu, project.machine.driveUnits?.sdu].filter((unit) => unit !== undefined);
  if (units.length === 0) return {};
  return Object.fromEntries(units.flatMap((unit) => {
    const prefix = unit.role === "lrdu" ? "lrduDriveUnit" : "sduDriveUnit";
    return [
      [`${prefix}AdvisoryOnly`, "true"],
      [`${prefix}CanonicalGeometryMutation`, "false"],
      ...(unit.tire ? [[`${prefix}TireId`, unit.tire.id], [`${prefix}TireLabel`, unit.tire.label]] : []),
      ...(unit.driveMotor ? [[`${prefix}MotorId`, unit.driveMotor.id], [`${prefix}MotorLabel`, unit.driveMotor.label]] : []),
      ...(unit.customTireLabel ? [[`${prefix}CustomTireLabel`, unit.customTireLabel]] : []),
      ...(unit.customMotorRpm !== undefined ? [[`${prefix}CustomMotorRpm`, String(unit.customMotorRpm)]] : []),
      ...(unit.operatorMeasuredSpeedMetersPerMinute !== undefined ? [[`${prefix}OperatorMeasuredSpeedMetersPerMinute`, String(unit.operatorMeasuredSpeedMetersPerMinute)]] : []),
      [`${prefix}SourceIds`, unit.sourceRefs.map((sourceRef) => sourceRef.sourceId).join(",")],
      [`${prefix}Limit`, "Visual interchange metadata only; advisory drive-unit config does not alter projected XY, path geometry, or controller settings."],
    ];
  }));
}

function googleEarthLookAt(project: PivotProject, result?: LayoutResult): GoogleEarthLookAt {
  const points = allProjectLookAtPoints(project, result);
  const lonLats = points.map((point) => projectXyToLonLat(point, project.projectCrs));
  const longitudes = lonLats.map((point) => point.longitude);
  const latitudes = lonLats.map((point) => point.latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const longitude = (minLongitude + maxLongitude) / 2;
  const latitude = (minLatitude + maxLatitude) / 2;
  const longitudeMeters = Math.abs(maxLongitude - minLongitude) * 111320 * Math.cos(latitude * Math.PI / 180);
  const latitudeMeters = Math.abs(maxLatitude - minLatitude) * 110540;
  const range = Math.max(1200, Math.max(longitudeMeters, latitudeMeters) * 3.5);
  return { longitude, latitude, range };
}

function allProjectLookAtPoints(project: PivotProject, result?: LayoutResult): XY[] {
  const points: XY[] = [
    ...project.fieldBoundary,
    project.pivotCenter,
    project.waterSource,
    project.powerSource,
    ...project.surveyPoints.map((point) => point.projected),
  ];
  for (const obstacle of project.obstacles) {
    points.push(...obstacle.polygon);
  }
  for (const feature of project.mapFeatures ?? []) {
    if (feature.geometry.type === "Point") {
      points.push(feature.geometry.point);
    } else if (feature.geometry.type === "Circle") {
      points.push(feature.geometry.center);
    } else {
      points.push(...feature.geometry.vertices);
    }
  }
  if (result) {
    appendMultiPolygonPoints(points, result.baseCoverage);
    appendMultiPolygonPoints(points, result.endGunCoverage);
    appendMultiPolygonPoints(points, result.allowedCoverage);
    appendMultiPolygonPoints(points, result.outsideFieldCoverage);
    appendMultiPolygonPoints(points, result.obstacles);
    points.push(...result.towers.map((tower) => tower.point));
  }
  return points;
}

function appendMultiPolygonPoints(points: XY[], multiPolygon: MultiPolygonXY): void {
  for (const polygon of multiPolygon) {
    for (const ring of polygon) {
      points.push(...ring);
    }
  }
}

function layoutCoverageFeatures(project: PivotProject, result: LayoutResult): Feature[] {
  const baseProperties = {
    projectId: project.id,
    projectCrs: project.projectCrs,
    cplayoutFeatureType: "layout_result",
  };
  const features: Feature[] = [];
  if (hasRenderableMultiPolygon(result.baseCoverage)) {
    features.push(multiPolygonFeature("Base pivot wet circle", "base_coverage", result.baseCoverage, project.projectCrs, {
      ...baseProperties,
      radiusType: "machine_wet_radius",
    }));
  }
  if (hasRenderableMultiPolygon(result.endGunCoverage)) {
    features.push(multiPolygonFeature("End gun throw coverage", "end_gun_coverage", result.endGunCoverage, project.projectCrs, {
      ...baseProperties,
      acres: result.metrics.endGunAcres.toFixed(3),
    }));
  }
  if (hasRenderableMultiPolygon(result.allowedCoverage)) {
    features.push(multiPolygonFeature("Allowed irrigated coverage", "allowed_coverage", result.allowedCoverage, project.projectCrs, {
      ...baseProperties,
      acres: result.metrics.irrigatedAcres.toFixed(3),
      coveragePercent: result.metrics.coveragePercent.toFixed(2),
    }));
  }
  if (hasRenderableMultiPolygon(result.outsideFieldCoverage)) {
    features.push(multiPolygonFeature("Outside field wet coverage", "outside_field_coverage", result.outsideFieldCoverage, project.projectCrs, {
      ...baseProperties,
      acres: result.metrics.outsideFieldAcres.toFixed(3),
    }));
  }
  return features;
}

function addGoogleEarthKmlStyles(kmlText: string, lookAt: GoogleEarthLookAt): string {
  const document = new DOMParser().parseFromString(kmlText, "text/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    return kmlText;
  }

  const kmlDocument = firstElement(document.getElementsByTagName("Document"));
  if (!kmlDocument) return kmlText;

  kmlDocument.insertBefore(createLookAtElement(document, lookAt), kmlDocument.firstChild);
  for (const style of GOOGLE_EARTH_KML_STYLES) {
    kmlDocument.insertBefore(createKmlStyleElement(document, style), kmlDocument.firstChild);
  }

  const placemarks = Array.from(document.getElementsByTagName("Placemark")) as XmlElement[];
  for (const placemark of placemarks) {
    const styleId = styleIdForPlacemark(placemark);
    if (!styleId) continue;
    const styleUrl = document.createElementNS(KML_NAMESPACE, "styleUrl");
    styleUrl.appendChild(document.createTextNode(`#${styleId}`));
    const existingStyleUrl = firstElement(placemark.getElementsByTagName("styleUrl"));
    if (existingStyleUrl?.parentNode === placemark) {
      placemark.replaceChild(styleUrl, existingStyleUrl);
    } else {
      placemark.insertBefore(styleUrl, firstPlacemarkContentAfterName(placemark));
    }
  }

  return new XMLSerializer().serializeToString(document);
}

type XmlDocument = ReturnType<InstanceType<typeof DOMParser>["parseFromString"]>;
type XmlElement = ReturnType<XmlDocument["createElementNS"]>;

function createLookAtElement(document: XmlDocument, lookAt: GoogleEarthLookAt): XmlElement {
  const lookAtElement = document.createElementNS(KML_NAMESPACE, "LookAt");
  appendTextElement(document, lookAtElement, "longitude", lookAt.longitude.toFixed(8));
  appendTextElement(document, lookAtElement, "latitude", lookAt.latitude.toFixed(8));
  appendTextElement(document, lookAtElement, "altitude", "0");
  appendTextElement(document, lookAtElement, "heading", "0");
  appendTextElement(document, lookAtElement, "tilt", "0");
  appendTextElement(document, lookAtElement, "range", lookAt.range.toFixed(2));
  appendTextElement(document, lookAtElement, "altitudeMode", "clampToGround");
  return lookAtElement;
}

function createKmlStyleElement(document: XmlDocument, style: GoogleEarthStyleDefinition): XmlElement {
  const styleElement = document.createElementNS(KML_NAMESPACE, "Style");
  styleElement.setAttribute("id", style.id);
  if (style.iconColor || style.iconScale) {
    const iconStyle = document.createElementNS(KML_NAMESPACE, "IconStyle");
    appendTextElement(document, iconStyle, "color", style.iconColor);
    appendTextElement(document, iconStyle, "scale", style.iconScale);
    styleElement.appendChild(iconStyle);
  }
  if (style.labelColor || style.labelScale) {
    const labelStyle = document.createElementNS(KML_NAMESPACE, "LabelStyle");
    appendTextElement(document, labelStyle, "color", style.labelColor);
    appendTextElement(document, labelStyle, "scale", style.labelScale);
    styleElement.appendChild(labelStyle);
  }
  if (style.lineColor || style.lineWidth) {
    const lineStyle = document.createElementNS(KML_NAMESPACE, "LineStyle");
    appendTextElement(document, lineStyle, "color", style.lineColor);
    appendTextElement(document, lineStyle, "width", style.lineWidth);
    styleElement.appendChild(lineStyle);
  }
  if (style.polygonColor || style.polygonFill || style.polygonOutline) {
    const polyStyle = document.createElementNS(KML_NAMESPACE, "PolyStyle");
    appendTextElement(document, polyStyle, "color", style.polygonColor);
    appendTextElement(document, polyStyle, "fill", style.polygonFill);
    appendTextElement(document, polyStyle, "outline", style.polygonOutline);
    styleElement.appendChild(polyStyle);
  }
  return styleElement;
}

function appendTextElement(document: XmlDocument, parent: XmlElement, name: string, value: string | undefined): void {
  if (!value) return;
  const element = document.createElementNS(KML_NAMESPACE, name);
  element.appendChild(document.createTextNode(value));
  parent.appendChild(element);
}

function styleIdForPlacemark(placemark: XmlElement): string | null {
  const data = extendedDataValues(placemark);
  const layerType = normalizeStyleToken(data.layerType);
  const role = normalizeStyleToken(data.role);
  const kind = normalizeStyleToken(data.kind);
  const featureType = normalizeStyleToken(data.cplayoutFeatureType);
  const isPoint = Boolean(firstElement(placemark.getElementsByTagName("Point")));

  if (layerType === "field_boundary") return "cplayout-field-boundary";
  if (role === "pivot_center" || layerType === "pivot_center") return "cplayout-point-pivot";
  if (role === "water_source" || layerType === "water_source") return "cplayout-point-water";
  if (role === "power_source" || layerType === "power_source") return "cplayout-point-power";
  if (role === "tower" || layerType === "tower") return "cplayout-tower";
  if (layerType === "base_coverage") return "cplayout-layout-base-coverage";
  if (layerType === "end_gun_coverage") return "cplayout-layout-end-gun";
  if (layerType === "allowed_coverage") return "cplayout-layout-allowed-coverage";
  if (layerType === "outside_field_coverage") return "cplayout-layout-outside-field";
  if (featureType === "map_feature") return mapFeatureStyleId(kind, placemark);
  if (layerType === "obstacle" && !isPoint) return obstacleStyleId(kind);
  if (role) return "cplayout-survey-point";
  return null;
}

function obstacleStyleId(kind: string): string {
  if (kind === "road" || kind === "fence") return "cplayout-obstacle-road";
  if (kind === "ditch" || kind === "canal") return "cplayout-obstacle-water";
  if (kind === "building") return "cplayout-obstacle-structure";
  if (kind === "tree") return "cplayout-obstacle-vegetation";
  return "cplayout-obstacle-exclusion";
}

function mapFeatureStyleId(kind: string, placemark: XmlElement): string {
  if (firstElement(placemark.getElementsByTagName("Point"))) return "cplayout-map-point";
  if (kind === "underground_pipeline" || kind === "well_location" || kind === "ditch" || kind === "canal") return "cplayout-map-line-water";
  if (kind === "power_line" || kind === "underground_wire") return "cplayout-map-line-power";
  if (kind === "road" || kind === "access_lane") return "cplayout-map-line-access";
  if (
    kind === "fence"
    || kind === "planning_boundary"
    || kind === "machine_zone"
    || kind === "measurement_line"
    || kind === "end_gun_arc"
    || kind === "corner_swing_limit"
  ) return "cplayout-map-line-boundary";
  return "cplayout-map-line-access";
}

function extendedDataValues(placemark: XmlElement): Record<string, string> {
  const values: Record<string, string> = {};
  const dataElements = Array.from(placemark.getElementsByTagName("Data"));
  for (const dataElement of dataElements) {
    const name = dataElement.getAttribute("name");
    if (!name) continue;
    const valueElement = firstElement(dataElement.getElementsByTagName("value"));
    const value = valueElement?.textContent?.trim();
    if (value) values[name] = value;
  }
  return values;
}

function normalizeStyleToken(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function firstPlacemarkContentAfterName(placemark: XmlElement) {
  const children = Array.from(placemark.childNodes);
  const nameIndex = children.findIndex((child) => child.nodeType === 1 && (child as XmlElement).tagName === "name");
  return children.find((child, index) => index > nameIndex && child.nodeType === 1) ?? null;
}

function firstElement<T>(elements: { length: number; [index: number]: T }): T | null {
  return elements.length > 0 ? elements[0] : null;
}

function parseGoogleEarthKml(kmlText: string): FeatureCollection {
  if (!kmlText.trim()) throw new Error("KML import file is empty.");
  const document = new DOMParser().parseFromString(kmlText, "text/xml");

  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error("KML XML could not be parsed: invalid XML");
  }

  assertKmlElementNamesRetained(document);
  assertKmlPolygonRingsRetained(document);
  const geoJson = kmlToGeoJson(document) as FeatureCollection;
  if (!geoJson || geoJson.type !== "FeatureCollection" || !Array.isArray(geoJson.features)) {
    throw new Error("KML import did not convert to a GeoJSON FeatureCollection.");
  }
  return geoJson;
}

/** Validate the converter's actual namespace/query contract, without rewriting XML or claiming full schema validation. */
function assertKmlElementNamesRetained(document: XmlDocument): void {
  const root = document.documentElement;
  const baseNamespace = root?.namespaceURI ?? "";
  if (root?.localName !== "kml" || (baseNamespace !== KML_NAMESPACE && baseNamespace !== "")) {
    throw new Error("KML import has an unsupported KML root name or namespace. Export a copy with a KML 2.2 root (or the retained unqualified legacy form), and preserve the complete original input.");
  }
  const elements = Array.from(document.getElementsByTagNameNS("*", "*"));
  const { consumed, tracks, coords } = collectKmlConverterConsumers(document);
  const wrongNamespace = (element: XmlElement): never => {
    throw new Error(`KML import cannot retain unsupported XML namespace "${element.namespaceURI ?? "(none)"}" for ${element.tagName}. Export a copy using the supported KML/GX namespaces, and preserve the complete original input.`);
  };
  for (const element of elements) {
    const namespace = element.namespaceURI ?? "", localName = element.localName ?? element.tagName;
    if (element.prefix && namespace === KML_NAMESPACE) {
      throw new Error(`The current converter cannot retain namespace-prefixed KML elements (${element.tagName}). Export a copy using the default KML namespace and unprefixed KML element names, and preserve the complete original input.`);
    }
    if (namespace === GX_NAMESPACE && GX_LITERAL_CONSUMERS.has(localName)) {
      const bareSupported = element.tagName === element.localName && element.localName !== "LatLonQuad";
      if (element.tagName !== `gx:${element.localName}` && !bareSupported) {
        if (element.localName === "Track" || element.localName === "MultiTrack") {
          throw new Error(`The current converter cannot retain namespace aliases for GX Track/MultiTrack elements (${element.tagName}). Export a copy using the supported gx prefix for these structures, and preserve the complete original input.`);
        }
        throw new Error(`KML import cannot retain unsupported GX element names (${element.tagName}). Export a copy using the supported gx prefix, and preserve the complete original input.`);
      }
    }
    if (!consumed.has(element)) continue;
    if (element.prefix === "gx" && GX_LITERAL_CONSUMERS.has(localName)) {
      if (namespace !== GX_NAMESPACE) wrongNamespace(element);
    } else if (element.tagName === "Track" || element.tagName === "MultiTrack") {
      if (namespace !== baseNamespace && namespace !== GX_NAMESPACE) wrongNamespace(element);
    } else if (coords.has(element)) {
      if (namespace !== GX_NAMESPACE && !(element.tagName === "coord" && namespace === baseNamespace)) wrongNamespace(element);
    } else if (namespace !== baseNamespace && !(element.tagName === "altitudeMode" && namespace === GX_NAMESPACE)) {
      wrongNamespace(element);
    }
    const parent = element.parentNode?.nodeType === 1 ? element.parentNode as XmlElement : null;
    if (element.tagName === "Style" && !element.getAttribute("id") && parent?.localName === "CascadingStyle") {
      throw new Error("KML import cannot qualify the converter's operative CascadingStyle parent-id fallback. Export a copy with explicit ids on ordinary KML Style elements, and preserve the complete original input.");
    }
    // Literal descendant/global queries can consume correctly named payload hidden inside foreign XML.
    let ancestor = element.parentNode?.nodeType === 1 ? element.parentNode as XmlElement : null;
    while (ancestor) {
      if ((ancestor.namespaceURI ?? "") !== baseNamespace && ancestor.namespaceURI !== GX_NAMESPACE) wrongNamespace(ancestor);
      ancestor = ancestor.parentNode?.nodeType === 1 ? ancestor.parentNode as XmlElement : null;
    }
  }
  for (const track of tracks) {
    const coords = Array.from(track.getElementsByTagNameNS("*", "coord"));
    const bareCount = coords.filter(element => element.tagName === "coord").length;
    if (bareCount > 0 && bareCount < coords.length) {
      throw new Error("KML import cannot retain mixed GX coordinate forms: the converter would discard prefixed observations when a bare coord exists. Export a copy with one consistent coord form, and preserve the complete original input.");
    }
  }
}

/** Mirror the pinned converter's active first/all/direct-child reads; ignored extension payload is not a consumer. */
function collectKmlConverterConsumers(document: XmlDocument): { consumed: Set<XmlElement>; tracks: Set<XmlElement>; coords: Set<XmlElement> } {
  const consumed = new Set<XmlElement>(), tracks = new Set<XmlElement>(), coords = new Set<XmlElement>();
  const all = (node: XmlDocument | XmlElement, name: string): XmlElement[] => {
    const matches = Array.from(node.getElementsByTagName(name));
    for (const match of matches) consumed.add(match);
    return matches;
  };
  const first = (node: XmlElement, name: string): XmlElement | null => {
    const match = node.getElementsByTagName(name)[0] ?? null;
    if (match) consumed.add(match);
    return match;
  };
  const fields = (node: XmlElement, names: string[]) => { for (const name of names) first(node, name); };
  const children = (node: XmlElement) => Array.from(node.childNodes).filter((child): child is XmlElement => child.nodeType === 1);
  const iconHref = (node: XmlElement) => { const icon = first(node, "Icon"); if (icon) first(icon, "href"); };
  const style = (node: XmlElement) => {
    for (const [name, names] of [
      ["PolyStyle", ["color", "fill", "outline"]], ["LineStyle", ["color", "width"]],
      ["LabelStyle", ["color", "scale"]], ["IconStyle", ["color", "scale", "heading", "hotSpot"]],
    ] as const) {
      const selected = first(node, name);
      if (selected) { fields(selected, [...names]); if (name === "IconStyle") iconHref(selected); }
    }
  };
  const metadata = (node: XmlElement) => {
    fields(node, ["name", "address", "visibility", "open", "phoneNumber", "description", "styleUrl"]);
    style(node);
    const data = first(node, "ExtendedData");
    if (data) { for (const entry of all(data, "Data")) first(entry, "value"); all(data, "SimpleData"); }
    const span = first(node, "TimeSpan");
    if (span) fields(span, ["begin", "end"]);
    const stamp = first(node, "TimeStamp");
    if (stamp) first(stamp, "when");
  };
  const geometry = (node: XmlElement): void => {
    for (const child of children(node)) {
      switch (child.tagName) {
        case "MultiGeometry": case "MultiTrack": case "gx:MultiTrack":
          consumed.add(child); geometry(child); break;
        case "Point": case "LineString": case "LinearRing":
          consumed.add(child); first(child, "coordinates"); break;
        case "Polygon":
          consumed.add(child);
          for (const ring of all(child, "LinearRing")) first(ring, "coordinates");
          break;
        case "Track": case "gx:Track": {
          consumed.add(child); tracks.add(child);
          // Inspect both buckets: gxCoords prefers bare coord and otherwise reads every namespace.
          const observations = Array.from(child.getElementsByTagNameNS("*", "coord"));
          for (const observation of observations) { consumed.add(observation); coords.add(observation); }
          if (observations.length > 0) all(child, "when");
          break;
        }
      }
    }
  };
  for (const node of all(document, "Style")) style(node);
  for (const node of all(document, "StyleMap")) first(node, "styleUrl");
  all(document, "SimpleField");
  for (const node of all(document, "Placemark")) { geometry(node); metadata(node); }
  for (const node of all(document, "GroundOverlay")) {
    if (first(node, "gx:LatLonQuad")) first(node, "coordinates");
    else { const box = first(node, "LatLonBox"); if (box) fields(box, ["north", "west", "east", "south", "rotation"]); }
    metadata(node); iconHref(node);
  }
  for (const node of all(document, "NetworkLink")) {
    const region = first(node, "Region");
    if (region) {
      const box = first(region, "LatLonAltBox");
      if (box) { fields(box, ["north", "west", "east", "south"]); if (!first(box, "altitudeMode")) first(box, "gx:altitudeMode"); }
      const lod = first(node, "Lod");
      if (lod) fields(lod, ["minLodPixels", "maxLodPixels", "minFadeExtent", "maxFadeExtent"]);
    }
    metadata(node); iconHref(node); fields(node, ["refreshVisibility", "flyToView"]);
    const link = first(node, "Link");
    if (link) fields(link, ["href", "refreshMode", "refreshInterval", "viewRefreshMode", "viewRefreshTime", "viewBoundScale", "viewFormat", "httpQuery"]);
  }
  // CPLayout's pre-conversion polygon checks additionally read all these nodes, even if no feature selects them.
  for (const polygon of all(document, "Polygon")) {
    for (const boundary of children(polygon).filter(child => child.tagName === "outerBoundaryIs" || child.tagName === "innerBoundaryIs")) consumed.add(boundary);
    for (const ring of all(polygon, "LinearRing")) all(ring, "coordinates");
  }
  return { consumed, tracks, coords };
}

/** togeojson omits short rings and can reinterpret an inner-only polygon as an exterior. */
function assertKmlPolygonRingsRetained(document: XmlDocument): void {
  const children = (element: XmlElement) => Array.from(element.childNodes)
    .filter((child): child is XmlElement => child.nodeType === 1);
  for (const polygon of Array.from(document.getElementsByTagName("Polygon"))) {
    const boundaries = children(polygon).filter(child => child.tagName === "outerBoundaryIs" || child.tagName === "innerBoundaryIs");
    const outer = boundaries.filter(boundary => boundary.tagName === "outerBoundaryIs");
    if (outer.length !== 1 || boundaries[0] !== outer[0]
      || polygon.getElementsByTagName("LinearRing").length !== boundaries.length) {
      throw new Error("KML polygon must contain one outer boundary followed by its inner rings. Preserve the complete original input and repair the polygon before importing.");
    }
    for (const boundary of boundaries) {
      const rings = children(boundary).filter(child => child.tagName === "LinearRing");
      if (rings.length !== 1 || rings[0].getElementsByTagName("coordinates").length !== 1) {
        throw new Error("KML polygon boundary must contain one LinearRing with one coordinates element; ambiguous ring data cannot be retained.");
      }
      const text = rings[0].getElementsByTagName("coordinates")[0].textContent?.trim() ?? "";
      const positions = text ? text.split(/\s+/).map(tuple => tuple.split(",").map(value => value.trim() ? Number(value) : NaN)) : [];
      if (positions.some(position => position.length < 2 || position.length > 3 || !position.every(Number.isFinite)
        || position[0] < -180 || position[0] > 180 || position[1] < -90 || position[1] > 90)) {
        throw new Error("KML polygon ring contains invalid WGS84 coordinates. Preserve the complete original input and repair the ring before importing.");
      }
      const first = positions[0], last = positions.at(-1);
      const closed = first && last && first[0] === last[0] && first[1] === last[1];
      if (positions.length - (closed ? 1 : 0) < 3) {
        throw new Error("KML polygon ring must contain at least three vertices before conversion; short rings cannot be discarded from an import.");
      }
    }
  }
}

function extractCandidatesFromGeometry(
  geometry: Geometry | null,
  properties: Record<string, unknown>,
  name: string,
  projectCrs: string,
  warnings: string[],
): { polygons: PolygonCandidate[]; points: PointCandidate[]; lines: LineCandidate[]; skipped: number } {
  // Derived layout output is intentionally non-importable; do not reinterpret it as project geometry.
  if (isLayoutResultCandidate(properties)) return { polygons: [], points: [], lines: [], skipped: 1 };
  if (!geometry) return { polygons: [], points: [], lines: [], skipped: 1 };
  switch (geometry.type) {
    case "Polygon":
      return {
        polygons: polygonCandidatesFromPolygon(geometry, properties, name, projectCrs, warnings),
        points: [],
        lines: [],
        skipped: 0,
      };
    case "MultiPolygon":
      return {
        polygons: geometry.coordinates.flatMap((coordinates, index) => polygonCandidatesFromCoordinates(
          coordinates,
          properties,
          geometry.coordinates.length === 1 ? name : `${name} ${index + 1}`,
          projectCrs,
          "polygon",
          warnings,
        )),
        points: [],
        lines: [],
        skipped: 0,
      };
    case "LineString": {
      const candidate = lineCandidateFromLineString(geometry, properties, name, projectCrs, warnings);
      return candidate ? { polygons: [], points: [], lines: [candidate], skipped: 0 } : { polygons: [], points: [], lines: [], skipped: 1 };
    }
    case "Point": {
      const point = pointCandidateFromPoint(geometry, properties, name, projectCrs, warnings);
      return point ? { polygons: [], points: [point], lines: [], skipped: 0 } : { polygons: [], points: [], lines: [], skipped: 1 };
    }
    case "GeometryCollection":
      return extractCandidatesFromGeometryCollection(geometry, properties, name, projectCrs, warnings);
    case "MultiPoint":
    case "MultiLineString":
      return { polygons: [], points: [], lines: [], skipped: 1 };
  }
}

function extractCandidatesFromGeometryCollection(
  geometry: GeometryCollection,
  properties: Record<string, unknown>,
  name: string,
  projectCrs: string,
  warnings: string[],
): { polygons: PolygonCandidate[]; points: PointCandidate[]; lines: LineCandidate[]; skipped: number } {
  return geometry.geometries.reduce(
    (accumulator, childGeometry, index) => {
      const child = extractCandidatesFromGeometry(
        childGeometry,
        properties,
        geometry.geometries.length === 1 ? name : `${name} ${index + 1}`,
        projectCrs,
        warnings,
      );
      accumulator.polygons.push(...child.polygons);
      accumulator.points.push(...child.points);
      accumulator.lines.push(...child.lines);
      accumulator.skipped += child.skipped;
      return accumulator;
    },
    { polygons: [] as PolygonCandidate[], points: [] as PointCandidate[], lines: [] as LineCandidate[], skipped: 0 },
  );
}

function polygonCandidatesFromPolygon(
  geometry: Polygon,
  properties: Record<string, unknown>,
  name: string,
  projectCrs: string,
  warnings: string[],
): PolygonCandidate[] {
  return polygonCandidatesFromCoordinates(geometry.coordinates, properties, name, projectCrs, "polygon", warnings);
}

function polygonCandidatesFromCoordinates(
  coordinates: Position[][],
  properties: Record<string, unknown>,
  name: string,
  projectCrs: string,
  source: PolygonCandidate["source"],
  warnings: string[],
): PolygonCandidate[] {
  const outerRing = coordinates[0];
  if (!outerRing) throw new Error(`KML polygon "${name}" must contain a valid outer ring. Preserve the complete original input and repair its coordinates before importing.`);
  const ring = ringFromPositions(outerRing, projectCrs, name, warnings);
  if (!ring) throw new Error(`KML polygon "${name}" contains invalid coordinates or too few ring vertices. Preserve the complete original input and repair the polygon before importing.`);
  return [{ ring, name, properties, holeCount: Math.max(0, coordinates.length - 1), source }];
}

function lineCandidateFromLineString(
  geometry: LineString,
  properties: Record<string, unknown>,
  name: string,
  projectCrs: string,
  warnings: string[],
): LineCandidate | null {
  const vertices = lineFromPositions(geometry.coordinates, projectCrs, name, warnings);
  if (!vertices) return null;
  return {
    vertices,
    name,
    properties,
    source: isClosedPositionRing(geometry.coordinates) ? "closed_linestring" : "linestring",
  };
}

function pointCandidateFromPoint(
  geometry: Point,
  properties: Record<string, unknown>,
  name: string,
  projectCrs: string,
  warnings: string[],
): PointCandidate | null {
  const lonLat = lonLatFromPosition(geometry.coordinates, name, warnings);
  if (!lonLat) return null;
  return {
    projected: projectLonLatToXy(lonLat, projectCrs),
    wgs84: lonLat,
    name,
    properties,
  };
}

function ringFromPositions(
  positions: Position[],
  projectCrs: string,
  name: string,
  warnings: string[],
): XY[] | null {
  if (positions.length < 4) return null;
  const points: XY[] = [];
  for (const position of positions) {
    const lonLat = lonLatFromPosition(position, name, warnings);
    if (!lonLat) return null;
    points.push(projectLonLatToXy(lonLat, projectCrs));
  }
  const normalized = removeClosingDuplicate(points);
  return normalized.length >= 3 ? normalized : null;
}

function lineFromPositions(
  positions: Position[],
  projectCrs: string,
  name: string,
  warnings: string[],
): XY[] | null {
  if (positions.length < 2) return null;
  const points: XY[] = [];
  for (const position of positions) {
    const lonLat = lonLatFromPosition(position, name, warnings);
    if (!lonLat) return null;
    points.push(projectLonLatToXy(lonLat, projectCrs));
  }
  const normalized = removeClosingDuplicate(points);
  return normalized.length >= 2 ? normalized : null;
}

function lonLatFromPosition(position: Position, name: string, warnings: string[]): { longitude: number; latitude: number } | null {
  const [longitude, latitude, altitude] = position;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (altitude !== undefined && Number.isFinite(altitude) && altitude !== 0) {
    warnings.push(`Ignored altitude values in "${name}".`);
  }
  return { longitude, latitude };
}

function isClosedPositionRing(positions: Position[]): boolean {
  if (positions.length < 4) return false;
  const first = positions[0];
  const last = positions[positions.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function closeRing(points: XY[], projectCrs: string): Position[] {
  const positions = points.map((point) => {
    const lonLat = projectXyToLonLat(point, projectCrs);
    return [lonLat.longitude, lonLat.latitude] as Position;
  });
  if (positions.length > 0) positions.push([...positions[0]]);
  return positions;
}

function polygonFeature(name: string, layerType: string, coordinates: Position[], properties: Record<string, string>): Feature {
  return {
    type: "Feature",
    properties: { name, layerType, ...properties },
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
  };
}

function multiPolygonFeature(name: string, layerType: string, multiPolygon: XY[][][], projectCrs: string, properties: Record<string, string>): Feature {
  return {
    type: "Feature",
    properties: { name, layerType, ...properties },
    geometry: {
      type: "MultiPolygon",
      coordinates: multiPolygon
        .filter((polygon) => polygon.length > 0 && polygon[0].length >= 3)
        .map((polygon) => polygon.map((ring) => closeRing(ring, projectCrs))),
    } satisfies MultiPolygon,
  };
}

function hasRenderableMultiPolygon(multiPolygon: XY[][][]): boolean {
  return multiPolygon.some((polygon) => polygon.some((ring) => ring.length >= 3));
}

function pointFeature(name: string, role: string, point: XY, projectCrs: string, properties: Record<string, string>): Feature {
  const lonLat = projectXyToLonLat(point, projectCrs);
  return {
    type: "Feature",
    properties: { name, role, layerType: role, ...properties },
    geometry: {
      type: "Point",
      coordinates: [lonLat.longitude, lonLat.latitude],
    },
  };
}

function lineFeature(name: string, layerType: string, vertices: XY[], projectCrs: string, properties: Record<string, string>): Feature {
  return {
    type: "Feature",
    properties: { name, layerType, ...properties },
    geometry: {
      type: "LineString",
      coordinates: vertices.map((point) => {
        const lonLat = projectXyToLonLat(point, projectCrs);
        return [lonLat.longitude, lonLat.latitude] as Position;
      }),
    },
  };
}

function featureProperties(feature: Feature): Record<string, unknown> {
  return isRecord(feature.properties) ? feature.properties : {};
}

function readProperty(properties: Record<string, unknown>, names: string[]): unknown {
  const entries = Object.entries(properties);
  for (const name of names) {
    const exact = properties[name];
    if (exact !== undefined) return exact;
    const lowerName = name.toLowerCase();
    const match = entries.find(([key]) => key.toLowerCase() === lowerName);
    if (match) return match[1];
  }
  return undefined;
}

function readStringProperty(properties: Record<string, unknown>, names: string[]): string | null {
  const value = readProperty(properties, names);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isBoundaryCandidate(properties: Record<string, unknown>, name: string): boolean {
  const layer = normalizedLayer(properties);
  if (layer === "field_boundary" || layer === "boundary") return true;
  const normalizedName = name.toLowerCase();
  return /\b(field|boundary)\b/.test(normalizedName);
}

function isLayoutResultCandidate(properties: Record<string, unknown>): boolean {
  const featureType = (readStringProperty(properties, ["cplayoutFeatureType", "cplayout_feature_type"]) ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
  const layer = normalizedLayer(properties);
  return featureType === "layout_result"
    || layer === "base_coverage"
    || layer === "end_gun_coverage"
    || layer === "allowed_coverage"
    || layer === "outside_field_coverage";
}

function obstacleKindFromProperties(properties: Record<string, unknown>, name: string): ObstacleZone["kind"] {
  const layer = normalizedLayer(properties);
  if (OBSTACLE_KINDS.includes(layer as ObstacleZone["kind"])) return layer as ObstacleZone["kind"];
  const normalizedName = name.toLowerCase();
  return OBSTACLE_KINDS.find((kind) => normalizedName.includes(kind)) ?? "exclusion";
}

function pointRoleFromProperties(properties: Record<string, unknown>, name: string): SurveyPoint["role"] {
  const layer = normalizedLayer(properties);
  if (POINT_ROLES.includes(layer as SurveyPoint["role"])) return layer as SurveyPoint["role"];
  const normalizedName = name.toLowerCase().replaceAll(" ", "_");
  if (/\bpivot\b/.test(name.toLowerCase())) return "pivot_center";
  return POINT_ROLES.find((role) => normalizedName.includes(role)) ?? "note";
}

function mapFeatureFromPoint(
  candidate: PointCandidate,
  id: string,
  kind: ProjectMapFeatureKind,
): ProjectMapFeature {
  return {
    id: readStringProperty(candidate.properties, ["id", "@id"]) ?? id,
    name: candidate.name,
    kind,
    geometry: { type: "Point", point: candidate.projected },
    confidence: confidenceOrDefault(readStringProperty(candidate.properties, ["confidence", "sourceConfidence"]), "imagery_digitized"),
    notes: readStringProperty(candidate.properties, ["description", "notes"]) ?? undefined,
    properties: mapFeatureProperties(candidate.properties, kind),
  };
}

function mapFeatureFromLine(
  project: PivotProject,
  candidate: LineCandidate,
  id: string,
  kind: ProjectMapFeatureKind,
): ProjectMapFeature {
  return {
    id: readStringProperty(candidate.properties, ["id", "@id"]) ?? id,
    name: candidate.name,
    kind,
    geometry: { type: "LineString", vertices: candidate.vertices },
    confidence: confidenceOrDefault(readStringProperty(candidate.properties, ["confidence", "sourceConfidence"]), "imagery_digitized"),
    notes: readStringProperty(candidate.properties, ["description", "notes"]) ?? undefined,
    properties: mapFeatureProperties(candidate.properties, kind, {
      lengthMeters: qualifyProjectCrs(project.projectCrs).calculation.allowed
        ? Number(lineStringLengthMeters(candidate.vertices).toFixed(3)) : null,
    }),
  };
}

function mapFeatureFromPolygon(
  project: PivotProject,
  candidate: PolygonCandidate,
  id: string,
  kind: ProjectMapFeatureKind,
): ProjectMapFeature {
  const requestedGeometry = readStringProperty(candidate.properties, ["mapFeatureGeometry", "map_feature_geometry"]);
  const centerX = readProperty(candidate.properties, ["centerX", "center_x"]);
  const centerY = readProperty(candidate.properties, ["centerY", "center_y"]);
  const radiusMeters = readProperty(candidate.properties, ["radiusMeters", "radius_meters"]);
  const sourceCrs = readStringProperty(candidate.properties, ["projectCrs", "project_crs"]);
  // Raw circle centers belong to the exporting grid; other grids keep the transformed polygon evidence.
  const circleGridMatches = sourceCrs !== null && sourceCrs !== undefined
    && normalizeCrsName(sourceCrs) === normalizeCrsName(project.projectCrs)
    && qualifyProjectCrs(project.projectCrs).calculation.allowed;
  const finiteCircleMetadata = [centerX, centerY, radiusMeters].every((value) =>
    (typeof value === "number" || (typeof value === "string" && value.trim().length > 0))
    && Number.isFinite(Number(value)));
  const geometry: ProjectMapFeature["geometry"] =
    circleGridMatches && requestedGeometry?.toLowerCase() === "circle" && finiteCircleMetadata
      ? {
        type: "Circle",
        center: { x: Number(centerX), y: Number(centerY) },
        radiusMeters: Number(radiusMeters),
      }
      : kind === "end_gun_arc" ? {
        type: "LineString",
        vertices: candidate.ring,
      } : {
        type: "Polygon",
        vertices: candidate.ring,
      };
  return {
    id: readStringProperty(candidate.properties, ["id", "@id"]) ?? id,
    name: candidate.name,
    kind,
    geometry,
    confidence: confidenceOrDefault(readStringProperty(candidate.properties, ["confidence", "sourceConfidence"]), "imagery_digitized"),
    notes: readStringProperty(candidate.properties, ["description", "notes"]) ?? undefined,
    properties: mapFeatureProperties(candidate.properties, kind),
  };
}

function mapFeatureProperties(
  properties: Record<string, unknown>,
  kind: ProjectMapFeatureKind,
  derived: Record<string, string | number | boolean | null> = {},
): Record<string, string | number | boolean | null> | undefined {
  const base = stringProperties(properties) ?? {};
  const advisoryKinds = new Set<ProjectMapFeatureKind>([
    "planning_boundary",
    "machine_zone",
    "linear_move_path",
    "measurement_line",
    "corner_swing_limit",
    "end_gun_arc",
  ]);
  const result = {
    ...base,
    ...derived,
    ...(advisoryKinds.has(kind)
      ? {
        advisoryOnly: true,
        canonicalGeometryMutation: false,
      }
      : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

function lineStringLengthMeters(vertices: XY[]): number {
  return vertices.slice(1).reduce((sum, vertex, index) => {
    const previous = vertices[index];
    return sum + Math.hypot(vertex.x - previous.x, vertex.y - previous.y);
  }, 0);
}

function candidateItemId(properties: Record<string, unknown>, name: string, fallbackIndex: number): string {
  return sanitizeId(readStringProperty(properties, ["id", "@id"]) ?? name) || `kml-item-${fallbackIndex}`;
}

function selectedByDefault(itemId: string, selectedItemIds: Set<string> | null): boolean {
  return selectedItemIds ? selectedItemIds.has(itemId) : true;
}

function mapFeatureKindFromProperties(properties: Record<string, unknown>, name: string): ProjectMapFeatureKind | null {
  const layer = normalizedLayer(properties);
  if (MAP_FEATURE_KINDS.includes(layer as typeof MAP_FEATURE_KINDS[number])) return layer as ProjectMapFeatureKind;
  const cplayoutKind = readStringProperty(properties, ["mapFeatureKind", "map_feature_kind", "utilityKind", "utility_kind"]);
  const normalizedKind = cplayoutKind?.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (MAP_FEATURE_KINDS.includes(normalizedKind as typeof MAP_FEATURE_KINDS[number])) return normalizedKind as ProjectMapFeatureKind;
  return mapFeatureKindFromName(name);
}

function mapFeatureKindFromName(name: string): ProjectMapFeatureKind | null {
  const normalizedName = name.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (/\bwell\b|\bwater_source\b/.test(normalizedName)) return "well_location";
  if (/\bwire\b|\belectric_cable\b|\bburied_power\b/.test(normalizedName)) return "underground_wire";
  if (/(^|_)(linear|lateral)(_)?(move|path|travel|track)(_path|_line|_route)?($|_)|\btravel_path\b/.test(normalizedName)) return "linear_move_path";
  if (/\b(distance|measurement|measure|length|lrdu)\b/.test(normalizedName)) return "measurement_line";
  if (/\b(machine|pivot)_?(zone|field|boundary)\b|\b(middle|south|north|east|west)_machine_field_boundary\b/.test(normalizedName)) return "machine_zone";
  if (normalizedName.includes("circle") && /(middle|south|north|east|west|machine|pivot|part)/.test(normalizedName)) return "machine_zone";
  if (/\bplanning_boundary\b|\bplanning_area\b|\bfull_scope\b|\bscope_boundary\b/.test(normalizedName)) return "planning_boundary";
  return MAP_FEATURE_KINDS.find((kind) => normalizedName.includes(kind)) ?? null;
}

function explicitMapFeatureKindFromProperties(properties: Record<string, unknown>): ProjectMapFeatureKind | null {
  const featureType = (readStringProperty(properties, ["cplayoutFeatureType", "cplayout_feature_type"]) ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
  if (featureType !== "map_feature") return null;
  const kind = mapFeatureKindFromProperties(properties, "");
  return kind ?? "corner_swing_limit";
}

function lineMapFeatureKindFromName(name: string): ProjectMapFeatureKind | null {
  const namedKind = mapFeatureKindFromName(name);
  if (namedKind) return namedKind;
  const normalizedName = name.toLowerCase();
  if (/\b(pipe|pipeline|water\s*line)\b/.test(normalizedName)) return "underground_pipeline";
  if (/\b(wire|buried\s*power|electric\s*cable)\b/.test(normalizedName)) return "underground_wire";
  if (/\b(linear|lateral)\s*(move|path|travel|track)(\s*(path|line|route))?\b|\btravel\s*path\b/.test(normalizedName)) return "linear_move_path";
  if (/\b(distance|measurement|measure|length|lrdu)\b/.test(normalizedName)) return "measurement_line";
  if (/\b(power|electric|utility)\s*line\b/.test(normalizedName)) return "power_line";
  if (/\b(access|lane)\b/.test(normalizedName)) return "access_lane";
  if (/\broad\b/.test(normalizedName)) return "road";
  if (/\bditch\b/.test(normalizedName)) return "ditch";
  if (/\bcanal\b/.test(normalizedName)) return "canal";
  if (/\bfence\b/.test(normalizedName)) return "fence";
  if (/\bend\s*gun\b/.test(normalizedName)) return "end_gun_arc";
  if (/\bcorner\b/.test(normalizedName)) return "corner_swing_limit";
  return null;
}

function polygonMapFeatureKindFromName(name: string): ProjectMapFeatureKind | null {
  const normalizedName = name.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (/\b(machine|pivot)_?(zone|field|boundary)\b|\b(middle|south|north|east|west)_machine_field_boundary\b/.test(normalizedName)) return "machine_zone";
  if (/\bplanning_boundary\b|\bplanning_area\b|\bscope_boundary\b/.test(normalizedName)) return "planning_boundary";
  return null;
}

function importClassificationForMapFeatureKind(kind: ProjectMapFeatureKind): GoogleEarthKmlImportClassification {
  if (kind === "planning_boundary") return "planning_boundary";
  if (kind === "machine_zone") return "machine_zone";
  if (kind === "measurement_line") return "measurement_line";
  if (kind === "linear_move_path") return "map_feature";
  return "map_feature";
}

function mapFeatureImportWarning(kind: ProjectMapFeatureKind): string | undefined {
  if (kind === "planning_boundary") return "Planning boundary evidence only; applying the import saves a map feature and does not replace the active field boundary unless selected as field_boundary.";
  if (kind === "machine_zone") return "Machine-zone evidence only; applying the import saves a map feature and does not create another pivot automatically.";
  if (kind === "linear_move_path") return "Linear/lateral move path evidence only; applying the import saves a travel path and does not create or apply a machine layout automatically.";
  if (kind === "measurement_line") return "Measurement-line evidence only; applying the import saves the line and derived length metadata.";
  return undefined;
}

function itemWarning(...warnings: Array<string | undefined>): string | undefined {
  const present = warnings.filter((warning): warning is string => Boolean(warning));
  return present.length > 0 ? present.join(" ") : undefined;
}

function isPolygonLineCandidate(properties: Record<string, unknown>, name: string): boolean {
  const layer = normalizedLayer(properties);
  return layer === "field_boundary" || layer === "boundary" || layer === "obstacle" || layer === "exclusion" || isBoundaryCandidate(properties, name);
}

function normalizedLayer(properties: Record<string, unknown>): string {
  return (readStringProperty(properties, ["layerType", "layer_type", "role", "kind", "type"]) ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
}

function stringProperties(properties: Record<string, unknown>): Record<string, string | number | boolean | null> | undefined {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
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

function confidenceOrDefault(value: string | null, fallback: SourceConfidence): SourceConfidence {
  return CONFIDENCES.includes(value as SourceConfidence) ? value as SourceConfidence : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

function uniqueId(existing: Set<string>, preferred: string): string {
  const base = sanitizeId(preferred) || "kml-import";
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  existing.add(candidate);
  return candidate;
}

function sanitizeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function removeClosingDuplicate(points: XY[]): XY[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first.x === last.x && first.y === last.y ? points.slice(0, -1) : points;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
