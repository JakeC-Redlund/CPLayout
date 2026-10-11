from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any

DATASET_SCHEMA_VERSION = "cplayout-vision-dataset-metadata-v1"
EXPERIMENT_SCHEMA_VERSION = "cplayout-boundary-experiment-v1"
SUMMARY_SCHEMA_VERSION = "cplayout-boundary-experiment-summary-v1"


def prepare_vision_dataset(manifest_path: Path, output_dir: Path, split_seed: str, created_at: str) -> int:
    manifest = load_json(manifest_path)
    entries = manifest_entries(manifest)
    manifest_dir = manifest_path.parent
    fixture_records = [fixture_record(manifest_dir, entry, index) for index, entry in enumerate(entries)]
    split_records = assign_splits(fixture_records, split_seed)
    dvc = detect_dvc_metadata(manifest_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    metadata = {
        "schemaVersion": DATASET_SCHEMA_VERSION,
        "createdAt": created_at,
        "manifest": {
            "path": str(manifest_path),
            "sha256": sha256_file(manifest_path),
            "schemaVersion": manifest.get("schemaVersion"),
        },
        "splitSeed": split_seed,
        "fixtureCount": len(fixture_records),
        "fixtures": split_records,
        "dvc": dvc,
        "networkRequired": False,
        "hiddenKeysAllowed": False,
        "copiesRestrictedImagery": False,
        "canonicalGeometryMutation": False,
    }
    reject_hidden_keys(metadata)
    json_path = output_dir / "vision-dataset-metadata.json"
    json_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "metadata": str(json_path),
        "fixtureCount": len(fixture_records),
        "splitIds": sorted({record["splitId"] for record in split_records}),
        "networkRequired": False,
        "copiesRestrictedImagery": False,
    }, indent=2, sort_keys=True))
    return 0


def run_boundary_experiment(
    manifest_path: Path,
    output_dir: Path,
    experiment_name: str,
    split_seed: str,
    created_at: str,
    evaluate_vision_fixtures: Callable[[Path, Path], int],
    improve_boundary_detector: Callable[..., int],
) -> int:
    output_dir.mkdir(parents=True, exist_ok=True)
    dataset_dir = output_dir / "dataset"
    evaluation_dir = output_dir / "opencv-baseline"
    prepare_vision_dataset(manifest_path, dataset_dir, split_seed, created_at)
    evaluate_vision_fixtures(manifest_path, evaluation_dir)
    manifest = load_json(manifest_path)
    entries = manifest_entries(manifest)
    variants = run_boundary_variants(manifest_path.parent, entries, output_dir, improve_boundary_detector)
    summary = load_json(evaluation_dir / "vision-evaluation-summary.json")
    dataset_metadata = load_json(dataset_dir / "vision-dataset-metadata.json")
    dvc = detect_dvc_metadata(manifest_path.parent)
    report = {
        "schemaVersion": EXPERIMENT_SCHEMA_VERSION,
        "createdAt": created_at,
        "experimentName": experiment_name,
        "datasetMetadata": str(dataset_dir / "vision-dataset-metadata.json"),
        "datasetManifestSha256": dataset_metadata["manifest"]["sha256"],
        "dvc": dvc,
        "mlflow": {},
        "variants": [
            {
                "id": "opencv-baseline",
                "kind": "opencv_fixture_evaluation",
                "summaryPath": str(evaluation_dir / "vision-evaluation-summary.json"),
                "metrics": summary.get("metrics", {}),
            },
            *variants,
        ],
        "networkRequired": False,
        "hiddenKeysAllowed": False,
        "canonicalGeometryMutation": False,
    }
    report["mlflow"] = log_local_mlflow_run(experiment_name, report, output_dir, dataset_metadata, summary)
    reject_hidden_keys(report)
    report_path = output_dir / "boundary-experiment-report.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "report": str(report_path),
        "mlflowRunId": report["mlflow"].get("runId"),
        "variantCount": len(report["variants"]),
        "networkRequired": False,
    }, indent=2, sort_keys=True))
    return 0


