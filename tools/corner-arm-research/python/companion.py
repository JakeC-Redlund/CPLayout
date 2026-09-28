"""Synthetic planar experiments. No manufacturer, controller, or field qualification.

The optimizer's cubic curve is only a candidate source. Its exported piecewise
linear trajectory must be checked by the separate TypeScript interval verifier.
Shapely results below are sampled cross-checks, never continuous clearance proof.
"""
from __future__ import annotations

import argparse
import cmath
import copy
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import sys

import numpy as np
from pyproj import Transformer, network, proj_version_str
from scipy.interpolate import CubicSpline
from scipy.optimize import minimize
from shapely.geometry import LineString, Point, Polygon

SCHEMA = "cplayout-corner-research-v1"
network.set_network_enabled(False)


def read_request(path: Path) -> dict:
    request = json.loads(path.read_text())
    validate_request(request)
    return request


def validate_request(request: dict) -> None:
    """Admit numerical experiments independently of any later TS invocation."""
    if not isinstance(request, dict):
        raise ValueError("request must be an object")
    if request.get("schemaVersion") != SCHEMA:
        raise ValueError("unsupported research schema")
    json.dumps(request, allow_nan=False)

    def number(value, name):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"{name} must be a finite number")
        return value

    def point(value, name):
        if not isinstance(value, list) or len(value) != 2:
            raise ValueError(f"{name} must have two coordinates")
        for coordinate in value:
            number(coordinate, name)

    m = request["model"]
    point(m["pivot"], "pivot")
    point(m["antennaOffsetM"], "antennaOffsetM")
    for p in m["wheelOffsetsM"]:
        point(p, "wheel offset")
    for name in ["mainRadiusM", "armLengthM"]:
        if number(m[name], name) <= 0:
            raise ValueError(f"{name} must be positive")
    for name in ["overhangM", "bodyHalfWidthM"]:
        if number(m[name], name) < 0:
            raise ValueError(f"{name} must be nonnegative")
    if number(request["clearanceM"], "clearanceM") < 0:
        raise ValueError("clearanceM must be nonnegative")
    if number(request["toleranceM"], "toleranceM") <= 0:
        raise ValueError("toleranceM must be positive")
    for radius in m["towerRadiiM"]:
        if not 0 <= number(radius, "tower radius") <= m["mainRadiusM"]:
            raise ValueError("tower radius outside main machine")
    for ring in [request["field"]["outer"], *request["field"]["holes"], *request["obstacles"]]:
        if not isinstance(ring, list) or len(ring) < 3:
            raise ValueError("polygon ring requires at least three points")
        for p in ring:
            point(p, "polygon point")
    site_geometry(request)
    lo, hi = request["limits"]["articulationRad"]
    if number(lo, "articulation minimum") > number(hi, "articulation maximum"):
        raise ValueError("reversed articulation limits")
    if number(request["limits"]["maxArticulationSlope"], "slope limit") < 0:
        raise ValueError("negative slope limit")
    start = number(request["sweep"]["startRad"], "sweep start")
    end = number(request["sweep"]["endRad"], "sweep end")
    if not isinstance(request["sweep"]["fullCircle"], bool):
        raise ValueError("fullCircle must be boolean")
    if end == start or abs(end - start) > 2 * math.pi + 1e-9:
        raise ValueError("sweep must be nonzero and at most one revolution")
    if request["sweep"]["fullCircle"] and abs(abs(end - start) - 2 * math.pi) > 1e-9:
        raise ValueError("full circle must span one revolution")
    if request["trajectory"]["interpolation"] != "linear":
        raise ValueError("only piecewise linear theta/alpha trajectories supported")
    knots = request["trajectory"]["knots"]
    if not isinstance(knots, list) or not 2 <= len(knots) <= 4097:
        raise ValueError("require 2..4097 trajectory knots")
    for knot in knots:
        number(knot["thetaRad"], "theta")
        number(knot["alphaRad"], "alpha")
    if abs(knots[0]["thetaRad"] - start) > 1e-9 or abs(knots[-1]["thetaRad"] - end) > 1e-9:
        raise ValueError("trajectory endpoints do not cover declared sweep")
    sign = math.copysign(1, end - start)
    if any(sign * (b["thetaRad"] - a["thetaRad"]) <= 0 for a, b in zip(knots, knots[1:])):
        raise ValueError("trajectory knots must follow the declared sweep")


