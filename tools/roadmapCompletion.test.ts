import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ANDROID_NATIVE_REQUIRED_ABSENT_TABLES,
  ANDROID_NATIVE_REQUIRED_MAP_PACKAGE_COLUMNS,
  ANDROID_NATIVE_REQUIRED_MIGRATIONS,
  ANDROID_NATIVE_REQUIRED_SQLITE_VERSION,
  createAndroidNativeVerificationReportTemplate,
} from "@cplayout/project-store";
import {
  findCompletedAndroidNativeReport,
  androidNativeGate,
  gnssRuntimeGate,
  nativeMapLibreGate,
  parseRoadmapArgs,
  runRoadmapCompletion,
  validateGnssRuntimeReport,
  validateGoogleEarthManifest,
  validateNativeMapLibreReport,
  validateRealPivotEvidencePacket,
} from "./roadmapCompletion";
import { analyzePngPixels, createNativeMapLibreProofTilePng } from "./pngMetrics";
import "./roadmapEvidenceQuality.test";

const parsed = parseRoadmapArgs(
  [
    "--fast",
    "--dry-run",
    "--output-dir",
    "reports/roadmap-completion/test",
    "--real-pivot-project-id",
    "fixture-project",
  ],
  {
    CPLAYOUT_REAL_PIVOT_FIXTURES: "fixtures/real-pivot/manifest.json",
    CPLAYOUT_REAL_PIVOT_PROJECT_CRS: "EPSG:32613",
  },
);

assert.equal(parsed.full, false);
assert.equal(parsed.profile, "fast");
assert.equal(parsed.dryRun, true);
assert.equal(parsed.outputDirectory, "reports/roadmap-completion/test");
assert.equal(parsed.realPivotFixturesPath, "fixtures/real-pivot/manifest.json");
assert.equal(parsed.realPivotProjectId, "fixture-project");
assert.equal(parsed.realPivotProjectCrs, "EPSG:32613");

const outputDirectory = "reports/roadmap-completion/test-dry-run";
rmSync(outputDirectory, { recursive: true, force: true });
const report = runRoadmapCompletion({
  full: false,
  dryRun: true,
  outputDirectory,
});

assert.equal(report.schemaVersion, "cplayout-roadmap-completion-v2");
assert.equal(report.profile, "fast");
assert.equal(report.status, "incomplete");
assert.ok(report.gates.every((gate) => gate.status === "not_run"));
assert.equal(existsSync(join(outputDirectory, "latest.json")), false);
assert.equal(existsSync(join(outputDirectory, "latest.md")), false);

