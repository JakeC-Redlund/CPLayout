import { assertNoStrippedFields, parseProjectDocument, PivotProjectSchema, PROJECT_DOCUMENT_VERSIONS, type PivotProject } from "@cplayout/core";

export { assertNoStrippedFields } from "@cplayout/core";

import { parseStrictJson } from "./strictJson";

/** Editable admission is stricter than legacy reading: no unknown source fields may be lost. */
export function parseEditableProjectDocument(document: string): PivotProject {
  if (typeof document !== "string") throw new Error("Editable project input must be a JSON document string.");
  const raw = parseStrictJson(document);
  const wrapped = raw !== null && typeof raw === "object" && Object.hasOwn(raw, "documentVersion");
  if (wrapped && !(PROJECT_DOCUMENT_VERSIONS as readonly unknown[]).includes((raw as Record<string, unknown>).documentVersion)) {
    throw new Error("Project document version is unsupported; preserve the original document.");
  }
  const admitted = wrapped
    ? { documentVersion: (raw as Record<string, unknown>).documentVersion, project: PivotProjectSchema.parse((raw as Record<string, unknown>).project) }
    : PivotProjectSchema.parse(raw);
  // Compare schema admission before the reader regenerates the known derived WGS84 companion.
  assertNoStrippedFields(raw, admitted, "Project contains unsupported fields; preserve the original document and use a compatible editor.");
  return parseProjectDocument(admitted);
}
