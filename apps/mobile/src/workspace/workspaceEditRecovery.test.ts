import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { viewportForScreen } from "../../../../packages/map-adapters/src/mapFit";
import {
  convertPivotProjectToFieldDesign, createFieldLayoutTarget, createSurveyCollection, defaultProjectSettings, defaultAppSettings, parseAppSettings,
  applySurveyCollectionToDesign, validateSurveyCollection,
  parseLayoutSessionDocument, parseSurveyCollectionDocument, projectLonLatToXy, readSurveyDesignDocument,
  sampleProject, serializeDesignDraftDocument, serializeFieldDesignDocument, serializeFieldLayoutTarget,
  serializeProjectDocument, type AppSettings, type DesignDraft, type FieldDesign, type PivotProject, type SurveyPoint,
} from "@cplayout/core";
import { createVersionedProjectRepository, readWorkspaceDesign } from "../../../../packages/project-store/src/versionedProjectRepository";
import { validateWorkspaceDocument, type WorkspaceDocument } from "../../../../packages/project-store/src/workspaceDocument";
import type { WorkspaceCommand } from "../../../../packages/project-store/src/workspaceCommands";
import { editableFromSavedDesign, reduceWorkspaceEditable, reduceWorkspaceEditableBatch, serializeWorkspaceEditable, workspaceEditableIsDirty, type WorkspaceEditableDocument } from "./workspaceDocumentAdapters";
import { workspaceDocumentIdentityKey } from "./workspacePresentation";
import { workspaceMapContextKey } from "./workspaceMapContext";
import { InputRetentionStore, createInputRetentionBaseline } from "../inputRetention";
import {
  WORKSPACE_EDIT_RECOVERY_VERSION, WORKSPACE_EDIT_RECOVERY_MAX_BYTES, WORKSPACE_EDIT_RECOVERY_LIMITS,
  captureWorkspaceRecoveryEditable, decodeWorkspaceRecoveryImport, emptyWorkspaceEditRecoveryUi,
  parseWorkspaceEditRecovery, parseWorkspaceRecoveryImport, resolveWorkspaceEditRecovery, serializeWorkspaceEditRecovery,
  workspaceRecoveryBytesSha256, workspaceRecoveryInputDirty, workspaceRecoveryStableJson,
  type WorkspaceEditRecoveryCandidate, type WorkspaceEditRecoveryResolution,
} from "./workspaceEditRecovery";

