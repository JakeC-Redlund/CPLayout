import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleProject } from "./sampleProject";
import { createProjectEditorState, reduceProjectEditorState, type ProjectEditorAction } from "./projectReducer";
import { createManualDesignDraft, evaluateManualDesignReadiness, applyManualDesignDraft } from "./manualDesign";
import { parseProjectDocument, serializeProjectDocument } from "./projectDocument";
import type { ProjectMapFeature } from "./types";

const circle: ProjectMapFeature = {
  id: "metric-circle", name: "Metric circle", kind: "machine_zone", confidence: "user_estimated",
  geometry: { type: "Circle", center: sampleProject.pivotCenter, radiusMeters: 20 },
};

for (const projectCrs of ["EPSG:26741", "LOCAL:TEST", "EPSG:3857", "EPSG:26723"]) {
  test(`${projectCrs} stays readable while mixed-unit design mutations are atomic rejections`, () => {
    const input = { ...sampleProject, projectCrs, mapFeatures: [circle] };
    const original = JSON.stringify(input);
    const state = createProjectEditorState(input);
    assert.equal(state.lastError, null);
    const reopened = parseProjectDocument(serializeProjectDocument(state.project));
    assert.equal(reopened.projectCrs, projectCrs);
    assert.deepEqual(reopened.fieldBoundary, input.fieldBoundary);
    assert.deepEqual(reopened.mapFeatures, input.mapFeatures);
    const draft = createManualDesignDraft(state.project, state.revision);
    const readiness = evaluateManualDesignReadiness(draft);
    assert.equal(readiness.ready, false);
    assert.deepEqual(readiness.outsideFieldResult, { status: "not_evaluated", minimumClearanceMeters: null, exact: false });
    assert.equal(readiness.topologyIssues.length, 0);
    const actions: ProjectEditorAction[] = [
      { type: "move_map_feature_circle_radius_handle", featureId: circle.id, point: { x: circle.geometry.type === "Circle" ? circle.geometry.center.x + 50 : 0, y: input.pivotCenter.y } },
      { type: "upsert_map_features", features: [{ ...circle, id: "new-circle" }] },
      { type: "update_map_feature", feature: circle },
      { type: "apply_manual_design", draft },
      { type: "apply_manual_design", draft: { ...draft, projectCrs: "EPSG:32613" } },
    ];
    for (const action of actions) {
      const next = reduceProjectEditorState(state, action);
      assert.match(next.lastError ?? "", /Metric planar calculations unavailable/i, action.type);
      assert.equal(next.project, state.project);
      assert.equal(next.past, state.past);
      assert.equal(next.future, state.future);
      assert.equal(next.revision, state.revision);
    }
    const changed = reduceProjectEditorState(state, { type: "delete_map_feature", id: circle.id });
    assert.equal(changed.lastError, null);
    const undone = reduceProjectEditorState(changed, { type: "undo" });
    assert.equal(undone.project, state.project);
    assert.equal(JSON.stringify(input), original);
  });
}

test("a draft cannot cross project CRS even when both grids use metres", () => {
  const draft = createManualDesignDraft(sampleProject, 0);
  assert.throws(() => applyManualDesignDraft(sampleProject, { ...draft, projectCrs: "EPSG:32614" }, 0), /CRS does not match/);
});
