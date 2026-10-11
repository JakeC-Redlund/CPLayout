# Unified workspace integration wave 2

Planning checkpoint before source edits. This wave advances P2 of the full
[refocus tracker](unified-workspace-refocus-2026-10-10.md); it does not narrow the
objective to a renderer or storage library. Previous goal turn: progress, because
source contracts/governance changed and source-bound aggregate/targeted validation
completed. Current checkout still contains that first-wave source, not a unified UI.

Complexity xhigh; coordinator effort xhigh. Subagent decision required by the
owner. Three disjoint high-effort scopes: renderer, durable storage/bundle and
independent controller-preservation review. Coordinator owns application/controller
wiring, package exports, plan/status, Git, aggregate/export/browser resources.

## Preserved inputs and execution boundary

Use the isolated detached checkout `unified-workspace-20261010` at `83c257a`.
Its inherited seven repairs and new first-wave files are pre-existing owned work.
Keep original HUMAN/PUB source, historical packets, other dirty worktrees and the
external modeling handoff untouched. Before integration verify source fingerprints
against the foundation checkpoint; observe actual process handles before waiting or
restarting. No timer transfers ownership. No native activation or solver change.

## Renderer contract and complete target

`WorkspaceMapSurface` accepts the real document-neutral `WorkspaceMapScene`,
workspace camera-context key, opaque current interaction key, selected entity
address, layer visibility, current settings and typed point/selection callbacks.
It never accepts a manufactured PivotProject or calculation result. There is one
mounted logical map/camera owner. Scene/document revisions and mode changes do not
fit/reset camera. A changed field/CRS context is explicit; Fit remains user intent.

The common surface owns pan/zoom/fit, coordinate readout, selection/hit testing and
gesture retirement. Its renderer depends on supported projection/platform/failure,
never Design/Survey/Layout. Preserve existing free imagery/style/attribution and
local XY fallback behavior; SVG-only wiring cannot silently retire existing web
imagery capability. New generic web/SVG renderers must not wrap complete legacy
map components with separate owners. Native compilation is not runtime proof.

The interaction key changes on mode/context transitions. A pointer started under
an older key cannot mutate geometry after its release. Drawing vertices are owned
by the actual domain/controller; the renderer owns no competing drawing document.
Pending digitized/Survey shapes, current receiver, frozen target and saved
observations remain distinct scene layers. Nominal machine drawings may derive
only from supplied real configuration, with missing inputs remaining absent.

Expected exclusive renderer paths: new `WorkspaceMapSurface` platform modules,
`workspaceMapSurfaceTypes`, generic scene-render helpers and their focused tests.
Existing Browser/SVG primitives may be extracted within map-adapters with exact
behavior review; do not alter app, core/store schemas or package indexes/scripts.

## Durable Survey/store contract

Implement the selected explicit `cplayout-workspace-v4` upgrade and top-level
`surveyCollections` strings. Retain exact predecessor v3 bytes separately from
existing v1/v2/layout upgrade sources; preserve record IDs/document strings,
revisions and tombstones. V3 readers must refuse v4. Unsupported native commands
must refuse before database mutation.

New timed commands follow existing strict WorkspaceCommand style: upgrade to v4,
create collection, append capture, set/clear/remove-last membership, apply recorded
collection, archive collection, copy design with collections, import complete
bundle. Commands retain expected workspace, design and collection revisions and
actual owner identity. Creation cannot smuggle historical records through a new-live
capture path. Point capture and collection membership commit together; shape capture
does not change canonical geometry until explicit Apply.

The optional commit predicate is evaluated under the browser writer lock and again
immediately before atomic `setItem`, after validation/serialization. Normal accepted
save semantics remain unchanged when no receiver predicate is supplied. Capture
revalidates active document/mode generations, connection/session/observation ID,
resolved projection and maximum two-second freshness at commit. Historical Apply
validates stored geometry/evidence/ownership and does not require a live receiver.

