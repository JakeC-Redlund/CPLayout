import assert from "node:assert/strict";
import test from "node:test";

import {
  DESIGN_DRAFT_DOCUMENT_VERSION,
  evaluateDesignDraftCompleteness,
  parseDesignDraftDocument,
  serializeDesignDraftDocument,
  tryBuildPivotProject,
  type DesignDraft,
} from "./designDraft";
import { parseProjectDocument, PivotProjectSchema } from "./projectDocument";
import { defaultProjectSettings } from "./settings";
import type { GnssCaptureEvidence } from "./types";

function emptyDraft(): DesignDraft {
  const settings = defaultProjectSettings();
  delete settings.aerialImagery.sourcePackageId;
  return {
    id: "synthetic-draft", name: "Synthetic incomplete design", projectCrs: null,
    unitSystem: settings.unitSystem, settings, fieldBoundary: [], pivotCenter: null,
    waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [],
  };
}

function completeDraft(): DesignDraft {
  return {
    ...emptyDraft(), projectCrs: "EPSG:32613",
    fieldBoundary: [{ x: 500000, y: 4400000 }, { x: 500200, y: 4400000 }, { x: 500200, y: 4400200 }, { x: 500000, y: 4400200 }],
    pivotCenter: { x: 500100, y: 4400100 }, waterSource: { x: 500090, y: 4400100 }, powerSource: { x: 500080, y: 4400100 },
    machine: {
      id: "synthetic-machine", name: "Synthetic machine", spanLengthsMeters: [30, 30],
      overhangMeters: 5, endGunThrowMeters: 0, towerClearanceBufferMeters: 0,
      machineClearanceBufferMeters: 0, sweep: { mode: "full_circle" },
    },
  };
}

function parse(draft: unknown): DesignDraft {
  return parseDesignDraftDocument({ documentVersion: DESIGN_DRAFT_DOCUMENT_VERSION, draft });
}

function roundtrip(draft: DesignDraft): DesignDraft {
  const parsed = parseDesignDraftDocument(serializeDesignDraftDocument(draft));
  assert.deepEqual(parsed, draft);
  return parsed;
}

function assertInvalidDraft(draft: DesignDraft): void {
  assert.throws(() => parse(draft));
  assert.throws(() => serializeDesignDraftDocument(draft));
  assert.throws(() => evaluateDesignDraftCompleteness(draft));
  const result = tryBuildPivotProject(draft);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid_draft");
}

function capture(observationId = "capture-1"): GnssCaptureEvidence {
  return {
    schemaVersion: "gnss-capture-v1", observationId, sessionId: "synthetic-session", transport: "replay",
    receivedAt: "2026-09-14T12:00:00Z", receivedMonotonicMs: 5, sourceCoordinateFrame: "EPSG:4326",
    antennaReference: "unknown", sentenceTypes: ["GGA"], coherent: true, rawRecordHashes: ["synthetic-hash"],
  };
}

test("empty design saves without fabricated inputs or optional arrays", () => {
  const draft = roundtrip(emptyDraft());
  assert.deepEqual(draft.machine, {});
  assert.equal(draft.projectCrs, null);
  assert.equal(Object.hasOwn(draft, "mapFeatures"), false);
  assert.equal(Object.hasOwn(draft.machine, "endGunAngleRanges"), false);
  const result = evaluateDesignDraftCompleteness(draft);
  assert.equal(result.complete, false);
  assert.equal(result.calculationEligible, false);
  assert.equal(result.crsQualification, null);
  for (const path of ["projectCrs", "fieldBoundary", "pivotCenter", "waterSource", "powerSource", "machine.id", "machine.sweep"]) {
    assert.ok(result.blockers.some((blocker) => blocker.path === path), path);
  }
  assert.equal(tryBuildPivotProject(draft).ok, false);
  assert.throws(() => parseProjectDocument(draft));
});

test("each absent infrastructure point independently saves and blocks completion", () => {
  for (const key of ["pivotCenter", "waterSource", "powerSource"] as const) {
    const draft = completeDraft();
    draft[key] = null;
    const result = evaluateDesignDraftCompleteness(roundtrip(draft));
    assert.equal(result.complete, false);
    assert.ok(result.blockers.some((blocker) => blocker.path === key), key);
    assert.equal(tryBuildPivotProject(draft).ok, false);
  }
});

