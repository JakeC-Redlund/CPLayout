import React, { useEffect, useMemo, useRef, useSyncExternalStore, type ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AppSettings } from "../../../../packages/core/src/settings";
import type { ProjectEditorAction, ProjectEditorState } from "../../../../packages/core/src/projectReducer";
import type { LayoutResult, ProjectMapFeatureKind } from "../../../../packages/core/src/types";
import type { DrawingLayerType, DrawingMode } from "@cplayout/geometry";
import { InputRetentionAdmissionProvider, useInputRetentionStore, useRetainedInput } from "../inputRetention";
import { EMPTY_ADVISORY_COST_DRAFT, advisoryCostInputFromDraft } from "../advisory/costInputs";
import { initialCornerArmInputs } from "../advisory/cornerArmInputs";
import { PivotGpsCoordinateForm, PivotCoordinateForm, ProjectedPolygonEditor, MachineSettingsForm, EndGunSettingsForm,
  CornerArmSheet, ManualDesignTransactionPanel, CalculateSheet, AdvisoryCostReviewPanel, FieldPivotPreviewControls, MapFeatureEditor } from "./ProjectWorkspaceTools";

type CalculationProps = ComponentProps<typeof CalculateSheet>;
export type ProjectDesignSurface = "inputs" | "review";
export interface ProjectDesignPanelPresentation {
  readonly sourceGeneration: number;
  readonly activeSurface: ProjectDesignSurface | null;
  readonly renderSurface: (surface: ProjectDesignSurface, content: React.ReactNode) => React.ReactNode;
}
export interface ProjectDesignPanelProps {
  readonly editor: ProjectEditorState;
  readonly settings: AppSettings;
  readonly onAction: (action: Exclude<ProjectEditorAction, { type: "load_project" }>) => boolean;
  readonly onCalculate: () => void;
  readonly result: LayoutResult | null;
  readonly onSettingsChange: (settings: AppSettings) => void;
  readonly onActivateTool: (mode: DrawingMode, layer: DrawingLayerType, featureKind?: ProjectMapFeatureKind) => void;
  readonly onOpenSurvey: () => void;
  readonly onRequestMapCapture: ComponentProps<typeof ManualDesignTransactionPanel>["onRequestMapCapture"];
  readonly mapCapture: ComponentProps<typeof ManualDesignTransactionPanel>["mapCapture"];
  readonly onRequestApplyPivotCandidate: CalculationProps["onRequestApplyPivotCandidate"];
  readonly onSaveGeneratedFieldPivotZones: CalculationProps["onSaveGeneratedFieldPivotZones"];
  readonly advisory?: Partial<Pick<CalculationProps, "advisoryMachineRenderModel" | "fieldPivotPlan" | "multiMachineReview" | "idealCenterAnalysis" | "placementCandidates" | "preview">>;
  readonly cornerEvaluation: ComponentProps<typeof CornerArmSheet>["evaluation"];
  readonly onAdvisoryInputsChange?: (inputs: { costInput: CalculationProps["advisoryCostInput"]; requestedFieldPivots: number }) => void;
  readonly disabled?: boolean;
  readonly presentation?: ProjectDesignPanelPresentation;
}
/** Actual Project tools only. The common controller retains all document, history, receiver and save ownership. */
export function ProjectDesignPanel(props: ProjectDesignPanelProps): React.JSX.Element {
  const project = props.editor.project, store = useInputRetentionStore(), scope = `project-tools/${encodeURIComponent(project.id)}`;
  const [page, setPage] = useRetainedInput(`${scope}/page`, "machine");
  const [cost, setCost] = useRetainedInput(`${scope}/cost`, EMPTY_ADVISORY_COST_DRAFT);
  const [corner, setCorner] = useRetainedInput(`${scope}/corner`, initialCornerArmInputs(project));
  const [count, setCount] = useRetainedInput(`${scope}/pivotCount`, 1);
  const [featureId, setFeatureId] = useRetainedInput<string | null>(`${scope}/feature`, null);
  const storeGeneration = useSyncExternalStore(store.subscribeReset, store.getGeneration, store.getGeneration);
  const paneKey = JSON.stringify([project.id, props.presentation?.sourceGeneration, props.presentation?.activeSurface, page, !!props.disabled, storeGeneration]);
  const paneOwner = useRef({ key: paneKey, epoch: 0 });
  if (paneOwner.current.key !== paneKey) paneOwner.current = { key: paneKey, epoch: paneOwner.current.epoch + 1 };
  const renderEpoch = paneOwner.current.epoch;
  const latestEditor = useRef(props.editor); latestEditor.current = props.editor;
  const ownsPane = () => paneOwner.current.epoch === renderEpoch && storeGeneration === store.getGeneration() && latestEditor.current === props.editor && !props.disabled;
  const reviewIsCurrent = () => ownsPane() && (!props.presentation || props.presentation.activeSurface === "review");
  const costInput = useMemo(() => advisoryCostInputFromDraft(cost, project.machine), [cost, project.machine]);
  useEffect(() => { if (ownsPane()) props.onAdvisoryInputsChange?.({ costInput, requestedFieldPivots: count }); }, [props.onAdvisoryInputsChange, costInput, count, renderEpoch]);
  const calculate = () => {
    if (!reviewIsCurrent()) return;
    for (const key of ["cost", "corner", "pivotCount"]) store.markClean(`${scope}/${key}`);
    props.onCalculate();
  };
  const act: ProjectDesignPanelProps["onAction"] = action => ownsPane() && (!props.presentation || props.presentation.activeSurface === "inputs") && props.onAction(action);
  const updateMachine = (machine: typeof project.machine) => act({ type: "update_machine", machine });
  const visiblePage = props.presentation && page === "calculate" ? "machine" : page;
  const feature = project.mapFeatures?.find(item => item.id === featureId) ?? null;
  const tab = (id: string, label: string) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: visiblePage === id }} testID={`project-design-tab-${id}`}
    style={[styles.button, visiblePage === id && styles.active]} onPress={() => { if (!ownsPane() || props.presentation && props.presentation.activeSurface !== "inputs") return; setPage(id); store.markClean(`${scope}/page`); }}><Text style={styles.label}>{label}</Text></Pressable>;
  const section = (id: string, children: React.ReactNode) => <View key={id} style={{ display: visiblePage === id ? "flex" : "none", gap: 8 }} testID={`project-design-${id}`}>
    <InputRetentionAdmissionProvider isCurrent={() => ownsPane() && visiblePage === id && (!props.presentation || props.presentation.activeSurface === "inputs")}>{children}</InputRetentionAdmissionProvider>
  </View>;
  const inputs = <><View style={styles.row}>
    {tab("coordinates", "Locations & boundary")}{tab("machine", "Machine")}{tab("endGun", "End gun")}{tab("cornerArm", "Corner arm")}{tab("manual", "Manual inputs")}{tab("features", "Map features")}{!props.presentation && tab("calculate", "Calculations")}
  </View>
    {props.editor.lastError && <Text accessibilityRole="alert" style={styles.error}>{props.editor.lastError}</Text>}
    {section("coordinates", <>
      <PivotGpsCoordinateForm project={project} onApply={(point, wgs84) => act({ type: "place_pivot", point, ...(wgs84 ? { wgs84 } : {}) })} />
      <Text style={styles.label}>Water source</Text><PivotCoordinateForm point={project.waterSource} retentionKey={`${scope}/water`} onApply={point => act({ type: "move_infrastructure", pointType: "water_source", point })} />
      <Text style={styles.label}>Power source</Text><PivotCoordinateForm point={project.powerSource} retentionKey={`${scope}/power`} onApply={point => act({ type: "move_infrastructure", pointType: "power_source", point })} />
      <ProjectedPolygonEditor label="Field boundary" retentionKey={`${scope}/boundary`} vertices={project.fieldBoundary} onApply={vertices => act({ type: "commit_boundary_draft", vertices })} />
      {project.obstacles.map(obstacle => <ProjectedPolygonEditor key={obstacle.id} label={obstacle.name} retentionKey={`${scope}/obstacle/${encodeURIComponent(obstacle.id)}`} vertices={obstacle.polygon} onApply={vertices => act({ type: "replace_obstacle_polygon", obstacleId: obstacle.id, vertices })} />)}
    </>)}
    {section("machine", <MachineSettingsForm machine={project.machine} unitSystem={props.settings.unitSystem} onChange={updateMachine} />)}
    {section("endGun", <EndGunSettingsForm machine={project.machine} unitSystem={props.settings.unitSystem} result={props.result} onChange={updateMachine} />)}
    {section("cornerArm", <CornerArmSheet machine={project.machine} unitSystem={props.settings.unitSystem} result={props.result} evaluation={props.cornerEvaluation}
      footprintCount={(project.mapFeatures ?? []).filter(item => item.kind === "corner_swing_limit").length} onActivateTool={(...args) => { if (ownsPane()) props.onActivateTool(...args); }}
      onRequestSave={config => { updateMachine({ ...project.machine, cornerArm: config }); }} />)}
    {section("manual", <ManualDesignTransactionPanel project={project} projectRevision={props.editor.revision} unitSystem={props.settings.unitSystem} mapCapture={props.mapCapture}
      onRequestMapCapture={role => { if (ownsPane()) props.onRequestMapCapture(role); }} onOpenRtk={() => { if (ownsPane()) props.onOpenSurvey(); }} onApply={draft => act({ type: "apply_manual_design", draft })} />)}
    {section("features", <>
      <View style={styles.row}>{project.mapFeatures?.map(item => <Pressable key={item.id} style={styles.button} accessibilityRole="button" testID={`project-feature-${item.id}`}
        onPress={() => { if (!ownsPane()) return; setFeatureId(item.id); store.markClean(`${scope}/feature`); }}><Text style={styles.label}>{item.name}</Text></Pressable>)}</View>
      <MapFeatureEditor feature={feature} unitSystem={props.settings.unitSystem} onDelete={id => { act({ type: "delete_map_feature", id }); }}
        onRename={(item, name) => { act({ type: "update_map_feature", feature: { ...item, name } }); }} onUpdate={item => { act({ type: "update_map_feature", feature: item }); }} />
    </>)}
  </>;
  const review = <>
      <FieldPivotPreviewControls count={count} onChange={value => { if (reviewIsCurrent()) setCount(value); }} settings={props.settings} plan={props.advisory?.fieldPivotPlan ?? null} model={props.advisory?.advisoryMachineRenderModel ?? null} failed={false} />
      <AdvisoryCostReviewPanel draft={cost} machine={project.machine} onChange={value => { if (reviewIsCurrent()) setCost(value); }} />
      <Pressable accessibilityRole="button" disabled={props.disabled} testID="project-calculate" style={styles.button} onPress={calculate}><Text style={styles.label}>Calculate preview</Text></Pressable>
      {props.result ? <CalculateSheet project={project} result={props.result} settings={props.settings} editorError={props.editor.lastError}
        cornerInputDraft={corner} onCornerInputDraftChange={value => { if (reviewIsCurrent()) setCorner(value); }} advisoryCostDraft={cost} onUpdateAdvisoryCostDraft={value => { if (reviewIsCurrent()) setCost(value); }} advisoryCostInput={costInput}
        advisoryMachineRenderModel={props.advisory?.advisoryMachineRenderModel ?? null} fieldPivotPlan={props.advisory?.fieldPivotPlan ?? null}
        multiMachineReview={props.advisory?.multiMachineReview ?? null} idealCenterAnalysis={props.advisory?.idealCenterAnalysis ?? null}
        placementCandidates={props.advisory?.placementCandidates ?? null} preview={props.advisory?.preview ?? null} onCalculate={calculate}
        onRequestApplyPivotCandidate={candidate => { if (reviewIsCurrent()) props.onRequestApplyPivotCandidate(candidate); }} onSaveGeneratedFieldPivotZones={plan => { if (reviewIsCurrent()) props.onSaveGeneratedFieldPivotZones(plan); }} onSettingsChange={settings => { if (reviewIsCurrent()) props.onSettingsChange(settings); }} />
        : <Text style={styles.meta}>No current calculation preview. Applied inputs and all configuration controls remain available.</Text>}
  </>;
  return <View style={[props.presentation ? styles.surfaces : styles.root, props.presentation?.activeSurface === null && { display: "none" }]} testID="project-design-panel">
    {props.presentation ? props.presentation.renderSurface("inputs", inputs) : inputs}
    {props.presentation ? props.presentation.renderSurface("review", review) : section("calculate", review)}
  </View>;
}
const styles = StyleSheet.create({ surfaces: { flex: 1, minHeight: 0 }, root: { gap: 10 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 5 }, button: { minHeight: 48, justifyContent: "center", padding: 9, borderWidth: 1, borderColor: "#b6c8b1", borderRadius: 5 },
  active: { backgroundColor: "#e6f0df" }, label: { color: "#284d36", fontWeight: "600" }, meta: { color: "#536756", fontSize: 12 }, error: { color: "#923d2b" } });
