import { z } from "zod";
import { emptyClientProfileFields } from "./projectCatalog";
import { parseStrictJson } from "./strictJson";
import { emptyWorkspaceDocument, validateWorkspaceDocument, WorkspaceDocumentError, type WorkspaceDocument } from "./workspaceDocument";

export interface LegacyWorkspaceSources {
  projectsRaw: string | null;
  catalogRaw: string | null;
}

// Preserve every parsed key; z.record omits __proto__, which would silently lose a stored identity.
const record = z.custom<Record<string, unknown>>(value => value !== null && typeof value === "object" && !Array.isArray(value));
const legacyCatalog = z.object({
  clients: z.array(record).optional(),
  customers: z.array(record).optional(),
  projects: z.array(record), fieldMaps: z.array(record), designs: z.array(record),
}).strict();
const storedProject = z.object({ summary: record, document: z.string() }).strict();

/** Pure migration. Original strings are backup material; payload strings are never rewritten. */
export function migrateLegacyWorkspace(sources: LegacyWorkspaceSources): WorkspaceDocument {
  try {
    const next = emptyWorkspaceDocument();
    const projects = sources.projectsRaw === null ? {} : record.parse(parseStrictJson(sources.projectsRaw));
    const projectDocuments = Object.entries(projects).map(([key, raw]) => {
      const metadata = record.parse(raw);
      if (Object.keys(metadata).some(key => !Object.hasOwn(storedProject.shape, key))) {
        throw new WorkspaceDocumentError("invalid_document", "Legacy stored project contains unsupported metadata.");
      }
      const entry = storedProject.parse(raw);
      if (entry.summary.id !== key) throw new WorkspaceDocumentError("identity_mismatch", "Legacy project key differs from its stored identity.");
      return entry;
    });
    if (sources.catalogRaw === null) return validateWorkspaceDocument({ ...next, projectDocuments });
    const rawCatalog = record.parse(parseStrictJson(sources.catalogRaw));
    if (Object.keys(rawCatalog).some(key => !Object.hasOwn(legacyCatalog.shape, key))) {
      throw new WorkspaceDocumentError("invalid_document", "Legacy catalog contains unsupported metadata.");
    }
    const catalog = legacyCatalog.parse(rawCatalog);
    if ((catalog.clients === undefined) === (catalog.customers === undefined)) {
      throw new WorkspaceDocumentError("invalid_document", "Legacy catalog must contain exactly one supported client collection.");
    }
    const clients = (catalog.clients ?? catalog.customers)!.map(client => ({ ...emptyClientProfileFields(), ...client }));
    const folders = catalog.projects.map(project => {
      const { customerId, ...rest } = project;
      if (customerId === undefined) return rest;
      if (Object.hasOwn(rest, "clientId")) throw new WorkspaceDocumentError("identity_mismatch", "Legacy project contains ambiguous client identities.");
      return { ...rest, clientId: customerId };
    });
    const designs = catalog.designs.map(design => {
      if (["kind", "revision", "draftId"].some(key => Object.hasOwn(design, key))) {
        throw new WorkspaceDocumentError("unsupported_version", "Legacy catalog contains newer design fields; preserve it for recovery.");
      }
      return { ...design, kind: "project", revision: 0 };
    });
    return validateWorkspaceDocument({ ...next, projectDocuments, catalog: { clients, projects: folders, fieldMaps: catalog.fieldMaps, designs } });
  } catch (error) {
    if (error instanceof WorkspaceDocumentError) throw error;
    throw new WorkspaceDocumentError("invalid_document", "Legacy workspace is invalid; no data was migrated. Preserve both original storage values for recovery.");
  }
}
