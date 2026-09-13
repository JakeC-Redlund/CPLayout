# Production Field Mapping Notes

## Source-Backed Decisions

- Codex guidance: OpenAI recommends durable repo instructions in `AGENTS.md`, planning for complex work, and asking Codex to run relevant tests/reviews before accepting changes. This repo sets the model in `.codex/config.toml`; reasoning effort is selected per task in `AGENTS.md` instead of pinned as a project-wide default.
  Sources: https://developers.openai.com/codex/learn/best-practices, https://developers.openai.com/codex/guides/agents-md, https://developers.openai.com/codex/config-reference
- Expo SQLite: `expo-sqlite` provides a persistent SQLite API and Expo recommends installing SDK packages with `npx expo install`.
  Sources: https://docs.expo.dev/versions/latest/sdk/sqlite/, https://docs.expo.dev/versions/latest/
- React Native gestures: `PanResponder` provides gesture state including movement deltas, which is sufficient for the MVP SVG survey canvas.
  Source: https://reactnative.dev/docs/panresponder.html
- Coordinate conversion: Proj4js supports transforms to and from WGS84, but high-accuracy datum/grid work needs explicit definitions or grid files.
  Source: https://proj4js.org/
- Offline map policy: OpenStreetMap's public raster tile service does not permit offline bulk downloading; use self-hosted tiles or providers/packages whose terms explicitly allow offline use.
  Source: https://operations.osmfoundation.org/policies/tiles/
- Advanced map renderer lane: MapLibre React Native is installed/configured in this repo. Generated TileJSON/tile-template descriptors are the supported native source shape, but each native claim must be tied to a completed device report. Imported local aerial raster packages, iOS, and raw PMTiles/MBTiles still need their own adapters or proof before production claims. Production apps must provide their own style/tiles.
  Source: https://maplibre.org/maplibre-react-native/docs/setup/getting-started/
- Tile package formats: PMTiles is a single-file tile archive; MBTiles stores tiled map data in SQLite and is limited to Spherical Mercator presentation.
  Sources: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md, https://github.com/mapbox/mbtiles-spec
- Google Earth exchange: KML coordinates are WGS84 longitude/latitude with optional altitude, and KMZ is a ZIP archive that should contain one primary KML file such as `doc.kml`. CPLayout treats KML/KMZ as WGS84 exchange only and projects imports into the project CRS before any geometry mutation.
  Sources: https://developers.google.com/kml/documentation/kmlreference, https://developers.google.com/kml/documentation/kmzarchives, https://docs.ogc.org/is/12-007r2/12-007r2.html
- RTK receiver boundary: desktop Chromium Web Serial uses explicit user device selection and asynchronous byte streams; Android native receiver work must use a rebuilt development client and Android USB host permission/endpoint handling; iOS Classic Bluetooth serial cannot be assumed because External Accessory is an MFi/manufacturer protocol boundary.
  Sources: https://developer.chrome.com/docs/capabilities/serial, https://developer.android.com/develop/connectivity/usb/host, https://docs.expo.dev/develop/development-builds/introduction/, https://developer.apple.com/documentation/externalaccessory/
- GNSS field metadata: antenna calibration is referenced to an Antenna Reference Point, and antenna type/height plus reference-frame/epoch facts materially affect high-accuracy results.
  Sources: https://www.ngs.noaa.gov/research/gnss-satellite/gnss-antenna-calibration.shtml, https://www.ngs.noaa.gov/OPUS/about.jsp

## MVP Implemented Here

- Coordinate format parsing/formatting for decimal degrees, degrees decimal minutes, degrees minutes seconds, and projected/local X/Y.
- Projected `XY` remains canonical for geometry and layout calculations.
- Field map viewport state supports pan, drag-pan, zoom, reset, mode selection, and active drawing layer selection without mutating geometry.
- Local settings are typed and validated; project-relevant settings are exportable while local package directories remain local-only.
- SQLite schema migrations cover projects, settings, large geometry vertex tables, survey points, GPS tracks, offline map package metadata, scenarios, and exports.
- Project files now have a versioned `pivot-project-v1` document validator, a local save/open repository interface, native SQLite repository implementation, browser local-storage repository implementation, and ZIP package round-trip logic.
- ZIP packages include `manifest.json`, `project.json`, scenario GeoJSON, Google Earth KML, survey CSV, metrics CSV, and map package metadata CSV. Map package binaries are referenced by metadata; they are not embedded as canonical project geometry.
- Google Earth KML/KMZ import/export is implemented as GIS exchange. KML/KMZ imports are reviewed before apply, converted from WGS84 lon/lat into the project CRS, and do not make WGS84 the canonical project geometry.
- Map package manifests now separate archive type from tile content type, tile scheme, TileJSON URL, tile URL templates, checksum, install status, attribution, and license.
- Aerial imagery preferences now separate offline local package selection from session-only live imagery preview. NAIP-style package provenance is stored as metadata; large tile binaries are imported map packages rather than canonical project geometry.
- The project files UI reports the active persistence backend, runtime, schema version, and project count so compile-ready native code is not confused with device-verified runtime behavior.
- The SVG drawing workspace supports draft vertex capture while keeping pan/zoom as viewport-only state.
- The GNSS package now assembles strict checksum-valid, coherent GGA/GST/RMC epochs; uses monotonic reception time for stale-data gating; requires explicit `EPSG:4326` source confirmation; and projects only accepted observations into canonical project-CRS `XY`.
- Survey, boundary, obstacle, and map-feature capture can retain `gnss-capture-v1` provenance through project validation and ZIP round trips. Referenced observations remain immutable evidence when the promoted infrastructure geometry later moves.
- Desktop Web Serial implements the shared GNSS transport for commissioning and browser testing. It is not Android/iOS or physical-receiver proof.

## Deferred Work

- Raw native PMTiles/MBTiles protocol adapters and iOS MapLibre runtime verification.
- Android imported local aerial raster package rendering through MapLibre RN `RasterSource`.
- Production web SQLite, because Expo SQLite web support is alpha and needs WASM plus COOP/COEP headers.
- Native large-file import workflows beyond user-picked ZIP packages.
- Advanced Google Earth constructs including NetworkLinks, overlays, 3D models, tours, embedded KMZ assets, style fidelity, and altitude/extrusion semantics as engineering data.
- iOS native SQLite/FileSystem/Sharing runtime acceptance; current Android schema-v11 SQLite plus ZIP share/picker proof requires a newly completed report, while the completed 2026-06-03 and 2026-06-05 Android reports remain historical schema-v8/schema-v10 evidence.
- Full geometry editor commit/undo flows from draft vertices into project field and obstacle entities.
- R-tree/FTS/SQLCipher configuration gates after target platform builds are established.
- Physical receiver commissioning, Android USB/Bluetooth, iOS BLE/MFi, RTCM/NTRIP correction delivery, antenna/reference-frame capture UI, repeated control occupations, and field-accuracy reports. See `docs/rtk-gnss-integration-plan.md`.

## Current Native/Web Split

- Native: `projectRepository.native.ts` uses Expo SQLite migrations and exact project snapshots while still populating normalized geometry, survey, scenario, and map-package tables.
- Web: `projectRepository.ts` uses browser local storage for the MVP because Expo SQLite web needs extra deployment headers. ZIP import/export uses browser Blob/File APIs.
- Native ZIP sharing/import uses Expo FileSystem's `File`/`Paths` API plus Expo Sharing. This keeps deprecated FileSystem legacy calls out of the implementation.