const proofRoot = mkdtempSync(join(tmpdir(), "cplayout-roadmap-proof-"));
const androidReportDirectory = join(proofRoot, "android-native-verification");
mkdirSync(androidReportDirectory, { recursive: true });
const incompleteAndroidReport = createAndroidNativeVerificationReportTemplate({
  generatedAt: "2026-06-05T22:17:57.398Z",
  packageName: "local.centerpivot.layout",
  commit: "abcdef123456",
  adbSerial: "emulator-5554",
  model: "Pixel",
  androidVersion: "15",
  apiLevel: "35",
  versionName: "0.1.0",
  versionCode: "1",
  buildType: "development",
  packagePath: "package:/data/app/local.centerpivot.layout/base.apk",
  adbDeviceLine: "emulator-5554 device",
  logExcerptPath: "reports/android-native-verification/logcat.txt",
});
const completedAndroidReport = {
  ...incompleteAndroidReport,
  generatedAt: "2026-06-05T13:43:16.325Z",
  status: "pass" as const,
  sqlite: {
    schemaVersion: ANDROID_NATIVE_REQUIRED_SQLITE_VERSION,
    pragmaUserVersion: ANDROID_NATIVE_REQUIRED_SQLITE_VERSION,
    schemaMigrations: [...ANDROID_NATIVE_REQUIRED_MIGRATIONS],
    mapPackageColumns: [...ANDROID_NATIVE_REQUIRED_MAP_PACKAGE_COLUMNS],
    absentTables: [...ANDROID_NATIVE_REQUIRED_ABSENT_TABLES],
    geometryRowsPopulated: true,
  },
  projectRoundTrip: {
    backendLabel: "Expo SQLite",
    runtime: "native",
    sampleProjectSaved: true,
    relaunchCompleted: true,
    listAfterRelaunch: true,
    loadedProjectId: `cplayout-android-native-schema-v${ANDROID_NATIVE_REQUIRED_SQLITE_VERSION}-proof`,
    loadedProjectName: `CPLayout Android Native Schema v${ANDROID_NATIVE_REQUIRED_SQLITE_VERSION} Proof`,
    fieldBoundaryPointCount: 5,
    obstacleCount: 1,
    surveyPointCount: 1,
    settingsMatched: true,
    deleteConfirmed: true,
  },
  zipRoundTrip: {
    exportedFilename: "cplayout-android-native-proof.center-pivot.zip",
    exportedBytes: 4096,
    exportedSha256: "b".repeat(64),
    importedProjectId: `cplayout-android-native-schema-v${ANDROID_NATIVE_REQUIRED_SQLITE_VERSION}-proof`,
    manifestJsonPresent: true,
    projectJsonPresent: true,
    manifestProjectIdMatched: true,
    manifestProjectCrsMatched: true,
    savedImportedProject: true,
  },
  osFileUi: {
    shareSheetOpened: true,
    shareSheetEvidence: "Android share sheet displayed for proof ZIP export.",
    shareSheetScreenshotPath: "reports/android-native-verification/share-sheet.png",
    shareSheetXmlPath: "reports/android-native-verification/share-sheet.xml",
    documentsPickerOpened: true,
    documentsPickerEvidence: "Android DocumentsUI picker selected the pushed proof ZIP.",
    documentsPickerScreenshotPath: "reports/android-native-verification/documents-picker.png",
    documentsPickerXmlPath: "reports/android-native-verification/documents-picker.xml",
    pushedZipPath: "/sdcard/Download/cplayout-android-native-proof.center-pivot.zip",
    selectedZipFilename: "cplayout-android-native-proof.center-pivot.zip",
    selectedZipBytes: 4096,
  },
  checklist: Object.fromEntries(
    Object.keys(incompleteAndroidReport.checklist).map((key) => [
      key,
      {
        status: "pass",
        observedAt: "2026-06-05T13:43:16.325Z",
        evidence: `${key} verified on Android development build.`,
      },
    ]),
  ),
};
writeFileSync(join(androidReportDirectory, "android-native-verification-20260605-221757398Z.json"), JSON.stringify(incompleteAndroidReport), "utf8");
writeFileSync(join(androidReportDirectory, "android-native-verification-20260605-134316325Z.json"), JSON.stringify(completedAndroidReport), "utf8");
assert.equal(
  findCompletedAndroidNativeReport(androidReportDirectory)?.path,
  join(androidReportDirectory, "android-native-verification-20260605-134316325Z.json"),
);

const googleEarthManifestPath = join(proofRoot, "visual-fidelity-manifest.json");
const androidOptions = { full: false, dryRun: false, outputDirectory: proofRoot,
  androidReportPath: join(androidReportDirectory, "android-native-verification-20260605-134316325Z.json") };