def xy(z: complex) -> tuple[float, float]:
    return z.real, z.imag


def frame(request: dict, theta: float, alpha: float) -> dict:
    """Independently formulated complex-plane forward geometry."""
    m = request["model"]
    center = complex(*m["pivot"])
    main_rotation = cmath.exp(1j * theta)
    arm_rotation = cmath.exp(1j * (theta + alpha))
    hinge = center + m["mainRadiusM"] * main_rotation
    sdu = hinge + m["armLengthM"] * arm_rotation
    end = hinge + (m["armLengthM"] + m["overhangM"]) * arm_rotation
    return {
        "pivot": xy(center), "hinge": xy(hinge), "sdu": xy(sdu), "end": xy(end),
        "towers": [xy(center + r * main_rotation) for r in m["towerRadiiM"]],
        "antenna": xy(sdu + complex(*m["antennaOffsetM"]) * arm_rotation),
        "wheels": [xy(sdu + complex(*v) * arm_rotation) for v in m["wheelOffsetsM"]],
    }


def site_geometry(request: dict):
    field = Polygon(request["field"]["outer"], request["field"]["holes"])
    obstacles = [Polygon(p) for p in request["obstacles"]]
    if not field.is_valid or field.area <= 0 or any(not p.is_valid or p.area <= 0 for p in obstacles):
        raise ValueError("invalid field/obstacle polygon")
    return field, obstacles


def skeleton(pose: dict):
    return [LineString([pose["pivot"], pose["hinge"]]),
            LineString([pose["hinge"], pose["end"]]),
            Point(pose["antenna"]), *(Point(p) for p in pose["wheels"])]


def pose_clearance(request: dict, pose: dict, site=None) -> float:
    """Positive clearance margin or negative collision penalty, using GEOS.

    Negative values use intersection/outside length as an optimizer penalty;
    they are not physical penetration depths and must not be compared as such.
    """
    field, obstacles = site if site is not None else site_geometry(request)
    radius = request["model"]["bodyHalfWidthM"] + request["clearanceM"]
    values = []
    for shape in skeleton(pose):
        if field.covers(shape):
            gap = shape.distance(field.boundary)
        else:
            outside = shape.difference(field)
            gap = -max(outside.length, shape.distance(field), 1e-12)
        values.append(gap - radius)
        for obstacle in obstacles:
            gap = shape.distance(obstacle)
            if shape.intersects(obstacle):
                gap = -max(shape.intersection(obstacle).length, 1e-12)
            values.append(gap - radius)
    return float(min(values))


def linear_samples(request: dict, per_interval: int = 4):
    if per_interval < 1:
        raise ValueError("per_interval must be positive")
    knots = request["trajectory"]["knots"]
    if len(knots) < 2:
        raise ValueError("at least two trajectory knots required")
    direction = math.copysign(1, request["sweep"]["endRad"] - request["sweep"]["startRad"])
    for i, (a, b) in enumerate(zip(knots, knots[1:])):
        dt = b["thetaRad"] - a["thetaRad"]
        if direction * dt <= 0:
            raise ValueError("trajectory knots must follow the declared sweep")
        for j in range(per_interval):
            f = j / per_interval
            yield (a["thetaRad"] + f * dt,
                   a["alphaRad"] + f * (b["alphaRad"] - a["alphaRad"]))
    yield knots[-1]["thetaRad"], knots[-1]["alphaRad"]


def oracle(request: dict, per_interval: int = 4) -> dict:
    validate_request(request)
    site = site_geometry(request)
    minimum = math.inf
    rigid_residual = 0.0
    count = 0
    for theta, alpha in linear_samples(request, per_interval):
        p = frame(request, theta, alpha)
        minimum = min(minimum, pose_clearance(request, p, site))
        rigid_residual = max(rigid_residual, abs(math.dist(p["hinge"], p["sdu"]) - request["model"]["armLengthM"]))
        count += 1
    return {
        "claimClass": "synthetic_sampled_geometry", "continuousClearanceProved": False,
        "sampleCount": count, "minimumSampledClearanceOrPenaltyM": minimum,
        "negativeValueMeaning": "collision penalty, not physical penetration distance",
        "maximumRigidLengthResidualM": rigid_residual,
        "sampledCollision": minimum < 0,
        "terrainStatus": "planar_model_only_terrain_unresolved",
    }


