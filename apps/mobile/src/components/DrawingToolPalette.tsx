import {
  Calculator,
  ChevronDown,
  ChevronUp,
  Circle,
  Hand,
  Layers,
  MapPin,
  MousePointer2,
  Pentagon,
  Route,
  Wrench,
} from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { AppSettings, ProjectMapFeatureKind } from "@cplayout/core";
import type { DrawingLayerType, DrawingMode } from "@cplayout/geometry";
import { MAP_TOOL_CATALOG, type MapToolCatalogItem, type MapToolId } from "@cplayout/map-adapters";

export type DrawingToolPaletteModal = "point" | "line" | "polygon" | "circle" | "pivot" | "obstacle" | "machine" | "endGun" | "cornerArm" | "calculate" | "layers" | null;

type ActiveTool = {
  activeLayer: DrawingLayerType;
  draftGeometry?: "Point" | "LineString" | "Polygon" | "Circle";
  featureKind?: ProjectMapFeatureKind;
  mode: DrawingMode;
  requestId: number;
} | null;

interface DrawingToolPaletteProps {
  activeModal: DrawingToolPaletteModal;
  activeTool: ActiveTool;
  onActivateTool: (mode: DrawingMode, activeLayer: DrawingLayerType, featureKind?: ProjectMapFeatureKind) => void;
  onCalculate: () => void;
  onOpenModal: (modal: DrawingToolPaletteModal) => void;
  onToggleLayers: () => void;
  settings: AppSettings;
}

interface DrawingToolLauncherProps extends DrawingToolPaletteProps {
  showGeometryTools?: boolean;
  variant: "compact" | "sidebar";
}

export function DrawingToolPalette({
  activeModal,
  activeTool,
  onActivateTool,
  onCalculate,
  onOpenModal,
  onToggleLayers,
  settings,
}: DrawingToolPaletteProps): React.JSX.Element {
  return (
    <View style={styles.bottomHud} testID="map-bottom-hud">
      <DrawingToolLauncher
        activeModal={activeModal}
        activeTool={activeTool}
        onActivateTool={onActivateTool}
        onCalculate={onCalculate}
        onOpenModal={onOpenModal}
        onToggleLayers={onToggleLayers}
        settings={settings}
        variant="compact"
      />
    </View>
  );
}

export function DrawingToolLauncher({
  activeModal,
  activeTool,
  onActivateTool,
  onCalculate,
  onOpenModal,
  onToggleLayers,
  settings,
  showGeometryTools = true,
  variant,
}: DrawingToolLauncherProps): React.JSX.Element {
  const [expandedHud, setExpandedHud] = useState(false);
  const sidebar = variant === "sidebar";
  const designMode = settings.mappingWorkflowMode === "design";
  const activeToolId = useMemo(() => activeMapToolId(activeModal, activeTool), [activeModal, activeTool]);
  const statusText = activeToolStatus(activeModal, activeTool, designMode);
  const expanded = sidebar || expandedHud;

  function runTool(tool: MapToolCatalogItem): void {
    const action = tool.action;
    if (action.type === "activate") {
      onActivateTool(action.mode, action.layer, action.featureKind);
      return;
    }
    if (action.type === "open_panel") {
      if (!designMode) return;
      onOpenModal(action.panel);
    }
  }

  return (
    <View style={[styles.shell, sidebar && styles.sidebarShell]} testID="design-action-hud">
      <View style={styles.statusRow}>
        {!sidebar ? (
          <Pressable
            accessibilityLabel={expandedHud ? "Collapse map HUD" : "Expand map HUD"}
            accessibilityRole="button"
            accessibilityState={{ expanded: expandedHud }}
            onPress={() => setExpandedHud((expanded) => !expanded)}
            style={styles.hudToggleButton}
            testID="map-bottom-hud-toggle"
          >
            {expandedHud ? <ChevronDown size={18} color="#173428" /> : <ChevronUp size={18} color="#173428" />}
          </Pressable>
        ) : null}
        <View style={styles.activeChip} testID="map-hud-active-tool-chip">
          <Text numberOfLines={sidebar ? 2 : 1} style={styles.activeChipText}>{statusText}</Text>
        </View>
      </View>
      {sidebar ? (
        <>
          {showGeometryTools ? (
            <View style={styles.sidebarToolGrid} testID="design-action-scroll">
              {MAP_TOOL_CATALOG.map((tool) => (
                <ToolButton
                  key={tool.id}
                  active={activeToolId === tool.id}
                  expanded={expanded}
                  icon={toolIcon(tool.id, activeToolId === tool.id)}
                  legacyTestID={legacyTestId(tool.id)}
                  onPress={() => runTool(tool)}
                  sidebar
                  testID={groupTestId(tool.id)}
                  tool={tool}
                />
              ))}
            </View>
          ) : null}
          <View style={styles.workflowActionRow} testID="design-workflow-actions">
            <WorkflowActionButton icon={<Wrench size={17} color="#173428" />} label="Machine" onPress={() => onOpenModal("machine")} testID="design-action-machine" />
            <WorkflowActionButton icon={<Layers size={17} color="#173428" />} label="Layers" onPress={onToggleLayers} testID="design-action-layers" />
            <WorkflowActionButton icon={<Calculator size={17} color="#173428" />} label="Calculate" onPress={onCalculate} testID="design-action-calculate" />
          </View>
        </>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={expandedHud}
          style={styles.toolScroll}
          contentContainerStyle={styles.toolRow}
          testID="design-action-scroll"
        >
          {MAP_TOOL_CATALOG.map((tool) => (
            <ToolButton
              key={tool.id}
              active={activeToolId === tool.id}
              expanded={expanded}
              icon={toolIcon(tool.id, activeToolId === tool.id)}
              legacyTestID={legacyTestId(tool.id)}
              onPress={() => runTool(tool)}
              testID={groupTestId(tool.id)}
              tool={tool}
            />
          ))}
        </ScrollView>
      )}
      {!designMode && expanded ? (
        <Text style={styles.notice}>Layout mode is read-only for pointer edits.</Text>
      ) : null}
    </View>
  );
}

