import assert from "node:assert/strict";
import test from "node:test";
import { projectLonLatToXy } from "./coordinates";
import { PivotProjectSchema } from "./projectDocument";
import type { GnssCaptureEvidenceV2 } from "./gnssEvidence";
import type { OperationalFixedGgaEvidence } from "./operationalGnssEvidence";
import type { SurveyPoint } from "./types";
import {
  createSurveyCollection, validateSurveyCollection, parseSurveyCollectionDocument, serializeSurveyCollectionDocument,
  proposeSurveyCaptureAppend, proposeSurveyRemoveLast, proposeSurveyClear, proposeSurveyApplication,
  proposeSurveyMembershipRestore, assertSurveyCollectionTransition, type SurveyCollection,
} from "./surveyCollection";

const now = "2026-10-10T12:00:00.000Z";
const owner = { designId: "saved-design", documentKind: "draft" as const, payloadId: "incomplete-draft", fieldMapId: "saved-field", projectCrs: "EPSG:32613" };
function collection(): SurveyCollection {
  return createSurveyCollection({ id: "boundary-collection", owner, purpose: { kind: "field_boundary" }, now });
}
/** Checksummed operational GGA fixture follows the existing operationalLayout fixture contract.
 * No complete project, fabricated machine or sentinel geometry is needed. */
function point(sequence = 1, latitude = 40, longitude = -105): SurveyPoint {
  const nmeaCoordinate = (value: number, width: number) => {
    const absolute = Math.abs(value), degrees = Math.floor(absolute);
    return `${String(degrees).padStart(width, "0")}${((absolute - degrees) * 60).toFixed(4).padStart(7, "0")}`;
  };
  const utcTime = `1200${String(sequence).padStart(2, "0")}.00`;
  const payload = `GNGGA,${utcTime},${nmeaCoordinate(latitude, 2)},N,${nmeaCoordinate(longitude, 3)},W,4,12,0.8,1600.0,M,-20.0,M,1.0,42`;
  const checksum = [...payload].reduce((sum, character) => sum ^ character.charCodeAt(0), 0).toString(16).padStart(2, "0").toUpperCase();
  const evidence: OperationalFixedGgaEvidence = { schemaVersion: "gnss-operational-fixed-v1", observationId: `receiver:${sequence}`, sessionId: "receiver",
    transport: "local_udp", receivedAt: now, receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326",
    coherent: true, antennaReference: "unknown", sentenceTypes: ["GGA"],
    gga: { sentence: `$${payload}*${checksum}`, sentenceIdentifier: "GNGGA", utcTime, qualityCode: 4, latitude, longitude },
    receipt: { sequence, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 500, provenance: "loopback_companion" },
    capture: { evaluatedMonotonicMs: 1500, ageMs: 1000, maxAgeMs: 2000 },
    projection: { id: "wgs84-projection-v1:EPSG:32613", projectCrs: owner.projectCrs }, physicalQualification: "unverified" };
  return { id: `record:${sequence}`, label: `Recorded ${sequence}`, role: "control", projected: projectLonLatToXy({ latitude, longitude }, owner.projectCrs),
    wgs84: { latitude, longitude }, observedAt: now, source: "external_gnss", confidence: "rtk_fixed", captureEvidence: evidence,
    notes: "Exact supplied source record" };
}
function append(current: SurveyCollection, observed = point()): SurveyCollection {
  return proposeSurveyCaptureAppend(current, { expectedRevision: current.revision, point: observed, now }).collection;
}
function triangle(): SurveyCollection {
  return append(append(append(collection(), point(1)), point(2, 40.01)), point(3, 40, -105.01));
}
function receipt(current: SurveyCollection) {
  return { id: "application:1", appliedAt: now, designRevision: 7, target: { kind: "field_boundary" as const },
    sourcePointIds: [...current.activePointIds], geometryHash: "a".repeat(64) };
}

test("incomplete owner creates a detached empty collection without completing any design", () => {
  const source = { ...owner };
  const created = createSurveyCollection({ id: "collection", owner: source, purpose: { kind: "field_boundary" }, now });
  source.payloadId = "changed";
  assert.equal(created.owner.payloadId, "incomplete-draft");
  assert.deepEqual(created.observations, []);
  assert.deepEqual(created.activePointIds, []);
  assert.equal(created.revision, 0);
});

