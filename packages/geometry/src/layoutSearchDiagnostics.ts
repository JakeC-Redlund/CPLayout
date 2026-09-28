import { projectDataKey, squareMetersToAcres, type FieldPivotMachine } from "@cplayout/core";
import type { LayoutSearchCandidate } from "./layoutSearchFeasibility";
import { layoutSearchCoverage } from "./layoutSearchCoverage";
import type { LayoutSearchPairClearance, LayoutSearchPrice, LayoutSearchRejection, LayoutSearchRequest, LayoutSearchScenario } from "./layoutSearchTypes";

export function layoutSearchPriceMatches(price: LayoutSearchPrice, machine: FieldPivotMachine): boolean {
  const { id: _id, ...configuration } = price.machine;
  return Number.isFinite(price.amount) && price.amount >= 0 && /^[A-Z]{3}$/.test(price.currencyCode)
    && projectDataKey(configuration) === projectDataKey(machine.configuration);
}
export function layoutSearchScenario(request: LayoutSearchRequest, selected: LayoutSearchCandidate[], pairs: LayoutSearchPairClearance[]): LayoutSearchScenario {
  const { coverage, areaSquareMeters, overlapSquareMeters } = layoutSearchCoverage(selected.map(candidate => candidate.layout.allowedCoverage));
  const sorted = [...selected].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const usedIds = new Set(request.field.machines.map(machine => machine.id));
  const templateCounts = new Map<string, number>();
  const machines = sorted.map(candidate => {
    const equipment = candidate.equipment;
    let id = equipment.machine.id;
    if (equipment.origin === "template") {
      const count = (templateCounts.get(equipment.id) ?? 0) + 1;
      templateCounts.set(equipment.id, count);
      id = `layout-search:${equipment.id}:${count}`;
      while (usedIds.has(id)) id += ":new";
      usedIds.add(id);
    }
    const machine = { ...equipment.machine, id, pivotCenter: candidate.center };
    if (machine.pivotCenter.x !== equipment.machine.pivotCenter.x || machine.pivotCenter.y !== equipment.machine.pivotCenter.y) delete machine.pivotObservationId;
    return { candidateId: candidate.id, source: { kind: equipment.origin, id: equipment.id }, machine, pinned: equipment.pinned };
  });
  let amount = 0, currencyCode: string | null = null, complete = selected.length > 0;
  for (const candidate of selected) {
    const price = candidate.equipment.price;
    if (!price || !layoutSearchPriceMatches(price, candidate.equipment.machine)
      || (currencyCode !== null && currencyCode !== price.currencyCode)) { complete = false; continue; }
    currencyCode = price.currencyCode;
    amount += price.amount;
  }
  const acres = squareMetersToAcres(areaSquareMeters);
  complete &&= Number.isFinite(amount) && acres > 0 && Number.isFinite(amount / acres);
  return { machines, modeledCoverageUnion: coverage, irrigatedUnionSquareMeters: areaSquareMeters,
    irrigatedUnionAcres: acres, overlapSquareMeters, machineCount: selected.length, pairClearances: pairs,
    minimumPairClearanceMeters: pairs.length ? Math.min(...pairs.map(pair => pair.clearanceBeyondRequiredMeters)) : null,
    cost: complete ? { amount, currencyCode, costPerIrrigatedAcre: amount / acres }
      : { amount: null, currencyCode: null, costPerIrrigatedAcre: null } };
}
/** Aggregate repeated failures so diagnostic memory stays bounded by the evaluation budget. */
export function layoutSearchRejectionRecorder() {
  const rows = new Map<string, LayoutSearchRejection>();
  return { reject(scope: LayoutSearchRejection["scope"], id: string, reason: string) {
    const key = JSON.stringify([scope, id, reason]);
    const previous = rows.get(key);
    if (previous) previous.occurrences += 1;
    else rows.set(key, { scope, id, reason, occurrences: 1 });
  }, rows: () => [...rows.values()] };
}
