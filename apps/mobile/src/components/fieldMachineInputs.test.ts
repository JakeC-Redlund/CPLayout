import assert from "node:assert/strict";
import { test } from "node:test";
import { convertPivotProjectToFieldDesign, serializeProjectDocument, sampleProject, validateFieldDesign } from "@cplayout/core";
import { assertSameFieldPlanContext, fieldMachineInputs, parseFieldMachineInputs } from "./fieldMachineInputs";

function field() { return convertPivotProjectToFieldDesign(serializeProjectDocument(sampleProject), { fieldId: "field", waterSourceId: "water", powerSourceId: "power" }).field; }

test("editing one length retains every unrelated configuration and sibling", () => {
  const current = field();
  const original = current.machines[0];
  const before = JSON.stringify(current);
  const input = fieldMachineInputs(original);
  const edited = parseFieldMachineInputs({ ...input, overhang: String(original.configuration.overhangMeters + 1) }, original.id, original);
  assert.deepEqual({ ...edited, configuration: { ...edited.configuration, overhangMeters: original.configuration.overhangMeters } }, original);
  assert.equal(JSON.stringify(current), before);
  validateFieldDesign({ ...current, machines: [edited, { ...original, id: "sibling" }] });
});
test("unchanged form retains exact floating point values and optional fields", () => {
  const original = field().machines[0];
  original.configuration.spanLengthsMeters = [51.123456789123, 40.000000001];
  delete original.configuration.endGunAngleRanges;
  assert.deepEqual(parseFieldMachineInputs(fieldMachineInputs(original), original.id, original), original);
});
test("blank and nonnumeric lengths cannot become zero", () => {
  const original = field().machines[0]; const input = fieldMachineInputs(original);
  for (const spans of ["", "20,", "20,NaN", "20,Infinity"]) assert.throws(() => parseFieldMachineInputs({ ...input, spans }, original.id, original));
  assert.throws(() => parseFieldMachineInputs({ ...input, x: " " }, original.id, original));
});
test("machine plan import rejects any changed shared field context", () => {
  const current = field();
  assert.doesNotThrow(() => assertSameFieldPlanContext(current, { ...current, machines: [] }));
  assert.throws(() => assertSameFieldPlanContext(current, { ...current, name: "Other" }), /different field information/);
  assert.throws(() => assertSameFieldPlanContext(current, { ...current, infrastructure: [] }), /different field information/);
});
