import type { DesignDraft, DesignDraftMachine } from "../../core/src/designDraft";
import type { FieldDesign, FieldPivotMachine } from "../../core/src/fieldDesignDocument";
import { parseFieldLayoutTarget, type FieldLayoutTarget } from "../../core/src/fieldLayoutTarget";
import { parseLayoutSessionDocument, type LayoutSession } from "../../core/src/layoutSession";
import { snapshotJsonValue } from "../../core/src/jsonDataSnapshot";
import { sha256Text } from "../../core/src/sha256";
import { parseSurveyCollectionDocument, surveyPurposeGeometryType, type SurveyCollection, type SurveyCollectionPurpose } from "../../core/src/surveyCollection";
import type { StraightLateralMachine } from "../../core/src/straightLateral";
import type { LayoutResult, PivotMachine, PivotProject, ProjectMapFeatureGeometry, XY } from "../../core/src/types";

export type WorkspaceReadonly<T> = T extends readonly (infer U)[] ? readonly WorkspaceReadonly<U>[]
  : T extends object ? { readonly [K in keyof T]: WorkspaceReadonly<T[K]> } : T;
export type WorkspaceSceneDocument =
  | { readonly kind: "draft"; readonly data: WorkspaceReadonly<DesignDraft> }
  | { readonly kind: "project"; readonly data: WorkspaceReadonly<PivotProject> }
  | { readonly kind: "field"; readonly data: WorkspaceReadonly<FieldDesign> }
  | { readonly kind: "target"; readonly data: FieldLayoutTarget }
  | { readonly kind: "session"; readonly data: WorkspaceReadonly<LayoutSession> };
export interface WorkspaceSceneCatalogOwner {
  readonly designId: string; readonly fieldMapId: string; readonly projectCrs: string | null;
}
export interface WorkspaceSceneFrame {
  readonly id: string; readonly generation: number; readonly inputRevision?: number;
  /** Declared current catalog association; live controller/store ownership remains a separate check. */
  readonly catalogOwner?: WorkspaceSceneCatalogOwner;
}
export type WorkspaceSceneLayer = "boundary" | "obstacle" | "map_feature" | "infrastructure" | "machine"
  | "saved_survey" | "manual_capture" | "survey_capture" | "frozen_target" | "layout_observation" | "receiver" | "preview";
export type WorkspaceSceneGeometry = WorkspaceReadonly<ProjectMapFeatureGeometry>
  | { readonly type: "Pending"; readonly geometryType: "Point" | "LineString" | "Polygon"; readonly vertices: readonly WorkspaceReadonly<XY>[] };
