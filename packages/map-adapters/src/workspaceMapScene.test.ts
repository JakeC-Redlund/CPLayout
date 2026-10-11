import assert from "node:assert/strict";
import test from "node:test";
import { sampleProject } from "../../core/src/sampleProject";
import { defaultProjectSettings } from "../../core/src/settings";
import { convertPivotProjectToFieldDesign } from "../../core/src/fieldDesignDocument";
import { createFieldLayoutTarget, serializeFieldLayoutTarget } from "../../core/src/fieldLayoutTarget";
import { createLayoutSessionDocument } from "../../core/src/layoutSession";
import { projectLonLatToXy } from "../../core/src/coordinates";
import { sha256Text } from "../../core/src/sha256";
import { createSurveyCollection, proposeSurveyCaptureAppend, proposeSurveyClear, proposeSurveyApplication, type SurveyCollection, type SurveyCollectionPurpose } from "../../core/src/surveyCollection";
import type { DesignDraft } from "../../core/src/designDraft";
import type { OperationalFixedGgaEvidence } from "../../core/src/operationalGnssEvidence";
import { evaluateLayout } from "../../geometry/src/geometry";
import {
  validateWorkspaceMapScene, withWorkspaceManualDrawing, workspaceMapSceneFromDraft, workspaceMapSceneFromField, workspaceMapSceneFromProject,
  workspaceMapSceneFromSession, workspaceMapSceneFromTarget, type WorkspaceMapScene,
} from "./workspaceMapScene";

const frame = { id: "field-workspace", generation: 5 };
const now = "2026-09-28T12:00:00.000Z";

test("manual Project preview retains exact supplied vertices without calculation or canonical mutation", () => {
  const source = structuredClone(sampleProject);
  const scene = workspaceMapSceneFromProject(source, { ...frame, inputRevision: 3 });
  const preview = { sourceDocumentId: source.id, inputRevision: 3, captureId: "manual-preview",
    geometry: { type: "Pending" as const, geometryType: "Polygon" as const, vertices: [{ x: 10.123456789, y: 20.987654321 }] } };
  const rendered = withWorkspaceManualDrawing(scene, preview);
  assert.equal(rendered.calculation, undefined); assert.deepEqual(rendered.sourceDocument, scene.sourceDocument);
  assert.deepEqual(rendered.entities.find(item => item.sourcePath === "manualDrawing")?.geometry, preview.geometry);
  assert.equal(scene.entities.some(item => item.sourcePath === "manualDrawing"), false);
  preview.geometry.vertices[0].x = 50;
  assert.equal(rendered.manualDrawing?.geometry.type === "Pending" && rendered.manualDrawing.geometry.vertices[0].x, 10.123456789);
  const tampered = structuredClone(rendered); const item = tampered.entities.find(item => item.sourcePath === "manualDrawing")!;
  assert(item.geometry.type === "Pending");
  // Deliberately tamper only with the detached clone, preserving the public readonly contract.
  Object.assign(item.geometry.vertices[0], { x: 99 });
  assert.throws(() => validateWorkspaceMapScene(tampered), /differs/);
  assert.equal(withWorkspaceManualDrawing(rendered, null).entities.some(item => item.sourcePath === "manualDrawing"), false);
  assert.throws(() => withWorkspaceManualDrawing(scene, { ...preview, inputRevision: 2 }), /revision/);
  assert.throws(() => withWorkspaceManualDrawing(workspaceMapSceneFromDraft(blank(), frame), preview), /saved workflow/);
});
function blank(): DesignDraft {
  const settings = defaultProjectSettings();
  return { id: "draft", name: "Draft", projectCrs: null, unitSystem: settings.unitSystem, settings,
    fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
}
function fieldFixture() {
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { fieldId: "field", waterSourceId: "water", powerSourceId: "power" }).field;
  const second = structuredClone(field.machines[0]);
  second.id = "second"; second.configuration.name = "Independent second";
  second.configuration.spanLengthsMeters = [11.234567890123, 29.765432109876];
  second.pivotCenter = { x: 501913.987654321, y: 4506721.123456789 };
  field.machines.push(second);
  return field;
}
function fixedEvidence(observationId = "receiver-observation", utcTime = "120000.00", latitude = 40, longitude = -105): OperationalFixedGgaEvidence {
  const coordinate = (value: number, width: number) => {
    const absolute = Math.abs(value), degrees = Math.floor(absolute);
    return `${String(degrees).padStart(width, "0")}${((absolute - degrees) * 60).toFixed(4).padStart(7, "0")}`;
  };
  const payload = `GNGGA,${utcTime},${coordinate(latitude, 2)},N,${coordinate(longitude, 3)},W,4,12,0.8,1600.0,M,-20.0,M,1.0,42`;
  const checksum = [...payload].reduce((sum, c) => sum ^ c.charCodeAt(0), 0).toString(16).padStart(2, "0").toUpperCase();
  return { schemaVersion: "gnss-operational-fixed-v1", observationId, sessionId: "receiver-session", transport: "local_udp",
    receivedAt: now, receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true, antennaReference: "unknown", sentenceTypes: ["GGA"],
    gga: { sentence: `$${payload}*${checksum}`, sentenceIdentifier: "GNGGA", utcTime, qualityCode: 4, latitude, longitude },
    receipt: { sequence: 1, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 500, provenance: "loopback_companion" },
    capture: { evaluatedMonotonicMs: 1500, ageMs: 1000, maxAgeMs: 2000 },
    projection: { id: "wgs84-projection-v1:EPSG:32613", projectCrs: "EPSG:32613" }, physicalQualification: "unverified" };
}

