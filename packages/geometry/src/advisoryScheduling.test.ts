import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createProjectEditorState, sampleProject, realCenterPivotProofProject, willRheaJasonHarmelinkExampleProject } from "@cplayout/core";
import { analyzeAdvisoryMultiMachineLayoutSteps, planAdvisoryFieldPivotsSteps } from "./advisoryPivotPlacement";
import { buildAdvisoryMachineRenderModelSteps } from "./advisoryMachineRenderModel";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Frozen pre-scheduling outputs; two area-only updates audited in docs/mapping-workflow-review.md.
const fixtures = [
  { project: sampleProject, expected: ["f96a75183843732a26f45bb4e30279afabb8bfa8bd24173c970e568d62b91c93", "c35feeb54c8f32e4dcda1b807ea4b7553eee183e996b9837e9e08e016c1b6148", "e882a3be54f5a3197eaaca5a09c9319a759b75ccf5741c2beb201b1ab506e2a4"] },
  { project: realCenterPivotProofProject, expected: ["3b58e653b7789f6070b870a3f7affbb3acf51614c3a292d032fd8f7dc55c78b5", "2a7efd4350f72dedfa3795c7087e53d660a4ccd79dd3f775e82fae13c23479aa", "e882a3be54f5a3197eaaca5a09c9319a759b75ccf5741c2beb201b1ab506e2a4"] },
  { project: willRheaJasonHarmelinkExampleProject, expected: ["f08f43f8a8754af65d7c5b4f8d537f04e8848e6ae4bdde04c094a35d915d4f61", "ca8e7ab0a4d32759389814f562e2739c4ce8877761a678033dba2c810444c586", "8547f7b869b016a5b7b4e161b59e706857b117fe839d5a0b47a6a79d233769b1"] },
];
for (const fixture of fixtures) {
  const project = createProjectEditorState(fixture.project).project;
  const before = hash(project);
  const calculations = [
    planAdvisoryFieldPivotsSteps(project, { gridDivisions: 6, maxMachines: 3, candidatePoolSize: 24, collisionBufferMeters: project.machine.machineClearanceBufferMeters }),
    analyzeAdvisoryMultiMachineLayoutSteps(project, { maxCandidates: 3, collisionBufferMeters: project.machine.machineClearanceBufferMeters }),
    buildAdvisoryMachineRenderModelSteps(project, { maxInstances: 2, endGunThrowMeters: 30.48, includePublicVflexFallbackCornerArm: true }),
  ];
  for (const [index, calculation] of calculations.entries()) {
    let steps = 0;
    let step = calculation.next();
    while (!step.done) { steps += 1; step = calculation.next(); }
    assert.equal(hash(step.value), fixture.expected[index], `${project.id} calculation ${index} preserves complete output`);
    if (fixture.project === willRheaJasonHarmelinkExampleProject && index === 2) {
      assert.ok(steps > 500, "corner-arm envelope unions must yield individually, not in one blocking fold");
    }
    assert.equal(hash(project), before, "calculation cannot mutate input");
  }
}
const project = structuredClone(sampleProject);
const before = hash(project);
const cancelled = planAdvisoryFieldPivotsSteps(project);
assert.equal(cancelled.next().done, false, "candidate generation yields before returning its full plan");
cancelled.return(undefined as never);
assert.equal(hash(project), before, "cancellation leaves geometry unchanged");
console.log("Advisory scheduling: 9 frozen-output comparisons and cancellation immutability pass.");
