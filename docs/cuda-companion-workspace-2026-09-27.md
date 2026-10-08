# CUDA companion and workspace integration

Implementation record: 2026-09-27. Complexity/effort: xhigh. Subagent decision:
required; bounded CV and companion writers ran serially, with independent
read-only QA. Existing application, storage and geometry work was preserved.

The companion now consumes `portable-cv-toolkit==0.3.0` as a relative vendored
wheel with a locked hash; the 0.2.0 wheel remains available for rollback. Generic process/resource/model execution belongs to
the canonical CV owner; calibration, contours, projected XY and review policy
remain CPLayout-owned. `cli.py` remains a compatibility facade over extracted
`command_line.py`, `runtime_status.py`, `vision_policy.py` and `toolkit_bridge.py`.
DVC/MLflow moved to the optional `experiment` extra, also included by `all`.
The companion environment received only the new toolkit wheel with dependencies
unchanged; it was not resynchronized or removed.

`cplayout-boundary-improvement-loop-v2` distinguishes the CUDA tensor diagnostic
from CPU OpenCV boundary work. CUDA availability no longer determines boundary
quality acceptance. `autoApplyEligible` stays false and operator review is
required. The legacy implicit SAM2 slot remains unavailable; explicit managed
jobs accept hashed images/configuration/checkpoints and explicit point prompts.
No generated mask becomes canonical geometry automatically.

Set `CPLAYOUT_CV_PYTHON` to the absolute Python executable in the managed local
environment, then run `npm run ml:cv-job -- --job /absolute/owned/job.json`.
The bridge clears sibling `PYTHONPATH` imports and identifies owned Linux
descendants with an inherited random token and process start identity, including
descendants that create separate sessions. It
checks completed result/cleanup/artifact status and exposes no browser shell API.
Native Windows bridge process-tree cleanup is intentionally unqualified.

The canonical CV repository maintains the exact runtime locks, model acquisition
record and detailed results in `packages/cv-toolkit/profiles/torch-cu130/`,
`records/governance/cuda-cv-qualification-2026-09-27.json` and
`records/research-notes/cuda-workspace-implementation-2026-09-27.md`.
Use these by reference instead of duplicating model scores here. Real SAM2
image/video inference and synthetic training/resume ran through WSL CUDA.
These measurements do not establish field accuracy, mobile inference, human
acceptance or Google Earth rendering.

Windows launchers derive the checkout from their own location and explicitly
select `Ubuntu-24.04` by default; `-Distro` supports another verified host.
One shared converter supports drive paths and WSL UNC/Linux paths with spaces,
rejects foreign distributions/traversal, and constrains archived review URLs.
The stop launcher requires the selected server port and delegates live process
identity checks to the existing repository manager. The optional stop shortcut
prompts for that port; it cannot silently stop all sessions.

Google Earth capture/cleanup now shares exact executable/PID/start-time checks.
Ambiguous selection and stale identities fail closed. Artifact opening uses the
pinned process; capture errors still reach cleanup. These changes have pure
Windows identity/path tests and parser checks, not a new Google Earth render or
shutdown proof. Apply the existing strict cleanup contract whenever it runs.

Full relocation remains held. The parent-owned
`scripts/workspace_migration_preflight.py` records bounded Git topology, current
physical Windows-volume capacity and unknown sizes in a private receipt. Missing
registered worktrees, incomplete scans, full-workspace environment restoration and
insufficient reserved capacity prevent cutover. No repository, global skill link,
registry root, existing cache or rollback origin was moved/deleted.

The additive OCR/detection expansion is tracked separately in the canonical CV
owner's `records/research-notes/cuda-vision-expansion-2026-09-27.md`. Its
`CVJob-v2` profile uses explicit local model bundles and an H-backed data VHD,
while retaining the existing SAM environment. Generic browser review runs in the
companion host; it is not embedded Python in React Native. The CPLayout bridge
accepts both job versions and verifies owned descendants after normal exit as
well as interruption. Neither model output nor browser notes gain automatic
project geometry or training-label authority.

The new 0.3.0 profile was reconstructed from a local wheelhouse with network
connections blocked, and both OCR and detection completed in that environment.
This closes the new profile's offline reconstruction gap; it does not qualify
whole-workspace relocation. See the CV owner's
`records/governance/cuda-vision-expansion-acceptance-2026-09-27.json` for current
artifact identities, completed checks and measured quality limitations.

Validation belongs to the final canonical acceptance record. Applicable gates:
companion tests and offline lock check; Windows path/ownership behavior tests;
`npm run context-map:check`; `npm run validate:skills`;
`npm run test:visual-review`; `npm run validate`; `npm audit`; `git diff --check`.
Launcher/browser checks use an explicit port and the exact printed URL. Native
Android/iOS, Windows-native CUDA, live Edge questionnaire authorship and Google
Earth runtime remain separate acceptance gates.
