import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polygon, Polyline } from "react-native-svg";
import { projectRepository } from "@cplayout/project-store";
import { savedDesignPreviewGeometry, unavailableSavedPreview, type SavedPreviewGeometry } from "./savedDesignPreviewGeometry";

export interface SavedDesignPreviewProps {
  designId: string;
  /** Saved design revision, not the active editor or workspace revision. */
  revision?: number;
  fieldName?: string;
  onOpen?: () => void;
}

export function SavedDesignPreview({ designId, revision, fieldName, onOpen }: SavedDesignPreviewProps) {
  const [loaded, setLoaded] = useState<{ designId: string; revision?: number; geometry: SavedPreviewGeometry } | null>(null);
  useEffect(() => {
    let current = true;
    const repository = projectRepository.versionedWorkspace;
    const publish = (geometry: SavedPreviewGeometry) => { if (current) setLoaded({ designId, revision, geometry }); };
    if (!repository) publish(unavailableSavedPreview());
    else repository.readDesignAsync(designId)
      .then(read => publish(savedDesignPreviewGeometry(read, designId, revision)))
      .catch(() => publish(unavailableSavedPreview()));
    return () => { current = false; };
  }, [designId, revision]);
  // A changed identity cannot flash the preceding design while its read is pending.
  const geometry = loaded?.designId === designId && loaded.revision === revision ? loaded.geometry : null;
  const bounds = geometry?.bounds;
  const scale = bounds ? Math.min(200 / Math.max(bounds.width, 1), 86 / Math.max(bounds.height, 1)) : 1;
  const screen = (p: { x: number; y: number }) => ({
    x: 110 + (p.x - (bounds?.minX ?? 0) - (bounds?.width ?? 0) / 2) * scale,
    y: 53 - (p.y - (bounds?.minY ?? 0) - (bounds?.height ?? 0) / 2) * scale,
  });
  return <View style={styles.container} testID={`saved-design-preview-${designId}`}>
    <View style={styles.drawing} accessibilityLabel={geometry?.status === "ready" ? "Saved geometry preview" : undefined}>
      {geometry?.status === "ready" ? <Svg width="100%" height={106} viewBox="0 0 220 106" pointerEvents="none">
        {geometry.shapes.map((shape, index) => {
          const color = shape.role === "boundary" ? "#527651" : shape.role === "machine" ? "#236c8c" : "#827665";
          if (shape.kind === "point") { const p = screen(shape.point); return <Circle key={index} cx={p.x} cy={p.y} r={shape.role === "machine" ? 4 : 2.8} fill={color} />; }
          if (shape.kind === "circle") { const p = screen(shape.center); return <Circle key={index} cx={p.x} cy={p.y} r={shape.radius * scale} fill="none" stroke={color} strokeWidth={1.5} />; }
          const points = shape.points.map(point => { const p = screen(point); return `${p.x},${p.y}`; }).join(" ");
          return shape.closed ? <Polygon key={index} points={points} fill={shape.role === "boundary" ? "#dce8d9" : "none"} stroke={color} strokeWidth={1.5} />
            : <Polyline key={index} points={points} fill="none" stroke={color} strokeWidth={1.5} />;
        })}
      </Svg> : <Text style={styles.placeholder}>{!geometry ? "Loading preview…" : geometry.status === "empty" ? "No geometry yet" : "Preview unavailable"}</Text>}
    </View>
    <Text style={styles.context} numberOfLines={1}>{[geometry && geometry.status !== "unavailable" ? geometry.label : null, fieldName].filter(Boolean).join(" · ") || "Saved design"}</Text>
    {onOpen ? <Pressable accessibilityRole="button" accessibilityLabel="Open saved design" onPress={onOpen} style={styles.open}><Text style={styles.openLabel}>Open</Text></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 5 },
  drawing: { height: 106, backgroundColor: "#f1f4ee", borderRadius: 7, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  placeholder: { color: "#646e63", fontSize: 12 },
  context: { color: "#596659", fontSize: 11 },
  open: { alignSelf: "flex-start", paddingVertical: 7, paddingHorizontal: 12, borderRadius: 5, backgroundColor: "#e6eee2" },
  openLabel: { color: "#284b2b", fontSize: 12, fontWeight: "600" },
});
