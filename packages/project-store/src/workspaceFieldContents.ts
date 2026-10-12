import { parseFieldLayoutTarget } from "../../core/src/fieldLayoutTarget";
import { parseProjectDocument } from "../../core/src/projectDocument";
import { parseLayoutSessionDocument } from "../../core/src/layoutSession";
import { parseSurveyCollectionDocument, type SurveyCollectionPurpose } from "../../core/src/surveyCollection";
import { readSurveyDesignDocument } from "../../core/src/surveyCollectionApplication";
import { parseSurveyReview, serializeSurveyReview } from "../../core/src/surveyReview";
import { getSurveyReadiness } from "./productionWorkflow";
import { validateWorkspaceDocument, workspaceDesignSource, type WorkspaceDocument, type WorkspaceDesignRecord } from "./workspaceDocument";

export interface FieldMachineAddress {
  designId: string; payloadId: string; machineId: string | null;
  kind: "center_pivot" | "straight_lateral" | "draft_machine";
}
export interface WorkspaceFieldContents {
  designs: { designId: string; payloadId: string; kind: WorkspaceDesignRecord["kind"]; name: string;
    machineAddresses: FieldMachineAddress[]; hasMapContent: boolean }[];
  surveys: { reviewId: string; designId: string; fieldMapId: string; name: string; completedAt: string;
    includedCollectionIds: string[]; layoutSessionIds: string[]; current: boolean }[];
  unreviewedCollections: { designId: string; collectionId: string; purposeLabel: string; observationCount: number }[];
  referenceLayoutSessionIds: string[];
}

/** Logical views over actual retained records. No IDs, parent links or evidence are created. */
export function workspaceFieldContents(input: WorkspaceDocument, fieldMapId: string): WorkspaceFieldContents {
  const workspace = validateWorkspaceDocument(input);
  if (!workspace.catalog.fieldMaps.some(field => field.id === fieldMapId)) throw new Error("The selected field folder is unavailable. Keep its retained history.");
  const designs = workspace.catalog.designs.filter(design => design.fieldMapId === fieldMapId).map(design => {
    const source = workspaceDesignSource(workspace, design.id);
    const addresses: FieldMachineAddress[] = [];
    const address = (kind: FieldMachineAddress["kind"], machineId: string | null) => addresses.push({ designId: design.id, payloadId: source.payloadId, machineId, kind });
    if (source.kind === "field") {
      const field = readSurveyDesignDocument("field", source.document);
      field.machines.forEach(machine => address("center_pivot", machine.id));
      field.lateralMachines?.forEach(machine => address("straight_lateral", machine.id));
    } else if (source.kind === "project") address("center_pivot", parseProjectDocument(source.document).machine.id);
    else {
      const draft = readSurveyDesignDocument("draft", source.document);
      if (Object.keys(draft.machine).length || draft.pivotCenter !== null) address("draft_machine", draft.machine.id ?? null);
    }
    const data = readContent(source.kind, source.document);
    const hasMapContent = data.fieldBoundary.length > 0 || data.obstacles.length > 0 || !!data.mapFeatures?.length || data.surveyPoints.length > 0
      || ("drawingWorkflow" in data && !!data.drawingWorkflow?.captures.length)
      || ("pivotCenter" in data && data.pivotCenter !== null) || ("infrastructure" in data && data.infrastructure.length > 0)
      || ("waterSource" in data && data.waterSource !== null) || ("powerSource" in data && data.powerSource !== null);
    return { designId: design.id, payloadId: source.payloadId, kind: design.kind, name: design.name, machineAddresses: addresses, hasMapContent };
  });
  const sessions = (workspace.layoutSessions ?? []).map(entry => parseLayoutSessionDocument(entry.document)).filter(session => session.fieldMapId === fieldMapId);
  const grouped = new Set<string>(), reviewed = new Set<string>();
  const surveys = (workspace.surveyReviews ?? []).map(entry => parseSurveyReview(entry.document)).filter(review => review.owner.fieldMapId === fieldMapId).map(review => {
    review.includedCollectionIds.forEach(id => reviewed.add(id));
    const source = workspaceDesignSource(workspace, review.owner.designId);
    let current = false;
    try { const readiness = getSurveyReadiness(workspace, review.owner.designId); current = readiness.status === "ready" && readiness.review?.id === review.id; }
    catch { /* Retained readable source may be outside the mutation reader's capabilities. It cannot qualify current work. */ }
    const layoutSessionIds = sessions.filter(session => {
      if (session.documentVersion !== "layout-session-v3" || session.referenceSourceDocument !== undefined) return false;
      const target = parseFieldLayoutTarget(session.targetDocument);
      return review.owner.documentKind === "field" && target.workflow?.reviewId === review.id
        && target.workflow.designId === review.owner.designId && target.workflow.fieldMapId === fieldMapId
        && target.source.fieldId === review.owner.payloadId && target.workflow.surveyReviewDocument === serializeSurveyReview(review);
    }).map(session => { grouped.add(session.id); return session.id; });
    return { reviewId: review.id, designId: source.design.id, fieldMapId, name: readContent(review.owner.documentKind, review.sourceDocument).name,
      completedAt: review.completedAt, includedCollectionIds: [...review.includedCollectionIds], layoutSessionIds,
      current };
  });
  const unreviewedCollections = (workspace.surveyCollections ?? []).map(entry => parseSurveyCollectionDocument(entry.document))
    .filter(collection => collection.owner.fieldMapId === fieldMapId && !reviewed.has(collection.id)).map(collection => ({
      designId: collection.owner.designId, collectionId: collection.id, purposeLabel: purposeLabel(collection.purpose), observationCount: collection.observations.length,
    }));
  return { designs, surveys, unreviewedCollections, referenceLayoutSessionIds: sessions.filter(session => !grouped.has(session.id)).map(session => session.id) };
}

/** Exact archived sources stay separate when their original parent chain is absent. */
export function retainedSurveyHistory(input: WorkspaceDocument) {
  const workspace = validateWorkspaceDocument(input);
  const collections = (workspace.surveyCollections ?? []).map(entry => parseSurveyCollectionDocument(entry.document));
  return (workspace.surveyOwnerArchives ?? []).map(entry => {
    const field = workspace.catalog.fieldMaps.find(item => item.id === entry.design.fieldMapId);
    const project = workspace.catalog.projects.find(item => item.id === field?.projectId);
    const customer = workspace.catalog.clients.find(item => item.id === project?.clientId);
    return { designId: entry.design.id, fieldMapId: entry.design.fieldMapId, kind: entry.design.kind, name: entry.design.name,
      document: entry.document, collectionIds: collections.filter(collection => collection.owner.designId === entry.design.id).map(collection => collection.id),
      missingParent: !field || !project || !customer };
  });
}

function purposeLabel(purpose: SurveyCollectionPurpose): string {
  return purpose.kind === "point" ? `Point · ${purpose.role.replaceAll("_", " ")}` : purpose.kind === "field_boundary" ? "Field boundary"
    : purpose.kind === "obstacle" ? `Obstacle · ${purpose.obstacleKind.replaceAll("_", " ")}`
      : `${purpose.geometryType === "LineString" ? "Line" : purpose.geometryType === "Polygon" ? "Area" : "Point"} · ${purpose.featureKind.replaceAll("_", " ")}`;
}

function readContent(kind: WorkspaceDesignRecord["kind"], document: string) {
  return kind === "project" ? parseProjectDocument(document) : readSurveyDesignDocument(kind, document);
}
