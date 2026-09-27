import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, unzipSync, Zip, ZipDeflate, ZipPassThrough, zipSync } from "fflate";

import { evaluateLayout, exportScenarioGeoJson, validateCenterPivotProofGeometry } from "@cplayout/geometry";
import {
  PROJECT_GEOJSON_FILENAME,
  PROJECT_GOOGLE_EARTH_KML_FILENAME,
  PROJECT_JSON_FILENAME,
  PROJECT_MAP_XML_FILENAME,
  MAP_PACKAGES_CSV_FILENAME,
  PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES,
  PROJECT_ARCHIVE_MAX_ENTRY_BYTES,
  PROJECT_ARCHIVE_MAX_UNCOMPRESSED_BYTES,
  PROJECT_MANIFEST_FILENAME,
  buildProjectArchiveBundle,
  buildProjectRecoveryArchiveBundle,
  exportProjectArchiveZip,
  importProjectArchiveZip,
  mapPackagesToCsv,
  metricsToCsv,
  surveyPointsToCsv,
  type ProjectArchiveBundle,
} from "./projectArchive";
import { defaultAppSettings, GnssCaptureEvidenceV2Schema, parseProjectDocument, qualifyProjectCrs, realCenterPivotProofProject, sampleProject, willRheaJasonHarmelinkExampleProject, type PivotProject } from "@cplayout/core";
import { assertNoStrippedFields, parseEditableProjectDocument } from "./projectDocumentEditing";

for (const projectCrs of ["EPSG:26741", "LOCAL:FIELD", "EPSG:3857", "EPSG:26913", " epsg : 26741 "]) {
  const project: PivotProject = {
    ...sampleProject,
    projectCrs,
    mapFeatures: [{
      id: "recovery-circle", name: "Stored circle", kind: "end_gun_arc",
      geometry: { type: "Circle", center: { x: 123.456789, y: -987.654321 }, radiusMeters: 12.5 },
      confidence: "user_estimated",
    }],
  };
  const original = JSON.stringify(project);
  const recovery = buildProjectRecoveryArchiveBundle(project, "2026-09-14T00:00:00.000Z");
  const zip = exportProjectArchiveZip(recovery);
  assert.deepEqual(Object.keys(unzipSync(zip)).sort(), [PROJECT_MANIFEST_FILENAME, PROJECT_JSON_FILENAME].sort());
  assert.deepEqual(recovery.manifest.files, [PROJECT_MANIFEST_FILENAME, PROJECT_JSON_FILENAME]);
  assert.equal(recovery.manifest.projectCrs, projectCrs);
  const reopened = importProjectArchiveZip(zip);
  assert.deepEqual(reopened, parseProjectDocument(original));
  assert.equal(reopened.projectCrs, projectCrs);
  for (const key of ["fieldBoundary", "pivotCenter", "waterSource", "powerSource", "obstacles", "surveyPoints", "mapFeatures"] as const) {
    assert.deepEqual(reopened[key], project[key], `${projectCrs}: ${key}`);
  }
  assert.deepEqual(importProjectArchiveZip(exportProjectArchiveZip(buildProjectRecoveryArchiveBundle(reopened))), reopened);
  assert.equal(JSON.stringify(project), original);
  if (projectCrs !== "EPSG:26913") assert.equal(qualifyProjectCrs(reopened.projectCrs).calculation.allowed, false);
}
assert.throws(() => buildProjectRecoveryArchiveBundle({ ...sampleProject, projectCrs: "EPSG:4326" }), /Projected CRS/);
assert.throws(() => buildProjectRecoveryArchiveBundle({ ...sampleProject, pivotCenter: { x: NaN, y: 0 } }));

const result = evaluateLayout(sampleProject);
const bundle = buildProjectArchiveBundle(sampleProject, result, exportScenarioGeoJson(sampleProject, result), "2026-05-19T12:00:00.000Z");

test("project exporter uses a single header time even if the clock advances", context => {
  let tick = Date.parse("2026-09-16T00:00:00Z");
  context.mock.method(Date, "now", () => (tick += 4000));
  const recovery = buildProjectRecoveryArchiveBundle(sampleProject);
  assert.deepEqual(importProjectArchiveZip(exportProjectArchiveZip(recovery)), parseProjectDocument(JSON.stringify(sampleProject)));
});

assert.ok(bundle.files[PROJECT_MANIFEST_FILENAME].includes("center-pivot-project-archive-v1"));
assert.ok(bundle.files[PROJECT_JSON_FILENAME].includes(sampleProject.id));
assert.ok(bundle.files[PROJECT_JSON_FILENAME].includes("pivot-project-v1"));
assert.ok(bundle.files[PROJECT_GEOJSON_FILENAME].includes("FeatureCollection"));
assert.ok(bundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME].includes("field_boundary"));
assert.ok(bundle.files[PROJECT_MAP_XML_FILENAME].includes("cplayout-map-v1"));
assert.ok(bundle.files[PROJECT_MAP_XML_FILENAME].includes("gpsCoordinateSystem=\"decimal_degrees\""));
assert.ok(bundle.manifest.files.includes(PROJECT_MAP_XML_FILENAME));
assert.ok(bundle.files[MAP_PACKAGES_CSV_FILENAME].startsWith("id,name,packageType"));
assert.doesNotMatch(bundle.files[PROJECT_JSON_FILENAME], /onlineImagery|referenceOverlay|tileUrlTemplate|walkthroughProgress|packageDirectory/);

