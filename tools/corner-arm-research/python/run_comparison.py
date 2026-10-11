"""Reproduce finite synthetic comparisons into a NEW evidence directory.

Run from the repository root with the pinned companion environment. No downloads
or app/server startup occur. Failed candidates remain findings, not accepted paths.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import time

from companion import environment, frame, oracle, read_request, reference_checks, sampled_objective, spline_candidate

ROOT = Path(__file__).resolve().parents[3]


def save(path: Path, value):
    with path.open("x") as stream:
        stream.write(json.dumps(value, indent=2, allow_nan=False) + "\n")


def identity():
    folders = [ROOT / "tools/corner-arm-research", ROOT / "fixtures/corner-arm-research"]
    files = sorted(p for folder in folders for p in folder.rglob("*")
                   if p.is_file() and ".venv" not in p.parts and "__pycache__" not in p.parts
                   and p.suffix in {".ts", ".py", ".json", ".toml", ".lock"})
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}


def ts(command: str, path: Path | None = None, *flags):
    args = [str(ROOT / "node_modules/.bin/tsx"), "tools/corner-arm-research/cli.ts", command]
    if path is not None:
        args.append(str(path))
    args.extend(flags)
    start = time.perf_counter()
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True, timeout=240)
    if result.returncode:
        raise RuntimeError(f"TypeScript command failed ({result.returncode}): {result.stdout[-2000:]} {result.stderr[-2000:]}")
    return json.loads(result.stdout), time.perf_counter() - start


def cross_check(request: dict, verification: dict) -> dict:
    residual = 0.0
    count = 0
    shape_counts_match = True
    for pose in verification["poses"]:
        p = frame(request, pose["thetaRad"], pose["alphaRad"])
        shape_counts_match = shape_counts_match and len(pose["wheels"]) == len(p["wheels"]) and len(pose["towers"]) == len(p["towers"])
        pairs = [(pose["H"]["position"], p["hinge"]), (pose["S"]["position"], p["sdu"]),
                 (pose["E"]["position"], p["end"]), (pose["antenna"]["position"], p["antenna"])]
        pairs.extend((a["position"], b) for a, b in zip(pose["wheels"], p["wheels"]))
        pairs.extend((a["position"], b) for a, b in zip(pose["towers"], p["towers"]))
        for a, b in pairs:
            residual = max(residual, math.dist(a, b))
            count += 1
    independent = oracle(request)
    contradiction = verification["status"] == "verified_within_model" and independent["sampledCollision"]
    return {"comparedPoints": count, "maximumCoordinateResidualM": residual,
            "shapeCountsMatch": shape_counts_match, "posesAvailable": bool(verification["poses"]),
            "coordinateComparisonToleranceM": 1e-7, "sampledOracle": independent,
            "contradiction": contradiction,
            "pass": bool(count and shape_counts_match and residual <= 1e-7 and not contradiction)}


def run(output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=False)
    before = identity()
    print("Running frozen TypeScript fixture benchmark", flush=True)
    benchmark, benchmark_seconds = ts("benchmark")
    save(output / "typescript-benchmark.json", benchmark)
    references = reference_checks()
    rows = []
    for name in ["roomy-circle", "square-layout"]:
        path = ROOT / f"fixtures/corner-arm-research/{name}.json"
        request = read_request(path)
        print(f"Comparing {name}: baseline", flush=True)
        baseline, baseline_seconds = ts("verify", path)
        save(output / f"{name}-baseline-verification.json", baseline)
        row = {"fixture": name, "baseline": {
            "verificationStatus": baseline["status"], "objective": sampled_objective(request),
            "wallSeconds": baseline_seconds, "crossCheck": cross_check(request, baseline)}}
        print(f"Comparing {name}: deterministic graph", flush=True)
        graph, graph_seconds = ts("generate", path, "--layers", "33", "--states", "9", "--max-transitions", "30000")
        save(output / f"{name}-graph-result.json", graph)
        row["graph"] = {"searchStatus": graph["status"], "wallSeconds": graph_seconds,
                         "transitionsChecked": graph["transitionsChecked"],
                         "proofIntervalsVisited": graph["proofIntervalsVisited"],
                         "stoppedAtBudget": graph["stoppedAtBudget"]}
        if graph.get("candidate"):
            candidate_path = output / f"{name}-graph-candidate.json"
            save(candidate_path, graph["candidate"])
            verification, _ = ts("verify", candidate_path)
            save(output / f"{name}-graph-verification.json", verification)
            row["graph"].update({"verificationStatus": verification["status"],
                                 "candidateSha256": hashlib.sha256(candidate_path.read_bytes()).hexdigest(),
                                 "objective": sampled_objective(graph["candidate"]),
                                 "crossCheck": cross_check(graph["candidate"], verification)})
        print(f"Comparing {name}: SciPy spline collocation", flush=True)
        start = time.perf_counter()
        candidate, solver_report = spline_candidate(request, maxiter=100)
        seconds = time.perf_counter() - start
        candidate_path = output / f"{name}-spline-linear-candidate.json"
        save(candidate_path, candidate)
        save(output / f"{name}-spline-result.json", solver_report)
        verification, verify_seconds = ts("verify", candidate_path)
        save(output / f"{name}-spline-verification.json", verification)
        row["spline"] = {"status": solver_report["status"], "solverWallSeconds": seconds,
                          "verificationWallSeconds": verify_seconds, "attempts": solver_report["attempts"],
                          "verificationStatus": verification["status"],
                          "candidateSha256": hashlib.sha256(candidate_path.read_bytes()).hexdigest(),
                          "issues": verification["issues"], "objective": sampled_objective(candidate),
                          "crossCheck": cross_check(candidate, verification)}
        rows.append(row)
    unchanged = before == identity()
    report = {
        "schemaVersion": "cplayout-corner-research-comparison-v1", "syntheticOnly": True,
        "environment": environment(), "sourceAndFixtureSha256": before,
        "sourceAndFixturesUnchanged": unchanged, "typescriptFixtureCount": benchmark["fixtureCount"],
        "typescriptFixturePass": benchmark["pass"], "typescriptBenchmarkWallSeconds": benchmark_seconds,
        "independentReferences": references, "comparisons": rows,
        "interpretation": [
            "All inputs synthetic. Numerical guards and dimensions are experiment settings, not manufacturer limits.",
            "Only the exported linear trajectory is checked by the interval verifier; original cubic curves remain unverified.",
            "Positive verifier result covers stated planar geometry and supplied constraints; timing, rolling, terrain and water are unqualified.",
            "No candidate and failed optimization do not establish physical infeasibility. Scores are not irrigated area.",
            "Wall times include local process overhead and are descriptive single-run observations, not general speed claims.",
        ],
    }
    checks = [method["crossCheck"]["pass"] for row in rows for method in [row["baseline"], row["graph"], row["spline"]]
              if "crossCheck" in method]
    report["checksPassed"] = bool(unchanged and benchmark["pass"] and all(checks)
                                 and references["polygonMaxErrorM2"] == 0
                                 and references["utmCentralMeridianErrorM"] < 1e-7)
    save(output / "comparison.json", report)
    print(json.dumps({"checksPassed": report["checksPassed"], "report": str(output / "comparison.json")}), flush=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="new directory; refuses reuse")
    result = run(parser.parse_args().output.resolve())
    raise SystemExit(0 if result["checksPassed"] else 1)
