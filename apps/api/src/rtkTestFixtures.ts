/** Software-only, synthetic receiver setup through actual authenticated API commands. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSyntheticApi, seedSyntheticCustomerProjects } from "./testHarness";
import { workflowTestField, workflowTestPoint, workflowTestTime as now } from "../../../packages/core/src/productionWorkflowTestFixtures";
import { createSurveyCollection } from "../../../packages/core/src/surveyCollection";

export async function createSyntheticRtkField() {
  const service = await createSyntheticApi("http://localhost:19040"), empty = service.database.state.workspaces[0];
  const [tree] = await seedSyntheticCustomerProjects(service, [{ customerDisplayName: "Synthetic RTK customer", projectName: "Supplied RTK project" }]);
  const login = await service.api.inject({ method: "POST", url: "/api/v1/session/login", payload: { username: service.username, password: service.password } });
  assert.equal(login.statusCode, 200);
  const headers = { cookie: String(login.headers["set-cookie"]), "x-csrf-token": login.json<{ csrfToken: string }>().csrfToken };
  async function command(input: unknown, commandId = randomUUID(), expectedPrincipalId = service.administratorId) {
    const current = service.database.state.workspaces.find(item => item.id === service.workspaceId)!;
    const response = await service.api.inject({ method: "POST", url: `/api/v1/workspaces/${service.workspaceId}/commands`, headers,
      payload: { commandId, expectedRevision: current.revision, expectedPrincipalId, command: { now, ...input as object } } });
    assert.equal(response.statusCode, 200, response.body); return response.json();
  }
  const field = workflowTestField(), designId = "rtk-field-design", reviewId = "actual-review";
  await command({ type: "declare_work_crs", designId: tree.designId, expectedDesignRevision: 0, projectCrs: field.projectCrs });
  await command({ type: "create_field_design", designId, fieldMapId: tree.fieldMapId, name: field.name, field });
  const collection = createSurveyCollection({ id: "actual-control", owner: { designId, documentKind: "field", payloadId: field.id, fieldMapId: tree.fieldMapId, projectCrs: field.projectCrs }, purpose: { kind: "point", role: "control" }, now });
  await command({ type: "create_survey_collection", collection, expectedDesignRevision: 0 });
  await command({ type: "append_survey_capture", collectionId: collection.id, expectedCollectionRevision: 0, expectedDesignRevision: 0, point: workflowTestPoint() });
  await command({ type: "review_survey", designId, expectedDesignRevision: 1, reviewId, includedCollectionIds: [collection.id], excludedCollectionIds: [], completedBy: "forged-reviewer" });
  return { ...service, empty, tree, field, designId, reviewId, headers, command };
}
