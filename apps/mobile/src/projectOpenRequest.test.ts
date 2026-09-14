import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createProjectEditorState,
  defaultProjectSettings,
  parseProjectDocument,
  qualifyProjectCrs,
  reduceProjectEditorState,
  sampleProject,
  type PivotProject,
} from "@cplayout/core";
import { createProjectOpenRequestGuard } from "./projectOpenRequest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function workspace() {
  const guard = createProjectOpenRequestGuard();
  let editor = createProjectEditorState(sampleProject);
  let settings = editor.project.settings;
  let designId: string | null = "original-design";
  let generation = 0;
  const commits: string[] = [];
  const load = (project: PivotProject, affiliation: string | null) => {
    guard.invalidate();
    editor = reduceProjectEditorState(editor, { type: "load_project", project });
    settings = editor.project.settings;
    designId = affiliation;
    generation += 1;
    commits.push(project.id);
  };
  const snapshot = () => ({ editor, settings, designId, generation, commits: [...commits] });
  return { guard, load, snapshot };
}

const savedA = parseProjectDocument({ ...sampleProject, id: "saved-A", name: "Saved A" });
const importedB = parseProjectDocument({
  ...sampleProject, id: "import-B", name: "Independent B", projectCrs: "LOCAL:FIELD", unitSystem: "metric",
  settings: { ...defaultProjectSettings(), unitSystem: "metric", mapStyle: "high_contrast", defaultZoomLevel: 2.5,
    drawing: { ...defaultProjectSettings().drawing, vertexSnapToleranceMeters: 0.37 } },
});

test("reverse project/design opens commit only the latest request, not the last response", async () => {
  for (const firstKind of ["project", "design"]) {
    const app = workspace();
    const first = deferred<PivotProject>();
    const second = deferred<PivotProject>();
    const a = app.guard.open(() => first.promise, (project) => app.load(project, `${firstKind}-A`));
    const b = app.guard.open(() => second.promise, (project) => app.load(project, "design-B"));
    assert.equal(app.snapshot().generation, 0, "request ownership must not advance committed/save generation");
    second.resolve(importedB);
    await b;
    const committed = app.snapshot();
    first.resolve(savedA);
    await a;
    assert.deepEqual(app.snapshot(), committed, "stale completion must not touch settings, context or history");
    assert.deepEqual(committed.commits, [importedB.id]);
    assert.equal(committed.designId, "design-B");
    assert.equal(committed.generation, 1);
  }
});

test("direct import invalidates every pending open without retaining the saved design affiliation", async () => {
  const app = workspace();
  const first = deferred<PivotProject>();
  const second = deferred<PivotProject>();
  const a = app.guard.open(() => first.promise, (project) => app.load(project, "design-A"));
  const b = app.guard.open(() => second.promise, (project) => app.load(project, "design-C"));
  app.load(importedB, null);
  const imported = app.snapshot();
  first.resolve(savedA);
  second.resolve(savedA);
  await Promise.all([a, b]);
  assert.deepEqual(app.snapshot(), imported);
  assert.equal(imported.designId, null);
  assert.deepEqual(imported.settings, importedB.settings);
  assert.equal(imported.editor.past.length, 0);
  assert.equal(imported.editor.future.length, 0);
});

test("an older read cannot commit even while the newer request is still pending", async () => {
  const app = workspace();
  const first = deferred<PivotProject>();
  const second = deferred<PivotProject>();
  const a = app.guard.open(() => first.promise, (project) => app.load(project, "design-A"));
  const b = app.guard.open(() => second.promise, (project) => app.load(project, "design-B"));
  first.resolve(savedA);
  await a;
  assert.equal(app.snapshot().generation, 0);
  assert.deepEqual(app.snapshot().commits, []);
  second.resolve(importedB);
  await b;
  assert.deepEqual(app.snapshot().commits, [importedB.id]);
});

