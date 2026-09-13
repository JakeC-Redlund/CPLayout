import type {
  GnssCaptureEvidence,
  PivotMachine,
  PivotProject,
  ProjectMapFeature,
  SourceConfidence,
  XY,
} from "./types";
import { projectDataKey } from "./projectDataComparison";

export const MANUAL_DESIGN_STEPS = ["boundary", "pivot", "last_wheel", "machine_end", "review", "apply"] as const;

export type ManualDesignStep = typeof MANUAL_DESIGN_STEPS[number];

export type ManualDesignInputSource =
  | "map_click"
  | "projected_xy"
  | "wgs84"
  | "rtk_evidence"
  | "imported_evidence"
  | "machine_specs";

export type ManualDesignRadiusRole = "last_wheel" | "machine_end";

export interface ManualDesignRadiusOccupation {
  point: XY;
  captureEvidence?: GnssCaptureEvidence;
}

export interface ManualDesignRadiusEvidence {
  role: ManualDesignRadiusRole;
  source: ManualDesignInputSource;
  confidence: SourceConfidence;
  occupations: ManualDesignRadiusOccupation[];
}

export interface ManualDesignDraft {
  projectId: string;
  baseRevision: number;
  boundary: {
    vertices: XY[];
    source: ManualDesignInputSource;
    captureEvidence?: Array<GnssCaptureEvidence | null>;
  } | null;
  pivot: {
    point: XY;
    source: ManualDesignInputSource;
    sourceObservationId?: string;
  } | null;
  machine: {
    value: PivotMachine;
    lastWheelSource: ManualDesignInputSource;
    machineEndSource: ManualDesignInputSource;
  } | null;
  radiusEvidence: ManualDesignRadiusEvidence[];
  selectedEvidenceFeatureIds: string[];
  engineeringInputs?: Partial<Record<"application_intensity" | "flow" | "friction_loss" | "nozzle_package" | "pressure" | "topography" | "uniformity", boolean>>;
}

export interface MachinePathSummary {
  lastWheelRadiusMeters: number;
  endMachineRadiusMeters: number;
  endGunReachMeters: number;
  coincidentLastWheelAndMachineEnd: boolean;
}

export interface ManualDesignTopologyIssue {
  component: "boundary";
  code: "too_few_vertices" | "non_finite_coordinate" | "duplicate_vertex" | "degenerate_area" | "self_intersection";
  message: string;
}

export interface ManualDesignReadiness {
  ready: boolean;
  components: {
    boundary: boolean;
    pivot: boolean;
    lastWheel: boolean;
    machineEnd: boolean;
  };
  topologyIssues: ManualDesignTopologyIssue[];
  errors: string[];
  warnings: string[];
  pivotContainment: "inside" | "outside" | "not_evaluated";
  paths: MachinePathSummary | null;
  outsideFieldResult: {
    status: "inside" | "outside" | "not_evaluated";
    // When exact is false, this can be a conservative containment lower bound.
    minimumClearanceMeters: number | null;
    exact: boolean;
  };
  sourceConfidence: {
    level: "high" | "medium" | "low" | "unknown";
    sources: ManualDesignInputSource[];
  };
  missingEngineeringInputs: string[];
}

export function createManualDesignDraft(project: PivotProject, baseRevision: number): ManualDesignDraft {
  const pivotObservation = project.surveyPoints.find((point) => point.id === project.infrastructureObservationRefs?.pivot_center);
  const pivotSource: ManualDesignInputSource = pivotObservation?.source === "external_gnss"
    && pivotObservation.captureEvidence?.coherent
    && (pivotObservation.rtk?.fixType === "rtk_fixed" || pivotObservation.rtk?.fixType === "rtk_float")
    && samePoint(pivotObservation.projected, project.pivotCenter)
    ? "rtk_evidence" : pivotObservation?.source === "imported" ? "imported_evidence" : "projected_xy";
  return {
    projectId: project.id,
    baseRevision,
    boundary: { vertices: project.fieldBoundary.map(copyPoint), source: "projected_xy", captureEvidence: project.fieldBoundaryCaptureEvidence?.map(copyCaptureEvidence) },
    pivot: {
      point: copyPoint(project.pivotCenter),
      source: pivotSource,
      sourceObservationId: project.infrastructureObservationRefs?.pivot_center,
    },
    machine: {
      value: copyMachine(project.machine),
      lastWheelSource: "machine_specs",
      machineEndSource: "machine_specs",
    },
    radiusEvidence: [],
    selectedEvidenceFeatureIds: [],
  };
}

