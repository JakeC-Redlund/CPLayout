import assert from "node:assert/strict";
import test from "node:test";
import {
  createDraftDrawingWorkflow,
  DraftDrawingCommandSchema,
  DraftDrawingWorkflowSchema,
  draftDrawingFinishError,
  MAX_DRAFT_CAPTURE_VERTICES,
  MAX_DRAFT_WORKFLOW_CAPTURES,
  MAX_DRAFT_WORKFLOW_VERTICES,
  reduceDraftDrawingWorkflow,
  type DraftDrawingCommand,
  type DraftDrawingGeometryType,
  type DraftDrawingVertex,
  type DraftDrawingWorkflow,
} from "./draftDrawingWorkflow";
import { PROJECT_CALCULATION_NUMERIC_BUDGET } from "./projectCalculationSafety";
import type { XY } from "./types";

const crs = "LOCAL:field";
const timestamp = "2026-09-27T12:00:00.000Z";
const proposal = { purposeId: "field_boundary", name: "North field", notes: "Operator proposal" };

function vertex(x = 0, y = 0): DraftDrawingVertex {
  return { point: { x, y }, recordedAt: timestamp, wgs84: null, elevation: null };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function edit(workflow: DraftDrawingWorkflow | undefined, command: DraftDrawingCommand): DraftDrawingWorkflow {
  const before = JSON.stringify(workflow);
  const commandBefore = JSON.stringify(command);
  const result = reduceDraftDrawingWorkflow(freeze(workflow), crs, freeze(command));
  assert.equal(JSON.stringify(workflow), before);
  assert.equal(JSON.stringify(command), commandBefore);
  return result;
}

function begin(geometryType: DraftDrawingGeometryType = "Polygon", id = "a"): DraftDrawingWorkflow {
  return edit(undefined, { type: "begin", id, name: `Capture ${id}`, geometryType });
}

function append(workflow: DraftDrawingWorkflow, x = 0, y = 0, id = "a"): DraftDrawingWorkflow {
  return edit(workflow, { type: "append_vertex", id, vertex: vertex(x, y) });
}

function reject(workflow: DraftDrawingWorkflow, command: unknown, projectCrs: unknown = crs): void {
  const before = JSON.stringify(workflow);
  assert.throws(() => reduceDraftDrawingWorkflow(freeze(workflow), projectCrs as string | null, command as DraftDrawingCommand));
  assert.equal(JSON.stringify(workflow), before);
}

test("new workflow has explicit defaults; saved fields cannot be defaulted or extended", () => {
  const workflow = createDraftDrawingWorkflow();
  assert.deepEqual(workflow, { schemaVersion: "draft-drawing-workflow-v1", autosaveEnabled: true,
    lockedCrs: null, activeCaptureId: null, captures: [] });
  assert.notStrictEqual(createDraftDrawingWorkflow().captures, workflow.captures);
  for (const key of Object.keys(workflow)) {
    const incomplete = { ...workflow } as Record<string, unknown>;
    delete incomplete[key];
    assert.equal(DraftDrawingWorkflowSchema.safeParse(incomplete).success, false, key);
  }
  for (const invalid of [null, false, {}, { ...workflow, extra: true }, { ...workflow, schemaVersion: "v2" }]) {
    assert.equal(DraftDrawingWorkflowSchema.safeParse(invalid).success, false);
    assert.throws(() => reduceDraftDrawingWorkflow(invalid as DraftDrawingWorkflow, null, { type: "set_autosave", enabled: false }));
  }
  const disabled = reduceDraftDrawingWorkflow(undefined, null, { type: "set_autosave", enabled: false });
  assert.equal(disabled.autosaveEnabled, false);
  assert.equal(DraftDrawingWorkflowSchema.parse(JSON.parse(JSON.stringify(disabled))).autosaveEnabled, false);
});

test("drawing, classification, correction and pause preserve proposals without committing geometry", () => {
  let workflow = begin();
  assert.equal(workflow.lockedCrs, null);
  reject(workflow, { type: "finish", id: "a" });
  reject(workflow, { type: "set_classification", id: "a", classification: proposal });
  reject(workflow, { type: "return_to_drawing", id: "a" });
  workflow = append(append(append(workflow), 10, 0), 0, 10);
  workflow = edit(workflow, { type: "finish", id: "a" });
  assert.equal(workflow.activeCaptureId, "a");
  assert.equal(workflow.captures[0].stage, "classification");
  reject(workflow, { type: "append_vertex", id: "a", vertex: vertex(1, 1) });
  reject(workflow, { type: "remove_last_vertex", id: "a" });
  reject(workflow, { type: "finish", id: "a" });
  workflow = edit(workflow, { type: "set_classification", id: "a", classification: proposal });
  workflow = edit(workflow, { type: "pause", id: "a" });
  assert.equal(workflow.activeCaptureId, null);
  assert.deepEqual(workflow.captures[0].classification, proposal);
  assert.equal(Object.hasOwn(workflow, "mapFeatures"), false);
  assert.equal(Object.hasOwn(workflow, "fieldBoundary"), false);
  workflow = edit(workflow, { type: "resume", id: "a" });
  workflow = edit(workflow, { type: "return_to_drawing", id: "a" });
  workflow = edit(workflow, { type: "remove_last_vertex", id: "a" });
  assert.equal(workflow.captures[0].vertices.length, 2);
  assert.deepEqual(workflow.captures[0].classification, proposal);
  reject(workflow, { type: "finish", id: "a" });
});

test("pause frees active capture; stale IDs and competing captures cannot receive edits", () => {
  let workflow = append(begin());
  reject(workflow, { type: "begin", id: "b", name: "B", geometryType: "Point" });
  workflow = edit(workflow, { type: "pause", id: "a" });
  reject(workflow, { type: "append_vertex", id: "a", vertex: vertex() });
  reject(workflow, { type: "pause", id: "a" });
  reject(workflow, { type: "begin", id: "a", name: "Duplicate", geometryType: "Point" });
  workflow = edit(workflow, { type: "begin", id: "b", name: "B", geometryType: "Point" });
  reject(workflow, { type: "resume", id: "a" });
  for (const type of ["remove_last_vertex", "finish", "return_to_drawing", "pause", "resume", "discard"] as const) {
    reject(workflow, { type, id: "missing" });
  }
  reject(workflow, { type: "append_vertex", id: "missing", vertex: vertex() });
  reject(workflow, { type: "set_classification", id: "missing", classification: proposal });
  workflow = edit(workflow, { type: "discard", id: "a" });
  assert.equal(workflow.activeCaptureId, "b");
  workflow = edit(workflow, { type: "discard", id: "b" });
  assert.equal(workflow.activeCaptureId, null);
  assert.deepEqual(workflow.captures, []);
});

test("first append locks CRS permanently, including after removal, discard and saved roundtrip", () => {
  let workflow = begin("Point");
  reject(workflow, { type: "remove_last_vertex", id: "a" });
  workflow = append(workflow);
  assert.equal(workflow.lockedCrs, crs);
  workflow = edit(workflow, { type: "remove_last_vertex", id: "a" });
  assert.equal(workflow.lockedCrs, crs);
  workflow = edit(workflow, { type: "discard", id: "a" });
  workflow = DraftDrawingWorkflowSchema.parse(JSON.parse(JSON.stringify(workflow)));
  assert.equal(workflow.lockedCrs, crs);
  for (const nextCrs of [null, "LOCAL:other", "EPSG:32613"]) {
    reject(workflow, { type: "set_autosave", enabled: false }, nextCrs);
    reject(workflow, { type: "begin", id: "new", name: "New", geometryType: "Point" }, nextCrs);
  }
  workflow = edit(workflow, { type: "begin", id: "new", name: "New", geometryType: "Point" });
  assert.equal(workflow.lockedCrs, crs);
});

test("CRS validation covers supplied CRS, every capture and lock even without vertices", () => {
  const workflow = begin();
  for (const invalidCrs of ["EPSG:4326", "CRS:84", "unknown", "", 12, {}]) {
    reject(workflow, { type: "set_autosave", enabled: false }, invalidCrs);
    assert.equal(DraftDrawingWorkflowSchema.safeParse({ ...workflow, lockedCrs: invalidCrs }).success, false);
    assert.equal(DraftDrawingWorkflowSchema.safeParse({ ...workflow,
      captures: [{ ...workflow.captures[0], projectCrs: invalidCrs }] }).success, false);
  }
  assert.throws(() => reduceDraftDrawingWorkflow(workflow, undefined as unknown as string,
    { type: "set_autosave", enabled: false }));
  reject(workflow, { type: "append_vertex", id: "a", vertex: vertex() }, "LOCAL:other");
  assert.throws(() => reduceDraftDrawingWorkflow(undefined, null, { type: "begin", id: "a", name: "A", geometryType: "Point" }));
  for (const valid of ["LOCAL:field", "EPSG:32613"]) {
    assert.doesNotThrow(() => reduceDraftDrawingWorkflow(undefined, valid, { type: "begin", id: "a", name: "A", geometryType: "Point" }));
  }
  const captured = append(workflow);
  assert.equal(DraftDrawingWorkflowSchema.safeParse({ ...captured, lockedCrs: null }).success, false);
  assert.equal(DraftDrawingWorkflowSchema.safeParse({ ...captured, lockedCrs: "LOCAL:other" }).success, false);
  assert.equal(DraftDrawingWorkflowSchema.safeParse({ ...workflow, lockedCrs: "LOCAL:other" }).success, false);
});

test("paused empty captures still bind every command to the supplied project CRS", () => {
  const paused = edit(begin(), { type: "pause", id: "a" });
  assert.equal(paused.lockedCrs, null);
  assert.equal(paused.captures[0].vertices.length, 0);
  for (const otherCrs of ["LOCAL:other", "EPSG:32613", null]) {
    reject(paused, { type: "begin", id: "b", name: "B", geometryType: "Point" }, otherCrs);
    reject(paused, { type: "set_autosave", enabled: false }, otherCrs);
  }
  const mixed = { ...paused, captures: [...paused.captures,
    { ...paused.captures[0], id: "b", projectCrs: "LOCAL:other" }] };
  reject(mixed, { type: "resume", id: "a" });
  reject(mixed, { type: "set_autosave", enabled: false });
  assert.match(draftDrawingFinishError("Polygon", [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 0 },
  ]) ?? "", /duplicate closing point/);
});

