import assert from "node:assert/strict";
import test from "node:test";
import { captureWorkspaceOperationOwner, createWorkspacePresentation, initialWorkspaceMode,
  isWorkspaceOperationCurrent, renewWorkspaceDocumentGeneration, replaceWorkspaceDocument, selectWorkspaceMode, workspaceCameraIdentity } from "./workspacePresentation";

const document = { clientId: "customer", projectId: "project", fieldMapId: "field", designId: "design",
  payloadId: "payload", kind: "draft" as const, projectCrs: null };

test("mode cycles preserve document and camera identity while retiring interaction callbacks", () => {
  const initial = createWorkspacePresentation(document);
  const documentOwner = captureWorkspaceOperationOwner(initial, "document");
  const pointerOwner = captureWorkspaceOperationOwner(initial, "interaction");
  const survey = selectWorkspaceMode(initial, "survey");
  const layout = selectWorkspaceMode(survey, "layout");
  const returned = selectWorkspaceMode(layout, "design");
  for (const state of [survey, layout, returned]) {
    assert.equal(state.document, initial.document);
    assert.equal(state.documentGeneration, initial.documentGeneration);
    assert.equal(workspaceCameraIdentity(state), workspaceCameraIdentity(initial));
    assert.equal(isWorkspaceOperationCurrent(state, documentOwner), true);
    assert.equal(isWorkspaceOperationCurrent(state, pointerOwner), false);
  }
  assert.equal(returned.interactionGeneration, 3);
  assert.equal(initial.interactionGeneration, 0);
});

test("same-mode choice is a no-op and does not retire accepted operation identity", () => {
  const state = createWorkspacePresentation(document, "survey");
  const owner = captureWorkspaceOperationOwner(state, "interaction");
  assert.equal(selectWorkspaceMode(state, "survey"), state);
  assert.equal(isWorkspaceOperationCurrent(state, owner), true);
});

test("document replacement refuses missing, dirty or busy preservation guards", () => {
  const state = createWorkspacePresentation(document);
  const other = { ...document, designId: "other", payloadId: "other-payload" };
  for (const guard of [null, { dirty: true, busy: false }, { dirty: false, busy: true }]) {
    assert.throws(() => replaceWorkspaceDocument(state, other, guard), /preserve/);
    assert.equal(state.document?.designId, "design");
  }
});

test("explicit replacement and away/back context changes retire every old owner", () => {
  const state = createWorkspacePresentation(document, "survey");
  const owners = [captureWorkspaceOperationOwner(state, "document"), captureWorkspaceOperationOwner(state, "interaction")];
  const other = replaceWorkspaceDocument(state, { ...document, fieldMapId: "other-field", designId: "other" }, { dirty: false, busy: false });
  assert.equal(other.mode, "survey");
  assert.notEqual(workspaceCameraIdentity(other), workspaceCameraIdentity(state));
  const returned = replaceWorkspaceDocument(other, document, { dirty: false, busy: false });
  for (const owner of owners) assert.equal(isWorkspaceOperationCurrent(returned, owner), false);
  assert.equal(returned.documentGeneration, 2);
});

test("identity snapshots do not alias mutable caller context and keys cannot collide", () => {
  const input = { ...document };
  const state = createWorkspacePresentation(input);
  input.fieldMapId = "mutated";
  assert.equal(state.document?.fieldMapId, "field");
  assert.equal(Object.isFrozen(state.document), true);
  const a = createWorkspacePresentation({ ...document, fieldMapId: "a:b", projectCrs: "c" });
  const b = createWorkspacePresentation({ ...document, fieldMapId: "a", projectCrs: "b:c" });
  assert.notEqual(workspaceCameraIdentity(a), workspaceCameraIdentity(b));
});

test("independent imported documents retain null catalog identity and distinct real payload cameras", () => {
  const independent = { ...document, clientId: null, projectId: null, fieldMapId: null, designId: null };
  const state = createWorkspacePresentation(independent);
  assert.equal(state.document?.fieldMapId, null);
  assert.equal(state.document?.payloadId, "payload");
  assert.throws(() => createWorkspacePresentation({ ...independent, designId: "fake-association" }), /association/);
  const other = replaceWorkspaceDocument(state, { ...independent, payloadId: "other-import" }, { dirty: false, busy: false });
  assert.notEqual(workspaceCameraIdentity(other), workspaceCameraIdentity(state));
  assert.equal(other.document?.clientId, null);
});

test("legacy Inspect map setting never manufactures a Layout resume session", () => {
  assert.equal(initialWorkspaceMode(undefined, "layout"), "design");
  assert.equal(initialWorkspaceMode("map", "layout"), "design");
  assert.equal(initialWorkspaceMode("layout", "design"), "layout");
  assert.equal(initialWorkspaceMode("survey"), "survey");
});

test("same-ID content reload retires callbacks without resetting field camera or mode", () => {
  const state = createWorkspacePresentation(document, "survey");
  const owner = captureWorkspaceOperationOwner(state, "document");
  assert.equal(replaceWorkspaceDocument(state, document, null), state);
  for (const guard of [null, { dirty: true, busy: false }, { dirty: false, busy: true }]) {
    assert.throws(() => renewWorkspaceDocumentGeneration(state, guard), /preserve/);
  }
  const reloaded = renewWorkspaceDocumentGeneration(state, { dirty: false, busy: false });
  assert.equal(isWorkspaceOperationCurrent(reloaded, owner), false);
  assert.equal(reloaded.document, state.document);
  assert.equal(reloaded.mode, state.mode);
  assert.equal(workspaceCameraIdentity(reloaded), workspaceCameraIdentity(state));
  assert.throws(() => renewWorkspaceDocumentGeneration(createWorkspacePresentation(null), { dirty: false, busy: false }), /Open/);
});

test("each identity field retires document operations; only field or CRS changes camera identity", () => {
  const state = createWorkspacePresentation(document);
  const owner = captureWorkspaceOperationOwner(state, "document");
  const changes = { clientId: "other-customer", projectId: "other-project", fieldMapId: "other-field",
    designId: "other-design", payloadId: "other-payload", kind: "field", projectCrs: "EPSG:32614" };
  for (const [key, value] of Object.entries(changes)) {
    const next = replaceWorkspaceDocument(state, { ...document, [key]: value } as typeof document, { dirty: false, busy: false });
    assert.equal(isWorkspaceOperationCurrent(next, owner), false, key);
    assert.equal(workspaceCameraIdentity(next) === workspaceCameraIdentity(state), key !== "fieldMapId" && key !== "projectCrs", key);
  }
});

test("invalid identities, modes and ownership counter exhaustion fail explicitly", () => {
  assert.throws(() => createWorkspacePresentation({ ...document, projectCrs: " " }), /CRS/);
  assert.throws(() => createWorkspacePresentation({ ...document, payloadId: "" }), /payloadId/);
  const state = createWorkspacePresentation(document);
  assert.throws(() => selectWorkspaceMode(state, "other" as never), /mode/);
  assert.throws(() => selectWorkspaceMode({ ...state, interactionGeneration: Number.MAX_SAFE_INTEGER }, "survey"), /exhausted/);
  for (const key of ["documentGeneration", "interactionGeneration", "cameraGeneration"] as const) {
    assert.throws(() => replaceWorkspaceDocument({ ...state, [key]: Number.MAX_SAFE_INTEGER },
      { ...document, fieldMapId: "other-field" }, { dirty: false, busy: false }), /exhausted/, key);
  }
});
