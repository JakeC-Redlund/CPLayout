# Map Overlay And Layout RTK Gate

2026-09-25 historical packet. It covers the user's labeled on-map tool menus and shared Design/Layout appearance, plus mandatory live RTK-fixed collection authorization in Layout. Its evidence identifies that working tree, not the later combined tree. Existing dirty work was retained; nothing was committed or pushed by this pass.

## Scope

- Shared DrawingToolPalette overlay on browser MapLibre and SVG, with labeled buttons and contextual actions. Geometry tools no longer duplicate the workflow sidebar.
- Geometry remains projected/local XY. Pointer drawing remains Design-only; receiver setup navigation is available in both modes.
- Layout overrides a weaker fix setting to RTK fixed without relaxing the other quality checks. Capture and draft-commit handlers recheck session ownership and monotonic age at action time.
- Buffered Layout boundary, obstacle, line and polygon saves require current accepted lock plus fixed non-replay v2 evidence at every vertex. A new fixed lock cannot promote older float vertices.
- SVG draft controls use measured toolbar height. Pan preserves the active receiver sidebar and its unfinished capture.

## Verification

- Full `npm run validate`: exit 0. Subsequent mobile TypeScript check after the one-line Pan/sidebar guard: exit 0.
- `npm run validate:skills`: exit 0, including context-map freshness.
- `npm audit`: exit 0, zero vulnerabilities. No packages were installed.
- `git diff --check`: exit 0.
- Browser regression packet: 42 passed, zero failures, retries or skips; desktop, tablet and phone projects. See `browser-regressions.json`.
- Final-build follow-up: 9 passed, zero failures, retries or skips. Menus were rechecked on browser/SVG at desktop, tablet and phone sizes. The Pan/session-retention case deliberately uses a 1366x900 viewport across the three browser profiles. See `browser-current.json`.

The 42-case packet covers both renderers' labeled menus and keyboard dismissal, standard point/line/polygon drawing, Fit/undo/camera preservation, SVG labels through resize, tablet layout bounds, synthetic receiver lock loss and same-task stale commit rejection, and capture-evidence ZIP round trips. It used the pre-Pan-guard web bundle `index-65268ba548bfeb10b7d66c5497edcaa9.js`, SHA-256 `c019e38d2a294e960213b904eb3daa7bb85fd6389946fb3f6d718b0a2bf05fbf`. Served bytes at the launcher URL matched the export byte-for-byte.

Final served bundle: `index-81a55c49c3393422e19c06a53bd1bf54.js`, 5,296,223 bytes, SHA-256 `ce087d146df88797144bb2008b4c68c737528e091793e5bf41b9c4b075f2a7b0`. HTTP 200 and byte-for-byte match with the fresh export were verified. The only runtime change between these two builds is retaining the active sidebar when Pan is chosen.

Final screenshot samples: [desktop Design](desktop-design.png), [phone Layout](phone-layout.png), [desktop SVG Design](desktop-svg-design.png), [phone SVG Layout](phone-svg-layout.png). Maps and receiver streams in browser tests use synthetic fixtures, not field evidence.

Final-build command:

```sh
CPLAYOUT_WEB_PROOF_PORT=19014 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/cplayout-overlay-current.json npx playwright test tests/web/map-fit.spec.ts tests/web/rtk-lifecycle.spec.ts --grep 'Pan map preserves|labeled map tool' --workers=2 --output=/tmp/cplayout-overlay-current --reporter=line,json
```

Command for that packet:

```sh
CPLAYOUT_WEB_PROOF_PORT=19014 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/cplayout-overlay-final.json npx playwright test tests/web/map-fit.spec.ts tests/web/rtk-lifecycle.spec.ts tests/web/map-camera.spec.ts tests/web/maplibre-runtime.spec.ts tests/web/browser-workflow.spec.ts --grep 'labeled map tool|standard drawing tools|Layout requires current|Fit field preserves|SVG labels stay separated|RTK captured v2 evidence|offscreen accepted vertex|loaded map updates edited|tablet portrait map console|tablet landscape map console' --workers=2 --output=/tmp/cplayout-overlay-final --reporter=line,json
```

## Review And Limits

A bounded high-effort read-only reviewer found no confirmed authorization bypass and requested additional stale-action and evidence-disagreement regressions; those were added. Coordinator visual review found and corrected missing browser expanded-state semantics and SVG draft-control overlap. An initial browser run was interrupted after those defects were identified; a subsequent run exposed a test-only array identity assertion, corrected to deep byte equality before the clean 42-case packet. Neither earlier run is counted as acceptance.

Research: [QField digitizing](https://docs.qfield.org/how-to/data-collection/digitize/) and [GNSS accuracy requirements](https://docs.qfield.org/how-to/navigation-and-positioning/gnss/), checked 2026-09-25. Details and workflow are in [Standard Drawing Tools](../../drawing-tools-refactor.md).

Receiver tests use synthetic Web Serial/NMEA fixtures. These checks do not prove physical hardware connection, Android/iOS execution, surveyed accuracy, native MapLibre, or a maximum 3D position error below 0.10 m. Receiver controls retain their existing unmount/close lifecycle; no background receiver service or new native transport is introduced.

Preview: `http://127.0.0.1:19014`, retained intentionally through the repo-owned launcher for user inspection. This is selected browser acceptance, not the full browser suite or release qualification.
