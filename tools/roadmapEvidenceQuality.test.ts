import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { analyzePngPixels, encodeRgbaPng } from "./pngMetrics";
import { validateGnssRuntimeReport, validateGoogleEarthManifest, validateNativeMapLibreReport } from "./roadmapCompletion";

const commit = "abcdef1234567890abcdef1234567890abcdef12";
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const pixels = new Uint8Array(32 * 24 * 4);
for (let i = 0; i < pixels.length; i += 4) {
  pixels.fill((i / 4) % 2 ? 220 : 40, i, i + 3);
  pixels[i + 3] = 255;
}
const png = encodeRgbaPng(32, 24, pixels);
const metrics = analyzePngPixels(png);
const transparentPixels = pixels.map((value, index) => index % 4 === 3 ? 0 : value);

function pngChunk(type: string, data: Uint8Array): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length); chunk.write(type, 4, "ascii"); chunk.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}

function filteredPng(filter: number): Buffer {
  const rowBytes = 32 * 4;
  const raw = Buffer.alloc((rowBytes + 1) * 24);
  for (let y = 0; y < 24; y += 1) {
    raw[y * (rowBytes + 1)] = filter;
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x < 4 ? 0 : pixels[y * rowBytes + x - 4];
      const up = y === 0 ? 0 : pixels[(y - 1) * rowBytes + x];
      const upperLeft = y === 0 || x < 4 ? 0 : pixels[(y - 1) * rowBytes + x - 4];
      const p = left + up - upperLeft;
      const nearest = [left, up, upperLeft].reduce((best, value) => Math.abs(p - value) < Math.abs(p - best) ? value : best);
      const predictor = [0, left, up, Math.floor((left + up) / 2), nearest][filter];
      raw[y * (rowBytes + 1) + 1 + x] = (pixels[y * rowBytes + x] - predictor + 256) & 255;
    }
  }
  return Buffer.concat([png.subarray(0, 33), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", new Uint8Array())]);
}

function sourceDigest(context: { projectId: string; projectCrs: string; verticalReference: { heightType: string; datum: string; referencePoint: string } },
  kind: string, keys: string[], point: { x: number; y: number }, height: number): string {
  const v = context.verticalReference;
  return sha256(JSON.stringify(["cplayout-gnss-comparison-source-v1", kind, context.projectId, context.projectCrs,
    v.heightType, v.datum, v.referencePoint, ...keys, point.x, point.y, height]));
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cplayout-evidence-quality-"));
  const put = (path: string, data: string | Uint8Array) => { writeFileSync(join(root, path), data); return sha256(data); };
  const json = (path: string, data: unknown) => put(path, JSON.stringify(data));
  const common = { projectId: "synthetic-project", projectCrs: "EPSG:32613", coordinateSpace: "projected_xy", linearUnit: "meters", commit };
  const verticalReference = { heightType: "ellipsoidal", datum: "synthetic-test-datum", referencePoint: "synthetic-test-mark" };
  const comparisonFrame = { kind: "local_orthonormal_enu", linearUnit: "meters", referenceFrame: "synthetic-frame",
    realization: "synthetic-realization", coordinateEpoch: "2026-09-13T00:00:00.000Z", referencePoint: verticalReference.referencePoint,
    origin: { latitudeDegrees: 40, longitudeDegrees: -105, ellipsoidalHeightMeters: 1500 } };
  const observations = {
    ...common, verticalReference: { ...verticalReference }, comparisonFrame: structuredClone(comparisonFrame), schemaVersion: "cplayout-gnss-observation-summary-v1",
    observations: [0, 1].map((i) => ({ id: `obs-${i}`, sessionId: "session-1", observedAt: `2026-09-13T00:00:0${i}.000Z`,
      projectedXY: { x: 500000 + i * 10 + (i + 1) / 100, y: 4400000 }, heightMeters: 0, fix: "rtk_fixed",
      comparisonEnu: { eastMeters: i * 10 + (i + 1) / 100, northMeters: 0, upMeters: 0 }, sourceSha256: "",
      observationAgeSeconds: 0.5, correctionAgeSeconds: 1 })),
  };
  const controls = { ...common, verticalReference: { ...verticalReference }, comparisonFrame: structuredClone(comparisonFrame),
    observationSummarySha256: "", schemaVersion: "cplayout-gnss-control-point-comparison-v1",
    comparisons: [0, 1].map((i) => ({ controlId: `control-${i}`, observationId: `obs-${i}`, sessionId: "session-1",
      referenceXY: { x: 500000 + i * 10, y: 4400000 }, referenceHeightMeters: 0,
      comparisonEnu: { eastMeters: i * 10, northMeters: 0, upMeters: 0 }, sourceSha256: "" })),
  };
  const refreshSources = () => {
    for (const o of observations.observations) o.sourceSha256 = sourceDigest(observations, "observation_summary", [o.id, o.sessionId, o.observedAt], o.projectedXY, o.heightMeters);
    for (const c of controls.comparisons) c.sourceSha256 = sourceDigest(controls, "control_point_comparison", [c.controlId, c.observationId, c.sessionId], c.referenceXY, c.referenceHeightMeters);
  };
  refreshSources();
  controls.observationSummarySha256 = json("observations.json", observations);
  const errors = observations.observations.map((obs, i) => Math.hypot(obs.comparisonEnu.eastMeters - controls.comparisons[i].comparisonEnu.eastMeters, obs.comparisonEnu.northMeters - controls.comparisons[i].comparisonEnu.northMeters));
  const gnss = {
    schemaVersion: "cplayout-gnss-runtime-proof-v1", evidenceContractVersion: "cplayout-gnss-derived-evidence-v1",
    status: "pass", generatedAt: "2026-09-13T00:02:00.000Z", commit, platform: "web", projectId: common.projectId, projectCrs: common.projectCrs,
    verticalReference: { ...verticalReference }, comparisonFrame: structuredClone(comparisonFrame),
    sourceCrs: "EPSG:4326", sourceCrsConfirmed: true,
    receiver: { manufacturer: "Synthetic", model: "fixture", firmware: "fixture" },
    antenna: { model: "Synthetic", referencePoint: "ARP", heightMeters: 2 },
    corrections: { sourceType: "fixture", delivery: "fixture", credentialMaterialStored: false, rawPayloadsStored: false },
    capturePolicy: { canonicalCoordinates: "projected_xy", rawWgs84Canonical: false, operatorConfirmedWritesOnly: true },
    acceptance: { maxHorizontalRmsMeters: 0.03, maxControlErrorMeters: 0.10, maxThreeDimensionalErrorMeters: 0.10, maxObservationAgeSeconds: 2, maxCorrectionAgeSeconds: 3 },
    results: { controlPointCount: 2, horizontalRmsMeters: Math.hypot(...errors) / Math.sqrt(errors.length), maxControlErrorMeters: Math.max(...errors),
      threeDimensionalRmsMeters: Math.hypot(...errors) / Math.sqrt(errors.length), maxThreeDimensionalErrorMeters: Math.max(...errors),
      verticalRmsMeters: 0, maxVerticalErrorMeters: 0,
      maxObservationAgeSeconds: 0.5, maxCorrectionAgeSeconds: 1, reconnectPassed: true, staleObservationGatePassed: true, disconnectedCaptureGatePassed: true, checksumFailureGatePassed: true },
    sessions: [{ id: "session-1", startedAt: "2026-09-13T00:00:00.000Z", endedAt: "2026-09-13T00:01:00.000Z", sampleCount: 2, rtkFixedSampleCount: 2 }],
    evidence: [{ kind: "observation_summary", path: "observations.json", sha256: json("observations.json", observations) },
      { kind: "control_point_comparison", path: "controls.json", sha256: json("controls.json", controls) }],
  };
  const ge = {
    schemaVersion: "cplayout-google-earth-visual-fidelity-proof-v1", commit, status: "passed", proofPassed: true, outputDir: root,
    googleEarth: { cleanup: { status: "closed_gracefully", contaminated: false, postflightProcessRemaining: false, requested: true, leaveOpen: false } },
    thresholds: { minimumNonBlackRatio: 0.08, minimumGrayVariance: 80 },
    artifacts: { kml: "fixture.kml", kmz: "fixture.kmz", sha256: { kml: put("fixture.kml", "<kml/>"), kmz: put("fixture.kmz", "fixture") }, kmlIntegrity: { passed: true } },
    captures: [{ filename: "map-canvas.png", width: metrics.width, height: metrics.height, sha256: put("map-canvas.png", png),
      analysis: { nonBlackRatio: metrics.nonBlankPixelRatio, grayVariance: metrics.grayVariance, mostlyBlack: false, nearUniform: false } }],
    manualReview: { overlayVisibleConfirmed: true },
  };
  const native = {
    reportSchemaVersion: 1, proofTarget: "native-maplibre-render", status: "pass", target: "native_maplibre_rn", generatedAt: gnss.generatedAt,
    device: { adbSerial: "synthetic", model: "synthetic", osVersion: "15", apiLevel: "35" },
    app: { packageName: "local.centerpivot.layout", buildType: "development", commit },
    tileSource: { tileSourceKind: "tilejson_or_template", tileContentType: "vector", sourceComponent: "VectorSource", tileJsonUrl: "http://127.0.0.1/tiles.json",
      sourceLayers: { roads: "roads", roadLabels: "road_labels", borders: "borders", places: "places" }, attribution: "synthetic" },
    screenshot: { path: "native.png", sha256: put("native.png", png), width: metrics.width, height: metrics.height, nonBlankPixelRatio: metrics.nonBlankPixelRatio, grayVariance: metrics.grayVariance },
    boundaries: { noRawPmtilesMbtilesNativeProof: true, canonicalGeometryMutation: false, networkRequired: false },
    tileServer: { tileRequests: 1, tileJsonRequests: 1 },
    logcat: { path: "logcat.txt", sha256: put("logcat.txt", "synthetic\n"), lineCount: 1, mapLibreLineCount: 0, mapLibreErrorLines: [], resourceUrlErrorCount: 0, resourceUrlErrorLines: [] },
  };
  return { root, put, json, gnss, observations, controls, ge, native,
    checkGnss(expected?: string) { json("gnss.json", gnss); return validateGnssRuntimeReport(join(root, "gnss.json"), expected); },
    checkGe(expected: string | undefined = commit) { json("ge.json", ge); return validateGoogleEarthManifest(join(root, "ge.json"), expected); },
    checkNative(expected?: string) { json("native.json", native); return validateNativeMapLibreReport(join(root, "native.json"), expected); },
    refreshGnss() {
      refreshSources();
      gnss.evidence[0].sha256 = json("observations.json", observations);
      controls.observationSummarySha256 = gnss.evidence[0].sha256;
      gnss.evidence[1].sha256 = json("controls.json", controls);
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
function scenario(name: string, check: (f: Fixture) => void) {
  test(name, () => { const f = fixture(); try { check(f); } finally { rmSync(f.root, { recursive: true, force: true }); } });
}
function rejected(result: { ok: boolean; errors: string[] }, reason: RegExp) {
  assert.equal(result.ok, false, `incorrect acceptance: ${result.errors.join("; ")}`);
  assert.match(result.errors.join("; "), reason);
}

scenario("positive: decoded synthetic PNGs and correlated GNSS artifacts", (f) => {
  assert.deepEqual(f.checkGe().errors, []); assert.equal(f.checkNative().ok, true); assert.deepEqual(f.checkGnss().errors, []);
});
for (const suffix of ["-dirty", "g", " ", "\n"]) scenario(`negative: commit suffix ${JSON.stringify(suffix)}`, (f) => {
  f.ge.commit = commit + suffix; rejected(f.checkGe(), /commit/);
});
scenario("positive: documented 12-hex abbreviation and uppercase", (f) => { f.ge.commit = commit.slice(0, 12).toUpperCase(); assert.equal(f.checkGe().ok, true); });
scenario("negative: shorter than 12 hex", (f) => { f.ge.commit = commit.slice(0, 11); rejected(f.checkGe(), /commit/); });
scenario("negative: invalid expected commit", (f) => { rejected(f.checkGe(commit + "-dirty"), /commit/); });
scenario("negative: native host commit cannot establish installed build identity", (f) => { rejected(f.checkNative(commit), /build.*identity|build.*linkage/i); });
scenario("negative: boolean build proof cannot unblock release", (f) => {
  Object.assign(f.native.app, { buildIdentityVerified: true, installedCommit: commit }); rejected(f.checkNative(commit), /build.*identity|build.*linkage/i);
});
for (const [name, data] of [
  ["9-byte signature", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])],
  ["truncated IEND", png.subarray(0, png.length - 6)],
  ["missing IEND", png.subarray(0, png.length - 12)],
  ["truncated IDAT", png.subarray(0, Math.floor(png.length / 2))],
  ["uniform opaque white", encodeRgbaPng(32, 24, new Uint8Array(pixels.length).fill(255))],
  ["black", encodeRgbaPng(32, 24, new Uint8Array(pixels.length))],
  ["transparent patterned", encodeRgbaPng(32, 24, transparentPixels)],
] as const) scenario(`negative: ${name} cannot support PNG evidence`, (f) => {
  f.ge.captures[0].sha256 = f.put("map-canvas.png", data);
  f.native.screenshot.sha256 = f.put("native.png", data);
  rejected(f.checkGe(), /PNG|pixel|blank|uniform|grayVariance/); rejected(f.checkNative(), /PNG|pixel|blank|uniform|grayVariance/);
});
scenario("negative: dimensions and metric claims must match pixels", (f) => {
  f.ge.captures[0].width += 1; f.native.screenshot.grayVariance += 500;
  rejected(f.checkGe(), /width/); rejected(f.checkNative(), /grayVariance/);
});
for (const state of [{}, { status: "invented", contaminated: false, postflightProcessRemaining: false },
  { status: ["force_closed"], contaminated: false, postflightProcessRemaining: false },
  { status: "force_closed" }, { status: "blocked", contaminated: false, postflightProcessRemaining: false },
  { status: "force_closed", contaminated: true, postflightProcessRemaining: false },
  { status: "force_closed", contaminated: false, postflightProcessRemaining: true },
  { status: "not_requested", contaminated: false, postflightProcessRemaining: false },
  { status: "skipped_leave_open", contaminated: false, postflightProcessRemaining: false },
]) scenario(`negative: nonaffirmative cleanup ${JSON.stringify(state)}`, (f) => {
  Object.assign(f.ge.googleEarth, { cleanup: state }); rejected(f.checkGe(), /cleanup|process/);
});
for (const status of ["closed_gracefully", "closed_after_modal_discard", "force_closed"]) scenario(`positive: cleanup ${status}`, (f) => {
  f.ge.googleEarth.cleanup.status = status; assert.equal(f.checkGe().ok, true);
});
scenario("positive: explicit leave-open manual review", (f) => {
  f.ge.googleEarth.cleanup.status = "skipped_leave_open"; f.ge.googleEarth.cleanup.leaveOpen = true;
  assert.equal(f.checkGe().ok, true);
});
scenario("negative: duplicate GNSS observation reference", (f) => { f.gnss.evidence[1] = { ...f.gnss.evidence[0] }; rejected(f.checkGnss(), /distinct|duplicate|control_point_comparison/); });
scenario("negative: control kind cannot relabel observations", (f) => {
  f.gnss.evidence[1] = { ...f.gnss.evidence[0], kind: "control_point_comparison" }; rejected(f.checkGnss(), /distinct|schemaVersion/);
});
scenario("negative: symlink aliases cannot supply distinct evidence", (f) => {
  symlinkSync(join(f.root, "observations.json"), join(f.root, "alias.json"));
  f.gnss.evidence[1] = { ...f.gnss.evidence[0], path: "alias.json", kind: "control_point_comparison" }; rejected(f.checkGnss(), /distinct/);
});
scenario("negative: hashed garbage is not typed evidence", (f) => {
  f.gnss.evidence[1].sha256 = f.put("controls.json", "this is not JSON"); rejected(f.checkGnss(), /JSON/);
});
scenario("negative: reported control RMS must be recomputed", (f) => { f.gnss.results.horizontalRmsMeters = 0.001; rejected(f.checkGnss(), /horizontalRmsMeters/); });
scenario("negative: reported control maximum must be recomputed", (f) => { f.gnss.results.maxControlErrorMeters = 0.001; rejected(f.checkGnss(), /maxControlErrorMeters/); });
scenario("negative: reported control count must be recomputed", (f) => { f.gnss.results.controlPointCount = 3; rejected(f.checkGnss(), /controlPointCount/); });
scenario("negative: out-of-tolerance controls cannot borrow passing metrics", (f) => {
  f.controls.comparisons[0].comparisonEnu.eastMeters += 1; f.refreshGnss(); rejected(f.checkGnss(), /horizontalRmsMeters|maxControlErrorMeters/);
});
scenario("negative: duplicate controls cannot increase count", (f) => { f.controls.comparisons[1] = { ...f.controls.comparisons[0] }; f.refreshGnss(); rejected(f.checkGnss(), /duplicate/); });
scenario("negative: unknown control observation", (f) => { f.controls.comparisons[0].observationId = "unknown"; f.refreshGnss(); rejected(f.checkGnss(), /observation/); });
scenario("negative: wrong control session", (f) => { f.controls.comparisons[0].sessionId = "wrong"; f.refreshGnss(); rejected(f.checkGnss(), /session/); });
scenario("negative: artifact project mismatch", (f) => { f.observations.projectId = "wrong"; f.refreshGnss(); rejected(f.checkGnss(), /projectId/); });
scenario("negative: artifact commit mismatch", (f) => { f.controls.commit = "0".repeat(40); f.refreshGnss(); rejected(f.checkGnss(), /commit/); });
scenario("negative: geographic project CRS", (f) => { f.gnss.projectCrs = "CRS:84"; rejected(f.checkGnss(), /projectCrs|projected/); });
scenario("negative: infinite derived coordinate", (f) => {
  f.gnss.evidence[0].sha256 = f.put("observations.json", JSON.stringify(f.observations).replace('"x":500000.01', '"x":1e999')); rejected(f.checkGnss(), /finite|number|projectedXY/);
});
scenario("negative: nonfinite antenna height", (f) => { f.gnss.antenna.heightMeters = Infinity; rejected(f.checkGnss(), /antenna/); });
scenario("negative: session counts must match observations", (f) => { f.gnss.sessions[0].sampleCount = 300; rejected(f.checkGnss(), /sampleCount/); });
scenario("negative: session time ordering", (f) => { f.gnss.sessions[0].endedAt = "2026-09-12T00:00:00.000Z"; rejected(f.checkGnss(), /session|endedAt/); });
scenario("negative: observation outside correlated session", (f) => { f.observations.observations[0].observedAt = "2026-09-12T00:00:00.000Z"; f.refreshGnss(); rejected(f.checkGnss(), /session|observedAt/); });
scenario("negative: raw fields rejected from derived artifact", (f) => { Object.assign(f.observations, { rawNmea: "synthetic-forbidden-field" }); f.refreshGnss(); rejected(f.checkGnss(), /Unrecognized|rawNmea/); });
scenario("negative: fresh report cannot mask stale observations", (f) => { f.observations.observations[0].observationAgeSeconds = 50; f.refreshGnss(); rejected(f.checkGnss(), /maxObservationAgeSeconds/); });
scenario("negative: unknown observation session", (f) => { f.observations.observations[0].sessionId = "unknown"; f.refreshGnss(); rejected(f.checkGnss(), /session/); });
scenario("negative: duplicate observation IDs", (f) => { f.observations.observations[1].id = "obs-0"; f.refreshGnss(); rejected(f.checkGnss(), /duplicate/); });
scenario("negative: derived coordinates cannot be latitude-longitude", (f) => {
  Object.assign(f.observations.observations[0].projectedXY, { longitude: -104, latitude: 40 }); f.refreshGnss(); rejected(f.checkGnss(), /Unrecognized/);
});
scenario("negative: controls require fixed observations", (f) => { f.observations.observations[0].fix = "rtk_float"; f.refreshGnss(); rejected(f.checkGnss(), /rtk_fixed/); });
scenario("negative: report and artifact contracts are versioned", (f) => { f.gnss.evidenceContractVersion = "unknown"; rejected(f.checkGnss(), /evidenceContractVersion/); });
scenario("negative: artifact hash must match content", (f) => { f.gnss.evidence[0].sha256 = "0".repeat(64); rejected(f.checkGnss(), /sha256/); });
scenario("negative: hardlink aliases cannot supply distinct evidence", (f) => {
  linkSync(join(f.root, "observations.json"), join(f.root, "alias.json"));
  f.gnss.evidence[1] = { ...f.gnss.evidence[0], kind: "control_point_comparison", path: "alias.json" }; rejected(f.checkGnss(), /distinct/);
});
for (const filter of [0, 1, 2, 3, 4]) scenario(`positive: opaque PNG filter ${filter}`, (f) => {
  const encoded = filteredPng(filter);
  assert.deepEqual(analyzePngPixels(encoded), metrics);
  f.ge.captures[0].sha256 = f.put("map-canvas.png", encoded); f.native.screenshot.sha256 = f.put("native.png", encoded);
  assert.equal(f.checkGe().ok, true); assert.equal(f.checkNative().ok, true);
});
scenario("negative: corrupted PNG CRC", (f) => {
  const corrupt = Buffer.from(png); corrupt[29] ^= 1;
  f.ge.captures[0].sha256 = f.put("map-canvas.png", corrupt); rejected(f.checkGe(), /CRC/);
});
scenario("negative: oversized inflated PNG payload", (f) => {
  const malformed = Buffer.concat([png.subarray(0, 33), pngChunk("IDAT", deflateSync(Buffer.alloc((32 * 4 + 1) * 24 + 1))), pngChunk("IEND", new Uint8Array())]);
  f.native.screenshot.sha256 = f.put("native.png", malformed); rejected(f.checkNative(), /PNG/);
});

for (const crs of ["EPSG:26741", "EPSG:26929", "EPSG:26913", "EPSG:3857", "EPSG:900913", "EPSG:32600", "EPSG:32761"]) {
  scenario(`QA negative: unreviewed GNSS meter CRS ${crs}`, (f) => {
    f.gnss.projectCrs = crs; f.observations.projectCrs = crs; f.controls.projectCrs = crs;
    f.refreshGnss(); rejected(f.checkGnss(), /projectCrs/);
  });
}
for (const crs of ["LOCAL", "LOCAL:reviewed-grid", "EPSG:32601", "EPSG:32660", "EPSG:32701", "EPSG:32760"]) {
  scenario(`QA positive: reviewed meter evidence CRS ${crs}`, (f) => {
    f.gnss.projectCrs = crs; f.observations.projectCrs = crs; f.controls.projectCrs = crs;
    f.refreshGnss(); assert.deepEqual(f.checkGnss().errors, []);
  });
}
scenario("QA negative: LOCAL evidence must declare meters", (f) => {
  f.gnss.projectCrs = "LOCAL"; f.observations.projectCrs = "LOCAL"; f.controls.projectCrs = "LOCAL";
  f.observations.linearUnit = "feet"; f.refreshGnss(); rejected(f.checkGnss(), /linearUnit/);
});

function pngForColorType(colorType: 0 | 2 | 6): Buffer {
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : 4;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(32); ihdr.writeUInt32BE(24, 4); ihdr[8] = 8; ihdr[9] = colorType;
  const rows = Buffer.alloc((32 * channels + 1) * 24);
  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        rows[y * (32 * channels + 1) + 1 + x * channels + channel] = channel === 3 ? 255 : x % 2 ? 220 : 40;
      }
    }
  }
  return Buffer.concat([png.subarray(0, 8), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(rows)), pngChunk("IEND", new Uint8Array())]);
}
function pngParts(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  return { head: buffer.subarray(0, 33), payload: buffer.subarray(41, 41 + buffer.readUInt32BE(33)), end: pngChunk("IEND", new Uint8Array()) };
}
for (const variant of ["unknown-critical", "duplicate-PLTE", "nonconsecutive-IDAT", "PLTE-after-IDAT", "PLTE-grayscale", "IHDR-not-first", "IEND-not-last"]) {
  scenario(`QA negative: PNG chunk contract ${variant}`, (f) => {
    const parts = pngParts(variant === "PLTE-grayscale" ? pngForColorType(0) : png);
    const idat = pngChunk("IDAT", parts.payload);
    const palette = pngChunk("PLTE", Buffer.from([40, 40, 40, 220, 220, 220]));
    const text = pngChunk("tEXt", Buffer.from("fixture\0synthetic"));
    const variants: Record<string, Buffer> = {
      "unknown-critical": Buffer.concat([parts.head, pngChunk("ABCD", Buffer.from([1])), idat, parts.end]),
      "duplicate-PLTE": Buffer.concat([parts.head, palette, palette, idat, parts.end]),
      "nonconsecutive-IDAT": Buffer.concat([parts.head, pngChunk("IDAT", parts.payload.subarray(0, 4)), text, pngChunk("IDAT", parts.payload.subarray(4)), parts.end]),
      "PLTE-after-IDAT": Buffer.concat([parts.head, idat, palette, parts.end]),
      "PLTE-grayscale": Buffer.concat([parts.head, palette, idat, parts.end]),
      "IHDR-not-first": Buffer.concat([parts.head.subarray(0, 8), text, parts.head.subarray(8), idat, parts.end]),
      "IEND-not-last": Buffer.concat([parts.head, idat, parts.end, text]),
    };
    f.ge.captures[0].sha256 = f.put("map-canvas.png", variants[variant]);
    f.native.screenshot.sha256 = f.put("native.png", variants[variant]);
    rejected(f.checkGe(), /PNG/); rejected(f.checkNative(), /PNG/);
  });
}
for (const colorType of [0, 2, 6] as const) scenario(`QA positive: opaque PNG color type ${colorType} with consecutive IDAT`, (f) => {
  const parts = pngParts(pngForColorType(colorType));
  const palette = colorType === 0 ? [] : [pngChunk("PLTE", Buffer.from([40, 40, 40, 220, 220, 220]))];
  const bytes = Buffer.concat([parts.head, ...palette,
    pngChunk("IDAT", parts.payload.subarray(0, 4)), pngChunk("IDAT", parts.payload.subarray(4)),
    pngChunk("tEXt", Buffer.from("fixture\0synthetic")), parts.end]);
  assert.deepEqual(analyzePngPixels(bytes), metrics);
  f.ge.captures[0].sha256 = f.put("map-canvas.png", bytes); f.native.screenshot.sha256 = f.put("native.png", bytes);
  assert.equal(f.checkGe().ok, true); assert.equal(f.checkNative().ok, true);
});
scenario("QA negative: noninteger native tileRequests", (f) => { f.native.tileServer.tileRequests = 0.5; rejected(f.checkNative(), /tileRequests/); });
scenario("QA negative: JSON exponent overflow native tileRequests", (f) => {
  f.put("native.json", JSON.stringify(f.native).replace('"tileRequests":1', '"tileRequests":1e999'));
  rejected(validateNativeMapLibreReport(join(f.root, "native.json")), /tileRequests/);
});
for (const generatedAt of ["garbage", "2026-02-30T00:00:00.000Z", "2026-09-13T24:00:00.000Z"]) {
  scenario(`QA negative: invalid native generatedAt ${generatedAt}`, (f) => { f.native.generatedAt = generatedAt; rejected(f.checkNative(), /generatedAt/); });
}
scenario("QA positive: native integer count and ISO date remain nonrelease only", (f) => {
  f.native.tileServer.tileRequests = 2; f.native.generatedAt = "2026-09-13T00:02:00Z";
  assert.equal(f.checkNative().ok, true); assert.equal(f.checkNative(commit).blocked, true); assert.equal(f.checkNative(commit).ok, false);
});
for (const field of ["generatedAt", "startedAt", "endedAt", "observedAt"] as const) {
  scenario(`QA negative: submillisecond GNSS ${field}`, (f) => {
    if (field === "generatedAt") f.gnss.generatedAt = "2026-09-13T00:02:00.0001Z";
    else if (field === "observedAt") f.observations.observations[0].observedAt = "2026-09-13T00:00:00.0001Z";
    else f.gnss.sessions[0][field] = field === "startedAt" ? "2026-09-13T00:00:00.0009Z" : "2026-09-13T00:01:00.0001Z";
    f.refreshGnss(); rejected(f.checkGnss(), /precision|fractional/);
  });
}
scenario("QA negative: GNSS submillisecond ordering cannot be rounded into range", (f) => {
  f.gnss.sessions[0].startedAt = "2026-09-13T00:00:00.0009Z";
  f.observations.observations[0].observedAt = "2026-09-13T00:00:00.0001Z";
  f.refreshGnss(); rejected(f.checkGnss(), /precision|fractional/);
});
for (const fraction of ["", ".1", ".12", ".123"]) scenario(`QA positive: GNSS timestamp precision ${fraction || "seconds"}`, (f) => {
  f.gnss.generatedAt = `2026-09-13T00:02:00${fraction}Z`;
  f.gnss.sessions[0].startedAt = `2026-09-13T00:00:00${fraction}Z`;
  f.gnss.sessions[0].endedAt = `2026-09-13T00:01:00${fraction}Z`;
  f.observations.observations[0].observedAt = `2026-09-13T00:00:00${fraction}Z`;
  f.refreshGnss(); assert.deepEqual(f.checkGnss().errors, []);
});