const archiveCaptureEvidence = {
  schemaVersion: "gnss-capture-v1" as const,
  observationId: "archive-session:172814:1000",
  sessionId: "archive-session",
  transport: "replay" as const,
  receivedAt: "2026-08-09T12:00:00.000Z",
  receivedMonotonicMs: 1000,
  sourceCoordinateFrame: "EPSG:4326",
  antennaReference: "unknown" as const,
  sentenceTypes: ["GGA", "GST"],
  coherent: true,
};
const evidenceArchiveProject: PivotProject = {
  ...sampleProject,
  surveyPoints: [{
    id: "archive-evidence-point",
    label: "Archive evidence point",
    role: "control",
    projected: sampleProject.pivotCenter,
    observedAt: "2026-08-09T12:00:00.000Z",
    source: "external_gnss",
    confidence: "rtk_fixed",
    captureEvidence: archiveCaptureEvidence,
  }],
};
const evidenceArchiveBundle = buildProjectArchiveBundle(
  evidenceArchiveProject,
  evaluateLayout(evidenceArchiveProject),
  exportScenarioGeoJson(evidenceArchiveProject, evaluateLayout(evidenceArchiveProject)),
  "2026-08-09T12:00:00.000Z",
);
const evidenceArchiveRoundTrip = importProjectArchiveZip(exportProjectArchiveZip(evidenceArchiveBundle));
assert.equal(evidenceArchiveRoundTrip.surveyPoints[0]?.captureEvidence?.observationId, archiveCaptureEvidence.observationId);

test("project ZIP retains v2 declared references and raw quality without promoting physical qualification", () => {
  const captureEvidence = GnssCaptureEvidenceV2Schema.parse({
    ...archiveCaptureEvidence, schemaVersion: "gnss-capture-v2", antennaReference: "arp",
    receiverObservedAt: "2026-08-09T12:00:00.000Z", sentenceTypes: ["GGA", "GST", "RMC"],
    height: { meters: 1600, type: "orthometric", geoidSeparationMeters: -20 },
    referenceDeclaration: {
      schemaVersion: "gnss-reference-declaration-v1", provenance: "operator_declared",
      receiverModel: "Synthetic receiver", receiverFirmware: "Synthetic firmware", referenceFrame: "WGS84",
      realization: "Synthetic realization", coordinateEpochUtc: "2026-01-01T00:00:00.000Z",
      verticalDatum: "Synthetic datum", geoidModel: "Synthetic geoid", antennaModel: "Synthetic antenna",
      antennaReference: "arp", reportedPoint: "Synthetic ARP", targetPoint: "Synthetic ARP",
      antennaHeightMeters: 1.8, offsetTreatment: "none_reported_point",
    },
    qualityScreen: {
      policy: "cplayout-nmea-collection-v2", uncertaintySource: "nmea_gst_component_standard_deviations",
      thresholds: defaultAppSettings().gpsQuality, evaluatedMonotonicMs: 1500, physicalQualification: "unverified",
      receiverQuality: { fixType: "rtk_fixed", satellites: 18, hdop: 0.6, vdop: null, pdop: null,
        horizontalAccuracyMeters: 0.014, verticalAccuracyMeters: 0.02, correctionAgeSeconds: 0.5, nmeaQualityCode: 4 },
    },
  });
  const project: PivotProject = { ...evidenceArchiveProject, surveyPoints: [{
    ...evidenceArchiveProject.surveyPoints[0], captureEvidence,
    rtk: { ...captureEvidence.qualityScreen.receiverQuality, correctionAgeSeconds: 1 },
  }] };
  const before = JSON.stringify(project);
  const reopened = importProjectArchiveZip(exportProjectArchiveZip(buildProjectRecoveryArchiveBundle(project)));
  assert.deepEqual(reopened.surveyPoints, project.surveyPoints);
  assert.equal(JSON.stringify(project), before);
  assert.equal(reopened.surveyPoints[0].captureEvidence?.schemaVersion, "gnss-capture-v2");
});

const localOnlyDraftProject = {
  ...sampleProject,
  settings: {
    ...sampleProject.settings,
    onlineImagery: {
      enabled: true,
      providerId: "custom_open_xyz",
      maxTilesPerView: 32,
      customSource: {
        name: "Local-only custom source",
        tileUrlTemplate: "https://tiles.example.org/{z}/{x}/{y}.png",
      },
    },
    offlineMaps: {
      ...sampleProject.settings?.offlineMaps,
      packageDirectory: "/operator/local/tiles",
    },
    referenceOverlay: {
      enabled: true,
      roads: true,
      borders: true,
      labels: true,
      sourcePackageId: "local-reference",
      schema: "cplayout_reference_v1",
    },
    walkthroughProgress: { imagery: true, boundary: true },
  },
} as unknown as typeof sampleProject;
const localOnlyBundle = buildProjectArchiveBundle(
  localOnlyDraftProject,
  result,
  exportScenarioGeoJson(localOnlyDraftProject, result),
  "2026-05-19T12:00:00.000Z",
);
assert.doesNotMatch(localOnlyBundle.files[PROJECT_JSON_FILENAME], /onlineImagery|referenceOverlay|tileUrlTemplate|walkthroughProgress|packageDirectory/);

const surveyCsv = surveyPointsToCsv(sampleProject.surveyPoints);
assert.match(surveyCsv, /^id,label,role,x,y,longitude,latitude,observedAt,source,confidence,notes/);
assert.match(surveyCsv, /pivot-rtk/);