function surveyFixture(documentKind: "draft" | "project" | "field", payloadId: string,
  purpose: SurveyCollectionPurpose = { kind: "field_boundary" }, count = 2): SurveyCollection {
  let collection = createSurveyCollection({ id: `collection-${documentKind}`, now, purpose,
    owner: { documentKind, payloadId, designId: "catalog-design", fieldMapId: "catalog-field", projectCrs: "EPSG:32613" } });
  for (let index = 0; index < count; index++) {
    const latitude = 40 + index * 0.01, evidence = fixedEvidence(`survey-receiver-${index}`, `12000${index}.00`, latitude);
    collection = proposeSurveyCaptureAppend(collection, { expectedRevision: collection.revision, now,
      point: { id: `survey-record-${index}`, label: `Retained ${index}`, role: purpose.kind === "point" ? purpose.role : "control",
        projected: projectLonLatToXy({ latitude, longitude: -105 }, "EPSG:32613"), observedAt: now, source: "external_gnss", confidence: "rtk_fixed", captureEvidence: evidence,
        notes: "Exact pending Survey evidence" } }).collection;
  }
  return collection;
}
const surveyFrame = { ...frame, catalogOwner: { designId: "catalog-design", fieldMapId: "catalog-field", projectCrs: "EPSG:32613" } };

test("an empty unqualified draft renders no invented geometry, machine, CRS, result or target", () => {
  const draft = blank(); const before = structuredClone(draft);
  const scene = workspaceMapSceneFromDraft(draft, frame);
  assert.equal(scene.identity.projectCrs, null);
  assert.deepEqual(scene.entities, []); assert.deepEqual(scene.machines, []);
  assert.equal(scene.calculation, undefined); assert.equal(scene.targetAuthority, null);
  assert.deepEqual(scene.sourceDocument.data, before); assert.deepEqual(draft, before);
  assert(Object.isFrozen(scene.sourceDocument.data)); assert.equal(Object.isFrozen(draft), false);
});

