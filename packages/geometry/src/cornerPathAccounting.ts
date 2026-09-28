import * as polygonClipping from "polyclip-ts";
import { squareMetersToAcres, type MultiPolygonXY, type XY } from "@cplayout/core";
import { multiPolygonAreaSquareMeters } from "./geometry";

type Clip = [number, number][][][];

export interface CornerFootprintAccounting {
  method: "sampled-potential-footprint-union-v1";
  /** Raw planar areas, never rounded for ranking or subtraction. */
  potentialFootprint: MultiPolygonXY;
  potentialFootprintAcres: number;
  netAdditionalFootprint: MultiPolygonXY | null;
  netAdditionalFootprintAcres: number | null;
  baselineStatus: "supplied" | "missing";
  qualification: string;
}

/** Union first, then subtract the union of explicitly supplied baseline footprints. */
export function accountCornerFootprints(candidates: MultiPolygonXY[], fieldBoundary: XY[],
  baselineFootprints?: MultiPolygonXY[]): CornerFootprintAccounting {
  const toClip = (value: MultiPolygonXY): Clip => value.map(polygon => polygon.map(ring => ring.map(point => [point.x, point.y])));
  const fromClip = (value: Clip): MultiPolygonXY => value.map(polygon => polygon.map(ring => ring.map(([x, y]) => ({ x, y }))));
  const union = (values: MultiPolygonXY[]): Clip => {
    const clips = values.filter(value => value.length > 0).map(toClip);
    return clips.length === 0 ? [] : clips.slice(1).reduce((sum, value) => polygonClipping.union(sum, value) as Clip, clips[0]);
  };
  const candidateUnion = union(candidates);
  const clipped = candidateUnion.length === 0 ? [] : polygonClipping.intersection(candidateUnion, toClip([[fieldBoundary]])) as Clip;
  const potentialFootprint = fromClip(clipped);
  const baseline = baselineFootprints === undefined ? undefined : union(baselineFootprints);
  const netAdditionalFootprint = baseline === undefined ? null : fromClip(clipped.length === 0 ? []
    : baseline.length === 0 ? clipped : polygonClipping.difference(clipped, baseline) as Clip);
  return {
    method: "sampled-potential-footprint-union-v1",
    potentialFootprint,
    potentialFootprintAcres: squareMetersToAcres(multiPolygonAreaSquareMeters(potentialFootprint)),
    netAdditionalFootprint,
    netAdditionalFootprintAcres: netAdditionalFootprint === null ? null
      : squareMetersToAcres(multiPolygonAreaSquareMeters(netAdditionalFootprint)),
    baselineStatus: baseline === undefined ? "missing" : "supplied",
    qualification: "Finite sampled geometric footprints can underrepresent between-pose reach; they are not proven irrigated area, sprinkler coverage, or hydraulic performance.",
  };
}