const metricsCsv = metricsToCsv(result);
assert.match(metricsCsv, /coveragePercent/);

const mapPackageCsv = mapPackagesToCsv({
  ...sampleProject,
  mapPackages: [{
    id: "field-imagery",
    name: "Field imagery",
    packageType: "pmtiles",
    tileContentType: "raster",
    uri: "file:///offline/field.pmtiles",
    minZoom: 10,
    maxZoom: 18,
    tileScheme: "xyz",
    boundsWgs84: {
      minLongitude: -105.21,
      minLatitude: 40.01,
      maxLongitude: -105.11,
      maxLatitude: 40.11,
    },
    tileJsonUrl: "http://127.0.0.1:8765/field/tilejson.json",
    tileUrlTemplates: ["http://127.0.0.1:8765/field/{z}/{x}/{y}.png"],
    vectorOverlay: {
      schema: "cplayout_reference_v1",
      sourceLayers: {
        roads: "roads",
        roadLabels: "road_labels",
        borders: "borders",
        places: "places",
      },
    },
    imageryProvenance: {
      providerId: "usgs_naip",
      providerName: "USGS EROS NAIP",
      sourceUrl: "https://www.usgs.gov/centers/eros/science/national-agriculture-imagery-program-naip",
      productId: "M_4010521_NE_13_1_20250715",
      acquisitionYear: 2025,
      sourceResolutionMeters: 1,
      originalCrs: "EPSG:26913",
      preprocessingSummary: "GDAL generated XYZ PNG tiles and TileJSON outside the app.",
      accessedAt: "2026-06-03T12:00:00.000Z",
      attribution: "USDA Farm Service Agency, USGS EROS NAIP",
      licenseText: "Public domain NAIP imagery; verify source notices for the selected product.",
      offlineCopyAllowed: true,
      keyedService: false,
    },
    installStatus: "available",
    attribution: "Local imagery",
    licenseText: "Offline permitted",
    importedAt: "2026-05-19T12:00:00.000Z",
  }],
});
assert.match(mapPackageCsv, /tileContentType/);
assert.match(mapPackageCsv, /vectorOverlay/);
assert.match(mapPackageCsv, /imageryProvenance/);
assert.match(mapPackageCsv, /usgs_naip/);
assert.match(mapPackageCsv, /field-imagery/);

const logicalMapPackageProject = {
  ...sampleProject,
  mapPackages: [{
    id: "naip-local-aerial",
    name: "NAIP local aerial",
    packageType: "raster_tiles" as const,
    tileContentType: "raster" as const,
    uri: "app://map-packages/naip-local-aerial/",
    minZoom: 12,
    maxZoom: 18,
    tileScheme: "xyz" as const,
    boundsWgs84: {
      minLongitude: -105.2,
      minLatitude: 40.01,
      maxLongitude: -105.1,
      maxLatitude: 40.08,
    },
    tileJsonUrl: "app://map-packages/naip-local-aerial/tilejson.json",
    tileUrlTemplates: ["app://map-packages/naip-local-aerial/tiles/{z}/{x}/{y}.png"],
    installStatus: "available" as const,
    attribution: "USDA Farm Service Agency, USGS EROS NAIP",
    licenseText: "Public domain NAIP imagery; verify source notices for the selected product.",
    importedAt: "2026-06-03T12:00:00.000Z",
  }],
};
const logicalMapPackageBundle = buildProjectArchiveBundle(
  logicalMapPackageProject,
  evaluateLayout(logicalMapPackageProject),
  exportScenarioGeoJson(logicalMapPackageProject, evaluateLayout(logicalMapPackageProject)),
  "2026-06-03T12:00:00.000Z",
);
assert.match(logicalMapPackageBundle.files[PROJECT_JSON_FILENAME], /app:\/\/map-packages\/naip-local-aerial\/tilejson\.json/);
assert.match(logicalMapPackageBundle.files[MAP_PACKAGES_CSV_FILENAME], /app:\/\/map-packages\/naip-local-aerial\/tiles\/\{z\}\/\{x\}\/\{y\}\.png/);
assert.doesNotMatch(logicalMapPackageBundle.files[PROJECT_JSON_FILENAME], /file:\/\/\/documents\/map-packages/);
assert.doesNotMatch(logicalMapPackageBundle.files[MAP_PACKAGES_CSV_FILENAME], /file:\/\/\/documents\/map-packages/);