test("partial boundary, absent machine ID/location and null spans retain exact supplied values", () => {
  const draft = blank(); draft.projectCrs = "LOCAL:field";
  draft.fieldBoundary = [{ x: -0, y: 900719925474.1234 }, { x: 0.000000000000001, y: -37.1234567890123 }];
  draft.machine = { name: "Partial", spanLengthsMeters: [null, 12.3456789012345] };
  const before = structuredClone(draft);
  const scene = workspaceMapSceneFromDraft(draft, frame);
  assert.equal(scene.entities.length, 1); assert.equal(scene.entities[0].geometryState, "incomplete");
  assert.deepEqual(scene.entities[0].geometry, { type: "Polygon", vertices: draft.fieldBoundary });
  assert.deepEqual(scene.machines[0].configuration, draft.machine);
  assert.equal(Object.hasOwn(scene.machines[0], "id"), false); assert.equal(Object.hasOwn(scene.machines[0], "location"), false);
  assert.deepEqual(scene.sourceDocument.data, before); assert.deepEqual(draft, before);
  draft.fieldBoundary[0].y += 1;
  assert.deepEqual(scene.sourceDocument.data, before);
  assert.equal(scene.entities[0].geometry.type, "Polygon");
  if (scene.entities[0].geometry.type === "Polygon") assert(Object.is(scene.entities[0].geometry.vertices[0].x, -0));
});

test("all manual captures, including empty and paused shapes, remain unfinished and separate from saved geometry", () => {
  const draft = blank(); draft.projectCrs = "LOCAL:field";
  draft.drawingWorkflow = { schemaVersion: "draft-drawing-workflow-v1", autosaveEnabled: true, lockedCrs: "LOCAL:field", activeCaptureId: "active", captures: [
    { id: "active", name: "Boundary", projectCrs: "LOCAL:field", geometryType: "Polygon", stage: "drawing", source: "map_digitized",
      vertices: [{ point: { x: 100.123456789, y: 200.987654321 }, recordedAt: now, wgs84: null, elevation: null }], classification: { purposeId: null, name: "Boundary", notes: "" } },
    { id: "paused", name: "Empty point", projectCrs: "LOCAL:field", geometryType: "Point", stage: "drawing", source: "map_digitized", vertices: [], classification: { purposeId: null, name: "Empty point", notes: "" } },
  ] };
  const before = structuredClone(draft);
  const scene = workspaceMapSceneFromDraft(draft, frame);
  assert.deepEqual(scene.entities.map(entity => [entity.layer, entity.sourceId, entity.geometry.type]), [["manual_capture", "active", "Pending"], ["manual_capture", "paused", "Pending"]]);
  assert.equal(scene.entities.some(entity => entity.kind === "boundary"), false);
  assert.deepEqual(draft, before); assert.deepEqual(scene.sourceDocument.data, before);
  const foreign = structuredClone(draft); foreign.drawingWorkflow!.captures[0].projectCrs = "LOCAL:other";
  assert.throws(() => workspaceMapSceneFromDraft(foreign, frame), /CRS/);
});

test("independent pivots and explicit lateral travel keep real identities, unequal dimensions and exact locations", () => {
  const field = fieldFixture();
  field.lateralMachines = [{ id: "lateral", kind: "straight_lateral", name: "Lateral", leftExtentMeters: 51, rightExtentMeters: 74,
    travelHeadingDegrees: 0, travel: { start: { x: 100, y: 200 }, end: { x: 400, y: 200 } }, machineClearanceBufferMeters: 5 }];
  const before = structuredClone(field); const scene = workspaceMapSceneFromField(field, frame);
  assert.deepEqual(scene.machines.map(machine => machine.id), [field.machines[0].id, "second", "lateral"]);
  assert.deepEqual(scene.machines[0].configuration, field.machines[0].configuration);
  assert.deepEqual(scene.machines[1].configuration, field.machines[1].configuration);
  assert.deepEqual(scene.machines[1].location, field.machines[1].pivotCenter);
  assert.deepEqual(scene.entities.find(entity => entity.sourceId === "lateral")?.geometry, { type: "LineString", vertices: [field.lateralMachines[0].travel.start, field.lateralMachines[0].travel.end] });
  assert.deepEqual(scene.sourceDocument.data, before); assert.deepEqual(field, before);
  assert.equal(Reflect.set(scene.machines[1].location!, "x", 0), false);
});

