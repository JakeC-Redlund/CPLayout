import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleProject, type PivotProject, type XY, type MultiPolygonXY } from "@cplayout/core";
import { evaluateCornerArmPath, multiPolygonAreaSquareMeters } from "./geometry";

function fixture(): PivotProject {
  const project = structuredClone(sampleProject);
  project.pivotCenter = { x: 0, y: 0 };
  project.fieldBoundary = [{ x: -2000, y: -2000 }, { x: 2000, y: -2000 }, { x: 2000, y: 2000 }, { x: -2000, y: 2000 }];
  project.mapFeatures = [];
  project.machine = { ...project.machine, spanLengthsMeters: [400], overhangMeters: 0, endGunThrowMeters: 0,
    towerClearanceBufferMeters: 0.5, machineClearanceBufferMeters: 0.5,
    sweep: { mode: "full_circle" },
    cornerArm: { id: "synthetic-closure", name: "Synthetic closure", advisoryOnly: true, lengthMeters: 100,
      wheelTrackLengthMeters: 90, overhangLengthMeters: 10, guidanceType: "operator_supplied",
      sequencingType: "operator_supplied", orientation: "operator_supplied", confidence: "user_estimated",
      sourceRefs: [{ sourceId: "SYNTHETIC", limit: "Not hardware or surveyed evidence" }] } };
  return project;
}

