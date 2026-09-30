import assert from "node:assert/strict";
import test from "node:test";

import { convertPivotProjectToFieldDesign, FIELD_DESIGN_DOCUMENT_VERSION, FIELD_DESIGN_DOCUMENT_V2_VERSION, LEGACY_FIELD_DESIGN_DOCUMENT_VERSION,
  parseFieldDesignDocumentV1, parseFieldDesignDocumentV2, parseFieldDesignDocument,
  serializeFieldDesignDocument, validateFieldDesign, type FieldDesign } from "./fieldDesignDocument";
import { DRAWING_CLASSIFICATION_VERSION, drawingPurpose, type DrawingClassification } from "./drawingClassification";
import { PROJECT_DRAWING_METADATA_VERSION, type DrawingMetadataTarget } from "./drawingMetadata";
import { parseProjectDocument, serializeProjectDocument } from "./projectDocument";
import { sampleProject, willRheaJasonHarmelinkExampleProject } from "./sampleProject";
import type { GnssCaptureEvidenceV1 } from "./types";
import type { GnssCaptureEvidenceV2 } from "./gnssEvidence";

const ids = { fieldId: "field-design-a", waterSourceId: "shared-water", powerSourceId: "shared-power" };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fixture = () => convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), ids).field;
const roundtrip = (field: FieldDesign) => parseFieldDesignDocument(serializeFieldDesignDocument(field));
const legacyEvidence = (): GnssCaptureEvidenceV1 => ({
  schemaVersion: "gnss-capture-v1", observationId: "capture-id-not-survey-id", sessionId: "legacy-session",
  transport: "replay", receivedAt: "synthetic-time", receivedMonotonicMs: 0, sourceCoordinateFrame: "unknown",
  antennaReference: "unknown", sentenceTypes: [], coherent: false,
});

function v2Evidence(): GnssCaptureEvidenceV2 {
  return {
    schemaVersion: "gnss-capture-v2", observationId: "synthetic-v2-epoch", sessionId: "synthetic-v2-session", transport: "replay",
    receivedAt: "2026-09-27T12:00:00.000Z", receiverObservedAt: "2026-09-27T12:00:00.000Z",
    receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true,
    height: { meters: 1500, type: "orthometric", geoidSeparationMeters: -20 },
    antennaReference: "arp", sentenceTypes: ["GGA", "GST", "RMC"],
    referenceDeclaration: {
      schemaVersion: "gnss-reference-declaration-v1", provenance: "operator_declared", receiverModel: "Synthetic receiver",
      receiverFirmware: "synthetic-v1", referenceFrame: "WGS84", realization: "Synthetic realization",
      coordinateEpochUtc: "2026-09-27T12:00:00.000Z", verticalDatum: "Synthetic datum", geoidModel: "Synthetic geoid",
      antennaModel: "Synthetic antenna", antennaReference: "arp", reportedPoint: "Antenna ARP", targetPoint: "Antenna ARP",
      antennaHeightMeters: 0, offsetTreatment: "none_reported_point",
    },
    qualityScreen: {
      policy: "cplayout-nmea-collection-v2", uncertaintySource: "nmea_gst_component_standard_deviations",
      receiverQuality: { fixType: "rtk_fixed", satellites: 16, hdop: 0.7, vdop: null, pdop: null, correctionAgeSeconds: 1,
        horizontalAccuracyMeters: 0.02, verticalAccuracyMeters: 0.04, nmeaQualityCode: 4 },
      thresholds: { minimumFixType: "rtk_fixed", minSatellites: 10, maxHdop: 2, maxHorizontalAccuracyMeters: 0.05,
        maxCorrectionAgeSeconds: 3, maxObservationAgeSeconds: 2 },
      evaluatedMonotonicMs: 1500, physicalQualification: "unverified",
    },
  };
}

