# Unified workspace architecture decision

Status: architecture selected; integrated implementation and runtime acceptance are incomplete. Read with [the tracked plan](unified-workspace-refocus-2026-10-10.md). User decisions are delegated; no human questionnaire is required.

## Recorded reference application decision — second wave

Current typed reference metadata admits only digitized origin; receiver reference
collections therefore remain durably pending instead of acquiring false provenance.
This admission gap is directly confirmed in `drawingMetadata.ts`, Field's metadata
bridge, Survey application, frozen target and complete bundle validators.

Two independent reviews used the full-objective weights below. Scores are source-
informed architecture judgments; neither proposed extension is implemented.

| Option | Storage reviewer | Independent preservation reviewer | Mean |
| --- | --- | --- | --- |
| Honest versioned recorded-Survey metadata union in canonical reference features | 4.45 | 4.20 | 4.325 |
| Separate reference entities with complete target/bundle/deletion participation | 4.20 | 3.50 | 3.85 |

Coordinator selects the metadata union for the later bounded contract wave. Retain
the existing digitized branch unchanged; bind actual ordered vertex observations,
coordinates, CRS and immutable evidence, collection/application identity and typed
neutral meaning. Manual changes must invalidate bindings honestly, never relabel them
digitized. Copy/import, standalone archive/bundle and frozen-target validation must
carry the complete evidence. Allocate noncolliding document/metadata capability
versions after checking actual readers and the frozen modeling packet; Field v5
remains reserved. A merely rendered applied ledger or false origin is vetoed regardless
of score. Current reference capture preservation is progress, not completed Apply.

## Verified starting point

On 2026-10-10 both preserved source worktrees match all 78 R53 owned-file hashes and the same 796-file source fingerprint `6a54a063f05bae1f5bfc06932724fba9cb028c3057128b4da52905ea3ee4792f`. The new detached checkout inherits exactly seven audited staged files from the publication worktree at `83c257ace267e2d791b9b874122bc799a93e58fb`; the original files/indexes remain untouched. Hosted proposal is also `83c257a`; hosted main remains `96ba2e9`. No current integrated acceptance or modeling transfer is claimed.

Current App composition independently mounts completed-project, draft, field and Layout surfaces. Their working maps respectively use MapSurface, DesignDraftMapSurface, FieldDiagram and TargetDiagram. Retained Draft/Field Survey is receiver-only. The root receiver owner is already shared. Source references: `apps/mobile/App.tsx:288–296,379–453,2537,2612`; `DesignDraftWorkspace.tsx:444`; `FieldDesignWorkspace.tsx:458`; `LayoutSessionWorkspace.tsx:210`.

## Decision and weighted reviews

Weights: operator continuity .35, preservation .30, maintainability .20, verified capability .10, execution cost .05. Scores are reasoned architectural judgments on 1–5 scales, not measurements of the unimplemented result.

| Option | Interface reviewer | Preservation reviewer | Mean | Decision |
| --- | --- | --- | --- | --- |
| Actual shared map/workspace with typed adapters | 4.35 | 4.15 | 4.25 | Selected |
| Wrapper around independent editors/maps | 2.90 | 2.80 | 2.85 | Vetoed as final outcome: preserves duplication |
| Labels/navigation changes | 2.50 | 2.10 | 2.30 | Vetoed: does not implement shared systems |

The coordinator accepts the selected route. The principal objection is extraction risk, addressed by preserving the actual document reducers, accepted-save semantics and evidence payloads rather than normalizing them into an invented universal document.

## Frozen integration contracts

