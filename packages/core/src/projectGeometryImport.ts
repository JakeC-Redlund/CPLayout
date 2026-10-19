import { refreshInheritedDrawingMetadata } from "./drawingProjectMutation";
import { projectDataKey } from "./projectDataComparison";
import { PivotProjectSchema } from "./projectDocument";
import type { PivotProject } from "./types";

/** Geometry-only imports inherit project history, but cannot reuse evidence for displaced vertices. */
export function admitProjectGeometryImport(previous: PivotProject, candidate: PivotProject): PivotProject {
  const normalized = { ...candidate };
  if (projectDataKey(previous.fieldBoundary) !== projectDataKey(candidate.fieldBoundary)) {
    delete normalized.fieldBoundaryCaptureEvidence;
  }
  // Refresh before schema admission so changed vertex counts cannot retain misaligned capture times.
  return PivotProjectSchema.parse(refreshInheritedDrawingMetadata(previous, normalized));
}