test("saved zero/one/two vertices and paused classification roundtrip without inferred evidence", () => {
  let workflow = begin();
  for (let count = 0; count <= 3; count += 1) {
    if (count) workflow = append(workflow, count === 2 ? 10 : 0, count === 3 ? 10 : 0);
    const saved = JSON.stringify(workflow);
    const restored = DraftDrawingWorkflowSchema.parse(JSON.parse(saved));
    assert.equal(JSON.stringify(restored), saved);
    for (const item of restored.captures[0].vertices) {
      assert.equal(item.wgs84, null);
      assert.equal(item.elevation, null);
    }
  }
  workflow = edit(workflow, { type: "finish", id: "a" });
  workflow = edit(workflow, { type: "set_classification", id: "a", classification: proposal });
  workflow = edit(workflow, { type: "pause", id: "a" });
  const restored = DraftDrawingWorkflowSchema.parse(JSON.parse(JSON.stringify(workflow)));
  assert.deepEqual(restored, workflow);
  restored.captures[0].vertices[0].point.x = 33;
  assert.equal(workflow.captures[0].vertices[0].point.x, 0);
});

test("manual vertices require literal null evidence and forbid measured-source injection", () => {
  const workflow = begin();
  const captured = append(workflow);
  const invalidVertices: unknown[] = [
    { point: { x: 0, y: 0 }, recordedAt: timestamp },
    { ...vertex(), wgs84: undefined }, { ...vertex(), elevation: undefined },
    { ...vertex(), wgs84: { latitude: 40, longitude: -104 } }, { ...vertex(), elevation: 1400 },
    { ...vertex(), captureEvidence: { coherent: true } }, { ...vertex(), source: "external_gnss" },
    { ...vertex(), recordedAt: "yesterday" }, { ...vertex(), recordedAt: "2026-02-30T12:00:00Z" },
    { ...vertex(), point: { x: 0, y: 0, z: 100 } }, { ...vertex(), point: { x: NaN, y: 0 } },
  ];
  for (const item of invalidVertices) {
    reject(workflow, { type: "append_vertex", id: "a", vertex: item });
    assert.equal(DraftDrawingWorkflowSchema.safeParse({ ...captured,
      captures: [{ ...captured.captures[0], vertices: [item] }] }).success, false);
  }
  assert.equal(DraftDrawingWorkflowSchema.safeParse({ ...captured,
    captures: [{ ...captured.captures[0], source: "external_gnss" }] }).success, false);
  const offset = { ...vertex(), recordedAt: "2026-09-27T06:00:00-06:00" };
  assert.equal(edit(workflow, { type: "append_vertex", id: "a", vertex: offset }).captures[0].vertices[0].recordedAt, offset.recordedAt);
});