test("append preserves exact supplied record and declares external commit checks, without proving connection", () => {
  const observed = point(), source = structuredClone(observed);
  const proposal = proposeSurveyCaptureAppend(collection(), { expectedRevision: 0, point: observed, now });
  assert.deepEqual(proposal.collection.observations[0], source);
  assert.deepEqual(proposal.commitRequirement, { collectionId: "boundary-collection", expectedCollectionRevision: 0, owner,
    receiverSessionId: "receiver", receiverObservationId: "receiver:1", projectionId: "wgs84-projection-v1:EPSG:32613", maximumObservationAgeMs: 2000 });
  observed.notes = "caller changed";
  assert.deepEqual(proposal.collection.observations[0], source);
  assert.equal(proposal.collection.state, "pending");
  assert.throws(() => proposeSurveyCaptureAppend(collection(), { expectedRevision: 0, point: source, now, admitted: true } as never));
});

test("save/reopen preserves one and two unfinished vertices, exact evidence and membership", () => {
  let current = collection();
  for (const observed of [point(1), point(2, 40.01)]) {
    current = append(current, observed);
    const document = serializeSurveyCollectionDocument(current);
    const reopened = parseSurveyCollectionDocument(document);
    assert.deepEqual(reopened, current);
    assert.equal(serializeSurveyCollectionDocument(reopened), document);
    assert.equal(reopened.state, "pending");
  }
});

test("remove-last, Clear and history restore retain the ledger and old application receipts", () => {
  const captured = triangle();
  const removed = proposeSurveyRemoveLast(captured, { expectedRevision: 3, now });
  assert.deepEqual(removed.observations, captured.observations);
  assert.deepEqual(removed.activePointIds, captured.activePointIds.slice(0, 2));
  const cleared = proposeSurveyClear(removed, { expectedRevision: 4, now });
  assert.deepEqual(cleared.observations, captured.observations);
  assert.equal(cleared.state, "cleared");
  const restored = proposeSurveyMembershipRestore(cleared, { expectedRevision: 5, now, state: "pending", activePointIds: captured.activePointIds });
  const applied = proposeSurveyApplication(restored, { expectedRevision: 6, now, receipt: receipt(restored) });
  const undone = proposeSurveyMembershipRestore(applied, { expectedRevision: 7, now, state: "pending", activePointIds: captured.activePointIds });
  assert.deepEqual(undone.observations, captured.observations);
  assert.deepEqual(undone.applications, applied.applications);
  assert.equal(undone.revision, 8);
});

test("historical recorded shape applies without a receiver and never re-evaluates freshness against now", () => {
  const old = triangle(), later = "2030-01-01T00:00:00.000Z";
  const applied = proposeSurveyApplication(old, { expectedRevision: 3, now: later, receipt: { ...receipt(old), appliedAt: later } });
  assert.deepEqual(applied.observations, old.observations);
  assert.equal(applied.state, "applied");
  assert.deepEqual(applied.activePointIds, []);
  assert.deepEqual(parseSurveyCollectionDocument(serializeSurveyCollectionDocument(applied)), applied);
});

test("historical v1 retains its actual evidence version and cannot be appended as new live evidence", () => {
  const historical: SurveyPoint = { id: "legacy-record", label: "Historical measured record", role: "control", projected: { x: 500000, y: 4400000 },
    observedAt: now, source: "external_gnss", confidence: "rtk_float", captureEvidence: { schemaVersion: "gnss-capture-v1",
      observationId: "legacy-observation", sessionId: "legacy-session", transport: "replay", receivedAt: now, receivedMonotonicMs: 10,
      sourceCoordinateFrame: "EPSG:4326", antennaReference: "unknown", sentenceTypes: ["GGA"], coherent: false } };
  const stored = validateSurveyCollection({ ...collection(), observations: [historical], activePointIds: [historical.id] });
  assert.deepEqual(stored.observations[0], historical);
  assert.equal(stored.observations[0].captureEvidence?.schemaVersion, "gnss-capture-v1");
  assert.throws(() => append(collection(), historical), /new-live.*operational/i);
});

