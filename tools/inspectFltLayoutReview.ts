import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseFltLayoutReview } from "../packages/core/src/fltLayoutReview";

const MAX_BYTES = 16 * 1024 * 1024;

function readArtifact(path: string): { text: string; sha256: string; sizeBytes: number } {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Unsupported artifact size or type.");
  const bytes = readFileSync(path);
  if (bytes.length > MAX_BYTES) throw new Error("Artifact grew beyond the reader limit.");
  return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length };
}

/** Local review only: neither file proximity nor a supplied pair proves OEM provenance. */
export function inspectFltLayoutReview(csvPath: string, outPath?: string) {
  const csv = readArtifact(csvPath);
  const out = outPath === undefined ? undefined : readArtifact(outPath);
  const result = parseFltLayoutReview(csv.text, out?.text);
  return {
    schemaVersion: "cplayout-flt-review-inspection-v1" as const,
    sources: {
      csv: { sha256: csv.sha256, sizeBytes: csv.sizeBytes },
      out: out ? { sha256: out.sha256, sizeBytes: out.sizeBytes } : null,
      pairing: "caller_supplied_unverified" as const,
    },
    status: result.status, csvStatus: result.csvStatus, outStatus: result.outStatus,
    summary: result.summary, coordinates: result.coordinates, closure: result.closure,
    diagnostics: result.diagnostics,
    controllerFileAssociation: "unverified" as const,
    qualifiedTrajectory: false as const,
  };
}

export function runFltLayoutInspection(args: string[], emit: (text: string) => void): number {
  if (args.length === 1 && args[0] === "--help") {
    emit("Usage: tsx tools/inspectFltLayoutReview.ts <Layout.csv> [Layout.out]\nReads local files and prints a redacted evidence summary. No geometry or controller import.");
    return 0;
  }
  if (args.length < 1 || args.length > 2 || args.some(arg => arg.startsWith("--"))) {
    emit(JSON.stringify({ error: "Expected one CSV path and an optional paired OUT path." }));
    return 64;
  }
  try {
    const evidence = inspectFltLayoutReview(args[0], args[1]);
    emit(JSON.stringify(evidence, null, 2));
    // A successful inspection is not a successful trajectory. Nonzero makes that
    // distinction visible to shell callers as well as the explicit JSON verdict.
    return evidence.status === "constraint_violated" ? 2 : 3;
  } catch {
    emit(JSON.stringify({ error: "Local evidence could not be read as bounded UTF-8 regular files.", status: "missing_evidence" }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runFltLayoutInspection(process.argv.slice(2), text => process.stdout.write(`${text}\n`));
}
