# Corner-arm research harness

Offline, synthetic, projected/local-XY research. Start with the
[research packet](../../docs/corner-arm-geometry-research-plan.md) and
[source reconciliation](../../docs/corner-arm-research-sources.md).
No production machine profile, saved project, map renderer or controller is
changed by these tools.

## Reproduce

Run from the repository root with the repository's installed npm dependencies.
The harness does not add npm packages.

```sh
node_modules/.bin/tsc -p tools/corner-arm-research/tsconfig.json
node_modules/.bin/tsx tools/corner-arm-research/harness.test.ts
node_modules/.bin/tsx tools/corner-arm-research/cli.ts benchmark
node_modules/.bin/tsx tools/corner-arm-research/cli.ts verify fixtures/corner-arm-research/square-layout.json
node_modules/.bin/tsx tools/corner-arm-research/cli.ts generate fixtures/corner-arm-research/square-layout.json --layers 33 --states 9 --max-transitions 30000
```

The TypeScript CLI prints JSON and reads only explicitly supplied research
inputs. `verify` reports a geometric outcome, including violated constraints or
missing evidence. A successful process exit is not by itself a verified path;
inspect `status`. `benchmark` requires every frozen expected result and analytic
library check to match. Full-circle derivative closure is checked even when
position closure passes.

Python 3.12 and `uv` are needed for the independent companion. Initial setup
downloads pinned free packages into this tool's ignored `.venv`; subsequent
runs can be offline. NumPy 2.5.3, SciPy 1.18.1, Shapely 2.1.2 and pyproj 3.8.0
plus their locked dependencies are recorded in `python/uv.lock`. They are not
React Native dependencies. PROJ network access is explicitly disabled.

```sh
uv sync --frozen --project tools/corner-arm-research/python
uv run --frozen --offline --project tools/corner-arm-research/python python -B -m unittest discover -s tools/corner-arm-research/python -p 'test_*.py' -v
uv run --frozen --offline --project tools/corner-arm-research/python python -B tools/corner-arm-research/python/companion.py reference
uv run --frozen --offline --project tools/corner-arm-research/python python -B tools/corner-arm-research/python/companion.py oracle fixtures/corner-arm-research/square-layout.json
uv run --frozen --offline --project tools/corner-arm-research/python python -B tools/corner-arm-research/python/run_comparison.py .cplayout-local/corner-arm-research/run-001
```

Choose a **new** output directory for each comparison; existing evidence is
never overwritten. The comparison runs the frozen fixture benchmark, then
baseline/graph/spline experiments for `roomy-circle` and `square-layout`, and
checks coordinates against the independently formulated Python model. It saves
full candidates, verifications, solver outcomes, hashes, versions and measured
local timings. No app server, browser, Google Earth or machine connection starts.

An individual spline experiment is also available; its parent output directory
must already exist, and the candidate file must be new:

```sh
uv run --frozen --offline --project tools/corner-arm-research/python python -B tools/corner-arm-research/python/companion.py optimize fixtures/corner-arm-research/square-layout.json --candidate .cplayout-local/corner-arm-research/run-001/additional-candidate.json --maxiter 100
node_modules/.bin/tsx tools/corner-arm-research/cli.ts verify .cplayout-local/corner-arm-research/run-001/additional-candidate.json
```

## Research contract

JSON uses `schemaVersion: cplayout-corner-research-v1`. All distances are metres
in an explicitly synthetic flat XY frame; all angles are radians. Each fixture
includes a pivot, hinge radius, arm and overhang lengths, body half-width,
SDU-relative body offsets, aligned tower radii, articulation/slope limits, field
outer ring/holes, obstacle rings, clearance, numerical budgets and a directed
sweep. `trajectory.knots` contains strictly ordered unwrapped `thetaRad` and
relative `alphaRad`; interpolation is always `linear`.

Hinge and LRDU coincide in this abstraction. Antenna and wheel offsets use
`Q = SDU + Rot(theta + alpha) * offset`; they are buffered point tracks, not real
wheel rolling/steering models or footprints. No nominal manufacturer dimension
is substituted for a measured mechanical offset.

The manifest is the finite case roster and declares each expected outcome.
The straight-SDU fixture derives angle **knots** analytically; it does not claim
that linear interpolation follows a straight guidance path between those knots.
The clipped-endpoint negative control demonstrates loss of rigid length. An
unsupported arbitrary guide path is not quietly replaced with a circular reach.

The TypeScript core uses independent geometric predicates and a conservative
midpoint-displacement bound for complete members/offset points. It fails closed
to `numerically_unresolved` when the strict positive clearance bound cannot be
established. `toleranceM` is a displacement/subdivision stop threshold, separate
from the computed floating-point guard; neither permits boundary intrusion.
The synthetic slope limit is `dalpha/dtheta`, **not** an actuator rate in time.

Graph defaults: 33 angle layers, 9 articulation states, 30,000 transition budget,
100,000 shared interval-proof visits. Objective is mean extension loss
`1-cos(alpha)` plus `0.05` times mean squared articulation slope. It is
dimensionless, uses trapezoidal extension integration and exact linear slope
integration, and is neither water coverage nor a global optimality guarantee.

Spline defaults: 9 control nodes, 65 collocation locations, 2 deterministic
constant seeds, at most 100 SLSQP iterations per seed. Geometry constraints are
sampled during optimization. The cubic is resampled to 129 linear knots; for
full cycles, first/last secants are explicitly matched by adjusting two interior
knots. **Only the resulting linear candidate can be accepted by the separate
TypeScript verifier.** The original cubic remains unverified. Failed optimizer
status, no search candidate, violation and numerical uncertainty stay distinct.

The Shapely oracle rejects invalid dimensions/margins and incomplete sweeps. Its
positive metric is sampled clearance; a negative value is an intersection or
outside-length collision penalty, **not penetration depth**. It cannot prove
continuous clearance. Coordinate comparisons use a synthetic numerical tolerance
of 1e-7 m; this is not survey or field accuracy.

## Explicit exclusions

No general inverse SDU guidance solver, manufacturer joint/steering mechanisms,
time schedule, stop/reversal controller, traction, terrain-following articulation,
hydraulics, wetted footprint, field qualification, native parity or controller
export is implemented here. Interior linear-knot derivative jumps remain a
dynamics limitation. Unknown inputs and these exclusions are part of the output,
not an invitation to treat a synthetic positive result as production readiness.

## Validation and retained findings

See [execution evidence](../../docs/evidence/corner-arm-research/README.md) for
source-matched results, candidate outcomes, independent QA and any broader
worktree failures. Run `npm run validate` after TypeScript changes, alongside
the focused commands above, `npm run validate:design-guides`,
`npm run validate:corner-service-manuals`, `npm run validate:skills`,
`npm run context-map:check`, `git diff --check` and `npm audit`.
No research result waives the app's browser, native or physical evidence gates.
