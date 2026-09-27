# Mapping Touch Editing

## Scope

September 17 continuation of the [mapping workflow review](mapping-workflow-review.md). Complexity and selected reasoning: high. Subagent decision: required. The coordinator owns renderer integration and browser regressions; a high-effort read-only reviewer owns gesture/lifecycle findings; a separate high-effort worker owns only the pure gesture regression file. Existing dirty work is preserved. No new package, schema, native integration, hardware command or Git publication is included.

Canonical project geometry remains projected/local XY. Screen coordinates and dragged marker positions are previews until the existing reducer accepts an edit. Camera changes and layer changes do not admit new geometry.

## Editing Workflow

1. Open the field in Map and choose Design, then Edit.
2. Select Boundary, Obstacle or Feature. On a narrow display, the action row scrolls horizontally to expose previous/next, insert, nudge and delete actions.
3. Select a vertex and drag its handle, or use the discrete edit actions. Circle features expose a center and a radius handle.
4. A rejected edit displays its validation reason, keeps the original geometry and restores its marker. Correct the selection without restarting the field.
5. Undo reverses an accepted edit. Save Local persists accepted changes; dragging a preview does not save it.

The browser handle has a 44 CSS-pixel hit target. A tap or release within three pixels of the grab point does not commit a drag. This is an interaction threshold, not a projected-coordinate tolerance or accuracy claim. The grab offset is retained so touching the edge of the target does not jump its center.

Escape, pointer cancellation, unexpected capture loss, window blur, hidden-document transitions and renderer disposal cancel the active preview. A secondary pointer cannot move or release another pointer's edit. Right/middle buttons cannot initiate a drag. While a drag owns the pointer, map navigation handlers are temporarily disabled; only previously enabled handlers are restored afterward. Camera movement from another command, such as the visible zoom control, also cancels the drag before a late release can reinterpret it in a different camera frame.

Layout remains read-only for pointer geometry edits. Native MapLibre gestures, Android/iOS touch behavior and field accuracy require separate device evidence. Browser touch emulation does not satisfy those gates.

## Implementation

- `packages/map-adapters/src/vertexDragSession.ts`: pure single-pointer ownership, finite input, displacement threshold and terminal callback behavior.
- `packages/map-adapters/src/vertexDragSession.test.ts`: 24 focused gesture-contract regressions, including foreign pointers, late releases, button chords, reentrant callbacks and nonfinite input.
- `packages/map-adapters/src/BrowserMapSurface.web.tsx`: interactive compact action row, preview restoration, capture/cancellation wiring and map-instance-owned cleanup. The map is disposed only after its active drag is canceled and listeners are removed.
- `tests/web/browser-workflow.spec.ts`: phone early returns and explicit edit skips replaced with assertions; touch drag/cancel, two-finger ownership, rejection/correction, insertion/deletion/undo and renderer replacement regressions.

The original phone action row was present but its parent disabled pointer events whenever no draft could be committed. The original drag implementation also accepted foreign pointer events, left rejected marker previews displaced, omitted interruption handlers and retained listeners across map recreation. Independent review identified an incomplete camera lock; the final list includes pan, touch zoom/rotation, touch pitch, wheel zoom, keyboard, box zoom, mouse rotation and double-click zoom.

## Verification

Raw evidence is retained at `/home/cyber/cplayout-compact-mapping-85lIgJ/`. [The final evidence record](evidence/resumed-refactor-20260917/mapping-touch.json) identifies the source/build: full source validation and all 546 browser cases pass, 182 per viewport, with no failures/skips/flaky cases/retries. Postflight matches all 301 frozen paths and local/served bundle bytes. Audits report zero findings. Visual acceptance remains partial because of the tablet defect below; automated passes do not override that observation. [The execution log](full-refactor-execution.md) retains the complete sequence.

Retain failed attempts: the prior-build phone reproduction could not click Boundary because the canvas intercepted it. The first rebuilt smoke passed nine and failed two cases: a clipped compact action row and a restoration assertion comparing one screen position across several gestures. The revised check waits for the advisory banner and captures each gesture's starting position; layout movement is the inferred cause, not a separately instrumented finding. The next phone run passed twelve and failed a teardown test that incorrectly expected a settings change to remain saved. Correction of that test explicitly saves settings and checks unchanged boundary geometry before starting the gesture under test.

