# GNSS Derived Evidence Contract v1

`cplayout-gnss-runtime-proof-v1` now requires
`evidenceContractVersion: "cplayout-gnss-derived-evidence-v1"`, a project ID,
identified sessions, explicit vertical references and heights, a declared
orthonormal ENU comparison frame, and exactly two hashed JSON artifacts.
This development evidence contract makes earlier 2D-only or grid-plus-height
packets ineligible in both release and nonrelease validation. It
validates the supplied evidence's structure and arithmetic. It does not
establish surveyed field truth, receiver accuracy, authenticated provenance,
or the identity of an installed native build. Synthetic test fixtures are not
field evidence. The report template deliberately remains incomplete.
All GNSS physical/release acceptance is explicitly BLOCKED in this implementation
pending independently verifiable comparison-frame derivation. Supplying the
declared ENU contract below permits nonrelease arithmetic validation only.

The owner target is PX1122R + NS-RAW, Android first and iOS later, with
**maximum 3D position error strictly below 0.10 meters, including elevation**.
These are user-provided targets, not verified manufacturer or pipeline facts.
Receiver/firmware, platform, session and vertical-reference fields in the
template remain empty. Antenna height is `null` until an observed value is
provided; it must not be inferred from a zero placeholder. Result zeros are
unfilled placeholders while status is `incomplete`, not measured outcomes.

Every artifact has these required common fields:

| Field | Value |
| --- | --- |
| `projectId` | Exact report project ID |
| `projectCrs` | Exact report CRS in the evidence-only subset below |
| `coordinateSpace` | `projected_xy` |
| `linearUnit` | `meters` |
| `verticalReference` | Exact report vertical-reference object, defined below |
| `comparisonFrame` | Exact report orthonormal ENU frame object, defined below |
| `commit` | Hex SHA-1 ID, 12 through 40 characters, matching the report and any expected release commit |

IDs use 1-128 ASCII letters, digits, periods, underscores, colons or hyphens,
starting with a letter or digit. Timestamps are validated as ISO 8601 UTC with
`Z`, then restricted to at most three fractional-second digits. This applies
to report generation, session start/end, observation times and frame epoch. Greater
precision is rejected before `Date.parse` comparisons; it is never silently
rounded or truncated. No microsecond ordering is claimed.

The evidence-only CRS allowlist accepts canonical `LOCAL`, `LOCAL:<name>`
with a nonempty name containing no whitespace, and WGS84 UTM `EPSG:32601`
through `EPSG:32660` or `EPSG:32701` through `EPSG:32760`. Both artifacts must
declare `linearUnit: "meters"`. Web Mercator, NAD/State Plane codes including
`EPSG:26741`, geographic CRS aliases and all other unreviewed CRSs are excluded
from this report contract. The legacy geometry helper is deliberately not
used to infer evidence units. No legacy geometry policy, coordinate values,
rescaling, schema, persistence or archive behavior changes.

