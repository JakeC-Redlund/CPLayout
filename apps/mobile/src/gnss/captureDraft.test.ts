import assert from "node:assert/strict";
import { test } from "node:test";
import { captureDraftMatchesProject, capturedDraftConfidence, type CapturedDraftVertex } from "./captureDraft";

const vertex = { projectId: "one", projectCrs: "EPSG:32613", confidence: "rtk_fixed" } as CapturedDraftVertex;
test("drafts remain scoped to the project and canonical CRS used for capture", () => {
  assert.equal(captureDraftMatchesProject([vertex], { id: "one", projectCrs: "EPSG:32613" }), true);
  assert.equal(captureDraftMatchesProject([vertex], { id: "two", projectCrs: "EPSG:32613" }), false);
  assert.equal(captureDraftMatchesProject([vertex], { id: "one", projectCrs: "EPSG:32614" }), false);
  assert.equal(captureDraftMatchesProject([vertex, { ...vertex, projectId: "two" }], { id: "one", projectCrs: "EPSG:32613" }), false);
});
test("saved draft confidence comes from the weakest captured vertex, not current receiver status", () => {
  assert.equal(capturedDraftConfidence([]), "user_estimated");
  assert.equal(capturedDraftConfidence([vertex]), "rtk_fixed");
  for (const confidence of ["rtk_float", "dgps", "autonomous_gps", "user_estimated"] as const) {
    assert.equal(capturedDraftConfidence([vertex, { ...vertex, confidence }, vertex]), confidence);
  }
  assert.equal(capturedDraftConfidence([{ ...vertex, confidence: "optimized" }]), "user_estimated");
});