export function buildMachinePathSummary(machine: Pick<PivotMachine, "spanLengthsMeters" | "overhangMeters" | "endGunThrowMeters">): MachinePathSummary {
  const lastWheelRadiusMeters = machine.spanLengthsMeters.reduce((sum, span) => sum + span, 0);
  const endMachineRadiusMeters = lastWheelRadiusMeters + machine.overhangMeters;
  const endGunReachMeters = endMachineRadiusMeters + machine.endGunThrowMeters;
  return {
    lastWheelRadiusMeters,
    endMachineRadiusMeters,
    endGunReachMeters,
    coincidentLastWheelAndMachineEnd: nearlyEqual(lastWheelRadiusMeters, endMachineRadiusMeters),
  };
}

export function evaluateManualDesignReadiness(draft: ManualDesignDraft): ManualDesignReadiness {
  const topologyIssues = validateDraftBoundary(draft.boundary?.vertices ?? []);
  const boundaryReady = Boolean(draft.boundary && topologyIssues.length === 0);
  const pivotReady = Boolean(draft.pivot && finitePoint(draft.pivot.point));
  const machineReady = Boolean(draft.machine && validMachineDistances(draft.machine.value));
  const paths = machineReady && draft.machine ? buildMachinePathSummary(draft.machine.value) : null;
  const pivotContainment = boundaryReady && pivotReady && draft.boundary && draft.pivot
    ? (pointInRing(draft.pivot.point, draft.boundary.vertices) ? "inside" : "outside")
    : "not_evaluated";
  const outsideFieldResult = exactFullCircleOutsideFieldResult(draft, boundaryReady, pivotReady, paths);
  const errors = topologyIssues.map((issue) => issue.message);
  if (!draft.boundary) errors.push("Boundary input is required.");
  if (!draft.pivot || !pivotReady) errors.push("A finite projected-XY pivot is required.");
  if (!draft.machine || !machineReady) errors.push("Positive span lengths and non-negative machine-end distances are required.");
  const warnings: string[] = [];
  if (pivotContainment === "outside") warnings.push("Pivot center is outside the field boundary; qualified review is required before use.");
  if (outsideFieldResult.status === "outside") warnings.push("Machine reach extends outside the field boundary.");
  if (draft.selectedEvidenceFeatureIds.length === 0 && draft.radiusEvidence.length === 0) {
    warnings.push("No site evidence is selected; geometry remains operator-estimated.");
  }
  const missingInputs = collectMissingEngineeringInputs(draft);
  if (missingInputs.length > 0) {
    warnings.push("Hydraulic and agronomic engineering inputs are incomplete; this transaction cannot certify a final design.");
  }
  const sources = uniqueSources(draft);
  return {
    ready: errors.length === 0,
    components: {
      boundary: boundaryReady,
      pivot: pivotReady,
      lastWheel: machineReady,
      machineEnd: machineReady,
    },
    topologyIssues,
    errors,
    warnings,
    pivotContainment,
    paths,
    outsideFieldResult,
    sourceConfidence: { level: confidenceLevel(sources), sources },
    missingEngineeringInputs: missingInputs,
  };
}

