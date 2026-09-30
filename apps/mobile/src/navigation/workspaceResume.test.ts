import assert from "node:assert/strict";
import { readWorkspaceResume, resolveResumeContext, writeWorkspaceResume } from "./workspaceResume";
import type { ProjectCatalog } from "@cplayout/project-store";

const catalog = { clients: [{ id: "a" }, { id: "b" }], projects: [{ id: "p", clientId: "a" }],
  fieldMaps: [{ id: "f", projectId: "p" }], designs: [{ id: "d", fieldMapId: "f" }] } as ProjectCatalog;
const context = { clientId: "a", projectId: "p", fieldMapId: "f", designId: "d" };
assert.deepEqual(resolveResumeContext(context, catalog), context);
assert.deepEqual(resolveResumeContext({ ...context, clientId: "b" }, catalog), { clientId: "b", projectId: null, fieldMapId: null, designId: null });
assert.deepEqual(resolveResumeContext({ ...context, fieldMapId: "deleted" }, catalog), { clientId: "a", projectId: "p", fieldMapId: null, designId: null });
let raw: string | null = null;
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => raw, setItem: (_: string, value: string) => { raw = value; } } });
const resume = { version: 1, context, editorOpen: true, view: "map" } as const;
writeWorkspaceResume(resume);
assert.deepEqual(readWorkspaceResume(), resume);
raw = '{"version":9}'; assert.equal(readWorkspaceResume(), null);
raw = 'broken'; assert.equal(readWorkspaceResume(), null);
Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked storage"); } });
assert.equal(readWorkspaceResume(), null);
assert.doesNotThrow(() => writeWorkspaceResume(resume));
delete (globalThis as { localStorage?: unknown }).localStorage;
