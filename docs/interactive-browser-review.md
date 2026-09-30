# Interactive Browser Review

## Session Contract

The review hub and questionnaire run on a repo-owned loopback server. They do
not use an external service, account, API key, or application project storage.
The local server's private control capability only authorizes agent messages
and its own shutdown; it is not a cloud credential and is never served to pages.

- A packet has immutable question IDs, numbered figures, annotated PNGs,
  observations, lettered choices and free-text answers. New questions require a
  new packet, not repurposing an old ID.
- Each new session requires a reviewed build or capture fingerprint at `init`.
  `evidence-identity.json` binds that label to a SHA-256 question catalog hash
  and the copied figure hashes. Reads check those bytes again; a changed
  catalog or figure requires a new session. `start` requires the current
  reviewed fingerprint separately and rejects a mismatch. The fingerprint is
  a supplied identity label; matching it cannot independently prove that the
  build was reviewed.
- JSON revisions are authoritative. An answer is **received** only after the
  server acknowledges its disk write. Browser memory is not a receipt.
- Revisions preserve verbatim comments. Concurrent changes fail closed instead
  of silently replacing another tab's answers. A rescue download preserves
  unsent edits when the server is unavailable or a conflict needs resolution.
  This tab also keeps a session-storage recovery draft on each edit; reload
  offers an explicit restore or discard choice. A stale revision restores as
  blocked so its answers can be compared and exported without overwriting the
  server copy.
- Markdown receipts include inline figures, choices and literal comments.
  Keep downloaded Markdown with the session's `annotated` directory.
- `export DIR OUT` creates a standalone directory containing `answers.json`,
  `receipt.md`, figures and `manifest.json`. `verify-export OUT` checks the
  catalog, receipt consistency, artifact bytes and unexpected files with the
  server stopped. The manifest has no external signature, so this check does
  not authenticate who typed responses or rule out a fully rewritten export.
  Agent observations live in the question packet and
  panel decisions require their own record; neither is a human answer.
- Completion freezes the session's responses. It does not imply acceptance,
  complete answers, release readiness, or measured positioning accuracy.
- Agent updates appear in the browser while it remains open. The agent must
  read the latest received answers before choosing its next implementation
  packet and document which response IDs changed that work.

## Lifecycle

Use a new output directory for every packet. For the current drawing follow-up:

```sh
npm run review:session -- init reports/visual-layout-review/interactive-followup-session docs/evidence/drawing-review-20260927/interactive-followup.json reports/visual-layout-review/20260927-answers-recovery-01/visual-followup CAPTURE_OR_BUILD_FINGERPRINT
npm run review:session -- start reports/visual-layout-review/interactive-followup-session 0 CAPTURE_OR_BUILD_FINGERPRINT
npm run review:session -- status reports/visual-layout-review/interactive-followup-session
npm run review:session -- message reports/visual-layout-review/interactive-followup-session "Reviewing your latest answers; classification remains the next drawing task."
```

Open the exact printed URL in visible Windows Edge. The hub opens one owned
questionnaire tab on request. Submit completion only as a human action; QA uses
an entirely separate synthetic session. The questionnaire closes itself only
after completion is acknowledged. The hub observes whether its child actually
closed and remains available for progress and receipts. If Edge refuses closure,
the questionnaire explicitly offers manual closure; do not report cleanup as
verified. Never close personal tabs or unrelated windows. The owner's latest
instruction requires obsolete review forms to be archived and closed, then
replaced by the interactive session. Preserve recorded responses, export any
new unsent responses, verify exact owned titles and URLs, close those tabs only,
and record the before/after inventory. Do not leave obsolete forms accumulating.

Do not preserve an old map tab merely because it predates the questionnaire.
The owner explicitly requests closing unused CPLayout map tabs as well. Archive
relevant visible state, verify the exact owned title/URL, close unused tabs and
stop their now-unused owned servers. Keep only actively used review/test resources,
with a recorded reason and cleanup check. Unknown ownership still requires
investigation rather than a port-wide kill. Do not close unrelated personal tabs.

