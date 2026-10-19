"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { inspectGisDependencies } = require("./gisDependencyIdentity.cjs");
test("package-relative identity refuses an installed edition that differs from the lock", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cplayout-gis-identity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "node_modules/fixture"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { fixture: "2.0.0" } }));
  fs.writeFileSync(path.join(root, "node_modules/fixture/package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", main: "index.js" }));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/fixture": { version: "2.0.0", main: "index.js" } } }));
  fs.writeFileSync(path.join(root, "node_modules/fixture/index.js"), "module.exports = {};\n");
  const options = { selectedConsumers: { ".": ["fixture"] } };
  assert.match(inspectGisDependencies(root, options).errors.join(), /installed 1.0.0, locked 2.0.0/);
  fs.writeFileSync(path.join(root, "node_modules/fixture/package.json"), JSON.stringify({ name: "fixture", version: "2.0.0", main: "index.js" }));
  assert.deepEqual(inspectGisDependencies(root, options).errors, []);
  fs.rmSync(path.join(root, "node_modules/fixture/index.js"));
  assert.equal(inspectGisDependencies(root, options).errors.length, 1, "metadata cannot qualify a missing consumed entry");
  fs.rmSync(path.join(root, "node_modules/fixture"), { recursive: true });
  assert.equal(inspectGisDependencies(root, options).errors.length, 1, "missing runtime modules cannot pass");
});
test("owned dependency links on a native filesystem retain logical lock identity", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cplayout-gis-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project"), native = path.join(root, "native/node_modules/fixture");
  fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(native, { recursive: true });
  fs.writeFileSync(path.join(native, "package.json"), JSON.stringify({ name: "fixture", version: "2.0.0", main: "index.js" }));
  fs.writeFileSync(path.join(native, "index.js"), "module.exports = {};\n");
  fs.symlinkSync(path.join(root, "native/node_modules"), path.join(project, "node_modules"), "dir");
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ dependencies: { fixture: "2.0.0" } }));
  fs.writeFileSync(path.join(project, "package-lock.json"), JSON.stringify({ packages: { "node_modules/fixture": { version: "2.0.0", main: "index.js" } } }));
  assert.deepEqual(inspectGisDependencies(project, { selectedConsumers: { ".": ["fixture"] } }).errors, []);
});
test("a missing nested locked copy cannot pass by falling back to a compatible hoisted copy", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cplayout-gis-nested-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "packages/consumer"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules/fixture"), { recursive: true });
  fs.writeFileSync(path.join(root, "packages/consumer/package.json"), JSON.stringify({ dependencies: { fixture: "^2.0.0" } }));
  fs.writeFileSync(path.join(root, "node_modules/fixture/package.json"), JSON.stringify({ name: "fixture", version: "2.0.0", main: "index.js" }));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ packages: {
    "node_modules/fixture": { version: "2.0.0", main: "index.js" }, "packages/consumer/node_modules/fixture": { version: "2.1.0" },
  } }));
  fs.writeFileSync(path.join(root, "node_modules/fixture/index.js"), "module.exports = {};\n");
  const result = inspectGisDependencies(root, { selectedConsumers: { "packages/consumer": ["fixture"] } });
  assert.match(result.errors.join(), /expected locked slot packages\/consumer\/node_modules\/fixture/);
  assert.match(result.errors.join(), /locked 2.1.0/);
});
test("an import-only package checks its declared import entry without executing browser code", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cplayout-gis-esm-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "node_modules/fixture"); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { fixture: "1.0.0" } }));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ packages: { "node_modules/fixture": { version: "1.0.0" } } }));
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", exports: { ".": { import: "./entry.mjs" }, "./package.json": "./package.json" } }));
  const options = { selectedConsumers: { ".": ["fixture"] } };
  assert.equal(inspectGisDependencies(root, options).errors.length, 1);
  fs.writeFileSync(path.join(directory, "entry.mjs"), 'throw new Error("must never execute during metadata validation");');
  assert.deepEqual(inspectGisDependencies(root, options).errors, []);
});
