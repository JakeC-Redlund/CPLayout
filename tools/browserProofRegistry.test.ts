import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertBrowserProofInventory, browserProofSelection, buildBrowserProofInventory, parseFullBrowserDiscovery,
  resolveBrowserProofScope, BROWSER_PROOF_INVENTORY_PATH, BROWSER_PROOF_PROJECTS, BROWSER_PROOF_REGISTRY,
  type BrowserProofInventory, type BrowserProofScope } from "./browserProofRegistry";
import { runBrowserProofInventory } from "./buildBrowserProofInventory";
import { GIS_PROOF_CASES, GIS_PACKAGE_PROOF_CASES } from "../tests/web/gis-proof-cases";
import { bindExportedAsset } from "../tests/web/gis-evidence";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(readFileSync(join(root, BROWSER_PROOF_INVENTORY_PATH), "utf8")) as BrowserProofInventory;
function report(value = inventory) {
  return { errors: [], stats: { expected: 0, skipped: 1251 }, suites: value.files.map(file => ({ title: file.file.split("/").at(-1), file: file.file.split("/").at(-1),
    specs: file.cases.flatMap(c => c.projects.map(projectName => ({ file: file.file.split("/").at(-1), title: c.title, line: c.line, column: c.column, tests: [{ projectName }] }))) })) };
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "cplayout-browser-registry-")); mkdirSync(join(directory, "tests/web"), { recursive: true });
  for (const file of inventory.files) writeFileSync(join(directory, file.file), readFileSync(join(root, file.file)));
  writeFileSync(join(directory, BROWSER_PROOF_INVENTORY_PATH), JSON.stringify(inventory)); return directory;
}
function selected(scope: BrowserProofScope, file: string, title: string, project = "desktop") {
  return browserProofSelection(scope).grep.some(regex => regex.test(`${project} ${file} ${title}`));
}

test("actual source inventory has 417 concrete cases and all1251 executions without counting stats.expected", () => {
  assertBrowserProofInventory(root, inventory);
  const parsed = parseFullBrowserDiscovery(report()); assert.equal(parsed.length, 417);
  assert.equal(parsed.reduce((count, c) => count + c.projects.length, 0), 1251);
  assert.deepEqual(buildBrowserProofInventory(root, report()), inventory);
  assert(inventory.files.find(f => f.file.endsWith("browser-workflow.spec.ts"))!.cases.some(c => c.title.startsWith("touch vertex ownership ")));
});
test("current/all/deferred filters partition every actual concrete execution and require all twelve whole current suites", () => {
  let all = 0, active = 0, deferred = 0;
  for (const f of inventory.files) for (const c of f.cases) for (const project of c.projects) {
    const a = selected("current", f.file, c.title, project), d = selected("deferred", f.file, c.title, project);
    assert(selected("all", f.file, c.title, project)); assert.notEqual(a, d, `${f.file}: ${c.title}`);
    assert.equal(a, c.disposition === "current"); all++; if (a) active++; if (d) deferred++;
  }
  assert.deepEqual({ all, active, deferred }, { all: 1251, active: 291, deferred: 960 });
  assert.equal(BROWSER_PROOF_REGISTRY.filter(e => e.category === "current-app" || e.category === "platform").length, 12);
  assert.equal(browserProofSelection("current").testMatch.length, 14);
});
test("mixed files retain only their three exact independent titles, rejecting near matches and wrong-file/title collisions", () => {
  for (const entry of BROWSER_PROOF_REGISTRY.filter(e => e.category === "mixed")) for (const title of entry.currentTitles!) {
    assert(selected("current", entry.file, title)); assert(!selected("deferred", entry.file, title));
    assert(!selected("current", entry.file, title + " extra")); assert(!selected("current", "other-" + entry.file, title));
  }
  assert(!selected("current", "browser-workflow.spec.ts", "workspace command menus open without overflow across responsive viewports"));
  assert(selected("deferred", "maplibre-runtime.spec.ts", "loaded map updates edited geometry while later raster requests remain pending"));
  assert(!selected("current", "browser-workflow.spec.ts", "quoted unified-workspace.spec.ts accidental selection"));
});
test("scopes are explicit, unknown and empty values refuse rather than choosing a green or empty scope", () => {
  assert.equal(resolveBrowserProofScope("current"), "current"); assert.equal(resolveBrowserProofScope("all"), "all"); assert.equal(resolveBrowserProofScope("deferred"), "deferred");
  for (const input of ["", "CURRENT", "legacy", "current "]) assert.throws(() => resolveBrowserProofScope(input), /unknown scope/);
  assert.throws(() => browserProofSelection("typo" as BrowserProofScope), /unknown scope/);
});
for (const mode of ["new", "missing", "hash"] as const) test(`audit refuses ${mode} spec drift while leaving inventory bytes unchanged`, () => {
  const directory = fixture();
  try {
    const before = readFileSync(join(directory, BROWSER_PROOF_INVENTORY_PATH));
    if (mode === "new") writeFileSync(join(directory, "tests/web/unreviewed.spec.ts"), "test('new', () => {});\n");
    else if (mode === "missing") rmSync(join(directory, inventory.files[0].file));
    else writeFileSync(join(directory, inventory.files[0].file), readFileSync(join(directory, inventory.files[0].file), "utf8") + "\n");
    assert.throws(() => assertBrowserProofInventory(directory, inventory), /new, missing|hash drift/);
    assert.throws(() => runBrowserProofInventory([], directory), /new, missing|hash drift/);
    assert.deepEqual(readFileSync(join(directory, BROWSER_PROOF_INVENTORY_PATH)), before);
  } finally { rmSync(directory, { recursive: true }); }
});
test("title/line/classification/count drift refuses, including supplied full discovery with unchanged source hashes", () => {
  for (const change of [(v: BrowserProofInventory) => { v.files[0].cases[0].title += " changed"; },
    (v: BrowserProofInventory) => { v.files[0].cases[0].line++; },
    (v: BrowserProofInventory) => { v.files[0].category = "platform"; },
    (v: BrowserProofInventory) => { v.counts.currentExecutions++; },
    (v: BrowserProofInventory) => { v.files[0].cases[0].disposition = "current"; }]) {
    const altered = structuredClone(inventory); change(altered); assert.throws(() => assertBrowserProofInventory(root, altered), /drift/);
  }
  const fresh = report(); fresh.suites[0].specs[0].title += " changed";
  assert.throws(() => assertBrowserProofInventory(root, inventory, fresh), /incomplete|title\/line drift/);
});
test("complete discovery refuses unknown specs, missing files/projects, duplicate executions, errors and empty reports", () => {
  const unknown = report(); unknown.suites[0].specs[0].file = "new.spec.ts";
  const missing = report(); missing.suites.pop();
  const project = report(); project.suites[0].specs[0].tests[0].projectName = "unknown";
  const duplicate = report(); duplicate.suites[0].specs.push(duplicate.suites[0].specs[0]);
  const tagged = report(); Object.assign(tagged.suites[0].specs[0], { tags: ["@unreviewed"] });
  for (const value of [unknown, missing, project, duplicate, tagged, { suites: [], errors: [] }, { suites: [], errors: ["failed import"] }])
    assert.throws(() => parseFullBrowserDiscovery(value), /discovery|execution|unclassified|tagged/);
});
test("CLI defaults to byte-preserving audit and deliberate writes require complete discovery before any effect", () => {
  const directory = fixture();
  try {
    const destination = join(directory, BROWSER_PROOF_INVENTORY_PATH), before = readFileSync(destination);
    runBrowserProofInventory([], directory); assert.deepEqual(readFileSync(destination), before);
    for (const args of [["--write"], ["--skip"], ["--discovery"]]) assert.throws(() => runBrowserProofInventory(args, directory), /requires|argument/);
    const supplied = join(directory, "full-discovery.json"); writeFileSync(supplied, JSON.stringify({ suites: [], errors: [] }));
    assert.throws(() => runBrowserProofInventory(["--write", "--discovery", supplied], directory), /incomplete/); assert.deepEqual(readFileSync(destination), before);
    writeFileSync(supplied, JSON.stringify(report())); runBrowserProofInventory(["--write", "--discovery", supplied], directory);
    assert.deepEqual(JSON.parse(readFileSync(destination, "utf8")), inventory);
  } finally { rmSync(directory, { recursive: true }); }
});

