import { z } from "zod";

import { REFERENCE_OVERLAY_SCHEMAS, resolveOnlineImageryProvider } from "./settings";
import type { AerialImageryPreferences, OnlineImageryPreferences, OnlineImageryProvider, OnlineImageryProviderId } from "./settings";
import type { MapPackageManifest, TileContentType } from "./types";

export const TILE_CONTENT_TYPES = ["raster", "vector"] as const;
export const TILE_SCHEMES = ["xyz", "tms"] as const;
export const TILE_PACKAGE_INSTALL_STATUSES = ["metadata_only", "available", "missing", "indexed"] as const;

const BoundsWgs84Schema = z.object({
  minLongitude: z.number().min(-180).max(180),
  minLatitude: z.number().min(-90).max(90),
  maxLongitude: z.number().min(-180).max(180),
  maxLatitude: z.number().min(-90).max(90),
});

const VectorOverlayMetadataSchema = z.object({
  schema: z.enum(REFERENCE_OVERLAY_SCHEMAS),
  sourceLayers: z.object({
    roads: z.string().trim().min(1),
    roadLabels: z.string().trim().min(1),
    borders: z.string().trim().min(1),
    places: z.string().trim().min(1),
  }),
});

export const ImageryProvenanceSchema = z.object({
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  productId: z.string().min(1).optional(),
  captureDate: z.string().min(1).optional(),
  acquisitionYear: z.number().int().min(1900).max(2200).optional(),
  sourceResolutionMeters: z.number().positive().optional(),
  originalCrs: z.string().min(1).optional(),
  preprocessingSummary: z.string().min(1).optional(),
  accessedAt: z.string().min(1),
  attribution: z.string().min(1),
  licenseText: z.string().min(1),
  offlineCopyAllowed: z.boolean(),
  keyedService: z.literal(false),
});

export const MapPackageManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  packageType: z.enum(["pmtiles", "mbtiles", "raster_tiles"]),
  tileContentType: z.enum(TILE_CONTENT_TYPES).default("raster"),
  uri: z.string().min(1),
  minZoom: z.number().int().min(0).max(22),
  maxZoom: z.number().int().min(0).max(22),
  tileScheme: z.enum(TILE_SCHEMES).default("xyz"),
  boundsWgs84: BoundsWgs84Schema,
  tileJsonUrl: z.string().min(1).optional(),
  tileUrlTemplates: z.array(z.string().min(1)).default([]),
  vectorOverlay: VectorOverlayMetadataSchema.optional(),
  imageryProvenance: ImageryProvenanceSchema.optional(),
  checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  installStatus: z.enum(TILE_PACKAGE_INSTALL_STATUSES).default("metadata_only"),
  attribution: z.string().min(1),
  licenseText: z.string().min(1),
  bytes: z.number().int().nonnegative().optional(),
  importedAt: z.string().min(1),
}).superRefine((manifest, context) => {
  if (manifest.maxZoom < manifest.minZoom) {
    context.addIssue({
      code: "custom",
      message: "maxZoom must be greater than or equal to minZoom.",
      path: ["maxZoom"],
    });
  }
  if (manifest.boundsWgs84.maxLongitude < manifest.boundsWgs84.minLongitude) {
    context.addIssue({
      code: "custom",
      message: "maxLongitude must be greater than or equal to minLongitude.",
      path: ["boundsWgs84", "maxLongitude"],
    });
  }
  if (manifest.boundsWgs84.maxLatitude < manifest.boundsWgs84.minLatitude) {
    context.addIssue({
      code: "custom",
      message: "maxLatitude must be greater than or equal to minLatitude.",
      path: ["boundsWgs84", "maxLatitude"],
    });
  }
});

export interface MapLibreTileSourceDescriptor {
  id: string;
  type: TileContentType;
  url?: string;
  tiles?: string[];
  minzoom: number;
  maxzoom: number;
  scheme: "xyz" | "tms";
  attribution: string;
}

