# Imagery Provider And Tool Policy Ledger

Date: 2026-05-28
Last updated: 2026-10-18

## Decision

CPLayout uses open-source client software and free/no-cost, attribution-visible imagery paths. Offline NAIP-style raster packages are the production U.S. farm-scale aerial imagery path. Live imagery is an optional connected preview only. Neither path may become canonical geometry, a bulk downloader, a hidden-key integration, or a cloud telemetry path.

The v1 built-in live provider remains USGS The National Map Imagery Only and is labeled as connected preview. Custom open XYZ/WMTS templates are allowed only when the operator supplies a fixed tile URL template, attribution, license text, and no credentials. Reference overlays prefer local vector packages; when none are available and browser live reference sources are enabled, public no-key USGS TNM Imagery Topo may be used for roads, administrative boundaries, and labels. OpenLayers stays deferred until browser-side raster reprojection into arbitrary projected views is needed.

## Source refresh — 2026-10-18

The retrieved USGS Imagery Only service metadata advertises Web Mercator (EPSG:3857), 256-pixel mixed-format tiles, product-specific acquisition years, and a June 2024 refresh notice. It also identifies restricted Alaska imagery. Endpoint availability and service export capabilities do not establish rights to copy every covered product. Retain attribution, acquisition/product identity, CRS and source-specific offline permission in package provenance.

The retrieved USGS NAIP product page distinguishes historical 1-metre imagery from the 2018 0.6-metre standard and optional 0.3-metre products. It describes NAD83/UTM quarter quads and WGS84/Web Mercator post-2013 JPEG2000 products. Inspect each actual source dataset before preprocessing; pixel resolution does not qualify survey accuracy or authorize a datum operation in CPLayout.

