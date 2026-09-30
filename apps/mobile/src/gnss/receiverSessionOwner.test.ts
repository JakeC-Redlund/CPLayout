import assert from "node:assert/strict";
import { test } from "node:test";
import type { GnssSession, GnssTransportEvent, ReceiverConnectionConfig } from "@cplayout/gnss";
import { ReceiverSessionOwner } from "./receiverSessionOwner";
function gga(time = "120000", quality = 4) { const body = `GNGGA,${time},4000.0000,N,10500.0000,W,${quality},12,0.8,1600,M,-20,M,0.5,0001`; let checksum = 0; for (const c of body) checksum ^= c.charCodeAt(0); return `$${body}*${checksum.toString(16).padStart(2, "0")}\r\n`; }
function stream(id = "session-one") {
  let resolve: ((event: GnssTransportEvent) => void) | null = null;
  const queue: GnssTransportEvent[] = [];
  let closes = 0;
  const session: GnssSession = { id,
    async *events() { while (true) { const event = queue.shift() ?? await new Promise<GnssTransportEvent>(r => { resolve = r; }); yield event; if (event.type === "ended") return; } },
    async close() { closes++; push({ type: "ended", reason: "closed" }); },
  };
  function push(event: GnssTransportEvent) { const pending = resolve; resolve = null; if (pending) pending(event); else queue.push(event); }
  return { session, push, get closes() { return closes; } };
}
async function flush() { await new Promise(resolve => setTimeout(resolve, 0)); }
function bytes(line: string, ms: number, extra = {}): GnssTransportEvent { return { type: "bytes", bytes: new TextEncoder().encode(line), receivedAt: "2026-09-28T12:00:00.000Z", receivedMonotonicMs: ms, ...extra }; }

test("shared owner survives screen subscriber replacement; capture preserves exact projected/evidence identities", async () => {
  const input = stream(); let now = 1000;
  const owner = new ReceiverSessionOwner(() => ({ open: async () => input.session }), () => now);
  await owner.connect({ method: "usb", baudRate: 115200 });
  const unsubscribe = owner.subscribe(() => undefined); unsubscribe();
  input.push(bytes(gga(), now)); await flush();
  assert.equal(owner.collectionGate("EPSG:32613").accepted, true);
  const point = owner.capture("EPSG:32613", "capture-one", "point");
  assert.equal(point.captureEvidence.schemaVersion, "gnss-operational-fixed-v1");
  assert.equal(point.captureEvidence.gga.sentenceIdentifier, "GNGGA");
  assert.equal(point.captureEvidence.sessionId, input.session.id);
  assert.equal(point.captureEvidence.capture.ageMs, 0);
  assert.equal(point.source, "external_gnss");
  assert.ok(Math.abs(point.projected.x - 500000) < 0.01);
  now = 3001;
  assert.throws(() => owner.capture("EPSG:32613", "capture-two", "stale"), /stale/);
  assert.equal(input.closes, 0);
  await owner.disconnect(); assert.equal(input.closes, 1);
});
test("float, invalid checksum, duplicate, disconnect and reconnect close collection until a fresh owned epoch", async () => {
  let input = stream(); let now = 1000;
  const owner = new ReceiverSessionOwner(() => ({ open: async () => input.session }), () => now);
  await owner.connect({ method: "bluetooth_spp", baudRate: 9600 });
  input.push(bytes(gga(), now)); await flush();
  assert.equal(owner.capture("EPSG:32613", "a", "A").captureEvidence.transport, "bluetooth_spp");
  input.push(bytes(gga(), now + 100)); await flush(); assert.equal(owner.collectionGate("EPSG:32613").accepted, false);
  now = 2000; input.push(bytes(gga("120001", 5), now)); await flush(); assert.equal(owner.collectionGate("EPSG:32613").accepted, false);
  now = 3000; input.push(bytes(gga("120002"), now)); await flush(); assert.equal(owner.collectionGate("EPSG:32613").accepted, true);
  input.push(bytes("$GNGGA,bad*00\r\n", now)); await flush(); assert.equal(owner.collectionGate("EPSG:32613").accepted, false);
  await owner.disconnect(); input = stream("session-two"); await owner.connect({ method: "usb", baudRate: 115200 });
  assert.equal(owner.collectionGate("EPSG:32613").accepted, false);
  now = 4000; input.push(bytes(gga("120003"), now)); await flush(); assert.equal(owner.collectionGate("EPSG:32613").accepted, true);
  await owner.disconnect();
});
test("network ingress delay is retained and commands revalidate it", async () => {
  const input = stream(); let now = 5000;
  const owner = new ReceiverSessionOwner(() => ({ open: async () => input.session }), () => now);
  await owner.connect({ method: "network", protocol: "tcp", address: "127.0.0.1", port: 5000 });
  input.push(bytes(gga(), now, { ingressAgeAtReceiptMs: 1750, ingressSequence: 22 })); await flush();
  assert.equal(owner.capture("EPSG:32613", "a", "A").captureEvidence.capture.ageMs, 1750);
  now += 251; assert.throws(() => owner.capture("EPSG:32613", "b", "B"), /stale/);
  await owner.disconnect();
});
test("denied connection and late permission resolution cannot leave an eligible observation", async () => {
  const denied = new ReceiverSessionOwner(() => ({ open: async () => { throw new Error("Permission denied"); } }));
  await assert.rejects(denied.connect({ method: "usb", baudRate: 115200 }), /Permission denied/);
  assert.equal(denied.getSnapshot().phase, "idle");
  const input = stream(); let resolve!: (value: GnssSession) => void;
  const owner = new ReceiverSessionOwner(() => ({ open: () => new Promise(r => { resolve = r; }) }));
  const opening = owner.connect({ method: "usb", baudRate: 115200 });
  await owner.disconnect(); resolve(input.session); await opening;
  assert.equal(owner.getSnapshot().phase, "idle"); assert.equal(input.closes, 1);
});
test("cleanup failure blocks switch and allows explicit retry", async () => {
  const input = stream(); let failed = false;
  const original = input.session.close; input.session.close = async () => { if (!failed) { failed = true; throw new Error("busy"); } await original(); };
  const owner = new ReceiverSessionOwner(() => ({ open: async () => input.session }));
  await owner.connect({ method: "usb", baudRate: 115200 });
  await assert.rejects(owner.disconnect(), /busy/); assert.equal(owner.getSnapshot().phase, "cleanup_failed");
  await assert.rejects(owner.connect({ method: "usb", baudRate: 9600 }), /Disconnect/);
  await owner.disconnect(); assert.equal(owner.getSnapshot().phase, "idle");
});