def extension_objective(theta: np.ndarray, alpha: np.ndarray) -> float:
    slope = np.diff(alpha) / np.diff(theta)
    span = abs(theta[-1] - theta[0])
    if span == 0:
        raise ValueError("zero sweep")
    widths = np.abs(np.diff(theta))
    extension = (1 - np.cos(alpha[:-1]) + 1 - np.cos(alpha[1:])) / 2
    return float(np.sum(widths * (extension + 0.05 * slope * slope)) / span)


def sampled_objective(request: dict) -> float:
    knots = request["trajectory"]["knots"]
    return extension_objective(np.array([k["thetaRad"] for k in knots]),
                               np.array([k["alphaRad"] for k in knots]))


def spline_candidate(request: dict, controls: int = 9, samples: int = 65, maxiter: int = 100) -> tuple[dict, dict]:
    """Deterministic multistart SLSQP collocation; not a completeness proof."""
    validate_request(request)
    if not (4 <= controls <= 33 and controls <= samples <= 513 and 1 <= maxiter <= 500):
        raise ValueError("require 4..33 controls, controls..513 samples and 1..500 iterations")
    start, end = request["sweep"]["startRad"], request["sweep"]["endRad"]
    delta = end - start
    if delta == 0:
        raise ValueError("zero sweep")
    closed = request["sweep"]["fullCircle"]
    lo, hi = request["limits"]["articulationRad"]
    max_slope = request["limits"]["maxArticulationSlope"]
    if not (lo < hi and max_slope > 0):
        raise ValueError("optimizer requires a nonzero articulation range and positive slope limit")
    site = site_geometry(request)
    control_t = np.linspace(0, 1, controls)
    sample_t = np.linspace(0, 1, samples)
    theta = start + delta * sample_t
    count = controls - 1 if closed else controls

    def spline(x):
        y = np.r_[x, x[0]] if closed else x
        return CubicSpline(control_t, y, bc_type="periodic" if closed else "natural")

    def objective(x):
        s = spline(x)
        a, slope = s(sample_t), s(sample_t, 1) / delta
        return float(np.trapezoid(1 - np.cos(a) + 0.05 * slope * slope, sample_t))

    def constraints(x):
        s = spline(x)
        a, slope = s(sample_t), s(sample_t, 1) / delta
        # These are collocation constraints only. The independent interval
        # verifier decides the exported trajectory's spatial outcome later.
        gaps = [pose_clearance(request, frame(request, t, v), site) for t, v in zip(theta, a)]
        return np.r_[a - lo, hi - a, max_slope - slope, max_slope + slope, gaps]

    attempts = []
    solutions = []
    for seed in [(lo + hi) / 2, lo + 0.85 * (hi - lo)]:
        result = minimize(objective, np.full(count, seed), method="SLSQP",
                          bounds=[(lo, hi)] * count,
                          constraints={"type": "ineq", "fun": constraints},
                          options={"maxiter": maxiter, "ftol": 1e-8, "disp": False})
        min_constraint = float(np.min(constraints(result.x)))
        attempt = {"seedRad": seed, "solverSuccess": bool(result.success),
                   "message": str(result.message), "iterations": int(result.nit),
                   "objective": objective(result.x), "minimumCollocationConstraint": min_constraint}
        attempts.append(attempt)
        # A returned vector remains a candidate even when the solver failed.
        # Selection prefers collocation feasibility but never certifies it.
        solutions.append((min_constraint < -1e-7, objective(result.x), result.x))
    solutions.sort(key=lambda row: (row[0], row[1]))
    chosen = solutions[0]
    export_t = np.linspace(0, 1, 129)
    export_theta = start + delta * export_t
    a = spline(chosen[2])(export_t)
    if closed:
        a[-1] = a[0]
        # Explicit linear-surrogate seam projection: equal first/last secants.
        # This changes two points; all constraints must be rechecked afterward.
        step = export_theta[1] - export_theta[0]
        slope = ((a[1] - a[0]) / step + (a[-1] - a[-2]) / step) / 2
        a[1], a[-2] = a[0] + slope * step, a[0] - slope * step
    candidate = copy.deepcopy(request)
    candidate["id"] += "-spline-linear-candidate"
    candidate["trajectory"] = {"interpolation": "linear", "knots": [
        {"thetaRad": float(t), "alphaRad": float(v)} for t, v in zip(export_theta, a)]}
    report = {
        "method": "scipy_slsqp_cubic_collocation_then_linear_surrogate",
        "status": "candidate_requires_independent_verification",
        "controls": controls, "collocationSamples": samples,
        "maxIterationsPerStart": maxiter, "attempts": attempts,
        "periodicLinearSeamProjection": bool(closed),
        "verifiedObject": "none_until_TypeScript_verifier_runs",
        "originalCubicCurveVerified": False,
        "objectiveMeaning": "dimensionless extension loss plus 0.05 articulation-slope squared; not watered area",
        "linearCandidateObjective": sampled_objective(candidate),
        "sampledOracle": oracle(candidate),
    }
    return candidate, report