export type TileRuntimeTarget = "svg_mvp" | "web_maplibre_gl_js" | "native_maplibre_rn" | "android_maplibre_rn" | "ios_maplibre_rn";
export type TileSourceReadinessKind = "generated_tilejson_or_template" | "raw_pmtiles_archive" | "raw_mbtiles_archive" | "raw_tile_archive";

export interface TilePackageReadiness {
  target: TileRuntimeTarget;
  canRender: boolean;
  requiresAdapter: boolean;
  reason: string;
  source?: MapLibreTileSourceDescriptor;
  sourceKind?: TileSourceReadinessKind;
}

export interface AerialImageryResolution {
  status: "off" | "missing_source" | "missing_package" | "ambiguous_source" | "unavailable" | "ready";
  canRender: boolean;
  reason: string;
  mode: AerialImageryPreferences["mode"];
  autoApplied: boolean;
  sourceKind: "none" | "local_raster";
  packageId?: string;
  packageName?: string;
  source?: MapLibreTileSourceDescriptor;
  attribution?: string;
  licenseText?: string;
  imageryProvenance?: MapPackageManifest["imageryProvenance"];
}

export interface AerialImageryCandidate {
  packageId: string;
  packageName: string;
  attribution: string;
  licenseText: string;
  imageryProvenance?: MapPackageManifest["imageryProvenance"];
}

export interface AerialReferenceImageryResolution {
  canRender: boolean;
  reason: string;
  sourceKind: "none" | "local_raster" | "online_provider";
  localAerial: AerialImageryResolution;
  onlineProvider?: OnlineImageryProvider;
  autoFallback: boolean;
}

export function validateMapPackageManifest(input: unknown): MapPackageManifest {
  return MapPackageManifestSchema.parse(input);
}

export function mapPackageHasRenderableSource(manifest: MapPackageManifest): boolean {
  return tileSourceUrls(manifest).length > 0 && tileSourceUrls(manifest).every(isLocalTileSourceUrl);
}

export function toMapLibreTileSourceDescriptor(manifest: MapPackageManifest): MapLibreTileSourceDescriptor | null {
  const parsed = validateMapPackageManifest(manifest);
  if (!mapPackageHasRenderableSource(parsed)) return null;
  return {
    id: parsed.id,
    type: parsed.tileContentType,
    url: parsed.tileJsonUrl,
    tiles: parsed.tileUrlTemplates && parsed.tileUrlTemplates.length > 0 ? parsed.tileUrlTemplates : undefined,
    minzoom: parsed.minZoom,
    maxzoom: parsed.maxZoom,
    scheme: parsed.tileScheme,
    attribution: parsed.attribution,
  };
}