test("explicit conversion retains exact source text, IDs, geometry and observation references", () => {
  const project = clone(sampleProject);
  project.infrastructureObservationRefs = { pivot_center: project.surveyPoints[0].id };
  const original = ` \n${JSON.stringify({ documentVersion: "pivot-project-v1", project }, null, 3)}\n\t`;
  const before = JSON.stringify(project);
  const converted = convertPivotProjectToFieldDesign(original, ids);
  assert.equal(converted.originalProjectDocument, original);
  assert.equal(converted.field.id, ids.fieldId);
  assert.equal(converted.field.machines.length, 1);
  assert.equal(converted.field.machines[0].id, project.machine.id);
  assert.equal(converted.field.machines[0].pivotObservationId, project.surveyPoints[0].id);
  assert.equal("id" in converted.field.machines[0].configuration, false);
  assert.equal("wgs84Companion" in converted.field, false);
  assert.deepEqual(converted.field.fieldBoundary, project.fieldBoundary);
  assert.deepEqual(converted.field.machines[0].pivotCenter, project.pivotCenter);
  assert.deepEqual(converted.field.infrastructure.map(item => item.point), [project.waterSource, project.powerSource]);
  assert.deepEqual(roundtrip(converted.field), converted.field);
  converted.field.machines[0].configuration.spanLengthsMeters.push(42);
  assert.equal(converted.originalProjectDocument, original);
  assert.equal(JSON.stringify(project), before);
});

test("Will Rhea conversion creates only the canonical machine, never advisory outlines", () => {
  const converted = convertPivotProjectToFieldDesign(serializeProjectDocument(willRheaJasonHarmelinkExampleProject), ids);
  assert.equal(converted.field.machines.length, 1);
  assert.equal(converted.field.machines[0].id, willRheaJasonHarmelinkExampleProject.machine.id);
  assert.equal(converted.field.machines[0].cornerGuidanceFeatureId, undefined);
  assert.equal(converted.field.machines[0].sourceFeatureIds, undefined);
  assert.deepEqual(converted.field.mapFeatures, willRheaJasonHarmelinkExampleProject.mapFeatures);
  assert.equal(converted.field.projectCrs, willRheaJasonHarmelinkExampleProject.projectCrs);
  assert.deepEqual(roundtrip(converted.field), converted.field);
});

test("two independently configured machines share a boundary and infrastructure without copying authority", () => {
  const field = fixture();
  const second = clone(field.machines[0]);
  second.id = "second-pivot";
  second.configuration.name = "Independent second pivot";
  second.configuration.spanLengthsMeters = [33, 47];
  second.configuration.endGunThrowMeters = 0;
  second.configuration.sweep = { mode: "partial_circle", startAngleDegrees: 15, stopAngleDegrees: 230, direction: "clockwise" };
  second.pivotCenter = { x: second.pivotCenter.x + 100, y: second.pivotCenter.y + 150 };
  field.machines.push(second);
  const before = JSON.stringify(field);
  const reopened = roundtrip(field);
  assert.deepEqual(reopened, field);
  assert.equal(reopened.infrastructure.length, 2);
  assert.equal(reopened.machines[0].waterSourceId, reopened.machines[1].waterSourceId);
  reopened.machines[1].configuration.spanLengthsMeters[0] = 5;
  reopened.fieldBoundary[0].x += 1;
  assert.equal(JSON.stringify(field), before);
  assert.notEqual(reopened.machines[0].configuration.spanLengthsMeters[0], 5);
});

test("missing machines or connections remain explicit, with no invented origin or qualification", () => {
  const field = fixture();
  delete field.machines[0].waterSourceId;
  delete field.machines[0].powerSourceId;
  field.infrastructure = [];
  assert.deepEqual(roundtrip(field), field);
  field.machines = [];
  assert.deepEqual(roundtrip(field), field);
  assert.equal("fieldQualified" in field, false);
  assert.throws(() => validateFieldDesign({ ...field, fieldQualified: true }));
});

