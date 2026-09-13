import type { GnssCaptureEvidence, PivotProject, SourceConfidence, XY } from "@cplayout/core";

export interface CapturedDraftVertex {
  projected: XY;
  evidence: GnssCaptureEvidence;
  confidence: SourceConfidence;
  projectId: string;
  projectCrs: string;
}

export function captureDraftMatchesProject(vertices: CapturedDraftVertex[], project: Pick<PivotProject, "id" | "projectCrs">): boolean {
  return vertices.every((vertex) => vertex.projectId === project.id && vertex.projectCrs === project.projectCrs);
}

export function capturedDraftConfidence(vertices: CapturedDraftVertex[]): SourceConfidence {
  const levels: SourceConfidence[] = ["rtk_fixed", "rtk_float", "dgps", "autonomous_gps", "user_estimated"];
  if (vertices.length === 0) return "user_estimated";
  const rank = vertices.reduce((weakest, vertex) => {
    const index = levels.indexOf(vertex.confidence);
    return Math.max(weakest, index < 0 ? levels.length - 1 : index);
  }, 0);
  return levels[rank];
}