export function applyManualDesignDraft(project: PivotProject, draft: ManualDesignDraft, currentRevision: number): PivotProject {
  if (draft.projectId !== project.id) throw new Error("Manual design draft belongs to a different project.");
  if (draft.baseRevision !== currentRevision) throw new Error("Manual design draft is stale; reset it from the current project before applying.");
  const readiness = evaluateManualDesignReadiness(draft);
  if (!readiness.ready || !draft.boundary || !draft.pivot || !draft.machine) {
    throw new Error(readiness.errors[0] ?? "Manual design draft is not ready to apply.");
  }

  const targetMachineId = draft.machine.value.id;
  const retainedFeatures = (project.mapFeatures ?? []).filter((feature) => !(
    feature.kind === "measurement_line"
    && feature.properties?.targetMachineId === targetMachineId
    && (feature.properties?.designRole === "last_wheel" || feature.properties?.designRole === "machine_end")
  ));
  const knownCaptures = knownProjectCaptures(project);
  const evidenceFeatures = draft.radiusEvidence.flatMap((evidence) =>
    radiusEvidenceFeatures(draft.pivot!.point, targetMachineId, evidence, readiness.paths!, knownCaptures));
  const infrastructureObservationRefs = { ...(project.infrastructureObservationRefs ?? {}) };
  delete infrastructureObservationRefs.pivot_center;
  if (draft.pivot.sourceObservationId) {
    const observations = project.surveyPoints.filter((point) => point.id === draft.pivot!.sourceObservationId);
    if (observations.length !== 1) throw new Error("Manual pivot observation reference must resolve uniquely.");
    if (samePoint(observations[0].projected, draft.pivot.point)) infrastructureObservationRefs.pivot_center = draft.pivot.sourceObservationId;
  }

  return {
    ...project,
    fieldBoundary: draft.boundary.vertices.map(copyPoint),
    fieldBoundaryCaptureEvidence: reconcileBoundaryEvidence(knownCaptures, draft.boundary),
    pivotCenter: copyPoint(draft.pivot.point),
    infrastructureObservationRefs,
    machine: copyMachine(draft.machine.value),
    mapFeatures: [...retainedFeatures, ...evidenceFeatures],
  };
}

function radiusEvidenceFeatures(
  pivot: XY,
  targetMachineId: string,
  evidence: ManualDesignRadiusEvidence,
  paths: MachinePathSummary,
  knownCaptures: ReturnType<typeof knownProjectCaptures>,
): ProjectMapFeature[] {
  if (evidence.occupations.length === 0) return [];
  const measuredRadii = evidence.occupations.map((occupation) => distance(pivot, occupation.point));
  const meanRadiusMeters = measuredRadii.reduce((sum, radius) => sum + radius, 0) / measuredRadii.length;
  const appliedRadiusMeters = evidence.role === "last_wheel" ? paths.lastWheelRadiusMeters : paths.endMachineRadiusMeters;
  return evidence.occupations.map((occupation, index) => {
    const captureEvidence = knownCaptures(occupation.point, occupation.captureEvidence);
    const rejectedCapture = Boolean(occupation.captureEvidence && !captureEvidence);
    const unverifiableGnss = !captureEvidence && (evidence.source === "rtk_evidence"
      || (rejectedCapture && ["rtk_fixed", "rtk_float", "dgps", "autonomous"].includes(evidence.confidence)));
    return {
      id: `manual-design-${targetMachineId}-${evidence.role}-${index + 1}`,
      name: evidence.role === "last_wheel" ? `Last wheel radius occupation ${index + 1}` : `Machine end radius occupation ${index + 1}`,
      kind: "measurement_line",
      geometry: { type: "LineString", vertices: [copyPoint(pivot), copyPoint(occupation.point)] },
      confidence: unverifiableGnss ? "user_estimated" : evidence.confidence,
      vertexCaptureEvidence: captureEvidence ? [null, captureEvidence] : undefined,
      notes: evidence.occupations.length === 1
        ? "Single occupation is provisional radius evidence."
        : "Multiple occupations report mean radius and residuals for operator review.",
      properties: {
        designRole: evidence.role,
        targetMachineId,
        appliedRadiusMeters: round(appliedRadiusMeters),
        measuredRadiusMeters: round(measuredRadii[index]),
        meanRadiusMeters: round(meanRadiusMeters),
        residualMeters: round(measuredRadii[index] - meanRadiusMeters),
        occupationCount: evidence.occupations.length,
        provisional: evidence.occupations.length === 1,
        inputSource: unverifiableGnss ? "projected_xy" : evidence.source,
      },
    };
  });
}