function insideRing(point: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function inside(point: XY, shape: MultiPolygonXY): boolean {
  return shape.some(([outer, ...holes]) => insideRing(point, outer) && !holes.some(hole => insideRing(point, hole)));
}
const midpoint = (a: XY, b: XY): XY => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const polar = (radius: number, angle: number): XY => ({ x: radius * Math.cos(angle * Math.PI / 180), y: radius * Math.sin(angle * Math.PI / 180) });

test("full-circle wheel and overhang buffers include the closing chord without changing samples or input", () => {
  const project = fixture(), before = structuredClone(project);
  const result = evaluateCornerArmPath(project)!;
  const samples = result.sampledPathPoints;
  for (const [radius, envelope, lines] of [[490, result.wheelTrackEnvelope, result.wheelTrackCenterlineSegments],
    [500, result.overhangEndEnvelope, result.overhangEndCenterlineSegments]] as const) {
    const a = polar(radius, samples[0].angleDegrees), b = polar(radius, samples.at(-1)!.angleDegrees);
    const center = midpoint(a, b);
    assert.ok(Math.hypot(center.x - a.x, center.y - a.y) > 2, "point is outside endpoint buffers");
    assert.ok(inside(center, envelope), "closing segment interior must be buffered");
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    for (const offset of [-0.75, -0.25, 0.25, 0.75]) {
      assert.equal(inside({ x: center.x - (b.y - a.y) / length * offset,
        y: center.y + (b.x - a.x) / length * offset }, envelope), Math.abs(offset) < 0.5);
    }
    assert.equal(inside(project.pivotCenter, envelope), false, "buffer must retain its central hole");
    assert.deepEqual(lines[0][0], lines[0].at(-1));
  }
  assert.equal(new Set(samples.map(point => point.sequenceIndex)).size, samples.length);
  assert.equal(result.extensionSlopeSummary.sampleCount, samples.length);
  assert.deepEqual(project, before);
});

test("cyclic reach slope includes the final-to-first change but keeps sample counts unique", () => {
  const project = fixture();
  project.mapFeatures = [
    { id: "lower", name: "Synthetic lower", kind: "corner_swing_limit", confidence: "user_estimated",
      geometry: { type: "Polygon", vertices: [{ x: -1000, y: -1000 }, { x: 1000, y: -1000 }, { x: 1000, y: -0.1 }, { x: -1000, y: -0.1 }] } },
    { id: "upper", name: "Synthetic upper", kind: "corner_swing_limit", confidence: "user_estimated",
      geometry: { type: "Polygon", vertices: [{ x: -1000, y: 0 }, { x: 425, y: 0 }, { x: 425, y: 1000 }, { x: -1000, y: 1000 }] } },
  ];
  const result = evaluateCornerArmPath(project)!;
  const points = result.sampledPathPoints;
  const retraction = (points.at(-1)!.overhangEndExtensionMeters - points[0].overhangEndExtensionMeters) / 1.25;
  assert.ok(retraction > 50, "fixture isolates a large change at the cyclic boundary");
  assert.ok(Math.abs(result.extensionSlopeSummary.maxRetractionMetersPerDegree - retraction) < 0.002);
  assert.equal(result.extensionSlopeSummary.sampleCount, points.length);
});

test("missing zero-degree support is not closed across the unsupported interval", () => {
  const project = fixture();
  project.mapFeatures = [{ id: "upper", name: "Synthetic upper", kind: "corner_swing_limit", confidence: "user_estimated",
    geometry: { type: "Polygon", vertices: [{ x: -1000, y: 5 }, { x: 1000, y: 5 }, { x: 1000, y: 1000 }, { x: -1000, y: 1000 }] } }];
  const result = evaluateCornerArmPath(project)!;
  assert.ok(result.sampledPathPoints[0].sequenceIndex > 0);
  assert.ok(result.sampledPathPoints.at(-1)!.sequenceIndex < 287);
  const line = result.overhangEndCenterlineSegments[0];
  assert.notDeepEqual(line[0], line.at(-1));
  assert.equal(inside(midpoint(line[0], line.at(-1)!), result.overhangEndEnvelope), false);
});

test("only the two cyclic neighbors can form a wrap segment amid otherwise absent support", () => {
  for (const indices of [[], [0], [287], [0, 287]]) {
    const project = fixture();
    project.mapFeatures = (indices.length ? indices : [144]).map(index => {
      const point = polar(indices.length ? 500 : 1500, index * 1.25);
      return { id: `sample-${index}`, name: "Synthetic isolated sample", kind: "corner_swing_limit" as const, confidence: "user_estimated" as const,
        geometry: { type: "Polygon" as const, vertices: [
          { x: point.x - 0.2, y: point.y - 0.2 }, { x: point.x + 0.2, y: point.y - 0.2 },
          { x: point.x + 0.2, y: point.y + 0.2 }, { x: point.x - 0.2, y: point.y + 0.2 }] } };
    });
    const result = evaluateCornerArmPath(project)!;
    assert.deepEqual(result.sampledPathPoints.map(point => point.sequenceIndex), indices);
    for (const point of result.sampledPathPoints) {
      assert.ok(inside(point.point, result.overhangEndEnvelope), "isolated overhang samples retain their cap");
      assert.ok(inside(polar(point.wheelTrackRadiusMeters, point.angleDegrees), result.wheelTrackEnvelope), "isolated wheel samples retain their cap");
    }
    if (indices.length === 0) {
      assert.deepEqual(result.overhangEndEnvelope, []);
      assert.deepEqual(result.wheelTrackEnvelope, []);
    }
    assert.equal(inside(midpoint(polar(500, 0), polar(500, 358.75)), result.overhangEndEnvelope), indices.length === 2);
    assert.equal(result.overhangEndCenterlineSegments.length, indices.length === 2 ? 1 : 0);
  }
});

test("closing-segment membership and input immutability hold at UTM-sized offsets", () => {
  const project = fixture();
  const offset = { x: 500000, y: 4500000 };
  project.pivotCenter = offset;
  project.fieldBoundary = project.fieldBoundary.map(point => ({ x: point.x + offset.x, y: point.y + offset.y }));
  const before = structuredClone(project);
  const result = evaluateCornerArmPath(project)!;
  for (const [radius, envelope] of [[490, result.wheelTrackEnvelope], [500, result.overhangEndEnvelope]] as const) {
    const center = midpoint(polar(radius, 0), polar(radius, 358.75));
    assert.ok(inside({ x: center.x + offset.x, y: center.y + offset.y }, envelope));
    assert.equal(inside(offset, envelope), false);
  }
  assert.deepEqual(project, before);
});

for (const direction of ["clockwise", "counterclockwise"] as const) {
  for (const [start, span] of [[0, 358.75], [350, 90], [10, 359]]) {
    test(`partial ${direction} sweep from ${start} through ${span} degrees stays open`, () => {
      const project = fixture();
      project.machine.sweep = { mode: "partial_circle", startAngleDegrees: start,
        stopAngleDegrees: (start + (direction === "clockwise" ? -span : span) + 360) % 360, direction };
      const result = evaluateCornerArmPath(project)!;
      const samples = result.sampledPathPoints;
      if (span === 358.75) assert.equal(samples.length, 288, "regression for the old point-count closure heuristic");
      for (const [radius, envelope, lines] of [[490, result.wheelTrackEnvelope, result.wheelTrackCenterlineSegments],
        [500, result.overhangEndEnvelope, result.overhangEndCenterlineSegments]] as const) {
        assert.notDeepEqual(lines[0][0], lines[0].at(-1), "partial sweep must not gain a closing chord");
        assert.equal(inside(midpoint(polar(radius, samples[0].angleDegrees), polar(radius, samples.at(-1)!.angleDegrees)), envelope), false);
      }
    });
  }
}

test("full-circle wrap connects adjacent surviving samples but never bridges the interior evidence gap", () => {
  const project = fixture();
  project.mapFeatures = [{ id: "east", name: "Synthetic eastern reach", kind: "corner_swing_limit", confidence: "user_estimated",
    geometry: { type: "Polygon", vertices: [{ x: 400, y: -700 }, { x: 700, y: -700 }, { x: 700, y: 700 }, { x: 400, y: 700 }] } }];
  const result = evaluateCornerArmPath(project)!;
  const samples = result.sampledPathPoints;
  const last = samples.at(-1)!;
  assert.equal(samples[0].sequenceIndex, 0);
  assert.equal(last.sequenceIndex, 287);
  assert.ok(samples.length < 288);
  assert.ok(inside(midpoint(samples[0].point, last.point), result.overhangEndEnvelope));
  const gap = samples.findIndex((point, index) => index > 0 && point.sequenceIndex > samples[index - 1].sequenceIndex + 1);
  assert.ok(gap > 0);
  assert.equal(inside(midpoint(samples[gap - 1].point, samples[gap].point), result.overhangEndEnvelope), false);
  assert.ok(result.overhangEndCenterlineSegments.some(line =>
    line.some((point, index) => index > 0 && Math.hypot(point.x - samples[0].point.x, point.y - samples[0].point.y) < 0.01
      && Math.hypot(line[index - 1].x - last.point.x, line[index - 1].y - last.point.y) < 0.01)), "centerline and buffer agree at wrap");
  for (const degrees of [90, 180]) {
    const rotated = structuredClone(project);
    const rotate = (point: XY): XY => degrees === 90 ? { x: -point.y, y: point.x } : { x: -point.x, y: -point.y };
    for (const feature of rotated.mapFeatures!) {
      if (feature.geometry.type === "Polygon") feature.geometry.vertices = feature.geometry.vertices.map(rotate);
    }
    const rotatedResult = evaluateCornerArmPath(rotated)!;
    for (const key of ["wheelTrackEnvelope", "overhangEndEnvelope"] as const) {
      assert.ok(Math.abs(multiPolygonAreaSquareMeters(result[key]) - multiPolygonAreaSquareMeters(rotatedResult[key])) < 0.00001,
        "moving a supported arc across the fixed sample boundary must preserve buffer area");
      for (const probe of [midpoint(samples[0].point, last.point), midpoint(samples[gap - 1].point, samples[gap].point), { x: 0, y: 0 }]) {
        assert.equal(inside(rotate(probe), rotatedResult[key]), inside(probe, result[key]));
      }
    }
  }
});
