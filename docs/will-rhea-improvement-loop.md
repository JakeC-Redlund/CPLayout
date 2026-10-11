# Will Rhea Mapping Improvement Loop

Historical packet/evidence log. Use [development-status.md](development-status.md)
for current owners, priorities, acceptance gaps and resource state. Earlier
same-day pending-review and open-session statements are checkpoint history.

Status: active, 2026-09-27. Complexity/selected reasoning: xhigh. Subagent decision:
required. Read-only model and source review precede two disjoint geometry workers;
the coordinator owns UI, browser capture, questionnaires and documentation.
Existing dirty work and owner-supplied evidence remain intact. No publication.

## Scope And Evidence

The owner requests multiple center pivots in one field boundary, clearer mapping,
improved automatic layouts, and better corner-machine acreage and paths. The
Will Rhea example is the review fixture, not a certified client design. Canonical
coordinates remain EPSG:32614 XY. Imported outlines, generated alternatives,
saved machines, operating paths and measured irrigation must remain distinct.

Baseline visible Windows Edge captures and DOM measurements are under
`reports/visual-layout-review/will-rhea-20260927/baseline/`. The screenshot review
tool generated local pixel/OCR evidence under the sibling `cv-baseline/` folder.
External imagery requests were deliberately blocked; the visible unavailable-map
notice is expected, not clean-network or aerial-render proof. The actual map
geometry remains visible. Raw owner-specific coordinates/screenshots stay local.

Observed baseline defects:

- Nested sidebar/form framing leaves the generated-plan content only 188 CSS
  pixels wide on the 1366-pixel desktop capture.
- The fixed current machine template produces zero feasible generated centers
  for three requested pivots in this example. This is not proof that no smaller,
  mixed-size or partial-sweep arrangement is feasible.
- Two separate preferred-outline-derived models are already rendered inside the
  common boundary. They are not two first-class saved machine records.
- Summing rounded component areas produces a false 0.001-acre overlap in the
  disjoint Will Rhea outline models. Arithmetic must precede display rounding.
- Corner configuration, measured drive speed, orientation and SDU guidance are
  not verified in this fixture. Missing evidence must not be shown as assessed
  zero corner coverage or filled with invented equipment values.

## Iterations

1. Baseline: capture map, generated-plan section and corner blockers in visible
   Edge; inspect pixels and authoritative DOM rectangles; retain originals.
2. Model repair: reject nonfinite/invalid planner counts and separation options,
   bound computational search options, and compute raw polygon area before
   rounding. Separate net added corner area and inter-machine overlap footprint.
3. Interface: expose a transient requested-pivot count using the shared cancellable
   analysis job; put modeled outline coverage and generated alternatives at the
   beginning of Calculate; reduce inline form framing. Count changes cannot save
   machines or mutate project geometry. Missing corner inputs stay explicit.
4. Verify: run focused geometry tests, source validation, audit and visible Edge
   desktop/narrow interactions. Check storage invariance, stale-result masking,
   actual rendered controls and source/build identity. Record failures unchanged.
5. Human review: issue a new fingerprint-bound questionnaire with inline annotated
   captures, fixed question IDs and essays. Archive/verify the completed W01-W04
   receipt, close its owned hub and unused map tabs, and stop unused servers.
6. Resume from received answers and measured failures, not an arbitrary iteration
   count or a claimed global optimum. Further packets below remain open.

## Remaining Implementation Packets

### Recorded R01-R04 Direction

The completed local browser receipt revision 17 was exported and verified after
server shutdown on 2026-09-27 (`human-completed-r17/` in the local packet root).
The owned questionnaire closed on completion; its hub was archived and closed,
and review server 43159 was verified stopped. Unrelated browser tabs remain intact.

- R01 d: "Instead of accepting the existing layouts, continue to iterate until
  optimum coverage is acheived". Treat outlines as comparison evidence, not
  accepted final layouts. Report search bounds and convergence honestly; heuristic
  search cannot certify a global optimum.
- R02 b: "Each machine should further allow continued iteration to explore
  various layouts, including corner arms, end-guns, benders, etc.". Preserve
  independent editable machines and scenario comparisons as requirements.
  Bender geometry needs an explicit articulation/configuration model and sources;
  it must not be represented by changing a corner-arm label.
- R03 c: "A separate full-screen calculation view" (no essay).
- R04 c: "A guided form for each missing input" (no essay).

These are requested changes, not acceptance of current UI or field qualification.

### Open Packets

- **First-class multiple machines:** version the project schema around one common
  field boundary plus stable machine IDs, centers, configurations, source evidence
  and per-machine paths. Freeze legacy readers and migrate a legacy single machine
  without duplication. Update reducers/undo, workspace repository, native adapters,
  ZIP/JSON/XML/KML, selection/rendering and tests together. Existing review zones
  cannot silently become installed machines. Layout target selection and RTK gates
  must identify a specific machine. Test save/reopen/export/import and removals.
