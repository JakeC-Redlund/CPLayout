import {
  CORNER_GPS_MAP_DEFAULT_REVIEW_SETTINGS,
  qualifyProjectCrs,
  CornerGpsMapLegacyEvidence,
  CornerGpsMapModelPreset,
  CornerGpsMapReviewSettings,
  PivotProject,
  ProjectMapFeature,
  XY,
} from "@cplayout/core";

import { endGunRadiusMeters, machineRadiusMeters } from "./geometry";

export type CornerGpsMapAdvisoryReviewStatus = "ready" | "blocked";
export type CornerGpsMapAdvisoryIssueSeverity = "info" | "warning" | "blocker";
export type CornerGpsMapCompatibilityStatus = "unverified";

export interface CornerGpsMapAdvisoryIssue {
  severity: CornerGpsMapAdvisoryIssueSeverity;
  code: string;
  message: string;
  shortfallMeters?: number;
}

export interface CornerGpsMapAdvisoryCompatibility {
  manufacturerKinematics: CornerGpsMapCompatibilityStatus;
  sduLrduSteering: CornerGpsMapCompatibilityStatus;
  ggsControllerExport: CornerGpsMapCompatibilityStatus;
  vriControllerExport: CornerGpsMapCompatibilityStatus;
  sprinklerSequencing: CornerGpsMapCompatibilityStatus;
}

export interface CornerGpsMapAdvisoryViolation {
  severity: CornerGpsMapAdvisoryIssueSeverity;
  code: string;
  message: string;
  measuredMeters?: number;
  thresholdMeters?: number;
  shortfallMeters?: number;
  sourceRefIds: string[];
  evidenceFeatureIds: string[];
}

export interface CornerGpsMapAdvisoryReviewMetrics {
  machineRadiusMeters: number;
  endGunRadiusMeters: number;
  minBoundaryDistanceFromPivotMeters: number | null;
  lrduBoundaryClearanceMeters: number | null;
  endGunBoundaryClearanceMeters: number | null;
  minObstacleClearanceMeters: number | null;
  modelMinCornerAngleDegrees: number | null;
  modelMaxCornerAngleDegrees: number | null;
  legacyEvidenceCount: number;
}

export interface CornerGpsMapAdvisoryReview {
  status: CornerGpsMapAdvisoryReviewStatus;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  unverifiedManufacturerKinematics: true;
  qualifiedReviewRequired: true;
  compatibility: CornerGpsMapAdvisoryCompatibility;
  settings: CornerGpsMapReviewSettings;
  metrics: CornerGpsMapAdvisoryReviewMetrics;
  issues: CornerGpsMapAdvisoryIssue[];
  violations: CornerGpsMapAdvisoryViolation[];
  advisoryPathFeatureIds: string[];
  legacyEvidenceKinds: string[];
}

export interface CornerGpsMapAdvisoryReviewOptions {
  settings?: CornerGpsMapReviewSettings;
  legacyEvidence?: CornerGpsMapLegacyEvidence[];
  modelPreset?: CornerGpsMapModelPreset;
}

const ADVISORY_PATH_FEATURE_KINDS = new Set<ProjectMapFeature["kind"]>([
  "machine_zone",
  "linear_move_path",
  "measurement_line",
  "end_gun_arc",
  "corner_swing_limit",
]);

