import React, { useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

export interface CommandMenuItemConfig {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  onPress: () => void | Promise<void>;
  testID?: string;
}

export interface CommandMenuConfig {
  id: string;
  label: string;
  icon?: React.ReactNode;
  items: CommandMenuItemConfig[];
  testID?: string;
}

export interface CommandIconButtonConfig {
  id: string;
  label: string;
  disabled?: boolean;
  hint?: string;
  icon: React.ReactNode;
  onPress: () => void | Promise<void>;
  selected?: boolean;
  showLabel?: boolean;
  testID?: string;
}

export function CommandBar({
  iconButtons = [],
  menus,
  testID = "command-bar",
}: {
  iconButtons?: CommandIconButtonConfig[];
  menus: CommandMenuConfig[];
  testID?: string;
}): React.JSX.Element {
  const { height, width } = useWindowDimensions();
  const sheetMode = width < 900;
  const sheetWidth = Math.max(0, Math.floor(width));
  const sheetHeight = Math.max(0, Math.floor(height));
  const sheetMaxHeight = Math.max(260, Math.floor(height * 0.86));
  const sheetScrollMaxHeight = Math.max(160, sheetMaxHeight - 86);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  return (
    <View style={styles.commandBar} testID={testID}>
      <View style={styles.menuCluster}>
        {menus.map((menu, index) => (
          <CommandMenu
            alignPanelEnd={index === menus.length - 1}
            key={menu.id}
            menu={menu}
            onClose={() => setOpenMenuId(null)}
            onOpen={() => setOpenMenuId((current) => current === menu.id ? null : menu.id)}
            open={openMenuId === menu.id}
            sheetHeight={sheetHeight}
            sheetMaxHeight={sheetMaxHeight}
            sheetMode={sheetMode}
            sheetScrollMaxHeight={sheetScrollMaxHeight}
            sheetWidth={sheetWidth}
          />
        ))}
      </View>
      {iconButtons.length > 0 ? (
        <View style={styles.iconCluster}>
          {iconButtons.map((button) => (
            <IconCommandButton key={button.id} {...button} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function CommandMenu({
  alignPanelEnd = false,
  menu,
  onClose,
  onOpen,
  open,
  sheetHeight,
  sheetMaxHeight,
  sheetMode,
  sheetScrollMaxHeight,
  sheetWidth,
}: {
  alignPanelEnd?: boolean;
  menu: CommandMenuConfig;
  onClose: () => void;
  onOpen: () => void;
  open: boolean;
  sheetHeight: number;
  sheetMaxHeight: number;
  sheetMode: boolean;
  sheetScrollMaxHeight: number;
  sheetWidth: number;
}): React.JSX.Element {
  const panel = (
    <CommandMenuPanel
      menu={menu}
      onSelect={(item) => {
        onClose();
        void item.onPress();
      }}
      scrollMaxHeight={sheetMode ? sheetScrollMaxHeight : undefined}
    />
  );

  return (
    <View style={styles.menuAnchor}>
      <Pressable
        accessibilityLabel={`${menu.label} menu`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onOpen}
        style={[styles.menuButton, open && styles.menuButtonOpen]}
        testID={menu.testID ?? `command-menu-${menu.id}`}
        {...webProps(menu.label, { "aria-expanded": String(open), "aria-haspopup": "menu" })}
      >
        {tintIcon(menu.icon, open ? "#ffffff" : "#254234", 16)}
        <Text style={[styles.menuButtonText, open && styles.menuButtonTextOpen]}>{menu.label}</Text>
      </Pressable>
      {sheetMode && open ? (
        <Modal animationType="fade" onRequestClose={onClose} transparent visible>
          <View style={[styles.sheetBackdrop, { height: sheetHeight, maxWidth: sheetWidth, width: sheetWidth }]}>
            <Pressable accessibilityLabel={`Close ${menu.label} menu backdrop`} accessibilityRole="button" onPress={onClose} style={styles.sheetScrim} testID={`command-menu-${menu.id}-backdrop`} />
            <View accessibilityViewIsModal style={[styles.sheetPanel, { maxHeight: sheetMaxHeight, maxWidth: sheetWidth, width: sheetWidth }]} testID={`command-menu-${menu.id}-panel`}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{menu.label}</Text>
                <Pressable accessibilityLabel={`Close ${menu.label} menu`} accessibilityRole="button" onPress={onClose} style={styles.closeButton} testID={`command-menu-${menu.id}-close`}>
                  <Text style={styles.closeButtonText}>Close</Text>
                </Pressable>
              </View>
              {panel}
            </View>
          </View>
        </Modal>
      ) : open ? (
        <View style={[styles.desktopPanel, alignPanelEnd && styles.desktopPanelEnd]} testID={`command-menu-${menu.id}-panel`}>
          {panel}
        </View>
      ) : null}
    </View>
  );
}

export function CommandMenuItem({
  item,
  onSelect,
}: {
  item: CommandMenuItemConfig;
  onSelect: (item: CommandMenuItemConfig) => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={item.label}
      accessibilityRole="menuitem"
      accessibilityState={{ disabled: item.disabled }}
      disabled={item.disabled}
      onPress={() => onSelect(item)}
      style={[styles.menuItem, item.disabled && styles.menuItemDisabled]}
      testID={item.testID}
    >
      <View style={styles.menuItemIcon}>{tintIcon(item.icon, item.disabled ? "#79887e" : "#254234", 17)}</View>
      <View style={styles.menuItemTextBlock}>
        <Text style={[styles.menuItemLabel, item.disabled && styles.menuItemLabelDisabled]}>{item.label}</Text>
        {item.description ? <Text style={styles.menuItemDescription}>{item.description}</Text> : null}
      </View>
    </Pressable>
  );
}

export function IconCommandButton({
  disabled = false,
  hint,
  icon,
  label,
  onPress,
  selected = false,
  showLabel = false,
  testID,
}: CommandIconButtonConfig): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.iconButton, showLabel && styles.iconButtonWithLabel, selected && styles.iconButtonSelected, disabled && styles.iconButtonDisabled]}
      testID={testID ?? `command-icon-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      {...controlHintProps({ hint, label, selected, showLabel })}
    >
      {tintIcon(icon, selected ? "#ffffff" : disabled ? "#79887e" : "#254234", 18)}
      {showLabel ? <Text style={[styles.iconButtonText, selected && styles.iconButtonTextSelected, disabled && styles.iconButtonTextDisabled]}>{label}</Text> : null}
    </Pressable>
  );
}

function CommandMenuPanel({
  menu,
  onSelect,
  scrollMaxHeight,
}: {
  menu: CommandMenuConfig;
  onSelect: (item: CommandMenuItemConfig) => void;
  scrollMaxHeight?: number;
}): React.JSX.Element {
  return (
    <ScrollView style={[styles.menuScroll, scrollMaxHeight ? { maxHeight: scrollMaxHeight } : undefined]} contentContainerStyle={styles.menuScrollContent}>
      {menu.items.map((item) => (
        <CommandMenuItem item={item} key={item.id} onSelect={onSelect} />
      ))}
    </ScrollView>
  );
}

function tintIcon(icon: React.ReactNode, color: string, size: number): React.ReactNode {
  if (!icon) return null;
  if (!React.isValidElement<{ color?: string; size?: number }>(icon)) return icon;
  return React.cloneElement(icon, { color, size });
}

function webProps(title: string, extra?: Record<string, string>): Record<string, unknown> {
  if (Platform.OS !== "web") return {};
  return { title, ...extra };
}

function controlHintProps({
  hint,
  label,
  selected,
  showLabel,
}: {
  hint?: string;
  label: string;
  selected?: boolean;
  showLabel: boolean;
}): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (hint) props.accessibilityHint = hint;
  if (Platform.OS === "web") {
    if (!showLabel) props.title = hint ? `${label}: ${hint}` : label;
    if (selected) props["aria-pressed"] = "true";
  }
  return props;
}

const styles = StyleSheet.create({
  commandBar: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "nowrap",
    flexShrink: 0,
    gap: 8,
    justifyContent: "flex-start",
    maxWidth: "100%",
    width: "auto",
    zIndex: 20,
  },
  closeButton: {
    backgroundColor: "#eef4ef",
    borderColor: "#c7d6ca",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  closeButtonText: {
    color: "#173428",
    fontSize: 12,
    fontWeight: "900",
  },
  desktopPanel: {
    backgroundColor: "#fbfcf8",
    borderColor: "#c7d6ca",
    borderRadius: 8,
    borderWidth: 1,
    boxShadow: "0 12px 28px rgba(14, 28, 21, 0.18)",
    maxHeight: 460,
    minWidth: 282,
    padding: 6,
    left: 0,
    position: "absolute",
    top: 44,
    width: 318,
    zIndex: 30,
  },
  desktopPanelEnd: {
    left: "auto",
    right: 0,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "#eef4ef",
    borderColor: "#c7d6ca",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    height: 48,
    justifyContent: "center",
    minWidth: 48,
    paddingHorizontal: 9,
  },
  iconButtonDisabled: {
    opacity: 0.45,
  },
  iconButtonSelected: {
    backgroundColor: "#254234",
    borderColor: "#254234",
  },
  iconButtonText: {
    color: "#254234",
    fontSize: 12,
    fontWeight: "900",
  },
  iconButtonTextDisabled: {
    color: "#79887e",
  },
  iconButtonTextSelected: {
    color: "#ffffff",
  },
  iconButtonWithLabel: {
    paddingHorizontal: 11,
  },
  iconCluster: {
    flexDirection: "row",
    flexShrink: 0,
    flexWrap: "nowrap",
    gap: 6,
  },
  menuAnchor: {
    position: "relative",
    zIndex: 24,
  },
  menuButton: {
    alignItems: "center",
    backgroundColor: "#eef4ef",
    borderColor: "#c7d6ca",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  menuButtonOpen: {
    backgroundColor: "#254234",
    borderColor: "#254234",
  },
  menuButtonText: {
    color: "#254234",
    fontSize: 12,
    fontWeight: "900",
  },
  menuButtonTextOpen: {
    color: "#ffffff",
  },
  menuCluster: {
    flexDirection: "row",
    flexShrink: 0,
    flexWrap: "nowrap",
    gap: 6,
    maxWidth: "100%",
    minWidth: 0,
  },
  menuItem: {
    alignItems: "flex-start",
    borderRadius: 8,
    flexDirection: "row",
    gap: 9,
    minHeight: 50,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  menuItemDescription: {
    color: "#59695f",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 15,
  },
  menuItemDisabled: {
    opacity: 0.5,
  },
  menuItemIcon: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  menuItemLabel: {
    color: "#17241c",
    fontSize: 13,
    fontWeight: "900",
  },
  menuItemLabelDisabled: {
    color: "#6d7c72",
  },
  menuItemTextBlock: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  menuScroll: {
    flexShrink: 1,
    maxHeight: 420,
    overflow: "scroll",
  },
  menuScrollContent: {
    gap: 3,
  },
  sheetBackdrop: {
    alignItems: "stretch",
    backgroundColor: "rgba(12, 22, 17, 0.34)",
    justifyContent: "flex-end",
    zIndex: 60,
  },
  sheetHeader: {
    alignItems: "center",
    borderBottomColor: "#d7e0d8",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingBottom: 10,
  },
  sheetPanel: {
    alignSelf: "stretch",
    backgroundColor: "#fbfcf8",
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    gap: 10,
    overflow: "hidden",
    padding: 12,
    zIndex: 70,
  },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetTitle: {
    color: "#17241c",
    flex: 1,
    fontSize: 17,
    fontWeight: "900",
  },
});
