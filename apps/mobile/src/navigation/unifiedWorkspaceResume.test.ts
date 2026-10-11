import assert from "node:assert/strict";
import test from "node:test";
import { convertPivotProjectToFieldDesign, createFieldLayoutTarget, createSurveyCollection, defaultProjectSettings,
  parseLayoutSessionDocument, sampleProject, serializeFieldLayoutTarget, serializeProjectDocument, type DesignDraft } from "@cplayout/core";
import { createVersionedProjectRepository, readWorkspaceDesign } from "../../../../packages/project-store/src/versionedProjectRepository";
import type { WorkspaceCommand } from "../../../../packages/project-store/src/workspaceCommands";
import { WEB_WORKSPACE_KEY } from "../../../../packages/project-store/src/webWorkspaceStore";
import { readWorkspaceResume, writeWorkspaceResume } from "./workspaceResume";
import { UNIFIED_WORKSPACE_RESUME_KEY, parseUnifiedWorkspaceResume, readUnifiedWorkspaceResume, writeUnifiedWorkspaceResume,
  resolveUnifiedWorkspaceResume, type UnifiedWorkspaceResume } from "./unifiedWorkspaceResume";

const now = "2026-10-11T12:00:00.000Z";
const empty = (): UnifiedWorkspaceResume => ({ version: 2, catalogVisible: true,
  catalogSelection: { clientId: null, projectId: null, fieldMapId: null, designId: null },
  workspace: { mode: "design", design: null, layout: null, collectionId: null } });
