import assert from "node:assert/strict";
import test from "node:test";

import { DESIGN_DRAFT_DOCUMENT_VERSION, parseDesignDraftDocument, serializeDesignDraftDocument, tryBuildPivotProject } from "./designDraft";
import { GnssCaptureEvidenceSchema, GnssCaptureEvidenceV2Schema, type GnssCaptureEvidenceV2 } from "./gnssEvidence";
import { createManualDesignDraft } from "./manualDesign";
import { parseProjectDocument, serializeProjectDocument } from "./projectDocument";
import { createProjectEditorState, reduceProjectEditorState } from "./projectReducer";
import { defaultProjectSettings } from "./settings";
import type { GnssCaptureEvidence, GnssCaptureEvidenceV1, PivotProject, SourceConfidence, SurveyPoint, XY } from "./types";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const origin = { x: 500000, y: 4400000 };
const ring = [origin, { x: 500100, y: 4400000 }, { x: 500100, y: 4400100 }, { x: 500000, y: 4400100 }];

function evidence(id = "session-1:epoch-1", sessionId = "session-1"): GnssCaptureEvidenceV2 {
  return {
    schemaVersion: "gnss-capture-v2", observationId: id, sessionId, transport: "web_serial",
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
      receiverQuality: {
        fixType: "rtk_fixed", satellites: 16, hdop: 0.7, vdop: null, pdop: null,
        correctionAgeSeconds: 1, horizontalAccuracyMeters: 0.02, verticalAccuracyMeters: 0.04,
        nmeaQualityCode: 4, baseStationId: "synthetic-base",
      },
      thresholds: { minimumFixType: "rtk_fixed", minSatellites: 10, maxHdop: 2,
        maxHorizontalAccuracyMeters: 0.05, maxCorrectionAgeSeconds: 3, maxObservationAgeSeconds: 2 },
      evaluatedMonotonicMs: 1500, physicalQualification: "unverified",
    },
  };
}

function legacy(): GnssCaptureEvidenceV1 {
  return { schemaVersion: "gnss-capture-v1", observationId: "legacy-epoch", sessionId: "legacy-session",
    transport: "replay", receivedAt: "legacy time", receivedMonotonicMs: 0,
    sourceCoordinateFrame: "unknown", antennaReference: "unknown", sentenceTypes: [], coherent: false };
}

function project(): PivotProject {
  return clone({
    id: "gnss-evidence-fixture", name: "Synthetic evidence", projectCrs: "EPSG:32613", unitSystem: "metric",
    settings: { ...defaultProjectSettings(), unitSystem: "metric" }, fieldBoundary: ring,
    pivotCenter: { x: 500050, y: 4400050 }, waterSource: { x: 500040, y: 4400040 }, powerSource: { x: 500060, y: 4400060 },
    surveyPoints: [], obstacles: [], mapFeatures: [],
    machine: { id: "machine", name: "Synthetic machine", spanLengthsMeters: [20], overhangMeters: 0,
      endGunThrowMeters: 0, endGunAngleRanges: [], towerClearanceBufferMeters: 0, machineClearanceBufferMeters: 0,
      sweep: { mode: "full_circle" } },
  });
}

const carriers = ["boundary", "survey", "obstacle", "Point", "LineString", "Polygon", "Circle"] as const;
type Carrier = typeof carriers[number];