test("all identity namespaces reject duplicates without co-location deduplication", () => {
  for (const collection of ["machines", "infrastructure", "surveyPoints", "obstacles"] as const) {
    const field = fixture();
    (field[collection] as Array<{ id: string }>).push(clone(field[collection][0]));
    const before = JSON.stringify(field);
    assert.throws(() => validateFieldDesign(field), /Duplicate/);
    assert.equal(JSON.stringify(field), before);
  }
  const field = fixture();
  field.infrastructure.push({ ...clone(field.infrastructure[0]), id: "co-located" });
  assert.equal(roundtrip(field).infrastructure.length, 3);
  assert.throws(() => convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { ...ids, powerSourceId: ids.waterSourceId }), /Duplicate/);
  assert.throws(() => convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { ...ids, fieldId: sampleProject.id }), /new document identity/);
});

test("survey references resolve exact survey-record IDs and coordinates, not receiver capture IDs", () => {
  const field = fixture();
  const observation = field.surveyPoints[0];
  observation.captureEvidence = legacyEvidence();
  field.machines[0].pivotObservationId = observation.id;
  assert.deepEqual(roundtrip(field), field);
  field.machines[0].pivotObservationId = observation.captureEvidence.observationId;
  assert.throws(() => validateFieldDesign(field), /Survey reference/);
  field.machines[0].pivotObservationId = observation.id;
  field.machines[0].pivotCenter.x += 0.00001;
  assert.throws(() => validateFieldDesign(field), /exact projected XY/);
  field.machines[0].pivotCenter = clone(observation.projected);
  field.infrastructure[0].observationId = observation.id;
  assert.throws(() => validateFieldDesign(field), /exact projected XY/);
  field.infrastructure[0].point = clone(observation.projected);
  assert.doesNotThrow(() => validateFieldDesign(field));
});

test("supplied infrastructure references must exist and retain their water/power kind", () => {
  for (const value of ["missing", ids.powerSourceId]) {
    const field = fixture();
    field.machines[0].waterSourceId = value;
    assert.throws(() => validateFieldDesign(field), /correct infrastructure kind/);
  }
});

test("guidance references are explicit and stable across feature reordering", () => {
  const field = fixture();
  field.mapFeatures = ["line-a", "line-b"].map((id, index) => ({
    id, name: id, kind: "measurement_line", confidence: "user_estimated",
    geometry: { type: "LineString", vertices: [{ x: index, y: 0 }, { x: index + 5, y: 10 }] },
  }));
  field.machines.push({ ...clone(field.machines[0]), id: "second" });
  field.machines[0].cornerGuidanceFeatureId = "line-b";
  field.machines[0].sourceFeatureIds = ["line-a"];
  field.mapFeatures.reverse();
  const reopened = roundtrip(field);
  assert.equal(reopened.machines[0].cornerGuidanceFeatureId, "line-b");
  assert.equal(reopened.machines[1].cornerGuidanceFeatureId, undefined);
  field.mapFeatures.pop();
  assert.throws(() => validateFieldDesign(field), /missing source feature/);
  delete field.machines[0].sourceFeatureIds;
  field.mapFeatures = [];
  assert.throws(() => validateFieldDesign(field), /corner guidance/);
});

test("guidance refuses degenerate lines and polygons; source references refuse duplicates", () => {
  const field = fixture();
  field.mapFeatures = [{ id: "path", name: "Path", kind: "measurement_line", confidence: "user_estimated",
    geometry: { type: "LineString", vertices: [{ x: 0, y: 0 }, { x: 0, y: 0 }] } }];
  field.machines[0].cornerGuidanceFeatureId = "path";
  assert.throws(() => validateFieldDesign(field), /nondegenerate LineString/);
  field.mapFeatures[0] = { id: "path", name: "Area", kind: "machine_zone", confidence: "user_estimated",
    geometry: { type: "Polygon", vertices: clone(field.fieldBoundary) } };
  assert.throws(() => validateFieldDesign(field), /nondegenerate LineString/);
  delete field.machines[0].cornerGuidanceFeatureId;
  field.machines[0].sourceFeatureIds = ["path", "path"];
  assert.throws(() => validateFieldDesign(field), /duplicate source/);
  field.mapFeatures.push(clone(field.mapFeatures[0]));
  assert.throws(() => validateFieldDesign(field), /Duplicate map feature/);
});

