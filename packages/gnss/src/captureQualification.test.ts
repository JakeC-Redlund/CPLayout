import assert from "node:assert/strict";
import test from "node:test";
import { defaultAppSettings, GnssCaptureEvidenceSchema, type GnssReferenceDeclaration } from "@cplayout/core";
import { captureGnssObservation, evaluateGnssCaptureGate, type GnssCaptureContext } from "./captureQualification";
import { latestGnssObservationEpoch, parseNmeaSentence, withNmeaReceptionMetadata, type GnssObservationEpoch } from "./nmea";

const thresholds = defaultAppSettings().gpsQuality;
const declaration: GnssReferenceDeclaration = {
  schemaVersion: "gnss-reference-declaration-v1", provenance: "operator_declared",
  receiverModel: "Synthetic GST receiver", receiverFirmware: "synthetic-1", referenceFrame: "WGS84",
  realization: "synthetic-realization", coordinateEpochUtc: "2026-01-01T00:00:00.000Z",
  verticalDatum: "synthetic-datum", geoidModel: "synthetic-geoid", antennaModel: "synthetic-antenna",
  antennaReference: "arp", reportedPoint: "synthetic-arp", targetPoint: "synthetic-arp",
  antennaHeightMeters: 1.8, offsetTreatment: "none_reported_point",
};
function observation(extraBodies: string[] = []): GnssObservationEpoch {
  const bodies = [
    "GNGGA,123519.00,3900.000000,N,10400.000000,W,4,18,0.6,1600.0,M,-20.0,M,0.5,0000",
    "GNGST,123519.00,0.01,0.01,0.01,0.0,0.01,0.01,0.02",
    "GNRMC,123519.00,A,3900.000000,N,10400.000000,W,0.0,0.0,130926,,,A",
    ...extraBodies,
  ];
  const samples = bodies.map(body => parseNmeaSentence(`$${body}*${[...body].reduce((sum, char) => sum ^ char.charCodeAt(0), 0).toString(16).padStart(2, "0")}`)!);
  return latestGnssObservationEpoch(withNmeaReceptionMetadata(samples, {
    receivedAt: "2026-09-13T12:35:19.000Z", receivedMonotonicMs: 1000,
  }), "synthetic-session")!;
}
function context(): GnssCaptureContext {
  return { connected: true, projectCrs: "EPSG:32613", sourceCoordinateFrame: "EPSG:4326", nowMonotonicMs: 1500,
    sessionReference: { sessionId: "synthetic-session", declaration: structuredClone(declaration) } };
}
function capture(epoch = observation(), current = context()) {
  return captureGnssObservation({ observation: epoch, context: current, thresholds, transport: "replay", id: "synthetic-point", label: "Synthetic point" });
}

test("screened collection preserves raw height and declarations without claiming measured 3D accuracy", () => {
  const epoch = observation(), current = context();
  const before = JSON.stringify({ epoch, current });
  const gate = evaluateGnssCaptureGate(epoch, current, thresholds);
  assert.equal(gate.accepted, true);
  assert.equal(gate.physicalQualification, "unverified");
  assert.equal(gate.positionStandardUncertaintyMeters, Math.hypot(Math.hypot(0.01, 0.01), 0.02));
  const point = capture(epoch, current);
  assert.equal(point.captureEvidence.schemaVersion, "gnss-capture-v2");
  assert.equal(point.captureEvidence.height.meters, 1600);
  assert.equal(point.captureEvidence.height.geoidSeparationMeters, -20);
  assert.equal(point.captureEvidence.qualityScreen.receiverQuality.correctionAgeSeconds, 0.5);
  assert.equal(point.rtk?.correctionAgeSeconds, 1);
  assert.equal(point.captureEvidence.qualityScreen.physicalQualification, "unverified");
  assert.equal(JSON.stringify({ epoch, current }), before);
  (current.sessionReference!.declaration as GnssReferenceDeclaration).antennaModel = "changed-later";
  epoch.quality.verticalAccuracyMeters = 200;
  epoch.sentenceTypes.push("changed-later");
  assert.equal(point.captureEvidence.referenceDeclaration.antennaModel, declaration.antennaModel);
  assert.equal(point.captureEvidence.qualityScreen.receiverQuality.verticalAccuracyMeters, 0.02);
  assert.deepEqual(point.captureEvidence.sentenceTypes, ["GGA", "RMC", "GST"]);
});