const now = "2026-10-11T12:00:00.000Z";
type Kind = "draft" | "project" | "field";
type Mutable<T> = T extends readonly (infer V)[] ? Mutable<V>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function clone<T>(value: T): Mutable<T> { return structuredClone(value) as Mutable<T>; }
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function empty(): WorkspaceEditRecoveryCandidate {
  return { recoveryVersion: WORKSPACE_EDIT_RECOVERY_VERSION, writerId: "writer-one", sequence: 1, capturedAt: now,
    context: { version: 2, catalogVisible: true, catalogSelection: { clientId: null, projectId: null, fieldMapId: null, designId: null },
      workspace: { mode: "design", design: null, layout: null, collectionId: null } }, workspaceRevision: 0,
    editable: null, collections: [], layout: null, controller: { historyPast: [], historyFuture: [], selectedAddress: null },
    inputs: { entries: [], focus: null }, ui: emptyWorkspaceEditRecoveryUi(), cameras: [] };
}
function incompleteDraft(id = "payload", projectCrs: string | null = "EPSG:32613"): DesignDraft {
  return { id, name: "Unfinished draft", projectCrs, unitSystem: "metric", settings: { ...defaultProjectSettings(), unitSystem: "metric" },
    fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
}
function nonDefaultAppSettings(): AppSettings {
  return parseAppSettings({ unitSystem: "metric", coordinateDisplayFormat: "projected_local", defaultZoomLevel: 2.75,
    mappingWorkflowMode: "layout", mapStyle: "high_contrast",
    drawing: { vertexSnapToleranceMeters: 0.5, featureSnapToleranceMeters: 5, selectionTolerancePixels: 24, panStepMeters: 240, zoomStepFactor: 1.8 },
    gpsQuality: { minimumFixType: "rtk_float", minSatellites: 16, maxHdop: 2.5, maxHorizontalAccuracyMeters: 0.125, maxCorrectionAgeSeconds: 5, maxObservationAgeSeconds: 3 },
    layoutReview: { requiredBoundaryClearanceMeters: 9.5, showMachineBoundaryDistances: false },
    offlineMaps: { preferredPackageType: "mbtiles", requireAttribution: true, allowNetworkTiles: false, packageDirectory: "Z:\\not-installed\\offline maps" },
    aerialImagery: { mode: "manual", sourcePackageId: "not-installed-aerial" },
    onlineImagery: { enabled: true, providerId: "custom_open_xyz", maxTilesPerView: 12,
      customSource: { name: "Synthetic custom source", tileUrlTemplate: "https://tiles.example.test/{z}/{x}/{y}.png", minZoom: 2, maxZoom: 17,
        tileScheme: "tms", tileSize: 512, projection: "EPSG:3857", coverageLabel: "Synthetic test coverage",
        termsUrl: "https://tiles.example.test/terms", sourceUrl: "https://tiles.example.test/source", cachePolicy: "interactive_only",
        attribution: "Synthetic source attribution", licenseText: "Synthetic fixture license text" } },
    referenceOverlay: { mode: "manual", roads: false, borders: false, labels: false, sourcePackageId: "not-installed-reference", schema: "openmaptiles" } });
}
async function fixture(kind: Kind = "draft", projectCrs: string | null = "EPSG:32613") {
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const api = createVersionedProjectRepository({ getStorage: () => storage, getLocks: () => ({ request: async (_name, _options, run) => run() }) }).versionedWorkspace!;
  let workspace = await api.readAsync();
  async function execute(command: unknown) { const result = await api.executeAsync(workspace.revision, { now, ...command as object } as WorkspaceCommand, () => true); workspace = result.workspace; return result; }
  for (const id of ["client", "other-client"]) await execute({ type: "create_client", id, input: { primaryContactFirstName: "Synthetic", primaryContactLastName: id } });
  await execute({ type: "create_project_with_initial_field_map", input: { clientId: "client", projectId: "folder", fieldMapId: "map", projectName: "Synthetic folder", fieldMapName: "Actual field", projectCrs: "EPSG:32613", unitSystem: "metric" } });
  await execute({ type: "upgrade_workspace_to_v3" });
  const originalProjectDocument = ` \n${serializeProjectDocument(sampleProject)}\n `;
  const converted = convertPivotProjectToFieldDesign(originalProjectDocument, { fieldId: "payload", waterSourceId: "water", powerSourceId: "power" }).field;
  if (kind === "project") await execute({ type: "import_design_document", designId: "design", payloadId: "payload", fieldMapId: "map", document: serializeProjectDocument(sampleProject) });
  else if (kind === "field") await execute({ type: "create_field_design", designId: "design", fieldMapId: "map", name: "Field", field: converted, originalProjectDocument });
  else await execute({ type: "create_design_draft", designId: "design", fieldMapId: "map", name: "Unfinished draft", draft: incompleteDraft("payload", projectCrs) });
  await execute({ type: "upgrade_workspace_to_v4" });
  function editable() { const read = readWorkspaceDesign(workspace, "design"); if (read.kind === "not_found") throw new Error("Missing fixture design."); return editableFromSavedDesign(read); }
  function candidate(active: WorkspaceEditableDocument = editable()) {
    const read = readWorkspaceDesign(workspace, "design"); if (read.kind === "not_found") throw new Error("Missing fixture design.");
    const recovery = clone(empty()), identity = active.identity;
    recovery.workspaceRevision = active.workspaceRevision;
    recovery.editable = clone(captureWorkspaceRecoveryEditable(active));
    recovery.context.catalogVisible = false; recovery.context.catalogSelection = { ...read.context };
    recovery.context.workspace.design = { designId: identity.designId!, documentKind: identity.kind, payloadId: identity.payloadId, fieldMapId: identity.fieldMapId!, projectCrs: identity.projectCrs };
    recovery.collections = (workspace.surveyCollections ?? []).map(entry => ({ entry, collection: parseSurveyCollectionDocument(entry.document) }))
      .filter(item => item.collection.owner.designId === "design").map(item => ({ id: item.entry.id, revision: item.collection.revision, document: item.entry.document }));
    recovery.ui.entry.designTask = kind === "field" ? "machines" : kind === "project" ? "inputs" : "drawing";
    return recovery;
  }
  async function startCollection(id = "survey") { const active = editable(), owner = active.identity;
    await execute({ type: "create_survey_collection", expectedDesignRevision: active.designRevision, collection: createSurveyCollection({ id, now,
      purpose: { kind: "map_feature", featureKind: "reference_line", geometryType: "LineString" },
      owner: { designId: "design", documentKind: kind, payloadId: owner.payloadId, fieldMapId: "map", projectCrs: owner.projectCrs! } }) }); }
  function collection(id = "survey") { return parseSurveyCollectionDocument(workspace.surveyCollections!.find(entry => entry.id === id)!.document); }
  async function append(observed: SurveyPoint, id = "survey") { await execute({ type: "append_survey_capture", collectionId: id, expectedCollectionRevision: collection(id).revision, expectedDesignRevision: editable().designRevision, point: observed }); }
  async function apply(id = "survey", targetId = "reference") { await execute({ type: "apply_survey_collection", collectionId: id, expectedCollectionRevision: collection(id).revision,
    expectedDesignRevision: editable().designRevision, applicationId: `application-${id}`, targetId, reference: { name: "Exact reference  ", notes: "Retained\nnotes" } }); }
  async function openLayout() { const targetDocument = serializeFieldLayoutTarget(createFieldLayoutTarget(converted, { inputRevision: 0, expectedRevision: 0, selectedMachineIds: [converted.machines[0].id] }));
    await execute({ type: "create_layout_session", sessionId: "layout", fieldMapId: "map", name: "Saved Layout", targetDocument }); }
  function withLayout(candidateInput = candidate()) { const result = clone(candidateInput), entry = workspace.layoutSessions!.find(entry => entry.id === "layout")!, session = parseLayoutSessionDocument(entry.document);
    result.layout = { id: session.id, revision: session.revision, persistenceRevision: workspace.revision, document: entry.document, fieldMapId: session.fieldMapId, targetHash: session.targetHash, targetDocument: session.targetDocument };
    result.context.workspace.layout = { sessionId: session.id, fieldMapId: session.fieldMapId, projectCrs: "EPSG:32613", targetHash: session.targetHash }; result.context.workspace.mode = "layout"; result.workspaceRevision = workspace.revision; return result; }
  return { workspace: () => workspace, execute, editable, candidate, startCollection, collection, append, apply, openLayout, withLayout, values, originalProjectDocument };
}
function operationalPoint(sequence: number, latitude = 40, longitude = -105): SurveyPoint {
  const coordinate = (value: number, width: number) => `${String(Math.floor(Math.abs(value))).padStart(width, "0")}${((Math.abs(value) % 1) * 60).toFixed(4).padStart(7, "0")}`;
  const utcTime = `1200${String(sequence).padStart(2, "0")}.00`, payload = `GNGGA,${utcTime},${coordinate(latitude, 2)},N,${coordinate(longitude, 3)},W,4,12,0.8,1600.0,M,-20.0,M,1.0,42`;
  const checksum = [...payload].reduce((value, character) => value ^ character.charCodeAt(0), 0).toString(16).padStart(2, "0");
  return { id: `point:${sequence}`, label: "Synthetic recorded point", role: "control", projected: projectLonLatToXy({ latitude, longitude }, "EPSG:32613"), wgs84: { latitude, longitude },
    observedAt: now, source: "external_gnss", confidence: "rtk_fixed", captureEvidence: { schemaVersion: "gnss-operational-fixed-v1", observationId: `receiver:${sequence}`, sessionId: "receiver", transport: "local_udp",
      receivedAt: now, receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true, antennaReference: "unknown", sentenceTypes: ["GGA"],
      gga: { sentence: `$${payload}*${checksum}`, sentenceIdentifier: "GNGGA", utcTime, qualityCode: 4, latitude, longitude },
      receipt: { sequence, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 500, provenance: "loopback_companion" },
      capture: { evaluatedMonotonicMs: 1500, ageMs: 1000, maxAgeMs: 2000 }, projection: { id: "wgs84-projection-v1:EPSG:32613", projectCrs: "EPSG:32613" }, physicalQualification: "unverified" } };
}
function admitted(result: WorkspaceEditRecoveryResolution) { if (!("admission" in result)) assert.fail(`${result.kind}: ${result.reason}`); return result.admission; }
function write(kind: Kind, payload: PivotProject | DesignDraft | FieldDesign): string { return kind === "draft" ? serializeDesignDraftDocument(payload as DesignDraft) : kind === "field" ? serializeFieldDesignDocument(payload as FieldDesign) : serializeProjectDocument(payload as PivotProject); }

test("strict detached parser and canonical serializer preserve literal raw values, focus, import bytes and every UI participant", () => {
  const input = clone(empty());
  input.inputs.entries = [{ key: "draft-machine/span", baselineFingerprint: '"12"', cleanFingerprint: '"12"', value: " 1e--  \n" },
    { key: "nested", baselineFingerprint: '{"a":[1,false,null],"z":"baseline"}', cleanFingerprint: '{"a":[1,false,null],"z":"baseline"}', value: { z: "  unchanged\n", a: [0, true, null] } }];
  input.inputs.focus = { key: "draft-machine/span", selection: { start: 1, end: 4 } };
  input.ui.survey = { purposeId: "  invalid purpose JSON ", label: " \n", referenceName: "", referenceNotes: "Exact  \n", referenceBaselineName: "Saved", referenceBaselineNotes: "old", referenceDetails: true };
  input.ui.layout = { name: "  ", nameBaseline: "Saved", label: "Invalid\nlabel", copyName: "  Copy  ", details: true };
  input.ui.file = { dialog: "preferences", text: "{ broken json", baseline: "{}", savedCopyId: null };
  input.ui.receiver = { method: "network", baudRate: " 9bad  ", protocol: "udp", address: " invalid address ", port: "--1", sourceAddress: " 999.0.0.0 ", settingsOpen: true };
  input.ui.catalog.form = { kind: "project", context: input.context.catalogSelection, baselineFingerprint: "[null,null,null]", defaultName: "Project", name: "   ", fieldName: "\n",
    client: null, detailsOpen: true, errors: [{ field: "name", message: "Enter a name." }], error: "Enter a name.", fieldError: "Enter a field.", saveError: "Exact prior error" };
  const bytes = Uint8Array.from([0, 255, 3, 128, 42]), digest = createHash("sha256").update(bytes).digest("hex");
  input.ui.catalog.import = { filename: " source.zip ", bytesBase64: Buffer.from(bytes).toString("base64"), byteLength: bytes.length, sha256: digest };
  const before = JSON.stringify(input), parsed = parseWorkspaceEditRecovery(freeze(input)), raw = serializeWorkspaceEditRecovery(parsed), reopened = parseWorkspaceEditRecovery(raw);
  assert.deepEqual(reopened, parsed); assert.equal(JSON.stringify(input), before);
  assert.equal(parsed.inputs.entries[0].value, " 1e--  \n"); assert.equal(workspaceRecoveryInputDirty(parsed.inputs.entries[0]), true);
  assert.deepEqual(decodeWorkspaceRecoveryImport(parsed.ui.catalog.import!), bytes); assert.equal(parsed.ui.file.text, "{ broken json");
  assert.deepEqual(parsed.ui.receiver, input.ui.receiver);
  assert.notStrictEqual(parsed, input); assert.notStrictEqual(parsed.inputs.entries[1].value, input.inputs.entries[1].value);
  assert.ok(Object.isFrozen(parsed.ui.catalog.form!.errors)); assert.ok(Object.isFrozen(parsed.inputs.entries[1].value));
  assert.equal(serializeWorkspaceEditRecovery(reopened), raw); assert.equal(workspaceRecoveryStableJson({ z: 1, a: 2 }), '{"a":2,"z":1}');
});

test("required application settings preserve every nondefault field and machine-local path as detached data", () => {
  assert.deepEqual(emptyWorkspaceEditRecoveryUi().settings, defaultAppSettings());
  const firstDefaults = emptyWorkspaceEditRecoveryUi(), secondDefaults = emptyWorkspaceEditRecoveryUi();
  assert.notStrictEqual(firstDefaults.settings, secondDefaults.settings); assert.notStrictEqual(firstDefaults.settings.drawing, secondDefaults.settings.drawing);
  const input = clone(empty()); input.ui.settings = nonDefaultAppSettings();
  const before = JSON.stringify(input), parsed = parseWorkspaceEditRecovery(freeze(input)), reopened = parseWorkspaceEditRecovery(serializeWorkspaceEditRecovery(parsed));
  assert.deepEqual(parsed.ui.settings, input.ui.settings); assert.deepEqual(reopened.ui.settings, input.ui.settings);
  assert.equal(parsed.ui.settings.offlineMaps.packageDirectory, "Z:\\not-installed\\offline maps");
  assert.equal(parsed.ui.settings.aerialImagery.sourcePackageId, "not-installed-aerial"); assert.equal(parsed.ui.settings.referenceOverlay.sourcePackageId, "not-installed-reference");
  assert.equal(Object.hasOwn(parsed.ui.settings.offlineMaps, "available"), false);
  assert.notStrictEqual(parsed.ui.settings, input.ui.settings); assert.notStrictEqual(parsed.ui.settings.onlineImagery.customSource, input.ui.settings.onlineImagery.customSource);
  assert.ok(Object.isFrozen(parsed.ui.settings)); assert.ok(Object.isFrozen(parsed.ui.settings.onlineImagery.customSource)); assert.equal(JSON.stringify(input), before);
});

test("settings admission refuses every unknown nested field, missing defaults, lossy normalization and accessors", () => {
  const input = clone(empty()); input.ui.settings = nonDefaultAppSettings();
  const paths = [[], ["drawing"], ["gpsQuality"], ["layoutReview"], ["offlineMaps"], ["aerialImagery"], ["onlineImagery"], ["onlineImagery", "customSource"], ["referenceOverlay"]];
  for (const path of paths) { const changed = clone(input); let owner = changed.ui.settings as unknown as Record<string, unknown>;
    for (const key of path) owner = owner[key] as Record<string, unknown>;
    owner.unrecognizedSetting = "retained unknown bytes";
    assert.doesNotThrow(() => parseAppSettings(changed.ui.settings)); // Core strips extras; recovery must not.
    assert.throws(() => parseWorkspaceEditRecovery(changed), /settings.*unknown|noncanonical/);
  }
  const missing = clone(input); delete (missing.ui as unknown as Record<string, unknown>).settings; assert.throws(() => parseWorkspaceEditRecovery(missing), /missing/);
  const defaulted = clone(input); delete (defaulted.ui.settings.gpsQuality as unknown as Record<string, unknown>).maxObservationAgeSeconds;
  assert.doesNotThrow(() => parseAppSettings(defaulted.ui.settings)); assert.throws(() => parseWorkspaceEditRecovery(defaulted), /settings.*unknown|noncanonical/);
  const normalized = clone(input); normalized.ui.settings.onlineImagery.customSource!.name = "  Synthetic custom source  ";
  assert.doesNotThrow(() => parseAppSettings(normalized.ui.settings)); assert.throws(() => parseWorkspaceEditRecovery(normalized), /settings.*unknown|noncanonical/);
  let calls = 0;
  const accessor = clone(input); Object.defineProperty(accessor.ui.settings.drawing, "panStepMeters", { enumerable: true, get() { calls++; return 240; } });
  assert.throws(() => parseWorkspaceEditRecovery(accessor), /computed/); assert.equal(calls, 0);
  const settingsAccessor = clone(input); Object.defineProperty(settingsAccessor.ui, "settings", { enumerable: true, get() { calls++; return input.ui.settings; } });
  assert.throws(() => parseWorkspaceEditRecovery(settingsAccessor), /computed/); assert.equal(calls, 0);
});

test("application display/settings changes cannot reframe source identities or captured field cameras", async () => {
  for (const kind of ["draft", "project", "field"] as const) {
    const f = await fixture(kind), original = f.candidate();
    original.cameras = [{ context: { kind: "field", fieldMapId: "map", projectCrs: "EPSG:32613" }, initialized: true,
      viewport: { center: { x: 500012.12345, y: 4400034.56789 }, baseWidthMeters: 1500, baseHeightMeters: 1000, zoomLevel: 2 } }];
    const changed = clone(original); changed.ui.settings = nonDefaultAppSettings();
    const before = JSON.stringify(f.workspace()), baseline = admitted(resolveWorkspaceEditRecovery(original, f.workspace())), recovery = admitted(resolveWorkspaceEditRecovery(changed, f.workspace()));
    assert.equal(workspaceDocumentIdentityKey(recovery.editable!.identity), workspaceDocumentIdentityKey(baseline.editable!.identity));
    assert.equal(recovery.editable!.sourceDocument, baseline.editable!.sourceDocument); assert.equal(serializeWorkspaceEditable(recovery.editable!), serializeWorkspaceEditable(baseline.editable!));
    assert.deepEqual(recovery.candidate.context, baseline.candidate.context); assert.deepEqual(recovery.candidate.collections, baseline.candidate.collections);
    assert.equal(workspaceMapContextKey(recovery.candidate.cameras[0].context), workspaceMapContextKey(baseline.candidate.cameras[0].context));
    assert.deepEqual(recovery.candidate.cameras, baseline.candidate.cameras); assert.equal(recovery.candidate.cameras[0].viewport.zoomLevel, 2);
    assert.deepEqual(recovery.ui.settings, changed.ui.settings); assert.equal(JSON.stringify(f.workspace()), before);
  }
});

test("initialized empty workspace admits catalog-only unfinished form and preferences without inventing editor/layout ownership", async () => {
  const values = new Map<string, string>(), api = createVersionedProjectRepository({ getStorage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }),
    getLocks: () => ({ request: async (_name, _options, run) => run() }) }).versionedWorkspace!;
  const workspace = await api.readAsync(); assert.ok(values.size > 0); assert.equal(workspace.catalog.designs.length, 0);
  const candidate = clone(empty()); candidate.workspaceRevision = workspace.revision; candidate.ui.settings = nonDefaultAppSettings();
  candidate.ui.file = { dialog: "preferences", text: "{\n unfinished preferences  ", baseline: JSON.stringify(defaultAppSettings()), savedCopyId: null };
  candidate.ui.catalog.form = { kind: "client", context: candidate.context.catalogSelection, baselineFingerprint: "[null,null,null]", defaultName: "New customer", name: " \n", fieldName: "",
    client: { companyName: " unfinished  ", primaryContactFirstName: "", primaryContactMiddleInitial: " x.. ", primaryContactLastName: "  ", primaryContactSuffix: "", email: "invalid email text", phone: "", location: "", notes: " raw\nnotes  " },
    detailsOpen: true, errors: [{ field: "primaryContactFirstName", message: "Enter the contact's first name." }], error: null, fieldError: null, saveError: "Exact earlier validation message" };
  const before = new Map(values), raw = serializeWorkspaceEditRecovery(candidate), result = resolveWorkspaceEditRecovery(candidate, freeze(workspace)), admission = admitted(result);
  assert.equal(result.kind, "ready"); assert.equal(admission.editable, null); assert.equal(admission.layout, null); assert.deepEqual(admission.collections, []);
  assert.deepEqual(admission.ui.catalog.form, candidate.ui.catalog.form); assert.equal(admission.ui.file.text, candidate.ui.file.text); assert.deepEqual(admission.ui.settings, candidate.ui.settings);
  assert.equal(admission.requiresCatalogReview, true); assert.equal(admission.candidate.context.workspace.design, null);
  assert.equal(serializeWorkspaceEditRecovery(candidate), raw); assert.deepEqual(values, before);
});

