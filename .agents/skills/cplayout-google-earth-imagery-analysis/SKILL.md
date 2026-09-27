---
name: cplayout-google-earth-imagery-analysis
description: "Use for CPLayout Google Earth Pro imagery review, KML/KMZ overlay inspection, source-backed visual evidence collection, local OCR/CV companion analysis planning, field-boundary/pivot/corner-arm/obstacle recognition review, and advisory layout improvement while preserving projected XY canonical geometry and avoiding paid map APIs, hidden keys, Google imagery caches, or native/mobile Google Earth runtime claims."
---

# CPLayout Google Earth Imagery Analysis

## Core Rule

Use Google Earth Pro imagery, screenshots, and KML/KMZ overlays as local companion evidence only. Keep derived observations advisory until an operator explicitly redraws, imports, or accepts geometry through CPLayout's existing projected `XY` workflows.

Do not use this skill to create a Google imagery cache, scrape or bulk-process Google imagery, generate a substitute mapping dataset, embed Google Earth in CPLayout, or claim mobile/native runtime behavior from desktop Google Earth proof.

## Quick Start

1. Re-read `AGENTS.md`, then run `git status --short` and preserve pre-existing work.
2. Review current Google Earth/KML records before making claims: `docs/google-earth-map-improvement-loop.md`, `docs/google-earth-import-wizard-research.md`, `docs/kml-kmz-google-earth-source-ledger.md`, and `docs/imagery-provider-tool-policy-ledger.md`.
3. Keep source-backed facts separate from local facts, assumptions, unknowns, and recommendations. For KML semantics, check the Google KML Reference, Google KML tutorial, and OGC KML page.
4. Inventory local screenshots, KML, and KMZ files with `scripts/inventory_ge_artifacts.py` before visual analysis when artifact proof matters.
5. Record evidence paths, SHA-256 hashes, image dimensions, KML/KMZ counts, capture context, attribution status, visual findings, confidence, and unverified claims.

## Workflow

- **Coordinate location:** Treat latitude/longitude input as a locator for Google Earth Pro review. WGS84 is input/display/interchange; CPLayout canonical project geometry remains projected/local `XY`.
- **Screenshot evidence:** Preserve visible attribution and provider labels. Do not crop attribution away. Store screenshots as local proof artifacts unless the user explicitly approves product-facing use after legal/policy review.
- **KML/KMZ overlay review:** Inspect exported CPLayout KML/KMZ for `doc.kml`, `Placemark`, `Style`, `styleUrl`, `ExtendedData`, and feature-count evidence. Treat `Style`, `LineStyle`, `PolyStyle`, `IconStyle`, `LabelStyle`, and `styleUrl` as visual interchange metadata only.
- **CV/OCR analysis:** Keep OpenCV, Tesseract, Python, GDAL, and similar tooling in local/offline companion scripts or preprocessing. Do not claim React Native can directly run these tools.
- **Fixture evaluation:** Use `tools/local-ml-companion` and `cplayout-ml evaluate-vision-fixtures` for repeatable local proof-packet checks. Inputs must be operator-approved local artifacts; outputs are advisory metrics and annotated PNGs, not geometry mutation or a Google imagery dataset.
- **Advisory output:** Express detections as planning-grade evidence or model recommendations. Do not mutate `PivotProject`, project schemas, persistence, archives, or canonical geometry unless a later implementation explicitly routes accepted geometry through existing CPLayout validation.
- **Session cleanup:** Inventory Google Earth Pro process metadata before launch and again after cleanup. Preserve screenshots, manifests, attribution evidence, and source artifact hashes already captured. Close CPLayout-owned or CPLayout-reused generated Temporary Places/import prompts without saving them into persistent My Places, unless the run explicitly used `-LeaveGoogleEarthOpen` for manual review. Never clear Google Earth caches, delete user saved places, or change Google Earth settings except in a separate explicit repair task. Report cleanup `status`, `failureReason`, whether force cleanup was used, and whether a targeted process remained. If cleanup is blocked or a targeted process remains, treat the run as a contaminated workspace failure even when visual proof passed.

## Recognition Checklist

Use this checklist as a review lens, not as automatic truth:

- Field boundary clues: fencelines, property separations, roads, ditches, canals, tree lines, buildings, service lanes, and obstructions.
- Existing pivot clues: circular crop rings, pivot center, radial tower alignment, machine access track, end-gun traces, and wet/dry contrast.
- Corner-arm clues: non-circular watered lobes, corner-swing paths, partial-circle stops, end-gun arcs, and overlap or no-spray zones.
- Layout design clues: candidate pivot-center shifts, field edge setbacks, water/power access, road conflicts, obstacle buffers, tower-clearance risks, and confidence warnings.

## Resources

- Read `references/imagery-analysis-workflow.md` for the end-to-end evidence and advisory recommendation loop.
- Read `references/kml-kmz-evidence.md` before inspecting or changing KML/KMZ behavior.
- Use `references/source-ledger-template.md` when updating docs, task logs, source ledgers, or known-gap records.
- Run `python3 .agents/skills/cplayout-google-earth-imagery-analysis/scripts/inventory_ge_artifacts.py <paths...>` to inventory local artifacts with no external dependencies.

## Validation

- Validate this skill with `npm run validate:skills`.
- Validate the script with `python3 .agents/skills/cplayout-google-earth-imagery-analysis/scripts/inventory_ge_artifacts.py --help` and at least one representative local artifact.
- Run `git diff --check` and `npm audit` after skill/doc edits. Run `npm run validate` only when TypeScript, UI, package config, or runtime code changes.
