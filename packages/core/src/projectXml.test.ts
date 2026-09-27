import assert from "node:assert/strict";

import { CPLAYOUT_MAP_XML_VERSION, exportProjectMapXml, importProjectMapXmlToProject } from "./projectXml";
import { sampleProject } from "./sampleProject";
import type { PivotProject } from "./types";

const projectWithFeatures: PivotProject = {
  ...sampleProject,
  mapFeatures: [
    {
      id: "corner-footprint-a",
      name: "Corner footprint A",
      kind: "corner_swing_limit" as const,
      geometry: {
        type: "Polygon" as const,
        vertices: sampleProject.fieldBoundary.slice(0, 4),
      },
      confidence: "user_estimated" as const,
      notes: "Operator supplied advisory footprint.",
    },
    {
      id: "end-gun-radius-a",
      name: "End gun radius marker",
      kind: "end_gun_arc" as const,
      geometry: {
        type: "Circle" as const,
        center: sampleProject.pivotCenter,
        radiusMeters: 24,
      },
      confidence: "user_estimated" as const,
      properties: { advisoryOnly: true },
    },
    {
      id: "machine-zone-a",
      name: "Machine zone A",
      kind: "machine_zone" as const,
      geometry: {
        type: "Polygon" as const,
        vertices: sampleProject.fieldBoundary.slice(1, 4),
      },
      confidence: "user_estimated" as const,
      properties: { advisoryOnly: true, canonicalGeometryMutation: false },
    },
    {
      id: "measurement-line-a",
      name: "Measurement line A",
      kind: "measurement_line" as const,
      geometry: {
        type: "LineString" as const,
        vertices: sampleProject.fieldBoundary.slice(0, 2),
      },
      confidence: "imagery_digitized" as const,
      properties: { lengthMeters: 1514.96 },
    },
    {
      id: "linear-move-path-a",
      name: "Linear move path A",
      kind: "linear_move_path" as const,
      geometry: {
        type: "LineString" as const,
        vertices: sampleProject.fieldBoundary.slice(2, 4),
      },
      confidence: "user_estimated" as const,
      properties: { advisoryOnly: true, canonicalGeometryMutation: false },
    },
    {
      id: "well-a",
      name: "Well A",
      kind: "well_location" as const,
      geometry: {
        type: "Point" as const,
        point: sampleProject.waterSource,
      },
      confidence: "user_estimated" as const,
    },
  ],
  machine: {
    ...sampleProject.machine,
    catalogSelection: {
      catalogId: "valley-8000-public-preset",
      manufacturer: "Valley",
      model: "8000 Series",
      sourceUrl: "https://www.valleyirrigation.com/8000",
      sourceAccessedAt: "2026-06-02",
      advisoryOnly: true as const,
    },
    cornerArm: {
      id: "corner-arm-a",
      name: "Corner arm A",
      advisoryOnly: true as const,
      lengthMeters: 91,
      wheelTrackLengthMeters: 78,
      overhangLengthMeters: 13,
      maxSteerAngleDegrees: 162,
      maxExtensionRateMetersPerMinute: 0.47,
      metadataSource: "operator_supplied" as const,
      modelFamily: "single_span_lrdu_sdu" as const,
      guidanceType: "gps_guidance" as const,
      sequencingType: "electronic" as const,
      orientation: "operator_supplied" as const,
      confidence: "user_estimated" as const,
      operatorConfirmedAt: "2026-06-05T00:00:00.000Z",
      notes: "Operator confirmed advisory config.",
      sourceRefs: [{
        sourceId: "SRC-VALLEY-VFLEX-CORNER",
        title: "Valley VFlex Corner",
        url: "https://www.valleyirrigation.com/vflex-corner",
        checkedAt: "2026-06-05",
        limit: "Manufacturer public feature/specification reference only; CPLayout does not certify compatibility or kinematics.",
      }],
      speedEvidenceSourceRefs: [{
        sourceId: "SRC-LOCAL-CURATED-SPEED",
        limit: "Curated local line reference required; test fixture only.",
      }],
    },
    driveUnits: {
      lrdu: {
        role: "lrdu" as const,
        advisoryOnly: true as const,
        tire: {
          id: "valley-standard-11-2-38",
          label: "11.2-38",
          advisoryOnly: true as const,
          roleCompatibility: ["lrdu" as const, "sdu" as const],
          sourceRefs: [{
            sourceId: "SRC-VALLEY-STANDARD-DRIVE-UNIT-PUBLIC",
            url: "https://valleyirrigation.com/standard-drive-unit",
            checkedAt: "2026-06-09",
            limit: "Public tire label only.",
          }],
          caveats: ["Operator/vendor review required."],
          customValueFallback: false,
        },
        customMotorRpm: 0.75,
        operatorMeasuredSpeedMetersPerMinute: 1.2,
        sourceRefs: [{
          sourceId: "SRC-OPERATOR-LRDU",
          limit: "Operator-supplied advisory metadata only.",
        }],
        caveats: ["Custom RPM is not a manual-derived preset."],
      },
      sdu: {
        role: "sdu" as const,
        advisoryOnly: true as const,
        customTireLabel: "operator SDU tire",
        sourceRefs: [{
          sourceId: "SRC-OPERATOR-SDU",
          limit: "Operator-supplied advisory metadata only.",
        }],
        caveats: ["Metadata only; not SDU kinematics."],
      },
    },
  },
};

