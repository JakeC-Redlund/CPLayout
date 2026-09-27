import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

for (const mode of ["native", "no-encoder", "no-decoder", "portable"]) {
  test(`strict UTF-8 preserves valid Unicode and rejects noncanonical bytes with ${mode} codecs`, () => {
    const script = String.raw`
      const assert = require('node:assert/strict');
      const mode = process.env.CPLAYOUT_TEST_UTF8_MODE;
      if (mode === 'no-encoder' || mode === 'portable') globalThis.TextEncoder = undefined;
      if (mode === 'no-decoder' || mode === 'portable') globalThis.TextDecoder = undefined;
      const { decodeUtf8Strict } = require('./src/utf8.ts');
      const { readGoogleEarthKmlFile, extractKmlFromKmz } = require('./src/projectKmlArchive.ts');
      const { zipSync } = require('fflate');
      for (const text of ['', 'ASCII % /?!', '\u0000', '\ufffd', '\u00e9', '\u{1f680}', '\u{10000}', '\u{10ffff}', '\ufeff', '\ufeff\ufefftext', 'a'.repeat(8191) + '\u{1f680}', 'a'.repeat(8192) + '\u{1f680}']) {
        assert.equal(decodeUtf8Strict(Buffer.from(text), 'fixture'), text);
      }
      for (const values of [[0xff], [0x80], [0xc0,0x80], [0xe0,0x80,0x80], [0xed,0xa0,0x80], [0xf0,0x80,0x80,0x80], [0xf4,0x90,0x80,0x80], [0xf0,0x9f], [0xef,0xbb,0xbf,0xff]]) {
        assert.throws(() => decodeUtf8Strict(new Uint8Array(values), 'fixture'), /invalid UTF-8/);
      }
      const kml = '<kml><Document><name>Field ' + String.fromCodePoint(0x1f680) + '</name></Document></kml>';
      const payload = Buffer.from(kml);
      const opts = { mtime: new Date('2026-09-17T00:00:00Z') };
      assert.equal(readGoogleEarthKmlFile({ filename: 'field.kml', bytes: payload }).kmlText, kml);
      assert.equal(extractKmlFromKmz(zipSync({ 'doc.kml': payload }, opts)), kml);
      const named = zipSync({ 'XXXX.kml': payload }, opts);
      const data = new DataView(named.buffer, named.byteOffset, named.byteLength);
      const central = data.getUint32(named.length - 22 + 16, true);
      const name = Buffer.from(String.fromCodePoint(0x1f680) + '.kml');
      named.set(name, 30); named.set(name, central + 46);
      data.setUint16(6, 0x0800, true); data.setUint16(central + 8, 0x0800, true);
      assert.equal(extractKmlFromKmz(named), kml);
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--eval", script], {
      cwd: resolve(__dirname, ".."), env: { ...process.env, CPLAYOUT_TEST_UTF8_MODE: mode }, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(result.status, 0, `${mode}: ${result.error?.message ?? ""}\n${result.stderr}`);
  });
}
