import assert from "node:assert/strict";
import { test } from "node:test";
import { ReceiverStreamDecoder, MAX_RECEIVER_FRAME_AGE_MS } from "./receiverStream";

const metadata = (receivedMonotonicMs = 100) => ({ receivedAt: "2026-09-17T00:00:00.000Z", receivedMonotonicMs });
const sentence = (body: string) => `$${body}*${[...body].reduce((sum, char) => sum ^ char.charCodeAt(0), 0).toString(16).padStart(2, "0")}\r\n`;
const text = sentence("GNGGA,123519.00,3900.000000,N,10400.000000,W,4,18,0.6,1600.0,M,-20.0,M,0.5,0000");
const encode = (value: string) => new TextEncoder().encode(value);
function binary(payload: Uint8Array): Uint8Array {
  return Uint8Array.from([0xa0, 0xa1, payload.length >>> 8, payload.length & 0xff, ...payload,
    payload.reduce((sum, byte) => sum ^ byte, 0), 0x0d, 0x0a]);
}

test("NMEA survives every split and retains first-byte reception time", () => {
  const bytes = encode(text);
  for (let split = 1; split < bytes.length; split += 1) {
    const decoder = new ReceiverStreamDecoder();
    const first = decoder.push(bytes.slice(0, split), metadata(100));
    const second = decoder.push(bytes.slice(split), metadata(150));
    assert.deepEqual([...first.nmea, ...second.nmea], [{ sentence: text.trim(), ...metadata(100) }]);
    assert.equal(decoder.finish().complete, true);
  }
});

test("old partial frames are dropped, never restamped as fresh fixes", () => {
  const decoder = new ReceiverStreamDecoder();
  decoder.push(encode(text.slice(0, 25)), metadata(100));
  const result = decoder.push(encode(text.slice(25)), metadata(101 + MAX_RECEIVER_FRAME_AGE_MS));
  assert.equal(result.invalidated, true);
  assert.deepEqual(result.nmea, []);
  assert.equal(decoder.push(encode(text), metadata(2200)).nmea.length, 1);
});

test("successive partial chunks cannot renew first-byte age", () => {
  const decoder = new ReceiverStreamDecoder();
  decoder.push(encode(text.slice(0, 10)), metadata(100));
  decoder.push(encode(text.slice(10, 25)), metadata(1900));
  assert.equal(decoder.push(encode(text.slice(25)), metadata(2101)).nmea.length, 0);
});

test("SkyTraq payloads are opaque across every split, including embedded valid NMEA", () => {
  const payload = Uint8Array.from([0xee, ...encode(text.repeat(3))]);
  const bytes = binary(payload);
  for (let split = 1; split < bytes.length; split += 1) {
    const decoder = new ReceiverStreamDecoder();
    const first = decoder.push(bytes.slice(0, split), metadata());
    const second = decoder.push(bytes.slice(split), metadata());
    assert.equal(first.mode, "binary");
    assert.equal(second.mode, "binary");
    assert.deepEqual([...first.binaryPayloads, ...second.binaryPayloads], [payload]);
    assert.deepEqual([...first.nmea, ...second.nmea], []);
    assert.equal(decoder.push(encode(text), metadata()).nmea.length, 0);
    assert.equal(decoder.finish().complete, true);
  }
});

test("binary in same event discards previously completed NMEA and latches session", () => {
  const decoder = new ReceiverStreamDecoder();
  const result = decoder.push(Uint8Array.from([...encode(text), ...binary(Uint8Array.of(0xee)), ...encode(text)]), metadata());
  assert.equal(result.invalidated, true);
  assert.deepEqual(result.nmea, []);
  assert.equal(result.mode, "binary");
  assert.equal(new ReceiverStreamDecoder().push(encode(text), metadata()).nmea.length, 1);
});

test("corrupt framing and unknown binary fail closed until a new decoder", () => {
  const valid = binary(Uint8Array.of(0xee));
  for (const bytes of [
    Uint8Array.of(0xa0, 0x00), Uint8Array.of(0xa0, 0xa1, 0, 0),
    Uint8Array.of(0xff), Uint8Array.of(0), Uint8Array.of(0x09),
    valid.map((byte, index) => index === 5 ? byte ^ 1 : byte),
    valid.map((byte, index) => index === 6 ? 0 : byte),
    valid.map((byte, index) => index === 7 ? 0 : byte),
  ]) {
    const decoder = new ReceiverStreamDecoder();
    assert.equal(decoder.push(bytes, metadata()).mode, "fault");
    assert.deepEqual(decoder.push(encode(text), metadata()).nmea, []);
    assert.equal(decoder.finish().complete, false);
  }
});

