import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import {
  convertPivotProjectToFieldDesign, createFieldLayoutTarget, createSurveyCollection, defaultProjectSettings,
  parseLayoutSessionDocument, parseSurveyCollectionDocument, sampleProject, serializeFieldLayoutTarget,
  projectLonLatToXy, readSurveyDesignDocument, serializeDesignDraftDocument, serializeFieldDesignDocument,
  serializeProjectDocument, type DesignDraft, type FieldDesign, type PivotProject, type SurveyPoint,
} from "@cplayout/core";
import { createVersionedProjectRepository, readWorkspaceDesign } from "../../../../packages/project-store/src/versionedProjectRepository";
import { validateWorkspaceDocument, type WorkspaceDocument } from "../../../../packages/project-store/src/workspaceDocument";
import type { WorkspaceCommand } from "../../../../packages/project-store/src/workspaceCommands";
import { editableFromSavedDesign, reduceWorkspaceEditable, serializeWorkspaceEditable, workspaceEditableIsDirty } from "./workspaceDocumentAdapters";
import {
  WORKSPACE_EDIT_RECOVERY_VERSION, WORKSPACE_EDIT_RECOVERY_V1_VERSION,
  captureWorkspaceRecoveryEditable, emptyWorkspaceEditRecoveryUi, parseWorkspaceEditRecovery,
  resolveWorkspaceEditRecovery, serializeWorkspaceEditRecovery, workspaceRecoveryStableJson,
  type WorkspaceEditRecoveryCandidateV1, type WorkspaceEditRecoveryCandidateV2,
  type WorkspaceEditRecoveryUiV1, type WorkspaceRecoveryCatalogFormKind,
} from "./workspaceEditRecovery";
import {
  createWorkspaceEditRecoveryStore, WORKSPACE_EDIT_RECOVERY_KEY, WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION,
  WORKSPACE_EDIT_RECOVERY_LOCK, type WorkspaceEditRecoveryExclusiveLock,
} from "./workspaceEditRecoveryStore";

const now = "2026-10-11T12:00:00.000Z";
type Mutable<T> = T extends readonly (infer V)[] ? Mutable<V>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function clone<T>(value: T): Mutable<T> { return structuredClone(value) as Mutable<T>; }
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const frozenReaderPath = fileURLToPath(new URL("../../../../tests/fixtures/workspace-edit-recovery-v1-reader.cjs", import.meta.url));
const frozenReaderHash = "071d363bd871cdde8d8536660b7e603c641dd9073b22097cc8eed634b87b16af";
type FrozenReader = {
  WORKSPACE_EDIT_RECOVERY_VERSION: typeof WORKSPACE_EDIT_RECOVERY_V1_VERSION;
  parseWorkspaceEditRecovery(raw: unknown): WorkspaceEditRecoveryCandidateV1;
  serializeWorkspaceEditRecovery(candidate: WorkspaceEditRecoveryCandidateV1): string;
  emptyWorkspaceEditRecoveryUi(): WorkspaceEditRecoveryUiV1;
};
function loadFrozenReader(): FrozenReader {
  const require = createRequire(import.meta.url), jsoncRequire = createRequire(require.resolve("jsonc-parser"));
  const loader = Module as unknown as { _load(name: string, parent: { filename?: string } | null, isMain: boolean): unknown };
  const original = loader._load;
  // The frozen bundle retains jsonc-parser's UMD factory, whose four relative
  // dependency requests otherwise resolve relative to the relocated fixture.
  // Resolve only those requests from the installed original dependency. No
  // recovery reader byte, parser function, schema or behavior is substituted.
  const jsoncDependencies = new Set(["./impl/format", "./impl/edit", "./impl/scanner", "./impl/parser"]);
  loader._load = (name, parent, isMain) => parent?.filename === frozenReaderPath && jsoncDependencies.has(name)
    ? jsoncRequire(name) : original.call(Module, name, parent, isMain);
  try { return require(frozenReaderPath) as FrozenReader; } finally { loader._load = original; }
}
const oldReader = loadFrozenReader();
function empty(writerId = "management-writer"): Mutable<WorkspaceEditRecoveryCandidateV2> {
  return clone({ recoveryVersion: WORKSPACE_EDIT_RECOVERY_VERSION, writerId, sequence: 1, capturedAt: now,
    context: { version: 2, catalogVisible: true, catalogSelection: { clientId: null, projectId: null, fieldMapId: null, designId: null },
      workspace: { mode: "design", design: null, layout: null, collectionId: null } }, workspaceRevision: 0,
    editable: null, collections: [], layout: null, controller: { historyPast: [], historyFuture: [], selectedAddress: null },
    inputs: { entries: [], focus: null }, ui: emptyWorkspaceEditRecoveryUi(), cameras: [] } satisfies WorkspaceEditRecoveryCandidateV2);
}
function v1(candidate: WorkspaceEditRecoveryCandidateV2): WorkspaceEditRecoveryCandidateV1 {
  const legacy = parseWorkspaceEditRecovery({ ...candidate, recoveryVersion: WORKSPACE_EDIT_RECOVERY_V1_VERSION });
  assert.equal(legacy.recoveryVersion, WORKSPACE_EDIT_RECOVERY_V1_VERSION);
  if (legacy.recoveryVersion !== WORKSPACE_EDIT_RECOVERY_V1_VERSION) assert.fail("Legacy capture was migrated.");
  return legacy;
}
function form(candidate: WorkspaceEditRecoveryCandidateV2, kind: WorkspaceRecoveryCatalogFormKind) {
  return { kind, context: { ...candidate.context.catalogSelection }, baselineFingerprint: "[null,null,null]",
    defaultName: "Existing  name", name: " \n unfinished name € 🧭  ", fieldName: " \r\n invalid field  ", client: null,
    detailsOpen: true, errors: [{ field: "name", message: "Exact name error  \n" }],
    error: "Exact prior error", fieldError: "Exact prior field error", saveError: "Exact earlier save error  " };
}
function formatted(raw: string): string { return ` \r\n${JSON.stringify(JSON.parse(raw), null, 2).replace(/\n/g, "\r\n")}\r\n `; }
function operationalPoint(): SurveyPoint {
  // Historical synthetic receipt data tests preservation, never a live receiver
  // event or evidence of physical accuracy or field qualification.
  const payload = "GNGGA,120001.00,4000.0000,N,10500.0000,W,4,12,0.8,1600.0,M,-20.0,M,1.0,42";
  const checksum = [...payload].reduce((value, character) => value ^ character.charCodeAt(0), 0).toString(16).padStart(2, "0");
  return { id: "saved-operational-point", label: "Exact historical evidence  ", role: "control", projected: projectLonLatToXy({ latitude: 40, longitude: -105 }, "EPSG:32613"),
    wgs84: { latitude: 40, longitude: -105 }, observedAt: now, source: "external_gnss", confidence: "rtk_fixed", captureEvidence: {
      schemaVersion: "gnss-operational-fixed-v1", observationId: "historical-receiver:1", sessionId: "historical-receiver", transport: "local_udp",
      receivedAt: now, receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true, antennaReference: "unknown", sentenceTypes: ["GGA"],
      gga: { sentence: `$${payload}*${checksum}`, sentenceIdentifier: "GNGGA", utcTime: "120001.00", qualityCode: 4, latitude: 40, longitude: -105 },
      receipt: { sequence: 1, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 500, provenance: "loopback_companion" },
      capture: { evaluatedMonotonicMs: 1500, ageMs: 1000, maxAgeMs: 2000 },
      projection: { id: "wgs84-projection-v1:EPSG:32613", projectCrs: "EPSG:32613" }, physicalQualification: "unverified" } };
}
function write(kind: "draft" | "project" | "field", payload: DesignDraft | PivotProject | FieldDesign): string {
  return kind === "draft" ? serializeDesignDraftDocument(payload as DesignDraft) : kind === "field" ? serializeFieldDesignDocument(payload as FieldDesign) : serializeProjectDocument(payload as PivotProject);
}

