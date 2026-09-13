import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { inflateSync } from "node:zlib";

import { validateImageryEvidencePacket } from "@cplayout/core";
import { parseCompleteAndroidNativeVerificationReport, SQLITE_SCHEMA_VERSION } from "@cplayout/project-store";
import { z } from "zod";
import { analyzePngPixels, type PngPixelMetrics } from "./pngMetrics";
import {
  collectAndroidToolSnapshot,
  readExpoAndroidPackageName,
  reportFromSnapshot,
  timestampForFilename,
  writeJsonFile,
} from "./androidNativeProof";
import { DEFAULT_REAL_PIVOT_FIXTURE_MANIFEST_PATH, generateDefaultRealPivotFixtureManifest } from "./generateRealPivotFixtureManifest";

export type RoadmapGateStatus = "pass" | "fail" | "blocked" | "not_run";
export type RoadmapProfile = "fast" | "checkpoint" | "release";

export interface RoadmapCompletionOptions {
  full: boolean;
  profile?: RoadmapProfile;
  dryRun: boolean;
  outputDirectory: string;
  androidReportPath?: string;
  gnssReportPath?: string;
  googleEarthManifestPath?: string;
  nativeMapLibreReportPath?: string;
  realPivotFixturesPath?: string;
  realPivotProjectId?: string;
  realPivotProjectCrs?: string;
}

export interface RoadmapGateResult {
  id: string;
  label: string;
  status: RoadmapGateStatus;
  reason: string;
  command?: string;
  exitCode?: number | null;
  durationMs?: number;
  evidence?: string[];
  details?: unknown;
}

export interface RoadmapCompletionReport {
  schemaVersion: "cplayout-roadmap-completion-v2";
  generatedAt: string;
  commit: string;
  profile: RoadmapProfile;
  status: "pass" | "fail" | "blocked" | "incomplete";
  treeState: {
    clean: boolean | null;
  };
  gates: RoadmapGateResult[];
  ownerInputContract: {
    decisionRequired: false;
    resourceInputs: string[];
  };
}

const DEFAULT_OUTPUT_DIRECTORY = "reports/roadmap-completion";
const DEFAULT_ANDROID_NATIVE_REPORT_DIRECTORY = "reports/android-native-verification";
const DEFAULT_GOOGLE_EARTH_MANIFEST_PATH = "reports/google-earth-visual-fidelity/visual-fidelity-manifest.json";
const DEFAULT_NATIVE_MAPLIBRE_REPORT_PATH = "reports/native-maplibre/latest.json";
const DEFAULT_GNSS_RUNTIME_REPORT_PATH = "reports/gnss-runtime/latest.json";
const DEFAULT_REAL_PIVOT_FIXTURE_PATH = DEFAULT_REAL_PIVOT_FIXTURE_MANIFEST_PATH;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = parseRoadmapArgs(process.argv.slice(2), process.env);
  const report = runRoadmapCompletion(options);
  process.exit(report.status === "pass" ? 0 : report.status === "blocked" ? 2 : report.status === "incomplete" ? 3 : 1);
}

export function parseRoadmapArgs(
  rawArgs: string[],
  env: NodeJS.ProcessEnv = process.env,
): RoadmapCompletionOptions {
  const fast = hasFlag(rawArgs, "--fast");
  const release = hasFlag(rawArgs, "--release");
  const profile: RoadmapProfile = release ? "release" : fast ? "fast" : "checkpoint";
  return {
    full: profile !== "fast",
    profile,
    dryRun: hasFlag(rawArgs, "--dry-run"),
    outputDirectory: valueFor(rawArgs, "--output-dir") ?? env.CPLAYOUT_ROADMAP_REPORT_DIR ?? DEFAULT_OUTPUT_DIRECTORY,
    androidReportPath: valueFor(rawArgs, "--android-report") ?? env.CPLAYOUT_ANDROID_NATIVE_REPORT,
    gnssReportPath: valueFor(rawArgs, "--gnss-report")
      ?? env.CPLAYOUT_GNSS_RUNTIME_REPORT
      ?? (existsSync(DEFAULT_GNSS_RUNTIME_REPORT_PATH) ? DEFAULT_GNSS_RUNTIME_REPORT_PATH : undefined),
    googleEarthManifestPath: valueFor(rawArgs, "--google-earth-manifest") ?? env.CPLAYOUT_GOOGLE_EARTH_MANIFEST,
    nativeMapLibreReportPath: valueFor(rawArgs, "--native-maplibre-report")
      ?? env.CPLAYOUT_NATIVE_MAPLIBRE_REPORT
      ?? (existsSync(DEFAULT_NATIVE_MAPLIBRE_REPORT_PATH) ? DEFAULT_NATIVE_MAPLIBRE_REPORT_PATH : undefined),
    realPivotFixturesPath: valueFor(rawArgs, "--real-pivot-fixtures") ?? env.CPLAYOUT_REAL_PIVOT_FIXTURES,
    realPivotProjectId: valueFor(rawArgs, "--real-pivot-project-id") ?? env.CPLAYOUT_REAL_PIVOT_PROJECT_ID,
    realPivotProjectCrs: valueFor(rawArgs, "--real-pivot-project-crs") ?? env.CPLAYOUT_REAL_PIVOT_PROJECT_CRS,
  };
}

export function runRoadmapCompletion(options: RoadmapCompletionOptions): RoadmapCompletionReport {
  const generatedAt = new Date().toISOString();
  const gates: RoadmapGateResult[] = [];
  const profile = profileFor(options);
  const commit = currentGitCommit();

  console.log(`CPLayout roadmap completion run: ${profile} profile`);
  console.log("Automation policy: run eligible gates, report external proof blockers, do not ask for step-by-step decisions.");

  gates.push(worktreeGate(options));
  gates.push(commandGate("validate", "TypeScript and workspace tests", ["npm", "run", "validate"], options));
  gates.push(commandGate("validate-skills", "Skills, agents, hooks, and records", ["npm", "run", "validate:skills"], options));
  gates.push(commandGate("validate-design-guides", "Design-guide advisory records", ["npm", "run", "validate:design-guides"], options));
  gates.push(commandGate("ml-companion-tests", "Local ML companion tests", ["npm", "run", "test:ml-companion"], options));
  gates.push(commandGate("ml-cv-loop", "ML/CV loop ledger verification", ["npm", "run", "verify:ml-cv-loop"], options));
  gates.push(commandGate("whole-loop", "Whole-codebase loop ledger verification", ["npm", "run", "verify:whole-loop"], options));
  gates.push(commandGate("diff-check", "Whitespace diff check", ["git", "diff", "--check"], options));
  gates.push(commandGate("audit", "npm audit", ["npm", "audit"], options));
  gates.push(profile !== "fast"
    ? commandGate("web-proof", "Static web export and Playwright proof", ["npm", "run", "proof:web"], options)
    : notRunGate("web-proof", "Static web export and Playwright proof", "Fast profile skips browser proof; run the checkpoint or release profile to include it."));

  gates.push(androidNativeGate(options, generatedAt, profile === "release" ? commit : undefined));
  gates.push(gnssRuntimeGate(options, profile === "release" ? commit : undefined));
  gates.push(retiredReviewContractsGate(options));
  gates.push(googleEarthVisualFidelityGate(options, profile === "release" ? commit : undefined));
  gates.push(realPivotFixtureGate(options, generatedAt));
  gates.push(nativeMapLibreGate(options, profile === "release" ? commit : undefined));

  const treeGate = gates.find((gate) => gate.id === "git-worktree");
  const treeDetails = treeGate?.details as { clean?: unknown } | undefined;

  const report: RoadmapCompletionReport = {
    schemaVersion: "cplayout-roadmap-completion-v2",
    generatedAt,
    commit,
    profile,
    status: summarizeStatus(gates),
    treeState: {
      clean: typeof treeDetails?.clean === "boolean" ? treeDetails.clean : null,
    },
    gates,
    ownerInputContract: {
      decisionRequired: false,
      resourceInputs: [
        `Android native proof: keep a completed schema-v${SQLITE_SCHEMA_VERSION} report under ${DEFAULT_ANDROID_NATIVE_REPORT_DIRECTORY}, connect an adb device/emulator with local.centerpivot.layout installed, or provide --android-report / CPLAYOUT_ANDROID_NATIVE_REPORT.`,
        `GNSS/RTK field proof: provide a completed cplayout-gnss-runtime-proof-v1 report with --gnss-report / CPLAYOUT_GNSS_RUNTIME_REPORT. Release evidence must identify the receiver, antenna setup, correction path, controls, and current commit without credentials or raw correction payloads.`,
        `Google Earth proof: provide --google-earth-manifest / CPLAYOUT_GOOGLE_EARTH_MANIFEST when the default ${DEFAULT_GOOGLE_EARTH_MANIFEST_PATH} is not the target proof.`,
        `Real pivot proof: place a calibrated operator-approved fixture at ${DEFAULT_REAL_PIVOT_FIXTURE_PATH}, or provide --real-pivot-fixtures / CPLAYOUT_REAL_PIVOT_FIXTURES.`,
        "Native MapLibre proof: provide a completed native render report with --native-maplibre-report / CPLAYOUT_NATIVE_MAPLIBRE_REPORT after a device run.",
      ],
    },
  };

  if (!options.dryRun) {
    const reportPath = join(options.outputDirectory, `roadmap-completion-${timestampForFilename(generatedAt)}.json`);
    const latestPath = join(options.outputDirectory, "latest.json");
    writeJsonFile(reportPath, report);
    writeJsonFile(latestPath, report);
    writeMarkdownSummary(join(options.outputDirectory, "latest.md"), report);
    console.log(`Roadmap completion report written: ${reportPath}`);
    console.log(`Roadmap completion latest report: ${latestPath}`);
  } else {
    console.log("Dry run: no roadmap report files were written.");
  }
  console.log(`Roadmap completion status: ${report.status}`);
  for (const gate of gates) {
    console.log(`- ${gate.status.toUpperCase()} ${gate.id}: ${gate.reason}`);
  }

  return report;
}

