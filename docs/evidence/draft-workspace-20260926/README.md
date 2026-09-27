# Draft Workspace Acceptance

Working-tree checkpoint started 2026-09-26 UTC; final browser runs complete 2026-09-27 UTC. This accepts the selected App workflows below, not the full refactor, entire browser inventory, native runtime or physical hardware accuracy. No commit/push was performed by this mapping continuation.

## Scope

Actual empty DesignDraft creation and mixed catalog opening; partial inputs and supplied-geometry-only Polygon/Line/Point capture; revision-checked save/reopen, undo and draft ZIP export; calculation admission without Layout promotion; dirty-project departure, delayed writes, stale feedback, independent copy and complete-project import regressions. Existing work is preserved. No new package, paid service, receiver actuation or credential change was made.

The final correction places camera tooltips left of their column so Fit does not cover Zoom Out. Bottom capture controls retain above-button tips. Independent read-only QA identified a missing delayed-failure branch in the test; the strengthened test hides the creation form through discard confirmation, observes exactly one injected failed write, and checks that newer navigation cannot revive the old form/error. Catalog row selectors now match exact names rather than also matching their separate Open buttons.

## Evidence

- [Combined browser report](browser-final.json): 161 passes, four explicit skips, zero failures/flaky cases/retries/runner errors, exit 0. The skips are the two desktop-only inline-form races on tablet and phone.
- [Catalog report](catalog-final.json): nine passes, zero failures/skips/retries, exit 0. Covers blank design, client/project/field-map creation and client lifecycle across all three viewports.
- [Source/build identity](identity.json) and [293-path source snapshot](source.json): selected application/package/browser-test/root-configuration hashes unchanged; served and exported bundle bytes match. Concurrent launcher/governance files are deliberately outside this snapshot; this is not a whole-worktree freeze claim.
- [Adapter typecheck](adapter-typecheck.log) and [adapter tests](adapter-tests.log): corrected source, exit 0. [Final Expo export](export.log): exit 0.
- [Intermediate aggregate](validate-intermediate.log): `npm run validate`, exit 0, but overlaps concurrent tooling and the final tooltip edit. Do not treat it as a frozen final aggregate; the publication coordinator owns that later gate.
- [Audit](audit.json): zero vulnerabilities. The historical five-high count is superseded; no forced repair or installation was used. Skill/context checks and final diff check also pass in this continuation.

The final bundle is `index-4a9f6538b0f4bc2160404ed72697f621.js`, SHA-256 `03d15877a1676380426ae1fd0f7bdd0f0f36253e1c52278d0cc69db68a905fbf`. The exact repo-owned preview URL is `http://127.0.0.1:19006`. It remains intentionally available; `ui:test:stop` was not run and unrelated listeners were left alone.

Screenshots inspected: [desktop drawing](desktop-drawing.png), [tablet drawing](tablet-drawing.png), [phone drawing](phone-drawing.png), and [phone invalid CRS](phone-invalid-crs.png). Inputs, tool overlays, status and camera controls remain distinct in these tested portrait/desktop viewports. These screenshots use synthetic gestures and bundled test fixtures, not captured field observations. No private field data or credentials were collected for this packet.

## Earlier Attempts

Keep these outcomes separate from final acceptance:

- [Modal smoke](modal-smoke.json): 38 passes/four explicit skips before the final tooltip correction.
- [First catalog follow-up](catalog-before.json): ten passes, three failures, one explicit skip and four not-run cases. All three failures were ambiguous partial-name locators matching the new Open controls.
- [Corrected catalog follow-up](catalog-followup.json): 19 passes/two explicit compact skips, before the final tooltip correction.
- [Tooltip regression before correction](tooltip-before.json): one failure on the old build. The tooltip right edge was 1355 while the camera column began at 1314; see [the failed screenshot](tooltip-before.png). Final drawing cases require the tooltip to remain inside the map and wholly left of the control column, while saved geometry remains unchanged.

Reports retain original temporary trace attachment paths; traces themselves are not copied into this packet. The retained JSON, logs and selected PNGs are the durable evidence listed here. Earlier implementation attempts described in the main draft record are not silently promoted to final acceptance.

## Reproduction

```sh
npm run ui:test:status
npm run export:web
CPLAYOUT_WEB_PROOF_PORT=19006 npx playwright test tests/web/design-draft-editor.spec.ts tests/web/draft-unit-and-saved-items.spec.ts tests/web/editor-save-lifecycle.spec.ts tests/web/workspace-activation.spec.ts tests/web/project-copy.spec.ts tests/web/project-import-lifecycle.spec.ts --workers=2 --max-failures=3
CPLAYOUT_WEB_PROOF_PORT=19006 npx playwright test tests/web/browser-workflow.spec.ts --grep 'catalog blank design|map-first catalog tree|client detail manages' --workers=1 --max-failures=3
npm run typecheck -w @cplayout/map-adapters
npm run test -w @cplayout/map-adapters
npm audit --json
git diff --check
```

Reserve shared `dist` while browser runs are live. Use the repo launcher to create a server when none exists; do not kill unrelated listeners. Run the next full aggregate after all concurrent source/tooling edits have settled.

## Remaining Work

Draft ZIP import with fresh identities, shared drawing/editing parity, existing-feature vertex edits, dense labels, short-landscape draft layout, immutable Design-to-Layout targets, native versioned transactions and runtime proof remain unfinished. The next import packet is [specified in the draft record](../../draft-catalog-implementation.md#next-packet-draft-zip-import) and starts after the publication freeze.

Receiver/controller/relay/radio identities, electrical levels and level shifting, native USB/Bluetooth/Wi-Fi behavior, NS-RAW solver integration, independently supported comparison-frame derivation and maximum measured 3D error strictly below 0.10 m remain unverified. Browser/source tests, RTK-fixed labels and manufacturer specifications do not establish those physical results. The full goal stays active.
