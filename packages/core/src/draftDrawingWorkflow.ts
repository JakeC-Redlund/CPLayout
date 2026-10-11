import { z } from "zod";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { validateDraftBoundary } from "./manualDesign";
import { isBoundaryWithinCalculationBudget } from "./projectCalculationSafety";
import type { XY } from "./types";
import { assertProjectedCrs } from "./units";

export const DRAFT_DRAWING_WORKFLOW_VERSION = "draft-drawing-workflow-v1";
// Computational limits, not field-size or survey-accuracy limits. Never truncate input.
export const MAX_DRAFT_CAPTURE_VERTICES = 2048;
export const MAX_DRAFT_WORKFLOW_VERTICES = 8192;
export const MAX_DRAFT_WORKFLOW_CAPTURES = 128;

const geometryType = z.enum(["Point", "LineString", "Polygon"]);
const identifier = z.string().min(1);
const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const vertex = z.object({
  point,
  recordedAt: z.iso.datetime({ offset: true }),
  wgs84: z.null(),
  elevation: z.null(),
}).strict();
const classification = z.object({ purposeId: identifier.nullable(), name: z.string(), notes: z.string() }).strict();
const projectedCrs = identifier.superRefine((value, context) => {
  try {
    assertProjectedCrs(value);
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid projected CRS." });
  }
});

// Guard public schemas as well as reducer calls against accessor/serialization side effects.
function snapshotInput(value: unknown, context: z.RefinementCtx): unknown {
  try {
    return snapshotJsonValue(value, "drawing workflow");
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Expected plain JSON data." });
    return z.NEVER;
  }
}

const CaptureSchema = z.object({
  id: identifier,
  name: identifier,
  projectCrs: projectedCrs,
  geometryType,
  stage: z.enum(["drawing", "classification"]),
  source: z.literal("map_digitized"),
  vertices: z.array(vertex).max(MAX_DRAFT_CAPTURE_VERTICES),
  classification,
}).strict().superRefine((capture, context) => {
  if (capture.geometryType === "Point" && capture.vertices.length > 1) {
    context.addIssue({ code: "custom", path: ["vertices"], message: "Point capture permits at most one vertex." });
  }
  if (capture.stage === "classification") {
    const error = draftDrawingFinishError(capture.geometryType, capture.vertices.map(item => item.point));
    if (error) context.addIssue({ code: "custom", path: ["vertices"], message: error });
  }
});

export const DraftDrawingWorkflowSchema = z.preprocess(snapshotInput, z.object({
  schemaVersion: z.literal(DRAFT_DRAWING_WORKFLOW_VERSION),
  autosaveEnabled: z.boolean(),
  lockedCrs: projectedCrs.nullable(),
  activeCaptureId: identifier.nullable(),
  captures: z.array(CaptureSchema).max(MAX_DRAFT_WORKFLOW_CAPTURES),
}).strict().superRefine((workflow, context) => {
  const ids = new Set<string>();
  let count = 0;
  workflow.captures.forEach((capture, index) => {
    if (ids.has(capture.id)) context.addIssue({ code: "custom", path: ["captures", index, "id"], message: "Duplicate capture identity." });
    ids.add(capture.id);
    count += capture.vertices.length;
    if ((capture.vertices.length > 0 || workflow.lockedCrs !== null) && capture.projectCrs !== workflow.lockedCrs) {
      context.addIssue({ code: "custom", path: ["captures", index, "projectCrs"], message: "Captured coordinates require a matching permanent workflow CRS lock." });
    }
  });
  if (workflow.activeCaptureId !== null && !ids.has(workflow.activeCaptureId)) {
    context.addIssue({ code: "custom", path: ["activeCaptureId"], message: "Active capture must resolve to a stored capture." });
  }
  if (count > MAX_DRAFT_WORKFLOW_VERTICES) {
    context.addIssue({ code: "custom", path: ["captures"], message: "Drawing workflow exceeds its stored-vertex budget." });
  }
}));

export type DraftDrawingWorkflow = z.output<typeof DraftDrawingWorkflowSchema>;
export type DraftDrawingCapture = DraftDrawingWorkflow["captures"][number];
export type DraftDrawingVertex = DraftDrawingCapture["vertices"][number];
export type DraftDrawingGeometryType = DraftDrawingCapture["geometryType"];

const idCommand = { id: identifier };
export const DraftDrawingCommandSchema = z.preprocess(snapshotInput, z.discriminatedUnion("type", [
  z.object({ type: z.literal("begin"), ...idCommand, name: identifier, geometryType }).strict(),
  z.object({ type: z.literal("append_vertex"), ...idCommand, vertex }).strict(),
  z.object({ type: z.literal("remove_last_vertex"), ...idCommand }).strict(),
  z.object({ type: z.literal("finish"), ...idCommand }).strict(),
  z.object({ type: z.literal("return_to_drawing"), ...idCommand }).strict(),
  z.object({ type: z.literal("pause"), ...idCommand }).strict(),
  z.object({ type: z.literal("resume"), ...idCommand }).strict(),
  z.object({ type: z.literal("set_classification"), ...idCommand, classification }).strict(),
  z.object({ type: z.literal("discard"), ...idCommand }).strict(),
  z.object({ type: z.literal("set_autosave"), enabled: z.boolean() }).strict(),
]));
export type DraftDrawingCommand = z.output<typeof DraftDrawingCommandSchema>;

