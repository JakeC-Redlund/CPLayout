import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sampleProject, type PivotProject } from "@cplayout/core";
import { evaluateLayout, exportScenarioGeoJson } from "@cplayout/geometry";
import {
  ANDROID_NATIVE_IN_APP_PROOF_LOG_MARKER,
  androidNativeVerificationCompletionErrors,
  androidNativeVerificationStatus,
  buildProjectArchiveBundle,
  exportProjectArchiveZip,
  parseCompleteAndroidNativeVerificationReport,
  parseAndroidNativeVerificationReport,
} from "@cplayout/project-store";
import {
  collectAndroidToolSnapshot,
  readExpoAndroidPackageName,
  reportFromSnapshot,
  timestampForFilename,
  writeJsonFile,
} from "./androidNativeProof";
import {
  attemptUiTap,
  findNode,
  findPickerFileNode,
  hasBlockingAndroidUi,
  hasProjectBreadcrumb,
  isDocumentsPickerXml,
  isExpectedProjectLoaded,
  isFilesUiReady,
  isProjectCatalogUi,
  isShareSheetXml,
  parseAndroidUiXml,
  pickerAttemptEvidence,
  readConfirmedUiDump,
  type NodeMatcher,
} from "./androidFileUiEvidence";

const args = process.argv.slice(2);
const reportArgIndex = args.indexOf("--report");
const collectMode = args.includes("--collect");
const outputDirectory = valueFor(args, "--output-dir") ?? "reports/android-native-verification";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