test("target scenes render selected real machines and only retain authority when exact matching bytes are supplied", () => {
  const field = fieldFixture(); const target = createFieldLayoutTarget(field, { inputRevision: 7, expectedRevision: 7, selectedMachineIds: ["second"] });
  const document = `\n${serializeFieldLayoutTarget(target)}\n`; const hash = sha256Text(document);
  const bare = workspaceMapSceneFromTarget(target, frame);
  assert.equal(bare.targetAuthority, null); assert.deepEqual(bare.machines.map(machine => machine.id), ["second"]);
  const scene = workspaceMapSceneFromTarget(target, frame, { authority: { document, hash } });
  assert.equal(scene.targetAuthority?.document, document); assert.equal(scene.targetAuthority?.hash, hash);
  assert.equal(scene.identity.inputRevision, 7);
  assert(scene.entities.filter(entity => entity.kind === "machine").every(entity => entity.layer === "frozen_target"));
  assert.throws(() => workspaceMapSceneFromTarget(target, frame, { authority: { document: `${document} `, hash } }), /hash/);
  const other = createFieldLayoutTarget(field, { inputRevision: 8, expectedRevision: 8, selectedMachineIds: ["second"] });
  assert.throws(() => workspaceMapSceneFromTarget(other, frame, { authority: { document, hash } }), /differ/);
  field.machines[1].pivotCenter.x += 100;
  assert.equal(scene.targetAuthority?.document, document);
  const moved = structuredClone(scene);
  const machine = moved.entities.find(entity => entity.kind === "machine")!;
  assert.equal(machine.geometry.type, "Point");
  if (machine.geometry.type === "Point") Object.assign(machine.geometry.point, { x: machine.geometry.point.x + 1 });
  assert.throws(() => validateWorkspaceMapScene(moved), /Frozen render geometry/);
});

test("session target, saved Survey, separately saved observations and live display never replace one another", () => {
  const field = fieldFixture(); const target = createFieldLayoutTarget(field, { inputRevision: 7, expectedRevision: 7, selectedMachineIds: ["second"] });
  const document = `\n${serializeFieldLayoutTarget(target)}\n`;
  const session = createLayoutSessionDocument({ id: "layout", name: "Layout", fieldMapId: "catalog-field", targetDocument: document, now });
  const observed = projectLonLatToXy({ latitude: 40, longitude: -105 }, "EPSG:32613");
  session.observations.push({ id: "layout-observation", sessionId: session.id, capturedAt: now, projected: observed, evidence: fixedEvidence() });
  const before = structuredClone(session);
  const scene = workspaceMapSceneFromSession(session, frame, { receiver: { observationId: "next-live-position", projectCrs: field.projectCrs, point: { x: observed.x + 1, y: observed.y + 1 } } });
  assert.equal(scene.targetAuthority?.document, document); assert.equal(scene.targetAuthority?.hash, session.targetHash);
  assert.deepEqual(scene.entities.find(entity => entity.sourceId === "second")?.geometry, { type: "Point", point: target.field.machines[1].pivotCenter });
  assert.deepEqual(scene.entities.find(entity => entity.layer === "layout_observation")?.geometry, { type: "Point", point: observed });
  assert.equal(scene.entities.filter(entity => entity.layer === "receiver").length, 1);
  assert.equal(scene.entities.filter(entity => entity.layer === "saved_survey").length, field.surveyPoints.length);
  assert.deepEqual(scene.sourceDocument.data, before); assert.deepEqual(session, before);
  assert.throws(() => workspaceMapSceneFromSession({ ...session, targetHash: "0".repeat(64) }, frame), /hash/);
  assert.throws(() => workspaceMapSceneFromSession({ ...session, observations: [{ ...session.observations[0], sessionId: "foreign" }] }, frame), /session/);
  assert.throws(() => workspaceMapSceneFromSession({ ...session, observations: [{ ...session.observations[0], projected: { x: 1, y: 2 } }] }, frame), /XY/);
});