assert.equal(androidNativeGate(androidOptions, "2026-09-13T00:00:00.000Z").status, "pass");
assert.equal(androidNativeGate(androidOptions, "2026-09-13T00:00:00.000Z", "abcdef123456").status, "blocked");
assert.equal(androidNativeGate(androidOptions, "2026-09-13T00:00:00.000Z", "abcdef123456-dirty").status, "fail");
assert.equal(androidNativeGate({ ...androidOptions, androidReportPath: undefined }, "2026-09-13T00:00:00.000Z", "abcdef123456").status, "blocked");
const googleEarthKml = "<kml xmlns=\"http://www.opengis.net/kml/2.2\"><Document /></kml>";
const googleEarthKmz = Buffer.from("PK\u0003\u0004fixture-kmz", "binary");
const pngFixture = createNativeMapLibreProofTilePng(120, 80);
const pngMetrics = analyzePngPixels(pngFixture);
writeFileSync(join(proofRoot, "fixture.kml"), googleEarthKml, "utf8");
writeFileSync(join(proofRoot, "fixture.kmz"), googleEarthKmz);
writeFileSync(join(proofRoot, "google-earth-visual-fidelity-map-canvas.png"), pngFixture);
writeFileSync(googleEarthManifestPath, JSON.stringify({
  schemaVersion: "cplayout-google-earth-visual-fidelity-proof-v1",
  commit: "abcdef123456",
  status: "passed",
  proofPassed: true,
  outputDir: proofRoot,
  googleEarth: {
    cleanup: {
      status: "force_closed",
      contaminated: false,
      postflightProcessRemaining: false,
    },
  },
  thresholds: {
    minimumNonBlackRatio: 0.08,
    minimumGrayVariance: 80,
  },
  artifacts: {
    kml: "fixture.kml",
    kmz: "fixture.kmz",
    sha256: {
      kml: createHash("sha256").update(googleEarthKml).digest("hex"),
      kmz: createHash("sha256").update(googleEarthKmz).digest("hex"),
    },
    kmlIntegrity: { passed: true },
  },
  captures: [{
    filename: "google-earth-visual-fidelity-map-canvas.png",
    label: "Google Earth Pro map-canvas crop",
    width: 120,
    height: 80,
    sha256: createHash("sha256").update(pngFixture).digest("hex"),
    analysis: {
      nonBlackRatio: pngMetrics.nonBlankPixelRatio,
      grayVariance: pngMetrics.grayVariance,
      mostlyBlack: false,
      nearUniform: false,
    },
  }],
  manualReview: {
    overlayVisibleConfirmed: true,
  },
}), "utf8");
assert.equal(validateGoogleEarthManifest(googleEarthManifestPath).ok, true);
assert.equal(validateGoogleEarthManifest(googleEarthManifestPath, "abcdef123456").ok, true);
assert.equal(validateGoogleEarthManifest(googleEarthManifestPath, "000000000000").ok, false);

