# CPLayout Agent Instructions

## Repository Shape

- Root package manager shape: npm workspaces in `apps/*` and `packages/*`.
- Expo React Native app entry: `apps/mobile/App.tsx`, `apps/mobile/index.ts`.
- Shared TypeScript domain logic: `packages/core/`, `packages/geometry/`, and `packages/gnss/`.
- Reusable app UI components: `apps/mobile/src/components/`.
- Map rendering adapter boundary: `packages/map-adapters/`.
- Native/local storage adapters: `packages/project-store/`.
- Handoff and product specs: `center_pivot_react_native_development_handoff/`.

## Hard Constraints

- Keep the app free/no-cost and offline-first.
- Do not add Google Maps, paid Mapbox APIs, Esri paid services, paid imagery, paid cloud backends, hidden API keys, or trial-only SDKs.
- Do not claim React Native can directly run Python GIS packages. Python/GDAL/RTKLIB workflows belong in offline preprocessing or companion tools.
- Preserve canonical geometry as projected/local `XY` coordinates in the project CRS. WGS84 coordinate formats are input/display layers unless a schema change explicitly says otherwise.
- Treat KML/KMZ `Style`, `LineStyle`, `PolyStyle`, `IconStyle`, `LabelStyle`, and `styleUrl` as visual interchange metadata only; styling must not alter canonical projected `XY` geometry, project schemas, persistence, archive semantics, or imply Google Earth/native runtime proof.
- Verify package and platform claims from primary sources before changing architecture.

## Implementation Rules

- Start every non-trivial pass with a current-worktree preflight: re-read this file, check `git status --short`, identify pre-existing changes, and avoid reverting work you did not make.
- Prefer pure TypeScript domain logic with tests before UI wiring.
- Keep repo-local Codex defaults in `.codex/config.toml`; use `AGENTS.md` for durable engineering rules and verify loaded instructions before long-running passes.
- The CPLayout owner has persistently requested and authorized subagent use for non-trivial CPLayout planning, review, implementation, validation, and knowledge-curation work. The coordinator must state `Subagent decision: required/optional/not useful`; spawn bounded read-only or worker subagents when runtime tools are available and scopes are independent; otherwise record `Accepted fallback:` with the reason. Assign every subagent its own task-selected reasoning level, read/write scope, expected output shape, and no-overlap boundary. Keep the main agent on the critical path and avoid overlapping write scopes.
- Keep native dependencies minimal and installed through Expo when an Expo SDK package is available.
- SQLite is the preferred scalable local store for projects, survey logs, vertices, map package metadata, scenarios, and exports.
- Use the platform repository split: native persistence goes through `packages/project-store/src/projectRepository.native.ts` and Expo SQLite; web MVP persistence goes through `packages/project-store/src/projectRepository.ts` until Expo SQLite web WASM/COOP/COEP deployment is configured.
- Project ZIP packages must round-trip through `packages/project-store/src/projectArchive.ts` and validate with `packages/core/src/projectDocument.ts`.
- Treat MapLibre/PMTiles/MBTiles native rendering as an advanced lane unless the task explicitly asks for native map integration. MapLibre React Native may be installed/configured, but native MapLibre runtime behavior and raw PMTiles/MBTiles archive rendering remain unverified until the Android/iOS device checklist passes. MapLibre React Native sources consume TileJSON URLs or tile URL templates; raw PMTiles/MBTiles packages need a local protocol, conversion, or tile-serving adapter first.
- Keep drawing viewport state separate from geometry mutation so pan/zoom cannot corrupt vertices.
- Store project-relevant settings in project export data; keep local machine paths as local-only settings.
- Use repo-local skills in `.agents/skills/` when they match the task; they are reusable workflow surfaces, not product runtime code.
- Use the repo-owned launcher for local browser UI server sessions: `npm run ui:test:start` for static user-testing, `npm run ui:test:status` to inspect launcher-owned state, and `npm run ui:test:stop` for cleanup. Use `npm run dev:web:smart` only when Expo live reload is needed. Do not start ad hoc web servers or kill unknown port listeners when the launcher/status/stop commands can be used.
- Every CPLayout Google Earth Pro automation pass must clean up the targeted Google Earth session by default, or explicitly use and report `-LeaveGoogleEarthOpen` for manual review. Cleanup closes generated Temporary Places/import prompts without saving them into persistent My Places; it must not clear caches, delete saved places, or change Google Earth settings unless an explicit repair task requests that.

