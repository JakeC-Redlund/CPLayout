import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { createSurveyCollection, parseSurveyCollectionDocument } from "../../core/src/surveyCollection";
import { projectLonLatToXy } from "../../core/src/coordinates";
import { defaultProjectSettings } from "../../core/src/settings";
import { readSurveyDesignDocument } from "../../core/src/surveyCollectionApplication";
import { sampleProject } from "../../core/src/sampleProject";
import { serializeProjectDocument } from "../../core/src/projectDocument";
import { convertPivotProjectToFieldDesign } from "../../core/src/fieldDesignDocument";
import { createFieldLayoutTarget, serializeFieldLayoutTarget } from "../../core/src/fieldLayoutTarget";
import { sha256Text } from "../../core/src/sha256";
import type { OperationalFixedGgaEvidence } from "../../core/src/operationalGnssEvidence";
import type { SurveyPoint } from "../../core/src/types";
import { createVersionedProjectRepository } from "./versionedProjectRepository";
import { createSqliteWorkspaceStore } from "./sqliteWorkspaceStore";
import { WEB_WORKSPACE_KEY, type WorkspaceLocks } from "./webWorkspaceStore";
import { parseWorkspaceDocument, parseV1WorkspaceDocument, parseV2WorkspaceDocument, parseV3WorkspaceDocument, workspaceDesignSource } from "./workspaceDocument";
import { buildDesignWorkspaceBundle, parseDesignWorkspaceBundle, serializeDesignWorkspaceBundle, exportDesignWorkspaceBundleZip, importDesignWorkspaceBundleZip } from "./designWorkspaceBundle";
import { importDesignDraftArchiveZip } from "./designDraftArchive";
import type { WorkspaceCommand } from "./workspaceCommands";

