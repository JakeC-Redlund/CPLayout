from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from .api import serve_companion_api
from .dashboard import serve_review_dashboard
from .evidence_packet import build_evidence_packet
from .ml_loop import prepare_vision_dataset, run_boundary_experiment, summarize_boundary_experiments
from .optional_imports import companion_dependency_probe
from .raster_fixtures import prepare_raster_fixtures
from .runtime_status import (
    SAM2_CONFIG_ENV, SAM2_CHECKPOINT_ENV, configured_path, probe_opencv, probe_sam2,
    sam2_import_status, probe_cuda, torch_gpu_image_preflight, boundary_detector_runtime_status,
)
from .vector_labels import validate_vector_labels
from .toolkit_bridge import run_managed_job_cli
from .vision_policy import (
    DEFAULT_VISION_THRESHOLDS, best_operator_metric, boundary_improvement_acceptance,
    design_hard_failures, cv_boundary_accepted, assess_design_vision_review,
)

MODEL_NAME = "baseline-local-layout-ranker"
MODEL_VERSION = "0.1.0"
VISION_MODEL_NAME = "design-only-google-earth-vision-review"
VISION_MODEL_VERSION = "0.1.0"
PIVOT_CANDIDATE_MODEL_NAME = "local-opencv-pivot-candidate-detector"
PIVOT_CANDIDATE_MODEL_VERSION = "0.1.0"
LAYOUT_CANDIDATE_REPORT_SCHEMA_VERSION = "cplayout-layout-candidate-report-v1"
COMPANION_CANDIDATE_GEOJSON_SCHEMA_VERSION = "cplayout-companion-candidate-reports-geojson-v1"
VISION_SCHEMA_VERSION = "cplayout-design-vision-review-v1"
PIVOT_CANDIDATE_SCHEMA_VERSION = "cplayout-pivot-candidates-v1"
DEFAULT_CREATED_AT = "1970-01-01T00:00:00.000Z"
TRUTH_LABEL_NAMES = {
    "truePivotCenter": "TRUE_PIVOT_CENTER",
    "targetFieldBoundary": "TARGET_FIELD_BOUNDARY",
    "southRoadExclusion": "SOUTH_ROAD_EXCLUSION",
    "seBuildingTreeExclusion": "SE_BUILDING_TREE_EXCLUSION",
}


def main(argv: list[str] | None = None) -> int:
    from .command_line import main as run_command_line
    return run_command_line(argv)


def probe_companion_deps(groups: list[str], require_installed: bool) -> int:
    result = companion_dependency_probe(groups, require_installed)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 1 if require_installed and not result["available"] else 0


def evaluate_vision_fixtures(manifest_path: Path, output_dir: Path) -> int:
    manifest = load_json_with_bom(manifest_path)
    entries = manifest.get("fixtures", manifest.get("cases", []))
    if not isinstance(entries, list):
        raise SystemExit("Vision fixture manifest must contain a fixtures or cases array.")
    cv = import_cv2()
    output_dir.mkdir(parents=True, exist_ok=True)
    case_path = output_dir / "vision-evaluation-cases.jsonl"
    summary_path = output_dir / "vision-evaluation-summary.json"
    cases = [
        evaluate_vision_fixture_case(cv, manifest_path.parent, entry, output_dir)
        for entry in entries
    ]
    case_path.write_text("".join(json.dumps(case, sort_keys=True) + "\n" for case in cases), encoding="utf-8")
    summary = summarize_vision_fixture_cases(manifest, cases, case_path)
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "summary": str(summary_path),
        "cases": str(case_path),
        "caseCount": len(cases),
        "precision": summary["metrics"]["boundaryCandidatePrecision"],
        "recall": summary["metrics"]["boundaryCandidateRecall"],
        "canonicalGeometryMutation": False,
        "networkRequired": False,
    }, indent=2))
    return 0


def improve_boundary_detector(
    map_canvas_path: Path,
    full_window_path: Path | None,
    kml_path: Path | None,
    project_reference_path: Path | None,
    operator_boundary_path: str | None,
    operator_boundary_text: str | None,
    operator_boundary_name: str,
    output_dir: Path,
    min_iterations: int,
    created_at: str,
) -> int:
    cv = import_cv2()
    image = cv.imread(str(map_canvas_path))
    if image is None:
        raise SystemExit(f"OpenCV could not read map-canvas screenshot: {map_canvas_path}")
    full_window_image = cv.imread(str(full_window_path)) if full_window_path else None
    if full_window_path is not None and full_window_image is None:
        raise SystemExit(f"OpenCV could not read full-window screenshot: {full_window_path}")

    kml_text = kml_path.read_text(encoding="utf-8") if kml_path is not None else ""
    project_reference = load_project(project_reference_path) if project_reference_path is not None else None
    if project_reference is not None:
        validate_project(project_reference)

    pivot_crop_ring = detect_pivot_crop_ring(cv, image)
    overlay_circle = detect_overlay_circle(cv, image, pivot_crop_ring)
    operator_field_boundary = None
    if operator_boundary_path is not None or operator_boundary_text is not None:
        if not kml_text:
            raise SystemExit("--kml is required when calibrating --operator-boundary-kml.")
        operator_field_boundary = load_operator_field_boundary(
            operator_boundary_path,
            operator_boundary_text,
            operator_boundary_name,
            kml_text,
            project_reference,
            overlay_circle,
        )
    truth_labels = truth_labels_from_operator_boundary(operator_field_boundary)

    operator_polygon = operator_field_boundary.get("imagePolygon") if operator_field_boundary is not None else None
    gpu_status = probe_cuda()
    gpu_preflight = None
    gpu_preflight_error = None
    if gpu_status.get("cudaAvailable"):
        try:
            gpu_preflight = torch_gpu_image_preflight(image)
        except Exception as error:
            gpu_preflight_error = type(error).__name__
    iteration_count = max(5, min_iterations)
    iterations = run_boundary_improvement_iterations(cv, image, pivot_crop_ring, operator_polygon, iteration_count)
    best_iteration = best_boundary_iteration(iterations)
    best_accepted_candidate = best_boundary_candidate(iterations, rejected=False)
    best_rejected_candidate = best_boundary_candidate(iterations, rejected=True)
    cv_candidate_boundary = best_accepted_candidate
    projected_best_boundary = project_image_boundary_to_xy(cv_candidate_boundary, overlay_circle, project_reference) if project_reference is not None else None
    if cv_candidate_boundary is not None and projected_best_boundary is not None:
        cv_candidate_boundary["projectedPolygon"] = projected_best_boundary
    failure_mode = boundary_improvement_failure_mode(cv_candidate_boundary, best_rejected_candidate, iterations)
    attribution = detect_attribution_cue(cv, full_window_image) if full_window_image is not None else {"present": None}

    output_dir.mkdir(parents=True, exist_ok=True)
    annotated_path = output_dir / "boundary-improvement-annotated.png"
    write_annotated_image(
        cv,
        image,
        annotated_path,
        pivot_crop_ring,
        overlay_circle,
        cv_candidate_boundary if cv_candidate_boundary is not None else best_rejected_candidate,
        operator_field_boundary,
        best_iteration.get("operatorComparison", []) if best_iteration else [],
    )
    report = {
        "schemaVersion": "cplayout-boundary-improvement-loop-v2",
        "createdAt": created_at,
        "projectId": project_reference.get("id") if project_reference is not None else None,
        "projectCrs": project_reference.get("projectCrs") if project_reference is not None else None,
        "source": "local_google_earth_companion_screenshot",
        "designOnly": True,
        "surveyGrade": False,
        "canonicalGeometryMutation": False,
        "networkRequired": False,
        "minimumIterationsRequired": 5,
        "iterationCount": len(iterations),
        "gpu": gpu_status | {
            "requestedByUser": False,
            "usedForTorchTensorPreflight": gpu_preflight is not None,
            "tensorPreflight": gpu_preflight,
            "tensorPreflightError": gpu_preflight_error,
            "note": "This OpenCV detector and scoring path ran on CPU. A CUDA tensor preflight is diagnostic only and does not accelerate this detector.",
        },
        "stageObservations": [
            {"stage": "opencv_boundary_detection_and_scoring", "observedDevice": "cpu", "accelerated": False},
            {"stage": "torch_tensor_preflight", "observedDevice": "cuda" if gpu_preflight is not None else "failed" if gpu_preflight_error else "not_run", "accelerated": gpu_preflight is not None, "diagnosticOnly": True},
        ],
        "artifacts": {
            "mapCanvas": artifact_inventory(map_canvas_path, require_doc_kml=False),
            "fullWindow": artifact_inventory(full_window_path, require_doc_kml=False) if full_window_path else None,
            "kml": artifact_inventory(kml_path, require_doc_kml=False) if kml_path else None,
            "projectReference": artifact_inventory(project_reference_path, require_doc_kml=False) if project_reference_path else None,
            "annotated": artifact_inventory(annotated_path, require_doc_kml=False),
        },
        "detections": {
            "pivotCropRing": pivot_crop_ring,
            "overlayCircle": overlay_circle,
            "truthBoundary": operator_field_boundary,
            "cvCandidateBoundary": cv_candidate_boundary,
            "bestAcceptedCandidate": best_accepted_candidate,
            "bestRejectedCandidate": best_rejected_candidate,
            "operatorFieldBoundary": operator_field_boundary,
            "truthLabels": truth_labels,
            "attribution": attribution,
        },
        "iterations": iterations,
        "bestIteration": best_iteration,
        "operatorGuidedLearning": operator_guided_learning_summary(operator_polygon, iterations, best_rejected_candidate),
        "failureMode": failure_mode,
        "acceptance": boundary_improvement_acceptance(cv_candidate_boundary, best_iteration, operator_polygon, gpu_status, projected_best_boundary, failure_mode),
        "researchBasis": [
            "OpenCV edge, contour, morphology, Hough-line, and color-threshold cues are combined because field boundaries are often roads, fences, tree lines, straight property separations, structures, or crop/soil color transitions.",
            "Operator labels are scoring feedback only; they do not become model predictions or mutate projected XY geometry.",
            "Weak non-black imagery or overlay visibility is not considered boundary-detection success.",
        ],
    }
    report_path = output_dir / "boundary-improvement-loop.json"
    cases_path = output_dir / "boundary-improvement-iterations.jsonl"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    cases_path.write_text("".join(json.dumps(iteration, sort_keys=True) + "\n" for iteration in iterations), encoding="utf-8")
    print(json.dumps({
        "json": str(report_path),
        "iterations": str(cases_path),
        "annotatedPng": str(annotated_path),
        "iterationCount": len(iterations),
        "bestConfidence": cv_candidate_boundary.get("confidence") if cv_candidate_boundary else None,
        "bestRejectedConfidence": best_rejected_candidate.get("confidence") if best_rejected_candidate else None,
        "bestOperatorIoU": best_iteration.get("bestOperatorIoU") if best_iteration else None,
        "accepted": report["acceptance"]["accepted"],
        "gpuCudaAvailable": gpu_status.get("cudaAvailable"),
        "canonicalGeometryMutation": False,
    }, indent=2))
    return 0


def evaluate_vision_fixture_case(cv: Any, manifest_dir: Path, entry: Any, output_dir: Path) -> dict[str, Any]:
    if not isinstance(entry, dict):
        raise SystemExit("Each vision fixture manifest entry must be an object.")
    case_id = str(entry.get("id") or entry.get("name") or f"fixture-{sha256_text(json.dumps(entry, sort_keys=True))[:8]}")
    map_canvas = resolve_manifest_path(manifest_dir, entry.get("mapCanvasCrop") or entry.get("map_canvas") or entry.get("mapCanvas"))
    full_window = resolve_manifest_path(manifest_dir, entry.get("fullWindowScreenshot") or entry.get("full_window"))
    kml_path = resolve_manifest_path(manifest_dir, entry.get("kml"), required=False)
    kmz_path = resolve_manifest_path(manifest_dir, entry.get("kmz"), required=False)
    visual_manifest = resolve_manifest_path(manifest_dir, entry.get("visualFidelityManifest") or entry.get("visual_manifest"), required=False)
    project_reference_path = resolve_manifest_path(manifest_dir, entry.get("projectReference") or entry.get("project_reference"), required=False)
    image = cv.imread(str(map_canvas))
    if image is None:
        raise SystemExit(f"OpenCV could not read map-canvas fixture: {map_canvas}")
    full_window_image = cv.imread(str(full_window)) if full_window is not None else None
    if full_window is not None and full_window_image is None:
        raise SystemExit(f"OpenCV could not read full-window fixture: {full_window}")
    project_reference = load_project(project_reference_path) if project_reference_path else None
    pivot_crop_ring = detect_pivot_crop_ring(cv, image)
    overlay_circle = detect_overlay_circle(cv, image, pivot_crop_ring)
    overlay_visible = overlay_circle is not None or detect_overlay_linework(cv, image)
    boundary = detect_imagery_field_boundary(cv, image, pivot_crop_ring, None) if entry.get("evaluateBoundary", True) else None
    projected_boundary = project_image_boundary_to_xy(boundary, overlay_circle, project_reference) if project_reference is not None else None
    attribution = detect_attribution_cue(cv, full_window_image) if full_window_image is not None else {"present": None}
    semantic = semantic_advisory_detections(cv, image, pivot_crop_ring, overlay_circle, boundary)
    expected = entry.get("expected", {})
    if not isinstance(expected, dict):
        expected = {}
    expected_boundary = expected.get("boundaryPresent", entry.get("boundaryPresent"))
    expected_overlay = expected.get("overlayPresent", entry.get("overlayPresent"))
    expected_black = expected.get("blackCanvas", entry.get("blackCanvas", False))
    black_canvas = is_black_or_uniform_canvas(cv, image)
    boundary_detected = bool(boundary is not None and not boundary.get("rejected"))
    overlay_detected = bool(overlay_visible)
    annotated_path = output_dir / f"{safe_filename(case_id)}-annotated.png"
    write_annotated_image(cv, image, annotated_path, pivot_crop_ring, overlay_circle, boundary, None, [])
    return {
        "id": case_id,
        "artifacts": {
            "fullWindowScreenshot": str(full_window) if full_window is not None else None,
            "mapCanvasCrop": str(map_canvas),
            "kml": str(kml_path) if kml_path is not None else None,
            "kmz": str(kmz_path) if kmz_path is not None else None,
            "visualFidelityManifest": str(visual_manifest) if visual_manifest is not None else None,
            "projectReference": str(project_reference_path) if project_reference_path is not None else None,
            "annotatedPng": str(annotated_path),
        },
        "detections": {
            "pivotCropRing": pivot_crop_ring,
            "overlayCircle": overlay_circle,
            "overlayVisible": overlay_visible,
            "imageryFieldBoundary": boundary,
            "projectedFieldBoundary": projected_boundary,
            "attribution": attribution,
            "semanticAdvisory": semantic,
            "blackOrUniformCanvas": black_canvas,
        },
        "expected": {
            "boundaryPresent": expected_boundary,
            "overlayPresent": expected_overlay,
            "blackCanvas": expected_black,
        },
        "outcomes": {
            "boundaryTruePositive": expected_boundary is True and boundary_detected,
            "boundaryFalsePositive": expected_boundary is False and boundary_detected,
            "boundaryFalseNegative": expected_boundary is True and not boundary_detected,
            "overlayTruePositive": expected_overlay is True and overlay_detected,
            "overlayFalsePositive": expected_overlay is False and overlay_detected,
            "overlayFalseNegative": expected_overlay is True and not overlay_detected,
            "blackCanvasNegativePassed": expected_black is True and not boundary_detected and not overlay_detected and black_canvas,
        },
        "canonicalGeometryMutation": False,
    }


def summarize_vision_fixture_cases(manifest: dict[str, Any], cases: list[dict[str, Any]], case_path: Path) -> dict[str, Any]:
    true_positive = sum(1 for case in cases if case["outcomes"]["boundaryTruePositive"])
    false_positive = sum(1 for case in cases if case["outcomes"]["boundaryFalsePositive"])
    false_negative = sum(1 for case in cases if case["outcomes"]["boundaryFalseNegative"])
    overlay_true_positive = sum(1 for case in cases if case["outcomes"]["overlayTruePositive"])
    overlay_false_positive = sum(1 for case in cases if case["outcomes"]["overlayFalsePositive"])
    overlay_false_negative = sum(1 for case in cases if case["outcomes"]["overlayFalseNegative"])
    return {
        "schemaVersion": "cplayout-vision-evaluation-v1",
        "sourceManifestSchemaVersion": manifest.get("schemaVersion"),
        "caseCount": len(cases),
        "caseJsonl": str(case_path),
        "metrics": {
            "boundaryCandidatePrecision": safe_ratio(true_positive, true_positive + false_positive),
            "boundaryCandidateRecall": safe_ratio(true_positive, true_positive + false_negative),
            "boundaryCandidateIoUStyle": safe_ratio(true_positive, true_positive + false_positive + false_negative),
            "overlayDetectionPrecision": safe_ratio(overlay_true_positive, overlay_true_positive + overlay_false_positive),
            "overlayDetectionRecall": safe_ratio(overlay_true_positive, overlay_true_positive + overlay_false_negative),
            "blackCanvasNegativePasses": sum(1 for case in cases if case["outcomes"]["blackCanvasNegativePassed"]),
        },
        "falsePositiveCategories": false_positive_categories(cases),
        "advisoryOnly": True,
        "canonicalGeometryMutation": False,
        "networkRequired": False,
    }


