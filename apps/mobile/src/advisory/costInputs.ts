import { FEET_PER_METER, type PivotMachine } from "@cplayout/core";
import { advisoryMachinePriceMatches, type AdvisoryCostAssessment, type AdvisoryCostInput } from "@cplayout/geometry";

export interface AdvisoryCostDraft {
  basis: "machine_price" | "length_tower_estimate";
  machinePrice: string;
  pricedMachine: PivotMachine | null;
  baseCost: string;
  costPerFoot: string;
  costPerTower: string;
  currencyCode: string;
  includes: string;
}

export const EMPTY_ADVISORY_COST_DRAFT: AdvisoryCostDraft = {
  basis: "machine_price", machinePrice: "", pricedMachine: null,
  baseCost: "", costPerFoot: "", costPerTower: "", currencyCode: "USD", includes: "",
};

export function updateMachinePrice(draft: AdvisoryCostDraft, machinePrice: string, machine: PivotMachine): AdvisoryCostDraft {
  // Machines here are validated app state; retain the configuration priced at entry.
  return { ...draft, machinePrice, pricedMachine: JSON.parse(JSON.stringify(machine)) as PivotMachine };
}

function amount(text: string): number {
  const value = text.trim();
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : NaN;
}

function activeValues(draft: AdvisoryCostDraft): string[] {
  return draft.basis === "machine_price" ? [draft.machinePrice] : [draft.baseCost, draft.costPerFoot, draft.costPerTower];
}

export function advisoryCostDraftStatus(draft: AdvisoryCostDraft): AdvisoryCostAssessment["status"] {
  const values = activeValues(draft);
  if (values.some(value => value.trim() && !Number.isFinite(amount(value)))) return "invalid_cost_input";
  if (values.some(value => !value.trim()) || !draft.includes.trim()
    || (draft.basis === "machine_price" && !draft.pricedMachine)) return "missing_cost_input";
  const numbers = values.map(amount);
  const sum = numbers.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || sum <= 0 || !/^[A-Z]{3}$/.test(draft.currencyCode.trim())) return "invalid_cost_input";
  if (draft.basis === "length_tower_estimate" && !Number.isFinite(amount(draft.costPerFoot) * FEET_PER_METER)) return "invalid_cost_input";
  return "complete";
}

export function advisoryCostPriceNeedsReview(draft: AdvisoryCostDraft, machine: PivotMachine): boolean {
  return draft.basis === "machine_price" && draft.pricedMachine !== null
    && !advisoryMachinePriceMatches(draft.pricedMachine, machine);
}

export function advisoryCostInputFromDraft(draft: AdvisoryCostDraft, machine?: PivotMachine): AdvisoryCostInput | undefined {
  if (advisoryCostDraftStatus(draft) !== "complete" || (machine && advisoryCostPriceNeedsReview(draft, machine))) return undefined;
  return {
    pricing: draft.basis === "machine_price" ? {
      kind: "machine_price", amount: amount(draft.machinePrice),
      machine: JSON.parse(JSON.stringify(draft.pricedMachine)) as PivotMachine,
    } : {
      kind: "length_tower_estimate", baseCost: amount(draft.baseCost),
      costPerMeter: amount(draft.costPerFoot) * FEET_PER_METER,
      costPerTower: amount(draft.costPerTower),
    },
    currencyCode: draft.currencyCode.trim(),
    notes: `Price includes: ${draft.includes.trim()}. User-supplied planning amount; no independent price verification.`,
  };
}

export function advisoryCostDraftReadyForRadiusSensitivity(draft: AdvisoryCostDraft): boolean {
  return draft.basis === "length_tower_estimate" && advisoryCostDraftStatus(draft) === "complete";
}

export function advisoryCostDraftMessage(draft: AdvisoryCostDraft, status: AdvisoryCostAssessment["status"]): string {
  if (status === "missing_cost_input") return draft.basis === "machine_price"
    ? "Pivot price and included equipment are required. No price has been assumed."
    : "Base amount, price per foot, price per tower and included equipment are required. Enter 0 for an unused charge.";
  if (status === "invalid_cost_input") return "Enter valid amounts of 0 or more, with a total above 0, and a three-letter currency code.";
  return draft.basis === "machine_price"
    ? `${draft.currencyCode} ${amount(draft.machinePrice).toFixed(2)} for the priced pivot configuration. Different equipment needs its own price.`
    : `${draft.currencyCode} ${amount(draft.baseCost).toFixed(2)} base + ${amount(draft.costPerFoot).toFixed(2)}/ft + ${amount(draft.costPerTower).toFixed(2)}/tower. Equipment estimate only.`;
}
