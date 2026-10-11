# Recorded-reference Survey implementation plan

Status: Core and Store retained-history implementations are frozen; root integration,
independent review and actual browser/Edge verification remain open. The full objective remains active. Root preserves the
accepted wave5-r4b File/status source and serial integration/build ownership. Complexity xhigh;
select disjoint writers only after this contract is independently frozen.

## Verified problem and selected direction

`surveyCollectionApplication.ts` explicitly refuses reference_* Apply, and
`WorkspaceModePanels.tsx` correctly disables it. Existing project metadata capture
requires source=map_digitized; reference features must have matching metadata.
Receiver observations are already durably recorded. Bypassing these guards would
misstate provenance. Keep that refusal until the honest capability exists.

Two preceding independent decisions selected a versioned recorded-reference union;
the current source review confirms this gap. Extend project-drawing-metadata-v2
and field-drawing-metadata-v2 with the entire existing v1 digitized-record branch
unchanged plus a strict recorded-reference branch. Field metadata currently lives
in fieldDesignDocument.ts, not a separate fieldDrawingMetadata.ts.

## Contract to freeze before writers

The new branch is restricted to reference_point/reference_line/reference_area with
matching Point/LineString/Polygon. Current meaning includes actual reference kind,
geometry type, name and optional notes. It contains no invented agricultural
purpose, asset status, exclusion/placement effects, current WGS84/elevation metadata
or digitization times. Exact snapshots retain genuine optional coordinates and
height/evidence fields admitted by the unchanged point/evidence schemas. Existing GNSS producers/evidence schemas and fixed-GGA policy remain unchanged.

Historical capture retains source collection ID, owner at application, its source
revision, the actual application receipt and exact ordered applied SurveyPoint
snapshots. The existing receipt fields are id, appliedAt, designRevision, target,
sourcePointIds and geometryHash. Bind receipt membership/order and SHA256 geometry
against the snapshots. sourceCollectionRevision means the pre-Apply revision R; the returned accepted
collection is R+1. The existing receipt.designRevision already means accepted
design revision D+1 (workspaceCommands passes the increment); preserve that meaning. Initially applied
canonical geometry and vertex evidence must match exactly. Historical observations
are immutable evidence, not another editable geometry. Validation proves consistency,
not live capture or transaction execution.

Manual geometry edits retain original snapshots/receipt, explicitly mark edited
binding and invalidate changed vertex evidence under the existing rules. Renaming
and notes change current meaning only. Deleting geometry removes its attached
metadata while the workspace observation ledger/history remains preserved.

Historical collection/owner IDs are origins, not automatically navigable current
attachments. Copy/import changes current collection/design identities but preserves
origin. Add an optional current attachment {collectionId,applicationId}, separate from
immutable origin. Validate it against the current owner and exact receipt/source
snapshots. Copy/import rewrites attachment locators only, never origin. Current
clones reset revision0 but preserve receipts, so do not compare origin revisions
with clone state or select the first identical alias. Standalone exchange retires
unresolved current attachment and manufactures no missing collection.

## Versions and preservation

Propose pivot-project-v4, design-draft-v5 and field-design-v6 for metadata v2.
Older labelled envelopes must also reject the new capability; emitting a new label
alone does not prove refusal. Preserve old document/golden strings and reader rules.
Draft completion and explicit Project→Field conversion must retain metadata branch
and version rather than hardcode v1. Review every mutation helper's current
classification/capture assumptions before adding the union.

The frozen external modeling r3 reserves field-design-v5 for physicsScenarios.
Its manifest is preserved; no packet integration, shared write or transfer is
authorized by this plan. This wave continues refusing unsupported physics data.
Do not add held physics under this same frozen ref-only v6 contract. A later
combined capability gets a subsequent version unless a separately reviewed
compatibility contract is established first; preserve v5 rules and the held packet.

Keep survey-collection-v1 unchanged. Retain workspace-v4, bundle-v1, archive-v1,
target-v1 and session-v1 only after nested-reader old/new refusal is demonstrated.
Field-map records carry hierarchy/name; CRS is declared on the catalog project
and actual payload. Require explicit destination association and exact declared
CRS on copy/import, with no relabelling/reprojection. Frozen target bytes/hash
never change on association or source edits; observations remain separate.

