# Drawing Review: Responses And Rework

Status: human responses received 2026-09-27; **rework requested**, not accepted.
The authoritative transcription is retained privately. The public
[review summary](evidence/drawing-review-20260927/retained-review-summary.md)
records derived requirements without publishing the original response bodies.

Latest review process: [interactive browser review](interactive-browser-review.md).
The three obsolete review tabs have since been archived and closed; the
V01-V04 replacement has also completed and its hub has been retired. Historical statements
below about retained tabs and read-only follow-up HTML describe earlier evidence.

V01-V04 completed at 2026-09-27T16:57:22.202Z, revision 25. The
[retained review outcome](evidence/drawing-review-20260927/retained-review-summary.md)
requires another visual revision:

| Response | Required visual change |
| --- | --- |
| V01 b | Colorful drawing controls centered at the bottom over the map |
| V02 d | Capture actions use the same placement, coloring and interaction treatment |
| V03 b | One horizontal toolbar row on narrow displays instead of wrapping |
| V04 d | Red errors, yellow warning/information treatment and green success; retain icons/text so color is not the only distinction |

These supplement Q01-Q10; they do not approve the current interface. On narrow
screens, keep stable touch targets and provide horizontal scrolling if needed,
instead of shrinking labels/icons or allowing incoherent overlap. Retest actual
map interactions, menus and short viewports in visible Edge, then replace the
completed review with a fresh annotated interactive packet.

The centered-controls visual pass is now implemented and source/browser checked.
[W01-W04](evidence/drawing-review-20260927/centered-tools-questionnaire.json)
replaces the completed packet in visible Edge. Its four inline annotated figures
retain originals and DOM measurements. See the
[checkpoint](evidence/drawing-review-20260927/centered-tools-checkpoint.md) for
tests, cleanup evidence and remaining limitations. W01-W04 subsequently completed
at 2026-09-27T17:40:40.734Z, revision 8: W01=a, W02=a, W03=c, W04=a,
with empty essays. W03 specifically requests more drawing space; it is not
approval of the narrow layout. The standalone export at
`reports/visual-layout-review/centered-tools-completed-r8/` verifies with the
server stopped. The completed hub was archived/closed, its server verified stopped,
and the original map tab preserved. The next packet follows the owner's
[Will Rhea mapping review](will-rhea-improvement-loop.md).

Current mapping implementation packet: [durable drawing contract](drawing-workflow-contract.md).
The unfinished-drawing document/reducer and persistence contracts are implemented
for validation; toolbar integration, post-drawing classification and autosave UI
remain pending. This is not a claim that users can already pause drawings in the app.

## Recovery And Scope

Complexity: xhigh; selected reasoning: xhigh. Subagent decision: required.
Bounded workers own answer normalization and HTML generation; a read-only
irrigation specialist researched classifications. Coordinator owns integration,
product edits, browser lifecycle and evidence. No overlapping writes.

The submitted answer numbering was `1,2,3,1,2,3,4,5,6,7`. Ordered content maps
these to Q01-Q10. Original labels for the final seven are preserved here:
Q04=`1`, Q05=`2`, Q06=`3`, Q07=`4`, Q08=`5`, Q09=`6 [unanswered]`, Q10=`7`.
Q09 has an essay and is answered; the old exported marker was incorrect.
Comments are transcribed verbatim, not rewritten as agent conclusions.
The observation timestamp records receipt inspection, not when the user typed.

The old browser form remains open and unmodified. A visible Windows-window
capture at 2026-09-27T15:41:42.9935967Z showed both "Your review is pending" and
"Answers kept locally in this browser". Local OCR corroborated those labels;
Windows accessibility traversal returned no form values. Thus the pasted chat
answers, not inferred browser state, are the source of this receipt.
Evidence: `reports/visual-layout-review/20260927-answers-recovery-01/`.
The original eight-figure packet remains unchanged in
`reports/visual-layout-review/20260927-drawing-edge-01/capture-emQ55h/`.

## Requirements And Delivery Order

| Response | Required outcome | Current disposition |
| --- | --- | --- |
| Q01 d | Bottom map tools; classify after completing geometry | Bottom toolbar visual pass; classification remains pending |
| Q02 d | Research and expand polygon purposes | Source review below; schema/UI implementation pending |
| Q03 b | Additional line/path types | Source review below; implementation pending |
| Q04 d | Agricultural point types including riser, valve, disconnect | Source review below; implementation pending |
| Q05 d, Q06 d | Large consistent capture controls and hover explanations | First visual pass; responsive/browser acceptance required |
| Q07 d | Default-on, configurable autosave when Keep is selected | Pending persistence/controller work; no autosave claim |
| Q08 d | Larger indicators, meaningful colors and icons | First visual pass; human acceptance pending |
| Q09 essay | Boundary-first, start-point closure, coordinates/elevation, durable pause/resume | Pending state/evidence contract and UI; see constraints below |
| Q10 c | Rework and present another packet | Required; previous design is not accepted |

