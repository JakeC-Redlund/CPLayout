import { readZipArchive, type ZipArchiveOptions } from "./zipArchive";
import { decodeUtf8Strict } from "./utf8";

export interface ZipTextArchiveOptions extends Pick<ZipArchiveOptions,
  "label" | "maxCompressedBytes" | "maxEntryBytes" | "maxUncompressedBytes" | "maxFileCount"> {
  allowedFilenames: ReadonlySet<string>;
  requiredFilenames: readonly string[];
}

/** Project/draft policy remains regular text files only; KMZ binary assets use the container reader. */
export function readZipTextArchive(bytes: Uint8Array, options: ZipTextArchiveOptions): Map<string, string> {
  return new Map([...readZipArchive(bytes, options)].map(([name, data]) => [name, decodeUtf8Strict(data, options.label)]));
}