## Bounded ownership and execution sequence

1. Independent Core/storage review finalizes record discriminant, revision meaning,
   factory API, mutation/receipt binding and version refusal before any writes.
2. Core writer owns recorded-reference validation, drawingMetadata/types and
   project/draft/field documents, Survey application, mutation/conversion helpers
   and focused tests. Return a stable exported interface before dependent work.
3. Store/archive writer owns workspaceCommands/workspaceDocument/bundle/archive
   admission and tests. Geometry, metadata and collection receipt commit together
   with both revision checks; failure changes neither. Native unsupported
   operations still refuse before mutation; no SQL/native activation is added.
4. Controller/UI writer supplies real name/notes, preserves failed/stale entries,
   removes reference Apply refusal only after domain admission exists, and displays
   recorded versus edited provenance. One map/controller/receiver remains mounted.
5. Root serializes shared source integration, export/browser/Edge/aggregate,
   preserves every failed iteration and audits the complete objective afterward.

The modeling overlap inventory includes field document/editor/archive, workspace
commands/document/web store/repository types and hooks/catalog archive admission.
No other agent writes those paths concurrently.

## Meaningful verification

Test Point/Line/Polygon references in actual Draft/Project/Field workflows, including
disconnected historical Apply and distinct observations at coincident positions.
Reject changed GGA/XY/order/IDs, owner/CRS, receipt/hash and stale revisions without
partial mutation. Exercise manual move/insert/remove/rename, Undo/Redo, completion,
conversion, copy/import/standalone ZIP and deletion with honest immutable provenance.
Use frozen legacy readers rather than aliases to updated schemas for refusal
tests, including falsely old-labelled capability data and exact old golden bytes.
Freeze/reopen/export Layout with literal target/hash preservation after source edits.
After source freeze run focused suites/compiler, actual browser/Edge journeys,
then the complete aggregate/audit/CI/publication gates. Physical transport, native
persistence and field accuracy remain distinct from this software contract.

## Frozen interface and initialization review — 2026-10-11

Use capture.source=recorded_survey to discriminate the new branch from unchanged
map_digitized records. Export a type guard. New record has map-feature target,
neutral meaning {featureKind,geometryType,name,notes?}, immutable origin/snapshots,
binding=recorded|edited and optional current attachment. Existing classification,
captureId, vertexRecordedAt, Field .extend assumptions and hardcoded v1 conversion
paths require audited branch handling.

Proposed factory (new export, not an existing API):

```ts
proposeRecordedReferenceApplication(collection: SurveyCollection, input: {
  expectedCollectionRevision: number; expectedOwner: SurveyCollectionOwner;
  acceptedDesignRevision: number; applicationId: string; targetId: string;
  name: string; notes?: string; now: string;
}): {
  feature: ProjectMapFeature; record: RecordedReferenceMetadataRecord;
  collection: SurveyCollection; receipt: SurveyApplicationReceipt;
}
```

Derive geometry/snapshots exclusively from exact active observation IDs. Current
collection validation does not recompute receipt.geometryHash; this new factory
and metadata validation must do so. Transaction execution is the store's distinct
responsibility; this pure result is only a checked proposal.

Avoid initialization cycles: surveyCollection derives point/feature schemas from
PivotProjectSchema in projectDocument.ts (projectSchema.ts does not exist), which imports drawingMetadata. Metadata must not import that
top-level collection schema. Extract unchanged leaf schemas (including point and
receipt/owner shapes as required) with a stable dependency graph before union
wiring, preserving all existing refinements. Put application proposals above
those leaf schemas; type-only imports do not create runtime edges. Validate the
actual new dependency closure in tests, not only erased TypeScript types.

The independent review and root reads confirmed accepted-design revision, cloned
revision0/history behavior, reserved Field5 and nested target.fieldDocument. Old
reader tests must freeze their pre-wave dependency closure so an alias to new
schemas cannot falsely prove refusal. The exact writer path split and leaf exports
are the next implementation handoff; all code remains at the frozen UI checkpoint.

