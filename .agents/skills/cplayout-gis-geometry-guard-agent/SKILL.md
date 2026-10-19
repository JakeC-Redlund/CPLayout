---
name: cplayout-gis-geometry-guard-agent
description: Use for CPLayout projected/local XY, CRS, WGS84 input/display, coordinate transforms, geometry mutation, map package attribution, TileJSON, PMTiles, MBTiles, and GIS boundary reviews.
---

# CPLayout GIS Geometry Guard Agent

Use this skill when a CPLayout task touches coordinate systems, geometry authority, map package metadata, or tile package boundaries.

## Operating Rules

1. Start from the current user task and the current local files named by the coordinator.
2. Stay read-only unless a bounded worker scope is explicitly assigned.
3. Preserve projected/local `XY` in the project CRS as canonical geometry.
4. Treat WGS84, KML/KMZ coordinates, imagery labels, screenshots, OCR/CV output, TileJSON metadata, and operator labels as input/display/evidence until a reducer-backed projected-XY workflow accepts them.
5. Keep map package attribution and license metadata visible and source-backed.
6. Do not introduce paid APIs, hidden keys, cloud backends, Google Maps, paid Mapbox, or Esri paid services.
7. Return canonical-geometry risks, CRS/input-display separation, attribution gaps, tile adapter gates, validation commands, and no-overlap handoffs.

## Common Checks

- CRS or transform change: identify where projected `XY` is produced, validated, persisted, and exported.
- WGS84 display/input: confirm it does not become project truth without explicit projection and validation.
- PMTiles/MBTiles: keep raw archive rendering behind local protocol, conversion, or tile-serving adapter proof.
- TileJSON: treat as source metadata/template wiring, not proof that native rendering works.
- Imagery/KML: keep evidence and visual metadata separate from canonical geometry mutation.

## Current map and import review

- Start active workspace rendering at `packages/map-adapters/src/workspaceSceneRendering.ts` and `WorkspaceMapSurface.web.tsx` / `WorkspaceMapSurface.native.tsx`. Inspect legacy `MapSurface` and `NativeMapWorkbenchSurface` only when that separate lane is selected. Installed native dependencies do not establish the renderer chosen by the current App.
- Boundary imports must preserve the complete supported topology or refuse before mutation. Changed geometry cannot inherit capture associations from the old boundary; preserve unchanged geometry and immutable reference history.
- Validate XML structure by namespace URI and local name before conversion. A converter may silently omit valid namespace aliases; refuse unsupported forms atomically with an actionable explanation, preserve the original input, and test supported aliases separately. Do not infer complete conversion from a successful parse. Audit the retained converter’s actual qualified-name, wildcard, descendant and attribute lookup rules before freezing a repair. Cover foreign-namespace collisions, foreign-wrapper containment, default-namespace resets and mixed coordinate-selection precedence with failing-before/passing-after cases and supported-form controls. Keep conversion-fidelity admission distinct from full schema validation.
- For offline packages, inspect nested TileJSON resources and resolved transports as well as the manifest. Reject hidden network references and package traversal, honor offline-copy restrictions, retain attribution/bounds, and keep runtime paths out of portable metadata.
- Classify browser evidence as MapLibre-required, SVG-required, or renderer-independent. A fallback pass cannot qualify MapLibre rendering; screenshots and imagery do not qualify measured geometry.
