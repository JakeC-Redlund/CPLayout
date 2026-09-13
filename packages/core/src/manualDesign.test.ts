import assert from "node:assert/strict";

import {
  applyManualDesignDraft,
  buildMachinePathSummary,
  createManualDesignDraft,
  evaluateManualDesignReadiness,
} from "./manualDesign";
import { createProjectEditorState, reduceProjectEditorState } from "./projectReducer";
import { sampleProject } from "./sampleProject";

const summary = buildMachinePathSummary({
  spanLengthsMeters: [100, 50],
  overhangMeters: 0,
  endGunThrowMeters: 12,
});
assert.deepEqual(summary, {
  lastWheelRadiusMeters: 150,
  endMachineRadiusMeters: 150,
  endGunReachMeters: 162,
  coincidentLastWheelAndMachineEnd: true,
});

const initialState = createProjectEditorState(sampleProject);
const originalProject = initialState.project;
const draft = createManualDesignDraft(originalProject, initialState.revision);
const center = originalProject.pivotCenter;
draft.boundary = {
  source: "projected_xy",
  vertices: [
    { x: center.x - 100, y: center.y - 100 },
    { x: center.x + 100, y: center.y - 100 },
    { x: center.x + 100, y: center.y + 100 },
    { x: center.x - 100, y: center.y + 100 },
  ],
};
draft.machine = {
  value: {
    ...originalProject.machine,
    spanLengthsMeters: [30, 20],
    overhangMeters: 0,
    endGunThrowMeters: 0,
  },
  lastWheelSource: "machine_specs",
  machineEndSource: "machine_specs",
};
draft.radiusEvidence = [{
  role: "last_wheel",
  source: "rtk_evidence",
  confidence: "rtk_fixed",
  occupations: [{ point: { x: center.x + 50, y: center.y } }],
}];

const readiness = evaluateManualDesignReadiness(draft);
assert.equal(readiness.ready, true);
assert.equal(readiness.pivotContainment, "inside");
assert.equal(readiness.paths?.coincidentLastWheelAndMachineEnd, true);
assert.equal(readiness.outsideFieldResult.exact, true);
assert.equal(readiness.outsideFieldResult.status, "inside");

const directApply = applyManualDesignDraft(originalProject, draft, initialState.revision);
assert.deepEqual(directApply.machine.spanLengthsMeters, [30, 20]);
assert.equal(directApply.mapFeatures?.some((feature) => (
  feature.kind === "measurement_line"
  && feature.properties?.designRole === "last_wheel"
  && feature.properties?.targetMachineId === originalProject.machine.id
  && feature.properties?.appliedRadiusMeters === 50
  && feature.properties?.provisional === true
)), true);

const appliedState = reduceProjectEditorState(initialState, { type: "apply_manual_design", draft });
assert.equal(appliedState.lastError, null);
assert.equal(appliedState.revision, initialState.revision + 1);
assert.equal(appliedState.past.length, initialState.past.length + 1);
assert.deepEqual(appliedState.project.fieldBoundary, draft.boundary.vertices);
assert.deepEqual(appliedState.project.pivotCenter, draft.pivot?.point);
assert.deepEqual(appliedState.project.machine.spanLengthsMeters, [30, 20]);

const undoneState = reduceProjectEditorState(appliedState, { type: "undo" });
assert.deepEqual(undoneState.project.fieldBoundary, originalProject.fieldBoundary);
assert.deepEqual(undoneState.project.machine, originalProject.machine);

const invalidDraft = createManualDesignDraft(originalProject, initialState.revision);
invalidDraft.boundary = {
  source: "map_click",
  vertices: [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 10, y: 0 },
  ],
};
const invalidState = reduceProjectEditorState(initialState, { type: "apply_manual_design", draft: invalidDraft });
assert.match(invalidState.lastError ?? "", /self-intersect/i);
assert.equal(invalidState.revision, initialState.revision);
assert.equal(invalidState.project, initialState.project);

const staleDraft = createManualDesignDraft(originalProject, initialState.revision + 1);
const staleState = reduceProjectEditorState(initialState, { type: "apply_manual_design", draft: staleDraft });
assert.match(staleState.lastError ?? "", /stale/i);
assert.equal(staleState.revision, initialState.revision);

const outsidePivotDraft = createManualDesignDraft(originalProject, initialState.revision);
outsidePivotDraft.pivot = { point: { x: -1_000_000, y: -1_000_000 }, source: "projected_xy" };
const outsidePivotReadiness = evaluateManualDesignReadiness(outsidePivotDraft);
assert.equal(outsidePivotReadiness.ready, true);
assert.equal(outsidePivotReadiness.pivotContainment, "outside");
assert.match(outsidePivotReadiness.warnings.join("\n"), /outside the field boundary/i);

const invalidLegacyProject = {
  ...originalProject,
  fieldBoundary: invalidDraft.boundary.vertices,
};
const repairState = createProjectEditorState(invalidLegacyProject);
assert.match(repairState.lastError ?? "", /repair required/i);
assert.deepEqual(repairState.project.fieldBoundary, invalidLegacyProject.fieldBoundary);

const invalidImportState = reduceProjectEditorState(initialState, { type: "apply_project_import", project: invalidLegacyProject });
assert.match(invalidImportState.lastError ?? "", /imported boundary is invalid/i);
assert.equal(invalidImportState.revision, initialState.revision);
assert.equal(invalidImportState.project, initialState.project);

console.log("manual design tests passed");