test("each absent machine input independently saves and blocks completion", () => {
  for (const key of ["id", "name", "spanLengthsMeters", "overhangMeters", "endGunThrowMeters", "towerClearanceBufferMeters", "machineClearanceBufferMeters", "sweep"] as const) {
    const draft = completeDraft();
    delete draft.machine[key];
    const result = evaluateDesignDraftCompleteness(roundtrip(draft));
    assert.equal(result.complete, false, key);
    assert.ok(result.blockers.some((blocker) => blocker.path.startsWith(`machine.${key}`)), key);
    assert.equal(tryBuildPivotProject(draft).ok, false);
  }
  for (const key of ["startAngleDegrees", "stopAngleDegrees", "direction"] as const) {
    const draft = completeDraft();
    draft.machine.sweep = { mode: "partial_circle", startAngleDegrees: 0, stopAngleDegrees: 90, direction: "clockwise" };
    delete draft.machine.sweep[key];
    assert.equal(evaluateDesignDraftCompleteness(roundtrip(draft)).complete, false, key);
  }
});

test("empty and partial boundary and span inputs survive roundtrip", () => {
  for (const count of [0, 1, 2]) {
    const draft = completeDraft();
    draft.fieldBoundary = draft.fieldBoundary.slice(0, count);
    assert.equal(evaluateDesignDraftCompleteness(roundtrip(draft)).complete, false);
    assert.equal(tryBuildPivotProject(draft).ok, false);
  }
  for (const spans of [[], [null], [30, null, 45]]) {
    const draft = completeDraft();
    draft.machine.spanLengthsMeters = spans;
    draft.machine.sweep = { mode: "partial_circle", startAngleDegrees: 10 };
    assert.equal(evaluateDesignDraftCompleteness(roundtrip(draft)).complete, false);
    assert.equal(tryBuildPivotProject(draft).ok, false);
  }
});

test("incomplete topology stays saveable but cannot produce a project", () => {
  const rings = [
    [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }],
    [{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 20, y: 0 }],
    [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 0 }],
  ];
  for (const fieldBoundary of rings) {
    const draft = { ...completeDraft(), fieldBoundary };
    const result = evaluateDesignDraftCompleteness(roundtrip(draft));
    assert.equal(result.complete, false);
    assert.ok(result.blockers.some((blocker) => blocker.path === "fieldBoundary"));
    assert.equal(tryBuildPivotProject(draft).ok, false);
  }
});

test("all present XY collections require an explicit CRS", () => {
  const complete = completeDraft();
  const variants: Partial<DesignDraft>[] = [
    { fieldBoundary: complete.fieldBoundary.slice(0, 1) },
    { pivotCenter: complete.pivotCenter }, { waterSource: complete.waterSource }, { powerSource: complete.powerSource },
    { surveyPoints: [{ id: "observation", label: "Observation", role: "note", projected: complete.pivotCenter!, observedAt: "synthetic", source: "manual", confidence: "user_estimated" }] },
    { obstacles: [{ id: "obstacle", name: "Obstacle", kind: "exclusion", polygon: complete.fieldBoundary, bufferMeters: 0, hardConflict: true, noSpray: true, confidence: "user_estimated" }] },
    { mapFeatures: [{ id: "point", name: "Point", kind: "pump_location", geometry: { type: "Point", point: complete.pivotCenter! }, confidence: "user_estimated" }] },
  ];
  for (const variant of variants) assert.throws(() => parse({ ...emptyDraft(), ...variant }), /explicit projected\/local CRS/);
  for (const projectCrs of ["", "EPSG:4326", "EPSG:999999", "+proj=longlat +datum=WGS84"]) {
    assert.throws(() => parse({ ...emptyDraft(), projectCrs }));
  }
});

test("invalid and nonfinite present values are refused before serialization", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const update of [
      { pivotCenter: { x: value, y: 0 } },
      { fieldBoundary: [{ x: 0, y: value }] },
      { machine: { overhangMeters: value } },
      { machine: { spanLengthsMeters: [value] } },
      { machine: { sweep: { mode: "partial_circle", startAngleDegrees: value } } },
      { fieldBoundaryCaptureEvidence: [capture()] , fieldBoundary: [{ x: 0, y: value }] },
    ]) {
      const draft = { ...completeDraft(), ...update } as DesignDraft;
      assert.throws(() => parse(draft), /finite/);
      assert.throws(() => serializeDesignDraftDocument(draft), /finite/);
      assert.equal(tryBuildPivotProject(draft).ok, false);
    }
  }
  for (const machine of [{ overhangMeters: -1 }, { spanLengthsMeters: [0] }, { sweep: { mode: "bad" } }, { id: "" }]) {
    assert.throws(() => parse({ ...emptyDraft(), machine }));
  }
  assert.throws(() => parse({ ...emptyDraft(), machine: null }));
  assert.throws(() => parse({ ...emptyDraft(), pivotCenter: { x: 1 } }));
});

