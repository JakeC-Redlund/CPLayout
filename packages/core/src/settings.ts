import { z } from "zod";

import { COORDINATE_FORMATS, type CoordinateDisplayFormat } from "./coordinates";
import type { TileScheme, UnitSystem } from "./types";
import { feetToMeters } from "./units";

export const MAP_STYLES = ["field_light", "high_contrast", "imagery_package", "topographic"] as const;
export type MapStyle = typeof MAP_STYLES[number];

export const OFFLINE_PACKAGE_TYPES = ["pmtiles", "mbtiles", "raster_tiles"] as const;
export type OfflinePackageType = typeof OFFLINE_PACKAGE_TYPES[number];

export const ONLINE_IMAGERY_PROVIDERS = ["usgs_imagery_only", "custom_open_xyz"] as const;
export type OnlineImageryProviderId = typeof ONLINE_IMAGERY_PROVIDERS[number];
export type OnlineImageryProjection = "EPSG:3857";
export type OnlineImageryCachePolicy = "interactive_only";

export const REFERENCE_OVERLAY_SCHEMAS = ["cplayout_reference_v1", "openmaptiles"] as const;
export type ReferenceOverlaySchema = typeof REFERENCE_OVERLAY_SCHEMAS[number];
export const REFERENCE_OVERLAY_MODES = ["auto", "manual", "off"] as const;
export type ReferenceOverlayMode = typeof REFERENCE_OVERLAY_MODES[number];
export const AERIAL_IMAGERY_MODES = ["auto", "manual", "off"] as const;
export type AerialImageryMode = typeof AERIAL_IMAGERY_MODES[number];

export const MAPPING_WORKFLOW_MODES = ["design", "layout"] as const;
export type MappingWorkflowMode = typeof MAPPING_WORKFLOW_MODES[number];

export const GPS_FIX_ORDER = ["invalid", "autonomous", "dgps", "ppp", "rtk_float", "rtk_fixed"] as const;
export type MinimumGpsFixType = typeof GPS_FIX_ORDER[number];

export interface DrawingSettings {
  vertexSnapToleranceMeters: number;
  featureSnapToleranceMeters: number;
  selectionTolerancePixels: number;
  panStepMeters: number;
  zoomStepFactor: number;
}

export interface GpsQualityThresholds {
  minimumFixType: MinimumGpsFixType;
  minSatellites: number;
  maxHdop: number;
  maxHorizontalAccuracyMeters: number;
  maxCorrectionAgeSeconds: number;
  maxObservationAgeSeconds: number;
}

export interface OfflineMapPreferences {
  preferredPackageType: OfflinePackageType;
  requireAttribution: true;
  allowNetworkTiles: false;
  packageDirectory: string;
}

export interface OnlineImageryPreferences {
  enabled: boolean;
  providerId: OnlineImageryProviderId;
  maxTilesPerView: number;
  customSource?: OnlineImageryCustomSource;
}

export interface ReferenceOverlayPreferences {
  mode: ReferenceOverlayMode;
  roads: boolean;
  borders: boolean;
  labels: boolean;
  sourcePackageId?: string;
  schema: ReferenceOverlaySchema;
}

export interface AerialImageryPreferences {
  mode: AerialImageryMode;
  sourcePackageId?: string;
}

export interface LayoutReviewSettings {
  requiredBoundaryClearanceMeters: number;
  showMachineBoundaryDistances: boolean;
}

export interface OnlineImageryProvider {
  id: OnlineImageryProviderId;
  name: string;
  tileUrlTemplate: string;
  minZoom: number;
  maxZoom: number;
  tileScheme: TileScheme;
  tileSize: number;
  projection: OnlineImageryProjection;
  coverageLabel: string;
  termsUrl?: string;
  sourceUrl?: string;
  cachePolicy: OnlineImageryCachePolicy;
  attribution: string;
  licenseText: string;
}

export type OnlineImageryCustomSource = Omit<OnlineImageryProvider, "id">;

export interface AppSettings {
  unitSystem: UnitSystem;
  coordinateDisplayFormat: CoordinateDisplayFormat;
  defaultZoomLevel: number;
  mappingWorkflowMode: MappingWorkflowMode;
  mapStyle: MapStyle;
  drawing: DrawingSettings;
  gpsQuality: GpsQualityThresholds;
  layoutReview: LayoutReviewSettings;
  offlineMaps: OfflineMapPreferences;
  aerialImagery: AerialImageryPreferences;
  onlineImagery: OnlineImageryPreferences;
  referenceOverlay: ReferenceOverlayPreferences;
}

