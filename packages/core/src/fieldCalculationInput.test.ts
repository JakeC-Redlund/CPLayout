import assert from "node:assert/strict";
import test from "node:test";
import { createFieldCalculationInput, fieldCalculationInputMatches } from "./fieldCalculationInput";
import { convertPivotProjectToFieldDesign } from "./fieldDesignDocument";
import { sampleProject } from "./sampleProject";

function fixture() {
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), {
    fieldId: "calculation-field", waterSourceId: "water", powerSourceId: "power",
  }).field;
  const second = structuredClone(field.machines[0]);
  second.id = "second";
  second.configuration.spanLengthsMeters = [30, 45];
  second.pivotCenter.x += 500;
  field.machines.push(second);
  field.mapFeatures = ["own", "other", "outline"].map((id, index) => ({
    id, name: id, kind: "corner_swing_limit", confidence: "user_estimated",
    geometry: { type: "LineString", vertices: [{ x: index, y: 2 }, { x: index + 5, y: 9 }] },
  }));
  field.machines[0].cornerGuidanceFeatureId = "own";
  field.machines[0].sourceFeatureIds = ["outline"];
  field.machines[1].cornerGuidanceFeatureId = "other";
  return field;
}

test("unequal machines receive detached exact inputs and explicit evidence independent of feature order", () => {
  const field = fixture();
  const before = structuredClone(field);
  const first = createFieldCalculationInput(field, { machineId: field.machines[0].id, inputRevision: 7 });
  const second = createFieldCalculationInput(field, { machineId: "second", inputRevision: 7 });
  assert.equal(first.status, "ready");
  assert.equal(second.status, "ready");
  if (first.status !== "ready" || second.status !== "ready") throw new Error("Expected supported UTM fixture.");
  assert.deepEqual(first.project.machine, { id: field.machines[0].id, ...field.machines[0].configuration });
  assert.deepEqual(second.project.machine.spanLengthsMeters, [30, 45]);
  assert.equal(first.guidanceFeature?.id, "own");
  assert.equal(second.guidanceFeature?.id, "other");
  assert.deepEqual(first.sourceFeatures.map(feature => feature.id), ["outline"]);
  assert.deepEqual(second.sourceFeatures, []);
  assert.deepEqual(first.project.mapFeatures, [], "Legacy radial evidence inference never receives field guidance");
  field.mapFeatures!.reverse();
  field.mapFeatures!.find(feature => feature.id === "other")!.name = "Changed sibling only";
  assert.deepEqual(createFieldCalculationInput(field, { machineId: field.machines[0].id, inputRevision: 7 }), first);
  first.project.fieldBoundary[0].x += 1;
  first.project.machine.spanLengthsMeters[0] += 10;
  first.guidanceFeature!.name = "Detached";
  assert.deepEqual(field.fieldBoundary, before.fieldBoundary);
  assert.deepEqual(field.machines, before.machines);
  assert.notEqual(second.project.machine.spanLengthsMeters[0], first.project.machine.spanLengthsMeters[0]);
});

test("missing connections return blockers without fabricated calculation coordinates", () => {
  const field = fixture();
  delete field.machines[0].waterSourceId;
  delete field.machines[0].powerSourceId;
  const input = createFieldCalculationInput(field, { machineId: field.machines[0].id, inputRevision: 0 });
  assert.equal(input.status, "unsupported");
  assert.deepEqual(input.blockers.map(issue => issue.code), ["water_source_missing", "power_source_missing"]);
  assert.equal("project" in input, false);
  assert.equal("waterSource" in input, false);
  assert.equal("powerSource" in input, false);
});

test("metric local declaration propagates without changing CRS, XY or field qualification", () => {
  const field = fixture();
  field.projectCrs = "LOCAL:survey-grid";
  const request = { machineId: field.machines[0].id, inputRevision: 2 };
  const unqualified = createFieldCalculationInput(field, request);
  assert.equal(unqualified.status, "unsupported");
  assert(unqualified.blockers.some(issue => issue.code === "local_metric_declaration_missing"));
  const crsOptions = { localMetricDeclaration: { projectCrs: field.projectCrs, unit: "metre" as const,
    axes: "orthogonal_xy" as const, evidenceReference: "operator recorded grid definition" } };
  const qualified = createFieldCalculationInput(field, { ...request, crsOptions });
  assert.equal(qualified.status, "ready");
  if (qualified.status !== "ready") throw new Error("Expected explicit local admission.");
  assert.equal(qualified.project.projectCrs, field.projectCrs);
  assert.deepEqual(qualified.project.fieldBoundary, field.fieldBoundary);
  assert.deepEqual(qualified.crsOptions, crsOptions);
  crsOptions.localMetricDeclaration.evidenceReference = "Changed caller";
  assert.notDeepEqual(qualified.crsOptions, crsOptions);
  assert.equal(qualified.crsQualification.calculation.space, "local_plane");
  assert.equal(qualified.crsQualification.field.qualified, false);
  assert.equal(qualified.crsQualification.field.accuracy3dQualified, false);
  const wrong = createFieldCalculationInput(field, { ...request, crsOptions: {
    localMetricDeclaration: { ...crsOptions.localMetricDeclaration, projectCrs: "LOCAL:other" },
  } });
  assert(wrong.blockers.some(issue => issue.code === "local_metric_declaration_invalid"));
  field.projectCrs = "EPSG:3857";
  assert(createFieldCalculationInput(field, request).blockers.some(issue => issue.code === "web_mercator_display_only"));
});

test("stale revisions and unknown machines reject; delayed identity checks cover all key parts", () => {
  const field = fixture();
  const machineId = field.machines[0].id;
  assert.throws(() => createFieldCalculationInput(field, { machineId, inputRevision: 4, expectedRevision: 3 }), /revision changed/);
  assert.throws(() => createFieldCalculationInput(field, { machineId: "missing", inputRevision: 4 }), /not found/);
  for (const revision of [-1, Infinity, Number.MAX_SAFE_INTEGER + 1, 0.5]) {
    assert.throws(() => createFieldCalculationInput(field, { machineId, inputRevision: revision }));
  }
  const input = createFieldCalculationInput(field, { machineId, inputRevision: 4 });
  assert(fieldCalculationInputMatches(input, field, machineId, 4));
  assert(!fieldCalculationInputMatches(input, field, machineId, 5));
  assert(!fieldCalculationInputMatches(input, field, "second", 4));
  assert(!fieldCalculationInputMatches(input, { id: "another-field" }, machineId, 4));
});

test("numerical safety blockers remain explicit and the field stays unchanged", () => {
  const field = fixture();
  field.machines[0].configuration.spanLengthsMeters = [1e300, 1e300];
  const before = JSON.stringify(field);
  const result = createFieldCalculationInput(field, { machineId: field.machines[0].id, inputRevision: 0 });
  assert.equal(result.status, "unsupported");
  assert(result.blockers.length > 0);
  assert.equal("project" in result, false);
  assert.equal(JSON.stringify(field), before);
});