function ToolButton({
  active,
  expanded,
  icon,
  legacyTestID,
  onPress,
  sidebar = false,
  testID,
  tool,
}: {
  active: boolean;
  expanded: boolean;
  icon: React.ReactNode;
  legacyTestID?: string;
  onPress: () => void;
  sidebar?: boolean;
  testID: string;
  tool: MapToolCatalogItem;
}): React.JSX.Element {
  const visualGroup = toolVisualGroup(tool.id);
  return (
    <View style={[styles.toolGroupShell, { borderTopColor: visualGroup.color }]} testID={testID}>
      <Pressable
        accessibilityLabel={tool.label}
        accessibilityHint={tool.statusLabel}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={onPress}
        style={[styles.toolButton, { borderColor: visualGroup.borderColor }, expanded && styles.toolButtonExpanded, sidebar && styles.sidebarToolButton, active && styles.toolButtonActive]}
        testID={legacyTestID}
        {...toolButtonWebHint(tool.label, tool.statusLabel, active, expanded)}
      >
        {icon}
        {expanded ? <Text style={[styles.toolText, active && styles.toolTextActive]}>{tool.shortLabel}</Text> : null}
      </Pressable>
    </View>
  );
}

function toolVisualGroup(id: MapToolId): { label: string; color: string; borderColor: string } {
  switch (id) {
    case "pan":
      return { label: "Navigate", color: "#2f6f6b", borderColor: "#9dc9c5" };
    case "edit":
      return { label: "Edit", color: "#5f6f2f", borderColor: "#c5cf9d" };
    case "point":
      return { label: "Points", color: "#7a4a12", borderColor: "#d8bb8d" };
    case "line":
      return { label: "Utilities", color: "#62418f", borderColor: "#c5b4dd" };
    case "polygon":
      return { label: "Areas", color: "#2d5f3a", borderColor: "#a8cdb1" };
    case "circle":
      return { label: "Coverage", color: "#006a9f", borderColor: "#9bc8df" };
  }
}

function activeMapToolId(activeModal: DrawingToolPaletteModal, activeTool: ActiveTool): MapToolId {
  if (activeModal === "point" || activeModal === "pivot") return "point";
  if (activeModal === "line") return "line";
  if (activeModal === "polygon" || activeModal === "obstacle") return "polygon";
  if (activeModal === "circle" || activeModal === "endGun" || activeModal === "cornerArm") return "circle";
  if (activeTool?.mode === "pan") return "pan";
  if (activeTool?.mode === "edit_vertices") return "edit";
  if (activeTool?.mode === "place_pivot" || activeTool?.mode === "capture_point") return "point";
  if (activeTool?.featureKind === "end_gun_arc") return "circle";
  if (activeTool?.featureKind === "corner_swing_limit") return "polygon";
  if (activeTool?.mode === "measure") {
    if (activeTool.draftGeometry === "LineString") return "line";
    if (activeTool.draftGeometry === "Polygon") return "polygon";
    if (activeTool.draftGeometry === "Circle") return "circle";
    const kind = activeTool.featureKind ?? "";
    if (kind.includes("line") || kind.includes("pipeline") || kind.includes("wire") || kind === "ditch" || kind === "canal" || kind === "fence" || kind === "road" || kind === "access_lane") return "line";
    if (kind.includes("boundary") || kind.includes("zone")) return "polygon";
    return "point";
  }
  if (activeTool?.mode === "draw_boundary" || activeTool?.mode === "mark_obstacle") return "polygon";
  return "pan";
}