test("diagnostic presentation bytes remain exportable but ownerless diagnostics refuse before fresh source access or hydration", () => {
  const candidate = clone(empty()); candidate.ui.entry.diagnosticOpen = true;
  const raw = serializeWorkspaceEditRecovery(candidate), parsed = parseWorkspaceEditRecovery(raw); assert.equal(parsed.ui.entry.diagnosticOpen, true);
  let calls = 0; const source = {};
  Object.defineProperty(source, "catalog", { enumerable: true, get() { calls++; throw new Error("Diagnostic refusal must precede source hydration."); } });
  const result = resolveWorkspaceEditRecovery(parsed, source as WorkspaceDocument);
  assert.equal(result.kind, "unsupported"); if (result.kind === "unsupported") assert.match(result.reason, /Diagnostic.*owner/);
  assert.equal(calls, 0); assert.equal(serializeWorkspaceEditRecovery(parsed), raw); assert.equal("admission" in result, false);
});

test("actual retention snapshots preserve Draft and Field aggregate-input logical focus addresses and exact carets", () => {
  const draftScope = JSON.stringify(["draft-inputs", "payload"]), fieldScope = "field-inputs/payload", machineKey = `${fieldScope}/machine/machine-1`, nameKey = `${fieldScope}/name`;
  const examples = [
    { entryKey: `${draftScope}/machine`, focusKey: `${draftScope}/focus/draft-machine-radius`,
      baseline: { canonical: {}, value: { radius: "", spans: [""] }, error: null }, raw: { canonical: {}, value: { radius: " 12bad ", spans: [" 1-- "] }, error: "Raw validation message" } },
    { entryKey: machineKey, focusKey: `${machineKey}/focus/span/0`,
      baseline: { values: { name: "Machine", spans: ["100"] }, error: null }, raw: { values: { name: " Machine  ", spans: [" 100bad "] }, error: "Invalid span" } },
    { entryKey: nameKey, focusKey: `${nameKey}/focus/text`,
      baseline: { text: "Field", error: null }, raw: { text: " unfinished  ", error: "Exact name error" } },
  ];
  for (const example of examples) {
    const store = new InputRetentionStore(), baseline = createInputRetentionBaseline<unknown>(example.baseline);
    store.reconcile(example.entryKey, baseline); store.set(example.entryKey, baseline, example.raw);
    store.recordFocus(example.focusKey); store.recordSelection(example.focusKey, { start: 2, end: 5 });
    const snapshot = store.snapshotRecovery(), candidate = clone(empty()); candidate.inputs = clone(snapshot);
    assert.notEqual(snapshot.focus!.key, snapshot.entries[0].key); assert.equal(typeof snapshot.entries[0].value, "object");
    const parsed = parseWorkspaceEditRecovery(candidate), reopened = parseWorkspaceEditRecovery(serializeWorkspaceEditRecovery(parsed));
    assert.deepEqual(reopened.inputs, snapshot); assert.deepEqual(reopened.inputs.focus!.selection, { start: 2, end: 5 });
    assert.equal(reopened.inputs.focus!.key, example.focusKey); assert.equal(workspaceRecoveryInputDirty(reopened.inputs.entries[0]), true);
    assert.ok(Object.isFrozen(reopened.inputs.focus)); assert.notStrictEqual(reopened.inputs.entries[0].value, snapshot.entries[0].value);
    assert.deepEqual(store.snapshotRecovery(), snapshot);
  }
});

