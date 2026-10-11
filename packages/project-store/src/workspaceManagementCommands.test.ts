import assert from "node:assert/strict";
import test from "node:test";
import {
  sampleProject, defaultProjectSettings, serializeProjectDocument, convertPivotProjectToFieldDesign,
  createFieldLayoutTarget, serializeFieldLayoutTarget, parseFieldDesignDocument,
  createSurveyCollection, projectLonLatToXy, readSurveyDesignDocument,
  type DesignDraft, type PivotProject, type FieldDesign, type SurveyPoint, type OperationalFixedGgaEvidence,
} from "@cplayout/core";
import { applyWorkspaceCommand, parseWorkspaceCommand, type WorkspaceCommand } from "./workspaceCommands";
import { emptyWorkspaceDocument, validateWorkspaceDocument, serializeWorkspaceDocument, workspaceDesignSource, WorkspaceDocumentError,
  type WorkspaceDocument } from "./workspaceDocument";
import { createVersionedProjectRepository } from "./versionedProjectRepository";
import { WEB_WORKSPACE_KEY, type WorkspaceLocks } from "./webWorkspaceStore";
import { createSqliteWorkspaceStore, NativeWorkspaceCommandRefusal } from "./sqliteWorkspaceStore";

const now = "2026-10-11T12:00:00.000Z", later = "2026-10-11T12:01:00.000Z";
const kinds = ["project", "draft", "field"] as const;
type Kind = typeof kinds[number];
const designId = (kind: Kind) => `${kind}-design`;
const alias = (kind: Kind) => `${kind} historical catalog alias`;
const source = (workspace: WorkspaceDocument, kind: Kind) => workspaceDesignSource(workspace, designId(kind));
function payload(workspace: WorkspaceDocument, kind: Kind) {
  const saved = source(workspace, kind); return readSurveyDesignDocument(kind, saved.document);
}
function apply(workspace: WorkspaceDocument, command: WorkspaceCommand) { return applyWorkspaceCommand(workspace, command).workspace; }
function draft(id: string): DesignDraft {
  return { id, name: "Old draft title", projectCrs: "EPSG:32613", unitSystem: "metric",
    settings: { ...defaultProjectSettings(), unitSystem: "metric" }, fieldBoundary: [], pivotCenter: null,
    waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
}
function observed(id: string): SurveyPoint & { captureEvidence: OperationalFixedGgaEvidence } {
  const sentenceBody = "GNGGA,120000.00,4000.0000,N,10500.0000,W,4,12,0.8,1600.0,M,-20.0,M,1.0,42";
  const checksum = [...sentenceBody].reduce((value, character) => value ^ character.charCodeAt(0), 0).toString(16).padStart(2, "0");
  return { id, label: "Recorded point  ", notes: "Original notes\nremain", role: "control", observedAt: now,
    projected: projectLonLatToXy({ latitude: 40, longitude: -105 }, "EPSG:32613"), wgs84: { latitude: 40, longitude: -105 },
    source: "external_gnss", confidence: "rtk_fixed", captureEvidence: {
      schemaVersion: "gnss-operational-fixed-v1", observationId: `receiver:${id}`, sessionId: "synthetic-receiver", transport: "local_udp",
      receivedAt: now, receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true,
      antennaReference: "unknown", sentenceTypes: ["GGA"],
      gga: { sentence: `$${sentenceBody}*${checksum}`, sentenceIdentifier: "GNGGA", utcTime: "120000.00", qualityCode: 4, latitude: 40, longitude: -105 },
      receipt: { sequence: 1, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 500, provenance: "loopback_companion" },
      capture: { evaluatedMonotonicMs: 1500, ageMs: 1000, maxAgeMs: 2000 },
      projection: { id: "wgs84-projection-v1:EPSG:32613", projectCrs: "EPSG:32613" }, physicalQualification: "unverified",
    } };
}
function fixture(): WorkspaceDocument {
  let workspace = apply(emptyWorkspaceDocument(), { type: "create_client", now, id: "customer",
    input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } });
  const project: PivotProject = { ...structuredClone(sampleProject), id: "project-payload", name: "Old project title" };
  const originalProjectDocument = `\n ${serializeProjectDocument(project)} \n`;
  workspace = apply(workspace, { type: "create_project_with_initial_design", now, input: { clientId: "customer", project,
    fieldMapId: "field-container", fieldMapName: "Field container", designId: designId("project"), designName: alias("project") } });
  workspace = apply(workspace, { type: "create_field_map_record", now,
    input: { id: "other-field", projectId: project.id, name: "Field container" } });
  workspace = apply(workspace, { type: "create_design_draft", now, designId: designId("draft"), fieldMapId: "field-container",
    name: alias("draft"), draft: draft("draft-payload") });
  workspace = apply(workspace, { type: "upgrade_workspace_to_v2", now });
  const field = convertPivotProjectToFieldDesign(originalProjectDocument, { fieldId: "field-payload", waterSourceId: "water", powerSourceId: "power" }).field;
  field.name = "Old field-design title";
  workspace = apply(workspace, { type: "create_field_design", now, designId: designId("field"), fieldMapId: "field-container",
    name: alias("field"), field, originalProjectDocument });
  workspace = apply(workspace, { type: "upgrade_workspace_to_v3", now });
  workspace = apply(workspace, { type: "upgrade_workspace_to_v4", now });
  for (const kind of kinds) {
    const owner = source(workspace, kind);
    workspace = apply(workspace, { type: "create_survey_collection", now, expectedDesignRevision: owner.design.revision,
      collection: createSurveyCollection({ id: `${kind}-survey`, now, purpose: { kind: "point", role: "control" },
        owner: { designId: owner.design.id, documentKind: kind, payloadId: owner.payloadId, fieldMapId: "field-container", projectCrs: "EPSG:32613" } }) });
    workspace = apply(workspace, { type: "append_survey_capture", now, collectionId: `${kind}-survey`, expectedCollectionRevision: 0,
      expectedDesignRevision: owner.design.revision, point: observed(`${kind}-point`) });
  }
  const savedField = parseFieldDesignDocument(source(workspace, "field").document);
  const targetDocument = `\n${serializeFieldLayoutTarget(createFieldLayoutTarget(savedField,
    { inputRevision: 1, expectedRevision: 1, selectedMachineIds: [savedField.machines[0].id] }))}\n`;
  workspace = apply(workspace, { type: "create_layout_session", now, sessionId: "layout", fieldMapId: "field-container", name: "Frozen Layout", targetDocument });
  const point = observed("layout-point");
  workspace = apply(workspace, { type: "append_layout_observation", now, sessionId: "layout", expectedSessionRevision: 0,
    observation: { id: "layout-observation", sessionId: "layout", capturedAt: now, projected: point.projected, evidence: point.captureEvidence } });
  workspace = apply(workspace, { type: "create_design_draft", now, designId: "retired", fieldMapId: "field-container", name: "Archived", draft: draft("retired-payload") });
  workspace = apply(workspace, { type: "create_survey_collection", now, expectedDesignRevision: 0,
    collection: createSurveyCollection({ id: "retired-survey", now, purpose: { kind: "field_boundary" },
      owner: { designId: "retired", documentKind: "draft", payloadId: "retired-payload", fieldMapId: "field-container", projectCrs: "EPSG:32613" } }) });
  workspace = apply(workspace, { type: "append_survey_capture", now, collectionId: "retired-survey", expectedCollectionRevision: 0,
    expectedDesignRevision: 0, point: observed("retired-point") });
  workspace = apply(workspace, { type: "archive_and_delete_design", now, designId: "retired", expectedDesignRevision: 0,
    collectionIds: [{ id: "retired-survey", expectedRevision: 1 }] });
  // Bind preservation assertions to exact source strings, including harmless whitespace.
  for (const entry of [...workspace.projectDocuments, ...workspace.draftDocuments, ...workspace.fieldDocuments!, ...workspace.layoutSessions!])
    entry.document = `\n ${entry.document} \n`;
  return validateWorkspaceDocument(workspace);
}
function saveCommand(workspace: WorkspaceDocument, kind: Kind, name: string, syncCatalogName?: boolean): WorkspaceCommand {
  const data = { ...payload(workspace, kind), name }, owner = source(workspace, kind);
  const optional = syncCatalogName === undefined ? {} : { syncCatalogName };
  return kind === "project" ? { type: "save_design_project", now: later, designId: owner.design.id, project: data as PivotProject, ...optional }
    : kind === "draft" ? { type: "save_design_draft", now: later, designId: owner.design.id, expectedDesignRevision: owner.design.revision, draft: data as DesignDraft, ...optional }
      : { type: "save_field_design", now: later, designId: owner.design.id, expectedDesignRevision: owner.design.revision, field: data as FieldDesign, ...optional };
}
function assertOtherDataExact(before: WorkspaceDocument, after: WorkspaceDocument, kind: Kind) {
  assert.deepEqual(after.catalog.fieldMaps, before.catalog.fieldMaps);
  assert.deepEqual(after.catalog.clients, before.catalog.clients); assert.deepEqual(after.catalog.projects, before.catalog.projects);
  for (const other of kinds.filter(value => value !== kind)) assert.deepEqual(source(after, other), source(before, other));
  assert.deepEqual(after.surveyCollections, before.surveyCollections); assert.deepEqual(after.surveyOwnerArchives, before.surveyOwnerArchives);
  assert.deepEqual(after.layoutSessions, before.layoutSessions); assert.deepEqual(after.tombstones, before.tombstones);
  assert.equal(after.originalV1Document, before.originalV1Document);
  assert.equal(after.originalPreviousWorkspaceDocument, before.originalPreviousWorkspaceDocument);
  assert.equal(after.originalSurveyUpgradeDocument, before.originalSurveyUpgradeDocument);
  assert.equal(source(after, "field").originalProjectDocument, source(before, "field").originalProjectDocument);
}
class Storage {
  values = new Map<string, string>(); fail = false; writes = 0;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail && key === WEB_WORKSPACE_KEY) throw new Error("Synthetic quota failure"); this.writes++; this.values.set(key, value); }
}
class Locks implements WorkspaceLocks {
  tail: Promise<unknown> = Promise.resolve();
  request<T>(_name: string, _options: { mode: "exclusive" }, run: () => T | PromiseLike<T>): Promise<T> {
    const result = this.tail.then(run); this.tail = result.catch(() => undefined); return result;
  }
  hold() { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); this.tail = this.tail.then(() => wait); return release; }
}
async function webFixture() {
  const storage = new Storage(), locks = new Locks();
  const api = createVersionedProjectRepository({ getStorage: () => storage, getLocks: () => locks }).versionedWorkspace!;
  await api.readAsync(); const workspace = fixture(); storage.values.set(WEB_WORKSPACE_KEY, serializeWorkspaceDocument(workspace));
  return { api, storage, locks, workspace };
}

