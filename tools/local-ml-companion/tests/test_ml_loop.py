import json
import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from cplayout_ml.ml_loop import (
    detect_dvc_metadata,
    log_local_mlflow_run,
    prepare_vision_dataset,
    run_boundary_experiment,
    run_boundary_variants,
    summarize_boundary_experiments,
)


class LocalMlLoopTests(unittest.TestCase):
    def test_missing_mlflow_is_optional_for_local_experiment(self) -> None:
        with TemporaryDirectory() as temp, patch.dict(sys.modules, {"mlflow": None}):
            status = log_local_mlflow_run("local", {"schemaVersion": "v1"}, Path(temp), {}, {})
        self.assertFalse(status["available"])
        self.assertEqual(status["trackingMode"], "local_unavailable")

    def test_boundary_variant_accepts_null_candidate_and_iteration(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "map.png").write_bytes(b"fixture")

            def fake_improve(*args: object) -> int:
                output_dir = args[7]
                assert isinstance(output_dir, Path)
                output_dir.mkdir(parents=True)
                (output_dir / "boundary-improvement-loop.json").write_text(json.dumps({
                    "schemaVersion": "cplayout-boundary-improvement-loop-v2",
                    "acceptance": {"accepted": False, "gpuBacked": False},
                    "detections": {"cvCandidateBoundary": None},
                    "bestIteration": None,
                }), encoding="utf-8")
                return 0

            variants = run_boundary_variants(root, [{"id": "empty", "runBoundaryImprovement": True, "mapCanvasCrop": "map.png"}], root / "out", fake_improve)
            self.assertEqual(variants[0]["metrics"], {"confidence": None, "bestOperatorIoU": None})
            self.assertFalse(variants[0]["accepted"])

    def test_prepare_vision_dataset_records_hashes_and_deterministic_splits(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            image = root / "map.png"
            image.write_bytes(b"fixture")
            manifest = root / "fixtures.json"
            manifest.write_text(json.dumps({
                "schemaVersion": "fixtures-v1",
                "fixtures": [{
                    "id": "case-a",
                    "projectId": "project-a",
                    "projectCrs": "EPSG:32613",
                    "operatorApproved": True,
                    "mapCanvasCrop": "map.png",
                    "provenance": {"keyedService": False, "offlineCopyPolicy": "operator_owned_local_copy"},
                }],
            }), encoding="utf-8")

            prepare_vision_dataset(manifest, root / "out-a", "seed", "2026-05-31T00:00:00.000Z")
            prepare_vision_dataset(manifest, root / "out-b", "seed", "2026-05-31T00:00:00.000Z")

            left = json.loads((root / "out-a" / "vision-dataset-metadata.json").read_text(encoding="utf-8"))
            right = json.loads((root / "out-b" / "vision-dataset-metadata.json").read_text(encoding="utf-8"))
            self.assertEqual(left["schemaVersion"], "cplayout-vision-dataset-metadata-v1")
            self.assertEqual(left["fixtures"][0]["artifacts"]["mapCanvasCrop"]["sha256"], right["fixtures"][0]["artifacts"]["mapCanvasCrop"]["sha256"])
            self.assertEqual(left["fixtures"][0]["splitId"], right["fixtures"][0]["splitId"])
            self.assertFalse(left["networkRequired"])
            self.assertFalse(left["copiesRestrictedImagery"])

    def test_prepare_vision_dataset_rejects_hidden_key_provenance(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            manifest = root / "fixtures.json"
            manifest.write_text(json.dumps({
                "fixtures": [{
                    "id": "case-a",
                    "provenance": {"keyedService": True, "apiKey": "secret"},
                }],
            }), encoding="utf-8")

            with self.assertRaises(SystemExit):
                prepare_vision_dataset(manifest, root / "out", "seed", "2026-05-31T00:00:00.000Z")

    def test_detect_dvc_metadata_finds_local_config_and_pointer_files(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / ".dvc").mkdir()
            (root / ".dvc" / "config").write_text("[core]\n    no_scm = true\n", encoding="utf-8")
            (root / "dataset.dvc").write_text("outs: []\n", encoding="utf-8")

            detected = detect_dvc_metadata(root)

            self.assertTrue(detected["available"])
            self.assertEqual(detected["configPath"], str(root / ".dvc" / "config"))
            self.assertIn(str(root / "dataset.dvc"), detected["pointerFiles"])
            self.assertFalse(detected["remoteConfigured"])

    def test_run_boundary_experiment_logs_local_mlflow_and_summarizes(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            manifest = root / "fixtures.json"
            manifest.write_text(json.dumps({
                "fixtures": [{
                    "id": "case-a",
                    "projectId": "project-a",
                    "expected": {"boundaryPresent": False},
                }],
            }), encoding="utf-8")
            fake_mlflow = FakeMlflow()

            def fake_evaluate(_manifest: Path, output_dir: Path) -> int:
                output_dir.mkdir(parents=True, exist_ok=True)
                (output_dir / "vision-evaluation-summary.json").write_text(json.dumps({
                    "schemaVersion": "cplayout-vision-evaluation-v1",
                    "metrics": {
                        "boundaryCandidatePrecision": 0.5,
                        "boundaryCandidateRecall": 0.25,
                    },
                    "networkRequired": False,
                    "canonicalGeometryMutation": False,
                }), encoding="utf-8")
                return 0

            with patch.dict(sys.modules, {"mlflow": fake_mlflow}):
                run_boundary_experiment(
                    manifest,
                    root / "experiment",
                    "unit-experiment",
                    "seed",
                    "2026-05-31T00:00:00.000Z",
                    fake_evaluate,
                    lambda *args, **kwargs: 0,
                )

            report = json.loads((root / "experiment" / "boundary-experiment-report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["schemaVersion"], "cplayout-boundary-experiment-v1")
            self.assertEqual(report["mlflow"]["runId"], "fake-run-id")
            self.assertFalse(report["networkRequired"])
            self.assertEqual(report["variants"][1]["id"], "opencv-sam2-proposals")

            summarize_boundary_experiments([root / "experiment"], root / "summary")
            summary = json.loads((root / "summary" / "boundary-experiment-summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["schemaVersion"], "cplayout-boundary-experiment-summary-v1")
            self.assertEqual(summary["comparisons"][0]["opencvBaseline"]["boundaryCandidateRecall"], 0.25)


class FakeRun:
    info = types.SimpleNamespace(run_id="fake-run-id", artifact_uri="file:///tmp/fake-run")

    def __enter__(self) -> "FakeRun":
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None


class FakeMlflow(types.ModuleType):
    def __init__(self) -> None:
        super().__init__("mlflow")
        self.params = {}
        self.metrics = {}

    def set_tracking_uri(self, uri: str) -> None:
        self.tracking_uri = uri

    def set_experiment(self, name: str) -> None:
        self.experiment_name = name

    def start_run(self) -> FakeRun:
        return FakeRun()

    def log_param(self, key: str, value: object) -> None:
        self.params[key] = value

    def log_metric(self, key: str, value: float) -> None:
        self.metrics[key] = value

    def log_dict(self, payload: object, artifact_file: str) -> None:
        return None


if __name__ == "__main__":
    unittest.main()