function commandGate(
  id: string,
  label: string,
  command: string[],
  options: RoadmapCompletionOptions,
): RoadmapGateResult {
  const startedAt = Date.now();
  const commandText = command.map((part) => part.includes(" ") ? JSON.stringify(part) : part).join(" ");
  if (options.dryRun) {
    return {
      id,
      label,
      status: "not_run",
      reason: `Dry run: would run ${commandText}.`,
      command: commandText,
      durationMs: 0,
    };
  }

  const [binary, ...args] = command;
  if (!binary) {
    return {
      id,
      label,
      status: "fail",
      reason: "Command gate has no executable.",
      command: commandText,
      exitCode: null,
      durationMs: Date.now() - startedAt,
    };
  }
  const result = spawnSync(binary, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const durationMs = Date.now() - startedAt;
  if (result.status === 0) {
    return {
      id,
      label,
      status: "pass",
      reason: "Command completed successfully.",
      command: commandText,
      exitCode: result.status,
      durationMs,
    };
  }
  return {
    id,
    label,
    status: "fail",
    reason: `Command failed with exit code ${result.status ?? "unknown"}.`,
    command: commandText,
    exitCode: result.status,
    durationMs,
  };
}

function worktreeGate(options: RoadmapCompletionOptions): RoadmapGateResult {
  const command = "git status --short --branch";
  if (options.dryRun) {
    return {
      id: "git-worktree",
      label: "Worktree snapshot",
      status: "not_run",
      reason: `Dry run: would run ${command}.`,
      command,
      durationMs: 0,
    };
  }

  const startedAt = Date.now();
  const result = spawnSync("git", ["status", "--short", "--branch"], {
    encoding: "utf8",
  });
  const durationMs = Date.now() - startedAt;
  if (result.status !== 0) {
    return {
      id: "git-worktree",
      label: "Worktree snapshot",
      status: "fail",
      reason: `git status failed with exit code ${result.status ?? "unknown"}.`,
      command,
      exitCode: result.status,
      durationMs,
    };
  }

  const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const files = lines.slice(1);
  const trackedDirtyFiles = files.filter((line) => !line.startsWith("?? "));
  const untrackedFiles = files.filter((line) => line.startsWith("?? "));
  const clean = trackedDirtyFiles.length === 0 && untrackedFiles.length === 0;
  const release = profileFor(options) === "release";
  return {
    id: "git-worktree",
    label: "Worktree snapshot",
    status: release && !clean ? "blocked" : "pass",
    reason: clean
      ? "Worktree is clean."
      : release
        ? `Release profile requires a clean worktree; found ${trackedDirtyFiles.length} tracked dirty files and ${untrackedFiles.length} untracked files.`
        : `Checkpoint records ${trackedDirtyFiles.length} tracked dirty files and ${untrackedFiles.length} untracked files; this is a development snapshot, not release evidence.`,
    command,
    exitCode: result.status,
    durationMs,
    details: {
      clean,
      branch: lines[0] ?? "",
      trackedDirtyFiles,
      untrackedFiles,
    },
  };
}

export function androidNativeGate(
  options: RoadmapCompletionOptions,
  generatedAt: string,
  expectedCommit?: string,
): RoadmapGateResult {
  if (options.dryRun) {
    return notRunGate(
      "android-native-runtime",
      "Android SQLite, ZIP sharing, picker, and migration runtime proof",
      "Dry run: would discover a completed Android report, detect adb/device state, or validate --android-report.",
    );
  }

  if (options.androidReportPath) {
    try {
      const report = parseCompleteAndroidNativeVerificationReport(JSON.parse(readFileSync(options.androidReportPath, "utf8")));
      if (expectedCommit !== undefined && !commitMatches(report.app.commit, expectedCommit)) {
        return {
          id: "android-native-runtime",
          label: "Android SQLite, ZIP sharing, picker, and migration runtime proof",
          status: "fail",
          reason: `Android report commit ${report.app.commit} does not match release commit ${expectedCommit}.`,
          evidence: [options.androidReportPath],
        };
      }
      return {
        id: "android-native-runtime",
        label: "Android SQLite, ZIP sharing, picker, and migration runtime proof",
        status: expectedCommit !== undefined ? "blocked" : "pass",
        reason: expectedCommit !== undefined ? nativeBuildIdentityBlocker() : "Completed Android native verification report contract validated; installed build identity was not checked.",
        evidence: [options.androidReportPath],
      };
    } catch (error) {
      return {
        id: "android-native-runtime",
        label: "Android SQLite, ZIP sharing, picker, and migration runtime proof",
        status: "fail",
        reason: `Android report did not validate: ${error instanceof Error ? error.message : String(error)}`,
        evidence: [options.androidReportPath],
      };
    }
  }

  const discoveredReport = findCompletedAndroidNativeReport(DEFAULT_ANDROID_NATIVE_REPORT_DIRECTORY, expectedCommit);
  if (discoveredReport) {
    return {
      id: "android-native-runtime",
      label: "Android SQLite, ZIP sharing, picker, and migration runtime proof",
      status: expectedCommit !== undefined ? "blocked" : "pass",
      reason: expectedCommit !== undefined ? nativeBuildIdentityBlocker() : "Discovered completed Android native verification report contract validated; installed build identity was not checked.",
      evidence: [discoveredReport.path],
      details: {
        generatedAt: discoveredReport.generatedAt,
        autoDiscovered: true,
      },
    };
  }

  if (expectedCommit !== undefined) {
    return {
      id: "android-native-runtime",
      label: "Android SQLite, ZIP sharing, picker, and migration runtime proof",
      status: "blocked",
      reason: nativeBuildIdentityBlocker(),
    };
  }
  const packageName = readExpoAndroidPackageName();
  const snapshot = collectAndroidToolSnapshot({
    packageName,
    outputDirectory: DEFAULT_ANDROID_NATIVE_REPORT_DIRECTORY,
  });
  const templatePath = join(
    DEFAULT_ANDROID_NATIVE_REPORT_DIRECTORY,
    `android-native-verification-${timestampForFilename(generatedAt)}.json`,
  );
  writeJsonFile(templatePath, reportFromSnapshot(snapshot));
  if (snapshot.blocker) {
    return {
      id: "android-native-runtime",
      label: "Android SQLite, ZIP sharing, picker, and migration runtime proof",
      status: "blocked",
      reason: snapshot.blocker,
      evidence: [templatePath],
    };
  }
  return {
    id: "android-native-runtime",
    label: "Android SQLite, ZIP sharing, picker, and migration runtime proof",
    status: "blocked",
    reason: "Device and native build detected, but the runtime checklist report is not complete yet.",
    evidence: [templatePath],
  };
}

export function findCompletedAndroidNativeReport(
  directory = DEFAULT_ANDROID_NATIVE_REPORT_DIRECTORY,
  expectedCommit?: string,
): {
  path: string;
  generatedAt: string;
} | null {
  if (!existsSync(directory)) return null;
  const candidates = readdirSync(directory)
    .filter((filename) => /^android-native-verification-.+\.json$/u.test(filename))
    .map((filename) => join(directory, filename))
    .map((path) => {
      try {
        const report = parseCompleteAndroidNativeVerificationReport(JSON.parse(readFileSync(path, "utf8")));
        if (expectedCommit !== undefined && !commitMatches(report.app.commit, expectedCommit)) return null;
        return {
          path,
          generatedAt: report.generatedAt,
          mtimeMs: statSync(path).mtimeMs,
        };
      } catch {
        return null;
      }
    })
    .filter((candidate): candidate is { path: string; generatedAt: string; mtimeMs: number } => candidate !== null)
    .sort((left, right) => {
      const generatedDelta = Date.parse(right.generatedAt) - Date.parse(left.generatedAt);
      if (Number.isFinite(generatedDelta) && generatedDelta !== 0) return generatedDelta;
      return right.mtimeMs - left.mtimeMs;
    });

  return candidates.length > 0
    ? { path: candidates[0].path, generatedAt: candidates[0].generatedAt }
    : null;
}

export function gnssRuntimeGate(options: RoadmapCompletionOptions, expectedCommit?: string): RoadmapGateResult {
  if (options.dryRun) {
    return notRunGate(
      "gnss-rtk-field-runtime",
      "GNSS/RTK receiver, correction, and field-control proof",
      "Dry run: would validate --gnss-report when provided.",
    );
  }
  if (!options.gnssReportPath) {
    return {
      id: "gnss-rtk-field-runtime",
      label: "GNSS/RTK receiver, correction, and field-control proof",
      status: "blocked",
      reason: "No GNSS/RTK field report was provided. Parser and browser transport tests do not prove receiver, correction, antenna, reconnect, or field accuracy behavior.",
    };
  }
  if (!existsSync(options.gnssReportPath)) {
    return {
      id: "gnss-rtk-field-runtime",
      label: "GNSS/RTK receiver, correction, and field-control proof",
      status: "blocked",
      reason: `GNSS/RTK field report does not exist: ${options.gnssReportPath}`,
      evidence: [options.gnssReportPath],
    };
  }
  try {
    const validation = validateGnssRuntimeReport(options.gnssReportPath, expectedCommit);
    return {
      id: "gnss-rtk-field-runtime",
      label: "GNSS/RTK receiver, correction, and field-control proof",
      status: validation.ok ? "pass" : validation.blocked ? "blocked" : "fail",
      reason: validation.ok
        ? "GNSS/RTK declared ENU artifact contracts and recomputed statistics validate only; physical acceptance remains blocked on independently verified comparison-frame derivation."
        : `GNSS/RTK field report is incomplete: ${validation.errors.join("; ")}`,
      evidence: validation.evidence,
      details: validation.details,
    };
  } catch (error) {
    return {
      id: "gnss-rtk-field-runtime",
      label: "GNSS/RTK receiver, correction, and field-control proof",
      status: "fail",
      reason: `GNSS/RTK field report could not be read: ${error instanceof Error ? error.message : String(error)}`,
      evidence: [options.gnssReportPath],
    };
  }
}

export function validateGnssRuntimeReport(reportPath: string, expectedCommit?: string): {
  ok: boolean;
  blocked: boolean;
  errors: string[];
  evidence: string[];
  details: unknown;
} {
  const errors: string[] = [];
  const report = readJsonWithBom(reportPath) as {
    schemaVersion?: unknown;
    status?: unknown;
    generatedAt?: unknown;
    commit?: unknown;
    platform?: unknown;
    projectCrs?: unknown;
    verticalReference?: unknown;
    comparisonFrame?: unknown;
    sourceCrs?: unknown;
    sourceCrsConfirmed?: unknown;
    receiver?: { manufacturer?: unknown; model?: unknown; firmware?: unknown };
    antenna?: { model?: unknown; referencePoint?: unknown; heightMeters?: unknown };
    corrections?: { sourceType?: unknown; delivery?: unknown; credentialMaterialStored?: unknown; rawPayloadsStored?: unknown };
    capturePolicy?: { canonicalCoordinates?: unknown; rawWgs84Canonical?: unknown; operatorConfirmedWritesOnly?: unknown };
    acceptance?: {
      maxHorizontalRmsMeters?: unknown;
      maxControlErrorMeters?: unknown;
      maxThreeDimensionalErrorMeters?: unknown;
      maxObservationAgeSeconds?: unknown;
      maxCorrectionAgeSeconds?: unknown;
    };
    results?: {
      controlPointCount?: unknown;
      horizontalRmsMeters?: unknown;
      maxControlErrorMeters?: unknown;
      threeDimensionalRmsMeters?: unknown;
      maxThreeDimensionalErrorMeters?: unknown;
      verticalRmsMeters?: unknown;
      maxVerticalErrorMeters?: unknown;
      maxObservationAgeSeconds?: unknown;
      maxCorrectionAgeSeconds?: unknown;
      reconnectPassed?: unknown;
      staleObservationGatePassed?: unknown;
      disconnectedCaptureGatePassed?: unknown;
      checksumFailureGatePassed?: unknown;
    };
    sessions?: Array<{ sampleCount?: unknown; rtkFixedSampleCount?: unknown; startedAt?: unknown; endedAt?: unknown }>;
    evidence?: Array<{ path?: unknown; sha256?: unknown; kind?: unknown }>;
  };

  if (report.schemaVersion !== "cplayout-gnss-runtime-proof-v1") errors.push("schemaVersion mismatch");
  if (report.status !== "pass") errors.push("status must be pass");
  for (const [label, value] of Object.entries({
    generatedAt: report.generatedAt,
    commit: report.commit,
    platform: report.platform,
    projectCrs: report.projectCrs,
    receiverManufacturer: report.receiver?.manufacturer,
    receiverModel: report.receiver?.model,
    receiverFirmware: report.receiver?.firmware,
    antennaModel: report.antenna?.model,
    antennaReferencePoint: report.antenna?.referencePoint,
    correctionSourceType: report.corrections?.sourceType,
    correctionDelivery: report.corrections?.delivery,
  })) {
    if (typeof value !== "string" || value.trim().length === 0) errors.push(`${label} is required`);
  }
  if (expectedCommit !== undefined && (typeof report.commit !== "string" || !commitMatches(report.commit, expectedCommit))) {
    errors.push(`commit must match release commit ${expectedCommit}`);
  }
  if (typeof report.projectCrs !== "string" || !isGnssEvidenceMeterCrs(report.projectCrs)) {
    errors.push("projectCrs must use the reviewed GNSS meter evidence CRS subset");
  }
  if (report.sourceCrs !== "EPSG:4326" || report.sourceCrsConfirmed !== true) {
    errors.push("sourceCrs must be explicitly confirmed as EPSG:4326");
  }
  if (typeof report.antenna?.heightMeters !== "number" || !Number.isFinite(report.antenna.heightMeters) || report.antenna.heightMeters < 0) {
    errors.push("antenna.heightMeters must be a finite nonnegative number");
  }
  if (report.corrections?.credentialMaterialStored !== false) errors.push("correction credentials must not be stored");
  if (report.corrections?.rawPayloadsStored !== false) errors.push("raw correction payloads must not be stored");
  if (report.capturePolicy?.canonicalCoordinates !== "projected_xy") errors.push("canonicalCoordinates must be projected_xy");
  if (report.capturePolicy?.rawWgs84Canonical !== false) errors.push("rawWgs84Canonical must be false");
  if (report.capturePolicy?.operatorConfirmedWritesOnly !== true) errors.push("operatorConfirmedWritesOnly must be true");

  const acceptance = report.acceptance;
  const results = report.results;
  const positiveThresholds = {
    maxHorizontalRmsMeters: acceptance?.maxHorizontalRmsMeters,
    maxControlErrorMeters: acceptance?.maxControlErrorMeters,
    maxThreeDimensionalErrorMeters: acceptance?.maxThreeDimensionalErrorMeters,
    maxObservationAgeSeconds: acceptance?.maxObservationAgeSeconds,
    maxCorrectionAgeSeconds: acceptance?.maxCorrectionAgeSeconds,
  };
  for (const [label, value] of Object.entries(positiveThresholds)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) errors.push(`acceptance.${label} must be positive`);
  }
  if (typeof results?.controlPointCount !== "number" || !Number.isInteger(results.controlPointCount) || results.controlPointCount < 2) {
    errors.push("results.controlPointCount must be at least 2");
  }
  for (const [label, value] of Object.entries({
    horizontalRmsMeters: results?.horizontalRmsMeters,
    maxControlErrorMeters: results?.maxControlErrorMeters,
    threeDimensionalRmsMeters: results?.threeDimensionalRmsMeters,
    maxThreeDimensionalErrorMeters: results?.maxThreeDimensionalErrorMeters,
    verticalRmsMeters: results?.verticalRmsMeters,
    maxVerticalErrorMeters: results?.maxVerticalErrorMeters,
    maxObservationAgeSeconds: results?.maxObservationAgeSeconds,
    maxCorrectionAgeSeconds: results?.maxCorrectionAgeSeconds,
  })) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) errors.push(`results.${label} must be nonnegative`);
  }
  compareAtMost(errors, "horizontalRmsMeters", results?.horizontalRmsMeters, acceptance?.maxHorizontalRmsMeters);
  compareBelow(errors, "maxControlErrorMeters", results?.maxControlErrorMeters, acceptance?.maxControlErrorMeters);
  compareBelow(errors, "maxThreeDimensionalErrorMeters", results?.maxThreeDimensionalErrorMeters, acceptance?.maxThreeDimensionalErrorMeters);
  compareAtMost(errors, "maxObservationAgeSeconds", results?.maxObservationAgeSeconds, acceptance?.maxObservationAgeSeconds);
  compareAtMost(errors, "maxCorrectionAgeSeconds", results?.maxCorrectionAgeSeconds, acceptance?.maxCorrectionAgeSeconds);
  for (const [label, value] of Object.entries({
    reconnectPassed: results?.reconnectPassed,
    staleObservationGatePassed: results?.staleObservationGatePassed,
    disconnectedCaptureGatePassed: results?.disconnectedCaptureGatePassed,
    checksumFailureGatePassed: results?.checksumFailureGatePassed,
  })) {
    if (value !== true) errors.push(`results.${label} must be true`);
  }

  if (!Array.isArray(report.sessions) || report.sessions.length === 0) {
    errors.push("at least one receiver session is required");
  } else {
    for (const [index, session] of report.sessions.entries()) {
      if (!session || typeof session !== "object") { errors.push(`sessions[${index}] must be an object`); continue; }
      if (typeof session.startedAt !== "string" || session.startedAt.length === 0) errors.push(`sessions[${index}].startedAt is required`);
      if (typeof session.endedAt !== "string" || session.endedAt.length === 0) errors.push(`sessions[${index}].endedAt is required`);
      if (typeof session.sampleCount !== "number" || !Number.isInteger(session.sampleCount) || session.sampleCount <= 0) {
        errors.push(`sessions[${index}].sampleCount must be positive`);
      }
      if (typeof session.rtkFixedSampleCount !== "number" || !Number.isInteger(session.rtkFixedSampleCount) || session.rtkFixedSampleCount <= 0) {
        errors.push(`sessions[${index}].rtkFixedSampleCount must be positive`);
      } else if (typeof session.sampleCount === "number" && session.rtkFixedSampleCount > session.sampleCount) {
        errors.push(`sessions[${index}].rtkFixedSampleCount cannot exceed sampleCount`);
      }
    }
  }

  const evidence = [reportPath];
  validateGnssDerivedEvidence(report, reportPath, errors, evidence, expectedCommit);
  const blocked = expectedCommit !== undefined && errors.length === 0;
  const physicalBlocker = "GNSS comparison-frame derivation is not independently verified; physical/release acceptance is BLOCKED until verifiable frame/transformation evidence is supplied. Declared ENU coordinates and source hashes are not physical accuracy proof.";
  if (expectedCommit !== undefined) errors.push(physicalBlocker);

  return {
    ok: errors.length === 0,
    blocked,
    errors,
    evidence,
    details: {
      platform: report.platform,
      projectCrs: report.projectCrs,
      verticalReference: report.verticalReference,
      comparisonFrame: report.comparisonFrame,
      physicalAcceptance: { status: "blocked", reason: physicalBlocker },
      receiver: report.receiver,
      antenna: report.antenna,
      corrections: report.corrections,
      acceptance,
      results,
      sessionCount: report.sessions?.length ?? 0,
    },
  };
}

