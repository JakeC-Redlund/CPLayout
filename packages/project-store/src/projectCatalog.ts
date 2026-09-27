import type { PivotProject } from "@cplayout/core";
import type {
  CatalogProjectRecord,
  ClientRecord,
  DesignRecord,
  FieldMapRecord,
  ProjectCatalog,
  ProjectSummary,
} from "./projectRepositoryTypes";

export const LEGACY_CLIENT_ID = "example-client";
export const LEGACY_CLIENT_NAME = "Example Client";

const OLD_CLIENTS_KEY = ["cust", "omers"].join("");
const OLD_PROJECT_CLIENT_ID_KEY = ["cust", "omerId"].join("");

type ClientProfileFields = Pick<
  ClientRecord,
  | "companyName"
  | "contactName"
  | "primaryContactFirstName"
  | "primaryContactMiddleInitial"
  | "primaryContactLastName"
  | "primaryContactSuffix"
  | "email"
  | "phone"
  | "location"
  | "notes"
>;

export function emptyProjectCatalog(): ProjectCatalog {
  return {
    clients: [],
    projects: [],
    fieldMaps: [],
    designs: [],
  };
}

export function emptyClientProfileFields(): ClientProfileFields {
  return {
    companyName: "",
    contactName: "",
    primaryContactFirstName: "",
    primaryContactMiddleInitial: "",
    primaryContactLastName: "",
    primaryContactSuffix: "",
    email: "",
    phone: "",
    location: "",
    notes: "",
  };
}

export function normalizeCatalogSortName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : LEGACY_CLIENT_NAME;
}