export interface WorkspaceMapEntity {
  /** Render address only; never an assigned durable entity or machine ID. */
  readonly address: string;
  readonly sourcePath: string;
  readonly sourceId?: string;
  readonly kind: "boundary" | "obstacle" | "map_feature" | "infrastructure" | "machine" | "survey_point"
    | "manual_capture" | "survey_capture" | "observation" | "receiver" | "preview";
  readonly layer: WorkspaceSceneLayer;
  readonly geometry: WorkspaceSceneGeometry;
  readonly geometryState: "complete" | "incomplete";
  readonly label?: string;
  readonly surveyCapture?: {
    readonly purpose: WorkspaceReadonly<SurveyCollectionPurpose>;
    readonly activePointIds: readonly string[];
  };
}
export interface WorkspaceSceneMachine {
  readonly sourcePath: string;
  /** Absent draft IDs remain absent. No placeholder identity is manufactured. */
  readonly id?: string;
  readonly kind: "center_pivot" | "straight_lateral";
  readonly configuration: WorkspaceReadonly<DesignDraftMachine | PivotMachine | FieldPivotMachine["configuration"] | StraightLateralMachine>;
  readonly location?: WorkspaceReadonly<XY>;
}
export interface WorkspaceTargetAuthority {
  /** Exact retained bytes, distinct from the derived render scene. */
  readonly document: string;
  readonly hash: string;
  readonly sourceFieldId: string;
  readonly inputRevision: number;
}
export interface WorkspaceReceiverDisplay {
  readonly observationId: string;
  readonly projectCrs: string;
  readonly point: WorkspaceReadonly<XY>;
  readonly label?: string;
}
export interface WorkspaceCalculationDisplay {
  readonly sourceDocumentId: string;
  readonly inputRevision: number;
  readonly machineIds: readonly string[];
  readonly result: WorkspaceReadonly<LayoutResult>;
  /** Only supplied evidence is rendered. The scene never computes coverage or a machine radius. */
  readonly overlays: readonly { readonly id: string; readonly geometry: WorkspaceSceneGeometry; readonly label?: string }[];
}
export interface WorkspaceSceneOptions {
  readonly receiver?: WorkspaceReceiverDisplay;
  readonly calculation?: WorkspaceCalculationDisplay;
  readonly surveyCollections?: readonly WorkspaceReadonly<SurveyCollection>[];
  readonly manualDrawing?: WorkspaceManualDrawingDisplay;
}
export interface WorkspaceManualDrawingDisplay {
  readonly sourceDocumentId: string;
  readonly inputRevision: number;
  readonly captureId: string;
  /** Supplied manual preview only; never receiver evidence or calculated coverage. */
  readonly geometry: WorkspaceSceneGeometry;
}
export interface WorkspaceMapScene {
  readonly identity: {
    readonly frameId: string; readonly generation: number;
    readonly documentKind: WorkspaceSceneDocument["kind"]; readonly documentId: string;
    readonly projectCrs: string | null;
    readonly inputRevision?: number;
    readonly catalogOwner?: WorkspaceSceneCatalogOwner;
  };
  readonly entities: readonly WorkspaceMapEntity[];
  readonly machines: readonly WorkspaceSceneMachine[];
  readonly sourceDocument: WorkspaceSceneDocument;
  /** Null means no exact retained target document was supplied, not an invented serialization. */
  readonly targetAuthority: WorkspaceTargetAuthority | null;
  readonly calculation?: WorkspaceCalculationDisplay;
  /** Full exact ledgers, including applied/cleared/archived history; only active pending membership is rendered. */
  readonly surveyCollections?: readonly WorkspaceReadonly<SurveyCollection>[];
  readonly manualDrawing?: WorkspaceManualDrawingDisplay;
}

type MutableScene = { -readonly [K in keyof WorkspaceMapScene]: WorkspaceMapScene[K] } & {
  entities: WorkspaceMapEntity[]; machines: WorkspaceSceneMachine[];
};
type FieldGeometry = WorkspaceReadonly<Pick<FieldDesign, "fieldBoundary" | "obstacles" | "mapFeatures" | "surveyPoints">>;

/** A render contract, not persistence/schema admission, calculation readiness or receiver capture admission. */
export function workspaceMapSceneFromDraft(input: DesignDraft, frame: WorkspaceSceneFrame, options: WorkspaceSceneOptions = {}): WorkspaceMapScene {
  const draft = snapshot(input);
  const scene = begin({ kind: "draft", data: draft }, draft.id, draft.projectCrs, frame);
  fieldGeometry(scene, draft, true);
  const machineId = draft.machine.id;
  if (Object.keys(draft.machine).length || draft.pivotCenter !== null) {
    scene.machines.push({ sourcePath: "machine", kind: "center_pivot", configuration: draft.machine,
      ...(machineId === undefined ? {} : { id: machineId }), ...(draft.pivotCenter === null ? {} : { location: draft.pivotCenter }) });
  }
  if (draft.pivotCenter !== null) entity(scene, "machine", "machine", "pivotCenter", { type: "Point", point: draft.pivotCenter }, machineId, draft.machine.name);
  for (const kind of ["waterSource", "powerSource"] as const) {
    if (draft[kind] !== null) entity(scene, "infrastructure", "infrastructure", kind, { type: "Point", point: draft[kind] });
  }
  draft.drawingWorkflow?.captures.forEach((capture, index) => {
    if (capture.projectCrs !== draft.projectCrs) throw new Error("Drawing capture CRS differs from the document frame.");
    entity(scene, "manual_capture", "manual_capture", `drawingWorkflow.captures[${index}]`,
      { type: "Pending", geometryType: capture.geometryType, vertices: capture.vertices.map(vertex => vertex.point) }, capture.id, capture.name, "incomplete");
  });
  return finish(scene, options);
}