export function evaluateCornerGpsMapAdvisoryReview(
  project: PivotProject,
  options: CornerGpsMapAdvisoryReviewOptions = {},
): CornerGpsMapAdvisoryReview {
  const settings = options.settings ?? CORNER_GPS_MAP_DEFAULT_REVIEW_SETTINGS;
  const legacyEvidence = options.legacyEvidence ?? [];
  const modelPreset = options.modelPreset;
  const compatibility: CornerGpsMapAdvisoryCompatibility = {
    manufacturerKinematics: "unverified",
    sduLrduSteering: "unverified",
    ggsControllerExport: "unverified",
    vriControllerExport: "unverified",
    sprinklerSequencing: "unverified",
  };
  const issues: CornerGpsMapAdvisoryIssue[] = [
    {
      severity: "warning",
      code: "unverified_manufacturer_kinematics",
      message: "CornerGPSMap-inspired review is advisory only; proprietary path generation, steering, GGS/VRI export, and sprinkler sequencing remain unverified.",
    },
    {
      severity: "warning",
      code: "unverified_sdu_lrdu_steering",
      message: "SDU/LRDU steering behavior is not reproduced or certified by this advisory review.",
    },
    {
      severity: "warning",
      code: "unverified_ggs_vri_controller_compatibility",
      message: "GGS and VRI controller compatibility remains unverified; parsed legacy output is evidence only.",
    },
    {
      severity: "warning",
      code: "unverified_sprinkler_sequencing",
      message: "Sprinkler sequencing and variable-rate controller behavior remain unverified.",
    },
  ];
  const machineRadius = machineRadiusMeters(project.machine);
  const endGunRadius = endGunRadiusMeters(project.machine);
  let minBoundaryDistance: number | null = null;
  let lrduBoundaryClearance: number | null = null;
  let endGunBoundaryClearance: number | null = null;
  let minObstacleClearance: number | null = null;
  const lrduThresholdMeters = Math.max(
    settings.minLrduBoundaryClearanceMeters,
    modelPreset?.minLrduBoundaryDistanceMeters ?? 0,
  );

  const qualification = qualifyProjectCrs(project.projectCrs);
  if (!qualification.calculation.allowed) {
    issues.push({ severity: "blocker", code: "unqualified_metric_crs", message: `Metric planar calculations unavailable: ${qualification.calculation.blockers.join(", ")}.` });
  } else if (project.fieldBoundary.length < 3) {
    issues.push({
      severity: "blocker",
      code: "missing_projected_boundary",
      message: "Projected field boundary is required before CornerGPSMap advisory review.",
    });
  } else {
    minBoundaryDistance = minDistanceToRing(project.pivotCenter, project.fieldBoundary);
    lrduBoundaryClearance = minBoundaryDistance - machineRadius;
    endGunBoundaryClearance = minBoundaryDistance - endGunRadius - settings.safetyZoneMeters;
    if (lrduBoundaryClearance < lrduThresholdMeters) {
      issues.push({
        severity: "blocker",
        code: "lrdu_boundary_clearance_shortfall",
        message: "Estimated LRDU clearance to the projected field boundary is below the source-labeled CornerGPSMap review minimum.",
        shortfallMeters: lrduThresholdMeters - lrduBoundaryClearance,
      });
    }
    if (endGunBoundaryClearance < 0) {
      issues.push({
        severity: "warning",
        code: "end_gun_boundary_review",
        message: "Estimated end-gun reach plus source-labeled safety zone reaches beyond the projected field boundary.",
        shortfallMeters: Math.abs(endGunBoundaryClearance),
      });
    }
  }

  if (qualification.calculation.allowed && project.obstacles.length > 0) {
    minObstacleClearance = Math.min(...project.obstacles.map((obstacle) => {
      const radialDistance = minDistanceToRing(project.pivotCenter, obstacle.polygon);
      return Math.abs(radialDistance - machineRadius) - obstacle.bufferMeters;
    }));
    if (minObstacleClearance < settings.safetyZoneMeters) {
      issues.push({
        severity: "warning",
        code: "obstacle_clearance_review",
        message: "At least one obstacle is close to the estimated LRDU radius and needs qualified review.",
        shortfallMeters: settings.safetyZoneMeters - minObstacleClearance,
      });
    }
  } else if (project.obstacles.length === 0) {
    issues.push({
      severity: "info",
      code: "no_obstacle_evidence",
      message: "No obstacle polygons are saved; CornerGPSMap-style obstacle clearance cannot be reviewed.",
    });
  }

  const advisoryPathFeatureIds = (project.mapFeatures ?? [])
    .filter((feature) => ADVISORY_PATH_FEATURE_KINDS.has(feature.kind))
    .map((feature) => feature.id);
  const guidancePathFeatureIds = (project.mapFeatures ?? [])
    .filter((feature) => feature.kind === "linear_move_path" || feature.kind === "measurement_line" || feature.kind === "corner_swing_limit")
    .map((feature) => feature.id);
  const hasCornerSwingLimitEvidence = (project.mapFeatures ?? []).some((feature) => feature.kind === "corner_swing_limit");
  if (advisoryPathFeatureIds.length === 0) {
    issues.push({
      severity: "info",
      code: "no_advisory_path_features",
      message: "No LRDU, SDU, end-gun, machine-zone, or corner-swing evidence features are saved for review.",
    });
  }
  if (guidancePathFeatureIds.length === 0) {
    issues.push({
      severity: "warning",
      code: "missing_guidance_path_evidence",
      message: "No imported or manually drawn guidance-path evidence is saved for corner-arm path review.",
    });
  }

  if (!project.machine.cornerArm) {
    issues.push({
      severity: "warning",
      code: "missing_corner_arm_config",
      message: "No advisory corner-arm configuration is selected on the machine.",
    });
  }

  if (modelPreset) {
    issues.push({
      severity: "info",
      code: "legacy_flt_metadata_only",
      message: "CornerGPSMap model preset metadata is imported as advisory evidence only and does not prove FLT/controller compatibility.",
    });
    if (
      modelPreset.minCornerAngleDegrees !== undefined
      && modelPreset.maxCornerAngleDegrees !== undefined
      && modelPreset.minCornerAngleDegrees > modelPreset.maxCornerAngleDegrees
    ) {
      issues.push({
        severity: "blocker",
        code: "invalid_corner_angle_limits",
        message: "CornerGPSMap model preset minimum corner angle is greater than its maximum corner angle.",
      });
    } else if (modelPreset.minCornerAngleDegrees !== undefined || modelPreset.maxCornerAngleDegrees !== undefined) {
      issues.push({
        severity: hasCornerSwingLimitEvidence ? "info" : "warning",
        code: "model_corner_angle_limits_advisory",
        message: "CornerGPSMap model min/max corner-angle limits are available as metadata; CPLayout does not reproduce proprietary path kinematics.",
      });
    }
  }

  for (const evidence of legacyEvidence) {
    if (evidence.vriSummary.zoneCount > 0) {
      issues.push({
        severity: "info",
        code: `legacy_${evidence.kind}_vri_zone_summary`,
        message: `Parsed ${evidence.vriSummary.zoneCount} legacy VRI zone${evidence.vriSummary.zoneCount === 1 ? "" : "s"} as advisory evidence only.`,
      });
    }
    if (evidence.statusSummary.values.length > 0) {
      issues.push({
        severity: "info",
        code: `legacy_${evidence.kind}_status_fields_present`,
        message: `Parsed ${evidence.statusSummary.values.length} legacy status value${evidence.statusSummary.values.length === 1 ? "" : "s"} for operator review.`,
      });
    }
    for (const warning of evidence.warnings) {
      issues.push({
        severity: "warning",
        code: `legacy_${evidence.kind}_evidence_warning`,
        message: warning,
      });
    }
    for (const violation of evidence.violations) {
      issues.push({
        severity: violation.severity,
        code: `legacy_${evidence.kind}_${violation.code}`,
        message: violation.message,
      });
    }
  }

  const violations = issues
    .filter((issue) => issue.severity !== "info")
    .map((issue) => issueToViolation(issue, {
      lrduBoundaryClearance,
      lrduThresholdMeters,
      endGunBoundaryClearance,
      obstacleThresholdMeters: settings.safetyZoneMeters,
      advisoryPathFeatureIds,
      sourceRefIds: [
        ...settings.sourceRefs.map((sourceRef) => sourceRef.sourceId),
        ...legacyEvidence.flatMap((evidence) => evidence.sourceRef?.sourceId ? [evidence.sourceRef.sourceId] : []),
        ...(modelPreset?.sourceRef?.sourceId ? [modelPreset.sourceRef.sourceId] : []),
      ],
    }));

  return {
    status: issues.some((issue) => issue.severity === "blocker") ? "blocked" : "ready",
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    unverifiedManufacturerKinematics: true,
    qualifiedReviewRequired: true,
    compatibility,
    settings,
    metrics: {
      machineRadiusMeters: machineRadius,
      endGunRadiusMeters: endGunRadius,
      minBoundaryDistanceFromPivotMeters: minBoundaryDistance,
      lrduBoundaryClearanceMeters: lrduBoundaryClearance,
      endGunBoundaryClearanceMeters: endGunBoundaryClearance,
      minObstacleClearanceMeters: minObstacleClearance,
      modelMinCornerAngleDegrees: modelPreset?.minCornerAngleDegrees ?? null,
      modelMaxCornerAngleDegrees: modelPreset?.maxCornerAngleDegrees ?? null,
      legacyEvidenceCount: legacyEvidence.length,
    },
    issues,
    violations,
    advisoryPathFeatureIds,
    legacyEvidenceKinds: [...new Set(legacyEvidence.map((evidence) => evidence.kind))],
  };
}