const screenshotPath = join(proofRoot, "native-maplibre.png");
writeFileSync(screenshotPath, pngFixture);
const screenshotSha256 = createHash("sha256").update(pngFixture).digest("hex");
const nativeMapLibreLogcatPath = join(proofRoot, "native-maplibre-logcat.txt");
writeFileSync(nativeMapLibreLogcatPath, "MapLibre Native [INFO] [Mbgl-HttpRequest] local vector tile proof loaded\n", "utf8");
const nativeMapLibreLogcatSha256 = createHash("sha256").update("MapLibre Native [INFO] [Mbgl-HttpRequest] local vector tile proof loaded\n").digest("hex");
const nativeMapLibreReportPath = join(proofRoot, "native-maplibre-report.json");
writeFileSync(nativeMapLibreReportPath, JSON.stringify({
  reportSchemaVersion: 1,
  proofTarget: "native-maplibre-render",
  generatedAt: "2026-06-02T00:00:00.000Z",
  status: "pass",
  target: "native_maplibre_rn",
  device: {
    adbSerial: "emulator-5554",
    model: "Pixel",
    osVersion: "15",
    apiLevel: "35",
  },
  app: {
    packageName: "local.centerpivot.layout",
    versionName: "1.0",
    versionCode: "1",
    buildType: "development",
    commit: "abcdef123456",
  },
  tileSource: {
    tileSourceKind: "tilejson_or_template",
    tileContentType: "vector",
    sourceComponent: "VectorSource",
    tileJsonUrl: "http://127.0.0.1:8765/field/tilejson.json",
    tileUrlTemplates: ["http://127.0.0.1:8765/field/{z}/{x}/{y}.pbf"],
    sourceLayers: {
      roads: "roads",
      roadLabels: "road_labels",
      borders: "borders",
      places: "places",
    },
    attribution: "Local fixture",
  },
  screenshot: {
    path: "native-maplibre.png",
    sha256: screenshotSha256,
    width: pngMetrics.width,
    height: pngMetrics.height,
    nonBlankPixelRatio: pngMetrics.nonBlankPixelRatio,
    grayVariance: pngMetrics.grayVariance,
  },
  boundaries: {
    noRawPmtilesMbtilesNativeProof: true,
    canonicalGeometryMutation: false,
    networkRequired: false,
  },
  tileServer: {
    tileJsonRequests: 1,
    tileRequests: 4,
  },
  logcat: {
    path: "native-maplibre-logcat.txt",
    sha256: nativeMapLibreLogcatSha256,
    lineCount: 1,
    mapLibreLineCount: 1,
    mapLibreErrorLines: [],
    resourceUrlErrorCount: 0,
    resourceUrlErrorLines: [],
    clearedBeforeLaunch: true,
  },
}), "utf8");
assert.equal(validateNativeMapLibreReport(nativeMapLibreReportPath).ok, true);
assert.equal(validateNativeMapLibreReport(nativeMapLibreReportPath, "abcdef123456").ok, false);
assert.equal(validateNativeMapLibreReport(nativeMapLibreReportPath, "abcdef123456").blocked, true);
assert.equal(nativeMapLibreGate({ ...androidOptions, nativeMapLibreReportPath }, "abcdef123456").status, "blocked");
assert.equal(validateNativeMapLibreReport(nativeMapLibreReportPath, "000000000000").ok, false);

const gnssObservationEvidencePath = join(proofRoot, "gnss-observations.json");
const gnssControlEvidencePath = join(proofRoot, "gnss-controls.json");
const gnssArtifactContext = { projectId: "synthetic-project", projectCrs: "EPSG:32613", coordinateSpace: "projected_xy", linearUnit: "meters", commit: "abcdef123456",
  verticalReference: { heightType: "ellipsoidal", datum: "synthetic-test-datum", referencePoint: "synthetic-test-mark" },
  comparisonFrame: { kind: "local_orthonormal_enu", linearUnit: "meters", referenceFrame: "synthetic-frame", realization: "synthetic-realization",
    coordinateEpoch: "2026-08-09T00:00:00.000Z", referencePoint: "synthetic-test-mark",
    origin: { latitudeDegrees: 40, longitudeDegrees: -105, ellipsoidalHeightMeters: 1500 } } };
