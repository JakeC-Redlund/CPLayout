from __future__ import annotations

from typing import Any

DEFAULT_VISION_THRESHOLDS = {
    "maxCenterOffsetRatio": 0.05,
    "maxCenterTruthOffsetPx": 20.0,
    "maxRadiusMismatchRatio": 0.05,
    "maxBoundaryFalsePositiveRatio": 0.08,
    "maxBoundaryMeanDistancePx": 80.0,
    "minOperatorBoundaryIoU": 0.72,
    "minBoundaryEdgeAlignment": 0.12,
    "minDetectionConfidence": 0.65,
    "minFieldBoundaryConfidence": 0.58,
}


def best_operator_metric(operator_comparison: list[dict[str, Any]], key: str) -> float | None:
    if not operator_comparison:
        return None
    value = operator_comparison[0].get(key)
    return float(value) if isinstance(value, (int, float)) else None



def boundary_improvement_acceptance(
    best_candidate: dict[str, Any] | None,
    best_iteration: dict[str, Any] | None,
    operator_polygon: list[dict[str, Any]] | None,
    gpu_status: dict[str, Any] | None = None,
    projected_boundary: list[dict[str, float]] | None = None,
    failure_mode: dict[str, Any] | None = None,
) -> dict[str, Any]:
    reasons = []
    accepted = True
    if best_candidate is None:
        accepted = False
        reasons.append("no boundary candidate was produced")
    elif best_candidate.get("rejected"):
        accepted = False
        reasons.append("best candidate is rejected by imagery-only gates")
    elif float(best_candidate.get("confidence", 0)) < DEFAULT_VISION_THRESHOLDS["minFieldBoundaryConfidence"]:
        accepted = False
        reasons.append("best candidate confidence is below strict boundary threshold")
    if operator_polygon is not None:
        best_iou = best_candidate.get("operatorLabelAlignment") if best_candidate is not None else None
        if best_iou is None:
            best_iou = best_iteration.get("bestOperatorIoU") if best_iteration else None
        if best_iou is None or best_iou < DEFAULT_VISION_THRESHOLDS["minOperatorBoundaryIoU"]:
            accepted = False
            reasons.append(f"best candidate does not meet operator-label IoU gate of {DEFAULT_VISION_THRESHOLDS['minOperatorBoundaryIoU']}")
        if best_candidate is not None:
            false_positive = best_candidate.get("operatorFalsePositiveAreaRatio")
            if isinstance(false_positive, (int, float)) and false_positive > DEFAULT_VISION_THRESHOLDS["maxBoundaryFalsePositiveRatio"]:
                accepted = False
                reasons.append(f"best candidate false-positive area ratio {false_positive:.4f} exceeds {DEFAULT_VISION_THRESHOLDS['maxBoundaryFalsePositiveRatio']:.2f}")
            mean_distance = best_candidate.get("operatorBoundaryMeanDistancePixels")
            if isinstance(mean_distance, (int, float)) and mean_distance > DEFAULT_VISION_THRESHOLDS["maxBoundaryMeanDistancePx"]:
                accepted = False
                reasons.append(f"best candidate mean boundary distance {mean_distance:.1f} px exceeds {DEFAULT_VISION_THRESHOLDS['maxBoundaryMeanDistancePx']:.0f} px")
    if projected_boundary is None:
        accepted = False
        reasons.append("no calibrated projected-XY CV candidate boundary was produced")
    if failure_mode is not None:
        accepted = False
        reasons.append(f"failure mode: {failure_mode['code']}")
    return {
        "accepted": accepted,
        "status": "accepted" if accepted else "not accepted",
        "gpuBacked": False,
        "autoApplyEligible": False,
        "operatorReviewRequired": True,
        "reasons": reasons,
        "hardFailures": reasons,
        "cvCandidateAccepted": accepted,
        "truthBoundaryAccepted": operator_polygon is not None,
        "truthBoundaryMode": "operator_truth_reconstruction" if operator_polygon is not None else None,
        "failureMode": failure_mode,
        "importantCaveat": "Acceptance here is local companion evidence only and still does not mutate projected XY geometry.",
    }