function exactFullCircleOutsideFieldResult(
  draft: ManualDesignDraft,
  boundaryReady: boolean,
  pivotReady: boolean,
  paths: MachinePathSummary | null,
): ManualDesignReadiness["outsideFieldResult"] {
  if (!boundaryReady || !pivotReady || !draft.boundary || !draft.pivot || !draft.machine || !paths) {
    return { status: "not_evaluated", minimumClearanceMeters: null, exact: false };
  }
  if (draft.machine.value.sweep.mode !== "full_circle" || !pointInRing(draft.pivot.point, draft.boundary.vertices)) {
    return { status: "not_evaluated", minimumClearanceMeters: null, exact: false };
  }
  const minimumClearanceMeters = minimumDistanceToRing(draft.pivot.point, draft.boundary.vertices) - paths.endGunReachMeters;
  return {
    status: minimumClearanceMeters >= 0 ? "inside" : "outside",
    minimumClearanceMeters: round(minimumClearanceMeters),
    exact: minimumClearanceMeters >= 0,
  };
}

function validateDraftBoundary(vertices: XY[]): ManualDesignTopologyIssue[] {
  if (vertices.length < 3) return [issue("too_few_vertices", "Boundary needs at least three vertices before apply.")];
  if (vertices.some((point) => !finitePoint(point))) return [issue("non_finite_coordinate", "Boundary contains a non-finite coordinate.")];
  const seen = new Set<string>();
  for (const vertex of vertices) {
    const key = `${vertex.x},${vertex.y}`;
    if (seen.has(key)) return [issue("duplicate_vertex", "Boundary contains duplicate vertices.")];
    seen.add(key);
  }
  if (hasSelfIntersection(vertices)) return [issue("self_intersection", "Boundary must not self-intersect.")];
  if (Math.abs(signedArea(vertices)) < 0.000001) return [issue("degenerate_area", "Boundary has degenerate area.")];
  return [];
}

function issue(code: ManualDesignTopologyIssue["code"], message: string): ManualDesignTopologyIssue {
  return { component: "boundary", code, message };
}

function validMachineDistances(machine: PivotMachine): boolean {
  return machine.spanLengthsMeters.length > 0
    && machine.spanLengthsMeters.every((span) => Number.isFinite(span) && span > 0)
    && Number.isFinite(machine.overhangMeters)
    && machine.overhangMeters >= 0
    && Number.isFinite(machine.endGunThrowMeters)
    && machine.endGunThrowMeters >= 0;
}

function uniqueSources(draft: ManualDesignDraft): ManualDesignInputSource[] {
  return [...new Set([
    draft.boundary?.source,
    draft.pivot?.source,
    draft.machine?.lastWheelSource,
    draft.machine?.machineEndSource,
    ...draft.radiusEvidence.map((evidence) => evidence.source),
  ].filter((source): source is ManualDesignInputSource => Boolean(source)))];
}

function confidenceLevel(sources: ManualDesignInputSource[]): ManualDesignReadiness["sourceConfidence"]["level"] {
  if (sources.length === 0) return "unknown";
  if (sources.some((source) => source === "map_click" || source === "projected_xy" || source === "wgs84")) return "low";
  if (sources.includes("rtk_evidence")) return "high";
  if (sources.includes("imported_evidence") || sources.includes("machine_specs")) return "medium";
  return "low";
}

function collectMissingEngineeringInputs(draft: ManualDesignDraft): string[] {
  const inputs: Array<[keyof NonNullable<ManualDesignDraft["engineeringInputs"]>, string]> = [
    ["flow", "available flow"],
    ["pressure", "operating pressure"],
    ["application_intensity", "application intensity"],
    ["friction_loss", "friction loss"],
    ["nozzle_package", "nozzle package"],
    ["topography", "topography"],
    ["uniformity", "uniformity review"],
  ];
  return inputs.filter(([key]) => draft.engineeringInputs?.[key] !== true).map(([, label]) => label);
}

function reconcileBoundaryEvidence(knownCapture: ReturnType<typeof knownProjectCaptures>, boundary: NonNullable<ManualDesignDraft["boundary"]>): Array<GnssCaptureEvidence | null> | undefined {
  if (!boundary.captureEvidence) return undefined;
  if (boundary.captureEvidence.length !== boundary.vertices.length) throw new Error("Manual boundary capture evidence must align with vertices.");
  return boundary.vertices.map((point, index) => knownCapture(point, boundary.captureEvidence![index]));
}

