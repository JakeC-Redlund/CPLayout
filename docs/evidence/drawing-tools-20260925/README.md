# Drawing Tools Acceptance

Recorded 2026-09-25. Base HEAD: `ec050f60bf515b5c4cbd40c3180615b5056e28b3`, with preserved pre-existing dirty work. This is a historical tested working tree, not the later combined tree or a published commit.

## Completed Checks

- `npm run validate`: terminal exit 0.
- Fresh Expo web export: terminal exit 0.
- `npm audit`: zero vulnerabilities.
- Selected Playwright drawing, Fit, SVG sizing/rotation, held-click cancellation and compact-HUD checks: 27 passed, nine each for desktop, tablet-768 and mobile-390; zero skipped, flaky, failed or retried cases.
- Served JavaScript at `http://127.0.0.1:19014` matched the local export SHA-256: `fbb6e3fd5d29bb8c4c1e5b6b46e7154056660e4a64706159a29dd53017b8f22f`.
- All 313 frozen source paths and HEAD remained unchanged through runtime proof. [Identity record](identity.json) contains build and log hashes; [source manifest](source.json) records the source hashes.

Command for the selected browser checks:

```sh
CPLAYOUT_WEB_PROOF_PORT=19014 npx playwright test tests/web/map-fit.spec.ts tests/web/browser-workflow.spec.ts --grep 'standard drawing|Fit uses|Fit field preserves|SVG aspect|SVG Fit cancels|compact HUD actions' --workers=2
```

Raw logs and intermediate diagnostics are retained locally at `/tmp/cplayout-drawing-20260925-p8cRye/`; that temporary path is not a durable repository artifact. An earlier 63-case checkpoint had 61 passes and two phone SVG Fit failures. Adaptive margins, short-landscape controls and rendered-SVG sizing corrected those failures; the final selected checks cover both. That earlier run is not relabeled a pass.

## Visual Review

The retained screenshots use synthetic map fixtures. Browser polygon drafts show closed fill, vertices, measurements and Finish/Undo/Clear controls. SVG capture controls and measurement feedback are visible, but existing infrastructure labels remain crowded at field scale, especially on phones. Label decluttering remains outstanding; this is not a claim of complete visual polish.

- [Browser desktop polygon](browser-desktop-polygon.png)
- [Browser phone polygon](browser-phone-polygon.png)
- [SVG phone polygon, including label limitation](svg-phone-polygon.png)

## Boundaries

No native Android/iOS, receiver, relay, Google Earth or less-than-10-cm 3D field accuracy proof was performed. Measurements are projected/local planar XY. No new dependencies or storage schemas were introduced by this drawing packet. No commit or push was performed.

The generated context ledger was refreshed after runtime proof because the documentation index changed. Inspection confirmed only that index hash changed in this refresh; the pre-existing package hash was preserved. A comparison of all 313 frozen paths found only `.codex/hooks/cplayout_context_map.json` changed, with no application/test source drift. `npm run validate:skills` then passed (terminal exit 0), and `git diff --check` passed. This metadata-only refresh does not imply a second browser build. The launcher reported the preview healthy after validation.
