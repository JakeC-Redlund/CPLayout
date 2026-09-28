import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { DRAWING_CLASSIFICATION_VERSION, drawingPurposesForGeometry, drawingPurpose, parseDrawingClassification,
  type DesignDraft, type DraftDrawingCapture, type DrawingClassification, type DrawingPlacement } from "@cplayout/core";

export function DrawingClassificationDialog({ capture, draft, error, onCancel, onConfirm }: {
  capture: DraftDrawingCapture; draft: DesignDraft; error: string | null;
  onCancel: (proposal: DraftDrawingCapture["classification"]) => void; onConfirm: (classification: DrawingClassification, replaceExisting: boolean) => void;
}): React.JSX.Element {
  const options = drawingPurposesForGeometry(capture.geometryType);
  const suggested = capture.classification.purposeId ?? (capture.name === "Field boundary" ? "field_boundary" : "");
  const [purposeId, setPurposeId] = useState(suggested);
  const purpose = drawingPurpose(purposeId);
  const [choicesOpen, setChoicesOpen] = useState(!purpose);
  const [name, setName] = useState(capture.classification.name);
  const [notes, setNotes] = useState(capture.classification.notes);
  const [customLabel, setCustomLabel] = useState("");
  const [assetStatus, setAssetStatus] = useState<DrawingClassification["assetStatus"]>("unknown");
  const [placement, setPlacement] = useState<DrawingPlacement>(purpose?.placements[0] ?? "not_applicable");
  const [exclusion, setExclusion] = useState(false);
  const [noSpray, setNoSpray] = useState(false);
  const [hardConflict, setHardConflict] = useState(false);
  const [buffer, setBuffer] = useState("0");
  const [replace, setReplace] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const exclusionAllowed = capture.geometryType === "Polygon" && purpose?.destination === "feature";
  const replacing = purpose?.destination === "field_boundary" ? draft.fieldBoundary.length > 0
    : purpose?.destination === "pivot_center" ? draft.pivotCenter !== null
    : purpose?.destination === "water_source" ? draft.waterSource !== null
    : purpose?.destination === "power_source" ? draft.powerSource !== null : false;
  const cancel = () => onCancel({ purposeId: purposeId || null, name, notes });
  function submit() {
    try {
      if (replacing && !replace) throw new Error("Confirm replacement of the existing design location or boundary.");
      if (exclusion && (!buffer.trim() || !Number.isFinite(Number(buffer)))) throw new Error("Enter a valid buffer in meters.");
      const value = parseDrawingClassification({ schemaVersion: DRAWING_CLASSIFICATION_VERSION,
        geometryType: capture.geometryType, purposeId, name, notes, assetStatus, placement,
        customLabel: purpose?.custom ? customLabel : null,
        effect: exclusion ? { mode: "exclusion", noSpray, hardConflict, bufferMeters: Number(buffer) } : { mode: "informational" } });
      setLocalError(null); onConfirm(value, replacing && replace);
    } catch (failure) { setLocalError(failure instanceof Error ? failure.message : String(failure)); }
  }
  return <Modal transparent animationType="fade" visible onRequestClose={cancel}>
    <View style={styles.backdrop}>
      <View accessibilityViewIsModal style={styles.dialog} testID="drawing-classification-dialog">
        <View style={styles.header}><Text style={styles.title}>What did you draw?</Text>
          <Text style={styles.helper}>{capture.geometryType === "LineString" ? "Line" : capture.geometryType} · {capture.vertices.length} points. Choose its purpose and effects.</Text></View>
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.body} contentContainerStyle={styles.content}>
          <Text style={styles.label}>Purpose</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose drawing purpose" onPress={() => setChoicesOpen(!choicesOpen)} style={styles.input} testID="drawing-purpose-select">
            <Text>{purpose?.label ?? "Choose a purpose"} ▾</Text></Pressable>
          {choicesOpen && <View style={styles.choices}>{options.map(option => <Pressable key={option.id} accessibilityRole="radio"
            accessibilityState={{ checked: purposeId === option.id }} testID={`drawing-purpose-${option.id}`} style={styles.choice}
            onPress={() => { setPurposeId(option.id); setPlacement(option.placements[0]); setExclusion(option.id === "exclusion_area");
              setNoSpray(false); setHardConflict(false); setReplace(false); setChoicesOpen(false); setLocalError(null); }}>
            <Text>{option.label}</Text></Pressable>)}</View>}
          <Field label="Name" value={name} onChange={setName} id="drawing-name" />
          {purpose?.custom && <Field label="Other purpose" value={customLabel} onChange={setCustomLabel} id="drawing-custom-label" />}
          <Field label="Notes" value={notes} onChange={setNotes} id="drawing-notes" multiline />
          <Text style={styles.label}>Asset status</Text>
          <View style={styles.row}>{(["unknown", "existing", "proposed"] as const).map(value => <Choice key={value} label={value} selected={assetStatus === value} onPress={() => setAssetStatus(value)} />)}</View>
          {purpose && purpose.placements[0] !== "not_applicable" && <><Text style={styles.label}>Placement</Text>
            <View style={styles.row}>{purpose.placements.map(value => <Choice key={value} label={value} selected={placement === value} onPress={() => setPlacement(value)} />)}</View></>}
          {exclusionAllowed && <Toggle label="Apply exclusion effects" value={exclusion} onChange={value => { setExclusion(value); setNoSpray(false); setHardConflict(false); }} id="drawing-exclusion" />}
          {exclusion && <>
            <Toggle label="No spray" value={noSpray} onChange={setNoSpray} id="drawing-no-spray" />
            <Toggle label="Machine conflict" value={hardConflict} onChange={setHardConflict} id="drawing-hard-conflict" />
            <Field label="Buffer (meters)" value={buffer} onChange={setBuffer} id="drawing-buffer" />
          </>}
          <Text style={styles.helper} testID="drawing-effect-summary">{exclusion ? "The selected exclusion effects apply to this polygon and its buffer."
            : purpose?.destination === "field_boundary" ? "Sets the operational field boundary used in design calculations."
            : purpose && purpose.destination !== "feature" ? `Sets the ${purpose.label.toLowerCase()} used in design calculations.`
            : "Informational map feature. No no-spray area or machine conflict is added."}</Text>
          {replacing && <Toggle label={`Replace existing ${purpose?.label.toLowerCase()}`} value={replace} onChange={setReplace} id="drawing-replace-existing" />}
          <Text style={styles.helper}>Map-drawn coordinates; GPS and elevation are unknown.</Text>
          {(localError || error) && <Text accessibilityRole="alert" style={styles.error} testID="drawing-classification-error">{localError || error}</Text>}
        </ScrollView>
        <View style={styles.footer}>
          <Pressable accessibilityRole="button" onPress={cancel} style={styles.secondary} testID="drawing-classification-cancel"><Text style={styles.secondaryText}>Back to drawing</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={submit} style={styles.primary} testID="drawing-classification-confirm"><Text style={styles.primaryText}>Keep drawing</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}