def semantic_advisory_detections(
    cv: Any,
    image: Any,
    pivot_crop_ring: dict[str, Any] | None,
    overlay_circle: dict[str, Any] | None,
    boundary: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    detections = []
    if pivot_crop_ring is not None:
        detections.append({"kind": "pivot_center_ring", "confidence": pivot_crop_ring["confidence"], "source": "opencv_hough_circle"})
    if overlay_circle is not None:
        detections.append({"kind": "pivot_coverage_overlay", "confidence": overlay_circle["confidence"], "source": "opencv_overlay_circle"})
    if boundary is not None and not boundary.get("rejected"):
        detections.append({"kind": "advisory_field_boundary", "confidence": boundary["confidence"], "source": "opencv_boundary_candidate"})
    line_cues = detect_line_cues(cv, image)
    detections.extend(line_cues)
    return detections


def run_boundary_improvement_iterations(
    cv: Any,
    image: Any,
    pivot_crop_ring: dict[str, Any] | None,
    operator_image_polygon: list[dict[str, Any]] | None,
    iteration_count: int,
) -> list[dict[str, Any]]:
    configs = boundary_iteration_configs(iteration_count)
    iterations = []
    for index, config in enumerate(configs, start=1):
        edges = boundary_edges_for_config(cv, image, config)
        candidates = boundary_candidates_for_edges(cv, image, edges, pivot_crop_ring, config)
        scored = [
            score_boundary_candidate(cv, edges, candidate, image.shape[1], image.shape[0], pivot_crop_ring, operator_image_polygon)
            for candidate in candidates
        ]
        if config.get("operatorAssistedRanking") and operator_image_polygon is not None:
            scored = [operator_assisted_candidate(candidate) for candidate in scored]
        scored = sorted(scored, key=lambda item: item["confidence"], reverse=True)
        accepted_candidates = [candidate for candidate in scored if not candidate["rejected"]]
        rejected_candidates = [candidate for candidate in scored if candidate["rejected"]]
        comparisons = []
        if operator_image_polygon is not None:
            comparisons = [
                {
                    "candidateIndex": candidate_index,
                    **operator_comparison_metrics(cv, image, operator_image_polygon, candidate["imagePolygon"]),
                }
                for candidate_index, candidate in enumerate(scored)
                if candidate.get("imagePolygon")
            ]
            comparisons = sorted(comparisons, key=lambda item: (item["iou"], -item["boundaryMeanDistancePixels"]), reverse=True)
        best = accepted_candidates[0] if accepted_candidates else (rejected_candidates[0] if rejected_candidates else None)
        best_rejected = rejected_candidates[0] if rejected_candidates else None
        iterations.append({
            "iteration": index,
            "config": config,
            "candidateCount": len(scored),
            "bestCandidate": best,
            "bestAcceptedCandidate": accepted_candidates[0] if accepted_candidates else None,
            "bestRejectedCandidate": best_rejected,
            "topCandidates": [candidate_audit_summary(candidate) for candidate in scored[:8]],
            "operatorComparison": comparisons[:8],
            "bestOperatorIoU": comparisons[0]["iou"] if comparisons else None,
            "learningAction": learning_action_for_iteration(index, best, comparisons),
        })
    return iterations


def run_pivot_locator_loop(
    map_canvas_path: Path | None,
    output_dir: Path,
    iteration_count: int,
    synthetic_fixture: bool,
    truth_center_x: float | None,
    truth_center_y: float | None,
    truth_radius: float | None,
    created_at: str,
) -> int:
    if iteration_count < 1:
        raise SystemExit("--iterations must be a positive integer.")
    if not synthetic_fixture and map_canvas_path is None:
        raise SystemExit("run-pivot-locator-loop requires --map-canvas or --synthetic-fixture.")

    cv = import_cv2()
    output_dir.mkdir(parents=True, exist_ok=True)
    input_artifact = None
    fixture_kind = "local_map_canvas"
    if synthetic_fixture:
        image, truth = synthetic_pivot_fixture(cv)
        fixture_kind = "synthetic_generated"
        synthetic_path = output_dir / "pivot-locator-synthetic-fixture.png"
        if not cv.imwrite(str(synthetic_path), image):
            raise SystemExit(f"OpenCV could not write synthetic pivot fixture: {synthetic_path}")
        input_artifact = artifact_inventory(synthetic_path, require_doc_kml=False)
    else:
        image = cv.imread(str(map_canvas_path))
        if image is None:
            raise SystemExit(f"OpenCV could not read map-canvas screenshot: {map_canvas_path}")
        input_artifact = artifact_inventory(map_canvas_path, require_doc_kml=False)
        truth = None
        if truth_center_x is not None or truth_center_y is not None or truth_radius is not None:
            if truth_center_x is None or truth_center_y is None or truth_radius is None:
                raise SystemExit("--truth-center-x, --truth-center-y, and --truth-radius must be supplied together.")
            truth = {
                "center": {"x": float(truth_center_x), "y": float(truth_center_y)},
                "radius": float(truth_radius),
                "source": "operator_supplied_image_space_cli_args",
            }

    iterations = run_pivot_locator_iterations(cv, image, truth, iteration_count)
    best = best_pivot_locator_iteration(iterations)
    annotated_path = output_dir / "pivot-locator-annotated.png"
    write_pivot_locator_annotated_image(cv, image, annotated_path, best, truth)
    iterations_path = output_dir / "pivot-locator-iterations.jsonl"
    report_path = output_dir / "pivot-locator-loop.json"
    iterations_path.write_text("".join(json.dumps(item, sort_keys=True) + "\n" for item in iterations), encoding="utf-8")

    synthetic_passes = sum(1 for item in iterations if item["decision"] == "pass_synthetic")
    detected_iterations = sum(1 for item in iterations if item["bestCandidate"] is not None)
    report = {
        "schemaVersion": "cplayout-pivot-locator-loop-v1",
        "createdAt": created_at,
        "iterationCount": len(iterations),
        "fixtureKind": fixture_kind,
        "advisoryOnly": True,
        "surveyGrade": False,
        "canonicalGeometryMutation": False,
        "networkRequired": False,
        "hiddenKeysAllowed": False,
        "inputArtifact": input_artifact,
        "artifacts": {
            "iterationsJsonl": artifact_inventory(iterations_path, require_doc_kml=False),
            "annotatedPng": artifact_inventory(annotated_path, require_doc_kml=False),
        },
        "truth": truth,
        "bestIteration": best,
        "metrics": {
            "detectedIterations": detected_iterations,
            "syntheticPasses": synthetic_passes,
            "syntheticPassRate": round(safe_ratio(synthetic_passes, len(iterations)), 4),
            "bestCenterErrorPx": None if best is None else best["metrics"].get("centerErrorPx"),
            "bestRadiusMismatchRatio": None if best is None else best["metrics"].get("radiusMismatchRatio"),
            "bestWeightedVoteScore": None if best is None else best["weightedVote"]["score"],
        },
        "realWorldAcceptance": {
            "accepted": False,
            "blockers": [
                "No operator-approved real-world pivot fixture manifest was supplied for this command.",
                "No project-CRS calibration was supplied, so the run cannot claim projected-XY automatic pivot locating.",
                "Output remains local companion evidence and must not mutate canonical project geometry.",
            ],
        },
        "nonGoals": [
            "Does not use paid APIs, hidden keys, cloud training, hosted imagery, or telemetry.",
            "Does not prove survey-grade center-pivot location.",
            "Does not prove React Native, Android, iOS, native ONNX, native MapLibre, or mobile runtime behavior.",
            "Does not apply detected candidates to PivotProject geometry.",
        ],
    }
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "schemaVersion": report["schemaVersion"],
        "json": str(report_path),
        "iterations": str(iterations_path),
        "annotatedPng": str(annotated_path),
        "iterationCount": len(iterations),
        "detectedIterations": detected_iterations,
        "syntheticPasses": synthetic_passes,
        "bestCenterErrorPx": report["metrics"]["bestCenterErrorPx"],
        "canonicalGeometryMutation": False,
        "networkRequired": False,
        "realWorldAccepted": False,
    }, indent=2))
    return 0


def detect_pivot_candidates(
    map_canvas_path: Path | None,
    synthetic_fixture: bool,
    output_dir: Path,
    project_id: str,
    project_crs: str,
    iteration_count: int,
    truth_center_x: float | None,
    truth_center_y: float | None,
    truth_radius: float | None,
    created_at: str,
) -> int:
    require_projected_crs(project_crs, "detect-pivot-candidates")
    if iteration_count < 1:
        raise SystemExit("--iterations must be a positive integer.")
    if not synthetic_fixture and map_canvas_path is None:
        raise SystemExit("detect-pivot-candidates requires --map-canvas or --synthetic-fixture.")

    cv = import_cv2()
    output_dir.mkdir(parents=True, exist_ok=True)
    image, truth, input_artifact, fixture_kind = pivot_locator_input(
        cv,
        output_dir,
        map_canvas_path,
        synthetic_fixture,
        truth_center_x,
        truth_center_y,
        truth_radius,
        "pivot-candidates-synthetic-fixture.png",
    )
    iterations = run_pivot_locator_iterations(cv, image, truth, iteration_count)
    best = best_pivot_locator_iteration(iterations)
    annotated_path = output_dir / "pivot-candidates-annotated.png"
    write_pivot_locator_annotated_image(cv, image, annotated_path, best, truth)
    iterations_path = output_dir / "pivot-candidates-iterations.jsonl"
    iterations_path.write_text("".join(json.dumps(item, sort_keys=True) + "\n" for item in iterations), encoding="utf-8")

    best_candidate = best.get("bestCandidate") if best is not None else None
    evidence_id = f"{project_id}:pivot-candidate-evidence"
    recommendation_id = f"{project_id}:pivot-candidate-report"
    confidence = round(float(best_candidate["confidence"]), 3) if best_candidate is not None else 0.0
    weighted_score = best.get("weightedVote", {}).get("score") if best is not None else None
    candidate_score = best_candidate.get("score") if best_candidate is not None else None
    artifacts = {
        "mapCanvas": input_artifact,
        "iterationsJsonl": artifact_inventory(iterations_path, require_doc_kml=False),
        "annotatedPng": artifact_inventory(annotated_path, require_doc_kml=False),
    }
    hard_failures = [
        "projected XY calibration absent",
        "operator-approved real-world pivot fixture absent",
    ]
    if best_candidate is None:
        hard_failures.append("no pivot-center candidate was detected")
    evidence_record = {
        "id": evidence_id,
        "projectId": project_id,
        "sourceKind": "model_output",
        "createdAt": created_at,
        "projectCrs": project_crs,
        "summary": "Local OpenCV pivot-center candidate detector evidence.",
        "confidence": confidence,
        "reviewStatus": "unreviewed",
        "notes": "Image-space candidate evidence only. Projected XY pivot-center output is blocked until an operator-approved fixture and project calibration exist.",
        "artifacts": artifacts,
        "metrics": {
            "fixtureKind": fixture_kind,
            "iterationCount": len(iterations),
            "detectedIterations": sum(1 for item in iterations if item["bestCandidate"] is not None),
            "bestIteration": best.get("iteration") if best is not None else None,
            "bestCandidate": best_candidate,
            "truth": truth,
            "centerErrorPx": best.get("metrics", {}).get("centerErrorPx") if best is not None else None,
            "radiusMismatchRatio": best.get("metrics", {}).get("radiusMismatchRatio") if best is not None else None,
            "weightedVote": best.get("weightedVote") if best is not None else None,
            "evidenceOnly": True,
            "appImportable": False,
            "canonicalGeometryMutation": False,
            "writesProjectDatabase": False,
            "networkRequired": False,
        },
    }
    recommendation = {
        "id": recommendation_id,
        "projectId": project_id,
        "modelName": PIVOT_CANDIDATE_MODEL_NAME,
        "modelVersion": PIVOT_CANDIDATE_MODEL_VERSION,
        "createdAt": created_at,
        "projectCrs": project_crs,
        "summary": "Review local image-space pivot-center candidate evidence; projected XY output is blocked until calibration.",
        "proposedGeometry": {
            "projectCrs": project_crs,
        },
        "confidence": confidence,
        "evidenceIds": [evidence_id],
        "reviewStatus": "unreviewed",
        "score": round(float(candidate_score), 3) if isinstance(candidate_score, (int, float)) else 0.0,
        "scoreBreakdown": {
            "candidateScore": round(float(candidate_score), 3) if isinstance(candidate_score, (int, float)) else 0.0,
            "weightedVoteScore": round(float(weighted_score), 4) if isinstance(weighted_score, (int, float)) else 0.0,
        },
        "metadata": {
            "schemaVersion": PIVOT_CANDIDATE_SCHEMA_VERSION,
            "imageSpaceCandidate": best_candidate,
            "bestIteration": best.get("iteration") if best is not None else None,
            "truth": truth,
            "fixtureKind": fixture_kind,
            "iterationCount": len(iterations),
            "detector": "opencv_hough_circle",
            "feasible": False,
            "hardFailures": hard_failures,
            "evidenceOnly": True,
            "appImportable": False,
            "canonicalGeometryMutation": False,
            "writesProjectDatabase": False,
            "networkRequired": False,
            "hiddenKeysAllowed": False,
        },
        "warnings": [
            "Image-space pivot candidate only; no projected-XY pivot center is emitted without calibration.",
            "Operator inspection is required before any CPLayout geometry workflow action.",
            "This local companion output is not survey grade and does not prove native/mobile ML runtime behavior.",
            *hard_failures,
        ],
    }
    report = {
        "schemaVersion": PIVOT_CANDIDATE_SCHEMA_VERSION,
        "createdAt": created_at,
        "projectId": project_id,
        "projectCrs": project_crs,
        "fixtureKind": fixture_kind,
        "advisoryOnly": True,
        "surveyGrade": False,
        "evidenceOnly": True,
        "appImportable": False,
        "canonicalGeometryMutation": False,
        "writesProjectDatabase": False,
        "networkRequired": False,
        "hiddenKeysAllowed": False,
        "artifacts": artifacts,
        "detections": {
            "bestCandidate": best_candidate,
            "bestIteration": best,
            "topCandidates": [] if best is None else best.get("topCandidates", []),
        },
        "evidenceRecords": [evidence_record],
        "candidateReports": [recommendation],
        "operatorDecisionNotes": [],
        "acceptance": {
            "accepted": False,
            "status": "blocked_missing_projected_xy_calibration",
            "hardFailures": hard_failures,
            "autoApplyEligible": False,
        },
        "nonGoals": [
            "Does not mutate PivotProject geometry, schemas, persistence, archives, or projected XY state.",
            "Does not emit proposedGeometry.pivotCenter without project-CRS calibration.",
            "Does not use paid APIs, hidden keys, cloud training, hosted imagery, or telemetry.",
        ],
    }
    json_path = output_dir / "pivot-candidates-report.json"
    geojson_path = output_dir / "pivot-candidates-candidates.geojson"
    json_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    geojson_path.write_text(json.dumps(recommendations_to_geojson([recommendation]), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "schemaVersion": PIVOT_CANDIDATE_SCHEMA_VERSION,
        "json": str(json_path),
        "geojson": str(geojson_path),
        "iterations": str(iterations_path),
        "annotatedPng": str(annotated_path),
        "iterationCount": len(iterations),
        "bestCandidateDetected": best_candidate is not None,
        "projectedPivotCenterEmitted": False,
        "canonicalGeometryMutation": False,
        "networkRequired": False,
    }, indent=2, sort_keys=True))
    return 0


def pivot_locator_input(
    cv: Any,
    output_dir: Path,
    map_canvas_path: Path | None,
    synthetic_fixture: bool,
    truth_center_x: float | None,
    truth_center_y: float | None,
    truth_radius: float | None,
    synthetic_filename: str,
) -> tuple[Any, dict[str, Any] | None, dict[str, Any], str]:
    if synthetic_fixture:
        image, truth = synthetic_pivot_fixture(cv)
        synthetic_path = output_dir / synthetic_filename
        if not cv.imwrite(str(synthetic_path), image):
            raise SystemExit(f"OpenCV could not write synthetic pivot fixture: {synthetic_path}")
        return image, truth, artifact_inventory(synthetic_path, require_doc_kml=False), "synthetic_generated"

    if map_canvas_path is None:
        raise SystemExit("A map-canvas path is required when --synthetic-fixture is not used.")
    image = cv.imread(str(map_canvas_path))
    if image is None:
        raise SystemExit(f"OpenCV could not read map-canvas screenshot: {map_canvas_path}")
    truth = None
    if truth_center_x is not None or truth_center_y is not None or truth_radius is not None:
        if truth_center_x is None or truth_center_y is None or truth_radius is None:
            raise SystemExit("--truth-center-x, --truth-center-y, and --truth-radius must be supplied together.")
        truth = {
            "center": {"x": float(truth_center_x), "y": float(truth_center_y)},
            "radius": float(truth_radius),
            "source": "operator_supplied_image_space_cli_args",
        }
    return image, truth, artifact_inventory(map_canvas_path, require_doc_kml=False), "local_map_canvas"


def require_projected_crs(project_crs: str, command_name: str) -> None:
    normalized = project_crs.strip().upper().replace(" ", "")
    if (
        normalized == "EPSG:4326"
        or normalized == "CRS:84"
        or normalized == "OGC:CRS84"
        or "WGS84" in normalized
        or "LONGITUDE" in normalized
        or "LATITUDE" in normalized
        or "GEOGRAPHIC" in normalized
    ):
        raise SystemExit(f"{command_name} requires CPLayout projected/local XY CRS, not {project_crs}.")


def synthetic_pivot_fixture(cv: Any) -> tuple[Any, dict[str, Any]]:
    import numpy as np  # type: ignore

    width = 640
    height = 640
    center = (328, 312)
    radius = 172
    image = np.full((height, width, 3), (74, 114, 72), dtype=np.uint8)
    cv.rectangle(image, (54, 68), (586, 574), (63, 96, 56), -1)
    cv.rectangle(image, (54, 68), (586, 574), (38, 52, 38), 3)
    for offset, color, thickness in [
        (0, (190, 220, 170), 4),
        (-42, (102, 150, 92), 2),
        (38, (96, 138, 84), 2),
    ]:
        cv.circle(image, center, radius + offset, color, thickness, cv.LINE_AA)
    for angle in range(0, 360, 45):
        radians = math.radians(angle)
        end = (int(center[0] + math.cos(radians) * radius), int(center[1] + math.sin(radians) * radius))
        cv.line(image, center, end, (88, 132, 82), 1, cv.LINE_AA)
    cv.circle(image, center, 7, (230, 240, 210), -1, cv.LINE_AA)
    cv.circle(image, (150, 128), 46, (120, 120, 120), 2, cv.LINE_AA)
    cv.line(image, (0, 568), (640, 616), (46, 46, 46), 5, cv.LINE_AA)
    return image, {
        "center": {"x": float(center[0]), "y": float(center[1])},
        "radius": float(radius),
        "source": "deterministic_synthetic_fixture",
    }


