import assert from "node:assert/strict";
import test from "node:test";

import { defaultProjectSettings, parseDesignDraftDocument, sampleProject, serializeDesignDraftDocument, serializeProjectDocument, type DesignDraft } from "@cplayout/core";
import { emptyClientProfileFields } from "./projectCatalog";
import {
  createWorkspaceDesign, deleteWorkspaceDesign, emptyWorkspaceDocument, parseWorkspaceDocument,
  saveWorkspaceDesign, serializeWorkspaceDocument, validateWorkspaceDocument, WorkspaceDocumentError,
  type WorkspaceDesignRecord, type WorkspaceDocument, type WorkspaceDocumentErrorCode,
} from "./workspaceDocument";

const now = "2026-09-16T12:00:00.000Z";
const later = "2026-09-16T12:01:00.000Z";

function workspace(): WorkspaceDocument {
  const value = emptyWorkspaceDocument();
  value.catalog.clients.push({ ...emptyClientProfileFields(), id: "client", displayName: "Synthetic client", sortName: "Synthetic client", createdAt: now, updatedAt: now });
  value.catalog.projects.push({ id: "folder", clientId: "client", name: "Synthetic project", projectCrs: "EPSG:32613", unitSystem: "metric", createdAt: now, updatedAt: now });
  value.catalog.fieldMaps.push({ id: "field", projectId: "folder", name: "Synthetic field", createdAt: now, updatedAt: now });
  return value;
}