function isGnssEvidenceMeterCrs(crs: string): boolean {
  // Evidence-only allowlist. Legacy geometry CRS support is not a unit guarantee.
  return crs === "LOCAL" || /^LOCAL:\S+$/u.test(crs)
    || /^EPSG:32[67](?:0[1-9]|[1-5][0-9]|60)$/u.test(crs);
}

function validateGnssDerivedEvidence(
  input: unknown, reportPath: string, errors: string[], evidence: string[], expectedCommit?: string,
): void {
  const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
  const commit = z.string().regex(/^[a-fA-F0-9]{12,40}$/u);
  const finite = z.number().finite();
  const nonnegative = finite.nonnegative();
  const point = z.strictObject({ x: finite, y: finite });
  const enu = z.strictObject({ eastMeters: finite, northMeters: finite, upMeters: finite });
  const sha256 = z.string().regex(/^[a-fA-F0-9]{64}$/u);
  const timestamp = z.iso.datetime().refine((value) => !/\.\d{4}/u.test(value),
    "timestamp precision must be at most 3 fractional digits");
  const referenceText = z.string().min(1).refine((value) => value === value.trim()
    && !["unknown", "unspecified", "tbd", "n/a"].includes(value.toLowerCase()),
  "reference must be a known nonempty trimmed string");
  const verticalReference = z.strictObject({
    heightType: z.enum(["ellipsoidal", "orthometric"]), datum: referenceText, referencePoint: referenceText,
  });
  const comparisonFrame = z.strictObject({
    kind: z.literal("local_orthonormal_enu"), linearUnit: z.literal("meters"),
    referenceFrame: referenceText, realization: referenceText, coordinateEpoch: timestamp, referencePoint: referenceText,
    origin: z.strictObject({ latitudeDegrees: finite.min(-90).max(90), longitudeDegrees: finite.min(-180).max(180), ellipsoidalHeightMeters: finite }),
  });
  const sessionSchema = z.strictObject({
    id, startedAt: timestamp, endedAt: timestamp,
    sampleCount: z.number().int().positive(), rtkFixedSampleCount: z.number().int().nonnegative(),
  });
  const parsed = z.object({
    evidenceContractVersion: z.literal("cplayout-gnss-derived-evidence-v1"),
    projectId: id, projectCrs: z.string().refine(isGnssEvidenceMeterCrs, "reviewed GNSS meter evidence CRS required"),
    verticalReference, comparisonFrame,
    commit, generatedAt: timestamp, sessions: z.array(sessionSchema).min(1),
    acceptance: z.object({ maxControlErrorMeters: finite.positive().max(0.10), maxThreeDimensionalErrorMeters: finite.positive().max(0.10) }),
    results: z.object({ controlPointCount: z.number().int().min(2), horizontalRmsMeters: nonnegative,
      maxControlErrorMeters: nonnegative, threeDimensionalRmsMeters: nonnegative, maxThreeDimensionalErrorMeters: nonnegative,
      verticalRmsMeters: nonnegative, maxVerticalErrorMeters: nonnegative,
      maxObservationAgeSeconds: nonnegative, maxCorrectionAgeSeconds: nonnegative }),
    evidence: z.array(z.strictObject({ kind: z.enum(["observation_summary", "control_point_comparison"]),
      path: z.string().trim().min(1), sha256 })).length(2),
  }).safeParse(input);
  if (!parsed.success) {
    errors.push(...parsed.error.issues.map((issue) => `GNSS report ${issue.path.join(".")}: ${issue.message}`));
    return;
  }
  const report = parsed.data;
  if (report.comparisonFrame.referencePoint !== report.verticalReference.referencePoint) {
    errors.push("comparisonFrame.referencePoint must exactly match verticalReference.referencePoint");
  }
  const common = {
    projectId: id, projectCrs: z.string().refine(isGnssEvidenceMeterCrs, "reviewed GNSS meter evidence CRS required"), commit,
    verticalReference, comparisonFrame,
    coordinateSpace: z.literal("projected_xy"), linearUnit: z.literal("meters"),
  };
  const observationSchema = z.strictObject({
    ...common, schemaVersion: z.literal("cplayout-gnss-observation-summary-v1"),
    observations: z.array(z.strictObject({
      id, sessionId: id, observedAt: timestamp, projectedXY: point, heightMeters: finite,
      comparisonEnu: enu, sourceSha256: sha256,
      fix: z.enum(["rtk_fixed", "rtk_float", "autonomous", "differential"]),
      observationAgeSeconds: nonnegative, correctionAgeSeconds: nonnegative,
    })).min(1),
  });
  const controlSchema = z.strictObject({
    ...common, schemaVersion: z.literal("cplayout-gnss-control-point-comparison-v1"), observationSummarySha256: sha256,
    comparisons: z.array(z.strictObject({ controlId: id, observationId: id, sessionId: id,
      referenceXY: point, referenceHeightMeters: finite, comparisonEnu: enu, sourceSha256: sha256 })).min(2),
  });
  type Observations = z.infer<typeof observationSchema>;
  type Controls = z.infer<typeof controlSchema>;
  let observations: Observations | undefined;
  let controls: Controls | undefined;
  const kinds = new Set<string>();
  const files = new Set<string>();
  const hashes = new Set<string>();
  const fileIdentities = new Set<string>();
  for (const artifact of report.evidence) {
    if (kinds.has(artifact.kind)) errors.push(`duplicate evidence kind ${artifact.kind}; distinct observation_summary and control_point_comparison required`);
    kinds.add(artifact.kind);
    const path = resolve(dirname(reportPath), artifact.path);
    evidence.push(path);
    try {
      const realPath = realpathSync(path);
      const stat = statSync(realPath);
      if (!stat.isFile()) throw new Error("artifact is not a regular file");
      const identity = `${stat.dev}:${stat.ino}`;
      const bytes = readFileSync(realPath);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (files.has(realPath) || fileIdentities.has(identity) || hashes.has(hash)) errors.push("GNSS evidence artifacts must be distinct files and contents");
      files.add(realPath); fileIdentities.add(identity); hashes.add(hash);
      if (hash !== artifact.sha256.toLowerCase()) { errors.push(`${artifact.kind} sha256 does not match its file`); continue; }
      const value: unknown = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/u, ""));
      const result = artifact.kind === "observation_summary" ? observationSchema.safeParse(value) : controlSchema.safeParse(value);
      if (!result.success) {
        errors.push(...result.error.issues.map((issue) => `${artifact.kind} ${issue.path.join(".")}: ${issue.message}`));
        continue;
      }
      const data = result.data;
      if (data.projectId !== report.projectId) errors.push(`${artifact.kind} projectId must match report`);
      if (data.projectCrs !== report.projectCrs) errors.push(`${artifact.kind} projectCrs must match report`);
      for (const field of ["heightType", "datum", "referencePoint"] as const) {
        if (data.verticalReference[field] !== report.verticalReference[field]) errors.push(`${artifact.kind} verticalReference.${field} must exactly match report`);
      }
      if (!isDeepStrictEqual(data.comparisonFrame, report.comparisonFrame)) errors.push(`${artifact.kind} comparisonFrame must exactly match report`);
      if (!commitMatches(data.commit, report.commit) || (expectedCommit !== undefined && !commitMatches(data.commit, expectedCommit))) {
        errors.push(`${artifact.kind} commit must match report and release commit`);
      }
      if (data.schemaVersion === "cplayout-gnss-observation-summary-v1") observations = data;
      else controls = data;
    } catch {
      errors.push(`${artifact.kind} JSON artifact must be readable and valid JSON`);
    }
  }
  for (const kind of ["observation_summary", "control_point_comparison"]) {
    if (!kinds.has(kind)) errors.push(`required evidence kind ${kind} missing`);
  }
  if (!observations || !controls) return;
  if (controls.observationSummarySha256.toLowerCase() !== report.evidence.find((item) => item.kind === "observation_summary")?.sha256.toLowerCase()) {
    errors.push("control_point_comparison observationSummarySha256 must match the exact observation artifact");
  }
  // Hash the declared source tuple, not the ENU output. This binds records, not a verified transformation.
  const sourceHash = (kind: string, keys: string[], xy: z.infer<typeof point>, height: number): string => {
    const v = report.verticalReference;
    return createHash("sha256").update(JSON.stringify(["cplayout-gnss-comparison-source-v1", kind, report.projectId, report.projectCrs,
      v.heightType, v.datum, v.referencePoint, ...keys, xy.x, xy.y, height])).digest("hex");
  };

  const sessions = new Map<string, z.infer<typeof sessionSchema>>();
  for (const session of report.sessions) {
    if (sessions.has(session.id)) errors.push(`duplicate session id ${session.id}`);
    sessions.set(session.id, session);
    if (Date.parse(session.endedAt) < Date.parse(session.startedAt) || Date.parse(session.endedAt) > Date.parse(report.generatedAt)) {
      errors.push(`session ${session.id} endedAt must follow startedAt and precede generatedAt`);
    }
  }
  const byId = new Map<string, Observations["observations"][number]>();
  const counts = new Map<string, { total: number; fixed: number }>();
  let maxObservationAge = 0;
  let maxCorrectionAge = 0;
  for (const observation of observations.observations) {
    if (observation.sourceSha256.toLowerCase() !== sourceHash("observation_summary", [observation.id, observation.sessionId, observation.observedAt], observation.projectedXY, observation.heightMeters)) {
      errors.push(`observation ${observation.id} sourceSha256 must match its retained source row`);
    }
    if (byId.has(observation.id)) errors.push(`duplicate observation id ${observation.id}`);
    byId.set(observation.id, observation);
    const session = sessions.get(observation.sessionId);
    if (!session) errors.push(`observation ${observation.id} references unknown session`);
    else if (Date.parse(observation.observedAt) < Date.parse(session.startedAt) || Date.parse(observation.observedAt) > Date.parse(session.endedAt)) {
      errors.push(`observation ${observation.id} observedAt is outside its session`);
    }
    const count = counts.get(observation.sessionId) ?? { total: 0, fixed: 0 };
    count.total += 1; count.fixed += observation.fix === "rtk_fixed" ? 1 : 0;
    counts.set(observation.sessionId, count);
    maxObservationAge = Math.max(maxObservationAge, observation.observationAgeSeconds);
    maxCorrectionAge = Math.max(maxCorrectionAge, observation.correctionAgeSeconds);
  }
  for (const session of sessions.values()) {
    const count = counts.get(session.id);
    if (count?.total !== session.sampleCount) errors.push(`session ${session.id} sampleCount does not match observations`);
    if (count?.fixed !== session.rtkFixedSampleCount) errors.push(`session ${session.id} rtkFixedSampleCount does not match observations`);
  }
  compareRecomputed(errors, "maxObservationAgeSeconds", report.results.maxObservationAgeSeconds, maxObservationAge);
  compareRecomputed(errors, "maxCorrectionAgeSeconds", report.results.maxCorrectionAgeSeconds, maxCorrectionAge);
  const controlIds = new Set<string>();
  const usedObservations = new Set<string>();
  let squaredErrorSum = 0;
  let maxControlError = 0;
  let squaredVerticalErrorSum = 0;
  let maxVerticalError = 0;
  let squaredThreeDimensionalErrorSum = 0;
  let maxThreeDimensionalError = 0;
  for (const comparison of controls.comparisons) {
    if (comparison.sourceSha256.toLowerCase() !== sourceHash("control_point_comparison", [comparison.controlId, comparison.observationId, comparison.sessionId], comparison.referenceXY, comparison.referenceHeightMeters)) {
      errors.push(`control ${comparison.controlId} sourceSha256 must match its retained source row`);
    }
    if (controlIds.has(comparison.controlId) || usedObservations.has(comparison.observationId)) errors.push("duplicate control or control observation");
    controlIds.add(comparison.controlId); usedObservations.add(comparison.observationId);
    const observation = byId.get(comparison.observationId);
    if (!observation) { errors.push(`control ${comparison.controlId} references unknown observation`); continue; }
    if (comparison.sessionId !== observation.sessionId) errors.push(`control ${comparison.controlId} session does not match observation`);
    if (observation.fix !== "rtk_fixed") errors.push(`control ${comparison.controlId} observation must be rtk_fixed`);
    // Only declared orthonormal comparison coordinates enter these norms, never project grid XY plus height.
    const dx = observation.comparisonEnu.eastMeters - comparison.comparisonEnu.eastMeters;
    const dy = observation.comparisonEnu.northMeters - comparison.comparisonEnu.northMeters;
    const dz = observation.comparisonEnu.upMeters - comparison.comparisonEnu.upMeters;
    const error = Math.hypot(dx, dy);
    const verticalError = Math.abs(dz);
    const threeDimensionalError = Math.hypot(dx, dy, dz);
    squaredErrorSum += error * error;
    maxControlError = Math.max(maxControlError, error);
    squaredVerticalErrorSum += verticalError * verticalError;
    maxVerticalError = Math.max(maxVerticalError, verticalError);
    squaredThreeDimensionalErrorSum += threeDimensionalError * threeDimensionalError;
    maxThreeDimensionalError = Math.max(maxThreeDimensionalError, threeDimensionalError);
  }
  compareRecomputed(errors, "controlPointCount", report.results.controlPointCount, controlIds.size, 0);
  compareRecomputed(errors, "horizontalRmsMeters", report.results.horizontalRmsMeters, Math.sqrt(squaredErrorSum / controls.comparisons.length));
  compareRecomputed(errors, "maxControlErrorMeters", report.results.maxControlErrorMeters, maxControlError);
  compareRecomputed(errors, "verticalRmsMeters", report.results.verticalRmsMeters, Math.sqrt(squaredVerticalErrorSum / controls.comparisons.length));
  compareRecomputed(errors, "maxVerticalErrorMeters", report.results.maxVerticalErrorMeters, maxVerticalError);
  compareRecomputed(errors, "threeDimensionalRmsMeters", report.results.threeDimensionalRmsMeters, Math.sqrt(squaredThreeDimensionalErrorSum / controls.comparisons.length));
  compareRecomputed(errors, "maxThreeDimensionalErrorMeters", report.results.maxThreeDimensionalErrorMeters, maxThreeDimensionalError);
  compareBelow(errors, "maxControlErrorMeters", maxControlError, report.acceptance.maxControlErrorMeters, "recomputed");
  compareBelow(errors, "maxThreeDimensionalErrorMeters", maxThreeDimensionalError, report.acceptance.maxThreeDimensionalErrorMeters, "recomputed");
}