function main(): void {
  if (reportArgIndex >= 0) {
    const reportPath = args[reportArgIndex + 1];
    if (!reportPath) {
      console.error("Usage: npm run verify:android-native -- --report <report.json>");
      process.exit(1);
    }
    try {
      parseCompleteAndroidNativeVerificationReport(JSON.parse(readFileSync(reportPath, "utf8")));
      console.log(`Android native verification report complete: ${reportPath}`);
      process.exit(0);
    } catch (error) {
      console.error(`blocked: Android native checklist evidence incomplete in ${reportPath}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  if (collectMode) {
    collectAndroidNativeProof(args)
      .then(({ reportPath, status }) => {
        console.log(`Android native collect report written: ${reportPath}`);
        process.exit(status === "pass" ? 0 : 1);
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      });
  } else {
    const packageName = readExpoAndroidPackageName();
    const snapshot = collectAndroidToolSnapshot({ packageName, outputDirectory, serial: valueFor(args, "--serial") });
    const report = reportFromSnapshot(snapshot);
    const reportPath = join(
      outputDirectory,
      `android-native-verification-${timestampForFilename(snapshot.generatedAt)}.json`,
    );
    writeJsonFile(reportPath, report);

    if (snapshot.blocker) {
      console.error(snapshot.blocker);
      console.error(`Native verification report written: ${reportPath}`);
      process.exit(1);
    }

    console.error("blocked: Android native checklist evidence incomplete; run docs/android-native-verification.md on the detected built app and validate the completed report with:");
    console.error(`npm run verify:android-native -- --report ${reportPath}`);
    console.error(`Native verification report written: ${reportPath}`);
    process.exit(1);
  }
}

async function collectAndroidNativeProof(rawArgs: string[]): Promise<{ reportPath: string; status: string }> {
  const packageName = valueFor(rawArgs, "--package-name") ?? process.env.CPLAYOUT_ANDROID_PACKAGE_NAME ?? readExpoAndroidPackageName();
  const waitMs = Number(valueFor(rawArgs, "--wait-ms") ?? "30000");
  if (!Number.isFinite(waitMs) || waitMs < 1 || waitMs > 120000) throw new Error("--wait-ms must be between 1 and 120000.");
  const devClientUrl = valueFor(rawArgs, "--dev-client-url") ?? process.env.CPLAYOUT_EXPO_DEV_CLIENT_URL ?? "";
  const serial = valueFor(rawArgs, "--serial") ?? process.env.ANDROID_SERIAL;
  mkdirSync(outputDirectory, { recursive: true });

  const snapshot = collectAndroidToolSnapshot({ packageName, outputDirectory, serial });
  const baseReport = reportFromSnapshot(snapshot);
  const reportPath = join(
    outputDirectory,
    `android-native-verification-${timestampForFilename(snapshot.generatedAt)}.json`,
  );

  if (snapshot.blocker || !snapshot.selectedDevice || !snapshot.commands.adb.path) {
    writeJsonFile(reportPath, baseReport);
    return { reportPath, status: baseReport.status };
  }

  const adbPath = snapshot.commands.adb.path;
  const adbSerial = snapshot.selectedDevice.serial;
  runAdb(adbPath, ["-s", adbSerial, "logcat", "-c"], "text", false);
  reverseDevClientPorts(adbPath, adbSerial, devClientUrl);
  launchPackage(adbPath, adbSerial, packageName, devClientUrl);
  const inAppProof = await waitForInAppProof(adbPath, adbSerial, waitMs);
  const osFileUiNotes: string[] = [];
  let osFileUi = failedOsFileUiEvidence({
    reason: "OS file UI automation did not run.",
    outputDirectory,
    generatedAt: snapshot.generatedAt,
  });
  try {
    osFileUi = await collectOsFileUiEvidence({
      adbPath,
      serial: adbSerial,
      packageName,
      outputDirectory,
      generatedAt: snapshot.generatedAt,
      evidence: osFileUi,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    osFileUiNotes.push(`OS file UI automation error: ${reason}`);
    osFileUi = captureFailedOsFileUiEvidence({
      adbPath,
      serial: adbSerial,
      outputDirectory,
      generatedAt: snapshot.generatedAt,
      reason,
      priorEvidence: osFileUi,
    });
  }
  const logExcerptPath = writeCollectLogExcerpt(adbPath, adbSerial, outputDirectory, snapshot.generatedAt);

  const report = {
    ...baseReport,
    executionScope: "single_process" as const,
    generatedAt: inAppProof?.generatedAt ?? baseReport.generatedAt,
    status: inAppProof?.status === "fail" || !osFileUi.shareSheetOpened || !osFileUi.documentsPickerOpened
      ? "fail" : inAppProof?.status === "blocked" ? "blocked" : "incomplete",
    sqlite: inAppProof?.sqlite ?? baseReport.sqlite,
    projectRoundTrip: inAppProof?.projectRoundTrip ?? baseReport.projectRoundTrip,
    zipRoundTrip: inAppProof?.zipRoundTrip ?? baseReport.zipRoundTrip,
    osFileUi,
    checklist: inAppProof?.checklist
      ? {
        ...inAppProof.checklist,
        zipExportImport: {
          ...inAppProof.checklist.zipExportImport,
          evidence: `${inAppProof.checklist.zipExportImport.evidence} ${osFileUi.shareSheetOpened && osFileUi.documentsPickerOpened
            ? "Android share sheet and DocumentsUI picker evidence captured by adb/UIAutomator."
            : "OS file UI proof is incomplete; see osFileUi evidence."}`,
        },
      }
      : baseReport.checklist,
    evidence: {
      ...baseReport.evidence,
      logExcerptPath,
      notes: [
        inAppProof ? "In-app native SQLite/archive proof marker was collected from logcat." : "In-app native SQLite/archive proof marker was not found in logcat.",
        osFileUi.shareSheetOpened ? "OS share-sheet evidence captured." : "OS share-sheet evidence missing.",
        osFileUi.documentsPickerOpened ? "DocumentsUI picker evidence captured." : "DocumentsUI picker evidence missing.",
        typeof inAppProof?.error === "string" ? `In-app proof error: ${inAppProof.error}` : "",
        ...osFileUiNotes,
      ].filter(Boolean).join(" "),
    },
  };

  try {
    const parsed = parseAndroidNativeVerificationReport(report);
    report.status = androidNativeVerificationStatus(parsed);
    const errors = androidNativeVerificationCompletionErrors(parsed);
    if (errors.length > 0) report.evidence.notes = `${report.evidence.notes} Completion requirements: ${errors.join("; ")}`;
  } catch (error) {
    report.status = "fail";
    report.evidence.notes = `${report.evidence.notes} Completion parser: ${error instanceof Error ? error.message : String(error)}`;
  }

  writeJsonFile(reportPath, report);
  return { reportPath, status: report.status };
}

interface InAppProofPayload {
  generatedAt?: string;
  status?: string;
  error?: string;
  sqlite?: unknown;
  projectRoundTrip?: unknown;
  zipRoundTrip?: unknown;
  checklist?: {
    cleanInstallOrUpgradePath: unknown;
    backendPanel: unknown;
    saveLoadDelete: unknown;
    zipExportImport: { evidence?: string };
    migrationEvidence: unknown;
  };
}

function captureFailedOsFileUiEvidence(options: {
  adbPath: string;
  serial: string;
  outputDirectory: string;
  generatedAt: string;
  reason: string;
  priorEvidence: ReturnType<typeof failedOsFileUiEvidence>;
}) {
  const timestamp = timestampForFilename(options.generatedAt);
  const failureXmlPath = join(options.outputDirectory, `android-os-file-ui-failure-${timestamp}.xml`);
  const failureScreenshotPath = join(options.outputDirectory, `android-os-file-ui-failure-${timestamp}.png`);
  let xmlPath = "";
  let screenshotPath = "";
  const errors: string[] = [];
  try {
    writeFileSync(failureXmlPath, dumpUiXml(options.adbPath, options.serial), "utf8");
    xmlPath = failureXmlPath;
  } catch (error) { errors.push(`Failure XML capture failed: ${String(error)}`); }
  try {
    captureScreenshot(options.adbPath, options.serial, failureScreenshotPath);
    screenshotPath = failureScreenshotPath;
  } catch (error) { errors.push(`Failure screenshot capture failed: ${String(error)}`); }
  return failedOsFileUiEvidence({
    reason: `${options.reason} ${options.priorEvidence.documentsPickerEvidence} ${errors.join(" ")}`,
    outputDirectory: options.outputDirectory,
    generatedAt: options.generatedAt,
    xmlPath,
    screenshotPath,
    pushedZipPath: options.priorEvidence.pushedZipPath,
  });
}

function failedOsFileUiEvidence(options: {
  reason: string;
  outputDirectory: string;
  generatedAt: string;
  xmlPath?: string;
  screenshotPath?: string;
  pushedZipPath?: string;
}) {
  const xmlPath = options.xmlPath ?? "";
  const screenshotPath = options.screenshotPath ?? "";
  return {
    shareSheetOpened: false,
    shareSheetEvidence: `Android resolver/share sheet proof was not completed. ${options.reason}`,
    shareSheetScreenshotPath: screenshotPath,
    shareSheetXmlPath: xmlPath,
    documentsPickerOpened: false,
    documentsPickerEvidence: `Android DocumentsUI picker proof was not completed. ${options.reason}`,
    documentsPickerScreenshotPath: screenshotPath,
    documentsPickerXmlPath: xmlPath,
    pushedZipPath: options.pushedZipPath ?? "",
    selectedZipFilename: "",
    selectedZipBytes: 0,
  };
}

interface OsFileUiOptions {
  adbPath: string;
  serial: string;
  packageName: string;
  outputDirectory: string;
  generatedAt: string;
  evidence: ReturnType<typeof failedOsFileUiEvidence>;
}

export interface OsFileUiIo {
  createZip: () => ReturnType<typeof createPickerProofZip>;
  pushZip: (localPath: string, pushedPath: string) => void;
  bootstrap: () => Promise<void>;
  navigateToFiles: () => Promise<void>;
  readUi: () => string;
  captureUi: (xml: string, label: string) => { xmlPath: string; screenshotPath: string };
  tapAction: (matchers: NodeMatcher[]) => Promise<void>;
  sendTap: (x: number, y: number) => boolean;
  waitForUi: (predicate: (xml: string) => boolean, waitMs: number) => Promise<string>;
}

function androidOsFileUiIo(options: OsFileUiOptions): OsFileUiIo {
  return {
    createZip: () => createPickerProofZip(options.outputDirectory),
    pushZip: (localPath, pushedPath) => { runAdb(options.adbPath, ["-s", options.serial, "push", localPath, pushedPath], "text"); },
    bootstrap: () => bootstrapProject(options.adbPath, options.serial, options.packageName),
    navigateToFiles: () => navigateToFiles(options.adbPath, options.serial, options.packageName),
    readUi: () => dumpUiXml(options.adbPath, options.serial),
    captureUi: (xml, label) => captureUiEvidence(options, xml, label),
    tapAction: (matchers) => tapFirstUiNode(options.adbPath, options.serial, matchers, options.packageName),
    sendTap: (x, y) => {
      runAdb(options.adbPath, ["-s", options.serial, "shell", "input", "tap", String(x), String(y)], "text");
      return true;
    },
    waitForUi: (predicate, waitMs) => waitForUiXml(options.adbPath, options.serial, predicate, waitMs),
  };
}

export async function collectOsFileUiEvidence(options: OsFileUiOptions, io: OsFileUiIo = androidOsFileUiIo(options)) {
  const zip = io.createZip();
  const pushedZipPath = `/sdcard/Download/${zip.filename}`;
  io.pushZip(zip.localPath, pushedZipPath);
  const attemptOptions = { filename: zip.filename, hostBytes: zip.bytes, pushedZipPath };
  Object.assign(options.evidence, pickerAttemptEvidence({ ...attemptOptions, tap: { attempted: false, commandSucceeded: false } }));

  const beforeBootstrapXml = io.readUi();
  io.captureUi(beforeBootstrapXml, "android-before-bootstrap");
  rejectExistingFixture(beforeBootstrapXml, options.packageName, zip.projectName);
  await io.bootstrap();
  await io.navigateToFiles();
  const beforeImportXml = io.readUi();
  io.captureUi(beforeImportXml, "android-before-import");
  rejectExistingFixture(beforeImportXml, options.packageName, zip.projectName);
  if (!isFilesUiReady(beforeImportXml, options.packageName)) throw new Error("Fresh Files import controls unavailable; import and export skipped.");
  await io.tapAction(appIds(options.packageName, "files-action-import-zip"));
  const pickerXml = await io.waitForUi(isDocumentsPickerXml, 10000);
  const pickerCapture = io.captureUi(pickerXml, "android-documents-picker");
  Object.assign(options.evidence, {
    documentsPickerOpened: true,
    documentsPickerXmlPath: pickerCapture.xmlPath,
    documentsPickerScreenshotPath: pickerCapture.screenshotPath,
  });
  const tap = attemptUiTap(findPickerFileNode(pickerXml, zip.filename), io.sendTap);
  Object.assign(options.evidence, pickerAttemptEvidence({ ...attemptOptions, tap }));
  if (!tap.commandSucceeded) {
    throw new Error(tap.attempted
      ? "DocumentsUI file tap command failed; native file receipt is unknown."
      : "Supported DocumentsUI picker did not expose an enabled, in-bounds exact fixture row. Manual picker navigation was skipped; no file was selected by this collector.");
  }

  const loadedXml = await io.waitForUi(
    (xml) => isExpectedProjectLoaded(xml, options.packageName, zip.projectName), 15000);
  io.captureUi(loadedXml, "android-imported-project");
  options.evidence.documentsPickerEvidence += " A fresh app UI displayed the expected synthetic project name; this is not a native file receipt event.";
  await io.navigateToFiles();
  const filesXml = io.readUi();
  if (!isFilesUiReady(filesXml, options.packageName) || !isExpectedProjectLoaded(filesXml, options.packageName, zip.projectName)) {
    throw new Error("Expected synthetic project is not freshly visible in the ready Files view; export skipped.");
  }
  await io.tapAction(appIds(options.packageName, "files-action-export-zip"));
  const shareXml = await io.waitForUi(isShareSheetXml, 8000);
  const shareCapture = io.captureUi(shareXml, "android-share-sheet");
  Object.assign(options.evidence, {
    shareSheetOpened: true,
    shareSheetEvidence: "Historical Samsung chooser profile (20260605 captures) matched after exporting the UI-loaded synthetic project. This does not establish a current-device generic chooser profile or receiving-app delivery.",
    shareSheetXmlPath: shareCapture.xmlPath,
    shareSheetScreenshotPath: shareCapture.screenshotPath,
  });
  // Leave the captured sheet in place. Native session cleanup belongs to the coordinator.
  return options.evidence;
}

function rejectExistingFixture(xml: string, packageName: string, projectName: string): void {
  if (!parseAndroidUiXml(xml) || hasBlockingAndroidUi(xml)) throw new Error("Invalid UI or Android error/ANR overlay before import; no dismissal, import, or export attempted.");
  if (hasProjectBreadcrumb(xml, packageName, projectName)) {
    throw new Error("Expected fixture breadcrumb was already present before import; this run cannot establish a fresh import. Import and export skipped.");
  }
}

function captureUiEvidence(options: { adbPath: string; serial: string; outputDirectory: string; generatedAt: string }, xml: string, label: string) {
  const stem = join(options.outputDirectory, `${label}-${timestampForFilename(options.generatedAt)}`);
  writeFileSync(`${stem}.xml`, xml, "utf8");
  captureScreenshot(options.adbPath, options.serial, `${stem}.png`);
  // Detect UI transitions between the XML and screenshot before any tap.
  if (dumpUiXml(options.adbPath, options.serial) !== xml) throw new Error(`UI changed during ${label} capture; evidence pair is unqualified and no tap was sent.`);
  return { xmlPath: `${stem}.xml`, screenshotPath: `${stem}.png` };
}

function appIds(packageName: string, id: string): NodeMatcher[] {
  return [id, `${packageName}:id/${id}`].map((value) => ({ attr: "resource-id", value, mode: "equals" }));
}

async function bootstrapProject(adbPath: string, serial: string, packageName: string): Promise<void> {
  const xml = dumpUiXml(adbPath, serial);
  if (hasBlockingAndroidUi(xml)) throw new Error("Android error/ANR overlay detected; automatic dismissal is prohibited.");
  if (isFilesUiReady(xml, packageName)) return;
  // The current home catalog intentionally has no Files actions until a project is open.
  if (!isProjectCatalogUi(xml, packageName)) return;
  try {
    await tapFirstUiNode(adbPath, serial, appIds(packageName, "command-menu-file"), packageName);
    await tapFirstUiNode(adbPath, serial, appIds(packageName, "command-file-blank-design"), packageName);
  } catch (error) {
    throw new Error(`No Project Open prerequisite: known File > Start Blank Design bootstrap unavailable. Manual sample/blank setup was skipped; Files import/export cannot be qualified. ${String(error)}`);
  }
}

async function navigateToFiles(adbPath: string, serial: string, packageName: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const xml = dumpUiXml(adbPath, serial);
    if (hasBlockingAndroidUi(xml)) throw new Error("Android error/ANR overlay detected; automatic dismissal is prohibited.");
    if (isFilesUiReady(xml, packageName)) return;
    if (findNode(xml, [{ attr: "text", value: "No Project Open", mode: "equals" }], packageName)) {
      throw new Error("No Project Open prerequisite: Files controls are unavailable. Manual sample/blank setup was skipped after the bounded bootstrap; import/export was not attempted.");
    }
    if (tapNodeFromXml(adbPath, serial, xml, appIds(packageName, "workspace-nav-files"), packageName)) {
      await wait(1000);
      continue;
    }
    if (tapNodeFromXml(adbPath, serial, xml, appIds(packageName, "command-menu-view"), packageName)) {
      await wait(500);
      const menuXml = dumpUiXml(adbPath, serial);
      tapNodeFromXml(adbPath, serial, menuXml, appIds(packageName, "command-view-files"), packageName);
      await wait(1000);
    }
  }
  const xml = dumpUiXml(adbPath, serial);
  if (!isFilesUiReady(xml, packageName)) {
    throw new Error("Could not reach enabled CPLayout Files import/export controls. No Project Open may require manual sample/blank setup, which this bounded collector skipped.");
  }
}

async function tapFirstUiNode(adbPath: string, serial: string, matchers: NodeMatcher[], packageName: string): Promise<void> {
  const xml = await waitForUiXml(adbPath, serial, (candidate) => Boolean(findNode(candidate, matchers, packageName)), 8000);
  if (!tapNodeFromXml(adbPath, serial, xml, matchers, packageName)) {
    throw new Error(`Could not tap UI node for ${matchers.map((matcher) => matcher.value).join(" / ")}.`);
  }
  await wait(1200);
}

function tapNodeFromXml(adbPath: string, serial: string, xml: string, matchers: NodeMatcher[], packageName: string): boolean {
  const result = attemptUiTap(findNode(xml, matchers, packageName), (x, y) => {
    runAdb(adbPath, ["-s", serial, "shell", "input", "tap", String(x), String(y)], "text");
    return true;
  });
  if (result.attempted && !result.commandSucceeded) throw new Error("UI tap command failed; no successful action is recorded.");
  return result.commandSucceeded;
}

async function waitForUiXml(
  adbPath: string,
  serial: string,
  predicate: (xml: string) => boolean,
  waitMs: number,
): Promise<string> {
  const deadline = Date.now() + waitMs;
  let lastXml = "";
  while (Date.now() < deadline) {
    lastXml = dumpUiXml(adbPath, serial);
    if (!parseAndroidUiXml(lastXml)) throw new Error("Malformed or unsupported UIAutomator XML; UI evidence rejected.");
    if (hasBlockingAndroidUi(lastXml)) throw new Error("Android error/ANR overlay detected; automatic dismissal is prohibited.");
    if (predicate(lastXml)) return lastXml;
    await wait(500);
  }
  throw new Error(`Timed out after ${waitMs} ms waiting for supported fresh UI evidence.`);
}

function dumpUiXml(adbPath: string, serial: string): string {
  const remotePath = `/sdcard/window-cplayout-proof-${randomUUID()}.xml`;
  try {
    return readConfirmedUiDump(remotePath,
      () => runAdb(adbPath, ["-s", serial, "shell", "uiautomator", "dump", remotePath], "text"),
      () => runAdb(adbPath, ["-s", serial, "exec-out", "cat", remotePath], "text"));
  } finally {
    runAdb(adbPath, ["-s", serial, "shell", "rm", "-f", remotePath], "text", false);
  }
}

async function waitForInAppProof(adbPath: string, serial: string, waitMs: number): Promise<InAppProofPayload | null> {
  const deadline = Date.now() + waitMs;
  let payload: InAppProofPayload | null = null;
  while (Date.now() < deadline) {
    const logcat = runAdb(adbPath, ["-s", serial, "logcat", "-d"], "text", false);
    payload = parseInAppProofPayload(String(logcat));
    if (payload) return payload;
    await wait(1000);
  }
  return payload;
}

function parseInAppProofPayload(logcat: string): InAppProofPayload | null {
  const lines = logcat.split(/\r?\n/).filter((line) => line.includes(ANDROID_NATIVE_IN_APP_PROOF_LOG_MARKER));
  const line = lines.at(-1);
  if (!line) return null;
  const jsonStart = line.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    return JSON.parse(line.slice(jsonStart)) as InAppProofPayload;
  } catch {
    return null;
  }
}

function createPickerProofZip(outputDir: string): { filename: string; localPath: string; bytes: number; projectName: string } {
  const nonce = randomUUID();
  const project: PivotProject = {
    ...sampleProject,
    id: `cplayout-android-documents-picker-proof-${nonce}`,
    name: `CPLayout Picker Proof ${nonce}`,
  };
  const result = evaluateLayout(project);
  const zip = exportProjectArchiveZip(buildProjectArchiveBundle(project, result, exportScenarioGeoJson(project, result)));
  const filename = `cplayout-android-native-proof-${nonce}.center-pivot.zip`;
  const localPath = join(outputDir, filename);
  writeFileSync(localPath, zip);
  return { filename, localPath, bytes: zip.byteLength, projectName: project.name };
}

function captureScreenshot(adbPath: string, serial: string, outputPath: string): void {
  const png = runAdb(adbPath, ["-s", serial, "exec-out", "screencap", "-p"], "buffer");
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Screenshot command did not return a PNG.");
  writeFileSync(outputPath, png);
}

function writeCollectLogExcerpt(adbPath: string, serial: string, outputDir: string, generatedAt: string): string {
  const log = runAdb(adbPath, ["-s", serial, "logcat", "-d", "-t", "1000"], "text", false);
  const path = join(outputDir, `android-native-proof-logcat-${timestampForFilename(generatedAt)}.txt`);
  writeFileSync(path, String(log), "utf8");
  return path;
}

function reverseDevClientPorts(adbPath: string, serial: string, devClientUrl: string): void {
  for (const port of localhostPortsFromText(devClientUrl)) {
    runAdb(adbPath, ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`], "text", false);
  }
}

