import assert from "node:assert/strict";
import test from "node:test";

import {
  ANDROID_NATIVE_REQUIRED_ABSENT_TABLES,
  ANDROID_NATIVE_REQUIRED_MAP_PACKAGE_COLUMNS,
  ANDROID_NATIVE_REQUIRED_MIGRATIONS,
  ANDROID_NATIVE_REQUIRED_SQLITE_VERSION,
  androidNativeVerificationCompletionErrors,
  androidNativeVerificationStatus,
  createAndroidNativeInProcessProof,
  createAndroidNativeVerificationReportTemplate,
  parseCompleteAndroidNativeVerificationReport,
  parseAndroidNativeVerificationReport,
} from "./nativeVerification";
import { SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from "./persistenceSchema";

const baseReport = createAndroidNativeVerificationReportTemplate({
  generatedAt: "2026-05-19T12:00:00.000Z",
  packageName: "local.centerpivot.layout",
  commit: "abc1234",
  adbSerial: "emulator-5554",
  model: "Pixel_8",
  androidVersion: "16",
  apiLevel: "36",
  versionName: "0.1.0",
  versionCode: "1",
  buildType: "debug-dev-build",
  packagePath: "package:/data/app/local.centerpivot.layout/base.apk",
  adbDeviceLine: "emulator-5554 device",
  logExcerptPath: "reports/android-native-verification/logcat.txt",
});

assert.equal(ANDROID_NATIVE_REQUIRED_SQLITE_VERSION, SQLITE_SCHEMA_VERSION);
assert.deepEqual(
  ANDROID_NATIVE_REQUIRED_MIGRATIONS,
  SQLITE_MIGRATIONS.map((migration) => migration.id),
);
assert.equal(baseReport.sqlite.schemaVersion, SQLITE_SCHEMA_VERSION);

assert.throws(
  () => parseCompleteAndroidNativeVerificationReport(baseReport),
  /status must be pass|checklist/,
);

const completed = {
  ...baseReport,
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
    loadedProjectId: "sample-burgundy-quarter-section",
    loadedProjectName: "North Quarter Concept Layout",
    fieldBoundaryPointCount: 6,
    obstacleCount: 2,
    surveyPointCount: 2,
    settingsMatched: true,
    deleteConfirmed: true,
  },
  zipRoundTrip: {
    exportedFilename: "center-pivot-sample.zip",
    exportedBytes: 2048,
    exportedSha256: "a".repeat(64),
    importedProjectId: "sample-burgundy-quarter-section",
    manifestJsonPresent: true,
    projectJsonPresent: true,
    manifestProjectIdMatched: true,
    manifestProjectCrsMatched: true,
    savedImportedProject: true,
  },
  osFileUi: {
    shareSheetOpened: true,
    shareSheetEvidence: "Android resolver/share sheet displayed for project ZIP export.",
    shareSheetScreenshotPath: "reports/android-native-verification/share-sheet.png",
    shareSheetXmlPath: "reports/android-native-verification/share-sheet.xml",
    documentsPickerOpened: true,
    documentsPickerEvidence: "Android DocumentsUI picker displayed and selected the pushed project ZIP.",
    documentsPickerScreenshotPath: "reports/android-native-verification/documents-picker.png",
    documentsPickerXmlPath: "reports/android-native-verification/documents-picker.xml",
    pushedZipPath: "/sdcard/Download/cplayout-android-native-proof.zip",
    selectedZipFilename: "cplayout-android-native-proof.zip",
    selectedZipBytes: 2048,
  },
  checklist: Object.fromEntries(
    Object.keys(baseReport.checklist).map((key) => [
      key,
      {
        status: "pass",
        observedAt: "2026-05-19T12:10:00.000Z",
        evidence: `${key} verified on Android emulator.`,
      },
    ]),
  ),
};

assert.equal(parseCompleteAndroidNativeVerificationReport(completed).status, "pass");

assert.throws(
  () => parseCompleteAndroidNativeVerificationReport({
    ...completed,
    executionScope: "single_process",
  }),
  /single.process/i,
  "A launch, current schema, in-process load and deletion cannot establish restart or install/upgrade proof.",
);

assert.throws(
  () => parseCompleteAndroidNativeVerificationReport({
    ...completed,
    zipRoundTrip: {
      ...completed.zipRoundTrip,
      exportedSha256: "",
    },
  }),
  /exportedSha256/,
);

assert.throws(
  () => parseCompleteAndroidNativeVerificationReport({
    ...completed,
    sqlite: {
      ...completed.sqlite,
      mapPackageColumns: ["tile_content_type"],
    },
  }),
  /tile_scheme/,
);

