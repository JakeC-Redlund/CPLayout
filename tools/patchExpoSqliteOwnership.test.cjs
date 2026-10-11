const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { patchExpoSqliteOwnership } = require("./patchExpoSqliteOwnership.cjs");
const hash = text => createHash("sha256").update(text).digest("hex");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cplayout-patch-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, text) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const source = "node_modules/expo-sqlite/android/example.txt";
  const added = "node_modules/expo-sqlite/android/owned.txt";
  const unchanged = "node_modules/expo-sqlite/vendor/version.txt";
  const patch = `diff --git a/${source} b/${source}\n--- a/${source}\n+++ b/${source}\n@@ -1 +1 @@\n-old\n+patched\ndiff --git a/${added} b/${added}\nnew file mode 100644\n--- /dev/null\n+++ b/${added}\n@@ -0,0 +1 @@\n+new\n`;
  const manifest = {
    versions: { "expo-sqlite": "55.0.20" }, patchSha256: hash(patch),
    pins: { "android/example.txt": hash("old\n"), "vendor/version.txt": hash("unchanged\n") },
    files: [ { target: source, added: false, expected: hash("patched\n") },
      { target: added, added: true, expected: hash("new\n") } ],
  };
  write("node_modules/expo-sqlite/package.json", JSON.stringify({ name: "expo-sqlite", version: "55.0.20" }));
  write(source, "old\n"); write(unchanged, "unchanged\n");
  write("patches/expo-sqlite+55.0.20.patch", patch);
  write("patches/expo-sqlite+55.0.20.json", JSON.stringify(manifest));
  const read = name => fs.readFileSync(path.join(root, name), "utf8");
  return { root, source, added, unchanged, write, read };
}

test("installs the exact patch and is idempotent", t => {
  const f = fixture(t);
  assert.equal(patchExpoSqliteOwnership(f.root), "installed");
  assert.equal(f.read(f.source), "patched\n");
  assert.equal(f.read(f.added), "new\n");
  assert.equal(patchExpoSqliteOwnership(f.root), "already-installed");
  assert.equal(patchExpoSqliteOwnership(f.root, { checkOnly: true }), "already-installed");
});
test("check-only refuses an unpatched dependency without writing", t => {
  const f = fixture(t);
  assert.throws(() => patchExpoSqliteOwnership(f.root, { checkOnly: true }), /not installed/);
  assert.equal(f.read(f.source), "old\n");
  assert.equal(fs.existsSync(path.join(f.root, f.added)), false);
});
test("unexpected baseline refuses all mutations", t => {
  const f = fixture(t); f.write(f.source, "user change\n");
  assert.throws(() => patchExpoSqliteOwnership(f.root), /refusing to overwrite/);
  assert.equal(f.read(f.source), "user change\n");
  assert.equal(fs.existsSync(path.join(f.root, f.added)), false);
});
test("partial patch is not silently repaired", t => {
  const f = fixture(t); f.write(f.added, "new\n");
  assert.throws(() => patchExpoSqliteOwnership(f.root), /partially patched/);
  assert.equal(f.read(f.source), "old\n");
});
test("changed vendor input refuses even after installation", t => {
  const f = fixture(t); patchExpoSqliteOwnership(f.root); f.write(f.unchanged, "changed\n");
  assert.throws(() => patchExpoSqliteOwnership(f.root), /refusing to overwrite/);
});
test("package version changes require review", t => {
  const f = fixture(t);
  f.write("node_modules/expo-sqlite/package.json", JSON.stringify({ name: "expo-sqlite", version: "55.0.21" }));
  assert.throws(() => patchExpoSqliteOwnership(f.root), /version mismatch/);
  assert.equal(f.read(f.source), "old\n");
});
test("changed patch cannot execute", t => {
  const f = fixture(t); f.write("patches/expo-sqlite+55.0.20.patch", "wrong\n");
  assert.throws(() => patchExpoSqliteOwnership(f.root), /digest mismatch/);
  assert.equal(f.read(f.source), "old\n");
});
test("git check failure leaves all targets unchanged", t => {
  const f = fixture(t);
  const patchName = "patches/expo-sqlite+55.0.20.patch";
  const manifestName = "patches/expo-sqlite+55.0.20.json";
  const invalid = f.read(patchName).replace("-old\n", "-different\n");
  const manifest = JSON.parse(f.read(manifestName));
  manifest.patchSha256 = hash(invalid);
  f.write(patchName, invalid); f.write(manifestName, JSON.stringify(manifest));
  assert.throws(() => patchExpoSqliteOwnership(f.root), /patch failed/);
  assert.equal(f.read(f.source), "old\n");
  assert.equal(fs.existsSync(path.join(f.root, f.added)), false);
});
test("nonregular targets are rejected before writing", t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, f.added));
  assert.throws(() => patchExpoSqliteOwnership(f.root), /not a regular file/);
  assert.equal(f.read(f.source), "old\n");
});
test("nested consumer dependency cannot bypass the ownership patch", t => {
  const f = fixture(t);
  f.write("apps/mobile/node_modules/expo-sqlite/package.json", JSON.stringify({ name: "expo-sqlite", version: "55.0.20" }));
  assert.throws(() => patchExpoSqliteOwnership(f.root), /resolves an unpatched dependency/);
  assert.equal(f.read(f.source), "old\n");
});
