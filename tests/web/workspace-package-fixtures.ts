import type { BrowserContext } from "@playwright/test";
import { newDesignDraft } from "../../apps/mobile/src/newDesignDraft";
import { sampleProject } from "../../packages/core/src/sampleProject";
import { serializeProjectDocument } from "../../packages/core/src/projectDocument";
import { convertPivotProjectToFieldDesign } from "../../packages/core/src/fieldDesignDocument";
import { createFieldLayoutTarget, serializeFieldLayoutTarget } from "../../packages/core/src/fieldLayoutTarget";
import { createSurveyCollection, parseSurveyCollectionDocument } from "../../packages/core/src/surveyCollection";
import { readSurveyDesignDocument } from "../../packages/core/src/surveyCollectionApplication";
import { sha256Text } from "../../packages/core/src/sha256";
import type { SurveyPoint } from "../../packages/core/src/types";
import { createVersionedProjectRepository } from "../../packages/project-store/src/versionedProjectRepository";
import { buildDesignWorkspaceBundle, parseDesignWorkspaceBundle } from "../../packages/project-store/src/designWorkspaceBundle";
import type { WorkspaceCommand } from "../../packages/project-store/src/workspaceCommands";
import { serializeWorkspaceDocument, workspaceDesignSource, type WorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { workspaceKey } from "./workspace-fixtures";

export type PackageOwnerKind = "draft" | "project" | "field";
export const packageIds = {
  customer: "package-source-customer", project: "package-source-project", field: "package-source-field",
  source: "package-source-design", destination: "package-destination-field-b", wrongCrs: "package-wrong-crs-field",
  layout: "package-existing-layout", layoutDesign: "package-layout-design",
};
const now = "2026-10-10T12:00:00.000Z";

// These are explicitly imported historical records, never proposed live captures
// or evidence that a physical receiver/accuracy gate ran.
function historicalPoint(id: string, index: number): SurveyPoint {
  return { id, label: `Historical ${id}  `, notes: "Exact imported notes\nsecond line", role: "control",
    projected: { x: 500100 + index * 33.125, y: 4400100 + index * 17.375 }, observedAt: now,
    source: "external_gnss", confidence: "rtk_float", captureEvidence: {
      schemaVersion: "gnss-capture-v1", observationId: `historical-receiver-${id}`, sessionId: "historical-package-session",
      transport: "replay", receivedAt: now, receivedMonotonicMs: index + 1, sourceCoordinateFrame: "EPSG:4326",
      antennaReference: "unknown", sentenceTypes: ["GGA"], coherent: true,
    } };
}

/** Build through the real repository command/admission boundary. The memory
 * storage below only prepares durable seed bytes; the App uses its real store. */
export async function packageFixture(kind: PackageOwnerKind, history = true, initialVersion: "v1" | "v2" | "v3" = "v3") {
  if (initialVersion !== "v3" && (history || kind !== "draft")) throw new Error("Older package seeds are bounded to metadata-free Drafts.");
  const values = new Map<string, string>();
  const api = createVersionedProjectRepository({
    getStorage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }),
    getLocks: () => ({ request: async (_name, _options, action) => action() }),
  }).versionedWorkspace!;
  let workspace = await api.readAsync();
  const execute = async (command: Omit<WorkspaceCommand, "now"> | object) => {
    workspace = (await api.executeAsync(workspace.revision, { ...command, now } as WorkspaceCommand, () => true)).workspace;
  };
  for (const [id, name] of [[packageIds.customer, "Source customer"], ["package-customer-a", "Customer Alpha"], ["package-customer-b", "Customer Beta"]]) {
    await execute({ type: "create_client", id, input: { companyName: name, primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } });
  }
  for (const [clientId, projectId, fieldMapId, projectName, fieldMapName, projectCrs] of [
    [packageIds.customer, packageIds.project, packageIds.field, "Source project", "Source field", "EPSG:32613"],
    ["package-customer-a", "package-project-a", "package-destination-field-a", "Duplicated project", "Duplicated field", "EPSG:32613"],
    ["package-customer-b", "package-project-b", packageIds.destination, "Duplicated project", "Duplicated field", "EPSG:32613"],
    ["package-customer-b", "package-wrong-crs-project", packageIds.wrongCrs, "Other CRS", "Other CRS field", "EPSG:32612"],
  ]) await execute({ type: "create_project_with_initial_field_map", input: { clientId, projectId, fieldMapId, projectName, fieldMapName, projectCrs, unitSystem: "metric" } });
  if (initialVersion === "v3") await execute({ type: "upgrade_workspace_to_v3" });
  else if (initialVersion === "v2") await execute({ type: "upgrade_workspace_to_v2" });

  // Independent unequal machines and a frozen Layout exist for every owner case.
  const originalProjectDocument = serializeProjectDocument({ ...structuredClone(sampleProject), id: "package-original-project", name: "Exact original Project" });
  const converted = convertPivotProjectToFieldDesign(originalProjectDocument, { fieldId: "package-field-payload", waterSourceId: "package-water", powerSourceId: "package-power" });
  const first = converted.field.machines[0];
  const field = { ...converted.field, machines: [first, { ...structuredClone(first), id: "package-unequal-machine",
    pivotCenter: { x: first.pivotCenter.x + 140.125, y: first.pivotCenter.y - 70.375 },
    configuration: { ...structuredClone(first.configuration), name: "Unequal second pivot", spanLengthsMeters: [31.125, 42.375, 27.0625], overhangMeters: 12.875, endGunThrowMeters: 17.625 } }] };
  if (initialVersion !== "v1") await execute({ type: "create_field_design", designId: packageIds.layoutDesign, fieldMapId: packageIds.field, name: field.name, field, originalProjectDocument });
  if (initialVersion === "v3") await execute({ type: "create_layout_session", sessionId: packageIds.layout, fieldMapId: packageIds.field, name: "Frozen existing Layout",
    targetDocument: serializeFieldLayoutTarget(createFieldLayoutTarget(field, { inputRevision: 0, expectedRevision: 0, selectedMachineIds: ["package-unequal-machine"] })) });
  if (kind === "draft") {
    const draft = { ...newDesignDraft("package-base-payload", "Saved Draft package", "metric"), projectCrs: "EPSG:32613",
      fieldBoundary: structuredClone(sampleProject.fieldBoundary), pivotCenter: { ...sampleProject.pivotCenter },
      waterSource: { ...sampleProject.waterSource }, powerSource: { ...sampleProject.powerSource }, machine: structuredClone(sampleProject.machine), obstacles: structuredClone(sampleProject.obstacles) };
    await execute({ type: "create_design_draft", designId: "package-base-design", fieldMapId: packageIds.field, name: draft.name, draft });
  } else if (kind === "project") {
    await execute({ type: "import_design_document", designId: "package-base-design", payloadId: "package-base-payload", fieldMapId: packageIds.field,
      document: serializeProjectDocument({ ...structuredClone(sampleProject), name: "Saved Project package" }) });
  } else await execute({ type: "create_field_design", designId: "package-base-design", fieldMapId: packageIds.field, name: "Saved Field package",
    field: { ...field, id: "package-base-payload", name: "Saved Field package" }, originalProjectDocument });

  if (!history) return { workspace, designId: "package-base-design", values };
  await execute({ type: "upgrade_workspace_to_v4" });
  const base = workspaceDesignSource(workspace, "package-base-design");
  const surveyDocuments = ["current", "deleted", "pending"].map((name, index) => {
    const observations = [historicalPoint(`${name}-a`, index * 2), historicalPoint(`${name}-b`, index * 2 + 1)];
    return JSON.stringify({ ...createSurveyCollection({ id: `historical-${name}`, now,
      owner: { designId: base.design.id, documentKind: kind, payloadId: base.payloadId, fieldMapId: packageIds.field, projectCrs: "EPSG:32613" },
      purpose: { kind: "map_feature", featureKind: "reference_line", geometryType: "LineString" } }),
      revision: 2, observations, activePointIds: observations.map(point => point.id) });
  });
  const body = { ...buildDesignWorkspaceBundle(workspace, base.design.id), surveyDocuments };
  const bundle = parseDesignWorkspaceBundle({ ...body, inventory: [
    { filename: "design.json", sha256: sha256Text(body.designDocument) },
    ...surveyDocuments.map((document, index) => ({ filename: `survey-${index}.json`, sha256: sha256Text(document) })),
    ...(body.originalProjectDocument === undefined ? [] : [{ filename: "original-project.json", sha256: sha256Text(body.originalProjectDocument) }]),
  ] });
  await execute({ type: "import_design_workspace_bundle", bundle, designId: packageIds.source, payloadId: "package-source-payload", fieldMapId: packageIds.field,
    collectionIds: ["current", "deleted", "pending"].map(name => ({ sourceId: `historical-${name}`, id: `source-${name}`, expectedRevision: 2 })) });
  for (const name of ["current", "deleted"]) await execute({ type: "apply_survey_collection", collectionId: `source-${name}`,
    expectedCollectionRevision: 0, expectedDesignRevision: workspaceDesignSource(workspace, packageIds.source).design.revision,
    applicationId: `application-${name}`, targetId: `reference-${name}`, reference: { name: `Exact ${name} reference  `, notes: "Original reference notes\nretained" } });
  const current = workspaceDesignSource(workspace, packageIds.source), data = readSurveyDesignDocument(kind, current.document);
  // An explicit valid saved deletion retains origins and immutable Survey ledgers.
  const deleted = { ...data, mapFeatures: data.mapFeatures!.filter(feature => feature.id !== "reference-deleted"),
    drawingMetadata: { ...data.drawingMetadata!, records: data.drawingMetadata!.records.filter(record => record.target.kind !== "map_feature" || record.target.id !== "reference-deleted") } };
  await execute(kind === "draft" ? { type: "save_design_draft", designId: packageIds.source, expectedDesignRevision: current.design.revision, draft: deleted }
    : kind === "project" ? { type: "save_design_project", designId: packageIds.source, project: deleted }
      : { type: "save_field_design", designId: packageIds.source, expectedDesignRevision: current.design.revision, field: deleted });
  // Verify preparation itself has both immutable histories and only one locator.
  const prepared = readSurveyDesignDocument(kind, workspaceDesignSource(workspace, packageIds.source).document);
  if (prepared.drawingMetadata?.retainedReferenceOrigins?.length !== 2 || prepared.drawingMetadata.records.length !== 1) throw new Error("Package fixture did not retain current and deleted reference origins.");
  for (const entry of workspace.surveyCollections ?? []) parseSurveyCollectionDocument(entry.document);
  return { workspace, designId: packageIds.source, values };
}

export async function seedPackageWorkspace(context: BrowserContext, fixture: Awaited<ReturnType<typeof packageFixture>>) {
  const entries = [...fixture.values];
  // Serialize again through the actual reader; keep backup/legacy predecessor bytes.
  const index = entries.findIndex(([key]) => key === workspaceKey);
  entries[index] = [workspaceKey, serializeWorkspaceDocument(fixture.workspace)];
  await context.addInitScript(({ key, entries }) => {
    if (["http:", "https:"].includes(location.protocol) && localStorage.getItem(key) === null) for (const [name, value] of entries) localStorage.setItem(name, value);
  }, { key: workspaceKey, entries });
}

export function sourcePayload(workspace: WorkspaceDocument, designId: string) {
  const source = workspaceDesignSource(workspace, designId);
  return { source, data: readSurveyDesignDocument(source.kind, source.document) };
}
