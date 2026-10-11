import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OperationalFixedGgaEvidenceSchema, sha256Text, parseProjectDocument, parseProjectDocumentV2,
  serializeProjectDocument, parseDesignDraftDocument, parseDesignDraftDocumentV3, serializeDesignDraftDocument,
  parseFieldDesignDocumentV3, parseFieldDesignDocument, serializeFieldDesignDocument, convertPivotProjectToFieldDesign,
  defaultProjectSettings, sampleProject, projectLonLatToXy, createFieldLayoutTarget, serializeFieldLayoutTarget,
  createLayoutSessionDocument, parseLayoutSessionDocument, serializeLayoutSessionDocument,
  type OperationalFixedGgaEvidence, type PivotProject,
} from "./index";

const now = "2026-09-28T12:00:00.000Z";
function fixedEvidence(): OperationalFixedGgaEvidence {
  const payload = "GNGGA,120000.00,4000.0000,N,10500.0000,W,4,12,0.8,1600.0,M,-20.0,M,1.0,42";
  const checksum = [...payload].reduce((sum, c) => sum ^ c.charCodeAt(0), 0).toString(16).padStart(2, "0").toUpperCase();
  return { schemaVersion: "gnss-operational-fixed-v1", observationId: "receiver-observation", sessionId: "receiver-session", transport: "local_udp",
    receivedAt: now, receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true, antennaReference: "unknown", sentenceTypes: ["GGA"],
    gga: { sentence: `$${payload}*${checksum}`, sentenceIdentifier: "GNGGA", utcTime: "120000.00", qualityCode: 4, latitude: 40, longitude: -105 },
    receipt: { sequence: 1, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 500, provenance: "loopback_companion" },
    capture: { evaluatedMonotonicMs: 1500, ageMs: 1000, maxAgeMs: 2000 },
    projection: { id: "wgs84-projection-v1:EPSG:32613", projectCrs: "EPSG:32613" }, physicalQualification: "unverified" };
}
function operationalProject(): PivotProject {
  const evidence = fixedEvidence();
  return { ...structuredClone(sampleProject), projectCrs: "EPSG:32613", surveyPoints: [{ id: "survey-observation", label: "Receiver observation", role: "control",
    projected: projectLonLatToXy({ latitude: 40, longitude: -105 }, "EPSG:32613"), observedAt: now, source: "external_gnss", confidence: "rtk_fixed", captureEvidence: evidence }] };
}

test("portable target SHA-256 matches the standard UTF-8 digest including non-ASCII and long input", () => {
  for (const text of ["", "abc", "a".repeat(1000), "Field 🛰️ café\n\r", "bad surrogate \ud800"]) assert.equal(sha256Text(text), createHash("sha256").update(text).digest("hex"));
});

test("operational fixed evidence validates checksum, raw position/time and complete ingress freshness", () => {
  assert.deepEqual(OperationalFixedGgaEvidenceSchema.parse(fixedEvidence()), fixedEvidence());
  for (const mutate of [
    (value: OperationalFixedGgaEvidence) => { value.gga.sentence = value.gga.sentence.slice(0, -2) + "00"; },
    (value: OperationalFixedGgaEvidence) => { value.gga.latitude += 0.1; },
    (value: OperationalFixedGgaEvidence) => { value.gga.utcTime = "240000"; },
    (value: OperationalFixedGgaEvidence) => { value.capture.evaluatedMonotonicMs = 2601; value.capture.ageMs = 2101; },
    (value: OperationalFixedGgaEvidence) => { value.capture.ageMs = 500; },
    (value: OperationalFixedGgaEvidence) => { value.receipt.browserReceivedMonotonicMs = 3000; },
    (value: OperationalFixedGgaEvidence) => { value.receipt.provenance = "browser_serial"; },
    (value: OperationalFixedGgaEvidence) => { value.gga.sentence = value.gga.sentence.replace(",4,12,", ",5,12,"); },
  ]) { const value = fixedEvidence(); mutate(value); assert.equal(OperationalFixedGgaEvidenceSchema.safeParse(value).success, false); }
});