test("XY and evidence arrays remain qualified by the declared CRS, not display units", () => {
  for (const projectCrs of ["EPSG:4326", "CRS:84", "EPSG:999999"]) {
    assert.throws(() => validateFieldDesign({ ...fixture(), projectCrs }), /[Pp]rojected CRS/);
  }
  for (const projectCrs of ["LOCAL:field-grid", "EPSG:3857", "EPSG:26741"]) {
    const field = { ...fixture(), projectCrs };
    assert.deepEqual(roundtrip(field), field);
  }
  const field = fixture();
  field.settings!.unitSystem = field.unitSystem === "metric" ? "us_survey_feet" : "metric";
  assert.throws(() => validateFieldDesign(field), /unit system/);
  delete field.settings;
  field.fieldBoundaryCaptureEvidence = [null];
  assert.throws(() => validateFieldDesign(field), /align with vertices/);
  delete field.fieldBoundaryCaptureEvidence;
  field.fieldBoundary[0].x = Infinity;
  assert.throws(() => validateFieldDesign(field), /finite/);
});

test("conflicting legacy captures cannot share an observation identity across carriers", () => {
  const field = fixture();
  const evidence = legacyEvidence();
  field.fieldBoundaryCaptureEvidence = field.fieldBoundary.map((_, index) => index === 0 ? evidence : null);
  field.mapFeatures = [{ id: "capture", name: "Captured point", kind: "well_location", confidence: "user_estimated",
    geometry: { type: "Point", point: clone(field.fieldBoundary[0]) }, vertexCaptureEvidence: [clone(evidence)] }];
  assert.deepEqual(roundtrip(field), field);
  field.mapFeatures[0].vertexCaptureEvidence![0]!.receivedMonotonicMs += 1;
  assert.throws(() => validateFieldDesign(field), /Conflicting observation/);
  field.mapFeatures[0].vertexCaptureEvidence = [clone(evidence)];
  if (field.mapFeatures[0].geometry.type === "Point") field.mapFeatures[0].geometry.point.x += 1;
  assert.throws(() => validateFieldDesign(field), /Conflicting observation/);
});

test("v2 recapture policy may differ, but immutable payload and session declarations may not", () => {
  const field = fixture();
  const evidence = v2Evidence();
  field.fieldBoundaryCaptureEvidence = field.fieldBoundary.map((_, index) => index === 0 ? evidence : null);
  const recapture = clone(evidence);
  recapture.qualityScreen.evaluatedMonotonicMs += 100;
  recapture.qualityScreen.thresholds.minSatellites = 12;
  field.mapFeatures = [{ id: "capture", name: "Captured point", kind: "well_location", confidence: "rtk_fixed",
    geometry: { type: "Point", point: clone(field.fieldBoundary[0]) }, vertexCaptureEvidence: [recapture] }];
  assert.deepEqual(roundtrip(field), field);
  recapture.height.meters += 0.1;
  assert.throws(() => validateFieldDesign(field), /Conflicting observation/);
  recapture.height.meters = evidence.height.meters;
  recapture.observationId = "another-epoch";
  recapture.referenceDeclaration.receiverModel = "Different receiver";
  assert.throws(() => validateFieldDesign(field), /Conflicting reference declaration/);
  field.mapFeatures[0].vertexCaptureEvidence = [{ ...legacyEvidence(), observationId: evidence.observationId }];
  assert.throws(() => validateFieldDesign(field), /Conflicting observation/);
});