export type ProjectSettings = Omit<AppSettings, "offlineMaps" | "onlineImagery" | "referenceOverlay"> & {
  offlineMaps: Omit<OfflineMapPreferences, "packageDirectory">;
};

export type DeepPartialSettings = {
  [K in keyof AppSettings]?: AppSettings[K] extends object ? Partial<AppSettings[K]> : AppSettings[K];
};

const UnitSystemSchema = z.enum(["metric", "us_survey_feet"]);
const CoordinateDisplayFormatSchema = z.enum(COORDINATE_FORMATS);
const MappingWorkflowModeSchema = z.enum(MAPPING_WORKFLOW_MODES).default("design");
const MapStyleSchema = z.enum(MAP_STYLES);
const OfflinePackageTypeSchema = z.enum(OFFLINE_PACKAGE_TYPES);
const OnlineImageryProviderIdSchema = z.enum(ONLINE_IMAGERY_PROVIDERS);
const ReferenceOverlaySchemaIdSchema = z.enum(REFERENCE_OVERLAY_SCHEMAS);
const ReferenceOverlayModeSchema = z.enum(REFERENCE_OVERLAY_MODES);
const AerialImageryModeSchema = z.enum(AERIAL_IMAGERY_MODES);
const TileSchemeSchema = z.enum(["xyz", "tms"]);
const MinimumGpsFixTypeSchema = z.enum(GPS_FIX_ORDER);
const OptionalUrlSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().url().optional(),
);

export const DrawingSettingsSchema = z.object({
  vertexSnapToleranceMeters: z.number().min(0.01).max(50),
  featureSnapToleranceMeters: z.number().min(0.01).max(100),
  selectionTolerancePixels: z.number().min(4).max(80),
  panStepMeters: z.number().min(1).max(5000),
  zoomStepFactor: z.number().min(1.05).max(4),
});

export const GpsQualityThresholdsSchema = z.object({
  minimumFixType: MinimumGpsFixTypeSchema,
  minSatellites: z.number().int().min(0).max(80),
  maxHdop: z.number().min(0.1).max(99),
  maxHorizontalAccuracyMeters: z.number().min(0.001).max(100),
  maxCorrectionAgeSeconds: z.number().min(0).max(3600),
  maxObservationAgeSeconds: z.number().min(0.1).max(60).default(2),
});

export const OfflineMapPreferencesSchema = z.object({
  preferredPackageType: OfflinePackageTypeSchema,
  requireAttribution: z.literal(true),
  allowNetworkTiles: z.literal(false),
  packageDirectory: z.string().min(1),
});

const OnlineImageryCustomSourceBaseSchema = z.object({
  name: z.string().trim().min(2).max(90),
  tileUrlTemplate: z.string().trim().min(1).max(2048),
  minZoom: z.number().int().min(0).max(23),
  maxZoom: z.number().int().min(0).max(23),
  tileScheme: TileSchemeSchema,
  tileSize: z.number().int().min(128).max(512),
  projection: z.literal("EPSG:3857"),
  coverageLabel: z.string().trim().min(2).max(160),
  termsUrl: OptionalUrlSchema,
  sourceUrl: OptionalUrlSchema,
  cachePolicy: z.literal("interactive_only"),
  attribution: z.string().trim().min(3).max(240),
  licenseText: z.string().trim().min(3).max(500),
});

export const OnlineImageryCustomSourceSchema = OnlineImageryCustomSourceBaseSchema.superRefine((source, context) => {
  const safetyError = customImagerySourceSafetyError(source);
  if (safetyError) {
    context.addIssue({
      code: "custom",
      message: safetyError,
      path: ["tileUrlTemplate"],
    });
  }
});

export const OnlineImageryPreferencesSchema = z.object({
  enabled: z.boolean(),
  providerId: OnlineImageryProviderIdSchema,
  maxTilesPerView: z.number().int().min(1).max(128),
  customSource: OnlineImageryCustomSourceSchema.optional(),
}).superRefine((preferences, context) => {
  if (preferences.enabled && preferences.providerId === "custom_open_xyz" && !preferences.customSource) {
    context.addIssue({
      code: "custom",
      message: "Custom open imagery requires a valid source before it can be enabled.",
      path: ["customSource"],
    });
  }
});