1. `WorkspaceMode = design | survey | layout` is presentation/capability state. A mode change performs no save, completion, conversion, document replacement, receiver reconnect, camera fit or history/input reset. An interaction generation rejects stale mode-specific gestures/captures; document and save generation remain independent.
2. One workspace controller owns context, open editable document, raw-input store, actual domain history and selection, receipt/conflict state, associated immutable Layout session and root receiver owner. Catalog browsing is not document opening. Context replacement passes preservation guards.
3. One document-neutral projected `WorkspaceMapScene` exposes real entity IDs, geometry, CRS/frame identity and optional overlays. Missing geometry remains missing. No fabricated PivotProject, pivot/machine values or LayoutResult can be used to render a draft, field or target.
4. One mounted `WorkspaceMapSurface` owns viewport/camera/interaction/render lifecycle. Renderer selection depends on platform, projection support and failure, never operator mode. Mode is excluded from camera identity. Common map/context/file/receiver/status controls remain the same instances; only capability and mode-specific panel contents change.
5. Typed command adapters address actual Draft/Project/Field reducers or Layout observations. Layout exposes no target-edit command. Current edit/inspect setting `mappingWorkflowMode: layout` must not be reinterpreted as a saved RTK Layout session.
6. Ordinary accepted saves preserve their existing retirement/order semantics. Receiver append uses a separate transaction owner that revalidates document/mode/connection/observation/projection/freshness under the serialized repository lock before publishing state/history.
7. Capturing a point labelled Pivot does not move a machine. Promotion identifies an explicit machine/infrastructure target. Historical complete Survey shapes can still be applied disconnected; live freshness is admission policy for new captures, not a retroactive test of saved evidence.
8. Exact frozen target bytes/hash remain authoritative. Saved/current observations and receiver display are separate map layers. A different-field session requires a deliberate context transition, not an implicit mode side effect.
9. Toolbar visibility responds to measured container resizing and natural focus while preserving pointer activation, horizontal-only movement, current/connected/visible checks and symmetric cleanup. The R53b ratio-zero resize evidence is retained; its defect is repaired in the shared lifecycle, not accepted as completed.

## Survey durability direction

Existing operational versions `pivot-project-v3`, `design-draft-v4` and `field-design-v4` already carry individual SurveyPoint evidence. Their missing Draft/Field capture behavior requires commands/controllers, not invented new point-schema versions. Existing unfinished receiver collection state is in memory. Digitized drawing workflow cannot store it truthfully because its source is map_digitized and its coordinate evidence is null.

Preserve full point, boundary, obstacle and line procedures and common Save/reopen behavior. Select explicit `survey-collection-v1` entities through a lossless workspace upgrade rather than encoding operational state in notes or abusing digitized provenance. Proposed workspace-v4 contains stable owned collection identity, pinned geometry/purpose/transform, immutable captured-point ledger, ordered active membership and paused/active state. Append persists ledger and membership atomically with live-owner admission. Undo/remove-last changes membership or applied geometry without deleting the historical ledger. Copies/imports freshen collection/document ownership while retaining receiver observation identity/evidence exactly.

A complete design/workspace bundle must carry the owning exact document plus every associated collection; default export cannot silently omit unfinished Survey work. Reference, tombstone, copy/import/export and old-reader refusal contracts must be finalized and tested before storage mutation. Frozen modeling source already reserves field-design-v5 for physicsScenarios; its exact-version requirements are independently inspected. That packet remains held and is not integrated here. The chosen separate workspace collection avoids silently redefining its document version.

The additional storage review verified the frozen Field contract against manifest-r3: SHA-256 `0ac80babaa5a2d0e0238119eb7878adc4682beeb1a6947dc77005eb79bbebbb7`. Its weighted strategies are nested new document versions 4.30, workspace-v4 plus complete bundle 4.45, existing-contract encoding 1.95 (veto). Weights are preservation .40, compatibility .25, maintainability .20, archive completeness .15. The coordinator accepts workspace-v4 with these mandatory conditions:

