function digitized<T extends { capture: { source: string } }>(record: T): Extract<T, { classification: unknown }> {
  assert.ok("classification" in record, "Expected the unchanged digitized fixture branch.");
  return record as Extract<T, { classification: unknown }>;
}
import assert from "node:assert/strict";
import test from "node:test";
import { DRAWING_CLASSIFICATION_VERSION, type DrawingClassification } from "./drawingClassification";
import { PROJECT_DRAWING_METADATA_VERSION } from "./drawingMetadata";
import { createProjectEditorState, reduceProjectEditorState, type ProjectEditorAction, type ProjectEditorState } from "./projectReducer";
import { importProjectedGeoJsonToProject, importSurveyCsvToProject } from "./projectImports";
import { importGoogleEarthKmlToProject } from "./projectKml";
import { projectXyToLonLat } from "./coordinates";
import { parseProjectDocument, serializeProjectDocument } from "./projectDocument";
import { sampleProject } from "./sampleProject";
import type { PivotProject, XY } from "./types";

const observed = "2026-09-27T10:00:00Z";
function classification(purposeId: "field_boundary" | "valve", name: string): DrawingClassification {
  return { schemaVersion: DRAWING_CLASSIFICATION_VERSION, geometryType: purposeId === "valve" ? "Point" : "Polygon",
    purposeId, name, notes: "Original notes", assetStatus: "unknown", placement: "not_applicable", customLabel: null,
    effect: { mode: "informational" } };
}
function project(): PivotProject {
  const source = structuredClone(sampleProject);
  source.mapFeatures = [{ id: "valve", name: "Valve", notes: "Original notes", kind: "reference_point", confidence: "user_estimated",
    geometry: { type: "Point", point: { ...source.pivotCenter } } }];
  source.drawingMetadata = { schemaVersion: PROJECT_DRAWING_METADATA_VERSION, autosaveEnabled: false, records: [
    { target: { kind: "field_boundary" }, classification: classification("field_boundary", "Field"),
      capture: { captureId: "boundary-capture", source: "map_digitized", vertexRecordedAt: source.fieldBoundary.map(() => observed), wgs84: null, elevation: null } },
    { target: { kind: "map_feature", id: "valve" }, classification: classification("valve", "Valve"),
      capture: { captureId: "valve-capture", source: "map_digitized", vertexRecordedAt: [observed], wgs84: null, elevation: null } },
  ] };
  return source;
}
function geoJson(source: PivotProject, boundary: XY[]) {
  return { type: "FeatureCollection", properties: { projectCrs: source.projectCrs }, features: [
    { type: "Feature", properties: { layerType: "field_boundary" }, geometry: {
      type: "Polygon", coordinates: [[...boundary, boundary[0]].map(point => [point.x, point.y])],
    } },
  ] };
}
test("multipart and repeated explicit obstacle IDs remain unique without displacing existing identities", () => {
  const source = project(), ring = [...source.fieldBoundary, source.fieldBoundary[0]].map(point => [point.x, point.y]);
  const priorId = source.obstacles[0]?.id ?? "prior-obstacle";
  if (!source.obstacles.length) source.obstacles.push({ id: priorId, name: "Prior", kind: "exclusion", polygon: source.fieldBoundary, bufferMeters: 0, hardConflict: true, noSpray: true, confidence: "imported_cad" });
  const before = JSON.stringify(source);
  const input = { type: "FeatureCollection", properties: { projectCrs: source.projectCrs }, features: [
    { type: "Feature", properties: { layerType: "exclusion", id: "shared" }, geometry: { type: "MultiPolygon", coordinates: [[ring], [ring]] } },
    { type: "Feature", properties: { layerType: "exclusion", id: "shared-2" }, geometry: { type: "Polygon", coordinates: [ring] } },
    { type: "Feature", properties: { layerType: "exclusion", id: priorId }, geometry: { type: "Polygon", coordinates: [ring] } },
  ] };
  const result = importProjectedGeoJsonToProject(source, input).project;
  assert.equal(new Set(result.obstacles.map(item => item.id)).size, result.obstacles.length);
  assert.deepEqual(result.obstacles.slice(0, source.obstacles.length), source.obstacles);
  assert.deepEqual(result.obstacles.slice(source.obstacles.length, source.obstacles.length + 3).map(item => item.id), ["shared", "shared-3", "shared-2"]);
  assert.equal(JSON.stringify(source), before);
});
function edit(state: ProjectEditorState, action: ProjectEditorAction): ProjectEditorState {
  const next = reduceProjectEditorState(state, action);
  assert.equal(next.lastError, null);
  return next;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function exactUndo(before: ProjectEditorState, next: ProjectEditorState) {
  assert.equal(next.revision, before.revision + 1);
  assert.equal(next.past.length, before.past.length + 1);
  const undone = edit(next, { type: "undo" });
  assert.deepEqual(undone.project, before.project);
  assert.deepEqual(edit(undone, { type: "redo" }).project, next.project);
}

test("GeoJSON replaces a classified boundary with a different vertex count before validating retained metadata", () => {
  const source = project();
  source.fieldBoundaryCaptureEvidence = source.fieldBoundary.map(() => null);
  const boundary = source.fieldBoundary.slice(0, 3);
  const input = freeze(geoJson(source, boundary));
  const before = JSON.stringify(source);
  freeze(source);
  const result = importProjectedGeoJsonToProject(source, input);
  assert.deepEqual(result.project.fieldBoundary, boundary);
  assert.deepEqual(digitized(result.project.drawingMetadata!.records[0]).capture.vertexRecordedAt, [null, null, null]);
  assert.deepEqual(result.project.drawingMetadata!.records[1], source.drawingMetadata!.records[1]);
  assert.equal(result.project.fieldBoundaryCaptureEvidence, undefined);
  assert.equal(JSON.stringify(source), before);
  const state = createProjectEditorState(source);
  const next = edit(state, { type: "import_projected_geojson", geoJson: input });
  assert.deepEqual(next.project.fieldBoundary, boundary);
  assert.deepEqual(next.project.drawingMetadata, result.project.drawingMetadata);
  exactUndo(state, next);
});

test("same-count imported coordinate changes reset times while unchanged imports retain them", () => {
  const source = project();
  const changed = source.fieldBoundary.map(point => ({ x: point.x + 3, y: point.y + 2 }));
  const result = importProjectedGeoJsonToProject(source, geoJson(source, changed));
  assert.deepEqual(digitized(result.project.drawingMetadata!.records[0]).capture.vertexRecordedAt, changed.map(() => null));
  const same = importProjectedGeoJsonToProject(source, geoJson(source, source.fieldBoundary));
  assert.deepEqual(same.project.drawingMetadata, source.drawingMetadata);
});

test("renaming a classified feature synchronizes classification without changing geometry times or caller input", () => {
  for (const type of ["update_map_feature", "upsert_map_features"] as const) {
    for (const notes of ["New notes", undefined]) {
      const state = createProjectEditorState(project());
      freeze(state.project);
      const feature = { ...state.project.mapFeatures![0], name: " Renamed ", notes };
      if (notes === undefined) delete feature.notes;
      freeze(feature);
      const before = JSON.stringify(feature);
      const command: ProjectEditorAction = type === "update_map_feature" ? { type, feature } : { type, features: [feature] };
      const next = edit(state, command);
      const record = digitized(next.project.drawingMetadata!.records[1]);
      assert.equal(record.classification.name, " Renamed ");
      assert.equal(record.classification.notes, notes ?? "");
      assert.deepEqual(record.capture, digitized(state.project.drawingMetadata!.records[1]).capture);
      assert.equal(next.project.mapFeatures![0].notes, notes ?? "");
      assert.equal(JSON.stringify(feature), before);
      assert.equal(Object.hasOwn(feature, "notes"), notes !== undefined);
      exactUndo(state, next);
    }
  }
});

test("deleting a classified feature removes only its target metadata and undo restores both exactly", () => {
  const state = createProjectEditorState(project());
  const before = JSON.stringify(state.project);
  freeze(state.project);
  const next = edit(state, { type: "delete_map_feature", id: "valve" });
  assert.deepEqual(next.project.mapFeatures, []);
  assert.deepEqual(next.project.drawingMetadata!.records, [state.project.drawingMetadata!.records[0]]);
  assert.equal(next.project.drawingMetadata!.autosaveEnabled, false);
  assert.equal(JSON.stringify(state.project), before);
  exactUndo(state, next);
});

test("complete project imports retain supplied metadata rather than inheriting timestamps or labels", () => {
  const state = createProjectEditorState(project());
  const imported = structuredClone(state.project);
  imported.fieldBoundary = imported.fieldBoundary.slice(0, 3);
  digitized(imported.drawingMetadata!.records[0]).capture.vertexRecordedAt = imported.fieldBoundary.map(() => "2026-09-27T11:00:00Z");
  imported.mapFeatures![0].name = "Imported valve";
  digitized(imported.drawingMetadata!.records[1]).classification.name = "Imported valve";
  digitized(imported.drawingMetadata!.records[1]).capture.vertexRecordedAt = ["2026-09-27T12:00:00Z"];
  const before = JSON.stringify(imported);
  freeze(imported);
  const next = edit(state, { type: "apply_project_import", project: imported });
  assert.deepEqual(next.project.drawingMetadata, imported.drawingMetadata);
  assert.equal(JSON.stringify(imported), before);
  exactUndo(state, next);

  // Even an identical object reference does not grant permission to rewrite supplied import evidence.
  const inconsistent = { ...state.project, fieldBoundary: state.project.fieldBoundary.slice(0, 3) };
  const failed = reduceProjectEditorState(state, { type: "apply_project_import", project: inconsistent });
  assert.match(failed.lastError ?? "", /align/);
  assert.strictEqual(failed.project, state.project);
  assert.strictEqual(failed.past, state.past);
  assert.equal(failed.revision, state.revision);
});

test("CSV survey imports retain classified geometry metadata without modifying the source", () => {
  const source = freeze(project());
  const before = JSON.stringify(source);
  const csv = "id,label,role,x,y,source,confidence\nnew-point,Control,control,501010,4506010,imported,user_estimated\n";
  const direct = importSurveyCsvToProject(source, csv);
  assert.deepEqual(direct.project.drawingMetadata, source.drawingMetadata);
  assert.equal(JSON.stringify(source), before);
  const state = createProjectEditorState(source);
  const next = edit(state, { type: "import_survey_csv", csv });
  assert.deepEqual(next.project.drawingMetadata, source.drawingMetadata);
  exactUndo(state, next);
});

test("invalid classified edits fail without mutating shared state, command, or undo history", () => {
  const state = createProjectEditorState(project());
  const feature = freeze({ ...state.project.mapFeatures![0], name: " " });
  const before = JSON.stringify(state);
  const failed = reduceProjectEditorState(state, { type: "update_map_feature", feature });
  assert(failed.lastError);
  assert.strictEqual(failed.project, state.project);
  assert.strictEqual(failed.past, state.past);
  assert.equal(failed.revision, state.revision);
  assert.equal(JSON.stringify(state), before);
  assert.equal(feature.name, " ");
});

function boundaryKml(boundary: XY[], extra = ""): string {
  return `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${polygonKml(boundary)}${extra}</Document></kml>`;
}
function polygonKml(boundary: XY[], inner = "", name = "Boundary"): string {
  const coordinates = [...boundary, boundary[0]].map(point => {
    const p = projectXyToLonLat(point, sampleProject.projectCrs);
    return `${p.longitude},${p.latitude},0`;
  }).join(" ");
  return `<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coordinates}</coordinates></LinearRing></outerBoundaryIs>${inner}</Polygon></Placemark>`;
}
function capturedProject(): PivotProject {
  const source = project();
  source.fieldBoundaryCaptureEvidence = source.fieldBoundary.map((_point, index) => ({
    schemaVersion: "gnss-capture-v1", observationId: `old-${index}`, sessionId: "historical-session", transport: "replay",
    receivedAt: "2026-09-27T10:00:00Z", receivedMonotonicMs: index, sourceCoordinateFrame: "EPSG:4326",
    antennaReference: "unknown", sentenceTypes: ["GGA"], coherent: true,
  }));
  return source;
}

for (const vertexCount of [3, sampleProject.fieldBoundary.length]) test(`KML boundary replacement (${vertexCount} vertices) invalidates inherited captures before schema admission`, () => {
  const source = capturedProject();
  const changed = source.fieldBoundary.slice(0, vertexCount).map(point => ({ x: point.x + 3, y: point.y + 2 }));
  const input = boundaryKml(changed);
  const before = JSON.stringify(source);
  freeze(source);
  const result = importGoogleEarthKmlToProject(source, input);
  assert.equal(result.project.fieldBoundary.length, vertexCount);
  assert.equal(result.project.fieldBoundaryCaptureEvidence, undefined);
  assert.deepEqual(digitized(result.project.drawingMetadata!.records[0]).capture.vertexRecordedAt, changed.map(() => null));
  assert.deepEqual(result.project.drawingMetadata!.records[1], source.drawingMetadata!.records[1]);
  assert.equal(JSON.stringify(source), before);
  const state = createProjectEditorState(source);
  const next = edit(state, { type: "apply_project_import", project: result.project });
  exactUndo(state, next);
  const reopened = parseProjectDocument(serializeProjectDocument(next.project));
  assert.deepEqual(reopened.fieldBoundary, next.project.fieldBoundary);
  assert.deepEqual(reopened.drawingMetadata, next.project.drawingMetadata);
  assert.equal(reopened.fieldBoundaryCaptureEvidence, undefined);
  assert.equal(serializeProjectDocument(reopened), serializeProjectDocument(next.project));
});

test("unchanged KML, unselected boundaries and unrelated imports preserve exact provenance; cancel does not apply a candidate", () => {
  const text = boundaryKml(sampleProject.fieldBoundary);
  const source = capturedProject();
  // Pin exact projected values produced by this WGS84 input, avoiding a tolerance-based evidence association.
  source.fieldBoundary = importGoogleEarthKmlToProject(sampleProject, text).project.fieldBoundary;
  const before = JSON.stringify(source);
  freeze(source);
  for (const result of [
    importGoogleEarthKmlToProject(source, text),
    importGoogleEarthKmlToProject(source, boundaryKml(source.fieldBoundary.map(point => ({ x: point.x + 3, y: point.y }))), { selectedItemIds: [] }),
    importGoogleEarthKmlToProject(source, `<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>Control</name><Point><coordinates>-104,40,0</coordinates></Point></Placemark></kml>`),
    importProjectedGeoJsonToProject(source, geoJson(source, source.fieldBoundary)),
  ]) {
    assert.deepEqual(result.project.fieldBoundary, source.fieldBoundary);
    assert.deepEqual(result.project.fieldBoundaryCaptureEvidence, source.fieldBoundaryCaptureEvidence);
    assert.deepEqual(result.project.drawingMetadata, source.drawingMetadata);
    const state = createProjectEditorState(source);
    assert.deepEqual(edit(state, { type: "cancel_draft" }).project, state.project);
  }
  assert.equal(JSON.stringify(source), before);
});

const closedCoordinates = (ring: XY[]) => [...ring, ring[0]].map(point => [point.x, point.y]);
for (const shape of ["holes", "duplicate boundaries", "multipart boundary", "malformed boundary", "malformed obstacle", "obstacle holes", "extra dimensions", "missing geometry"] as const) {
  test(`projected GeoJSON refuses ${shape} atomically without dropping input geometry`, () => {
    const source = capturedProject();
    const base = geoJson(source, source.fieldBoundary);
    const outer = closedCoordinates(source.fieldBoundary);
    const feature = base.features[0];
    const geometry = shape === "missing geometry" ? null : shape === "extra dimensions"
      ? { type: "Polygon", coordinates: [outer.map(point => [...point, 12])] }
      : shape === "multipart boundary"
      ? { type: "MultiPolygon", coordinates: [[outer], [outer]] }
      : shape === "malformed boundary" || shape === "malformed obstacle"
        ? { type: "Polygon", coordinates: [[["not-a-number", 0], [10, 0], [0, 10], ["not-a-number", 0]]] }
        : { type: "Polygon", coordinates: [outer, ...(shape.includes("holes") ? [outer] : [])] };
    const input = freeze({ ...base, features: shape === "duplicate boundaries" ? [feature, feature]
      : shape.startsWith("obstacle") || shape === "malformed obstacle"
        ? [feature, { ...feature, properties: { layerType: "exclusion" }, geometry }]
        : [{ ...feature, geometry }] });
    const sourceBytes = JSON.stringify(source), inputBytes = JSON.stringify(input);
    freeze(source);
    assert.throws(() => importProjectedGeoJsonToProject(source, input), /single|ring|boundary|polygon|coordinate/i);
    const state = createProjectEditorState(source);
    const failed = reduceProjectEditorState(state, { type: "import_projected_geojson", geoJson: input });
    assert.ok(failed.lastError);
    assert.strictEqual(failed.project, state.project);
    assert.strictEqual(failed.past, state.past);
    assert.strictEqual(failed.future, state.future);
    assert.equal(failed.revision, state.revision);
    assert.equal(JSON.stringify(source), sourceBytes);
    assert.equal(JSON.stringify(input), inputBytes);
  });
}

for (const shape of ["boundary holes", "obstacle holes", "feature holes", "duplicate boundaries", "multipart boundary", "polygon and line boundaries", "malformed obstacle", "multipart malformed boundary"] as const) {
  test(`KML refuses ${shape} without changing source or selection`, () => {
    const source = capturedProject();
    const coordinates = polygonKml(source.fieldBoundary).match(/<coordinates>(.*?)<\/coordinates>/)![1];
    const hole = `<innerBoundaryIs><LinearRing><coordinates>${coordinates}</coordinates></LinearRing></innerBoundaryIs>`;
    const second = polygonKml(source.fieldBoundary, "", "Second Boundary");
    const first = polygonKml(source.fieldBoundary);
    const malformedPolygon = `<Polygon><outerBoundaryIs><LinearRing><coordinates>-181,40,0 -182,40,0 -182,41,0 -181,40,0</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    const input = shape === "malformed obstacle"
      ? boundaryKml(source.fieldBoundary, `<Placemark><name>Building</name>${malformedPolygon}</Placemark>`)
      : shape === "multipart malformed boundary"
        ? `<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>Boundary</name><MultiGeometry>${first.match(/<Polygon>.*<\/Polygon>/)![0]}${malformedPolygon}</MultiGeometry></Placemark></kml>`
        : shape.endsWith("holes")
      ? shape === "boundary holes" ? boundaryKml(source.fieldBoundary).replace("</Polygon>", `${hole}</Polygon>`)
        : boundaryKml(source.fieldBoundary, polygonKml(source.fieldBoundary, hole, shape === "feature holes" ? "Machine Zone" : "Building"))
      : shape === "multipart boundary" ? `<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>Boundary</name><MultiGeometry>${first.match(/<Polygon>.*<\/Polygon>/)![0]}${second.match(/<Polygon>.*<\/Polygon>/)![0]}</MultiGeometry></Placemark></kml>`
        : boundaryKml(source.fieldBoundary, shape === "polygon and line boundaries"
          ? `<Placemark><name>Second Boundary</name><LineString><coordinates>${coordinates}</coordinates></LineString></Placemark>` : second);
    const sourceBytes = JSON.stringify(source);
    freeze(source);
    assert.throws(() => importGoogleEarthKmlToProject(source, input), /single|inner|hole|boundary|boundaries|polygon|coordinate/i);
    assert.equal(JSON.stringify(source), sourceBytes);
  });
}

test("KML explicit item selection preserves excluded polygons and discloses their unsupported holes", () => {
  const source = capturedProject();
  const coordinates = polygonKml(source.fieldBoundary).match(/<coordinates>(.*?)<\/coordinates>/)![1];
  const hole = `<innerBoundaryIs><LinearRing><coordinates>${coordinates}</coordinates></LinearRing></innerBoundaryIs>`;
  const input = boundaryKml(source.fieldBoundary, polygonKml(source.fieldBoundary, "", "Second Boundary")
    + polygonKml(source.fieldBoundary, hole, "Building"));
  const bytes = JSON.stringify(source);
  const result = importGoogleEarthKmlToProject(freeze(source), input, { selectedItemIds: ["boundary"] });
  assert.equal(result.importedBoundary, true);
  assert.equal(result.importedObstacleCount, 0);
  assert.equal(result.items.find(item => item.name === "Second Boundary")?.selected, false);
  const building = result.items.find(item => item.name === "Building");
  assert.equal(building?.selected, false);
  assert.match(building?.warning ?? "", /holes.*cannot be retained/);
  assert.equal(JSON.stringify(source), bytes);
});

test("KML closed boundary lines are classified before first-polygon inference", () => {
  const source = project();
  const coordinates = polygonKml(source.fieldBoundary).match(/<coordinates>(.*?)<\/coordinates>/)![1];
  const input = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Boundary</name><LineString><coordinates>${coordinates}</coordinates></LineString></Placemark>${polygonKml(source.fieldBoundary, "", "Building")}</Document></kml>`;
  const result = importGoogleEarthKmlToProject(source, input);
  assert.equal(result.importedBoundary, true);
  assert.equal(result.importedObstacleCount, 1);
  assert.equal(result.items.find(item => item.name === "Building")?.classification, "obstacle");
  assert.equal(result.items.find(item => item.name === "Boundary")?.classification, "field_boundary");
  assert.doesNotMatch(result.warnings.join("\n"), /No explicit field_boundary/);
});

test("single-component GeoJSON MultiPolygon boundary and multi-component obstacles retain every supported ring", () => {
  const source = project();
  const outer = closedCoordinates(source.fieldBoundary);
  const obstacle = outer.map(([x, y]) => [x + 2, y + 3]);
  const input = { type: "FeatureCollection", properties: { projectCrs: source.projectCrs }, features: [
    { type: "Feature", properties: { layerType: "field_boundary" }, geometry: { type: "MultiPolygon", coordinates: [[outer]] } },
    { type: "Feature", properties: { layerType: "exclusion" }, geometry: { type: "MultiPolygon", coordinates: [[outer], [obstacle]] } },
  ] };
  const result = importProjectedGeoJsonToProject(freeze(source), freeze(input));
  assert.equal(result.importedBoundary, true);
  assert.equal(result.importedObstacleCount, 2);
  assert.deepEqual(result.project.fieldBoundary, source.fieldBoundary);
  assert.deepEqual(result.project.obstacles.at(-2)?.polygon, source.fieldBoundary);
  assert.deepEqual(result.project.obstacles.at(-1)?.polygon, source.fieldBoundary.map(point => ({ x: point.x + 2, y: point.y + 3 })));
});

for (const kind of ["short outer ring", "short inner ring", "missing outer boundary"] as const) test(`raw KML refuses ${kind} before conversion can discard it`, () => {
  const source = capturedProject();
  const valid = polygonKml(source.fieldBoundary).match(/<coordinates>(.*?)<\/coordinates>/)![1];
  const short = "-104,40,0 -104.001,40,0";
  const ring = (coordinates: string) => `<LinearRing><coordinates>${coordinates}</coordinates></LinearRing>`;
  const invalid = `<Polygon>${kind === "missing outer boundary" ? "" : `<outerBoundaryIs>${ring(kind === "short outer ring" ? short : valid)}</outerBoundaryIs>`}${kind === "short outer ring" ? "" : `<innerBoundaryIs>${ring(kind === "short inner ring" ? short : valid)}</innerBoundaryIs>`}</Polygon>`;
  const input = boundaryKml(source.fieldBoundary, `<Placemark><name>Building</name>${invalid}</Placemark>`);
  const before = JSON.stringify(source);
  assert.throws(() => importGoogleEarthKmlToProject(freeze(source), input), /ring|polygon|boundary/i);
  assert.equal(JSON.stringify(source), before);
});

for (const kind of ["same names", "shared explicit ID multipart"] as const) test(`KML discovery disambiguates ${kind} and applies exactly one selected boundary`, () => {
  const source = createProjectEditorState(capturedProject()).project;
  const first = polygonKml(source.fieldBoundary);
  const shifted = source.fieldBoundary.map(point => ({ x: point.x + 3, y: point.y + 2 }));
  const second = polygonKml(shifted);
  const input = kind === "same names"
    ? `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${first}${second}</Document></kml>`
    : `<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>Boundary</name><ExtendedData><Data name="id"><value>source-boundary</value></Data></ExtendedData><MultiGeometry>${first.match(/<Polygon>.*<\/Polygon>/)![0]}${second.match(/<Polygon>.*<\/Polygon>/)![0]}</MultiGeometry></Placemark></kml>`;
  const bytes = JSON.stringify(source);
  freeze(source);
  const discovery = importGoogleEarthKmlToProject(source, input, { selectedItemIds: [] });
  assert.equal(discovery.items.length, 2);
  assert.equal(new Set(discovery.items.map(item => item.id)).size, 2);
  assert.ok(discovery.items.every(item => !item.selected));
  assert.deepEqual(discovery.project, source);
  for (const selected of discovery.items) {
    const result = importGoogleEarthKmlToProject(source, input, { selectedItemIds: [selected.id] });
    assert.deepEqual(result.items.map(item => item.id), discovery.items.map(item => item.id));
    assert.deepEqual(result.items.filter(item => item.selected).map(item => item.id), [selected.id]);
    assert.equal(result.importedBoundary, true);
    assert.equal(result.project.fieldBoundaryCaptureEvidence, undefined);
  }
  assert.throws(() => importGoogleEarthKmlToProject(source, input, { selectedItemIds: discovery.items.map(item => item.id) }), /single polygon ring/);
  assert.equal(JSON.stringify(source), bytes);
});

test("KML duplicate item suffixes do not take an unambiguous source item ID", () => {
  const source = project();
  const input = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${polygonKml(source.fieldBoundary)}${polygonKml(source.fieldBoundary)}${polygonKml(source.fieldBoundary, "", "Boundary-2")}</Document></kml>`;
  const result = importGoogleEarthKmlToProject(source, input, { selectedItemIds: [] });
  assert.deepEqual(result.items.map(item => item.id), ["boundary", "boundary-3", "boundary-2"]);
});

test("KML shared-ID pump components acquire unique durable identities and edits affect only one sibling", () => {
  const source = createProjectEditorState(project()).project;
  const input = `<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>Pump</name><ExtendedData><Data name="id"><value>shared-pump</value></Data><Data name="mapFeatureKind"><value>pump_location</value></Data></ExtendedData><MultiGeometry><Point><coordinates>-104,40,0</coordinates></Point><Point><coordinates>-104.001,40.001,0</coordinates></Point></MultiGeometry></Placemark></kml>`;
  const before = JSON.stringify(source);
  freeze(source);
  const discovery = importGoogleEarthKmlToProject(source, input, { selectedItemIds: [] });
  assert.deepEqual(discovery.items.map(item => item.id), ["shared-pump", "shared-pump-2"]);
  assert.deepEqual(discovery.project, source);
  const imported = importGoogleEarthKmlToProject(source, input);
  const added = imported.project.mapFeatures!.slice(source.mapFeatures!.length);
  assert.equal(imported.importedMapFeatureCount, 2);
  assert.deepEqual(added.map(feature => feature.id), ["shared-pump", "shared-pump-2"]);
  assert.deepEqual(added.map(feature => feature.properties?.id), ["shared-pump", "shared-pump"]);
  assert.equal(new Set(imported.project.mapFeatures!.map(feature => feature.id)).size, imported.project.mapFeatures!.length);
  assert.deepEqual(importGoogleEarthKmlToProject(source, input).project.mapFeatures, imported.project.mapFeatures);
  for (const [index, item] of discovery.items.entries()) {
    const selected = importGoogleEarthKmlToProject(source, input, { selectedItemIds: [item.id] });
    assert.deepEqual(selected.items.map(candidate => candidate.id), discovery.items.map(candidate => candidate.id));
    assert.deepEqual(selected.items.filter(candidate => candidate.selected).map(candidate => candidate.id), [item.id]);
    assert.equal(selected.importedMapFeatureCount, 1);
    assert.deepEqual(selected.project.mapFeatures!.at(-1)!.geometry, added[index].geometry);
  }
  const state = createProjectEditorState(imported.project);
  const renamed = edit(state, { type: "update_map_feature", feature: { ...added[0], name: "Edited first pump" } });
  assert.equal(renamed.project.mapFeatures!.filter(feature => feature.name === "Edited first pump").length, 1);
  assert.deepEqual(renamed.project.mapFeatures!.find(feature => feature.id === added[1].id), added[1]);
  exactUndo(state, renamed);
  assert.equal(JSON.stringify(parseProjectDocument(serializeProjectDocument(renamed.project)).mapFeatures), JSON.stringify(renamed.project.mapFeatures));
  assert.equal(JSON.stringify(source), before);
});

test("KML mixed point, line and polygon IDs reserve against existing and all selected imported features", () => {
  const inputProject = project();
  for (const id of ["shared-feature", "shared-feature-2"]) inputProject.mapFeatures!.push({
    id, name: `Existing ${id}`, kind: "pump_location", confidence: "user_estimated",
    geometry: { type: "Point", point: { ...inputProject.pivotCenter } },
  });
  const source = createProjectEditorState(inputProject).project;
  const polygon = polygonKml(source.fieldBoundary).match(/<Polygon>.*<\/Polygon>/)![0];
  const placemark = (kind: string, geometry: string) => `<Placemark><name>${kind}</name><ExtendedData><Data name="id"><value>shared-feature</value></Data><Data name="cplayoutFeatureType"><value>map_feature</value></Data><Data name="mapFeatureKind"><value>${kind}</value></Data></ExtendedData>${geometry}</Placemark>`;
  const input = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${placemark("pump_location", "<Point><coordinates>-104,40,0</coordinates></Point>")}${placemark("underground_pipeline", "<LineString><coordinates>-104,40,0 -104.001,40.001,0</coordinates></LineString>")}${placemark("planning_boundary", polygon)}</Document></kml>`;
  const before = JSON.stringify(source);
  freeze(source);
  const discovery = importGoogleEarthKmlToProject(source, input, { selectedItemIds: [] });
  assert.equal(discovery.items.length, 3);
  assert.equal(new Set(discovery.items.map(item => item.id)).size, 3);
  assert.deepEqual(discovery.project, source);
  const imported = importGoogleEarthKmlToProject(source, input, { selectedItemIds: discovery.items.map(item => item.id) });
  assert.equal(imported.importedMapFeatureCount, 3);
  assert.deepEqual(imported.project.mapFeatures!.slice(0, source.mapFeatures!.length), source.mapFeatures);
  assert.equal(new Set(imported.project.mapFeatures!.map(feature => feature.id)).size, imported.project.mapFeatures!.length);
  assert.deepEqual(imported.items.map(item => item.id), discovery.items.map(item => item.id));
  const added = imported.project.mapFeatures!.slice(source.mapFeatures!.length);
  assert.deepEqual(added.map(feature => feature.id), ["shared-feature-3", "shared-feature-4", "shared-feature-5"]);
  assert.deepEqual(added.map(feature => feature.geometry.type), ["Polygon", "Point", "LineString"]);
  for (const [index, item] of discovery.items.entries()) {
    const selected = importGoogleEarthKmlToProject(source, input, { selectedItemIds: [item.id] });
    assert.equal(selected.importedMapFeatureCount, 1);
    assert.deepEqual(selected.items.map(candidate => candidate.id), discovery.items.map(candidate => candidate.id));
    assert.deepEqual(selected.project.mapFeatures!.slice(0, source.mapFeatures!.length), source.mapFeatures);
    assert.deepEqual(selected.project.mapFeatures!.at(-1)!.geometry, added[index].geometry);
    assert.equal(new Set(selected.project.mapFeatures!.map(feature => feature.id)).size, selected.project.mapFeatures!.length);
  }
  assert.equal(JSON.stringify(source), before);
});

const namespaceOuter = "-104,40,0 -103.999,40,0 -104,40.001,0 -104,40,0";
const namespaceHole = "-103.9999,40.0001,0 -103.9998,40.0001,0 -103.9999,40.0002,0 -103.9999,40.0001,0";
const namespaceRing = (coordinates: string) => `<LinearRing><coordinates>${coordinates}</coordinates></LinearRing>`;
const namespacePolygon = `<Polygon><outerBoundaryIs>${namespaceRing(namespaceOuter)}</outerBoundaryIs></Polygon>`;
for (const variant of ["mixed prefixed hole", "subtree prefix alias", "prefixed outer boundary", "prefixed ring", "prefixed coordinates", "prefixed geometry sibling", "prefixed point", "fully prefixed KML", "prefixed metadata"] as const) {
  test(`KML refuses converter-unsupported ${variant} before admission while retaining caller state`, () => {
    const hole = `<k:innerBoundaryIs><k:LinearRing><k:coordinates>${namespaceHole}</k:coordinates></k:LinearRing></k:innerBoundaryIs>`;
    const prefixElement = (input: string, name: string) => input.replaceAll(`<${name}>`, `<k:${name}>`).replaceAll(`</${name}>`, `</k:${name}>`);
    const boundary = (polygon: string) => `<Placemark><name>Boundary</name>${polygon}</Placemark>`;
    const document = variant === "mixed prefixed hole" ? boundary(namespacePolygon.replace("</Polygon>", `${hole}</Polygon>`))
      : variant === "subtree prefix alias" ? boundary(namespacePolygon.replace("</Polygon>", `${hole.replaceAll("k:", "other:").replace("<other:innerBoundaryIs>", '<other:innerBoundaryIs xmlns:other="http://www.opengis.net/kml/2.2">')}</Polygon>`))
        : variant === "prefixed outer boundary" ? boundary(prefixElement(namespacePolygon, "outerBoundaryIs"))
          : variant === "prefixed ring" ? boundary(prefixElement(namespacePolygon, "LinearRing"))
            : variant === "prefixed coordinates" ? boundary(prefixElement(namespacePolygon, "coordinates"))
              : variant === "prefixed geometry sibling" ? boundary(namespacePolygon) + `<k:Placemark><k:name>Pump location</k:name><k:Point><k:coordinates>-104,40,0</k:coordinates></k:Point></k:Placemark>`
                : variant === "prefixed point" ? boundary(namespacePolygon) + `<Placemark><name>Pump location</name><k:Point><coordinates>-104,40,0</coordinates></k:Point></Placemark>`
                  : variant === "prefixed metadata" ? `<Placemark><name>Boundary</name><k:ExtendedData><k:Data name="id"><k:value>source</k:value></k:Data></k:ExtendedData>${namespacePolygon}</Placemark>`
                    : boundary(namespacePolygon);
    let input = `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:k="http://www.opengis.net/kml/2.2"><Document>${document}</Document></kml>`;
    if (variant === "fully prefixed KML") input = input.replace(/<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s>])/g, "<$1k:$2");
    const initial = createProjectEditorState(capturedProject()), before = JSON.stringify(initial);
    const bytes = serializeProjectDocument(initial.project);
    freeze(initial);
    let callerState = initial;
    assert.throws(() => {
      const result = importGoogleEarthKmlToProject(callerState.project, input);
      callerState = reduceProjectEditorState(callerState, { type: "apply_project_import", project: result.project });
    }, /namespace-prefixed KML elements.*preserve the complete original input/i);
    assert.strictEqual(callerState, initial);
    assert.equal(JSON.stringify(initial), before);
    assert.equal(serializeProjectDocument(callerState.project), bytes);
  });
}