export function workspaceMapSceneFromProject(input: PivotProject, frame: WorkspaceSceneFrame, options: WorkspaceSceneOptions = {}): WorkspaceMapScene {
  const project = snapshot(input);
  const scene = begin({ kind: "project", data: project }, project.id, project.projectCrs, frame);
  fieldGeometry(scene, project, false);
  scene.machines.push({ sourcePath: "machine", id: project.machine.id, kind: "center_pivot", configuration: project.machine, location: project.pivotCenter });
  entity(scene, "machine", "machine", "pivotCenter", { type: "Point", point: project.pivotCenter }, project.machine.id, project.machine.name);
  for (const kind of ["waterSource", "powerSource"] as const) entity(scene, "infrastructure", "infrastructure", kind, { type: "Point", point: project[kind] });
  return finish(scene, options);
}

export function workspaceMapSceneFromField(input: FieldDesign, frame: WorkspaceSceneFrame, options: WorkspaceSceneOptions = {}): WorkspaceMapScene {
  const field = snapshot(input);
  const scene = begin({ kind: "field", data: field }, field.id, field.projectCrs, frame);
  fieldGeometry(scene, field, false);
  fieldMachines(scene, field);
  return finish(scene, options);
}

export function workspaceMapSceneFromTarget(input: FieldLayoutTarget, frame: WorkspaceSceneFrame,
  options: WorkspaceSceneOptions & { readonly authority?: Pick<WorkspaceTargetAuthority, "document" | "hash"> } = {}): WorkspaceMapScene {
  const target = snapshot(input);
  assertTargetSelection(target);
  const scene = begin({ kind: "target", data: target }, target.source.fieldId, target.field.projectCrs, frame);
  fieldGeometry(scene, target.field, false, true);
  fieldMachines(scene, target.field, target.source.selectedMachineIds);
  if (options.authority) {
    const parsed = checkedTarget(options.authority.document, options.authority.hash);
    if (!sameData(parsed, target)) throw new Error("Retained target bytes differ from the supplied target scene source.");
    scene.targetAuthority = authority(target, options.authority.document, options.authority.hash);
  }
  return finish(scene, options);
}

export function workspaceMapSceneFromSession(input: LayoutSession, frame: WorkspaceSceneFrame, options: WorkspaceSceneOptions = {}): WorkspaceMapScene {
  const session = snapshot(input);
  // Reuse strict durable authority/evidence admission. Render output still retains the exact input snapshot.
  parseLayoutSessionDocument(session);
  const target = checkedTarget(session.targetDocument, session.targetHash);
  const scene = begin({ kind: "session", data: session }, session.id, target.field.projectCrs, frame);
  fieldGeometry(scene, target.field, false, true);
  fieldMachines(scene, target.field, target.source.selectedMachineIds);
  scene.targetAuthority = authority(target, session.targetDocument, session.targetHash);
  sessionObservations(scene, session);
  return finish(scene, options);
}

function begin(sourceDocument: WorkspaceSceneDocument, documentId: string, projectCrs: string | null, frame: WorkspaceSceneFrame): MutableScene {
  const actualFrame = snapshot(frame);
  const sourceRevision = sourceDocument.kind === "target" ? sourceDocument.data.source.inputRevision
    : sourceDocument.kind === "session" ? sourceDocument.data.revision : actualFrame.inputRevision;
  if (actualFrame.inputRevision !== undefined && sourceRevision !== actualFrame.inputRevision) throw new Error("Frame input revision differs from its source document.");
  return { identity: { frameId: actualFrame.id, generation: actualFrame.generation, documentKind: sourceDocument.kind, documentId, projectCrs,
    ...(sourceRevision === undefined ? {} : { inputRevision: sourceRevision }),
    ...(actualFrame.catalogOwner === undefined ? {} : { catalogOwner: actualFrame.catalogOwner }) },
    sourceDocument, entities: [], machines: [], targetAuthority: null };
}

function fieldGeometry(scene: MutableScene, source: FieldGeometry, incomplete: boolean, frozen = false): void {
  if (source.fieldBoundary.length) entity(scene, "boundary", frozen ? "frozen_target" : "boundary", "fieldBoundary",
    { type: "Polygon", vertices: source.fieldBoundary }, undefined, undefined, incomplete && source.fieldBoundary.length < 3 ? "incomplete" : "complete");
  source.obstacles.forEach((obstacle, index) => entity(scene, "obstacle", frozen ? "frozen_target" : "obstacle", `obstacles[${index}]`,
    { type: "Polygon", vertices: obstacle.polygon }, obstacle.id, obstacle.name));
  source.mapFeatures?.forEach((feature, index) => entity(scene, "map_feature", frozen ? "frozen_target" : "map_feature", `mapFeatures[${index}]`, feature.geometry, feature.id, feature.name));
  source.surveyPoints.forEach((point, index) => entity(scene, "survey_point", "saved_survey", `surveyPoints[${index}]`, { type: "Point", point: point.projected }, point.id, point.label));
}

