import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCatalogFormContextUnchanged } from "./catalogFormRecovery";
import type { ProjectCatalog } from "@cplayout/project-store";
const before = { clients: [{ id: "c", displayName: "Customer" }], projects: [{ id: "p", clientId: "c", name: "Project" }], fieldMaps: [] } as unknown as ProjectCatalog;
const context = { clientId: "c", projectId: "p", fieldMapId: null };
test("a sibling write can refresh a creation form without replacing captured context", () => {
  const bytes = JSON.stringify(before);
  assertCatalogFormContextUnchanged(before, { ...before, clients: [...before.clients, { ...before.clients[0], id: "sibling" }] }, context);
  assert.equal(JSON.stringify(before), bytes);
});
test("changed or removed targets cannot authorize a stale edit", () => {
  assert.throws(() => assertCatalogFormContextUnchanged(before, { ...before, clients: [{ ...before.clients[0], displayName: "Changed" }] }, context), /customer changed/);
  assert.throws(() => assertCatalogFormContextUnchanged(before, { ...before, projects: [] }, context), /project changed/);
});
