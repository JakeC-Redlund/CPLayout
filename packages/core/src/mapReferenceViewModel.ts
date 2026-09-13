import {
  isNativeMapLibreTarget,
  resolveAerialReferenceImagerySource,
  type AerialReferenceImageryResolution,
  type TileRuntimeTarget,
} from "./mapTilePackages";
import { resolveReferenceOverlaySource, type ReferenceOverlayLayerKey, type ReferenceOverlayResolution } from "./referenceOverlays";
import type { AppSettings } from "./settings";
import type { MapPackageManifest } from "./types";

export type MapReferenceSurface = "workbench" | "online_preview" | "svg";
export interface MapReferenceViewModel {
  aerial: AerialReferenceImageryResolution;
  reference: ReferenceOverlayResolution;
  aerialSummary: string;
  referenceSummary: string;
  aerialWorkflow: "off" | "auto_local" | "manual_local" | "usgs_live_preview";
  layers: Record<ReferenceOverlayLayerKey, { requested: boolean; available: boolean; active: boolean }>;
  evidenceLabel: "Reference only";
  runtimeLabel: "Native runtime unverified" | null;
}

export function buildMapReferenceViewModel({ settings, mapPackages, target, surface }: {
  settings: Pick<AppSettings, "aerialImagery" | "onlineImagery" | "referenceOverlay">;
  mapPackages?: MapPackageManifest[];
  target: TileRuntimeTarget;
  surface: MapReferenceSurface;
}): MapReferenceViewModel {
  const effectiveTarget = surface === "svg" ? "svg_mvp" : target;
  const aerial = resolveAerialReferenceImagerySource({
    preferences: surface === "workbench" ? settings.aerialImagery : { mode: "off" },
    onlineImagery: settings.onlineImagery,
    mapPackages,
    target: effectiveTarget,
    autoFallbackProviderId: surface === "workbench" ? "usgs_imagery_only" : null,
  });
  const reference = resolveReferenceOverlaySource({
    preferences: settings.referenceOverlay,
    mapPackages,
    target: effectiveTarget,
    allowPublicNetwork: surface === "workbench"
      ? settings.onlineImagery.enabled || aerial.sourceKind === "online_provider"
      : surface === "online_preview" && aerial.sourceKind === "online_provider",
  });
  const provider = aerial.onlineProvider;
  const providerLabel = provider?.id === "usgs_imagery_only"
    ? aerial.autoFallback || settings.aerialImagery.mode === "auto" ? "Auto USGS fallback" : "USGS only"
    : "Connected preview";
  const aerialSummary = aerial.sourceKind === "local_raster"
    ? `${aerial.localAerial.autoApplied ? "Auto local first" : "Manual local"}: ${aerial.localAerial.packageName ?? aerial.localAerial.packageId} · ${aerial.localAerial.reason}`
    : provider
      ? `${providerLabel}: ${provider.name} · ${provider.coverageLabel} · connected preview only`
      : aerial.reason;
  const referenceSummary = reference.canRender
    ? `${reference.autoApplied ? "Auto-applied" : "Manual"}: ${reference.packageName ?? reference.packageId} · ${reference.sourceKind === "public_raster" ? "public no-key raster" : reference.schema.replaceAll("_", " ")} · ${reference.reason}`
    : reference.reason;
  function layer(key: ReferenceOverlayLayerKey) {
    return {
      requested: settings.referenceOverlay[key],
      available: reference.canRender,
      active: reference.canRender && settings.referenceOverlay[key],
    };
  }
  return {
    aerial,
    reference,
    aerialSummary,
    referenceSummary,
    aerialWorkflow: settings.aerialImagery.mode === "off" && settings.onlineImagery.enabled && settings.onlineImagery.providerId === "usgs_imagery_only"
      ? "usgs_live_preview"
      : settings.aerialImagery.mode === "off" ? "off" : settings.aerialImagery.mode === "manual" ? "manual_local" : "auto_local",
    // Eligibility describes source configuration, never observed rendering or geometry authority.
    layers: { roads: layer("roads"), borders: layer("borders"), labels: layer("labels") },
    evidenceLabel: "Reference only",
    runtimeLabel: isNativeMapLibreTarget(target) ? "Native runtime unverified" : null,
  };
}
