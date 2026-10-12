import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { maplibregl, maplibreErrorMessage } from "./maplibreRuntime.web";
import { projectLonLatToXy, projectXyToLonLat } from "../../core/src/coordinates";
import { registerPmtilesProtocolOnce } from "./pmtilesProtocol.web";
import { viewportForScreen } from "./mapFit";
import { WorkspaceMapFrame } from "./WorkspaceMapFrame";
import { WorkspaceSvgCanvas } from "./WorkspaceSvgCanvas";
import { createWorkspaceGestureSession, workspaceProjectionSupported, workspaceSceneGeoJson, workspaceWebStyle } from "./workspaceSceneRendering";
import type { WorkspaceCanvasProps, WorkspaceMapSurfaceProps } from "./workspaceMapSurfaceTypes";

let instanceSequence = 0;
export function WorkspaceMapSurface(props: WorkspaceMapSurfaceProps): React.JSX.Element {
  return <WorkspaceMapFrame {...props} renderCanvas={canvas => <WorkspaceWebCanvas {...canvas} />} />;
}

function WorkspaceWebCanvas(props: WorkspaceCanvasProps): React.JSX.Element {
  const [failure, setFailure] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [gesture] = useState(createWorkspaceGestureSession);
  const current = useRef(props);
  const lastCamera = useRef<string | null>(null);
  const driving = useRef(false);
  const flushedSource = useRef<{ source: maplibregl.GeoJSONSource; data: NonNullable<ReturnType<typeof workspaceSceneGeoJson>> } | null>(null);
  const expectedCamera = useRef<{ key: string; center: { longitude: number; latitude: number }; zoom: number } | null>(null);
  const cameraKey = (state: WorkspaceCanvasProps) => JSON.stringify([state.cameraContextKey, state.scene.identity.projectCrs, state.viewport, state.screen]);
  const supported = workspaceProjectionSupported(props.scene.identity.projectCrs);
  const geoJson = useMemo(() => {
    try { return supported ? workspaceSceneGeoJson(props.scene, props.layerVisibility, props.selectedAddress) : null; }
    catch { return null; }
  }, [props.scene, props.layerVisibility, props.selectedAddress, supported]);
  const reference = useMemo(() => workspaceWebStyle(props.scene, props.settings), [props.scene, props.settings]);
  const styleKey = JSON.stringify(reference.style);
  const currentData = useRef(geoJson);
  const currentStyle = useRef(reference.style);
  const updateSource = () => {
    const renderer = map.current;
    const source = renderer?.getSource("workspace") as maplibregl.GeoJSONSource | undefined, data = currentData.current;
    if (!source || !data || flushedSource.current?.source === source && flushedSource.current.data === data) return;
    source.setData(data); flushedSource.current = { source, data };
  };
  const driveCamera = () => {
    const renderer = map.current, state = current.current;
    if (!renderer || state.screen.width <= 0 || state.screen.height <= 0) return;
    const key = cameraKey(state), node = renderer.getContainer();
    node.dataset.mapRequestedCamera = key;
    if (lastCamera.current !== key) node.dataset.mapSettled = "false";
    if (lastCamera.current === key) return;
    const crs = state.scene.identity.projectCrs!;
    const width = state.viewport.baseWidthMeters / state.viewport.zoomLevel, height = state.viewport.baseHeightMeters / state.viewport.zoomLevel;
    try {
      const sw = projectXyToLonLat({ x: state.viewport.center.x - width / 2, y: state.viewport.center.y - height / 2 }, crs);
      const ne = projectXyToLonLat({ x: state.viewport.center.x + width / 2, y: state.viewport.center.y + height / 2 }, crs);
      const camera = renderer.cameraForBounds([[sw.longitude, sw.latitude], [ne.longitude, ne.latitude]], { padding: 0 });
      if (!camera) return;
      const center = camera.center as unknown as { lng: number; lat: number } | [number, number];
      const longitude = Array.isArray(center) ? center[0] : center.lng, latitude = Array.isArray(center) ? center[1] : center.lat;
      const zoom = camera.zoom;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || typeof zoom !== "number" || !Number.isFinite(zoom)) throw new Error("The requested web camera is not finite.");
      driving.current = true;
      gesture.cancel();
      renderer.jumpTo({ ...camera, bearing: 0, pitch: 0 }); lastCamera.current = key;
      expectedCamera.current = { key, center: { longitude, latitude }, zoom };
      node.dataset.mapAppliedCamera = key;
    } catch (error) { setFailure(error instanceof Error ? error.message : "Map projection failed; saved XY is retained."); }
    finally { driving.current = false; }
  };
  const drive = useRef(driveCamera), sourceUpdate = useRef(updateSource);
  useLayoutEffect(() => {
    current.current = props; currentData.current = geoJson; currentStyle.current = reference.style;
    drive.current = driveCamera; sourceUpdate.current = updateSource;
  });
  useLayoutEffect(() => {
    gesture.cancel();
    const renderer = map.current;
    if (renderer) { renderer.stop(); renderer.dragPan.disable(); renderer.dragPan.enable(); renderer.touchZoomRotate.disable(); renderer.touchZoomRotate.enable(); renderer.touchZoomRotate.disableRotation(); }
  }, [props.interactionKey, props.cameraContextKey, props.scene.identity.projectCrs, props.cameraCommandGeneration, gesture]);
  useLayoutEffect(() => { lastCamera.current = null; expectedCamera.current = null; }, [props.cameraContextKey, props.scene.identity.projectCrs]);
  useEffect(() => { setFailure(null); setWarning(null); }, [props.cameraContextKey, props.scene.identity.projectCrs]);
  useEffect(() => {
    if (!supported || !geoJson || failure || !container.current) return;
    let renderer: maplibregl.Map;
    try {
      registerPmtilesProtocolOnce();
      const origin = projectXyToLonLat(current.current.viewport.center, current.current.scene.identity.projectCrs!);
      renderer = new maplibregl.Map({ container: container.current, style: currentStyle.current, center: [origin.longitude, origin.latitude], zoom: 0,
        attributionControl: false, trackResize: false, dragRotate: false, pitchWithRotate: false });
      renderer.doubleClickZoom.disable(); renderer.touchZoomRotate.disableRotation();
    } catch (error) { setFailure(error instanceof Error ? error.message : "Map renderer could not start."); return; }
    map.current = renderer;
    const node = renderer.getContainer(), win = node.ownerDocument.defaultView;
    node.dataset.mapInstance = String(++instanceSequence); node.dataset.mapLoaded = "false"; node.dataset.mapSettled = "false";
    lastCamera.current = null; expectedCamera.current = null; flushedSource.current = null;
    let disposed = false;
    const position = (event: PointerEvent) => { const rect = node.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    const down = (event: PointerEvent) => {
      if (lastCamera.current !== cameraKey(current.current)) return;
      gesture.begin(event, current.current, position(event), node.contains(event.target as Node));
    };
    const move = (event: PointerEvent) => { gesture.move(event.pointerId, position(event)); };
    const end = (event: PointerEvent) => {
      if (disposed || !gesture.end(event.pointerId, current.current, event.type === "pointercancel")) return;
      const screenPoint = position(event), state = current.current;
      if (screenPoint.x < 0 || screenPoint.y < 0 || screenPoint.x > node.clientWidth || screenPoint.y > node.clientHeight) return;
      try {
        const lngLat = renderer.unproject([screenPoint.x, screenPoint.y]);
        const wgs84 = { latitude: lngLat.lat, longitude: lngLat.lng };
        const point = projectLonLatToXy(wgs84, state.scene.identity.projectCrs!);
        state.onReadout(point);
        if (state.pointInputEnabled && state.onPoint) state.onPoint({ point, wgs84, cameraContextKey: state.cameraContextKey, interactionKey: state.interactionKey });
        else if (state.selectionEnabled !== false) {
          const hit = renderer.queryRenderedFeatures([screenPoint.x, screenPoint.y], { layers: ["workspace-point", "workspace-line", "workspace-nominal-line", "workspace-fill"] })[0];
          state.onSelect?.({ address: typeof hit?.properties.address === "string" ? hit.properties.address : null,
            cameraContextKey: state.cameraContextKey, interactionKey: state.interactionKey });
        }
      } catch (error) { setWarning(error instanceof Error ? error.message : "Map action could not resolve its coordinate frame."); }
    };
    const clear = () => gesture.clear();
    const visibility = () => { if (node.ownerDocument.hidden) clear(); };
    const record = () => {
      if (disposed || map.current !== renderer || driving.current || !expectedCamera.current || node.clientWidth <= 0 || node.clientHeight <= 0) return;
      const state = current.current;
      try {
        const crs = state.scene.identity.projectCrs!, center = renderer.getCenter(), bounds = renderer.getBounds();
        const middle = projectLonLatToXy({ latitude: center.lat, longitude: center.lng }, crs);
        const sw = projectLonLatToXy({ latitude: bounds.getSouth(), longitude: bounds.getWest() }, crs);
        const ne = projectLonLatToXy({ latitude: bounds.getNorth(), longitude: bounds.getEast() }, crs);
        const camera = viewportForScreen({ center: middle, baseWidthMeters: Math.abs(ne.x - sw.x), baseHeightMeters: Math.abs(ne.y - sw.y), zoomLevel: 1 }, state.screen);
        if (camera) {
          const key = cameraKey({ ...state, viewport: camera }); lastCamera.current = key;
          expectedCamera.current = { key, center: { longitude: center.lng, latitude: center.lat }, zoom: renderer.getZoom() };
          state.setViewport(camera); node.dataset.mapCamera = JSON.stringify(camera); node.dataset.mapSettled = "false";
        }
      } catch (error) { setWarning(error instanceof Error ? error.message : "Map camera could not resolve its coordinate frame."); }
    };
    const diagnose = (idle: boolean) => {
      if (disposed || map.current !== renderer) return;
      const expected = expectedCamera.current, requestedKey = cameraKey(current.current);
      const center = renderer.getCenter(), bounds = renderer.getBounds(), zoom = renderer.getZoom();
      const moving = renderer.isMoving(), styleLoaded = renderer.isStyleLoaded();
      node.dataset.mapRequestedCamera = requestedKey;
      node.dataset.mapAppliedCamera = expected?.key ?? "";
      node.dataset.mapCameraState = JSON.stringify({ requestedKey, appliedKey: expected?.key ?? null,
        center: { longitude: center.lng, latitude: center.lat }, zoom,
        bounds: { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() },
        expected: expected ? { center: expected.center, zoom: expected.zoom } : null,
        screen: { width: node.clientWidth, height: node.clientHeight }, styleLoaded, moving });
      const matches = !!expected && expected.key === requestedKey && Math.abs(center.lng - expected.center.longitude) <= 1e-7
        && Math.abs(center.lat - expected.center.latitude) <= 1e-7 && Math.abs(zoom - expected.zoom) <= 1e-7;
      if (!matches || moving || !styleLoaded) node.dataset.mapSettled = "false";
      else if (idle) node.dataset.mapSettled = "true";
    };
    const idle = () => diagnose(true), rendered = () => diagnose(false);
    const loaded = () => { if (!disposed && map.current === renderer) { node.dataset.mapLoaded = "true"; sourceUpdate.current(); lastCamera.current = null; drive.current(); diagnose(false); } };
    const error = (event: maplibregl.ErrorEvent) => { if (!disposed) setWarning(maplibreErrorMessage(event.error)); };
    const contextLost = () => { if (!disposed) setFailure("Web map graphics were interrupted. Projected XY remains available."); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (disposed || map.current !== renderer || node.clientWidth <= 0 || node.clientHeight <= 0) return;
      gesture.cancel();
      driving.current = true;
      try { renderer.resize(); } finally { driving.current = false; }
      lastCamera.current = null; drive.current(); diagnose(false);
    });
    observer?.observe(node);
    win?.addEventListener("pointerdown", down, true); win?.addEventListener("pointermove", move); win?.addEventListener("pointerup", end); win?.addEventListener("pointercancel", end); win?.addEventListener("blur", clear); node.ownerDocument.addEventListener("visibilitychange", visibility);
    renderer.getCanvas().addEventListener("webglcontextlost", contextLost); renderer.on("style.load", loaded); renderer.on("idle", idle); renderer.on("render", rendered); renderer.on("move", record); renderer.on("error", error); renderer.on("dragstart", clear); renderer.on("zoomstart", clear);
    return () => {
      disposed = true; gesture.clear(); observer?.disconnect();
      win?.removeEventListener("pointerdown", down, true); win?.removeEventListener("pointermove", move); win?.removeEventListener("pointerup", end); win?.removeEventListener("pointercancel", end); win?.removeEventListener("blur", clear); node.ownerDocument.removeEventListener("visibilitychange", visibility);
      renderer.getCanvas().removeEventListener("webglcontextlost", contextLost); renderer.off("style.load", loaded); renderer.off("idle", idle); renderer.off("render", rendered); renderer.off("move", record); renderer.off("error", error); renderer.off("dragstart", clear); renderer.off("zoomstart", clear);
      if (map.current === renderer) map.current = null; renderer.remove(); lastCamera.current = null; expectedCamera.current = null; flushedSource.current = null;
    };
  }, [supported, geoJson !== null, failure, gesture]);
  useEffect(() => {
    const renderer = map.current;
    if (!renderer) return;
    gesture.cancel(); lastCamera.current = null; expectedCamera.current = null; flushedSource.current = null;
    // A full replacement gives source/data flushing one explicit style-load boundary.
    // Default style diff can synchronously reset retained GeoJSON before its event.
    renderer.setStyle(currentStyle.current, { diff: false });
  }, [styleKey, gesture]);
  useLayoutEffect(() => { sourceUpdate.current(); }, [geoJson]);
  useLayoutEffect(() => { drive.current(); }, [props.cameraContextKey, props.viewport, props.scene.identity.projectCrs, props.screen.width, props.screen.height]);
  if (!supported || !geoJson || failure) return <>
    <WorkspaceSvgCanvas {...props} reason={failure ?? "Map imagery is unavailable for this coordinate system."} />
    {failure && <button type="button" onClick={() => setFailure(null)} style={{ position: "absolute", left: 8, top: 8 }}>Retry web map</button>}
  </>;
  return <>
    <div ref={container} data-testid="workspace-map-web-renderer" style={{ position: "absolute", inset: 0 }} />
    <div tabIndex={0} aria-label="Map source attribution" style={{ position: "absolute", bottom: 5, right: 6, maxWidth: "40%", maxHeight: 72, overflow: "auto", color: "#334d39", background: "rgba(255,255,255,.85)", fontSize: 10, padding: 3 }} data-testid="workspace-map-attribution">{reference.attribution.join(" · ") || "Saved project geometry"}</div>
    {warning && <div role="status" style={{ position: "absolute", left: 8, top: 46, right: 8, background: "#fff9e9", fontSize: 11, padding: 5 }} data-testid="workspace-map-source-status">{warning}</div>}
  </>;
}