test("unknown nested data, undefined values and serialization hooks never silently disappear", () => {
  let invoked = false;
  const field = fixture();
  for (const value of [
    { ...field, futureData: true },
    { ...field, machines: [{ ...field.machines[0], configuration: { ...field.machines[0].configuration, id: "duplicate-authority" } }] },
    { ...field, fieldBoundary: [{ ...field.fieldBoundary[0], futureData: 3 }, ...field.fieldBoundary.slice(1)] },
    { ...field, settings: undefined },
    { ...field, toJSON: () => { invoked = true; return field; } },
    Object.defineProperty({ ...field }, "name", { enumerable: true, get() { invoked = true; return "Injected"; } }),
  ]) assert.throws(() => validateFieldDesign(value));
  assert.equal(invoked, false);
  const noRanges = fixture();
  delete noRanges.machines[0].configuration.endGunAngleRanges;
  delete noRanges.mapFeatures;
  delete noRanges.mapPackages;
  delete noRanges.settings;
  assert.deepEqual(roundtrip(noRanges), noRanges);
});

test("field envelopes refuse legacy readers, unknown versions, duplicate keys and JSON extensions", () => {
  const field = fixture();
  const serialized = serializeFieldDesignDocument(field);
  assert.throws(() => parseProjectDocument(serialized), /version is unsupported/);
  assert.throws(() => parseFieldDesignDocument(serializeProjectDocument(sampleProject)));
  for (const document of [
    serialized.replace(LEGACY_FIELD_DESIGN_DOCUMENT_VERSION, "field-design-v99"),
    `{"documentVersion":"${FIELD_DESIGN_DOCUMENT_VERSION}","field":${JSON.stringify(field)},"field":${JSON.stringify(field)}}`,
    `{"documentVersion":"${FIELD_DESIGN_DOCUMENT_VERSION}","field":${JSON.stringify(field)},"fi\\u0065ld":${JSON.stringify(field)}}`,
    serialized.replace('"id": "field-design-a"', '"id": "first", "id": "field-design-a"'),
    `/*comment*/${serialized}`, serialized.replace(/}\s*$/, ",}"), "", "null",
  ]) assert.throws(() => parseFieldDesignDocument(document));
});

test("map-package metadata preserves portability, attribution and manifest refinements without defaults", () => {
  const field = fixture();
  field.mapPackages = [{
    id: "tiles", name: "Synthetic offline package", packageType: "pmtiles", tileContentType: "raster",
    uri: "app://map-packages/tiles", minZoom: 0, maxZoom: 14, tileScheme: "xyz",
    boundsWgs84: { minLongitude: -105, minLatitude: 40, maxLongitude: -104, maxLatitude: 41 },
    attribution: "Synthetic fixture", licenseText: "Test data only", importedAt: "2026-09-27T00:00:00Z",
  }];
  assert.deepEqual(roundtrip(field), field);
  const manifest = field.mapPackages[0];
  for (const change of [
    { uri: "file:///operator/maps/private.pmtiles" }, { tileJsonUrl: "http://localhost:9911/tiles.json" },
    { tileUrlTemplates: ["C:\\tiles\\{z}\\{x}\\{y}.png"] }, { minZoom: 20 },
    { boundsWgs84: { minLongitude: -104, minLatitude: 40, maxLongitude: -105, maxLatitude: 41 } },
    { attribution: "" },
  ]) {
    assert.throws(() => validateFieldDesign({ ...field, mapPackages: [{ ...manifest, ...change }] }));
  }
  field.mapPackages.push(clone(field.mapPackages[0]));
  assert.throws(() => validateFieldDesign(field), /Duplicate map package/);
});