async function fixture(kind: "draft" | "project" | "field" = "draft") {
  const values = new Map<string, string>();
  const api = createVersionedProjectRepository({ getStorage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, raw) => { values.set(key, raw); } }),
    getLocks: () => ({ request: async (_name, _options, action) => action() }) }).versionedWorkspace!;
  let workspace = await api.readAsync();
  async function execute(command: object) { workspace = (await api.executeAsync(workspace.revision, { now, ...command } as WorkspaceCommand, () => true)).workspace; }
  for (const id of ["client", "other-client"]) await execute({ type: "create_client", id, input: { companyName: id, primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } });
  for (const [clientId, projectId, fieldMapId] of [["client", "project", "field"], ["other-client", "other-project", "other-field"]])
    await execute({ type: "create_project_with_initial_field_map", input: { clientId, projectId, fieldMapId, projectName: projectId, fieldMapName: fieldMapId, projectCrs: "EPSG:32613", unitSystem: "metric" } });
  await execute({ type: "upgrade_workspace_to_v3" });
  const original = formatted(serializeProjectDocument(sampleProject));
  const field = convertPivotProjectToFieldDesign(original, { fieldId: "payload", waterSourceId: "water", powerSourceId: "power" }).field;
  const draft: DesignDraft = { id: "payload", name: "Saved draft", projectCrs: "EPSG:32613", unitSystem: "metric", settings: { ...defaultProjectSettings(), unitSystem: "metric" },
    fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
  if (kind === "draft") await execute({ type: "create_design_draft", designId: "design", fieldMapId: "field", name: draft.name, draft });
  else if (kind === "project") await execute({ type: "import_design_document", designId: "design", payloadId: "payload", fieldMapId: "field", document: serializeProjectDocument(sampleProject) });
  else await execute({ type: "create_field_design", designId: "design", fieldMapId: "field", name: field.name, field, originalProjectDocument: original });
  await execute({ type: "create_design_draft", designId: "other-design", fieldMapId: "other-field", name: "Other", draft: { ...draft, id: "other-payload" } });
  await execute({ type: "create_layout_session", sessionId: "layout", fieldMapId: "field", name: "Exact saved Layout",
    targetDocument: serializeFieldLayoutTarget(createFieldLayoutTarget(field, { inputRevision: 0, expectedRevision: 0, selectedMachineIds: [field.machines[0].id] })) });
  await execute({ type: "upgrade_workspace_to_v4" });
  const first = readWorkspaceDesign(workspace, "design"); if (first.kind === "not_found") assert.fail("Missing managed fixture.");
  const identity = editableFromSavedDesign(first).identity;
  await execute({ type: "create_survey_collection", expectedDesignRevision: first.design.revision,
    collection: createSurveyCollection({ id: "survey", now, purpose: { kind: "point", role: "control" },
      owner: { designId: "design", documentKind: kind, payloadId: identity.payloadId, fieldMapId: "field", projectCrs: "EPSG:32613" } }) });
  await execute({ type: "append_survey_capture", collectionId: "survey", expectedCollectionRevision: 0, expectedDesignRevision: first.design.revision, point: operationalPoint() });
  // These exact strings represent acknowledged durable source bytes, including
  // pretty formatting and CRLF, rather than a reserialized controller payload.
  for (const entry of [...workspace.projectDocuments, ...workspace.draftDocuments, ...(workspace.fieldDocuments ?? []),
    ...(workspace.surveyCollections ?? []), ...(workspace.layoutSessions ?? [])]) entry.document = formatted(entry.document);
  workspace = validateWorkspaceDocument(workspace);
  function candidate() {
    const read = readWorkspaceDesign(workspace, "design"); if (read.kind === "not_found") assert.fail("Missing managed fixture.");
    const recovery = empty(), editable = editableFromSavedDesign(read), held = captureWorkspaceRecoveryEditable(editable);
    recovery.workspaceRevision = workspace.revision; recovery.editable = clone(held);
    recovery.context.catalogVisible = false; recovery.context.catalogSelection = { ...read.context };
    recovery.context.workspace.design = { designId: "design", documentKind: kind, payloadId: editable.identity.payloadId, fieldMapId: "field", projectCrs: editable.identity.projectCrs };
    const entry = workspace.surveyCollections!.find(item => item.id === "survey")!, collection = parseSurveyCollectionDocument(entry.document);
    recovery.collections = [{ id: collection.id, revision: collection.revision, document: entry.document }]; recovery.context.workspace.collectionId = collection.id;
    const layoutEntry = workspace.layoutSessions!.find(item => item.id === "layout")!, session = parseLayoutSessionDocument(layoutEntry.document);
    recovery.layout = { id: session.id, revision: session.revision, persistenceRevision: workspace.revision, document: layoutEntry.document,
      fieldMapId: session.fieldMapId, targetHash: session.targetHash, targetDocument: session.targetDocument };
    recovery.context.workspace.layout = { sessionId: session.id, fieldMapId: session.fieldMapId, targetHash: session.targetHash, projectCrs: "EPSG:32613" };
    recovery.editable.workingDocument = formatted(held.workingDocument);
    recovery.editable.editor.past = [held.sourceDocument]; recovery.editable.editor.future = [formatted(held.sourceDocument)];
    assert.notEqual(collection.state, "archived"); if (collection.state === "archived") assert.fail("Fixture collection is archived.");
    const membership = { collectionId: collection.id, activePointIds: [...collection.activePointIds], state: collection.state };
    recovery.controller.historyPast = [{ document: held.sourceDocument, memberships: [membership] }];
    recovery.controller.historyFuture = [{ document: formatted(held.sourceDocument), memberships: [membership] }];
    recovery.inputs = { entries: [{ key: "raw/design-name", baselineFingerprint: '"Saved"', cleanFingerprint: '"Saved"', value: " \n unfinished € 🧭  " }],
      focus: { key: "raw/design-name/focus/text", selection: { start: 1, end: 5 } } };
    recovery.ui.file = { dialog: "preferences", text: "{\r\n unfinished preferences  ", baseline: "exact baseline", savedCopyId: null };
    recovery.ui.receiver = { method: "network", protocol: "udp", baudRate: " 9bad ", address: " invalid address  ", port: "--1", sourceAddress: " 999.0.0.0 ", settingsOpen: true };
    recovery.cameras = [{ context: { kind: "field", fieldMapId: "field", projectCrs: "EPSG:32613" }, viewport: { center: { x: 500012.25, y: 4400034.5 }, baseWidthMeters: 1500, baseHeightMeters: 1000, zoomLevel: 2 }, initialized: true }];
    return recovery;
  }
  function renameCandidate(designId: string | null = null) {
    const recovery = empty("rename-writer"); recovery.workspaceRevision = workspace.revision;
    recovery.context.catalogSelection = { clientId: "client", projectId: "project", fieldMapId: "field", designId };
    recovery.ui.catalog.form = form(recovery, "rename_field_map");
    const client = workspace.catalog.clients.find(item => item.id === "client")!, project = workspace.catalog.projects.find(item => item.id === "project")!, savedField = workspace.catalog.fieldMaps.find(item => item.id === "field")!;
    recovery.ui.catalog.form.baselineFingerprint = JSON.stringify([client, project, savedField]); recovery.ui.catalog.form.defaultName = savedField.name;
    return recovery;
  }
  return { workspace, values, candidate, renameCandidate };
}