- Dedicated exact v3 upgrade-source bytes; retained older upgrade sources/identities/strings/tombstones unchanged; frozen v3 reader refuses v4; explicit native refusal before mutation.
- Strict survey-collection-v1 owner kind/payload/catalog/CRS and collection revision; pinned purpose/type; complete immutable captured-point ledger; ordered active IDs; historical application receipts name geometry target, source IDs, accepted design revision and geometry hash without claiming current geometry still matches.
- Capture atomically persists evidence and membership, and point-purpose inserts the same observation into its real design. Revalidate connection/observation/mode/document/projection/freshness under the lock and immediately before commit. History and accepted receipt advance only on successful persistence.
- Apply stored shapes remains available disconnected. Apply/clear/remove-last/Undo preserve immutable observations while changing membership or explicitly applied geometry. Multiple independent purposes retain unfinished work.
- Ordinary accepted saves keep current retirement semantics. The controller serializes saves/captures so older accepted saves settle first and later snapshots include the accepted combined state.
- Strict copy/import/deletion graph rules prevent dangling active owners, evidence rewrite or dropped observations. New owner/collection IDs may be mapped; historical receiver observation identity remains exact. Layout copy still starts with empty observations.
- A new cplayout-design-workspace-bundle-v1 inventories/hashes the exact design and every associated pending/applied/cleared/archived collection plus source provenance. It is the default complete export. Old readers reject the new format; corrupt/incomplete/foreign-owner imports fail atomically. Existing design-only exchange is explicitly distinguished.

Implementation of storage, bundle and all refusal/copy/history rules is part of completion, not an optional follow-up. Current source schema/evidence is not relabelled as digitized drawing to avoid that work.

### New Survey observation display names

The actual r2 browser capture exposed two separate failures: trusted RTK quality
contained an absent `baseStationId` property as undefined, and a blank label cannot
satisfy the existing historical SurveyPoint required-label contract. Keep strict
untrusted JSON validation and all historical point/evidence contracts. Omit absent
known optional values at their internal producer boundary.

For newly captured Survey points only, use the entered nonblank label exactly,
otherwise `Observation N`, where N is the selected collection's entire immutable
observation-ledger length plus one. The UI explains the automatic display name;
it is human-readable metadata, not a receiver measurement or human-supplied fact.
Clear/Undo do not reset this ledger count. Final collection selection/revision and
live-evidence gates remain unchanged. Optional Layout labels remain genuinely
optional and are omitted when absent.

Two independent source reviews used workflow .30, preservation .25, reach .20,
proof .15 and maintenance .10 weights. The controller reviewer scored automatic
metadata4.75 versus mandatory entry3.75; the interface reviewer scored4.85 versus
3.50 (a new historical point version3.10, outside this repair). The selected mean
is4.80 versus3.625. No existing stored label is normalized or filled, and no new
document version is introduced by this metadata choice.

## Governance direction

Governance weights: compatibility .30, preservation/failure .25, context efficiency .20, reproducible proof .15, maintainability .10. Independent governance scores: enhance existing 4.70; new framework 2.05; unchanged 3.10. The coordinator selects enhance existing. Unchanged rules incorrectly inject withdrawn AGENTS.md instructions; additional framework complexity has no demonstrated benefit.

Repair current authority without republishing withdrawn rules. Improve precise unified-mode/preservation routing; deduplicate normalized keywords; make advisory data failures bounded and private; add missing PreToolUse fixtures; keep Stop continuation disabled. Retain adequate observed Python/Node/npm/Playwright/TypeScript/Expo tools. A repository concurrency ceiling is configured separately from the current host's exposed four-slot limit.