const xml = exportProjectMapXml(projectWithFeatures);
assert.match(xml, new RegExp(CPLAYOUT_MAP_XML_VERSION));
assert.match(xml, /canonicalGeometry="projected_xy"/);
assert.match(xml, /gpsCoordinateSystem="decimal_degrees"/);
assert.match(xml, /<mapFeature id="corner-footprint-a"/);
assert.match(xml, /<geometry type="Circle" radiusMeters="24">/);
assert.match(xml, /<mapFeature id="machine-zone-a"/);
assert.match(xml, /<mapFeature id="measurement-line-a"/);
assert.match(xml, /<mapFeature id="linear-move-path-a"/);
assert.match(xml, /<mapFeature id="well-a"/);
assert.match(xml, /catalogId="valley-8000-public-preset"/);
assert.match(xml, /<cornerArm id="corner-arm-a"/);
assert.match(xml, /wheelTrackLengthMeters="78"/);
assert.match(xml, /overhangLengthMeters="13"/);
assert.match(xml, /maxSteerAngleDegrees="162"/);
assert.match(xml, /modelFamily="single_span_lrdu_sdu"/);
assert.match(xml, /sourceId="SRC-VALLEY-VFLEX-CORNER"/);
assert.match(xml, /<driveUnits advisoryOnly="true">/);
assert.match(xml, /<driveUnit role="lrdu" advisoryOnly="true"/);
assert.match(xml, /customMotorRpm="0.75"/);
assert.match(xml, /<tire id="valley-standard-11-2-38"/);
assert.doesNotMatch(xml, /tileUrlTemplate|packageDirectory|hidden/i);

