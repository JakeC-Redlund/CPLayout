import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { OFFLINE_WORK_DURATION_MS, verifyOfflineGrant } from "@cplayout/auth-client";
import { bootstrapAdministrator } from "./bootstrapService";
import { createApi } from "./server";
import { TestDatabase } from "./testDatabase";

test("signed offline grant expires exactly 24 hours after one issuance instant while the server clock advances", async () => {
  const database = new TestDatabase(), password = randomBytes(24).toString("base64url");
  const bootstrap = await bootstrapAdministrator(database, { username: "advancing-clock-fixture", displayName: "Synthetic clock fixture", password, workspaceName: "Synthetic field workspace" });
  let clock = Date.now(); const api = await createApi({ database, signingKey: randomBytes(32), origin: "http://localhost:19040", secureCookies: false, now: () => clock++ });
  try {
    const login = await api.inject({ method: "POST", url: "/api/v1/session/login", payload: { username: "advancing-clock-fixture", password } });
    assert.equal(login.statusCode, 200);
    const response = await api.inject({ method: "POST", url: `/api/v1/workspaces/${bootstrap.workspaceId}/offline-grant`,
      headers: { cookie: String(login.headers["set-cookie"]), "x-csrf-token": login.json<{ csrfToken: string }>().csrfToken } });
    assert.equal(response.statusCode, 200); const issued = response.json();
    const grant = verifyOfflineGrant(issued.grant, issued.verificationKey, { subject: bootstrap.administratorId, workspaceId: bootstrap.workspaceId }, clock);
    assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt), OFFLINE_WORK_DURATION_MS);
    assert(Date.parse(issued.serverTime) >= Date.parse(grant.issuedAt));
  } finally { await api.close(); }
});