Current OpenAI documentation says hook layers merge and non-managed hooks require exact-definition trust; configuration alone proves neither loading nor enforcement. The public subagent ceiling excludes the primary. Any loader probe must identify exact source/version/trust and be distinguished from direct script tests or managed policy. No managed deployment or global trust mutation is selected. Sources: [Hooks](https://learn.chatgpt.com/docs/hooks), [subagent settings](https://learn.chatgpt.com/docs/agent-configuration/subagents#global-settings), fetched 2026-10-10.

## Primary interface precedents and limits

QField uses the project map for digitizing and adds navigation panels/controls to its canvas. Mergin exposes recording and stakeout tools from a project map. QGIS surrounds its map with reusable toolbars/panels. These support the interface separation chosen here; they do not prove CPLayout runtime, receiver accuracy or a need to adopt their backends. Sources accessed 2026-10-10: [QField collection](https://docs.qfield.org/how-to/data-collection/digitize/), [navigation](https://docs.qfield.org/how-to/navigation-and-positioning/navigation/), [MapCanvas](https://api.qfield.org/QField/classMapCanvas/); [Mergin interface](https://merginmaps.com/docs/field/mobile-app-ui/), [stakeout](https://merginmaps.com/docs/field/stake-out/); [QGIS interface](https://docs.qgis.org/3.44/en/docs/user_manual/introduction/qgis_gui.html).

## First bounded implementation wave

### Rendered responsive organization decision

r2 visible DOM at390x844 measured a390x598 working area with343.1875 pixels
covered by the tools drawer, leaving46.8125 pixels for simultaneous map work.
At900x430 the existing side split leaves550x299 pixels of map. The form height
observations have different scopes: the Draft input block is about2256 pixels;
the combined Design tools content is about2499 pixels. Preserve those distinctions.

The same workflow/preservation/area/proof/maintenance weights (.30/.25/.20/.15/.10)
were used by two independent interface/management reviewers. A conditional full-
width compact map above a tools dock scored4.75 in both reviews. The current88%
overlay scored2.60 and3.05 and was vetoed for unusable exposed map width; capture
with tools closed scored3.95 and4.05. Retained Drawing/Inputs/Review task tabs
scored4.55 in both reviews versus3.20 and3.50 for the combined form.

Select the compact dock and retained task grouping. Size the dock from remaining
working space, retain the adequate wide side split, and remove redundant compact
chrome before choosing a short-height allocation. Proposed project verification
floors are280x160 pixels of exposed map and96 pixels of tool scrolling space when
both can coexist; these are design criteria, not external standards. Explicit
collapse/full-tool handling must preserve the mounted map and input owners when
screen or keyboard height cannot support both. One common responsive system serves
all three modes. Task tabs change presentation, preserve each form/advisory instance
and scroll state, and restore focus only within its active visible task. Field uses
Machines/Review while retaining its truthful manual-geometry limitation.

QField's geometry/attribute sequence and Mergin's map recording controls support
task separation; the dock ratio and CPLayout grouping are this panel's inference.
They do not prescribe a vendor layout or prove the proposed implementation.
Implementation/browser verification remain pending after the r3 fidelity repair.

- Governance worker owns .codex config/hooks/agent profiles, affected instruction references/fixtures and protocol/context generator; no app/domain/store or aggregate/browser writes.
- Map contract worker owns new document-neutral scene/types/tests only; no app wiring, camera runtime or fabricated complete-document adapter.
- Coordinator owns plan/decision/status, pure mode/capability/controller contracts and integration. Survey persistence mutation waits for its full collection/bundle/reference contract. UI wiring waits for pure contracts and independent review.
- Every changed input invalidates only matching evidence. Prior focused/source passes remain dated preservation evidence. Goal remains active until the singular interface and governance capabilities are actually implemented and verified.

## Compact identity correction — 2026-10-11

Actual wave4-r1 visible390px captures hide the current field/design behind the
customer-first truncated breadcrumb. Two independent reviews choose actual
design/session-first then field in compact chrome, retaining the exact full
Customer→Project→Field→Design hierarchy as the accessible label and in the same
supporting catalog. A standalone Layout uses its actual session, never an invented
design association. Common controls/owners remain identical.

| Option | State reviewer | Interface reviewer | Mean |
| --- | ---: | ---: | ---: |
| Customer-first unchanged |3.75|3.65|3.70|
| Field-first, design-last |4.10|3.85|3.975|
| Design/session-first, then field |4.80|4.65|4.725|

Each score uses continuity.35/preservation.30/maintenance.20/verified capability.10/
cost.05; they are judgments informed by real captures, not runtime pass probabilities.
Both reviews preserve full source context and require rendered rechecking.

The existing manual task tabs require actual semantics rather than style-based
selection assertions. [W3C Tabs APG](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
was fetched2026-10-11. Adopt its selected tab/panel links, manual arrow focus and
Space/Enter activation in the same retained presentation; record actual browser
keyboard/focus evidence separately from source tests.
