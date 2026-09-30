# CPLayout Local ML Companion

This tool is a WSL-local companion for advisory layout analysis. It reads a CPLayout project JSON or project ZIP, writes standalone report JSON plus optional projected-XY GeoJSON for workspace inspection, and leaves browser/native runtime code free of Python, GDAL, or ML dependencies.

## Environment

Use Python 3.12 with `uv`. Point `uv` at a new environment so an existing companion `.venv` is preserved:

```sh
cd tools/local-ml-companion
UV_PROJECT_ENVIRONMENT=/absolute/path/to/new-companion-env uv sync --frozen
```

Install optional companion groups only in this local Python environment:

```sh
UV_PROJECT_ENVIRONMENT=/absolute/path/to/new-companion-env uv sync --frozen --extra all
```

These extras are not React Native runtime dependencies. Rasterio, GeoPandas, and rioxarray are for offline raster/vector inspection; scikit-image, Matplotlib, and Plotly are for local CV/report artifacts; Streamlit and Dash are local review UI tools; FastAPI, Uvicorn, and SQLAlchemy are optional localhost sidecar infrastructure. The `experiment` extra adds DVC and MLflow; `all` includes it. SQLAlchemy must not write CPLayout's Expo SQLite project database. The base dependency on portable-cv-toolkit 0.3.1 resolves from the checked-in wheel in `vendor/`. Its [provenance record](vendor/provenance.json) binds all 25 source files and the notice to the published CV commit. Version 0.3.1 adds packaging provenance; it does not establish a new CUDA runtime qualification.

Probe all companion dependency groups after installing extras:

```sh
uv run cplayout-ml probe-companion-deps --groups all --require-installed
```

`probe-companion-deps` is an import smoke test only. It does not call cloud services, download model weights, mutate project geometry, or write the CPLayout project database.

Install CUDA PyTorch after `uv sync` when a GPU-backed run is needed:

```sh
uv pip install --index-url https://download.pytorch.org/whl/cu130 torch torchvision torchaudio
```

The CUDA-backed probe must pass before output is treated as GPU-backed:

```sh
uv run cplayout-ml probe-gpu
```

The first recommender is deterministic and advisory. It is not a production-trained agronomy model.

DVC and MLflow are optional local experiment dependencies. The repository tracks DVC metadata and config, while `.dvc/cache/`, `mlruns/`, local dataset materializations, and generated model files stay ignored. No DVC remote or hosted MLflow tracking server is configured by default.

The imagery field-boundary detector is offline-only. OpenCV is the required CPU scoring/refinement layer. The older implicit SAM2 proposal adapter is disabled because that call does not provide prompts, asset hashes, model revision, and an output root. Package visibility and a CUDA tensor preflight do not prove SAM2 inference or accelerate OpenCV scoring.

```sh
uv run cplayout-ml probe-boundary-detector \
  --sam2-config "$CPLAYOUT_SAM2_CONFIG" \
  --sam2-checkpoint "$CPLAYOUT_SAM2_CHECKPOINT"
```

`CPLAYOUT_SAM2_CONFIG` and `CPLAYOUT_SAM2_CHECKPOINT` may be used instead of flags. `probe-boundary-detector` reports the legacy SAM2 proposal slot unavailable and separately reports whether an explicit managed job runner is configured. The companion can still run the OpenCV scoring path.

For an explicit SAM2 image job, prepare a `CVJob-v1` JSON with local image, checkpoint, and config assets and their SHA-256 hashes, point prompts and labels, model revision, input classification, and a separate output root. Set `CPLAYOUT_CV_PYTHON` to an absolute executable path for a managed Python environment that has portable-cv-toolkit installed, then run:

```sh
PYTHONPATH=src CPLAYOUT_CV_PYTHON=/absolute/path/to/managed/bin/python python3 -m cplayout_ml.cli run-managed-cv-job --job /absolute/path/to/job.json
```

The bridge invokes that interpreter with `-m cv_toolkit.runtime run` and leaves validation, resource limits, leases, outputs, and cleanup to the toolkit. It does not import a sibling checkout, infer prompts from imagery, download a model, or promote masks to canonical projected XY. A completed job is runtime evidence for that explicit job only; mask interpretation and field review remain CPLayout work.

## File Bridge

```sh
uv run cplayout-ml report-layout-candidates \
  --input ../../sample-burgundy-quarter-section.center-pivot.zip \
  --output-dir ./out \
  --created-at 2026-05-28T00:00:00.000Z
```

