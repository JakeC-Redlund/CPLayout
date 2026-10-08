import type { Calculation } from "./calculation";
import type { LayoutSearchCandidate, LayoutSearchEquipment } from "./layoutSearchFeasibility";
import type { LayoutSearchPhase } from "./layoutSearchTypes";

export interface LayoutSearchScalarScore { selected: LayoutSearchCandidate[]; areaSquareMeters: number; overlapSquareMeters: number }
export interface LayoutSearchScalarHooks {
  evaluate(selected: LayoutSearchCandidate[], phase: LayoutSearchPhase, partial?: boolean): Calculation<LayoutSearchScalarScore | null>;
  incumbent(): LayoutSearchScalarScore | null;
  tolerance: number;
}
export function* layoutSearchGreedyV2(pinned: LayoutSearchCandidate[], pool: LayoutSearchCandidate[], required: LayoutSearchEquipment[],
  maxMachines: number, hooks: LayoutSearchScalarHooks, phase: "greedy" | "multi_start", seed?: LayoutSearchCandidate): Calculation<void> {
  let selected = [...pinned];
  if (seed && !selected.some(item => item.id === seed.id)) selected.push(seed);
  const better = (a: LayoutSearchScalarScore | null, b: LayoutSearchScalarScore | null) => a !== null
    && (b === null || a.areaSquareMeters > b.areaSquareMeters + hooks.tolerance);
  for (const equipment of required) {
    if (selected.some(item => item.equipment.key === equipment.key)) continue;
    let best: LayoutSearchScalarScore | null = null;
    for (const candidate of pool.filter(item => item.equipment.key === equipment.key)) {
      const scored = yield* hooks.evaluate([...selected, candidate], phase, true);
      if (better(scored, best)) best = scored;
    }
    if (!best) return;
    selected = best.selected;
  }
  let current = yield* hooks.evaluate(selected, phase);
  if (!current) return;
  while (selected.length < maxMachines) {
    let best: LayoutSearchScalarScore | null = null;
    for (const candidate of pool) {
      if (candidate.equipment.origin !== "template" || selected.some(item => item.id === candidate.id)) continue;
      const scored = yield* hooks.evaluate([...selected, candidate], phase);
      if (better(scored, current) && better(scored, best)) best = scored;
    }
    if (!best) break;
    current = best; selected = current.selected;
  }
}
export function* layoutSearchMultiStartV2(pinned: LayoutSearchCandidate[], pool: LayoutSearchCandidate[], required: LayoutSearchEquipment[],
  maxMachines: number, hooks: LayoutSearchScalarHooks): Calculation<void> {
  for (const seed of pool) if (!seed.equipment.pinned) yield* layoutSearchGreedyV2(pinned, pool, required, maxMachines, hooks, "multi_start", seed);
  if (required.length > 1) yield* layoutSearchGreedyV2(pinned, pool, [...required].reverse(), maxMachines, hooks, "multi_start");
}
export function* layoutSearchExchangesV2(pool: LayoutSearchCandidate[], hooks: LayoutSearchScalarHooks): Calculation<void> {
  const start = hooks.incumbent();
  if (!start) return;
  for (const removed of start.selected) {
    if (removed.equipment.pinned) continue;
    const remainder = start.selected.filter(item => item.id !== removed.id);
    for (let first = 0; first < pool.length; first += 1) {
      if (remainder.some(item => item.id === pool[first].id)) continue;
      yield* hooks.evaluate([...remainder, pool[first]], "exchange_one");
      for (let second = first + 1; second < pool.length; second += 1) {
        if (!remainder.some(item => item.id === pool[second].id)) yield* hooks.evaluate([...remainder, pool[first], pool[second]], "exchange_two");
      }
    }
  }
}
export function* layoutSearchExhaustiveV2(pinned: LayoutSearchCandidate[], pool: LayoutSearchCandidate[], maxMachines: number,
  hooks: LayoutSearchScalarHooks): Calculation<void> {
  const movable = pool.filter(item => !item.equipment.pinned);
  if (movable.length > 12) return;
  function* visit(index: number, selected: LayoutSearchCandidate[]): Calculation<void> {
    if (index === movable.length || selected.length === maxMachines) { yield* hooks.evaluate(selected, "exhaustive"); return; }
    yield* visit(index + 1, selected);
    yield* visit(index + 1, [...selected, movable[index]]);
  }
  yield* visit(0, pinned);
}
