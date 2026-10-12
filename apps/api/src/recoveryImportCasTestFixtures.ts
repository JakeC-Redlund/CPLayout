/** Test-only service regression shared by the injected and PostgreSQL adapters. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { createApi } from "./server";
import { sha256 } from "./database";
import { applyWorkspaceDocumentCommand } from "../../../packages/project-store/src/workspaceCommands";
import { parseWorkspaceDocument, serializeWorkspaceDocument } from "../../../packages/project-store/src/workspaceDocument";

type State = { revision: number; document: string; receiptCount: number; auditCount: number };
export async function exerciseRecoveryImportCas(input: {
  api: Awaited<ReturnType<typeof createApi>>; workspaceId: string;
  headers: { cookie: string; "x-csrf-token": string }; inspect: () => Promise<State>;
}) {
  const { api, workspaceId, headers, inspect } = input, base = `/api/v1/workspaces/${workspaceId}`;
  const original = await inspect(); assert.equal(original.revision, 0);
  const now = new Date().toISOString();
  const payload = (expectedRevision: number, command: unknown) => ({ commandId: randomUUID(), expectedRevision, command });
  const customer = (id: string, name: string) => ({ type: "create_client", id,
    input: { companyName: name, primaryContactFirstName: "Synthetic", primaryContactLastName: "Operator" }, now });
  const send = (action: ReturnType<typeof payload>) => api.inject({ method: "POST", url: `${base}/commands`, headers, payload: action });
  const raw = (document: string) => JSON.stringify(JSON.parse(document), null, 2).replaceAll("\n", "\r\n") + " \r\n";
  const restore = (document: string, expectedRevision: number) => api.inject({ method: "POST", url: `${base}/import`, headers,
    payload: { document, sha256: sha256(document), expectedRevision } });
  async function refused(document: string, expectedRevision: number) {
    const before = await inspect(), sourceHash = sha256(document), response = await restore(document, expectedRevision);
    assert.equal(response.statusCode, 409, response.body); assert.equal(response.json().code, "import_revision_conflict");
    assert.deepEqual(await inspect(), before); assert.equal(sha256(document), sourceHash);
  }
  const queuedAtZero = payload(0, customer(randomUUID(), "Queued before import"));
  await refused(raw(original.document), 0); // Equal zero must not change a namespace.
  const createdId = randomUUID(), committed = payload(0, customer(createdId, "Temporary customer"));
  const create = await send(committed); assert.equal(create.statusCode, 200, create.body);
  const deleted = await send(payload(1, { type: "delete_client", clientId: createdId, now }));
  assert.equal(deleted.statusCode, 200, deleted.body);
  const empty = await inspect(); assert.equal(empty.revision, 2); assert.equal(parseWorkspaceDocument(empty.document).catalog.clients.length, 0);
  await refused(raw(original.document), 2); // Lower revision after actual create/delete.
  await refused(raw(empty.document), 2); // Equal nonzero revision is also unsafe.
  const beforeStale = await inspect(); assert.equal((await send(queuedAtZero)).statusCode, 409); assert.deepEqual(await inspect(), beforeStale);

  const importedId = randomUUID(), higher = raw(serializeWorkspaceDocument(applyWorkspaceDocumentCommand(empty.document, customer(importedId, "Imported customer")).workspace));
  const queuedAtTwo = payload(2, customer(randomUUID(), "Queued before higher import"));
  const imported = await restore(higher, 2); assert.equal(imported.statusCode, 200, imported.body);
  assert.equal(imported.json().revision, 3); assert.equal(imported.json().document, higher); assert.equal(imported.json().sha256, sha256(higher));
  const afterImport = await inspect(); assert.equal(afterImport.document, higher); assert.equal(afterImport.revision, 3);
  assert.equal(afterImport.receiptCount, empty.receiptCount); assert.equal(afterImport.auditCount, empty.auditCount + 1);
  for (const action of [queuedAtZero, queuedAtTwo]) { assert.equal((await send(action)).statusCode, 409); assert.deepEqual(await inspect(), afterImport); }
  // A previously committed action keeps its historical receipt without mutation.
  const replay = await send(committed); assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json().replayed, true);
  assert.deepEqual(replay.json().workspace, create.json().workspace); assert.deepEqual(await inspect(), afterImport);
  const freshId = randomUUID(), fresh = await send(payload(3, customer(freshId, "Fresh current command")));
  assert.equal(fresh.statusCode, 200, fresh.body); assert.equal(fresh.json().revision, 4);
  let current = await inspect();
  for (const clientId of [importedId, freshId]) {
    const result = await send(payload(current.revision, { type: "delete_client", clientId, now }));
    assert.equal(result.statusCode, 200, result.body); current = await inspect();
  }
  assert.equal(current.revision, 6); assert.equal(parseWorkspaceDocument(current.document).catalog.clients.length, 0);
  const raceImportId = randomUUID(), raceCommandId = randomUUID();
  const racingSource = raw(serializeWorkspaceDocument(applyWorkspaceDocumentCommand(current.document, customer(raceImportId, "Concurrent import")).workspace));
  const results = await Promise.all([restore(racingSource, 6), send(payload(6, customer(raceCommandId, "Concurrent command")))]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
  const final = await inspect(); assert.equal(final.revision, 7); assert.equal(final.auditCount, current.auditCount + 1);
  const importWon = results[0].statusCode === 200;
  assert.equal(final.receiptCount, current.receiptCount + (importWon ? 0 : 1));
  assert.deepEqual(parseWorkspaceDocument(final.document).catalog.clients.map(client => client.id), [importWon ? raceImportId : raceCommandId]);
  if (importWon) assert.equal(final.document, racingSource);
}