test("unknown logical focus stays inert/exportable while metadata bounds and raw input authority checks remain strict", async () => {
  const f = await fixture(), candidate = f.candidate(); candidate.inputs.focus = { key: "unregistered/focus/missing-field", selection: { start: 900, end: 1000 } };
  candidate.inputs.entries = [];
  const before = JSON.stringify(f.workspace()), raw = serializeWorkspaceEditRecovery(candidate), admission = admitted(resolveWorkspaceEditRecovery(candidate, f.workspace()));
  assert.deepEqual(admission.inputs.focus, candidate.inputs.focus); assert.deepEqual(admission.inputs.entries, []);
  assert.equal(serializeWorkspaceEditRecovery(candidate), raw); assert.equal(JSON.stringify(f.workspace()), before); assert.equal(workspaceEditableIsDirty(admission.editable), false);
  const bounded = clone(candidate); bounded.inputs.focus = { key: "x".repeat(8192), selection: { start: Number.MAX_SAFE_INTEGER, end: Number.MAX_SAFE_INTEGER } };
  assert.equal(parseWorkspaceEditRecovery(bounded).inputs.focus!.key.length, 8192);
  for (const focus of [{ key: "" }, { key: "x".repeat(8193) }, { key: "logical/address", selection: { start: 3, end: 2 } },
    { key: "logical/address", selection: { start: -1, end: 2 } }, { key: "logical/address", selection: { start: 0, end: Infinity } }]) {
    const invalid = clone(candidate); invalid.inputs.focus = focus; assert.throws(() => parseWorkspaceEditRecovery(invalid));
  }
  const forgedRaw = clone(candidate); forgedRaw.inputs.entries = [{ key: "raw", baselineFingerprint: "null", cleanFingerprint: "null", value: NaN }];
  assert.throws(() => parseWorkspaceEditRecovery(forgedRaw), /finite/);
  const duplicate = clone(candidate); duplicate.inputs.entries = [{ key: "raw", baselineFingerprint: "null", cleanFingerprint: "null", value: null }, { key: "raw", baselineFingerprint: "null", cleanFingerprint: "null", value: null }];
  assert.throws(() => parseWorkspaceEditRecovery(duplicate), /Duplicate/);
});

test("acknowledged Catalog import and File copy affordances retain fresh existing design pointers without reopening or importing", async () => {
  const f = await fixture(), candidate = f.candidate(), before = JSON.stringify(f.workspace()), durable = new Map(f.values);
  candidate.ui.catalog.savedImportId = "design"; candidate.ui.file.savedCopyId = "design";
  candidate.ui.catalog.import = null;
  const raw = serializeWorkspaceEditRecovery(candidate), parsed = parseWorkspaceEditRecovery(raw), result = resolveWorkspaceEditRecovery(parsed, freeze(f.workspace())), admission = admitted(result);
  assert.equal(result.kind, "ready"); assert.equal(admission.ui.catalog.savedImportId, "design"); assert.equal(admission.ui.file.savedCopyId, "design");
  assert.equal(admission.ui.catalog.import, null); assert.equal(admission.requiresImportReview, false);
  assert.equal(admission.candidate.context.workspace.design!.designId, candidate.context.workspace.design!.designId);
  assert.equal(admission.editable!.sourceDocument, candidate.editable!.sourceDocument); assert.equal(serializeWorkspaceEditRecovery(candidate), raw);
  assert.equal(JSON.stringify(f.workspace()), before); assert.deepEqual(f.values, durable);
  const catalogOnly = clone(empty()); catalogOnly.workspaceRevision = f.workspace().revision;
  catalogOnly.ui.catalog.savedImportId = "design"; catalogOnly.ui.file.savedCopyId = "design";
  const parked = admitted(resolveWorkspaceEditRecovery(catalogOnly, f.workspace()));
  assert.equal(parked.editable, null); assert.equal(parked.candidate.context.workspace.design, null); assert.equal(parked.ui.catalog.savedImportId, "design");
  assert.equal(parked.ui.file.savedCopyId, "design"); assert.equal(parked.layout, null);
});

test("saved affordance IDs refuse missing records and acknowledged upload bytes without dropping candidate data", async () => {
  const f = await fixture(), candidate = f.candidate();
  for (const surface of ["catalog", "file"] as const) {
    const missing = clone(candidate);
    if (surface === "catalog") missing.ui.catalog.savedImportId = "missing-design"; else missing.ui.file.savedCopyId = "missing-design";
    const raw = serializeWorkspaceEditRecovery(missing), result = resolveWorkspaceEditRecovery(missing, f.workspace());
    assert.equal(result.kind, "source_conflict"); if (result.kind === "source_conflict") assert.match(result.reason, /design pointer.*fresh workspace/);
    assert.equal(serializeWorkspaceEditRecovery(missing), raw);
  }
  const acknowledgedUpload = clone(candidate), bytes = Uint8Array.of(0, 1, 255);
  acknowledgedUpload.ui.catalog.savedImportId = "design";
  acknowledgedUpload.ui.catalog.import = { filename: "retained.zip", bytesBase64: Buffer.from(bytes).toString("base64"), byteLength: bytes.length, sha256: workspaceRecoveryBytesSha256(bytes) };
  const before = JSON.stringify(acknowledgedUpload); assert.throws(() => parseWorkspaceEditRecovery(acknowledgedUpload), /acknowledged.*unsubmitted upload/i);
  assert.equal(resolveWorkspaceEditRecovery(acknowledgedUpload, f.workspace()).kind, "invalid"); assert.equal(JSON.stringify(acknowledgedUpload), before);
  const invalidId = clone(candidate); invalidId.ui.file.savedCopyId = ""; assert.throws(() => parseWorkspaceEditRecovery(invalidId));
});

test("positive safe checkpoint sequences, strict keys/prototypes/dates/finite JSON refuse without executing accessors or hooks", () => {
  const base = empty(); let calls = 0;
  const accessor = clone(base); Object.defineProperty(accessor.ui, "entry", { enumerable: true, get() { calls++; return base.ui.entry; } });
  assert.throws(() => parseWorkspaceEditRecovery(accessor), /computed/); assert.equal(calls, 0);
  const hooked = { ...base, toJSON() { calls++; return base; } }; assert.throws(() => parseWorkspaceEditRecovery(hooked)); assert.equal(calls, 0);
  const invalid: unknown[] = [null, [], { ...base, recoveryVersion: "v99" }, { ...base, sequence: 0 }, { ...base, sequence: Number.MAX_SAFE_INTEGER + 1 }, { ...base, writerId: "\u0085hidden" },
    { ...base, capturedAt: "2026-02-30T12:00:00Z" }, { ...base, capturedAt: "2026-10-11T24:00:00Z" }, { ...base, connection: "connected" },
    { ...base, inputs: { ...base.inputs, queuedWrites: [] } }, { ...base, ui: { ...base.ui, callback: "callback" } }, Object.assign(Object.create({ inherited: true }), base),
    { ...base, inputs: { entries: [{ key: "bad", baselineFingerprint: "null", cleanFingerprint: "null", value: NaN }], focus: null } }];
  for (const value of invalid) assert.throws(() => parseWorkspaceEditRecovery(value));
  const symbol = clone(base); (symbol as unknown as Record<symbol, unknown>)[Symbol("hidden")] = "refuse"; assert.throws(() => parseWorkspaceEditRecovery(symbol));
  const sparse = clone(base); sparse.inputs.entries = new Array(1); assert.throws(() => parseWorkspaceEditRecovery(sparse), /sparse/);
  const hidden = clone(base); Object.defineProperty(hidden, "hidden", { value: 1 }); assert.throws(() => parseWorkspaceEditRecovery(hidden), /hidden/);
  const circular = clone(base); (circular as unknown as Record<string, unknown>).loop = circular; assert.throws(() => parseWorkspaceEditRecovery(circular), /cycles/);
  assert.throws(() => parseWorkspaceEditRecovery('{"recoveryVersion":"x","recoveryVersion":"x"}'), /duplicate/i);
  assert.throws(() => parseWorkspaceEditRecovery(JSON.stringify(base).replace('"sequence":1', '"sequence":1,/*comment*/')));
  assert.throws(() => parseWorkspaceEditRecovery({ ...base, writerId: "\ud800" }));
  const exhausted = clone(base); exhausted.sequence = Number.MAX_SAFE_INTEGER; assert.equal(parseWorkspaceEditRecovery(exhausted).sequence, Number.MAX_SAFE_INTEGER);
});

