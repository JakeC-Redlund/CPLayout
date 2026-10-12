import { randomUUID } from "node:crypto";
import { emptyWorkspaceDocument, serializeWorkspaceDocument, upgradeWorkspaceDocumentToV2, upgradeWorkspaceDocumentToV3, upgradeWorkspaceDocumentToV4, upgradeWorkspaceDocumentToV5 } from "../../../packages/project-store/src/workspaceDocument";
import type { ApiDatabase } from "./database";
import { argonPasswords, validateNewPassword, type PasswordService } from "./passwords";
export async function bootstrapAdministrator(database: ApiDatabase, input: { username: string; displayName: string; password: string; workspaceName: string }, passwords: PasswordService = argonPasswords) {
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.@-]{0,99}$/.test(username) || !input.displayName.trim() || !input.workspaceName.trim()) throw new Error("Provide a username, administrator name and workspace name.");
  validateNewPassword(input.password);
  return database.transaction(async transaction => {
    if (await transaction.hasAdministrator()) throw new Error("Administrator bootstrap is already complete. Use authenticated account management.");
    let workspace = emptyWorkspaceDocument();
    for (const upgrade of [upgradeWorkspaceDocumentToV2, upgradeWorkspaceDocumentToV3, upgradeWorkspaceDocumentToV4, upgradeWorkspaceDocumentToV5]) workspace = upgrade(serializeWorkspaceDocument(workspace));
    const id = randomUUID(), workspaceId = randomUUID(), document = serializeWorkspaceDocument(workspace);
    await transaction.insertUser({ id, username, displayName: input.displayName.trim(), passwordHash: await passwords.hash(input.password), roles: ["admin"], disabled: false, accessRevision: 0 });
    await transaction.insertWorkspace({ id: workspaceId, name: input.workspaceName.trim(), revision: workspace.revision, document });
    await transaction.setMembership(id, workspaceId, ["field:read", "field:write", "catalog:write", "catalog:archive"]);
    await transaction.audit(id, workspaceId, "administrator.bootstrap", id);
    return { administratorId: id, workspaceId };
  }, { bootstrap: true });
}
