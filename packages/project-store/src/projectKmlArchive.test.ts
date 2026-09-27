import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, Zip, ZipDeflate, zipSync } from "fflate";
import { exportProjectGoogleEarthKml, sampleProject } from "@cplayout/core";
import { readZipArchive } from "./zipArchive";
import { decodeUtf8Strict } from "./utf8";

import {
  createGoogleEarthKmz,
  extractKmlFromKmz,
  GOOGLE_EARTH_KMZ_DOC_FILENAME,
  readGoogleEarthKmlFile,
} from "./projectKmlArchive";

const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Point><coordinates>-104,40,0</coordinates></Point></Placemark></Document></kml>`;
const kmz = createGoogleEarthKmz(kml);
const mapFeatureKml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Pipeline A</name><ExtendedData><Data name="cplayoutFeatureType"><value>map_feature</value></Data></ExtendedData><LineString><coordinates>-104,40,0 -104.1,40.1,0</coordinates></LineString></Placemark></Document></kml>`;
const mapFeatureKmz = createGoogleEarthKmz(mapFeatureKml);
const styledKml = exportProjectGoogleEarthKml({
  ...sampleProject,
  mapFeatures: [{
    id: "pipeline-a",
    name: "Pipeline A",
    kind: "underground_pipeline",
    geometry: { type: "LineString", vertices: [sampleProject.waterSource, sampleProject.pivotCenter] },
    confidence: "imagery_digitized",
  }],
}).kml;
const styledKmz = createGoogleEarthKmz(styledKml);

assert.ok(kmz.byteLength > kml.length / 2);
assert.equal(extractKmlFromKmz(kmz), kml);
assert.match(extractKmlFromKmz(mapFeatureKmz), /Pipeline A/);
assert.match(extractKmlFromKmz(mapFeatureKmz), /map_feature/);
assert.match(extractKmlFromKmz(styledKmz), /<Style id="cplayout-field-boundary">/);
assert.match(extractKmlFromKmz(styledKmz), /<styleUrl>#cplayout-map-line-water<\/styleUrl>/);
assert.match(extractKmlFromKmz(styledKmz), /Pipeline A/);
assert.match(extractKmlFromKmz(styledKmz), /<Data name="cplayoutFeatureType"><value>map_feature<\/value><\/Data>/);
assert.doesNotMatch(extractKmlFromKmz(styledKmz), /<href>https?:\/\//);

const readKmz = readGoogleEarthKmlFile({ filename: "field.kmz", bytes: kmz, mimeType: "application/vnd.google-earth.kmz" });
assert.equal(readKmz.kind, "kmz");
assert.equal(readKmz.kmlText, kml);
assert.equal(readKmz.warnings.length, 0);

const readKml = readGoogleEarthKmlFile({ filename: "field.kml", bytes: strToU8(kml), mimeType: "application/vnd.google-earth.kml+xml" });
assert.equal(readKml.kind, "kml");
assert.equal(readKml.kmlText, kml);

const nestedKmz = zipSync({ "folder/field.kml": strToU8(kml) });
const readNested = readGoogleEarthKmlFile({ filename: "nested.kmz", bytes: nestedKmz });
assert.equal(readNested.kind, "kmz");
assert.match(readNested.warnings.join("\n"), /doc\.kml/);

assert.throws(
  () => extractKmlFromKmz(zipSync({ "a.kml": strToU8(kml), "b.kml": strToU8(kml) })),
  /exactly one KML/,
);
assert.throws(
  () => extractKmlFromKmz(zipSync({ "notes.txt": strToU8("not kml") })),
  /must contain a KML/,
);
assert.throws(
  () => extractKmlFromKmz(zipSync({ "../doc.kml": strToU8(kml) })),
  /unsafe path/,
);

assert.equal(GOOGLE_EARTH_KMZ_DOC_FILENAME, "doc.kml");

console.log("project KML archive tests passed");

const mtime = new Date("2026-09-16T00:00:00Z");
const makeZip = (files: Record<string, Uint8Array>, stored = false) => zipSync(files, { mtime, level: stored ? 0 : 6 });
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function centralOffsets(bytes: Uint8Array): number[] {
  const data = view(bytes);
  const end = bytes.length - 22;
  const offsets: number[] = [];
  for (let cursor = data.getUint32(end + 16, true); cursor < end;) {
    offsets.push(cursor);
    cursor += 46 + data.getUint16(cursor + 28, true) + data.getUint16(cursor + 30, true) + data.getUint16(cursor + 32, true);
  }
  return offsets;
}

test("KMZ preserves Unicode paths, empty folders, nested KML and binary supporting assets", () => {
  const name = "folder/\u00e9-field.kml";
  const bytes = makeZip({ "folder/": new Uint8Array(), [name]: strToU8(kml), "folder/icon.bin": new Uint8Array([0xff, 0x80, 0]) });
  const original = bytes.slice();
  const read = readGoogleEarthKmlFile({ filename: "field.kmz", bytes });
  assert.equal(read.kmlText, kml);
  assert.ok(read.warnings[0].includes(name));
  assert.deepEqual(bytes, original);
});

test("plain KML and KMZ accept UTF-8 BOM and reject malformed or declared alternate encoding", () => {
  for (const text of [kml, `\ufeff${kml}`, kml.replace("<Document>", "<Document><name>\ufffd\ud83d\ude80</name>")]) {
    const bytes = strToU8(text);
    assert.equal(decodeUtf8Strict(bytes, "test"), text);
    assert.equal(readGoogleEarthKmlFile({ filename: "field.kml", bytes }).kmlText, text.replace(/^\ufeff/, ""));
    assert.equal(extractKmlFromKmz(makeZip({ "doc.kml": bytes })), text.replace(/^\ufeff/, ""));
  }
  for (const invalid of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf0, 0x9f], [0xff, 0xfe, 0x3c, 0]]) {
    const bytes = new Uint8Array(invalid);
    assert.throws(() => readGoogleEarthKmlFile({ filename: "field.kml", bytes }), /UTF-8/);
    assert.throws(() => extractKmlFromKmz(makeZip({ "doc.kml": bytes })), /UTF-8/);
  }
  const declared = strToU8(`<?xml version="1.0" encoding="ISO-8859-1"?>${kml}`);
  assert.throws(() => readGoogleEarthKmlFile({ filename: "field.kml", bytes: declared }), /supports UTF-8/);
  assert.throws(() => extractKmlFromKmz(makeZip({ "doc.kml": declared })), /supports UTF-8/);
});

