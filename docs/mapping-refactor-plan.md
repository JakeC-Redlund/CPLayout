# Mapping Refactor Implementation

Review date: 2026-09-12

Initial refactor browser acceptance: 2026-09-13 UTC. The execution records below describe that historical checkpoint. Later corrections, dependency upgrades, current acceptance and publication are recorded in [mapping-rtk-quality-program.md](mapping-rtk-quality-program.md).

## Decision and Scope

Keep `MapSurfaceProps` compatible while sharing interaction behavior across SVG, browser MapLibre, and native MapLibre. Canonical project geometry remains projected/local XY. Project reducers remain responsible for topology validation, undo, persistence-facing mutations, and coordinate provenance.

Implementation preflight complexity band: `xhigh`; selected coordinator reasoning effort: `xhigh`; Subagent decision: `required` under the contract active at that point. The earlier planning-only `not useful` decision was superseded for implementation. Interface and GIS specialists used high reasoning for bounded implementation; imagery review used medium reasoning before its bounded implementation assignment. Writers owned disjoint files; hooks remain advisory.

Final documentation/verification closure uses complexity `medium`, selected reasoning effort `medium`, and Subagent decision: `not useful` under the subsequently supplied coordinator-only contract. All specialist tasks are closed. Closure gates are browser proof, record validation, diff hygiene, and audit reporting; no new architecture or package packet is introduced.

A subsequent SVG interaction/layout follow-up uses complexity `high`, selected reasoning effort `high`, and Subagent decision: `not useful` with the coordinator as the sole writer. Its gates are the full source validator, forced-SVG interaction tests, responsive overlap/size assertions, and screenshot inspection. It adds no dependencies or persistence changes.

## Implemented Boundaries

| Module | Responsibility |
| --- | --- |
| `packages/map-adapters/src/mapInteractionController.ts` | Framework-independent TypeScript state, input reconciliation, projected click intent, draft closure/commit, callback routing, selection, command eligibility, and status. Pure state/selectors are testable separately from callback dispatch. |
| `packages/map-adapters/src/useMapInteractionController.ts` | React subscription and current input/callback bridge. No renderer-specific camera behavior. |
| `packages/map-adapters/src/BrowserMapSurface.web.tsx` | MapLibre lifecycle, WGS84 display, hit testing, touch deduplication, and drag handling. Events use current controller state. Pointer cancellation restores the handle without committing. |
| `packages/map-adapters/src/NativeMapWorkbenchSurface.native.tsx` | Native events and style/camera binding. Uses the same manual capture and generic primitive routing; platform eligibility uses the actual Android/iOS target. Native behavior remains unverified. |
| `packages/map-adapters/src/SvgMapSurface.tsx` | SVG rendering, screen-to-XY conversion, snapping, and viewport state. Panning and fitting a view do not change drafts or project vertices. |
| `packages/geometry/src/mapInteraction.ts` | Existing viewport and draft-closure helpers; explicit open lines for snapping avoid nonexistent closing segments. |
| `packages/core/src/mapReferenceViewModel.ts` | Shared imagery/reference resolution and status for workbenches, settings, and layer sheets. SVG/online-preview policies remain explicit. |
| `apps/mobile/src/components/SettingsPanel.tsx`, `apps/mobile/App.tsx` | Consume shared source eligibility/status without implying observed rendering. |

No schema, project-store, archive format, paid-service, or native dependency change is required by this refactor. Existing geometry, GNSS, manual-design, and evidence edits in the worktree are preserved.

## Behavioral Contract

1. Catalog and Layout modes reject pointer mutation commands. Project/CRS and manual capture scope changes invalidate transient state. Pan/zoom is renderer-owned.
2. Switching the actual drawing mode, layer, feature kind, or primitive geometry clears incompatible drafts. Reopening a menu or repeating unchanged tool inputs preserves the draft.
3. Boundary/obstacle commits require at least three finite projected vertices and an available callback. Callback `false` retains the draft; a present callback returning `true` or `void` accepts it. Missing callbacks cannot clear a draft or claim success.
4. Only boundary/obstacle capture auto-closes. Generic Point, LineString, Polygon, and Circle capture routes through the purpose-selection callback unless an explicit feature kind is supplied.
5. Manual boundary, pivot, last-wheel, and machine-end capture invokes staging callbacks with the request identity. Canonical project application remains a separate operator action.
6. Selected vertices must still exist. Boundary, obstacle, feature vertex, and circle-radius commands retain their separate callback payloads. Existing `void` edit callbacks retain their compatibility contract; the reducer owns acceptance. A future acknowledged edit API must be introduced separately if required.
7. Effects run outside React state updater functions. Installed browser listeners read the latest draft, project context, and callbacks.
8. Open line features and unfinished drafts snap only to existing segments. Closed polygon rings keep their closing edge.
9. Feature save/staging callbacks returning `false` or `{ ok: false }` retain the draft. Browser/SVG second-click events are deduplicated without dropping the explicit close command. SVG pan release and browser drag cancellation cannot commit geometry.
10. On narrow external-HUD layouts, SVG draft controls occupy a scrollable band below the drawing surface. Zoom remains inside the map, reset remains reachable, and notices do not cover the drawing controls. Pan gestures suppress incidental browser text selection without changing project vertices.
11. The browser workbench bundles `maplibre-gl/dist/maplibre-gl.css` from the installed package. Markers, canvas placement, and navigation controls require that stylesheet; no CDN or new dependency version is introduced. This import is isolated to the web renderer.