test("field rename admits only exact typed arguments and detaches before the queue", () => {
  const input = { type: "rename_field_map", now: later, fieldMapId: "field-container", name: "  North\n Field  " };
  const parsed = parseWorkspaceCommand(input); input.name = "Mutated"; input.fieldMapId = "other-field";
  assert.deepEqual(parsed, { type: "rename_field_map", now: later, fieldMapId: "field-container", name: "  North\n Field  " });
  for (const bad of [{ ...input, name: "" }, { ...input, name: " \n\t " }, { ...input, unexpected: true }, { ...input, fieldMapId: "" }])
    assert.throws(() => parseWorkspaceCommand(bad), WorkspaceDocumentError);
  for (const kind of kinds) assert.throws(() => parseWorkspaceCommand({ ...saveCommand(fixture(), kind, "Changed"), syncCatalogName: "true" }), WorkspaceDocumentError);
});

test("field rename changes only that container name/timestamp and workspace revision; all source bytes remain exact", () => {
  const before = fixture(), raw = serializeWorkspaceDocument(before);
  const result = applyWorkspaceCommand(before, { type: "rename_field_map", now: later, fieldMapId: "field-container", name: "  North\n Field  " });
  const expected = structuredClone(before); expected.revision++;
  const record = expected.catalog.fieldMaps.find(item => item.id === "field-container")!; record.name = "North Field"; record.updatedAt = later;
  assert.deepEqual(result.workspace, expected); assert.deepEqual(result.value, record);
  assert.equal(serializeWorkspaceDocument(before), raw);
  assert.ok(before.tombstones.length && before.surveyOwnerArchives!.length && before.surveyCollections!.length);
  assert.ok(JSON.parse(before.layoutSessions![0].document).observations.length);
});

