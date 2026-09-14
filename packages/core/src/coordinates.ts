import proj4 from "proj4";

import { getSupportedUtmCrs, qualifyProjectCrs } from "./crsQualification";
import type { LonLat, XY } from "./types";
import { assertProjectedCrs, normalizeCrsName } from "./units";

export const COORDINATE_FORMATS = [
  "decimal_degrees",
  "degrees_decimal_minutes",
  "degrees_minutes_seconds",
  "projected_local",
] as const;

export type CoordinateDisplayFormat = typeof COORDINATE_FORMATS[number];

export const COORDINATE_FORMAT_LABELS: Record<CoordinateDisplayFormat, string> = {
  decimal_degrees: "Decimal degrees",
  degrees_decimal_minutes: "Deg decimal min",
  degrees_minutes_seconds: "Deg min sec",
  projected_local: "Projected / local",
};

export interface CanonicalCoordinate {
  projected: XY;
  projectCrs: string;
  wgs84?: LonLat;
}

export type CoordinateParseResult =
  | { ok: true; coordinate: CanonicalCoordinate }
  | { ok: false; error: string };

const DECIMAL_NUMBER = String.raw`(?:\d+(?:\.\d*)?|\.\d+)`;
const SIGNED_NUMBER = String.raw`[+-]?${DECIMAL_NUMBER}(?:[eE][+-]?\d+)?`;
const PAIR_SEPARATOR = String.raw`(?:\s*[,;]\s*|\s+)`;
const WGS84_DEFINITION = "+proj=longlat +datum=WGS84 +no_defs";
const WEB_MERCATOR_DEFINITION = "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs";

export function parseCoordinateInput(input: string, format: CoordinateDisplayFormat, projectCrs: string): CoordinateParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a coordinate before applying it." };
  }

  if (format === "projected_local") {
    // Legacy XY input remains readable even when its CRS is ineligible for metric calculations.
    try {
      assertProjectedCrs(projectCrs);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Supported projected CRS required.",
      };
    }
    const suffix = /\s*\(([^()]+)\)$/.exec(trimmed);
    if (suffix && normalizeCrsName(suffix[1]) !== normalizeCrsName(projectCrs)) {
      return { ok: false, error: "Coordinate CRS suffix must match the selected project CRS." };
    }
    const values = suffix ? trimmed.slice(0, suffix.index).trim() : trimmed;
    const match = new RegExp(
      String.raw`^(?:X\s*[:=]?\s*)?(${SIGNED_NUMBER})${PAIR_SEPARATOR}(?:Y\s*[:=]?\s*)?(${SIGNED_NUMBER})$`,
      "i",
    ).exec(values);
    if (!match || !Number.isFinite(Number(match[1])) || !Number.isFinite(Number(match[2]))) {
      return { ok: false, error: "Projected coordinates need exactly two finite X and Y values." };
    }
    return {
      ok: true,
      coordinate: {
        projected: { x: Number(match[1]), y: Number(match[2]) },
        projectCrs,
      },
    };
  }

  const wgs84 = parseWgs84Input(trimmed, format);
  if (!wgs84.ok) return wgs84;

  try {
    return {
      ok: true,
      coordinate: {
        projected: projectLonLatToXy(wgs84.coordinate, projectCrs),
        projectCrs,
        wgs84: wgs84.coordinate,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not project WGS84 coordinate into the project CRS.",
    };
  }
}