## Current preflight and compatibility fixture plan

Previous goal turn: progress. Wave5-r4b source was rehashed:779 files unchanged,
fingerprint f094c629581e745e615361097a2a3dbd421d2f972360ef3bf21489632831444e.
Canonical remains untouched at83c257a; root retains shared resources. Two bounded
read-only reviews check Core and storage before any schema writer starts.

Before mutating schemas, root owns tools/buildRecordedReferenceLegacyReader.cjs
and tests/fixtures/recorded-reference-legacy-reader.{cjs,json}. Bundle the actual
pre-wave document/workspace/bundle/archive/target/session reader dependency closure
with installed esbuild0.28.2, externalizing only installed library packages whose
exact versions are recorded. Include source hashes, compilation settings, exported
surface and output hash; refuse regeneration from a checkout that differs from
the explicit frozen source packet. The compiled fixture contains no live repository
imports. Tests must verify its hash and exercise real old/new and falsely old-labelled
documents, not aliases to updated schemas. This fixture creates no application
dependency or runtime activation. Its generation and smoke checks precede writers.

Core helper/API freeze also covers retirement/remapping of current attachments.
Pure completion and Project→Field create a new owner without cloned collections;
detach locators while preserving immutable origin/snapshots. Source documents keep
their attachments. Complete copy/import remaps unique current collection locators.
Storage must atomically stage document and collections before complete graph
validation, with no public validation bypass. New Apply command reference name/notes
are required only for reference purposes, and destination catalog CRS must match.
Core versions Project4/Draft5/Field6 remain selected; held physics Field5 stays refused.

## Writer interface freeze and ownership

Both independent reviews found no architecture contradiction. The record shape is
target(map_feature), meaning(featureKind/geometryType/name/notes?), binding(recorded
or edited), optional attachment(collectionId/applicationId), and capture with
source=recorded_survey and origin(collectionId/owner/sourceCollectionRevision/
purpose/receipt/observations). Origin purpose is the exact pinned reference purpose,
so later edited meaning cannot change how historical geometry/hash is interpreted.

Core exports: DigitizedDrawingMetadataRecordSchema (unchanged object), union
DrawingMetadataRecordSchema, RecordedReferenceMetadataRecord,
isRecordedReferenceMetadataRecord, validateRecordedReferenceMetadata(record,
{feature,projectCrs}), assertRecordedReferenceHistory(beforeRecords,afterRecords),
remapRecordedReferenceAttachment(record,mappings[{sourceCollectionId,collectionId}]),
retireRecordedReferenceAttachment(record). The application layer exports the
proposed factory plus assertRecordedReferenceAttachment(record,validatedCollection,
expectedOwner) and assertRecordedReferenceAttachments(records,validatedCollections,
expectedOwner). Assertions prove consistency only, not receiver/transaction execution.
Remap is unique/exhaustive for present attachments; no match/ambiguity refuses.

The Core worker exclusively owns new surveyPointSchema.ts/surveyCollectionSchemas.ts;
drawingMetadata.ts, projectDocument.ts, surveyCollection.ts,
surveyCollectionApplication.ts, designDraft.ts/designDraftEditor.ts,
fieldDesignDocument.ts/fieldDesignEditor.ts, drawingProjectMutation.ts,
classifiedProjectDrawing.ts and projectReducer.ts, plus their focused tests and
new recordedReference.test.ts. Root owns Core index/package registration, UI,
fixtures/tools, plans and all shared/Git resources. types.ts receives the propagated
alias initially; edit only if a demonstrated type gap justifies a new lease. No
Core worker Store/UI/geometry/native writes.

Storage begins only after the Core API packet is stable. It owns workspaceCommands,
workspaceDocument, designWorkspaceBundle, a small attachment helper if required,
sqliteWorkspaceStore refusal guard and focused Store tests. Stage complete data
before graph validation, enforce destination parent CRS, and compare immutable
origins for every surviving canonical feature; dropping/retyping metadata while
the target survives is not geometry deletion. Apply reference:{name,notes?} is
mandatory for references and refused on other purposes. No public skipValidation.

