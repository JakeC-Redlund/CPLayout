import { strFromU8, unzipSync } from "fflate";

import {
  defaultProjectSettings,
  sampleProject,
  type MapPackageManifest,
  type PivotProject,
} from "@cplayout/core";
import { evaluateLayout, exportScenarioGeoJson } from "@cplayout/geometry";
import {
  ANDROID_NATIVE_REQUIRED_ABSENT_TABLES,
  ANDROID_NATIVE_REQUIRED_MAP_PACKAGE_COLUMNS,
  ANDROID_NATIVE_REQUIRED_MIGRATIONS,
  ANDROID_NATIVE_REQUIRED_SQLITE_VERSION,
  createAndroidNativeInProcessProof,
  type AndroidNativeInProcessObservations,
  type AndroidNativeVerificationReport,
} from "./nativeVerification";
import {
  buildProjectArchiveBundle,
  exportProjectArchiveZip,
  importProjectArchiveZip,
  PROJECT_JSON_FILENAME,
  PROJECT_MANIFEST_FILENAME,
} from "./projectArchive";
import { projectRepository } from "./projectRepository.native";
import { openProjectDatabaseAsync } from "./sqliteProjectStore";

export type AndroidNativeInAppProofPayload = ReturnType<typeof createAndroidNativeInProcessProof>;

const PROOF_PROJECT_ID = `cplayout-android-native-schema-v${ANDROID_NATIVE_REQUIRED_SQLITE_VERSION}-proof`;
const PROOF_PROJECT_NAME = `CPLayout Android Native Schema v${ANDROID_NATIVE_REQUIRED_SQLITE_VERSION} Proof`;

