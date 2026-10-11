import { z } from "zod";
import { GnssCaptureEvidenceSchema, RtkQualitySchema } from "./gnssEvidence";
import { projectDataKey } from "./projectDataComparison";

const XySchema = z.object({ x: z.number().finite(), y: z.number().finite() });
const LonLatSchema = z.object({ longitude: z.number().min(-180).max(180), latitude: z.number().min(-90).max(90) });

export const SurveyPointSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  role: z.enum(["boundary", "pivot_center", "water_source", "power_source", "obstacle", "control", "note"]),
  projected: XySchema,
  wgs84: LonLatSchema.optional(),
  observedAt: z.string().min(1),
  source: z.enum(["device_gps", "external_gnss", "imported", "manual"]),
  confidence: z.enum(["rtk_fixed", "rtk_float", "dgps", "autonomous_gps", "imagery_digitized", "imported_cad", "user_estimated", "optimized"]),
  rtk: RtkQualitySchema.optional(),
  captureEvidence: GnssCaptureEvidenceSchema.optional(),
  notes: z.string().optional(),
}).superRefine((point, context) => {
  const evidence = point.captureEvidence;
  if (evidence?.schemaVersion !== "gnss-capture-v2") return;
  if (point.observedAt !== evidence.receiverObservedAt) {
    context.addIssue({ code: "custom", path: ["observedAt"], message: "V2 survey observedAt must exactly match receiverObservedAt." });
  }
  const rawQuality = evidence.qualityScreen.receiverQuality;
  const elapsed = (evidence.qualityScreen.evaluatedMonotonicMs - evidence.receivedMonotonicMs) / 1000;
  const captureQuality = {
    ...rawQuality,
    correctionAgeSeconds: rawQuality.correctionAgeSeconds === null ? null : rawQuality.correctionAgeSeconds + elapsed,
  };
  if (!point.rtk || projectDataKey(point.rtk) !== projectDataKey(captureQuality)) {
    context.addIssue({ code: "custom", path: ["rtk"], message: "V2 survey quality must match the raw receiver snapshot with capture elapsed correction age added." });
  }
  const confidence = rawQuality.fixType === "rtk_fixed" ? "rtk_fixed"
    : rawQuality.fixType === "rtk_float" ? "rtk_float"
      : rawQuality.fixType === "dgps" ? "dgps" : "autonomous_gps";
  if (point.confidence !== confidence) {
    context.addIssue({ code: "custom", path: ["confidence"], message: "V2 survey confidence must match its receiver fix type." });
  }
});