const gnssSourceHash = (kind: string, keys: string[], x: number, y: number, height: number) => {
  const v = gnssArtifactContext.verticalReference;
  return createHash("sha256").update(JSON.stringify(["cplayout-gnss-comparison-source-v1", kind,
    gnssArtifactContext.projectId, gnssArtifactContext.projectCrs, v.heightType, v.datum, v.referencePoint, ...keys, x, y, height])).digest("hex");
};
writeFileSync(gnssObservationEvidencePath, JSON.stringify({
  ...gnssArtifactContext, schemaVersion: "cplayout-gnss-observation-summary-v1",
  observations: [0, 1].map((i) => ({ id: `obs-${i}`, sessionId: "session-1", observedAt: "2026-08-09T00:01:00.000Z",
    projectedXY: { x: 500000 + i * 10 + (i + 1) / 100, y: 4400000 }, heightMeters: 0, fix: "rtk_fixed", observationAgeSeconds: 0.7, correctionAgeSeconds: 1.2,
    comparisonEnu: { eastMeters: i * 10 + (i + 1) / 100, northMeters: 0, upMeters: 0 },
    sourceSha256: gnssSourceHash("observation_summary", [`obs-${i}`, "session-1", "2026-08-09T00:01:00.000Z"], 500000 + i * 10 + (i + 1) / 100, 4400000, 0) })),
}), "utf8");
writeFileSync(gnssControlEvidencePath, JSON.stringify({
  ...gnssArtifactContext, schemaVersion: "cplayout-gnss-control-point-comparison-v1",
  observationSummarySha256: createHash("sha256").update(readFileSync(gnssObservationEvidencePath)).digest("hex"),
  comparisons: [0, 1].map((i) => ({ controlId: `control-${i}`, observationId: `obs-${i}`, sessionId: "session-1", referenceXY: { x: 500000 + i * 10, y: 4400000 }, referenceHeightMeters: 0,
    comparisonEnu: { eastMeters: i * 10, northMeters: 0, upMeters: 0 },
    sourceSha256: gnssSourceHash("control_point_comparison", [`control-${i}`, `obs-${i}`, "session-1"], 500000 + i * 10, 4400000, 0) })),
}), "utf8");
const gnssReportPath = join(proofRoot, "gnss-runtime-report.json");
writeFileSync(gnssReportPath, JSON.stringify({
  schemaVersion: "cplayout-gnss-runtime-proof-v1",
  evidenceContractVersion: "cplayout-gnss-derived-evidence-v1",
  projectId: "synthetic-project",
  verticalReference: gnssArtifactContext.verticalReference,
  comparisonFrame: gnssArtifactContext.comparisonFrame,
  status: "pass",
  generatedAt: "2026-08-09T00:06:00.000Z",
  commit: "abcdef123456",
  platform: "web",
  projectCrs: "EPSG:32613",
  sourceCrs: "EPSG:4326",
  sourceCrsConfirmed: true,
  receiver: { manufacturer: "Fixture", model: "RTK-1", firmware: "1.0" },
  antenna: { model: "Fixture antenna", referencePoint: "ARP", heightMeters: 2 },
  corrections: {
    sourceType: "NTRIP",
    delivery: "receiver-managed",
    credentialMaterialStored: false,
    rawPayloadsStored: false,
  },
  capturePolicy: {
    canonicalCoordinates: "projected_xy",
    rawWgs84Canonical: false,
    operatorConfirmedWritesOnly: true,
  },
  acceptance: {
    maxHorizontalRmsMeters: 0.03,
    maxControlErrorMeters: 0.10,
    maxThreeDimensionalErrorMeters: 0.10,
    maxObservationAgeSeconds: 2,
    maxCorrectionAgeSeconds: 5,
  },
  results: {
    controlPointCount: 2,
    horizontalRmsMeters: Math.sqrt((0.01 ** 2 + 0.02 ** 2) / 2),
    maxControlErrorMeters: 0.02,
    threeDimensionalRmsMeters: Math.sqrt((0.01 ** 2 + 0.02 ** 2) / 2),
    maxThreeDimensionalErrorMeters: 0.02,
    verticalRmsMeters: 0,
    maxVerticalErrorMeters: 0,
    maxObservationAgeSeconds: 0.7,
    maxCorrectionAgeSeconds: 1.2,
    reconnectPassed: true,
    staleObservationGatePassed: true,
    disconnectedCaptureGatePassed: true,
    checksumFailureGatePassed: true,
  },
  sessions: [{
    id: "session-1",
    startedAt: "2026-08-09T00:00:00.000Z",
    endedAt: "2026-08-09T00:05:00.000Z",
    sampleCount: 2,
    rtkFixedSampleCount: 2,
  }],
  evidence: [
    {
      kind: "observation_summary",
      path: "gnss-observations.json",
      sha256: createHash("sha256").update(readFileSync(gnssObservationEvidencePath)).digest("hex"),
    },
    {
      kind: "control_point_comparison",
      path: "gnss-controls.json",
      sha256: createHash("sha256").update(readFileSync(gnssControlEvidencePath)).digest("hex"),
    },
  ],
}), "utf8");
assert.equal(validateGnssRuntimeReport(gnssReportPath).ok, true);
assert.equal(validateGnssRuntimeReport(gnssReportPath, "abcdef123456").ok, false);
assert.equal(validateGnssRuntimeReport(gnssReportPath, "abcdef123456").blocked, true);
assert.equal(gnssRuntimeGate({ ...androidOptions, gnssReportPath }, "abcdef123456").status, "blocked");
assert.equal(validateGnssRuntimeReport(gnssReportPath, "000000000000").ok, false);

