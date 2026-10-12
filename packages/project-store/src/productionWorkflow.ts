import { parseSurveyReview, serializeSurveyReview, surveyReviewIsCurrent, type SurveyReview } from "../../core/src/surveyReview";
import { parseSurveyCollectionDocument } from "../../core/src/surveyCollection";
import { readSurveyDesignDocument } from "../../core/src/surveyCollectionApplication";
import { parseFieldLayoutTarget, layoutTargetSourceSignature } from "../../core/src/fieldLayoutTarget";
import { parseFieldDesignDocument } from "../../core/src/fieldDesignDocument";
import { layoutTransitionsRequiringLiveOwner, workspaceDesignSource, type WorkspaceDocument } from "./workspaceDocument";
export * from "./productionWorkflowSchemas";

export interface SurveyReadiness { status: "not_started" | "needs_review" | "ready"; review: SurveyReview | null; reasons: string[] }
export function getSurveyReadiness(workspace: WorkspaceDocument, designId: string): SurveyReadiness {
  const source = workspaceDesignSource(workspace, designId), data = readSurveyDesignDocument(source.kind, source.document);
  const entries = (workspace.surveyCollections ?? []).filter(entry => parseSurveyCollectionDocument(entry.document).owner.designId === designId);
  const reviewEntry = (workspace.surveyReviews ?? []).filter(entry => parseSurveyReview(entry.document).owner.designId === designId).at(-1);
  if (!reviewEntry) return { status: entries.length ? "needs_review" : "not_started", review: null, reasons: ["Complete and review the recorded Survey before starting Layout."] };
  const review = parseSurveyReview(reviewEntry.document);
  if (!workspace.catalog.designs.some(design => design.id === designId && design.isActive)) return { status: "needs_review", review, reasons: ["The original field survey is retained history. Open an active field and review its Survey before recording a new Layout."] };
  if (data.projectCrs === null) return { status: "needs_review", review, reasons: ["The field coordinate system is not declared."] };
  const ready = surveyReviewIsCurrent(review, { designId, documentKind: source.kind, payloadId: source.payloadId, fieldMapId: source.design.fieldMapId, projectCrs: data.projectCrs }, source.document, entries);
  return { status: ready ? "ready" : "needs_review", review, reasons: ready ? [] : ["Recorded Survey or field geometry changed. Review the current evidence before starting Layout."] };
}
export function assertLayoutSurveyAdmission(workspace: WorkspaceDocument, targetDocument: string): void {
  const target = parseFieldLayoutTarget(targetDocument);
  if (!target.workflow || !target.targetPoints) throw new Error("This saved target is available for viewing and export. Review Survey and create a new Layout before recording positions.");
  const readiness = getSurveyReadiness(workspace, target.workflow.designId);
  if (readiness.status !== "ready" || readiness.review?.id !== target.workflow.reviewId
    || serializeSurveyReview(readiness.review) !== target.workflow.surveyReviewDocument) throw new Error("Layout Survey evidence changed or needs review. Keep this target and create a reviewed Layout before recording positions.");
  const source = workspaceDesignSource(workspace, target.workflow.designId);
  if (source.kind !== "field" || source.design.fieldMapId !== target.workflow.fieldMapId
    || layoutTargetSourceSignature(parseFieldDesignDocument(source.document), target.source.selectedMachineIds) !== target.workflow.sourceGeometrySignature) throw new Error("Layout source geometry or selected machine configuration changed. Create a new reviewed target before recording positions.");
}

/** Generic storage callbacks have the same current-source obligations as commands. */
export function assertLiveLayoutTransitionAdmission(previous: WorkspaceDocument, next: WorkspaceDocument): void {
  for (const { session, isNew } of layoutTransitionsRequiringLiveOwner(previous, next)) {
    if (isNew && (session.finalization !== null || session.observations.length !== 0))
      throw new Error("A new RTK Layout starts with an empty pending map. Recorded or official maps can only be imported as retained reference history.");
    assertLayoutSurveyAdmission(next, session.targetDocument);
  }
}