Pure application helpers operate on real Draft/Project/Field documents. No complete
project sentinel is used to reuse a reducer. Preserve aligned geometry evidence,
point-role behavior, selected-machine promotion, valid shape topology and distinct
closing-observation rules. Immutable ledger/application history survives Clear and
Undo; only active membership or explicitly applied geometry changes.

Implement strict ownership/reference/deletion/copy/import graph rules and evidence
scanning. A complete `cplayout-design-workspace-bundle-v1` hashes/inventories the
exact owning design and every associated collection, including pending and archived
records plus source provenance. Default complete export uses it; design-only exchange
is named explicitly. Old archive readers refuse the new format. Bad hashes, missing
files, foreign owner/CRS and conflicting evidence fail before any creation.

Expected exclusive storage paths: project-store workspace document/commands/store/
versioned repository/types plus new bundle and focused tests; native refusal;
new core `surveyCollectionApplication` helper/tests only. Do not alter app hooks,
existing core document versions, scene files, indexes or package scripts.

## Single application controller

The coordinator migrates actual reducers, histories, raw form state, save receipt
and generation guards into one `useUnifiedWorkspaceController`/adapter set.
Document identity and interaction identity are separate. Same-ID reload retires
old content callbacks without resetting the field camera. Mode changes never save,
complete, convert, retire a document, reconnect, clear input/history or change field.

Existing panels become mode-specific content without root frames/maps/context/File/
receiver owners. One `UnifiedWorkspace` mounts common context, mode toggle, camera,
layers, receiver, File, save state and command surfaces. Catalog/import/session
selection remain supporting dialogs or panels, not extra working maps. Empty and
incomplete designs stay truthful. Survey actually collects against supported kinds;
Layout operates on frozen targets and separately saved observations.

Stage API/controller source without exposing partial legacy wrappers as completion.
Root integration must ultimately remove all competing user-facing whole-editor
frames and alternate map instances. Existing raw-input hashes, stale callbacks,
receipt reconciliation, camera intent and archive provenance are migration fixtures.

## Tracking, checks and stopping points

### Controller migration continuation, 2026-10-11 UTC

The independent controller-preservation review selected extraction with the existing
typed reducers (weighted 4.25); a shared frame retaining separate controllers scored
3.35 and failed the single-owner requirement. Full replacement scored 2.50 with a
preservation risk. These scores are design judgments, not runtime measurements.

Coordinator next writes: `workspaceDocumentAdapters`, `workspaceControllerState`
and meaningful transition tests, followed by the shared controller hook and frame.
They retain the actual Draft/Project/Field reducers, use an explicit accepted-domain
transaction for recorded Survey changes and keep Layout association separate from
editable-document identity. Ordinary admitted saves remain ordered after their UI
owner retires. Survey transactions require current interaction/live evidence at
admission and final commit. Mode switches preserve editor/history/input/selection,
the camera context and live receiver; only interaction ownership advances.

The completed read-only reviewer now receives the bounded input-retention slice:
`inputRetention.tsx`, `DesignDraftInputs.tsx` and focused tests only. It adds an
optional controller-supplied store and retains raw section text, errors and discard
ownership through unmount/remount. It must preserve standalone callers and retire
stale setters on explicit document replacement. No App/controller/map/store-schema
or shared execution ownership is transferred. Other workers' scopes remain unchanged.

Current host preflight: H: is active and healthy; Windows/WSL cross-system read/write
and fresh canonical cwd/Git access passed without remount. Canonical remained clean
at `83c257a`. This is drive evidence, not application acceptance.

Renderer source checkpoint: its worker reports focused rendering/camera tests and
strict module checks passed; root integration and browser identity proof remain
pending. That worker next owns only a new controlled `FieldDesignInputs.tsx` plus
focused tests. Extract the existing machine and field-design choices with a supplied
Field editor/actions/retention store and explicit calculation/comparison inputs.
No repository, domain editor, map, receiver, save session or root frame may be owned
by that panel. Existing full workspace and root controller remain coordinator-owned.