test("render admission rejects nonfinite coordinates, malformed entities and duplicate identities without mutation", () => {
  const draft = blank(); draft.projectCrs = "LOCAL:field";
  draft.fieldBoundary = [{ x: NaN, y: 1 }]; assert.throws(() => workspaceMapSceneFromDraft(draft, frame), /finite/);
  const field = fieldFixture(); field.machines[1].id = field.machines[0].id;
  assert.throws(() => workspaceMapSceneFromField(field, frame), /Duplicate/);
  const good = workspaceMapSceneFromProject(sampleProject, frame);
  const damaged = structuredClone(good) as unknown as { entities: Array<{ geometry: unknown }> };
  damaged.entities[0].geometry = { type: "Polygon", vertices: [{ x: 1, y: 2 }] };
  assert.throws(() => validateWorkspaceMapScene(damaged as unknown as WorkspaceMapScene), /vertex count/);
  assert.throws(() => workspaceMapSceneFromProject(sampleProject, frame, { receiver: { observationId: "receiver", projectCrs: "LOCAL:other", point: { x: 1, y: 2 } } }), /CRS/);
  const accessor = blank(); let reads = 0;
  Object.defineProperty(accessor, "pivotCenter", { enumerable: true, get: () => { reads++; return { x: 1, y: 2 }; } });
  assert.throws(() => workspaceMapSceneFromDraft(accessor, frame), /accessors/); assert.equal(reads, 0);
});

test("direct scene validation rechecks stored session GGA and exact rendered observation coordinates, identities, labels, count and order", () => {
  const field = fieldFixture();
  const target = createFieldLayoutTarget(field, { inputRevision: 7, expectedRevision: 7, selectedMachineIds: ["second"] });
  const session = createLayoutSessionDocument({ id: "layout", name: "Layout", fieldMapId: "catalog-field", targetDocument: serializeFieldLayoutTarget(target), now });
  const projected = projectLonLatToXy({ latitude: 40, longitude: -105 }, field.projectCrs);
  session.observations.push(
    { id: "first", sessionId: session.id, capturedAt: now, projected, label: "First retained label", evidence: fixedEvidence() },
    { id: "second-observation", sessionId: session.id, capturedAt: now, projected, label: "Second retained label", evidence: fixedEvidence("next-receiver-observation", "120001.00") },
  );
  const scene = workspaceMapSceneFromSession(session, frame);
  assert.deepEqual(validateWorkspaceMapScene(structuredClone(scene)), scene);
  const observationEntities = scene.entities.filter(entity => entity.layer === "layout_observation");

  const shifted = structuredClone(scene);
  const rendered = shifted.entities.find(entity => entity.layer === "layout_observation")!;
  if (rendered.geometry.type !== "Point") throw new Error("Expected observation point.");
  Object.assign(rendered.geometry.point, { x: rendered.geometry.point.x + 1 });
  assert.throws(() => validateWorkspaceMapScene(shifted), /Rendered Layout observations differ/);

  const invalidStored = structuredClone(scene);
  if (invalidStored.sourceDocument.kind !== "session") throw new Error("Expected retained session.");
  Object.assign(invalidStored.sourceDocument.data.observations[0].evidence.gga, { qualityCode: 5 });
  assert.deepEqual(invalidStored.entities, scene.entities);
  assert.throws(() => validateWorkspaceMapScene(invalidStored));

  const mutations = [
    scene.entities.filter(entity => entity.sourceId !== "first"),
    [...scene.entities, { ...observationEntities[0], address: "extra-render-address", sourceId: "extra-observation", sourcePath: "observations[2]" }],
    [...scene.entities.filter(entity => entity.layer !== "layout_observation"), ...observationEntities.slice().reverse()],
    scene.entities.map(entity => entity.sourceId === "first" ? { ...entity, sourceId: "changed-id" } : entity),
    scene.entities.map(entity => entity.sourceId === "first" ? { ...entity, label: "Changed rendered label" } : entity),
  ];
  for (const entities of mutations) assert.throws(() => validateWorkspaceMapScene({ ...scene, entities }), /Rendered Layout observations differ/);
  assert.deepEqual(scene.sourceDocument.data, session);
});