test("UTF-8/depth/count limits reject oversize without dropping data; exact bound is accepted", () => {
  const raw = JSON.stringify(empty()), atLimit = " ".repeat(WORKSPACE_EDIT_RECOVERY_MAX_BYTES - raw.length) + raw;
  assert.equal(parseWorkspaceEditRecovery(atLimit).writerId, "writer-one"); assert.throws(() => parseWorkspaceEditRecovery(` ${atLimit}`), /byte limit/i);
  const nonAscii = clone(empty()); nonAscii.ui.file.text = "界".repeat(Math.ceil(WORKSPACE_EDIT_RECOVERY_MAX_BYTES / 3)); assert.throws(() => parseWorkspaceEditRecovery(nonAscii), /byte limit/i);
  const tooMany = clone(empty()); tooMany.inputs.entries = Array.from({ length: WORKSPACE_EDIT_RECOVERY_LIMITS.inputs + 1 }, (_value, index) => ({ key: `k${index}`, baselineFingerprint: "null", cleanFingerprint: "null", value: null }));
  assert.throws(() => parseWorkspaceEditRecovery(tooMany), /count limit/);
  const deep = `${"[".repeat(65)}0${"]".repeat(65)}`; assert.throws(() => parseWorkspaceEditRecovery(deep), /depth/);
  const invalidFingerprint = clone(empty()); invalidFingerprint.inputs.entries = [{ key: "k", baselineFingerprint: '{"z":0,"a":0}', cleanFingerprint: "null", value: null }]; assert.throws(() => parseWorkspaceEditRecovery(invalidFingerprint), /canonical/);
  const focus = clone(empty()); focus.inputs.focus = { key: "missing" }; assert.deepEqual(parseWorkspaceEditRecovery(focus).inputs.focus, { key: "missing" });
});

test("binary import integrity handles all byte values, refuses mutated length/digest/padding, and returns detached bytes", () => {
  for (const length of [0, 1, 2, 3, 55, 56, 63, 64, 65, 256, 1000]) { const bytes = Uint8Array.from({ length }, (_v, index) => index % 256);
    assert.equal(workspaceRecoveryBytesSha256(bytes), createHash("sha256").update(bytes).digest("hex"));
    const candidate = { filename: "source.zip", bytesBase64: Buffer.from(bytes).toString("base64"), byteLength: bytes.length, sha256: workspaceRecoveryBytesSha256(bytes) };
    assert.deepEqual(decodeWorkspaceRecoveryImport(candidate), bytes); const decoded = decodeWorkspaceRecoveryImport(candidate); if (decoded.length) decoded[0] ^= 255;
    assert.deepEqual(decodeWorkspaceRecoveryImport(candidate), bytes);
    assert.throws(() => parseWorkspaceRecoveryImport({ ...candidate, byteLength: bytes.length + 1 })); assert.throws(() => parseWorkspaceRecoveryImport({ ...candidate, sha256: "0".repeat(64) })); }
  assert.throws(() => parseWorkspaceRecoveryImport({ filename: "source.zip", bytesBase64: "AB==", byteLength: 1, sha256: createHash("sha256").update(Uint8Array.of(0)).digest("hex") }), /padding/);
});

test("all three saved document owners retain actual current/past/future raw strings, revisions, selected machine and immutable detached admission", async () => {
  for (const kind of ["draft", "project", "field"] as const) {
    const f = await fixture(kind), initial = f.editable();
    let changed = kind === "draft" ? reduceWorkspaceEditable(initial, { kind, action: { type: "rename", name: "Unfinished first name" } })
      : kind === "field" ? reduceWorkspaceEditable(initial, { kind, action: { type: "rename", name: "Unfinished first name" } })
        : reduceWorkspaceEditable(initial, { kind, action: { type: "rename", name: "Unfinished first name" } });
    changed = kind === "draft" ? reduceWorkspaceEditable(changed, { kind, action: { type: "rename", name: "Second unfinished name" } })
      : kind === "field" ? reduceWorkspaceEditable(changed, { kind, action: { type: "rename", name: "Second unfinished name" } })
        : reduceWorkspaceEditable(changed, { kind, action: { type: "rename", name: "Second unfinished name" } });
    changed = reduceWorkspaceEditable(changed, { kind, action: { type: "undo" } } as never);
    if (changed.kind === "field") changed = reduceWorkspaceEditable(changed, { kind: "field", action: { type: "select_machine", id: changed.editor.field.machines[0].id } });
    const candidate = f.candidate(changed); candidate.editable!.editor.lastError = "  exact invalid field\n";
    candidate.editable!.workingDocument = ` \n${candidate.editable!.workingDocument}\n `;
    candidate.controller.historyPast = [{ document: serializeWorkspaceEditable(initial), memberships: [] }];
    candidate.controller.historyFuture = [{ document: candidate.editable!.editor.future[0], memberships: [] }];
    candidate.inputs.entries = [{ key: `${kind}/machine/value`, baselineFingerprint: '"10"', cleanFingerprint: '"10"', value: "--invalid--" }];
    candidate.cameras = [{ context: { kind: "field", fieldMapId: "map", projectCrs: "EPSG:32613" }, initialized: true,
      viewport: { center: { x: 500111.123456, y: 4400222.987654 }, baseWidthMeters: 321.5, baseHeightMeters: 200.75, zoomLevel: 2.25 } }];
    const before = JSON.stringify(candidate), workspaceBefore = JSON.stringify(f.workspace()), durableBefore = new Map(f.values);
    const parsed = parseWorkspaceEditRecovery(freeze(candidate)), result = resolveWorkspaceEditRecovery(parsed, freeze(f.workspace())), admission = admitted(result);
    assert.equal(result.kind, "ready"); assert.equal(admission.editable!.kind, kind); assert.equal(admission.candidate.editable!.workingDocument, candidate.editable!.workingDocument);
    assert.deepEqual(admission.candidate.editable!.editor.past, candidate.editable!.editor.past); assert.deepEqual(admission.candidate.editable!.editor.future, candidate.editable!.editor.future);
    assert.equal(admission.editable!.editor.revision, changed.editor.revision); assert.equal(admission.editable!.editor.lastError, "  exact invalid field\n");
    assert.equal(admission.editable!.savedEditorRevision, changed.savedEditorRevision); assert.equal(admission.editable!.sourceDocument, initial.sourceDocument);
    assert.notStrictEqual(admission.candidate, parsed); assert.notStrictEqual(admission.inputs.entries[0], candidate.inputs.entries[0]); assert.ok(Object.isFrozen(admission.editable!.editor.past));
    if (admission.editable!.kind === "field") { assert.equal(admission.editable!.originalProjectDocument, f.originalProjectDocument); assert.equal(admission.editable!.editor.selectedMachineId, changed.kind === "field" ? changed.editor.selectedMachineId : null); }
    assert.equal(JSON.stringify(candidate), before); assert.equal(JSON.stringify(f.workspace()), workspaceBefore); assert.deepEqual(f.values, durableBefore);
    const redo = reduceWorkspaceEditable(admission.editable!, { kind, action: { type: "redo" } } as never);
    const payload = redo.kind === "draft" ? redo.editor.draft : redo.kind === "field" ? redo.editor.field : redo.editor.project;
    assert.equal(payload.name, "Second unfinished name");
  }
});

test("Project unfinished drawing and Draft reducer capture preserve ordered exact XY/times/text while recovered tools and autosave are parked", async () => {
  const project = await fixture("project"), pending = project.candidate();
  pending.ui.entry.drawing = { geometryType: "LineString", vertices: [{ x: 1.123456789, y: 2.987654321 }, { x: 4, y: 8 }], vertexRecordedAt: [now, "2026-10-11T12:00:01.123456Z"],
    stage: "classification", selectionId: "reference_line", name: "  unfinished  ", notes: " \nraw ", detailsOpen: true, choicesOpen: true, error: "  invalid ", replacing: false, captureId: "map-capture", paused: false };
  const projectAdmission = admitted(resolveWorkspaceEditRecovery(pending, project.workspace())); assert.deepEqual(projectAdmission.ui.entry.drawing!.vertices, pending.ui.entry.drawing.vertices);
  assert.deepEqual(projectAdmission.ui.entry.drawing!.vertexRecordedAt, pending.ui.entry.drawing.vertexRecordedAt); assert.equal(projectAdmission.ui.entry.drawing!.name, "  unfinished  ");
  assert.equal(projectAdmission.ui.entry.drawing!.paused, true); assert.equal(projectAdmission.candidate.ui.entry.drawing!.paused, false);
  const draft = await fixture("draft"), initial = draft.editable();
  const drawn = reduceWorkspaceEditableBatch(initial, [{ kind: "draft", action: { type: "drawing", expectedRevision: 0, command: { type: "begin", id: "capture", geometryType: "LineString", name: "  raw name " } } },
    { kind: "draft", action: { type: "drawing", expectedRevision: 0, command: { type: "append_vertex", id: "capture", vertex: { point: { x: 1.234567, y: 2.345678 }, recordedAt: now, wgs84: null, elevation: null } } } }]);
  assert.equal(drawn.editor.revision, 1); const candidate = draft.candidate(drawn), admission = admitted(resolveWorkspaceEditRecovery(candidate, draft.workspace()));
  assert.equal(admission.editable!.kind, "draft"); if (admission.editable!.kind !== "draft") throw new Error("Wrong fixture kind.");
  assert.deepEqual(admission.editable!.editor.draft.drawingWorkflow!.captures[0].vertices, drawn.kind === "draft" ? drawn.editor.draft.drawingWorkflow!.captures[0].vertices : null);
  assert.equal(admission.editable!.editor.draft.drawingWorkflow!.autosaveEnabled, false); assert.equal(admission.editable!.editor.lockedCrs, "EPSG:32613");
});

