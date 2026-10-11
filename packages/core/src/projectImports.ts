import { refreshInheritedDrawingMetadata } from "./drawingProjectMutation";
import { projectDataKey } from "./projectDataComparison";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { PivotProjectSchema } from "./projectDocument";
import type { ObstacleZone, PivotProject, SourceConfidence, SurveyPoint, XY } from "./types";
import { assertProjectedCrs, normalizeCrsName } from "./units";

type RecordLike = Record<string, unknown>;

const OBSTACLE_KINDS = ["road", "ditch", "fence", "building", "canal", "tree", "exclusion"] as const;
const POINT_ROLES = ["boundary", "pivot_center", "water_source", "power_source", "obstacle", "control", "note"] as const;
const SOURCES = ["device_gps", "external_gnss", "imported", "manual"] as const;
const CONFIDENCES = ["rtk_fixed", "rtk_float", "dgps", "autonomous_gps", "imagery_digitized", "imported_cad", "user_estimated", "optimized"] as const;

export interface ProjectGeoJsonImportResult {
  project: PivotProject;
  importedBoundary: boolean;
  importedObstacleCount: number;
}

export interface SurveyCsvImportResult {
  project: PivotProject;
  importedPointCount: number;
}

export function importProjectedGeoJsonToProject(project: PivotProject, input: string | unknown): ProjectGeoJsonImportResult {
  const geoJson = snapshotJsonValue(typeof input === "string" ? JSON.parse(input) : input, "GeoJSON import");
  if (!isRecord(geoJson) || geoJson.type !== "FeatureCollection" || !Array.isArray(geoJson.features)) {
    throw new Error("GeoJSON import must be a FeatureCollection.");
  }

  const crsName = readGeoJsonProjectCrs(geoJson);
  if (!crsName) {
    throw new Error("Projected GeoJSON import must include root properties.projectCrs matching the project CRS.");
  }
  try {
    assertProjectedCrs(crsName);
  } catch (error) {
    if (/Projected CRS required/.test(error instanceof Error ? error.message : "")) {
      throw new Error("GeoJSON imports must already be projected into the project CRS; WGS84 is an input/display layer only.");
    }
    throw error;
  }
  if (normalizeCrsName(crsName) !== normalizeCrsName(project.projectCrs)) {
    throw new Error(`GeoJSON CRS ${crsName} does not match project CRS ${project.projectCrs}.`);
  }

  let fieldBoundary: XY[] | null = null;
  const obstacles: ObstacleZone[] = [];

  for (const rawFeature of geoJson.features) {
    if (!isRecord(rawFeature) || !isRecord(rawFeature.geometry)) continue;
    const properties = isRecord(rawFeature.properties) ? rawFeature.properties : {};
    const layerType = String(properties.layerType ?? properties.role ?? properties.kind ?? "").toLowerCase();
    const rings = outerRingsFromGeometry(rawFeature.geometry);
    if (rings.length === 0) continue;

    if (layerType === "field_boundary" || layerType === "boundary") {
      fieldBoundary = rings[0];
      continue;
    }

    const kind = obstacleKindFromLayer(layerType);
    if (kind) {
      rings.forEach((ring, index) => {
        const name = String(properties.name ?? properties.label ?? `${kind} import ${obstacles.length + 1}`);
        obstacles.push({
          id: String(properties.id ?? `${kind}-import-${project.obstacles.length + obstacles.length + 1}-${index + 1}`),
          name,
          kind,
          polygon: ring,
          bufferMeters: finiteNumber(properties.bufferMeters, 0),
          hardConflict: properties.hardConflict === undefined ? true : Boolean(properties.hardConflict),
          noSpray: properties.noSpray === undefined ? true : Boolean(properties.noSpray),
          confidence: confidenceOrDefault(properties.confidence, "imported_cad"),
        });
      });
    }
  }

  if (!fieldBoundary && obstacles.length === 0) {
    throw new Error("GeoJSON import did not contain a field_boundary or obstacle/exclusion feature.");
  }

  const candidate: PivotProject = {
    ...project,
    fieldBoundary: fieldBoundary ?? project.fieldBoundary,
    obstacles: [...project.obstacles, ...obstacles],
  };
  if (fieldBoundary && projectDataKey(fieldBoundary) !== projectDataKey(project.fieldBoundary)) {
    delete candidate.fieldBoundaryCaptureEvidence;
  }
  // Refresh inherited capture times before admission, including vertex-count changes.
  const nextProject = PivotProjectSchema.parse(refreshInheritedDrawingMetadata(project, candidate));

  return {
    project: nextProject,
    importedBoundary: Boolean(fieldBoundary),
    importedObstacleCount: obstacles.length,
  };
}

