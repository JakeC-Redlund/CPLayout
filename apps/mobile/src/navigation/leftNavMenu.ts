import {
  CPLAYOUT_NAV_MENU_XML_VERSION,
  parseLeftNavMenuXml,
  type LeftNavCatalogActionDefinition,
  type LeftNavCommandMenuDefinition,
  type LeftNavMenuDefinition,
  type LeftNavMenuDisabledWhen,
  type LeftNavMenuItemDefinition,
  type LeftNavRailItemDefinition,
} from "@cplayout/core";

export const LEFT_NAV_MENU_ACTION_IDS = [
  "open_catalog",
  "open_sample",
  "start_blank_design",
  "open_files",
  "navigate_map",
  "navigate_dashboard",
  "navigate_files",
  "navigate_survey",
  "navigate_settings",
  "navigate_help",
  "show_metrics",
  "show_warnings",
  "reset_walkthrough",
  "toggle_left_drawer",
  "toggle_right_drawer",
  "create_client",
  "create_project",
  "create_field_map",
  "create_design",
] as const;

export const LEFT_NAV_MENU_ICON_IDS = [
  "alert-triangle",
  "calculator",
  "clipboard-list",
  "database",
  "download",
  "folder-open",
  "home",
  "layers",
  "list-checks",
  "map",
  "map-pinned",
  "rotate-ccw",
  "ruler",
  "satellite",
  "sliders-horizontal",
  "user-round",
  "wrench",
] as const;

export const LEFT_NAV_MENU_DISABLED_WHEN_IDS = [
  "home_view",
  "not_map_view",
  "no_client",
  "no_project",
  "no_field_map",
] as const;

export type CplayoutLeftNavMenuActionId = typeof LEFT_NAV_MENU_ACTION_IDS[number];
export type CplayoutLeftNavIconId = typeof LEFT_NAV_MENU_ICON_IDS[number];
export type CplayoutLeftNavDisabledWhen = typeof LEFT_NAV_MENU_DISABLED_WHEN_IDS[number];

export type CplayoutLeftNavMenuItemDefinition = Omit<LeftNavMenuItemDefinition, "action" | "disabledWhen" | "icon"> & {
  action: CplayoutLeftNavMenuActionId;
  disabledWhen?: CplayoutLeftNavDisabledWhen;
  icon: CplayoutLeftNavIconId;
};
export type CplayoutLeftNavRailItemDefinition = Omit<LeftNavRailItemDefinition, "action" | "disabledWhen" | "icon"> & CplayoutLeftNavMenuItemDefinition;
export type CplayoutLeftNavCatalogActionDefinition = Omit<LeftNavCatalogActionDefinition, "action" | "disabledWhen" | "icon"> & CplayoutLeftNavMenuItemDefinition;
export type CplayoutLeftNavCommandMenuDefinition = Omit<LeftNavCommandMenuDefinition, "icon" | "items"> & {
  icon: CplayoutLeftNavIconId;
  items: LeftNavCommandMenuDefinition["items"];
};
export type CplayoutLeftNavMenuDefinition = Omit<LeftNavMenuDefinition, "catalogActions" | "commandMenus" | "railItems"> & {
  catalogActions: CplayoutLeftNavCatalogActionDefinition[];
  commandMenus: CplayoutLeftNavCommandMenuDefinition[];
  railItems: CplayoutLeftNavRailItemDefinition[];
};