test("strict JSON and version contracts refuse unsupported data without mutation", () => {
  const draft = emptyDraft();
  for (const documentVersion of ["design-draft-v2", "pivot-project-v1", "", null]) {
    assert.throws(() => parseDesignDraftDocument({ documentVersion, draft }));
  }
  assert.throws(() => parseDesignDraftDocument(draft));
  assert.throws(() => parseDesignDraftDocument("{"));
  assert.throws(() => parseDesignDraftDocument({ documentVersion: DESIGN_DRAFT_DOCUMENT_VERSION, draft, extra: true }));
  assert.throws(() => parse({ ...draft, extra: "unknown metadata" }));
  assert.deepEqual(parse({ ...draft, machine: { overhangMeters: undefined } }).machine, {});
  assert.throws(() => parse({ ...draft, machine: { customField: 42 } }));
  assert.throws(() => parse({ ...draft, settings: { ...draft.settings, localPath: "/local/private" } }), /Unsupported field/);
  const cycle: Record<string, unknown> = { ...draft };
  cycle.self = cycle;
  assert.throws(() => parse(cycle), /Cyclic/);
  assert.deepEqual(draft, emptyDraft());
});

test("settings must be real supplied values and cannot silently receive legacy defaults", () => {
  const draft = emptyDraft();
  assert.deepEqual(parse({ ...draft, settings: defaultProjectSettings() }), draft);
  const { mappingWorkflowMode: _mode, ...settings } = draft.settings;
  assert.throws(() => parse({ ...draft, settings }), /explicitly/);
  assert.throws(() => parse({ ...draft, settings: null }));
  assert.throws(() => parse({ ...draft, settings: { ...draft.settings, unitSystem: "metric" } }), /unitSystem/);
  draft.settings.drawing.panStepMeters = 234;
  draft.settings.layoutReview.requiredBoundaryClearanceMeters = 12;
  assert.deepEqual(roundtrip(draft).settings, draft.settings);
});

test("metadata, references and provenance roundtrip without normalization or derivation", () => {
  const draft = completeDraft();
  draft.fieldBoundaryCaptureEvidence = [capture(), null, null, null];
  draft.surveyPoints = [{
    id: "pivot-observation", label: "Synthetic control", role: "pivot_center", projected: draft.pivotCenter!,
    observedAt: "synthetic", source: "imported", confidence: "imported_cad", notes: "Retain source note.",
    captureEvidence: capture("pivot-capture"), wgs84: { longitude: -105, latitude: 39.75 },
  }];
  draft.infrastructureObservationRefs = { pivot_center: "pivot-observation" };
  draft.mapFeatures = [{
    id: "well", name: "Synthetic well", kind: "well_location", confidence: "user_estimated",
    geometry: { type: "Point", point: draft.waterSource! }, vertexCaptureEvidence: [null],
    properties: { referenceId: "source-1", count: 2, confirmed: false, missing: null }, notes: "Retain notes.",
  }];
  draft.mapPackages = [{
    id: "logical-map", name: "Logical map metadata", packageType: "raster_tiles", tileContentType: "raster",
    uri: "app://map-packages/logical-map/", minZoom: 1, maxZoom: 16, tileScheme: "xyz",
    boundsWgs84: { minLongitude: -106, maxLongitude: -104, minLatitude: 39, maxLatitude: 41 },
    attribution: "Synthetic source", licenseText: "Synthetic test only", importedAt: "synthetic",
    imageryProvenance: {
      providerId: "synthetic", providerName: "Synthetic source", accessedAt: "synthetic", attribution: "Synthetic source",
      licenseText: "Synthetic test only", offlineCopyAllowed: true, keyedService: false, originalCrs: "EPSG:32613",
    },
  }];
  draft.wgs84Companion = { status: "unavailable", source: "derived_from_project_xy", coordinateSystem: "decimal_degrees", projectCrs: draft.projectCrs!, error: "Preserve original diagnostic." };
  draft.machine.catalogSelection = {
    catalogId: "synthetic-catalog", manufacturer: "Synthetic", model: "Synthetic", sourceUrl: "https://example.org/source",
    sourceAccessedAt: "synthetic", advisoryOnly: true,
  };
  draft.machine.driveUnits = { lrdu: { role: "lrdu", advisoryOnly: true, customMotorRpm: 1, sourceRefs: [{ sourceId: "operator", limit: "Synthetic evidence only" }], caveats: ["Advisory only."] } };
  for (const uri of ["file:///private/map", "/mnt/h/private/map", "https://example.org/tiles", "app://other/map"]) {
    assert.throws(() => parse({ ...draft, mapPackages: [{ ...draft.mapPackages![0], uri }] }), /logical app/);
  }
  assert.throws(() => parse({ ...draft, mapPackages: [{ ...draft.mapPackages![0], maxZoom: 0 }] }), /maxZoom/);
  const incomplete = { ...draft, fieldBoundary: draft.fieldBoundary.slice(0, 2), fieldBoundaryCaptureEvidence: draft.fieldBoundaryCaptureEvidence.slice(0, 2), machine: { spanLengthsMeters: [30, null] } };
  roundtrip(incomplete);
  assert.equal(tryBuildPivotProject(incomplete).ok, false);
  const before = JSON.stringify(draft);
  const parsed = roundtrip(draft);
  const result = tryBuildPivotProject(parsed);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.project, draft);
  assert.equal(JSON.stringify(draft), before);
  result.project.fieldBoundary[0].x += 1;
  result.project.machine.driveUnits!.lrdu!.sourceRefs[0].limit = "changed";
  assert.equal(JSON.stringify(draft), before);
  assert.equal(JSON.stringify(parsed), before);
});