test("nested describe identity contributes to concrete titles even when Playwright repeats its source file", () => {
  const supplied = report(), mixed = supplied.suites.find(s => s.file === "browser-workflow.spec.ts")!;
  const candidates = mixed.specs.filter(s => s.title.startsWith("touch vertex ownership "));
  mixed.specs = mixed.specs.filter(s => !s.title.startsWith("touch vertex ownership "));
  Object.assign(mixed, { suites: [{ title: "touch vertex ownership", file: mixed.file,
    specs: candidates.map(s => ({ ...s, title: s.title.slice("touch vertex ownership ".length) })) }] });
  assert.deepEqual(buildBrowserProofInventory(root, supplied), inventory);
});

test("GIS current cases bind renderer requirements without promoting or retiring the 960 deferred obligations", () => {
  const file = inventory.files.find(file => file.file === "tests/web/gis-visual.spec.ts")!;
  assert.equal(file.category, "current-app"); assert.equal(file.cases.length, 5);
  assert.deepEqual(file.cases.map(item => ({ title: item.title, renderer: item.rendererRequirement })), GIS_PROOF_CASES);
  const packageFile = inventory.files.find(item => item.file === "tests/web/gis-package.spec.ts")!;
  assert.equal(packageFile.category, "current-app");
  assert.deepEqual(packageFile.cases.map(item => ({ title: item.title, renderer: item.rendererRequirement })).sort((a, b) => a.title.localeCompare(b.title)),
    [...GIS_PACKAGE_PROOF_CASES].sort((a, b) => a.title.localeCompare(b.title)));
  assert.equal(inventory.counts.deferredExecutions, 960);
  for (const rendererRequirement of [undefined, "renderer-independent"] as const) {
    const altered = structuredClone(inventory), gl = altered.files.find(item => item.file === file.file)!.cases[0];
    gl.rendererRequirement = rendererRequirement;
    assert.throws(() => assertBrowserProofInventory(root, altered), /renderer requirement drift/);
  }
});

test("GIS evidence refuses stale served bytes and outside-export symlinks before accepting an asset binding", () => {
  const directory = mkdtempSync(join(tmpdir(), "cplayout-gis-binding-"));
  try {
    const exported = join(directory, "export"), outside = join(directory, "outside.js"); mkdirSync(exported);
    const bytes = Buffer.from("synthetic current bundle\n"); writeFileSync(join(exported, "current.js"), bytes); writeFileSync(outside, bytes);
    const bound = bindExportedAsset(exported, "http://127.0.0.1:19006/current.js", bytes);
    assert.equal(bound.observedSha256, bound.exportedSha256); assert.equal(bound.bytes, bytes.length);
    assert.throws(() => bindExportedAsset(exported, "http://127.0.0.1:19006/current.js", Buffer.from("stale bundle")), /bytes disagree/);
    symlinkSync(outside, join(exported, "outside.js"));
    assert.throws(() => bindExportedAsset(exported, "http://127.0.0.1:19006/outside.js", bytes), /escapes the frozen export/);
  } finally { rmSync(directory, { recursive: true }); }
});