test("historical v2 declaration and elapsed correction quality round-trip exactly without live admission", () => {
  // Uses the current gnssEvidence.test.ts v2 fixture policy and declaration fields.
  // These are synthetic retained records; physical qualification stays unverified.
  const evidence: GnssCaptureEvidenceV2 = {
    schemaVersion: "gnss-capture-v2", observationId: "synthetic-v2-observation", sessionId: "synthetic-v2-session", transport: "web_serial",
    receivedAt: "2026-09-17T12:00:00.000Z", receiverObservedAt: "2026-09-17T12:00:00.000Z",
    receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true,
    height: { meters: 1500, type: "orthometric", geoidSeparationMeters: -20 },
    antennaReference: "arp", sentenceTypes: ["GGA", "GST", "RMC"], rawRecordHashes: ["synthetic-record"],
    referenceDeclaration: {
      schemaVersion: "gnss-reference-declaration-v1", provenance: "operator_declared",
      receiverModel: "Synthetic receiver", receiverFirmware: "synthetic-v1", referenceFrame: "WGS84",
      realization: "Synthetic realization", coordinateEpochUtc: "2026-09-17T12:00:00.000Z",
      verticalDatum: "Synthetic datum", geoidModel: "Synthetic geoid", antennaModel: "Synthetic antenna",
      antennaReference: "arp", reportedPoint: "Antenna ARP", targetPoint: "Antenna ARP",
      antennaHeightMeters: 2, offsetTreatment: "none_reported_point",
    },
    qualityScreen: {
      policy: "cplayout-nmea-collection-v2", uncertaintySource: "nmea_gst_component_standard_deviations",
      receiverQuality: { fixType: "rtk_fixed", satellites: 16, hdop: 0.7, vdop: null, pdop: null,
        correctionAgeSeconds: 1, horizontalAccuracyMeters: 0.02, verticalAccuracyMeters: 0.04,
        nmeaQualityCode: 4, baseStationId: "synthetic-base" },
      thresholds: { minimumFixType: "rtk_fixed", minSatellites: 10, maxHdop: 2,
        maxHorizontalAccuracyMeters: 0.05, maxCorrectionAgeSeconds: 3, maxObservationAgeSeconds: 2 },
      evaluatedMonotonicMs: 1500, physicalQualification: "unverified",
    },
  };
  const observed: SurveyPoint = { id: "historical-v2", label: "Synthetic historical v2", role: "control", projected: { x: 500000, y: 4400000 },
    observedAt: evidence.receiverObservedAt, source: "external_gnss", confidence: "rtk_fixed", captureEvidence: evidence,
    rtk: { ...evidence.qualityScreen.receiverQuality, correctionAgeSeconds: 1.5 } };
  const stored = validateSurveyCollection({ ...collection(), observations: [observed], activePointIds: [observed.id] });
  const document = serializeSurveyCollectionDocument(stored);
  const restored = parseSurveyCollectionDocument(document);
  assert.deepEqual(restored.observations[0], observed);
  assert.equal(serializeSurveyCollectionDocument(restored), document);
  assert.deepEqual(observed.captureEvidence, evidence);
  assert.throws(() => append(collection(), observed), /new-live.*operational/i);
  const inconsistent = structuredClone(stored);
  inconsistent.observations[0].rtk!.correctionAgeSeconds = 1;
  assert.throws(() => validateSurveyCollection(inconsistent), /quality/i);
});

test("every authoritative feature kind agrees with core geometry admission for all three raw primitives; Circle stays excluded", () => {
  const featureSchema = PivotProjectSchema.shape.mapFeatures.unwrap().unwrap().element;
  const points = [point(1).projected, point(2, 40.01).projected, point(3, 40, -105.01).projected];
  const geometries = [
    { type: "Point" as const, point: points[0] },
    { type: "LineString" as const, vertices: points.slice(0, 2) },
    { type: "Polygon" as const, vertices: points },
    // Deliberate supplied Design parameter: tests refusal by raw Survey, not capture support.
    { type: "Circle" as const, center: points[0], radiusMeters: 5 },
  ];
  let checkedPairs = 0;
  for (const kind of featureSchema.shape.kind.options) {
    for (const geometry of geometries) {
      const sourceAccepted = featureSchema.safeParse({ id: "synthetic-feature", name: "Synthetic schema comparison", kind, geometry, confidence: "user_estimated" }).success;
      const args = { id: `collection-${kind}`, owner, purpose: { kind: "map_feature" as const, featureKind: kind, geometryType: geometry.type }, now };
      if (sourceAccepted && geometry.type !== "Circle") {
        const actual = createSurveyCollection(args as Parameters<typeof createSurveyCollection>[0]);
        assert.equal(actual.purpose.kind, "map_feature", `${kind}/${geometry.type}`);
      } else assert.throws(() => createSurveyCollection(args as Parameters<typeof createSurveyCollection>[0]), `${kind}/${geometry.type}`);
      checkedPairs++;
    }
  }
  assert.equal(checkedPairs, featureSchema.shape.kind.options.length * 4);
  assert(featureSchema.shape.kind.options.includes("reference_point"));
  assert(featureSchema.shape.kind.options.includes("reference_line"));
  assert(featureSchema.shape.kind.options.includes("reference_area"));
});

