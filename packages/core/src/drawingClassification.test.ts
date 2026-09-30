import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAWING_CLASSIFICATION_VERSION, DRAWING_PURPOSE_CATALOG, drawingPurpose,
  drawingPurposesForGeometry, parseDrawingClassification, inspectDrawingClassification,
  drawingClassificationDestination, drawingClassificationLegacyKind, prepareClassifiedDrawing,
  type DrawingClassification,
} from "./drawingClassification";
import { reduceDraftDrawingWorkflow, type DraftDrawingGeometryType } from "./draftDrawingWorkflow";

const crs = "LOCAL:field";
function selection(id = "field_boundary"): DrawingClassification {
  const purpose = drawingPurpose(id)!;
  return { schemaVersion: DRAWING_CLASSIFICATION_VERSION, geometryType: purpose.geometry,
    purposeId: id, name: " North field ", notes: "  First line\nSecond line <literal>  ",
    assetStatus: "unknown", placement: purpose.placements[0], customLabel: purpose.custom ? "My category" : null,
    effect: id === "exclusion_area" ? { mode: "exclusion", noSpray: true, hardConflict: false, bufferMeters: 0 }
      : { mode: "informational" } };
}
function capture(geometryType: DraftDrawingGeometryType = "Polygon") {
  let workflow = reduceDraftDrawingWorkflow(undefined, crs, { type: "begin", id: "a", name: "Draft", geometryType });
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
  for (const point of points.slice(0, geometryType === "Point" ? 1 : geometryType === "LineString" ? 2 : 3)) {
    workflow = reduceDraftDrawingWorkflow(workflow, crs, { type: "append_vertex", id: "a",
      vertex: { point, recordedAt: "2026-09-27T12:00:00.000Z", wgs84: null, elevation: null } });
  }
  return reduceDraftDrawingWorkflow(workflow, crs, { type: "finish", id: "a" });
}
function input(id = "field_boundary") {
  return { workflow: capture(drawingPurpose(id)!.geometry), projectCrs: crs, captureId: "a",
    editorRevision: 4, expectedEditorRevision: 4, classification: selection(id) };
}

test("catalog IDs are unique, immutable and geometry-filtered; every purpose admits an explicit selection", () => {
  assert.equal(new Set(DRAWING_PURPOSE_CATALOG.map(item => item.id)).size, DRAWING_PURPOSE_CATALOG.length);
  assert(Object.isFrozen(DRAWING_PURPOSE_CATALOG));
  for (const purpose of DRAWING_PURPOSE_CATALOG) {
    assert(Object.isFrozen(purpose));
    assert(Object.isFrozen(purpose.placements));
    assert.strictEqual(drawingPurpose(purpose.id), purpose);
    const choices = drawingPurposesForGeometry(purpose.geometry, purpose.category);
    assert(Object.isFrozen(choices));
    assert(choices.includes(purpose));
    assert(choices.every(item => item.geometry === purpose.geometry && item.category === purpose.category));
    assert.deepEqual(parseDrawingClassification(JSON.parse(JSON.stringify(selection(purpose.id)))), selection(purpose.id));
  }
  for (const id of ["well", "power_pole", "tree", "riser", "power_disconnect", "valve", "soil_zone", "surface_field_drain"]) {
    assert(drawingPurpose(id), id);
  }
  assert.equal(drawingPurpose("constructor"), null);
  assert.equal(drawingPurpose("future_kind"), null);
});

test("saved classification requires every explicit field and preserves literal strings", () => {
  const original = selection();
  const parsed = parseDrawingClassification(original);
  assert.deepEqual(parsed, original);
  assert.notStrictEqual(parsed, original);
  assert.notStrictEqual(parsed.effect, original.effect);
  for (const key of Object.keys(original)) {
    const incomplete: Record<string, unknown> = { ...original };
    delete incomplete[key];
    assert.throws(() => parseDrawingClassification(incomplete), key);
  }
  for (const patch of [{ name: "  " }, { name: "x".repeat(1025) }, { notes: "x".repeat(16385) },
    { extra: true }, { assetStatus: "surveyed" }, { geometryType: "Point" }, { purposeId: "future_kind" },
    { schemaVersion: "v2" }, { customLabel: "not custom" }, { placement: "unknown" },
    { effect: { mode: "informational", noSpray: false } }]) {
    assert.throws(() => parseDrawingClassification({ ...original, ...patch }));
  }
  assert.throws(() => parseDrawingClassification({ ...selection("point_custom"), customLabel: null }));
  assert.throws(() => parseDrawingClassification({ ...selection("point_custom"), customLabel: " " }));
});