test("forged equal editor counters cannot hide changed manual geometry, while source formatting and normalization alone stay clean", async () => {
  for (const kind of ["draft", "project", "field"] as const) {
    const f = await fixture(kind), candidate = f.candidate(), current = readSurveyDesignDocument(kind, candidate.editable!.workingDocument);
    const same = clone(candidate); same.editable!.workingDocument = ` \r\n${JSON.stringify(JSON.parse(same.editable!.workingDocument), null, 2)}\r\n `;
    const cleanAdmission = admitted(resolveWorkspaceEditRecovery(same, f.workspace())); assert.equal(workspaceEditableIsDirty(cleanAdmission.editable), false);
    if (kind === "field") { const field = current as FieldDesign; field.machines[0].pivotCenter.x += 12.345; }
    else if (kind === "project") (current as PivotProject).fieldBoundary[0].x += 12.345;
    else { (current as DesignDraft).fieldBoundary = [{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 1, y: 4 }]; candidate.editable!.editor.lockedCrs = "EPSG:32613"; }
    candidate.editable!.workingDocument = write(kind, current);
    for (const forgedRevision of [0, 3, Number.MAX_SAFE_INTEGER]) {
      candidate.editable!.editor.revision = forgedRevision; candidate.editable!.editor.savedRevision = forgedRevision;
      const admission = admitted(resolveWorkspaceEditRecovery(candidate, f.workspace()));
      assert.equal(workspaceEditableIsDirty(admission.editable), true, `${kind} revision ${forgedRevision}`);
      assert.equal(admission.candidate.editable!.editor.revision, forgedRevision); assert.equal(admission.candidate.editable!.editor.savedRevision, forgedRevision);
      assert.notEqual(admission.editable!.editor.revision, admission.editable!.savedEditorRevision);
    }
  }
});

test("dirty state includes final autosave parking changes for Draft workflow and every document kind metadata", async () => {
  for (const kind of ["draft", "project", "field"] as const) {
    const f = await fixture(kind), editable = f.editable(), source = readSurveyDesignDocument(kind, serializeWorkspaceEditable(editable));
    if (kind === "field") (source as FieldDesign).drawingMetadata = { schemaVersion: "field-drawing-metadata-v1", autosaveEnabled: true, records: [] };
    else (source as PivotProject | DesignDraft).drawingMetadata = { schemaVersion: "project-drawing-metadata-v1", autosaveEnabled: true, records: [] };
    if (kind === "draft") (source as DesignDraft).drawingWorkflow = { schemaVersion: "draft-drawing-workflow-v1", autosaveEnabled: true, lockedCrs: null, activeCaptureId: null, captures: [] };
    await f.execute(kind === "draft" ? { type: "save_design_draft", designId: "design", expectedDesignRevision: editable.designRevision, draft: source }
      : kind === "field" ? { type: "save_field_design", designId: "design", expectedDesignRevision: editable.designRevision, field: source }
        : { type: "save_design_project", designId: "design", project: source });
    const candidate = f.candidate(), raw = serializeWorkspaceEditRecovery(candidate);
    assert.equal(candidate.editable!.editor.revision, candidate.editable!.editor.savedRevision);
    const admission = admitted(resolveWorkspaceEditRecovery(candidate, f.workspace())), hydrated = admission.editable!;
    assert.equal(workspaceEditableIsDirty(hydrated), true, kind); assert.equal(serializeWorkspaceEditRecovery(candidate), raw);
    assert.equal(admission.candidate.editable!.workingDocument, candidate.editable!.workingDocument);
    const value = hydrated.kind === "draft" ? hydrated.editor.draft : hydrated.kind === "field" ? hydrated.editor.field : hydrated.editor.project;
    assert.equal(value.drawingMetadata!.autosaveEnabled, false); assert.notEqual(serializeWorkspaceEditable(hydrated), candidate.editable!.workingDocument);
    assert.equal(readSurveyDesignDocument(kind, candidate.editable!.sourceDocument).drawingMetadata!.autosaveEnabled, true);
    if (kind === "draft") { assert.equal((value as DesignDraft).drawingWorkflow!.autosaveEnabled, false); assert.equal(readSurveyDesignDocument("draft", candidate.editable!.sourceDocument).drawingWorkflow!.autosaveEnabled, true); }
  }
});

test("unrelated monotonic workspace advances require explicit reconciliation and change only staged workspace receipt", async () => {
  const f = await fixture(), candidate = f.candidate(), original = serializeWorkspaceEditRecovery(candidate), priorRevision = candidate.workspaceRevision;
  await f.execute({ type: "create_client", id: "unrelated-client", input: { primaryContactFirstName: "Other", primaryContactLastName: "Client" } });
  const result = resolveWorkspaceEditRecovery(candidate, f.workspace()), admission = admitted(result); assert.equal(result.kind, "reconcile_required");
  assert.equal(admission.candidate.workspaceRevision, priorRevision); assert.equal(admission.staged.workspaceRevision, f.workspace().revision); assert.equal(admission.editable!.workspaceRevision, f.workspace().revision);
  assert.deepEqual({ ...admission.staged, workspaceRevision: priorRevision }, admission.candidate); assert.equal(serializeWorkspaceEditRecovery(candidate), original);
  const forwardReceipt = clone(candidate); forwardReceipt.workspaceRevision = f.workspace().revision + 1;
  const movedBack = resolveWorkspaceEditRecovery(forwardReceipt, f.workspace()); assert.equal(movedBack.kind, "source_conflict");
});

test("exact source bytes, kind, ancestry, design revision and original Project source drift refuse admission", async () => {
  for (const kind of ["draft", "project", "field"] as const) {
    const f = await fixture(kind), candidate = f.candidate(), otherSource = clone(f.workspace());
    if (kind === "draft") otherSource.draftDocuments[0].document += "\n"; else if (kind === "field") otherSource.fieldDocuments![0].document += "\n"; else otherSource.projectDocuments[0].document += "\n";
    assert.equal(resolveWorkspaceEditRecovery(candidate, validateWorkspaceDocument(otherSource)).kind, "source_conflict");
    const moved = clone(f.workspace()); moved.catalog.projects[0].clientId = "other-client"; assert.equal(resolveWorkspaceEditRecovery(candidate, validateWorkspaceDocument(moved)).kind, "source_conflict");
    const changedRevision = clone(f.workspace()); changedRevision.catalog.designs[0].revision++; assert.equal(resolveWorkspaceEditRecovery(candidate, validateWorkspaceDocument(changedRevision)).kind, "source_conflict");
    if (kind === "field") { const original = clone(f.workspace()); original.fieldDocuments![0].originalProjectDocument += "\n"; assert.equal(resolveWorkspaceEditRecovery(candidate, validateWorkspaceDocument(original)).kind, "source_conflict"); }
    const changedPayload = clone(candidate), parsed = readSurveyDesignDocument(kind, changedPayload.editable!.workingDocument); parsed.id = "foreign-payload"; changedPayload.editable!.workingDocument = write(kind, parsed);
    assert.equal(resolveWorkspaceEditRecovery(changedPayload, f.workspace()).kind, "invalid");
    const foreignHistory = clone(candidate), history = readSurveyDesignDocument(kind, candidate.editable!.workingDocument); history.projectCrs = "EPSG:32614"; foreignHistory.editable!.editor.past = [write(kind, history)];
    assert.equal(resolveWorkspaceEditRecovery(foreignHistory, f.workspace()).kind, "invalid");
  }
});

test("exact complete owned collection set and receipts reject added/missing/changed collections without mutation", async () => {
  const f = await fixture(); await f.startCollection(); const candidate = f.candidate();
  candidate.context.workspace.collectionId = "survey"; candidate.context.workspace.mode = "survey";
  assert.equal(resolveWorkspaceEditRecovery(candidate, f.workspace()).kind, "ready");
  const missing = clone(candidate); missing.collections = []; missing.context.workspace.collectionId = null; assert.equal(resolveWorkspaceEditRecovery(missing, f.workspace()).kind, "source_conflict");
  const changedBytes = clone(candidate); changedBytes.collections[0].document += "\n"; assert.equal(resolveWorkspaceEditRecovery(changedBytes, f.workspace()).kind, "source_conflict");
  const before = JSON.stringify(candidate); await f.startCollection("later-survey"); assert.equal(resolveWorkspaceEditRecovery(candidate, f.workspace()).kind, "source_conflict"); assert.equal(JSON.stringify(candidate), before);
});

test("Survey history restores only actual ordered membership IDs while preserving observation/application ledgers", async () => {
  const f = await fixture(); await f.startCollection(); await f.append(operationalPoint(1)); await f.append(operationalPoint(2, 40.01));
  const candidate = f.candidate(), source = candidate.editable!.workingDocument;
  candidate.controller.historyPast = [{ document: source, memberships: [{ collectionId: "survey", activePointIds: ["point:2", "point:1"], state: "pending" }] }];
  candidate.controller.historyFuture = [{ document: source, memberships: [{ collectionId: "survey", activePointIds: [], state: "cleared" }] }];
  const bytes = f.workspace().surveyCollections![0].document, admission = admitted(resolveWorkspaceEditRecovery(candidate, f.workspace()));
  assert.deepEqual(admission.historyPast[0].memberships[0].activePointIds, ["point:2", "point:1"]); assert.equal(f.workspace().surveyCollections![0].document, bytes);
  const forgedPoint = clone(candidate); forgedPoint.controller.historyPast[0].memberships[0].activePointIds = ["invented-point"];
  assert.equal(resolveWorkspaceEditRecovery(forgedPoint, f.workspace()).kind, "source_conflict");
  const forgedOwner = clone(candidate); forgedOwner.controller.historyPast[0].memberships[0].collectionId = "unowned-collection";
  assert.equal(resolveWorkspaceEditRecovery(forgedOwner, f.workspace()).kind, "source_conflict");
  const duplicate = clone(candidate); duplicate.controller.historyPast[0].memberships[0].activePointIds = ["point:1", "point:1"]; assert.equal(resolveWorkspaceEditRecovery(duplicate, f.workspace()).kind, "invalid");
});