test("binary length is unsigned big endian, frame data stays detached", () => {
  const payload = new Uint8Array(65535).fill(0x24);
  const bytes = binary(payload);
  const decoder = new ReceiverStreamDecoder();
  const result = decoder.push(bytes, metadata());
  assert.deepEqual(result.binaryPayloads, [payload]);
  bytes.fill(0);
  assert.deepEqual(result.binaryPayloads[0], payload);
  assert.equal(decoder.finish().complete, true);
});

test("incomplete binary expires without reparsing its tail as text", () => {
  const decoder = new ReceiverStreamDecoder();
  decoder.push(Uint8Array.of(0xa0, 0xa1, 0, 200), metadata());
  assert.equal(decoder.push(encode(text), metadata(2101)).mode, "fault");
  assert.equal(decoder.finish().complete, false);
});

test("ASCII overflow, nested dollar and junk prefix reject whole line with bounded recovery", () => {
  for (const prefix of ["$" + "x".repeat(100_000), "$broken", "noise"]) {
    const decoder = new ReceiverStreamDecoder();
    const rejected = decoder.push(encode(prefix + text), metadata());
    assert.equal(rejected.invalidated, true);
    assert.deepEqual(rejected.nmea, []);
    assert.equal(decoder.push(encode(text), metadata()).nmea.length, 1);
  }
});

test("bad checksum invalidates earlier samples in event but permits subsequent whole frames", () => {
  const decoder = new ReceiverStreamDecoder();
  const result = decoder.push(encode(text + "$GNGGA*00\r\n" + text), metadata());
  assert.equal(result.invalidated, true);
  assert.equal(result.nmea.length, 1);
});

test("invalid and regressing clocks fail closed; first reception is cloned", () => {
  for (const clock of [NaN, Infinity, -1, 99]) {
    const decoder = new ReceiverStreamDecoder();
    decoder.push(encode(text.slice(0, 20)), metadata());
    assert.equal(decoder.push(encode(text.slice(20)), metadata(clock)).mode, "fault");
  }
  const decoder = new ReceiverStreamDecoder();
  const initial = metadata();
  decoder.push(encode(text.slice(0, 20)), initial);
  initial.receivedMonotonicMs = 999;
  assert.equal(decoder.push(encode(text.slice(20)), metadata(150)).nmea[0].receivedMonotonicMs, 100);
  assert.equal(new ReceiverStreamDecoder().push(encode(text), { ...metadata(), receivedAt: "invalid" }).mode, "fault");
});

test("transport event extras cannot leak byte buffers into retained reception metadata", () => {
  const decoder = new ReceiverStreamDecoder();
  const event = { ...metadata(), bytes: new Uint8Array(1_000_000), type: "bytes" };
  decoder.push(encode(text.slice(0, 20)), event);
  const result = decoder.push(encode(text.slice(20)), metadata(150));
  assert.deepEqual(result.nmea, [{ sentence: text.trim(), ...metadata() }]);
  assert.deepEqual(result.diagnosticTextFrames, result.nmea);
});

test("end-of-stream reports truncated frames, never emits incomplete text", () => {
  for (const bytes of [encode(text.slice(0, -2)), Uint8Array.of(0xa0), Uint8Array.of(0xa0, 0xa1, 0, 2, 0xee), encode("noise")]) {
    const decoder = new ReceiverStreamDecoder();
    assert.deepEqual(decoder.push(bytes, metadata()).nmea, []);
    assert.equal(decoder.finish().complete, false);
  }
});

test("post-binary noise and partial text cannot silently pass diagnostic completeness", () => {
  for (const tail of [Uint8Array.of(0xff), encode("$GPGGA,")]) {
    for (const split of [false, true]) {
      const decoder = new ReceiverStreamDecoder();
      const head = binary(Uint8Array.of(0xee));
      if (split) { decoder.push(head, metadata()); decoder.push(tail, metadata()); }
      else decoder.push(Uint8Array.from([...head, ...tail]), metadata());
      assert.equal(decoder.finish().complete, false);
    }
  }
  const decoder = new ReceiverStreamDecoder();
  const result = decoder.push(Uint8Array.from([...binary(Uint8Array.of(0xee)), ...encode(text)]), metadata());
  assert.deepEqual(result.nmea, []);
  assert.equal(result.diagnosticTextFrames.length, 1);
  assert.equal(result.mode, "binary");
});