const now = "2026-10-10T12:00:00.000Z";
class Storage {
  values = new Map<string, string>(); fail = false; observe?: (key: string) => void;
  getItem(key: string) { this.observe?.(key); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail && key === WEB_WORKSPACE_KEY) throw new Error("Synthetic quota failure"); this.values.set(key, value); }
}
class Locks implements WorkspaceLocks {
  tail: Promise<unknown> = Promise.resolve();
  request<T>(_name: string, _options: { mode: "exclusive" }, run: () => T | PromiseLike<T>): Promise<T> {
    const result = this.tail.then(run); this.tail = result.catch(() => undefined); return result;
  }
  hold() { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); this.tail = this.tail.then(() => wait); return release; }
}
async function fixture() {
  const storage = new Storage(), locks = new Locks();
  const api = createVersionedProjectRepository({ getStorage: () => storage, getLocks: () => locks }).versionedWorkspace!;
  let current = await api.readAsync();
  async function execute(command: unknown, guard?: () => boolean) {
    const result = await api.executeAsync(current.revision, { now, ...command as object } as WorkspaceCommand, guard); current = result.workspace; return result;
  }
  await execute({ type: "create_client", id: "client", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } });
  await execute({ type: "create_project_with_initial_field_map", input: { clientId: "client", projectId: "project", projectName: "Synthetic project", projectCrs: "EPSG:32613", unitSystem: "metric", fieldMapId: "map" } });
  const draft = { id: "draft", name: "Incomplete", projectCrs: "EPSG:32613", unitSystem: "metric", settings: { ...defaultProjectSettings(), unitSystem: "metric" }, fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
  await execute({ type: "create_design_draft", designId: "design", fieldMapId: "map", name: "Incomplete", draft });
  await execute({ type: "upgrade_workspace_to_v3" });
  return { api, storage, locks, execute, current: () => current, upgrade: () => execute({ type: "upgrade_workspace_to_v4" }) };
}
function point(sequence: number, latitude = 40, longitude = -105): SurveyPoint {
  const coord = (value: number, width: number) => `${String(Math.floor(Math.abs(value))).padStart(width, "0")}${((Math.abs(value) % 1) * 60).toFixed(4).padStart(7, "0")}`;
  const utcTime = `1200${String(sequence).padStart(2, "0")}.00`;
  const payload = `GNGGA,${utcTime},${coord(latitude, 2)},N,${coord(longitude, 3)},W,4,12,0.8,1600.0,M,-20.0,M,1.0,42`;
  const checksum = [...payload].reduce((value, char) => value ^ char.charCodeAt(0), 0).toString(16).padStart(2, "0");
  const evidence: OperationalFixedGgaEvidence = { schemaVersion: "gnss-operational-fixed-v1", observationId: `receiver:${sequence}`, sessionId: "receiver", transport: "local_udp",
    receivedAt: now, receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true, antennaReference: "unknown", sentenceTypes: ["GGA"],
    gga: { sentence: `$${payload}*${checksum}`, sentenceIdentifier: "GNGGA", utcTime, qualityCode: 4, latitude, longitude },
    receipt: { sequence, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 500, provenance: "loopback_companion" },
    capture: { evaluatedMonotonicMs: 1500, ageMs: 1000, maxAgeMs: 2000 }, projection: { id: "wgs84-projection-v1:EPSG:32613", projectCrs: "EPSG:32613" }, physicalQualification: "unverified" };
  return { id: `point:${sequence}`, label: "Synthetic captured point", role: "control", projected: projectLonLatToXy({ latitude, longitude }, "EPSG:32613"), wgs84: { latitude, longitude },
    observedAt: now, source: "external_gnss", confidence: "rtk_fixed", captureEvidence: evidence };
}
async function create(f: Awaited<ReturnType<typeof fixture>>, purpose: Parameters<typeof createSurveyCollection>[0]["purpose"] = { kind: "field_boundary" }, id = "survey") {
  const collection = createSurveyCollection({ id, now, purpose, owner: { designId: "design", documentKind: "draft", payloadId: "draft", fieldMapId: "map", projectCrs: "EPSG:32613" } });
  await f.execute({ type: "create_survey_collection", collection, expectedDesignRevision: f.current().catalog.designs[0].revision });
}
function append(f: Awaited<ReturnType<typeof fixture>>, observed: SurveyPoint, guard?: () => boolean) {
  const collection = parseSurveyCollectionDocument(f.current().surveyCollections![0].document);
  return f.execute({ type: "append_survey_capture", collectionId: collection.id, expectedCollectionRevision: collection.revision,
    expectedDesignRevision: f.current().catalog.designs[0].revision, point: observed }, guard);
}

test("v4 upgrade retains exact whitespace-bearing v3 source and every earlier record; frozen readers refuse", async () => {
  const f = await fixture(); const before = f.current();
  const raw = `\n${f.storage.getItem(WEB_WORKSPACE_KEY)}\n`;
  f.storage.values.set(WEB_WORKSPACE_KEY, raw);
  await f.upgrade();
  assert.equal(f.current().originalSurveyUpgradeDocument, raw);
  const { surveyCollections, surveyOwnerArchives, originalSurveyUpgradeDocument, ...retained } = f.current();
  assert.deepEqual({ ...retained, workspaceVersion: before.workspaceVersion, revision: before.revision }, before);
  assert.deepEqual(surveyCollections, []); assert.deepEqual(surveyOwnerArchives, []);
  for (const reader of [parseV1WorkspaceDocument, parseV2WorkspaceDocument, parseV3WorkspaceDocument]) assert.throws(() => reader(f.storage.getItem(WEB_WORKSPACE_KEY)!));
});

