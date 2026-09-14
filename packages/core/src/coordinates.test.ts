import assert from "node:assert/strict";

import {
  formatCoordinate,
  parseCoordinateInput,
  parseWgs84Input,
  projectLonLatToXy,
  projectXyToLonLat,
} from "./coordinates";

const projectCrs = "EPSG:32613";
const wgs84 = { latitude: 40.7102367, longitude: -104.9878583 };

const dd = parseCoordinateInput("40.7102367, -104.9878583", "decimal_degrees", projectCrs);
assert.equal(dd.ok, true);
if (dd.ok) {
  assert.ok(dd.coordinate.projected.x > 500000);
  assert.ok(dd.coordinate.projected.y > 4500000);
}

const ddm = parseWgs84Input("40 42.6142 N, 104 59.2715 W", "degrees_decimal_minutes");
assert.equal(ddm.ok, true);
if (ddm.ok) {
  assert.ok(Math.abs(ddm.coordinate.latitude - wgs84.latitude) < 0.00001);
  assert.ok(Math.abs(ddm.coordinate.longitude - wgs84.longitude) < 0.00001);
}

const dms = parseWgs84Input("40 42 36.852 N, 104 59 16.290 W", "degrees_minutes_seconds");
assert.equal(dms.ok, true);
if (dms.ok) {
  assert.ok(Math.abs(dms.coordinate.latitude - wgs84.latitude) < 0.00002);
  assert.ok(Math.abs(dms.coordinate.longitude - wgs84.longitude) < 0.00002);
}

const projected = parseCoordinateInput("X 410.5, Y 360.25", "projected_local", projectCrs);
assert.equal(projected.ok, true);
if (projected.ok) {
  assert.deepEqual(projected.coordinate.projected, { x: 410.5, y: 360.25 });
  assert.equal(formatCoordinate(projected.coordinate, "projected_local"), "X 410.50, Y 360.25 (EPSG:32613)");
}

const xy = projectLonLatToXy(wgs84, projectCrs);
const roundTrip = projectXyToLonLat(xy, projectCrs);
assert.ok(Math.abs(roundTrip.latitude - wgs84.latitude) < 0.000001);
assert.ok(Math.abs(roundTrip.longitude - wgs84.longitude) < 0.000001);

const southern = parseCoordinateInput("-40, 171", "decimal_degrees", " epsg : 32759 ");
assert.equal(southern.ok, true);
if (southern.ok) {
  assert.equal(southern.coordinate.projectCrs, " epsg : 32759 ");
  assert.ok(Math.abs(southern.coordinate.projected.x - 500000) < 1e-6);
  assert.ok(southern.coordinate.projected.y > 5500000);
  const inverse = projectXyToLonLat(southern.coordinate.projected, southern.coordinate.projectCrs);
  assert.ok(Math.abs(inverse.latitude + 40) < 1e-8);
  assert.ok(Math.abs(inverse.longitude - 171) < 1e-8);
}

const formattedDms = formatCoordinate({ projected: xy, projectCrs, wgs84 }, "degrees_minutes_seconds");
assert.match(formattedDms, /40° 42' 36\.85" N 104° 59' 16\.29" W/);

const invalidLatitude = parseCoordinateInput("140.1, -104.9", "decimal_degrees", projectCrs);
assert.equal(invalidLatitude.ok, false);
if (!invalidLatitude.ok) assert.match(invalidLatitude.error, /Latitude/);

const invalidProjected = parseCoordinateInput("410 only", "projected_local", projectCrs);
assert.equal(invalidProjected.ok, false);

console.log("coordinate format tests passed");
