interface ScreenPoint { x: number; y: number }
interface ScreenSize { width: number; height: number }
interface ScreenInsets { top: number; right: number; bottom: number; left: number }

/** CSS-pixel camera offset for MapLibre panBy; never a projected project-coordinate mutation. */
export function panOffsetToRevealPoint(
  point: ScreenPoint,
  viewport: ScreenSize,
  insets: ScreenInsets,
  margin = 18,
): ScreenPoint | null {
  if (![point.x, point.y, viewport.width, viewport.height, ...Object.values(insets), margin].every(Number.isFinite)
    || viewport.width <= 0 || viewport.height <= 0 || margin < 0
    || Object.values(insets).some(value => value < 0)) return null;
  const left = insets.left + margin;
  const right = viewport.width - insets.right - margin;
  const top = insets.top + margin;
  const bottom = viewport.height - insets.bottom - margin;
  if (left > right || top > bottom) return null;
  const x = point.x - Math.min(right, Math.max(left, point.x));
  const y = point.y - Math.min(bottom, Math.max(top, point.y));
  return Math.abs(x) < 0.5 && Math.abs(y) < 0.5 ? null : { x, y };
}