const projectWithMapFeatures: PivotProject = {
  ...sampleProject,
  mapFeatures: [
    {
      id: "pump-pad",
      name: "Pump pad",
      kind: "pump_location" as const,
      geometry: { type: "Point" as const, point: sampleProject.waterSource },
      confidence: "rtk_fixed" as const,
      properties: { inspected: true },
    },
    {
      id: "buried-main",
      name: "Buried main line",
      kind: "underground_pipeline" as const,
      geometry: {
        type: "LineString" as const,
        vertices: [sampleProject.waterSource, sampleProject.pivotCenter],
      },
      confidence: "user_estimated" as const,
      notes: "Planning-grade route.",
    },
    {
      id: "corner-footprint-a",
      name: "Corner footprint A",
      kind: "corner_swing_limit" as const,
      geometry: { type: "Polygon" as const, vertices: sampleProject.fieldBoundary.slice(0, 3) },
      confidence: "user_estimated" as const,
    },
    {
      id: "end-gun-circle-a",
      name: "End gun circle A",
      kind: "end_gun_arc" as const,
      geometry: { type: "Circle" as const, center: sampleProject.pivotCenter, radiusMeters: 24 },
      confidence: "user_estimated" as const,
    },
    {
      id: "generated-field-pivot-zone-1",
      name: "Generated Pivot Zone 1",
      kind: "machine_zone" as const,
      geometry: { type: "Circle" as const, center: { x: sampleProject.pivotCenter.x + 10, y: sampleProject.pivotCenter.y + 10 }, radiusMeters: 180 },
      confidence: "optimized" as const,
      notes: "Generated advisory review zone; not a saved pivot.",
      properties: {
        advisoryOnly: true,
        canonicalGeometryMutation: false,
        qualifiedReviewRequired: true,
        source: "generated_field_pivot_plan",
      },
    },
  ],
};
const mapFeatureBundle = buildProjectArchiveBundle(
  projectWithMapFeatures,
  evaluateLayout(projectWithMapFeatures),
  exportScenarioGeoJson(projectWithMapFeatures, evaluateLayout(projectWithMapFeatures)),
  "2026-05-19T12:00:00.000Z",
);
assert.match(bundle.files[PROJECT_JSON_FILENAME], /"mapFeatures": \[\]/);
assert.match(mapFeatureBundle.files[PROJECT_JSON_FILENAME], /"mapFeatures"/);
assert.match(mapFeatureBundle.files[PROJECT_JSON_FILENAME], /buried-main/);
const importedMapFeatureProject = importProjectArchiveZip(exportProjectArchiveZip(mapFeatureBundle));
assert.equal(importedMapFeatureProject.mapFeatures?.length, 5);
assert.equal(importedMapFeatureProject.mapFeatures?.[0].kind, "pump_location");
assert.equal(importedMapFeatureProject.mapFeatures?.[1].geometry.type, "LineString");
assert.equal(importedMapFeatureProject.mapFeatures?.[2].geometry.type, "Polygon");
assert.equal(importedMapFeatureProject.mapFeatures?.[3].geometry.type, "Circle");
assert.equal(importedMapFeatureProject.mapFeatures?.[4].kind, "machine_zone");
assert.equal(importedMapFeatureProject.mapFeatures?.[4].geometry.type, "Circle");
assert.deepEqual(importedMapFeatureProject.pivotCenter, sampleProject.pivotCenter);

const willRheaBundle = buildProjectArchiveBundle(
  willRheaJasonHarmelinkExampleProject,
  evaluateLayout(willRheaJasonHarmelinkExampleProject),
  exportScenarioGeoJson(willRheaJasonHarmelinkExampleProject, evaluateLayout(willRheaJasonHarmelinkExampleProject)),
  "2026-06-06T00:00:00.000Z",
);
const importedWillRhea = importProjectArchiveZip(exportProjectArchiveZip(willRheaBundle));
const importedWillRheaFeatureCounts = (importedWillRhea.mapFeatures ?? []).reduce<Record<string, number>>((counts, feature) => {
  counts[feature.kind] = (counts[feature.kind] ?? 0) + 1;
  return counts;
}, {});
assert.equal(importedWillRhea.id, "will-rhea-jason-harmelink-example");
assert.equal(importedWillRhea.projectCrs, "EPSG:32614");
assert.equal(importedWillRhea.wgs84Companion?.source, "derived_from_project_xy");
assert.deepEqual(importedWillRhea.fieldBoundary, willRheaJasonHarmelinkExampleProject.fieldBoundary);
assert.equal(importedWillRheaFeatureCounts.planning_boundary, 1);
assert.equal(importedWillRheaFeatureCounts.machine_zone, 4);
assert.equal(importedWillRheaFeatureCounts.measurement_line, 1);
assert.equal((importedWillRhea.mapFeatures ?? []).some((feature) => feature.id === "will-rhea-existing-machine-zone"), false);
assert.equal(
  (importedWillRhea.mapFeatures ?? []).filter((feature) => (
    feature.kind === "machine_zone"
    && feature.properties?.preferredMachineOutline === true
    && feature.properties?.advisoryDesignRole === "preferred_machine_outline"
  )).length,
  2,
);
assert.equal(
  importedWillRhea.mapFeatures?.find((feature) => feature.id === "will-rhea-middle-machine-field-boundary")?.properties?.sourceKmzSha256,
  "895e9367fd07c730572618d5ed01b96a66519de725faab082d6f1714ef827401",
);
assert.equal(
  importedWillRhea.mapFeatures?.find((feature) => feature.id === "will-rhea-lrdu-distance")?.properties?.derivedLengthMeters,
  462.9,
);

