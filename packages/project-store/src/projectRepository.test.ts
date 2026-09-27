import assert from "node:assert/strict";

import {
  createProjectEditorState,
  exportProjectGoogleEarthKml,
  reduceProjectEditorState,
  realCenterPivotProofProject,
  sampleProject,
  type PivotProject,
} from "@cplayout/core";
import { evaluateLayout, exportScenarioGeoJson, validateCenterPivotProofGeometry } from "@cplayout/geometry";
import {
  PROJECT_GOOGLE_EARTH_KML_FILENAME,
  PROJECT_JSON_FILENAME,
  buildProjectArchiveBundle,
  exportProjectArchiveZip,
  importProjectArchiveZip,
} from "./projectArchive";
import type {
  CatalogProjectRecord, ClientRecord, CreatedProjectFieldMapWorkspace, CreatedProjectWorkspace,
  DesignRecord, FieldMapRecord, ProjectRepository,
} from "./projectRepositoryTypes";
import { createVersionedProjectRepository } from "./versionedProjectRepository";
import { WEB_WORKSPACE_LOCK, type WorkspaceLocks } from "./webWorkspaceStore";
import type { WorkspaceCommand } from "./workspaceCommands";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

// Synthetic cooperative serialization only; browser lock behavior has separate proof gates.
class SerialLocks implements WorkspaceLocks {
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(name: string, options: { mode: "exclusive" }, callback: () => T | PromiseLike<T>): Promise<T> {
    assert.equal(name, WEB_WORKSPACE_LOCK);
    assert.equal(options.mode, "exclusive");
    const result = this.tail.then(callback);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

const storage = new MemoryStorage();
const locks = new SerialLocks();
const versionedRepository = createVersionedProjectRepository({ getStorage: () => storage, getLocks: () => locks });
const versionedWorkspace = versionedRepository.versionedWorkspace!;
const now = "2026-09-17T00:00:00.000Z";
let identitySequence = 0;
const fixtureId = (prefix: string) => `${prefix}-geometry-test-${++identitySequence}`;

async function sequentialCommand<T>(command: WorkspaceCommand): Promise<T> {
  const snapshot = await versionedWorkspace.readAsync();
  const receipt = await versionedWorkspace.executeAsync(snapshot.revision, command);
  assert.equal(receipt.workspace.revision, snapshot.revision + 1);
  return receipt.value as T;
}

// Test-only facade for sequential geometry scenarios. Stale-editor and atomicity tests use explicit revisions elsewhere.
function sequentialGeometryRepository(): ProjectRepository {
  return {
    ...versionedRepository,
    async saveProjectAsync(project, result) {
      const snapshot = await versionedWorkspace.readAsync();
      const receipt = await versionedWorkspace.executeAsync(snapshot.revision, {
        type: "save_project", now, project, result,
        createOnly: !snapshot.projectDocuments.some(entry => entry.summary.id === project.id),
      });
      assert.equal(receipt.workspace.revision, snapshot.revision + 1);
    },
    saveDesignProjectAsync: (designId, project, result) => sequentialCommand<void>({ type: "save_design_project", now, designId, project, result }),
    deleteProjectAsync: projectId => sequentialCommand<void>({ type: "delete_project", now, projectId }),
    createClientAsync: input => sequentialCommand<ClientRecord>({ type: "create_client", now, id: fixtureId("client"), input }),
    updateClientAsync: input => sequentialCommand<ClientRecord>({ type: "update_client", now, input }),
    deleteClientAsync: clientId => sequentialCommand<void>({ type: "delete_client", now, clientId }),
    createProjectWithInitialDesignAsync: input => sequentialCommand<CreatedProjectWorkspace>({ type: "create_project_with_initial_design", now, input }),
    createProjectWithInitialFieldMapAsync: input => sequentialCommand<CreatedProjectFieldMapWorkspace>({
      type: "create_project_with_initial_field_map", now, input: { ...input, projectId: input.projectId ?? fixtureId("project") },
    }),
    createProjectRecordAsync: input => sequentialCommand<CatalogProjectRecord>({
      type: "create_project_record", now, input: { ...input, id: input.id ?? fixtureId("project") },
    }),
    renameProjectAsync: (projectId, name) => sequentialCommand<CatalogProjectRecord>({ type: "rename_project", now, projectId, name }),
    moveProjectToClientAsync: (projectId, clientId) => sequentialCommand<CatalogProjectRecord>({ type: "move_project_to_client", now, projectId, clientId }),
    createFieldMapRecordAsync: input => sequentialCommand<FieldMapRecord>({
      type: "create_field_map_record", now, input: { ...input, id: input.id ?? fixtureId("field-map") },
    }),
    createDesignRecordAsync: input => sequentialCommand<DesignRecord>({
      type: "create_design_record", now, input: { ...input, id: input.id ?? fixtureId("design") },
    }),
  };
}

const projectRepository = sequentialGeometryRepository();

const CATALOG_STORAGE_KEY = "center-pivot-layout-project-catalog-v1";
const oldClientsKey = ["cust", "omers"].join("");
const oldProjectClientIdKey = ["cust", "omerId"].join("");

async function run(): Promise<void> {
  storage.clear();

  const legacyCatalogRaw = JSON.stringify({
    [oldClientsKey]: [{
      id: "legacy-profile-client",
      displayName: "Legacy Profile Client",
      sortName: "Legacy Profile Client",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    }],
    projects: [{
      id: "legacy-profile-project",
      [oldProjectClientIdKey]: "legacy-profile-client",
      name: "Legacy Profile Project",
      projectCrs: sampleProject.projectCrs,
      unitSystem: sampleProject.unitSystem,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    }],
    fieldMaps: [],
    designs: [],
  });
  storage.setItem(CATALOG_STORAGE_KEY, legacyCatalogRaw);
  const backfilledCatalog = await projectRepository.listProjectCatalogAsync();
  assert.equal(backfilledCatalog.clients[0]?.companyName, "");
  assert.equal(backfilledCatalog.projects[0]?.clientId, "legacy-profile-client");
  assert.equal(backfilledCatalog.clients[0]?.contactName, "");
  assert.equal(backfilledCatalog.clients[0]?.primaryContactFirstName, "");
  assert.equal(backfilledCatalog.clients[0]?.primaryContactLastName, "");
  assert.equal(backfilledCatalog.clients[0]?.email, "");
  assert.equal(storage.getItem(CATALOG_STORAGE_KEY), legacyCatalogRaw);

  storage.clear();
  const profileClient = await projectRepository.createClientAsync({
    companyName: "Profile Farms",
    primaryContactFirstName: "Ana",
    primaryContactMiddleInitial: "J",
    primaryContactLastName: "Operator",
    primaryContactSuffix: "Jr.",
    email: "ana@example.test",
    phone: "555-0100",
    location: "Adams County",
    notes: "Local-only client profile.",
  });
  assert.equal(profileClient.companyName, "Profile Farms");
  assert.equal(profileClient.displayName, "Profile Farms");
  assert.equal(profileClient.contactName, "Operator, Ana J. Jr.");
  const updatedProfileClient = await projectRepository.updateClientAsync({
    id: profileClient.id,
    companyName: "Profile Farms LLC",
    phone: "555-0199",
    notes: "",
  });
  assert.equal(updatedProfileClient.displayName, "Profile Farms LLC");
  assert.equal(updatedProfileClient.phone, "555-0199");
  assert.equal(updatedProfileClient.email, "ana@example.test");
  await projectRepository.deleteClientAsync(profileClient.id);
  assert.equal((await projectRepository.listProjectCatalogAsync()).clients.some((client) => client.id === profileClient.id), false);

  const sourceClient = await projectRepository.createClientAsync({
    companyName: "Source Farms",
    primaryContactFirstName: "Sam",
    primaryContactLastName: "Source",
  });
  const targetClient = await projectRepository.createClientAsync({
    companyName: "Target Farms",
    primaryContactFirstName: "Tara",
    primaryContactLastName: "Target",
  });
  const catalogOnlyWorkspace = await projectRepository.createProjectWithInitialFieldMapAsync({
    clientId: sourceClient.id,
    projectId: "catalog-only-project",
    projectName: "Catalog Only Project",
    projectCrs: sampleProject.projectCrs,
    unitSystem: sampleProject.unitSystem,
    fieldMapId: "catalog-only-project:field-map:primary",
    fieldMapName: "Primary Field Map",
  });
  assert.equal(catalogOnlyWorkspace.projectRecord.clientId, sourceClient.id);
  assert.equal(catalogOnlyWorkspace.fieldMap.projectId, "catalog-only-project");
  let catalogOnlyCatalog = await projectRepository.listProjectCatalogAsync();
  assert.equal(catalogOnlyCatalog.projects.some((record) => record.id === "catalog-only-project"), true);
  assert.equal(catalogOnlyCatalog.fieldMaps.filter((record) => record.projectId === "catalog-only-project").length, 1);
  assert.equal(catalogOnlyCatalog.designs.filter((record) => record.fieldMapId === catalogOnlyWorkspace.fieldMap.id).length, 0);
  assert.equal(await projectRepository.loadProjectAsync("catalog-only-project"), null);
  await assert.rejects(
    () => projectRepository.createDesignRecordAsync({
      fieldMapId: catalogOnlyWorkspace.fieldMap.id,
      name: "Missing Design Document",
      pivotProjectId: "missing-design-project",
    }),
    /Saved project document is required/,
  );
  const importedDesignProject: PivotProject = {
    ...sampleProject,
    id: "catalog-only-imported-design",
    name: "Catalog Only Imported Design",
  };
  await projectRepository.saveProjectAsync(importedDesignProject, evaluateLayout(importedDesignProject));
  const explicitDesign = await projectRepository.createDesignRecordAsync({
    fieldMapId: catalogOnlyWorkspace.fieldMap.id,
    name: "Imported Design",
    pivotProjectId: importedDesignProject.id,
  });
  assert.equal(explicitDesign.pivotProjectId, importedDesignProject.id);
  assert.equal((await projectRepository.loadDesignProjectAsync(explicitDesign.id))?.id, importedDesignProject.id);
  await assert.rejects(
    () => projectRepository.createDesignRecordAsync({
      fieldMapId: catalogOnlyWorkspace.fieldMap.id,
      name: "Duplicate Ownership",
      pivotProjectId: importedDesignProject.id,
    }),
    /already has an owning design/,
  );
  await projectRepository.deleteProjectAsync("catalog-only-project");
  catalogOnlyCatalog = await projectRepository.listProjectCatalogAsync();
  assert.equal(catalogOnlyCatalog.projects.some((record) => record.id === "catalog-only-project"), false);
  assert.equal(catalogOnlyCatalog.designs.some((record) => record.pivotProjectId === importedDesignProject.id), false);

  const managedProject: PivotProject = {
    ...sampleProject,
    id: "managed-client-project",
    name: "Managed Client Project",
  };
  const createdWorkspace = await projectRepository.createProjectWithInitialDesignAsync({
    clientId: sourceClient.id,
    project: managedProject,
    result: evaluateLayout(managedProject),
  });
  assert.equal(createdWorkspace.projectRecord.clientId, sourceClient.id);
  assert.equal(createdWorkspace.fieldMap.projectId, managedProject.id);
  assert.equal(createdWorkspace.design.pivotProjectId, managedProject.id);
  await assert.rejects(
    () => projectRepository.deleteClientAsync(sourceClient.id),
    /still contains projects/,
  );
  const renamedProject = await projectRepository.renameProjectAsync(managedProject.id, "Renamed Managed Project");
  assert.equal(renamedProject.name, "Renamed Managed Project");
  const renamedReloaded = await projectRepository.loadProjectAsync(managedProject.id);
  assert.ok(renamedReloaded);
  assert.equal(renamedReloaded?.name, managedProject.name);
  assert.deepEqual(renamedReloaded?.fieldBoundary, managedProject.fieldBoundary);
  const movedProjectRecord = await projectRepository.moveProjectToClientAsync(managedProject.id, targetClient.id);
  assert.equal(movedProjectRecord.clientId, targetClient.id);
  const movedCatalog = await projectRepository.listProjectCatalogAsync();
  assert.equal(movedCatalog.projects.find((record) => record.id === managedProject.id)?.clientId, targetClient.id);
  assert.equal(movedCatalog.fieldMaps.filter((record) => record.projectId === managedProject.id).length, 1);
  assert.equal(movedCatalog.designs.filter((record) => record.pivotProjectId === managedProject.id).length, 1);
  const profileArchiveBundle = buildProjectArchiveBundle(
    renamedReloaded,
    evaluateLayout(renamedReloaded),
    exportScenarioGeoJson(renamedReloaded, evaluateLayout(renamedReloaded)),
    "2026-06-01T12:00:00.000Z",
  );
  assert.doesNotMatch(profileArchiveBundle.files[PROJECT_JSON_FILENAME], /Operator, Ana J\. Jr\.|Profile Farms|Source Farms|Target Farms/);
  await projectRepository.deleteProjectAsync(managedProject.id);
  const afterManagedDelete = await projectRepository.listProjectCatalogAsync();
  assert.equal(afterManagedDelete.projects.some((record) => record.id === managedProject.id), false);
  assert.equal(afterManagedDelete.fieldMaps.some((record) => record.projectId === managedProject.id), false);
  assert.equal(afterManagedDelete.designs.some((record) => record.pivotProjectId === managedProject.id), false);
  await projectRepository.deleteClientAsync(sourceClient.id);
  await projectRepository.deleteClientAsync(targetClient.id);

  storage.clear();
  const editedProject = buildEditedProjectFromEditorActions();
  await projectRepository.saveProjectAsync(editedProject, evaluateLayout(editedProject));
  const summaries = await projectRepository.listProjectsAsync();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.id, editedProject.id);
  const unownedCatalog = await projectRepository.listProjectCatalogAsync();
  assert.deepEqual(unownedCatalog, { clients: [], projects: [], fieldMaps: [], designs: [] });
  const unownedWorkspace = await versionedWorkspace.readAsync();
  assert.equal(unownedWorkspace.projectDocuments[0]?.summary.id, editedProject.id);
  assert.equal(unownedWorkspace.catalog.designs.length, 0);

  const reloaded = await projectRepository.loadProjectAsync(editedProject.id);
  assert.ok(reloaded);
  assert.deepEqual(reloaded.fieldBoundary, editedProject.fieldBoundary);
  assert.deepEqual(
    reloaded.obstacles.find((obstacle) => obstacle.id === "iteration-5-obstacle-proof")?.polygon,
    editedProject.obstacles.find((obstacle) => obstacle.id === "iteration-5-obstacle-proof")?.polygon,
  );
  assert.equal(reloaded.obstacles.find((obstacle) => obstacle.id === "iteration-5-obstacle-proof")?.name, "Iteration 5 obstacle proof");
  assert.deepEqual(reloaded.mapFeatures, editedProject.mapFeatures);

  const result = evaluateLayout(reloaded);
  const archiveBundle = buildProjectArchiveBundle(reloaded, result, exportScenarioGeoJson(reloaded, result), "2026-05-28T12:00:00.000Z");
  assert.match(archiveBundle.files[PROJECT_JSON_FILENAME], /Browser Editor Workflow Proof/);
  assert.match(archiveBundle.files[PROJECT_JSON_FILENAME], /Iteration 5 utility line/);
  assert.match(archiveBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /Iteration 5 obstacle proof/);
  assert.match(archiveBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /Iteration 5 utility line/);
  const archiveRoundTrip = importProjectArchiveZip(exportProjectArchiveZip(archiveBundle));
  assert.deepEqual(archiveRoundTrip.fieldBoundary, editedProject.fieldBoundary);
  assert.deepEqual(
    archiveRoundTrip.obstacles.find((obstacle) => obstacle.id === "iteration-5-obstacle-proof")?.polygon,
    editedProject.obstacles.find((obstacle) => obstacle.id === "iteration-5-obstacle-proof")?.polygon,
  );
  assert.deepEqual(archiveRoundTrip.mapFeatures, editedProject.mapFeatures);

  const kml = exportProjectGoogleEarthKml(reloaded, result);
  assert.match(kml.kml, /Iteration 5 obstacle proof/);
  assert.match(kml.kml, /Iteration 5 utility line/);
  assert.match(kml.kml, /iteration-5-utility-line/);
  assert.ok(kml.exportedFeatureCount >= reloaded.obstacles.length + (reloaded.mapFeatures?.length ?? 0) + 4);

  const proofResult = evaluateLayout(realCenterPivotProofProject);
  assert.deepEqual(validateCenterPivotProofGeometry(realCenterPivotProofProject, proofResult), []);
  await projectRepository.saveProjectAsync(realCenterPivotProofProject, proofResult);
  const proofReloaded = await projectRepository.loadProjectAsync(realCenterPivotProofProject.id);
  assert.ok(proofReloaded);
  assert.equal(proofReloaded.fieldBoundary.length, realCenterPivotProofProject.fieldBoundary.length);
  assert.equal(proofReloaded.obstacles.length, realCenterPivotProofProject.obstacles.length);
  assert.deepEqual(validateCenterPivotProofGeometry(proofReloaded, evaluateLayout(proofReloaded)), []);
  const proofBundle = buildProjectArchiveBundle(
    proofReloaded,
    evaluateLayout(proofReloaded),
    exportScenarioGeoJson(proofReloaded, evaluateLayout(proofReloaded)),
    "2026-05-29T12:00:00.000Z",
  );
  assert.match(proofBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /Base pivot wet circle/);
  assert.match(proofBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /Allowed irrigated coverage/);
  assert.match(proofBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /Public proof pivot center/);

  const clientB = await projectRepository.createClientAsync({
    companyName: "Zephyr Farms",
    primaryContactFirstName: "Zane",
    primaryContactLastName: "Zephyr",
  });
  const clientA = await projectRepository.createClientAsync({
    companyName: "Adams Irrigation",
    primaryContactFirstName: "Ada",
    primaryContactLastName: "Adams",
  });
  const catalog = await projectRepository.listProjectCatalogAsync();
  assert.deepEqual(
    catalog.clients.map((client) => client.displayName).slice(0, 2),
    ["Adams Irrigation", "Zephyr Farms"],
  );
  const projectRecord = await projectRepository.createProjectRecordAsync({
    clientId: clientA.id,
    id: "adams-catalog-project",
    name: "Adams North Unit",
    projectCrs: editedProject.projectCrs,
    unitSystem: editedProject.unitSystem,
  });
  const fieldMap = await projectRepository.createFieldMapRecordAsync({
    id: "adams-north-field-map",
    projectId: projectRecord.id,
    name: "North Quarter",
  });
  const design = await projectRepository.createDesignRecordAsync({
    id: "adams-north-design",
    fieldMapId: fieldMap.id,
    name: "Base Pivot",
    pivotProjectId: editedProject.id,
  });
  await projectRepository.saveDesignProjectAsync(design.id, { ...editedProject, name: "Adams North Base Pivot" }, evaluateLayout(editedProject));
  const designReloaded = await projectRepository.loadDesignProjectAsync(design.id);
  assert.ok(designReloaded);
  assert.equal(designReloaded.name, "Adams North Base Pivot");
  assert.ok(clientB.id.startsWith("client-"));

  storage.clear();
  const stressClient = await projectRepository.createClientAsync({
    companyName: "Stress Proof Farms",
    primaryContactFirstName: "Scale",
    primaryContactLastName: "Operator",
    notes: "Catalog profile data must stay out of project archive payloads.",
  });
  const stressProject = buildLargeStressProject();
  const stressResult = evaluateLayout(stressProject);
  await projectRepository.createProjectWithInitialDesignAsync({
    clientId: stressClient.id,
    project: stressProject,
    result: stressResult,
  });
  for (let index = 0; index < 30; index += 1) {
    const catalogProject = await projectRepository.createProjectRecordAsync({
      clientId: stressClient.id,
      id: `stress-catalog-project-${index.toString().padStart(2, "0")}`,
      name: `Stress Catalog Project ${index.toString().padStart(2, "0")}`,
      projectCrs: stressProject.projectCrs,
      unitSystem: stressProject.unitSystem,
    });
    await projectRepository.createFieldMapRecordAsync({
      id: `${catalogProject.id}:field-map`,
      projectId: catalogProject.id,
      name: "Primary Field Map",
    });
  }
  const stressCatalog = await projectRepository.listProjectCatalogAsync();
  assert.equal(stressCatalog.clients.length, 1);
  assert.equal(stressCatalog.projects.length, 31);
  assert.equal(stressCatalog.fieldMaps.length, 31);
  assert.equal(stressCatalog.designs.length, 1);
  const stressReloaded = await projectRepository.loadProjectAsync(stressProject.id);
  assert.ok(stressReloaded);
  assert.equal(stressReloaded.fieldBoundary.length, stressProject.fieldBoundary.length);
  assert.equal(stressReloaded.obstacles.length, stressProject.obstacles.length);
  assert.equal(stressReloaded.surveyPoints.length, stressProject.surveyPoints.length);
  assert.equal(stressReloaded.mapFeatures?.length, stressProject.mapFeatures?.length);
  assert.deepEqual(stressReloaded.pivotCenter, stressProject.pivotCenter);
  assert.equal(stressReloaded.wgs84Companion?.status, "projected");
  assert.equal(stressReloaded.wgs84Companion?.mapFeatures?.length, stressProject.mapFeatures?.length);

  const stressBundle = buildProjectArchiveBundle(
    stressReloaded,
    evaluateLayout(stressReloaded),
    exportScenarioGeoJson(stressReloaded, evaluateLayout(stressReloaded)),
    "2026-06-06T12:00:00.000Z",
  );
  assert.match(stressBundle.files[PROJECT_JSON_FILENAME], /large-project-stress-proof/);
  assert.match(stressBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /Stress line feature 079/);
  assert.doesNotMatch(stressBundle.files[PROJECT_JSON_FILENAME], /Stress Proof Farms|Scale Operator|Catalog profile data/);
  assert.doesNotMatch(stressBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /Stress Proof Farms|Scale Operator|Catalog profile data/);
  const stressRoundTrip = importProjectArchiveZip(exportProjectArchiveZip(stressBundle));
  assert.equal(stressRoundTrip.fieldBoundary.length, stressProject.fieldBoundary.length);
  assert.equal(stressRoundTrip.obstacles.length, stressProject.obstacles.length);
  assert.equal(stressRoundTrip.surveyPoints.length, stressProject.surveyPoints.length);
  assert.equal(stressRoundTrip.mapFeatures?.length, stressProject.mapFeatures?.length);
  assert.deepEqual(stressRoundTrip.pivotCenter, stressProject.pivotCenter);

  console.log("versioned project repository saveable geometry tests passed");
}

function buildLargeStressProject(): PivotProject {
  const stressObservedAt = "2026-06-06T12:00:00.000Z";
  const center = { x: 501200, y: 4506600 };
  const fieldBoundary = regularRing(center, 620, 96);
  return {
    ...sampleProject,
    id: "large-project-stress-proof",
    name: "Large Project Stress Proof",
    fieldBoundary,
    pivotCenter: center,
    waterSource: { x: center.x - 42, y: center.y - 28 },
    powerSource: { x: center.x - 520, y: center.y + 430 },
    machine: {
      ...sampleProject.machine,
      id: "large-stress-machine",
      name: "Large stress full-circle machine",
      spanLengthsMeters: [48, 48, 48, 48, 48, 48],
      overhangMeters: 18,
      endGunThrowMeters: 20,
      towerClearanceBufferMeters: 6,
      machineClearanceBufferMeters: 10,
      sweep: { mode: "full_circle" },
    },
    obstacles: Array.from({ length: 24 }, (_, index) => {
      const column = index % 6;
      const row = Math.floor(index / 6);
      const x = center.x - 420 + column * 150;
      const y = center.y - 300 + row * 150;
      return {
        id: `stress-obstacle-${index.toString().padStart(2, "0")}`,
        name: `Stress obstacle ${index.toString().padStart(2, "0")}`,
        kind: index % 5 === 0 ? "building" as const : index % 3 === 0 ? "road" as const : "exclusion" as const,
        polygon: rectangle(x, y, 26 + (index % 4) * 3, 22 + (index % 5) * 2),
        bufferMeters: 4 + (index % 4),
        hardConflict: index % 4 === 0,
        noSpray: index % 3 === 0,
        confidence: index % 2 === 0 ? "imagery_digitized" as const : "user_estimated" as const,
      };
    }),
    surveyPoints: [
      {
        id: "stress-pivot-rtk",
        label: "Stress pivot RTK check",
        role: "pivot_center",
        projected: center,
        observedAt: stressObservedAt,
        source: "external_gnss",
        confidence: "rtk_fixed",
        rtk: {
          fixType: "rtk_fixed",
          satellites: 18,
          hdop: 0.7,
          vdop: 0.9,
          pdop: 1.2,
          correctionAgeSeconds: 1,
          horizontalAccuracyMeters: 0.02,
          verticalAccuracyMeters: 0.04,
          baseStationId: "BASE-STRESS",
          roverId: "ROVER-STRESS",
          nmeaQualityCode: 4,
        },
      },
      ...fieldBoundary.map((point, index) => ({
        id: `stress-boundary-shot-${index.toString().padStart(2, "0")}`,
        label: `Stress boundary shot ${index.toString().padStart(2, "0")}`,
        role: "boundary" as const,
        projected: point,
        observedAt: stressObservedAt,
        source: "manual" as const,
        confidence: "imagery_digitized" as const,
      })),
    ],
    mapFeatures: [
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `stress-machine-zone-${index.toString().padStart(2, "0")}`,
        name: `Stress machine zone ${index.toString().padStart(2, "0")}`,
        kind: "machine_zone" as const,
        geometry: {
          type: "Circle" as const,
          center: pointOnRing(center, 220 + (index % 3) * 35, index * 30),
          radiusMeters: 120 + (index % 4) * 8,
        },
        confidence: "optimized" as const,
        notes: "Generated advisory stress review zone; not a saved pivot.",
        properties: {
          advisoryOnly: true,
          canonicalGeometryMutation: false,
          qualifiedReviewRequired: true,
          stressSequence: index + 1,
        },
      })),
      ...Array.from({ length: 80 }, (_, index) => ({
        id: `stress-line-feature-${index.toString().padStart(3, "0")}`,
        name: `Stress line feature ${index.toString().padStart(3, "0")}`,
        kind: index % 4 === 0 ? "underground_pipeline" as const : index % 4 === 1 ? "underground_wire" as const : index % 4 === 2 ? "power_line" as const : "measurement_line" as const,
        geometry: {
          type: "LineString" as const,
          vertices: [
            pointOnRing(center, 520, index * 11),
            pointOnRing(center, 430, index * 11 + 12),
            pointOnRing(center, 350, index * 11 + 24),
          ],
        },
        confidence: "user_estimated" as const,
        notes: "Synthetic projected-XY stress feature.",
      })),
    ],
    mapPackages: [],
    wgs84Companion: undefined,
  };
}