test("finish requires valid point/line/open polygon topology within numeric budget", () => {
  const cases: Array<[DraftDrawingGeometryType, XY[], boolean]> = [
    ["Point", [], false], ["Point", [{ x: 0, y: 0 }], true],
    ["Point", [{ x: 0, y: 0 }, { x: 1, y: 1 }], false],
    ["LineString", [{ x: 0, y: 0 }], false],
    ["LineString", [{ x: 0, y: 0 }, { x: 0, y: 0 }], false],
    ["LineString", [{ x: 0, y: 0 }, { x: 1, y: 1 }], true],
    ["Polygon", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], true],
    ["Polygon", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 0 }], false],
    ["Polygon", [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], false],
    ["Polygon", [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }], false],
    ["Point", [{ x: Number.MAX_VALUE, y: 0 }], false],
    ["Point", [{ x: Infinity, y: 0 }], false],
    ["Point", [{ x: PROJECT_CALCULATION_NUMERIC_BUDGET.maxResolvedExtentMeters * 2, y: 0 }], false],
  ];
  for (const [type, points, valid] of cases) {
    assert.equal(draftDrawingFinishError(type, points) === null, valid, JSON.stringify({ type, points }));
    const workflow = { ...begin(type), lockedCrs: crs,
      captures: [{ ...begin(type).captures[0], vertices: points.map(item => vertex(item.x, item.y)) }] };
    const classified = { ...workflow, captures: [{ ...workflow.captures[0], stage: "classification" }] };
    assert.equal(DraftDrawingWorkflowSchema.safeParse(classified).success, valid);
    if (valid) assert.equal(edit(workflow, { type: "finish", id: "a" }).captures[0].stage, "classification");
    else reject(workflow, { type: "finish", id: "a" });
  }
  assert.notEqual(draftDrawingFinishError("Circle" as DraftDrawingGeometryType, []), null);
});

