# Complete desktop workflow implementation

Started 2026-09-28 in isolated branch `codex/complete-workflow-20260928`, based on
`a70a6ebd81bcef1c11ca2fef6cdc57442f143689`. The preserved candidate10 source is now integrated into the canonical publication candidate; acceptance remains in progress.
The canonical checkout's publication checkpoint and browser correction are preserved.
The correction was copied into this worktree before adapting its UI selectors.

Complexity and selected coordinator reasoning: **xhigh** (cross-module storage,
transport, and desktop workflow). Subagent decision: **required**. Exclusive owners:
core/storage/hook contracts; receiver/runtime/companion; interface components;
Layout components; browser tests; coordinator App/navigation/launcher/integration.
Independent source review is read-only. Aggregate validation and exports are serialized.

The later owner delegation in [the human-workflow contract](human-workflow-improvement-2026-09-29.md)
supersedes this record's earlier human-questionnaire gate. No further questionnaire
is required for this pass; two complete unchanged-candidate specialist reviews and
all current software/preservation gates remain required. Automated decisions do
not constitute a new human usability approval.

## Intended behavior

Customer → Project → Field → Design guides initial creation. The first field is
named explicitly, recent work and direct import are available, and the workspace
remains open while independent editors are displayed. Drawing classification uses
one purpose selector. Calculation remains a preview. Complete-design creation
atomically saves the current applied draft and creates a distinct complete sibling.

Layout sessions retain exact target bytes and hash, field association and separate
observations. An explicit workspace v3 upgrade retains the exact preceding workspace.
Copies start without observations. New operational fixed-GGA evidence is versioned
separately from existing v1/v2 evidence, and project/draft/field document versions
advance only when that evidence occurs. Unsupported native writes refuse before mutation.

One receiver owner spans navigation. Communications choices are USB/COM, paired
Bluetooth serial, TCP client and UDP receive. Network NMEA passes through the owned
loopback server; startup alone opens no receiver endpoint. Origin/session controls,
bounded ingress and conservative delivery age guard collection. Collection checks a
current connection, valid checksummed GPGGA/GNGGA quality 4, age ≤2 seconds and a
resolved field projection again when the command executes. The label is
“RTK Fixed — receiver reported”; missing supplementary accuracy evidence stays unknown.

## Sources checked 2026-09-28

- [Chrome Web Serial](https://developer.chrome.com/docs/capabilities/serial): system
  serial devices, including USB and Bluetooth serial; user-initiated port selection.
- [Chrome Direct Sockets](https://developer.chrome.com/docs/iwa/direct-sockets): raw
  TCP/UDP belongs to the isolated-web-app platform; the ordinary browser uses a local companion.
- [Trimble GGA](https://receiverhelp.trimble.com/oem-gnss/nmea0183-messages-gga.html):
  GGA quality 4 is the receiver's RTK fixed indicator, not independent field accuracy proof.
- [W3C forms](https://www.w3.org/WAI/tutorials/forms/): labels, logical grouping,
  validation and actionable feedback.
- [Node TCP](https://nodejs.org/api/net.html) and [Node UDP](https://nodejs.org/api/dgram.html):
  local companion transport APIs. No new service or paid dependency is introduced.

## Acceptance gates

Focused contract/rollback/transport/browser checks precede `npm run validate`,
`npm run validate:skills`, `npm run context-map:check`, `npm run test:visual-review`,
`npm audit`, and `git diff --check`. Freeze implementation and tests before final
`CPLAYOUT_WEB_PROOF_PORT=<available-port> npm run proof:web` and visible Windows Edge
desktop, narrow and short-height review. Two complete reviews without unresolved
blocking findings precede the consolidated human questionnaire. Disk-acknowledged
human answers remain distinct from software tests.

No acceptance is claimed by this planning/implementation record. Native activation,
physical receiver verification, independent field accuracy, machine control, VFlex
qualification and new irrigation solvers remain outside this pass. The owner explicitly
authorized canonical Git integration and main-only publication on 2026-09-29.

## Internal review findings retained

The internal loop found and corrected lost editor inputs after sibling catalog writes,
stale save receipts, draft/catalog naming disagreement, import-exit data loss, receiver
settings that differed between Survey and Layout, overlong export summaries, and a
short-window sidebar that covered its primary action. Regression checks cover the
specific preservation and navigation failures. Failed receipts remain in the private
acceptance evidence; later passes do not relabel them.

Candidate 8 passed two source reviews but failed browser acceptance: 66 focused
desktop cases passed and two failed; visible Edge passed 19 cases and failed five.
The failures exposed a duplicate test locator, missing browser accessibility state
on receiver method buttons, and a real map initialization defect at narrow widths.
MapLibre could not fit the field while its retained container was hidden or too small;
the default world-origin camera was then remembered as a valid view. These findings
reopened the affected loop and superseded the earlier source-review acceptance.

Network browser tests use local TCP/UDP sockets and synthetic NMEA; serial tests use
a browser fixture. They exercise transport ownership, freshness and cleanup, but do
not establish physical receiver compatibility or measured positioning accuracy.
