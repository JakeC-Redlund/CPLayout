import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultProjectSettings, sampleProject, VALLEY_CORNER_ARM_SCAFFOLD_CATALOG } from "@cplayout/core";
import { cornerArmInputScope, cornerArmInputsForPreview, cornerGuidanceCandidates, initialCornerArmInputs, type CornerArmInputDraft } from "./cornerArmInputs";

const project = () => ({ ...structuredClone(sampleProject), mapFeatures: [
  { id: "first", name: "Unrelated linear path", kind: "linear_move_path" as const, confidence: "user_estimated" as const,
    geometry: { type: "LineString" as const, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] } },
  { id: "chosen", name: "Measured SDU path", kind: "measurement_line" as const, confidence: "user_estimated" as const,
    geometry: { type: "LineString" as const, vertices: [{ x: 1, y: 1 }, { x: 20, y: 1 }] } },
] });

test("input scope survives view/clearance settings changes but changes with machine or guidance geometry", () => {
  const source = project();
  const scope = cornerArmInputScope(source);
  const changed = structuredClone(source);
  changed.settings = defaultProjectSettings();
  changed.settings.layoutReview.requiredBoundaryClearanceMeters = 42;
  changed.name = "Renamed";
  assert.equal(cornerArmInputScope(changed), scope);
  changed.mapFeatures[1].geometry.vertices[0].x++;
  assert.notEqual(cornerArmInputScope(changed), scope);
  changed.mapFeatures = structuredClone(source.mapFeatures);
  changed.machine.spanLengthsMeters[0]++;
  assert.notEqual(cornerArmInputScope(changed), scope);
});

test("missing full-circle choices never select a catalog model or unrelated first line", () => {
  const source = project();
  source.machine.sweep = { mode: "full_circle" };
  const draft = initialCornerArmInputs(source);
  assert.equal(draft.modelId, "");
  assert.equal(draft.guidanceFeatureId, "");
  assert.equal(draft.rotation, "");
  const result = cornerArmInputsForPreview(source, draft, 1);
  assert.equal(result.inputs.guidancePath, undefined);
  assert.equal(result.inputs.rotationDirection, undefined);
  assert.equal(result.inputs.modelSpec, undefined);
  assert.ok(result.missing.includes("Steerable corner tower guidance line"));
});

test("selected lines and model metadata are copied without changing canonical project or qualification", () => {
  const source = project();
  source.machine.sweep = { mode: "full_circle" };
  const before = structuredClone(source);
  const catalogBefore = structuredClone(VALLEY_CORNER_ARM_SCAFFOLD_CATALOG);
  const draft = { ...initialCornerArmInputs(source), speed: "1.25", modelId: VALLEY_CORNER_ARM_SCAFFOLD_CATALOG[0].id,
    guidanceFeatureId: "chosen", rotation: "clockwise" as const, orientation: "trailing" as const };
  const result = cornerArmInputsForPreview(source, draft, 1);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.inputs.guidancePath, source.mapFeatures[1].geometry.vertices);
  assert.equal(result.inputs.modelSpec?.sourceStatus, "scaffold_only");
  assert.ok(Math.abs(result.inputs.lrduSpeedMetersPerMinuteAt100Percent! - 0.381) < 1e-10);
  result.inputs.guidancePath![0].x = 999;
  result.inputs.fieldBoundary![0].x = 999;
  result.inputs.pivotCenter!.x = 999;
  result.inputs.modelSpec!.notes.push("temporary");
  result.inputs.modelSpec!.sourceRefs[0].title = "temporary";
  assert.deepEqual(source, before);
  assert.deepEqual(VALLEY_CORNER_ARM_SCAFFOLD_CATALOG, catalogBefore);
});

test("invalid speeds stay missing rather than becoming zero, hex or Infinity", () => {
  for (const speed of ["", " ", ".", "0", "0.0", "-1", "0x10", "1e3", "Infinity", "NaN", "1,2", "1.2m", "1 ft/min", "9".repeat(400)]) {
    const source = project();
    const result = cornerArmInputsForPreview(source, { ...initialCornerArmInputs(source), speed }, 1);
    assert.equal(result.inputs.lrduSpeedMetersPerMinuteAt100Percent, undefined, speed);
    assert.ok(result.missing.includes("Positive last regular drive tower speed in ft/min"), speed);
  }
});