function addCapture(value: PivotProject, carrier: Carrier, capture: GnssCaptureEvidence, point = origin): void {
  const e = clone(capture), xy = { ...point };
  if (carrier === "boundary") {
    value.fieldBoundary[0] = xy;
    value.fieldBoundaryCaptureEvidence = [e, null, null, null];
  } else if (carrier === "survey") {
    const survey: SurveyPoint = { id: `survey-${value.surveyPoints.length}`, label: "Synthetic survey", role: "control",
      projected: xy, observedAt: e.receiverObservedAt ?? e.receivedAt, source: "external_gnss",
      confidence: "rtk_fixed", captureEvidence: e };
    if (e.schemaVersion === "gnss-capture-v2") {
      const raw = e.qualityScreen.receiverQuality;
      survey.rtk = { ...raw, correctionAgeSeconds: raw.correctionAgeSeconds! + (e.qualityScreen.evaluatedMonotonicMs - e.receivedMonotonicMs) / 1000 };
      survey.confidence = raw.fixType === "rtk_fixed" ? "rtk_fixed" : raw.fixType === "rtk_float" ? "rtk_float"
        : raw.fixType === "dgps" ? "dgps" : "autonomous_gps";
    }
    value.surveyPoints.push(survey);
  } else if (carrier === "obstacle") {
    value.obstacles.push({ id: `obstacle-${value.obstacles.length}`, name: "Synthetic obstacle", kind: "exclusion",
      polygon: [xy, { x: xy.x + 10, y: xy.y }, { x: xy.x, y: xy.y + 10 }],
      bufferMeters: 0, hardConflict: true, noSpray: true, confidence: "rtk_fixed", vertexCaptureEvidence: [e, null, null] });
  } else {
    const vertices = [xy, { x: xy.x + 10, y: xy.y }, { x: xy.x, y: xy.y + 10 }];
    value.mapFeatures!.push({ id: `feature-${value.mapFeatures!.length}`, name: `Synthetic ${carrier}`, confidence: "rtk_fixed",
      kind: carrier === "Point" ? "pump_location" : carrier === "LineString" ? "measurement_line" : "machine_zone",
      geometry: carrier === "Point" ? { type: "Point", point: xy }
        : carrier === "Circle" ? { type: "Circle", center: xy, radiusMeters: 5 }
          : { type: carrier, vertices },
      vertexCaptureEvidence: carrier === "Point" || carrier === "Circle" ? [e] : [e, null, null] });
  }
}

function parseDraft(value: unknown) {
  return parseDesignDraftDocument({ documentVersion: DESIGN_DRAFT_DOCUMENT_VERSION, draft: value });
}

function assertRejected(value: PivotProject, message?: RegExp): void {
  const before = clone(value);
  for (const operation of [() => parseProjectDocument(value), () => serializeProjectDocument(value), () => parseDraft(value)]) {
    if (message) assert.throws(operation, message);
    else assert.throws(operation);
  }
  assert.deepEqual(value, before);
}

test("v2 evidence round trips all carriers through project/draft JSON and draft build", () => {
  const value = project();
  for (const carrier of carriers) addCapture(value, carrier, evidence(`session-1:${carrier}`));
  const before = clone(value);
  const restored = parseProjectDocument(serializeProjectDocument(value));
  for (const key of ["fieldBoundary", "fieldBoundaryCaptureEvidence", "surveyPoints", "obstacles", "mapFeatures"] as const) {
    assert.deepEqual(restored[key], value[key]);
  }
  const draft = parseDraft(value);
  assert.deepEqual(parseDesignDraftDocument(serializeDesignDraftDocument(draft)), value);
  const built = tryBuildPivotProject(draft);
  assert.equal(built.ok, true);
  if (built.ok) assert.deepEqual(built.project, value);
  assert.deepEqual(value, before);
});

for (const carrier of carriers) {
  test(`repeated observation with different valid evaluation time and thresholds: ${carrier}`, () => {
    const value = project(), first = evidence(), second = clone(first);
    second.qualityScreen.evaluatedMonotonicMs = 2000;
    second.qualityScreen.thresholds.maxObservationAgeSeconds = 1;
    second.qualityScreen.thresholds.maxCorrectionAgeSeconds = 2;
    addCapture(value, "survey", first);
    addCapture(value, carrier, second);
    assert.doesNotThrow(() => parseProjectDocument(serializeProjectDocument(value)));
    assert.doesNotThrow(() => parseDraft(value));
  });
  test(`conflicting declarations in one session are rejected: ${carrier}`, () => {
    const value = project(), changed = evidence("session-1:other");
    changed.referenceDeclaration.receiverFirmware = "synthetic-v2";
    addCapture(value, "survey", evidence());
    addCapture(value, carrier, changed);
    assertRejected(value, /Conflicting reference declaration/);
  });
  test(`one observation cannot move canonical XY: ${carrier}`, () => {
    const value = project();
    addCapture(value, "survey", evidence());
    addCapture(value, carrier, evidence(), { x: origin.x + 1, y: origin.y });
    assertRejected(value, /Conflicting observation/);
  });
  test(`every carrier individually validates its v2 policy: ${carrier}`, () => {
    const value = project(), invalid = evidence();
    invalid.qualityScreen.evaluatedMonotonicMs = 10000;
    addCapture(value, carrier, invalid);
    assertRejected(value);
  });
}

