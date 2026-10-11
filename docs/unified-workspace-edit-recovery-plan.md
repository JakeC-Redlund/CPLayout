# Unified workspace edit recovery

Status: parser/store/retention/read-lease source integrated and independently
reviewed within their bounded scopes; participant/controller/UI integration remains
required. The previous goal
turn verified current H: Windows/WSL reads and writes and Git; no remount was
needed. This turn qualifies wave7-A2-r3 without source drift. The complete goal
remains active. Complexity xhigh for authority, history, storage and hydration;
high for bounded UI/tests. Independent implementation and QA are required.

## Verified gap and decision

InputRetentionStore has only in-memory values/focus and generation guards. Survey,
reference and Layout fields also have panel-local owners. Project pending drawing
is in Entry; Draft drawing is reducer-backed. Controller and camera stores are
recreated on restart. The v2 hint restores saved context and empty editor/history,
not these unfinished values. Existing web recovery export intentionally contains
opaque durable workspace/backup/legacy bytes, not working UI state.

Use a separate versioned browser-local edit-recovery envelope. Keep both context
hints, durable workspace schemas, archive formats and opaque recovery export
unchanged. Independent preservation scores: separate envelope4.65 versus extending
the existing exporter2.85, weighted continuity.35/preservation.30/maintenance.20/
capability.10/cost.05. Root concurs: the exporter cannot observe all live owners.
Full recovery precedes ownership-changing management. Stable field/payload IDs
already exist; field rename is not a technical recovery prerequisite. The reviewed
management gaps remain required, including distinct catalog-field and design names,
explicit current-field New choice, strict form receipts, and field move/delete.
Both independent sequencing votes favor full recovery first4.50/4.50, versus
management first3.70/3.95. These are source-informed judgments, not measured
probabilities. Writing only the parser/storage slice cannot qualify full recovery.

## Frozen boundaries and implementation contracts

New recoveryVersion is cplayout-unified-edit-recovery-v1. Each detached candidate
contains writer ID, monotonic sequence, capture time, validated v2 context, exact
acknowledged design/source/originalProjectDocument anchors, revisions, working
document, editor past/future/revision/saved revision/CRS lock/machine selection,
workspace Survey history stacks, exact collection receipt anchors and exact Layout
session/target bytes/hash. Raw inputs include baseline/clean fingerprints and
detached values; dirty is recomputed. Recover typed presentation participants for
Entry drawing/classification/tools, Survey/reference, Layout, Catalog review/forms,
File dialog and finite camera state keyed by actual field/CRS context. Receiver
communications raw form is also a participant: the existing receiver owner holds
method, baudRate, protocol, address, port and sourceAddress text outside retention.
Recover that form/settings disclosure only into a fresh idle owner; never Connect
or restore connection/session/observation state. Preserve invalid/whitespace
strings and ordered drawing coordinates/times exactly.

Do not restore callbacks, operation/generation tokens, queued writes, pointer
gestures, receiver connections/live observations, calculated outputs or submitted
manual-capture event sequences. Restored tools are parked presentation state.
Recover import bytes exactly with filename/length/digest; re-decode and re-review
before any import. No local UI object can establish Survey/RTK authority.

Pure module APIs: parseWorkspaceEditRecovery(raw), resolveWorkspaceEditRecovery
(candidate,freshWorkspace), and a detached validated recovery admission. The
resolver distinguishes ready, reconcile_required, source_conflict, unsupported
and invalid. It compares actual
ancestry, kind/payload, source/original bytes, design revision, collection receipts
and Layout/session target anchors. It validates every current and history document
against fresh retained origins/attachments and membership IDs. Existing history
transactions remain the only durable Survey-membership mutation route. Independent
refinement identifies captureWorkspaceSiblingProof(...,true) and
reconcileWorkspaceSibling as the existing monotonic-revision/exact-source boundary.
Unrelated revision advance with all exact anchors unchanged requires explicit
Restore against current saved version; then advance only the workspace receipt.
Changed ancestry/source/design revision/collection/session bytes is source_conflict,
preserved for export without hydration. A revision moving backwards also refuses.
For old history documents, mergeRetainedReferenceOrigins(trusted fresh saved
payload,parsed older snapshot) first rejects non-authoritative presented origins,
then carries the complete fresh ledger. Never seed recovery as the trusted first
argument. Check recovered current attachments and operational evidence against
fresh sources, and history memberships against real observation IDs; raw snapshots
cannot establish new authority. Freeze these rules before parser/resolver writes.

