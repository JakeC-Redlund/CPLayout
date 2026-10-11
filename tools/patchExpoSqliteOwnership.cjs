const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const prefix = "node_modules/expo-sqlite/";
const sha256 = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function patchExpoSqliteOwnership(root, { checkOnly = false } = {}) {
  const patch = path.join(root, "patches/expo-sqlite+55.0.20.patch");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "patches/expo-sqlite+55.0.20.json"), "utf8"));
  if (sha256(patch) !== manifest.patchSha256) throw new Error("SQLite ownership patch digest mismatch");
  for (const [name, version] of Object.entries(manifest.versions)) {
    const installed = JSON.parse(fs.readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8"));
    if (installed.name !== name || installed.version !== version) {
      throw new Error("SQLite ownership package version mismatch: " + name);
    }
  }
  const sqlitePackage = fs.realpathSync(path.join(root, prefix, "package.json"));
  for (const consumer of ["apps/mobile", "packages/project-store"]) {
    const resolved = require.resolve("expo-sqlite/package.json", { paths: [path.join(root, consumer)] });
    if (fs.realpathSync(resolved) !== sqlitePackage) {
      throw new Error("SQLite consumer resolves an unpatched dependency: " + consumer);
    }
  }
  const expected = new Map();
  for (const [relative, digest] of Object.entries(manifest.pins)) {
    expected.set(prefix + relative, { original: digest, patched: digest });
  }
  for (const file of manifest.files) {
    const entry = expected.get(file.target);
    if ((file.added && entry) || (!file.added && !entry) || !file.target.startsWith(prefix)) {
      throw new Error("Invalid SQLite ownership target: " + file.target);
    }
    expected.set(file.target, { original: file.added ? null : entry.original, patched: file.expected });
  }
  function inspect() {
    return [...expected].map(([relative, hashes]) => {
      if (relative.split(/[\\/]/).includes("..") || path.isAbsolute(relative)) throw new Error("Invalid patch path");
      const file = path.join(root, relative);
      const stat = fs.existsSync(file) ? fs.lstatSync(file) : null;
      if (stat && !stat.isFile()) throw new Error("SQLite patch target is not a regular file: " + relative);
      return { relative, ...hashes, actual: stat ? sha256(file) : null };
    });
  }
  const before = inspect();
  if (before.every(file => file.actual === file.patched)) return "already-installed";
  if (!before.every(file => file.actual === file.original)) {
    throw new Error("SQLite ownership baseline changed or is partially patched; refusing to overwrite installed files");
  }
  if (checkOnly) throw new Error("SQLite ownership patch is not installed; run npm run patch:sqlite-ownership");
  for (const args of [["apply", "--check", "--whitespace=error-all", patch], ["apply", "--whitespace=error-all", patch]]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 30000 });
    if (result.error || result.status !== 0) {
      throw new Error("SQLite ownership patch failed: " + (result.error?.message || result.stderr));
    }
  }
  if (!inspect().every(file => file.actual === file.patched)) throw new Error("SQLite ownership post-install hash mismatch");
  return "installed";
}

module.exports = { patchExpoSqliteOwnership };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--check")) throw new Error("Unknown SQLite patch option");
  console.log("SQLite ownership patch: " + patchExpoSqliteOwnership(path.resolve(__dirname, ".."), { checkOnly: args.includes("--check") }));
}
