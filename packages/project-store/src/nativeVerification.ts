import { z } from "zod";

import { SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from "./persistenceSchema";

export const ANDROID_NATIVE_REPORT_SCHEMA_VERSION = 1;
export const ANDROID_NATIVE_PROOF_TARGET = "android-native-runtime";
export const ANDROID_NATIVE_IN_APP_PROOF_LOG_MARKER = "CPLAYOUT_ANDROID_NATIVE_PROOF_REPORT";
export const ANDROID_NATIVE_REQUIRED_SQLITE_VERSION = SQLITE_SCHEMA_VERSION;
export const ANDROID_NATIVE_REQUIRED_MIGRATIONS = SQLITE_MIGRATIONS.map((migration) => migration.id);
export const ANDROID_NATIVE_REQUIRED_MAP_PACKAGE_COLUMNS = [
  "tile_content_type",
  "tile_scheme",
  "tilejson_url",
  "tile_url_templates_json",
  "vector_overlay_json",
  "imagery_provenance_json",
  "checksum_sha256",
  "install_status",
] as const;
export const ANDROID_NATIVE_REQUIRED_ABSENT_TABLES = [
  "layout_evidence",
  "model_recommendations",
  "layout_decisions",
] as const;

const ReportStatusSchema = z.enum(["pass", "fail", "blocked", "incomplete"]);
const CheckStatusSchema = z.enum(["pass", "fail", "blocked", "not_run"]);

const ChecklistEvidenceSchema = z.object({
  status: CheckStatusSchema,
  observedAt: z.string(),
  evidence: z.string(),
});

export const AndroidNativeVerificationReportSchema = z.object({
  reportSchemaVersion: z.literal(ANDROID_NATIVE_REPORT_SCHEMA_VERSION),
  proofTarget: z.literal(ANDROID_NATIVE_PROOF_TARGET),
  executionScope: z.literal("single_process").optional(),
  generatedAt: z.string(),
  status: ReportStatusSchema,
  device: z.object({
    adbSerial: z.string(),
    model: z.string(),
    androidVersion: z.string(),
    apiLevel: z.string(),
  }),
  app: z.object({
    packageName: z.string(),
    versionName: z.string(),
    versionCode: z.string(),
    buildType: z.string(),
    commit: z.string(),
    packagePath: z.string(),
  }),
  sqlite: z.object({
    schemaVersion: z.number().int(),
    pragmaUserVersion: z.number().int(),
    schemaMigrations: z.array(z.number().int()),
    mapPackageColumns: z.array(z.string()),
    absentTables: z.array(z.string()),
    geometryRowsPopulated: z.boolean(),
  }),
  projectRoundTrip: z.object({
    backendLabel: z.string(),
    runtime: z.string(),
    sampleProjectSaved: z.boolean(),
    relaunchCompleted: z.boolean(),
    listAfterRelaunch: z.boolean(),
    loadedProjectId: z.string(),
    loadedProjectName: z.string(),
    fieldBoundaryPointCount: z.number().int(),
    obstacleCount: z.number().int(),
    surveyPointCount: z.number().int(),
    settingsMatched: z.boolean(),
    deleteConfirmed: z.boolean(),
  }),
  zipRoundTrip: z.object({
    exportedFilename: z.string(),
    exportedBytes: z.number().int(),
    exportedSha256: z.string(),
    importedProjectId: z.string(),
    manifestJsonPresent: z.boolean(),
    projectJsonPresent: z.boolean(),
    manifestProjectIdMatched: z.boolean(),
    manifestProjectCrsMatched: z.boolean(),
    savedImportedProject: z.boolean(),
  }),
  osFileUi: z.object({
    shareSheetOpened: z.boolean(),
    shareSheetEvidence: z.string(),
    shareSheetScreenshotPath: z.string(),
    shareSheetXmlPath: z.string(),
    documentsPickerOpened: z.boolean(),
    documentsPickerEvidence: z.string(),
    documentsPickerScreenshotPath: z.string(),
    documentsPickerXmlPath: z.string(),
    pushedZipPath: z.string(),
    selectedZipFilename: z.string(),
    selectedZipBytes: z.number().int(),
  }),
  checklist: z.object({
    cleanInstallOrUpgradePath: ChecklistEvidenceSchema,
    backendPanel: ChecklistEvidenceSchema,
    saveLoadDelete: ChecklistEvidenceSchema,
    zipExportImport: ChecklistEvidenceSchema,
    migrationEvidence: ChecklistEvidenceSchema,
  }),
  evidence: z.object({
    checklistDocument: z.string(),
    adbDeviceLine: z.string(),
    logExcerptPath: z.string(),
    notes: z.string(),
  }),
});

export type AndroidNativeVerificationReport = z.infer<typeof AndroidNativeVerificationReportSchema>;
export type AndroidNativeVerificationReportStatus = z.infer<typeof ReportStatusSchema>;

export type AndroidNativeInProcessObservations = Pick<AndroidNativeVerificationReport, "generatedAt">
& Partial<Pick<AndroidNativeVerificationReport, "sqlite" | "zipRoundTrip">> & {
  projectRoundTrip?: Omit<AndroidNativeVerificationReport["projectRoundTrip"], "relaunchCompleted" | "listAfterRelaunch">;
};

export type AndroidNativeInProcessProof = Pick<
  AndroidNativeVerificationReport,
  "generatedAt" | "sqlite" | "projectRoundTrip" | "zipRoundTrip" | "checklist"
> & {
  executionScope: "single_process";
  status: "incomplete" | "fail";
  error?: string;
};

/** A current-process observation cannot establish a restart or a fresh/upgrade install history. */
export function createAndroidNativeInProcessProof(input: AndroidNativeInProcessObservations): AndroidNativeInProcessProof {
  const empty = createAndroidNativeVerificationReportTemplate({ generatedAt: input.generatedAt, packageName: "", commit: "" });
  const sqlite = input.sqlite ?? empty.sqlite;
  const projectRoundTrip = { ...(input.projectRoundTrip ?? empty.projectRoundTrip), relaunchCompleted: false, listAfterRelaunch: false };
  const zipRoundTrip = input.zipRoundTrip ?? empty.zipRoundTrip;
  const sqliteErrors = input.sqlite ? sqliteSnapshotErrors(sqlite) : [];
  const projectErrors = input.projectRoundTrip ? projectRoundTripErrors(projectRoundTrip, false) : [];
  const zipErrors = input.zipRoundTrip ? zipRoundTripErrors(zipRoundTrip) : [];
  const errors = [...sqliteErrors, ...projectErrors, ...zipErrors];
  const evidence = (
    status: AndroidNativeVerificationReport["checklist"]["backendPanel"]["status"],
    description: string,
  ): AndroidNativeVerificationReport["checklist"]["backendPanel"] => ({
    status,
    observedAt: status === "not_run" ? "" : input.generatedAt,
    evidence: description,
  });
  return {
    generatedAt: input.generatedAt,
    executionScope: "single_process",
    status: errors.length > 0 ? "fail" : "incomplete",
    ...(errors.length > 0 ? { error: `In-process native observations failed: ${errors.join("; ")}` } : {}),
    sqlite: { ...sqlite, schemaMigrations: [...sqlite.schemaMigrations], mapPackageColumns: [...sqlite.mapPackageColumns], absentTables: [...sqlite.absentTables] },
    projectRoundTrip,
    zipRoundTrip: { ...zipRoundTrip },
    checklist: {
      cleanInstallOrUpgradePath: evidence("not_run", "Fresh-install and upgrade paths were not exercised. Launching an installed app does not establish either path."),
      backendPanel: evidence("not_run", input.projectRoundTrip
        ? `Backend API reported ${projectRoundTrip.backendLabel}, runtime ${projectRoundTrip.runtime}. The backend panel UI was not inspected.`
        : "Backend API observations were not collected and the backend panel UI was not inspected."),
      saveLoadDelete: evidence(!input.projectRoundTrip ? "not_run" : projectErrors.length > 0 ? "fail" : "pass", !input.projectRoundTrip
        ? "Repository save/list/load/delete observations were not collected."
        : projectErrors.length > 0
        ? `In-process save/list/load/delete observations failed: ${projectErrors.join("; ")}`
        : "Saved, listed, loaded, checked settings, and deleted in one process. No app restart or post-restart load/list was observed."),
      zipExportImport: evidence(!input.zipRoundTrip ? "not_run" : zipErrors.length > 0 ? "fail" : "pass", !input.zipRoundTrip
        ? "Archive export/import observations were not collected."
        : zipErrors.length > 0
        ? `In-process archive observations failed: ${zipErrors.join("; ")}`
        : "Exported, imported, checked the archive manifest, and saved the imported project in one process. OS share-sheet and file-picker evidence is separate."),
      migrationEvidence: evidence(sqliteErrors.length > 0 ? "fail" : "not_run", !input.sqlite
        ? "The current SQLite snapshot and install/upgrade history were not collected."
        : sqliteErrors.length > 0
        ? `Current SQLite snapshot checks failed: ${sqliteErrors.join("; ")}. Install/upgrade history was not observed.`
        : `Current SQLite snapshot matches schema v${ANDROID_NATIVE_REQUIRED_SQLITE_VERSION}. No pre-upgrade baseline, migration execution history, or clean-install initialization was observed.`),
    },
  };
}

export function createAndroidNativeVerificationReportTemplate(input: {
  generatedAt: string;
  packageName: string;
  commit: string;
  status?: AndroidNativeVerificationReportStatus;
  adbSerial?: string;
  model?: string;
  androidVersion?: string;
  apiLevel?: string;
  versionName?: string;
  versionCode?: string;
  buildType?: string;
  packagePath?: string;
  adbDeviceLine?: string;
  logExcerptPath?: string;
  notes?: string;
}): AndroidNativeVerificationReport {
  return {
    reportSchemaVersion: ANDROID_NATIVE_REPORT_SCHEMA_VERSION,
    proofTarget: ANDROID_NATIVE_PROOF_TARGET,
    generatedAt: input.generatedAt,
    status: input.status ?? "incomplete",
    device: {
      adbSerial: input.adbSerial ?? "",
      model: input.model ?? "",
      androidVersion: input.androidVersion ?? "",
      apiLevel: input.apiLevel ?? "",
    },
    app: {
      packageName: input.packageName,
      versionName: input.versionName ?? "",
      versionCode: input.versionCode ?? "",
      buildType: input.buildType ?? "",
      commit: input.commit,
      packagePath: input.packagePath ?? "",
    },
    sqlite: {
      schemaVersion: ANDROID_NATIVE_REQUIRED_SQLITE_VERSION,
      pragmaUserVersion: 0,
      schemaMigrations: [],
      mapPackageColumns: [],
      absentTables: [],
      geometryRowsPopulated: false,
    },
    projectRoundTrip: {
      backendLabel: "",
      runtime: "",
      sampleProjectSaved: false,
      relaunchCompleted: false,
      listAfterRelaunch: false,
      loadedProjectId: "",
      loadedProjectName: "",
      fieldBoundaryPointCount: 0,
      obstacleCount: 0,
      surveyPointCount: 0,
      settingsMatched: false,
      deleteConfirmed: false,
    },
    zipRoundTrip: {
      exportedFilename: "",
      exportedBytes: 0,
      exportedSha256: "",
      importedProjectId: "",
      manifestJsonPresent: false,
      projectJsonPresent: false,
      manifestProjectIdMatched: false,
      manifestProjectCrsMatched: false,
      savedImportedProject: false,
    },
    osFileUi: {
      shareSheetOpened: false,
      shareSheetEvidence: "",
      shareSheetScreenshotPath: "",
      shareSheetXmlPath: "",
      documentsPickerOpened: false,
      documentsPickerEvidence: "",
      documentsPickerScreenshotPath: "",
      documentsPickerXmlPath: "",
      pushedZipPath: "",
      selectedZipFilename: "",
      selectedZipBytes: 0,
    },
    checklist: {
      cleanInstallOrUpgradePath: emptyChecklistEvidence(),
      backendPanel: emptyChecklistEvidence(),
      saveLoadDelete: emptyChecklistEvidence(),
      zipExportImport: emptyChecklistEvidence(),
      migrationEvidence: emptyChecklistEvidence(),
    },
    evidence: {
      checklistDocument: "docs/android-native-verification.md",
      adbDeviceLine: input.adbDeviceLine ?? "",
      logExcerptPath: input.logExcerptPath ?? "",
      notes: input.notes ?? "",
    },
  };
}

export function parseAndroidNativeVerificationReport(input: unknown): AndroidNativeVerificationReport {
  return AndroidNativeVerificationReportSchema.parse(input);
}

export function parseCompleteAndroidNativeVerificationReport(input: unknown): AndroidNativeVerificationReport {
  const report = parseAndroidNativeVerificationReport(input);
  const errors = androidNativeVerificationCompletionErrors(report);
  if (errors.length > 0) {
    throw new Error(`Android native verification evidence is incomplete: ${errors.join("; ")}`);
  }
  return report;
}

export function androidNativeVerificationStatus(report: AndroidNativeVerificationReport): AndroidNativeVerificationReportStatus {
  const checks = Object.values(report.checklist);
  if (report.status === "fail" || checks.some((check) => check.status === "fail")) return "fail";
  if (report.status === "blocked" || checks.some((check) => check.status === "blocked")) return "blocked";
  return androidNativeVerificationCompletionErrors(report).length === 0 ? "pass" : "incomplete";
}

export function androidNativeVerificationCompletionErrors(report: AndroidNativeVerificationReport): string[] {
  const errors: string[] = [];

  if (report.status !== "pass") errors.push("status must be pass");
  if (report.executionScope === "single_process") errors.push("single-process evidence cannot qualify restart or fresh-install/upgrade verification");
  for (const [label, value] of Object.entries({
    generatedAt: report.generatedAt,
    adbSerial: report.device.adbSerial,
    model: report.device.model,
    androidVersion: report.device.androidVersion,
    apiLevel: report.device.apiLevel,
    packageName: report.app.packageName,
    versionName: report.app.versionName,
    versionCode: report.app.versionCode,
    buildType: report.app.buildType,
    commit: report.app.commit,
    packagePath: report.app.packagePath,
    shareSheetEvidence: report.osFileUi.shareSheetEvidence,
    shareSheetScreenshotPath: report.osFileUi.shareSheetScreenshotPath,
    shareSheetXmlPath: report.osFileUi.shareSheetXmlPath,
    documentsPickerEvidence: report.osFileUi.documentsPickerEvidence,
    documentsPickerScreenshotPath: report.osFileUi.documentsPickerScreenshotPath,
    documentsPickerXmlPath: report.osFileUi.documentsPickerXmlPath,
    pushedZipPath: report.osFileUi.pushedZipPath,
    selectedZipFilename: report.osFileUi.selectedZipFilename,
    checklistDocument: report.evidence.checklistDocument,
    adbDeviceLine: report.evidence.adbDeviceLine,
    logExcerptPath: report.evidence.logExcerptPath,
  })) {
    if (value.trim().length === 0) errors.push(`${label} is required`);
  }

  errors.push(...sqliteSnapshotErrors(report.sqlite));
  errors.push(...projectRoundTripErrors(report.projectRoundTrip));
  errors.push(...zipRoundTripErrors(report.zipRoundTrip));

  if (!report.osFileUi.shareSheetOpened) errors.push("osFileUi.shareSheetOpened must be true");
  if (!report.osFileUi.documentsPickerOpened) errors.push("osFileUi.documentsPickerOpened must be true");
  if (report.osFileUi.selectedZipBytes <= 0) errors.push("osFileUi.selectedZipBytes must be greater than zero");

  for (const [label, check] of Object.entries(report.checklist)) {
    if (check.status !== "pass") errors.push(`checklist.${label}.status must be pass`);
    if (check.observedAt.trim().length === 0) errors.push(`checklist.${label}.observedAt is required`);
    if (check.evidence.trim().length === 0) errors.push(`checklist.${label}.evidence is required`);
  }

  return errors;
}

function sqliteSnapshotErrors(sqlite: AndroidNativeVerificationReport["sqlite"]): string[] {
  const errors: string[] = [];
  if (sqlite.schemaVersion !== ANDROID_NATIVE_REQUIRED_SQLITE_VERSION) {
    errors.push(`SQLite schemaVersion must be ${ANDROID_NATIVE_REQUIRED_SQLITE_VERSION}`);
  }
  if (sqlite.pragmaUserVersion !== ANDROID_NATIVE_REQUIRED_SQLITE_VERSION) {
    errors.push(`PRAGMA user_version must be ${ANDROID_NATIVE_REQUIRED_SQLITE_VERSION}`);
  }

  for (const migrationId of ANDROID_NATIVE_REQUIRED_MIGRATIONS) {
    if (!sqlite.schemaMigrations.includes(migrationId)) errors.push(`schema migration ${migrationId} is missing`);
  }
  for (const columnName of ANDROID_NATIVE_REQUIRED_MAP_PACKAGE_COLUMNS) {
    if (!sqlite.mapPackageColumns.includes(columnName)) errors.push(`map_packages.${columnName} evidence is missing`);
  }
  for (const tableName of ANDROID_NATIVE_REQUIRED_ABSENT_TABLES) {
    if (!sqlite.absentTables.includes(tableName)) errors.push(`retired table ${tableName} absence evidence is missing`);
  }
  if (!sqlite.geometryRowsPopulated) errors.push("geometry rows must be populated after save");
  return errors;
}

function projectRoundTripErrors(project: AndroidNativeVerificationReport["projectRoundTrip"], requireRelaunch = true): string[] {
  const errors: string[] = [];
  for (const label of ["backendLabel", "runtime", "loadedProjectId", "loadedProjectName"] as const) {
    if (!project[label].trim()) errors.push(`${label} is required`);
  }
  if (project.runtime !== "native") errors.push("runtime must be native");
  if (!/sqlite/i.test(project.backendLabel)) errors.push("backendLabel must identify SQLite");
  for (const [label, value] of Object.entries(project)) {
    if (!requireRelaunch && (label === "relaunchCompleted" || label === "listAfterRelaunch")) continue;
    if (typeof value === "boolean" && !value) errors.push(`projectRoundTrip.${label} must be true`);
  }
  if (!Number.isInteger(project.fieldBoundaryPointCount) || project.fieldBoundaryPointCount < 3) errors.push("fieldBoundaryPointCount must be an integer of at least 3");
  if (!Number.isInteger(project.obstacleCount) || project.obstacleCount < 0) errors.push("obstacleCount must be a nonnegative integer");
  if (!Number.isInteger(project.surveyPointCount) || project.surveyPointCount < 0) errors.push("surveyPointCount must be a nonnegative integer");
  return errors;
}

function zipRoundTripErrors(zip: AndroidNativeVerificationReport["zipRoundTrip"]): string[] {
  const errors: string[] = [];
  if (!zip.exportedFilename.trim()) errors.push("exportedFilename is required");
  if (!zip.importedProjectId.trim()) errors.push("importedProjectId is required");
  if (!Number.isInteger(zip.exportedBytes) || zip.exportedBytes <= 0) errors.push("exportedBytes must be a positive integer");
  if (!/^[a-fA-F0-9]{64}$/.test(zip.exportedSha256)) errors.push("exportedSha256 must be a SHA-256 hex digest");
  for (const [label, value] of Object.entries(zip)) {
    if (typeof value === "boolean" && !value) errors.push(`zipRoundTrip.${label} must be true`);
  }
  return errors;
}

function emptyChecklistEvidence(): AndroidNativeVerificationReport["checklist"]["backendPanel"] {
  return {
    status: "not_run",
    observedAt: "",
    evidence: "",
  };
}
