import { metersToFeet, qualifyProjectCrs, type FieldLayoutTarget, type XY } from "@cplayout/core";

/** A display transform only. Callers retain the original target and observation coordinates. */
export function layoutTargetViewport(target: FieldLayoutTarget, width = 640, height = 360): {
  width: number; height: number; point: (point: Readonly<XY>) => XY;
} {
  const points = [...target.field.fieldBoundary, ...target.field.machines.map(machine => machine.pivotCenter)];
  const safe = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  const bounds = safe.reduce((result, point) => ({ minX: Math.min(result.minX, point.x), maxX: Math.max(result.maxX, point.x), minY: Math.min(result.minY, point.y), maxY: Math.max(result.maxY, point.y) }),
    safe.length ? { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity } : { minX: 0, maxX: 1, minY: 0, maxY: 1 });
  const { minX, maxX, minY, maxY } = bounds;
  const padding = 28;
  const scale = Math.min((width - padding * 2) / Math.max(maxX - minX, 1), (height - padding * 2) / Math.max(maxY - minY, 1));
  const midX = minX + (maxX - minX) / 2;
  const midY = minY + (maxY - minY) / 2;
  return { width, height, point: point => ({ x: width / 2 + (point.x - midX) * scale, y: height / 2 - (point.y - midY) * scale }) };
}

export function layoutCoordinateLabel(point: Readonly<XY>, target: FieldLayoutTarget): string {
  const qualification = qualifyProjectCrs(target.field.projectCrs, target.crsOptions);
  if (qualification.unit === "metre") return `E ${metersToFeet(point.x).toFixed(2)} ft · N ${metersToFeet(point.y).toFixed(2)} ft`;
  return `X ${point.x.toFixed(3)} · Y ${point.y.toFixed(3)} (coordinate units unconfirmed)`;
}

export function layoutSessionFilename(name: string, format: "json" | "zip"): string {
  const safe = name.normalize("NFKC").replace(/[^a-zA-Z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "layout-session";
  return `${safe}.layout.${format}`;
}

export function layoutErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /revision|conflict|changed since|stale/i.test(message)
    ? `${message} Reload saved work, then review and retry. Your entered text has been kept.`
    : message;
}
