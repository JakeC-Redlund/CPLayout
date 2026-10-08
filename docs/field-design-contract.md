# Multi-Machine Field Contract

Status: core document/editor implementation, not activated in app storage or UI.
Version: `field-design-v1`. Reviewed 2026-09-27. The existing
`pivot-project-v1` and draft formats retain their own readers and semantics.

## Data Ownership

`packages/core/src/fieldDesignDocument.ts` owns one projected/local XY field:
identity, name, CRS, display unit system, project settings, boundary and capture
evidence, obstacles, survey observations, map features and portable package metadata.
It also owns arrays of infrastructure points and independently identified machines.
There is no mutable legacy-primary machine mirrored beside that array.

- Infrastructure records have explicit IDs, water/power kind and XY point, with
  an optional exact survey-record reference. Shared and co-located sources are
  permitted; neither is inferred from proximity.
- A machine has one stable outer ID, `kind: center_pivot`, a configuration without
  another ID, its own pivot XY, and optional water/power/survey references. Existing
  end-gun, corner-arm and drive-unit configuration/provenance fields are retained.
- `cornerGuidanceFeatureId` explicitly names a nondegenerate LineString in the
  shared features. It does not certify that line as usable guidance, a wheel
  track, a swept envelope or a supported operating trajectory. No first/nearest
  line is auto-selected. Optional `sourceFeatureIds` retain explicit evidence
  associations without promoting advisory outlines into installed machines.
- Selection is editor view state, not stored geometry. Missing connections and
  an empty machine array are allowed; missing data does not become origin points
  or fabricated machine settings.

The canonical boundary currently requires at least three finite XY vertices.
This document is not a replacement for unfinished drawing drafts. Admission
does not prove topology, metric calculation eligibility, operating clearance,
water availability, uniformity, equipment compatibility or field accuracy.
Linears and benders need explicit future model contracts; they are not accepted
by relabeling a center pivot.

## Admission And Conversion

Public APIs: `validateFieldDesign`, `parseFieldDesignDocument`,
`serializeFieldDesignDocument`, and `convertPivotProjectToFieldDesign`.

The parser rejects unsupported versions, duplicate decoded JSON members,
comments and trailing commas. Plain-object admission rejects accessors,
serialization hooks, cycles, nonfinite numbers and undefined field values.
Unknown nested data and inserted defaults are refused, not silently discarded.
Absent optional end-gun ranges, feature arrays and optional package defaults
remain absent. Required settings values must be explicit.

Validation restores root checks that cannot be inherited by copying schema
fields: declared projected/local CRS, matching settings units, capture-array
alignment, unique entity IDs, exact-XY survey references, infrastructure kind
and all-carrier v1/v2 evidence consistency. Survey record IDs are distinct from
receiver capture observation IDs. Logical `app://map-packages/` references retain
attribution; machine-local paths are refused. This is not tile-rendering proof.

Conversion accepts a legacy bare project or supported v1 envelope plus explicit
new field/water/power IDs. It creates exactly one machine from the canonical
legacy configuration, without scanning advisory outlines. Original geometry,
survey evidence and feature metadata are retained. The known derived WGS84
companion is deliberately excluded from canonical field data. Original JSON text
is returned unchanged as `originalProjectDocument`; it must be durably retained
before any future workspace migration publishes the converted field. Returning
that string does not authorize dropping unknown metadata from the usable field.
Unsupported source metadata, invalid references and required-but-absent policy
values refuse conversion. No current storage file is rewritten by this API.

## Editing

`fieldDesignEditor.ts` provides create/load, explicit selection, add/update/remove
machine, undo/redo and error clearing. Actions are detached from caller data.
Validation precedes every commit and history transition. Rejected edits retain
field, history, revision and selection. Selection changes do not consume undo
or discard redo; removal/undo cannot leave a dangling selected machine.
Moving a pivot with retained survey evidence requires explicit detachment or
valid exact-coordinate reassociation. Shared geometry and sibling machines are
unchanged by an independent machine edit.

## Activation Gates

Next: introduce a versioned workspace payload kind and dedicated field archive;
preserve original v1 payloads and prove create/save/reopen/copy/delete, stale-save
rejection, migration interruption/recovery and old-reader refusal on web/native
adapters. Do not send field documents through current project/draft writers.

Calculation adapters must scope machine-associated features explicitly. Existing
legacy geometry code consumes shared `corner_swing_limit` features; passing all
field features into every machine would misassociate evidence. Keep shared data
unchanged and build detached calculation inputs keyed by field/machine identity
and input revision. Add union coverage, collision and independent-scenario tests
before activating the new renderer and report-style calculation form.

Source gates: field document/editor tests, existing project/archive/workspace
regressions, `npm run validate`, `npm audit`, and `git diff --check`. New UI requires
fresh visible Windows Edge workflow figures and a replacement questionnaire.
Native hardware and strictly below 0.10 m maximum 3D field error remain separate
unverified gates.

## Planner Integration Gates

Read-only GIS review on 2026-09-27 confirmed that the field document can retain
different machine configurations, but the existing advisory planner repeats a
single `PivotProject.machine`. The following requirements govern integration;
the new source-only template search described below is not authorization to
publish a field design or completion of storage/UI activation.

1. Give every candidate a stable template ID and detached, complete machine
   configuration. Declare allowed quantities and whether templates are optional
   alternatives or required instances. Do not derive purchasable span packages
   from a radius, silently truncate spans, or reuse catalog/price evidence after
   configuration changes.
