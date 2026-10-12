import React from "react";
import { Platform, Pressable, Text, TextInput, View, StyleSheet } from "react-native";
import { assertProjectedCrs } from "../../../../packages/core/src/units";
import { qualifyProjectCrs } from "../../../../packages/core/src/crsQualification";
import { DraftDrawingCommandSchema, draftDrawingFinishError } from "../../../../packages/core/src/draftDrawingWorkflow";
import { DRAWING_PURPOSE_CATALOG, drawingClassificationDestination, drawingPurpose, parseDrawingClassification, type DrawingPlacement } from "../../../../packages/core/src/drawingClassification";
import { classificationForSelection, drawingSelectionReplaces, drawingSelections } from "../components/drawingClassificationSelection";
import { UTILITY_FEATURE_OPTIONS } from "../../../../packages/map-adapters/src/mapTools";
import type { FieldDrawingMetadataTarget } from "../../../../packages/core/src/fieldDesignDocument";
import type { ObstacleZone, ProjectMapFeatureKind, XY } from "../../../../packages/core/src/types";
import type { WorkspaceEditableAction, WorkspaceEditableDocument } from "./workspaceDocumentAdapters";
import { workspaceDocumentIdentityKey } from "./workspacePresentation";
import type { WorkspaceManualDrawingDisplay } from "../../../../packages/map-adapters/src/workspaceMapScene";
import type { DrawingLayerType } from "../../../../packages/geometry/src/mapInteraction";

