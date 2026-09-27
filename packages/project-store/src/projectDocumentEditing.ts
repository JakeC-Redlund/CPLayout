import { parseProjectDocument, PivotProjectSchema, PROJECT_DOCUMENT_VERSION, type PivotProject } from "@cplayout/core";

import { parseStrictJson } from "./strictJson";

/** Editable admission is stricter than legacy reading: no unknown source fields may be lost. */
export function parseEditableProjectDocument(document: string): PivotProject {
  if (typeof document !== "string") throw new Error("Editable project input must be a JSON document string.");
  const raw = parseStrictJson(document);
  const wrapped = raw !== null && typeof raw === "object" && Object.hasOwn(raw, "documentVersion");
  if (wrapped && (raw as Record<string, unknown>).documentVersion !== PROJECT_DOCUMENT_VERSION) {
    throw new Error("Project document version is unsupported; preserve the original document.");
  }
  const admitted = wrapped
    ? { documentVersion: PROJECT_DOCUMENT_VERSION, project: PivotProjectSchema.parse((raw as Record<string, unknown>).project) }
    : PivotProjectSchema.parse(raw);
  // Compare schema admission before the reader regenerates the known derived WGS84 companion.
  assertNoStrippedFields(raw, admitted, "Project contains unsupported fields; preserve the original document and use a compatible editor.");
  return parseProjectDocument(admitted);
}

/** Check field retention without evaluating accessors or serialization hooks. Defaults may add fields. */
export function assertNoStrippedFields(input: unknown, parsed: unknown, message = "Unknown mutation field would be discarded."): void {
  const ancestors = new Set<object>();
  const check = (source: unknown, admitted: unknown): void => {
    if (source === null || typeof source !== "object") return;
    if (ancestors.has(source) || admitted === null || typeof admitted !== "object") throw new Error(message);
    ancestors.add(source);
    for (const key of Reflect.ownKeys(source)) {
      if (Array.isArray(source) && key === "length") continue;
      const field = Object.getOwnPropertyDescriptor(source, key)!;
      const retained = Object.getOwnPropertyDescriptor(admitted, key);
      if (typeof key !== "string" || !field.enumerable || !("value" in field) || !retained || !("value" in retained)) {
        throw new Error(message);
      }
      check(field.value, retained.value);
    }
    ancestors.delete(source);
  };
  check(input, parsed);
}
