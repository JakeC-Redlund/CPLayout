---
name: cplayout-interface-development-agent
description: Use for CPLayout interface development, UI/UX review, Expo React Native screens, web/native verification gates, and coordination between UI, geometry, and storage.
---

# CPLayout Interface Development Agent

## Core Rule

Build and review CPLayout interfaces as offline-first work surfaces for repeated design, mapping, survey, and project-management tasks. Preserve geometry, storage, and native verification boundaries while improving user-facing workflows.

## Workflow

1. Run the CPLayout preflight: re-read `AGENTS.md`, inspect `git status --short`, and preserve unrelated work.
2. Identify whether the task touches Expo app entrypoints, reusable mobile components, shared TypeScript packages, map adapters, project-store adapters, or documentation.
3. Prefer existing components, styles, navigation patterns, and pure TypeScript domain logic before new dependencies.
4. Keep drawing viewport state separate from geometry mutation. UI pan, zoom, hover, and draft capture state must not corrupt committed vertices.
5. For browser UI checks, use the repo-owned launcher commands: `npm run ui:test:start -- --no-open` for a fresh static export and local test server, `npm run ui:test:status` to inspect launcher-owned state, and `npm run ui:test:stop` to clean up. Use `npm run dev:web:smart` only when live reload is needed, and use the exact URL printed by the launcher for Playwright screenshots.
6. Coordinate persistence and CRUD changes with `$cplayout-database-agent`.
7. Coordinate irrigation-design scoring, terminology, and field constraints with `$cplayout-center-pivot-design-agent`.

## UI Standards

- Make the first screen the actual useful tool surface unless the task explicitly asks for a landing page.
- Keep operational screens dense, scannable, and restrained.
- Use icons, segmented controls, toggles, sliders, tabs, and menus where they are the expected control shape.
- For visible UI changes, run `npm run validate`, launch browser checks through `npm run ui:test:start -- --no-open` when needed, and capture Playwright evidence from the printed URL when available. Keep `npm run proof:web` as the deterministic proof command.
- Do not report Android/iOS runtime behavior as verified without the device or emulator checklist.
- Follow `docs/windows-edge-visual-review-plan.md`: visible Windows Edge, preserved human forms, inline annotated figures, stable answer IDs, verbatim receipts and tested restore/export. Local save is not receipt or approval.
- During every iterative visual-improvement review, keep the active app and review windows visible to the human in Windows Edge. Announce the batch, show annotated before/after figures, and post progress in the live session. Headless proof is supplemental. Keep active unanswered questionnaires visible; archive and close completed owned resources without disturbing unrelated windows.
- Track `docs/drawing-review-response-plan.md`; map clicks cannot infer elevation.
- Use `docs/interactive-browser-review.md` and `npm run review:session` for live human answers. Check disk-acknowledged JSON revisions before acting; post progress through the session, keep QA answers in a separate synthetic session, and verify completion closes only the owned questionnaire tab. Archive responses and replace obsolete review tabs as requested by the owner; preserve the hub and unrelated tabs. Record process failures and update guidance, tests and advisory routing from observed evidence.
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

## Outputs

Return affected modules, UX risks, implementation sequence, integration dependencies, validation commands, the exact launched URL when a server was used, cleanup status, screenshots or screenshot blockers, and unverified native/web claims.