The installed `proj4/lib/global.js` explicitly defines both WGS84 UTM series
with `+units=m` for zones 1-60; this matches the zone/hemisphere structure in
the [PROJ UTM documentation](https://proj.org/en/stable/operations/projections/utm.html).
This is a conservative evidence policy, not a statement that every other CRS
is nonmetric. `LOCAL` names carry no unit or survey authority: actual meter
units and the local frame must be reviewed independently. A declaration alone
does not prove physical units or field truth.

UTM differences are **grid** quantities, not automatically ground distances.
The validator must not combine them with heights and label the result physical
3D error. Projected XY and source heights are retained for source linkage and
eligibility only; none enters the error norms. Separate ENU comparison values
are mandatory even for a `LOCAL` project. The validator performs no projection,
grid-to-ground scaling, vertical transformation or ENU derivation.

The report and both artifacts require the same strict `verticalReference`
object. It has exactly `heightType` (`ellipsoidal` or `orthometric`), `datum`
and `referencePoint`. The two strings must be nonempty, already trimmed and
explicitly identified; placeholders `unknown`, `unspecified`, `tbd` and `n/a`
are rejected case-insensitively. All three fields must match exactly across
the report and both artifacts. There is no inferred datum, geoid, antenna
reference point or vertical conversion. The template leaves all three fields
empty. For tests only, a synthetic object may use `ellipsoidal`,
`synthetic-test-datum` and `synthetic-test-mark`; those labels describe no real
receiver or survey reference.

Each artifact's shared reference applies to every height row. Rows cannot
override it. Mixed ellipsoidal/orthometric heights or differing datums or
reference points are ineligible; they require separately reviewed transforms
before producing a consistent derived packet. Matching strings validate a
declared contract, not the correctness of a vertical reference or transform.

## Comparison Basis

The report and both artifacts require exactly matching strict
`comparisonFrame` objects with these fields:

| Field | Required contract |
| --- | --- |
| `kind` | `local_orthonormal_enu` |
| `linearUnit` | `meters` |
| `referenceFrame` | Known nonempty trimmed geodetic reference-frame name |
| `realization` | Known nonempty trimmed frame realization |
| `coordinateEpoch` | ISO UTC timestamp, at most millisecond precision |
| `referencePoint` | Exact shared `verticalReference.referencePoint` |
| `origin` | Strict object: finite `latitudeDegrees` in [-90,90], `longitudeDegrees` in [-180,180], and `ellipsoidalHeightMeters` |

The same placeholder rejection used for vertical references applies to frame
names, realizations and reference points. The origin is geodetic in the
declared frame/realization/epoch, with explicitly ellipsoidal height. It is
not the project origin or an implicitly converted orthometric height. The
measured-point convention applies to every observation/control; control IDs
identify the distinct physical marks. The template leaves names, epoch and
point empty and all three origin numbers `null`, not invented zero values.

ENU here denotes a common topocentric Cartesian frame with east/north in the
local ellipsoidal tangent plane and up normal to that plane. Its geographic
origin includes ellipsoidal height; geographic inputs require an initial
geocentric conversion, not subtraction of UTM coordinates. See the
[PROJ topocentric conversion contract](https://proj.org/en/stable/operations/conversions/topocentric.html).
This implementation does not implement that conversion or validate any frame's
realization, epoch correction, geoid model, antenna offset or physical units.
Orthometric source heights require an independently reviewed transformation;
`upMeters` is not simply the recorded height or height minus origin height.

Each row retains finite source XY/height and separate strict `comparisonEnu`
with exactly `eastMeters`, `northMeters`, `upMeters`, all finite numbers. A
required `sourceSha256` binds the ENU declaration to its retained source tuple.
Compute SHA-256 of UTF-8 `JSON.stringify` of this ordered array, with no
indentation or newline (ECMAScript number/string serialization):

```text
["cplayout-gnss-comparison-source-v1", kind, projectId, projectCrs,
 heightType, datum, referencePoint, ...keys, sourceX, sourceY, sourceHeight]
```

For observations, `kind` is `observation_summary`, `keys` is
`[id, sessionId, observedAt]`, and the source values are `projectedXY.x`,
`projectedXY.y`, `heightMeters`. For controls, `kind` is
`control_point_comparison`, `keys` is `[controlId, observationId, sessionId]`,
and the source values are `referenceXY.x`, `referenceXY.y`,
`referenceHeightMeters`. Vertical fields are the shared reference fields.
Hashes are 64 hex characters, compared case-insensitively. Report hashes
cover the exact artifact bytes, including ENU outputs, frame and source hashes.
The control artifact additionally requires `observationSummarySha256` equal
to the exact hashed observation artifact, binding the comparison to that
specific source packet without a cyclic hash.

These hashes establish retained-byte/row linkage only. They do not prove
independent survey provenance, transform correctness or that source capture
produced those bytes. Inconsistent ENU/source numbers can still have internally
consistent hashes. Consequently `details.physicalAcceptance.status` is always
`blocked`; with `expectedCommit`, valid artifact contracts return `ok: false`,
`blocked: true` and the roadmap gate is BLOCKED. Invalid contracts return FAIL.
No boolean or metadata string unblocks this. A separately reviewed verifier
for an independently supported comparison-frame/derivation artifact is needed
before any physical/release success path can exist. No new engine or device
capture is part of this evidence-validation packet.

## Artifact Rows

The `observation_summary` evidence reference points to a JSON object with
`schemaVersion: "cplayout-gnss-observation-summary-v1"`, the common fields,
and a nonempty `observations` array. Each row has exactly:

```json
{
  "id": "observation-1",
  "sessionId": "session-1",
  "observedAt": "2026-09-13T00:00:01.000Z",
  "projectedXY": { "x": 500000.01, "y": 4400000 },
  "heightMeters": 0.02,
  "comparisonEnu": { "eastMeters": 0.01, "northMeters": 0, "upMeters": 0.02 },
  "sourceSha256": "<computed source-tuple SHA-256>",
  "fix": "rtk_fixed",
  "observationAgeSeconds": 0.5,
  "correctionAgeSeconds": 1
}
```

The example is a synthetic shape, not a transformation oracle; replace the
hash placeholder with its recomputed value before validation. `fix` is one of `rtk_fixed`, `rtk_float`,
`autonomous` or `differential`. Coordinates and `heightMeters` must be finite
numbers in meters; signed heights are permitted. Ages are finite,
nonnegative seconds. Observation IDs are unique. Each observation references
an existing report session and occurs within that session's start/end times.
Report session IDs are unique and their end times cannot precede start times
or follow report generation. Session counts are the exact counts of retained
derived observations, including the exact `rtk_fixed` subset. They are not
unverifiable claims about additional receiver messages omitted from evidence.

The `control_point_comparison` reference points to a distinct JSON object with
`schemaVersion: "cplayout-gnss-control-point-comparison-v1"`, the common fields,
the `observationSummarySha256` link, and at least two `comparisons` rows.
Each synthetic row has exactly:

```json
{
  "controlId": "control-1",
  "observationId": "observation-1",
  "sessionId": "session-1",
  "referenceXY": { "x": 500000, "y": 4400000 },
  "referenceHeightMeters": 0,
  "comparisonEnu": { "eastMeters": 0, "northMeters": 0, "upMeters": 0 },
  "sourceSha256": "<computed source-tuple SHA-256>"
}
```

Control IDs and referenced observations must each be distinct. The referenced
observation must exist, be `rtk_fixed`, and belong to the stated session. The
measured point and finite `heightMeters` come from that observation. Each
control supplies finite `referenceHeightMeters` in the identical shared
vertical reference. For each control the validator computes:

```text
dx = observation.comparisonEnu.eastMeters - control.comparisonEnu.eastMeters
dy = observation.comparisonEnu.northMeters - control.comparisonEnu.northMeters
dz = observation.comparisonEnu.upMeters - control.comparisonEnu.upMeters
horizontalError = hypot(dx, dy)
verticalError = abs(dz)
threeDimensionalError = hypot(dx, dy, dz)
```

For each error dimension, RMS is `sqrt(sum(error^2) / count)` and maximum is
the greatest per-control error. Required report results are
`horizontalRmsMeters`, `maxControlErrorMeters`, `verticalRmsMeters`,
`maxVerticalErrorMeters`, `threeDimensionalRmsMeters` and
`maxThreeDimensionalErrorMeters`, all finite and nonnegative. Distinct control
count must match exactly; all recomputed numeric results must match within
absolute tolerance `1e-9`. Maximum observation/correction ages are also
recomputed from retained rows. No missing height is filled with zero.

`acceptance.maxThreeDimensionalErrorMeters` defaults to `0.10` and must be
positive and no greater than `0.10`; a report cannot relax the owner's target.
Both reported and independently recomputed maxima must be **strictly less**
than that declared bound. A measured `0.10` fails. A smaller declared bound
remains exclusive. The metric-comparison tolerance never applies to this
acceptance boundary, so a slightly underreported maximum cannot admit a
threshold measurement.

Horizontal checks remain additional requirements: the engineering default
`maxHorizontalRmsMeters: 0.03` is inclusive and is not a 10 cm RMS requirement.
`maxControlErrorMeters: 0.10` is an additional exclusive horizontal maximum;
its declared bound can also be stricter but cannot exceed `0.10`. Observation
and correction age thresholds remain inclusive. Passing horizontal checks
cannot substitute for 3D evidence. No separate vertical or 3D RMS threshold
is invented; their reported statistics must still match recomputation.

The computed norms use only the declared common ENU coordinates. They do not
establish physical 3D accuracy, grid-to-ground corrections, vertical
transformations, survey-control provenance or an Android receiver pipeline.
Those remain blocked field/runtime proof requirements. Existing source-capture
height contracts can remain v1; these are required derived-evidence fields
only. Canonical project XY schemas are unchanged.

Artifacts and nested rows reject unknown fields. Do not include raw NMEA,
correction streams, credentials or freeform payloads. Report references must
have distinct kinds, resolved paths, filesystem identities and file contents.
SHA-256 must match the exact retained bytes before JSON content is accepted.
Symlink, hardlink, copied-content and relabeling duplicates do not qualify as
independent observation and control evidence. Legacy JSONL/CSV references do
not satisfy this versioned contract; no legacy numeric claims are upgraded
automatically.

## Other Release Evidence Checks

Commit comparison preserves the existing `--short=12` policy with 12-40 hex
characters and case-insensitive prefix comparison. Whitespace, `-dirty`,
nonhex suffixes and overlong IDs fail. This is a comparison policy, not a Git
object existence or abbreviation-uniqueness check.

PNG evidence must have bounded complete chunks and valid CRCs. Unknown
critical chunks fail; IHDR must be first and IEND last. PLTE is optional only
for the supported RGB/RGBA types, occurs at most once before IDAT, and must
contain 1-256 RGB entries. Grayscale evidence cannot contain PLTE. Multiple
IDAT chunks must be consecutive; an intervening ancillary chunk ends the IDAT
sequence. These checks follow the [PNG chunk-order rules](https://www.w3.org/TR/png-3/#5ChunkOrdering)
and [unknown-critical-chunk handling](https://www.w3.org/TR/png-3/#13Decoders.Errors).
The existing `tools/pngMetrics.ts` decoder recomputes dimensions,
nonblank ratio and grayscale variance; metadata alone is insufficient. Width
and height match exactly, ratio tolerance is `1e-9`, and variance tolerance
is `0.001` for rounding. Blank/uniform images fail; Google Earth thresholds
cannot fall below ratio `0.08` and variance `80`. Native MapLibre uses its
producer's ratio `> 0.05` and variance `> 20` thresholds. Limits are 64 MiB
compressed PNG and 16,777,216 pixels. Decoder support remains baseline,
noninterlaced 8-bit grayscale/RGB/RGBA. Evidence must be fully opaque; `tRNS`
and nonopaque alpha pixels fail. Inflated payload size must match dimensions.
These checks do not establish that the
image shows a particular app, overlay, map or real device.

The current Google Earth PowerShell producer samples pixels using weighted
grayscale and a different nonblack threshold. Its legacy metrics may fail
comparison with full-image `pngMetrics` values. A producer update or reviewed
derived manifest with recomputed values is required; this validator does not
recapture Google Earth or silently rewrite evidence. KML/KMZ styles remain
visual interchange metadata only.

Cleanup must affirm `contaminated: false` and a postflight result. Accepted
closed states are `closed_gracefully`, `closed_after_modal_discard` and
`force_closed`, with `postflightProcessRemaining: false`. Manual-review
`skipped_leave_open` is accepted only with explicit `requested: true`,
`leaveOpen: true` and a boolean postflight result. This intentional skip is
retained in the validation details; it does not prove session closure.

Native release checks with `expectedCommit` remain **BLOCKED**, even when
the report contract and host commit match. `tools/androidNativeProof.ts`
captures `currentGitCommit()` on the host; `tools/nativeMapLibreProof.ts` does
the same for `app.commit`. Neither links the observed installed APK or running
JavaScript bundle to that checkout. No boolean field, app-provided commit
string or package/version match substitutes for verifiable linkage. This
implementation deliberately has no native release success path. A future bounded
producer/verifier change must bind installed build/bundle hashes to committed
source and observed runtime before removing this blocker. Actual native
capture and full release validation belong to the main coordinator.

Nonrelease native checks can pass an honest report contract. That result
must not be described as installed-build identity verification or release
approval. Native MapLibre `tileServer.tileRequests` must be a finite positive
integer, and `generatedAt` must be a valid ISO UTC timestamp even outside
release mode. Invalid calendar dates and exponent-overflow JSON numbers fail.
