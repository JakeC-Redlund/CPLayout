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
