# Field Fit and SVG Coordinates

## Operator Workflow

Use **Fit field** beside the map zoom controls to return to the committed field boundary after panning, zooming, or importing a different boundary. It is available in Design and Layout in the browser MapLibre and SVG surfaces. The catalog has no active field, so the command is disabled there.

Fit does not include distant infrastructure, utility features, advisory envelopes, or unfinished drawings in its target. It does not commit a draft, move a vertex, clear selection, change undo history, or save a project. Existing drafts remain available after fitting. Ordinary edits still preserve the camera; fitting is explicit.

The command reserves space for the surface's controls and status overlays. If the remaining map area cannot contain a fit, it leaves the camera unchanged. Collapse an inspector or enlarge the map before trying again.

## Implementation Boundaries

- `packages/map-adapters/src/mapFit.ts` computes finite bounds, uniform projected framing with asymmetric screen insets, and aspect-correct display viewports. Its one-metre minimum span is display-only, not a geometry validity or positioning-accuracy rule.
- SVG retains a raw camera and derives a display viewport matching the measured drawing area. Rendering, symbols, imagery planning, and screen-to-world conversion share that viewport. Screen panning derives its displacement from the display viewport but stores only the new center in the raw camera, avoiding extent growth during repeated resizing.
- Web SVG capture additionally inverts the actual rendered screen transform, accounting for browser numeric/layout precision at large projected coordinates. Native SVG retains the pure screen conversion and needs device proof. Neither path establishes field positioning accuracy.
- Installed `react-native-svg/src/web/utils/prepare.ts` assigns `onPress` to DOM `onClick`; web root and feature/vertex handlers now use that supported path. Vertex selection stops propagation so it cannot also move the previously selected vertex. Invalidated physical clicks are intercepted before SVG selection handlers run.
- Browser MapLibre transforms the committed boundary into display coordinates and uses the installed renderer's camera calculation. Screen fitting does not replace canonical projected/local XY.
- Fit cancels pending gestures before changing the camera. SVG also retires gestures on measured-size and project-generation changes. A fresh gesture is required before another point can be entered.
- `mapPointerGuard.ts` tracks actual web pointer contacts across mouse, touch, and pen. Cancellation retains held-contact ownership until all contacts drain. Compatibility mouse events and HUD presses cannot arm drawing. Native SVG keeps its responder-based path; native input ordering remains device-unverified.
- Narrow map headers retain the CRS, Design/Layout switch, and an accessible SVG-recovery icon instead of repeating the large workbench title and imagery name. Full imagery credit remains in the existing source controls. This restores map space when a phone inspector is open.
- No new dependency, project schema, storage migration, native MapLibre integration, hardware command, or Git publication belongs to this packet.

## Review and Evidence

Task complexity and selected reasoning: high. Subagent decision: required. One high-effort worker owns pure helper tests and then the disjoint browser regression file; one high-effort read-only interface reviewer examines integration risks. The coordinator owns both renderers, test registration, documentation, and serialized acceptance checks. Pre-existing dirty work is preserved.

The prior-build phone probe measured a 308 by 275 pixel SVG with a 1050 by 950 projected-unit viewBox. Default aspect-preserving rendering placed its physical upper-left X at 500881, whereas the rectangular hit-test formula used 500888. This seven-metre discrepancy is a synthetic display/interaction reproduction, not measured GNSS error. Raw baseline data and screenshot are under `/home/cyber/cplayout-map-fit-P2cdgN/`. Three earlier probe attempts omitted navigation from the sample dashboard to Map and timed out; they are setup failures, not application acceptance evidence.

Acceptance requires pure fitting tests, adapter tests, full `npm run validate`, current audit and whitespace checks, and exact-export Playwright checks on desktop, tablet, and phone. Check field containment, current imported geometry, repeat fit, Layout access, preserved save state/selection/drafts/undo, stale gesture release, and SVG coordinate alignment before/after resize. Record selected browser coverage separately from the complete inventory. Source and browser results do not establish native device behavior, RTK accuracy, or engineering suitability of a layout.

## Primary Sources

- [MapLibre Map API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#cameraforbounds): bounds-to-camera API. The installed `maplibre-gl/src/ui/camera.ts` additionally documents that calculated camera centers already account for fit padding; applying that padding again would offset the result.
- [MDN SVG preserveAspectRatio](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/preserveAspectRatio): aspect-preserving viewBox behavior. Matching the display viewport aspect avoids letterboxing without stretching projected geometry.
- [MDN Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events): primary pointers are per device type, and touch input can produce compatibility mouse events. Pointer-contact ownership therefore cannot be replaced by a shared primary-button flag.

Sources checked during the September 17, 2026 mapping continuation. Test outcomes must be read from the accompanying final evidence record, not inferred from this implementation description.

The initial 18-case browser attempt recorded 10 passes and eight failures. Three failures concerned capitalized SVG selection labels, two compared fractional requested mouse coordinates with integral delivered mouse coordinates, and three exposed insufficient phone map space for fitting with the current overlays. Fixtures were corrected without relaxing geometry tolerances. Review also identified an unsupported React Native Web pointer-capture prop, stale-contact rearming, and underestimated SVG pan-control width. These required implementation corrections before acceptance. The initial build/report remains retained; it is not a clean final-source run.

The corrected 27-case attempt recorded 14 passes and 13 failures. It retained the SVG transform discrepancy, advisory-reflow comparisons, phone fit-scale checks during that reflow, and touch-cleanup errors. The cleanup could mask an earlier assertion failure, so no intermediate touch acceptance is inferred. A subsequent source validator passed, but late SVG event-wiring changes required a fresh full validation. Keep `validate-before-svg-wiring.log` separate from the final frozen-source result.