def summarize_boundary_experiments(input_paths: list[Path], output_dir: Path) -> int:
    output_dir.mkdir(parents=True, exist_ok=True)
    reports = [load_experiment_report(path) for path in input_paths]
    comparisons = [comparison_row(report) for report in reports]
    payload = {
        "schemaVersion": SUMMARY_SCHEMA_VERSION,
        "experimentCount": len(reports),
        "comparisons": comparisons,
        "networkRequired": False,
        "canonicalGeometryMutation": False,
    }
    json_path = output_dir / "boundary-experiment-summary.json"
    md_path = output_dir / "boundary-experiment-summary.md"
    json_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    md_path.write_text(markdown_summary(payload), encoding="utf-8")
    print(json.dumps({"json": str(json_path), "markdown": str(md_path), "experimentCount": len(reports)}, indent=2, sort_keys=True))
    return 0


def manifest_entries(manifest: dict[str, Any]) -> list[Any]:
    entries = manifest.get("fixtures", manifest.get("cases", []))
    if not isinstance(entries, list):
        raise SystemExit("Vision dataset manifest must contain a fixtures or cases array.")
    return entries


def fixture_record(manifest_dir: Path, entry: Any, index: int) -> dict[str, Any]:
    if not isinstance(entry, dict):
        raise SystemExit("Each vision dataset fixture must be an object.")
    reject_hidden_keys(entry)
    fixture_id = str(entry.get("id") or entry.get("name") or f"fixture-{index + 1}")
    artifacts = {}
    for key in [
        "fullWindowScreenshot",
        "full_window",
        "mapCanvasCrop",
        "map_canvas",
        "mapCanvas",
        "kml",
        "kmz",
        "visualFidelityManifest",
        "visual_manifest",
        "projectReference",
        "project_reference",
        "operatorBoundaryKml",
        "operator_boundary_kml",
    ]:
        if key in entry and entry[key] not in (None, ""):
            artifacts[key] = artifact_pointer(manifest_dir, entry[key])
    provenance = entry.get("provenance", {})
    if provenance is not None and not isinstance(provenance, dict):
        raise SystemExit(f"Fixture {fixture_id} provenance must be an object when present.")
    return {
        "id": fixture_id,
        "projectId": entry.get("projectId"),
        "projectCrs": entry.get("projectCrs"),
        "operatorApproved": bool(entry.get("operatorApproved", entry.get("operator_approved", False))),
        "expected": entry.get("expected", {}),
        "provenance": provenance,
        "artifacts": artifacts,
    }


def artifact_pointer(manifest_dir: Path, value: Any) -> dict[str, Any]:
    if not isinstance(value, str) or not value:
        raise SystemExit("Fixture artifact paths must be non-empty strings.")
    path = Path(value)
    resolved = path if path.is_absolute() else manifest_dir / path
    if not resolved.exists():
        raise SystemExit(f"Fixture artifact does not exist: {resolved}")
    return {
        "path": str(path),
        "resolvedPath": str(resolved),
        "sha256": sha256_file(resolved),
        "byteLength": resolved.stat().st_size,
    }


def assign_splits(records: list[dict[str, Any]], split_seed: str) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        group = str(record.get("projectId") or record["id"])
        groups.setdefault(group, []).append(record)
    split_by_group = {}
    for group in sorted(groups):
        bucket = int(hashlib.sha256(f"{split_seed}:{group}".encode("utf-8")).hexdigest()[:8], 16) % 10
        split_by_group[group] = "test" if bucket == 0 else "validation" if bucket in (1, 2) else "train"
    return [
        {**record, "splitId": split_by_group[str(record.get("projectId") or record["id"])]}
        for record in records
    ]


