import { expect, type Page } from "@playwright/test";

// Deliberately fictional operator declarations; no receiver or field qualification.
export const SYNTHETIC_GNSS_REFERENCE_DECLARATION = {
  schemaVersion: "gnss-reference-declaration-v1",
  provenance: "operator_declared",
  receiverModel: "SYNTHETIC browser receiver",
  receiverFirmware: "SYNTHETIC firmware 1",
  referenceFrame: "WGS84",
  realization: "SYNTHETIC frame realization",
  coordinateEpochUtc: "2026-09-13T00:00:00.000Z",
  verticalDatum: "SYNTHETIC vertical datum",
  geoidModel: "SYNTHETIC geoid model",
  antennaModel: "SYNTHETIC antenna",
  antennaReference: "arp",
  reportedPoint: "SYNTHETIC antenna ARP",
  targetPoint: "SYNTHETIC antenna ARP",
  antennaHeightMeters: 1.5,
  offsetTreatment: "none_reported_point",
} as const;

export const SYNTHETIC_GNSS_REFERENCE_INPUTS = [
  ["Receiver model", SYNTHETIC_GNSS_REFERENCE_DECLARATION.receiverModel],
  ["Receiver firmware", SYNTHETIC_GNSS_REFERENCE_DECLARATION.receiverFirmware],
  ["Frame realization", SYNTHETIC_GNSS_REFERENCE_DECLARATION.realization],
  ["Coordinate epoch UTC", SYNTHETIC_GNSS_REFERENCE_DECLARATION.coordinateEpochUtc],
  ["Vertical datum", SYNTHETIC_GNSS_REFERENCE_DECLARATION.verticalDatum],
  ["Geoid model", SYNTHETIC_GNSS_REFERENCE_DECLARATION.geoidModel],
  ["Antenna model", SYNTHETIC_GNSS_REFERENCE_DECLARATION.antennaModel],
  ["Reported point", SYNTHETIC_GNSS_REFERENCE_DECLARATION.reportedPoint],
  ["Target point", SYNTHETIC_GNSS_REFERENCE_DECLARATION.targetPoint],
  ["Antenna height metres", String(SYNTHETIC_GNSS_REFERENCE_DECLARATION.antennaHeightMeters)],
] as const;

export async function fillSyntheticGnssReferenceDeclaration(page: Page): Promise<void> {
  const toggle = page.getByTestId("gnss-reference-toggle");
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  const body = page.getByTestId("gnss-reference-body");
  await expect(body).toBeVisible();
  for (const [label, value] of SYNTHETIC_GNSS_REFERENCE_INPUTS) {
    await body.getByRole("textbox", { name: label, exact: true }).fill(value);
  }
  await body.getByRole("radio", { name: "ARP", exact: true }).click();
  await body.getByRole("radio", { name: "Reported point only", exact: true }).click();
  await expect(body.getByRole("radio", { name: "ARP", exact: true })).toBeChecked();
  await expect(body.getByRole("radio", { name: "Reported point only", exact: true })).toBeChecked();
  await expect(page.getByTestId("gnss-reference-form")).toContainText("Declared, unverified");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(body).toBeHidden();
}
