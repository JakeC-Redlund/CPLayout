# SVG Map Readability

Reviewed 2026-09-25. Complexity/reasoning: high. Subagent decision: required; one high-effort read-only reviewer checks SVG scaling, labels and picking. The coordinator owns all writes. Existing dirty work is preserved.

## Scope And Behavior

The SVG fallback previously rendered 27-pixel infrastructure text, roughly 50-pixel symbols and unconditional labels. Some other decorations were in world units, while minimum world-unit floors made nominally screen-sized markers enlarge at close zoom. Dense phone views obscured the underlying layout.

`packages/map-adapters/src/svgMapLabels.ts` provides pure display sizing and deterministic label placement. Draft/snap feedback and selected features have higher priority than passive survey and tower labels. Placement tries nearby right, left, above and below positions, reserves marker/edit-handle space, rejects offscreen anchors and suppresses text that cannot fit. Geometry and handles are never suppressed by this label policy. Long names receive a shortened map caption while the original name remains in accessible metadata and project data.

`SvgMapSurface.tsx` renders one collision-managed label layer and uses smaller, screen-sized infrastructure, survey, tower and advisory symbols. Decorative obstacle symbols scale around their unchanged projected anchor. Feature label presses select that feature and stop propagation; other labels consume the press. A label press in vertex-edit mode must not become a background geometry move. Drawing-mode capture continues to use its existing topmost capture surface.

Line and polygon captions anchor to a visible path segment; polygon captions intentionally use the perimeter rather than an unqualified vertex-average interior point. Circle captions use visible points on the actual circumference. Layout paths use their first visible centerline segment. Measured map controls, notices and drawing docks reserve display space. Point captions retain their compact purpose label and expose the full name as accessible metadata.

Absolute overlay positions are derived from the current viewport size and the same anchor constants used by their styles. A phone drawing regression showed that a size-only layout notification can retain an old toolbar Y position when the map shrinks but the toolbar itself does not resize. The unit and browser regressions cover that measurement-feedback reflow.

All project coordinates, circle radii, snap inputs, reducer operations, persisted documents and native transport contracts remain unchanged. No package installation, storage migration, hardware command or publication is included.

## Research

- [W3C SVG coordinate systems](https://www.w3.org/TR/SVG2/coords.html) defines how viewBox transformations map user-space units to the viewport. CPLayout converts desired screen dimensions into SVG units without world-unit size floors.
- [MapLibre symbol properties](https://maplibre.org/maplibre-style-spec/layers/#symbol) provides priority, overlap and variable-anchor controls. The SVG fallback uses a small pure placement helper for the same general interaction need, not a replacement map engine or a claim of MapLibre-equivalent typography.

Sources checked directly on 2026-09-25. The placement policy and numeric sizes are CPLayout design decisions, not surveying standards.

## Acceptance And Remaining Work

Final gates passed: 12 pure sizing/placement tests, full `npm run validate`, fresh web export, 27 selected Playwright drawing/Fit/label checks on desktop/tablet/phone, screenshot review, skill/context validation and `git diff --check`. Root `npm audit` reports zero vulnerabilities. The 315-path source manifest and served/exported bundle hashes match; browser results have no failures, skips or retries. See [exact-build evidence](evidence/svg-map-labels-20260925/README.md). This is selected acceptance, not the entire browser suite.

This does not implement a complete label engine. Symbol co-location remains true to coordinates; zooming and the existing inspector are needed to distinguish coincident features. Very dense data may suppress many labels. Native SVG font fallback and touch behavior require device verification. Imagery/reference labels and full-project model validation remain separate scopes. The overall refactor, native/hardware commissioning and less-than-0.10-m 3D qualification remain incomplete.

The first aggregate validation exposed a separate streaming ZIP test-fixture clock race. Independent read-only investigation reproduced it by advancing the clock between local and central header creation. Project and design-draft fixtures now set one timestamp per ZIP under a four-second clock-step mock. Importer integrity checks and production exporters are unchanged. That failed run remains a failed checkpoint; the fresh aggregate run passed after both fixture and dock corrections.