export function describeTilePackageReadiness(
  manifest: MapPackageManifest,
  target: TileRuntimeTarget,
): TilePackageReadiness {
  const parsed = validateMapPackageManifest(manifest);
  const source = toMapLibreTileSourceDescriptor(parsed);

  if (target === "svg_mvp") {
    return {
      target,
      canRender: false,
      requiresAdapter: false,
      reason: "This drawing view keeps the map package details. Background map tiles are unavailable in this view.",
    };
  }

  const tileUrls = tileSourceUrls(parsed);
  if (tileUrls.some(isLogicalMapPackageUrl)) {
    return {
      target,
      canRender: false,
      requiresAdapter: false,
      reason: "Map package files are unavailable on this device. Import the map archive to view its tiles.",
      sourceKind: "generated_tilejson_or_template",
    };
  }
  if (tileUrls.length > 0 && !tileUrls.every(isLocalTileSourceUrl)) {
    return {
      target,
      canRender: false,
      requiresAdapter: false,
      reason: "Tile source URLs must be local app-readable files or localhost tile services before this offline-first app marks them renderable.",
    };
  }

  if (source) {
    return {
      target,
      canRender: true,
      requiresAdapter: false,
      reason: "Generated local TileJSON or tile URL templates are available for this MapLibre renderer.",
      source,
      sourceKind: "generated_tilejson_or_template",
    };
  }

  if (target === "web_maplibre_gl_js" && parsed.packageType === "pmtiles" && parsed.uri.startsWith("pmtiles://")) {
    if (!isLocalTileSourceUrl(parsed.uri)) {
      return {
        target,
        canRender: false,
        requiresAdapter: false,
        reason: "PMTiles URIs must point to local app-readable files or localhost tile services before this offline-first app marks them renderable.",
        sourceKind: "raw_pmtiles_archive",
      };
    }
    return {
      target,
      canRender: true,
      requiresAdapter: false,
      reason: "PMTiles can be rendered by MapLibre GL JS after registering the pmtiles protocol at app startup.",
      source: {
        id: parsed.id,
        type: parsed.tileContentType,
        url: parsed.uri,
        minzoom: parsed.minZoom,
        maxzoom: parsed.maxZoom,
        scheme: parsed.tileScheme,
        attribution: parsed.attribution,
      },
      sourceKind: "raw_pmtiles_archive",
    };
  }

  const archiveSourceKind = rawArchiveSourceKind(parsed.packageType);
  if (isNativeMapLibreTarget(target) && parsed.packageType === "pmtiles" && parsed.uri.startsWith("pmtiles://")) {
    return {
      target,
      canRender: false,
      requiresAdapter: true,
      reason: isPlatformNativeMapLibreTarget(target)
        ? "Direct local PMTiles native rendering is platform-gated until a completed Android or iOS VectorSource/PMTiles proof report exists; use generated local TileJSON or tile URL templates first."
        : "Native MapLibre React Native consumes generated TileJSON or tile URL templates; direct PMTiles needs a platform-specific proof report before readiness is enabled.",
      sourceKind: archiveSourceKind,
    };
  }

  return {
    target,
    canRender: false,
    requiresAdapter: true,
    reason: isNativeMapLibreTarget(target)
      ? "Native MapLibre React Native consumes generated TileJSON or tile URL templates; raw PMTiles/MBTiles files need a local protocol, tile-serving adapter, or platform-specific proof first."
      : "Raw tile archives need a renderer-specific protocol or tile-serving adapter before display.",
    sourceKind: archiveSourceKind,
  };
}

export function resolveAerialImagerySource({
  mapPackages,
  preferences,
  target,
}: {
  mapPackages?: MapPackageManifest[];
  preferences: AerialImageryPreferences;
  target: TileRuntimeTarget;
}): AerialImageryResolution {
  const base = {
    mode: preferences.mode,
    autoApplied: false,
    sourceKind: "none" as const,
  };

  if (preferences.mode === "off") {
    return {
      ...base,
      status: "off",
      canRender: false,
      reason: "Aerial imagery is off.",
    };
  }

  if (target === "svg_mvp") {
    return {
      ...base,
      status: "unavailable",
      canRender: false,
      reason: "The SVG drawing surface does not render local aerial raster packages.",
    };
  }

  if (preferences.mode === "manual") {
    if (!preferences.sourcePackageId) {
      return {
        ...base,
        status: "missing_source",
        canRender: false,
        reason: "Choose a local raster aerial package before enabling manual aerial imagery.",
      };
    }
    return resolveSelectedAerialImageryPackage({
      autoApplied: false,
      mapPackages: mapPackages ?? [],
      packageId: preferences.sourcePackageId,
      target,
    });
  }

  if (preferences.sourcePackageId) {
    const sticky = resolveSelectedAerialImageryPackage({
      autoApplied: true,
      mapPackages: mapPackages ?? [],
      packageId: preferences.sourcePackageId,
      suppressMissingPackage: true,
      target,
    });
    if (sticky.canRender) return sticky;
  }

  const candidates = listAerialImageryCandidates({
    mapPackages,
    target,
  });
  if (candidates.length === 0) {
    return {
      ...base,
      status: "missing_source",
      canRender: false,
      reason: "No auto-eligible local raster TileJSON/template aerial package is available; use a generated offline NAIP package or the explicit USGS live preview.",
    };
  }
  if (candidates.length > 1) {
    return {
      ...base,
      status: "ambiguous_source",
      canRender: false,
      reason: "Multiple local raster aerial packages are available; choose one manually to make the aerial layer deterministic.",
    };
  }

  return resolveSelectedAerialImageryPackage({
    autoApplied: true,
    mapPackages: mapPackages ?? [],
    packageId: candidates[0].packageId,
    target,
  });
}

