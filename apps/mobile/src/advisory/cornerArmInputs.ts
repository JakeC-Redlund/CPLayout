import { feetToMeters, metersToFeet, VALLEY_CORNER_ARM_SCAFFOLD_CATALOG, type PivotProject } from "@cplayout/core";
import type { CornerArmKinematicInputs } from "@cplayout/geometry";

export interface CornerArmInputDraft {
  speed: string;
  // The requested US form owns this raw text independently of project preferences.
  speedUnit: "ft/min";
  modelId: string;
  rotation: "" | "clockwise" | "counterclockwise";
  orientation: "" | "leading" | "trailing";
  guidanceFeatureId: string;
}

export function cornerArmInputScope(project: PivotProject): string {
  return JSON.stringify([project.id, project.projectCrs, project.pivotCenter, project.machine,
    project.fieldBoundary, project.obstacles, project.mapFeatures]);
}

export function initialCornerArmInputs(project: PivotProject): CornerArmInputDraft {
  const speed = project.machine.driveUnits?.lrdu?.operatorMeasuredSpeedMetersPerMinute;
  const orientation = project.machine.cornerArm?.orientation;
  return {
    speed: typeof speed === "number" && Number.isFinite(speed) && speed > 0 && Number.isFinite(metersToFeet(speed))
      ? String(metersToFeet(speed)) : "",
    speedUnit: "ft/min",
    modelId: "",
    rotation: project.machine.sweep.mode === "partial_circle" ? project.machine.sweep.direction : "",
    orientation: orientation === "leading" || orientation === "trailing" ? orientation : "",
    guidanceFeatureId: "",
  };
}

export function cornerGuidanceCandidates(project: PivotProject) {
  const features = project.mapFeatures ?? [];
  const counts = new Map<string, number>();
  for (const feature of features) counts.set(feature.id, (counts.get(feature.id) ?? 0) + 1);
  return features.filter(feature => {
    if (counts.get(feature.id) !== 1 || feature.geometry.type !== "LineString") return false;
    const vertices = feature.geometry.vertices;
    return vertices.length >= 2
      && vertices.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))
      && vertices.some(point => point.x !== vertices[0].x || point.y !== vertices[0].y);
  });
}

export function cornerArmInputsForPreview(project: PivotProject, draft: CornerArmInputDraft, safetyZoneMeters: number): {
  inputs: CornerArmKinematicInputs;
  missing: string[];
} {
  const speedText = draft.speed.trim();
  const speed = draft.speedUnit === "ft/min" && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(speedText)
    ? feetToMeters(Number(speedText)) : NaN;
  const modelSpec = VALLEY_CORNER_ARM_SCAFFOLD_CATALOG.find(entry => entry.id === draft.modelId);
  const rotationDirection = draft.rotation === "clockwise" || draft.rotation === "counterclockwise" ? draft.rotation : undefined;
  const orientation = draft.orientation === "leading" || draft.orientation === "trailing" ? draft.orientation : undefined;
  const feature = cornerGuidanceCandidates(project).find(entry => entry.id === draft.guidanceFeatureId);
  const guidancePath = feature?.geometry.type === "LineString" ? feature.geometry.vertices.map(point => ({ ...point })) : undefined;
  const missing = [
    Number.isFinite(speed) && speed > 0 ? null : "Positive last regular drive tower speed in ft/min",
    modelSpec ? null : "Corner model",
    rotationDirection ? null : "Rotation direction",
    orientation ? null : "Leading or trailing orientation",
    guidancePath ? null : "Steerable corner tower guidance line",
    project.machine.sweep.mode === "partial_circle" && rotationDirection && rotationDirection !== project.machine.sweep.direction
      ? "Rotation must match the saved partial sweep" : null,
  ].filter((value): value is string => value !== null);
  return {
    missing,
    inputs: {
      projectCrs: project.projectCrs,
      pivotCenter: { ...project.pivotCenter },
      pivotCenterToLrduRadiusMeters: project.machine.spanLengthsMeters.reduce((sum, span) => sum + span, 0),
      lrduSpeedMetersPerMinuteAt100Percent: Number.isFinite(speed) && speed > 0 ? speed : undefined,
      modelSpec: modelSpec ? {
        ...modelSpec,
        sourceRefs: modelSpec.sourceRefs.map(reference => ({ ...reference })),
        notes: [...modelSpec.notes],
        lrduSpeedTableRows: modelSpec.lrduSpeedTableRows?.map(row => ({ ...row })),
      } : undefined,
      rotationDirection,
      orientation,
      sweep: { ...project.machine.sweep },
      fieldBoundary: project.fieldBoundary.map(point => ({ ...point })),
      obstacles: project.obstacles.map(obstacle => ({ ...obstacle, polygon: obstacle.polygon.map(point => ({ ...point })) })),
      guidancePath,
      endGunThrowMeters: project.machine.endGunThrowMeters,
      endGunAngleRanges: project.machine.endGunAngleRanges?.map(range => ({ ...range })),
      safetyZoneMeters,
    },
  };
}