Validation gates: full source validation, focused gesture tests, map-adapter typecheck, exact-export browser touch/mouse regressions and screenshots, complete browser inventory, full/production audits, skills/context freshness and whitespace checks. Record failed, skipped and screenshot-only coverage separately from actual interaction evidence.

The first full browser attempt was deliberately interrupted after a separate coordinator probe found that disabling navigation handlers did not disable the visible zoom buttons. The probe changed the camera during an active preview and observed a committed edit on release. A `movestart` cancellation listener now covers such external camera commands. Preserve `zoom-during-drag-repro.*` and the superseded `browser-full.*` report: 216 passed, one interrupted, 326 unrun, exit 130. Its 327 reporter-skipped entries are not intentional coverage exclusions or a full-suite pass. Acceptance must use the later camera-corrected build and regression.

The camera-corrected focused attempt (`camera-smoke.log`) subsequently terminated with exit 143 without a JSON report. Its last progress entry starts case 27 of 45; no final pass count is claimed. The signal's origin was not established. The static preview remained healthy. Preserve that attempt separately from the later browser acceptance report; source validation and browser acceptance are serialized for the repeat.

## Sources and Limits

- [MDN Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) documents pointer identity, capture and touch-action behavior.
- [MDN lostpointercapture](https://developer.mozilla.org/en-US/docs/Web/API/Element/lostpointercapture_event) documents unexpected capture loss handling.
- Installed MapLibre source in `node_modules/maplibre-gl/src/ui/` is the authority for this build's default handlers and enable/disable behavior; the package version is recorded in the lockfile.
- Installed Playwright protocol declarations in `node_modules/playwright-core/types/protocol.d.ts` define the CDP touch sequence used in the browser tests. Touch end/cancel use empty touch-point lists; a changed active-point list releases an individual contact.

No public receiver specification, browser gesture test or reported RTK fix establishes less-than-0.10-m maximum 3D field error. Compact label crowding, incomplete field drafts, imagery/reference alignment and immutable Design-to-Layout targets remain separate work.

## Tablet Visual Defect: Historical Reproduction

The camera-corrected full-run screenshot `browser-camera-final-results/browser-workflow-MapLibre--67aaf-ved-geometry-for-correction-tablet-768/maplibre-rejected-vertex.png` shows the selected handle and wrapped actions, but the rejection/status text is not legible in the narrow map panel. The test's `toBeVisible()` assertion passed; it does not establish unclipped text. This prevents claiming complete visual acceptance from passing interaction tests.

Source review identifies a layout risk to address first: `compactLayout` follows the window's 760-pixel breakpoint rather than actual map-panel width; the external status HUD caps height at 168 pixels while wrapping controls and a flexing status group share that space. Treat that combination as a candidate cause, not a measured DOM diagnosis. Reproduce with text/container rectangles and clipping-ancestor checks at 768 pixels with the sidebar open, then base compact HUD layout on available panel width and keep rejection feedback outside any capped action scroller. Preserve minimum touch targets, imagery attribution, map space and selectable handles. Add screenshot and containment assertions, not another visibility-only assertion. No repair to this defect is claimed by this packet.

## Panel Feedback and Map Sources Followup

The subsequent packet reproduces clipping with measured text bounds in a 312-pixel map panel. The status HUD capped at 168 pixels placed rejection text outside its background. Compact HUD layout now follows measured panel width below 600 pixels, separately from the existing window-based shell breakpoint. Feedback has no height or line cap, does not shrink, and remains above the horizontally scrolling edit actions. Enlarged-text checks measure visible word fragments, HUD containment and clipping ancestors, not merely DOM visibility.

Provider credit remains fully visible on the map. Activate its information control to open Map Sources, which contains imagery and reference credits and license text. Close or Escape returns focus to the opener; Enter reopens it. Opening the dialog cancels an active vertex preview synchronously, so a late pointer release cannot commit an edit. Camera, selected vertex and saved geometry are unchanged by ordinary open/close. The dialog has an accessible name and no opening animation, avoiding an observed immediate-Escape race in the installed web Modal implementation.

Browser regressions also open/close the inspector, resize a narrow map panel during a drag, verify late-release cancellation, then pan to verify restored navigation. The resize case deliberately uses 1024- then 900-pixel windows in each browser project; it is not evidence at each project's default width. Ordinary rejection and source-dialog checks use desktop, 768-pixel tablet and 390-pixel phone settings. Drawing helpers verify that their coordinates hit the canvas rather than the expanded HUD.

Raw evidence is retained at `/home/cyber/cplayout-map-panel-E1HXen/`. Final acceptance and retained failed attempts belong in [the execution record](full-refactor-execution.md) and the curated panel evidence. This followup changes no canonical geometry, schema, dependency or native behavior. Camera persistence was not implemented at that checkpoint; the later packet is recorded below.

Keep the iteration gates ordered: typecheck a changed adapter before export, use a small interaction selection to reject unsuitable candidates, then freeze source and run full source validation followed by the broader browser selection. This packet observed a successful Expo export with an invalid property access; export success alone is not type safety. Preserve failed reports and recheck local/served bundle hashes after the final browser run.

The footprint fixture investigation also identifies an open workflow gap: `PendingDraftPurposePanel` receives no `editor.lastError`, while `savePendingMapFeatureDraft` retains the panel after reducer rejection. The retained failed screenshots show no rejection explanation there. `assertMapFeatureBoundaryPolicy` requires corner-swing-limit control points to remain inside the field. A larger screen triangle alone is therefore not a reliable valid fixture. The final success-path fixture uses an explicitly imported, roomy synthetic field; it must not relax that boundary policy. Before the camera packet, add local purpose-rejection feedback, unchanged draft/geometry assertions, and recovery/cancel coverage for out-of-field and malformed drafts. Do not infer the precise earlier rejection reason from the silent panel alone.

Final combined browser evidence covers 171 unique selected cases, 57 per viewport: 165 unchanged cases from `mapping-qualified.json` plus six replacements from `fixture-positioned.json`. Postflight recovers the earlier test file from its trace and verifies that only those two test bodies changed. Full source validation and export pass; current full/production audits report zero findings. This is neither one clean 171-case run nor the full browser inventory. The final footprint test verifies each displayed projected XY against the synthetic field and pans the phone map after tool selection, asserting camera movement before drawing.

Visual acceptance remains bounded. The final phone footprint screenshot shows the purpose panel successfully dismissed, but its opened inspector reduces map space enough that source credit overlaps part of the zoom control. The map also retains "Choose its purpose before saving" after successful purpose acceptance. Fix short-map control placement and success/rejection feedback together before claiming complete compact ergonomics. Tablet rejection feedback and phone rejection/source-dialog text were inspected and are readable; those observations do not override the remaining inspector-open defect.

## Pending Purpose Ownership

The next mapping packet adds transient draft ownership: project ID, CRS, load generation and a monotonically increasing draft ID. These values are UI session state, never project-document or archive data. The app refuses to replace an unresolved pending drawing, clones captured XY, and guards purpose save/cancel before invoking the reducer. Rejection keeps the same draft and displays its reason beside the purpose choices. Acceptance reports a geometry commit, not persistence; Save Local remains separate. Cancellation does not mutate project geometry.

The shared controller applies an outcome only to its matching accepted handoff and only once per receipt sequence. New drawings, explicit tools, selection, clearing, manual capture, workflow transitions, home and project replacement retire that eligibility. Same-ID reload is distinguished by the load generation. An atomic commit may select its newly added feature without losing the corresponding success status; unrelated selections cannot inherit it. Staging a subsequent point preserves the prior selection until acceptance, so it does not accidentally retire its own handoff.

Creation callbacks carry their originating render scope rather than adopting whichever project happens to be active later. The App editor dispatcher reduces once against synchronously current state and publishes that same snapshot. A boundary shrink and purpose save in the same event therefore use the shrunken boundary; a rejected save keeps the pending draft available for retry after undo. Scope and queue tests are software contract evidence, not native or field proof.

On a phone with an open inspector, the duplicate floating drawing palette is suppressed. The inspector's Tools tab remains available, and collapsing the inspector restores the palette. Full attribution and action feedback remain visible. Browser acceptance must measure the shortened map, including purpose rejection/retry/cancel and successful feature selection, rather than infer fit from DOM visibility. Current packet outcomes are recorded separately in the execution log; implementation alone is not visual acceptance.

## Camera Persistence Packet

A separate high-effort read-only interface review found that `projectionFrame` depended on the whole project and participated in map setup dependencies. Marker recreation also invoked reveal-panning, so fixing constructor dependencies alone was insufficient. The pending-purpose packet already passed App's load generation, including same-ID reopen, to the surface. This packet uses it for camera framing as well.

Implementation scope is limited to the browser renderer, a pure `mapCameraSession.ts` helper and its tests, map-adapter test registration, `tests/web/map-camera.spec.ts`, and `tests/web/maplibre-runtime.spec.ts`. No additional App or public surface-interface change is needed:

1. Use the load generation now passed into the surface. Define framing identity from generation, project ID, project CRS, home/project view and projection availability, excluding geometry revisions, settings and layer-source changes. Each transition retires its previous token, including valid-to-invalid-to-valid transitions; stale cleanup cannot restore an older frame.
2. Fit once on initial mount or framing-identity change. Ordinary accepted edits, undo/redo and rehydrated metadata update overlays and markers without reconstructing the camera. Keep projection validation current rather than freezing a project snapshot.
3. If style replacement needs a new map, restore center, zoom, bearing and pitch only for the same framing identity, without also supplying bounds. Use value identity from the complete style configuration with empty layout GeoJSON, and current refs for captured project/edit permissions. Deferred callbacks belong to the current map instance. Overlay synchronization follows layout-source readiness, not the one-shot load event or raster-tile readiness.
4. Reveal a selected vertex for explicit selection or changed viewport/HUD obstruction, not merely because an edit recreated its marker. Preserve current drag cancellation during replacement and never restore a camera from another project or CRS.

Acceptance starts with a deliberately panned/zoomed camera. Assert camera stability and current geometry/picking after accepted and rejected edits, undo/redo (including an offscreen selection), layer/imagery replacement, delayed loading and package rehydration. Assert one fresh fit on different-project open, same-ID reopen and CRS change, including undo across CRS; invalid CRS retains recovery behavior. Repeat touch ownership, renderer teardown, full source validation and exact-build browser/screenshots. No schema, storage, geometry algorithm or native-runtime change is included. Implementation alone is not browser acceptance; retain current results separately under `/home/cyber/cplayout-map-camera-OdWrMQ/` and record remaining coverage explicitly.

The new browser cases cover accepted/rejected offscreen boundary nudges, saved canonical XY, undo/redo, explicit same-vertex reselection, same-ID sample reopen, aerial-off style replacement, delayed raster requests after initial load and severe viewport shrink. The shrink case deliberately moves from 1366x900 to 390x844 in each browser project; it is not three distinct resize geometries. Pixel comparisons verify that two edits and undo update the rendered canvas while later raster requests remain held. Synthetic tiles and blocked external requests keep these checks independent of live service availability.

The pure helper covers every framing field, A-to-B-to-A transitions, stale disposal, copied snapshots and finite camera components. Runtime coverage must not be inferred from those unit tests: nonzero bearing/pitch restoration, same-mounted-surface CRS change/undo, descriptor-field changes and equal-value package rehydration still need dedicated browser cases. Existing CRS recovery tests exercise their own app recovery workflows. None of these checks establishes Android/iOS, native tile rendering or field positioning accuracy.

Next usability review: provide an explicit, discoverable fit-to-field action alongside retained pan/zoom, especially after importing distant geometry. Review browser/SVG behavior together, cancel any active drag before reframing, and verify that the action never changes canonical XY. This is followup scope, not a delivered control in this packet.

That followup is now tracked separately in [Field Fit and SVG Coordinates](mapping-field-fit.md), including actual-contact cancellation, aspect-correct SVG framing, web screen-transform hit-testing, and compact header changes. Read its own evidence before attributing those controls to an accepted build.

Final acceptance: full source validation passes, and [camera evidence](evidence/resumed-refactor-20260917/mapping-camera.json) records one clean 147-case selected browser run, 49 per viewport, without failures/skips/retries. All 308 final frozen paths and local/served bundle hashes match. The sole post-validator source change is a nine-line correction to a browser fixture excluded from aggregate source checks; the final browser repeat covers it. Audits report zero findings. Preserve the earlier 143-pass/one-failure run and both delayed-raster setup failures; they are not acceptance. The phone public-proof selection case remains screenshot-only, and the remaining coverage above is not implied by the pass count.