test("unsupported JSON is retained without coercion; non-JSON inputs cannot execute accessors", () => {
  for (const patch of [{ purposeId: "future_kind" }, { schemaVersion: "future-version" }, { extra: { nested: ["literal"] } }]) {
    const original = { ...selection(), ...patch };
    const result = inspectDrawingClassification(original);
    assert.equal(result.recognized, false);
    if (result.recognized) throw new Error("Expected unsupported classification");
    assert.deepEqual(result.original, original);
    assert.notStrictEqual(result.original, original);
    assert(result.reason.length > 0);
  }
  assert.equal(inspectDrawingClassification(selection()).recognized, true);
  let invoked = false;
  const accessor = Object.defineProperty({}, "purposeId", { enumerable: true, get() { invoked = true; return "field_boundary"; } });
  for (const invalid of [accessor, { toJSON() { invoked = true; return {}; } }, { notes: undefined }, new Date(), { n: Infinity }]) {
    assert.throws(() => parseDrawingClassification(invalid));
    assert.throws(() => inspectDrawingClassification(invalid));
  }
  assert.equal(invoked, false);
});

test("preparation retains opaque identities admitted by the existing workflow", () => {
  for (const id of [" ", "a".repeat(1025)]) {
    const original = input();
    original.workflow.activeCaptureId = id;
    original.workflow.captures[0].id = id;
    original.captureId = id;
    assert.equal(prepareClassifiedDrawing(original).captureId, id);
  }
});

test("literal prototype-named keys survive unsupported inspection and cannot silently enter classification", () => {
  for (const extra of [JSON.parse('{"__proto__":{"literal":42}}'),
    JSON.parse('{"nested":{"__proto__":{"literal":42}}}')]) {
    const original = { ...selection(), ...extra };
    assert.throws(() => parseDrawingClassification(original));
    const result = inspectDrawingClassification(original);
    assert.equal(result.recognized, false);
    if (result.recognized) throw new Error("Expected unsupported classification");
    assert.deepEqual(result.original, original);
    assert.equal(JSON.stringify(result.original), JSON.stringify(original));
  }
  assert.throws(() => inspectDrawingClassification(Object.fromEntries([["__proto__", { value: undefined }]])));
});

test("exclusions require polygon footprints and explicit effects; descriptive purposes stay informational", () => {
  for (const id of ["tree", "well", "valve", "soil_zone", "building_footprint", "power_pole"]) {
    assert.equal(drawingClassificationDestination(selection(id)), "feature");
  }
  for (const [noSpray, hardConflict] of [[true, false], [false, true], [true, true]]) {
    assert.equal(drawingClassificationDestination({ ...selection("soil_zone"),
      effect: { mode: "exclusion", noSpray, hardConflict, bufferMeters: 2 } }), "obstacle");
  }
  for (const id of ["field_boundary", "tree", "pipeline", "pivot_center", "project_water_source"]) {
    assert.throws(() => parseDrawingClassification({ ...selection(id), effect: selection("exclusion_area").effect }));
  }
  assert.throws(() => parseDrawingClassification({ ...selection("exclusion_area"), effect: { mode: "informational" } }));
  for (const effect of [{ mode: "exclusion", noSpray: false, hardConflict: false, bufferMeters: 0 },
    { mode: "exclusion", noSpray: true, hardConflict: false, bufferMeters: -1 },
    { mode: "exclusion", noSpray: true, hardConflict: false, bufferMeters: Infinity }]) {
    assert.throws(() => parseDrawingClassification({ ...selection("soil_zone"), effect }));
  }
});