1. Repair questionnaire capture: fixed Q01-Q10 IDs, choice and verbatim essay,
   versioned catalog, restored answer count, portable annotated figures, JSON
   export and clearly separate local-save, exported and received states. Test
   reload, partial answers, essay-only response, multiline numbering, blocked
   storage and export. Never overwrite a human form to repair it.
2. Bottom tools and larger notices: change `DesignDraftMapSurface.tsx` and
   `DesignDraftWorkspace.tsx`; preserve geometry mutation and camera separation.
   Validate desktop, tablet, narrow and short browser viewports in visible Edge.
3. Pure domain contracts: update `designDraft.ts`, `designDraftEditor.ts`,
   `projectDocument.ts` and relevant render/export adapters with an explicit
   geometry-compatible classification catalog and unfinished-capture envelope.
   Store workflow stage, open vertices, proposed classification and provenance.
   Do not represent paused polygons as valid completed project features.
4. Finish-then-classify UI: shared geometry workflow, field boundary first when
   absent, click-start closure only after valid minimum vertices, dropdown
   category/subtype, name/notes and explicit exclusion effects. Canceling the
   dialog returns to retained geometry, not data loss or implicit commit.
5. Autosave and pause: persistent project preference, default on for new work,
   backward-compatible existing documents. Use `editorSaveCoordinator.ts` for
   ordered revision-aware saves; queue newer edits without marking them saved
   from an older receipt. Surface conflicts/quota failures. Pause must persist
   successfully before promising restart recovery; resume stays on the toolbar.
   Other tools must work while a feature is paused. Archive/reopen retains it.
6. Update help and present repeat figure checkpoints with all responses traced
   to implementation and retest. Measure interaction/render timings on matching
   fixtures before claiming performance improvement.

## Agricultural Classification Proposal

This grouping is a CPLayout product proposal, not an official NRCS taxonomy.
Geometry -> category -> subtype; keep existing/proposed/unknown separate.

| Geometry | Categories and proposed examples |
| --- | --- |
| Polygon | Operational field boundary; exclusions (no irrigation, no machine travel, both); management zones (soil, crop, irrigation, drainage/salinity); physical footprints (building, trees, pond, yard); planning areas (irrigated area, machine/corner-arm envelope); measurement |
| Line | Water conveyance (buried/aboveground pipeline, canal, ditch, drain); electrical (overhead/underground/unknown); access/barriers (road, lane, fence); machine/reference (linear travel, tower track, measurement) |
| Point | Water (well, pump, riser, valve, intake, outlet, meter); electric (pole, disconnect, transformer, panel); obstacles (tree, post, structure); machine/survey (pivot, benchmark, observation, reference marker) |

Provide Other/Unknown where meaningful. A field boundary is not a legal property
survey; a tree marker does not establish canopy or clearance. Management zones
must not silently become obstacles. Mapped utilities are advisory, not excavation,
electrical isolation or safe clearance evidence. Do not infer buried routes or
overhead heights between visible endpoints.

Primary sources reviewed 2026-09-27:

- [NRCS 430, November 2024](https://www.nrcs.usda.gov/sites/default/files/2024-12/Irrigation%20Pipeline%20%28430%29%20%28Ft.%29%20%2811-24%29%20Standard%20Document.pdf): pipelines and appurtenances.
- [NRCS 442, July 2021](https://www.nrcs.usda.gov/sites/default/files/2022-10/Sprinkler_System_442_NHCP_CPS_2021.pdf): sprinkler components and utility considerations.
- [NRCS 449, July 2026](https://www.nrcs.usda.gov/publications/nhcp-notice-179/449-cps-irrigation-water-management-2026.pdf): spatial irrigation management evidence.
- [QGIS editing](https://docs.qgis.org/3.44/en/docs/user_manual/working_with_vector/editing_geometry_attributes.html), [QField digitizing](https://docs.qfield.org/how-to/data-collection/digitize/), [QField forms](https://docs.qfield.org/how-to/project-setup/attributes-form/): geometry capture and attribute forms. Boundary-first is our product requirement, not a claim those tools require it.
- [QField GNSS](https://docs.qfield.org/how-to/navigation-and-positioning/gnss/): receiver and corrected heights require explicit treatment.

## Evidence And Acceptance Gates

Canonical geometry stays projected/local XY. Store measured, digitized/reported,
derived and unknown evidence distinctly. A map click may derive WGS84 only with
valid georeferencing; it cannot produce elevation from screen XY. Missing Z,
datum or georeferencing stays unknown, never zero. DEM elevation is derived,
not surveyed. Receiver elevation must retain height type, datum, antenna
correction and any geoid transformation. No UI change establishes RTK lock or
the strict less-than-0.10 m 3D field requirement.

Tests: reducer/topology and classification compatibility; unknown coordinates/Z;
archive round trips; paused drawing/classification across close/reopen; save
conflicts/failures/races; camera independence; accessible controls and no overlap.
Run `npm run validate`, questionnaire unit tests, `npm run validate:skills`,
`npm audit`, `git diff --check`, and visible Windows Edge workflow screenshots.
Full deterministic `npm run proof:web` remains distinct from a focused packet.
Native MapLibre, hardware, field accuracy and legal/hydraulic design approval
remain unverified; no new packages or native changes are required by this pass.

## Implementation And Review Checkpoint

Delivered in this pass:

- `tools/visualReviewAnswers.cjs`: versioned Q01-Q10 catalog, verbatim answers,
  essay-aware status and inline-image Markdown. The transcription regression
  counts ten responses and retains Q10=c.
- `tools/visualReviewQuestionnaire.cjs`: annotated images and callout legends
  beside questions, lettered choices, automatic restore for blank packets,
  preserved embedded receipts, explicit local-copy conflict guard, JSON/Markdown/
  answered-HTML exports. Existing local answers cannot be overwritten merely
  by reopening an older embedded packet and editing an unrelated answer.
- `tools/buildVisualReviewReceipt.cjs`: creates a new receipt directory only,
  preserves image hashes, derives disposition from Q10 and refuses overwrites.
  Run `npm run test:visual-review` for the 16 tests. Mock-browser semantic tests
  supplement, not replace, actual Windows Edge review.
- Incomplete-design SVG interface: bottom-overlay tools, minimum 48-pixel
  controls, labeled Remove last/Keep/Cancel, explicit hover/focus explanations,
  larger save/readiness text and icons. Camera and geometry remain separate.

Local deliverables (not committed media):

- `reports/visual-layout-review/20260927-answers-recovery-01/receipt-v2/questionnaire.html`:
  portable recorded answers with all 16 original annotated figures/details.
  `questionnaire.md` uses companion relative images; `answers.json` is the
  versioned machine-readable receipt. Some Markdown viewers block data URLs;
  answered HTML is the portable image-bearing browser export.
- `reports/visual-layout-review/20260927-answers-recovery-01/visual-followup/questionnaire.md`:
  four new annotated workflow figures and V01-V04 questions, originals, DOM
  targets and hashes. `review.html` is deliberately read-only, with no false
  promise to capture form input. Responses go in chat or companion Markdown.

Visible Windows Edge checks: six focused tests passed across 1366x900, 768x900
and 390x844 browser viewports (`edge-retry-04`). Polygon, line and point capture,
pending-input refusal, saved geometry after camera changes, tooltip presence,
button size and no horizontal page overflow were checked. Four workflow states
were captured per size. The follow-up packet selects four of those captures.
This is not the full `npm run proof:web` inventory, native-device proof or full
short-landscape/menu-occlusion acceptance.

Edge 154.0.4258.37 questionnaire recheck passed at 2026-09-27T16:06:20.881Z:
all sixteen images decoded; seeded answers matched the receipt; newer local
essay survived an unrelated edit to an older embedded copy; blank-packet reload
restored choices and essay; JSON, Markdown and HTML downloads retained responses;
downloaded HTML reopened with its images. QA data stayed in a separate profile.
Earlier reused-QA-profile download attempts closed unexpectedly and are failed
attempts, not passes. Fresh-profile success does not diagnose that profile issue.

CV inspection and Tesseract 5.3.4 OCR corroborated the capture controls and
statuses on desktop and narrow originals. OCR misread adjacent icons; DOM labels
govern wording. OpenCV 4.13.0 confirmed nonuniform image pixels and dimensions:
desktop 1366x900; narrow 1073x2321 physical pixels for 390x844 CSS viewport.
Nonuniform pixels alone are not usability or geometry proof. Callout labels live
in an added gutter; originals remain unchanged. An initial annotation draft with
incorrect labels is retained as `visual-followup-initial`, not the current packet.

Both the recovered questionnaire and visual follow-up were opened as additional
tabs in the existing user-owned CPLayout Edge profile at 16:07:29-30Z. Windows
reported that window visible, foreground and not minimized. The original form
was not reloaded, edited or closed. Old static preview `http://127.0.0.1:19006`
remains unchanged; new live preview is `http://127.0.0.1:8084`.

Runtime/process limitations: Metro initially served stale watched workspace
source. Its new preview was restarted after direct PID/process-group ownership
verification; the old review was not touched. The launcher currently recognizes
the listener as healthy but reports `launcherOwned: false` because npm rewrote
its command line; do not use an aggregate stop that would close the original
review. Record this launcher ownership-detection defect for a separate fix.
The first premature requests failed before Metro became reachable. Future runs
must await Windows-local HTTP readiness and bind served bytes/source maps.

Independent read-only QA found and rechecked the local-answer overwrite fix and
the disposition derivation fix. No human acceptance is inferred. Classification,
autosave, durable pause/resume, coordinate/elevation evidence and measured
performance optimization remain pending work, not capabilities of this pass.

Final checks: `npm run validate` exited 0, including 346 native-workspace source
tests (`validate-final.log` in the recovery packet); `npm run test:visual-review`
passed 16 tests; `npm run validate:skills`, context-map freshness and
`git diff --check` passed; `npm audit` reported zero vulnerabilities. The served
Metro source map matched both edited UI files at 2026-09-27T16:08:49.820Z; see
`source-binding.json`. These are source/focused-browser results, not a complete
browser inventory, native runtime or field qualification. Existing unrelated
dirty work was preserved; no commit, push or branch operation was performed.