test("repeated cancellation keeps pending permission ownership and refuses competing connection", async () => {
  const input = stream(); let resolve!: (value: GnssSession) => void; let opens = 0;
  const owner = new ReceiverSessionOwner(() => ({ open: () => { opens++; return new Promise(r => { resolve = r; }); } }));
  const pending = owner.connect({ method: "usb", baudRate: 115200 });
  await owner.disconnect(); await owner.disconnect();
  assert.equal(owner.getSnapshot().phase, "closing");
  await assert.rejects(owner.connect({ method: "usb", baudRate: 9600 }), /Disconnect/);
  assert.equal(opens, 1);
  resolve(input.session); await pending;
  assert.equal(input.closes, 1); assert.equal(owner.getSnapshot().phase, "idle");
});
test("unfinished collection draft and purpose choices survive navigation with strict project and CRS scope", () => {
  const owner = new ReceiverSessionOwner();
  owner.updateCollectionView("project-one", "EPSG:32613", view => ({ ...view, surveyRole: "boundary", obstacleKind: "fence", mapFeatureKind: "measurement_line" }));
  assert.equal(owner.collectionView("project-one", "EPSG:32613").surveyRole, "boundary");
  assert.equal(owner.collectionView("project-two", "EPSG:32613").surveyRole, "control");
  assert.equal(owner.collectionView("project-one", "EPSG:32614").obstacleKind, "exclusion");
  assert.equal(owner.collectionView("project-one", "EPSG:32613").obstacleKind, "fence");
});