def run_pivot_locator_iterations(
    cv: Any,
    image: Any,
    truth: dict[str, Any] | None,
    iteration_count: int,
) -> list[dict[str, Any]]:
    iterations = []
    best_error = None
    for index, config in enumerate(pivot_locator_iteration_configs(iteration_count), start=1):
        candidates = detect_pivot_candidates_for_config(cv, image, config)
        scored = [score_pivot_candidate(candidate, truth, image.shape[1], image.shape[0]) for candidate in candidates]
        scored = sorted(scored, key=lambda item: item["score"], reverse=True)
        best_candidate = scored[0] if scored else None
        metrics = pivot_iteration_metrics(best_candidate, truth)
        previous_best_error = best_error
        if isinstance(metrics.get("centerErrorPx"), (int, float)):
            best_error = metrics["centerErrorPx"] if best_error is None else min(best_error, metrics["centerErrorPx"])
        decision = pivot_iteration_decision(metrics, truth)
        weighted_vote = pivot_weighted_vote(decision, metrics, truth)
        iterations.append({
            "iteration": index,
            "analysis": "Evaluate one deterministic local OpenCV Hough-circle parameter set against the pivot-center fixture.",
            "research": "OpenCV Hough Circle Transform baseline; no paid API, hosted imagery, cloud training, or hidden key.",
            "improvement": pivot_learning_action(index, previous_best_error, metrics),
            "test": "Compare detected center/radius to known image-space truth when available; keep projected XY blocked without calibration.",
            "config": config,
            "candidateCount": len(scored),
            "bestCandidate": best_candidate,
            "topCandidates": scored[:5],
            "metrics": metrics,
            "weightedVote": weighted_vote,
            "decision": decision,
            "canonicalGeometryMutation": False,
            "networkRequired": False,
            "hiddenKeysAllowed": False,
        })
    return iterations


def pivot_locator_iteration_configs(iteration_count: int) -> list[dict[str, Any]]:
    blur_kernels = [5, 7, 9]
    dp_values = [1.1, 1.2, 1.3, 1.4]
    param1_values = [55, 70, 85, 100]
    param2_values = [14, 18, 22, 26, 30]
    min_radius_scales = [0.12, 0.16, 0.2]
    max_radius_scales = [0.42, 0.5, 0.58, 0.66]
    configs = []
    for blur in blur_kernels:
        for dp in dp_values:
            for param1 in param1_values:
                for param2 in param2_values:
                    for min_scale in min_radius_scales:
                        for max_scale in max_radius_scales:
                            if min_scale >= max_scale:
                                continue
                            configs.append({
                                "name": f"hough_b{blur}_dp{dp}_p1{param1}_p2{param2}_r{min_scale}-{max_scale}",
                                "blurKernel": blur,
                                "dp": dp,
                                "param1": param1,
                                "param2": param2,
                                "minRadiusScale": min_scale,
                                "maxRadiusScale": max_scale,
                            })
    if not configs:
        raise SystemExit("No pivot locator iteration configs were generated.")
    return [configs[index % len(configs)] for index in range(iteration_count)]


