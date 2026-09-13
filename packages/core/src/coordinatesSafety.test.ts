import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  coordinateExample,
  formatCoordinate,
  parseCoordinateInput,
  parseWgs84Input,
  projectLonLatToXy,
  projectXyToLonLat,
  type CoordinateDisplayFormat,
} from "./coordinates";

const crs = "EPSG:32613";
type AngularFormat = Exclude<CoordinateDisplayFormat, "projected_local">;
const dd = "decimal_degrees";
const ddm = "degrees_decimal_minutes";
const dms = "degrees_minutes_seconds";

function angular(input: string, format: AngularFormat) {
  const result = parseWgs84Input(input, format);
  if (!result.ok) assert.fail(result.error);
  return result.coordinate;
}

function projected(input: string, projectCrs = crs) {
  const result = parseCoordinateInput(input, "projected_local", projectCrs);
  if (!result.ok) assert.fail(result.error);
  return result.coordinate;
}

test("regression: scientific projected input is consumed as two whole numbers", () => {
  assert.deepEqual(projected("1e6,4.5e6").projected, { x: 1000000, y: 4500000 });
});

for (const [input, x, y] of [
  ["X 410.5, Y 360.25", 410.5, 360.25],
  ["x: +.5; y= -2.E+3", 0.5, -2000],
  ["1e+6 4.5E6", 1000000, 4500000],
  ["1,2 ( epsg : 32613 )", 1, 2],
  ["1e308,-1e308", 1e308, -1e308],
] as const) {
  test(`projected accepts ${input}`, () => {
    assert.deepEqual(projected(input).projected, { x, y });
  });
}

for (const input of [
  "junk 1,2", "1,2 junk", "1,2,3", "1 2 3", "1e309,2", "1,NaN",
  "Infinity,2", "1e,2", "1e+,2", "1..2,3", "1_000,2", "0x10,2", "1,,2",
  "1/2", "1-2", "Y 1,X 2", "X X 1,Y 2", "1,2 (EPSG:32612)",
  "1,2 (EPSG:32613) junk", "1,2 (EPSG:32613) (EPSG:32613)",
]) {
  test(`projected rejects ${input}`, () => {
    assert.equal(parseCoordinateInput(input, "projected_local", crs).ok, false);
  });
}

test("projected LOCAL input keeps XY and the selected CRS verbatim", () => {
  const result = projected("X -0,Y 4.5e6 (LOCAL:FIELD)", " local:field ");
  assert.ok(Object.is(result.projected.x, -0));
  assert.equal(result.projected.y, 4500000);
  assert.equal(result.projectCrs, " local:field ");
  const reparsed = projected(formatCoordinate(result, "projected_local"), result.projectCrs);
  assert.ok(Object.is(reparsed.projected.x, -0));
});

test("formatted projected values can be pasted only into their selected CRS", () => {
  const original = { projected: { x: 123.25, y: -456.75 }, projectCrs: crs };
  const formatted = formatCoordinate(original, "projected_local");
  assert.deepEqual(projected(formatted), original);
  assert.equal(parseCoordinateInput(formatted, "projected_local", "LOCAL").ok, false);
});

for (const projectCrs of [
  "EPSG:4326", "CRS:84", "OGC:CRS84", " epsg : 4326 ",
  "EPSG:999999", "EPSG:32600", "EPSG:32661", "unrecognized", "",
]) {
  test(`projected input rejects invalid selected CRS ${JSON.stringify(projectCrs)}`, () => {
    for (const input of ["1,2", `1,2 (${projectCrs})`]) {
      const result = parseCoordinateInput(input, "projected_local", projectCrs);
      if (result.ok) assert.fail(`Accepted invalid selected CRS ${projectCrs}`);
      assert.match(result.error, /projected CRS required/i);
    }
  });
}

for (const projectCrs of ["LOCAL", " local:field ", " epsg : 32613 "]) {
  test(`projected input validates but preserves selected CRS ${JSON.stringify(projectCrs)}`, () => {
    const result = projected(`X 1,Y 2 (${projectCrs})`, projectCrs);
    assert.equal(result.projectCrs, projectCrs);
    assert.deepEqual(result.projected, { x: 1, y: 2 });
  });
}

