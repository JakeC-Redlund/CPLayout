import assert from "node:assert/strict";
import test from "node:test";
import { serializeDesignDraftDocument, tryBuildPivotProject } from "@cplayout/core";
import { newDesignDraft } from "./newDesignDraft";

test("new designs contain no invented CRS, geometry or machine inputs", () => {
  for (const units of ["metric", "us_survey_feet"] as const) {
    const draft = newDesignDraft("test-draft", "New field", units);
    assert.equal(draft.projectCrs, null);
    assert.deepEqual(draft.fieldBoundary, []);
    assert.equal(draft.pivotCenter, null);
    assert.equal(draft.waterSource, null);
    assert.equal(draft.powerSource, null);
    assert.deepEqual(draft.machine, {});
    assert.equal(draft.settings.unitSystem, units);
    assert.equal(tryBuildPivotProject(draft).ok, false);
    assert.ok(serializeDesignDraftDocument(draft));
  }
});

test("new design settings are detached between creations", () => {
  const first = newDesignDraft("one", "One", "metric");
  const second = newDesignDraft("two", "Two", "metric");
  first.settings.unitSystem = "us_survey_feet";
  assert.equal(second.settings.unitSystem, "metric");
});