test("only explicit operational purposes select canonical fields; unknown utility placement is not guessed", () => {
  for (const [id, destination] of [["field_boundary", "field_boundary"], ["pivot_center", "pivot_center"],
    ["project_water_source", "water_source"], ["project_power_source", "power_source"]]) {
    assert.equal(drawingClassificationDestination(selection(id)), destination);
    assert.equal(drawingClassificationLegacyKind(selection(id)), null);
  }
  assert.equal(drawingClassificationLegacyKind(selection("pipeline")), null);
  assert.equal(drawingClassificationLegacyKind({ ...selection("pipeline"), placement: "aboveground" }), null);
  assert.equal(drawingClassificationLegacyKind({ ...selection("pipeline"), placement: "underground" }), "underground_pipeline");
  assert.equal(drawingClassificationLegacyKind(selection("electrical_route")), null);
  assert.equal(drawingClassificationLegacyKind({ ...selection("electrical_route"), placement: "underground" }), "underground_wire");
  assert.equal(drawingClassificationLegacyKind({ ...selection("electrical_route"), placement: "overhead" }), "power_line");
  assert.equal(drawingClassificationLegacyKind(selection("well")), "well_location");
  assert.equal(drawingClassificationLegacyKind(selection("exclusion_area")), null);
  assert.throws(() => parseDrawingClassification({ ...selection("pipeline"), placement: "overhead" }));
});

for (const id of ["field_boundary", "pipeline", "valve"]) {
  test(`preparation of ${id} preserves detached XY and unknown heights without committing`, () => {
    const original = input(id);
    const before = JSON.stringify(original);
    const prepared = prepareClassifiedDrawing(original);
    assert.equal(JSON.stringify(original), before);
    assert.equal(prepared.status, "prepared_not_committed");
    assert.equal(prepared.source, "map_digitized");
    assert.equal(prepared.confidence, "user_estimated");
    assert.equal(prepared.expectedEditorRevision, 4);
    assert.equal(prepared.geometry.type, original.classification.geometryType);
    assert.deepEqual(prepared.vertices, original.workflow.captures[0].vertices);
    assert(prepared.vertices.every(vertex => vertex.elevation === null && vertex.wgs84 === null));
    assert.equal(original.workflow.captures.length, 1);
    assert.equal(original.workflow.activeCaptureId, "a");
    assert.equal(Object.hasOwn(prepared, "saved"), false);
    prepared.vertices[0].point.x = 99;
    prepared.classification.name = "Changed";
    if (prepared.geometry.type === "Point") assert.equal(prepared.geometry.point.x, 0);
    else assert.equal(prepared.geometry.vertices[0].x, 0);
    assert.equal(JSON.stringify(original), before);
  });
}

test("preparation refuses stale revision, wrong frame/identity/type and paused or unfinished captures", () => {
  const original = input();
  const before = JSON.stringify(original);
  for (const patch of [{ expectedEditorRevision: 3 }, { editorRevision: -1 }, { editorRevision: 0.5 },
    { editorRevision: Number.MAX_SAFE_INTEGER, expectedEditorRevision: Number.MAX_SAFE_INTEGER },
    { projectCrs: "LOCAL:other" }, { captureId: "missing" }, { classification: selection("valve") }, { extra: true }]) {
    assert.throws(() => prepareClassifiedDrawing({ ...original, ...patch }));
  }
  for (const type of ["pause", "return_to_drawing"] as const) {
    const workflow = reduceDraftDrawingWorkflow(original.workflow, crs, { type, id: "a" });
    assert.throws(() => prepareClassifiedDrawing({ ...original, workflow }));
  }
  const invalid = structuredClone(original);
  invalid.workflow.captures[0].vertices = [];
  assert.throws(() => prepareClassifiedDrawing(invalid));
  const injected = structuredClone(original);
  Object.assign(injected.workflow.captures[0].vertices[0], { elevation: 10 });
  assert.throws(() => prepareClassifiedDrawing(injected));
  assert.equal(JSON.stringify(original), before);
});