function fieldMachines(scene: MutableScene, field: WorkspaceReadonly<FieldDesign>, selected?: readonly string[]): void {
  field.machines.forEach((machine, index) => {
    if (selected && !selected.includes(machine.id)) return;
    const sourcePath = `machines[${index}]`;
    scene.machines.push({ sourcePath, id: machine.id, kind: machine.kind, configuration: machine.configuration, location: machine.pivotCenter });
    entity(scene, "machine", selected ? "frozen_target" : "machine", sourcePath, { type: "Point", point: machine.pivotCenter }, machine.id, machine.configuration.name);
  });
  if (!selected) field.lateralMachines?.forEach((machine, index) => {
    const sourcePath = `lateralMachines[${index}]`;
    scene.machines.push({ sourcePath, id: machine.id, kind: machine.kind, configuration: machine });
    entity(scene, "machine", "machine", sourcePath, { type: "LineString", vertices: [machine.travel.start, machine.travel.end] }, machine.id, machine.name);
  });
  field.infrastructure.forEach((item, index) => entity(scene, "infrastructure", selected ? "frozen_target" : "infrastructure", `infrastructure[${index}]`,
    { type: "Point", point: item.point }, item.id, item.kind));
}

function sessionObservations(scene: MutableScene, session: WorkspaceReadonly<LayoutSession>): void {
  session.observations.forEach((observation, index) => entity(scene, "observation", "layout_observation", `observations[${index}]`,
    { type: "Point", point: observation.projected }, observation.id, observation.label));
}

function surveyCollectionEntities(scene: MutableScene, input: readonly WorkspaceReadonly<SurveyCollection>[]): void {
  const sourceKind = scene.sourceDocument.kind;
  if (sourceKind !== "draft" && sourceKind !== "project" && sourceKind !== "field") throw new Error("Editable Survey collections cannot overlay a frozen target or Layout session.");
  if (!Array.isArray(input)) throw new Error("Survey overlays require an array of durable collections.");
  const catalogOwner = scene.identity.catalogOwner;
  if (!catalogOwner) throw new Error("Survey overlays require the actual frame catalog owner.");
  textId(catalogOwner.designId, "Survey frame design identity"); textId(catalogOwner.fieldMapId, "Survey frame field identity");
  if (catalogOwner.projectCrs !== scene.identity.projectCrs) throw new Error("Survey frame CRS differs from the actual document CRS.");
  const ids = new Set<string>();
  input.forEach((stored, index) => {
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw new Error("Survey overlays require actual collection objects, not serialized or substituted sources.");
    const collection = parseSurveyCollectionDocument(stored);
    if (ids.has(collection.id)) throw new Error("Duplicate Survey collection identity.");
    ids.add(collection.id);
    if (collection.owner.documentKind !== sourceKind || collection.owner.payloadId !== scene.identity.documentId
      || collection.owner.projectCrs !== scene.identity.projectCrs || collection.owner.projectCrs !== catalogOwner.projectCrs
      || collection.owner.designId !== catalogOwner.designId || collection.owner.fieldMapId !== catalogOwner.fieldMapId) {
      throw new Error("Survey collection owner differs from the actual document and declared catalog frame.");
    }
    if (collection.state !== "pending" || !collection.activePointIds.length) return;
    const byId = new Map(collection.observations.map(point => [point.id, point]));
    entity(scene, "survey_capture", "survey_capture", `surveyCollections[${index}]`,
      { type: "Pending", geometryType: surveyPurposeGeometryType(collection.purpose), vertices: collection.activePointIds.map(id => byId.get(id)!.projected) },
      collection.id, undefined, "incomplete");
    const entityIndex = scene.entities.length - 1;
    scene.entities[entityIndex] = { ...scene.entities[entityIndex], surveyCapture: { purpose: collection.purpose, activePointIds: collection.activePointIds } };
  });
}