InputRetentionStore adds snapshotRecovery and restoreRecovery with fresh owner
admission. UI participants stage/validate first, then consume one-use delivery
after ordinary source-reset effects. All participant validation precedes one
controller publication; no partial restore. Renew all document, interaction, scope,
source and Save owners rather than accepting serialized generations. Preserve
source receipts and leave autosave off after recovery. Save uses existing guards.

Retention interface freeze: snapshotRecovery returns detached WorkspaceRecoveryInputs.
stageRecovery(snapshot) validates every entry/fingerprint/value/focus without mutation
and returns a runtime-owned single-use ticket bound to current generation/revision.
restoreRecovery(ticket) rejects forged/retired tickets before mutation, renews setter
owners and publishes the complete restored store once. Recovered clean fingerprints
are historical data, never permission to bypass Apply. Known keys use actual fresh
mounted baselines; parked inactive keys rebase their exact raw values on first fresh
reconciliation instead of dropping them. Dirty state compares recovered values with
those actual baselines. Reconciliation/hydration is not a new operator input event.
Test malformed late entries for all-or-nothing restore, aliases, generation/input
ABA, inactive remount, forged clean values, exact text/array/caret and old setters.

Recovery storage APIs readCandidates, checkpoint(candidate,expectedSequence,
isCurrent), discard(writerId,expectedSequence,isCurrent), exportCandidate. One
bounded ledger stores independent writer slots under a separate origin lock/CAS.
Each mount gets a new writer ID; restoration forks its slot. Never automatically
select or overwrite another tab's latest checkpoint. Validate exact prior ledger
and current owner under lock before writing. Unsupported native refuses before
recovery storage access. Missing cross-tab locking refuses writes instead of
claiming a safe in-process fallback.

Storage interface freeze: createWorkspaceEditRecoveryStore({backend:"web"|"native",
storage,withExclusiveLock}). Construction performs no storage access. Lock callback
is asynchronous and origin-scoped; missing lock/backend support refuses before
reading. Key is cplayout-unified-edit-recovery-v1. Ledger shape is strictly
{ledgerVersion:"cplayout-unified-edit-recovery-ledger-v1",slots:[{writerId,sequence,
raw}]}; each raw is a validated serialized candidate with the same writer/sequence.
checkpoint expects null for an absent slot, otherwise the exact prior sequence;
candidate sequence must be1 or previous+1. All ownership, sequence, size/slot and
exact prior raw checks happen under lock before setItem. No fallback eviction.
readCandidates returns detached {writerId,sequence,raw,candidate}; exportCandidate
returns exact stored raw. exportRawLedger permits exact corruption preservation.
discard requires exact sequence and a current runtime predicate. Serialize this
instance's writes; duplicate submissions cannot replace another acknowledgement.
Typed errors distinguish unsupported, stale, cancelled, quota, corrupt, limit and
invalid. These local recovery receipts never acknowledge a domain Save.

Initial chosen limits are8MiB UTF-8 ledger and16 writer slots; these are product
bounds, not an assertion of available browser quota. Oversize/quota/corruption
refusal retains memory and prior bytes without truncation/eviction. Expose failure
and explicit recovery export. Capture coherent snapshots on accepted changes,
serialize writes and show acknowledged checkpoint state. Do not depend on unload;
abrupt termination before acknowledgement remains an explicit limitation.
Parser resource limits are512 history entries per stack,1024 collection anchors,
4096 input entries,128 cameras,32768 drawing vertices,64 JSON levels and150000
JSON nodes. They reject rather than truncate; they are implementation bounds,
not evidence of available browser quota or checkpoint coverage for larger work.

After saved-context startup, offer Recover unfinished work, Export and Discard in
the shared workspace. Restore is a guarded product action and performs no domain
transaction. Stale sources remain preserved; reconciliation must distinguish
unrelated revision advance with unchanged exact anchors from changed ownership,
source, collection or session data. No automatic merge of conflicting geometry.

## Web read lease for integrated Restore

Interface freeze before source changes: VersionedWorkspaceRepository gains optional
readLeaseAsync<T>(expectedRevision,action,isCurrent), where action receives a fresh
validated workspace plus assertCurrent(). The web adapter holds the existing
workspace writer lock throughout the bounded async action. It validates workspace,
legacy backup, reviewed revision and runtime owner before callback; assertCurrent
rechecks owner and exact workspace/backup/legacy bytes immediately before the
actor's synchronous publication. No initialization/upgrade/domain write occurs.
Do not call readAsync/transactAsync on the same locked store inside this action.
The leased snapshot is detached and recursively frozen. assertCurrent expires when
the action finishes, including rejection, and cannot grant authority after release.