function clone<T>(value: T): T { return structuredClone(value); }
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function draft(id: string, projectCrs: string | null = "EPSG:32613"): DesignDraft {
  const settings = defaultProjectSettings();
  return { id, name: id, projectCrs, unitSystem: settings.unitSystem, settings, fieldBoundary: [], pivotCenter: null,
    waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
}
async function fixture() {
  const values = new Map<string, string>(); let preferenceFailure = false;
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { if (preferenceFailure && key === UNIFIED_WORKSPACE_RESUME_KEY) throw new Error("Synthetic preference quota"); values.set(key, value); } };
  const api = createVersionedProjectRepository({ getStorage: () => storage,
    getLocks: () => ({ request: async (_name, _options, run) => run() }) }).versionedWorkspace!;
  let workspace = await api.readAsync();
  async function execute(command: unknown) {
    const result = await api.executeAsync(workspace.revision, { now, ...command as object } as WorkspaceCommand);
    workspace = result.workspace; return result;
  }
  for (const id of ["customer", "other-customer"]) await execute({ type: "create_client", id, input: { primaryContactFirstName: id, primaryContactLastName: "Owner" } });
  for (const [projectId, clientId, fieldMapId, projectCrs] of [
    ["folder", "customer", "field", "EPSG:32613"], ["other-folder", "other-customer", "other-field", "EPSG:32613"],
    ["foreign-folder", "customer", "foreign-field", "EPSG:32614"],
  ]) await execute({ type: "create_project_with_initial_field_map", input: { clientId, projectId, fieldMapId,
    projectName: "Equal project name", fieldMapName: "Equal field name", projectCrs, unitSystem: "metric" } });
  for (const [designId, fieldMapId, payload] of [["draft-design", "field", draft("draft")], ["null-design", "field", draft("null-draft", null)], ["other-design", "other-field", draft("other-draft")]] as const) {
    await execute({ type: "create_design_draft", designId, fieldMapId, name: payload.name, draft: payload });
  }
  await execute({ type: "create_project_with_initial_design", input: { clientId: "customer", project: { ...clone(sampleProject), id: "project-payload" },
    fieldMapId: "project-field", designId: "project-design" } });
  await execute({ type: "upgrade_workspace_to_v2" });
  const originalProjectDocument = `\n${serializeProjectDocument(sampleProject)}\n`;
  const field = convertPivotProjectToFieldDesign(originalProjectDocument, { fieldId: "field-payload", waterSourceId: "water", powerSourceId: "power" }).field;
  await execute({ type: "create_field_design", designId: "field-design", fieldMapId: "field", name: field.name, field, originalProjectDocument });
  await execute({ type: "upgrade_workspace_to_v3" });
  const targetDocument = serializeFieldLayoutTarget(createFieldLayoutTarget(field, { inputRevision: 0, expectedRevision: 0, selectedMachineIds: [field.machines[0].id] }));
  for (const [sessionId, fieldMapId] of [["session", "field"], ["other-session", "other-field"], ["foreign-session", "foreign-field"], ["project-session", "project-field"]]) {
    await execute({ type: "create_layout_session", sessionId, fieldMapId, name: "Layout", targetDocument });
  }
  await execute({ type: "upgrade_workspace_to_v4" });
  for (const [id, designId, payloadId, fieldMapId] of [["collection", "draft-design", "draft", "field"], ["other-collection", "other-design", "other-draft", "other-field"]]) {
    const collection = createSurveyCollection({ id, now, purpose: { kind: "map_feature", featureKind: "reference_point", geometryType: "Point" },
      owner: { designId, documentKind: "draft", payloadId, fieldMapId, projectCrs: "EPSG:32613" } });
    await execute({ type: "create_survey_collection", expectedDesignRevision: 0, collection });
  }
  await execute({ type: "create_survey_collection", expectedDesignRevision: 0, collection: createSurveyCollection({ id: "field-collection", now,
    purpose: { kind: "map_feature", featureKind: "reference_point", geometryType: "Point" },
    owner: { designId: "field-design", documentKind: "field", payloadId: "field-payload", fieldMapId: "field", projectCrs: "EPSG:32613" } }) });
  function designHint(designId = "draft-design"): UnifiedWorkspaceResume {
    const read = readWorkspaceDesign(workspace, designId); assert.notEqual(read.kind, "not_found");
    if (read.kind === "not_found") throw new Error("Missing fixture design.");
    const payload = read.kind === "project" ? read.project : read.kind === "draft" ? read.draft : read.field;
    return { ...empty(), catalogVisible: false, catalogSelection: read.context, workspace: { mode: "design", collectionId: null, layout: null,
      design: { designId, documentKind: read.kind, payloadId: payload.id, fieldMapId: read.context.fieldMapId, projectCrs: payload.projectCrs } } };
  }
  function layoutHint(sessionId = "session"): NonNullable<UnifiedWorkspaceResume["workspace"]["layout"]> {
    const session = parseLayoutSessionDocument(workspace.layoutSessions!.find(entry => entry.id === sessionId)!.document);
    return { sessionId, fieldMapId: session.fieldMapId, projectCrs: "EPSG:32613", targetHash: session.targetHash };
  }
  return { workspace: () => workspace, values, storage, execute, designHint, layoutHint, originalProjectDocument,
    failPreference: () => { preferenceFailure = true; } };
}

