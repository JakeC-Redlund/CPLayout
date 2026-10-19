import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GIS_PROOF_CASES, GIS_PACKAGE_PROOF_CASES, type GisRendererRequirement } from "../tests/web/gis-proof-cases";

export type BrowserProofScope = "current" | "all" | "deferred";
export type BrowserProofCategory = "current-app" | "platform" | "mixed" | "deferred-legacy";
export interface BrowserProofEntry { readonly file: string; readonly category: BrowserProofCategory; readonly coverageGap: string | null; readonly currentTitles?: readonly string[];
  readonly rendererRequirements?: Readonly<Record<string, GisRendererRequirement>> }
const debt = "Removed legacy App navigation/editor entrypoints require migration; these semantic contracts remain unverified in the current App.";
const entry = (file: string, category: BrowserProofCategory, coverageGap: string | null = null): BrowserProofEntry => ({ file, category, coverageGap });
export const BROWSER_PROOF_REGISTRY: readonly BrowserProofEntry[] = [
  { file: "gis-visual.spec.ts", category: "current-app", coverageGap: null,
    rendererRequirements: Object.fromEntries(GIS_PROOF_CASES.map(item => [item.title, item.renderer])) },
  { file: "gis-package.spec.ts", category: "current-app", coverageGap: null,
    rendererRequirements: Object.fromEntries(GIS_PACKAGE_PROOF_CASES.map(item => [item.title, item.renderer])) },
  ...["production-accessibility.spec.ts", "production-auth-workflow.spec.ts", "unified-workspace.spec.ts", "workspace-package-import.spec.ts", "workspace-startup-resume.spec.ts", "workspace-edit-recovery.spec.ts", "workspace-management.spec.ts"].map(file => entry(file, "current-app")),
  ...["workspace-storage.spec.ts", "workspace-drafts.spec.ts", "editor-save-lifecycle.spec.ts"].map(file => entry(file, "platform")),
  { file: "maplibre-runtime.spec.ts", category: "mixed", coverageGap: debt, currentTitles: ["MapLibre attribution rejects consecutive unsafe attributes"] },
  { file: "browser-workflow.spec.ts", category: "mixed", coverageGap: debt, currentTitles: [
    "text clipping probe distinguishes visible overflow from trailing wrap whitespace",
    "network allowlist blocks credential query strings on allowed imagery hosts",
  ] },
  ...["advisory-performance.spec.ts", "complete-workflow.spec.ts", "crs-recovery.spec.ts", "design-draft-editor.spec.ts", "draft-unit-and-saved-items.spec.ts",
    "field-design-editor.spec.ts", "human-catalog-forms.spec.ts", "human-design-inputs.spec.ts", "human-field-operations.spec.ts", "human-primary-tasks.spec.ts",
    "map-camera.spec.ts", "map-fit.spec.ts", "maplibre-recovery.spec.ts", "mapping-quality.spec.ts", "network-receiver.spec.ts", "project-copy.spec.ts",
    "project-import-lifecycle.spec.ts", "rtk-lifecycle.spec.ts", "will-rhea-preview.spec.ts", "workflow-safety.spec.ts", "workspace-activation.spec.ts"].map(file => entry(file, "deferred-legacy", debt)),
];
export const BROWSER_PROOF_PROJECTS = ["desktop", "tablet-768", "mobile-390"] as const;
export const BROWSER_PROOF_INVENTORY_PATH = "tests/web/browser-proof-inventory.json";
const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
function fail(message: string): never { throw new Error(`Browser proof inventory: ${message}`); }
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const current = (entry: BrowserProofEntry, title: string): boolean => entry.category === "current-app" || entry.category === "platform"
  || entry.category === "mixed" && entry.currentTitles!.includes(title);
export function resolveBrowserProofScope(value = process.env.CPLAYOUT_WEB_PROOF_SCOPE): BrowserProofScope {
  if (value === undefined) return "current";
  if (value === "current" || value === "all" || value === "deferred") return value;
  return fail(`unknown scope ${JSON.stringify(value)}; use current, all or deferred explicitly.`);
}
/** Filters apply to Playwright's project/file/describe/title string; source tests remain untouched. */
export function browserProofSelection(scope: BrowserProofScope = resolveBrowserProofScope()) {
  resolveBrowserProofScope(scope);
  const entries = BROWSER_PROOF_REGISTRY.filter(e => scope === "all" || (scope === "current"
    ? e.category !== "deferred-legacy" : e.category === "mixed" || e.category === "deferred-legacy"));
  const grep = entries.map(e => {
    const file = `^(?:${BROWSER_PROOF_PROJECTS.map(escapeRegex).join("|")}) (?:[^\\s]*[/\\\\])?${escapeRegex(e.file)}\\s+`;
    if (scope === "all" || e.category !== "mixed") return new RegExp(file);
    const titles = e.currentTitles!.map(escapeRegex).join("|");
    return new RegExp(`${file}${scope === "deferred" ? `(?!(${titles})$)` : ""}${scope === "current" ? `(?:${titles})$` : ".+"}`);
  });
  if (!entries.length || !grep.length) fail("empty selection is not permitted.");
  return { testMatch: entries.map(e => `**/${e.file}`), grep };
}
export interface BrowserProofCase { title: string; line: number; column: number; projects: string[]; disposition: "current" | "deferred"; coverageGap: string | null;
  rendererRequirement?: GisRendererRequirement }