test("reference and capture evidence violations cannot be saved as incomplete drafts", () => {
  const draft = completeDraft();
  draft.surveyPoints = [{ id: "p", label: "P", role: "control", projected: draft.pivotCenter!, observedAt: "synthetic", source: "manual", confidence: "user_estimated" }];
  draft.infrastructureObservationRefs = { pivot_center: "p" };
  roundtrip(draft);
  assert.throws(() => parse({ ...draft, pivotCenter: null }), /exact projected XY/);
  assert.throws(() => parse({ ...draft, pivotCenter: draft.waterSource }), /exact projected XY/);
  assert.throws(() => parse({ ...draft, infrastructureObservationRefs: { pivot_center: "missing" } }), /exact projected XY/);
  assert.throws(() => parse({ ...draft, surveyPoints: [...draft.surveyPoints, ...draft.surveyPoints] }), /Duplicate ID/);
  assert.throws(() => parse({ ...draft, fieldBoundaryCaptureEvidence: [capture()] }), /align/);
  assert.throws(() => parse({ ...draft, fieldBoundaryCaptureEvidence: [capture(), capture(), null, null] }), /Conflicting observation/);
  draft.fieldBoundaryCaptureEvidence = [capture(), null, null, null];
  draft.surveyPoints[0].captureEvidence = capture();
  assert.throws(() => parse(draft), /Conflicting observation/);
  draft.surveyPoints[0].projected = draft.fieldBoundary[0];
  delete draft.infrastructureObservationRefs;
  roundtrip(draft);
  draft.surveyPoints[0].captureEvidence.coherent = false;
  assert.throws(() => parse(draft), /Conflicting observation/);
});

test("existing component evidence and geometry-kind validators still apply", () => {
  const draft = completeDraft();
  const feature = { id: "feature", name: "Feature", kind: "pump_location", confidence: "user_estimated", geometry: { type: "Point", point: draft.pivotCenter }, vertexCaptureEvidence: [] };
  assert.throws(() => parse({ ...draft, mapFeatures: [feature] }), /align/);
  assert.throws(() => parse({ ...draft, mapFeatures: [{ ...feature, kind: "power_line", vertexCaptureEvidence: [null] }] }), /requires/);
  assert.throws(() => parse({ ...draft, mapFeatures: [{ ...feature, vertexCaptureEvidence: [null], properties: { invalid: Infinity } }] }), /finite/);
  assert.throws(() => parse({ ...draft, wgs84Companion: { status: "unavailable", source: "derived_from_project_xy", coordinateSystem: "decimal_degrees", projectCrs: "LOCAL:other" } }), /no relabeling/);
});

test("supported complete fixture builds a detached project without upgrading qualification", () => {
  const draft = roundtrip(completeDraft());
  const before = JSON.stringify(draft);
  const result = tryBuildPivotProject(draft);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.completeness.complete, true);
  assert.equal(result.completeness.calculationEligible, true);
  assert.equal(result.completeness.fieldQualified, false);
  assert.equal(result.completeness.crsQualification?.field.qualified, false);
  assert.ok(PivotProjectSchema.safeParse(result.project).success);
  assert.deepEqual(result.project, draft);
  assert.equal(Object.hasOwn(result.project, "wgs84Companion"), false);
  result.project.pivotCenter.x += 10;
  result.project.machine.spanLengthsMeters.push(50);
  assert.equal(JSON.stringify(draft), before);
});

