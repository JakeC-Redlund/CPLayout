import assert from "node:assert/strict";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

import { projectXyToLonLat } from "./coordinates";
import { exportProjectGoogleEarthKml, importGoogleEarthKmlToProject } from "./projectKml";
import { improvedCenterPivotProofProject, realCenterPivotProofProject, sampleProject } from "./sampleProject";
import type { LayoutResult, XY } from "./types";

function kmlRing(points: XY[]): string {
  const closed = [...points, points[0]];
  return closed.map((point) => {
    const lonLat = projectXyToLonLat(point, sampleProject.projectCrs);
    return `${lonLat.longitude},${lonLat.latitude},0`;
  }).join(" ");
}

function kmlLine(points: XY[]): string {
  return points.map((point) => {
    const lonLat = projectXyToLonLat(point, sampleProject.projectCrs);
    return `${lonLat.longitude},${lonLat.latitude},0`;
  }).join(" ");
}

function polygonPlacemark(name: string, coordinates: string, extendedData = ""): string {
  return `
    <Placemark>
      <name>${name}</name>
      ${extendedData}
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordinates}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;
}

const boundaryRing = [
  { x: 501100, y: 4506100 },
  { x: 501240, y: 4506100 },
  { x: 501240, y: 4506240 },
  { x: 501100, y: 4506240 },
];
const obstacleRing = [
  { x: 501150, y: 4506140 },
  { x: 501180, y: 4506140 },
  { x: 501180, y: 4506170 },
  { x: 501150, y: 4506170 },
];
const pointLonLat = projectXyToLonLat({ x: 501170, y: 4506180 }, sampleProject.projectCrs);

const explicitKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    ${polygonPlacemark("Boundary", kmlRing(boundaryRing), `<ExtendedData><Data name="layerType"><value>field_boundary</value></Data></ExtendedData>`)}
    ${polygonPlacemark("Pump pad", kmlRing(obstacleRing), `<ExtendedData><Data name="kind"><value>building</value></Data></ExtendedData>`)}
    <Placemark>
      <name>Imported control</name>
      <ExtendedData><Data name="role"><value>control</value></Data></ExtendedData>
      <Point><coordinates>${pointLonLat.longitude},${pointLonLat.latitude},12</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;

const imported = importGoogleEarthKmlToProject(sampleProject, explicitKml, { observedAt: "2026-05-21T12:00:00.000Z" });
assert.equal(imported.importedBoundary, true);
assert.equal(imported.importedObstacleCount, 1);
assert.equal(imported.importedSurveyPointCount, 1);
assert.equal(imported.project.fieldBoundary.length, 4);
assert.equal(imported.project.obstacles.at(-1)?.kind, "building");
assert.equal(imported.project.surveyPoints.at(-1)?.role, "control");
assert.equal(imported.project.surveyPoints.at(-1)?.source, "imported");
assert.match(imported.warnings.join("\n"), /Ignored altitude/);
assert.ok(Math.abs(imported.project.fieldBoundary[0].x - boundaryRing[0].x) < 0.01);
assert.ok(Math.abs(imported.project.fieldBoundary[0].y - boundaryRing[0].y) < 0.01);

const heuristicKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    ${polygonPlacemark("Parcel outline", kmlRing(boundaryRing))}
    ${polygonPlacemark("Ditch", kmlRing(obstacleRing))}
  </Document>
</kml>`;
const heuristic = importGoogleEarthKmlToProject(sampleProject, heuristicKml, { observedAt: "2026-05-21T12:00:00.000Z" });
assert.equal(heuristic.importedBoundary, true);
assert.equal(heuristic.importedObstacleCount, 1);
assert.equal(heuristic.project.obstacles.at(-1)?.kind, "ditch");
assert.match(heuristic.warnings.join("\n"), /No explicit field_boundary/);

const willRheaStyleKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    ${polygonPlacemark("Middle_Machine_Field_Boundary", kmlRing(boundaryRing))}
    ${polygonPlacemark("South_Machine_Field_Boundary", kmlRing(obstacleRing))}
    <Placemark>
      <name>LRDU Distance</name>
      <LineString><coordinates>${kmlLine([boundaryRing[0], boundaryRing[1]])}</coordinates></LineString>
    </Placemark>
    <Placemark>
      <name>Linear Move Path</name>
      <LineString><coordinates>${kmlLine([boundaryRing[1], boundaryRing[2]])}</coordinates></LineString>
    </Placemark>
    <Placemark>
      <name>Middle Part Circle</name>
      <LineString><coordinates>${kmlRing(boundaryRing)}</coordinates></LineString>
    </Placemark>
    ${polygonPlacemark("Full_Scope_Field Boundary", kmlRing([
      { x: 501080, y: 4506080 },
      { x: 501260, y: 4506080 },
      { x: 501260, y: 4506260 },
      { x: 501080, y: 4506260 },
    ]))}
    <Placemark>
      <name>Pivot Point</name>
      <Point><coordinates>${pointLonLat.longitude},${pointLonLat.latitude},0</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;
const willRheaStyleImport = importGoogleEarthKmlToProject(sampleProject, willRheaStyleKml, { observedAt: "2026-06-06T00:00:00.000Z" });
assert.equal(willRheaStyleImport.importedBoundary, true);
assert.equal(willRheaStyleImport.importedObstacleCount, 0);
assert.equal(willRheaStyleImport.importedMapFeatureCount, 5);
assert.equal(willRheaStyleImport.importedSurveyPointCount, 1);
assert.equal(willRheaStyleImport.items.find((item) => item.name === "Middle_Machine_Field_Boundary")?.classification, "machine_zone");
assert.equal(willRheaStyleImport.items.find((item) => item.name === "South_Machine_Field_Boundary")?.featureKind, "machine_zone");
assert.equal(willRheaStyleImport.items.find((item) => item.name === "Middle Part Circle")?.featureKind, "machine_zone");
assert.equal(willRheaStyleImport.items.find((item) => item.name === "LRDU Distance")?.classification, "measurement_line");
assert.equal(willRheaStyleImport.items.find((item) => item.name === "Linear Move Path")?.featureKind, "linear_move_path");
assert.equal(willRheaStyleImport.items.find((item) => item.name === "Pivot Point")?.classification, "existing_pivot");
assert.equal(willRheaStyleImport.project.mapFeatures?.filter((feature) => feature.kind === "machine_zone").length, 3);
assert.equal(willRheaStyleImport.project.mapFeatures?.some((feature) => feature.kind === "measurement_line" && typeof feature.properties?.lengthMeters === "number"), true);
assert.equal(willRheaStyleImport.project.mapFeatures?.some((feature) => feature.kind === "linear_move_path"), true);
assert.equal(willRheaStyleImport.project.surveyPoints.at(-1)?.role, "pivot_center");
assert.match(willRheaStyleImport.items.find((item) => item.name === "Pivot Point")?.warning ?? "", /does not move/);

const closedLineStringKml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    ${polygonPlacemark("Boundary", kmlRing(boundaryRing), `<ExtendedData><Data name="layerType"><value>field_boundary</value></Data></ExtendedData>`)}
    <Placemark>
      <name>Fence line</name>
      <ExtendedData><Data name="kind"><value>fence</value></Data></ExtendedData>
      <LineString><coordinates>${kmlRing(obstacleRing)}</coordinates></LineString>
    </Placemark>
  </Document>
</kml>`;
const closedLine = importGoogleEarthKmlToProject(sampleProject, closedLineStringKml);
assert.equal(closedLine.importedObstacleCount, 0);
assert.equal(closedLine.importedMapFeatureCount, 1);
const closedLineFeature = closedLine.project.mapFeatures?.at(-1);
assert.equal(closedLineFeature?.kind, "fence");
assert.equal(closedLineFeature?.geometry.type, "LineString");
assert.equal(closedLineFeature?.geometry.type === "LineString" ? closedLineFeature.geometry.vertices.length : 0, 4);
assert.match(closedLine.warnings.join("\n"), /Closed utility LineString kept as a line/);

const selectedImport = importGoogleEarthKmlToProject(sampleProject, explicitKml, {
  observedAt: "2026-05-21T12:00:00.000Z",
  selectedItemIds: ["boundary", "imported-control"],
});
assert.equal(selectedImport.importedObstacleCount, 0);
assert.equal(selectedImport.importedSurveyPointCount, 1);
assert.equal(selectedImport.items.some((item) => item.name === "Pump pad" && !item.selected), true);

assert.throws(
  () => importGoogleEarthKmlToProject(sampleProject, `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><NetworkLink><name>Remote</name></NetworkLink></Document></kml>`),
  /did not contain supported/,
);

assert.throws(
  () => importGoogleEarthKmlToProject(sampleProject, `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><Point><coordinates>-181,40,0</coordinates></Point></Placemark></Document></kml>`),
  /did not contain supported/,
);

const exported = exportProjectGoogleEarthKml(sampleProject);
assert.equal(exported.warnings.length, 0);
assert.ok(exported.exportedFeatureCount >= sampleProject.obstacles.length + sampleProject.surveyPoints.length + 4);
assert.match(exported.kml, /<kml xmlns="http:\/\/www\.opengis\.net\/kml\/2\.2">/);
assert.match(exported.kml, /<LookAt><longitude>[-0-9.]+<\/longitude><latitude>[-0-9.]+<\/latitude><altitude>0<\/altitude><heading>0<\/heading><tilt>0<\/tilt><range>[0-9.]+<\/range><altitudeMode>clampToGround<\/altitudeMode><\/LookAt>/);
assert.match(exported.kml, /<Style id="cplayout-field-boundary">/);
assert.doesNotMatch(exported.kml, /cplayout-review-/);
assert.match(exported.kml, /<LineStyle><color>ff000000<\/color><width>4<\/width><\/LineStyle>/);
assert.match(exported.kml, /<PolyStyle><color>00000000<\/color><fill>0<\/fill><outline>1<\/outline><\/PolyStyle>/);
assert.match(exported.kml, /<IconStyle><color>ff0f5db8<\/color><scale>1\.15<\/scale><\/IconStyle>/);
assert.match(exported.kml, /<LabelStyle><color>ff000000<\/color><scale>1\.05<\/scale><\/LabelStyle>/);
assert.match(exported.kml, /<styleUrl>#cplayout-field-boundary<\/styleUrl>/);
assert.match(exported.kml, /<styleUrl>#cplayout-obstacle-road<\/styleUrl>/);
assert.match(exported.kml, /<styleUrl>#cplayout-point-pivot<\/styleUrl>/);
assert.match(exported.kml, /<styleUrl>#cplayout-point-water<\/styleUrl>/);
assert.match(exported.kml, /<styleUrl>#cplayout-point-power<\/styleUrl>/);
assert.match(exported.kml, /<styleUrl>#cplayout-survey-point<\/styleUrl>/);
assert.doesNotMatch(exported.kml, /<href>https?:\/\//);
assert.match(exported.kml, /field_boundary/);
assert.match(exported.kml, /projectCrs/);
assert.match(exported.kml, /EPSG:32613/);

const exportedUtility = exportProjectGoogleEarthKml({
  ...sampleProject,
  mapFeatures: [
    {
      id: "pipeline-a",
      name: "Pipeline A",
      kind: "underground_pipeline",
      geometry: { type: "LineString", vertices: obstacleRing.slice(0, 2) },
      confidence: "imagery_digitized",
    },
  ],
});
assert.match(exportedUtility.kml, /underground_pipeline/);
assert.match(exportedUtility.kml, /<Style id="cplayout-map-line-water">/);
assert.match(exportedUtility.kml, /<styleUrl>#cplayout-map-line-water<\/styleUrl>/);
assert.match(exportedUtility.kml, /<Data name="cplayoutFeatureType"><value>map_feature<\/value><\/Data>/);
assert.equal(exportedUtility.exportedFeatureCount, exported.exportedFeatureCount + 1);

const exportedCornerArmMetadata = exportProjectGoogleEarthKml({
  ...sampleProject,
  machine: {
    ...sampleProject.machine,
    cornerArm: {
      id: "corner-arm-kml",
      name: "Corner arm KML",
      advisoryOnly: true,
      lengthMeters: 91,
      wheelTrackLengthMeters: 78,
      overhangLengthMeters: 13,
      metadataSource: "manufacturer_public",
      modelFamily: "single_span_lrdu_sdu",
      guidanceType: "gps_guidance",
      sequencingType: "electronic",
      orientation: "operator_supplied",
      confidence: "user_estimated",
      sourceRefs: [{
        sourceId: "SRC-VALLEY-VFLEX-CORNER",
        title: "Valley VFlex Corner",
        url: "https://www.valleyirrigation.com/vflex-corner",
        checkedAt: "2026-06-05",
        limit: "Manufacturer public feature/specification reference only; CPLayout does not certify compatibility or kinematics.",
      }],
    },
  },
});
assert.match(exportedCornerArmMetadata.kml, /cornerArmAdvisoryOnly/);
assert.match(exportedCornerArmMetadata.kml, /cornerArmCanonicalGeometryMutation/);
assert.match(exportedCornerArmMetadata.kml, /cornerArmWheelTrackLengthMeters/);
assert.match(exportedCornerArmMetadata.kml, /cornerArmOverhangLengthMeters/);
assert.match(exportedCornerArmMetadata.kml, /cornerArmMetadataSource/);
assert.match(exportedCornerArmMetadata.kml, /cornerArmModelFamily/);
assert.match(exportedCornerArmMetadata.kml, /SRC-VALLEY-VFLEX-CORNER/);
assert.match(exportedCornerArmMetadata.kml, /Visual interchange metadata only/);
assert.match(exportedCornerArmMetadata.kml, /<styleUrl>#cplayout-point-pivot<\/styleUrl>/);

const styledMapPoints = exportProjectGoogleEarthKml({
  ...sampleProject,
  mapFeatures: [
    {
      id: "pump-location-a",
      name: "Pump Location A",
      kind: "pump_location",
      geometry: { type: "Point", point: sampleProject.waterSource },
      confidence: "rtk_fixed",
    },
    {
      id: "power-line-a",
      name: "Power Line A",
      kind: "power_line",
      geometry: { type: "LineString", vertices: obstacleRing.slice(0, 2) },
      confidence: "imagery_digitized",
    },
  ],
});
assert.match(styledMapPoints.kml, /Pump Location A/);
assert.match(styledMapPoints.kml, /<styleUrl>#cplayout-map-point<\/styleUrl>/);
assert.match(styledMapPoints.kml, /Power Line A/);
assert.match(styledMapPoints.kml, /<styleUrl>#cplayout-map-line-power<\/styleUrl>/);

const extendedMapFeatureKml = exportProjectGoogleEarthKml({
  ...sampleProject,
  mapFeatures: [
    {
      id: "corner-footprint-a",
      name: "Corner Footprint A",
      kind: "corner_swing_limit",
      geometry: { type: "Polygon", vertices: boundaryRing },
      confidence: "user_estimated",
    },
    {
      id: "end-gun-circle-a",
      name: "End Gun Circle A",
      kind: "end_gun_arc",
      geometry: { type: "Circle", center: sampleProject.pivotCenter, radiusMeters: 24 },
      confidence: "user_estimated",
    },
  ],
});
assert.match(extendedMapFeatureKml.kml, /Corner Footprint A/);
assert.match(extendedMapFeatureKml.kml, /End Gun Circle A/);
assert.match(extendedMapFeatureKml.kml, /mapFeatureGeometry/);
const importedExtendedMapFeatureKml = importGoogleEarthKmlToProject(sampleProject, extendedMapFeatureKml.kml, {
  selectedItemIds: ["corner-footprint-a", "end-gun-circle-a"],
});
assert.equal(importedExtendedMapFeatureKml.importedMapFeatureCount, 2);
assert.equal(importedExtendedMapFeatureKml.project.mapFeatures?.at(-2)?.geometry.type, "Polygon");
assert.equal(importedExtendedMapFeatureKml.project.mapFeatures?.at(-1)?.geometry.type, "Circle");

for (const field of ["centerX", "centerY", "radiusMeters"]) {
  const xml = new DOMParser().parseFromString(extendedMapFeatureKml.kml, "application/xml");
  const data = Array.from(xml.getElementsByTagName("Data")).find((element) => element.getAttribute("name") === field);
  assert.ok(data);
  const value = data.getElementsByTagName("value")[0];
  assert.ok(value);
  value.textContent = " ";
  const imported = importGoogleEarthKmlToProject({ ...sampleProject, mapFeatures: [] }, new XMLSerializer().serializeToString(xml), {
    selectedItemIds: ["end-gun-circle-a"],
  });
  assert.equal(imported.project.mapFeatures?.[0]?.geometry.type, "LineString", `Empty ${field} must not become a zero coordinate/radius.`);
}

const metricMeasurementKml = exportProjectGoogleEarthKml({
  ...sampleProject,
  mapFeatures: [{ id: "metric-line", name: "Measurement line", kind: "measurement_line",
    confidence: "imagery_digitized", geometry: { type: "LineString", vertices: obstacleRing.slice(0, 2) } }],
}).kml;
for (const projectCrs of ["EPSG:32613", "EPSG:3857"]) {
  const destination = { ...sampleProject, projectCrs, mapFeatures: [] };
  const before = JSON.stringify(destination);
  const imported = importGoogleEarthKmlToProject(destination, metricMeasurementKml, { selectedItemIds: ["metric-line"] });
  const measured = imported.project.mapFeatures?.find((feature) => feature.id === "metric-line");
  assert.ok(measured);
  if (projectCrs === "EPSG:3857") assert.equal(measured.properties?.lengthMeters, null);
  else assert.equal(typeof measured.properties?.lengthMeters, "number");
  assert.equal(JSON.stringify(destination), before);
}

for (const projectCrs of ["EPSG:26741", "LOCAL:FIELD", "EPSG:3857"]) {
  const destination = { ...importedExtendedMapFeatureKml.project, projectCrs };
  assert.throws(() => exportProjectGoogleEarthKml(destination), /Metric planar calculations unavailable/);
}

for (const projectCrs of ["EPSG:32614", "EPSG:3857"]) {
  const imported = importGoogleEarthKmlToProject({ ...sampleProject, projectCrs, mapFeatures: [] }, extendedMapFeatureKml.kml, {
    selectedItemIds: ["end-gun-circle-a"],
  });
  const converted = imported.project.mapFeatures?.find((feature) => feature.id === "end-gun-circle-a");
  assert.equal(converted?.geometry.type, "LineString", "Raw source-grid circle centers must not be reused in another grid.");
}

const renamedUtility = exportProjectGoogleEarthKml({
  ...sampleProject,
  mapFeatures: [
    {
      id: "pipeline-a",
      name: "Renamed Pipeline A",
      kind: "underground_pipeline",
      geometry: { type: "LineString", vertices: obstacleRing.slice(0, 2) },
      confidence: "imagery_digitized",
    },
  ],
});
assert.match(renamedUtility.kml, /Renamed Pipeline A/);
assert.doesNotMatch(renamedUtility.kml, /<name>Pipeline A<\/name>/);

const deletedUtility = exportProjectGoogleEarthKml({
  ...sampleProject,
  mapFeatures: [],
});
assert.doesNotMatch(deletedUtility.kml, /pipeline-a/);
assert.doesNotMatch(deletedUtility.kml, /Renamed Pipeline A/);
assert.equal(deletedUtility.exportedFeatureCount, exported.exportedFeatureCount);

function proofLayoutResultFor(project: typeof realCenterPivotProofProject, obstacleConflictCount: number): LayoutResult {
  return {
  metrics: {
    fieldAcres: 132,
    irrigatedAcres: 124,
    nonIrrigatedAcres: 8,
    coveragePercent: 93.8,
    endGunAcres: 7,
    outsideFieldAcres: 0,
    obstacleConflictCount,
    noSprayConflictCount: obstacleConflictCount,
    hardMechanicalConflictCount: 0,
    towerTrackConflictCount: 0,
  },
  baseCoverage: [[project.fieldBoundary]],
  endGunCoverage: [[project.fieldBoundary]],
  allowedCoverage: [[project.fieldBoundary]],
  outsideFieldCoverage: [],
  obstacles: project.obstacles.map((obstacle) => [obstacle.polygon]),
  mechanicalConflicts: [],
  towers: [
    {
      towerIndex: 1,
      radiusMeters: project.machine.spanLengthsMeters[0],
      point: {
        x: project.pivotCenter.x + project.machine.spanLengthsMeters[0],
        y: project.pivotCenter.y,
      },
    },
  ],
  warnings: [],
};
}
const proofLayoutResult = proofLayoutResultFor(realCenterPivotProofProject, 2);
const exportedProofLayout = exportProjectGoogleEarthKml(realCenterPivotProofProject, proofLayoutResult);
assert.match(exportedProofLayout.kml, /Base pivot wet circle/);
assert.match(exportedProofLayout.kml, /<LookAt><longitude>-104\.0700[0-9]+<\/longitude><latitude>39\.9021[0-9]+<\/latitude>/);
assert.match(exportedProofLayout.kml, /End gun throw coverage/);
assert.match(exportedProofLayout.kml, /Allowed irrigated coverage/);
assert.match(exportedProofLayout.kml, /<Style id="cplayout-layout-allowed-coverage">/);
assert.match(exportedProofLayout.kml, /<styleUrl>#cplayout-layout-base-coverage<\/styleUrl>/);
assert.match(exportedProofLayout.kml, /<Data name="cplayoutFeatureType"><value>layout_result<\/value><\/Data>/);
const importedProofLayout = importGoogleEarthKmlToProject(sampleProject, exportedProofLayout.kml);
assert.equal(importedProofLayout.importedObstacleCount, realCenterPivotProofProject.obstacles.length);
assert.ok(importedProofLayout.skippedFeatureCount >= 3);
assert.equal(importedProofLayout.items.some((item) => item.name === "Allowed irrigated coverage"), false);

const improvedProofLayout = proofLayoutResultFor(improvedCenterPivotProofProject, 1);
const exportedImprovedProofLayout = exportProjectGoogleEarthKml(improvedCenterPivotProofProject, improvedProofLayout);
assert.match(exportedImprovedProofLayout.kml, /Public Adams County Improved Pivot Proof|public-adams-county-center-pivot-improved-proof/);
assert.match(exportedImprovedProofLayout.kml, /<LookAt><longitude>-104\.0700[0-9]+<\/longitude><latitude>39\.9021[0-9]+<\/latitude>/);
assert.match(exportedImprovedProofLayout.kml, /<Style id="cplayout-field-boundary">/);
assert.match(exportedImprovedProofLayout.kml, /<styleUrl>#cplayout-field-boundary<\/styleUrl>/);
assert.match(exportedImprovedProofLayout.kml, /<styleUrl>#cplayout-obstacle-road<\/styleUrl>/);
assert.match(exportedImprovedProofLayout.kml, /<styleUrl>#cplayout-map-line-access<\/styleUrl>/);
assert.match(exportedImprovedProofLayout.kml, /<styleUrl>#cplayout-tower<\/styleUrl>/);
assert.match(exportedImprovedProofLayout.kml, /<ExtendedData>/);
assert.match(exportedImprovedProofLayout.kml, /Tower 1/);
assert.match(exportedImprovedProofLayout.kml, /south-county-road-setback/);
assert.match(exportedImprovedProofLayout.kml, /Visible access lane to pivot/);
assert.doesNotMatch(exportedImprovedProofLayout.kml, /diagonal-service-track-no-spray/);
assert.doesNotMatch(exportedImprovedProofLayout.kml, /<href>https?:\/\//);
const importedImprovedProofLayout = importGoogleEarthKmlToProject(sampleProject, exportedImprovedProofLayout.kml);
assert.equal(importedImprovedProofLayout.importedObstacleCount, improvedCenterPivotProofProject.obstacles.length);

console.log("project KML tests passed");