test("calculation overlays require supplied result and matching actual document, input revision and machine identities", () => {
  const project = structuredClone(sampleProject);
  // Execute the current source solver on a synthetic project; no placeholder result enters the adapter.
  const result = evaluateLayout(project);
  const calculation = { sourceDocumentId: project.id, inputRevision: 8, machineIds: [project.machine.id], result,
    overlays: [{ id: "actual-preview", geometry: { type: "Polygon" as const, vertices: project.fieldBoundary } }] };
  const scene = workspaceMapSceneFromProject(project, { ...frame, inputRevision: 8 }, { calculation });
  assert.deepEqual(scene.calculation?.result, result); assert.equal(scene.entities.filter(entity => entity.layer === "preview").length, 1);
  assert.throws(() => workspaceMapSceneFromProject(project, frame, { calculation }), /revision/);
  assert.throws(() => workspaceMapSceneFromProject(project, { ...frame, inputRevision: 9 }, { calculation }), /revision/);
  assert.throws(() => workspaceMapSceneFromProject(project, { ...frame, inputRevision: 8 }, { calculation: { ...calculation, sourceDocumentId: "other" } }), /document/);
  assert.throws(() => workspaceMapSceneFromProject(project, { ...frame, inputRevision: 8 }, { calculation: { ...calculation, machineIds: ["invented"] } }), /identity/);
  assert.throws(() => workspaceMapSceneFromProject(project, { ...frame, inputRevision: 8 }, { calculation: { ...calculation, machineIds: [] } }), /identity/);
  const stale = { ...scene, identity: { ...scene.identity, inputRevision: 9 } };
  assert.throws(() => validateWorkspaceMapScene(stale), /provenance/);
  assert.equal(workspaceMapSceneFromProject(project, frame).calculation, undefined);
});

test("direct scene validation rejects null or missing calculation results while preserving supplied actual solver results", () => {
  const result = evaluateLayout(sampleProject);
  const scene = workspaceMapSceneFromProject(sampleProject, { ...frame, inputRevision: 8 }, {
    calculation: { sourceDocumentId: sampleProject.id, inputRevision: 8, machineIds: [sampleProject.machine.id], result, overlays: [] },
  });
  assert.deepEqual(validateWorkspaceMapScene(structuredClone(scene)).calculation?.result, result);
  const nullResult = { ...scene, calculation: { ...scene.calculation!, result: null } };
  assert.throws(() => validateWorkspaceMapScene(nullResult as unknown as WorkspaceMapScene), /requires its supplied result object/);
  const { result: _result, ...withoutResult } = scene.calculation!;
  assert.throws(() => validateWorkspaceMapScene({ ...scene, calculation: withoutResult } as unknown as WorkspaceMapScene), /requires its supplied result object/);
});

test("durable one/two-vertex Survey drafts render exact ordered pending membership on their own layer without completing or aliasing source", () => {
  const draft = blank(); draft.projectCrs = "EPSG:32613";
  for (const count of [1, 2]) {
    const collection = surveyFixture("draft", draft.id, { kind: "field_boundary" }, count);
    const before = structuredClone(collection);
    const scene = workspaceMapSceneFromDraft(draft, surveyFrame, { surveyCollections: [collection] });
    const pending = scene.entities.filter(entity => entity.layer === "survey_capture");
    assert.equal(pending.length, 1); assert.equal(pending[0].sourceId, collection.id);
    assert.deepEqual(pending[0].geometry, { type: "Pending", geometryType: "Polygon", vertices: collection.observations.map(point => point.projected) });
    assert.deepEqual(pending[0].surveyCapture, { purpose: collection.purpose, activePointIds: collection.activePointIds });
    assert.equal(scene.entities.some(entity => entity.layer === "manual_capture" || entity.layer === "preview"), false);
    assert.deepEqual(scene.machines, []); assert.deepEqual(draft.fieldBoundary, []); assert.equal(draft.pivotCenter, null);
    assert.deepEqual(scene.surveyCollections, [before]); assert(Object.isFrozen(scene.surveyCollections![0].observations[0].captureEvidence));
    collection.observations[0].notes = "Changed caller notes";
    assert.deepEqual(scene.surveyCollections, [before]); assert.equal(Reflect.set(scene.surveyCollections![0].observations[0].projected, "x", 0), false);
    for (const mode of ["design", "survey", "layout"]) {
      const declaredFrame = { ...surveyFrame, mode };
      const same = workspaceMapSceneFromDraft(draft, declaredFrame, { surveyCollections: [before] });
      assert.deepEqual(same.identity, scene.identity); assert.deepEqual(same.entities, scene.entities);
    }
  }
});

