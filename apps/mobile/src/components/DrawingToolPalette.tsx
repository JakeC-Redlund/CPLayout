import {
  Calculator,
  ChevronDown,
  Circle,
  Hand,
  Layers,
  MapPin,
  MousePointer2,
  Pentagon,
  Route,
  Satellite,
  Wrench,
  X,
} from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import type { AppSettings, ProjectMapFeatureKind } from "@cplayout/core";
import type { DrawingLayerType, DrawingMode } from "@cplayout/geometry";
import { MAP_TOOL_CATALOG, type MapToolCatalogItem, type MapToolId, type UtilityFeatureGeometry } from "@cplayout/map-adapters";

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
  onActivatePrimitive: (geometry: UtilityFeatureGeometry) => void;
  onCalculate: () => void;
  onOpenModal: (modal: DrawingToolPaletteModal) => void;
  onToggleLayers: () => void;
  onOpenReceiver?: () => void;
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
  onActivatePrimitive,
  onCalculate,
  onOpenModal,
  onToggleLayers,
  onOpenReceiver,
  settings,
}: DrawingToolPaletteProps): React.JSX.Element {
  return (
    <View style={styles.bottomHud} testID="map-bottom-hud">
      <DrawingToolLauncher
        activeModal={activeModal}
        activeTool={activeTool}
        onActivateTool={onActivateTool}
        onActivatePrimitive={onActivatePrimitive}
        onCalculate={onCalculate}
        onOpenModal={onOpenModal}
        onToggleLayers={onToggleLayers}
        onOpenReceiver={onOpenReceiver}
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
  onActivatePrimitive,
  onCalculate,
  onOpenModal,
  onToggleLayers,
  onOpenReceiver,
  settings,
  showGeometryTools = true,
  variant,
}: DrawingToolLauncherProps): React.JSX.Element {
  const { width, height } = useWindowDimensions();
  const [openToolId, setOpenToolId] = useState<MapToolId | null>(null);
  const triggerRefs = useRef<Partial<Record<MapToolId, View | null>>>({});
  const focusReturnToolRef = useRef<MapToolId | null>(null);
  const menuCloseRef = useRef<View | null>(null);
  const sidebar = variant === "sidebar";
  const shortLandscape = !sidebar && width > height && height < 500;
  const designMode = settings.mappingWorkflowMode === "design";
  const activeToolId = useMemo(() => activeMapToolId(activeModal, activeTool), [activeModal, activeTool]);
  const statusText = activeToolStatus(activeModal, activeTool, designMode);
  const expanded = !shortLandscape;
  const openTool = MAP_TOOL_CATALOG.find((tool) => tool.id === openToolId);
  useEffect(() => setOpenToolId(null), [settings.mappingWorkflowMode]);
  useEffect(() => {
    if (openToolId !== null || focusReturnToolRef.current === null) return;
    const toolId = focusReturnToolRef.current;
    focusReturnToolRef.current = null;
    triggerRefs.current[toolId]?.focus();
  }, [openToolId]);
  useEffect(() => {
    if (Platform.OS === "web" && shortLandscape && openToolId !== null) menuCloseRef.current?.focus();
  }, [openToolId, shortLandscape]);

  function closeMenu(restoreFocus = true): void {
    if (restoreFocus) focusReturnToolRef.current = openToolId;
    setOpenToolId(null);
  }

  function runMenuAction(action: () => void): void {
    closeMenu(false);
    action();
  }

  function runTool(tool: MapToolCatalogItem): void {
    const action = tool.action;
    if (!designMode && tool.id !== "pan") return;
    if (action.type === "draw") {
      onActivatePrimitive(action.geometry);
      return;
    }
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
    <View style={[styles.shell, sidebar && styles.sidebarShell, shortLandscape && styles.shellShortLandscape]} testID="design-action-hud"
      {...(Platform.OS === "web" ? { onKeyDown: (event: { key: string; stopPropagation: () => void; preventDefault: () => void }) => {
        if (event.key === "Escape" && openToolId) { event.stopPropagation(); event.preventDefault(); closeMenu(); }
      } } : {})}>
      <View style={[styles.statusRow, shortLandscape && styles.statusRowShortLandscape]}>
        <View style={styles.activeChip} testID="map-hud-active-tool-chip">
          <Text numberOfLines={sidebar ? 2 : 1} style={styles.activeChipText}>{statusText}</Text>
        </View>
        {openTool ? <Pressable ref={menuCloseRef} accessibilityRole="button" accessibilityLabel="Close tool options" onPress={() => closeMenu()}
          style={[styles.menuClose, shortLandscape && styles.menuCloseShortLandscape]}><X size={16} color="#173428" /></Pressable> : null}
      </View>
      {!sidebar && openTool ? (
        <ScrollView horizontal showsHorizontalScrollIndicator style={shortLandscape && styles.toolScrollShortLandscape}
          contentContainerStyle={styles.menuActions} testID="map-tool-options">
          <MenuAction label={primaryActionLabel(openTool.id)} disabled={!designMode && openTool.id !== "pan"}
            icon={toolIcon(openTool.id, false)} testID={`${legacyTestId(openTool.id)}-start`}
            onPress={() => runMenuAction(() => runTool(openTool))} />
          {openTool.id === "polygon" ? <>
            <MenuAction label="Field boundary" disabled={!designMode} icon={<Pentagon size={17} color="#173428" />}
              testID="map-tool-field-boundary" onPress={() => runMenuAction(() => onActivateTool("draw_boundary", "field_boundary"))} />
            <MenuAction label="Keep-out area" disabled={!designMode} icon={<Pentagon size={17} color="#173428" />}
              testID="map-tool-keep-out" onPress={() => runMenuAction(() => onActivateTool("mark_obstacle", "obstacle"))} />
          </> : null}
          {openTool.id === "circle" ? <MenuAction label="Machine" disabled={!designMode} icon={<Wrench size={17} color="#173428" />}
            testID="map-tool-machine" onPress={() => runMenuAction(() => onOpenModal("machine"))} /> : null}
          {onOpenReceiver && (openTool.id === "point" || openTool.id === "line" || openTool.id === "polygon") ? (
            <MenuAction label="Open Survey" icon={<Satellite size={17} color="#173428" />} testID="map-tool-rtk"
              onPress={() => runMenuAction(onOpenReceiver)} />
          ) : <MenuAction label="Layers" icon={<Layers size={17} color="#173428" />} testID="map-tool-layers" onPress={() => runMenuAction(onToggleLayers)} />}
        </ScrollView>
      ) : null}
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
          showsHorizontalScrollIndicator
          style={[styles.toolScroll, shortLandscape && styles.toolScrollShortLandscape,
            shortLandscape && openTool && styles.toolScrollHidden]}
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
              onPress={() => setOpenToolId((current) => current === tool.id ? null : tool.id)}
              menuOpen={openToolId === tool.id}
              shortLandscape={shortLandscape}
              triggerRef={(ref) => { triggerRefs.current[tool.id] = ref; }}
              testID={groupTestId(tool.id)}
              tool={tool}
            />
          ))}
        </ScrollView>
      )}
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
  menuOpen,
  shortLandscape = false,
  triggerRef,
}: {
  active: boolean;
  expanded: boolean;
  icon: React.ReactNode;
  legacyTestID?: string;
  onPress: () => void;
  sidebar?: boolean;
  testID: string;
  tool: MapToolCatalogItem;
  menuOpen?: boolean;
  shortLandscape?: boolean;
  triggerRef?: (ref: View | null) => void;
}): React.JSX.Element {
  const visualGroup = toolVisualGroup(tool.id);
  return (
    <View style={[styles.toolGroupShell, { borderTopColor: visualGroup.color }]} testID={testID}>
      <Pressable
        ref={triggerRef}
        accessibilityLabel={tool.label}
        accessibilityHint={tool.statusLabel}
        accessibilityRole="button"
        accessibilityState={{ selected: active, ...(menuOpen === undefined ? {} : { expanded: menuOpen }) }}
        onPress={onPress}
        style={[styles.toolButton, { borderColor: visualGroup.borderColor }, expanded && styles.toolButtonExpanded,
          sidebar && styles.sidebarToolButton, shortLandscape && styles.toolButtonShortLandscape, active && styles.toolButtonActive]}
        testID={legacyTestID}
        {...toolButtonWebHint(tool.label, tool.statusLabel, active, expanded)}
        {...(Platform.OS === "web" && menuOpen !== undefined ? { "aria-expanded": menuOpen } : {})}
      >
        {icon}
        {expanded ? <Text style={[styles.toolText, active && styles.toolTextActive]}>{tool.shortLabel}</Text> : null}
        {menuOpen === undefined ? null : <ChevronDown size={12} color={active ? "#ffffff" : "#173428"} />}
      </Pressable>
    </View>
  );
}

