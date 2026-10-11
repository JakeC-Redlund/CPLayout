# Corner-arm research execution evidence

Executed 2026-09-28 UTC / 2026-09-27 America/Denver. Base commit:
`96ba2e90aed79efae0b44ab7190a53a2bd677700`, with substantial pre-existing and
concurrently changing work. This record concerns only the isolated research
packet. No publication, manufacturer, controller, native or field acceptance is
implied.

## Retained result

[comparison.json](comparison.json) is the final `run-002` comparison, with exact
research-source/fixture hashes, candidate hashes, package versions, local timing,
solver results and independent cross-checks. All research inputs and source files
were unchanged across that run. [typescript-benchmark.json](typescript-benchmark.json)
records all 26 fixture results, their hashes and independent analytic package
checks. Reproduction commands are in the [harness README](../../../tools/corner-arm-research/README.md).

| Synthetic field | Baseline J / result | Graph J / result | Spline-derived linear candidate J / result |
| --- | --- | --- | --- |
| Roomy circle | 0.303293291 / verified within model | 0 / verified within model | 0 / verified within model |
| Constrained square | 0.303293291 / verified within model | 0.147028407 / verified within model | 0.140514470 / **constraint violated** |

J is dimensionless extension loss plus an articulation-slope penalty. A lower
number is not more watered acreage and does not outweigh a failed constraint.
Both square-field spline initializations reported optimizer convergence; the
separate trajectory verifier still rejected the exported candidate. The sampled
Shapely check also found a collision/clearance violation. This is useful negative
evidence, not a failed benchmark or permission to relax clearance.

Concrete retained candidates:

- [Roomy-field graph](roomy-circle-graph-candidate.json) and
  [roomy-field spline surrogate](roomy-circle-spline-linear-candidate.json).
- [Accepted square-field graph](square-layout-graph-candidate.json) and
  [rejected square-field spline surrogate](square-layout-spline-linear-candidate.json).

Across the six baseline/generated trajectories, independently formulated
TypeScript and Python coordinates differed by at most approximately
`1.005e-14 m`; point counts matched. This is numerical agreement on synthetic
inputs, not physical accuracy. The independent rigid-length, rotating-offset,
exact polygon-area and UTM central-meridian checks passed. PROJ network access
was disabled. No candidate was smoothed after verification.

**Development decision:** retain the deterministic graph plus common verifier as
the initial research reference. Keep spline optimization exploratory until
export-aware clearance constraints/margins and further independent fixtures are
added. This two-field experiment does not establish universal planner quality,
global optimality, performance on large fields or superiority of one library.
Retain both existing JavaScript clipping dependencies; the bounded analytic
checks do not justify a production consolidation.

## Independent review and focused checks

- Strict research TypeScript check: passed using
  `node_modules/.bin/tsc -p tools/corner-arm-research/tsconfig.json`.
- TypeScript harness: 42/42 passed. Final narrow CLI/library rerun: 2/2 passed.
- Python companion: 11/11 passed using the frozen offline lockfile.
- Frozen corpus: 26/26 expected outcomes; the corpus includes both rejected and
  unresolved cases, not 26 accepted trajectories.
- Both JavaScript clipping libraries returned expected areas 4, 28, 12 and 7 on
  their analytic examples; Proj4js returned the expected UTM central-meridian
  coordinate. Shapely/pyproj independent reference errors were zero in this run.
- Design-guide and service-manual document validators passed. The npm audit
  returned zero vulnerabilities; this is an npm audit, not a Python security audit.

Independent QA corrected two substantive issues before final comparison:
negative Python clearance/body width and incomplete sweep admission; and a
cross-language hinge-versus-SDU offset-origin mismatch. Regression tests now
cover these cases. Negative Shapely metrics are explicitly collision penalties,
not physical penetration distances. A nullable polygon-result type was then
corrected, and the exact isolated compiler/CLI checks rerun. QA accepted the
bounded synthetic research scope after these corrections.

## Whole-worktree validation

**Superseded aggregate failures (checked 2026-09-28 UTC):** the attempts below
remain diagnostic history. The later
[iterative-layout acceptance receipt](../../../.cplayout-local/publication-checkpoint-20260927/reports/iterative-layout-20260927/acceptance-evidence.json)
records `npm run validate` exit 0 against
[577 captured source/configuration paths](../../../.cplayout-local/publication-checkpoint-20260927/reports/iterative-layout-20260927/acceptance-source-r4.json).
The original VFlex pilot preflight independently rehashed all 577 paths and
found no differences before its implementation began. These historical receipts
now reside in the publication checkpoint's local-only evidence directory; they
are not a current-HEAD acceptance claim. This supersedes the mobile
import and geometry snapshot failures as current blockers; it does not qualify
the research model, an OEM exchange, a controller or a physical machine. The
original failed logs and `validation.json` are preserved unchanged. Subsequent
pilot edits require their own acceptance; see the
[VFlex/Trimble pilot evidence](../vflex-trimble-pilot/README.md).

The initial aggregate attempt failed in concurrently changing mobile code:
`App.tsx` lacked a return path, `FieldDesignWorkspace.tsx` had nullable selection
state mismatches, and `fieldMachineInputs.ts` imported an unavailable export.
Its recorded source snapshot changed in app/core/storage files during the run;
it is diagnostic evidence, not acceptance. Initial skills/context checks also
found hashes stale for concurrently edited app/core sources. These failures are
retained under `.cplayout-local/corner-arm-research/validation-20260928/`.

A separate final aggregate/governance attempt is recorded under
`.cplayout-local/corner-arm-research/validation-final-20260928/` and summarized in
[validation.json](validation.json):

| Final attempted gate | Observed result |
| --- | --- |
| Isolated research TypeScript | Passed |
| `npm run validate` | **Failed**, exit 1 after 304.569 seconds; aggregate acceptance is not established |
| Skills and generated context-map checks | Passed after regeneration against the then-current sources |
| `git diff --check` | Passed |
| Research source/fixture/candidate hashes | Matched the retained final comparison; unchanged during that comparison |

The final aggregate typecheck succeeded, but mobile tests failed when `tsx`
encountered React Native's Flow `typeof` syntax. The geometry workspace also
failed `advisoryScheduling.test.ts:26`: the Will Rhea calculation-2 frozen-output
hash was `6515ba3a…26cbab` rather than `2571acbf…582d1e`. These are outside this
isolated research harness; no expectation was changed to hide the mismatch.
Later suites continued running, so their passes are not an aggregate pass.

The final snapshot recorded 370 source/configuration paths and ten changed paths
outside the research scope, in core drawing/import/reducer and geometry search
work. The full list is retained in `validation.json`. This moving-worktree run
cannot qualify the product even if individual suites pass. The research
comparison separately bound all of its own source and fixture hashes and
completed without drift. That research packet did not run a further aggregate;
the later independent aggregate receipt is linked in the supersession note above.

## Scope and remaining evidence

The research program has completed its finite source inventory, workbook
reconciliation, input contract, equations, implementation comparison, tests and
development handoff. General inverse SDU guidance continuation, real steering
and time-dependent drive behavior, terrain, sprinkler/wetted-area modeling,
machine measurements, native/runtime behavior and field qualification remain
open. The production report sampler and radial map/placement model are still
separate and unchanged by this packet.

No product browser or Google Earth session was started. The research tools do
not start listeners or connect to machines. Existing app/schema/storage work
was preserved; raw proprietary manuals and customer coordinates were not
copied into the synthetic evidence. Full raw run results remain under
`.cplayout-local/corner-arm-research/run-002/`; the earlier `run-001` is retained
with its own source identity rather than relabeled as the final source.