test("missing field, blank name and exhausted workspace revision refuse without mutating the source", () => {
  const before = fixture(), raw = serializeWorkspaceDocument(before);
  for (const command of [{ type: "rename_field_map", now: later, fieldMapId: "missing", name: "Changed" },
    { type: "rename_field_map", now: later, fieldMapId: "field-container", name: " \t " }] as WorkspaceCommand[])
    assert.throws(() => applyWorkspaceCommand(before, command), WorkspaceDocumentError);
  const exhausted = { ...before, revision: Number.MAX_SAFE_INTEGER };
  assert.throws(() => applyWorkspaceCommand(exhausted, { type: "rename_field_map", now: later, fieldMapId: "field-container", name: "Changed" }), /revision/i);
  assert.equal(serializeWorkspaceDocument(before), raw); assert.equal(exhausted.revision, Number.MAX_SAFE_INTEGER);
});

for (const kind of kinds) {
  test(`${kind} saves preserve historical aliases by default and when explicitly false`, () => {
    for (const flag of [undefined, false]) {
      const before = fixture(), raw = serializeWorkspaceDocument(before), name = `  New ${kind}\n title  `;
      const after = apply(before, saveCommand(before, kind, name, flag));
      assert.equal(source(after, kind).design.name, alias(kind)); assert.equal(payload(after, kind).name, name);
      assert.equal(source(after, kind).design.revision, source(before, kind).design.revision + 1);
      assert.equal(after.revision, before.revision + 1); assertOtherDataExact(before, after, kind);
      assert.equal(serializeWorkspaceDocument(before), raw);
    }
  });
  test(`${kind} opt-in preserves alias on unchanged payload name and synchronizes only an actual rename`, () => {
    const before = fixture(), oldPayload = payload(before, kind);
    const unchanged = apply(before, saveCommand(before, kind, oldPayload.name, true));
    assert.equal(source(unchanged, kind).design.name, alias(kind)); assertOtherDataExact(before, unchanged, kind);
    const name = `  New ${kind}\n title  `, after = apply(before, saveCommand(before, kind, name, true));
    assert.equal(source(after, kind).design.name, `New ${kind} title`);
    assert.deepEqual(payload(after, kind), { ...oldPayload, name });
    assert.equal(source(after, kind).design.revision, source(before, kind).design.revision + 1);
    assert.equal(after.revision, before.revision + 1); assertOtherDataExact(before, after, kind);
  });
  test(`${kind} name synchronization cannot bypass payload identity/CRS or retained operational evidence`, () => {
    const before = fixture(), raw = serializeWorkspaceDocument(before), command = saveCommand(before, kind, "Changed", true);
    const key = kind === "project" ? "project" : kind === "draft" ? "draft" : "field";
    const data = payload(before, kind);
    const rewritten = structuredClone(data);
    const captured = rewritten.surveyPoints.find(point => point.id === `${kind}-point`)!;
    assert.equal(captured.captureEvidence?.schemaVersion, "gnss-operational-fixed-v1");
    (captured.captureEvidence as OperationalFixedGgaEvidence).receipt.sequence++;
    for (const changed of [{ ...data, id: "wrong-payload", name: "Changed" }, { ...data, projectCrs: "EPSG:32614", name: "Changed" },
      { ...rewritten, name: "Changed" }]) {
      assert.throws(() => applyWorkspaceCommand(before, { ...command, [key]: changed } as WorkspaceCommand));
      assert.equal(serializeWorkspaceDocument(before), raw);
    }
    if (command.type === "save_design_draft" || command.type === "save_field_design") {
      assert.throws(() => applyWorkspaceCommand(before, { ...command, expectedDesignRevision: command.expectedDesignRevision - 1 }), /revision/i);
      assert.equal(serializeWorkspaceDocument(before), raw);
    }
  });
  test(`${kind} title sync retains admitted Undo removal semantics and keeps the authoritative collection exact`, () => {
    const before = fixture(), command = saveCommand(before, kind, "Changed", true);
    const key = kind === "project" ? "project" : kind === "draft" ? "draft" : "field";
    const after = apply(before, { ...command, [key]: { ...payload(before, kind), name: "Changed", surveyPoints: [] } } as WorkspaceCommand);
    assert.deepEqual(payload(after, kind).surveyPoints, []);
    assert.equal(source(after, kind).design.name, "Changed");
    assertOtherDataExact(before, after, kind);
    assert.equal(JSON.parse(after.surveyCollections!.find(collection => collection.id === `${kind}-survey`)!.document).observations.length, 1);
  });
  test(`${kind} title and document commit together; stale CAS, retired queued owner and quota publish neither`, async () => {
    const { api, storage, locks, workspace } = await webFixture(), command = saveCommand(workspace, kind, "Changed", true);
    const raw = storage.getItem(WEB_WORKSPACE_KEY), writes = storage.writes;
    await assert.rejects(api.executeAsync(workspace.revision - 1, command, () => true), /revision/i);
    const release = locks.hold(); let current = true;
    const pending = api.executeAsync(workspace.revision, command, () => current); current = false; release();
    await assert.rejects(pending, /changed|current|retired|conflict/i);
    storage.fail = true; await assert.rejects(api.executeAsync(workspace.revision, command, () => true), /quota|persist|write|storage/i);
    assert.equal(storage.getItem(WEB_WORKSPACE_KEY), raw); assert.equal(storage.writes, writes);
    storage.fail = false;
    const result = await api.executeAsync(workspace.revision, command, () => true);
    assert.equal(source(result.workspace, kind).design.name, "Changed"); assert.equal(payload(result.workspace, kind).name, "Changed");
    assert.equal(storage.writes, writes + 1); assertOtherDataExact(workspace, result.workspace, kind);
  });
}

