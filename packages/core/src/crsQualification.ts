import { assertProjectedCrs, normalizeCrsName } from "./units";

export interface SupportedUtmCrs {
  normalizedCrs: string;
  zone: number;
  hemisphere: "north" | "south";
  datum: "WGS84" | "NAD27" | "NAD83";
  unit: "metre";
  axes: "easting_northing";
  /** Projection in this datum, not authorization for a WGS84 datum transformation. */
  proj4Definition: string;
}

export interface LocalMetricDeclaration {
  projectCrs: string;
  unit: "metre";
  axes: "orthogonal_xy";
  evidenceReference: string;
}

export interface CrsQualificationOptions {
  /** Describes existing XY. Never infer this from a CRS label or display-unit preference. */
  localMetricDeclaration?: LocalMetricDeclaration;
}

export type CrsCalculationBlocker =
  | "legacy_crs_unreadable"
  | "unsupported_crs_definition"
  | "non_metric_units"
  | "geographic_input_only"
  | "web_mercator_display_only"
  | "local_metric_declaration_missing"
  | "local_metric_declaration_invalid";

export interface CrsQualification {
  projectCrs: string;
  normalizedCrs: string;
  /** CRS admission only; the document still needs its existing schema validator. */
  legacyDocumentCrsReadable: boolean;
  kind: "utm" | "web_mercator" | "local" | "geographic" | "unsupported";
  unit: "metre" | "us_survey_foot" | "degree" | "unknown";
  axes: "easting_northing" | "local_xy" | "latitude_longitude" | "longitude_latitude" | "unknown";
  calculation: {
    /** Planar grid/local arithmetic only, not ground lengths, physical acreage or GNSS admission. */
    allowed: boolean;
    space: "projected_grid" | "local_plane" | "none";
    blockers: CrsCalculationBlocker[];
  };
  wgs84Transform: "projection_only" | "display_only" | "unsupported_datum_operation" | "unavailable";
  field: {
    qualified: false;
    groundDistanceQualified: false;
    georeferencingQualified: false;
    accuracy3dQualified: false;
    areaOfUse: "missing";
    groundScale: "missing";
    datumOperation: "missing" | "unsupported" | "local_unreferenced";
    height: "missing";
    independentControl: "missing";
  };
}

/**
 * EPSG definitions from PROJ 9.4.0 data/sql/projected_crs.sql and axis.sql:
 * https://github.com/OSGeo/PROJ/blob/9.4.0/data/sql/projected_crs.sql
 * https://github.com/OSGeo/PROJ/blob/9.4.0/data/sql/axis.sql
 * All 165 entries checked with local projinfo: Cartesian east/north, metres, method 9807.
 * The rest of 267xx/269xx includes absent codes and State Plane, not additional UTM zones.
 */
export function getSupportedUtmCrs(projectCrs: string): SupportedUtmCrs | undefined {
  const normalizedCrs = normalizeCrsName(projectCrs);
  const match = /^EPSG:(\d{5})$/.exec(normalizedCrs);
  if (!match) return undefined;
  const code = Number(match[1]);
  let datum: SupportedUtmCrs["datum"];
  let hemisphere: SupportedUtmCrs["hemisphere"] = "north";
  if (code >= 32601 && code <= 32660) {
    datum = "WGS84";
  } else if (code >= 32701 && code <= 32760) {
    datum = "WGS84";
    hemisphere = "south";
  } else if (code >= 26701 && code <= 26722) {
    datum = "NAD27";
  } else if (code >= 26901 && code <= 26923) {
    datum = "NAD83";
  } else {
    return undefined;
  }
  const zone = code % 100;
  return {
    normalizedCrs, zone, hemisphere, datum, unit: "metre", axes: "easting_northing",
    proj4Definition: `+proj=utm +zone=${zone}${hemisphere === "south" ? " +south" : ""} +datum=${datum} +units=m +axis=enu +no_defs`,
  };
}

