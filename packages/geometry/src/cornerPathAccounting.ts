import * as polygonClipping from "polyclip-ts";
import { squareMetersToAcres, type MultiPolygonXY, type XY } from "@cplayout/core";
import { multiPolygonAreaSquareMeters } from "./geometry";

type Clip = [number, number][][][];
export interface CornerFootprintOptions {
  /** Missing reach means unknown area, not a zero-radius sprinkler. */
  reachStatus?: "missing" | "explicit_zero" | "declared";
  /** Explicit polygon extents only; mechanical obstacle buffers do not enlarge spray exclusions. */
  noSprayFootprints?: MultiPolygonXY[];
}
export interface CornerFootprintAccounting {
  method: "sampled-potential-footprint-union-v1";
  ledgerVersion: 2;
  reachStatus: "missing" | "explicit_zero" | "declared";
  potentialFootprint: MultiPolygonXY;
  potentialFootprintAcres: number | null;
  netAdditionalFootprint: MultiPolygonXY | null;
  netAdditionalFootprintAcres: number | null;
  baselineStatus: "supplied" | "missing";
  /** Raw planar union areas. Null is unknown. No display rounding enters subtraction. */
  areasSquareMeters: {
    grossPotential: number | null; outsideField: number | null; insideField: number | null;
    excludedNoSpray: number | null; eligiblePotential: number | null; baselineOverlap: number | null;
    netAdditional: number | null;
  };
  grossPotentialFootprint: MultiPolygonXY;
  outsideFieldFootprint: MultiPolygonXY;
  excludedNoSprayFootprint: MultiPolygonXY;
  convergence: "sampled_lower_approximation_only" | "unknown_reach";
  qualification: string;
}

/** Union candidates and exclusions separately before clipping/subtraction, including holes. */
export function accountCornerFootprints(candidates: MultiPolygonXY[], fieldBoundary: XY[],
  baselineFootprints?: MultiPolygonXY[], options: CornerFootprintOptions = {}): CornerFootprintAccounting {
  const reachStatus = options.reachStatus ?? "declared";
  const origin = fieldBoundary[0] ?? { x: 0, y: 0 };
  // Translate arithmetic only. Canonical input and returned coordinates remain in the project CRS.
  const toClip = (value: MultiPolygonXY): Clip => value.map(polygon => polygon.map(ring => ring.map(point => [point.x - origin.x, point.y - origin.y])));
  const fromClip = (value: Clip): MultiPolygonXY => value.map(polygon => polygon.map(ring => ring.map(([x, y]) => ({ x: x + origin.x, y: y + origin.y }))));
  const union = (values: MultiPolygonXY[]): Clip => {
    const clips = values.filter(value => value.length > 0).map(toClip);
    return clips.length === 0 ? [] : clips.slice(1).reduce((sum, value) => polygonClipping.union(sum, value) as Clip, clips[0]);
  };
  const difference = (left: Clip, right: Clip): Clip => left.length === 0 ? [] : right.length === 0 ? left : polygonClipping.difference(left, right) as Clip;
  const intersection = (left: Clip, right: Clip): Clip => left.length === 0 || right.length === 0 ? [] : polygonClipping.intersection(left, right) as Clip;
  const area = (value: Clip): number => multiPolygonAreaSquareMeters(value.map(polygon => polygon.map(ring => ring.map(([x, y]) => ({ x, y })))));
  const candidateUnion = reachStatus === "missing" || reachStatus === "explicit_zero" ? [] : union(candidates);
  const field = fieldBoundary.length < 3 ? [] : toClip([[fieldBoundary]]);
  const clipped = intersection(candidateUnion, field);
  const outside = difference(candidateUnion, field);
  const noSpray = union(options.noSprayFootprints ?? []);
  const excluded = intersection(clipped, noSpray);
  const eligible = difference(clipped, noSpray);
  const baseline = baselineFootprints === undefined ? undefined : union(baselineFootprints);
  const additional = baseline === undefined ? undefined : difference(eligible, baseline);
  const known = reachStatus !== "missing";
  const potentialFootprint = fromClip(eligible);
  const netAdditionalFootprint = !known || additional === undefined ? null : fromClip(additional);
  const areasSquareMeters = {
    grossPotential: known ? area(candidateUnion) : null,
    outsideField: known ? area(outside) : null,
    insideField: known ? area(clipped) : null,
    excludedNoSpray: known ? area(excluded) : null,
    eligiblePotential: known ? area(eligible) : null,
    baselineOverlap: known && baseline !== undefined ? area(intersection(eligible, baseline)) : null,
    netAdditional: known && additional !== undefined ? area(additional) : null,
  };
  for (const value of Object.values(areasSquareMeters)) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error("Invalid corner footprint area.");
  }
  return {
    method: "sampled-potential-footprint-union-v1", ledgerVersion: 2, reachStatus,
    potentialFootprint, potentialFootprintAcres: areasSquareMeters.eligiblePotential === null ? null : squareMetersToAcres(areasSquareMeters.eligiblePotential),
    netAdditionalFootprint,
    netAdditionalFootprintAcres: areasSquareMeters.netAdditional === null ? null : squareMetersToAcres(areasSquareMeters.netAdditional),
    baselineStatus: baseline === undefined ? "missing" : "supplied", areasSquareMeters,
    grossPotentialFootprint: fromClip(candidateUnion), outsideFieldFootprint: fromClip(outside), excludedNoSprayFootprint: fromClip(excluded),
    convergence: known ? "sampled_lower_approximation_only" : "unknown_reach",
    qualification: "Finite sampled geometric footprints and inscribed sprinkler discs can underrepresent between-pose reach; they are not proven irrigated area, sprinkler coverage, or hydraulic performance. No continuous upper bound or area convergence is established.",
  };
}
