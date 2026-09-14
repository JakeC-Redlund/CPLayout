import assert from "node:assert/strict";

import { defaultAppSettings } from "@cplayout/core";

import {
  captureEvidenceFromObservation,
  createNmeaStreamAccumulator,
  evaluateGnssObservationGate,
  evaluateRtkQualityGate,
  latestGnssObservationEpoch,
  mapGgaQuality,
  nmeaChecksumValid,
  parseNmeaLog,
  parseNmeaSentence,
  parseNmeaStreamChunk,
  rtkQualityFromNmeaSamples,
  surveyPointFromGnssObservation,
  surveyPointFromNmeaSamples,
  withNmeaReceptionMetadata,
} from "./nmea";

const ggaSentence = "$GPGGA,172814.0,4042.6142,N,10459.2715,W,4,18,0.6,1560.2,M,-21.3,M,1.2,0134*70";
assert.equal(nmeaChecksumValid(ggaSentence), true);
assert.equal(nmeaChecksumValid(ggaSentence.slice(0, ggaSentence.indexOf("*"))), false);
assert.equal(parseNmeaSentence(ggaSentence.slice(0, ggaSentence.indexOf("*"))), null);
assert.equal(nmeaChecksumValid("$GPGGA,172814.0,4042.6142,N,10459.2715,W,4,18,0.6,1560.2,M,-21.3,M,1.2,0134*5A"), false);
assert.equal(parseNmeaSentence("$GPGGA,172814.0,4042.6142,N,10459.2715,W,4,18,0.6,1560.2,M,-21.3,M,1.2,0134*5A"), null);

const gga = parseNmeaSentence(ggaSentence);

assert.equal(gga?.sentenceType, "GGA");
assert.equal(gga?.fixType, "rtk_fixed");
assert.equal(gga?.satellites, 18);
assert.equal(gga?.hdop, 0.6);
assert.equal(gga?.correctionAgeSeconds, 1.2);
assert.ok(gga?.latitude && gga.latitude > 40.7);
assert.ok(gga?.longitude && gga.longitude < -104.9);
assert.equal(mapGgaQuality(6), "unknown");

const malformedCoordinate = parseNmeaSentence(withChecksum("GPGGA,172814.0,9160.0000,N,18100.0000,E,4,18,0.6,1560.2,M,-21.3,M,1.2,0134"));
assert.equal(malformedCoordinate?.latitude, undefined);
assert.equal(malformedCoordinate?.longitude, undefined);

const rmc = parseNmeaSentence("$GPRMC,172814.0,A,4042.6142,N,10459.2715,W,0.0,0.0,190526,,,A*77");
assert.equal(rmc?.sentenceType, "RMC");
assert.ok(rmc?.longitude && rmc.longitude < 0);

const gst = parseNmeaSentence("$GPGST,172814.0,0.021,0.012,0.017,42.0,0.014,0.019,0.031*51");
assert.equal(gst?.sentenceType, "GST");
assert.equal(gst?.horizontalAccuracyMeters, Math.hypot(0.014, 0.019));
assert.equal(gst?.verticalAccuracyMeters, 0.031);

const replay = parseNmeaLog([
  "$GPGGA,172814.0,4042.6142,N,10459.2715,W,4,18,0.6,1560.2,M,-21.3,M,1.2,0134*70",
  "$GPGSA,A,3,01,02,03,04,05,06,07,08,09,10,11,12,1.1,0.6,0.9*3E",
  "$GPGST,172814.0,0.021,0.012,0.017,42.0,0.014,0.019,0.031*51",
]);
const quality = rtkQualityFromNmeaSamples(replay);
assert.equal(quality.fixType, "rtk_fixed");
assert.equal(quality.hdop, 0.6);
assert.equal(quality.verticalAccuracyMeters, 0.031);
assert.equal(evaluateRtkQualityGate(quality, defaultAppSettings().gpsQuality).accepted, true);
assert.equal(
  evaluateRtkQualityGate({ ...quality, satellites: 8 }, defaultAppSettings().gpsQuality).reasons.some((reason) => /satellites/.test(reason)),
  true,
);

let accumulator = createNmeaStreamAccumulator();
const firstChunk = parseNmeaStreamChunk(accumulator, "$GPGGA,172814.0,4042.6142,N,10459.2715,W,4,18,0.6,1560.2,M,-21.3,M,1.");
assert.equal(firstChunk.samples.length, 0);
accumulator = firstChunk.accumulator;
const secondChunk = parseNmeaStreamChunk(accumulator, "2,0134*70\r\n$GPGSA,A,3,01,02,03,04,05,06,07,08,09,10,11,12,1.1,0.6,0.9*3E\n");
assert.equal(secondChunk.samples.length, 2);
assert.equal(secondChunk.samples[0]?.fixType, "rtk_fixed");
assert.equal(secondChunk.accumulator.carry, "");