Primary retrievals: [USGS service metadata](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer?f=pjson), [USGS NAIP](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip), [OSMF raster tile policy](https://operations.osmfoundation.org/policies/tiles/). OSMF public raster tiles prohibit bulk/offline fetching, including automated viewport harvesting; synthetic local fixtures are used for GIS proof.

Raw archive transport remains platform-specific. PMTiles browser protocol support and configured TileJSON descriptors do not establish native file access, current App integration or device rendering. Offline raster admission requires explicit copying permission and a validated package-contained resource graph. Missing provenance remains unqualified; rejected packages and original metadata remain available for recovery.

## Local Facts

- App/session online imagery settings live in `packages/core/src/settings.ts`.
- Project-safe local aerial imagery preferences live in `packages/core/src/settings.ts` as `aerialImagery`; live `onlineImagery` remains app/session-only and is excluded from project exports.
- Map package manifests carry optional `imageryProvenance` in `packages/core/src/mapTilePackages.ts` and `packages/core/src/types.ts`.
- Offline aerial package archives use `cplayout-map-package-v1.zip` with logical `app://map-packages/<id>/...` URLs and are parsed by `packages/project-store/src/mapPackageArchive.ts`.
- The Files panel exposes native map-package ZIP import; Android package install rewrites logical URLs to app-readable file URIs in `packages/project-store/src/mapPackageArchiveInstall.native.ts` while project metadata keeps the logical URLs.
- SVG tile planning lives in `packages/geometry/src/onlineImagery.ts` and is Web Mercator gated.
- SVG attribution rendering lives in `packages/map-adapters/src/SvgMapSurface.tsx`.
- MapLibre preview files are present under `packages/map-adapters/src/`; Android aerial `RasterSource` runtime behavior for imported local packages still needs a completed device screenshot report.
- Project export settings intentionally exclude `onlineImagery`; canonical project geometry remains project-CRS `XY`.
- Google Earth-inspired Help, Places/Layers, and import-wizard wording is a companion workflow and training surface only. It does not add Google Earth imagery as a CPLayout provider, permit Google imagery caching, or create a substitute mapping dataset.

## Provider Ledger

| Source | CPLayout policy | Primary source |
| --- | --- | --- |
| USGS TNM Imagery Only | Built-in connected U.S. imagery preview for v1, capped per viewport and not persisted into project exports. | USGS lists `USGS Imagery Only` as a National Map base map and describes resolution variation; TNM tiled services use Web Mercator. https://www.usgs.gov/faqs/what-are-base-map-services-or-urls-used-national-map |
| USGS TNM imagery service endpoint | Current built-in URL-template source for connected preview. Keep attribution visible. | Service metadata says the service is a cached orthoimagery basemap, mostly NAIP in CONUS, with resolution varying from 6 inches to 1 meter. https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer?f=pjson |
| USGS TNM Imagery Topo | Public no-key browser reference overlay for roads, administrative boundaries, and labels when no local vector reference package is available. | Service metadata describes a cached basemap of orthoimagery and US Topo vector data visible to the 1:9,028 scale. https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer?f=pjson |
| NAIP | Primary offline/preprocessed U.S. farm-scale aerial package source. Download outside the app, tile into XYZ PNG plus TileJSON, and import as `cplayout-map-package-v1.zip`. | USGS EROS describes NAIP as USDA aerial imagery acquired during agricultural growing seasons in the conterminous United States, with public-domain usage notes and historical 1-meter GSD coverage. https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip |
| NASA GIBS | Candidate custom fixed-template science layer if license, attribution, layer, and time are explicit. | GIBS documents standards-based WMTS/WMS/TWMS/XYZ access. https://nasa-gibs.github.io/gibs-api-docs/access-basics/ |
| Landsat and NASA Earthdata | Offline/preprocessed source lane. | NASA Earthdata open data guidance: https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-information-guidance |
| Copernicus Sentinel | Offline/preprocessed source lane or explicit custom source with required notices. | Copernicus data access terms: https://www.copernicus.eu/en/terms-use/how-access-data |
| OpenAerialMap or user-owned tiles | Allowed as custom open imagery when attribution/license are supplied and credential-free. | OAM legal page: https://openaerialmap.org/legal/ |
| OpenStreetMap public raster tiles | Excluded for CPLayout live imagery and offline/bulk use. | OSMF tile policy restricts bulk download and prefetch patterns. https://operations.osmfoundation.org/policies/tiles/ |
| Google, Bing, paid Mapbox, paid Esri/ArcGIS, keyed trial providers | Excluded. | Current selected architecture and task-selected GIS/preflight skills; no paid maps, hidden keys, or trial-only SDKs. |
| Google Earth Pro screenshots | Local companion design-review evidence only when attribution remains visible. Do not cache imagery as a dataset, embed Google Earth imagery in CPLayout, bulk mine screenshots, or treat screenshot-derived CV as survey data. | Google Geo Guidelines require proper attribution and restrict commercial/promotional use; Google Maps/Earth terms prohibit bulk feeds, mass download, and substitute mapping datasets. https://about.google/brand-resource-center/products-and-services/geo-guidelines/ and https://maps.google.com/help/terms_maps-earth/ |

## Tool Ledger

| Tool or format | CPLayout policy | Primary source |
| --- | --- | --- |
| MapLibre raster sources | Preferred renderer path for generated local aerial package TileJSON/templates and optional USGS live preview. | MapLibre RN `RasterSource` accepts TileJSON `url`, tile URL templates, zoom bounds, scheme, tile size, and attribution. https://maplibre.org/maplibre-react-native/docs/components/sources/raster-source/ |
| GDAL raster tiling | Offline preprocessing lane only. Use outside the app to turn NAIP GeoTIFF/JPEG2000 into XYZ PNG tiles plus TileJSON/package metadata. | `gdal raster tile` generates separate raster tile files from a raster dataset. https://gdal.org/en/stable/programs/gdal_raster_tile.html |
| PMTiles with MapLibre | Advanced offline/native lane only until a local protocol or tile-serving adapter exists and devices pass. | PMTiles MapLibre docs: https://docs.protomaps.com/pmtiles/maplibre |
| MBTiles | Advanced offline/native lane; needs a local serving/protocol adapter before raw archive rendering claims. | Keep under `packages/project-store` metadata until adapter work is explicit. |
| COG/GeoTIFF | Offline preprocessing and companion-tool lane, not React Native runtime GIS. | GDAL COG docs: https://gdal.org/en/latest/drivers/raster/cog.html |
| OpenLayers | Deferred browser-only raster reprojection option. Do not add until MapLibre plus current SVG preview cannot meet requirements. | OpenLayers raster reprojection tutorial: https://openlayers.org/doc/tutorials/raster-reprojection.html |
| OpenCV Python/OpenCV.js | Local/offline companion CV lane for edge, contour, and circle detection over proof screenshots. Do not add to React Native runtime or use to derive canonical projected `XY` from Google imagery. | OpenCV Hough circle and OpenCV.js docs: https://docs.opencv.org/4.x/d3/de5/tutorial_js_houghcircles.html and https://docs.opencv.org/4.x/df/d0a/tutorial_js_intro.html |

## Non-Goals

- No Google, Bing, paid Mapbox, paid Esri/ArcGIS, hidden API keys, scraping, public OSM bulk tile use, or trial-only hosted imagery.
- No bulk caching, repackaging, or offline downloading of public live tile endpoints through CPLayout.
- No raw PMTiles/MBTiles Android production claim until a local protocol, conversion, or tile-serving adapter is implemented and device-proven.
- No claim that raw PMTiles/MBTiles rendering, iOS MapLibre behavior, iOS native ZIP sharing, current Android schema-v11 SQLite/ZIP behavior, Android imported raster/aerial package rendering, or broad Android vector MapLibre parity is production-verified before device/emulator evidence. Android vector TileJSON/template MapLibre has artifact-specific SM-P613 evidence, and Android canonical ZIP share/picker has historical schema-v10 evidence only until the current schema-v11 proof gate passes.
- No automatic geometry mutation from imagery. Imagery-derived vertices are planning evidence until field-verified and explicitly accepted.
- No verified Google Earth headless screenshot API, no permission claim for bulk automated CV extraction from Earth imagery, and no product-facing Google Earth comparison dataset rights.
