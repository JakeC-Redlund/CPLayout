import type { FeatureCollection, Feature, Geometry } from "geojson";
import type { StyleSpecification } from "maplibre-gl";
import { buildMapReferenceViewModel } from "../../core/src/mapReferenceViewModel";
import { parseFieldLayoutTarget } from "../../core/src/fieldLayoutTarget";
import { qualifyProjectCrs } from "../../core/src/crsQualification";
import { projectXyToLonLat } from "../../core/src/coordinates";
import type { XY, MapPackageManifest } from "../../core/src/types";
import type { MapViewport } from "../../geometry/src/mapInteraction";
import { finitePointBounds, type MapScreenSize } from "./mapFit";
import { createMapPointerGuard } from "./mapPointerGuard";
import { buildWorkbenchStyle, rasterStyleSourceFromAerialReferenceResolution } from "./mapWorkbenchStyle";
import { visibleMapAttributions } from "./mapAttribution";
import type { WorkspaceMapSurfaceProps, WorkspaceMapInteractionOwner } from "./workspaceMapSurfaceTypes";
import type { WorkspaceMapScene, WorkspaceSceneGeometry, WorkspaceSceneLayer } from "./workspaceMapScene";

export interface WorkspaceRenderPrimitive {
  readonly address: string; readonly sourceAddress: string; readonly layer: WorkspaceSceneLayer;
  readonly geometry: WorkspaceSceneGeometry; readonly color: string; readonly label?: string;
  readonly nominal?: boolean;
}
const colors: Record<WorkspaceSceneLayer, string> = { boundary: "#416c49", obstacle: "#a44837", map_feature: "#84601d",
  infrastructure: "#927411", machine: "#234f39", saved_survey: "#246f9f", manual_capture: "#8a58a7", survey_capture: "#cf741b",
  frozen_target: "#184932", layout_observation: "#267cc0", receiver: "#c82a65", preview: "#249c92" };

