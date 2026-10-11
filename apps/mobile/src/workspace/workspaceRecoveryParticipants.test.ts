import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceRecoveryParticipants, type WorkspaceRecoveryPartName, type WorkspaceRecoveryParts, type WorkspaceRecoveryTarget } from "./workspaceRecoveryParticipants";
import { emptyWorkspaceEditRecoveryUi } from "./workspaceEditRecovery";
import { packageFixture } from "../../../../tests/web/workspace-package-fixtures";

const names: WorkspaceRecoveryPartName[] = ["entry", "frame", "survey", "layout", "catalog", "receiver", "camera"];
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function parts(): WorkspaceRecoveryParts {
  const ui = emptyWorkspaceEditRecoveryUi();
  return { entry: { entry: ui.entry, file: ui.file }, frame: ui.entry, survey: ui.survey, layout: ui.layout, catalog: ui.catalog, receiver: ui.receiver, camera: [] };
}
async function target(): Promise<WorkspaceRecoveryTarget> {
  const { workspace } = await packageFixture("draft"), ui = emptyWorkspaceEditRecoveryUi();
  return { workspace, documentGeneration: 1, admission: { ui, staged: { cameras: [] } } } as unknown as WorkspaceRecoveryTarget;
}
test("required current owners refuse incomplete captures instead of manufacturing empty values", () => {
  const registry = createWorkspaceRecoveryParticipants(), values = parts();
  assert.throws(() => registry.capture(), /entry/);
  for (const name of names) registry.register(name, { capture: () => values[name], stage: () => ({ isCurrent: () => true, consume() {} }) });
  assert.deepEqual(registry.capture().ui.catalog, values.catalog);
  assert.throws(() => registry.captureContext(), /navigation/);
  const stop = registry.registerContextCapture(() => ({ catalogSelection: { clientId: null, projectId: null, fieldMapId: null, designId: null }, catalogVisible: true }));
  assert.equal(registry.captureContext().catalogVisible, true); stop(); assert.throws(() => registry.captureContext(), /navigation/);
});
test("a failed camera consumer drains an already started Catalog acknowledgement before rollback staging", async () => {
  const registry = createWorkspaceRecoveryParticipants(), values = parts(), catalogAck = deferred(), started = deferred();
  let catalogWriting = false, finished = false;
  for (const name of names) registry.register(name, { capture: () => values[name], stage() {
    if (name === "catalog" && catalogWriting) throw new Error("Catalog is still acknowledging its children");
    return { isCurrent: () => true, async consume() {
      if (name === "catalog") { catalogWriting = true; started.resolve(); await catalogAck.promise; catalogWriting = false; }
      if (name === "camera") throw new Error("Camera screen extent overflow");
    } };
  } });
  const destination = await target(), plan = await registry.stage(destination);
  const delivery = plan.consume({ id: "one", target: destination, isCurrent: () => true });
  const checked = delivery.then(() => { finished = true; }, error => { finished = true; throw error; });
  await started.promise; await Promise.resolve(); assert.equal(finished, false);
  await assert.rejects(registry.stage(destination), /still acknowledging/);
  catalogAck.resolve(); await assert.rejects(checked, /screen extent overflow/); assert.equal(catalogWriting, false);
  assert.equal((await registry.stage(destination)).isCurrent(), true);
});
test("registration retirement and blocked user ABA cannot acquire stale participant authority", async () => {
  const registry = createWorkspaceRecoveryParticipants(), values = parts(); let retire!: () => void;
  for (const name of names) {
    const cleanup = registry.register(name, { capture: () => values[name], stage: () => ({ isCurrent: () => true, consume() {} }) });
    if (name === "camera") retire = cleanup;
  }
  const destination = await target(), staged = await registry.stage(destination); assert.equal(staged.isCurrent(), true);
  retire(); assert.equal(staged.isCurrent(), false);
  const owner = registry.getInputOwner(); registry.setBlocked(true); registry.notifyChanged(); assert.equal(registry.getInputOwner(), owner);
  registry.setBlocked(false); registry.notifyChanged(); assert.notEqual(registry.getInputOwner(), owner);
});
