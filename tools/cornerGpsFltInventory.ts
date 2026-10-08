import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export interface InventoryRoot {
  id: string;
  label: string;
  localPath: string;
  role: "install" | "data";
  maxDepth: number;
}

export interface InventoryArtifact {
  rootId: string;
  redactedPath: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
}

export interface InventoryReport {
  schemaVersion: "cplayout-cornergps-flt-inventory-v1";
  generatedAt: string;
  outputDir: string;
  boundaries: {
    redacted: true;
    rawCustomerFilesCommitted: false;
    credentialsCommitted: false;
    controllerCompatibilityClaimed: false;
  };
  roots: Array<{
    id: string;
    label: string;
    role: "install" | "data";
    exists: boolean;
  }>;
  artifacts: InventoryArtifact[];
  supportedFileTypeCounts: Record<string, number>;
  skipped: Array<{ rootId: string; redactedPath: string; reason: string }>;
  warnings: string[];
}

export interface InventorySummary {
  schemaVersion: "cplayout-cornergps-flt-inventory-summary-v1";
  generatedAt: string;
  dryRun: boolean;
  boundaries: InventoryReport["boundaries"];
  roots: InventoryReport["roots"];
  artifactCount: number;
  artifactExtensionCounts: Record<string, number>;
  artifactRootRoleCounts: Record<InventoryRoot["role"], number>;
  supportedFileTypeCounts: Record<string, number>;
  skippedCount: number;
  warningCount: number;
  warnings: string[];
}

export interface InventoryBuildOptions {
  roots?: InventoryRoot[];
  includeInstallArtifactHashes?: boolean;
}

export const DEFAULT_ROOTS: InventoryRoot[] = [
  {
    id: "valley-flt-4-4-4",
    label: "Valley FLT 4.4.4 install",
    localPath: "/mnt/c/Program Files (x86)/Valmont/Valley FLT 4.4.4",
    role: "install",
    maxDepth: 6,
  },
  {
    id: "corner-gps-mapping-1-0-0-0",
    label: "Corner GPS Mapping 1.0.0.0 install",
    localPath: "/mnt/c/Valmont/Service Tools Suite/Common Service Tools/GPS Mapping/1.0.0.0",
    role: "install",
    maxDepth: 6,
  },
  {
    id: "valmont-service-tools-common",
    label: "Valmont Common Service Tools local data",
    localPath: "/mnt/c/Valmont/Service Tools Suite/Common Service Tools",
    role: "data",
    maxDepth: 4,
  },
  {
    id: "valmont-flt-data",
    label: "Valmont FLT local data",
    localPath: "/mnt/c/Valmont/FLT/Data",
    role: "data",
    maxDepth: 5,
  },
];

const HASHED_EXTENSIONS = new Set([
  ".config",
  ".dll",
  ".exe",
  ".ini",
  ".json",
  ".manifest",
  ".settings",
  ".txt",
  ".xml",
  ".xsd",
]);

const COUNTED_EXTENSIONS = new Set([
  ".bpf",
  ".csv",
  ".ggs",
  ".gps",
  ".kml",
  ".kmz",
  ".opt",
  ".out",
  ".path",
  ".vri",
]);

const MAX_HASH_BYTES = 100 * 1024 * 1024;

export function buildCornerGpsFltInventoryReport(generatedAt = new Date().toISOString(), options: InventoryBuildOptions = {}): InventoryReport {
  const roots = options.roots ?? DEFAULT_ROOTS;
  const includeInstallArtifactHashes = options.includeInstallArtifactHashes ?? true;
  const timestamp = generatedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const outputDir = join("reports", "cornergps-flt-inventory", timestamp);
  const artifacts: InventoryArtifact[] = [];
  const supportedFileTypeCounts: Record<string, number> = {};
  const skipped: InventoryReport["skipped"] = [];
  const warnings: string[] = [];

  for (const root of roots) {
    if (!existsSync(root.localPath)) continue;
    walkRoot(root, root.localPath, 0, artifacts, supportedFileTypeCounts, skipped, { includeInstallArtifactHashes });
  }

  if (artifacts.length === 0) {
    warnings.push("No executable/config artifacts were found under the known FLT/CornerGPSMap paths on this machine.");
  }

  return {
    schemaVersion: "cplayout-cornergps-flt-inventory-v1",
    generatedAt,
    outputDir,
    boundaries: {
      redacted: true,
      rawCustomerFilesCommitted: false,
      credentialsCommitted: false,
      controllerCompatibilityClaimed: false,
    },
    roots: roots.map((root) => ({
      id: root.id,
      label: root.label,
      role: root.role,
      exists: existsSync(root.localPath),
    })),
    artifacts: artifacts.sort((a, b) => a.redactedPath.localeCompare(b.redactedPath)),
    supportedFileTypeCounts: sortCounts(supportedFileTypeCounts),
    skipped,
    warnings,
  };
}

export function buildCornerGpsFltInventorySummary(report: InventoryReport, dryRun = false): InventorySummary {
  const rootRoles = new Map(report.roots.map((root) => [root.id, root.role]));
  const artifactExtensionCounts: Record<string, number> = {};
  const artifactRootRoleCounts: Record<InventoryRoot["role"], number> = { install: 0, data: 0 };
  for (const artifact of report.artifacts) {
    artifactExtensionCounts[artifact.extension] = (artifactExtensionCounts[artifact.extension] ?? 0) + 1;
    const role = rootRoles.get(artifact.rootId) ?? "install";
    artifactRootRoleCounts[role] += 1;
  }
  return {
    schemaVersion: "cplayout-cornergps-flt-inventory-summary-v1",
    generatedAt: report.generatedAt,
    dryRun,
    boundaries: report.boundaries,
    roots: report.roots,
    artifactCount: report.artifacts.length,
    artifactExtensionCounts: sortCounts(artifactExtensionCounts),
    artifactRootRoleCounts,
    supportedFileTypeCounts: report.supportedFileTypeCounts,
    skippedCount: report.skipped.length,
    warningCount: report.warnings.length,
    warnings: report.warnings,
  };
}

