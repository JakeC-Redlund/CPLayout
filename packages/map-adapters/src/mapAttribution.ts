import type { StyleSpecification } from "maplibre-gl";

export function visibleMapAttributions(style: Pick<StyleSpecification, "layers" | "sources">): string[] {
  const credits = new Set<string>();
  for (const layer of style.layers) {
    if (!("source" in layer) || typeof layer.source !== "string" || layer.layout?.visibility === "none") continue;
    const attribution = (style.sources[layer.source] as { attribution?: unknown } | undefined)?.attribution;
    if (typeof attribution === "string" && attribution.trim()) credits.add(attribution.trim());
  }
  return [...credits];
}