const stampedReplay = withNmeaReceptionMetadata([...replay, rmc!], {
  receivedAt: "2026-05-19T17:28:14.250Z",
  receivedMonotonicMs: 1000,
});
const epoch = latestGnssObservationEpoch(stampedReplay, "session-1");
assert.ok(epoch);
assert.equal(epoch.receiverObservedAt, "2026-05-19T17:28:14.000Z");
assert.deepEqual(epoch.sentenceTypes, ["GGA", "RMC", "GST"]);
assert.equal(epoch.quality.horizontalAccuracyMeters, Math.hypot(0.014, 0.019));
const acceptedEpochGate = evaluateGnssObservationGate(epoch, {
  projectCrs: "EPSG:32613",
  connected: true,
  nowMonotonicMs: 1500,
  sourceCoordinateFrame: "EPSG:4326",
}, defaultAppSettings().gpsQuality);
assert.equal(acceptedEpochGate.accepted, true);
assert.equal(acceptedEpochGate.observationAgeSeconds, 0.5);
assert.equal(acceptedEpochGate.quality.correctionAgeSeconds, 1.7);
assert.equal(evaluateGnssObservationGate(epoch, {
  connected: true,
  nowMonotonicMs: 3101,
  projectCrs: "EPSG:32613",
  sourceCoordinateFrame: "EPSG:4326",
}, defaultAppSettings().gpsQuality).reasonCodes.includes("stale_observation"), true);
assert.equal(evaluateGnssObservationGate(epoch, {
  connected: false,
  projectCrs: "EPSG:32613",
  nowMonotonicMs: 1500,
  sourceCoordinateFrame: "EPSG:4326",
}, defaultAppSettings().gpsQuality).reasonCodes.includes("not_connected"), true);
assert.equal(evaluateGnssObservationGate(epoch, {
  connected: true,
  nowMonotonicMs: 1500,
  sourceCoordinateFrame: "unknown",
  projectCrs: "EPSG:32613",
}, defaultAppSettings().gpsQuality).reasonCodes.includes("unconfirmed_source_crs"), true);

const voidRmc = parseNmeaSentence(withChecksum("GPRMC,172814.0,V,4042.6142,N,10459.2715,W,0.0,0.0,190526,,,A"));
assert.ok(voidRmc);
const voidEpoch = latestGnssObservationEpoch(withNmeaReceptionMetadata([replay[0], voidRmc], {
  receivedAt: "2026-05-19T17:28:14.250Z",
  receivedMonotonicMs: 2000,
}), "session-void");
assert.equal(voidEpoch?.coherent, false);
assert.equal(evaluateGnssObservationGate(voidEpoch, {
  projectCrs: "EPSG:32613",
  connected: true,
  nowMonotonicMs: 2100,
  sourceCoordinateFrame: "EPSG:4326",
}, defaultAppSettings().gpsQuality).reasonCodes.includes("incoherent_epoch"), true);

const mismatchedGst = parseNmeaSentence(withChecksum("GPGST,172815.0,0.021,0.012,0.017,42.0,0.014,0.019,0.031"));
assert.ok(mismatchedGst);
const unmatchedAccuracyEpoch = latestGnssObservationEpoch(withNmeaReceptionMetadata([replay[0], mismatchedGst], {
  receivedAt: "2026-05-19T17:28:14.250Z",
  receivedMonotonicMs: 3000,
}), "session-mismatch");
assert.equal(unmatchedAccuracyEpoch?.quality.horizontalAccuracyMeters, null);

const simulatedPoint = surveyPointFromNmeaSamples({
  samples: replay,
  projectCrs: "EPSG:32613",
  id: "replay-1",
  label: "Replay fix",
  observedAt: "2026-05-19T09:00:00-06:00",
});
assert.equal(simulatedPoint.confidence, "rtk_fixed");
assert.ok(simulatedPoint.projected.x > 0);
assert.equal(simulatedPoint.captureEvidence?.schemaVersion, "gnss-capture-v1");

const directPoint = surveyPointFromGnssObservation({
  observation: epoch,
  projectCrs: "EPSG:32613",
  sourceCoordinateFrame: "EPSG:4326",
  transport: "web_serial",
  id: "direct-1",
  label: "Direct fix",
});
assert.equal(directPoint.captureEvidence?.observationId, epoch.id);
assert.equal(captureEvidenceFromObservation({ observation: epoch, transport: "replay", sourceCoordinateFrame: "EPSG:4326" }).height?.type, "orthometric");
assert.throws(() => surveyPointFromGnssObservation({
  observation: epoch,
  projectCrs: "EPSG:32613",
  sourceCoordinateFrame: "unknown",
  transport: "replay",
  id: "blocked-source",
  label: "Blocked",
}), /explicitly confirmed EPSG:4326/);

function withChecksum(body: string): string {
  let checksum = 0;
  for (const character of body) checksum ^= character.charCodeAt(0);
  return `$${body}*${checksum.toString(16).toUpperCase().padStart(2, "0")}`;
}

console.log("nmea tests passed");
