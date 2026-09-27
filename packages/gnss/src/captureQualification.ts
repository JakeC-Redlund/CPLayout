import {
  GnssCaptureEvidenceV2Schema, GnssReferenceDeclarationSchema,
  type AppSettings, type GnssCaptureEvidenceV2, type GnssReferenceDeclaration, type GnssTransportKind, type SurveyPoint,
} from "@cplayout/core";
import {
  evaluateGnssObservationGate, surveyPointFromGnssObservation,
  type GnssGateContext, type GnssGateReasonCode, type GnssObservationEpoch, type GnssObservationGateResult,
} from "./nmea";

export interface GnssCaptureContext extends GnssGateContext {
  sessionReference: { sessionId: string; declaration: unknown } | null;
}

export interface GnssCaptureGateResult extends Omit<GnssObservationGateResult, "reasonCodes"> {
  reasonCodes: Array<GnssGateReasonCode | "missing_vertical_evidence" | "session_reference" | "invalid_capture_evidence">;
  referenceDeclaration: GnssReferenceDeclaration | null;
  positionStandardUncertaintyMeters: number | null;
  physicalQualification: "unverified";
}

/** Collection eligibility is not a confidence bound or measured 3D field qualification. */
export function evaluateGnssCaptureGate(
  observation: GnssObservationEpoch | null,
  context: GnssCaptureContext,
  thresholds: AppSettings["gpsQuality"],
): GnssCaptureGateResult {
  const gate = evaluateGnssObservationGate(observation, context, thresholds);
  const result: GnssCaptureGateResult = {
    ...gate, reasonCodes: [...gate.reasonCodes], reasons: [...gate.reasons], referenceDeclaration: null,
    positionStandardUncertaintyMeters: null, physicalQualification: "unverified",
  };
  const reject = (code: GnssCaptureGateResult["reasonCodes"][number], message: string) => {
    if (!result.reasonCodes.includes(code)) result.reasonCodes.push(code);
    result.reasons.push(message);
    result.accepted = false;
  };
  const declaration = GnssReferenceDeclarationSchema.safeParse(context.sessionReference?.declaration);
  if (!declaration.success) {
    reject("session_reference", "Complete the receiver reference declaration before collecting projected observations.");
  } else if (observation && context.sessionReference?.sessionId !== observation.sessionId) {
    reject("session_reference", "Reference declaration does not belong to the current receiver session.");
  } else if (observation) result.referenceDeclaration = declaration.data;
  if (!observation) return result;
  const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);
  const vertical = observation.quality.verticalAccuracyMeters;
  if (!finite(vertical) || vertical < 0 || !finite(observation.altitudeMeters) || !finite(observation.geoidSeparationMeters)) {
    reject("missing_vertical_evidence", "A coherent reported height, geoid separation and GST height standard uncertainty are required.");
  }
  const horizontal = observation.quality.horizontalAccuracyMeters;
  if (finite(horizontal) && horizontal >= 0 && finite(vertical) && vertical >= 0) {
    const combined = Math.hypot(horizontal, vertical);
    if (Number.isFinite(combined)) result.positionStandardUncertaintyMeters = combined;
  }
  if (result.accepted && result.referenceDeclaration) {
    const evidence = GnssCaptureEvidenceV2Schema.safeParse(evidenceCandidate(observation, context, thresholds, result.referenceDeclaration, "replay"));
    if (!evidence.success) reject("invalid_capture_evidence", "The observation lacks valid capture-time GGA/GST/RMC evidence or reference metadata.");
  }
  return result;
}

export function captureGnssObservation(input: {
  observation: GnssObservationEpoch;
  context: GnssCaptureContext;
  thresholds: AppSettings["gpsQuality"];
  transport: GnssTransportKind;
  id: string;
  label: string;
  role?: SurveyPoint["role"];
}): SurveyPoint & { captureEvidence: GnssCaptureEvidenceV2 } {
  const gate = evaluateGnssCaptureGate(input.observation, input.context, input.thresholds);
  if (!gate.accepted || !gate.referenceDeclaration) throw new Error(`GNSS collection blocked: ${gate.reasons.join("; ")}`);
  const evidence = GnssCaptureEvidenceV2Schema.parse(evidenceCandidate(input.observation, input.context, input.thresholds, gate.referenceDeclaration, input.transport));
  const point = surveyPointFromGnssObservation({
    observation: input.observation, projectCrs: input.context.projectCrs,
    sourceCoordinateFrame: input.context.sourceCoordinateFrame, transport: input.transport,
    id: input.id, label: input.label, role: input.role,
  });
  return { ...point, rtk: { ...gate.quality }, captureEvidence: evidence };
}

function evidenceCandidate(
  observation: GnssObservationEpoch, context: GnssCaptureContext, thresholds: AppSettings["gpsQuality"],
  referenceDeclaration: GnssReferenceDeclaration, transport: GnssTransportKind,
) {
  return {
    schemaVersion: "gnss-capture-v2" as const,
    observationId: observation.id, sessionId: observation.sessionId, transport,
    receivedAt: observation.receivedAt, receivedMonotonicMs: observation.receivedMonotonicMs,
    receiverObservedAt: observation.receiverObservedAt,
    sourceCoordinateFrame: context.sourceCoordinateFrame,
    height: { meters: observation.altitudeMeters, type: "orthometric", geoidSeparationMeters: observation.geoidSeparationMeters },
    antennaReference: referenceDeclaration.antennaReference, referenceDeclaration,
    sentenceTypes: observation.sentenceTypes, coherent: observation.coherent,
    qualityScreen: {
      policy: "cplayout-nmea-collection-v2", uncertaintySource: "nmea_gst_component_standard_deviations",
      receiverQuality: observation.quality, thresholds, evaluatedMonotonicMs: context.nowMonotonicMs,
      physicalQualification: "unverified",
    },
  };
}
