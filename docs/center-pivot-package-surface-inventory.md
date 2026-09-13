# Center Pivot Package Surface Inventory

Date: 2026-06-06
Last updated: 2026-08-09

## Decision

Keep center-pivot layout work inside the current workspace split. Pure domain and geometry code stays in packages first; UI wires tested package behavior second; native and map-runtime claims stay gated until the specific device proof exists.

## Package Surfaces

| Surface | Current role | Refactor guidance |
| --- | --- | --- |
| `packages/core/` | Project document schemas, project reducer, settings, coordinate transforms, map package manifests, map-feature upsert actions, and KML/XML map-feature import/export contracts. | Keep canonical project geometry in project-CRS `XY`. Keep WGS84 as input/display metadata. Planning boundaries, machine zones, linear move paths, measurement lines, wells, and wire paths are map/survey evidence unless explicitly applied through reducer-validated geometry edits. Do not expose app-importable expert-review or model-recommendation contracts. |
| `packages/geometry/` | Pure layout geometry, map interaction math, online imagery tile planning, deterministic scoring, advisory placement/corner-arm/machine-zone/machine-strategy/obstacle-interaction/sweep-efficiency review helpers, and local advisory design report builders. | Keep scoring and report generation side-effect-free. Use `evaluateLayout` metrics for coverage, outside-field acres, obstacles, machine constraints, projected collision/review zones, review-zone stale/missing/current audit, and confidence ranking. Cost efficiency requires explicit local cost inputs; obstacle interaction and sweep-efficiency reviews are qualified-review prompts only. Do not infer machine prices, certify designs, or certify object crossing/passability. |
| `packages/gnss/` | Platform-neutral GNSS transport contracts, strict NMEA parsing, coherent observation epochs, reception-time freshness, quality gates, projection preparation, and capture-evidence builders. | Keep platform drivers in app/native adapter surfaces. Require explicit source CRS before projection, keep WGS84 input/display-only, and do not turn parser/replay success into receiver or field proof. |
| `packages/map-adapters/` | SVG map surface, browser/native MapLibre workbench surfaces, overlay conversion, transient generated field-pivot advisory overlays, and limited reducer-backed boundary/obstacle/map-feature vertex edit controls. | Keep rendering read-only unless an explicit editor mutation path is implemented through core reducer actions. Edit controls must call projected-XY reducer callbacks; generated advisory overlay features must not write project geometry, storage, archives, or exports. |
| `packages/project-store/` | Web MVP local storage, native SQLite plans/adapters, ZIP/KML/archive export surfaces. | Keep project archives round-tripping through `projectArchive.ts` and `projectDocument.ts`. Export canonical project/GIS/survey/metrics/map-package files only; retired review entries are ignored on import and not persisted. |
| `apps/mobile/` | Expo React Native app, panels, settings UI, browser Web Serial adapter, transactional RTK capture workflow, design awareness review, local advisory reports, drawing tools, and export/import controls. | Wire package APIs after tests pass. Native GNSS adapters require a local Expo module and rebuilt development client. RTK writes remain explicit operator transactions; browser support does not prove receiver, Android/iOS, corrections, or field accuracy. |
| `docs/` | Verification gates, architecture notes, source ledgers, planning records. | Keep source-backed package/platform claims here, with unverified native claims explicitly blocked. |
| `.agents/skills/` | Repo-local reusable workflow surfaces. | Use for agent workflow guidance only, not product runtime code. |

## Data Flow

1. Operator input, imports, coherent quality-gated GNSS observations, imagery inspection, and companion reports produce candidate facts.
2. `@cplayout/core` validates project documents and canonical projected-XY geometry changes.
3. `@cplayout/geometry` computes deterministic layout metrics and ranks alternatives without mutating projects.
4. `@cplayout/project-store` stores canonical projects, snapshots, exports, and map package metadata; retired review tables are dropped in the final migrated schema.
5. `@cplayout/mobile` presents Dashboard, Map, Survey, Files/GIS exchange, Settings, and Help workflows. Geometry mutations dispatch explicit core reducer actions.

## Current Verification Boundaries

- Web MVP persistence uses browser local storage until Expo SQLite web WASM and COOP/COEP hosting are configured.
- Desktop Web Serial and sanitized NMEA fixtures prove only the browser adapter/source contract. Physical receiver compatibility, correction delivery, antenna/reference-frame handling, field controls, Android USB/Bluetooth, and iOS need the reports in `docs/rtk-gnss-integration-plan.md`.
- Native SQLite and ZIP sharing may typecheck and compile without proving device behavior.
- Android native MapLibre vector TileJSON/template rendering has a current SM-P613 proof report in the focused plan/source ledger. Raw PMTiles/MBTiles rendering, imported raster/aerial package rendering, and iOS native rendering remain advanced lanes until local adapter work and platform verification pass.
- Saveable geometry editing is still partial: SVG and browser MapLibre can commit drafts and expose limited boundary/obstacle plus saved map-feature point/line/polygon/circle center and circle radius-handle select/nudge controls with valid line/polygon delete through reducer validation, but direct drag editing, richer undo ergonomics, and native MapLibre runtime proof remain separate gates.
- Advisory machine zones, planning boundaries, linear move paths, measurement lines, pump/well locations, pipe/wire paths, power poles/lines, imported pivot evidence, generated within-field multi-pivot screening, generated multi-pivot scenario rows, current/missing/stale generated review-zone audit, local advisory design report export, full-scope compiled-boundary geometry/coverage metrics, projected collision/review zones, local cost assumptions, cost-per-acre strategy comparison rows, generated full-circle radius alternative rows, sweep-efficiency rows, obstacle interaction categories, bender/second-pivot opportunity envelopes, and machine-strategy comparisons are project review data. They do not implement runtime/certified multi-pivot collision prevention, bender/corner-arm proprietary kinematics, certified object crossing/passability, certified linear/lateral design, automatic/vendor cost quotes, certified/final client deliverables, or Google Earth/native runtime proof.

## Acceptance Checks

- `npm run validate`
- `git diff --check`
- `npm audit`
- Web export and Playwright screenshot for visible UI changes.
- `npm run check:android-tools` plus `docs/android-native-verification.md` only when native claims are in scope.