const projectWithCornerArm = {
  ...sampleProject,
  machine: {
    ...sampleProject.machine,
    cornerArm: {
      id: "corner-arm-archive",
      name: "Corner arm archive",
      advisoryOnly: true as const,
      lengthMeters: 91,
      wheelTrackLengthMeters: 78,
      overhangLengthMeters: 13,
      metadataSource: "operator_supplied" as const,
      modelFamily: "single_span_lrdu_sdu" as const,
      guidanceType: "gps_guidance" as const,
      sequencingType: "electronic" as const,
      orientation: "operator_supplied" as const,
      confidence: "user_estimated" as const,
      sourceRefs: [{
        sourceId: "SRC-VALLEY-VFLEX-CORNER",
        title: "Valley VFlex Corner",
        url: "https://www.valleyirrigation.com/vflex-corner",
        checkedAt: "2026-06-05",
        limit: "Manufacturer public feature/specification reference only; CPLayout does not certify compatibility or kinematics.",
      }],
    },
    driveUnits: {
      lrdu: {
        role: "lrdu" as const,
        advisoryOnly: true as const,
        tire: {
          id: "valley-standard-14-9-24",
          label: "14.9-24",
          advisoryOnly: true as const,
          roleCompatibility: ["lrdu" as const, "sdu" as const],
          sourceRefs: [{
            sourceId: "SRC-VALLEY-STANDARD-DRIVE-UNIT-PUBLIC",
            url: "https://valleyirrigation.com/standard-drive-unit",
            checkedAt: "2026-06-09",
            limit: "Public tire option label only; not field-specific compatibility proof.",
          }],
          caveats: ["Operator/vendor review required."],
          customValueFallback: false,
        },
        customMotorRpm: 0.6,
        sourceRefs: [{
          sourceId: "SRC-OPERATOR-LRDU-ARCHIVE",
          limit: "Operator-supplied advisory metadata only.",
        }],
        caveats: ["RPM is custom input, not a manual-derived preset."],
      },
    },
  },
};
const cornerArmBundle = buildProjectArchiveBundle(
  projectWithCornerArm,
  evaluateLayout(projectWithCornerArm),
  exportScenarioGeoJson(projectWithCornerArm, evaluateLayout(projectWithCornerArm)),
  "2026-06-05T12:00:00.000Z",
);
assert.match(cornerArmBundle.files[PROJECT_JSON_FILENAME], /corner-arm-archive/);
assert.match(cornerArmBundle.files[PROJECT_MAP_XML_FILENAME], /<cornerArm id="corner-arm-archive"/);
assert.match(cornerArmBundle.files[PROJECT_MAP_XML_FILENAME], /modelFamily="single_span_lrdu_sdu"/);
assert.match(cornerArmBundle.files[PROJECT_MAP_XML_FILENAME], /<driveUnit role="lrdu" advisoryOnly="true"/);
assert.match(cornerArmBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /cornerArmModelFamily/);
assert.match(cornerArmBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /cornerArmCanonicalGeometryMutation/);
assert.match(cornerArmBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /lrduDriveUnitTireLabel/);
const importedCornerArmProject = importProjectArchiveZip(exportProjectArchiveZip(cornerArmBundle));
assert.equal(importedCornerArmProject.machine.cornerArm?.id, "corner-arm-archive");
assert.equal(importedCornerArmProject.machine.cornerArm?.wheelTrackLengthMeters, 78);
assert.equal(importedCornerArmProject.machine.cornerArm?.overhangLengthMeters, 13);
assert.equal(importedCornerArmProject.machine.cornerArm?.metadataSource, "operator_supplied");
assert.equal(importedCornerArmProject.machine.cornerArm?.modelFamily, "single_span_lrdu_sdu");
assert.equal(importedCornerArmProject.machine.cornerArm?.sourceRefs[0].sourceId, "SRC-VALLEY-VFLEX-CORNER");
assert.equal(importedCornerArmProject.machine.driveUnits?.lrdu?.tire?.label, "14.9-24");
assert.equal(importedCornerArmProject.machine.driveUnits?.lrdu?.customMotorRpm, 0.6);
assert.deepEqual(importedCornerArmProject.pivotCenter, sampleProject.pivotCenter);

const zipped = exportProjectArchiveZip(bundle);
assert.ok(zipped.byteLength > 500);

const imported = importProjectArchiveZip(zipped);
assert.equal(imported.id, sampleProject.id);
assert.equal(imported.projectCrs, "EPSG:32613");
assert.equal(imported.fieldBoundary.length, sampleProject.fieldBoundary.length);
assert.equal(imported.machine.spanLengthsMeters.length, sampleProject.machine.spanLengthsMeters.length);

const legacyReviewArchiveBundle: ProjectArchiveBundle = {
  ...bundle,
  manifest: {
    ...bundle.manifest,
    files: [
      ...bundle.manifest.files,
      "exports/layout-evidence.jsonl",
      "exports/layout-decisions.jsonl",
      "exports/model-recommendations.geojson",
    ],
  },
  files: {
    ...bundle.files,
    [PROJECT_MANIFEST_FILENAME]: JSON.stringify({
      ...bundle.manifest,
      files: [
        ...bundle.manifest.files,
        "exports/layout-evidence.jsonl",
        "exports/layout-decisions.jsonl",
        "exports/model-recommendations.geojson",
      ],
    }),
    "exports/layout-evidence.jsonl": "not parsed legacy review data\n",
    "exports/layout-decisions.jsonl": "not parsed legacy decision data\n",
    "exports/model-recommendations.geojson": "{ not parsed legacy recommendation geojson",
  },
};
const legacyReviewImport = importProjectArchiveZip(exportProjectArchiveZip(legacyReviewArchiveBundle));
assert.equal(legacyReviewImport.id, sampleProject.id);
assert.equal(legacyReviewImport.fieldBoundary.length, sampleProject.fieldBoundary.length);
assert.equal(bundle.manifest.files.includes("exports/layout-evidence.jsonl"), false);
assert.equal(bundle.manifest.files.includes("exports/layout-decisions.jsonl"), false);
assert.equal(bundle.manifest.files.includes("exports/model-recommendations.geojson"), false);

