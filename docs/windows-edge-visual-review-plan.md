# Windows Edge Visual Review

User requirement added 2026-09-27. Status: first desktop draft-tool packet captured
in visible Windows Edge; human responses received, rework requested. See
[the response receipt and implementation sequence](drawing-review-response-plan.md).
Historical capture observations below retain their original scope. This supplements automated browser testing; it does not replace
source, native/device, storage, or physical GNSS qualification.

Latest instruction: use [interactive browser review](interactive-browser-review.md)
for replacement questionnaires, disk-acknowledged answers and ongoing updates.
Archive live responses, close obsolete owned review tabs, and replace them with
the interactive hub/session. The retention statements below describe earlier
captures, not permission to accumulate obsolete forms. Preserve unrelated tabs.

## Verified Host And Scope

Read-only host inspection found Windows 11 Pro build 26200 and installed Edge
154.0.4258.37. Recheck these at capture time. The existing launcher records on
19006/19014 were unhealthy at preflight. A fresh export subsequently started at
19006 and supplied the live packet below. No human responses are claimed.

## First Live Packet: 2026-09-27

Update: answers and the partial visual follow-up are now recorded in
[Drawing Review: Responses And Rework](drawing-review-response-plan.md).
The historical packet below remains immutable; Q10 requests rework.

Local packet: `reports/visual-layout-review/20260927-drawing-edge-01/capture-emQ55h/`.
`questionnaire.md` embeds eight annotated full screenshots and eight detail
images, with numeric questions, alphabetic choices and free-text response fields.
`questionnaire.html` presents the same figures/questions as a locally answerable
review, with Markdown answer export. Its form/export test used a separate browser
profile; test answers were cleared and do not represent human responses.

Actual capture: headed Edge 154.0.4258.37, Windows 11 Pro build 26200, maximized
2552 x 1421 CSS viewport, DPR 1 and visual viewport scale 1. Eight checkpoints
cover the SVG incomplete-design toolbar, Polygon/Line/Point purpose menus,
three-vertex boundary capture, remove-last, Keep and Save. Data is synthetic,
`LOCAL:METERS` is unqualified/non-georeferenced, and no receiver was simulated.
The 328-file runtime-source snapshot remained unchanged. The local/exported
bundle and Edge response matched SHA-256
`07f44daa68cd6b9a3d6842f6d6133b66d3daf66b157d5c349ed7b45e35c3ec24`.

Original PNGs, DOM bounds, timestamps, hashes, Tesseract 5.3.4 positional OCR,
OpenCV 4.13.0 pixel metrics and annotation/crop sidecars are retained locally.
Originals are unchanged; annotations are separate browser-rendered display
layers. Initial markup with obstructive leaders is preserved separately and
superseded by the inspected corrected markup. Sixteen embedded images load in
the Edge questionnaire; 36 radio choices and ten essay fields render without
horizontal overflow at the checked 1366 x 900 review viewport.

The user-facing questionnaire was opened in the dedicated Edge profile. Windows
reported its window visible, not minimized, and in the foreground, with both the
questionnaire and live app present. That window and the healthy repo-owned
`http://127.0.0.1:19006` preview are intentionally retained for the requested
human review. Automated capture/render contexts were closed. Do not close the
review window or user responses during unrelated continuation work.

A read-only window-state recheck at 2026-09-27T15:26:48Z confirmed the dedicated
questionnaire window still visible and not minimized on the interactive Windows
desktop. No navigation, form inspection or activation was performed; this does
not establish human answers or acceptance. The launcher reported 19006 healthy.

This is not full UI acceptance. Human answers have since been received in chat;
Q10 requests rework. Responsive drawing workflows,
MapLibre, Layout/RTK gates and native/field behavior remain pending. No JS page
exception was observed, but repeated resource-load errors occurred under blocked
external traffic; their individual causes remain unclassified, not a clean
console pass. OCR misread some icon-adjacent words; DOM/originals govern wording.
Visible highlighting does not establish accessibility selected-state semantics.
The 28-pixel map reflow after Keep does not establish stored geometry drift or
preservation. Save status was observed; reopen persistence was not tested here.

Current audit reports zero vulnerabilities. Export and scoped screenshot/form
checks passed; `git diff --check` passed. No product TypeScript/UI code changed
in this packet, so the full `npm run validate` and `npm run proof:web` inventories
were not rerun. Preserve earlier aggregate evidence within its original scope.