test("survey and obstacle v2 refinements survive schema reuse across the shared field", () => {
  const field = fixture();
  const evidence = v2Evidence();
  field.surveyPoints = [{
    id: "survey-record", label: "Synthetic survey", role: "control", projected: clone(field.fieldBoundary[0]),
    observedAt: evidence.receiverObservedAt, source: "external_gnss", confidence: "rtk_fixed", captureEvidence: evidence,
    rtk: { ...evidence.qualityScreen.receiverQuality, correctionAgeSeconds: 1.5 },
  }];
  field.obstacles = [{ id: "obstacle", name: "Synthetic exclusion", kind: "exclusion", polygon: clone(field.fieldBoundary),
    bufferMeters: 0, hardConflict: true, noSpray: true, confidence: "rtk_fixed",
    vertexCaptureEvidence: field.fieldBoundary.map((_, index) => index === 0 ? clone(evidence) : null) }];
  assert.deepEqual(roundtrip(field), field);
  field.surveyPoints[0].rtk!.correctionAgeSeconds = 1;
  assert.throws(() => validateFieldDesign(field), /capture elapsed correction age/);
  field.surveyPoints[0].rtk!.correctionAgeSeconds = 1.5;
  field.obstacles[0].polygon[0].x += 0.01;
  assert.throws(() => validateFieldDesign(field), /Conflicting observation/);
  field.obstacles[0].polygon[0].x = field.fieldBoundary[0].x;
  field.obstacles[0].vertexCaptureEvidence = [evidence];
  assert.throws(() => validateFieldDesign(field), /align with polygon vertices/);
});

test("conversion refuses unsupported source fields and never uses a recovery string to hide omission", () => {
  const source = JSON.parse(serializeProjectDocument(sampleProject));
  const mutations: Array<(raw: any) => void> = [
    raw => { raw.futureWrapper = true; }, raw => { raw.project.futureData = true; },
    raw => { raw.project.machine.futureCalibration = true; }, raw => { raw.project.fieldBoundary[0].z = 50; },
    raw => { raw.project.wgs84Companion.futureData = true; }, raw => { raw.project.settings.onlineImagery = {}; },
    raw => { raw.documentVersion = "pivot-project-v99"; }, raw => { raw.project.machines = []; },
  ];
  for (const mutate of mutations) {
    const raw = clone(source);
    mutate(raw);
    const document = JSON.stringify(raw);
    assert.throws(() => convertPivotProjectToFieldDesign(document, ids));
    assert.equal(JSON.stringify(raw), document);
  }
  const duplicate = JSON.stringify(source).replace('"id":', '"id":"discarded", "id":');
  assert.throws(() => convertPivotProjectToFieldDesign(duplicate, ids), /Duplicate JSON/);
});

function classifiedProject() {
  const project = clone(sampleProject);
  const specs: Array<{ purposeId: string; target: DrawingMetadataTarget; count: number }> = [
    { purposeId: "field_boundary", target: { kind: "field_boundary" }, count: project.fieldBoundary.length },
    { purposeId: "pivot_center", target: { kind: "pivot_center" }, count: 1 },
    { purposeId: "project_water_source", target: { kind: "water_source" }, count: 1 },
    { purposeId: "project_power_source", target: { kind: "power_source" }, count: 1 },
    { purposeId: "soil_zone", target: { kind: "map_feature", id: "soil-reference" }, count: 3 },
  ];
  project.drawingMetadata = { schemaVersion: PROJECT_DRAWING_METADATA_VERSION, autosaveEnabled: true,
    records: specs.map((spec, index) => {
      const purpose = drawingPurpose(spec.purposeId)!;
      const classification: DrawingClassification = {
        schemaVersion: DRAWING_CLASSIFICATION_VERSION, geometryType: purpose.geometry, purposeId: purpose.id,
        name: purpose.label, notes: "Exact retained notes", assetStatus: "unknown", placement: purpose.placements[0],
        customLabel: null, effect: { mode: "informational" },
      };
      return { target: spec.target, classification, capture: { captureId: `classification-${index}`, source: "map_digitized",
        vertexRecordedAt: Array(spec.count).fill("2026-09-27T12:00:00.000Z"), wgs84: null, elevation: null } };
    }),
  };
  project.mapFeatures = [{ id: "soil-reference", name: "Soil zone", notes: "Exact retained notes", kind: "reference_area",
    confidence: "user_estimated", geometry: { type: "Polygon", vertices: project.fieldBoundary.slice(0, 3) } }];
  return project;
}