test("v2 hint parses exact declared data, rejects arrays/unknown/missing/control fields, and allows truthful Draft CRS null", () => {
  const hint = empty(); hint.workspace.design = { designId: "design", documentKind: "draft", payloadId: "payload", fieldMapId: "field", projectCrs: null };
  assert.deepEqual(parseUnifiedWorkspaceResume(hint), hint); assert.notStrictEqual(parseUnifiedWorkspaceResume(hint), hint);
  const invalid: unknown[] = [[], null, { ...hint, version: 1 }, { ...hint, connection: "connected" }, { ...hint, catalogSelection: [] },
    { ...hint, workspace: { ...hint.workspace, camera: {} } }, { ...hint, workspace: { ...hint.workspace, design: [] } },
    { ...hint, workspace: { ...hint.workspace, design: { ...hint.workspace.design, documentKind: "field" } } },
    { ...hint, workspace: { ...hint.workspace, design: { ...hint.workspace.design, payloadId: "\u0085hidden" } } },
    { ...hint, workspace: { ...hint.workspace, design: { ...hint.workspace.design, designId: "\tbad" } } },
    { ...hint, catalogSelection: { clientId: null, projectId: "folder", fieldMapId: null, designId: null } },
    { ...empty(), workspace: { ...empty().workspace, collectionId: "collection" } },
    { ...hint, workspace: { ...hint.workspace, layout: { sessionId: "session", fieldMapId: "field", projectCrs: "EPSG:32613", targetHash: "A".repeat(64) } } },
  ];
  const missing = clone(hint) as Partial<UnifiedWorkspaceResume>; delete missing.catalogVisible; invalid.push(missing);
  for (const value of invalid) assert.throws(() => parseUnifiedWorkspaceResume(value));
  assert.throws(() => parseUnifiedWorkspaceResume('{"version":2,"version":2}'), /duplicate/i);
  assert.throws(() => parseUnifiedWorkspaceResume(JSON.stringify(hint).replace('"version":2', '"version":2,/*comment*/')));
});

test("hint limits count UTF-8 bytes and bounded ID/CRS strings, preserve exact text, and never execute accessors/hooks", () => {
  const hint = empty(); hint.catalogSelection.clientId = "x".repeat(256); assert.equal(parseUnifiedWorkspaceResume(hint).catalogSelection.clientId!.length, 256);
  hint.catalogSelection.clientId += "x"; assert.throws(() => parseUnifiedWorkspaceResume(hint));
  const json = JSON.stringify(empty()), fitting = " ".repeat(8192 - json.length) + json;
  assert.deepEqual(parseUnifiedWorkspaceResume(fitting), empty()); assert.throws(() => parseUnifiedWorkspaceResume(` ${fitting}`), /limit/i);
  const multibyte = empty();
  const id = "界".repeat(256); multibyte.catalogSelection = { clientId: id, projectId: id, fieldMapId: id, designId: id };
  multibyte.workspace.design = { designId: id, documentKind: "draft", payloadId: id, fieldMapId: id, projectCrs: id };
  multibyte.workspace.layout = { sessionId: id, fieldMapId: id, projectCrs: id, targetHash: "a".repeat(64) };
  assert.ok(JSON.stringify(multibyte).length < 8192); assert.ok(new TextEncoder().encode(JSON.stringify(multibyte)).length > 8192);
  assert.throws(() => parseUnifiedWorkspaceResume(multibyte), /limit/i);
  const surrogate = empty(); surrogate.catalogSelection.clientId = "\ud800"; assert.throws(() => parseUnifiedWorkspaceResume(surrogate));
  let calls = 0; const accessor = clone(empty()); Object.defineProperty(accessor, "workspace", { enumerable: true, get() { calls++; return empty().workspace; } });
  assert.throws(() => parseUnifiedWorkspaceResume(accessor)); assert.equal(calls, 0);
  const hooked = { ...empty(), toJSON() { calls++; return empty(); } }; assert.throws(() => parseUnifiedWorkspaceResume(hooked)); assert.equal(calls, 0);
});

test("read/write results isolate optional preference failures and retain exact raw source strings", () => {
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.deepEqual(readUnifiedWorkspaceResume(storage), { kind: "absent" });
  const raw = ` \n${JSON.stringify(empty(), null, 2)}\n `; values.set(UNIFIED_WORKSPACE_RESUME_KEY, raw);
  const read = readUnifiedWorkspaceResume(storage); assert.equal(read.kind, "success"); if (read.kind === "success") { assert.equal(read.raw, raw); assert.deepEqual(read.hint, empty()); }
  const written = writeUnifiedWorkspaceResume(empty(), storage); assert.equal(written.kind, "success"); if (written.kind === "success") assert.equal(values.get(UNIFIED_WORKSPACE_RESUME_KEY), written.raw);
  values.set(UNIFIED_WORKSPACE_RESUME_KEY, "broken"); assert.deepEqual(readUnifiedWorkspaceResume(storage), { kind: "invalid" });
  const fail = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } };
  assert.deepEqual(readUnifiedWorkspaceResume(fail), { kind: "unavailable" }); assert.deepEqual(writeUnifiedWorkspaceResume(empty(), fail), { kind: "unavailable" });
  assert.deepEqual(writeUnifiedWorkspaceResume({ ...empty(), version: 9 } as never, fail), { kind: "invalid" });
  assert.deepEqual(readUnifiedWorkspaceResume(null), { kind: "unavailable" }); assert.deepEqual(writeUnifiedWorkspaceResume(empty(), null), { kind: "unavailable" });
});

