import { Inflate, strFromU8, ZipPassThrough } from "fflate";
import { decodeUtf8Strict } from "./utf8";

export interface ZipArchiveOptions {
  label: string;
  maxCompressedBytes: number;
  maxEntryBytes: number;
  maxUncompressedBytes: number;
  maxFileCount: number;
  allowedFilenames?: ReadonlySet<string>;
  requiredFilenames?: readonly string[];
  allowDirectories?: boolean;
  validateEntries?: (names: readonly string[]) => void;
  retainEntry?: (name: string) => boolean;
}

interface ZipEntry {
  name: string;
  version: number;
  flags: number;
  compression: number;
  timestamp: number;
  crc: number;
  size: number;
  originalSize: number;
  localOffset: number;
  dataStart: number;
}

/** Checked ZIP32 entries: bounded expansion, matching records and CRC, including discarded assets.
 * Compression remains fflate's responsibility. CRC is corruption detection, not authentication.
 * Record layouts: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT (4.3 and 4.4).
 */
export function readZipArchive(bytes: Uint8Array, options: ZipArchiveOptions): Map<string, Uint8Array> {
  const requiredFilenames = options.requiredFilenames ?? [];
  const missingRequired = options.maxFileCount === requiredFilenames.length
    ? `must contain exactly ${requiredFilenames.join(" and ")}`
    : `must contain ${requiredFilenames.join(" and ")}`;
  validateCompressedSize(bytes.byteLength);
  const entries = inspectZip(bytes);
  const extracted = new Map<string, Uint8Array>();
  let actualTotal = 0;
  for (const entry of entries) {
    const retain = !entry.name.endsWith("/") && (options.retainEntry?.(entry.name) ?? true);
    const data = retain ? new Uint8Array(entry.originalSize) : null;
    // This public fflate stream computes CRC-32 without compression or retaining another copy.
    const checksum = new ZipPassThrough(entry.name);
    checksum.ondata = (error) => { if (error) throw error; };
    let size = 0;
    let complete = false;
    const receive = (chunk: Uint8Array, final: boolean) => {
      const offset = size;
      size += chunk.byteLength;
      actualTotal += chunk.byteLength;
      validateEntrySize(entry.name, size);
      validateTotalSize(actualTotal);
      assertZip(size <= entry.originalSize && (!final || size === entry.originalSize), `actual size mismatch: ${entry.name}`);
      data?.set(chunk, offset);
      checksum.push(chunk, final);
      complete = final;
    };
    const compressed = bytes.subarray(entry.dataStart, entry.dataStart + entry.size);
    if (entry.compression === 0) receive(compressed, true);
    else {
      const inflate = new Inflate(receive);
      // Limit expansion per push, including for a forged small declared output size.
      for (let offset = 0; offset < compressed.byteLength; offset += 1024) {
        const end = Math.min(offset + 1024, compressed.byteLength);
        inflate.push(compressed.subarray(offset, end), end === compressed.byteLength);
      }
    }
    assertZip(complete, `incomplete entry: ${entry.name}`);
    assertZip((checksum.crc >>> 0) === entry.crc, `CRC-32 mismatch: ${entry.name}`);
    if (data) extracted.set(entry.name, data);
  }
  return extracted;

  function inspectZip(bytes: Uint8Array): ZipEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (at: number) => view.getUint16(at, true);
    const u32 = (at: number) => view.getUint32(at, true);
    const range = (at: number, length: number, end = bytes.byteLength) => {
      assertZip(at >= 0 && length >= 0 && at + length <= end, "invalid ZIP offset or truncated record");
    };
    range(0, 22);
    let end = bytes.byteLength - 22;
    const earliest = Math.max(0, end - 65535);
    for (; end >= earliest; end--) {
      if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.byteLength) break;
    }
    assertZip(end >= earliest, "invalid ZIP end record or trailing bytes");
    assertZip(u16(end + 4) === 0 && u16(end + 6) === 0, "unsupported split ZIP disks");
    const count = u16(end + 10);
    assertZip(u16(end + 8) === count, "inconsistent directory entry counts");
    assertZip(count <= options.maxFileCount, "file-count budget exceeded");
    assertZip(count >= requiredFilenames.length, missingRequired);
    const directoryStart = u32(end + 16);
    const directorySize = u32(end + 12);
    range(directoryStart, directorySize, end);
    assertZip(directoryStart + directorySize === end, "invalid central directory size or offset");

    const entries: ZipEntry[] = [];
    const seen = new Set<string>();
    let cursor = directoryStart;
    let total = 0;
    for (let index = 0; index < count; index++) {
      range(cursor, 46, end);
      assertZip(u32(cursor) === 0x02014b50, "invalid central directory signature");
      const nameLength = u16(cursor + 28);
      const extraLength = u16(cursor + 30);
      const commentLength = u16(cursor + 32);
      range(cursor + 46, nameLength + extraLength + commentLength, end);
      const name = decodeFilename(bytes.subarray(cursor + 46, cursor + 46 + nameLength), u16(cursor + 8));
      validatePath(name);
      validateFilename(name);
      assertZip(!seen.has(name), `duplicate entry: ${name}`);
      seen.add(name);
      const entry: ZipEntry = {
        name, version: u16(cursor + 6), flags: u16(cursor + 8), compression: u16(cursor + 10),
        timestamp: u32(cursor + 12), crc: u32(cursor + 16), size: u32(cursor + 20),
        originalSize: u32(cursor + 24), localOffset: u32(cursor + 42), dataStart: 0,
      };
      assertZip(entry.compression === 0 || entry.compression === 8, "unsupported compression");
      assertZip(entry.version >= (entry.compression === 8 ? 20 : 10) && entry.version <= 20, "unsupported ZIP version");
      const allowedFlags = 0x0808 | (entry.compression === 8 ? 0x0006 : 0);
      assertZip((entry.flags & ~allowedFlags) === 0, "unsupported ZIP flags or encryption");
      assertZip(u16(cursor + 34) === 0, "unsupported entry disk");
      const attributes = u32(cursor + 38);
      const unixType = (attributes >>> 16) & 0xf000;
      const directory = name.endsWith("/");
      assertZip(directory
        ? Boolean(options.allowDirectories) && entry.originalSize === 0 && (unixType === 0 || unixType === 0x4000)
        : (attributes & 0x10) === 0 && (unixType === 0 || unixType === 0x8000), "unsupported non-file entry");
      validateCompressedSize(entry.size);
      assertZip(entry.size <= bytes.byteLength, "entry compressed size exceeds source bytes");
      validateEntrySize(name, entry.originalSize);
      total += entry.originalSize;
      validateTotalSize(total);
      validateExtra(bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength));
      entries.push(entry);
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    assertZip(cursor === end, "invalid central directory size or unlisted entries");
    requireFiles([...seen]);
    for (const name of seen) {
      const parts = name.replace(/\/$/, "").split("/");
      assertZip(!name.endsWith("/") || !seen.has(parts.join("/")), "file and directory identity conflict");
      for (let end = 1; end < parts.length; end++) {
        assertZip(!seen.has(parts.slice(0, end).join("/")), "file used as a directory prefix");
      }
    }
    options.validateEntries?.([...seen]);

    // Physical order may differ from central directory order. No gaps, aliases or hidden records.
    entries.sort((a, b) => a.localOffset - b.localOffset);
    assertZip(entries.length ? entries[0].localOffset === 0 : directoryStart === 0, "unlisted local entry or unsupported ZIP prefix");
    const localNames = new Set<string>();
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const local = entry.localOffset;
      const next = entries[index + 1]?.localOffset ?? directoryStart;
      range(local, 30, next);
      assertZip(u32(local) === 0x04034b50, "invalid local signature or offset");
      const nameLength = u16(local + 26);
      const extraLength = u16(local + 28);
      range(local + 30, nameLength + extraLength, next);
      const name = decodeFilename(bytes.subarray(local + 30, local + 30 + nameLength), u16(local + 6));
      validatePath(name);
      assertZip(!localNames.has(name), `duplicate local entry: ${name}`);
      localNames.add(name);
      assertZip(name === entry.name, "unlisted local entry or filename mismatch");
      assertZip(u16(local + 4) === entry.version && u16(local + 6) === entry.flags
        && u16(local + 8) === entry.compression && u32(local + 10) === entry.timestamp, "local metadata mismatch");
      const descriptor = (entry.flags & 8) !== 0;
      for (const [offset, expected] of [[14, entry.crc], [18, entry.size], [22, entry.originalSize]]) {
        const actual = u32(local + offset);
        assertZip(actual === expected || (descriptor && actual === 0), "local CRC or size metadata mismatch");
      }
      validateExtra(bytes.subarray(local + 30 + nameLength, local + 30 + nameLength + extraLength));
      entry.dataStart = local + 30 + nameLength + extraLength;
      range(entry.dataStart, entry.size, next);
      const dataEnd = entry.dataStart + entry.size;
      if (descriptor) {
        const length = next - dataEnd;
        assertZip(length === 12 || length === 16, "descriptor or compressed size mismatch");
        const start = dataEnd + (length === 16 ? 4 : 0);
        if (length === 16) assertZip(u32(dataEnd) === 0x08074b50, "invalid descriptor signature");
        assertZip(u32(start) === entry.crc && u32(start + 4) === entry.size
          && u32(start + 8) === entry.originalSize, "descriptor CRC or size mismatch");
      } else assertZip(dataEnd === next, "unlisted local data or compressed size mismatch");
      assertZip(entry.compression !== 0 || entry.size === entry.originalSize, `actual size mismatch: ${name}`);
    }
    return entries;
  }

  function validateExtra(bytes: Uint8Array): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const seen = new Set<number>();
    for (let offset = 0; offset < bytes.byteLength;) {
      assertZip(offset + 4 <= bytes.byteLength, "truncated extra field");
      const id = view.getUint16(offset, true);
      const length = view.getUint16(offset + 2, true);
      // Only passive timestamp/ownership metadata; ZIP64, encryption and alternate names are unsupported.
      assertZip([0x000a, 0x5455, 0x5855, 0x7855, 0x7875].includes(id), "unsupported ZIP extra field");
      assertZip(!seen.has(id) && offset + 4 + length <= bytes.byteLength, "duplicate or truncated extra field");
      seen.add(id);
      offset += 4 + length;
    }
  }

  function decodeFilename(bytes: Uint8Array, flags: number): string {
    if (flags & 0x0800) return decodeUtf8Strict(bytes, `${options.label} filename`);
    assertZip(bytes.every(value => value < 128), "unsupported filename encoding; use ASCII or flagged UTF-8 names");
    return strFromU8(bytes, true);
  }

  function assertZip(condition: boolean, message: string): asserts condition {
    if (!condition) throw new Error(`${options.label} invalid zip data: ${message}.`);
  }

  function requireFiles(names: string[]): void {
    assertZip(requiredFilenames.every(name => names.includes(name)), missingRequired);
  }

  function validateFilename(name: string): void {
    assertZip(!options.allowedFilenames || options.allowedFilenames.has(name), `contains unsupported file: ${name}`);
  }

  function validatePath(name: string): void {
    const path = options.allowDirectories && name.endsWith("/") ? name.slice(0, -1) : name;
    assertZip(Boolean(path) && name.length <= 180 && !/[\\\u0000-\u001f\u007f]/.test(name) && !/^[A-Za-z]:/.test(name)
      && !path.split("/").some(part => !part || part === "." || part === ".."), `contains unsafe path: ${name}`);
  }

  function validateCompressedSize(size: number): void {
    assertZip(Number.isSafeInteger(size) && size >= 0 && size <= options.maxCompressedBytes, "compressed size exceeds budget");
  }

  function validateEntrySize(name: string, size: number): void {
    assertZip(Number.isSafeInteger(size) && size >= 0 && size <= options.maxEntryBytes, `entry ${name} exceeds uncompressed size budget`);
  }

  function validateTotalSize(size: number): void {
    assertZip(size <= options.maxUncompressedBytes, "uncompressed size exceeds budget");
  }
}
