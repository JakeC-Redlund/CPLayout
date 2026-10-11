"""Explicit, isolated bridge to a separately managed portable CV runtime."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

CV_PYTHON_ENV = "CPLAYOUT_CV_PYTHON"


def _group_members(group_id: int) -> dict[int, str]:
    members = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            text = (entry / "stat").read_text()
            fields = text[text.rfind(")") + 2:].split()
            if fields[0] != "Z" and int(fields[2]) == group_id and int(fields[3]) == group_id:
                members[int(entry.name)] = fields[19]
        except (OSError, ValueError, IndexError):
            continue
    return members


def _tagged_members(token: str) -> dict[int, str]:
    """Find inherited ownership across sessions, including the isolated GPU worker."""
    members = {}
    expected = ("CV_TOOLKIT_BRIDGE_TOKEN=" + token).encode()
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if entry.stat().st_uid != os.getuid() or expected not in (entry / "environ").read_bytes().split(b"\0"):
                continue
            fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
            if fields[0] != "Z":
                members[int(entry.name)] = fields[19]
        except (OSError, ValueError, IndexError):
            continue
    return members


def _stop_owned_group(process, identities: dict[int, str], token: str) -> str:
    for sig, grace in ((signal.SIGINT, 2), (signal.SIGKILL, 5)):
        current = _tagged_members(token)
        if not current:
            return "verified-stopped"
        # Keep an identity anchor across the tagged process lifetime. A recycled
        # PID or session id is insufficient authority to signal another process.
        if not any(identities.get(pid) == start for pid, start in current.items()):
            return "unknown"
        identities.update(current)
        deadline = time.monotonic() + grace
        while time.monotonic() < deadline:
            for pid, start in current.items():
                try:
                    fd = os.pidfd_open(pid)
                    try:
                        if _tagged_members(token).get(pid) == start:
                            signal.pidfd_send_signal(fd, sig)
                    finally:
                        os.close(fd)
                except ProcessLookupError:
                    pass
            process.poll()
            current = _tagged_members(token)
            if not current:
                return "verified-stopped"
            identities.update(current)
            time.sleep(.05)
    return "failed"


def _execute_managed(argv: list[str], *, timeout: float, env: dict[str, str]):
    """Own an isolated POSIX process group so interruption cannot orphan a worker."""
    if sys.platform != "linux":
        raise ValueError("managed_cv_process_tree_cleanup_unqualified_on_this_platform")
    token = uuid.uuid4().hex
    environment = {**env, "CV_TOOLKIT_BRIDGE_TOKEN": token}
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, env=environment, start_new_session=True)

    def owned_remaining():
        members = _group_members(process.pid)
        expected = ("CV_TOOLKIT_BRIDGE_TOKEN=" + token).encode()
        for pid in list(members):
            try:
                if expected not in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0"):
                    raise ValueError("managed_cv_group_ownership_unknown")
            except FileNotFoundError:
                members.pop(pid, None)
        return _tagged_members(token)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
        # A supervisor can exit normally while a descendant still owns the
        # session. Completion includes the group, not merely the direct child.
        remaining = owned_remaining()
        if remaining:
            cleanup = _stop_owned_group(process, remaining, token)
            if cleanup != "verified-stopped":
                raise ValueError("managed_cv_residual_cleanup:" + cleanup)
        return subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)
    except BaseException as error:
        # This group was created by this invocation, never selected by a port,
        # executable name or a saved PID from a previous invocation.
        try:
            cleanup = _stop_owned_group(process, owned_remaining(), token)
        except (OSError, ValueError):
            cleanup = "unknown"
        error.managed_cleanup_status = cleanup
        error.add_note("managed_cv_cleanup:" + cleanup)
        if process.poll() is not None:
            process.communicate(timeout=1)
        raise


def configured_cv_python() -> Path | None:
    value = os.environ.get(CV_PYTHON_ENV)
    if not value:
        return None
    path = Path(value)
    return path if path.is_absolute() and path.is_file() and os.access(path, os.X_OK) else None


def _runtime_env() -> dict[str, str]:
    env = os.environ.copy()
    # The managed interpreter resolves its installed wheel, never a sibling checkout.
    env.pop("PYTHONPATH", None)
    env.pop("PYTHONHOME", None)
    return env


def probe_managed_runtime() -> dict[str, Any]:
    python = configured_cv_python()
    if python is None:
        return {"configured": False, "jobRunnerAvailable": False, "reason": f"set {CV_PYTHON_ENV} to an absolute executable path"}
    try:
        completed = subprocess.run(
            [str(python), "-m", "cv_toolkit.runtime", "probe"],
            capture_output=True, text=True, check=False, timeout=30, env=_runtime_env(),
        )
        result = json.loads(completed.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError) as error:
        return {"configured": True, "jobRunnerAvailable": False, "reason": type(error).__name__}
    available = completed.returncode == 0 and isinstance(result, dict) and result.get("schema_version") == "CVCapabilityReport-v1"
    return {
        "configured": True,
        "jobRunnerAvailable": available,
        "capability": result if available else None,
        "reason": None if available else "managed_runtime_probe_failed",
        "modelInferenceProven": False,
    }


def run_managed_job(job_path: Path) -> dict[str, Any]:
    python = configured_cv_python()
    if python is None:
        raise ValueError(f"{CV_PYTHON_ENV} must name an absolute executable managed Python interpreter")
    job_path = job_path.resolve(strict=True)
    if not job_path.is_file() or job_path.stat().st_size > 1024 * 1024:
        raise ValueError("job_file_missing_or_oversized")
    job = json.loads(job_path.read_text(encoding="utf-8"))
    if not isinstance(job, dict) or job.get("schema_version") not in ("CVJob-v1", "CVJob-v2"):
        raise ValueError("CVJob-v1 or CVJob-v2 JSON required")
    limits = job.get("limits") or {}
    if not isinstance(limits, dict):
        raise ValueError("job_limits_invalid")
    deadline = limits.get("deadline_seconds", 900)
    grace = limits.get("cancel_grace_seconds", 30)
    if type(deadline) not in (int, float) or type(grace) not in (int, float) or not (1 <= deadline <= 86400 and 1 <= grace <= 120):
        raise ValueError("job_limits_invalid")
    try:
        completed = _execute_managed(
            [str(python), "-m", "cv_toolkit.runtime", "run", str(job_path)],
            timeout=deadline + grace + 30, env=_runtime_env(),
        )
    except subprocess.TimeoutExpired as error:
        raise ValueError("managed_cv_job_timed_out:" + getattr(error, "managed_cleanup_status", "unknown")) from error
    result = json.loads(completed.stdout)
    if not isinstance(result, dict) or result.get("schema_version") != "CVJobResult-v1":
        raise ValueError("managed_cv_result_invalid")
    if completed.returncode not in (0, 2):
        raise ValueError("managed_cv_process_failed")
    if result.get("status") in {"completed", "checkpointed"}:
        verification = result.get("final_artifact_verification")
        if (completed.returncode != 0 or result.get("job_id") != job.get("job_id")
                or result.get("cleanup") != "verified-stopped"
                or result.get("artifact_bytes_verified") is not True
                or not isinstance(verification, dict)
                or verification.get("status") != "artifact-bytes-verified"):
            raise ValueError("managed_cv_success_proof_incomplete")
        if job.get("adapter") == "sam2-image":
            roles = {row.get("role") for row in result.get("outputs", []) if isinstance(row, dict)}
            if not {"mask", "mask-preview"}.issubset(roles):
                raise ValueError("managed_cv_mask_outputs_missing")
    return result


def run_managed_job_cli(job_path: Path) -> int:
    try:
        result = run_managed_job(job_path)
    except (OSError, ValueError) as error:
        result = {"schema_version": "CVJobResult-v1", "status": "invalid", "failures": [str(error)]}
    print(json.dumps(result, sort_keys=True, allow_nan=False))
    return 0 if result.get("status") in {"completed", "checkpointed"} else 2