function verticalBoundaryFixture(f: Fixture, maximum: number): void {
  f.gnss.projectCrs = "LOCAL:synthetic-3d"; f.observations.projectCrs = f.gnss.projectCrs; f.controls.projectCrs = f.gnss.projectCrs;
  const observation = f.observations.observations[0];
  const control = f.controls.comparisons[0];
  f.observations.observations = Array.from({ length: 16 }, (_, i) => ({ ...observation,
    id: `boundary-observation-${i}`, projectedXY: { x: i, y: 0 }, heightMeters: i === 0 ? maximum : 0,
    comparisonEnu: { eastMeters: i, northMeters: 0, upMeters: i === 0 ? maximum : 0 } }));
  f.controls.comparisons = Array.from({ length: 16 }, (_, i) => ({ ...control,
    controlId: `boundary-control-${i}`, observationId: `boundary-observation-${i}`, referenceXY: { x: i, y: 0 }, referenceHeightMeters: 0,
    comparisonEnu: { eastMeters: i, northMeters: 0, upMeters: 0 } }));
  f.gnss.sessions[0].sampleCount = 16; f.gnss.sessions[0].rtkFixedSampleCount = 16;
  Object.assign(f.gnss.results, { controlPointCount: 16, horizontalRmsMeters: 0, maxControlErrorMeters: 0,
    threeDimensionalRmsMeters: maximum / 4, maxThreeDimensionalErrorMeters: maximum,
    verticalRmsMeters: maximum / 4, maxVerticalErrorMeters: maximum });
  f.refreshGnss();
}
scenario("3D negative: horizontal good plus vertical bad cannot pass", (f) => {
  verticalBoundaryFixture(f, 0.11); rejected(f.checkGnss(), /maxThreeDimensionalErrorMeters/);
});
scenario("3D negative: exact 0.10 meter maximum fails", (f) => {
  verticalBoundaryFixture(f, 0.10); rejected(f.checkGnss(), /strictly less/);
});
scenario("3D positive: below 0.10 meter maximum passes without weakening horizontal RMS", (f) => {
  verticalBoundaryFixture(f, 0.099); assert.equal(f.gnss.acceptance.maxHorizontalRmsMeters, 0.03); assert.deepEqual(f.checkGnss().errors, []);
});
scenario("3D negative: declared acceptance cannot relax owner maximum", (f) => {
  verticalBoundaryFixture(f, 0.20); f.gnss.acceptance.maxThreeDimensionalErrorMeters = 1;
  rejected(f.checkGnss(), /maxThreeDimensionalErrorMeters/);
});
scenario("3D negative: metric tolerance cannot admit an exact-threshold measurement", (f) => {
  verticalBoundaryFixture(f, 0.10); f.gnss.results.maxThreeDimensionalErrorMeters = 0.10 - 5e-10;
  rejected(f.checkGnss(), /recomputed.*strictly less/);
});
scenario("3D negative: stricter declared maximum remains exclusive", (f) => {
  verticalBoundaryFixture(f, 0.05); f.gnss.acceptance.maxThreeDimensionalErrorMeters = 0.05;
  rejected(f.checkGnss(), /strictly less/);
});
scenario("3D negative: exact horizontal maximum remains an additional check", (f) => {
  verticalBoundaryFixture(f, 0); f.observations.observations[0].projectedXY.x = 0.10;
  f.observations.observations[0].comparisonEnu.eastMeters = 0.10;
  Object.assign(f.gnss.results, { horizontalRmsMeters: 0.025, maxControlErrorMeters: 0.10,
    threeDimensionalRmsMeters: 0.025, maxThreeDimensionalErrorMeters: 0.10 });
  f.refreshGnss(); rejected(f.checkGnss(), /maxControlErrorMeters.*strictly less/);
});
scenario("3D positive: independently calculated 3D and vertical norms and RMS", (f) => {
  f.gnss.projectCrs = "LOCAL:synthetic-3d"; f.observations.projectCrs = f.gnss.projectCrs; f.controls.projectCrs = f.gnss.projectCrs;
  f.observations.observations[0].projectedXY = { x: 0.01, y: 0.02 }; f.observations.observations[0].heightMeters = 0.02;
  f.observations.observations[1].projectedXY = { x: 1.02, y: 0 }; f.observations.observations[1].heightMeters = -0.015;
  f.controls.comparisons[0].referenceXY = { x: 0, y: 0 }; f.controls.comparisons[1].referenceXY = { x: 1, y: 0 };
  f.observations.observations[0].comparisonEnu = { eastMeters: 0.01, northMeters: 0.02, upMeters: 0.02 };
  f.observations.observations[1].comparisonEnu = { eastMeters: 1.02, northMeters: 0, upMeters: -0.015 };
  f.controls.comparisons[0].comparisonEnu = { eastMeters: 0, northMeters: 0, upMeters: 0 };
  f.controls.comparisons[1].comparisonEnu = { eastMeters: 1, northMeters: 0, upMeters: 0 };
  Object.assign(f.gnss.results, { horizontalRmsMeters: Math.sqrt(0.00045), maxControlErrorMeters: Math.sqrt(0.0005),
    threeDimensionalRmsMeters: Math.sqrt((0.03 ** 2 + 0.025 ** 2) / 2), maxThreeDimensionalErrorMeters: 0.03,
    verticalRmsMeters: Math.sqrt((0.02 ** 2 + 0.015 ** 2) / 2), maxVerticalErrorMeters: 0.02 });
  f.refreshGnss(); assert.deepEqual(f.checkGnss().errors, []);
});
for (const field of ["threeDimensionalRmsMeters", "maxThreeDimensionalErrorMeters", "verticalRmsMeters", "maxVerticalErrorMeters"] as const) {
  scenario(`3D negative: false results.${field}`, (f) => {
    f.gnss.results[field] += 0.001; rejected(f.checkGnss(), new RegExp(field));
  });
  scenario(`3D negative: missing results.${field}`, (f) => {
    Reflect.deleteProperty(f.gnss.results, field); rejected(f.checkGnss(), new RegExp(field));
  });
}
scenario("3D negative: false control count", (f) => { verticalBoundaryFixture(f, 0.09); f.gnss.results.controlPointCount = 17; rejected(f.checkGnss(), /controlPointCount/); });
for (const artifact of ["observations", "controls"] as const) {
  scenario(`3D negative: missing ${artifact} height`, (f) => {
    if (artifact === "observations") Reflect.deleteProperty(f.observations.observations[0], "heightMeters");
    else Reflect.deleteProperty(f.controls.comparisons[0], "referenceHeightMeters");
    f.refreshGnss(); rejected(f.checkGnss(), /heightMeters|referenceHeightMeters/);
  });
  scenario(`3D negative: nonfinite JSON ${artifact} height`, (f) => {
    const index = artifact === "observations" ? 0 : 1;
    const field = artifact === "observations" ? "heightMeters" : "referenceHeightMeters";
    const raw = JSON.stringify(f[artifact]).replace(`"${field}":0`, `"${field}":1e999`);
    f.gnss.evidence[index].sha256 = f.put(`${artifact}.json`, raw); rejected(f.checkGnss(), /heightMeters|referenceHeightMeters/);
  });
  for (const field of ["datum", "referencePoint", "heightType"] as const) scenario(`3D negative: ${artifact} verticalReference.${field} mismatch`, (f) => {
    f[artifact].verticalReference[field] = field === "heightType" ? "orthometric" : "different-synthetic-reference";
    f.refreshGnss(); rejected(f.checkGnss(), /verticalReference.*match/);
  });
}
for (const datum of ["", " ", "unknown", " synthetic-test-datum "]) scenario(`3D negative: unknown or untrimmed vertical datum ${JSON.stringify(datum)}`, (f) => {
  f.gnss.verticalReference.datum = datum; f.observations.verticalReference.datum = datum; f.controls.verticalReference.datum = datum;
  f.refreshGnss(); rejected(f.checkGnss(), /datum/);
});
scenario("3D negative: vertical reference objects are strict", (f) => {
  Object.assign(f.controls.verticalReference, { extraReference: "synthetic" }); f.refreshGnss(); rejected(f.checkGnss(), /Unrecognized/);
});
scenario("3D positive: matching orthometric references validate only the declared contract", (f) => {
  f.gnss.verticalReference.heightType = "orthometric"; f.observations.verticalReference.heightType = "orthometric"; f.controls.verticalReference.heightType = "orthometric";
  f.refreshGnss(); assert.deepEqual(f.checkGnss().errors, []);
});
scenario("3D negative: 2D-only packets are ineligible in every mode", (f) => {
  Reflect.deleteProperty(f.gnss, "verticalReference");
  for (const observation of f.observations.observations) Reflect.deleteProperty(observation, "heightMeters");
  for (const control of f.controls.comparisons) Reflect.deleteProperty(control, "referenceHeightMeters");
  f.refreshGnss(); rejected(f.checkGnss(), /verticalReference/);
  rejected(validateGnssRuntimeReport(join(f.root, "gnss.json"), commit), /verticalReference/);
});
scenario("3D positive: other acceptance comparisons remain inclusive", (f) => {
  f.gnss.acceptance.maxHorizontalRmsMeters = f.gnss.results.horizontalRmsMeters;
  f.gnss.acceptance.maxObservationAgeSeconds = f.gnss.results.maxObservationAgeSeconds;
  f.gnss.acceptance.maxCorrectionAgeSeconds = f.gnss.results.maxCorrectionAgeSeconds;
  assert.deepEqual(f.checkGnss().errors, []);
});
scenario("3D negative: unfilled template never represents measured evidence", (f) => {
  const template = JSON.parse(readFileSync("docs/gnss-runtime-verification-report-template.json", "utf8"));
  assert.equal(template.status, "incomplete");
  assert.equal(template.acceptance.maxThreeDimensionalErrorMeters, 0.10);
  assert.equal(template.acceptance.maxControlErrorMeters, 0.10);
  assert.equal(template.acceptance.maxHorizontalRmsMeters, 0.03);
  assert.deepEqual(template.verticalReference, { heightType: "", datum: "", referencePoint: "" });
  assert.deepEqual(template.receiver, { manufacturer: "", model: "", firmware: "" });
  assert.equal(template.antenna.heightMeters, null);
  assert.equal(template.comparisonFrame.referenceFrame, "");
  assert.equal(template.comparisonFrame.coordinateEpoch, "");
  assert.deepEqual(template.comparisonFrame.origin, { latitudeDegrees: null, longitudeDegrees: null, ellipsoidalHeightMeters: null });
  const path = join(f.root, "template.json"); f.json("template.json", template);
  rejected(validateGnssRuntimeReport(path, commit), /verticalReference/);
});

