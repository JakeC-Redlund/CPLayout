import { StatusBar } from "expo-status-bar";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CheckCircle2,
  Calculator,
  Circle,
  CircleDot,
  ClipboardList,
  Database,
  Download,
  FolderOpen,
  Home,
  Layers,
  ListChecks,
  Map as MapIcon,
  MapPin,
  MapPinned,
  Minus,
  Monitor,
  MoreHorizontal,
  PackageCheck,
  Pentagon,
  Plus,
  Route,
  RotateCcw,
  Ruler,
  Save,
  Satellite,
  SlidersHorizontal,
  Sprout,
  Upload,
  UserRound,
  UtilityPole,
  Waypoints,
  WifiOff,
  Wrench,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { CoordinateFormatPanel } from "./src/components/CoordinateFormatPanel";
import { FieldPivotPreviewControls } from "./src/components/FieldPivotPreviewControls";
import { ReportField, ReportNotice, ReportValue, reportStyles } from "./src/components/CalculationReport";
import { advisoryCostDraftMessage, advisoryCostDraftReadyForRadiusSensitivity, advisoryCostDraftStatus,
  advisoryCostInputFromDraft, advisoryCostPriceNeedsReview, EMPTY_ADVISORY_COST_DRAFT, updateMachinePrice, type AdvisoryCostDraft } from "./src/advisory/costInputs";
import { CornerArmCalculationInputs } from "./src/components/CornerArmCalculationInputs";
import { cornerArmInputScope, cornerArmInputsForPreview, initialCornerArmInputs, type CornerArmInputDraft } from "./src/advisory/cornerArmInputs";
import { useAdvisoryJob } from "./src/advisory/useAdvisoryJob";
import { advisoryDemand } from "./src/advisory/advisoryDemand";
import { AndroidNativeProofRunner } from "./src/components/AndroidNativeProofRunner";
import { BrowserRtkReceiverPanel, type BrowserRtkReceiverStatus } from "./src/components/BrowserRtkReceiverPanel";
import { CommandBar, IconCommandButton, type CommandIconButtonConfig, type CommandMenuConfig, type CommandMenuItemConfig } from "./src/components/CommandSurface";
import {
  MapSurface,
  defaultMapFeatureName,
  draftVerticesToFeatureGeometry,
  draftMeasurementText,
  featureOptionsForGeometry,
  type PendingMapFeatureDraft,
  type MapDraftOwner,
  type MapDraftHandoffResult,
  type MapDraftPurposeReceipt,
  type ManualDesignMapCapture,
  type ManualDesignMapCaptureRole,
  type UtilityFeatureGeometry,
  type UtilityFeatureOption,
} from "@cplayout/map-adapters";
import { MetricTile } from "./src/components/MetricTile";
import {
  CatalogItemForm,
  ConfirmActionDialog,
  ConfirmActionPanel,
  ClientProfileDialog,
  ClientProfileForm,
  MoveProjectForm,
  MoveProjectDialog,
  ProjectCatalogDialog,
  type ClientProfileDialogValue,
  type ProjectCatalogDialogMode,
} from "./src/components/ProjectCatalogDialog";
import { ProjectFilesPanel } from "./src/components/ProjectFilesPanel";
import { ProjectCopyButton } from "./src/components/ProjectCopyButton";
import { ProjectCrsRecoveryPanel } from "./src/components/ProjectCrsRecoveryPanel";
import { WorkspaceStorageNotice } from "./src/components/WorkspaceStorageNotice";
import { createProjectOpenRequestGuard } from "./src/projectOpenRequest";
import { dispatchProjectEditorAction } from "./src/projectEditorDispatch";
import { InputRetentionProvider, useInputRetention, useRetainedInput } from "./src/inputRetention";
import { type EditorSavePayload, type EditorSaveSession, type RetainedProjectReceipt, type EditorSaveTarget } from "./src/editorSaveCoordinator";
import { useEditorSaveCoordinator } from "./src/hooks/useEditorSaveCoordinator";
import { DesignDraftWorkspace } from "./src/components/DesignDraftWorkspace";
import { FieldDesignWorkspace } from "./src/components/FieldDesignWorkspace";
import { CatalogArchiveImport } from "./src/components/CatalogArchiveImport";
import { LayoutSessionCatalog } from "./src/components/LayoutSessionCatalog";
import { SavedDesignPreview } from "./src/components/SavedDesignPreview";
import { assertCatalogFormContextUnchanged } from "./src/catalogFormRecovery";
import { ReceiverConnectionPanel } from "./src/components/ReceiverConnectionPanel";
import { PrimaryTaskNavigation, type PrimaryTask } from "./src/components/PrimaryTaskNavigation";
import { LayoutSessionWorkspace } from "./src/components/LayoutSessionWorkspace";
import { createBrowserReceiverSessionOwner, type ReceiverSessionOwner } from "./src/gnss/receiverSessionOwner";
import { newDesignDraft } from "./src/newDesignDraft";
import { createPendingMapDraftSession, type PendingMapDraftState } from "./src/pendingMapDraft";
import { SettingsPanel } from "./src/components/SettingsPanel";
import { DrawingToolLauncher, DrawingToolPalette, type DrawingToolPaletteModal } from "./src/components/DrawingToolPalette";
import { useProjectRepository, type ProjectWorkspaceStatus, type PersistenceRevision, type OpenedDraft, type OpenedField, type OpenedDesign, type OpenedLayoutSession } from "./src/hooks/useProjectRepository";
import {
  parseCplayoutLeftNavMenuXml,
  type CplayoutLeftNavCatalogActionDefinition,
  type CplayoutLeftNavIconId,
  type CplayoutLeftNavMenuActionId,
  type CplayoutLeftNavMenuDefinition,
  type CplayoutLeftNavMenuItemDefinition,
  type CplayoutLeftNavRailItemDefinition,
} from "./src/navigation/leftNavMenu";
import { buildCommandMenuConfigs, isLeftNavItemDisabled, nextCatalogCreateAction } from "./src/navigation/navigationViewModels";
import { readWorkspaceResume, resolveResumeContext, writeWorkspaceResume } from "./src/navigation/workspaceResume";
import { buildProjectTreeViewModel } from "./src/navigation/projectTreeViewModel";
import type { ClientRecord } from "@cplayout/project-store";
import { createCatalogId, exportFileAsync, importProjectArchiveZip, importZipFileAsync, parseWorkspaceCommand, projectRepository, rehydrateInstalledMapPackageManifestsAsync, type CopyProjectCommand, type ProjectCatalog } from "@cplayout/project-store";
import {
  COORDINATE_FORMAT_LABELS,
  ADVISORY_DRIVE_UNIT_TIRE_OPTIONS,
  VALLEY_CORNER_ARM_SCAFFOLD_CATALOG,
  MACHINE_CATALOG_PRESETS,
  applyMachineCatalogPreset,
  buildMachinePathSummary,
  createManualDesignDraft,
  createProjectEditorState,
  evaluateManualDesignReadiness,
  coordinateExample,
  defaultProjectSettings,
  formatCoordinate,
  listAerialImageryCandidates,
  mergeAppSettings,
  parseCoordinateInput,
  parseAppSettings,
  qualifyProjectCrs,
  projectXyToLonLat,
  projectSettingsFromApp,
  buildMapReferenceViewModel,
  importGoogleEarthKmlToProject,
  importProjectedGeoJsonToProject,
  importSurveyCsvToProject,
  cornerGpsMapPresetToAdvisoryCornerArmConfig,
  parseCornerGpsMapConfigXml,
  type CornerGpsMapSourceRef,
  previewCornerGpsMapBpfImport,
  improvedCenterPivotProofProject,
  realCenterPivotProofProject,
  sampleProject,
  sampleDesignProjects,
  willRheaJasonHarmelinkExampleProject,
  type AppSettings,
  type CornerGpsMapBpfImportPreview,
  type GoogleEarthKmlImportResult,
  type AdvisoryCornerArmConfig,
  type CornerArmModelCatalogEntry,
  type CornerGpsMapModelPreset,
  type AdvisoryDriveUnitConfig,
  type LonLat,
  type LayoutResult,
  type ManualDesignDraft,
  type ManualDesignInputSource,
  type ManualDesignStep,
  type MapPackageManifest,
  type ObstacleZone,
  type PivotMachine,
  type PivotProject,
  type ProjectEditorAction,
  type ProjectMutationResult,
  type ProjectMapFeature,
  type ProjectMapFeatureKind,
  type PivotSweep,
  type XY,
} from "@cplayout/core";
import {
  DEFAULT_CORNER_ARM_SOURCE_REFS,
  analyzeAdvisoryMultiMachineLayout,
  analyzeAdvisoryObstacleInteractions,
  analyzeIdealPivotCenter,
  auditGeneratedFieldPivotReviewZones,
  buildAdvisoryDesignReport,
  buildAdvisoryEndGunSensitivityReview,
  buildAdvisoryMachineRenderModelSteps,
  analyzeAdvisoryMultiMachineLayoutSteps,
  planAdvisoryFieldPivotsSteps,
  buildAdvisoryGeneratedMultiPivotScenarioReview,
  buildAdvisoryRadiusSensitivityReview,
  buildAdvisorySweepEfficiencyReview,
  buildDesignScenarioPreview,
  compareAdvisoryMachineStrategies,
  evaluateAdvisoryCornerArm,
  evaluateCornerArmKinematics,
  evaluateLayout,
  evaluateMachineBoundaryClearance,
  exportScenarioGeoJson,
  machineRadiusMeters,
  planAdvisoryFieldPivots,
  type AdvisoryCostAssessment,
  type AdvisoryCostInput,
  type AdvisoryCornerArmEvaluation,
  type CornerArmKinematicResult,
  type AdvisoryDesignReport,
  type AdvisoryEndGunSensitivityReview,
  type AdvisoryEndGunSensitivityRow,
  type AdvisoryFieldPivotPlan,
  type AdvisoryGeneratedReviewZoneAudit,
  type AdvisoryGeneratedMultiPivotScenarioReview,
  type AdvisoryMachineStrategyComparison,
  type AdvisoryMachineStrategyResult,
  type AdvisoryMachineRenderModel,
  type AdvisoryMultiMachineReview,
  type AdvisoryObstacleInteractionReview,
  type AdvisoryRadiusSensitivityReview,
  type AdvisoryRadiusSensitivityRow,
  type AdvisorySweepEfficiencyReview,
  type AdvisorySweepEfficiencyRow,
  type DesignScenarioPreview,
  type DrawingLayerType,
  type DrawingMode,
  type IdealCenterPointAnalysis,
  type MachineBoundaryClearanceRow,
  type PivotPlacementCandidate,
} from "@cplayout/geometry";
import { formatAreaFromAcres, formatDistance, formatDistanceInputValue, formatFeetInches, parseDistanceInput } from "@cplayout/core";

const defaultDevelopmentProject = willRheaJasonHarmelinkExampleProject;
const leftNavMenuDefinition = parseCplayoutLeftNavMenuXml();

type WorkspaceView = "dashboard" | "map" | "survey" | "files" | "settings" | "help";
type Screen = "projects" | "workspace";
type TaskPresentation = { task: PrimaryTask; sequence: number; editorGeneration: number };
type WalkthroughModuleId = "imagery" | "boundary" | "obstacles" | "pivot" | "survey" | "cornerArmInputs" | "cornerArmCalculation" | "validation" | "export";
type DesignConsoleModal = DrawingToolPaletteModal;
type RightWorkflowSidebarPage = "overview" | "tools" | "purpose" | "toolForm" | "layers" | "feature" | "warnings" | "catalog" | "catalogForm";
type PendingPlacementAction =
  | { kind: "pivot"; candidate: PivotPlacementCandidate }
  | { kind: "cornerArm"; config: AdvisoryCornerArmConfig };

type MapDraftPurposeOption =
  | (UtilityFeatureOption & { purposeType: "map_feature"; meta: string })
  | { purposeType: "field_boundary"; kind: "field_boundary"; label: string; geometry: "Polygon"; meta: string }
  | { purposeType: "obstacle"; kind: ObstacleZone["kind"]; label: string; geometry: "Polygon"; meta: string };

const DEFAULT_CORNER_ARM_LENGTH_METERS = 91;
const DEFAULT_CORNER_ARM_WHEEL_TRACK_LENGTH_METERS = 66;
const DEFAULT_CORNER_ARM_OVERHANG_LENGTH_METERS = 25;

export default function App(): React.JSX.Element {
  const [task, setTask] = useState<PrimaryTask>("projects");
  const [taskRequest, setTaskRequest] = useState<{ task: PrimaryTask; sequence: number } | null>(null);
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null);
  const layoutCatalogGuard = useRef<(() => { dirty: boolean; busy: boolean }) | null>(null);
  const taskRef = useRef(task); taskRef.current = task;
  const focusedInputs = useRef<Partial<Record<PrimaryTask, { element: HTMLElement; generation: number }>>>({});
  const taskGeneration = useRef(0);
  const pendingFocusRestore = useRef<TaskPresentation | null>(null);
  const contentPresentation = useRef<TaskPresentation | null>(null);
  const contentCovered = useRef(false);
  const editorOwner = useRef<{ generation: number; draft: OpenedDraft | null; field: OpenedField | null }>({ generation: 0, draft: null, field: null });
  const layoutGuard = useRef<(() => { dirty: boolean; busy: boolean }) | null>(null);
  const childGuard = useRef<(() => { dirty: boolean; busy: boolean }) | null>(null);
  const [draft, setDraft] = useState<OpenedDraft | null>(null);
  const [field, setField] = useState<OpenedField | null>(null);
  const [completed, setCompleted] = useState<Extract<OpenedDesign, { kind: "project" }> | null>(null);
  const [archiveImport, setArchiveImport] = useState<{ fieldMapId: string | null } | null>(null);
  const [layout, setLayout] = useState<OpenedLayoutSession | null>(null);
  const [layoutTargetSaved, setLayoutTargetSaved] = useState<{ fieldMapId: string; targetDocument: string } | undefined>();
  const [layoutCatalog, setLayoutCatalog] = useState<{ fieldMapId: string | null; pendingTarget?: {
    targetDocument: string; fieldMapId: string; expectedWorkspaceRevision: number;
  } } | null>(null);
  const [receiverOwner] = useState(createBrowserReceiverSessionOwner);
  const [pendingDraft, setPendingDraft] = useState<{ onConfirm: () => void; onCancel: () => void } | null>(null);
  useEffect(() => () => { void receiverOwner.disconnect(); }, [receiverOwner]);
  useEffect(() => {
    const opened = draft ?? field;
    if (opened) writeWorkspaceResume({ version: 1, context: opened.context, editorOpen: true, view: "map" });
  }, [draft, field]);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const recordFocus = (event: FocusEvent) => {
      const element = event.target;
      if (element instanceof HTMLElement && element.matches("input,textarea,select,[contenteditable=true]") && element.getClientRects().length) {
        focusedInputs.current[taskRef.current] = { element, generation: editorOwner.current.generation };
      }
    };
    document.addEventListener("focusin", recordFocus);
    return () => document.removeEventListener("focusin", recordFocus);
  }, []);
  const restorePresentedFocus = useCallback(() => {
    if (Platform.OS !== "web") return;
    const pending = pendingFocusRestore.current;
    if (!pending || pending.task !== taskRef.current || pending.sequence !== taskGeneration.current
      || pending.editorGeneration !== editorOwner.current.generation) return;
    const presented = contentPresentation.current;
    if (!contentCovered.current && (!presented || presented.task !== pending.task
      || presented.sequence !== pending.sequence || presented.editorGeneration !== pending.editorGeneration)) return;
    const saved = focusedInputs.current[pending.task];
    if (!saved || saved.generation !== pending.editorGeneration || !saved.element.isConnected) {
      pendingFocusRestore.current = null;
      return;
    }
    if (!saved.element.getClientRects().length) return;
    pendingFocusRestore.current = null;
    saved.element.focus();
  }, []);
  const onTaskPresentationReady = useCallback((presented: TaskPresentation) => {
    contentPresentation.current = presented;
    restorePresentedFocus();
  }, [restorePresentedFocus]);
  function navigateTask(next: PrimaryTask): void {
    setNavigationNotice(null);
    // A task switch suspends a screen. It never closes an editor or changes its stored mode.
    if (next !== "layout" || layout || layoutCatalog) setTask(next);
    setTaskRequest({ task: next, sequence: ++taskGeneration.current });
  }
  function selectContentTask(next: PrimaryTask): void { taskGeneration.current++; setTask(next); }
  function beforeReplaceEditor(expectedGeneration?: number): boolean {
    const current = editorOwner.current;
    if (expectedGeneration !== undefined && expectedGeneration !== current.generation) return false;
    if (current.draft || current.field) {
      const state = childGuard.current?.();
      if (!state || state.busy || state.dirty) {
        setTask("design");
        setNavigationNotice(state?.busy ? "An operation is in progress. Try opening the other design when it finishes."
          : "Your open design has unfinished work. Save or discard it with Close design before opening another design.");
        return false;
      }
      childGuard.current = null; setDraft(null); setField(null);
    }
    editorOwner.current = { generation: current.generation + 1, draft: null, field: null };
    taskGeneration.current++; setTask("design");
    return true;
  }
  function openDraftEditor(opened: OpenedDraft, expectedGeneration?: number): void {
    if (expectedGeneration !== undefined && expectedGeneration !== editorOwner.current.generation) return;
    if (editorOwner.current.draft?.context.designId === opened.context.designId) { setTask("design"); return; }
    if (!beforeReplaceEditor(expectedGeneration)) return;
    editorOwner.current = { ...editorOwner.current, draft: opened }; childGuard.current = null; setDraft(opened); setField(null);
  }
  function openFieldEditor(opened: OpenedField, expectedGeneration?: number): void {
    if (expectedGeneration !== undefined && expectedGeneration !== editorOwner.current.generation) return;
    if (editorOwner.current.field?.context.designId === opened.context.designId) { setTask("design"); return; }
    if (!beforeReplaceEditor(expectedGeneration)) return;
    editorOwner.current = { ...editorOwner.current, field: opened }; childGuard.current = null; setField(opened); setDraft(null);
  }
  const retainedDesign = draft ?? field;
  const covered = Boolean((archiveImport && task === "projects") || task === "layout" || (retainedDesign && task !== "projects"));
  contentCovered.current = covered;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    // A retained surface becomes visible in this commit; AppContent acknowledges
    // its own view after the task request has committed. Neither uses a timing delay.
    pendingFocusRestore.current = { task, sequence: taskGeneration.current, editorGeneration: editorOwner.current.generation };
    const id = requestAnimationFrame(restorePresentedFocus);
    return () => cancelAnimationFrame(id);
  }, [task, taskRequest?.sequence, covered, restorePresentedFocus]);
  const leaveEditor = () => { editorOwner.current = { generation: editorOwner.current.generation + 1, draft: null, field: null }; childGuard.current = null; setDraft(null); setField(null); navigateTask("projects"); };
  return (
    <SafeAreaProvider>
      <PrimaryTaskNavigation task={task} onNavigate={navigateTask} />
      {navigationNotice ? <Text accessibilityRole="alert" style={{ padding: 8, color: "#8b3b21", backgroundColor: "#fff5df" }}>{navigationNotice}</Text> : null}
      <View style={{ flex: 1, display: covered ? "none" : "flex" }}>
        <InputRetentionProvider><AppContent visible={!covered} completed={completed} receiverOwner={receiverOwner}
          primaryTask={task} onTaskPresentationReady={onTaskPresentationReady} taskSequence={taskGeneration.current} editorGeneration={editorOwner.current.generation} onNavigateTask={navigateTask} taskRequest={taskRequest} onTaskChange={selectContentTask} getTaskGeneration={() => taskGeneration.current} beforeReplaceEditor={beforeReplaceEditor}
          retainedEditorContext={retainedDesign?.context ?? null} getEditorGeneration={() => editorOwner.current.generation}
          onOpenLayoutCatalog={(fieldMapId, requestedTaskGeneration) => {
            const review = layoutCatalogGuard.current?.();
            setLayoutCatalog(current => current && (layout || review?.dirty || review?.busy) ? current : { fieldMapId });
            if (!layout && layoutCatalog && layoutCatalog.fieldMapId !== fieldMapId && (review?.dirty || review?.busy)) setNavigationNotice("Resuming the retained Layout review with its original field selection. Save or cancel that review before preparing a target for another field.");
            if (requestedTaskGeneration === undefined || requestedTaskGeneration === taskGeneration.current) {
              setTask("layout");
              if (layout && layout.session.fieldMapId !== fieldMapId) setNavigationNotice("Resuming the open Layout session in its original field. Use Layout sessions to choose another field target.");
            }
          }}
          onOpenArchiveImport={(fieldMapId, requestedTaskGeneration) => { setArchiveImport(current => current ?? { fieldMapId }); if (requestedTaskGeneration === taskGeneration.current) setTask("projects"); }}
          onOpenDraft={openDraftEditor} onOpenField={openFieldEditor} onRequestDiscard={(onConfirm, onCancel) => setPendingDraft({ onConfirm, onCancel })} /></InputRetentionProvider>
      </View>
      {field ? <View style={{ flex: 1, display: task === "design" ? "flex" : "none" }}>
        <FieldDesignWorkspace key={field.context.designId} initial={field} visible={task === "design"} navigationGuardRef={childGuard} layoutTargetSaved={layoutTargetSaved} onClose={leaveEditor}
          onOpenLayout={async (targetDocument, fieldMapId, expectedWorkspaceRevision) => {
            const review = layoutCatalogGuard.current?.();
            if (review?.busy || review?.dirty) {
              setNavigationNotice("Your RTK Layout import review is still open. Return to RTK Layout to save or cancel that review before preparing another target.");
              return false;
            }
            const retained = layoutGuard.current?.();
            if (layout && (!retained || retained.busy || retained.dirty)) {
              setNavigationNotice("Finish the open Layout session's operation or save or clear its entered text before preparing another target.");
              return false;
            }
            setLayout(null);
            setLayoutCatalog({ fieldMapId, pendingTarget: { targetDocument, fieldMapId, expectedWorkspaceRevision } });
            setTask("layout");
            return true;
          }} />
      </View> : null}
      {draft ? <View style={{ flex: 1, display: task === "design" ? "flex" : "none" }}>
        <DesignDraftWorkspace key={draft.context.designId} initial={draft} visible={task === "design"} navigationGuardRef={childGuard} onClose={leaveEditor}
          getTaskGeneration={() => taskGeneration.current}
          onOpenComplete={(opened, requestedTaskGeneration) => {
            if (taskRef.current !== "design" || requestedTaskGeneration !== taskGeneration.current
              || editorOwner.current.draft?.context.designId !== draft.context.designId) return false;
            editorOwner.current = { generation: editorOwner.current.generation + 1, draft: null, field: null };
            childGuard.current = null; setCompleted(opened); setDraft(null); setTask("design");
            return true;
          }} />
      </View> : null}
      {layoutCatalog ? <View style={{ flex: 1, display: task === "layout" && !layout ? "flex" : "none" }}>
        <LayoutSessionCatalog key={layoutCatalog.fieldMapId ?? "unassigned"} {...layoutCatalog} navigationGuardRef={layoutCatalogGuard} visible={task === "layout" && !layout} onOpenSession={opened => {
          setLayoutTargetSaved({ fieldMapId: opened.session.fieldMapId, targetDocument: opened.session.targetDocument });
          setLayout(opened);
        }} onReviewSaved={(opened, submittedTarget) => {
          setLayoutTargetSaved({ fieldMapId: opened.session.fieldMapId, targetDocument: opened.session.targetDocument });
          setLayoutCatalog(current => current?.pendingTarget && current.pendingTarget === submittedTarget
            ? { fieldMapId: current.fieldMapId } : current);
        }} onClose={() => {
          layoutCatalogGuard.current = null;
          setLayoutCatalog(null);
          navigateTask("design");
        }} />
      </View> : null}
      {archiveImport ? <View style={{ flex: 1, display: task === "projects" ? "flex" : "none" }}><CatalogArchiveImport {...archiveImport} visible={task === "projects"} getEditorGeneration={() => editorOwner.current.generation} onClose={() => setArchiveImport(null)} onOpenDesign={opened => {
        if (opened.kind === "draft") openDraftEditor(opened);
        else if (opened.kind === "field") openFieldEditor(opened);
        else if (beforeReplaceEditor()) setCompleted(opened);
        else return;
        if (editorOwner.current.draft?.context.designId === opened.context.designId || editorOwner.current.field?.context.designId === opened.context.designId || opened.kind === "project") setArchiveImport(null);
      }} /></View> : null}
      {retainedDesign && task === "survey" ? <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} testID="retained-design-survey">
        <Text style={{ fontSize: 20, fontWeight: "700" }}>Survey · {draft?.draft.name ?? field?.field.name}</Text>
        <Text>{draft ? "Complete this draft to collect survey evidence into its completed design." : "Survey capture for this independent-machine field is not available. Its saved geometry remains unchanged. You can connect and inspect the receiver here."}</Text>
        <ReceiverConnectionPanel owner={receiverOwner} projectCrs={draft?.draft.projectCrs ?? field!.field.projectCrs} />
      </ScrollView> : null}
      {layout ? <View style={{ flex: 1, display: task === "layout" ? "flex" : "none" }}><LayoutSessionWorkspace key={layout.session.id} initial={layout} receiverOwner={receiverOwner} visible={task === "layout"} navigationGuardRef={layoutGuard}
        onClose={() => setLayout(null)} onOpenCopy={setLayout} /></View> : null}
      <ConfirmActionDialog visible={pendingDraft !== null} title="Leave unsaved project?"
        message="Changes since the last save will be discarded when you open the selected design."
        confirmLabel="Discard changes" testID="project-to-draft-discard"
        onCancel={() => { pendingDraft?.onCancel(); setPendingDraft(null); }}
        onConfirm={() => { const proceed = pendingDraft?.onConfirm; setPendingDraft(null); proceed?.(); }} />
    </SafeAreaProvider>
  );
}

function ProjectImportStatus({ kind }: { kind: "saving" | "saved" | "error" }): React.JSX.Element {
  const message = kind === "saving" ? "Imported project is saving locally."
    : kind === "saved" ? "Imported project saved locally."
      : "Imported project was not saved locally. The unsaved copy remains open.";
  const webProps: Record<string, unknown> = Platform.OS === "web"
    ? { role: kind === "error" ? "alert" : "status", "aria-live": kind === "error" ? "assertive" : "polite" } : {};
  return (
    <View accessibilityLiveRegion={kind === "error" ? "assertive" : "polite"}
      style={[styles.projectImportStatus, kind === "error" && styles.projectImportStatusError]}
      testID="project-import-status" {...webProps}>
      {kind === "error" ? <AlertTriangle size={16} color="#8d2b20" />
        : kind === "saved" ? <CheckCircle2 size={16} color="#254234" /> : <Save size={16} color="#254234" />}
      <Text style={styles.projectImportStatusText}>{message}</Text>
    </View>
  );
}

function AppContent({ primaryTask, onTaskPresentationReady, taskSequence, editorGeneration, onNavigateTask, retainedEditorContext, getEditorGeneration, getTaskGeneration, taskRequest, onTaskChange, beforeReplaceEditor, onOpenDraft, onOpenField, onRequestDiscard, visible, completed, receiverOwner, onOpenLayoutCatalog, onOpenArchiveImport }: {
  primaryTask: PrimaryTask;
  onTaskPresentationReady: (presentation: TaskPresentation) => void;
  taskSequence: number;
  editorGeneration: number;
  onNavigateTask: (task: PrimaryTask) => void;
  retainedEditorContext: OpenedDraft["context"] | null;
  getEditorGeneration: () => number;
  getTaskGeneration: () => number;
  taskRequest: { task: PrimaryTask; sequence: number } | null;
  onTaskChange: (task: PrimaryTask) => void;
  beforeReplaceEditor: (expectedGeneration?: number) => boolean;
  visible: boolean;
  completed: Extract<OpenedDesign, { kind: "project" }> | null;
  receiverOwner: ReceiverSessionOwner;
  onOpenLayoutCatalog: (fieldMapId: string | null, requestedTaskGeneration?: number) => void;
  onOpenArchiveImport: (fieldMapId: string | null, requestedTaskGeneration: number) => void;
  onOpenDraft: (draft: OpenedDraft, expectedGeneration?: number) => void;
  onOpenField: (field: OpenedField, expectedGeneration?: number) => void;
  onRequestDiscard: (onConfirm: () => void, onCancel: () => void) => void;
}): React.JSX.Element {
  const inputRetention = useInputRetention();
  const [resume] = useState(readWorkspaceResume);
  const [resumeApplied, setResumeApplied] = useState(false);
  const resumeStarted = useRef(false);
  const [screen, setScreen] = useState<Screen>("workspace");
  const [activeView, setActiveView] = useState<WorkspaceView>("map");
  const [editor, setEditor] = useState(() => createProjectEditorState(defaultDevelopmentProject));
  const editorRef = useRef(editor);
  const project = editor.project;
  const [runtimeMapPackages, setRuntimeMapPackages] = useState<MapPackageManifest[]>([]);
  const projectLoadSequenceRef = useRef(0);
  const unfinishedControllerDrawing = useRef(false);
  const onUnfinishedDrawingChange = useCallback((scope: { projectId: string; projectCrs: string; projectGeneration: number }, unfinished: boolean) => {
    if (scope.projectId === editorRef.current.project.id && scope.projectCrs === editorRef.current.project.projectCrs && scope.projectGeneration === projectLoadSequenceRef.current) unfinishedControllerDrawing.current = unfinished;
  }, []);
  const { saveCoordinator, saveSessionRef: projectSaveSessionRef, saveOwnerMountedRef } = useEditorSaveCoordinator({
    kind: "project", payloadId: defaultDevelopmentProject.id, designId: null,
    workspaceRevision: projectRepository.versionedWorkspace ? null : undefined,
  });
  const projectSaveSession = projectSaveSessionRef.current;
  const retainedProjectReceipt = useRef<RetainedProjectReceipt | null>(null);
  const siblingOpening = useRef(false);
  const [projectOpenRequests] = useState(createProjectOpenRequestGuard);
  const dispatchProjectTransaction = (action: ProjectEditorAction): ProjectMutationResult => {
    if (action.type !== "load_project") projectOpenRequests.invalidate();
    return dispatchProjectEditorAction(editorRef, action, setEditor);
  };
  const dispatchProject = (action: ProjectEditorAction): void => { dispatchProjectTransaction(action); };
  useEffect(() => () => projectOpenRequests.invalidate(), [projectOpenRequests]);
  const runtimeProject = useMemo(() => ({
    ...project,
    mapPackages: mergeMapPackageManifests(project.mapPackages ?? [], runtimeMapPackages),
  }), [project, runtimeMapPackages]);
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const [projectImportStatus, setProjectImportStatus] = useState<{
    generation: number;
    kind: "saving" | "saved" | "error";
  } | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => parseAppSettings({
    ...browserLocalSettings(defaultDevelopmentProject.settings),
    mappingWorkflowMode: "layout",
  }));
  const [rtkReceiverStatus, setRtkReceiverStatus] = useState<BrowserRtkReceiverStatus | null>(null);
  const [walkthroughProgress, setWalkthroughProgress] = useState<Record<WalkthroughModuleId, boolean>>(() => loadWalkthroughProgress(defaultDevelopmentProject.id));
  const [selectedMapFeatureId, setSelectedMapFeatureId] = useState<string | null>(null);
  const [designScenarioPreview, setDesignScenarioPreview] = useState<DesignScenarioPreview[] | null>(null);
  const [idealCenterAnalysis, setIdealCenterAnalysis] = useState<IdealCenterPointAnalysis | null>(null);
  const [placementCandidates, setPlacementCandidates] = useState<PivotPlacementCandidate[] | null>(null);
  const [costDraftState, setCostDraftState] = useState({ generation: projectLoadSequenceRef.current, draft: EMPTY_ADVISORY_COST_DRAFT });
  const advisoryCostDraft = costDraftState.generation === projectLoadSequenceRef.current ? costDraftState.draft : EMPTY_ADVISORY_COST_DRAFT;
  const setAdvisoryCostDraft = (draft: AdvisoryCostDraft) => setCostDraftState({ generation: projectLoadSequenceRef.current, draft });
  const [pendingPlacementAction, setPendingPlacementAction] = useState<PendingPlacementAction | null>(null);
  const [pendingMapDraftState, setPendingMapDraftState] = useState<PendingMapDraftState | null>(null);
  const pendingMapFeatureDraft = pendingMapDraftState?.draft ?? null;
  const [draftPurposeReceipt, setDraftPurposeReceipt] = useState<MapDraftPurposeReceipt | null>(null);
  const [guidedMapTool, setGuidedMapTool] = useState<{
    activeLayer: DrawingLayerType;
    draftGeometry?: UtilityFeatureGeometry;
    featureKind?: ProjectMapFeatureKind;
    mode: DrawingMode;
    requestId: number;
  } | null>(null);
  const [manualDesignCaptureRequest, setManualDesignCaptureRequest] = useState<{ requestId: number; role: ManualDesignMapCaptureRole } | null>(null);
  const [manualDesignMapCapture, setManualDesignMapCapture] = useState<(ManualDesignMapCapture & { sequence: number }) | null>(null);
  const [designConsoleModal, setDesignConsoleModal] = useState<DesignConsoleModal>(null);
  const [homeMapView, setHomeMapView] = useState(true);
  const pendingMapScopeRef = useRef({
    projectId: project.id, projectCrs: project.projectCrs,
    projectGeneration: projectLoadSequenceRef.current,
    editable: settings.mappingWorkflowMode === "design" && !homeMapView && visible && activeView === "map",
    suspended: homeMapView || !visible || activeView !== "map",
  });
  pendingMapScopeRef.current = {
    projectId: project.id, projectCrs: project.projectCrs,
    projectGeneration: projectLoadSequenceRef.current,
    editable: settings.mappingWorkflowMode === "design" && !homeMapView && visible && activeView === "map",
    suspended: homeMapView || !visible || activeView !== "map",
  };
  const [pendingMapDraftSession] = useState(() => createPendingMapDraftSession(() => ({
    ...pendingMapScopeRef.current,
    projectId: editorRef.current.project.id,
    projectCrs: editorRef.current.project.projectCrs,
    projectGeneration: projectLoadSequenceRef.current,
  })));
  useEffect(() => {
    const scope = pendingMapScopeRef.current;
    const current = pendingMapDraftState;
    if (current && ((!scope.editable && !scope.suspended) || current.owner.projectId !== scope.projectId
      || current.owner.projectCrs !== scope.projectCrs || current.owner.projectGeneration !== scope.projectGeneration)) {
      invalidatePendingMapDraft();
    }
  }, [project.id, project.projectCrs, projectLoadSequenceRef.current, settings.mappingWorkflowMode, homeMapView, visible, activeView, pendingMapDraftSession, pendingMapDraftState]);
  const [activeCatalogContext, setActiveCatalogContext] = useState<{
    clientId: string | null;
    projectId: string | null;
    fieldMapId: string | null;
    designId: string | null;
  }>({ clientId: null, projectId: null, fieldMapId: null, designId: null });
  const [catalogDialogMode, setCatalogDialogMode] = useState<ProjectCatalogDialogMode | null>(null);
  const [catalogDialogDefaultName, setCatalogDialogDefaultName] = useState("");
  const [clientProfileDialogMode, setClientProfileDialogMode] = useState<"create" | "edit" | null>(null);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [movingProjectId, setMovingProjectId] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [deletingClientId, setDeletingClientId] = useState<string | null>(null);
  const [catalogRefreshMessage, setCatalogRefreshMessage] = useState<string | null>(null);
  const [mapModeNotice, setMapModeNotice] = useState(false);
  const [prepareLayoutOpen, setPrepareLayoutOpen] = useState(false);
  const [designContextOpen, setDesignContextOpen] = useState(false);
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null);
  const [catalogDialogSubmitting, setCatalogDialogSubmitting] = useState(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compactLayout = windowWidth < 760;
  const tabletConsole = windowWidth >= 700 && windowWidth < 1180;
  const desktopConsole = Platform.OS === "web" && windowWidth >= 1180;
  const landscapeConsole = windowWidth > windowHeight;
  const shortLandscapeMap = activeView === "map" && landscapeConsole && windowHeight < 500;
  const compactMapContext = activeView === "map" && (compactLayout || shortLandscapeMap);
  useEffect(() => {
    if (!compactMapContext) setDesignContextOpen(false);
  }, [compactMapContext]);
  const safeBottomGutter = Math.max(insets.bottom, Platform.OS === "android" ? 24 : 0) + 10;
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(() => desktopConsole);
  const projectDrawerConsole = activeView === "map" || compactLayout;
  const projectDrawerForeground = projectDrawerConsole && leftDrawerOpen
    && (windowWidth < 700 || (shortLandscapeMap && windowWidth < 1180));
  const [rightDrawerOpen, setRightDrawerOpen] = useState(() => desktopConsole);
  const compactMapSidebar = compactLayout && !(shortLandscapeMap && !rightDrawerOpen);
  const [activeSidebarPage, setActiveSidebarPage] = useState<RightWorkflowSidebarPage>("catalog");
  const repository = useProjectRepository();
  const catalogContextPath = [
    repository.catalog.clients.find(item => item.id === activeCatalogContext.clientId)?.displayName ?? "Customer",
    repository.catalog.projects.find(item => item.id === activeCatalogContext.projectId)?.name ?? "Project",
    repository.catalog.fieldMaps.find(item => item.id === activeCatalogContext.fieldMapId)?.name ?? "Field",
    (repository.designCatalog?.designs ?? repository.catalog.designs).find(item => item.id === activeCatalogContext.designId)?.name ?? "Design",
  ].join(" → ");
  useEffect(() => {
    if (resumeStarted.current || repository.catalogRevision === null) return;
    resumeStarted.current = true;
    if (!resume) { setResumeApplied(true); return; }
    const context = resolveResumeContext(resume.context, repository.designCatalog ?? repository.catalog);
    setActiveCatalogContext(context);
    if (resume.editorOpen && context.designId) {
      void openDesignProject(context.designId).finally(() => { setActiveView(resume.view); setResumeApplied(true); });
    } else { setActiveView(resume.view); setResumeApplied(true); }
  }, [repository.catalogRevision]);
  useEffect(() => {
    if (resumeApplied && visible) writeWorkspaceResume({ version: 1, context: activeCatalogContext,
      editorOpen: !homeMapView, view: activeView });
  }, [resumeApplied, activeCatalogContext, homeMapView, activeView, visible]);
  const loadedCompleteRef = useRef<OpenedDesign | null>(null);
  useEffect(() => {
    if (!visible) return;
    void repository.refreshProjects();
    const baseline = retainedProjectReceipt.current;
    retainedProjectReceipt.current = null;
    const versioned = projectRepository.versionedWorkspace;
    if (baseline && versioned && saveCoordinator.isCurrent(baseline.session)) {
      void saveCoordinator.reconcileRetainedProject({ baseline, read: () => versioned.readAsync() })
        .catch(error => { if (saveCoordinator.isCurrent(baseline.session)) repository.reportError(error); });
    }
  }, [visible]);
  useEffect(() => {
    if (completed && loadedCompleteRef.current !== completed) {
      loadedCompleteRef.current = completed;
      const proceed = () => loadProject(completed.project, completed.context, true, completed.persistenceRevision);
      if (hasUnsavedProjectWork()) onRequestDiscard(proceed, restoreRetainedProjectView);
      else proceed();
    }
  }, [completed]);
  const catalogFormRef = useRef<{
    revision: number | null; catalog: ProjectCatalog; projects: ProjectWorkspaceStatus["projects"]; context: typeof activeCatalogContext; clientDefaultName: string;
  } | null>(null);
  const formCatalog = catalogFormRef.current?.catalog ?? repository.catalog;
  const calculation = useMemo(() => {
    const qualification = qualifyProjectCrs(project.projectCrs);
    if (!qualification.calculation.allowed) {
      return { result: null, reasons: qualification.calculation.blockers };
    }
    try {
      return { result: evaluateLayout(project), reasons: [] };
    } catch (error) {
      return { result: null, reasons: [error instanceof Error ? error.message : String(error)] };
    }
  }, [project]);
  const calculationAvailable = calculation.result !== null;
  const advisoryCostInput = useMemo(() => advisoryCostInputFromDraft(advisoryCostDraft, project.machine), [advisoryCostDraft, project.machine]);
  const androidNativeProofEnabled = Platform.OS === "android" && process.env.EXPO_PUBLIC_CPLAYOUT_ANDROID_NATIVE_PROOF === "1";
  const nativeMapLibreProofEnabled = Platform.OS === "android" && process.env.EXPO_PUBLIC_CPLAYOUT_NATIVE_MAPLIBRE_PROOF === "1";
  const isDirty = editor.revision !== savedRevision;
  const selectedMapFeature = useMemo(
    () => (project.mapFeatures ?? []).find((feature) => feature.id === selectedMapFeatureId) ?? null,
    [project.mapFeatures, selectedMapFeatureId],
  );
  const selectedClient = activeCatalogContext.clientId
    ? repository.catalog.clients.find((client) => client.id === activeCatalogContext.clientId) ?? null
    : null;
  const editingClient = editingClientId
    ? formCatalog.clients.find((client) => client.id === editingClientId) ?? null
    : null;
  const renamingProject = renamingProjectId
    ? formCatalog.projects.find((record) => record.id === renamingProjectId) ?? null
    : null;
  const movingProject = movingProjectId
    ? formCatalog.projects.find((record) => record.id === movingProjectId) ?? null
    : null;
  const deletingProject = deletingProjectId
    ? formCatalog.projects.find((record) => record.id === deletingProjectId)
      ?? catalogFormRef.current?.projects.find((record) => record.id === deletingProjectId) ?? null
    : null;
  const deletingClient = deletingClientId
    ? formCatalog.clients.find((client) => client.id === deletingClientId) ?? null
    : null;
  const sidebarInlineWorkflow = !compactLayout && !nativeMapLibreProofEnabled;
  const inlineCatalogForms = false; // Catalog dialogs leave the active editor and task mounted.
  const activeCatalogForm = Boolean(catalogDialogMode || clientProfileDialogMode || renamingProject || movingProject || deletingProject || deletingClient);
  const warningCount = (calculation.result?.warnings.length ?? calculation.reasons.length) + (editor.lastError ? 1 : 0);
  const powerEvidenceStatus = useMemo(() => projectPowerLineEvidenceStatus(project), [project]);
  const visibleSidebarPages = useMemo(
    () => rightWorkflowSidebarPages({
      activeCatalogForm: inlineCatalogForms && activeCatalogForm,
      catalogFormLabel: clientProfileDialogMode ? "Customer details" : catalogDialogMode === "fieldMap" ? "Field details" : catalogDialogMode === "design" ? "New design" : "Project details",
      toolFormLabel: designConsoleModal ? designConsoleCopy(designConsoleModal).title : "Design inputs",
      activePurposeForm: Boolean(pendingMapFeatureDraft),
      activeToolForm: Boolean(designConsoleModal),
      homeView: homeMapView,
      mappingWorkflowMode: settings.mappingWorkflowMode,
      selectedMapFeature: Boolean(selectedMapFeature),
      warningCount,
    }),
    [activeCatalogForm, clientProfileDialogMode, catalogDialogMode, designConsoleModal, homeMapView, inlineCatalogForms, pendingMapFeatureDraft, selectedMapFeature, settings.mappingWorkflowMode, warningCount],
  );
  const requestedSidebarPage = inlineCatalogForms && activeCatalogForm ? "catalogForm" : activeSidebarPage;
  const effectiveSidebarPage = visibleSidebarPages.some((page) => page.id === requestedSidebarPage)
    ? requestedSidebarPage
    : (visibleSidebarPages[0]?.id ?? "overview");
  const demand = advisoryDemand({ homeView: homeMapView, view: activeView, modal: designConsoleModal, sidebar: effectiveSidebarPage, sidebarOpen: rightDrawerOpen });
  const projectGeneration = projectLoadSequenceRef.current;
  const cornerInputScope = useMemo(() => cornerArmInputScope(project), [project]);
  const [cornerInputState, setCornerInputState] = useState<{ generation: number; scope: string; draft: CornerArmInputDraft } | null>(null);
  useEffect(() => {
    setCornerInputState(current => current && (current.generation !== projectGeneration || current.scope !== cornerInputScope) ? null : current);
  }, [cornerInputScope, projectGeneration]);
  const cornerInputDraft = useMemo(() => cornerInputState?.generation === projectGeneration && cornerInputState.scope === cornerInputScope
    ? cornerInputState.draft : initialCornerArmInputs(project), [cornerInputState, project, projectGeneration, cornerInputScope]);
  const updateCornerInputDraft = (draft: CornerArmInputDraft) => setCornerInputState({ generation: projectGeneration, scope: cornerInputScope, draft });
  const [fieldPivotPreview, setFieldPivotPreview] = useState({ generation: projectGeneration, count: 3 });
  const requestedFieldPivots = fieldPivotPreview.generation === projectGeneration ? fieldPivotPreview.count : 3;
  const updateRequestedFieldPivots = (count: number) => {
    if (Number.isInteger(count) && count >= 1 && count <= 4) setFieldPivotPreview({ generation: projectGeneration, count });
  };
  const fieldPlanRequest = useMemo(() => ({
    projectId: project.id, generation: projectGeneration, revision: editor.revision,
    create: () => planAdvisoryFieldPivotsSteps(project, {
      gridDivisions: 6, maxMachines: requestedFieldPivots, candidatePoolSize: 24,
      collisionBufferMeters: project.machine.machineClearanceBufferMeters, costInput: advisoryCostInput,
    }),
  }), [advisoryCostInput, editor.revision, project, projectGeneration, requestedFieldPivots]);
  const multiMachineRequest = useMemo(() => ({
    projectId: project.id, generation: projectGeneration, revision: editor.revision,
    create: () => analyzeAdvisoryMultiMachineLayoutSteps(project, {
      maxCandidates: 3, collisionBufferMeters: project.machine.machineClearanceBufferMeters,
    }),
  }), [editor.revision, project, projectGeneration]);
  const renderModelRequest = useMemo(() => ({
    projectId: project.id, generation: projectGeneration, revision: editor.revision,
    create: () => buildAdvisoryMachineRenderModelSteps(project, { maxInstances: 2 }),
  }), [editor.revision, project, projectGeneration]);
  const fieldPlanJob = useAdvisoryJob(fieldPlanRequest, calculationAvailable && demand.fieldPlan);
  const multiMachineJob = useAdvisoryJob(multiMachineRequest, calculationAvailable && demand.multiMachine);
  const renderModelJob = useAdvisoryJob(renderModelRequest, calculationAvailable && demand.renderModel);
  const advisoryFieldPivotPlan = calculationAvailable && fieldPlanJob.status === "ready" ? fieldPlanJob.value : null;
  const advisoryMultiMachineReview = calculationAvailable && multiMachineJob.status === "ready" ? multiMachineJob.value : null;
  const advisoryMachineRenderModel = calculationAvailable && renderModelJob.status === "ready" ? renderModelJob.value : null;
  const advisoryError = (demand.fieldPlan && fieldPlanJob.status === "error")
    || (demand.multiMachine && multiMachineJob.status === "error")
    || (demand.renderModel && renderModelJob.status === "error");
  const advisoryStatus = advisoryError ? "Advisory calculation failed." : "Calculating advisory results...";
  const retryAdvisory = () => { fieldPlanJob.retry(); multiMachineJob.retry(); renderModelJob.retry(); };
  const cornerArmEvaluation = useMemo(() => calculationAvailable && demand.cornerArm ? evaluateAdvisoryCornerArm(project) : null, [calculationAvailable, demand.cornerArm, project]);

  useEffect(() => {
    if (selectedMapFeatureId && !(project.mapFeatures ?? []).some((feature) => feature.id === selectedMapFeatureId)) {
      setSelectedMapFeatureId(null);
    }
  }, [project.mapFeatures, selectedMapFeatureId]);

  useEffect(() => {
    setDesignScenarioPreview(null);
    setIdealCenterAnalysis(null);
    setPlacementCandidates(null);
  }, [editor.revision, project]);

  useEffect(() => {
    setAdvisoryCostDraft(EMPTY_ADVISORY_COST_DRAFT);
    setManualDesignCaptureRequest(null);
    setManualDesignMapCapture(null);
  }, [project.id]);

  useEffect(() => {
    setIdealCenterAnalysis(null);
    setPlacementCandidates(null);
  }, [advisoryCostInput]);



  const previousFeatureConsoleModal = useRef(designConsoleModal);
  useEffect(() => {
    const returningFromCalculation = previousFeatureConsoleModal.current === "calculate" && designConsoleModal === null;
    previousFeatureConsoleModal.current = designConsoleModal;
    if (!selectedMapFeatureId || returningFromCalculation) return;
    if (activeCatalogForm || designConsoleModal) return;
    setActiveSidebarPage("feature");
    setRightDrawerOpen(true);
  }, [activeCatalogForm, designConsoleModal, selectedMapFeatureId]);

  useEffect(() => {
    if (homeMapView) {
      setActiveSidebarPage("catalog");
      return;
    }
    if (pendingMapDraftState) { setActiveSidebarPage("purpose"); return; }
    if (selectedMapFeatureId) return;
    setActiveSidebarPage(settings.mappingWorkflowMode === "layout" ? "overview" : "tools");
  }, [homeMapView, selectedMapFeatureId, settings.mappingWorkflowMode, pendingMapDraftState]);

  const compactProjects = compactLayout && activeView === "dashboard";
  const previousCompactProjects = useRef(compactProjects);
  useEffect(() => {
    if (compactProjects) {
      if (!previousCompactProjects.current) setLeftDrawerOpen(false);
      previousCompactProjects.current = true;
      return;
    }
    previousCompactProjects.current = false;
    if (desktopConsole) {
      setLeftDrawerOpen(true);
      setRightDrawerOpen(true);
      return;
    }
    if (tabletConsole || landscapeConsole) {
      setLeftDrawerOpen(false);
      setRightDrawerOpen(false);
    }
  }, [compactProjects, desktopConsole, landscapeConsole, tabletConsole]);

  function applyPivotCoordinate(coordinate: XY, wgs84?: LonLat): void {
    dispatchProject({ type: "place_pivot", point: coordinate, wgs84 });
  }

  function dispatchProjectWithResult(action: ProjectEditorAction): boolean {
    return dispatchProjectTransaction(action).ok;
  }

  function calculateDesignScenarios(): void {
    const analysis = analyzeIdealPivotCenter(project, {
      maxCandidates: 4,
      costInput: advisoryCostInput,
      minimumBoundaryClearanceMeters: settings.layoutReview.requiredBoundaryClearanceMeters,
    });
    setDesignScenarioPreview(buildDesignScenarioPreview(project, { maxOptimizedCandidates: 3 }));
    setIdealCenterAnalysis(analysis);
    setPlacementCandidates(analysis.candidates);
  }

  async function confirmPlacementAction(): Promise<void> {
    if (!pendingPlacementAction) return;
    if (pendingPlacementAction.kind === "pivot") {
      dispatchProjectWithResult({ type: "place_pivot", point: pendingPlacementAction.candidate.pivotCenter });
    } else {
      dispatchProjectWithResult({
        type: "update_machine",
        machine: {
          ...project.machine,
          cornerArm: {
            ...pendingPlacementAction.config,
            operatorConfirmedAt: new Date().toISOString(),
          },
        },
      });
    }
    setPendingPlacementAction(null);
  }

  function commitSettings(nextSettings: AppSettings): void {
    const parsed = parseAppSettings(nextSettings);
    setSettings(parsed);
    if (Platform.OS === "web") {
      try { globalThis.localStorage?.setItem("cplayout-workspace-preferences-v1", JSON.stringify({ unitSystem: parsed.unitSystem,
        coordinateDisplayFormat: parsed.coordinateDisplayFormat })); } catch { /* optional preferences never block project editing */ }
    }
    if (!homeMapView) {
      dispatchProject({ type: "update_project_settings", unitSystem: parsed.unitSystem, settings: projectSettingsFromApp(parsed) });
    }
  }

  function setWorkflowMode(mappingWorkflowMode: AppSettings["mappingWorkflowMode"]): void {
    if (mappingWorkflowMode !== "design" && (pendingMapDraftState || unfinishedControllerDrawing.current)) {
      setMapModeNotice(true);
      return;
    }
    if (mappingWorkflowMode !== "design") pendingMapScopeRef.current = { ...pendingMapScopeRef.current, editable: false };
    setSettings((current) => parseAppSettings({ ...current, mappingWorkflowMode }));
    if (mappingWorkflowMode !== "design") {
      setGuidedMapTool(null);
      setDesignConsoleModal(null);
      invalidatePendingMapDraft();
    }
  }

  function loadProject(nextProject: PivotProject, context?: Partial<typeof activeCatalogContext>, persisted = false, persistenceRevision: PersistenceRevision = null, expectedGeneration?: number): boolean {
    if (!beforeReplaceEditor(expectedGeneration)) return false;
    setPrepareLayoutOpen(false);
    setDesignContextOpen(false);
    inputRetention.reset();
    unfinishedControllerDrawing.current = false;
    invalidateCatalogForm();
    repository.clearProjectError();
    projectOpenRequests.invalidate();
    const loadSequence = projectLoadSequenceRef.current + 1;
    projectLoadSequenceRef.current = loadSequence;
    pendingMapScopeRef.current = { projectId: nextProject.id, projectCrs: nextProject.projectCrs,
      projectGeneration: loadSequence, editable: false, suspended: false };
    projectSaveSessionRef.current = saveCoordinator.open({
      kind: "project", payloadId: nextProject.id, designId: context?.designId ?? null,
      workspaceRevision: projectRepository.versionedWorkspace ? persistenceRevision : undefined,
    });
    dispatchProject({ type: "load_project", project: nextProject });
    setRuntimeMapPackages([]);
    void rehydrateRuntimeMapPackages(loadSequence, nextProject.mapPackages ?? []);
    setSavedRevision(persisted ? 0 : null);
    setProjectImportStatus(null);
    setSettings((current) => browserLocalSettings(nextProject.settings, current));
    setWalkthroughProgress(loadWalkthroughProgress(nextProject.id));
    setSelectedMapFeatureId(null);
    invalidatePendingMapDraft();
    setPendingPlacementAction(null);
    setDesignScenarioPreview(null);
    setIdealCenterAnalysis(null);
    setPlacementCandidates(null);
    setDesignConsoleModal(null);
    setGuidedMapTool(null);
    setManualDesignCaptureRequest(null);
    setManualDesignMapCapture(null);
    setHomeMapView(false);
    setActiveView("map");
    setWorkflowMode("design");
    if (windowWidth < 700 || (landscapeConsole && windowHeight < 500 && windowWidth < 1180)) setLeftDrawerOpen(false);
    setActiveSidebarPage("tools");
    setActiveCatalogContext({ clientId: null, projectId: null, fieldMapId: null, designId: null, ...context });
    setScreen("workspace");
    return true;
  }

  function loadIndependentProject(nextProject: PivotProject, expectedGeneration?: number): boolean {
    return loadProject(nextProject, { clientId: null, projectId: null, fieldMapId: null, designId: null }, false, null, expectedGeneration);
  }

  async function importIndependentProjectZip(owner: object, asCopy = false): Promise<{ name: string; saved: boolean } | null> {
    const expectedGeneration = getEditorGeneration();
    const accepted: { value: { project: PivotProject; generation: number; session: EditorSaveSession } | null } = { value: null };
    await projectOpenRequests.open(async () => {
      if (asCopy && !repository.canCopyProject) throw new Error("Import Copy requires revision-checked local storage.");
      const bytes = await importZipFileAsync();
      if (!bytes) return null;
      const imported = importProjectArchiveZip(bytes);
      return asCopy ? { ...imported, id: `project-copy-${globalThis.crypto.randomUUID()}` } : imported;
    }, (imported) => {
      if (!loadIndependentProject(imported, expectedGeneration)) return;
      const generation = projectLoadSequenceRef.current;
      accepted.value = { project: editorRef.current.project, generation, session: projectSaveSessionRef.current };
      setProjectImportStatus({ generation, kind: "saving" });
    }, owner);
    if (!accepted.value) return null;
    const { project: imported, generation, session } = accepted.value;
    const feedbackCurrent = projectOpenRequests.completionIsCurrent();
    let saved = false;
    try {
      const outcome = await saveCoordinator.save({
        session, payload: { kind: "project", project: imported }, editorRevision: 0,
        feedbackIsCurrent: () => saveOwnerMountedRef.current && feedbackCurrent(), write: writeProjectSnapshot,
      });
      saved = outcome.saved;
    } catch (error) {
      if (saveOwnerMountedRef.current && saveCoordinator.isCurrent(session) && feedbackCurrent()) repository.reportError(error);
    } finally {
      if (saveOwnerMountedRef.current && saveCoordinator.isCurrent(session)) {
        if (saved) setSavedRevision(0);
        setProjectImportStatus({ generation, kind: saved ? "saved" : "error" });
      }
    }
    return { name: imported.name, saved };
  }

  async function rehydrateRuntimeMapPackages(loadSequence: number, mapPackages: MapPackageManifest[]): Promise<void> {
    try {
      const runtimeManifests = await rehydrateInstalledMapPackageManifestsAsync(mapPackages);
      if (projectLoadSequenceRef.current !== loadSequence || runtimeManifests.length === 0) return;
      setRuntimeMapPackages(runtimeManifests);
    } catch {
      // Runtime tile URLs are opportunistic display state; project metadata stays logical.
    }
  }

  function loadProjectDashboard(nextProject: PivotProject, context?: Partial<typeof activeCatalogContext>): void {
    loadProject(nextProject, context);
    setActiveView("dashboard");
  }

  function startBlankDesign(): void {
    if (!activeCatalogContext.fieldMapId) {
      showCatalogMap(activeCatalogContext, "Select or create a field map before adding a design.");
      return;
    }
    openCatalogDialog("design");
  }

  function openCatalogHome(): void {
    onTaskChange("projects");
    invalidateCatalogForm();
    pendingMapScopeRef.current = { ...pendingMapScopeRef.current, editable: false, suspended: true };
    projectOpenRequests.invalidate();
    setScreen("workspace");
    setActiveView("map");
    setHomeMapView(true);
    setActiveSidebarPage("catalog");
  }

  async function saveCurrentProject(): Promise<void> {
    if (!saveOwnerMountedRef.current || !saveCoordinator.isCurrent(projectSaveSession)) return;
    const generation = projectLoadSequenceRef.current;
    const currentEditor = editorRef.current;
    const feedbackCurrent = projectOpenRequests.completionIsCurrent();
    try {
      const outcome = await saveCoordinator.save({
        session: projectSaveSession, payload: { kind: "project", project: currentEditor.project },
        editorRevision: currentEditor.revision, feedbackIsCurrent: () => saveOwnerMountedRef.current && feedbackCurrent(),
        write: (payload, target, owner) => writeProjectSnapshot(payload, target, owner,
          currentEditor === editor ? calculation.result ?? undefined : undefined),
      });
      const saved = outcome.saved;
      if (saveOwnerMountedRef.current && saveCoordinator.isCurrent(projectSaveSession)) {
        if (saved) setSavedRevision(outcome.editorRevision);
        setProjectImportStatus((current) => current?.generation === generation
          ? { generation, kind: saved ? "saved" : "error" } : current);
      }
    } catch (error) {
      if (saveOwnerMountedRef.current && saveCoordinator.isCurrent(projectSaveSession) && feedbackCurrent()) repository.reportError(error);
    }
  }

  function writeProjectSnapshot(payload: EditorSavePayload, target: EditorSaveTarget, owner: { isCurrent(): boolean }, result?: LayoutResult) {
    if (payload.kind !== "project" || target.kind !== "project") throw new Error("This editor cannot save a draft through the project writer.");
    return target.designId
      ? repository.saveDesignProject(target.designId, payload.project, result, target.workspaceRevision, owner)
      : repository.saveProject(payload.project, result, target.workspaceRevision, owner);
  }

  async function saveProjectCopy(command: CopyProjectCommand, expectedRevision: number): Promise<PivotProject> {
    const captured = parseWorkspaceCommand(command) as CopyProjectCommand;
    const receipt = await saveCoordinator.copyProject({
      session: projectSaveSession, sourceId: captured.source.id, sourceStored: captured.sourceStored,
      expectedRevision, write: () => repository.copyProject(captured, expectedRevision),
    });
    return receipt.project;
  }

  async function openRetainedWorkspace(open: () => void): Promise<void> {
    if (siblingOpening.current) return;
    siblingOpening.current = true;
    const session = projectSaveSessionRef.current;
    try {
      const versioned = projectRepository.versionedWorkspace;
      const meaningfulEditor = projectLoadSequenceRef.current > 0 || hasUnsavedProjectWork();
      const baseline = versioned && meaningfulEditor ? await saveCoordinator.captureRetainedProject({ session, read: () => versioned.readAsync() }) : null;
      if (!saveOwnerMountedRef.current || !saveCoordinator.isCurrent(session)) return;
      retainedProjectReceipt.current = baseline;
      open();
    } catch (error) { if (saveCoordinator.isCurrent(session)) repository.reportError(error); }
    finally { siblingOpening.current = false; }
  }

  const designPresentation = useRef<{ sidebar: RightWorkflowSidebarPage; context: typeof activeCatalogContext } | null>(null);
  useEffect(() => {
    if (!taskRequest) return;
    const next = taskRequest.task;
    if (compactLayout || (next === "design" && landscapeConsole && windowHeight < 500 && windowWidth < 1180)) setLeftDrawerOpen(false);
    if (next === "layout") { openLayoutWorkspace(taskRequest.sequence); return; }
    if (retainedEditorContext && next !== "projects") return;
    if (next === "projects") {
      if (retainedEditorContext) setActiveCatalogContext(retainedEditorContext);
      if (!homeMapView) designPresentation.current = { sidebar: activeSidebarPage, context: activeCatalogContext };
      pendingMapScopeRef.current = { ...pendingMapScopeRef.current, editable: false, suspended: true };
      setHomeMapView(true); setActiveView("dashboard");
    } else {
      if (projectLoadSequenceRef.current > 0) {
        setHomeMapView(false);
        if (designPresentation.current) setActiveSidebarPage(designPresentation.current.sidebar);
        const target = saveCoordinator.receipt(projectSaveSessionRef.current);
        const design = repository.catalog.designs.find(item => item.id === target.designId);
        const field = repository.catalog.fieldMaps.find(item => item.id === design?.fieldMapId);
        const folder = repository.catalog.projects.find(item => item.id === field?.projectId);
        setActiveCatalogContext({ clientId: folder?.clientId ?? null, projectId: folder?.id ?? null, fieldMapId: field?.id ?? null, designId: design?.id ?? null });
      }
      setActiveView(next === "survey" ? "survey" : "map");
    }
  }, [taskRequest?.sequence]);
  useEffect(() => {
    const presented = primaryTask === "projects" ? activeView === "dashboard" && homeMapView
      : primaryTask === "survey" ? activeView === "survey"
      : primaryTask === "design" && activeView === "map" && (projectLoadSequenceRef.current === 0 || !homeMapView);
    if (visible && presented) onTaskPresentationReady({ task: primaryTask, sequence: taskSequence, editorGeneration });
  }, [visible, primaryTask, activeView, homeMapView, taskSequence, editorGeneration, onTaskPresentationReady]);
  function navigateUtility(view: WorkspaceView): void {
    if (view === "map" || view === "survey") { onNavigateTask(view === "map" ? "design" : "survey"); return; }
    if (compactLayout) setLeftDrawerOpen(false);
    setActiveView(view);
  }

  function openArchiveWorkspace(): void { const generation = getTaskGeneration(); void openRetainedWorkspace(() => onOpenArchiveImport(activeCatalogContext.fieldMapId, generation)); }
  function openLayoutWorkspace(requestedTaskGeneration = getTaskGeneration()): void { void openRetainedWorkspace(() => onOpenLayoutCatalog(retainedEditorContext?.fieldMapId ?? activeCatalogContext.fieldMapId, requestedTaskGeneration)); }

  async function openSavedProject(projectId: string): Promise<void> {
    const expectedGeneration = getEditorGeneration();
    try {
      await projectOpenRequests.open(() => repository.openProject(projectId), (loaded) => {
        const proceed = () => loadProject(loaded.project, loaded.context, true, loaded.persistenceRevision, expectedGeneration);
        if (hasUnsavedProjectWork()) onRequestDiscard(proceed, restoreRetainedProjectView);
        else proceed();
      });
    } catch (error) { repository.reportError(error); }
  }

  async function openDesignProject(designId: string): Promise<void> {
    const expectedGeneration = getEditorGeneration();
    try {
      await projectOpenRequests.open(() => repository.openDesignProject(designId), (loaded) => {
        if (loaded.kind === "draft" || loaded.kind === "field") {
          if (saveOwnerMountedRef.current) {
            const proceed = () => {
              setActiveCatalogContext(loaded.context);
              void openRetainedWorkspace(() => { if (loaded.kind === "draft") onOpenDraft(loaded, expectedGeneration); else onOpenField(loaded, expectedGeneration); });
            };
            if (hasUnsavedProjectWork()) onRequestDiscard(proceed, restoreRetainedProjectView);
            else proceed();
          }
        } else {
          const proceed = () => loadProject(loaded.project, loaded.context, true, loaded.persistenceRevision, expectedGeneration);
        if (hasUnsavedProjectWork()) onRequestDiscard(proceed, restoreRetainedProjectView);
        else proceed();
        }
      });
    } catch (error) { repository.reportError(error); }
  }

  function importProjectedGeoJson(geoJson: string): string {
    const imported = importProjectedGeoJsonToProject(project, geoJson);
    dispatchProject({ type: "import_projected_geojson", geoJson });
    const parts = [];
    if (imported.importedBoundary) parts.push("boundary");
    if (imported.importedObstacleCount > 0) parts.push(`${imported.importedObstacleCount} obstacle${imported.importedObstacleCount === 1 ? "" : "s"}`);
    return `Imported projected GeoJSON ${parts.length > 0 ? parts.join(" and ") : "features"} into the current project.`;
  }

  async function createIndependentField(): Promise<void> {
    const expectedGeneration = getEditorGeneration();
    let baseline: RetainedProjectReceipt | null = null;
    try {
      const designId = activeCatalogContext.designId;
      if (!designId) throw new Error("Save this design in a field map before creating an independent-machine field.");
      if (!repository.canSaveField) throw new Error("Independent-machine fields are currently available in the web workspace.");
      // Preserve the acknowledged source document byte-for-byte when unchanged.
      // Re-serializing can recompute derived WGS84 display values across engines.
      if (editorRef.current.revision !== savedRevision) await saveCurrentProject();
      const receipt = saveCoordinator.receipt(projectSaveSession);
      if (receipt.workspaceRevision === null || receipt.workspaceRevision === undefined) throw new Error("Save the source design before creating the field copy.");
      // Read back the acknowledged source; failed or stale saves cannot create a
      // field from an earlier design under the current editor's name.
      const source = await repository.openDesignProject(designId);
      if (source.kind !== "project" || JSON.stringify(source.project) !== JSON.stringify(editorRef.current.project)) {
        throw new Error("The source save did not match the current design. Resolve the save error before creating a field copy.");
      }
      const versioned = projectRepository.versionedWorkspace;
      baseline = versioned ? await saveCoordinator.captureRetainedProject({ session: projectSaveSession, read: () => versioned.readAsync() }) : null;
      const opened = await repository.createFieldFromSavedProject(designId, receipt.workspaceRevision);
      if (saveOwnerMountedRef.current && saveCoordinator.isCurrent(projectSaveSession)) {
        retainedProjectReceipt.current = baseline;
        onOpenField(opened, expectedGeneration);
      }
    } catch (error) {
      const versioned = projectRepository.versionedWorkspace;
      if (baseline && versioned && saveCoordinator.isCurrent(baseline.session)) {
        try { await saveCoordinator.reconcileRetainedProject({ baseline, read: () => versioned.readAsync() }); }
        catch (reconciliationError) { repository.reportError(reconciliationError); return; }
      }
      repository.reportError(error);
    }
  }

  function importSurveyCsv(csv: string): string {
    const imported = importSurveyCsvToProject(project, csv);
    dispatchProject({ type: "import_survey_csv", csv });
    return `Imported ${imported.importedPointCount} survey point${imported.importedPointCount === 1 ? "" : "s"} into the current project.`;
  }

  function importMapPackage(manifest: MapPackageManifest, runtimeManifest: MapPackageManifest): string {
    dispatchProject({ type: "upsert_map_package", mapPackage: manifest });
    setRuntimeMapPackages((current) => mergeMapPackageManifests(current, [runtimeManifest]));
    return `Imported map package ${manifest.name}. Save Local to persist package metadata; runtime file URLs stay local to this app install.`;
  }

  function previewGoogleEarthKml(kmlText: string, selectedItemIds?: string[]): GoogleEarthKmlImportResult {
    return importGoogleEarthKmlToProject(project, kmlText, { selectedItemIds });
  }

  function applyGoogleEarthKmlImport(nextProject: PivotProject): void {
    dispatchProject({ type: "apply_project_import", project: nextProject });
  }

  function previewCornerGpsMapBpf(
    bpfText: string,
    selectedItemIds?: string[],
    observedAt?: string,
    sourceRef?: CornerGpsMapSourceRef,
  ): CornerGpsMapBpfImportPreview {
    return previewCornerGpsMapBpfImport(project, bpfText, { selectedItemIds, observedAt, sourceRef });
  }

  function applyCornerGpsMapBpfImport(nextProject: PivotProject): void {
    dispatchProject({ type: "apply_project_import", project: nextProject });
  }

  function addMapFeature(feature: Omit<ProjectMapFeature, "id"> & { id?: string }): ProjectMutationResult {
    const id = feature.id ?? `map-feature-${Date.now().toString(36)}-${(project.mapFeatures ?? []).length + 1}`;
    const mutation = dispatchProjectTransaction({ type: "add_map_feature", feature: { ...feature, id } });
    if (mutation.ok) setSelectedMapFeatureId(id);
    return mutation;
  }

  function cleanPendingPurposeInputs(): void {
    const owner = pendingMapDraftState?.owner;
    if (owner) for (const key of ["selection", "name", "notes"]) inputRetention.markClean(`purpose:${owner.projectGeneration}:${owner.draftId}:${key}`);
  }

  function invalidatePendingMapDraft(): void {
    cleanPendingPurposeInputs();
    pendingMapDraftSession.invalidate();
    setPendingMapDraftState(null);
    setDraftPurposeReceipt(null);
  }

  function createPendingMapFeatureDraft(draft: PendingMapFeatureDraft): MapDraftHandoffResult {
    const result = pendingMapDraftSession.begin(draft, {
      projectId: project.id, projectCrs: project.projectCrs, projectGeneration,
      editable: settings.mappingWorkflowMode === "design" && !homeMapView,
    });
    if (!result.ok) return result;
    setPendingMapDraftState(pendingMapDraftSession.getSnapshot());
    setDraftPurposeReceipt(null);
    setDesignConsoleModal(null);
    setActiveSidebarPage("purpose");
    setRightDrawerOpen(true);
    return result;
  }

  function cancelPendingMapFeatureDraft(owner: MapDraftOwner): void {
    const receipt = pendingMapDraftSession.cancel(owner);
    if (!receipt) return;
    cleanPendingPurposeInputs();
    setPendingMapDraftState(pendingMapDraftSession.getSnapshot());
    setDraftPurposeReceipt(receipt);
    setActiveSidebarPage("tools");
  }

  function savePendingMapFeatureDraft(owner: MapDraftOwner, option: MapDraftPurposeOption, details?: { name: string; notes: string }): void {
    let featureId: string | null = null;
    const receipt = pendingMapDraftSession.save(owner, (draft) => {
      if (option.geometry !== draft.geometryType) return { ok: false, error: "This purpose does not match the captured geometry." };
      if (option.purposeType === "field_boundary") {
        return dispatchProjectTransaction({ type: "commit_boundary_draft", vertices: draft.vertices });
      }
      if (option.purposeType === "obstacle") {
        return dispatchProjectTransaction({ type: "commit_obstacle_draft", vertices: draft.vertices,
          kind: option.kind, confidence: draft.sourceConfidence });
      }
      featureId = `map-feature-${Date.now().toString(36)}-${(project.mapFeatures ?? []).length + 1}`;
      const feature: ProjectMapFeature = {
        id: featureId,
        name: details?.name.trim() || defaultMapFeatureName(option.kind, draft.geometryType, draft.vertices.length),
        kind: option.kind,
        geometry: draftVerticesToFeatureGeometry(draft.geometryType, draft.vertices),
        confidence: draft.sourceConfidence,
        notes: details?.notes.trim() || draft.notes,
      };
      return dispatchProjectTransaction({ type: "add_map_feature", feature });
    }, `${option.label} committed in projected XY. Save Local to persist.`);
    if (!receipt) return;
    setPendingMapDraftState(pendingMapDraftSession.getSnapshot());
    setDraftPurposeReceipt(receipt);
    if (receipt.outcome !== "committed") return;
    cleanPendingPurposeInputs();
    if (featureId) setSelectedMapFeatureId(featureId);
    setActiveSidebarPage(featureId ? "feature" : "tools");
  }

  function saveGeneratedFieldPivotReviewZones(plan: AdvisoryFieldPivotPlan): void {
    if (plan.selectedMachineCount === 0) return;
    const features = plan.candidates.map((candidate) => generatedFieldPivotZoneFeature(project, candidate));
    if (dispatchProjectWithResult({ type: "upsert_map_features", features })) {
      setSelectedMapFeatureId(features[0]?.id ?? null);
    }
  }

  function updateMapFeatureName(feature: ProjectMapFeature, name: string): void {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === feature.name) return;
    dispatchProject({ type: "update_map_feature", feature: { ...feature, name: trimmedName } });
  }

  function updateMapFeature(feature: ProjectMapFeature): void {
    dispatchProject({ type: "update_map_feature", feature });
  }

  function deleteMapFeature(featureId: string): void {
    dispatchProject({ type: "delete_map_feature", id: featureId });
    setSelectedMapFeatureId(null);
  }

  function activateGuidedMapTool(mode: DrawingMode, activeLayer: DrawingLayerType, featureKind?: ProjectMapFeatureKind, draftGeometry?: UtilityFeatureGeometry): void {
    invalidatePendingMapDraft();
    setManualDesignCaptureRequest(null);
    if (mode !== "pan") setWorkflowMode("design");
    setGuidedMapTool((current) => ({
      activeLayer,
      draftGeometry,
      featureKind,
      mode,
      requestId: (current?.requestId ?? 0) + 1,
    }));
  }

  function requestManualDesignMapCapture(role: ManualDesignMapCaptureRole | null): void {
    if (!role) {
      activateGuidedMapTool("pan", "field_boundary");
      return;
    }
    activateGuidedMapTool(role === "boundary" ? "draw_boundary" : "place_pivot", role === "boundary" ? "field_boundary" : "pivot_center");
    setManualDesignCaptureRequest({ role, requestId: Date.now() });
    setActiveSidebarPage("tools");
    setRightDrawerOpen(true);
    setActiveView("map");
  }

  function captureManualDesignMapInput(capture: ManualDesignMapCapture): void {
    setManualDesignMapCapture((current) => ({ ...capture, sequence: (current?.sequence ?? 0) + 1 }));
  }

  function activateDesignConsoleTool(mode: DrawingMode, activeLayer: DrawingLayerType, featureKind?: ProjectMapFeatureKind): void {
    activateGuidedMapTool(mode, activeLayer, featureKind);
    setSelectedMapFeatureId(null);
    setDesignConsoleModal(null);
    if (sidebarInlineWorkflow && mode !== "pan") setActiveSidebarPage("tools");
    setActiveView("map");
  }

  function activatePrimitiveMapTool(geometry: UtilityFeatureGeometry): void {
    activateGuidedMapTool("measure", "control_point", undefined, geometry);
    setSelectedMapFeatureId(null);
    setDesignConsoleModal(null);
    if (sidebarInlineWorkflow) setActiveSidebarPage("tools");
    setActiveView("map");
  }

  function openDesignConsolePanel(modal: DesignConsoleModal): void {
    setDesignConsoleModal(modal);
    if (modal && modal !== "calculate" && sidebarInlineWorkflow) {
      setActiveSidebarPage(modal === "layers" ? "layers" : "toolForm");
      setRightDrawerOpen(true);
      setActiveView("map");
    }
  }

  function toggleLayersPanel(): void {
    if (sidebarInlineWorkflow) {
      setDesignConsoleModal(null);
      setActiveSidebarPage("layers");
      setRightDrawerOpen(true);
      setActiveView("map");
      return;
    }
    setDesignConsoleModal((current) => current === "layers" ? null : "layers");
  }

  function calculateAndOpenPanel(): void {
    calculateDesignScenarios();
    setDesignConsoleModal("calculate");
  }

  function routeToClientSelection(): void {
    showCatalogMap(
      { clientId: activeCatalogContext.clientId, projectId: null, fieldMapId: null, designId: null },
      "Select or create a customer, then use New Project for that customer.",
    );
  }

  function openCatalogDialog(mode: ProjectCatalogDialogMode): void {
    if (catalogDialogSubmitting) return;
    if (mode === "client") {
      openClientCreateDialog();
      return;
    }
    if (mode === "project" && !selectedClient) {
      routeToClientSelection();
      return;
    }
    if (!beginCatalogForm()) return;
    setCatalogDialogDefaultName(defaultCatalogDialogName(mode));
    setCatalogDialogMode(mode);
    openCatalogFormSidebar();
  }

  function openClientCreateDialog(): void {
    if (!beginCatalogForm()) return;
    setCatalogNotice(null);
    setEditingClientId(null);
    setClientProfileDialogMode("create");
    openCatalogFormSidebar();
  }

  function openClientEditDialog(clientId: string): void {
    if (!beginCatalogForm()) return;
    setCatalogNotice(null);
    setEditingClientId(clientId);
    setClientProfileDialogMode("edit");
    openCatalogFormSidebar();
  }

  const catalogOwnerTask = useRef<PrimaryTask>(primaryTask);
  const catalogLauncher = useRef<HTMLElement | null>(null);
  function beginCatalogForm(): boolean {
    if (catalogDialogSubmitting) return false;
    catalogOwnerTask.current = primaryTask;
    if (Platform.OS === "web") catalogLauncher.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    projectOpenRequests.invalidate();
    invalidateCatalogForm();
    repository.clearCatalogError();
    setCatalogRefreshMessage(null);
    catalogFormRef.current = { revision: repository.catalogRevision, catalog: repository.catalog, projects: repository.projects,
      context: { ...activeCatalogContext }, clientDefaultName: "" };
    return true;
  }

  function openCatalogFormSidebar(): void {
    if (!inlineCatalogForms) return;
    setActiveSidebarPage("catalogForm");
    setRightDrawerOpen(true);
    setActiveView("map");
  }

  function openProjectRenameForm(projectId: string): void {
    if (!beginCatalogForm()) return;
    setRenamingProjectId(projectId);
    openCatalogFormSidebar();
  }

  function openProjectMoveForm(projectId: string): void {
    if (!beginCatalogForm()) return;
    setMovingProjectId(projectId);
    openCatalogFormSidebar();
  }

  function openProjectDeleteForm(projectId: string): void {
    if (!beginCatalogForm()) return;
    setDeletingProjectId(projectId);
    openCatalogFormSidebar();
  }

  function openClientDeleteForm(clientId: string): void {
    if (!beginCatalogForm()) return;
    setDeletingClientId(clientId);
    openCatalogFormSidebar();
  }

  function closeInlineCatalogForm(): void {
    catalogFormRef.current = null;
    if (inlineCatalogForms) setActiveSidebarPage(homeMapView ? "catalog" : "tools");
    if (Platform.OS === "web") requestAnimationFrame(() => {
      const launcher = catalogLauncher.current;
      if (launcher?.isConnected && launcher.getClientRects().length) launcher.focus();
    });
  }

  function invalidateCatalogForm(): void {
    catalogFormRef.current = null;
    setCatalogDialogMode(null);
    setClientProfileDialogMode(null);
    setEditingClientId(null);
    setRenamingProjectId(null);
    setMovingProjectId(null);
    setDeletingProjectId(null);
    setDeletingClientId(null);
    setCatalogDialogSubmitting(false);
  }

  async function submitCatalogDialog(name: string, initialFieldName?: string): Promise<void> {
    if (!catalogDialogMode || catalogDialogSubmitting) return;
    const session = catalogFormRef.current;
    setCatalogDialogSubmitting(true);
    try {
      if (catalogDialogMode === "project") await createProjectFolder(name, initialFieldName);
      if (catalogDialogMode === "fieldMap") await createFieldMapForProject(name);
      if (catalogDialogMode === "design") await createDesignForFieldMap(name);
    } finally {
      if (catalogFormRef.current === session) setCatalogDialogSubmitting(false);
    }
  }

  async function reviewCatalogFormContext(): Promise<void> {
    const session = catalogFormRef.current;
    if (!session || catalogDialogSubmitting || !projectRepository.versionedWorkspace) return;
    setCatalogDialogSubmitting(true); setCatalogRefreshMessage(null);
    try {
      if (movingProjectId || deletingProjectId || deletingClientId) throw new Error("Cancel this action and review the latest saved folder before moving or deleting it. No entered customer or project details will be changed.");
      const current = await projectRepository.versionedWorkspace.readAsync();
      if (catalogFormRef.current !== session) return;
      const context = clientProfileDialogMode === "create" ? { clientId: null, projectId: null, fieldMapId: null }
        : clientProfileDialogMode === "edit" ? { clientId: editingClientId, projectId: null, fieldMapId: null }
        : catalogDialogMode === "project" ? { ...session.context, projectId: null, fieldMapId: null }
        : catalogDialogMode === "fieldMap" ? { ...session.context, fieldMapId: null } : session.context;
      assertCatalogFormContextUnchanged(session.catalog, current.catalog, context, editingClientId, renamingProjectId);
      session.revision = current.revision;
      await repository.refreshProjects();
      if (catalogFormRef.current === session) setCatalogRefreshMessage("Saved context checked. Your entries are unchanged; use the save button to retry.");
    } catch (error) {
      if (catalogFormRef.current === session) setCatalogRefreshMessage(error instanceof Error ? error.message : String(error));
    } finally { if (catalogFormRef.current === session) setCatalogDialogSubmitting(false); }
  }

  function closeCatalogDialog(): void {
    if (catalogDialogSubmitting) return;
    setCatalogDialogMode(null);
    closeInlineCatalogForm();
  }

  function defaultCatalogDialogName(mode: ProjectCatalogDialogMode): string {
    if (mode === "client") return `Customer ${repository.catalog.clients.length + 1}`;
    if (mode === "project") return `Untitled Project ${repository.catalog.projects.length + 1}`;
    if (mode === "fieldMap") {
      const projectId = activeCatalogContext.projectId;
      const siblingCount = repository.catalog.fieldMaps.filter((record) => record.projectId === projectId).length;
      return `Field ${siblingCount + 1}`;
    }
    const fieldMapId = activeCatalogContext.fieldMapId;
    const siblingCount = (repository.designCatalog?.designs ?? repository.catalog.designs).filter((record) => record.fieldMapId === fieldMapId).length;
    return `Design ${siblingCount + 1}`;
  }

  function catalogDialogContextPreview(mode: ProjectCatalogDialogMode): string {
    const context = catalogFormRef.current?.context ?? activeCatalogContext;
    const catalog = catalogFormRef.current?.catalog ?? repository.catalog;
    if (mode === "client") return "Saved under: Project Catalog";
    if (mode === "project") {
      const client = catalog.clients.find(item => item.id === context.clientId);
      return client ? `Saved under: ${client.displayName}` : "Select a customer before creating a project.";
    }
    if (mode === "fieldMap") {
      const projectRecord = context.projectId
        ? catalog.projects.find((record) => record.id === context.projectId) ?? null
        : null;
      return formatCatalogPath(projectRecord ? catalogPathForProject(projectRecord.id, catalog) : []);
    }
    const fieldMap = context.fieldMapId
      ? catalog.fieldMaps.find((record) => record.id === context.fieldMapId) ?? null
      : null;
    return formatCatalogPath(fieldMap ? [...catalogPathForProject(fieldMap.projectId, catalog), fieldMap.name] : []);
  }

  function catalogPathForProject(projectId: string, catalog = repository.catalog): string[] {
    const projectRecord = catalog.projects.find((record) => record.id === projectId) ?? null;
    const client = projectRecord
      ? catalog.clients.find((record) => record.id === projectRecord.clientId) ?? null
      : null;
    return [client?.displayName, projectRecord?.name].filter((part): part is string => Boolean(part));
  }

  function formatCatalogPath(parts: string[]): string {
    return `Saved under: ${parts.length > 0 ? parts.join(" > ") : "Project Catalog"}`;
  }

  async function submitClientProfile(value: ClientProfileDialogValue): Promise<void> {
    if (!clientProfileDialogMode || catalogDialogSubmitting) return;
    const session = catalogFormRef.current;
    if (!session) return;
    setCatalogDialogSubmitting(true);
    try {
      if (clientProfileDialogMode === "create") {
        const client = await repository.createClient(value, session.revision);
        if (client && catalogFormRef.current === session) {
          showCatalogMap({ clientId: client.id, projectId: null, fieldMapId: null, designId: null });
        }
      } else if (editingClientId) {
        const client = await repository.updateClient({ id: editingClientId, ...value }, session.revision);
        if (client && catalogFormRef.current === session) {
          setCatalogNotice(null);
          invalidateCatalogForm();
          closeInlineCatalogForm();
        }
      }
    } finally {
      if (catalogFormRef.current === session) setCatalogDialogSubmitting(false);
    }
  }

  function closeClientProfileDialog(): void {
    if (catalogDialogSubmitting) return;
    setClientProfileDialogMode(null);
    setEditingClientId(null);
    closeInlineCatalogForm();
  }

  async function createProjectFolder(name: string, initialFieldName = "Field 1"): Promise<void> {
    const session = catalogFormRef.current;
    if (!session) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const client = session.catalog.clients.find(record => record.id === session.context.clientId);
    if (!client) {
      routeToClientSelection();
      return;
    }
    const createdAt = new Date().toISOString();
    const projectId = `project-${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
    const fieldMapId = `${projectId}:field-map:primary`;
    const created = await repository.createProjectWithInitialFieldMap({
      clientId: client.id,
      projectId,
      projectName: trimmedName,
      projectCrs: "",
      unitSystem: settings.unitSystem,
      fieldMapId,
      fieldMapName: initialFieldName.trim() || "Field 1",
    }, session.revision);
    if (created && catalogFormRef.current === session) {
      showCatalogMap({
        clientId: client.id,
        projectId: created.projectRecord.id,
        fieldMapId: created.fieldMap.id,
        designId: null,
      });
    }
  }

  async function createFieldMapForProject(name: string, projectId = activeCatalogContext.projectId): Promise<void> {
    const session = catalogFormRef.current;
    if (!session) return;
    projectId = session.context.projectId;
    const fieldName = name.trim();
    if (!fieldName) return;
    const projectRecord = projectId ? session.catalog.projects.find((record) => record.id === projectId) ?? null : null;
    if (!projectRecord) return;
    const createdAt = new Date().toISOString();
    const fieldMapId = `${projectRecord.id}:field-map:${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
    const fieldMap = await repository.createFieldMapRecord({ id: fieldMapId, projectId: projectRecord.id, name: fieldName }, session.revision);
    if (fieldMap && catalogFormRef.current === session) {
      showCatalogMap({
        clientId: projectRecord.clientId,
        projectId: projectRecord.id,
        fieldMapId: fieldMap.id,
        designId: null,
      });
    }
  }

  async function createDesignForFieldMap(name: string, fieldMapId = activeCatalogContext.fieldMapId): Promise<void> {
    const expectedGeneration = getEditorGeneration();
    const session = catalogFormRef.current;
    if (!session) return;
    const designName = name.trim();
    if (!designName) return;
    fieldMapId = session.context.fieldMapId;
    const fieldMap = fieldMapId ? session.catalog.fieldMaps.find((record) => record.id === fieldMapId) ?? null : null;
    if (!fieldMap) return;
    const folderUnits = session.catalog.projects.find((record) => record.id === fieldMap.projectId)?.unitSystem;
    if (folderUnits !== "metric" && folderUnits !== "us_survey_feet") {
      repository.reportError(new Error("The selected project has no valid unit system. Repair its catalog record before creating a design draft."));
      return;
    }
    if (!repository.canSaveDraft) {
      repository.reportError(new Error("Draft saving is not available on this storage backend yet."));
      return;
    }
    if (session.revision === null) return;
    const hidCatalogDialog = hasUnsavedProjectWork();
    if (hidCatalogDialog) {
      setCatalogDialogDefaultName(designName);
      setCatalogDialogMode(null);
      const confirmed = await new Promise<boolean>(resolve => onRequestDiscard(() => resolve(true), () => {
        restoreRetainedProjectView();
        resolve(false);
      }));
      if (!confirmed) return;
    }
    if (!saveOwnerMountedRef.current || catalogFormRef.current !== session) return;
    const departureIsCurrent = projectOpenRequests.completionIsCurrent();
    const source = saveCoordinator.receipt(projectSaveSessionRef.current);
    try {
      const created = await saveCoordinator.writeAlongsideProject({
        session: projectSaveSessionRef.current, sourceId: source.payloadId,
        sourceStored: typeof source.workspaceRevision === "number", expectedRevision: session.revision,
        write: () => repository.createDesignDraft({ fieldMapId: fieldMap.id,
          draft: newDesignDraft(createCatalogId("draft"), designName, folderUnits) }, session.revision,
        { isCurrent: () => saveOwnerMountedRef.current && catalogFormRef.current === session }),
      });
      if (created && saveOwnerMountedRef.current && catalogFormRef.current === session) {
        invalidateCatalogForm();
        if (departureIsCurrent()) await openRetainedWorkspace(() => onOpenDraft(created, expectedGeneration));
        else restoreRetainedProjectView();
      }
    } catch (error) {
      if (saveOwnerMountedRef.current && catalogFormRef.current === session) repository.reportError(error);
    } finally {
      if (hidCatalogDialog && saveOwnerMountedRef.current && catalogFormRef.current === session) setCatalogDialogMode("design");
    }
  }

  function hasUnsavedProjectWork(): boolean {
    if (retainedEditorContext) return false; // The root checks the actual retained editor before replacement.
    return unfinishedControllerDrawing.current || inputRetention.hasDirty() || pendingMapDraftSession.getSnapshot() !== null
      || ((projectLoadSequenceRef.current > 0 || editorRef.current.revision > 0)
        && editorRef.current.revision !== savedRevision);
  }

  function restoreRetainedProjectView(): void {
    if (!saveOwnerMountedRef.current) return;
    onTaskChange("design");
    projectOpenRequests.invalidate();
    invalidateCatalogForm();
    const target = saveCoordinator.receipt(projectSaveSessionRef.current);
    const design = repository.catalog.designs.find(item => item.id === target.designId);
    const field = repository.catalog.fieldMaps.find(item => item.id === design?.fieldMapId);
    const folder = repository.catalog.projects.find(item => item.id === field?.projectId);
    setActiveCatalogContext({ clientId: folder?.clientId ?? null, projectId: folder?.id ?? null,
      fieldMapId: field?.id ?? null, designId: design?.id ?? null });
    setHomeMapView(false);
    setActiveView("map");
    setActiveSidebarPage(pendingMapDraftState ? "purpose" : settings.mappingWorkflowMode === "layout" ? "overview" : "tools");
  }

  async function openFieldMap(fieldMapId: string): Promise<void> {
    const designs = repository.designCatalog?.designs ?? repository.catalog.designs;
    const design = designs.find((record) => record.fieldMapId === fieldMapId && record.isActive)
      ?? designs.find((record) => record.fieldMapId === fieldMapId)
      ?? null;
    if (design) await openDesignProject(design.id);
    else selectFieldMapCatalogOnly(fieldMapId);
  }

  async function renameProjectFolder(projectId: string, name: string): Promise<void> {
    if (catalogDialogSubmitting) return;
    const session = catalogFormRef.current;
    if (!session) return;
    setCatalogDialogSubmitting(true);
    try {
      const updatedProjectRecord = await repository.renameProject(projectId, name, session.revision);
      if (!updatedProjectRecord || catalogFormRef.current !== session) return;
      setRenamingProjectId(null);
      closeInlineCatalogForm();
    } finally {
      if (catalogFormRef.current === session || catalogFormRef.current === null) setCatalogDialogSubmitting(false);
    }
  }

  async function moveProjectFolder(projectId: string, clientId: string): Promise<void> {
    if (catalogDialogSubmitting) return;
    const session = catalogFormRef.current;
    if (!session) return;
    setCatalogDialogSubmitting(true);
    try {
      const moved = await repository.moveProjectToClient(projectId, clientId, session.revision);
      if (!moved || catalogFormRef.current !== session) return;
      setActiveCatalogContext((current) => current.projectId === projectId ? { ...current, clientId } : current);
      setMovingProjectId(null);
      closeInlineCatalogForm();
    } finally {
      if (catalogFormRef.current === session || catalogFormRef.current === null) setCatalogDialogSubmitting(false);
    }
  }

  async function confirmDeleteProject(): Promise<void> {
    if (!deletingProjectId || catalogDialogSubmitting) return;
    const session = catalogFormRef.current;
    if (!session) return;
    const projectId = deletingProjectId;
    setCatalogDialogSubmitting(true);
    try {
      const deleted = await repository.deleteProject(projectId, session.revision);
      if (deleted && catalogFormRef.current === session) {
        if (activeCatalogContext.projectId === projectId || project.id === projectId) {
          showCatalogMap({ clientId: activeCatalogContext.clientId, projectId: null, fieldMapId: null, designId: null });
        }
        setDeletingProjectId(null);
        closeInlineCatalogForm();
      }
    } finally {
      if (catalogFormRef.current === session || catalogFormRef.current === null) setCatalogDialogSubmitting(false);
    }
  }

  async function confirmDeleteClient(): Promise<void> {
    if (!deletingClientId || catalogDialogSubmitting) return;
    const session = catalogFormRef.current;
    if (!session) return;
    const clientId = deletingClientId;
    setCatalogDialogSubmitting(true);
    try {
      const deleted = await repository.deleteClient(clientId, session.revision);
      if (deleted && catalogFormRef.current === session) {
        if (activeCatalogContext.clientId === clientId) {
          setActiveCatalogContext({ clientId: null, projectId: null, fieldMapId: null, designId: null });
        }
        setDeletingClientId(null);
        closeInlineCatalogForm();
      }
    } finally {
      if (catalogFormRef.current === session || catalogFormRef.current === null) setCatalogDialogSubmitting(false);
    }
  }

  function selectClientFolder(clientId: string): void {
    showCatalogMap({ clientId, projectId: null, fieldMapId: null, designId: null });
  }

  function openClientDetails(clientId: string): void {
    if (!repository.catalog.clients.some(client => client.id === clientId)) return;
    const foregroundNavigation = windowWidth < 700
      || (landscapeConsole && windowHeight < 500 && windowWidth < 1180);
    if (activeCatalogForm || catalogDialogSubmitting) {
      setCatalogNotice("Finish or cancel the open customer or project form before opening another customer.");
      if (foregroundNavigation) setLeftDrawerOpen(false);
      setRightDrawerOpen(true);
      return;
    }
    selectClientFolder(clientId);
    if (foregroundNavigation) setLeftDrawerOpen(false);
    setRightDrawerOpen(true);
  }

  function selectProjectCatalogOnly(projectId: string): void {
    const record = repository.catalog.projects.find((candidate) => candidate.id === projectId) ?? null;
    showCatalogMap({
      clientId: record?.clientId ?? activeCatalogContext.clientId,
      projectId,
      fieldMapId: null,
      designId: null,
    });
  }

  function selectFieldMapCatalogOnly(fieldMapId: string): void {
    const fieldMap = repository.catalog.fieldMaps.find((record) => record.id === fieldMapId) ?? null;
    const projectRecord = fieldMap
      ? repository.catalog.projects.find((record) => record.id === fieldMap.projectId) ?? null
      : null;
    showCatalogMap(
      {
        clientId: projectRecord?.clientId ?? activeCatalogContext.clientId,
        projectId: fieldMap?.projectId ?? activeCatalogContext.projectId,
        fieldMapId,
        designId: null,
      },
      fieldMap ? `${fieldMap.name} has ${repository.catalog.designs.filter((record) => record.fieldMapId === fieldMap.id).length} designs.` : null,
    );
  }

  function selectDesignCatalogOnly(designId: string): void {
    const design = (repository.designCatalog?.designs ?? repository.catalog.designs).find((record) => record.id === designId) ?? null;
    const fieldMap = design ? repository.catalog.fieldMaps.find((record) => record.id === design.fieldMapId) ?? null : null;
    const projectRecord = fieldMap
      ? repository.catalog.projects.find((record) => record.id === fieldMap.projectId) ?? null
      : null;
    showCatalogMap(
      {
        clientId: projectRecord?.clientId ?? activeCatalogContext.clientId,
        projectId: projectRecord?.id ?? activeCatalogContext.projectId,
        fieldMapId: fieldMap?.id ?? activeCatalogContext.fieldMapId,
        designId,
      },
      design ? `${design.name} is stored under ${fieldMap?.name ?? "this project"}.` : null,
    );
  }

  function showCatalogMap(context: Partial<typeof activeCatalogContext>, notice: string | null = null): void {
    onTaskChange("projects");
    pendingMapScopeRef.current = { ...pendingMapScopeRef.current, editable: false, suspended: true };
    invalidateCatalogForm();
    projectOpenRequests.invalidate();
    setScreen("workspace");
    setActiveView("map");
    setHomeMapView(true);
    setCatalogNotice(notice);
    setActiveSidebarPage("catalog");
    setActiveCatalogContext((current) => ({ ...current, ...context }));
  }

  function updateWalkthrough(moduleId: WalkthroughModuleId, complete: boolean): void {
    setWalkthroughProgress((current) => {
      const next = { ...current, [moduleId]: complete };
      saveWalkthroughProgress(project.id, next);
      return next;
    });
  }

  function resetWalkthrough(): void {
    const next = emptyWalkthroughProgress();
    saveWalkthroughProgress(project.id, next);
    setWalkthroughProgress(next);
  }

  const importNotice = projectImportStatus?.generation === projectGeneration
    ? <ProjectImportStatus kind={projectImportStatus.kind} /> : null;
  const storageNotice = <>
    <WorkspaceStorageNotice repository={repository} />
    {activeCatalogForm && projectRepository.versionedWorkspace ? <View style={{ gap: 6 }}>
      {catalogRefreshMessage ? <Text accessibilityLiveRegion="polite" style={styles.mapFeatureMeta} testID="catalog-context-review-result">{catalogRefreshMessage}</Text> : null}
      <SmallActionButton label="Review latest saved context" disabled={catalogDialogSubmitting} onPress={() => { void reviewCatalogFormContext(); }} testID="catalog-review-context" />
    </View> : null}
  </>;

  // All hooks stay mounted across CRS transitions; no calculated view mounts without a result.
  if (calculation.result === null) {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
        <StatusBar style="dark" />
        {activeCatalogForm ? null : storageNotice}
        {importNotice}
        <ProjectCrsRecoveryPanel
          key={`${projectGeneration}:${project.id}:${project.projectCrs}`}
          project={project}
          reasons={calculation.reasons}
          dirty={isDirty}
          canUndo={editor.past.length > 0}
          canRedo={editor.future.length > 0}
          onUndo={() => dispatchProject({ type: "undo" })}
          onRedo={() => dispatchProject({ type: "redo" })}
          onSave={saveCurrentProject}
          copyAction={<ProjectCopyButton project={project} sourceStored={typeof saveCoordinator.receipt(projectSaveSession).workspaceRevision === "number"} repository={repository} onCopy={saveProjectCopy} />}
          storageStatus={repository.statusMessage}
          projects={repository.projects}
          onOpenProject={openSavedProject}
          onProjectLoaded={loadIndependentProject}
          onOpenSample={() => loadProjectDashboard(sampleProject, { clientId: null, projectId: null, fieldMapId: null, designId: null })}
        />
      </SafeAreaView>
    );
  }
  const result = calculation.result;

  if (screen === "projects") {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea} testID="launcher-screen">
        <AndroidNativeProofRunner enabled={androidNativeProofEnabled} />
        <StatusBar style="dark" />
        {activeCatalogForm ? null : storageNotice}
        <View style={[styles.app, { paddingBottom: safeBottomGutter }]}>
          <View style={styles.topBar}>
            <View>
              <Text style={styles.appTitle}>CPLayout</Text>
              <Text style={styles.appSubtitle}>Your field design workspace</Text>
            </View>
            <View style={[styles.statusRow, compactLayout && styles.statusRowCompact]}>
              <StatusPill icon={<WifiOff size={15} color="#254234" />} label="Offline storage" />
              <StatusPill icon={<Ruler size={15} color="#254234" />} label="Field coordinates" />
              <StatusPill icon={<Satellite size={15} color="#254234" />} label={settings.onlineImagery.enabled ? "USGS imagery ready" : "Imagery off"} />
            </View>
          </View>
          <ScrollView contentContainerStyle={[styles.content, compactLayout && styles.contentCompact]}>
            <ProjectDashboard
              compact={compactLayout}
              dirty={isDirty}
              mode="launcher"
              onCreate={routeToClientSelection}
              onOpenFiles={() => {
                setScreen("workspace");
                setActiveView("files");
              }}
              onOpenImprovedProof={() => loadProjectDashboard(improvedCenterPivotProofProject)}
              onInspectMap={() => {
                setWorkflowMode("layout");
                setScreen("workspace");
                setActiveView("map");
              }}
              onOpenMap={() => {
                setScreen("workspace");
                setActiveView("map");
              }}
              onOpenProject={openSavedProject}
              onOpenRealProof={() => loadProjectDashboard(realCenterPivotProofProject)}
              onOpenSample={() => loadProjectDashboard(defaultDevelopmentProject)}
              project={project}
              repository={repository}
              result={result}
              settings={settings}
              walkthroughProgress={walkthroughProgress}
              onResetWalkthrough={resetWalkthrough}
              onToggleWalkthrough={updateWalkthrough}
            />
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  function formatProjectCoordinate(point: XY): string {
    try {
      return formatCoordinate({ projected: point, projectCrs: project.projectCrs }, settings.coordinateDisplayFormat);
    } catch {
      return formatCoordinate({ projected: point, projectCrs: project.projectCrs }, "projected_local");
    }
  }

  function renderRightWorkflowSidebarContent(page: RightWorkflowSidebarPage): React.JSX.Element {
    if (page === "catalog") {
      return selectedClient ? (
        <ClientDetailPanel
          activeProjectId={activeCatalogContext.projectId}
          catalog={repository.catalog}
          client={selectedClient}
          notice={catalogNotice}
          onCreateProject={() => openCatalogDialog("project")}
          onDeleteClient={openClientDeleteForm}
          onDeleteProject={openProjectDeleteForm}
          onEditClient={openClientEditDialog}
          onMoveProject={openProjectMoveForm}
          onOpenProject={selectProjectCatalogOnly}
          onRenameProject={openProjectRenameForm}
          onSelectProject={(projectId) => {
            projectOpenRequests.invalidate();
            const record = repository.catalog.projects.find((candidate) => candidate.id === projectId) ?? null;
            setActiveCatalogContext({
              clientId: record?.clientId ?? selectedClient.id,
              projectId,
              fieldMapId: null,
              designId: null,
            });
          }}
        />
      ) : (
        <CatalogHomePanel
          onImport={openArchiveWorkspace}
          onPreferences={() => setActiveView("settings")}
          onOpenDesign={openDesignProject}
          catalog={repository.catalog}
          notice={catalogNotice}
          onCreateClient={openClientCreateDialog}
          onStartBlankDesign={startBlankDesign}
          repository={repository}
          settings={settings}
        />
      );
    }

    if (page === "catalogForm") {
      return renderCatalogInlineForm();
    }

    if (page === "overview") {
      return (
        <>
          <Text style={styles.sectionTitle}>Overview</Text>
          <View style={styles.metricGrid}>
            <MetricTile label="Irrigated" value={formatAreaFromAcres(result.metrics.irrigatedAcres, settings.unitSystem)} tone="good" />
            <MetricTile label="Dry / non-irrigated" value={formatAreaFromAcres(result.metrics.nonIrrigatedAcres, settings.unitSystem)} tone="warn" />
            <MetricTile label="Coverage" value={`${result.metrics.coveragePercent.toFixed(1)}%`} tone="neutral" />
            <MetricTile label="End gun" value={formatAreaFromAcres(result.metrics.endGunAcres, settings.unitSystem)} tone="neutral" />
            <MetricTile label="Outside field" value={formatAreaFromAcres(result.metrics.outsideFieldAcres, settings.unitSystem)} tone={result.metrics.outsideFieldAcres > 0 ? "danger" : "good"} />
            <MetricTile label="Obstacle hits" value={`${result.metrics.obstacleConflictCount}`} tone={result.metrics.obstacleConflictCount > 0 ? "danger" : "good"} />
            <MetricTile label="Hard path conflicts" value={`${result.metrics.hardMechanicalConflictCount}`} tone={result.metrics.hardMechanicalConflictCount > 0 ? "danger" : "good"} />
          </View>
          <View style={styles.mapFeatureEditor} testID="design-console-status">
            <Text style={styles.mapFeatureTitle}>Workflow Sidebar</Text>
            <Text style={styles.mapFeatureMeta}>Choose drawing and machine inputs in Design. Review coverage and warnings here, collect receiver positions in Survey, and work against a frozen target in RTK Layout.</Text>
          </View>
          {advisoryMachineRenderModel && advisoryMultiMachineReview ? <AdvisoryEvidenceStatusPanel
            advisoryMachineRenderModel={advisoryMachineRenderModel}
            multiMachineReview={advisoryMultiMachineReview}
            project={project}
            result={result}
            settings={settings}
            surface="overview"
          /> : <AdvisoryCalculationStatus message={advisoryStatus} failed={advisoryError} onRetry={retryAdvisory} />}
        </>
      );
    }

    if (page === "tools") {
      return (
        <>
          <Text style={styles.sectionTitle}>Tools</Text>
          <DrawingToolLauncher
            activeModal={designConsoleModal}
            activeTool={guidedMapTool}
            onActivateTool={activateDesignConsoleTool}
            onActivatePrimitive={activatePrimitiveMapTool}
            onCalculate={calculateAndOpenPanel}
            onOpenModal={openDesignConsolePanel}
            onToggleLayers={toggleLayersPanel}
            settings={settings}
            showGeometryTools={false}
            variant="sidebar"
          />
          {settings.mappingWorkflowMode === "design" ? (
            <ManualDesignTransactionPanel
              mapCapture={manualDesignMapCapture}
              onApply={(draft) => dispatchProjectWithResult({ type: "apply_manual_design", draft })}
              onRequestMapCapture={requestManualDesignMapCapture}
              onOpenRtk={() => navigateUtility("survey")}
              project={project}
              projectRevision={editor.revision}
              unitSystem={settings.unitSystem}
            />
          ) : null}
          <View style={styles.mapFeatureEditor} testID="sidebar-tool-hud-summary">
            <Text style={styles.mapFeatureTitle}>Map HUD</Text>
            <View style={styles.metricGrid}>
              <MetricTile label="Active" value={guidedMapTool?.mode.replaceAll("_", " ") ?? "Pan"} />
              <MetricTile label="Panel" value={designConsoleModal ? designConsoleCopy(designConsoleModal).title : "Closed"} />
            </View>
          </View>
          {settings.mappingWorkflowMode === "layout" ? (
            <View style={styles.mapFeatureEditor}>
              <Text style={styles.mapFeatureTitle}>Inspect map</Text>
              <Text style={styles.mapFeatureMeta}>Map clicks select and inspect. Choose Edit map to draw, or Survey to collect receiver positions. Form edits remain available.</Text>
            </View>
          ) : null}
        </>
      );
    }

    if (page === "purpose") {
      return (
        <>
          <PendingDraftPurposePanel
            draft={pendingMapFeatureDraft}
            retentionKey={pendingMapDraftState ? `purpose:${pendingMapDraftState.owner.projectGeneration}:${pendingMapDraftState.owner.draftId}` : "purpose:none"}
            projectCrs={project.projectCrs}
            error={pendingMapDraftState?.error ?? null}
            onCancel={() => { if (pendingMapDraftState) cancelPendingMapFeatureDraft(pendingMapDraftState.owner); }}
            onSave={(option, details) => { if (pendingMapDraftState) savePendingMapFeatureDraft(pendingMapDraftState.owner, option, details); }}
            unitSystem={settings.unitSystem}
          />
        </>
      );
    }

    if (page === "toolForm") {
      return designConsoleModal && designConsoleModal !== "calculate" ? (
        <View testID="design-console-panel">
          <DesignConsolePanel
            activeModal={designConsoleModal}
            cornerInputDraft={cornerInputDraft}
            onCornerInputDraftChange={updateCornerInputDraft}
            advisoryCostDraft={advisoryCostDraft}
            advisoryStatus={advisoryStatus}
            advisoryError={advisoryError}
            onRetryAdvisory={retryAdvisory}
            advisoryCostInput={advisoryCostInput}
            advisoryMachineRenderModel={advisoryMachineRenderModel}
            cornerArmEvaluation={cornerArmEvaluation}
            multiMachineReview={advisoryMultiMachineReview}
            editorError={editor.lastError}
            fieldPivotPlan={advisoryFieldPivotPlan}
            requestedFieldPivots={requestedFieldPivots}
            onRequestedFieldPivotsChange={updateRequestedFieldPivots}
            onActivatePrimitive={activatePrimitiveMapTool}
            onActivateTool={activateDesignConsoleTool}
            onApplyPivot={(point, wgs84) => dispatchProjectWithResult({ type: "place_pivot", point, wgs84 })}
            onCalculate={calculateDesignScenarios}
            onClose={() => {
              setDesignConsoleModal(null);
              setActiveSidebarPage("tools");
            }}
            onOpenModal={openDesignConsolePanel}
            onOpenFiles={() => {
              setDesignConsoleModal(null);
              setActiveView("files");
            }}
            onRequestApplyPivotCandidate={(candidate) => setPendingPlacementAction({ kind: "pivot", candidate })}
            onRequestSaveCornerArm={(config) => setPendingPlacementAction({ kind: "cornerArm", config })}
            onSaveGeneratedFieldPivotZones={saveGeneratedFieldPivotReviewZones}
            onUpdateAdvisoryCostDraft={setAdvisoryCostDraft}
            onSettingsChange={commitSettings}
            onUpdateMachine={(machine) => dispatchProjectWithResult({ type: "update_machine", machine })}
            idealCenterAnalysis={idealCenterAnalysis}
            placementCandidates={placementCandidates}
            preview={designScenarioPreview}
            project={runtimeProject}
            result={result}
            settings={settings}
            testID="design-console-dialog"
          />
        </View>
      ) : (
        <View style={styles.mapFeatureEditor}>
          <Text style={styles.mapFeatureTitle}>No active form</Text>
          <Text style={styles.mapFeatureMeta}>Choose Point, Line, Area, Coverage, Machine, or Calculate from Tools.</Text>
        </View>
      );
    }

    if (page === "layers") {
      return (
        <>
          <View style={styles.sidebarSectionHeader}>
            <Text style={styles.sectionTitle}>Layers</Text>
            <Pressable
              accessibilityLabel="Close design console dialog"
              accessibilityRole="button"
              onPress={() => setActiveSidebarPage(settings.mappingWorkflowMode === "design" ? "tools" : "overview")}
              style={styles.consoleCloseButton}
              testID="design-console-close"
            >
              <Text style={styles.consoleCloseText}>Close</Text>
            </Pressable>
          </View>
          <LayersSheet
            mapPackages={runtimeProject.mapPackages ?? []}
            onOpenFiles={() => {
              setDesignConsoleModal(null);
              setActiveView("files");
            }}
            onSettingsChange={commitSettings}
            project={runtimeProject}
            settings={settings}
          />
        </>
      );
    }

    if (page === "feature") {
      return (
        <>
          <Text style={styles.sectionTitle}>Feature</Text>
          <MapFeatureEditor
            feature={selectedMapFeature}
            unitSystem={settings.unitSystem}
            onDelete={deleteMapFeature}
            onRename={updateMapFeatureName}
            onUpdate={updateMapFeature}
          />
        </>
      );
    }

    return (
      <>
        <Text style={styles.sectionTitle}>Warnings</Text>
        <View style={styles.warningList}>
          {editor.lastError ? (
            <View style={styles.warningItem}>
              <AlertTriangle size={17} color="#9a4c1c" />
              <Text style={styles.warningText}>{editor.lastError}</Text>
            </View>
          ) : null}
          {result.warnings.length === 0 && !editor.lastError ? (
            <View style={styles.mapFeatureEditor}>
              <Text style={styles.mapFeatureTitle}>No active warnings</Text>
              <Text style={styles.mapFeatureMeta}>Layout validation warnings appear here without mutating geometry.</Text>
            </View>
          ) : null}
          {result.warnings.map((warning) => (
            <View key={warning} style={styles.warningItem}>
              <AlertTriangle size={17} color="#9a4c1c" />
              <Text style={styles.warningText}>{warning}</Text>
            </View>
          ))}
        </View>
      </>
    );
  }

  function renderCatalogInlineForm(): React.JSX.Element {
    if (catalogDialogMode) {
      return (
        <CatalogItemForm
          feedback={storageNotice}
          contextPreview={catalogDialogContextPreview(catalogDialogMode)}
          defaultName={catalogDialogDefaultName}
          defaultFieldName={catalogDialogMode === "project" ? "Field 1" : undefined}
          embedded
          mode={catalogDialogMode}
          onCancel={closeCatalogDialog}
          onCreate={submitCatalogDialog}
          submitting={catalogDialogSubmitting}
        />
      );
    }
    if (clientProfileDialogMode) {
      return (
        <ClientProfileForm
          feedback={storageNotice}
          defaultDisplayName={catalogFormRef.current?.clientDefaultName ?? "New customer"}
          embedded
          initialClient={clientProfileDialogMode === "edit" ? editingClient : null}
          mode={clientProfileDialogMode}
          onCancel={closeClientProfileDialog}
          onSave={submitClientProfile}
          submitting={catalogDialogSubmitting}
        />
      );
    }
    if (renamingProject) {
      return (
        <CatalogItemForm
          feedback={storageNotice}
          contextPreview={formatCatalogPath(catalogPathForProject(renamingProject.id))}
          createButtonLabel="Save changes"
          defaultName={renamingProject.name}
          embedded
          helper="Project folder name"
          mode="project"
          onCancel={() => {
            if (!catalogDialogSubmitting) {
              setRenamingProjectId(null);
              closeInlineCatalogForm();
            }
          }}
          onCreate={(name) => renameProjectFolder(renamingProject.id, name)}
          submitting={catalogDialogSubmitting}
          title="Rename Project"
        />
      );
    }
    if (movingProject) {
      return (
        <MoveProjectForm
          feedback={storageNotice}
          currentClientId={movingProject.clientId}
          clients={formCatalog.clients}
          embedded
          onCancel={() => {
            if (!catalogDialogSubmitting) {
              setMovingProjectId(null);
              closeInlineCatalogForm();
            }
          }}
          onMove={(clientId) => moveProjectFolder(movingProject.id, clientId)}
          projectName={movingProject.name}
          submitting={catalogDialogSubmitting}
        />
      );
    }
    if (deletingProject) {
      return (
        <ConfirmActionPanel
          feedback={storageNotice}
          confirmLabel="Delete Project"
          embedded
          message={`Delete ${deletingProject.name} and its contained field maps/designs from the local catalog. Project ZIP archives are not changed.`}
          onCancel={() => {
            if (!catalogDialogSubmitting) {
              setDeletingProjectId(null);
              closeInlineCatalogForm();
            }
          }}
          onConfirm={confirmDeleteProject}
          submitting={catalogDialogSubmitting}
          testID="delete-project-dialog"
          title="Delete Project"
        />
      );
    }
    if (deletingClient) {
      return (
        <ConfirmActionPanel
          feedback={storageNotice}
          confirmLabel="Delete Customer"
          embedded
          message={`Delete the empty customer ${deletingClient.displayName}. This is blocked automatically if any projects remain inside it.`}
          onCancel={() => {
            if (!catalogDialogSubmitting) {
              setDeletingClientId(null);
              closeInlineCatalogForm();
            }
          }}
          onConfirm={confirmDeleteClient}
          submitting={catalogDialogSubmitting}
          testID="delete-client-dialog"
          title="Delete Customer"
        />
      );
    }
    return (
      <View style={styles.mapFeatureEditor}>
        <Text style={styles.mapFeatureTitle}>No catalog form open</Text>
        <Text style={styles.mapFeatureMeta}>Use the catalog rail or customer details to create, rename, move, or delete local catalog records.</Text>
      </View>
    );
  }

  return (
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea} testID="workspace-screen">
      <AndroidNativeProofRunner enabled={androidNativeProofEnabled} />
      <StatusBar style="dark" />
      <View style={[styles.app, { paddingBottom: safeBottomGutter }]}>
        <WorkspaceTopToolbar compact={compactLayout} short={shortLandscapeMap} currentLabel={homeMapView ? "Project Catalog" : project.name}
          contextLabel={catalogContextPath} onOpenContext={compactMapContext ? () => setDesignContextOpen(true) : undefined}>
          <WorkspaceCommandSurface
            activeView={activeView}
            canRedo={editor.future.length > 0}
            canUndo={editor.past.length > 0}
            compactLayout={compactLayout}
            dirty={isDirty}
            homeMapView={homeMapView}
            leftDrawerOpen={leftDrawerOpen}
            onNavigate={navigateUtility}
            onOpenCatalog={openCatalogHome}
            onOpenFiles={() => navigateUtility("files")}
            onOpenSample={(nextProject) => loadProjectDashboard(nextProject)}
            onRedo={() => dispatchProject({ type: "redo" })}
            onResetWalkthrough={resetWalkthrough}
            onSave={saveCurrentProject}
            onCreateField={createIndependentField}
            onShowMetrics={() => {
              setActiveSidebarPage("overview");
              setRightDrawerOpen(true);
              setActiveView("map");
            }}
            onShowWarnings={() => {
              setActiveSidebarPage("warnings");
              setRightDrawerOpen(true);
              setActiveView("map");
            }}
            onStartBlankDesign={startBlankDesign}
            onToggleLeftDrawer={() => setLeftDrawerOpen((open) => !open)}
            onToggleRightDrawer={() => setRightDrawerOpen((open) => !open)}
            onUndo={() => dispatchProject({ type: "undo" })}
            rightDrawerOpen={rightDrawerOpen}
          />
        </WorkspaceTopToolbar>
        {!compactMapContext && <View style={styles.workflowContext} testID="workflow-context">
          <Text style={styles.mapFeatureMeta}>{catalogContextPath}</Text>
          <SmallActionButton label="Layout sessions" testID="open-layout-sessions" onPress={() => openLayoutWorkspace()} />
        </View>}
        {activeCatalogForm ? null : storageNotice}
        {!homeMapView ? importNotice : null}

        {!homeMapView && activeView === "map" && !compactMapContext ? <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 10, paddingVertical: 3 }}>
          <SmallActionButton label="Prepare for RTK Layout" onPress={() => setPrepareLayoutOpen(true)} testID="prepare-rtk-layout" />
        </View> : null}
        <View style={[styles.workspaceShell, !projectDrawerConsole && compactLayout && styles.workspaceShellCompact, projectDrawerConsole && styles.workspaceShellConsole]} testID="workspace-shell">
          <ProjectTreeRail
            activeContext={activeCatalogContext}
            activeView={activeView}
            catalog={repository.catalog}
            designCatalog={repository.designCatalog}
            compact={compactLayout}
            consoleMode={projectDrawerConsole}
            drawerOpen={projectDrawerConsole ? leftDrawerOpen : true}
            foreground={projectDrawerForeground}
            menuDefinition={leftNavMenuDefinition}
            onCreateClient={openClientCreateDialog}
            onCreateDesign={() => openCatalogDialog("design")}
            onCreateFieldMap={() => openCatalogDialog("fieldMap")}
            onCreateProject={() => openCatalogDialog("project")}
            onNavigate={navigateUtility}
            onOpenDesign={openDesignProject}
            onOpenClient={openClientDetails}
            onOpenFieldMap={openFieldMap}
            onOpenProject={(projectId) => {
              selectProjectCatalogOnly(projectId);
            }}
            onOpenSample={() => loadProjectDashboard(defaultDevelopmentProject, { clientId: null, projectId: null, fieldMapId: null, designId: null })}
            onStartBlankDesign={startBlankDesign}
            onSelectClient={selectClientFolder}
            onSelectDesign={selectDesignCatalogOnly}
            onSelectProject={selectProjectCatalogOnly}
            onSelectFieldMap={selectFieldMapCatalogOnly}
            onToggleDrawer={() => setLeftDrawerOpen((open) => !open)}
          />

          <ScrollView
            scrollEnabled={activeView !== "map" || windowWidth < 700}
            style={[styles.workspaceScroll, activeView === "map" && windowWidth >= 700 && styles.workspaceScrollConsole,
              projectDrawerForeground && { display: "none" }]}
            testID="workspace-main-content"
            contentContainerStyle={activeView === "map" ? styles.contentConsole : [styles.content, styles.contentWithAndroidReviewInset, compactLayout && styles.contentCompact]}
          >
          {activeView === "dashboard" && (homeMapView ? (
            <Section title="Project Catalog" icon={<Home size={20} color="#254234" />} testID="dashboard-workspace">
              <CatalogHomePanel
          onImport={openArchiveWorkspace}
          onPreferences={() => setActiveView("settings")}
          onOpenDesign={openDesignProject}
                catalog={repository.catalog}
                notice={catalogNotice}
                onCreateClient={openClientCreateDialog}
                onStartBlankDesign={startBlankDesign}
                repository={repository}
                settings={settings}
              />
            </Section>
          ) : (
            <ProjectDashboard
              compact={compactLayout}
              dirty={isDirty}
              mode="workspace"
              onCreate={routeToClientSelection}
              onOpenFiles={() => navigateUtility("files")}
              onOpenImprovedProof={() => loadProjectDashboard(improvedCenterPivotProofProject)}
              onInspectMap={() => {
                setWorkflowMode("layout");
                setActiveView("map");
              }}
              onOpenMap={() => setActiveView("map")}
              onOpenProject={openSavedProject}
              onOpenRealProof={() => loadProjectDashboard(realCenterPivotProofProject)}
              onOpenSample={() => loadProjectDashboard(defaultDevelopmentProject)}
              project={project}
              repository={repository}
              result={result}
              settings={settings}
              walkthroughProgress={walkthroughProgress}
              onResetWalkthrough={resetWalkthrough}
              onToggleWalkthrough={updateWalkthrough}
            />
          ))}

          <View style={{ display: activeView === "map" ? "flex" : "none", flex: activeView === "map" ? 1 : undefined }}>
            <WorkspaceConsoleShell compact={compactMapSidebar} short={shortLandscapeMap} rightDrawerOpen={nativeMapLibreProofEnabled ? false : rightDrawerOpen} testID="map-view">
              <View style={styles.mapConsoleFrame}>
                <AdvisoryCalculationStatus
                  message={!homeMapView && (advisoryError || !advisoryFieldPivotPlan || !advisoryMachineRenderModel) ? advisoryStatus : ""}
                  failed={!homeMapView && advisoryError}
                  onRetry={retryAdvisory}
                  testID="advisory-map-job-status"
                />
                <MapSurface
                  activeLayer={guidedMapTool?.activeLayer}
                  activeDraftGeometry={guidedMapTool?.draftGeometry}
                  activeMapFeatureKind={guidedMapTool?.featureKind}
                  activeToolMode={guidedMapTool?.mode}
                  activeToolRequestId={guidedMapTool?.requestId}
                  advisoryFieldPivotPlan={!homeMapView ? advisoryFieldPivotPlan ?? undefined : undefined}
                  advisoryMachineRenderModel={!homeMapView ? advisoryMachineRenderModel ?? undefined : undefined}
                  controlLayout="externalHud"
                  bottomOverlay={!homeMapView && !nativeMapLibreProofEnabled ? (
                    <DesignActionHud
                      activeModal={designConsoleModal}
                      activeTool={guidedMapTool}
                      onActivateTool={activateDesignConsoleTool}
                      onActivatePrimitive={activatePrimitiveMapTool}
                      onCalculate={calculateAndOpenPanel}
                      onOpenModal={openDesignConsolePanel}
                      onToggleLayers={toggleLayersPanel}
                      onOpenReceiver={() => navigateUtility("survey")}
                      settings={settings}
                    />
                  ) : null}
                  // Reuse the map's existing suspension boundary; hidden tasks retain draft ownership and camera.
                  homeView={homeMapView || !visible || activeView !== "map"}
                  project={runtimeProject}
                  projectGeneration={projectLoadSequenceRef.current}
                  draftPurposeReceipt={draftPurposeReceipt}
                  result={result}
                  settings={settings}
                  selectedMapFeatureId={selectedMapFeatureId}
                  manualDesignCaptureRequest={manualDesignCaptureRequest}
                  onSettingsChange={commitSettings}
                  onMappingWorkflowModeChange={setWorkflowMode}
                  onCommitBoundaryDraft={(vertices) => dispatchProjectWithResult({ type: "commit_boundary_draft", vertices })}
                  onCommitObstacleDraft={(vertices, kind, confidence) => dispatchProjectWithResult({ type: "commit_obstacle_draft", vertices, kind, confidence })}
                  onMoveBoundaryVertex={(vertexIndex, point) => dispatchProjectTransaction({ type: "move_boundary_vertex", vertexIndex, point })}
                  onInsertBoundaryVertex={(afterVertexIndex, point) => dispatchProjectTransaction({ type: "insert_boundary_vertex", afterVertexIndex, point })}
                  onDeleteBoundaryVertex={(vertexIndex) => dispatchProjectTransaction({ type: "delete_boundary_vertex", vertexIndex })}
                  onMoveObstacleVertex={(obstacleId, vertexIndex, point) => dispatchProjectTransaction({ type: "move_obstacle_vertex", obstacleId, vertexIndex, point })}
                  onInsertObstacleVertex={(obstacleId, afterVertexIndex, point) => dispatchProjectTransaction({ type: "insert_obstacle_vertex", obstacleId, afterVertexIndex, point })}
                  onDeleteObstacleVertex={(obstacleId, vertexIndex) => dispatchProjectTransaction({ type: "delete_obstacle_vertex", obstacleId, vertexIndex })}
                  onMoveMapFeatureVertex={(featureId, vertexIndex, point) => dispatchProjectTransaction({ type: "move_map_feature_vertex", featureId, vertexIndex, point })}
                  onInsertMapFeatureVertex={(featureId, afterVertexIndex, point) => dispatchProjectTransaction({ type: "insert_map_feature_vertex", afterVertexIndex, featureId, point })}
                  onDeleteMapFeatureVertex={(featureId, vertexIndex) => dispatchProjectTransaction({ type: "delete_map_feature_vertex", featureId, vertexIndex })}
                  onMoveMapFeatureCircleRadiusHandle={(featureId, point) => dispatchProjectTransaction({ type: "move_map_feature_circle_radius_handle", featureId, point })}
                  onPlacePivot={(point, wgs84) => dispatchProjectTransaction({ type: "place_pivot", point, wgs84 })}
                  onMoveInfrastructurePoint={(pointType, point, wgs84) => dispatchProjectTransaction({ type: "move_infrastructure", pointType, point, wgs84 })}
                  onAddSurveyPoint={(point) => dispatchProjectTransaction({ type: "add_survey_point", point })}
                  onAddMapFeature={addMapFeature}
                  onCreateMapFeatureDraft={createPendingMapFeatureDraft}
                  onUnfinishedDrawingChange={onUnfinishedDrawingChange}
                  onSelectMapFeature={setSelectedMapFeatureId}
                  onManualDesignCapture={captureManualDesignMapInput}
                  />
              </View>
              {nativeMapLibreProofEnabled ? null : (
                <RightWorkflowSidebar
                  activePage={effectiveSidebarPage}
                  purposeRejectionSequence={draftPurposeReceipt?.outcome === "rejected" ? draftPurposeReceipt.sequence : null}
                  compact={compactMapSidebar}
                  onToggle={() => setRightDrawerOpen((open) => !open)}
                  open={rightDrawerOpen}
                  pages={visibleSidebarPages}
                  onPageChange={(page) => setActiveSidebarPage(page)}
                >
                  {renderRightWorkflowSidebarContent(effectiveSidebarPage)}
                </RightWorkflowSidebar>
              )}
            </WorkspaceConsoleShell>
          </View>

          {activeView === "survey" && homeMapView ? <Section title="Survey" icon={<Satellite size={20} color="#254234" />} testID="survey-view">
            <Text style={styles.mapFeatureTitle}>Open a completed design to collect survey evidence</Text>
            <Text style={styles.mapFeatureMeta}>Choose a saved design in Projects. Your receiver connection is shared across Survey and RTK Layout.</Text>
          </Section> : null}
          <View style={{ display: activeView === "survey" && !homeMapView ? "flex" : "none" }}>
              <Section title="Survey Capture Readiness" icon={<Satellite size={20} color="#254234" />} testID="survey-view">
                <BrowserRtkReceiverPanel
            key={`${project.id}:${projectGeneration}`} owner={receiverOwner}
                  onAddMapFeature={addMapFeature}
                  onAddSurveyPoint={(point) => dispatchProjectTransaction({ type: "add_survey_point", point })}
                  onCommitBoundaryDraft={(vertices, captureEvidence) => dispatchProjectTransaction({ type: "commit_boundary_draft", vertices, captureEvidence })}
                  onCommitObstacleDraft={(vertices, kind, confidence, captureEvidence) => dispatchProjectTransaction({ type: "commit_obstacle_draft", vertices, kind, confidence, captureEvidence })}
                  onStatusChange={setRtkReceiverStatus}
                  project={project}
                  settings={settings}
                />
              <View style={styles.metricGrid}>
                <MetricTile label="Survey points" testID="survey-metric-points" value={`${project.surveyPoints.length}`} />
                <MetricTile label="RTK fixed points" testID="survey-metric-rtk-fixed" value={`${project.surveyPoints.filter((point) => point.confidence === "rtk_fixed").length}`} tone="good" />
                <MetricTile label="Draft inputs" testID="survey-metric-draft-inputs" value={`${project.surveyPoints.filter((point) => point.confidence !== "rtk_fixed").length}`} tone="warn" />
              </View>
              {project.surveyPoints.map((point) => (
                <View key={point.id} style={styles.listRow} testID={`survey-point-${point.id}`}>
                  <View>
                    <Text style={styles.rowTitle}>{point.label}</Text>
                    <Text style={styles.rowMeta}>{point.role} · {point.source} · {point.confidence}</Text>
                    <View style={styles.inlineActions}>
                      {point.role === "pivot_center" ? <SmallActionButton accessibilityLabel={`Set Pivot from ${point.label}`} label="Set Pivot" onPress={() => dispatchProject({ type: "promote_survey_point", id: point.id, target: "pivot_center" })} /> : null}
                      {point.role === "water_source" ? <SmallActionButton accessibilityLabel={`Set Water from ${point.label}`} label="Set Water" onPress={() => dispatchProject({ type: "promote_survey_point", id: point.id, target: "water_source" })} /> : null}
                      {point.role === "power_source" ? <SmallActionButton accessibilityLabel={`Set Power from ${point.label}`} label="Set Power" onPress={() => dispatchProject({ type: "promote_survey_point", id: point.id, target: "power_source" })} /> : null}
                      <SmallActionButton accessibilityLabel={`Delete survey point ${point.label}`} label="Delete" onPress={() => dispatchProject({ type: "delete_survey_point", id: point.id })} />
                    </View>
                  </View>
                  <Text style={styles.coordinate}>{formatProjectCoordinate(point.projected)}</Text>
                </View>
              ))}
            </Section>
          </View>

          {activeView === "settings" && (
            <SettingsPanel mapPackages={runtimeProject.mapPackages ?? []} settings={settings} onChange={commitSettings} />
          )}

          {activeView === "help" && (
            <Section title="Help and Training" icon={<ListChecks size={20} color="#254234" />} testID="help-view">
              <HelpTrainingPanel
                onNavigate={navigateUtility}
                onResetWalkthrough={resetWalkthrough}
                onToggleWalkthrough={updateWalkthrough}
                progress={walkthroughProgress}
              />
            </Section>
          )}

          {activeView === "files" && (homeMapView ? (
            <Section title="Files and GIS Exchange" icon={<ClipboardList size={20} color="#254234" />} testID="files-view">
              <View style={styles.mapFeatureEditor}>
                <Text style={styles.mapFeatureTitle}>No Project Open</Text>
                <Text style={styles.mapFeatureMeta}>Import a saved project, draft, or field design into a selected field. Open a design to add map or survey files.</Text>
                <SmallActionButton label="Import saved design" onPress={openArchiveWorkspace} testID="catalog-import-design" />
              </View>
              <View style={styles.metricGrid}>
                <MetricTile label="Storage" value={repository.backendLabel} />
                <MetricTile label="Catalog" value="Ready" tone="good" />
                <MetricTile label="Geometry" value="Projected XY" />
                <MetricTile label="Cloud required" value="No" tone="good" />
              </View>
            </Section>
          ) : (
            <Section title="Files and GIS Exchange" icon={<ClipboardList size={20} color="#254234" />} testID="files-view">
              <ProjectFilesPanel
                outputContext={{ designId: saveCoordinator.receipt(projectSaveSession).designId, designRevision: repository.catalogRevision === saveCoordinator.receipt(projectSaveSession).workspaceRevision ? repository.designCatalog?.designs.find(item => item.id === saveCoordinator.receipt(projectSaveSession).designId)?.revision ?? null : null, editRevision: editor.revision }}
                dirty={isDirty}
                sourceStored={typeof saveCoordinator.receipt(projectSaveSession).workspaceRevision === "number"}
                onApplyCornerGpsMapBpfImport={applyCornerGpsMapBpfImport}
                onApplyGoogleEarthKmlImport={applyGoogleEarthKmlImport}
                onDeleteProject={(projectId) => {
                  openProjectDeleteForm(projectId);
                  return Promise.resolve(false);
                }}
                onImportProjectedGeoJson={importProjectedGeoJson}
                onImportSurveyCsv={importSurveyCsv}
                onMapPackageImported={importMapPackage}
                onOpenProject={openSavedProject}
                onPreviewCornerGpsMapBpf={previewCornerGpsMapBpf}
                onPreviewGoogleEarthKml={previewGoogleEarthKml}
                onImportProjectZip={importIndependentProjectZip}
                onCancelImport={projectOpenRequests.invalidate}
                onRefreshProjects={repository.refreshProjects}
                onSaveProject={saveCurrentProject}
                onSaveProjectCopy={saveProjectCopy}
                project={project}
                repository={repository}
                result={result}
              />
              <View style={styles.metricGrid}>
                <MetricTile label="Archive" value="ZIP" />
                <MetricTile label="GIS exchange" value="GeoJSON/KML" />
                <MetricTile label="Geometry" value="Projected XY" />
                <MetricTile label="Cloud required" value="No" tone="good" />
              </View>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText} numberOfLines={16}>
                  {JSON.stringify(exportScenarioGeoJson(project, result), null, 2)}
                </Text>
              </View>
            </Section>
            ))}
            </ScrollView>
          </View>
          <WorkspaceBottomStatusBar
            backendLabel={repository.backendLabel}
            dirty={isDirty}
            gpsGateLabel={`${fixTypeLabel(settings.mappingWorkflowMode === "layout" ? "rtk_fixed" : settings.gpsQuality.minimumFixType)} gate`}
            homeMapView={homeMapView}
            powerEvidenceStatus={powerEvidenceStatus}
            rtkStatus={rtkReceiverStatus}
            short={shortLandscapeMap}
            warningCount={warningCount}
          />
        </View>
      {!homeMapView && (!sidebarInlineWorkflow || designConsoleModal === "calculate") ? (
          <DesignConsoleDialog
            activeModal={designConsoleModal}
            workspaceDirty={isDirty}
            confirmation={designConsoleModal === "calculate" && pendingPlacementAction ? (
              <ConfirmActionPanel
                confirmLabel={pendingPlacementAction.kind === "pivot" ? "Apply Pivot Center" : "Save Corner Arm Advisory"}
                message={pendingPlacementMessage(pendingPlacementAction)}
                onCancel={() => setPendingPlacementAction(null)}
                onConfirm={confirmPlacementAction}
                testID="placement-confirm-dialog"
                title={pendingPlacementAction.kind === "pivot" ? "Apply Advisory Pivot Center" : "Save Advisory Corner Arm"}
              />
            ) : undefined}
            onDismissConfirmation={() => setPendingPlacementAction(null)}
            advisoryStatus={advisoryStatus}
            advisoryError={advisoryError}
            onRetryAdvisory={retryAdvisory}
            cornerInputDraft={cornerInputDraft}
            onCornerInputDraftChange={updateCornerInputDraft}
            advisoryCostDraft={advisoryCostDraft}
            advisoryCostInput={advisoryCostInput}
            advisoryMachineRenderModel={advisoryMachineRenderModel}
            cornerArmEvaluation={cornerArmEvaluation}
            multiMachineReview={advisoryMultiMachineReview}
            editorError={editor.lastError}
            fieldPivotPlan={advisoryFieldPivotPlan}
            requestedFieldPivots={requestedFieldPivots}
            onRequestedFieldPivotsChange={updateRequestedFieldPivots}
            onActivatePrimitive={activatePrimitiveMapTool}
            onActivateTool={activateDesignConsoleTool}
            onApplyPivot={(point, wgs84) => dispatchProjectWithResult({ type: "place_pivot", point, wgs84 })}
            onCalculate={calculateDesignScenarios}
            onClose={() => {
              setDesignConsoleModal(null);
              if (activeSidebarPage === "toolForm") setActiveSidebarPage("tools");
            }}
            onOpenModal={openDesignConsolePanel}
            onOpenFiles={() => {
              setDesignConsoleModal(null);
              setActiveView("files");
            }}
            onRequestApplyPivotCandidate={(candidate) => setPendingPlacementAction({ kind: "pivot", candidate })}
            onRequestSaveCornerArm={(config) => setPendingPlacementAction({ kind: "cornerArm", config })}
            onSaveGeneratedFieldPivotZones={saveGeneratedFieldPivotReviewZones}
            onUpdateAdvisoryCostDraft={setAdvisoryCostDraft}
            onSettingsChange={commitSettings}
            onUpdateMachine={(machine) => dispatchProjectWithResult({ type: "update_machine", machine })}
            idealCenterAnalysis={idealCenterAnalysis}
            placementCandidates={placementCandidates}
            preview={designScenarioPreview}
            project={runtimeProject}
            result={result}
          settings={settings}
          visible={visible && activeView === "map" && !homeMapView && designConsoleModal !== null}
        />
      ) : null}
      <ConfirmActionDialog visible={mapModeNotice && visible && primaryTask === "design" && activeView === "map"} title="Your drawing is still open"
        message="Finish or cancel this drawing before switching to Inspect map. All entered vertices and details are retained."
        confirmLabel="Return to drawing" testID="inspect-pending-drawing"
        onCancel={() => setMapModeNotice(false)} onConfirm={() => setMapModeNotice(false)} />
      <Modal transparent animationType="fade" accessibilityLabel="Design context" visible={designContextOpen && compactMapContext && visible} onRequestClose={() => setDesignContextOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 16, backgroundColor: "rgba(20,35,25,0.35)" }}>
          <View accessibilityViewIsModal style={{ width: "100%", maxWidth: 540, maxHeight: "90%", backgroundColor: "white", borderRadius: 10, padding: 16, gap: 12 }} testID="design-context-panel">
            <Text style={styles.sectionTitle}>Design context</Text>
            <ScrollView contentContainerStyle={{ gap: 12 }}>
              <Text style={styles.mapFeatureTitle}>{catalogContextPath}</Text>
              <SmallActionButton label="Layout sessions" testID="open-layout-sessions" onPress={() => { setDesignContextOpen(false); openLayoutWorkspace(); }} />
              {!homeMapView && <SmallActionButton label="Prepare for RTK Layout" testID="prepare-rtk-layout" onPress={() => { setDesignContextOpen(false); setPrepareLayoutOpen(true); }} />}
            </ScrollView>
            <SmallActionButton label="Back to map" onPress={() => setDesignContextOpen(false)} testID="design-context-close" />
          </View>
        </View>
      </Modal>
      <Modal transparent animationType="fade" visible={prepareLayoutOpen && visible && activeView === "map" && !homeMapView} onRequestClose={() => setPrepareLayoutOpen(false)}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 16, backgroundColor: "rgba(20,35,25,0.35)" }}>
          <View accessibilityViewIsModal style={{ width: "100%", maxWidth: 540, maxHeight: "90%", backgroundColor: "white", borderRadius: 10, padding: 16, gap: 12 }} testID="prepare-layout-panel">
            <Text style={styles.sectionTitle}>Prepare for RTK Layout</Text>
            <ScrollView contentContainerStyle={{ gap: 12 }}>
              <Text style={styles.mapFeatureTitle}>{project.name} · {project.machine.name}</Text>
              <Text style={styles.mapFeatureMeta}>Saved editor revision: {savedRevision === null ? "not saved" : savedRevision}. A Layout session uses a frozen target; later design edits cannot move it.</Text>
              <Text style={styles.mapFeatureMeta}>{!activeCatalogContext.designId ? "Next: save this design inside a field in Projects." : inputRetention.hasDirty() || pendingMapDraftState || unfinishedControllerDrawing.current ? "Next: apply or discard unfinished design inputs and drawing before preparing a field copy." : "Next: save an independent-machine field copy. Your source design stays available. In the field workspace, calculate a preview, freeze the selected machine target, then create a Layout session."}</Text>
              <SmallActionButton label="Save as independent-machine field" disabled={!activeCatalogContext.designId || inputRetention.hasDirty() || !!pendingMapDraftState || unfinishedControllerDrawing.current} onPress={() => { void createIndependentField(); }} testID="prepare-create-field" />
            </ScrollView>
            <SmallActionButton label="Back to Design" onPress={() => setPrepareLayoutOpen(false)} testID="prepare-layout-close" />
          </View>
        </View>
      </Modal>
      {catalogDialogMode && !inlineCatalogForms ? (
        <ProjectCatalogDialog
          feedback={storageNotice}
          contextPreview={catalogDialogContextPreview(catalogDialogMode)}
          defaultName={catalogDialogDefaultName}
          defaultFieldName={catalogDialogMode === "project" ? "Field 1" : undefined}
          mode={catalogDialogMode}
          onCancel={closeCatalogDialog}
          onCreate={submitCatalogDialog}
          submitting={catalogDialogSubmitting}
          visible={visible && catalogOwnerTask.current === primaryTask}
        />
      ) : null}
      {clientProfileDialogMode && !inlineCatalogForms ? (
        <ClientProfileDialog
          feedback={storageNotice}
          defaultDisplayName={catalogFormRef.current?.clientDefaultName ?? "New customer"}
          initialClient={clientProfileDialogMode === "edit" ? editingClient : null}
          mode={clientProfileDialogMode}
          onCancel={closeClientProfileDialog}
          onSave={submitClientProfile}
          submitting={catalogDialogSubmitting}
          visible={visible && catalogOwnerTask.current === primaryTask}
        />
      ) : null}
      {renamingProject && !inlineCatalogForms ? (
        <ProjectCatalogDialog
          feedback={storageNotice}
          contextPreview={formatCatalogPath(catalogPathForProject(renamingProject.id))}
          createButtonLabel="Save changes"
          defaultName={renamingProject.name}
          helper="Project folder name"
          mode="project"
          onCancel={() => {
            if (!catalogDialogSubmitting) {
              setRenamingProjectId(null);
              closeInlineCatalogForm();
            }
          }}
          onCreate={(name) => renameProjectFolder(renamingProject.id, name)}
          submitting={catalogDialogSubmitting}
          title="Rename Project"
          visible={visible && catalogOwnerTask.current === primaryTask}
        />
      ) : null}
      {movingProject && !inlineCatalogForms ? (
        <MoveProjectDialog
          feedback={storageNotice}
          currentClientId={movingProject.clientId}
          clients={formCatalog.clients}
          onCancel={() => {
            if (!catalogDialogSubmitting) {
              setMovingProjectId(null);
              closeInlineCatalogForm();
            }
          }}
          onMove={(clientId) => moveProjectFolder(movingProject.id, clientId)}
          projectName={movingProject.name}
          submitting={catalogDialogSubmitting}
          visible={visible && catalogOwnerTask.current === primaryTask}
        />
      ) : null}
      {deletingProject && !inlineCatalogForms ? (
        <ConfirmActionDialog
          feedback={storageNotice}
          confirmLabel="Delete Project"
          message={`Delete ${deletingProject.name} and its contained field maps/designs from the local catalog. Project ZIP archives are not changed.`}
          onCancel={() => {
            if (!catalogDialogSubmitting) {
              setDeletingProjectId(null);
              closeInlineCatalogForm();
            }
          }}
          onConfirm={confirmDeleteProject}
          submitting={catalogDialogSubmitting}
          testID="delete-project-dialog"
          title="Delete Project"
          visible={visible && catalogOwnerTask.current === primaryTask}
        />
      ) : null}
      {deletingClient && !inlineCatalogForms ? (
        <ConfirmActionDialog
          feedback={storageNotice}
          confirmLabel="Delete Customer"
          message={`Delete the empty customer ${deletingClient.displayName}. This is blocked automatically if any projects remain inside it.`}
          onCancel={() => {
            if (!catalogDialogSubmitting) {
              setDeletingClientId(null);
              closeInlineCatalogForm();
            }
          }}
          onConfirm={confirmDeleteClient}
          submitting={catalogDialogSubmitting}
          testID="delete-client-dialog"
          title="Delete Customer"
          visible={visible && catalogOwnerTask.current === primaryTask}
        />
      ) : null}
      {pendingPlacementAction && designConsoleModal !== "calculate" ? (
        <ConfirmActionDialog
          confirmLabel={pendingPlacementAction.kind === "pivot" ? "Apply Pivot Center" : "Save Corner Arm Advisory"}
          message={pendingPlacementMessage(pendingPlacementAction)}
          onCancel={() => setPendingPlacementAction(null)}
          onConfirm={confirmPlacementAction}
          submitting={false}
          testID="placement-confirm-dialog"
          title={pendingPlacementAction.kind === "pivot" ? "Apply Advisory Pivot Center" : "Save Advisory Corner Arm"}
          visible={visible && primaryTask === "design" && activeView === "map" && !homeMapView}
        />
      ) : null}
    </SafeAreaView>
  );
}

const WALKTHROUGH_STORAGE_KEY = "cplayout.walkthrough-progress.v1";

const WALKTHROUGH_MODULES: Array<{
  id: WalkthroughModuleId;
  title: string;
  checkpoint: string;
}> = [
  { id: "imagery", title: "Setup Imagery", checkpoint: "Local aerial package or USGS preview selected with attribution." },
  { id: "boundary", title: "Trace Boundary", checkpoint: "Field boundary draft is inspected and committed as projected XY." },
  { id: "obstacles", title: "Add Obstacles", checkpoint: "Roads, ditches, buildings, and no-spray zones are marked." },
  { id: "pivot", title: "Place Pivot", checkpoint: "Pivot, water source, and power source are positioned." },
  { id: "survey", title: "Survey Points", checkpoint: "RTK or imported control points meet the configured quality gate." },
  { id: "cornerArmInputs", title: "Corner-Arm Inputs", checkpoint: "Verified LRDU speed, source-labeled model, orientation, rotation, and SDU guidance path are supplied." },
  { id: "cornerArmCalculation", title: "Corner-Arm Calculation", checkpoint: "Kinematic panel is ready and advisory LRDU, SDU, overhang, and end-gun rows are reviewed." },
  { id: "validation", title: "Layout Validation", checkpoint: "Layout warnings are inspected on the Map before export." },
  { id: "export", title: "Export Package", checkpoint: "ZIP/KML/GeoJSON are exported after saving local edits." },
];

function WorkspaceTopToolbar({
  children,
  compact,
  contextLabel,
  currentLabel,
  onOpenContext,
  short,
}: {
  children: React.ReactNode;
  compact: boolean;
  contextLabel: string;
  currentLabel: string;
  onOpenContext?: () => void;
  short: boolean;
}): React.JSX.Element {
  const commandSurface = compact ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.workspaceCommandScroller}
      contentContainerStyle={styles.workspaceCommandScrollContent}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.workspaceCommandSlot}>{children}</View>
  );

  return (
    <View style={[styles.workspaceTopToolbar, compact && styles.workspaceTopToolbarCompact,
      short && styles.workspaceTopToolbarShortLandscape]} testID="workspace-top-toolbar">
      <View style={[styles.workspaceBreadcrumb, compact && styles.workspaceBreadcrumbCompact]} testID="workspace-breadcrumb">
        {onOpenContext ? <Pressable accessibilityRole="button" accessibilityLabel={`Design context: ${contextLabel}`}
          onPress={onOpenContext} style={styles.workspaceContextTrigger} testID="design-context-open">
          <FolderOpen size={17} color="#254234" />
          <Text numberOfLines={1} style={[styles.workspaceBreadcrumbText, { flex: 1, minWidth: 0 }]} testID="workspace-breadcrumb-current">{currentLabel}</Text>
          <ChevronDown size={15} color="#254234" />
        </Pressable> : <Text numberOfLines={1} style={styles.workspaceBreadcrumbText} testID="workspace-breadcrumb-current">
          <Text style={styles.workspaceBreadcrumbRoot}>CPLayout</Text>
          <Text style={styles.workspaceBreadcrumbCurrent}> / {currentLabel}</Text>
        </Text>}
      </View>
      {commandSurface}
    </View>
  );
}

function WorkspaceBottomStatusBar({
  backendLabel,
  dirty,
  gpsGateLabel,
  homeMapView,
  powerEvidenceStatus,
  rtkStatus,
  short,
  warningCount,
}: {
  backendLabel: string;
  dirty: boolean;
  gpsGateLabel: string;
  homeMapView: boolean;
  powerEvidenceStatus: ReturnType<typeof projectPowerLineEvidenceStatus>;
  rtkStatus: BrowserRtkReceiverStatus | null;
  short: boolean;
  warningCount: number;
}): React.JSX.Element {
  const liveRtkLabel = formatLiveRtkStatus(rtkStatus);
  const powerEvidenceIconColor = powerEvidenceStatus.status === "verified" || powerEvidenceStatus.status === "verified_exclusion"
    ? "#254234"
    : "#7a4a00";
  return (
    <View style={[styles.workspaceBottomStatusBar, short && styles.workspaceBottomStatusBarShortLandscape]} testID="workspace-bottom-status-bar">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bottomStatusScroll}
        contentContainerStyle={[styles.bottomStatusContent, short && styles.bottomStatusContentShortLandscape]}>
        {homeMapView ? (
          <>
            <BottomStatusChip icon={<ClipboardList size={12} color="#254234" />} label="Catalog ready" testID="catalog-save-state" />
            <BottomStatusChip icon={<Database size={12} color="#254234" />} label={backendLabel} testID="catalog-storage-state" />
            <BottomStatusChip icon={<Satellite size={12} color="#254234" />} label="Catalog map" testID="catalog-map-state" />
          </>
        ) : (
          <>
            <BottomStatusChip icon={<ClipboardList size={12} color="#254234" />} label={dirty ? "Unsaved edits" : "Saved"} testID="project-save-state" />
            <BottomStatusChip icon={<AlertTriangle size={12} color="#254234" />} label={warningCount === 0 ? "0 warnings" : `${warningCount} warnings`} />
            <BottomStatusChip icon={<Satellite size={12} color="#254234" />} label={gpsGateLabel} />
            {liveRtkLabel ? <BottomStatusChip icon={rtkStatus?.connected && rtkStatus.gateAccepted ? <Satellite size={12} color="#254234" /> : <AlertTriangle size={12} color="#8b1e18" />} label={liveRtkLabel} testID="workspace-live-rtk-status" /> : null}
            <BottomStatusChip icon={<UtilityPole size={12} color={powerEvidenceIconColor} />} label={`Power ${powerEvidenceStatus.status.replaceAll("_", " ")}`} testID="workspace-power-evidence-status" />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function BottomStatusChip({ icon, label, testID }: { icon: React.ReactNode; label: string; testID?: string }): React.JSX.Element {
  return (
    <View style={styles.bottomStatusChip} testID={testID}>
      {icon}
      <Text numberOfLines={1} style={styles.bottomStatusText}>{label}</Text>
    </View>
  );
}

function leftNavIcon(name: CplayoutLeftNavIconId | string, color?: string, size = 18): React.JSX.Element {
  const props = { color, size };
  if (name === "alert-triangle") return <AlertTriangle {...props} />;
  if (name === "calculator") return <Calculator {...props} />;
  if (name === "clipboard-list") return <ClipboardList {...props} />;
  if (name === "database") return <Database {...props} />;
  if (name === "download") return <Download {...props} />;
  if (name === "folder-open") return <FolderOpen {...props} />;
  if (name === "home") return <Home {...props} />;
  if (name === "layers") return <Layers {...props} />;
  if (name === "list-checks") return <ListChecks {...props} />;
  if (name === "map") return <MapIcon {...props} />;
  if (name === "map-pinned") return <MapPinned {...props} />;
  if (name === "rotate-ccw") return <RotateCcw {...props} />;
  if (name === "ruler") return <Ruler {...props} />;
  if (name === "satellite") return <Satellite {...props} />;
  if (name === "sliders-horizontal") return <SlidersHorizontal {...props} />;
  if (name === "user-round") return <UserRound {...props} />;
  if (name === "wrench") return <Wrench {...props} />;
  throw new Error(`Unsupported CPLayout left navigation icon ${name}.`);
}

function commandMenuItemLabel(item: CplayoutLeftNavMenuItemDefinition, leftDrawerOpen: boolean, rightDrawerOpen: boolean): string {
  if (item.id === "project-drawer") return leftDrawerOpen ? "Collapse Project Drawer" : "Open Project Drawer";
  if (item.id === "workflow-sidebar") return rightDrawerOpen ? "Collapse Workflow Sidebar" : "Open Workflow Sidebar";
  return item.label;
}

function WorkspaceCommandSurface({
  activeView,
  canRedo,
  canUndo,
  compactLayout,
  dirty,
  homeMapView,
  leftDrawerOpen,
  onNavigate,
  onOpenCatalog,
  onOpenFiles,
  onOpenSample,
  onRedo,
  onResetWalkthrough,
  onSave,
  onCreateField,
  onShowMetrics,
  onShowWarnings,
  onStartBlankDesign,
  onToggleLeftDrawer,
  onToggleRightDrawer,
  onUndo,
  rightDrawerOpen,
}: {
  activeView: WorkspaceView;
  canRedo: boolean;
  canUndo: boolean;
  compactLayout: boolean;
  dirty: boolean;
  homeMapView: boolean;
  leftDrawerOpen: boolean;
  onNavigate: (view: WorkspaceView) => void;
  onOpenCatalog: () => void;
  onOpenFiles: () => void;
  onOpenSample: (project: PivotProject) => void;
  onRedo: () => void;
  onResetWalkthrough: () => void;
  onSave: () => void | Promise<void>;
  onCreateField: () => void | Promise<void>;
  onShowMetrics: () => void;
  onShowWarnings: () => void;
  onStartBlankDesign: () => void;
  onToggleLeftDrawer: () => void;
  onToggleRightDrawer: () => void;
  onUndo: () => void;
  rightDrawerOpen: boolean;
}): React.JSX.Element {
  const proofSampleItems: CommandMenuItemConfig[] = [
    {
      id: "sample-real-proof",
      label: "Open Real Proof",
      description: "Open the public proof map sample through an explicit local sample action.",
      icon: <MapPinned />,
      onPress: () => onOpenSample(realCenterPivotProofProject),
      testID: "command-file-real-proof",
    },
    {
      id: "sample-improved-proof",
      label: "Open Improved Proof",
      description: "Open the improved public proof sample through an explicit local sample action.",
      icon: <MapPinned />,
      onPress: () => onOpenSample(improvedCenterPivotProofProject),
      testID: "command-file-improved-proof",
    },
  ];
  const sampleItems: CommandMenuItemConfig[] = [
    ...sampleDesignProjects.map((entry) => ({
      id: `sample-${entry.id}`,
      label: `Open ${entry.label}`,
      description: `${entry.description}${entry.reviewStatus === "needs_review" ? " - needs review baseline." : ""}`,
      icon: entry.reviewStatus === "needs_review" ? <AlertTriangle /> : <MapPinned />,
      onPress: () => onOpenSample(entry.project),
      testID: `command-file-${entry.id}`,
    })),
    ...proofSampleItems,
  ];
  const menuIconColor = "#254234";
  const actionHandlers: Record<CplayoutLeftNavMenuActionId, () => void | Promise<void>> = {
    open_catalog: onOpenCatalog,
    open_sample: () => onOpenSample(defaultDevelopmentProject),
    start_blank_design: onStartBlankDesign,
    open_files: onOpenFiles,
    navigate_map: () => onNavigate("map"),
    navigate_dashboard: () => onNavigate("dashboard"),
    navigate_files: () => onNavigate("files"),
    navigate_survey: () => onNavigate("survey"),
    navigate_settings: () => onNavigate("settings"),
    navigate_help: () => onNavigate("help"),
    show_metrics: onShowMetrics,
    show_warnings: onShowWarnings,
    reset_walkthrough: onResetWalkthrough,
    toggle_left_drawer: onToggleLeftDrawer,
    toggle_right_drawer: onToggleRightDrawer,
    create_client: onOpenCatalog,
    create_project: onOpenCatalog,
    create_field_map: onOpenCatalog,
    create_design: onOpenCatalog,
  };
  const menus: CommandMenuConfig[] = buildCommandMenuConfigs({
    commandMenuItemLabel: (item) => commandMenuItemLabel(item, leftDrawerOpen, rightDrawerOpen),
    compactLayout,
    context: { activeContext: null, activeView, homeMapView },
    iconForName: (name, color) => leftNavIcon(name, color ?? menuIconColor),
    menuDefinition: leftNavMenuDefinition,
    onAction: (action) => actionHandlers[action](),
    sampleItems,
  });
  const iconButtons: CommandIconButtonConfig[] = [
    { id: "save", label: dirty ? "Save *" : "Save", disabled: homeMapView, hint: "Save the active project package locally.", icon: <Save />, onPress: onSave, testID: "command-icon-save" },
    { id: "undo", label: "Undo", disabled: !canUndo, hint: "Undo the last project edit.", icon: <RotateCcw />, onPress: onUndo, testID: "command-icon-undo" },
    { id: "redo", label: "Redo", disabled: !canRedo, hint: "Redo the last undone project edit.", icon: <RotateCcw />, onPress: onRedo, testID: "command-icon-redo" },
  ];

  if (menus[0]) menus[0].items.push({ id: "create-independent-field", label: "Save as independent-machine field",
    description: "Keep the source design and create a field with separately editable machines.",
    icon: <MapPinned />, disabled: homeMapView, onPress: onCreateField, testID: "command-create-independent-field" });

  return <CommandBar iconButtons={iconButtons} menus={menus} testID="workspace-command-bar" />;
}

function DesignActionHud({
  activeModal,
  activeTool,
  onActivateTool,
  onActivatePrimitive,
  onCalculate,
  onOpenModal,
  onToggleLayers,
  onOpenReceiver,
  settings,
}: {
  activeModal: DesignConsoleModal;
  activeTool: { activeLayer: DrawingLayerType; featureKind?: ProjectMapFeatureKind; mode: DrawingMode; requestId: number } | null;
  onActivateTool: (mode: DrawingMode, activeLayer: DrawingLayerType, featureKind?: ProjectMapFeatureKind) => void;
  onActivatePrimitive: (geometry: UtilityFeatureGeometry) => void;
  onCalculate: () => void;
  onOpenModal: (modal: DesignConsoleModal) => void;
  onToggleLayers: () => void;
  onOpenReceiver: () => void;
  settings: AppSettings;
}): React.JSX.Element {
  return (
    <DrawingToolPalette
      activeModal={activeModal}
      activeTool={activeTool}
      onActivateTool={onActivateTool}
      onActivatePrimitive={onActivatePrimitive}
      onCalculate={onCalculate}
      onOpenModal={onOpenModal}
      onToggleLayers={onToggleLayers}
      onOpenReceiver={onOpenReceiver}
      settings={settings}
    />
  );
}

type DesignConsolePanelProps = {
  cornerInputDraft: CornerArmInputDraft;
  onCornerInputDraftChange: (draft: CornerArmInputDraft) => void;
  activeModal: DesignConsoleModal;
  advisoryCostDraft: AdvisoryCostDraft;
  advisoryCostInput: AdvisoryCostInput | undefined;
  advisoryMachineRenderModel: AdvisoryMachineRenderModel | null;
  cornerArmEvaluation: AdvisoryCornerArmEvaluation | null;
  multiMachineReview: AdvisoryMultiMachineReview | null;
  advisoryStatus: string;
  advisoryError: boolean;
  onRetryAdvisory: () => void;
  editorError: string | null;
  fieldPivotPlan: AdvisoryFieldPivotPlan | null;
  requestedFieldPivots: number;
  onRequestedFieldPivotsChange: (count: number) => void;
  onActivatePrimitive: (geometry: UtilityFeatureGeometry) => void;
  onActivateTool: (mode: DrawingMode, activeLayer: DrawingLayerType, featureKind?: ProjectMapFeatureKind) => void;
  onApplyPivot: (point: XY, wgs84?: LonLat) => boolean;
  onCalculate: () => void;
  onClose?: () => void;
  onOpenModal: (modal: DesignConsoleModal) => void;
  onOpenFiles: () => void;
  onRequestApplyPivotCandidate: (candidate: PivotPlacementCandidate) => void;
  onRequestSaveCornerArm: (config: AdvisoryCornerArmConfig) => void;
  onSaveGeneratedFieldPivotZones: (plan: AdvisoryFieldPivotPlan) => void;
  onUpdateAdvisoryCostDraft: (draft: AdvisoryCostDraft) => void;
  onSettingsChange: (settings: AppSettings) => void;
  onUpdateMachine: (machine: PivotMachine) => boolean;
  idealCenterAnalysis: IdealCenterPointAnalysis | null;
  placementCandidates: PivotPlacementCandidate[] | null;
  preview: DesignScenarioPreview[] | null;
  project: PivotProject;
  result: ReturnType<typeof evaluateLayout>;
  settings: AppSettings;
  testID?: string;
  fullScreen?: boolean;
  workspaceDirty?: boolean;
};

function DesignConsoleDialog({
  visible,
  confirmation,
  onDismissConfirmation,
  ...panelProps
}: DesignConsolePanelProps & { visible: boolean; confirmation?: React.ReactNode; onDismissConfirmation?: () => void }): React.JSX.Element | null {
  if (!panelProps.activeModal) return null;
  const fullScreen = panelProps.activeModal === "calculate";
  return (
    <Modal animationType="fade" onRequestClose={confirmation ? onDismissConfirmation : panelProps.onClose} transparent={!fullScreen}
      presentationStyle={fullScreen ? "fullScreen" : undefined} visible={visible}>
      {fullScreen ? (
        <SafeAreaView style={styles.calculationScreen} testID="calculation-screen">
          <View style={[styles.calculationScreen, confirmation ? { display: "none" } : undefined]}>
            <DesignConsolePanel {...panelProps} fullScreen testID="design-console-dialog" />
          </View>
          {confirmation ? <View style={styles.consoleModalBackdrop}>{confirmation}</View> : null}
        </SafeAreaView>
      ) : (
        <View style={styles.consoleModalBackdrop} testID="design-console-dialog-backdrop">
        <DesignConsolePanel
          {...panelProps}
          testID="design-console-dialog"
        />
        </View>
      )}
    </Modal>
  );
}

function DesignConsolePanel({
  cornerInputDraft,
  onCornerInputDraftChange,
  activeModal,
  advisoryCostDraft,
  advisoryStatus,
  advisoryError,
  onRetryAdvisory,
  advisoryCostInput,
  advisoryMachineRenderModel,
  cornerArmEvaluation,
  multiMachineReview,
  editorError,
  fieldPivotPlan,
  requestedFieldPivots,
  onRequestedFieldPivotsChange,
  onActivatePrimitive,
  onActivateTool,
  onApplyPivot,
  onCalculate,
  onClose,
  onOpenModal,
  onOpenFiles,
  onRequestApplyPivotCandidate,
  onRequestSaveCornerArm,
  onSaveGeneratedFieldPivotZones,
  onUpdateAdvisoryCostDraft,
  onSettingsChange,
  onUpdateMachine,
  idealCenterAnalysis,
  placementCandidates,
  preview,
  project,
  result,
  settings,
  testID = "design-console-panel",
  fullScreen = false,
  workspaceDirty = false,
}: DesignConsolePanelProps): React.JSX.Element | null {
  if (!activeModal) return null;
  const copy = designConsoleCopy(activeModal);
  return (
    <View accessibilityViewIsModal={testID === "design-console-dialog"} style={[styles.consoleDialog, testID !== "design-console-dialog" && styles.consoleInline, fullScreen && styles.calculationPanel]} testID={testID}>
      <View style={styles.consoleDialogHeader}>
        {fullScreen && onClose ? (
          <IconCommandButton id="calculation-back" icon={<ChevronLeft />} label="Back to workspace" hint="Return to the previous workspace view" onPress={onClose} testID="design-console-close" />
        ) : <View style={styles.consoleIconBadge}>{copy.icon}</View>}
        <View style={styles.consoleDialogTitleBlock}>
          <Text style={styles.consoleDialogTitle}>{copy.title}</Text>
          <Text style={styles.consoleDialogMeta} numberOfLines={fullScreen ? 2 : undefined}>{fullScreen ? project.name : copy.meta}</Text>
          {fullScreen ? (
            <View style={styles.calculationSaveState}>
              {workspaceDirty ? <AlertTriangle size={16} color="#9b4707" /> : <CheckCircle2 size={16} color="#216544" />}
              <Text accessibilityLiveRegion="polite" style={[styles.consoleDialogMeta, { color: workspaceDirty ? "#9b4707" : "#216544" }]} testID="calculation-save-state">
                Project: {workspaceDirty ? "Unsaved edits" : "Saved"}
              </Text>
            </View>
          ) : null}
        </View>
        {onClose && !fullScreen ? (
          <Pressable accessibilityLabel="Close design console dialog" accessibilityRole="button" onPress={onClose} style={styles.consoleCloseButton} testID="design-console-close">
            <Text style={styles.consoleCloseText}>Close</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" style={[styles.consoleDialogBody, fullScreen && styles.calculationBody]} contentContainerStyle={[styles.consoleDialogBodyContent, fullScreen && styles.calculationBodyContent]}>
          {activeModal === "point" ? <PointToolSheet onActivatePrimitive={onActivatePrimitive} onOpenModal={onOpenModal} /> : null}
          {activeModal === "line" ? <LineToolSheet onActivatePrimitive={onActivatePrimitive} /> : null}
          {activeModal === "polygon" ? <PolygonToolSheet onActivatePrimitive={onActivatePrimitive} /> : null}
          {activeModal === "circle" ? <CircleToolSheet onActivatePrimitive={onActivatePrimitive} /> : null}
          {activeModal === "obstacle" ? <ObstacleToolSheet onActivateTool={onActivateTool} /> : null}
          {activeModal === "pivot" ? <PivotGpsCoordinateForm onApply={onApplyPivot} project={project} /> : null}
          {activeModal === "machine" ? (
            <MachineToolSheet
              machine={project.machine}
              onChange={onUpdateMachine}
              onOpenModal={onOpenModal}
              unitSystem={settings.unitSystem}
            />
          ) : null}
          {activeModal === "endGun" ? (
            <EndGunSettingsForm machine={project.machine} onChange={onUpdateMachine} result={result} unitSystem={settings.unitSystem} />
          ) : null}
          {activeModal === "cornerArm" && cornerArmEvaluation ? (
            <CornerArmSheet
              evaluation={cornerArmEvaluation}
              footprintCount={(project.mapFeatures ?? []).filter((feature) => feature.kind === "corner_swing_limit").length}
              machine={project.machine}
              onActivateTool={onActivateTool}
              onRequestSave={onRequestSaveCornerArm}
              result={result}
              unitSystem={settings.unitSystem}
            />
          ) : null}
          {activeModal === "calculate" ? (
            <View testID="calculation-report">
              <FieldPivotPreviewControls count={requestedFieldPivots} onChange={onRequestedFieldPivotsChange}
                plan={fieldPivotPlan} model={advisoryMachineRenderModel} settings={settings} failed={advisoryError} />
              <AdvisoryCostReviewPanel draft={advisoryCostDraft} machine={project.machine} onChange={onUpdateAdvisoryCostDraft} />
              <Pressable accessibilityRole="button" onPress={onCalculate} style={styles.calculateButton} testID="design-console-calculate">
                <Calculator size={16} color="#ffffff" />
                <Text style={styles.calculateButtonText}>Calculate Preview</Text>
              </Pressable>
            <CalculateSheet
              cornerInputDraft={cornerInputDraft}
              onCornerInputDraftChange={onCornerInputDraftChange}
              advisoryCostDraft={advisoryCostDraft}
              advisoryCostInput={advisoryCostInput}
              advisoryMachineRenderModel={advisoryMachineRenderModel}
              editorError={editorError}
              fieldPivotPlan={fieldPivotPlan}
              multiMachineReview={multiMachineReview}
              idealCenterAnalysis={idealCenterAnalysis}
              onCalculate={onCalculate}
              onRequestApplyPivotCandidate={onRequestApplyPivotCandidate}
              onSaveGeneratedFieldPivotZones={onSaveGeneratedFieldPivotZones}
              onSettingsChange={onSettingsChange}
              onUpdateAdvisoryCostDraft={onUpdateAdvisoryCostDraft}
              placementCandidates={placementCandidates}
              preview={preview}
              project={project}
              result={result}
              settings={settings}
            />
              {(!advisoryMachineRenderModel || !fieldPivotPlan || !multiMachineReview) ? <AdvisoryCalculationStatus message={advisoryStatus} failed={advisoryError} onRetry={onRetryAdvisory} testID="advisory-calculation-status" /> : null}
            </View>
          ) : null}
          {activeModal === "layers" ? (
            <LayersSheet
              mapPackages={project.mapPackages ?? []}
              onOpenFiles={onOpenFiles}
              onSettingsChange={onSettingsChange}
              project={project}
              settings={settings}
            />
          ) : null}
      </ScrollView>
    </View>
  );
}

function AdvisoryCalculationStatus({ message, failed, onRetry, testID }: {
  message: string; failed: boolean; onRetry: () => void; testID?: string;
}): React.JSX.Element {
  const empty = !message && !failed;
  return (
    <View style={{ minHeight: empty ? 0 : 28, height: empty ? 0 : undefined, overflow: empty ? "hidden" : "visible", flexDirection: "row", alignItems: "center", paddingHorizontal: 12 }}>
      <Text accessibilityLiveRegion="polite" testID={testID} style={{ flex: 1, fontSize: 12, color: failed ? "#a32828" : "#46564b" }}>{message}</Text>
      {failed ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Retry advisory calculation" onPress={onRetry} style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
          <RotateCcw size={16} color="#46564b" />
        </Pressable>
      ) : null}
    </View>
  );
}

function designConsoleCopy(modal: NonNullable<DesignConsoleModal>): { icon: React.ReactNode; meta: string; title: string } {
  const color = "#eef7f1";
  switch (modal) {
    case "point":
      return { icon: <MapPin size={21} color={color} />, title: "Placemark Tools", meta: "Place pivot, water, power, control, and utility placemarks from map clicks." };
    case "line":
      return { icon: <Route size={21} color={color} />, title: "Path Tools", meta: "Draw projected XY path features from map clicks; decimal GPS stays the display layer." };
    case "polygon":
      return { icon: <Pentagon size={21} color={color} />, title: "Polygon Tools", meta: "Choose the feature type, then click vertices on the map and commit through projected-XY validation." };
    case "circle":
      return { icon: <Circle size={21} color={color} />, title: "Ruler And Measure Tools", meta: "Use center plus radius-point clicks for advisory circular map features." };
    case "pivot":
      return { icon: <CircleDot size={21} color={color} />, title: "Pivot GPS Entry", meta: "Default entry is WGS84 decimal degrees; projected XY remains internal." };
    case "obstacle":
      return { icon: <Sprout size={21} color={color} />, title: "Obstacle And Constraint Tools", meta: "Draw no-spray and hard-conflict polygons without changing map viewport state." };
    case "machine":
      return { icon: <Wrench size={21} color={color} />, title: "Machine", meta: "Set spans, overhang, sweep, and clearance buffers from source-backed or custom inputs." };
    case "endGun":
      return { icon: <Ruler size={21} color={color} />, title: "End Gun", meta: "End-gun throw and shutoff arcs are separate from corner-arm advisory footprints." };
    case "cornerArm":
      return { icon: <Waypoints size={21} color={color} />, title: "Corner Arm Advisory", meta: "Operator/vendor footprint evidence only; manufacturer kinematics are not modeled." };
    case "calculate":
      return { icon: <Calculator size={21} color={color} />, title: "Calculate", meta: "Preview scenarios and metrics without save/export side effects." };
    case "layers":
      return { icon: <Layers size={21} color={color} />, title: "Places And Layers", meta: "Reference and imagery settings remain no-key, local-first, and separate from canonical projected XY." };
  }
}

function PointToolSheet({
  onActivatePrimitive,
  onOpenModal,
}: {
  onActivatePrimitive: (geometry: UtilityFeatureGeometry) => void;
  onOpenModal: (modal: DesignConsoleModal) => void;
}): React.JSX.Element {
  return (
    <View style={styles.consoleChoiceGrid}>
      <ConsoleChoiceButton label="Pivot GPS Entry" meta="Type decimal GPS or expert projected XY for the pivot center." onPress={() => onOpenModal("pivot")} />
      <ConsoleChoiceButton label="Point" meta="Click one projected-XY point, then choose pump, well, pole, tree, or evidence purpose." onPress={() => onActivatePrimitive("Point")} />
    </View>
  );
}

function MachineToolSheet({
  machine,
  onChange,
  onOpenModal,
  unitSystem,
}: {
  machine: PivotMachine;
  onChange: (machine: PivotMachine) => boolean | void;
  onOpenModal: (modal: DesignConsoleModal) => void;
  unitSystem: PivotProject["unitSystem"];
}): React.JSX.Element {
  return (
    <View style={styles.machineForm}>
      <MachineSettingsForm machine={machine} onChange={onChange} unitSystem={unitSystem} />
      <View style={styles.consoleChoiceGrid}>
        <ConsoleChoiceButton label="Pivot GPS Entry" meta="Pivot center coordinates" onPress={() => onOpenModal("pivot")} />
        <ConsoleChoiceButton label="End Gun Settings" meta="Set throw distance and optional shutoff angle ranges." onPress={() => onOpenModal("endGun")} />
        <ConsoleChoiceButton label="Corner Arm Advisory" meta="Review and save advisory corner-arm evidence settings." onPress={() => onOpenModal("cornerArm")} />
      </View>
    </View>
  );
}

function LineToolSheet({ onActivatePrimitive }: { onActivatePrimitive: (geometry: UtilityFeatureGeometry) => void }): React.JSX.Element {
  return (
    <View style={styles.consoleChoiceGrid}>
      <ConsoleChoiceButton label="Line" meta="Click two or more projected-XY vertices, then choose pipeline, wire, road, ditch, fence, measurement, or linear move purpose." onPress={() => onActivatePrimitive("LineString")} />
    </View>
  );
}

function PolygonToolSheet({
  onActivatePrimitive,
}: {
  onActivatePrimitive: (geometry: UtilityFeatureGeometry) => void;
}): React.JSX.Element {
  return (
    <View style={styles.consoleChoiceGrid}>
      <ConsoleChoiceButton label="Polygon" meta="Click three or more projected-XY vertices, then choose boundary, zone, obstacle, building, or corner-arm purpose." onPress={() => onActivatePrimitive("Polygon")} />
    </View>
  );
}

function CircleToolSheet({ onActivatePrimitive }: { onActivatePrimitive: (geometry: UtilityFeatureGeometry) => void }): React.JSX.Element {
  return (
    <View style={styles.consoleChoiceGrid}>
      <ConsoleChoiceButton label="Circle" meta="Click center and radius point, then choose end-gun radius review or circular evidence purpose." onPress={() => onActivatePrimitive("Circle")} />
    </View>
  );
}

function ObstacleToolSheet({ onActivateTool }: { onActivateTool: (mode: DrawingMode, activeLayer: DrawingLayerType, featureKind?: ProjectMapFeatureKind) => void }): React.JSX.Element {
  const obstacleLayers: Array<{ layer: DrawingLayerType; label: string; meta: string }> = [
    { layer: "exclusion", label: "No-Spray Area", meta: "Hard conflict and no-spray polygon." },
    { layer: "road", label: "Road", meta: "Road obstacle polygon." },
    { layer: "ditch", label: "Ditch", meta: "Ditch obstacle polygon." },
    { layer: "fence", label: "Fence", meta: "Fence obstacle polygon." },
    { layer: "building", label: "Building", meta: "Building footprint obstacle." },
    { layer: "canal", label: "Canal", meta: "Canal obstacle polygon." },
    { layer: "tree", label: "Tree Row", meta: "Tree or grove obstacle polygon." },
  ];
  return (
    <View style={styles.consoleChoiceGrid}>
      {obstacleLayers.map((option) => (
        <ConsoleChoiceButton key={option.layer} label={option.label} meta={option.meta} onPress={() => onActivateTool("mark_obstacle", option.layer)} />
      ))}
    </View>
  );
}

function ConsoleChoiceButton({ label, meta, onPress }: { label: string; meta: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={styles.consoleChoiceButton}>
      <Text style={styles.consoleChoiceTitle}>{label}</Text>
      <Text style={styles.consoleChoiceMeta}>{meta}</Text>
    </Pressable>
  );
}

function PivotGpsCoordinateForm({ onApply, project }: { onApply: (point: XY, wgs84?: LonLat) => boolean; project: PivotProject }): React.JSX.Element {
  const gpsDefault = useMemo(() => {
    try {
      return { ok: true as const, value: formatCoordinate({ projected: project.pivotCenter, projectCrs: project.projectCrs }, "decimal_degrees", 7), error: null };
    } catch (error) {
      return { ok: false as const, value: coordinateExample("decimal_degrees"), error: error instanceof Error ? error.message : String(error) };
    }
  }, [project.pivotCenter, project.projectCrs]);
  const [gpsText, setGpsText] = useRetainedInput("pivotGps:gpsText", gpsDefault.value);
  const [expertOpen, setExpertOpen] = useState(false);
  const [x, setX] = useRetainedInput("pivotGps:x", project.pivotCenter.x.toFixed(3));
  const [y, setY] = useRetainedInput("pivotGps:y", project.pivotCenter.y.toFixed(3));
  const [error, setError] = useState<string | null>(null);


  function applyGps(): void {
    if (!gpsDefault.ok) {
      setError(`GPS unavailable until CRS/calibration is set: ${gpsDefault.error}`);
      return;
    }
    const parsed = parseCoordinateInput(gpsText, "decimal_degrees", project.projectCrs);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const accepted = onApply(parsed.coordinate.projected, parsed.coordinate.wgs84);
    setError(accepted ? null : "Pivot coordinate was rejected by project validation.");
  }

  function applyExpertXy(): void {
    try {
      const accepted = onApply({ x: requiredFiniteNumber(x, "Pivot X"), y: requiredFiniteNumber(y, "Pivot Y") });
      setError(accepted ? null : "Pivot XY was rejected by project validation.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <View style={styles.machineForm}>
      <View style={styles.formField}>
        <Text style={styles.formLabel}>Pivot latitude, longitude</Text>
        <TextInput
          accessibilityLabel="Pivot latitude and longitude decimal degrees"
          editable={gpsDefault.ok}
          keyboardType="numbers-and-punctuation"
          onChangeText={(value) => {
            setGpsText(value);
            if (error) setError(null);
          }}
          style={[styles.textInput, !gpsDefault.ok && styles.inputDisabled]}
          testID="pivot-gps-input"
          value={gpsText}
        />
        <Text style={styles.mapFeatureMeta}>
          Decimal degrees in WGS84, formatted as latitude, longitude. The reducer receives projected XY after CRS conversion.
        </Text>
        {!gpsDefault.ok ? <Text style={styles.formError}>GPS unavailable until CRS/calibration is set: {gpsDefault.error}</Text> : null}
      </View>
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <View style={styles.inlineActions}>
        <SmallActionButton disabled={!gpsDefault.ok} label="Apply GPS" onPress={applyGps} />
        <SmallActionButton label={expertOpen ? "Hide Expert XY" : "Expert XY"} onPress={() => setExpertOpen((open) => !open)} />
      </View>
      {expertOpen ? (
        <View style={styles.expertPanel} testID="pivot-expert-xy">
          <Text style={styles.mapFeatureTitle}>Expert XY</Text>
          <Text style={styles.mapFeatureMeta}>Projected/local XY is canonical internal geometry. Use this only for diagnostics or surveyed project coordinates.</Text>
          <View style={styles.formGrid}>
            <FormField label="Pivot X" value={x} onChangeText={setX} />
            <FormField label="Pivot Y" value={y} onChangeText={setY} />
          </View>
          <View style={styles.inlineActions}>
            <SmallActionButton label="Apply Expert XY" onPress={applyExpertXy} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function EndGunSettingsForm({
  machine,
  onChange,
  result,
  unitSystem,
}: {
  machine: PivotMachine;
  onChange: (machine: PivotMachine) => boolean | void;
  result: ReturnType<typeof evaluateLayout>;
  unitSystem: PivotProject["unitSystem"];
}): React.JSX.Element {
  const firstRange = machine.endGunAngleRanges?.[0] ?? null;
  const [throwDistance, setThrowDistance] = useRetainedInput("endGun:throwDistance", formatDistanceInputValue(machine.endGunThrowMeters, unitSystem));
  const [arcEnabled, setArcEnabled] = useRetainedInput("endGun:arcEnabled", Boolean(firstRange));
  const [startAngle, setStartAngle] = useRetainedInput("endGun:startAngle", firstRange ? String(firstRange.startAngleDegrees) : "0");
  const [stopAngle, setStopAngle] = useRetainedInput("endGun:stopAngle", firstRange ? String(firstRange.stopAngleDegrees) : "120");
  const [direction, setDirection] = useRetainedInput<"clockwise" | "counterclockwise">("endGun:direction", firstRange?.direction ?? "counterclockwise");
  const [error, setError] = useState<string | null>(null);


  function apply(): void {
    try {
      const nextMachine: PivotMachine = {
        ...machine,
        endGunThrowMeters: preserveDistanceInput(throwDistance, machine.endGunThrowMeters, unitSystem, "End gun throw"),
        endGunAngleRanges: arcEnabled
          ? [{
            startAngleDegrees: requiredFiniteNumber(startAngle, "End gun arc start"),
            stopAngleDegrees: requiredFiniteNumber(stopAngle, "End gun arc stop"),
            direction,
          }]
          : [],
      };
      const accepted = onChange(nextMachine);
      setError(accepted === false ? "End-gun settings were rejected by project validation." : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <View style={styles.machineForm}>
      <View style={styles.metricGrid}>
        <MetricTile label="End-gun acres" value={formatAreaFromAcres(result.metrics.endGunAcres, unitSystem)} />
        <MetricTile label="No-spray conflicts" value={`${result.metrics.noSprayConflictCount}`} tone={result.metrics.noSprayConflictCount > 0 ? "warn" : "good"} />
      </View>
      <Text style={styles.mapFeatureMeta}>
        Use throw distance and optional shutoff arcs for end-gun inspection. Corner-arm footprints remain separate advisory map features.
      </Text>
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <View style={styles.formGrid}>
        <FormField label={`Throw (${unitSystem === "metric" ? "m" : "ft/in"})`} value={throwDistance} onChangeText={setThrowDistance} />
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Arc mode</Text>
          <View style={styles.controlRow}>
            <ActionButton label="Full sweep" selected={!arcEnabled} onPress={() => setArcEnabled(false)} />
            <ActionButton label="Angle range" selected={arcEnabled} onPress={() => setArcEnabled(true)} />
          </View>
        </View>
        {arcEnabled ? (
          <>
            <FormField label="Start angle" value={startAngle} onChangeText={setStartAngle} />
            <FormField label="Stop angle" value={stopAngle} onChangeText={setStopAngle} />
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Direction</Text>
              <View style={styles.controlRow}>
                <ActionButton label="CW" selected={direction === "clockwise"} onPress={() => setDirection("clockwise")} />
                <ActionButton label="CCW" selected={direction === "counterclockwise"} onPress={() => setDirection("counterclockwise")} />
              </View>
            </View>
          </>
        ) : null}
      </View>
      <View style={styles.inlineActions}>
        <SmallActionButton label="Apply End Gun" onPress={apply} />
      </View>
    </View>
  );
}

function CornerArmSheet({
  evaluation,
  footprintCount,
  machine,
  onActivateTool,
  onRequestSave,
  result,
  unitSystem,
}: {
  evaluation: AdvisoryCornerArmEvaluation;
  footprintCount: number;
  machine: PivotMachine;
  onActivateTool: (mode: DrawingMode, activeLayer: DrawingLayerType, featureKind?: ProjectMapFeatureKind) => void;
  onRequestSave: (config: AdvisoryCornerArmConfig) => void;
  result: ReturnType<typeof evaluateLayout>;
  unitSystem: PivotProject["unitSystem"];
}): React.JSX.Element {
  const [name, setName] = useState(machine.cornerArm?.name ?? "Operator corner-arm advisory");
  const [length, setLength] = useState(formatDistanceInputValue(machine.cornerArm?.lengthMeters ?? DEFAULT_CORNER_ARM_LENGTH_METERS, unitSystem));
  const [wheelTrackLength, setWheelTrackLength] = useState(formatDistanceInputValue(machine.cornerArm?.wheelTrackLengthMeters ?? DEFAULT_CORNER_ARM_WHEEL_TRACK_LENGTH_METERS, unitSystem));
  const [overhangLength, setOverhangLength] = useState(formatDistanceInputValue(machine.cornerArm?.overhangLengthMeters ?? DEFAULT_CORNER_ARM_OVERHANG_LENGTH_METERS, unitSystem));
  const [metadataSource, setMetadataSource] = useState<AdvisoryCornerArmConfig["metadataSource"]>(machine.cornerArm?.metadataSource ?? "operator_supplied");
  const [guidanceType, setGuidanceType] = useState<AdvisoryCornerArmConfig["guidanceType"]>(machine.cornerArm?.guidanceType ?? "operator_supplied");
  const [sequencingType, setSequencingType] = useState<AdvisoryCornerArmConfig["sequencingType"]>(machine.cornerArm?.sequencingType ?? "operator_supplied");
  const [orientation, setOrientation] = useState<AdvisoryCornerArmConfig["orientation"]>(machine.cornerArm?.orientation ?? "operator_supplied");
  const [confidence, setConfidence] = useState<AdvisoryCornerArmConfig["confidence"]>(machine.cornerArm?.confidence ?? "user_estimated");
  const [selectedScaffoldModelId, setSelectedScaffoldModelId] = useState<string | null>(
    machine.cornerArm && VALLEY_CORNER_ARM_SCAFFOLD_CATALOG.some((entry) => entry.id === machine.cornerArm?.id)
      ? machine.cornerArm.id
      : null,
  );
  const [xmlConfig, setXmlConfig] = useState("");
  const [xmlPresets, setXmlPresets] = useState<CornerGpsMapModelPreset[]>([]);
  const [xmlStatus, setXmlStatus] = useState<string | null>(null);
  const [selectedXmlPresetId, setSelectedXmlPresetId] = useState<string | null>(machine.cornerArm?.metadataSource === "cornergpsmap_config" ? machine.cornerArm.id : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(machine.cornerArm?.name ?? "Operator corner-arm advisory");
    setLength(formatDistanceInputValue(machine.cornerArm?.lengthMeters ?? DEFAULT_CORNER_ARM_LENGTH_METERS, unitSystem));
    setWheelTrackLength(formatDistanceInputValue(machine.cornerArm?.wheelTrackLengthMeters ?? DEFAULT_CORNER_ARM_WHEEL_TRACK_LENGTH_METERS, unitSystem));
    setOverhangLength(formatDistanceInputValue(machine.cornerArm?.overhangLengthMeters ?? DEFAULT_CORNER_ARM_OVERHANG_LENGTH_METERS, unitSystem));
    setMetadataSource(machine.cornerArm?.metadataSource ?? "operator_supplied");
    setGuidanceType(machine.cornerArm?.guidanceType ?? "operator_supplied");
    setSequencingType(machine.cornerArm?.sequencingType ?? "operator_supplied");
    setOrientation(machine.cornerArm?.orientation ?? "operator_supplied");
    setConfidence(machine.cornerArm?.confidence ?? "user_estimated");
    setSelectedScaffoldModelId(machine.cornerArm && VALLEY_CORNER_ARM_SCAFFOLD_CATALOG.some((entry) => entry.id === machine.cornerArm?.id) ? machine.cornerArm.id : null);
    setSelectedXmlPresetId(machine.cornerArm?.metadataSource === "cornergpsmap_config" ? machine.cornerArm.id : null);
    setError(null);
  }, [machine.cornerArm, unitSystem]);

  function selectScaffoldModel(model: CornerArmModelCatalogEntry): void {
    setSelectedScaffoldModelId(model.id);
    setSelectedXmlPresetId(null);
    setName(model.label);
    setLength(formatDistanceInputValue(model.spanLengthMeters + model.overhangLengthMeters, unitSystem));
    setWheelTrackLength(formatDistanceInputValue(model.spanLengthMeters, unitSystem));
    setOverhangLength(formatDistanceInputValue(model.overhangLengthMeters, unitSystem));
    setMetadataSource("local_design_guide");
    setGuidanceType("unknown");
    setSequencingType("unknown");
    setOrientation("unknown");
    setConfidence("user_estimated");
    setXmlStatus(`${model.label} selected as scaffold-only advisory metadata.`);
  }

  function parseXmlPresets(): void {
    try {
      const parsed = parseCornerGpsMapConfigXml(xmlConfig, {
        sourceId: "SRC-CORNERGPSMAP-PASTED-XML-ADVISORY",
        title: "Operator-provided CornerGPSMap config XML",
        checkedAt: new Date(0).toISOString(),
        limit: "In-memory advisory preset selection only; raw XML and local file paths are not persisted.",
      });
      const usablePresets = parsed.presets.filter((preset) => preset.kind === "pivot" && (preset.cornerLengthMeters ?? 0) > 0);
      setXmlPresets(usablePresets);
      setXmlStatus(`${usablePresets.length} advisory corner preset${usablePresets.length === 1 ? "" : "s"} available.`);
      if (usablePresets.length === 0) setSelectedXmlPresetId(null);
    } catch (err) {
      setXmlPresets([]);
      setSelectedXmlPresetId(null);
      setXmlStatus(err instanceof Error ? err.message : String(err));
    }
  }

  function selectXmlPreset(preset: CornerGpsMapModelPreset): void {
    try {
      const config = cornerGpsMapPresetToAdvisoryCornerArmConfig(preset);
      setSelectedXmlPresetId(config.id);
      setName(config.name);
      setLength(formatDistanceInputValue(config.lengthMeters, unitSystem));
      setWheelTrackLength(config.wheelTrackLengthMeters !== undefined ? formatDistanceInputValue(config.wheelTrackLengthMeters, unitSystem) : "");
      setOverhangLength(config.overhangLengthMeters !== undefined ? formatDistanceInputValue(config.overhangLengthMeters, unitSystem) : "");
      setMetadataSource(config.metadataSource ?? "cornergpsmap_config");
      setGuidanceType(config.guidanceType);
      setSequencingType(config.sequencingType);
      setOrientation(config.orientation);
      setConfidence(config.confidence);
      setXmlStatus(`${config.name} selected as advisory corner-arm metadata.`);
    } catch (err) {
      setXmlStatus(err instanceof Error ? err.message : String(err));
    }
  }

  function requestSave(): void {
    try {
      const trimmedName = name.trim();
      const parsedWheelTrackLength = optionalPositiveDistanceInput(wheelTrackLength, unitSystem, "Corner-arm wheel track length");
      const parsedOverhangLength = optionalNonNegativeDistanceInput(overhangLength, unitSystem, "Corner-arm overhang length");
      const selectedPreset = selectedXmlPresetId
        ? xmlPresets.find((preset) => cornerGpsMapPresetToAdvisoryCornerArmConfig(preset).id === selectedXmlPresetId)
        : undefined;
      const selectedPresetConfig = selectedPreset ? cornerGpsMapPresetToAdvisoryCornerArmConfig(selectedPreset) : null;
      const selectedScaffoldModel = selectedScaffoldModelId
        ? VALLEY_CORNER_ARM_SCAFFOLD_CATALOG.find((entry) => entry.id === selectedScaffoldModelId) ?? null
        : null;
      const config: AdvisoryCornerArmConfig = {
        id: selectedPresetConfig?.id ?? selectedScaffoldModel?.id ?? machine.cornerArm?.id ?? "operator-corner-arm-advisory",
        name: trimmedName.length > 0 ? trimmedName : "Operator corner-arm advisory",
        advisoryOnly: true,
        lengthMeters: requiredPositiveDistanceInput(length, unitSystem, "Corner-arm length"),
        ...(parsedWheelTrackLength === undefined ? {} : { wheelTrackLengthMeters: parsedWheelTrackLength }),
        ...(parsedOverhangLength === undefined ? {} : { overhangLengthMeters: parsedOverhangLength }),
        ...(selectedPresetConfig?.maxSteerAngleDegrees === undefined ? {} : { maxSteerAngleDegrees: selectedPresetConfig.maxSteerAngleDegrees }),
        ...(selectedPresetConfig?.minSteerAngleDegrees === undefined ? {} : { minSteerAngleDegrees: selectedPresetConfig.minSteerAngleDegrees }),
        metadataSource,
        modelFamily: selectedScaffoldModel ? "single_span_lrdu_sdu" : selectedPresetConfig?.modelFamily,
        guidanceType,
        sequencingType,
        orientation,
        confidence,
        sourceRefs: selectedPresetConfig?.sourceRefs ?? selectedScaffoldModel?.sourceRefs ?? (machine.cornerArm?.sourceRefs?.length ? machine.cornerArm.sourceRefs : DEFAULT_CORNER_ARM_SOURCE_REFS),
        ...(selectedPresetConfig?.notes ? { notes: selectedPresetConfig.notes } : {}),
        ...(selectedScaffoldModel ? { notes: `${selectedScaffoldModel.label} scaffold-only model selection. ${selectedScaffoldModel.notes.join(" ")}` } : {}),
      };
      setError(null);
      onRequestSave(config);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <View style={styles.machineForm}>
      <View style={styles.metricGrid}>
        <MetricTile label="Advisory footprints" value={`${footprintCount}`} />
        <MetricTile label="Tower track conflicts" value={`${result.metrics.towerTrackConflictCount}`} tone={result.metrics.towerTrackConflictCount > 0 ? "danger" : "good"} />
        <MetricTile label="Added candidate" value={formatAreaFromAcres(evaluation.estimatedAddedCoverageAcres, unitSystem)} />
      </View>
      <AdvisoryBadgeRow badges={["advisory", "source-backed", "unverified kinematics", "qualified review required"]} testID="corner-arm-advisory-badges" />
      <Text style={styles.mapFeatureMeta}>
        Corner-arm support is advisory only. Store vendor/operator supplied footprint, track, and coverage evidence as map features; CPLayout does not model manufacturer-specific corner-arm kinematics without source-backed geometry data.
      </Text>
      <Text style={styles.mapFeatureMeta}>
        Catalog compatibility: {machine.catalogSelection ? `${machine.catalogSelection.manufacturer} ${machine.catalogSelection.model} is selected as an advisory snapshot.` : "No catalog preset selected; verify compatibility from operator/vendor sources."}
      </Text>
      <View style={styles.machineCatalogPanel} testID="corner-arm-scaffold-models">
        <Text style={styles.formLabel}>Scaffold model records</Text>
        <Text style={styles.mapFeatureMeta}>These local artifact rows are source-hashed, scaffold-only, and production_ready=No. They populate advisory fields only.</Text>
        <View style={styles.controlRow}>
          {VALLEY_CORNER_ARM_SCAFFOLD_CATALOG.map((model) => (
            <ActionButton
              key={model.id}
              label={model.label.replace("Valley ", "").replace(" scaffold", "")}
              onPress={() => selectScaffoldModel(model)}
              selected={selectedScaffoldModelId === model.id}
            />
          ))}
        </View>
      </View>
      <View style={styles.machineCatalogPanel}>
        <Text style={styles.formLabel}>CornerGPSMap XML presets</Text>
        <FormField keyboardType="default" label="Config XML paste" value={xmlConfig} onChangeText={setXmlConfig} testID="corner-gps-map-config-xml" />
        <View style={styles.inlineActions}>
          <SmallActionButton label="Parse XML Presets" onPress={parseXmlPresets} testID="corner-gps-map-parse-presets" />
        </View>
        {xmlPresets.length > 0 ? (
          <View style={styles.controlRow}>
            {xmlPresets.map((preset) => {
              const presetConfig = cornerGpsMapPresetToAdvisoryCornerArmConfig(preset);
              return (
                <ActionButton
                  key={presetConfig.id}
                  label={preset.name}
                  onPress={() => selectXmlPreset(preset)}
                  selected={selectedXmlPresetId === presetConfig.id}
                />
              );
            })}
          </View>
        ) : null}
        {xmlStatus ? <Text style={styles.mapFeatureMeta}>{xmlStatus}</Text> : null}
      </View>
      <View style={styles.formGrid} testID="corner-arm-advisory-form">
        <FormField label="Advisory name" value={name} onChangeText={setName} />
        <FormField label={`Length (${unitSystem === "metric" ? "m" : "ft/in"})`} value={length} onChangeText={setLength} />
        <FormField label={`Wheel track (${unitSystem === "metric" ? "m" : "ft/in"})`} value={wheelTrackLength} onChangeText={setWheelTrackLength} />
        <FormField label={`Overhang (${unitSystem === "metric" ? "m" : "ft/in"})`} value={overhangLength} onChangeText={setOverhangLength} />
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Metadata source</Text>
          <View style={styles.controlRow}>
            {(["operator_supplied", "cornergpsmap_config", "manufacturer_public", "local_design_guide", "unknown"] as const).map((value) => (
              <ActionButton key={value} label={advisoryOptionLabel(value)} selected={metadataSource === value} onPress={() => setMetadataSource(value)} />
            ))}
          </View>
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Guidance</Text>
          <View style={styles.controlRow}>
            {(["operator_supplied", "gps_guidance", "below_ground_guidance", "unknown"] as const).map((value) => (
              <ActionButton key={value} label={advisoryOptionLabel(value)} selected={guidanceType === value} onPress={() => setGuidanceType(value)} />
            ))}
          </View>
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Sequencing</Text>
          <View style={styles.controlRow}>
            {(["operator_supplied", "electronic", "mechanical", "unknown"] as const).map((value) => (
              <ActionButton key={value} label={advisoryOptionLabel(value)} selected={sequencingType === value} onPress={() => setSequencingType(value)} />
            ))}
          </View>
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Orientation</Text>
          <View style={styles.controlRow}>
            {(["operator_supplied", "leading", "trailing", "unknown"] as const).map((value) => (
              <ActionButton key={value} label={advisoryOptionLabel(value)} selected={orientation === value} onPress={() => setOrientation(value)} />
            ))}
          </View>
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Source confidence</Text>
          <View style={styles.controlRow}>
            {(["user_estimated", "imagery_digitized", "imported_cad", "optimized"] as const).map((value) => (
              <ActionButton key={value} label={advisoryOptionLabel(value)} selected={confidence === value} onPress={() => setConfidence(value)} />
            ))}
          </View>
        </View>
      </View>
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <CornerArmEvaluationPanel evaluation={evaluation} unitSystem={unitSystem} />
      <View style={styles.consoleChoiceGrid}>
        <ConsoleChoiceButton label="Draw Footprint Polygon" meta="Click vertices for an advisory corner-arm swing or coverage footprint." onPress={() => onActivateTool("measure", "control_point", "corner_swing_limit")} />
        <ConsoleChoiceButton label="Draw SDU Guidance Path" meta="Trace operator-supplied SDU guidance evidence as a linear_move_path for kinematic review." onPress={() => onActivateTool("measure", "control_point", "linear_move_path")} />
      </View>
      <View style={styles.inlineActions}>
        <SmallActionButton label="Save Corner Arm Advisory" onPress={requestSave} testID="corner-arm-save-advisory" />
      </View>
    </View>
  );
}

function CalculateSheet({
  cornerInputDraft,
  onCornerInputDraftChange,
  advisoryCostDraft,
  advisoryCostInput,
  advisoryMachineRenderModel,
  editorError,
  fieldPivotPlan,
  multiMachineReview,
  idealCenterAnalysis,
  onCalculate,
  onRequestApplyPivotCandidate,
  onSaveGeneratedFieldPivotZones,
  onSettingsChange,
  onUpdateAdvisoryCostDraft,
  placementCandidates,
  preview,
  project,
  result,
  settings,
}: {
  cornerInputDraft: CornerArmInputDraft;
  onCornerInputDraftChange: (draft: CornerArmInputDraft) => void;
  advisoryCostDraft: AdvisoryCostDraft;
  advisoryCostInput: AdvisoryCostInput | undefined;
  advisoryMachineRenderModel: AdvisoryMachineRenderModel | null;
  editorError: string | null;
  fieldPivotPlan: AdvisoryFieldPivotPlan | null;
  multiMachineReview: AdvisoryMultiMachineReview | null;
  idealCenterAnalysis: IdealCenterPointAnalysis | null;
  onCalculate: () => void;
  onRequestApplyPivotCandidate: (candidate: PivotPlacementCandidate) => void;
  onSaveGeneratedFieldPivotZones: (plan: AdvisoryFieldPivotPlan) => void;
  onSettingsChange: (settings: AppSettings) => void;
  onUpdateAdvisoryCostDraft: (draft: AdvisoryCostDraft) => void;
  placementCandidates: PivotPlacementCandidate[] | null;
  preview: DesignScenarioPreview[] | null;
  project: PivotProject;
  result: ReturnType<typeof evaluateLayout>;
  settings: AppSettings;
}): React.JSX.Element {
  const strategyComparison = useMemo<AdvisoryMachineStrategyComparison>(() => compareAdvisoryMachineStrategies(project, {
    maxCandidates: 2,
    costInput: advisoryCostInput,
  }), [advisoryCostInput, project]);
  const radiusSensitivityReview = useMemo<AdvisoryRadiusSensitivityReview | null>(() => {
    if (!advisoryCostInput || !advisoryCostDraftReadyForRadiusSensitivity(advisoryCostDraft)) return null;
    return buildAdvisoryRadiusSensitivityReview(project, {
      maxCandidates: 1,
      maxMachines: 2,
      costInput: advisoryCostInput,
      radiiMeters: appRadiusSensitivityRadii(project),
    });
  }, [advisoryCostDraft, advisoryCostInput, project]);
  const endGunSensitivityReview = useMemo<AdvisoryEndGunSensitivityReview>(() => buildAdvisoryEndGunSensitivityReview(project, {
    throwDistancesMeters: appEndGunThrowSensitivityThrows(project),
  }), [project]);
  const sweepEfficiencyReview = useMemo<AdvisorySweepEfficiencyReview>(() => buildAdvisorySweepEfficiencyReview(project, {
    comparisonRadiiMeters: appSweepEfficiencyRadii(project),
    costInput: advisoryCostInput,
  }), [advisoryCostInput, project]);
  const obstacleInteractionReview = useMemo<AdvisoryObstacleInteractionReview>(() => analyzeAdvisoryObstacleInteractions(project), [project]);
  const machineBoundaryClearanceRows = useMemo<MachineBoundaryClearanceRow[]>(() => evaluateMachineBoundaryClearance(project, settings), [project, settings]);
  const cornerInputs = useMemo(() => cornerArmInputsForPreview(project, cornerInputDraft,
    settings.layoutReview.requiredBoundaryClearanceMeters), [project, cornerInputDraft, settings.layoutReview.requiredBoundaryClearanceMeters]);
  const [requestedCornerInputs, setRequestedCornerInputs] = useState<typeof cornerInputs | null>(null);
  const cornerArmKinematicResult = useMemo(() => requestedCornerInputs === cornerInputs && cornerInputs.missing.length === 0
    ? evaluateCornerArmKinematics(cornerInputs.inputs) : null, [cornerInputs, requestedCornerInputs]);
  const generatedMultiPivotScenarioReview = useMemo<AdvisoryGeneratedMultiPivotScenarioReview | null>(() => (
    fieldPivotPlan ? buildAdvisoryGeneratedMultiPivotScenarioReview(fieldPivotPlan) : null
  ), [fieldPivotPlan]);
  const bestStrategy = strategyComparison.bestStrategy;
  const benderStrategy = benderStrategyForReview(strategyComparison);
  const reviewZoneAudit = useMemo<AdvisoryGeneratedReviewZoneAudit | null>(() => fieldPivotPlan ? auditGeneratedFieldPivotReviewZones(project, fieldPivotPlan) : null, [fieldPivotPlan, project]);
  const [advisoryReportExportStatus, setAdvisoryReportExportStatus] = useState("Report export has not run.");
  const advisoryDesignReport = useMemo<AdvisoryDesignReport | null>(() => fieldPivotPlan && multiMachineReview && advisoryMachineRenderModel && generatedMultiPivotScenarioReview && reviewZoneAudit ? buildAdvisoryDesignReport({
    project,
    result,
    fieldPivotPlan,
    multiMachineReview,
    strategyComparison,
    obstacleInteractionReview,
    radiusSensitivityReview,
    endGunSensitivityReview,
    sweepEfficiencyReview,
    generatedMultiPivotScenarioReview,
    reviewZoneAudit,
    advisoryMachineRenderAcreLedger: advisoryMachineRenderModel.status === "ready" ? advisoryMachineRenderModel.acreLedger : null,
  }) : null, [advisoryMachineRenderModel, endGunSensitivityReview, fieldPivotPlan, generatedMultiPivotScenarioReview, multiMachineReview, obstacleInteractionReview, project, radiusSensitivityReview, result, reviewZoneAudit, strategyComparison, sweepEfficiencyReview]);

  async function exportAdvisoryDesignReport(): Promise<void> {
    if (!advisoryDesignReport) return;
    try {
      const filename = `${slugIdPart(project.id)}.advisory-design-report.txt`;
      const outcome = await exportFileAsync(filename, advisoryDesignReport.text, { mimeType: "text/plain;charset=utf-8" });
      setAdvisoryReportExportStatus(`${outcome.message} Advisory report is review-only and did not change canonical projected XY or project storage.`);
    } catch (error) {
      setAdvisoryReportExportStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function updateLayoutReview(next: Partial<AppSettings["layoutReview"]>): void {
    onSettingsChange({
      ...settings,
      layoutReview: {
        ...settings.layoutReview,
        ...next,
      },
    });
  }

  return (
    <View style={styles.machineForm}>
      <View style={reportStyles.section} testID="calculation-current-machine-summary">
        <Text style={reportStyles.heading}>Current pivot irrigation area</Text>
        <ReportValue label="Coverage" value={`${result.metrics.coveragePercent.toFixed(1)}%`} />
        <ReportValue label="Irrigated" value={formatAreaFromAcres(result.metrics.irrigatedAcres, settings.unitSystem)} />
        <ReportValue label="Outside field" value={formatAreaFromAcres(result.metrics.outsideFieldAcres, settings.unitSystem)} tone={result.metrics.outsideFieldAcres > 0 ? "danger" : "neutral"} />
      </View>
      {editorError ? <Text style={styles.formError}>{editorError}</Text> : null}
      {advisoryCostInput ? (
        <Text style={styles.mapFeatureMeta} testID="advisory-cost-active-note">
          Equipment prices are temporary planning inputs. They are not saved with the project or verified as dealer quotes.
        </Text>
      ) : null}
      <MachineBoundaryClearancePanel
        onUpdateLayoutReview={updateLayoutReview}
        rows={machineBoundaryClearanceRows}
        settings={settings}
      />
      <CornerArmCalculationInputs project={project} value={cornerInputDraft} onChange={onCornerInputDraftChange}
        missing={cornerInputs.missing} onRun={() => setRequestedCornerInputs(cornerInputs)} />
      {cornerArmKinematicResult ? <CornerArmKinematicStatusPanel
        result={cornerArmKinematicResult}
        settings={settings}
      /> : null}
      <View style={reportStyles.section} testID="advisory-strategy-cost-summary">
        <View style={styles.scenarioRowHeader}>
          <Text style={styles.rowTitle}>Pivot options and equipment cost</Text>
          <Text style={styles.scenarioScore}>{costStatusShortLabel(strategyComparison.costInputStatus)}</Text>
        </View>
        <Text style={styles.rowMeta}>
          {bestStrategy
            ? `${bestStrategy.label} · ${formatAreaFromAcres(bestStrategy.irrigatedAcres, settings.unitSystem)} modeled · ${bestStrategy.costAssessment ? formatCostAssessment(bestStrategy.costAssessment) : "Cost efficiency pending."}`
            : "No advisory machine strategy is ready for cost comparison."}
        </Text>
        <Text style={styles.mapFeatureMeta}>Equipment estimates use the prices entered above. They exclude annual operating costs and are not purchase recommendations.</Text>
        <AdvisoryCostAcresComparisonTable
          settings={settings}
          strategies={strategyComparison.strategies}
        />
        <AdvisoryRadiusSensitivityTable
          review={radiusSensitivityReview}
          settings={settings}
        />
        <AdvisoryEndGunSensitivityTable
          review={endGunSensitivityReview}
          settings={settings}
        />
        <AdvisorySweepEfficiencyTable
          review={sweepEfficiencyReview}
          settings={settings}
        />
        {benderStrategy ? (
          <Text style={styles.mapFeatureMeta} testID="advisory-bender-strategy-summary">
            {formatBenderStrategySummary(benderStrategy, settings)}
          </Text>
        ) : null}
      </View>
      <View style={reportStyles.section} testID="advisory-obstacle-interaction-summary">
        <View style={styles.scenarioRowHeader}>
          <Text style={styles.rowTitle}>Obstacles and clearances</Text>
          <Text style={styles.scenarioScore}>{obstacleInteractionReview.status.replaceAll("_", " ")}</Text>
        </View>
        <Text style={styles.rowMeta}>{formatObstacleInteractionSummary(obstacleInteractionReview)}</Text>
        <Text style={styles.mapFeatureMeta}>{formatFirstObstacleInteraction(obstacleInteractionReview)}</Text>
        <Text style={styles.mapFeatureMeta}>Estimated from mapped obstacles. Clearances need to be checked in the field before operation.</Text>
      </View>
      {multiMachineReview ? <View style={reportStyles.section} testID="advisory-full-scope-boundary-summary">
        <View style={styles.scenarioRowHeader}>
          <Text style={styles.rowTitle}>Whole-field coverage</Text>
          <Text style={styles.scenarioScore}>{multiMachineReview.compilation.fullScopeCoveragePercent.toFixed(1)}%</Text>
        </View>
        <Text style={styles.rowMeta}>{formatFullScopeBoundarySummary(multiMachineReview, settings)}</Text>
        <Text style={styles.mapFeatureMeta}>Estimated from the mapped layouts. The saved boundary and equipment remain unchanged.</Text>
      </View> : null}
      {advisoryMachineRenderModel && multiMachineReview ? <AdvisoryEvidenceStatusPanel
        advisoryMachineRenderModel={advisoryMachineRenderModel}
        multiMachineReview={multiMachineReview}
        project={project}
        result={result}
        settings={settings}
        surface="calculate"
      /> : null}
      {fieldPivotPlan && reviewZoneAudit && generatedMultiPivotScenarioReview ? <View style={reportStyles.section} testID="advisory-generated-field-pivot-plan">
        <View style={styles.scenarioRowHeader}>
          <Text style={styles.rowTitle}>Proposed pivot layout</Text>
          <Text style={styles.scenarioScore}>{fieldPivotPlan.selectedMachineCount}/{fieldPivotPlan.requestedMachineCount}</Text>
        </View>
        <Text style={styles.rowMeta}>{formatGeneratedFieldPivotPlanSummary(fieldPivotPlan, settings)}</Text>
        <Text style={styles.mapFeatureMeta}>
          Proposed locations are not saved pivots. Save Review Zones saves their outlines for comparison without changing the active pivot.
        </Text>
        <Text style={styles.mapFeatureMeta} testID="generated-field-pivot-zone-save-status">Review zones: {reviewZoneAudit.currentCount} current / {reviewZoneAudit.missingCount} missing / {reviewZoneAudit.staleCount} stale</Text>
        <GeneratedMultiPivotScenarioTable
          review={generatedMultiPivotScenarioReview}
          settings={settings}
        />
        <View style={styles.inlineActions}>
          <SmallActionButton
            disabled={fieldPivotPlan.selectedMachineCount === 0}
            label="Save Review Zones"
            onPress={() => onSaveGeneratedFieldPivotZones(fieldPivotPlan)}
            testID="save-generated-field-pivot-zones"
          />
        </View>
      </View> : null}
      {advisoryDesignReport && reviewZoneAudit ? <View style={reportStyles.section} testID="advisory-design-report-panel">
        <View style={styles.scenarioRowHeader}>
          <Text style={styles.rowTitle}>Advisory Design Report</Text>
          <Text style={styles.scenarioScore}>{advisoryDesignReport.readiness.replaceAll("_", " ")}</Text>
        </View>
        <Text style={styles.rowMeta} testID="advisory-design-report-headline">{advisoryDesignReport.headline}</Text>
        <Text style={styles.mapFeatureMeta} testID="advisory-review-zone-audit-summary">
          Review-zone audit: {reviewZoneAudit.currentCount} current, {reviewZoneAudit.missingCount} missing, {reviewZoneAudit.staleCount} stale.
        </Text>
        <Text style={styles.mapFeatureMeta}>
          The generated report is a local review packet only. It does not create pivots, certify a design, quote equipment, mutate canonical projected XY, or save into project archives.
        </Text>
        <View style={styles.codeBlock}>
          <Text style={styles.codeText} numberOfLines={10} testID="advisory-design-report-preview">
            {advisoryDesignReport.text}
          </Text>
        </View>
        <View style={styles.inlineActions}>
          <SmallActionButton label="Export Report" onPress={exportAdvisoryDesignReport} testID="export-advisory-design-report" />
        </View>
        <Text style={styles.mapFeatureMeta} testID="advisory-design-report-export-status">{advisoryReportExportStatus}</Text>
      </View> : null}
      <IdealCenterSummary analysis={idealCenterAnalysis} onRequestApplyPivotCandidate={onRequestApplyPivotCandidate} settings={settings} />
      <ScenarioPreviewList preview={preview} settings={settings} report />
      <PlacementReviewPanel analysis={idealCenterAnalysis} candidates={placementCandidates} onRequestApplyPivotCandidate={onRequestApplyPivotCandidate} settings={settings} />
    </View>
  );
}

function GeneratedMultiPivotScenarioTable({
  review,
  settings,
}: {
  review: AdvisoryGeneratedMultiPivotScenarioReview;
  settings: AppSettings;
}): React.JSX.Element {
  if (review.rows.length === 0) {
    return (
      <Text style={styles.mapFeatureMeta} testID="advisory-generated-multi-pivot-scenario-review">
        Generated multi-pivot scenario review needs at least one separated advisory center; no saved pivots, runtime collision prevention, or storage records are created.
      </Text>
    );
  }

  return (
    <View style={styles.costComparisonTable} testID="advisory-generated-multi-pivot-scenario-review">
      <View style={styles.scenarioRowHeader}>
        <Text style={styles.rowTitle}>Generated Multi-Pivot Scenario Review</Text>
        <Text style={styles.scenarioScore}>{review.status.replaceAll("_", " ")}</Text>
      </View>
      <Text style={styles.mapFeatureMeta}>
        {review.selectedCenterCount}/{review.requestedMachineCount} selected centers · {formatAreaFromAcres(review.modeledIrrigatedUnionAcres, settings.unitSystem)} modeled union · {formatAreaFromAcres(review.duplicateModeledCoverageAcres, settings.unitSystem)} overlap · cost evidence {costStatusShortLabel(review.costInputStatus)}.
      </Text>
      <Text style={styles.mapFeatureMeta}>
        Tightest selected separation margin: {review.tightestSelectedSeparationMarginMeters === null ? "first center" : formatDistance(review.tightestSelectedSeparationMarginMeters, settings.unitSystem)} · rejected by separation: {review.rejectedForSeparationCount}.
      </Text>
      <View style={styles.costComparisonHeader}>
        <Text style={styles.costComparisonHeaderText}>Generated center</Text>
        <Text style={styles.costComparisonHeaderText}>Adds</Text>
        <Text style={styles.costComparisonHeaderText}>Margin</Text>
      </View>
      {review.rows.slice(0, 4).map((row) => (
        <View key={row.candidateId} style={styles.costComparisonRow} testID={`advisory-generated-multi-pivot-row-${row.sequence}`}>
          <View style={styles.costComparisonStrategyCell}>
            <Text style={styles.costComparisonStrategy}>Center {row.sequence}</Text>
            <Text style={styles.costComparisonMeta}>{row.costStatus.replaceAll("_", " ")} · score {row.placementScore.toFixed(1)}</Text>
          </View>
          <Text style={styles.costComparisonValue}>{formatAreaFromAcres(row.incrementalIrrigatedAcres, settings.unitSystem)}</Text>
          <Text style={styles.costComparisonValue}>{row.separationMarginMeters === null ? "first" : formatDistance(row.separationMarginMeters, settings.unitSystem)}</Text>
        </View>
      ))}
      {review.rejectedRows.length > 0 ? (
        <Text style={styles.mapFeatureMeta}>
          Largest rejected separation deficit: {review.largestSeparationDeficitMeters === null ? "none" : formatDistance(review.largestSeparationDeficitMeters, settings.unitSystem)}. Rejections are conservative advisory screening only.
        </Text>
      ) : null}
      <Text style={styles.mapFeatureMeta}>
        This scenario review is advisory only; it does not create saved pivots, runtime collision controls, vendor quotes, or canonical projected XY changes.
      </Text>
    </View>
  );
}

function AdvisoryCostAcresComparisonTable({
  settings,
  strategies,
}: {
  settings: AppSettings;
  strategies: AdvisoryMachineStrategyResult[];
}): React.JSX.Element {
  const rows = advisoryCostComparisonRows(strategies);

  if (rows.length === 0) {
    return (
      <Text style={styles.mapFeatureMeta} testID="advisory-cost-acres-comparison">
        Cost-vs-acres comparison needs a ready advisory strategy before rows can be shown.
      </Text>
    );
  }

  return (
    <View style={styles.costComparisonTable} testID="advisory-cost-acres-comparison">
      <View style={styles.costComparisonHeader}>
        <Text style={styles.costComparisonHeaderText}>Strategy</Text>
        <Text style={styles.costComparisonHeaderText}>Modeled acres</Text>
        <Text style={styles.costComparisonHeaderText}>Cost / acre</Text>
      </View>
      {rows.map((row) => (
        <View key={row.key} style={styles.costComparisonRow} testID={`advisory-cost-row-${row.key}`}>
          <View style={styles.costComparisonStrategyCell}>
            <Text style={styles.costComparisonStrategy}>{row.label}</Text>
            <Text style={styles.costComparisonMeta}>{row.strategy.status.replaceAll("_", " ")} · {row.strategy.coveragePercent.toFixed(1)}%</Text>
          </View>
          <Text style={styles.costComparisonValue}>{formatAreaFromAcres(row.strategy.irrigatedAcres, settings.unitSystem)}</Text>
          <Text style={styles.costComparisonValue}>{formatStrategyCostPerAcre(row.strategy)}</Text>
        </View>
      ))}
    </View>
  );
}

function advisoryCostComparisonRows(
  strategies: AdvisoryMachineStrategyResult[],
): Array<{ key: string; label: string; strategy: AdvisoryMachineStrategyResult }> {
  const readyOrFirst = (kind: AdvisoryMachineStrategyResult["strategyKind"]): AdvisoryMachineStrategyResult | null => (
    strategies.find((strategy) => strategy.strategyKind === kind && strategy.status === "ready")
    ?? strategies.find((strategy) => strategy.strategyKind === kind)
    ?? null
  );
  const rows = [
    { key: "current-machine", label: "Current", strategy: readyOrFirst("current_machine") },
    { key: "full-circle", label: "Full circle", strategy: readyOrFirst("full_circle_radius") ?? readyOrFirst("full_circle_same_radius") },
    { key: "linear-lateral", label: "Linear/lateral", strategy: readyOrFirst("linear_lateral_move") },
    { key: "bender-second-pivot", label: "Bender", strategy: readyOrFirst("bender_second_pivot") },
  ];
  return rows.filter((row): row is { key: string; label: string; strategy: AdvisoryMachineStrategyResult } => Boolean(row.strategy));
}

function AdvisoryRadiusSensitivityTable({
  review,
  settings,
}: {
  review: AdvisoryRadiusSensitivityReview | null;
  settings: AppSettings;
}): React.JSX.Element {
  if (!review) {
    return (
      <Text style={styles.mapFeatureMeta} testID="advisory-radius-sensitivity-table">
        Comparing different pivot lengths requires the length-and-tower estimate. A price for one pivot cannot price different equipment.
      </Text>
    );
  }

  const rows = review.rows;

  if (rows.length === 0) {
    return (
      <Text style={styles.mapFeatureMeta} testID="advisory-radius-sensitivity-table">
        Radius alternatives need a current machine radius before advisory rows can be shown.
      </Text>
    );
  }

  return (
    <View style={styles.radiusSensitivityTable} testID="advisory-radius-sensitivity-table">
      <View style={styles.scenarioRowHeader}>
        <Text style={styles.rowTitle}>Radius Alternatives</Text>
        <Text style={styles.scenarioScore}>{review.readyRowCount}/{review.rowCount} ready</Text>
      </View>
      <Text style={[styles.mapFeatureMeta, styles.radiusSensitivityMeta]}>
        Radius alternatives compare generated full-circle planning templates against current, full-scope, zone, and local cost evidence. They do not change machine settings, create a quote, or mutate canonical projected XY.
      </Text>
      {review.bestByCostPerAcre ? (
        <Text style={[styles.mapFeatureMeta, styles.radiusSensitivityMeta]}>
          Best local cost row: {formatDistance(review.bestByCostPerAcre.radiusMeters, settings.unitSystem)} at {formatRadiusSensitivityCostPerAcre(review.bestByCostPerAcre)}.
        </Text>
      ) : null}
      <View style={styles.costComparisonHeader}>
        <Text style={styles.costComparisonHeaderText}>Radius Review</Text>
        <Text style={styles.costComparisonHeaderText}>Radius</Text>
        <Text style={styles.costComparisonHeaderText}>Cost / acre</Text>
      </View>
      {rows.map((row) => (
        <View key={radiusSensitivityRowKey(row)} style={styles.costComparisonRow} testID={`advisory-radius-row-${radiusSensitivityRowKey(row)}`}>
          <View style={styles.costComparisonStrategyCell}>
            <Text style={styles.costComparisonStrategy}>{row.label}</Text>
            <Text style={styles.costComparisonMeta}>
              {formatAreaFromAcres(row.irrigatedAcres, settings.unitSystem)} · current {row.coveragePercent.toFixed(1)}% · full-scope {row.fullScopeCoveragePercent.toFixed(1)}% · zones {row.readyScenarioCount}/{row.scenarioCount}
            </Text>
          </View>
          <Text style={styles.costComparisonValue}>{formatDistance(row.radiusMeters, settings.unitSystem)}</Text>
          <Text style={styles.costComparisonValue}>{formatRadiusSensitivityCostPerAcre(row)}</Text>
        </View>
      ))}
    </View>
  );
}

function AdvisoryEndGunSensitivityTable({
  review,
  settings,
}: {
  review: AdvisoryEndGunSensitivityReview;
  settings: AppSettings;
}): React.JSX.Element {
  const rows = review.rows;

  if (rows.length === 0) {
    return (
      <Text style={styles.mapFeatureMeta} testID="advisory-end-gun-sensitivity-table">
        End-gun throw alternatives need at least one nonnegative throw distance before advisory rows can be shown.
      </Text>
    );
  }

  return (
    <View style={styles.radiusSensitivityTable} testID="advisory-end-gun-sensitivity-table">
      <View style={styles.scenarioRowHeader}>
        <Text style={styles.rowTitle}>End-Gun Throw Alternatives</Text>
        <Text style={styles.scenarioScore}>{review.readyRowCount}/{review.rowCount} ready</Text>
      </View>
      <Text style={[styles.mapFeatureMeta, styles.radiusSensitivityMeta]}>
        End-gun alternatives compare throw-distance assumptions with the current pivot, sweep, shutoff arcs, field, and obstacle evidence. They do not edit End Gun settings, change storage, or prove pressure, wind, nozzle package, hydraulic limits, or vendor shutoff constraints.
      </Text>
      {review.bestByIncrementalAcres ? (
        <Text style={[styles.mapFeatureMeta, styles.radiusSensitivityMeta]}>
          Best modeled added acres: {review.bestByIncrementalAcres.label} at +{formatAreaFromAcres(review.bestByIncrementalAcres.incrementalIrrigatedAcres, settings.unitSystem)}.
        </Text>
      ) : null}
      <View style={styles.costComparisonHeader}>
        <Text style={styles.costComparisonHeaderText}>Throw Review</Text>
        <Text style={styles.costComparisonHeaderText}>Throw</Text>
        <Text style={styles.costComparisonHeaderText}>Added</Text>
      </View>
      {rows.map((row) => (
        <View key={endGunSensitivityRowKey(row)} style={styles.costComparisonRow} testID={`advisory-end-gun-row-${endGunSensitivityRowKey(row)}`}>
          <View style={styles.costComparisonStrategyCell}>
            <Text style={styles.costComparisonStrategy}>{row.label}</Text>
            <Text style={styles.costComparisonMeta}>
              {formatAreaFromAcres(row.endGunAcres, settings.unitSystem)} end-gun · {row.coveragePercent.toFixed(1)}% coverage · outside {formatAreaFromAcres(row.outsideFieldAcres, settings.unitSystem)} · conflicts {row.obstacleConflictCount}/{row.hardMechanicalConflictCount}
            </Text>
          </View>
          <Text style={styles.costComparisonValue}>{formatDistance(row.throwMeters, settings.unitSystem)}</Text>
          <Text style={styles.costComparisonValue}>{formatAreaFromAcres(row.incrementalIrrigatedAcres, settings.unitSystem)}</Text>
        </View>
      ))}
    </View>
  );
}

function AdvisorySweepEfficiencyTable({
  review,
  settings,
}: {
  review: AdvisorySweepEfficiencyReview;
  settings: AppSettings;
}): React.JSX.Element {
  if (review.status === "no_boundary" || review.status === "no_machine_radius") {
    return (
      <Text style={styles.mapFeatureMeta} testID="advisory-sweep-efficiency-table">
        Sweep-efficiency review needs a field boundary and positive machine radius before advisory rows can be shown.
      </Text>
    );
  }

  if (review.status === "current_full_circle") {
    return (
      <Text style={styles.mapFeatureMeta} testID="advisory-sweep-efficiency-table">
        Sweep Efficiency: current machine is already full circle; part-circle cost-per-acre comparison is informational only and does not change machine settings.
      </Text>
    );
  }

  return (
    <View style={styles.radiusSensitivityTable} testID="advisory-sweep-efficiency-table">
      <View style={styles.scenarioRowHeader}>
        <Text style={styles.rowTitle}>Sweep Efficiency</Text>
        <Text style={styles.scenarioScore}>{review.readyRowCount}/{review.rowCount} ready</Text>
      </View>
      <Text style={[styles.mapFeatureMeta, styles.radiusSensitivityMeta]}>
        Sweep efficiency compares the current part-circle machine with same-radius and shorter full-circle planning rows. It uses local cost assumptions only and does not create a quote, purchase recommendation, hydraulic design, or machine-setting change.
      </Text>
      {review.bestShorterComparableFullCircleRow ? (
        <Text style={[styles.mapFeatureMeta, styles.radiusSensitivityMeta]}>
          Shorter comparable row: {review.bestShorterComparableFullCircleRow.label} at {formatAreaFromAcres(review.bestShorterComparableFullCircleRow.irrigatedAcres, settings.unitSystem)} modeled and {formatSweepEfficiencyDelta(review.bestShorterComparableFullCircleRow)}.
        </Text>
      ) : null}
      <View style={styles.costComparisonHeader}>
        <Text style={styles.costComparisonHeaderText}>Sweep Review</Text>
        <Text style={styles.costComparisonHeaderText}>Radius</Text>
        <Text style={styles.costComparisonHeaderText}>Cost / acre</Text>
      </View>
      {review.rows.map((row) => (
        <View key={sweepEfficiencyRowKey(row)} style={styles.costComparisonRow} testID={`advisory-sweep-row-${sweepEfficiencyRowKey(row)}`}>
          <View style={styles.costComparisonStrategyCell}>
            <Text style={styles.costComparisonStrategy}>{row.label}</Text>
            <Text style={styles.costComparisonMeta}>
              {formatAreaFromAcres(row.irrigatedAcres, settings.unitSystem)} · delta {formatAreaFromAcres(row.irrigatedAcresDeltaFromCurrent, settings.unitSystem)} · outside {formatAreaFromAcres(row.outsideFieldAcres, settings.unitSystem)} · {row.comparableToCurrentAcres ? "comparable acres" : "below 95% current acres"}
            </Text>
          </View>
          <Text style={styles.costComparisonValue}>{formatDistance(row.radiusMeters, settings.unitSystem)}</Text>
          <Text style={styles.costComparisonValue}>{formatCostPerAcreAssessment(row.cost)}</Text>
        </View>
      ))}
    </View>
  );
}

function radiusSensitivityRowKey(row: AdvisoryRadiusSensitivityRow): string {
  return `radius-${row.radiusMeters.toFixed(2).replace(".", "-")}`;
}

function endGunSensitivityRowKey(row: AdvisoryEndGunSensitivityRow): string {
  return `throw-${row.throwMeters.toFixed(2).replace(".", "-")}`;
}

function sweepEfficiencyRowKey(row: AdvisorySweepEfficiencyRow): string {
  return `${row.kind}-${row.radiusMeters.toFixed(2).replace(".", "-")}`;
}

function formatSweepEfficiencyDelta(row: AdvisorySweepEfficiencyRow): string {
  if (row.estimatedCostDeltaFromCurrent === null) return costStatusShortLabel(row.cost.status);
  const sign = row.estimatedCostDeltaFromCurrent >= 0 ? "+" : "-";
  return `${sign}${row.cost.currencyCode} ${Math.abs(row.estimatedCostDeltaFromCurrent).toFixed(0)} total`;
}

function formatRadiusSensitivityCostPerAcre(row: AdvisoryRadiusSensitivityRow): string {
  if (row.cost.status === "complete" && row.cost.costPerIrrigatedAcre !== null) {
    return `${row.cost.currencyCode} ${row.cost.costPerIrrigatedAcre.toFixed(0)}/ac`;
  }
  return costStatusShortLabel(row.cost.status);
}

function formatStrategyCostPerAcre(strategy: AdvisoryMachineStrategyResult): string {
  return formatCostPerAcreAssessment(strategy.costAssessment);
}

function formatCostPerAcreAssessment(assessment: AdvisoryCostAssessment | null | undefined): string {
  if (assessment?.status === "complete" && assessment.costPerIrrigatedAcre !== null) {
    return `${assessment.currencyCode} ${assessment.costPerIrrigatedAcre.toFixed(0)}/ac`;
  }
  if (assessment) return costStatusShortLabel(assessment.status);
  return "Pending";
}

function AdvisoryCostReviewPanel({
  draft,
  machine,
  onChange,
}: {
  draft: AdvisoryCostDraft;
  machine: PivotMachine;
  onChange: (draft: AdvisoryCostDraft) => void;
}): React.JSX.Element {
  const status = advisoryCostDraftStatus(draft);
  const priceNeedsReview = advisoryCostPriceNeedsReview(draft, machine);
  const statusTone = priceNeedsReview ? "warn" : status === "complete" ? "good" : status === "invalid_cost_input" ? "danger" : "warn";

  function update(field: "baseCost" | "costPerFoot" | "costPerTower" | "currencyCode" | "includes", value: string): void {
    onChange({ ...draft, [field]: field === "currencyCode" ? value.toUpperCase().slice(0, 8) : value });
  }

  function clear(): void {
    onChange(EMPTY_ADVISORY_COST_DRAFT);
  }

  return (
    <View style={reportStyles.section} testID="advisory-cost-review-panel">
      <View style={styles.scenarioRowHeader}>
        <Text style={reportStyles.heading}>Pivot equipment cost</Text>
      </View>
      <View style={styles.reportPricingChoices} accessibilityRole="radiogroup" accessibilityLabel="Pricing method">
        {([{ value: "machine_price", label: "Price for this pivot" },
          { value: "length_tower_estimate", label: "Estimate by length and towers" }] as const).map(option => (
          <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
            accessibilityState={{ checked: draft.basis === option.value }} aria-checked={draft.basis === option.value}
            onPress={() => onChange({ ...draft, basis: option.value })} style={styles.reportPricingChoice}
            testID={`advisory-cost-basis-${option.value}`}>
            {draft.basis === option.value ? <CircleDot size={20} color="#155c75" /> : <Circle size={20} color="#42525a" />}
            <Text style={reportStyles.note}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      <ReportNotice>Planning estimate only. Well, pump and power supply are separate unless listed in the price below. Annual operating costs are not calculated.</ReportNotice>
      <View testID="advisory-cost-form">
        <ReportField text label="Currency" onChangeText={(value) => update("currencyCode", value)} testID="advisory-cost-currency" value={draft.currencyCode} />
        {draft.basis === "machine_price" ? (
          <ReportField label="Price for this pivot" onChangeText={value => onChange(updateMachinePrice(draft, value, machine))}
            testID="advisory-cost-pivot-price" value={draft.machinePrice} />
        ) : <>
          <ReportField label="Base equipment amount" onChangeText={(value) => update("baseCost", value)} testID="advisory-cost-fixed" value={draft.baseCost} />
          <ReportField label="Additional cost per foot of pivot" onChangeText={(value) => update("costPerFoot", value)} testID="advisory-cost-per-foot" value={draft.costPerFoot} />
          <ReportField label="Additional cost per drive tower" onChangeText={(value) => update("costPerTower", value)} testID="advisory-cost-per-tower" value={draft.costPerTower} />
        </>}
        <ReportField text label="Equipment and work included" onChangeText={value => update("includes", value)} testID="advisory-cost-includes" value={draft.includes} />
      </View>
      <View style={styles.inlineActions}>
        <IconCommandButton id="advisory-cost-clear" icon={<RotateCcw />} label="Clear cost inputs" onPress={clear} testID="advisory-cost-clear" />
      </View>
      <ReportNotice tone={statusTone} testID="advisory-cost-status">
        {priceNeedsReview ? "The pivot equipment has changed. Re-enter its price after checking the included equipment. The earlier price is not being used." : advisoryCostDraftMessage(draft, status)}
      </ReportNotice>
    </View>
  );
}

function LayersSheet({
  mapPackages,
  onOpenFiles,
  onSettingsChange,
  project,
  settings,
}: {
  mapPackages: MapPackageManifest[];
  onOpenFiles: () => void;
  onSettingsChange: (settings: AppSettings) => void;
  project: PivotProject;
  settings: AppSettings;
}): React.JSX.Element {
  const [mapAppStatus, setMapAppStatus] = useState<string | null>(null);
  const mapLibreTarget = Platform.OS === "android"
    ? "android_maplibre_rn"
    : Platform.OS === "ios"
      ? "ios_maplibre_rn"
      : "web_maplibre_gl_js";
  const aerialCandidates = listAerialImageryCandidates({ mapPackages, target: mapLibreTarget });
  const referenceView = useMemo(
    () => buildMapReferenceViewModel({
      settings,
      mapPackages,
      target: mapLibreTarget,
      surface: "workbench",
    }),
    [mapLibreTarget, mapPackages, settings.aerialImagery, settings.onlineImagery, settings.referenceOverlay],
  );
  const aerialMode = { usgs_live_preview: "USGS only", off: "Off", manual_local: "Manual local", auto_local: "Auto" }[referenceView.aerialWorkflow];
  const aerialStatus = referenceView.aerialSummary;

  function setAerialMode(mode: "off" | "auto" | "manual" | "usgs_live_preview"): void {
    if (mode === "usgs_live_preview") {
      onSettingsChange({
        ...settings,
        aerialImagery: { ...settings.aerialImagery, mode: "off" },
        onlineImagery: { ...settings.onlineImagery, enabled: true, providerId: "usgs_imagery_only" },
      });
      return;
    }
    if (mode === "auto") {
      onSettingsChange({
        ...settings,
        aerialImagery: { ...settings.aerialImagery, mode: "auto" },
        onlineImagery: { ...settings.onlineImagery, enabled: true, providerId: "usgs_imagery_only" },
      });
      return;
    }
    onSettingsChange({
      ...settings,
      aerialImagery: { ...settings.aerialImagery, mode },
      onlineImagery: { ...settings.onlineImagery, enabled: false },
    });
  }

  async function openAndroidMapApp(): Promise<void> {
    if (Platform.OS !== "android") {
      setMapAppStatus("External map handoff is Android-only.");
      return;
    }
    try {
      const center = project.wgs84Companion?.pivotCenter ?? projectXyToLonLat(project.pivotCenter, project.projectCrs);
      const label = encodeURIComponent(`${project.name} pivot reference`);
      const url = `geo:0,0?q=${center.latitude.toFixed(7)},${center.longitude.toFixed(7)}(${label})`;
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        setMapAppStatus("No installed map app accepted the geo handoff.");
        return;
      }
      await Linking.openURL(url);
      setMapAppStatus("Opened external map app as a reference handoff.");
    } catch (error) {
      setMapAppStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <View style={styles.machineForm}>
      <View style={styles.metricGrid}>
        <MetricTile label="Aerial imagery" value={aerialMode} />
        <MetricTile label="Reference overlay" value={settings.referenceOverlay.mode === "off" ? "Off" : settings.referenceOverlay.mode} />
        <MetricTile label="Coordinate display" value={COORDINATE_FORMAT_LABELS[settings.coordinateDisplayFormat]} />
      </View>
      <View style={styles.layerGroupGrid} testID="places-layers-summary">
        <LayerGroupCard
          title="Canonical Geometry"
          detail={`${project.fieldBoundary.length} boundary vertices · ${project.obstacles.length} obstacle polygons · ${(project.mapFeatures ?? []).length} map features`}
          meta={`${project.projectCrs} projected XY remains the editable project geometry.`}
        />
        <LayerGroupCard
          title="Map Packages"
          detail={mapPackages.length > 0 ? `${mapPackages.length} imported package${mapPackages.length === 1 ? "" : "s"}` : "No imported local package"}
          meta="Logical package metadata can be saved; runtime file paths stay local to this install."
        />
        <LayerGroupCard
          title="Live Preview Imagery"
          detail={aerialMode}
          meta={aerialStatus}
        />
        <LayerGroupCard
          title="Reference Overlays"
          detail={referenceView.referenceSummary}
          meta={`${referenceView.evidenceLabel} · ${referenceView.runtimeLabel ?? "Overlay toggles are reference display controls, not project geometry visibility state."}`}
        />
      </View>
      <Text style={styles.mapFeatureMeta}>
        Auto uses a renderable local raster package first, then the no-key USGS ImageryOnly connected preview. USGS only turns local aerial off and remains a reference handoff outside project ZIPs.
      </Text>
      <Text style={styles.mapFeatureMeta}>
        {aerialStatus}
      </Text>
      <View style={styles.inlineActions}>
        <SmallActionButton
          label="Aerial Off"
          onPress={() => setAerialMode("off")}
        />
        <SmallActionButton
          label="Auto"
          onPress={() => setAerialMode("auto")}
        />
        <SmallActionButton
          label="Manual Local"
          onPress={() => setAerialMode("manual")}
        />
        <SmallActionButton
          label="USGS Only"
          onPress={() => setAerialMode("usgs_live_preview")}
        />
        {Platform.OS === "android" ? (
          <SmallActionButton
            label="Open Maps App"
            onPress={() => void openAndroidMapApp()}
          />
        ) : null}
        <SmallActionButton
          label={settings.referenceOverlay.mode === "off" ? "Overlay On" : "Overlay Off"}
          onPress={() => onSettingsChange({ ...settings, referenceOverlay: { ...settings.referenceOverlay, mode: settings.referenceOverlay.mode === "off" ? "manual" : "off" } })}
        />
        <SmallActionButton label="Import / Export" onPress={onOpenFiles} />
      </View>
      {mapAppStatus ? <Text style={styles.mapFeatureMeta}>{mapAppStatus}</Text> : null}
      {settings.aerialImagery.mode === "manual" && !settings.onlineImagery.enabled ? (
        <Text style={styles.mapFeatureMeta}>
          {aerialCandidates.length > 0
            ? `Manual local aerial candidates: ${aerialCandidates.map((candidate) => candidate.packageName).join(", ")}. Choose the exact package in Settings.`
            : "Manual local aerial needs an imported raster package with local TileJSON or tile URL templates."}
        </Text>
      ) : null}
    </View>
  );
}

function LayerGroupCard({ detail, meta, title }: { detail: string; meta: string; title: string }): React.JSX.Element {
  return (
    <View style={styles.layerGroupCard}>
      <Text style={styles.mapFeatureTitle}>{title}</Text>
      <Text style={styles.mapFeatureMeta}>{detail}</Text>
      <Text style={styles.dashboardMuted}>{meta}</Text>
    </View>
  );
}

const GUIDED_MANUAL_DESIGN_STEPS: Array<{ id: Exclude<ManualDesignStep, "apply">; label: string }> = [
  { id: "boundary", label: "Boundary" },
  { id: "pivot", label: "Pivot" },
  { id: "last_wheel", label: "Last Wheel" },
  { id: "machine_end", label: "Machine End" },
  { id: "review", label: "Review" },
];

const MANUAL_DESIGN_SOURCE_OPTIONS: Record<Exclude<ManualDesignStep, "review" | "apply">, Array<{ id: ManualDesignInputSource; label: string }>> = {
  boundary: [
    { id: "map_click", label: "Map clicks" },
    { id: "projected_xy", label: "Projected XY" },
    { id: "rtk_evidence", label: "RTK" },
    { id: "imported_evidence", label: "Imported" },
  ],
  pivot: [
    { id: "map_click", label: "Map click" },
    { id: "projected_xy", label: "Projected XY" },
    { id: "wgs84", label: "WGS84" },
    { id: "rtk_evidence", label: "RTK" },
    { id: "imported_evidence", label: "Imported" },
  ],
  last_wheel: [
    { id: "map_click", label: "Map click" },
    { id: "machine_specs", label: "Machine specs" },
    { id: "rtk_evidence", label: "RTK radius" },
    { id: "imported_evidence", label: "Imported" },
  ],
  machine_end: [
    { id: "map_click", label: "Map click" },
    { id: "machine_specs", label: "Machine specs" },
    { id: "rtk_evidence", label: "RTK radius" },
    { id: "imported_evidence", label: "Imported" },
  ],
};

function ManualDesignTransactionPanel({
  mapCapture,
  onApply,
  onOpenRtk,
  onRequestMapCapture,
  project,
  projectRevision,
  unitSystem,
}: {
  mapCapture: (ManualDesignMapCapture & { sequence: number }) | null;
  onApply: (draft: ManualDesignDraft) => boolean;
  onOpenRtk: () => void;
  onRequestMapCapture: (role: ManualDesignMapCaptureRole | null) => void;
  project: PivotProject;
  projectRevision: number;
  unitSystem: PivotProject["unitSystem"];
}): React.JSX.Element {
  const inputRetention = useInputRetention();
  const source = useMemo(() => ({ draft: createManualDesignDraft(project, projectRevision),
    spanRows: project.machine.spanLengthsMeters.map(span => formatDistanceInputValue(span, unitSystem)),
    overhang: formatDistanceInputValue(project.machine.overhangMeters, unitSystem),
    endGunThrow: formatDistanceInputValue(project.machine.endGunThrowMeters, unitSystem) }), [project.id, unitSystem]);
  const [activeStep, setActiveStep] = useState<Exclude<ManualDesignStep, "apply">>("boundary");
  const [draft, setDraft] = useRetainedInput<ManualDesignDraft>("manual:draft", source.draft);
  const [spanRows, setSpanRows] = useRetainedInput("manual:spanRows", source.spanRows);
  const [overhang, setOverhang] = useRetainedInput("manual:overhang", source.overhang);
  const [endGunThrow, setEndGunThrow] = useRetainedInput("manual:endGunThrow", source.endGunThrow);
  const [status, setStatus] = useState("Preview only. Apply creates one project revision and one undo entry.");
  const readiness = useMemo(() => evaluateManualDesignReadiness(draft), [draft]);
  const pathSummary = draft.machine ? buildMachinePathSummary(draft.machine.value) : null;
  const radiusMeasurementFeatures = (project.mapFeatures ?? []).filter((feature) => feature.kind === "measurement_line" && feature.geometry.type === "LineString");
  const stale = draft.baseRevision !== projectRevision;


  useEffect(() => {
    if (!mapCapture) return;
    if (mapCapture.role === "boundary") {
      if (mapCapture.vertices) {
        setDraft((current) => ({
          ...current,
          boundary: { vertices: mapCapture.vertices ?? [], source: "map_click" },
        }));
        setStatus(`${mapCapture.vertices.length} map-click boundary vertices staged. Project geometry is unchanged.`);
      }
      return;
    }
    if (!mapCapture.point) return;
    if (mapCapture.role === "pivot") {
      setDraft((current) => ({ ...current, pivot: { point: mapCapture.point!, source: "map_click" } }));
      setStatus("Map-click pivot staged. Project geometry is unchanged.");
      return;
    }
    stageRadiusPoint(mapCapture.point, mapCapture.role);
  }, [mapCapture?.sequence]);

  function resetFromProject(): void {
    setDraft(createManualDesignDraft(project, projectRevision));
    setSpanRows(project.machine.spanLengthsMeters.map((span) => formatDistanceInputValue(span, unitSystem)));
    setOverhang(formatDistanceInputValue(project.machine.overhangMeters, unitSystem));
    setEndGunThrow(formatDistanceInputValue(project.machine.endGunThrowMeters, unitSystem));
    for (const key of ["draft", "spanRows", "overhang", "endGunThrow"]) inputRetention.markClean(`manual:${key}`);
    setActiveStep("boundary");
    setStatus("Draft reset from the current project.");
  }

  function selectSource(source: ManualDesignInputSource): void {
    setDraft((current) => {
      if (activeStep === "boundary" && current.boundary) return { ...current, boundary: { ...current.boundary, source } };
      if (activeStep === "pivot" && current.pivot) return { ...current, pivot: { ...current.pivot, source } };
      if (activeStep === "last_wheel" && current.machine) return { ...current, machine: { ...current.machine, lastWheelSource: source } };
      if (activeStep === "machine_end" && current.machine) return { ...current, machine: { ...current.machine, machineEndSource: source } };
      return current;
    });
    if (source === "map_click" && activeStep !== "review") {
      onRequestMapCapture(activeStep);
      setStatus(`Map capture armed for ${activeStep.replaceAll("_", " ")}. Click the map; only this draft will change.`);
    } else {
      onRequestMapCapture(null);
    }
  }

  function stageRadiusPoint(point: XY, role: "last_wheel" | "machine_end"): void {
    setDraft((current) => {
      if (!current.pivot || !current.machine) return current;
      const radiusMeters = Math.hypot(point.x - current.pivot.point.x, point.y - current.pivot.point.y);
      const nextMachine = { ...current.machine.value, spanLengthsMeters: [...current.machine.value.spanLengthsMeters] };
      if (role === "last_wheel") {
        const priorSpans = nextMachine.spanLengthsMeters.slice(0, -1);
        const priorRadius = priorSpans.reduce((sum, span) => sum + span, 0);
        nextMachine.spanLengthsMeters = [...priorSpans, Math.max(0.001, radiusMeters - priorRadius)];
        setSpanRows(nextMachine.spanLengthsMeters.map((span) => formatDistanceInputValue(span, unitSystem)));
      } else {
        const lastWheelRadius = nextMachine.spanLengthsMeters.reduce((sum, span) => sum + span, 0);
        nextMachine.overhangMeters = Math.max(0, radiusMeters - lastWheelRadius);
        setOverhang(formatDistanceInputValue(nextMachine.overhangMeters, unitSystem));
      }
      return {
        ...current,
        machine: {
          ...current.machine,
          value: nextMachine,
          ...(role === "last_wheel" ? { lastWheelSource: "map_click" as const } : { machineEndSource: "map_click" as const }),
        },
      };
    });
    setStatus(`Map-click ${role.replaceAll("_", " ")} radius staged. Project geometry is unchanged.`);
  }

  function selectedSource(): ManualDesignInputSource | null {
    if (activeStep === "boundary") return draft.boundary?.source ?? null;
    if (activeStep === "pivot") return draft.pivot?.source ?? null;
    if (activeStep === "last_wheel") return draft.machine?.lastWheelSource ?? null;
    if (activeStep === "machine_end") return draft.machine?.machineEndSource ?? null;
    return null;
  }

  function applySpanRows(): boolean {
    try {
      const spans = spanRows.map((value, index) => requiredPositiveDistanceInput(value, unitSystem, `Span ${index + 1}`));
      setDraft((current) => current.machine ? {
        ...current,
        machine: { ...current.machine, value: { ...current.machine.value, spanLengthsMeters: spans } },
      } : current);
      setStatus(`${spans.length} span rows staged in the draft.`);
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  function applyMachineEnd(): boolean {
    try {
      const overhangMeters = requiredNonNegativeDistanceInput(overhang, unitSystem, "Overhang");
      const endGunThrowMeters = requiredNonNegativeDistanceInput(endGunThrow, unitSystem, "End-gun throw");
      setDraft((current) => current.machine ? {
        ...current,
        machine: { ...current.machine, value: { ...current.machine.value, overhangMeters, endGunThrowMeters } },
      } : current);
      setStatus("Machine end and end-gun reach staged in the draft.");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  function stageRadiusEvidence(feature: ProjectMapFeature, role: "last_wheel" | "machine_end"): void {
    if (!draft.pivot || !draft.machine || feature.geometry.type !== "LineString") return;
    const point = feature.geometry.vertices.at(-1);
    if (!point) return;
    const alreadySelected = draft.selectedEvidenceFeatureIds.includes(feature.id);
    const currentEvidence = draft.radiusEvidence.find((entry) => entry.role === role);
    const occupations = alreadySelected
      ? (currentEvidence?.occupations ?? [])
      : [
        ...(currentEvidence?.occupations ?? []),
        {
          point,
          captureEvidence: feature.vertexCaptureEvidence?.at(-1) ?? undefined,
        },
      ];
    if (occupations.length === 0) return;
    const meanRadius = occupations.reduce((sum, occupation) => sum + Math.hypot(occupation.point.x - draft.pivot!.point.x, occupation.point.y - draft.pivot!.point.y), 0) / occupations.length;
    const nextMachine = { ...draft.machine.value, spanLengthsMeters: [...draft.machine.value.spanLengthsMeters] };
    if (role === "last_wheel") {
      const priorSpans = nextMachine.spanLengthsMeters.slice(0, -1);
      const priorRadius = priorSpans.reduce((sum, span) => sum + span, 0);
      nextMachine.spanLengthsMeters = [...priorSpans, Math.max(0.001, meanRadius - priorRadius)];
      setSpanRows(nextMachine.spanLengthsMeters.map((span) => formatDistanceInputValue(span, unitSystem)));
    } else {
      const lastWheelRadius = nextMachine.spanLengthsMeters.reduce((sum, span) => sum + span, 0);
      nextMachine.overhangMeters = Math.max(0, meanRadius - lastWheelRadius);
      setOverhang(formatDistanceInputValue(nextMachine.overhangMeters, unitSystem));
    }
    const source = feature.vertexCaptureEvidence?.some(Boolean) ? "rtk_evidence" : "imported_evidence";
    setDraft((current) => ({
      ...current,
      machine: current.machine ? {
        ...current.machine,
        value: nextMachine,
        ...(role === "last_wheel" ? { lastWheelSource: source as ManualDesignInputSource } : { machineEndSource: source as ManualDesignInputSource }),
      } : current.machine,
      radiusEvidence: [
        ...current.radiusEvidence.filter((entry) => entry.role !== role),
        { role, source, confidence: feature.confidence, occupations },
      ],
      selectedEvidenceFeatureIds: alreadySelected ? current.selectedEvidenceFeatureIds : [...current.selectedEvidenceFeatureIds, feature.id],
    }));
    setStatus(`${feature.name} staged as ${role.replaceAll("_", " ")} evidence with ${occupations.length} occupation${occupations.length === 1 ? "" : "s"}.`);
  }

  function applyTransaction(): void {
    if (stale) {
      setStatus("Draft is stale. Reset it from the current project before applying.");
      return;
    }
    if (!readiness.ready) {
      setStatus(readiness.errors[0] ?? "Draft is not ready.");
      return;
    }
    if (onApply(draft)) {
      for (const key of ["draft", "spanRows", "overhang", "endGunThrow"]) inputRetention.markClean(`manual:${key}`);
      setStatus("Manual design applied atomically. Undo restores the prior project revision.");
    }
  }

  const sourceOptions = activeStep === "review" ? [] : MANUAL_DESIGN_SOURCE_OPTIONS[activeStep];
  const unitLabel = unitSystem === "metric" ? "m" : "ft/in";
  const pivotPreviewProject = draft.pivot ? { ...project, pivotCenter: draft.pivot.point } : project;

  return (
    <View style={styles.mapFeatureEditor} testID="manual-design-transaction">
      <View style={styles.scenarioRowHeader}>
        <View style={styles.manualDesignHeading} testID="manual-design-heading">
          <Text style={styles.mapFeatureTitle}>Guided Manual Design</Text>
        </View>
        <Text style={stale ? styles.scenarioScoreWarn : styles.scenarioScore} testID="manual-design-readiness">{stale ? "Stale" : readiness.ready ? "Can apply" : "Draft"}</Text>
      </View>

      <View style={styles.controlRow}>
        {GUIDED_MANUAL_DESIGN_STEPS.map((step) => (
          <ActionButton key={step.id} label={step.label} selected={activeStep === step.id} onPress={() => { onRequestMapCapture(null); setActiveStep(step.id); }} testID={`manual-design-step-${step.id}`} />
        ))}
      </View>

      {sourceOptions.length > 0 ? (
        <View style={styles.controlRow} testID={`manual-design-${activeStep}-sources`}>
          {sourceOptions.map((option) => (
            <ActionButton key={option.id} label={option.label} selected={selectedSource() === option.id} onPress={() => selectSource(option.id)} testID={`manual-design-source-${activeStep}-${option.id}`} />
          ))}
          {sourceOptions.some((option) => option.id === "rtk_evidence") ? <SmallActionButton label="Open Survey" onPress={onOpenRtk} testID="manual-design-open-survey" /> : null}
        </View>
      ) : null}

      {activeStep === "boundary" && draft.boundary ? (
        <>
          <ProjectedPolygonEditor
            label="Draft boundary projected XY"
            onApply={(vertices) => {
              setDraft((current) => ({ ...current, boundary: { ...(current.boundary ?? { source: "projected_xy" }), vertices } }));
              setStatus(`${vertices.length} boundary vertices staged without changing the project.`);
              return true;
            }}
            vertices={draft.boundary.vertices}
          />
          <View style={styles.inlineActions}>
            <SmallActionButton disabled={draft.boundary.vertices.length === 0} label="Undo Last Vertex" onPress={() => setDraft((current) => current.boundary ? { ...current, boundary: { ...current.boundary, vertices: current.boundary.vertices.slice(0, -1) } } : current)} />
            <SmallActionButton label="Close / Continue" onPress={() => setActiveStep("pivot")} />
          </View>
        </>
      ) : null}

      {activeStep === "pivot" && draft.pivot ? (
        <>
          <PivotGpsCoordinateForm
            onApply={(point, wgs84) => {
              setDraft((current) => ({ ...current, pivot: { point, source: wgs84 ? "wgs84" : current.pivot?.source ?? "projected_xy" } }));
              setStatus("Projected pivot staged without changing the project.");
              return true;
            }}
            project={pivotPreviewProject}
          />
          <SmallActionButton label="Continue to Last Wheel" onPress={() => setActiveStep("last_wheel")} />
        </>
      ) : null}

      {activeStep === "last_wheel" ? (
        <>
          <View style={styles.formGrid} testID="manual-design-span-rows">
            {spanRows.map((value, index) => (
              <FormField key={`span-${index + 1}`} label={`Span ${index + 1} (${unitLabel})`} value={value} onChangeText={(next) => setSpanRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? next : row))} />
            ))}
          </View>
          <View style={styles.inlineActions}>
            <SmallActionButton label="Add Span" onPress={() => setSpanRows((rows) => [...rows, rows.at(-1) ?? formatDistanceInputValue(50, unitSystem)])} />
            <SmallActionButton disabled={spanRows.length <= 1} label="Remove Span" onPress={() => setSpanRows((rows) => rows.slice(0, -1))} />
            <SmallActionButton label="Stage / Continue" onPress={() => { if (applySpanRows()) setActiveStep("machine_end"); }} />
          </View>
          <Text style={styles.mapFeatureMeta}>Last wheel radius {pathSummary ? formatDistance(pathSummary.lastWheelRadiusMeters, unitSystem) : "pending"}.</Text>
          {radiusMeasurementFeatures.length > 0 ? (
            <View style={styles.inlineActions} testID="manual-design-last-wheel-evidence">
              {radiusMeasurementFeatures.slice(-3).map((feature) => <SmallActionButton key={feature.id} label={`Use ${feature.name}`} onPress={() => stageRadiusEvidence(feature, "last_wheel")} />)}
            </View>
          ) : null}
        </>
      ) : null}

      {activeStep === "machine_end" ? (
        <>
          <View style={styles.formGrid}>
            <FormField label={`Overhang (${unitLabel})`} value={overhang} onChangeText={setOverhang} />
            <FormField label={`End-gun throw (${unitLabel})`} value={endGunThrow} onChangeText={setEndGunThrow} />
          </View>
          <View style={styles.inlineActions}>
            <SmallActionButton label="Stage / Review" onPress={() => { if (applyMachineEnd()) setActiveStep("review"); }} />
          </View>
          {pathSummary ? (
            <Text style={styles.mapFeatureMeta}>Machine end {formatDistance(pathSummary.endMachineRadiusMeters, unitSystem)} · end-gun reach {formatDistance(pathSummary.endGunReachMeters, unitSystem)}.</Text>
          ) : null}
          {radiusMeasurementFeatures.length > 0 ? (
            <View style={styles.inlineActions} testID="manual-design-machine-end-evidence">
              {radiusMeasurementFeatures.slice(-3).map((feature) => <SmallActionButton key={feature.id} label={`Use ${feature.name}`} onPress={() => stageRadiusEvidence(feature, "machine_end")} />)}
            </View>
          ) : null}
        </>
      ) : null}

      {activeStep === "review" ? (
        <View testID="manual-design-review">
          <View style={styles.metricGrid}>
            <MetricTile label="Boundary" value={readiness.components.boundary ? `${draft.boundary?.vertices.length ?? 0} vertices` : "Invalid"} tone={readiness.components.boundary ? "good" : "danger"} />
            <MetricTile label="Pivot" value={readiness.pivotContainment.replaceAll("_", " ")} tone={readiness.pivotContainment === "inside" ? "good" : "warn"} />
            <MetricTile label="Last wheel" value={pathSummary ? formatDistance(pathSummary.lastWheelRadiusMeters, unitSystem) : "Missing"} />
            <MetricTile label="Machine end" value={pathSummary ? formatDistance(pathSummary.endMachineRadiusMeters, unitSystem) : "Missing"} />
            <MetricTile label="Coincident" value={pathSummary?.coincidentLastWheelAndMachineEnd ? "LRDU / end" : "No"} />
            <MetricTile label="Source" value={readiness.sourceConfidence.level} tone={readiness.sourceConfidence.level === "high" ? "good" : "warn"} />
          </View>
          {readiness.errors.map((error) => <Text key={error} style={styles.formError}>{error}</Text>)}
          {readiness.warnings.map((warning) => <Text key={warning} style={styles.mapFeatureMeta}>{warning}</Text>)}
          <View style={styles.inlineActions}>
            <SmallActionButton label="Reset" onPress={resetFromProject} />
            <SmallActionButton disabled={!readiness.ready || stale} label="Apply Design" onPress={applyTransaction} testID="manual-design-apply" />
          </View>
        </View>
      ) : null}

      <Text style={styles.mapFeatureMeta} testID="manual-design-status">{status}</Text>
    </View>
  );
}

function DesignBuilderPanel({
  advisoryCostInput,
  editorError,
  onActivateMapTool,
  onCalculate,
  onCommitBoundaryVertices,
  onPlacePivot,
  onReplaceObstaclePolygon,
  onUpdateMachine,
  preview,
  project,
  result,
  settings,
}: {
  advisoryCostInput?: AdvisoryCostInput;
  editorError: string | null;
  onActivateMapTool: (mode: DrawingMode, activeLayer: DrawingLayerType, featureKind?: ProjectMapFeatureKind) => void;
  onCalculate: () => void;
  onCommitBoundaryVertices: (vertices: XY[]) => boolean;
  onPlacePivot: (point: XY) => boolean;
  onReplaceObstaclePolygon: (obstacleId: string, vertices: XY[]) => boolean;
  onUpdateMachine: (machine: PivotMachine) => boolean;
  preview: DesignScenarioPreview[] | null;
  project: PivotProject;
  result: ReturnType<typeof evaluateLayout>;
  settings: AppSettings;
}): React.JSX.Element {
  const [selectedObstacleId, setSelectedObstacleId] = useState(project.obstacles[0]?.id ?? null);
  const selectedObstacle = project.obstacles.find((obstacle) => obstacle.id === selectedObstacleId) ?? project.obstacles[0] ?? null;
  const cornerArmFootprintCount = (project.mapFeatures ?? []).filter((feature) => feature.kind === "corner_swing_limit").length;

  useEffect(() => {
    if (!selectedObstacleId || !project.obstacles.some((obstacle) => obstacle.id === selectedObstacleId)) {
      setSelectedObstacleId(project.obstacles[0]?.id ?? null);
    }
  }, [project.obstacles, selectedObstacleId]);

  return (
    <View style={styles.designBuilderPanel} testID="design-builder-panel">
      <View style={styles.designBuilderHeader}>
        <View>
          <Text style={styles.sectionTitle}>Design Builder</Text>
          <Text style={styles.mapFeatureMeta}>Projected XY workflow · Calculate before save/export</Text>
        </View>
        <SmallActionButton label="Design Mode" onPress={() => onActivateMapTool("pan", "field_boundary")} />
      </View>

      <DesignStep index={1} title="Field Boundary" meta={`${project.fieldBoundary.length} vertices`}>
        <View style={styles.inlineActions}>
          <SmallActionButton label="Draw Boundary" onPress={() => onActivateMapTool("draw_boundary", "field_boundary")} />
          <SmallActionButton label="Edit Vertices" onPress={() => onActivateMapTool("edit_vertices", "field_boundary")} />
        </View>
        <ProjectedPolygonEditor
          label="Boundary XY"
          onApply={onCommitBoundaryVertices}
          vertices={project.fieldBoundary}
        />
      </DesignStep>

      <DesignStep index={2} title="Pivot Center" meta={formatDistance(machineRadiusMeters(project.machine), settings.unitSystem)}>
        <View style={styles.inlineActions}>
          <SmallActionButton label="Map Click" onPress={() => onActivateMapTool("place_pivot", "pivot_center")} />
          <SmallActionButton label="Survey Point" onPress={() => onActivateMapTool("capture_point", "pivot_center")} />
        </View>
        <PivotCoordinateForm
          onApply={onPlacePivot}
          point={project.pivotCenter}
        />
      </DesignStep>

      <DesignStep index={3} title="Machine Radius" meta={formatDistance(machineRadiusMeters(project.machine), settings.unitSystem)}>
        <MachineSettingsForm machine={project.machine} onChange={onUpdateMachine} unitSystem={settings.unitSystem} />
      </DesignStep>

      <DesignStep index={4} title="Obstacles And Utilities" meta={`${project.obstacles.length} obstacles · ${(project.mapFeatures ?? []).length} utility features`}>
        <View style={styles.inlineActions}>
          <SmallActionButton label="Draw Obstacle" onPress={() => onActivateMapTool("mark_obstacle", "obstacle")} />
          <SmallActionButton label="Utility Line" onPress={() => onActivateMapTool("measure", "control_point")} />
        </View>
        {project.obstacles.length > 0 ? (
          <>
            <View style={styles.controlRow}>
              {project.obstacles.map((obstacle) => (
                <ActionButton
                  key={obstacle.id}
                  label={obstacle.name}
                  onPress={() => setSelectedObstacleId(obstacle.id)}
                  selected={selectedObstacle?.id === obstacle.id}
                />
              ))}
            </View>
            {selectedObstacle ? (
              <ProjectedPolygonEditor
                label={`${selectedObstacle.name} XY`}
                onApply={(vertices) => onReplaceObstaclePolygon(selectedObstacle.id, vertices)}
                vertices={selectedObstacle.polygon}
              />
            ) : null}
          </>
        ) : (
          <Text style={styles.mapFeatureMeta}>No obstacle polygons are committed yet.</Text>
        )}
      </DesignStep>

      <DesignStep index={5} title="End Gun" meta={`${formatDistance(project.machine.endGunThrowMeters, settings.unitSystem)} throw · ${project.machine.endGunAngleRanges?.length ?? 0} angle ranges`}>
        <View style={styles.metricGrid}>
          <MetricTile label="End-gun arcs" value={`${project.machine.endGunAngleRanges?.length ?? 0}`} />
          <MetricTile label="No-spray conflicts" value={`${result.metrics.noSprayConflictCount}`} tone={result.metrics.noSprayConflictCount > 0 ? "warn" : "good"} />
          <MetricTile label="End-gun acres" value={formatAreaFromAcres(result.metrics.endGunAcres, settings.unitSystem)} />
        </View>
        <View style={styles.inlineActions}>
          <SmallActionButton label="End Gun Circle" onPress={() => onActivateMapTool("measure", "control_point", "end_gun_arc")} />
        </View>
      <Text style={styles.mapFeatureMeta}>End-gun throw and angle ranges live in the machine form. Use the End gun utility circle for advisory radius or shutoff inspection marks.</Text>
      </DesignStep>

      <DesignStep index={6} title="Corner Arm" meta={`${cornerArmFootprintCount} advisory footprints`}>
        <View style={styles.metricGrid}>
          <MetricTile label="Corner footprints" value={`${cornerArmFootprintCount}`} />
          <MetricTile label="Tower tracks" value={`${result.metrics.towerTrackConflictCount}`} tone={result.metrics.towerTrackConflictCount > 0 ? "danger" : "good"} />
        </View>
        <View style={styles.inlineActions}>
          <SmallActionButton label="Corner Footprint" onPress={() => onActivateMapTool("measure", "control_point", "corner_swing_limit")} />
        </View>
        <Text style={styles.mapFeatureMeta}>Corner-arm inputs are advisory footprints only until operator/vendor coverage and track geometry are supplied. They do not change end-gun settings.</Text>
      </DesignStep>

      <DesignStep index={7} title="Awareness / Design Review" meta={`${awarenessFeatureCount(project)} evidence features`}>
        <DesignAwarenessPanel advisoryCostInput={advisoryCostInput} project={project} result={result} settings={settings} />
      </DesignStep>

      <DesignStep index={8} title="Calculate Preview" meta={preview ? `${preview.length} scenarios` : "Not calculated"}>
        <Pressable accessibilityRole="button" onPress={onCalculate} style={styles.calculateButton} testID="design-builder-calculate">
          <Calculator size={16} color="#ffffff" />
          <Text style={styles.calculateButtonText}>Calculate</Text>
        </Pressable>
        {editorError ? <Text style={styles.formError}>{editorError}</Text> : null}
        <ScenarioPreviewList preview={preview} settings={settings} />
      </DesignStep>
    </View>
  );
}

function DesignAwarenessPanel({
  advisoryCostInput,
  project,
  result,
  settings,
}: {
  advisoryCostInput?: AdvisoryCostInput;
  project: PivotProject;
  result: ReturnType<typeof evaluateLayout>;
  settings: AppSettings;
}): React.JSX.Element {
  const features = project.mapFeatures ?? [];
  const planningBoundaries = features.filter((feature) => feature.kind === "planning_boundary").length;
  const machineZones = features.filter((feature) => feature.kind === "machine_zone").length;
  const measurementLines = features.filter((feature) => feature.kind === "measurement_line");
  const linearMovePaths = features.filter((feature) => feature.kind === "linear_move_path").length;
  const wells = features.filter((feature) => feature.kind === "well_location").length;
  const undergroundWire = features.filter((feature) => feature.kind === "underground_wire").length;
  const pivotEvidence = project.surveyPoints.filter((point) => point.role === "pivot_center" && point.source === "imported").length;
  const measurementLength = measurementLines.reduce((sum, feature) => sum + mapFeatureLengthMeters(feature), 0);
  const multiMachineReview = useMemo<AdvisoryMultiMachineReview>(() => analyzeAdvisoryMultiMachineLayout(project, {
    maxCandidates: 3,
    collisionBufferMeters: project.machine.machineClearanceBufferMeters,
  }), [project]);
  const fieldPivotPlan = useMemo<AdvisoryFieldPivotPlan>(() => planAdvisoryFieldPivots(project, {
    gridDivisions: 6,
    maxMachines: 3,
    candidatePoolSize: 24,
    collisionBufferMeters: project.machine.machineClearanceBufferMeters,
    costInput: advisoryCostInput,
  }), [advisoryCostInput, project]);
  const generatedMultiPivotScenarioReview = useMemo<AdvisoryGeneratedMultiPivotScenarioReview>(() => (
    buildAdvisoryGeneratedMultiPivotScenarioReview(fieldPivotPlan)
  ), [fieldPivotPlan]);
  const strategyComparison = useMemo<AdvisoryMachineStrategyComparison>(() => compareAdvisoryMachineStrategies(project, {
    maxCandidates: 2,
    costInput: advisoryCostInput,
  }), [advisoryCostInput, project]);
  const obstacleInteractionReview = useMemo<AdvisoryObstacleInteractionReview>(() => analyzeAdvisoryObstacleInteractions(project), [project]);
  const machineBoundaryClearanceRows = useMemo<MachineBoundaryClearanceRow[]>(() => evaluateMachineBoundaryClearance(project, settings), [project, settings]);
  const shortestMachineBoundaryRow = shortestBoundaryClearanceRow(machineBoundaryClearanceRows);
  const firstConflict = multiMachineReview.conflicts[0] ?? null;
  const firstConflictReviewAcres = firstConflict
    ? Math.max(firstConflict.collisionZoneAcres, firstConflict.separationReviewZoneAcres)
    : 0;
  const readyStrategyCount = strategyComparison.strategies.filter((strategy) => strategy.status === "ready").length;
  const strategyCostStatus = costStatusShortLabel(strategyComparison.costInputStatus);
  const benderStrategy = benderStrategyForReview(strategyComparison);
  return (
    <View style={styles.mapFeatureEditor} testID="design-awareness-panel">
      <View style={styles.metricGrid}>
        <MetricTile label="Machine zones" value={`${machineZones}`} tone={machineZones > 0 ? "neutral" : "warn"} />
        <MetricTile label="Planning boundaries" value={`${planningBoundaries}`} />
        <MetricTile label="Measurement lines" value={measurementLines.length > 0 ? formatDistance(measurementLength, settings.unitSystem) : "0"} />
        <MetricTile label="Existing pivots" value={`${pivotEvidence}`} tone={pivotEvidence > 0 ? "neutral" : "warn"} />
        <MetricTile label="Wells" value={`${wells}`} />
        <MetricTile label="Underground wire" value={`${undergroundWire}`} />
        <MetricTile label="Linear paths" value={`${linearMovePaths}`} tone={linearMovePaths > 0 ? "neutral" : "warn"} />
        <MetricTile label="Advisory scenarios" value={`${multiMachineReview.compilation.readyScenarioCount}/${multiMachineReview.compilation.scenarioCount}`} tone={multiMachineReview.compilation.readyScenarioCount > 0 ? "neutral" : "warn"} />
        <MetricTile label="Envelope risks" value={`${multiMachineReview.conflicts.length}`} tone={multiMachineReview.conflicts.length > 0 ? "danger" : "good"} />
        <MetricTile label="Modeled union" value={formatAreaFromAcres(multiMachineReview.compilation.modeledIrrigatedUnionAcres, settings.unitSystem)} />
        <MetricTile label="Generated pivots" value={`${fieldPivotPlan.selectedMachineCount}/${fieldPivotPlan.requestedMachineCount}`} tone={fieldPivotPlan.selectedMachineCount > 1 ? "neutral" : "warn"} />
        <MetricTile label="Gen. scenario" value={generatedMultiPivotScenarioReview.status.replaceAll("_", " ")} tone={generatedMultiPivotScenarioReview.selectedCenterCount > 1 ? "neutral" : "warn"} />
        <MetricTile label="Machine strategies" value={`${readyStrategyCount}/${strategyComparison.strategies.length}`} tone={readyStrategyCount > 0 ? "neutral" : "warn"} />
        <MetricTile label="Cost review" value={strategyCostStatus} tone={strategyComparison.costInputStatus === "complete" ? "good" : "warn"} />
        <MetricTile label="Obstacle review" value={`${obstacleInteractionReview.summary.hardBlockingCount}/${obstacleInteractionReview.itemCount}`} tone={obstacleInteractionReview.summary.hardBlockingCount > 0 ? "danger" : "neutral"} />
        <MetricTile label="Span reviews" value={`${obstacleInteractionReview.summary.spanClearanceReviewCount + obstacleInteractionReview.summary.towerTrackReviewCount + obstacleInteractionReview.summary.utilityPathReviewCount}`} tone={obstacleInteractionReview.status === "ready" ? "warn" : "neutral"} />
        <MetricTile label="Hard conflicts" value={`${result.metrics.hardMechanicalConflictCount}`} tone={result.metrics.hardMechanicalConflictCount > 0 ? "danger" : "good"} />
        <MetricTile label="Outside wet" value={formatAreaFromAcres(result.metrics.outsideFieldAcres, settings.unitSystem)} tone={result.metrics.outsideFieldAcres > 0 ? "warn" : "good"} />
        <MetricTile
          label="Min boundary"
          testID="design-awareness-min-machine-boundary-clearance"
          tone={shortestMachineBoundaryRow && !shortestMachineBoundaryRow.meetsRequiredBoundaryClearance ? "danger" : "good"}
          value={shortestMachineBoundaryRow ? formatDistance(shortestMachineBoundaryRow.minimumBoundaryDistanceMeters, settings.unitSystem) : "n/a"}
        />
      </View>
      {settings.layoutReview.showMachineBoundaryDistances && shortestMachineBoundaryRow ? (
        <Text style={styles.mapFeatureMeta} testID="design-awareness-machine-boundary-summary">
          Machine-boundary review: {shortestMachineBoundaryRow.label} minimum {formatDistance(shortestMachineBoundaryRow.minimumBoundaryDistanceMeters, settings.unitSystem)} · required {formatDistance(settings.layoutReview.requiredBoundaryClearanceMeters, settings.unitSystem)} · advisory only.
        </Text>
      ) : null}
      <Text style={styles.mapFeatureMeta}>
        Multi-machine review: {multiMachineReview.status.replaceAll("_", " ")} · {multiMachineReview.compilation.compiledBoundaryAcres.toFixed(2)} compiled advisory acres · {multiMachineReview.compilation.fullScopeCoveragePercent.toFixed(1)}% full-scope coverage · canonical projected XY unchanged.
      </Text>
      <Text style={styles.mapFeatureMeta} testID="design-awareness-generated-field-pivot-plan">
        Generated field-pivot plan: {fieldPivotPlan.selectedMachineCount}/{fieldPivotPlan.requestedMachineCount} advisory centers · {fieldPivotPlan.fieldCoveragePercent.toFixed(1)}% field coverage · no saved pivots created.
      </Text>
      <Text style={styles.mapFeatureMeta} testID="design-awareness-generated-multi-pivot-scenario-review">
        Generated multi-pivot scenario review: {generatedMultiPivotScenarioReview.selectedCenterCount}/{generatedMultiPivotScenarioReview.requestedMachineCount} selected · {formatAreaFromAcres(generatedMultiPivotScenarioReview.modeledIrrigatedUnionAcres, settings.unitSystem)} modeled union · {formatAreaFromAcres(generatedMultiPivotScenarioReview.duplicateModeledCoverageAcres, settings.unitSystem)} overlap · runtime collision prevention not claimed.
      </Text>
      {firstConflict ? (
        <Text style={styles.formError}>
          {firstConflict.leftZoneName} / {firstConflict.rightZoneName}: {firstConflict.severity.replaceAll("_", " ")} · {formatAreaFromAcres(firstConflictReviewAcres, settings.unitSystem)} review zone · {formatDistance(firstConflict.separationDeficitMeters, settings.unitSystem)} separation deficit.
        </Text>
      ) : null}
      {strategyComparison.bestStrategy ? (
        <Text style={styles.mapFeatureMeta}>
          Best advisory strategy: {strategyComparison.bestStrategy.label} · {formatAreaFromAcres(strategyComparison.bestStrategy.irrigatedAcres, settings.unitSystem)} modeled · cost ranking {strategyComparison.costInputStatus.replaceAll("_", " ")}.
        </Text>
      ) : null}
      {benderStrategy ? (
        <Text style={styles.mapFeatureMeta} testID="design-awareness-bender-review">
          {formatBenderStrategySummary(benderStrategy, settings)}
        </Text>
      ) : null}
      <Text style={styles.mapFeatureMeta} testID="design-awareness-obstacle-review">
        Obstacle interaction review: {formatObstacleInteractionSummary(obstacleInteractionReview)}
      </Text>
      <Text style={styles.mapFeatureMeta}>Awareness evidence supports review and scenario planning only. Additional machine zones, linear paths, measurement lines, wells, and wire paths do not create pivots or mutate canonical projected XY automatically.</Text>
    </View>
  );
}

function AdvisoryEvidenceStatusPanel({
  advisoryMachineRenderModel,
  multiMachineReview,
  project,
  result,
  settings,
  surface,
}: {
  advisoryMachineRenderModel: AdvisoryMachineRenderModel | null;
  multiMachineReview: AdvisoryMultiMachineReview | null;
  project: PivotProject;
  result: ReturnType<typeof evaluateLayout>;
  settings: AppSettings;
  surface: "overview" | "calculate";
}): React.JSX.Element {
  const features = project.mapFeatures ?? [];
  const planningBoundaryCount = features.filter((feature) => feature.kind === "planning_boundary").length;
  const machineZoneCount = features.filter((feature) => feature.kind === "machine_zone").length;
  const preferredOutlineCount = features.filter((feature) => (
    feature.kind === "machine_zone"
    && (
      feature.properties?.preferredMachineOutline === true
      || feature.properties?.advisoryDesignRole === "preferred_machine_outline"
    )
  )).length;
  const powerEvidence = projectPowerLineEvidenceStatus(project);
  const compiled = multiMachineReview?.compilation ?? null;
  const renderLedger = advisoryMachineRenderModel?.instances.length ? advisoryMachineRenderModel.acreLedger : null;
  const totalDeduplicatedAcres = compiled && compiled.modeledIrrigatedUnionAcres > 0
    ? compiled.modeledIrrigatedUnionAcres
    : result.metrics.irrigatedAcres;
  const renderDeduplicatedAcres = renderLedger?.deduplicatedTotalAcres ?? totalDeduplicatedAcres;
  const overlapAcres = renderLedger?.overlapAcres ?? compiled?.duplicateModeledCoverageAcres ?? 0;
  const outsideFullScopeAcres = compiled?.outsideFullScopeAcres ?? 0;
  const outsideFieldAcres = renderLedger?.outsideFieldAcres ?? result.metrics.outsideFieldAcres;
  const verifiedBlockedAcres = renderLedger?.verifiedBlockedAcres ?? result.metrics.blockedByNoSprayAcres ?? 0;
  const title = surface === "overview" ? "Advisory Map Evidence" : "Acre And Evidence Ledger";
  const EvidenceValue = surface === "calculate" ? ReportValue : MetricTile;
  return (
    <View style={surface === "calculate" ? reportStyles.section : styles.placementReviewPanel} testID={`advisory-evidence-status-${surface}`}>
      <View style={styles.scenarioRowHeader}>
        <View style={styles.rowTitleWithIcon}>
          <Monitor size={16} color="#254234" />
          <Text style={styles.rowTitle}>{title}</Text>
        </View>
        <Text style={powerEvidence.status === "missing" ? styles.scenarioScoreWarn : styles.scenarioScore}>{powerEvidence.status.replaceAll("_", " ")}</Text>
      </View>
      <View style={surface === "calculate" ? undefined : styles.metricGrid}>
        <EvidenceValue label="Field boundary" value={formatAreaFromAcres(result.metrics.fieldAcres, settings.unitSystem)} />
        <EvidenceValue label="Design area" value={compiled ? formatAreaFromAcres(compiled.compiledBoundaryAcres, settings.unitSystem) : "pending"} tone={compiled ? "neutral" : "warn"} />
        <EvidenceValue label="Machine zones" value={`${machineZoneCount}`} tone={machineZoneCount > 0 ? "neutral" : "warn"} />
        <EvidenceValue label="Preferred outlines" value={`${preferredOutlineCount}`} tone={preferredOutlineCount > 0 ? "neutral" : "warn"} />
        <EvidenceValue label="Render machines" value={`${advisoryMachineRenderModel?.instances.length ?? 0}`} tone={(advisoryMachineRenderModel?.instances.length ?? 0) === 2 ? "good" : "warn"} />
        <EvidenceValue label="Planning boundaries" value={`${planningBoundaryCount}`} />
        <EvidenceValue label="Standard pivot" value={formatAreaFromAcres(renderLedger?.standardPivotAcres ?? result.metrics.standardPivotAcres ?? Math.max(0, result.metrics.irrigatedAcres - result.metrics.endGunAcres), settings.unitSystem)} />
        <EvidenceValue label="End gun" value={formatAreaFromAcres(renderLedger?.endGunAcres ?? result.metrics.endGunAcres, settings.unitSystem)} />
        <EvidenceValue label="Corner arm" value={formatAreaFromAcres(renderLedger?.cornerArmAcres ?? result.metrics.cornerArmAcres ?? 0, settings.unitSystem)} />
        <EvidenceValue label="De-duped total" value={formatAreaFromAcres(renderDeduplicatedAcres, settings.unitSystem)} />
        <EvidenceValue label="Overlap" value={formatAreaFromAcres(overlapAcres, settings.unitSystem)} tone={overlapAcres > 0 ? "warn" : "good"} />
        <EvidenceValue label="Outside field" value={formatAreaFromAcres(outsideFieldAcres, settings.unitSystem)} tone={outsideFieldAcres > 0 ? "danger" : "good"} />
        <EvidenceValue label="Outside full scope" value={formatAreaFromAcres(outsideFullScopeAcres, settings.unitSystem)} tone={outsideFullScopeAcres > 0 ? "danger" : "good"} />
        <EvidenceValue label="Blocked acres" value={formatAreaFromAcres(verifiedBlockedAcres, settings.unitSystem)} tone={verifiedBlockedAcres > 0 ? "warn" : "good"} />
        <EvidenceValue label="Power evidence" value={powerEvidence.status.replaceAll("_", " ")} tone={powerEvidence.status === "missing" ? "warn" : "good"} />
      </View>
      <Text style={styles.mapFeatureMeta} testID={`advisory-evidence-power-status-${surface}`}>
        {powerEvidence.message}
      </Text>
      <Text style={styles.mapFeatureMeta}>
        Full field boundary remains the clipping boundary. South and middle machine-zone evidence and preferred outlines guide advisory map context only; internal zone edges are not blockers. The render ledger is display/report data only and leaves project storage unchanged.
      </Text>
    </View>
  );
}

function DesignStep({ children, index, meta, title }: { children: React.ReactNode; index: number; meta: string; title: string }): React.JSX.Element {
  return (
    <View style={styles.designStep}>
      <View style={styles.designStepHeader}>
        <View style={styles.designStepBadge}>
          <Text style={styles.designStepBadgeText}>{index}</Text>
        </View>
        <View style={styles.designStepTitleBlock}>
          <Text style={styles.designStepTitle}>{title}</Text>
          <Text style={styles.mapFeatureMeta}>{meta}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

function PivotCoordinateForm({ onApply, point, retentionKey = "pivotXY" }: { retentionKey?: string; onApply: (point: XY) => boolean; point: XY }): React.JSX.Element {
  const [x, setX] = useRetainedInput(`${retentionKey}:x`, point.x.toFixed(3));
  const [y, setY] = useRetainedInput(`${retentionKey}:y`, point.y.toFixed(3));
  const [error, setError] = useState<string | null>(null);


  function apply(): void {
    try {
      const next = { x: requiredFiniteNumber(x, "Pivot X"), y: requiredFiniteNumber(y, "Pivot Y") };
      const accepted = onApply(next);
      setError(accepted ? null : "Pivot coordinate was rejected by project validation.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <View style={styles.machineForm}>
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <View style={styles.formGrid}>
        <FormField label="Pivot X" value={x} onChangeText={setX} />
        <FormField label="Pivot Y" value={y} onChangeText={setY} />
      </View>
      <View style={styles.inlineActions}>
        <SmallActionButton label="Apply Coordinates" onPress={apply} />
      </View>
    </View>
  );
}

function ProjectedPolygonEditor({ label, onApply, vertices }: { label: string; onApply: (vertices: XY[]) => boolean; vertices: XY[] }): React.JSX.Element {
  const [text, setText] = useRetainedInput(`polygon:${label}`, formatXyLines(vertices));
  const [error, setError] = useState<string | null>(null);


  function apply(): void {
    try {
      const parsed = parseXyLines(text);
      const accepted = onApply(parsed);
      setError(accepted ? null : `${label} was rejected by polygon validation.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function addRow(): void {
    try {
      const current = parseXyLinesAllowEmpty(text);
      const last = current.at(-1) ?? { x: 0, y: 0 };
      setText(formatXyLines([...current, { x: last.x + 10, y: last.y }]));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function removeLast(): void {
    try {
      setText(formatXyLines(parseXyLinesAllowEmpty(text).slice(0, -1)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function rotateFirst(): void {
    try {
      const current = parseXyLinesAllowEmpty(text);
      if (current.length < 2) return;
      setText(formatXyLines([...current.slice(1), current[0]]));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <View style={styles.xyEditor}>
      <Text style={styles.formLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        multiline
        onChangeText={setText}
        style={[styles.textInput, styles.xyTextArea]}
        value={text}
      />
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <View style={styles.inlineActions}>
        <SmallActionButton label="Add Row" onPress={addRow} />
        <SmallActionButton label="Remove Last" onPress={removeLast} />
        <SmallActionButton label="Reorder" onPress={rotateFirst} />
        <SmallActionButton label="Apply Vertices" onPress={apply} />
      </View>
    </View>
  );
}

function ScenarioPreviewList({ preview, settings, report = false }: { preview: DesignScenarioPreview[] | null; settings: AppSettings; report?: boolean }): React.JSX.Element {
  if (!preview) {
    return <Text style={styles.mapFeatureMeta}>Scenario metrics update only after Calculate.</Text>;
  }
  return (
    <View style={styles.scenarioList} testID="design-builder-scenarios">
      {preview.map((scenario) => (
        <View key={scenario.id} style={report ? reportStyles.section : [styles.scenarioRow, scenario.feasible ? styles.scenarioRowFeasible : styles.scenarioRowRejected]}>
          <View style={styles.scenarioRowHeader}>
            <Text style={styles.rowTitle}>{scenario.label}</Text>
            <Text style={styles.scenarioScore}>{scenario.feasible ? scenario.score.toFixed(1) : "Check"}</Text>
          </View>
          <Text style={styles.rowMeta}>
            {formatAreaFromAcres(scenario.metrics.irrigatedAcres, settings.unitSystem)} · {scenario.metrics.coveragePercent.toFixed(1)}% · outside {formatAreaFromAcres(scenario.metrics.outsideFieldAcres, settings.unitSystem)}
          </Text>
          {scenario.rejectionReasons.length > 0 ? (
            <Text style={styles.mapFeatureMeta}>{scenario.rejectionReasons[0]}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function MachineBoundaryClearancePanel({
  onUpdateLayoutReview,
  rows,
  settings,
}: {
  onUpdateLayoutReview: (next: Partial<AppSettings["layoutReview"]>) => void;
  rows: MachineBoundaryClearanceRow[];
  settings: AppSettings;
}): React.JSX.Element {
  const shortest = shortestBoundaryClearanceRow(rows);
  const failingCount = rows.filter((row) => !row.meetsRequiredBoundaryClearance).length;
  const stepMeters = layoutReviewClearanceStepMeters(settings.unitSystem);
  const required = settings.layoutReview.requiredBoundaryClearanceMeters;
  return (
    <View style={reportStyles.section} testID="machine-boundary-clearance-panel">
      <View style={styles.scenarioRowHeader}>
        <Text style={styles.rowTitle}>Machine Boundary Distances</Text>
        <Text style={styles.scenarioScore}>{failingCount > 0 ? `${failingCount} check` : "Ready"}</Text>
      </View>
      <View>
        <ReportValue
          label="Shortest"
          testID="machine-boundary-shortest"
          tone={shortest && !shortest.meetsRequiredBoundaryClearance ? "danger" : "good"}
          value={shortest ? formatDistance(shortest.minimumBoundaryDistanceMeters, settings.unitSystem) : "n/a"}
        />
        <ReportValue
          label="Required"
          testID="machine-boundary-required"
          value={formatDistance(required, settings.unitSystem)}
        />
        <ReportValue
          label="Rows"
          value={`${rows.length}`}
        />
      </View>
      <View style={styles.controlRow}>
        <Switch accessibilityLabel="Show boundary distance rows" value={settings.layoutReview.showMachineBoundaryDistances}
          onValueChange={showMachineBoundaryDistances => onUpdateLayoutReview({ showMachineBoundaryDistances })} />
        <Text style={reportStyles.note}>Show distance rows</Text>
        <IconCommandButton id="clearance-decrease" icon={<Minus />} disabled={required <= 0}
          label="Decrease required clearance"
          onPress={() => onUpdateLayoutReview({ requiredBoundaryClearanceMeters: Math.max(0, required - stepMeters) })}
          testID="machine-boundary-clearance-decrease"
        />
        <IconCommandButton id="clearance-increase" icon={<Plus />} label="Increase required clearance"
          onPress={() => onUpdateLayoutReview({ requiredBoundaryClearanceMeters: required + stepMeters })}
          testID="machine-boundary-clearance-increase"
        />
      </View>
      {settings.layoutReview.showMachineBoundaryDistances ? (
        <View style={styles.placementCandidateList} testID="machine-boundary-clearance-rows">
          {rows.map((row) => (
            <View key={`${row.kind}-${row.towerIndex ?? row.radiusMeters}`} style={reportStyles.section} testID={`machine-boundary-row-${row.kind}`}>
              <View style={styles.scenarioRowHeader}>
                <Text style={styles.rowTitle}>{row.towerIndex ? `${row.label} T${row.towerIndex}` : row.label}</Text>
                <Text style={styles.scenarioScore}>{row.meetsRequiredBoundaryClearance ? "OK" : "Short"}</Text>
              </View>
              <Text style={styles.rowMeta}>
                radius {formatDistance(row.radiusMeters, settings.unitSystem)} · minimum {formatDistance(row.minimumBoundaryDistanceMeters, settings.unitSystem)} · required {formatDistance(row.requiredBoundaryClearanceMeters, settings.unitSystem)}
              </Text>
              <Text style={row.meetsRequiredBoundaryClearance ? styles.mapFeatureMeta : styles.formError}>
                {row.meetsRequiredBoundaryClearance
                  ? `No shortfall. Outside envelope ${formatAreaFromAcres(row.outsideFieldAcres, settings.unitSystem)}.`
                  : `Shortfall ${formatDistance(row.clearanceShortfallMeters, settings.unitSystem)}. Outside envelope ${formatAreaFromAcres(row.outsideFieldAcres, settings.unitSystem)}.`}
              </Text>
              {row.wheelOverhangSeparationVerified === false ? (
                <Text style={styles.mapFeatureMeta}>Corner-arm wheel and overhang separation is unverified; row uses advisory fallback length metadata.</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.mapFeatureMeta}>Rows are hidden by project setting. Clearance gates still use projected/local XY advisory settings when Calculate runs.</Text>
      )}
      <Text style={styles.mapFeatureMeta}>
        Rows are sampled advisory path-to-boundary distances in the project CRS. They do not mutate pivot center, machine settings, field boundary, storage, archives, KML/KMZ, or native runtime state.
      </Text>
    </View>
  );
}

function CornerArmKinematicStatusPanel({
  result,
  settings,
}: {
  result: CornerArmKinematicResult;
  settings: AppSettings;
}): React.JSX.Element {
  const blockerCount = result.infeasibleDiagnostics.length;
  const firstBlockers = result.infeasibleDiagnostics.slice(0, 3);
  return (
    <View style={reportStyles.section} testID="corner-arm-kinematics-panel">
      <View style={styles.scenarioRowHeader}>
        <Text style={styles.rowTitle}>Corner-Arm Kinematics</Text>
        <Text style={result.status === "ready" ? styles.scenarioScore : styles.scenarioScoreWarn}>{result.status === "unresolved" ? "Unresolved" : result.status === "ready" ? "Ready" : `${blockerCount} blockers`}</Text>
      </View>
      <ReportNotice tone="warn">Advisory | {result.scaffoldSourceStatus.replaceAll("_", " ")} | No controller proof</ReportNotice>
      <View>
        <ReportValue label="LRDU path samples" value={`${result.lrduPath.length}`} tone={result.lrduPath.length > 0 ? "neutral" : "warn"} />
        <ReportValue label="SDU path samples" value={`${result.sduPath.length}`} tone={result.sduPath.length > 0 ? "neutral" : "warn"} />
        <ReportValue label="Endpoint path samples" value={`${result.overhangEndpointPath.length}`} tone={result.overhangEndpointPath.length > 0 ? "neutral" : "warn"} />
        <ReportValue label="Safety zone" value={formatDistance(result.safetyZoneMeters, settings.unitSystem)} />
        <ReportValue label="Sampled sweep" value={formatAreaFromAcres(result.sweptPhysicalEnvelopeAcres, settings.unitSystem)} />
        <ReportValue label="Wetted/endgun" value={formatAreaFromAcres(result.wettedEndGunEnvelopeAcres, settings.unitSystem)} />
      </View>
      {firstBlockers.length > 0 ? (
        <View testID="corner-arm-kinematics-blockers">
          {firstBlockers.map((diagnostic, index) => (
            <Text key={`${diagnostic.code}-${diagnostic.stateIndex ?? index}`} style={styles.formError}>
              {diagnostic.code.replaceAll("_", " ")}: {diagnostic.message}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={styles.mapFeatureMeta} testID="corner-arm-kinematics-ready">
          Kinematic preview produced report rows for LRDU, SDU, overhang endpoint, physical swept envelope, and end-gun control angles. Qualified review remains required.
        </Text>
      )}
      {result.endGunControlRows.length > 0 ? (
        <View style={styles.costComparisonTable} testID="corner-arm-endgun-control-rows">
          <View style={styles.costComparisonHeader}>
            <Text style={styles.costComparisonHeaderText}>End-gun row</Text>
            <Text style={styles.costComparisonHeaderText}>Start</Text>
            <Text style={styles.costComparisonHeaderText}>Stop</Text>
          </View>
          {result.endGunControlRows.map((row) => (
            <View key={row.rangeIndex} style={styles.costComparisonRow}>
              <Text style={styles.costComparisonValue}>{row.direction}</Text>
              <Text style={styles.costComparisonValue}>{row.startAngleDegrees.toFixed(1)} deg</Text>
              <Text style={styles.costComparisonValue}>{row.stopAngleDegrees.toFixed(1)} deg</Text>
            </View>
          ))}
        </View>
      ) : null}
      {result.status === "unresolved" ? result.qualificationBlockers.map((blocker) => (
        <Text key={blocker} style={styles.formError}>{blocker}</Text>
      )) : null}
      <Text style={styles.mapFeatureMeta}>
        This panel does not save geometry, change machine settings, prove proprietary Valley kinematics, certify a design, or write project storage. Existing advisory envelopes remain fallback display evidence when required inputs are missing.
      </Text>
    </View>
  );
}

function IdealCenterSummary({
  analysis,
  onRequestApplyPivotCandidate,
  settings,
}: {
  analysis: IdealCenterPointAnalysis | null;
  onRequestApplyPivotCandidate: (candidate: PivotPlacementCandidate) => void;
  settings: AppSettings;
}): React.JSX.Element {
  if (!analysis) {
    return (
      <View style={reportStyles.section} testID="ideal-center-summary">
        <View style={styles.scenarioRowHeader}>
          <Text style={styles.rowTitle}>Ideal Center Analysis</Text>
          <Text style={styles.scenarioScore}>Pending</Text>
        </View>
        <Text style={styles.mapFeatureMeta}>Run Calculate Preview to analyze field-boundary candidates and rank the best projected-XY pivot center.</Text>
      </View>
    );
  }

  const best = analysis.bestCandidate;
  return (
    <View style={reportStyles.section} testID="ideal-center-summary">
      <View style={styles.scenarioRowHeader}>
        <Text style={styles.rowTitle}>Ideal Center Analysis</Text>
        <Text style={styles.scenarioScore}>{analysis.status.replaceAll("_", " ")}</Text>
      </View>
      <ReportNotice>Advisory | Inside boundary | Qualified review required</ReportNotice>
      {best ? (
        <>
          <View>
            <ReportValue label="Best score" value={best.score.toFixed(1)} />
            <ReportValue label="Boundary clearance" value={formatDistance(best.boundaryClearanceMeters, settings.unitSystem)} tone={best.boundaryClearanceMeters >= 0 ? "neutral" : "danger"} />
            <ReportValue label="Move from current" value={formatDistance(best.distanceFromCurrentMeters, settings.unitSystem)} />
            <ReportValue label="Cost input" value={costAssessmentLabel(best.costAssessment)} tone={best.costAssessment.status === "complete" ? "neutral" : "warn"} />
          </View>
          <Text style={styles.rowMeta}>
            XY {best.pivotCenter.x.toFixed(2)}, {best.pivotCenter.y.toFixed(2)} · {formatAreaFromAcres(best.metrics.irrigatedAcres, settings.unitSystem)} irrigated · outside {formatAreaFromAcres(best.metrics.outsideFieldAcres, settings.unitSystem)}
          </Text>
          <Text style={styles.scoreBreakdown}>{formatPlacementScoreBreakdown(best)}</Text>
          <Text style={styles.mapFeatureMeta}>{formatCostAssessment(best.costAssessment)}</Text>
          {analysis.machineZoneReviews.length > 0 ? (
            <Text style={styles.mapFeatureMeta}>{analysis.machineZoneReviews.length} advisory machine-zone review{analysis.machineZoneReviews.length === 1 ? "" : "s"} available in Placement Review.</Text>
          ) : null}
          <View style={styles.inlineActions}>
            <SmallActionButton disabled={!best.feasible} label="Apply Ideal Center" onPress={() => onRequestApplyPivotCandidate(best)} testID="ideal-center-apply" />
          </View>
        </>
      ) : (
        <>
          {analysis.blockers.map((blocker) => (
            <Text key={blocker} style={styles.formError}>{blocker}</Text>
          ))}
          <Text style={styles.mapFeatureMeta}>{analysis.candidates.length} candidate{analysis.candidates.length === 1 ? "" : "s"} analyzed; none met all automatic feasibility gates.</Text>
        </>
      )}
      <Text style={styles.mapFeatureMeta}>{analysis.warnings[0]}</Text>
    </View>
  );
}

function PlacementReviewPanel({
  analysis,
  candidates,
  onRequestApplyPivotCandidate,
  settings,
}: {
  analysis: IdealCenterPointAnalysis | null;
  candidates: PivotPlacementCandidate[] | null;
  onRequestApplyPivotCandidate: (candidate: PivotPlacementCandidate) => void;
  settings: AppSettings;
}): React.JSX.Element {
  return (
    <View style={reportStyles.section} testID="placement-review-panel">
      <View style={styles.scenarioRowHeader}>
        <Text style={styles.rowTitle}>Placement Review</Text>
        <Text style={styles.scenarioScore}>{analysis ? analysis.status.replaceAll("_", " ") : "0"}</Text>
      </View>
      <ReportNotice>Advisory | Source-backed | Qualified review required</ReportNotice>
      {!candidates ? (
        <Text style={styles.mapFeatureMeta}>Automatic center alternatives update after Calculate Preview.</Text>
      ) : null}
      {analysis?.machineZoneReviews.map((zone) => (
        <View key={zone.featureId} style={styles.placementCandidateRow} testID={`machine-zone-review-${zone.featureId}`}>
          <View style={styles.scenarioRowHeader}>
            <Text style={styles.rowTitle}>{zone.featureName}</Text>
            <Text style={styles.scenarioScore}>{zone.status.replaceAll("_", " ")}</Text>
          </View>
          <Text style={styles.rowMeta}>
            {zone.featureKind.replaceAll("_", " ")} · {zone.boundaryVertexCount} projected-XY vertices · {zone.candidateCount} candidates
          </Text>
          {zone.bestCandidate ? (
            <Text style={styles.rowMeta}>
              Best XY {zone.bestCandidate.pivotCenter.x.toFixed(2)}, {zone.bestCandidate.pivotCenter.y.toFixed(2)} · {formatAreaFromAcres(zone.bestCandidate.metrics.irrigatedAcres, settings.unitSystem)}
            </Text>
          ) : null}
          {zone.warnings[0] ? <Text style={styles.mapFeatureMeta}>{zone.warnings[0]}</Text> : null}
        </View>
      ))}
      {candidates?.map((candidate, index) => (
        <View key={candidate.id} style={[styles.placementCandidateRow, candidate.feasible ? styles.scenarioRowFeasible : styles.scenarioRowRejected]} testID={`placement-candidate-${index}`}>
          <View style={styles.scenarioRowHeader}>
            <Text style={styles.rowTitle}>{index === 0 && candidate.feasible ? "Best candidate" : `Candidate ${index + 1}`}</Text>
            <Text style={styles.scenarioScore}>{candidate.feasible ? candidate.score.toFixed(1) : "Check"}</Text>
          </View>
          <Text style={styles.rowMeta}>
            XY {candidate.pivotCenter.x.toFixed(2)}, {candidate.pivotCenter.y.toFixed(2)} · {candidate.insideFieldBoundary ? "inside boundary" : "outside boundary"} · {candidate.sourceSeed.replaceAll("_", " ")}
          </Text>
          <Text style={styles.rowMeta}>
            {formatAreaFromAcres(candidate.metrics.irrigatedAcres, settings.unitSystem)} · outside {formatAreaFromAcres(candidate.metrics.outsideFieldAcres, settings.unitSystem)} · dry corners {formatAreaFromAcres(candidate.dryCornerAcres, settings.unitSystem)}
          </Text>
          <Text style={styles.rowMeta}>
            clearance {formatDistance(candidate.boundaryClearanceMeters, settings.unitSystem)} · move {formatDistance(candidate.distanceFromCurrentMeters, settings.unitSystem)}
          </Text>
          <Text style={styles.scoreBreakdown}>{formatPlacementScoreBreakdown(candidate)}</Text>
          <Text style={styles.mapFeatureMeta}>{formatCostAssessment(candidate.costAssessment)}</Text>
          {candidate.disqualificationReasons[0] ? <Text style={styles.formError}>{candidate.disqualificationReasons[0]}</Text> : null}
          {candidate.warnings[0] ? <Text style={styles.mapFeatureMeta}>{candidate.warnings[0]}</Text> : null}
          <View style={styles.inlineActions}>
            <SmallActionButton disabled={!candidate.insideFieldBoundary} label="Apply Pivot Center" onPress={() => onRequestApplyPivotCandidate(candidate)} testID={`placement-candidate-apply-${index}`} />
          </View>
        </View>
      ))}
    </View>
  );
}

function CornerArmEvaluationPanel({ evaluation, unitSystem }: { evaluation: AdvisoryCornerArmEvaluation; unitSystem: PivotProject["unitSystem"] }): React.JSX.Element {
  const badges = [
    "advisory",
    "source-backed",
    ...(evaluation.config?.operatorConfirmedAt ? ["operator-confirmed"] : []),
    ...(evaluation.unverifiedKinematics ? ["unverified kinematics"] : []),
    ...(evaluation.qualifiedReviewRequired ? ["qualified review required"] : []),
  ];
  return (
    <View style={styles.placementReviewPanel} testID="corner-arm-evaluation-panel">
      <View style={styles.scenarioRowHeader}>
        <Text style={styles.rowTitle}>Corner-Arm Review</Text>
        <Text style={styles.scenarioScore}>{evaluation.status.replaceAll("_", " ")}</Text>
      </View>
      <AdvisoryBadgeRow badges={badges} />
      <Text style={styles.rowMeta}>
        Base allowed {formatAreaFromAcres(evaluation.baseAllowedCoverageAcres, unitSystem)} · candidate add {formatAreaFromAcres(evaluation.estimatedAddedCoverageAcres, unitSystem)} · evidence {evaluation.evidenceFeatureIds.length}
      </Text>
      {evaluation.warnings.slice(0, 3).map((warning) => (
        <Text key={warning} style={styles.mapFeatureMeta}>{warning}</Text>
      ))}
    </View>
  );
}

function AdvisoryBadgeRow({ badges, testID }: { badges: string[]; testID?: string }): React.JSX.Element {
  return (
    <View style={styles.advisoryBadgeRow} testID={testID}>
      {badges.map((badge) => (
        <Text key={badge} style={styles.advisoryBadge}>{badge}</Text>
      ))}
    </View>
  );
}

function advisoryOptionLabel(value: string): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatPlacementScoreBreakdown(candidate: PivotPlacementCandidate): string {
  const breakdown = candidate.scoreBreakdown;
  return [
    `coverage ${breakdown.coverage.toFixed(1)}`,
    `boundary ${breakdown.boundaryFit.toFixed(1)}`,
    `obstacle ${breakdown.obstacleClearance.toFixed(1)}`,
    `water ${breakdown.waterSourceProximity.toFixed(1)}`,
    `power ${breakdown.powerSourceProximity.toFixed(1)}`,
    `access ${breakdown.accessProximity.toFixed(1)}`,
    `dry ${breakdown.dryCornerPenalty.toFixed(1)}`,
    `cost ${breakdown.costEfficiency.toFixed(1)}`,
    `feasibility ${breakdown.feasibility.toFixed(1)}`,
  ].join(" · ");
}

function costAssessmentLabel(assessment: AdvisoryCostAssessment): string {
  if (assessment.status === "complete") return `${assessment.currencyCode}/ac`;
  return assessment.status.replaceAll("_", " ");
}

function costStatusShortLabel(status: AdvisoryCostAssessment["status"]): string {
  if (status === "complete") return "Complete";
  if (status === "invalid_cost_input") return "Invalid";
  if (status === "no_irrigated_acres") return "No acres";
  return "Missing";
}

function formatCostAssessment(assessment: AdvisoryCostAssessment): string {
  if (assessment.status === "complete" && assessment.estimatedCost !== null && assessment.costPerIrrigatedAcre !== null) {
    return `Cost input ${assessment.currencyCode} ${assessment.estimatedCost.toFixed(0)} · ${assessment.currencyCode} ${assessment.costPerIrrigatedAcre.toFixed(0)} per irrigated acre.`;
  }
  return assessment.warnings[0] ?? "Cost efficiency is incomplete.";
}

function benderStrategyForReview(
  comparison: AdvisoryMachineStrategyComparison,
): AdvisoryMachineStrategyComparison["strategies"][number] | null {
  return comparison.strategies.find((strategy) => strategy.strategyKind === "bender_second_pivot")
    ?? comparison.strategies.find((strategy) => strategy.strategyKind === "unsupported_bender_second_pivot")
    ?? null;
}

function formatBenderStrategySummary(
  strategy: AdvisoryMachineStrategyComparison["strategies"][number],
  settings: AppSettings,
): string {
  if (strategy.strategyKind === "bender_second_pivot" && strategy.status === "ready") {
    const tail = strategy.benderTailRadiusMeters !== undefined
      ? ` · tail ${formatDistance(strategy.benderTailRadiusMeters, settings.unitSystem)}`
      : "";
    return `Bender / second-pivot review: ${strategy.label}${tail} · ${formatAreaFromAcres(strategy.irrigatedAcres, settings.unitSystem)} advisory opportunity envelope · unverified kinematics.`;
  }
  return `Bender / second-pivot review: ${strategy.warnings[0] ?? "operator-labeled projected-XY second-pivot evidence is required before advisory scoring."}`;
}

function formatObstacleInteractionSummary(review: AdvisoryObstacleInteractionReview): string {
  if (review.status === "no_evidence") return "No obstacle or utility evidence is ready for crossing/blocking review.";
  const crossingReviews = review.summary.spanClearanceReviewCount
    + review.summary.towerTrackReviewCount
    + review.summary.utilityPathReviewCount;
  return `${review.itemCount} item${review.itemCount === 1 ? "" : "s"} · ${review.summary.hardBlockingCount} hard/blocking · ${review.summary.noSprayExclusionCount} no-spray · ${crossingReviews} crossing/clearance review · ${review.summary.outsideMachineReachCount} outside reach`;
}

function formatFirstObstacleInteraction(review: AdvisoryObstacleInteractionReview): string {
  const first = review.items[0];
  if (!first) return review.blockers[0] ?? "Add wells, utility paths, or obstacle polygons to review crossing and blocking assumptions.";
  const tower = first.nearestTowerIndex
    ? ` · nearest tower ${first.nearestTowerIndex}`
    : "";
  return `${first.name}: ${first.category.replaceAll("_", " ")}${tower}. ${first.warnings[0]}`;
}

function formatFullScopeBoundarySummary(review: AdvisoryMultiMachineReview, settings: AppSettings): string {
  const fullScopeSource = review.compilation.fullScopeBoundarySource.replaceAll("_", " ");
  const scenarioSource = review.compilation.scenarioBoundarySource === "none"
    ? "no scenario zones"
    : `${review.compilation.scenarioBoundarySource.replaceAll("_", " ")} scenarios`;
  return `${formatAreaFromAcres(review.compilation.compiledBoundaryAcres, settings.unitSystem)} ${fullScopeSource} full scope · ${review.compilation.fullScopeCoveragePercent.toFixed(1)}% modeled coverage · ${formatAreaFromAcres(review.compilation.fullScopeUnirrigatedAcres, settings.unitSystem)} remaining dry · ${scenarioSource}`;
}

function projectPowerLineEvidenceStatus(project: PivotProject): { status: "missing" | "provisional" | "verified" | "verified_exclusion"; message: string } {
  const powerFeatures = (project.mapFeatures ?? []).filter((feature) => feature.kind === "power_line" || feature.kind === "power_pole");
  if (powerFeatures.length === 0) {
    return {
      status: "missing",
      message: "No separate power_line or power_pole evidence is supplied; machine-zone boundaries are not power-line blockers.",
    };
  }
  if (powerFeatures.some((feature) => (
    feature.properties?.powerLineExclusion === true
    || feature.properties?.power_line_exclusion === true
    || feature.properties?.powerLineEvidenceStatus === "verified_exclusion"
    || feature.properties?.power_line_evidence_status === "verified_exclusion"
  ))) {
    return {
      status: "verified_exclusion",
      message: "Verified power-line exclusion evidence is present and must block approval-ready layouts until reviewed.",
    };
  }
  if (powerFeatures.some((feature) => (
    feature.properties?.powerLineEvidenceStatus === "provisional"
    || feature.properties?.power_line_evidence_status === "provisional"
    || feature.confidence === "user_estimated"
  ))) {
    return {
      status: "provisional",
      message: "Provisional power evidence is present; verify overhead geometry or record an explicit exclusion before approval.",
    };
  }
  return {
    status: "verified",
    message: "Separate power evidence is present; qualified utility and field review remain required.",
  };
}

function generatedFieldPivotZoneFeature(project: PivotProject, candidate: AdvisoryFieldPivotPlan["candidates"][number]): ProjectMapFeature {
  return {
    id: generatedFieldPivotZoneFeatureId(project.id, candidate.sequence),
    name: `Generated Pivot Zone ${candidate.sequence}`,
    kind: "machine_zone",
    geometry: {
      type: "Circle",
      center: candidate.pivotCenter,
      radiusMeters: candidate.machineRadiusMeters,
    },
    confidence: "optimized",
    notes: [
      "Generated advisory field-pivot review zone.",
      "This is a projected-XY machine-zone map feature, not a saved pivot or certified machine layout.",
      "Qualified field and vendor review required before using for construction or operations.",
    ].join(" "),
    properties: {
      advisoryOnly: true,
      canonicalGeometryMutation: false,
      qualifiedReviewRequired: true,
      source: "generated_field_pivot_plan",
      generatedFieldPivotCandidateId: candidate.id,
      generatedFieldPivotSequence: candidate.sequence,
      modeledIrrigatedAcres: candidate.modeledIrrigatedAcres,
      incrementalIrrigatedAcres: candidate.incrementalIrrigatedAcres,
      cumulativeFieldCoveragePercent: candidate.cumulativeFieldCoveragePercent,
      minimumRequiredSeparationMeters: candidate.minimumRequiredSeparationMeters,
      machineRadiusMeters: candidate.machineRadiusMeters,
    },
  };
}

function generatedFieldPivotZoneFeatureId(projectId: string, sequence: number): string {
  return `generated-field-pivot-zone-${slugIdPart(projectId)}-${sequence}`;
}

function slugIdPart(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return slug || "project";
}

function formatGeneratedFieldPivotPlanSummary(plan: AdvisoryFieldPivotPlan, settings: AppSettings): string {
  const first = plan.candidates[0];
  const firstIncrement = first
    ? ` · first adds ${formatAreaFromAcres(first.incrementalIrrigatedAcres, settings.unitSystem)}`
    : "";
  return `${plan.status.replaceAll("_", " ")} · ${plan.selectedMachineCount}/${plan.requestedMachineCount} separated advisory center${plan.requestedMachineCount === 1 ? "" : "s"} · ${plan.fieldCoveragePercent.toFixed(1)}% field coverage · ${formatAreaFromAcres(plan.fieldUnirrigatedAcres, settings.unitSystem)} remaining dry${firstIncrement}`;
}

function shortestBoundaryClearanceRow(rows: MachineBoundaryClearanceRow[]): MachineBoundaryClearanceRow | null {
  return rows.length > 0
    ? [...rows].sort((left, right) => left.minimumBoundaryDistanceMeters - right.minimumBoundaryDistanceMeters)[0]
    : null;
}

function isWillRheaGuidedDemo(project: PivotProject): boolean {
  return project.id === willRheaJasonHarmelinkExampleProject.id;
}

function positiveFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function layoutReviewClearanceStepMeters(unitSystem: AppSettings["unitSystem"]): number {
  return unitSystem === "metric" ? 5 : 15.24;
}

function appRadiusSensitivityRadii(project: PivotProject): number[] {
  const currentRadius = machineRadiusMeters(project.machine);
  return [0.6, 1]
    .map((ratio) => Math.round(currentRadius * ratio * 1000) / 1000)
    .filter((radius) => Number.isFinite(radius) && radius > 0)
    .filter((radius, index, radii) => radii.indexOf(radius) === index);
}

function appEndGunThrowSensitivityThrows(project: PivotProject): number[] {
  const currentThrow = Math.max(0, project.machine.endGunThrowMeters);
  const throws = currentThrow > 0
    ? [0, currentThrow, currentThrow * 1.5]
    : [0, 15, 30];
  return throws
    .map((throwMeters) => Math.round(throwMeters * 1000) / 1000)
    .filter((throwMeters) => Number.isFinite(throwMeters) && throwMeters >= 0)
    .filter((throwMeters, index, throwDistances) => throwDistances.indexOf(throwMeters) === index);
}

function appSweepEfficiencyRadii(project: PivotProject): number[] {
  const currentRadius = machineRadiusMeters(project.machine);
  return [0.6, 0.75, 0.9]
    .map((ratio) => Math.round(currentRadius * ratio * 1000) / 1000)
    .filter((radius) => Number.isFinite(radius) && radius > 0)
    .filter((radius, index, radii) => radii.indexOf(radius) === index);
}

function awarenessFeatureCount(project: PivotProject): number {
  return (project.mapFeatures ?? []).filter((feature) => (
    feature.kind === "planning_boundary"
    || feature.kind === "machine_zone"
    || feature.kind === "measurement_line"
    || feature.kind === "linear_move_path"
    || feature.kind === "well_location"
    || feature.kind === "underground_wire"
  )).length;
}

function mapFeatureLengthMeters(feature: ProjectMapFeature): number {
  if (typeof feature.properties?.lengthMeters === "number") return feature.properties.lengthMeters;
  if (feature.geometry.type === "LineString") return lineLengthMeters(feature.geometry.vertices);
  if (feature.geometry.type === "Polygon") return lineLengthMeters([...feature.geometry.vertices, feature.geometry.vertices[0]].filter(Boolean));
  if (feature.geometry.type === "Circle") return Math.PI * 2 * feature.geometry.radiusMeters;
  return 0;
}

function lineLengthMeters(vertices: XY[]): number {
  return vertices.slice(1).reduce((sum, vertex, index) => {
    const previous = vertices[index];
    return sum + Math.hypot(vertex.x - previous.x, vertex.y - previous.y);
  }, 0);
}

function CatalogHomePanel({
  onImport, onPreferences, onOpenDesign,
  catalog,
  notice,
  onCreateClient,
  onStartBlankDesign,
  repository,
  settings,
}: {
  onImport: () => void;
  onPreferences: () => void;
  onOpenDesign: (id: string) => Promise<void>;
  catalog: ProjectWorkspaceStatus["catalog"];
  notice: string | null;
  onCreateClient: () => void;
  onStartBlankDesign: () => void;
  repository: ProjectWorkspaceStatus;
  settings: AppSettings;
}): React.JSX.Element {
  const storageLabel = repository.backendInfo?.backendLabel ?? repository.backendLabel;

  return (
    <>
      <Text style={styles.sectionTitle}>Start or resume your work</Text>
      {notice ? (
        <View style={styles.warningItem} testID="catalog-notice">
          <AlertTriangle size={17} color="#9a4c1c" />
          <Text style={styles.warningText}>{notice}</Text>
        </View>
      ) : null}
      <View style={styles.inlineActions}>
        <SmallActionButton label="Create customer" onPress={onCreateClient} testID="start-create-customer" />
        <SmallActionButton label="Import" onPress={onImport} testID="start-import" />
      </View>
      <View style={styles.mapFeatureEditor} testID="recent-work">
        <Text style={styles.mapFeatureTitle}>Recent work</Text>
        {[...(repository.designCatalog?.designs ?? catalog.designs)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6).map(design =>
          <Pressable key={design.id} accessibilityRole="button" accessibilityLabel={`Open ${design.name}`} onPress={() => { void onOpenDesign(design.id); }} style={{ padding: 10, borderWidth: 1, borderColor: "#ccd7c9", borderRadius: 8, gap: 5 }} testID={`recent-design-${design.id}`}>
            <SavedDesignPreview designId={design.id} revision={"revision" in design ? design.revision : undefined} fieldName={catalog.fieldMaps.find(item => item.id === design.fieldMapId)?.name} />
            <Text style={styles.mapFeatureTitle}>{design.name}</Text><Text style={styles.mapFeatureMeta}>Open</Text>
          </Pressable>)}
        {(repository.designCatalog?.designs ?? catalog.designs).length === 0 ? <Text style={styles.mapFeatureMeta}>Your saved drafts and designs will appear here.</Text> : null}
      </View>
      <View style={styles.warningItem}>
        <MapPinned size={17} color="#9a4c1c" />
        <Text style={styles.warningText}>Create a customer and project, name your first field, then add a design. You can return to any saved item from the list.</Text>
      </View>
      <View style={styles.inlineActions}>
        <SmallActionButton label="Units and preferences" onPress={onPreferences} testID="start-preferences" />
      </View>
      <View testID="catalog-home-readiness">
        <View style={styles.mapFeatureEditor} testID="catalog-home-status">
          <Text style={styles.mapFeatureTitle}>Storage details</Text>
          <Text style={styles.mapFeatureMeta}>{storageLabel} · {repository.statusMessage}</Text>
          <Text style={styles.mapFeatureMeta}>
            {settings.onlineImagery.enabled ? "USGS live reference is enabled with attribution on the map." : "No external imagery is requested."}
          </Text>
        </View>
      </View>
    </>
  );
}

function ClientDetailPanel({
  activeProjectId,
  catalog,
  client,
  notice,
  onCreateProject,
  onDeleteClient,
  onDeleteProject,
  onEditClient,
  onMoveProject,
  onOpenProject,
  onRenameProject,
  onSelectProject,
}: {
  activeProjectId: string | null;
  catalog: ProjectWorkspaceStatus["catalog"];
  client: ClientRecord;
  notice: string | null;
  onCreateProject: () => void;
  onDeleteClient: (clientId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onEditClient: (clientId: string) => void;
  onMoveProject: (projectId: string) => void;
  onOpenProject: (projectId: string) => void | Promise<void>;
  onRenameProject: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
}): React.JSX.Element {
  const projects = catalog.projects.filter((projectRecord) => projectRecord.clientId === client.id);
  const profileRows = [
    ["Company", client.companyName],
    ["Primary Contact", client.contactName],
    ["Email", client.email],
    ["Phone", client.phone],
    ["Location", client.location],
  ].filter(([, value]) => value);
  const canDeleteClient = projects.length === 0;

  return (
    <>
      <View style={styles.clientDetailHeader} testID="client-detail-panel">
        <View style={styles.clientIconBadge}>
          <UserRound size={22} color="#eef7f1" />
        </View>
        <View style={styles.clientDetailTitleBlock}>
          <Text style={styles.sectionTitle}>{client.displayName}</Text>
          <Text style={styles.mapFeatureMeta}>{projects.length} project{projects.length === 1 ? "" : "s"} in this customer</Text>
        </View>
      </View>

      <View style={styles.inlineActions}>
        <SmallActionButton label="Edit Customer" onPress={() => onEditClient(client.id)} />
        <SmallActionButton disabled={!canDeleteClient} label="Delete Customer" onPress={() => onDeleteClient(client.id)} />
        <SmallActionButton label="New Project" onPress={onCreateProject} />
      </View>

      {notice ? (
        <View style={styles.warningItem} testID="catalog-notice">
          <AlertTriangle size={17} color="#9a4c1c" />
          <Text style={styles.warningText}>{notice}</Text>
        </View>
      ) : null}

      <View style={styles.mapFeatureEditor}>
        <Text style={styles.mapFeatureTitle}>Profile</Text>
        {profileRows.length === 0 && !client.notes ? (
          <Text style={styles.mapFeatureMeta}>No contact details saved yet.</Text>
        ) : profileRows.map(([label, value]) => (
          <View key={label} style={styles.profileRow}>
            <Text style={styles.profileLabel}>{label}</Text>
            <Text style={styles.profileValue}>{value}</Text>
          </View>
        ))}
        {client.notes ? <Text style={styles.profileNotes}>{client.notes}</Text> : null}
        {!canDeleteClient ? <Text style={styles.mapFeatureMeta}>Delete is available after moving or deleting contained projects.</Text> : null}
      </View>

      <View style={styles.projectList} testID="client-detail-projects">
        {projects.length === 0 ? (
          <Text style={styles.dashboardMuted}>No projects in this customer.</Text>
        ) : projects.map((projectRecord) => {
          const fieldMaps = catalog.fieldMaps.filter((fieldMap) => fieldMap.projectId === projectRecord.id);
          const active = activeProjectId === projectRecord.id;
          return (
            <Pressable
              accessibilityLabel={`Select project ${projectRecord.name}`}
              accessibilityRole="button"
              key={projectRecord.id}
              onPress={() => onSelectProject(projectRecord.id)}
              style={[styles.clientProjectRow, active && styles.clientProjectRowActive]}
              testID={`client-project-row-${projectRecord.id}`}
            >
              <View style={styles.clientProjectText}>
                <Text style={styles.rowTitle}>{projectRecord.name}</Text>
                <Text style={styles.rowMeta}>{fieldMaps.length} field{fieldMaps.length === 1 ? "" : "s"} · {projectRecord.projectCrs} · {projectRecord.unitSystem.replaceAll("_", " ")}</Text>
              </View>
              <View style={styles.inlineActions}>
                <SmallActionButton label="Open" onPress={() => onOpenProject(projectRecord.id)} />
                <SmallActionButton label="Rename" onPress={() => onRenameProject(projectRecord.id)} />
                <SmallActionButton label="Move" onPress={() => onMoveProject(projectRecord.id)} />
                <SmallActionButton label="Delete" onPress={() => onDeleteProject(projectRecord.id)} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

function ProjectDashboard({
  compact,
  dirty,
  mode,
  onCreate,
  onInspectMap,
  onOpenFiles,
  onOpenImprovedProof,
  onOpenMap,
  onOpenProject,
  onOpenRealProof,
  onOpenSample,
  onResetWalkthrough,
  onToggleWalkthrough,
  project,
  repository,
  result,
  settings,
  walkthroughProgress,
}: {
  compact: boolean;
  dirty: boolean;
  mode: "launcher" | "workspace";
  onCreate: () => void;
  onInspectMap: () => void;
  onOpenFiles: () => void;
  onOpenImprovedProof: () => void;
  onOpenMap: () => void;
  onOpenProject: (projectId: string) => void | Promise<void>;
  onOpenRealProof: () => void;
  onOpenSample: () => void;
  onResetWalkthrough: () => void;
  onToggleWalkthrough: (moduleId: WalkthroughModuleId, complete: boolean) => void;
  project: PivotProject;
  repository: ProjectWorkspaceStatus;
  result: ReturnType<typeof evaluateLayout>;
  settings: AppSettings;
  walkthroughProgress: Record<WalkthroughModuleId, boolean>;
}): React.JSX.Element {
  const completedWalkthrough = WALKTHROUGH_MODULES.filter((module) => walkthroughProgress[module.id]).length;
  const warningCount = result.warnings.length + result.metrics.obstacleConflictCount + (result.metrics.outsideFieldAcres > 0 ? 1 : 0);
  const nextStep = recommendedWorkflowStep(project, result, settings, walkthroughProgress, dirty);
  const recentProjects = repository.projects.slice(0, 5);

  return (
    <View style={styles.dashboard} testID={`dashboard-${mode}`}>
      <View style={[styles.dashboardHero, compact && styles.dashboardHeroCompact]}>
        <View style={styles.dashboardIntro}>
          <Text style={styles.dashboardTitle}>{mode === "launcher" ? "Project Dashboard" : project.name}</Text>
          <Text style={styles.dashboardSubtitle}>
            {nextStep}
          </Text>
          <View style={styles.dashboardActions}>
            <SmallActionButton label="Continue Mapping" onPress={onOpenMap} />
            <SmallActionButton label="Inspect Map" onPress={onInspectMap} />
            <SmallActionButton label="Export Package" onPress={onOpenFiles} />
          </View>
        </View>
        <View style={styles.dashboardMetricStack}>
          <MetricTile label="Coverage" value={`${result.metrics.coveragePercent.toFixed(1)}%`} tone="neutral" />
          <MetricTile label="Irrigated" value={formatAreaFromAcres(result.metrics.irrigatedAcres, settings.unitSystem)} tone="good" />
          <MetricTile label="Machine radius" value={formatDistance(machineRadiusMeters(project.machine), settings.unitSystem)} />
          <MetricTile label="Layout warnings" value={`${warningCount}`} tone={warningCount > 0 ? "warn" : "good"} />
        </View>
      </View>

      <View style={styles.dashboardGrid}>
        <DashboardCard
          icon={<Satellite size={20} color="#173428" />}
          testID="dashboard-card-imagery"
          title="Imagery Status"
          value={settings.onlineImagery.enabled ? "USGS live reference enabled" : "Live imagery disabled"}
          detail={settings.onlineImagery.enabled ? "Attribution is shown on-map; imagery is not stored in project files." : "Enable imagery in Settings for browser-local tracing."}
        />
        <DashboardCard
          icon={<Database size={20} color="#173428" />}
          testID="dashboard-card-storage"
          title="Storage"
          value={repository.backendInfo?.backendLabel ?? repository.backendLabel}
          detail={`${repository.statusMessage} · ${dirty ? "unsaved edits" : "export-ready after latest save"}`}
        />
        <DashboardCard
          icon={<PackageCheck size={20} color="#173428" />}
          testID="dashboard-card-export"
          title="Export Readiness"
          value={dirty ? "Save before export" : "Ready to package"}
          detail="Project ZIP excludes browser-local imagery settings, custom drafts, local directories, and walkthrough progress."
        />
        <DashboardCard
          icon={<ListChecks size={20} color="#173428" />}
          testID="dashboard-card-walkthrough"
          title="Walkthrough"
          value={`${completedWalkthrough}/${WALKTHROUGH_MODULES.length} modules`}
          detail="Progress is local-only and is never written into PivotProject or project archives."
        />
      </View>

      <WorkflowWalkthrough
        onReset={onResetWalkthrough}
        onToggle={onToggleWalkthrough}
        progress={walkthroughProgress}
      />

      {isWillRheaGuidedDemo(project) ? (
        <WillRheaGuidedDemoPanel project={project} settings={settings} />
      ) : null}

      <View style={styles.dashboardGrid}>
        <View style={styles.dashboardPanel} testID="dashboard-recent-projects">
          <View style={styles.dashboardPanelHeader}>
            <FolderOpen size={19} color="#173428" />
            <Text style={styles.dashboardPanelTitle}>Recent Projects</Text>
          </View>
          <View style={styles.dashboardActions}>
            <SmallActionButton label="Create New" onPress={onCreate} />
            <SmallActionButton label="Open Sample" onPress={onOpenSample} />
            <SmallActionButton label="Real Proof" onPress={onOpenRealProof} />
            <SmallActionButton label="Improved Pivot Proof" onPress={onOpenImprovedProof} />
          </View>
          {recentProjects.length === 0 ? (
            <Text style={styles.dashboardMuted}>No saved browser projects yet.</Text>
          ) : recentProjects.map((summary) => (
            <Pressable
              accessibilityLabel={`Open recent project ${summary.name}`}
              accessibilityRole="button"
              key={summary.id}
              onPress={() => void onOpenProject(summary.id)}
              style={styles.recentProjectRow}
              testID={`recent-project-${summary.id}`}
            >
              <View>
                <Text style={styles.rowTitle}>{summary.name}</Text>
                <Text style={styles.rowMeta}>{summary.projectCrs} · {summary.unitSystem.replaceAll("_", " ")} · {new Date(summary.updatedAt).toLocaleString()}</Text>
              </View>
              <FolderOpen size={18} color="#173428" />
            </Pressable>
          ))}
        </View>

        <View style={styles.dashboardPanel} testID="dashboard-layout-warnings">
          <View style={styles.dashboardPanelHeader}>
            <AlertTriangle size={19} color="#173428" />
            <Text style={styles.dashboardPanelTitle}>Layout Warnings</Text>
          </View>
          <View style={styles.dashboardActions}>
            <SmallActionButton label="Inspect Map" onPress={onInspectMap} />
          </View>
          {editorWarningRows(result).length === 0 ? (
            <Text style={styles.dashboardMuted}>No active layout warnings.</Text>
          ) : editorWarningRows(result).map((warning) => (
            <View key={warning} style={styles.warningItem}>
              <AlertTriangle size={17} color="#9a4c1c" />
              <Text style={styles.warningText}>{warning}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function WorkflowWalkthrough({
  onReset,
  onToggle,
  progress,
}: {
  onReset: () => void;
  onToggle: (moduleId: WalkthroughModuleId, complete: boolean) => void;
  progress: Record<WalkthroughModuleId, boolean>;
}): React.JSX.Element {
  return (
    <View style={[styles.dashboardPanel, styles.walkthroughPanel]}>
      <View style={styles.dashboardPanelHeader}>
        <ListChecks size={19} color="#173428" />
        <Text style={styles.dashboardPanelTitle}>Workflow Walkthrough</Text>
        <Pressable
          accessibilityLabel="Reset walkthrough progress for active project"
          accessibilityRole="button"
          onPress={onReset}
          style={styles.resetButton}
        >
          <RotateCcw size={14} color="#173428" />
          <Text style={styles.resetButtonText}>Reset</Text>
        </Pressable>
      </View>
      <View style={styles.walkthroughGrid}>
        {WALKTHROUGH_MODULES.map((module) => {
          const complete = progress[module.id];
          const toggleModule = () => onToggle(module.id, !complete);
          return (
            <Pressable
              accessibilityLabel={`${complete ? "Clear" : "Complete"} ${module.title} walkthrough checkpoint`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: complete }}
              key={module.id}
              onPress={toggleModule}
              style={[styles.walkthroughModule, complete && styles.walkthroughModuleComplete]}
              testID={`walkthrough-module-${module.id}`}
              {...webCheckboxProps(complete, toggleModule)}
            >
              {complete ? <CheckCircle2 size={18} color="#0f5e3d" /> : <Upload size={18} color="#6b796f" />}
              <View style={styles.walkthroughText}>
                <Text style={styles.walkthroughTitle}>{module.title}</Text>
                <Text style={styles.walkthroughCheckpoint}>{module.checkpoint}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function WillRheaGuidedDemoPanel({
  project,
  settings,
}: {
  project: PivotProject;
  settings: AppSettings;
}): React.JSX.Element {
  const features = project.mapFeatures ?? [];
  const machineZones = features.filter((feature) => feature.kind === "machine_zone");
  const preferredOutlines = machineZones.filter((feature) => feature.properties?.preferredMachineOutline === true);
  const lrduEvidence = features.find((feature) => feature.id === "will-rhea-lrdu-distance" && feature.kind === "measurement_line");
  const boundaryEvidence = features.find((feature) => feature.id === "will-rhea-full-scope-field-boundary-evidence" && feature.kind === "planning_boundary");
  const pivotEvidence = project.surveyPoints.find((point) => point.id === "will-rhea-pivot-point" && point.role === "pivot_center");
  const sourcePaths = Array.from(new Set(features
    .map((feature) => typeof feature.properties?.sourcePath === "string" ? feature.properties.sourcePath : null)
    .filter((value): value is string => Boolean(value))));
  const sourceHashes = Array.from(new Set(features.flatMap((feature) => [
    typeof feature.properties?.sourceKmzSha256 === "string" ? feature.properties.sourceKmzSha256 : null,
    typeof feature.properties?.sourceSha256 === "string" ? feature.properties.sourceSha256 : null,
  ]).filter((value): value is string => Boolean(value))));
  const lrduRadiusMeters = typeof lrduEvidence?.properties?.derivedLengthMeters === "number"
    ? lrduEvidence.properties.derivedLengthMeters
    : machineRadiusMeters(project.machine);
  const hasMeasuredLrduSpeed = positiveFiniteNumber(project.machine.driveUnits?.lrdu?.operatorMeasuredSpeedMetersPerMinute);
  const hasSourceLabeledCornerArmModel = Boolean(project.machine.cornerArm && VALLEY_CORNER_ARM_SCAFFOLD_CATALOG.some((entry) => entry.id === project.machine.cornerArm?.id));
  const hasSelectedOrientation = project.machine.cornerArm?.orientation === "leading" || project.machine.cornerArm?.orientation === "trailing";
  const missingInputs = [
    hasMeasuredLrduSpeed ? null : "Measured LRDU speed at 100% timer",
    hasSourceLabeledCornerArmModel ? null : "Source-labeled corner-arm model/config",
    hasSelectedOrientation ? null : "Operator-selected leading/trailing orientation and rotation context",
    "Explicit SDU guidance-line and rotation selection in Calculate",
  ].filter((value): value is string => Boolean(value));

  return (
    <View style={styles.dashboardPanel} testID="will-rhea-guided-demo-panel">
      <View style={styles.dashboardPanelHeader}>
        <MapPinned size={19} color="#173428" />
        <Text style={styles.dashboardPanelTitle}>Will Rhea Guided Demo</Text>
      </View>
      <Text style={styles.dashboardMuted}>
        This sample opens as an explicit demo map. It is not silently created as a saved catalog client/project record, and walkthrough progress stays local-only.
      </Text>
      <AdvisoryBadgeRow badges={["EPSG:32614", "projected XY", "advisory evidence", "no Google Earth proof"]} />
      <View style={styles.metricGrid}>
        <MetricTile label="Boundary evidence" value={boundaryEvidence ? "Recorded" : "Missing"} tone="warn" />
        <MetricTile label="Pivot evidence" value={pivotEvidence ? "Imported point" : "Missing"} tone={pivotEvidence ? "good" : "warn"} />
        <MetricTile label="LRDU radius" value={formatDistance(lrduRadiusMeters, settings.unitSystem)} />
        <MetricTile label="Machine zones" value={`${machineZones.length}`} />
        <MetricTile label="Preferred outlines" value={`${preferredOutlines.length}`} />
        <MetricTile label="Guidance path" value="Selection required" tone="warn" />
      </View>
      <View style={styles.warningList} testID="will-rhea-evidence-status">
        <EvidenceStatusRow label="Field boundary" value={boundaryEvidence ? "Imported planning_boundary evidence. Current boundary match unverified." : "Missing imported boundary evidence."} />
        <EvidenceStatusRow label="Pivot point" value={pivotEvidence ? "Imported pivot_center survey evidence; it does not move the active pivot without an explicit operator action." : "Missing imported pivot evidence."} />
        <EvidenceStatusRow label="LRDU line" value={lrduEvidence ? "LRDU Distance measurement_line with derived radius evidence; not overhang/end-boom proof." : "Missing LRDU measurement_line evidence."} />
        <EvidenceStatusRow label="Sources" value={`${sourcePaths.length} local path${sourcePaths.length === 1 ? "" : "s"} and ${sourceHashes.length} SHA-256 hash${sourceHashes.length === 1 ? "" : "es"} recorded on evidence features.`} />
      </View>
      <View testID="will-rhea-corner-arm-input-blockers">
        <Text style={styles.formLabel}>Corner-arm calculation blockers</Text>
        {missingInputs.map((input) => (
          <Text key={input} style={styles.formError}>{input}</Text>
        ))}
        {missingInputs.length === 0 ? (
          <Text style={styles.mapFeatureMeta}>Required inputs are present; use Calculate Preview to review advisory LRDU, SDU, overhang, and end-gun rows.</Text>
        ) : (
          <Text style={styles.mapFeatureMeta}>
            Do not prefill Will Rhea with synthetic speed, model, orientation, or guidance data. Supply verified inputs before treating the kinematic panel as ready.
          </Text>
        )}
      </View>
    </View>
  );
}

function EvidenceStatusRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.warningItem}>
      <CheckCircle2 size={17} color="#0f5e3d" />
      <Text style={styles.warningText}>{label}: {value}</Text>
    </View>
  );
}

function HelpTrainingPanel({
  onNavigate,
  onResetWalkthrough,
  onToggleWalkthrough,
  progress,
}: {
  onNavigate: (view: WorkspaceView) => void;
  onResetWalkthrough: () => void;
  onToggleWalkthrough: (moduleId: WalkthroughModuleId, complete: boolean) => void;
  progress: Record<WalkthroughModuleId, boolean>;
}): React.JSX.Element {
  const modules: Array<{
    boundary: string;
    checkpoints: WalkthroughModuleId[];
    detail: string;
    icon: React.ReactNode;
    route: WorkspaceView;
    routeLabel: string;
    testID: string;
    title: string;
  }> = [
    {
      boundary: "Samples remain unsaved until Save succeeds. New designs start as drafts under the selected field. Apply your inputs, then Create complete design when ready. Convert a completed pivot to a field design, save it, and freeze its target to open Layout. Local progress stays outside project ZIPs.",
      checkpoints: [],
      detail: "Use the catalog, then move into Map for layout work.",
      icon: <Home size={18} color="#254234" />,
      route: "map",
      routeLabel: "Go to Map",
      testID: "help-module-start",
      title: "Start",
    },
    {
      boundary: "Polygon, Line, and Point capture projected XY, not qualified RTK observations. Finish opens purpose selection; Clear discards the unfinished drawing. Remove last vertex corrects a draft without undoing project edits. XY length, area and perimeter are planar previews, not surveyed 3D or ground measurements. Fit field preserves geometry and drafts; compact SVG Map legend opens the color key.",
      checkpoints: ["boundary", "obstacles", "pivot"],
      detail: "Trace field polygons, obstacle polygons, utility paths, placemarks, and measurement marks in Design mode.",
      icon: <Pentagon size={18} color="#254234" />,
      route: "map",
      routeLabel: "Go to Map",
      testID: "help-module-map-tools",
      title: "Map Tools",
    },
    {
      boundary: "Google Earth Pro is a local companion reference only; KML/KMZ styles, labels, LookAt, imagery, and screenshots are not canonical geometry.",
      checkpoints: ["boundary", "obstacles"],
      detail: "Use Search, Add Polygon, Add Path, Add Placemark, then import focused KML/KMZ through Files import selection cards.",
      icon: <MapPinned size={18} color="#254234" />,
      route: "files",
      routeLabel: "Go to Files",
      testID: "help-module-google-earth",
      title: "Google Earth Companion",
    },
    {
      boundary: "Local aerial packages and no-key USGS preview are reference layers; they are not stored as geometry.",
      checkpoints: ["imagery"],
      detail: "Choose offline local aerial packages first, use live preview only as capped reference imagery, and keep attribution visible.",
      icon: <Satellite size={18} color="#254234" />,
      route: "settings",
      routeLabel: "Go to Settings",
      testID: "help-module-imagery",
      title: "Imagery",
    },
    {
      boundary: "Can apply means the manual draft can be committed, not field readiness. Corner-arm samples do not prove continuous clearance or steering feasibility.",
      checkpoints: ["cornerArmInputs", "cornerArmCalculation", "validation"],
      detail: "Inspect coverage warnings, obstacle conflicts, outside-field acres, and draft validation before export.",
      icon: <ClipboardList size={18} color="#254234" />,
      route: "map",
      routeLabel: "Inspect Map",
      testID: "help-module-layout-validation",
      title: "Layout Validation",
    },
    {
      boundary: "RTK fixed and receiver RMS estimates do not prove less-than-0.10-m 3D error. Height reference, antenna offset and independent field control remain required.",
      checkpoints: [],
      detail: "Review the receiver capture gate before recording each survey point. PX1122R/NS-RAW hardware and relay switching remain unqualified.",
      icon: <Satellite size={18} color="#254234" />,
      route: "survey",
      routeLabel: "Go to Survey",
      testID: "help-module-rtk",
      title: "RTK Qualification",
    },
    {
      boundary: "Android SQLite and ZIP behavior require device proof for each runtime claim; browser local storage remains the web MVP backend.",
      checkpoints: ["export"],
      detail: "Save Local before export, keep machine paths local-only, and treat native proof reports separately from browser checks.",
      icon: <Database size={18} color="#254234" />,
      route: "settings",
      routeLabel: "Go to Settings",
      testID: "help-module-android-storage",
      title: "Android Storage",
    },
    {
      boundary: "Project ZIP is canonical. KML/KMZ and GeoJSON are interchange outputs and do not prove Google Earth rendering.",
      checkpoints: ["export"],
      detail: "Export ZIP for backup/handoff, and export KML/KMZ or GeoJSON for visual interchange.",
      icon: <PackageCheck size={18} color="#254234" />,
      route: "files",
      routeLabel: "Go to Files",
      testID: "help-module-export",
      title: "Export",
    },
  ];
  const completedCount = WALKTHROUGH_MODULES.filter((module) => progress[module.id]).length;

  return (
    <View style={styles.helpPanel}>
      <View style={styles.helpHeader} testID="help-training-panel">
        <View style={styles.helpHeaderCopy}>
          <Text style={styles.dashboardCardValue}>{completedCount}/{WALKTHROUGH_MODULES.length} workflow checkpoints</Text>
          <Text style={styles.dashboardMuted}>Training progress uses the same local walkthrough store as the dashboard and stays out of project schemas and archives.</Text>
        </View>
        <View style={styles.helpQuickActions}>
          <HelpActionButton label="Go to Map" onPress={() => onNavigate("map")} testID="help-action-map" />
          <HelpActionButton label="Go to Files" onPress={() => onNavigate("files")} testID="help-action-files" />
          <HelpActionButton label="Go to Settings" onPress={() => onNavigate("settings")} testID="help-action-settings" />
          <HelpActionButton label="Reset" onPress={onResetWalkthrough} testID="help-reset-progress" />
        </View>
      </View>
      <View style={styles.helpModuleGrid}>
        {modules.map((module) => {
          const complete = module.checkpoints.length > 0 && module.checkpoints.every((checkpoint) => progress[checkpoint]);
          return (
            <View key={module.title} style={styles.helpModuleCard} testID={module.testID}>
              <View style={styles.dashboardPanelHeader}>
                {module.icon}
                <Text style={styles.dashboardCardTitle}>{module.title}</Text>
              </View>
              <Text style={styles.dashboardMuted}>{module.detail}</Text>
              <Text style={styles.mapFeatureMeta}>{module.boundary}</Text>
              {module.checkpoints.length > 0 ? (
                <View style={styles.helpCheckpointRow}>
                  {module.checkpoints.map((checkpoint) => (
                    <Pressable
                      accessibilityLabel={`${progress[checkpoint] ? "Clear" : "Complete"} ${walkthroughTitle(checkpoint)} walkthrough checkpoint`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: progress[checkpoint] }}
                      key={checkpoint}
                      onPress={() => onToggleWalkthrough(checkpoint, !progress[checkpoint])}
                      style={[styles.helpCheckpoint, progress[checkpoint] && styles.helpCheckpointComplete]}
                      testID={`help-checkpoint-${checkpoint}`}
                      {...webCheckboxProps(progress[checkpoint], () => onToggleWalkthrough(checkpoint, !progress[checkpoint]))}
                    >
                      {progress[checkpoint] ? <CheckCircle2 size={15} color="#0f5e3d" /> : <Upload size={15} color="#6b796f" />}
                      <Text style={styles.helpCheckpointText}>{walkthroughTitle(checkpoint)}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={styles.helpCheckpointText}>Workflow entry point</Text>
              )}
              <View style={styles.inlineActions}>
                <HelpActionButton label={module.routeLabel} onPress={() => onNavigate(module.route)} testID={`${module.testID}-route`} />
                {module.checkpoints.length > 0 ? (
                  <Text style={[styles.helpStatusBadge, complete && styles.helpCompleteBadge]}>{complete ? "Complete" : "In progress"}</Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function HelpActionButton({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }): React.JSX.Element {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={styles.smallActionButton} testID={testID}>
      <Text style={styles.smallActionText}>{label}</Text>
    </Pressable>
  );
}

function walkthroughTitle(moduleId: WalkthroughModuleId): string {
  return WALKTHROUGH_MODULES.find((module) => module.id === moduleId)?.title ?? moduleId;
}

function webCheckboxProps(checked: boolean, onActivate: () => void): Record<string, unknown> {
  if (Platform.OS !== "web") return {};
  return {
    "aria-checked": checked ? "true" : "false",
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      onActivate();
    },
    tabIndex: 0,
  };
}

function DashboardCard({ detail, icon, testID, title, value }: { detail: string; icon: React.ReactNode; testID?: string; title: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.dashboardCard} testID={testID}>
      <View style={styles.dashboardPanelHeader}>
        {icon}
        <Text style={styles.dashboardCardTitle}>{title}</Text>
      </View>
      <Text style={styles.dashboardCardValue}>{value}</Text>
      <Text style={styles.dashboardMuted}>{detail}</Text>
    </View>
  );
}

function recommendedWorkflowStep(
  project: PivotProject,
  result: ReturnType<typeof evaluateLayout>,
  settings: AppSettings,
  progress: Record<WalkthroughModuleId, boolean>,
  dirty: boolean,
): string {
  if (dirty) return "Next: save local edits and export a project package.";
  if (!settings.onlineImagery.enabled && !progress.imagery) return "Next: choose local aerial package or USGS preview in Settings.";
  if (!progress.imagery) return "Next: confirm imagery attribution and source status.";
  if (project.fieldBoundary.length < 3 || !progress.boundary) return "Next: trace or inspect the field boundary in Design mode.";
  if (project.obstacles.length === 0 || !progress.obstacles) return "Next: add visible obstacles and no-spray zones.";
  if (!progress.pivot) return "Next: place pivot, water source, and power source.";
  if (project.surveyPoints.length === 0 || !progress.survey) return "Next: capture or import survey/control points.";
  if (result.warnings.length > 0 || result.metrics.obstacleConflictCount > 0 || !progress.validation) return "Next: inspect Map validation and resolve layout warnings.";
  if (!progress.export) return "Next: save local edits and export a project package.";
  return "Project is ready for repeat inspection, export, or field handoff.";
}

function editorWarningRows(result: ReturnType<typeof evaluateLayout>): string[] {
  return [
    ...result.warnings,
    ...(result.metrics.obstacleConflictCount > 0 ? [`${result.metrics.obstacleConflictCount} obstacle conflict${result.metrics.obstacleConflictCount === 1 ? "" : "s"} detected.`] : []),
    ...(result.metrics.outsideFieldAcres > 0 ? [`${result.metrics.outsideFieldAcres.toFixed(2)} acres of wet coverage are outside the field.`] : []),
  ];
}

function mergeMapPackageManifests(base: MapPackageManifest[], overrides: MapPackageManifest[]): MapPackageManifest[] {
  const byId = new Map(base.map((mapPackage) => [mapPackage.id, mapPackage]));
  for (const mapPackage of overrides) byId.set(mapPackage.id, mapPackage);
  return [...byId.values()];
}

function browserLocalSettings(settings?: PivotProject["settings"], current?: AppSettings): AppSettings {
  let merged = mergeAppSettings(settings);
  if (!current && Platform.OS === "web") {
    try {
      const preference = JSON.parse(globalThis.localStorage?.getItem("cplayout-workspace-preferences-v1") ?? "null");
      if (preference) merged = parseAppSettings({ ...merged, unitSystem: preference.unitSystem, coordinateDisplayFormat: preference.coordinateDisplayFormat });
    } catch { /* invalid optional preferences use validated defaults */ }
  }
  if (current) {
    return {
      ...merged,
      onlineImagery: current.onlineImagery,
      referenceOverlay: current.referenceOverlay,
    };
  }
  if (Platform.OS !== "web") return merged;
  return {
    ...merged,
    onlineImagery: {
      ...merged.onlineImagery,
      enabled: true,
      providerId: "usgs_imagery_only",
      maxTilesPerView: Math.min(64, merged.onlineImagery.maxTilesPerView),
    },
  };
}

function emptyWalkthroughProgress(): Record<WalkthroughModuleId, boolean> {
  return {
    imagery: false,
    boundary: false,
    obstacles: false,
    pivot: false,
    survey: false,
    cornerArmInputs: false,
    cornerArmCalculation: false,
    validation: false,
    export: false,
  };
}

function loadWalkthroughProgress(projectId: string): Record<WalkthroughModuleId, boolean> {
  const empty = emptyWalkthroughProgress();
  if (Platform.OS !== "web") return empty;
  try {
    const raw = globalThis.localStorage?.getItem(walkthroughStorageKey(projectId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<Record<WalkthroughModuleId, boolean>>;
    return {
      imagery: parsed.imagery === true,
      boundary: parsed.boundary === true,
      obstacles: parsed.obstacles === true,
      pivot: parsed.pivot === true,
      survey: parsed.survey === true,
      cornerArmInputs: parsed.cornerArmInputs === true,
      cornerArmCalculation: parsed.cornerArmCalculation === true,
      validation: parsed.validation === true,
      export: parsed.export === true,
    };
  } catch {
    return empty;
  }
}

function saveWalkthroughProgress(projectId: string, progress: Record<WalkthroughModuleId, boolean>): void {
  if (Platform.OS !== "web") return;
  try {
    globalThis.localStorage?.setItem(walkthroughStorageKey(projectId), JSON.stringify(progress));
  } catch {
    // Local progress is optional and must not block project work.
  }
}

function walkthroughStorageKey(projectId: string): string {
  return `${WALKTHROUGH_STORAGE_KEY}.${projectId}`;
}

function workflowModeLabel(mode: AppSettings["mappingWorkflowMode"]): string {
  return mode === "design" ? "Edit map" : "Inspect map";
}

function pendingPlacementMessage(action: PendingPlacementAction): string {
  if (action.kind === "pivot") {
    const center = action.candidate.pivotCenter;
    return `Apply advisory candidate ${action.candidate.id} as the project pivot center at projected XY ${center.x.toFixed(2)}, ${center.y.toFixed(2)}. This uses the existing reducer path and makes the project dirty.`;
  }
  return `Save ${action.config.name} as advisory corner-arm config on the machine. It remains separate from allowed coverage and requires qualified review.`;
}

function fixTypeLabel(fixType: string): string {
  return fixType.replaceAll("_", " ");
}

function formatLiveRtkStatus(status: BrowserRtkReceiverStatus | null): string | null {
  if (!status || (!status.connected && status.sentenceCount === 0)) return null;
  if (!status.connected) return "RTK disconnected - gate closed";
  if (!status.gateAccepted) return "RTK gate closed";
  const satellites = status.quality.satellites === null ? "sat unknown" : `${status.quality.satellites} sat`;
  const hdop = status.quality.hdop === null ? "HDOP unknown" : `HDOP ${status.quality.hdop.toFixed(2)}`;
  return `RTK gate accepted - ${fixTypeLabel(status.quality.fixType)} - ${satellites} - ${hdop}`;
}

function Section({ title, icon, children, testID }: { title: string; icon: React.ReactNode; children: React.ReactNode; testID?: string }): React.JSX.Element {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function StatusPill({ icon, label, testID }: { icon: React.ReactNode; label: string; testID?: string }): React.JSX.Element {
  return (
    <View style={styles.statusPill} testID={testID}>
      {icon}
      <Text style={styles.statusText}>{label}</Text>
    </View>
  );
}

function WorkspaceConsoleShell({
  children,
  compact,
  rightDrawerOpen,
  short,
  testID,
}: {
  children: React.ReactNode;
  compact: boolean;
  rightDrawerOpen: boolean;
  short: boolean;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={[styles.consoleShell, compact && styles.consoleShellCompact,
      short && styles.consoleShellShortLandscape, !rightDrawerOpen && styles.consoleShellRightCollapsed]} testID={testID}>
      {children}
    </View>
  );
}

type RightWorkflowSidebarTab = {
  count?: number;
  id: RightWorkflowSidebarPage;
  label: string;
  shortLabel: string;
};

function rightWorkflowSidebarPages({
  activeCatalogForm,
  catalogFormLabel,
  toolFormLabel,
  activePurposeForm,
  activeToolForm,
  homeView,
  mappingWorkflowMode,
  selectedMapFeature,
  warningCount,
}: {
  activeCatalogForm: boolean;
  catalogFormLabel: string;
  toolFormLabel: string;
  activePurposeForm: boolean;
  activeToolForm: boolean;
  homeView: boolean;
  mappingWorkflowMode: AppSettings["mappingWorkflowMode"];
  selectedMapFeature: boolean;
  warningCount: number;
}): RightWorkflowSidebarTab[] {
  if (homeView) {
    return [
      { id: "catalog", label: "Catalog", shortLabel: "CAT" },
      ...(activeCatalogForm ? [{ id: "catalogForm" as const, label: catalogFormLabel, shortLabel: "EDIT" }] : []),
    ];
  }
  return [
    { id: "overview", label: "Overview", shortLabel: "MAP" },
    ...(activeCatalogForm ? [{ id: "catalogForm" as const, label: catalogFormLabel, shortLabel: "EDIT" }] : []),
    ...(mappingWorkflowMode === "design" ? [{ id: "tools" as const, label: "Tools", shortLabel: "TOOL" }] : []),
    ...(mappingWorkflowMode === "design" && activePurposeForm ? [{ id: "purpose" as const, label: "Drawing purpose", shortLabel: "PURPOSE" }] : []),
    ...(mappingWorkflowMode === "design" && activeToolForm ? [{ id: "toolForm" as const, label: toolFormLabel, shortLabel: "INPUTS" }] : []),
    { id: "layers", label: "Layers", shortLabel: "LAY" },
    ...(selectedMapFeature ? [{ id: "feature" as const, label: "Feature", shortLabel: "FEAT" }] : []),
    { id: "warnings", label: "Warnings", shortLabel: "WARN", count: warningCount },
  ];
}

function RightWorkflowSidebar({
  activePage,
  purposeRejectionSequence,
  children,
  compact,
  onPageChange,
  onToggle,
  open,
  pages,
}: {
  activePage: RightWorkflowSidebarPage;
  purposeRejectionSequence: number | null;
  children: React.ReactNode;
  compact: boolean;
  onPageChange: (page: RightWorkflowSidebarPage) => void;
  onToggle: () => void;
  open: boolean;
  pages: RightWorkflowSidebarTab[];
}): React.JSX.Element {
  const scrollRef = useRef<ScrollView>(null);
  const tabScrollRef = useRef<ScrollView>(null);
  const tabPositions = useRef<Partial<Record<RightWorkflowSidebarPage, number>>>({});
  function revealActiveTab(page: RightWorkflowSidebarPage): void {
    const x = tabPositions.current[page];
    if (compact && open && x !== undefined) {
      tabScrollRef.current?.scrollTo({ x: Math.max(0, x - 10), animated: false });
    }
  }
  useEffect(() => {
    if (open && activePage === "purpose" && purposeRejectionSequence !== null) {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [activePage, open, purposeRejectionSequence]);
  useEffect(() => {
    revealActiveTab(activePage);
  }, [activePage, compact, open]);
  const activePageLabel = pages.find((page) => page.id === activePage)?.shortLabel ?? "MAP";
  const tabs = pages.map((page) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: activePage === page.id }}
      aria-selected={activePage === page.id}
      key={page.id}
      onLayout={(event) => {
        tabPositions.current[page.id] = event.nativeEvent.layout.x;
        if (page.id === activePage) revealActiveTab(page.id);
      }}
      onPress={() => onPageChange(page.id)}
      style={[styles.inspectorTab, activePage === page.id && styles.inspectorTabActive]}
      testID={`workflow-sidebar-tab-${page.id}`}
    >
      <Text style={[styles.inspectorTabText, activePage === page.id && styles.inspectorTabTextActive]}>
        {page.count && page.count > 0 ? `${page.label} ${page.count}` : page.label}
      </Text>
    </Pressable>
  ));
  return (
    <View style={[
      styles.inspectorDrawer,
      compact && styles.inspectorDrawerCompact,
      compact && open && styles.inspectorDrawerCompactOpen,
      !open && styles.inspectorDrawerCollapsed,
      compact && !open && styles.inspectorDrawerCollapsedCompact,
    ]} testID="right-workflow-sidebar">
      <Pressable
        accessibilityLabel={open ? "Collapse right workflow sidebar" : "Open right workflow sidebar"}
        accessibilityRole="button"
        onPress={onToggle}
        style={[styles.inspectorDrawerHandle, compact && styles.inspectorDrawerHandleCompact]}
        testID="right-drawer-handle"
      >
        {compact
          ? open ? <ChevronDown size={21} color="#d5e2db" /> : <ChevronUp size={21} color="#d5e2db" />
          : open ? <ChevronRight size={21} color="#d5e2db" /> : <ChevronLeft size={21} color="#d5e2db" />}
      </Pressable>
      {!open && !compact ? (
        <View style={styles.inspectorCollapsedStatus} testID="inspector-collapsed-status">
          <Text style={styles.inspectorCollapsedStatusText} numberOfLines={1}>{activePageLabel}</Text>
        </View>
      ) : null}
      {open ? (
        <View style={styles.inspectorDrawerBody} testID="inspector-drawer">
          {compact ? (
            <ScrollView horizontal ref={tabScrollRef} showsHorizontalScrollIndicator={false} style={styles.inspectorTabScroll}
              onContentSizeChange={() => revealActiveTab(activePage)}
              contentContainerStyle={[styles.inspectorTabs, styles.inspectorTabsCompact]} testID="workflow-sidebar-tabs">
              {tabs}
            </ScrollView>
          ) : <View style={styles.inspectorTabs} testID="workflow-sidebar-tabs">{tabs}</View>}
          <ScrollView ref={scrollRef} style={styles.inspectorScroll} contentContainerStyle={styles.inspectorContent} testID="inspector-scroll">
            {children}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function ProjectTreeRail({
  activeContext,
  activeView,
  catalog,
  designCatalog,
  compact,
  consoleMode,
  drawerOpen,
  foreground,
  menuDefinition,
  onCreateClient,
  onCreateDesign,
  onCreateFieldMap,
  onCreateProject,
  onNavigate,
  onOpenClient,
  onOpenDesign,
  onOpenFieldMap,
  onOpenProject,
  onOpenSample,
  onStartBlankDesign,
  onSelectClient,
  onSelectDesign,
  onSelectFieldMap,
  onSelectProject,
  onToggleDrawer,
}: {
  activeContext: {
    clientId: string | null;
    projectId: string | null;
    fieldMapId: string | null;
    designId: string | null;
  };
  activeView: WorkspaceView;
  catalog: ProjectWorkspaceStatus["catalog"];
  designCatalog: ProjectWorkspaceStatus["designCatalog"];
  compact: boolean;
  consoleMode: boolean;
  drawerOpen: boolean;
  foreground: boolean;
  menuDefinition: CplayoutLeftNavMenuDefinition;
  onCreateClient: () => void | Promise<void>;
  onCreateDesign: () => void | Promise<void>;
  onCreateFieldMap: () => void | Promise<void>;
  onCreateProject: () => void | Promise<void>;
  onNavigate: (view: WorkspaceView) => void;
  onOpenClient: (clientId: string) => void;
  onOpenDesign: (designId: string) => void | Promise<void>;
  onOpenFieldMap: (fieldMapId: string) => void | Promise<void>;
  onOpenProject: (projectId: string) => void | Promise<void>;
  onOpenSample: () => void;
  onStartBlankDesign: () => void;
  onSelectClient: (clientId: string) => void;
  onSelectDesign: (designId: string) => void;
  onSelectFieldMap: (fieldMapId: string) => void;
  onSelectProject: (projectId: string) => void;
  onToggleDrawer: () => void;
}): React.JSX.Element {
  const tree = buildProjectTreeViewModel(designCatalog ?? catalog, activeContext);
  const navCollapsed = consoleMode && !drawerOpen;
  const primaryRailItems = menuDefinition.railItems.filter((item) => item.section === "primary");
  const secondaryRailItems = menuDefinition.railItems.filter((item) => item.section === "secondary");
  const createActions = menuDefinition.catalogActions.filter((item) => item.section === "create");
  const utilityActions = menuDefinition.catalogActions.filter((item) => item.section === "utility");
  const overflowActions = [...createActions, ...utilityActions];
  const [createOverflowOpen, setCreateOverflowOpen] = useState(false);

  function onPressRailItem(item: CplayoutLeftNavRailItemDefinition): void {
    if (item.action === "navigate_map") onNavigate("map");
    if (item.action === "navigate_dashboard") onNavigate("dashboard");
    if (item.action === "navigate_files") onNavigate("files");
    if (item.action === "navigate_survey") onNavigate("survey");
    if (item.action === "navigate_help") onNavigate("help");
    if (item.action === "navigate_settings") onNavigate("settings");
  }

  function railItemActive(item: CplayoutLeftNavRailItemDefinition): boolean {
    if (item.action === "navigate_map") return activeView === "map";
    if (item.action === "navigate_dashboard") return activeView === "dashboard";
    if (item.action === "navigate_files") return activeView === "files";
    if (item.action === "navigate_survey") return activeView === "survey";
    if (item.action === "navigate_help") return activeView === "help";
    if (item.action === "navigate_settings") return activeView === "settings";
    return false;
  }

  function onPressCatalogAction(item: CplayoutLeftNavCatalogActionDefinition): void | Promise<void> {
    setCreateOverflowOpen(false);
    if (item.action === "create_client") return onCreateClient();
    if (item.action === "create_project") return onCreateProject();
    if (item.action === "create_field_map") return onCreateFieldMap();
    if (item.action === "create_design") return onCreateDesign();
    if (item.action === "start_blank_design") return onStartBlankDesign();
    if (item.action === "open_sample") return onOpenSample();
  }

  function catalogActionDisabled(item: CplayoutLeftNavCatalogActionDefinition): boolean {
    return isLeftNavItemDisabled(item, { activeContext, activeView, homeMapView: false });
  }

  function defaultCreateAction(): CplayoutLeftNavCatalogActionDefinition {
    const nextAction = nextCatalogCreateAction(activeContext);
    return createActions.find(item => item.action === nextAction && !catalogActionDisabled(item))
      ?? createActions.find(item => !catalogActionDisabled(item)) ?? createActions[0]!;
  }

  function renderRailItem(item: CplayoutLeftNavRailItemDefinition, collapsed: boolean): React.JSX.Element {
    return (
      <RailButton
        active={railItemActive(item)}
        collapsed={collapsed}
        icon={leftNavIcon(item.icon)}
        key={`${item.section}-${item.id}`}
        label={item.label}
        onPress={() => onPressRailItem(item)}
        testID={item.testID}
      />
    );
  }

  function renderOverflowCatalogAction(item: CplayoutLeftNavCatalogActionDefinition): React.JSX.Element {
    return (
      <Pressable
        accessibilityLabel={item.label}
        accessibilityRole="button"
        accessibilityState={{ disabled: catalogActionDisabled(item) }}
        disabled={catalogActionDisabled(item)}
        key={`${item.section}-${item.id}`}
        onPress={() => onPressCatalogAction(item)}
        style={[styles.projectTreeOverflowItem, catalogActionDisabled(item) && styles.projectTreeOverflowItemDisabled]}
        testID={item.testID}
      >
        {leftNavIcon(item.icon, catalogActionDisabled(item) ? "#8ba095" : "#d5e2db")}
        <Text style={[styles.projectTreeOverflowText, catalogActionDisabled(item) && styles.projectTreeOverflowTextDisabled]}>{item.label}</Text>
      </Pressable>
    );
  }

  return (
    <ScrollView style={[styles.leftRail, compact && !consoleMode && styles.leftRailCompact, consoleMode && styles.leftRailConsole,
      consoleMode && !drawerOpen && styles.leftRailConsoleCollapsed, foreground && styles.leftRailForeground]}
      contentContainerStyle={[styles.leftRailContent, consoleMode && !drawerOpen && { alignItems: "center" }]} testID="workspace-rail">
      {consoleMode ? (
        <Pressable
          accessibilityLabel={drawerOpen ? "Collapse project drawer" : "Open project drawer"}
          accessibilityRole="button"
          onPress={onToggleDrawer}
          style={styles.leftDrawerHandle}
          testID="left-drawer-handle"
        >
          {drawerOpen ? <ChevronLeft size={21} color="#d5e2db" /> : <ChevronRight size={21} color="#d5e2db" />}
        </Pressable>
      ) : null}
      {drawerOpen ? (
        <View style={styles.projectTreePanel} testID="project-tree-rail">
          <View style={[styles.projectTreeNav, styles.projectTreeNavPrimary, compact && !consoleMode && styles.projectTreeNavCompact]} testID="project-tree-primary-nav">
            {primaryRailItems.map((item) => renderRailItem(item, navCollapsed))}
          </View>
          <View style={styles.projectTreeHeader}>
            <FolderOpen size={18} color="#d5e2db" />
            <Text style={styles.projectTreeTitle}>{tree.activeProjectLabel}</Text>
          </View>
          <View style={styles.projectTreeActions} testID="project-tree-actions">
            <IconCommandButton
              disabled={catalogActionDisabled(defaultCreateAction())}
              hint={`Create ${defaultCreateAction().label.toLowerCase()} from the current catalog selection.`}
              icon={<Plus />}
              id="project-tree-new"
              label={`New ${defaultCreateAction().label}`}
              onPress={() => onPressCatalogAction(defaultCreateAction())}
              showLabel
              testID="project-tree-action-new"
            />
            <IconCommandButton
              hint="Show more create and sample actions."
              icon={<MoreHorizontal />}
              id="project-tree-more"
              label="More"
              onPress={() => setCreateOverflowOpen((open) => !open)}
              selected={createOverflowOpen}
              testID="project-tree-action-more"
            />
          </View>
          {createOverflowOpen ? (
            <View style={styles.projectTreeOverflow} testID="project-tree-action-overflow">
              <ScrollView style={styles.projectTreeOverflowScroll}>
                {overflowActions.map(renderOverflowCatalogAction)}
              </ScrollView>
            </View>
          ) : null}
          <ScrollView style={[styles.projectTreeScroll, compact && !foreground && styles.projectTreeScrollCompact]} contentContainerStyle={styles.projectTreeContent} testID="project-tree-scroll">
            {catalog.clients.length === 0 ? (
              <Text style={styles.projectTreeEmpty}>No customers yet.</Text>
            ) : null}
            {tree.clients.map((client) => {
              return (
                <View key={client.id} style={styles.projectTreeGroup}>
                  <ProjectTreeNode
                    active={activeContext.clientId === client.id}
                    depth={0}
                    icon={<FolderOpen size={15} color="#d5e2db" />}
                    label={client.label}
                    meta={client.meta}
                    onOpen={() => onOpenClient(client.id)}
                    onSelect={() => onSelectClient(client.id)}
                    testID={`catalog-client-${client.id}`}
                  />
                  {client.projects.map((projectRecord) => {
                    return (
                      <View key={projectRecord.id}>
                        <ProjectTreeNode
                          active={activeContext.projectId === projectRecord.id}
                          depth={1}
                          icon={<Database size={14} color="#d5e2db" />}
                          label={projectRecord.label}
                          meta={projectRecord.meta}
                          onOpen={() => onOpenProject(projectRecord.id)}
                          onSelect={() => onSelectProject(projectRecord.id)}
                          testID={`catalog-project-${projectRecord.id}`}
                        />
                        {projectRecord.showChildren ? (
                          <View>
                            {projectRecord.fieldMaps.length > 0 ? <Text style={styles.projectTreeSectionLabel}>Map Files</Text> : null}
                            {projectRecord.fieldMaps.map((fieldMap) => (
                              <View key={fieldMap.id}>
                                <ProjectTreeNode
                                  active={activeContext.fieldMapId === fieldMap.id}
                                  depth={2}
                                  icon={<MapIcon size={14} color="#d5e2db" />}
                                  label={fieldMap.label}
                                  meta={fieldMap.meta}
                                  onOpen={() => onOpenFieldMap(fieldMap.id)}
                                  onSelect={() => onSelectFieldMap(fieldMap.id)}
                                  testID={`catalog-field-map-${fieldMap.id}`}
                                />
                                {fieldMap.designs.length > 0
                                  ? <Text style={styles.projectTreeSectionLabel}>Design Files</Text> : null}
                                {fieldMap.designs.map((design) => (
                                <ProjectTreeNode
                                  active={activeContext.designId === design.id}
                                  depth={3}
                                  icon={<Layers size={14} color="#d5e2db" />}
                                  key={design.id}
                                  label={design.label}
                                  meta={design.meta}
                                  onOpen={() => onOpenDesign(design.id)}
                                  onSelect={() => onSelectDesign(design.id)}
                                  testID={`catalog-design-${design.id}`}
                                />
                                ))}
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
      <View style={[styles.projectTreeNav, compact && !consoleMode && styles.projectTreeNavCompact, consoleMode && !drawerOpen && styles.projectTreeNavConsole, consoleMode && !drawerOpen && styles.projectTreeNavCollapsed]}>
        {!drawerOpen ? (
          <>
            {primaryRailItems.map((item) => renderRailItem(item, true))}
          </>
        ) : null}
        {secondaryRailItems.map((item) => renderRailItem(item, navCollapsed))}
      </View>
    </ScrollView>
  );
}

function ProjectTreeNode({
  active,
  depth,
  icon,
  label,
  meta,
  onOpen,
  onSelect,
  testID,
}: {
  active: boolean;
  depth: 0 | 1 | 2 | 3;
  icon: React.ReactNode;
  label: string;
  meta: string;
  onOpen: () => void | Promise<void>;
  onSelect: () => void;
  testID: string;
}): React.JSX.Element {
  const [openHovered, setOpenHovered] = useState(false);
  return (
    <View style={styles.projectTreeNodeRow}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        aria-selected={active}
        onPress={(event) => {
          const detail = Platform.OS === "web" ? (event.nativeEvent as unknown as { detail?: number }).detail : undefined;
          if (detail === 2) void onOpen();
          else onSelect();
        }}
        style={[styles.projectTreeNode, styles.projectTreeNodeSelect, active && styles.projectTreeNodeActive, { paddingLeft: 8 + depth * 12 }]}
        testID={testID}
      >
        {icon}
        <View style={styles.projectTreeNodeText}>
          <Text style={[styles.projectTreeNodeLabel, active && styles.projectTreeNodeLabelActive]} numberOfLines={1}>{label}</Text>
          <Text style={styles.projectTreeNodeMeta} numberOfLines={1}>{meta}</Text>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={depth === 0 ? `Open customer details for ${label}` : `Open ${["customer", "project", "field", "design"][depth]} ${label} in project tree`} testID={`${testID}-open`}
        onPress={() => void onOpen()} onHoverIn={() => setOpenHovered(true)} onHoverOut={() => setOpenHovered(false)}
        style={styles.projectTreeNodeOpen}>
        <FolderOpen size={17} color="#e5f0e8" />
        {openHovered && <View pointerEvents="none" style={styles.projectTreeOpenTooltip}><Text style={styles.projectTreeNodeLabel}>Open</Text></View>}
      </Pressable>
    </View>
  );
}

function RailButton({ active, collapsed = false, icon, label, onPress, testID }: { active: boolean; collapsed?: boolean; icon: React.ReactNode; label: string; onPress: () => void; testID?: string }): React.JSX.Element {
  const tintedIcon = React.isValidElement<{ color?: string }>(icon)
    ? React.cloneElement(icon, { color: active ? "#ffffff" : "#d5e2db" })
    : icon;
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ selected: active }} aria-selected={active} onPress={onPress} style={[styles.railButton, collapsed && styles.railButtonCollapsed, active && styles.railButtonActive]} testID={testID}>
      {tintedIcon}
      {!collapsed ? <Text style={[styles.railLabel, active && styles.railLabelActive]}>{label}</Text> : null}
    </Pressable>
  );
}

function ActionButton({ label, onPress, selected = false, testID }: { label: string; onPress: () => void; selected?: boolean; testID?: string }): React.JSX.Element {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.actionButton, selected && styles.actionButtonSelected]} testID={testID}>
      <Text style={[styles.actionText, selected && styles.actionTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function SmallActionButton({
  accessibilityLabel,
  disabled = false,
  label,
  onPress,
  testID,
}: {
  accessibilityLabel?: string;
  disabled?: boolean;
  label: string;
  onPress: () => void | Promise<void>;
  testID?: string;
}): React.JSX.Element {
  return (
    <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.smallActionButton, disabled && styles.smallActionButtonDisabled]} testID={testID}>
      {label.startsWith("Save") ? <Save size={14} color={disabled ? "#68766d" : "#254234"} /> : null}
      <Text style={[styles.smallActionText, disabled && styles.smallActionTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

function PendingDraftPurposePanel({ draft, retentionKey, projectCrs, error, onCancel, onSave, unitSystem }: {
  retentionKey: string;
  draft: PendingMapFeatureDraft | null;
  projectCrs: string;
  error: string | null;
  onCancel: () => void;
  onSave: (option: MapDraftPurposeOption, details?: { name: string; notes: string }) => void;
  unitSystem: PivotProject["unitSystem"];
}): React.JSX.Element {
  const [selection, setSelection] = useRetainedInput(`${retentionKey}:selection`, "");
  const [name, setName] = useRetainedInput(`${retentionKey}:name`, "");
  const [notes, setNotes] = useRetainedInput(`${retentionKey}:notes`, "");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [choicesOpen, setChoicesOpen] = useState(false);
  if (!draft) return <Text style={styles.mapFeatureMeta}>Finish a drawing to choose its purpose.</Text>;
  const options = draftPurposeOptions(draft.geometryType);
  const optionKey = (option: MapDraftPurposeOption) => `${option.purposeType}:${option.kind}`;
  const selected = options.find(option => optionKey(option) === selection);
  return <View style={styles.pendingDraftPurposePanel} testID="pending-draft-purpose-panel">
    <Text style={styles.mapFeatureTitle}>What did you draw?</Text>
    {error ? <Text accessibilityRole="alert" style={styles.formError} testID="pending-draft-error">{error}</Text> : null}
    <Text style={styles.mapFeatureMeta}>{draftGeometrySummary(draft, unitSystem, projectCrs)}</Text>
    {Platform.OS === "web" ? React.createElement("select", {
      "aria-label": "Drawing purpose", "data-testid": "pending-draft-purpose-select", value: selection,
      onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setSelection(event.target.value),
      style: { width: "100%", minWidth: 0, minHeight: 44, padding: 8, fontSize: 15, background: "white", color: "#254234" },
    }, React.createElement("option", { value: "" }, "Choose a purpose…"), ...options.map(option =>
      React.createElement("option", { key: optionKey(option), value: optionKey(option) }, option.label)))
      : <View><SmallActionButton label={selected?.label ?? "Choose a purpose…"} onPress={() => setChoicesOpen(!choicesOpen)} />
        {choicesOpen ? <ScrollView style={{ maxHeight: 200 }}>{options.map(option => <SmallActionButton key={optionKey(option)}
          label={option.label} onPress={() => { setSelection(optionKey(option)); setChoicesOpen(false); }} />)}</ScrollView> : null}</View>}
    {selected ? <Text style={styles.mapFeatureMeta}>{selected.meta}</Text> : null}
    {selected?.purposeType === "map_feature" ? <>
      <SmallActionButton label={detailsOpen ? "Hide optional details" : "Name and notes (optional)"} onPress={() => setDetailsOpen(!detailsOpen)} />
      <View style={{ display: detailsOpen ? "flex" : "none", gap: 8 }}>
        <Text style={styles.mapFeatureMeta}>Drawing name</Text>
        <TextInput accessibilityLabel="Drawing name" value={name} onChangeText={setName} style={styles.textInput} />
        <Text style={styles.mapFeatureMeta}>Drawing notes</Text>
        <TextInput accessibilityLabel="Drawing notes" value={notes} onChangeText={setNotes} multiline style={styles.textInput} />
      </View>
    </> : null}
    <View style={styles.inlineActions}>
      <SmallActionButton label="Keep drawing" disabled={!selected} testID="pending-draft-keep" onPress={() => selected && onSave(selected, { name, notes })} />
      <SmallActionButton label="Back to drawing" onPress={onCancel} testID="pending-draft-cancel" />
    </View>
  </View>;
}

function draftPurposeOptions(geometry: UtilityFeatureGeometry): MapDraftPurposeOption[] {
  const mapFeatureOptions = featureOptionsForGeometry(geometry).map((option): MapDraftPurposeOption => ({
    ...option,
    purposeType: "map_feature",
    meta: mapFeaturePurposeMeta(option.kind),
  }));
  if (geometry !== "Polygon") return mapFeatureOptions;
  return [
    { purposeType: "field_boundary", kind: "field_boundary", label: "Field Boundary", geometry: "Polygon", meta: "Replace the active projected-XY field boundary through reducer validation." },
    { purposeType: "map_feature", kind: "measurement_area", label: "Measurement Area", geometry: "Polygon", meta: mapFeaturePurposeMeta("measurement_area") },
    { purposeType: "map_feature", kind: "planning_boundary", label: "Planning Boundary", geometry: "Polygon", meta: mapFeaturePurposeMeta("planning_boundary") },
    { purposeType: "map_feature", kind: "machine_zone", label: "Machine Zone", geometry: "Polygon", meta: mapFeaturePurposeMeta("machine_zone") },
    { purposeType: "obstacle", kind: "exclusion", label: "Keep-Out / No-Spray", geometry: "Polygon", meta: "Excluded area" },
    { purposeType: "obstacle", kind: "building", label: "Building", geometry: "Polygon", meta: "Commit a building obstacle footprint for layout review." },
    { purposeType: "map_feature", kind: "corner_swing_limit", label: "Corner-Arm Footprint", geometry: "Polygon", meta: mapFeaturePurposeMeta("corner_swing_limit") },
  ];
}

function mapFeaturePurposeMeta(kind: ProjectMapFeatureKind): string {
  switch (kind) {
    case "reference_point":
    case "reference_line":
    case "reference_area": return "Classified reference geometry; its stated purpose and effects are retained with the drawing.";
    case "measurement_area": return "Area measurement; does not constrain irrigation coverage.";
    case "pump_location":
      return "Site utility evidence point; not hydraulic certification.";
    case "well_location":
      return "Water-source evidence point for operator review.";
    case "power_pole":
      return "Power-pole evidence point; not electrical certification.";
    case "tree":
      return "Tree/object evidence point for review.";
    case "end_gun_mark":
      return "Control or note-style evidence mark.";
    case "underground_pipeline":
      return "Pipeline route evidence; projected XY path only.";
    case "underground_wire":
      return "Wire route evidence; projected XY path only.";
    case "power_line":
      return "Power path evidence for layout review.";
    case "road":
      return "Road or access route evidence path.";
    case "access_lane":
      return "Access lane evidence path.";
    case "ditch":
      return "Ditch evidence path.";
    case "canal":
      return "Canal evidence path.";
    case "fence":
      return "Fence evidence path.";
    case "linear_move_path":
      return "Advisory linear/lateral travel-path evidence; does not create a machine.";
    case "measurement_line":
      return "Reference measurement line.";
    case "planning_boundary":
      return "Planning boundary evidence; does not replace the field boundary.";
    case "machine_zone":
      return "Advisory machine-zone evidence; does not create or certify a pivot.";
    case "corner_swing_limit":
      return "Advisory corner-arm footprint evidence; not proprietary kinematics.";
    case "end_gun_arc":
      return "Advisory end-gun radius review; actual throw and shutoff stay in machine settings.";
  }
}

function draftGeometrySummary(draft: PendingMapFeatureDraft, unitSystem: PivotProject["unitSystem"], projectCrs: string): string {
  return `${draft.geometryType.replace("String", "")} · ${draft.vertices.length} projected XY vertices ${draftMeasurementText(draft.geometryType, draft.vertices, projectCrs, unitSystem)}`.trim();
}

function MapFeatureEditor({
  feature,
  unitSystem,
  onDelete,
  onRename,
  onUpdate,
}: {
  feature: ProjectMapFeature | null;
  unitSystem: PivotProject["unitSystem"];
  onDelete: (featureId: string) => void;
  onRename: (feature: ProjectMapFeature, name: string) => void;
  onUpdate: (feature: ProjectMapFeature) => void;
}): React.JSX.Element {
  const [name, setName] = useRetainedInput(`feature:${feature?.id ?? "none"}:name`, feature?.name ?? "");


  if (!feature) {
    return (
      <View style={styles.mapFeatureEditor}>
        <Text style={styles.mapFeatureTitle}>Map Feature</Text>
        <Text style={styles.mapFeatureMeta}>Select a utility feature on the map to rename or delete it.</Text>
      </View>
    );
  }

  const geometryLabel = mapFeatureGeometryLabel(feature, unitSystem);

  return (
    <View style={styles.mapFeatureEditor}>
      <View>
        <Text style={styles.mapFeatureTitle}>Map Feature</Text>
        <Text style={styles.mapFeatureMeta}>{feature.kind.replaceAll("_", " ")} · {geometryLabel}</Text>
      </View>
      <TextInput
        accessibilityLabel="Selected map feature name"
        onChangeText={setName}
        onSubmitEditing={() => onRename(feature, name)}
        style={styles.textInput}
        value={name}
      />
      <View style={styles.inlineActions}>
        <SmallActionButton disabled={name.trim().length === 0 || name.trim() === feature.name} label="Rename" onPress={() => onRename(feature, name)} />
        <SmallActionButton label="Delete" onPress={() => onDelete(feature.id)} />
      </View>
      {feature.geometry.type === "Point" ? (
        <PivotCoordinateForm
          onApply={(point) => {
            onUpdate({ ...feature, geometry: { type: "Point", point } });
            return true;
          }}
          point={feature.geometry.point} retentionKey={`feature:${feature.id}:point`}
        />
      ) : feature.geometry.type === "Circle" ? (
        <CircleFeatureEditor feature={{ ...feature, geometry: feature.geometry }} onUpdate={onUpdate} unitSystem={unitSystem} />
      ) : feature.geometry.type === "LineString" ? (
        <ProjectedPolygonEditor
          label={`${feature.name} line XY`}
          onApply={(vertices) => {
            if (vertices.length < 2) throw new Error("Line feature needs at least two projected XY rows.");
            onUpdate({ ...feature, geometry: { type: "LineString", vertices } });
            return true;
          }}
          vertices={feature.geometry.vertices}
        />
      ) : (
        <ProjectedPolygonEditor
          label={`${feature.name} polygon XY`}
          onApply={(vertices) => {
            if (vertices.length < 3) throw new Error("Polygon feature needs at least three projected XY rows.");
            onUpdate({ ...feature, geometry: { type: "Polygon", vertices } });
            return true;
          }}
          vertices={feature.geometry.vertices}
        />
      )}
    </View>
  );
}

function CircleFeatureEditor({ feature, onUpdate, unitSystem }: { unitSystem: PivotProject["unitSystem"]; feature: ProjectMapFeature & { geometry: { type: "Circle"; center: XY; radiusMeters: number } }; onUpdate: (feature: ProjectMapFeature) => void }): React.JSX.Element {
  const [radius, setRadius] = useRetainedInput(`feature:${feature.id}:radius`, formatDistanceInputValue(feature.geometry.radiusMeters, unitSystem));
  const [error, setError] = useState<string | null>(null);


  function applyRadius(): void {
    try {
      const radiusMeters = preserveDistanceInput(radius, feature.geometry.radiusMeters, unitSystem, "Circle radius", true);
      onUpdate({ ...feature, geometry: { ...feature.geometry, radiusMeters } });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <View style={styles.machineForm}>
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <PivotCoordinateForm
        onApply={(center) => {
          onUpdate({ ...feature, geometry: { ...feature.geometry, center } });
          return true;
        }}
        point={feature.geometry.center} retentionKey={`feature:${feature.id}:center`}
      />
      <View style={styles.formGrid}>
        <FormField label={`Radius (${unitSystem === "metric" ? "m" : "ft"})`} value={radius} onChangeText={setRadius} />
      </View>
      <View style={styles.inlineActions}>
        <SmallActionButton label="Apply Radius" onPress={applyRadius} />
      </View>
    </View>
  );
}

function mapFeatureGeometryLabel(feature: ProjectMapFeature, unitSystem: PivotProject["unitSystem"]): string {
  if (feature.geometry.type === "Point") return "Point";
  if (feature.geometry.type === "LineString") return `${feature.geometry.vertices.length} point line`;
  if (feature.geometry.type === "Polygon") return `${feature.geometry.vertices.length} point polygon`;
  return `Circle · ${formatDistance(feature.geometry.radiusMeters, unitSystem)} radius`;
}

function MachineSettingsForm({ machine, onChange, unitSystem }: { machine: PivotMachine; onChange: (machine: PivotMachine) => void; unitSystem: PivotProject["unitSystem"] }): React.JSX.Element {
  const [spanRows, setSpanRows] = useRetainedInput("machine:spanRows", machine.spanLengthsMeters.map((span) => formatDistanceInputValue(span, unitSystem)));
  const [overhang, setOverhang] = useRetainedInput("machine:overhang", formatDistanceInputValue(machine.overhangMeters, unitSystem));
  const [towerClearance, setTowerClearance] = useRetainedInput("machine:towerClearance", formatDistanceInputValue(machine.towerClearanceBufferMeters, unitSystem));
  const [machineClearance, setMachineClearance] = useRetainedInput("machine:machineClearance", formatDistanceInputValue(machine.machineClearanceBufferMeters, unitSystem));
  const [startAngle, setStartAngle] = useRetainedInput("machine:startAngle", machine.sweep.mode === "partial_circle" ? String(machine.sweep.startAngleDegrees) : "210");
  const [stopAngle, setStopAngle] = useRetainedInput("machine:stopAngle", machine.sweep.mode === "partial_circle" ? String(machine.sweep.stopAngleDegrees) : "35");
  const [direction, setDirection] = useRetainedInput<"clockwise" | "counterclockwise">("machine:direction", machine.sweep.mode === "partial_circle" ? machine.sweep.direction : "counterclockwise");
  const [mode, setMode] = useRetainedInput<PivotSweep["mode"]>("machine:mode", machine.sweep.mode);
  const [lrduTireId, setLrduTireId] = useRetainedInput("machine:lrduTireId", machine.driveUnits?.lrdu?.tire?.id ?? "valley-public-custom-required");
  const [sduTireId, setSduTireId] = useRetainedInput("machine:sduTireId", machine.driveUnits?.sdu?.tire?.id ?? "valley-public-custom-required");
  const [lrduRpm, setLrduRpm] = useRetainedInput("machine:lrduRpm", machine.driveUnits?.lrdu?.customMotorRpm !== undefined ? String(machine.driveUnits.lrdu.customMotorRpm) : "");
  const [sduRpm, setSduRpm] = useRetainedInput("machine:sduRpm", machine.driveUnits?.sdu?.customMotorRpm !== undefined ? String(machine.driveUnits.sdu.customMotorRpm) : "");
  const [operatorSpeed, setOperatorSpeed] = useRetainedInput("machine:operatorSpeed", machine.driveUnits?.lrdu?.operatorMeasuredSpeedMetersPerMinute !== undefined ? formatDistanceInputValue(machine.driveUnits.lrdu.operatorMeasuredSpeedMetersPerMinute, unitSystem) : "");
  const [sduOperatorSpeed, setSduOperatorSpeed] = useRetainedInput("machine:sduOperatorSpeed", machine.driveUnits?.sdu?.operatorMeasuredSpeedMetersPerMinute !== undefined ? formatDistanceInputValue(machine.driveUnits.sdu.operatorMeasuredSpeedMetersPerMinute, unitSystem) : "");
  const [error, setError] = useState<string | null>(null);


  function apply(): void {
    try {
      const spanValues = spanRows.map((value, index) => preserveDistanceInput(value, machine.spanLengthsMeters[index], unitSystem, `Span ${index + 1}`, true));
      const nextMachine: PivotMachine = {
        ...machine,
        spanLengthsMeters: spanValues,
        overhangMeters: preserveDistanceInput(overhang, machine.overhangMeters, unitSystem, "Overhang"),
        towerClearanceBufferMeters: preserveDistanceInput(towerClearance, machine.towerClearanceBufferMeters, unitSystem, "Tower clearance"),
        machineClearanceBufferMeters: preserveDistanceInput(machineClearance, machine.machineClearanceBufferMeters, unitSystem, "Machine clearance"),
        sweep: mode === "full_circle"
          ? { mode: "full_circle" }
          : {
            mode: "partial_circle",
            startAngleDegrees: requiredFiniteNumber(startAngle, "Start angle"),
            stopAngleDegrees: requiredFiniteNumber(stopAngle, "Stop angle"),
            direction,
          },
        driveUnits: {
          lrdu: driveUnitConfig("lrdu", lrduTireId, lrduRpm, operatorSpeed, unitSystem, machine.driveUnits?.lrdu?.operatorMeasuredSpeedMetersPerMinute),
          sdu: driveUnitConfig("sdu", sduTireId, sduRpm, sduOperatorSpeed, unitSystem, machine.driveUnits?.sdu?.operatorMeasuredSpeedMetersPerMinute),
        },
      };
      setError(null);
      onChange(nextMachine);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function applyCatalogPreset(presetId: string): void {
    try {
      setError(null);
      onChange(applyMachineCatalogPreset(machine, presetId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const unitLabel = unitSystem === "metric" ? "m" : "ft/in";
  const wetRadiusMeters = machineRadiusMeters(machine) + Math.max(0, machine.endGunThrowMeters);
  const selectedLrduTire = ADVISORY_DRIVE_UNIT_TIRE_OPTIONS.find((option) => option.id === lrduTireId);
  const selectedSduTire = ADVISORY_DRIVE_UNIT_TIRE_OPTIONS.find((option) => option.id === sduTireId);

  return (
    <View style={styles.machineForm}>
      <Text style={styles.mapFeatureMeta}>
        Base machine radius {formatDistance(machineRadiusMeters(machine), unitSystem)} · current end-gun adjusted wet radius {formatDistance(wetRadiusMeters, unitSystem)}{unitSystem === "us_survey_feet" ? ` (${formatFeetInches(wetRadiusMeters)})` : ""}. Edit end-gun throw and shutoff arcs in the End Gun sheet.
      </Text>
      <View style={styles.machineCatalogPanel}>
        <Text style={styles.formLabel}>Source-backed presets</Text>
        <View style={styles.controlRow}>
          {MACHINE_CATALOG_PRESETS.map((preset) => (
            <ActionButton
              key={preset.id}
              label={`${preset.manufacturer} ${preset.model}`}
              onPress={() => applyCatalogPreset(preset.id)}
              selected={machine.catalogSelection?.catalogId === preset.id}
            />
          ))}
        </View>
        <Text style={styles.mapFeatureMeta}>
          {machine.catalogSelection
            ? `${machine.catalogSelection.manufacturer} ${machine.catalogSelection.model} selected · advisory snapshot only`
            : "Use a preset or custom/as-built distances; catalog selections are advisory until vendor/operator verified."}
        </Text>
      </View>
      <View style={styles.controlRow}>
        <ActionButton label="Full circle" selected={mode === "full_circle"} onPress={() => setMode("full_circle")} />
        <ActionButton label="Part circle" selected={mode === "partial_circle"} onPress={() => setMode("partial_circle")} />
        <ActionButton label="Apply Machine Settings" selected onPress={apply} />
      </View>
      {error ? <Text style={styles.formError}>{error}</Text> : null}
      <View style={styles.formGrid}>
        {spanRows.map((value, index) => (
          <FormField key={`machine-span-${index + 1}`} label={`Span ${index + 1} (${unitLabel})`} value={value} onChangeText={(next) => setSpanRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? next : row))} />
        ))}
        <FormField label={`Overhang (${unitLabel})`} value={overhang} onChangeText={setOverhang} />
        <FormField label={`Tower clearance (${unitLabel})`} value={towerClearance} onChangeText={setTowerClearance} />
        <FormField label={`Machine clearance (${unitLabel})`} value={machineClearance} onChangeText={setMachineClearance} />
        {mode === "partial_circle" ? (
          <>
            <FormField label="Start angle" value={startAngle} onChangeText={setStartAngle} />
            <FormField label="Stop angle" value={stopAngle} onChangeText={setStopAngle} />
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Direction</Text>
              <View style={styles.controlRow}>
                <ActionButton label="CW" selected={direction === "clockwise"} onPress={() => setDirection("clockwise")} />
                <ActionButton label="CCW" selected={direction === "counterclockwise"} onPress={() => setDirection("counterclockwise")} />
              </View>
            </View>
          </>
        ) : null}
      </View>
      <View style={styles.inlineActions} testID="machine-structured-span-actions">
        <SmallActionButton label="Add Span" onPress={() => setSpanRows((rows) => [...rows, rows.at(-1) ?? formatDistanceInputValue(50, unitSystem)])} />
        <SmallActionButton disabled={spanRows.length <= 1} label="Remove Span" onPress={() => setSpanRows((rows) => rows.slice(0, -1))} />
      </View>
      <View style={styles.machineCatalogPanel}>
        <Text style={styles.formLabel}>Advisory drive units</Text>
        <View style={styles.formGrid}>
          <View style={styles.formField}>
            <Text style={styles.formLabel}>LRDU tire</Text>
            <View style={styles.controlRow}>
              {ADVISORY_DRIVE_UNIT_TIRE_OPTIONS.map((option) => (
                <ActionButton key={`lrdu-${option.id}`} label={option.label} selected={lrduTireId === option.id} onPress={() => setLrduTireId(option.id)} />
              ))}
            </View>
          </View>
          <View style={styles.formField}>
            <Text style={styles.formLabel}>SDU tire</Text>
            <View style={styles.controlRow}>
              {ADVISORY_DRIVE_UNIT_TIRE_OPTIONS.map((option) => (
                <ActionButton key={`sdu-${option.id}`} label={option.label} selected={sduTireId === option.id} onPress={() => setSduTireId(option.id)} />
              ))}
            </View>
          </View>
          <FormField label="LRDU motor RPM custom" value={lrduRpm} onChangeText={setLrduRpm} />
          <FormField label="SDU motor RPM custom" value={sduRpm} onChangeText={setSduRpm} />
          <FormField label={`LRDU measured speed (${unitSystem === "metric" ? "m" : "ft"}/min)`} value={operatorSpeed} onChangeText={setOperatorSpeed} />
          <FormField label={`SDU measured speed (${unitSystem === "metric" ? "m" : "ft"}/min)`} value={sduOperatorSpeed} onChangeText={setSduOperatorSpeed} />
        </View>
        <Text style={styles.mapFeatureMeta}>
          Tire options are public source labels. RPM fields require operator or curated manual evidence; blank RPM stays unverified/source required. {selectedLrduTire?.sourceRefs[0]?.sourceId ?? "LRDU source required"} · {selectedSduTire?.sourceRefs[0]?.sourceId ?? "SDU source required"}.
        </Text>
      </View>
    </View>
  );
}

function preserveDistanceInput(value: string, original: number | undefined, units: PivotProject["unitSystem"], label: string, positive = false): number {
  if (original !== undefined && value.trim() === formatDistanceInputValue(original, units)) return original;
  return positive ? requiredPositiveDistanceInput(value, units, label) : requiredNonNegativeDistanceInput(value, units, label);
}

function driveUnitConfig(
  role: AdvisoryDriveUnitConfig["role"],
  tireId: string,
  rpmInput: string,
  speedInput = "",
  unitSystem: PivotProject["unitSystem"] = "metric",
  originalSpeed?: number,
): AdvisoryDriveUnitConfig {
  const tire = ADVISORY_DRIVE_UNIT_TIRE_OPTIONS.find((option) => option.id === tireId);
  const customMotorRpm = rpmInput.trim() ? requiredFiniteNumber(rpmInput, `${role.toUpperCase()} motor RPM`) : undefined;
  if (customMotorRpm !== undefined && customMotorRpm <= 0) throw new Error(`${role.toUpperCase()} motor RPM must be greater than zero.`);
  const operatorMeasuredSpeedMetersPerMinute = speedInput.trim() ? preserveDistanceInput(speedInput, originalSpeed, unitSystem, "Measured speed", true) : undefined;
  return {
    role,
    advisoryOnly: true,
    ...(tire && !tire.customValueFallback ? { tire } : {}),
    ...(tire?.customValueFallback ? { customTireLabel: "custom/source required" } : {}),
    ...(customMotorRpm === undefined ? {} : { customMotorRpm }),
    ...(operatorMeasuredSpeedMetersPerMinute === undefined ? {} : { operatorMeasuredSpeedMetersPerMinute }),
    sourceRefs: tire?.sourceRefs ?? [{
      sourceId: `SRC-${role.toUpperCase()}-CUSTOM-SOURCE-REQUIRED`,
      limit: "Custom advisory drive-unit metadata requires operator/vendor or curated manual source evidence before use as a preset.",
    }],
    caveats: [
      "Advisory drive-unit metadata does not alter projected XY geometry, path sampling, storage schema semantics, or controller settings.",
      ...(customMotorRpm === undefined ? ["Motor RPM is unverified/source required until a curated page/line/source record or operator measurement is supplied."] : ["Motor RPM is custom input, not a manual-derived preset."]),
    ],
  };
}

function FormField({
  keyboardType = "numbers-and-punctuation",
  label,
  onChangeText,
  testID,
  value,
}: {
  keyboardType?: "default" | "numbers-and-punctuation";
  label: string;
  onChangeText: (value: string) => void;
  testID?: string;
  value: string;
}): React.JSX.Element {
  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        style={styles.textInput}
        testID={testID}
        value={value}
      />
    </View>
  );
}

function formatXyLines(vertices: XY[]): string {
  return vertices.map((vertex) => `${roundCoordinate(vertex.x)}, ${roundCoordinate(vertex.y)}`).join("\n");
}

function parseXyLines(text: string): XY[] {
  const vertices = parseXyLinesAllowEmpty(text);
  if (vertices.length === 0) throw new Error("Enter at least one projected XY row.");
  return vertices;
}

function parseXyLinesAllowEmpty(text: string): XY[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const parts = line.split(/[,\s]+/).filter((part) => part.length > 0);
      if (parts.length < 2) throw new Error(`XY row ${index + 1} needs x and y.`);
      return {
        x: requiredFiniteNumber(parts[0], `XY row ${index + 1} x`),
        y: requiredFiniteNumber(parts[1], `XY row ${index + 1} y`),
      };
    });
}

function roundCoordinate(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function requiredPositiveDistanceInput(value: string, unitSystem: PivotProject["unitSystem"], label: string): number {
  const parsed = parseDistanceInput(value, unitSystem, label);
  if (parsed <= 0) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function requiredNonNegativeDistanceInput(value: string, unitSystem: PivotProject["unitSystem"], label: string): number {
  const parsed = parseDistanceInput(value, unitSystem, label);
  if (parsed < 0) throw new Error(`${label} cannot be negative.`);
  return parsed;
}

function optionalPositiveDistanceInput(value: string, unitSystem: PivotProject["unitSystem"], label: string): number | undefined {
  if (value.trim().length === 0) return undefined;
  return requiredPositiveDistanceInput(value, unitSystem, label);
}

function optionalNonNegativeDistanceInput(value: string, unitSystem: PivotProject["unitSystem"], label: string): number | undefined {
  if (value.trim().length === 0) return undefined;
  return requiredNonNegativeDistanceInput(value, unitSystem, label);
}

function safeDistanceInput(value: string, unitSystem: PivotProject["unitSystem"]): number | null {
  try {
    return parseDistanceInput(value, unitSystem, "Distance");
  } catch {
    return null;
  }
}

function requiredPositiveNumber(value: string, label: string): number {
  const parsed = requiredFiniteNumber(value, label);
  if (parsed <= 0) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function requiredNonNegativeNumber(value: string, label: string): number {
  const parsed = requiredFiniteNumber(value, label);
  if (parsed < 0) throw new Error(`${label} cannot be negative.`);
  return parsed;
}

function requiredFiniteNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number.`);
  return parsed;
}

const styles = StyleSheet.create({
  workflowContext: { paddingHorizontal: 12, paddingVertical: 4, gap: 8, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", backgroundColor: "#edf3ed" },
  safeArea: {
    backgroundColor: "#edf1eb",
    flex: 1,
  },
  app: {
    backgroundColor: "#edf1eb",
    flex: 1,
  },
  topBar: {
    alignItems: "center",
    backgroundColor: "#f9fbf6",
    borderBottomColor: "#d6ded3",
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    position: "relative",
    zIndex: 40,
  },
  appTitle: {
    color: "#132017",
    fontSize: 24,
    fontWeight: "900",
  },
  appSubtitle: {
    color: "#526257",
    fontSize: 13,
    fontWeight: "700",
  },
  workspaceTopToolbar: {
    alignItems: "center",
    backgroundColor: "#f9fbf6",
    borderBottomColor: "#d6ded3",
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 12,
    height: 60,
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    position: "relative",
    zIndex: 40,
  },
  workspaceTopToolbarCompact: {
    gap: 8,
    paddingHorizontal: 10,
  },
  workspaceTopToolbarShortLandscape: {
    height: 49,
    paddingVertical: 0,
  },
  workspaceBreadcrumb: {
    flex: 1,
    minWidth: 0,
  },
  workspaceBreadcrumbCompact: {
    flexBasis: 118,
    flexGrow: 0,
  },
  workspaceContextTrigger: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    minHeight: 48,
    minWidth: 48,
  },
  workspaceBreadcrumbText: {
    color: "#526257",
    fontSize: 15,
    fontWeight: "900",
  },
  workspaceBreadcrumbRoot: {
    color: "#132017",
  },
  workspaceBreadcrumbCurrent: {
    color: "#526257",
  },
  workspaceCommandSlot: {
    alignItems: "center",
    flexShrink: 0,
  },
  workspaceCommandScroller: {
    flex: 1,
    minWidth: 0,
  },
  workspaceCommandScrollContent: {
    alignItems: "center",
    flexGrow: 0,
    paddingRight: 1,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    flexShrink: 1,
    gap: 8,
    maxWidth: "100%",
  },
  statusRowCompact: {
    width: "100%",
  },
  projectActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    flexShrink: 1,
    gap: 8,
    maxWidth: "100%",
  },
  workspaceShell: {
    flex: 1,
    flexDirection: "row",
    minHeight: 0,
  },
  workspaceShellCompact: {
    flexDirection: "column",
  },
  workspaceShellConsole: {
    flexDirection: "row",
    overflow: "hidden",
  },
  leftRail: {
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: "#13211b",
    borderRightColor: "#26392f",
    borderRightWidth: 1,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 12,
    position: "relative",
    width: 292,
    zIndex: 2,
  },
  leftRailConsole: {
    flexShrink: 0,
    gap: 8,
    minHeight: 0,
    paddingBottom: 8,
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 8,
    width: 292,
  },
  leftRailContent: {
    flexGrow: 1,
    gap: 8,
  },
  leftRailConsoleCollapsed: {
    paddingHorizontal: 4,
    width: 64,
  },
  leftRailForeground: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", width: "100%", maxWidth: "100%", minWidth: 0 },
  leftRailCompact: {
    borderRightWidth: 0,
    flexShrink: 0,
    maxHeight: "45%",
    paddingHorizontal: 8,
    width: "100%",
  },
  workspaceScroll: {
    flex: 1,
    minHeight: 0,
  },
  workspaceScrollConsole: {
    overflow: "hidden",
  },
  projectTreeHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 32,
  },
  projectTreePanel: {
    flex: 1,
    flexBasis: "auto",
    flexShrink: 0,
    gap: 6,
    minHeight: 440,
  },
  projectTreeTitle: {
    color: "#eef7f1",
    flex: 1,
    fontSize: 15,
    fontWeight: "900",
  },
  projectTreeActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingBottom: 6,
  },
  projectTreeOverflow: {
    backgroundColor: "#16251d",
    borderColor: "#31483a",
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 6,
  },
  projectTreeOverflowScroll: {
    maxHeight: 72,
  },
  projectTreeOverflowItem: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  projectTreeOverflowItemDisabled: {
    opacity: 0.55,
  },
  projectTreeOverflowText: {
    color: "#eef7f1",
    fontSize: 12,
    fontWeight: "900",
  },
  projectTreeOverflowTextDisabled: {
    color: "#8ba095",
  },
  projectTreeUtilityActions: {
    borderTopColor: "#26392f",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingTop: 8,
  },
  projectTreeScroll: {
    flex: 1,
    minHeight: 120,
  },
  projectTreeScrollCompact: {
    flexGrow: 0,
    flexBasis: "auto",
    maxHeight: 120,
    minHeight: 30,
  },
  projectTreeContent: {
    gap: 6,
    paddingBottom: 8,
  },
  projectTreeGroup: {
    gap: 3,
  },
  projectTreeEmpty: {
    color: "#d5e2db",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginBottom: 8,
  },
  projectTreeSectionLabel: {
    color: "#8fa79b",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0,
    paddingLeft: 32,
    paddingTop: 5,
    textTransform: "uppercase",
  },
  projectTreeNodeRow: { flexDirection: "row", alignItems: "center" },
  projectTreeNodeSelect: { flex: 1, minWidth: 0 },
  projectTreeNodeOpen: { width: 36, height: 42, alignItems: "center", justifyContent: "center", position: "relative" },
  projectTreeOpenTooltip: { position: "absolute", bottom: "100%", right: 0, padding: 6, backgroundColor: "#243c32", borderRadius: 4, zIndex: 20 },
  projectTreeNode: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 42,
    paddingRight: 8,
    paddingVertical: 7,
  },
  projectTreeNodeActive: {
    backgroundColor: "#274f42",
    borderColor: "#6da992",
  },
  projectTreeNodeText: {
    flex: 1,
    minWidth: 0,
  },
  projectTreeNodeLabel: {
    color: "#e5f0e8",
    fontSize: 12,
    fontWeight: "900",
  },
  projectTreeNodeLabelActive: {
    color: "#ffffff",
  },
  projectTreeNodeMeta: {
    color: "#aebfb6",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2,
  },
  projectTreeNav: {
    borderTopColor: "#26392f",
    borderTopWidth: 1,
    gap: 5,
    paddingTop: 8,
  },
  projectTreeNavPrimary: {
    borderBottomColor: "#26392f",
    borderBottomWidth: 1,
    borderTopWidth: 0,
    paddingBottom: 8,
    paddingTop: 0,
  },
  projectTreeNavCompact: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  projectTreeNavConsole: {
    alignItems: "flex-end",
    alignSelf: "flex-end",
    borderTopWidth: 0,
    flexShrink: 0,
    paddingTop: 0,
    width: 56,
  },
  projectTreeNavCollapsed: {
    alignItems: "center",
    gap: 7,
    width: 56,
  },
  leftDrawerHandle: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "#1b3026",
    borderColor: "#30483b",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 56,
    width: 56,
  },
  railButton: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  railButtonCollapsed: {
    justifyContent: "center",
    paddingHorizontal: 0,
    width: 48,
  },
  railButtonActive: {
    backgroundColor: "#2f6f5b",
    borderColor: "#6da992",
  },
  railLabel: {
    color: "#d5e2db",
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "900",
  },
  railLabelActive: {
    color: "#ffffff",
  },
  smallActionButton: {
    alignItems: "center",
    backgroundColor: "#f1f5ee",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 10,
    minHeight: 44,
  },
  smallActionButtonDisabled: {
    opacity: 0.45,
  },
  smallActionText: {
    color: "#254234",
    fontSize: 12,
    fontWeight: "900",
  },
  smallActionTextDisabled: {
    color: "#68766d",
  },
  statusPill: {
    alignItems: "center",
    backgroundColor: "#e6eee5",
    borderColor: "#c9d7ca",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusText: {
    color: "#254234",
    fontSize: 12,
    fontWeight: "800",
  },
  workspaceBottomStatusBar: {
    alignItems: "center",
    backgroundColor: "#f9fbf6",
    borderTopColor: "#d6ded3",
    borderTopWidth: 1,
    flexDirection: "row",
    height: 34,
    overflow: "hidden",
    paddingHorizontal: 8,
    zIndex: 12,
  },
  workspaceBottomStatusBarShortLandscape: {
    height: 26,
  },
  bottomStatusScroll: {
    flex: 1,
    minWidth: 0,
  },
  bottomStatusContent: {
    alignItems: "center",
    gap: 6,
    minHeight: 33,
    paddingRight: 8,
  },
  bottomStatusContentShortLandscape: {
    minHeight: 25,
  },
  bottomStatusChip: {
    alignItems: "center",
    backgroundColor: "#e6eee5",
    borderColor: "#c9d7ca",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    flexShrink: 0,
    gap: 4,
    height: 24,
    maxWidth: 220,
    paddingHorizontal: 7,
  },
  bottomStatusText: {
    color: "#254234",
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "900",
  },
  nav: {
    backgroundColor: "#f9fbf6",
    borderBottomColor: "#d6ded3",
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  navButton: {
    alignItems: "center",
    borderColor: "#d1dcd0",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  navButtonActive: {
    backgroundColor: "#254234",
    borderColor: "#254234",
  },
  navLabel: {
    color: "#34463a",
    fontSize: 14,
    fontWeight: "800",
  },
  navLabelActive: {
    color: "#ffffff",
  },
  content: {
    padding: 18,
  },
  contentWithAndroidReviewInset: {
    paddingBottom: 96,
  },
  contentCompact: {
    padding: 10,
  },
  contentConsole: {
    flex: 1,
    flexGrow: 1,
    minHeight: 0,
    padding: 0,
  },
  consoleShell: {
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 0,
    overflow: "hidden",
    padding: 10,
    width: "100%",
  },
  consoleShellCompact: {
    flexDirection: "column",
    gap: 8,
    padding: 8,
  },
  consoleShellShortLandscape: {
    gap: 4,
    padding: 2,
  },
  consoleShellRightCollapsed: {
    gap: 8,
  },
  layoutGrid: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    width: "100%",
  },
  layoutGridCompact: {
    gap: 12,
  },
  mapConsoleFrame: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    position: "relative",
  },
  sidePanel: {
    backgroundColor: "#fbfcf8",
    borderColor: "#d8ded6",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 360,
    flexGrow: 0.8,
    flexShrink: 1,
    gap: 14,
    minWidth: 0,
    padding: 16,
  },
  sidePanelCompact: {
    flexBasis: "100%",
    width: "100%",
  },
  inspectorDrawer: {
    backgroundColor: "#fbfcf8",
    borderColor: "#d8ded6",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexShrink: 0,
    minHeight: 0,
    overflow: "hidden",
    width: 360,
  },
  inspectorDrawerCollapsed: {
    backgroundColor: "#13211b",
    borderColor: "#26392f",
    width: 56,
  },
  inspectorDrawerCompact: {
    flexDirection: "column",
    width: "100%",
  },
  inspectorDrawerCompactOpen: {
    bottom: 8,
    height: "42%",
    left: 8,
    maxHeight: 320,
    position: "absolute",
    right: 8,
    width: "auto",
    zIndex: 10,
  },
  inspectorDrawerCollapsedCompact: {
    height: 52,
    minHeight: 52,
    width: "100%",
  },
  inspectorDrawerHandle: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "#1b3026",
    justifyContent: "center",
    minHeight: 56,
    width: 56,
  },
  inspectorDrawerHandleCompact: {
    alignSelf: "stretch",
    height: 52,
    minHeight: 52,
    width: "100%",
  },
  inspectorCollapsedStatus: {
    alignItems: "center",
    backgroundColor: "#254234",
    borderTopColor: "#365645",
    borderTopWidth: 1,
    bottom: 0,
    justifyContent: "center",
    minHeight: 42,
    position: "absolute",
    width: 56,
  },
  inspectorCollapsedStatusText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "900",
  },
  inspectorDrawerBody: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  inspectorTabs: {
    borderBottomColor: "#d8ded6",
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    padding: 10,
  },
  inspectorTabScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  inspectorTabsCompact: {
    flexWrap: "nowrap",
  },
  inspectorTab: {
    backgroundColor: "#eef4ef",
    borderColor: "#cbd8ce",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  inspectorTabActive: {
    backgroundColor: "#254234",
    borderColor: "#254234",
  },
  inspectorTabText: {
    color: "#254234",
    fontSize: 11,
    fontWeight: "900",
  },
  inspectorTabTextActive: {
    color: "#ffffff",
  },
  inspectorScroll: {
    flex: 1,
    minHeight: 0,
  },
  inspectorContent: {
    gap: 14,
    padding: 14,
    paddingBottom: 20,
  },
  dashboard: {
    gap: 14,
  },
  dashboardHero: {
    alignItems: "stretch",
    backgroundColor: "#fbfcf8",
    borderColor: "#d8ded6",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    justifyContent: "space-between",
    padding: 16,
  },
  dashboardHeroCompact: {
    padding: 12,
  },
  dashboardIntro: {
    flex: 1,
    gap: 10,
    minWidth: 260,
  },
  dashboardTitle: {
    color: "#121d17",
    fontSize: 24,
    fontWeight: "900",
  },
  dashboardSubtitle: {
    color: "#44564b",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  dashboardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dashboardMetricStack: {
    flexBasis: 360,
    flexDirection: "row",
    flexGrow: 1,
    flexWrap: "wrap",
    gap: 10,
  },
  dashboardGrid: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  dashboardPanel: {
    backgroundColor: "#fbfcf8",
    borderColor: "#d8ded6",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 360,
    flexGrow: 1,
    gap: 12,
    minWidth: 0,
    padding: 14,
  },
  walkthroughPanel: {
    flexBasis: "auto",
    flexGrow: 0,
  },
  dashboardPanelHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dashboardPanelTitle: {
    color: "#17241c",
    flex: 1,
    fontSize: 16,
    fontWeight: "900",
  },
  dashboardCard: {
    backgroundColor: "#fbfcf8",
    borderColor: "#d8ded6",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 240,
    flexGrow: 1,
    gap: 8,
    minWidth: 0,
    padding: 14,
  },
  dashboardCardTitle: {
    color: "#17241c",
    fontSize: 13,
    fontWeight: "900",
  },
  dashboardCardValue: {
    color: "#14221b",
    fontSize: 18,
    fontWeight: "900",
  },
  dashboardMuted: {
    color: "#56685d",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
  },
  recentProjectRow: {
    alignItems: "center",
    backgroundColor: "#f6faf5",
    borderColor: "#dce4da",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    padding: 12,
  },
  walkthroughGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  walkthroughModule: {
    alignItems: "flex-start",
    backgroundColor: "#f6faf5",
    borderColor: "#dce4da",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 240,
    flexDirection: "row",
    flexGrow: 1,
    gap: 9,
    padding: 12,
  },
  walkthroughModuleComplete: {
    backgroundColor: "#edf7f0",
    borderColor: "#9cc8ad",
  },
  walkthroughText: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  walkthroughTitle: {
    color: "#17241c",
    fontSize: 13,
    fontWeight: "900",
  },
  walkthroughCheckpoint: {
    color: "#58675e",
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
  },
  resetButton: {
    alignItems: "center",
    backgroundColor: "#eef4ef",
    borderColor: "#c7d6ca",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  resetButtonText: {
    color: "#173428",
    fontSize: 11,
    fontWeight: "900",
  },
  inlineActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  layerGroupGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  layerGroupCard: {
    backgroundColor: "#f8faf4",
    borderColor: "#d8e0d4",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 156,
    flexGrow: 1,
    gap: 5,
    minWidth: 0,
    padding: 10,
  },
  helpPanel: {
    gap: 14,
  },
  helpHeader: {
    alignItems: "flex-start",
    backgroundColor: "#fbfcf8",
    borderColor: "#d8ded6",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    padding: 14,
  },
  helpHeaderCopy: {
    flexBasis: 320,
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: "100%",
    minWidth: 0,
  },
  helpQuickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    maxWidth: "100%",
  },
  helpModuleGrid: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  helpModuleCard: {
    backgroundColor: "#fbfcf8",
    borderColor: "#d8ded6",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 300,
    flexGrow: 1,
    gap: 9,
    minWidth: 0,
    padding: 14,
  },
  helpCheckpointRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  helpCheckpoint: {
    alignItems: "center",
    backgroundColor: "#f6faf5",
    borderColor: "#dce4da",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  helpCheckpointComplete: {
    backgroundColor: "#edf7f0",
    borderColor: "#9cc8ad",
  },
  helpCheckpointText: {
    color: "#405146",
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 15,
  },
  helpStatusBadge: {
    alignSelf: "center",
    backgroundColor: "#eef4ef",
    borderColor: "#b7c8bb",
    borderRadius: 8,
    borderWidth: 1,
    color: "#254234",
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 5,
    textTransform: "uppercase",
  },
  helpCompleteBadge: {
    backgroundColor: "#edf8ef",
    borderColor: "#a8d3b5",
    color: "#1f5f39",
  },
  mapFeatureEditor: {
    borderColor: "#dce3da",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  pendingDraftPurposePanel: {
    gap: 10,
  },
  consoleModalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(12, 22, 17, 0.48)",
    flex: 1,
    justifyContent: "flex-end",
    padding: 12,
  },
  consoleDialog: {
    backgroundColor: "#fbfcf8",
    borderColor: "#cbd8ce",
    borderRadius: 8,
    borderWidth: 1,
    maxHeight: "88%",
    maxWidth: 760,
    overflow: "hidden",
    width: "100%",
  },
  consoleInline: {
    borderWidth: 0,
    borderRadius: 0,
    maxHeight: "100%",
  },
  calculationScreen: {
    flex: 1,
    backgroundColor: "#fbfcf8",
  },
  calculationPanel: {
    backgroundColor: "#ffffff",
    flex: 1,
    maxHeight: "100%",
    maxWidth: "100%",
    borderWidth: 0,
    borderRadius: 0,
  },
  calculationBody: {
    flex: 1,
  },
  calculationSaveState: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  calculationBodyContent: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 960,
  },
  reportPricingChoices: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  reportPricingChoice: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingRight: 12, maxWidth: "100%" },
  consoleDialogHeader: {
    alignItems: "center",
    backgroundColor: "#f3f7f0",
    borderBottomColor: "#d7e0d8",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  consoleIconBadge: {
    alignItems: "center",
    backgroundColor: "#254234",
    borderRadius: 8,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  consoleDialogTitleBlock: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  consoleDialogTitle: {
    color: "#17241c",
    fontSize: 17,
    fontWeight: "900",
  },
  consoleDialogMeta: {
    color: "#53665b",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16,
  },
  consoleCloseButton: {
    backgroundColor: "#eef4ef",
    borderColor: "#c7d6ca",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  consoleCloseText: {
    color: "#173428",
    fontSize: 12,
    fontWeight: "900",
  },
  consoleDialogBody: {
    minHeight: 0,
  },
  consoleDialogBodyContent: {
    gap: 12,
    padding: 14,
  },
  consoleChoiceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  consoleChoiceButton: {
    backgroundColor: "#f6faf5",
    borderColor: "#d5e0d6",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 190,
    flexGrow: 1,
    gap: 5,
    minHeight: 76,
    minWidth: 0,
    padding: 12,
  },
  consoleChoiceTitle: {
    color: "#17241c",
    fontSize: 14,
    fontWeight: "900",
  },
  consoleChoiceMeta: {
    color: "#5b6b61",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16,
  },
  expertPanel: {
    backgroundColor: "#f6faf5",
    borderColor: "#d5e0d6",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  inputDisabled: {
    backgroundColor: "#edf1ec",
    color: "#65746a",
  },
  designBuilderPanel: {
    borderColor: "#cbd8ce",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 12,
  },
  designBuilderHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  designStep: {
    borderColor: "#dce3da",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 10,
  },
  designStepHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  designStepBadge: {
    alignItems: "center",
    backgroundColor: "#254234",
    borderRadius: 8,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  designStepBadgeText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  designStepTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  designStepTitle: {
    color: "#17241c",
    fontSize: 14,
    fontWeight: "900",
  },
  xyEditor: {
    gap: 8,
  },
  xyTextArea: {
    minHeight: 112,
    textAlignVertical: "top",
  },
  calculateButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#254234",
    borderColor: "#254234",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  calculateButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  scenarioList: {
    gap: 8,
  },
  scenarioRow: {
    borderRadius: 8,
    borderWidth: 1,
    gap: 5,
    padding: 10,
  },
  scenarioRowFeasible: {
    backgroundColor: "#eef8f0",
    borderColor: "#9fc7a9",
  },
  scenarioRowRejected: {
    backgroundColor: "#fff7e6",
    borderColor: "#e0c074",
  },
  scenarioRowHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  rowTitleWithIcon: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 7,
    minWidth: 0,
  },
  scenarioScore: {
    color: "#254234",
    fontSize: 13,
    fontWeight: "900",
  },
  scenarioScoreWarn: {
    color: "#9a5d08",
    fontSize: 13,
    fontWeight: "900",
  },
  placementReviewPanel: {
    backgroundColor: "#f7faf5",
    borderColor: "#d8e0d4",
    borderRadius: 8,
    borderWidth: 1,
    gap: 9,
    padding: 10,
  },
  costComparisonTable: {
    backgroundColor: "#eef4ef",
    borderColor: "#c8d6cb",
    borderRadius: 8,
    borderWidth: 1,
    gap: 1,
    overflow: "hidden",
  },
  radiusSensitivityTable: {
    backgroundColor: "#eef4ef",
    borderColor: "#c8d6cb",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    overflow: "hidden",
    paddingTop: 10,
  },
  radiusSensitivityMeta: {
    paddingHorizontal: 9,
  },
  costComparisonHeader: {
    backgroundColor: "#dfe9e1",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  costComparisonHeaderText: {
    color: "#254234",
    flex: 1,
    fontSize: 10,
    fontWeight: "900",
    minWidth: 82,
    textTransform: "uppercase",
  },
  costComparisonRow: {
    alignItems: "center",
    backgroundColor: "#fbfdf9",
    borderTopColor: "#dbe5dc",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  costComparisonStrategyCell: {
    flex: 1.4,
    gap: 2,
    minWidth: 118,
  },
  costComparisonStrategy: {
    color: "#1d2c22",
    fontSize: 12,
    fontWeight: "900",
  },
  costComparisonMeta: {
    color: "#647369",
    fontSize: 10,
    fontWeight: "800",
  },
  costComparisonValue: {
    color: "#254234",
    flex: 1,
    fontSize: 11,
    fontWeight: "900",
    minWidth: 82,
  },
  placementCandidateRow: {
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 10,
  },
  placementCandidateList: {
    gap: 8,
  },
  advisoryBadgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  advisoryBadge: {
    backgroundColor: "#eef4ef",
    borderColor: "#b7c8bb",
    borderRadius: 8,
    borderWidth: 1,
    color: "#254234",
    fontSize: 11,
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 5,
    textTransform: "uppercase",
  },
  scoreBreakdown: {
    color: "#405146",
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
  },
  clientDetailHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  clientIconBadge: {
    alignItems: "center",
    backgroundColor: "#254234",
    borderRadius: 8,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  clientDetailTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  profileRow: {
    alignItems: "center",
    borderBottomColor: "#e1e8df",
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    paddingVertical: 7,
  },
  profileLabel: {
    color: "#526257",
    fontSize: 12,
    fontWeight: "900",
  },
  profileValue: {
    color: "#1d2c22",
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "right",
  },
  profileNotes: {
    color: "#44564b",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
  },
  clientProjectRow: {
    backgroundColor: "#f7faf5",
    borderColor: "#dce3da",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  clientProjectRowActive: {
    backgroundColor: "#edf7f0",
    borderColor: "#77aa8b",
  },
  clientProjectText: {
    gap: 3,
    minWidth: 0,
  },
  manualDesignHeading: {
    flex: 1,
    minWidth: 0,
  },
  mapFeatureTitle: {
    color: "#17241c",
    fontSize: 14,
    fontWeight: "900",
  },
  mapFeatureMeta: {
    color: "#5b6b61",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  section: {
    backgroundColor: "#fbfcf8",
    borderColor: "#d8ded6",
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  sidebarSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: "#17241c",
    fontSize: 17,
    fontWeight: "900",
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  controlRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionButton: {
    backgroundColor: "#f1f5ee",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionButtonSelected: {
    backgroundColor: "#254234",
    borderColor: "#254234",
  },
  actionText: {
    color: "#314339",
    fontSize: 13,
    fontWeight: "900",
  },
  actionTextSelected: {
    color: "#ffffff",
  },
  projectList: {
    gap: 10,
  },
  projectCard: {
    backgroundColor: "#f7faf5",
    borderColor: "#dce3da",
    borderRadius: 8,
    borderWidth: 1,
    gap: 5,
    padding: 14,
  },
  machineForm: {
    borderColor: "#dce3da",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 12,
  },
  machineCatalogPanel: {
    backgroundColor: "#f7faf5",
    borderColor: "#dce3da",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  formGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  formField: {
    flexBasis: 210,
    flexGrow: 1,
    gap: 6,
  },
  formLabel: {
    color: "#3c4f43",
    fontSize: 12,
    fontWeight: "900",
  },
  textInput: {
    backgroundColor: "#ffffff",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    color: "#1d2c22",
    fontSize: 14,
    fontWeight: "800",
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  formError: {
    color: "#8d2b20",
    fontSize: 13,
    fontWeight: "800",
  },
  warningList: {
    gap: 9,
  },
  projectImportStatus: {
    alignItems: "flex-start",
    backgroundColor: "#edf4eb",
    borderBottomColor: "#c4d4c3",
    borderBottomWidth: 1,
    flexDirection: "row",
    flexShrink: 0,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  projectImportStatusError: {
    backgroundColor: "#fff0ee",
    borderBottomColor: "#e2aaa4",
  },
  projectImportStatusText: {
    color: "#26372c",
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  warningItem: {
    alignItems: "flex-start",
    backgroundColor: "#fff7e6",
    borderColor: "#e0c074",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    padding: 10,
  },
  warningText: {
    color: "#674017",
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  listRow: {
    alignItems: "center",
    borderColor: "#dce3da",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    padding: 13,
  },
  rowTitle: {
    color: "#1d2c22",
    fontSize: 15,
    fontWeight: "900",
  },
  rowMeta: {
    color: "#5b6b61",
    fontSize: 12,
    fontWeight: "700",
  },
  coordinate: {
    color: "#273d2e",
    fontSize: 13,
    fontWeight: "900",
  },
  codeBlock: {
    backgroundColor: "#18221c",
    borderRadius: 8,
    padding: 14,
  },
  codeText: {
    color: "#e5f0e8",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 17,
  },
});