Browser-created tabs are normally script-closable; arbitrary existing tabs may
not be. This design follows the documented [Window.close behavior](https://developer.mozilla.org/en-US/docs/Web/API/Window/close),
verified as a source on 2026-09-27; each actual Edge run still needs closure proof.

After receipt review, stop only this session:

```sh
npm run review:session -- stop reports/visual-layout-review/interactive-followup-session
npm run review:session -- export reports/visual-layout-review/interactive-followup-session reports/visual-layout-review/interactive-followup-export
npm run review:session -- verify-export reports/visual-layout-review/interactive-followup-export
```

Use a fingerprint taken from the actual reviewed capture or build record;
`CAPTURE_OR_BUILD_FINGERPRINT` is a placeholder and must be replaced before
running `init`. The server never kills a port owner. Existing lock directories fail closed.
Following a crash, verify the recorded process, listener and session before
moving the stale lock into a recovery directory. Do not blindly delete locks.
Restart with `start` to recover previously acknowledged answers. The screenshot
snapshot hashes are checked on every start. Retain the session directory and
original evidence; stopping a session does not delete answers.
Each run writes a durable `review-resource-lease-*.json` at the session root.
`stop` reports `verified-stopped` only after process exit and listener release;
an unconfirmed result prints JSON and exits nonzero. For a crashed process,
`npm run review:session -- recover DIR DIR/review-resource-lease-ID.json`
checks the recorded process identity before attempting targeted cleanup.

## Agent Review Loop

The owner's 2026-09-27 instruction applies to each iterative visual-improvement
workflow: keep it visible to the human in Windows Edge while it is in use.
Announce each batch before foregrounding its owned window. Keep the current app
and annotated review figures available in visible browser windows, with progress
messages in the review session. Headless tests remain useful supplemental proof.
If the interactive Windows desktop is unavailable, record that concrete blocker;
do not describe a background or headless run as visible review. Active human
questionnaires remain open for answers; completed owned resources follow the
archive and cleanup lifecycle above.

Receipt inspection must map each choice back to that exact packet's label.
For example W03=c means "Drawing space needs more room", not generic approval.
A completed questionnaire may contain blank essays; do not invent explanations.
When a new user request changes scope mid-iteration, keep earlier requirements
in the response plan and replace the next packet's scope explicitly. Reused
screenshots must be labeled historical, not presented as fresh changed-UI proof.

1. Read `status`, distinguish pending answers from received answers, and retain
   the user's original response record. Never populate the live session for QA.
2. Post a concise progress update at meaningful checkpoints. Changes to agent
   messages must not change human answers.
3. Implement the bounded mapping change indicated by the response IDs.
4. Test the real workflow in visible Windows Edge. Capture original screenshots
   at workflow transitions; derive separate numbered annotations and examine
   both pixels and DOM measurements. OCR is supplementary, not text authority.
5. Prepare a fresh packet with inline annotated figures and scoped questions.
   Preserve the prior packet and answers; do not carry forward approval.
6. Verify receipt persistence, export, actual owned-tab cleanup and unaffected
   unrelated tabs using a separate synthetic session before human presentation.
7. Record process failures and their fixes in this document or its evidence
   record. Update the interface skill and generated advisory hook routing when
   a repeatable lesson changes practice; rerun skill/context-map checks. Hook
   routing is advice, not proof of a live browser or enforcement.

### Replacement Checks

- Before retiring a session, inspect its actual format. Older sessions can lack
  evidence identities or resource leases. Preserve and byte-compare a legacy
  archive without manufacturing a historical fingerprint. Do not call it a
  verified modern export. Keep runtime control capabilities out of that archive.
- Close a completed hub only after matching its live packet, completion time,
  revision and answers to the retained receipt. `reviewEdgeTabs.ps1` supports
  this via `-CompletedReceiptPath`, an exact title and an exact loopback URL.
  Archive the selected hub's controls first, then close and inventory again.
  Preserve unrelated tabs and any map tab still actively used for the review.
  Close unused CPLayout map tabs after preserving relevant state; their presence
  before the review is not a reason to retain them. Verify owned server cleanup
  separately.
- A launcher startup message is not readiness. Confirm HTTP from Windows before
  capture. A Metro source map can reflect current files while its cached bundle
  remains stale; assert the changed DOM layout/styles in the actual browser.
  Retain failed-run evidence and use a fresh verified session if needed.
- Do not run a static export while capturing its live app. The 2026-09-27
  iterative-layout follow-up reproduced `Not found` pages while Expo replaced
  `dist`, despite a healthy owned server. Preserve those failed captures, wait
  for the export to finish, verify the Windows-served index/bundle, then repeat
  the capture in a fresh owned window. A separate questionnaire serving copied
  figures may remain open throughout.
- Select a specific Playwright test file as well as a title filter. Title-only
  filtering still collects other files and can load unrelated platform-specific
  test dependencies from a shared Windows/WSL checkout.
- Annotate controls that are actually rendered at the captured workflow stage.
  Check visibility before asking for their bounds: a paused drawing correctly
  offers Resume without an active Pause control. A capture-helper timeout is
  separate from a failed application workflow. Preserve and repeat the capture
  after fixing its helper; do not alter passing application assertions to hide it.

## Validation And Limits

Run `npm run test:visual-review`, `npm run validate`, `npm run validate:skills`,
`git diff --check`, and `npm audit`. Browser proof must cover save acknowledgement,
reload, lost connection, conflicting edits, ongoing messages, narrow layout,
image rendering and completion cleanup. Unit tests alone do not prove these.

This tooling is an interactive local review bridge, not an autonomous background
agent. Browser messages are published when an active agent invokes the command.
It does not attach to authenticated browser profiles, read unrelated forms,
install an extension, or make field-accuracy claims.

Refreshing the hub loses its in-memory child-window handle. The questionnaire
still saves and closes itself after completion, but the refreshed hub cannot
attest that original tab's closure. Inspect owned tabs before opening another
questionnaire in that case; do not treat a missing handle as cleanup proof.

## Mapping Resume Point

The original Q01-Q10 record is in
`protected local review archive`. The current follow-up
V01-V04 checks only bottom toolbar placement, grouped capture actions, wrapping,
and status visibility. Post-drawing classification, default-on autosave and
durable paused drawings remain UI implementation work, not delivered features.

The [iterative layout implementation](iterative-layout-improvement.md) now wires
finish/classify, default-on autosave and durable toolbar pause/resume, with
project v2 / draft v3 metadata and old-reader refusal. Desktop/narrow browser
tests exercise classification, retained cancellation, save/reopen and failed
pause saves. These checks remain separate from human acceptance of the changed
drawing flow. Preserve the [drawing response plan](drawing-review-response-plan.md)
and its original answer requirements when preparing its next annotated packet.

## Verified Iteration: 2026-09-27

- Windows accessibility exposed the old form after selecting and waking its tab.
  All ten essay fields matched the recorded Q01-Q10 receipt; the nine selected
  choices matched, including Q10 rework. Live form snapshots were archived before
  all three obsolete review tabs were closed. The map tab was preserved.
- The replacement hub and questionnaire were opened in the same visible Edge
  window. Only the new V01-V04 packet is editable. Its answers remain pending
  until received; no synthetic QA input is used in the human session.
- Visible Edge 154.0.4258.37 proof at 1366 x 900 and 390 x 844 checked four
  annotated images, verbatim disk receipts, reload, offline retry, competing
  answers, rescue download, Markdown figures and completion cleanup. The
  questionnaire closed; the hub and unrelated test tab remained open. Screenshots
  were inspected alongside DOM assertions. The synthetic QA browser was closed.
- First browser run found that the before-unload guard also blocked acknowledged
  completion. The fix clears completion-in-progress before closing, with a
  regression test. Failed-run evidence is retained, not relabeled as a pass.
- Independent review found uncertain directory-sync acknowledgements, an HTTP
  payload limit smaller than valid essays, and premature stop reporting. The
  server now requires resynchronization before exposing uncertain commits,
  aligns the payload limit, and verifies its lock was removed before the CLI
  reports stopped. Regression tests exercise these failure cases.

Local evidence: `reports/visual-layout-review/interactive-edge-proof-02/`;
live session: `reports/visual-layout-review/interactive-followup-session/`;
legacy answer archives: `reports/visual-layout-review/20260927-answers-recovery-01/`.
The live session is intentionally retained for human input. The browser proof
does not establish full mapping acceptance, native behavior or RTK accuracy.

Human completion subsequently arrived at revision 25, 2026-09-27T16:57:22.202Z.
All four V01-V04 answers were read and retained verbatim in
`protected local review archive`. A direct
Windows tab inventory confirmed the questionnaire was closed, with only the
review hub and original map tab remaining. The session is now a read-only
receipt, not a pending form. The next changed-map packet must replace it with
a new editable session and carry forward the recorded requirements.