export type WorkspaceDrawingGeometry = "Point" | "LineString" | "Polygon" | "Circle";
export interface WorkspaceDrawingInteraction {
  readonly ownerKey: string; readonly geometryType: WorkspaceDrawingGeometry | null;
  /** Project and Field pending map input use these vertices; Draft vertices live exclusively in its core workflow. */
  readonly vertices: readonly XY[]; readonly stage: "drawing" | "classification";
  readonly vertexRecordedAt: readonly string[];
  readonly selectionId: string; readonly name: string; readonly notes: string;
  readonly detailsOpen: boolean; readonly choicesOpen: boolean; readonly error: string | null;
  readonly replacing: boolean;
  readonly captureId: string | null;
  /** Pan parks this actual pending input without erasing its geometry. */
  readonly paused?: boolean;
}
export interface WorkspaceDrawingPanelProps {
  readonly editable: WorkspaceEditableDocument;
  readonly interaction: WorkspaceDrawingInteraction;
  readonly onInteractionChange: (interaction: WorkspaceDrawingInteraction) => void;
  readonly dispatch: (action: WorkspaceEditableAction) => boolean;
  readonly dispatchBatch: (actions: readonly WorkspaceEditableAction[]) => boolean;
  readonly createEntityId: () => string;
  readonly disabled?: boolean;
}
export function workspaceDrawingOwnerKey(editable: WorkspaceEditableDocument): string {
  return workspaceDocumentIdentityKey(editable.identity);
}
export function initialWorkspaceDrawingInteraction(editable: WorkspaceEditableDocument, resumeActive = true): WorkspaceDrawingInteraction {
  const workflow = editable.kind === "draft" ? editable.editor.draft.drawingWorkflow : undefined;
  const capture = resumeActive ? workflow?.captures.find(item => item.id === workflow.activeCaptureId) : undefined;
  const options = capture ? drawingSelections(capture.geometryType).filter(item => item.purposeId === capture.classification.purposeId) : [];
  return { ownerKey: workspaceDrawingOwnerKey(editable), geometryType: capture?.geometryType ?? null, vertices: [], vertexRecordedAt: [], stage: capture?.stage ?? "drawing",
    selectionId: capture && drawingSelections(capture.geometryType).some(item => item.id === capture.classification.purposeId) ? capture.classification.purposeId! : options.length === 1 ? options[0].id : "",
    name: capture && capture.classification.name !== capture.name ? capture.classification.name : "", notes: capture?.classification.notes ?? "",
    detailsOpen: false, choicesOpen: false, error: null, replacing: false, captureId: capture?.id ?? null };
}
export function prepareWorkspaceDrawingPoint(editable: WorkspaceEditableDocument, interaction: WorkspaceDrawingInteraction, point: XY, captureId: string, now: string): {
  actions: WorkspaceEditableAction[]; interaction: WorkspaceDrawingInteraction;
} {
  assertOwner(editable, interaction);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("Drawing needs a finite projected XY point.");
  const crs = editable.kind === "draft" ? editable.editor.draft.projectCrs : editable.kind === "field" ? editable.editor.field.projectCrs : editable.editor.project.projectCrs;
  if (!crs) throw new Error("Choose the coordinate system before drawing.");
  assertProjectedCrs(crs);
  if (editable.kind === "draft") {
    const workflow = editable.editor.draft.drawingWorkflow;
    const active = workflow?.captures.find(capture => capture.id === workflow.activeCaptureId);
    if (active?.stage === "classification") throw new Error("Keep this drawing or return to drawing before adding a point.");
    const geometryType = active?.geometryType ?? interaction.geometryType;
    if (!geometryType || geometryType === "Circle") throw new Error("Choose a supported draft drawing tool.");
    if (interaction.geometryType === null) throw new Error("Choose a drawing tool before adding a point.");
    const id = active?.id ?? captureId;
    const actions: WorkspaceEditableAction[] = active ? [] : [{ kind: "draft", action: { type: "drawing", expectedRevision: editable.editor.revision,
      command: { type: "begin", id, name: `${geometryType} drawing`, geometryType } } }];
    actions.push({ kind: "draft", action: { type: "drawing", expectedRevision: editable.editor.revision,
      command: { type: "append_vertex", id, vertex: { point: { ...point }, recordedAt: now, wgs84: null, elevation: null } } } });
    return { actions, interaction: { ...interaction, vertices: [], vertexRecordedAt: [], geometryType, captureId: id, error: null } };
  }
  if (!interaction.geometryType || interaction.stage !== "drawing") throw new Error("Choose a drawing tool or return to drawing before adding points.");
  if (editable.kind === "field" && interaction.geometryType === "Circle") throw new Error("Choose Point, Line or Polygon for this field drawing.");
  if (interaction.paused) throw new Error("Resume the paused drawing before adding points.");
  if (interaction.vertexRecordedAt.length !== interaction.vertices.length) throw new Error("Drawing times must align with their actual ordered map points.");
  DraftDrawingCommandSchema.parse({ type: "append_vertex", id: captureId, vertex: { point, recordedAt: now, wgs84: null, elevation: null } });
  if ((interaction.geometryType === "Point" && interaction.vertices.length >= 1) || (interaction.geometryType === "Circle" && interaction.vertices.length >= 2)) throw new Error("Finish this drawing before adding another point.");
  if (interaction.geometryType === "Circle" && qualifyProjectCrs(crs).unit !== "metre") throw new Error("Circle drawing requires confirmed metric projected XY units.");
  return { actions: [], interaction: { ...interaction, captureId: interaction.captureId ?? captureId, vertices: [...interaction.vertices, { ...point }], vertexRecordedAt: [...interaction.vertexRecordedAt, now], error: null } };
}
export function workspaceDrawingPreview(editable: WorkspaceEditableDocument, interaction: WorkspaceDrawingInteraction): WorkspaceManualDrawingDisplay | null {
  assertOwner(editable, interaction);
  if (editable.kind === "draft" || !interaction.geometryType || !interaction.captureId || !interaction.vertices.length) return null;
  const document = editable.kind === "field" ? editable.editor.field : editable.editor.project;
  const vertices = interaction.vertices.map(point => ({ ...point }));
  if (interaction.geometryType === "Circle") {
    if (vertices.length < 2) return { sourceDocumentId: document.id, inputRevision: editable.editor.revision, captureId: interaction.captureId,
      geometry: { type: "Pending", geometryType: "Point", vertices } };
    if (editable.kind === "field") throw new Error("Circle is not a supported field drawing.");
    if (qualifyProjectCrs(document.projectCrs).unit !== "metre") throw new Error("Circle preview requires confirmed metric XY units.");
    const radius = Math.hypot(vertices[1].x - vertices[0].x, vertices[1].y - vertices[0].y);
    if (!Number.isFinite(radius) || radius <= 0) return { sourceDocumentId: document.id, inputRevision: editable.editor.revision, captureId: interaction.captureId,
      geometry: { type: "Pending", geometryType: "LineString", vertices } };
    return { sourceDocumentId: document.id, inputRevision: editable.editor.revision, captureId: interaction.captureId,
      geometry: { type: "Circle", center: vertices[0], radiusMeters: radius } };
  }
  return { sourceDocumentId: document.id, inputRevision: editable.editor.revision, captureId: interaction.captureId,
    geometry: { type: "Pending", geometryType: interaction.geometryType, vertices } };
}
function assertOwner(editable: WorkspaceEditableDocument, interaction: WorkspaceDrawingInteraction): void {
  if (workspaceDrawingOwnerKey(editable) !== interaction.ownerKey) throw new Error("Drawing belongs to another document or coordinate frame.");
}
export function workspaceDrawingChoices(editable: WorkspaceEditableDocument, geometry: WorkspaceDrawingGeometry) {
  if (editable.kind === "draft") return geometry === "Circle" ? [] : drawingSelections(geometry).map(option => ({ id: option.id, label: option.label }));
  if (editable.kind === "field") return geometry === "Circle" ? [] : fieldSelections(editable, geometry).map(option => ({ id: option.id, label: option.label }));
  if (geometry !== "Circle") return [...projectSelections(geometry).map(option => ({ id: option.id, label: option.label })),
    ...(geometry === "Polygon" ? ["road", "ditch", "fence", "building", "canal", "tree"].map(kind => ({ id: `obstacle:${kind}`, label: `${kind[0].toUpperCase()}${kind.slice(1)} legacy obstacle and no-spray area` })) : [])];
  const choices = UTILITY_FEATURE_OPTIONS.filter(option => option.geometry === geometry).map(option => ({ id: `feature:${option.kind}`, label: option.label }));
  return choices;
}
function projectSelections(geometry: "Point" | "LineString" | "Polygon") {
  return drawingSelections(geometry).flatMap(option => [{ ...option, selectionId: option.id, placement: drawingPurpose(option.purposeId)!.placements[0] },
    ...drawingPurpose(option.purposeId)!.placements.slice(1).map(placement => ({ ...option, id: `${option.id}:${placement}`, selectionId: option.id,
      placement, label: `${option.label} (${placement})` }))]);
}
function fieldSelections(editable: Extract<WorkspaceEditableDocument, { kind: "field" }>, geometry: "Point" | "LineString" | "Polygon") {
  return projectSelections(geometry).flatMap(option => {
    const destination = drawingPurpose(option.purposeId)!.destination;
    const choices: Array<typeof option & { target?: FieldDrawingMetadataTarget }> = [];
    if (destination === "pivot_center") for (const [index, machine] of editable.editor.field.machines.entries()) choices.push({ ...option,
      id: JSON.stringify([option.id, machine.id]), label: `${option.label} · ${machine.configuration.name}${editable.editor.field.machines.filter(item => item.configuration.name === machine.configuration.name).length > 1 ? ` (${index + 1})` : ""}`,
      target: { kind: "pivot_center", machineId: machine.id } });
    else if (destination === "water_source" || destination === "power_source") for (const [index, infrastructure] of editable.editor.field.infrastructure.filter(item => item.kind === destination).entries()) choices.push({ ...option,
      id: JSON.stringify([option.id, infrastructure.id]), label: `${destination === "water_source" ? "Water source" : "Power source"} ${index + 1}`,
      target: { kind: destination, infrastructureId: infrastructure.id } });
    else choices.push({ ...option, ...(destination === "field_boundary" ? { target: { kind: "field_boundary" as const } } : {}) });
    return choices;
  });
}
export function workspaceFieldDrawingAction(editable: Extract<WorkspaceEditableDocument, { kind: "field" }>, interaction: WorkspaceDrawingInteraction, id: string): WorkspaceEditableAction {
  assertOwner(editable, interaction);
  const geometry = interaction.geometryType;
  if (!geometry || geometry === "Circle" || interaction.stage !== "classification") throw new Error("Finish the actual field drawing before keeping it.");
  const selection = fieldSelections(editable, geometry).find(option => option.id === interaction.selectionId);
  if (!selection) throw new Error("Choose a purpose and its actual field location for this drawing.");
  if (!interaction.captureId || interaction.vertexRecordedAt.length !== interaction.vertices.length) throw new Error("Field drawing needs its actual capture identity and ordered click times.");
  const vertices = interaction.vertices.map((point, index) => ({ point: { ...point }, recordedAt: interaction.vertexRecordedAt[index], wgs84: null, elevation: null }));
  const classification = parseDrawingClassification({ ...classificationForSelection({ id: interaction.captureId, name: `${geometry} drawing`, projectCrs: editable.editor.field.projectCrs,
    geometryType: geometry, stage: "classification", source: "map_digitized", vertices,
    classification: { purposeId: null, name: interaction.name, notes: interaction.notes } }, selection.selectionId), placement: selection.placement as DrawingPlacement });
  const destination = drawingClassificationDestination(classification);
  const target: FieldDrawingMetadataTarget = selection.target ?? (destination === "obstacle" ? { kind: "obstacle", id } : { kind: "map_feature", id });
  return { kind: "field", action: { type: "commit_manual_geometry", fieldId: editable.editor.field.id, projectCrs: editable.editor.field.projectCrs,
    expectedRevision: editable.editor.revision, captureId: interaction.captureId, geometryType: geometry, vertices, classification, target,
    ...(interaction.replacing ? { replaceExisting: true } : {}) } };
}
/** Bridge retained Project helper tool requests to visible, supported purpose selections. */
export function workspaceDrawingSelectionForLegacyTool(editable: WorkspaceEditableDocument, geometry: WorkspaceDrawingGeometry, layer: DrawingLayerType, featureKind?: ProjectMapFeatureKind): string {
  if (geometry === "Circle") return featureKind && UTILITY_FEATURE_OPTIONS.some(option => option.kind === featureKind && option.geometry === geometry) ? `feature:${featureKind}` : "";
  if (featureKind) {
    const specified = featureKind === "underground_pipeline" ? "pipeline:underground" : featureKind === "underground_wire" ? "electrical_route:underground" : featureKind === "power_line" ? "electrical_route:overhead" : null;
    if (specified) return drawingPurpose(specified.split(":")[0])?.geometry !== geometry ? "" : editable.kind !== "draft" ? specified : specified.split(":")[0];
    return DRAWING_PURPOSE_CATALOG.find(purpose => purpose.geometry === geometry && purpose.legacyKind === featureKind)?.id ?? "";
  }
  if (geometry === "Point") return layer === "water_source" ? "project_water_source" : layer === "power_source" ? "project_power_source" : layer === "pivot_center" ? "pivot_center" : "";
  if (geometry === "Polygon") return layer === "field_boundary" ? "field_boundary" : layer === "exclusion" || layer === "obstacle" ? "exclusion_both"
    : editable.kind === "project" && ["road", "ditch", "fence", "building", "canal", "tree"].includes(layer) ? `obstacle:${layer}` : "";
  return "";
}
export function workspaceProjectDrawingAction(editable: Extract<WorkspaceEditableDocument, { kind: "project" }>, interaction: WorkspaceDrawingInteraction, id: string): WorkspaceEditableAction {
  assertOwner(editable, interaction);
  const geometry = interaction.geometryType;
  if (!geometry || interaction.stage !== "classification") throw new Error("Finish the actual Project drawing before keeping it.");
  const option = workspaceDrawingChoices(editable, geometry).find(choice => choice.id === interaction.selectionId);
  if (!option) throw new Error("Choose a purpose for this drawing.");
  if (geometry !== "Circle" && !interaction.selectionId.startsWith("obstacle:")) {
    if (!interaction.captureId || interaction.vertexRecordedAt.length !== interaction.vertices.length) throw new Error("Project drawing needs its actual capture identity and ordered click times.");
    const vertices = interaction.vertices.map((point, index) => ({ point: { ...point }, recordedAt: interaction.vertexRecordedAt[index], wgs84: null, elevation: null }));
    const selection = projectSelections(geometry).find(option => option.id === interaction.selectionId)!;
    const classification = parseDrawingClassification({ ...classificationForSelection({ id: interaction.captureId, name: `${geometry} drawing`, projectCrs: editable.editor.project.projectCrs,
      geometryType: geometry, stage: "classification", source: "map_digitized", vertices,
      classification: { purposeId: null, name: interaction.name, notes: interaction.notes } }, selection.selectionId), placement: selection.placement as DrawingPlacement });
    const destination = drawingClassificationDestination(classification);
    return { kind: "project", action: { type: "commit_classified_drawing", projectId: editable.editor.project.id, projectCrs: editable.editor.project.projectCrs,
      expectedRevision: editable.editor.revision, captureId: interaction.captureId, geometryType: geometry, vertices, classification,
      ...(destination === "feature" || destination === "obstacle" ? { entityId: id } : {}), ...(interaction.replacing ? { replaceExisting: true } : {}) } };
  }
  const feature = interaction.selectionId.startsWith("feature:"), obstacle = interaction.selectionId.startsWith("obstacle:");
  if (!feature && interaction.notes) throw new Error("This Project target cannot store drawing notes yet. Your pending text is retained.");
  if (!feature && !obstacle && interaction.name) throw new Error("This Project target cannot store a separate drawing name yet. Your pending text is retained.");
  const vertices = interaction.vertices.map(point => ({ ...point }));
  const issue = geometry === "Circle" ? vertices.length !== 2 ? "Circle needs a center and radius point." : null
    : draftDrawingFinishError(geometry, vertices);
  if (issue) throw new Error(issue);
  if (interaction.selectionId.startsWith("obstacle:")) return { kind: "project", action: { type: "commit_obstacle_draft", vertices,
    id, kind: interaction.selectionId.slice(9) as ObstacleZone["kind"], name: interaction.name.trim() ? interaction.name : option.label } };
  const featureGeometry = geometry === "Point" ? { type: "Point" as const, point: vertices[0] }
    : geometry === "Circle" ? { type: "Circle" as const, center: vertices[0], radiusMeters: Math.hypot(vertices[1].x - vertices[0].x, vertices[1].y - vertices[0].y) }
      : { type: geometry, vertices };
  if (geometry === "Circle" && qualifyProjectCrs(editable.editor.project.projectCrs).unit !== "metre") throw new Error("Circle radius needs confirmed metric XY units.");
  return { kind: "project", action: { type: "add_map_feature", feature: { id, name: interaction.name.trim() ? interaction.name : option.label,
    kind: interaction.selectionId.slice(8) as ProjectMapFeatureKind, geometry: featureGeometry, confidence: "user_estimated", notes: interaction.notes } } };
}

