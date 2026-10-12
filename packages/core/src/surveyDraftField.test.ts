import assert from "node:assert/strict";
import test from "node:test";
import { sampleProject } from "./sampleProject";
import { serializeDesignDraftDocument, type DesignDraft } from "./designDraft";
import { defaultProjectSettings } from "./settings";
import { convertSurveyDraftToField } from "./surveyDraftField";

const identities = { fieldId: "new-field", waterSourceId: "unused-water", powerSourceId: "unused-power" };
function supplied(): DesignDraft {
  const draft = { ...structuredClone(sampleProject), settings: { ...defaultProjectSettings(), unitSystem: sampleProject.unitSystem }, waterSource: null, powerSource: null };
  delete draft.machine.endGunAngleRanges;
  return draft;
}
test("direct preparation preserves exact noncanonical source, supplied pose/configuration and unknown infrastructure without a planning Project", () => {
  const draft = supplied(), canonical = serializeDesignDraftDocument(draft), text = `\r\n ${JSON.stringify(JSON.parse(canonical), null, 2).replaceAll("\n", "\r\n")} \r\n`, before = JSON.stringify(draft);
  const prepared = convertSurveyDraftToField(text, identities);
  assert.equal(prepared.originalDraftDocument, text); assert.equal(JSON.stringify(draft), before);
  assert.deepEqual(prepared.field.infrastructure, []); assert.deepEqual(prepared.field.fieldBoundary, draft.fieldBoundary); assert.deepEqual(prepared.field.surveyPoints, draft.surveyPoints);
  const { id, ...configuration } = draft.machine; assert.equal(prepared.field.machines[0].id, id); assert.deepEqual(prepared.field.machines[0].configuration, configuration); assert.deepEqual(prepared.field.machines[0].pivotCenter, draft.pivotCenter);
  assert.equal(prepared.field.machines[0].waterSourceId, undefined); assert.equal(prepared.field.machines[0].powerSourceId, undefined); assert.equal(prepared.field.machines[0].configuration.endGunAngleRanges, undefined);
});
test("machine-free fields are truthful; incomplete supplied machine/pose and missing boundary refuse without dropping source", () => {
  const draft = { ...supplied(), machine: {}, pivotCenter: null }, source = serializeDesignDraftDocument(draft);
  assert.deepEqual(convertSurveyDraftToField(source, identities).field.machines, []);
  for (const incomplete of [{ ...draft, machine: { name: "Actual partial" } }, { ...draft, pivotCenter: sampleProject.pivotCenter }, { ...draft, fieldBoundary: [] }, { ...draft, projectCrs: null }]) {
    const text = JSON.stringify({ documentVersion: "design-draft-v3", draft: incomplete }); assert.throws(() => convertSurveyDraftToField(text, identities), /Supply|Choose|projectCrs/); assert.equal(JSON.stringify({ documentVersion: "design-draft-v3", draft: incomplete }), text);
  }
});