export interface BrowserProofFile { file: string; sha256: string; category: BrowserProofCategory; coverageGap: string | null; cases: BrowserProofCase[] }
export interface BrowserProofInventory { inventoryVersion: "cplayout-browser-proof-inventory-v1"; claim: string; projects: string[];
  discoveryFingerprint: string; counts: { files: number; uniqueCases: number; currentExecutions: number; deferredExecutions: number; allExecutions: number }; files: BrowserProofFile[] }
export interface DiscoveredBrowserCase { file: string; title: string; line: number; column: number; projects: string[] }
const sortedProjects = (projects: string[]) => BROWSER_PROOF_PROJECTS.filter(project => projects.includes(project));
/** --list reports skipped executions and stats.expected=0. Count specs.tests, never stats.expected. */
export function parseFullBrowserDiscovery(report: unknown): DiscoveredBrowserCase[] {
  const input = report as { suites?: unknown[]; errors?: unknown[] };
  if (!input || !Array.isArray(input.suites) || !Array.isArray(input.errors) || input.errors.length) fail("complete discovery must contain suites and no errors.");
  const found = new Map<string, DiscoveredBrowserCase>();
  function walk(suites: unknown[], ancestry: string[] = []) {
    for (const item of suites) {
      const suite = item as { file?: string; title?: string; specs?: unknown[]; suites?: unknown[] };
      const fileSuite = suite.file !== undefined && suite.title === suite.file;
      const titles = fileSuite ? ancestry : [...ancestry, suite.title ?? ""];
      for (const value of suite.specs ?? []) {
        const spec = value as { file?: string; title?: string; line?: number; column?: number; tags?: unknown; tests?: { projectName?: string }[] };
        if (typeof spec.file !== "string" || !BROWSER_PROOF_REGISTRY.some(e => spec.file === e.file) || !spec.title
          || !Number.isSafeInteger(spec.line) || spec.line! < 1 || !Number.isSafeInteger(spec.column) || spec.column! < 1 || !Array.isArray(spec.tests) || !spec.tests.length) fail("unclassified file or invalid discovered case.");
        if (spec.tags !== undefined && (!Array.isArray(spec.tags) || spec.tags.length)) fail("tagged discovery requires an explicit file/title filter review.");
        const title = [...titles, spec.title].filter(Boolean).join(" "), key = JSON.stringify([spec.file, title, spec.line, spec.column]);
        const record: DiscoveredBrowserCase = found.get(key) ?? { file: spec.file, title, line: spec.line!, column: spec.column!, projects: [] };
        for (const test of spec.tests) {
          if (!test.projectName || !(BROWSER_PROOF_PROJECTS as readonly string[]).includes(test.projectName) || record.projects.includes(test.projectName)) fail("unknown or duplicate project execution.");
          record.projects.push(test.projectName);
        }
        found.set(key, record);
      }
      if (suite.suites) walk(suite.suites, titles);
    }
  }
  walk(input.suites);
  const records = [...found.values()].map(c => ({ ...c, projects: [...sortedProjects(c.projects)] })).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.title.localeCompare(b.title));
  if (new Set(records.map(c => c.file)).size !== BROWSER_PROOF_REGISTRY.length || records.some(c => c.projects.length !== BROWSER_PROOF_PROJECTS.length)) fail("incomplete file/project discovery.");
  return records;
}
function sourceFiles(root: string): string[] {
  const files: string[] = [];
  function scan(relative: string) {
    for (const item of readdirSync(join(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${item.name}`;
      if (item.isDirectory()) scan(name);
      else if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(item.name)) files.push(name);
    }
  }
  scan("tests/web"); return files.sort();
}
const discoveryFromInventory = (inventory: BrowserProofInventory): DiscoveredBrowserCase[] => inventory.files.flatMap(f => f.cases.map(c => ({ file: f.file.slice("tests/web/".length), title: c.title, line: c.line, column: c.column, projects: c.projects })))
  .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.title.localeCompare(b.title));
export function buildBrowserProofInventory(root: string, report: unknown): BrowserProofInventory {
  const discovered = parseFullBrowserDiscovery(report);
  const files = [...BROWSER_PROOF_REGISTRY].sort((a, b) => a.file.localeCompare(b.file)).map(e => ({ file: `tests/web/${e.file}`,
    sha256: sha(readFileSync(join(root, "tests/web", e.file))), category: e.category, coverageGap: e.coverageGap,
    cases: discovered.filter(c => c.file === e.file).map(c => ({ title: c.title, line: c.line, column: c.column, projects: c.projects,
      disposition: current(e, c.title) ? "current" as const : "deferred" as const, coverageGap: current(e, c.title) ? null : debt,
      ...(e.rendererRequirements ? { rendererRequirement: e.rendererRequirements[c.title] } : {}) })) }));
  const cases = files.flatMap(f => f.cases);
  const executions = (disposition?: BrowserProofCase["disposition"]) => cases.filter(c => !disposition || c.disposition === disposition).reduce((n, c) => n + c.projects.length, 0);
  const inventory: BrowserProofInventory = { inventoryVersion: "cplayout-browser-proof-inventory-v1", claim: "Discovery and scoped coverage accounting only; deferred contracts are neither retired nor verified.",
    projects: [...BROWSER_PROOF_PROJECTS], discoveryFingerprint: sha(JSON.stringify(discovered)),
    counts: { files: files.length, uniqueCases: cases.length, currentExecutions: executions("current"), deferredExecutions: executions("deferred"), allExecutions: executions() }, files };
  assertBrowserProofInventory(root, inventory); return inventory;
}
export function assertBrowserProofInventory(root: string, inventory: BrowserProofInventory, discovery?: unknown): void {
  if (!inventory || inventory.inventoryVersion !== "cplayout-browser-proof-inventory-v1" || !Array.isArray(inventory.files)
    || JSON.stringify(inventory.projects) !== JSON.stringify(BROWSER_PROOF_PROJECTS)) fail("invalid inventory version/projects.");
  const expectedFiles = BROWSER_PROOF_REGISTRY.map(e => `tests/web/${e.file}`).sort();
  if (JSON.stringify(sourceFiles(root)) !== JSON.stringify(expectedFiles)) fail("new, missing or unclassified spec source; review the registry before publication.");
  if (JSON.stringify(inventory.files.map(f => f.file).sort()) !== JSON.stringify(expectedFiles)) fail("inventory file drift.");
  const seen = new Set<string>(); let all = 0, active = 0;
  for (const f of inventory.files) {
    const e = BROWSER_PROOF_REGISTRY.find(e => f.file === `tests/web/${e.file}`)!;
    if (f.category !== e.category || f.coverageGap !== e.coverageGap || sha(readFileSync(join(root, f.file))) !== f.sha256) fail(`classification/hash drift: ${f.file}`);
    if (!Array.isArray(f.cases) || !f.cases.length) fail(`empty cases: ${f.file}`);
    for (const title of e.currentTitles ?? []) if (!f.cases.some(c => c.title === title)) fail(`required mixed title disappeared: ${f.file}: ${title}`);
    if (e.rendererRequirements && JSON.stringify(Object.keys(e.rendererRequirements).sort()) !== JSON.stringify(f.cases.map(c => c.title).sort())) fail(`GIS renderer case classification drift: ${f.file}`);
    for (const c of f.cases) {
      const key = JSON.stringify([f.file, c.title, c.line, c.column]);
      if (!c.title || !Number.isSafeInteger(c.line) || c.line < 1 || !Number.isSafeInteger(c.column) || c.column < 1 || seen.has(key)
        || JSON.stringify(c.projects) !== JSON.stringify(BROWSER_PROOF_PROJECTS)) fail(`title/line/project drift: ${f.file}`);
      seen.add(key);
      const admitted = current(e, c.title);
      if (c.disposition !== (admitted ? "current" : "deferred") || c.coverageGap !== (admitted ? null : debt)) fail(`case coverage drift: ${f.file}`);
      if (c.rendererRequirement !== e.rendererRequirements?.[c.title]) fail(`renderer requirement drift: ${f.file}: ${c.title}`);
      all += c.projects.length; if (admitted) active += c.projects.length;
    }
  }
  if (inventory.discoveryFingerprint !== sha(JSON.stringify(discoveryFromInventory(inventory)))) fail("title/line discovery fingerprint drift.");
  if (JSON.stringify(inventory.counts) !== JSON.stringify({ files: 35, uniqueCases: 417, currentExecutions: 291, deferredExecutions: 960, allExecutions: 1251 })
    || all !== 1251 || active !== 291 || seen.size !== 417) fail("reviewed counts drift; a complete deliberate inventory update is required.");
  if (discovery && JSON.stringify(parseFullBrowserDiscovery(discovery)) !== JSON.stringify(discoveryFromInventory(inventory))) fail("fresh discovery title/line drift.");
}