function retiredReviewContractsGate(options: RoadmapCompletionOptions): RoadmapGateResult {
  if (options.dryRun) {
    return notRunGate(
      "retired-review-contracts",
      "Retired Expert Review product contracts",
      "Dry run: would inspect removed review routes, contracts, archive exports, and SQLite migration.",
    );
  }

  const appPath = "apps/mobile/App.tsx";
  const archivePath = "packages/project-store/src/projectArchive.ts";
  const schemaPath = "packages/project-store/src/persistenceSchema.ts";
  const repositoryTypesPath = "packages/project-store/src/projectRepositoryTypes.ts";
  const reducerPath = "packages/core/src/projectReducer.ts";
  const appSource = existsSync(appPath) ? readFileSync(appPath, "utf8") : "";
  const archiveSource = existsSync(archivePath) ? readFileSync(archivePath, "utf8") : "";
  const schemaSource = existsSync(schemaPath) ? readFileSync(schemaPath, "utf8") : "";
  const repositoryTypesSource = existsSync(repositoryTypesPath) ? readFileSync(repositoryTypesPath, "utf8") : "";
  const reducerSource = existsSync(reducerPath) ? readFileSync(reducerPath, "utf8") : "";
  const removedFiles = [
    "apps/mobile/src/components/ExpertReviewPanel.tsx",
    "packages/core/src/expertReview.ts",
    "packages/core/src/layoutEvidence.ts",
    "packages/project-store/src/projectReviewData.ts",
  ];
  const evidence = [appPath, archivePath, schemaPath, repositoryTypesPath, reducerPath, ...removedFiles];
  const missing = [
    ...removedFiles.map((path) => existsSync(path) ? `removed file still exists: ${path}` : ""),
    appSource.includes("\"review\"") || appSource.includes("workspace-nav-review") || appSource.includes("review-view") ? "mobile Review route/test IDs still present" : "",
    reducerSource.includes("apply_model_recommendation") ? "project reducer still exposes apply_model_recommendation" : "",
    repositoryTypesSource.includes("ProjectReviewData") || repositoryTypesSource.includes("loadProjectReviewDataAsync") || repositoryTypesSource.includes("saveProjectReviewDataAsync") ? "ProjectRepository still exposes review-data API" : "",
    archiveSource.includes("LEGACY_PROJECT_ARCHIVE_IGNORED_FILENAMES") ? "" : "archive importer lacks legacy review filename ignore list",
    archiveSource.includes("exports/layout-evidence.jsonl") && archiveSource.includes("exports/layout-decisions.jsonl") && archiveSource.includes("exports/model-recommendations.geojson") ? "" : "legacy review archive filenames are not explicitly ignored",
    SQLITE_SCHEMA_VERSION >= 10 ? "" : "SQLite schema version has not reached the retired-review migration gate",
    schemaSource.includes("DROP TABLE IF EXISTS layout_evidence") && schemaSource.includes("DROP TABLE IF EXISTS model_recommendations") && schemaSource.includes("DROP TABLE IF EXISTS layout_decisions") ? "" : "SQLite drop-review-contracts migration is missing",
  ].filter((value) => value.length > 0);

  if (missing.length > 0) {
    return {
      id: "retired-review-contracts",
      label: "Retired Expert Review product contracts",
      status: "blocked",
      reason: `Review product contract retirement is incomplete: ${missing.join(", ")}.`,
      evidence,
    };
  }

  return {
    id: "retired-review-contracts",
    label: "Retired Expert Review product contracts",
    status: "pass",
    reason: "Review UI routes, core contracts, repository APIs, archive exports, and SQLite tables are retired; legacy ZIP filenames are ignored for compatibility.",
    evidence,
  };
}

