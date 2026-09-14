import assert from "node:assert/strict";
import test from "node:test";
import proj4 from "proj4";

import { parseCoordinateInput, projectLonLatToXy, projectXyToLonLat } from "./coordinates";
import {
  assertMetricCalculationCrs,
  getSupportedUtmCrs,
  qualifyProjectCrs,
  type CrsQualificationOptions,
} from "./crsQualification";
import { parseProjectDocument, serializeProjectDocument } from "./projectDocument";
import { sampleProject } from "./sampleProject";

const localMetricDeclaration = {
  projectCrs: "LOCAL:FIELD",
  unit: "metre",
  axes: "orthogonal_xy",
  evidenceReference: "synthetic-local-coordinate-contract",
} as const;

for (const [minimum, maximum, datum, hemisphere] of [
  [32601, 32660, "WGS84", "north"],
  [32701, 32760, "WGS84", "south"],
  [26701, 26722, "NAD27", "north"],
  [26901, 26923, "NAD83", "north"],
] as const) {
  test(`${minimum}-${maximum} have exact UTM definitions and metre east/north axes`, () => {
    for (let code = minimum; code <= maximum; code += 1) {
      const crs = `EPSG:${code}`;
      const definition = getSupportedUtmCrs(crs);
      assert.ok(definition, crs);
      assert.equal(definition.zone, code % 100);
      assert.equal(definition.datum, datum);
      assert.equal(definition.hemisphere, hemisphere);
      assert.equal(definition.unit, "metre");
      assert.equal(definition.axes, "easting_northing");
      const result = assertMetricCalculationCrs(crs);
      assert.equal(result.calculation.space, "projected_grid");
      assert.equal(result.legacyDocumentCrsReadable, true);
      assert.equal(result.field.qualified, false);
      assert.equal(result.field.groundDistanceQualified, false);
      assert.equal(result.field.georeferencingQualified, false);
      assert.equal(result.field.accuracy3dQualified, false);
      assert.equal(result.field.areaOfUse, "missing");
      assert.equal(result.field.groundScale, "missing");
      assert.equal(result.field.height, "missing");
      assert.equal(result.field.independentControl, "missing");
      assert.equal(result.field.datumOperation, datum === "WGS84" ? "missing" : "unsupported");
    }
  });
}

test("26741 stays readable as feet, without a fabricated UTM zone 41", () => {
  const result = qualifyProjectCrs("EPSG:26741");
  assert.equal(result.legacyDocumentCrsReadable, true);
  assert.equal(result.unit, "us_survey_foot");
  assert.equal(result.axes, "easting_northing");
  assert.equal(result.calculation.allowed, false);
  assert.ok(result.calculation.blockers.includes("non_metric_units"));
  assert.equal(getSupportedUtmCrs("EPSG:26741"), undefined);
  assert.throws(() => assertMetricCalculationCrs("EPSG:26741"), /non_metric_units/);
});

for (const code of [26700, 26723, 26728, 26729, 26741, 26760, 26761, 26900, 26924, 26928, 26929, 26941, 26960, 26961, 32600, 32661, 32700, 32761]) {
  test(`unsupported EPSG:${code} never acquires a guessed UTM definition`, () => {
    const crs = `EPSG:${code}`;
    assert.equal(getSupportedUtmCrs(crs), undefined);
    assert.equal(qualifyProjectCrs(crs).calculation.allowed, false);
    assert.throws(() => projectLonLatToXy({ longitude: -105, latitude: 40 }, crs), Error);
    assert.throws(() => projectXyToLonLat({ x: 500000, y: 4400000 }, crs), Error);
  });
}

for (const crs of ["EPSG:3857", "EPSG:900913", " epsg : 3857 "]) {
  test(`${crs} remains usable for display, never for ground-distance qualification`, () => {
    const result = qualifyProjectCrs(crs);
    assert.equal(result.legacyDocumentCrsReadable, true);
    assert.equal(result.unit, "metre");
    assert.equal(result.wgs84Transform, "display_only");
    assert.deepEqual(result.calculation.blockers, ["web_mercator_display_only"]);
    assert.equal(result.field.groundDistanceQualified, false);
    const xy = projectLonLatToXy({ latitude: 40, longitude: -105 }, crs);
    const inverse = projectXyToLonLat(xy, crs);
    assert.ok(Math.abs(inverse.latitude - 40) < 1e-10);
    assert.ok(Math.abs(inverse.longitude + 105) < 1e-10);
    assert.throws(() => assertMetricCalculationCrs(crs), /web_mercator_display_only/);
  });
}

test("qualification preserves the original CRS while normalizing case and spacing for lookup", () => {
  const result = qualifyProjectCrs(" epsg : 32613 ");
  assert.equal(result.projectCrs, " epsg : 32613 ");
  assert.equal(result.normalizedCrs, "EPSG:32613");
  assert.equal(result.calculation.allowed, true);
  assert.equal(qualifyProjectCrs(" ePsG : 26741 ").unit, "us_survey_foot");
});

for (const crs of ["LOCAL", "LOCAL:FIELD", "LOCAL:METRIC", "LOCAL:IMAGE", " local:field "]) {
  test(`${crs} alone establishes neither metre axes nor georeferencing`, () => {
    const result = qualifyProjectCrs(crs);
    assert.equal(result.legacyDocumentCrsReadable, true);
    assert.equal(result.unit, "unknown");
    assert.equal(result.axes, "local_xy");
    assert.deepEqual(result.calculation.blockers, ["local_metric_declaration_missing"]);
    assert.equal(result.field.datumOperation, "local_unreferenced");
    assert.equal(result.field.accuracy3dQualified, false);
  });
}