def detect_pivot_candidates_for_config(cv: Any, image: Any, config: dict[str, Any]) -> list[dict[str, Any]]:
    gray = cv.cvtColor(image, cv.COLOR_BGR2GRAY)
    blur_kernel = int(config["blurKernel"])
    if blur_kernel % 2 == 0:
        blur_kernel += 1
    blurred = cv.medianBlur(gray, blur_kernel)
    height, width = gray.shape[:2]
    min_dimension = min(width, height)
    circles = cv.HoughCircles(
        blurred,
        cv.HOUGH_GRADIENT,
        dp=float(config["dp"]),
        minDist=max(60, min_dimension // 4),
        param1=float(config["param1"]),
        param2=float(config["param2"]),
        minRadius=max(12, int(min_dimension * float(config["minRadiusScale"]))),
        maxRadius=max(18, int(min_dimension * float(config["maxRadiusScale"]))),
    )
    if circles is None:
        return []
    candidates = []
    for rank, raw_circle in enumerate(circles[0, :12], start=1):
        x, y, radius = [float(value) for value in raw_circle]
        if radius <= 0:
            continue
        centeredness = 1 - min(1.0, math.hypot(x - width / 2, y - height / 2) / max(width, height))
        radius_prior = 1 - min(1.0, abs(radius - min_dimension * 0.27) / max(min_dimension * 0.27, 1))
        confidence = max(0.05, min(0.95, 0.45 + centeredness * 0.25 + radius_prior * 0.2 - (rank - 1) * 0.03))
        payload = circle_payload(x, y, radius, confidence)
        payload["rank"] = rank
        payload["detector"] = "opencv_hough_circle"
        candidates.append(payload)
    return candidates


def score_pivot_candidate(candidate: dict[str, Any], truth: dict[str, Any] | None, width: int, height: int) -> dict[str, Any]:
    metrics = pivot_candidate_truth_metrics(candidate, truth)
    centeredness = 1 - min(1.0, math.hypot(candidate["center"]["x"] - width / 2, candidate["center"]["y"] - height / 2) / max(width, height))
    score = float(candidate["confidence"]) * 35 + centeredness * 15
    if truth is not None and metrics["centerErrorPx"] is not None and metrics["radiusMismatchRatio"] is not None:
        center_score = max(0.0, 1 - float(metrics["centerErrorPx"]) / max(float(truth["radius"]), 1.0))
        radius_score = max(0.0, 1 - float(metrics["radiusMismatchRatio"]))
        score += center_score * 32 + radius_score * 18
    scored = dict(candidate)
    scored["metrics"] = metrics
    scored["score"] = round(max(0.0, min(100.0, score)), 3)
    return scored


def pivot_candidate_truth_metrics(candidate: dict[str, Any] | None, truth: dict[str, Any] | None) -> dict[str, Any]:
    if candidate is None or truth is None:
        return {
            "centerErrorPx": None,
            "centerOffsetRatio": None,
            "radiusErrorPx": None,
            "radiusMismatchRatio": None,
        }
    center = candidate["center"]
    truth_center = truth["center"]
    center_error = math.hypot(float(center["x"]) - float(truth_center["x"]), float(center["y"]) - float(truth_center["y"]))
    radius_error = abs(float(candidate["radius"]) - float(truth["radius"]))
    return {
        "centerErrorPx": round(center_error, 3),
        "centerOffsetRatio": round(center_error / max(float(truth["radius"]), 1.0), 4),
        "radiusErrorPx": round(radius_error, 3),
        "radiusMismatchRatio": round(radius_error / max(float(truth["radius"]), 1.0), 4),
    }


def pivot_iteration_metrics(best_candidate: dict[str, Any] | None, truth: dict[str, Any] | None) -> dict[str, Any]:
    metrics = pivot_candidate_truth_metrics(best_candidate, truth)
    metrics["detected"] = best_candidate is not None
    metrics["confidence"] = None if best_candidate is None else best_candidate["confidence"]
    metrics["projectedXyCalibration"] = "blocked_missing_project_crs_calibration"
    metrics["realWorldFixture"] = "blocked_missing_operator_approved_fixture"
    return metrics


def pivot_iteration_decision(metrics: dict[str, Any], truth: dict[str, Any] | None) -> str:
    if not metrics["detected"]:
        return "fail_no_detection"
    if truth is None:
        return "blocked_missing_truth"
    center_error = metrics.get("centerErrorPx")
    if isinstance(center_error, (int, float)) and center_error <= DEFAULT_VISION_THRESHOLDS["maxCenterTruthOffsetPx"]:
        return "pass_synthetic"
    return "fail_synthetic"


def pivot_weighted_vote(decision: str, metrics: dict[str, Any], truth: dict[str, Any] | None) -> dict[str, Any]:
    ml_cv = 1.0 if decision == "pass_synthetic" else (0.45 if metrics["detected"] else 0.0)
    calibration = 0.0
    pivot_design = 0.65 if decision == "pass_synthetic" else 0.25
    qa_records = 1.0 if truth is not None else 0.35
    security = 1.0
    weights = {
        "mlCvEvidence": 0.35,
        "gisCalibrationXy": 0.25,
        "pivotDesign": 0.2,
        "qaRecords": 0.15,
        "offlineSecurity": 0.05,
    }
    components = {
        "mlCvEvidence": ml_cv,
        "gisCalibrationXy": calibration,
        "pivotDesign": pivot_design,
        "qaRecords": qa_records,
        "offlineSecurity": security,
    }
    score = sum(weights[key] * components[key] for key in weights)
    blockers = [
        "projected XY calibration absent",
        "operator-approved real-world pivot fixture absent",
    ]
    return {
        "status": "weighted_vote_passed_for_synthetic_fixture" if decision == "pass_synthetic" else "weighted_vote_not_passed",
        "score": round(score, 4),
        "weights": weights,
        "components": components,
        "vetoes": [],
        "blockers": blockers,
        "realWorldAccepted": False,
    }


def best_pivot_locator_iteration(iterations: list[dict[str, Any]]) -> dict[str, Any] | None:
    detected = [item for item in iterations if item["bestCandidate"] is not None]
    if not detected:
        return None
    return sorted(
        detected,
        key=lambda item: (
            item["decision"] == "pass_synthetic",
            -float(item["metrics"]["centerErrorPx"]) if isinstance(item["metrics"].get("centerErrorPx"), (int, float)) else -999999.0,
            item["weightedVote"]["score"],
            item["bestCandidate"]["score"],
        ),
        reverse=True,
    )[0]


def pivot_learning_action(index: int, previous_best_error: float | None, metrics: dict[str, Any]) -> str:
    if not metrics["detected"]:
        return "No circle candidate detected; continue threshold sweep."
    center_error = metrics.get("centerErrorPx")
    if not isinstance(center_error, (int, float)):
        return "Candidate detected without truth scoring; keep as unreviewed image-space evidence."
    if previous_best_error is None or center_error < previous_best_error:
        return f"Improved best center error to {center_error:.3f} px."
    return f"No best-error improvement on iteration {index}; preserve metrics for rejection audit."


def write_pivot_locator_annotated_image(
    cv: Any,
    image: Any,
    output_path: Path,
    best_iteration: dict[str, Any] | None,
    truth: dict[str, Any] | None,
) -> None:
    annotated = image.copy()
    if truth is not None:
        truth_circle = {
            "center": truth["center"],
            "radius": truth["radius"],
            "confidence": 1.0,
        }
        draw_circle(cv, annotated, truth_circle, (255, 255, 255), "truth pivot ring")
    if best_iteration is not None and best_iteration["bestCandidate"] is not None:
        draw_circle(cv, annotated, best_iteration["bestCandidate"], (0, 255, 255), "best detected pivot candidate")
    cv.putText(
        annotated,
        "PIVOT LOCATOR LOOP - ADVISORY, NO PROJECTED XY MUTATION",
        (24, 42),
        cv.FONT_HERSHEY_SIMPLEX,
        0.82,
        (0, 0, 0),
        5,
        cv.LINE_AA,
    )
    cv.putText(
        annotated,
        "PIVOT LOCATOR LOOP - ADVISORY, NO PROJECTED XY MUTATION",
        (24, 42),
        cv.FONT_HERSHEY_SIMPLEX,
        0.82,
        (255, 255, 255),
        2,
        cv.LINE_AA,
    )
    if not cv.imwrite(str(output_path), annotated):
        raise SystemExit(f"OpenCV could not write pivot locator annotated image: {output_path}")




def boundary_iteration_configs(iteration_count: int) -> list[dict[str, Any]]:
    base = [
        {"name": "baseline_canny_hough", "cannyLow": 55, "cannyHigh": 145, "blur": 5, "morphClose": 0, "surface": False, "operatorAssistedRanking": False},
        {"name": "low_threshold_fenceline", "cannyLow": 35, "cannyHigh": 110, "blur": 5, "morphClose": 5, "surface": False, "operatorAssistedRanking": False},
        {"name": "high_contrast_roads_structures", "cannyLow": 75, "cannyHigh": 190, "blur": 3, "morphClose": 7, "surface": False, "operatorAssistedRanking": False},
        {"name": "surface_color_variation", "cannyLow": 45, "cannyHigh": 135, "blur": 5, "morphClose": 9, "surface": True, "operatorAssistedRanking": False},
        {"name": "operator_ranked_surface_edges", "cannyLow": 38, "cannyHigh": 125, "blur": 7, "morphClose": 11, "surface": True, "operatorAssistedRanking": True},
    ]
    while len(base) < iteration_count:
        step = len(base)
        base.append({
            "name": f"expanded_search_{step + 1}",
            "cannyLow": 30 + (step % 5) * 10,
            "cannyHigh": 105 + (step % 6) * 15,
            "blur": 3 + (step % 3) * 2,
            "morphClose": 5 + (step % 4) * 4,
            "surface": step % 2 == 0,
            "operatorAssistedRanking": step >= 4,
        })
    return base[:iteration_count]


def boundary_edges_for_config(cv: Any, image: Any, config: dict[str, Any]) -> Any:
    gray = cv.cvtColor(image, cv.COLOR_BGR2GRAY)
    overlay = overlay_mask(cv, image)
    gray = cv.inpaint(gray, cv.dilate(overlay, None, iterations=2), 3, cv.INPAINT_TELEA)
    blur_size = int(config["blur"])
    if blur_size % 2 == 0:
        blur_size += 1
    blurred = cv.GaussianBlur(gray, (blur_size, blur_size), 0)
    edges = cv.Canny(blurred, int(config["cannyLow"]), int(config["cannyHigh"]))
    if config.get("surface"):
        edges = cv.bitwise_or(edges, surface_feature_edges(cv, image, overlay))
    close_size = int(config.get("morphClose", 0))
    if close_size > 0:
        kernel = cv.getStructuringElement(cv.MORPH_RECT, (close_size, close_size))
        edges = cv.morphologyEx(edges, cv.MORPH_CLOSE, kernel, iterations=1)
    return edges


def boundary_candidates_for_edges(
    cv: Any,
    image: Any,
    edges: Any,
    pivot_crop_ring: dict[str, Any] | None,
    config: dict[str, Any],
) -> list[dict[str, Any]]:
    height, width = image.shape[:2]
    candidates: list[dict[str, Any]] = []
    for hough_candidate in hough_boundary_candidates(cv, edges, width, height, pivot_crop_ring):
        candidates.append({
            "source": "opencv",
            "method": f"{config['name']}:{hough_candidate['method']}",
            "polygon": hough_candidate["polygon"],
            "candidateWarnings": hough_candidate.get("warnings", []),
        })
    contour_candidate = field_boundary_from_contours(cv, edges, width, height, pivot_crop_ring)
    if contour_candidate is not None:
        candidates.append({
            "source": "opencv",
            "method": f"{config['name']}:contour_field_separation_edges",
            "polygon": contour_candidate,
        })
    if config.get("surface"):
        candidates.extend(surface_feature_boundary_candidates(cv, image, edges, width, height, pivot_crop_ring, config["name"]))
    candidates.extend(irregular_edge_boundary_candidates(cv, edges, width, height, pivot_crop_ring, config["name"]))
    return dedupe_boundary_candidates(candidates)


def surface_feature_edges(cv: Any, image: Any, overlay: Any) -> Any:
    lab = cv.cvtColor(image, cv.COLOR_BGR2LAB)
    hsv = cv.cvtColor(image, cv.COLOR_BGR2HSV)
    l_channel, a_channel, b_channel = cv.split(lab)
    hue, saturation, value = cv.split(hsv)
    color_gradient = cv.addWeighted(cv.Canny(a_channel, 35, 105), 0.45, cv.Canny(b_channel, 35, 105), 0.45, 0)
    shadow_structure = cv.Canny(value, 45, 130)
    vegetation_transition = cv.Canny(saturation, 40, 120)
    combined = cv.bitwise_or(cv.bitwise_or(color_gradient, shadow_structure), vegetation_transition)
    combined = cv.bitwise_and(combined, cv.bitwise_not(cv.dilate(overlay, None, iterations=2)))
    return combined


def surface_feature_boundary_candidates(
    cv: Any,
    image: Any,
    edges: Any,
    width: int,
    height: int,
    pivot_crop_ring: dict[str, Any] | None,
    config_name: str,
) -> list[dict[str, Any]]:
    candidates = []
    expanded = cv.dilate(edges, cv.getStructuringElement(cv.MORPH_RECT, (9, 9)), iterations=1)
    lines = cv.HoughLinesP(expanded, 1, math.pi / 180, threshold=65, minLineLength=max(60, min(width, height) // 10), maxLineGap=55)
    for candidate in hough_boundary_candidates_from_lines(lines, width, height, pivot_crop_ring, allow_partial=True):
        candidates.append({
            "source": "opencv",
            "method": f"{config_name}:surface_color_tree_road_fence_line_cues:{candidate['method']}",
            "polygon": candidate["polygon"],
            "candidateWarnings": candidate.get("warnings", []),
        })
    return candidates


def irregular_edge_boundary_candidates(
    cv: Any,
    edges: Any,
    width: int,
    height: int,
    pivot_crop_ring: dict[str, Any] | None,
    config_name: str,
) -> list[dict[str, Any]]:
    closed = cv.morphologyEx(edges, cv.MORPH_CLOSE, cv.getStructuringElement(cv.MORPH_RECT, (17, 17)), iterations=1)
    closed = cv.dilate(closed, cv.getStructuringElement(cv.MORPH_ELLIPSE, (5, 5)), iterations=1)
    contours, _ = cv.findContours(closed, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    candidates = []
    center = None
    if pivot_crop_ring is not None:
        center = {
            "x": float(pivot_crop_ring["center"]["x"]),
            "y": float(pivot_crop_ring["center"]["y"]),
        }
    for contour in sorted(contours, key=cv.contourArea, reverse=True)[:10]:
        area = float(cv.contourArea(contour))
        area_ratio = area / max(1, width * height)
        if area_ratio < 0.035 or area_ratio > 0.88:
            continue
        perimeter = float(cv.arcLength(contour, True))
        if perimeter <= 0:
            continue
        approx = cv.approxPolyDP(contour, 0.012 * perimeter, True)
        if len(approx) < 5 or len(approx) > 28:
            continue
        polygon = clamp_image_polygon([{"x": float(point[0][0]), "y": float(point[0][1])} for point in approx], width, height)
        if center is not None and not image_point_in_polygon(center, polygon):
            continue
        if looks_like_axis_aligned_rectangle(polygon) or looks_like_screenshot_extent_box(polygon, width, height):
            continue
        candidates.append({
            "source": "opencv",
            "method": f"{config_name}:irregular_road_fenceline_treeline_edge_contour",
            "polygon": polygon,
        })
    return candidates


def operator_assisted_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    alignment = candidate.get("operatorLabelAlignment")
    if alignment is None:
        return candidate
    adjusted = dict(candidate)
    adjusted["confidence"] = round(max(candidate["confidence"], min(0.92, 0.42 + alignment * 0.42)), 3)
    adjusted["cues"] = [*candidate.get("cues", []), "operator_feedback_ranked_not_predicted"]
    if adjusted["rejected"] and alignment >= DEFAULT_VISION_THRESHOLDS["minOperatorBoundaryIoU"] and adjusted["rejectionReasons"] == ["candidate is clipped by the screenshot edge and cannot be accepted as a complete imagery field boundary"]:
        adjusted["rejectionReasons"] = [
            "candidate overlaps operator label but remains rejected because screenshot clipping prevents complete imagery-only acceptance"
        ]
    return adjusted


def dedupe_boundary_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique = []
    seen = set()
    for candidate in candidates:
        key = tuple((round(float(point["x"]) / 6), round(float(point["y"]) / 6)) for point in candidate["polygon"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def best_boundary_iteration(iterations: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not iterations:
        return None
    with_accepted = [iteration for iteration in iterations if iteration.get("bestAcceptedCandidate") is not None]
    pool = with_accepted if with_accepted else iterations
    return sorted(
        pool,
        key=lambda item: (
            best_iteration_operator_iou(item),
            item.get("bestCandidate", {}).get("confidence", 0) if item.get("bestCandidate") else 0,
        ),
        reverse=True,
    )[0]


def best_iteration_operator_iou(iteration: dict[str, Any]) -> float:
    best = iteration.get("bestCandidate")
    if best is None:
        return -1
    for comparison in iteration.get("operatorComparison", []):
        if comparison.get("imagePolygon") == best.get("imagePolygon"):
            return float(comparison["iou"])
    value = best.get("operatorLabelAlignment")
    return float(value) if isinstance(value, (int, float)) else -1


def best_boundary_candidate(iterations: list[dict[str, Any]], rejected: bool) -> dict[str, Any] | None:
    candidates = []
    for iteration in iterations:
        candidate = iteration.get("bestRejectedCandidate" if rejected else "bestAcceptedCandidate")
        if candidate is not None:
            candidates.append(candidate)
    if not candidates:
        return None
    return sorted(
        candidates,
        key=lambda candidate: (
            candidate.get("operatorLabelAlignment") if candidate.get("operatorLabelAlignment") is not None else -1,
            candidate.get("confidence", 0),
        ),
        reverse=True,
    )[0]


def boundary_improvement_failure_mode(
    cv_candidate: dict[str, Any] | None,
    best_rejected_candidate: dict[str, Any] | None,
    iterations: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if cv_candidate is not None:
        return None
    if best_rejected_candidate is None:
        return {
            "code": "no_cv_candidate",
            "summary": "No local CV field-boundary candidate was produced.",
            "iterationCount": len(iterations),
        }
    reasons = best_rejected_candidate.get("rejectionReasons", [])
    if (
        "candidate is clipped by the screenshot edge and cannot be accepted as a complete imagery field boundary" in reasons
        or "candidate resembles the screenshot extent rather than the target field boundary" in reasons
    ) and looks_like_axis_aligned_rectangle(best_rejected_candidate.get("imagePolygon", [])):
        code = "clipped_axis_aligned_extent_box"
    else:
        code = "rejected_cv_candidate"
    return {
        "code": code,
        "summary": "Best local CV evidence was retained as rejected learning evidence, not as a detector result.",
        "rejectionReasons": reasons,
        "confidence": best_rejected_candidate.get("confidence"),
        "operatorLabelAlignment": best_rejected_candidate.get("operatorLabelAlignment"),
        "operatorFalsePositiveAreaRatio": best_rejected_candidate.get("operatorFalsePositiveAreaRatio"),
        "operatorBoundaryMeanDistancePixels": best_rejected_candidate.get("operatorBoundaryMeanDistancePixels"),
    }


def operator_guided_learning_summary(
    operator_polygon: list[dict[str, Any]] | None,
    iterations: list[dict[str, Any]],
    best_rejected_candidate: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "enabled": operator_polygon is not None,
        "usedForGeometryMutation": False,
        "role": "training_and_scoring_evidence_only",
        "iterationCount": len(iterations),
        "bestRejectedCandidateTracked": best_rejected_candidate is not None,
    }


def learning_action_for_iteration(index: int, best: dict[str, Any] | None, comparisons: list[dict[str, Any]]) -> dict[str, Any]:
    if best is None:
        return {"type": "candidate_generation", "decision": "expand_search", "reason": "no candidates produced"}
    if comparisons:
        top = comparisons[0]
        if top["iou"] < 0.55:
            return {"type": "operator_feedback", "decision": "increase_surface_and_line_cues", "reason": f"best IoU {top['iou']} is weak"}
        if best.get("rejected"):
            return {"type": "acceptance_gate", "decision": "keep_rejected_until_complete_boundary", "reason": "candidate overlaps label but fails imagery-only gate"}
        return {"type": "ranking", "decision": "promote_config", "reason": f"best IoU {top['iou']}"}
    if best.get("rejected"):
        return {"type": "acceptance_gate", "decision": "reject_weak_result", "reason": "; ".join(best.get("rejectionReasons", []))}
    return {"type": "ranking", "decision": "candidate_available_without_operator_label", "reason": f"confidence {best.get('confidence')}"}




def detect_line_cues(cv: Any, image: Any) -> list[dict[str, Any]]:
    gray = cv.cvtColor(image, cv.COLOR_BGR2GRAY)
    edges = cv.Canny(gray, 60, 150)
    lines = cv.HoughLinesP(edges, 1, math.pi / 180, threshold=80, minLineLength=max(40, min(image.shape[:2]) // 8), maxLineGap=18)
    if lines is None:
        return []
    horizontal = 0
    vertical = 0
    diagonal = 0
    for raw in lines[:, 0, :20]:
        x1, y1, x2, y2 = [float(value) for value in raw]
        angle = abs(math.degrees(math.atan2(y2 - y1, x2 - x1))) % 180
        if angle < 15 or angle > 165:
            horizontal += 1
        elif 75 < angle < 105:
            vertical += 1
        else:
            diagonal += 1
    detections = []
    if horizontal + vertical >= 2:
        detections.append({"kind": "service_or_access_lines", "confidence": min(0.82, 0.35 + 0.04 * (horizontal + vertical)), "source": "opencv_hough_lines"})
    if diagonal >= 2:
        detections.append({"kind": "tower_radial_alignment_or_corner_arm_arc_cue", "confidence": min(0.76, 0.32 + 0.04 * diagonal), "source": "opencv_hough_lines"})
    return detections


def false_positive_categories(cases: list[dict[str, Any]]) -> dict[str, int]:
    categories: dict[str, int] = {}
    for case in cases:
        if not case["outcomes"]["boundaryFalsePositive"]:
            continue
        boundary = case["detections"].get("imageryFieldBoundary") or {}
        for reason in boundary.get("rejectionReasons", []) or ["accepted_false_positive"]:
            categories[reason] = categories.get(reason, 0) + 1
    return categories


def resolve_manifest_path(manifest_dir: Path, value: Any, required: bool = True) -> Path | None:
    if value is None:
        if required:
            raise SystemExit("Vision fixture entry is missing a required local artifact path.")
        return None
    path = Path(str(value))
    if not path.is_absolute():
        path = manifest_dir / path
    if required and not path.exists():
        raise SystemExit(f"Vision fixture artifact does not exist: {path}")
    return path if path.exists() else None


def is_black_or_uniform_canvas(cv: Any, image: Any) -> bool:
    gray = cv.cvtColor(image, cv.COLOR_BGR2GRAY)
    _mean, stddev = cv.meanStdDev(gray)
    return float(stddev[0][0]) < 3.0 or int(cv.countNonZero(gray)) / max(1, gray.shape[0] * gray.shape[1]) < 0.02


def safe_ratio(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return round(numerator / denominator, 4)


def safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_.-]+", "-", value).strip("-")
    return cleaned or "fixture"


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def probe_gpu() -> int:
    try:
        import torch  # type: ignore
    except Exception as exc:
        print(f"PyTorch import failed: {exc}", file=sys.stderr)
        return 1

    available = bool(torch.cuda.is_available())
    device_count = int(torch.cuda.device_count()) if available else 0
    devices = [torch.cuda.get_device_name(index) for index in range(device_count)]
    payload = {
      "torchVersion": torch.__version__,
      "cudaAvailable": available,
      "cudaRuntime": torch.version.cuda,
      "deviceCount": device_count,
      "devices": devices,
    }
    print(json.dumps(payload, indent=2))
    if not available or not any("RTX" in name.upper() for name in devices):
        print("CUDA probe failed: expected an RTX-class NVIDIA GPU visible to PyTorch.", file=sys.stderr)
        return 1
    return 0


def probe_boundary_detector(sam2_config_arg: Path | None, sam2_checkpoint_arg: Path | None) -> int:
    opencv = probe_opencv()
    sam2_config = configured_path(sam2_config_arg, SAM2_CONFIG_ENV)
    sam2_checkpoint = configured_path(sam2_checkpoint_arg, SAM2_CHECKPOINT_ENV)
    sam2 = probe_sam2(sam2_config, sam2_checkpoint)
    cuda = probe_cuda()
    payload = {
        "opencv": opencv,
        "sam2": sam2,
        "cuda": cuda,
        "offline": {
            "canRunOpenCvScoring": bool(opencv["available"] and opencv["houghCircles"] and opencv["houghLinesP"]),
            "canRunSam2Proposals": False,
            "canRunExplicitManagedJob": bool(sam2["managedJobRunnerAvailable"]),
            "networkRequired": False,
            "hiddenDownloads": False,
            "canRunOffline": bool(opencv["available"] and opencv["houghCircles"] and opencv["houghLinesP"]),
        },
    }
    print(json.dumps(payload, indent=2))
    return 0 if payload["offline"]["canRunOpenCvScoring"] else 1












def report_layout_candidates(input_path: Path, output_dir: Path, max_alternatives: int, created_at: str) -> int:
    project = load_project(input_path)
    validate_project(project)
    candidates = build_layout_candidate_reports(project, max(1, min(max_alternatives, 12)), created_at)
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "layout-candidate-report.json"
    geojson_path = output_dir / "layout-candidate-report-candidates.geojson"
    report = {
      "schemaVersion": LAYOUT_CANDIDATE_REPORT_SCHEMA_VERSION,
      "projectId": project["id"],
      "projectCrs": project["projectCrs"],
      "createdAt": created_at,
      "candidateReports": candidates,
      "canonicalGeometryMutation": False,
      "appImportable": False,
      "nonGoals": [
        "Does not create CPLayout project review records.",
        "Does not mutate canonical projected XY geometry.",
      ],
    }
    json_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    geojson_path.write_text(json.dumps(recommendations_to_geojson(candidates), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
      "projectId": project["id"],
      "projectCrs": project["projectCrs"],
      "candidateReportCount": len(candidates),
      "json": str(json_path),
      "geojson": str(geojson_path),
      "gpuBacked": False,
      "note": "Deterministic advisory baseline; standalone companion report only.",
    }, indent=2))
    return 0


def design_vision_review(
    kml_path: Path,
    kmz_path: Path,
    full_window_path: Path,
    map_canvas_path: Path,
    manifest_path: Path,
    output_dir: Path,
    project_id: str,
    project_crs: str,
    project_reference_path: Path | None,
    infer_field_boundary: bool,
    operator_boundary_path: str | None,
    operator_boundary_text: str | None,
    operator_labels_path: str | None,
    operator_labels_text: str | None,
    operator_boundary_name: str,
    sam2_config_arg: Path | None,
    sam2_checkpoint_arg: Path | None,
    created_at: str,
) -> int:
    require_projected_crs(project_crs, "design-vision-review")
    paths = {
        "kml": kml_path,
        "kmz": kmz_path,
        "fullWindowScreenshot": full_window_path,
        "mapCanvasCrop": map_canvas_path,
        "visualFidelityManifest": manifest_path,
    }
    artifacts = {name: artifact_inventory(path) for name, path in paths.items()}
    manifest = load_json_with_bom(manifest_path)
    verify_manifest_linkage(manifest, artifacts)
    kml_text = kml_path.read_text(encoding="utf-8")
    look_at = extract_look_at_coordinate(kml_text)
    project_reference = load_project(project_reference_path) if project_reference_path else None
    if project_reference is not None:
        validate_project(project_reference)
        if project_reference["id"] != project_id:
            raise SystemExit(f"Project reference {project_reference['id']} does not match --project-id {project_id}.")
        if project_reference["projectCrs"] != project_crs:
            raise SystemExit(f"Project reference CRS {project_reference['projectCrs']} does not match --project-crs {project_crs}.")

    cv = import_cv2()
    full_window_image = cv.imread(str(full_window_path))
    map_canvas_image = cv.imread(str(map_canvas_path))
    if full_window_image is None:
        raise SystemExit(f"OpenCV could not read full-window screenshot: {full_window_path}")
    if map_canvas_image is None:
        raise SystemExit(f"OpenCV could not read map-canvas crop: {map_canvas_path}")

    pivot_crop_ring = detect_pivot_crop_ring(cv, map_canvas_image)
    overlay_circle = detect_overlay_circle(cv, map_canvas_image, pivot_crop_ring)
    overlay_visible = overlay_circle is not None or detect_overlay_linework(cv, map_canvas_image)
    attribution = detect_attribution_cue(cv, full_window_image)
    operator_field_boundary = None
    if operator_boundary_path is not None or operator_boundary_text is not None:
        operator_field_boundary = load_operator_field_boundary(
            operator_boundary_path,
            operator_boundary_text,
            operator_boundary_name,
            kml_text,
            project_reference,
            overlay_circle,
        )
    truth_labels = None
    if operator_labels_path is not None or operator_labels_text is not None:
        truth_labels = load_operator_truth_labels(
            operator_labels_path,
            operator_labels_text,
            kml_text,
            project_reference,
            overlay_circle,
        )
        target_boundary = truth_labels.get("targetFieldBoundary", {})
        if target_boundary.get("wgs84Polygon") is not None:
            operator_field_boundary = target_boundary
    elif operator_field_boundary is not None:
        truth_labels = truth_labels_from_operator_boundary(operator_field_boundary)
    boundary_detector_status = boundary_detector_runtime_status(sam2_config_arg, sam2_checkpoint_arg) if infer_field_boundary else None
    sam2_adapter = load_sam2_adapter(boundary_detector_status) if infer_field_boundary else None
    operator_image_polygon = operator_field_boundary.get("imagePolygon") if operator_field_boundary is not None else None
    imagery_field_boundary = detect_imagery_field_boundary(cv, map_canvas_image, pivot_crop_ring, sam2_adapter, operator_image_polygon) if infer_field_boundary else None
    projected_field_boundary = project_image_boundary_to_xy(imagery_field_boundary, overlay_circle, project_reference) if infer_field_boundary else None
    if imagery_field_boundary is not None and projected_field_boundary is not None:
        imagery_field_boundary["projectedPolygon"] = projected_field_boundary

    center_offset_ratio = None
    radius_mismatch_ratio = None
    if pivot_crop_ring is not None and overlay_circle is not None and pivot_crop_ring["radius"] > 0:
        center_offset_ratio = round(math.hypot(
            overlay_circle["center"]["x"] - pivot_crop_ring["center"]["x"],
            overlay_circle["center"]["y"] - pivot_crop_ring["center"]["y"],
        ) / pivot_crop_ring["radius"], 4)
        radius_mismatch_ratio = round(abs(overlay_circle["radius"] - pivot_crop_ring["radius"]) / pivot_crop_ring["radius"], 4)

    detection_confidence = vision_confidence(pivot_crop_ring, overlay_circle, overlay_visible, attribution["present"], imagery_field_boundary)
    assessment = assess_design_vision_review({
        "centerOffsetRatio": center_offset_ratio,
        "radiusMismatchRatio": radius_mismatch_ratio,
        "overlayVisible": overlay_visible,
        "attributionPresent": attribution["present"],
        "detectionConfidence": detection_confidence,
        "inferFieldBoundary": infer_field_boundary,
        "fieldBoundaryConfidence": imagery_field_boundary["confidence"] if imagery_field_boundary else None,
        "fieldBoundaryProjected": projected_field_boundary is not None,
    })
    operator_comparison = compare_candidates_to_operator(
        cv,
        map_canvas_image,
        imagery_field_boundary,
        operator_field_boundary,
    )
    obstruction_masks = build_obstruction_masks(cv, map_canvas_image, truth_labels)
    truth_metrics = pivot_truth_metrics(pivot_crop_ring, overlay_circle, truth_labels)
    road_building_tree_conflict = circle_obstruction_conflicts(cv, map_canvas_image, overlay_circle, obstruction_masks)
    learning_recommendations = learning_recommendations_from_comparison(imagery_field_boundary, operator_field_boundary, operator_comparison)
    hard_failures = design_hard_failures(
        imagery_field_boundary,
        operator_comparison,
        truth_metrics,
        road_building_tree_conflict,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    annotated_path = output_dir / "visual-layout-review-annotated.png"
    write_annotated_image(cv, map_canvas_image, annotated_path, pivot_crop_ring, overlay_circle, imagery_field_boundary, operator_field_boundary, operator_comparison)
    annotated_artifact = artifact_inventory(annotated_path)

    evidence_id = f"{project_id}:design-vision-review-evidence"
    recommendation_id = f"{project_id}:design-vision-review"
    evidence_record = {
        "id": evidence_id,
        "projectId": project_id,
        "sourceKind": "layout_score",
        "createdAt": created_at,
        "collectedAt": manifest.get("generatedAt"),
        "projectCrs": project_crs,
        "summary": "Design-only local CV review of CPLayout overlay alignment against Google Earth Pro proof screenshots.",
        "confidence": assessment["confidence"],
        "reviewStatus": "unreviewed",
        "notes": "Advisory image-space evidence only; does not create survey data or mutate canonical projected XY geometry.",
        "artifacts": {"truthLabels": truth_labels.get("artifact") if truth_labels else None},
        "metrics": {
            "centerTruthOffsetPx": truth_metrics.get("centerTruthOffsetPx"),
            "radiusTruthMismatchRatio": truth_metrics.get("radiusTruthMismatchRatio"),
            "roadBuildingTreeConflict": road_building_tree_conflict["any"],
            "boundaryFalsePositiveRatio": best_operator_metric(operator_comparison, "falsePositiveAreaRatio"),
        },
    }
    recommendation = {
        "id": recommendation_id,
        "projectId": project_id,
        "modelName": VISION_MODEL_NAME,
        "modelVersion": VISION_MODEL_VERSION,
        "createdAt": created_at,
        "projectCrs": project_crs,
        "summary": recommendation_summary(assessment["warnings"]),
        "proposedGeometry": vision_recommendation_geometry(project_crs, project_reference, look_at, projected_field_boundary),
        "confidence": assessment["confidence"],
        "evidenceIds": [evidence_id],
        "reviewStatus": "unreviewed",
        "score": assessment["score"],
        "metadata": {
            "imageryConstraintAssessment": assessment,
            "truthCenterOffsetMeters": None,
            "roadConflict": road_building_tree_conflict["southRoad"],
            "buildingTreeConflict": road_building_tree_conflict["seBuildingTree"],
            "roadBuildingTreeConflict": road_building_tree_conflict["any"],
            "boundaryFalsePositiveRatio": best_operator_metric(operator_comparison, "falsePositiveAreaRatio"),
            "hardFailures": hard_failures,
            "feasible": len(hard_failures) == 0,
        },
        "warnings": assessment["warnings"] + [
            *hard_failures,
            "Design-only review; acceptance must route through projected-XY import/editor/operator workflows.",
            "Google Earth imagery is local companion evidence only and is not cached, embedded, or used as a substitute dataset.",
            *([] if projected_field_boundary is not None else ["No calibrated imagery field-boundary polygon was exported; recommendation remains metadata/display-only for boundary geometry."]),
        ],
    }
    decision_record = {
        "id": f"{project_id}:design-vision-review-decision-placeholder",
        "projectId": project_id,
        "createdAt": created_at,
        "decidedBy": "test_fixture",
        "decision": "deferred",
        "recommendationId": recommendation_id,
        "evidenceIds": [evidence_id],
        "reason": "Default generated placeholder: operator review is required before any geometry workflow action.",
    }

    report = {
        "schemaVersion": VISION_SCHEMA_VERSION,
        "createdAt": created_at,
        "projectId": project_id,
        "projectCrs": project_crs,
        "designOnly": True,
        "surveyGrade": False,
        "canonicalGeometryMutation": False,
        "reviewStatus": "unreviewed",
        "thresholds": DEFAULT_VISION_THRESHOLDS,
        "artifacts": artifacts | {"annotatedReview": annotated_artifact},
        "boundaryDetector": boundary_detector_status,
        "manifestStatus": {
            "status": manifest.get("status"),
            "proofPassed": manifest.get("proofPassed"),
            "overlayVisibleConfirmed": manifest.get("manualReview", {}).get("overlayVisibleConfirmed"),
        },
        "detections": {
            "pivotCropRing": pivot_crop_ring,
            "overlayCircle": overlay_circle,
            "truthBoundary": operator_field_boundary,
            "cvCandidateBoundary": imagery_field_boundary,
            "imageryFieldBoundary": imagery_field_boundary,
            "operatorFieldBoundary": operator_field_boundary,
            "truthLabels": truth_labels,
            "obstructionMasks": obstruction_masks,
            "overlayVisible": overlay_visible,
            "attribution": attribution,
        },
        "operatorComparison": operator_comparison,
        "learningRecommendations": learning_recommendations,
        "metrics": {
            "centerOffsetRatio": center_offset_ratio,
            "radiusMismatchRatio": radius_mismatch_ratio,
            "centerTruthOffsetPx": truth_metrics.get("centerTruthOffsetPx"),
            "radiusTruthMismatchRatio": truth_metrics.get("radiusTruthMismatchRatio"),
            "roadBuildingTreeConflict": road_building_tree_conflict["any"],
            "detectionConfidence": assessment["confidence"],
        },
        "acceptance": {
            "accepted": cv_boundary_accepted(imagery_field_boundary, operator_comparison, hard_failures),
            "cvCandidateAccepted": cv_boundary_accepted(imagery_field_boundary, operator_comparison, hard_failures),
            "truthBoundaryPresent": operator_field_boundary is not None,
            "truthBoundaryAccepted": operator_field_boundary is not None,
            "truthBoundaryMode": "operator_truth_reconstruction" if operator_field_boundary is not None else None,
            "hardFailures": hard_failures,
        },
        "assessment": assessment,
        "evidenceRecords": [evidence_record],
        "candidateReports": [recommendation],
        "operatorDecisionNotes": [decision_record],
        "nonGoals": [
            "Does not mutate PivotProject geometry, schemas, persistence, or archives.",
            "Does not treat screenshot-derived field-boundary geometry as survey-grade evidence.",
            "Does not treat operator KML labels as automatic model predictions.",
            "Does not prove React Native, Android, iOS, MapLibre, SQLite, or mobile runtime behavior.",
        ],
    }

    json_path = output_dir / "visual-layout-review.json"
    geojson_path = output_dir / "visual-layout-review-candidates.geojson"
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    geojson_path.write_text(json.dumps(recommendations_to_geojson([recommendation]), indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "schemaVersion": VISION_SCHEMA_VERSION,
        "json": str(json_path),
        "geojson": str(geojson_path),
        "annotatedPng": str(annotated_path),
        "score": assessment["score"],
        "confidence": assessment["confidence"],
        "warnings": assessment["warnings"],
        "canonicalGeometryMutation": False,
        "designOnly": True,
    }, indent=2))
    return 0


def load_project(input_path: Path) -> dict[str, Any]:
    if input_path.suffix == ".zip" or input_path.name.endswith(".center-pivot.zip"):
        with zipfile.ZipFile(input_path) as archive:
            with archive.open("project.json") as handle:
                return unwrap_project_document(json.loads(handle.read().decode("utf-8")))
    return unwrap_project_document(json.loads(input_path.read_text(encoding="utf-8")))


def unwrap_project_document(input_data: dict[str, Any]) -> dict[str, Any]:
    project = input_data.get("project")
    if isinstance(project, dict):
        return project
    return input_data


def validate_project(project: dict[str, Any]) -> None:
    for key in ["id", "projectCrs", "fieldBoundary", "pivotCenter", "machine"]:
        if key not in project:
            raise SystemExit(f"Project is missing required field: {key}")
    require_projected_crs(str(project["projectCrs"]), "Project")
    if len(project["fieldBoundary"]) < 3:
        raise SystemExit("Project fieldBoundary must contain at least three projected XY vertices.")


def build_layout_candidate_reports(project: dict[str, Any], max_alternatives: int, created_at: str) -> list[dict[str, Any]]:
    pivot = project["pivotCenter"]
    boundary = project["fieldBoundary"]
    centroid = polygon_centroid(boundary)
    offsets = [
      (0.0, 0.0, "current pivot center baseline"),
      ((centroid["x"] - pivot["x"]) * 0.25, (centroid["y"] - pivot["y"]) * 0.25, "quarter step toward field centroid"),
      ((centroid["x"] - pivot["x"]) * 0.5, (centroid["y"] - pivot["y"]) * 0.5, "half step toward field centroid"),
      (12.0, 0.0, "east sensitivity check"),
      (-12.0, 0.0, "west sensitivity check"),
      (0.0, 12.0, "north sensitivity check"),
      (0.0, -12.0, "south sensitivity check"),
    ][:max_alternatives]
    scored = []
    for index, (dx, dy, label) in enumerate(offsets):
        candidate = {"x": round(float(pivot["x"]) + dx, 3), "y": round(float(pivot["y"]) + dy, 3)}
        distance_to_centroid = math.hypot(candidate["x"] - centroid["x"], candidate["y"] - centroid["y"])
        radius = machine_radius(project["machine"])
        boundary_radius = average_radius(boundary, centroid)
        fit_penalty = abs(radius - boundary_radius) / max(boundary_radius, 1.0)
        score = max(0.0, min(100.0, 100.0 - distance_to_centroid / 12.0 - fit_penalty * 20.0))
        confidence = max(0.35, min(0.78, 0.72 - index * 0.04))
        scored.append({
          "id": f"{project['id']}:baseline-candidate-{index + 1}",
          "projectId": project["id"],
          "modelName": MODEL_NAME,
          "modelVersion": MODEL_VERSION,
          "createdAt": created_at,
          "projectCrs": project["projectCrs"],
          "summary": f"Inspect {label}.",
          "proposedGeometry": {
            "projectCrs": project["projectCrs"],
            "pivotCenter": candidate,
          },
          "confidence": round(confidence, 3),
          "evidenceIds": [],
          "inspectionStatus": "unreviewed",
          "score": round(score, 3),
          "warnings": [
            "Advisory deterministic baseline; not a production-trained agronomy model.",
            "Standalone companion report only; CPLayout geometry changes require Files import, Map editing, validation, and operator action.",
          ],
        })
    return sorted(scored, key=lambda item: item["score"], reverse=True)


def recommendations_to_geojson(recommendations: list[dict[str, Any]]) -> dict[str, Any]:
    features = []
    for recommendation in recommendations:
        properties = {
          "id": recommendation["id"],
          "projectId": recommendation["projectId"],
          "projectCrs": recommendation["projectCrs"],
          "coordinateReferenceSystem": "project_crs_xy",
          "createdAt": recommendation["createdAt"],
          "modelName": recommendation["modelName"],
          "modelVersion": recommendation["modelVersion"],
          "confidence": recommendation["confidence"],
          "inspectionStatus": recommendation.get("inspectionStatus", recommendation.get("reviewStatus")),
          "score": recommendation["score"],
          "summary": recommendation["summary"],
          "warnings": recommendation["warnings"],
          "evidenceIds": recommendation["evidenceIds"],
          "metadata": recommendation.get("metadata"),
          "scoreBreakdown": recommendation.get("scoreBreakdown"),
          "displayWgs84": recommendation["proposedGeometry"].get("displayWgs84"),
          "evidenceOnly": True,
          "appImportable": False,
          "writesProjectDatabase": False,
          "canonicalGeometryMutation": False,
        }
        pivot = recommendation["proposedGeometry"].get("pivotCenter")
        if pivot is not None:
            features.append({
              "type": "Feature",
              "geometry": {"type": "Point", "coordinates": [pivot["x"], pivot["y"]]},
              "properties": properties | {"geometryRole": "pivot_center"},
            })
        field_boundary = recommendation["proposedGeometry"].get("fieldBoundary")
        if field_boundary is not None:
            features.append({
              "type": "Feature",
              "geometry": {"type": "Polygon", "coordinates": [closed_ring_coordinates(field_boundary)]},
              "properties": properties | {"geometryRole": "field_boundary"},
            })
        for index, polygon in enumerate(recommendation["proposedGeometry"].get("obstaclePolygons") or []):
            features.append({
              "type": "Feature",
              "geometry": {"type": "Polygon", "coordinates": [closed_ring_coordinates(polygon)]},
              "properties": properties | {"geometryRole": "obstacle_polygon", "obstacleIndex": index},
            })
        if pivot is None and field_boundary is None and not recommendation["proposedGeometry"].get("obstaclePolygons"):
            features.append({
              "type": "Feature",
              "geometry": None,
              "properties": properties | {"geometryRole": "metadata_only"},
            })
    return {
      "type": "FeatureCollection",
      "schemaVersion": COMPANION_CANDIDATE_GEOJSON_SCHEMA_VERSION,
      "name": "cplayout-companion-candidate-reports",
      "coordinateReferenceSystem": "project_crs_xy",
      "canonicalGeometryMutation": False,
      "evidenceOnly": True,
      "appImportable": False,
      "writesProjectDatabase": False,
      "features": features,
    }


def vision_recommendation_geometry(
    project_crs: str,
    project_reference: dict[str, Any] | None,
    look_at: dict[str, float] | None,
    detected_field_boundary: list[dict[str, float]] | None,
) -> dict[str, Any]:
    geometry: dict[str, Any] = {"projectCrs": project_crs}
    if project_reference is not None:
        geometry["pivotCenter"] = project_reference["pivotCenter"]
        if detected_field_boundary is not None:
            geometry["fieldBoundary"] = detected_field_boundary
    elif look_at is not None:
        geometry["displayWgs84"] = [{"longitude": look_at["longitude"], "latitude": look_at["latitude"]}]
    return geometry


def extract_look_at_coordinate(kml_text: str) -> dict[str, float] | None:
    match = re.search(
        r"<LookAt\b[^>]*>.*?<longitude>\s*([-0-9.]+)\s*</longitude>.*?<latitude>\s*([-0-9.]+)\s*</latitude>.*?</LookAt>",
        kml_text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return None
    return {"longitude": float(match.group(1)), "latitude": float(match.group(2))}


def load_operator_field_boundary(
    path_value: str | None,
    text_value: str | None,
    placemark_name: str,
    proof_kml_text: str,
    project_reference: dict[str, Any] | None,
    overlay_circle: dict[str, Any] | None,
) -> dict[str, Any]:
    text, artifact = read_operator_kml_source(path_value, text_value)
    parsed = extract_named_polygon_from_kml(text, placemark_name)
    payload: dict[str, Any] = {
        "source": "operator_kml",
        "name": placemark_name,
        "artifact": artifact,
        "warnings": parsed["warnings"],
        "wgs84Polygon": parsed["polygon"],
        "imagePolygon": None,
        "projectedPolygon": None,
        "calibration": None,
    }
    if parsed["polygon"] is None:
        return payload

    if project_reference is None:
        payload["warnings"].append("Operator boundary was parsed but cannot be aligned without --project-reference.")
        return payload
    if overlay_circle is None:
        payload["warnings"].append("Operator boundary was parsed but cannot be rasterized without visible overlay-circle calibration.")
        return payload

    transform = fit_wgs84_to_xy_from_reference(proof_kml_text, project_reference)
    if transform is None:
        payload["warnings"].append("Operator boundary was parsed but no WGS84-to-project-XY calibration could be fitted from proof KML and project reference.")
        return payload

    projected = [apply_affine_lonlat_to_xy(transform, point) for point in parsed["polygon"]]
    payload["projectedPolygon"] = projected
    payload["imagePolygon"] = project_xy_boundary_to_image(projected, overlay_circle, project_reference)
    payload["calibration"] = {
        "method": "affine_wgs84_to_project_xy_from_proof_field_boundary_and_overlay_circle",
        "projectCrs": project_reference["projectCrs"],
        "imageSpace": "map_canvas_pixels",
    }
    return payload


def load_operator_truth_labels(
    path_value: str | None,
    text_value: str | None,
    proof_kml_text: str,
    project_reference: dict[str, Any] | None,
    overlay_circle: dict[str, Any] | None,
) -> dict[str, Any]:
    text, artifact = read_operator_kml_source(path_value, text_value)
    labels: dict[str, Any] = {"source": "operator_kml", "artifact": artifact, "warnings": []}
    center = extract_named_point_from_kml(text, TRUTH_LABEL_NAMES["truePivotCenter"])
    labels["truePivotCenter"] = truth_point_payload(center, proof_kml_text, project_reference, overlay_circle)
    for key in ["targetFieldBoundary", "southRoadExclusion", "seBuildingTreeExclusion"]:
        parsed = extract_named_polygon_from_kml(text, TRUTH_LABEL_NAMES[key])
        payload = {
            "source": "operator_kml",
            "name": TRUTH_LABEL_NAMES[key],
            "warnings": parsed["warnings"],
            "wgs84Polygon": parsed["polygon"],
            "imagePolygon": None,
            "projectedPolygon": None,
            "calibration": None,
        }
        if parsed["polygon"] is not None and project_reference is not None and overlay_circle is not None:
            transform = fit_wgs84_to_xy_from_reference(proof_kml_text, project_reference)
            if transform is not None:
                payload["projectedPolygon"] = [apply_affine_lonlat_to_xy(transform, point) for point in parsed["polygon"]]
                payload["imagePolygon"] = project_xy_boundary_to_image(payload["projectedPolygon"], overlay_circle, project_reference)
                payload["calibration"] = {
                    "method": "fixed_operator_truth_label_affine_wgs84_to_project_xy",
                    "projectCrs": project_reference["projectCrs"],
                    "imageSpace": "map_canvas_pixels",
                }
            else:
                payload["warnings"].append("Fixed operator label parsed but no WGS84-to-project-XY calibration could be fitted.")
        elif parsed["polygon"] is not None:
            payload["warnings"].append("Fixed operator label parsed but cannot be rasterized without --project-reference and visible overlay-circle calibration.")
        labels[key] = payload
        labels["warnings"].extend(payload["warnings"])
    labels["warnings"].extend(center["warnings"])
    return labels


def truth_labels_from_operator_boundary(operator_field_boundary: dict[str, Any] | None) -> dict[str, Any] | None:
    if operator_field_boundary is None:
        return None
    return {
        "source": operator_field_boundary.get("source", "operator_kml"),
        "artifact": operator_field_boundary.get("artifact"),
        "warnings": operator_field_boundary.get("warnings", []),
        "targetFieldBoundary": operator_field_boundary,
    }


def truth_point_payload(
    parsed: dict[str, Any],
    proof_kml_text: str,
    project_reference: dict[str, Any] | None,
    overlay_circle: dict[str, Any] | None,
) -> dict[str, Any]:
    payload = {
        "source": "operator_kml",
        "name": TRUTH_LABEL_NAMES["truePivotCenter"],
        "warnings": parsed["warnings"],
        "wgs84Point": parsed["point"],
        "imagePoint": None,
        "projectedPoint": None,
        "calibration": None,
    }
    if parsed["point"] is None:
        return payload
    if project_reference is None or overlay_circle is None:
        payload["warnings"].append("TRUE_PIVOT_CENTER parsed but cannot be rasterized without --project-reference and visible overlay-circle calibration.")
        return payload
    transform = fit_wgs84_to_xy_from_reference(proof_kml_text, project_reference)
    if transform is None:
        payload["warnings"].append("TRUE_PIVOT_CENTER parsed but no WGS84-to-project-XY calibration could be fitted.")
        return payload
    projected = apply_affine_lonlat_to_xy(transform, parsed["point"])
    payload["projectedPoint"] = projected
    payload["imagePoint"] = project_xy_point_to_image(projected, overlay_circle, project_reference)
    payload["calibration"] = {
        "method": "fixed_operator_truth_label_affine_wgs84_to_project_xy",
        "projectCrs": project_reference["projectCrs"],
        "imageSpace": "map_canvas_pixels",
    }
    return payload


def read_operator_kml_source(path_value: str | None, text_value: str | None) -> tuple[str, dict[str, Any]]:
    if path_value and text_value:
        raise SystemExit("Use only one operator boundary source: --operator-boundary-kml or --operator-boundary-kml-text.")
    if text_value is not None:
        return text_value, text_artifact_inventory("operatorBoundaryKmlText", text_value)
    if path_value == "-":
        text = sys.stdin.read()
        if not text.strip():
            raise SystemExit("No operator KML text was provided on stdin.")
        return text, text_artifact_inventory("stdin", text)
    if path_value:
        path = Path(path_value)
        return read_kml_or_kmz_text(path), artifact_inventory(path, require_doc_kml=False)
    raise SystemExit("Operator boundary source is missing.")


def text_artifact_inventory(source: str, text: str) -> dict[str, Any]:
    encoded = text.encode("utf-8")
    return {
        "source": source,
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "byteLength": len(encoded),
        "kml": {
            "lookAtCount": text.count("<LookAt"),
            "styleCount": text.count("<Style"),
            "styleUrlCount": text.count("<styleUrl>"),
            "extendedDataCount": text.count("<ExtendedData"),
            "placemarkCount": text.count("<Placemark"),
            "hasRemoteIconHref": has_remote_icon_href(text),
        },
    }


def read_kml_or_kmz_text(path: Path) -> str:
    if not path.exists():
        raise SystemExit(f"Operator boundary KML/KMZ does not exist: {path}")
    suffix = path.suffix.lower()
    if suffix == ".kml":
        return path.read_text(encoding="utf-8-sig")
    if suffix == ".kmz":
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            kml_name = "doc.kml" if "doc.kml" in names else next((name for name in names if name.lower().endswith(".kml")), None)
            if kml_name is None:
                raise SystemExit(f"Operator KMZ contains no KML document: {path}")
            return archive.read(kml_name).decode("utf-8-sig")
    raise SystemExit(f"Operator boundary artifact must be .kml or .kmz: {path}")


def extract_named_polygon_from_kml(kml_text: str, placemark_name: str) -> dict[str, Any]:
    warnings = []
    try:
        root = ElementTree.fromstring(kml_text)
    except ElementTree.ParseError as exc:
        return {"polygon": None, "warnings": [f"Operator boundary KML could not be parsed: {exc}."]}
    matches = []
    for placemark in root.findall(".//{*}Placemark"):
        name = placemark.findtext("{*}name")
        if (name or "").strip() != placemark_name:
            continue
        polygons = placemark.findall(".//{*}Polygon")
        if len(polygons) != 1:
            warnings.append(f'Placemark "{placemark_name}" must contain exactly one Polygon; found {len(polygons)}.')
            continue
        ring_text = polygons[0].findtext(".//{*}outerBoundaryIs/{*}LinearRing/{*}coordinates")
        ring = parse_kml_coordinates(ring_text or "")
        if len(ring) < 3:
            warnings.append(f'Placemark "{placemark_name}" polygon has too few coordinates.')
            continue
        if not lonlat_points_equal(ring[0], ring[-1]):
            warnings.append(f'Placemark "{placemark_name}" polygon outer ring is not closed.')
            continue
        if len(ring) < 4:
            warnings.append(f'Placemark "{placemark_name}" polygon has too few coordinates.')
            continue
        open_ring = ring[:-1]
        if abs(lonlat_polygon_area(open_ring)) <= 0:
            warnings.append(f'Placemark "{placemark_name}" polygon outer ring has invalid zero area.')
            continue
        matches.append(open_ring)
    if len(matches) == 1:
        return {"polygon": matches[0], "warnings": warnings}
    if len(matches) > 1:
        warnings.append(f'Expected one Placemark named "{placemark_name}" but found {len(matches)} valid matching Polygons.')
    else:
        warnings.append(f'No valid Polygon Placemark named "{placemark_name}" was found.')
    return {"polygon": None, "warnings": warnings}


def extract_named_point_from_kml(kml_text: str, placemark_name: str) -> dict[str, Any]:
    warnings = []
    try:
        root = ElementTree.fromstring(kml_text)
    except ElementTree.ParseError as exc:
        return {"point": None, "warnings": [f"Operator label KML could not be parsed: {exc}."]}
    matches = []
    for placemark in root.findall(".//{*}Placemark"):
        name = placemark.findtext("{*}name")
        if (name or "").strip() != placemark_name:
            continue
        points = placemark.findall(".//{*}Point")
        if len(points) != 1:
            warnings.append(f'Placemark "{placemark_name}" must contain exactly one Point; found {len(points)}.')
            continue
        coordinates = parse_kml_coordinates(points[0].findtext(".//{*}coordinates") or "")
        if len(coordinates) != 1:
            warnings.append(f'Placemark "{placemark_name}" point must contain exactly one coordinate; found {len(coordinates)}.')
            continue
        matches.append(coordinates[0])
    if len(matches) == 1:
        return {"point": matches[0], "warnings": warnings}
    if len(matches) > 1:
        warnings.append(f'Expected one Placemark named "{placemark_name}" but found {len(matches)} valid matching Points.')
    else:
        warnings.append(f'No valid Point Placemark named "{placemark_name}" was found.')
    return {"point": None, "warnings": warnings}


def parse_kml_coordinates(text: str) -> list[dict[str, float]]:
    points = []
    for token in text.split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        try:
            longitude = float(parts[0])
            latitude = float(parts[1])
        except ValueError:
            continue
        if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
            continue
        points.append({"longitude": longitude, "latitude": latitude})
    return points


def lonlat_points_equal(a: dict[str, float], b: dict[str, float]) -> bool:
    return abs(a["longitude"] - b["longitude"]) <= 1e-10 and abs(a["latitude"] - b["latitude"]) <= 1e-10


def lonlat_polygon_area(points: list[dict[str, float]]) -> float:
    area = 0.0
    for index, current in enumerate(points):
        next_point = points[(index + 1) % len(points)]
        area += current["longitude"] * next_point["latitude"] - next_point["longitude"] * current["latitude"]
    return area / 2.0


def fit_wgs84_to_xy_from_reference(kml_text: str, project_reference: dict[str, Any]) -> dict[str, Any] | None:
    parsed = extract_named_polygon_from_kml(kml_text, "Field boundary")
    kml_ring = parsed["polygon"]
    xy_ring = project_reference.get("fieldBoundary")
    if not isinstance(kml_ring, list) or not isinstance(xy_ring, list) or len(kml_ring) != len(xy_ring) or len(kml_ring) < 3:
        return None
    try:
        import numpy as np  # type: ignore
    except Exception:
        return None
    source_rows = []
    target_x = []
    target_y = []
    for lonlat, xy in zip(kml_ring, xy_ring):
        source_rows.append([float(lonlat["longitude"]), float(lonlat["latitude"]), 1.0])
        target_x.append(float(xy["x"]))
        target_y.append(float(xy["y"]))
    matrix = np.array(source_rows, dtype=np.float64)
    coeff_x, *_ = np.linalg.lstsq(matrix, np.array(target_x, dtype=np.float64), rcond=None)
    coeff_y, *_ = np.linalg.lstsq(matrix, np.array(target_y, dtype=np.float64), rcond=None)
    return {"x": [float(value) for value in coeff_x], "y": [float(value) for value in coeff_y]}


def apply_affine_lonlat_to_xy(transform: dict[str, Any], point: dict[str, float]) -> dict[str, float]:
    longitude = float(point["longitude"])
    latitude = float(point["latitude"])
    coeff_x = transform["x"]
    coeff_y = transform["y"]
    return {
        "x": round(coeff_x[0] * longitude + coeff_x[1] * latitude + coeff_x[2], 3),
        "y": round(coeff_y[0] * longitude + coeff_y[1] * latitude + coeff_y[2], 3),
    }


def closed_ring_coordinates(points: list[dict[str, Any]]) -> list[list[float]]:
    coordinates = [[float(point["x"]), float(point["y"])] for point in points]
    if coordinates and coordinates[0] != coordinates[-1]:
        coordinates.append([coordinates[0][0], coordinates[0][1]])
    return coordinates


def import_cv2() -> Any:
    try:
        import cv2  # type: ignore
    except Exception as exc:
        raise SystemExit(
            "OpenCV is required for design-vision-review. Install opencv-python-headless in the local companion environment."
        ) from exc
    if not hasattr(cv2, "HoughCircles"):
        raise SystemExit("Installed OpenCV build does not expose HoughCircles; cannot run design-vision-review.")
    return cv2


def artifact_inventory(path: Path, require_doc_kml: bool = True) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Required artifact does not exist: {path}")
    payload: dict[str, Any] = {
        "path": str(path),
        "sha256": sha256_file(path),
        "byteLength": path.stat().st_size,
    }
    if path.suffix.lower() == ".kml":
        text = path.read_text(encoding="utf-8")
        payload["kml"] = {
            "lookAtCount": text.count("<LookAt"),
            "styleCount": text.count("<Style"),
            "styleUrlCount": text.count("<styleUrl>"),
            "extendedDataCount": text.count("<ExtendedData"),
            "placemarkCount": text.count("<Placemark"),
            "hasRemoteIconHref": has_remote_icon_href(text),
        }
    if path.suffix.lower() == ".kmz":
        with zipfile.ZipFile(path) as archive:
            entries = archive.namelist()
            if require_doc_kml and "doc.kml" not in entries:
                raise SystemExit(f"KMZ artifact must contain doc.kml: {path}")
            kml_entry = "doc.kml" if "doc.kml" in entries else next((entry for entry in entries if entry.lower().endswith(".kml")), None)
            if kml_entry is None:
                raise SystemExit(f"KMZ artifact must contain a KML document: {path}")
            text = archive.read(kml_entry).decode("utf-8")
        payload["kmz"] = {
            "entries": entries,
            "primaryKmlEntry": kml_entry,
            "lookAtCount": text.count("<LookAt"),
            "styleCount": text.count("<Style"),
            "styleUrlCount": text.count("<styleUrl>"),
            "extendedDataCount": text.count("<ExtendedData"),
            "placemarkCount": text.count("<Placemark"),
            "hasRemoteIconHref": has_remote_icon_href(text),
        }
    return payload


def has_remote_icon_href(kml_text: str) -> bool:
    return re.search(r"<href>\s*https?://", kml_text, flags=re.IGNORECASE) is not None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json_with_bom(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def verify_manifest_linkage(manifest: dict[str, Any], artifacts: dict[str, dict[str, Any]]) -> None:
    captures = {
        capture.get("filename"): capture
        for capture in manifest.get("captures", [])
        if isinstance(capture, dict)
    }
    for artifact_name in ["fullWindowScreenshot", "mapCanvasCrop"]:
        filename = Path(artifacts[artifact_name]["path"]).name
        capture = captures.get(filename)
        if capture is None:
            raise SystemExit(f"Manifest does not reference required screenshot: {filename}")
        if capture.get("sha256") and capture.get("sha256") != artifacts[artifact_name]["sha256"]:
            raise SystemExit(f"Manifest SHA-256 mismatch for screenshot: {filename}")

    opened_sha = manifest.get("artifacts", {}).get("sha256", {}).get("openedArtifact")
    if opened_sha and opened_sha != artifacts["kml"]["sha256"] and opened_sha != artifacts["kmz"]["sha256"]:
        raise SystemExit("Manifest openedArtifact SHA-256 does not match the supplied KML or KMZ.")


def detect_pivot_crop_ring(cv: Any, image: Any) -> dict[str, Any] | None:
    gray = cv.cvtColor(image, cv.COLOR_BGR2GRAY)
    blurred = cv.medianBlur(gray, 7)
    height, width = gray.shape[:2]
    min_dimension = min(width, height)
    circles = cv.HoughCircles(
        blurred,
        cv.HOUGH_GRADIENT,
        dp=1.3,
        minDist=max(80, min(width, height) // 4),
        param1=80,
        param2=28,
        minRadius=max(30, min(width, height) // 12),
        maxRadius=max(60, int(min_dimension * 0.68)),
    )
    if circles is None:
        return None
    candidates = []
    for raw_circle in circles[0, :12]:
        x, y, radius = [float(value) for value in raw_circle]
        if radius <= 0:
            continue
        centeredness = 1 - min(1, math.hypot(x - width / 2, y - height / 2) / max(width, height))
        size_score = min(1, radius / max(1, min_dimension * 0.55))
        candidates.append((centeredness * 1.2 + size_score * 0.8, x, y, radius))
    if not candidates:
        return None
    _, x, y, radius = sorted(candidates, reverse=True)[0]
    return circle_payload(x, y, radius, 0.72)


def detect_overlay_circle(cv: Any, image: Any, pivot_crop_ring: dict[str, Any] | None) -> dict[str, Any] | None:
    mask = overlay_mask(cv, image)
    if pivot_crop_ring is not None:
        expected_radius = float(pivot_crop_ring["radius"])
        circles = cv.HoughCircles(
            cv.medianBlur(mask, 5),
            cv.HOUGH_GRADIENT,
            dp=1.2,
            minDist=max(80, int(expected_radius * 0.6)),
            param1=60,
            param2=12,
            minRadius=max(15, int(expected_radius * 0.55)),
            maxRadius=max(20, int(expected_radius * 1.25)),
        )
        if circles is not None:
            field_x = float(pivot_crop_ring["center"]["x"])
            field_y = float(pivot_crop_ring["center"]["y"])
            candidates = []
            for raw_circle in circles[0, :10]:
                x, y, radius = [float(value) for value in raw_circle]
                center_score = 1 - min(1, math.hypot(x - field_x, y - field_y) / max(expected_radius, 1))
                radius_score = 1 - min(1, abs(radius - expected_radius) / max(expected_radius, 1))
                candidates.append((center_score + radius_score, x, y, radius))
            if candidates:
                _, x, y, radius = sorted(candidates, reverse=True)[0]
                return circle_payload(x, y, radius, 0.68)

    contours, _ = cv.findContours(mask, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    best = None
    for contour in contours:
        area = float(cv.contourArea(contour))
        if area < 80:
            continue
        (x, y), radius = cv.minEnclosingCircle(contour)
        if radius <= 15:
            continue
        if pivot_crop_ring is not None:
            field_radius = float(pivot_crop_ring["radius"])
            if radius < field_radius * 0.4 or radius > field_radius * 1.35:
                continue
        perimeter = float(cv.arcLength(contour, True))
        circularity = 0 if perimeter <= 0 else min(1, 4 * math.pi * area / (perimeter * perimeter))
        score = radius * 0.01 + circularity
        if best is None or score > best[0]:
            best = (score, float(x), float(y), float(radius), circularity)
    if best is None:
        return None
    _, x, y, radius, circularity = best
    return circle_payload(x, y, radius, max(0.35, min(0.9, circularity)))




def load_sam2_adapter(boundary_detector_status: dict[str, Any] | None) -> Any | None:
    # Legacy image-only calls do not supply a model revision, asset hashes,
    # prompt points/labels, or an output root. Never infer those inputs.
    return None


def detect_imagery_field_boundary(
    cv: Any,
    image: Any,
    pivot_crop_ring: dict[str, Any] | None,
    sam2_adapter: Any | None = None,
    operator_image_polygon: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    height, width = image.shape[:2]
    overlay = overlay_mask(cv, image)
    gray = cv.cvtColor(image, cv.COLOR_BGR2GRAY)
    gray = cv.inpaint(gray, cv.dilate(overlay, None, iterations=2), 3, cv.INPAINT_TELEA)
    blurred = cv.GaussianBlur(gray, (5, 5), 0)
    edges = cv.Canny(blurred, 55, 145)

    candidates: list[dict[str, Any]] = []
    candidates.extend(sam2_boundary_candidates(cv, sam2_adapter, image, overlay, width, height))
    for hough_candidate in hough_boundary_candidates(cv, edges, width, height, pivot_crop_ring):
        candidates.append({
            "source": "opencv",
            "method": hough_candidate["method"],
            "polygon": hough_candidate["polygon"],
            "candidateWarnings": hough_candidate.get("warnings", []),
        })
    contour_candidate = field_boundary_from_contours(cv, edges, width, height, pivot_crop_ring)
    if contour_candidate is not None:
        candidates.append({
            "source": "opencv",
            "method": "contour_field_separation_edges",
            "polygon": contour_candidate,
        })
    candidates.extend(surface_feature_boundary_candidates(cv, image, edges, width, height, pivot_crop_ring, "default_surface_feature_pass"))
    candidates.extend(irregular_edge_boundary_candidates(cv, edges, width, height, pivot_crop_ring, "default_irregular_edge_pass"))
    if not candidates:
        return None

    scored = [
        score_boundary_candidate(cv, edges, candidate, width, height, pivot_crop_ring, operator_image_polygon)
        for candidate in candidates
    ]
    scored = sorted(scored, key=lambda item: item["confidence"], reverse=True)
    accepted = next((candidate for candidate in scored if not candidate["rejected"] and candidate["confidence"] >= DEFAULT_VISION_THRESHOLDS["minFieldBoundaryConfidence"]), None)
    if accepted is None:
        rejected = scored[0]
        rejected["rejected"] = True
        if not rejected["rejectionReasons"]:
            rejected["rejectionReasons"] = ["candidate confidence is below accepted imagery-derived boundary threshold"]
        rejected["candidateMasks"] = [candidate_audit_summary(candidate) for candidate in scored]
        return rejected
    accepted["candidateMasks"] = [candidate_audit_summary(candidate) for candidate in scored]
    return accepted


def sam2_boundary_candidates(cv: Any, sam2_adapter: Any | None, image: Any, overlay: Any, width: int, height: int) -> list[dict[str, Any]]:
    if sam2_adapter is None or not hasattr(sam2_adapter, "propose_masks"):
        return []
    candidates = []
    for index, mask in enumerate(sam2_adapter.propose_masks(image)):
        clean_mask = cv.bitwise_and(mask, cv.bitwise_not(overlay))
        contours, _ = cv.findContours(clean_mask, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
        for contour in contours[:12]:
            area = float(cv.contourArea(contour))
            if area / max(1, width * height) < 0.03:
                continue
            perimeter = float(cv.arcLength(contour, True))
            if perimeter <= 0:
                continue
            approx = cv.approxPolyDP(contour, 0.025 * perimeter, True)
            if len(approx) < 4:
                continue
            candidates.append({
                "source": "sam2",
                "method": f"sam2_mask_{index}",
                "polygon": clamp_image_polygon([{"x": float(point[0][0]), "y": float(point[0][1])} for point in approx], width, height),
            })
    return candidates


def score_boundary_candidate(
    cv: Any,
    edges: Any,
    candidate: dict[str, Any],
    width: int,
    height: int,
    pivot_crop_ring: dict[str, Any] | None,
    operator_image_polygon: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    polygon = candidate["polygon"]
    circularity = image_polygon_circularity(polygon)
    rectilinearity = polygon_rectilinearity(polygon)
    area_ratio = abs(image_polygon_area(polygon)) / max(1, width * height)
    edge_alignment = polygon_edge_alignment(cv, edges, polygon)
    operator_alignment = image_polygon_iou(cv, width, height, operator_image_polygon, polygon) if operator_image_polygon is not None else None
    operator_metrics = operator_comparison_metrics(cv, edges, operator_image_polygon, polygon) if operator_image_polygon is not None else None
    containment = pivot_containment_score(polygon, pivot_crop_ring)
    rejection_reasons = []
    if len(polygon) < 4:
        rejection_reasons.append("candidate has fewer than four polygon vertices")
    if area_ratio < 0.04:
        rejection_reasons.append("candidate covers too little of the proof image")
    if circularity > 0.86:
        rejection_reasons.append("candidate resembles a circular crop or pivot coverage ring")
    if containment <= 0:
        rejection_reasons.append("candidate does not contain the visible pivot center")
    if looks_like_extent_box(polygon, width, height, pivot_crop_ring):
        rejection_reasons.append("candidate resembles an extent box around the pivot ring rather than imagery edges")
    if looks_like_screenshot_extent_box(polygon, width, height):
        rejection_reasons.append("candidate resembles the screenshot extent rather than the target field boundary")
    if operator_image_polygon is not None and looks_like_axis_aligned_rectangle(polygon):
        rejection_reasons.append("candidate is a 4-point axis-aligned rectangle and does not preserve irregular south/southeast TARGET_FIELD_BOUNDARY features")
    if edge_alignment < DEFAULT_VISION_THRESHOLDS["minBoundaryEdgeAlignment"]:
        rejection_reasons.append("candidate lacks edge support along road, fenceline, or treeline cues")
    if operator_metrics is not None:
        if operator_metrics["falsePositiveAreaRatio"] > DEFAULT_VISION_THRESHOLDS["maxBoundaryFalsePositiveRatio"]:
            rejection_reasons.append("candidate includes too much area outside the operator TARGET_FIELD_BOUNDARY label")
        if operator_metrics["boundaryMeanDistancePixels"] is not None and operator_metrics["boundaryMeanDistancePixels"] > DEFAULT_VISION_THRESHOLDS["maxBoundaryMeanDistancePx"]:
            rejection_reasons.append("candidate boundary is too far from the operator TARGET_FIELD_BOUNDARY label")
    for warning in candidate.get("candidateWarnings", []):
        rejection_reasons.append(warning)
    confidence = (
        0.1
        + edge_alignment * 0.28
        + rectilinearity * 0.22
        + (1 - min(1.0, circularity)) * 0.18
        + min(0.18, area_ratio)
        + containment * 0.14
    )
    if operator_alignment is not None:
        confidence += max(-0.1, min(0.12, (operator_alignment - 0.45) * 0.2))
    if candidate["source"] == "sam2":
        confidence += 0.06
    if rejection_reasons:
        confidence = min(confidence, 0.3)
    return {
        "source": candidate["source"],
        "imagePolygon": image_polygon_payload(polygon),
        "confidence": round(max(0.0, min(0.92, confidence)), 3),
        "cues": [candidate["method"]],
        "edgeAlignment": round(edge_alignment, 4),
        "rectilinearity": round(rectilinearity, 4),
        "circularity": round(circularity, 4),
        "containment": round(containment, 4),
        "operatorLabelAlignment": round(operator_alignment, 4) if operator_alignment is not None else None,
        "operatorFalsePositiveAreaRatio": operator_metrics["falsePositiveAreaRatio"] if operator_metrics is not None else None,
        "operatorBoundaryMeanDistancePixels": operator_metrics["boundaryMeanDistancePixels"] if operator_metrics is not None else None,
        "areaRatio": round(area_ratio, 4),
        "rejected": bool(rejection_reasons),
        "rejectionReasons": rejection_reasons,
    }


def candidate_audit_summary(candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": candidate["source"],
        "cues": candidate["cues"],
        "confidence": candidate["confidence"],
        "rejected": candidate["rejected"],
        "rejectionReasons": candidate["rejectionReasons"],
        "edgeAlignment": candidate["edgeAlignment"],
        "rectilinearity": candidate["rectilinearity"],
        "circularity": candidate["circularity"],
        "containment": candidate["containment"],
        "operatorLabelAlignment": candidate.get("operatorLabelAlignment"),
        "operatorFalsePositiveAreaRatio": candidate.get("operatorFalsePositiveAreaRatio"),
        "operatorBoundaryMeanDistancePixels": candidate.get("operatorBoundaryMeanDistancePixels"),
        "areaRatio": candidate["areaRatio"],
        "vertexCount": len(candidate["imagePolygon"]),
        "imagePolygon": candidate["imagePolygon"],
    }


def field_boundary_from_hough_lines(lines: Any, width: int, height: int, pivot_crop_ring: dict[str, Any] | None) -> list[dict[str, float]] | None:
    candidates = hough_boundary_candidates_from_lines(lines, width, height, pivot_crop_ring, allow_partial=False)
    return candidates[0]["polygon"] if candidates else None


def hough_boundary_candidates(cv: Any, edges: Any, width: int, height: int, pivot_crop_ring: dict[str, Any] | None) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    seen = set()
    min_dimension = min(width, height)
    for threshold, min_line_length, max_line_gap in [
        (max(70, min_dimension // 4), max(90, min_dimension // 6), 24),
        (max(55, min_dimension // 6), max(70, min_dimension // 8), 36),
        (max(45, min_dimension // 8), max(60, min_dimension // 10), 48),
        (80, 80, 80),
    ]:
        lines = cv.HoughLinesP(
            edges,
            1,
            math.pi / 180,
            threshold=threshold,
            minLineLength=min_line_length,
            maxLineGap=max_line_gap,
        )
        for candidate in hough_boundary_candidates_from_lines(lines, width, height, pivot_crop_ring, allow_partial=True):
            key = tuple((round(point["x"] / 8), round(point["y"] / 8)) for point in candidate["polygon"])
            if key in seen:
                continue
            seen.add(key)
            candidate["method"] = f"{candidate['method']}_threshold_{threshold}_minline_{min_line_length}"
            candidates.append(candidate)
    return candidates


def hough_boundary_candidates_from_lines(
    lines: Any,
    width: int,
    height: int,
    pivot_crop_ring: dict[str, Any] | None,
    allow_partial: bool,
) -> list[dict[str, Any]]:
    if lines is None:
        return []
    center_x = width / 2
    center_y = height / 2
    minimum_half_width = width * 0.18
    minimum_half_height = height * 0.18
    if pivot_crop_ring is not None:
        center_x = float(pivot_crop_ring["center"]["x"])
        center_y = float(pivot_crop_ring["center"]["y"])
        minimum_half_width = max(minimum_half_width, float(pivot_crop_ring["radius"]) * 0.72)
        minimum_half_height = max(minimum_half_height, float(pivot_crop_ring["radius"]) * 0.72)

    verticals: list[tuple[float, float]] = []
    horizontals: list[tuple[float, float]] = []
    for raw in lines[:, 0, :]:
        x1, y1, x2, y2 = [float(value) for value in raw]
        dx = x2 - x1
        dy = y2 - y1
        length = math.hypot(dx, dy)
        if length < max(width, height) * 0.08:
            continue
        if abs(dx) <= abs(dy) * 0.35:
            verticals.append(((x1 + x2) / 2, length))
        elif abs(dy) <= abs(dx) * 0.35:
            horizontals.append(((y1 + y2) / 2, length))

    left = weighted_line_position([line for line in verticals if line[0] < center_x - minimum_half_width])
    right = weighted_line_position([line for line in verticals if line[0] > center_x + minimum_half_width])
    top = weighted_line_position([line for line in horizontals if line[0] < center_y - minimum_half_height])
    bottom = weighted_line_position([line for line in horizontals if line[0] > center_y + minimum_half_height])
    candidates = []
    if left is not None and right is not None and top is not None and bottom is not None and right - left >= width * 0.25 and bottom - top >= height * 0.25:
        warnings = []
        if top <= height * 0.04 or left <= width * 0.02 or right >= width * 0.98 or bottom >= height * 0.98:
            warnings.append("candidate is clipped by the screenshot edge and cannot be accepted as a complete imagery field boundary")
        candidates.append({
            "method": "hough_road_fenceline_field_separation_edges",
            "polygon": clamp_image_polygon([
                {"x": left, "y": top},
                {"x": right, "y": top},
                {"x": right, "y": bottom},
                {"x": left, "y": bottom},
            ], width, height),
            "warnings": warnings,
        })
    if not allow_partial or left is None or right is None or bottom is None:
        return candidates
    if right - left < width * 0.25 or bottom < center_y + minimum_half_height:
        return candidates
    top_edge = 1.0
    candidates.append({
        "method": "partial_hough_visible_field_extent_edges",
        "polygon": clamp_image_polygon([
            {"x": left, "y": top_edge},
            {"x": right, "y": top_edge},
            {"x": right, "y": bottom},
            {"x": left, "y": bottom},
        ], width, height),
        "warnings": ["candidate is clipped by the screenshot edge and cannot be accepted as a complete imagery field boundary"],
    })
    return candidates


def weighted_line_position(candidates: list[tuple[float, float]]) -> float | None:
    if not candidates:
        return None
    candidates = sorted(candidates, key=lambda item: item[1], reverse=True)[:8]
    total_weight = sum(weight for _, weight in candidates)
    if total_weight <= 0:
        return None
    return sum(position * weight for position, weight in candidates) / total_weight


def field_boundary_from_contours(cv: Any, edges: Any, width: int, height: int, pivot_crop_ring: dict[str, Any] | None) -> list[dict[str, float]] | None:
    closed = cv.morphologyEx(edges, cv.MORPH_CLOSE, cv.getStructuringElement(cv.MORPH_RECT, (11, 11)), iterations=1)
    contours, _ = cv.findContours(closed, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    best = None
    center = None
    if pivot_crop_ring is not None:
        center = (float(pivot_crop_ring["center"]["x"]), float(pivot_crop_ring["center"]["y"]))
    for contour in contours:
        area = float(cv.contourArea(contour))
        area_ratio = area / max(1, width * height)
        if area_ratio < 0.04:
            continue
        perimeter = float(cv.arcLength(contour, True))
        if perimeter <= 0:
            continue
        epsilon = 0.035 * perimeter
        approx = cv.approxPolyDP(contour, epsilon, True)
        if len(approx) < 4 or len(approx) > 10:
            continue
        polygon = [{"x": float(point[0][0]), "y": float(point[0][1])} for point in approx]
        if center is not None and not image_point_in_polygon({"x": center[0], "y": center[1]}, polygon):
            continue
        circularity = image_polygon_circularity(polygon)
        rectilinearity = polygon_rectilinearity(polygon)
        if circularity > 0.9:
            continue
        score = area_ratio + rectilinearity * 0.5
        if best is None or score > best[0]:
            best = (score, polygon)
    return None if best is None else clamp_image_polygon(best[1], width, height)


def polygon_edge_alignment(cv: Any, edges: Any, polygon: list[dict[str, float]]) -> float:
    import numpy as np  # type: ignore

    samples = []
    for index, current in enumerate(polygon):
        next_point = polygon[(index + 1) % len(polygon)]
        x1 = float(current["x"])
        y1 = float(current["y"])
        x2 = float(next_point["x"])
        y2 = float(next_point["y"])
        steps = max(2, int(math.hypot(x2 - x1, y2 - y1) / 8))
        for step in range(steps + 1):
            ratio = step / steps
            samples.append((round(x1 + (x2 - x1) * ratio), round(y1 + (y2 - y1) * ratio)))
    if not samples:
        return 0.0
    height, width = edges.shape[:2]
    dilated = cv.dilate(edges, np.ones((5, 5), dtype=np.uint8), iterations=1)
    hits = 0
    for x, y in samples:
        if 0 <= x < width and 0 <= y < height and int(dilated[int(y), int(x)]) > 0:
            hits += 1
    return hits / len(samples)


def image_polygon_iou(cv: Any, width: int, height: int, a: list[dict[str, Any]] | None, b: list[dict[str, Any]]) -> float:
    if not a:
        return 0.0
    import numpy as np  # type: ignore

    mask_a = polygon_mask(cv, np, width, height, a)
    mask_b = polygon_mask(cv, np, width, height, b)
    intersection = int(cv.countNonZero(cv.bitwise_and(mask_a, mask_b)))
    union = int(cv.countNonZero(cv.bitwise_or(mask_a, mask_b)))
    return intersection / union if union else 0.0


def pivot_containment_score(polygon: list[dict[str, float]], pivot_crop_ring: dict[str, Any] | None) -> float:
    if pivot_crop_ring is None:
        return 0.5
    center = {"x": float(pivot_crop_ring["center"]["x"]), "y": float(pivot_crop_ring["center"]["y"])}
    return 1.0 if image_point_in_polygon(center, polygon) else 0.0


def looks_like_extent_box(polygon: list[dict[str, float]], width: int, height: int, pivot_crop_ring: dict[str, Any] | None) -> bool:
    if pivot_crop_ring is None or len(polygon) != 4:
        return False
    xs = [float(point["x"]) for point in polygon]
    ys = [float(point["y"]) for point in polygon]
    left, right = min(xs), max(xs)
    top, bottom = min(ys), max(ys)
    if left <= 1 or top <= 1 or right >= width - 2 or bottom >= height - 2:
        return False
    center = pivot_crop_ring["center"]
    radius = float(pivot_crop_ring["radius"])
    expected_left = float(center["x"]) - radius
    expected_right = float(center["x"]) + radius
    expected_top = float(center["y"]) - radius
    expected_bottom = float(center["y"]) + radius
    tolerance = max(8.0, radius * 0.12)
    return (
        abs(left - expected_left) <= tolerance
        and abs(right - expected_right) <= tolerance
        and abs(top - expected_top) <= tolerance
        and abs(bottom - expected_bottom) <= tolerance
    )


def looks_like_screenshot_extent_box(polygon: list[dict[str, float]], width: int, height: int) -> bool:
    if len(polygon) != 4:
        return False
    xs = [float(point["x"]) for point in polygon]
    ys = [float(point["y"]) for point in polygon]
    left, right = min(xs), max(xs)
    top, bottom = min(ys), max(ys)
    return left <= width * 0.03 and top <= height * 0.03 and right >= width * 0.97 and bottom >= height * 0.97


def looks_like_axis_aligned_rectangle(polygon: list[dict[str, float]]) -> bool:
    if len(polygon) != 4:
        return False
    xs = {round(float(point["x"]), 3) for point in polygon}
    ys = {round(float(point["y"]), 3) for point in polygon}
    if len(xs) != 2 or len(ys) != 2:
        return False
    corners = {(x, y) for x in xs for y in ys}
    points = {(round(float(point["x"]), 3), round(float(point["y"]), 3)) for point in polygon}
    return points == corners


def detect_overlay_linework(cv: Any, image: Any) -> bool:
    mask = overlay_mask(cv, image)
    return int(cv.countNonZero(mask)) > max(120, image.shape[0] * image.shape[1] * 0.00012)


def overlay_mask(cv: Any, image: Any) -> Any:
    hsv = cv.cvtColor(image, cv.COLOR_BGR2HSV)
    red1 = cv.inRange(hsv, (0, 70, 80), (12, 255, 255))
    red2 = cv.inRange(hsv, (168, 70, 80), (180, 255, 255))
    blue = cv.inRange(hsv, (88, 45, 75), (132, 255, 255))
    yellow = cv.inRange(hsv, (18, 55, 90), (42, 255, 255))
    green = cv.inRange(hsv, (45, 90, 170), (85, 255, 255))
    return cv.bitwise_or(cv.bitwise_or(red1, red2), cv.bitwise_or(cv.bitwise_or(blue, yellow), green))


def detect_attribution_cue(cv: Any, image: Any) -> dict[str, Any]:
    height, width = image.shape[:2]
    crop = image[int(height * 0.82):height, int(width * 0.45):width]
    gray = cv.cvtColor(crop, cv.COLOR_BGR2GRAY)
    edges = cv.Canny(gray, 80, 160)
    edge_ratio = int(cv.countNonZero(edges)) / max(1, edges.shape[0] * edges.shape[1])
    bright_ratio = int(cv.countNonZero(cv.inRange(gray, 185, 255))) / max(1, gray.shape[0] * gray.shape[1])
    present = edge_ratio > 0.008 and bright_ratio > 0.015
    return {
        "present": present,
        "method": "bottom-right full-window text/edge cue; manual visual confirmation remains required",
        "edgeRatio": round(edge_ratio, 5),
        "brightRatio": round(bright_ratio, 5),
    }


def circle_payload(x: float, y: float, radius: float, confidence: float) -> dict[str, Any]:
    return {
        "center": {"x": round(x, 2), "y": round(y, 2)},
        "radius": round(radius, 2),
        "confidence": round(confidence, 3),
    }


def project_image_boundary_to_xy(
    imagery_field_boundary: dict[str, Any] | None,
    overlay_circle: dict[str, Any] | None,
    project_reference: dict[str, Any] | None,
) -> list[dict[str, float]] | None:
    if imagery_field_boundary is None or imagery_field_boundary.get("rejected"):
        return None
    if float(imagery_field_boundary.get("confidence", 0)) < DEFAULT_VISION_THRESHOLDS["minFieldBoundaryConfidence"]:
        return None
    if overlay_circle is None or project_reference is None:
        return None
    radius_pixels = float(overlay_circle["radius"])
    if radius_pixels <= 0:
        return None
    wet_radius = machine_wet_radius(project_reference["machine"])
    scale = wet_radius / radius_pixels
    origin = project_reference["pivotCenter"]
    overlay_center = overlay_circle["center"]
    projected = []
    for point in imagery_field_boundary["imagePolygon"]:
        projected.append({
            "x": round(float(origin["x"]) + (float(point["x"]) - float(overlay_center["x"])) * scale, 3),
            "y": round(float(origin["y"]) - (float(point["y"]) - float(overlay_center["y"])) * scale, 3),
        })
    return projected


def project_xy_boundary_to_image(
    projected_polygon: list[dict[str, float]],
    overlay_circle: dict[str, Any],
    project_reference: dict[str, Any],
) -> list[dict[str, float]] | None:
    radius_pixels = float(overlay_circle["radius"])
    wet_radius = machine_wet_radius(project_reference["machine"])
    if radius_pixels <= 0 or wet_radius <= 0:
        return None
    scale = radius_pixels / wet_radius
    origin = project_reference["pivotCenter"]
    overlay_center = overlay_circle["center"]
    return [
        {
            "x": round(float(overlay_center["x"]) + (float(point["x"]) - float(origin["x"])) * scale, 2),
            "y": round(float(overlay_center["y"]) - (float(point["y"]) - float(origin["y"])) * scale, 2),
        }
        for point in projected_polygon
    ]


def project_xy_point_to_image(
    projected_point: dict[str, float],
    overlay_circle: dict[str, Any],
    project_reference: dict[str, Any],
) -> dict[str, float] | None:
    points = project_xy_boundary_to_image([projected_point], overlay_circle, project_reference)
    return points[0] if points else None


def compare_candidates_to_operator(
    cv: Any,
    image: Any,
    imagery_field_boundary: dict[str, Any] | None,
    operator_field_boundary: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if operator_field_boundary is None or not operator_field_boundary.get("imagePolygon"):
        return []
    operator_polygon = operator_field_boundary["imagePolygon"]
    candidates = []
    if imagery_field_boundary is not None:
        candidates.extend(imagery_field_boundary.get("candidateMasks", []))
        if imagery_field_boundary.get("imagePolygon") and not any(candidate.get("imagePolygon") == imagery_field_boundary["imagePolygon"] for candidate in candidates):
            candidates.append(candidate_audit_summary(imagery_field_boundary))
    comparisons = []
    for index, candidate in enumerate(candidates):
        polygon = candidate.get("imagePolygon")
        if not polygon:
            continue
        metrics = operator_comparison_metrics(cv, image, operator_polygon, polygon)
        comparisons.append({
            "candidateIndex": index,
            "source": candidate.get("source"),
            "cues": candidate.get("cues", []),
            "rejected": bool(candidate.get("rejected")),
            "candidateConfidence": candidate.get("confidence"),
            **metrics,
        })
    return sorted(comparisons, key=lambda item: (item["iou"], -item["boundaryMeanDistancePixels"]), reverse=True)


def build_obstruction_masks(cv: Any, image: Any, truth_labels: dict[str, Any] | None) -> dict[str, Any]:
    if truth_labels is None:
        return {"southRoad": None, "seBuildingTree": None, "available": False}
    height, width = image.shape[:2]
    import numpy as np  # type: ignore

    masks: dict[str, Any] = {"available": True}
    for output_key, label_key in [("southRoad", "southRoadExclusion"), ("seBuildingTree", "seBuildingTreeExclusion")]:
        polygon = truth_labels.get(label_key, {}).get("imagePolygon")
        if polygon:
            mask = polygon_mask(cv, np, width, height, polygon)
            masks[output_key] = {
                "label": truth_labels[label_key]["name"],
                "pixelArea": int(cv.countNonZero(mask)),
                "imagePolygon": polygon,
            }
        else:
            masks[output_key] = None
    return masks


def pivot_truth_metrics(
    pivot_crop_ring: dict[str, Any] | None,
    overlay_circle: dict[str, Any] | None,
    truth_labels: dict[str, Any] | None,
) -> dict[str, Any]:
    metrics = {"centerTruthOffsetPx": None, "radiusTruthMismatchRatio": None}
    truth_point = None if truth_labels is None else truth_labels.get("truePivotCenter", {}).get("imagePoint")
    if truth_point is not None and pivot_crop_ring is not None:
        metrics["centerTruthOffsetPx"] = round(math.hypot(
            float(truth_point["x"]) - float(pivot_crop_ring["center"]["x"]),
            float(truth_point["y"]) - float(pivot_crop_ring["center"]["y"]),
        ), 3)
    if pivot_crop_ring is not None and overlay_circle is not None and float(pivot_crop_ring["radius"]) > 0:
        metrics["radiusTruthMismatchRatio"] = round(abs(float(overlay_circle["radius"]) - float(pivot_crop_ring["radius"])) / float(pivot_crop_ring["radius"]), 4)
    return metrics


def circle_obstruction_conflicts(cv: Any, image: Any, overlay_circle: dict[str, Any] | None, obstruction_masks: dict[str, Any]) -> dict[str, Any]:
    result = {"southRoad": False, "seBuildingTree": False, "any": False}
    if overlay_circle is None:
        return result
    height, width = image.shape[:2]
    import numpy as np  # type: ignore

    circle_mask = np.zeros((height, width), dtype=np.uint8)
    center = overlay_circle["center"]
    cv.circle(circle_mask, (int(round(float(center["x"]))), int(round(float(center["y"])))), int(round(float(overlay_circle["radius"]))), 255, -1)
    for key in ["southRoad", "seBuildingTree"]:
        mask_payload = obstruction_masks.get(key)
        if not mask_payload:
            continue
        mask = polygon_mask(cv, np, width, height, mask_payload["imagePolygon"])
        result[key] = int(cv.countNonZero(cv.bitwise_and(circle_mask, mask))) > 0
    result["any"] = result["southRoad"] or result["seBuildingTree"]
    return result








def operator_comparison_metrics(cv: Any, image: Any, operator_polygon: list[dict[str, Any]], candidate_polygon: list[dict[str, Any]]) -> dict[str, Any]:
    import numpy as np  # type: ignore

    height, width = image.shape[:2]
    operator_mask = polygon_mask(cv, np, width, height, operator_polygon)
    candidate_mask = polygon_mask(cv, np, width, height, candidate_polygon)
    intersection = int(cv.countNonZero(cv.bitwise_and(operator_mask, candidate_mask)))
    union = int(cv.countNonZero(cv.bitwise_or(operator_mask, candidate_mask)))
    operator_area = max(1, int(cv.countNonZero(operator_mask)))
    candidate_area = max(1, int(cv.countNonZero(candidate_mask)))
    false_positive = int(cv.countNonZero(cv.bitwise_and(candidate_mask, cv.bitwise_not(operator_mask))))
    false_negative = int(cv.countNonZero(cv.bitwise_and(operator_mask, cv.bitwise_not(candidate_mask))))
    distances = boundary_distances_to_polygon(candidate_polygon, operator_polygon)
    return {
        "iou": round(intersection / union, 4) if union else 0.0,
        "boundaryMeanDistancePixels": round(sum(distances) / len(distances), 3) if distances else None,
        "boundaryMaxDistancePixels": round(max(distances), 3) if distances else None,
        "falsePositiveAreaRatio": round(false_positive / candidate_area, 4),
        "falseNegativeAreaRatio": round(false_negative / operator_area, 4),
    }


def polygon_mask(cv: Any, np: Any, width: int, height: int, polygon: list[dict[str, Any]]) -> Any:
    mask = np.zeros((height, width), dtype=np.uint8)
    points = np.array([[int(round(float(point["x"]))), int(round(float(point["y"])))] for point in polygon], dtype=np.int32).reshape((-1, 1, 2))
    cv.fillPoly(mask, [points], 255)
    return mask


def boundary_distances_to_polygon(candidate_polygon: list[dict[str, Any]], operator_polygon: list[dict[str, Any]]) -> list[float]:
    distances = []
    for point in sample_polygon_boundary(candidate_polygon, spacing=12.0):
        distances.append(distance_to_polygon_boundary(point, operator_polygon))
    return distances


def sample_polygon_boundary(polygon: list[dict[str, Any]], spacing: float) -> list[dict[str, float]]:
    samples = []
    for index, current in enumerate(polygon):
        next_point = polygon[(index + 1) % len(polygon)]
        x1 = float(current["x"])
        y1 = float(current["y"])
        x2 = float(next_point["x"])
        y2 = float(next_point["y"])
        steps = max(1, int(math.hypot(x2 - x1, y2 - y1) / spacing))
        for step in range(steps + 1):
            ratio = step / steps
            samples.append({"x": x1 + (x2 - x1) * ratio, "y": y1 + (y2 - y1) * ratio})
    return samples


def distance_to_polygon_boundary(point: dict[str, float], polygon: list[dict[str, Any]]) -> float:
    return min(
        distance_to_segment(point, polygon[index], polygon[(index + 1) % len(polygon)])
        for index in range(len(polygon))
    )


def distance_to_segment(point: dict[str, float], start: dict[str, Any], end: dict[str, Any]) -> float:
    px = float(point["x"])
    py = float(point["y"])
    x1 = float(start["x"])
    y1 = float(start["y"])
    x2 = float(end["x"])
    y2 = float(end["y"])
    dx = x2 - x1
    dy = y2 - y1
    length_squared = dx * dx + dy * dy
    if length_squared <= 0:
        return math.hypot(px - x1, py - y1)
    ratio = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / length_squared))
    projected_x = x1 + ratio * dx
    projected_y = y1 + ratio * dy
    return math.hypot(px - projected_x, py - projected_y)


def learning_recommendations_from_comparison(
    imagery_field_boundary: dict[str, Any] | None,
    operator_field_boundary: dict[str, Any] | None,
    operator_comparison: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    recommendations = []
    if operator_field_boundary is not None and operator_field_boundary.get("warnings"):
        recommendations.append({
            "type": "operator_label_intake",
            "severity": "warning",
            "summary": "Operator boundary label was not fully usable for pixel-aligned scoring.",
            "details": operator_field_boundary["warnings"],
        })
    if operator_field_boundary is None or not operator_field_boundary.get("imagePolygon"):
        return recommendations
    if imagery_field_boundary is None:
        recommendations.append({
            "type": "candidate_generation",
            "severity": "warning",
            "summary": "No imagery field-boundary candidates were available to compare against the operator label.",
            "details": ["Tune edge/contour thresholds or add local SAM2 prompts from the operator polygon before claiming boundary detection success."],
        })
        return recommendations
    best = operator_comparison[0] if operator_comparison else None
    if best is None:
        recommendations.append({
            "type": "candidate_generation",
            "severity": "warning",
            "summary": "Imagery detector output did not include candidate polygons for operator comparison.",
            "details": ["Keep imageryFieldBoundary separate from operatorFieldBoundary and rerun with --infer-field-boundary."],
        })
    elif best["iou"] < 0.55:
        recommendations.append({
            "type": "ranking_thresholds",
            "severity": "warning",
            "summary": "Best imagery candidate has low overlap with the operator label.",
            "details": [
                "Increase weight on road/fenceline/tree-line edge alignment and reduce confidence for crop-ring or extent-box shaped candidates.",
                f"Best IoU was {best['iou']} with mean boundary distance {best['boundaryMeanDistancePixels']} px.",
            ],
        })
    elif imagery_field_boundary.get("rejected"):
        recommendations.append({
            "type": "acceptance_thresholds",
            "severity": "info",
            "summary": "A rejected candidate overlaps the operator label; review detector thresholds before accepting any geometry.",
            "details": [f"Best rejected candidate IoU was {best['iou']}."],
        })
    return recommendations


def machine_wet_radius(machine: dict[str, Any]) -> float:
    return machine_radius(machine) + float(machine.get("endGunThrowMeters", 0))


def vision_confidence(
    pivot_crop_ring: dict[str, Any] | None,
    overlay_circle: dict[str, Any] | None,
    overlay_visible: bool,
    attribution_present: bool,
    imagery_field_boundary: dict[str, Any] | None,
) -> float:
    score = 0.15
    if pivot_crop_ring is not None:
        score += 0.22 * float(pivot_crop_ring["confidence"])
    if overlay_circle is not None:
        score += 0.24 * float(overlay_circle["confidence"])
    elif overlay_visible:
        score += 0.15
    if imagery_field_boundary is not None and not imagery_field_boundary.get("rejected"):
        score += 0.24 * float(imagery_field_boundary["confidence"])
    if attribution_present:
        score += 0.15
    return round(max(0.0, min(1.0, score)), 3)




def recommendation_summary(warnings: list[str]) -> str:
    if not warnings:
        return "Review passed advisory image-space checks for CPLayout overlay visibility, pivot-ring alignment, and field-boundary outline."
    return "Review field-boundary, center/radius, and obstacle alignment before accepting this design for any projected-XY workflow."


def write_annotated_image(
    cv: Any,
    image: Any,
    output_path: Path,
    pivot_crop_ring: dict[str, Any] | None,
    overlay_circle: dict[str, Any] | None,
    imagery_field_boundary: dict[str, Any] | None,
    operator_field_boundary: dict[str, Any] | None,
    operator_comparison: list[dict[str, Any]],
) -> None:
    annotated = image.copy()
    if pivot_crop_ring is not None:
        draw_circle(cv, annotated, pivot_crop_ring, (255, 255, 255), "detected pivot crop ring")
    if overlay_circle is not None:
        draw_circle(cv, annotated, overlay_circle, (0, 255, 255), "detected CPLayout overlay")
    if imagery_field_boundary is not None:
        for candidate in imagery_field_boundary.get("candidateMasks", []):
            if candidate.get("rejected") and candidate.get("imagePolygon"):
                draw_polygon(cv, annotated, candidate["imagePolygon"], (150, 150, 150), "rejected boundary candidate")
    if imagery_field_boundary is not None and not imagery_field_boundary.get("rejected"):
        draw_polygon(cv, annotated, imagery_field_boundary["imagePolygon"], (0, 0, 0), "detected field boundary")
        draw_evidence_cue_labels(cv, annotated, imagery_field_boundary)
    if operator_field_boundary is not None and operator_field_boundary.get("imagePolygon"):
        draw_polygon(cv, annotated, operator_field_boundary["imagePolygon"], (255, 0, 255), "operator field boundary label")
        if operator_comparison:
            disagreement = operator_comparison[0]
            cv.putText(
                annotated,
                f"operator comparison IoU {disagreement['iou']} mean {disagreement['boundaryMeanDistancePixels']} px",
                (24, 68),
                cv.FONT_HERSHEY_SIMPLEX,
                0.65,
                (0, 0, 0),
                4,
                cv.LINE_AA,
            )
            cv.putText(
                annotated,
                f"operator comparison IoU {disagreement['iou']} mean {disagreement['boundaryMeanDistancePixels']} px",
                (24, 68),
                cv.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                1,
                cv.LINE_AA,
            )
    cv.putText(
        annotated,
        "DESIGN-ONLY ADVISORY - no projected XY mutation",
        (24, 42),
        cv.FONT_HERSHEY_SIMPLEX,
        1.0,
        (0, 0, 0),
        5,
        cv.LINE_AA,
    )
    cv.putText(
        annotated,
        "DESIGN-ONLY ADVISORY - no projected XY mutation",
        (24, 42),
        cv.FONT_HERSHEY_SIMPLEX,
        1.0,
        (255, 255, 255),
        2,
        cv.LINE_AA,
    )
    if not cv.imwrite(str(output_path), annotated):
        raise SystemExit(f"OpenCV could not write annotated review image: {output_path}")


def draw_circle(cv: Any, image: Any, circle: dict[str, Any], color: tuple[int, int, int], label: str) -> None:
    center = (int(circle["center"]["x"]), int(circle["center"]["y"]))
    radius = int(circle["radius"])
    cv.circle(image, center, radius, color, 3, cv.LINE_AA)
    cv.circle(image, center, 5, color, -1, cv.LINE_AA)
    cv.putText(image, label, (center[0] + 12, center[1] - 12), cv.FONT_HERSHEY_SIMPLEX, 0.7, color, 2, cv.LINE_AA)


def draw_polygon(cv: Any, image: Any, polygon: list[dict[str, Any]], color: tuple[int, int, int], label: str) -> None:
    import numpy as np  # type: ignore

    points = np.array([[int(point["x"]), int(point["y"])] for point in polygon], dtype=np.int32).reshape((-1, 1, 2))
    cv.polylines(image, [points], True, color, 4, cv.LINE_AA)
    first = polygon[0]
    cv.putText(image, label, (int(first["x"]) + 12, int(first["y"]) + 24), cv.FONT_HERSHEY_SIMPLEX, 0.7, color, 2, cv.LINE_AA)


def draw_evidence_cue_labels(cv: Any, image: Any, imagery_field_boundary: dict[str, Any]) -> None:
    cues = ", ".join(imagery_field_boundary.get("cues", []))
    labels = [
        f"boundary cues: {cues}",
        f"edge {imagery_field_boundary.get('edgeAlignment')} rect {imagery_field_boundary.get('rectilinearity')}",
    ]
    height, _width = image.shape[:2]
    for index, label in enumerate(labels):
        y = max(70, height - 58 + index * 24)
        cv.putText(image, label, (24, y), cv.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 4, cv.LINE_AA)
        cv.putText(image, label, (24, y), cv.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv.LINE_AA)


def image_polygon_payload(points: list[dict[str, float]]) -> list[dict[str, float]]:
    return [{"x": round(float(point["x"]), 2), "y": round(float(point["y"]), 2)} for point in points]


def clamp_image_polygon(points: list[dict[str, float]], width: int, height: int) -> list[dict[str, float]]:
    return [
        {
            "x": max(0.0, min(float(width - 1), float(point["x"]))),
            "y": max(0.0, min(float(height - 1), float(point["y"]))),
        }
        for point in points
    ]


def image_polygon_area(points: list[dict[str, float]]) -> float:
    area = 0.0
    for index, current in enumerate(points):
        next_point = points[(index + 1) % len(points)]
        area += float(current["x"]) * float(next_point["y"]) - float(next_point["x"]) * float(current["y"])
    return area / 2.0


def image_polygon_perimeter(points: list[dict[str, float]]) -> float:
    perimeter = 0.0
    for index, current in enumerate(points):
        next_point = points[(index + 1) % len(points)]
        perimeter += math.hypot(float(next_point["x"]) - float(current["x"]), float(next_point["y"]) - float(current["y"]))
    return perimeter


def image_polygon_circularity(points: list[dict[str, float]]) -> float:
    area = abs(image_polygon_area(points))
    perimeter = image_polygon_perimeter(points)
    if area <= 0 or perimeter <= 0:
        return 1.0
    return (4 * math.pi * area) / (perimeter * perimeter)


def polygon_rectilinearity(points: list[dict[str, float]]) -> float:
    if len(points) < 4:
        return 0.0
    scores = []
    for index, point in enumerate(points):
        previous_point = points[index - 1]
        next_point = points[(index + 1) % len(points)]
        vector_a = (float(previous_point["x"]) - float(point["x"]), float(previous_point["y"]) - float(point["y"]))
        vector_b = (float(next_point["x"]) - float(point["x"]), float(next_point["y"]) - float(point["y"]))
        length_a = math.hypot(*vector_a)
        length_b = math.hypot(*vector_b)
        if length_a <= 0 or length_b <= 0:
            continue
        cosine = abs((vector_a[0] * vector_b[0] + vector_a[1] * vector_b[1]) / (length_a * length_b))
        scores.append(1 - min(1.0, cosine))
    return sum(scores) / len(scores) if scores else 0.0


def image_point_in_polygon(point: dict[str, float], polygon: list[dict[str, float]]) -> bool:
    inside = False
    x = float(point["x"])
    y = float(point["y"])
    previous_index = len(polygon) - 1
    for index, current in enumerate(polygon):
        previous = polygon[previous_index]
        current_y = float(current["y"])
        previous_y = float(previous["y"])
        if (current_y > y) != (previous_y > y):
            x_intersection = (float(previous["x"]) - float(current["x"])) * (y - current_y) / (previous_y - current_y) + float(current["x"])
            if x < x_intersection:
                inside = not inside
        previous_index = index
    return inside


def polygon_centroid(points: list[dict[str, Any]]) -> dict[str, float]:
    return {
      "x": sum(float(point["x"]) for point in points) / len(points),
      "y": sum(float(point["y"]) for point in points) / len(points),
    }


def average_radius(points: list[dict[str, Any]], center: dict[str, float]) -> float:
    return sum(math.hypot(float(point["x"]) - center["x"], float(point["y"]) - center["y"]) for point in points) / len(points)


def machine_radius(machine: dict[str, Any]) -> float:
    return sum(float(span) for span in machine["spanLengthsMeters"]) + float(machine.get("overhangMeters", 0))


if __name__ == "__main__":
    raise SystemExit(main())