test("two mounted receiver views share unfinished settings and retained Connect handlers use the latest shared form", async () => {
  const configs: ReceiverConnectionConfig[] = [];
  const owner = new ReceiverSessionOwner(config => {
    configs.push(config);
    return { open: async () => stream(`session-${configs.length}`).session };
  });
  let survey = owner.getSnapshot();
  let layout = owner.getSnapshot();
  const stopSurvey = owner.subscribe(() => { survey = owner.getSnapshot(); });
  const stopLayout = owner.subscribe(() => { layout = owner.getSnapshot(); });
  const retainedSurveyConnect = () => owner.connectFromForm();
  try {
    owner.updateConnectionForm({ method: "network", protocol: "udp", address: "127.0.", port: "50", sourceAddress: "192.168." });
    assert.equal(survey.connectionForm.address, "127.0.");
    assert.equal(layout.connectionForm.sourceAddress, "192.168.");
    owner.updateConnectionForm({ address: "127.0.0.1", port: "05000" });
    assert.equal(survey.connectionForm.sourceAddress, "192.168.", "an edit in one view cannot replace another field with its old render value");
    owner.updateConnectionForm({ sourceAddress: "127.0.0.1" });
    await retainedSurveyConnect();
    assert.deepEqual(configs[0], { method: "network", protocol: "udp", address: "127.0.0.1", port: 5000, sourceAddress: "127.0.0.1" });
    assert.equal(survey.phase, "connected");
    assert.equal(layout.phase, "connected");
    assert.equal(survey.connectionForm.method, "network");
    assert.equal(layout.connectionForm.port, "05000", "accepted raw input remains visible rather than being reformatted");
    assert.equal(owner.updateConnectionForm({ method: "usb", baudRate: "9600" }), false, "a retained inactive view cannot overwrite live connection settings");
    await owner.disconnect();
    await retainedSurveyConnect();
    assert.deepEqual(configs[1], configs[0], "returning to Survey must not reconnect its obsolete COM configuration");
  } finally { await owner.disconnect(); stopSurvey(); stopLayout(); }
});

test("validation and transport errors are shared and successful sibling connection clears old errors without losing input", async () => {
  let attempts = 0;
  const owner = new ReceiverSessionOwner(() => ({ open: async () => {
    if (++attempts === 1) throw new Error("Receiver denied connection");
    return stream().session;
  } }));
  let survey = owner.getSnapshot();
  let layout = owner.getSnapshot();
  const stopSurvey = owner.subscribe(() => { survey = owner.getSnapshot(); });
  const stopLayout = owner.subscribe(() => { layout = owner.getSnapshot(); });
  try {
    owner.updateConnectionForm({ baudRate: "unfinished" });
    await assert.rejects(owner.connectFromForm(), /baud rate/);
    assert.equal(attempts, 0);
    assert.equal(survey.connectionForm.baudRate, "unfinished");
    assert.equal(survey.error, layout.error);
    assert.match(layout.error!, /baud rate/);
    owner.updateConnectionForm({ baudRate: " 09600 " });
    assert.equal(survey.error, null);
    assert.doesNotMatch(survey.status, /baud rate/);
    await assert.rejects(owner.connectFromForm(), /Receiver denied/);
    assert.equal(layout.connectionForm.baudRate, " 09600 ");
    assert.equal(survey.error, "Receiver denied connection");
    assert.equal(layout.error, survey.error);
    await owner.connectFromForm();
    assert.equal(survey.phase, "connected");
    assert.equal(survey.error, null);
    assert.equal(layout.error, null);
    assert.match(survey.status, /^Connected/);
    assert.equal(layout.status, survey.status);
  } finally { await owner.disconnect(); stopSurvey(); stopLayout(); }
});

test("explicit connection configuration updates every view while retaining unused unfinished settings", async () => {
  const owner = new ReceiverSessionOwner(() => ({ open: async () => stream().session }));
  owner.updateConnectionForm({ sourceAddress: "192.168.", baudRate: "115200" });
  await owner.connect({ method: "network", protocol: "tcp", address: "127.0.0.1", port: 5001 });
  assert.equal(owner.getSnapshot().connectionForm.method, "network");
  assert.equal(owner.getSnapshot().connectionForm.port, "5001");
  assert.equal(owner.getSnapshot().connectionForm.sourceAddress, "192.168.");
  await owner.disconnect();
  assert.equal(owner.getSnapshot().connectionForm.baudRate, "115200");
  assert.equal(Object.isFrozen(owner.getSnapshot().connectionForm), true);
});
