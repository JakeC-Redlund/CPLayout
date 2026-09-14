import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultAppSettings } from "@cplayout/core";

import {
  createNmeaStreamAccumulator,
  evaluateGnssObservationGate,
  evaluateRtkQualityGate,
  latestGnssObservationEpoch,
  parseNmeaSentence,
  parseNmeaStreamChunk,
  surveyPointFromGnssObservation,
  withNmeaReceptionMetadata,
} from "./nmea";

const gga = "GNGGA,123519.00,3900.000000,N,10400.000000,W,4,18,0.6,1600.0,M,-20.0,M,0.5,0000";
const gst = "GNGST,123519.00,0.01,0.01,0.01,0.0,0.01,0.01,0.02";
const rmc = "GNRMC,123519.00,A,3900.000000,N,10400.000000,W,0.0,0.0,130926,,,A";
const thresholds = defaultAppSettings().gpsQuality;
const context = { connected: true, nowMonotonicMs: 1500, sourceCoordinateFrame: "EPSG:4326", projectCrs: "EPSG:32613" };

function sentence(body: string): string {
  const checksum = [...body].reduce((value, character) => value ^ character.charCodeAt(0), 0);
  return `$${body}*${checksum.toString(16).padStart(2, "0")}`;
}

function sample(body: string, receivedMonotonicMs = 1000) {
  const parsed = parseNmeaSentence(sentence(body));
  assert.ok(parsed);
  return withNmeaReceptionMetadata([parsed], {
    receivedAt: "2026-09-13T12:35:19.000Z",
    receivedMonotonicMs,
  })[0];
}

function observation() {
  const result = latestGnssObservationEpoch([sample(gga), sample(gst), sample(rmc)], "safety");
  assert.ok(result);
  return result;
}

test("capture requires a metric destination with an admitted WGS84 projection", () => {
  const epoch = observation();
  const before = JSON.stringify(epoch);
  for (const projectCrs of ["EPSG:26741", "LOCAL:TEST", "EPSG:3857", "EPSG:900913", "EPSG:26913", "EPSG:26713", "EPSG:26723", "", undefined]) {
    const gate = evaluateGnssObservationGate(epoch, { ...context, projectCrs: projectCrs as string }, thresholds);
    assert.equal(gate.accepted, false, String(projectCrs));
    assert.ok(gate.reasonCodes.includes("unqualified_project_crs"));
    assert.throws(() => surveyPointFromGnssObservation({
      observation: epoch, projectCrs: projectCrs as string, sourceCoordinateFrame: "EPSG:4326",
      transport: "replay", id: "blocked", label: "Blocked destination",
    }), /destination|CRS|qualified/i);
  }
  assert.equal(evaluateGnssObservationGate(epoch, context, thresholds).accepted, true);
  assert.equal(JSON.stringify(epoch), before);
});

test("a newer positionless or malformed GGA cannot resurrect the preceding fixed solution", () => {
  for (const invalid of [
    "GNGGA,123520.00,,,,,0,0,,,,,,,*",
    gga.replace("3900.000000", "9960.000000"),
    gga.replace("123519.00", ""),
  ]) {
    const result = latestGnssObservationEpoch([
      sample(gga), sample(gst), sample(rmc), sample(invalid.replace(/\*$/, ""), 1100),
    ], "safety");
    assert.equal(result, null, invalid);
  }
});

test("GST horizontal uncertainty is two-axis RMS and requires both nonnegative components", () => {
  const body = gst.replace("0.01,0.01,0.02", "0.03,0.04,0.02");
  assert.equal(sample(body).horizontalAccuracyMeters, 0.05);
  for (const component of ["", " ", "-0.01", "0x0", "1e-4", "Infinity", "NaN"]) {
    const fields = gst.split(",");
    fields[6] = component;
    assert.equal(sample(fields.join(",")).horizontalAccuracyMeters, undefined, component);
  }
});

test("NMEA coordinates and measurements reject non-decimal or physically invalid values", () => {
  for (const coordinate of ["0xF3C", "3.9e3", "+3900", "3900 ", "390"]) {
    assert.equal(sample(gga.replace("3900.000000", coordinate)).latitude, undefined, coordinate);
  }
  for (const value of ["-0.1", "0x0", "1e-5", " ", "Infinity", "NaN", "0"]) {
    const invalid = gga.replace(",18,0.6,", `,18,${value},`);
    const result = latestGnssObservationEpoch([sample(invalid), sample(gst)], "safety");
    assert.equal(evaluateGnssObservationGate(result, context, thresholds).accepted, false, value);
  }
});

test("quality gates fail closed on malformed required measurements", () => {
  const quality = observation().quality;
  for (const field of ["satellites", "hdop", "horizontalAccuracyMeters", "correctionAgeSeconds"] as const) {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      assert.equal(evaluateRtkQualityGate({ ...quality, [field]: value }, thresholds).accepted, false, `${field}: ${value}`);
    }
  }
  assert.equal(evaluateRtkQualityGate({ ...quality, satellites: 18.5 }, thresholds).accepted, false);
  assert.equal(evaluateRtkQualityGate({ ...quality, hdop: 0 }, thresholds).accepted, false);
  assert.equal(evaluateRtkQualityGate({ ...quality, fixType: "invalid" }, { ...thresholds, minimumFixType: "invalid" }).accepted, false);
});

