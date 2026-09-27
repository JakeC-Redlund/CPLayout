import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeNavsparkRawPayload, type NavsparkRawRecord } from "./navsparkRaw";

function dc(week = 1773, towMs = 185384000, periodMs = 1000, iod = 61): Uint8Array {
  const payload = new Uint8Array(10);
  const view = new DataView(payload.buffer);
  payload.set([0xdc, iod]);
  view.setUint16(2, week, false);
  view.setUint32(4, towMs, false);
  view.setUint16(8, periodMs, false);
  return payload;
}

function dd(count = 1, indicator = 7): Uint8Array {
  const payload = new Uint8Array(3 + 23 * count);
  const view = new DataView(payload.buffer);
  payload.set([0xdd, 61, count]);
  for (let i = 0; i < count; i += 1) {
    const r = 3 + 23 * i;
    payload[r] = i + 1;
    payload[r + 1] = 43;
    view.setFloat64(r + 2, 21245367.25 + i, false);
    view.setFloat64(r + 10, -38688.125 - i, false);
    view.setFloat32(r + 18, 642.5 + i, false);
    payload[r + 22] = indicator;
  }
  return payload;
}

test("DC decodes the publisher's BE example with no UTC or PVT synthesis", () => {
  const payload = Uint8Array.from([0xdc, 0x3d, 0x06, 0xed, 0x0b, 0x0c, 0xbc, 0x40, 0x03, 0xe8]);
  assert.deepEqual(decodeNavsparkRawPayload(payload), {
    kind: "DC", messageId: 0xdc, rawPayload: [...payload],
    iod: 61, receiverWeek: 1773, receiverTowMs: 185384000, measurementPeriodMs: 1000,
  });
});

test("DC accepts documented endpoints including zero week/TOW and IOD wrap values", () => {
  for (const week of [0, 65535]) for (const tow of [0, 604799999]) {
    for (const period of [1, 1000]) for (const iod of [0, 255]) {
      const result = decodeNavsparkRawPayload(dc(week, tow, period, iod));
      assert.equal(result.kind, "DC");
      if (result.kind !== "DC") assert.fail("expected DC");
      assert.equal(result.receiverWeek, week);
      assert.equal(result.receiverTowMs, tow);
      assert.equal(result.measurementPeriodMs, period);
      assert.equal(result.iod, iod);
    }
  }
});

test("DC reports all range violations and retains diagnostic values", () => {
  for (const tow of [604800000, 0xffffffff]) for (const period of [0, 1001, 65535]) {
    const result = decodeNavsparkRawPayload(dc(0, tow, period));
    assert.equal(result.kind, "invalid");
    if (result.kind !== "invalid" || result.decoded?.kind !== "DC") assert.fail("expected invalid DC");
    assert.deepEqual(result.issues, [
      { code: "out_of_range", field: "receiverTowMs" },
      { code: "out_of_range", field: "measurementPeriodMs" },
    ]);
    assert.equal(result.decoded.receiverTowMs, tow);
    assert.equal(result.decoded.measurementPeriodMs, period);
  }
});

test("known layouts reject truncated and extended payloads without partial records", () => {
  for (const payload of [dc().slice(0, 9), new Uint8Array([...dc(), 0]), dd().slice(0, 25),
    new Uint8Array([...dd(), 0]), Uint8Array.of(0xdd), Uint8Array.of(0xdd, 1), Uint8Array.of(0xdd, 1, 2)]) {
    const result = decodeNavsparkRawPayload(payload);
    assert.equal(result.kind, "invalid");
    if (result.kind !== "invalid") assert.fail("expected invalid length");
    assert.equal(result.issues[0].code, "invalid_length");
    assert.equal(result.decoded, undefined);
    assert.deepEqual(result.rawPayload, [...payload]);
  }
});