If `--created-at` is omitted, the CLI uses a fixed fixture timestamp so repeated runs with the same input produce byte-stable report files. Pass an explicit ISO timestamp when preparing a field-inspection package.

Outputs are `layout-candidate-report.json` and `layout-candidate-report-candidates.geojson`. They are standalone companion reports, are not imported into CPLayout as recommendation records, and do not mutate canonical project geometry.

## Design-Only Google Earth Vision Review

The `design-vision-review` command consumes an existing Google Earth Pro proof packet and writes a local advisory report. It requires explicit paths for the KML, KMZ, full-window screenshot, map-canvas crop, and visual-fidelity manifest, then records SHA-256 hashes for every artifact. The full-window screenshot is required because map-canvas crops alone do not preserve attribution evidence.

```sh
uv run cplayout-ml design-vision-review \
  --kml ../../reports/google-earth-visual-fidelity/iteration-7-browser-study/generated-proof-clean/cplayout-google-earth-visual-fidelity.kml \
  --kmz ../../reports/google-earth-visual-fidelity/iteration-7-browser-study/generated-proof-clean/cplayout-google-earth-visual-fidelity.kmz \
  --full-window ../../reports/google-earth-visual-fidelity/iteration-7-browser-study/generated-proof-clean/google-earth-visual-fidelity-full-window.png \
  --map-canvas ../../reports/google-earth-visual-fidelity/iteration-7-browser-study/generated-proof-clean/google-earth-visual-fidelity-map-canvas.png \
  --manifest ../../reports/google-earth-visual-fidelity/iteration-7-browser-study/generated-proof-clean/visual-fidelity-manifest.json \
  --output-dir ../../reports/google-earth-visual-fidelity/design-vision-review \
  --project-id public-adams-county-center-pivot-proof \
  --project-crs EPSG:32613 \
  --project-reference ../../exports/public-adams-county-center-pivot-proof-project.json \
  --created-at 2026-05-29T00:00:00.000Z
```

Outputs are `visual-layout-review.json`, `visual-layout-review-candidates.geojson`, and `visual-layout-review-annotated.png`. The JSON is standalone companion evidence with `canonicalGeometryMutation: false`. When `--project-reference` points to an accepted CPLayout project JSON or ZIP, projected-XY pivot and obstacle context can be copied into the report for inspection. Field-boundary candidates are included only when `--infer-field-boundary` finds and calibrates an imagery field outline. Without calibration, the report remains metadata-only for boundary geometry and may include KML `LookAt` WGS84 display context. CV metrics are image-space only; they may warn about center/radius/overlay/boundary alignment, but canonical geometry changes still require CPLayout Files import, Map editing, validation, and operator action.

Pass `--infer-field-boundary` when the review must look for a road, fenceline, treeline, or field-separation outline in the Google Earth map-canvas screenshot. This detector rejects circular crop or pivot coverage rings as field boundaries. It exports a projected-XY boundary recommendation only when a visible CPLayout overlay circle and a project reference provide calibration evidence; otherwise the detected polygon stays image-space advisory evidence.

Pass `--operator-boundary-kml <path>` when Google Earth Pro contains a human-drawn Polygon Placemark for comparison. Use `--operator-boundary-kml -` to pipe pasted KML on stdin, or `--operator-boundary-kml-text "$KML"` when a caller already has raw KML text. The default placemark name is `USER DRAWN FIELD BOUNDARY`; override it with `--operator-boundary-name`. The command accepts `.kml`, `.kmz`, stdin, or raw text, extracts exactly one matching Polygon, rejects missing, line-only, unclosed, or duplicate matches with warnings, and writes it as operator evidence in `detections.truthBoundary`, `detections.operatorFieldBoundary`, and `detections.truthLabels.targetFieldBoundary`. Operator labels are scoring and learning feedback; they are not written to `detections.cvCandidateBoundary` or `detections.imageryFieldBoundary` as CV predictions and do not create `candidateReports[].proposedGeometry.fieldBoundary`.

The detector must not synthesize a box around the pivot ring. If imagery-derived road, fenceline, treeline, or field-separation evidence is not strong enough, `detections.imageryFieldBoundary` is either `null` or marked `rejected: true`, and `candidateReports[].proposedGeometry.fieldBoundary` is omitted. Accepted detections include `source`, `imagePolygon`, optional `projectedPolygon`, `confidence`, `edgeAlignment`, `rectilinearity`, `circularity`, `containment`, `rejectionReasons`, and a `candidateMasks` audit summary.