test("strict parsers refuse unsupported versions, extra fields, stripped nested data and duplicate JSON keys", () => {
  const current = append(collection());
  for (const bad of [
    { ...current, documentVersion: "survey-collection-v2" }, { ...current, future: true },
    { ...current, owner: { ...current.owner, connectionId: "not-authority" } },
    { ...current, observations: [{ ...point(), extension: true }] },
    { ...current, observations: [{ ...point(), captureEvidence: { ...point().captureEvidence!, future: true } }] },
    { ...current, observations: [{ ...point(), notes: undefined }] },
  ]) assert.throws(() => validateSurveyCollection(bad));
  assert.throws(() => parseSurveyCollectionDocument('{"id":"one","id":"two"}'), /duplicate/i);
});

test("accessors, non-JSON values and sparse observations are refused without running accessors", () => {
  let reads = 0;
  const accessor = { ...collection() };
  Object.defineProperty(accessor, "observations", { enumerable: true, get() { reads++; return []; } });
  assert.throws(() => validateSurveyCollection(accessor), /accessor/i);
  assert.equal(reads, 0);
  assert.throws(() => validateSurveyCollection({ ...collection(), observations: new Array(1) }), /dense|sparse/i);
  assert.throws(() => validateSurveyCollection({ ...collection(), updatedAt: new Date(now) }), /plain JSON/i);
});

test("record and receiver identities deduplicate independently and never accept conflicting payloads", () => {
  const first = append(collection());
  assert.throws(() => append(first, point()), /duplicate.*record/i);
  const duplicateReceiver = { ...point(), id: "other-record" };
  assert.throws(() => append(first, duplicateReceiver), /duplicate receiver/i);
  assert.throws(() => validateSurveyCollection({ ...first, observations: [point(), { ...point(), id: "other", projected: { x: 10, y: 20 } }] }), /duplicate receiver|projection|XY/i);
});

test("source XY, CRS, WGS84, fixed evidence and quality must agree", () => {
  const observed = point();
  for (const bad of [
    { ...observed, projected: { x: observed.projected.x + 1, y: observed.projected.y } },
    { ...observed, wgs84: { latitude: 41, longitude: -105 } },
    { ...observed, confidence: "user_estimated" },
    { ...observed, source: "manual" },
    { ...observed, captureEvidence: { ...observed.captureEvidence!, gga: { ...(observed.captureEvidence as OperationalFixedGgaEvidence).gga, qualityCode: 5 } } },
  ]) assert.throws(() => append(collection(), bad as SurveyPoint));
  assert.throws(() => append({ ...collection(), owner: { ...owner, projectCrs: "EPSG:32614" } }, observed), /projection/i);
  assert.throws(() => createSurveyCollection({ id: "invalid-crs", owner: { ...owner, projectCrs: "EPSG:4326" }, purpose: { kind: "field_boundary" }, now }));
});

test("references require existing distinct records in ordered membership and application history", () => {
  const captured = triangle();
  assert.throws(() => validateSurveyCollection({ ...captured, activePointIds: ["missing"] }), /resolve/i);
  assert.throws(() => validateSurveyCollection({ ...captured, activePointIds: ["record:1", "record:1"] }), /duplicate.*reference/i);
  assert.throws(() => proposeSurveyApplication(captured, { expectedRevision: 3, now, receipt: { ...receipt(captured), sourcePointIds: [...captured.activePointIds].reverse() } }), /ordered/i);
  assert.throws(() => proposeSurveyApplication(captured, { expectedRevision: 3, now, receipt: { ...receipt(captured), target: { kind: "obstacle", id: "other" } } }), /target/i);
});

test("purpose and geometry stay pinned; Point has one active record and checks its role", () => {
  assert.throws(() => createSurveyCollection({ id: "bad-kind", owner, purpose: { kind: "map_feature", featureKind: "underground_pipeline", geometryType: "Polygon" }, now }), /geometry/i);
  const points = createSurveyCollection({ id: "points", owner, purpose: { kind: "point", role: "control" }, now });
  const first = append(points);
  assert.throws(() => append(first, point(2)), /one active/i);
  assert.throws(() => append(points, { ...point(), role: "pivot_center" }), /pinned purpose/i);
  const changed = { ...first, revision: 2, purpose: { kind: "point" as const, role: "note" as const } };
  assert.throws(() => assertSurveyCollectionTransition(first, changed), /pinned.*purpose/i);
});