test("legacy-readable unqualified CRS stores unchanged but cannot enable calculation", () => {
  for (const projectCrs of ["EPSG:3857", "EPSG:26741", "EPSG:26960", "LOCAL:operator-grid"]) {
    const draft = { ...completeDraft(), projectCrs };
    const before = JSON.stringify(draft);
    assert.ok(PivotProjectSchema.safeParse(draft).success, projectCrs);
    const parsed = roundtrip(draft);
    const completeness = evaluateDesignDraftCompleteness(parsed);
    assert.equal(completeness.complete, true, projectCrs);
    assert.equal(completeness.calculationEligible, false, projectCrs);
    assert.equal(completeness.crsQualification?.field.qualified, false);
    const result = tryBuildPivotProject(parsed);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "calculation_ineligible");
    assert.equal(JSON.stringify(parsed), before);
  }
});

test("array JSON hooks cannot rewrite validated XY or introduce nonfinite data", () => {
  for (const enumerable of [true, false]) {
    const draft = completeDraft();
    let calls = 0;
    Object.defineProperty(draft.fieldBoundary, "toJSON", {
      enumerable,
      value: () => {
        calls += 1;
        draft.name = "Changed by hook";
        return [{ x: Infinity, y: 0 }];
      },
    });
    const before = Object.getOwnPropertyDescriptors(draft.fieldBoundary);
    assertInvalidDraft(draft);
    assert.equal(calls, 0);
    assert.equal(draft.name, completeDraft().name);
    assert.deepEqual(Object.getOwnPropertyDescriptors(draft.fieldBoundary), before);
    assert.deepEqual(draft.fieldBoundary.slice(), completeDraft().fieldBoundary);
  }
  const draft = completeDraft();
  let calls = 0;
  const inherited = Object.create(Array.prototype, {
    toJSON: { value: () => { calls += 1; return [{ x: Infinity, y: 0 }]; } },
  });
  Object.setPrototypeOf(draft.fieldBoundary, inherited);
  assertInvalidDraft(draft);
  assert.equal(calls, 0);
  assert.equal(Object.getPrototypeOf(draft.fieldBoundary), inherited);
});

test("JSON hooks inherited from standard prototypes are rejected without execution", () => {
  for (const prototype of [Array.prototype, Object.prototype]) {
    const draft = completeDraft();
    const previous = Object.getOwnPropertyDescriptor(prototype, "toJSON");
    let calls = 0;
    try {
      Object.defineProperty(prototype, "toJSON", {
        configurable: true,
        get: () => { calls += 1; return () => [{ x: Infinity, y: 0 }]; },
      });
      assertInvalidDraft(draft);
    } finally {
      if (previous) Object.defineProperty(prototype, "toJSON", previous);
      else Reflect.deleteProperty(prototype, "toJSON");
    }
    assert.equal(calls, 0);
    assert.deepEqual(draft, completeDraft());
  }
});

test("array accessor indices and hook accessors are refused before reading", () => {
  for (const target of ["boundary", "spans"] as const) {
    for (const key of ["0", "toJSON"]) {
      const draft = completeDraft();
      const array = target === "boundary" ? draft.fieldBoundary : draft.machine.spanLengthsMeters!;
      let reads = 0;
      Object.defineProperty(array, key, {
        enumerable: true,
        get: () => {
          reads += 1;
          return key === "toJSON" ? () => [Infinity] : target === "boundary" ? { x: 0, y: 0 } : 30;
        },
      });
      const before = Object.getOwnPropertyDescriptors(array);
      assertInvalidDraft(draft);
      assert.equal(reads, 0);
      assert.deepEqual(Object.getOwnPropertyDescriptors(array), before);
    }
  }
});

test("sparse arrays and extra or hidden array properties are refused", () => {
  for (const kind of ["sparse", "extra", "hidden", "hidden_index", "sparse_with_extra"] as const) {
    const draft = completeDraft();
    if (kind === "sparse" || kind === "sparse_with_extra") delete draft.fieldBoundary[1];
    if (kind === "extra" || kind === "hidden" || kind === "sparse_with_extra") {
      Object.defineProperty(draft.fieldBoundary, "extra", { value: 1, enumerable: kind !== "hidden" });
    }
    if (kind === "hidden_index") Object.defineProperty(draft.fieldBoundary, "0", { enumerable: false });
    const before = Object.getOwnPropertyDescriptors(draft.fieldBoundary);
    assertInvalidDraft(draft);
    assert.deepEqual(Object.getOwnPropertyDescriptors(draft.fieldBoundary), before);
  }
});