test("DD decodes a literal first record derived from the published example", () => {
  // AN0030 v1.4.35 pp. 42-44: first record unchanged, NMEAS adapted from 15 to 1.
  // Derived payload fixture only, not the publisher's complete frame or a live capture.
  const payload = Uint8Array.from([
    0xdd, 0x3d, 0x01,
    0x02, 0x2b,
    0x41, 0x74, 0x42, 0xdb, 0x76, 0x55, 0xfa, 0x29,
    0xc0, 0xe2, 0xe4, 0x02, 0x21, 0x5a, 0x00, 0x00,
    0x44, 0x20, 0x80, 0x00, 0x07,
  ]);
  assert.deepEqual(decodeNavsparkRawPayload(payload), {
    kind: "DD", messageId: 0xdd, rawPayload: [...payload], iod: 61, measurementCount: 1,
    records: [{
      svid: 2, cn0DbHz: 43, measurementIndicator: 7, unknownIndicatorBits: 0,
      cycleSlipPossible: false, coherentIntegrationAtLeast10Ms: false,
      pseudorangeMeters: {
        available: true, usable: true, rawValue: 21245367.395990524, value: 21245367.395990524,
      },
      carrierPhaseCycles: {
        available: true, usable: true, rawValue: -38688.06657123566, value: -38688.06657123566,
      },
      dopplerHz: { available: true, usable: true, rawValue: 642, value: 642 },
    }],
  });
});

test("DD uses 23-byte records, signed BE floats and a detached payload snapshot", () => {
  const payload = dd(2);
  const before = [...payload];
  const result = decodeNavsparkRawPayload(payload);
  assert.equal(result.kind, "DD");
  if (result.kind !== "DD") assert.fail("expected DD");
  assert.equal(result.iod, 61);
  assert.equal(result.measurementCount, 2);
  assert.equal(result.records.length, 2);
  for (let i = 0; i < 2; i += 1) {
    const record: NavsparkRawRecord = result.records[i];
    assert.equal(record.svid, i + 1);
    assert.equal(record.cn0DbHz, 43);
    assert.equal(record.pseudorangeMeters.value, 21245367.25 + i);
    assert.equal(record.carrierPhaseCycles.value, -38688.125 - i);
    assert.equal(record.dopplerHz.value, 642.5 + i);
  }
  assert.deepEqual([...payload], before);
  payload.fill(0);
  assert.deepEqual(result.rawPayload, before);
});

test("DD gates each measurement by its own availability bit and preserves every flag byte", () => {
  for (let indicator = 0; indicator <= 255; indicator += 1) {
    const result = decodeNavsparkRawPayload(dd(1, indicator));
    if (result.kind !== "DD") assert.fail("expected DD");
    const record = result.records[0];
    for (const [field, mask] of [["pseudorangeMeters", 1], ["dopplerHz", 2], ["carrierPhaseCycles", 4]] as const) {
      assert.equal(record[field].available, Boolean(indicator & mask));
      assert.equal(record[field].usable, Boolean(indicator & mask));
      assert.equal(record[field].value, indicator & mask ? record[field].rawValue : null);
    }
    assert.equal(record.measurementIndicator, indicator);
    assert.equal(record.unknownIndicatorBits, indicator & 0xe0);
    assert.equal(record.cycleSlipPossible, Boolean(indicator & 8));
    assert.equal(record.coherentIntegrationAtLeast10Ms, Boolean(indicator & 16));
  }
});

test("DD has no invented zero, sign, CN0, or SVID sentinel", () => {
  for (const value of [0, -1, 1]) {
    const payload = dd();
    const view = new DataView(payload.buffer);
    payload[3] = 255;
    payload[4] = 255;
    view.setFloat64(5, value, false);
    view.setFloat64(13, value, false);
    view.setFloat32(21, value, false);
    const result = decodeNavsparkRawPayload(payload);
    if (result.kind !== "DD") assert.fail("expected DD");
    const record = result.records[0];
    assert.equal(record.svid, 255);
    assert.equal(record.cn0DbHz, 255);
    for (const field of ["pseudorangeMeters", "carrierPhaseCycles", "dopplerHz"] as const) {
      assert.equal(record[field].value, value);
      assert.equal(record[field].usable, true);
    }
  }
});

