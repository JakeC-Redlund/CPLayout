import { expect, type Locator } from "@playwright/test";

export async function unobstructedMapPoint(
  map: Locator,
  requested: { x: number; y: number },
  kind: "canvas" | "svg",
): Promise<{ x: number; y: number }> {
  const point = await map.evaluate((element, input) => {
    const frame = element.getBoundingClientRect();
    const maxDistance = Math.min(48, Math.max(24, Math.min(frame.width, frame.height) * 0.12));
    if (input.x < frame.left || input.x > frame.right || input.y < frame.top || input.y > frame.bottom) return null;
    const offsets = [0, -8, 8, -16, 16, -24, 24, -32, 32, -40, 40, -48, 48];
    const candidates = offsets.flatMap(dy => offsets.map(dx => ({
      x: Math.round(input.x + dx),
      y: Math.round(input.y + dy),
      distance: dx * dx + dy * dy,
    }))).filter(candidate => candidate.distance <= maxDistance * maxDistance
      && candidate.x >= frame.left + 8 && candidate.x <= frame.right - 8
      && candidate.y >= frame.top + 8 && candidate.y <= frame.bottom - 8)
      .sort((a, b) => a.distance - b.distance);
    for (const candidate of candidates) {
      const hit = document.elementFromPoint(candidate.x, candidate.y);
      if (input.kind === "canvas" ? hit instanceof HTMLCanvasElement && element.contains(hit)
        : hit instanceof SVGElement && element.contains(hit)) return { x: candidate.x, y: candidate.y };
    }
    return null;
  }, { ...requested, kind });
  expect(point, `unobstructed ${kind} point within 48 px of requested map location`).not.toBeNull();
  if (!point) throw new Error(`No unobstructed ${kind} point near the requested map location`);
  return point;
}