export const ReferenceOverlayPreferencesSchema = z.preprocess(
  (value) => {
    if (!isRecord(value)) return value;
    const record = { ...value } as Record<string, unknown>;
    if (record.mode === undefined && typeof record.enabled === "boolean") {
      record.mode = record.enabled ? "manual" : "off";
    }
    delete record.enabled;
    return record;
  },
  z.object({
    mode: ReferenceOverlayModeSchema.default("auto"),
    roads: z.boolean().default(true),
    borders: z.boolean().default(true),
    labels: z.boolean().default(true),
    sourcePackageId: z.string().trim().min(1).optional(),
    schema: ReferenceOverlaySchemaIdSchema.default("cplayout_reference_v1"),
  }),
);

export const AerialImageryPreferencesSchema = z.object({
  mode: AerialImageryModeSchema.default("auto"),
  sourcePackageId: z.string().trim().min(1).optional(),
}).default({ mode: "auto" });

export const DEFAULT_LAYOUT_SAFETY_ZONE_METERS = feetToMeters(15);

export const LayoutReviewSettingsSchema = z.object({
  requiredBoundaryClearanceMeters: z.number().min(0).max(1000).default(DEFAULT_LAYOUT_SAFETY_ZONE_METERS),
  showMachineBoundaryDistances: z.boolean().default(true),
}).default({
  requiredBoundaryClearanceMeters: DEFAULT_LAYOUT_SAFETY_ZONE_METERS,
  showMachineBoundaryDistances: true,
});

export const AppSettingsSchema = z.object({
  unitSystem: UnitSystemSchema,
  coordinateDisplayFormat: CoordinateDisplayFormatSchema,
  defaultZoomLevel: z.number().min(0.25).max(12),
  mappingWorkflowMode: MappingWorkflowModeSchema,
  mapStyle: MapStyleSchema,
  drawing: DrawingSettingsSchema,
  gpsQuality: GpsQualityThresholdsSchema,
  layoutReview: LayoutReviewSettingsSchema,
  offlineMaps: OfflineMapPreferencesSchema,
  aerialImagery: AerialImageryPreferencesSchema,
  onlineImagery: OnlineImageryPreferencesSchema,
  referenceOverlay: ReferenceOverlayPreferencesSchema,
});

export const ProjectSettingsSchema = AppSettingsSchema.omit({ offlineMaps: true, onlineImagery: true, referenceOverlay: true }).extend({
  offlineMaps: OfflineMapPreferencesSchema.omit({ packageDirectory: true }),
});

export function defaultAppSettings(): AppSettings {
  return {
    unitSystem: "us_survey_feet",
    coordinateDisplayFormat: "decimal_degrees",
    defaultZoomLevel: 1,
    mappingWorkflowMode: "design",
    mapStyle: "field_light",
    drawing: {
      vertexSnapToleranceMeters: 1,
      featureSnapToleranceMeters: 3,
      selectionTolerancePixels: 18,
      panStepMeters: 120,
      zoomStepFactor: 1.35,
    },
    gpsQuality: {
      minimumFixType: "rtk_fixed",
      minSatellites: 12,
      maxHdop: 1.2,
      maxHorizontalAccuracyMeters: 0.05,
      maxCorrectionAgeSeconds: 3,
      maxObservationAgeSeconds: 2,
    },
    layoutReview: {
      requiredBoundaryClearanceMeters: DEFAULT_LAYOUT_SAFETY_ZONE_METERS,
      showMachineBoundaryDistances: true,
    },
    offlineMaps: {
      preferredPackageType: "pmtiles",
      requireAttribution: true,
      allowNetworkTiles: false,
      packageDirectory: "offline-map-packages",
    },
    aerialImagery: {
      mode: "auto",
    },
    onlineImagery: {
      enabled: false,
      providerId: "usgs_imagery_only",
      maxTilesPerView: 64,
    },
    referenceOverlay: {
      mode: "auto",
      roads: true,
      borders: true,
      labels: true,
      schema: "cplayout_reference_v1",
    },
  };
}

export function defaultProjectSettings(): ProjectSettings {
  return projectSettingsFromApp(defaultAppSettings());
}

export function mergeAppSettings(settings?: DeepPartialSettings | ProjectSettings): AppSettings {
  const defaults = defaultAppSettings();
  return AppSettingsSchema.parse(deepMerge(defaults, settings ?? {}));
}

export function parseAppSettings(value: unknown): AppSettings {
  return AppSettingsSchema.parse(value);
}

