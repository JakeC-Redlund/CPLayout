import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import * as polygonClipping from "polygon-clipping";
import * as polyclip from "polyclip-ts";
import proj4 from "proj4";
import { generateTrajectory, verifyTrajectory, type ResearchInput, type SearchOptions, type XY } from "./core";

const hash = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
export function loadInput(path: string): unknown {
  const bytes = readFileSync(path); if (bytes.length > 2_000_000) throw new Error("Research input exceeds 2000000 bytes.");
  return JSON.parse(bytes.toString("utf8"));
}
export function sourceIdentity(inputPath?: string): Record<string, unknown> {
  const folder = resolve("tools/corner-arm-research");
  const files = readdirSync(folder).filter(f => f.endsWith(".ts")).sort();
  const sourceSha256 = Object.fromEntries(files.map(file => [file, hash(readFileSync(resolve(folder, file)))]));
  return { node: process.version, sourceSha256, ...(inputPath ? { inputSha256: hash(readFileSync(inputPath)) } : {}) };
}
function area(polygons: number[][][][] | null): number {
  return (polygons ?? []).reduce((sum, polygon) => sum + polygon.reduce((sumRing, ring, index) => {
    const twice = ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - p[1] * q[0]; }, 0);
    return sumRing + (index ? -1 : 1) * Math.abs(twice) / 2;
  }, 0), 0);
}
export function librarySanity(): Record<string, unknown> {
  const square: XY[][] = [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]];
  const offset: XY[][] = [[[2, 2], [6, 2], [6, 6], [2, 6], [2, 2]]];
  const hole: XY[][] = [[[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]];
  const concave: XY[][] = [[[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [0, 0]]];
  const runs = [
    { operation: "intersection", expectedArea: 4, polygonClipping: area(polygonClipping.intersection(square, offset)), polyclipTs: area(polyclip.intersection(square, offset)) },
    { operation: "union", expectedArea: 28, polygonClipping: area(polygonClipping.union(square, offset)), polyclipTs: area(polyclip.union(square, offset)) },
    { operation: "difference-hole", expectedArea: 12, polygonClipping: area(polygonClipping.difference(square, hole)), polyclipTs: area(polyclip.difference(square, hole)) },
    { operation: "concave-intersection", expectedArea: 7, polygonClipping: area(polygonClipping.intersection(square, concave)), polyclipTs: area(polyclip.intersection(square, concave)) },
  ].map(r => ({ ...r, pass: r.polygonClipping === r.expectedArea && r.polyclipTs === r.expectedArea }));
  const projected = proj4("EPSG:4326", "+proj=utm +zone=14 +datum=WGS84 +units=m +no_defs", [-99, 0]);
  const projection = { inputWgs84: [-99, 0], expectedXY: [500000, 0], actualXY: projected, pass: Math.abs(projected[0] - 500000) < 1e-7 && Math.abs(projected[1]) < 1e-7 };
  const require = createRequire(resolve("package.json"));
  const versions = Object.fromEntries(["polygon-clipping", "polyclip-ts", "proj4"].map(name => {
    // Some packages intentionally hide package.json through exports; walk from entry.
    const entry = require.resolve(name); let dir = resolve(entry, "..");
    for (let i = 0; i < 5; i++, dir = resolve(dir, "..")) {
      try { const p = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8")); if (p.name === name) return [name, p.version]; } catch { /* parent directory */ }
    }
    return [name, "version_not_resolved"];
  }));
  return { pass: runs.every(r => r.pass) && projection.pass, versions, polygons: runs, projection,
    limitation: "Known synthetic analytic checks only. Polygon libraries and proj4 are not used by the independent continuous-clearance core; library agreement is not ground truth." };
}
export function runBenchmark(): Record<string, unknown> {
  const folder = resolve("fixtures/corner-arm-research");
  const manifest = loadInput(resolve(folder, "manifest.json")) as Array<{ id: string; file: string; expected: string; purpose: string }>;
  const cases = manifest.map(entry => {
    const path = resolve(folder, entry.file), input = loadInput(path), start = performance.now(), result = verifyTrajectory(input);
    return { ...entry, actual: result.status, pass: result.status === entry.expected, durationMs: performance.now() - start,
      fixtureSha256: hash(readFileSync(path)), stats: result.stats, issues: result.issues };
  });
  const libraries = librarySanity();
  return { schemaVersion: "cplayout-corner-research-benchmark-v1", syntheticOnly: true, identity: sourceIdentity(),
    pass: cases.every(c => c.pass) && libraries.pass, cases, libraries, fixtureCount: cases.length,
    notEvaluated: ["Unreachable arbitrary guidance is not evaluated: no guide inversion resolver is implemented.", "No production app, vendor, device, control, or field proof is claimed."] };
}
export function runCli(argv: string[]): unknown {
  const [command, path, ...flags] = argv;
  if (command === "benchmark") return runBenchmark();
  if ((command !== "verify" && command !== "generate") || !path) throw new Error("Usage: tsx tools/corner-arm-research/cli.ts benchmark | verify INPUT.json | generate INPUT.json [--layers N --states N --max-transitions N]");
  const input = loadInput(path), identity = sourceIdentity(path);
  if (command === "verify") { if (flags.length) throw new Error("verify accepts only an input path."); return { ...verifyTrajectory(input), identity }; }
  const options: SearchOptions = {};
  for (let i = 0; i < flags.length; i += 2) {
    const key = ({ "--layers": "layers", "--states": "states", "--max-transitions": "maxTransitions", "--alpha-change-penalty": "alphaChangePenalty" } as const)[flags[i] as "--layers"];
    if (!key || flags[i + 1] === undefined) throw new Error(`Unknown or incomplete option ${flags[i]}.`);
    options[key] = Number(flags[i + 1]);
  }
  return { ...generateTrajectory(input as ResearchInput, options), identity };
}
if (process.argv[1] && /(?:^|[\\/])cli\.(?:ts|js)$/.test(process.argv[1])) {
  try {
    const result = runCli(process.argv.slice(2));
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (process.argv[2] === "benchmark" && (result as { pass?: boolean }).pass !== true) process.exitCode = 1;
  }
  catch (error) { process.stdout.write(JSON.stringify({ status: "missing_evidence", issues: [{ code: "cli_input_error", message: error instanceof Error ? error.message : String(error) }] }) + "\n"); process.exitCode = 2; }
}