test("available nonfinite floats invalidate the payload with JSON-safe diagnostic tokens", () => {
  for (const [field, offset, mask, width] of [
    ["pseudorangeMeters", 5, 1, 64], ["carrierPhaseCycles", 13, 4, 64], ["dopplerHz", 21, 2, 32],
  ] as const) for (const [value, token] of [[NaN, "NaN"], [Infinity, "+Infinity"], [-Infinity, "-Infinity"]] as const) {
    const payload = dd(1, mask);
    const view = new DataView(payload.buffer);
    if (width === 64) view.setFloat64(offset, value, false);
    else view.setFloat32(offset, value, false);
    const result = decodeNavsparkRawPayload(payload);
    if (result.kind !== "invalid" || result.decoded?.kind !== "DD") assert.fail("expected invalid DD");
    assert.deepEqual(result.issues, [{ code: "nonfinite_available_measurement", field, recordIndex: 0 }]);
    assert.deepEqual(result.decoded.records[0][field], { available: true, usable: false, rawValue: token, value: null });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test("unavailable nonfinite placeholders remain explicit diagnostics, never usable values", () => {
  const payload = dd(1, 0);
  const view = new DataView(payload.buffer);
  view.setFloat64(5, NaN, false);
  view.setFloat64(13, Infinity, false);
  view.setFloat32(21, -Infinity, false);
  const result = decodeNavsparkRawPayload(payload);
  if (result.kind !== "DD") assert.fail("expected unavailable DD");
  assert.deepEqual(result.records[0].pseudorangeMeters, { available: false, usable: false, rawValue: "NaN", value: null });
  assert.deepEqual(result.records[0].carrierPhaseCycles, { available: false, usable: false, rawValue: "+Infinity", value: null });
  assert.deepEqual(result.records[0].dopplerHz, { available: false, usable: false, rawValue: "-Infinity", value: null });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("DD preserves zero and maximum byte-representable counts without a hardware-capacity claim", () => {
  for (const count of [0, 255]) {
    const result = decodeNavsparkRawPayload(dd(count));
    if (result.kind !== "DD") assert.fail("expected DD");
    assert.equal(result.measurementCount, count);
    assert.equal(result.records.length, count);
  }
});

test("payload views honor nonzero byte offsets and lengths, including Node Buffers", () => {
  for (const payload of [dc(), dd(2)]) {
    const surrounding = Buffer.alloc(payload.length + 11, 0xff);
    surrounding.set(payload, 5);
    const slice = surrounding.subarray(5, 5 + payload.length);
    assert.deepEqual(decodeNavsparkRawPayload(slice), decodeNavsparkRawPayload(payload));
  }
});

test("unknown IDs and bytes are opaque, preserved and detached; invalid ID/size is explicit", () => {
  const payload = Uint8Array.of(0xe5, 0xa0, 0xa1, 0x0d, 0x0a, 0xff);
  const result = decodeNavsparkRawPayload(payload);
  assert.deepEqual(result, { kind: "unknown", messageId: 0xe5, rawPayload: [...payload] });
  payload.fill(0);
  assert.deepEqual(result.rawPayload, [0xe5, 0xa0, 0xa1, 0x0d, 0x0a, 0xff]);
  for (const [bytes, code] of [[new Uint8Array(), "empty_payload"], [Uint8Array.of(0), "invalid_message_id"],
    [new Uint8Array(65536).fill(1), "payload_too_long"]] as const) {
    const invalid = decodeNavsparkRawPayload(bytes);
    if (invalid.kind !== "invalid") assert.fail("expected invalid");
    assert.equal(invalid.issues[0].code, code);
  }
  assert.equal(decodeNavsparkRawPayload(new Uint8Array(65535).fill(0xff)).kind, "unknown");
});
