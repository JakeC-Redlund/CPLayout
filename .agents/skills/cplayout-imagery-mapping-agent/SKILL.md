---
name: cplayout-imagery-mapping-agent
description: Use for CPLayout imagery-assisted mapping, Google Earth Pro evidence review, field-boundary CV analysis, and pivot-layout candidate exploration inside operator-defined boundaries.
---

# CPLayout Imagery Mapping Agent

## Core Rule

Use imagery, KML/KMZ, OCR, CV, and Google Earth Pro output as evidence only. Operator boundaries and truth labels can guide scoring and review, but they are not automatic canonical geometry and must not mutate projected/local `XY` project data unless a separate accepted workflow does so explicitly.

## Workflow

1. Run the CPLayout preflight: read the current user task and coordinator-assigned scope, inspect `git status --short`, and preserve unrelated work.
2. Locate current imagery artifacts, KML/KMZ exports, screenshots, manifests, hashes, source ledgers, and companion-tool reports before proposing new analysis.
3. Classify each input as canonical project geometry, operator evidence, CV candidate, visual interchange metadata, or render proof.
4. For field-boundary or pivot-layout work, require a clear operator-defined boundary before optimization. If a boundary is missing, report the blocker instead of inventing one.
5. Prefer local, no-cost, offline methods: local companion tools, exported KML/KMZ, local screenshots, local OCR/CV, and source-backed algorithms.
6. For free U.S. aerial imagery, prefer offline NAIP-style raster packages generated outside the app with GDAL or equivalent preprocessing, then imported as `cplayout-map-package-v1.zip` with TileJSON/templates, visible attribution, and provenance.
7. Treat USGS TNM ImageryOnly as an optional connected preview only; do not use live public tiles as a bulk cache or offline package source.
8. Hand off geometry scoring questions to `$cplayout-center-pivot-design-agent`, UI presentation to `$cplayout-interface-development-agent`, and persistence/archive impacts to `$cplayout-database-agent`.

## Evidence Rules

- Keep KML/KMZ `Style`, `LineStyle`, `PolyStyle`, `IconStyle`, `LabelStyle`, and `styleUrl` visual-only.
- Do not claim Google Earth render success from exporter correctness, process launch, or a partial window capture.
- For visual-fidelity work, non-black rendered map evidence remains a hard acceptance gate.
- Do not claim Android aerial package runtime proof until a development client renders an imported local raster package through MapLibre RN with screenshot, pixel, attribution, source, and vertex-stability evidence.
- Record artifact paths, SHA-256 hashes when available, source URLs, and proof caveats.
- If Google Earth automation runs, close only its owned/reused session and generated Temporary Places without saving them to My Places; do not clear caches, delete saved places or change settings. Leave it open only when `-LeaveGoogleEarthOpen` is explicitly selected and reported.

## Non-Goals

- No paid imagery, Google Maps, paid Mapbox, Esri paid services, hidden keys, or cloud backends.
- No React Native claims that Python/GDAL/RTKLIB runs in the app runtime.
- No public live tile endpoint bulk caching and no raw PMTiles/MBTiles native rendering claim without a local protocol, conversion, or tile-serving adapter plus device proof.
- No automatic canonical projected-XY mutation from CV, KML style, Google Earth imagery, or operator scoring evidence.

## Outputs

Return verified local facts, candidate methods, source-backed claims, residual unknowns, affected files, validation commands, and whether the result is evidence-only or ready for operator review.