Storage worker's ten-path packet is frozen and reports 143 focused checks passed.
Its next scope is read-only controller/transaction review: no implementation writes
or shared resources. In particular review callback retirement after committed writes,
ordinary-save/capture ordering, receipt reconciliation, purpose/ownership binding and
independent/target-only states. Root incorporates demonstrated findings before wiring.
Reference-feature Apply requires a separate source-backed decision: current metadata
asserts digitized origin. Captured references remain durable pending records; no
false digitized metadata is allowed and full interface acceptance remains open.

Second independent neutral-reference decision review uses the existing full-objective
weights: continuity .35, preservation .30, maintainability .20, verified capability
.10, cost .05. Compare an honest versioned recorded-Survey metadata union with separate
Survey-reference entities that participate completely in target freezing and bundles.
An overlay-only solution or false digitized provenance fails the objective regardless
of score. This review is read-only; version allocations require a later documented
contract wave and must preserve modeling's frozen Field v5 allocation.

| Item | State | Exit evidence |
| --- | --- | --- |
| Current source/resource preflight | In progress | Exact fingerprint, handles, scopes and original-work preservation |
| Generic common renderer | Pending | Source/type/gesture tests then exact-build one-map rendered mode cycles |
| Workspace-v4 and guarded writes | Pending | Exact upgrade bytes, legacy refusal, lock-delayed freshness/mode/quota tests |
| Complete bundle/reference graph | Pending | Lossless export/import/copy/archive/reopen and refusal-before-mutation |
| Unified controller/panels | Pending | Actual mounted map/control identity; dirty input/history/selection/camera preservation |
| Aggregate/visual acceptance | Pending | Frozen source, validate/skills/context/audit/diff plus full relevant browser/Edge workflows |

### Source checkpoint and next stopping point

2026-10-11 UTC private evidence:
`/home/cyber/cplayout-refocus-20261010/wave2-controller-checkpoint-20261011.json`.
It binds 17 current files before/after 13 controller, 29 queue, 18 retention and nine
Field-input checks plus mobile TypeScript and diff checking. All passed; inspected
source was unchanged. Worker storage/renderer packets remain source-scoped evidence.

Independent review closed demonstrated collection-selection, same-ID target,
Save→capture receipt ordering, capture→stale-Save admission, strict Project-import,
upgrade prerequisite and stale dispatch/open callback defects. Atomic begin+append
now publishes one user gesture/Undo entry, with failure preserving the prior draft
and its permanent CRS lock. Camera cache namespace stays field/CRS-based while epoch
tickets and interaction ownership retire callbacks; no generation is used as a new
camera-cache identity on mode changes.

The common `UnifiedWorkspace` frame is written but is not mounted by App. It supplies
one map slot, shared controls and controlled retained mode panels; it does not wrap
legacy working editors. This is a deliberate source checkpoint before the next
large App replacement, **not** an accepted stopping point for the full goal.

Next critical path: make this frame/controller the actual App composition, migrate
all drawing/calculation/advisory/customer/machine/file choices, bind compound Survey
Undo and same-field Layout/catalog receipts through the shared writer, then finish
the recorded-reference contract and hook-runtime proof. Run final aggregate and
actual served-build browser/visible Edge reviews only on that integrated source.
Do not repeat old separate-screen acceptance or treat unused common-frame source as
proof of a single working interface. Full goal and publication remain active.

Focused leaf tests are allowed; aggregate/browser/export execution remains serialized
at the coordinator. Root freezes code and test inputs before aggregate execution.
No first-wave success is reused to claim changed wiring or persistence works.
Independent review resolves demonstrated defects and records weighted/veto decisions;
no further human input is required. Keep the full goal active until actual UI,
durability, hook runtime and publication requirements are verified.
