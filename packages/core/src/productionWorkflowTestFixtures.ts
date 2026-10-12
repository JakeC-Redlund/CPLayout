import { projectLonLatToXy } from "./coordinates";
import { sampleProject } from "./sampleProject";
import { serializeProjectDocument } from "./projectDocument";
import { convertPivotProjectToFieldDesign } from "./fieldDesignDocument";
import type { OperationalFixedGgaEvidence } from "./operationalGnssEvidence";
import type { SurveyPoint } from "./types";

export const workflowTestTime = "2026-10-11T12:00:00.000Z";
/** Explicit synthetic checksummed receiver records; never exported as physical qualification. */
export function workflowTestPoint(sequence = 1, role: SurveyPoint["role"] = "control", latitude = 40, longitude = -105): SurveyPoint & { captureEvidence: OperationalFixedGgaEvidence } {
  const utcTime = `1200${String(sequence).padStart(2, "0")}.00`;
  const coordinate = (value: number, width: number) => `${String(Math.floor(Math.abs(value))).padStart(width, "0")}${((Math.abs(value) % 1) * 60).toFixed(6).padStart(9, "0")}`;
  const payload = `GNGGA,${utcTime},${coordinate(latitude, 2)},${latitude >= 0 ? "N" : "S"},${coordinate(longitude, 3)},${longitude >= 0 ? "E" : "W"},4,12,0.8,1600.0,M,-20.0,M,1.0,42`;
  const checksum = [...payload].reduce((sum, character) => sum ^ character.charCodeAt(0), 0).toString(16).padStart(2, "0").toUpperCase();
  const captureEvidence: OperationalFixedGgaEvidence = { schemaVersion: "gnss-operational-fixed-v1", observationId: `synthetic-receiver:${sequence}`, sessionId: "synthetic-receiver", transport: "local_udp",
    receivedAt: workflowTestTime, receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true, antennaReference: "unknown", sentenceTypes: ["GGA"],
    gga: { sentence: `$${payload}*${checksum}`, sentenceIdentifier: "GNGGA", utcTime, qualityCode: 4, latitude, longitude },
    receipt: { sequence, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 500, provenance: "loopback_companion" },
    capture: { evaluatedMonotonicMs: 1500, ageMs: 1000, maxAgeMs: 2000 }, projection: { id: "wgs84-projection-v1:EPSG:32613", projectCrs: "EPSG:32613" }, physicalQualification: "unverified" };
  return { id: `synthetic-point:${sequence}`, label: "Synthetic control", role,
    projected: projectLonLatToXy({ latitude, longitude }, "EPSG:32613"), wgs84: { latitude, longitude },
    observedAt: workflowTestTime, source: "external_gnss", confidence: "rtk_fixed", captureEvidence };
}
export function workflowTestField() {
  const { x, y } = workflowTestPoint().projected;
  const project = { ...structuredClone(sampleProject), id: "synthetic-project", name: "Synthetic project", projectCrs: "EPSG:32613",
    fieldBoundary: [{ x: x - 1000, y: y - 1000 }, { x: x + 1000, y: y - 1000 }, { x: x + 1000, y: y + 1000 }, { x: x - 1000, y: y + 1000 }],
    pivotCenter: { x, y }, waterSource: { x: x + 10, y }, powerSource: { x, y: y + 10 }, surveyPoints: [], obstacles: [], mapFeatures: [] };
  delete project.drawingMetadata; delete project.wgs84Companion; delete project.infrastructureObservationRefs;
  const field = convertPivotProjectToFieldDesign(serializeProjectDocument(project), { fieldId: "synthetic-field", waterSourceId: "water", powerSourceId: "power" }).field;
  return field;
}