Completion/conversion retire current locators for new owners lacking collections.
Already sealed Layout target bytes/hash are never rewritten: embedded locators
are historical/non-navigable without their owning graph. Nested old readers must
refuse Field6 under target/session v1. Outer versions stay provisional until proof.

Root froze59 actual pre-wave reader source files (161259 compiled bytes); fixture
SHA443a00825cd4d08afc9edb9cb6b050b0f7b9d0aece67d7a6ef04ce56ebfeba03.
Installed library fingerprints and legacy version/Project-byte/workspace smoke
checks pass. Any output/library change invalidates frozen-reader verification.

## UI/controller contract for dependent integration

Root owns controller and WorkspaceModePanels. applySurvey(reference?:{name,notes?})
passes a detached current reference name/notes to the strict command. The Survey
panel remains its sole text owner, with source/collection/name-input epochs. Default
name is the neutral reference kind; optional details allow editing name/notes. These
do not claim agricultural meaning or affect position/evidence. No second map/store
or receiver owner is introduced. Apply remains disabled until the Core/store packet
supports the command; runtime tests must drive the real default App afterward.

Register survey-reference pending intent reactively without putting a second value
copy in controller state. Start/select another collection and document/File handoffs
must preserve unfinished reference details or refuse; an explicit Discard restores
the selected reference's current baseline. Admission captures source/collection
and immutable submitted name/notes. Failure preserves all text; successful A with
newer B input acknowledges A without clearing B. Reopening the same collection is
not another receiver capture. Current stored reference or edited-source badges
must follow the actual metadata branch; never call receiver data map-digitized.

## API packet and dependent Store lease

Core API v1 returned with234 focused passes and Core TypeScript. Independent early
review then found two guards needing correction: bind immutable receipt target ID
to current reference target ID, and refuse duplicate current collection/application
locators. Core retains its two-file/test lease for those guards; API shape stays
frozen. A genuine XY key-order probe also checks hash construction without altering
immutable snapshots. No acceptance is inferred from the initial green fixtures.

The dependent Store writer may now implement against this fixed API shape. Its
exclusive paths are workspaceCommands.ts, workspaceDocument.ts,
designWorkspaceBundle.ts, sqliteWorkspaceStore.ts, optional new
recordedReferenceAttachments.ts, and focused Store tests/new
recordedReferenceWorkspace.test.ts. Root registers Store tests/exports. Existing
archive source edits require a demonstrated gap and an expanded explicit lease.
Do not drop current locators before complete import, exposing a misleading partial
creation. Atomically stage the remapped document and all cloned collections, then
validate the complete graph. Require real catalogue parent CRS before creating a
destination. Keep native refusal before any SQL access; outer version acceptance
is conditional on real frozen-reader fixtures.

## Detached-history admission decision — historical veto and reviewed refreeze

Independent Store counterprobe demonstrated a P1 defect after35 focused passes:
standalone import retires locators and creates no collection; Delete→Save succeeds;
Undo restores its exact origin, but Save refuses because no owner ledger can admit
the restored record. Collection-free completion/conversion share this boundary.
Do not weaken forged-origin rejection or synthesize Survey collections.

Two candidates need independent weighted review before changing the contract:

1. Add optional retainedReferenceOrigins to the still-unpublished metadata-v2
   containers. Seed authorized immutable origins at initial owner creation/Apply,
   before deletion, retaining exact origins through saves/copy/conversion. Permit
   restored records only against prior retained origins or exact current ledger.
   Ordinary Save cannot invent, alter or discard retained authority; Undo does not
   change geometry/history meaning. Validate combined historical evidence. All
   metadata-v1 data/goldens remain unchanged; revise the unshipped ref-only v2/
   Project4/Draft5/Field6 freeze explicitly, with real old-reader refusal proofs.
2. Add a workspace-v5 origin ledger via an explicit upgrade retaining exact v4
   bytes, with current/archived owner identities and authorised immutable origins.
   Preserve standalone documents and sealed target bytes; integrate new workspace
   version with controllers/archives/native refusal before mutation.

