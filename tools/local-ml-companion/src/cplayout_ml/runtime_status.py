from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .toolkit_bridge import probe_managed_runtime

SAM2_CONFIG_ENV = "CPLAYOUT_SAM2_CONFIG"
SAM2_CHECKPOINT_ENV = "CPLAYOUT_SAM2_CHECKPOINT"


def configured_path(value: Path | None, env_name: str) -> Path | None:
    if value is not None:
        return value
    env_value = os.environ.get(env_name)
    return Path(env_value) if env_value else None



def probe_opencv() -> dict[str, Any]:
    try:
        import cv2  # type: ignore
    except Exception as exc:
        return {"available": False, "error": str(exc), "houghCircles": False, "houghLinesP": False}
    return {
        "available": True,
        "version": getattr(cv2, "__version__", None),
        "houghCircles": hasattr(cv2, "HoughCircles"),
        "houghLinesP": hasattr(cv2, "HoughLinesP"),
        "grabCut": hasattr(cv2, "grabCut"),
        "watershed": hasattr(cv2, "watershed"),
    }



def probe_sam2(config_path: Path | None, checkpoint_path: Path | None) -> dict[str, Any]:
    managed = probe_managed_runtime()
    package_visible = bool((managed.get("capability") or {}).get("packages_visible", {}).get("SAM-2"))
    return {
        "available": False,
        "managedJobRunnerAvailable": managed["jobRunnerAvailable"],
        "managedSam2PackageVisible": package_visible,
        "managedRuntime": managed,
        "importError": "legacy SAM2 proposal adapter has no explicit prompt/job contract",
        "configPath": str(config_path) if config_path is not None else None,
        "configExists": bool(config_path is not None and config_path.exists()),
        "checkpointPath": str(checkpoint_path) if checkpoint_path is not None else None,
        "checkpointExists": bool(checkpoint_path is not None and checkpoint_path.exists()),
        "configuredBy": {
            "configEnv": SAM2_CONFIG_ENV if os.environ.get(SAM2_CONFIG_ENV) else None,
            "checkpointEnv": SAM2_CHECKPOINT_ENV if os.environ.get(SAM2_CHECKPOINT_ENV) else None,
        },
        "note": "Explicit CVJob-v1 SAM2 jobs use the managed runtime bridge; this legacy proposal slot is disabled. Package visibility is not inference proof.",
    }



def sam2_import_status() -> dict[str, Any]:
    return {"available": False, "error": "legacy SAM2 adapter disabled; use an explicit managed CVJob-v1"}



def probe_cuda() -> dict[str, Any]:
    try:
        import torch  # type: ignore
    except Exception as exc:
        return {"torchAvailable": False, "cudaAvailable": False, "error": str(exc)}
    cuda_available = bool(torch.cuda.is_available())
    return {
        "torchAvailable": True,
        "torchVersion": torch.__version__,
        "cudaAvailable": cuda_available,
        "cudaRuntime": torch.version.cuda,
        "deviceCount": int(torch.cuda.device_count()) if cuda_available else 0,
        "devices": [torch.cuda.get_device_name(index) for index in range(torch.cuda.device_count())] if cuda_available else [],
    }



def torch_gpu_image_preflight(image: Any) -> dict[str, Any] | None:
    try:
        import torch  # type: ignore
    except Exception:
        return None
    if not torch.cuda.is_available():
        return None
    import numpy as np  # type: ignore

    rgb = image[:, :, ::-1].copy()
    tensor = torch.from_numpy(np.asarray(rgb)).to(device="cuda", dtype=torch.float32) / 255.0
    gray = tensor.mean(dim=2)
    gradient_x = torch.abs(gray[:, 1:] - gray[:, :-1]).mean()
    gradient_y = torch.abs(gray[1:, :] - gray[:-1, :]).mean()
    torch.cuda.synchronize()
    return {
        "device": torch.cuda.get_device_name(0),
        "shape": list(tensor.shape),
        "mean": round(float(tensor.mean().detach().cpu()), 6),
        "std": round(float(tensor.std().detach().cpu()), 6),
        "meanAbsGradient": round(float((gradient_x + gradient_y).detach().cpu()), 6),
    }



def boundary_detector_runtime_status(sam2_config_arg: Path | None, sam2_checkpoint_arg: Path | None) -> dict[str, Any]:
    sam2_config = configured_path(sam2_config_arg, SAM2_CONFIG_ENV)
    sam2_checkpoint = configured_path(sam2_checkpoint_arg, SAM2_CHECKPOINT_ENV)
    status = {
        "opencv": probe_opencv(),
        "sam2": probe_sam2(sam2_config, sam2_checkpoint),
        "networkRequired": False,
        "hiddenDownloads": False,
        "offlineOnly": True,
    }
    status["canRunOffline"] = bool(status["opencv"]["available"] and status["opencv"]["houghCircles"] and status["opencv"]["houghLinesP"])
    return status