Use the user's Windows PC with **headed Microsoft Edge** for live browser
workflow review. The Edge window must be visible on the user's interactive
Windows desktop, not hidden, minimized, or launched in a background-only session.
Bring the owned CPLayout window forward at the start of each announced review
batch without closing or controlling personal browser windows. Record window
visibility and leave the active questionnaire open for human review. On acknowledged
human completion, verify owned-questionnaire closure and retain the review hub.
Linux Chromium, headless screenshots and emulated Android/iOS
may supplement regression checks but cannot satisfy this gate. Match the served
export to the reviewed source snapshot; dirty work requires file hashes as well
as HEAD. Keep canonical geometry projected/local XY and use synthetic projects.

## Execution Order

1. Read AGENTS.md and the agent-tree protocol; preserve dirty work. Select one
   bounded workflow and a small packet of 4-8 figures. Record source snapshot,
   purpose, expected outcomes, input method, and exact task ownership.
2. Run `npm run ui:test:status`, then
   `npm run ui:test:start -- --no-open` for a fresh export. Record the exact URL
   printed by the launcher and verify Windows Edge reaches those same bytes.
   Do not substitute a stale export or kill unrelated listeners.
3. Open a dedicated CPLayout Edge profile/window. Preserve personal Edge windows,
   tabs, cookies and credentials. For automation, verify a loopback-only DevTools
   endpoint and record actual Edge process/version/profile ownership. If WSL
   cannot safely reach Windows loopback, use Windows-local tooling; do not expose
   debugging on the LAN or silently replace Edge with Linux Chromium.
4. Record screen size, Windows scaling, CSS viewport, DPR, browser zoom, renderer,
   input method, project fixture/CRS and connected/offline state. Capture at the
   actual desktop size first, then narrow tablet/phone and short-landscape
   browser viewports. Those are responsive web checks, not physical-device proof.
5. Capture at workflow transitions: before action, opened tool/menu, partially
   drawn geometry, validation/rejection, committed result and save/reopen.
   For asynchronous behavior, capture pending and settled states. Use observable
   completion conditions and timestamps, not arbitrary timer screenshots alone.
6. Preserve original PNGs and hashes. Inspect each original with computer vision;
   pair observations with DOM roles, labels, bounds, focus and app state. Run
   local OCR with recorded tool/version and compare text to DOM. OCR uncertainty
   is not missing-text proof. If OCR/CV tooling is unavailable, record the gap
   and keep this review incomplete; never fabricate measurements or results.
7. Produce a separate annotated review figure for every captured checkpoint:
   numbered callouts, thin outlines/arrows and an external legend. Preserve the
   original pixels and dimensions; keep annotation coordinates/text in a sidecar
   or a display overlay. Do not cover the control being evaluated or synthesize
   replacement UI. Originals remain authoritative, annotated figures advisory.
8. Create an editable Markdown questionnaire from
   [the template](templates/visual-review-questionnaire.md), with actual Fig.
   numbers, **annotated screenshots embedded inline**, original-image links and
   workflow-specific questions. A links-only questionnaire is not acceptable.
   Place the relevant figure beside its observations and before its questions.
   Every agent observation must have a visible numbered callout, an exact target
   region, and a matching written explanation: what was observed, why it matters,
   the corroborating evidence or uncertainty, and the question it informs.
   Keep callout text legible at normal viewing size; use a separately labeled
   detail crop alongside the full screenshot when necessary, recording crop
   coordinates without substituting the crop for the full workflow context.
   Render-check the Markdown on this Windows PC: every inline image must resolve,
   labels must be readable, and arrows/outlines must identify the stated element.
   Do not present placeholders, unexplained boxes, or missing screenshots as a
   completed questionnaire. Use numeric questions and alphabetic choices plus
   free-text answers. Present the packet
   and the live Edge URL to the user. Do not prefill answers or infer approval.
9. Record responses verbatim, then separately record the decision, rationale,
   affected paths, regression tests and unresolved disagreements. Implement
   scoped improvements, recapture the same checkpoints and request a repeat
   review of changed figures. Preserve earlier figures/answers; never overwrite
   a failed or rejected iteration. Silence leaves `human-review-pending`.
   Use stable Q01-Q10 identifiers, not Markdown auto-numbering, for answer records.
   An essay is answered even without a selected choice. Keep the immutable
   question catalog, source packet, receipt time, choice and verbatim comment.
   On reload, count restored answers and show review disposition independently.
   Local browser storage is not a repository receipt. Download/export actions
   must retain figures (portable embedded assets or an explicit complete packet)
   and be tested semantically, not only for matching substrings. Never clear or
   overwrite a human profile during QA; use a separate visible Edge profile.
