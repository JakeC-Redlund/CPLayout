import assert from "node:assert/strict";
import { test } from "node:test";
import { OperationalGgaTracker, evaluateOperationalCollectionGate, type ReceiverLineReceipt, type ReceiverRuntimeState } from "./operationalReceiver";
export function gga(time = "120000.00", quality = 4, identifier = "GNGGA"): string {
  return checksum(`${identifier},${time},4000.0000,N,10500.0000,W,${quality},12,0.8,1600,M,-20,M,0.5,0001`);
}
export function checksum(body: string): string { let sum = 0; for (const char of body) sum ^= char.charCodeAt(0); return `$${body}*${sum.toString(16).padStart(2, "0").toUpperCase()}`; }
function receipt(sequence: number, ms = sequence * 1000, extra: Partial<ReceiverLineReceipt> = {}): ReceiverLineReceipt {
  return { sessionId: "one", transport: "web_serial", sequence, receivedAt: "2026-09-28T12:00:00.000Z", browserReceivedMonotonicMs: ms, ingressAgeAtReceiptMs: 0, ...extra };
}
function state(tracker: OperationalGgaTracker): ReceiverRuntimeState { return { phase: "connected", config: { method: "usb", baudRate: 115200 }, sessionId: "one", observation: tracker.observation, sentenceCount: 1, incomingData: "receiving", status: tracker.reason, error: null }; }

test("operational capture accepts only checksummed positioned timed GP/GN fixed GGA without GST/RMC questionnaire", () => {
  for (const id of ["GPGGA", "GNGGA"]) {
    const tracker = new OperationalGgaTracker("one");
    assert.ok(tracker.accept(gga("120000.00", 4, id), receipt(1)));
    assert.equal(evaluateOperationalCollectionGate(state(tracker), "EPSG:32613", 1000).accepted, true);
    assert.equal(tracker.observation?.sentenceIdentifier, id);
  }
  for (const code of [0, 1, 2, 3, 5, 6, 7, 8, 9]) {
    const tracker = new OperationalGgaTracker("one"); tracker.accept(gga(), receipt(1));
    assert.equal(tracker.accept(gga("120001.00", code), receipt(2)), null);
  }
  for (const line of [gga().slice(0, -2) + "00", gga("250000"), gga("120000", 4, "GLGGA"), checksum("GNGGA,120000,,N,10500.0000,W,4,12,0.8,1600,M,-20,M,0.5,0001")]) {
    const tracker = new OperationalGgaTracker("one"); assert.equal(tracker.accept(line, receipt(1)), null);
  }
});
test("age includes companion delay and browser delivery, gate expires and rechecks ownership/projection", () => {
  const tracker = new OperationalGgaTracker("one"); tracker.accept(gga(), receipt(1, 4000, { ingressAgeAtReceiptMs: 1500 }));
  assert.equal(evaluateOperationalCollectionGate(state(tracker), "EPSG:32613", 4500).accepted, true);
  assert.equal(evaluateOperationalCollectionGate(state(tracker), "EPSG:32613", 4501).accepted, false);
  for (const crs of ["LOCAL:FIELD", "EPSG:4326", "EPSG:3857", "EPSG:999999"]) assert.equal(evaluateOperationalCollectionGate(state(tracker), crs, 4000).accepted, false);
  assert.equal(evaluateOperationalCollectionGate({ ...state(tracker), phase: "closing" }, "EPSG:32613", 4000).accepted, false);
  assert.equal(evaluateOperationalCollectionGate({ ...state(tracker), sessionId: "other" }, "EPSG:32613", 4000).accepted, false);
  assert.equal(evaluateOperationalCollectionGate(state(tracker), "EPSG:32613", 2000).accepted, false);
});
test("duplicates and late epochs close gate without refreshing and fresh epoch can recover", () => {
  const tracker = new OperationalGgaTracker("one"); tracker.accept(gga(), receipt(1));
  assert.equal(tracker.accept(gga(), receipt(2)), null);
  assert.equal(tracker.accept(gga("115959"), receipt(3)), null);
  assert.ok(tracker.accept(gga("120003"), receipt(4)));
  assert.equal(tracker.accept(gga("120004"), receipt(4)), null);
});
test("fixed float fixed and midnight rollover retain ordered epochs; wrong sessions and backlog refuse", () => {
  const tracker = new OperationalGgaTracker("one"); assert.ok(tracker.accept(gga("235959"), receipt(1)));
  assert.equal(tracker.accept(gga("000000", 5), receipt(2)), null);
  assert.ok(tracker.accept(gga("000001"), receipt(3)));
  assert.equal(tracker.accept(gga("000002"), receipt(4, 4000, { sessionId: "stale" })), null);
  assert.equal(tracker.accept(gga("000003"), receipt(5, 5000, { ingressAgeAtReceiptMs: 2500 })), null);
  const queued = new OperationalGgaTracker("one"); queued.accept(gga("120000"), receipt(1));
  assert.equal(queued.accept(gga("120020"), receipt(2, 1100)), null);
});
test("supplementary sentences neither require declaration nor reopen or refresh expired data", () => {
  const tracker = new OperationalGgaTracker("one"); tracker.accept(gga(), receipt(1));
  const original = tracker.observation;
  tracker.accept(checksum("GNGST,120000.00,0.1,0.1,0.1,0,0.1,0.1,0.2"), receipt(2, 4000));
  assert.equal(tracker.observation, original);
  assert.equal(evaluateOperationalCollectionGate(state(tracker), "EPSG:32613", 4000).accepted, false);
});

test("ready observations retain checksummed canonical GGA and require the evidence schema quality spelling", () => {
  const padded = new OperationalGgaTracker("one");
  assert.ok(padded.accept(gga() + "  ", receipt(1)));
  assert.equal(padded.observation?.sentence, gga());
  const quality04 = checksum("GNGGA,120000,4000.0000,N,10500.0000,W,04,12,0.8,1600,M,-20,M,0.5,0001");
  const tracker = new OperationalGgaTracker("one");
  assert.equal(tracker.accept(quality04, receipt(1)), null);
  assert.equal(evaluateOperationalCollectionGate(state(tracker), "EPSG:32613", 1000).accepted, false);
});