function googleEarthVisualFidelityGate(options: RoadmapCompletionOptions, expectedCommit?: string): RoadmapGateResult {
  if (options.dryRun) {
    return notRunGate(
      "google-earth-visual-fidelity",
      "Google Earth rendered KML/KMZ visual-fidelity proof",
      "Dry run: would validate an existing visual-fidelity manifest.",
    );
  }

  if (options.googleEarthManifestPath) {
    if (!existsSync(options.googleEarthManifestPath)) {
      return {
        id: "google-earth-visual-fidelity",
        label: "Google Earth rendered KML/KMZ visual-fidelity proof",
        status: "blocked",
        reason: `Google Earth visual-fidelity manifest does not exist: ${options.googleEarthManifestPath}`,
        evidence: [options.googleEarthManifestPath],
      };
    }
    const validation = validateGoogleEarthManifest(options.googleEarthManifestPath, expectedCommit);
    return {
      id: "google-earth-visual-fidelity",
      label: "Google Earth rendered KML/KMZ visual-fidelity proof",
      status: validation.ok ? "pass" : "fail",
      reason: validation.ok
        ? "Google Earth artifact hashes, decoded pixel metrics, recorded overlay confirmation and cleanup policy validate."
        : `Google Earth visual-fidelity manifest is not a strict proof: ${validation.errors.join("; ")}`,
      evidence: validation.evidence,
      details: validation.details,
    };
  }

  const candidates = findGoogleEarthManifestCandidates();
  if (candidates.length === 0) {
    return {
      id: "google-earth-visual-fidelity",
      label: "Google Earth rendered KML/KMZ visual-fidelity proof",
      status: "blocked",
      reason: `No Google Earth visual-fidelity manifest found. Expected ${DEFAULT_GOOGLE_EARTH_MANIFEST_PATH} or --google-earth-manifest.`,
    };
  }
  const validations = candidates.map((manifestPath) => validateGoogleEarthManifest(manifestPath, expectedCommit));
  const validation = validations.find((candidate) => candidate.ok) ?? validations[0];
  if (!validation) {
    return {
      id: "google-earth-visual-fidelity",
      label: "Google Earth rendered KML/KMZ visual-fidelity proof",
      status: "blocked",
      reason: "No readable Google Earth visual-fidelity manifest was found.",
    };
  }
  return {
    id: "google-earth-visual-fidelity",
    label: "Google Earth rendered KML/KMZ visual-fidelity proof",
    status: validation.ok ? "pass" : "fail",
    reason: validation.ok
      ? "Google Earth artifact hashes, decoded pixel metrics, recorded overlay confirmation and cleanup policy validate."
      : `Google Earth visual-fidelity manifest is not a strict proof: ${validation.errors.join("; ")}`,
    evidence: validation.evidence,
    details: validation.details,
  };
}

function realPivotFixtureGate(options: RoadmapCompletionOptions, generatedAt: string): RoadmapGateResult {
  if (options.dryRun) {
    return notRunGate(
      "real-pivot-fixture-proof",
      "Operator-approved calibrated real pivot fixture proof",
      "Dry run: would detect/build the real pivot fixture evidence packet.",
    );
  }

  const generatedFixture = options.realPivotFixturesPath || existsSync(DEFAULT_REAL_PIVOT_FIXTURE_PATH)
    ? null
    : tryGenerateDefaultRealPivotFixture(generatedAt);
  const fixturePath = options.realPivotFixturesPath
    ?? (existsSync(DEFAULT_REAL_PIVOT_FIXTURE_PATH)
      ? DEFAULT_REAL_PIVOT_FIXTURE_PATH
      : generatedFixture && "path" in generatedFixture ? generatedFixture.path : undefined);
  if (!fixturePath) {
    const generationError = generatedFixture && "error" in generatedFixture ? generatedFixture.error : undefined;
    return {
      id: "real-pivot-fixture-proof",
      label: "Operator-approved calibrated real pivot fixture proof",
      status: "blocked",
      reason: generationError
        ? `Default real pivot fixture manifest could not be generated: ${generationError}`
        : `No real pivot fixture manifest found. Expected ${DEFAULT_REAL_PIVOT_FIXTURE_PATH} or --real-pivot-fixtures.`,
    };
  }
  if (!existsSync(fixturePath)) {
    return {
      id: "real-pivot-fixture-proof",
      label: "Operator-approved calibrated real pivot fixture proof",
      status: "blocked",
      reason: `Real pivot fixture manifest does not exist: ${fixturePath}`,
    };
  }

  const context = inferRealPivotContext(fixturePath, options);
  if (context.error) {
    return {
      id: "real-pivot-fixture-proof",
      label: "Operator-approved calibrated real pivot fixture proof",
      status: "fail",
      reason: context.error,
      evidence: [fixturePath],
    };
  }
  if (!context.projectId || !context.projectCrs) {
    return {
      id: "real-pivot-fixture-proof",
      label: "Operator-approved calibrated real pivot fixture proof",
      status: "blocked",
      reason: "Real pivot fixture manifest must provide projectId and projectCrs, or pass --real-pivot-project-id and --real-pivot-project-crs.",
      evidence: [fixturePath],
    };
  }

  const outputDirectory = join("reports/real-pivot-fixtures", timestampForFilename(generatedAt));
  const command = [
    "python3",
    "-m",
    "cplayout_ml.cli",
    "build-evidence-packet",
    "--project-id",
    context.projectId,
    "--project-crs",
    context.projectCrs,
    "--real-pivot-fixtures",
    fixturePath,
    "--output-dir",
    outputDirectory,
  ];
  const result = spawnSync(command[0], command.slice(1), {
    shell: process.platform === "win32",
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONPATH: "tools/local-ml-companion/src",
    },
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    const missingLocalArtifact = output.includes("Companion artifact does not exist");
    return {
      id: "real-pivot-fixture-proof",
      label: "Operator-approved calibrated real pivot fixture proof",
      status: missingLocalArtifact ? "blocked" : "fail",
      reason: missingLocalArtifact
        ? `Fixture evidence packet is blocked by a missing local artifact: ${output}`
        : `Fixture evidence packet build failed with exit code ${result.status ?? "unknown"}.`,
      command: command.join(" "),
      exitCode: result.status,
      evidence: [fixturePath, outputDirectory],
      details: output ? { output } : undefined,
    };
  }

  const packetPath = join(outputDirectory, "companion-evidence-packet.json");
  const projectedGeoJsonPath = join(outputDirectory, "companion-evidence-packet-projected-xy.geojson");
  const validation = validateRealPivotEvidencePacket(packetPath);
  if (!validation.ok) {
    return {
      id: "real-pivot-fixture-proof",
      label: "Operator-approved calibrated real pivot fixture proof",
      status: validation.blocked ? "blocked" : "fail",
      reason: validation.reason,
      command: command.join(" "),
      exitCode: result.status,
      evidence: [fixturePath, packetPath, projectedGeoJsonPath],
      details: validation.details,
    };
  }
  const recommendation = firstProjectedPivotRecommendation(packetPath);
  if (!recommendation.ok) {
    return {
      id: "real-pivot-fixture-proof",
      label: "Operator-approved calibrated real pivot fixture proof",
      status: "blocked",
      reason: recommendation.reason,
      command: command.join(" "),
      exitCode: result.status,
      evidence: [fixturePath, packetPath, projectedGeoJsonPath],
    };
  }
  return {
    id: "real-pivot-fixture-proof",
    label: "Operator-approved calibrated real pivot fixture proof",
    status: "pass",
    reason: "Strict v2 companion packet validation passed and the calibrated operator-approved fixture produced a standalone projected-XY pivot-center candidate report.",
    command: command.join(" "),
    exitCode: result.status,
    evidence: [fixturePath, packetPath, projectedGeoJsonPath],
  };
}