function entity(scene: MutableScene, kind: WorkspaceMapEntity["kind"], layer: WorkspaceSceneLayer, sourcePath: string,
  geometry: WorkspaceSceneGeometry, sourceId?: string, label?: string, geometryState: WorkspaceMapEntity["geometryState"] = "complete"): void {
  const address = JSON.stringify([scene.identity.documentKind, scene.identity.documentId, layer, kind, sourceId ?? sourcePath]);
  scene.entities.push({ address, sourcePath, kind, layer, geometry, geometryState,
    ...(sourceId === undefined ? {} : { sourceId }), ...(label === undefined ? {} : { label }) });
}

function finish(scene: MutableScene, inputOptions: WorkspaceSceneOptions): WorkspaceMapScene {
  const options = snapshot(inputOptions);
  if (options.manualDrawing !== undefined) {
    scene.manualDrawing = options.manualDrawing;
    manualDrawingEntity(scene, options.manualDrawing);
  }
  if (options.surveyCollections !== undefined) {
    scene.surveyCollections = options.surveyCollections;
    surveyCollectionEntities(scene, options.surveyCollections);
  }
  if (options.receiver) {
    if (options.receiver.projectCrs !== scene.identity.projectCrs) throw new Error("Receiver display CRS differs from the scene frame.");
    entity(scene, "receiver", "receiver", "receiver", { type: "Point", point: options.receiver.point }, options.receiver.observationId, options.receiver.label);
  }
  if (options.calculation) {
    const calculation = options.calculation;
    if (calculation.sourceDocumentId !== scene.identity.documentId) throw new Error("Calculation overlay belongs to another document.");
    assertRevision(calculation.inputRevision, "Calculation input revision");
    if (calculation.inputRevision !== scene.identity.inputRevision) throw new Error("Calculation overlay revision differs from the current input revision.");
    const machineIds = new Set(scene.machines.flatMap(machine => machine.id === undefined ? [] : [machine.id]));
    if (!calculation.machineIds.length || new Set(calculation.machineIds).size !== calculation.machineIds.length || calculation.machineIds.some(id => !machineIds.has(id))) {
      throw new Error("Calculation overlay machine identity is not in this scene.");
    }
    scene.calculation = calculation;
    calculation.overlays.forEach((overlay, index) => entity(scene, "preview", "preview", `calculation.overlays[${index}]`, overlay.geometry, overlay.id, overlay.label));
  }
  return validateWorkspaceMapScene(scene);
}

function manualDrawingEntity(scene: MutableScene, display: WorkspaceManualDrawingDisplay): void {
  if (scene.sourceDocument.kind !== "project") throw new Error("External manual preview is only supported for its actual Project; Draft vertices belong to their saved workflow.");
  textId(display.captureId, "Manual drawing identity");
  assertRevision(display.inputRevision, "Manual drawing revision");
  if (display.sourceDocumentId !== scene.identity.documentId || display.inputRevision !== scene.identity.inputRevision) throw new Error("Manual preview belongs to another source document or revision.");
  const pending = display.geometry.type === "Pending";
  entity(scene, pending ? "manual_capture" : "preview", pending ? "manual_capture" : "preview", "manualDrawing", display.geometry, display.captureId,
    "Manual drawing preview", pending ? "incomplete" : "complete");
}

/** Add a source-bound Project interaction preview to the same immutable scene.
 * No domain document, calculation result or map lifecycle is manufactured. */
export function withWorkspaceManualDrawing(input: WorkspaceMapScene, display: WorkspaceManualDrawingDisplay | null): WorkspaceMapScene {
  const current = snapshot(validateWorkspaceMapScene(input)) as MutableScene;
  current.entities = current.entities.filter(item => item.sourcePath !== "manualDrawing");
  delete current.manualDrawing;
  if (display) { current.manualDrawing = snapshot(display); manualDrawingEntity(current as MutableScene, current.manualDrawing); }
  return validateWorkspaceMapScene(current);
}

