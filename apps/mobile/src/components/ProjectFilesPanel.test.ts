import assert from "node:assert/strict";
import test from "node:test";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import React from "react";
import { importGoogleEarthKmlToProject, projectXyToLonLat, sampleProject } from "@cplayout/core";

const requireCurrent = createRequire(resolve(process.cwd(), "package.json"));
const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
type Props = React.ComponentProps<typeof import("./ProjectFilesPanel").ProjectFilesPanel>;
type Control = Record<string, unknown>;

function fixture(kmlText: string) {
  const slots: unknown[] = [], actions = new Map<string, Control>(), checkboxes: Control[] = [];
  const selections: Array<string[] | undefined> = [], applied: Props["project"][] = [];
  let cursor = 0;
  const nextSlot = (initial: unknown) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return index;
  };
  const react = { ...React,
    useState(initial: unknown) {
      const index = nextSlot(initial);
      return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial: unknown) { const index = nextSlot({ current: initial }); return slots[index]; },
    useMemo(compute: () => unknown) { return compute(); },
    useEffect(effect: () => unknown) { effect(); },
  };
  const path = resolve(__dirname, "ProjectFilesPanel.tsx");
  delete requireCurrent.cache[path];
  let component: typeof import("./ProjectFilesPanel");
  try {
    loader._load = function(request, parent, isMain) {
      if (request === "react") return react;
      if (request === "react-native") return { View: "div", Text: "span", Pressable: "button", TextInput: "input", Platform: { OS: "web" }, StyleSheet: { create: (value: unknown) => value } };
      if (request === "lucide-react-native") return new Proxy({}, { get: () => () => null });
      if (request === "@cplayout/geometry") return {};
      if (request === "@cplayout/project-store") return {
        importFileAsync: async () => ({ name: "selection.kml", text: kmlText }),
        readGoogleEarthKmlFile: () => ({ filename: "selection.kml", kind: "kml", kmlText, warnings: [] }),
      };
      if (request === "../inputRetention") return { useRetainedInput: () => ["", () => {}] };
      if (request === "./GoogleEarthImportWizard") return { GoogleEarthImportWizard: () => null };
      if (request === "./ProjectCopyButton") return { ProjectCopyButton: () => null };
      return originalLoad.call(this, request, parent, isMain);
    };
    component = requireCurrent(path);
  } finally { loader._load = originalLoad; }
  const props: Props = {
    dirty: false, sourceStored: true, project: sampleProject, result: {} as Props["result"],
    repository: { projects: [], canCopyProject: false } as unknown as Props["repository"],
    onPreviewGoogleEarthKml(text, selectedItemIds) {
      selections.push(selectedItemIds?.slice());
      return importGoogleEarthKmlToProject(sampleProject, text, { selectedItemIds });
    },
    onApplyGoogleEarthKmlImport(project) { applied.push(project); },
    onImportProjectedGeoJson: () => "", onImportSurveyCsv: () => "", onMapPackageImported: () => "",
    onPreviewCornerGpsMapBpf: () => { throw new Error("Unrelated BPF path"); }, onApplyCornerGpsMapBpfImport() {},
    onImportProjectZip: async () => null, onCancelImport() {}, onSaveProject() {},
    onSaveProjectCopy: async () => sampleProject, onOpenProject() {}, onDeleteProject: async () => false, onRefreshProjects: async () => {},
  };
  function walk(node: React.ReactNode): void {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!React.isValidElement(node)) return;
    const element = node as React.ReactElement<Control>;
    if (typeof element.type === "function") {
      walk((element.type as (props: Control) => React.ReactNode)(element.props)); return;
    }
    if (typeof element.props.testID === "string") actions.set(element.props.testID, element.props);
    if (element.props.accessibilityRole === "checkbox") checkboxes.push(element.props);
    walk(element.props.children as React.ReactNode);
  }
  return { actions, checkboxes, selections, applied,
    render() { cursor = 0; actions.clear(); checkboxes.length = 0; walk(component.ProjectFilesPanel(props)); },
    async press(id: string) { await (actions.get(id)!.onPress as () => void | Promise<void>)(); },
  };
}

const coordinates = [...sampleProject.fieldBoundary, sampleProject.fieldBoundary[0]].map(point => {
  const p = projectXyToLonLat(point, sampleProject.projectCrs); return `${p.longitude},${p.latitude},0`;
}).join(" ");
const polygon = (name: string, inner = "") => `<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coordinates}</coordinates></LinearRing></outerBoundaryIs>${inner}</Polygon></Placemark>`;
const wrap = (body: string) => `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`;

test("retained KML panel discovers same-name boundaries before selecting one, and revalidates explicit selection on Apply", async () => {
  const f = fixture(wrap(polygon("Boundary") + polygon("Boundary")));
  f.render(); await f.press("files-action-import-kml-kmz"); f.render();
  assert.deepEqual(f.selections, [[]]);
  assert.equal(f.checkboxes.length, 2);
  assert.ok(f.checkboxes.every(control => control["aria-checked"] === false));
  assert.equal(f.actions.get("files-action-apply-kml-kmz-import")?.disabled, true);
  assert.equal(f.actions.get("files-action-apply-kml-kmz-import")?.onPress, undefined);
  assert.equal(f.applied.length, 0);
  await (f.checkboxes[1].onPress as () => void)(); f.render();
  assert.deepEqual(f.selections.at(-1), ["boundary-2"]);
  assert.deepEqual(f.checkboxes.map(control => control["aria-checked"]), [false, true]);
  assert.equal(f.applied.length, 0);
  await f.press("files-action-apply-kml-kmz-import");
  assert.deepEqual(f.selections.at(-1), ["boundary-2"]);
  assert.equal(f.applied.length, 1);
});

test("retained KML panel keeps unsupported hole items visible and preserves selected valid geometry after refusal", async () => {
  const hole = `<innerBoundaryIs><LinearRing><coordinates>${coordinates}</coordinates></LinearRing></innerBoundaryIs>`;
  const f = fixture(wrap(polygon("Boundary") + polygon("Building", hole)));
  f.render(); await f.press("files-action-import-kml-kmz"); f.render();
  assert.equal(f.checkboxes.length, 2);
  await (f.checkboxes[0].onPress as () => void)(); f.render();
  await (f.checkboxes[1].onPress as () => void)(); f.render();
  assert.deepEqual(f.checkboxes.map(control => control["aria-checked"]), [true, false]);
  assert.equal(f.applied.length, 0);
  await f.press("files-action-apply-kml-kmz-import");
  assert.deepEqual(f.selections.at(-1), ["boundary"]);
  assert.equal(f.applied.length, 1);
});