const proofResult = evaluateLayout(realCenterPivotProofProject);
assert.deepEqual(validateCenterPivotProofGeometry(realCenterPivotProofProject, proofResult), []);
const proofBundle = buildProjectArchiveBundle(
  realCenterPivotProofProject,
  proofResult,
  exportScenarioGeoJson(realCenterPivotProofProject, proofResult),
  "2026-05-29T12:00:00.000Z",
);
assert.match(proofBundle.files[PROJECT_JSON_FILENAME], /Public Adams County Center Pivot Proof/);
assert.match(proofBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /Base pivot wet circle/);
assert.match(proofBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /Allowed irrigated coverage/);
assert.match(proofBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /End gun throw coverage/);
assert.match(proofBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /Diagonal service track no-spray/);
assert.match(proofBundle.files[PROJECT_GOOGLE_EARTH_KML_FILENAME], /cplayout-layout-allowed-coverage/);
const proofRoundTrip = importProjectArchiveZip(exportProjectArchiveZip(proofBundle));
assert.equal(proofRoundTrip.id, realCenterPivotProofProject.id);
assert.equal(proofRoundTrip.fieldBoundary.length, realCenterPivotProofProject.fieldBoundary.length);
assert.equal(proofRoundTrip.obstacles.length, realCenterPivotProofProject.obstacles.length);
assert.equal(proofRoundTrip.mapFeatures?.length, realCenterPivotProofProject.mapFeatures?.length);

const badVersionBundle = {
  ...bundle,
  files: {
    ...bundle.files,
    [PROJECT_MANIFEST_FILENAME]: JSON.stringify({
      ...bundle.manifest,
      projectDocumentVersion: "old-version",
    }),
  },
};
assert.throws(
  () => importProjectArchiveZip(exportProjectArchiveZip(badVersionBundle)),
  /Invalid input|projectDocumentVersion/,
);

const wrongProjectIdBundle = {
  ...bundle,
  files: {
    ...bundle.files,
    [PROJECT_MANIFEST_FILENAME]: JSON.stringify({
      ...bundle.manifest,
      projectId: "different-project",
    }),
  },
};
assert.throws(
  () => importProjectArchiveZip(exportProjectArchiveZip(wrongProjectIdBundle)),
  /projectId does not match/,
);

assert.throws(
  () => importProjectArchiveZip(new Uint8Array([1, 2, 3])),
  /invalid zip data|unexpected EOF|central directory/i,
);

assert.throws(
  () => importProjectArchiveZip(new Uint8Array(PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES + 1)),
  /compressed size exceeds/,
);

assert.throws(
  () => importProjectArchiveZip(exportProjectArchiveZip({
    ...bundle,
    manifest: {
      ...bundle.manifest,
      files: [...bundle.manifest.files, "../evil.txt"],
    },
    files: {
      ...bundle.files,
      [PROJECT_MANIFEST_FILENAME]: JSON.stringify({
        ...bundle.manifest,
        files: [...bundle.manifest.files, "../evil.txt"],
      }),
      "../evil.txt": "escape",
    },
  })),
  /unsafe path/,
);

assert.throws(
  () => importProjectArchiveZip(exportProjectArchiveZip({
    ...bundle,
    manifest: {
      ...bundle.manifest,
      files: [...bundle.manifest.files, "exports/unexpected.json"],
    },
    files: {
      ...bundle.files,
      [PROJECT_MANIFEST_FILENAME]: JSON.stringify({
        ...bundle.manifest,
        files: [...bundle.manifest.files, "exports/unexpected.json"],
      }),
      "exports/unexpected.json": "{}",
    },
  })),
  /unsupported file/,
);

assert.throws(
  () => importProjectArchiveZip(exportProjectArchiveZip({
    ...bundle,
    files: {
      ...bundle.files,
      [PROJECT_JSON_FILENAME]: " ".repeat(PROJECT_ARCHIVE_MAX_ENTRY_BYTES + 1),
    },
  })),
  /entry project\.json exceeds/,
);

assert.throws(
  () => importProjectArchiveZip(exportProjectArchiveZip({
    ...bundle,
    files: {
      ...bundle.files,
      [PROJECT_GEOJSON_FILENAME]: " ".repeat(PROJECT_ARCHIVE_MAX_UNCOMPRESSED_BYTES + 1),
    },
  })),
  /entry exports\/scenario\.geojson exceeds|uncompressed size exceeds/,
);

console.log("project archive tests passed");

function archiveBytes(files: Record<string, string>, stored: boolean): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])), { level: stored ? 0 : 6 });
}

// Walk directory records in these generated ZIP32 fixtures, never search compressed data for signatures.
function archiveRecords(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  let central = view.getUint32(end + 16, true);
  const records = [];
  for (let index = 0; index < view.getUint16(end + 10, true); index++) {
    assert.equal(view.getUint32(central, true), 0x02014b50);
    const local = view.getUint32(central + 42, true);
    assert.equal(view.getUint32(local, true), 0x04034b50);
    const nameLength = view.getUint16(central + 28, true);
    const name = Buffer.from(bytes.subarray(central + 46, central + 46 + nameLength)).toString("utf8");
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    records.push({ name, local, central, dataStart });
    central += 46 + nameLength + view.getUint16(central + 30, true) + view.getUint16(central + 32, true);
  }
  return records;
}

function rejectsArchiveUnchanged(bytes: Uint8Array, message: RegExp): void {
  const before = bytes.slice();
  assert.throws(() => importProjectArchiveZip(bytes), message);
  assert.deepEqual(bytes, before);
}