Both require initial admission, forged-origin, detached deletion/Undo/Save,
complete copy/import/completion/conversion and restart/export/reopen witnesses.
The document option must not rely on after-deletion history insertion that is
missing from pre-delete Undo snapshots. The workspace option must not relabel old
workspace-v4 or misuse retained upgrade sources as a save journal. No writer has
permission to add either history mechanism until the reviewed decision is recorded.

### Selected history contract (unpublished refreeze)

Both independent votes select A=4.65. B scored4.00 assuming complete archive
transfer and3.45 when considering its otherwise missing standalone portability.
This explicitly refreezes the unshipped metadata-v2/Project4/Draft5/Field6 contract;
no published version, metadata-v1/golden, sealed target or physics capability changes.

Export strict RecordedReferenceOriginSchema/type. Optional retainedReferenceOrigins
is origins only, no navigable locators. Validate each full origin/hash, one immutable
origin per historical owner+target, no duplicate retained entries and combined
receiver conflicts with active/current carriers. Exact aliases across records/history
remain legal; observation snapshots and origin meaning never rewrite.

Explicit editable/owner creation and Apply seed validated origins before snapshots.
Parsing never silently seeds or changes original input strings. Ordinary Save must
retain previously authorised origins exactly; additions need an exact owned ledger
receipt. Restore requires a retained origin or the exact owner-ledger application.
No fabricated collections, blanket detached restoration or after-delete-only seeding.

Core producer constructors and Undo/Redo merge accumulated retained origins into
restored metadata before validation, preserving reversible geometry/records and
monotonic immutable authority. Root's shared workspace history adapter must use the
same merge contract. Copy/import/completion/conversion carry histories exactly;
completion/Field shared-validation reconstruction sites must not drop the property.
History-only documents retain new version labels; frozen old readers refuse them.

Core owns its prior paths for new history schema/seed/merge helpers and editor/
conversion/application wiring. Store owns its prior paths for seeded admission,
history retention/restoration/forgery guards and tests. Root owns the shared history
adapter/UI/test registration/exports/proofs. Contracts for seed/merge helpers must
be returned explicitly before dependent Store/root writes. Required regressions
include detached standalone/conversion/completion Delete→Save→Undo→Save, Apply→Undo
to earlier snapshots, deletion export/reimport/reopen restore, forged/altered/dropped
authority, quota failure, original-source and sealed-target byte preservation.

## Resumption and verification sequence — 2026-10-11

The preceding turn made verified progress: Windows H: and WSL /mnt/h are healthy,
cross-platform read/write and canonical Git access passed. No remount or source
change was needed. Shared resources were held while that check ran; implementation
resumes only in the isolated worktree at detached83c257a.

Core v4 returned251 focused passes and TypeScript, with metadata SHA
e6b76bf3c8586cd21b09b74e7d90ce2c29053edd681efdee5e7bc054ad7dac0b.
Store returned144 focused passes and TypeScript; its seven-file packet hash is
ad001707d76f69fc930a0b06652e7b1f26d6d29adaa08e54e9d7681e9f23eac6.
These are writer receipts, not independent or whole-workflow acceptance. Both
writers have stopped. The frozen old reader remains443a0082…eba03.

Root's planned verification is:

1. Rehash the frozen packets and obtain independent Core/history and Store/admission
   reviews, including unknown-origin refusal when the previous document has no
   authority, legacy passthrough, and the five detached restoration routes.
2. Exercise the actual shared document adapter with detached documents and earlier
   history snapshots. Extend actual default-App browser assertions to retain exact
   origins across Apply→Undo→Save→Redo→Save in all three owner kinds and shapes;
   preserve the existing geometry, source, ledger, one-map and reopen assertions.
3. Freeze the integrated source and tests, run mobile/type/context/skill checks,
   then root's serialized fresh export and57-case browser run on owned19018. Match
   export, served and visible Windows Edge bundle hashes before reviewing desktop,
   narrow and short-height references. Preserve failures and refreeze after repairs.
4. Record scoped results and continue the complete management/import/resume/report
   and failure journeys. Final aggregate/proof/audit, two complete reviews, CI and
   main-only publication remain required; no modeling transfer is granted.