test("KMZ verifies actual CRC of the selected KML and discarded binary assets", () => {
  for (const name of ["doc.kml", "image.bin"]) {
    const bytes = makeZip({ "doc.kml": strToU8(kml), "image.bin": new Uint8Array([1, 2, 3]) }, true);
    const offset = centralOffsets(bytes)[name === "doc.kml" ? 0 : 1];
    const data = view(bytes);
    const local = data.getUint32(offset + 42, true);
    const start = local + 30 + data.getUint16(local + 26, true) + data.getUint16(local + 28, true);
    bytes[start] ^= 1;
    assert.throws(() => extractKmlFromKmz(bytes), /CRC-32 mismatch/);
  }
});

test("KMZ rejects duplicate names, metadata disagreement, encryption and symlinks", () => {
  const duplicate = makeZip({ "doc.kml": strToU8(kml), "aux.kml": strToU8(kml) });
  const second = centralOffsets(duplicate)[1];
  const local = view(duplicate).getUint32(second + 42, true);
  duplicate.set(strToU8("doc.kml"), second + 46);
  duplicate.set(strToU8("doc.kml"), local + 30);
  assert.throws(() => extractKmlFromKmz(duplicate), /duplicate entry/);
  for (const kind of ["metadata", "encrypted", "symlink"]) {
    const bytes = makeZip({ "doc.kml": strToU8(kml) });
    const central = centralOffsets(bytes)[0];
    if (kind === "metadata") view(bytes).setUint16(6, 0x0800, true);
    if (kind === "encrypted") view(bytes).setUint16(central + 8, 1, true);
    if (kind === "symlink") view(bytes).setUint32(central + 38, 0xa0000000, true);
    assert.throws(() => extractKmlFromKmz(bytes), /metadata mismatch|flags or encryption|non-file/);
  }
});

