import assert from "node:assert/strict";

import { sampleProject, type PivotProject } from "@cplayout/core";

import {
  adjacentProjectVertexSelection,
  firstMapFeatureVertexSelection,
  hasMapFeatureVertexSelection,
  selectedProjectVertexCanDelete,
  selectedProjectVertexCanInsert,
  selectedProjectVertexInsertionPoint,
  selectedProjectVertexIsMapFeatureCircleRadius,
  selectedProjectVertexPoint,
  selectedProjectVertexText,
  type SelectedProjectVertex,
} from "./projectVertexEditing";

const project: PivotProject = {
  ...sampleProject,
  mapFeatures: [
    {
      id: "line-feature",
      name: "Utility Line",
      kind: "underground_pipeline",
      geometry: {
        type: "LineString",
        vertices: [
          { x: 501000, y: 4506000 },
          { x: 501100, y: 4506000 },
          { x: 501150, y: 4506040 },
        ],
      },
      confidence: "user_estimated",
    },
    {
      id: "point-feature",
      name: "Pump Point",
      kind: "pump_location",
      geometry: { type: "Point", point: { x: 501050, y: 4506050 } },
      confidence: "user_estimated",
    },
    {
      id: "circle-feature",
      name: "End Gun Circle",
      kind: "end_gun_arc",
      geometry: { type: "Circle", center: { x: 501075, y: 4506075 }, radiusMeters: 30 },
      confidence: "user_estimated",
    },
  ],
};

assert.equal(hasMapFeatureVertexSelection(project), true);
assert.deepEqual(firstMapFeatureVertexSelection(project), {
  layer: "map_feature",
  featureId: "line-feature",
  vertexIndex: 0,
});

const lineSelection: SelectedProjectVertex = { layer: "map_feature", featureId: "line-feature", vertexIndex: 0 };
assert.deepEqual(selectedProjectVertexPoint(project, lineSelection), { x: 501000, y: 4506000 });
assert.equal(selectedProjectVertexText(project, lineSelection), "Utility Line vertex 1 of 3");
assert.equal(selectedProjectVertexCanDelete(project, lineSelection), true);
assert.equal(selectedProjectVertexCanInsert(project, lineSelection), true);
assert.deepEqual(selectedProjectVertexInsertionPoint(project, lineSelection), { x: 501050, y: 4506000 });
assert.deepEqual(adjacentProjectVertexSelection(project, lineSelection, 1), {
  layer: "map_feature",
  featureId: "line-feature",
  vertexIndex: 1,
});
assert.deepEqual(adjacentProjectVertexSelection(project, lineSelection, -1), {
  layer: "map_feature",
  featureId: "line-feature",
  vertexIndex: 2,
});

const pointSelection: SelectedProjectVertex = { layer: "map_feature", featureId: "point-feature", vertexIndex: 0 };
assert.deepEqual(selectedProjectVertexPoint(project, pointSelection), { x: 501050, y: 4506050 });
assert.equal(selectedProjectVertexText(project, pointSelection), "Pump Point point 1 of 1");
assert.equal(selectedProjectVertexCanDelete(project, pointSelection), false);
assert.equal(selectedProjectVertexCanInsert(project, pointSelection), false);
assert.equal(selectedProjectVertexInsertionPoint(project, pointSelection), null);

const circleSelection: SelectedProjectVertex = { layer: "map_feature", featureId: "circle-feature", vertexIndex: 0 };
assert.deepEqual(selectedProjectVertexPoint(project, circleSelection), { x: 501075, y: 4506075 });
assert.equal(selectedProjectVertexText(project, circleSelection), "End Gun Circle center 1 of 2");
assert.equal(selectedProjectVertexCanDelete(project, circleSelection), false);
assert.equal(selectedProjectVertexIsMapFeatureCircleRadius(project, circleSelection), false);
const circleRadiusSelection: SelectedProjectVertex = { layer: "map_feature", featureId: "circle-feature", vertexIndex: 1 };
assert.deepEqual(selectedProjectVertexPoint(project, circleRadiusSelection), { x: 501105, y: 4506075 });
assert.equal(selectedProjectVertexText(project, circleRadiusSelection), "End Gun Circle radius handle 2 of 2");
assert.equal(selectedProjectVertexCanDelete(project, circleRadiusSelection), false);
assert.equal(selectedProjectVertexIsMapFeatureCircleRadius(project, circleRadiusSelection), true);
assert.equal(selectedProjectVertexCanInsert(project, circleRadiusSelection), false);
assert.deepEqual(adjacentProjectVertexSelection(project, circleSelection, 1), circleRadiusSelection);
assert.deepEqual(adjacentProjectVertexSelection(project, circleRadiusSelection, 1), circleSelection);

assert.deepEqual(firstMapFeatureVertexSelection({ ...sampleProject, mapFeatures: [] }), null);
assert.equal(hasMapFeatureVertexSelection({ ...sampleProject, mapFeatures: [] }), false);

console.log("project vertex editing tests passed");
