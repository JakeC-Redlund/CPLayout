import assert from "node:assert/strict";
import { test } from "node:test";
import { convertPivotProjectToFieldDesign, serializeProjectDocument, sampleProject, validateFieldDesign } from "@cplayout/core";
import { assertSameFieldPlanContext, fieldCoordinatesInFeet, fieldMachineInputs, parseFieldMachineInputs } from "./fieldMachineInputs";

function field() { return convertPivotProjectToFieldDesign(serializeProjectDocument(sampleProject), { fieldId: "field", waterSourceId: "water", powerSourceId: "power" }).field; }

test("editing one length retains every unrelated configuration and sibling", () => {
  const current = field();
  const original = current.machines[0];
  const before = JSON.stringify(current);
  const input = fieldMachineInputs(original, current);
  const edited = parseFieldMachineInputs({ ...input, overhang: "32' 6\"" }, original.id, original, current);
  assert(Math.abs(edited.configuration.overhangMeters - 9.906) < 1e-9);
  assert.deepEqual({ ...edited, configuration: { ...edited.configuration, overhangMeters: original.configuration.overhangMeters } }, original);
  assert.equal(JSON.stringify(current), before);
  validateFieldDesign({ ...current, machines: [edited, { ...original, id: "sibling" }] });
});
test("unchanged form retains exact floating point values and optional fields", () => {
  const original = field().machines[0];
  original.configuration.spanLengthsMeters = [51.123456789123, 40.000000001];
  original.pivotCenter = { x: 501234.123456789, y: 4500000.987654321 };
  delete original.configuration.endGunAngleRanges;
  assert.deepEqual(parseFieldMachineInputs(fieldMachineInputs(original, field()), original.id, original, field()), original);
});
test("blank and nonnumeric lengths cannot become zero", () => {
  const context = field(); const original = context.machines[0]; const input = fieldMachineInputs(original, context);
  for (const spans of [[], [""], ["20", ""], ["20", "NaN"], ["20", "Infinity"], ["20,30"]]) assert.throws(() => parseFieldMachineInputs({ ...input, spans }, original.id, original, context));
  assert.throws(() => parseFieldMachineInputs({ ...input, x: " " }, original.id, original, context));
});
test("machine plan import rejects any changed shared field context", () => {
  const current = field();
  assert.doesNotThrow(() => assertSameFieldPlanContext(current, { ...current, machines: [] }));
  assert.throws(() => assertSameFieldPlanContext(current, { ...current, name: "Other" }), /different field information/);
  assert.throws(() => assertSameFieldPlanContext(current, { ...current, infrastructure: [] }), /different field information/);
});


test("feet inputs change only their owned distances and coordinates", () => {
  const context = field(); const original = context.machines[0];
  original.configuration.spanLengthsMeters = [51.123456789123, 40.000000001];
  const input = fieldMachineInputs(original, context);
  const edited = parseFieldMachineInputs({ ...input, spans: [input.spans[0], "100' 6\""], x: "1000", y: "2000" }, original.id, original, context);
  assert.equal(edited.configuration.spanLengthsMeters[0], original.configuration.spanLengthsMeters[0]);
  assert(Math.abs(edited.configuration.spanLengthsMeters[1] - 30.6324) < 1e-8);
  assert(Math.abs(edited.pivotCenter.x - 304.8) < 1e-8);
  assert(Math.abs(edited.pivotCenter.y - 609.6) < 1e-8);
  assert.equal(edited.configuration.overhangMeters, original.configuration.overhangMeters);
});
test("unknown LOCAL units cannot relabel or mutate raw coordinates", () => {
  const original = field().machines[0]; const context = { projectCrs: "LOCAL:feet-in-name-is-not-evidence" };
  assert.equal(fieldCoordinatesInFeet(context), false);
  const input = fieldMachineInputs(original, context);
  assert.equal(input.x, ""); assert.equal(input.y, "");
  assert.deepEqual(parseFieldMachineInputs(input, original.id, original, context), original);
  assert.throws(() => parseFieldMachineInputs({ ...input, x: "100" }, original.id, original, context), /Confirm the location units/);
  assert.throws(() => parseFieldMachineInputs(input, "new", undefined, context), /Confirm the location units/);
  assert(fieldCoordinatesInFeet({ projectCrs: "LOCAL:test", crsOptions: { localMetricDeclaration: {
    projectCrs: "LOCAL:test", unit: "metre", axes: "orthogonal_xy", evidenceReference: "survey declaration" } } }));
});
test("editing a name retains the exact saved snapshot behind rounded feet", () => {
  const context = field(); const original = context.machines[0];
  original.pivotCenter.x += 0.123456789; original.configuration.overhangMeters += 0.00123456789;
  const edited = parseFieldMachineInputs({ ...fieldMachineInputs(original, context), name: "New name" }, original.id, original, context);
  assert.deepEqual({ ...edited, configuration: { ...edited.configuration, name: original.configuration.name } }, original);
});

test("append and remove last span preserve exact original slots", () => {
  const context = field(); const original = context.machines[0];
  original.configuration.spanLengthsMeters = [51.123456789123, 40.000000001];
  const input = fieldMachineInputs(original, context);
  const appended = parseFieldMachineInputs({ ...input, spans: [...input.spans, "100"] }, original.id, original, context);
  assert.deepEqual(appended.configuration.spanLengthsMeters.slice(0, 2), original.configuration.spanLengthsMeters);
  const removed = parseFieldMachineInputs({ ...input, spans: input.spans.slice(0, -1) }, original.id, original, context);
  assert.deepEqual(removed.configuration.spanLengthsMeters, original.configuration.spanLengthsMeters.slice(0, -1));
});