test("classified project conversion retains every classification with exact field machine and source targets", () => {
  const project = classifiedProject();
  const original = serializeProjectDocument(project);
  const field = convertPivotProjectToFieldDesign(original, ids).field;
  assert.deepEqual(field.drawingMetadata!.records.map(record => record.target), [
    { kind: "field_boundary" }, { kind: "pivot_center", machineId: project.machine.id },
    { kind: "water_source", infrastructureId: ids.waterSourceId }, { kind: "power_source", infrastructureId: ids.powerSourceId },
    { kind: "map_feature", id: "soil-reference" },
  ]);
  assert.equal(field.drawingMetadata!.autosaveEnabled, true);
  assert.deepEqual(field.drawingMetadata!.records.map(({ target: _target, ...record }) => record),
    project.drawingMetadata!.records.map(({ target: _target, ...record }) => record));
  assert.deepEqual(field.mapFeatures, project.mapFeatures);
  assert.deepEqual(field.fieldBoundary, project.fieldBoundary);
  assert.equal(JSON.parse(serializeFieldDesignDocument(field)).documentVersion, FIELD_DESIGN_DOCUMENT_V2_VERSION);
  assert.deepEqual(roundtrip(field), field);
  assert.throws(() => parseFieldDesignDocumentV1(serializeFieldDesignDocument(field)), /unsupported/);
  const downgraded = { documentVersion: LEGACY_FIELD_DESIGN_DOCUMENT_VERSION, field };
  assert.throws(() => parseFieldDesignDocument(downgraded), /requires field-design-v2/);
  assert.throws(() => convertPivotProjectToFieldDesign(JSON.stringify(project), ids));
  assert.throws(() => convertPivotProjectToFieldDesign(JSON.stringify({ documentVersion: "pivot-project-v1", project }), ids));
});

test("straight lateral extension uses v3 and round-trips independently with classified metadata", () => {
  const field = convertPivotProjectToFieldDesign(serializeProjectDocument(classifiedProject()), ids).field;
  field.lateralMachines = [{ id: "linear-a", kind: "straight_lateral", name: "Explicit straight machine",
    leftExtentMeters: 60, rightExtentMeters: 30, travelHeadingDegrees: 0,
    travel: { start: { x: 0, y: 0 }, end: { x: 200, y: 0 } }, machineClearanceBufferMeters: 2,
    waterSourceId: ids.waterSourceId }];
  const text = serializeFieldDesignDocument(field);
  assert.equal(JSON.parse(text).documentVersion, FIELD_DESIGN_DOCUMENT_VERSION);
  const reopened = parseFieldDesignDocument(text);
  assert.deepEqual(reopened, field);
  assert.equal(reopened.lateralMachines![0].sprinklerReachMeters, undefined);
  assert.equal(reopened.lateralMachines![0].powerSourceId, undefined);
  reopened.lateralMachines![0].travel.end.x = 222;
  assert.equal(field.lateralMachines[0].travel.end.x, 200);
  assert.throws(() => parseFieldDesignDocumentV1(text), /unsupported/);
  assert.throws(() => parseFieldDesignDocumentV2(text), /unsupported/);
  for (const documentVersion of [LEGACY_FIELD_DESIGN_DOCUMENT_VERSION, FIELD_DESIGN_DOCUMENT_V2_VERSION]) {
    const withoutMetadata = clone(field);
    delete withoutMetadata.drawingMetadata;
    // Reference kinds require metadata independently; the old envelope must reject the extension first.
    assert.throws(() => parseFieldDesignDocument({ documentVersion, field: withoutMetadata }), /requires field-design-v3/);
    assert.throws(() => parseFieldDesignDocumentV2({ documentVersion, field: withoutMetadata }), /requires field-design-v3/);
  }
});

