import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultProjectSettings, evaluateDesignDraftCompleteness, parseDesignDraftDocument, parseProjectDocument,
  sampleProject, serializeDesignDraftDocument, serializeProjectDocument,
  createDesignDraftEditorState, reduceDesignDraftEditorState,
  type DesignDraft, type PivotProject, type GnssCaptureEvidenceV2,
} from "@cplayout/core";

import { applyWorkspaceCommand, parseWorkspaceCommand, type WorkspaceCommand } from "./workspaceCommands";
import { migrateLegacyWorkspace } from "./legacyWorkspaceMigration";
import {
  createWorkspaceDesign, emptyWorkspaceDocument, validateWorkspaceDocument, WorkspaceDocumentError,
  type WorkspaceDocument, type WorkspaceDocumentErrorCode,
} from "./workspaceDocument";

const now = "2026-09-16T12:00:00.000Z";
const later = "2026-09-16T12:01:00.000Z";
const project = (id = "payload"): PivotProject => ({ ...structuredClone(sampleProject), id });
const clientCommand = (id = "client"): WorkspaceCommand => ({
  type: "create_client", id, now, input: { primaryContactFirstName: " Synthetic ", primaryContactLastName: " Client " },
});
const folderCommand = (id = "folder"): WorkspaceCommand => ({
  type: "create_project_with_initial_field_map", now,
  input: { clientId: "client", projectId: id, projectName: "Folder", projectCrs: "EPSG:32613", unitSystem: "metric", fieldMapId: `${id}-map` },
});

function apply(workspace: WorkspaceDocument, command: WorkspaceCommand): WorkspaceDocument {
  const before = structuredClone(workspace);
  const next = applyWorkspaceCommand(workspace, command).workspace;
  assert.deepEqual(workspace, before);
  assert.equal(next.revision, workspace.revision + 1);
  assert.deepEqual(validateWorkspaceDocument(next), next);
  return next;
}

function fixture(): WorkspaceDocument {
  return apply(apply(emptyWorkspaceDocument(), clientCommand()), folderCommand());
}

function withOwnedProject(workspace = fixture(), id = "payload", designId = "design", fieldMapId = "folder-map"): WorkspaceDocument {
  const next = apply(workspace, { type: "save_project", now, project: project(id), createOnly: true });
  return apply(next, { type: "create_design_record", now, input: { id: designId, fieldMapId, pivotProjectId: id, name: "Stored label" } });
}

