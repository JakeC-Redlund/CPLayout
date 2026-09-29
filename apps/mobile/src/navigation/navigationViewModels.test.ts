import assert from "node:assert/strict";

import {
  LEFT_NAV_MENU_ICON_IDS,
  parseCplayoutLeftNavMenuXml,
  type CplayoutLeftNavMenuItemDefinition,
} from "./leftNavMenu";
import {
  buildCommandMenuConfigs,
  catalogActionKey,
  isLeftNavItemDisabled,
} from "./navigationViewModels";

const menu = parseCplayoutLeftNavMenuXml();
assert.deepEqual(menu.commandMenus.map((entry) => entry.id), ["file", "inspect", "view", "settings", "help"]);
assert.deepEqual(menu.railItems.map((entry) => entry.id), ["map", "dashboard", "files", "survey", "help", "settings"]);
assert.deepEqual(menu.catalogActions.map((entry) => entry.action), [
  "create_client",
  "create_project",
  "create_field_map",
  "create_design",
  "start_blank_design",
  "open_sample",
]);

assert.throws(
  () => parseCplayoutLeftNavMenuXml(`<cplayoutNavigationMenu version="cplayout-nav-menu-v1">
    <commandMenus><menu id="file" label="File" icon="folder-open"><item id="bad" label="Bad" action="hidden_action" icon="home"/></menu></commandMenus>
    <rail section="primary"><item id="map" label="Map" action="navigate_map" icon="map"/></rail>
    <rail section="secondary"><item id="help" label="Help" action="navigate_help" icon="list-checks"/></rail>
    <catalogActions section="create"><item id="client" label="Client" action="create_client" icon="user-round"/></catalogActions>
    <catalogActions section="utility"><item id="blank" label="Blank" action="start_blank_design" icon="wrench"/></catalogActions>
  </cplayoutNavigationMenu>`),
  /action/,
);

assert.throws(
  () => parseCplayoutLeftNavMenuXml(`<cplayoutNavigationMenu version="cplayout-nav-menu-v1">
    <commandMenus><menu id="file" label="File" icon="folder-open"><item id="bad" label="Bad" action="navigate_map" icon="ghost"/></menu></commandMenus>
    <rail section="primary"><item id="map" label="Map" action="navigate_map" icon="map"/></rail>
    <rail section="secondary"><item id="help" label="Help" action="navigate_help" icon="list-checks"/></rail>
    <catalogActions section="create"><item id="client" label="Client" action="create_client" icon="user-round"/></catalogActions>
    <catalogActions section="utility"><item id="blank" label="Blank" action="start_blank_design" icon="wrench"/></catalogActions>
  </cplayoutNavigationMenu>`),
  /icon/,
);

assert.throws(
  () => parseCplayoutLeftNavMenuXml(`<cplayoutNavigationMenu version="cplayout-nav-menu-v1">
    <commandMenus><menu id="file" label="File" icon="folder-open"><item id="map" label="Map" action="navigate_map" icon="map"/></menu></commandMenus>
    <rail section="primary"><item id="map" label="Map" action="navigate_map" icon="map"/></rail>
    <catalogActions section="create"><item id="client" label="Client" action="create_client" icon="user-round"/></catalogActions>
    <catalogActions section="utility"><item id="blank" label="Blank" action="start_blank_design" icon="wrench"/></catalogActions>
  </cplayoutNavigationMenu>`),
  /missing rail section secondary/,
);

const desktopMenus = buildCommandMenuConfigs({
  commandMenuItemLabel: (item) => item.label,
  compactLayout: false,
  context: { activeContext: null, activeView: "map", homeMapView: true },
  iconForName: (name) => name,
  menuDefinition: menu,
  onAction: () => undefined,
  sampleItems: [{ id: "sample-one", label: "Sample One", onPress: () => undefined }],
});
assert.deepEqual(desktopMenus.map((entry) => entry.id), ["file", "inspect", "settings", "help"]);
assert.equal(desktopMenus.find((entry) => entry.id === "file")?.items.some((item) => item.id === "sample-one"), true);
assert.equal(desktopMenus.find((entry) => entry.id === "inspect")?.items.find((item) => item.id === "metrics")?.disabled, true);

const compactMenus = buildCommandMenuConfigs({
  commandMenuItemLabel: (item) => item.label,
  compactLayout: true,
  context: { activeContext: null, activeView: "map", homeMapView: false },
  iconForName: (name) => name,
  menuDefinition: menu,
  onAction: () => undefined,
  sampleItems: [],
});
assert.deepEqual(compactMenus.map((entry) => entry.id), ["file", "inspect", "view", "settings", "help"]);

assert.equal(isLeftNavItemDisabled({ disabledWhen: "no_project" }, { activeContext: { clientId: "c1", projectId: null, fieldMapId: null }, activeView: "map", homeMapView: false }), true);
assert.equal(isLeftNavItemDisabled({ disabledWhen: "no_project" }, { activeContext: { clientId: "c1", projectId: "p1", fieldMapId: null }, activeView: "map", homeMapView: false }), false);

const renamedBlankAction = { ...menu.catalogActions.find((entry) => entry.action === "start_blank_design")!, id: "renamed-action-row" };
assert.equal(catalogActionKey(renamedBlankAction), "start_blank_design");

assert.equal(LEFT_NAV_MENU_ICON_IDS.includes("map-pinned"), true);

const firstItem = menu.commandMenus[0]?.items.find((entry) => !("source" in entry)) as CplayoutLeftNavMenuItemDefinition;
assert.equal(firstItem.action, "open_catalog");

// Creation advances through the selected hierarchy, regardless of menu order.
import { nextCatalogCreateAction } from "./navigationViewModels";
assert.equal(nextCatalogCreateAction(null), "create_client");
assert.equal(nextCatalogCreateAction({clientId:"c",projectId:null,fieldMapId:null}), "create_project");
assert.equal(nextCatalogCreateAction({clientId:"c",projectId:"p",fieldMapId:null}), "create_field_map");
assert.equal(nextCatalogCreateAction({clientId:"c",projectId:"p",fieldMapId:"f"}), "create_design");
