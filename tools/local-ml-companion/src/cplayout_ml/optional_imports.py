from __future__ import annotations

import importlib
import importlib.util
from typing import Any

EXTRA_GROUP_IMPORTS: dict[str, list[tuple[str, str]]] = {
    "base": [
        ("numpy", "numpy"),
        ("opencv-python-headless", "cv2"),
        ("pandas", "pandas"),
        ("scikit-learn", "sklearn"),
        ("portable-cv-toolkit", "cv_toolkit"),
    ],
    "gis": [
        ("rasterio", "rasterio"),
        ("geopandas", "geopandas"),
        ("rioxarray", "rioxarray"),
    ],
    "vision": [
        ("scikit-image", "skimage"),
        ("matplotlib", "matplotlib"),
        ("plotly", "plotly"),
    ],
    "dashboard": [
        ("streamlit", "streamlit"),
        ("dash", "dash"),
    ],
    "api": [
        ("fastapi", "fastapi"),
        ("httpx", "httpx"),
        ("uvicorn", "uvicorn"),
        ("sqlalchemy", "sqlalchemy"),
    ],
    "experiment": [
        ("dvc", "dvc"),
        ("mlflow", "mlflow"),
    ],
}


def normalize_extra_groups(groups: list[str] | None = None) -> list[str]:
    if not groups:
        return list(EXTRA_GROUP_IMPORTS)
    expanded = []
    for group in groups:
        expanded.extend(part.strip() for part in group.split(",") if part.strip())
    if not expanded or "all" in expanded:
        return list(EXTRA_GROUP_IMPORTS)
    invalid = [group for group in expanded if group not in EXTRA_GROUP_IMPORTS]
    if invalid:
        raise SystemExit(f"Unknown companion dependency group(s): {', '.join(invalid)}")
    return expanded


def import_smoke_results(groups: list[str] | None = None) -> dict[str, Any]:
    selected_groups = normalize_extra_groups(groups)
    results: dict[str, Any] = {}
    for group in selected_groups:
        modules = []
        for package_name, module_name in EXTRA_GROUP_IMPORTS[group]:
            if importlib.util.find_spec(module_name) is None:
                modules.append({"package": package_name, "module": module_name, "available": False, "imported": False})
                continue
            try:
                module = importlib.import_module(module_name)
                modules.append({
                    "package": package_name,
                    "module": module_name,
                    "available": True,
                    "imported": True,
                    "version": getattr(module, "__version__", None),
                })
            except Exception as exc:
                modules.append({
                    "package": package_name,
                    "module": module_name,
                    "available": True,
                    "imported": False,
                    "error": str(exc),
                })
        results[group] = {
            "available": all(module["imported"] for module in modules),
            "modules": modules,
        }
    return results


def companion_dependency_probe(groups: list[str] | None = None, require_installed: bool = False) -> dict[str, Any]:
    results = import_smoke_results(groups)
    missing = [
        f"{group}:{module['package']}"
        for group, result in results.items()
        for module in result["modules"]
        if not module["imported"]
    ]
    return {
        "schemaVersion": "cplayout-companion-dependency-probe-v1",
        "groups": list(results),
        "required": require_installed,
        "available": len(missing) == 0,
        "missing": missing,
        "results": results,
    }