test("default storage getter failures never throw and v1 saved bytes and APIs stay separate", () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "localStorage"), values = new Map<string, string>();
  try {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } } });
    const v1 = { version: 1 as const, context: empty().catalogSelection, editorOpen: true, view: "map" as const };
    writeWorkspaceResume(v1); const oldBytes = values.get("cplayout-desktop-context-v1");
    assert.deepEqual(writeUnifiedWorkspaceResume(empty()).kind, "success"); assert.equal(values.get("cplayout-desktop-context-v1"), oldBytes); assert.deepEqual(readWorkspaceResume(), v1);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    assert.deepEqual(readUnifiedWorkspaceResume(), { kind: "unavailable" }); assert.deepEqual(writeUnifiedWorkspaceResume(empty()), { kind: "unavailable" });
  } finally { if (prior) Object.defineProperty(globalThis, "localStorage", prior); else delete (globalThis as { localStorage?: unknown }).localStorage; }
});

test("resolver admits actual Draft, Project and Field payload identities, full lineage, source bytes and truthful nullable Draft CRS", async () => {
  const f = await fixture(), before = JSON.stringify(f.workspace());
  for (const designId of ["draft-design", "project-design", "field-design", "null-design"]) {
    const hint = f.designHint(designId), result = resolveUnifiedWorkspaceResume(hint, freeze(f.workspace()));
    assert.equal(result.designRead?.design.id, designId); assert.deepEqual(result.catalogSelection, hint.catalogSelection);
    assert.deepEqual(result.reasons, []); assert.equal(result.catalogVisible, false); assert.equal(result.mode, "design");
    if (designId === "field-design") assert.equal(result.designRead?.kind === "field" && result.designRead.originalProjectDocument, f.originalProjectDocument);
    if (designId === "null-design") assert.equal(result.designRead?.kind === "draft" && result.designRead.draft.projectCrs, null);
  }
  assert.equal(JSON.stringify(f.workspace()), before);
});

test("resolver preserves explicit modes including Layout without session and empty-catalog Survey", async () => {
  const f = await fixture(), hint = f.designHint("field-design"); hint.workspace.mode = "layout";
  const layoutCreation = resolveUnifiedWorkspaceResume(hint, f.workspace());
  assert.equal(layoutCreation.mode, "layout"); assert.equal(layoutCreation.layoutSession, null); assert.equal(layoutCreation.designRead?.kind, "field"); assert.equal(layoutCreation.catalogVisible, false);
  const survey = empty(); survey.workspace.mode = "survey"; survey.catalogVisible = false;
  const catalog = resolveUnifiedWorkspaceResume(survey, f.workspace()); assert.equal(catalog.mode, "survey"); assert.equal(catalog.catalogVisible, true); assert.equal(catalog.designRead, null);
  const targetOnly = empty(); targetOnly.workspace.mode = "design"; targetOnly.catalogVisible = false; targetOnly.workspace.layout = f.layoutHint();
  const designWithTarget = resolveUnifiedWorkspaceResume(targetOnly, f.workspace()); assert.equal(designWithTarget.mode, "design"); assert.equal(designWithTarget.designRead, null);
  assert.equal(designWithTarget.layoutSession?.id, "session"); assert.equal(designWithTarget.catalogVisible, true);
});