## Validation and Acceptance

- Focused tests: `npx tsx packages/map-adapters/src/mapInteractionController.test.ts`, `npx tsx packages/core/src/mapReferenceViewModel.test.ts`, and `npx tsx packages/geometry/src/mapInteraction.test.ts`.
- Aggregate: `npm run validate`, `git diff --check`, and `npm audit`.
- Browser: `CPLAYOUT_WEB_PROOF_PORT=19006 npm run proof:web`; includes desktop, tablet, and mobile profiles, forced SVG fallback, no-paid/keyed-network checks, manual staging, and drag cancellation. This execution runs the export and browser suite separately, with disjoint selections and identical export/test/configuration hashes; it is not a completed monolithic `proof:web` command.
- Process records: `npm run validate:skills`; update generated governance records only if their existing source contract requires it.
- Manual browser inspection: `npm run ui:test:start -- --no-open`, use the exact printed URL, then `npm run ui:test:stop` when inspection ends.

### Execution Results: 2026-09-12 to 2026-09-13 UTC

| Gate | Result |
| --- | --- |
| `npm run validate` | Passed after the final SVG layout/gesture changes and bundled MapLibre CSS import, then passed again on resume. Every workspace typecheck and test command completed. All 203 recorded runtime/test source hashes still match. |
| Final map-adapter typecheck | Passed as part of that final aggregate run. |
| Independent controller review | Both rejected-save and double-click findings resolved; 24/24 controller tests passed. |
| `npm run validate:skills` | Passed after regenerating the documentation index hash; no unrelated governance data changed. |
| `git diff --check` | Passed. |
| Root `npm audit` | Exit 1: 13 affected packages, comprising 2 low, 10 high, and 1 critical. Not a security acceptance pass. |
| Playwright inventory | Passed: 99 scenarios across desktop, tablet, and mobile profiles; 297 cases. |
| Browser export | Passed. Final JavaScript is `index-568eff4dee9a25b0baed02022d6a8dd4.js`; local stylesheet is `maplibre-gl-251fdbfda84eb147f0a36795135ef43b.css`. |
| Full Playwright suite | Passed across 20 completed, disjoint reports: 296 passed, one intentional skip, zero failures, zero flaky cases. All 99 scenarios and 297 unique scenario/profile pairs were reconciled against the current inventory. |
| Native/device/field checks | Not run; remain unverified. |

Preflight retained 63 modified/untracked files in an external recovery snapshot. All 50 pre-existing files outside the 13 integration paths remain byte-identical to that snapshot. Scoped integration diffs preserve prior edits. Current refactor changes remain local and uncommitted; see the separate migration execution record for what was pushed.

The independent imagery review's native credit/license gap is resolved in source: native status includes active aerial and renderable overlay attribution and license text. No device rendering claim follows from that source change. A source test pass is not device, field, or release proof.

Earlier browser attempts are not aggregate acceptance evidence: one was deliberately interrupted to fix observed compact SVG overlap, and another ended with SIGTERM (exit 143) before suite completion; the termination cause was not established. A later final-source catalog/workflow batch also ended with SIGTERM without a completed JSON report or a reported assertion failure. Its entire selection was repeated in smaller parts. A subsequent resume found no active advisory-batch runner or preview and no completed advisory-batch report; pending scenarios were repeated using persistent helpers. Both incomplete final-source runs remain excluded from acceptance. Inventory, partial output, and diagnostic results do not count as executed passes.