- **Search quality:** allow explicit alternative machine packages/radii and sweeps,
  then mixed-size combinations and clearance-aware scoring. Report candidate set,
  heuristic limits, rejected constraints, overlap and incremental net coverage.

  R02 additionally requires bender alternatives. The current
  [Valley Bender30/Bender160 page](https://www.valleyirrigation.com/bender30-bender160)
  (checked 2026-09-27) distinguishes model-specific bending limits, optional
  shutoff of stopped spans and multiple bends on a machine. These are manufacturer
  feature descriptions, not verified compatibility for Will Rhea. Plan explicit
  articulation positions, per-segment motion and wet/disabled-span states; require
  configuration evidence before evaluating them. The current project schema has
  one `machine`/`pivotCenter` and no bender model. Do not encode a bender by
  increasing radius or renaming a corner arm.
  Do not call an unsuccessful fixed-template search site infeasibility or a greedy
  result optimal. No fabricated vendor package or cost parameters.
- **Corner paths:** associate sourced guidance with the correct machine; evaluate
  continuous articulation branch, leading/trailing orientation, reversals,
  steering and drive-rate constraints, start/stop sectors and numerical convergence.
  Separate tower track, structural envelope and sprinkler wet footprint. The
  current radial envelope/max-reach annulus is not a validated operating trajectory.
- **Water application:** union moving wet footprints using sourced reach and
  on/off sequencing. Incorporate pressure/flow/nozzle/timing inputs only with
  provenance. Geometry alone cannot establish application uniformity or depth.
- **Map-first layout:** W03 requests more drawing space on narrow viewports.
  Collapse secondary information behind reachable controls without hiding active
  errors, draft state, RTK qualification or the drawing toolbar. Recheck completed
  project and incomplete-draft surfaces separately; they are not the same UI.
- **Drawing workflow:** retain the classification foundation and versioned paused
  captures; finish atomic classified commits and export migration before wiring
  post-drawing forms, default-on autosave and persistent pause/resume.

## Area Accounting

Use the existing polygon-clipping implementation in projected metres. For machine
wet footprints W, clipped to the same field and explicit no-spray exclusions:

```text
net covered area = area(union(W))
shared coverage footprint = area(union(pairwise intersections of W))
duplicate contribution = sum(area(W)) - area(union(W))
net added corner area = area(full wet union minus union(all base + end-gun coverage))
```

Triple-covered land counts once as shared footprint but twice as duplicate
contribution. Wet overlap is not mechanical collision. Gross component acreage
remains available for compatibility; it is not net added corner acreage.

## Primary Sources

Reviewed 2026-09-27. These sources justify distinctions and needed inputs, not
Will Rhea equipment identification, surveyed coordinates or a certified design.

- [Valley VFlex](https://www.valleyirrigation.com/vflex-corner): guidance, steering,
  sequencing and configuration choices require more than a circular reach envelope.
- [Lindsay expanded-acreage solutions](https://www.lindsay.com/usca/en/irrigation/zimmatic/pivots-and-laterals/expanded-acreage-solutions):
  corner guidance and application control are related but separate systems.
- [Nebraska Extension VRI](https://water.unl.edu/article/agricultural-irrigation/considerations-adopting-variable-rate-irrigation/):
  overlapping pivot coverage can cause over-application without suitable control.
- [USDA ARS field study](https://www.ars.usda.gov/research/publications/publication/?seqNo115=229992):
  adjacent-pivot application was studied with position, flow and pressure monitoring.
- [Nebraska Chemigation Manual, Appendix E](https://pested.unl.edu/sites/unl.edu.ianr.extension.pesticide-education/files/media/file/2022Chemigation%20Manual%20Final10.24.22.pdf):
  estimates account for field geometry, reach, end guns and corner area. Example
  dimensions do not supply this project's missing machine inputs.
- [Carey and Bailey, 2021 abstract](https://elibrary.asabe.org/abstract.asp?aid=52455):
  ancillary-span motion affects uniformity testing. Abstract only; no adopted
  standard or full-text review claimed.

## Acceptance Boundaries

### 2026-09-27 Implementation Checkpoint

Implemented transient 1-4 requested-pivot controls, a leading mapped-outline/net
coverage summary, explicit missing corner-model status and less inline form
framing. The shared calculation request includes count and project generation;
preview selection does not dispatch project mutations. Full independent saved
machines and mixed-size automatic search remain pending.

Planner guards reject 86 malformed-option fixtures before calculation. Caps are
8 machines, 24 grid divisions and 128 shortlist candidates, not physical limits.
The independent reviewer confirmed ledger-only output changes and corrected the
UI wording: fewer discovered candidates do not establish physical impossibility.

`npm run validate` passed with native-workspace source result
`/tmp/cplayout-native-workspace-w9A99h/result.json` (346 checks, not device proof).
The new classification suite passes 11 tests. The review-system suite passes 96.
The final visible Windows Edge regression passes both desktop and 390-pixel
viewports, including 1/4 bounds, received results and unchanged local storage.
The first narrow run failed because the test omitted inspector navigation;
failure evidence remains under `regression/`, corrected proof under
`regression-final/`. No retry result replaces the failed artifact.

Final screenshots/DOM are under `desktop-final/` and `mobile-final/` in the local
packet root. Originals remain unchanged; four separate annotated PNGs and
catalog/manifest form `packet/`. Coordinator pixel review and local OCR/PNG
metrics were performed; OCR is supplementary, not source wording or semantic
field recognition. External imagery was intentionally blocked. Full `proof:web`
and native/hardware/field tests were not run in this pass.

The old map tab was explicitly closed at the owner's request. Obsolete servers
8084, 8085 and 19006 were ownership-checked and verified stopped; stale 19014 state
was reconciled. The temporary final-build server 19020 was also stopped after
capture and regression tests. Only the new active questionnaire should remain
for human input. Exact cleanup artifacts are retained in the local packet root.

The synthetic questionnaire proof passed in visible Edge, including disk/reload
retention, conflict recovery and owned-tab completion cleanup. Its server 43487
was then verified stopped, and its separate `qa-export/` was independently
verified offline. Synthetic responses are not human acceptance.

The replacement human R01-R04 review was initialized at
`http://127.0.0.1:43159`, with its owned hub and questionnaire opened in visible
Windows Edge. Its state lives in `human-session/` under the local packet root;
the four annotated figures and capture fingerprint are preserved there. This is
the sole intentionally retained review server while answers are pending, not a
restarted map server. Read current disk acknowledgments before acting on any
answers; archive and close this session when complete or superseded.

### Audited Ledger Delta

The frozen scheduling fixture compares the previous implementation loaded from
Git with the changed module against the same fixtures and options. All output
outside `acreLedger` is deeply identical. Sample/real fixtures add only two zero
fields. The Will Rhea scheduling fixture deliberately enables a public fallback
corner and 30.48 m end gun: standard component sum changes 65.978 to 65.977 acres,
gross duplicate contribution 19.953 to 19.951 acres, net added corner is 10.786,
and shared footprint is 6.808. These are synthetic review options, not this
example's verified equipment. Only render-model hashes were updated; planner,
multi-machine review, yield-count and immutability assertions remain unchanged.

Independent review also reproduced a pre-existing clipping failure before ledger
calculation: three overlapping synthetic corner-machine physical envelopes with
a narrow no-spray exclusion throw an incomplete-output-ring error in
`buildPhysicalEnvelopeConflicts`. Both HEAD and changed source fail identically;
removing the synthetic corner configuration succeeds. At that checkpoint it
remained open and blocked robust overlapping-corner layout claims. The
reproduction is retained under the local review packet; no jitter, fabricated
geometry or silent success fallback was introduced.

### Follow-Up: Decimal Overlay Repair

The previously open incomplete-ring failure is repaired for advisory render-model
overlay operations by `polyclip-ts@0.16.8`; other modules still use the existing
engine. The original failure script remains unchanged as historical evidence.
The permanent regression now exercises all three overlapping corners, positive
bounded physical conflicts, machine-order reversal, UTM-sized translation,
source immutability, exclusions and an independent circle-grid wet-area oracle.
No epsilon snapping, geometry perturbation or swallowed exception was added.

Independent review of the captured intersection found all 25,600 membership
samples consistent, no proper crossings among 1,398 edges, and matching area
from independent vertical-slice integration. Tiny floating fragments remain
possible: use explicit numeric area allowances, not exact emptiness as proof.
The repair does not certify kinematics, continuous clearance or hardware safety.

The local `clipping-reproduction/audit-overlay.ts` compares the old/new engines
on the same current module. All non-polygon output is deeply equal for the three
scheduling fixtures. The largest Will Rhea polygon symmetric-difference area is
`5.876313695043394e-8 m2`; metrics, paths, warnings and instances are unchanged.
Only that fixture's render hash changed, from `e53c9a94...` to `d88234c6...`.
One non-isolated timing sample was 9.878 seconds old / 8.842 seconds new; this is
not a performance speedup claim. Hundreds of sampled buffer unions still use
the original engine and remain separately scheduled.

Remaining physical-model issues are separate: sampled corner envelopes do not
yet establish the complete articulated-arm swept region, and the full-circle
buffer path's omitted closing segment needs dedicated model review. These
must not be concealed by successful clipping or positive conflict polygons.

### Overlay Repair Acceptance: 2026-09-27

Final `npm run validate` exited 0, including all geometry regressions and 346
native-workspace source tests (`/tmp/cplayout-native-workspace-f3wg5Z/result.json`).
The final geometry typecheck, skills/context-map validation, whitespace check and
post-install audit passed; audit reports zero vulnerabilities. Lockfile comparison
against the saved dirty before-state changes only the geometry dependency entry
and three new package records. No unrelated dependency versions were changed.

The fresh Expo web export and two visible Windows Edge regression tests passed
at 1366x900 and 390x844. Four workflow captures per viewport are retained in
`overlay-desktop/` and `overlay-mobile/` under the local packet root; original
R01-R04 evidence remains unchanged. Pixel inspection found the existing layout
limitations, not a new display change. No page exceptions or horizontal overflow
were observed, and preview controls left browser storage unchanged. External
imagery was deliberately blocked; this is not imagery/network proof.

Served and exported `index-58b2a6e65f6b2ad31be459855dfc4fd8.js` bytes match
SHA-256 `006c18dcf76b9eef2e30f2c22277752ed24280d0e06204a476532b9b159c6777`.
The exported `advisory-overlay-notices.txt` matches its source. QA browser windows
closed, test server 19020 was verified stopped, and the launcher reports no
recorded app servers. Review servers 43159 and 43487 also remain stopped; the
unrelated browser tab was preserved. No commit or push was performed.

This packet does not run full `proof:web`, native device/receiver/relay/radio or
surveyed 3D tests. It repairs the reproduced overlay failure, not the complete
refactor, continuous physical collision model or engineering qualification.

### R03 Full-Screen Calculation Follow-Up

Complexity: high; selected reasoning: high. Subagent decision: required.
Aquinas performed bounded read-only navigation/state review; the coordinator
owned App and browser-test edits. No schema, geometry or dependency changes
are part of this follow-up. The existing dirty worktree remains preserved.

R03=c is implemented as a full-screen calculation modal at every viewport,
with a fixed Back command and project save status. The map remains mounted,
and preview count/cost state remains owned by App. Placement confirmation
uses the same modal owner; Escape cancels confirmation before leaving Calculate.
The independent review found and prompted repair of a dismissal effect that
otherwise reopened the selected feature sidebar. Normal feature selection
continues to open its editor.

Regression scope includes full-screen dimensions across responsive breakpoints,
single rendering, count/cost retention after reopening, unchanged storage,
placement Cancel/Escape/Confirm, explicit zone saving, map instance/camera,
selected-feature sidebar return and unfinished polygon capture. Windows Edge
captures and a new S01-S02 review packet live under
`reports/visual-layout-review/fullscreen-20260927/`; completed R01-R04 answers
remain unchanged. Human acceptance of the replacement is not inferred.

The first new browser assertions incorrectly assumed the imported Will Rhea
example was saved; they now compare the actual pre-calculation save state.
Generated context-map hashes were stale after source edits and were rebuilt;
skill validation then passed. The interface skill now requires return-state
checks for full-screen map tools, not just viewport-size assertions.

Remaining work includes the guided missing-input forms requested by R04,
independent saved machine editing and iterative configuration search from
R01/R02. Full-screen presentation does not prove optimum coverage, native
runtime behavior or physical positioning accuracy. Collapsed-drawer return
and native confirmation focus remain separate verification gaps.

Final checks on 2026-09-27: `npm run validate` passed, including 346
native-workspace source tests (`/tmp/cplayout-native-workspace-2zHuPX/result.json`).
The final App typecheck, 96 visual-review tests, skills validation, context-map
check, whitespace check and audit passed; audit reports zero vulnerabilities.
Eight final visible Edge checks passed at 1366x900 and 390x844, including
resize checks at 820x700 and 844x390. The selected-feature return assertion is
desktop-only; the mobile branch of that older test checks map visibility.
An earlier eight-check run additionally exercised cost and explicit zone-save
flows. Full `proof:web` and native device tests were not run for this packet.

Fresh captures were visually inspected with DOM bounds; no page exceptions
were recorded. Served bundle `index-a96054ebe77036db33da8128a9852770.js` was
byte-verified against the export. Capture manifest fingerprint:
`b2334d24b229c25b983bceb04ede160941fcb712bf44d7620abd37294c354278`.
Desktop control spacing remains broad and is available for human feedback.

All QA Edge windows closed. App server 19020 was verified stopped, and the
launcher reports no recorded app servers. The dedicated human Edge profile
contains only the current review hub/questionnaire plus its unrelated extension
tab; no unused map tab remains. The S01-S02 review server is intentionally
retained for human input, with its resource lease under the new human-session
directory. Initial revision 2 contains no answers. No commit or push occurred.

### Cyclic Corner-Path Repair: 2026-09-27

Complexity and reasoning: high. Subagent decision: required; Dirac reviewed
closure risks and regression requirements read-only, with coordinator-owned
geometry/tests. Pre-existing unrelated changes are preserved. The previous
full-screen pass is progress, not a verified wait or full-goal completion.

Source review and four failing-before tests established three defects: full-circle
buffers omitted the last-to-first segment, near-full partial centerlines could
close solely because they had 288 samples, and sampled extension slopes omitted
the cyclic pair. A shared internal traversal now appends the first sample only
for a full-circle sweep with both cyclic-neighbor indices present. Buffers,
centerlines and slope summaries use it; exported samples remain unique. Gaps in
boundary/evidence support are not bridged. Partial sweeps remain open.

The 12 focused cases, including positive isolated-cap assertions, passed in the
first aggregate run. They cover both wheel/overhang paths, inside/outside normal probes,
holes, clockwise/counterclockwise partials, wraparound angles, missing/empty
support, only the two cyclic neighbors, slope change, UTM offsets, input
immutability and 90/180-degree evidence rotation. The permanent test command
includes `cornerPathClosure.test.ts`; aggregate acceptance is recorded separately.

The before-source archive and an in-memory bundled old/new comparison are
retained under `/tmp/cplayout-corner-closure-before-20260927.tar.gz` and
`.cplayout-local/publication-checkpoint-20260927/reports/geometry-corner-closure-20260927/`. Eight of nine complete scheduling
outputs are identical. Only the Will Rhea render hash changes, from `d88234c6...`
to `2571acbf...`. Its second surface gains `1.7525861709514896 m2` in physical
envelope, with `3.406256388061024e-10 m2` numerical removal. Wheel and overhang
shortfall-envelope displayed acres each rise by 0.001; wet polygons, wet acres
and the acreage ledger are deeply unchanged. Only this audited frozen render
expectation was updated. No new package or storage/schema change was required.

The audit helper initially rejected an incorrectly named wet-coverage field;
it was corrected against the actual interface and then passed. This failure
did not authorize an expectation update or change product output.

For the geometric meaning of a line buffer, the primary
[Shapely buffer reference](https://shapely.readthedocs.io/en/stable/reference/shapely.buffer.html)
was checked on 2026-09-27: it describes distance-based buffering and polygonal
approximation of rounded caps. This is conceptual reference only; Shapely was
not installed into React Native or used as product runtime. The tests validate
sampled polyline closure, not continuous machine motion or an articulated arm's
complete swept region. Those model limits, saved multi-machine editing, guided
corner inputs, native runtime and surveyed 3D accuracy remain open.

The first aggregate run failed a different regression's fixed collision area:
its old input buffers yielded `1969.7399403769446 m2`. The repaired input buffers
legitimately change that intersection. Rather than substituting an output-derived
constant, the test now independently integrates the two input polygon sets over
vertical partitions at vertices and edge crossings. It handles holes and disjoint
components, normalizes the coordinate origin, bounds skipped unrepresentable
strips, and has analytic empty/disjoint/holed/multipart/crossing-triangle and
near-parallel controls. Independent source review accepted the integration
method; the focused suite passed and reported `1969.765447527168 m2`. The
original aggregate failure is retained as a failure, with a full rerun required.

Two fresh visible Windows Edge checks passed against
`index-75df0694d7bc23991ea185c6f064dba0.js`. Desktop/phone workflow captures under
the geometry packet report unchanged preview storage, no page exceptions or
horizontal page overflow, and closed QA browsers. External imagery was blocked.
Pixel review still shows a crowded desktop map with lower machine detail under
the persistent controls; this is an existing interface issue, not a geometry
acceptance or a completed optimizer. The full-screen calculation layout is
unchanged. S01-S02 remains tied to its earlier captured layout, not this model
repair. App server 19020 was verified stopped; only the pending review remains.

Next R04 integration review located `CornerArmKinematicStatusPanel`, the
`cornerArmKinematicResult` input construction, `cornerArmGuidancePath`, and the
existing machine drive-speed form in `apps/mobile/App.tsx`. The current guidance
helper picks the first `linear_move_path`; unspecified orientation becomes
leading, and full-circle rotation becomes counterclockwise. The guided form must
replace those implicit choices with explicit operator selections, without
promoting unrelated linear geometry or scaffold catalog data into verified
corner evidence. Preserve unknown input state, route to the existing reducer
for saved machine edits, and keep preview-only choices clearly separate. Any
new persisted choice needs core document/archive tests before UI wiring.

Run `npm run validate`, targeted geometry tests, `npm run test:visual-review`,
`npm run validate:skills`, `npm run context-map:check`, `git diff --check`, and
`npm audit`. Browser observations need actual Windows Edge evidence and matching
served code. Native persistence, physical receiver/relay operation, <0.10 m 3D
accuracy, hydraulic performance and final engineering remain unverified.

Final acceptance for this bounded repair: the full `npm run validate` rerun
exited 0, including all 12 closure cases, the final independent intersection
controls and 346 Node SQLite/native-bridge source tests. The latter retained
their input-drift record at `/tmp/cplayout-native-workspace-PNZjI9/result.json`;
they are not Android/iOS device proof. `npm run test:visual-review` passed all
96 tests. Skill validation, context-map freshness and `git diff --check` passed;
the final `npm audit` reported zero vulnerabilities. The two visible Windows
Edge checks and captures above remain the bounded browser evidence; the full
`proof:web` suite was not run in this pass.

Final Windows Edge inventory contains the active review hub/questionnaire and
an unrelated extension tab, with no map tab. Launcher status reports no owned
app servers. S01-S02 was unanswered at the revision 3 answer check; a subsequent
agent progress message records this validation without adding human answers.
Only its review server is intentionally retained at `http://127.0.0.1:43215`.
Older replacement-check
guidance was corrected to preserve only actively used map tabs, not all prior
map tabs. No commit or push occurred. The full refactor remains incomplete.

### Guided Corner Inputs: 2026-09-27

Previous goal turn: progress (cyclic-path repair and verified cleanup). This pass
continues R04 without declaring the broader refactor complete. Complexity: high;
selected reasoning: high. Subagent decision: required. Leibniz owns only the
kinematics admission module/tests after an initial read-only review; Maxwell
reviews app state, controls and tests read-only. The coordinator owns app wiring,
browser evidence and integration. Pre-existing unrelated edits are preserved.
Recovery snapshot: `/tmp/cplayout-corner-inputs-before-20260927.tar.gz`.

The calculation view now offers LRDU speed (m/min at 100% timer), a catalog model,
rotation, orientation and an explicitly selected saved line. No full-circle
rotation, unspecified orientation or first `linear_move_path` is silently chosen.
Known saved speed/orientation and a saved partial-sweep direction may initialize
their fields; model and guidance selection remain explicit. Catalog dimensions
remain unverified, and selecting an arbitrary line does not verify SDU suitability.
No calculation runs while typing: an explicit command starts the preview. Missing
inputs have a checklist, not a panel of zero-valued calculation outputs.

These inputs are temporary analysis choices, not saved machine changes. Closing
and reopening Calculate retains them in the current project session. A different
load generation or changed machine/geometry scope retires them; undo cannot
revive a retired selection. Clearance/settings changes retain choices but discard
old results. New persisted configuration, manufacturer-confirmed model admission,
saved independent machines and comparison optimization remain open work.

Review found additional admission defects in the existing kinematics function.
Missing versus malformed direction/orientation now fail before sampling. Invalid
model limits and inconsistent declared provenance fail explicitly. Absent optional
limits produce specific qualification blockers. Matching source-status metadata
does not establish artifact/manufacturer verification, and all results remain
advisory with continuous-motion limitations. Tests include all four valid
rotation/orientation combinations and malformed metadata/limit controls.

UI review caught clearance-driven input loss and menu focus loss. The input scope
now excludes settings, and option menus include selected accessible labels, focus
return and arrow/Home/End/Enter/Space/Escape handling. The first visible Edge run
failed the keyboard check against an earlier export still rendering radio items;
that failure is retained under `.cplayout-local/publication-checkpoint-20260927/reports/corner-inputs-20260927/edge-initial`.
The old owned server was verified stopped before a fresh export. Final acceptance
and screenshot observations are recorded below after their checks finish.

The next browser iteration passed focus navigation but exposed nested Escape
dismissal: React Native Web's installed ModalContent listens on document `keyup`,
so closing the submenu only on `keydown` also dismissed Calculate. The submenu
now consumes the release event before returning focus. Desktop and narrow Edge
checks passed after this fix, including same-ID project reload and clearance
retention. The first annotated narrow capture also exposed a compressed warning
icon. Fixed icon dimensions are now asserted as 20 x 20 CSS pixels; the original
packet is retained and a separate final packet is captured after that change.

The next saved-machine contract remains a separate versioned packet. Current
source still declares `PROJECT_DOCUMENT_VERSION = "pivot-project-v1"` and one
canonical `machine` / `pivotCenter`; `AdvisoryMachineRenderInstance` explicitly
declares `advisoryOnly: true` and `canonicalGeometryMutation: false`. Do not persist
the new temporary choices into arbitrary map-feature properties as a substitute
for that contract. The first-class-machine packet above must cover per-machine
source/path associations and the single-machine WGS84 companion, observation
references, reducers and archive readers before changing saved geometry.

Final browser acceptance: four checks passed in visible Windows Edge
154.0.4258.37 at 1366 x 900 and 390 x 844, under
`.cplayout-local/publication-checkpoint-20260927/reports/corner-inputs-20260927/edge-icons-final`. They cover full-screen preview
preservation plus explicit input selection, keyboard navigation/focus, nested and
outer Escape, missing/invalid inputs, result invalidation, retained clearance
choices, same-ID reload, storage nonmutation and 20 x 20 warning icons.
The final annotated figures and inline-image Markdown questionnaire are under
`.cplayout-local/publication-checkpoint-20260927/reports/corner-inputs-20260927/packet-final/`; capture fingerprint:
`1d884c61b07b70eb949b8edbec309c9a3baecd7ba31c1b4f9270cb4f598bc44f`.
Served bundle `index-de0f44dddc0d67ad65d77c24decd6419.js` was byte-compared with
the export. Both cropped form figures were inspected visually with DOM targets;
no overlap or page exception was observed. External imagery was blocked.

The new C01-C02 packet is prepared, not presented as a replacement for the still
unanswered S01-S02 session. The live review received a progress message linking
its local artifact path without changing human answers. QA windows closed;
server 19020 was verified stopped and launcher status reports no owned app server.
The remaining dedicated Edge tabs are the active review hub/questionnaire and
the unrelated extension tab. There is no retained map tab. Human acceptance,
native device behavior and surveyed <0.10 m maximum 3D error remain unverified.

Final source acceptance: `npm run validate` was rerun after the final icon change
and exited 0. It includes the six new input-adapter cases, expanded kinematics
admission tests and 346 Node SQLite/native-bridge source tests. The latter's
input-drift evidence is `/tmp/cplayout-native-workspace-1d4R3Q/result.json`.
The earlier aggregate also passed; it is not substituted for this final run.
`npm run test:visual-review` passed 96 tests; `npm run validate:skills`,
`npm run context-map:check` and `git diff --check` passed. `npm audit` reported
zero vulnerabilities. No packages, project schema, archive format or saved-machine
contract changed in this pass. The full `proof:web` suite and physical/native
device checks were not run. No commit or push occurred; the full goal stays active.

### Saved-Machine Compatibility Guard: 2026-09-27

Scope: a prerequisite to first-class machines, not their implementation.
Complexity/reasoning xhigh for storage compatibility review; one bounded high-effort
read-only reviewer (Raman), coordinator-only writes. Existing dirty work is retained.
No new dependency, project version, migration or native adapter is enabled.

Direct reproduction found that the core reader accepted a bare-shaped project
declaring `pivot-project-v2`; schema normalization discarded its new `machines`
array. A subsequent write could therefore lose that data. The reader now rejects
any present unsupported document version before legacy fallback. The v1 root and
envelope reserve `machines` and `selectedMachineId` with rejecting schemas; direct
schema admission, reducers, serialization and recovery export also reject supplied
values instead of dropping them. A document marker inside a bare project cannot
bypass version-envelope admission through the serializer.

Independent review and the archive regression suite confirmed that historical
read-only normalization intentionally accepts other unknown metadata. A first
blanket-strict implementation broke that contract and was withdrawn. Generic
legacy metadata and the existing local-only settings sanitation remain unchanged;
editable imports retain their separate recursive no-field-loss checks. These
reserved fields are a narrow safeguard, not universal future-format support.
The [Zod object documentation](https://zod.dev/api#objects), consulted 2026-09-27,
describes default unknown-key stripping; installed-package tests govern this fix.

Regression scope includes bare/string/wrapped inputs, malformed version markers,
empty/null machine data, direct serializer admission, reducer rejection with
unchanged project/revision/history, and compressed/stored ZIP refusal with original
bytes retained. Existing valid sample and Will Rhea round-trips remain covered.
The first focused attempts also caught an incorrect Zod API call and a test
comparison of an explicit undefined property against JSON omission; both were
corrected before final validation. Final acceptance is recorded below after checks.

Browser lifecycle was rechecked first: no map tab and no launcher-owned app
server existed. The pending S01-S02 review and unrelated extension tab remain;
no UI was changed or browser QA opened. Human answers remain pending. AGENTS.md
now explicitly requires closing unused maps and their owned servers after bounded
work, including failed checks, while preserving unsaved state and unrelated tabs.

Independent final review found no blocking guard defect and passed core no-emit
typechecking. Adopt its next architecture recommendation: an independent versioned
field-design document owns common projected XY geometry, CRS and infrastructure,
plus stable machine instances, each with one authoritative configuration/center.
Retain `pivot-project-v1` unchanged for legacy single-machine documents. Do not
maintain a second mutable legacy-primary copy or infer common geometry from catalog
grouping. An explicit conversion must retain original v1 bytes for recovery.

Next implementation starts in a new core field-document module and its tests;
select the document version and exact machine/source/path schemas there before
wiring a new workspace payload kind. Activation must coordinate workspace/native
migration, reducer/undo, dedicated ZIP/JSON/XML/KML contracts, renderer selection
and machine-scoped Layout targets. Acceptance requires reference integrity,
multi-machine save/reopen/export/import, stale-save/deletion rejection, unchanged
CRS, interrupted-migration recovery and old-reader refusal. The document design
is proposed next work, not currently supported storage. Do not remove the v1
guards to pass new field data through old readers.

Validation process: focused project-document tests and 14 archive cases passed;
core typechecking passed after correcting a test-only excess-property literal.
The initial aggregate run overlapped source edits and was explicitly stopped
(exit 143) as superseded, not reported as a pass. A clean final aggregate is
logged at `/tmp/cplayout-machine-admission-final-20260927.log`. The AGENTS change
initially invalidated generated context-map checks; regeneration restored both
`validate:skills` and `context-map:check`. Audit reported zero vulnerabilities.

Final acceptance: `npm run validate` exited 0 against the final code, including
346 storage/native-bridge source tests. Their evidence is
`/tmp/cplayout-native-workspace-Wolz8p/result.json`; this is not device proof.
The three changed TypeScript/test files retained identical SHA-256 hashes across
the final aggregate run. `git diff --check` passed. No browser UI changed, so no
map/QA browser or app server was started and `proof:web` was not rerun. Final
inventory again found only the pending review hub/questionnaire and unrelated
extension tab, with no launcher-owned app server. No commit/push or native/field
verification occurred. The full goal remains incomplete.

### Independent Field Documents And Received S01-S02: 2026-09-27

Previous turn classification: progress (implemented/validated the v1 data-loss
guard). This pass implements the [field-design contract](field-design-contract.md):
shared field geometry/infrastructure with separately identified machines, explicit
guidance/source references, original-text-preserving conversion, strict round-trips
and independent machine edit/selection/undo/redo. This is real core functionality,
not yet activated workspace/native storage, calculations or renderer support.

Complexity/reasoning xhigh. Confucius and Archimedes performed bounded high-effort
read-only storage/GIS review; Franklin owned only the two new reducer files.
Coordinator owned the document, shared-helper move, integration and records.
Final reviews found no blocking defects. A proposed P2 about nested defaults was
withdrawn after distinguishing required policies from optional fields: conversion
must refuse to invent required values; optional fields remain absent. A regression
now fixes that decision in tests. Early focused failures were incorrect synthetic
v2 evidence/type imports and a closure-narrowing test error; corrected final
focused checks pass 18 document and 13 editor cases. Archive/workspace regressions
pass 14 and 20 cases respectively. Aggregate acceptance follows after completion.

The already-installed MIT `jsonc-parser@3.3.1` is declared in core with an offline,
exact-version install. The existing strict parser and field-retention helper move
to core unchanged; old project-store imports re-export them. This follows the
dependency direction and retains existing duplicate-key/unknown-field behavior.
No native package, paid API, cloud dependency or package version upgrade was added.

#### Received Human Responses

S01-S02 completed at revision 18, `2026-09-27T20:30:46.195Z`. The standalone export
is `reports/visual-layout-review/fullscreen-20260927/human-completed-r18/`, verified
before and after server shutdown. Preserve its JSON, inline-figure receipt,
manifest and original answer text.

- **S01 c, "Rework this view; explain":** "The buttons look or whatever they are
  called makes no sense. This should look like a form, as if a paper printout
  style report"
- **S02 a, "Yes, retain this arrangement":** blank comment. This question was
  specifically about Back and project status on the narrow view, not blanket
  acceptance of the mobile layout or calculation results.

The questionnaire closed itself after acknowledged completion. The live completed
receipt was matched against the export, the hub's visible controls were archived
to `completed-hub-controls-r18.json`, and the exact hub was closed. Windows tab
inventory then contained only the unrelated extension tab. Session stop reported
`verified-stopped` and lock removal; no map tab or app server was started. There
is no longer a pending S01-S02 server to retain for input.

#### Next Visual Iteration

Reviewed the actual exported S01 figure with local image inspection. Observable
issues include a widely separated requested-pivot stepper and a nested Cost Review
box with three large "Missing / USD / Local" tiles and several badge-like labels.
These are agent observations of that historical capture, not invented explanations
for the user's wording. Its coverage values are historical advisory outputs.

Implement S01 as an unframed, report-style form: concise report/project header,
aligned labeled input rows with units, a compact requested-machine count, ordinary
value/status rows instead of large metric tiles, and tabular comparison/constraint
results where applicable. Keep explicit calculation commands and icon-supported
warnings distinct from read-only values. Preserve the narrow Back/status behavior
accepted in S02, plus current temporary-input and return-state semantics. Do not
imply that these inputs are already independently saved machines.

The earlier C01-C02 corner-input packet was prepared before these responses and
was never presented. Do not open it as the new report-style evidence. Capture
fresh visible Edge desktop/narrow workflows after changes, inspect originals and
annotated figures with DOM-backed observations, then initialize a new questionnaire
with new IDs. Close QA map tabs/app servers immediately afterward; retain only the
new active human review session. Storage activation and machine-scoped calculation
isolation remain open alongside this next visual packet.

Implementation entrypoints for the visual packet are the full-screen calculation
body in `apps/mobile/App.tsx`, `CalculateSheet`, `AdvisoryCostReviewPanel`,
`FieldPivotPreviewControls.tsx` and the existing guided-corner-input component.
Keep changes scoped to the calculation/report surface; shared `MetricTile` styling
elsewhere must not change accidentally. Preserve real controls, test IDs, keyboard
focus/Escape behavior and input ownership while replacing decorative tile/badge
presentation. The archived figure is historical evidence, not proof of these
future changes.

Pre-aggregate source checks passed, including core typechecking and all 31 new
document/editor cases. `test:visual-review` passed 96 cases and regenerated
skill/context-map checks passed. The frozen integration run is logged at
`/tmp/cplayout-field-design-final-20260927.log`. A current-source recovery snapshot
is `/tmp/cplayout-field-design-source-XCfPB5/source.tar.gz` (SHA-256
`b33890defecdb84e7ff5ed46044fe56717418e727e62ebb7ba824f74e805a906`).
This is a final-source snapshot, not a pre-edit baseline or authorization to
replace unrelated dirty files. Aggregate completion is recorded separately.

Final aggregate `npm run validate` exited 0. This includes all workspace checks
and 346 native-workspace source tests; their evidence is
`/tmp/cplayout-native-workspace-9xNxLg/result.json`. All eleven frozen source,
manifest and lockfile hashes matched after completion. Final `npm audit` found
zero vulnerabilities. Native-workspace source tests are not Android/iOS device
proof, and no hardware or surveyed 3D accuracy was verified.

Final cleanup verification found no launcher-owned app servers and only the
unrelated Allow CORS extension tab in the targeted Edge inventory. No CPLayout
map or questionnaire tab remains. The core multi-machine contract is implemented;
UI/storage activation, machine-scoped calculations and the new report-style
human review remain open. No publication was performed in this pass.

### Calculation Report Form: 2026-09-27

Previous turn classification: progress. The multi-machine core validation and
completed-review cleanup changed the next available action. This pass applies
S01 to the calculation presentation, retaining S02's narrowly accepted header
behavior. Complexity/reasoning high; subagent decision required. Screens performs
bounded read-only interface/regression review while the coordinator owns the
implementation and browser evidence. Existing unrelated dirty work is preserved.

`CalculationReport.tsx` supplies labeled fields, ruled read-only value rows and
icon-supported notices. Calculate's cost, acreage, clearance, kinematic and
placement sections use report presentation without restyling shared metric tiles
elsewhere. Requested-pivot controls stay close to their label. Required clearance
uses icon steppers and a switch for row visibility. No geometry algorithm,
canonical coordinates, persistence or input lifetime changed.

The fresh static export is tested through the repo launcher at
`http://127.0.0.1:19020`, with Windows HTTP health confirmed before visible Edge.
Six desktop/narrow tests passed for temporary preview state, cost-field
missing/invalid/complete/clear states, accessible labels, viewport bounds,
Back/status visibility and corner-input keyboard/invalidation behavior.
Further workflow, aggregate and screenshot results are recorded after completion.
The initial skill/context checks correctly rejected a stale generated context
map; regeneration and the skill rerun passed. This is advisory routing validation,
not evidence of managed-hook enforcement.

Full native receiver/relay/radio operation, level-shifting verification and
strictly sub-0.10 m surveyed 3D accuracy remain unverified. The original five-high
dependency count is not current: this pass's live `npm audit` reports zero.

#### Report Evidence And Review

`npm run validate` exited 0; log:
`/tmp/cplayout-report-form-validate-20260927.log`. The 346 native-workspace source
tests recorded `/tmp/cplayout-native-workspace-88xZAo/result.json`; these remain
source tests, not device evidence. `test:visual-review` passed 96 cases.
The first twelve selected visible Windows Edge tests passed across desktop and
narrow viewports: temporary inputs, invalidation, cost states, unfinished drawing
and camera retention, confirmation-first pivot mutation, and explicit review-zone
saving. The entire `proof:web` suite was not run in this packet.

Fresh originals and numbered magenta annotations are in
`.cplayout-local/publication-checkpoint-20260927/reports/report-form-20260927/packet/`. Windows Edge version was
154.0.4258.37. The capture manifest verified served/exported bundle hashes,
unchanged storage, actual new card-free cost styling and no page exceptions.
External requests were deliberately blocked, so this is not a clean-resource-load
or connected-imagery claim. Original and annotated figures were visually inspected;
labels/inputs aligned on desktop and stacked within narrow bounds. Back and
project status remained visible. Lower-report comparison-table wrapping has not
received screenshot acceptance.

The manifest fingerprint is
`capture-sha256:dd68adc95ce6b4fcf433343cdc7e2d7e871bb6c94b2aeae2699332ba5722c04f`.
Source hashes matched after aggregate completion:

- `App.tsx`: `39389926a7e89c2dce0c89932f73bd7417607e6432f60692f247b693a361e688`
- `CalculationReport.tsx`: `24b69bf5a4d38b4470b44120d73aa0bfff235218119c984f002425366b886042`
- `FieldPivotPreviewControls.tsx`: `bb4a375783a86fb4d081acdfc2b06f67eac52116c14cc88594645e708ee2f657`

Screens independently reviewed the original captures and matched their source
hashes. No presentation blocker was found. Review did find four old browser
assertions for removed Cost Review/Complete tile text. They now check the actual
Cost assumptions heading and supplied valid cost values, retaining downstream
comparison/export and unchanged-save-state assertions. A separate six-test
desktop/narrow rerun covers those affected workflows; results follow below.

New human IDs F01-F03 are live at `http://127.0.0.1:43453`, session
`.cplayout-local/publication-checkpoint-20260927/reports/report-form-20260927/human-session`. Both hub and questionnaire were
opened visibly in the dedicated review profile. A launch-created Edge update tab
was closed only after its exact profile, title and Microsoft update URL were
verified; the unrelated extension tab was preserved. Original S01-S02 answers
are still archived, not transferred into the new answers. At revision 3 the new
answers were empty and completion null. Keep this active human session only
while awaiting input; read acknowledged revisions before making follow-up choices.

The map QA browser closed and app server stopped after capture. The same unchanged
export was then briefly restarted through the launcher for the reviewer-discovered
cost regressions. Final cleanup verification follows their completion.

All six additional cost regressions passed, making 18 selected visible Edge
checks passed in this packet. The additional suite covered local cost input,
full-scope strategy comparisons/export and partial-sweep comparisons/export at
desktop and narrow widths. The owned map server was again verified stopped.

#### F01-F03 Completed: Rework Required

The human completed revision 19 at `2026-09-27T21:22:01.642Z`. All three choices
were c, "Rework this presentation; explain". Verbatim comments:

- F01: "Utilize industry related terminology as appropriate. Fully research the
  concepts and terms to ensure proper explanation and descriptions"
- F02: "Use layman's terms that fit industry descriptions. This will make little
  sense to those in the center pivot irrigation industry. Research and do better"
- F03: "Use of miles, acres, and feet. NOT METRIC BULLSHIT"

The original JSON text is authoritative where Markdown wraps these comments.
Export `.cplayout-local/publication-checkpoint-20260927/reports/report-form-20260927/human-completed-r19/` verified revision,
receipt and figures. The questionnaire self-closed; the completed hub was matched
against the live receipt, its controls archived and only that hub closed. The
review server then reported `verified-stopped` and lock removal. Final targeted
Edge inventory contained only the unrelated extension tab. F01-F03 is no longer
an active or accepted review. Technical test passes do not override its rejection.

Research and code inspection for the response are in
[the language/unit packet](irrigation-report-language-plan.md). They identify
hardcoded metric input units and ambiguous additive cost scope, not merely a
cosmetic wording problem. The next implementation must address those findings
with plain industry descriptions, correct US-unit conversion and explicit cost
basis before issuing replacement figures. The broader saved-machine/storage and
hardware/3D goal remains active and incomplete.

#### F01-F03 Response Implementation: US Inputs And Price Scope

Complexity band and selected reasoning effort: high. Subagent decision: required.
Independent workers owned corner-input conversion and geometry pricing, followed
by read-only QA; browser-test edits had a separate exclusive scope. Existing dirty
native/storage work was preserved. No commit or publication was performed.

- Corner-system speed is explicitly owned as ft/min and converted at the input
  boundary; catalog dimensions display in feet. Unowned raw speed data requires
  re-entry instead of silently adopting units. Saved XY remains unchanged.
- The price form separates one configuration's supplied price from a base plus
  dollars/foot plus dollars/tower estimate. Included equipment/work is required.
  Blank charges are not zero. Annual operating costs are not calculated.
- Supplied prices carry detached machine snapshots. Configuration changes block
  reuse and display a re-entry warning; alternative hardware cannot inherit the
  price. Reloading even the same project resets the temporary price context.
- Primary report headings now use plain field-coverage and equipment terms.
  Missing corner calculation evidence remains unavailable, not a measured zero.
- Initial current-turn cleanup found no map tab in the dedicated Edge profile
  and no launcher-owned server. Only the unrelated extension tab remained.

Fifteen focused input tests passed. Independent QA also passed the geometry
cost-basis suite with 67 malformed pricing cases and found no confirmed product
defect. It requested an App/browser regression for equipment changes after price
entry; that test was added. Audit reported zero vulnerabilities. A stale generated
context map failed the first governance run; regeneration and the repeated skill
validation passed. Aggregate and visible-browser results are recorded separately
after completion, not inferred from these focused passes.

New review IDs U01-U05 are reserved for fresh figures under
`.cplayout-local/publication-checkpoint-20260927/reports/us-irrigation-report-20260927/`. F01-F03 remains a rejected, archived
packet. New screenshots and human acceptance are still pending at this checkpoint.

The first aggregate run failed the existing frozen-output scheduling assertion:
new missing-price wording had changed legacy no-price result bytes. The
coordinator restored both legacy warning strings when no explicit pricing basis
is supplied, retaining exact-configuration warnings for the new lane. All nine
existing frozen hashes then passed unchanged. The failed aggregate log remains
`/tmp/cplayout-us-pricing-validate-20260927.log`; its native-workspace source
tests passed 346 cases but do not override the aggregate failure.

The in-progress export was intentionally interrupted to avoid serving the
pre-fix build. Its launcher rejected missing `index.html` and cleaned up; the
subsequent targeted stop found no owned server. No browser had been opened.
A new aggregate run and fresh export use the repaired source.

The first visible Edge run found a test-fixture error: the added stale-price
test expected cost/acre on Will Rhea's current-machine row, which reported
"no feasible candidate" and "No acres". That is a comparison-row status, not
proof the field has no irrigation. The first baseline substitution had the same
fixture problem. The final test uses the full-scope cost demo and removes a span;
a direct domain check confirmed priced coverage under both pricing methods.
The Will Rhea preview, form, reload and corner checks remain on Will Rhea.
The failed runs are retained under `edge-results` and `edge-followup`; correction
requires a separate desktop/narrow rerun rather than calling it a product pass.

#### Completed Source And Browser Checks

- Repeated `npm run validate` passed; log:
  `/tmp/cplayout-us-pricing-validate-20260927-r2.log`. Native workspace coverage
  is 346 source tests, not device proof.
- Eighteen distinct selected Windows Edge desktop/narrow cases passed across
  the retained runs: eight preview/form/corner cases, six zone-save and
  strategy/sweep comparison cases, and four corrected cost/export/stale-price
  cases in `edge-final`. The stale-price test now also waits for the selected
  project breadcrumb before entering its map. Full `npm run proof:web` was not run.
- Repeated skill validation, context-map check, `git diff --check` and audit
  passed. Audit reported zero vulnerabilities. No publication was performed.
- Five fresh figures were captured in visible Edge 154.0.4258.37, at desktop
  1366 x 900 and narrow 390 x 844. Originals and annotations were visually
  reviewed. Control bounds passed, project storage stayed unchanged, no page
  exception was observed, and served bundle bytes matched the export. External
  imagery requests were deliberately blocked; this is not imagery proof.
- Capture fingerprint:
  `capture-sha256:e63b8718b19d572a261c17d1ca6c01b9f6e395576f3d058f21f80dd2899efef2`.
  Artifacts: `.cplayout-local/publication-checkpoint-20260927/reports/us-irrigation-report-20260927/packet/`.

Visual review explicitly retains unfinished work: the search found 0 of 3
requested locations for the current Will Rhea machine template, and lower
generated-strategy labels still contain metric wording and technical terms.
The U01-U05 packet concerns the marked primary input forms only, not acceptance
of those remaining report/layout issues. Its context discloses both limits.
Next mapping work should convert generated UI labels from numeric domain fields
without changing technical output contracts, then investigate feasible machine
configuration selection and independently editable saved machines. The requested
3D hardware qualification remains unverified.

After capture, the QA browser closed and port 19020 reported `verified-stopped`.
Launcher status then showed no owned app server. The first PowerShell inventory
hit a transient WSL transport error; retry confirmed only the unrelated extension
tab, with no map tab. New human session
`.cplayout-local/publication-checkpoint-20260927/reports/us-irrigation-report-20260927/human-session` is intentionally retained
at `http://127.0.0.1:43075` for U01-U05 answers. At revision 2 its answers were
empty and completion null. Old receipts remain archived; no acceptance is assumed.

#### U01-U05 Completion And Layout Diagnosis

Complexity band: high; selected reasoning effort: high. Subagent decision:
required. A bounded high-effort, read-only GIS reviewer assessed independent
machine calculation/adoption contracts while the coordinator diagnosed the
single-template search and retired the completed review. No product source or
saved geometry was changed in this follow-up.

U01-U05 completed at revision 9, `2026-09-27T22:18:25.343Z`: all five choices are
`a` (Accept this presentation), with blank comments. Acceptance covers the marked
primary forms only. It does not accept lower generated labels, the zero-result
layout, independent machine storage, native behavior or surveyed accuracy.

- Export: `.cplayout-local/publication-checkpoint-20260927/reports/us-irrigation-report-20260927/human-completed-r9/`.
- `review:session verify-export` passed receipt/catalog/figure-byte verification;
  it does not independently verify authorship.
- Questionnaire self-closed on completion. The completed hub controls were
  archived to `completed-hub-controls-r9.json`, then its exact title and URL were
  matched before closure. Inventory retained only the unrelated extension tab.
- Review server at port 43075 reported `verified-stopped`; `ui:test:status`
  reported no launcher-owned app servers. No unused map tab was retained.

The source diagnostic used the reducer-normalized example and
`planAdvisoryFieldPivots` with `gridDivisions: 6`, `candidatePoolSize: 24`,
`maxMachines: 3`, `includeMachineZoneReviews: false`. Each alternative retained
the first N source span lengths in a temporary object only. No corner arm,
overhang or end-gun throw was present. Results are search observations, not a
proof that another placement or equipment configuration is impossible:

| Temporary configuration | Radius (m) | Pool / feasible | Selected | Modeled union acres |
| --- | ---: | ---: | ---: | ---: |
| Existing nine spans | 462.9 | 32 / 0 | 0 | 0 |
| First six spans | 308.4 | 33 / 0 | 0 | 0 |
| First four spans | 205.6 | 34 / 14 | 3 | 98.438525 |
| First three spans | 154.2 | 36 / 26 | 3 | 55.371671 |

The diagnostic does not establish that shortened configurations can be purchased,
installed or hydraulically supported. No quoted price, catalog qualification or
field evidence transfers to them. It demonstrates why repeating only the current
template is insufficient for the requested exploration; do not present these
alternatives as a completed optimized field design.

Next implementation: explicit operator-specified template alternatives, exact
configuration ownership and pairwise clearance tests, followed by scoped field
calculation/adoption and independently editable saved machines. Requirements are
in [Planner Integration Gates](field-design-contract.md#planner-integration-gates).
Keep the accepted input forms intact while separately correcting generated UI
labels from numeric domain fields. Any changed UI gets a fresh visible Edge
packet; close the map/server immediately after that bounded workflow.

Follow-up checks passed: 33 focused runner cases across field document/editor,
field-plan reuse and exact-configuration pricing, with no failures or skips;
`npm audit` reported zero vulnerabilities. Skill validation, context-map freshness
and `git diff --check` also passed. Logs:
`/tmp/cplayout-layout-resume-focused-20260927.log` and
`/tmp/cplayout-layout-resume-skills-20260927.log`. No TypeScript or UI code changed
in this documentation/cleanup pass, so the full aggregate and browser suite were
not rerun. These checks do not constitute mixed-template implementation, device
proof or field qualification.

#### Explicit Template Planner Implementation

Complexity band and selected reasoning effort: high. Subagent decision: required.
The coordinator owns the planner and integration. A read-only irrigation reviewer
assessed reach/buffer/cost semantics, a disjoint worker owns focused tests, and an
independent read-only QA reviewer assesses the new implementation. Existing shared
dirty work is preserved; no commit, browser session or app server is requested
by this source-only packet.

The new synchronous/cooperative APIs implement optional, explicitly configured
machine alternatives using the existing optimizer and grid. Selection maximizes
incremental union coverage greedily subject to quantity ceilings and every-pair
structural spacing. Exact configurations are retained; no shorter equipment is
invented or silently saved. The [contract](field-design-contract.md#explicit-template-search)
records ownership, computational bounds, price/currency checks, conservative pair
gap semantics and unsupported corner/local-CRS behavior. Field storage, atomic
adoption, scoped infrastructure/guidance and visible UI integration remain open.

Independent source review identified a shared legacy safety defect: the special
seed/grid fallback omitted hard mechanical conflicts. A direct probe reproduced
`maximum_inscribed_circle` at `(0,0)` as feasible with one hard mechanical conflict
and zero wet conflicts: square field `[-120,120]`, structural radius 100 m,
machine buffer 5 m, no end gun, hard obstacle rectangle `[102,104] x [-1,1]`.
Shared candidate admission now rejects hard mechanical conflicts, with an explicit
reason for fallback candidates. Both legacy frozen-output suites passed unchanged
after this correction; log `/tmp/cplayout-template-safety-legacy-20260927.log`.
New template candidates additionally receive uniform conservative boundary and
optimizer-equivalent hard checks regardless of their generation path.

The four-template Will Rhea diagnostic remained input-immutable and selected three
hypothetical four-span configurations with modeled union 98.43852545245393 acres.
The six/nine-span alternatives had zero feasible candidates at these search
settings. Prices were unavailable. Log:
`/tmp/cplayout-template-will-rhea-20260927.json`. These shortened input variants
are diagnostic hypotheses, not validated equipment, accepted saved layouts or
surveyed irrigation evidence. No corner acreage or physical 3D qualification is
implied. Focused and aggregate implementation acceptance is recorded below when
the respective processes finish.