/** Structural render admission permits incomplete draft geometry; it never certifies domain readiness. */
export function validateWorkspaceMapScene(input: WorkspaceMapScene): WorkspaceMapScene {
  const scene = snapshot(input);
  textId(scene.identity.frameId, "Frame identity"); textId(scene.identity.documentId, "Document identity");
  assertRevision(scene.identity.generation, "Frame generation");
  if (scene.identity.inputRevision !== undefined) assertRevision(scene.identity.inputRevision, "Input revision");
  if (scene.identity.documentKind !== scene.sourceDocument.kind) throw new Error("Scene document kind differs from its source.");
  const source = scene.sourceDocument;
  if (!["draft", "project", "field", "target", "session"].includes(source.kind)) throw new Error("Unknown scene document kind.");
  // Public callers may submit cloned scenes, so adapter-time admission alone is insufficient.
  if (source.kind === "session") parseLayoutSessionDocument(source.data);
  const actualId = source.kind === "target" ? source.data.source.fieldId : source.data.id;
  if (actualId !== scene.identity.documentId) throw new Error("Scene identity differs from its source document.");
  const actualCrs = source.kind === "target" ? source.data.field.projectCrs
    : source.kind === "session" ? checkedTarget(source.data.targetDocument, source.data.targetHash).field.projectCrs : source.data.projectCrs;
  if (actualCrs !== scene.identity.projectCrs) throw new Error("Scene CRS differs from its source document.");
  if (scene.identity.projectCrs !== null) textId(scene.identity.projectCrs, "Scene CRS");
  if (scene.identity.projectCrs === null && scene.identity.documentKind !== "draft") throw new Error("Only incomplete drafts can have an absent CRS.");
  if (scene.identity.catalogOwner) {
    textId(scene.identity.catalogOwner.designId, "Frame design identity"); textId(scene.identity.catalogOwner.fieldMapId, "Frame field identity");
    if (scene.identity.catalogOwner.projectCrs !== scene.identity.projectCrs) throw new Error("Declared catalog frame CRS differs from the document.");
  }
  const addresses = new Set<string>();
  const layersByKind: Record<WorkspaceMapEntity["kind"], readonly WorkspaceSceneLayer[]> = {
    boundary: ["boundary", "frozen_target"], obstacle: ["obstacle", "frozen_target"], map_feature: ["map_feature", "frozen_target"],
    infrastructure: ["infrastructure", "frozen_target"], machine: ["machine", "frozen_target"], survey_point: ["saved_survey"],
    manual_capture: ["manual_capture"], survey_capture: ["survey_capture"], observation: ["layout_observation"], receiver: ["receiver"], preview: ["preview"],
  };
  for (const item of scene.entities) {
    if (!["boundary", "obstacle", "map_feature", "infrastructure", "machine", "survey_point", "manual_capture", "survey_capture", "observation", "receiver", "preview"].includes(item.kind)
      || !["boundary", "obstacle", "map_feature", "infrastructure", "machine", "saved_survey", "manual_capture", "survey_capture", "frozen_target", "layout_observation", "receiver", "preview"].includes(item.layer)
      || !["complete", "incomplete"].includes(item.geometryState)) throw new Error("Unknown render entity kind, layer or geometry state.");
    if (!layersByKind[item.kind].includes(item.layer)) throw new Error("Render entity kind differs from its layer.");
    if (item.label !== undefined && typeof item.label !== "string") throw new Error("Render label must be text.");
    if (item.layer === "frozen_target" && source.kind !== "target" && source.kind !== "session") throw new Error("Frozen geometry requires a target or session source.");
    if (item.kind === "observation" && source.kind !== "session") throw new Error("Layout observations require a session source.");
    textId(item.address, "Render address"); textId(item.sourcePath, "Source path");
    if (item.sourceId !== undefined) textId(item.sourceId, "Source entity identity");
    if (addresses.has(item.address)) throw new Error("Duplicate render entity identity.");
    addresses.add(item.address);
    if (item.geometryState === "incomplete" && item.kind !== "manual_capture" && item.kind !== "survey_capture" && !(scene.identity.documentKind === "draft" && item.kind === "boundary")) {
      throw new Error("Incomplete geometry is only permitted for draft boundaries or retained captures.");
    }
    assertGeometry(item.geometry, item.geometryState === "incomplete");
    if (item.geometry.type === "Pending" && item.kind !== "manual_capture" && item.kind !== "survey_capture") throw new Error("Pending geometry is only permitted for retained captures.");
    if ((item.kind === "manual_capture" || item.kind === "survey_capture") && item.geometry.type !== "Pending") throw new Error("Retained capture must use pending geometry.");
    if (item.surveyCapture !== undefined && item.kind !== "survey_capture") throw new Error("Survey capture metadata requires its own evidence layer.");
    if (["infrastructure", "survey_point", "observation", "receiver"].includes(item.kind) && item.geometry.type !== "Point") throw new Error("This entity requires point geometry.");
    if ((item.kind === "boundary" || item.kind === "obstacle") && item.geometry.type !== "Polygon") throw new Error("Boundary and obstacle entities require polygon geometry.");
  }
  const surveyEntities = (entities: readonly WorkspaceMapEntity[]) => entities.filter(item => item.layer === "survey_capture");
  const manualEntities = (entities: readonly WorkspaceMapEntity[]) => entities.filter(item => item.sourcePath === "manualDrawing");
  if (scene.manualDrawing !== undefined) {
    const expected = begin(source, scene.identity.documentId, scene.identity.projectCrs, {
      id: scene.identity.frameId, generation: scene.identity.generation,
      ...(scene.identity.inputRevision === undefined ? {} : { inputRevision: scene.identity.inputRevision }),
    });
    manualDrawingEntity(expected, scene.manualDrawing);
    if (!sameData(manualEntities(scene.entities), manualEntities(expected.entities))) throw new Error("Manual render preview differs from its exact supplied geometry.");
  } else if (manualEntities(scene.entities).length) throw new Error("Manual preview requires its exact source-bound display record.");
  if (scene.surveyCollections !== undefined) {
    const expected = begin(source, scene.identity.documentId, scene.identity.projectCrs,
      { id: scene.identity.frameId, generation: scene.identity.generation,
        ...(scene.identity.inputRevision === undefined ? {} : { inputRevision: scene.identity.inputRevision }),
        ...(scene.identity.catalogOwner === undefined ? {} : { catalogOwner: scene.identity.catalogOwner }) });
    surveyCollectionEntities(expected, scene.surveyCollections);
    if (!sameData(surveyEntities(scene.entities), surveyEntities(expected.entities))) throw new Error("Rendered Survey captures differ from their exact durable collection membership.");
  } else if (surveyEntities(scene.entities).length) throw new Error("Survey capture geometry requires its actual durable collections.");
  const machines = new Set<string>();
  for (const machine of scene.machines) {
    if (machine.kind !== "center_pivot" && machine.kind !== "straight_lateral") throw new Error("Unknown machine kind.");
    textId(machine.sourcePath, "Machine source path");
    if (machine.id !== undefined) {
      textId(machine.id, "Machine identity");
      if (machines.has(machine.id)) throw new Error("Duplicate machine identity.");
      machines.add(machine.id);
    } else if (scene.identity.documentKind !== "draft") throw new Error("Only partial drafts can have an absent machine identity.");
    if (machine.location) point(machine.location);
  }
  if (scene.calculation) {
    const calculation = scene.calculation;
    if (calculation.result === null || typeof calculation.result !== "object" || Array.isArray(calculation.result)) {
      throw new Error("Calculation display requires its supplied result object.");
    }
    if (calculation.sourceDocumentId !== scene.identity.documentId || calculation.inputRevision !== scene.identity.inputRevision
      || !calculation.machineIds.length || new Set(calculation.machineIds).size !== calculation.machineIds.length
      || calculation.machineIds.some(id => !machines.has(id))) throw new Error("Calculation overlay provenance differs from this scene.");
  }
  if (scene.sourceDocument.kind === "session" && !scene.targetAuthority) throw new Error("A session scene requires its retained target authority.");
  if (scene.targetAuthority) {
    const parsed = checkedTarget(scene.targetAuthority.document, scene.targetAuthority.hash);
    if (parsed.source.fieldId !== scene.targetAuthority.sourceFieldId || parsed.source.inputRevision !== scene.targetAuthority.inputRevision
      || parsed.field.projectCrs !== scene.identity.projectCrs) throw new Error("Target authority identity differs from its scene frame.");
    if (scene.sourceDocument.kind === "target" && !sameData(parsed, scene.sourceDocument.data)) throw new Error("Target authority differs from its scene source.");
    if (scene.sourceDocument.kind === "session" && (scene.sourceDocument.data.targetDocument !== scene.targetAuthority.document
      || scene.sourceDocument.data.targetHash !== scene.targetAuthority.hash)) throw new Error("Target authority differs from its retained session.");
    if (scene.sourceDocument.kind !== "target" && scene.sourceDocument.kind !== "session") throw new Error("Editable documents cannot own frozen target authority.");
  }
  if (source.kind === "target" || source.kind === "session") {
    const target = source.kind === "target" ? source.data : checkedTarget(source.data.targetDocument, source.data.targetHash);
    assertTargetSelection(target);
    const expected = begin(source, scene.identity.documentId, scene.identity.projectCrs,
      { id: scene.identity.frameId, generation: scene.identity.generation, ...(scene.identity.inputRevision === undefined ? {} : { inputRevision: scene.identity.inputRevision }) });
    fieldGeometry(expected, target.field, false, true); fieldMachines(expected, target.field, target.source.selectedMachineIds);
    const retainedGeometry = (entities: readonly WorkspaceMapEntity[]) => entities.filter(item => item.layer === "frozen_target" || item.layer === "saved_survey");
    if (!sameData(retainedGeometry(scene.entities), retainedGeometry(expected.entities)) || !sameData(scene.machines, expected.machines)) {
      throw new Error("Frozen render geometry differs from its retained target source.");
    }
    if (source.kind === "session") {
      sessionObservations(expected, source.data);
      const observations = (entities: readonly WorkspaceMapEntity[]) => entities.filter(item => item.layer === "layout_observation");
      if (!sameData(observations(scene.entities), observations(expected.entities))) {
        throw new Error("Rendered Layout observations differ from their exact retained session observations.");
      }
    }
  }
  return freeze(scene);
}

