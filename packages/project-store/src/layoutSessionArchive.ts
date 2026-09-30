import { strToU8, zipSync } from "fflate";
import { parseLayoutSessionDocument, serializeLayoutSessionDocument, type LayoutSession } from "@cplayout/core";
import { readZipTextArchive } from "./zipTextArchive";

const filenames = ["session.json"];
const budget = 16 * 1024 * 1024;
/** The exact frozen target string and operational observation evidence survive JSON and ZIP. */
export function exportLayoutSessionArchiveZip(session: LayoutSession): Uint8Array {
  const document = strToU8(serializeLayoutSessionDocument(session));
  if (document.byteLength > budget) throw new Error("Layout session exceeds the archive size budget.");
  const bytes = zipSync({ "session.json": document });
  if (bytes.byteLength > budget) throw new Error("Compressed Layout session exceeds the archive size budget.");
  return bytes;
}
export function importLayoutSessionArchiveZip(bytes: Uint8Array): LayoutSession {
  const files = readZipTextArchive(bytes, { label: "Layout session archive", maxCompressedBytes: budget,
    maxEntryBytes: budget, maxUncompressedBytes: budget, maxFileCount: 1,
    allowedFilenames: new Set(filenames), requiredFilenames: filenames });
  return parseLayoutSessionDocument(files.get("session.json")!);
}