export function importSurveyCsvToProject(project: PivotProject, csv: string): SurveyCsvImportResult {
  const rows = parseCsv(csv).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (rows.length < 2) throw new Error("Survey CSV import must include a header row and at least one point row.");

  const header = rows[0].map((cell) => cell.trim());
  const headerIndex = new Map(header.map((name, index) => [name, index]));
  for (const required of ["x", "y"]) {
    if (!headerIndex.has(required)) {
      throw new Error("Survey CSV import must include projected x and y columns.");
    }
  }

  const importedPoints = rows.slice(1).map((row, index): SurveyPoint => {
    const pointIndex = project.surveyPoints.length + index + 1;
    const x = requiredNumber(rowAt(row, headerIndex, "x"), "x");
    const y = requiredNumber(rowAt(row, headerIndex, "y"), "y");
    const longitude = optionalNumber(rowAt(row, headerIndex, "longitude"));
    const latitude = optionalNumber(rowAt(row, headerIndex, "latitude"));
    return {
      id: rowAt(row, headerIndex, "id") || `survey-import-${pointIndex}`,
      label: rowAt(row, headerIndex, "label") || `Survey import ${pointIndex}`,
      role: oneOf(rowAt(row, headerIndex, "role"), POINT_ROLES, "note"),
      projected: { x, y },
      wgs84: longitude !== null && latitude !== null ? { longitude, latitude } : undefined,
      observedAt: rowAt(row, headerIndex, "observedAt") || new Date(0).toISOString(),
      source: oneOf(rowAt(row, headerIndex, "source"), SOURCES, "imported"),
      confidence: oneOf(rowAt(row, headerIndex, "confidence"), CONFIDENCES, "imported_cad"),
      notes: rowAt(row, headerIndex, "notes") || undefined,
    };
  });

  const nextProject = PivotProjectSchema.parse({
    ...project,
    surveyPoints: [...project.surveyPoints, ...importedPoints],
  });
  return { project: nextProject, importedPointCount: importedPoints.length };
}

function readGeoJsonProjectCrs(geoJson: RecordLike): string | null {
  const properties = isRecord(geoJson.properties) ? geoJson.properties : {};
  if (typeof properties.projectCrs === "string") return properties.projectCrs;
  return null;
}

function outerRingsFromGeometry(geometry: RecordLike): XY[][] {
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    const ring = ringFromCoordinates(geometry.coordinates[0]);
    return ring ? [ring] : [];
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates
      .map((polygon) => Array.isArray(polygon) ? ringFromCoordinates(polygon[0]) : null)
      .filter((ring): ring is XY[] => Boolean(ring));
  }
  return [];
}

function ringFromCoordinates(coordinates: unknown): XY[] | null {
  if (!Array.isArray(coordinates)) return null;
  const ring = coordinates.map((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
    const [x, y] = coordinate;
    return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  });
  if (ring.some((point) => point === null)) return null;
  const points = ring as XY[];
  const normalized = removeClosingDuplicate(points);
  return normalized.length >= 3 ? normalized : null;
}

function removeClosingDuplicate(points: XY[]): XY[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first.x === last.x && first.y === last.y ? points.slice(0, -1) : points;
}

function obstacleKindFromLayer(layerType: string): ObstacleZone["kind"] | null {
  if (layerType === "obstacle") return "exclusion";
  return OBSTACLE_KINDS.includes(layerType as ObstacleZone["kind"]) ? layerType as ObstacleZone["kind"] : null;
}

function confidenceOrDefault(value: unknown, fallback: SourceConfidence): SourceConfidence {
  return oneOf(typeof value === "string" ? value : "", CONFIDENCES, fallback);
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function rowAt(row: string[], headerIndex: Map<string, number>, name: string): string {
  const index = headerIndex.get(name);
  return index === undefined ? "" : (row[index] ?? "").trim();
}

function requiredNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Survey CSV ${label} value must be a finite number.`);
  return parsed;
}

function optionalNumber(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function oneOf<const T extends readonly string[]>(value: string, allowed: T, fallback: T[number]): T[number] {
  return allowed.includes(value as T[number]) ? value as T[number] : fallback;
}

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
