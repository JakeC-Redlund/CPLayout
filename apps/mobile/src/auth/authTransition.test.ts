import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT_TRANSITION_KEY, signInWithDurableTransition } from "./authTransition";
import type { AccessSnapshot } from "@cplayout/auth-client";
const snapshot: AccessSnapshot = { principal: { id: "account-b", username: "synthetic-b", displayName: "B", roles: ["operator"] }, workspaces: [], csrfToken: "synthetic", serverTime: new Date().toISOString() };
test("pre-login quota failure refuses before HTTP can change account identity", async () => {
  let logins = 0; const api = { access: null, login: async () => { logins++; return snapshot; }, revokeIssuedSession: async () => undefined };
  await assert.rejects(signInWithDurableTransition(api, { read: async () => null, write: async () => { throw new Error("Synthetic quota"); } }, "B", "synthetic password", async () => undefined), /could not be prepared/);
  assert.equal(logins, 0);
});
test("post-login metadata failure revokes B and keeps transition blocked without restoring A authority", async () => {
  let serviceIdentity = "account-a", revocations = 0; const data = new Map<string, string>([["account-a:field", "exact retained field evidence"]]);
  const storage = { read: async (key: string) => data.get(key) ?? null, write: async (key: string, value: string) => { data.set(key, value); } };
  const api = { access: null, login: async () => { serviceIdentity = "account-b"; return snapshot; }, revokeIssuedSession: async (issued: AccessSnapshot) => { assert.equal(issued.csrfToken, snapshot.csrfToken); serviceIdentity = "signed-out"; revocations++; } };
  await assert.rejects(signInWithDurableTransition(api, storage, "B", "synthetic password", async () => { throw new Error("Synthetic metadata quota"); }), /retain this account safely/);
  assert.equal(serviceIdentity, "signed-out"); assert.equal(revocations, 1); assert.equal(data.get(ACCOUNT_TRANSITION_KEY), "pending"); assert.equal(data.get("account-a:field"), "exact retained field evidence");
});
