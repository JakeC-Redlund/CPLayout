from __future__ import annotations

import argparse
from pathlib import Path


def main(argv: list[str] | None = None) -> int:
    from . import cli as handlers
    from .cli import DEFAULT_CREATED_AT, SAM2_CONFIG_ENV, SAM2_CHECKPOINT_ENV

    parser = argparse.ArgumentParser(prog="cplayout-ml")
    subcommands = parser.add_subparsers(dest="command", required=True)

    subcommands.add_parser("probe-gpu", help="Verify WSL NVIDIA and PyTorch CUDA visibility.")
    deps_probe = subcommands.add_parser("probe-companion-deps", help="Smoke-test optional local companion dependency groups.")
    deps_probe.add_argument("--groups", nargs="+", default=["all"], help='Groups to probe: all, base, gis, vision, dashboard, api, experiment. Comma-separated values are accepted.')
    deps_probe.add_argument("--require-installed", action="store_true", help="Return a non-zero exit code when any selected dependency import fails.")

    boundary_probe = subcommands.add_parser("probe-boundary-detector", help="Report local OpenCV/SAM2 field-boundary detector availability.")
    boundary_probe.add_argument("--sam2-config", type=Path, help=f"SAM2 config path. Defaults to ${SAM2_CONFIG_ENV}.")
    boundary_probe.add_argument("--sam2-checkpoint", type=Path, help=f"SAM2 checkpoint path. Defaults to ${SAM2_CHECKPOINT_ENV}.")

    layout_candidates = subcommands.add_parser("report-layout-candidates", help="Generate deterministic standalone layout candidate reports.")
    layout_candidates.add_argument("--input", required=True, type=Path, help="CPLayout project.json or .center-pivot.zip")
    layout_candidates.add_argument("--output-dir", required=True, type=Path, help="Directory for standalone companion report outputs")
    layout_candidates.add_argument("--max-alternatives", type=int, default=5)
    layout_candidates.add_argument(
      "--created-at",
      default=DEFAULT_CREATED_AT,
      help="ISO timestamp to write into candidate reports. Defaults to a stable fixture timestamp for deterministic output.",
    )

    vision = subcommands.add_parser("design-vision-review", help="Create a local design-only CV review from Google Earth proof artifacts.")
    vision.add_argument("--kml", required=True, type=Path, help="CPLayout browser-exported or proof KML opened in Google Earth Pro.")
    vision.add_argument("--kmz", required=True, type=Path, help="CPLayout browser-exported or proof KMZ for inventory/hash linkage.")
    vision.add_argument("--full-window", required=True, type=Path, help="Full Google Earth Pro screenshot with attribution visible.")
    vision.add_argument("--map-canvas", required=True, type=Path, help="Map-canvas crop from the same proof run.")
    vision.add_argument("--manifest", required=True, type=Path, help="Google Earth visual-fidelity manifest from the proof run.")
    vision.add_argument("--output-dir", required=True, type=Path, help="Directory for visual-layout-review outputs.")
    vision.add_argument("--project-id", required=True, help="CPLayout project id for review evidence linkage.")
    vision.add_argument("--project-crs", required=True, help="Projected CPLayout CRS; geographic CRS aliases are rejected.")
    vision.add_argument(
      "--project-reference",
      type=Path,
      help="Optional accepted CPLayout project JSON or ZIP used as the projected-XY geometry source for recommendations.",
    )
    vision.add_argument(
      "--infer-field-boundary",
      action="store_true",
      help="Infer an advisory imagery field-boundary polygon from road, fence, tree-line, and field-separation cues.",
    )
    vision.add_argument("--operator-boundary-kml", help='Optional KML/KMZ containing one named operator-drawn field boundary Polygon. Use "-" to read KML from stdin.')
    vision.add_argument("--operator-boundary-kml-text", help="Optional raw KML text for one named operator-drawn field boundary Polygon.")
    vision.add_argument("--operator-labels-kml", help="Optional KML/KMZ containing fixed operator labels: TRUE_PIVOT_CENTER, TARGET_FIELD_BOUNDARY, SOUTH_ROAD_EXCLUSION, and SE_BUILDING_TREE_EXCLUSION.")
    vision.add_argument("--operator-labels-kml-text", help="Optional raw KML text containing fixed operator labels.")
    vision.add_argument(
      "--operator-boundary-name",
      default="USER DRAWN FIELD BOUNDARY",
      help='Placemark name to extract from --operator-boundary-kml. Defaults to "USER DRAWN FIELD BOUNDARY".',
    )
    vision.add_argument("--sam2-config", type=Path, help=f"Optional SAM2 config path. Defaults to ${SAM2_CONFIG_ENV}.")
    vision.add_argument("--sam2-checkpoint", type=Path, help=f"Optional SAM2 checkpoint path. Defaults to ${SAM2_CHECKPOINT_ENV}.")
    vision.add_argument(
      "--created-at",
      default=DEFAULT_CREATED_AT,
      help="ISO timestamp to write into review records. Defaults to a stable fixture timestamp for deterministic output.",
    )

    evaluate_fixtures = subcommands.add_parser("evaluate-vision-fixtures", help="Evaluate local operator-approved Google Earth vision fixtures.")
    evaluate_fixtures.add_argument("--manifest", required=True, type=Path, help="Fixture manifest JSON with local proof packet paths.")
    evaluate_fixtures.add_argument("--output-dir", required=True, type=Path, help="Directory for evaluation summary, cases, and annotated PNGs.")

    improve_boundary = subcommands.add_parser("improve-boundary-detector", help="Run a strict multi-iteration local boundary-detector improvement loop.")
    improve_boundary.add_argument("--map-canvas", required=True, type=Path, help="Google Earth map-canvas screenshot to evaluate.")
    improve_boundary.add_argument("--full-window", type=Path, help="Optional full-window screenshot for attribution linkage.")
    improve_boundary.add_argument("--kml", type=Path, help="Optional proof KML used to align operator KML labels.")
    improve_boundary.add_argument("--project-reference", type=Path, help="Optional CPLayout project JSON/ZIP used for projected XY and operator-label calibration.")
    improve_boundary.add_argument("--operator-boundary-kml", help='Optional operator-drawn boundary KML/KMZ. Use "-" to read KML from stdin.')
    improve_boundary.add_argument("--operator-boundary-kml-text", help="Optional raw operator boundary KML text.")
    improve_boundary.add_argument("--operator-boundary-name", default="USER DRAWN FIELD BOUNDARY")
    improve_boundary.add_argument("--output-dir", required=True, type=Path)
    improve_boundary.add_argument("--min-iterations", type=int, default=5, help="Minimum detector iterations. Values below 5 are raised to 5.")
    improve_boundary.add_argument("--created-at", default=DEFAULT_CREATED_AT)

    pivot_loop = subcommands.add_parser("run-pivot-locator-loop", help="Run a strict 100-iteration local pivot-center locator loop.")
    pivot_loop.add_argument("--map-canvas", type=Path, help="Optional local map-canvas screenshot to evaluate.")
    pivot_loop.add_argument("--output-dir", required=True, type=Path, help="Directory for pivot-locator loop artifacts.")
    pivot_loop.add_argument("--iterations", type=int, default=100, help="Detector iterations to run. Values below 1 are rejected.")
    pivot_loop.add_argument("--synthetic-fixture", action="store_true", help="Generate a deterministic local synthetic pivot fixture with known image-space truth.")
    pivot_loop.add_argument("--truth-center-x", type=float, help="Optional image-space truth center X for --map-canvas.")
    pivot_loop.add_argument("--truth-center-y", type=float, help="Optional image-space truth center Y for --map-canvas.")
    pivot_loop.add_argument("--truth-radius", type=float, help="Optional image-space truth radius for --map-canvas.")
    pivot_loop.add_argument("--created-at", default=DEFAULT_CREATED_AT)

    pivot_candidates = subcommands.add_parser("detect-pivot-candidates", help="Write advisory local OpenCV pivot-center candidate evidence as standalone companion reports.")
    pivot_candidates.add_argument("--map-canvas", type=Path, help="Optional local map-canvas screenshot to evaluate.")
    pivot_candidates.add_argument("--synthetic-fixture", action="store_true", help="Generate a deterministic local synthetic pivot fixture with known image-space truth.")
    pivot_candidates.add_argument("--output-dir", required=True, type=Path, help="Directory for pivot candidate review artifacts.")
    pivot_candidates.add_argument("--project-id", required=True, help="CPLayout project id for review evidence linkage.")
    pivot_candidates.add_argument("--project-crs", required=True, help="Projected CPLayout CRS; geographic CRS aliases are rejected.")
    pivot_candidates.add_argument("--iterations", type=int, default=100, help="Detector iterations to run. Values below 1 are rejected.")
    pivot_candidates.add_argument("--truth-center-x", type=float, help="Optional image-space truth center X for --map-canvas.")
    pivot_candidates.add_argument("--truth-center-y", type=float, help="Optional image-space truth center Y for --map-canvas.")
    pivot_candidates.add_argument("--truth-radius", type=float, help="Optional image-space truth radius for --map-canvas.")
    pivot_candidates.add_argument("--created-at", default=DEFAULT_CREATED_AT)

    prepare_dataset = subcommands.add_parser("prepare-vision-dataset", help="Validate a local fixture manifest and write deterministic dataset metadata.")
    prepare_dataset.add_argument("--manifest", required=True, type=Path, help="Fixture manifest JSON with local artifact paths.")
    prepare_dataset.add_argument("--output-dir", required=True, type=Path, help="Directory for vision-dataset-metadata.json.")
    prepare_dataset.add_argument("--split-seed", default="cplayout-local-vision-v1", help="Stable seed for project-level train/validation/test splits.")
    prepare_dataset.add_argument("--created-at", default=DEFAULT_CREATED_AT)

    run_experiment = subcommands.add_parser("run-boundary-experiment", help="Run the local OpenCV boundary fixture loop and log local MLflow evidence.")
    run_experiment.add_argument("--manifest", required=True, type=Path, help="Fixture manifest JSON with local proof packet paths.")
    run_experiment.add_argument("--output-dir", required=True, type=Path, help="Directory for experiment outputs and local mlruns.")
    run_experiment.add_argument("--experiment-name", default="cplayout-boundary-loop", help="Local MLflow experiment name.")
    run_experiment.add_argument("--split-seed", default="cplayout-local-vision-v1")
    run_experiment.add_argument("--created-at", default=DEFAULT_CREATED_AT)

    summarize_experiments = subcommands.add_parser("summarize-boundary-experiments", help="Compare local boundary experiment reports.")
    summarize_experiments.add_argument("--input", required=True, type=Path, nargs="+", help="Experiment report JSON files or experiment output directories.")
    summarize_experiments.add_argument("--output-dir", required=True, type=Path, help="Directory for JSON and Markdown comparison output.")

    raster_fixtures = subcommands.add_parser("prepare-raster-fixtures", help="Hash and validate local raster/proof artifacts for companion-only GIS review.")
    raster_fixtures.add_argument("--manifest", required=True, type=Path, help="JSON manifest with rasters[], fixtures[], or artifacts[] entries.")
    raster_fixtures.add_argument("--output-dir", required=True, type=Path, help="Directory for raster-fixture-metadata.json.")
    raster_fixtures.add_argument("--project-id", help="Project id to record when the manifest omits projectId.")
    raster_fixtures.add_argument("--project-crs", help="Projected/local project CRS to record when the manifest omits projectCrs.")
    raster_fixtures.add_argument("--require-projected-output", action="store_true", help="Reject fixtures without a projected raster CRS.")
    raster_fixtures.add_argument("--created-at", default=DEFAULT_CREATED_AT)

    vector_labels = subcommands.add_parser("validate-vector-labels", help="Validate local operator vector labels and export projected-XY evidence when CRS allows.")
    vector_labels.add_argument("--input", required=True, type=Path, help="Local GeoJSON/vector label file.")
    vector_labels.add_argument("--output-dir", required=True, type=Path)
    vector_labels.add_argument("--project-id", required=True)
    vector_labels.add_argument("--project-crs", required=True)
    vector_labels.add_argument("--created-at", default=DEFAULT_CREATED_AT)

    evidence_packet = subcommands.add_parser("build-evidence-packet", help="Combine local raster/vector/CV/scoring outputs into standalone companion evidence packets.")
    evidence_packet.add_argument("--project-id", required=True)
    evidence_packet.add_argument("--project-crs", required=True)
    evidence_packet.add_argument("--output-dir", required=True, type=Path)
    evidence_packet.add_argument("--raster-fixtures", type=Path, help="Optional raster-fixture-metadata.json.")
    evidence_packet.add_argument("--vector-labels", type=Path, help="Optional vector-label-validation.json.")
    evidence_packet.add_argument("--cv-candidates", type=Path, help="Optional local CV candidate JSON.")
    evidence_packet.add_argument("--score-report", type=Path, help="Optional local scoring/evaluation report JSON.")
    evidence_packet.add_argument("--real-pivot-fixtures", type=Path, help="Optional operator-approved real pivot-center fixture manifest.")
    evidence_packet.add_argument("--source-artifact", type=Path, action="append", default=[], help="Additional local artifact to hash into the packet.")
    evidence_packet.add_argument("--created-at", default=DEFAULT_CREATED_AT)

    dashboard = subcommands.add_parser("serve-review-dashboard", help="Launch a read-only local Streamlit review dashboard over an evidence packet.")
    dashboard.add_argument("--packet", required=True, type=Path, help="companion-evidence-packet.json to review.")
    dashboard.add_argument("--engine", choices=["streamlit", "dash"], default="streamlit", help="Dashboard engine. Streamlit remains the primary default.")
    dashboard.add_argument("--host", default="127.0.0.1", help="Localhost bind address. Non-local binds are rejected.")
    dashboard.add_argument("--port", type=int, default=8501)
    dashboard.add_argument("--export-html", type=Path, help="Write a local Plotly comparison report instead of launching a server.")
    dashboard.add_argument("--dry-run", action="store_true", help="Print the local launch plan without starting Streamlit.")

    companion_api = subcommands.add_parser("serve-companion-api", help="Launch an optional localhost FastAPI wrapper around companion file-bridge outputs.")
    companion_api.add_argument("--workspace", type=Path, default=Path("."), help="Local workspace root for read-only packet access.")
    companion_api.add_argument("--host", default="127.0.0.1", help="Localhost bind address. Non-local binds are rejected.")
    companion_api.add_argument("--port", type=int, default=8765)
    companion_api.add_argument("--experiment-db", type=Path, help="Optional companion-owned experiment .sqlite path; never the CPLayout project DB.")
    companion_api.add_argument("--dry-run", action="store_true", help="Print the local launch plan without starting FastAPI.")

    managed_job = subcommands.add_parser("run-managed-cv-job", help="Run an explicit CVJob-v1/v2 through CPLAYOUT_CV_PYTHON.")
    managed_job.add_argument("--job", required=True, type=Path, help="Absolute or relative CVJob-v1/v2 JSON path with hashed local assets, prompts, and output root.")

    args = parser.parse_args(argv)
    if args.command == "run-managed-cv-job":
        return handlers.run_managed_job_cli(args.job)
    if args.command == "probe-gpu":
        return handlers.probe_gpu()
    if args.command == "probe-companion-deps":
        return handlers.probe_companion_deps(args.groups, args.require_installed)
    if args.command == "probe-boundary-detector":
        return handlers.probe_boundary_detector(args.sam2_config, args.sam2_checkpoint)
    if args.command == "report-layout-candidates":
        return handlers.report_layout_candidates(args.input, args.output_dir, args.max_alternatives, args.created_at)
    if args.command == "design-vision-review":
        return handlers.design_vision_review(
            args.kml,
            args.kmz,
            args.full_window,
            args.map_canvas,
            args.manifest,
            args.output_dir,
            args.project_id,
            args.project_crs,
            args.project_reference,
            args.infer_field_boundary,
            args.operator_boundary_kml,
            args.operator_boundary_kml_text,
            args.operator_labels_kml,
            args.operator_labels_kml_text,
            args.operator_boundary_name,
            args.sam2_config,
            args.sam2_checkpoint,
            args.created_at,
        )
    if args.command == "evaluate-vision-fixtures":
        return handlers.evaluate_vision_fixtures(args.manifest, args.output_dir)
    if args.command == "improve-boundary-detector":
        return handlers.improve_boundary_detector(
            args.map_canvas,
            args.full_window,
            args.kml,
            args.project_reference,
            args.operator_boundary_kml,
            args.operator_boundary_kml_text,
            args.operator_boundary_name,
            args.output_dir,
            args.min_iterations,
            args.created_at,
        )
    if args.command == "run-pivot-locator-loop":
        return handlers.run_pivot_locator_loop(
            args.map_canvas,
            args.output_dir,
            args.iterations,
            args.synthetic_fixture,
            args.truth_center_x,
            args.truth_center_y,
            args.truth_radius,
            args.created_at,
        )
    if args.command == "detect-pivot-candidates":
        return handlers.detect_pivot_candidates(
            args.map_canvas,
            args.synthetic_fixture,
            args.output_dir,
            args.project_id,
            args.project_crs,
            args.iterations,
            args.truth_center_x,
            args.truth_center_y,
            args.truth_radius,
            args.created_at,
        )
    if args.command == "prepare-vision-dataset":
        return handlers.prepare_vision_dataset(args.manifest, args.output_dir, args.split_seed, args.created_at)
    if args.command == "run-boundary-experiment":
        return handlers.run_boundary_experiment(
            args.manifest,
            args.output_dir,
            args.experiment_name,
            args.split_seed,
            args.created_at,
            handlers.evaluate_vision_fixtures,
            handlers.improve_boundary_detector,
        )
    if args.command == "summarize-boundary-experiments":
        return handlers.summarize_boundary_experiments(args.input, args.output_dir)
    if args.command == "prepare-raster-fixtures":
        return handlers.prepare_raster_fixtures(
            args.manifest,
            args.output_dir,
            args.project_id,
            args.project_crs,
            args.require_projected_output,
            args.created_at,
        )
    if args.command == "validate-vector-labels":
        return handlers.validate_vector_labels(
            args.input,
            args.output_dir,
            args.project_id,
            args.project_crs,
            args.created_at,
        )
    if args.command == "build-evidence-packet":
        return handlers.build_evidence_packet(
            args.project_id,
            args.project_crs,
            args.output_dir,
            args.raster_fixtures,
            args.vector_labels,
            args.cv_candidates,
            args.score_report,
            args.source_artifact,
            args.created_at,
            args.real_pivot_fixtures,
        )
    if args.command == "serve-review-dashboard":
        return handlers.serve_review_dashboard(args.packet, args.host, args.port, args.dry_run, args.engine, args.export_html)
    if args.command == "serve-companion-api":
        return handlers.serve_companion_api(args.workspace, args.host, args.port, args.experiment_db, args.dry_run)
    parser.error("Unsupported command.")
    return 2