test("both subjects coexist only at actual matching field and CRS; incompatible pair keeps requested-mode subject", async () => {
  const f = await fixture();
  const hint = f.designHint(); hint.workspace.layout = f.layoutHint();
  const aligned = resolveUnifiedWorkspaceResume(hint, f.workspace()); assert.equal(aligned.designRead?.design.id, "draft-design"); assert.equal(aligned.layoutSession?.id, "session");
  hint.workspace.layout = f.layoutHint("other-session");
  for (const mode of ["design", "survey", "layout"] as const) {
    hint.workspace.mode = mode; const result = resolveUnifiedWorkspaceResume(hint, f.workspace());
    assert.equal(result.mode, mode); assert.ok(result.reasons.includes("subjects_conflict"));
    assert.equal(result.designRead?.design.id ?? null, mode === "layout" ? null : "draft-design");
    assert.equal(result.layoutSession?.id ?? null, mode === "layout" ? "other-session" : null);
  }
  const unknownCrs = f.designHint("null-design"); unknownCrs.workspace.layout = f.layoutHint(); unknownCrs.workspace.mode = "layout";
  const result = resolveUnifiedWorkspaceResume(unknownCrs, f.workspace()); assert.equal(result.designRead, null); assert.equal(result.layoutSession?.id, "session"); assert.ok(result.reasons.includes("subjects_conflict"));
});

test("target-only and archived Layout sessions retain literal target hashes and cannot fabricate an editable owner", async () => {
  const f = await fixture(), hint = empty(); hint.workspace.mode = "layout"; hint.catalogVisible = false; hint.workspace.layout = f.layoutHint();
  await f.execute({ type: "archive_layout_session", sessionId: "session", expectedSessionRevision: 0, archived: true });
  const original = parseLayoutSessionDocument(f.workspace().layoutSessions!.find(entry => entry.id === "session")!.document), result = resolveUnifiedWorkspaceResume(hint, f.workspace());
  assert.equal(result.designRead, null); assert.equal(result.layoutSession?.archived, true); assert.equal(result.mode, "layout"); assert.equal(result.catalogVisible, false);
  assert.equal(result.layoutSession?.targetDocument, original.targetDocument); assert.equal(result.layoutSession?.targetHash, original.targetHash);
  assert.deepEqual(result.collections, []); assert.equal(result.selectedCollectionId, null);
  assert.deepEqual(result.catalogSelection, empty().catalogSelection);
});

test("missing, replaced, foreign-CRS and foreign-owner pointers clear selection while valid ancestors remain reachable", async () => {
  const f = await fixture(), base = f.designHint();
  for (const change of [{ designId: "deleted-design" }, { payloadId: "replacement-payload" }, { documentKind: "field" as const }, { fieldMapId: "other-field" }, { projectCrs: "EPSG:32614" }]) {
    const hint = clone(base); Object.assign(hint.workspace.design!, change);
    const result = resolveUnifiedWorkspaceResume(hint, f.workspace()); assert.equal(result.designRead, null); assert.equal(result.catalogVisible, true); assert.ok(result.reasons.length);
  }
  const missing = clone(base); missing.catalogSelection.designId = "deleted-design"; missing.workspace.design!.designId = "deleted-design";
  const ancestors = resolveUnifiedWorkspaceResume(missing, f.workspace()); assert.deepEqual(ancestors.catalogSelection, { ...base.catalogSelection, designId: null });
  const foreign = clone(base); foreign.catalogSelection.clientId = "other-customer";
  assert.deepEqual(resolveUnifiedWorkspaceResume(foreign, f.workspace()).catalogSelection, { clientId: "other-customer", projectId: null, fieldMapId: null, designId: null });
  const layout = empty(); layout.workspace.mode = "layout"; layout.catalogVisible = false; layout.workspace.layout = f.layoutHint();
  for (const change of [{ sessionId: "deleted" }, { fieldMapId: "other-field" }, { targetHash: "a".repeat(64) }, { projectCrs: "EPSG:32614" }]) {
    const hint = clone(layout); Object.assign(hint.workspace.layout!, change); const result = resolveUnifiedWorkspaceResume(hint, f.workspace()); assert.equal(result.layoutSession, null); assert.equal(result.catalogVisible, true); assert.equal(result.mode, "layout");
  }
  layout.workspace.layout = f.layoutHint("foreign-session"); const mismatchedParent = resolveUnifiedWorkspaceResume(layout, f.workspace()); assert.equal(mismatchedParent.layoutSession, null); assert.ok(mismatchedParent.reasons.includes("layout_crs_mismatch"));
});