function recoveryStorage(raw: string) {
  const values = new Map([[WORKSPACE_EDIT_RECOVERY_KEY, raw], ["domain", "exact durable source"], ["context", "exact prior preference"]]);
  let locked = false; let writes = 0;
  const lock: WorkspaceEditRecoveryExclusiveLock = async (name, action) => {
    assert.equal(name, WORKSPACE_EDIT_RECOVERY_LOCK); assert.equal(locked, false); locked = true;
    try { return await action(); } finally { locked = false; }
  };
  const store = createWorkspaceEditRecoveryStore({ backend: "web", withExclusiveLock: lock, storage: {
    getItem(key) { assert.equal(locked, true); assert.equal(key, WORKSPACE_EDIT_RECOVERY_KEY); return values.get(key) ?? null; },
    setItem(key, next) { assert.equal(locked, true); assert.equal(key, WORKSPACE_EDIT_RECOVERY_KEY); writes++; values.set(key, next); },
  } });
  return { store, values, writes: () => writes };
}

test("frozen actual v1 reader remains byte-identical and new default/version union does not migrate v1", () => {
  assert.equal(createHash("sha256").update(readFileSync(frozenReaderPath)).digest("hex"), frozenReaderHash);
  const manifest = JSON.parse(readFileSync(new URL("../../../../tests/fixtures/workspace-edit-recovery-v1-reader.json", import.meta.url), "utf8"));
  assert.equal(manifest.outputSha256, frozenReaderHash); assert.equal(manifest.moduleVersion, WORKSPACE_EDIT_RECOVERY_V1_VERSION);
  assert.equal(oldReader.WORKSPACE_EDIT_RECOVERY_VERSION, "cplayout-unified-edit-recovery-v1");
  assert.equal(WORKSPACE_EDIT_RECOVERY_VERSION, "cplayout-unified-edit-recovery-v2");
  assert.deepEqual(emptyWorkspaceEditRecoveryUi(), oldReader.emptyWorkspaceEditRecoveryUi());
  const input = empty(), current = parseWorkspaceEditRecovery(input), legacy = v1(input);
  assert.equal(current.recoveryVersion, WORKSPACE_EDIT_RECOVERY_VERSION); assert.equal(legacy.recoveryVersion, WORKSPACE_EDIT_RECOVERY_V1_VERSION);
  assert.equal(parseWorkspaceEditRecovery(serializeWorkspaceEditRecovery(legacy)).recoveryVersion, WORKSPACE_EDIT_RECOVERY_V1_VERSION);
  assert.equal(serializeWorkspaceEditRecovery(legacy), oldReader.serializeWorkspaceEditRecovery(legacy));
});

