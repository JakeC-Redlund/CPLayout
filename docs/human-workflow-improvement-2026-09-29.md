# Human workflow improvement — 2026-09-29

This is the implementation and review record for the 2026-09-29 workflow pass, based on `62996a358b917325461b450e67fd9a0d9f53e62a` and reconciled with canonical foundation `ab0d03e040dee56da20542895c042de0bd337a28`. Dated iteration results below are historical checkpoints, not a running acceptance count. Final software acceptance and publication require the unchanged-candidate gates in this document and exact-revision evidence in [the workflow publication review](https://github.com/JakeC-Redlund/CPLayout/pull/2). This record does not establish native, physical receiver, field, or human acceptance.

## Intent and decision authority

The owner requested clearer human organization, a clear separation between Design and RTK precision Layout, intuitive customer/project/field entry, and research into comparable mapping applications and repositories. The owner delegated subsequent choices to a research-driven weighted specialist panel and requested no further questionnaires. Delegated decisions and automated specialist reviews are not human approval or measured human preferences.

The coordinator classified the cross-module implementation as `xhigh`, selected `xhigh` reasoning, and recorded `Subagent decision: required`. Independent roles cover product/UX, field operations/GNSS, data entry/storage, and QA. Writers have disjoint ownership, with the coordinator integrating App/navigation/handoff and owning aggregate validation. This bounded documentation leaf is `medium`, with source consistency and diff review as its gates; it does not run builds or browser tests. Pre-existing implementation changes belong to the other task owners and must be preserved.

Hard vetoes apply regardless of score: canonical projected/local XY remains authoritative; no data loss or silent target changes; offline/no-cost operation; existing collection gates remain effective; and no invented native or physical qualification.

## Research basis

The panel's primary-source ledger supports preparation/capture separation, explicit navigation and positioning roles, contextual forms, grouped inputs, and actionable feedback. These comparisons inform interface decisions; they do not establish equivalent functionality or usability in CPLayout.

| Source | Relevance to the decision |
| --- | --- |
| [QField concepts](https://docs.qfield.org/get-started/concepts/), [digitizing](https://docs.qfield.org/how-to/data-collection/digitize/), and [attribute forms](https://docs.qfield.org/how-to/project-setup/attributes-form/) | Separate project preparation, collection interactions, and form configuration. |
| [QField navigation](https://docs.qfield.org/how-to/navigation-and-positioning/navigation/) and [GNSS](https://docs.qfield.org/how-to/navigation-and-positioning/gnss/) | Distinguish positioning and navigation from editing and capture. |
| [Trimble Access stakeout](https://help.fieldsystems.trimble.com/trimble-access/latest/en/stakeout.htm) | Terminology and task comparison for field execution; no adoption of a paid dependency or claim of CPLayout target-navigation parity. |
| [Mergin Maps mobile interface](https://merginmaps.com/docs/field/mobile-app-ui/) | Project context and field-facing collection actions. |
| [QGIS 3.44 relations](https://docs.qgis.org/3.44/en/docs/user_manual/working_with_vector/joins_relations.html) | Related-record context relevant to customer/project/field entry. |
| [W3C form grouping](https://www.w3.org/WAI/tutorials/forms/grouping/) and [notifications](https://www.w3.org/WAI/tutorials/forms/notifications/) | Meaningful input groups, errors, and feedback. These references alone do not certify accessibility conformance. |

Repository examples recorded by the panel are pinned to reviewed source versions:

- [QField digitizing toolbar](https://github.com/opengisch/QField/blob/c65beba69babda8c1d9aa7eac7c58f6ab0a11f4e/src/gui/qml/QfDigitizingToolbar.qml), commit `c65beba69babda8c1d9aa7eac7c58f6ab0a11f4e`.
- [Mergin Maps main interface](https://github.com/MerginMaps/mobile/blob/26b5fcbe4935ef49fe1046dc96b51b8d743966f3/app/qml/main.qml), commit `26b5fcbe4935ef49fe1046dc96b51b8d743966f3`.
- [QGIS GPS toolbar](https://github.com/qgis/QGIS/blob/7783004ff939ad31b220613aa0723fa176ee705b/src/app/gps/qgsgpstoolbar.cpp), commit `7783004ff939ad31b220613aa0723fa176ee705b`.

This document retains the panel's source ledger, rather than claiming a fresh independent external-source verification by the documentation writer.

## Weighted alternatives

Weights are product/UX **0.35**, field operations/GNSS **0.25**, data entry/storage **0.25**, and independent QA **0.15**. Scores use a 1–5 scale. They are specialist judgments, not measured usability results. The weighted sum selects a default subject to preservation and runtime vetoes.

| Architecture | UX | Operations | Storage | QA | Weighted score |
| --- | ---: | ---: | ---: | ---: | ---: |
| A — shared Design/Layout toggle with clearer context | 3.55 | 2 | 3 | 2 | 2.7925 |
| **B — distinct top-level task workspaces sharing engines and retained state** | **4.70** | **5** | **5** | **5** | **4.8950** |
| C — mandatory sequential wizard | 3.35 | 3 | 2 | 3 | 2.8725 |

The selected architecture addresses the previous overloaded Layout label: editable-project field capture and immutable frozen-target sessions were both described as Layout. Other panel findings included collection controls below export/settings in a long scroll, generic customer company defaults obscuring personal names, and mode switching that could clear pending classification. Existing contextual New actions and explicit first-field naming should be retained. Current Layout sessions record observations; this work does not add live target-navigation guidance.

| Decision | UX | Operations | Storage | QA | Weighted score |
| --- | ---: | ---: | ---: | ---: | ---: |
| D1 — Projects, Design, Survey, RTK Layout tasks | 4 | 4 | 5 | 4 | 4.25 |
| D2 — contextual catalog dialogs | 4 | 5 | 4 | 5 | 4.40 |
| D3 — explicit Prepare for RTK Layout steps | 5 | 5 | 5 | 5 | 5.00 |
| D4 — collection action area and full readiness | 5 | 5 | 5 | 5 | 5.00 |
| D5 — Survey purpose and capture presentation | 5 | 5 | 4 | 4 | 4.60 |
| D6 — named design actions and span rows | 4 | 4 | 4 | 4 | 4.00 |
| D7 — saved-document thumbnails | 4 | 4 | 5 | 5 | 4.40 |
| D8 — retention across task changes | 5 | 5 | 5 | 5 | 5.00 |
| D9 — repeated complete review cycles | 5 | 5 | 5 | 5 | 5.00 |

The behavior packet was accepted with unanimous preservation amendments. There is no recorded dissent after those amendments; lower scores remain uncertainty signals, not experimental evidence.

## Accepted amendments and implemented source scope

- **Task separation:** `apps/mobile/src/components/PrimaryTaskNavigation.tsx` defines Projects, Design, Survey, and RTK Layout, integrated in `apps/mobile/App.tsx`. Design resumes drawing/inputs/calculations; Survey owns receiver evidence for the open design; RTK Layout uses frozen targets and separately saved observations. Inspect map/Edit map are presentation aliases, with stored workflow modes unchanged and form editing still available.
- **Contextual entry:** `ProjectCatalogDialog.tsx` and App catalog handlers put required first/last names ahead of optional company/contact details, use a blank company for new customers, expose project and first-field naming in context, and retain fixed dialog actions. Source includes invalid-input focus and inline error association, shared busy/close handling, preserved form-session context, and explicit stale-context retry checks in `catalogFormRecovery.ts`. A catalog modal does not itself navigate the task workspace.
- **Explicit handoff:** App's Prepare for RTK Layout panel names the design/machine and saved editor revision, explains the next prerequisite, and offers an explicit independent-machine field-copy action. Field preparation continues through explicit calculation, target freezing, and session creation. Drafts are not silently completed, converted, or assigned invented coordinates; later design edits must not move existing frozen targets.
- **Field action hierarchy:** `LayoutSessionWorkspace.tsx`, `BrowserRtkReceiverPanel.tsx`, and `ReceiverConnectionPanel.tsx` place collection readiness, optional label, collection command, and feedback together. Readiness includes session/archive/storage/busy/duplicate/visibility conditions as well as receiver gates. Connection settings and session administration remain separate controls. Survey presentation changes preserve evidence; applying previously recorded evidence remains distinct from live capture.
- **Design inputs:** `DesignDraftInputs.tsx`, `DesignDraftWorkspace.tsx`, `FieldDesignWorkspace.tsx`, and `fieldMachineInputs.ts` expose named Save draft, Calculate preview, and Create complete design actions where applicable, retaining selected-machine Apply/Discard. Numbered raw span rows append/remove-last only; parsers retain original-index precision and do not parse on blur. Partial text remains editor state, with imperial input labels and grouped purpose controls.
- **Saved previews:** `SavedDesignPreview.tsx` and `savedDesignPreviewGeometry.ts` derive thumbnails from each card's own saved, validated document and revision. Identity changes cannot show a preceding design's geometry while loading. Empty/unavailable states remain neutral. Previews add no stored image/geometry authority or archive schema.
- **Retention:** task visibility and mounted-editor identity/generation guards are intended to preserve pending drawing, purpose/name/notes, selection, camera, undo, and input recovery. Actual record replacement remains guarded. `draftReceiptReconciliation.ts` permits a shared-workspace receipt advance only when exact draft identity, revision, stored bytes, and context still match; it does not replace editing state or silently adopt a changed saved draft.

These are source observations and implementation intentions. The candidate is still subject to independent review and browser execution. Map adapters and navigation labels change alongside App; project document/storage formats and canonical geometry authority are not redesigned by this packet.

## Iteration 1 review findings

The coordinator reported the following defects and corrective source work. They remain acceptance checks until independently reviewed and exercised against the integrated candidate:

| Finding | Corrective source direction |
| --- | --- |
| Typing after form submission could be lost | Lock busy inputs and guard synchronous handlers. |
| Stale form retries could never recover | Explicitly check unchanged parent/target records while keeping raw text, then permit a deliberate retry. |
| Draft focus-registry ordering was unstable | Update stable input metadata rather than reordering registrations. |
| Latest Layout failure could disappear inside scrolling content | Keep collection outcome in the persistent action area. |
| “Gate closed” incorrectly described applying saved evidence offline | Distinguish live-capture unavailability from recorded-evidence application. |
| Root/task reverse synchronization could bounce between tasks | Make root task state authoritative; further root review remains necessary. |
| Hidden owners could leave modal portals visible | Gate modal presentation by owner visibility. |
| Retained draft/field editors could use the wrong root context | Preserve explicit editor context. |
| Delayed activation or routing could target stale state | Use latest references and generation checks. |
| Pending Layout import could be overwritten | Include catalog dirty/busy guards. |
| Copy-name edits were missing from unfinished-input checks | Include unfinished copy names. |
| Draft capture classification was missing from replacement guards | Include active capture in preservation checks. |
| A sibling write could stale a retained draft's save receipt | Reconcile only exact unchanged draft identity/bytes/revision/context. |

Iteration 1 did not complete acceptance. Its corrective changes were the inputs to the subsequent source-review iterations below.

## Iterations 2–3 source review checkpoint

The coordinator reports that source reviewers verified these corrections and found no remaining blocker within their assigned scopes:

- Root utility Map/Survey routes now select the root task, cancellation returns to Design, and `focusin` records editable focus before a task-tab click.
- Placement confirmation belongs to the Design map, rather than the catalog task.
- Catalog form state lives above the stateless Modal visibility boundary. Raw values, validation errors, and expanded details survive owner-task suspension; explicit close unmounts the form and resets that session.
- Layout review/session replacement guards include raw session names, copy names, and association inputs.
- Exact draft-receipt reconciliation permits unrelated catalog writes only when the saved draft identity, bytes, revision, and context remain unchanged. It rejects changes to the draft's own saved document.
- Asynchronous archive import retains a successfully saved copy, while activation requires the latest generation and a visible owner.

Two synthetic regressions in `tests/web/human-catalog-forms.spec.ts` cover customer raw values/details/errors across owner-task suspension and explicit Cancel reset, and project/first-field validation and raw values across suspension without persistence. These deliberately activate an app-owned task control to exercise the lifecycle boundary; they are synthetic coverage, not evidence of human interaction or a completed browser run.

Windows test discovery passed for **63 tests across four files**. This is discovery only: it does not demonstrate assertion execution, rendered behavior, or acceptance. At this checkpoint there has been **no browser execution of the new candidate**, and there are **zero completed acceptance reviews**. The frozen candidate must next undergo the visible Edge and validation cycle below.

For separation of evidence, the prior canonical `r4` run reported **820 passed, 13 failed, and 10 skipped**. A narrow fix at `2a99310` was pushed through PR #2, with CI pending at this checkpoint. Those results and publication activity concern the prior canonical work, not acceptance of this new candidate. Neither source-review completion nor test discovery advances the two-review acceptance count.

## Iterations 4–5: visible review and corrective loop

The first visible Edge batch reported **50 passed and 13 failed checks**. Corrections addressed active-task accessibility, compact workspace sizing, invalid-input label visibility, retained form state, archive-import save versus activation, scoped receiver controls, and short-window conflict feedback. The corrected candidate was exported before the second batch, and the served files were checked against that export.

The second visible Edge batch reported **65 passed and 8 failed checks**, with no skips or flaky results, across desktop, narrow, short, and selected combined narrow/short workflows. It confirmed the archive-import recovery and short-window conflict corrections within those tests. Its remaining failures were:

| Finding | Prepared correction | Verification still required |
| --- | --- | --- |
| Three customer-resume checks could not read the expanded state of optional details | Expose explicit web `aria-expanded` alongside the native accessibility state; apply the same convention to receiver and export disclosures | Re-execute disclosure and resume workflows |
| Four Layout checks clicked the archive confirmation container rather than its command | Scope the test to the actual Archive session button within that confirmation | Re-execute the archive postcondition and retained target assertions |
| The draft input area shrank to 39 px with foreign-save feedback at 390 × 430 | Opening Inputs gives that area the small-window body; the map remains mounted while hidden | Re-execute the unchanged minimum 96 px assertion, Apply behavior, and exact foreign-document preservation; verify map camera and unfinished drawing retention across hide/show and resizing |

Independent source review found no blocker in these five affected source/test files. A further regression now covers hidden-map presence, camera zoom/center restoration, exact unfinished vertices, undo/redo, and explicit saving across input toggling and height/width breakpoints. Its independent source review found no blocker; browser execution remains pending, and it does not cover pointer-driven pan. These reviews do not establish rendered sizing or complete acceptance. The acceptance count remains **zero**, and corrective changes restart the complete-review sequence.

During this correction, the execution environment made Git metadata and the isolated implementation checkout read-only. Work continued in a separate writable source copy, preserving the original checkout. All workspace TypeScript checks, skill validation, and the context-map check passed there. Aggregate validation stopped at a dependency-patch test when a child Git process was denied; the UI launcher, browser proof, and HTTP review tests encountered denied socket operations. A fresh npm audit could not reach the registry. These are recorded execution limitations, not passing results or reasons to weaken tests. Visible Edge re-verification, aggregate validation, publication, and prior owned-server cleanup remain pending.

Separately, the public [foundation CI run at `2a99310`](https://github.com/JakeC-Redlund/CPLayout/actions/runs/36632372905) completed with source success and a failed browser shard 3/3. Its failure artifact is available on GitHub, but authenticated logs and artifact contents were unavailable in this environment. The failed assertions must be diagnosed before the foundation PR can merge. This is a distinct candidate and does not establish acceptance or failure of the prepared human-interface corrections.

## Iteration 6: restored execution and short-field recovery

Execution access was restored. The preserved corrections were integrated into the original isolated checkout after verifying their hashes. The third visible Windows Edge batch passed **77 of 77 checks**, with no skips or flaky results, across desktop, narrow, short, and combined narrow/short workflows. The Windows-served files matched the export. Full `npm run validate`, skills, context-map, and visual-review tooling checks passed on the unchanged candidate; npm audit reported zero vulnerabilities. The owned Edge contexts closed and the launcher verified its server stopped.

Independent review then inspected the source and actual screenshots and found a required usability correction despite those passing tests: at 390 × 430, a long field title, wrapping actions, and pending-work notices left about 10 px for machine inputs. That result does not count as a complete acceptance review.

The next candidate compacts the field identity, keeps Save and Calculate in a horizontal command bar, moves feedback into the scrolling body, and puts machine selection and entry before the location diagram, RTK handoff, and export actions. New feedback is revealed once; returning to unchanged feedback preserves the editing position. The expanded regression uses actual wheel scrolling and verifies reachable input/Discard controls, a minimum 96 px body, retained input identity/focus/raw values across resizing and navigation, and exact unchanged workspace bytes. A deliberately off-center input position distinguishes preservation from automatic browser focus scrolling. These corrections require a fresh served build and browser execution; the complete-review count remains zero at this checkpoint.

Separately, the foundation CI failure was diagnosed from its downloaded trace: blocked imagery retries prevented MapLibre's load event before the retention assertion. A test-only local imagery fixture preserves the original readiness, geometry, camera, and drawing assertions. Nine focused cases across all three viewports and three repeats of the prior failing mobile case passed. The correction was committed and pushed as `ab0d03e`; [required CI](https://github.com/JakeC-Redlund/CPLayout/actions/runs/36639001720) was running at this checkpoint. The same fixture is included in this candidate. Foundation publication and human-interface acceptance remain separate gates.

## Final candidate verification checkpoint

The fourth visible Windows Edge batch passed **77 of 77 checks** with no skips or flaky results. Full source validation, skills, context-map and visual-review tools passed against the same unchanged candidate; npm audit reported zero vulnerabilities. The field recovery regression passed with actual wheel navigation, off-center scroll preservation, retained focus/raw values and exact workspace bytes. Independent review of desktop, narrow and short screenshots found no new blocker in the reviewed frames. The owned browser contexts closed and the launcher verified the server stopped.

The final candidate corrects the diagram accessibility label to describe current pivot locations and adds intermediate screenshots at failed Apply and focused-input recovery. These captures supplement the passing assertions and let the final reviews inspect the exact short-window recovery state. Fresh visible Edge, aggregate validation and complete browser proof remain required before acceptance; the complete-review count is still zero at this checkpoint.

## Iteration 8: Layout review retirement

The fifth visible Edge batch passed all **77 checks**, and full source validation and the required supporting checks passed against the unchanged candidate. Independent review of all 12 intermediate field captures confirmed usable focused-input and failed-Apply states at 390 × 430 and 900 × 420.

A broader source review then found missing lifecycle coverage: confirmed departure and successful Layout review persistence left the retained review dirty. Canceling after changing association could also leave a false blocker. An empty catalog field selection should be retained browsing context, while a selected file remains a protected review even if validation fails. The correction now retires explicitly abandoned or successfully submitted reviews, preserves failed saves and unrelated unfinished reviews, acknowledges background persistence without activating it, and consumes only the matching pending target. Canceling does not mark a frozen target as saved.

Added regressions cover confirmed departure, cancellation after association changes, browsing-field retention, malformed selected files, create/import success followed by another target, generic existing-session opening with an unfinished review, delayed hidden completion, quota failure and retry, and exact workspace-byte preservation. Independent source review found no remaining blocker in this correction. Fresh integrated validation and browser execution are pending; complete acceptance remains zero until the final unchanged candidate meets every gate.

## Iteration 9: retained-screen assertions and primary task targets

After the Layout lifecycle correction, full source validation passed and the sixth visible Windows Edge batch passed **106 of 106 checks**, with no failed, skipped or flaky results and matching served-build hashes. Those results apply to that preceding candidate.

The broader 933-case browser run was interrupted after **35 passes, four failures and one interrupted case**, leaving 893 unrun. Independent artifact/source reviews found that two failures came from selectors matching both the visible Survey empty state and the intentionally retained hidden receiver screen. A third expected primary navigation to use the utility rail's selection attribute. A fourth measured a 40-pixel primary task button against the existing 48-pixel usability requirement; the earlier page-overflow assertions had passed.

Corrections now require exactly one visible Survey section, hide retained metrics, verify current empty-state guidance, and compare saved workspace bytes across navigation after initialization. Primary-task assertions check unique `aria-current` selection through utility views and actual dashboard return. Primary task buttons use a 48-pixel minimum height, with the landscape assertion covering all four buttons. Retained screen state and geometry/storage behavior are unchanged. Independent review caught and corrected an initialization race in the new storage assertions before browser acceptance.

Two independent reviewers compared keeping 40 pixels and lowering the assertion with using 48 pixels and retaining it. With weights of 50% tap usability, 30% short-window reachability and 20% preservation/simplicity, their respective scores were 3.1 versus 4.7 and 3.8 versus 4.5 out of five. Both recommended 48 pixels; the coordinator adopted that choice. These are engineering judgments, not measured usability. The minority tradeoff is eight fewer vertical pixels for the working area, which must be checked in the short-window workflows.

The relocation checkpoint was verified against all 48 changed paths. New work is isolated, with one writer and bounded read-only reviewers; other CPLayout threads and their latest handoffs were inspected. Cross-thread messages could not be delivered because the tool requires approval while the current session's approval policy is `never`. No shared source, Git history, or other agents' resources were changed.

All workspace TypeScript checks, skills/context checks, seven focused domain test files and discovery of all 933 browser cases passed during this pass. These are source/discovery evidence, not execution of the corrected browser assertions. The aggregate validator stopped on a denied Git subprocess in the SQLite patch tests; visual-review tooling had environment failures; browser proof could not create its IPC socket; npm audit could not resolve the registry. No current audit result or complete validation pass is claimed. The eight additional navigation pixels still require fresh desktop, narrow and short-window review, including the 390 × 430 and 900 × 420 input-recovery scenarios. Complete acceptance remains zero.

## Iteration 10 — usable working areas and meaningful design choices

The seventh visible Edge batch ran 111 checks against matching served build bytes: 110 passed and one tall-narrow foreign-save recovery case failed because drawing controls blocked Apply name. Independent pixel review found that the expanded narrow tree squeezed the map to a thin strip, and a 900×420 map had about 20 pixels of visible canvas. These findings reset complete acceptance to zero.

Opened Inputs now own the compact draft body while the same map remains mounted. A narrow expanded project drawer similarly owns the working area; explicit collapse returns to mounted main content, and accepted project opening closes the drawer. Short landscape maps expose Design context containing the breadcrumb and Layout/Prepare actions. Their compact header recovers height. Independent source review also caught a 44-pixel toolbar containing 48-pixel controls; it now accommodates the controls and its border. The context dialog is named and closes when leaving short landscape presentation. Geometry, document contracts and calculations remain unchanged.

With usability/preservation/simplicity weights 50/30/20, the worker scored Inputs owning the body 5.0 versus 2.8 for a concurrent narrow map and 3.6 for adaptive measurement. The independent layout reviewer scored a full-width drawer with hidden mounted main content 4.7 versus 3.9 for an overlay. The coordinator adopted these recommendations. Scores are engineering judgments; reachability, focus, camera, unfinished drawing and byte preservation require browser execution.

A separate worker prepared compatible lockfile-only patch releases addressing the new brace-expansion advisory. Independent review verified five entries changing only version, resolved URL and integrity within existing parent ranges. Root installed them successfully; final audit remains required. Integrated storage and companion regressions passed 20/20, exercising valid-but-different frozen targets/field associations, exact Host/body limits, the actual abandonment lease and successor ownership protection.

The owner further emphasized actual design choices, reducing redundant controls, clear menu/page/tab organization and appropriate actions in Design versus RTK Layout. Customer, machine, file and design management are explicit continuous-review areas, including creation, naming, selected context, editing, saving, reopening, copying and export. This steers the existing loop without a new solver or questionnaire.

Independent workflow review identified adoption controls that did not show proposed machine locations/configuration, receiver shortcuts that only opened a routing panel, three Settings entries that led to the same page, and hidden cleanup errors after collapsing communications. Shared read-only Current/Proposed machine review is being added before adoption, retaining locks and stale-result guards. Survey shortcuts now open Survey directly; the redundant navigation-only RTK sidebar is removed. Inspect defaults to Overview. File names its separate spatial catalog view Catalog map; Projects remains the primary management destination. One Settings entry replaces identical false shortcuts. Connection status/error and Connect/Disconnect remain visible independently of transport settings. The unavailable equipment-price instruction is replaced with a clear unknown-cost explanation.

The independent reviewer and coordinator each scored removal of the routing-only RTK tab 4.8 versus 4.0 for merely renaming it, using usability/preservation/simplicity weights 50/30/20. A separate reviewer scored shared spatial/change review 4.8 versus 3.1 for a new scenario-management subsystem, clarification/consolidation 4.5 versus 3.8 for a navigation rebuild, and correcting unavailable-price guidance 4.5 versus 3.6 for adding price entry. Preservation vetoes remain unchanged. Fresh 2026-09-30 checks of [QField digitizing](https://docs.qfield.org/how-to/data-collection/digitize/), [navigation](https://docs.qfield.org/how-to/navigation-and-positioning/navigation/) and [W3C grouping](https://www.w3.org/WAI/tutorials/forms/grouping/) support explicit interaction modes and logical action groups; their application here is an engineering inference, not measured CPLayout usability or feature parity.

The next focused proof stopped after three failures: a Survey return preserved raw input but missed keyboard focus, and two narrow catalog openings were obstructed. Trace CSS showed that a foreground drawer shorthand flex rule combined with inherited zero growth reduced the rail to its padding width. Explicit grow/shrink/basis rules correct its dimensions. Navigation now restores input focus only after the matching visible task/view commits, checking navigation sequence, editor generation and the retained DOM element. Independent source review is clear; unchanged normal-click, focus, camera and storage assertions remain required. Generated context metadata is rebuilt after source and interface guidance changes. These failed checks remain retained and do not count as acceptance.

Further focused execution confirms retained Survey input/focus, draft Inputs and foreign-save recovery, actual machine proposals and short-landscape controls. It exposed a second compact flex-basis conflict inside the catalog: a 30-pixel list clipped its 42-pixel Open button. The foreground catalog now uses available height; other compact lists use automatic content basis. Receiver Disconnect also lost focus while temporarily disabled during failed cleanup; recovery must restore only the initiating visible control without overriding later user navigation or focus.

Whole-journey independent management review found a delayed draft-completion callback that could activate Design after the user switched tasks. Successful persistence must acknowledge the original draft and refresh its receipt independently of activation. The saved complete copy remains available for explicit opening; activation requires the current task/navigation sequence and original editor identity. Delayed success/failure and subsequent source-draft saving require real-interface regressions. The intervening aggregate validation was stopped for these corrections and is not a pass.

The following focused run passed delayed completion in Projects and after away-and-back navigation, hidden quota retry, source-draft saving and explicit opening across all three configured viewports. Receiver cleanup focus/retry also passed. A selected vertex became unreachable after a hidden map resized into a short landscape view. The correction retains previous visible dimensions and selection ownership through hide/resize, consolidates redundant edit metadata, uses one scrolling action row and retains attribution/source details in the short-map header. Full error text remains available. A TypeScript receipt check now rejects unavailable completion revisions before acknowledging the refreshed source session. These corrections require fresh proof and do not imply acceptance.

Publication, corner-arm, VFlex and layout-search threads acknowledged exclusive coordinator integration/export ownership and reported no competing writers, runtimes, validators or unpreserved changes. Canonical source remains clean and unchanged until acceptance; other worktrees remain preserved.


## Iteration 11 — catalog space and unobstructed drawing

The revised candidate passed all 42 focused browser checks and all 134 visible Windows Edge checks, including desktop, narrow, short and combined narrow/short workflows. Full source validation, skills, context metadata and visual-review tooling passed with unchanged source; npm audit reported zero vulnerabilities. The launcher was stopped and owned Windows processes were closed. These passes do not override pixel review: compact Projects still divided its small body between a 90-pixel tree and a 100-pixel catalog, and an opened project rail at 760×420 left a 398-pixel map outside the short-HUD policy. Both are required usability corrections, so complete acceptance remains zero.

Compact catalog navigation now reuses the explicit project drawer. Its closed icon rail gives the main content the full body height; opening it presents the tree in the foreground while retaining the mounted main content. Primary task and compact utility navigation reveal their destination by closing the drawer. A short-landscape project drawer also occupies the foreground rather than squeezing the map, and returning to Design or opening a design closes that drawer. Short-map drafting commands appear after the first vertex; the zero-vertex disabled command row is omitted while full status text and vertex editing controls remain.

Using usability/preservation/simplicity weights 50/30/20, independent review scored the consistent drawer 4.5 versus 3.5 for the stacked scrolling areas; the coordinator scored 4.7 versus 3.4. The selected choice adds an explicit catalog-opening action on compact screens and requires ordinary-pointer regressions for all hierarchy controls. The updated proof must measure a useful unobstructed drawing rectangle, preserving camera, geometry, selection and draft vertices through drawer opening and closing.

The Windows JSON reporter retains intermediate screenshots as encoded attachments. The coordinator extracted those exact PNG bytes for independent review: Current/Proposed machine diagrams, below-displayed-precision changes and source values were readable. Final test screenshots alone were insufficient to assess those states. Modeling work remains an independent frozen packet; it receives shared integration/build ownership only after the accepted workflow canonical checkpoint and an explicit serialized transfer.

## Iteration 12 — resizing Projects without losing its content

The preceding candidate passed 45 focused browser checks, full source validation, skills, context metadata, visual-review tooling and a zero-vulnerability dependency audit with unchanged source. Its ninth visible Windows Edge batch passed 136 of 138 checks. Both failures reproduced a responsive presentation defect: an open desktop catalog drawer was retained when Projects narrowed to portrait, covering the saved-document dashboard. Independent review confirmed the short-window drawing and catalog corrections and found no additional required defect in the reviewed customer, field, machine-comparison and Layout frames.

Projects now closes its left drawer once when entering compact dashboard presentation. A deliberate drawer opening within that presentation remains open through an ordinary resize; collapsing it restores the retained dashboard. The strengthened regression checks normal pointer actions, both saved-document previews, the full-width foreground tree and exact unchanged workspace bytes. This correction affects presentation state only; matching source and browser gates must pass before acceptance.

The coordinator retains shared Git, integration, export, aggregate and browser ownership. The frozen independent modeling packet is reconciled against the accepted main checkpoint only after an explicit transfer. Source-only and focused modeling results do not replace its unexecuted browser or physical qualification gates.

## Iteration 13 — actions before status and SVG fallback clearance

The tenth visible Windows Edge batch passed all 138 checks without skips or retries, and source validation passed with unchanged inputs. Independent pixel review cleared the preceding resize correction. The coordinator's opening-screen review nevertheless found that four large storage/context/imagery metric tiles pushed Create, Import and Recent work below the fold. The selected hierarchy puts actionable notices first, then Create customer and Import, Recent work, preferences and compact storage details. Backend status and recovery errors remain available; the heading does not claim a successful save. Using usability/preservation/simplicity weights 50/30/20, independent review scored the compact summary 4.90 versus 4.15 for simply moving the redundant tiles; the coordinator selected the compact summary.

A focused legacy-drawing check also exposed a compact SVG fallback with only 57 pixels of clear drawing height while an options menu was open. The idle Pan HUD consumed space for zero-vertex drawing controls. Compact idle Pan now omits that HUD only when there are no draft vertices and no selected vertex; status/errors remain, and drawing/editing restores commands. Independent review scored this choice 4.7 versus 3.0 for retaining the idle HUD. The original greater-than-110-pixel clearance assertion remains. Two old accessible labels were aligned with Inspect map and Live capture unavailable without reducing drawing or collection restrictions.

A later source run exposed a receiver-test callback-order assumption after successor connection. The fixture now awaits the actual TCP server connection event with a bounded deadline before asserting exact peer count and socket identity; production transport behavior is unchanged. The source-validation run interrupted for these required corrections is not a pass. These changes require a new frozen source identity, exact served-build visible review, full browser execution and the two complete unchanged-candidate reviews. Earlier passing runs and partial source/pixel reviews are retained as scoped evidence, without advancing acceptance.

## Iteration 14 — compact drawing space and direct customer details

The next candidate passed source validation, 21 focused browser checks and eight companion checks with unchanged inputs; audit found zero vulnerabilities. Its eleventh visible Windows Edge batch passed 141 checks and failed the SVG drawing-clearance check. The full browser run exposed the same compact-space constraint in active drawing and editing: the browser map had 105 pixels of unobstructed height and the SVG edit canvas had 129 pixels. Those original thresholds remain requirements. The three full-browser shards were stopped for the demonstrated correction, their logs retained, and their partial results are not acceptance passes.

Compact maps now expose Design context through the existing, always-visible breadcrumb control. Its dialog retains the complete customer/project/field/design path, Layout sessions and Prepare for RTK Layout. Removing their separate rows reclaims drawing space for both renderers without changing short-landscape drawer policy, drawing commands, status/error feedback, geometry or storage. Independent weighted reviews preferred this shared correction (4.55 and 4.775) over SVG-only spacing (3.20 and 3.55), using usability/preservation/simplicity weights 55/30/15.

The customer's existing Open action previously repeated row selection and could leave its details hidden behind compact navigation. It now opens customer details directly and closes foreground navigation; ordinary row selection still supports tree browsing. Active or saving forms are guarded before changing customer context. Independent reviews preferred the direct Open behavior (4.85 and 4.925) over a two-click workaround (3.90 and 3.35). The Inspect-map regression uses ordinary hit-tested canvas clicks and exact unchanged workspace comparisons rather than fixed offsets covered by attribution controls. Fresh focused, visible, full-browser and complete acceptance reviews remain required.

Source validation and all 14 compact regression cases subsequently passed with unchanged inputs, including the previously failing drawing/editing and customer lifecycle. Six focused visible Edge checks also passed. Added 650×420 coverage found a collapsed inspector consuming a 52-pixel bottom strip, leaving a 153-pixel canvas. Closed short-landscape inspectors now use the existing side rail for shell/sidebar presentation; opened compact inspectors retain their existing overlay. Independent review scored this 4.775 versus 3.350 for keeping the strip. The 180-pixel canvas requirement remains, and commands in the intentional compact horizontal toolbar are checked through normal focus/scroll rather than simultaneous visibility. Across Layout navigation, the renderer deliberately retires and restores its exact camera; regression checks retain the original container node, camera, selection and saved bytes, while same-renderer checks apply within resize/dialog interactions. This correction requires a fresh frozen-candidate validation and acceptance cycle.

## Iteration 15 — measured compact scroll and selection clearance

The next source validation passed with unchanged inputs and a zero-vulnerability audit. Exact-sequence visible Edge measurements passed the final compact command, then exposed a selected vertex outside the 650×420 canvas. Linux measurements separately showed a persistent 0.1875-pixel command overflow at the horizontal scroll endpoint, despite an accepted hit on that command. Neither failure is accepted or hidden by test tolerance.

The compact toolbar now has one pixel of terminal content padding. Independent review preferred this correction (4.90) over relaxing the bounds assertion (3.05), using behavior/preservation/simplicity weights 45/35/20. The original 48-pixel command dimensions and full-containment checks remain. The short-map advisory label now occupies a bounded full-width row instead of wrapping across five lines in the narrow header title. Its complete advisory/review-only wording and machine counts remain. Existing horizontal edit commands, selection-reveal clearance, camera ownership and saved geometry remain unchanged. Matching focused browser, visible Edge, aggregate validation and complete acceptance reviews are required for these presentation corrections.

Focused execution rejected the full-width row: its added height blocked selected-handle input at 900×420. The matching validator was stopped for this required correction, with its interrupted result retained. The replacement keeps a two-line header summary, “Advisory” with selected/requested count followed by “review only,” and the complete accessible description. It replaces the CRS subtitle only while this short-window advisory is present; ordinary headers retain their existing content. Independent review preferred the summary (4.55 and 4.675) over another canvas overlay (3.45 and 3.825), using clarity/preservation/simplicity weights 45/35/20. The browser assertion checks the visible advisory warning and complete description/counts, while all selection, bounds, camera and storage assertions remain unchanged. This replacement still requires matching runtime and acceptance gates.

## Iteration 16 — testing the actual compact presentation and map position

The replacement header passed source validation, all nine focused browser cases and the complete visible Edge human-workflow coverage. The visible batch passed 162 of 165 cases. Three older drawing tests failed: two expected idle controls that compact Pan intentionally omits, and a footprint test remapped its next click after the pending-action dock grew. The three headless shards were interrupted for a separate obsolete compact breadcrumb assertion; those partial runs are not passes. Exact screenshots, traces and input hashes are retained.

The bounded correction changes tests only. Startup breadcrumb expectations follow viewport presentation and require the compact context trigger. Idle HUD expectations use viewport and measured map-frame dimensions, while retaining drawing, read-only, pointer, save and exact-storage assertions. Footprint capture uses fixed interior projected XY points, the normal Fit field action and settled dock/camera dimensions. Each exact unobstructed canvas click is independently inverted from its rounded pixel; field bounds and the existing 250-metre accuracy limit remain, with an additional pixel-derived accuracy check. The compact route now also executes the unchanged paid-network assertion before its early return. Application geometry, inputs, camera ownership and storage are unchanged. The new frozen test identity requires matching focused, visible and full-browser execution before complete acceptance.

The corrected candidate passed source validation and twelve focused cases in both Linux browsers and visible Edge. Two supplemental visible workflows captured open customer-form errors, retained optional values and the fixed footer, plus immutable Layout targets, receiver readiness and observation-save failures before any download. Independent pixel review cleared those states. The complete visible batch's browser reporter recorded 165 passing cases; its coordinator wrapper ended without a normal receipt, so that result is retained as scoped browser evidence rather than an aggregate pass.

Full browser execution then exposed two older Layout fixtures that expected a successfully submitted review, or its Cancel action, to remain after saving. Independent source review confirmed that successful creation intentionally retires the review while opening an existing session preserves independently unfinished work. The unsupported-import fixture now explicitly uploads the saved target to start a new review before checking cancellation and replacement failure. Return-to-field checks require the completed review to be absent, then use the catalog's Back action. Exact workspace bytes, field association and no-partial-creation assertions remain. These test-only corrections require a new frozen identity and matching validation; the failed and interrupted runs do not advance acceptance.


## Iteration 17 — ordinary Layout navigation preserves generation ownership

The corrected Layout lifecycle fixtures passed their focused desktop, narrow and compact checks. The shared receiver route then exposed a product defect: the ordinary Layout sessions button forwarded its press event into the optional numeric navigation generation. The root correctly refused that generation and left the catalog hidden. Two independent reviews confirmed the cause. The button now calls the navigation function without forwarding the event; compact context and primary-task routes already used the correct form. The generation guard, retained editor, unfinished review and shared receiver owner remain intact. The same ordinary button route now explicitly checks the active RTK Layout destination, visible catalog and enabled saved-session action. R33 failed and interrupted evidence is retained. A new frozen candidate and all matching source/browser gates are required; complete acceptance count remains zero.

## Iteration and acceptance contract

Each cycle inspects actual user tasks, researches unresolved behavior, records alternatives and weighted decisions where needed, implements bounded changes, reviews the exact served build visibly in Windows Edge, runs appropriate validation, and obtains independent usability/preservation review.

Exit requires **two consecutive complete reviews of the same unchanged candidate**, covering specialist review and visible-browser workflows, with no unresolved workflow blocker, preservation defect, misleading state, or required usability correction. Any corrective change resets the count; rerun affected workflows and complete the two reviews on the new candidate. Partial checks and source-only review do not count as complete acceptance cycles.

Review includes action location/hierarchy; customer/project/field context; required versus optional fields; explicit machine/design choices and Current/Proposed adoption; file/design save/reopen/copy/import/export organization; keyboard/focus behavior; plain language and imperial units; failure/retry recovery; draft and pending-import preservation; appropriate controls after task switching; and frozen-target identity. Recheck customer, machine, file and design management in every complete cycle, including desktop, narrow and short viewports. No further human questionnaire is required under the owner's delegation, and no automated result is labeled human approval.

## Required validation and remaining limits

The coordinator owns execution and current-candidate result recording. This documentation leaf ran no tests, builds, audit, browser server, or publication commands. Required gates are:

```sh
npm run validate
npm run validate:skills
npm run context-map:check
npm run test:visual-review
npm audit
git diff --check
npm run ui:test:start -- --no-open
npm run ui:test:status
# Capture/review the exact URL printed by the owned launcher.
CPLAYOUT_WEB_PROOF_PORT=<selected-port> npm run proof:web
npm run ui:test:stop
```

Run focused domain/component and browser workflow checks, including the new human catalog, design-input, field-operation, and primary-task specifications, against the integrated candidate. Report failures/skips, audit findings, candidate identity, exact served build, and review count. Close owned app/review tabs after their bounded workflow and verify server cleanup; preserve unrelated resources. Protected CI and main-only Git convergence remain distinct publication gates and require their own evidence.

Non-goals are new irrigation solvers, machine/controller control, paid services, native activation, physical receiver qualification, and new live target-navigation functionality. Quality-4, age-at-most-two-seconds, ownership, projection, and command-time capture checks remain requirements, not proof of field accuracy. Native SQLite/ZIP sharing, native MapLibre and local tile rendering, physical RTK accuracy, and field suitability remain separately unverified. WGS84 stays input/display; projected/local XY stays canonical. KML/KMZ styling remains visual interchange metadata only. Browser results cannot establish any of those native, physical, or Google Earth runtime claims.

Integration is limited to the dedicated document plus coordinator-owned implementation review. Revert this document alone if its record is superseded; do not revert unrelated implementation work. Final source/browser/native/field/publication claims belong to the coordinator and must follow the actual evidence.