scenario("ENU negative: grid XY plus heights is ineligible without comparison coordinates", (f) => {
  for (const value of [f.gnss, f.observations, f.controls]) Reflect.deleteProperty(value, "comparisonFrame");
  for (const row of [...f.observations.observations, ...f.controls.comparisons]) {
    Reflect.deleteProperty(row, "comparisonEnu"); Reflect.deleteProperty(row, "sourceSha256");
  }
  Reflect.deleteProperty(f.controls, "observationSummarySha256");
  f.gnss.evidence[0].sha256 = f.json("observations.json", f.observations);
  f.gnss.evidence[1].sha256 = f.json("controls.json", f.controls);
  rejected(f.checkGnss(), /comparisonFrame/);
});
scenario("ENU negative: even complete declared frame evidence cannot unblock release", (f) => {
  const result = f.checkGnss(commit); rejected(result, /comparison.frame.*derivation/i); assert.equal(result.blocked, true);
});
scenario("ENU negative: frame proof boolean cannot unblock release", (f) => {
  Object.assign(f.gnss, { comparisonFrameVerified: true, physicalAccuracyVerified: true });
  const result = f.checkGnss(commit); rejected(result, /comparison.frame.*derivation/i); assert.equal(result.blocked, true);
});
scenario("ENU positive: contract-only result explicitly blocks physical acceptance", (f) => {
  const result = f.checkGnss(); assert.equal(result.ok, true); assert.equal(result.blocked, false);
  assert.equal((result.details as { physicalAcceptance: { status: string } }).physicalAcceptance.status, "blocked");
});
scenario("ENU negative: invalid release evidence fails rather than becoming blocker-only", (f) => {
  f.gnss.results.controlPointCount = 3; const result = f.checkGnss(commit);
  rejected(result, /controlPointCount/); assert.equal(result.blocked, false);
});
scenario("ENU negative: invalid release commit still fails", (f) => {
  rejected(f.checkGnss(commit + "-dirty"), /commit/);
});
scenario("ENU positive: project grid and source heights are not substituted for ENU", (f) => {
  f.observations.observations[0].projectedXY.x += 10; f.observations.observations[0].heightMeters += 10;
  f.refreshGnss(); assert.deepEqual(f.checkGnss().errors, []);
  assert.equal(f.checkGnss(commit).blocked, true);
});
scenario("ENU negative: good grid error cannot hide bad ENU error", (f) => {
  f.observations.observations[0].comparisonEnu.upMeters = 0.11;
  f.refreshGnss(); rejected(f.checkGnss(), /recomputed.*maxThreeDimensionalErrorMeters/);
});
for (const artifact of ["observations", "controls"] as const) {
  for (const field of ["referenceFrame", "realization", "coordinateEpoch", "referencePoint"] as const) {
    scenario(`ENU negative: ${artifact} frame ${field} mismatch`, (f) => {
      f[artifact].comparisonFrame[field] = field === "coordinateEpoch" ? "2026-09-12T00:00:00.000Z" : "different-synthetic-reference";
      f.refreshGnss(); rejected(f.checkGnss(), /comparisonFrame.*match/);
    });
  }
  scenario(`ENU negative: ${artifact} origin mismatch`, (f) => {
    f[artifact].comparisonFrame.origin.ellipsoidalHeightMeters += 1;
    f.refreshGnss(); rejected(f.checkGnss(), /comparisonFrame.*match/);
  });
  scenario(`ENU negative: ${artifact} missing comparison coordinates`, (f) => {
    const row = artifact === "observations" ? f.observations.observations[0] : f.controls.comparisons[0];
    Reflect.deleteProperty(row, "comparisonEnu"); f.refreshGnss(); rejected(f.checkGnss(), /comparisonEnu/);
  });
  for (const axis of ["eastMeters", "northMeters", "upMeters"] as const) {
    scenario(`ENU negative: ${artifact} nonfinite ${axis}`, (f) => {
      const raw = JSON.stringify(f[artifact]).replace(new RegExp(`"${axis}":[0-9.]+`), `"${axis}":1e999`);
      f.gnss.evidence[artifact === "observations" ? 0 : 1].sha256 = f.put(`${artifact}.json`, raw);
      rejected(f.checkGnss(), /comparisonEnu|finite|number/);
    });
  }
  scenario(`ENU negative: ${artifact} source hash must match retained row`, (f) => {
    const row = artifact === "observations" ? f.observations.observations[0] : f.controls.comparisons[0];
    row.sourceSha256 = "0".repeat(64);
    f.gnss.evidence[artifact === "observations" ? 0 : 1].sha256 = f.json(`${artifact}.json`, f[artifact]);
    rejected(f.checkGnss(), /sourceSha256/);
  });
}
scenario("ENU negative: controls must link the exact observation artifact", (f) => {
  f.controls.observationSummarySha256 = "0".repeat(64);
  f.gnss.evidence[1].sha256 = f.json("controls.json", f.controls); rejected(f.checkGnss(), /observationSummarySha256/);
});
scenario("ENU negative: unknown frame metadata fails", (f) => {
  for (const value of [f.gnss, f.observations, f.controls]) value.comparisonFrame.referenceFrame = "unknown";
  f.refreshGnss(); rejected(f.checkGnss(), /referenceFrame/);
});
scenario("ENU negative: non-ENU basis is not an eligible comparison frame", (f) => {
  for (const value of [f.gnss, f.observations, f.controls]) value.comparisonFrame.kind = "utm_grid_plus_height";
  f.refreshGnss(); rejected(f.checkGnss(), /comparisonFrame/);
});
scenario("ENU negative: frame point must match vertical reference", (f) => {
  for (const value of [f.gnss, f.observations, f.controls]) value.comparisonFrame.referencePoint = "different-synthetic-point";
  f.refreshGnss(); rejected(f.checkGnss(), /referencePoint/);
});
scenario("ENU negative: frame epoch cannot claim submillisecond precision", (f) => {
  f.gnss.comparisonFrame.coordinateEpoch = "2026-09-13T00:00:00.0001Z"; rejected(f.checkGnss(), /coordinateEpoch/);
});
scenario("ENU negative: origin must have valid geographic bounds", (f) => {
  f.gnss.comparisonFrame.origin.latitudeDegrees = 91; rejected(f.checkGnss(), /latitudeDegrees/);
});
scenario("ENU negative: origin ellipsoidal height cannot be missing", (f) => {
  Reflect.deleteProperty(f.gnss.comparisonFrame.origin, "ellipsoidalHeightMeters"); rejected(f.checkGnss(), /ellipsoidalHeightMeters/);
});
scenario("ENU negative: frame rejects unknown extra fields", (f) => {
  Object.assign(f.gnss.comparisonFrame, { verified: true }); rejected(f.checkGnss(), /Unrecognized/);
});