test("missing thresholds are rejected without filling policy defaults", () => {
  for (const field of Object.keys(evidence().qualityScreen.thresholds)) {
    const invalid = evidence();
    Reflect.deleteProperty(invalid.qualityScreen.thresholds, field);
    assert.equal(GnssCaptureEvidenceV2Schema.safeParse(invalid).success, false, field);
    const value = project(); addCapture(value, "boundary", invalid); assertRejected(value);
    assert.equal(Object.hasOwn(invalid.qualityScreen.thresholds, field), false);
  }
});

test("v2 GGA code is required and must represent its usable parser fix", () => {
  for (const code of [undefined, null, -1, 4.5, 0, 3, 6, 7, 8, 999, "4", NaN, Infinity]) {
    const invalid = evidence(); Reflect.set(invalid.qualityScreen.receiverQuality, "nmeaQualityCode", code);
    assert.equal(GnssCaptureEvidenceV2Schema.safeParse(invalid).success, false, String(code));
  }
  for (const [code, fix] of [[1, "autonomous"], [2, "dgps"], [4, "rtk_fixed"], [5, "rtk_float"]] as const) {
    const valid = evidence();
    valid.qualityScreen.receiverQuality.nmeaQualityCode = code;
    valid.qualityScreen.receiverQuality.fixType = fix;
    valid.qualityScreen.thresholds.minimumFixType = "autonomous";
    assert.equal(GnssCaptureEvidenceV2Schema.safeParse(valid).success, true, fix);
    const value = project(); addCapture(value, "survey", valid);
    assert.doesNotThrow(() => parseDraft(value));
    assert.doesNotThrow(() => parseProjectDocument(value));
    valid.qualityScreen.receiverQuality.fixType = fix === "rtk_fixed" ? "autonomous" : "rtk_fixed";
    assert.equal(GnssCaptureEvidenceV2Schema.safeParse(valid).success, false, `${code} mismatched fix`);
  }
});

const invalidMutations: Array<[string, (value: GnssCaptureEvidenceV2) => void]> = [
  ["future receipt", e => { e.qualityScreen.evaluatedMonotonicMs = 999; }],
  ["negative horizontal uncertainty", e => { e.qualityScreen.receiverQuality.horizontalAccuracyMeters = -1; }],
  ["missing vertical uncertainty", e => { e.qualityScreen.receiverQuality.verticalAccuracyMeters = null; }],
  ["negative vertical uncertainty", e => { e.qualityScreen.receiverQuality.verticalAccuracyMeters = -1; }],
  ["zero HDOP", e => { e.qualityScreen.receiverQuality.hdop = 0; }],
  ["negative VDOP", e => { e.qualityScreen.receiverQuality.vdop = -1; }],
  ["too few satellites", e => { e.qualityScreen.receiverQuality.satellites = 9; }],
  ["stale effective corrections", e => { e.qualityScreen.receiverQuality.correctionAgeSeconds = 3; }],
  ["mismatched antenna", e => { e.antennaReference = "pole_tip"; }],
  ["missing coherent sentence", e => { e.sentenceTypes = ["GGA", "GST"]; }],
  ["unknown reference", e => { e.referenceDeclaration.verticalDatum = "unknown"; }],
  ["unapplied offset", e => { e.referenceDeclaration.targetPoint = "Pole tip"; }],
  ["false field qualification", e => { Reflect.set(e.qualityScreen, "physicalQualification", "verified"); }],
  ["unknown policy", e => { Reflect.set(e.qualityScreen, "policy", "invented"); }],
];
for (const [name, change] of invalidMutations) test(`invalid collection evidence: ${name}`, () => {
  const invalid = evidence(); change(invalid);
  assert.equal(GnssCaptureEvidenceV2Schema.safeParse(invalid).success, false);
  const value = project(); addCapture(value, "boundary", invalid); assertRejected(value);
});

test("collection does not invent a vertical or combined accuracy acceptance limit", () => {
  const value = evidence(); value.qualityScreen.receiverQuality.verticalAccuracyMeters = 100;
  assert.equal(GnssCaptureEvidenceV2Schema.parse(value).qualityScreen.physicalQualification, "unverified");
});