export function nativeMapLibreGate(options: RoadmapCompletionOptions, expectedCommit?: string): RoadmapGateResult {
  if (options.dryRun) {
    return notRunGate(
      "native-maplibre-render-proof",
      "Native MapLibre TileJSON/template render proof",
      "Dry run: would validate --native-maplibre-report when provided.",
    );
  }

  if (!options.nativeMapLibreReportPath) {
    return {
      id: "native-maplibre-render-proof",
      label: "Native MapLibre TileJSON/template render proof",
      status: "blocked",
      reason: "No native MapLibre render report provided. TileJSON/template adapter readiness is local-code proven, but native render evidence requires device output.",
    };
  }
  try {
    const rawReport = readJsonWithBom(options.nativeMapLibreReportPath) as { status?: unknown; notes?: unknown };
    if (rawReport.status === "blocked") {
      return {
        id: "native-maplibre-render-proof",
        label: "Native MapLibre TileJSON/template render proof",
        status: "blocked",
        reason: typeof rawReport.notes === "string" && rawReport.notes.length > 0
          ? rawReport.notes
          : "Native MapLibre report records a blocked device/runtime proof.",
        evidence: [options.nativeMapLibreReportPath],
      };
    }
    const validation = validateNativeMapLibreReport(options.nativeMapLibreReportPath, expectedCommit);
    if (validation.ok) {
      return {
        id: "native-maplibre-render-proof",
        label: "Native MapLibre TileJSON/template render proof",
        status: "pass",
        reason: "Native MapLibre report artifact contract validated; installed build identity was not checked.",
        evidence: validation.evidence,
        details: validation.details,
      };
    }
    return {
      id: "native-maplibre-render-proof",
      label: "Native MapLibre TileJSON/template render proof",
      status: validation.blocked ? "blocked" : "fail",
      reason: `Native MapLibre report is incomplete: ${validation.errors.join("; ")}`,
      evidence: validation.evidence,
      details: validation.details,
    };
  } catch (error) {
    return {
      id: "native-maplibre-render-proof",
      label: "Native MapLibre TileJSON/template render proof",
      status: "fail",
      reason: `Native MapLibre report could not be read: ${error instanceof Error ? error.message : String(error)}`,
      evidence: [options.nativeMapLibreReportPath],
    };
  }
}

export function validateGoogleEarthManifest(manifestPath: string, expectedCommit?: string): {
  ok: boolean;
  errors: string[];
  evidence: string[];
  details: unknown;
} {
  const errors: string[] = [];
  const manifest = readJsonWithBom(manifestPath) as {
    schemaVersion?: unknown;
    commit?: unknown;
    status?: unknown;
    proofPassed?: unknown;
    outputDir?: unknown;
    googleEarth?: {
      cleanup?: {
        status?: unknown;
        contaminated?: unknown;
        postflightProcessRemaining?: unknown;
        requested?: unknown;
        leaveOpen?: unknown;
      };
      contaminatedWorkspace?: unknown;
    };
    thresholds?: {
      minimumNonBlackRatio?: unknown;
      minimumGrayVariance?: unknown;
    };
    artifacts?: {
      kml?: unknown;
      kmz?: unknown;
      sha256?: { kml?: unknown; kmz?: unknown };
      kmlIntegrity?: { passed?: unknown };
    };
    captures?: Array<{
      filename?: unknown;
      label?: unknown;
      width?: unknown;
      height?: unknown;
      sha256?: unknown;
      analysis?: {
        nonBlackRatio?: unknown;
        grayVariance?: unknown;
        mostlyBlack?: unknown;
        nearUniform?: unknown;
      } | null;
    }>;
    manualReview?: {
      overlayVisibleConfirmed?: unknown;
    };
  };

  if (manifest.schemaVersion !== "cplayout-google-earth-visual-fidelity-proof-v1") errors.push("schemaVersion mismatch");
  if (expectedCommit !== undefined && (typeof manifest.commit !== "string" || !commitMatches(manifest.commit, expectedCommit))) {
    errors.push(`commit must match release commit ${expectedCommit}`);
  }
  if (manifest.status !== "passed") errors.push("status must be passed");
  if (manifest.proofPassed !== true) errors.push("proofPassed must be true");
  if (manifest.artifacts?.kmlIntegrity?.passed !== true) errors.push("KML integrity must pass");
  if (manifest.manualReview?.overlayVisibleConfirmed !== true) errors.push("overlayVisibleConfirmed must be true");

  const minimumNonBlackRatio = typeof manifest.thresholds?.minimumNonBlackRatio === "number"
    ? manifest.thresholds.minimumNonBlackRatio
    : 0.08;
  const minimumGrayVariance = typeof manifest.thresholds?.minimumGrayVariance === "number"
    ? manifest.thresholds.minimumGrayVariance
    : 80;
  if (!Number.isFinite(minimumNonBlackRatio) || minimumNonBlackRatio < 0.08 || minimumNonBlackRatio > 1) errors.push("minimumNonBlackRatio must be finite and between 0.08 and 1");
  if (!Number.isFinite(minimumGrayVariance) || minimumGrayVariance < 80) errors.push("minimumGrayVariance must be finite and at least 80");
  const mapCanvas = (Array.isArray(manifest.captures) ? manifest.captures : []).find((capture) => {
    if (!capture) return false;
    const filename = typeof capture.filename === "string" ? capture.filename.toLowerCase() : "";
    const label = typeof capture.label === "string" ? capture.label.toLowerCase() : "";
    return filename.includes("map-canvas") || label.includes("map-canvas");
  });
  if (!mapCanvas) {
    errors.push("map-canvas capture is required");
  } else {
    const analysis = mapCanvas.analysis;
    if (typeof mapCanvas.width !== "number" || mapCanvas.width <= 0) errors.push("map-canvas width must be positive");
    if (typeof mapCanvas.height !== "number" || mapCanvas.height <= 0) errors.push("map-canvas height must be positive");
    if (typeof mapCanvas.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(mapCanvas.sha256)) {
      errors.push("map-canvas SHA-256 is required");
    }
    if (!analysis) {
      errors.push("map-canvas pixel analysis is required");
    } else {
      if (typeof analysis.nonBlackRatio !== "number" || analysis.nonBlackRatio < minimumNonBlackRatio) {
        errors.push(`map-canvas nonBlackRatio must be at least ${minimumNonBlackRatio}`);
      }
      if (typeof analysis.grayVariance !== "number" || analysis.grayVariance < minimumGrayVariance) {
        errors.push(`map-canvas grayVariance must be at least ${minimumGrayVariance}`);
      }
      if (analysis.mostlyBlack !== false) errors.push("map-canvas must not be mostly black");
      if (analysis.nearUniform !== false) errors.push("map-canvas must not be near-uniform");
    }
  }

  const cleanup = manifest.googleEarth?.cleanup;
  if (!cleanup) {
    errors.push("Google Earth cleanup evidence is required");
  } else {
    if (cleanup.contaminated !== false || (manifest.googleEarth?.contaminatedWorkspace !== undefined && manifest.googleEarth.contaminatedWorkspace !== false)) errors.push("cleanup must affirmatively be noncontaminated");
    const leaveOpen = cleanup.status === "skipped_leave_open" && cleanup.leaveOpen === true && cleanup.requested === true;
    const closed = typeof cleanup.status === "string" && ["closed_gracefully", "closed_after_modal_discard", "force_closed"].includes(cleanup.status);
    if (!closed && !leaveOpen) errors.push(`cleanup status is not acceptable: ${String(cleanup.status)}`);
    if (leaveOpen ? typeof cleanup.postflightProcessRemaining !== "boolean" : cleanup.postflightProcessRemaining !== false) {
      errors.push("targeted Google Earth process cleanup must have an affirmative postflight result");
    }
    if (closed && ((cleanup.leaveOpen !== undefined && cleanup.leaveOpen !== false) || (cleanup.requested !== undefined && cleanup.requested !== true))) errors.push("cleanup request contradicts closed status");
  }

  const outputDir = typeof manifest.outputDir === "string" ? normalizeReportPath(manifest.outputDir) : dirname(manifestPath);
  const kmlPath = stringEvidencePath(outputDir, manifest.artifacts?.kml);
  const kmzPath = stringEvidencePath(outputDir, manifest.artifacts?.kmz);
  const mapCanvasPath = mapCanvas && typeof mapCanvas.filename === "string"
    ? stringEvidencePath(outputDir, mapCanvas.filename)
    : undefined;
  validateHashedArtifact(errors, "KML", kmlPath, manifest.artifacts?.sha256?.kml);
  validateHashedArtifact(errors, "KMZ", kmzPath, manifest.artifacts?.sha256?.kmz);
  validateHashedArtifact(errors, "map-canvas", mapCanvasPath, mapCanvas?.sha256);
  if (mapCanvasPath && existsSync(mapCanvasPath)) {
    const metrics = validatePngEvidence(errors, "map-canvas", mapCanvasPath, mapCanvas?.width, mapCanvas?.height,
      mapCanvas?.analysis?.nonBlackRatio, mapCanvas?.analysis?.grayVariance);
    if (metrics && (metrics.nonBlankPixelRatio < minimumNonBlackRatio || metrics.grayVariance < minimumGrayVariance)) {
      errors.push("map-canvas decoded pixel metrics do not meet proof thresholds");
    }
  }
  const evidence = [manifestPath, kmlPath, kmzPath, mapCanvasPath]
    .filter((value): value is string => Boolean(value));

  return {
    ok: errors.length === 0,
    errors,
    evidence,
    details: {
      status: manifest.status,
      proofPassed: manifest.proofPassed,
      mapCanvas,
      cleanup,
    },
  };
}