test("quality gates reject invalid threshold configuration", () => {
  for (const field of ["maxHdop", "minSatellites", "maxHorizontalAccuracyMeters", "maxCorrectionAgeSeconds", "maxObservationAgeSeconds"] as const) {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      assert.equal(evaluateRtkQualityGate(observation().quality, { ...thresholds, [field]: value }).accepted, false, `${field}: ${value}`);
    }
  }
});

test("invalid and future monotonic timestamps cannot bypass freshness", () => {
  for (const nowMonotonicMs of [Number.NaN, Number.POSITIVE_INFINITY, -1, 999]) {
    assert.equal(evaluateGnssObservationGate(observation(), { ...context, nowMonotonicMs }, thresholds).accepted, false);
  }
  for (const receivedMonotonicMs of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.equal(evaluateGnssObservationGate({ ...observation(), receivedMonotonicMs }, context, thresholds).accepted, false);
  }
});

test("malformed observation positions are never eligible for capture", () => {
  for (const position of [
    { latitude: Number.NaN, longitude: -104 },
    { latitude: 91, longitude: -104 },
    { latitude: 39, longitude: Number.POSITIVE_INFINITY },
    { latitude: 39, longitude: -181 },
  ]) {
    assert.equal(evaluateGnssObservationGate({ ...observation(), position }, context, thresholds).accepted, false);
  }
});

test("present RMC must contain a valid measured solution with matching coordinates and date", () => {
  for (const invalid of [
    rmc.replace(",A,", ",X,"),
    rmc.replace("3900.000000", ""),
    rmc.replace("130926", "310226"),
    rmc.replace(/,A$/, ",N"),
    rmc.replace(/,A$/, ",E"),
    rmc.replace(/,A$/, ",M"),
    rmc.replace(/,A$/, ",S"),
  ]) {
    const result = latestGnssObservationEpoch([sample(gga), sample(gst), sample(invalid)], "safety");
    assert.equal(result?.coherent, false, invalid);
  }
});

test("matching time-of-day alone cannot attach old GST accuracy to a new GGA", () => {
  const result = latestGnssObservationEpoch([sample(gst, 1000), sample(gga, 10_000)], "safety");
  assert.equal(result?.quality.horizontalAccuracyMeters, null);
});

test("repeated receiver epochs preserve their first receipt time beyond the rolling sample window", () => {
  const previous = observation();
  const repeated = latestGnssObservationEpoch([sample(gga, 5000), sample(gst, 5000)], "safety", previous);
  assert.ok(repeated);
  assert.equal(repeated.receivedMonotonicMs, previous.receivedMonotonicMs);
  assert.equal(repeated.id, previous.id);
  assert.equal(evaluateGnssObservationGate(repeated, { ...context, nowMonotonicMs: 5000 }, thresholds).accepted, false);
  const next = latestGnssObservationEpoch([
    sample(gga.replace("123519.00", "123520.00"), 5100),
    sample(gst.replace("123519.00", "123520.00"), 5100),
  ], "safety", repeated);
  assert.ok(next);
  assert.equal(next.receivedMonotonicMs, 5100);
  assert.equal(evaluateGnssObservationGate(next, { ...context, nowMonotonicMs: 5200 }, thresholds).accepted, true);
});

test("new sessions and dated day rollover are not mistaken for replayed epochs", () => {
  const previous = observation();
  const samples = [sample(gga, 5000), sample(gst, 5000), sample(rmc, 5000)];
  assert.equal(latestGnssObservationEpoch(samples, "new-session", previous)?.receivedMonotonicMs, 5000);
  const nextDay = [...samples.slice(0, 2), sample(rmc.replace("130926", "140926"), 5000)];
  assert.equal(latestGnssObservationEpoch(nextDay, "safety", previous)?.receivedMonotonicMs, 5000);
});

test("height without explicit metre units is not silently recorded as orthometric metres", () => {
  assert.equal(sample(gga.replace("1600.0,M", "1600.0,F")).altitudeMeters, undefined);
  assert.equal(sample(gga.replace("-20.0,M", "-20.0,F")).geoidSeparationMeters, undefined);
});

test("stream carry is bounded and resynchronizes after damaged input", () => {
  const oversized = parseNmeaStreamChunk(createNmeaStreamAccumulator(), "$" + "x".repeat(100_000));
  assert.ok(oversized.accumulator.carry.length <= 1024);
  const recovered = parseNmeaStreamChunk(oversized.accumulator, sentence(gga) + "\r\n");
  assert.equal(recovered.samples.length, 1);
  assert.equal(recovered.samples[0].fixType, "rtk_fixed");
  const prefixed = parseNmeaStreamChunk(createNmeaStreamAccumulator("noise"), sentence(gga) + "\n");
  assert.equal(prefixed.samples.length, 1);
});

test("nonstandard sentence headers do not masquerade as measured GNSS messages", () => {
  assert.equal(parseNmeaSentence(sentence(gga.replace("GNGGA", "FAKEGGA"))), null);
});

test("point creation refuses an invalid fix even when the caller asserts coherence", () => {
  assert.throws(() => surveyPointFromGnssObservation({
    observation: { ...observation(), quality: { ...observation().quality, fixType: "invalid" } },
    projectCrs: "EPSG:32613", sourceCoordinateFrame: "EPSG:4326", transport: "replay",
    id: "invalid", label: "Invalid",
  }), /invalid|usable/i);
});