test("v2 outer survey quality uses raw receiver values plus elapsed correction age exactly once", () => {
  const good = project(); addCapture(good, "survey", evidence());
  assert.equal(good.surveyPoints[0].rtk!.correctionAgeSeconds, 1.5);
  assert.doesNotThrow(() => parseDraft(good));
  for (const change of [
    (p: SurveyPoint) => { delete p.rtk; },
    (p: SurveyPoint) => { p.rtk!.correctionAgeSeconds = 1; },
    (p: SurveyPoint) => { p.rtk!.correctionAgeSeconds = 2; },
    (p: SurveyPoint) => { p.rtk!.fixType = "autonomous"; },
    (p: SurveyPoint) => { p.rtk!.verticalAccuracyMeters = 0.001; },
    (p: SurveyPoint) => { p.rtk!.baseStationId = "other-base"; },
    (p: SurveyPoint) => { p.confidence = "rtk_float"; },
  ]) {
    const invalid = clone(good); change(invalid.surveyPoints[0]); assertRejected(invalid, /V2 survey/);
  }
});

test("observation identity includes raw quality, height, receipt, transport, declaration and source hashes", () => {
  for (const change of [
    (e: GnssCaptureEvidenceV2) => { e.qualityScreen.receiverQuality.hdop = 0.8; },
    (e: GnssCaptureEvidenceV2) => { e.qualityScreen.receiverQuality.correctionAgeSeconds = 0.5; },
    (e: GnssCaptureEvidenceV2) => { e.height.meters += 1; },
    (e: GnssCaptureEvidenceV2) => { e.height.geoidSeparationMeters += 1; },
    (e: GnssCaptureEvidenceV2) => { e.receivedAt = "2026-09-17T12:00:01.000Z"; },
    (e: GnssCaptureEvidenceV2) => { e.receivedMonotonicMs = 900; },
    (e: GnssCaptureEvidenceV2) => { e.transport = "replay"; },
    (e: GnssCaptureEvidenceV2) => { e.referenceDeclaration.receiverFirmware = "different"; },
    (e: GnssCaptureEvidenceV2) => { e.rawRecordHashes = ["different-record"]; },
  ]) {
    const value = project(), changed = evidence(); change(changed);
    assert.equal(GnssCaptureEvidenceV2Schema.safeParse(changed).success, true);
    addCapture(value, "survey", evidence()); addCapture(value, "Point", changed);
    assertRejected(value, /Conflicting/);
  }
});

test("same UTC in different sessions permits separate observations and declarations", () => {
  const value = project(), second = evidence("session-2:epoch-1", "session-2");
  second.referenceDeclaration.receiverModel = "Other synthetic receiver";
  addCapture(value, "survey", evidence()); addCapture(value, "Point", second, { x: origin.x + 1, y: origin.y });
  const restored = parseProjectDocument(serializeProjectDocument(value));
  assert.deepEqual(restored.surveyPoints, value.surveyPoints);
  assert.deepEqual(restored.mapFeatures, value.mapFeatures);
  assert.deepEqual(parseDesignDraftDocument(serializeDesignDraftDocument(parseDraft(value))), value);
});

test("reference declarations reject every ASCII control character including internal newline", () => {
  const fields = ["receiverModel", "receiverFirmware", "realization", "verticalDatum", "geoidModel", "antennaModel", "reportedPoint", "targetPoint"] as const;
  for (const field of fields) {
    for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
      const invalid = evidence();
      invalid.referenceDeclaration[field] = `synthetic${String.fromCharCode(code)}reference`;
      assert.equal(GnssCaptureEvidenceV2Schema.safeParse(invalid).success, false, `${field}: ${code}`);
    }
  }
});

test("object property ordering does not create observation or session conflicts", () => {
  const value = project(), second = evidence();
  second.referenceDeclaration = Object.fromEntries(Object.entries(second.referenceDeclaration).reverse()) as typeof second.referenceDeclaration;
  second.qualityScreen.receiverQuality = Object.fromEntries(Object.entries(second.qualityScreen.receiverQuality).reverse()) as typeof second.qualityScreen.receiverQuality;
  addCapture(value, "survey", evidence()); addCapture(value, "Circle", second);
  assert.doesNotThrow(() => parseDraft(value));
  assert.doesNotThrow(() => parseProjectDocument(value));
});

test("v1 admission stays permissive while draft legacy identity conflicts remain strict", () => {
  const value = project();
  for (const carrier of carriers) addCapture(value, carrier, legacy());
  value.surveyPoints[0].rtk = { fixType: "rtk_fixed", satellites: -1, hdop: null, vdop: null, pdop: null,
    correctionAgeSeconds: null, horizontalAccuracyMeters: null, verticalAccuracyMeters: null, nmeaQualityCode: -4.5 };
  assert.deepEqual(GnssCaptureEvidenceSchema.parse(legacy()), legacy());
  const restored = parseProjectDocument(serializeProjectDocument(value));
  assert.deepEqual(restored.surveyPoints, value.surveyPoints);
  assert.doesNotThrow(() => parseDraft(value));
  value.surveyPoints[0].projected.x += 1;
  assert.doesNotThrow(() => parseProjectDocument(value));
  assert.throws(() => parseDraft(value), /Conflicting observation/);
});