test("missing or invalid vertical evidence cannot enter the live collection constructor", () => {
  for (const value of [null, -1, NaN, Infinity, -Infinity]) {
    const epoch = observation(); epoch.quality.verticalAccuracyMeters = value;
    assert.equal(evaluateGnssCaptureGate(epoch, context(), thresholds).accepted, false);
    assert.throws(() => capture(epoch), /collection blocked/);
  }
  for (const field of ["altitudeMeters", "geoidSeparationMeters"] as const) {
    for (const value of [null, NaN, Infinity]) {
      const epoch = observation(); epoch[field] = value;
      assert.throws(() => capture(epoch), /height|geoid/);
    }
  }
  const zero = observation(); zero.altitudeMeters = 0; zero.geoidSeparationMeters = 0;
  assert.equal(capture(zero).captureEvidence.height.meters, 0);
});

test("freshness, disconnected state, unsupported projection and session mismatch cannot bypass collection gating", () => {
  for (const mutate of [
    (current: GnssCaptureContext) => { current.connected = false; },
    (current: GnssCaptureContext) => { current.nowMonotonicMs = 4000; },
    (current: GnssCaptureContext) => { current.nowMonotonicMs = 999; },
    (current: GnssCaptureContext) => { current.projectCrs = "EPSG:3857"; },
    (current: GnssCaptureContext) => { current.sourceCoordinateFrame = "EPSG:4269"; },
    (current: GnssCaptureContext) => { current.sessionReference!.sessionId = "previous-session"; },
    (current: GnssCaptureContext) => { current.sessionReference = null; },
  ]) {
    const current = context(); mutate(current);
    assert.throws(() => capture(observation(), current), /collection blocked/);
  }
});

test("a valid declaration without an observation is not a session mismatch or qualified reference", () => {
  const gate = evaluateGnssCaptureGate(null, context(), thresholds);
  assert.equal(gate.accepted, false);
  assert.deepEqual(gate.reasonCodes, ["no_observation"]);
  assert.equal(gate.reasons.some(reason => reason.includes("does not belong")), false);
  assert.equal(gate.referenceDeclaration, null);
  assert.equal(gate.positionStandardUncertaintyMeters, null);
  assert.equal(gate.physicalQualification, "unverified");
});

test("an observed session mismatch still rejects the declaration and collection", () => {
  const current = context();
  current.sessionReference!.sessionId = "previous-session";
  const epoch = observation();
  const gate = evaluateGnssCaptureGate(epoch, current, thresholds);
  assert.equal(gate.accepted, false);
  assert.ok(gate.reasonCodes.includes("session_reference"));
  assert.equal(gate.reasonCodes.includes("no_observation"), false);
  assert.ok(gate.reasons.includes("Reference declaration does not belong to the current receiver session."));
  assert.equal(gate.referenceDeclaration, null);
  assert.equal(gate.physicalQualification, "unverified");
  assert.throws(() => capture(epoch, current), /does not belong/);
});

test("a missing declaration remains required with or without an observation", () => {
  for (const epoch of [null, observation()]) {
    const current = context();
    current.sessionReference = null;
    const gate = evaluateGnssCaptureGate(epoch, current, thresholds);
    assert.equal(gate.accepted, false);
    assert.ok(gate.reasonCodes.includes("session_reference"));
    assert.equal(gate.reasonCodes.includes("no_observation"), epoch === null);
    assert.ok(gate.reasons.includes("Complete the receiver reference declaration before collecting projected observations."));
    assert.equal(gate.reasons.some(reason => reason.includes("does not belong")), false);
    assert.equal(gate.referenceDeclaration, null);
    assert.equal(gate.physicalQualification, "unverified");
  }
});

