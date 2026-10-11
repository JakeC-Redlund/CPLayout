# Durable Drawing Contract

## Scope

Implementation packet for Q01/Q07/Q09 from the drawing review: retain unfinished
Point, LineString and Polygon work across saves, ZIP transfer and reopen before
adding the user-facing pause/resume controls. Complexity and selected reasoning:
xhigh. Subagents: required; separate workflow and archive/store writers, plus
read-only integration QA. Coordinator owns document/editor integration and saves.

This packet does not deliver toolbar pause/resume, post-drawing classification,
automatic saves or GPS/elevation measurement. Those interfaces must use these
contracts and pass visible Windows Edge workflow review before being described
as available features. No package installation or native dependency changes.

## Document Version

- `design-draft-v1` remains readable using its original strict schema. Adding
  workflow fields to a v1 envelope is refused, not silently stripped.
- `design-draft-v2` adds optional `drawingWorkflow`. Drafts without the namespace
  continue to serialize as v1; merely opening an old document does not add
  settings or migrate its data. A v2 envelope without the namespace canonicalizes
  to v1 on serialization. Value round-trip, not byte-identical envelope version,
  is promised in that case.
- `draft-drawing-workflow-v1` requires explicit autosave preference, coordinate
  lock, active capture ID and captures. Only an explicit new-workflow constructor
  supplies default-on autosave. Parsers never invent missing saved fields.
- ZIP archive version remains `center-pivot-design-draft-archive-v1`: the same
  manifest/draft files and safety budgets apply. Manifest document version must
  exactly match the actual `draft.json` envelope, on both import and export.
- Workspace schema and SQL columns are unchanged; draft payloads remain strings.
  Older applications cannot read v2 drafts and may refuse the containing
  workspace. Preserve their original bytes when rolling back application code.

## Capture Semantics

Every capture has identity, name, projected/local CRS, geometry type, stage,
source, open vertices and a proposed classification. There is at most one active
capture. Other captures are paused; they remain available while another tool is
used. Classification is a proposal, not an accepted map feature or an obstacle.

Finishing requires one point, at least two line vertices, or a valid simple
polygon with at least three vertices. The polygon ring omits a repeated closing
vertex. Drawing-stage invalid/incomplete topology remains editable and saveable;
it cannot enter classification until validation passes. Canceling classification
returns to drawing without deleting its vertices. All unfinished captures block
conversion to a completed project, even when existing project inputs are valid.

Manual map vertices store XY, digitization timestamp, `wgs84: null` and
`elevation: null`. Their source is `map_digitized`, never receiver evidence.
This version deliberately records no geographic or elevation observation; null
means unknown, not zero. Later derived geographic coordinates or receiver heights
need explicit provenance and datum contracts. Screen coordinates cannot satisfy
the strictly less-than-0.10 m measured 3D requirement.

The first captured vertex locks the workflow CRS. Removing vertices, discarding
a capture, undoing, saving and reopening retain that lock. Undo across a different
coordinate frame is refused once the new workflow has captured coordinates.
Repository saves also reject lock removal or CRS relabeling. This is not a
coordinate transformation API. Legacy drafts without this namespace retain their
existing editor behavior.

Budgets are computational, not physical field limits: 2,048 vertices per capture,
8,192 total and 128 captures. Inputs over a limit are refused, never truncated.
Saved classification-stage geometry is revalidated; nonfinite or numerically
unsafe coordinates cannot bypass finish validation through JSON import.

## Persistence And UI Integration

`reduceDesignDraftEditorState` drawing actions require the exact editor revision
and capture identity. A stale command leaves geometry/history/revision untouched.
Undo is local editor history, not a database revision.

Use `createEditorSaveCoordinator` for queued saves. A pause UI may say recovery
is available only after the matching save is acknowledged. Later resumed edits
must not alter a queued paused snapshot or inherit its saved indicator. Explicit
pause persistence remains required when autosave is disabled. Save failures and
quota/conflict conditions must remain visible with the in-memory drawing retained.

Next integration steps:

1. Introduce a geometry-compatible purpose catalog and atomic classified-geometry
   commit, preserving boundary/obstacle/measurement distinctions and one undo step.
2. Wire the shared geometry tools to this workflow. Start with a boundary on new
   designs; allow pause to use other tools. Close a polygon by selecting its
   first point only after finish validation succeeds.