2. Apply metric CRS qualification and project calculation safety to each detached
   calculation input after lossless document admission. A LOCAL label is not a
   metre/orthogonal-axis declaration; Web Mercator is not calculation authority.
   Preserve stored XY and evidence without display-unit reinterpretation.
3. Scope guidance and evidence by explicit machine reference and input revision.
   Adding/reordering another machine's guidance must not change the result. Do
   not broadcast legacy `corner_swing_limit` features to every machine or count
   a guidance line or maximum-extension envelope as irrigated corner area.
4. Screen every selected pair using unrounded distance and
   `max(explicit minimum, reach A + reach B + pair buffer)`. Define buffer
   semantics once, distinguishing wetted overlap from physical conflict. Base
   pivot envelopes omit corner extension; unsupported corner reach must remain
   unassessed, not collision-cleared. Report clipped coverage union separately
   from gross summed acreage.
5. Bind price inputs to exact configurations using `advisoryMachinePriceMatches`.
   Missing/mismatched prices remain missing. Sum only complete, compatible
   currency amounts and use union acres for aggregate cost/acre. Shared source
   references do not prove hydraulic capacity or justify duplicated charges.
6. Adopt a complete plan only through revision-checked, atomic validation and
   undo. Current field editor actions update one machine at a time; current
   project/draft storage writers cannot accept field documents. Keep preview,
   adoption, persistence and field qualification separate.

Implementation ownership: geometry handles candidate identity, scoped calculation
inputs and unequal-radius screening; storage handles atomic adoption and the
existing workspace/archive activation gates. Interface integration follows these
contracts and preserves the accepted primary forms. Retain current single-template
output regressions; a new option must not change existing serialized results.

Acceptance requires unequal configurations surviving serialization independently;
duplicate IDs, stale revisions and dangling references rejecting without partial
adoption; unrelated guidance not influencing siblings; separation below/at/above
threshold; unsupported corner extension and wetted overlap distinguished; union
acres not double-counted; missing/mismatched prices and CRS evidence refusing
unsupported results. Exercise synchronous/cooperative calculation parity and
cancellation before a bounded visible Edge workflow. This is a heuristic search,
not a global-optimum or installation-safety claim.

Research boundary: Nebraska Extension's [Center Pivot Irrigation Handbook
(EC3017)](https://extensionpubs.unl.edu/publication/ec3017/center-pivot-irrigation-handbook-ec3017)
was rechecked on 2026-09-27; the publication and last revision are 2018. It covers
design/management education, not current equipment quotations or certification
of CPLayout's placement algorithm. Current manufacturer packages, site hydraulics
and applicable installation requirements still need their own evidence.

### Explicit Template Search

The separate `planAdvisoryPivotTemplates` / `planAdvisoryPivotTemplatesSteps`
source APIs now implement bounded mixed-configuration **advisory search**. They
do not activate field storage, adopt candidates or change the existing
single-template planner. The remaining activation requirements above still apply.

- Inputs are one legacy project as shared field context and one to four explicit
  templates, each with a unique ID, complete machine configuration, maximum
  instance count and optional configuration-scoped cost input. Templates are
  optional alternatives, not required installed machines. Each count and the
  overall count are capped at eight for computational control.
- Inputs are detached at API invocation, before the first cooperative step.
  Schema/numerical/CRS admission occurs before search. Unknown template/config
  fields reject rather than disappearing. No radius-based span package is
  invented. Unsupported LOCAL and display-only CRS inputs reject unchanged;
  propagation of a qualified LOCAL calculation context remains future work.
- Each template uses the existing optimizer and bounded grid. Every admitted
  candidate passes conservative wet containment, zero wet obstacle conflicts,
  zero hard mechanical conflicts and the optimizer's one-percent coverage
  minimum. Center-clearance options remain center-clearance constraints, not
  certified machine-end clearance.
- Selection greedily adds positive incremental clipped union coverage. Template
  IDs sort deterministically and counts are ceilings. This can miss useful
  combinations and is not a global optimum, exact-count promise or equipment
  recommendation. A returned `candidates_found` status is not field readiness.
- Every selected pair is checked at unrounded values. Structural reach uses
  `machineRadiusMeters` (spans plus overhang), excluding end-gun water throw.
  Pair gap is the maximum of both machine-clearance settings and the explicitly
  requested collision gap, applied once. Full radial envelopes conservatively
  screen partial sweeps. This is a minimum gap between unbuffered envelopes,
  **not** proof that two separately buffered envelopes are disjoint, and not
  equivalence to the obstacle solver's machine-buffer semantics.
- Corner-equipped templates are explicitly excluded, not reported as cleared.
  No corner guidance is promoted to an irrigated envelope. Shared infrastructure
  remains context only; independent per-machine source/guidance adoption is open.
- Selected configurations and pair results remain explicit. Returned machine
  instances are detached from sibling instances and input templates. Cost totals
  use unrounded resolved amounts and clipped union acres; absent/mismatched
  prices, missing/common-currency failure and overflow yield unavailable totals.
  No currency or shared infrastructure charge is inferred.

No UI is wired to this API yet. The next integration must expose the alternatives
as explicit equipment inputs, retain warnings and price scope, carry candidate
identity through atomic adoption, and obtain fresh visible Edge workflow evidence.