function draft(): DesignDraft {
  const settings = defaultProjectSettings();
  delete settings.aerialImagery.sourcePackageId;
  return { id: "payload", name: "Synthetic draft", projectCrs: null, settings, unitSystem: settings.unitSystem,
    fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
}

function input(kind: "draft" | "project" = "draft", payloadId = "payload", designId = "design") {
  const common = { id: designId, fieldMapId: "field", name: "Base Design", isActive: true, revision: 0, createdAt: now, updatedAt: now };
  const design: WorkspaceDesignRecord = kind === "draft" ? { ...common, kind, draftId: payloadId } : { ...common, kind, pivotProjectId: payloadId };
  const document = kind === "draft" ? serializeDesignDraftDocument({ ...draft(), id: payloadId })
    : serializeProjectDocument({ ...structuredClone(sampleProject), id: payloadId });
  return { design, document: `\n ${document}\n` };
}

function errorCode(action: () => unknown, expected: WorkspaceDocumentErrorCode): void {
  assert.throws(action, (error: unknown) => error instanceof WorkspaceDocumentError && error.code === expected);
}

test("an empty versioned workspace invents no folders or design geometry", () => {
  const value = emptyWorkspaceDocument();
  assert.deepEqual(parseWorkspaceDocument(serializeWorkspaceDocument(value)), value);
  assert.deepEqual(value.catalog, { clients: [], projects: [], fieldMaps: [], designs: [] });
  assert.equal(value.revision, 0);
});

for (const kind of ["draft", "project"] as const) {
  test(`${kind} create round-trips exact document strings and leaves all caller data untouched`, () => {
    const before = workspace();
    const creation = input(kind);
    const beforeCopy = structuredClone(before);
    const inputCopy = structuredClone(creation);
    const next = createWorkspaceDesign(before, creation);
    const restored = parseWorkspaceDocument(serializeWorkspaceDocument(next));
    assert.equal(next.revision, 1);
    assert.equal(next.catalog.designs[0].revision, 0);
    assert.equal(next.catalog.designs[0].kind, kind);
    const document = kind === "draft" ? restored.draftDocuments[0].document : restored.projectDocuments[0].document;
    assert.equal(document, creation.document);
    assert.deepEqual(before, beforeCopy);
    assert.deepEqual(creation, inputCopy);
    next.catalog.clients[0].displayName = "Detached";
    assert.deepEqual(before, beforeCopy);
  });

  test(`${kind} save advances persisted revisions without reassigning ownership or changing catalog identity`, () => {
    const creation = input(kind);
    const before = createWorkspaceDesign(workspace(), creation);
    const copy = structuredClone(before);
    const document = creation.document + "  ";
    const next = saveWorkspaceDesign(before, { designId: "design", expectedRevision: 0, document, updatedAt: later });
    assert.equal(next.revision, 2);
    assert.deepEqual(next.catalog.designs[0], { ...copy.catalog.designs[0], revision: 1, updatedAt: later });
    assert.equal(kind === "draft" ? next.draftDocuments[0].document : next.projectDocuments[0].document, document);
    assert.deepEqual(before, copy);
    errorCode(() => saveWorkspaceDesign(next, { designId: "design", expectedRevision: 0, document, updatedAt: later }), "conflict");
    errorCode(() => saveWorkspaceDesign(next, { designId: "missing", expectedRevision: 0, document, updatedAt: later }), "not_found");
  });

  test(`${kind} delete records both tombstones and neither stale save nor fresh create can resurrect identities`, () => {
    const creation = input(kind);
    const before = createWorkspaceDesign(workspace(), creation);
    const copy = structuredClone(before);
    const next = deleteWorkspaceDesign(before, { designId: "design", expectedRevision: 0, deletedAt: later });
    assert.equal(next.catalog.designs.length, 0);
    assert.equal(next.projectDocuments.length, 0);
    assert.equal(next.draftDocuments.length, 0);
    assert.equal(next.tombstones.length, 2);
    assert.equal(next.revision, 2);
    assert.deepEqual(next.catalog.fieldMaps, before.catalog.fieldMaps);
    assert.deepEqual(parseWorkspaceDocument(serializeWorkspaceDocument(next)), next);
    errorCode(() => saveWorkspaceDesign(next, { designId: "design", expectedRevision: 0, document: creation.document, updatedAt: later }), "not_found");
    errorCode(() => createWorkspaceDesign(next, creation), "conflict");
    errorCode(() => createWorkspaceDesign(next, input(kind, "another-payload")), "conflict");
    errorCode(() => createWorkspaceDesign(next, input(kind, "payload", "another-design")), "conflict");
    errorCode(() => createWorkspaceDesign(next, input(kind === "draft" ? "project" : "draft", "payload", "another-design")), "conflict");
    assert.deepEqual(before, copy);
  });
}

test("incomplete and calculation-ineligible drafts remain draft-backed after create and save", () => {
  const value = draft();
  value.machine.spanLengthsMeters = [Number.MAX_VALUE, Number.MAX_VALUE, null];
  const document = serializeDesignDraftDocument(value);
  const next = createWorkspaceDesign(workspace(), { ...input(), document });
  const saved = saveWorkspaceDesign(next, { designId: "design", expectedRevision: 0, document, updatedAt: later });
  assert.equal(saved.catalog.designs[0].kind, "draft");
  assert.deepEqual(parseDesignDraftDocument(saved.draftDocuments[0].document), value);
  assert.equal(saved.projectDocuments.length, 0);
});

test("unowned legacy project imports retain exact bytes while another design changes", () => {
  const value = workspace();
  const project = { ...structuredClone(sampleProject), id: "unowned", projectCrs: "EPSG:26741" };
  const document = `\n\t${JSON.stringify({ documentVersion: "pivot-project-v1", project, retainedUnknownMetadata: { original: true } })}\n`;
  const entry = { document, summary: { id: project.id, name: project.name, projectCrs: project.projectCrs, unitSystem: project.unitSystem, updatedAt: now } };
  value.projectDocuments.push(entry);
  const next = createWorkspaceDesign(value, input());
  const saved = saveWorkspaceDesign(next, { designId: "design", expectedRevision: 0, document: input().document, updatedAt: later });
  const deleted = deleteWorkspaceDesign(saved, { designId: "design", expectedRevision: 1, deletedAt: later });
  assert.deepEqual(parseWorkspaceDocument(serializeWorkspaceDocument(deleted)).projectDocuments, [entry]);
});

test("unknown versions, malformed JSON and extra envelope fields never become an empty workspace", () => {
  errorCode(() => parseWorkspaceDocument("{"), "invalid_document");
  errorCode(() => parseWorkspaceDocument(JSON.stringify({ ...workspace(), workspaceVersion: "cplayout-workspace-v2" })), "unsupported_version");
  for (const value of [null, [], {}, { ...workspace(), extra: true }, { ...workspace(), revision: -1 }]) {
    errorCode(() => parseWorkspaceDocument(JSON.stringify(value)), "invalid_document");
  }
  const value = createWorkspaceDesign(workspace(), input("project"));
  for (const document of [JSON.stringify({ ...sampleProject, documentVersion: "pivot-project-v2" }),
    JSON.stringify({ documentVersion: "pivot-project-v2", project: sampleProject })]) {
    value.projectDocuments[0].document = document;
    errorCode(() => validateWorkspaceDocument(value), "unsupported_version");
  }
});

test("duplicate identities, duplicate ownership, missing references and ambiguous payloads reject without normalization", () => {
  const base = createWorkspaceDesign(workspace(), input());
  const invalid: Array<(value: WorkspaceDocument) => void> = [
    (value) => { value.catalog.clients.push(value.catalog.clients[0]); },
    (value) => { value.catalog.projects.push(value.catalog.projects[0]); },
    (value) => { value.catalog.fieldMaps.push(value.catalog.fieldMaps[0]); },
    (value) => { value.catalog.designs.push(value.catalog.designs[0]); },
    (value) => { value.draftDocuments.push(value.draftDocuments[0]); },
    (value) => { value.catalog.designs.push({ ...value.catalog.designs[0], id: "second" }); },
    (value) => { value.catalog.clients = []; },
    (value) => { value.catalog.projects = []; },
    (value) => { value.catalog.fieldMaps = []; },
    (value) => { value.draftDocuments = []; },
    (value) => { value.catalog.designs = []; },
    (value) => { Object.assign(value.catalog.designs[0], { pivotProjectId: "payload" }); },
    (value) => { Object.assign(value.catalog.clients[0], { unknownProfileField: true }); },
  ];
  for (const mutate of invalid) {
    const value = structuredClone(base);
    mutate(value);
    const copy = structuredClone(value);
    assert.throws(() => validateWorkspaceDocument(value), WorkspaceDocumentError);
    assert.deepEqual(value, copy);
  }
});

test("summary mismatches and kind or identity changes cannot relink a saved design", () => {
  for (const kind of ["draft", "project"] as const) {
    const value = createWorkspaceDesign(workspace(), input(kind));
    const copy = structuredClone(value);
    errorCode(() => saveWorkspaceDesign(value, { designId: "design", expectedRevision: 0, document: input(kind, "different").document, updatedAt: later }), "identity_mismatch");
    assert.throws(() => saveWorkspaceDesign(value, { designId: "design", expectedRevision: 0, document: input(kind === "draft" ? "project" : "draft").document, updatedAt: later }), WorkspaceDocumentError);
    assert.deepEqual(value, copy);
  }
  for (const key of ["id", "name", "projectCrs", "unitSystem"] as const) {
    const value = createWorkspaceDesign(workspace(), input("project"));
    value.projectDocuments[0].summary[key] = "mismatch";
    errorCode(() => validateWorkspaceDocument(value), "identity_mismatch");
  }
});

test("create rejects occupied IDs, missing field maps and nonzero initial revision", () => {
  const value = createWorkspaceDesign(workspace(), input());
  errorCode(() => createWorkspaceDesign(value, input()), "conflict");
  errorCode(() => createWorkspaceDesign(value, input("project", "payload", "another-design")), "conflict");
  const creation = input("draft", "fresh", "fresh-design");
  creation.design.fieldMapId = "missing";
  errorCode(() => createWorkspaceDesign(value, creation), "not_found");
  creation.design.fieldMapId = "field";
  creation.design.revision = 1;
  errorCode(() => createWorkspaceDesign(value, creation), "conflict");
});

test("invalid and exhausted revisions reject before changing caller data", () => {
  const value = createWorkspaceDesign(workspace(), input());
  for (const expectedRevision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    errorCode(() => saveWorkspaceDesign(value, { designId: "design", expectedRevision, document: input().document, updatedAt: later }), "invalid_document");
    errorCode(() => deleteWorkspaceDesign(value, { designId: "design", expectedRevision, deletedAt: later }), "invalid_document");
  }
  const exhausted = { ...value, revision: Number.MAX_SAFE_INTEGER };
  const copy = structuredClone(exhausted);
  errorCode(() => createWorkspaceDesign(exhausted, input("draft", "fresh", "fresh-design")), "revision_exhausted");
  errorCode(() => saveWorkspaceDesign(exhausted, { designId: "design", expectedRevision: 0, document: input().document, updatedAt: later }), "revision_exhausted");
  errorCode(() => deleteWorkspaceDesign(exhausted, { designId: "design", expectedRevision: 0, deletedAt: later }), "revision_exhausted");
  assert.deepEqual(exhausted, copy);
  const ahead = structuredClone(value);
  ahead.catalog.designs[0].revision = 2;
  errorCode(() => validateWorkspaceDocument(ahead), "invalid_document");
});

test("tombstones reject active collisions and duplicate deletion identities", () => {
  const value = createWorkspaceDesign(workspace(), input());
  for (const entity of ["design", "draft_document", "project_document"] as const) {
    const collision = structuredClone(value);
    collision.tombstones.push({ entity, id: entity === "design" ? "design" : "payload", revision: 1, deletedAt: later });
    errorCode(() => validateWorkspaceDocument(collision), "conflict");
  }
  const deleted = deleteWorkspaceDesign(value, { designId: "design", expectedRevision: 0, deletedAt: later });
  deleted.tombstones.push({ ...deleted.tombstones[1], entity: "project_document" });
  errorCode(() => validateWorkspaceDocument(deleted), "conflict");
});

test("a CRS can be selected for an empty draft but cannot relabel existing coordinates", () => {
  const base = createWorkspaceDesign(workspace(), input());
  const supplied = draft();
  supplied.projectCrs = "EPSG:32613";
  supplied.fieldBoundary = [{ x: 500000, y: 4400000 }];
  const next = saveWorkspaceDesign(base, { designId: "design", expectedRevision: 0, document: serializeDesignDraftDocument(supplied), updatedAt: later });
  for (const clearCoordinates of [false, true]) {
    const relabeled = structuredClone(supplied);
    relabeled.projectCrs = "EPSG:32614";
    if (clearCoordinates) relabeled.fieldBoundary = [];
    errorCode(() => saveWorkspaceDesign(next, { designId: "design", expectedRevision: 1, document: serializeDesignDraftDocument(relabeled), updatedAt: later }), "identity_mismatch");
  }
});

test("prototype-looking identity strings remain ordinary array and Map keys", () => {
  const value = createWorkspaceDesign(workspace(), input("draft", "__proto__", "constructor"));
  assert.equal(value.draftDocuments[0].id, "__proto__");
  assert.equal(value.catalog.designs[0].id, "constructor");
  assert.deepEqual(parseWorkspaceDocument(serializeWorkspaceDocument(value)), value);
});