export function validateNativeMapLibreReport(reportPath: string, expectedCommit?: string): {
  ok: boolean;
  blocked: boolean;
  errors: string[];
  evidence: string[];
  details: unknown;
} {
  const errors: string[] = [];
  const report = readJsonWithBom(reportPath) as {
    reportSchemaVersion?: unknown;
    proofTarget?: unknown;
    status?: unknown;
    target?: unknown;
    generatedAt?: unknown;
    device?: { adbSerial?: unknown; model?: unknown; osVersion?: unknown; apiLevel?: unknown };
    app?: { packageName?: unknown; versionName?: unknown; versionCode?: unknown; buildType?: unknown; commit?: unknown };
    tileSource?: {
      tileSourceKind?: unknown;
      tileContentType?: unknown;
      sourceComponent?: unknown;
      tileJsonUrl?: unknown;
      tileUrlTemplates?: unknown;
      sourceLayers?: unknown;
      attribution?: unknown;
    };
    screenshot?: {
      path?: unknown;
      sha256?: unknown;
      width?: unknown;
      height?: unknown;
      nonBlankPixelRatio?: unknown;
      grayVariance?: unknown;
    };
    boundaries?: {
      noRawPmtilesMbtilesNativeProof?: unknown;
      canonicalGeometryMutation?: unknown;
      networkRequired?: unknown;
    };
    tileServer?: {
      tileJsonRequests?: unknown;
      tileRequests?: unknown;
    };
    logcat?: {
      path?: unknown;
      sha256?: unknown;
      lineCount?: unknown;
      mapLibreLineCount?: unknown;
      mapLibreErrorLines?: unknown;
      resourceUrlErrorCount?: unknown;
      resourceUrlErrorLines?: unknown;
      clearedBeforeLaunch?: unknown;
    };
  };
  if (report.reportSchemaVersion !== 1) errors.push("reportSchemaVersion must be 1");
  if (report.proofTarget !== "native-maplibre-render") errors.push("proofTarget must be native-maplibre-render");
  if (report.status !== "pass") errors.push("status must be pass");
  if (report.target !== "native_maplibre_rn") errors.push("target must be native_maplibre_rn");
  if (!z.iso.datetime().safeParse(report.generatedAt).success) errors.push("generatedAt must be a valid ISO UTC timestamp");
  if (expectedCommit !== undefined && (typeof report.app?.commit !== "string" || !commitMatches(report.app.commit, expectedCommit))) {
    errors.push(`app.commit must match release commit ${expectedCommit}`);
  }
  for (const [label, value] of Object.entries({
    generatedAt: report.generatedAt,
    adbSerial: report.device?.adbSerial,
    model: report.device?.model,
    osVersion: report.device?.osVersion,
    packageName: report.app?.packageName,
    buildType: report.app?.buildType,
    commit: report.app?.commit,
    attribution: report.tileSource?.attribution,
  })) {
    if (typeof value !== "string" || value.trim().length === 0) errors.push(`${label} is required`);
  }
  if (report.tileSource?.tileSourceKind !== "tilejson_or_template") {
    errors.push("tileSource.tileSourceKind must be tilejson_or_template");
  }
  if (report.tileSource?.tileContentType !== "vector") {
    errors.push("tileSource.tileContentType must be vector");
  }
  if (report.tileSource?.sourceComponent !== "VectorSource") {
    errors.push("tileSource.sourceComponent must be VectorSource");
  }
  const sourceLayers = report.tileSource?.sourceLayers as { roads?: unknown; roadLabels?: unknown; borders?: unknown; places?: unknown } | undefined;
  for (const [label, value] of Object.entries({
    roads: sourceLayers?.roads,
    roadLabels: sourceLayers?.roadLabels,
    borders: sourceLayers?.borders,
    places: sourceLayers?.places,
  })) {
    if (typeof value !== "string" || value.trim().length === 0) errors.push(`tileSource.sourceLayers.${label} is required`);
  }
  const tileUrls = [
    typeof report.tileSource?.tileJsonUrl === "string" ? report.tileSource.tileJsonUrl : undefined,
    ...(Array.isArray(report.tileSource?.tileUrlTemplates) ? report.tileSource.tileUrlTemplates : []),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (tileUrls.length === 0) errors.push("at least one TileJSON URL or tile URL template is required");
  if (!tileUrls.every(isLocalTileSourceUrl)) errors.push("tile URLs must be local app-readable or localhost sources");

  const screenshotPath = typeof report.screenshot?.path === "string" && report.screenshot.path.trim().length > 0
    ? resolve(dirname(reportPath), report.screenshot.path)
    : "";
  if (!screenshotPath) {
    errors.push("screenshot.path is required");
  } else if (!existsSync(screenshotPath)) {
    errors.push(`screenshot does not exist: ${screenshotPath}`);
  } else {
    const metrics = validatePngEvidence(errors, "screenshot", screenshotPath, report.screenshot?.width, report.screenshot?.height,
      report.screenshot?.nonBlankPixelRatio, report.screenshot?.grayVariance);
    if (metrics && (metrics.nonBlankPixelRatio <= 0.05 || metrics.grayVariance <= 20)) {
      errors.push("screenshot decoded pixel metrics do not meet native proof thresholds");
    }
  }
  if (typeof report.screenshot?.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(report.screenshot.sha256)) {
    errors.push("screenshot.sha256 must be a SHA-256 hex digest");
  } else if (screenshotPath && existsSync(screenshotPath)) {
    const actualSha256 = sha256File(screenshotPath);
    if (actualSha256.toLowerCase() !== report.screenshot.sha256.toLowerCase()) {
      errors.push("screenshot.sha256 does not match the screenshot file");
    }
  }
  if (typeof report.screenshot?.width !== "number" || report.screenshot.width <= 0) errors.push("screenshot.width must be positive");
  if (typeof report.screenshot?.height !== "number" || report.screenshot.height <= 0) errors.push("screenshot.height must be positive");
  if (typeof report.screenshot?.nonBlankPixelRatio !== "number" || report.screenshot.nonBlankPixelRatio <= 0) {
    errors.push("screenshot.nonBlankPixelRatio must be greater than zero");
  }
  if (typeof report.screenshot?.grayVariance !== "number" || report.screenshot.grayVariance <= 0) {
    errors.push("screenshot.grayVariance must be greater than zero");
  }
  if (report.boundaries?.noRawPmtilesMbtilesNativeProof !== true) {
    errors.push("boundaries.noRawPmtilesMbtilesNativeProof must be true");
  }
  if (report.boundaries?.canonicalGeometryMutation !== false) {
    errors.push("boundaries.canonicalGeometryMutation must be false");
  }
  if (report.boundaries?.networkRequired !== false) {
    errors.push("boundaries.networkRequired must be false");
  }
  if (typeof report.tileServer?.tileRequests !== "number" || !Number.isFinite(report.tileServer.tileRequests)
    || !Number.isInteger(report.tileServer.tileRequests) || report.tileServer.tileRequests <= 0) {
    errors.push("tileServer.tileRequests must be a finite positive integer");
  }
  if (report.tileServer?.tileJsonRequests !== undefined
    && (typeof report.tileServer.tileJsonRequests !== "number" || report.tileServer.tileJsonRequests < 0)) {
    errors.push("tileServer.tileJsonRequests must be a nonnegative number when present");
  }
  const logcatPath = typeof report.logcat?.path === "string" && report.logcat.path.trim().length > 0
    ? resolve(dirname(reportPath), report.logcat.path)
    : "";
  if (!logcatPath) {
    errors.push("logcat.path is required");
  } else if (!existsSync(logcatPath)) {
    errors.push(`logcat evidence does not exist: ${logcatPath}`);
  }
  if (typeof report.logcat?.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(report.logcat.sha256)) {
    errors.push("logcat.sha256 must be a SHA-256 hex digest");
  } else if (logcatPath && existsSync(logcatPath)) {
    const actualSha256 = sha256File(logcatPath);
    if (actualSha256.toLowerCase() !== report.logcat.sha256.toLowerCase()) {
      errors.push("logcat.sha256 does not match the logcat evidence file");
    }
  }
  if (typeof report.logcat?.lineCount !== "number" || report.logcat.lineCount < 0) {
    errors.push("logcat.lineCount must be a nonnegative number");
  }
  if (typeof report.logcat?.mapLibreLineCount !== "number" || report.logcat.mapLibreLineCount < 0) {
    errors.push("logcat.mapLibreLineCount must be a nonnegative number");
  }
  if (!Array.isArray(report.logcat?.mapLibreErrorLines)) {
    errors.push("logcat.mapLibreErrorLines must be an array");
  }
  if (typeof report.logcat?.resourceUrlErrorCount !== "number" || report.logcat.resourceUrlErrorCount !== 0) {
    errors.push("logcat.resourceUrlErrorCount must be 0");
  }
  if (!Array.isArray(report.logcat?.resourceUrlErrorLines) || report.logcat.resourceUrlErrorLines.length !== 0) {
    errors.push("logcat.resourceUrlErrorLines must be an empty array");
  }

  const blocked = expectedCommit !== undefined && errors.length === 0;
  if (expectedCommit !== undefined) errors.push(nativeBuildIdentityBlocker());
  return {
    ok: errors.length === 0,
    blocked,
    errors,
    evidence: [reportPath, screenshotPath, logcatPath].filter((value) => value.length > 0),
    details: {
      nativeBuildIdentity: { status: expectedCommit !== undefined ? "blocked" : "not_run", reason: nativeBuildIdentityBlocker() },
      target: report.target,
      tileSource: report.tileSource,
      screenshot: report.screenshot,
      boundaries: report.boundaries,
      tileServer: report.tileServer,
      logcat: report.logcat,
    },
  };
}

function inferRealPivotContext(
  fixturePath: string,
  options: RoadmapCompletionOptions,
): { projectId?: string; projectCrs?: string; error?: string } {
  try {
    const manifest = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      projectId?: unknown;
      projectCrs?: unknown;
      fixtures?: Array<{ projectId?: unknown; projectCrs?: unknown }>;
    };
    const fixture = Array.isArray(manifest.fixtures) ? manifest.fixtures[0] : undefined;
    return {
      projectId: options.realPivotProjectId ?? stringOrUndefined(manifest.projectId) ?? stringOrUndefined(fixture?.projectId),
      projectCrs: options.realPivotProjectCrs ?? stringOrUndefined(manifest.projectCrs) ?? stringOrUndefined(fixture?.projectCrs),
    };
  } catch (error) {
    return { error: `Real pivot fixture manifest could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function validateRealPivotEvidencePacket(packetPath: string): { ok: true; details: unknown } | { ok: false; blocked: boolean; reason: string; details: unknown } {
  try {
    const packet = JSON.parse(readFileSync(packetPath, "utf8")) as unknown;
    const result = validateImageryEvidencePacket(packet);
    const projectedPivotReview = result.candidateReviews.find((review) => review.status === "calibrated_projected_xy");
    const details = {
      status: result.status,
      blockerCount: result.blockerCount,
      warningCount: result.warningCount,
      summary: result.summary,
      candidateReviews: result.candidateReviews.map((review) => ({
        candidateId: review.candidateId,
        status: review.status,
        projectedGeometryPresent: review.projectedGeometryPresent,
        blockerCount: review.blockerCount,
        warningCount: review.warningCount,
      })),
      blockerCodes: result.blockers.map((issue) => issue.code),
      warningCodes: result.warnings.map((issue) => issue.code),
    };
    if (result.status !== "ready_for_read_only_report") {
      return {
        ok: false,
        blocked: true,
        reason: `Fixture packet failed strict cplayout-imagery-evidence-v2 validation: ${result.blockers.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
        details,
      };
    }
    if (!projectedPivotReview) {
      return {
        ok: false,
        blocked: true,
        reason: "Fixture packet passed v2 metadata checks, but no candidate review is calibrated_projected_xy.",
        details,
      };
    }
    return { ok: true, details };
  } catch (error) {
    return {
      ok: false,
      blocked: false,
      reason: `Fixture packet could not be parsed or validated: ${error instanceof Error ? error.message : String(error)}`,
      details: {},
    };
  }
}

