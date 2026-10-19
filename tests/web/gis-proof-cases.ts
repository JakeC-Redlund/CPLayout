/** Source classifications describe the required browser assertion, never a
 * passing run or native capability. The inventory binds each concrete title. */
export type GisRendererRequirement = "maplibre-required" | "svg-required" | "renderer-independent";
export const GIS_PROOF_CASES = [
  { title: "GL required: actual GIS journey loads local workers and preserves camera ownership and exact XY", renderer: "maplibre-required" },
  { title: "GL required: drawing and undo remain live while synthetic raster requests are delayed", renderer: "maplibre-required" },
  { title: "SVG required: induced graphics loss retains pending drawing, camera and saved source", renderer: "svg-required" },
  { title: "Renderer independent: GIS controls compare visually and support natural Tab and Escape focus return", renderer: "renderer-independent" },
  { title: "Renderer independent: short portrait and landscape retain drawing clearance and reachable controls", renderer: "renderer-independent" },
] as const satisfies readonly { title: string; renderer: GisRendererRequirement }[];

export const GIS_PACKAGE_PROOF_CASES = [
  { title: "GL required: portable permitted GIS package stays unresolved while synthetic live fallback preserves metadata", renderer: "maplibre-required" },
  { title: "GL required: denied offline raster package issues no package requests and preserves source metadata", renderer: "maplibre-required" },
  { title: "GL required: raster package without provenance stays unqualified while fallback preserves metadata", renderer: "maplibre-required" },
] as const satisfies readonly { title: string; renderer: GisRendererRequirement }[];