When an operator label can be pixel-aligned through the proof KML, project reference, and overlay-circle calibration, `visual-layout-review.json` also includes `operatorComparison` metrics for imagery candidates: `iou`, `boundaryMeanDistancePixels`, `boundaryMaxDistancePixels`, `falsePositiveAreaRatio`, and `falseNegativeAreaRatio`. CV candidates fail hard when they are 4-point axis-aligned extent rectangles, clipped by the screenshot edge, exceed `0.08` false-positive area ratio, exceed `80 px` mean boundary distance, or miss the irregular south/southeast operator-boundary features. High IoU alone is never sufficient for CV acceptance. `learningRecommendations[]` records detector/ranking issues such as weak candidate generation, low overlap, or unusable operator-label calibration.

Projected boundary output remains advisory local companion evidence. Operator acceptance still has to go through the CPLayout projected-XY import/editor/validation workflows before any canonical geometry changes.

## Pivot Candidate Detection

Use `detect-pivot-candidates` to run the local OpenCV pivot-center detector and emit standalone companion report records. This command writes evidence and metadata-only candidate summaries unless a future calibrated path can prove projected `XY` output.

```sh
uv run cplayout-ml detect-pivot-candidates \
  --synthetic-fixture \
  --project-id synthetic-pivot-candidate \
  --project-crs LOCAL:IMAGE \
  --output-dir ../../reports/ml-cv-pivot-candidates/20260601T-run \
  --iterations 100
```

For a real local screenshot, replace `--synthetic-fixture` with `--map-canvas <local-png>`. Optional `--truth-center-x`, `--truth-center-y`, and `--truth-radius` values score image-space truth only; they do not create project-CRS geometry.

Outputs are `pivot-candidates-report.json`, `pivot-candidates-candidates.geojson`, `pivot-candidates-iterations.jsonl`, and `pivot-candidates-annotated.png`. The report intentionally omits projected pivot geometry while `projected XY calibration absent` remains in `metadata.hardFailures`. It cannot auto-apply geometry.

## Boundary Improvement Loop

Use `improve-boundary-detector` when a proof packet has imagery plus an optional operator-drawn boundary label and weak detector output must not be accepted. The command always runs at least five detector iterations, including baseline Canny/Hough, low-threshold fenceline search, high-contrast road/structure search, surface color variation, and operator-ranked surface-edge feedback.

```sh
uv run cplayout-ml improve-boundary-detector \
  --map-canvas ../../reports/google-earth-visual-fidelity/adams-operator-boundary-proof-20260529T-local/google-earth-visual-fidelity-map-canvas.png \
  --full-window ../../reports/google-earth-visual-fidelity/adams-operator-boundary-proof-20260529T-local/google-earth-visual-fidelity-full-window.png \
  --kml ../../reports/google-earth-visual-fidelity/adams-operator-boundary-proof-20260529T-local/cplayout-google-earth-visual-fidelity.kml \
  --project-reference ../../reports/google-earth-visual-fidelity/public-adams-county-center-pivot-proof-project.json \
  --operator-boundary-kml ../../reports/google-earth-visual-fidelity/operator-user-drawn-field-boundary.kml \
  --output-dir ../../reports/google-earth-visual-fidelity/boundary-improvement-loop/manual-run \
  --min-iterations 5
```

Outputs are `boundary-improvement-loop.json`, `boundary-improvement-iterations.jsonl`, and `boundary-improvement-annotated.png`. The v2 JSON records every iteration, candidate counts, rejection reasons, operator IoU when labels are available, `detections.truthBoundary` for operator-truth reconstruction, and `detections.cvCandidateBoundary` for advisory detector output. `acceptance.accepted` describes CV candidate quality independent of CUDA; `autoApplyEligible` remains false and `operatorReviewRequired` remains true. `stageObservations` distinguishes CPU OpenCV scoring from the optional CUDA tensor diagnostic. Operator truth remains separate and does not mutate projected `XY` project geometry.

When CUDA PyTorch is installed and `uv run cplayout-ml probe-gpu` passes, the command runs a CUDA tensor preflight over the map image and records the device and tensor statistics. OpenCV scoring remains CPU-bound unless the local OpenCV build itself exposes CUDA.

## Vision Fixture Evaluation

Use `evaluate-vision-fixtures` for repeatable local regression checks over operator-approved proof packets:

```sh
uv run cplayout-ml evaluate-vision-fixtures \
  --manifest ../../reports/google-earth-visual-fidelity/fixtures/vision-fixtures.json \
  --output-dir ../../reports/google-earth-visual-fidelity/fixture-evaluation
```

The manifest contains `fixtures[]` entries with local paths for `fullWindowScreenshot`, `mapCanvasCrop`, optional `kml`, optional `kmz`, optional `visualFidelityManifest`, optional `projectReference`, and expected booleans such as `expected.boundaryPresent`, `expected.overlayPresent`, and `expected.blackCanvas`. Outputs are `vision-evaluation-summary.json`, `vision-evaluation-cases.jsonl`, and per-case annotated PNGs. The evaluation reports precision, recall, IoU-style boundary detection metrics, overlay detection metrics, false-positive categories, and semantic advisory cues such as pivot ring, overlay, service/access lines, radial/corner-arm cues, and advisory boundaries.

This command is offline/local only. It does not download SAM2 checkpoints, call a network service, cache Google imagery, or write canonical `PivotProject` geometry.

## Full Local ML Loop

Use `prepare-vision-dataset` to validate a local fixture manifest, hash artifact paths, record provenance, and assign deterministic project-level train/validation/test splits without copying restricted imagery:

```sh
uv run cplayout-ml prepare-vision-dataset \
  --manifest ../../reports/google-earth-visual-fidelity/fixtures/vision-fixtures.json \
  --output-dir ../../reports/google-earth-visual-fidelity/ml-loop/dataset \
  --split-seed cplayout-local-vision-v1
```

Use `run-boundary-experiment` to run the OpenCV fixture baseline, optional per-fixture boundary-loop variants, and local MLflow logging:

```sh
uv run cplayout-ml run-boundary-experiment \
  --manifest ../../reports/google-earth-visual-fidelity/fixtures/vision-fixtures.json \
  --output-dir ../../reports/google-earth-visual-fidelity/ml-loop/experiment-001 \
  --experiment-name cplayout-boundary-loop
```

The experiment report compares the deterministic OpenCV baseline, an OpenCV+SAM2 proposal slot, and a trained-model slot. SAM2 and trained-model candidates remain `not_run` unless local config/checkpoints or model artifacts are explicitly supplied by future companion work. MLflow writes to an ignored local `mlruns/` folder under the experiment output; reports also record DVC metadata and pointer-file state when present.

Use `summarize-boundary-experiments` to generate deterministic JSON and Markdown comparisons:

```sh
uv run cplayout-ml summarize-boundary-experiments \
  --input ../../reports/google-earth-visual-fidelity/ml-loop/experiment-001 \
  --output-dir ../../reports/google-earth-visual-fidelity/ml-loop/summary
```

These commands are offline/local only. They reject hidden-key provenance, do not upload imagery or telemetry, and do not mutate canonical project geometry.

## Companion GIS/CV Evidence Packets

The companion can prepare local GIS/CV evidence packets without changing the CPLayout project schema. Projected/local `XY` remains canonical, and image-space detections, WGS84 display coordinates, screenshots, masks, and scores stay evidence unless a valid project-CRS calibration exists.

Use these packets for sample/design evidence only. They are workspace artifacts for operator inspection, source hashes, CV candidates, local dashboards, and documentation summaries. They are not app-importable recommendation records, do not write the CPLayout project database, and must carry `canonicalGeometryMutation: false`, `evidenceOnly: true`, `appImportable: false`, and `writesProjectDatabase: false`.

Hash and inspect local raster/proof artifacts:

```sh
uv run cplayout-ml prepare-raster-fixtures \
  --manifest ./fixtures/raster-fixtures.json \
  --output-dir ./out/raster-fixtures \
  --project-id sample-project \
  --project-crs EPSG:32613
```

Pass `--require-projected-output` only when projected raster output is expected. The command rejects missing or geographic raster CRS in that mode.

Validate local operator vector labels:

```sh
uv run cplayout-ml validate-vector-labels \
  --input ./fixtures/operator-labels.geojson \
  --output-dir ./out/vector-labels \
  --project-id sample-project \
  --project-crs EPSG:32613
```

When GeoPandas is installed and a valid CRS transform is available, labels can be exported as projected-XY companion evidence. Otherwise WGS84 or unknown-CRS labels remain evidence-only warnings.

Build a standalone companion report packet:

```sh
uv run cplayout-ml build-evidence-packet \
  --project-id sample-project \
  --project-crs EPSG:32613 \
  --raster-fixtures ./out/raster-fixtures/raster-fixture-metadata.json \
  --vector-labels ./out/vector-labels/vector-label-validation.json \
  --cv-candidates ./out/cv-candidates.json \
  --output-dir ./out/evidence-packet
```

Outputs are `companion-evidence-packet.json`, `companion-evidence-packet-candidates.geojson`, and `companion-evidence-packet-projected-xy.geojson`. The JSON uses `schemaVersion: "cplayout-imagery-evidence-v2"` and is a companion-owned report packet, not a CPLayout project review schema. It records local-only boundary flags, artifact hashes, attribution, calibration metadata, and measured visual evidence when a readable local image artifact is supplied. Candidates without `valid_projected_xy` calibration and projected operator truth remain metadata-only with hard-failure notes.

Validate a strict v2 packet from the repo root before using it as a review or roadmap gate:

```sh
npm run verify:imagery-evidence -- --packet tools/local-ml-companion/out/evidence-packet/companion-evidence-packet.json
```

Use `--require-calibrated-projected-candidate` only for gates that must prove at least one candidate reached `calibrated_projected_xy`. The verifier is read-only and does not import packet data, write CPLayout project storage, or mutate canonical projected `XY`.

Run a read-only local Streamlit dashboard dry run:

```sh
uv run cplayout-ml serve-review-dashboard \
  --packet ./out/evidence-packet/companion-evidence-packet.json \
  --dry-run
```

Streamlit is the primary companion dashboard. It shows packet health, CRS/calibration status, evidence records, candidate summaries, hard failures, artifact hashes, projected-XY features, warnings, and local provenance. The dashboard is read-only: it has no Apply action, writes no CPLayout project database, requires no key, and cannot mutate geometry.

Use the secondary Dash/Plotly comparison dashboard when candidate filtering is needed:

```sh
uv run cplayout-ml serve-review-dashboard \
  --packet ./out/evidence-packet/companion-evidence-packet.json \
  --engine dash \
  --port 8502 \
  --dry-run
```

Write a local Plotly HTML comparison report:

```sh
uv run cplayout-ml serve-review-dashboard \
  --packet ./out/evidence-packet/companion-evidence-packet.json \
  --export-html ./out/evidence-packet/companion-comparison.html
```

The static report writes a local `plotly.min.js` asset beside the HTML and rejects CDN/cloud script references. It is a local review artifact only.

Run the optional localhost API dry run:

```sh
uv run cplayout-ml serve-companion-api \
  --workspace ./out \
  --dry-run
```

The sidecar exposes local-only endpoints:

- `GET /health`
- `GET /report-packet?path=...`
- `POST /packets/build`
- `GET /artifacts/hash?path=...`

`POST /packets/build` runs the same in-process evidence-packet builder under the configured workspace. It does not execute arbitrary commands. All paths must stay inside the workspace, hidden keys are rejected, non-local binds are rejected, and output remains standalone advisory companion evidence.

Optionally record API reads/builds in a companion-owned experiment index:

```sh
uv run cplayout-ml serve-companion-api \
  --workspace ./out \
  --experiment-db ./out/companion-experiment.sqlite \
  --dry-run
```

The experiment index uses SQLAlchemy with a companion `.sqlite` file under the workspace. It must not target CPLayout's Expo SQLite/project database.

For a complete local Google Earth proof packet and companion CV run, use the top-level orchestration script:

```powershell
powershell -ExecutionPolicy Bypass -File ../../tools/run_google_earth_design_loop.ps1 `
  -ProjectId public-adams-county-center-pivot-proof `
  -ProjectCrs EPSG:32613 `
  -ProjectReferencePath ../../exports/public-adams-county-center-pivot-proof-project.json `
  -InferFieldBoundary `
  -ConfirmOverlayVisible `
  -RequireProofPass
```

The script writes a timestamped ignored folder under `reports/google-earth-visual-fidelity/`, cleans up the targeted Google Earth Pro session by default, and records `design-loop-summary.json` beside the visual-fidelity manifest and CV review outputs. Strict cleanup is part of the proof gate: if cleanup is blocked or the targeted Google Earth Pro process remains, the run records `contaminatedGoogleEarthWorkspace: true` and fails even when the screenshots pass visual proof. Pass `-LeaveGoogleEarthOpen` only when an operator needs manual review; the summary then records `googleEarthLeftOpen: true` and cleanup is intentionally skipped rather than treated as contamination.
