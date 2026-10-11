import { z } from "zod";

export const MAX_SURVEY_ACTIVE_POINTS = 2048;
export const MAX_SURVEY_RETAINED_POINTS = 100000;
export const SurveyCollectionIdSchema = z.string().min(1).max(500).refine(value => value === value.trim(), "Use a nonblank identity without surrounding whitespace.");
export const SurveyCollectionRevisionSchema = z.number().int().nonnegative().safe();
const id = SurveyCollectionIdSchema, revision = SurveyCollectionRevisionSchema;
const timestamp = z.iso.datetime({ offset: true });
export const SurveyCollectionOwnerSchema = z.object({
  designId: id, documentKind: z.enum(["project", "draft", "field"]), payloadId: id,
  fieldMapId: id, projectCrs: id,
}).strict();
const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("survey_point"), pointId: id }).strict(),
  z.object({ kind: z.literal("field_boundary") }).strict(),
  z.object({ kind: z.literal("obstacle"), id }).strict(),
  z.object({ kind: z.literal("map_feature"), id }).strict(),
]);
export const SurveyApplicationReceiptSchema = z.object({
  id, appliedAt: timestamp, designRevision: revision, target: targetSchema,
  sourcePointIds: z.array(id).min(1).max(MAX_SURVEY_ACTIVE_POINTS),
  geometryHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type SurveyApplicationReceipt = z.infer<typeof SurveyApplicationReceiptSchema>;

export type SurveyCollectionOwner = z.infer<typeof SurveyCollectionOwnerSchema>;
export const RecordedReferencePurposeSchema = z.discriminatedUnion("featureKind", [
  z.object({ kind: z.literal("map_feature"), featureKind: z.literal("reference_point"), geometryType: z.literal("Point") }).strict(),
  z.object({ kind: z.literal("map_feature"), featureKind: z.literal("reference_line"), geometryType: z.literal("LineString") }).strict(),
  z.object({ kind: z.literal("map_feature"), featureKind: z.literal("reference_area"), geometryType: z.literal("Polygon") }).strict(),
]);