export function projectSettingsFromApp(settings: AppSettings): ProjectSettings {
  return ProjectSettingsSchema.parse({
    unitSystem: settings.unitSystem,
    coordinateDisplayFormat: settings.coordinateDisplayFormat,
    defaultZoomLevel: settings.defaultZoomLevel,
    mappingWorkflowMode: settings.mappingWorkflowMode,
    mapStyle: settings.mapStyle,
    drawing: settings.drawing,
    gpsQuality: settings.gpsQuality,
    layoutReview: settings.layoutReview,
    offlineMaps: {
      preferredPackageType: settings.offlineMaps.preferredPackageType,
      requireAttribution: true,
      allowNetworkTiles: false,
    },
    aerialImagery: {
      mode: settings.aerialImagery.mode,
      sourcePackageId: settings.aerialImagery.sourcePackageId,
    },
  });
}

export const ONLINE_IMAGERY_PROVIDER_CATALOG: Record<OnlineImageryProviderId, OnlineImageryProvider> = {
  usgs_imagery_only: {
    id: "usgs_imagery_only",
    name: "USGS The National Map Imagery Only",
    tileUrlTemplate: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    minZoom: 0,
    maxZoom: 16,
    tileScheme: "xyz",
    tileSize: 256,
    projection: "EPSG:3857",
    coverageLabel: "United States orthoimagery; strongest coverage in CONUS NAIP areas",
    termsUrl: "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
    sourceUrl: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer",
    cachePolicy: "interactive_only",
    attribution: "USDA, USGS The National Map: Orthoimagery",
    licenseText: "USGS public National Map imagery service; availability, source age, and licensing vary by area. Do not bulk cache in CPLayout.",
  },
  custom_open_xyz: {
    id: "custom_open_xyz",
    name: "Custom open XYZ/WMTS source",
    tileUrlTemplate: "",
    minZoom: 0,
    maxZoom: 16,
    tileScheme: "xyz",
    tileSize: 256,
    projection: "EPSG:3857",
    coverageLabel: "User-provided open imagery source",
    cachePolicy: "interactive_only",
    attribution: "Attribution required for custom open imagery",
    licenseText: "Provide open imagery license text before enabling this source.",
  },
};

export const ONLINE_IMAGERY_PROVIDER_LIST = ONLINE_IMAGERY_PROVIDERS.map((providerId) => ONLINE_IMAGERY_PROVIDER_CATALOG[providerId]);

export function validateCustomOpenImagerySource(value: unknown): { ok: true; source: OnlineImageryCustomSource } | { ok: false; error: string } {
  const parsed = OnlineImageryCustomSourceSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Custom open imagery source is invalid." };
  }
  return { ok: true, source: parsed.data };
}

export function resolveOnlineImageryProvider(
  providerId: OnlineImageryProviderId,
  customSource?: OnlineImageryCustomSource,
): OnlineImageryProvider {
  if (providerId !== "custom_open_xyz") return ONLINE_IMAGERY_PROVIDER_CATALOG[providerId];
  const validation = validateCustomOpenImagerySource(customSource);
  if (!validation.ok) throw new Error(validation.error);
  return {
    id: "custom_open_xyz",
    ...validation.source,
  };
}

export function buildOnlineImageryTileUrl(provider: OnlineImageryProvider, tile: { z: number; x: number; y: number }): string {
  const sourceY = provider.tileScheme === "tms" ? flipTileY(tile.y, tile.z) : tile.y;
  const flippedY = flipTileY(tile.y, tile.z);
  const replacements: Record<string, string> = {
    z: String(tile.z),
    x: String(tile.x),
    y: String(sourceY),
    "-y": String(flippedY),
    level: String(tile.z),
    row: String(sourceY),
    col: String(tile.x),
    column: String(tile.x),
    tilematrix: String(tile.z),
    tilerow: String(sourceY),
    tilecol: String(tile.x),
  };
  return provider.tileUrlTemplate.replace(/\{([^{}]+)\}/g, (match, token: string) => {
    const replacement = replacements[token.trim().toLowerCase()];
    return replacement ?? match;
  });
}