test("Point and line purposes remain pinned across actual editable document kinds; empty and retired collections retain evidence without pending geometry", () => {
  const field = fieldFixture();
  const line = surveyFixture("field", field.id, { kind: "map_feature", featureKind: "reference_line", geometryType: "LineString" });
  const fieldScene = workspaceMapSceneFromField(field, surveyFrame, { surveyCollections: [line] });
  assert.deepEqual(fieldScene.entities.find(entity => entity.layer === "survey_capture")?.surveyCapture?.purpose, line.purpose);
  assert.equal(fieldScene.entities.find(entity => entity.layer === "survey_capture")?.geometry.type, "Pending");
  const points = surveyFixture("project", sampleProject.id, { kind: "point", role: "control" }, 1);
  const pointScene = workspaceMapSceneFromProject(sampleProject, surveyFrame, { surveyCollections: [points] });
  assert.equal(pointScene.entities.find(entity => entity.layer === "survey_capture")?.geometry.type, "Pending");
  const cleared = proposeSurveyClear(line, { expectedRevision: line.revision, now });
  const archived = { ...line, state: "archived" as const };
  const empty = surveyFixture("field", field.id, { kind: "field_boundary" }, 0); empty.id = "empty-collection";
  const retained = workspaceMapSceneFromField(field, surveyFrame, { surveyCollections: [cleared, empty] });
  assert.equal(retained.entities.some(entity => entity.layer === "survey_capture"), false);
  assert.deepEqual(retained.surveyCollections, [cleared, empty]);
  const archivedScene = workspaceMapSceneFromField(field, surveyFrame, { surveyCollections: [archived] });
  assert.equal(archivedScene.entities.some(entity => entity.layer === "survey_capture"), false);
  assert.deepEqual(archivedScene.surveyCollections![0].observations, line.observations);
  const applied = proposeSurveyApplication(line, { expectedRevision: line.revision, now, receipt: {
    id: "line-application", appliedAt: now, designRevision: 1, target: { kind: "map_feature", id: "line-output" },
    sourcePointIds: [...line.activePointIds], geometryHash: sha256Text(JSON.stringify({ type: "LineString", vertices: line.observations.map(point => point.projected) })),
  } });
  const appliedScene = workspaceMapSceneFromField(field, surveyFrame, { surveyCollections: [applied] });
  assert.equal(appliedScene.entities.some(entity => entity.layer === "survey_capture"), false);
  assert.deepEqual(appliedScene.surveyCollections![0], applied);
});