const realPivotPacketPath = join(proofRoot, "real-pivot-v2-packet.json");
const realPivotPacket = realPivotEvidencePacketFixture();
writeFileSync(realPivotPacketPath, JSON.stringify(realPivotPacket), "utf8");
const realPivotValidation = validateRealPivotEvidencePacket(realPivotPacketPath);
assert.equal(realPivotValidation.ok, true);

const unsafeRealPivotPacketPath = join(proofRoot, "real-pivot-v2-unsafe-packet.json");
const unsafeRealPivotPacket = {
  ...realPivotPacket,
  cloudUrls: ["https://tiles.example.invalid/unsafe"],
};
writeFileSync(unsafeRealPivotPacketPath, JSON.stringify(unsafeRealPivotPacket), "utf8");
const unsafeRealPivotValidation = validateRealPivotEvidencePacket(unsafeRealPivotPacketPath);
assert.equal(unsafeRealPivotValidation.ok, false);
if (!unsafeRealPivotValidation.ok) {
  assert.equal(unsafeRealPivotValidation.blocked, true);
  assert.match(unsafeRealPivotValidation.reason, /strict cplayout-imagery-evidence-v2 validation/);
}

const missingTileServerReportPath = join(proofRoot, "native-maplibre-missing-tile-server-report.json");
const missingTileServerReport = JSON.parse(readFileSync(nativeMapLibreReportPath, "utf8")) as { tileServer?: unknown };
delete missingTileServerReport.tileServer;
writeFileSync(missingTileServerReportPath, JSON.stringify(missingTileServerReport), "utf8");
const missingTileServerValidation = validateNativeMapLibreReport(missingTileServerReportPath);
assert.equal(missingTileServerValidation.ok, false);
assert.match(missingTileServerValidation.errors.join("\n"), /tileServer\.tileRequests/);

const resourceUrlErrorReportPath = join(proofRoot, "native-maplibre-resource-url-error-report.json");
const resourceUrlErrorReport = JSON.parse(readFileSync(nativeMapLibreReportPath, "utf8")) as {
  logcat?: { mapLibreErrorLines?: string[]; resourceUrlErrorCount?: number; resourceUrlErrorLines?: string[] };
};
resourceUrlErrorReport.logcat = {
  ...resourceUrlErrorReport.logcat,
  mapLibreErrorLines: ["MapLibre Native [ERROR] [Mbgl-HttpRequest] [HTTP] Unable to parse resourceURL"],
  resourceUrlErrorCount: 1,
  resourceUrlErrorLines: ["MapLibre Native [ERROR] [Mbgl-HttpRequest] [HTTP] Unable to parse resourceURL"],
};
writeFileSync(resourceUrlErrorReportPath, JSON.stringify(resourceUrlErrorReport), "utf8");
const resourceUrlErrorValidation = validateNativeMapLibreReport(resourceUrlErrorReportPath);
assert.equal(resourceUrlErrorValidation.ok, false);
assert.match(resourceUrlErrorValidation.errors.join("\n"), /logcat\.resourceUrlErrorCount/);

console.log("roadmap completion automation tests passed");