test("v1 original strict six form kinds and all previous value/unknown-key gates match the actual old reader", () => {
  for (const kind of ["client", "project", "fieldMap", "design", "edit_client", "rename_project"] as const) {
    const input = empty(); input.ui.catalog.form = form(input, kind);
    const legacy = v1(input), raw = formatted(serializeWorkspaceEditRecovery(legacy));
    assert.deepEqual(parseWorkspaceEditRecovery(raw), oldReader.parseWorkspaceEditRecovery(raw));
    assert.equal(serializeWorkspaceEditRecovery(parseWorkspaceEditRecovery(raw)), oldReader.serializeWorkspaceEditRecovery(oldReader.parseWorkspaceEditRecovery(raw)));
    assert.equal(parseWorkspaceEditRecovery(raw).ui.catalog.form!.kind, kind);
  }
  const renamed = empty(); renamed.ui.catalog.form = form(renamed, "rename_field_map");
  assert.equal(parseWorkspaceEditRecovery(renamed).ui.catalog.form!.kind, "rename_field_map");
  const forbiddenV1 = { ...renamed, recoveryVersion: WORKSPACE_EDIT_RECOVERY_V1_VERSION };
  assert.throws(() => parseWorkspaceEditRecovery(forbiddenV1), /Unsupported recovery choice/); assert.throws(() => oldReader.parseWorkspaceEditRecovery(forbiddenV1), /Unsupported recovery choice/);
  const original = clone(v1(empty()));
  for (const mutate of [
    (value: Mutable<WorkspaceEditRecoveryCandidateV1>) => { (value.ui as unknown as Record<string, unknown>).extra = "unknown"; },
    (value: Mutable<WorkspaceEditRecoveryCandidateV1>) => { value.ui.receiver.method = "automatic" as "usb"; },
    (value: Mutable<WorkspaceEditRecoveryCandidateV1>) => { value.sequence = 0; },
    (value: Mutable<WorkspaceEditRecoveryCandidateV1>) => { value.capturedAt = "not-a-date"; },
    (value: Mutable<WorkspaceEditRecoveryCandidateV1>) => { value.inputs.entries = [{ key: "value", baselineFingerprint: "null", cleanFingerprint: "null", value: Infinity }]; },
  ]) { const changed = clone(original); mutate(changed); assert.throws(() => parseWorkspaceEditRecovery(changed)); assert.throws(() => oldReader.parseWorkspaceEditRecovery(changed)); }
});

test("legacy all-owner anchors, editor/controller histories, CRLF sources and raw values roundtrip without v1 promotion", async () => {
  for (const kind of ["draft", "project", "field"] as const) {
    const f = await fixture(kind), candidate = f.candidate(), legacy = v1(candidate), raw = formatted(serializeWorkspaceEditRecovery(legacy));
    const before = JSON.stringify(candidate), workspaceBefore = JSON.stringify(f.workspace);
    const parsed = parseWorkspaceEditRecovery(raw), oldParsed = oldReader.parseWorkspaceEditRecovery(raw), serialized = serializeWorkspaceEditRecovery(parsed);
    assert.deepEqual(parsed, oldParsed); assert.equal(serialized, oldReader.serializeWorkspaceEditRecovery(oldParsed));
    assert.equal(parsed.editable!.sourceDocument, candidate.editable!.sourceDocument); assert.match(parsed.editable!.sourceDocument, /\r\n/);
    assert.equal(parsed.editable!.originalProjectDocument, candidate.editable!.originalProjectDocument);
    assert.equal(parsed.editable!.workingDocument, candidate.editable!.workingDocument); assert.deepEqual(parsed.editable!.editor, candidate.editable!.editor);
    assert.deepEqual(parsed.collections, candidate.collections); assert.deepEqual(parsed.layout, candidate.layout); assert.deepEqual(parsed.controller, candidate.controller);
    assert.deepEqual(parsed.inputs, candidate.inputs); assert.deepEqual(parsed.ui, candidate.ui); assert.deepEqual(parsed.cameras, candidate.cameras);
    const resolved = resolveWorkspaceEditRecovery(parsed, freeze(f.workspace)); assert.equal(resolved.kind, "ready");
    if (!("admission" in resolved)) assert.fail("Legacy sources were not admitted.");
    assert.equal(resolved.admission.candidate.recoveryVersion, WORKSPACE_EDIT_RECOVERY_V1_VERSION);
    assert.equal(serializeWorkspaceEditRecovery(resolved.admission.candidate), serialized);
    assert.equal(JSON.stringify(candidate), before); assert.equal(JSON.stringify(f.workspace), workspaceBefore);
  }
});

