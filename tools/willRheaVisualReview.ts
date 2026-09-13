import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

import { analyzePngPixels } from "./pngMetrics";

interface ScreenshotReview {
  path: string;
  screenshotRole: string;
  sha256: string;
  metrics: ReturnType<typeof analyzePngPixels>;
  ocr: {
    available: boolean;
    text: string;
    forbiddenExistingMachineRadiusText: boolean;
  };
  cvSummary: {
    nonblankPass: boolean;
    nonuniformPass: boolean;
    uiOverlayMaskApplied: false;
    semanticDetectionEligible: false;
    advisoryOnly: true;
    configuration: string;
    notes: string[];
  };
}

interface WillRheaVisualReviewReport {
  projectId: "will-rhea-jason-harmelink-example";
  generatedAt: string;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  googleEarthRenderProof: false;
  buildIdentity: string;
  browserStorageMutation: "not_performed_by_review_tool";
  consoleStatus: string;
  screenshotCount: number;
  sourceFeatureIdsExpectedVisible: string[];
  suppressedFeatureIdsExpectedHidden: string[];
  reviews: ScreenshotReview[];
  warnings: string[];
}

const DEFAULT_OUTPUT_ROOT = "reports/visual-layout-review/will-rhea";
const SOURCE_FEATURE_IDS_EXPECTED_VISIBLE = [
  "will-rhea-lrdu-distance",
  "will-rhea-middle-part-circle-preferred-outline",
  "will-rhea-south-east-circle-preferred-outline",
];
const SUPPRESSED_FEATURE_IDS_EXPECTED_HIDDEN = ["will-rhea-existing-machine-zone"];

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.screenshotPaths.length === 0) {
    throw new Error("Usage: tsx tools/willRheaVisualReview.ts <screenshot.png...> [--output-root <dir>] [--role <role>] [--build-identity <id>] [--console-status <status>] [--cv-config <description>]");
  }

  const generatedAt = new Date().toISOString();
  const runId = generatedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const outputDir = resolve(options.outputRoot, runId);
  mkdirSync(outputDir, { recursive: true });

  const reviews = options.screenshotPaths.map((path) => reviewScreenshot(path, options.screenshotRole, options.cvConfiguration));
  const report: WillRheaVisualReviewReport = {
    projectId: "will-rhea-jason-harmelink-example",
    generatedAt,
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    googleEarthRenderProof: false,
    buildIdentity: options.buildIdentity,
    browserStorageMutation: "not_performed_by_review_tool",
    consoleStatus: options.consoleStatus,
    screenshotCount: reviews.length,
    sourceFeatureIdsExpectedVisible: SOURCE_FEATURE_IDS_EXPECTED_VISIBLE,
    suppressedFeatureIdsExpectedHidden: SUPPRESSED_FEATURE_IDS_EXPECTED_HIDDEN,
    reviews,
    warnings: [
      "This is local screenshot evidence only; it is not Google Earth render proof.",
      "OCR/CV outputs are advisory review evidence and do not mutate projected XY geometry.",
      "Raw screenshots and reports are ignored local artifacts under reports/.",
    ],
  };

  writeFileSync(join(outputDir, "will-rhea-visual-review.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(outputDir, "README.md"), markdownReport(report));
  console.log(`Will Rhea visual review wrote ${outputDir}`);
}

function reviewScreenshot(inputPath: string, screenshotRole: string, cvConfiguration: string): ScreenshotReview {
  const absolutePath = resolve(inputPath);
  if (!existsSync(absolutePath)) throw new Error(`Screenshot does not exist: ${inputPath}`);
  const data = readFileSync(absolutePath);
  const metrics = analyzePngPixels(data);
  const ocr = runTesseract(absolutePath);
  return {
    path: absolutePath,
    screenshotRole,
    sha256: createHash("sha256").update(data).digest("hex"),
    metrics,
    ocr,
    cvSummary: {
      nonblankPass: metrics.nonBlankPixelRatio > 0.05,
      nonuniformPass: metrics.grayVariance > 4,
      uiOverlayMaskApplied: false,
      semanticDetectionEligible: false,
      advisoryOnly: true,
      configuration: cvConfiguration,
      notes: [
        "PNG metrics are a local nonblank/nonuniform proxy, not semantic map understanding.",
        "UI and existing map overlays were not masked by this tool, so line/circle detections would be contaminated and are intentionally not claimed.",
        "Raw imagery with a documented transform or calibrated control points is required before advisory CV candidates are evaluated.",
      ],
    },
  };
}

function runTesseract(path: string): ScreenshotReview["ocr"] {
  const probe = spawnSync("tesseract", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    return {
      available: false,
      text: "",
      forbiddenExistingMachineRadiusText: false,
    };
  }
  const result = spawnSync("tesseract", [path, "stdout"], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  const text = result.status === 0 ? result.stdout : "";
  return {
    available: result.status === 0,
    text,
    forbiddenExistingMachineRadiusText: /Existing machine radius review/i.test(text),
  };
}

function markdownReport(report: WillRheaVisualReviewReport): string {
  return [
    "# Will Rhea Visual Review",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    `Google Earth render proof: ${report.googleEarthRenderProof}`,
    `Canonical geometry mutation: ${report.canonicalGeometryMutation}`,
    `Build identity: ${report.buildIdentity}`,
    `Console status: ${report.consoleStatus}`,
    `Browser storage mutation: ${report.browserStorageMutation}`,
    "",
    "## Expected Visible Evidence",
    ...report.sourceFeatureIdsExpectedVisible.map((id) => `- ${id}`),
    "",
    "## Expected Hidden Generated Evidence",
    ...report.suppressedFeatureIdsExpectedHidden.map((id) => `- ${id}`),
    "",
    "## Screenshots",
    ...report.reviews.map((review) => [
      `- ${basename(review.path)} (${review.screenshotRole}): ${review.metrics.width}x${review.metrics.height}, nonblank ${review.metrics.nonBlankPixelRatio.toFixed(4)}, variance ${review.metrics.grayVariance.toFixed(2)}, OCR ${review.ocr.available ? "available" : "unavailable"}, forbidden radius text ${review.ocr.forbiddenExistingMachineRadiusText}, UI mask ${review.cvSummary.uiOverlayMaskApplied}, semantic CV eligible ${review.cvSummary.semanticDetectionEligible}`,
    ].join("\n")),
    "",
    "## Warnings",
    ...report.warnings.map((warning) => `- ${warning}`),
    "",
  ].join("\n");
}

interface ReviewCliOptions {
  screenshotPaths: string[];
  outputRoot: string;
  screenshotRole: string;
  buildIdentity: string;
  consoleStatus: string;
  cvConfiguration: string;
}

function parseArgs(args: string[]): ReviewCliOptions {
  const screenshotPaths: string[] = [];
  const values = new Map<string, string>();
  const supported = new Set(["--output-root", "--role", "--build-identity", "--console-status", "--cv-config"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      screenshotPaths.push(arg);
      continue;
    }
    if (!supported.has(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
    values.set(arg, value);
    index += 1;
  }
  return {
    screenshotPaths,
    outputRoot: values.get("--output-root") ?? DEFAULT_OUTPUT_ROOT,
    screenshotRole: values.get("--role") ?? "unspecified_review",
    buildIdentity: values.get("--build-identity") ?? currentBuildIdentity(),
    consoleStatus: values.get("--console-status") ?? "not_captured",
    cvConfiguration: values.get("--cv-config") ?? "png_metrics_only_no_ui_mask_no_semantic_detection",
  };
}

function currentBuildIdentity(): string {
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const status = spawnSync("git", ["status", "--short"], { encoding: "utf8" });
  if (revision.status !== 0) return "unavailable";
  return `${revision.stdout.trim()}${status.stdout.trim() ? "+dirty" : "+clean"}`;
}

main();
