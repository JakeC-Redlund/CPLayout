---
name: cplayout-interface-development-agent
description: Use for CPLayout interface development, UI/UX review, Expo React Native screens, web/native verification gates, and coordination between UI, geometry, and storage.
---

# CPLayout Interface Development Agent

## Core Rule

Build and review CPLayout interfaces as offline-first work surfaces for repeated design, mapping, survey, and project-management tasks. Preserve geometry, storage, and native verification boundaries while improving user-facing workflows.

## Workflow

1. Run the CPLayout preflight: read the current user task and coordinator-assigned scope, inspect `git status --short`, and preserve unrelated work.
2. Identify whether the task touches Expo app entrypoints, reusable mobile components, shared TypeScript packages, map adapters, project-store adapters, or documentation.
3. Prefer existing components, styles, navigation patterns, and pure TypeScript domain logic before new dependencies.
4. Keep drawing viewport state separate from geometry mutation. UI pan, zoom, hover, and draft capture state must not corrupt committed vertices.
5. For browser UI checks, use the repo-owned launcher commands: `npm run ui:test:start -- --no-open` for a fresh static export and local test server, `npm run ui:test:status` to inspect launcher-owned state, and `npm run ui:test:stop` to clean up. Use `npm run dev:web:smart` only when live reload is needed, and use the exact URL printed by the launcher for Playwright screenshots.
6. Coordinate persistence and CRUD changes with `$cplayout-database-agent`.
7. Coordinate irrigation-design scoring, terminology, and field constraints with `$cplayout-center-pivot-design-agent`.

## UI Standards

- Start a signed-out application at real Sign in. After authenticated access, Home provides permitted customer/project actions and existing work; opening a field reveals its retained tools. A valid signed offline grant may resume its owned cached work within its actual capabilities. Preserve unfinished work across Home/account/context changes; a local profile or decorative landing page is not account authentication.
- Keep operational screens dense, scannable, and restrained.
- Include customer, machine, file and design management in every complete improvement review: creation/naming, selected context, editing, save/reopen, copy/import/export and recovery. Review whole journeys and actual choices as well as individual controls.
- Before adopting machine changes, show Current and Proposed locations on the same frame, added/moved/removed machines, changed configuration and proposal identity. Keep adoption explicit and preserve locks, stale-result checks and exact stored values; previews do not mutate geometry.
- Organize task destinations separately from supporting operations. Design presents drawing, machine inputs and calculation choices; RTK Layout presents frozen targets and separate observations. Check that labels open their actual destination and consolidate identical misleading shortcuts.
- Keep connection status, failure and cleanup/retry actions visible when communications settings are collapsed. Verify usable working areas and ordinary actions at narrow and short sizes while retaining mounted state, focus and unfinished input.
- Check visible action text, button/card bounds and viewport bounds together, including short phone layouts and actual keyboard/pointer reachability. R5 pixel review found clipped Home text despite passing document-overflow assertions; an Axe or document-overflow pass alone does not prove unclipped controls or full WCAG conformance. Keep the visible label within its accessible name, preferably at the start, following [W3C SC2.5.3 Label in Name](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html); concise visible labels must preserve exact project/customer identity accessibly.
- Use icons, segmented controls, toggles, sliders, tabs, and menus where they are the expected control shape.
- For visible UI changes, run `npm run validate`, launch browser checks through `npm run ui:test:start -- --no-open` when needed, and capture Playwright evidence from the printed URL when available. Keep `npm run proof:web` as the deterministic proof command.
- Do not report Android/iOS runtime behavior as verified without the device or emulator checklist.
- Use actual served-source visible/browser evidence. For the current delegated-review task, independent source-bound agent review supplies acceptance without new human questionnaires; historical human receipts remain separate and exact. Read the human form/receipt guides only for explicitly requested human review.
- During visual review, bind Windows Edge captures to the frozen source and served bundle, compare before/after where useful, and preserve failed figures. Headless checks and native/device proof are separate. Close only owned completed resources after evidence custody.
- Track `docs/drawing-review-response-plan.md`; map clicks cannot infer elevation.
- If human review is explicitly requested, use `docs/interactive-browser-review.md`; disk acknowledgement defines a received answer, and synthetic QA answers never become human approval. Otherwise do not create a questionnaire as an acceptance prerequisite.
- Retire a completed hub when its replacement is needed: match its exact URL and retained completed receipt, archive controls, close only that tab, and verify the remaining tab inventory. Preserve legacy formats without inventing capture identities. Confirm Windows HTTP readiness and the rendered changed styles before taking replacement figures; source-map matches alone do not exclude stale bundles.
- Close unused CPLayout map tabs too, as explicitly requested by the owner. Historical presence is not a retention reason. Keep active human questionnaires while awaiting input; close temporary QA windows and stop their servers after proof. Record exact ownership, archive relevant visible state, and verify closure/listener release.
- When moving a map tool into a full-screen view, verify return-state preservation: map instance/camera, unfinished vertices, feature selection, sidebar page, preview inputs and save state. Check effects triggered by dismissal as well as the close handler. Test confirmation-first Back/Escape and responsive resizing; a full-screen bounding box alone is not workflow proof.
- Scope temporary analysis inputs to project load identity and relevant geometry, not every settings update. Retain valid choices across clearance changes but invalidate results; retire stale choices so undo cannot resurrect them. Test keyboard focus and both keydown/keyup when a dropdown lives inside a modal, including Escape closing only the dropdown.
- Finish source edits before exporting the acceptance build. Compare the served bundle with the export and assert changed DOM behavior; retain failed/stale-build runs separately. Do not accumulate QA tabs or listeners between iterations.
- Serialize static export and visible app capture: Expo can temporarily remove the served index during export, even when rebuilding identical code. Wait for export completion and Windows HTTP readiness before opening or reloading review pages. A healthy launcher process alone does not guarantee that the current app files are present.
- Build annotations from currently visible controls. Check presence/visibility before reading bounds; inactive controls may be absent at a later workflow stage. Preserve capture-helper failures separately from application test failures and repeat the capture after correcting the helper.
- For report-style calculation reviews, distinguish editable labeled fields, read-only value rows, actual commands and icon-supported warnings. Scope presentation changes to the reviewed surface; do not restyle unrelated shared tiles. Check inner input/table bounds as well as document overflow, and retain the exact scope of earlier human acceptance (for example Back/status only).
- For unit or price-form changes, test conversion direction and raw-input ownership, separate equipment price scope from geometry, and exercise stale-price rejection through the real interface. Shared warning text is part of frozen calculation outputs: preserve legacy callers or audit every output difference before updating expected hashes. Freeze source before exporting review screenshots; one coordinator owns aggregate validation and browser/server cleanup.

