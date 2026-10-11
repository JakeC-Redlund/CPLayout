# CPLayout paused checkpoint — 2026-10-11

The owner requested feature work stop, preservation, commit/push/main-only
synchronization, and a factual handoff. This is a development checkpoint, not
completion of the unified-workspace objective or a release qualification.

## Decisions and publication boundary

Independent weighted reviews use compatibility .30, preservation .25, efficiency
.20, reproducible proof .15 and maintainability .10. They select publication of
an explicitly incomplete checkpoint (4.85) and the existing PR/non-force push/
required-CI/merge-commit path (4.70). Completing the old feature goal before
pausing, bypassing branch protection, force pushes and destroying detached work
are vetoed. Main requires strict `cplayout-required`, including administrators;
zero human PR approvals are required. PR2 has no unresolved review threads at
preflight. Reverify all remote state before the final merge.

Research verified against current official [Git push](https://git-scm.com/docs/git-push),
[merge](https://git-scm.com/docs/git-merge), [worktree](https://git-scm.com/docs/git-worktree),
[bundle](https://git-scm.com/docs/git-bundle), [GitHub protected checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
and [CLI merge head guards](https://cli.github.com/manual/gh_pr_merge).
Use ordinary push, exact reviewed-head merge, fetch/prune and fast-forward-only
local synchronization. Preserve the existing commit ancestry with a merge commit.

Browser-registry reviews select a current-App plus applicable platform registry
(4.45/4.50). All 31 existing spec sources remain; deliberate fixture/navigation
changes are recorded below without loosening preservation contracts. Eight whole
suites and three independently applicable titles in two mixed suites are current;
actual discovery is 225 project cases from 1185 total. The remaining 21 whole suites and old UI
cases in two mixed suites require migration. Their semantic contracts are **not
retired or verified** by selection. The registry must classify every file/title,
refuse inventory drift, and retain required source and all three browser shards.
No skips, extra retries or loosened preservation assertions create success.
[Playwright file/title selection](https://playwright.dev/docs/api/class-testconfig#test-config-grep)
supports explicit accounting. The network-allowlist case qualifies the test
harness policy, not production network security.

The mandatory installed-MapLibre attribution case initially failed because the
local headless environment could not initialize WebGL (ANGLE/Xcb failure).
An owned `xvfb-run` probe restored WebGL2. Two independent votes of 4.70 select
Linux local/CI proof under Xvfb, with only the three SVG-geometry suites explicitly
returning null for WebGL contexts. Other Canvas methods and arguments delegate
unchanged; security and other browser contracts retain real software WebGL.
Every assertion remains. Three deliberate fixture-setup/hash updates are
inventoried; their R4 bytes remain preserved. This does not qualify native or
physical GPU operation. [Chromium renderer guidance](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/swiftshader.md)
supports explicit trusted software-renderer testing. The installed-engine
attribution case now passes in all three viewports under Xvfb. The complete run
remains required before publication. Fresh read-only discovery and inventory
verification retain 225 current and 960 deferred cases, with no discovery errors.

The r5 complete-run attempt exposed two diagnosed current-contract failures
before its completion: the File rename test still expected the removed dialog, and a saved
Layout name became read-only while its admitted Save awaited the origin lock.
Preserve that failed/partial run and its frozen source. The bounded correction
migrates only the rename navigation to the retained input and explicit Discard;
copy/export and exact-storage checks remain. The Layout correction permits newer
raw name input only during its own submitted name transaction, retaining source,
generation, interaction and recovery guards. Other operations remain blocked.
The existing captured-A/newer-B assertion must pass unchanged. Independent review
vetoes accepting read-only input or removing that preservation assertion. Weighted
review favors stopping the known-failed owned run (4.85) and restarting all 225
on a fresh freeze, rather than claiming completion from the partial attempt.
The stopped run records 62 passed, three failed, one interrupted and 159 not run.
Its third failure is invalid field rename before Restore; an unchanged-source
standalone probe passes, but that does not dismiss the failure. The saved trace
shows the outer Catalog owning dialog focus while the fading inner modal has not
acquired its dialog role. Installed RNWeb activation/focus-trap code supports that
readiness diagnosis; the native text callback itself was not recorded. A reviewed
fixture correction waits for the actual inner active dialog, explicitly focuses
and checks its saved name, then performs one empty fill and verifies it before
Submit. Every original validation/storage/Restore/Recheck assertion remains.
The independent source reviews score this bounded fixture correction 4.89/4.80; no production
Catalog, retry or sleep change is justified by this evidence.

The narrow Layout editing predicate is source-accepted by independent votes
4.55/4.75. Thirteen actual-handler mode-panel tests and mobile TypeScript pass.
The r5 aggregate also completed successfully. These are scoped facts, not the
required fresh complete browser result. Independent checkpoint review and a
resume-order vote of 4.70 prioritize actual recovery/failure/keyboard preservation
checks before additional features.

The staged check additionally found one ordinary TSX trailing space, one schema
blank EOF and four internal space-only lines in the frozen v1 reader. Preserve
that reader's exact bytes. Independent votes 4.89/4.85 select ordinary-source
format cleanup plus a single reader-specific `-text whitespace=-blank-at-eol`
attribute. Text diffs and other whitespace checks remain; no global exclusion,
binary marker, regeneration or hook bypass is used. [Git per-path attributes](https://git-scm.com/docs/gitattributes#_checking_whitespace_errors)
support this preservation boundary. Require equal before/after emitted JS for
the two formatting changes, unchanged reader working/index/archive hashes, and
a new source freeze recording the explicit R6-to-R7 whitespace equivalence bridge.
Before/after emitted JavaScript is identical for both ordinary source cleanups.
The R7 export also matches the R6 bundle exactly. This is historical evidence for
that whitespace-only extension; R6 runtime evidence stays bound to its edition.
Later production changes, including the Catalog animation repair, require their
own source/build/served fingerprints and matching protected CI.

The corrected R6 focused proof passed all nine cases across the three viewports.
Six new Windows Edge PNG/DOM figures match served bundle
`21c7f80a28887e205e24f4c4551e2c0adcd6cdfc0ace5ec75c10392b346244ff`
with no observed page errors. Skills, context map, 96 visual-review tool tests and
exact dependency mitigation verification pass. Final aggregate and complete
225-case local run are pending at commit time. Independent timing votes 4.70/4.75
allow ordinary commit/push to start CI concurrently; they do not authorize merge
until all local and exact-head protected CI gates pass. Actual terminal results
and final main OIDs are recorded in the coordination receipt and PR2.

The complete R6 browser run subsequently finished with 221 passed and four failed
of 225. Preserve its full failure archive. Three startup failures use the obsolete
Field Rename button label. The fourth entered the intended new-design name and
received a real under-lock ownership refusal before mutation while the nested
modal was still activating. The trace does not identify the retiring epoch.
Do not call that refusal an empty-name error or weaken the CAS/source guard.

Independent reviews select a bounded current-fixture batch (4.75/4.90): use the
retained Field name input and its actual Apply action; establish active inner
dialog/focus/default/value acknowledgement for fresh Catalog entry, current-field
Cancel/Create and Field Rename/Restore flows. Preserve all existing mutation,
source, target, history, camera, raw-input, validation and guarded-Open assertions.
No retry, fixed sleep or automatic Recheck manufactures success. If the ownership
refusal persists after that handshake, diagnose its exact predicate before any
source correction. Refresh full discovery/inventory and run focused affected
cases, then the complete candidate gate. The pushed 3856acb checkpoint cannot
merge on the failed R6 evidence; subsequent corrections require an ordinary new
commit and matching protected CI.

R8 focused execution passed 21 of 24 and failed three active-inner-dialog checks.
After ten seconds the outer Catalog still owned the dialog role while the visible
Create Design form lacked it. This demonstrates a production activation defect;
more waiting or a weaker locator is vetoed. Installed RNWeb promotes a modal when
its `onShow` fires. Two sibling fades can complete in the wrong order, letting the
outer Catalog permanently reclaim role/focus after the child has opened.

Independent votes 4.85/4.75 select a web-only outer Catalog `animationType="none"`.
Its visibility effect registers the parent before the child fade completes.
The child animation, value owners, recovery and strict under-lock guards remain.
Non-web keeps its previous fade; native qualification is still unknown. Stateful
visibility coordination or a complete embedded-form rewrite adds unnecessary
ownership changes during this pause checkpoint. Preserve R8 failures and rerun
all affected flows and the complete frozen gate before publication.

The web activation repair passes all 24 focused cases with the strict role/focus
helper. Old-commit CI (3856acb, run 38157569648) passed source validation and failed
browser shards with 215 passed/10 failed; its logs/artifacts are retained. The
extra customer-edit failures also typed before the profile dialog owned focus.
Apply the same single-fill active-dialog handshake to that earliest interactive
entry, preserving all post-Save empty/error/storage assertions and the separate
deferred-effect initializer tests. The focused set becomes 27 executions.

All 27 corrected focused executions now pass across desktop/tablet/narrow,
including cancel/reopen, current-field creation in all three modes, actual early
customer validation, restored Field rename and separate Layout/Design saves.
Two independent complete source/archive reviews accept the 1118-file edition;
they are checkpoint reviews, not the two outstanding whole-workflow reviews.
The only new app behavior is the Web Catalog animation ordering fix. Root keeps
the full local run, aggregate and protected exact-head CI required before merge.

## Verified implementation and evidence

One retained workspace owns Design, Survey and RTK Layout, controller/catalog,
receiver, input retention, save ownership and map/cameras. Complete workspace
package import and saved-context resume use reviewed identities and revisions.
Unfinished-edit recovery is separate from domain Save and never reconnects a
receiver. Design/Field names are distinct; saved title synchronization is optional
in storage and requested by ordinary UI Save only after an actual applied change.
Current-field creation preserves independent Browse, dirty input and saved source;
Open is explicit. Field-container rename changes metadata only. Recovery v2 adds
that distinct form while preserving strict v1 reading/export and opaque old-reader
refusal. Parent-note/title drift can reconcile; changed field/source ownership
remains a conflict. Forms initialize once per logical owner and retire callbacks
at unmount commit, retaining hidden values and recovery acknowledgement barriers.

R4 freezes 1112 files at
`020b1626373ed632db3cdd137ec119acbbab01951828594a866a25c7bc5f4f8f`.
The exact default-App management run passed 33 cases across desktop/tablet/narrow,
including real short-window Tab reachability, early empty customer/field-name
validation, source/target preservation and exact camera capture with measured
screen projection. Focused initializer 8, Catalog management 20, Catalog recovery 11
and mobile TypeScript pass. Six Windows Edge PNG/DOM figures match served bundle
`f7982d76c82c4e0eedf6a7fefec2fca8d9dee14ffe3eb439a9832872590d6fc9`.
Earlier failed R1/R2/R3 evidence is retained. R3 aggregate passed before the final
initializer repair; the r5 publication aggregate also passes. Any subsequent
source correction requires fresh candidate checks and exact-head CI.

Raw audit remains 21 high/5 moderate. Exact local verification admitted the named
mitigations; this is not zero audit or an upstream-fix claim. Frozen old readers
remain unchanged. Native SQLite/MapLibre, physical COM/SPP/TCP/UDP and measured
field accuracy are unqualified. Two complete whole-workflow acceptance reviews
have not occurred; bounded source/visual reviews are not substitutes.

## Resume work, in dependency order

1. Read this record, `docs/development-status.md`, the selected
   `docs/unified-workspace-refocus-2026-10-10.md`, and the task-specific management,
   import/resume and recovery plans. Check current AGENTS disposition; its old
   archive is historical evidence, not an instruction source. Reinspect actual
   main/remote/OIDs/dirty ownership and coordination receipts before writing.
2. Execute actual postpublication recovery-failure/rollback injection, full
   keyboard/focus, two-tab, quota and short-height workflows. Missing receiver
   evidence stays unknown; reconnects require fresh observations. No mandatory
   receiver-model/firmware/antenna questionnaire precedes communications setup.
3. Review the browser inventory/debt per title. Migrate old navigation setup to
   the current default App while preserving each contract and all existing
   assertions. Particularly cover actual TCP/UDP companion lifecycle/cleanup,
   stale tabs/quota/corrupt opaque storage, delayed raster/fallback/assets/CRS,
   complete import/copy/export/report flows and unfinished-input cancellation.
   Current Node/domain tests do not substitute for browser/runtime proof.
4. Finish Field-container management and manual Field geometry reachability.
   Review machine choices/comparison/adoption, document versus container identity,
   copy/reopen/report/output revision identity, and current-field result reachability
   when future-dated Recent entries change sorting. Preserve all canonical XY,
   original document strings, revisions/tombstones, targets and evidence.
5. Qualify live Codex hooks separately: source/discovery probes succeeded;
   guarded execution probes emitted zero hook events, cause unknown. Do not
   repeat unchanged probes, globally change trust or restart external sessions.
   Research a measured next probe against the installed tool before changes.
6. Continue research → bounded plan/contract → disjoint implementation → focused
   tests → source freeze → actual served App/visible Edge → independent review.
   Require two consecutive **complete** reviews without unresolved workflow,
   preservation or usability defects before final software acceptance. Report
   software, delegated/human acceptance, native/physical transport and field
   accuracy independently. No new solver, native activation or machine control
   is authorized by a UI acceptance claim.

## Shared work, preservation and resource custody

Canonical preflight was clean 83c257a on the publication branch; main/origin main
was 96ba2e9, 21 commits behind. Source was implemented in the detached
`/home/cyber/cplayout-worktrees/unified-workspace-20261010` worktree. Its audited
delta was 92 tracked/100 untracked paths; stage the audited delta and new handoff
files, not every snapshot file. Unchanged historical reports and the Valley
spreadsheet are snapshot context. Git bundles preserve committed refs, not dirty
index/working state; source/dirty-state archives are separately retained.

Six older detached worktrees remain owned historical/parallel work. Preserve
their dirty state and ignored artifacts; do not reset, force-remove, replay 78
historical repairs or call their existence a dirty canonical checkout. The held
modeling request is `c3f4844f-9138-415c-8dc6-72b283695701`; 72-path r3 remains based
on ab0d03e, packet hash
`0ffaf4f0fb1509c41439a736147154a7c477eea69685d5cebcb914a1e9f8c104`.
Its receipt/manifest is in the acknowledged independent modeling snapshot. It
has 18 authored/unexecuted browser cases and numerical/advisory kernels, with
fieldQualified false. A published pause checkpoint does **not** transfer its
canonical integration/build/aggregate/export/Edge lease. Future reconciliation
must preserve current generations/guards in App, FieldDesignWorkspace,
FieldLayoutSearchPanel and CatalogArchiveImport; never integrate old r2.

Private evidence is retained under `/home/cyber/cplayout-refocus-20261010`.
Coordination/publication receipts are in canonical ignored
`.cplayout-local/coordination/human-workflow-01a0e9dd.json`. They contain final
publication OIDs/CI and actual stopped resource disposition after operations;
verify them directly rather than infer success from this prepublication record.
Only Root-owned static 19018 and the exact Edge app page on CDP 9230 may be closed
after state/evidence custody. Other Edge tabs, external sessions and proposed
modeling ports 19026/19027 are untouched. H: read/write from Windows and WSL,
matching package hash and clean canonical Git were verified; no remount or
permission change was needed.