/** Read compatibility and calculation eligibility are separate; this never changes stored XY. */
export function qualifyProjectCrs(projectCrs: string, options: CrsQualificationOptions = {}): CrsQualification {
  const normalizedCrs = normalizeCrsName(projectCrs);
  const utm = getSupportedUtmCrs(normalizedCrs);
  const local = normalizedCrs === "LOCAL" || normalizedCrs.startsWith("LOCAL:");
  const webMercator = normalizedCrs === "EPSG:3857" || normalizedCrs === "EPSG:900913";
  const geographic = ["EPSG:4326", "CRS:84", "OGC:CRS84"].includes(normalizedCrs);
  let legacyDocumentCrsReadable = true;
  try {
    assertProjectedCrs(projectCrs);
  } catch {
    legacyDocumentCrsReadable = false;
  }

  const blockers: CrsCalculationBlocker[] = [];
  let unit: CrsQualification["unit"] = "unknown";
  let axes: CrsQualification["axes"] = "unknown";
  let space: CrsQualification["calculation"]["space"] = "none";
  if (!legacyDocumentCrsReadable) blockers.push("legacy_crs_unreadable");
  if (utm) {
    unit = utm.unit;
    axes = utm.axes;
    space = "projected_grid";
  } else if (local) {
    axes = "local_xy";
    const declaration = options.localMetricDeclaration;
    if (!declaration) {
      blockers.push("local_metric_declaration_missing");
    } else if (
      typeof declaration.projectCrs !== "string"
      || normalizeCrsName(declaration.projectCrs) !== normalizedCrs
      || declaration.unit !== "metre"
      || declaration.axes !== "orthogonal_xy"
      || typeof declaration.evidenceReference !== "string"
      || !declaration.evidenceReference.trim()
    ) {
      blockers.push("local_metric_declaration_invalid");
    } else {
      unit = "metre";
      space = "local_plane";
    }
  } else if (webMercator) {
    unit = "metre";
    axes = "easting_northing";
    blockers.push("web_mercator_display_only");
  } else if (geographic) {
    unit = "degree";
    axes = normalizedCrs === "EPSG:4326" ? "latitude_longitude" : "longitude_latitude";
    blockers.push("geographic_input_only");
  } else {
    blockers.push("unsupported_crs_definition");
    // EPSG:26741 is NAD27 / California zone I, EPSG axes 4497, unit 9003.
    if (normalizedCrs === "EPSG:26741") {
      unit = "us_survey_foot";
      axes = "easting_northing";
      blockers.push("non_metric_units");
    }
  }
  const unsupportedDatum = utm !== undefined && utm.datum !== "WGS84";
  return {
    projectCrs,
    normalizedCrs,
    legacyDocumentCrsReadable,
    kind: utm ? "utm" : local ? "local" : webMercator ? "web_mercator" : geographic ? "geographic" : "unsupported",
    unit,
    axes,
    calculation: { allowed: blockers.length === 0, space: blockers.length === 0 ? space : "none", blockers },
    wgs84Transform: unsupportedDatum ? "unsupported_datum_operation" : utm ? "projection_only" : webMercator ? "display_only" : "unavailable",
    // EPSG membership proves neither site/area suitability nor ground-scale, datum/epoch or height accuracy.
    field: {
      qualified: false,
      groundDistanceQualified: false,
      georeferencingQualified: false,
      accuracy3dQualified: false,
      areaOfUse: "missing",
      groundScale: "missing",
      datumOperation: local ? "local_unreferenced" : unsupportedDatum ? "unsupported" : "missing",
      height: "missing",
      independentControl: "missing",
    },
  };
}

export function assertMetricCalculationCrs(projectCrs: string, options: CrsQualificationOptions = {}): CrsQualification {
  const qualification = qualifyProjectCrs(projectCrs, options);
  if (!qualification.calculation.allowed) {
    throw new Error(`Metric planar calculations unavailable for ${projectCrs}: ${qualification.calculation.blockers.join(", ")}. Stored XY must remain unchanged.`);
  }
  return qualification;
}
