import assert from "node:assert/strict";
import { test } from "node:test";
import { FEET_PER_METER, sampleProject } from "@cplayout/core";
import { advisoryCostDraftMessage, advisoryCostDraftReadyForRadiusSensitivity, advisoryCostDraftStatus,
  advisoryCostInputFromDraft, advisoryCostPriceNeedsReview, EMPTY_ADVISORY_COST_DRAFT, updateMachinePrice } from "./costInputs";

test("a supplied pivot price retains its original machine and does not add inactive rates", () => {
  const machine = structuredClone(sampleProject.machine);
  const draft = updateMachinePrice({ ...EMPTY_ADVISORY_COST_DRAFT, includes: "Pivot equipment only",
    baseCost: "999", costPerFoot: "300", costPerTower: "800" }, "81000", machine);
  machine.spanLengthsMeters[0]++;
  const input = advisoryCostInputFromDraft(draft)!;
  assert.equal(input.pricing?.kind, "machine_price");
  assert.ok(input.pricing?.kind === "machine_price");
  assert.equal(input.pricing.amount, 81000);
  assert.deepEqual(input.pricing.machine, sampleProject.machine);
  assert.equal(input.fixedMachineCost, undefined);
  assert.equal(input.costPerMeter, undefined);
  input.pricing.machine.spanLengthsMeters[0]++;
  assert.deepEqual(draft.pricedMachine, sampleProject.machine);
  assert.equal(advisoryCostDraftReadyForRadiusSensitivity(draft), false);
});

test("length estimates convert dollars per foot in the inverse direction of lengths", () => {
  const draft = { ...EMPTY_ADVISORY_COST_DRAFT, basis: "length_tower_estimate" as const,
    machinePrice: "999999", baseCost: "100", costPerFoot: "10", costPerTower: "20", includes: "Main pivot only" };
  const input = advisoryCostInputFromDraft(draft)!;
  assert.ok(input.pricing?.kind === "length_tower_estimate");
  assert.equal(input.pricing.costPerMeter, 10 * FEET_PER_METER);
  assert.equal(input.pricing.baseCost, 100);
  assert.ok(!("amount" in input.pricing));
  assert.equal(advisoryCostDraftReadyForRadiusSensitivity(draft), true);
  assert.match(advisoryCostDraftMessage(draft, "complete"), /10.00\/ft/);
  assert.equal(draft.costPerFoot, "10");
});

test("changed equipment requires price re-entry without discarding the original input", () => {
  const draft = updateMachinePrice({ ...EMPTY_ADVISORY_COST_DRAFT, includes: "Pivot" }, "81000", sampleProject.machine);
  const changed = structuredClone(sampleProject.machine);
  changed.spanLengthsMeters[0]++;
  assert.equal(advisoryCostPriceNeedsReview(draft, changed), true);
  assert.equal(advisoryCostInputFromDraft(draft, changed), undefined);
  assert.equal(draft.machinePrice, "81000");
  assert.ok(advisoryCostInputFromDraft(draft, { ...sampleProject.machine, id: "new-id" }));
  const repriced = updateMachinePrice(draft, "82000", changed);
  assert.equal(advisoryCostPriceNeedsReview(repriced, changed), false);
  assert.ok(advisoryCostInputFromDraft(repriced, changed));
});

test("missing and invalid amounts never produce an assumed or zero price", () => {
  assert.equal(advisoryCostInputFromDraft(EMPTY_ADVISORY_COST_DRAFT), undefined);
  for (const value of ["0", "-1", "Infinity", "NaN", "0x10", "1e3", "1,000", ".", "9".repeat(400)]) {
    const draft = updateMachinePrice({ ...EMPTY_ADVISORY_COST_DRAFT, includes: "Pivot" }, value, sampleProject.machine);
    assert.equal(advisoryCostDraftStatus(draft), "invalid_cost_input", value);
    assert.equal(advisoryCostInputFromDraft(draft), undefined);
    assert.equal(draft.machinePrice, value);
  }
  const withoutScope = updateMachinePrice(EMPTY_ADVISORY_COST_DRAFT, "100", sampleProject.machine);
  assert.equal(advisoryCostDraftStatus(withoutScope), "missing_cost_input");
  assert.equal(advisoryCostInputFromDraft(withoutScope), undefined);
});

test("all estimate components must be explicitly entered, including unused zero charges", () => {
  const draft = { ...EMPTY_ADVISORY_COST_DRAFT, basis: "length_tower_estimate" as const,
    baseCost: "100", costPerFoot: "", costPerTower: "0", includes: "Pivot" };
  assert.equal(advisoryCostDraftStatus(draft), "missing_cost_input");
  assert.equal(advisoryCostDraftStatus({ ...draft, costPerFoot: "0" }), "complete");
  assert.equal(advisoryCostDraftStatus({ ...draft, costPerFoot: "9".repeat(308) }), "invalid_cost_input");
  assert.equal(advisoryCostDraftStatus({ ...draft, costPerFoot: "0", currencyCode: "" }), "invalid_cost_input");
});
