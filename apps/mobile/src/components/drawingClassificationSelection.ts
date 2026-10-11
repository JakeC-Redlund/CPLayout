import { DRAWING_CLASSIFICATION_VERSION, drawingPurposesForGeometry, drawingPurpose, parseDrawingClassification,
  type DesignDraft, type DraftDrawingCapture, type DrawingClassification } from "@cplayout/core";

export interface DrawingSelection { id: string; label: string; purposeId: string; noSpray?: boolean; hardConflict?: boolean }
/** Effects are choices in the same menu, not guesses from a drawing's appearance. */
export function drawingSelections(geometry: DraftDrawingCapture["geometryType"]): DrawingSelection[] {
  return drawingPurposesForGeometry(geometry).flatMap(purpose => purpose.id === "exclusion_area" ? [
    { id: "exclusion_no_spray", label: "No-spray area", purposeId: purpose.id, noSpray: true, hardConflict: false },
    { id: "exclusion_machine", label: "Machine obstacle", purposeId: purpose.id, noSpray: false, hardConflict: true },
    { id: "exclusion_both", label: "No-spray area and machine obstacle", purposeId: purpose.id, noSpray: true, hardConflict: true },
  ] : [{ id: purpose.id, label: purpose.label, purposeId: purpose.id }]);
}
export function classificationForSelection(capture: DraftDrawingCapture, selectionId: string): DrawingClassification {
  const selection = drawingSelections(capture.geometryType).find(item => item.id === selectionId);
  if (!selection) throw new Error("Choose a purpose for this drawing.");
  const purpose = drawingPurpose(selection.purposeId)!;
  const isToolName = capture.classification.purposeId === null && capture.classification.name === capture.name;
  return parseDrawingClassification({ schemaVersion: DRAWING_CLASSIFICATION_VERSION,
    geometryType: capture.geometryType, purposeId: purpose.id,
    name: !isToolName && capture.classification.name.trim() ? capture.classification.name : selection.label,
    notes: capture.classification.notes, assetStatus: "unknown", placement: purpose.placements[0],
    customLabel: purpose.custom ? selection.label : null,
    effect: purpose.id === "exclusion_area" ? { mode: "exclusion", noSpray: selection.noSpray,
      hardConflict: selection.hardConflict, bufferMeters: 0 } : { mode: "informational" } });
}
export function drawingSelectionReplaces(draft: DesignDraft, classification: DrawingClassification): boolean {
  switch (drawingPurpose(classification.purposeId)?.destination) {
    case "field_boundary": return draft.fieldBoundary.length > 0;
    case "pivot_center": return draft.pivotCenter !== null;
    case "water_source": return draft.waterSource !== null;
    case "power_source": return draft.powerSource !== null;
    default: return false;
  }
}