test("saved identities, stages, proposals and active selection are strict", () => {
  const workflow = begin();
  for (const invalid of [
    { ...workflow, captures: [workflow.captures[0], workflow.captures[0]] },
    { ...workflow, activeCaptureId: "missing" },
    { ...workflow, activeCaptureId: ["a", "b"] },
    { ...workflow, captures: [{ ...workflow.captures[0], stage: "committed" }] },
    { ...workflow, captures: [{ ...workflow.captures[0], classification: { ...proposal, approved: true } }] },
  ]) assert.equal(DraftDrawingWorkflowSchema.safeParse(invalid).success, false);
});

test("capture and workflow limits reject excess without truncating or mutating", () => {
  const base = begin("LineString");
  const vertices = Array.from({ length: MAX_DRAFT_CAPTURE_VERTICES }, (_, index) => vertex(index, 0));
  const full = { ...base, lockedCrs: crs, captures: [{ ...base.captures[0], vertices }] };
  assert.equal(DraftDrawingWorkflowSchema.safeParse(full).success, true);
  reject(full, { type: "append_vertex", id: "a", vertex: vertex(3000, 0) });
  const many = { ...full, activeCaptureId: null, captures: Array.from({ length: MAX_DRAFT_WORKFLOW_VERTICES / MAX_DRAFT_CAPTURE_VERTICES },
    (_, index) => ({ ...full.captures[0], id: `capture-${index}` })) };
  assert.equal(DraftDrawingWorkflowSchema.safeParse(many).success, true);
  const extra = edit(many, { type: "begin", id: "extra", name: "Extra", geometryType: "Point" });
  reject(extra, { type: "append_vertex", id: "extra", vertex: vertex() });
  const captures = { ...base, activeCaptureId: null,
    captures: Array.from({ length: MAX_DRAFT_WORKFLOW_CAPTURES }, (_, index) => ({ ...base.captures[0], id: `${index}` })) };
  assert.equal(DraftDrawingWorkflowSchema.safeParse(captures).success, true);
  reject(captures, { type: "begin", id: "extra", name: "Extra", geometryType: "Point" });
  assert.notEqual(draftDrawingFinishError("LineString", [...vertices.map(item => item.point), { x: 3000, y: 0 }]), null);
  const single = append(begin("Point"));
  reject(single, { type: "append_vertex", id: "a", vertex: vertex(1, 1) });
});

