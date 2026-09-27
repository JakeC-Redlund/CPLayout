import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ReceiverStreamDecoder } from "../packages/gnss/src/receiverStream";
import { parseNmeaSentence } from "../packages/gnss/src/nmea";
import { parsePx1122rPsti030, type Px1122rPsti030Diagnostic } from "../packages/gnss/src/px1122r";
import { decodeNavsparkRawPayload, type NavsparkRawPayload } from "../packages/gnss/src/navsparkRaw";

export const MAX_RECEIVER_LOG_BYTES = 64 * 1024 * 1024;
export type ReceiverLogProfile = "px1122r" | "ns-raw";

/** Offline diagnostics only; file order does not provide live reception timing. */
export async function inspectReceiverLog(chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, profile: ReceiverLogProfile) {
  if (profile !== "px1122r" && profile !== "ns-raw") throw new Error("Select px1122r or ns-raw explicitly.");
  const decoder = new ReceiverStreamDecoder();
  const hash = createHash("sha256");
  const nmeaSentenceCounts: Record<string, number> = {};
  let unknownTextFrames = 0;
  const binaryMessageCounts: Record<string, number> = {};
  const rawKindCounts = { DC: 0, DD: 0, unknown: 0, invalid: 0 };
  let bytesRead = 0, rejectedTextLines = 0, psti030Count = 0, rejectedPsti030 = 0;
  let lastPsti030: Px1122rPsti030Diagnostic | null = null;
  let lastRaw: Omit<NavsparkRawPayload, "rawPayload"> | null = null;
  for await (const bytes of chunks) {
    bytesRead += bytes.byteLength;
    if (bytesRead > MAX_RECEIVER_LOG_BYTES) throw new Error("Receiver log exceeds the 64 MiB inspection limit.");
    hash.update(bytes);
    // Constant synthetic clock deliberately disables real-time freshness claims on offline bytes.
    const result = decoder.push(bytes, { receivedAt: "2000-01-01T00:00:00.000Z", receivedMonotonicMs: 0 });
    rejectedTextLines += result.rejectedTextLines;
    for (const { sentence } of result.diagnosticTextFrames) {
      const sample = parseNmeaSentence(sentence);
      const psti030 = /^\$PSTI,030(?:,|\*)/.test(sentence);
      if (sample && !sentence.startsWith("$P") && ["GGA", "GST", "RMC", "GSA"].includes(sample.sentenceType)) {
        nmeaSentenceCounts[sample.sentenceType] = (nmeaSentenceCounts[sample.sentenceType] ?? 0) + 1;
      } else if (!(profile === "px1122r" && psti030)) unknownTextFrames += 1;
      if (profile === "px1122r" && psti030) {
        const diagnostic = parsePx1122rPsti030(sentence);
        if (diagnostic) { psti030Count += 1; lastPsti030 = diagnostic; }
        else rejectedPsti030 += 1;
      }
    }
    for (const payload of result.binaryPayloads) {
      const id = payload[0].toString(16).padStart(2, "0");
      binaryMessageCounts[id] = (binaryMessageCounts[id] ?? 0) + 1;
      if (profile === "ns-raw") {
        const decoded = decodeNavsparkRawPayload(payload);
        rawKindCounts[decoded.kind] += 1;
        const { rawPayload: _rawPayload, ...diagnostic } = decoded;
        // Unknown payloads can be 64 KiB. Retain counters and identity, not raw recordings in JSON.
        lastRaw = diagnostic;
      }
    }
  }
  const stream = decoder.finish();
  const recognized = Object.values(nmeaSentenceCounts).reduce((sum, count) => sum + count, 0)
    + psti030Count + rawKindCounts.DC + rawKindCounts.DD;
  const status = !stream.complete || rejectedTextLines > 0 || rejectedPsti030 > 0 || rawKindCounts.invalid > 0
    ? "rejected" : recognized === 0 ? "unsupported" : "inspected";
  return {
    schemaVersion: "cplayout-receiver-log-inspection-v1",
    profile, status, bytesRead, sha256: hash.digest("hex"),
    boundaries: {
      diagnosticOnly: true, collectionEligible: false, physicalQualification: "unverified",
      receiverIdentity: "unverified", epochCoherence: "unverified", receptionTiming: "unavailable_in_file",
      solverExecuted: false, hardwareAccessed: false,
    },
    stream, rejectedTextLines, unknownTextFrames, nmeaSentenceCounts, binaryMessageCounts,
    px1122r: { psti030Count, rejectedPsti030, lastPsti030 },
    nsRaw: { rawKindCounts, lastRaw },
  };
}

export async function inspectReceiverFile(path: string, profile: ReceiverLogProfile) {
  const before = await lstat(path);
  if (!before.isFile()) throw new Error("Inspection accepts a regular recording file, not a device, symlink or pipe.");
  // Nonblocking open avoids waiting on a named pipe before checking the descriptor's file type.
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev) throw new Error("Recording file changed during open.");
    if (stat.size > MAX_RECEIVER_LOG_BYTES) throw new Error("Receiver log exceeds the 64 MiB inspection limit.");
    return await inspectReceiverLog(file.createReadStream({ autoClose: false, highWaterMark: 16384 }), profile);
  } finally {
    await file.close();
  }
}

async function main(args: string[]) {
  if (args.length !== 3 || args[0] !== "--profile" || (args[1] !== "px1122r" && args[1] !== "ns-raw")) {
    throw new Error("Usage: npm run gnss:inspect -- --profile px1122r|ns-raw <recording-file>");
  }
  const report = await inspectReceiverFile(args[2], args[1]);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.status === "inspected" ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Receiver log inspection failed.");
    process.exitCode = 2;
  });
}