## Google Earth Pro Automation Checklist

- Preflight: inventory existing Google Earth Pro process state before launch or capture, identify the targeted CPLayout-owned/reused process, and preserve any already-captured screenshots, manifests, hashes, and attribution evidence.
- Capture: keep KML/KMZ styles as visual interchange metadata only. Do not treat exporter correctness, a launched process, or a partial window capture as Google Earth render proof.
- Postflight: run strict cleanup for the targeted Google Earth Pro session unless `-LeaveGoogleEarthOpen` was explicitly used for manual review. Cleanup may close generated Temporary Places/import prompts with discard or "Don't Save"; it must not clear caches, delete saved places, or change Google Earth settings.
- Failure gate: if cleanup is blocked or the targeted process remains after cleanup, mark the run contaminated and failed even when visual proof passed. `-LeaveGoogleEarthOpen` is the only accepted intentional skip and must be reported in the manifest or summary.

## Reasoning Policy

- Every non-trivial CPLayout pass must record a task-complexity analysis before mutation:
  - complexity band: `low`, `medium`, `high`, or `xhigh`
  - selected reasoning effort
  - `Subagent decision: required/optional/not useful` or `Accepted fallback:`
  - validation gates selected from the task scope
- Select reasoning effort from the task, not from a global default. Use `xhigh` only when the complexity analysis warrants it, including native/runtime proof, architecture or package/platform changes, storage contracts, release gates, managed Codex policy, Google Earth proof, broad cross-module mutation, or unresolved reviewer disagreement. A route-data `xhigh` value is coordinator guidance for the current task; it is not automatic inheritance for every subagent.
- Use `high` for bounded implementation or review with meaningful behavior risk, `medium` for narrow docs/tests/fixtures or read-only scans, and `low` only for trivial status or formatting work.
- Hooks may inject advisory routing context, but they cannot prove enforcement or change an already-running session's model settings.

## Current Blocker Boundaries

- Native SQLite and ZIP sharing may compile without proving runtime behavior. Do not report Android/iOS persistence as production-verified until a device or emulator run completes the checklist in `docs/android-native-verification.md`.
- Web SQLite remains research-gated because Expo SQLite web is alpha and requires WASM plus COOP/COEP headers. Browser local storage is the current web MVP backend.
- Tile package metadata is supported in project documents and SQLite. Native PMTiles/MBTiles rendering remains deferred until a real local tile source adapter is implemented and device-verified.
- The SVG map supports pan/zoom and draft capture state. Full saveable geometry editing is not complete until draft vertices can be committed to project field/obstacle entities with undo and validation.

## Planning Output Rules

- Decision-complete plans must state scope, files/modules, validation commands, non-goals, and claims that remain unverified.
- Plans that touch package/platform architecture must separate local facts from source-backed external claims and list the primary sources used.
- Plans that suggest subagents must define bounded ownership, expected output, and why the main agent can continue without waiting.

## Validation

- Run `npm run validate` after TypeScript or UI changes.
- For visible UI changes, prefer `npm run ui:test:start -- --no-open` for local static-export browser checks and capture a Playwright screenshot from the exact printed URL when available. Use `npm run proof:web` for deterministic browser proof, and keep `CPLAYOUT_WEB_PROOF_PORT` explicit when selecting a non-default proof port.
- Run `npm audit` and report findings. Do not apply breaking `npm audit fix --force` without explicit approval.
- Before reporting success, mention any checks that could not be run locally.