const imported = importProjectMapXmlToProject(xml);
assert.equal(imported.project.id, projectWithFeatures.id);
assert.equal(imported.project.projectCrs, projectWithFeatures.projectCrs);
assert.equal(imported.project.fieldBoundary.length, projectWithFeatures.fieldBoundary.length);
assert.equal(imported.project.mapFeatures?.length, 6);
assert.equal(imported.project.mapFeatures?.[0].geometry.type, "Polygon");
assert.equal(imported.project.mapFeatures?.[1].geometry.type, "Circle");
assert.equal(imported.project.mapFeatures?.[2].kind, "machine_zone");
assert.equal(imported.project.mapFeatures?.[3].kind, "measurement_line");
assert.equal(imported.project.mapFeatures?.[4].kind, "linear_move_path");
assert.equal(imported.project.mapFeatures?.[5].kind, "well_location");
assert.equal(imported.project.machine.catalogSelection?.catalogId, "valley-8000-public-preset");
assert.equal(imported.project.machine.cornerArm?.id, "corner-arm-a");
assert.equal(imported.project.machine.cornerArm?.wheelTrackLengthMeters, 78);
assert.equal(imported.project.machine.cornerArm?.overhangLengthMeters, 13);
assert.equal(imported.project.machine.cornerArm?.maxSteerAngleDegrees, 162);
assert.equal(imported.project.machine.cornerArm?.speedEvidenceSourceRefs?.[0].sourceId, "SRC-LOCAL-CURATED-SPEED");
assert.equal(imported.project.machine.cornerArm?.metadataSource, "operator_supplied");
assert.equal(imported.project.machine.cornerArm?.modelFamily, "single_span_lrdu_sdu");
assert.equal(imported.project.machine.cornerArm?.sourceRefs[0].sourceId, "SRC-VALLEY-VFLEX-CORNER");
assert.equal(imported.project.machine.driveUnits?.lrdu?.tire?.label, "11.2-38");
assert.equal(imported.project.machine.driveUnits?.lrdu?.customMotorRpm, 0.75);
assert.equal(imported.project.machine.driveUnits?.sdu?.customTireLabel, "operator SDU tire");
assert.equal(imported.project.wgs84Companion?.status, "projected");
assert.equal(imported.project.wgs84Companion?.coordinateSystem, "decimal_degrees");
assert.match(imported.warnings.join("\n"), /projected XY as canonical/);

const gpsOnlySourceProject = { ...projectWithFeatures, surveyPoints: [], mapFeatures: [] };
const gpsOnlyXml = exportProjectMapXml(gpsOnlySourceProject).replace(/\s+x="[^"]+"\s+y="[^"]+"/g, "");
assert.doesNotMatch(gpsOnlyXml, /\sx="/);
assert.doesNotMatch(gpsOnlyXml, /\sy="/);
const importedGpsOnly = importProjectMapXmlToProject(gpsOnlyXml);
assert.equal(importedGpsOnly.project.fieldBoundary.length, gpsOnlySourceProject.fieldBoundary.length);
assert.ok(Math.abs(importedGpsOnly.project.pivotCenter.x - gpsOnlySourceProject.pivotCenter.x) < 0.001);
assert.ok(Math.abs(importedGpsOnly.project.pivotCenter.y - gpsOnlySourceProject.pivotCenter.y) < 0.001);
assert.match(importedGpsOnly.warnings.join("\n"), /GPS-only decimal-degree XML values were converted/);

assert.throws(
  () => importProjectMapXmlToProject(gpsOnlyXml.replace(`projectCrs="${gpsOnlySourceProject.projectCrs}"`, `projectCrs="EPSG:4326"`)),
  /GPS coordinates require project CRS\/calibration/,
);

assert.throws(
  () => importProjectMapXmlToProject(`<!DOCTYPE cplayoutMap><cplayoutMap version="${CPLAYOUT_MAP_XML_VERSION}"/>`),
  /DOCTYPE/,
);

assert.throws(
  () => importProjectMapXmlToProject(`<notCplayout/>`),
  /root element/,
);

assert.throws(
  () => importProjectMapXmlToProject(xml.replace(CPLAYOUT_MAP_XML_VERSION, "old-version")),
  /Unsupported CPLayout XML version/,
);

const measurementAreaProject: PivotProject = {
  ...sampleProject,
  mapFeatures: [{ id: "measurement-area", name: "Measurement area", kind: "measurement_area",
    geometry: { type: "Polygon", vertices: sampleProject.fieldBoundary.slice(0, 4) },
    confidence: "user_estimated", notes: "Area reference only.", properties: { designPurpose: "area" } }],
};
const measurementAreaXml = exportProjectMapXml(measurementAreaProject);
assert.match(measurementAreaXml, /kind="measurement_area"/);
const restoredMeasurementArea = importProjectMapXmlToProject(measurementAreaXml).project;
assert.deepEqual(restoredMeasurementArea.mapFeatures, measurementAreaProject.mapFeatures);
assert.deepEqual(restoredMeasurementArea.fieldBoundary, measurementAreaProject.fieldBoundary);

console.log("project XML tests passed");