test("real Point, obstacle and line procedures produce historical receipts for each actual owner kind", () => {
  const cases = [
    { documentKind: "project" as const, purpose: { kind: "point" as const, role: "control" as const },
      target: { kind: "survey_point" as const, pointId: "record:1" }, points: [point(1)] },
    { documentKind: "field" as const, purpose: { kind: "obstacle" as const, obstacleKind: "exclusion" as const },
      target: { kind: "obstacle" as const, id: "obstacle-output" }, points: [point(1), point(2, 40.01), point(3, 40, -105.01)] },
    { documentKind: "draft" as const, purpose: { kind: "map_feature" as const, featureKind: "underground_pipeline" as const, geometryType: "LineString" as const },
      target: { kind: "map_feature" as const, id: "pipeline-output" }, points: [point(1), point(2, 40.01)] },
  ];
  for (const scenario of cases) {
    let current = createSurveyCollection({ id: `collection-${scenario.documentKind}`, owner: { ...owner, documentKind: scenario.documentKind }, purpose: scenario.purpose, now });
    for (const observed of scenario.points) current = append(current, observed);
    const applied = proposeSurveyApplication(current, { expectedRevision: current.revision, now,
      receipt: { ...receipt(current), target: scenario.target } });
    assert.deepEqual(applied.applications[0].target, scenario.target);
    assert.deepEqual(applied.observations, scenario.points);
    assert.deepEqual(parseSurveyCollectionDocument(serializeSurveyCollectionDocument(applied)), applied);
    assert.equal(applied.owner.documentKind, scenario.documentKind);
  }
});

test("independent pinned collections survive purpose changes without shared mutable state", () => {
  const boundary = append(collection());
  const line = append(createSurveyCollection({ id: "pipe", owner, purpose: { kind: "map_feature", featureKind: "underground_pipeline", geometryType: "LineString" }, now }), point(2, 40.01));
  const clear = proposeSurveyClear(line, { expectedRevision: 1, now });
  assert.deepEqual(boundary.activePointIds, ["record:1"]);
  assert.deepEqual(clear.observations, line.observations);
  assert.deepEqual(line.activePointIds, ["record:2"]);
  assert.equal(line.purpose.kind, "map_feature");
});

test("apply validates real collected geometry; partial rings and distinct closing observations are not normalized", () => {
  const one = append(collection());
  assert.throws(() => proposeSurveyApplication(one, { expectedRevision: 1, now, receipt: receipt(one) }), /three vertices/i);
  const closed = append(triangle(), point(4));
  assert.throws(() => proposeSurveyApplication(closed, { expectedRevision: 4, now, receipt: receipt(closed) }), /duplicate vertices/i);
  const line = createSurveyCollection({ id: "line", owner, purpose: { kind: "map_feature", featureKind: "measurement_line", geometryType: "LineString" }, now });
  const coincident = append(append(line, point(1)), point(2));
  assert.throws(() => proposeSurveyApplication(coincident, { expectedRevision: 2, now, receipt: { ...receipt(coincident), target: { kind: "map_feature", id: "line-output" } } }), /distinct positions/i);
});

test("transition cannot rewrite or reorder complete observations, remove history, reparent or relabel CRS", () => {
  const captured = triangle();
  for (const bad of [
    { ...captured, revision: 4, observations: captured.observations.slice(1) },
    { ...captured, revision: 4, observations: [...captured.observations].reverse() },
    { ...captured, revision: 4, observations: captured.observations.map((point, index) => index ? point : { ...point, label: "rewritten" }) },
    { ...captured, revision: 4, owner: { ...owner, designId: "other" } },
  ]) assert.throws(() => assertSurveyCollectionTransition(captured, bad));
  const applied = proposeSurveyApplication(captured, { expectedRevision: 3, now, receipt: receipt(captured) });
  assert.throws(() => assertSurveyCollectionTransition(applied, { ...applied, revision: 5, state: "cleared", applications: [] }), /history/i);
});

test("revision, time and archival gates reject stale membership commands without altering source", () => {
  const first = append(collection()), source = structuredClone(first);
  assert.throws(() => proposeSurveyClear(first, { expectedRevision: 0, now }), /revision/i);
  assert.throws(() => proposeSurveyRemoveLast(first, { expectedRevision: 1, now: "2020-01-01T00:00:00.000Z" }), /predates/i);
  assert.throws(() => proposeSurveyClear({ ...first, state: "archived" }, { expectedRevision: 1, now }), /archived/i);
  assert.throws(() => proposeSurveyClear({ ...collection(), revision: Number.MAX_SAFE_INTEGER }, { expectedRevision: Number.MAX_SAFE_INTEGER, now }), /exhausted/i);
  assert.deepEqual(first, source);
});
