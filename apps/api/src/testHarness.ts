/** Only test runners import this fixture; start.ts cannot select it through config. */
import { randomBytes, randomUUID } from "node:crypto";
import { bootstrapAdministrator } from "./bootstrapService";
import { createApi } from "./server";
import { TestDatabase } from "./testDatabase";
import { bytesToHex } from "@cplayout/auth-client";
import { ed25519 } from "@noble/curves/ed25519.js";
export async function createSyntheticApi(origin: string, signingKey: Uint8Array = randomBytes(32)) {
  const database = new TestDatabase(), password = randomBytes(24).toString("base64url");
  const bootstrap = await bootstrapAdministrator(database, { username: "synthetic-operator", displayName: "Synthetic operator", password, workspaceName: "Synthetic field projects" });
  const api = await createApi({ database, signingKey, origin, secureCookies: new URL(origin).protocol === "https:" });
  return { api, database, ...bootstrap, username: "synthetic-operator", password, offlinePublicKey: bytesToHex(ed25519.getPublicKey(signingKey)) };
}

/** Explicit synthetic setup through the real session and command transaction.
 * The supplied customer/project names are the only business names used here. */
export async function seedSyntheticCustomers(service: Pick<Awaited<ReturnType<typeof createSyntheticApi>>, "api" | "database" | "workspaceId" | "username" | "password">,
  input: readonly { customerDisplayName: string; projectName?: string }[]) {
  const login = await service.api.inject({ method: "POST", url: "/api/v1/session/login", payload: { username: service.username, password: service.password } });
  if (login.statusCode !== 200) throw new Error("Synthetic project setup could not authenticate.");
  const cookie = String(login.headers["set-cookie"]), csrfToken = login.json<{ csrfToken: string }>().csrfToken;
  const headers = { cookie, "x-csrf-token": csrfToken }, entries: { clientId: string; customerDisplayName: string; project?: { projectId: string; fieldMapId: string; designId: string; projectName: string } }[] = [];
  async function command(value: unknown) {
    const stored = await service.database.transaction(transaction => transaction.workspace(service.workspaceId));
    if (!stored) throw new Error("Synthetic project setup workspace is missing.");
    const response = await service.api.inject({ method: "POST", url: `/api/v1/workspaces/${service.workspaceId}/commands`, headers,
      payload: { commandId: randomUUID(), expectedRevision: stored.revision, command: value } });
    if (response.statusCode !== 200) throw new Error(`Synthetic project setup command failed (${response.statusCode}).`);
  }
  try {
    for (const item of input) {
      const clientId = randomUUID(), now = new Date().toISOString();
      await command({ type: "create_client", id: clientId, input: { companyName: item.customerDisplayName, primaryContactFirstName: "Synthetic", primaryContactLastName: "Operator" }, now });
      const entry: typeof entries[number] = { clientId, customerDisplayName: item.customerDisplayName };
      if (item.projectName !== undefined) {
        const projectId = randomUUID(), fieldMapId = randomUUID(), designId = randomUUID();
        await command({ type: "start_project_work", clientId, projectId, fieldMapId, designId, draftId: randomUUID(), projectName: item.projectName,
          fieldName: "Synthetic supplied field", workName: "Synthetic supplied work", unitSystem: "metric", initialMode: "design", now });
        entry.project = { projectId, fieldMapId, designId, projectName: item.projectName };
      }
      entries.push(entry);
    }
    return entries;
  } finally {
    const logout = await service.api.inject({ method: "POST", url: "/api/v1/session/logout", headers });
    if (logout.statusCode !== 200) throw new Error("Synthetic project setup session could not be retired.");
  }
}
export async function seedSyntheticCustomerProjects(service: Parameters<typeof seedSyntheticCustomers>[0], input: readonly { customerDisplayName: string; projectName: string }[]) {
  const customers = await seedSyntheticCustomers(service, input);
  return customers.map(customer => {
    if (!customer.project) throw new Error("The supplied synthetic project was not created.");
    return { clientId: customer.clientId, customerDisplayName: customer.customerDisplayName, ...customer.project };
  });
}