test("lateral identities and supplies are exact, optional absence is retained and empty extension is versioned", () => {
  const field = fixture();
  field.lateralMachines = [{ id: "linear", kind: "straight_lateral", name: "Unconnected",
    leftExtentMeters: 50, rightExtentMeters: 0, travelHeadingDegrees: 90,
    travel: { start: { x: 0, y: 0 }, end: { x: 0, y: 100 } }, machineClearanceBufferMeters: 0 }];
  assert.deepEqual(roundtrip(field), field);
  for (const patch of [{ id: field.machines[0].id }, { waterSourceId: ids.powerSourceId },
    { powerSourceId: ids.waterSourceId }, { waterSourceId: "absent" }]) {
    const invalid = clone(field);
    Object.assign(invalid.lateralMachines![0], patch);
    assert.throws(() => validateFieldDesign(invalid));
  }
  const duplicated = clone(field);
  duplicated.lateralMachines!.push(clone(duplicated.lateralMachines![0]));
  assert.throws(() => validateFieldDesign(duplicated), /Duplicate machine ID/);
  field.lateralMachines = [];
  assert.equal(JSON.parse(serializeFieldDesignDocument(field)).documentVersion, FIELD_DESIGN_DOCUMENT_VERSION);
  assert.deepEqual(roundtrip(field), field);
  delete field.lateralMachines;
  assert.equal(JSON.parse(serializeFieldDesignDocument(field)).documentVersion, LEGACY_FIELD_DESIGN_DOCUMENT_VERSION);
  assert.deepEqual(parseFieldDesignDocumentV2(serializeFieldDesignDocument(field)), field);
  const classified = convertPivotProjectToFieldDesign(serializeProjectDocument(classifiedProject()), ids).field;
  assert.deepEqual(parseFieldDesignDocumentV2(serializeFieldDesignDocument(classified)), classified);
  assert.equal(JSON.parse(serializeFieldDesignDocument(classified)).documentVersion, FIELD_DESIGN_DOCUMENT_V2_VERSION);
});

test("field classification references reject identity loss, duplicate targets and capture mismatches", () => {
  const field = convertPivotProjectToFieldDesign(serializeProjectDocument(classifiedProject()), ids).field;
  for (const mutate of [
    (value: FieldDesign) => { value.machines = []; },
    (value: FieldDesign) => { value.drawingMetadata!.records[2].target = { kind: "water_source", infrastructureId: ids.powerSourceId }; },
    (value: FieldDesign) => { value.drawingMetadata!.records.push(clone(value.drawingMetadata!.records[0])); },
    (value: FieldDesign) => { value.drawingMetadata!.records[1].capture.captureId = value.drawingMetadata!.records[0].capture.captureId; },
    (value: FieldDesign) => { value.drawingMetadata!.records[0].capture.vertexRecordedAt.pop(); },
    (value: FieldDesign) => { delete value.drawingMetadata; },
  ]) {
    const invalid = clone(field);
    mutate(invalid);
    assert.throws(() => validateFieldDesign(invalid));
  }
  assert.equal(JSON.parse(serializeFieldDesignDocument(fixture())).documentVersion, LEGACY_FIELD_DESIGN_DOCUMENT_VERSION);
  assert.deepEqual(parseFieldDesignDocumentV1(serializeFieldDesignDocument(fixture())), fixture());
});

test("conversion does not invent required policies that permissive legacy reading defaulted", () => {
  for (const omit of [
    (project: any) => { delete project.settings.mappingWorkflowMode; },
    (project: any) => { delete project.settings.aerialImagery; },
    (project: any) => { project.machine.driveUnits = { lrdu: {
      role: "lrdu", advisoryOnly: true, sourceRefs: [{ sourceId: "synthetic", limit: "Test-only declared metadata" }],
    } }; },
  ]) {
    const project = clone(sampleProject);
    omit(project);
    const original = JSON.stringify(project);
    assert.doesNotThrow(() => parseProjectDocument(original));
    assert.throws(() => convertPivotProjectToFieldDesign(original, ids), /explicit.*defaults/);
    assert.equal(JSON.stringify(project), original);
  }
});