test("editable archive admission rejects unknown wrapper, project and deeply nested fields without changing bytes", () => {
  const recovery = buildProjectRecoveryArchiveBundle(evidenceArchiveProject);
  for (const mutate of [
    (raw: any) => { raw.futureWrapper = { retained: true }; },
    (raw: any) => { raw.project.futureProject = { retained: true }; },
    (raw: any) => { raw.project.machine.futureMachine = { retained: true }; },
    (raw: any) => { raw.project.fieldBoundary[0].futureCoordinate = true; },
    (raw: any) => { raw.project.surveyPoints[0].captureEvidence.futureEvidence = true; },
    (raw: any) => { raw.project.wgs84Companion.futureCompanion = true; },
  ]) {
    const raw = JSON.parse(recovery.files[PROJECT_JSON_FILENAME]);
    mutate(raw);
    const document = JSON.stringify(raw);
    // Legacy reading remains available; only editable admission refuses lossy normalization.
    assert.doesNotThrow(() => parseProjectDocument(document));
    assert.throws(() => parseEditableProjectDocument(document), /unsupported fields/);
    for (const stored of [false, true]) {
      rejectsArchiveUnchanged(archiveBytes({ ...recovery.files, [PROJECT_JSON_FILENAME]: document }, stored), /unsupported fields/);
    }
  }
});

test("editable archive admission rejects duplicate keys and explicit future versions before normalization", () => {
  const recovery = buildProjectRecoveryArchiveBundle(sampleProject);
  const project = JSON.stringify(sampleProject);
  const documents: Array<[string, RegExp]> = [
    [`{"documentVersion":"pivot-project-v1","project":${project},"project":${project}}`, /Duplicate JSON/],
    [`{"documentVersion":"pivot-project-v1","project":${project},"pro\\u006aect":${project}}`, /Duplicate JSON/],
    ['{"project":{"pivotCenter":{"x":1,"x":2,"y":3}}}', /Duplicate JSON/],
    [JSON.stringify({ documentVersion: "pivot-project-v99", project: sampleProject }), /version is unsupported/],
    [JSON.stringify({ ...sampleProject, documentVersion: "pivot-project-v99" }), /version is unsupported/],
    [JSON.stringify({ ...sampleProject, documentVersion: null }), /version is unsupported/],
  ];
  for (const [document, error] of documents) {
    assert.throws(() => parseEditableProjectDocument(document), error);
    rejectsArchiveUnchanged(archiveBytes({ ...recovery.files, [PROJECT_JSON_FILENAME]: document }, true), error);
  }
});

test("archive manifest rejects repeated and escaped duplicate identities before schema admission", () => {
  const recovery = buildProjectRecoveryArchiveBundle(sampleProject);
  const manifest = recovery.files[PROJECT_MANIFEST_FILENAME];
  for (const key of ["projectId", "project\\u0049d"]) {
    const duplicate = `{${JSON.stringify(key).replace("\\\\u", "\\u")}:"ambiguous",${manifest.slice(1)}`;
    for (const stored of [false, true]) {
      rejectsArchiveUnchanged(archiveBytes({ ...recovery.files, [PROJECT_MANIFEST_FILENAME]: duplicate }, stored), /Duplicate JSON/);
    }
  }
  const extended = JSON.stringify({ ...JSON.parse(manifest), producerNote: "Passive manifest metadata" });
  assert.deepEqual(importProjectArchiveZip(archiveBytes({ ...recovery.files, [PROJECT_MANIFEST_FILENAME]: extended }, true)),
    parseProjectDocument(recovery.files[PROJECT_JSON_FILENAME]));
});

test("editable archive admission preserves legacy bare projects, v1 evidence and schema defaults", () => {
  const recovery = buildProjectRecoveryArchiveBundle(evidenceArchiveProject);
  const bare = JSON.parse(recovery.files[PROJECT_JSON_FILENAME]).project;
  delete bare.mapFeatures;
  delete bare.wgs84Companion;
  for (const source of [bare, { documentVersion: "pivot-project-v1", project: bare }]) {
    const document = JSON.stringify(source);
    const original = structuredClone(source);
    const parsed = parseEditableProjectDocument(document);
    assert.deepEqual(parsed, parseProjectDocument(document));
    assert.deepEqual(parsed.mapFeatures, []);
    assert.deepEqual(parsed.surveyPoints, evidenceArchiveProject.surveyPoints);
    for (const stored of [false, true]) {
      const bytes = archiveBytes({ ...recovery.files, [PROJECT_JSON_FILENAME]: document }, stored);
      const before = bytes.slice();
      assert.deepEqual(importProjectArchiveZip(bytes), parsed);
      assert.deepEqual(bytes, before);
    }
    parsed.surveyPoints[0].captureEvidence!.sentenceTypes.push("SYNTHETIC");
    assert.deepEqual(source, original);
    assert.equal(JSON.stringify(source), document);
  }
});

test("editable admission compares known companion fields before deriving them", () => {
  const source = { ...sampleProject, wgs84Companion: {
    status: "unavailable", source: "derived_from_project_xy", coordinateSystem: "decimal_degrees",
    projectCrs: sampleProject.projectCrs, error: "Synthetic old transform failure",
  } };
  const document = JSON.stringify(source);
  assert.deepEqual(parseEditableProjectDocument(document), parseProjectDocument(document));
});

