# SVG Label Refactor Evidence

2026-09-25 historical working-tree checkpoint at base HEAD `ec050f60bf515b5c4cbd40c3180615b5056e28b3`; no commit or push occurred in this packet. Its source manifest does not identify the later combined worktree. This is not a release or physical qualification report.

## Scope

Display-only symbol sizing, label priorities/collision placement, visible path/circle caption anchors, exclusion of map controls and label press handling. Project and design-draft streaming ZIP fixtures also received a shared timestamp under an advancing-clock mock; importer integrity rules and production archive code were not changed.

Two bounded high-effort read-only reviewers checked SVG display/picking and investigated the unrelated archive test failure. Both completed source review; neither claimed browser, native or hardware proof.

## Checks

- Twelve pure label/sizing/anchor tests passed.
- Full `npm run validate` and fresh web export passed on the final source, including the streaming fixture and dock-position corrections (both exit 0).
- `npm run validate:skills` passed.
- Live root `npm audit --json` reported zero vulnerabilities.
- Focused label press/drawing-capture checks passed on all three viewports; the subsequent sizing/overlap/rotation selection passed three cases.
- Final selected SVG regression acceptance passed all 27 cases, nine each on desktop, tablet and phone, in 297.25 seconds (exit 0). Zero failures, skips, retries, flaky cases or runner errors. It is not the full product browser inventory.
- `git diff --check` and `npm run context-map:check` passed.

```sh
CPLAYOUT_WEB_PROOF_PORT=19014 npx playwright test tests/web/map-fit.spec.ts --grep 'svg: standard drawing|svg: Fit|SVG ' --workers=2
```

[Build identity](identity.json) confirms all 315 frozen source paths and HEAD stayed unchanged through validation. The exported and served bundle hashes both equal `6180406424fa1d98763b194ee01615ba79423e01922bd22df3b9bdd312035080`. The [source manifest](source.json), [browser report](browser-final.json), [validation log](validate.log), [export log](export.log), [audit](audit.json) and [skill validation](skills.log) are retained here. Source hashing covers the listed application/test/config paths, not subsequent documentation edits.

Inspected final screenshots: [phone polygon capture](phone-polygon.png), [desktop labels](desktop-labels.png), and [short landscape limitation](phone-landscape-limit.png). These use synthetic project data. The final drawing test includes the caption/control separation regression missing from the earlier run.

The repo-owned preview at `http://127.0.0.1:19014` was retained for user review at the time of this packet. No unrelated listener was stopped. The named raw-log directory `/tmp/cplayout-svg-labels-20260925-K3f9rE/` was absent during the 2026-09-26 publication review and is not retained evidence.

## Rejected Attempts

The first aggregate run failed because fflate streaming fixtures created local and central headers on different clock ticks. A read-only reviewer reproduced this independently; assigning one timestamp per ZIP resolved it without relaxing metadata admission.

Early browser selections failed for a missing SVG font-size attribute (the installed renderer uses CSS), a nonexistent feature-selection status message, overly strict stroke-bound assertions and captions correctly suppressed under dense/control-obstructed views. Tests now inspect computed fonts, actual selection styling and unchanged saved geometry. Stroke bounds include miter extensions and a half-pixel stability tolerance; pure conversion tests still require exact screen-unit scaling. Initial fitted views must contain labels; later dense views may suppress all captions, but every rendered label must satisfy bounds and collision checks. A separate test requires a visible, selectable point caption and verifies intentional drawing-mode capture over a caption location.

All failed reports remain failed; no retry or merged-success result replaces them.

A later 27-case run passed every selected test but did not catch a drawing-mode label partly hidden by the phone toolbar. Screenshot review and an independent settled-page DOM probe confirmed the defect: the recorded toolbar Y remained 216 while its actual viewport-relative Y had moved to 194 after measurement feedback reduced map height by 22 pixels. That earlier checkpoint is not final visual acceptance; the referenced `before-dock-fix/` directory is absent from this packet. The packet's corrected controls derived their absolute positions from shared style anchors and current viewport dimensions, and its drawing test asserted caption/control separation after reflow.

## Visual And Runtime Limits

Inspected synthetic-project screenshots show reduced symbols and separated captions. Very short landscape maps still have little usable area; Fit can compress the field enough that real coordinate-coincident symbols overlap. This packet does not solve all workspace density or coincident-feature selection issues. Selected labels can also be suppressed where there is no safe placement.

No Android/iOS, native storage/MapLibre, receiver/relay/radio, raw tile archive, Google Earth or independently surveyed less-than-0.10-m 3D proof is supplied here. The overall refactor remains active and incomplete.