test("runtime commands reject unknown shapes, unsafe objects and accessors without invoking them", () => {
  const workflow = begin();
  for (const command of [null, [], {}, { type: "erase_all" }, { type: "pause" },
    { type: "pause", id: "a", extra: true }, { type: "set_autosave", enabled: "false" },
    { type: "begin", id: "b", name: "B", geometryType: "Circle" }]) reject(workflow, command);
  let reads = 0;
  const accessor = Object.defineProperty({}, "type", { enumerable: true, get() { reads += 1; return "pause"; } });
  const pointAccessor = Object.defineProperty({ y: 0 }, "x", { enumerable: true, get() { reads += 1; return 0; } });
  const hooked = { type: "pause", id: "a", toJSON() { reads += 1; return {}; } };
  const cyclic: Record<string, unknown> = { type: "pause", id: "a" };
  cyclic.self = cyclic;
  const symbol = { type: "pause", id: "a", [Symbol("extra")]: true };
  const hidden = Object.defineProperty({ type: "pause", id: "a" }, "extra", { value: true });
  for (const command of [accessor, hooked, cyclic, symbol, hidden,
    { type: "append_vertex", id: "a", vertex: { ...vertex(), point: pointAccessor } }]) {
    reject(workflow, command);
    assert.equal(DraftDrawingCommandSchema.safeParse(command).success, false);
  }
  const stateAccessor = Object.defineProperty({ ...workflow }, "autosaveEnabled", { enumerable: true, get() { reads += 1; return true; } });
  assert.equal(DraftDrawingWorkflowSchema.safeParse(stateAccessor).success, false);
  assert.throws(() => reduceDraftDrawingWorkflow(stateAccessor, crs, { type: "pause", id: "a" }));
  assert.notEqual(draftDrawingFinishError("Point", [pointAccessor as XY]), null);
  assert.equal(DraftDrawingWorkflowSchema.safeParse({ ...workflow, captures: new Array(1) }).success, false);
  assert.equal(reads, 0);
});

test("returned workflow never aliases previous data or command data", () => {
  const workflow = begin("Point");
  const command: DraftDrawingCommand = { type: "append_vertex", id: "a", vertex: vertex() };
  const result = reduceDraftDrawingWorkflow(workflow, crs, command);
  command.vertex.point.x = 99;
  workflow.captures[0].classification.name = "Changed old name";
  assert.equal(result.captures[0].vertices[0].point.x, 0);
  assert.equal(result.captures[0].classification.name, "Capture a");
  result.captures[0].vertices[0].point.y = 22;
  assert.equal(command.vertex.point.y, 0);
});
