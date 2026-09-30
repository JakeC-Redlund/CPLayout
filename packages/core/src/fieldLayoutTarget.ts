import { z } from "zod";
import type { CrsQualificationOptions } from "./crsQualification";
import { FieldCalculationCrsOptionsSchema } from "./fieldCalculationInput";
import { parseFieldDesignDocument, serializeFieldDesignDocument, validateFieldDesign, type FieldDesign } from "./fieldDesignDocument";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { parseStrictJson } from "./strictJson";

export const FIELD_LAYOUT_TARGET_DOCUMENT_VERSION = "field-layout-target-v1";
export type DeepReadonlyFieldTarget<T> = T extends (infer U)[] ? readonly DeepReadonlyFieldTarget<U>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonlyFieldTarget<T[K]> } : T;

export interface FieldLayoutTargetRequest {
  inputRevision: number;
  expectedRevision: number;
  selectedMachineIds: string[];
  crsOptions?: CrsQualificationOptions;
}

type TargetData = {
  documentVersion: typeof FIELD_LAYOUT_TARGET_DOCUMENT_VERSION;
  source: { fieldId: string; inputRevision: number; selectedMachineIds: string[] };
  field: FieldDesign;
  crsOptions: CrsQualificationOptions;
  /** Snapshot authority is identity and XY retention only, never installation or receiver guidance. */
  qualification: "design_snapshot_only";
};
export type FieldLayoutTarget = DeepReadonlyFieldTarget<TargetData>;
const revisionSchema = z.number().int().nonnegative().safe();
const selectionSchema = z.array(z.string().min(1)).min(1);
const requestSchema = z.object({
  inputRevision: revisionSchema, expectedRevision: revisionSchema, selectedMachineIds: selectionSchema,
  crsOptions: FieldCalculationCrsOptionsSchema.optional(),
}).strict();
const documentSchema = z.object({
  documentVersion: z.literal(FIELD_LAYOUT_TARGET_DOCUMENT_VERSION),
  source: z.object({ fieldId: z.string().min(1), inputRevision: revisionSchema, selectedMachineIds: selectionSchema }).strict(),
  fieldDocument: z.unknown(), crsOptions: FieldCalculationCrsOptionsSchema,
  qualification: z.literal("design_snapshot_only"),
}).strict();

/** Immutable design handoff; later editing and caller mutation cannot change this target. */
export function createFieldLayoutTarget(inputField: FieldDesign, inputRequest: FieldLayoutTargetRequest): FieldLayoutTarget {
  const field = validateFieldDesign(inputField);
  const request = requestSchema.parse(snapshotJsonValue(inputRequest, "layout target request"));
  if (request.inputRevision !== request.expectedRevision) throw new Error("Field revision changed; review the current design before creating a Layout target.");
  assertSelectedMachines(field, request.selectedMachineIds);
  const crsOptions = request.crsOptions ?? {};
  // Keep even an unsupported CRS truthful: creating a snapshot is not metric admission.
  return freeze({ documentVersion: FIELD_LAYOUT_TARGET_DOCUMENT_VERSION,
    source: { fieldId: field.id, inputRevision: request.inputRevision, selectedMachineIds: request.selectedMachineIds },
    field, crsOptions, qualification: "design_snapshot_only" } satisfies TargetData);
}

/** Dedicated durable document, never sent through field/project storage writers. */
export function serializeFieldLayoutTarget(target: FieldLayoutTarget): string {
  const data = snapshotJsonValue(target, "layout target") as TargetData;
  // Round-trip through the public strict parser before emitting caller-supplied snapshots.
  const expectedKeys = ["documentVersion", "source", "field", "crsOptions", "qualification"];
  if (!data || typeof data !== "object" || Object.keys(data).length !== expectedKeys.length
    || Object.keys(data).some(key => !expectedKeys.includes(key))) throw new Error("Unsupported Layout target data.");
  const raw = { documentVersion: data.documentVersion, source: data.source,
    fieldDocument: parseStrictJson(serializeFieldDesignDocument(data.field)), crsOptions: data.crsOptions,
    qualification: data.qualification };
  parseFieldLayoutTarget(raw);
  return JSON.stringify(raw, null, 2);
}

export function parseFieldLayoutTarget(input: string | unknown): FieldLayoutTarget {
  const raw = snapshotJsonValue(typeof input === "string" ? parseStrictJson(input) : input, "layout target document");
  const document = documentSchema.parse(raw);
  const field = parseFieldDesignDocument(document.fieldDocument);
  if (field.id !== document.source.fieldId) throw new Error("Layout target source identity does not match its retained field.");
  const target = createFieldLayoutTarget(field, {
    inputRevision: document.source.inputRevision, expectedRevision: document.source.inputRevision,
    selectedMachineIds: document.source.selectedMachineIds, crsOptions: document.crsOptions,
  });
  return target;
}

export function fieldLayoutTargetMatches(target: FieldLayoutTarget, field: Pick<FieldDesign, "id">, inputRevision: number): boolean {
  return Number.isSafeInteger(inputRevision) && inputRevision >= 0
    && target.source.fieldId === field.id && target.source.inputRevision === inputRevision;
}

function assertSelectedMachines(field: FieldDesign, selected: string[]): void {
  if (new Set(selected).size !== selected.length) throw new Error("Layout target machine identities must be distinct.");
  if (selected.some(id => !field.machines.some(machine => machine.id === id))) throw new Error("Layout target machine was not found in the source field.");
}

function freeze<T>(value: T): DeepReadonlyFieldTarget<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonlyFieldTarget<T>;
}