test("actual old reader refuses every v2 envelope before consumer mutation, including v2 with no new form", () => {
  for (const kind of [null, "fieldMap", "rename_field_map"] as const) {
    const input = empty(); if (kind !== null) input.ui.catalog.form = form(input, kind);
    const raw = serializeWorkspaceEditRecovery(input); let mutations = 0;
    assert.throws(() => { oldReader.parseWorkspaceEditRecovery(raw); mutations++; }, /Unsupported edit recovery version/);
    assert.equal(mutations, 0); assert.equal(parseWorkspaceEditRecovery(raw).recoveryVersion, WORKSPACE_EDIT_RECOVERY_VERSION);
  }
  for (const recoveryVersion of ["cplayout-unified-edit-recovery-v0", "cplayout-unified-edit-recovery-v3", "cplayout-unified-edit-recovery-v2 "])
    assert.throws(() => parseWorkspaceEditRecovery({ ...empty(), recoveryVersion }), /Unsupported edit recovery version/);
});

test("mixed v1/v2 ledger reads and exports preserve exact raw slots and keys with no silent rewriting", async () => {
  const oldCandidate = v1(empty("legacy-writer")), newCandidate = empty("current-writer");
  newCandidate.ui.catalog.form = form(newCandidate, "rename_field_map");
  const oldRaw = formatted(oldReader.serializeWorkspaceEditRecovery(oldCandidate)), newRaw = serializeWorkspaceEditRecovery(newCandidate);
  const originalLedger = formatted(JSON.stringify({ ledgerVersion: WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION,
    slots: [{ writerId: oldCandidate.writerId, sequence: 1, raw: oldRaw }, { writerId: newCandidate.writerId, sequence: 1, raw: newRaw }] }));
  const f = recoveryStorage(originalLedger), before = new Map(f.values), slots = await f.store.readCandidates();
  assert.equal(WORKSPACE_EDIT_RECOVERY_KEY, "cplayout-unified-edit-recovery-v1"); assert.equal(WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION, "cplayout-unified-edit-recovery-ledger-v1");
  assert.deepEqual(slots.map(slot => slot.candidate.recoveryVersion), [WORKSPACE_EDIT_RECOVERY_V1_VERSION, WORKSPACE_EDIT_RECOVERY_VERSION]);
  assert.equal(slots[0].raw, oldRaw); assert.equal(slots[1].raw, newRaw);
  assert.equal(await f.store.exportCandidate("legacy-writer"), oldRaw); assert.equal(await f.store.exportCandidate("current-writer"), newRaw);
  assert.equal(await f.store.exportRawLedger(), originalLedger); assert.equal(f.writes(), 0); assert.deepEqual(f.values, before);
  await f.store.checkpoint(empty("another-current-writer"), null, () => true);
  const next = JSON.parse(f.values.get(WORKSPACE_EDIT_RECOVERY_KEY)!);
  assert.equal(next.slots[0].raw, oldRaw); assert.equal(next.slots[1].raw, newRaw); assert.equal(next.slots[2].writerId, "another-current-writer");
  assert.equal((await f.store.readCandidates())[0].candidate.recoveryVersion, WORKSPACE_EDIT_RECOVERY_V1_VERSION);
  const explicitLegacyUpdate = { ...oldCandidate, sequence: 2 };
  const acknowledged = await f.store.checkpoint(explicitLegacyUpdate, 1, () => true);
  assert.equal(acknowledged.candidate.recoveryVersion, WORKSPACE_EDIT_RECOVERY_V1_VERSION);
  assert.equal(acknowledged.raw, oldReader.serializeWorkspaceEditRecovery(explicitLegacyUpdate));
  assert.equal(f.values.get("domain"), "exact durable source"); assert.equal(f.values.get("context"), "exact prior preference");
});

test("opaque mixed-ledger export remains exact even when the old reader refuses its v2 candidate", async () => {
  const candidate = empty(), raw = serializeWorkspaceEditRecovery(candidate);
  const ledgerRaw = formatted(JSON.stringify({ ledgerVersion: WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION, slots: [{ writerId: candidate.writerId, sequence: 1, raw }] }));
  assert.throws(() => oldReader.parseWorkspaceEditRecovery(raw), /Unsupported edit recovery version/);
  const f = recoveryStorage(ledgerRaw); assert.equal(await f.store.exportRawLedger(), ledgerRaw); assert.equal(f.writes(), 0);
  const futureRaw = ledgerRaw.replace(/cplayout-unified-edit-recovery-v2/g, "cplayout-unified-edit-recovery-v3"), future = recoveryStorage(futureRaw);
  await assert.rejects(future.store.readCandidates()); assert.equal(await future.store.exportRawLedger(), futureRaw); assert.equal(future.writes(), 0);
});