Exact source bytes remain distinct from the seeded editable representation.
Field's originalProjectDocument is durable; Project/Draft currently have no
separate durable original-import string slot. This pass does not claim such a
slot or silently change the archive/workspace contract to create one. Sealed
target strings and earlier workspace upgrade sources remain literal evidence.

### Independent legacy-history veto before export

The independent Core reviewer demonstrated4 failures in the existing5-case
crsMutationSafety suite: legacy Project Undo returned equal values in a new object
instead of the exact retained snapshot. The new history helper and reducer cloned/
reparsed history even when neither side contained recorded authority. Keep the
existing strict identity assertions and repair the legacy passthrough, while
continuing to reject unknown origins from an empty previous authority set.

Before root exports, Core has a narrow reopened lease for drawingMetadata.ts,
projectReducer.ts and recordedReference.test.ts only. Preserve the frozen v4
receipt as superseded evidence. Require the genuine CRS safety suite, new history
tests and Core TypeScript, then independent reacceptance. No Store/geometry/UI/
fixture edits, weakened existing tests or new runtime activation are selected.

The v5 correction subsequently froze those three paths. Independent reacceptance
passes the unchanged CRS5 cases,32 reference cases,13 separate counterprobes and
the exact frozen-reader verifier. Legacy snapshot identities are preserved and
unknown origins remain refused. Root's19 shared-adapter cases and mobile TypeScript
pass; generated context and skills checks pass after the stale-map repair. Browser,
visible Edge, aggregate and full-goal acceptance still require matching evidence.

## First integrated browser iteration and planned repairs

Wave6-r1 froze1078 files (fingerprintda3710c2…289d). Its57-case actual default-App
run completed with43 passes and14 failures; all source hashes stayed unchanged.
The failures classify as follows before any correction:

- Product regression: ordinary complete-design creation supplies an empty Survey
  mapping. The new Store branch requires workspace-v4 even though no collections
  exist, whereas the accepted previous implementation treated that empty mapping
  as no cloning. Restore that behavior without allowing incomplete mappings for
  nonempty collections; do not silently upgrade the user's workspace.
- Fixture identity error: new Project assertions use entry.id; the real carrier
  is entry.summary.id. Correct both lookups while keeping exact document assertions.
- Capture sequencing: two Polygon runs recorded only two observations, and their
  final receiver position was already recorded. Add actual per-command persistence
  and rendered fresh-position barriers, checking all requested epochs in order;
  this must not fabricate observations, weaken readiness or replace the transport.

Store has a reopened two-file lease: workspaceCommands.ts and
completeWorkflowStorage.test.ts. Verify legacy workspace1/2/3 completion with an
explicit empty mapping, plus refusal of empty/incomplete mappings for existing
Survey collections. Root owns browser fixture corrections and subsequent freeze,
export and rerun. Core v5 remains frozen. Preserve r1 as failed integrated evidence.

The real passed Field LineString fixture produced six visible Windows Edge
figures at desktop/narrow/short sizes, retaining one map through mode changes and
matching bundleSHA102a4c0e…5bc0. A first capture helper incorrectly requested
Draft's Inputs tab on a Field; its failure figure/log/script are preserved. The
correct helper uses the actual Machines tab. These figures show the current
iteration; they do not override the failed full browser run or imply acceptance.

The completion correction is frozen in its two leased files; writer and independent
19-case suites pass, including unchanged legacy versions, exact upgrade sources,
single-commit completion and atomic mapping/conflict/quota refusal. Root fixed the
two Project lookups and requires persisted observations plus the actual rendered
fresh position before each following synthetic capture, retaining exact epoch/
geometry/evidence assertions. No readiness rule or observation is manufactured.

Independent visual review finds no veto in the six r1 figures, while explicitly
noting that short-window notes/Apply appear below the initial viewport. The next
capture must actually scroll to and focus notes and expose Apply within the window;
DOM visible:true alone is insufficient. R2 source/build/browser/Edge proof remains
pending. Root preserves both r1 capture helper failure and failed browser traces.