/** Defaults belong only to a new workflow, never to saved-data admission. */
export function createDraftDrawingWorkflow(): DraftDrawingWorkflow {
  return { schemaVersion: DRAFT_DRAWING_WORKFLOW_VERSION, autosaveEnabled: true, lockedCrs: null,
    activeCaptureId: null, captures: [] };
}

/** A form proposal is not classification approval or a completed map feature. */
export function reduceDraftDrawingWorkflow(
  previous: DraftDrawingWorkflow | undefined, projectCrs: string | null, input: DraftDrawingCommand,
): DraftDrawingWorkflow {
  const crs = projectedCrs.nullable().parse(projectCrs);
  const command = DraftDrawingCommandSchema.parse(input);
  const workflow = previous === undefined ? createDraftDrawingWorkflow() : DraftDrawingWorkflowSchema.parse(previous);
  if (workflow.lockedCrs !== null && workflow.lockedCrs !== crs) {
    throw new Error("Drawing coordinates cannot be relabeled with another CRS.");
  }
  if (workflow.captures.some(capture => capture.projectCrs !== crs)) {
    throw new Error("Every drawing capture must match the supplied project CRS.");
  }
  if (command.type === "set_autosave") workflow.autosaveEnabled = command.enabled;
  else if (command.type === "begin") {
    if (crs === null) throw new Error("Select the coordinate system before starting a drawing.");
    if (workflow.activeCaptureId !== null) throw new Error("Pause or discard the active capture before starting another.");
    if (workflow.captures.some(capture => capture.id === command.id)) throw new Error("Capture identity already exists.");
    workflow.captures.push({ id: command.id, name: command.name, projectCrs: crs,
      geometryType: command.geometryType, stage: "drawing", source: "map_digitized", vertices: [],
      classification: { purposeId: null, name: command.name, notes: "" } });
    workflow.activeCaptureId = command.id;
  } else {
    const capture = workflow.captures.find(item => item.id === command.id);
    if (!capture) throw new Error("Drawing capture was not found.");
    if (capture.projectCrs !== crs) throw new Error("Drawing coordinates cannot be relabeled with another CRS.");
    if (command.type === "resume") {
      if (workflow.activeCaptureId !== null && workflow.activeCaptureId !== command.id) {
        throw new Error("Pause the active capture before resuming another.");
      }
      workflow.activeCaptureId = command.id;
    } else if (command.type === "discard") {
      workflow.captures = workflow.captures.filter(item => item.id !== command.id);
      if (workflow.activeCaptureId === command.id) workflow.activeCaptureId = null;
    } else {
      if (workflow.activeCaptureId !== command.id) throw new Error("Resume this drawing before editing it.");
      switch (command.type) {
        case "pause": workflow.activeCaptureId = null; break;
        case "finish": {
          if (capture.stage !== "drawing") throw new Error("Return to drawing before finishing geometry again.");
          const error = draftDrawingFinishError(capture.geometryType, capture.vertices.map(item => item.point));
          if (error) throw new Error(error);
          capture.stage = "classification";
          break;
        }
        case "return_to_drawing":
          if (capture.stage !== "classification") throw new Error("This capture is already in drawing stage.");
          capture.stage = "drawing";
          break;
        case "set_classification":
          if (capture.stage !== "classification") throw new Error("Finish geometry before classifying it.");
          capture.classification = command.classification;
          break;
        case "append_vertex":
        case "remove_last_vertex":
          if (capture.stage !== "drawing") throw new Error("Return to drawing before changing vertices.");
          if (command.type === "append_vertex") {
            capture.vertices.push(command.vertex);
            workflow.lockedCrs = workflow.lockedCrs ?? capture.projectCrs;
          } else {
            if (capture.vertices.length === 0) throw new Error("Drawing has no vertex to remove.");
            capture.vertices.pop();
          }
          break;
      }
    }
  }
  return DraftDrawingWorkflowSchema.parse(workflow);
}

export function draftDrawingFinishError(type: DraftDrawingGeometryType, points: readonly XY[]): string | null {
  let parsed: { type: DraftDrawingGeometryType; points: XY[] };
  try {
    parsed = z.object({ type: geometryType, points: z.array(point).max(MAX_DRAFT_CAPTURE_VERTICES) }).strict()
      .parse(snapshotJsonValue({ type, points }, "drawing geometry"));
  } catch {
    return "Drawing geometry must contain a supported type and finite projected XY within the vertex budget.";
  }
  const vertices = parsed.points;
  if (!isBoundaryWithinCalculationBudget(vertices)) return "Coordinates exceed the drawing calculation range.";
  if (parsed.type === "Point") return vertices.length === 1 ? null : "Capture exactly one point.";
  if (vertices.some((item, index) => index > 0 && item.x === vertices[index - 1].x && item.y === vertices[index - 1].y)) {
    return "Adjacent points must be different.";
  }
  if (parsed.type === "LineString") return vertices.length >= 2 ? null : "Capture at least two points.";
  if (vertices.length > 1 && vertices[0].x === vertices[vertices.length - 1].x
    && vertices[0].y === vertices[vertices.length - 1].y) {
    return "Polygon vertices must form an open ring without a duplicate closing point.";
  }
  return validateDraftBoundary(vertices)[0]?.message ?? null;
}
