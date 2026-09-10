import type { FurnitureKind } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { distancePointToSegment } from "./geometry";
import type { GridIndex } from "./gridIndex";
import type { OsmTags } from "./osmTypes";

/** A piece of furniture in metres, with the heading its long side follows in whole degrees. */
export type ProjectedFurniture = {
  point: Point;
  kind: FurnitureKind;
  headingDeg: number;
};

/** One road segment the furniture aligns to, with half the road's width. */
export type RoadSegment = { a: Point; b: Point; halfWidth: number };

/** Furniture within this distance of a road turns to run along it. */
export const FURNITURE_ALIGN_M = 30;

/**
 * The furniture kind a node's tags name, or null.
 *
 * @param tags - The node's OSM tags.
 * @returns The kind, or null for a node that is none of them.
 */
export function furnitureKindOf(tags: OsmTags): FurnitureKind | null {
  if (tags.highway === "street_lamp") return "lamp";
  if (tags.amenity === "bench") return "bench";
  if (tags.highway === "bus_stop") return "busStop";
  return null;
}

/**
 * The heading of the nearest road within {@link FURNITURE_ALIGN_M}, in whole degrees 0–359, or 0
 * with no road that close: a bench and a shelter sit along the street, not across it.
 *
 * @param point - Where the furniture stands, metres.
 * @param roads - The road segments, indexed.
 * @returns The heading in whole degrees.
 */
export function alignToRoad(
  point: Point,
  roads: GridIndex<RoadSegment>,
): number {
  let best: RoadSegment | null = null;
  let bestDistance = FURNITURE_ALIGN_M;
  for (const segment of roads.near(point, FURNITURE_ALIGN_M)) {
    const separation = distancePointToSegment(point, segment.a, segment.b);
    if (separation < bestDistance) {
      bestDistance = separation;
      best = segment;
    }
  }
  if (!best) return 0;
  const degrees =
    (Math.atan2(best.b[1] - best.a[1], best.b[0] - best.a[0]) * 180) / Math.PI;
  return ((Math.round(degrees) % 360) + 360) % 360;
}