assert.throws(
  () => parseCompleteAndroidNativeVerificationReport({
    ...completed,
    sqlite: {
      ...completed.sqlite,
      mapPackageColumns: ANDROID_NATIVE_REQUIRED_MAP_PACKAGE_COLUMNS.filter((column) => column !== "imagery_provenance_json"),
    },
  }),
  /imagery_provenance_json/,
);

assert.throws(
  () => parseCompleteAndroidNativeVerificationReport({
    ...completed,
    sqlite: {
      ...completed.sqlite,
      absentTables: ANDROID_NATIVE_REQUIRED_ABSENT_TABLES.filter((tableName) => tableName !== "layout_evidence"),
    },
  }),
  /layout_evidence/,
);

assert.throws(
  () => parseCompleteAndroidNativeVerificationReport({
    ...completed,
    osFileUi: {
      ...completed.osFileUi,
      documentsPickerOpened: false,
    },
  }),
  /documentsPickerOpened/,
);

console.log("native verification tests passed");

test("a launch with no observations leaves all checks not run and cannot qualify an installation", () => {
  const proof = createAndroidNativeInProcessProof({ generatedAt: completed.generatedAt });
  assert.equal(proof.status, "incomplete");
  assert.equal(proof.error, undefined);
  assert.ok(Object.values(proof.checklist).every((check) => check.status === "not_run"));
  assert.equal(proof.projectRoundTrip.relaunchCompleted, false);
  assert.equal(proof.projectRoundTrip.listAfterRelaunch, false);
  assert.throws(() => parseCompleteAndroidNativeVerificationReport({ ...completed, ...proof }), /single.process/);
});

test("a current-version SQLite snapshot cannot identify a fresh install or a completed upgrade", () => {
  const proof = createAndroidNativeInProcessProof({ generatedAt: completed.generatedAt, sqlite: completed.sqlite });
  assert.equal(proof.status, "incomplete");
  assert.deepEqual(proof.sqlite, completed.sqlite);
  assert.equal(proof.checklist.migrationEvidence.status, "not_run");
  assert.equal(proof.checklist.cleanInstallOrUpgradePath.status, "not_run");
  assert.equal(proof.checklist.saveLoadDelete.status, "not_run");
  assert.equal(proof.checklist.zipExportImport.status, "not_run");
  assert.throws(() => parseCompleteAndroidNativeVerificationReport({ ...completed, ...proof }), /single.process/);
});

test("single-process CRUD/archive observations and a current database never establish restart or install history", () => {
  const before = JSON.stringify(completed);
  const proof = createAndroidNativeInProcessProof(completed);
  assert.equal(proof.executionScope, "single_process");
  assert.equal(proof.status, "incomplete");
  assert.equal(proof.error, undefined);
  assert.equal(proof.projectRoundTrip.relaunchCompleted, false);
  assert.equal(proof.projectRoundTrip.listAfterRelaunch, false);
  assert.equal(proof.projectRoundTrip.sampleProjectSaved, true);
  assert.equal(proof.projectRoundTrip.deleteConfirmed, true);
  assert.equal(proof.projectRoundTrip.loadedProjectId, completed.projectRoundTrip.loadedProjectId);
  assert.deepEqual(proof.sqlite, completed.sqlite);
  assert.deepEqual(proof.zipRoundTrip, completed.zipRoundTrip);
  assert.equal(proof.checklist.saveLoadDelete.status, "pass");
  assert.equal(proof.checklist.zipExportImport.status, "pass");
  assert.equal(proof.checklist.backendPanel.status, "not_run");
  assert.equal(proof.checklist.cleanInstallOrUpgradePath.status, "not_run");
  assert.equal(proof.checklist.migrationEvidence.status, "not_run");
  assert.equal(proof.checklist.cleanInstallOrUpgradePath.observedAt, "");
  assert.equal(proof.checklist.migrationEvidence.observedAt, "");
  assert.match(proof.checklist.migrationEvidence.evidence, /current SQLite snapshot/i);
  assert.match(proof.checklist.saveLoadDelete.evidence, /one process|no app restart/i);
  assert.equal(JSON.stringify(completed), before);

  const report = parseAndroidNativeVerificationReport({ ...completed, ...proof });
  const errors = androidNativeVerificationCompletionErrors(report);
  for (const label of ["single-process", "relaunchCompleted", "listAfterRelaunch", "cleanInstallOrUpgradePath", "migrationEvidence"]) {
    assert.ok(errors.some((error) => error.includes(label)), label);
  }
  assert.equal(androidNativeVerificationStatus(report), "incomplete");
  assert.throws(() => parseCompleteAndroidNativeVerificationReport(report), /single.process/);
  // Even all-pass checkboxes and top-level status cannot override known process scope.
  const relabeled = parseAndroidNativeVerificationReport({ ...completed, executionScope: proof.executionScope });
  assert.equal(androidNativeVerificationStatus(relabeled), "incomplete");
  assert.throws(() => parseCompleteAndroidNativeVerificationReport(relabeled), /single.process/);
});

