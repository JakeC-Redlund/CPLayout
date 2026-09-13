import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Metro bundles the main module; workers retain their upstream ESM sibling imports.
const baseUrl = process.env.NODE_ENV === "development" ? "" : (process.env.EXPO_BASE_URL ?? "");
const basePath = baseUrl.replace(/^\/+|\/+$/g, "");
maplibregl.setWorkerUrl(`${basePath ? `/${basePath}` : ""}/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`);

export function maplibreErrorMessage(error: { message: string }): string {
  if (error instanceof maplibregl.AJAXError) {
    return error.status === 0
      ? "Map source unavailable. Check the connection or source settings."
      : `Map source request failed (HTTP ${error.status}).`;
  }
  return error.message;
}

export { maplibregl };