test("KMZ rejects unsafe ancillary paths, file-directory aliases and directory payloads", () => {
  for (const name of ["../icon.bin", "/icon.bin", "a\\icon.bin", "a\u0000.bin", "a//icon.bin", "C:/icon.bin"]) {
    assert.throws(() => extractKmlFromKmz(makeZip({ "doc.kml": strToU8(kml), [name]: new Uint8Array([1]) })), /unsafe path/);
  }
  const extras: Record<string, Uint8Array>[] = [
    { "folder/": new Uint8Array([1]) },
    { folder: new Uint8Array(), "folder/icon": new Uint8Array() },
    { folder: new Uint8Array(), "folder/": new Uint8Array() },
  ];
  for (const extra of extras) {
    assert.throws(() => extractKmlFromKmz(makeZip({ "doc.kml": strToU8(kml), ...extra })), /non-file|directory/);
  }
});

test("KMZ rejects unflagged non-ASCII and malformed flagged UTF-8 filenames", () => {
  for (const invalidUtf8 of [false, true]) {
    const bytes = makeZip({ "\u00e9.kml": strToU8(kml) });
    const central = centralOffsets(bytes)[0];
    if (invalidUtf8) {
      bytes[30] = 0xff;
      bytes[central + 46] = 0xff;
    } else {
      view(bytes).setUint16(6, 0, true);
      view(bytes).setUint16(central + 8, 0, true);
    }
    assert.throws(() => extractKmlFromKmz(bytes), /filename encoding|UTF-8/);
  }
});

test("checked ZIP budgets include unretained assets and verify forged output sizes", () => {
  const options = { label: "test", maxCompressedBytes: 4096, maxEntryBytes: 4, maxUncompressedBytes: 7, maxFileCount: 3, retainEntry: (name: string) => name === "keep" };
  const bytes = makeZip({ keep: new Uint8Array(3), discard: new Uint8Array(4) });
  assert.deepEqual([...readZipArchive(bytes, options).keys()], ["keep"]);
  assert.throws(() => readZipArchive(bytes, { ...options, maxUncompressedBytes: 6 }), /uncompressed size/);
  assert.throws(() => readZipArchive(bytes, { ...options, maxEntryBytes: 3 }), /uncompressed size/);
  assert.throws(() => readZipArchive(bytes, { ...options, maxFileCount: 1 }), /file-count/);
  assert.throws(() => readZipArchive(bytes, { ...options, maxCompressedBytes: bytes.length - 1 }), /compressed size/);
  const central = centralOffsets(bytes)[1];
  const local = view(bytes).getUint32(central + 42, true);
  view(bytes).setUint32(central + 24, 1, true);
  view(bytes).setUint32(local + 22, 1, true);
  assert.throws(() => readZipArchive(bytes, options), /actual size mismatch/);
});

test("KMZ rejects excessive file count and declared expansion before allocating assets", () => {
  const many = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`asset-${i}`, new Uint8Array()]));
  assert.throws(() => extractKmlFromKmz(makeZip({ "doc.kml": strToU8(kml), ...many })), /file-count/);
  const huge = makeZip({ "doc.kml": strToU8(kml), image: new Uint8Array() });
  view(huge).setUint32(centralOffsets(huge)[1] + 24, 26 * 1024 * 1024, true);
  assert.throws(() => extractKmlFromKmz(huge), /uncompressed size/);
  const aggregate = makeZip({ "doc.kml": strToU8(kml), a: new Uint8Array(), b: new Uint8Array(), c: new Uint8Array(), d: new Uint8Array() });
  for (const central of centralOffsets(aggregate).slice(1)) view(aggregate).setUint32(central + 24, 25 * 1024 * 1024, true);
  assert.throws(() => extractKmlFromKmz(aggregate), /uncompressed size/);
});

test("KMZ accepts a real streaming writer and validates streamed binary assets", () => {
  const chunks: Uint8Array[] = [];
  const archive = new Zip((error, bytes) => { if (error) throw error; chunks.push(bytes); });
  for (const [name, bytes] of Object.entries({ "doc.kml": strToU8(kml), "icon.bin": new Uint8Array([0xff, 0]) })) {
    const file = new ZipDeflate(name);
    file.mtime = mtime;
    archive.add(file);
    file.push(bytes, true);
  }
  archive.end();
  assert.equal(extractKmlFromKmz(Buffer.concat(chunks)), kml);
});

test("KMZ exporter keeps header times consistent across clock changes", context => {
  let tick = mtime.getTime();
  context.mock.method(Date, "now", () => (tick += 4000));
  assert.equal(extractKmlFromKmz(createGoogleEarthKmz(kml)), kml);
});
