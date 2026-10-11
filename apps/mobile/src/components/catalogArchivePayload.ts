import {
  assertNoStrippedFields, DESIGN_DRAFT_DOCUMENT_VERSIONS, FIELD_DESIGN_DOCUMENT_VERSIONS,
  PROJECT_DOCUMENT_VERSIONS, PivotProjectSchema, parseStrictJson, parseProjectDocument,
  parseDesignDraftDocument, parseFieldDesignDocument, serializeProjectDocument,
  serializeDesignDraftDocument, serializeFieldDesignDocument,
} from "@cplayout/core";
import { importProjectArchiveZip, importDesignDraftArchiveZip, importFieldDesignArchiveZip } from "@cplayout/project-store";

export const CATALOG_IMPORT_MAX_BYTES = 25 * 1024 * 1024;
export interface CatalogImportPreview {
  kind: "project" | "draft" | "field";
  name: string;
  document: string;
  originalProjectDocument?: string;
  projectCrs: string | null;
  boundaryVertices: number;
  machineCount: number;
  observationCount: number;
}

/** Pure admission: selecting a file cannot create catalog records or change source identities. */
export function previewCatalogImport(bytes: Uint8Array, filename: string): CatalogImportPreview {
  if (!bytes.byteLength || bytes.byteLength > CATALOG_IMPORT_MAX_BYTES) throw new Error("Choose a nonempty CPLayout JSON or ZIP file no larger than 25 MB.");
  const zip = /\.zip$/i.test(filename) || (bytes[0] === 0x50 && bytes[1] === 0x4b);
  if (zip) {
    const failures: string[] = [];
    const read = [
      () => previewDocument(serializeProjectDocument(importProjectArchiveZip(bytes))),
      () => previewDocument(serializeDesignDraftDocument(importDesignDraftArchiveZip(bytes))),
      () => {
        const archive = importFieldDesignArchiveZip(bytes);
        return { ...previewDocument(serializeFieldDesignDocument(archive.field)),
          ...(archive.originalProjectDocument === undefined ? {} : { originalProjectDocument: archive.originalProjectDocument }) };
      },
    ];
    for (const parse of read) {
      try { return parse(); }
      catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
    }
    throw new Error(`This ZIP is not a valid CPLayout design export. Choose a project, design draft, or field design ZIP exported by CPLayout. Layout targets and Layout sessions have their own Import in Layout. Archive checks: ${failures.map(message => message.slice(0, 220)).join(" | ")}`);
  }
  let document: string;
  try { document = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("This file is not UTF-8 JSON. Choose a CPLayout JSON or ZIP export."); }
  return previewDocument(document);
}

function previewDocument(document: string): CatalogImportPreview {
  let raw: unknown;
  try { raw = parseStrictJson(document); }
  catch (error) { throw new Error(`This file is not valid JSON: ${error instanceof Error ? error.message : String(error)}. Choose a CPLayout JSON or ZIP export.`); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Choose a CPLayout project, design draft, or field design JSON document.");
  const record = raw as Record<string, unknown>;
  const version = record.documentVersion;
  if ((DESIGN_DRAFT_DOCUMENT_VERSIONS as readonly unknown[]).includes(version)) {
    const draft = parseDesignDraftDocument(raw);
    return { kind: "draft", name: draft.name, document, projectCrs: draft.projectCrs,
      boundaryVertices: draft.fieldBoundary.length, machineCount: Object.keys(draft.machine).length ? 1 : 0,
      observationCount: draft.surveyPoints.length };
  }
  if ((FIELD_DESIGN_DOCUMENT_VERSIONS as readonly unknown[]).includes(version)) {
    const field = parseFieldDesignDocument(raw);
    return { kind: "field", name: field.name, document, projectCrs: field.projectCrs,
      boundaryVertices: field.fieldBoundary.length, machineCount: field.machines.length + (field.lateralMachines?.length ?? 0),
      observationCount: field.surveyPoints.length };
  }
  if (version !== undefined && !(PROJECT_DOCUMENT_VERSIONS as readonly unknown[]).includes(version)) {
    throw new Error("This document version is unsupported here. Choose a compatible CPLayout project, draft, or field design export. Import Layout targets and sessions from Layout.");
  }
  // Legacy readers allow extra keys. Editable admission must reject them rather than silently lose evidence.
  const payload = PivotProjectSchema.parse(version === undefined ? raw : record.project);
  assertNoStrippedFields(raw, version === undefined ? payload : { documentVersion: version, project: payload },
    "This project includes unsupported fields. Keep the original file and use a compatible editor.");
  const project = parseProjectDocument(raw);
  return { kind: "project", name: project.name, document: version === undefined ? serializeProjectDocument(project) : document, projectCrs: project.projectCrs,
    boundaryVertices: project.fieldBoundary.length, machineCount: 1, observationCount: project.surveyPoints.length };
}