test("unfinished 1/2/3 boundary captures persist, reopen and apply disconnected; Undo keeps evidence", async () => {
  const f = await fixture(); await f.upgrade(); await create(f);
  const original = f.current().draftDocuments[0].document;
  for (const observed of [point(1), point(2, 40.01), point(3, 40, -105.01)]) {
    await append(f, observed, () => true);
    const reopened = await f.api.readAsync();
    assert.deepEqual(parseSurveyCollectionDocument(reopened.surveyCollections![0].document).observations.at(-1), observed);
    assert.equal(reopened.draftDocuments[0].document, original);
  }
  await f.execute({ type: "apply_survey_collection", collectionId: "survey", expectedCollectionRevision: 3, expectedDesignRevision: 0, applicationId: "apply" });
  const applied = parseSurveyCollectionDocument(f.current().surveyCollections![0].document);
  assert.equal(applied.state, "applied"); assert.equal(applied.observations.length, 3);
  assert.equal(readSurveyDesignDocument("draft", f.current().draftDocuments[0].document).fieldBoundary.length, 3);
  await f.execute({ type: "restore_design_survey_history", designId: "design", expectedDesignRevision: 1, document: original,
    memberships: [{ collectionId: "survey", expectedCollectionRevision: 4, activePointIds: applied.observations.map(item => item.id), state: "pending" }] });
  const restored = parseSurveyCollectionDocument(f.current().surveyCollections![0].document);
  assert.deepEqual(restored.observations, applied.observations); assert.deepEqual(restored.applications, applied.applications);
  assert.equal(f.current().draftDocuments[0].document, original);
  await f.execute({ type: "set_survey_membership", collectionId: "survey", expectedCollectionRevision: 5, expectedDesignRevision: 2, activePointIds: [], state: "cleared" });
  assert.deepEqual(parseSurveyCollectionDocument(f.current().surveyCollections![0].document).observations, applied.observations);
});

test("point append persists actual design and ledger together without promoting machine geometry", async () => {
  const f = await fixture(); await f.upgrade(); await create(f, { kind: "point", role: "control" });
  await append(f, point(1), () => true);
  const source = readSurveyDesignDocument("draft", f.current().draftDocuments[0].document);
  assert.deepEqual(source.surveyPoints[0], point(1)); assert.deepEqual("machine" in source && source.machine, {});
  assert.equal("pivotCenter" in source && source.pivotCenter, null); assert.equal(f.current().catalog.designs[0].revision, 1);
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(append(f, point(1), () => true), /Duplicate|Point collection/);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
});

test("capture requires external predicate, rechecks held lock and fails immediately before atomic write", async () => {
  const f = await fixture(); await f.upgrade(); await create(f);
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(append(f, point(1)), /external commit/i);
  const release = f.locks.hold(); let owned = true;
  const delayed = append(f, point(1), () => owned); owned = false; release();
  await assert.rejects(delayed, /owner|observation/i);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  owned = true; let reads = 0;
  f.storage.observe = key => { if (key === WEB_WORKSPACE_KEY && ++reads === 2) owned = false; };
  await assert.rejects(append(f, point(1), () => owned), /before atomic/i);
  f.storage.observe = undefined;
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
});

test("quota, stale tabs, unknown references and foreign owners leave exact storage unchanged", async () => {
  const f = await fixture(); await f.upgrade(); await create(f);
  const revision = f.current().revision, before = f.storage.getItem(WEB_WORKSPACE_KEY);
  f.storage.fail = true; await assert.rejects(append(f, point(1), () => true), /quota/i); f.storage.fail = false;
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  await append(f, point(1), () => true);
  const saved = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.api.executeAsync(revision, { type: "append_survey_capture", now, collectionId: "survey", expectedCollectionRevision: 0, expectedDesignRevision: 0, point: point(2) }, () => true), /revision/i);
  await assert.rejects(f.execute({ type: "set_survey_membership", collectionId: "survey", expectedCollectionRevision: 1, expectedDesignRevision: 0, activePointIds: ["missing"], state: "pending" }), /resolve/i);
  const foreign = createSurveyCollection({ id: "foreign", now, purpose: { kind: "field_boundary" }, owner: { designId: "design", documentKind: "draft", payloadId: "foreign", fieldMapId: "map", projectCrs: "EPSG:32613" } });
  await assert.rejects(f.execute({ type: "create_survey_collection", collection: foreign, expectedDesignRevision: 0 }), /owner|identity|invalid/i);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), saved);
});

