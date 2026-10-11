# Current-subject save, status and file workflow plan

Status: interfaces frozen for implementation after two independent Layout Save
votes. Root owns integration/Git/build/export/Edge. The wave4 R4b checkpoint is
preserved; the new File/status source is mutable until its own freeze.

## Verified gaps

Source review confirmed common Saved describes canonical data alone, excluding
visible unsubmitted text. Save remains enabled but refuses dirty retained input;
that input precondition becomes savedState=error and an autosave/storage-looking
message. Discard alone does not clear that state. This preserves geometry but
misleads the operator about what was saved.

Copy checks pending input indirectly only when canonical data needs saving. It
can copy a clean applied document while excluding visible unapplied edits. Export
blocks those edits before its async read, but does not recheck them after that
read. New raw text does not retire the document owner. Preserve old source and
complete-copy semantics while making admission and output boundaries consistent.

Layout changes the visible subject to its session, while common Save still
targets the retained Design and reports its save status. Design File actions label
that retained design; session export labels frozen target and saved observations.
No wrong-field association or target mutation was demonstrated. Improve actual
subject/status/commands rather than weaken the immutable target.

## Weighted priority

Use continuity.35/preservation.30/maintenance.20/capability.10/cost.05.

| Order | Coordinator | Independent reviewer | Mean |
| --- | ---: | ---: | ---: |
| File/status and active subject first |4.65|4.75|4.70|
| Parallel Core and UI after interface freeze |4.10|4.40|4.25|
| Neutral reference first |3.30|3.00|3.15|

Scores are source-informed judgments, not measured pass probabilities. Selected:
repair file/status first. Neutral-reference Apply currently refuses honestly and
retains evidence; its reviewed versioned contract remains next, not abandoned.

## Required behavior and decisions to freeze

- One shared source-aware status distinguishes applied Design saved/saving/error
  from inputs awaiting Apply. Raw change notifications must be reactive; receiver
  ticks are not an input-state subscription. Preserve literal text/arrays and the
  sole InputRetentionStore; add no second value owner.
- Treat unfinished-input refusal as an actionable precondition, not a failed
  storage operation or autosave pause. Real quota/conflict/storage failures retain
  their distinct recoverable errors and acknowledgements.
- Copy/export use a consistent explicit applied-input boundary. Check relevant
  raw and interaction ownership before and after deferred reads and immediately
  before effect. A task's own intentional dialog input must not self-block it.
  Preserve newer dialog text and accepted durable results.
- Common controls stay in the same place. Save and File operations act on the
  actual mode subject: Design/Survey use the actual owning design and collections;
  Layout uses the session/immutable target/separate observations. Hidden retained
  design input cannot silently redefine Layout's subject.
- Freeze the exact Layout Save choice through independent votes: acknowledge
  immediately saved session data with explicit pending-Apply behavior, or route
  current session metadata through its existing version-checked rename owner.
  Do not create another controller, change target bytes, silently collect a label
  or save the hidden Design. Decide which redundant rename/Apply control can then
  be removed while preserving the user choices.
- Align common File copy/rename/import/export/report labels and actions with
  their actual subject. Supported import requires explicit association and strict
  admission before mutation. New resume/raw recovery contract remains separately
  required; exporting applied data is not raw UI-text recovery.

## Owners and verification

Initial reads: UnifiedWorkspace.tsx, UnifiedWorkspaceEntry.tsx,
useWorkspaceController.ts; then inputRetention/WorkspaceModePanels only for exact
notification/admission/session-name ownership questions. Root assigns disjoint
controller/store/frame/panel paths after interfaces freeze. No Core/physics/schema
writer overlaps copy/import/metadata until the resulting contract is accepted.

Exercise fresh/malformed/valid unapplied text, refused Save, Discard, actual
save acknowledgement and genuine quota/conflict recovery; deferred reads with
newer input; duplicate copy/export and stale same-ID reopen; original/new dialog
text; active Layout with dirty retained Design and pending session name/label.
Assert current-subject output identities, exact geometry/history/caret/selection,
all collection evidence and immutable target bytes/hash. Keep ordinary keyboard
operation and narrow/short working areas. Then complete an actual empty→configured
design→Survey/Layout→copy/export→import/reopen journey and management/resume cases.

Preserve wave4 proofs within their scopes. Freeze source/fixtures for new export/
browser/Edge and independent review; repeat only invalidated gates. Full final
proof, two complete requirement reviews, CI and main-only publication remain open.

## Frozen implementation interfaces and leases

Complexity high for UI ownership and deferred admission; storage schemas and
ordinary admitted Save semantics remain unchanged. Subagents are useful for the
disjoint retention store and Layout panel, followed by independent review.

Both independent Save votes select B: interface 4.40 versus 4.20; state 4.65 versus
4.55. Common Layout Save submits the panel's existing name through rename/CAS.
An unchanged name performs a guarded stored-session acknowledgement. Remove
Apply session name and the duplicate panel export. Observation and copy labels
remain separate intentions, preserved by Save. No open session disables Save.

- Retention worker owns only inputRetention.tsx and inputRetention.test.ts. Add
  stable getRevision/subscribeChanges. One revision per admitted value, baseline,
  clean or reset mutation, after the complete mutation. No increments for refused
  setters, focus/caret, subscription or no-op value/clean operations. Retain all
  source/scope-generation and literal-value contracts.
- Panel worker owns only WorkspaceModePanels.tsx. Export WorkspaceLayoutPanelHandle
  with save():Promise<boolean> and showDetails(section:"name"|"copy"):void. The
  panel retains its sole nameRef, submission and input epochs. Controller adds
  acknowledgeLayoutSession(extra?:()=>boolean), renameLayout(name,extra?:()=>boolean),
  and an optional changed third argument to setPendingInteractionInput. Input
  event handlers pass changed=true; reconciliation effects do not. A newer name
  entered during an admitted rename is retained, not a cancellation of that
  already admitted name. Stale source/mode/session callbacks refuse.