function regularRing(center: { x: number; y: number }, radiusMeters: number, count: number): Array<{ x: number; y: number }> {
  return Array.from({ length: count }, (_, index) => pointOnRing(center, radiusMeters + (index % 4) * 8, (index / count) * 360));
}

function pointOnRing(center: { x: number; y: number }, radiusMeters: number, angleDegrees: number): { x: number; y: number } {
  const radians = angleDegrees * Math.PI / 180;
  return {
    x: Math.round((center.x + Math.cos(radians) * radiusMeters) * 1000) / 1000,
    y: Math.round((center.y + Math.sin(radians) * radiusMeters) * 1000) / 1000,
  };
}

function rectangle(x: number, y: number, width: number, height: number): Array<{ x: number; y: number }> {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

function buildEditedProjectFromEditorActions(): PivotProject {
  let state = createProjectEditorState({
    ...sampleProject,
    id: "browser-editor-workflow-proof",
    name: "Browser Editor Workflow Proof",
  });
  const boundaryDraft = [
    { x: 500980, y: 4506190 },
    { x: 501360, y: 4506170 },
    { x: 501420, y: 4506520 },
    { x: 501160, y: 4506810 },
    { x: 500940, y: 4506570 },
  ];
  state = reduceProjectEditorState(state, { type: "commit_boundary_draft", vertices: boundaryDraft });
  assert.equal(state.lastError, null);
  assert.deepEqual(state.project.fieldBoundary, boundaryDraft);

  state = reduceProjectEditorState(state, {
    type: "move_boundary_vertex",
    vertexIndex: 0,
    point: { x: 500970, y: 4506205 },
  });
  state = reduceProjectEditorState(state, { type: "delete_boundary_vertex", vertexIndex: 4 });
  assert.equal(state.project.fieldBoundary.length, 4);

  state = reduceProjectEditorState(state, {
    type: "commit_obstacle_draft",
    id: "iteration-5-obstacle-proof",
    kind: "exclusion",
    name: "Iteration 5 obstacle proof",
    vertices: [
      { x: 501060, y: 4506320 },
      { x: 501150, y: 4506330 },
      { x: 501150, y: 4506410 },
      { x: 501060, y: 4506410 },
    ],
  });
  state = reduceProjectEditorState(state, {
    type: "move_obstacle_vertex",
    obstacleId: "iteration-5-obstacle-proof",
    vertexIndex: 1,
    point: { x: 501170, y: 4506345 },
  });
  state = reduceProjectEditorState(state, {
    type: "delete_obstacle_vertex",
    obstacleId: "iteration-5-obstacle-proof",
    vertexIndex: 3,
  });
  assert.equal(state.project.obstacles.find((obstacle) => obstacle.id === "iteration-5-obstacle-proof")?.polygon.length, 3);

  const afterVertexDelete = state.project;
  state = reduceProjectEditorState(state, { type: "undo" });
  assert.equal(state.project.obstacles.find((obstacle) => obstacle.id === "iteration-5-obstacle-proof")?.polygon.length, 4);
  state = reduceProjectEditorState(state, { type: "redo" });
  assert.deepEqual(state.project, afterVertexDelete);

  state = reduceProjectEditorState(state, {
    type: "add_map_feature",
    feature: {
      id: "iteration-5-utility-line",
      name: "Iteration 5 utility line",
      kind: "power_line",
      geometry: {
        type: "LineString",
        vertices: [
          { x: sampleProject.powerSource.x + 12, y: sampleProject.powerSource.y - 18 },
          { x: sampleProject.pivotCenter.x - 22, y: sampleProject.pivotCenter.y + 16 },
        ],
      },
      confidence: "user_estimated",
      notes: "Browser editor save/reopen/export proof feature.",
    },
  });
  assert.equal(state.project.mapFeatures?.some((feature) => feature.id === "iteration-5-utility-line"), true);
  state = reduceProjectEditorState(state, { type: "undo" });
  assert.equal(state.project.mapFeatures?.some((feature) => feature.id === "iteration-5-utility-line"), false);
  state = reduceProjectEditorState(state, { type: "redo" });
  assert.equal(state.project.mapFeatures?.some((feature) => feature.id === "iteration-5-utility-line"), true);

  return state.project;
}

run().catch((error: unknown) => {
  throw error;
});