test("KML namespace refusal leaves default declarations, foreign extensions and supported gx tracks intact", () => {
  const source = createProjectEditorState(capturedProject()).project;
  const plain = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Boundary</name>${namespacePolygon}</Placemark></Document></kml>`;
  const expected = importGoogleEarthKmlToProject(source, plain);
  const extended = plain.replace('<kml xmlns="http://www.opengis.net/kml/2.2">', '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:k="http://www.opengis.net/kml/2.2" xmlns:foreign="https://example.org/synthetic-extension">')
    .replace("</Document>", `<foreign:review><foreign:Polygon><foreign:innerBoundaryIs><foreign:LinearRing><foreign:coordinates>${namespaceHole}</foreign:coordinates></foreign:LinearRing></foreign:innerBoundaryIs></foreign:Polygon></foreign:review></Document>`);
  const before = JSON.stringify(source);
  freeze(source);
  assert.deepEqual(importGoogleEarthKmlToProject(source, extended), expected);
  const track = plain.replace('<kml xmlns="http://www.opengis.net/kml/2.2">', '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">')
    .replace("</Document>", '<Placemark><name>Linear Move Path</name><gx:Track><when>2026-10-18T10:00:00Z</when><when>2026-10-18T10:00:01Z</when><when>2026-10-18T10:00:02Z</when><gx:coord>-104 40 0</gx:coord><gx:coord>-104.001 40.001 0</gx:coord><gx:coord>-104.002 40.001 0</gx:coord></gx:Track></Placemark></Document>');
  const result = importGoogleEarthKmlToProject(source, track);
  assert.equal(result.importedBoundary, true);
  assert.equal(result.importedMapFeatureCount, 1);
  assert.equal(result.project.mapFeatures!.at(-1)!.kind, "linear_move_path");
  assert.equal(result.project.mapFeatures!.at(-1)!.geometry.type, "LineString");
  assert.equal(JSON.stringify(source), before);
});

function gxStructureKml(kind: "Track" | "MultiTrack", prefix: string, coordinatePrefix = "gx"): string {
  const qualifier = prefix ? `${prefix}:` : "";
  const observations = ["-104 40 0", "-104.001 40.001 0", "-104.002 40.001 0"]
    .map((coordinate, index) => `<when>2026-10-18T10:00:0${index}Z</when><${coordinatePrefix}:coord>${coordinate}</${coordinatePrefix}:coord>`).join("");
  const track = kind === "Track" ? `<${qualifier}Track>${observations}</${qualifier}Track>` : `<gx:Track>${observations}</gx:Track>`;
  const geometry = kind === "Track" ? track : `<${qualifier}MultiTrack>${track}</${qualifier}MultiTrack>`;
  return `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2" xmlns:t="http://www.google.com/kml/ext/2.2"><Document><Placemark><name>Boundary</name>${namespacePolygon}</Placemark><Placemark><name>Linear Move Path</name>${geometry}</Placemark></Document></kml>`;
}

for (const kind of ["Track", "MultiTrack"] as const) test(`KML refuses unsupported GX ${kind} aliases before a mixed import can omit them`, () => {
  const initial = createProjectEditorState(capturedProject()), before = JSON.stringify(initial);
  const input = gxStructureKml(kind, "t");
  freeze(initial);
  let callerState = initial;
  assert.throws(() => {
    const result = importGoogleEarthKmlToProject(callerState.project, input);
    callerState = reduceProjectEditorState(callerState, { type: "apply_project_import", project: result.project });
  }, /cannot retain namespace aliases for GX Track\/MultiTrack.*preserve the complete original input/i);
  assert.strictEqual(callerState, initial);
  assert.equal(JSON.stringify(initial), before);
});

test("KML retains supported GX structures and coordinate aliases without rejecting foreign Track extensions", () => {
  const source = createProjectEditorState(capturedProject()).project, before = JSON.stringify(source);
  freeze(source);
  for (const kind of ["Track", "MultiTrack"] as const) for (const prefix of ["gx", ""]) for (const coordinatePrefix of ["gx", "t"]) {
    const result = importGoogleEarthKmlToProject(source, gxStructureKml(kind, prefix, coordinatePrefix));
    assert.equal(result.importedBoundary, true);
    assert.equal(result.importedMapFeatureCount, 1, `${prefix || "unprefixed"} ${kind} with ${coordinatePrefix}:coord`);
    assert.equal(result.project.mapFeatures!.at(-1)!.geometry.type, "LineString");
  }
  const foreign = gxStructureKml("Track", "t").replace('xmlns:t="http://www.google.com/kml/ext/2.2"', 'xmlns:t="https://example.org/synthetic-extension"');
  const result = importGoogleEarthKmlToProject(source, foreign);
  assert.equal(result.importedBoundary, true);
  assert.equal(result.importedMapFeatureCount, 0);
  assert.equal(JSON.stringify(source), before);
});

function namespaceCollisionFixtures(): Array<[string, string]> {
  const kml = "http://www.opengis.net/kml/2.2", gx = "http://www.google.com/kml/ext/2.2";
  const doc = (body: string, declarations = "") => `<kml xmlns="${kml}" ${declarations}><Document>${body}</Document></kml>`;
  const placemark = (geometry: string) => `<Placemark><name>Pump location</name>${geometry}</Placemark>`;
  const point = "<Point><coordinates>-105,40,0</coordinates></Point>";
  const baseline = doc(placemark(point));
  const track = gxStructureKml("Track", "gx");
  const coords = ["-105 40 0", "-105.001 40.001 0", "-105.002 40.001 0"].map(value => `<gx:coord>${value}</gx:coord>`).join("");
  const style = "<LineStyle><color>ff0000ff</color></LineStyle>";
  const overlay = `<GroundOverlay><name>Building</name><gx:LatLonQuad><coordinates>${namespaceOuter}</coordinates></gx:LatLonQuad></GroundOverlay>`;
  return [
    ["foreign first coordinates", doc(placemark(`<Point><coordinates xmlns="urn:foreign">-106,41</coordinates><coordinates>-105,40</coordinates></Point>`))],
    ["foreign literal Point", doc(placemark(`<Point xmlns="urn:foreign"><coordinates xmlns="${kml}">-106,41</coordinates></Point>`))],
    ["foreign literal Placemark", doc(`<Placemark xmlns="urn:foreign"><name xmlns="${kml}">Pump location</name><Point xmlns="${kml}"><coordinates>-106,41</coordinates></Point></Placemark>`)],
    ["foreign descendant name", doc(`<Placemark><f:review xmlns:f="urn:foreign"><name xmlns="urn:foreign">Control</name></f:review><name>Pump location</name>${point}</Placemark>`)],
    ["qualified coordinates inside foreign wrapper", doc(placemark('<Point><f:review xmlns:f="urn:foreign"><coordinates>-106,41</coordinates></f:review><coordinates>-105,40</coordinates></Point>'))],
    ["qualified coord inside foreign wrapper", track.replace("<gx:Track>", '<gx:Track><f:review xmlns:f="urn:foreign"><gx:coord>-106 41 0</gx:coord></f:review>')],
    ["qualified Placemark inside foreign wrapper", doc(`<f:review xmlns:f="urn:foreign">${placemark(point)}</f:review>`)],
    ["qualified name inside foreign wrapper", doc(`<Placemark><f:review xmlns:f="urn:foreign"><name>Control</name></f:review><name>Pump location</name>${point}</Placemark>`)],
    ["foreign Data metadata", doc(`<Placemark><name>Pump location</name><ExtendedData><Data xmlns="urn:foreign" name="id"><value>foreign-id</value></Data></ExtendedData>${point}</Placemark>`)],
    ["qualified global Style inside foreign wrapper", doc(`<f:review xmlns:f="urn:foreign"><Style id="chosen">${style}</Style></f:review><Placemark><name>Pump location</name><styleUrl>#chosen</styleUrl>${point}</Placemark>`)],
    ["foreign global Style", doc(`<Style xmlns="urn:foreign" id="chosen"><LineStyle xmlns="${kml}"><color>ff0000ff</color></LineStyle></Style><Placemark><name>Pump location</name><styleUrl>#chosen</styleUrl>${point}</Placemark>`)],
    ["foreign global schema field", doc(`<Schema><SimpleField xmlns="urn:foreign" name="rank" type="int"/></Schema><Placemark><name>Pump location</name><ExtendedData><SchemaData><SimpleData name="rank">7</SimpleData></SchemaData></ExtendedData>${point}</Placemark>`)],
    ["foreign default root", baseline.replace(`xmlns="${kml}"`, 'xmlns="urn:foreign"')],
    ["non-KML root name", baseline.replace("<kml ", "<other ").replace("</kml>", "</other>")],
    ["unqualified namespace reset", doc(placemark('<Point><coordinates xmlns="">-106,41</coordinates><coordinates>-105,40</coordinates></Point>'))],
    ["wrong URI gx Track", track.replace(`xmlns:gx="${gx}"`, 'xmlns:gx="urn:foreign"')],
    ["wrong URI gx MultiTrack", gxStructureKml("MultiTrack", "gx").replace("<gx:MultiTrack>", '<gx:MultiTrack xmlns:gx="urn:foreign">').replace("<gx:Track>", `<gx:Track xmlns:gx="${gx}">`)],
    ["foreign wildcard coord", track.replace("<gx:Track>", '<gx:Track xmlns:f="urn:foreign"><f:coord>-106 41 0</f:coord>')],
    ["foreign bare coord precedence", track.replace("<gx:Track>", '<gx:Track><coord xmlns="urn:foreign">-106 41 0</coord>')],
    ["mixed valid GX coordinate forms", doc(`<Placemark><name>Control</name><gx:Track xmlns="${gx}"><coord>-106 41 0</coord>${coords}</gx:Track></Placemark>`, `xmlns:gx="${gx}"`)],
    ["mixed legacy and prefixed coordinates", doc(`<Placemark><name>Control</name><gx:Track><coord>-106 41 0</coord>${coords}</gx:Track></Placemark>`, `xmlns:gx="${gx}"`)],
    ["operative foreign CascadingStyle", doc(`<f:CascadingStyle xmlns:f="urn:foreign" id="chosen"><Style>${style}</Style></f:CascadingStyle><Placemark><name>Pump location</name><styleUrl>#chosen</styleUrl>${point}</Placemark>`)],
    ["operative wrong URI kml id", doc(`<gx:CascadingStyle xmlns:kml="urn:foreign" kml:id="chosen"><Style>${style}</Style></gx:CascadingStyle><Placemark><name>Pump location</name><styleUrl>#chosen</styleUrl>${point}</Placemark>`, `xmlns:gx="${gx}"`)],
    ["wrong URI gx LatLonQuad", doc(`<Placemark><name>Boundary</name>${namespacePolygon}</Placemark>${overlay}`, 'xmlns:gx="urn:foreign"')],
    ["unsupported GX LatLonQuad alias", doc(`<Placemark><name>Boundary</name>${namespacePolygon}</Placemark>${overlay.replaceAll("gx:LatLonQuad", "t:LatLonQuad")}`, `xmlns:t="${gx}"`)],
    ["wrong URI gx altitudeMode", doc(`<Placemark><name>Boundary</name>${namespacePolygon}</Placemark><NetworkLink><name>Building</name><Region><LatLonAltBox><north>40.001</north><south>40</south><east>-104</east><west>-104.001</west><gx:altitudeMode>absolute</gx:altitudeMode></LatLonAltBox></Region></NetworkLink>`, 'xmlns:gx="urn:foreign"')],
    ["unsupported GX altitudeMode alias", doc(`<Placemark><name>Boundary</name>${namespacePolygon}</Placemark><NetworkLink><name>Building</name><Region><LatLonAltBox><north>40.001</north><south>40</south><east>-104</east><west>-104.001</west><t:altitudeMode>absolute</t:altitudeMode></LatLonAltBox></Region></NetworkLink>`, `xmlns:t="${gx}"`)],
  ];
}

for (const [name, input] of namespaceCollisionFixtures()) test(`KML namespace collision refuses ${name} atomically`, () => {
  const initial = createProjectEditorState(capturedProject()), before = JSON.stringify(initial);
  freeze(initial);
  let callerState = initial;
  assert.throws(() => {
    const result = importGoogleEarthKmlToProject(callerState.project, input);
    callerState = reduceProjectEditorState(callerState, { type: "apply_project_import", project: result.project });
  }, /(?:unsupported XML namespace|unsupported KML root|mixed GX coordinate forms|CascadingStyle|unsupported GX element names).*preserve the complete original input/i);
  assert.strictEqual(callerState, initial);
  assert.equal(JSON.stringify(initial), before);
});

test("KML namespace collision controls retain qualified and legacy documents, pure coords and inert foreign extensions", () => {
  const source = createProjectEditorState(capturedProject()).project, before = JSON.stringify(source);
  const base = `<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>Pump location</name><Point><coordinates>-105,40,0</coordinates></Point></Placemark></kml>`;
  freeze(source);
  for (const input of [base, base.replace(' xmlns="http://www.opengis.net/kml/2.2"', "")]) {
    const result = importGoogleEarthKmlToProject(source, input);
    assert.equal(result.importedMapFeatureCount, 1);
    assert.equal(result.project.mapFeatures!.at(-1)!.geometry.type, "Point");
  }
  const coords = ["-105 40 0", "-105.001 40.001 0", "-105.002 40.001 0"].map(value => `<coord>${value}</coord>`).join("");
  for (const namespace of [' xmlns="http://www.opengis.net/kml/2.2"', ""]) {
    const result = importGoogleEarthKmlToProject(source, `<kml${namespace}><Placemark><name>Linear Move Path</name><Track>${coords}</Track></Placemark></kml>`);
    assert.equal(result.importedMapFeatureCount, 1);
    assert.equal(result.project.mapFeatures!.at(-1)!.geometry.type, "LineString");
  }
  const pureGx = base.replace('<kml xmlns="http://www.opengis.net/kml/2.2">', '<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">')
    .replace("</kml>", `<Placemark><name>Linear Move Path</name><gx:Track xmlns="http://www.google.com/kml/ext/2.2"><name xmlns="http://www.opengis.net/kml/2.2">Track</name>${coords}</gx:Track></Placemark></kml>`);
  assert.equal(importGoogleEarthKmlToProject(source, pureGx).importedMapFeatureCount, 2);
  const ignoredLater = base.replace("<name>Pump location</name>", '<name>Pump location</name><f:review xmlns:f="urn:foreign"><name xmlns="urn:foreign">Control</name></f:review>')
    .replace("</coordinates>", '</coordinates><coordinates xmlns="urn:foreign">-106,41</coordinates>');
  assert.deepEqual(importGoogleEarthKmlToProject(source, ignoredLater), importGoogleEarthKmlToProject(source, base));
  const inertForeign = base.replace("</kml>", '<f:CascadingStyle xmlns:f="urn:foreign" xmlns:kml="urn:foreign" kml:id="unused"><f:Style id="explicit"><f:LineStyle><f:color>ff0000ff</f:color></f:LineStyle></f:Style></f:CascadingStyle><f:review xmlns:f="urn:foreign"><f:Point><f:coordinates>-106,41</f:coordinates></f:Point><f:coord>-106 41 0</f:coord></f:review></kml>');
  assert.deepEqual(importGoogleEarthKmlToProject(source, inertForeign), importGoogleEarthKmlToProject(source, base));
  assert.equal(JSON.stringify(source), before);
});