test("operational project/draft/field evidence emits new versions and old readers refuse without data loss", () => {
  const project = operationalProject(), document = serializeProjectDocument(project);
  assert.equal(JSON.parse(document).documentVersion, "pivot-project-v3");
  assert.deepEqual(parseProjectDocument(document).surveyPoints, project.surveyPoints);
  assert.throws(() => parseProjectDocumentV2(document), /version|evidence/i);
  assert.throws(() => parseProjectDocument({ ...JSON.parse(document), documentVersion: "pivot-project-v2" }), /evidence/i);
  const draft = parseDesignDraftDocument({ documentVersion: "design-draft-v4", draft: JSON.parse(JSON.stringify({ ...project, settings: defaultProjectSettings() })) });
  const draftDocument = serializeDesignDraftDocument(draft);
  assert.equal(JSON.parse(draftDocument).documentVersion, "design-draft-v4");
  assert.deepEqual(parseDesignDraftDocument(draftDocument), draft);
  assert.throws(() => parseDesignDraftDocumentV3(draftDocument), /version|evidence/i);
  assert.throws(() => parseDesignDraftDocument({ documentVersion: "design-draft-v3", draft }), /evidence/i);
  const field = convertPivotProjectToFieldDesign(document, { fieldId: "field", waterSourceId: "water", powerSourceId: "power" }).field;
  const fieldDocument = serializeFieldDesignDocument(field);
  assert.equal(JSON.parse(fieldDocument).documentVersion, "field-design-v4");
  assert.deepEqual(parseFieldDesignDocument(fieldDocument), field);
  assert.throws(() => parseFieldDesignDocumentV3(fieldDocument), /version|evidence/i);
  assert.throws(() => parseFieldDesignDocument({ documentVersion: "field-design-v3", field }), /evidence/i);
  const displayOnly = operationalProject();
  displayOnly.projectCrs = "EPSG:3857";
  const displayCapture = displayOnly.surveyPoints[0].captureEvidence as OperationalFixedGgaEvidence;
  displayCapture.projection = { id: "wgs84-projection-v1:EPSG:3857", projectCrs: "EPSG:3857" };
  displayOnly.surveyPoints[0].projected = projectLonLatToXy({ latitude: 40, longitude: -105 }, "EPSG:3857");
  assert.throws(() => serializeProjectDocument(displayOnly), /qualified|projection/i);
  const moved = operationalProject(); moved.surveyPoints[0].projected.x += 1;
  assert.throws(() => serializeProjectDocument(moved), /XY|projection/i);
});

test("Layout session retains exact target text, rejects target damage and keeps observations separate", () => {
  const field = convertPivotProjectToFieldDesign(serializeProjectDocument(operationalProject()), { fieldId: "field", waterSourceId: "water", powerSourceId: "power" }).field;
  const target = createFieldLayoutTarget(field, { inputRevision: 7, expectedRevision: 7, selectedMachineIds: [field.machines[0].id] });
  const targetDocument = `\n${serializeFieldLayoutTarget(target)}\n`;
  const session = createLayoutSessionDocument({ id: "layout", name: "Layout", fieldMapId: "catalog-field", targetDocument, now });
  session.observations.push({ id: "observation", sessionId: "layout", capturedAt: now,
    projected: operationalProject().surveyPoints[0].projected, evidence: fixedEvidence() });
  const read = parseLayoutSessionDocument(serializeLayoutSessionDocument(session));
  assert.equal(read.targetDocument, targetDocument);
  field.machines[0].pivotCenter.x += 100;
  assert.equal(read.targetDocument, targetDocument);
  assert.throws(() => parseLayoutSessionDocument({ ...session, targetDocument: targetDocument + " " }), /hash/i);
  assert.throws(() => parseLayoutSessionDocument({ ...session, observations: [...session.observations, ...session.observations] }), /duplicate/i);
  assert.throws(() => parseLayoutSessionDocument({ ...session, observations: [{ ...session.observations[0], sessionId: "wrong" }] }), /session/i);
  assert.throws(() => parseLayoutSessionDocument({ ...session, observations: [{ ...session.observations[0], projected: { x: 1, y: 2 } }] }), /XY/i);
});