export function writeCornerGpsFltInventoryReport(report: InventoryReport): { manifestPath: string; readmePath: string } {
  mkdirSync(report.outputDir, { recursive: true });
  const manifestPath = join(report.outputDir, "manifest.json");
  const readmePath = join(report.outputDir, "README.md");
  writeFileSync(manifestPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(readmePath, readmeFor(report));
  return { manifestPath, readmePath };
}

function walkRoot(
  root: InventoryRoot,
  currentPath: string,
  depth: number,
  artifacts: InventoryArtifact[],
  supportedFileTypeCounts: Record<string, number>,
  skipped: InventoryReport["skipped"],
  options: Required<Pick<InventoryBuildOptions, "includeInstallArtifactHashes">>,
): void {
  if (depth > root.maxDepth) return;
  let entries: string[];
  try {
    entries = readdirSync(currentPath);
  } catch {
    skipped.push({ rootId: root.id, redactedPath: diagnosticPath(root, currentPath), reason: "Directory could not be read." });
    return;
  }

  for (const entry of entries) {
    const path = join(currentPath, entry);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      skipped.push({ rootId: root.id, redactedPath: diagnosticPath(root, path), reason: "Path could not be statted." });
      continue;
    }
    if (stat.isDirectory()) {
      walkRoot(root, path, depth + 1, artifacts, supportedFileTypeCounts, skipped, options);
      continue;
    }
    if (!stat.isFile()) continue;

    const extension = extensionOf(entry);
    if (COUNTED_EXTENSIONS.has(extension)) {
      supportedFileTypeCounts[extension] = (supportedFileTypeCounts[extension] ?? 0) + 1;
    }
    if (!HASHED_EXTENSIONS.has(extension)) continue;
    if (root.role !== "install" || !options.includeInstallArtifactHashes) continue;
    if (stat.size > MAX_HASH_BYTES) {
      skipped.push({ rootId: root.id, redactedPath: redactedPath(root, path), reason: "Artifact exceeded hash size limit." });
      continue;
    }
    artifacts.push({
      rootId: root.id,
      redactedPath: redactedPath(root, path),
      extension,
      sizeBytes: stat.size,
      sha256: sha256File(path),
    });
  }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function redactedPath(root: InventoryRoot, path: string): string {
  const relativePath = relative(root.localPath, path).replace(/\\/g, "/");
  return relativePath && relativePath !== "." ? `${root.id}:/${relativePath}` : `${root.id}:/`;
}

function diagnosticPath(root: InventoryRoot, path: string): string {
  // Failed reads are still private evidence. In particular, a dangling exchange
  // symlink must not reveal the customer filename through an error record.
  if (root.role === "data") return `${root.id}:/[unreadable-data-entry]`;
  if (COUNTED_EXTENSIONS.has(extensionOf(path))) return `${root.id}:/[unreadable-exchange-entry]`;
  return redactedPath(root, path);
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index).toLowerCase() : "";
}

function sortCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function readmeFor(report: InventoryReport): string {
  const rootRows = report.roots
    .map((root) => `| ${root.id} | ${root.role} | ${root.exists ? "yes" : "no"} |`)
    .join("\n");
  const countRows = Object.entries(report.supportedFileTypeCounts)
    .map(([extension, count]) => `| ${extension} | ${count} |`)
    .join("\n") || "| none | 0 |";
  return `# CornerGPSMap / FLT Redacted Inventory

Generated: ${report.generatedAt}

This report is redacted. It hashes executable/config artifacts and counts supported legacy exchange extensions only. It does not include raw BPF/KML/KMZ/CSV/VRI/OPT/OUT/GGS/PATH/GPS contents, local customer paths, coordinates, credentials, cloud endpoints, or controller-ready compatibility claims.

## Roots

| Root | Role | Exists |
| --- | --- | --- |
${rootRows}

## Supported File Type Counts

| Extension | Count |
| --- | ---: |
${countRows}

## Artifact Hashes

See \`manifest.json\` for redacted artifact paths and SHA-256 hashes. Keep generated reports under \`reports/cornergps-flt-inventory/\`; do not commit raw local customer artifacts.
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const summary = args.has("--summary");
  const json = args.has("--json");
  const report = buildCornerGpsFltInventoryReport();
  if (summary || dryRun) {
    const output = buildCornerGpsFltInventorySummary(report, dryRun);
    if (json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(summaryText(output));
    }
  }
  if (!dryRun) {
    const paths = writeCornerGpsFltInventoryReport(report);
    console.log(`Wrote ${paths.manifestPath}`);
    console.log(`Wrote ${paths.readmePath}`);
  }
}

function summaryText(summary: InventorySummary): string {
  return [
    `CornerGPSMap / FLT inventory summary (${summary.generatedAt})`,
    `dryRun=${summary.dryRun}`,
    `roots=${summary.roots.length}`,
    `artifacts=${summary.artifactCount}`,
    `supportedExchangeCounts=${JSON.stringify(summary.supportedFileTypeCounts)}`,
    `skipped=${summary.skippedCount}`,
    `warnings=${summary.warningCount}`,
  ].join("\n");
}