test("old history before later origins admits against trusted fresh ledger; deletion/restoration carry authority for all document kinds", async () => {
  for (const kind of ["draft", "project", "field"] as const) {
    const f = await fixture(kind), oldest = serializeWorkspaceEditable(f.editable());
    await f.startCollection(); await f.append(operationalPoint(1)); await f.append(operationalPoint(2, 40.01)); await f.apply();
    const afterFirst = serializeWorkspaceEditable(f.editable());
    await f.startCollection("second"); await f.append(operationalPoint(3, 40.02), "second"); await f.append(operationalPoint(4, 40.03), "second"); await f.apply("second", "second-reference");
    const candidate = f.candidate(), freshSource = readSurveyDesignDocument(kind, candidate.editable!.sourceDocument);
    candidate.editable!.editor.past = [oldest, afterFirst]; candidate.editable!.editor.future = [afterFirst]; candidate.editable!.editor.revision = 5;
    candidate.controller.historyPast = [{ document: oldest, memberships: [] }, { document: afterFirst, memberships: [{ collectionId: "survey", activePointIds: [], state: "applied" }] }];
    const admission = admitted(resolveWorkspaceEditRecovery(candidate, f.workspace()));
    assert.equal(admission.candidate.editable!.editor.past[0], oldest); assert.equal(admission.candidate.editable!.editor.past[1], afterFirst);
    const old = admission.editable!.editor.past[0], metadata = old.drawingMetadata;
    assert.ok(metadata && "retainedReferenceOrigins" in metadata); assert.equal(metadata.retainedReferenceOrigins!.length, 2);
    assert.equal(old.mapFeatures?.some(feature => feature.id === "reference") ?? false, false);
    assert.deepEqual(metadata.retainedReferenceOrigins, freshSource.drawingMetadata && "retainedReferenceOrigins" in freshSource.drawingMetadata ? freshSource.drawingMetadata.retainedReferenceOrigins : null);
    const removed = clone(candidate), payload = readSurveyDesignDocument(kind, removed.editable!.workingDocument);
    payload.mapFeatures = payload.mapFeatures!.filter(feature => feature.id !== "reference"); payload.drawingMetadata!.records = payload.drawingMetadata!.records.filter(record => record.target.kind !== "map_feature" || record.target.id !== "reference");
    removed.editable!.workingDocument = write(kind, payload); assert.equal(resolveWorkspaceEditRecovery(removed, f.workspace()).kind, "ready");
    const forged = clone(candidate), forgedPayload = readSurveyDesignDocument(kind, forged.editable!.workingDocument);
    const record = forgedPayload.drawingMetadata!.records.find(record => record.capture.source === "recorded_survey")! as unknown as { capture: { origin: { receipt: { id: string } } } };
    record.capture.origin.receipt.id = "invented-receipt";
    // Domain validity may refuse earlier; either invalid or source_conflict is a refusal.
    try { forged.editable!.workingDocument = write(kind, forgedPayload); const result = resolveWorkspaceEditRecovery(forged, f.workspace()); assert.ok(result.kind === "invalid" || result.kind === "source_conflict"); }
    catch (error) { assert.ok(error instanceof Error); }
  }
});

test("forged NEW operational observation authority is refused in current, editor history and Survey history, beyond known-payload conflicts", async () => {
  for (const kind of ["draft", "project", "field"] as const) {
    const f = await fixture(kind), candidate = f.candidate(), payload = readSurveyDesignDocument(kind, candidate.editable!.workingDocument);
    payload.surveyPoints = [...payload.surveyPoints, operationalPoint(7, 40.04)];
    const document = write(kind, payload);
    for (const place of ["current", "past", "future", "controllerPast", "controllerFuture"] as const) {
      const forged = clone(candidate);
      if (kind === "draft") forged.editable!.editor.lockedCrs = "EPSG:32613";
      if (place === "current") forged.editable!.workingDocument = document;
      else if (place === "past") forged.editable!.editor.past = [document];
      else if (place === "future") forged.editable!.editor.future = [document];
      else if (place === "controllerPast") forged.controller.historyPast = [{ document, memberships: [] }];
      else forged.controller.historyFuture = [{ document, memberships: [] }];
      const parsed = parseWorkspaceEditRecovery(forged), result = resolveWorkspaceEditRecovery(parsed, f.workspace());
      assert.equal(result.kind, "source_conflict", `${kind} ${place}`); if (result.kind === "source_conflict") assert.match(result.reason, /invent|authority/);
    }
  }
});

test("known observation identities cannot carry forged complete capture freshness or owning capture times in any recovery document", async () => {
  for (const kind of ["draft", "project", "field"] as const) {
    const f = await fixture(kind); await f.startCollection(); await f.append(operationalPoint(1));
    const candidate = f.candidate(), savedPoint = f.collection().observations[0], base = readSurveyDesignDocument(kind, candidate.editable!.workingDocument);
    if (kind === "draft") candidate.editable!.editor.lockedCrs = "EPSG:32613";
    const trustedCopy = clone(savedPoint); trustedCopy.id = "known-observation-copy";
    const authorizedDocument = write(kind, { ...base, surveyPoints: [...base.surveyPoints, trustedCopy] });
    const control = clone(candidate); control.editable!.workingDocument = authorizedDocument;
    assert.equal(resolveWorkspaceEditRecovery(control, f.workspace()).kind, "ready");
    for (const mutation of ["freshness", "capture_time"] as const) {
      const forgedPoint = clone(trustedCopy);
      if (forgedPoint.captureEvidence?.schemaVersion !== "gnss-operational-fixed-v1") throw new Error("Missing operational fixture evidence.");
      if (mutation === "freshness") forgedPoint.captureEvidence.capture = { evaluatedMonotonicMs: 1100, ageMs: 600, maxAgeMs: 2000 };
      else forgedPoint.observedAt = "2026-10-11T12:00:01.000Z";
      const document = write(kind, { ...base, surveyPoints: [...base.surveyPoints, forgedPoint] });
      for (const place of ["current", "past", "future", "controllerPast", "controllerFuture"] as const) {
        const forged = clone(candidate);
        if (place === "current") forged.editable!.workingDocument = document;
        else if (place === "past") forged.editable!.editor.past = [document];
        else if (place === "future") forged.editable!.editor.future = [document];
        else if (place === "controllerPast") forged.controller.historyPast = [{ document, memberships: [] }];
        else forged.controller.historyFuture = [{ document, memberships: [] }];
        const parsed = parseWorkspaceEditRecovery(forged), before = serializeWorkspaceEditRecovery(parsed), result = resolveWorkspaceEditRecovery(parsed, f.workspace());
        assert.equal(result.kind, "source_conflict", `${kind} ${mutation} ${place}`);
        if (result.kind === "source_conflict") assert.match(result.reason, /complete operational capture evidence|capture times/);
        assert.equal(serializeWorkspaceEditRecovery(parsed), before);
      }
    }
  }
});

test("internally valid invented recorded origins and attachments cannot seed their own source authority", async () => {
  for (const kind of ["draft", "project", "field"] as const) {
    const f = await fixture(kind), candidate = f.candidate(), identity = candidate.editable!.identity;
    const point = operationalPoint(1), collection = validateSurveyCollection({ ...createSurveyCollection({ id: "invented-collection", now,
      owner: { designId: "design", documentKind: kind, payloadId: identity.payloadId, fieldMapId: "map", projectCrs: "EPSG:32613" },
      purpose: { kind: "map_feature", featureKind: "reference_point", geometryType: "Point" } }), revision: 1, observations: [point], activePointIds: [point.id] });
    const forgedApplication = applySurveyCollectionToDesign(kind, candidate.editable!.workingDocument, collection, { now, designRevision: 1,
      applicationId: "invented-application", targetId: "invented-reference", reference: { name: "Internally consistent forged reference" } });
    candidate.editable!.workingDocument = forgedApplication.document;
    if (kind === "draft") candidate.editable!.editor.lockedCrs = "EPSG:32613";
    const parsed = parseWorkspaceEditRecovery(candidate), result = resolveWorkspaceEditRecovery(parsed, f.workspace());
    assert.equal(result.kind, "source_conflict"); if (result.kind === "source_conflict") assert.match(result.reason, /exact.*authority/i);
  }
});