test("cross-collection receiver payload conflicts are refused by both transaction and complete bundle parser", async () => {
  const f = await fixture(); await f.upgrade(); await create(f); await append(f, point(1), () => true);
  await create(f, { kind: "field_boundary" }, "second");
  const conflict = point(2, 40.01);
  conflict.captureEvidence!.observationId = "receiver:1";
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.execute({ type: "append_survey_capture", collectionId: "second", expectedCollectionRevision: 0, expectedDesignRevision: 0, point: conflict }, () => true), /conflict|immutable|invalid/i);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  const original = buildDesignWorkspaceBundle(f.current(), "design");
  const badCollection = parseSurveyCollectionDocument({ ...parseSurveyCollectionDocument(original.surveyDocuments[1]), observations: [conflict], activePointIds: [conflict.id] });
  const changed = JSON.stringify(badCollection);
  assert.throws(() => parseDesignWorkspaceBundle({ ...original, surveyDocuments: [original.surveyDocuments[0], changed],
    inventory: original.inventory.map(item => item.filename === "survey-1.json" ? { ...item, sha256: sha256Text(changed) } : item) }), /conflict|rewrite/i);
});

test("recorded reference capture remains durable and pending when Apply lacks required neutral reference details", async () => {
  const f = await fixture(); await f.upgrade(); await create(f, { kind: "map_feature", featureKind: "reference_line", geometryType: "LineString" });
  await append(f, point(1), () => true); await append(f, point(2, 40.01), () => true);
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.execute({ type: "apply_survey_collection", collectionId: "survey", expectedCollectionRevision: 2, expectedDesignRevision: 0, applicationId: "apply", targetId: "reference" }), /recorded and pending.*digitized/i);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  const reopened = parseSurveyCollectionDocument((await f.api.readAsync()).surveyCollections![0].document);
  assert.equal(reopened.state, "pending"); assert.equal(reopened.observations.length, 2); assert.deepEqual(reopened.applications, []);
});

test("complete JSON/ZIP bundle preserves exact documents and all collection states; old and corrupt readers refuse", async () => {
  const f = await fixture(); await f.upgrade(); await create(f); await append(f, point(1), () => true);
  await create(f, { kind: "map_feature", featureKind: "reference_line", geometryType: "LineString" }, "line");
  await f.execute({ type: "archive_survey_collection", collectionId: "line", expectedCollectionRevision: 0, expectedDesignRevision: 0, archived: true });
  await create(f, { kind: "field_boundary" }, "cleared");
  await f.execute({ type: "set_survey_membership", collectionId: "cleared", expectedCollectionRevision: 0, expectedDesignRevision: 0, activePointIds: [], state: "cleared" });
  await create(f, { kind: "field_boundary" }, "applied");
  for (const observed of [point(2), point(3, 40.01), point(4, 40, -105.01)]) {
    const current = parseSurveyCollectionDocument(f.current().surveyCollections!.find(item => item.id === "applied")!.document);
    await f.execute({ type: "append_survey_capture", collectionId: "applied", expectedCollectionRevision: current.revision, expectedDesignRevision: 0, point: observed }, () => true);
  }
  await f.execute({ type: "apply_survey_collection", collectionId: "applied", expectedCollectionRevision: 3, expectedDesignRevision: 0, applicationId: "application" });
  const bundle = buildDesignWorkspaceBundle(f.current(), "design"), zip = exportDesignWorkspaceBundleZip(bundle);
  assert.deepEqual(importDesignWorkspaceBundleZip(zip), bundle);
  assert.equal(serializeDesignWorkspaceBundle(parseDesignWorkspaceBundle(serializeDesignWorkspaceBundle(bundle))), serializeDesignWorkspaceBundle(bundle));
  assert.equal(bundle.designDocument, f.current().draftDocuments[0].document);
  assert.equal(bundle.surveyDocuments.length, 4);
  assert.deepEqual(bundle.surveyDocuments.map(document => parseSurveyCollectionDocument(document).state).sort(), ["applied", "archived", "cleared", "pending"]);
  assert.throws(() => importDesignDraftArchiveZip(zip));
  assert.throws(() => parseDesignWorkspaceBundle({ ...bundle, surveyDocuments: bundle.surveyDocuments.slice(0, 1) }), /inventory/i);
  assert.throws(() => parseDesignWorkspaceBundle({ ...bundle, fieldMapId: "foreign" }), /foreign/i);
  const partial = zipSync({ "bundle.json": strToU8(serializeDesignWorkspaceBundle(bundle)), "design.json": strToU8(bundle.designDocument) });
  assert.throws(() => importDesignWorkspaceBundleZip(partial), /missing|complete/i);
});