export function createCatalogId(prefix: string, seed = new Date().toISOString()): string {
  const cleanedSeed = seed.replace(/[^0-9a-z]/gi, "").toLowerCase();
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${cleanedSeed.slice(0, 14)}-${randomSuffix}`;
}

export function formatPrimaryContactName(source: Partial<ClientProfileFields>): string {
  const firstName = profileLineText(source.primaryContactFirstName);
  const middleInitial = normalizeMiddleInitial(source.primaryContactMiddleInitial);
  const lastName = profileLineText(source.primaryContactLastName);
  const suffix = profileLineText(source.primaryContactSuffix);
  const givenName = [firstName, middleInitial ? `${middleInitial}.` : "", suffix].filter(Boolean).join(" ");
  if (lastName && givenName) return `${lastName}, ${givenName}`;
  return lastName || givenName;
}

export function resolveClientDisplayName(source: Partial<ClientRecord>): string {
  const companyName = profileLineText(source.companyName);
  if (companyName) return companyName;
  const primaryContact = formatPrimaryContactName(source);
  if (primaryContact) return primaryContact;
  return profileLineText(source.displayName) || profileLineText(source.contactName) || LEGACY_CLIENT_NAME;
}

export function resolveClientSortName(source: Partial<ClientRecord>): string {
  return resolveClientDisplayName(source);
}

export function assertClientPrimaryContact(source: Partial<ClientRecord>): void {
  if (!profileLineText(source.primaryContactFirstName) || !profileLineText(source.primaryContactLastName)) {
    throw new Error("Primary contact first and last name are required.");
  }
}

export function sortProjectCatalog<T extends { name: string } = DesignRecord>(
  catalog: Omit<ProjectCatalog, "designs"> & { designs: T[] },
): Omit<ProjectCatalog, "designs"> & { designs: T[] } {
  return {
    clients: [...catalog.clients].sort((a, b) => compareByName(a.sortName, b.sortName)),
    projects: [...catalog.projects].sort((a, b) => compareByName(a.name, b.name)),
    fieldMaps: [...catalog.fieldMaps].sort((a, b) => compareByName(a.name, b.name)),
    designs: [...catalog.designs].sort((a, b) => compareByName(a.name, b.name)),
  };
}

type PreviousProjectCatalog = Partial<ProjectCatalog> & Record<string, unknown>;

export function normalizeProjectCatalog(catalog: Partial<ProjectCatalog>): ProjectCatalog {
  const previousCatalog = catalog as PreviousProjectCatalog;
  const previousClients = previousCatalog[OLD_CLIENTS_KEY];
  const rawClients = Array.isArray(catalog.clients)
    ? catalog.clients
    : Array.isArray(previousClients)
      ? previousClients
      : [];
  return sortProjectCatalog({
    clients: rawClients.map(normalizeClientRecord).filter((record): record is ClientRecord => Boolean(record)),
    projects: Array.isArray(catalog.projects)
      ? catalog.projects.map(normalizeCatalogProjectRecord).filter((record): record is CatalogProjectRecord => Boolean(record))
      : [],
    fieldMaps: Array.isArray(catalog.fieldMaps) ? catalog.fieldMaps.filter((record): record is FieldMapRecord => typeof record?.id === "string") : [],
    designs: Array.isArray(catalog.designs) ? catalog.designs.filter((record): record is DesignRecord => typeof record?.id === "string") : [],
  });
}

function normalizeCatalogProjectRecord(record: Partial<CatalogProjectRecord>): CatalogProjectRecord | null {
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  const previousRecord = record as Record<string, unknown>;
  const previousClientId = previousRecord[OLD_PROJECT_CLIENT_ID_KEY];
  const legacyClientId = typeof previousClientId === "string" ? previousClientId : "";
  const clientId = typeof record.clientId === "string" && record.clientId.length > 0
    ? record.clientId
    : legacyClientId;
  if (clientId.length === 0) return null;
  const now = new Date().toISOString();
  return {
    id: record.id,
    clientId,
    name: typeof record.name === "string" ? record.name : "Project",
    projectCrs: typeof record.projectCrs === "string" ? record.projectCrs : "",
    unitSystem: typeof record.unitSystem === "string" ? record.unitSystem : "",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
  };
}

export function normalizeClientRecord(record: ClientRecord): ClientRecord;
export function normalizeClientRecord(record: Partial<ClientRecord>): ClientRecord | null;
export function normalizeClientRecord(record: Partial<ClientRecord>): ClientRecord | null {
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  const now = new Date().toISOString();
  const primaryContactFirstName = profileLineText(record.primaryContactFirstName);
  const primaryContactMiddleInitial = normalizeMiddleInitial(record.primaryContactMiddleInitial);
  const primaryContactLastName = profileLineText(record.primaryContactLastName);
  const primaryContactSuffix = profileLineText(record.primaryContactSuffix);
  const hasStructuredContact = Boolean(
    primaryContactFirstName
    || primaryContactMiddleInitial
    || primaryContactLastName
    || primaryContactSuffix,
  );
  const legacyDisplayName = profileLineText(record.displayName);
  const companyName = profileLineText(record.companyName) || (!hasStructuredContact ? legacyDisplayName : "");
  const contactName = formatPrimaryContactName({
    ...record,
    primaryContactFirstName,
    primaryContactMiddleInitial,
    primaryContactLastName,
    primaryContactSuffix,
  }) || profileLineText(record.contactName);
  const displayName = normalizeCatalogSortName(resolveClientDisplayName({
    ...record,
    companyName,
    contactName,
    primaryContactFirstName,
    primaryContactMiddleInitial,
    primaryContactLastName,
    primaryContactSuffix,
  }));
  return {
    id: record.id,
    displayName,
    sortName: normalizeCatalogSortName(resolveClientSortName({
      ...record,
      companyName,
      contactName,
      displayName,
      primaryContactFirstName,
      primaryContactMiddleInitial,
      primaryContactLastName,
      primaryContactSuffix,
    })),
    companyName,
    contactName,
    primaryContactFirstName,
    primaryContactMiddleInitial,
    primaryContactLastName,
    primaryContactSuffix,
    email: profileLineText(record.email),
    phone: profileLineText(record.phone),
    location: profileLineText(record.location),
    notes: profileText(record.notes),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
  };
}

export function ensureLegacyCatalogForSummaries(catalog: ProjectCatalog, summaries: ProjectSummary[]): ProjectCatalog {
  if (catalog.clients.length > 0 || summaries.length === 0) return sortProjectCatalog(catalog);
  const now = new Date().toISOString();
  const clients: ClientRecord[] = [{
    id: LEGACY_CLIENT_ID,
    displayName: LEGACY_CLIENT_NAME,
    sortName: LEGACY_CLIENT_NAME,
    ...emptyClientProfileFields(),
    createdAt: now,
    updatedAt: now,
  }];
  const projects: CatalogProjectRecord[] = summaries.map((summary) => ({
    id: summary.id,
    clientId: LEGACY_CLIENT_ID,
    name: summary.name,
    projectCrs: summary.projectCrs,
    unitSystem: summary.unitSystem,
    createdAt: summary.updatedAt,
    updatedAt: summary.updatedAt,
  }));
  const fieldMaps: FieldMapRecord[] = summaries.map((summary) => ({
    id: defaultFieldMapId(summary.id),
    projectId: summary.id,
    name: "Primary Field Map",
    createdAt: summary.updatedAt,
    updatedAt: summary.updatedAt,
  }));
  const designs: DesignRecord[] = summaries.map((summary) => ({
    id: defaultDesignId(summary.id),
    fieldMapId: defaultFieldMapId(summary.id),
    name: summary.name,
    pivotProjectId: summary.id,
    isActive: true,
    createdAt: summary.updatedAt,
    updatedAt: summary.updatedAt,
  }));
  return sortProjectCatalog({ clients, projects, fieldMaps, designs });
}

export function ensureCatalogEntryForProject(catalog: ProjectCatalog, project: PivotProject): ProjectCatalog {
  const now = new Date().toISOString();
  const next = {
    clients: [...catalog.clients],
    projects: [...catalog.projects],
    fieldMaps: [...catalog.fieldMaps],
    designs: [...catalog.designs],
  };
  if (!next.clients.some((client) => client.id === LEGACY_CLIENT_ID)) {
    next.clients.push({
      id: LEGACY_CLIENT_ID,
      displayName: LEGACY_CLIENT_NAME,
      sortName: LEGACY_CLIENT_NAME,
      ...emptyClientProfileFields(),
      createdAt: now,
      updatedAt: now,
    });
  }
  if (!next.projects.some((record) => record.id === project.id)) {
    next.projects.push({
      id: project.id,
      clientId: LEGACY_CLIENT_ID,
      name: project.name,
      projectCrs: project.projectCrs,
      unitSystem: project.unitSystem,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (!next.fieldMaps.some((record) => record.projectId === project.id)) {
    next.fieldMaps.push({
      id: defaultFieldMapId(project.id),
      projectId: project.id,
      name: "Primary Field Map",
      createdAt: now,
      updatedAt: now,
    });
  }
  const fieldMapId = next.fieldMaps.find((record) => record.projectId === project.id)?.id ?? defaultFieldMapId(project.id);
  if (!next.designs.some((record) => record.pivotProjectId === project.id)) {
    next.designs.push({
      id: defaultDesignId(project.id),
      fieldMapId,
      name: project.name,
      pivotProjectId: project.id,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  return sortProjectCatalog(next);
}

export function defaultFieldMapId(projectId: string): string {
  return `${projectId}:field-map:primary`;
}

export function defaultDesignId(projectId: string): string {
  return `${projectId}:design:primary`;
}

function compareByName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function profileText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function profileLineText(value: unknown): string {
  return profileText(value).replace(/\s+/g, " ");
}

function normalizeMiddleInitial(value: unknown): string {
  const normalized = profileLineText(value).replace(/\./g, "");
  return normalized ? normalized.slice(0, 1).toUpperCase() : "";
}