test("Survey resume returns only complete admitted owner collections and never selects a foreign or missing collection", async () => {
  const f = await fixture(), hint = f.designHint(); hint.workspace.mode = "survey"; hint.workspace.collectionId = "collection";
  const result = resolveUnifiedWorkspaceResume(hint, f.workspace()); assert.deepEqual(result.collections.map(collection => collection.id), ["collection"]); assert.equal(result.selectedCollectionId, "collection");
  hint.workspace.collectionId = "field-collection"; const sameFieldForeignOwner = resolveUnifiedWorkspaceResume(hint, f.workspace());
  assert.equal(sameFieldForeignOwner.selectedCollectionId, null); assert.deepEqual(sameFieldForeignOwner.collections.map(collection => collection.id), ["collection"]);
  assert.ok(sameFieldForeignOwner.reasons.includes("collection_owner_mismatch"));
  hint.workspace.collectionId = "other-collection"; const foreign = resolveUnifiedWorkspaceResume(hint, f.workspace()); assert.equal(foreign.selectedCollectionId, null); assert.ok(foreign.reasons.includes("collection_owner_mismatch"));
  hint.workspace.collectionId = "missing"; const missing = resolveUnifiedWorkspaceResume(hint, f.workspace()); assert.equal(missing.selectedCollectionId, null); assert.ok(missing.reasons.includes("collection_not_found"));
  hint.workspace.layout = f.layoutHint("other-session"); hint.workspace.mode = "layout"; const discardedDesign = resolveUnifiedWorkspaceResume(hint, f.workspace()); assert.equal(discardedDesign.designRead, null); assert.deepEqual(discardedDesign.collections, []); assert.equal(discardedDesign.selectedCollectionId, null);
});

test("invalid durable workspace or malformed hint returns reachable catalog without changing any actual source or storage", async () => {
  const f = await fixture(), hint = f.designHint(), before = JSON.stringify(f.workspace()), bytes = f.values.get(WEB_WORKSPACE_KEY);
  const invalid = clone(f.workspace()); invalid.draftDocuments[0].document = '{"documentVersion":"design-draft-v999","draft":{}}';
  hint.workspace.mode = "layout";
  const result = resolveUnifiedWorkspaceResume(hint, invalid); assert.equal(result.mode, "layout"); assert.equal(result.catalogVisible, true); assert.equal(result.designRead, null); assert.deepEqual(result.reasons, ["invalid_workspace"]);
  const invalidHint = resolveUnifiedWorkspaceResume({ ...hint, rawInput: "Do not retain" } as never, f.workspace()); assert.deepEqual(invalidHint.reasons, ["invalid_hint"]);
  assert.equal(JSON.stringify(f.workspace()), before); assert.equal(f.values.get(WEB_WORKSPACE_KEY), bytes);
});

