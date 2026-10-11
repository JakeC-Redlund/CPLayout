const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const optional = process.argv.slice(2);
if (optional.some(value => value !== "--if-supported")) throw new Error("Unknown test option");
if (Number(process.versions.node.split(".")[0]) < 24 || process.platform === "win32") {
  const message = "Native workspace SQLite tests require Node 24 or newer on a POSIX host (use WSL on Windows); no native test evidence was produced.";
  if (optional.includes("--if-supported")) {
    console.warn("SKIPPED: " + message);
    process.exit(0);
  }
  throw new Error(message);
}

const root = path.resolve(__dirname, "..");
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cplayout-native-workspace-"));
const bundle = path.join(folder, "tests.mjs");
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const write = (name, value) => fs.writeFileSync(path.join(folder, name), JSON.stringify(value, null, 2) + "\n");
function directoryFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? directoryFiles(file) : [file];
  });
}

async function main() {
  let before = {}, status = null;
  const failures = [];
  try {
    fs.symlinkSync(path.join(root, "node_modules"), path.join(folder, "node_modules"),
      process.platform === "win32" ? "junction" : "dir");
    // Use the bundler supplied by the pinned tsx toolchain, without installing anything.
    const esbuild = require(require.resolve("esbuild", { paths: [path.dirname(require.resolve("tsx/package.json"))] }));
    const options = {
      absWorkingDir: root, entryPoints: ["packages/project-store/tests/native-workspace/regression.test.ts"],
      outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node24",
      sourcemap: true, metafile: true, external: ["jsonc-parser"],
    };
    const discover = await esbuild.build(options);
    write("discovery-inputs.json", discover.metafile);
    const inputs = Object.keys(discover.metafile.inputs).map(file => path.resolve(root, file)).sort();
    for (const file of inputs) {
      const relative = path.relative(root, fs.realpathSync(file));
      if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
        throw new Error("Test bundle contains a source outside this checkout: " + file);
      }
    }
    const parser = require.resolve("jsonc-parser", { paths: [folder] });
    const files = [...inputs, ...directoryFiles(path.dirname(parser)), __filename, bundle, bundle + ".map",
      require.resolve("jsonc-parser/package.json", { paths: [folder] }),
      path.join(root, "package-lock.json"), require.resolve("tsx/package.json"),
      require.resolve("esbuild/package.json", { paths: [path.dirname(require.resolve("tsx/package.json"))] })];
    before = Object.fromEntries([...new Set(files)].map(file => [file, hash(file)]));
    write("hashes-before.json", before);
    const built = await esbuild.build(options);
    write("build-inputs.json", built.metafile);
    const executedInputs = Object.keys(built.metafile.inputs).map(file => path.resolve(root, file)).sort();
    if (JSON.stringify(inputs) !== JSON.stringify(executedInputs) || files.some(file => hash(file) !== before[file])) {
      throw new Error("Source graph, dependencies, or executable changed across bundling");
    }
    const result = spawnSync(process.execPath, ["--test", bundle], {
      cwd: folder, encoding: "utf8", timeout: 240000, maxBuffer: 32 * 1024 * 1024,
    });
    fs.writeFileSync(path.join(folder, "tests.log"), (result.stdout || "") + (result.stderr || ""));
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    status = result.status;
    if (result.error || result.status !== 0) failures.push(result.error?.message || "Node test status: " + result.status);
  } catch (error) {
    failures.push(String(error));
  }
  const after = Object.fromEntries(Object.keys(before).map(file => [file, fs.existsSync(file) ? hash(file) : null]));
  const drift = Object.keys(before).filter(file => before[file] !== after[file]);
  if (drift.length) failures.push("Test inputs or executable changed during the run");
  const report = {
    at: new Date().toISOString(), node: process.version, root, folder, status,
    passed: failures.length === 0, failures, drift, before, after,
    scope: "Source and real Node SQLite tests with simulated Expo/native bridges; not device or field proof",
    transcript: path.join(folder, "tests.log"),
  };
  write("result.json", report);
  console.log("Native workspace evidence: " + path.join(folder, "result.json"));
  if (!report.passed) {
    failures.forEach(message => console.error(message));
    process.exitCode = 1;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