function launchPackage(adbPath: string, serial: string, packageName: string, devClientUrl: string): void {
  if (devClientUrl) {
    const launched = runAdb(adbPath, ["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", devClientUrl, packageName], "text", false);
    if (launched.trim() && !/Error|Exception|not exist|does not exist/i.test(launched)) return;
  }
  const activity = runAdb(adbPath, ["-s", serial, "shell", "am", "start", "-n", `${packageName}/.MainActivity`], "text", false);
  if (typeof activity === "string" && /Error|Exception|not exist|does not exist/i.test(activity)) {
    runAdb(adbPath, ["-s", serial, "shell", "monkey", "-p", packageName, "1"], "text", false);
  }
}

function localhostPortsFromText(value: string): number[] {
  const ports = new Set<number>();
  for (const text of [value, decodeUrlComponent(value)]) {
    for (const match of text.matchAll(/(?:127\.0\.0\.1|localhost):(\d{2,5})/g)) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port <= 65535) ports.add(port);
    }
  }
  return [...ports];
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function runAdb(adbPath: string, adbArgs: string[], output: "text", throwOnFailure?: boolean): string;
function runAdb(adbPath: string, adbArgs: string[], output: "buffer", throwOnFailure?: boolean): Buffer;
function runAdb(adbPath: string, adbArgs: string[], output: "text" | "buffer" = "text", throwOnFailure = true): string | Buffer {
  const result = spawnSync(adbPath, adbArgs, {
    encoding: output === "text" ? "utf8" : undefined,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 15000,
    killSignal: "SIGKILL",
  });
  if (result.error || result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
    if (throwOnFailure) throw new Error(`adb ${adbArgs.join(" ")} failed with exit code ${result.status ?? "unknown"}: ${stderr} ${result.error?.message ?? ""}`);
    return output === "text" ? "" : Buffer.alloc(0);
  }
  return output === "text" ? String(result.stdout ?? "") : Buffer.from(result.stdout ?? []);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function valueFor(rawArgs: string[], name: string): string | undefined {
  const index = rawArgs.indexOf(name);
  if (index >= 0) return rawArgs[index + 1];
  return rawArgs.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}