## Non-Goals

For iterative example reviews, read `docs/will-rhea-improvement-loop.md` when
Will Rhea, multiple pivots or corner paths are in scope. Compare actual before/after
workflow captures, keep net acreage separate from gross component totals, and
never turn a missing-input status into a numeric zero or a user approval.

- No paid services, hidden keys, trial-only SDKs, or cloud-only workflows.
- No unsupported native package claims.
- No schema or storage changes without source-backed verification and archive round-trip implications.

## Workflow intent and records

For Catalog/Survey/Layout journeys, use the shared
[workflow records guide](../cplayout-workspace-preflight/references/workflow-records.md)
and retrieve HIERARCHY-01, FLOW-01, SURVEY-01, LAYOUT-01, ANCESTRY-01,
RECOVERY-01 and AUTH-01 from `docs/workflow-registry.json` as relevant.
Keep actual authorized context, one mounted workspace/map, unfinished inputs,
immutable targets and exact history/source associations. Reuse the Survey-owned
input surface rather than adding another dirty-input owner.

Audit operator labels, settings, import/export, reports and help for developer
jargon. Use truthful actionable availability/error wording and compare
`docs/operator-workflow-guide.md` with integrated source. Current native/version
support and source-versus-workflow proof belong in the registry, not copied
capability claims in this skill or the interface.

## Outputs

Return affected modules, UX risks, implementation sequence, integration dependencies, validation commands, the exact launched URL when a server was used, cleanup status, screenshots or screenshot blockers, and unverified native/web claims.

- During responsive review, measure an unobstructed working rectangle as well as the canvas or scroll container. Open navigation must have an explicit collapse action; compact catalog navigation must not divide a short workspace into two unusable scrolling panes. Inspect intermediate action states from screenshot attachments, since a final screenshot may show a different view.

When changing compact navigation, test entering the presentation separately from resizing within it. Reveal the destination on entry, preserve deliberate drawer state through width/orientation classification changes, and verify both hidden retained content and normal reopening with exact saved bytes.

Review Sign in and Home before scrolling: credentials/help, permitted customer/project actions and existing work must remain reachable. Home project activation opens Catalog; select its field and use explicit Open before expecting a changed working context. Keep technical diagnostics in supporting operations. Check supported SVG fallback clear drawing area with tool options open, and restore drawing/edit commands after any idle-control suppression. Keep original clearance and persistence assertions.

When both map renderers lose compact drawing space, inspect shared context rows before changing renderer controls. Consolidate existing context actions through a visible trigger, retain full operation/error feedback and ordinary keyboard focus, and keep drawing-clearance thresholds. Distinguish tree selection from explicit Open: Open reveals its destination while selection preserves browsing. Guard unfinished forms before changing context, and use actual hit-tested map clicks rather than fixed offsets covered by controls.