test("envelope and nested object accessors are refused without execution", () => {
  for (const key of ["documentVersion", "draft", "extra"]) {
    for (const enumerable of [true, false]) {
      const envelope = { documentVersion: DESIGN_DRAFT_DOCUMENT_VERSION, draft: completeDraft() };
      let reads = 0;
      Object.defineProperty(envelope, key, {
        enumerable,
        get: () => { reads += 1; throw new Error("Getter must not execute"); },
      });
      const before = Object.getOwnPropertyDescriptors(envelope);
      assert.throws(() => parseDesignDraftDocument(envelope), /data property/);
      assert.equal(reads, 0);
      assert.deepEqual(Object.getOwnPropertyDescriptors(envelope), before);
    }
  }
  const draft = completeDraft();
  let reads = 0;
  Object.defineProperty(draft.pivotCenter, "x", {
    enumerable: true,
    get: () => { reads += 1; return Infinity; },
  });
  assertInvalidDraft(draft);
  assert.equal(reads, 0);
});

test("frozen plain input creates a detached validated snapshot", () => {
  const draft = completeDraft();
  Object.freeze(draft.fieldBoundary);
  Object.freeze(draft.fieldBoundary[0]);
  Object.freeze(draft.machine.spanLengthsMeters);
  const parsed = roundtrip(draft);
  assert.notEqual(parsed.fieldBoundary, draft.fieldBoundary);
  assert.notEqual(parsed.machine.spanLengthsMeters, draft.machine.spanLengthsMeters);
  parsed.fieldBoundary[0].x += 1;
  parsed.machine.spanLengthsMeters!.push(25);
  assert.deepEqual(draft, completeDraft());
});

test("finite inputs with overflowing aggregate distances remain saveable but noncalculable", () => {
  const cases = [
    { spans: [Number.MAX_VALUE, Number.MAX_VALUE], overhang: 0, endGun: 0, path: "machine.spanLengthsMeters" },
    { spans: [Number.MAX_VALUE], overhang: Number.MAX_VALUE, endGun: 0, path: "machine.overhangMeters" },
    { spans: [Number.MAX_VALUE], overhang: 0, endGun: Number.MAX_VALUE, path: "machine.endGunThrowMeters" },
    { spans: [7e307], overhang: 7e307, endGun: 7e307, path: "machine.endGunThrowMeters" },
  ];
  for (const entry of cases) {
    const draft = completeDraft();
    draft.machine.spanLengthsMeters = entry.spans;
    draft.machine.overhangMeters = entry.overhang;
    draft.machine.endGunThrowMeters = entry.endGun;
    const before = JSON.stringify(draft);
    const parsed = roundtrip(draft);
    const completeness = evaluateDesignDraftCompleteness(parsed);
    assert.equal(completeness.complete, true);
    assert.deepEqual(completeness.blockers, []);
    assert.equal(completeness.crsQualification?.calculation.allowed, true);
    assert.equal(completeness.calculationEligible, false);
    assert.deepEqual(completeness.calculationBlockers.map(({ code, path }) => ({ code, path })), [
      { code: "non_finite_machine_distance", path: entry.path },
    ]);
    assert.equal(completeness.fieldQualified, false);
    const result = tryBuildPivotProject(parsed);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "calculation_ineligible");
    assert.equal(JSON.stringify(draft), before);
    assert.equal(JSON.stringify(parsed), before);
  }
  const finite = completeDraft();
  finite.machine.spanLengthsMeters = [Number.MAX_VALUE / 8, Number.MAX_VALUE / 8];
  finite.machine.overhangMeters = Number.MAX_VALUE / 8;
  finite.machine.endGunThrowMeters = Number.MAX_VALUE / 8;
  const result = evaluateDesignDraftCompleteness(roundtrip(finite));
  assert.equal(result.complete, true);
  assert.equal(result.calculationEligible, false);
  assert.ok(result.calculationBlockers.some((issue) => issue.code === "geometry_product_range"));
});

function assertNumericallyBlocked(draft: DesignDraft, code: string): void {
  const before = JSON.stringify(draft);
  const parsed = roundtrip(draft);
  const completeness = evaluateDesignDraftCompleteness(parsed);
  assert.equal(completeness.complete, true);
  assert.deepEqual(completeness.blockers, []);
  assert.equal(completeness.calculationEligible, false);
  assert.ok(completeness.calculationBlockers.some((issue) => issue.code === code), code);
  assert.equal(completeness.fieldQualified, false);
  const result = tryBuildPivotProject(parsed);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "calculation_ineligible");
  assert.equal(JSON.stringify(draft), before);
  assert.equal(JSON.stringify(parsed), before);
}

