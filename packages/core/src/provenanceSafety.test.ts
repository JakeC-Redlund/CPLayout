import assert from "node:assert/strict";
import { test } from "node:test";

import { createManualDesignDraft, evaluateManualDesignReadiness } from "./manualDesign";
import { parseProjectDocument, serializeProjectDocument } from "./projectDocument";
import { createProjectEditorState, reduceProjectEditorState } from "./projectReducer";
import type { GnssCaptureEvidence, PivotProject, ProjectMapFeature, SurveyPoint, XY } from "./types";

const ring: XY[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const evidence = (id: string): GnssCaptureEvidence => ({
  schemaVersion: "gnss-capture-v1", observationId: `epoch-${id}`, sessionId: "serial-1", transport: "web_serial",
  receivedAt: "2026-09-13T12:00:00.000Z", receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326",
  antennaReference: "unknown", sentenceTypes: ["GGA", "GST"], coherent: true,
});
const point = (id = "survey-1", projected: XY = { x: 50, y: 50 }): SurveyPoint => ({
  id, projected, label: id, role: "control", observedAt: "2026-09-13T12:00:00.000Z", source: "external_gnss",
  confidence: "rtk_fixed", captureEvidence: evidence(id),
  rtk: { fixType: "rtk_fixed", satellites: 16, hdop: 0.7, vdop: null, pdop: null, correctionAgeSeconds: 1,
    horizontalAccuracyMeters: 0.01, verticalAccuracyMeters: null },
});
function project(): PivotProject {
  return {
    id: "provenance-fixture", name: "Synthetic provenance fixture", projectCrs: "LOCAL", unitSystem: "metric",
    fieldBoundary: ring.map((p) => ({ ...p })), fieldBoundaryCaptureEvidence: ring.map((_p, i) => evidence(`v${i}`)),
    pivotCenter: { x: 50, y: 50 }, waterSource: { x: 40, y: 40 }, powerSource: { x: 60, y: 60 },
    infrastructureObservationRefs: { pivot_center: "survey-1" }, surveyPoints: [point()], obstacles: [], mapFeatures: [],
    machine: { id: "m1", name: "Synthetic pivot", spanLengthsMeters: [10], overhangMeters: 1, endGunThrowMeters: 0,
      towerClearanceBufferMeters: 0, machineClearanceBufferMeters: 0, sweep: { mode: "full_circle" } },
  };
}

test("duplicate survey IDs are rejected without merging or rewriting source data", () => {
  const input = project();
  input.surveyPoints.push(point("survey-1", { x: 10, y: 10 }));
  const before = JSON.stringify(input);
  assert.throws(() => parseProjectDocument(input), /duplicate|unique|more than once/i);
  assert.throws(() => serializeProjectDocument(input), /duplicate|unique|more than once/i);
  assert.equal(JSON.stringify(input), before);
});

test("a duplicate add is atomic and cannot overwrite immutable observations", () => {
  const initial = createProjectEditorState(project());
  const next = reduceProjectEditorState(initial, { type: "add_survey_point", point: point("survey-1", { x: 10, y: 10 }) });
  assert.match(next.lastError ?? "", /duplicate|unique|already exists|more than once/i);
  assert.equal(next.project, initial.project);
  assert.equal(next.past, initial.past);
  assert.equal(next.future, initial.future);
  assert.equal(next.revision, initial.revision);
});

test("infrastructure references resolve uniquely to the exact canonical XY, not capture IDs", () => {
  const good = project();
  assert.doesNotThrow(() => parseProjectDocument(serializeProjectDocument(good)));
  for (const refs of [{ pivot_center: "missing" }, { pivot_center: "epoch-survey-1" }, { water_source: "survey-1" }]) {
    const bad = { ...good, infrastructureObservationRefs: refs };
    assert.throws(() => parseProjectDocument(bad), /reference|observation/i);
  }
  const mismatch = project();
  mismatch.pivotCenter.x += 0.001;
  assert.throws(() => parseProjectDocument(mismatch), /coordinate|projected|XY/i);
  const legacy = { ...good, infrastructureObservationRefs: undefined, fieldBoundaryCaptureEvidence: undefined };
  assert.doesNotThrow(() => parseProjectDocument(legacy));
});

test("manual edits clear displaced associations, preserve unchanged evidence, and undo exactly", () => {
  const initial = createProjectEditorState(project());
  const draft = createManualDesignDraft(initial.project, initial.revision);
  draft.pivot!.point.x += 1;
  draft.boundary!.vertices[0].x += 1;
  const next = reduceProjectEditorState(initial, { type: "apply_manual_design", draft });
  assert.equal(next.lastError, null);
  assert.equal(next.project.infrastructureObservationRefs?.pivot_center, undefined);
  assert.equal(next.project.fieldBoundaryCaptureEvidence?.[0], null);
  assert.deepEqual(next.project.fieldBoundaryCaptureEvidence?.slice(1), initial.project.fieldBoundaryCaptureEvidence?.slice(1));
  assert.deepEqual(reduceProjectEditorState(next, { type: "undo" }).project, initial.project);
  assert.deepEqual(reduceProjectEditorState(reduceProjectEditorState(next, { type: "undo" }), { type: "redo" }).project, next.project);
});

test("same-length boundary replacement and unpaired reordering cannot retain old evidence", () => {
  for (const change of ["replace", "reorder"]) {
    const initial = createProjectEditorState(project());
    const draft = createManualDesignDraft(initial.project, initial.revision);
    draft.boundary!.vertices = change === "replace"
      ? ring.map((p) => ({ x: p.x + 5, y: p.y + 5 })) : [...ring.slice(1), ring[0]];
    const next = reduceProjectEditorState(initial, { type: "apply_manual_design", draft });
    assert.equal(next.lastError, null);
    assert.ok(next.project.fieldBoundaryCaptureEvidence?.every((e) => e === null));
  }
});

test("paired ring reordering and evidence from a known feature remain traceable", () => {
  const original = project();
  const otherRing = ring.map((p) => ({ x: p.x + 5, y: p.y + 5 }));
  original.mapFeatures = [{ id: "survey-ring", name: "Known ring", kind: "planning_boundary", confidence: "rtk_fixed",
    geometry: { type: "Polygon", vertices: otherRing }, vertexCaptureEvidence: otherRing.map((_p, i) => evidence(`other-${i}`)) }];
  const initial = createProjectEditorState(original);
  const draft = createManualDesignDraft(initial.project, initial.revision);
  draft.boundary!.vertices = [...ring.slice(1), ring[0]];
  draft.boundary!.captureEvidence = [...initial.project.fieldBoundaryCaptureEvidence!.slice(1), initial.project.fieldBoundaryCaptureEvidence![0]];
  let next = reduceProjectEditorState(initial, { type: "apply_manual_design", draft });
  assert.equal(next.lastError, null);
  assert.deepEqual(next.project.fieldBoundaryCaptureEvidence, draft.boundary!.captureEvidence);
  draft.boundary = { vertices: otherRing, source: "rtk_evidence", captureEvidence: original.mapFeatures[0].vertexCaptureEvidence };
  next = reduceProjectEditorState(initial, { type: "apply_manual_design", draft });
  assert.equal(next.lastError, null);
  assert.deepEqual(next.project.fieldBoundaryCaptureEvidence, draft.boundary.captureEvidence);
});

test("draft evidence is detached from the project and unverifiable associations are not admitted", () => {
  const initial = createProjectEditorState(project());
  const draft = createManualDesignDraft(initial.project, initial.revision);
  draft.boundary!.captureEvidence![0]!.sentenceTypes.push("modified");
  assert.deepEqual(initial.project.fieldBoundaryCaptureEvidence![0]!.sentenceTypes, ["GGA", "GST"]);
  const next = reduceProjectEditorState(initial, { type: "apply_manual_design", draft });
  assert.equal(next.lastError, null);
  assert.equal(next.project.fieldBoundaryCaptureEvidence?.[0], null);
});

test("manual and imported observations do not become high-confidence RTK merely by reference", () => {
  for (const source of ["manual", "imported"] as const) {
    const input = project();
    input.surveyPoints[0] = { ...input.surveyPoints[0], source, confidence: "user_estimated", rtk: undefined, captureEvidence: undefined };
    const draft = createManualDesignDraft(input, 0);
    assert.notEqual(draft.pivot?.source, "rtk_evidence");
    assert.equal(draft.pivot?.sourceObservationId, "survey-1");
    assert.notEqual(evaluateManualDesignReadiness(draft).sourceConfidence.level, "high");
  }
});

test("feature upserts follow the same geometry evidence invalidation as updates", () => {
  const original = project();
  const feature: ProjectMapFeature = { id: "f1", name: "Observed point", kind: "pump_location", confidence: "rtk_fixed",
    geometry: { type: "Point", point: { x: 5, y: 5 } }, vertexCaptureEvidence: [evidence("feature")] };
  original.mapFeatures = [feature];
  const initial = createProjectEditorState(original);
  for (const actionType of ["upsert_map_features", "update_map_feature"] as const) {
    const changed = { ...feature, geometry: { type: "Point" as const, point: { x: 6, y: 5 } } };
    const action = actionType === "upsert_map_features" ? { type: actionType, features: [changed] } : { type: actionType, feature: changed };
    const next = reduceProjectEditorState(initial, action);
    assert.equal(next.lastError, null);
    assert.equal(next.project.mapFeatures?.[0].vertexCaptureEvidence, undefined);
    assert.deepEqual(reduceProjectEditorState(next, { type: "undo" }).project, initial.project);
  }
  const renamed = reduceProjectEditorState(initial, { type: "upsert_map_features", features: [{ ...feature, name: "Renamed" }] });
  assert.deepEqual(renamed.project.mapFeatures?.[0].vertexCaptureEvidence, feature.vertexCaptureEvidence);
});

test("closed boundary and obstacle drafts normalize vertices and evidence as pairs", () => {
  const initial = createProjectEditorState(project());
  const captures = ring.map((_p, i) => evidence(`closed-${i}`));
  for (const type of ["commit_boundary_draft", "commit_obstacle_draft"] as const) {
    const next = reduceProjectEditorState(initial, { type, vertices: [...ring, ring[0]], captureEvidence: [...captures, captures[0]] });
    assert.equal(next.lastError, null);
    const vertices = type === "commit_boundary_draft" ? next.project.fieldBoundary : next.project.obstacles[0].polygon;
    const provenance = type === "commit_boundary_draft" ? next.project.fieldBoundaryCaptureEvidence : next.project.obstacles[0].vertexCaptureEvidence;
    assert.deepEqual(vertices, ring);
    assert.deepEqual(provenance, captures);
    assert.deepEqual(reduceProjectEditorState(next, { type: "undo" }).project, initial.project);
  }
});

test("different non-null closing observations require an explicit choice and do not get discarded", () => {
  const initial = createProjectEditorState(project());
  const captures = ring.map((_p, i) => evidence(`closed-${i}`));
  const next = reduceProjectEditorState(initial, { type: "commit_boundary_draft", vertices: [...ring, ring[0]], captureEvidence: [...captures, evidence("other-close")] });
  assert.match(next.lastError ?? "", /closing.*evidence|closing.*observation/i);
  assert.equal(next.project, initial.project);
  assert.equal(next.revision, initial.revision);
});

test("editing a legacy closed ring keeps evidence aligned and undo preserves its original representation", () => {
  const original = project();
  original.fieldBoundary = [...ring, ring[0]];
  original.fieldBoundaryCaptureEvidence!.push(original.fieldBoundaryCaptureEvidence![0]);
  original.mapFeatures = [{ id: "polygon", name: "Polygon", kind: "planning_boundary", confidence: "rtk_fixed",
    geometry: { type: "Polygon", vertices: [...ring, ring[0]] }, vertexCaptureEvidence: [...original.fieldBoundaryCaptureEvidence!] }];
  const initial = createProjectEditorState(original);
  for (const action of [
    { type: "move_boundary_vertex" as const, vertexIndex: 1, point: { x: 99, y: 0 } },
    { type: "move_map_feature_vertex" as const, featureId: "polygon", vertexIndex: 1, point: { x: 99, y: 0 } },
  ]) {
    const next = reduceProjectEditorState(initial, action);
    assert.equal(next.lastError, null);
    const captures = action.type === "move_boundary_vertex" ? next.project.fieldBoundaryCaptureEvidence : next.project.mapFeatures![0].vertexCaptureEvidence;
    assert.equal(captures?.length, 4);
    assert.equal(captures?.[1], null);
    assert.deepEqual(reduceProjectEditorState(next, { type: "undo" }).project, initial.project);
  }
});

test("evidence normalization does not prevent repairing legacy invalid topology", () => {
  const original = project();
  original.fieldBoundary = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
  const initial = createProjectEditorState(original);
  assert.match(initial.lastError ?? "", /repair required/i);
  const next = reduceProjectEditorState(initial, { type: "move_boundary_vertex", vertexIndex: 1, point: { x: 50, y: -10 } });
  assert.equal(next.lastError, null);
  assert.equal(next.project.fieldBoundaryCaptureEvidence?.[1], null);
  assert.deepEqual(reduceProjectEditorState(next, { type: "undo" }).project, initial.project);
});

test("radius occupations cannot relocate a known observation or claim unverifiable RTK confidence", () => {
  for (const source of ["rtk_evidence", "imported_evidence", "projected_xy"] as const) {
    for (const valid of [true, false]) {
      const initial = createProjectEditorState(project());
      const draft = createManualDesignDraft(initial.project, initial.revision);
      draft.radiusEvidence = [{ role: "last_wheel", source, confidence: "rtk_fixed", occupations: [{
        point: valid ? { ...ring[0] } : { x: 60, y: 50 }, captureEvidence: initial.project.fieldBoundaryCaptureEvidence![0]!,
      }] }];
      const next = reduceProjectEditorState(initial, { type: "apply_manual_design", draft });
      assert.equal(next.lastError, null);
      const feature = next.project.mapFeatures![0];
      assert.equal(feature.confidence, valid ? "rtk_fixed" : "user_estimated");
      assert.equal(feature.properties?.inputSource, valid ? source : "projected_xy");
      assert.deepEqual(feature.vertexCaptureEvidence, valid ? [null, initial.project.fieldBoundaryCaptureEvidence![0]] : undefined);
    }
  }
});

test("abandoned or rejected drafts cannot mutate nested machine configuration or source records", () => {
  const input = project();
  input.machine.sweep = { mode: "partial_circle", startAngleDegrees: 0, stopAngleDegrees: 90, direction: "counterclockwise" };
  input.machine.catalogSelection = { catalogId: "synthetic", manufacturer: "Synthetic", model: "Fixture",
    sourceUrl: "https://example.org/original", sourceAccessedAt: "2026-09-13", advisoryOnly: true };
  const initial = createProjectEditorState(input);
  const before = JSON.stringify(initial);
  const draft = createManualDesignDraft(initial.project, initial.revision);
  draft.machine!.value.catalogSelection!.sourceUrl = "https://example.org/changed";
  if (draft.machine!.value.sweep.mode === "partial_circle") draft.machine!.value.sweep.startAngleDegrees = 45;
  draft.boundary!.vertices = [];
  assert.equal(JSON.stringify(initial), before);
  const next = reduceProjectEditorState(initial, { type: "apply_manual_design", draft });
  assert.ok(next.lastError);
  assert.equal(JSON.stringify(initial), before);
  assert.equal(next.project, initial.project);
  assert.equal(next.past, initial.past);
  assert.equal(next.future, initial.future);
});

test("equivalent object property ordering cannot discard capture evidence", () => {
  const initial = createProjectEditorState(project());
  const draft = createManualDesignDraft(initial.project, initial.revision);
  draft.boundary!.captureEvidence = draft.boundary!.captureEvidence!.map((value) => value ? Object.fromEntries(Object.entries(value).reverse()) as GnssCaptureEvidence : null);
  const next = reduceProjectEditorState(initial, { type: "apply_manual_design", draft });
  assert.equal(next.lastError, null);
  assert.deepEqual(next.project.fieldBoundaryCaptureEvidence, initial.project.fieldBoundaryCaptureEvidence);
  const feature: ProjectMapFeature = { id: "point-order", name: "Observed point", kind: "pump_location", confidence: "rtk_fixed",
    geometry: { type: "Point", point: { x: 5, y: 6 } }, vertexCaptureEvidence: [evidence("ordered")] };
  const withFeature = createProjectEditorState({ ...project(), mapFeatures: [feature] });
  const renamed = reduceProjectEditorState(withFeature, { type: "upsert_map_features", features: [{ ...feature,
    name: "Renamed", geometry: { point: { y: 6, x: 5 }, type: "Point" } }] });
  assert.equal(renamed.lastError, null);
  assert.deepEqual(renamed.project.mapFeatures![0].vertexCaptureEvidence, feature.vertexCaptureEvidence);
  const captures = initial.project.fieldBoundaryCaptureEvidence!;
  const closure = Object.fromEntries(Object.entries(captures[0]!).reverse()) as GnssCaptureEvidence;
  const closed = reduceProjectEditorState(initial, { type: "commit_boundary_draft", vertices: [...ring, ring[0]], captureEvidence: [...captures, closure] });
  assert.equal(closed.lastError, null);
  assert.deepEqual(closed.project.fieldBoundaryCaptureEvidence, captures);
});

function projectWithClosedEntities(): PivotProject {
  const input = project();
  input.fieldBoundary.push({ ...ring[0] });
  input.fieldBoundaryCaptureEvidence!.push(input.fieldBoundaryCaptureEvidence![0]);
  input.obstacles = [{ id: "o1", name: "Closed obstacle", kind: "exclusion", polygon: [...input.fieldBoundary],
    bufferMeters: 0, hardConflict: true, noSpray: true, confidence: "rtk_fixed", vertexCaptureEvidence: [...input.fieldBoundaryCaptureEvidence!] }];
  input.mapFeatures = [{ id: "p1", name: "Closed feature", kind: "planning_boundary", geometry: { type: "Polygon", vertices: [...input.fieldBoundary] },
    confidence: "rtk_fixed", vertexCaptureEvidence: [...input.fieldBoundaryCaptureEvidence!] }];
  return input;
}

test("deleting a closing index removes only the redundant closure and preserves evidence and undo", () => {
  const initial = createProjectEditorState(projectWithClosedEntities());
  for (const action of [
    { type: "delete_boundary_vertex" as const, vertexIndex: 4 },
    { type: "delete_obstacle_vertex" as const, obstacleId: "o1", vertexIndex: 4 },
    { type: "delete_map_feature_vertex" as const, featureId: "p1", vertexIndex: 4 },
  ]) {
    const next = reduceProjectEditorState(initial, action);
    assert.equal(next.lastError, null);
    const vertices = action.type === "delete_boundary_vertex" ? next.project.fieldBoundary
      : action.type === "delete_obstacle_vertex" ? next.project.obstacles[0].polygon
      : (next.project.mapFeatures![0].geometry as { vertices: XY[] }).vertices;
    const captures = action.type === "delete_boundary_vertex" ? next.project.fieldBoundaryCaptureEvidence
      : action.type === "delete_obstacle_vertex" ? next.project.obstacles[0].vertexCaptureEvidence : next.project.mapFeatures![0].vertexCaptureEvidence;
    assert.deepEqual(vertices, ring);
    assert.deepEqual(captures, initial.project.fieldBoundaryCaptureEvidence!.slice(0, -1));
    assert.deepEqual(reduceProjectEditorState(next, { type: "undo" }).project, initial.project);
  }
});

test("same-coordinate moves do not erase evidence or add undo entries", () => {
  const initial = createProjectEditorState(projectWithClosedEntities());
  for (const action of [
    { type: "move_boundary_vertex" as const, vertexIndex: 0, point: { ...ring[0] } },
    { type: "move_boundary_vertex" as const, vertexIndex: 4, point: { ...ring[0] } },
    { type: "move_obstacle_vertex" as const, obstacleId: "o1", vertexIndex: 4, point: { ...ring[0] } },
    { type: "move_map_feature_vertex" as const, featureId: "p1", vertexIndex: 4, point: { ...ring[0] } },
    { type: "place_pivot" as const, point: { ...initial.project.pivotCenter } },
  ]) {
    assert.equal(reduceProjectEditorState(initial, action), initial);
  }
});

test("removing a redundant closure cannot admit a still-invalid polygon", () => {
  const input = projectWithClosedEntities();
  input.mapFeatures![0].geometry = { type: "Polygon", vertices: [
    { x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 0 },
  ] };
  const initial = createProjectEditorState(input);
  const next = reduceProjectEditorState(initial, { type: "delete_map_feature_vertex", featureId: "p1", vertexIndex: 4 });
  assert.match(next.lastError ?? "", /self.intersect|area/i);
  assert.equal(next.project, initial.project);
  assert.equal(next.past, initial.past);
  assert.equal(next.future, initial.future);
  assert.equal(next.revision, initial.revision);
});

test("an outside-circle containment bound is not labeled exact signed path clearance", () => {
  const draft = createManualDesignDraft(project(), 0);
  draft.boundary!.vertices = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2.5 }, { x: 1.5, y: 2.5 }, { x: 1.5, y: 4 }, { x: 0, y: 4 }];
  draft.pivot!.point = { x: 1, y: 1 };
  draft.machine!.value.spanLengthsMeters = [3];
  draft.machine!.value.overhangMeters = 0;
  const result = evaluateManualDesignReadiness(draft).outsideFieldResult;
  assert.equal(result.status, "outside");
  assert.equal(result.exact, false);
  assert.equal(result.minimumClearanceMeters, -2);
});