export const DEFAULT_LEFT_NAV_MENU_XML = `<?xml version="1.0" encoding="UTF-8"?>
<cplayoutNavigationMenu version="${CPLAYOUT_NAV_MENU_XML_VERSION}">
  <commandMenus>
    <menu id="file" label="File" icon="folder-open" testID="command-menu-file">
      <item id="catalog" label="Catalog home" description="Return to the local project catalog map." action="open_catalog" icon="home" testID="command-file-catalog"/>
      <slot id="sample-designs" source="sample_designs"/>
      <item id="blank" label="Start Blank Design" description="Create an empty design draft under the selected field map." action="start_blank_design" icon="wrench" testID="command-file-blank-design"/>
      <item id="files" label="Files / GIS Exchange" description="Open ZIP, GeoJSON, KML/KMZ, CSV, and map package tools." action="open_files" icon="download" testID="command-file-files"/>
    </menu>
    <menu id="inspect" label="Inspect" icon="clipboard-list" testID="command-menu-inspect">
      <item id="dashboard" label="Dashboard" description="Open workflow readiness, export readiness, warnings, and recent projects." action="navigate_dashboard" icon="home" testID="command-inspect-dashboard"/>
      <item id="metrics" label="Metrics Inspector" description="Show irrigated area, dry area, coverage, conflicts, and warnings." action="show_metrics" disabledWhen="home_view" icon="calculator" testID="command-inspect-metrics"/>
      <item id="warnings" label="Warnings" description="Inspect validation warnings without mutating geometry." action="show_warnings" disabledWhen="home_view" icon="alert-triangle" testID="command-inspect-warnings"/>
    </menu>
    <menu id="view" label="View" icon="map" display="compact" testID="command-menu-view">
      <item id="map" label="Map Workbench" action="navigate_map" icon="map-pinned" testID="command-view-map"/>
      <item id="dashboard" label="Dashboard" action="navigate_dashboard" icon="home" testID="command-view-dashboard"/>
      <item id="survey" label="Survey" description="Open local browser RTK receiver and survey capture readiness." action="navigate_survey" icon="satellite" testID="command-view-survey"/>
      <item id="files" label="Files / GIS Exchange" action="navigate_files" icon="download" testID="command-view-files"/>
      <item id="project-drawer" label="Project Drawer" action="toggle_left_drawer" disabledWhen="not_map_view" icon="folder-open" testID="command-view-project-drawer"/>
      <item id="workflow-sidebar" label="Workflow Sidebar" action="toggle_right_drawer" disabledWhen="not_map_view" icon="sliders-horizontal" testID="command-view-inspector"/>
    </menu>
    <menu id="settings" label="Settings" icon="sliders-horizontal" testID="command-menu-settings">
      <item id="settings" label="Settings" action="navigate_settings" icon="sliders-horizontal" testID="command-settings-open"/>
      <item id="coordinates" label="Coordinate Display" description="Configure display formats; projected XY remains canonical." action="navigate_settings" icon="ruler" testID="command-settings-coordinates"/>
      <item id="imagery" label="Imagery Setup" description="Manage no-key previews and local package metadata." action="navigate_settings" icon="satellite" testID="command-settings-imagery"/>
    </menu>
    <menu id="help" label="Help" icon="list-checks" testID="command-menu-help">
      <item id="help" label="Help And Training" action="navigate_help" icon="list-checks" testID="command-help-open"/>
      <item id="reset" label="Reset Walkthrough" description="Clear local-only walkthrough progress for the active project." action="reset_walkthrough" icon="rotate-ccw" testID="command-help-reset"/>
    </menu>
  </commandMenus>
  <rail section="primary">
    <item id="map" label="Map" action="navigate_map" icon="map-pinned" testID="workspace-nav-map"/>
    <item id="dashboard" label="Dashboard" action="navigate_dashboard" icon="home" testID="workspace-nav-dashboard"/>
    <item id="files" label="Files" action="navigate_files" icon="download" testID="workspace-nav-files"/>
    <item id="survey" label="Survey" action="navigate_survey" icon="satellite" testID="workspace-nav-survey"/>
  </rail>
  <rail section="secondary">
    <item id="help" label="Help" action="navigate_help" icon="list-checks" testID="workspace-nav-help"/>
    <item id="settings" label="Settings" action="navigate_settings" icon="sliders-horizontal" testID="workspace-nav-settings"/>
  </rail>
  <catalogActions section="create">
    <item id="client" label="Client" action="create_client" icon="user-round" testID="project-tree-action-client"/>
    <item id="project" label="Project" action="create_project" disabledWhen="no_client" icon="database" testID="project-tree-action-project"/>
    <item id="field-map" label="Field Map" action="create_field_map" disabledWhen="no_project" icon="map" testID="project-tree-action-field-map"/>
    <item id="design" label="Design" action="create_design" disabledWhen="no_field_map" icon="layers" testID="project-tree-action-design"/>
  </catalogActions>
  <catalogActions section="utility">
    <item id="blank-design" label="Blank Design" action="start_blank_design" icon="wrench" testID="project-tree-action-blank-design"/>
    <item id="open-sample" label="Open Sample" action="open_sample" icon="map-pinned" testID="project-tree-action-open-sample"/>
  </catalogActions>
</cplayoutNavigationMenu>`;

export function parseCplayoutLeftNavMenuXml(xmlText = DEFAULT_LEFT_NAV_MENU_XML): CplayoutLeftNavMenuDefinition {
  return parseLeftNavMenuXml(xmlText, {
    actionIds: LEFT_NAV_MENU_ACTION_IDS,
    disabledWhenIds: LEFT_NAV_MENU_DISABLED_WHEN_IDS,
    iconIds: LEFT_NAV_MENU_ICON_IDS,
    requiredCatalogActionSections: ["create", "utility"],
    requiredRailSections: ["primary", "secondary"],
  }) as CplayoutLeftNavMenuDefinition;
}