function realPivotEvidencePacketFixture(): Record<string, unknown> {
  return {
    schemaVersion: "cplayout-imagery-evidence-v2",
    packetVersion: "cplayout-imagery-evidence-packet-v2",
    projectId: "fixture-project",
    projectCrs: "EPSG:32613",
    createdAt: "2026-06-06T00:00:00.000Z",
    calibrationStatus: "valid_projected_xy",
    canonicalGeometryMutation: false,
    networkRequired: false,
    hiddenKeysAllowed: false,
    keyedService: false,
    evidenceOnly: true,
    appImportable: false,
    writesProjectDatabase: false,
    paidServiceRequired: false,
    cloudUrls: [],
    telemetryUpload: false,
    bulkPublicTileCaching: false,
    localProvenance: {
      canonicalGeometryMutation: false,
      networkRequired: false,
      hiddenKeysAllowed: false,
      keyedService: false,
      evidenceOnly: true,
      appImportable: false,
      writesProjectDatabase: false,
      paidServiceRequired: false,
      cloudUrls: [],
      telemetryUpload: false,
      bulkPublicTileCaching: false,
    },
    sourceArtifactHashes: {
      mapCanvasCrop: {
        id: "mapCanvasCrop",
        type: "map_canvas_crop",
        path: "reports/real-pivot-fixtures/map-canvas.png",
        sha256: "a".repeat(64),
        expectedSha256: "a".repeat(64),
        byteLength: 4096,
        attributionId: "operator-local",
      },
    },
    visualEvidence: [{
      id: "map-canvas-visual",
      artifactId: "mapCanvasCrop",
      widthPixels: 800,
      heightPixels: 600,
      nonBlankPixelRatio: 0.4,
      grayVariance: 120,
      mostlyBlack: false,
      nearUniform: false,
      attributionId: "operator-local",
    }],
    attribution: [{
      id: "operator-local",
      providerName: "Operator supplied local evidence",
      attribution: "Operator supplied local imagery and truth labels.",
      licenseText: "Operator supplied local evidence for advisory review.",
      keyedService: false,
      offlineCopyAllowed: true,
    }],
    calibration: {
      projectId: "fixture-project",
      projectCrs: "EPSG:32613",
      method: "operator truth label",
      status: "valid_projected_xy",
    },
    truthLabels: {
      TRUE_PIVOT_CENTER: {
        label: "operator approved pivot center",
        projectedPoint: { x: 500000, y: 4410000 },
        calibrationStatus: "valid_projected_xy",
        operatorApproved: true,
      },
    },
    evidenceRecords: [{
      id: "fixture-evidence",
      projectId: "fixture-project",
      sourceKind: "model_output",
      createdAt: "2026-06-06T00:00:00.000Z",
      projectCrs: "EPSG:32613",
      summary: "Standalone companion evidence only.",
      reviewStatus: "unreviewed",
      metrics: {
        canonicalGeometryMutation: false,
        evidenceOnly: true,
        appImportable: false,
        writesProjectDatabase: false,
      },
    }],
    candidateReports: [{
      id: "fixture-project:companion:real-pivot",
      kind: "pivot_center",
      projectId: "fixture-project",
      createdAt: "2026-06-06T00:00:00.000Z",
      projectCrs: "EPSG:32613",
      calibrationStatus: "valid_projected_xy",
      confidence: 0.91,
      proposedGeometry: {
        projectCrs: "EPSG:32613",
        pivotCenter: { x: 500000, y: 4410000 },
      },
      artifactIds: ["mapCanvasCrop"],
      truthLabelIds: ["TRUE_PIVOT_CENTER"],
      evidenceOnly: true,
      appImportable: false,
      canonicalGeometryMutation: false,
      writesProjectDatabase: false,
      metadata: {
        scoreBreakdown: { operatorTruth: 1 },
        hardFailures: [],
      },
      warnings: [
        "Any future geometry change requires a separate CPLayout Files/Map projected-XY workflow and operator action.",
      ],
    }],
    operatorDecisionNotes: [],
    warnings: [
      "Companion evidence is read-only and cannot apply, import, or mutate CPLayout project geometry.",
    ],
    nonGoals: [
      "No automatic canonical projected XY mutation from imagery evidence.",
    ],
  };
}
