import assert from "node:assert/strict";

import { MAP_TOOL_CATALOG, draftMeasurementText } from "./mapTools";

assert.deepEqual(
  MAP_TOOL_CATALOG.map((tool) => tool.id),
  ["pan", "edit", "point", "line", "polygon", "circle"],
);
assert.equal(new Set(MAP_TOOL_CATALOG.map((tool) => tool.id)).size, MAP_TOOL_CATALOG.length);
assert.equal(MAP_TOOL_CATALOG.every((tool) => tool.testID.startsWith("map-tool-")), true);
assert.deepEqual(MAP_TOOL_CATALOG.find((tool) => tool.id === "polygon")?.action, { type: "draw", geometry: "Polygon" });
assert.deepEqual(MAP_TOOL_CATALOG.find((tool) => tool.id === "line")?.action, { type: "draw", geometry: "LineString" });
assert.deepEqual(MAP_TOOL_CATALOG.find((tool) => tool.id === "point")?.action, { type: "draw", geometry: "Point" });
assert.equal(MAP_TOOL_CATALOG.find((tool) => tool.id === "circle")?.action.type, "open_panel");
assert.equal(MAP_TOOL_CATALOG.find((tool) => tool.id === "pan")?.action.type, "activate");

console.log("map tool catalog tests passed");

const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
assert.equal(draftMeasurementText("LineString", ring.slice(0, 3), "EPSG:32613", "metric"), "XY length 20.0 m");
assert.equal(draftMeasurementText("LineString", ring.slice(0, 2), "EPSG:32613", "us_survey_feet"), "XY length 32.8 ft");
assert.equal(draftMeasurementText("Polygon", ring, "EPSG:32613", "metric"), "XY area 100.00 sq m; perimeter 40.0 m");
for (const scale of [1, 0.001]) {
  const small = ring.map(({ x, y }) => ({ x: x * scale, y: y * scale }));
  const shifted = small.map(({ x, y }) => ({ x: x + 600000, y: y + 4400000 }));
  assert.equal(draftMeasurementText("Polygon", shifted, "EPSG:32613", "metric"), draftMeasurementText("Polygon", small, "EPSG:32613", "metric"));
  assert.equal(draftMeasurementText("Polygon", [...shifted].reverse(), "EPSG:32613", "metric"), draftMeasurementText("Polygon", small, "EPSG:32613", "metric"));
}
for (const crs of ["EPSG:4326", "EPSG:3857", "LOCAL", "unknown"]) {
  assert.match(draftMeasurementText("Polygon", ring, crs, "metric"), /unqualified CRS/);
}
for (const invalid of [[ring[0], ring[2], ring[1], ring[3]], [ring[0], ring[1], ring[0]], [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]]) {
  assert.match(draftMeasurementText("Polygon", invalid, "EPSG:32613", "metric"), /Area unavailable/);
}
assert.match(draftMeasurementText("LineString", [{ x: NaN, y: 0 }, ring[0]], "EPSG:32613", "metric"), /invalid coordinates/);
assert.equal(draftMeasurementText("Point", [ring[0]], "EPSG:32613", "metric"), "");