test("Layout exact saved session/target anchors and field/CRS camera contexts reject changed targets, sessions and foreign cameras", async () => {
  const f = await fixture("field"); await f.openLayout(); const candidate = f.withLayout();
  const admission = admitted(resolveWorkspaceEditRecovery(candidate, f.workspace())); assert.equal(admission.layout!.session.targetDocument, candidate.layout!.targetDocument);
  const changedSession = clone(f.workspace()); changedSession.layoutSessions![0].document += "\n"; assert.equal(resolveWorkspaceEditRecovery(candidate, validateWorkspaceDocument(changedSession)).kind, "source_conflict");
  const wrongTarget = clone(candidate); wrongTarget.layout!.targetDocument += "\n"; assert.equal(resolveWorkspaceEditRecovery(wrongTarget, f.workspace()).kind, "invalid");
  const wrongReceipt = clone(candidate); wrongReceipt.layout!.revision++; assert.equal(resolveWorkspaceEditRecovery(wrongReceipt, f.workspace()).kind, "invalid");
  const wrongCrs = clone(candidate); wrongCrs.cameras = [{ context: { kind: "field", fieldMapId: "map", projectCrs: "EPSG:32614" }, initialized: true, viewport: { center: { x: 0, y: 0 }, baseWidthMeters: 1000, baseHeightMeters: 1000, zoomLevel: 1 } }];
  assert.equal(resolveWorkspaceEditRecovery(wrongCrs, f.workspace()).kind, "source_conflict");
  const nonfinite = clone(wrongCrs); nonfinite.cameras[0].viewport.center.x = Infinity; assert.equal(resolveWorkspaceEditRecovery(nonfinite, f.workspace()).kind, "invalid");
  const exhausted = clone(wrongCrs); exhausted.cameras[0].viewport.zoomLevel = 0; assert.equal(resolveWorkspaceEditRecovery(exhausted, f.workspace()).kind, "invalid");
});

test("Layout reconciliation advances its workspace persistence receipt while all session and immutable target bytes stay exact", async () => {
  const f = await fixture("field"); await f.openLayout(); const candidate = f.withLayout(), before = serializeWorkspaceEditRecovery(candidate), oldReceipt = candidate.layout!.persistenceRevision;
  await f.execute({ type: "rename_project", projectId: "folder", name: "Unrelated renamed project" });
  const result = resolveWorkspaceEditRecovery(candidate, f.workspace()), admission = admitted(result);
  assert.equal(result.kind, "reconcile_required"); assert.equal(admission.layout!.persistenceRevision, f.workspace().revision);
  assert.equal(admission.staged.layout!.persistenceRevision, f.workspace().revision); assert.equal(admission.staged.workspaceRevision, f.workspace().revision);
  assert.equal(admission.candidate.layout!.persistenceRevision, oldReceipt); assert.equal(admission.layout!.session.revision, candidate.layout!.revision);
  assert.equal(admission.layout!.session.targetDocument, candidate.layout!.targetDocument); assert.equal(admission.layout!.session.targetHash, candidate.layout!.targetHash);
  assert.deepEqual({ ...admission.staged.layout, persistenceRevision: oldReceipt }, candidate.layout);
  assert.equal(serializeWorkspaceEditRecovery(candidate), before);
  assert.equal(resolveWorkspaceEditRecovery(parseWorkspaceEditRecovery(admission.staged), f.workspace()).kind, "ready");
});

test("finite camera components still refuse overflow/underflow visible extents through the actual viewport guard", async () => {
  const f = await fixture(), base = f.candidate();
  for (const viewport of [
    { center: { x: 1.7e308, y: 1.7e308 }, baseWidthMeters: 1.7e308, baseHeightMeters: 1.7e308, zoomLevel: 1 },
    { center: { x: -1.7e308, y: -1.7e308 }, baseWidthMeters: 1.7e308, baseHeightMeters: 1.7e308, zoomLevel: 1 },
    { center: { x: 0, y: 0 }, baseWidthMeters: 1, baseHeightMeters: 1, zoomLevel: Number.MIN_VALUE },
    { center: { x: 0, y: 0 }, baseWidthMeters: Number.MIN_VALUE, baseHeightMeters: Number.MIN_VALUE, zoomLevel: 1e308 },
  ]) {
    const candidate = clone(base); candidate.cameras = [{ context: { kind: "field", fieldMapId: "map", projectCrs: "EPSG:32613" }, initialized: true, viewport }];
    assert.ok([viewport.center.x, viewport.center.y, viewport.baseWidthMeters, viewport.baseHeightMeters, viewport.zoomLevel].every(Number.isFinite));
    assert.equal(viewportForScreen(viewport, { width: 100, height: 100 }), null);
    assert.equal(resolveWorkspaceEditRecovery(candidate, f.workspace()).kind, "invalid");
  }
  const sane = clone(base); sane.cameras = [{ context: { kind: "field", fieldMapId: "map", projectCrs: "EPSG:32613" }, initialized: true,
    viewport: { center: { x: 500000, y: 4400000 }, baseWidthMeters: 1500, baseHeightMeters: 1000, zoomLevel: 2 } }];
  assert.ok(viewportForScreen(sane.cameras[0].viewport, { width: 900, height: 600 })); assert.equal(resolveWorkspaceEditRecovery(sane, f.workspace()).kind, "ready");
});

test("null-CRS empty Draft stays truthful; unmanaged/null receipts remain exportable and explicitly unsupported for active hydration", async () => {
  const f = await fixture("draft", null), candidate = f.candidate();
  assert.equal(admitted(resolveWorkspaceEditRecovery(candidate, f.workspace())).editable!.identity.projectCrs, null);
  const incomplete = clone(candidate); incomplete.workspaceRevision = null; assert.ok(serializeWorkspaceEditRecovery(incomplete)); assert.equal(resolveWorkspaceEditRecovery(incomplete, f.workspace()).kind, "unsupported");
  const independent = clone(candidate); independent.editable!.identity = { ...independent.editable!.identity, clientId: null, projectId: null, fieldMapId: null, designId: null };
  independent.editable!.designRevision = null; independent.context.workspace.design = null; independent.workspaceRevision = null;
  assert.ok(serializeWorkspaceEditRecovery(independent)); assert.equal(resolveWorkspaceEditRecovery(independent, f.workspace()).kind, "unsupported");
});

test("first declared CRS and coordinate-free older Draft history retain exact raw strings and hydrate against current drawing lock", async () => {
  const f = await fixture("draft", null), initial = f.editable();
  const declared = reduceWorkspaceEditable(initial, { kind: "draft", action: { type: "set_crs", projectCrs: "EPSG:32613" } });
  const beforeDrawing = f.candidate(declared), staged = admitted(resolveWorkspaceEditRecovery(beforeDrawing, f.workspace()));
  assert.equal(staged.editable!.identity.projectCrs, "EPSG:32613"); assert.equal(staged.candidate.editable!.editor.past[0], serializeWorkspaceEditable(initial));
  const drawn = reduceWorkspaceEditableBatch(declared, [{ kind: "draft", action: { type: "drawing", expectedRevision: 1, command: { type: "begin", id: "capture", geometryType: "LineString", name: "Pending" } } },
    { kind: "draft", action: { type: "drawing", expectedRevision: 1, command: { type: "append_vertex", id: "capture", vertex: { point: { x: 1, y: 2 }, recordedAt: now, wgs84: null, elevation: null } } } }]);
  const candidate = f.candidate(drawn); candidate.controller.historyPast = [{ document: serializeWorkspaceEditable(initial), memberships: [] }];
  const admission = admitted(resolveWorkspaceEditRecovery(candidate, f.workspace())); assert.equal(admission.candidate.editable!.editor.past[0], serializeWorkspaceEditable(initial));
  const oldest = admission.editable!.editor.past[0]; assert.equal(oldest.projectCrs, "EPSG:32613"); assert.ok("drawingWorkflow" in oldest); assert.equal(oldest.drawingWorkflow!.lockedCrs, "EPSG:32613");
  const undo = reduceWorkspaceEditable(admission.editable!, { kind: "draft", action: { type: "undo" } }); assert.equal(undo.editor.lastError, null);
  const foreign = clone(candidate), payload = readSurveyDesignDocument("draft", foreign.editable!.editor.past[0]); payload.projectCrs = "EPSG:32614";
  foreign.editable!.editor.past[0] = serializeDesignDraftDocument(payload); assert.equal(resolveWorkspaceEditRecovery(foreign, f.workspace()).kind, "invalid");
});

test("fresh workspace validation cannot invoke accessors, resolver is pure and legacy resume helper bytes are unchanged", async () => {
  const f = await fixture(), candidate = f.candidate(); let calls = 0;
  const workspace = clone(f.workspace()); Object.defineProperty(workspace, "catalog", { enumerable: true, get() { calls++; return f.workspace().catalog; } });
  assert.equal(resolveWorkspaceEditRecovery(candidate, workspace).kind, "invalid"); assert.equal(calls, 0);
  const legacy = readFileSync(new URL("../navigation/unifiedWorkspaceResume.ts", import.meta.url)), before = createHash("sha256").update(legacy).digest("hex");
  const nativeGetter = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try { Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { calls++; throw new Error("No browser effects allowed."); } });
    assert.equal(resolveWorkspaceEditRecovery(candidate, f.workspace()).kind, "ready"); assert.equal(calls, 0);
  } finally { if (nativeGetter) Object.defineProperty(globalThis, "localStorage", nativeGetter); else delete (globalThis as { localStorage?: unknown }).localStorage; }
  assert.equal(createHash("sha256").update(readFileSync(new URL("../navigation/unifiedWorkspaceResume.ts", import.meta.url))).digest("hex"), before);
});