export function resolveAerialReferenceImagerySource({
  autoFallbackProviderId = "usgs_imagery_only",
  mapPackages,
  onlineImagery,
  preferences,
  target,
}: {
  autoFallbackProviderId?: OnlineImageryProviderId | null;
  mapPackages?: MapPackageManifest[];
  onlineImagery: OnlineImageryPreferences;
  preferences: AerialImageryPreferences;
  target: TileRuntimeTarget;
}): AerialReferenceImageryResolution {
  const localAerial = resolveAerialImagerySource({ mapPackages, preferences, target });
  if (localAerial.canRender) {
    return {
      canRender: true,
      reason: localAerial.reason,
      sourceKind: "local_raster",
      localAerial,
      autoFallback: false,
    };
  }

  const explicitProvider = resolveOptionalOnlineProvider(onlineImagery);
  if (explicitProvider.provider) {
    return {
      canRender: true,
      reason: `${explicitProvider.provider.name} is enabled as a connected preview. Local raster imagery remains preferred when renderable.`,
      sourceKind: "online_provider",
      localAerial,
      onlineProvider: explicitProvider.provider,
      autoFallback: false,
    };
  }

  if (preferences.mode === "auto" && target !== "svg_mvp" && autoFallbackProviderId) {
    const fallbackProvider = resolveOnlineImageryProvider(autoFallbackProviderId);
    return {
      canRender: true,
      reason: `No renderable local aerial package is available; ${fallbackProvider.name} is used as a connected preview fallback.`,
      sourceKind: "online_provider",
      localAerial,
      onlineProvider: fallbackProvider,
      autoFallback: true,
    };
  }

  return {
    canRender: false,
    reason: explicitProvider.error ?? localAerial.reason,
    sourceKind: "none",
    localAerial,
    autoFallback: false,
  };
}

export function listAerialImageryCandidates({
  mapPackages,
  target,
}: {
  mapPackages?: MapPackageManifest[];
  target: TileRuntimeTarget;
}): AerialImageryCandidate[] {
  if (target === "svg_mvp") return [];
  return (mapPackages ?? []).flatMap((mapPackage) => {
    const resolved = resolveSelectedAerialImageryPackage({
      autoApplied: true,
      mapPackages: [mapPackage],
      packageId: mapPackage.id,
      target,
    });
    if (!resolved.canRender) return [];
    return [{
      packageId: mapPackage.id,
      packageName: mapPackage.name,
      attribution: mapPackage.attribution,
      licenseText: mapPackage.licenseText,
      imageryProvenance: mapPackage.imageryProvenance,
    }];
  });
}

export function isNativeMapLibreTarget(target: TileRuntimeTarget): boolean {
  return target === "native_maplibre_rn" || target === "android_maplibre_rn" || target === "ios_maplibre_rn";
}

export function isPlatformNativeMapLibreTarget(target: TileRuntimeTarget): boolean {
  return target === "android_maplibre_rn" || target === "ios_maplibre_rn";
}

function tileSourceUrls(manifest: MapPackageManifest): string[] {
  return [
    manifest.tileJsonUrl,
    ...(manifest.tileUrlTemplates ?? []),
  ].filter((url): url is string => typeof url === "string" && url.trim().length > 0);
}

function rawArchiveSourceKind(packageType: MapPackageManifest["packageType"]): TileSourceReadinessKind {
  if (packageType === "pmtiles") return "raw_pmtiles_archive";
  if (packageType === "mbtiles") return "raw_mbtiles_archive";
  return "raw_tile_archive";
}