def run_boundary_variants(
    manifest_dir: Path,
    entries: list[Any],
    output_dir: Path,
    improve_boundary_detector: Callable[..., int],
) -> list[dict[str, Any]]:
    variants = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict) or not entry.get("runBoundaryImprovement", False):
            continue
        case_id = str(entry.get("id") or entry.get("name") or f"fixture-{index + 1}")
        map_canvas = optional_manifest_path(manifest_dir, entry.get("mapCanvasCrop") or entry.get("map_canvas") or entry.get("mapCanvas"))
        if map_canvas is None:
            raise SystemExit(f"Boundary improvement fixture {case_id} must include mapCanvasCrop.")
        variant_dir = output_dir / f"opencv-boundary-loop-{safe_filename(case_id)}"
        improve_boundary_detector(
            map_canvas,
            optional_manifest_path(manifest_dir, entry.get("fullWindowScreenshot") or entry.get("full_window")),
            optional_manifest_path(manifest_dir, entry.get("kml")),
            optional_manifest_path(manifest_dir, entry.get("projectReference") or entry.get("project_reference")),
            str(optional_manifest_path(manifest_dir, entry.get("operatorBoundaryKml") or entry.get("operator_boundary_kml"))) if (entry.get("operatorBoundaryKml") or entry.get("operator_boundary_kml")) else None,
            entry.get("operatorBoundaryKmlText") or entry.get("operator_boundary_kml_text"),
            str(entry.get("operatorBoundaryName") or entry.get("operator_boundary_name") or "USER DRAWN FIELD BOUNDARY"),
            variant_dir,
            int(entry.get("minIterations", entry.get("min_iterations", 5))),
            str(entry.get("createdAt") or "1970-01-01T00:00:00.000Z"),
        )
        report_path = variant_dir / "boundary-improvement-loop.json"
        report = load_json(report_path)
        detections = report.get("detections") or {}
        candidate = detections.get("cvCandidateBoundary") or {}
        best_iteration = report.get("bestIteration") or {}
        variants.append({
            "id": f"opencv-boundary-loop:{case_id}",
            "kind": "opencv_boundary_improvement",
            "reportPath": str(report_path),
            "accepted": report.get("acceptance", {}).get("accepted"),
            "gpuBacked": report.get("acceptance", {}).get("gpuBacked"),
            "metrics": {
                "confidence": candidate.get("confidence"),
                "bestOperatorIoU": best_iteration.get("bestOperatorIoU"),
            },
        })
    variants.append({
        "id": "opencv-sam2-proposals",
        "kind": "opencv_plus_sam2_proposal_slot",
        "status": "not_run_without_local_sam2_config_checkpoint",
        "networkRequired": False,
    })
    variants.append({
        "id": "trained-model-candidate",
        "kind": "trained_model_slot",
        "status": "not_run_without_local_model_artifact",
        "networkRequired": False,
    })
    return variants


def log_local_mlflow_run(
    experiment_name: str,
    report: dict[str, Any],
    output_dir: Path,
    dataset_metadata: dict[str, Any],
    evaluation_summary: dict[str, Any],
) -> dict[str, Any]:
    try:
        import mlflow  # type: ignore
    except Exception as exc:
        return {"available": False, "error": str(exc), "trackingMode": "local_unavailable"}
    tracking_dir = output_dir / "mlruns"
    mlflow.set_tracking_uri(tracking_dir.as_uri())
    mlflow.set_experiment(experiment_name)
    with mlflow.start_run() as run:
        mlflow.log_param("schemaVersion", report["schemaVersion"])
        mlflow.log_param("datasetManifestSha256", dataset_metadata["manifest"]["sha256"])
        mlflow.log_param("fixtureCount", dataset_metadata["fixtureCount"])
        mlflow.log_param("networkRequired", False)
        for key, value in evaluation_summary.get("metrics", {}).items():
            if isinstance(value, (int, float)):
                mlflow.log_metric(key, float(value))
        mlflow.log_dict(dataset_metadata, "vision-dataset-metadata.json")
        mlflow.log_dict(evaluation_summary, "vision-evaluation-summary.json")
        return {
            "available": True,
            "trackingUri": tracking_dir.as_uri(),
            "experimentName": experiment_name,
            "runId": run.info.run_id,
            "artifactUri": run.info.artifact_uri,
            "localOnly": True,
        }


