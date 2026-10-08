import type { XY } from "@cplayout/core";
import { visibleHeightMeters, visibleWidthMeters, type DrawingMapState } from "@cplayout/geometry";

type Viewport = DrawingMapState["viewport"];
export interface MapLabelCandidate {
  id: string;
  text: string;
  point: XY;
  color: string;
  priority: number;
  featureId?: string;
  caption?: string;
}
export interface PixelBox { x: number; y: number; width: number; height: number }
export interface PixelAnchors { left?: number; right?: number; top?: number; bottom?: number }

export function anchoredPixelBox(rect: PixelBox, screen: { width: number; height: number }, anchors: PixelAnchors): PixelBox {
  return { width: rect.width, height: rect.height,
    x: anchors.left ?? (anchors.right === undefined ? rect.x : screen.width - anchors.right - rect.width),
    y: anchors.top ?? (anchors.bottom === undefined ? rect.y : screen.height - anchors.bottom - rect.height) };
}
export interface PlacedMapLabel extends MapLabelCandidate {
  displayText: string;
  box: PixelBox;
  svgX: number;
  svgY: number;
}

export const MAP_LABEL_FONT_PIXELS = 12;

export function visibleCircleLabelPoint(center: XY, radius: number, viewport: Viewport): XY | null {
  const halfWidth = visibleWidthMeters(viewport) / 2, halfHeight = visibleHeightMeters(viewport) / 2;
  if (![center.x, center.y, radius, halfWidth, halfHeight, viewport.center.x, viewport.center.y].every(Number.isFinite)
    || Math.min(radius, halfWidth, halfHeight) <= 0) return null;
  const minX = viewport.center.x - halfWidth, maxX = viewport.center.x + halfWidth;
  const minY = viewport.center.y - halfHeight, maxY = viewport.center.y + halfHeight;
  const turn = 2 * Math.PI;
  const angles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5,
    Math.atan2(viewport.center.y - center.y, viewport.center.x - center.x)];
  for (const x of [minX, maxX]) {
    const cosine = (x - center.x) / radius;
    if (Math.abs(cosine) <= 1) { const angle = Math.acos(cosine); angles.push(angle, -angle); }
  }
  for (const y of [minY, maxY]) {
    const sine = (y - center.y) / radius;
    if (Math.abs(sine) <= 1) { const angle = Math.asin(sine); angles.push(angle, Math.PI - angle); }
  }
  const sorted = angles.map(angle => (angle + turn) % turn).sort((a, b) => a - b);
  // Between rectangle-edge intersections, an arc is entirely inside or outside the viewport.
  const candidates = [...sorted, ...sorted.map((angle, index) =>
    (angle + (sorted[index + 1] ?? sorted[0] + turn)) / 2)];
  let best: XY | null = null, distance = Infinity;
  for (const angle of candidates) {
    const point = { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
    if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) continue;
    const nextDistance = Math.hypot(point.x - viewport.center.x, point.y - viewport.center.y);
    if (nextDistance < distance) { best = point; distance = nextDistance; }
  }
  return best;
}