function resolveOptionalOnlineProvider(
  onlineImagery: OnlineImageryPreferences,
): { provider: OnlineImageryProvider | null; error?: string } {
  if (!onlineImagery.enabled) return { provider: null };
  try {
    return { provider: resolveOnlineImageryProvider(onlineImagery.providerId, onlineImagery.customSource) };
  } catch (error) {
    return {
      provider: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveSelectedAerialImageryPackage({
  autoApplied,
  mapPackages,
  packageId,
  suppressMissingPackage = false,
  target,
}: {
  autoApplied: boolean;
  mapPackages: MapPackageManifest[];
  packageId: string;
  suppressMissingPackage?: boolean;
  target: TileRuntimeTarget;
}): AerialImageryResolution {
  const mapPackage = mapPackages.find((candidate) => candidate.id === packageId);
  const base = {
    mode: autoApplied ? "auto" as const : "manual" as const,
    autoApplied,
    sourceKind: "none" as const,
  };

  if (!mapPackage) {
    return {
      ...base,
      status: "missing_package",
      canRender: false,
      packageId,
      reason: suppressMissingPackage
        ? "The sticky aerial imagery package is not present in this project."
        : "The selected aerial imagery package is not present in this project.",
    };
  }

  const parsed = validateMapPackageManifest(mapPackage);
  const metadata = packageMetadata(parsed);
  if (parsed.tileContentType !== "raster") {
    return {
      ...base,
      ...metadata,
      status: "unavailable",
      canRender: false,
      reason: "Aerial imagery requires a local raster package; vector packages are handled by reference overlays.",
    };
  }

  if (parsed.installStatus !== "available" && parsed.installStatus !== "indexed") {
    return {
      ...base,
      ...metadata,
      status: "unavailable",
      canRender: false,
      reason: "Aerial imagery package metadata is present, but the local raster package is not installed or indexed.",
    };
  }

  if (parsed.imageryProvenance?.keyedService !== undefined && parsed.imageryProvenance.keyedService !== false) {
    return {
      ...base,
      ...metadata,
      status: "unavailable",
      canRender: false,
      reason: "Aerial imagery package provenance cannot depend on keyed imagery services.",
    };
  }

  const readiness = describeTilePackageReadiness(parsed, target);
  if (!readiness.canRender || !readiness.source || readiness.sourceKind !== "generated_tilejson_or_template") {
    return {
      ...base,
      ...metadata,
      status: "unavailable",
      canRender: false,
      reason: readiness.reason,
    };
  }

  if (readiness.source.type !== "raster") {
    return {
      ...base,
      ...metadata,
      status: "unavailable",
      canRender: false,
      reason: "Aerial imagery requires a raster MapLibre source.",
    };
  }

  return {
    ...base,
    ...metadata,
    sourceKind: "local_raster",
    status: "ready",
    canRender: true,
    source: readiness.source,
    reason: autoApplied
      ? `Local raster aerial imagery package was auto-applied in the ${aerialImageryTargetLabel(target)}.`
      : `Local raster aerial imagery package is renderable in the ${aerialImageryTargetLabel(target)}.`,
  };
}

function packageMetadata(mapPackage: MapPackageManifest): Pick<AerialImageryResolution, "packageId" | "packageName" | "attribution" | "licenseText" | "imageryProvenance"> {
  return {
    packageId: mapPackage.id,
    packageName: mapPackage.name,
    attribution: mapPackage.attribution,
    licenseText: mapPackage.licenseText,
    imageryProvenance: mapPackage.imageryProvenance,
  };
}

function aerialImageryTargetLabel(target: TileRuntimeTarget): string {
  if (target === "web_maplibre_gl_js") return "browser MapLibre surface";
  if (isNativeMapLibreTarget(target)) return "native MapLibre surface";
  return "selected map surface";
}

function isLocalTileSourceUrl(value: string): boolean {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("pmtiles://")) return isLocalTileSourceUrl(trimmed.slice("pmtiles://".length));
  if (
    lower.startsWith("file://")
    || lower.startsWith("asset://")
    || lower.startsWith("content://")
    || lower.startsWith("app://")
    || lower.startsWith("blob:")
    || lower.startsWith("data:")
    || lower.startsWith("/")
    || lower.startsWith("./")
    || lower.startsWith("../")
  ) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1");
  } catch {
    return false;
  }
}

function isLogicalMapPackageUrl(value: string): boolean {
  return value.trim().toLowerCase().startsWith("app://map-packages/");
}