10. Run the applicable validation gates and inventory owned sessions. During an
    arranged live user review, record intentional retention of the Edge window
    and launcher URL; after that review, close only owned resources and use
    `npm run ui:test:stop`. Never close the user's personal browser sessions.

## Initial Workflow Packets

| Packet | Checkpoints and questions |
| --- | --- |
| A: On-map tools | Design initial state; Point/Line/Polygon labeled icons; open submenus; active tool; collapse/Escape; no map, attribution, zoom or status occlusion. Ask about icon size, meaning, reach and map space. |
| B: Geometry capture | Polygon field/keep-out/measurement; Line path/measurement; Point purpose; incomplete draft; remove last vertex; finish/cancel; rejected topology; commit and save/reopen. Ask whether draft, committed and saved states are distinct. |
| C: Edit and camera | Select vertex; move/insert/delete; rejection; undo/redo; pan/zoom/fit; responsive resize. Verify camera changes never alter stored XY. Ask about selected-state clarity and correction effort. |
| D: Design to Layout | Same map/tool appearance across modes; retained target revision; unavailable precision action; receiver setup; stale/lost lock. Ask whether disabled reasons and next steps are clear. Never enable hardware-qualified capture using a browser mock. |
| E: Help and recovery | Relevant help entry; missing CRS/input; unavailable imagery; interrupted save/reopen; retry/cancel. Ask whether wording describes the actual state and supports recovery without losing work. |

Run A then B first; C-E follow their implementation dependencies. Test SVG and
browser MapLibre separately. Show any deliberately simulated receiver state as
simulation in the packet. A fixed receiver label, browser fixture or screenshot
cannot establish real lock, elevation accuracy or the <0.10 m maximum 3D target.

## Packet Contract

Use ignored `reports/visual-layout-review/<date>-<workflow>-<iteration>/` for
`original/`, `annotated/`, `annotations.json`, `manifest.json`, `observations.md`
and `questionnaire.md`. Keep any private projects/images out of Git. Promote
only reviewed synthetic/redacted evidence and minimal hashes deliberately.

The manifest records source/export/served hashes, timestamps, actual host/browser
identity, URL, viewport/scaling, renderer/input/network state, action sequence,
each figure's source/annotated hashes, OCR/CV tool versions or blockers, DOM
checks, console errors, findings, human response status and cleanup ownership.
Per figure: observation -> corroborating DOM/state evidence -> inference ->
question -> response -> decision -> retest. Distinguish `not-run`, `observed`,
`failed`, `human-review-pending` and `accepted-for-this-workflow`.

## Ownership And Validation

The coordinator owns integration, Edge/server lifecycle and all writes. When
independent review is useful and agents are available, assign a high-effort
interface reviewer the selected figure/DOM packet and a medium-effort visual
reviewer OCR/CV discrepancies; both read-only, no browser control or overlapping
writes. They return Fig./callout IDs, direct observations, severity, uncertainty
and questions while the coordinator prepares the next checkpoint. Do not claim
multi-agent consensus without actual independent reviews.

For implementation: `npm run validate`, targeted workflow regressions,
`npm run proof:web` (explicit `CPLAYOUT_WEB_PROOF_PORT` when non-default),
`npm audit`, `git diff --check`; `npm run validate:skills` for skill/governance
changes. Then this Windows Edge screenshot/OCR/CV and human-review gate.
Documentation-only planning needs link/whitespace and consistency checks, not
an invented UI pass. Missing human input can leave visual acceptance pending
while independent backend work proceeds; it cannot be counted as approval.

No new package is required by the plan. Inspect existing Playwright, PNG metrics
and OCR/CV helpers before adding tooling. Any installation must meet the existing
no-cost/offline-first, licensing and compatibility review requirements.

## Primary Sources

Checked 2026-09-27: [Microsoft Edge DevTools Protocol](https://learn.microsoft.com/en-us/microsoft-edge/devtools/protocol/)
documents instrumenting Edge and using a distinct profile. [Playwright browsers](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge)
documents branded Edge support. These establish tooling options, not that a live
Edge session, screenshot, OCR run or human review has occurred.