function firstProjectedPivotRecommendation(packetPath: string): { ok: true } | { ok: false; reason: string } {
  const packet = JSON.parse(readFileSync(packetPath, "utf8")) as {
    candidateReports?: Array<{
      proposedGeometry?: { pivotCenter?: unknown };
      metadata?: { hardFailures?: unknown };
    }>;
    modelRecommendations?: Array<{
      proposedGeometry?: { pivotCenter?: unknown };
      metadata?: { hardFailures?: unknown };
    }>;
  };
  const recommendations = packet.candidateReports ?? packet.modelRecommendations ?? [];
  const projectedPivotRecommendation = recommendations.find((recommendation) => {
    const hardFailures = recommendation.metadata?.hardFailures;
    return Boolean(recommendation.proposedGeometry?.pivotCenter)
      && (!Array.isArray(hardFailures) || hardFailures.length === 0);
  });
  if (projectedPivotRecommendation) return { ok: true };
  return {
    ok: false,
    reason: "Fixture packet built, but no candidate report contains projectedGeometry.pivotCenter without hard failures. Treat as evidence-only until calibrated truth is supplied.",
  };
}

function tryGenerateDefaultRealPivotFixture(generatedAt: string): { path: string } | { error: string } {
  try {
    return { path: generateDefaultRealPivotFixtureManifest({ generatedAt }).path };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function notRunGate(id: string, label: string, reason: string): RoadmapGateResult {
  return { id, label, status: "not_run", reason };
}

function summarizeStatus(gates: RoadmapGateResult[]): RoadmapCompletionReport["status"] {
  if (gates.some((gate) => gate.status === "fail")) return "fail";
  if (gates.some((gate) => gate.status === "blocked")) return "blocked";
  if (gates.some((gate) => gate.status === "not_run")) return "incomplete";
  return "pass";
}

function writeMarkdownSummary(path: string, report: RoadmapCompletionReport): void {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  const lines = [
    "# CPLayout Roadmap Completion Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Commit: ${report.commit}`,
    `Profile: ${report.profile}`,
    `Status: ${report.status}`,
    `Clean worktree: ${report.treeState.clean === null ? "not checked" : report.treeState.clean ? "yes" : "no"}`,
    "",
    "| Gate | Status | Reason |",
    "| --- | --- | --- |",
    ...report.gates.map((gate) => `| ${gate.id} | ${gate.status} | ${gate.reason.replaceAll("|", "\\|")} |`),
    "",
    "## Resource Inputs",
    "",
    ...report.ownerInputContract.resourceInputs.map((input) => `- ${input}`),
    "",
  ];
  writeFileSync(path, lines.join("\n"), "utf8");
}

function findGoogleEarthManifestCandidates(root = "reports/google-earth-visual-fidelity"): string[] {
  if (!existsSync(root)) return [];
  const manifests = findFiles(root, "visual-fidelity-manifest.json");
  const candidates = [
    existsSync(DEFAULT_GOOGLE_EARTH_MANIFEST_PATH) ? DEFAULT_GOOGLE_EARTH_MANIFEST_PATH : undefined,
    ...manifests
      .map((path) => ({ path, mtimeMs: statSync(path).mtimeMs }))
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .map((entry) => entry.path),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates)];
}

function findFiles(root: string, filename: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...findFiles(path, filename));
    } else if (entry.isFile() && entry.name === filename) {
      found.push(path);
    }
  }
  return found;
}

function readJsonWithBom(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function normalizeReportPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function stringEvidencePath(baseDir: string, value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const normalized = normalizeReportPath(value);
  if (existsSync(normalized)) return normalized;
  const relativeToBase = join(normalizeReportPath(baseDir), normalized.split("/").pop() ?? normalized);
  return existsSync(relativeToBase) ? relativeToBase : normalized;
}

function isLocalTileSourceUrl(value: string): boolean {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("file://")
    || lower.startsWith("asset://")
    || lower.startsWith("content://")
    || lower.startsWith("app://")
    || lower.startsWith("blob:")
    || lower.startsWith("data:")
    || lower.startsWith("/")
    || lower.startsWith("./")
    || lower.startsWith("../")
  ) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1");
  } catch {
    return false;
  }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function validatePngEvidence(
  errors: string[], label: string, path: string, width: unknown, height: unknown, ratio: unknown, variance: unknown,
): PngPixelMetrics | undefined {
  try {
    const bytes = readFileSync(path);
    // pngMetrics decodes pixels but does not enforce chunk bounds, CRCs or IEND.
    validatePngEnvelope(bytes);
    const metrics = analyzePngPixels(bytes);
    compareRecomputed(errors, `${label}.width`, width, metrics.width, 0);
    compareRecomputed(errors, `${label}.height`, height, metrics.height, 0);
    compareRecomputed(errors, `${label}.nonBlankPixelRatio`, ratio, metrics.nonBlankPixelRatio);
    compareRecomputed(errors, `${label}.grayVariance`, variance, metrics.grayVariance, 0.001);
    if (metrics.nonBlankPixelRatio <= 0 || metrics.grayVariance <= 0) errors.push(`${label} PNG pixels are blank or uniform`);
    return metrics;
  } catch (error) {
    errors.push(`${label} PNG cannot be decoded: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function validatePngEnvelope(bytes: Buffer): void {
  if (bytes.length < 33 || bytes.length > 64 * 1024 * 1024) throw new Error("PNG is truncated or exceeds the 64 MiB evidence limit");
  let offset = 8;
  let ihdr = false;
  let idat = false;
  let idatEnded = false;
  let plte = false;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const payloads: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("PNG chunk is truncated");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (!ihdr && type !== "IHDR") throw new Error("PNG must begin with IHDR");
    if ((bytes[offset + 4] & 0x20) === 0 && !["IHDR", "PLTE", "IDAT", "IEND"].includes(type)) {
      throw new Error(`PNG contains unknown critical chunk ${type}`);
    }
    if (idat && type !== "IDAT") idatEnded = true;
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, end - 4)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(end - 4)) throw new Error(`PNG ${type} CRC does not match`);
    if (type === "IHDR") {
      if (ihdr || length !== 13) throw new Error("PNG IHDR must occur once with 13 bytes");
      ihdr = true;
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      colorType = bytes[offset + 17];
      const pixels = width * height;
      if (pixels <= 0 || pixels > 16_777_216) throw new Error("PNG dimensions exceed the 16-megapixel evidence limit");
    }
    if (type === "PLTE") {
      if (plte || idat) throw new Error("PNG PLTE must occur at most once and before IDAT");
      if (colorType !== 2 && colorType !== 6) throw new Error("PNG PLTE is only allowed for supported RGB/RGBA evidence");
      if (length === 0 || length > 768 || length % 3 !== 0) throw new Error("PNG PLTE must contain 1-256 RGB entries");
      plte = true;
    }
    if (type === "tRNS") throw new Error("PNG evidence must be opaque; tRNS is not supported");
    if (type === "IDAT") {
      if (idatEnded) throw new Error("PNG IDAT chunks must be consecutive");
      idat = true; payloads.push(bytes.subarray(offset + 8, end - 4));
    }
    if (type === "IEND") {
      if (!idat || length !== 0 || end !== bytes.length) throw new Error("PNG IEND must terminate a complete image");
      const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
      if (!channels) throw new Error("Unsupported PNG color type");
      const rowBytes = width * channels + 1;
      const raw = inflateSync(Buffer.concat(payloads), { maxOutputLength: rowBytes * height });
      if (raw.length !== rowBytes * height) throw new Error("PNG pixel payload length does not match its dimensions");
      if (channels === 4) validateOpaquePngAlpha(raw, width, height);
      return;
    }
    offset = end;
  }
  throw new Error("PNG is truncated or missing IEND");
}

function validateOpaquePngAlpha(raw: Buffer, width: number, height: number): void {
  // The existing metric decoder ignores alpha. Filter predictors for the
  // alpha byte depend only on neighboring alpha bytes, all required to be 255.
  const rowBytes = width * 4 + 1;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * rowBytes];
    for (let x = 0; x < width; x += 1) {
      const left = x > 0 ? 255 : 0;
      const up = y > 0 ? 255 : 0;
      const upperLeft = x > 0 && y > 0 ? 255 : 0;
      let predictor: number;
      if (filter === 0) predictor = 0;
      else if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft;
        const a = Math.abs(p - left); const b = Math.abs(p - up); const c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      } else throw new Error("Unsupported PNG filter");
      if (((raw[y * rowBytes + x * 4 + 4] + predictor) & 255) !== 255) throw new Error("PNG evidence must be opaque; transparent pixels do not prove rendered content");
    }
  }
}

function compareRecomputed(errors: string[], label: string, declared: unknown, actual: number, tolerance = 1e-9): void {
  if (typeof declared !== "number" || !Number.isFinite(declared) || !Number.isFinite(actual) || Math.abs(declared - actual) > tolerance) {
    errors.push(`${label} does not match recomputed evidence (${actual})`);
  }
}

function nativeBuildIdentityBlocker(): string {
  return "Native build identity BLOCKED: current producers stamp the host checkout commit, not a verified installed build or running bundle. Verifiable installed build/bundle linkage to the release commit is not implemented.";
}

function validateHashedArtifact(
  errors: string[],
  label: string,
  path: string | undefined,
  expectedSha256: unknown,
): void {
  if (!path || !existsSync(path)) {
    errors.push(`${label} artifact does not exist${path ? `: ${path}` : ""}`);
    return;
  }
  if (typeof expectedSha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(expectedSha256)) {
    errors.push(`${label} SHA-256 is required`);
    return;
  }
  if (sha256File(path).toLowerCase() !== expectedSha256.toLowerCase()) {
    errors.push(`${label} SHA-256 does not match its file`);
  }
}

function compareAtMost(errors: string[], label: string, observed: unknown, threshold: unknown): void {
  if (typeof observed === "number" && Number.isFinite(observed)
    && typeof threshold === "number" && Number.isFinite(threshold)
    && observed > threshold) {
    errors.push(`results.${label} exceeds acceptance.${label}`);
  }
}

function compareBelow(errors: string[], label: string, observed: unknown, threshold: unknown, source = "results"): void {
  if (typeof observed === "number" && Number.isFinite(observed)
    && typeof threshold === "number" && Number.isFinite(threshold)
    && observed >= threshold) {
    errors.push(`${source}.${label} must be strictly less than acceptance.${label}`);
  }
}

function commitMatches(evidenceCommit: string, expectedCommit: string): boolean {
  const evidence = evidenceCommit.toLowerCase();
  const expected = expectedCommit.toLowerCase();
  // This repository uses SHA-1 with --short=12; suffixes are not commit IDs.
  return /^[a-f0-9]{12,40}$/u.test(evidence) && /^[a-f0-9]{12,40}$/u.test(expected)
    && (evidence === expected || evidence.startsWith(expected) || expected.startsWith(evidence));
}

function profileFor(options: RoadmapCompletionOptions): RoadmapProfile {
  return options.profile ?? (options.full ? "checkpoint" : "fast");
}

function hasFlag(rawArgs: string[], name: string): boolean {
  return rawArgs.includes(name);
}

function valueFor(rawArgs: string[], name: string): string | undefined {
  const index = rawArgs.indexOf(name);
  if (index >= 0) return rawArgs[index + 1];
  return rawArgs.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function currentGitCommit(): string {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