function knownProjectCaptures(project: PivotProject): (point: XY, evidence: GnssCaptureEvidence | null | undefined) => GnssCaptureEvidence | null {
  const known = new Map<string, Set<string>>();
  const key = (point: XY) => `${point.x},${point.y}`;
  const add = (point: XY, evidence: GnssCaptureEvidence | null | undefined) => {
    if (!evidence) return;
    const values = known.get(key(point)) ?? new Set<string>();
    values.add(projectDataKey(evidence));
    known.set(key(point), values);
  };
  project.fieldBoundary.forEach((point, index) => add(point, project.fieldBoundaryCaptureEvidence?.[index]));
  project.surveyPoints.forEach((point) => add(point.projected, point.captureEvidence));
  project.obstacles.forEach((obstacle) => obstacle.polygon.forEach((point, index) => add(point, obstacle.vertexCaptureEvidence?.[index])));
  for (const feature of project.mapFeatures ?? []) {
    const vertices = feature.geometry.type === "Point" ? [feature.geometry.point]
      : feature.geometry.type === "Circle" ? [feature.geometry.center] : feature.geometry.vertices;
    vertices.forEach((point, index) => add(point, feature.vertexCaptureEvidence?.[index]));
  }
  return (point, evidence) => evidence && known.get(key(point))?.has(projectDataKey(evidence)) ? copyCaptureEvidence(evidence) : null;
}

function samePoint(left: XY, right: XY): boolean {
  return left.x === right.x && left.y === right.y;
}

function copyCaptureEvidence(evidence: GnssCaptureEvidence | null): GnssCaptureEvidence | null {
  return evidence ? {
    ...evidence,
    sentenceTypes: [...evidence.sentenceTypes],
    ...(evidence.rawRecordHashes ? { rawRecordHashes: [...evidence.rawRecordHashes] } : {}),
    ...(evidence.height ? { height: { ...evidence.height } } : {}),
  } : null;
}

function copyMachine(machine: PivotMachine): PivotMachine {
  return JSON.parse(JSON.stringify(machine)) as PivotMachine;
}

function finitePoint(point: XY): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function copyPoint(point: XY): XY {
  return { x: point.x, y: point.y };
}

function distance(left: XY, right: XY): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function minimumDistanceToRing(point: XY, ring: XY[]): number {
  return ring.reduce((minimum, start, index) => Math.min(minimum, pointToSegmentDistance(point, start, ring[(index + 1) % ring.length])), Number.POSITIVE_INFINITY);
}

function pointToSegmentDistance(point: XY, start: XY, end: XY): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, { x: start.x + dx * t, y: start.y + dy * t });
}

function pointInRing(point: XY, ring: XY[]): boolean {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
    const left = ring[current];
    const right = ring[previous];
    if (pointOnSegment(point, right, left)) return true;
    if ((left.y > point.y) !== (right.y > point.y)
      && point.x < ((right.x - left.x) * (point.y - left.y)) / (right.y - left.y) + left.x) inside = !inside;
  }
  return inside;
}

function pointOnSegment(point: XY, start: XY, end: XY): boolean {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 0.0000001) return false;
  return point.x >= Math.min(start.x, end.x) - 0.0000001
    && point.x <= Math.max(start.x, end.x) + 0.0000001
    && point.y >= Math.min(start.y, end.y) - 0.0000001
    && point.y <= Math.max(start.y, end.y) + 0.0000001;
}

function signedArea(ring: XY[]): number {
  return ring.reduce((area, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function hasSelfIntersection(ring: XY[]): boolean {
  for (let leftIndex = 0; leftIndex < ring.length; leftIndex += 1) {
    const leftStart = ring[leftIndex];
    const leftEnd = ring[(leftIndex + 1) % ring.length];
    for (let rightIndex = leftIndex + 1; rightIndex < ring.length; rightIndex += 1) {
      if (Math.abs(leftIndex - rightIndex) <= 1 || (leftIndex === 0 && rightIndex === ring.length - 1)) continue;
      if (segmentsIntersect(leftStart, leftEnd, ring[rightIndex], ring[(rightIndex + 1) % ring.length])) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const orientation = (p: XY, q: XY, r: XY): number => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  if (first !== second && third !== fourth) return true;
  return (first === 0 && pointOnSegment(c, a, b))
    || (second === 0 && pointOnSegment(d, a, b))
    || (third === 0 && pointOnSegment(a, c, d))
    || (fourth === 0 && pointOnSegment(b, c, d));
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.000001;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