/** Anchor on a visible segment, not an offscreen endpoint or an exterior polygon average. */
export function visiblePathLabelPoint(vertices: readonly XY[], viewport: Viewport, closed = false): XY | null {
  const halfWidth = visibleWidthMeters(viewport) / 2, halfHeight = visibleHeightMeters(viewport) / 2;
  if (![halfWidth, halfHeight, viewport.center.x, viewport.center.y].every(Number.isFinite)
    || halfWidth <= 0 || halfHeight <= 0) return null;
  let best: XY | null = null, distance = Infinity;
  for (let i = 1; i < vertices.length + (closed ? 1 : 0); i++) {
    const a = vertices[i - 1], b = vertices[i % vertices.length];
    if (!a || !b || ![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
    let start = 0, end = 1;
    for (const [origin, delta, min, max] of [
      [a.x, b.x - a.x, viewport.center.x - halfWidth, viewport.center.x + halfWidth],
      [a.y, b.y - a.y, viewport.center.y - halfHeight, viewport.center.y + halfHeight],
    ]) {
      if (delta === 0) { if (origin < min || origin > max) end = -1; }
      else {
        const first = (min - origin) / delta, last = (max - origin) / delta;
        start = Math.max(start, Math.min(first, last));
        end = Math.min(end, Math.max(first, last));
      }
    }
    if (end < start) continue;
    const t = (start + end) / 2;
    const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const nextDistance = Math.hypot(point.x - viewport.center.x, point.y - viewport.center.y);
    if (nextDistance < distance) { best = point; distance = nextDistance; }
  }
  return best;
}

export function createSvgSymbolScale(viewport: Viewport, renderedPixelWidth: number) {
  const unitsPerPixel = visibleWidthMeters(viewport) / Math.max(1, renderedPixelWidth);
  // A world-unit floor makes a nominal screen-sized marker grow as the camera zooms in.
  const px = (screenPixels: number) => screenPixels * unitsPerPixel;
  return { px, stroke: px, font: px };
}

function overlaps(a: PixelBox, b: PixelBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Greedy display-only placement. Neither feature geometry nor label anchors are moved. */
export function placeMapLabels(
  candidates: readonly MapLabelCandidate[], viewport: Viewport,
  screen: { width: number; height: number },
  reservedPoints: readonly XY[] = [],
  excludedBoxes: readonly PixelBox[] = [],
): PlacedMapLabel[] {
  const width = visibleWidthMeters(viewport), height = visibleHeightMeters(viewport);
  if (![width, height, screen.width, screen.height, viewport.center.x, viewport.center.y].every(Number.isFinite)
    || Math.min(width, height, screen.width, screen.height) <= 0) return [];
  const minX = viewport.center.x - width / 2, maxY = viewport.center.y + height / 2;
  const visible = candidates.filter(label => Number.isFinite(label.point.x) && Number.isFinite(label.point.y)
    && Number.isFinite(label.priority) && label.text.trim()).map(label => ({
    label, x: (label.point.x - minX) / width * screen.width,
    y: (maxY - label.point.y) / height * screen.height,
  })).filter(({ x, y }) => x >= 0 && y >= 0 && x <= screen.width && y <= screen.height)
    .sort((a, b) => b.label.priority - a.label.priority || a.label.id.localeCompare(b.label.id));
  const markers = [...visible, ...reservedPoints.map(point => ({
    x: (point.x - minX) / width * screen.width, y: (maxY - point.y) / height * screen.height,
  }))].filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)
    && x >= -16 && y >= -16 && x <= screen.width + 16 && y <= screen.height + 16)
    .map(({ x, y }) => ({ x: x - 16, y: y - 16, width: 32, height: 32 }));
  const occupied: PixelBox[] = [...markers, ...excludedBoxes.filter(box => Object.values(box).every(Number.isFinite)
    && box.width >= 0 && box.height >= 0).map(box => ({
    x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8,
  }))];
  const placed: PlacedMapLabel[] = [];
  const placeAtDistance = (distance: number, firstOnly = false): void => {
    for (const { label, x, y } of visible) {
      const characters = Array.from((label.caption ?? label.text).replace(/\s+/g, " ").trim());
      const displayText = characters.length > 28 ? `${characters.slice(0, 25).join("")}...` : characters.join("");
      // Conservative monospace bounds, reserving a full em for non-ASCII glyphs.
      const w = Array.from(displayText).reduce((sum, char) => sum + (char.codePointAt(0)! < 128 ? 8 : MAP_LABEL_FONT_PIXELS), 8), h = 22;
      const options: PixelBox[] = [
        { x: x + distance, y: y - h / 2, width: w, height: h },
        { x: x - w - distance, y: y - h / 2, width: w, height: h },
        { x: x - w / 2, y: y - h - distance, width: w, height: h },
        { x: x - w / 2, y: y + distance, width: w, height: h },
      ];
      const box = options.find(b => b.x >= 4 && b.y >= 4 && b.x + b.width <= screen.width - 4
        && b.y + b.height <= screen.height - 4 && !occupied.some(other => overlaps(b, other)));
      if (!box) continue;
      occupied.push({ x: box.x - 3, y: box.y - 3, width: box.width + 6, height: box.height + 6 });
      placed.push({ ...label, displayText, box,
        svgX: minX + (box.x + 4) / screen.width * width,
        svgY: -maxY + (box.y + 15) / screen.height * height });
      if (firstOnly) return;
    }
  };
  placeAtDistance(20);
  // Keep normal density unchanged. An otherwise unlabeled map may show one
  // nearby caption if a second ring clears the same markers and controls.
  if (placed.length === 0) placeAtDistance(40, true);
  return placed;
}
