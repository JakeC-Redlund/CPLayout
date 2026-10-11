import contextlib
import io
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from cplayout_ml.cli import main
from cplayout_ml.runtime_status import probe_sam2
from cplayout_ml.toolkit_bridge import _execute_managed, _group_members, run_managed_job, run_managed_job_cli


class ManagedToolkitBridgeTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == "linux", "Linux process group cleanup")
    def test_normal_supervisor_exit_stops_owned_residual_worker(self) -> None:
        with TemporaryDirectory() as temp:
            child_file = Path(temp) / "child.pid"
            code = ("import subprocess,sys,pathlib; "
                    "p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'],"
                    "stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True); "
                    "pathlib.Path(sys.argv[1]).write_text(str(p.pid))")
            result = _execute_managed([sys.executable, "-c", code, str(child_file)],
                                      timeout=5, env=os.environ.copy())
            self.assertEqual(result.returncode, 0)
            proc = Path(f"/proc/{int(child_file.read_text())}/stat")
            if proc.exists():
                data = proc.read_text()
                self.assertEqual(data[data.rfind(")") + 2:].split()[0], "Z")

    @unittest.skipUnless(sys.platform == "linux", "Linux process group cleanup")
    def test_timeout_stops_descendant_after_supervisor_exit_and_preserves_unrelated(self) -> None:
        with TemporaryDirectory() as temp:
            pid_path = Path(temp) / "child.pid"
            child_code = "import signal,time; signal.signal(signal.SIGINT, signal.SIG_IGN); time.sleep(60)"
            parent_code = ("import subprocess,sys,time,pathlib; "
                "p=subprocess.Popen([sys.executable,'-c',sys.argv[2]],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True); "
                "pathlib.Path(sys.argv[1]).write_text(str(p.pid)); time.sleep(60)")
            unrelated = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
            try:
                with self.assertRaises(subprocess.TimeoutExpired) as caught:
                    _execute_managed([sys.executable, "-c", parent_code, str(pid_path), child_code], timeout=1, env=os.environ.copy())
                self.assertEqual(caught.exception.managed_cleanup_status, "verified-stopped")
                self.assertTrue(pid_path.exists())
                child_pid = int(pid_path.read_text())
                proc = Path(f"/proc/{child_pid}/stat")
                if proc.exists():
                    text = proc.read_text()
                    self.assertEqual(text[text.rfind(")") + 2:].split()[0], "Z")
                self.assertIsNone(unrelated.poll())
            finally:
                unrelated.terminate()
                unrelated.wait(timeout=5)

    def test_explicit_job_uses_managed_interpreter_without_pythonpath(self) -> None:
        with TemporaryDirectory() as temp:
            job = Path(temp) / "job.json"
            job.write_text(json.dumps({"schema_version": "CVJob-v1", "job_id": "sample", "adapter": "sam2-image", "limits": {"deadline_seconds": 12}}), encoding="utf-8")
            completed = SimpleNamespace(returncode=0, stdout=json.dumps({
                "schema_version": "CVJobResult-v1", "status": "completed", "job_id": "sample",
                "cleanup": "verified-stopped", "artifact_bytes_verified": True,
                "final_artifact_verification": {"status": "artifact-bytes-verified"},
                "outputs": [{"role": "mask"}, {"role": "mask-preview"}],
            }))
            with patch("cplayout_ml.toolkit_bridge.configured_cv_python", return_value=Path("/managed/bin/python")), \
                 patch("cplayout_ml.toolkit_bridge._execute_managed", return_value=completed) as run, \
                 patch.dict("cplayout_ml.toolkit_bridge.os.environ", {"PYTHONPATH": "/sibling/checkout"}):
                result = run_managed_job(job)
            self.assertEqual(result["status"], "completed")
            self.assertEqual(run.call_args.args[0], ["/managed/bin/python", "-m", "cv_toolkit.runtime", "run", str(job.resolve())])
            self.assertNotIn("PYTHONPATH", run.call_args.kwargs["env"])
            self.assertEqual(run.call_args.kwargs["timeout"], 72)

    def test_completed_sam2_job_without_mask_or_cleanup_fails_closed(self) -> None:
        with TemporaryDirectory() as temp:
            job = Path(temp) / "job.json"
            job.write_text(json.dumps({"schema_version": "CVJob-v1", "job_id": "sample", "adapter": "sam2-image"}), encoding="utf-8")
            base = {"schema_version": "CVJobResult-v1", "status": "completed", "job_id": "sample",
                    "cleanup": "verified-stopped", "artifact_bytes_verified": True,
                    "final_artifact_verification": {"status": "artifact-bytes-verified"}, "outputs": []}
            with patch("cplayout_ml.toolkit_bridge.configured_cv_python", return_value=Path("/managed/bin/python")), \
                 patch("cplayout_ml.toolkit_bridge._execute_managed", return_value=SimpleNamespace(returncode=0, stdout=json.dumps(base))):
                with self.assertRaisesRegex(ValueError, "mask_outputs_missing"):
                    run_managed_job(job)
            base["outputs"] = [{"role": "mask"}, {"role": "mask-preview"}]
            base["cleanup"] = "unknown"
            with patch("cplayout_ml.toolkit_bridge.configured_cv_python", return_value=Path("/managed/bin/python")), \
                 patch("cplayout_ml.toolkit_bridge._execute_managed", return_value=SimpleNamespace(returncode=0, stdout=json.dumps(base))):
                with self.assertRaisesRegex(ValueError, "success_proof_incomplete"):
                    run_managed_job(job)

    def test_job_timeout_fails_closed_and_cli_reports_failure(self) -> None:
        with TemporaryDirectory() as temp:
            job = Path(temp) / "job.json"
            job.write_text(json.dumps({"schema_version": "CVJob-v1"}), encoding="utf-8")
            with patch("cplayout_ml.toolkit_bridge.configured_cv_python", return_value=Path("/managed/bin/python")), \
                 patch("cplayout_ml.toolkit_bridge._execute_managed", side_effect=subprocess.TimeoutExpired("managed", 1)):
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    code = run_managed_job_cli(job)
            self.assertEqual(code, 2)
            self.assertEqual(json.loads(output.getvalue())["status"], "invalid")

    def test_sam2_package_visibility_does_not_claim_legacy_adapter(self) -> None:
        with patch("cplayout_ml.runtime_status.probe_managed_runtime", return_value={
            "jobRunnerAvailable": True,
            "capability": {"packages_visible": {"SAM-2": "1.1.0"}},
        }):
            status = probe_sam2(Path("/local/config.yaml"), Path("/local/checkpoint.pt"))
        self.assertFalse(status["available"])
        self.assertTrue(status["managedJobRunnerAvailable"])
        self.assertTrue(status["managedSam2PackageVisible"])

    def test_cli_dispatch_uses_patchable_public_handler(self) -> None:
        with patch("cplayout_ml.cli.run_managed_job_cli", return_value=2) as handler:
            self.assertEqual(main(["run-managed-cv-job", "--job", "job.json"]), 2)
        handler.assert_called_once_with(Path("job.json"))


if __name__ == "__main__":
    unittest.main()
