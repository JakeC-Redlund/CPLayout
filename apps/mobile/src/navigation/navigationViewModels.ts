import type { ReactNode } from "react";

import type { CommandMenuConfig, CommandMenuItemConfig } from "../components/CommandSurface";

import type {
  CplayoutLeftNavCatalogActionDefinition,
  CplayoutLeftNavCommandMenuDefinition,
  CplayoutLeftNavMenuActionId,
  CplayoutLeftNavMenuDefinition,
  CplayoutLeftNavMenuItemDefinition,
} from "./leftNavMenu";

export interface LeftNavContext {
  activeContext: { clientId: string | null; projectId: string | null; fieldMapId: string | null } | null;
  activeView: string;
  homeMapView: boolean;
}

export interface CommandMenuBuildInput {
  commandMenuItemLabel: (item: CplayoutLeftNavMenuItemDefinition) => string;
  compactLayout: boolean;
  context: LeftNavContext;
  iconForName: (name: string, color?: string) => ReactNode;
  menuDefinition: CplayoutLeftNavMenuDefinition;
  onAction: (action: CplayoutLeftNavMenuActionId) => void | Promise<void>;
  sampleItems: CommandMenuItemConfig[];
}

export function isLeftNavItemDisabled(
  item: { disabledWhen?: string },
  context: LeftNavContext,
): boolean {
  if (item.disabledWhen === "home_view") return context.homeMapView;
  if (item.disabledWhen === "not_map_view") return context.activeView !== "map";
  if (item.disabledWhen === "no_client") return !context.activeContext?.clientId;
  if (item.disabledWhen === "no_project") return !context.activeContext?.projectId;
  if (item.disabledWhen === "no_field_map") return !context.activeContext?.fieldMapId;
  return false;
}

export function buildCommandMenuConfigs(input: CommandMenuBuildInput): CommandMenuConfig[] {
  return input.menuDefinition.commandMenus
    .filter((menu) => menu.display !== "compact" || input.compactLayout)
    .map((menu) => buildCommandMenuConfig(menu, input));
}

function buildCommandMenuConfig(menu: CplayoutLeftNavCommandMenuDefinition, input: CommandMenuBuildInput): CommandMenuConfig {
  return {
    id: menu.id,
    label: menu.label,
    icon: input.iconForName(menu.icon, "#254234"),
    items: menu.items.flatMap((entry) => {
      if ("source" in entry) return entry.source === "sample_designs" ? input.sampleItems : [];
      const item = entry as CplayoutLeftNavMenuItemDefinition;
      return [{
        id: item.id,
        label: input.commandMenuItemLabel(item),
        description: item.description,
        disabled: isLeftNavItemDisabled(item, input.context),
        icon: input.iconForName(item.icon),
        onPress: () => input.onAction(item.action),
        testID: item.testID,
      }];
    }),
    testID: menu.testID,
  };
}

export function catalogActionKey(action: CplayoutLeftNavCatalogActionDefinition): CplayoutLeftNavMenuActionId {
  return action.action;
}

/** The next creation step follows the deepest selected catalog container. */
export function nextCatalogCreateAction(context: LeftNavContext["activeContext"]): CplayoutLeftNavMenuActionId {
  if (context?.fieldMapId) return "create_design";
  if (context?.projectId) return "create_field_map";
  if (context?.clientId) return "create_project";
  return "create_client";
}