test("v2 field rename parks exact raw form against actual ancestry/baseline without editor creation or mutation", async () => {
  const f = await fixture(), sourceBefore = JSON.stringify(f.workspace), valuesBefore = new Map(f.values);
  for (const designId of [null, "design"]) {
    const candidate = f.renameCandidate(designId), before = JSON.stringify(candidate), raw = serializeWorkspaceEditRecovery(candidate);
    const parsed = parseWorkspaceEditRecovery(raw), result = resolveWorkspaceEditRecovery(parsed, freeze(f.workspace));
    assert.equal(result.kind, "ready"); if (!("admission" in result)) assert.fail("Actual rename ancestry was refused.");
    assert.equal(result.admission.editable, null); assert.equal(result.admission.layout, null); assert.deepEqual(result.admission.collections, []);
    assert.equal(result.admission.requiresCatalogReview, true); assert.deepEqual(result.admission.ui.catalog.form, candidate.ui.catalog.form);
    assert.equal(result.admission.ui.catalog.form!.kind, "rename_field_map"); assert.equal(result.admission.ui.catalog.form!.name, " \n unfinished name € 🧭  ");
    assert.equal(result.admission.candidate.context.catalogSelection.designId, designId);
    assert.equal(serializeWorkspaceEditRecovery(result.admission.candidate), raw); assert.equal(JSON.stringify(candidate), before);
    assert.notStrictEqual(result.admission.ui.catalog.form, candidate.ui.catalog.form); assert.ok(Object.isFrozen(result.admission.ui.catalog.form));
  }
  assert.equal(JSON.stringify(f.workspace), sourceBefore); assert.deepEqual(f.values, valuesBefore);
});

test("field rename refuses missing/wrong client-project-field ancestry and optional foreign/invented design pointers", async () => {
  const f = await fixture(), sourceBefore = JSON.stringify(f.workspace);
  const mutations = [
    (candidate: Mutable<WorkspaceEditRecoveryCandidateV2>) => { candidate.ui.catalog.form!.context = { clientId: null, projectId: null, fieldMapId: null, designId: null }; },
    (candidate: Mutable<WorkspaceEditRecoveryCandidateV2>) => { candidate.ui.catalog.form!.context = { clientId: "client", projectId: null, fieldMapId: null, designId: null }; },
    (candidate: Mutable<WorkspaceEditRecoveryCandidateV2>) => { candidate.ui.catalog.form!.context = { clientId: "client", projectId: "project", fieldMapId: null, designId: null }; },
    (candidate: Mutable<WorkspaceEditRecoveryCandidateV2>) => { candidate.ui.catalog.form!.context.clientId = "other-client"; },
    (candidate: Mutable<WorkspaceEditRecoveryCandidateV2>) => { candidate.ui.catalog.form!.context.projectId = "other-project"; },
    (candidate: Mutable<WorkspaceEditRecoveryCandidateV2>) => { candidate.ui.catalog.form!.context.fieldMapId = "other-field"; },
    (candidate: Mutable<WorkspaceEditRecoveryCandidateV2>) => { candidate.ui.catalog.form!.context.fieldMapId = "invented-field"; },
    (candidate: Mutable<WorkspaceEditRecoveryCandidateV2>) => { candidate.ui.catalog.form!.context.designId = "other-design"; },
    (candidate: Mutable<WorkspaceEditRecoveryCandidateV2>) => { candidate.ui.catalog.form!.context.designId = "invented-design"; },
  ];
  for (const mutate of mutations) {
    const candidate = f.renameCandidate(); mutate(candidate); const raw = serializeWorkspaceEditRecovery(candidate), result = resolveWorkspaceEditRecovery(candidate, f.workspace);
    assert.equal(result.kind, "source_conflict"); if (result.kind === "source_conflict") assert.match(result.reason, /ancestry/);
    assert.equal(serializeWorkspaceEditRecovery(candidate), raw); assert.equal("admission" in result, false);
  }
  const moved = clone(f.workspace); moved.revision++; moved.catalog.projects.find(item => item.id === "project")!.clientId = "other-client";
  const result = resolveWorkspaceEditRecovery(f.renameCandidate(), validateWorkspaceDocument(moved)); assert.equal(result.kind, "source_conflict");
  assert.equal(JSON.stringify(f.workspace), sourceBefore);
});

test("rename field captured name changes refuse while its literal parent fingerprint stays inert review context", async () => {
  const f = await fixture(), candidate = f.renameCandidate("design"), raw = serializeWorkspaceEditRecovery(candidate);
  const renamed = clone(f.workspace); renamed.revision++; renamed.catalog.fieldMaps.find(item => item.id === "field")!.name = "Later saved field";
  const valid = validateWorkspaceDocument(renamed), before = JSON.stringify(valid), result = resolveWorkspaceEditRecovery(candidate, freeze(valid));
  assert.equal(result.kind, "source_conflict"); if (result.kind === "source_conflict") assert.match(result.reason, /saved field name changed/);
  assert.equal(serializeWorkspaceEditRecovery(candidate), raw); assert.equal(JSON.stringify(valid), before); assert.equal("admission" in result, false);
  const forged = clone(candidate); forged.ui.catalog.form!.defaultName = "Forged original name";
  assert.equal(resolveWorkspaceEditRecovery(forged, f.workspace).kind, "source_conflict");
  for (const fingerprint of [workspaceRecoveryStableJson(JSON.parse(candidate.ui.catalog.form!.baselineFingerprint)), ` ${candidate.ui.catalog.form!.baselineFingerprint}`, "exact prior invalid review fingerprint  \r\n"]) {
    const changed = clone(candidate); changed.ui.catalog.form!.baselineFingerprint = fingerprint;
    const changedRaw = serializeWorkspaceEditRecovery(changed), admission = resolveWorkspaceEditRecovery(changed, f.workspace);
    assert.equal(admission.kind, "ready"); if (!("admission" in admission)) assert.fail("Inert fingerprint discarded valid parked UI.");
    assert.equal(admission.admission.ui.catalog.form!.baselineFingerprint, fingerprint); assert.equal(admission.admission.requiresCatalogReview, true);
    assert.equal(serializeWorkspaceEditRecovery(admission.admission.candidate), changedRaw); assert.equal(serializeWorkspaceEditRecovery(changed), changedRaw);
  }
});