test("ordinary accepted saves preserve Survey history and refuse stripping existing record evidence", async () => {
  const f = await fixture(); await f.upgrade(); await create(f, { kind: "point", role: "control" }); await append(f, point(1), () => true);
  const saved = f.current().surveyCollections![0].document;
  const source = readSurveyDesignDocument("draft", f.current().draftDocuments[0].document);
  source.name = "Accepted ordinary save";
  await f.execute({ type: "save_design_draft", designId: "design", expectedDesignRevision: 1, draft: source });
  assert.equal(f.current().surveyCollections![0].document, saved);
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  delete source.surveyPoints[0].captureEvidence;
  await assert.rejects(f.execute({ type: "save_design_draft", designId: "design", expectedDesignRevision: 2, draft: source }), /capture evidence|invalid/i);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
});

test("completion preserves source Draft and remaps every associated Survey into the actual new Project", async () => {
  const f = await fixture(); await f.upgrade(); await create(f); await append(f, point(1), () => true);
  const draft = { ...structuredClone(sampleProject), id: "draft", name: "Completed synthetic source", settings: sampleProject.settings ?? { ...defaultProjectSettings(), unitSystem: sampleProject.unitSystem } };
  const sourceCollection = f.current().surveyCollections![0].document;
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  const command = { type: "create_complete_design_from_draft", sourceDesignId: "design", expectedDesignRevision: 0, draft, designId: "complete", projectId: "complete-payload", name: "Completed" };
  await assert.rejects(f.execute({ ...command, surveyCollectionIds: [] }), /map every/i);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  await f.execute({ ...command, surveyCollectionIds: [{ sourceId: "survey", id: "complete-survey", expectedRevision: 1 }] });
  assert.equal(f.current().surveyCollections![0].document, sourceCollection);
  const copy = parseSurveyCollectionDocument(f.current().surveyCollections![1].document);
  assert.equal(copy.owner.documentKind, "project"); assert.equal(copy.owner.payloadId, "complete-payload"); assert.deepEqual(copy.observations, [point(1)]);
  assert.equal(f.current().draftDocuments[0].id, "draft"); assert.equal(f.current().projectDocuments[0].summary.id, "complete-payload");
});