test("v2 checks do not enforce session declarations on unrelated v1 records", () => {
  const value = project(), old = legacy(); old.sessionId = "session-1";
  addCapture(value, "survey", evidence()); addCapture(value, "Point", old);
  assert.doesNotThrow(() => parseProjectDocument(value));
  assert.doesNotThrow(() => parseDraft(value));
});

test("mixed v1/v2 observation identity collisions fail in either encounter order", () => {
  for (const firstIsLegacy of [true, false]) {
    for (const carrier of carriers) {
      const value = project(), old = legacy(), current = evidence();
      old.observationId = current.observationId;
      addCapture(value, "survey", firstIsLegacy ? old : current);
      addCapture(value, carrier, firstIsLegacy ? current : old);
      assertRejected(value, /Conflicting observation/);
    }
  }
});

test("manual design deep copies nested v2 evidence and cannot mutate retained records", () => {
  const value = project(); addCapture(value, "boundary", evidence());
  const before = clone(value), draft = createManualDesignDraft(value, 0);
  const copied = draft.boundary!.captureEvidence![0]!;
  assert.equal(copied.schemaVersion, "gnss-capture-v2");
  if (copied.schemaVersion !== "gnss-capture-v2") throw new Error("Expected v2 fixture");
  copied.referenceDeclaration.receiverFirmware = "changed";
  copied.qualityScreen.receiverQuality.hdop = 0.8;
  copied.qualityScreen.thresholds.maxHdop = 3;
  copied.height.meters += 1;
  copied.sentenceTypes.push("changed");
  copied.rawRecordHashes!.push("changed");
  assert.deepEqual(value, before);
});

test("reducer rejects conflicting v2 admission without changing project or history", () => {
  const value = project(); addCapture(value, "survey", evidence());
  const initial = createProjectEditorState(value), changed = evidence(); changed.height.meters += 1;
  const next = reduceProjectEditorState(initial, { type: "commit_boundary_draft", vertices: ring,
    captureEvidence: [changed, null, null, null] });
  assert.match(next.lastError ?? "", /Conflicting observation/);
  assert.equal(next.project, initial.project);
  assert.equal(next.past, initial.past);
  assert.equal(next.future, initial.future);
  assert.equal(next.revision, initial.revision);
});

test("v2 survey observedAt must exactly equal receiver time; v1 retains legacy timestamp behavior", () => {
  for (const observedAt of ["2026-09-17T12:00:01.000Z", "not-a-date", "2026-09-17T12:00:00Z"]) {
    const value = project(); addCapture(value, "survey", evidence());
    value.surveyPoints[0].observedAt = observedAt;
    assertRejected(value, /observedAt.*receiverObservedAt/);
    value.surveyPoints[0].captureEvidence = legacy();
    const restored = parseProjectDocument(serializeProjectDocument(value));
    assert.equal(restored.surveyPoints[0].observedAt, observedAt);
    assert.doesNotThrow(() => parseDraft(value));
  }
});

const confidenceFixes = [
  [1, "autonomous", "autonomous_gps"], [2, "dgps", "dgps"],
  [5, "rtk_float", "rtk_float"], [4, "rtk_fixed", "rtk_fixed"],
] as const;
const geometryCarriers = ["Point", "Circle", "LineString", "Polygon", "obstacle"] as const;

function withFix(index: number, id = `session-1:fix-${index}`): GnssCaptureEvidenceV2 {
  const capture = evidence(id), [code, fix] = confidenceFixes[index];
  capture.qualityScreen.receiverQuality.nmeaQualityCode = code;
  capture.qualityScreen.receiverQuality.fixType = fix;
  capture.qualityScreen.thresholds.minimumFixType = "autonomous";
  return capture;
}

