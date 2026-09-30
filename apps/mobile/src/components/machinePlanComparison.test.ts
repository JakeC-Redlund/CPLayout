import assert from "node:assert/strict";
import { test } from "node:test";
import { convertPivotProjectToFieldDesign, sampleProject, serializeProjectDocument } from "@cplayout/core";
import { compareMachinePlan, machinePlanPreviewFrame } from "./machinePlanComparison";

function machine(id: string) {
  const field = convertPivotProjectToFieldDesign(serializeProjectDocument(sampleProject), { fieldId: "review-field", waterSourceId: "water", powerSourceId: "power" }).field;
  return { ...field.machines[0], id };
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test("review identifies added, removed, moved, changed and unchanged machines without mutating inputs", () => {
  const current = [machine("moved"), machine("removed"), machine("updated"), machine("unchanged")];
  const proposed = [structuredClone(current[0]), structuredClone(current[2]), structuredClone(current[3]), machine("added")];
  proposed[0].pivotCenter.x += 0.1234567890123;
  proposed[1].configuration.overhangMeters += 1.234567890123;
  proposed[1].waterSourceId = "different-water";
  const before = JSON.stringify({ current, proposed });
  freeze(current); freeze(proposed);
  const review = compareMachinePlan(current, proposed);
  assert.deepEqual(Object.fromEntries(review.map(row => [row.id, row.status])), {
    moved: "moved", updated: "updated", unchanged: "unchanged", added: "added", removed: "removed",
  });
  assert.equal(review.find(row => row.id === "moved")!.moved, true);
  assert.deepEqual(review.find(row => row.id === "unchanged")!.values, []);
  assert.deepEqual(review.find(row => row.id === "updated")!.values.map(change => change.path), ["configuration.overhangMeters", "waterSourceId"]);
  assert.equal(JSON.stringify({ current, proposed }), before);
});

test("review exposes individual span edits, added and removed slots, and nested settings at exact stored precision", () => {
  const original = machine("pivot");
  original.configuration.spanLengthsMeters = [51.123456789123, 40.000000001, 28.987654321];
  original.configuration.sweep = { mode: "partial_circle", startAngleDegrees: 35, stopAngleDegrees: 270, direction: "clockwise" };
  const proposed = structuredClone(original);
  proposed.configuration.spanLengthsMeters = [51.123456789124, 40.000000001];
  proposed.configuration.sweep = { ...original.configuration.sweep, stopAngleDegrees: 260, direction: "counterclockwise" };
  const review = compareMachinePlan([original], [proposed])[0];
  assert.deepEqual(review.values, [
    { path: "configuration.spanLengthsMeters.0", before: 51.123456789123, after: 51.123456789124 },
    { path: "configuration.spanLengthsMeters.2", before: 28.987654321, after: undefined },
    { path: "configuration.sweep.direction", before: "clockwise", after: "counterclockwise" },
    { path: "configuration.sweep.stopAngleDegrees", before: 270, after: 260 },
  ]);
  const appended = structuredClone(original); appended.configuration.spanLengthsMeters.push(19.123456789);
  assert.deepEqual(compareMachinePlan([original], [appended])[0].values, [
    { path: "configuration.spanLengthsMeters.3", before: undefined, after: 19.123456789 },
  ]);
});

test("property order does not create false configuration changes, and additions show every saved span", () => {
  const original = machine("existing");
  const reordered = { ...structuredClone(original), configuration: Object.fromEntries(Object.entries(original.configuration).reverse()) } as typeof original;
  assert.equal(compareMachinePlan([original], [reordered])[0].status, "unchanged");
  const added = machine("added"); added.configuration.spanLengthsMeters = [12.123456789, 17.987654321];
  const row = compareMachinePlan([original], [original, added])[1];
  assert.equal(row.status, "added");
  assert.deepEqual(row.values.filter(change => change.path.startsWith("configuration.spanLengthsMeters")), [
    { path: "configuration.spanLengthsMeters.0", before: undefined, after: 12.123456789 },
    { path: "configuration.spanLengthsMeters.1", before: undefined, after: 17.987654321 },
  ]);
});

test("independent clones of empty optional arrays and objects remain unchanged without input mutation", () => {
  const original = machine("pivot");
  original.configuration.endGunAngleRanges = [];
  original.configuration.driveUnits = {};
  original.sourceFeatureIds = [];
  const proposed = structuredClone(original);
  assert.notEqual(original.configuration.endGunAngleRanges, proposed.configuration.endGunAngleRanges);
  assert.notEqual(original.configuration.driveUnits, proposed.configuration.driveUnits);
  assert.notEqual(original.sourceFeatureIds, proposed.sourceFeatureIds);
  const before = JSON.stringify({ original, proposed }); freeze(original); freeze(proposed);
  const row = compareMachinePlan([original], [proposed])[0];
  assert.equal(row.status, "unchanged"); assert.deepEqual(row.values, []);
  assert.equal(JSON.stringify({ original, proposed }), before);
});

test("absent optional containers becoming empty and empty containers becoming absent remain explicit changes", () => {
  const original = machine("pivot");
  delete original.configuration.endGunAngleRanges; delete original.configuration.driveUnits; delete original.sourceFeatureIds;
  const proposed = structuredClone(original);
  proposed.configuration.endGunAngleRanges = []; proposed.configuration.driveUnits = {}; proposed.sourceFeatureIds = [];
  const before = JSON.stringify({ original, proposed }); freeze(original); freeze(proposed);
  const expected = [
    { path: "configuration.driveUnits", before: undefined, after: {} },
    { path: "configuration.endGunAngleRanges", before: undefined, after: [] },
    { path: "sourceFeatureIds", before: undefined, after: [] },
  ];
  const added = compareMachinePlan([original], [proposed])[0];
  assert.equal(added.status, "updated"); assert.deepEqual(added.values, expected);
  const removed = compareMachinePlan([proposed], [original])[0];
  assert.equal(removed.status, "updated");
  assert.deepEqual(removed.values, expected.map(change => ({ path: change.path, before: change.after, after: change.before })));
  assert.equal(JSON.stringify({ original, proposed }), before);
});

test("container shape changes cannot disappear even when their keys and lengths are empty", () => {
  const original = machine("pivot"); original.configuration.driveUnits = {};
  // Defensive comparison only: malformed shapes are never admitted or adopted by this model.
  const proposed = { ...structuredClone(original), configuration: { ...structuredClone(original.configuration), driveUnits: [] } } as unknown as typeof original;
  const before = JSON.stringify({ original, proposed }); freeze(original); freeze(proposed);
  assert.deepEqual(compareMachinePlan([original], [proposed])[0].values, [
    { path: "configuration.driveUnits", before: {}, after: [] },
  ]);
  assert.deepEqual(compareMachinePlan([proposed], [original])[0].values, [
    { path: "configuration.driveUnits", before: [], after: {} },
  ]);
  assert.equal(JSON.stringify({ original, proposed }), before);
});

test("Current and Proposed share one screen transform, exposing moved locations without changing canonical XY", () => {
  const original = machine("pivot"); original.pivotCenter = { x: 100.123456789, y: 200.987654321 };
  const proposed = structuredClone(original); proposed.pivotCenter.x += 100;
  const boundary = freeze([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }]);
  const before = JSON.stringify({ original, proposed, boundary }); freeze(original); freeze(proposed);
  const screen = machinePlanPreviewFrame(boundary, [original], [proposed])!;
  assert.notEqual(screen(original.pivotCenter).x, screen(proposed.pivotCenter).x);
  assert.equal(screen(original.pivotCenter).y, screen(proposed.pivotCenter).y);
  assert.equal(JSON.stringify({ original, proposed, boundary }), before);
  assert.equal(machinePlanPreviewFrame([], [], []), null);
});