export function workspaceRenderPrimitives(scene: WorkspaceMapScene, visibility: WorkspaceMapSurfaceProps["layerVisibility"] = {}): WorkspaceRenderPrimitive[] {
  const primitives: WorkspaceRenderPrimitive[] = scene.entities.filter(entity => visibility[entity.layer] !== false).map(entity => ({
    address: entity.address, sourceAddress: entity.address, layer: entity.layer, geometry: entity.geometry, color: colors[entity.layer],
    ...(entity.label === undefined ? {} : { label: entity.label }),
  }));
  const crs = scene.identity.projectCrs;
  // Distances cannot be mixed with an unqualified local unit. Nominal is a drawing, never calculated coverage.
  if (crs && qualifyProjectCrs(crs).unit === "metre") for (const machine of scene.machines) {
    const config = machine.configuration;
    if (machine.kind !== "center_pivot" || !machine.location || !("spanLengthsMeters" in config)
      || !config.spanLengthsMeters?.length || config.spanLengthsMeters.some(value => typeof value !== "number" || !Number.isFinite(value) || value <= 0)
      || !("overhangMeters" in config) || typeof config.overhangMeters !== "number" || !Number.isFinite(config.overhangMeters) || config.overhangMeters < 0) continue;
    const radius = config.spanLengthsMeters.reduce<number>((sum, value) => sum + value!, 0) + config.overhangMeters;
    if (!Number.isFinite(radius) || radius <= 0) continue;
    const anchor = scene.entities.find(entity => entity.kind === "machine" && entity.sourceId === machine.id
      && (entity.sourcePath === machine.sourcePath || (machine.sourcePath === "machine" && entity.sourcePath === "pivotCenter")));
    if (!anchor || visibility[anchor.layer] === false) continue;
    primitives.unshift({ address: `${anchor.address}:nominal`, sourceAddress: anchor.address, layer: anchor.layer,
      geometry: { type: "Circle", center: machine.location, radiusMeters: radius }, color: colors[anchor.layer], nominal: true });
  }
  return primitives;
}
export function workspaceGeometryPoints(geometry: WorkspaceSceneGeometry): readonly Readonly<XY>[] {
  if (geometry.type === "Point") return [geometry.point];
  if (geometry.type === "Circle") return Array.from({ length: 64 }, (_, index) => {
    const angle = index / 64 * Math.PI * 2;
    return { x: geometry.center.x + Math.cos(angle) * geometry.radiusMeters, y: geometry.center.y + Math.sin(angle) * geometry.radiusMeters };
  });
  return geometry.vertices;
}
export function workspaceSceneBounds(scene: WorkspaceMapScene, visibility?: WorkspaceMapSurfaceProps["layerVisibility"]) {
  return finitePointBounds(workspaceRenderPrimitives(scene, visibility).flatMap(primitive => workspaceGeometryPoints(primitive.geometry)));
}
export function workspacePointToScreen(point: Readonly<XY>, viewport: MapViewport, screen: MapScreenSize): XY {
  const width = viewport.baseWidthMeters / viewport.zoomLevel, height = viewport.baseHeightMeters / viewport.zoomLevel;
  return { x: (point.x - viewport.center.x + width / 2) / width * screen.width,
    y: (viewport.center.y + height / 2 - point.y) / height * screen.height };
}
export function workspaceHitTest(primitives: readonly WorkspaceRenderPrimitive[], viewport: MapViewport, screen: MapScreenSize, position: XY, tolerance = 12): string | null {
  let nearest: { address: string; distance: number } | null = null;
  for (const primitive of primitives) {
    const points = workspaceGeometryPoints(primitive.geometry).map(point => workspacePointToScreen(point, viewport, screen));
    let distance = Infinity;
    for (const point of points) distance = Math.min(distance, Math.hypot(position.x - point.x, position.y - point.y));
    const closed = primitive.geometry.type === "Polygon" || primitive.geometry.type === "Circle";
    for (let index = 1; index < points.length + (closed ? 1 : 0); index++) {
      const a = points[(index - 1) % points.length], b = points[index % points.length];
      const dx = b.x - a.x, dy = b.y - a.y, size = dx * dx + dy * dy;
      const t = size === 0 ? 0 : Math.max(0, Math.min(1, ((position.x - a.x) * dx + (position.y - a.y) * dy) / size));
      distance = Math.min(distance, Math.hypot(position.x - a.x - t * dx, position.y - a.y - t * dy));
    }
    if (distance <= tolerance && (!nearest || distance <= nearest.distance)) nearest = { address: primitive.sourceAddress, distance };
  }
  return nearest?.address ?? null;
}
export function workspaceProjectionSupported(crs: string | null): boolean {
  if (!crs) return false;
  const qualified = qualifyProjectCrs(crs);
  return qualified.wgs84Transform === "projection_only" || qualified.wgs84Transform === "display_only";
}
export function workspaceSceneGeoJson(scene: WorkspaceMapScene, visibility?: WorkspaceMapSurfaceProps["layerVisibility"], selectedAddress?: string | null): FeatureCollection {
  if (!workspaceProjectionSupported(scene.identity.projectCrs)) throw new Error("This map requires the saved projected XY renderer.");
  const crs = scene.identity.projectCrs!;
  const features: Feature[] = [];
  for (const primitive of workspaceRenderPrimitives(scene, visibility)) {
    const points = workspaceGeometryPoints(primitive.geometry).map(point => { const lonLat = projectXyToLonLat(point, crs); return [lonLat.longitude, lonLat.latitude]; });
    if (!points.length) continue;
    const closed = primitive.geometry.type === "Polygon" || primitive.geometry.type === "Circle";
    const geometry: Geometry = points.length === 1 ? { type: "Point", coordinates: points[0] }
      : closed && points.length >= 3 ? { type: "Polygon", coordinates: [[...points, points[0]]] }
        : { type: "LineString", coordinates: points };
    const properties = { address: primitive.sourceAddress, layer: primitive.layer, color: primitive.color,
      selected: primitive.sourceAddress === selectedAddress, nominal: primitive.nominal === true, label: primitive.label ?? "" };
    features.push({ type: "Feature", properties, geometry });
    if (primitive.geometry.type === "Pending" && points.length > 1) for (const coordinates of points) features.push({ type: "Feature", properties, geometry: { type: "Point", coordinates } });
  }
  return { type: "FeatureCollection", features };
}
function scenePackages(scene: WorkspaceMapScene): MapPackageManifest[] {
  const source = scene.sourceDocument;
  const packages = source.kind === "session" ? parseFieldLayoutTarget(source.data.targetDocument).field.mapPackages
    : source.kind === "target" ? source.data.field.mapPackages : source.data.mapPackages;
  return structuredClone(packages ?? []) as MapPackageManifest[];
}
export function workspaceWebStyle(scene: WorkspaceMapScene, settings: WorkspaceMapSurfaceProps["settings"]) {
  const reference = buildMapReferenceViewModel({ settings, mapPackages: scenePackages(scene), target: "web_maplibre_gl_js", surface: "workbench" });
  const imagery = rasterStyleSourceFromAerialReferenceResolution(reference.aerial);
  const style = buildWorkbenchStyle(imagery, { type: "FeatureCollection", features: [] }, reference.reference, settings.referenceOverlay);
  style.sources.workspace = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  const paintColor = ["get", "color"] as const;
  const layers: StyleSpecification["layers"] = [
    { id: "workspace-fill", type: "fill", source: "workspace", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": [...paintColor], "fill-opacity": ["case", ["==", ["get", "nominal"], true], 0.035, 0.12] } },
    { id: "workspace-line", type: "line", source: "workspace", filter: ["all", ["!=", ["geometry-type"], "Point"], ["!=", ["get", "nominal"], true]], paint: { "line-color": [...paintColor], "line-width": ["case", ["==", ["get", "selected"], true], 4, 2] } },
    { id: "workspace-nominal-line", type: "line", source: "workspace", filter: ["==", ["get", "nominal"], true], paint: { "line-color": [...paintColor], "line-width": ["case", ["==", ["get", "selected"], true], 3, 1.5], "line-dasharray": [3, 2] } },
    { id: "workspace-point", type: "circle", source: "workspace", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": [...paintColor], "circle-radius": ["case", ["==", ["get", "selected"], true], 8, 5], "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
  ];
  style.layers.push(...layers);
  return { style, attribution: visibleMapAttributions(style), summary: `${reference.aerialSummary} · ${reference.referenceSummary}` };
}

/** One held gesture owner. Cancellation survives a token changing away and back. No domain vertices are retained. */
export function createWorkspaceGestureSession() {
  const guard = createMapPointerGuard();
  let held: { id: number; owner: WorkspaceMapInteractionOwner; start: XY; moved: boolean } | null = null;
  return {
    begin(pointer: { pointerId: number; isPrimary: boolean; button: number }, owner: WorkspaceMapInteractionOwner, point: XY, onSurface = true): boolean {
      guard.begin(pointer, onSurface);
      if (!guard.canActivate()) { held = null; return false; }
      held = { id: pointer.pointerId, owner: { ...owner }, start: { ...point }, moved: false }; return true;
    },
    move(id: number, point: XY): boolean {
      if (!held || held.id !== id || !guard.canActivate()) return false;
      held.moved ||= Math.hypot(point.x - held.start.x, point.y - held.start.y) > 4;
      return held.moved;
    },
    end(id: number, owner: WorkspaceMapInteractionOwner, canceled = false): boolean {
      guard.end(id, canceled);
      const accepted = !canceled && guard.canActivate() && held?.id === id && !held.moved
        && held.owner.cameraContextKey === owner.cameraContextKey && held.owner.interactionKey === owner.interactionKey;
      held = null; guard.cancel(); return accepted;
    },
    cancel(): void { held = null; guard.cancel(); },
    clear(): void { held = null; guard.clear(); },
  };
}
