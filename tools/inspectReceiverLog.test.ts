import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { inspectReceiverFile, inspectReceiverLog } from "./inspectReceiverLog";

const psti = "$PSTI,030,033010.000,A,2447.0895508,N,12100.5234656,E,94.615,0.00,-0.01,0.04,111219,R,0.999,3.724*1A\r\n";
const encode = (value: string) => new TextEncoder().encode(value);
const sentence = (body: string) => `$${body}*${[...body].reduce((sum, char) => sum ^ char.charCodeAt(0), 0).toString(16).padStart(2, "0")}\r\n`;
const frame = (payload: number[]) => Uint8Array.from([0xa0, 0xa1, payload.length >>> 8, payload.length & 255, ...payload, payload.reduce((sum, byte) => sum ^ byte, 0), 13, 10]);
// Synthetic DC: week 2400, TOW 123000 ms, period 1000 ms, IOD 7.
const dc = [0xdc, 7, 0x09, 0x60, 0, 1, 0xe0, 0x78, 3, 0xe8];

test("PX inspection uses source-defined diagnostic fields without collection claims", async () => {
  const report = await inspectReceiverLog([encode(psti)], "px1122r");
  assert.equal(report.status, "inspected");
  assert.equal(report.px1122r.psti030Count, 1);
  assert.equal(report.px1122r.lastPsti030?.velocityEnuMetersPerSecond.up, 0.04);
  assert.equal(report.sha256, createHash("sha256").update(psti).digest("hex"));
  assert.equal(report.boundaries.collectionEligible, false);
  assert.equal(report.boundaries.physicalQualification, "unverified");
  assert.equal(report.boundaries.receptionTiming, "unavailable_in_file");
});

test("NS-RAW inspection decodes only selected protocol, never solves or associates epochs", async () => {
  const bytes = Uint8Array.from([...frame(dc), ...frame([0xdd, 7, 0]), ...frame([0xee, 0])]);
  const report = await inspectReceiverLog([bytes], "ns-raw");
  assert.equal(report.status, "inspected");
  assert.deepEqual(report.nsRaw.rawKindCounts, { DC: 1, DD: 1, unknown: 1, invalid: 0 });
  assert.deepEqual(report.nsRaw.lastRaw, { kind: "unknown", messageId: 0xee });
  assert.equal(report.boundaries.epochCoherence, "unverified");
  assert.equal(report.boundaries.solverExecuted, false);
  const other = await inspectReceiverLog([bytes], "px1122r");
  assert.equal(other.status, "unsupported");
  assert.equal(other.nsRaw.rawKindCounts.DC, 0);
});

test("inspection counts and hashes are chunk invariant, including mixed text/binary", async () => {
  const bytes = Uint8Array.from([...encode(psti), ...frame(dc), ...frame([0xdd, 7, 0])]);
  const expected = await inspectReceiverLog([bytes], "ns-raw");
  for (let index = 1; index < bytes.length; index += 1) {
    assert.deepEqual(await inspectReceiverLog([bytes.slice(0, index), bytes.slice(index)], "ns-raw"), expected);
  }
});

test("corrupt, incomplete, empty and invalid known payloads do not pass inspection", async () => {
  for (const bytes of [encode(psti.replace("*1A", "*00")), frame(dc).slice(0, -1), frame([0xdc]), Uint8Array.of(0)]) {
    assert.equal((await inspectReceiverLog([bytes], "ns-raw")).status, "rejected");
  }
  assert.equal((await inspectReceiverLog([], "ns-raw")).status, "unsupported");
  assert.equal((await inspectReceiverLog([encode(psti.replace("0.999", "broken"))], "px1122r")).status, "rejected");
  for (const tail of [Uint8Array.of(0xff), encode("$GPGGA,")]) {
    assert.equal((await inspectReceiverLog([frame(dc), tail], "ns-raw")).status, "rejected");
    assert.equal((await inspectReceiverLog([Uint8Array.from([...frame(dc), ...tail])], "ns-raw")).status, "rejected");
  }
});

test("truncated proprietary identity rejects and unknown sentences stay explicitly unsupported", async () => {
  const truncated = await inspectReceiverLog([encode(psti + sentence("PSTI,030"))], "px1122r");
  assert.equal(truncated.status, "rejected");
  assert.equal(truncated.px1122r.rejectedPsti030, 1);
  const malformed = await inspectReceiverLog([encode(sentence(psti.slice(1, psti.indexOf("*")).replace("0.999", "broken")))], "px1122r");
  assert.equal(malformed.status, "rejected");
  assert.equal(malformed.rejectedTextLines, 0);
  assert.equal(malformed.px1122r.rejectedPsti030, 1);
  for (const profile of ["px1122r", "ns-raw"] as const) {
    const report = await inspectReceiverLog([encode(sentence("PABCD,1"))], profile);
    assert.equal(report.status, "unsupported");
    assert.equal(report.unknownTextFrames, 1);
    assert.deepEqual(report.nmeaSentenceCounts, {});
  }
});

test("file inspection is read-only, refuses nonfiles, and CLI returns useful JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cplayout-receiver-log-"));
  try {
    const path = join(dir, "synthetic.nmea");
    await writeFile(path, psti);
    assert.equal((await inspectReceiverFile(path, "px1122r")).status, "inspected");
    await assert.rejects(inspectReceiverFile(dir, "px1122r"), /regular recording/);
    const link = join(dir, "symlink.nmea");
    await symlink(path, link);
    await assert.rejects(inspectReceiverFile(link, "px1122r"), /regular recording/);
    const result = spawnSync(process.execPath, ["--import", "tsx", "tools/inspectReceiverLog.ts", "--profile", "px1122r", path], { encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).px1122r.psti030Count, 1);
    const outside = spawnSync(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("tools/inspectReceiverLog.ts"), "--profile", "px1122r", path], { cwd: dir, encoding: "utf8", timeout: 15000 });
    assert.equal(outside.status, 0, outside.stderr);
    assert.equal(JSON.parse(outside.stdout).px1122r.psti030Count, 1);
    const invalid = spawnSync(process.execPath, ["--import", "tsx", "tools/inspectReceiverLog.ts"], { encoding: "utf8", timeout: 15000 });
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /Usage:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
