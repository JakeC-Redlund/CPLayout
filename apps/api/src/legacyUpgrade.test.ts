import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createSyntheticApi } from "./testHarness";
import { emptyWorkspaceDocument, serializeWorkspaceDocument, upgradeWorkspaceDocumentToV2, upgradeWorkspaceDocumentToV3, upgradeWorkspaceDocumentToV4 } from "../../../packages/project-store/src/workspaceDocument";

test("service upgrade retains the exact noncanonical imported v1-v4 predecessor through its raw command transaction", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040");
  try {
    const response = await fixture.api.inject({ method: "POST", url: "/api/v1/session/login", payload: { username: fixture.username, password: fixture.password } });
    assert.equal(response.statusCode, 200);
    const headers = { cookie: String(response.headers["set-cookie"]), "x-csrf-token": response.json().csrfToken as string };
    const v1 = emptyWorkspaceDocument(), v2 = upgradeWorkspaceDocumentToV2(serializeWorkspaceDocument(v1)),
      v3 = upgradeWorkspaceDocumentToV3(serializeWorkspaceDocument(v2)), v4 = upgradeWorkspaceDocumentToV4(serializeWorkspaceDocument(v3));
    for (const [source, retainedKey] of [[v1, "originalPreviousWorkspaceDocument"], [v2, "originalPreviousWorkspaceDocument"],
      [v3, "originalSurveyUpgradeDocument"], [v4, "originalWorkflowUpgradeDocument"]] as const) {
      const original = JSON.stringify(source, null, 2).replaceAll("\n", "\r\n") + "  \r\n";
      await fixture.database.transaction(async transaction => { const current = await transaction.workspace(fixture.workspaceId); if (!current) throw new Error("Synthetic source missing."); await transaction.writeWorkspace({ ...current, revision: source.revision, document: original }); });
      const upgraded = await fixture.api.inject({ method: "POST", url: `/api/v1/workspaces/${fixture.workspaceId}/commands`, headers,
        payload: { commandId: randomUUID(), expectedRevision: source.revision, command: { type: "upgrade_workspace_to_v5", now: new Date().toISOString() } } });
      assert.equal(upgraded.statusCode, 200, upgraded.body); assert.equal(upgraded.json().workspace[retainedKey], original);
      const actual = await fixture.api.inject({ url: `/api/v1/workspaces/${fixture.workspaceId}`, headers });
      assert.equal(JSON.parse(actual.json().document)[retainedKey], original);
      assert.equal(fixture.database.state.receipts.at(-1)!.responseDocument.includes(JSON.stringify(original).slice(1, -1)), true);
    }
  } finally { await fixture.api.close(); }
});