for (const carrier of geometryCarriers) {
  test(`${carrier}: GNSS confidence ceiling permits equal/conservative labels without upgrading`, () => {
    for (const [fixRank] of confidenceFixes.entries()) {
      for (const [labelRank, [, , confidence]] of confidenceFixes.entries()) {
        const value = project(); addCapture(value, carrier, withFix(fixRank));
        const entity = carrier === "obstacle" ? value.obstacles[0] : value.mapFeatures![0];
        entity.confidence = confidence;
        if (labelRank > fixRank) assertRejected(value, /weakest retained v2 fix/);
        else {
          const restored = parseProjectDocument(serializeProjectDocument(value));
          const restoredEntity = carrier === "obstacle" ? restored.obstacles[0] : restored.mapFeatures![0];
          assert.deepEqual(restoredEntity, entity);
          assert.deepEqual(parseDesignDraftDocument(serializeDesignDraftDocument(parseDraft(value))), value);
        }
      }
    }
  });

  test(`${carrier}: non-GNSS labels remain allowed with v2/manual geometry`, () => {
    for (const confidence of ["imagery_digitized", "imported_cad", "user_estimated", "optimized"] as const) {
      const value = project(); addCapture(value, carrier, withFix(0));
      const entity = carrier === "obstacle" ? value.obstacles[0] : value.mapFeatures![0];
      entity.confidence = confidence;
      assert.doesNotThrow(() => parseDraft(value));
      const restored = parseProjectDocument(serializeProjectDocument(value));
      assert.deepEqual(carrier === "obstacle" ? restored.obstacles[0] : restored.mapFeatures![0], entity);
    }
  });

  test(`${carrier}: null, absent and v1 evidence do not invent a confidence constraint`, () => {
    for (const mode of ["legacy", "null", "absent"] as const) {
      const value = project(); addCapture(value, carrier, legacy());
      // A weaker v2 fix on a different entity must not downgrade this geometry's label.
      addCapture(value, "survey", withFix(0));
      const entity = carrier === "obstacle" ? value.obstacles[0] : value.mapFeatures![0];
      if (mode === "null") entity.vertexCaptureEvidence = entity.vertexCaptureEvidence!.map(() => null);
      if (mode === "absent") delete entity.vertexCaptureEvidence;
      const restored = parseProjectDocument(serializeProjectDocument(value));
      assert.deepEqual(carrier === "obstacle" ? restored.obstacles[0] : restored.mapFeatures![0], entity);
      assert.doesNotThrow(() => parseDraft(value));
    }
  });
}

for (const carrier of ["LineString", "Polygon", "obstacle"] as const) {
  test(`${carrier}: mixed evidence ceiling uses the weakest v2, ignoring null/v1 entries`, () => {
    for (const third of [null, legacy()]) {
      for (const confidence of ["rtk_fixed", "rtk_float", "dgps", "user_estimated"] as SourceConfidence[]) {
        const value = project(); addCapture(value, carrier, withFix(3));
        const entity = carrier === "obstacle" ? value.obstacles[0] : value.mapFeatures![0];
        entity.vertexCaptureEvidence = [withFix(3), withFix(2), third];
        entity.confidence = confidence;
        if (confidence === "rtk_fixed") assertRejected(value, /weakest retained v2 fix/);
        else {
          const restored = parseProjectDocument(serializeProjectDocument(value));
          assert.deepEqual(carrier === "obstacle" ? restored.obstacles[0] : restored.mapFeatures![0], entity);
          assert.doesNotThrow(() => parseDraft(value));
        }
      }
    }
  });
}

test("manual geometry edits null displaced evidence without schema-forced confidence changes", () => {
  for (const carrier of geometryCarriers) {
    const value = project(); addCapture(value, carrier, withFix(2));
    const entity = carrier === "obstacle" ? value.obstacles[0] : value.mapFeatures![0];
    entity.confidence = "rtk_float";
    const initial = createProjectEditorState(value);
    const point = { x: origin.x + 1, y: origin.y + 1 };
    const next = reduceProjectEditorState(initial, carrier === "obstacle"
      ? { type: "move_obstacle_vertex", obstacleId: entity.id, vertexIndex: 0, point }
      : { type: "move_map_feature_vertex", featureId: entity.id, vertexIndex: 0, point });
    assert.equal(next.lastError, null);
    const edited = carrier === "obstacle" ? next.project.obstacles[0] : next.project.mapFeatures![0];
    assert.equal(edited.vertexCaptureEvidence?.[0], null);
    assert.equal(edited.confidence, "rtk_float");
    assert.deepEqual(reduceProjectEditorState(next, { type: "undo" }).project, initial.project);
  }
});
