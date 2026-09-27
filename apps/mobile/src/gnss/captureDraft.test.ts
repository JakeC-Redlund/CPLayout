import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultAppSettings } from "@cplayout/core";
import { canCommitCapturedDraft, captureThresholdsForWorkflow, captureDraftMatchesProject, capturedDraftConfidence, type CapturedDraftVertex } from "./captureDraft";

const vertex = { projectId: "one", projectCrs: "EPSG:32613", confidence: "rtk_fixed" } as CapturedDraftVertex;

test("Layout enforces fixed capture without weakening other thresholds or mutating settings", () => {
  const settings = defaultAppSettings();
  settings.gpsQuality.minimumFixType = "rtk_float";
  assert.equal(captureThresholdsForWorkflow(settings), settings.gpsQuality);
  settings.mappingWorkflowMode = "layout";
  assert.deepEqual(captureThresholdsForWorkflow(settings), { ...settings.gpsQuality, minimumFixType: "rtk_fixed" });
  assert.equal(settings.gpsQuality.minimumFixType, "rtk_float");
});

test("Layout draft commits require a live gate and fixed hardware evidence at every vertex", () => {
  const fixed = { ...vertex, evidence: { schemaVersion: "gnss-capture-v2", transport: "web_serial", qualityScreen: { receiverQuality: { fixType: "rtk_fixed" } } } } as CapturedDraftVertex;
  assert.equal(canCommitCapturedDraft("layout", true, [fixed]), true);
  assert.equal(canCommitCapturedDraft("layout", false, [fixed]), false);
  assert.equal(canCommitCapturedDraft("layout", true, []), false);
  assert.equal(canCommitCapturedDraft("layout", true, [fixed, { ...fixed, confidence: "rtk_float" }]), false);
  const floatEvidence = { ...fixed, evidence: { ...fixed.evidence, qualityScreen: { receiverQuality: { fixType: "rtk_float" } } } } as CapturedDraftVertex;
  assert.equal(canCommitCapturedDraft("layout", true, [floatEvidence]), false);
  assert.equal(canCommitCapturedDraft("design", false, [floatEvidence]), true);
  assert.equal(canCommitCapturedDraft("layout", true, [fixed, floatEvidence]), false);
  assert.equal(canCommitCapturedDraft("layout", true, [{ ...fixed, evidence: { ...fixed.evidence, transport: "replay" } }]), false);
  assert.equal(canCommitCapturedDraft("layout", true, [{ ...fixed, evidence: { schemaVersion: "gnss-capture-v1" } as CapturedDraftVertex["evidence"] }]), false);
  assert.equal(canCommitCapturedDraft("design", false, [vertex]), true);
});
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