function activeToolStatus(activeModal: DrawingToolPaletteModal, activeTool: ActiveTool, designMode: boolean): string {
  if (!designMode) return "Layout: inspect";
  if (activeModal) return `${activeModal.replaceAll("_", " ")} sheet`;
  if (!activeTool) return "Pan";
  const layer = activeTool.featureKind ?? activeTool.draftGeometry ?? activeTool.activeLayer;
  return `${activeTool.mode.replaceAll("_", " ")} · ${layer.replaceAll("_", " ")}`;
}

function groupTestId(id: MapToolId): string {
  switch (id) {
    case "pan":
      return "drawing-tool-group-pan";
    case "edit":
      return "drawing-tool-group-edit";
    case "point":
      return "drawing-tool-group-points";
    case "line":
      return "drawing-tool-group-utilities";
    case "polygon":
      return "drawing-tool-group-area";
    case "circle":
      return "drawing-tool-group-coverage";
  }
}

function legacyTestId(id: MapToolId): string | undefined {
  switch (id) {
    case "pan":
      return "design-action-pan";
    case "line":
      return "design-action-line";
    case "polygon":
      return "design-action-polygon";
    case "point":
      return "design-action-point";
    case "circle":
      return "design-action-circle";
    case "edit":
      return "design-action-edit";
  }
}

function toolIcon(id: MapToolId, active: boolean): React.ReactNode {
  const color = active ? "#ffffff" : "#173428";
  switch (id) {
    case "pan":
      return <Hand size={19} color={color} />;
    case "edit":
      return <MousePointer2 size={19} color={color} />;
    case "point":
      return <MapPin size={19} color={color} />;
    case "line":
      return <Route size={19} color={color} />;
    case "polygon":
      return <Pentagon size={19} color={color} />;
    case "circle":
      return <Circle size={19} color={color} />;
  }
}

function toolButtonWebHint(label: string, hint: string, active: boolean, expanded: boolean): Record<string, unknown> {
  if (Platform.OS !== "web") return {};
  return {
    ...(active ? { "aria-pressed": "true" } : {}),
    ...(!expanded ? { title: `${label}: ${hint}` } : {}),
  };
}

function WorkflowActionButton({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  testID: string;
}): React.JSX.Element {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={styles.workflowActionButton} testID={testID}>
      {icon}
      <Text style={styles.workflowActionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bottomHud: {
    alignSelf: "center",
    maxWidth: "100%",
    width: "100%",
  },
  shell: {
    backgroundColor: "rgba(251,252,248,0.96)",
    borderColor: "#c8d6cc",
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 0,
    gap: 7,
    minHeight: 56,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 7,
  },
  sidebarShell: {
    backgroundColor: "#f7faf5",
    flexShrink: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    minWidth: 0,
  },
  hudToggleButton: {
    alignItems: "center",
    backgroundColor: "#fffef8",
    borderColor: "#b9c8bd",
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 42,
  },
  activeChip: {
    backgroundColor: "#edf4ef",
    borderColor: "#cbd8ce",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 38,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  activeChipText: {
    color: "#173428",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "capitalize",
  },
  toolScroll: {
    minWidth: 0,
  },
  toolRow: {
    alignItems: "center",
    gap: 7,
    paddingRight: 2,
  },
  sidebarToolGrid: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  workflowActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  workflowActionButton: {
    alignItems: "center",
    backgroundColor: "#fffef8",
    borderColor: "#b9c8bd",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexGrow: 1,
    gap: 6,
    justifyContent: "center",
    minHeight: 42,
    minWidth: 92,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  workflowActionText: {
    color: "#173428",
    fontSize: 11,
    fontWeight: "900",
  },
  toolGroupShell: {
    borderTopWidth: 3,
    borderRadius: 8,
  },
  toolButton: {
    alignItems: "center",
    backgroundColor: "#eef4ef",
    borderColor: "#cbd8ce",
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 0,
    gap: 4,
    height: 44,
    justifyContent: "center",
    paddingHorizontal: 7,
    paddingVertical: 7,
    width: 44,
  },
  toolButtonExpanded: {
    minWidth: 72,
    width: "auto",
  },
  sidebarToolButton: {
    flexBasis: 94,
    flexGrow: 1,
    height: 52,
    minWidth: 86,
  },
  toolButtonActive: {
    backgroundColor: "#173428",
    borderColor: "#173428",
  },
  toolText: {
    color: "#173428",
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  toolTextActive: {
    color: "#ffffff",
  },
  notice: {
    color: "#7a4a12",
    flexBasis: "100%",
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 15,
    textAlign: "center",
  },
});