test("an explicit LOCAL metre declaration admits planar arithmetic only", () => {
  const declaration = Object.freeze({ ...localMetricDeclaration });
  const result = assertMetricCalculationCrs(" local : field ", { localMetricDeclaration: declaration });
  assert.equal(result.unit, "metre");
  assert.equal(result.calculation.space, "local_plane");
  assert.equal(result.wgs84Transform, "unavailable");
  assert.equal(result.field.groundDistanceQualified, false);
  assert.equal(result.field.georeferencingQualified, false);
  assert.equal(result.field.accuracy3dQualified, false);
  assert.equal(result.field.groundScale, "missing");
  assert.equal(result.field.height, "missing");
  assert.deepEqual(declaration, localMetricDeclaration);
});

test("LOCAL declarations need matching CRS, metre units, orthogonal axes and an evidence reference", () => {
  for (const change of [
    { projectCrs: "LOCAL:OTHER" }, { projectCrs: undefined },
    { unit: "feet" }, { axes: "pixel_xy" }, { evidenceReference: "  " },
    { evidenceReference: undefined },
  ]) {
    const options = { localMetricDeclaration: { ...localMetricDeclaration, ...change } } as CrsQualificationOptions;
    const result = qualifyProjectCrs("LOCAL:FIELD", options);
    assert.deepEqual(result.calculation.blockers, ["local_metric_declaration_invalid"]);
    assert.equal(result.calculation.allowed, false);
  }
  assert.equal(qualifyProjectCrs("EPSG:26741", { localMetricDeclaration }).calculation.allowed, false);
  assert.equal(qualifyProjectCrs("EPSG:3857", { localMetricDeclaration }).calculation.allowed, false);
});

for (const crs of ["EPSG:4326", " epsg : 4326 ", "CRS:84", "OGC:CRS84"]) {
  test(`${crs} is angular input, never canonical metric XY`, () => {
    const result = qualifyProjectCrs(crs);
    assert.equal(result.legacyDocumentCrsReadable, false);
    assert.equal(result.kind, "geographic");
    assert.equal(result.unit, "degree");
    assert.equal(result.axes, result.normalizedCrs === "EPSG:4326" ? "latitude_longitude" : "longitude_latitude");
    assert.ok(result.calculation.blockers.includes("geographic_input_only"));
    assert.equal(result.calculation.allowed, false);
    assert.equal(parseCoordinateInput("40,-105", "projected_local", crs).ok, false);
  });
}

test("valid NAD UTM grid calculations do not authorize implicit WGS84 datum conversion", () => {
  for (const crs of ["EPSG:26713", "EPSG:26913"]) {
    assert.equal(assertMetricCalculationCrs(crs).wgs84Transform, "unsupported_datum_operation");
    assert.throws(() => projectLonLatToXy({ latitude: 40, longitude: -105 }, crs), /verified datum operation/);
    assert.throws(() => projectXyToLonLat({ x: 500000, y: 4400000 }, crs), /verified datum operation/);
    const input = parseCoordinateInput("40,-105", "decimal_degrees", crs);
    assert.equal(input.ok, false);
    if (!input.ok) assert.match(input.error, /verified datum operation/);
  }
});

test("independent PROJ 9.4 same-datum synthetic oracle checks NAD projection definitions", () => {
  // PROJ_NETWORK=OFF cs2cs EPSG:4267 EPSG:26713 --no-ballpark --only-best=yes -f %.9f
  // and EPSG:4269 EPSG:26913; stdin: 40 -105 (latitude, longitude). No datum/field proof.
  for (const [crs, datum, northing] of [
    ["EPSG:26713", "NAD27", 4427547.180373445],
    ["EPSG:26913", "NAD83", 4427757.218624494],
  ] as const) {
    const definition = getSupportedUtmCrs(crs);
    assert.ok(definition);
    const [x, y] = proj4(`+proj=longlat +datum=${datum} +no_defs`, definition.proj4Definition, [-105, 40]);
    assert.ok(Math.abs(x - 500000) < 1e-6);
    assert.ok(Math.abs(y - northing) < 1e-6);
  }
});

test("legacy parse/save/reparse preserves all XY and CRS labels for calculation-blocked documents", () => {
  for (const projectCrs of ["EPSG:26741", " epsg : 26741 ", "EPSG:26723", "EPSG:26929", "EPSG:26913", "EPSG:3857", "LOCAL:FIELD"]) {
    const original = { ...sampleProject, projectCrs, mapFeatures: sampleProject.mapFeatures ?? [] };
    const before = JSON.stringify(original);
    const parsed = parseProjectDocument(serializeProjectDocument(original));
    const reparsed = parseProjectDocument(serializeProjectDocument(parsed));
    for (const result of [parsed, reparsed]) {
      assert.equal(result.projectCrs, projectCrs);
      for (const key of ["fieldBoundary", "pivotCenter", "waterSource", "powerSource", "obstacles", "surveyPoints", "mapFeatures"] as const) {
        assert.deepEqual(result[key], original[key], `${projectCrs}: ${key}`);
      }
      if (projectCrs !== "EPSG:3857") assert.equal(result.wgs84Companion?.status, "unavailable");
    }
    assert.equal(JSON.stringify(original), before);
  }
});