test("editable parser and field-retention checks do not invoke input hooks or accessors", () => {
  let calls = 0;
  const unsafe = { toString() { calls++; throw new Error("Hook executed"); }, toJSON() { calls++; throw new Error("Hook executed"); } };
  assert.throws(() => parseEditableProjectDocument(unsafe as unknown as string), /JSON document string/);
  const getter = Object.defineProperty({}, "name", { enumerable: true, get() { calls++; throw new Error("Getter executed"); } });
  assert.throws(() => assertNoStrippedFields(getter, { name: "Synthetic" }), /discarded/);
  assert.throws(() => assertNoStrippedFields({ name: "Synthetic" }, getter), /discarded/);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => assertNoStrippedFields(cyclic, cyclic), /discarded/);
  assert.equal(calls, 0);
});

test("project recovery rejects a changed XY byte with stale CRC instead of importing changed geometry", () => {
  const project = structuredClone(sampleProject);
  project.fieldBoundary[0].x = 123456;
  const recovery = buildProjectRecoveryArchiveBundle(project);
  const bytes = archiveBytes(recovery.files, true);
  assert.deepEqual(importProjectArchiveZip(bytes), parseProjectDocument(recovery.files[PROJECT_JSON_FILENAME]));
  const record = archiveRecords(bytes).find((entry) => entry.name === PROJECT_JSON_FILENAME)!;
  const offset = Buffer.from(bytes).indexOf("123456", record.dataStart);
  assert.ok(offset >= record.dataStart);
  bytes[offset + 5] = "7".charCodeAt(0);
  rejectsArchiveUnchanged(bytes, /CRC-32 mismatch: project\.json/);
});

test("project import checks actual CRC for every required, export and ignored legacy entry", () => {
  for (const stored of [false, true]) {
    const original = archiveBytes(legacyReviewArchiveBundle.files, stored);
    assert.deepEqual(importProjectArchiveZip(original), imported);
    for (const record of archiveRecords(original)) {
      const bytes = original.slice();
      const view = new DataView(bytes.buffer);
      const forgedCrc = (view.getUint32(record.central + 16, true) ^ 1) >>> 0;
      view.setUint32(record.central + 16, forgedCrc, true);
      view.setUint32(record.local + 14, forgedCrc, true);
      rejectsArchiveUnchanged(bytes, /CRC-32 mismatch/);
    }
  }
});

test("project import rejects lossy UTF-8 even when its ZIP checksums are valid", () => {
  const project = { ...sampleProject, name: "Synthetic UTF8 control" };
  const recovery = buildProjectRecoveryArchiveBundle(project);
  for (const stored of [false, true]) {
    assert.equal(importProjectArchiveZip(archiveBytes(recovery.files, stored)).name, project.name);
    for (const invalid of [[0xff], [0x80], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80]]) {
      const entries = Object.fromEntries(Object.entries(recovery.files).map(([name, contents]) => {
        const payload = strToU8(contents);
        const offset = Buffer.from(payload).indexOf("Synthetic");
        assert.ok(offset >= 0);
        payload.set(invalid, offset);
        return [name, payload];
      }));
      rejectsArchiveUnchanged(zipSync(entries, { level: stored ? 0 : 6 }), /invalid UTF-8/);
    }
  }
});

test("project import rejects encrypted flags and inconsistent local metadata", () => {
  for (const stored of [false, true]) {
    const original = archiveBytes(bundle.files, stored);
    assert.deepEqual(importProjectArchiveZip(original), imported);
    const record = archiveRecords(original).find((entry) => entry.name === PROJECT_JSON_FILENAME)!;
    const encrypted = original.slice();
    const view = new DataView(encrypted.buffer);
    view.setUint16(record.central + 8, view.getUint16(record.central + 8, true) | 1, true);
    view.setUint16(record.local + 6, view.getUint16(record.local + 6, true) | 1, true);
    rejectsArchiveUnchanged(encrypted, /flags or encryption/);
    const inconsistent = original.slice();
    new DataView(inconsistent.buffer).setUint16(record.local + 6, 1, true);
    rejectsArchiveUnchanged(inconsistent, /local metadata mismatch/);
  }
});

test("streamed project and recovery archives preserve geometry and exact byte-view bounds", context => {
  let tick = Date.UTC(2026, 8, 25, 12);
  context.mock.method(Date, "now", () => (tick += 4000));
  for (const archive of [bundle, buildProjectRecoveryArchiveBundle(sampleProject), legacyReviewArchiveBundle]) {
    for (const stored of [false, true]) {
      const chunks: Uint8Array[] = [];
      const zip = new Zip((error, data) => { if (error) throw error; chunks.push(data); });
      const mtime = new Date(Date.now());
      for (const [name, contents] of Object.entries(archive.files)) {
        const file = stored ? new ZipPassThrough(name) : new ZipDeflate(name);
        file.mtime = mtime;
        zip.add(file);
        const data = strToU8(contents);
        file.push(data.subarray(0, 13));
        file.push(data.subarray(13), true);
      }
      zip.end();
      const bytes = new Uint8Array(Buffer.concat(chunks));
      const padded = new Uint8Array(bytes.length + 11);
      padded.set(bytes, 5);
      const exactView = padded.subarray(5, 5 + bytes.length);
      const before = padded.slice();
      assert.deepEqual(importProjectArchiveZip(exactView), parseProjectDocument(archive.files[PROJECT_JSON_FILENAME]));
      assert.deepEqual(padded, before);
    }
  }
});
