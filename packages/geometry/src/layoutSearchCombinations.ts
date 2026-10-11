import type { Calculation } from "./calculation";
import type { LayoutSearchCandidate, LayoutSearchEquipment } from "./layoutSearchFeasibility";
import type { LayoutSearchPhase, LayoutSearchScenario } from "./layoutSearchTypes";

export interface LayoutSearchScored { selected: LayoutSearchCandidate[]; scenario: LayoutSearchScenario }
export interface LayoutSearchCombinationHooks {
  evaluate(selected: LayoutSearchCandidate[], phase: LayoutSearchPhase, partial?: boolean): Calculation<LayoutSearchScored | null>;
  incumbent(): LayoutSearchScored | null;
}
const better = (left: LayoutSearchScored | null, right: LayoutSearchScored | null) =>
  left !== null && (right === null || left.scenario.irrigatedUnionSquareMeters > right.scenario.irrigatedUnionSquareMeters);

/** Greedy remains independently retained before any local improvement. */
export function* layoutSearchGreedy(pinned: LayoutSearchCandidate[], pool: LayoutSearchCandidate[],
  required: LayoutSearchEquipment[], maxMachines: number, hooks: LayoutSearchCombinationHooks,
  phase: "greedy" | "multi_start", seed?: LayoutSearchCandidate,
): Calculation<LayoutSearchScored | null> {
  let selected = [...pinned];
  if (seed && !selected.some(item => item.id === seed.id)) selected.push(seed);
  for (const equipment of required) {
    if (selected.some(item => item.equipment.key === equipment.key)) continue;
    let best: LayoutSearchScored | null = null;
    for (const candidate of pool.filter(item => item.equipment.key === equipment.key)) {
      const scored = yield* hooks.evaluate([...selected, candidate], phase, true);
      if (better(scored, best)) best = scored;
    }
    if (!best) return null;
    selected = best.selected;
  }
  let current = yield* hooks.evaluate(selected, phase);
  if (!current) return null;
  while (selected.length < maxMachines) {
    let best: LayoutSearchScored | null = null;
    for (const candidate of pool) {
      if (candidate.equipment.origin !== "template" || selected.some(item => item.id === candidate.id)) continue;
      const scored = yield* hooks.evaluate([...selected, candidate], phase);
      if (better(scored, current) && better(scored, best)) best = scored;
    }
    if (!best) break;
    current = best;
    selected = current.selected;
  }
  return current;
}

/** Deterministic restarts retain mandatory identities and use exact supplied configurations. */
export function* layoutSearchMultiStart(pinned: LayoutSearchCandidate[], pool: LayoutSearchCandidate[],
  required: LayoutSearchEquipment[], maxMachines: number, hooks: LayoutSearchCombinationHooks,
): Calculation<void> {
  for (const seed of pool) {
    if (seed.equipment.pinned) continue;
    yield* layoutSearchGreedy(pinned, pool, required, maxMachines, hooks, "multi_start", seed);
  }
  if (required.length > 1) yield* layoutSearchGreedy(pinned, pool, [...required].reverse(), maxMachines, hooks, "multi_start");
}

/** One complete bounded exchange pass; later prefixes revisit improved incumbents. */
export function* layoutSearchExchanges(pool: LayoutSearchCandidate[], hooks: LayoutSearchCombinationHooks): Calculation<void> {
  const start = hooks.incumbent();
  if (!start) return;
  for (const removed of start.selected) {
    if (removed.equipment.pinned) continue;
    const remainder = start.selected.filter(item => item.id !== removed.id);
    for (let first = 0; first < pool.length; first += 1) {
      const candidate = pool[first];
      if (remainder.some(item => item.id === candidate.id)) continue;
      yield* hooks.evaluate([...remainder, candidate], "exchange_one");
      for (let second = first + 1; second < pool.length; second += 1) {
        if (remainder.some(item => item.id === pool[second].id)) continue;
        yield* hooks.evaluate([...remainder, candidate, pool[second]], "exchange_two");
      }
    }
  }
}

/** Tiny finite sets have an independent exhaustive comparison lane; still budget limited. */
export function* layoutSearchExhaustive(pinned: LayoutSearchCandidate[], pool: LayoutSearchCandidate[], maxMachines: number,
  hooks: LayoutSearchCombinationHooks): Calculation<void> {
  const movable = pool.filter(item => !item.equipment.pinned);
  if (movable.length > 12) return;
  function* visit(index: number, selected: LayoutSearchCandidate[]): Calculation<void> {
    if (index === movable.length || selected.length === maxMachines) {
      yield* hooks.evaluate(selected, "exhaustive");
      return;
    }
    yield* visit(index + 1, selected);
    yield* visit(index + 1, [...selected, movable[index]]);
  }
  yield* visit(0, pinned);
}