function incompleteDraft(id = "draft-payload"): DesignDraft {
  const settings = defaultProjectSettings();
  delete settings.aerialImagery.sourcePackageId;
  return { id, name: "Incomplete draft", projectCrs: null, settings, unitSystem: settings.unitSystem,
    fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
}

function withDraft(workspace = fixture(), id = "draft-payload", designId = "draft-design"): WorkspaceDocument {
  const draft = incompleteDraft(id);
  return createWorkspaceDesign(workspace, {
    design: { id: designId, fieldMapId: "folder-map", name: draft.name, kind: "draft", draftId: id, revision: 0, isActive: false, createdAt: now, updatedAt: now },
    document: `\n ${serializeDesignDraftDocument(draft)}\n`,
  });
}

test("draft editor snapshots save and reopen without coupling undo and storage revisions", () => {
  let editor = createDesignDraftEditorState(incompleteDraft());
  let workspace = apply(fixture(), { type: "create_design_draft", now, designId: "draft-design",
    fieldMapId: "folder-map", name: "Draft", draft: editor.draft });
  editor = reduceDesignDraftEditorState(editor, { type: "set_crs", projectCrs: "EPSG:32613" });
  editor = reduceDesignDraftEditorState(editor, { type: "set_machine", machine: { spanLengthsMeters: [null, 25, null] } });
  for (let count = 0; count <= 2; count += 1) {
    if (count) editor = reduceDesignDraftEditorState(editor, { type: "insert_boundary_vertex", index: count - 1, point: { x: 100 + count, y: 200 } });
    assert.equal(editor.lastError, null);
    workspace = apply(workspace, { type: "save_design_draft", now: later, designId: "draft-design",
      expectedDesignRevision: count, draft: editor.draft });
    const reopened = createDesignDraftEditorState(parseDesignDraftDocument(workspace.draftDocuments[0].document));
    assert.deepEqual(reopened.draft, editor.draft);
    assert.equal(reopened.revision, 0);
    assert.equal(reopened.draft.fieldBoundary.length, count);
    assert.deepEqual(reopened.draft.machine.spanLengthsMeters, [null, 25, null]);
    assert.equal(evaluateDesignDraftCompleteness(reopened.draft).calculationEligible, false);
    assert.equal(workspace.catalog.designs[0].revision, count + 1);
    assert.equal(workspace.projectDocuments.length, 0);
  }
  editor = reduceDesignDraftEditorState(editor, { type: "undo" });
  assert.equal(editor.draft.fieldBoundary.length, 1);
  rejects(workspace, { type: "save_design_draft", now: later, designId: "draft-design",
    expectedDesignRevision: editor.revision, draft: editor.draft }, "conflict");
  workspace = apply(workspace, { type: "save_design_draft", now: later, designId: "draft-design",
    expectedDesignRevision: 3, draft: editor.draft });
  assert.equal(parseDesignDraftDocument(workspace.draftDocuments[0].document).fieldBoundary.length, 1);
});

function rejects(workspace: WorkspaceDocument, command: unknown, code: WorkspaceDocumentErrorCode): void {
  const before = structuredClone(workspace);
  assert.throws(() => applyWorkspaceCommand(workspace, command as WorkspaceCommand),
    (error: unknown) => error instanceof WorkspaceDocumentError && error.code === code);
  assert.deepEqual(workspace, before);
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test("copy creates an independent identity without changing source bytes, ownership or evidence", () => {
  const source = project();
  const capture: GnssCaptureEvidenceV2 = {
    schemaVersion: "gnss-capture-v2", observationId: "synthetic-session:epoch-1", sessionId: "synthetic-session",
    transport: "web_serial", receivedAt: "2026-09-17T12:00:00.000Z", receiverObservedAt: "2026-09-17T12:00:00.000Z",
    receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true,
    antennaReference: "arp", sentenceTypes: ["GGA", "GST", "RMC"],
    height: { meters: 1500, type: "orthometric", geoidSeparationMeters: -20 },
    referenceDeclaration: {
      schemaVersion: "gnss-reference-declaration-v1", provenance: "operator_declared", receiverModel: "Synthetic receiver",
      receiverFirmware: "synthetic-v1", referenceFrame: "WGS84", realization: "Synthetic frame", coordinateEpochUtc: "2026-09-17T12:00:00.000Z",
      verticalDatum: "Synthetic datum", geoidModel: "Synthetic geoid", antennaModel: "Synthetic antenna", antennaReference: "arp",
      reportedPoint: "Antenna ARP", targetPoint: "Antenna ARP", antennaHeightMeters: 2, offsetTreatment: "none_reported_point",
    },
    qualityScreen: {
      policy: "cplayout-nmea-collection-v2", uncertaintySource: "nmea_gst_component_standard_deviations",
      receiverQuality: { fixType: "rtk_fixed", satellites: 16, hdop: 0.7, vdop: null, pdop: null,
        correctionAgeSeconds: 1, horizontalAccuracyMeters: 0.02, verticalAccuracyMeters: 0.04, nmeaQualityCode: 4 },
      thresholds: { minimumFixType: "rtk_fixed", minSatellites: 10, maxHdop: 2, maxHorizontalAccuracyMeters: 0.05,
        maxCorrectionAgeSeconds: 3, maxObservationAgeSeconds: 2 }, evaluatedMonotonicMs: 1000, physicalQualification: "unverified",
    },
  };
  source.surveyPoints.push({ id: "synthetic-control", label: "Synthetic control", role: "water_source", projected: { ...source.waterSource },
    observedAt: capture.receiverObservedAt, source: "external_gnss", confidence: "rtk_fixed", rtk: capture.qualityScreen.receiverQuality, captureEvidence: capture });
  source.infrastructureObservationRefs = { water_source: "synthetic-control" };
  const saved = apply(withOwnedProject(), { type: "save_project", now, project: source, createOnly: false });
  const command: WorkspaceCommand = { type: "copy_project", now: later, source, sourceStored: true, newProjectId: "independent-copy", name: "Copy" };
  const before = structuredClone(saved);
  const result = applyWorkspaceCommand(freeze(saved), freeze(command));
  assert.deepEqual(saved, before);
  assert.deepEqual(result.workspace.catalog, before.catalog);
  assert.deepEqual(result.workspace.projectDocuments[0], before.projectDocuments[0]);
  const copy = parseProjectDocument(result.workspace.projectDocuments[1].document);
  const original = parseProjectDocument(before.projectDocuments[0].document);
  assert.deepEqual({ ...copy, id: original.id, name: original.name }, original);
  assert.deepEqual(copy.surveyPoints.at(-1)?.captureEvidence, capture);
  assert.equal(copy.infrastructureObservationRefs?.water_source, "synthetic-control");
  assert.equal(result.workspace.revision, before.revision + 1);
});

test("copy may preserve an unsaved colliding import without adopting the stored document", () => {
  const saved = withOwnedProject();
  const incoming = { ...project(), name: "Independent incoming", projectCrs: "EPSG:32614" };
  const next = apply(saved, { type: "copy_project", now, source: incoming, sourceStored: false, newProjectId: "fresh-copy", name: "Incoming copy" });
  assert.deepEqual(next.projectDocuments[0], saved.projectDocuments[0]);
  assert.deepEqual(next.catalog, saved.catalog);
  assert.equal(parseProjectDocument(next.projectDocuments[1].document).projectCrs, incoming.projectCrs);
});

test("copy rejects reused, deleted, draft, same-source and unknown identities atomically", () => {
  let saved = withDraft(withOwnedProject());
  saved = apply(saved, { type: "save_project", now, project: project("deleted"), createOnly: true });
  saved = apply(saved, { type: "delete_project", now, projectId: "deleted" });
  const command = { type: "copy_project", now, source: project(), sourceStored: true, newProjectId: "copy", name: "Copy" } as const;
  rejects(saved, { ...command, newProjectId: "payload" }, "identity_mismatch");
  for (const newProjectId of ["deleted", "draft-payload", "folder"]) rejects(saved, { ...command, newProjectId }, "conflict");
  rejects(saved, { ...command, source: project("absent") }, "not_found");
  rejects(saved, { ...command, source: { ...project(), projectCrs: "EPSG:32614" } }, "identity_mismatch");
  rejects(saved, { ...command, name: " " }, "invalid_document");
  rejects(saved, { ...command, name: "x".repeat(201) }, "invalid_document");
});

test("copy refuses hidden stored extensions and unknown snapshot fields without changing source", () => {
  const saved = withOwnedProject();
  const command = { type: "copy_project", now, source: project(), sourceStored: true, newProjectId: "copy", name: "Copy" } as const;
  for (const extension of ["wrapper", "nested"]) {
    const altered = structuredClone(saved);
    const document = JSON.parse(altered.projectDocuments[0].document);
    if (extension === "wrapper") document.futureWrapper = { preserved: true };
    else document.project.machine.futureCalibration = { preserved: true };
    altered.projectDocuments[0].document = JSON.stringify(document);
    rejects(altered, command, "invalid_document");
  }
  rejects(saved, { ...command, source: { ...project(), futureCalibration: true } }, "invalid_document");
});

test("independent imports and folder creation cannot introduce ambiguous deletion identities", () => {
  const saved = withOwnedProject();
  rejects(saved, { type: "save_project", now, project: project("folder"), createOnly: true }, "conflict");
  rejects(saved, folderCommand("payload"), "conflict");
  const deleted = apply(saved, { type: "delete_project", now, projectId: "payload" });
  rejects(deleted, folderCommand("payload"), "conflict");
  // The atomic initial-design operation intentionally creates one linked folder/payload pair.
  const paired = apply(fixture(), { type: "create_project_with_initial_design", now,
    input: { clientId: "client", project: project("paired") } });
  assert.equal(paired.catalog.projects.at(-1)?.id, "paired");
  const pairedDesign = paired.catalog.designs.at(-1);
  assert.ok(pairedDesign?.kind === "project");
  assert.equal(pairedDesign.pivotProjectId, "paired");
  assert.equal(paired.projectDocuments.at(-1)?.summary.id, "paired");
});

test("commands are detached before a lock wait and both state and command may be deeply frozen", () => {
  const command: WorkspaceCommand = { type: "save_project", now, project: project(), createOnly: true };
  const detached = parseWorkspaceCommand(command);
  command.project.fieldBoundary[0].x += 50;
  assert.notDeepEqual(detached, command);
  const next = apply(freeze(emptyWorkspaceDocument()), freeze(detached));
  assert.equal(next.projectDocuments.length, 1);
  assert.deepEqual(next.catalog, emptyWorkspaceDocument().catalog);
});

test("create and update are explicit, deleted documents cannot be recreated, and existing unowned saves enforce CRS", () => {
  const empty = emptyWorkspaceDocument();
  rejects(empty, { type: "save_project", now, project: project(), createOnly: false }, "not_found");
  const saved = apply(empty, { type: "save_project", now, project: project(), createOnly: true });
  rejects(saved, { type: "save_project", now, project: project(), createOnly: true }, "conflict");
  rejects(saved, { type: "save_project", now, project: { ...project(), projectCrs: "EPSG:32614" }, createOnly: false }, "identity_mismatch");
  const updated = apply(saved, { type: "save_project", now: later, project: { ...project(), name: "Updated" }, createOnly: false });
  assert.equal(updated.projectDocuments[0].summary.name, "Updated");
  const deleted = apply(updated, { type: "delete_project", now: later, projectId: "payload" });
  assert.deepEqual(deleted.tombstones, [{ entity: "project_document", id: "payload", revision: deleted.revision, deletedAt: later }]);
  rejects(deleted, { type: "save_project", now, project: project(), createOnly: false }, "not_found");
  rejects(deleted, { type: "save_project", now, project: project(), createOnly: true }, "conflict");
});

for (const type of ["save_project", "save_design_project"] as const) {
  test(`${type} uses the owning design's revision and CRS guards without moving ownership`, () => {
    const saved = withOwnedProject();
    const command: WorkspaceCommand = type === "save_project"
      ? { type, now: later, project: project(), createOnly: false }
      : { type, now: later, project: project(), designId: "design" };
    rejects(saved, { ...command, project: { ...project(), projectCrs: "EPSG:32614" } }, "identity_mismatch");
    const updated = apply(saved, command);
    assert.deepEqual(updated.catalog.designs[0], { ...saved.catalog.designs[0], revision: 1, updatedAt: later });
    assert.deepEqual(updated.catalog.projects, saved.catalog.projects);
    assert.deepEqual(updated.catalog.fieldMaps, saved.catalog.fieldMaps);
  });
}

test("save-design rejects missing design, changed identity and draft kind without creating payloads", () => {
  const saved = withDraft(withOwnedProject());
  rejects(saved, { type: "save_design_project", now, designId: "missing", project: project() }, "not_found");
  rejects(saved, { type: "save_design_project", now, designId: "design", project: project("other") }, "identity_mismatch");
  rejects(saved, { type: "save_design_project", now, designId: "draft-design", project: project("draft-payload") }, "identity_mismatch");
  rejects(saved, { type: "save_project", now, project: project("draft-payload"), createOnly: true }, "conflict");
  rejects(saved, { type: "save_project", now, project: project("draft-payload"), createOnly: false }, "not_found");
});

test("compound creates advance once and produce detached legacy-compatible return values", () => {
  const before = apply(emptyWorkspaceDocument(), clientCommand());
  const command: WorkspaceCommand = { type: "create_project_with_initial_design", now, input: { clientId: "client", project: project() } };
  const result = applyWorkspaceCommand(before, command);
  assert.equal(result.workspace.revision, before.revision + 1);
  assert.equal(result.workspace.catalog.designs[0].revision, 0);
  assert.equal(result.workspace.catalog.designs[0].id, "payload:design:primary");
  assert.ok(result.value && "projectRecord" in result.value && "design" in result.value);
  assert.equal("kind" in result.value.design, false);
  result.value.projectRecord.name = "Result mutation";
  result.value.project.fieldBoundary[0].x += 100;
  assert.equal(result.workspace.catalog.projects[0].name, project().name);
  assert.deepEqual(command.input.project, project());
  rejects(result.workspace, command, "conflict");
});

test("compound create failures leave no partial catalog or payload changes", () => {
  const saved = withOwnedProject();
  rejects(saved, { type: "create_project_with_initial_design", now, input: { clientId: "client", project: project("new"), fieldMapId: "folder-map" } }, "conflict");
  rejects(saved, { type: "create_project_with_initial_design", now, input: { clientId: "client", project: project("new"), designId: "design" } }, "conflict");
  rejects(saved, { type: "create_project_with_initial_design", now, input: { clientId: "absent", project: project("new") } }, "not_found");
  rejects(saved, folderCommand(), "conflict");
  rejects(saved, { type: "create_project_with_initial_field_map", now, input: { clientId: "client", projectId: "new", projectName: "New", projectCrs: "", unitSystem: "", fieldMapId: "folder-map" } }, "conflict");
});

test("clients normalize only explicit input and preserve unrelated historical records", () => {
  let saved = fixture();
  saved.catalog.clients[0].displayName = "  Historical label  ";
  saved.catalog.clients[0].sortName = "Historical sort";
  saved = apply(saved, { type: "create_client", now, id: "second", input: {
    primaryContactFirstName: "  Jane  Ann ", primaryContactLastName: " Tester ", primaryContactMiddleInitial: " m. ",
    companyName: " Synthetic  Company ", notes: "  line one\nline two  ",
  } });
  assert.equal(saved.catalog.clients[0].displayName, "  Historical label  ");
  assert.equal(saved.catalog.clients[1].contactName, "Tester, Jane Ann M.");
  assert.equal(saved.catalog.clients[1].displayName, "Synthetic Company");
  assert.equal(saved.catalog.clients[1].notes, "line one\nline two");
  const updated = apply(saved, { type: "update_client", now: later, input: { id: "second", phone: " 123   456 ", companyName: undefined } });
  assert.equal(updated.catalog.clients[1].companyName, "Synthetic Company");
  assert.equal(updated.catalog.clients[1].phone, "123 456");
  assert.equal(updated.catalog.clients[1].createdAt, now);
  rejects(saved, clientCommand(), "conflict");
  rejects(saved, { type: "update_client", now, input: { id: "second", primaryContactFirstName: "" } }, "invalid_document");
  rejects(saved, { type: "delete_client", now, clientId: "client" }, "conflict");
  assert.equal(apply(updated, { type: "delete_client", now, clientId: "second" }).catalog.clients.length, 1);
});

test("catalog rename and move preserve every document byte and all draft identities", () => {
  const saved = withDraft(withOwnedProject());
  saved.projectDocuments[0].document = `\n  ${saved.projectDocuments[0].document}\n`;
  const renamed = apply(saved, { type: "rename_project", now: later, projectId: "folder", name: " Renamed   folder " });
  assert.equal(renamed.catalog.projects[0].name, "Renamed folder");
  assert.deepEqual(renamed.projectDocuments, saved.projectDocuments);
  assert.deepEqual(renamed.draftDocuments, saved.draftDocuments);
  assert.deepEqual(renamed.catalog.designs, saved.catalog.designs);
  const second = apply(renamed, clientCommand("second"));
  const moved = apply(second, { type: "move_project_to_client", now: later, projectId: "folder", clientId: "second" });
  assert.equal(moved.catalog.projects[0].clientId, "second");
  assert.deepEqual(moved.projectDocuments, saved.projectDocuments);
  assert.deepEqual(moved.draftDocuments, saved.draftDocuments);
  rejects(moved, { type: "rename_project", now, projectId: "payload", name: "Wrong" }, "not_found");
});

test("all simple creates require references and reject occupied IDs or payload ownership", () => {
  const saved = withOwnedProject();
  const createFolder: WorkspaceCommand = { type: "create_project_record", now, input: { id: "new", clientId: "client", name: "New", projectCrs: "", unitSystem: "" } };
  const folder = apply(saved, createFolder);
  rejects(folder, createFolder, "conflict");
  rejects(saved, { ...createFolder, input: { ...createFolder.input, clientId: "absent" } }, "not_found");
  const createMap: WorkspaceCommand = { type: "create_field_map_record", now, input: { id: "new-map", projectId: "new", name: "New map" } };
  rejects(saved, createMap, "not_found");
  const map = apply(folder, createMap);
  rejects(map, createMap, "conflict");
  rejects(map, { type: "create_design_record", now, input: { id: "second", fieldMapId: "new-map", name: "Second", pivotProjectId: "payload" } }, "conflict");
  rejects(map, { type: "create_design_record", now, input: { id: "second", fieldMapId: "missing", name: "Second", pivotProjectId: "payload" } }, "not_found");
  rejects(map, { type: "create_design_record", now, input: { id: "second", fieldMapId: "new-map", name: "Second", pivotProjectId: "missing" } }, "not_found");
});

test("folder cascade removes only associated maps, designs and payloads, retaining immutable previous tombstones", () => {
  let saved = withDraft(withOwnedProject());
  saved = apply(saved, { type: "save_project", now, project: project("prior"), createOnly: true });
  saved = apply(saved, { type: "delete_project", now, projectId: "prior" });
  saved = apply(saved, folderCommand("second"));
  saved = withOwnedProject(saved, "unrelated", "other-design", "second-map");
  // Legacy admission must preserve historical collisions even though new creates refuse them.
  saved.projectDocuments.push(apply(emptyWorkspaceDocument(), { type: "save_project", now, project: project("folder"), createOnly: true }).projectDocuments[0]);
  saved = validateWorkspaceDocument(saved);
  saved.projectDocuments.find((entry) => entry.summary.id === "unrelated")!.document += "\n  ";
  const priorTombstones = structuredClone(saved.tombstones);
  const retained = saved.projectDocuments.filter((entry) => entry.summary.id === "unrelated");
  const deleted = apply(saved, { type: "delete_project", now: later, projectId: "folder" });
  assert.deepEqual(deleted.projectDocuments, retained);
  assert.equal(deleted.draftDocuments.length, 0);
  assert.deepEqual(deleted.catalog.designs.map((record) => record.id), ["other-design"]);
  assert.deepEqual(deleted.catalog.fieldMaps.map((record) => record.id), ["second-map"]);
  assert.deepEqual(deleted.tombstones.slice(0, priorTombstones.length), priorTombstones);
  assert.deepEqual(deleted.tombstones.slice(priorTombstones.length).map((entry) => [entry.entity, entry.id]), [
    ["project_document", "folder"],
    ["design", "design"], ["project_document", "payload"], ["design", "draft-design"], ["draft_document", "draft-payload"],
  ]);
  rejects(deleted, { type: "save_project", now, project: project(), createOnly: true }, "conflict");
  rejects(deleted, { type: "delete_project", now: later, projectId: "folder" }, "not_found");
});

test("deleting a migrated folder removes its matching unowned document", () => {
  const source = fixture();
  const standalone = apply(emptyWorkspaceDocument(), { type: "save_project", now, project: project("folder"), createOnly: true }).projectDocuments[0];
  const migrated = migrateLegacyWorkspace({
    projectsRaw: JSON.stringify({ folder: standalone }),
    catalogRaw: JSON.stringify(source.catalog),
  });
  const deleted = apply(migrated, { type: "delete_project", now: later, projectId: "folder" });
  assert.deepEqual(deleted.catalog.projects, []);
  assert.deepEqual(deleted.projectDocuments, []);
  assert.deepEqual(deleted.tombstones, [{ entity: "project_document", id: "folder", revision: 1, deletedAt: later }]);
  rejects(deleted, { type: "save_project", now, project: project("folder"), createOnly: true }, "conflict");
});

test("matching folder and foreign owned document IDs do not extend a folder cascade", () => {
  let saved = fixture();
  saved = apply(saved, folderCommand("second"));
  const legacy = withOwnedProject(saved, "legacy-payload", "other-design", "second-map");
  legacy.projectDocuments[0] = apply(emptyWorkspaceDocument(), { type: "save_project", now, project: project("folder"), createOnly: true }).projectDocuments[0];
  legacy.catalog.designs[0] = { ...legacy.catalog.designs[0], kind: "project", pivotProjectId: "folder" };
  saved = validateWorkspaceDocument(legacy);
  const deleted = apply(saved, { type: "delete_project", now, projectId: "folder" });
  assert.deepEqual(deleted.projectDocuments, saved.projectDocuments);
  assert.deepEqual(deleted.catalog.designs, saved.catalog.designs);
  assert.deepEqual(deleted.tombstones, []);
});

test("standalone owned-document deletion retains its containing folder and map", () => {
  const saved = withDraft(withOwnedProject());
  const deleted = apply(saved, { type: "delete_project", now: later, projectId: "payload" });
  assert.deepEqual(deleted.catalog.projects, saved.catalog.projects);
  assert.deepEqual(deleted.catalog.fieldMaps, saved.catalog.fieldMaps);
  assert.deepEqual(deleted.draftDocuments, saved.draftDocuments);
  assert.equal(deleted.projectDocuments.length, 0);
  assert.deepEqual(deleted.catalog.designs.map((record) => record.id), ["draft-design"]);
  const newDocument = apply(deleted, { type: "save_project", now, project: project("new"), createOnly: true });
  rejects(newDocument, { type: "create_design_record", now, input: { id: "design", fieldMapId: "folder-map", pivotProjectId: "new", name: "New" } }, "conflict");
});

test("strict commands reject unknown fields at envelope, input, project and nested geometry levels", () => {
  const saved = fixture();
  for (const command of [
    { ...clientCommand("new"), surprise: true },
    { type: "create_client", now, id: "new", input: { primaryContactFirstName: "A", primaryContactLastName: "B", surprise: true } },
    { type: "save_project", now, createOnly: true, project: { ...project(), documentVersion: "future" } },
    { type: "save_project", now, createOnly: true, project: { ...project(), pivotCenter: { x: 1, y: 2, surprise: true } } },
    { type: "save_project", now, project: project() },
    { type: "save_project", now, project: project(), createOnly: "true" },
    { type: "save_project", now: "invalid", project: project(), createOnly: true },
    { type: "save_project", now, project: { ...project(), fieldBoundary: [] }, createOnly: true },
    { type: "anything", now },
  ]) rejects(saved, command, "invalid_document");
});

test("prototype metadata, accessors, symbols, hidden fields and cycles cannot be silently dropped", () => {
  const saved = fixture();
  for (const command of [
    JSON.parse('{"type":"delete_client","now":"2026-09-16T12:00:00.000Z","clientId":"client","__proto__":{}}'),
    { ...clientCommand("new"), input: Object.assign(Object.create({ hidden: true }), { primaryContactFirstName: "A", primaryContactLastName: "B" }) },
    { ...clientCommand("new"), [Symbol("hidden")]: true },
    Object.defineProperty({ ...clientCommand("new") }, "hidden", { value: true }),
    Object.defineProperty({ ...clientCommand("new") }, "input", { enumerable: true, get() { throw new Error("Getter must not run"); } }),
  ]) rejects(saved, command, "invalid_document");
  const cyclic: Record<string, unknown> = { ...clientCommand("new") };
  cyclic.loop = cyclic;
  rejects(saved, cyclic, "invalid_document");
});

test("all commands validate the entire prior workspace, including invalid and future unrelated payloads", () => {
  const saved = withOwnedProject();
  const invalid = structuredClone(saved);
  invalid.projectDocuments[0].document = "{bad JSON";
  rejects(invalid, clientCommand("new"), "invalid_document");
  const future = structuredClone(saved);
  future.projectDocuments[0].document = JSON.stringify({ documentVersion: "future", ...project() });
  rejects(future, { type: "delete_project", now, projectId: "folder" }, "unsupported_version");
  const missingReference = structuredClone(saved);
  missingReference.catalog.fieldMaps[0].projectId = "missing";
  rejects(missingReference, clientCommand("new"), "invalid_document");
});

test("inherited JSON hooks are rejected before execution on standard object and array prototypes", () => {
  const saved = fixture();
  const commands: WorkspaceCommand[] = [
    { type: "save_project", now, project: project(), createOnly: true },
    { type: "create_design_draft", now, designId: "draft-design", fieldMapId: "folder-map", name: "Draft", draft: incompleteDraft() },
  ];
  for (const prototype of [Object.prototype, Array.prototype]) {
    let calls = 0;
    const previous = Object.getOwnPropertyDescriptor(prototype, "toJSON");
    Object.defineProperty(prototype, "toJSON", { configurable: true, get() { calls++; throw new Error("Hook executed"); } });
    try {
      for (const command of commands) {
        rejects(saved, command, "invalid_document");
        assert.throws(() => parseWorkspaceCommand(command), (error: unknown) => error instanceof WorkspaceDocumentError && error.code === "invalid_document");
      }
      assert.equal(calls, 0);
    } finally {
      if (previous) Object.defineProperty(prototype, "toJSON", previous);
      else Reflect.deleteProperty(prototype, "toJSON");
    }
  }
});

test("unknown stored payload bytes remain untouched by unrelated commands", () => {
  const saved = withDraft(withOwnedProject());
  const raw = JSON.parse(saved.projectDocuments[0].document);
  raw.extension = { preserved: ["unknown", 1, null] };
  raw.project.machine.extension = "retain me";
  saved.projectDocuments[0].document = `\n ${JSON.stringify(raw, null, 3)} \n`;
  const updated = apply(saved, clientCommand("new"));
  assert.deepEqual(updated.projectDocuments, saved.projectDocuments);
  assert.deepEqual(updated.draftDocuments, saved.draftDocuments);
});

test("complete draft documents remain draft-backed through catalog changes", () => {
  const settings = defaultProjectSettings();
  delete settings.aerialImagery.sourcePackageId;
  const draft: DesignDraft = { ...project("complete-draft"), settings };
  const saved = createWorkspaceDesign(fixture(), {
    design: { id: "complete-design", fieldMapId: "folder-map", name: draft.name, kind: "draft", draftId: draft.id,
      revision: 0, isActive: true, createdAt: now, updatedAt: now },
    document: `\n${serializeDesignDraftDocument(draft)}\n`,
  });
  const renamed = apply(saved, { type: "rename_project", now: later, projectId: "folder", name: "Renamed" });
  assert.deepEqual(renamed.catalog.designs, saved.catalog.designs);
  assert.deepEqual(renamed.draftDocuments, saved.draftDocuments);
  assert.equal(renamed.projectDocuments.length, 0);
  rejects(renamed, { type: "save_design_project", now, designId: "complete-design", project: project(draft.id) }, "identity_mismatch");
});

test("draft deletion tombstones reserve payload identity against future project creation", () => {
  const saved = withDraft();
  const deleted = apply(saved, { type: "delete_project", now: later, projectId: "folder" });
  rejects(deleted, { type: "save_project", now, createOnly: true, project: project("draft-payload") }, "conflict");
  rejects(deleted, { type: "create_project_with_initial_design", now, input: { clientId: "client", project: project("draft-payload") } }, "conflict");
  const recreatedFolder = apply(deleted, folderCommand());
  rejects(recreatedFolder, { type: "create_project_with_initial_design", now,
    input: { clientId: "client", project: project("new"), designId: "draft-design" } }, "conflict");
});

test("revision exhaustion fails atomically and pure commands never read clock or randomness", () => {
  const saved = fixture();
  saved.revision = Number.MAX_SAFE_INTEGER;
  rejects(saved, clientCommand("new"), "revision_exhausted");
  const RealDate = globalThis.Date;
  const random = Math.random;
  try {
    globalThis.Date = new Proxy(RealDate, {
      construct() { throw new Error("Clock accessed"); },
      get(target, key, receiver) {
        if (key === "now") throw new Error("Clock accessed");
        return Reflect.get(target, key, receiver);
      },
    });
    Math.random = () => { throw new Error("Random accessed"); };
    const created = applyWorkspaceCommand(emptyWorkspaceDocument(), clientCommand()).workspace;
    applyWorkspaceCommand(created, { type: "create_project_with_initial_design", now, input: { clientId: "client", project: project() } });
  } finally {
    globalThis.Date = RealDate;
    Math.random = random;
  }
});

test("project creation serialization stays compatible with the existing document format", () => {
  const saved = apply(emptyWorkspaceDocument(), { type: "save_project", now, project: project(), createOnly: true });
  assert.equal(saved.projectDocuments[0].document, serializeProjectDocument(project()));
});

test("draft create and save preserve empty, one and two vertices without inventing machine inputs", () => {
  for (const count of [0, 1, 2]) {
    const draft = incompleteDraft();
    if (count > 0) draft.projectCrs = "EPSG:32613";
    draft.fieldBoundary = Array.from({ length: count }, (_, index) => ({ x: 100 + index, y: 200 }));
    const workspace = freeze(fixture());
    const command: WorkspaceCommand = freeze({ type: "create_design_draft", now, designId: "draft-design",
      fieldMapId: "folder-map", name: "  Draft label  ", draft, ...(count === 1 ? { isActive: false } : {}) });
    const created = applyWorkspaceCommand(workspace, command);
    assert.deepEqual(created.workspace, apply(workspace, command));
    assert.deepEqual(created.value, {
      id: "draft-design", fieldMapId: "folder-map", name: "Draft label", kind: "draft", draftId: draft.id,
      revision: 0, isActive: count !== 1, createdAt: now, updatedAt: now,
    });
    assert.deepEqual(parseDesignDraftDocument(created.workspace.draftDocuments[0].document), draft);
    assert.equal(created.workspace.projectDocuments.length, 0);
    const edited = { ...structuredClone(draft), name: "Edited incomplete draft", machine: { spanLengthsMeters: [null, 25] } };
    const save: WorkspaceCommand = { type: "save_design_draft", now: later, designId: "draft-design", expectedDesignRevision: 0, draft: edited };
    const saved = applyWorkspaceCommand(created.workspace, save);
    assert.deepEqual(saved.workspace, apply(created.workspace, save));
    assert.deepEqual(saved.value, { ...(created.value as object), revision: 1, updatedAt: later });
    assert.deepEqual(saved.value, saved.workspace.catalog.designs[0]);
    assert.notEqual(saved.value, saved.workspace.catalog.designs[0]);
    assert.deepEqual(parseDesignDraftDocument(saved.workspace.draftDocuments[0].document), edited);
    assert.equal(saved.workspace.projectDocuments.length, 0);
  }
});

test("draft commands detach caller data synchronously and retain unrelated payload bytes", () => {
  const workspace = withOwnedProject();
  workspace.projectDocuments[0].document = `\n ${workspace.projectDocuments[0].document}\n`;
  const command: WorkspaceCommand = { type: "create_design_draft", now, designId: "draft-design",
    fieldMapId: "folder-map", name: "Draft", draft: incompleteDraft() };
  const parsed = parseWorkspaceCommand(command);
  const expected = structuredClone(command.draft);
  command.draft.machine.spanLengthsMeters = [40];
  command.draft.settings.unitSystem = "metric";
  const created = apply(workspace, parsed);
  assert.deepEqual(parseDesignDraftDocument(created.draftDocuments[0].document), expected);
  assert.deepEqual(created.projectDocuments, workspace.projectDocuments);
  assert.deepEqual(created.catalog.designs[0], workspace.catalog.designs[0]);
});

test("draft saves and design deletes require the exact current design revision", () => {
  const workspace = withDraft();
  const save: WorkspaceCommand = { type: "save_design_draft", now: later, designId: "draft-design",
    expectedDesignRevision: 0, draft: incompleteDraft() };
  const saved = apply(workspace, save);
  rejects(saved, save, "conflict");
  rejects(saved, { type: "delete_design", now: later, designId: "draft-design", expectedDesignRevision: 0 }, "conflict");
  rejects(saved, { ...save, expectedDesignRevision: 2 }, "conflict");
  rejects(saved, { ...save, designId: "missing" }, "not_found");
  rejects(saved, { type: "delete_design", now, designId: "missing", expectedDesignRevision: 0 }, "not_found");
  for (const expectedDesignRevision of [undefined, -1, 0.5, "1", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    rejects(saved, { ...save, expectedDesignRevision }, "invalid_document");
    rejects(saved, { type: "delete_design", now, designId: "draft-design", expectedDesignRevision }, "invalid_document");
  }
  const deleted = apply(saved, { type: "delete_design", now: later, designId: "draft-design", expectedDesignRevision: 1 });
  assert.deepEqual(deleted.tombstones.map(record => record.revision), [2, 2]);
});

test("delete design removes only its owned payload and permanently reserves both identities", () => {
  for (const kind of ["draft", "project"] as const) {
    const workspace = withDraft(withOwnedProject());
    const designId = kind === "draft" ? "draft-design" : "design";
    const payloadId = kind === "draft" ? "draft-payload" : "payload";
    const deletion: WorkspaceCommand = { type: "delete_design", now: later, designId, expectedDesignRevision: 0 };
    const deleted = applyWorkspaceCommand(workspace, deletion);
    assert.equal(deleted.value, undefined);
    assert.deepEqual(deleted.workspace, apply(workspace, deletion));
    assert.deepEqual(deleted.workspace.catalog.projects, workspace.catalog.projects);
    assert.deepEqual(deleted.workspace.catalog.fieldMaps, workspace.catalog.fieldMaps);
    assert.deepEqual(deleted.workspace.catalog.designs, workspace.catalog.designs.filter(record => record.id !== designId));
    assert.deepEqual(deleted.workspace.projectDocuments, kind === "draft" ? workspace.projectDocuments : []);
    assert.deepEqual(deleted.workspace.draftDocuments, kind === "project" ? workspace.draftDocuments : []);
    assert.deepEqual(deleted.workspace.tombstones, [
      { entity: "design", id: designId, revision: 1, deletedAt: later },
      { entity: kind === "draft" ? "draft_document" : "project_document", id: payloadId, revision: 1, deletedAt: later },
    ]);
    const create: WorkspaceCommand = { type: "create_design_draft", now, designId: "fresh-design", fieldMapId: "folder-map", name: "Draft", draft: incompleteDraft("fresh-payload") };
    rejects(deleted.workspace, { ...create, designId }, "conflict");
    rejects(deleted.workspace, { ...create, draft: incompleteDraft(payloadId) }, "conflict");
    rejects(deleted.workspace, { type: "save_project", now, createOnly: true, project: project(payloadId) }, "conflict");
    rejects(deleted.workspace, { type: "save_design_draft", now, designId, expectedDesignRevision: 0, draft: incompleteDraft(payloadId) }, "not_found");
    rejects(deleted.workspace, deletion, "not_found");
  }
});

test("draft commands preserve payload kind and ownership and require caller-assigned fresh import identities", () => {
  const workspace = withDraft(withOwnedProject());
  const create: WorkspaceCommand = { type: "create_design_draft", now, designId: "fresh-design", fieldMapId: "folder-map", name: "Imported draft", draft: incompleteDraft("fresh-payload") };
  for (const designId of ["draft-design", "design"]) rejects(workspace, { ...create, designId }, "conflict");
  for (const id of ["draft-payload", "payload"]) rejects(workspace, { ...create, draft: incompleteDraft(id) }, "conflict");
  rejects(workspace, { ...create, fieldMapId: "absent" }, "not_found");
  rejects(workspace, { type: "save_design_draft", now, designId: "design", expectedDesignRevision: 0, draft: incompleteDraft("payload") }, "identity_mismatch");
  rejects(workspace, { type: "save_design_draft", now, designId: "draft-design", expectedDesignRevision: 0, draft: incompleteDraft("fresh-payload") }, "identity_mismatch");
  rejects(workspace, { type: "save_project", now, createOnly: true, project: project("draft-payload") }, "conflict");
  const imported = apply(workspace, create);
  assert.deepEqual(imported.draftDocuments.slice(0, 1), workspace.draftDocuments);
  assert.deepEqual(imported.projectDocuments, workspace.projectDocuments);
  assert.equal(imported.catalog.designs.at(-1)?.kind, "draft");
});

test("draft saves allow selecting CRS before coordinates but cannot relabel or erase existing XY", () => {
  const save: WorkspaceCommand = { type: "save_design_draft", now: later, designId: "draft-design", expectedDesignRevision: 0,
    draft: { ...incompleteDraft(), projectCrs: "EPSG:32613", fieldBoundary: [{ x: 10, y: 20 }] } };
  const saved = apply(withDraft(), save);
  rejects(saved, { ...save, expectedDesignRevision: 1, draft: { ...save.draft, projectCrs: "EPSG:32614" } }, "identity_mismatch");
  rejects(saved, { ...save, expectedDesignRevision: 1, draft: incompleteDraft() }, "identity_mismatch");
  rejects(withDraft(), { ...save, draft: { ...save.draft, projectCrs: null } }, "invalid_document");
});

test("completed drafts remain draft-backed through create and save", () => {
  const draft: DesignDraft = { ...project("complete-draft"), settings: incompleteDraft().settings };
  assert.equal(evaluateDesignDraftCompleteness(draft).complete, true);
  const created = apply(fixture(), { type: "create_design_draft", now, designId: "complete-design", fieldMapId: "folder-map", name: "Complete", draft });
  const saved = apply(created, { type: "save_design_draft", now: later, designId: "complete-design", expectedDesignRevision: 0, draft });
  assert.equal(saved.catalog.designs[0].kind, "draft");
  assert.equal(saved.projectDocuments.length, 0);
  assert.deepEqual(parseDesignDraftDocument(saved.draftDocuments[0].document), draft);
});

test("draft commands accept shared XY references and detach each path before applying", () => {
  for (const type of ["create_design_draft", "save_design_draft"] as const) {
    const shared = { x: 10, y: 20 };
    const draft: DesignDraft = {
      ...incompleteDraft(), projectCrs: "EPSG:32613", fieldBoundary: [shared, shared],
      pivotCenter: shared, waterSource: shared,
      surveyPoints: [{ id: "observation", label: "Shared coordinate", role: "pivot_center", projected: shared,
        observedAt: now, source: "manual", confidence: "user_estimated" }],
    };
    const command: WorkspaceCommand = type === "create_design_draft"
      ? { type, now, designId: "draft-design", fieldMapId: "folder-map", name: "Draft", draft }
      : { type, now: later, designId: "draft-design", expectedDesignRevision: 0, draft };
    const parsed = parseWorkspaceCommand(command);
    assert.ok(parsed.type === "create_design_draft" || parsed.type === "save_design_draft");
    const points = [parsed.draft.fieldBoundary[0], parsed.draft.fieldBoundary[1], parsed.draft.pivotCenter!,
      parsed.draft.waterSource!, parsed.draft.surveyPoints[0].projected];
    assert.equal(new Set(points).size, points.length);
    for (const point of points) assert.notEqual(point, shared);
    const expected = structuredClone(draft);
    shared.x = 999;
    const saved = apply(type === "create_design_draft" ? fixture() : withDraft(), parsed);
    assert.deepEqual(parseDesignDraftDocument(saved.draftDocuments[0].document), expected);
    points[0].x = 30;
    assert.ok(points.slice(1).every(point => point.x === 10));
    assert.deepEqual(parseDesignDraftDocument(saved.draftDocuments[0].document), expected);
  }
});

test("draft command parsing rejects unknown fields, cycles and accessors before mutation", () => {
  const workspace = withDraft();
  const create: WorkspaceCommand = { type: "create_design_draft", now, designId: "fresh-design", fieldMapId: "folder-map", name: "Draft", draft: incompleteDraft("fresh-payload") };
  const save: WorkspaceCommand = { type: "save_design_draft", now, designId: "draft-design", expectedDesignRevision: 0, draft: incompleteDraft() };
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  let getterCalls = 0;
  const accessorDraft = Object.defineProperty(incompleteDraft(), "machine", {
    enumerable: true, get() { getterCalls++; throw new Error("Accessor must not run"); },
  });
  const nestedAccessor = Object.defineProperty({}, "spanLengthsMeters", {
    enumerable: true, get() { getterCalls++; throw new Error("Nested accessor must not run"); },
  });
  const jsonHook = () => { getterCalls++; throw new Error("JSON hook must not run"); };
  for (const command of [create, save]) {
    for (const invalid of [
      { ...command, unknown: true },
      { ...command, expectedRevision: 0 },
      { ...command, draft: { ...command.draft, extension: true } },
      { ...command, draft: { ...command.draft, machine: { extension: true } } },
      { ...command, draft: { ...command.draft, settings: { ...command.draft.settings, extension: true } } },
      { ...command, draft: { ...command.draft, projectCrs: "EPSG:32613", fieldBoundary: [{ x: 1, y: 2, extension: true }] } },
      { ...command, draft: { ...command.draft, machine: cyclic } },
      { ...command, draft: accessorDraft },
      { ...command, draft: { ...command.draft, machine: nestedAccessor } },
      { ...command, draft: { ...command.draft, machine: Object.defineProperty({}, "hidden", { value: true }) } },
      { ...command, draft: { ...command.draft, machine: { [Symbol("hidden")]: true } } },
      { ...command, draft: { ...command.draft, machine: { toJSON: jsonHook } } },
      { ...command, draft: { ...command.draft, toJSON: jsonHook } },
      { ...command, draft: { ...command.draft, projectCrs: "EPSG:32613", fieldBoundary: new Array(1) } },
      { ...command, draft: undefined },
    ]) {
      rejects(workspace, invalid, "invalid_document");
      assert.throws(() => parseWorkspaceCommand(invalid), (error: unknown) => error instanceof WorkspaceDocumentError && error.code === "invalid_document");
    }
  }
  rejects(workspace, { type: "delete_design", now, designId: "draft-design", expectedDesignRevision: 0, draft: incompleteDraft() }, "invalid_document");
  assert.equal(getterCalls, 0);
});

test("draft command revision exhaustion leaves the workspace unchanged", () => {
  const workspace = withDraft();
  workspace.revision = Number.MAX_SAFE_INTEGER;
  for (const command of [
    { type: "create_design_draft", now, designId: "fresh", fieldMapId: "folder-map", name: "Draft", draft: incompleteDraft("fresh") },
    { type: "save_design_draft", now, designId: "draft-design", expectedDesignRevision: 0, draft: incompleteDraft() },
    { type: "delete_design", now, designId: "draft-design", expectedDesignRevision: 0 },
  ]) rejects(workspace, command, "revision_exhausted");
});

test("draft commands omit known optional undefined fields without admitting unknown undefined fields", () => {
  for (const type of ["create_design_draft", "save_design_draft"] as const) {
    const draft = incompleteDraft();
    draft.settings = defaultProjectSettings();
    draft.machine.overhangMeters = undefined;
    draft.mapFeatures = undefined;
    const expected = parseDesignDraftDocument(serializeDesignDraftDocument(draft));
    assert.equal(Object.hasOwn(expected.settings.aerialImagery, "sourcePackageId"), false);
    assert.equal(Object.hasOwn(expected.machine, "overhangMeters"), false);
    const command: WorkspaceCommand = type === "create_design_draft"
      ? { type, now, designId: "draft-design", fieldMapId: "folder-map", name: "Draft", draft }
      : { type, now, designId: "draft-design", expectedDesignRevision: 0, draft };
    const workspace = type === "create_design_draft" ? fixture() : withDraft();
    const saved = apply(workspace, command);
    assert.deepEqual(parseDesignDraftDocument(saved.draftDocuments[0].document), expected);
    for (const invalid of [
      { ...command, unknown: undefined },
      { ...command, draft: { ...draft, unknown: undefined } },
      { ...command, draft: { ...draft, machine: { ...draft.machine, unknown: undefined } } },
      { ...command, draft: { ...draft, settings: { ...draft.settings, unknown: undefined } } },
    ]) rejects(workspace, invalid, "invalid_document");
  }
});