test("all three exact editors reconcile Customer notes and Project title drift while preserving every raw anchor, history and complete evidence", async () => {
  for (const kind of ["draft", "project", "field"] as const) {
    const f = await fixture(kind), read = readWorkspaceDesign(f.workspace, "design"); if (read.kind === "not_found") assert.fail("Missing fixture.");
    let active = editableFromSavedDesign(read);
    active = reduceWorkspaceEditable(active, { kind, action: { type: "rename", name: "Unfinished first name" } } as never);
    active = reduceWorkspaceEditable(active, { kind, action: { type: "rename", name: "Unfinished second name" } } as never);
    active = reduceWorkspaceEditable(active, { kind, action: { type: "undo" } } as never);
    const candidate = f.candidate(); candidate.editable = clone(captureWorkspaceRecoveryEditable(active));
    const collection = parseSurveyCollectionDocument(candidate.collections[0].document), evidence = collection.observations[0];
    assert.equal(evidence.captureEvidence?.schemaVersion, "gnss-operational-fixed-v1");
    const withEvidence = (document: string) => {
      const payload = readSurveyDesignDocument(kind, document);
      const existing = payload.surveyPoints.find(point => point.id === evidence.id);
      if (existing) assert.deepEqual(existing, evidence);
      return formatted(write(kind, existing ? payload : { ...payload, surveyPoints: [...payload.surveyPoints, clone(evidence)] }));
    };
    candidate.editable.workingDocument = withEvidence(candidate.editable.workingDocument);
    candidate.editable.editor.past = candidate.editable.editor.past.map(withEvidence);
    candidate.editable.editor.future = candidate.editable.editor.future.map(withEvidence);
    if (kind === "draft") candidate.editable.editor.lockedCrs = "EPSG:32613";
    candidate.controller.historyPast[0].document = candidate.editable.editor.past[0];
    candidate.controller.historyFuture[0].document = candidate.editable.editor.future[0];
    candidate.ui.catalog.form = clone(f.renameCandidate("design").ui.catalog.form);
    const raw = serializeWorkspaceEditRecovery(candidate), original = parseWorkspaceEditRecovery(raw), originalSource = JSON.stringify(f.workspace), durable = new Map(f.values);
    const baseline = resolveWorkspaceEditRecovery(original, f.workspace); assert.equal(baseline.kind, "ready");
    if (!("admission" in baseline)) assert.fail("Exact editor control was refused.");
    assert.equal(workspaceEditableIsDirty(baseline.admission.editable!), true);
    for (const field of ["customer_notes", "project_title"] as const) {
      const fresh = clone(f.workspace); fresh.revision++;
      if (field === "customer_notes") fresh.catalog.clients.find(item => item.id === "client")!.notes = "Customer notes changed independently  \n";
      else fresh.catalog.projects.find(item => item.id === "project")!.name = "Project title changed independently";
      const admittedWorkspace = validateWorkspaceDocument(fresh), freshBefore = JSON.stringify(admittedWorkspace);
      const result = resolveWorkspaceEditRecovery(freeze(original), freeze(admittedWorkspace));
      assert.equal(result.kind, "reconcile_required", `${kind}/${field}`); if (!("admission" in result)) assert.fail(`${kind}/${field} discarded exact editor.`);
      const admission = result.admission;
      assert.equal(serializeWorkspaceEditRecovery(admission.candidate), raw); assert.equal(serializeWorkspaceEditRecovery(original), raw);
      assert.deepEqual(admission.candidate.editable, original.editable); assert.deepEqual(admission.candidate.controller, original.controller);
      assert.deepEqual(admission.candidate.collections, original.collections); assert.deepEqual(admission.candidate.layout, original.layout);
      assert.deepEqual(admission.candidate.inputs, original.inputs); assert.deepEqual(admission.candidate.ui, original.ui); assert.deepEqual(admission.candidate.cameras, original.cameras);
      assert.equal(admission.editable!.sourceDocument, original.editable!.sourceDocument);
      assert.equal(serializeWorkspaceEditable(admission.editable!), serializeWorkspaceEditable(baseline.admission.editable!));
      assert.deepEqual(admission.editable!.editor, baseline.admission.editable!.editor); assert.deepEqual(admission.historyPast, baseline.admission.historyPast); assert.deepEqual(admission.historyFuture, baseline.admission.historyFuture);
      const hydrated = readSurveyDesignDocument(kind, serializeWorkspaceEditable(admission.editable!));
      assert.deepEqual(hydrated.surveyPoints.find(point => point.id === evidence.id), evidence);
      assert.deepEqual(admission.collections[0].observations[0], evidence);
      assert.equal(admission.layout!.session.targetDocument, original.layout!.targetDocument); assert.equal(admission.layout!.session.targetHash, original.layout!.targetHash);
      assert.equal(admission.staged.workspaceRevision, fresh.revision); assert.equal(admission.layout!.persistenceRevision, fresh.revision);
      const staged = clone(admission.staged); staged.workspaceRevision = original.workspaceRevision; staged.layout!.persistenceRevision = original.layout!.persistenceRevision;
      assert.deepEqual(staged, original); assert.equal(admission.requiresCatalogReview, true); assert.equal(workspaceEditableIsDirty(admission.editable!), true);
      assert.equal(admission.ui.catalog.form!.baselineFingerprint, original.ui.catalog.form!.baselineFingerprint);
      assert.equal(JSON.stringify(admittedWorkspace), freshBefore); assert.equal(JSON.stringify(f.workspace), originalSource); assert.deepEqual(f.values, durable);
    }
  }
});