def design_hard_failures(
    imagery_field_boundary: dict[str, Any] | None,
    operator_comparison: list[dict[str, Any]],
    truth_metrics: dict[str, Any],
    road_building_tree_conflict: dict[str, Any],
) -> list[str]:
    failures = []
    if imagery_field_boundary is not None and imagery_field_boundary.get("rejected"):
        failures.extend(imagery_field_boundary.get("rejectionReasons", []))
    false_positive = best_operator_metric(operator_comparison, "falsePositiveAreaRatio")
    if false_positive is not None and false_positive > DEFAULT_VISION_THRESHOLDS["maxBoundaryFalsePositiveRatio"]:
        failures.append(f"Boundary false-positive area ratio {false_positive:.4f} exceeds {DEFAULT_VISION_THRESHOLDS['maxBoundaryFalsePositiveRatio']:.2f}.")
    mean_distance = best_operator_metric(operator_comparison, "boundaryMeanDistancePixels")
    if mean_distance is not None and mean_distance > DEFAULT_VISION_THRESHOLDS["maxBoundaryMeanDistancePx"]:
        failures.append(f"Boundary mean distance {mean_distance:.1f} px exceeds {DEFAULT_VISION_THRESHOLDS['maxBoundaryMeanDistancePx']:.0f} px.")
    center_offset = truth_metrics.get("centerTruthOffsetPx")
    if isinstance(center_offset, (int, float)) and center_offset > DEFAULT_VISION_THRESHOLDS["maxCenterTruthOffsetPx"]:
        failures.append(f"Visible pivot center is {center_offset:.1f} px from TRUE_PIVOT_CENTER.")
    radius_mismatch = truth_metrics.get("radiusTruthMismatchRatio")
    if isinstance(radius_mismatch, (int, float)) and radius_mismatch > DEFAULT_VISION_THRESHOLDS["maxRadiusMismatchRatio"]:
        failures.append(f"Pivot radius mismatch ratio {radius_mismatch:.4f} exceeds {DEFAULT_VISION_THRESHOLDS['maxRadiusMismatchRatio']:.2f}.")
    if road_building_tree_conflict.get("southRoad"):
        failures.append("CPLayout wet circle crosses SOUTH_ROAD_EXCLUSION.")
    if road_building_tree_conflict.get("seBuildingTree"):
        failures.append("CPLayout wet circle crosses SE_BUILDING_TREE_EXCLUSION.")
    return list(dict.fromkeys(failures))



def cv_boundary_accepted(
    imagery_field_boundary: dict[str, Any] | None,
    operator_comparison: list[dict[str, Any]],
    hard_failures: list[str],
) -> bool:
    if imagery_field_boundary is None or imagery_field_boundary.get("rejected"):
        return False
    if hard_failures:
        return False
    best_iou = best_operator_metric(operator_comparison, "iou")
    if best_iou is not None and best_iou < DEFAULT_VISION_THRESHOLDS["minOperatorBoundaryIoU"]:
        return False
    return True



def assess_design_vision_review(metrics: dict[str, Any]) -> dict[str, Any]:
    warnings = []
    score = 100.0
    if not metrics["overlayVisible"]:
        warnings.append("CPLayout overlay was not detected in the map-canvas screenshot.")
        score -= 30
    if not metrics["attributionPresent"]:
        warnings.append("Full-window Google Earth attribution evidence is missing or unclear.")
        score -= 20
    if metrics["detectionConfidence"] < DEFAULT_VISION_THRESHOLDS["minDetectionConfidence"]:
        warnings.append(f"Visual detection confidence is below {DEFAULT_VISION_THRESHOLDS['minDetectionConfidence']}.")
        score -= 20
    if metrics["inferFieldBoundary"]:
        if metrics["fieldBoundaryConfidence"] is None:
            warnings.append("Imagery field-boundary detector did not find a road/fenceline/treeline/field-separation polygon.")
            score -= 25
        elif metrics["fieldBoundaryConfidence"] < DEFAULT_VISION_THRESHOLDS["minFieldBoundaryConfidence"]:
            warnings.append(f"Imagery field-boundary detector confidence is below {DEFAULT_VISION_THRESHOLDS['minFieldBoundaryConfidence']}.")
            score -= 20
        if not metrics["fieldBoundaryProjected"]:
            warnings.append("Imagery field-boundary polygon was not exported as projected XY because calibration evidence was incomplete.")
            score -= 10
    if metrics["centerOffsetRatio"] is not None and metrics["centerOffsetRatio"] > DEFAULT_VISION_THRESHOLDS["maxCenterOffsetRatio"]:
        warnings.append("Detected CPLayout center offset exceeds 5.0% of pivot radius.")
        score -= min(25, (metrics["centerOffsetRatio"] - DEFAULT_VISION_THRESHOLDS["maxCenterOffsetRatio"]) * 250)
    if metrics["radiusMismatchRatio"] is not None and metrics["radiusMismatchRatio"] > DEFAULT_VISION_THRESHOLDS["maxRadiusMismatchRatio"]:
        warnings.append("Detected CPLayout radius mismatch exceeds 8.0%.")
        score -= min(25, (metrics["radiusMismatchRatio"] - DEFAULT_VISION_THRESHOLDS["maxRadiusMismatchRatio"]) * 220)
    return {
        "score": round(max(0.0, min(100.0, score)), 3),
        "confidence": round(max(0.0, min(1.0, metrics["detectionConfidence"])), 3),
        "warnings": warnings,
        "canonicalGeometryMutation": False,
        "reviewStatus": "unreviewed",
        "designOnly": True,
    }