export function parseWgs84Input(
  input: string,
  format: Exclude<CoordinateDisplayFormat, "projected_local">,
): { ok: true; coordinate: LonLat } | { ok: false; error: string } {
  const match = new RegExp(
    `^${angularAxisPattern("latitude", format)}${PAIR_SEPARATOR}${angularAxisPattern("longitude", format)}$`,
    "i",
  ).exec(input.trim());
  if (!match?.groups) {
    return {
      ok: false,
      error: `Enter exactly one latitude and longitude in ${COORDINATE_FORMAT_LABELS[format].toLowerCase()} format, with matching axis hemispheres.`,
    };
  }
  try {
    return validateLonLat({
      latitude: angularAxisToDecimal(match.groups, "latitude"),
      longitude: angularAxisToDecimal(match.groups, "longitude"),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid angular coordinate." };
  }
}

export function formatCoordinate(
  coordinate: CanonicalCoordinate,
  format: CoordinateDisplayFormat,
  precision = 6,
): string {
  assertFinitePair(coordinate.projected.x, coordinate.projected.y, "Coordinate formatting requires finite X and Y coordinates.");
  if (coordinate.wgs84) {
    const validated = validateLonLat(coordinate.wgs84);
    if (!validated.ok) throw new Error(validated.error);
  }
  if (format === "projected_local") {
    return `X ${fixedWithSign(coordinate.projected.x, 2)}, Y ${fixedWithSign(coordinate.projected.y, 2)} (${coordinate.projectCrs})`;
  }

  const wgs84 = coordinate.wgs84 ?? projectXyToLonLat(coordinate.projected, coordinate.projectCrs);
  if (format === "decimal_degrees") {
    return `${fixedWithSign(wgs84.latitude, precision)}, ${fixedWithSign(wgs84.longitude, precision)}`;
  }
  if (format === "degrees_decimal_minutes") {
    return `${formatDdm(wgs84.latitude, "latitude")} ${formatDdm(wgs84.longitude, "longitude")}`;
  }
  return `${formatDms(wgs84.latitude, "latitude")} ${formatDms(wgs84.longitude, "longitude")}`;
}

export function projectLonLatToXy(coordinate: LonLat, projectCrs: string): XY {
  const validated = validateLonLat(coordinate);
  if (!validated.ok) throw new Error(validated.error);
  const normalized = transformCrs(projectCrs);
  const [x, y] = proj4(WGS84_DEFINITION, normalized, [coordinate.longitude, coordinate.latitude]);
  assertFinitePair(x, y, "Projection returned invalid coordinates.");
  return { x, y };
}

export function projectXyToLonLat(point: XY, projectCrs: string): LonLat {
  assertFinitePair(point.x, point.y, "Inverse projection requires finite X and Y coordinates.");
  const normalized = transformCrs(projectCrs);
  const [longitude, latitude] = proj4(normalized, WGS84_DEFINITION, [point.x, point.y]);
  assertFinitePair(longitude, latitude, "Inverse projection returned invalid coordinates.");
  const validated = validateLonLat({ longitude, latitude });
  if (!validated.ok) throw new Error(validated.error);
  return { longitude, latitude };
}

export function coordinateExample(format: CoordinateDisplayFormat): string {
  switch (format) {
    case "decimal_degrees":
      return "40.7102367, -104.9878583";
    case "degrees_decimal_minutes":
      return "40 42.6142 N, 104 59.2715 W";
    case "degrees_minutes_seconds":
      return "40 42 36.852 N, 104 59 16.290 W";
    case "projected_local":
      return "410.00, 360.00";
  }
}

function angularAxisPattern(
  axis: "latitude" | "longitude",
  format: Exclude<CoordinateDisplayFormat, "projected_local">,
): string {
  const hemispheres = axis === "latitude" ? "NS" : "EW";
  const capture = (name: string, pattern: string) => `(?<${axis}${name}>${pattern})`;
  const degrees = format === "decimal_degrees" ? SIGNED_NUMBER : String.raw`[+-]?\d+`;
  let body = capture("Degrees", degrees);
  if (format === "decimal_degrees") {
    body += String.raw`(?:\s*°)?`;
  } else {
    body += String.raw`(?:\s*°\s*|\s+)`;
    body += capture("Minutes", format === "degrees_decimal_minutes" ? DECIMAL_NUMBER : String.raw`\d+`);
    if (format === "degrees_decimal_minutes") {
      body += String.raw`(?:\s*['\u2032\u2019])?`;
    } else {
      body += String.raw`(?:\s*['\u2032\u2019]\s*|\s+)`;
      body += capture("Seconds", DECIMAL_NUMBER);
      body += String.raw`(?:\s*["\u2033\u201d])?`;
    }
  }
  return `${capture("Prefix", `[${hemispheres}]`)}?\\s*${body}\\s*${capture("Suffix", `[${hemispheres}]`)}?`;
}

function angularAxisToDecimal(parts: Record<string, string>, axis: "latitude" | "longitude"): number {
  const degreeText = parts[`${axis}Degrees`];
  const degrees = Number(degreeText);
  const minutes = Number(parts[`${axis}Minutes`] ?? 0);
  const seconds = Number(parts[`${axis}Seconds`] ?? 0);
  const prefix = parts[`${axis}Prefix`];
  const suffix = parts[`${axis}Suffix`];
  if (prefix && suffix) throw new Error("Use only one hemisphere per coordinate axis.");
  const hemisphere = (prefix ?? suffix)?.toUpperCase();
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    throw new Error("Coordinate contains a non-numeric angle component.");
  }
  if (minutes >= 60 || minutes < 0) {
    throw new Error("Coordinate minutes must be between 0 and 60.");
  }
  if (seconds >= 60 || seconds < 0) {
    throw new Error("Coordinate seconds must be between 0 and 60.");
  }

  const signFromHemisphere = hemisphere === "S" || hemisphere === "W" ? -1 : 1;
  const signFromDegree = degreeText.startsWith("-") ? -1 : 1;
  const explicitSign = /^[+-]/.test(degreeText);
  if (hemisphere && explicitSign && signFromDegree !== signFromHemisphere) {
    throw new Error("Coordinate sign conflicts with its hemisphere.");
  }
  const sign = hemisphere ? signFromHemisphere : signFromDegree;
  const value = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  const decimal = sign * value;
  const limit = axis === "latitude" ? 90 : 180;
  if (Math.abs(decimal) > limit) {
    throw new Error(`${axis === "latitude" ? "Latitude" : "Longitude"} is outside its valid range.`);
  }
  return decimal;
}

function validateLonLat(coordinate: LonLat): { ok: true; coordinate: LonLat } | { ok: false; error: string } {
  if (!Number.isFinite(coordinate.latitude) || coordinate.latitude < -90 || coordinate.latitude > 90) {
    return { ok: false, error: "Latitude must be between -90 and 90 degrees." };
  }
  if (!Number.isFinite(coordinate.longitude) || coordinate.longitude < -180 || coordinate.longitude > 180) {
    return { ok: false, error: "Longitude must be between -180 and 180 degrees." };
  }
  return { ok: true, coordinate };
}

function transformCrs(projectCrs: string): string {
  const normalized = normalizeCrsName(projectCrs);
  assertProjectedCrs(normalized);
  if (normalized === "LOCAL" || normalized.startsWith("LOCAL:")) {
    throw new Error("WGS84 transforms are unavailable for a LOCAL project CRS.");
  }
  const qualification = qualifyProjectCrs(normalized);
  if (qualification.wgs84Transform === "unsupported_datum_operation") {
    throw new Error(`WGS84 transforms for ${normalized} require a verified datum operation; none is configured.`);
  }
  if (qualification.wgs84Transform === "display_only") return WEB_MERCATOR_DEFINITION;
  const utm = getSupportedUtmCrs(normalized);
  if (utm?.datum === "WGS84") return utm.proj4Definition;
  // Do not trust external proj4 registrations or infer a UTM zone from an unqualified EPSG code.
  throw new Error(`Unsupported CRS definition for WGS84 transforms: ${normalized}. Stored XY must remain unchanged.`);
}

function fixedWithSign(value: number, precision: number): string {
  return Object.is(value, -0) ? `-${value.toFixed(precision)}` : value.toFixed(precision);
}

function formatDdm(value: number, axis: "latitude" | "longitude"): string {
  // Round total display units before splitting, so 60 minutes carries into degrees.
  const ticks = Math.round(Math.abs(value) * 60 * 10000);
  const degrees = Math.floor(ticks / 600000);
  const minutes = (ticks % 600000) / 10000;
  return `${degrees}° ${minutes.toFixed(4)}' ${hemisphereFor(value, axis)}`;
}

function formatDms(value: number, axis: "latitude" | "longitude"): string {
  const ticks = Math.round(Math.abs(value) * 3600 * 100);
  const degrees = Math.floor(ticks / 360000);
  const minutes = Math.floor((ticks % 360000) / 6000);
  const seconds = (ticks % 6000) / 100;
  return `${degrees}° ${minutes}' ${seconds.toFixed(2)}" ${hemisphereFor(value, axis)}`;
}

function hemisphereFor(value: number, axis: "latitude" | "longitude"): "N" | "S" | "E" | "W" {
  const negative = value < 0 || Object.is(value, -0);
  if (axis === "latitude") return negative ? "S" : "N";
  return negative ? "W" : "E";
}

function assertFinitePair(a: number, b: number, message: string): void {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new Error(message);
  }
}