export async function runAndroidNativeProofRuntimeAsync(): Promise<AndroidNativeInAppProofPayload> {
  const generatedAt = new Date().toISOString();
  const observations: AndroidNativeInProcessObservations = { generatedAt };
  try {
    await projectRepository.deleteProjectAsync(PROOF_PROJECT_ID);

    const project = createProofProject(generatedAt);
    const result = evaluateLayout(project);
    await projectRepository.saveProjectAsync(project, result);

    const [backendInfo, projects, loadedProject] = await Promise.all([
      projectRepository.getBackendInfoAsync(),
      projectRepository.listProjectsAsync(),
      projectRepository.loadProjectAsync(project.id),
    ]);
    observations.projectRoundTrip = {
      backendLabel: backendInfo.backendLabel,
      runtime: backendInfo.runtime,
      sampleProjectSaved: projects.some((summary) => summary.id === project.id),
      loadedProjectId: loadedProject?.id ?? "",
      loadedProjectName: loadedProject?.name ?? "",
      fieldBoundaryPointCount: loadedProject?.fieldBoundary.length ?? 0,
      obstacleCount: loadedProject?.obstacles.length ?? 0,
      surveyPointCount: loadedProject?.surveyPoints.length ?? 0,
      settingsMatched: Boolean(loadedProject) && JSON.stringify(loadedProject?.settings ?? null) === JSON.stringify(project.settings ?? null),
      deleteConfirmed: false,
    };
    if (!loadedProject) throw new Error("Saved proof project could not be loaded from native SQLite.");

    observations.sqlite = await collectSqliteProof(project.id);
    const archiveProof = await runArchiveProof(project, generatedAt);
    observations.zipRoundTrip = {
      exportedFilename: archiveProof.exportedFilename,
      exportedBytes: archiveProof.exportedBytes,
      exportedSha256: archiveProof.exportedSha256,
      importedProjectId: archiveProof.importedProject.id,
      manifestJsonPresent: archiveProof.manifestJsonPresent,
      projectJsonPresent: archiveProof.projectJsonPresent,
      manifestProjectIdMatched: archiveProof.manifestProjectIdMatched,
      manifestProjectCrsMatched: archiveProof.manifestProjectCrsMatched,
      savedImportedProject: false,
    };

    await projectRepository.saveProjectAsync(archiveProof.importedProject, evaluateLayout(archiveProof.importedProject));
    observations.zipRoundTrip.savedImportedProject = true;
    await projectRepository.deleteProjectAsync(project.id);
    const activeAfterDelete = await projectRepository.listProjectsAsync();
    observations.projectRoundTrip.deleteConfirmed = !activeAfterDelete.some((summary) => summary.id === project.id);

    return createAndroidNativeInProcessProof(observations);
  } catch (error) {
    return {
      ...createAndroidNativeInProcessProof(observations),
      status: "fail",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createProofProject(generatedAt: string): PivotProject {
  return {
    ...sampleProject,
    id: PROOF_PROJECT_ID,
    name: PROOF_PROJECT_NAME,
    fieldBoundary: sampleProject.fieldBoundary.map(copyXy),
    pivotCenter: copyXy(sampleProject.pivotCenter),
    waterSource: copyXy(sampleProject.waterSource),
    powerSource: copyXy(sampleProject.powerSource),
    machine: {
      ...sampleProject.machine,
      spanLengthsMeters: [...sampleProject.machine.spanLengthsMeters],
      sweep: { ...sampleProject.machine.sweep },
      endGunAngleRanges: sampleProject.machine.endGunAngleRanges?.map((range) => ({ ...range })),
    },
    obstacles: sampleProject.obstacles.map((obstacle) => ({
      ...obstacle,
      polygon: obstacle.polygon.map(copyXy),
    })),
    surveyPoints: sampleProject.surveyPoints.map((point) => ({
      ...point,
      id: `${PROOF_PROJECT_ID}:${point.id}`,
      projected: copyXy(point.projected),
      wgs84: point.wgs84 ? { ...point.wgs84 } : undefined,
      rtk: point.rtk ? { ...point.rtk } : undefined,
    })),
    settings: {
      ...defaultProjectSettings(),
      ...(sampleProject.settings ?? {}),
    },
    mapPackages: [proofMapPackage(generatedAt)],
  };
}

function copyXy(point: { x: number; y: number }): { x: number; y: number } {
  return { x: point.x, y: point.y };
}

function proofMapPackage(generatedAt: string): MapPackageManifest {
  return {
    id: "android-native-proof-local-raster-package",
    name: "Android native proof local raster package",
    packageType: "raster_tiles",
    tileContentType: "raster",
    uri: "app://map-packages/android-native-proof-local-raster-package/",
    minZoom: 10,
    maxZoom: 18,
    tileScheme: "xyz",
    boundsWgs84: {
      minLongitude: -104.0801,
      minLatitude: 39.8921,
      maxLongitude: -104.0601,
      maxLatitude: 39.9121,
    },
    tileJsonUrl: "app://map-packages/android-native-proof-local-raster-package/tilejson.json",
    tileUrlTemplates: ["app://map-packages/android-native-proof-local-raster-package/tiles/{z}/{x}/{y}.png"],
    imageryProvenance: {
      providerId: "local_android_native_proof_fixture",
      providerName: "CPLayout local Android native proof fixture",
      productId: `android-native-schema-v${ANDROID_NATIVE_REQUIRED_SQLITE_VERSION}-proof`,
      acquisitionYear: 2026,
      sourceResolutionMeters: 1,
      originalCrs: sampleProject.projectCrs,
      preprocessingSummary: `Proof-only local tile metadata exercises schema v${ANDROID_NATIVE_REQUIRED_SQLITE_VERSION} map package columns without rendering or network use.`,
      accessedAt: generatedAt,
      attribution: "CPLayout generated local proof metadata",
      licenseText: "Generated proof metadata; no imagery tiles are bundled.",
      offlineCopyAllowed: true,
      keyedService: false,
    },
    checksumSha256: "0".repeat(64),
    installStatus: "metadata_only",
    attribution: "CPLayout generated local proof metadata",
    licenseText: "Generated proof metadata; no imagery tiles are bundled.",
    bytes: 0,
    importedAt: generatedAt,
  };
}

async function collectSqliteProof(projectId: string): Promise<AndroidNativeVerificationReport["sqlite"]> {
  const db = await openProjectDatabaseAsync();
  const pragma = await db.getFirstAsync<{ user_version: number | null }>("PRAGMA user_version;");
  const migrations = await db.getAllAsync<{ id: number }>("SELECT id FROM schema_migrations ORDER BY id;");
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(map_packages);");
  const retiredTables = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('layout_evidence', 'model_recommendations', 'layout_decisions')
    ORDER BY name;`,
  );
  const geometryCount = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM geometries WHERE project_id = ?;",
    projectId,
  );
  const vertexCount = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count
    FROM geometry_vertices
    WHERE geometry_id IN (SELECT id FROM geometries WHERE project_id = ?);`,
    projectId,
  );
  const presentRetiredTables = new Set(retiredTables.map((row) => row.name));
  const absentTables = ANDROID_NATIVE_REQUIRED_ABSENT_TABLES.filter((tableName) => !presentRetiredTables.has(tableName));
  return {
    schemaVersion: ANDROID_NATIVE_REQUIRED_SQLITE_VERSION,
    pragmaUserVersion: Number(pragma?.user_version ?? 0),
    schemaMigrations: migrations.map((migration) => Number(migration.id)).filter((id) => ANDROID_NATIVE_REQUIRED_MIGRATIONS.includes(id)),
    mapPackageColumns: columns.map((column) => column.name).filter((name) => ANDROID_NATIVE_REQUIRED_MAP_PACKAGE_COLUMNS.includes(name as never)),
    absentTables,
    geometryRowsPopulated: Number(geometryCount?.count ?? 0) > 0 && Number(vertexCount?.count ?? 0) > 0,
  };
}

async function runArchiveProof(
  project: PivotProject,
  generatedAt: string,
): Promise<{
  exportedFilename: string;
  exportedBytes: number;
  exportedSha256: string;
  importedProject: PivotProject;
  manifestJsonPresent: boolean;
  projectJsonPresent: boolean;
  manifestProjectIdMatched: boolean;
  manifestProjectCrsMatched: boolean;
}> {
  const result = evaluateLayout(project);
  const bundle = buildProjectArchiveBundle(project, result, exportScenarioGeoJson(project, result), generatedAt);
  const zip = exportProjectArchiveZip(bundle);
  const files = unzipSync(zip);
  const manifestJsonPresent = Boolean(files[PROJECT_MANIFEST_FILENAME]);
  const projectJsonPresent = Boolean(files[PROJECT_JSON_FILENAME]);
  const manifest = manifestJsonPresent
    ? JSON.parse(strFromU8(files[PROJECT_MANIFEST_FILENAME])) as { projectId?: string; projectCrs?: string }
    : {};
  return {
    exportedFilename: `${project.id}.center-pivot.zip`,
    exportedBytes: zip.byteLength,
    exportedSha256: sha256Hex(zip),
    importedProject: importProjectArchiveZip(zip),
    manifestJsonPresent,
    projectJsonPresent,
    manifestProjectIdMatched: manifest.projectId === project.id,
    manifestProjectCrsMatched: manifest.projectCrs === project.projectCrs,
  };
}

function sha256Hex(data: Uint8Array): string {
  const words = bytesToWords(data);
  const bitLength = data.byteLength * 8;
  words[bitLength >> 5] |= 0x80 << (24 - (bitLength % 32));
  words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength;

  const hash = [
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  ];
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const schedule = new Array<number>(64);

  for (let offset = 0; offset < words.length; offset += 16) {
    for (let index = 0; index < 16; index += 1) schedule[index] = words[offset + index] | 0;
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(schedule[index - 15], 7) ^ rotateRight(schedule[index - 15], 18) ^ (schedule[index - 15] >>> 3);
      const s1 = rotateRight(schedule[index - 2], 17) ^ rotateRight(schedule[index - 2], 19) ^ (schedule[index - 2] >>> 10);
      schedule[index] = add32(schedule[index - 16], s0, schedule[index - 7], s1);
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = add32(h, s1, choice, constants[index], schedule[index]);
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = add32(s0, majority);
      h = g;
      g = f;
      f = e;
      e = add32(d, t1);
      d = c;
      c = b;
      b = a;
      a = add32(t1, t2);
    }
    hash[0] = add32(hash[0], a);
    hash[1] = add32(hash[1], b);
    hash[2] = add32(hash[2], c);
    hash[3] = add32(hash[3], d);
    hash[4] = add32(hash[4], e);
    hash[5] = add32(hash[5], f);
    hash[6] = add32(hash[6], g);
    hash[7] = add32(hash[7], h);
  }

  return hash.map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

function bytesToWords(data: Uint8Array): number[] {
  const words: number[] = [];
  for (let index = 0; index < data.byteLength; index += 1) {
    words[index >> 2] = (words[index >> 2] ?? 0) | (data[index] << (24 - (index % 4) * 8));
  }
  return words;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function add32(...values: number[]): number {
  return values.reduce((sum, value) => (sum + value) | 0, 0);
}