test("newer missing or failed opens never revive an older read", async () => {
  for (const outcome of ["missing", "failed"]) {
    const app = workspace();
    const first = deferred<PivotProject>();
    const second = deferred<PivotProject | null>();
    const a = app.guard.open(() => first.promise, (project) => app.load(project, "design-A"));
    const b = app.guard.open(() => second.promise, (project) => app.load(project, "design-B"));
    if (outcome === "missing") { second.resolve(null); await b; }
    else { second.reject(new Error("missing design")); await assert.rejects(b, /missing design/); }
    first.resolve(savedA);
    await a;
    assert.deepEqual(app.snapshot().commits, []);
    assert.equal(app.snapshot().generation, 0);
  }
});

test("unmount/navigation invalidation ignores late success and failure; a later open still works", async () => {
  const app = workspace();
  const pending = deferred<PivotProject>();
  const request = app.guard.open(() => pending.promise, (project) => app.load(project, "design-A"));
  app.guard.invalidate();
  pending.reject(new Error("obsolete read"));
  await request;
  assert.deepEqual(app.snapshot().commits, []);
  await app.guard.open(async () => savedA, (project) => app.load(project, "design-A"));
  assert.deepEqual(app.snapshot().commits, [savedA.id]);
});

test("blocked project metadata keeps real reducer undo/redo and nondefault settings without relabelling XY", () => {
  let editor = createProjectEditorState(importedB);
  const original = editor.project;
  editor = reduceProjectEditorState(editor, {
    type: "update_project_settings", unitSystem: "us_survey_feet",
    settings: { ...original.settings!, unitSystem: "us_survey_feet" },
  });
  assert.equal(editor.lastError, null);
  assert.equal(editor.past.length, 1);
  const edited = editor.project;
  editor = reduceProjectEditorState(editor, { type: "undo" });
  assert.deepEqual(editor.project, original);
  assert.equal(editor.future.length, 1);
  editor = reduceProjectEditorState(editor, { type: "redo" });
  assert.deepEqual(editor.project, edited);
  assert.equal(qualifyProjectCrs(editor.project.projectCrs).calculation.allowed, false);
  assert.deepEqual(editor.project.pivotCenter, original.pivotCenter);
  assert.deepEqual(editor.project.fieldBoundary, original.fieldBoundary);
});

test("owner cleanup cancels a pending import without committing or saving it", async () => {
  const app = workspace();
  const owner = {};
  const pending = deferred<PivotProject>();
  let writes = 0;
  const read = app.guard.open(() => pending.promise, (project) => {
    app.load(project, null);
    writes += 1;
  }, owner);
  app.guard.invalidate(owner);
  pending.resolve(importedB);
  await read;
  assert.equal(writes, 0);
  assert.deepEqual(app.snapshot().commits, []);
});

test("old import owner cleanup cannot cancel a newer saved-project or other-owner open", async () => {
  for (const nextOwner of [undefined, {}]) {
    const app = workspace();
    const oldOwner = {};
    const first = deferred<PivotProject>();
    const second = deferred<PivotProject>();
    const stale = app.guard.open(() => first.promise, (project) => app.load(project, null), oldOwner);
    const current = app.guard.open(() => second.promise, (project) => app.load(project, "design-A"), nextOwner);
    app.guard.invalidate(oldOwner);
    first.resolve(importedB);
    await stale;
    assert.deepEqual(app.snapshot().commits, []);
    second.resolve(savedA);
    await current;
    assert.deepEqual(app.snapshot().commits, [savedA.id]);
    assert.equal(app.snapshot().designId, "design-A");
  }
});

test("only the latest picker in one owner can commit, including stale failures", async () => {
  for (const staleFails of [false, true]) {
    const app = workspace();
    const owner = {};
    const first = deferred<PivotProject>();
    const second = deferred<PivotProject>();
    const stale = app.guard.open(() => first.promise, (project) => app.load(project, null), owner);
    const current = app.guard.open(() => second.promise, (project) => app.load(project, null), owner);
    if (staleFails) first.reject(new Error("obsolete ZIP parse failure"));
    else first.resolve(savedA);
    await stale;
    assert.deepEqual(app.snapshot().commits, []);
    second.resolve(importedB);
    await current;
    assert.deepEqual(app.snapshot().commits, [importedB.id]);
  }
});