test("area overflow and nonfinite generated-coordinate repros cannot build projects", () => {
  const areaOverflow = completeDraft();
  areaOverflow.machine.spanLengthsMeters = [1e155];
  areaOverflow.machine.overhangMeters = 0;
  areaOverflow.machine.endGunThrowMeters = 0;
  assertNumericallyBlocked(areaOverflow, "geometry_product_range");

  const vertexOverflow = completeDraft();
  vertexOverflow.pivotCenter = { x: Number.MAX_VALUE, y: 0 };
  vertexOverflow.machine.spanLengthsMeters = [1e308];
  vertexOverflow.machine.overhangMeters = 0;
  vertexOverflow.machine.endGunThrowMeters = 0;
  assertNumericallyBlocked(vertexOverflow, "non_finite_geometry_extent");
});

test("finite radii must also fit conservative coverage and coordinate-resolution budgets", () => {
  const tooManySegments = completeDraft();
  tooManySegments.machine.spanLengthsMeters = [1e6];
  assertNumericallyBlocked(tooManySegments, "geometry_segment_budget");
  const unresolved = completeDraft();
  unresolved.pivotCenter = { x: 1e13, y: 0 };
  assertNumericallyBlocked(unresolved, "geometry_coordinate_resolution");
  const unsafeAngle = completeDraft();
  unsafeAngle.machine.sweep = { mode: "partial_circle", startAngleDegrees: Number.MAX_VALUE, stopAngleDegrees: 0, direction: "clockwise" };
  assertNumericallyBlocked(unsafeAngle, "geometry_angle_range");
});

test("numerical envelope includes boundaries, infrastructure, survey and map geometry", () => {
  const draft = completeDraft();
  const enormous = [{ x: 0, y: 0 }, { x: 1e155, y: 0 }, { x: 1e155, y: 1e155 }, { x: 0, y: 1e155 }];
  const variants: Partial<DesignDraft>[] = [
    { fieldBoundary: enormous },
    { waterSource: { x: 1e155, y: 0 } },
    { powerSource: { x: 0, y: 1e155 } },
    { surveyPoints: [{ id: "bender", label: "Bender second pivot", role: "pivot_center", projected: enormous[1], observedAt: "synthetic", source: "manual", confidence: "user_estimated" }] },
    { obstacles: [{ id: "obstacle", name: "Obstacle", kind: "exclusion", polygon: enormous, bufferMeters: 0, hardConflict: true, noSpray: true, confidence: "user_estimated" }] },
    { mapFeatures: [{ id: "point", name: "Point", kind: "pump_location", confidence: "user_estimated", geometry: { type: "Point", point: enormous[1] } }] },
    { mapFeatures: [{ id: "line", name: "Line", kind: "fence", confidence: "user_estimated", geometry: { type: "LineString", vertices: enormous.slice(0, 2) } }] },
    { mapFeatures: [{ id: "zone", name: "Zone", kind: "machine_zone", confidence: "user_estimated", geometry: { type: "Polygon", vertices: enormous } }] },
    { mapFeatures: [{ id: "circle", name: "Circle", kind: "machine_zone", confidence: "user_estimated", geometry: { type: "Circle", center: draft.pivotCenter!, radiusMeters: 1e155 } }] },
  ];
  for (const variant of variants) assertNumericallyBlocked({ ...draft, ...variant }, "geometry_product_range");
});

test("corner, feature and clearance extensions are part of the consumer budget", () => {
  const draft = completeDraft();
  const corner: NonNullable<DesignDraft["machine"]["cornerArm"]> = {
    id: "corner", name: "Synthetic corner", advisoryOnly: true, lengthMeters: 30,
    guidanceType: "unknown", sequencingType: "unknown", orientation: "unknown", confidence: "user_estimated",
    sourceRefs: [{ sourceId: "synthetic", limit: "Numerical test only." }],
  };
  for (const machine of [
    { ...draft.machine, cornerArm: { ...corner, lengthMeters: 1e6 } },
    { ...draft.machine, cornerArm: { ...corner, wheelTrackLengthMeters: 6e5, overhangLengthMeters: 6e5 } },
    { ...draft.machine, towerClearanceBufferMeters: 1e6 },
    { ...draft.machine, machineClearanceBufferMeters: 1e6 },
    { ...draft.machine, endGunThrowMeters: 1e6 },
  ]) assertNumericallyBlocked({ ...draft, machine }, "geometry_segment_budget");
  assertNumericallyBlocked({ ...draft, machine: { ...draft.machine, cornerArm: { ...corner, wheelTrackLengthMeters: Number.MAX_VALUE, overhangLengthMeters: Number.MAX_VALUE } } }, "non_finite_geometry_extent");
  assertNumericallyBlocked({ ...draft, obstacles: [{ id: "buffer", name: "Buffered obstacle", kind: "exclusion", polygon: draft.fieldBoundary,
    bufferMeters: 1e6, hardConflict: true, noSpray: true, confidence: "user_estimated" }] }, "geometry_segment_budget");
  assertNumericallyBlocked({ ...draft, mapFeatures: [{ id: "circle", name: "Circle", kind: "machine_zone", confidence: "user_estimated",
    geometry: { type: "Circle", center: draft.pivotCenter!, radiusMeters: 1e6 } }] }, "geometry_segment_budget");
  assertNumericallyBlocked({ ...draft, mapFeatures: [{ id: "outline", name: "Outline", kind: "planning_boundary", confidence: "user_estimated",
    geometry: { type: "Polygon", vertices: [{ x: 0, y: 0 }, { x: 1e6, y: 0 }, { x: 1e6, y: 1e6 }, { x: 0, y: 1e6 }] } }] }, "geometry_segment_budget");
});