test("Survey operations in v4 retain exact Layout target bytes/hash and existing field deletion refusal", async () => {
  const f = await fixture();
  const field = convertPivotProjectToFieldDesign(serializeProjectDocument(sampleProject), { fieldId: "target-field", waterSourceId: "water", powerSourceId: "power" }).field;
  const target = `\n${serializeFieldLayoutTarget(createFieldLayoutTarget(field, { inputRevision: 0, expectedRevision: 0, selectedMachineIds: [field.machines[0].id] }))}\n`;
  await f.execute({ type: "create_layout_session", sessionId: "layout", fieldMapId: "map", name: "Layout", targetDocument: target });
  const frozen = f.current().layoutSessions![0].document;
  await f.upgrade(); await create(f); await append(f, point(1), () => true);
  assert.equal(f.current().layoutSessions![0].document, frozen);
  await f.execute({ type: "rename_layout_session", sessionId: "layout", expectedSessionRevision: 0, name: "Renamed" });
  const session = JSON.parse(f.current().layoutSessions![0].document);
  assert.equal(session.targetDocument, target); assert.equal(session.targetHash, JSON.parse(frozen).targetHash);
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.execute({ type: "delete_project", projectId: "project" }), /retained Layout/i);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
});

test("copy/import require complete fresh mappings, retain observed IDs/evidence, and reject partial duplicates atomically", async () => {
  const f = await fixture(); await f.upgrade(); await create(f); await append(f, point(1), () => true);
  const bundle = buildDesignWorkspaceBundle(f.current(), "design");
  const command = { type: "copy_design_with_survey", sourceDesignId: "design", expectedDesignRevision: 0, designId: "copy", payloadId: "copied-draft", fieldMapId: "map", name: "Copied", collectionIds: [{ sourceId: "survey", id: "copied-survey", expectedRevision: 1 }] };
  await f.execute(command);
  const copied = parseSurveyCollectionDocument(f.current().surveyCollections![1].document);
  assert.equal(copied.owner.designId, "copy"); assert.equal(copied.owner.payloadId, "copied-draft"); assert.deepEqual(copied.observations, [point(1)]);
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.execute({ ...command, designId: "bad-copy", payloadId: "bad-payload", collectionIds: [] }), /map every/i);
  await assert.rejects(f.execute({ type: "import_design_workspace_bundle", bundle, designId: "imported", payloadId: "imported-payload", fieldMapId: "map", collectionIds: [{ sourceId: "survey", id: "copied-survey", expectedRevision: 1 }] }), /already used/i);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  await f.execute({ type: "import_design_workspace_bundle", bundle, designId: "imported", payloadId: "imported-payload", fieldMapId: "map", collectionIds: [{ sourceId: "survey", id: "imported-survey", expectedRevision: 1 }] });
  assert.deepEqual(parseSurveyCollectionDocument(f.current().surveyCollections![2].document).observations, [point(1)]);
});

test("legacy deletion refuses attached Survey; explicit archival deletion retains exact source and ledger", async () => {
  const f = await fixture(); await f.upgrade(); await create(f); await append(f, point(1), () => true);
  const source = f.current().draftDocuments[0].document;
  await assert.rejects(f.execute({ type: "delete_design", designId: "design", expectedDesignRevision: 0 }), /Archive/i);
  await f.execute({ type: "archive_and_delete_design", designId: "design", expectedDesignRevision: 0, collectionIds: [{ id: "survey", expectedRevision: 1 }] });
  assert.equal(f.current().catalog.designs.length, 0);
  assert.equal(workspaceDesignSource(f.current(), "design").document, source);
  assert.deepEqual(parseSurveyCollectionDocument(f.current().surveyCollections![0].document).observations, [point(1)]);
  assert.equal(parseSurveyCollectionDocument(f.current().surveyCollections![0].document).state, "archived");
  assert.equal(buildDesignWorkspaceBundle(f.current(), "design").designDocument, source);
  assert.doesNotThrow(() => parseWorkspaceDocument(f.storage.getItem(WEB_WORKSPACE_KEY)!));
});

test("native Survey commands refuse before opening or writing a database", async () => {
  let touches = 0;
  const host = new Proxy({}, { get() { return () => { touches++; throw new Error("Unexpected database access"); }; } });
  const store = createSqliteWorkspaceStore(host as never);
  await assert.rejects(store.executeAsync(0, { type: "upgrade_workspace_to_v4", now }), /Native Survey workspace/i);
  assert.equal(touches, 0);
});
