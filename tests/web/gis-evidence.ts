import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { arch, platform, release } from "node:os";
import { expect, type Locator, type Page, type Response, type TestInfo } from "@playwright/test";

import { GIS_PROOF_CASES, GIS_PACKAGE_PROOF_CASES, type GisRendererRequirement } from "./gis-proof-cases";
export { GIS_PROOF_CASES } from "./gis-proof-cases";

const root = resolve(__dirname, "../.."), exportRoot = resolve(root, "apps/mobile/dist");
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Fail closed if an observed asset belongs to another export, including a
 * symlink outside it. Both actual response bytes and on-disk bytes are bound. */
export function bindExportedAsset(directory: string, url: string, bytes: Uint8Array) {
  const pathname = decodeURIComponent(new URL(url).pathname), file = resolve(directory, `.${pathname}`);
  const within = relative(realpathSync(directory), realpathSync(file));
  if (isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`)) throw new Error("GIS evidence asset escapes the frozen export.");
  const exportedSha256 = hash(readFileSync(file)), observedSha256 = hash(bytes);
  if (exportedSha256 !== observedSha256) throw new Error(`GIS served/export bytes disagree: ${pathname}`);
  return { path: pathname, observedSha256, exportedSha256, bytes: bytes.byteLength };
}

function sourceIdentity() {
  const paths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--",
    "apps/mobile/src", "apps/mobile/App.tsx", "apps/api/src", "packages", "tests/web", "tools/prepareMapLibreAssets.ts",
    "tools/browserProofRegistry.ts", "playwright.config.ts", "package.json", "package-lock.json"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(path => path && (/\.(?:tsx?|cjs|mjs|css)$/.test(path) || /(?:^|\/)package(?:-lock)?\.json$/.test(path))).sort();
  if (!paths.length || !paths.includes("package-lock.json")) throw new Error("GIS source/lock fingerprint is incomplete.");
  const hashes = Object.fromEntries(paths.map(path => [path, hash(readFileSync(resolve(root, path)))]));
  return { scope: "GIS TypeScript, styles, package manifests and reviewed lock; not the whole implementation census", sha256: hash(JSON.stringify(hashes)), lockSha256: hashes["package-lock.json"], hashes };
}

function installedPackage(name: string, owner = "package.json"): { version: string; directory: string } {
  const requireOwner = createRequire(resolve(root, owner));
  // Published import-only packages can deliberately omit a CommonJS root.
  // Resolve their exported metadata from the consuming workspace first.
  let direct: string | undefined;
  try { direct = requireOwner.resolve(`${name}/package.json`); } catch { /* Fall back for packages which hide package.json. */ }
  if (direct) {
    const value = JSON.parse(readFileSync(direct, "utf8"));
    if (value.name !== name || typeof value.version !== "string") throw new Error(`Invalid consumed package metadata for ${name}.`);
    return { version: value.version, directory: dirname(direct) };
  }
  let directory = dirname(requireOwner.resolve(name));
  for (;;) {
    const manifest = resolve(directory, "package.json");
    if (existsSync(manifest)) { const value = JSON.parse(readFileSync(manifest, "utf8")); if (value.name === name && typeof value.version === "string") return { version: value.version, directory }; }
    const parent = dirname(directory); if (parent === directory) throw new Error(`Cannot bind installed version for ${name}.`); directory = parent;
  }
}
const installedVersion = (name: string, owner = "package.json"): string => installedPackage(name, owner).version;

export async function requireGisMapLibre(page: Page, settled = true): Promise<Locator> {
  const renderer = page.getByTestId("workspace-map-web-renderer");
  await expect(renderer).toBeVisible();
  await expect(page.getByTestId("workspace-map-svg-renderer")).toHaveCount(0);
  await expect(renderer).toHaveAttribute("data-map-loaded", "true");
  await expect(renderer.locator("canvas.maplibregl-canvas")).toHaveCount(1);
  if (settled) await expect(renderer).toHaveAttribute("data-map-settled", "true");
  await expect.poll(async () => {
    const raw = await renderer.getAttribute("data-map-camera-state");
    if (!raw) return false;
    const state = JSON.parse(raw);
    return state.requestedKey === state.appliedKey && !!state.expected && !state.moving
      && Math.abs(state.center.longitude - state.expected.center.longitude) <= 1e-7
      && Math.abs(state.center.latitude - state.expected.center.latitude) <= 1e-7
      && Math.abs(state.zoom - state.expected.zoom) <= 1e-7;
  }).toBe(true);
  return renderer;
}

/** Attach measurements and require repeat captures to be byte-identical before
 * exact baseline comparison. No broad GPU/antialias tolerance is inferred. */
export async function compareGisControls(locator: Locator, info: TestInfo, name: string): Promise<void> {
  await locator.page().evaluate(() => document.fonts.ready.then(() => undefined));
  const options = { animations: "disabled" as const, caret: "hide" as const, scale: "css" as const };
  const captures: Buffer[] = [];
  for (let index = 0; index < 3; index++) captures.push(await locator.screenshot(options));
  await info.attach(`${name}-repeat-noise.json`, { contentType: "application/json", body: JSON.stringify({ region: name,
    algorithm: "three consecutive exact PNG captures", captures: captures.map(value => ({ sha256: hash(value), bytes: value.length })),
    chosenMaxDiffPixels: 0, chosenThreshold: 0 }) });
  expect(captures[1].equals(captures[0]), `${name}: measure stable controls before admitting an exact baseline`).toBe(true);
  expect(captures[2].equals(captures[1]), `${name}: repeat-capture noise must be zero`).toBe(true);
  await expect(locator).toHaveScreenshot(`${name}.png`, { ...options, maxDiffPixels: 0, maxDiffPixelRatio: 0, threshold: 0 });
}

/** Generalized source/served/export/browser/renderer binding. Fixtures contain
 * synthetic data only; preserve a bounded map DOM instead of account HTML. */
export function createGisEvidence(page: Page, info: TestInfo, baseURL: string) {
  const source = sourceIdentity(), origin = new URL(baseURL).origin;
  const tuple = { project: info.project.name, file: relative(root, info.file).replaceAll(sep, "/"), title: info.title, retry: info.retry, repeatEachIndex: info.repeatEachIndex, workerIndex: info.workerIndex };
  const caseRequirement = [...GIS_PROOF_CASES, ...GIS_PACKAGE_PROOF_CASES].find(item => item.title === info.title)?.renderer;
  if (!caseRequirement) throw new Error("GIS execution is missing an explicit renderer requirement.");
  const directory = resolve(root, "reports/continuous-improvement/gis-evidence", hash(JSON.stringify(tuple)).slice(0, 20));
  const responses: ReturnType<typeof bindExportedAsset>[] = [], errors: string[] = [], responseErrors: string[] = [];
  const jobs = new Set<Promise<void>>();
  const onPageError = (error: Error) => errors.push(error.message);
  const onResponse = (response: Response) => {
    const url = new URL(response.url());
    if (url.origin !== origin || !/\.(?:m?js|css)$/.test(url.pathname) || !response.ok()) return;
    const job = (async () => { try { responses.push(bindExportedAsset(exportRoot, url.href, await response.body())); }
      catch (error) { responseErrors.push(error instanceof Error ? error.message : String(error)); } })();
    jobs.add(job); void job.finally(() => jobs.delete(job));
  };
  page.on("pageerror", onPageError); page.on("response", onResponse);
  return {
    errors,
    async capture(name: string, requirement: GisRendererRequirement, fixture: { id: string; crs: string }, extra: Record<string, unknown> = {}) {
      expect(requirement, "capture must preserve the declared case renderer obligation").toBe(caseRequirement);
      await Promise.all([...jobs]);
      const surface = page.getByTestId("workspace-map-surface"); await expect(surface).toBeVisible();
      const gl = page.getByTestId("workspace-map-web-renderer"), svg = page.getByTestId("workspace-map-svg-renderer");
      const renderer = await gl.isVisible() ? "maplibre" : await svg.isVisible() ? "svg" : "absent";
      if (requirement === "maplibre-required") expect(renderer).toBe("maplibre");
      if (requirement === "svg-required") expect(renderer).toBe("svg");
      expect(renderer).not.toBe("absent");
      const sourceAfter = sourceIdentity(); expect(sourceAfter.sha256, "frozen GIS source changed during browser execution").toBe(source.sha256);
      const scriptUrls = await page.locator("script[src]").evaluateAll(nodes => nodes.map(node => (node as HTMLScriptElement).src));
      expect(scriptUrls.length).toBeGreaterThan(0);
      const fetched = await Promise.all(scriptUrls.map(async url => { expect(new URL(url).origin).toBe(origin);
        const response = await page.request.get(url); expect(response.ok()).toBe(true); return bindExportedAsset(exportRoot, url, await response.body()); }));
      for (const script of fetched) expect(responses.some(response => response.path === script.path && response.observedSha256 === script.observedSha256), "main script must have been observed in the page's response stream").toBe(true);
      const maplibrePackage = installedPackage("maplibre-gl", "packages/map-adapters/package.json");
      const maplibreAssets = await Promise.all(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs", "LICENSE.txt"].map(async asset => {
        const url = new URL(`/maplibre/${maplibrePackage.version}/${asset}`, baseURL).href;
        const response = await page.request.get(url); expect(response.ok()).toBe(true);
        const bound = bindExportedAsset(exportRoot, url, await response.body());
        const installedSha256 = hash(readFileSync(resolve(maplibrePackage.directory, asset === "LICENSE.txt" ? asset : `dist/${asset}`)));
        expect(bound.exportedSha256, `installed/exported/served MapLibre ${asset} must match`).toBe(installedSha256);
        const requestedByPage = responses.some(observed => observed.path === bound.path && observed.observedSha256 === bound.observedSha256);
        // MapLibre 6.15's worker is self-contained; its published shared sibling
        // is empty. Verify that sibling independently without inventing a load.
        if (requirement === "maplibre-required" && asset === "maplibre-gl-worker.mjs") expect(requestedByPage, "actual page must request the locally exported worker").toBe(true);
        return { ...bound, installedSha256, requestedByPage, verification: requestedByPage ? "page-response-and-independent-fetch" : "independent-fetch-only" };
      }));
      expect(responseErrors).toEqual([]);
      const png = await surface.screenshot({ animations: "disabled", caret: "hide", scale: "css" }), dom = Buffer.from(await surface.evaluate(node => node.outerHTML));
      const bounds = await surface.boundingBox(), camera = renderer === "maplibre" ? await gl.getAttribute("data-map-camera-state") : null;
      await mkdir(directory, { recursive: true });
      const binding = { schemaVersion: "cplayout-gis-browser-evidence-v1", classification: "synthetic-browser-only", requirement, tuple, fixture,
        source: { scope: source.scope, fingerprint: source.sha256, lockSha256: source.lockSha256, manifest: "source.json" },
        runtime: { node: process.version, os: { platform: platform(), release: release(), arch: arch(), distribution: existsSync("/etc/os-release") ? readFileSync("/etc/os-release", "utf8") : null },
          playwright: installedVersion("@playwright/test"), axe: installedVersion("@axe-core/playwright"), maplibre: maplibrePackage.version,
          browser: page.context().browser()?.version() ?? null,
          browserRendering: await page.evaluate(() => { const fonts: { family: string; status: string }[] = []; document.fonts.forEach(font => fonts.push({ family: font.family, status: font.status }));
            return { userAgent: navigator.userAgent, dpr: devicePixelRatio, fonts }; }) },
        viewport: page.viewportSize(), renderer, camera: camera ? JSON.parse(camera) : null,
        mapReadout: await page.getByTestId("workspace-map-readout").innerText(), bounds,
        png: { path: `${name}.png`, sha256: hash(png), width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
        dom: { path: `${name}.html`, sha256: hash(dom) }, served: fetched, observed: responses, maplibreAssets, errors: [...errors], responseErrors: [...responseErrors], extra };
      await writeFile(resolve(directory, "source.json"), JSON.stringify(source));
      await writeFile(resolve(directory, `${name}.png`), png); await writeFile(resolve(directory, `${name}.html`), dom);
      await writeFile(resolve(directory, `${name}.json`), JSON.stringify(binding, null, 2) + "\n");
      await info.attach(`${name}-binding.json`, { body: JSON.stringify(binding), contentType: "application/json" });
      await info.attach(`${name}.png`, { body: png, contentType: "image/png" });
    },
    // Called by the test fixture after the runner has assigned the real status,
    // including failures before the first successful screenshot capture.
    async dispose() {
      page.off("pageerror", onPageError); page.off("response", onResponse); await Promise.all([...jobs]);
      await mkdir(directory, { recursive: true });
      const result = { schemaVersion: "cplayout-gis-execution-v1", classification: "synthetic-browser-only", requirement: caseRequirement,
        expectedTuple: { project: info.project.name, file: tuple.file, title: info.title }, executedTuple: tuple,
        expectedStatus: info.expectedStatus, actualStatus: info.status, durationMs: info.duration,
        source: { scope: source.scope, fingerprint: source.sha256, lockSha256: source.lockSha256, manifest: "source.json" },
        errors: info.errors.map(error => ({ message: error.message, stack: error.stack })), pageErrors: errors, responseErrors,
        configuredCases: [...GIS_PROOF_CASES, ...GIS_PACKAGE_PROOF_CASES].map(item => ({ title: item.title, rendererRequirement: item.renderer })),
        configuredProjects: info.config.projects.map(project => project.name) };
      await writeFile(resolve(directory, "source.json"), JSON.stringify(source));
      await writeFile(resolve(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
      await info.attach("gis-execution.json", { body: JSON.stringify(result), contentType: "application/json" });
    },
  };
}