- Root owns controller, common frame, entry, tests and docs. Add reactive pending
  membership/epochs with stable owner-bound callbacks; source-aware status;
  onSaveCurrentSubject and a tools reveal request in the common frame. Layout
  File names/copies reveal the existing inline owner; exports use its actual
  session. Design/Survey File actions retain complete design+collection outputs.
- Design copy/export ignore their own file-dialog text but reject all other
  pending Design/Survey inputs before and after reads and at commit. Capture
  retained-input revision and relevant interaction epochs to reject A→B→A. Do
  not retire jobs on focus or receiver ticks. Unapplied Save is a notice before
  the storage lane; real storage/conflict errors keep their recovery state.
- Layout acknowledgement compares ID, revision, exact target bytes/hash and
  saved session contents after the deferred read. It preserves retained Design
  raw text/history, revalidates ownership, and advances only acknowledged shared
  receipts. Session rename remains revision checked and publishes committed
  receipts even if a later mode change retires feedback. Layout copy/export
  refuse a pending session name, preserve uncollected labels, and ignore hidden
  Design inputs.

No canonical writes or modeling transfer. Root reserves static19018/Edge9230.
Focused store/controller/panel checks and actual default-App browser cases precede
fresh visible Edge capture and independent review. Every result remains scoped.

## Implementation checkpoint

Shared status now subscribes to the single retention store and pending intentions.
Design input refusal stays outside storage and resolves when its exact blocking
input is finished; genuine failures keep their recovery state. Current-subject
Save and File menu are wired to the panel name owner and immutable session.
Deferred File jobs bind raw revision, relevant intent epochs, actual applied
editor revision/bytes and source/mode ownership. Their own dialog text is exempt.
Independent source review corrected retired-feedback publication, canceled-read
error classification and a synchronous Layout Copy/export admission gap.

Returned retention packet: 25 focused cases passed. Actual-controller packet:
9 cases passed with real commands, retained synthetic hook slots, boundary quota
injection and export spy. These do not prove mounted React, populated observations,
physical receiver or native behavior. Full mobile suite and TypeScript passed
before adding the new controller suite to the package script; its final aggregate
check remains required. Actual browser suite now discovers 27 cases, including
two new complete File/status journeys; their execution and visible Edge proof
remain pending until the next source freeze.

Stopping point for this wave is independently reviewed source, executed browser
and visible Edge witnesses on one matching bundle. This is not whole-goal closure:
recorded references, complete import/reopen/management/resume and final publication
are still required. Existing wave4 evidence remains unchanged and preserved.

### Follow-up correction after R2

R2 completed validate and 27 actual browser cases; source remained unchanged.
Independent review then identified and an extra dedicated default-App browser
reproduced null-to-saved session name transfer: unfinished New Layout name A
survives opening existing same-field B, then common Save renames B to A. Preserve
the exact reproducer and R2 archive; R2 is not acceptance for this ownership case.

Before R3 writes, the correction is fixed: guard destination-session identity
changes, including null→B, against pending Layout name/label/copy intentions at
initial request, after deferred reads and final presentation. Hidden Design raw
input remains preserved. Only the private admitted Freeze handoff may bypass its
own new-session name intent, retaining tested newer-name behavior; add no public
bypass. Root owns controller/browser/docs; returned test worker owns exclusively
workspaceFileCommands.test.ts for null→B and Export→Copy callback regressions.
Root also owns the returned Layout panel path to add explicit Discard new session
name using its existing name owner, making refusal recoverable without guessing
the default. No new text store or confirmation step is introduced.
Then typecheck, focused tests, all browser cases and matched visible Edge review.
Stable File-menu captures must wait for modal opacity=1; prior helper failures and
mid-fade figures remain historical evidence, not application failures.

### Independent R3 scoped review correction

R3 passed30 actual browser cases,16 controller fixtures and matched Edge refusal/
recovery/menu figures. Independent review found an initial stale Export callback
can enter an ordinary Design pre-save before the export checks interaction owner.
Root will check captured ownership immediately before any File-job/pre-save side
effect. Add a stale Design Export invoked in Layout witness with zero writes/output.
Frame status also needs the visible File rename/copy intention, while keeping its
own dialog text exempt from copy admission. Root owns controller/frame/entry/web
tests/docs; test worker owns only workspaceFileCommands.test.ts. Refreeze before
export and repeat the changed-path proofs. These are acceptance corrections, not
whole-goal closure or reasons to alter immutable target/evidence contracts.

## Accepted scoped stopping point

R4 closes the independent File/status vetoes. Mobile TypeScript and18 actual
controller-command fixtures pass. All30 actual default-App browser cases pass
24.6s across three widths, including pending File rename/copy status and cancel.
Visible Windows Edge verifies the exact exported/served bundle, readable pending
intentions and retained Layout identity. Source/render reviewers find no remaining
scoped veto. Source/build/test/helper failures and older packets are preserved.

This checkpoint is isolated and unpublished. The earlier R2 aggregate passed
before subsequent corrections; final current-source aggregate/full proof and two
complete whole-goal reviews still remain. Next implementation is the reviewed
recorded-reference contract, followed by complete management/import/reopen/resume
and report journeys. Hook live-loading proof, CI/main-only publication and the
explicit held-modeling handoff retain their separate gates. No additional human
question or permission is needed. Physical receiver and field accuracy are not
qualified by these software fixtures.
