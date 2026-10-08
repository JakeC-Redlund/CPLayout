import assert from "node:assert/strict";

import type { ProjectCatalog } from "@cplayout/project-store";

import { buildProjectTreeViewModel } from "./projectTreeViewModel";

const now = "2026-06-11T00:00:00.000Z";
const catalog: ProjectCatalog = {
  clients: [{
    id: "client-1",
    displayName: "Adams Farms",
    sortName: "adams farms",
    companyName: "Adams Farms",
    contactName: "Ana Adams",
    primaryContactFirstName: "Ana",
    primaryContactMiddleInitial: "",
    primaryContactLastName: "Adams",
    primaryContactSuffix: "",
    email: "",
    phone: "",
    location: "",
    notes: "",
    createdAt: now,
    updatedAt: now,
  }],
  projects: [{
    id: "project-1",
    clientId: "client-1",
    name: "North Unit",
    projectCrs: "EPSG:32613",
    unitSystem: "imperial",
    createdAt: now,
    updatedAt: now,
  }],
  fieldMaps: [
    { id: "map-north", projectId: "project-1", name: "North Quarter", createdAt: now, updatedAt: now },
    { id: "map-south", projectId: "project-1", name: "South Quarter", createdAt: now, updatedAt: now },
  ],
  designs: [
    { id: "design-north-active", fieldMapId: "map-north", name: "North Base", pivotProjectId: "pivot-north", isActive: true, createdAt: now, updatedAt: now },
    { id: "design-north-variant", fieldMapId: "map-north", name: "North Variant", pivotProjectId: "pivot-north-variant", isActive: false, createdAt: now, updatedAt: now },
    { id: "design-south-active", fieldMapId: "map-south", name: "South Base", pivotProjectId: "pivot-south", isActive: true, createdAt: now, updatedAt: now },
  ],
};

const tree = buildProjectTreeViewModel(catalog, {
  clientId: "client-1",
  projectId: "project-1",
  fieldMapId: null,
  designId: null,
});

assert.equal(tree.activeProjectLabel, "North Unit");
assert.equal(tree.clients.length, 1);
assert.equal(tree.clients[0]?.projects[0]?.meta, "2 fields - 3 designs");

const fieldMaps = tree.clients[0]?.projects[0]?.fieldMaps ?? [];
assert.deepEqual(fieldMaps.map((fieldMap) => fieldMap.label), ["North Quarter", "South Quarter"]);
assert.deepEqual(fieldMaps[0]?.designs.map((design) => design.label), ["North Base", "North Variant"]);
assert.deepEqual(fieldMaps[0]?.designs.map((design) => design.meta), ["active design", "layout variant"]);
assert.deepEqual(fieldMaps[1]?.designs.map((design) => design.label), ["South Base"]);

const fullCatalogTree = buildProjectTreeViewModel(catalog, {
  clientId: null,
  projectId: null,
  fieldMapId: null,
  designId: null,
});
assert.equal(fullCatalogTree.activeProjectLabel, "Project Catalog");
assert.equal(fullCatalogTree.clients[0]?.projects[0]?.showChildren, true);

const mixedTree = buildProjectTreeViewModel({ ...catalog, designs: [
  ...catalog.designs.map(design => ({ ...design, kind: "project" as const, revision: 0 })),
  { id: "incomplete", kind: "draft", draftId: "draft-data", revision: 0, fieldMapId: "map-north",
    name: "Incomplete", isActive: true, createdAt: now, updatedAt: now },
] }, { clientId: null, projectId: null, fieldMapId: null, designId: null });
assert.equal(mixedTree.clients[0].projects[0].meta, "2 fields - 4 designs");
assert.equal(mixedTree.clients[0].projects[0].fieldMaps[0].meta, "3 designs");
assert.equal(mixedTree.clients[0].projects[0].fieldMaps[0].designs.find(design => design.id === "incomplete")?.meta, "saved draft");