for (const key of ["sampleProjectSaved", "settingsMatched", "deleteConfirmed"] as const) {
  test(`an observed ${key} failure stays failed while restart is unverified`, () => {
    const proof = createAndroidNativeInProcessProof({
      ...completed,
      projectRoundTrip: { ...completed.projectRoundTrip, [key]: false },
    });
    assert.equal(proof.status, "fail");
    assert.match(proof.error ?? "", new RegExp(key));
    assert.equal(proof.checklist.saveLoadDelete.status, "fail");
    assert.equal(proof.checklist.zipExportImport.status, "pass");
    assert.deepEqual(proof.sqlite, completed.sqlite);
    assert.equal(androidNativeVerificationStatus(parseAndroidNativeVerificationReport({ ...completed, ...proof })), "fail");
  });
}

for (const schemaChange of [
  { pragmaUserVersion: ANDROID_NATIVE_REQUIRED_SQLITE_VERSION - 1 },
  { schemaMigrations: [] },
  { mapPackageColumns: [] },
  { absentTables: [] },
  { geometryRowsPopulated: false },
]) {
  test(`current schema failure is retained: ${Object.keys(schemaChange)[0]}`, () => {
    const proof = createAndroidNativeInProcessProof({ ...completed, sqlite: { ...completed.sqlite, ...schemaChange } });
    assert.equal(proof.status, "fail");
    assert.equal(proof.checklist.migrationEvidence.status, "fail");
    assert.equal(proof.checklist.cleanInstallOrUpgradePath.status, "not_run");
    assert.equal(proof.checklist.saveLoadDelete.status, "pass");
    assert.deepEqual(proof.zipRoundTrip, completed.zipRoundTrip);
  });
}

for (const zipChange of [
  { manifestProjectCrsMatched: false }, { savedImportedProject: false },
  { exportedBytes: 0 }, { exportedSha256: "" },
]) {
  test(`archive failure does not erase SQLite or CRUD observations: ${Object.keys(zipChange)[0]}`, () => {
    const proof = createAndroidNativeInProcessProof({ ...completed, zipRoundTrip: { ...completed.zipRoundTrip, ...zipChange } });
    assert.equal(proof.status, "fail");
    assert.equal(proof.checklist.zipExportImport.status, "fail");
    assert.equal(proof.checklist.saveLoadDelete.status, "pass");
    assert.deepEqual(proof.sqlite, completed.sqlite);
    assert.equal(proof.projectRoundTrip.deleteConfirmed, true);
  });
}

test("failed and blocked reports retain their status despite missing restart evidence", () => {
  const proof = createAndroidNativeInProcessProof(completed);
  for (const status of ["fail", "blocked"] as const) {
    const report = parseAndroidNativeVerificationReport({ ...completed, ...proof, status });
    assert.equal(androidNativeVerificationStatus(report), status);
  }
  const failedCheck = parseAndroidNativeVerificationReport({
    ...completed, ...proof, status: "incomplete",
    checklist: { ...proof.checklist, zipExportImport: { ...proof.checklist.zipExportImport, status: "fail" } },
  });
  assert.equal(androidNativeVerificationStatus(failedCheck), "fail");
  assert.equal(androidNativeVerificationStatus(parseAndroidNativeVerificationReport(completed)), "pass");
});

test("assembled observations do not share mutable evidence arrays with their input", () => {
  const proof = createAndroidNativeInProcessProof(completed);
  proof.sqlite.schemaMigrations.length = 0;
  proof.sqlite.mapPackageColumns.length = 0;
  proof.sqlite.absentTables.length = 0;
  assert.deepEqual(completed.sqlite.schemaMigrations, ANDROID_NATIVE_REQUIRED_MIGRATIONS);
  assert.deepEqual(completed.sqlite.mapPackageColumns, ANDROID_NATIVE_REQUIRED_MAP_PACKAGE_COLUMNS);
  assert.deepEqual(completed.sqlite.absentTables, ANDROID_NATIVE_REQUIRED_ABSENT_TABLES);
});