test("guidance identity requires one finite nondegenerate line and does not survive deletion", () => {
  const source = project();
  const selected = { ...initialCornerArmInputs(source), guidanceFeatureId: "chosen" };
  source.mapFeatures[1].geometry.vertices[1] = { x: 1, y: 1 };
  assert.equal(cornerArmInputsForPreview(source, selected, 1).inputs.guidancePath, undefined);
  source.mapFeatures[1].geometry.vertices[1] = { x: NaN, y: 1 };
  assert.deepEqual(cornerGuidanceCandidates(source).map(f => f.id), ["first"]);
  source.mapFeatures[1].geometry.vertices[1] = { x: 2, y: 1 };
  source.mapFeatures.push(structuredClone(source.mapFeatures[1]));
  assert.equal(cornerArmInputsForPreview(source, selected, 1).inputs.guidancePath, undefined);
  source.mapFeatures = source.mapFeatures.slice(0, 1);
  assert.equal(cornerArmInputsForPreview(source, selected, 1).inputs.guidancePath, undefined);
});

test("saved measured speed and partial direction are retained, contradictory direction is blocked", () => {
  const source = project();
  source.machine.sweep = { mode: "partial_circle", direction: "counterclockwise", startAngleDegrees: 0, stopAngleDegrees: 90 };
  source.machine.driveUnits = { ...source.machine.driveUnits, lrdu: { role: "lrdu", advisoryOnly: true, sourceRefs: [], caveats: [], operatorMeasuredSpeedMetersPerMinute: 3 } };
  const draft = initialCornerArmInputs(source);
  assert.equal(draft.speedUnit, "ft/min");
  assert.ok(Math.abs(Number(draft.speed) - 9.842519685) < 1e-10);
  assert.ok(Math.abs(cornerArmInputsForPreview(source, draft, 1).inputs.lrduSpeedMetersPerMinuteAt100Percent! - 3) < 1e-12);
  assert.equal(draft.rotation, "counterclockwise");
  assert.ok(cornerArmInputsForPreview(source, { ...draft, rotation: "clockwise" }, 1).missing.includes("Rotation must match the saved partial sweep"));
});

test("US speed converts feet per minute to canonical meters per minute without changing raw text", () => {
  const source = project();
  for (const [speed, metersPerMinute] of [["100", 30.48], [" .5 ", 0.1524], ["1.", 0.3048], ["001.2500", 0.381]] as const) {
    const draft = { ...initialCornerArmInputs(source), speed };
    const before = structuredClone(draft);
    const result = cornerArmInputsForPreview(source, draft, 1);
    assert.ok(Math.abs(result.inputs.lrduSpeedMetersPerMinuteAt100Percent! - metersPerMinute) < 1e-8, speed);
    assert.deepEqual(draft, before);
  }
});

test("raw US speed ownership survives preference changes and use with another project", () => {
  const source = project();
  source.settings = defaultProjectSettings();
  const scope = cornerArmInputScope(source);
  const draft = { ...initialCornerArmInputs(source), speed: "010.00" };
  const before = structuredClone(draft);
  source.settings.unitSystem = "metric";
  assert.equal(cornerArmInputScope(source), scope);
  assert.equal(initialCornerArmInputs(source).speedUnit, "ft/min");
  const result = cornerArmInputsForPreview(source, draft, 1);
  assert.ok(Math.abs(result.inputs.lrduSpeedMetersPerMinuteAt100Percent! - 3.048) < 1e-9);
  const another = { ...source, id: "another-project" };
  assert.notEqual(cornerArmInputScope(another), scope);
  assert.equal(cornerArmInputsForPreview(another, draft, 1).inputs.lrduSpeedMetersPerMinuteAt100Percent,
    result.inputs.lrduSpeedMetersPerMinuteAt100Percent);
  assert.deepEqual(draft, before);
});

test("unowned or unsupported raw speed units require re-entry instead of reinterpretation", () => {
  const source = project();
  for (const speedUnit of [undefined, "m/min", "", "mph"]) {
    const draft = { ...initialCornerArmInputs(source), speed: "3", speedUnit } as unknown as CornerArmInputDraft;
    const result = cornerArmInputsForPreview(source, draft, 1);
    assert.equal(result.inputs.lrduSpeedMetersPerMinuteAt100Percent, undefined);
    assert.ok(result.missing.includes("Positive last regular drive tower speed in ft/min"));
    assert.equal(draft.speed, "3");
  }
});

test("missing or invalid measured seeds stay empty without substituting catalog speeds", () => {
  for (const speed of [undefined, 0, -1, NaN, Infinity, Number.MAX_VALUE]) {
    const source = project();
    source.machine.driveUnits = { ...source.machine.driveUnits, lrdu: {
      role: "lrdu", advisoryOnly: true, sourceRefs: [], caveats: [], operatorMeasuredSpeedMetersPerMinute: speed,
    } };
    const before = structuredClone(source);
    const draft = initialCornerArmInputs(source);
    assert.equal(draft.speed, "");
    assert.equal(draft.speedUnit, "ft/min");
    assert.equal(cornerArmInputsForPreview(source, draft, 1).inputs.lrduSpeedMetersPerMinuteAt100Percent, undefined);
    assert.deepEqual(source, before);
  }
});