test("queued field rename uses detached bytes; competing CAS permits one winner and no partial second rename", async () => {
  const { api, storage, locks, workspace } = await webFixture();
  const release = locks.hold();
  const command: WorkspaceCommand = { type: "rename_field_map", now: later, fieldMapId: "field-container", name: "First field" };
  const first = api.executeAsync(workspace.revision, command, () => true);
  command.name = "Retargeted"; command.fieldMapId = "other-field";
  const second = api.executeAsync(workspace.revision, { type: "rename_field_map", now: later, fieldMapId: "other-field", name: "Second field" }, () => true);
  const outcomes = Promise.allSettled([first, second]); release();
  const results = await outcomes; assert.equal(results[0].status, "fulfilled"); assert.equal(results[1].status, "rejected");
  const expected = apply(workspace, { type: "rename_field_map", now: later, fieldMapId: "field-container", name: "First field" });
  assert.deepEqual(await api.readAsync(), expected); assert.equal(storage.getItem(WEB_WORKSPACE_KEY), serializeWorkspaceDocument(expected));
});

test("field rename refuses stale revision, under-lock retirement and quota without publishing metadata", async () => {
  const { api, storage, locks, workspace } = await webFixture(), raw = storage.getItem(WEB_WORKSPACE_KEY), writes = storage.writes;
  const command: WorkspaceCommand = { type: "rename_field_map", now: later, fieldMapId: "field-container", name: "Changed" };
  await assert.rejects(api.executeAsync(workspace.revision - 1, command, () => true), /revision/i);
  const release = locks.hold(); let current = true;
  const pending = api.executeAsync(workspace.revision, command, () => current); current = false; release();
  await assert.rejects(pending, /changed|current|retired|conflict/i);
  storage.fail = true; await assert.rejects(api.executeAsync(workspace.revision, command, () => true), /quota|persist|write|storage/i);
  assert.equal(storage.getItem(WEB_WORKSPACE_KEY), raw); assert.equal(storage.writes, writes);
});

test("native field-container rename refuses before any host or database access", async () => {
  let touches = 0;
  const store = createSqliteWorkspaceStore(new Proxy({}, { get() { touches++; throw new Error("Unexpected host/database access"); } }) as never);
  for (const revision of [0, Number.MAX_SAFE_INTEGER, -1]) await assert.rejects(store.executeAsync(revision,
    { type: "rename_field_map", now: later, fieldMapId: "field-container", name: "Changed" }),
  error => error instanceof NativeWorkspaceCommandRefusal && error.code === "unsupported_version");
  await assert.rejects(store.executeAsync(0, { type: "rename_field_map", now: later, fieldMapId: "field-container", name: " \t " }), WorkspaceDocumentError);
  assert.equal(touches, 0);
});