test("Survey overlays reject missing/wrong catalog owner, payload kind/identity, CRS, references, evidence and frozen sources", () => {
  const draft = blank(); draft.projectCrs = "EPSG:32613";
  const collection = surveyFixture("draft", draft.id);
  assert.throws(() => workspaceMapSceneFromDraft(draft, frame, { surveyCollections: [collection] }), /catalog owner/);
  assert.throws(() => workspaceMapSceneFromDraft(draft, surveyFrame, { surveyCollections: [JSON.stringify(collection)] as never }), /actual collection objects/);
  for (const owner of [
    { ...collection.owner, designId: "foreign-design" }, { ...collection.owner, fieldMapId: "foreign-field" },
    { ...collection.owner, payloadId: "foreign-draft" }, { ...collection.owner, documentKind: "field" as const },
  ]) assert.throws(() => workspaceMapSceneFromDraft(draft, surveyFrame, { surveyCollections: [{ ...collection, owner }] }), /owner differs/);
  assert.throws(() => workspaceMapSceneFromDraft(draft, { ...surveyFrame, catalogOwner: { ...surveyFrame.catalogOwner, projectCrs: "EPSG:32614" } }, { surveyCollections: [collection] }), /CRS/);
  assert.throws(() => workspaceMapSceneFromDraft(draft, surveyFrame, { surveyCollections: [{ ...collection, owner: { ...collection.owner, projectCrs: "EPSG:32614" } }] }), /projection/);
  assert.throws(() => workspaceMapSceneFromDraft(draft, surveyFrame, { surveyCollections: [{ ...collection, activePointIds: ["missing-record"] }] }), /resolve/);
  const damaged = structuredClone(collection);
  Object.assign((damaged.observations[0].captureEvidence as OperationalFixedGgaEvidence).gga, { qualityCode: 5 });
  assert.throws(() => workspaceMapSceneFromDraft(draft, surveyFrame, { surveyCollections: [damaged] }));
  const field = fieldFixture(), target = createFieldLayoutTarget(field, { inputRevision: 7, expectedRevision: 7, selectedMachineIds: ["second"] });
  assert.throws(() => workspaceMapSceneFromTarget(target, surveyFrame, { surveyCollections: [collection] }), /frozen target/);
  const session = createLayoutSessionDocument({ id: "layout", name: "Layout", fieldMapId: "catalog-field", targetDocument: serializeFieldLayoutTarget(target), now });
  assert.throws(() => workspaceMapSceneFromSession(session, surveyFrame, { surveyCollections: [collection] }), /frozen target/);
});

test("direct scene validation rechecks durable Survey evidence and binds exact pending coordinates, purpose, membership, count and owner", () => {
  const draft = blank(); draft.projectCrs = "EPSG:32613";
  const collection = surveyFixture("draft", draft.id), scene = workspaceMapSceneFromDraft(draft, surveyFrame, { surveyCollections: [collection] });
  assert.deepEqual(validateWorkspaceMapScene(structuredClone(scene)), scene);
  const shifted = structuredClone(scene), entity = shifted.entities.find(entity => entity.layer === "survey_capture")!;
  if (entity.geometry.type !== "Pending") throw new Error("Expected pending Survey vertices.");
  Object.assign(entity.geometry.vertices[0], { x: entity.geometry.vertices[0].x + 1 });
  assert.throws(() => validateWorkspaceMapScene(shifted), /Rendered Survey captures differ/);
  const pending = scene.entities.find(entity => entity.layer === "survey_capture")!;
  for (const entities of [
    scene.entities.filter(entity => entity.layer !== "survey_capture"),
    [...scene.entities, { ...pending, address: "extra-survey", sourceId: "extra-collection" }],
    scene.entities.map(entity => entity === pending ? { ...entity, surveyCapture: { ...entity.surveyCapture!, activePointIds: [...entity.surveyCapture!.activePointIds].reverse() } } : entity),
    scene.entities.map(entity => entity === pending ? { ...entity, surveyCapture: { ...entity.surveyCapture!, purpose: { kind: "obstacle" as const, obstacleKind: "exclusion" as const } } } : entity),
  ]) assert.throws(() => validateWorkspaceMapScene({ ...scene, entities }), /Rendered Survey captures differ/);
  const invalidEvidence = structuredClone(scene);
  Object.assign((invalidEvidence.surveyCollections![0].observations[0].captureEvidence as OperationalFixedGgaEvidence).gga, { qualityCode: 5 });
  assert.deepEqual(invalidEvidence.entities, scene.entities);
  assert.throws(() => validateWorkspaceMapScene(invalidEvidence));
  assert.throws(() => validateWorkspaceMapScene({ ...scene, surveyCollections: [{ ...collection, owner: { ...collection.owner, designId: "foreign" } }] }), /owner differs/);
  assert.throws(() => validateWorkspaceMapScene({ ...scene, surveyCollections: [{ ...collection, activePointIds: [...collection.activePointIds].reverse() }] }), /Rendered Survey captures differ/);
  const { surveyCollections: _collections, ...withoutSource } = scene;
  assert.throws(() => validateWorkspaceMapScene(withoutSource), /actual durable collections/);
});
