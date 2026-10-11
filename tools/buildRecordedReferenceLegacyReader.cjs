/* Freeze actual pre-reference readers; never regenerate them from new schemas. */
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
const names = ["zod", "proj4", "fflate", "@xmldom/xmldom", "@placemarkio/tokml", "@tmcw/togeojson", "jsonc-parser"];
const entry = `
export { parseProjectDocument, serializeProjectDocument, PROJECT_DOCUMENT_VERSIONS } from "./packages/core/src/projectDocument";
export { parseDesignDraftDocument, serializeDesignDraftDocument, DESIGN_DRAFT_DOCUMENT_VERSIONS } from "./packages/core/src/designDraft";
export { parseFieldDesignDocument, serializeFieldDesignDocument, FIELD_DESIGN_DOCUMENT_VERSIONS } from "./packages/core/src/fieldDesignDocument";
export { parseFieldLayoutTarget } from "./packages/core/src/fieldLayoutTarget";
export { parseLayoutSessionDocument } from "./packages/core/src/layoutSession";
export { parseSurveyCollectionDocument } from "./packages/core/src/surveyCollection";
export { parseWorkspaceDocument, validateWorkspaceDocument } from "./packages/project-store/src/workspaceDocument";
export { parseDesignWorkspaceBundle, importDesignWorkspaceBundleZip } from "./packages/project-store/src/designWorkspaceBundle";
export { importProjectArchiveZip } from "./packages/project-store/src/projectArchive";
export { importDesignDraftArchiveZip } from "./packages/project-store/src/designDraftArchive";
export { importFieldDesignArchiveZip } from "./packages/project-store/src/fieldDesignArchive";
export { importLayoutSessionArchiveZip } from "./packages/project-store/src/layoutSessionArchive";
`;
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
function libraryFingerprint(name) {
  let dir = path.dirname(require.resolve(name, { paths: [root] }));
  while (!fs.existsSync(path.join(dir, "package.json")) || JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).name !== name) {
    const parent = path.dirname(dir); if (parent === dir) throw new Error(`Cannot resolve installed library ${name}`); dir = parent;
  }
  const files = [];
  function visit(current) {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, item.name);
      if (item.isDirectory() && item.name !== "node_modules") visit(file);
      else if (item.isFile() && /\.(?:c?js|mjs|json)$/.test(item.name)) files.push([path.relative(dir, file).replaceAll("\\", "/"), hash(fs.readFileSync(file))]);
    }
  }
  visit(dir); files.sort(([a], [b]) => a.localeCompare(b));
  return { version: JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version, runtimeFingerprint: hash(JSON.stringify(files)), fileCount: files.length };
}
async function build(packetPath, output) {
  if (!packetPath) throw new Error("Pass --packet pointing at the verified pre-wave source manifest.");
  if (fs.existsSync(output) || fs.existsSync(output.replace(/\.cjs$/, ".json"))) throw new Error("Frozen reader already exists. Verify it; do not overwrite historical readers.");
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const result = await esbuild.build({ stdin: { contents: entry, resolveDir: root, sourcefile: "recorded-reference-legacy-entry.ts", loader: "ts" },
    bundle: true, format: "cjs", platform: "node", target: "node20", minify: true, sourcemap: false,
    external: names, metafile: true, write: false, absWorkingDir: root });
  const inputs = {};
  for (const name of Object.keys(result.metafile.inputs)) {
    if (name === "recorded-reference-legacy-entry.ts") continue;
    const file = path.resolve(root, name), relative = path.relative(root, file).replaceAll("\\", "/");
    if (relative.startsWith("../") || relative.includes("node_modules/")) throw new Error(`Unexpected bundled runtime dependency ${relative}`);
    const actual = hash(fs.readFileSync(file));
    if (packet.files[relative] !== actual) throw new Error(`Reader source differs from frozen packet: ${relative}`);
    inputs[relative] = actual;
  }
  const externals = [...new Set(Object.values(result.metafile.outputs).flatMap(output => output.imports.filter(item => item.external).map(item => item.path)))].sort();
  if (externals.some(name => !names.includes(name) && !name.startsWith("node:"))) throw new Error(`Reader contains a live repository/unknown import: ${externals.join(", ")}`);
  const code = result.outputFiles[0].contents;
  const manifest = { fixtureVersion: "recorded-reference-legacy-reader-v1", sourceFingerprint: packet.fingerprint,
    compiler: { name: "esbuild", version: esbuild.version, format: "cjs", platform: "node", target: "node20", minify: true },
    entry, entrySha256: hash(entry), sourceFiles: inputs, externalImports: externals,
    libraries: Object.fromEntries(names.map(name => [name, libraryFingerprint(name)])), outputSha256: hash(code) };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, code, { flag: "wx" }); fs.writeFileSync(output.replace(/\.cjs$/, ".json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return { sourceFiles: Object.keys(inputs).length, bytes: code.length, outputSha256: manifest.outputSha256 };
}
function verify(output) {
  const manifest = JSON.parse(fs.readFileSync(output.replace(/\.cjs$/, ".json"), "utf8"));
  if (hash(fs.readFileSync(output)) !== manifest.outputSha256 || hash(manifest.entry) !== manifest.entrySha256) throw new Error("Frozen reader bytes or entry were changed.");
  for (const [name, expected] of Object.entries(manifest.libraries)) {
    if (JSON.stringify(libraryFingerprint(name)) !== JSON.stringify(expected)) throw new Error(`Frozen reader library changed: ${name}`);
  }
  return manifest;
}
module.exports = { verify };
if (require.main === module) {
  const args = process.argv.slice(2), get = key => args[args.indexOf(key) + 1];
  const output = path.resolve(root, args.includes("--output") ? get("--output") : "tests/fixtures/recorded-reference-legacy-reader.cjs");
  const operation = args.includes("--verify") ? Promise.resolve().then(() => verify(output)).then(result => ({ verified: true, outputSha256: result.outputSha256 })) : build(args.includes("--packet") ? get("--packet") : null, output);
  operation.then(result => process.stdout.write(JSON.stringify(result) + "\n")).catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
}