Root owns webWorkspaceStore, versionedProjectRepository, repository types/hook,
new workspaceRecoveryReadLease.test.ts and its registration. Missing/native
capability refuses before database access. Restore lock order is workspace then
recovery; checkpoints never take workspace while holding recovery. Independent
tests cover a second writer waiting, stale review, intent retirement during lock
wait, unsupported locks, uninitialized/corrupt/legacy drift, callback failure and
outside-lock raw changes, with exact unchanged bytes. This primitive alone does
not prove integrated controller/participant hydration or actual browser locks.

## Ownership and meaningful verification

Root owns controller/Entry/InputRetention/panel/camera integration, product controls,
documentation, Git and all aggregate/export/19018/Edge9230 resources. A pure worker
owns only new workspaceEditRecovery.ts and its tests; a storage worker after API
freeze owns only new workspaceEditRecoveryStore.ts and tests. No overlapping writes.
Independent actual-App QA begins after integration freeze. Preserve every failed
iteration and exact source/fixture/build identity.

Required acceptance: all three document kinds; exact invalid raw text/error state;
Draft and Project unfinished drawing; editor and Survey undo/redo; retained origins
through deletion/restoration; camera/machine/tool selection; Save after recovery;
newer input during acknowledgement; multiple/stale tabs; source/ancestry/revision
drift; input/visibility ABA during reads; malformed/corrupt snapshots; invented
Survey origins; changed targets; quota/oversize/slot exhaustion; native zero access.
Compare original document strings, Survey observations/applications and frozen
target bytes exactly. Run focused checks, aggregate, actual App and settled Edge.
Configuration/tests alone do not prove integrated recovery.

## Parallel source-bound hook proof