for (const format of [dd, ddm, dms, "projected_local"] as const) {
  for (const point of [
    { x: NaN, y: 0 }, { x: Infinity, y: 0 }, { x: 0, y: -Infinity },
  ]) {
    test(`${format} formatting rejects nonfinite XY ${String(point.x)},${String(point.y)}`, () => {
      assert.throws(() => formatCoordinate({
        projected: point, projectCrs: crs, wgs84: { latitude: 40, longitude: -105 },
      }, format), /finite.*X and Y/i);
    });
  }
  for (const wgs84 of [
    { latitude: NaN, longitude: 0 }, { latitude: Infinity, longitude: 0 },
    { latitude: 0, longitude: -Infinity }, { latitude: 90.1, longitude: 0 },
    { latitude: -90.1, longitude: 0 }, { latitude: 0, longitude: 180.1 },
    { latitude: 0, longitude: -180.1 },
  ]) {
    test(`${format} formatting rejects invalid supplied WGS84 ${String(wgs84.latitude)},${String(wgs84.longitude)}`, () => {
      assert.throws(() => formatCoordinate({
        projected: { x: 0, y: 0 }, projectCrs: crs, wgs84,
      }, format), /Latitude|Longitude/);
    });
  }
}

test("angular formatting still supports inverse projection when WGS84 is absent", () => {
  const wgs84 = { latitude: 40, longitude: -105 };
  const coordinate = { projected: projectLonLatToXy(wgs84, crs), projectCrs: crs };
  for (const format of [dd, ddm, dms] as const) {
    assert.deepEqual(angular(formatCoordinate(coordinate, format), format), wgs84);
  }
});

for (const [input, latitude, longitude] of [
  ["4e1,-1.04e2", 40, -104],
  ["N 4E+1, W 1.04e2", 40, -104],
  ["4e1 N 1.04e2 W", 40, -104],
  ["+.5, -.25", 0.5, -0.25],
  ["40. N; 104. W", 40, -104],
  ["40\u00b0 N, 104\u00b0 W", 40, -104],
  ["-40 S, -104 W", -40, -104],
  ["+40 N,+104 E", 40, 104],
] as const) {
  test(`DD accepts ${input}`, () => {
    assert.deepEqual(angular(input, dd), { latitude, longitude });
  });
}

for (const input of [
  "junk 40,-104", "40,-104 garbage", "40,-104,5", "40,-104e", "40,-104e+",
  "40,1e309", "NaN,-104", "40,Infinity", "40, -104 10", "40 N,104 E W",
  "40 S N,104 W", "N 40 N, W 104", "40 W,104 N", "40 E,104 W",
  "-40 N,104 W", "+40 S,104 W", "40 N,-104 E", "40 N,+104 W",
  "-0 N,104 W", "40 N,-0 E", "40 north,104 west", "40,,104",
  "40-104", "91,0", "0,181", "1e2,0",
]) {
  test(`DD rejects ${input}`, () => assert.equal(parseWgs84Input(input, dd).ok, false));
}

const angularAccepted: Array<[AngularFormat, string, number, number]> = [
  [ddm, "40 30 N,104 15 W", 40.5, -104.25],
  [ddm, "N 40 30 W 104 15", 40.5, -104.25],
  [ddm, "40\u00b030\u2032N 104\u00b015\u2032W", 40.5, -104.25],
  [ddm, "N40\u00b0 30\u2019, W104\u00b0 15\u2019", 40.5, -104.25],
  [ddm, "40 30 -104 15", 40.5, -104.25],
  [ddm, "40 30, -104 15", 40.5, -104.25],
  [ddm, "40 .5 N,104 .25 W", 40 + 0.5 / 60, -(104 + 0.25 / 60)],
  [dms, "40 30 0 N,104 15 0 W", 40.5, -104.25],
  [dms, "N40\u00b030\u20320\u2033 W104\u00b015\u20320\u2033", 40.5, -104.25],
  [dms, "40\u00b030\u20190\u201dN,104\u00b015\u20190\u201dW", 40.5, -104.25],
  [dms, "40 30 0 -104 15 0", 40.5, -104.25],
  [dms, "40 30 0 N W 104 15 0", 40.5, -104.25],
  [dms, "-40 30 0 S,-104 15 0 W", -40.5, -104.25],
];
for (const [format, input, latitude, longitude] of angularAccepted) {
  test(`${format} accepts ${input}`, () => {
    assert.deepEqual(angular(input, format), { latitude, longitude });
  });
}