The fresh export completed despite slow mounted-filesystem I/O. Its output was promoted into `apps/mobile/dist` after the prior diagnostic runner stopped. The previous export remains in `.cplayout-local/mapping-refactor-previous-web-2026-09-12T18-25-10.140Z/`.

The first completed diagnostic batch ran 60 cases: 55 passed, one compact-mobile drag-control case was intentionally skipped, and four failed. Two failures exposed browser label selection preventing compact SVG panning; web-only `userSelect: none` on the drawing surface fixes the cause, and the regression now requires a changed SVG viewBox with unchanged saved project state. Two cancellation failures exposed missing MapLibre CSS: markers had computed `position: static`, which caused hidden container scrolling and incorrect drag positioning. Injecting the installed stylesheet diagnostically restored absolute positioning and an exact cancellation return (zero screen-position error), without dirtying geometry. The source now imports that stylesheet, and the tests require absolute marker/canvas positioning. Diagnostic injection is not final exported-app proof.

Final batch artifacts are retained in `/home/cyber/cplayout-mapping-recovery-20260912-EmIbXe/browser-proof/`. Each selection record includes JavaScript, CSS, entry HTML, test, and configuration hashes. The final aggregator verified all 99 scenarios and 297 unique scenario/profile pairs, identical hashes, completed result reports, and explicit skip annotations. It rejects incomplete, duplicate, failed, or flaky acceptance results.

Local-only evidence records:

- Acceptance summary: `reports/continuous-improvement/mapping-refactor-browser/summary-2026-09-13T03-21-42.825Z.json`.
- Source validation: `source-validation-2026-09-13T02-40-56.195Z.json` in the recovery directory; includes 203 runtime/test source hashes, with its hash scope stated explicitly.
- Served-asset/source verification: `preview-source-verification-2026-09-13T03-09-05.958Z.json` in the recovery directory; all recorded source hashes and the served HTML, JavaScript, and CSS matched.
- Root audit: `npm-audit-2026-09-13T02-50-15.155Z.json` in the recovery directory; 13 findings remain, including one critical.
- Persistent orchestration: `validation-tools/browser-campaign.mjs` and `validation-tools/review-packet.mjs` in the recovery directory. The browser helper preserves per-run logs and only accepts completed matching reports.

The sole skip is `cancelled browser vertex drag preserves saved geometry` on `mobile-390`, whose compact UI does not expose vertex drag controls. Desktop and tablet cancellation tests passed. Some existing cases contain profile-specific branches or viewport overrides; the total describes executed suite cases, not identical actions on every viewport.

The managed preview is `http://127.0.0.1:19006`, restored on resume with `npm run ui:test:start -- --reuse-export --no-open`. The launcher removed its stale record without terminating an unknown listener. Launcher status is healthy and launcher-owned. It is intentionally retained for owner review; stop it later with `npm run ui:test:stop`. Final-export SVG screenshots were inspected at desktop, tablet, and mobile sizes, along with desktop/mobile imagery and restored desktop drag-handle placement. Pixel inspection is separate from native or field proof.

## Remaining Proof and Non-Goals

Native MapLibre, imported aerial/raster rendering, raw PMTiles/MBTiles adapters, native SQLite/ZIP sharing, GNSS field behavior, and Google Earth rendering require their own runtime evidence. This refactor introduces no local tile server, bulk tile cache, Python/GDAL runtime inside React Native, storage migration, or automatic geometry admission from imagery/KML/CV.

KML/KMZ styles, imagery, and reference layers remain visual/evidence data. The reliable SVG fallback remains available. Project ZIP and schema contracts remain with project-store/core. See [dependency packets](dependency-upgrade-plan.md), [repository migration](github-migration-plan.md), and [native checklist](android-native-verification.md).

## Primary Sources

- [MapLibre CSS requirements](https://maplibre.org/maplibre-gl-js/docs/#maplibre-css): the stylesheet supports DOM markers, popups, and controls.
- [Expo SDK 55 global CSS](https://docs.expo.dev/versions/v55.0.0/config/metro/#global-css): Metro supports importing a vendored stylesheet for web.
- [MapLibre React Native Expo setup](https://maplibre.org/maplibre-react-native/docs/setup/expo/): development builds and native setup are separate from browser proof.
- [MapLibre style sources](https://maplibre.org/maplibre-style-spec/sources/): source configuration is not raw native archive support.
- [PMTiles MapLibre integration](https://docs.protomaps.com/pmtiles/maplibre): browser protocol registration is a distinct integration layer.
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/): platform-specific storage setup remains outside this change.
- [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/): public map services are not an offline bulk-download source.