3. Add the classification dialog, name/notes, explicit effects, default-on
   autosave preference and visible pause/resume affordances. Before exposing
   draft-to-project promotion in that workflow, define how the draft preference
   maps to completed-project settings; the current conversion deliberately
   removes draft-only workflow metadata.
4. Test actual save/reopen, quota/conflict, dialog cancellation, camera independence,
   multi-capture switching and layout precision gates in visible Windows Edge.
5. Publish a fresh interactive screenshot packet; read disk-acknowledged answers
   and archive/replace the previous review tabs without losing human responses.

## Verification

### Classification Foundation

`drawingClassification.ts` now defines a versioned agricultural purpose catalog
for polygons, lines and points. Required selections include literal name/notes,
asset status, compatible placement and explicit informational/exclusion effects.
Well, riser, valve and other labels cannot silently replace the design water
source. Unknown electrical/pipeline placement cannot imply overhead/buried assets.
Unknown imported JSON is retained for explicit classification, including literal
prototype-named keys; it cannot enter a recognized strict selection silently.

`prepareClassifiedDrawing` accepts only the active finished capture, matching
project coordinate frame and exact editor revision. It returns detached geometry
and manual provenance with status `prepared_not_committed`. It does not add a
feature, remove a capture, save, or supply measured GPS/elevation evidence.
Eleven focused tests cover catalog admission, incompatible effects, JSON retention,
accessor safety, opaque existing identities, stale commands and no mutation.

The next atomic editor action must commit geometry and remove its retained capture
in one validated undo step. Before wiring it, introduce frozen old readers and
new project/draft versions for typed classification, including metadata for the
operational boundary and singleton infrastructure without duplicated editable
geometry. XML/KML exporters currently reconstruct selected fields; arbitrary
properties are not an adequate lossless persistence contract. Update project
documents, workspace/ZIP version checks, render labels and advisory kind consumers
together. Do not repurpose `end_gun_mark` for general markers.

Terminology review used [NRCS irrigation pipeline](https://www.nrcs.usda.gov/sites/default/files/2024-12/Irrigation%20Pipeline%20%28430%29%20%28Ft.%29%20%2811-24%29%20Standard%20Document.pdf),
[NRCS pumping plant](https://www.nrcs.usda.gov/publications/nhcp-notice-179/533-cps-pumping-plant-2026.pdf),
[NRCS field border](https://www.nrcs.usda.gov/publications/nhcp-notice-179/386-cps-field-border-2026.pdf)
and [QField geometry then attributes](https://docs.qfield.org/how-to/data-collection/digitize/),
checked 2026-09-27. This is CPLayout vocabulary, not an official NRCS taxonomy.
A vegetated field border is distinct from the operational field boundary.

Focused tests cover workflow transitions, malformed/evidence-injected input,
legacy/new document parsing, retained CRS locks, paused geometry/classification
round-trips, readiness blockers, archive version mismatch, direct repository
mutation and queued save/reopen behavior. Run `npm run validate` and `npm audit`;
the new workflow suite is part of the core test command.

These are source-level contracts using synthetic fixtures and the web repository
adapter with test storage. They do not establish native SQLite runtime, hardware
transport, relay wiring, RTK lock, field accuracy, or user acceptance. Current
dependency status must come from a fresh audit, not the historical five-high
finding count in the long-running goal.

### 2026-09-27 Checkpoint

Coordinator `npm run validate` exited 0, including 346 native-workspace source
tests; their result is `/tmp/cplayout-native-workspace-CJ3Lfi/result.json`.
Focused repeats passed 89 workflow/archive/workspace cases, 49 document/editor
cases and 16 save-coordinator cases. Independent read-only core review found no
confirmed regression; its additional empty-capture and remove-last/reopen cases
were added to the retained integration tests. `npm run validate:skills`, generated
context-map freshness and `git diff --check` passed. Fresh `npm audit` reported
zero vulnerabilities.

No visible app controls changed in this packet; `npm run proof:web`, native
device workflows and physical receiver/relay/3D tests were not run. The visible
interactive hub remains available with agent progress messages. V01-V04 human
responses were received at completion revision 25, 2026-09-27T16:57:22.202Z:
center the bottom controls, strengthen tool colors, keep a single horizontal
row on narrow displays, and use red/yellow/green status colors. They request
further changes, not acceptance. The verbatim receipt is retained in
`protected local review archive`.
Existing dirty work is preserved, with no commit, push or branch operation in
this packet.