def detect_dvc_metadata(base_dir: Path) -> dict[str, Any]:
    root = find_upward(base_dir, ".dvc/config")
    pointers = sorted(str(path) for path in base_dir.rglob("*.dvc") if ".dvc/cache" not in str(path))
    return {
        "configPath": str(root) if root is not None else None,
        "available": root is not None,
        "pointerFiles": pointers,
        "gitCommit": git_output(["git", "rev-parse", "--short", "HEAD"]),
        "gitDirty": bool(git_output(["git", "status", "--short"])),
        "remoteConfigured": False,
    }


def find_upward(start: Path, relative_path: str) -> Path | None:
    current = start.resolve()
    while True:
        candidate = current / relative_path
        if candidate.exists():
            return candidate
        if current.parent == current:
            return None
        current = current.parent


def load_experiment_report(path: Path) -> dict[str, Any]:
    report_path = path / "boundary-experiment-report.json" if path.is_dir() else path
    report = load_json(report_path)
    if report.get("schemaVersion") != EXPERIMENT_SCHEMA_VERSION:
        raise SystemExit(f"Unsupported boundary experiment report schema: {report_path}")
    return report


def comparison_row(report: dict[str, Any]) -> dict[str, Any]:
    baseline = next((variant for variant in report.get("variants", []) if variant.get("id") == "opencv-baseline"), {})
    metrics = baseline.get("metrics", {}) if isinstance(baseline, dict) else {}
    return {
        "experimentName": report.get("experimentName"),
        "createdAt": report.get("createdAt"),
        "datasetManifestSha256": report.get("datasetManifestSha256"),
        "mlflowRunId": report.get("mlflow", {}).get("runId"),
        "opencvBaseline": metrics,
        "opencvSam2Status": variant_status(report, "opencv-sam2-proposals"),
        "trainedModelStatus": variant_status(report, "trained-model-candidate"),
    }


def variant_status(report: dict[str, Any], variant_id: str) -> str:
    variant = next((item for item in report.get("variants", []) if item.get("id") == variant_id), None)
    return str(variant.get("status", "unknown")) if isinstance(variant, dict) else "missing"


def markdown_summary(payload: dict[str, Any]) -> str:
    lines = [
        "# CPLayout Boundary Experiment Summary",
        "",
        "| Experiment | Manifest SHA-256 | MLflow Run | OpenCV Precision | OpenCV Recall | SAM2 | Trained Model |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in payload["comparisons"]:
        metrics = row.get("opencvBaseline", {})
        lines.append(
            f"| {row.get('experimentName')} | {str(row.get('datasetManifestSha256'))[:12]} | "
            f"{row.get('mlflowRunId') or 'n/a'} | {metric_text(metrics, 'boundaryCandidatePrecision')} | "
            f"{metric_text(metrics, 'boundaryCandidateRecall')} | {row.get('opencvSam2Status')} | {row.get('trainedModelStatus')} |"
        )
    lines.extend(["", "All entries are local/offline advisory evidence; no canonical project geometry is mutated by this summary.", ""])
    return "\n".join(lines)


def metric_text(metrics: dict[str, Any], key: str) -> str:
    value = metrics.get(key)
    return f"{value:.4f}" if isinstance(value, (int, float)) else "n/a"


def optional_manifest_path(manifest_dir: Path, value: Any) -> Path | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise SystemExit("Manifest paths must be strings.")
    path = Path(value)
    return path if path.is_absolute() else manifest_dir / path


def reject_hidden_keys(value: Any) -> None:
    if isinstance(value, dict):
        if value.get("keyedService") is True or isinstance(value.get("apiKey"), str) or isinstance(value.get("accessToken"), str):
            raise SystemExit("Local ML manifests and reports cannot contain hidden-key imagery provenance.")
        for child in value.values():
            reject_hidden_keys(child)
    elif isinstance(value, list):
        for child in value:
            reject_hidden_keys(child)


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_filename(value: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in ("-", "_") else "-" for char in value.strip().lower())
    return cleaned.strip("-") or "fixture"


def git_output(command: list[str]) -> str | None:
    try:
        completed = subprocess.run(command, cwd=Path(__file__).resolve().parents[4], check=False, capture_output=True, text=True)
    except Exception:
        return None
    return completed.stdout.strip() or None


def environment_summary() -> dict[str, Any]:
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "cwd": os.getcwd(),
    }
