import React, { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { drawingPurpose, type DesignDraft, type DraftDrawingCapture, type DrawingClassification } from "@cplayout/core";
import { classificationForSelection, drawingSelectionReplaces, drawingSelections } from "./drawingClassificationSelection";

/** Kept at the existing import boundary; this is one inline selector, never a modal. */
export function DrawingClassificationDialog({ capture, draft, error, onCancel, onConfirm }: {
  capture: DraftDrawingCapture; draft: DesignDraft; error: string | null;
  onCancel: (proposal: DraftDrawingCapture["classification"]) => void; onConfirm: (classification: DrawingClassification, replaceExisting: boolean) => void;
}): React.JSX.Element {
  const options = drawingSelections(capture.geometryType);
  const [selectionId, setSelectionId] = useState(options.some(option => option.id === capture.classification.purposeId) ? capture.classification.purposeId! : "");
  const [name, setName] = useState(capture.classification.purposeId === null && capture.classification.name === capture.name ? "" : capture.classification.name);
  const [notes, setNotes] = useState(capture.classification.notes);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [choicesOpen, setChoicesOpen] = useState(false);
  const [replacement, setReplacement] = useState<DrawingClassification | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  function choose(id: string) {
    setSelectionId(id); setChoicesOpen(false); setReplacement(null); setLocalError(null);
  }
  function submit(replaceExisting = false) {
    try {
      const classification = classificationForSelection({ ...capture, classification: { ...capture.classification, name, notes } }, selectionId);
      if (drawingSelectionReplaces(draft, classification) && !replaceExisting) setReplacement(classification);
      else onConfirm(classification, replaceExisting);
    } catch (failure) { setLocalError(failure instanceof Error ? failure.message : String(failure)); }
  }
  return <View style={styles.container} testID="drawing-classification-inline">
    <View style={styles.row}><Text style={styles.label}>What did you draw?</Text>
      {Platform.OS === "web" ? React.createElement("select", {
        "aria-label": "Drawing purpose", "data-testid": "drawing-purpose-select", value: selectionId,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => choose(event.target.value),
        style: { minHeight: 44, minWidth: 0, width: "100%", maxWidth: 390, padding: 10, fontSize: 15,
          color: "#1d2c22", background: "white", border: "1px solid #97aea1", borderRadius: 5 },
      }, React.createElement("option", { value: "" }, "Choose a purpose…"), ...options.map(option =>
        React.createElement("option", { key: option.id, value: option.id }, option.label)))
        : <View style={styles.nativeSelect}><Pressable accessibilityRole="button" accessibilityLabel="Choose drawing purpose"
          onPress={() => setChoicesOpen(!choicesOpen)} style={styles.select} testID="drawing-purpose-select">
          <Text>{options.find(option => option.id === selectionId)?.label ?? "Choose a purpose…"} ▾</Text></Pressable>
          {choicesOpen && <ScrollView style={styles.choices}>{options.map(option => <Pressable key={option.id}
            accessibilityRole="button" onPress={() => choose(option.id)} style={styles.choice} testID={`drawing-purpose-${option.id}`}>
            <Text>{option.label}</Text></Pressable>)}</ScrollView>}</View>}
      <Pressable accessibilityRole="button" onPress={() => onCancel({ purposeId: options.find(option => option.id === selectionId)?.purposeId ?? capture.classification.purposeId, name, notes })} style={styles.back} testID="drawing-classification-cancel">
        <Text style={styles.label}>Back to drawing</Text></Pressable>
    </View>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen(open => !open)} style={styles.back} testID="drawing-details-toggle">
        <Text style={styles.label}>{detailsOpen ? "Hide optional details" : "Optional name and notes"}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={!selectionId} onPress={() => submit()} style={[styles.confirm, !selectionId && styles.disabled]} testID="drawing-classification-keep">
        <Text style={styles.confirmText}>Keep drawing</Text>
      </Pressable>
    </View>
    <View style={!detailsOpen && styles.hidden}>
      <Text style={styles.label}>Name (optional)</Text>
      <TextInput accessibilityLabel="Drawing name" value={name} onChangeText={setName} style={styles.select} testID="drawing-name" />
      <Text style={styles.label}>Notes (optional)</Text>
      <TextInput accessibilityLabel="Drawing notes" value={notes} onChangeText={setNotes} multiline style={styles.select} testID="drawing-notes" />
    </View>
    {replacement && <View style={styles.row} testID="drawing-replacement-review">
      <Text style={styles.helper}>Replace the saved {drawingPurpose(replacement.purposeId)!.label.toLowerCase()} with this drawing?</Text>
      <Pressable accessibilityRole="button" onPress={() => submit(true)} style={styles.confirm} testID="drawing-classification-confirm">
        <Text style={styles.confirmText}>Replace saved {drawingPurpose(replacement.purposeId)!.label.toLowerCase()}</Text></Pressable>
    </View>}
    {(localError || error) && <Text accessibilityRole="alert" style={styles.error} testID="drawing-classification-error">{localError || error}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  hidden: { display: "none" }, disabled: { opacity: 0.5 },
  container: { padding: 10, gap: 8, backgroundColor: "#f4f8f1", borderBottomWidth: 1, borderColor: "#cdd8d1" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  label: { color: "#254234", fontWeight: "600", fontSize: 14 }, helper: { color: "#526257", fontSize: 13, flexShrink: 1 },
  nativeSelect: { flex: 1, minWidth: 180, maxWidth: 390 }, select: { minHeight: 44, padding: 10, borderWidth: 1, borderColor: "#97aea1", backgroundColor: "white", borderRadius: 5 },
  choices: { maxHeight: 180, borderWidth: 1, borderColor: "#97aea1" }, choice: { minHeight: 44, padding: 12, backgroundColor: "white" },
  back: { minHeight: 44, padding: 10, justifyContent: "center" }, confirm: { padding: 12, backgroundColor: "#254234", borderRadius: 5 },
  confirmText: { color: "white", fontWeight: "600" }, error: { color: "#922c24", fontSize: 14 },
});
