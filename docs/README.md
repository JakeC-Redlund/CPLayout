# CPLayout Docs Index

CPLayout is an offline-first, no-cost center-pivot planning app. Canonical project geometry is projected/local `XY`; WGS84, imagery, KML/KMZ styling, screenshots, OCR/CV, and Google Earth observations are input, display, or evidence layers unless a separate projected-XY workflow explicitly accepts geometry through validation.

## Required First Reads

- `AGENTS.md`: durable repository rules, preflight, reasoning policy, subagent policy, and validation gates.
- `docs/agent-governance-summary.md`: generated compact governance entrypoint.
- `docs/agent-context-map.md`: generated context packs, route read guidance, source hashes, and token budgets.
- `docs/agent-prompt-registry.md`: prompt routing, specialist scope, and hook surfaces.

## Task-Specific Docs

- Governance, hooks, skills, managed policy: `docs/agent-prompt-registry.md`, `docs/agent-source-ledger.md`, `docs/agent-known-gaps.md`, `docs/codex-managed-hook-deployment.md`.
- Local UI testing server launcher and Windows Desktop shortcut: `docs/local-ui-testing-server-launch.md`.
- Storage, archives, native proof: `docs/android-native-verification.md`, `packages/project-store/src/index.ts`, `packages/project-store/src/projectArchive.ts`, `packages/project-store/src/projectRepository.native.ts`.
- Imagery, KML/KMZ, Google Earth, ML/CV: `docs/kml-kmz-google-earth-source-ledger.md`, `packages/core/src/imageryEvidence.ts`, `docs/imagery-ml-capability-roadmap.md`.
- Interface and visible web/native proof: `apps/mobile/App.tsx`, `packages/map-adapters/src/SvgMapSurface.tsx`, `docs/android-native-verification.md`.
- Pivot, corner-arm, and irrigation design evidence: `docs/design-guides/topic-index.md`, `docs/corner-service-manuals/topic-index.md`, `packages/geometry/src/index.ts`.

## Optional Deep Records

- `docs/agent-source-ledger.md`: dated local and external source rows with boundaries.
- `docs/agent-known-gaps.md`: section-addressable proof gaps and non-claims.
- `docs/whole-codebase-improvement-loop-2026-06-01.md`: batch-classified loop inventory.
- `docs/evidence/`: curated proof summaries and hashes. Raw reports under ignored `reports/` are not durable records by default.

## Validation Commands

- `npm run context-map:build`: regenerate context-map JSON and generated docs after route/governance changes.
- `npm run context-map:check`: fail when generated context-map outputs are stale.
- `npm run validate:skills`: validate skills, hooks, route data, context map, required docs, and process records.
- `npm run validate`: run TypeScript and workspace tests after TypeScript or UI changes.
- `git diff --check`: catch whitespace errors.
- `npm audit`: report dependency advisories without force fixes.