function assertGeometry(geometry: WorkspaceSceneGeometry, incomplete: boolean): void {
  if (!geometry || typeof geometry !== "object") throw new Error("Malformed render geometry.");
  switch (geometry.type) {
    case "Point": point(geometry.point); break;
    case "Circle": point(geometry.center); if (!Number.isFinite(geometry.radiusMeters) || geometry.radiusMeters <= 0) throw new Error("Invalid render circle radius."); break;
    case "LineString": case "Polygon": {
      if (!Array.isArray(geometry.vertices) || geometry.vertices.length < (incomplete ? 1 : geometry.type === "Polygon" ? 3 : 2)) throw new Error("Malformed render vertex count.");
      geometry.vertices.forEach(point); break;
    }
    case "Pending": {
      if (!incomplete || !["Point", "LineString", "Polygon"].includes(geometry.geometryType) || !Array.isArray(geometry.vertices)
        || (geometry.geometryType === "Point" && geometry.vertices.length > 1)) throw new Error("Malformed pending capture geometry.");
      geometry.vertices.forEach(point); break;
    }
    default: throw new Error("Unknown render geometry type.");
  }
}
function point(value: WorkspaceReadonly<XY>): void {
  if (!value || typeof value !== "object" || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new Error("Render coordinates must be finite XY.");
}
function textId(value: string, context: string): void { if (typeof value !== "string" || !value.trim()) throw new Error(`${context} must be supplied.`); }
function assertRevision(value: number, context: string): void { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${context} must be a nonnegative safe integer.`); }
function snapshot<T>(value: T): T { return snapshotJsonValue(value, "workspace map scene") as T; }
function freeze<T>(value: T): WorkspaceReadonly<T> {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value as WorkspaceReadonly<T>;
}
function checkedTarget(document: string, hash: string): FieldLayoutTarget {
  if (typeof document !== "string" || sha256Text(document) !== hash) throw new Error("Frozen target hash differs from its exact retained bytes.");
  return parseFieldLayoutTarget(document);
}
function authority(target: FieldLayoutTarget, document: string, hash: string): WorkspaceTargetAuthority {
  return { document, hash, sourceFieldId: target.source.fieldId, inputRevision: target.source.inputRevision };
}
function assertTargetSelection(target: FieldLayoutTarget): void {
  if (target.documentVersion !== "field-layout-target-v1" || target.qualification !== "design_snapshot_only"
    || target.source.fieldId !== target.field.id || !target.source.selectedMachineIds.length
    || new Set(target.source.selectedMachineIds).size !== target.source.selectedMachineIds.length
    || target.source.selectedMachineIds.some(id => !target.field.machines.some(machine => machine.id === id))) throw new Error("Invalid frozen target selection identity.");
  assertRevision(target.source.inputRevision, "Target input revision");
}
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key)
    && sameData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