OpenAI Docs rechecked2026-10-11: project trust controls layer loading, exact hook
trust is separate, and invocation-only bypass does not persist trust. See
[Hooks](https://learn.chatgpt.com/docs/hooks) and
[CLI overrides](https://learn.chatgpt.com/docs/config-file/config-advanced#one-off-overrides-from-the-cli).
The previous90-file independent snapshot is unchanged but six files differ from
current source. It discovered no hooks because the project layer was disabled.
Its dotted-path override did not repair attribution; cause is not established.

Independent governance score4.45 selects a new exact90-file normal-Git snapshot
and global whole-projects-table invocation override, versus repeating the failed
route3.10; substituted inline/session hooks3.30 has a source-fidelity veto. Root
concurs and owns this bounded probe. Copy exact current closure, initialize private
Git with no remotes, record version and all hashes, use documented -c projects
table and invocation hook-trust bypass. Request initialize, config/read (metadata
allowlist only), hooks/list. Do not start a thread unless the project layer is
enabled and all discovered source paths/commands/limits/trust bind the snapshot.

Only then use one schema-supported ephemeral read-only synthetic turn requesting
one harmless projected-XY marker command. Pair native hook/started and
hook/completed by run/thread/turn ID with actual source/event/status/context and
frozen dependency bytes; listing or direct script invocation is insufficient.
Stop only the owned process, rehash, retain minimized evidence. A snapshot success
does not repair linked-worktree discovery or prove managed/external/SubagentStart/
denial behavior. No global trust/config, credentials or external restart changes.
Failure to attribute stops before a turn; no timer-based transfer or guessed keys.

Executed discovery r2: all90 exact snapshot files match current dependencies;
whole-table invocation override enables its own project layer and discovers exactly
three enabled handlers with the expected sources/limits. Definition trust remains
unpersisted, as intended. A fresh gated read-only ephemeral turn completed with one
marker command and unchanged bytes, but no typed hook execution notifications.
This is discovery evidence, not live handler acceptance. Cause is not established.
One independently reviewed diagnostic variant explicitly sets the documented
features.hooks key in thread/start.config and counts every native notification/item
with a continuous privacy-limited reader through EOF, including hook-shaped legacy
envelopes. Keep attribution/terminal/source guards. No unchanged restart or guessed
trust parameter is selected; absence of events remains an incomplete execution gate.
The changed variant also completed normally with one marker command, complete
notification accounting through EOF, no hook-shaped events and unchanged snapshot
bytes. Source-bound discovery is proven at this snapshot; execution remains
unproven and its cause unknown. No further unchanged probe is selected.

## Source checkpoint and next implementation

### Integration evidence — 2026-10-11, incomplete acceptance

The single controller now owns edit-recovery operations and receipts; typed
participants read the existing Entry, common frame, receiver, Catalog, Survey,
Layout and camera owners. Publication uses the saved-workspace read lease then
the exact reviewed recovery-slot lease. All started deliveries drain before
rollback; retained inputs require a subsequent actual parent commit before
controls are enabled. Restoration renews document/interaction/Save/input owners,
parks autosave and requires an idle receiver. Domain Save remains independent.

Independent probes found and closed stale activation reviews, slot advancement
during asynchronous staging, delayed list overwrite, lost queued checkpoints,
reentrant publication drift, early rollback, hidden-Modal owner loss, no-scene
camera loss/hang, and reserialized source anchors. The last exact-source witness
keeps valid CRLF/pretty Survey and Layout document strings and resolves ready;
the missing/different acknowledged receipt refuses. These are bounded source,
actor and component findings; they do not establish the full workflow gates.

Focused actor26, controller4 (including exact formatted anchors), registry3,
mode12, Catalog11 plus prior22, camera13, and startup/repository38 checks pass.
Mobile TypeScript and legacy-reader integrity pass. Source scripts register the
new suites once. No native/device/physical/accuracy acceptance is added.

Diagnostic export r1 loaded in the owned Windows Edge app at port19018 with
served bundle SHA2569a6a77677af7101bcc7129d07ee8efef2591efdb38326d80f734a186f30e86a1.
One clean same-context checkpoint restored without page errors or changes to
saved-workspace bytes. This run predates the formatted-anchor and post-input
commit repairs and the subsequent human-language card changes; it is retained
as diagnostic evidence. The next candidate needs a fresh export and actual raw
input/other-owner/failure/two-tab/keyboard/responsive checks. Full aggregate,
two complete reviews, publication and remaining management work are still open.
The modeling handoff remains held; no shared resource or Git transfer is granted.

### Live integration wave — 2026-10-11

Previous goal turn: progress (implemented/refused defective recovery primitives,
independent counterprobes and passing frozen aggregate). Current preflight verifies
all1092 r2b hashes unchanged. Root retains isolated83c257a and shared resources.
Complexity xhigh for controller/participant admission; high for bounded UI owners.
No native activation, dependency change or canonical integration is selected.

Before wiring capture, add required ui.settings:AppSettings using current Core
parseAppSettings and exact canonical-field validation; default helper supplies the
actual default settings. This pre-release envelope has no live producer yet; keep
old frozen bytes as evidence, and test the changed shape before accepting it.
Catalog keeps exact upload bytes/filename/digest before decode and re-reviews them
on recovery. Capture an acknowledged import as a saved receipt, never as an
unsubmitted upload that could create another copy. diagnosticOpen=true is refused.
Typed savedImportId/savedCopyId retain the existing Open saved copy affordances;
resolve them against actual fresh design records, never replay their commands.
Acknowledged imports carry no unsubmitted upload bytes.
Actual retained focus addresses identify logical controls within grouped values,
not necessarily an entry whose value is a string. Accept bounded inert focus/caret
metadata and let the actual registered field clamp selection/focus on delivery;
it cannot establish data authority or become a DOM selector. Local Catalog/File/
receiver controls delegate focus metadata to the existing InputRetentionStore.

One runtime-only participant registry belongs to the existing controller. Names
entry/frame/survey/layout/catalog/receiver/camera identify current value owners.
entry supplies task/drawing/layers/File raw values; frame supplies tools/receiver
disclosure; other names supply their existing typed UI slice or camera array.
capture() reads current refs. stage(value,target) validates without setters and
returns {isCurrent(),consume(delivery)}; tickets/callbacks never enter JSON.
target carries the detached admitted state and current leased workspace. delivery
carries renewed document generation and isCurrent(). register(name,handle) returns
owned cleanup; notifyChanged() observes accepted raw/disclosure changes separately
from source-reset bookkeeping. Capture refuses missing required owners rather
than inventing empty snapshots. Camera bridge remains available when no scene
exists and delivers validated cameras when its sole real renderer mounts.

Stage every participant and retained-input snapshot before controller publication.
Independent actor probes on2026-10-11 found activation-retained reviews, a slot
advance during asynchronous staging, and a delayed refresh erasing a newer
acknowledgement. Root repairs bind reviews to their original activation, retire
older list deliveries, and add withReviewedCandidate: a read-only recovery-origin
lease that rechecks exact reviewed sequence/raw/ledger immediately around the
final synchronous publication, after asynchronous staging has finished. Lock
order remains workspace then recovery; participant delivery runs after release.
The repository UI also accepts the exact leased read receipt through its existing
snapshot publisher. This refreshes names/catalog revision without saving anything,
retiring delayed older catalog refreshes; native and retired owners refuse first.
Under workspace then recovery lock, recheck exact candidate bytes/sequence, source
anchors, unique local intent, idle receiver, mount, busy/save and participant
ownership. Publish the admitted controller state once, renew Save/interaction/input
owners and disable autosave. Gate normal commands during one-use delivery after
ordinary reset effects. Internal setters consume parked raw values; new Catalog
children get fresh review owners. A failed delivery must retain the candidate and
restore the previous in-memory workspace/participant state before enabling controls.
No domain transaction, automatic import, connection or geometry event is replayed.

Root owns registry/controller/Entry/common frame/receiver/controls and focused
integration tests. Pure worker owns only the existing recovery parser/tests for
settings coverage. Mode worker owns only WorkspaceModePanels for Survey/Layout
handles. Catalog worker owns only WorkspaceCatalog and ProjectCatalogDialog for
typed raw form handles and byte custody. Camera lease follows the pure freeze and
is limited to map-adapter camera/frame/types plus focused camera tests. Interfaces
above freeze before disjoint writes; no worker owns aggregate/build/Git/Edge.
Root integrates, runs focused checks, obtains independent review, freezes, exports
once and tests actual reload/Restore/Export/Discard/two-tab/Save/keyboard/resize in
the real App and visible Edge. Whole management/hooks/main scope remains required.

Pure admission22 cases pass; independent review closed four actual counterprobes:
autosave parking now participates in truthful dirty state, full operational capture
tuples/times must be authorized, Layout receipt reconciliation is coherent, and
actual viewport validation rejects overflowing visible corners.45 independent
capture/time refusals plus authorized-copy/older-origin controls pass. Recovery
store20 cases plus seven independent counterprobes pass. Input retention34 cases
and independent reacceptance close array-accessor and same-value owner defects.
Read-lease22 cases and preceding web-store20 cases pass. Failed source/test bytes,
complete hashes, witnesses and corrected packets are retained privately.

Both new mobile suites and the read-lease suite are registered exactly once,
preserving preceding test command bytes. Application/package TypeScript, root's
full aggregate, all focused cases, skills/context and diff pass with all1092
wave8-r2 hashes unchanged. None of these checks executes automatic capture or full
Restore in the actual App. Last served/visible App proof remains wave7-A2-r3.

The next source review verifies two coverage gaps before integration: AppSettings
is controller memory initialized from defaultAppSettings with no persistence, and
the current envelope omits it; Catalog currently discards exact upload bytes after
decoding. Add strictly validated settings and exact pre-decode byte custody. Treat
machine-local paths as literal settings, not proof that assets exist elsewhere.
Catalog child forms are local state keyed by form.sequence for React mounting,
not existing sequence-prefixed retention fields. Recreate fresh child reviews and
deliver raw values after their resets; no invented address remapping. Existing
payload/section retention addresses remain stable. diagnosticOpen has no identified
current owner; reject restored true unless its actual owner is implemented.

Next root implementation: one recovery owner in the existing controller, fresh
runtime review receipts and workspace/recovery lock admission; register typed UI
snapshot/stage/delivery participants with the actual existing value owners; renew
local form owners with their actual stable retention addresses; checkpoint acknowledgement/error
status; common Recover/Export/Discard controls; coherent all-participant hydration
and Save-session renewal. Keep receiver disconnected and tools parked. Then author
and run actual-App failure/reload/two-tab/history/camera/Save journeys and settled
Edge against the frozen changed source. Do not substitute helper acceptance for
this remaining end state, or restart governance probes without a changed supported
diagnostic. Management and full final proof/publication remain active requirements.

Full management, hook capability coverage, manual Field drawing, reports/comparison,
full browser/proof/CI/main-only synchronization and two complete reviews remain
required. The modeling packet stays held until an accepted main checkpoint and
explicit serial handoff; this plan grants no transfer.
