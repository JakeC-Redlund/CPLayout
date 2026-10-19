# Native Map Tile Adapter Design

Current source review (2026-10-18): the unified native `WorkspaceMapSurface.native.tsx` renders projected SVG. The separate native MapLibre workbench and historical proof harness are distinct lanes. Dependency installation, generated TileJSON descriptors and browser rendering do not establish current unified native integration or a device pass. New offline package admission validates nested resources and matching tile semantics; runtime file transport still needs its platform proof.

MapLibre React Native is installed/configured in the workspace, including the mobile Expo plugin and package dependencies. The generated TileJSON/tile-template adapter path is the supported native descriptor shape. A prior local Android run recorded raster TileJSON/template proof-panel evidence, but the ignored `reports/native-maplibre/latest.json` artifact is mutable and is no longer a stable raster proof reference after the vector harness replaced it. The current `reports/native-maplibre/latest.json` validates Android vector TileJSON/template rendering through `VectorSource` on Samsung SM-P613 with positive tile requests. Neither path proves raw PMTiles/MBTiles archive rendering, imported raster/aerial package rendering, or iOS behavior.

Current installed state:

- `apps/mobile/app.json` includes the `@maplibre/maplibre-react-native` config plugin.
- `apps/mobile/package.json` depends on `@maplibre/maplibre-react-native`.
- `packages/map-adapters/package.json` depends on `@maplibre/maplibre-react-native`, `maplibre-gl`, and `pmtiles`.

## Metadata To MapLibre Source Mapping

Existing `MapPackageManifest` metadata maps to MapLibre React Native source props this way:

| Project metadata | MapLibre RN source field | Notes |
| --- | --- | --- |
| `id` | `id` | Stable source id. |
| `tileContentType` | source component choice | `raster` uses `RasterSource`; `vector` uses `VectorSource`. |
| `tileJsonUrl` | `url` | URL to a TileJSON document. |
| `tileUrlTemplates` | `tiles` | URL templates such as `{z}/{x}/{y}`. |
| `minZoom` | `minzoom` | Must remain in the 0-22 source range. |
| `maxZoom` | `maxzoom` | Must be greater than or equal to `minZoom`. |
| `tileScheme` | `scheme` | `xyz` or `tms`. |
| `attribution` | `attribution` | Passed through to the source. |

Raw `pmtiles` and `mbtiles` archives are not native-renderable from metadata alone. They need one of the accepted adapters below before `describeTilePackageReadiness(..., "native_maplibre_rn")` may report `canRender: true`. The platform-specific readiness targets `android_maplibre_rn` and `ios_maplibre_rn` preserve the same generated TileJSON/template path while keeping direct local archive schemes behind device-proof gates.

Current chosen adapter path: generate TileJSON plus app-readable tile URL templates. `packages/core/src/mapTilePackages.ts` treats those local sources as the lowest-risk native MapLibre descriptor shape for browser, Android MapLibre RN, and iOS MapLibre RN targets. The aerial imagery resolver accepts local raster package metadata for generated NAIP-style packages, and the native reference-overlay resolver accepts local vector package metadata plus source-layer contracts. Raw PMTiles/MBTiles still need a local protocol, conversion, extraction, or tile-serving adapter before native rendering claims.

## Aerial Raster Package Shape

The offline aerial package lane is `cplayout-map-package-v1.zip`:

- `manifest.json` with `packageType: "raster_tiles"`, `tileContentType: "raster"`, attribution, license, bounds, zoom range, generated TileJSON or tile URL templates, and optional `imageryProvenance`.
- Optional `tilejson.json` when the manifest references it.
- `tiles/{z}/{x}/{y}.png` concrete PNG entries.

Exported project metadata must use logical `app://map-packages/<id>/...` URLs rather than absolute machine paths. Android import through the Files panel extracts those files into Expo FileSystem document storage, stores logical metadata in `project.mapPackages`, and keeps rewritten file-URI manifests in runtime state before passing them to MapLibre RN `RasterSource`. The SVG editor remains the geometry mutation surface; the MapLibre aerial surface is a reference display until camera/edit synchronization is independently proved.

Use `docs/native-maplibre-render-report-template.json` for a completed native MapLibre render report. The roadmap runner validates a vector proof report only when it includes device/build identity, `tileContentType: "vector"`, `sourceComponent: "VectorSource"`, source layers for roads/borders/labels/place data, a local TileJSON or tile URL template source, positive tile-server request evidence, screenshot hash and pixel metrics, and the explicit boundary that raw PMTiles/MBTiles native rendering was not proved. The 2026-06-05 SM-P613 vector report satisfies that vector proof shape for the generated local proof source.

## Accepted Future Adapter Options

- Local HTTP tile server that exposes app-readable TileJSON and tile URL templates.
- Extracted XYZ/TMS tile directory plus generated templates pointing at app-readable tile URLs.
- Generated TileJSON pointing at app-readable tile URLs.

## Deferred Dependencies

MapLibre React Native is not part of Expo Go and requires a native app build or development build. The dependency is already present, and the generated TileJSON/template descriptor path exists. Android vector-source proof for the generated local proof source is current through the 2026-06-05 SM-P613 report. The deferred work is raw local archive rendering, imported raster/aerial package rendering, iOS proof, and any broader production-map evidence beyond the local proof source.

## Primary Sources

- MapLibre React Native Expo setup says the package cannot be used with Expo Go: https://maplibre.org/maplibre-react-native/docs/setup/expo/
- RasterSource supports `url`, `tiles`, `minzoom`, `maxzoom`, `scheme`, and `attribution`: https://maplibre.org/maplibre-react-native/docs/components/sources/raster-source/
- VectorSource supports TileJSON URLs and tile URL templates: https://maplibre.org/maplibre-react-native/docs/components/sources/vector-source/
- PMTiles browser integration uses MapLibre GL JS protocol registration, which is not the same as a native MapLibre RN local archive adapter: https://docs.protomaps.com/pmtiles/maplibre