def reference_checks() -> dict:
    # Independent exact integer-area oracle and central-meridian UTM identity.
    a = Polygon([(0, 0), (4, 0), (4, 3), (0, 3)])
    b = Polygon([(2, 1), (6, 1), (6, 4), (2, 4)])
    measured = {"union": a.union(b).area, "intersection": a.intersection(b).area,
                "difference": a.difference(b).area, "xor": a.symmetric_difference(b).area}
    expected = {"union": 20, "intersection": 4, "difference": 8, "xor": 16}
    transform = Transformer.from_crs("EPSG:4326", "EPSG:32614", always_xy=True)
    e, n = transform.transform(-99, 0)
    inverse = Transformer.from_crs("EPSG:32614", "EPSG:4326", always_xy=True)
    lon, lat = inverse.transform(e, n)
    # Endpoint clipping is an explicitly invalid negative control.
    hinge, unclipped = (30, 0), (40, 0)
    clipped = (min(unclipped[0], 35), unclipped[1])
    return {"polygonAreasM2": measured, "expectedPolygonAreasM2": expected,
            "polygonMaxErrorM2": max(abs(measured[k] - v) for k, v in expected.items()),
            "utmCentralMeridianErrorM": math.hypot(e - 500000, n),
            "crsRoundTripErrorDeg": math.hypot(lon + 99, lat),
            "clippedEndpointNegativeControlLengthErrorM": abs(math.dist(hinge, clipped) - 10)}


def environment() -> dict:
    return {"python": platform.python_version(),
            "packages": {p: importlib.metadata.version(p) for p in ["numpy", "scipy", "shapely", "pyproj"]},
            "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "lockSha256": hashlib.sha256(Path(__file__).with_name("uv.lock").read_bytes()).hexdigest(),
            "projVersion": proj_version_str, "projNetworkEnabled": network.is_network_enabled(),
            "networkRequiredAfterInstall": False}


def emit(value: dict):
    print(json.dumps(value, indent=2, allow_nan=False))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["reference", "oracle", "optimize"])
    parser.add_argument("input", nargs="?", type=Path)
    parser.add_argument("--candidate", type=Path, help="new candidate JSON path; refuses overwrite")
    parser.add_argument("--maxiter", type=int, default=100)
    args = parser.parse_args()
    if args.command == "reference":
        emit({"environment": environment(), "checks": reference_checks()})
        return 0
    if args.input is None:
        parser.error("input JSON is required")
    request = read_request(args.input)
    input_hash = hashlib.sha256(args.input.read_bytes()).hexdigest()
    if args.command == "oracle":
        emit({"environment": environment(), "inputSha256": input_hash, "result": oracle(request)})
    else:
        if args.candidate is None:
            parser.error("--candidate is required for optimize")
        if args.candidate.exists():
            parser.error("candidate path exists; choose a new path")
        candidate, report = spline_candidate(request, maxiter=args.maxiter)
        # Do not create parents or overwrite source fixtures implicitly.
        with args.candidate.open("x") as stream:
            stream.write(json.dumps(candidate, indent=2, allow_nan=False) + "\n")
        emit({"environment": environment(), "inputSha256": input_hash,
              "candidateSha256": hashlib.sha256(args.candidate.read_bytes()).hexdigest(), "result": report})
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, OSError) as error:
        print(json.dumps({"status": "invalid_research_input", "message": str(error)}), file=sys.stderr)
        raise SystemExit(2)