test("required metadata cannot be supplied through placeholders, unreviewed frames or implicit offsets", () => {
  for (const value of [
    { ...declaration, receiverFirmware: "unknown" }, { ...declaration, realization: " TBD " },
    { ...declaration, referenceFrame: "NAD83" }, { ...declaration, antennaHeightMeters: NaN },
    { ...declaration, coordinateEpochUtc: "2026-02-30T00:00:00.000Z" },
    { ...declaration, coordinateEpochUtc: "2026-01-01T00:00:00.0001Z" },
    { ...declaration, targetPoint: "ground-tip" }, { ...declaration, physicallyVerified: true },
  ]) {
    const current = context(); current.sessionReference!.declaration = value;
    assert.throws(() => capture(observation(), current), /reference declaration/);
  }
});

test("v2 evidence requires coherent dated GGA GST RMC and validates its capture-time policy", () => {
  for (const missing of ["GGA", "GST", "RMC"]) {
    const epoch = observation(); epoch.sentenceTypes = epoch.sentenceTypes.filter(type => type !== missing);
    assert.throws(() => capture(epoch), /collection blocked/);
  }
  const undated = observation(); undated.receiverObservedAt = null;
  assert.throws(() => capture(undated), /collection blocked/);
  const captured = capture().captureEvidence;
  for (const patch of [
    { physicalQualification: "verified" }, { evaluatedMonotonicMs: 4000 },
    { receiverQuality: { ...captured.qualityScreen.receiverQuality, verticalAccuracyMeters: null } },
    { receiverQuality: { ...captured.qualityScreen.receiverQuality, horizontalAccuracyMeters: 1 } },
  ]) assert.equal(GnssCaptureEvidenceSchema.safeParse({ ...captured, qualityScreen: { ...captured.qualityScreen, ...patch } }).success, false);
});

test("reported standard uncertainty is never substituted for the owner's measured maximum-error test", () => {
  const epoch = observation(); epoch.quality.verticalAccuracyMeters = 0.1;
  const gate = evaluateGnssCaptureGate(epoch, context(), thresholds);
  assert.equal(gate.physicalQualification, "unverified");
  assert.ok(gate.positionStandardUncertaintyMeters! > 0.1);
  assert.equal(capture(epoch).captureEvidence.qualityScreen.physicalQualification, "unverified");
});

test("live evidence uses GST position components, not residual RMS or error ellipse axes", () => {
  const epoch = observation(["GNGST,123519.00,9.0,8.0,7.0,0.0,0.01,0.02,0.04"]);
  const captured = capture(epoch).captureEvidence;
  assert.equal(captured.qualityScreen.receiverQuality.horizontalAccuracyMeters, Math.hypot(0.01, 0.02));
  assert.equal(captured.qualityScreen.receiverQuality.verticalAccuracyMeters, 0.04);
  assert.equal(captured.qualityScreen.uncertaintySource, "nmea_gst_component_standard_deviations");
});

test("a newer matching GST without valid height uncertainty cannot reuse older vertical quality", () => {
  for (const vertical of ["", "invalid", "-0.01", "Infinity"]) {
    const epoch = observation([`GNGST,123519.00,0.001,0.001,0.001,0.0,0.01,0.01,${vertical}`]);
    assert.equal(epoch.quality.verticalAccuracyMeters, null);
    assert.throws(() => capture(epoch), /collection blocked/);
  }
});

test("capture policy is detached and incomplete historical thresholds are not defaulted", () => {
  const policy = { ...thresholds };
  const point = captureGnssObservation({ observation: observation(), context: context(), thresholds: policy,
    transport: "replay", id: "policy-test", label: "Synthetic policy test" });
  policy.maxObservationAgeSeconds = 100;
  assert.deepEqual(point.captureEvidence.qualityScreen.thresholds, thresholds);
  const incomplete = structuredClone(point.captureEvidence) as unknown as { qualityScreen: { thresholds: Record<string, unknown> } };
  delete incomplete.qualityScreen.thresholds.maxObservationAgeSeconds;
  assert.equal(GnssCaptureEvidenceSchema.safeParse(incomplete).success, false);
});
