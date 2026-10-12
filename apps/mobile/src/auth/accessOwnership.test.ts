import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccessSnapshot } from "@cplayout/auth-client";
import { workspaceAccessMustPreserve, workspaceAccessOwner } from "./accessOwnership";
const before: AccessSnapshot = { principal: { id: "a", username: "a", displayName: "A", roles: ["operator"] },
  workspaces: [{ workspaceId: "w", workspaceName: "W", permissions: ["field:read", "field:write"], policyRevision: 0 }], csrfToken: "synthetic", serverTime: "2026-10-11T00:00:00Z" };
test("same principal/workspace permission, policy and role retirement requires preservation", () => {
  const readonly: AccessSnapshot = { ...before, workspaces: [{ ...before.workspaces[0], permissions: ["field:read"] }] };
  const support: AccessSnapshot = { ...before, principal: { ...before.principal, roles: ["support"] } };
  assert.equal(workspaceAccessMustPreserve(before, "w", readonly, "w"), true);
  assert.equal(workspaceAccessMustPreserve(before, "w", support, "w"), true);
  assert.equal(workspaceAccessMustPreserve(before, "w", { ...before, workspaces: [{ ...before.workspaces[0], policyRevision: 1 }] }, "w"), true);
  assert.equal(workspaceAccessMustPreserve(before, "w", { ...before, csrfToken: "renewed" }, "w"), false);
  assert.notEqual(workspaceAccessOwner(before, "w"), workspaceAccessOwner({ ...before, principal: { ...before.principal, id: "b" } }, "w"));
});