test("field metadata timestamp-only drift reconciles without rebasing captured fingerprint", async () => {
  const f = await fixture(), candidate = f.renameCandidate("design"), raw = serializeWorkspaceEditRecovery(candidate), fresh = clone(f.workspace);
  fresh.revision++; fresh.catalog.fieldMaps.find(item => item.id === "field")!.updatedAt = "2026-10-11T13:00:00.000Z";
  const result = resolveWorkspaceEditRecovery(candidate, validateWorkspaceDocument(fresh)); assert.equal(result.kind, "reconcile_required");
  if (!("admission" in result)) assert.fail("Unchanged field name/ancestry was discarded for metadata-only drift.");
  assert.equal(result.admission.requiresCatalogReview, true); assert.equal(serializeWorkspaceEditRecovery(result.admission.candidate), raw);
});

test("every editor still refuses changed field name, moved destination and deleted optional-design destination", async () => {
  for (const kind of ["draft", "project", "field"] as const) {
    const f = await fixture(kind), candidate = f.candidate(); candidate.ui.catalog.form = clone(f.renameCandidate("design").ui.catalog.form);
    const raw = serializeWorkspaceEditRecovery(candidate);
    for (const change of ["name", "move", "delete"] as const) {
      const fresh = clone(f.workspace); fresh.revision++;
      if (change === "name") fresh.catalog.fieldMaps.find(item => item.id === "field")!.name = "Changed actual field name";
      else if (change === "move") fresh.catalog.projects.find(item => item.id === "project")!.clientId = "other-client";
      else {
        fresh.catalog.fieldMaps = fresh.catalog.fieldMaps.filter(item => item.id !== "field");
        fresh.catalog.designs = fresh.catalog.designs.filter(item => item.fieldMapId !== "field");
        fresh.projectDocuments = fresh.projectDocuments.filter(item => item.summary.id !== "payload");
        fresh.draftDocuments = fresh.draftDocuments.filter(item => item.id !== "payload");
        fresh.fieldDocuments = fresh.fieldDocuments!.filter(item => item.id !== "payload");
        fresh.layoutSessions = []; fresh.surveyCollections = [];
      }
      const result = resolveWorkspaceEditRecovery(candidate, validateWorkspaceDocument(fresh));
      assert.equal(result.kind, "source_conflict", `${kind}/${change}`); assert.equal("admission" in result, false);
      assert.equal(serializeWorkspaceEditRecovery(candidate), raw);
    }
  }
});

test("unrelated newer workspace receipt reconciles exact rename baseline; v1 fieldMap remains the original distinct creation form", async () => {
  const f = await fixture(), candidate = f.renameCandidate(), originalRaw = serializeWorkspaceEditRecovery(candidate), newer = clone(f.workspace);
  newer.revision++; newer.catalog.clients.find(item => item.id === "other-client")!.notes = "Unrelated newer metadata";
  const result = resolveWorkspaceEditRecovery(candidate, newer); assert.equal(result.kind, "reconcile_required");
  if (!("admission" in result)) assert.fail("Exact unchanged rename baseline did not reconcile.");
  assert.equal(result.admission.staged.workspaceRevision, newer.revision); assert.equal(result.admission.candidate.workspaceRevision, candidate.workspaceRevision);
  assert.deepEqual({ ...result.admission.staged, workspaceRevision: candidate.workspaceRevision }, result.admission.candidate);
  assert.equal(result.admission.ui.catalog.form!.baselineFingerprint, candidate.ui.catalog.form!.baselineFingerprint);
  assert.equal(serializeWorkspaceEditRecovery(result.admission.candidate), originalRaw); assert.equal(result.admission.requiresCatalogReview, true);
  const creation = empty(); creation.workspaceRevision = f.workspace.revision; creation.ui.catalog.form = form(creation, "fieldMap");
  creation.ui.catalog.form.context = { clientId: "client", projectId: "project", fieldMapId: null, designId: null };
  creation.ui.catalog.form.defaultName = ""; const legacy = v1(creation), legacyResult = resolveWorkspaceEditRecovery(legacy, f.workspace);
  assert.equal(legacyResult.kind, "ready"); if (!("admission" in legacyResult)) assert.fail("Original v1 form contract changed.");
  assert.equal(legacyResult.admission.ui.catalog.form!.kind, "fieldMap"); assert.equal(legacyResult.admission.candidate.recoveryVersion, WORKSPACE_EDIT_RECOVERY_V1_VERSION);
  assert.equal(createHash("sha256").update(readFileSync(frozenReaderPath)).digest("hex"), frozenReaderHash);
});