const angularRejected: Array<[AngularFormat, string]> = [
  [ddm, "40 30 15 N,104 15 12 W"], [ddm, "40 30 N,104 15 W 1"],
  [ddm, "40 30 N,104 W"], [ddm, "40 30 N,104 15 W junk"],
  [ddm, "N40 30 S,W104 15"], [ddm, "40 30 NN,104 15 W"],
  [ddm, "40 30 W,104 15 N"], [ddm, "-40 30 N,104 15 W"],
  [ddm, "+40 30 S,104 15 W"], [ddm, "40 30 N,-104 15 E"],
  [ddm, "40 60 N,104 15 W"], [ddm, "40 -1 N,104 15 W"],
  [ddm, "40 -0 N,104 15 W"], [ddm, "40.5 1 N,104 15 W"],
  [ddm, "40 3e1 N,104 15 W"], [ddm, "40 30\" N,104 15 W"],
  [ddm, "90 0.1 N,104 15 W"], [ddm, "40 30 N,180 0.1 W"],
  [dms, "40 30 N,104 15 W"], [dms, "40 30 1 2 N,104 15 1 2 W"],
  [dms, "junk 40 30 0 N,104 15 0 W"], [dms, "40 30 0 S N,104 15 0 W"],
  [dms, "40 30 0 E,104 15 0 W"], [dms, "40 30 60 N,104 15 0 W"],
  [dms, "40 60 0 N,104 15 0 W"], [dms, "40 30 -1 N,104 15 0 W"],
  [dms, "40 30.5 0 N,104 15 0 W"], [dms, "40 30 0 N,104 15 0 W extra"],
  [dms, "-0 30 0 N,104 15 0 W"], [dms, "40 30 0 N,+0 15 0 W"],
  [dms, "40\u203230\u00b00 N,104 15 0 W"],
];
for (const [format, input] of angularRejected) {
  test(`${format} rejects ${input}`, () => assert.equal(parseWgs84Input(input, format).ok, false));
}

for (const [format, input] of [
  [dd, "-0,-0"], [dd, "0 S,0 W"], [dd, "-0 S,-0 W"],
  [ddm, "-0 0,-0 0"], [ddm, "0 0 S,0 0 W"],
  [dms, "-0 0 0,-0 0 0"], [dms, "0 0 0 S,0 0 0 W"],
] as const) {
  test(`${format} retains negative zero: ${input}`, () => {
    const result = angular(input, format);
    assert.ok(Object.is(result.latitude, -0));
    assert.ok(Object.is(result.longitude, -0));
    const formatted = formatCoordinate({ projected: { x: 0, y: 0 }, projectCrs: crs, wgs84: result }, format);
    const reparsed = angular(formatted, format);
    assert.ok(Object.is(reparsed.latitude, -0));
    assert.ok(Object.is(reparsed.longitude, -0));
  });
}

test("negative zero degrees give a negative subdegree angle", () => {
  assert.deepEqual(angular("-0 30,-0 15", ddm), { latitude: -0.5, longitude: -0.25 });
  assert.deepEqual(angular("-0 30 0,-0 15 0", dms), { latitude: -0.5, longitude: -0.25 });
});

for (const format of [dd, ddm, dms] as const) {
  test(`${format} preserves the public example`, () => {
    assert.equal(parseCoordinateInput(coordinateExample(format), format, crs).ok, true);
  });

  test(`${format} seeded and boundary display round trips stay within display precision`, () => {
    let state = 0x13579bdf;
    const next = () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const fixtures = [
      { latitude: 40 + 59 / 60 + 59.99999 / 3600, longitude: -104.999999999 },
      { latitude: 40 + 12 / 60 + 59.99999 / 3600, longitude: -(104 + 59.9999999 / 60) },
      { latitude: 89.9999999999, longitude: -179.9999999999 },
      { latitude: -90, longitude: 180 }, { latitude: 0, longitude: 0 },
      ...Array.from({ length: 1000 }, () => ({ latitude: next() * 180 - 90, longitude: next() * 360 - 180 })),
    ];
    const tolerance = format === dd ? 0.500001e-6 : format === ddm ? 0.000050001 / 60 : 0.0050001 / 3600;
    for (const wgs84 of fixtures) {
      const output = formatCoordinate({ projected: { x: 0, y: 0 }, projectCrs: crs, wgs84 }, format);
      const result = angular(output, format);
      assert.ok(Math.abs(result.latitude - wgs84.latitude) <= tolerance, output);
      assert.ok(Math.abs(result.longitude - wgs84.longitude) <= tolerance, output);
    }
  });
}

for (const coordinate of [
  { latitude: 91, longitude: 0 }, { latitude: -91, longitude: 0 },
  { latitude: 0, longitude: 181 }, { latitude: 0, longitude: -181 },
  { latitude: NaN, longitude: 0 }, { latitude: Infinity, longitude: 0 },
  { latitude: 0, longitude: -Infinity },
]) {
  test(`forward rejects ${String(coordinate.latitude)},${String(coordinate.longitude)}`, () => {
    assert.throws(() => projectLonLatToXy(coordinate, "EPSG:3857"), Error);
  });
}

