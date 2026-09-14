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
import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { CoordinateFormatPanel } from "./src/components/CoordinateFormatPanel";
import { useAdvisoryJob } from "./src/advisory/useAdvisoryJob";
import { advisoryDemand } from "./src/advisory/advisoryDemand";
import { AndroidNativeProofRunner } from "./src/components/AndroidNativeProofRunner";
import { BrowserRtkReceiverPanel, type BrowserRtkReceiverStatus } from "./src/components/BrowserRtkReceiverPanel";
import { CommandBar, IconCommandButton, type CommandIconButtonConfig, type CommandMenuConfig, type CommandMenuItemConfig } from "./src/components/CommandSurface";
import {
  MapSurface,
  defaultMapFeatureName,
  draftVerticesToFeatureGeometry,
  featureOptionsForGeometry,
  type PendingMapFeatureDraft,
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
import { ProjectCrsRecoveryPanel } from "./src/components/ProjectCrsRecoveryPanel";
import { createProjectOpenRequestGuard } from "./src/projectOpenRequest";
import { SettingsPanel } from "./src/components/SettingsPanel";
import { DrawingToolLauncher, DrawingToolPalette, type DrawingToolPaletteModal } from "./src/components/DrawingToolPalette";
import { useProjectRepository, type ProjectWorkspaceStatus } from "./src/hooks/useProjectRepository";
import {
  parseCplayoutLeftNavMenuXml,
  type CplayoutLeftNavCatalogActionDefinition,
  type CplayoutLeftNavIconId,
  type CplayoutLeftNavMenuActionId,
  type CplayoutLeftNavMenuDefinition,
  type CplayoutLeftNavMenuItemDefinition,
  type CplayoutLeftNavRailItemDefinition,
} from "./src/navigation/leftNavMenu";
import { buildCommandMenuConfigs, isLeftNavItemDisabled } from "./src/navigation/navigationViewModels";
import { buildProjectTreeViewModel } from "./src/navigation/projectTreeViewModel";
import type { ClientRecord } from "@cplayout/project-store";
import { exportFileAsync, importProjectArchiveZip, importZipFileAsync, rehydrateInstalledMapPackageManifestsAsync } from "@cplayout/project-store";
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
  evaluateProjectEditorAction,
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
  reduceProjectEditorState,
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
type WalkthroughModuleId = "imagery" | "boundary" | "obstacles" | "pivot" | "survey" | "cornerArmInputs" | "cornerArmCalculation" | "validation" | "export";
type DesignConsoleModal = DrawingToolPaletteModal;
type RightWorkflowSidebarPage = "overview" | "tools" | "purpose" | "toolForm" | "layers" | "rtk" | "feature" | "warnings" | "catalog" | "catalogForm";
type AdvisoryCostDraft = {
  fixedMachineCost: string;
  costPerMeter: string;
  costPerTower: string;
  currencyCode: string;
};
type PendingPlacementAction =
  | { kind: "pivot"; candidate: PivotPlacementCandidate }
  | { kind: "cornerArm"; config: AdvisoryCornerArmConfig };

type MapDraftPurposeOption =
  | (UtilityFeatureOption & { purposeType: "map_feature"; meta: string })
  | { purposeType: "field_boundary"; kind: "field_boundary"; label: string; geometry: "Polygon"; meta: string }
  | { purposeType: "obstacle"; kind: ObstacleZone["kind"]; label: string; geometry: "Polygon"; meta: string };

const EMPTY_ADVISORY_COST_DRAFT: AdvisoryCostDraft = {
  fixedMachineCost: "",
  costPerMeter: "",
  costPerTower: "",
  currencyCode: "USD",
};
const DEFAULT_CORNER_ARM_LENGTH_METERS = 91;
const DEFAULT_CORNER_ARM_WHEEL_TRACK_LENGTH_METERS = 66;
const DEFAULT_CORNER_ARM_OVERHANG_LENGTH_METERS = 25;

function createBlankDesignProject(settings: AppSettings): PivotProject {
  const timestamp = new Date().toISOString();
  const compactTimestamp = timestamp.replace(/[^0-9]/g, "").slice(0, 14);
  const origin = { x: 501000, y: 4506200 };
  const fieldBoundary = [
    { x: origin.x, y: origin.y },
    { x: origin.x + 400, y: origin.y },
    { x: origin.x + 400, y: origin.y + 400 },
    { x: origin.x, y: origin.y + 400 },
  ];

  return {
    id: `blank-design-${compactTimestamp}`,
    name: "Blank Field Design",
    projectCrs: "EPSG:32613",
    unitSystem: settings.unitSystem,
    settings: defaultProjectSettings(),
    fieldBoundary,
    pivotCenter: { x: origin.x + 200, y: origin.y + 200 },
    waterSource: { x: origin.x + 160, y: origin.y + 160 },
    powerSource: { x: origin.x + 40, y: origin.y + 360 },
    machine: {
      id: "blank-design-machine",
      name: "Blank concept pivot",
      spanLengthsMeters: [55, 55, 55],
      overhangMeters: 15,
      endGunThrowMeters: 0,
      endGunAngleRanges: [],
      towerClearanceBufferMeters: 5,
      machineClearanceBufferMeters: 8,
      sweep: { mode: "full_circle" },
    },
    obstacles: [],
    surveyPoints: [],
    mapPackages: [],
    mapFeatures: [],
  };
}

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AppContent />
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

function AppContent(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>("workspace");
  const [activeView, setActiveView] = useState<WorkspaceView>("map");
  const [editor, dispatchProject] = useReducer(reduceProjectEditorState, defaultDevelopmentProject, createProjectEditorState);
  const project = editor.project;
  const [runtimeMapPackages, setRuntimeMapPackages] = useState<MapPackageManifest[]>([]);
  const projectLoadSequenceRef = useRef(0);
  const [projectOpenRequests] = useState(createProjectOpenRequestGuard);
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
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
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
  const [advisoryCostDraft, setAdvisoryCostDraft] = useState<AdvisoryCostDraft>(EMPTY_ADVISORY_COST_DRAFT);
  const [pendingPlacementAction, setPendingPlacementAction] = useState<PendingPlacementAction | null>(null);
  const [pendingMapFeatureDraft, setPendingMapFeatureDraft] = useState<PendingMapFeatureDraft | null>(null);
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
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null);
  const [catalogDialogSubmitting, setCatalogDialogSubmitting] = useState(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compactLayout = windowWidth < 760;
  const tabletConsole = windowWidth >= 700 && windowWidth < 1180;
  const desktopConsole = Platform.OS === "web" && windowWidth >= 1180;
  const landscapeConsole = windowWidth > windowHeight;
  const safeBottomGutter = Math.max(insets.bottom, Platform.OS === "android" ? 24 : 0) + 10;
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(() => desktopConsole);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(() => desktopConsole);
  const [activeSidebarPage, setActiveSidebarPage] = useState<RightWorkflowSidebarPage>("catalog");
  const repository = useProjectRepository();
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
  const advisoryCostInput = useMemo(() => advisoryCostInputFromDraft(advisoryCostDraft), [advisoryCostDraft]);
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
    ? repository.catalog.clients.find((client) => client.id === editingClientId) ?? null
    : null;
  const renamingProject = renamingProjectId
    ? repository.catalog.projects.find((record) => record.id === renamingProjectId) ?? null
    : null;
  const movingProject = movingProjectId
    ? repository.catalog.projects.find((record) => record.id === movingProjectId) ?? null
    : null;
  const deletingProject = deletingProjectId
    ? repository.catalog.projects.find((record) => record.id === deletingProjectId) ?? null
    : null;
  const deletingClient = deletingClientId
    ? repository.catalog.clients.find((client) => client.id === deletingClientId) ?? null
    : null;
  const sidebarInlineWorkflow = !compactLayout && !nativeMapLibreProofEnabled;
  const inlineCatalogForms = sidebarInlineWorkflow && activeView === "map";
  const activeCatalogForm = Boolean(catalogDialogMode || clientProfileDialogMode || renamingProject || movingProject || deletingProject || deletingClient);
  const warningCount = (calculation.result?.warnings.length ?? calculation.reasons.length) + (editor.lastError ? 1 : 0);
  const powerEvidenceStatus = useMemo(() => projectPowerLineEvidenceStatus(project), [project]);
  const visibleSidebarPages = useMemo(
    () => rightWorkflowSidebarPages({
      activeCatalogForm: inlineCatalogForms && activeCatalogForm,
      activePurposeForm: Boolean(pendingMapFeatureDraft),
      activeToolForm: Boolean(designConsoleModal),
      homeView: homeMapView,
      mappingWorkflowMode: settings.mappingWorkflowMode,
      selectedMapFeature: Boolean(selectedMapFeature),
      warningCount,
    }),
    [activeCatalogForm, designConsoleModal, homeMapView, inlineCatalogForms, pendingMapFeatureDraft, selectedMapFeature, settings.mappingWorkflowMode, warningCount],
  );
  const requestedSidebarPage = inlineCatalogForms && activeCatalogForm ? "catalogForm" : activeSidebarPage;
  const effectiveSidebarPage = visibleSidebarPages.some((page) => page.id === requestedSidebarPage)
    ? requestedSidebarPage
    : (visibleSidebarPages[0]?.id ?? "overview");
  const sidebarGeometryToolsVisible = sidebarInlineWorkflow
    || (compactLayout && !nativeMapLibreProofEnabled && !homeMapView && rightDrawerOpen && effectiveSidebarPage === "tools");
  const demand = advisoryDemand({ homeView: homeMapView, view: activeView, modal: designConsoleModal, sidebar: effectiveSidebarPage, sidebarOpen: rightDrawerOpen });
  const projectGeneration = projectLoadSequenceRef.current;
  const fieldPlanRequest = useMemo(() => ({
    projectId: project.id, generation: projectGeneration, revision: editor.revision,
    create: () => planAdvisoryFieldPivotsSteps(project, {
      gridDivisions: 6, maxMachines: 3, candidatePoolSize: 24,
      collisionBufferMeters: project.machine.machineClearanceBufferMeters, costInput: advisoryCostInput,
    }),
  }), [advisoryCostInput, editor.revision, project, projectGeneration]);
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

  useEffect(() => {
    if (homeMapView) setDesignConsoleModal(null);
  }, [homeMapView]);

  useEffect(() => {
    if (!selectedMapFeatureId) return;
    if (activeCatalogForm || designConsoleModal) return;
    setActiveSidebarPage("feature");
    setRightDrawerOpen(true);
  }, [activeCatalogForm, designConsoleModal, selectedMapFeatureId]);

  useEffect(() => {
    if (homeMapView) {
      setActiveSidebarPage("catalog");
      return;
    }
    if (selectedMapFeatureId) return;
    setActiveSidebarPage(settings.mappingWorkflowMode === "layout" ? "rtk" : "tools");
  }, [homeMapView, selectedMapFeatureId, settings.mappingWorkflowMode]);

  useEffect(() => {
    if (desktopConsole) {
      setLeftDrawerOpen(true);
      setRightDrawerOpen(true);
      return;
    }
    if (tabletConsole || landscapeConsole) {
      setLeftDrawerOpen(false);
      setRightDrawerOpen(false);
    }
  }, [desktopConsole, landscapeConsole, tabletConsole]);

  function applyPivotCoordinate(coordinate: XY, wgs84?: LonLat): void {
    dispatchProject({ type: "place_pivot", point: coordinate, wgs84 });
  }

  function dispatchProjectWithResult(action: ProjectEditorAction): boolean {
    return dispatchProjectTransaction(action).ok;
  }

  function dispatchProjectTransaction(action: ProjectEditorAction): ProjectMutationResult {
    const result = evaluateProjectEditorAction(editor, action);
    dispatchProject(action);
    return result;
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
    if (!homeMapView) {
      dispatchProject({ type: "update_project_settings", unitSystem: parsed.unitSystem, settings: projectSettingsFromApp(parsed) });
    }
  }

  function setWorkflowMode(mappingWorkflowMode: AppSettings["mappingWorkflowMode"]): void {
    setSettings((current) => parseAppSettings({ ...current, mappingWorkflowMode }));
    if (mappingWorkflowMode !== "design") {
      setGuidedMapTool(null);
      setDesignConsoleModal(null);
      setPendingMapFeatureDraft(null);
    }
  }

  function loadProject(nextProject: PivotProject, context?: Partial<typeof activeCatalogContext>, persisted = false): void {
    projectOpenRequests.invalidate();
    const loadSequence = projectLoadSequenceRef.current + 1;
    projectLoadSequenceRef.current = loadSequence;
    dispatchProject({ type: "load_project", project: nextProject });
    setRuntimeMapPackages([]);
    void rehydrateRuntimeMapPackages(loadSequence, nextProject.mapPackages ?? []);
    setSavedRevision(persisted ? 0 : null);
    setProjectImportStatus(null);
    setSettings((current) => browserLocalSettings(nextProject.settings, current));
    setWalkthroughProgress(loadWalkthroughProgress(nextProject.id));
    setSelectedMapFeatureId(null);
    setPendingMapFeatureDraft(null);
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
    setActiveSidebarPage("tools");
    setActiveCatalogContext({ clientId: null, projectId: null, fieldMapId: null, designId: null, ...context });
    setScreen("workspace");
  }

  function loadIndependentProject(nextProject: PivotProject): void {
    loadProject(nextProject, { clientId: null, projectId: null, fieldMapId: null, designId: null });
  }

  async function importIndependentProjectZip(owner: object): Promise<{ name: string; saved: boolean } | null> {
    const accepted: { value: { project: PivotProject; generation: number } | null } = { value: null };
    await projectOpenRequests.open(async () => {
      const bytes = await importZipFileAsync();
      return bytes ? importProjectArchiveZip(bytes) : null;
    }, (imported) => {
      loadIndependentProject(imported);
      const generation = projectLoadSequenceRef.current;
      accepted.value = { project: imported, generation };
      setProjectImportStatus({ generation, kind: "saving" });
    }, owner);
    if (!accepted.value) return null;
    const { project: imported, generation } = accepted.value;
    // Share normal-save ordering so an older imported copy cannot overwrite later edits.
    const save = saveQueueRef.current.then(async () => {
      let saved = false;
      try {
        saved = await repository.saveProject(imported);
      } finally {
        if (projectLoadSequenceRef.current === generation) {
          if (saved) setSavedRevision(0);
          setProjectImportStatus({ generation, kind: saved ? "saved" : "error" });
        }
      }
      return saved;
    });
    saveQueueRef.current = save.then(() => undefined, () => undefined);
    return { name: imported.name, saved: await save };
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
    loadProject(createBlankDesignProject(settings), {
      clientId: null,
      projectId: null,
      fieldMapId: null,
      designId: null,
    });
  }

  function openCatalogHome(): void {
    projectOpenRequests.invalidate();
    setScreen("workspace");
    setActiveView("map");
    setHomeMapView(true);
    setActiveSidebarPage("catalog");
  }

  async function saveCurrentProject(): Promise<void> {
    const generation = projectLoadSequenceRef.current;
    const revision = editor.revision;
    // Preserve write order; a delayed acknowledgment belongs only to its loaded project.
    const save = saveQueueRef.current.then(async () => {
      const saved = activeCatalogContext.designId
        ? await repository.saveDesignProject(activeCatalogContext.designId, project, calculation.result ?? undefined)
        : await repository.saveProject(project, calculation.result ?? undefined);
      if (projectLoadSequenceRef.current === generation) {
        if (saved) setSavedRevision(revision);
        setProjectImportStatus((current) => current?.generation === generation
          ? { generation, kind: saved ? "saved" : "error" } : current);
      }
    });
    saveQueueRef.current = save.catch(() => undefined);
    await save;
  }

  async function openSavedProject(projectId: string): Promise<void> {
    await projectOpenRequests.open(() => repository.openProject(projectId), (loaded) => {
      const design = repository.catalog.designs.find((record) => record.pivotProjectId === projectId) ?? null;
      const fieldMap = design ? repository.catalog.fieldMaps.find((record) => record.id === design.fieldMapId) ?? null : null;
      const projectRecord = repository.catalog.projects.find((record) => record.id === (fieldMap?.projectId ?? projectId)) ?? null;
      loadProject(loaded, {
        clientId: projectRecord?.clientId ?? null,
        projectId: fieldMap?.projectId ?? projectId,
        fieldMapId: fieldMap?.id ?? null,
        designId: design?.id ?? null,
      }, true);
    });
  }

  async function openDesignProject(designId: string): Promise<void> {
    await projectOpenRequests.open(() => repository.openDesignProject(designId), (loaded) => {
      const design = repository.catalog.designs.find((record) => record.id === designId) ?? null;
      const fieldMap = design ? repository.catalog.fieldMaps.find((record) => record.id === design.fieldMapId) ?? null : null;
      const projectRecord = fieldMap ? repository.catalog.projects.find((record) => record.id === fieldMap.projectId) ?? null : null;
      loadProject(loaded, {
        clientId: projectRecord?.clientId ?? null,
        projectId: fieldMap?.projectId ?? null,
        fieldMapId: fieldMap?.id ?? null,
        designId,
      }, true);
    });
  }

  function importProjectedGeoJson(geoJson: string): string {
    const imported = importProjectedGeoJsonToProject(project, geoJson);
    dispatchProject({ type: "import_projected_geojson", geoJson });
    const parts = [];
    if (imported.importedBoundary) parts.push("boundary");
    if (imported.importedObstacleCount > 0) parts.push(`${imported.importedObstacleCount} obstacle${imported.importedObstacleCount === 1 ? "" : "s"}`);
    return `Imported projected GeoJSON ${parts.length > 0 ? parts.join(" and ") : "features"} into the current project.`;
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

  function createPendingMapFeatureDraft(draft: PendingMapFeatureDraft): void {
    setPendingMapFeatureDraft(draft);
    setSelectedMapFeatureId(null);
    setDesignConsoleModal(null);
    setActiveSidebarPage("purpose");
    setRightDrawerOpen(true);
  }

  function cancelPendingMapFeatureDraft(): void {
    setPendingMapFeatureDraft(null);
    setActiveSidebarPage("tools");
  }

  function savePendingMapFeatureDraft(option: MapDraftPurposeOption): void {
    if (!pendingMapFeatureDraft) return;
    if (option.geometry !== pendingMapFeatureDraft.geometryType) return;
    if (option.purposeType === "field_boundary") {
      if (dispatchProjectWithResult({ type: "commit_boundary_draft", vertices: pendingMapFeatureDraft.vertices })) {
        setPendingMapFeatureDraft(null);
        setActiveSidebarPage("tools");
      }
      return;
    }
    if (option.purposeType === "obstacle") {
      if (dispatchProjectWithResult({
        type: "commit_obstacle_draft",
        vertices: pendingMapFeatureDraft.vertices,
        kind: option.kind,
        confidence: pendingMapFeatureDraft.sourceConfidence,
      })) {
        setPendingMapFeatureDraft(null);
        setActiveSidebarPage("tools");
      }
      return;
    }
    const geometry = draftVerticesToFeatureGeometry(pendingMapFeatureDraft.geometryType, pendingMapFeatureDraft.vertices);
    const id = `map-feature-${Date.now().toString(36)}-${(project.mapFeatures ?? []).length + 1}`;
    const feature: ProjectMapFeature = {
      id,
      name: defaultMapFeatureName(option.kind, pendingMapFeatureDraft.geometryType, pendingMapFeatureDraft.vertices.length),
      kind: option.kind,
      geometry,
      confidence: pendingMapFeatureDraft.sourceConfidence,
      notes: pendingMapFeatureDraft.notes,
    };
    if (dispatchProjectWithResult({ type: "add_map_feature", feature })) {
      setPendingMapFeatureDraft(null);
      setSelectedMapFeatureId(id);
      setActiveSidebarPage("feature");
    }
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
    setManualDesignCaptureRequest(null);
    setWorkflowMode("design");
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
    if (sidebarInlineWorkflow) setActiveSidebarPage("tools");
    setActiveView("map");
  }

  function activatePrimitiveMapTool(geometry: UtilityFeatureGeometry): void {
    activateGuidedMapTool("measure", "control_point", undefined, geometry);
    setPendingMapFeatureDraft(null);
    setSelectedMapFeatureId(null);
    setDesignConsoleModal(null);
    if (sidebarInlineWorkflow) setActiveSidebarPage("tools");
    setActiveView("map");
  }

  function openDesignConsolePanel(modal: DesignConsoleModal): void {
    setDesignConsoleModal(modal);
    if (modal && sidebarInlineWorkflow) {
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
    if (sidebarInlineWorkflow) {
      setDesignConsoleModal("calculate");
      setActiveSidebarPage("toolForm");
      setRightDrawerOpen(true);
      setActiveView("map");
      return;
    }
    setDesignConsoleModal("calculate");
  }

  function routeToClientSelection(): void {
    showCatalogMap(
      { clientId: activeCatalogContext.clientId, projectId: null, fieldMapId: null, designId: null },
      "Select or create a client folder, then use New Project inside that client.",
    );
  }

  function openCatalogDialog(mode: ProjectCatalogDialogMode): void {
    if (mode === "client") {
      openClientCreateDialog();
      return;
    }
    if (mode === "project" && !selectedClient) {
      routeToClientSelection();
      return;
    }
    setCatalogDialogDefaultName(defaultCatalogDialogName(mode));
    setCatalogDialogMode(mode);
    openCatalogFormSidebar();
  }

  function openClientCreateDialog(): void {
    setCatalogNotice(null);
    setEditingClientId(null);
    setClientProfileDialogMode("create");
    openCatalogFormSidebar();
  }

  function openClientEditDialog(clientId: string): void {
    setCatalogNotice(null);
    setEditingClientId(clientId);
    setClientProfileDialogMode("edit");
    openCatalogFormSidebar();
  }

  function openCatalogFormSidebar(): void {
    if (!inlineCatalogForms) return;
    setActiveSidebarPage("catalogForm");
    setRightDrawerOpen(true);
    setActiveView("map");
  }

  function openProjectRenameForm(projectId: string): void {
    setRenamingProjectId(projectId);
    openCatalogFormSidebar();
  }

  function openProjectMoveForm(projectId: string): void {
    setMovingProjectId(projectId);
    openCatalogFormSidebar();
  }

  function openProjectDeleteForm(projectId: string): void {
    setDeletingProjectId(projectId);
    openCatalogFormSidebar();
  }

  function openClientDeleteForm(clientId: string): void {
    setDeletingClientId(clientId);
    openCatalogFormSidebar();
  }

  function closeInlineCatalogForm(): void {
    setActiveSidebarPage(homeMapView ? "catalog" : (settings.mappingWorkflowMode === "layout" ? "rtk" : "tools"));
  }

  async function submitCatalogDialog(name: string): Promise<void> {
    if (!catalogDialogMode || catalogDialogSubmitting) return;
    setCatalogDialogSubmitting(true);
    try {
      if (catalogDialogMode === "project") await createProjectFolder(name);
      if (catalogDialogMode === "fieldMap") await createFieldMapForProject(name);
      if (catalogDialogMode === "design") await createDesignForFieldMap(name);
      setCatalogDialogMode(null);
      closeInlineCatalogForm();
    } finally {
      setCatalogDialogSubmitting(false);
    }
  }

  function closeCatalogDialog(): void {
    if (catalogDialogSubmitting) return;
    setCatalogDialogMode(null);
    closeInlineCatalogForm();
  }

  function defaultCatalogDialogName(mode: ProjectCatalogDialogMode): string {
    if (mode === "client") return `Client ${repository.catalog.clients.length + 1}`;
    if (mode === "project") return `Untitled Project ${repository.catalog.projects.length + 1}`;
    if (mode === "fieldMap") {
      const projectId = activeCatalogContext.projectId;
      const siblingCount = repository.catalog.fieldMaps.filter((record) => record.projectId === projectId).length;
      return `Field Map ${siblingCount + 1}`;
    }
    const fieldMapId = activeCatalogContext.fieldMapId;
    const siblingCount = repository.catalog.designs.filter((record) => record.fieldMapId === fieldMapId).length;
    return `Design ${siblingCount + 1}`;
  }

  function catalogDialogContextPreview(mode: ProjectCatalogDialogMode): string {
    if (mode === "client") return "Saved under: Project Catalog";
    if (mode === "project") {
      return selectedClient ? `Saved under: ${selectedClient.displayName}` : "Select a client folder before creating a project.";
    }
    if (mode === "fieldMap") {
      const projectRecord = activeCatalogContext.projectId
        ? repository.catalog.projects.find((record) => record.id === activeCatalogContext.projectId) ?? null
        : null;
      return formatCatalogPath(projectRecord ? catalogPathForProject(projectRecord.id) : []);
    }
    const fieldMap = activeCatalogContext.fieldMapId
      ? repository.catalog.fieldMaps.find((record) => record.id === activeCatalogContext.fieldMapId) ?? null
      : null;
    return formatCatalogPath(fieldMap ? [...catalogPathForProject(fieldMap.projectId), fieldMap.name] : []);
  }

  function catalogPathForProject(projectId: string): string[] {
    const projectRecord = repository.catalog.projects.find((record) => record.id === projectId) ?? null;
    const client = projectRecord
      ? repository.catalog.clients.find((record) => record.id === projectRecord.clientId) ?? null
      : null;
    return [client?.displayName, projectRecord?.name].filter((part): part is string => Boolean(part));
  }

  function formatCatalogPath(parts: string[]): string {
    return `Saved under: ${parts.length > 0 ? parts.join(" > ") : "Project Catalog"}`;
  }

  async function submitClientProfile(value: ClientProfileDialogValue): Promise<void> {
    if (!clientProfileDialogMode || catalogDialogSubmitting) return;
    setCatalogDialogSubmitting(true);
    try {
      if (clientProfileDialogMode === "create") {
        const client = await repository.createClient(value);
        if (client) {
          showCatalogMap({ clientId: client.id, projectId: null, fieldMapId: null, designId: null });
        }
      } else if (editingClientId) {
        const client = await repository.updateClient({ id: editingClientId, ...value });
        if (client) setCatalogNotice(null);
      }
      setClientProfileDialogMode(null);
      setEditingClientId(null);
      closeInlineCatalogForm();
    } finally {
      setCatalogDialogSubmitting(false);
    }
  }

  function closeClientProfileDialog(): void {
    if (catalogDialogSubmitting) return;
    setClientProfileDialogMode(null);
    setEditingClientId(null);
    closeInlineCatalogForm();
  }

  async function createProjectFolder(name: string): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const client = selectedClient;
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
      projectCrs: project.projectCrs,
      unitSystem: settings.unitSystem,
      fieldMapId,
      fieldMapName: "Primary Field Map",
    });
    if (created) {
      showCatalogMap({
        clientId: client.id,
        projectId: created.projectRecord.id,
        fieldMapId: created.fieldMap.id,
        designId: null,
      });
    }
  }

  async function createFieldMapForProject(name: string, projectId = activeCatalogContext.projectId): Promise<void> {
    const fieldName = name.trim();
    if (!fieldName) return;
    const projectRecord = projectId ? repository.catalog.projects.find((record) => record.id === projectId) ?? null : null;
    if (!projectRecord) return;
    const createdAt = new Date().toISOString();
    const fieldMapId = `${projectRecord.id}:field-map:${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
    const fieldMap = await repository.createFieldMapRecord({ id: fieldMapId, projectId: projectRecord.id, name: fieldName });
    if (fieldMap) {
      showCatalogMap({
        clientId: projectRecord.clientId,
        projectId: projectRecord.id,
        fieldMapId: fieldMap.id,
        designId: null,
      });
    }
  }

  async function createDesignForFieldMap(name: string, fieldMapId = activeCatalogContext.fieldMapId): Promise<void> {
    const designName = name.trim();
    if (!designName) return;
    const fieldMap = fieldMapId ? repository.catalog.fieldMaps.find((record) => record.id === fieldMapId) ?? null : null;
    if (!fieldMap) return;
    const projectRecord = repository.catalog.projects.find((record) => record.id === fieldMap.projectId) ?? null;
    if (!projectRecord) return;
    showCatalogMap(
      {
        clientId: projectRecord.clientId,
        projectId: projectRecord.id,
        fieldMapId: fieldMap.id,
        designId: null,
      },
      `Design creation for ${designName} starts after a map is imported or the real design initialization workflow is implemented.`,
    );
  }

  async function openFieldMap(fieldMapId: string): Promise<void> {
    const design = repository.catalog.designs.find((record) => record.fieldMapId === fieldMapId && record.isActive)
      ?? repository.catalog.designs.find((record) => record.fieldMapId === fieldMapId)
      ?? null;
    if (design) await openDesignProject(design.id);
    else selectFieldMapCatalogOnly(fieldMapId);
  }

  async function renameProjectFolder(projectId: string, name: string): Promise<void> {
    if (catalogDialogSubmitting) return;
    const generation = projectLoadSequenceRef.current;
    setCatalogDialogSubmitting(true);
    try {
      const updatedProjectRecord = await repository.renameProject(projectId, name);
      if (!updatedProjectRecord) return;
      if (project.id === projectId && projectLoadSequenceRef.current === generation) {
        projectOpenRequests.invalidate();
        projectLoadSequenceRef.current += 1;
        void rehydrateRuntimeMapPackages(projectLoadSequenceRef.current, project.mapPackages ?? []);
        dispatchProject({ type: "load_project", project: { ...project, name: updatedProjectRecord.name } });
        setSavedRevision(0);
      }
      setRenamingProjectId(null);
      closeInlineCatalogForm();
    } finally {
      setCatalogDialogSubmitting(false);
    }
  }

  async function moveProjectFolder(projectId: string, clientId: string): Promise<void> {
    if (catalogDialogSubmitting) return;
    setCatalogDialogSubmitting(true);
    try {
      const moved = await repository.moveProjectToClient(projectId, clientId);
      if (!moved) return;
      if (activeCatalogContext.projectId === projectId) {
        setActiveCatalogContext((current) => ({ ...current, clientId }));
      }
      setMovingProjectId(null);
      closeInlineCatalogForm();
    } finally {
      setCatalogDialogSubmitting(false);
    }
  }

  async function confirmDeleteProject(): Promise<void> {
    if (!deletingProjectId || catalogDialogSubmitting) return;
    const projectId = deletingProjectId;
    setCatalogDialogSubmitting(true);
    try {
      const deleted = await repository.deleteProject(projectId);
      if (deleted) {
        if (activeCatalogContext.projectId === projectId || project.id === projectId) {
          showCatalogMap({ clientId: activeCatalogContext.clientId, projectId: null, fieldMapId: null, designId: null });
        }
        setDeletingProjectId(null);
        closeInlineCatalogForm();
      }
    } finally {
      setCatalogDialogSubmitting(false);
    }
  }

  async function confirmDeleteClient(): Promise<void> {
    if (!deletingClientId || catalogDialogSubmitting) return;
    const clientId = deletingClientId;
    setCatalogDialogSubmitting(true);
    try {
      const deleted = await repository.deleteClient(clientId);
      if (deleted) {
        if (activeCatalogContext.clientId === clientId) {
          setActiveCatalogContext({ clientId: null, projectId: null, fieldMapId: null, designId: null });
        }
        setDeletingClientId(null);
        closeInlineCatalogForm();
      }
    } finally {
      setCatalogDialogSubmitting(false);
    }
  }

  function selectClientFolder(clientId: string): void {
    showCatalogMap({ clientId, projectId: null, fieldMapId: null, designId: null });
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
    const design = repository.catalog.designs.find((record) => record.id === designId) ?? null;
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
    projectOpenRequests.invalidate();
    setScreen("workspace");
    setActiveView("map");
    setHomeMapView(true);
    setWorkflowMode("layout");
    setCatalogNotice(notice);
    setSelectedMapFeatureId(null);
    setDesignConsoleModal(null);
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

  // All hooks stay mounted across CRS transitions; no calculated view mounts without a result.
  if (calculation.result === null) {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
        <StatusBar style="dark" />
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
        <View style={[styles.app, { paddingBottom: safeBottomGutter }]}>
          <View style={styles.topBar}>
            <View>
              <Text style={styles.appTitle}>CPLayout</Text>
              <Text style={styles.appSubtitle}>Browser mapping console</Text>
            </View>
            <View style={[styles.statusRow, compactLayout && styles.statusRowCompact]}>
              <StatusPill icon={<WifiOff size={15} color="#254234" />} label="Offline storage" />
              <StatusPill icon={<Ruler size={15} color="#254234" />} label="Projected XY canonical" />
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
            <Text style={styles.mapFeatureMeta}>Drawing tools, focused inputs, layers, RTK capture, selected features, and warnings are managed from this right sidebar. Draft vertices and save/clear actions remain on the map.</Text>
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
            onCalculate={calculateAndOpenPanel}
            onOpenModal={openDesignConsolePanel}
            onToggleLayers={toggleLayersPanel}
            settings={settings}
            showGeometryTools={sidebarGeometryToolsVisible}
            variant="sidebar"
          />
          {settings.mappingWorkflowMode === "design" ? (
            <ManualDesignTransactionPanel
              mapCapture={manualDesignMapCapture}
              onApply={(draft) => dispatchProjectWithResult({ type: "apply_manual_design", draft })}
              onRequestMapCapture={requestManualDesignMapCapture}
              onOpenRtk={() => {
                setActiveSidebarPage("rtk");
                setRightDrawerOpen(true);
              }}
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
              <Text style={styles.mapFeatureTitle}>Layout mode</Text>
              <Text style={styles.mapFeatureMeta}>Pointer geometry edits stay read-only in Layout. Use RTK capture for survey-controlled geometry changes or switch to Design for map-click drafting.</Text>
            </View>
          ) : null}
        </>
      );
    }

    if (page === "purpose") {
      return (
        <>
          <Text style={styles.sectionTitle}>Purpose</Text>
          <PendingDraftPurposePanel
            draft={pendingMapFeatureDraft}
            onCancel={cancelPendingMapFeatureDraft}
            onSave={savePendingMapFeatureDraft}
            unitSystem={settings.unitSystem}
          />
        </>
      );
    }

    if (page === "toolForm") {
      return designConsoleModal ? (
        <View testID="design-console-panel">
          <DesignConsolePanel
            activeModal={designConsoleModal}
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

    if (page === "rtk") {
      return (
        <>
          <Text style={styles.sectionTitle}>{settings.mappingWorkflowMode === "design" ? "RTK Design Evidence" : "RTK Layout Capture"}</Text>
          <BrowserRtkReceiverPanel
            onAddMapFeature={addMapFeature}
            onAddSurveyPoint={(point) => dispatchProjectTransaction({ type: "add_survey_point", point })}
            onCommitBoundaryDraft={(vertices, captureEvidence) => dispatchProjectTransaction({ type: "commit_boundary_draft", vertices, captureEvidence })}
            onCommitObstacleDraft={(vertices, kind, confidence, captureEvidence) => dispatchProjectTransaction({ type: "commit_obstacle_draft", vertices, kind, confidence, captureEvidence })}
            onStatusChange={setRtkReceiverStatus}
            project={project}
            settings={settings}
          />
          {settings.mappingWorkflowMode === "design" ? (
            <Text style={styles.mapFeatureMeta}>Accepted captures remain explicit survey or map-feature evidence. Return to the guided transaction to select an input source and apply canonical geometry atomically.</Text>
          ) : null}
        </>
      );
    }

    if (page === "feature") {
      return (
        <>
          <Text style={styles.sectionTitle}>Feature</Text>
          <MapFeatureEditor
            feature={selectedMapFeature}
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
          contextPreview={catalogDialogContextPreview(catalogDialogMode)}
          defaultName={catalogDialogDefaultName}
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
          defaultDisplayName={`Client ${repository.catalog.clients.length + 1}`}
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
          contextPreview={formatCatalogPath(catalogPathForProject(renamingProject.id))}
          createButtonLabel="Rename"
          defaultName={renamingProject.name}
          embedded
          helper="Rename updates the local project document and catalog row without changing projected XY geometry."
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
          currentClientId={movingProject.clientId}
          clients={repository.catalog.clients}
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
          confirmLabel="Delete Client"
          embedded
          message={`Delete the empty client folder ${deletingClient.displayName}. This is blocked automatically if any projects remain inside it.`}
          onCancel={() => {
            if (!catalogDialogSubmitting) {
              setDeletingClientId(null);
              closeInlineCatalogForm();
            }
          }}
          onConfirm={confirmDeleteClient}
          submitting={catalogDialogSubmitting}
          testID="delete-client-dialog"
          title="Delete Client"
        />
      );
    }
    return (
      <View style={styles.mapFeatureEditor}>
        <Text style={styles.mapFeatureTitle}>No catalog form open</Text>
        <Text style={styles.mapFeatureMeta}>Use the catalog rail or client details to create, rename, move, or delete local catalog records.</Text>
      </View>
    );
  }

  return (
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea} testID="workspace-screen">
      <AndroidNativeProofRunner enabled={androidNativeProofEnabled} />
      <StatusBar style="dark" />
      <View style={[styles.app, { paddingBottom: safeBottomGutter }]}>
        <WorkspaceTopToolbar compact={compactLayout} currentLabel={homeMapView ? "Project Catalog" : project.name}>
          <WorkspaceCommandSurface
            activeView={activeView}
            canRedo={editor.future.length > 0}
            canUndo={editor.past.length > 0}
            compactLayout={compactLayout}
            dirty={isDirty}
            homeMapView={homeMapView}
            leftDrawerOpen={leftDrawerOpen}
            onNavigate={setActiveView}
            onOpenCatalog={openCatalogHome}
            onOpenFiles={() => setActiveView("files")}
            onOpenSample={(nextProject) => loadProjectDashboard(nextProject)}
            onRedo={() => dispatchProject({ type: "redo" })}
            onResetWalkthrough={resetWalkthrough}
            onSave={saveCurrentProject}
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
        {!homeMapView ? importNotice : null}

        <View style={[styles.workspaceShell, activeView !== "map" && compactLayout && styles.workspaceShellCompact, activeView === "map" && styles.workspaceShellConsole]} testID="workspace-shell">
          <ProjectTreeRail
            activeContext={activeCatalogContext}
            activeView={activeView}
            catalog={repository.catalog}
            compact={compactLayout}
            consoleMode={activeView === "map"}
            drawerOpen={activeView === "map" ? leftDrawerOpen : true}
            menuDefinition={leftNavMenuDefinition}
            onCreateClient={openClientCreateDialog}
            onCreateDesign={() => openCatalogDialog("design")}
            onCreateFieldMap={() => openCatalogDialog("fieldMap")}
            onCreateProject={() => openCatalogDialog("project")}
            onNavigate={setActiveView}
            onOpenDesign={openDesignProject}
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
            style={[styles.workspaceScroll, activeView === "map" && windowWidth >= 700 && styles.workspaceScrollConsole]}
            contentContainerStyle={activeView === "map" ? styles.contentConsole : [styles.content, styles.contentWithAndroidReviewInset, compactLayout && styles.contentCompact]}
          >
          {activeView === "dashboard" && (homeMapView ? (
            <Section title="Project Catalog" icon={<Home size={20} color="#254234" />} testID="dashboard-workspace">
              <CatalogHomePanel
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
              onOpenFiles={() => setActiveView("files")}
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

          {activeView === "map" && (
            <WorkspaceConsoleShell compact={compactLayout} rightDrawerOpen={nativeMapLibreProofEnabled ? false : rightDrawerOpen} testID="map-view">
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
                  bottomOverlay={!homeMapView && !nativeMapLibreProofEnabled && !sidebarGeometryToolsVisible ? (
                    <DesignActionHud
                      activeModal={designConsoleModal}
                      activeTool={guidedMapTool}
                      onActivateTool={activateDesignConsoleTool}
                      onCalculate={calculateAndOpenPanel}
                      onOpenModal={openDesignConsolePanel}
                      onToggleLayers={toggleLayersPanel}
                      settings={settings}
                    />
                  ) : null}
                  homeView={homeMapView}
                  project={runtimeProject}
                  result={result}
                  settings={settings}
                  selectedMapFeatureId={selectedMapFeatureId}
                  manualDesignCaptureRequest={manualDesignCaptureRequest}
                  onSettingsChange={commitSettings}
                  onMappingWorkflowModeChange={setWorkflowMode}
                  onCommitBoundaryDraft={(vertices) => dispatchProjectWithResult({ type: "commit_boundary_draft", vertices })}
                  onCommitObstacleDraft={(vertices, kind, confidence) => dispatchProjectWithResult({ type: "commit_obstacle_draft", vertices, kind, confidence })}
                  onMoveBoundaryVertex={(vertexIndex, point) => dispatchProject({ type: "move_boundary_vertex", vertexIndex, point })}
                  onInsertBoundaryVertex={(afterVertexIndex, point) => dispatchProject({ type: "insert_boundary_vertex", afterVertexIndex, point })}
                  onDeleteBoundaryVertex={(vertexIndex) => dispatchProject({ type: "delete_boundary_vertex", vertexIndex })}
                  onMoveObstacleVertex={(obstacleId, vertexIndex, point) => dispatchProject({ type: "move_obstacle_vertex", obstacleId, vertexIndex, point })}
                  onInsertObstacleVertex={(obstacleId, afterVertexIndex, point) => dispatchProject({ type: "insert_obstacle_vertex", obstacleId, afterVertexIndex, point })}
                  onDeleteObstacleVertex={(obstacleId, vertexIndex) => dispatchProject({ type: "delete_obstacle_vertex", obstacleId, vertexIndex })}
                  onMoveMapFeatureVertex={(featureId, vertexIndex, point) => dispatchProject({ type: "move_map_feature_vertex", featureId, vertexIndex, point })}
                  onInsertMapFeatureVertex={(featureId, afterVertexIndex, point) => dispatchProject({ type: "insert_map_feature_vertex", featureId, afterVertexIndex, point })}
                  onDeleteMapFeatureVertex={(featureId, vertexIndex) => dispatchProject({ type: "delete_map_feature_vertex", featureId, vertexIndex })}
                  onMoveMapFeatureCircleRadiusHandle={(featureId, point) => dispatchProject({ type: "move_map_feature_circle_radius_handle", featureId, point })}
                  onPlacePivot={(point, wgs84) => dispatchProject({ type: "place_pivot", point, wgs84 })}
                  onMoveInfrastructurePoint={(pointType, point, wgs84) => dispatchProject({ type: "move_infrastructure", pointType, point, wgs84 })}
                  onAddSurveyPoint={(point) => dispatchProject({ type: "add_survey_point", point })}
                  onAddMapFeature={addMapFeature}
                  onCreateMapFeatureDraft={createPendingMapFeatureDraft}
                  onSelectMapFeature={setSelectedMapFeatureId}
                  onManualDesignCapture={captureManualDesignMapInput}
                  />
              </View>
              {nativeMapLibreProofEnabled ? null : (
                <RightWorkflowSidebar
                  activePage={effectiveSidebarPage}
                  compact={compactLayout}
                  onToggle={() => setRightDrawerOpen((open) => !open)}
                  open={rightDrawerOpen}
                  pages={visibleSidebarPages}
                  onPageChange={(page) => setActiveSidebarPage(page)}
                >
                  {renderRightWorkflowSidebarContent(effectiveSidebarPage)}
                </RightWorkflowSidebar>
              )}
            </WorkspaceConsoleShell>
          )}

            {activeView === "survey" && (homeMapView ? (
              <Section title="Survey Capture Readiness" icon={<Satellite size={20} color="#254234" />} testID="survey-view">
                <View style={styles.mapFeatureEditor}>
                  <Text style={styles.mapFeatureTitle}>No Project Open</Text>
                  <Text style={styles.mapFeatureMeta}>Open a saved design, sample, or blank design before capturing survey points. Catalog navigation stays separate from project geometry.</Text>
                </View>
              </Section>
            ) : (
              <Section title="Survey Capture Readiness" icon={<Satellite size={20} color="#254234" />} testID="survey-view">
                <BrowserRtkReceiverPanel
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
          ))}

          {activeView === "settings" && (
            <SettingsPanel mapPackages={runtimeProject.mapPackages ?? []} settings={settings} onChange={commitSettings} />
          )}

          {activeView === "help" && (
            <Section title="Help and Training" icon={<ListChecks size={20} color="#254234" />} testID="help-view">
              <HelpTrainingPanel
                onNavigate={setActiveView}
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
                <Text style={styles.mapFeatureMeta}>Project ZIP, GeoJSON, KML/KMZ, CSV, and map package tools become active after opening a saved design, sample, or blank design.</Text>
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
                dirty={isDirty}
                onApplyCornerGpsMapBpfImport={applyCornerGpsMapBpfImport}
                onApplyGoogleEarthKmlImport={applyGoogleEarthKmlImport}
                onDeleteProject={(projectId) => {
                  setDeletingProjectId(projectId);
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
            gpsGateLabel={`${fixTypeLabel(settings.gpsQuality.minimumFixType)} gate`}
            homeMapView={homeMapView}
            powerEvidenceStatus={powerEvidenceStatus}
            rtkStatus={rtkReceiverStatus}
            warningCount={warningCount}
          />
        </View>
      {!homeMapView && !sidebarInlineWorkflow ? (
          <DesignConsoleDialog
            activeModal={designConsoleModal}
            advisoryStatus={advisoryStatus}
            advisoryError={advisoryError}
            onRetryAdvisory={retryAdvisory}
            advisoryCostDraft={advisoryCostDraft}
            advisoryCostInput={advisoryCostInput}
            advisoryMachineRenderModel={advisoryMachineRenderModel}
            cornerArmEvaluation={cornerArmEvaluation}
            multiMachineReview={advisoryMultiMachineReview}
            editorError={editor.lastError}
            fieldPivotPlan={advisoryFieldPivotPlan}
            onActivatePrimitive={activatePrimitiveMapTool}
            onActivateTool={activateDesignConsoleTool}
            onApplyPivot={(point, wgs84) => dispatchProjectWithResult({ type: "place_pivot", point, wgs84 })}
            onCalculate={calculateDesignScenarios}
            onClose={() => setDesignConsoleModal(null)}
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
          visible={designConsoleModal !== null}
        />
      ) : null}
      {catalogDialogMode && !inlineCatalogForms ? (
        <ProjectCatalogDialog
          contextPreview={catalogDialogContextPreview(catalogDialogMode)}
          defaultName={catalogDialogDefaultName}
          mode={catalogDialogMode}
          onCancel={closeCatalogDialog}
          onCreate={submitCatalogDialog}
          submitting={catalogDialogSubmitting}
          visible
        />
      ) : null}
      {clientProfileDialogMode && !inlineCatalogForms ? (
        <ClientProfileDialog
          defaultDisplayName={`Client ${repository.catalog.clients.length + 1}`}
          initialClient={clientProfileDialogMode === "edit" ? editingClient : null}
          mode={clientProfileDialogMode}
          onCancel={closeClientProfileDialog}
          onSave={submitClientProfile}
          submitting={catalogDialogSubmitting}
          visible
        />
      ) : null}
      {renamingProject && !inlineCatalogForms ? (
        <ProjectCatalogDialog
          contextPreview={formatCatalogPath(catalogPathForProject(renamingProject.id))}
          createButtonLabel="Rename"
          defaultName={renamingProject.name}
          helper="Rename updates the local project document and catalog row without changing projected XY geometry."
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
          visible
        />
      ) : null}
      {movingProject && !inlineCatalogForms ? (
        <MoveProjectDialog
          currentClientId={movingProject.clientId}
          clients={repository.catalog.clients}
          onCancel={() => {
            if (!catalogDialogSubmitting) {
              setMovingProjectId(null);
              closeInlineCatalogForm();
            }
          }}
          onMove={(clientId) => moveProjectFolder(movingProject.id, clientId)}
          projectName={movingProject.name}
          submitting={catalogDialogSubmitting}
          visible
        />
      ) : null}
      {deletingProject && !inlineCatalogForms ? (
        <ConfirmActionDialog
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
          visible
        />
      ) : null}
      {deletingClient && !inlineCatalogForms ? (
        <ConfirmActionDialog
          confirmLabel="Delete Client"
          message={`Delete the empty client folder ${deletingClient.displayName}. This is blocked automatically if any projects remain inside it.`}
          onCancel={() => {
            if (!catalogDialogSubmitting) {
              setDeletingClientId(null);
              closeInlineCatalogForm();
            }
          }}
          onConfirm={confirmDeleteClient}
          submitting={catalogDialogSubmitting}
          testID="delete-client-dialog"
          title="Delete Client"
          visible
        />
      ) : null}
      {pendingPlacementAction ? (
        <ConfirmActionDialog
          confirmLabel={pendingPlacementAction.kind === "pivot" ? "Apply Pivot Center" : "Save Corner Arm Advisory"}
          message={pendingPlacementMessage(pendingPlacementAction)}
          onCancel={() => setPendingPlacementAction(null)}
          onConfirm={confirmPlacementAction}
          submitting={false}
          testID="placement-confirm-dialog"
          title={pendingPlacementAction.kind === "pivot" ? "Apply Advisory Pivot Center" : "Save Advisory Corner Arm"}
          visible
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
  currentLabel,
}: {
  children: React.ReactNode;
  compact: boolean;
  currentLabel: string;
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
    <View style={[styles.workspaceTopToolbar, compact && styles.workspaceTopToolbarCompact]} testID="workspace-top-toolbar">
      <View style={[styles.workspaceBreadcrumb, compact && styles.workspaceBreadcrumbCompact]} testID="workspace-breadcrumb">
        <Text numberOfLines={1} style={styles.workspaceBreadcrumbText} testID="workspace-breadcrumb-current">
          <Text style={styles.workspaceBreadcrumbRoot}>CPLayout</Text>
          <Text style={styles.workspaceBreadcrumbCurrent}> / {currentLabel}</Text>
        </Text>
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
  warningCount,
}: {
  backendLabel: string;
  dirty: boolean;
  gpsGateLabel: string;
  homeMapView: boolean;
  powerEvidenceStatus: ReturnType<typeof projectPowerLineEvidenceStatus>;
  rtkStatus: BrowserRtkReceiverStatus | null;
  warningCount: number;
}): React.JSX.Element {
  const liveRtkLabel = formatLiveRtkStatus(rtkStatus);
  const powerEvidenceIconColor = powerEvidenceStatus.status === "verified" || powerEvidenceStatus.status === "verified_exclusion"
    ? "#254234"
    : "#7a4a00";
  return (
    <View style={styles.workspaceBottomStatusBar} testID="workspace-bottom-status-bar">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bottomStatusScroll} contentContainerStyle={styles.bottomStatusContent}>
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

  return <CommandBar iconButtons={iconButtons} menus={menus} testID="workspace-command-bar" />;
}

function DesignActionHud({
  activeModal,
  activeTool,
  onActivateTool,
  onCalculate,
  onOpenModal,
  onToggleLayers,
  settings,
}: {
  activeModal: DesignConsoleModal;
  activeTool: { activeLayer: DrawingLayerType; featureKind?: ProjectMapFeatureKind; mode: DrawingMode; requestId: number } | null;
  onActivateTool: (mode: DrawingMode, activeLayer: DrawingLayerType, featureKind?: ProjectMapFeatureKind) => void;
  onCalculate: () => void;
  onOpenModal: (modal: DesignConsoleModal) => void;
  onToggleLayers: () => void;
  settings: AppSettings;
}): React.JSX.Element {
  return (
    <DrawingToolPalette
      activeModal={activeModal}
      activeTool={activeTool}
      onActivateTool={onActivateTool}
      onCalculate={onCalculate}
      onOpenModal={onOpenModal}
      onToggleLayers={onToggleLayers}
      settings={settings}
    />
  );
}

type DesignConsolePanelProps = {
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
};

function DesignConsoleDialog({
  visible,
  ...panelProps
}: DesignConsolePanelProps & { visible: boolean }): React.JSX.Element | null {
  if (!panelProps.activeModal) return null;
  return (
    <Modal animationType="fade" onRequestClose={panelProps.onClose} transparent visible={visible}>
      <View style={styles.consoleModalBackdrop} testID="design-console-dialog-backdrop">
        <DesignConsolePanel
          {...panelProps}
          testID="design-console-dialog"
        />
      </View>
    </Modal>
  );
}

function DesignConsolePanel({
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
}: DesignConsolePanelProps): React.JSX.Element | null {
  if (!activeModal) return null;
  const copy = designConsoleCopy(activeModal);
  return (
    <View accessibilityViewIsModal={testID === "design-console-dialog"} style={styles.consoleDialog} testID={testID}>
      <View style={styles.consoleDialogHeader}>
        <View style={styles.consoleIconBadge}>{copy.icon}</View>
        <View style={styles.consoleDialogTitleBlock}>
          <Text style={styles.consoleDialogTitle}>{copy.title}</Text>
          <Text style={styles.consoleDialogMeta}>{copy.meta}</Text>
        </View>
        {onClose ? (
          <Pressable accessibilityLabel="Close design console dialog" accessibilityRole="button" onPress={onClose} style={styles.consoleCloseButton} testID="design-console-close">
            <Text style={styles.consoleCloseText}>Close</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" style={styles.consoleDialogBody} contentContainerStyle={styles.consoleDialogBodyContent}>
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
            <View>
              <AdvisoryCostReviewPanel draft={advisoryCostDraft} onChange={onUpdateAdvisoryCostDraft} />
              <Pressable accessibilityRole="button" onPress={onCalculate} style={styles.calculateButton} testID="design-console-calculate">
                <Calculator size={16} color="#ffffff" />
                <Text style={styles.calculateButtonText}>Calculate Preview</Text>
              </Pressable>
            <CalculateSheet
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
  return (
    <View style={{ minHeight: 28, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 }}>
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
  const [gpsText, setGpsText] = useState(gpsDefault.value);
  const [expertOpen, setExpertOpen] = useState(false);
  const [x, setX] = useState(project.pivotCenter.x.toFixed(3));
  const [y, setY] = useState(project.pivotCenter.y.toFixed(3));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGpsText(gpsDefault.value);
    setX(project.pivotCenter.x.toFixed(3));
    setY(project.pivotCenter.y.toFixed(3));
    setError(null);
  }, [gpsDefault.value, project.pivotCenter.x, project.pivotCenter.y]);

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
  const [throwDistance, setThrowDistance] = useState(formatDistanceInputValue(machine.endGunThrowMeters, unitSystem));
  const [arcEnabled, setArcEnabled] = useState(Boolean(firstRange));
  const [startAngle, setStartAngle] = useState(firstRange ? String(firstRange.startAngleDegrees) : "0");
  const [stopAngle, setStopAngle] = useState(firstRange ? String(firstRange.stopAngleDegrees) : "120");
  const [direction, setDirection] = useState<"clockwise" | "counterclockwise">(firstRange?.direction ?? "counterclockwise");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextRange = machine.endGunAngleRanges?.[0] ?? null;
    setThrowDistance(formatDistanceInputValue(machine.endGunThrowMeters, unitSystem));
    setArcEnabled(Boolean(nextRange));
    setStartAngle(nextRange ? String(nextRange.startAngleDegrees) : "0");
    setStopAngle(nextRange ? String(nextRange.stopAngleDegrees) : "120");
    setDirection(nextRange?.direction ?? "counterclockwise");
    setError(null);
  }, [machine, unitSystem]);

  function apply(): void {
    try {
      const nextMachine: PivotMachine = {
        ...machine,
        endGunThrowMeters: requiredNonNegativeDistanceInput(throwDistance, unitSystem, "End gun throw"),
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
  const cornerArmKinematicResult = useMemo<CornerArmKinematicResult>(() => evaluateCornerArmKinematics({
    projectCrs: project.projectCrs,
    pivotCenter: project.pivotCenter,
    pivotCenterToLrduRadiusMeters: project.machine.spanLengthsMeters.reduce((sum, span) => sum + span, 0),
    lrduSpeedMetersPerMinuteAt100Percent: project.machine.driveUnits?.lrdu?.operatorMeasuredSpeedMetersPerMinute,
    modelSpec: project.machine.cornerArm ? VALLEY_CORNER_ARM_SCAFFOLD_CATALOG.find((entry) => entry.id === project.machine.cornerArm?.id) : undefined,
    rotationDirection: project.machine.sweep.mode === "partial_circle" ? project.machine.sweep.direction : "counterclockwise",
    orientation: project.machine.cornerArm?.orientation === "trailing" ? "trailing" : "leading",
    sweep: project.machine.sweep,
    fieldBoundary: project.fieldBoundary,
    obstacles: project.obstacles,
    guidancePath: cornerArmGuidancePath(project),
    endGunThrowMeters: project.machine.endGunThrowMeters,
    endGunAngleRanges: project.machine.endGunAngleRanges,
    safetyZoneMeters: settings.layoutReview.requiredBoundaryClearanceMeters,
  }), [project, settings.layoutReview.requiredBoundaryClearanceMeters]);
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
      <View style={styles.metricGrid}>
        <MetricTile label="Coverage" value={`${result.metrics.coveragePercent.toFixed(1)}%`} />
        <MetricTile label="Irrigated" value={formatAreaFromAcres(result.metrics.irrigatedAcres, settings.unitSystem)} tone="good" />
        <MetricTile label="Outside field" value={formatAreaFromAcres(result.metrics.outsideFieldAcres, settings.unitSystem)} tone={result.metrics.outsideFieldAcres > 0 ? "danger" : "good"} />
      </View>
      {editorError ? <Text style={styles.formError}>{editorError}</Text> : null}
      {advisoryCostInput ? (
        <Text style={styles.mapFeatureMeta} testID="advisory-cost-active-note">
          Cost assumptions will rank advisory candidates and machine strategies only; they are not saved as canonical geometry or vendor quotes.
        </Text>
      ) : null}
      <MachineBoundaryClearancePanel
        onUpdateLayoutReview={updateLayoutReview}
        rows={machineBoundaryClearanceRows}
        settings={settings}
      />
      <CornerArmKinematicStatusPanel
        result={cornerArmKinematicResult}
        settings={settings}
      />
      <View style={styles.placementReviewPanel} testID="advisory-strategy-cost-summary">
        <View style={styles.scenarioRowHeader}>
          <Text style={styles.rowTitle}>Machine Strategy Cost Review</Text>
          <Text style={styles.scenarioScore}>{costStatusShortLabel(strategyComparison.costInputStatus)}</Text>
        </View>
        <Text style={styles.rowMeta}>
          {bestStrategy
            ? `${bestStrategy.label} · ${formatAreaFromAcres(bestStrategy.irrigatedAcres, settings.unitSystem)} modeled · ${bestStrategy.costAssessment ? formatCostAssessment(bestStrategy.costAssessment) : "Cost efficiency pending."}`
            : "No advisory machine strategy is ready for cost comparison."}
        </Text>
        <Text style={styles.mapFeatureMeta}>Strategy cost review uses operator-supplied local assumptions only and does not create a quote, purchase recommendation, or project geometry change.</Text>
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
      <View style={styles.placementReviewPanel} testID="advisory-obstacle-interaction-summary">
        <View style={styles.scenarioRowHeader}>
          <Text style={styles.rowTitle}>Obstacle Interaction Review</Text>
          <Text style={styles.scenarioScore}>{obstacleInteractionReview.status.replaceAll("_", " ")}</Text>
        </View>
        <Text style={styles.rowMeta}>{formatObstacleInteractionSummary(obstacleInteractionReview)}</Text>
        <Text style={styles.mapFeatureMeta}>{formatFirstObstacleInteraction(obstacleInteractionReview)}</Text>
        <Text style={styles.mapFeatureMeta}>Obstacle interaction review is advisory only and does not mutate canonical projected XY, obstacle settings, utility features, or machine settings.</Text>
      </View>
      {multiMachineReview ? <View style={styles.placementReviewPanel} testID="advisory-full-scope-boundary-summary">
        <View style={styles.scenarioRowHeader}>
          <Text style={styles.rowTitle}>Full-Scope Boundary Review</Text>
          <Text style={styles.scenarioScore}>{multiMachineReview.compilation.fullScopeCoveragePercent.toFixed(1)}%</Text>
        </View>
        <Text style={styles.rowMeta}>{formatFullScopeBoundarySummary(multiMachineReview, settings)}</Text>
        <Text style={styles.mapFeatureMeta}>Compiled full-scope boundary review is advisory only and leaves canonical projected XY, field boundary, machine zones, and project storage unchanged.</Text>
      </View> : null}
      {advisoryMachineRenderModel && multiMachineReview ? <AdvisoryEvidenceStatusPanel
        advisoryMachineRenderModel={advisoryMachineRenderModel}
        multiMachineReview={multiMachineReview}
        project={project}
        result={result}
        settings={settings}
        surface="calculate"
      /> : null}
      {fieldPivotPlan && reviewZoneAudit && generatedMultiPivotScenarioReview ? <View style={styles.placementReviewPanel} testID="advisory-generated-field-pivot-plan">
        <View style={styles.scenarioRowHeader}>
          <Text style={styles.rowTitle}>Generated Field Pivot Plan</Text>
          <Text style={styles.scenarioScore}>{fieldPivotPlan.selectedMachineCount}/{fieldPivotPlan.requestedMachineCount}</Text>
        </View>
        <Text style={styles.rowMeta}>{formatGeneratedFieldPivotPlanSummary(fieldPivotPlan, settings)}</Text>
        <Text style={styles.mapFeatureMeta}>
          Generated field-pivot planning is advisory only. Save Review Zones creates projected-XY machine-zone map features for review; it does not create saved pivots, change the active pivot, or mutate canonical projected XY automatically.
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
      {advisoryDesignReport && reviewZoneAudit ? <View style={styles.placementReviewPanel} testID="advisory-design-report-panel">
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
      <ScenarioPreviewList preview={preview} settings={settings} />
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
        Radius alternatives need fixed, per-meter, and per-tower local cost assumptions before shared advisory sensitivity rows can be shown.
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
  onChange,
}: {
  draft: AdvisoryCostDraft;
  onChange: (draft: AdvisoryCostDraft) => void;
}): React.JSX.Element {
  const status = advisoryCostDraftStatus(draft);
  const statusTone = status === "complete" ? "good" : status === "invalid_cost_input" ? "danger" : "warn";

  function update(field: keyof AdvisoryCostDraft, value: string): void {
    onChange({ ...draft, [field]: field === "currencyCode" ? value.toUpperCase().slice(0, 8) : value });
  }

  function clear(): void {
    onChange(EMPTY_ADVISORY_COST_DRAFT);
  }

  return (
    <View style={styles.placementReviewPanel} testID="advisory-cost-review-panel">
      <View style={styles.scenarioRowHeader}>
        <Text style={styles.rowTitle}>Cost Review</Text>
        <Text style={styles.scenarioScore}>{costStatusShortLabel(status)}</Text>
      </View>
      <AdvisoryBadgeRow badges={["operator supplied", "advisory", "not a quote"]} />
      <View style={styles.metricGrid}>
        <MetricTile label="Cost input" value={costStatusShortLabel(status)} tone={statusTone} />
        <MetricTile label="Currency" value={draft.currencyCode.trim() || "USD"} />
        <MetricTile label="Price source" value="Local" />
      </View>
      <View style={styles.formGrid}>
        <FormField label="Fixed machine cost" onChangeText={(value) => update("fixedMachineCost", value)} testID="advisory-cost-fixed" value={draft.fixedMachineCost} />
        <FormField label="Cost per meter" onChangeText={(value) => update("costPerMeter", value)} testID="advisory-cost-per-meter" value={draft.costPerMeter} />
        <FormField label="Cost per tower" onChangeText={(value) => update("costPerTower", value)} testID="advisory-cost-per-tower" value={draft.costPerTower} />
        <FormField keyboardType="default" label="Currency" onChangeText={(value) => update("currencyCode", value)} testID="advisory-cost-currency" value={draft.currencyCode} />
      </View>
      <View style={styles.inlineActions}>
        <SmallActionButton label="Clear Cost Input" onPress={clear} testID="advisory-cost-clear" />
      </View>
      <Text style={status === "invalid_cost_input" ? styles.formError : styles.mapFeatureMeta} testID="advisory-cost-status">
        {advisoryCostDraftMessage(draft, status)}
      </Text>
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
  const [activeStep, setActiveStep] = useState<Exclude<ManualDesignStep, "apply">>("boundary");
  const [draft, setDraft] = useState<ManualDesignDraft>(() => createManualDesignDraft(project, projectRevision));
  const [spanRows, setSpanRows] = useState(() => project.machine.spanLengthsMeters.map((span) => formatDistanceInputValue(span, unitSystem)));
  const [overhang, setOverhang] = useState(() => formatDistanceInputValue(project.machine.overhangMeters, unitSystem));
  const [endGunThrow, setEndGunThrow] = useState(() => formatDistanceInputValue(project.machine.endGunThrowMeters, unitSystem));
  const [status, setStatus] = useState("Preview only. Apply creates one project revision and one undo entry.");
  const readiness = useMemo(() => evaluateManualDesignReadiness(draft), [draft]);
  const pathSummary = draft.machine ? buildMachinePathSummary(draft.machine.value) : null;
  const radiusMeasurementFeatures = (project.mapFeatures ?? []).filter((feature) => feature.kind === "measurement_line" && feature.geometry.type === "LineString");
  const stale = draft.baseRevision !== projectRevision;

  useEffect(() => {
    resetFromProject();
    // Project identity and unit changes require a new session-only draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, unitSystem]);

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
          {sourceOptions.some((option) => option.id === "rtk_evidence") ? <SmallActionButton label="Open Receiver" onPress={onOpenRtk} /> : null}
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
  return (
    <View style={styles.placementReviewPanel} testID={`advisory-evidence-status-${surface}`}>
      <View style={styles.scenarioRowHeader}>
        <View style={styles.rowTitleWithIcon}>
          <Monitor size={16} color="#254234" />
          <Text style={styles.rowTitle}>{title}</Text>
        </View>
        <Text style={powerEvidence.status === "missing" ? styles.scenarioScoreWarn : styles.scenarioScore}>{powerEvidence.status.replaceAll("_", " ")}</Text>
      </View>
      <View style={styles.metricGrid}>
        <MetricTile label="Field boundary" value={formatAreaFromAcres(result.metrics.fieldAcres, settings.unitSystem)} />
        <MetricTile label="Design area" value={compiled ? formatAreaFromAcres(compiled.compiledBoundaryAcres, settings.unitSystem) : "pending"} tone={compiled ? "neutral" : "warn"} />
        <MetricTile label="Machine zones" value={`${machineZoneCount}`} tone={machineZoneCount > 0 ? "neutral" : "warn"} />
        <MetricTile label="Preferred outlines" value={`${preferredOutlineCount}`} tone={preferredOutlineCount > 0 ? "neutral" : "warn"} />
        <MetricTile label="Render machines" value={`${advisoryMachineRenderModel?.instances.length ?? 0}`} tone={(advisoryMachineRenderModel?.instances.length ?? 0) === 2 ? "good" : "warn"} />
        <MetricTile label="Planning boundaries" value={`${planningBoundaryCount}`} />
        <MetricTile label="Standard pivot" value={formatAreaFromAcres(renderLedger?.standardPivotAcres ?? result.metrics.standardPivotAcres ?? Math.max(0, result.metrics.irrigatedAcres - result.metrics.endGunAcres), settings.unitSystem)} />
        <MetricTile label="End gun" value={formatAreaFromAcres(renderLedger?.endGunAcres ?? result.metrics.endGunAcres, settings.unitSystem)} />
        <MetricTile label="Corner arm" value={formatAreaFromAcres(renderLedger?.cornerArmAcres ?? result.metrics.cornerArmAcres ?? 0, settings.unitSystem)} />
        <MetricTile label="De-duped total" value={formatAreaFromAcres(renderDeduplicatedAcres, settings.unitSystem)} />
        <MetricTile label="Overlap" value={formatAreaFromAcres(overlapAcres, settings.unitSystem)} tone={overlapAcres > 0 ? "warn" : "good"} />
        <MetricTile label="Outside field" value={formatAreaFromAcres(outsideFieldAcres, settings.unitSystem)} tone={outsideFieldAcres > 0 ? "danger" : "good"} />
        <MetricTile label="Outside full scope" value={formatAreaFromAcres(outsideFullScopeAcres, settings.unitSystem)} tone={outsideFullScopeAcres > 0 ? "danger" : "good"} />
        <MetricTile label="Blocked acres" value={formatAreaFromAcres(verifiedBlockedAcres, settings.unitSystem)} tone={verifiedBlockedAcres > 0 ? "warn" : "good"} />
        <MetricTile label="Power evidence" value={powerEvidence.status.replaceAll("_", " ")} tone={powerEvidence.status === "missing" ? "warn" : "good"} />
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

function PivotCoordinateForm({ onApply, point }: { onApply: (point: XY) => boolean; point: XY }): React.JSX.Element {
  const [x, setX] = useState(point.x.toFixed(3));
  const [y, setY] = useState(point.y.toFixed(3));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setX(point.x.toFixed(3));
    setY(point.y.toFixed(3));
  }, [point.x, point.y]);

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
  const [text, setText] = useState(formatXyLines(vertices));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(formatXyLines(vertices));
  }, [vertices]);

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

function ScenarioPreviewList({ preview, settings }: { preview: DesignScenarioPreview[] | null; settings: AppSettings }): React.JSX.Element {
  if (!preview) {
    return <Text style={styles.mapFeatureMeta}>Scenario metrics update only after Calculate.</Text>;
  }
  return (
    <View style={styles.scenarioList} testID="design-builder-scenarios">
      {preview.map((scenario) => (
        <View key={scenario.id} style={[styles.scenarioRow, scenario.feasible ? styles.scenarioRowFeasible : styles.scenarioRowRejected]}>
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
    <View style={styles.placementReviewPanel} testID="machine-boundary-clearance-panel">
      <View style={styles.scenarioRowHeader}>
        <Text style={styles.rowTitle}>Machine Boundary Distances</Text>
        <Text style={styles.scenarioScore}>{failingCount > 0 ? `${failingCount} check` : "Ready"}</Text>
      </View>
      <View style={styles.metricGrid}>
        <MetricTile
          label="Shortest"
          testID="machine-boundary-shortest"
          tone={shortest && !shortest.meetsRequiredBoundaryClearance ? "danger" : "good"}
          value={shortest ? formatDistance(shortest.minimumBoundaryDistanceMeters, settings.unitSystem) : "n/a"}
        />
        <MetricTile
          label="Required"
          testID="machine-boundary-required"
          value={formatDistance(required, settings.unitSystem)}
        />
        <MetricTile
          label="Rows"
          value={`${rows.length}`}
        />
      </View>
      <View style={styles.controlRow}>
        <ActionButton
          label={settings.layoutReview.showMachineBoundaryDistances ? "Rows shown" : "Rows hidden"}
          selected={settings.layoutReview.showMachineBoundaryDistances}
          onPress={() => onUpdateLayoutReview({ showMachineBoundaryDistances: !settings.layoutReview.showMachineBoundaryDistances })}
        />
        <SmallActionButton
          disabled={required <= 0}
          label="Clearance -"
          onPress={() => onUpdateLayoutReview({ requiredBoundaryClearanceMeters: Math.max(0, required - stepMeters) })}
          testID="machine-boundary-clearance-decrease"
        />
        <SmallActionButton
          label="Clearance +"
          onPress={() => onUpdateLayoutReview({ requiredBoundaryClearanceMeters: required + stepMeters })}
          testID="machine-boundary-clearance-increase"
        />
      </View>
      {settings.layoutReview.showMachineBoundaryDistances ? (
        <View style={styles.placementCandidateList} testID="machine-boundary-clearance-rows">
          {rows.map((row) => (
            <View key={`${row.kind}-${row.towerIndex ?? row.radiusMeters}`} style={[styles.placementCandidateRow, row.meetsRequiredBoundaryClearance ? styles.scenarioRowFeasible : styles.scenarioRowRejected]} testID={`machine-boundary-row-${row.kind}`}>
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
    <View style={styles.placementReviewPanel} testID="corner-arm-kinematics-panel">
      <View style={styles.scenarioRowHeader}>
        <Text style={styles.rowTitle}>Corner-Arm Kinematics</Text>
        <Text style={result.status === "ready" ? styles.scenarioScore : styles.scenarioScoreWarn}>{result.status === "unresolved" ? "Unresolved" : result.status === "ready" ? "Ready" : `${blockerCount} blockers`}</Text>
      </View>
      <AdvisoryBadgeRow badges={["projected XY", "advisory", result.scaffoldSourceStatus.replaceAll("_", " "), "no controller proof"]} />
      <View style={styles.metricGrid}>
        <MetricTile label="LRDU path" value={`${result.lrduPath.length}`} tone={result.lrduPath.length > 0 ? "neutral" : "warn"} />
        <MetricTile label="SDU path" value={`${result.sduPath.length}`} tone={result.sduPath.length > 0 ? "neutral" : "warn"} />
        <MetricTile label="Endpoint path" value={`${result.overhangEndpointPath.length}`} tone={result.overhangEndpointPath.length > 0 ? "neutral" : "warn"} />
        <MetricTile label="Safety zone" value={formatDistance(result.safetyZoneMeters, settings.unitSystem)} tone="neutral" />
        <MetricTile label="Sampled sweep" value={formatAreaFromAcres(result.sweptPhysicalEnvelopeAcres, settings.unitSystem)} tone="neutral" />
        <MetricTile label="Wetted/endgun" value={formatAreaFromAcres(result.wettedEndGunEnvelopeAcres, settings.unitSystem)} tone="neutral" />
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
      <View style={styles.placementReviewPanel} testID="ideal-center-summary">
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
    <View style={styles.placementReviewPanel} testID="ideal-center-summary">
      <View style={styles.scenarioRowHeader}>
        <Text style={styles.rowTitle}>Ideal Center Analysis</Text>
        <Text style={styles.scenarioScore}>{analysis.status.replaceAll("_", " ")}</Text>
      </View>
      <AdvisoryBadgeRow badges={["advisory", "projected XY", "inside boundary", "qualified review required"]} />
      {best ? (
        <>
          <View style={styles.metricGrid}>
            <MetricTile label="Best score" value={best.score.toFixed(1)} tone="good" />
            <MetricTile label="Boundary clearance" value={formatDistance(best.boundaryClearanceMeters, settings.unitSystem)} tone={best.boundaryClearanceMeters >= 0 ? "good" : "danger"} />
            <MetricTile label="Move from current" value={formatDistance(best.distanceFromCurrentMeters, settings.unitSystem)} />
            <MetricTile label="Cost input" value={costAssessmentLabel(best.costAssessment)} tone={best.costAssessment.status === "complete" ? "neutral" : "warn"} />
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
    <View style={styles.placementReviewPanel} testID="placement-review-panel">
      <View style={styles.scenarioRowHeader}>
        <Text style={styles.rowTitle}>Placement Review</Text>
        <Text style={styles.scenarioScore}>{analysis ? analysis.status.replaceAll("_", " ") : "0"}</Text>
      </View>
      <AdvisoryBadgeRow badges={["advisory", "source-backed", "qualified review required"]} />
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

function cornerArmGuidancePath(project: PivotProject): XY[] | undefined {
  const guidanceFeature = (project.mapFeatures ?? []).find((feature) => (
    feature.kind === "linear_move_path"
    && feature.geometry.type === "LineString"
    && feature.geometry.vertices.length >= 2
  ));
  return guidanceFeature?.geometry.type === "LineString" ? guidanceFeature.geometry.vertices : undefined;
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

function advisoryCostInputFromDraft(draft: AdvisoryCostDraft): AdvisoryCostInput | undefined {
  if (!advisoryCostDraftHasAnyValue(draft)) return undefined;
  return {
    fixedMachineCost: optionalDraftCostNumber(draft.fixedMachineCost),
    costPerMeter: optionalDraftCostNumber(draft.costPerMeter),
    costPerTower: optionalDraftCostNumber(draft.costPerTower),
    currencyCode: draft.currencyCode.trim() || "USD",
    notes: "Operator-supplied local advisory cost assumptions; not a vendor quote.",
  };
}

function advisoryCostDraftStatus(draft: AdvisoryCostDraft): AdvisoryCostAssessment["status"] {
  if (!advisoryCostDraftHasAnyValue(draft)) return "missing_cost_input";
  const values = [
    optionalDraftCostNumber(draft.fixedMachineCost),
    optionalDraftCostNumber(draft.costPerMeter),
    optionalDraftCostNumber(draft.costPerTower),
  ].map((value) => value ?? 0);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return "invalid_cost_input";
  return values.reduce((sum, value) => sum + value, 0) > 0 ? "complete" : "invalid_cost_input";
}

function advisoryCostDraftReadyForRadiusSensitivity(draft: AdvisoryCostDraft): boolean {
  return [draft.fixedMachineCost, draft.costPerMeter, draft.costPerTower]
    .map((value) => optionalDraftCostNumber(value))
    .every((value) => value !== undefined && Number.isFinite(value) && value >= 0);
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

function advisoryCostDraftMessage(draft: AdvisoryCostDraft, status: AdvisoryCostAssessment["status"]): string {
  if (status === "missing_cost_input") {
    return "Enter local cost assumptions to rank advisory candidates; CPLayout will not infer machine prices.";
  }
  if (status === "invalid_cost_input") {
    return "Cost assumptions must be finite, nonnegative numbers with at least one value above zero.";
  }
  const input = advisoryCostInputFromDraft(draft);
  const fixed = input?.fixedMachineCost ?? 0;
  const perMeter = input?.costPerMeter ?? 0;
  const perTower = input?.costPerTower ?? 0;
  return `${input?.currencyCode ?? "USD"} assumptions: fixed ${fixed.toFixed(0)} · per meter ${perMeter.toFixed(0)} · per tower ${perTower.toFixed(0)}.`;
}

function advisoryCostDraftHasAnyValue(draft: AdvisoryCostDraft): boolean {
  return draft.fixedMachineCost.trim().length > 0
    || draft.costPerMeter.trim().length > 0
    || draft.costPerTower.trim().length > 0;
}

function optionalDraftCostNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return Number(trimmed);
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
  catalog,
  notice,
  onCreateClient,
  onStartBlankDesign,
  repository,
  settings,
}: {
  catalog: ProjectWorkspaceStatus["catalog"];
  notice: string | null;
  onCreateClient: () => void;
  onStartBlankDesign: () => void;
  repository: ProjectWorkspaceStatus;
  settings: AppSettings;
}): React.JSX.Element {
  const hasCatalogRecords = catalog.clients.length > 0 || catalog.projects.length > 0 || catalog.fieldMaps.length > 0 || catalog.designs.length > 0;
  const storageLabel = repository.backendInfo?.backendLabel ?? repository.backendLabel;
  const nextAction = hasCatalogRecords ? "Open design" : "Add client";
  const imageryState = settings.onlineImagery.enabled ? "No-key preview" : "Off";

  return (
    <>
      <Text style={styles.sectionTitle}>Catalog Home</Text>
      <View style={styles.metricGrid} testID="catalog-home-readiness">
        <MetricTile label="Storage" value={storageLabel} />
        <MetricTile label="Active context" value="Catalog" />
        <MetricTile label="Next action" value={nextAction} tone={hasCatalogRecords ? "neutral" : "warn"} />
        <MetricTile label="Imagery" value={imageryState} tone={settings.onlineImagery.enabled ? "neutral" : "good"} />
      </View>
      <View style={styles.mapFeatureEditor} testID="catalog-home-status">
        <Text style={styles.mapFeatureTitle}>{storageLabel}</Text>
        <Text style={styles.mapFeatureMeta}>
          {repository.statusMessage} · {settings.onlineImagery.enabled ? "USGS live reference is enabled with attribution on the map." : "No external imagery is requested."}
        </Text>
      </View>
      {notice ? (
        <View style={styles.warningItem} testID="catalog-notice">
          <AlertTriangle size={17} color="#9a4c1c" />
          <Text style={styles.warningText}>{notice}</Text>
        </View>
      ) : null}
      <View style={styles.inlineActions}>
        <SmallActionButton label="Add Client" onPress={onCreateClient} />
        <SmallActionButton label="Start Blank Design" onPress={onStartBlankDesign} />
      </View>
      <View style={styles.warningItem}>
        <MapPinned size={17} color="#9a4c1c" />
        <Text style={styles.warningText}>Use Start Blank Design or open a saved design from the tree to enable drawing. Catalog maps are navigation-only.</Text>
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
          <Text style={styles.mapFeatureMeta}>{projects.length} project{projects.length === 1 ? "" : "s"} in this client folder</Text>
        </View>
      </View>

      <View style={styles.inlineActions}>
        <SmallActionButton label="Edit Client" onPress={() => onEditClient(client.id)} />
        <SmallActionButton disabled={!canDeleteClient} label="Delete Client" onPress={() => onDeleteClient(client.id)} />
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
          <Text style={styles.dashboardMuted}>No projects in this client folder.</Text>
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
                <Text style={styles.rowMeta}>{fieldMaps.length} field map{fieldMaps.length === 1 ? "" : "s"} · {projectRecord.projectCrs} · {projectRecord.unitSystem.replaceAll("_", " ")}</Text>
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
  const hasGuidancePath = Boolean(cornerArmGuidancePath(project));
  const missingInputs = [
    hasMeasuredLrduSpeed ? null : "Measured LRDU speed at 100% timer",
    hasSourceLabeledCornerArmModel ? null : "Source-labeled corner-arm model/config",
    hasSelectedOrientation ? null : "Operator-selected leading/trailing orientation and rotation context",
    hasGuidancePath ? null : "Projected-XY SDU guidance path saved as linear_move_path",
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
        <MetricTile label="Guidance path" value={hasGuidancePath ? "linear_move_path" : "Missing"} tone={hasGuidancePath ? "good" : "warn"} />
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
      boundary: "Samples and blank designs remain unsaved until a save succeeds. Local progress stays outside project ZIPs.",
      checkpoints: [],
      detail: "Use the catalog, then move into Map for layout work.",
      icon: <Home size={18} color="#254234" />,
      route: "map",
      routeLabel: "Go to Map",
      testID: "help-module-start",
      title: "Start",
    },
    {
      boundary: "Polygon, Path, Placemark, and Ruler labels map to CPLayout projected-XY tools; viewport pan/zoom state is separate.",
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
  const merged = mergeAppSettings(settings);
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
  return mode === "design" ? "Design" : "Layout RTK";
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
  testID,
}: {
  children: React.ReactNode;
  compact: boolean;
  rightDrawerOpen: boolean;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={[styles.consoleShell, compact && styles.consoleShellCompact, !rightDrawerOpen && styles.consoleShellRightCollapsed]} testID={testID}>
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
  activePurposeForm,
  activeToolForm,
  homeView,
  mappingWorkflowMode,
  selectedMapFeature,
  warningCount,
}: {
  activeCatalogForm: boolean;
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
      ...(activeCatalogForm ? [{ id: "catalogForm" as const, label: "Form", shortLabel: "FORM" }] : []),
    ];
  }
  return [
    { id: "overview", label: "Overview", shortLabel: "MAP" },
    ...(activeCatalogForm ? [{ id: "catalogForm" as const, label: "Form", shortLabel: "FORM" }] : []),
    ...(mappingWorkflowMode === "design" ? [{ id: "tools" as const, label: "Tools", shortLabel: "TOOL" }] : []),
    ...(mappingWorkflowMode === "design" && activePurposeForm ? [{ id: "purpose" as const, label: "Form", shortLabel: "FORM" }] : []),
    ...(mappingWorkflowMode === "design" && activeToolForm ? [{ id: "toolForm" as const, label: "Form", shortLabel: "FORM" }] : []),
    { id: "layers", label: "Layers", shortLabel: "LAY" },
    { id: "rtk", label: "RTK", shortLabel: "RTK" },
    ...(selectedMapFeature ? [{ id: "feature" as const, label: "Feature", shortLabel: "FEAT" }] : []),
    { id: "warnings", label: "Warnings", shortLabel: "WARN", count: warningCount },
  ];
}

function RightWorkflowSidebar({
  activePage,
  children,
  compact,
  onPageChange,
  onToggle,
  open,
  pages,
}: {
  activePage: RightWorkflowSidebarPage;
  children: React.ReactNode;
  compact: boolean;
  onPageChange: (page: RightWorkflowSidebarPage) => void;
  onToggle: () => void;
  open: boolean;
  pages: RightWorkflowSidebarTab[];
}): React.JSX.Element {
  const activePageLabel = pages.find((page) => page.id === activePage)?.shortLabel ?? "MAP";
  return (
    <View style={[
      styles.inspectorDrawer,
      compact && styles.inspectorDrawerCompact,
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
          <View style={styles.inspectorTabs} testID="workflow-sidebar-tabs">
            {pages.map((page) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: activePage === page.id }}
                aria-selected={activePage === page.id}
                key={page.id}
                onPress={() => onPageChange(page.id)}
                style={[styles.inspectorTab, activePage === page.id && styles.inspectorTabActive]}
                testID={`workflow-sidebar-tab-${page.id}`}
              >
                <Text style={[styles.inspectorTabText, activePage === page.id && styles.inspectorTabTextActive]}>
                  {page.count && page.count > 0 ? `${page.label} ${page.count}` : page.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <ScrollView style={styles.inspectorScroll} contentContainerStyle={styles.inspectorContent} testID="inspector-scroll">
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
  compact,
  consoleMode,
  drawerOpen,
  menuDefinition,
  onCreateClient,
  onCreateDesign,
  onCreateFieldMap,
  onCreateProject,
  onNavigate,
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
  compact: boolean;
  consoleMode: boolean;
  drawerOpen: boolean;
  menuDefinition: CplayoutLeftNavMenuDefinition;
  onCreateClient: () => void | Promise<void>;
  onCreateDesign: () => void | Promise<void>;
  onCreateFieldMap: () => void | Promise<void>;
  onCreateProject: () => void | Promise<void>;
  onNavigate: (view: WorkspaceView) => void;
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
  const tree = buildProjectTreeViewModel(catalog, activeContext);
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
    return createActions.find((item) => !catalogActionDisabled(item)) ?? createActions[0]!;
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
    <View style={[styles.leftRail, compact && !consoleMode && styles.leftRailCompact, consoleMode && styles.leftRailConsole, consoleMode && !drawerOpen && styles.leftRailConsoleCollapsed]} testID="workspace-rail">
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
              label="New"
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
          <ScrollView style={[styles.projectTreeScroll, compact && styles.projectTreeScrollCompact]} contentContainerStyle={styles.projectTreeContent} testID="project-tree-scroll">
            {catalog.clients.length === 0 ? (
              <Text style={styles.projectTreeEmpty}>No client folders yet.</Text>
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
                    onOpen={() => onSelectClient(client.id)}
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
                                {fieldMap.designs.length > 0 ? <Text style={styles.projectTreeSectionLabel}>Design Files</Text> : null}
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
    </View>
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
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      aria-selected={active}
      onPress={onSelect}
      style={[styles.projectTreeNode, active && styles.projectTreeNodeActive, { paddingLeft: 8 + depth * 12 }]}
      testID={testID}
      {...webDoubleClickProps(onOpen)}
    >
      {icon}
      <View style={styles.projectTreeNodeText}>
        <Text style={[styles.projectTreeNodeLabel, active && styles.projectTreeNodeLabelActive]} numberOfLines={1}>{label}</Text>
        <Text style={styles.projectTreeNodeMeta} numberOfLines={1}>{meta}</Text>
      </View>
    </Pressable>
  );
}

function webDoubleClickProps(onDoubleClick: () => void | Promise<void>): Record<string, unknown> {
  if (Platform.OS !== "web") return {};
  return {
    onDoubleClick: (event: React.MouseEvent) => {
      event.preventDefault();
      void onDoubleClick();
    },
  };
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

function PendingDraftPurposePanel({
  draft,
  onCancel,
  onSave,
  unitSystem,
}: {
  draft: PendingMapFeatureDraft | null;
  onCancel: () => void;
  onSave: (option: MapDraftPurposeOption) => void;
  unitSystem: PivotProject["unitSystem"];
}): React.JSX.Element {
  if (!draft) {
    return (
      <View style={styles.mapFeatureEditor}>
        <Text style={styles.mapFeatureTitle}>No Pending Draft</Text>
        <Text style={styles.mapFeatureMeta}>Draw a point, line, polygon, or circle before choosing a purpose.</Text>
      </View>
    );
  }
  const options = draftPurposeOptions(draft.geometryType);
  return (
    <View style={styles.mapFeatureEditor} testID="pending-draft-purpose-panel">
      <View>
        <Text style={styles.mapFeatureTitle}>What did you draw?</Text>
        <Text style={styles.mapFeatureMeta}>{draftGeometrySummary(draft, unitSystem)}</Text>
        {draft.notes ? <Text style={styles.mapFeatureMeta}>{draft.notes}</Text> : null}
      </View>
      <View style={styles.consoleChoiceGrid}>
        {options.map((option) => (
          <ConsoleChoiceButton
            key={`${option.purposeType}-${option.kind}`}
            label={option.label}
            meta={option.meta}
            onPress={() => onSave(option)}
          />
        ))}
      </View>
      <View style={styles.inlineActions}>
        <SmallActionButton label="Cancel Draft" onPress={onCancel} testID="pending-draft-cancel" />
      </View>
    </View>
  );
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
    { purposeType: "map_feature", kind: "planning_boundary", label: "Planning Boundary", geometry: "Polygon", meta: mapFeaturePurposeMeta("planning_boundary") },
    { purposeType: "map_feature", kind: "machine_zone", label: "Machine Zone", geometry: "Polygon", meta: mapFeaturePurposeMeta("machine_zone") },
    { purposeType: "obstacle", kind: "exclusion", label: "Obstacle / No-Spray", geometry: "Polygon", meta: "Commit a no-spray obstacle polygon with projected-XY vertices." },
    { purposeType: "obstacle", kind: "building", label: "Building", geometry: "Polygon", meta: "Commit a building obstacle footprint for layout review." },
    { purposeType: "map_feature", kind: "corner_swing_limit", label: "Corner-Arm Footprint", geometry: "Polygon", meta: mapFeaturePurposeMeta("corner_swing_limit") },
  ];
}

function mapFeaturePurposeMeta(kind: ProjectMapFeatureKind): string {
  switch (kind) {
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

function draftGeometrySummary(draft: PendingMapFeatureDraft, unitSystem: PivotProject["unitSystem"]): string {
  if (draft.geometryType === "Point") return "Point · 1 projected XY vertex";
  if (draft.geometryType === "LineString") return `Line · ${draft.vertices.length} vertices · ${formatDistance(polylineLengthMeters(draft.vertices), unitSystem)}`;
  if (draft.geometryType === "Polygon") return `Polygon · ${draft.vertices.length} vertices`;
  const [center, radiusPoint] = draft.vertices;
  const radiusMeters = center && radiusPoint ? Math.hypot(radiusPoint.x - center.x, radiusPoint.y - center.y) : 0;
  return `Circle · ${formatDistance(radiusMeters, unitSystem)} radius`;
}

function polylineLengthMeters(vertices: XY[]): number {
  return vertices.slice(1).reduce((sum, vertex, index) => sum + Math.hypot(vertex.x - vertices[index].x, vertex.y - vertices[index].y), 0);
}

function MapFeatureEditor({
  feature,
  onDelete,
  onRename,
  onUpdate,
}: {
  feature: ProjectMapFeature | null;
  onDelete: (featureId: string) => void;
  onRename: (feature: ProjectMapFeature, name: string) => void;
  onUpdate: (feature: ProjectMapFeature) => void;
}): React.JSX.Element {
  const [name, setName] = useState(feature?.name ?? "");

  useEffect(() => {
    setName(feature?.name ?? "");
  }, [feature?.id, feature?.name]);

  if (!feature) {
    return (
      <View style={styles.mapFeatureEditor}>
        <Text style={styles.mapFeatureTitle}>Map Feature</Text>
        <Text style={styles.mapFeatureMeta}>Select a utility feature on the map to rename or delete it.</Text>
      </View>
    );
  }

  const geometryLabel = mapFeatureGeometryLabel(feature);

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
          point={feature.geometry.point}
        />
      ) : feature.geometry.type === "Circle" ? (
        <CircleFeatureEditor feature={{ ...feature, geometry: feature.geometry }} onUpdate={onUpdate} />
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

function CircleFeatureEditor({ feature, onUpdate }: { feature: ProjectMapFeature & { geometry: { type: "Circle"; center: XY; radiusMeters: number } }; onUpdate: (feature: ProjectMapFeature) => void }): React.JSX.Element {
  const [radius, setRadius] = useState(String(roundCoordinate(feature.geometry.radiusMeters)));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRadius(String(roundCoordinate(feature.geometry.radiusMeters)));
  }, [feature.geometry.radiusMeters]);

  function applyRadius(): void {
    try {
      const radiusMeters = requiredPositiveNumber(radius, "Circle radius");
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
        point={feature.geometry.center}
      />
      <View style={styles.formGrid}>
        <FormField label="Radius (m)" value={radius} onChangeText={setRadius} />
      </View>
      <View style={styles.inlineActions}>
        <SmallActionButton label="Apply Radius" onPress={applyRadius} />
      </View>
    </View>
  );
}

function mapFeatureGeometryLabel(feature: ProjectMapFeature): string {
  if (feature.geometry.type === "Point") return "Point";
  if (feature.geometry.type === "LineString") return `${feature.geometry.vertices.length} point line`;
  if (feature.geometry.type === "Polygon") return `${feature.geometry.vertices.length} point polygon`;
  return `Circle · ${formatDistance(feature.geometry.radiusMeters, "metric")} radius`;
}

function MachineSettingsForm({ machine, onChange, unitSystem }: { machine: PivotMachine; onChange: (machine: PivotMachine) => void; unitSystem: PivotProject["unitSystem"] }): React.JSX.Element {
  const [spanRows, setSpanRows] = useState(machine.spanLengthsMeters.map((span) => formatDistanceInputValue(span, unitSystem)));
  const [overhang, setOverhang] = useState(formatDistanceInputValue(machine.overhangMeters, unitSystem));
  const [towerClearance, setTowerClearance] = useState(formatDistanceInputValue(machine.towerClearanceBufferMeters, unitSystem));
  const [machineClearance, setMachineClearance] = useState(formatDistanceInputValue(machine.machineClearanceBufferMeters, unitSystem));
  const [startAngle, setStartAngle] = useState(machine.sweep.mode === "partial_circle" ? String(machine.sweep.startAngleDegrees) : "210");
  const [stopAngle, setStopAngle] = useState(machine.sweep.mode === "partial_circle" ? String(machine.sweep.stopAngleDegrees) : "35");
  const [direction, setDirection] = useState<"clockwise" | "counterclockwise">(machine.sweep.mode === "partial_circle" ? machine.sweep.direction : "counterclockwise");
  const [mode, setMode] = useState<PivotSweep["mode"]>(machine.sweep.mode);
  const [lrduTireId, setLrduTireId] = useState(machine.driveUnits?.lrdu?.tire?.id ?? "valley-public-custom-required");
  const [sduTireId, setSduTireId] = useState(machine.driveUnits?.sdu?.tire?.id ?? "valley-public-custom-required");
  const [lrduRpm, setLrduRpm] = useState(machine.driveUnits?.lrdu?.customMotorRpm !== undefined ? String(machine.driveUnits.lrdu.customMotorRpm) : "");
  const [sduRpm, setSduRpm] = useState(machine.driveUnits?.sdu?.customMotorRpm !== undefined ? String(machine.driveUnits.sdu.customMotorRpm) : "");
  const [operatorSpeed, setOperatorSpeed] = useState(machine.driveUnits?.lrdu?.operatorMeasuredSpeedMetersPerMinute !== undefined ? String(machine.driveUnits.lrdu.operatorMeasuredSpeedMetersPerMinute) : "");
  const [sduOperatorSpeed, setSduOperatorSpeed] = useState(machine.driveUnits?.sdu?.operatorMeasuredSpeedMetersPerMinute !== undefined ? String(machine.driveUnits.sdu.operatorMeasuredSpeedMetersPerMinute) : "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSpanRows(machine.spanLengthsMeters.map((span) => formatDistanceInputValue(span, unitSystem)));
    setOverhang(formatDistanceInputValue(machine.overhangMeters, unitSystem));
    setTowerClearance(formatDistanceInputValue(machine.towerClearanceBufferMeters, unitSystem));
    setMachineClearance(formatDistanceInputValue(machine.machineClearanceBufferMeters, unitSystem));
    setLrduTireId(machine.driveUnits?.lrdu?.tire?.id ?? "valley-public-custom-required");
    setSduTireId(machine.driveUnits?.sdu?.tire?.id ?? "valley-public-custom-required");
    setLrduRpm(machine.driveUnits?.lrdu?.customMotorRpm !== undefined ? String(machine.driveUnits.lrdu.customMotorRpm) : "");
    setSduRpm(machine.driveUnits?.sdu?.customMotorRpm !== undefined ? String(machine.driveUnits.sdu.customMotorRpm) : "");
    setOperatorSpeed(machine.driveUnits?.lrdu?.operatorMeasuredSpeedMetersPerMinute !== undefined ? String(machine.driveUnits.lrdu.operatorMeasuredSpeedMetersPerMinute) : "");
    setSduOperatorSpeed(machine.driveUnits?.sdu?.operatorMeasuredSpeedMetersPerMinute !== undefined ? String(machine.driveUnits.sdu.operatorMeasuredSpeedMetersPerMinute) : "");
    setMode(machine.sweep.mode);
    if (machine.sweep.mode === "partial_circle") {
      setStartAngle(String(machine.sweep.startAngleDegrees));
      setStopAngle(String(machine.sweep.stopAngleDegrees));
      setDirection(machine.sweep.direction);
    }
  }, [machine, unitSystem]);

  function apply(): void {
    try {
      const spanValues = spanRows.map((value, index) => requiredPositiveDistanceInput(value.trim(), unitSystem, `Span ${index + 1}`));
      const nextMachine: PivotMachine = {
        ...machine,
        spanLengthsMeters: spanValues,
        overhangMeters: requiredNonNegativeDistanceInput(overhang, unitSystem, "Overhang"),
        towerClearanceBufferMeters: requiredNonNegativeDistanceInput(towerClearance, unitSystem, "Tower clearance"),
        machineClearanceBufferMeters: requiredNonNegativeDistanceInput(machineClearance, unitSystem, "Machine clearance"),
        sweep: mode === "full_circle"
          ? { mode: "full_circle" }
          : {
            mode: "partial_circle",
            startAngleDegrees: requiredFiniteNumber(startAngle, "Start angle"),
            stopAngleDegrees: requiredFiniteNumber(stopAngle, "Stop angle"),
            direction,
          },
        driveUnits: {
          lrdu: driveUnitConfig("lrdu", lrduTireId, lrduRpm, operatorSpeed),
          sdu: driveUnitConfig("sdu", sduTireId, sduRpm, sduOperatorSpeed),
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
          <FormField label="LRDU measured speed (m/min)" value={operatorSpeed} onChangeText={setOperatorSpeed} />
          <FormField label="SDU measured speed (m/min)" value={sduOperatorSpeed} onChangeText={setSduOperatorSpeed} />
        </View>
        <Text style={styles.mapFeatureMeta}>
          Tire options are public source labels. RPM fields require operator or curated manual evidence; blank RPM stays unverified/source required. {selectedLrduTire?.sourceRefs[0]?.sourceId ?? "LRDU source required"} · {selectedSduTire?.sourceRefs[0]?.sourceId ?? "SDU source required"}.
        </Text>
      </View>
    </View>
  );
}

function driveUnitConfig(
  role: AdvisoryDriveUnitConfig["role"],
  tireId: string,
  rpmInput: string,
  speedInput = "",
): AdvisoryDriveUnitConfig {
  const tire = ADVISORY_DRIVE_UNIT_TIRE_OPTIONS.find((option) => option.id === tireId);
  const customMotorRpm = rpmInput.trim() ? requiredFiniteNumber(rpmInput, `${role.toUpperCase()} motor RPM`) : undefined;
  if (customMotorRpm !== undefined && customMotorRpm <= 0) throw new Error(`${role.toUpperCase()} motor RPM must be greater than zero.`);
  const operatorMeasuredSpeedMetersPerMinute = speedInput.trim() ? requiredPositiveDistanceInput(speedInput, "metric", "Measured speed") : undefined;
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
  workspaceBreadcrumb: {
    flex: 1,
    minWidth: 0,
  },
  workspaceBreadcrumbCompact: {
    flexBasis: 118,
    flexGrow: 0,
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
  leftRailConsoleCollapsed: {
    alignItems: "center",
    paddingHorizontal: 4,
    width: 64,
  },
  leftRailCompact: {
    borderRightWidth: 0,
    flexShrink: 0,
    maxHeight: 360,
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
    gap: 6,
    minHeight: 0,
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
    minHeight: 0,
  },
  projectTreeScrollCompact: {
    flexGrow: 0,
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
    height: "36%",
    width: "100%",
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
