# Standard Drawing Tools

Reviewed 2026-09-25. Initial scope: Design-mode pointer drawing on browser MapLibre and the shared SVG fallback. Canonical coordinates remain projected/local XY. The initial drawing pass made no package, document-schema, storage-format, paid-service or receiver changes; the follow-up below adds shared overlay menus and Layout receiver authorization.

## Workflow

- **Polygon > Draw polygon** starts capture. Purposes include Field Boundary, Keep-Out / No-Spray, Building, Planning Boundary, Machine Zone and Corner-Arm Footprint. Three distinct non-collinear vertices are required. Finish, returning to the first vertex within the configured snap tolerance, or browser double-click completes capture and opens purpose selection.
- **Line > Draw line** starts capture. Two or more vertices form a path; purposes include Measurement Line, pipeline, access lane, road, fence, ditch, canal and linear-move path.
- **Point > Draw point** captures one map location, then opens choices such as Well, Pump, Power Pole, Tree or Evidence Mark. It does not create a qualified GNSS observation.
- **Remove last vertex** corrects unfinished geometry independently of project Undo. Reselecting the same active geometry tool preserves unfinished vertices. Clear discards that capture; Cancel Draft discards the purpose-stage capture. Changing geometry tools starts a different capture.
- Purpose selection validates and commits project geometry. Save Local remains the persistence operation. A rejected purpose retains its error and pending geometry for retry/cancel.
- Coverage remains a secondary circle tool. Pivot GPS Entry remains reachable under Machine.

Polygon previews close and receive a light fill after the third vertex; line previews remain open. Browser and SVG previews show individual draft vertices without changing stored geometry.

## Measurements And Safety

Line length, polygon area and closed perimeter use project-plane geometry and current display units. Area is shown in square metres or acres. Previews do not modify project data: use Polygon to measure and Clear/Cancel when no saved feature is needed. The initial pass did not add a persisted measurement-area feature kind; the draft-workspace continuation below adds one.

Unknown, geographic, Web Mercator and undeclared local CRSs cannot display qualified metric measurements. These are planar XY values, not terrain/slope/3D distances, ground-scale corrected surveys or an accuracy guarantee. No elevation is invented.

Generic polygon finish validates topology before purpose handoff. Invalid geometry stays editable. Map-feature add/update/upsert also validates polygon rings through the reducer, closing a prior gap where planning polygons accepted shapes rejected by field boundaries. Translation-relative area validation avoids cancellation from large absolute coordinate products. Legacy document schemas remain unchanged.

Layout remains read-only for pointer edits. Pan must not switch Layout into Design. Native MapLibre gesture parity and Android/iOS runtime behavior remain separate proof gates.

## Research And Decisions

Primary sources checked 2026-09-25:

- [QField digitizing](https://docs.qfield.org/how-to/data-collection/digitize/) documents Point/Line/Polygon collection, removing the last vertex, explicit completion/cancellation, and attributes after capture. Adopt these interaction patterns using CPLayout's controller; no QField dependency.
- [QField measuring](https://docs.qfield.org/how-to/qfield-interface/measuring-tool/) distinguishes line measurements from closed-polygon area/perimeter. Adopt immediate feedback with CPLayout's CRS boundary; do not infer elevation or terrain measurements.
- [Emlid polygons](https://docs.emlid.com/emlid-flow/survey-with-ef/lines/polygons/) provides survey-oriented polygon workflow comparison. No Emlid subscription, cloud integration, package or accuracy claim is adopted.

Local review found indirect one-choice geometry sheets, Polygon labeled Area, no draft-vertex undo, SVG-only unqualified length feedback, absent area/perimeter feedback, and inconsistent generic polygon closing/validation. The changes consolidate those behaviors in existing pure controller/helpers.

## Implementation And Verification

Complexity: high; selected reasoning: high. Subagent decision: required; one high-effort read-only QA reviewer inspected controller, purpose lifecycle and topology. The coordinator is the sole writer. Existing dirty work is preserved.

Affected modules: DrawingToolPalette, App, mapTools, mapInteractionController, browser/SVG surfaces, core manual-design/reducer topology validation, and focused source/browser tests. The adjacent unfinished Fit/compact-legend packet is retained and tested separately.

Gates: `npm run validate`, `npm audit`, `git diff --check`, fresh Expo web export, and Playwright drawing/fit tests against the repo-launcher URL. Browser tests cover three geometry tools, pending cancel, draft undo, measurements, purpose persistence and unchanged survey observations. Results are recorded after terminal completion, not inferred from an in-progress run.

Final runtime-source checkpoint: full `npm run validate` passed; fresh Expo export passed; all 27 selected browser cases passed (nine each on desktop, tablet and phone, without retries or skips); `npm audit` reported zero vulnerabilities. The served bundle matched the exported bundle byte-for-byte, and all 313 frozen source paths remained unchanged through these checks. This is selected workflow acceptance, not the entire browser suite or native/field qualification. See [drawing evidence](evidence/drawing-tools-20260925/README.md).

Remaining work at that checkpoint: restoring purpose-stage rejected geometry into the vertex editor; persisted measurement-area semantics; holes/multipart and freehand geometry; shared topology API consolidation; dense SVG map-label decluttering; native device proof. Subsequent implementation and acceptance are recorded separately below. Receiver/relay behavior and the less-than-10-cm maximum 3D field target remain unverified by drawing software tests.

## Incomplete Design Drawing

The [App draft workspace](draft-catalog-implementation.md#app-draft-workspace-2026-09-26) replaces invented blank geometry with actual empty designs. Its offline SVG surface renders supplied geometry only. Polygon, Line and Point overlay menus offer explicit purposes; incomplete one/two-point boundaries can be retained and saved. Pending inputs and unfinished captures cannot be mistaken for saved geometry. CRS selection is explicit and existing XY cannot be relabeled. This initial draft renderer does not claim native gesture proof or parity with the complete-project editors.

Measurement Area now persists as `measurement_area`, not `planning_boundary`, so measurement geometry is not treated as an irrigation planning constraint. It is available through the shared polygon purpose list as well as the draft map. The draft Point mark is explicitly labeled End gun mark, matching its stored kind; no generic survey qualification is implied. Native devices, electrical interfaces and measured 3D accuracy remain separate gates. Validation for this continuation is recorded in the linked App draft record.

The [draft workspace acceptance](evidence/draft-workspace-20260926/README.md) adds 170 passing selected browser cases and four explicit compact skips for desktop-only races. Drawing screenshots and bounds checks cover desktop/tablet/phone, including camera tooltips placed beside controls and CRS status clear of them. Empty/incomplete saves, undo, polygon/line/point persistence and camera-only navigation are included; feature-vertex editing parity, dense-label refinement and short-landscape draft layout remain follow-up work.

Subsequent work on label decluttering is tracked separately in [SVG map readability](svg-map-labels.md); the drawing acceptance record above retains its original tested build and limitations.

Browser review also exercised the adjacent Fit packet. Small-height fits now use adaptive margins; short landscape inspection moves legend/source details into the legend dialog. SVG web camera sizing follows the rendered SVG rectangle through ResizeObserver, avoiding fractional-CSS-pixel mismatches after rotation. Native sizing retains the existing layout-event path.

## Map Overlay And Layout Lock Follow-up

User-directed follow-up, 2026-09-25: shared labeled icon buttons now overlay the project map on desktop, tablet and phone in both Design and Layout. Each button expands contextual actions; Escape, the close button, or the same trigger closes options. Narrow toolbars and option rows scroll horizontally. Geometry launchers no longer duplicate the sidebar. Machine, Layers and Calculate remain available in the workflow sidebar.

Polygon offers generic purpose-based drawing plus direct Field boundary and Keep-out area actions. Point, Line and Polygon offer RTK capture navigation to receiver controls. Opening receiver setup is not a geometry mutation and remains available without a lock. Pointer edits are Design-only even with a fixed receiver: a pointer location has no receiver provenance.

Layout receiver capture forces RTK fixed regardless of a weaker configurable Design fix threshold. All existing age, accuracy, reference declaration, CRS and coherent observation checks still apply. Buffered boundary, obstacle and line/polygon commits additionally require a current accepted receiver gate and fixed, non-replay v2 evidence at every vertex. Action handlers recheck the live session and monotonic observation age. Loss of lock disables commits without deleting the unfinished capture. Design retains its evidence-preserving offline draft-commit behavior. Fixed lock and receiver-reported uncertainty do not prove the maximum 0.10 m 3D field target.

Pan does not change the selected receiver sidebar or disconnect its session. Leaving or collapsing receiver controls still uses the existing unmount-and-close lifecycle; background receiver ownership is not introduced. SVG draft controls track the measured overlay height instead of a fixed bottom offset.

Read-only QA found no confirmed authorization bypass. Its requested regression coverage was added for capture-time evidence disagreeing with a fixed confidence label, Design-to-Layout policy changes, and commits invoked in the same browser task as a clock advance before the UI can disable the button. The latter covers boundary, obstacle, line and polygon drafts and asserts retained draft counts and unchanged saved state.

Research checked against [QField digitizing](https://docs.qfield.org/how-to/data-collection/digitize/) and [QField GNSS accuracy requirements](https://docs.qfield.org/how-to/navigation-and-positioning/gnss/): separate geometry capture from attribute assignment, retain per-vertex evidence, and block GNSS digitizing when its quality requirement fails. CPLayout's mandatory Layout fixed gate is the user's requirement, not a claim about QField defaults. No new package, schema or transport adapter is introduced.

Complexity/reasoning: xhigh for cross-renderer UI and positioning authorization. Subagent decision: required for a bounded high-effort, read-only RTK authorization review; the coordinator owns all edits and browser checks. Gates: full `npm run validate`, `npm audit`, `git diff --check`, Expo export, selected Playwright drawing/menu/receiver regressions and screenshot inspection at the repo-owned preview URL. Native device behavior and physical receiver accuracy remain unverified.

Follow-up acceptance: full source validation and skills validation passed; audit reports zero vulnerabilities. The browser packet passed 42 selected regressions, followed by 9 final-build checks after retaining the receiver sidebar during Pan. See [overlay and RTK gate evidence](evidence/map-overlay-20260925/README.md) for exact build hashes, commands, screenshots, earlier corrected failures and qualification limits.
