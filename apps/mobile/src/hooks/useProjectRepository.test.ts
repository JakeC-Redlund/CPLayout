import assert from "node:assert/strict";
import test from "node:test";
import { defaultProjectSettings, sampleProject, type DesignDraft } from "@cplayout/core";
import { workspaceDesignCatalog } from "@cplayout/project-store";
import { createVersionedProjectRepository } from "../../../../packages/project-store/src/versionedProjectRepository";
import { projectCatalogFromDesignCatalog, readVersionedDesign } from "./useProjectRepository";

const now = "2026-09-26T12:00:00.000Z";

test("persisted draft refresh and open keep draft and complete designs distinct", async () => {
  const values = new Map<string, string>();
  const repository = createVersionedProjectRepository({
    getStorage: () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    }),
    getLocks: () => ({ request: async <T>(_name: string, _options: { mode: "exclusive" }, callback: () => T | PromiseLike<T>) => callback() }),
  }).versionedWorkspace!;
  let revision = (await repository.readAsync()).revision;
  const execute = async (command: Parameters<typeof repository.executeAsync>[1]) => {
    revision = (await repository.executeAsync(revision, command)).workspace.revision;
  };
  await execute({ type: "create_client", id: "client", now,
    input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Client" } });
  await execute({ type: "create_project_with_initial_field_map", now,
    input: { clientId: "client", projectId: "draft-folder", projectName: "Draft folder",
      projectCrs: "EPSG:32613", unitSystem: "metric", fieldMapId: "draft-map" } });
  const settings = defaultProjectSettings();
  delete settings.aerialImagery.sourcePackageId;
  const draft: DesignDraft = { id: "draft-payload", name: "Incomplete design", projectCrs: null,
    settings, unitSystem: settings.unitSystem, fieldBoundary: [], pivotCenter: null,
    waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
  await execute({ type: "create_design_draft", now, designId: "draft-design", fieldMapId: "draft-map", name: draft.name, draft });
  await execute({ type: "create_project_with_initial_design", now,
    input: { clientId: "client", project: { ...structuredClone(sampleProject), id: "complete-project" },
      fieldMapId: "complete-map", designId: "complete-design" } });

  const snapshot = await repository.readAsync();
  const all = workspaceDesignCatalog(snapshot);
  assert.deepEqual(all.designs.map((design) => [design.id, design.kind]),
    [["complete-design", "project"], ["draft-design", "draft"]]);
  assert.deepEqual(projectCatalogFromDesignCatalog(all).designs.map((design) => design.id), ["complete-design"]);
  assert.deepEqual(await readVersionedDesign(repository, "draft-design"), {
    kind: "draft", draft, designRevision: 0, persistenceRevision: snapshot.revision,
    context: { clientId: "client", projectId: "draft-folder", fieldMapId: "draft-map", designId: "draft-design" },
  });
  const complete = await readVersionedDesign(repository, "complete-design");
  assert.equal(complete.kind, "project");
  if (complete.kind === "project") {
    assert.equal(complete.project.id, "complete-project");
    assert.equal(complete.context.designId, "complete-design");
  }
  await assert.rejects(readVersionedDesign(repository, "absent"), /not found/);
});