export function WorkspaceDrawingPanel({ editable, interaction, onInteractionChange, dispatch, dispatchBatch, createEntityId, disabled = false }: WorkspaceDrawingPanelProps): React.JSX.Element {
  const draft = editable.kind === "draft" ? editable.editor.draft : null;
  const workflow = draft?.drawingWorkflow, active = workflow?.captures.find(capture => capture.id === workflow.activeCaptureId);
  const geometry = active?.geometryType ?? interaction.geometryType;
  const stage = active?.stage ?? interaction.stage;
  const vertices = active?.vertices.map(vertex => vertex.point) ?? interaction.vertices;
  const ownerMatches = interaction.ownerKey === workspaceDrawingOwnerKey(editable);
  const blocked = disabled || !ownerMatches;
  const update = (values: Partial<WorkspaceDrawingInteraction>) => { if (!blocked) onInteractionChange({ ...interaction, ...values }); };
  const drawing = (command: Extract<WorkspaceEditableAction, { kind: "draft" }>["action"]) => dispatch({ kind: "draft", action: command });
  const button = (label: string, id: string, run: () => void, unavailable = false) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={label}
    disabled={blocked || unavailable} accessibilityState={{ disabled: blocked || unavailable }} testID={id} style={[styles.button, (blocked || unavailable) && styles.buttonDisabled]} onPress={() => { if (!blocked && !unavailable) run(); }}><Text style={styles.label}>{label}</Text></Pressable>;
  const arm = (next: WorkspaceDrawingGeometry | null) => {
    if (editable.kind !== "draft" && interaction.vertices.length) {
      if (next === null) { update({ paused: true }); return; }
      if (next === interaction.geometryType && stage === "drawing") { update({ paused: false, error: null }); return; }
      update({ error: "Finish or discard the current drawing before choosing another shape." }); return;
    }
    if (active && !dispatchBatch([
      ...(active.stage === "classification" ? [{ kind: "draft" as const, action: { type: "drawing" as const, expectedRevision: editable.editor.revision, command: { type: "set_classification" as const, id: active.id,
        classification: { purposeId: interaction.selectionId || active.classification.purposeId, name: interaction.name || active.name, notes: interaction.notes } } } }] : []),
      { kind: "draft", action: { type: "drawing", expectedRevision: editable.editor.revision, command: { type: "pause", id: active.id } } },
    ])) return;
    onInteractionChange({ ...initialWorkspaceDrawingInteraction(editable, false), geometryType: next });
  };
  const finish = () => {
    if (!geometry) return;
    if (active) { if (drawing({ type: "drawing", expectedRevision: editable.editor.revision, command: { type: "finish", id: active.id } })) update({ stage: "classification", geometryType: active.geometryType }); return; }
    const issue = geometry === "Circle" ? vertices.length !== 2 ? "Circle needs a center and radius point." : Math.hypot(vertices[1].x - vertices[0].x, vertices[1].y - vertices[0].y) === 0 ? "Circle radius must be positive." : null : draftDrawingFinishError(geometry, [...vertices]);
    update(issue ? { error: issue } : { stage: "classification", error: null });
  };
  const keep = () => {
    try {
      if (editable.kind === "draft") {
        if (!active || active.stage !== "classification") throw new Error("Finish this draft drawing first.");
        const classification = classificationForSelection({ ...active, classification: { ...active.classification, name: interaction.name, notes: interaction.notes } }, interaction.selectionId);
        if (drawingSelectionReplaces(editable.editor.draft, classification) && !interaction.replacing) { update({ replacing: true }); return; }
        const accepted = drawing({ type: "commit_classified_drawing", expectedRevision: editable.editor.revision, captureId: active.id, classification,
          ...(drawingPurpose(classification.purposeId)?.destination === "feature" ? { entityId: createEntityId() } : {}), replaceExisting: interaction.replacing });
        if (accepted) onInteractionChange(initialWorkspaceDrawingInteraction(editable, false));
      } else {
        const purpose = geometry !== "Circle" ? projectSelections(geometry!).find(option => option.id === interaction.selectionId) : undefined;
        const fieldTarget = editable.kind === "field" && geometry !== "Circle" ? fieldSelections(editable, geometry!).find(option => option.id === interaction.selectionId)?.target : undefined;
        const replacing = editable.kind === "field" ? !!fieldTarget : purpose ? drawingPurpose(purpose.purposeId)?.destination !== "feature" : false;
        if (replacing && !interaction.replacing) { update({ replacing: true }); return; }
        if (dispatch(editable.kind === "field" ? workspaceFieldDrawingAction(editable, interaction, createEntityId()) : workspaceProjectDrawingAction(editable, interaction, createEntityId()))) onInteractionChange(initialWorkspaceDrawingInteraction(editable, false));
      }
    } catch (error) { update({ error: error instanceof Error ? error.message : String(error) }); }
  };
  const choices = geometry ? workspaceDrawingChoices(editable, geometry) : [];
  return <View style={styles.root} testID="workspace-drawing-panel"><Text style={styles.heading}>Draw on the common map</Text>
    <View style={styles.row}>{button("Pan", "drawing-pan", () => arm(null))}
      {(["Point", "LineString", "Polygon", ...(editable.kind === "project" ? ["Circle"] : [])] as WorkspaceDrawingGeometry[]).map(type => button(type === "LineString" ? "Line" : type, `drawing-tool-${type}`, () => arm(type)))}</View>
    <Text style={styles.meta}>{geometry === "LineString" ? "Line" : geometry ?? "Pan"} · {vertices.length} points · {stage === "classification" ? "Choose its purpose" : interaction.paused ? "Paused for map navigation" : "Map taps add drawing points"}</Text>
    {active && stage === "drawing" && <View style={styles.row}>
      {button("Pause drawing", "drawing-pause", () => arm(null))}
      {button("Remove last vertex", "drawing-remove-last", () => { drawing({ type: "drawing", expectedRevision: editable.editor.revision, command: { type: "remove_last_vertex", id: active.id } }); }, !vertices.length)}
    </View>}
    {!active && editable.kind !== "draft" && stage === "drawing" && <View style={styles.row}>
      {interaction.paused && button("Resume drawing", "drawing-project-resume", () => update({ paused: false }))}
      {button("Remove last vertex", "drawing-remove-last", () => update({ vertices: interaction.vertices.slice(0, -1), vertexRecordedAt: interaction.vertexRecordedAt.slice(0, -1) }), !vertices.length)}
    </View>}
    {stage === "drawing" && geometry && button("Finish drawing", "drawing-finish", finish)}
    {workflow?.captures.filter(capture => capture.id !== active?.id).map(capture => button(`Resume ${capture.name}`, `drawing-resume-${capture.id}`, () => {
      if (drawing({ type: "drawing", expectedRevision: editable.editor.revision, command: { type: "resume", id: capture.id } })) {
        const storedChoice = drawingSelections(capture.geometryType).find(choice => choice.id === capture.classification.purposeId);
        update({ geometryType: capture.geometryType, stage: capture.stage, captureId: capture.id,
          selectionId: storedChoice?.id ?? "", name: capture.classification.name === capture.name ? "" : capture.classification.name, notes: capture.classification.notes });
      }
    }, !!active))}
    {stage === "classification" && <View testID="drawing-classification-inline"><Text style={styles.label}>What did you draw?</Text>
      {Platform.OS === "web" ? React.createElement("select", { value: interaction.selectionId, "aria-label": "Drawing purpose", "data-testid": "drawing-purpose-select", onChange: (event: React.ChangeEvent<HTMLSelectElement>) => update({ selectionId: event.target.value, replacing: false, error: null }), disabled: blocked },
        React.createElement("option", { value: "" }, "Choose a purpose…"), ...choices.map(choice => React.createElement("option", { key: choice.id, value: choice.id }, choice.label)))
        : <View>{button(choices.find(choice => choice.id === interaction.selectionId)?.label ?? "Choose a purpose…", "drawing-purpose-select", () => update({ choicesOpen: !interaction.choicesOpen }))}
          {interaction.choicesOpen && choices.map(choice => button(choice.label, `drawing-purpose-${choice.id}`, () => update({ selectionId: choice.id, choicesOpen: false, replacing: false, error: null })))}</View>}
      <View style={styles.row}>{button("Optional name and notes", "drawing-details-toggle", () => update({ detailsOpen: !interaction.detailsOpen }))}
        {button("Back to drawing", "drawing-classification-cancel", () => {
          if (active && !dispatchBatch([
            { kind: "draft", action: { type: "drawing", expectedRevision: editable.editor.revision, command: { type: "set_classification", id: active.id,
              classification: { purposeId: interaction.selectionId || active.classification.purposeId, name: interaction.name || active.name, notes: interaction.notes } } } },
            { kind: "draft", action: { type: "drawing", expectedRevision: editable.editor.revision, command: { type: "return_to_drawing", id: active.id } } },
          ])) return;
          update({ stage: "drawing", replacing: false, paused: false });
        })}{button(interaction.replacing ? "Replace saved geometry" : "Keep drawing", "drawing-classification-keep", keep, !interaction.selectionId)}</View>
      {interaction.replacing && <Text style={styles.meta}>This replaces the existing saved location or boundary. Review it before confirming.</Text>}
      <View style={!interaction.detailsOpen && { display: "none" }}>
        <TextInput value={interaction.name} accessibilityLabel="Drawing name" testID="drawing-name" style={styles.input} onChangeText={name => update({ name })} editable={!blocked} />
        <TextInput value={interaction.notes} accessibilityLabel="Drawing notes" testID="drawing-notes" style={styles.input} multiline onChangeText={notes => update({ notes })} editable={!blocked} />
      </View>
    </View>}
    {button("Discard drawing", "drawing-discard", () => {
      if (active && !drawing({ type: "drawing", expectedRevision: editable.editor.revision, command: { type: "discard", id: active.id } })) return;
      onInteractionChange(initialWorkspaceDrawingInteraction(editable, false));
    }, !active && !vertices.length && !geometry)}
    {(interaction.error || editable.editor.lastError) && <Text accessibilityRole="alert" style={styles.error}>{interaction.error ?? editable.editor.lastError}</Text>}
  </View>;
}
const styles = StyleSheet.create({ root: { gap: 8, padding: 10, backgroundColor: "#eef5ea", borderRadius: 7 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  heading: { fontSize: 16, fontWeight: "700", color: "#284c35" }, label: { color: "#284c35", fontWeight: "600" }, meta: { fontSize: 12, color: "#526557" },
  button: { padding: 9, borderWidth: 1, borderColor: "#b5c8b0", borderRadius: 5 }, buttonDisabled: { opacity: 0.45 }, input: { borderWidth: 1, borderColor: "#aec2aa", backgroundColor: "white", padding: 8, marginTop: 6 }, error: { color: "#903d2b" } });