function issueToViolation(
  issue: CornerGpsMapAdvisoryIssue,
  context: {
    lrduBoundaryClearance: number | null;
    lrduThresholdMeters: number;
    endGunBoundaryClearance: number | null;
    obstacleThresholdMeters: number;
    advisoryPathFeatureIds: string[];
    sourceRefIds: string[];
  },
): CornerGpsMapAdvisoryViolation {
  if (issue.code === "lrdu_boundary_clearance_shortfall") {
    return {
      ...baseViolation(issue, context),
      measuredMeters: context.lrduBoundaryClearance ?? undefined,
      thresholdMeters: context.lrduThresholdMeters,
      shortfallMeters: issue.shortfallMeters,
    };
  }
  if (issue.code === "end_gun_boundary_review") {
    return {
      ...baseViolation(issue, context),
      measuredMeters: context.endGunBoundaryClearance ?? undefined,
      thresholdMeters: 0,
      shortfallMeters: issue.shortfallMeters,
    };
  }
  if (issue.code === "obstacle_clearance_review") {
    return {
      ...baseViolation(issue, context),
      thresholdMeters: context.obstacleThresholdMeters,
      shortfallMeters: issue.shortfallMeters,
    };
  }
  return baseViolation(issue, context);
}

function baseViolation(
  issue: CornerGpsMapAdvisoryIssue,
  context: { advisoryPathFeatureIds: string[]; sourceRefIds: string[] },
): CornerGpsMapAdvisoryViolation {
  return {
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    shortfallMeters: issue.shortfallMeters,
    sourceRefIds: [...new Set(context.sourceRefIds)],
    evidenceFeatureIds: context.advisoryPathFeatureIds,
  };
}

function minDistanceToRing(point: XY, ring: XY[]): number {
  if (ring.length === 0) return Number.POSITIVE_INFINITY;
  let minDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    minDistance = Math.min(minDistance, distancePointToSegment(point, a, b));
  }
  return minDistance;
}

function distancePointToSegment(point: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

function distance(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