export function gpsFixMeetsThreshold(fixType: MinimumGpsFixType | "unknown", minimumFixType: MinimumGpsFixType): boolean {
  if (fixType === "unknown") return false;
  return GPS_FIX_ORDER.indexOf(fixType) >= GPS_FIX_ORDER.indexOf(minimumFixType);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isRecord(base) || !isRecord(override)) return (override === undefined ? base : override) as T;
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    output[key] = isRecord(value) && isRecord(output[key])
      ? deepMerge(output[key], value)
      : value;
  }
  return output as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function customImagerySourceSafetyError(source: OnlineImageryCustomSource): string | null {
  if (source.minZoom > source.maxZoom) return "Custom imagery minimum zoom cannot be greater than maximum zoom.";
  const templateError = validateOnlineImageryUrlTemplate(source.tileUrlTemplate);
  if (templateError) return templateError;
  return null;
}

function validateOnlineImageryUrlTemplate(template: string): string | null {
  const trimmed = template.trim();
  if (trimmed.length === 0) return "Tile URL template is required.";
  if (/api[_-]?key|apikey|access[_-]?token|client[_-]?secret|subscription[_-]?key|signature|token=/i.test(trimmed)) {
    return "Custom imagery templates cannot include hidden API keys, tokens, signatures, or subscription credentials.";
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed.replace(/\{[^{}]+\}/g, "0"));
  } catch {
    return "Tile URL template must be a valid URL.";
  }

  if (parsedUrl.username || parsedUrl.password) return "Tile URL template cannot include embedded credentials.";
  if (parsedUrl.protocol !== "https:" && !isLocalHttpTileUrl(parsedUrl)) {
    return "Custom imagery sources must use HTTPS unless they are local self-hosted tile services.";
  }

  const blockedReason = blockedImageryHostReason(parsedUrl.hostname);
  if (blockedReason) return blockedReason;

  const credentialParam = Array.from(parsedUrl.searchParams.keys()).find((key) => /^(api[_-]?key|apikey|key|token|access[_-]?token|client[_-]?id|client[_-]?secret|subscription[_-]?key|signature|sig)$/i.test(key));
  if (credentialParam) {
    return `Custom imagery templates cannot include credential query parameter "${credentialParam}".`;
  }

  const tokens = Array.from(trimmed.matchAll(/\{([^{}]+)\}/g), (match) => match[1].trim().toLowerCase());
  const allowedTokens = new Set(["z", "x", "y", "-y", "level", "row", "col", "column", "tilematrix", "tilerow", "tilecol"]);
  const unknownToken = tokens.find((token) => !allowedTokens.has(token));
  if (unknownToken) {
    return `Custom imagery template placeholder "{${unknownToken}}" is not supported; use fixed layer/time values and tile coordinate placeholders only.`;
  }

  const hasZoom = tokens.some((token) => token === "z" || token === "level" || token === "tilematrix");
  const hasColumn = tokens.some((token) => token === "x" || token === "col" || token === "column" || token === "tilecol");
  const hasRow = tokens.some((token) => token === "y" || token === "-y" || token === "row" || token === "tilerow");
  if (!hasZoom || !hasColumn || !hasRow) {
    return "Custom imagery template must include zoom, column, and row placeholders.";
  }

  return null;
}

function isLocalHttpTileUrl(url: URL): boolean {
  if (url.protocol !== "http:") return false;
  const hostname = url.hostname.toLowerCase();
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname.startsWith("10.")
    || hostname.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function blockedImageryHostReason(hostname: string): string | null {
  const normalized = hostname.toLowerCase();
  const blockedHosts: Array<[RegExp, string]> = [
    [/(^|\.)googleapis\.com$/, "Google imagery services are excluded."],
    [/(^|\.)google\.com$/, "Google imagery services are excluded."],
    [/(^|\.)gstatic\.com$/, "Google imagery services are excluded."],
    [/(^|\.)virtualearth\.net$/, "Bing imagery services are excluded."],
    [/(^|\.)bing\.com$/, "Bing imagery services are excluded."],
    [/(^|\.)mapbox\.com$/, "Paid Mapbox imagery services are excluded."],
    [/(^|\.)maptiler\.com$/, "Keyed hosted tile services are excluded from custom open imagery."],
    [/(^|\.)stadiamaps\.com$/, "Keyed hosted tile services are excluded from custom open imagery."],
    [/(^|\.)arcgisonline\.com$/, "Hosted ArcGIS Online imagery services are excluded from custom open imagery."],
    [/(^|\.)arcgis\.com$/, "Hosted ArcGIS imagery services are excluded from custom open imagery."],
    [/^tile\.openstreetmap\.org$/, "Public OpenStreetMap raster tiles are excluded from CPLayout live imagery sources."],
  ];
  return blockedHosts.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

function flipTileY(y: number, z: number): number {
  return 2 ** z - 1 - y;
}