for (const point of [
  { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: -Infinity, y: 0 },
  { x: 1e100, y: 1e100 },
]) {
  test(`inverse rejects nonfinite input or out-of-range output ${String(point.x)},${String(point.y)}`, () => {
    assert.throws(() => projectXyToLonLat(point, "EPSG:3857"), Error);
  });
}

test("direct transforms normalize accepted CRS spelling", () => {
  const wgs84 = { latitude: 40, longitude: -105 };
  const xy = projectLonLatToXy(wgs84, crs);
  assert.deepEqual(projectLonLatToXy(wgs84, " epsg : 32613 "), xy);
  assert.deepEqual(projectXyToLonLat(xy, " epsg : 32613 "), projectXyToLonLat(xy, crs));
});

test("LOCAL transforms fail with a clean Error and parsing reports it", () => {
  assert.throws(() => projectLonLatToXy({ latitude: 40, longitude: -105 }, "LOCAL:FIELD"), /LOCAL/);
  assert.throws(() => projectXyToLonLat({ x: 1, y: 2 }, "LOCAL:FIELD"), /LOCAL/);
  const result = parseCoordinateInput("40,-105", dd, "LOCAL:FIELD");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /LOCAL/);
});

test("seeded UTM forward/inverse consistency, synthetic only", () => {
  let state = 0xc0ffee;
  const next = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let i = 0; i < 1000; i += 1) {
    const zone = 1 + Math.floor(next() * 60);
    const latitude = -79 + next() * 162;
    const longitude = zone * 6 - 183 + (next() - 0.5) * 5.8;
    const projectCrs = `EPSG:${latitude < 0 ? 32700 + zone : 32600 + zone}`;
    const source = { latitude, longitude };
    const result = projectXyToLonLat(projectLonLatToXy(source, projectCrs), projectCrs);
    assert.ok(Math.abs(result.latitude - latitude) < 1e-8);
    assert.ok(Math.abs(result.longitude - longitude) < 1e-8);
  }
});

test("independent local PROJ 9.4 oracle: 168 synthetic fixtures", () => {
  const report = JSON.parse(readFileSync(join(__dirname, "fixtures", "proj-wgs84-utm.json"), "utf8")) as {
    syntheticOnly: boolean;
    physicalAccuracyClaim: boolean;
    source: { repositoryRelativePath: string; sha256: string; expectedValues: string };
    tool: { name: string; version: string; versionBanner: string };
    network: string;
    cli: { inputAxisOrder: string[]; flags: string[] };
    count: number;
    records: Array<{ crs: string; input: { latitude: number; longitude: number }; proj: { x: number; y: number } }>;
  };
  assert.equal(report.syntheticOnly, true);
  assert.equal(report.physicalAccuracyClaim, false);
  assert.equal(report.source.repositoryRelativePath, "reports/continuous-improvement/coordinate-review-20260913/proj-oracle.json");
  assert.equal(report.source.sha256, "9d2acfa4716fee06175eb5a60ca32d8ded418c50bf15e082533efaaf2240a02b");
  assert.equal(report.source.expectedValues, "records[].proj");
  assert.deepEqual(report.tool, { name: "PROJ", version: "9.4.0", versionBanner: "Rel. 9.4.0, March 1st, 2024" });
  assert.equal(report.network, "OFF");
  assert.deepEqual(report.cli.inputAxisOrder, ["latitude", "longitude"]);
  assert.deepEqual(report.cli.flags, ["--no-ballpark", "--only-best=yes", "-f %.9f"]);
  assert.equal(report.count, 168);
  assert.equal(report.records.length, 168);
  let maxMeters = 0;
  for (const record of report.records) {
    const xy = projectLonLatToXy(record.input, record.crs);
    const error = Math.hypot(xy.x - record.proj.x, xy.y - record.proj.y);
    maxMeters = Math.max(maxMeters, error);
    assert.ok(error < 1e-6, `${record.crs}: ${error}`);
    const inverse = projectXyToLonLat(record.proj, record.crs);
    assert.ok(Math.abs(inverse.latitude - record.input.latitude) < 1e-8);
    assert.ok(Math.abs(inverse.longitude - record.input.longitude) < 1e-8);
  }
  console.log(`Synthetic oracle maximum difference: ${maxMeters} meters; no field accuracy claim.`);
});