test("large representable geometry remains eligible without imposing physical machine maxima", () => {
  const draft = completeDraft();
  draft.machine.spanLengthsMeters = [50000, 50000];
  draft.machine.overhangMeters = 1000;
  draft.machine.endGunThrowMeters = 5000;
  draft.machine.machineClearanceBufferMeters = 100;
  const before = JSON.stringify(draft);
  const result = tryBuildPivotProject(roundtrip(draft));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.completeness.complete, true);
  assert.equal(result.completeness.calculationEligible, true);
  assert.deepEqual(result.completeness.calculationBlockers, []);
  assert.equal(result.completeness.fieldQualified, false);
  assert.equal(JSON.stringify(draft), before);
});

test("unknown nested fields and versions in evidence and metadata refuse without mutation", () => {
  const draft = completeDraft();
  const provenance = {
    providerId: "synthetic", providerName: "Synthetic", accessedAt: "synthetic", attribution: "Synthetic",
    licenseText: "Synthetic only", offlineCopyAllowed: true, keyedService: false,
  };
  const mapPackage = {
    id: "synthetic-map", name: "Synthetic map", packageType: "raster_tiles", tileContentType: "raster",
    uri: "app://map-packages/synthetic-map/", minZoom: 1, maxZoom: 16, tileScheme: "xyz",
    boundsWgs84: { minLongitude: -106, maxLongitude: -104, minLatitude: 39, maxLatitude: 41 },
    attribution: "Synthetic", licenseText: "Synthetic only", importedAt: "synthetic", imageryProvenance: provenance,
    vectorOverlay: { schema: "cplayout_reference_v1", sourceLayers: { roads: "roads", roadLabels: "labels", borders: "borders", places: "places" } },
  };
  roundtrip(parse({ ...draft, mapPackages: [mapPackage], fieldBoundaryCaptureEvidence: [capture(), null, null, null] }));
  const variants: unknown[] = [
    { ...draft, fieldBoundaryCaptureEvidence: [{ ...capture(), schemaVersion: "gnss-capture-v2" }, null, null, null] },
    { ...draft, fieldBoundaryCaptureEvidence: [{ ...capture(), extraEvidence: true }, null, null, null] },
    { ...draft, fieldBoundaryCaptureEvidence: [{ ...capture(), height: { meters: 1, type: "unknown", schemaVersion: "height-v2" } }, null, null, null] },
    { ...draft, machine: { ...draft.machine, schemaVersion: "machine-v2" } },
    { ...draft, machine: { ...draft.machine, sweep: { mode: "full_circle", futureSweep: true } } },
    { ...draft, machine: { ...draft.machine, sweep: { mode: "future_sweep" } } },
    { ...draft, machine: { ...draft.machine, endGunAngleRanges: [{ startAngleDegrees: 0, stopAngleDegrees: 90, direction: "clockwise", schemaVersion: "angles-v2" }] } },
    { ...draft, mapPackages: [{ ...mapPackage, schemaVersion: "map-package-v2" }] },
    { ...draft, mapPackages: [{ ...mapPackage, imageryProvenance: { ...provenance, schemaVersion: "imagery-v2" } }] },
    { ...draft, mapPackages: [{ ...mapPackage, vectorOverlay: { ...mapPackage.vectorOverlay, schema: "reference-v2" } }] },
    { ...draft, mapPackages: [{ ...mapPackage, vectorOverlay: { ...mapPackage.vectorOverlay, sourceLayers: { ...mapPackage.vectorOverlay.sourceLayers, futureLayer: "new" } } }] },
  ];
  for (const variant of variants) {
    const before = JSON.stringify(variant);
    assertInvalidDraft(variant as DesignDraft);
    assert.equal(JSON.stringify(variant), before);
  }
  assert.deepEqual(draft, completeDraft());
});