test("preference quota failure cannot invalidate a real acknowledged repository save", async () => {
  const f = await fixture(), hint = f.designHint();
  const read = readWorkspaceDesign(f.workspace(), "draft-design"); assert.equal(read.kind, "draft"); if (read.kind !== "draft") throw new Error("Missing Draft fixture.");
  const acknowledged = await f.execute({ type: "save_design_draft", designId: "draft-design", expectedDesignRevision: read.design.revision, draft: { ...read.draft, name: "Acknowledged domain save" } });
  const acceptedBytes = f.values.get(WEB_WORKSPACE_KEY); f.failPreference();
  assert.deepEqual(writeUnifiedWorkspaceResume(hint, f.storage), { kind: "unavailable" });
  assert.equal(f.values.get(WEB_WORKSPACE_KEY), acceptedBytes); assert.equal((await f.workspace()).revision, acknowledged.workspace.revision);
  const reopened = await readWorkspaceDesign(f.workspace(), "draft-design"); assert.equal(reopened.kind === "draft" && reopened.draft.name, "Acknowledged domain save");
});

test("storage values must be raw source strings", () => {
  const unexpectedStorage = { getItem: () => empty() as never, setItem: () => undefined };
  assert.deepEqual(readUnifiedWorkspaceResume(unexpectedStorage), { kind: "invalid" });
});

test("legacy opaque payloads refused by the editable reader fall back to reachable ancestors", async () => {
  const f = await fixture(), workspace = clone(f.workspace()), hint = f.designHint("project-design");
  const entry = workspace.projectDocuments.find(item => item.summary.id === "project-payload")!;
  const raw = JSON.parse(entry.document); raw.project.privateExtension = { unsupportedCalibration: "Retain opaque legacy source" };
  entry.document = JSON.stringify(raw); const bytes = entry.document, before = JSON.stringify(workspace);
  assert.throws(() => readWorkspaceDesign(workspace, "project-design"), /unsupported|loss|retai|field/i);
  const result = resolveUnifiedWorkspaceResume(hint, workspace);
  assert.equal(result.designRead, null); assert.equal(result.catalogVisible, true); assert.deepEqual(result.catalogSelection, hint.catalogSelection);
  assert.ok(result.reasons.includes("design_unsupported"));
  assert.equal(entry.document, bytes); assert.equal(JSON.stringify(workspace), before);
});

test("actual archived-owner deletion retires resume pointers while preserving reachable ancestors and the durable observation ledger", async () => {
  const f = await fixture(), hint = f.designHint(); hint.workspace.mode = "survey"; hint.workspace.collectionId = "collection";
  await f.execute({ type: "archive_and_delete_design", designId: "draft-design", expectedDesignRevision: 0,
    collectionIds: [{ id: "collection", expectedRevision: 0 }] });
  const before = JSON.stringify(f.workspace()), bytes = f.values.get(WEB_WORKSPACE_KEY), result = resolveUnifiedWorkspaceResume(hint, f.workspace());
  assert.equal(result.designRead, null); assert.deepEqual(result.collections, []); assert.equal(result.selectedCollectionId, null);
  assert.equal(result.mode, "survey"); assert.equal(result.catalogVisible, true);
  assert.deepEqual(result.catalogSelection, { ...hint.catalogSelection, designId: null });
  assert.ok(f.workspace().surveyOwnerArchives!.some(archive => archive.design.id === "draft-design"));
  assert.ok(f.workspace().surveyCollections!.some(entry => entry.id === "collection"));
  assert.equal(JSON.stringify(f.workspace()), before); assert.equal(f.values.get(WEB_WORKSPACE_KEY), bytes);
});

test("Project and Field subjects can retain an explicitly associated frozen Layout session at matching actual field and CRS", async () => {
  const f = await fixture();
  for (const [designId, sessionId] of [["project-design", "project-session"], ["field-design", "session"]]) {
    const hint = f.designHint(designId); hint.workspace.mode = "layout"; hint.workspace.layout = f.layoutHint(sessionId);
    const result = resolveUnifiedWorkspaceResume(hint, f.workspace());
    assert.equal(result.designRead?.design.id, designId); assert.equal(result.layoutSession?.id, sessionId);
    assert.equal(result.mode, "layout"); assert.equal(result.catalogVisible, false); assert.deepEqual(result.reasons, []);
  }
});