function primaryActionLabel(id: MapToolId): string {
  switch (id) {
    case "pan": return "Pan map";
    case "edit": return "Edit vertices";
    case "point": return "Draw point";
    case "line": return "Draw line";
    case "polygon": return "Draw polygon";
    case "circle": return "Coverage settings";
  }
}

function MenuAction({ label, icon, onPress, testID, disabled = false }: {
  label: string; icon: React.ReactNode; onPress: () => void; testID: string; disabled?: boolean;
}): React.JSX.Element {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} testID={testID}
    style={[styles.menuAction, disabled && styles.menuActionDisabled]}>
    {icon}<Text style={styles.workflowActionText}>{label}</Text>
    {disabled ? <Text style={styles.designOnly}>Design only</Text> : null}
  </Pressable>;
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
  if (activeTool.mode === "measure" && activeTool.draftGeometry) return `Draw ${activeTool.draftGeometry === "LineString" ? "line" : activeTool.draftGeometry.toLowerCase()}`;
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
    title: `${label}: ${hint}`,
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
    alignSelf: "flex-start",
    maxWidth: 560,
    width: "100%",
  },
  shell: {
    backgroundColor: "rgba(251,252,248,0.96)",
    borderColor: "#c8d6cc",
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 0,
    gap: 4,
    minHeight: 56,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 7,
  },
  shellShortLandscape: {
    alignItems: "center",
    flexDirection: "row",
    paddingVertical: 3,
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
  statusRowShortLandscape: {
    flexShrink: 0,
    width: 116,
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
    flex: 1,
    minHeight: 18,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 1,
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
  toolScrollShortLandscape: {
    flex: 1,
  },
  toolScrollHidden: {
    display: "none",
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
    gap: 2,
    height: 58,
    justifyContent: "center",
    paddingHorizontal: 7,
    paddingVertical: 7,
    width: 44,
  },
  toolButtonExpanded: {
    minWidth: 64,
    width: "auto",
  },
  toolButtonShortLandscape: {
    flexDirection: "row",
    gap: 1,
    height: 44,
    paddingHorizontal: 3,
    paddingVertical: 3,
    width: 44,
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
  menuActions: { gap: 6, paddingVertical: 4, alignItems: "stretch" },
  menuClose: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  menuCloseShortLandscape: { width: 44, height: 44 },
  menuAction: { minHeight: 44, paddingHorizontal: 10, gap: 5, alignItems: "center", justifyContent: "center", flexDirection: "row", backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#b9c8bd", borderRadius: 4 },
  menuActionDisabled: { opacity: 0.55 },
  designOnly: { color: "#5b625e", fontSize: 10 },
});