function Field({ label, value, onChange, id, multiline = false }: { label: string; value: string; onChange: (value: string) => void; id: string; multiline?: boolean }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange}
    multiline={multiline} style={[styles.input, multiline && styles.multiline]} testID={id} /></View>;
}
function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected }} onPress={onPress}
    style={[styles.secondary, selected && styles.selected]}><Text style={styles.secondaryText}>{label[0].toUpperCase() + label.slice(1)}</Text></Pressable>;
}
function Toggle({ label, value, onChange, id }: { label: string; value: boolean; onChange: (value: boolean) => void; id: string }) {
  return <View style={styles.toggle}><Text style={styles.label}>{label}</Text><Switch accessibilityLabel={label} value={value} onValueChange={onChange} testID={id} /></View>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(19,33,27,0.58)", padding: 12 },
  dialog: { width: "100%", maxWidth: 540, maxHeight: "92%", backgroundColor: "#fbfcf8", borderRadius: 8, borderWidth: 1, borderColor: "#d6ded3", overflow: "hidden" },
  header: { padding: 16, gap: 6, backgroundColor: "#f4f8f1", borderBottomWidth: 1, borderColor: "#d6ded3" },
  title: { fontSize: 18, fontWeight: "900", color: "#14221b" }, helper: { fontSize: 13, lineHeight: 18, color: "#526257" },
  body: { flexShrink: 1 }, content: { padding: 16, gap: 12 }, field: { gap: 7 }, label: { fontSize: 13, fontWeight: "700", color: "#3c4f43", flexShrink: 1 },
  input: { backgroundColor: "#fff", borderColor: "#cdd8ca", borderWidth: 1, borderRadius: 8, minHeight: 44, padding: 11, color: "#1d2c22", fontSize: 15 },
  multiline: { minHeight: 72, textAlignVertical: "top" }, choices: { borderWidth: 1, borderColor: "#cdd8ca", borderRadius: 8 }, choice: { minHeight: 44, padding: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, toggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  footer: { padding: 12, gap: 8, flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", backgroundColor: "#f4f8f1", borderTopWidth: 1, borderColor: "#d6ded3" },
  primary: { backgroundColor: "#254234", borderRadius: 8, padding: 12, minHeight: 44 }, primaryText: { color: "#fff", fontSize: 13, fontWeight: "900" },
  secondary: { backgroundColor: "#f1f5ee", borderColor: "#cdd8ca", borderWidth: 1, borderRadius: 8, padding: 12, minHeight: 44 },
  secondaryText: { color: "#254234", fontSize: 13, fontWeight: "700" }, selected: { borderColor: "#14734b", backgroundColor: "#e8f5ed" }, error: { color: "#922c24", fontSize: 14 },
});
