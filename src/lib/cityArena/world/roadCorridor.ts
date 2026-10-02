import { distancePointToSegment, type Rect } from "../mapBuild/geometry";
import { PAVEMENT_WIDTH_M, ROAD_WIDTH_M } from "../render/palette";
import { COLLISION_CELL_M } from "./collisionGrid";
import type { Point } from "./projection";
import type { RoadGraph } from "./roadGraph";

/** Cell size of the corridor index; identical to {@link COLLISION_CELL_M} so both bucket world space alike. */
export const CORRIDOR_CELL_M = COLLISION_CELL_M;

/**
 * Extra half-width beyond the painted carriageway. A bridge deck also carries the pavements the
 * renderer draws beside the road, so a player walking the pavement of a bridge must still count
 * as being on it.
 */
export const CORRIDOR_MARGIN_M = PAVEMENT_WIDTH_M;

/**
 * Multiplier packing a cell's x coordinate into a numeric bucket key. The map spans roughly
 * 900 × 650 cells, far inside the ±500 000 the stride allows, and numeric keys keep this
 * whole-map index (125 084 cells) several megabytes lighter than string keys would.
 */
const CELL_KEY_STRIDE = 1_000_000;

/** One road segment with the half-width of the drivable surface around its centre line. */
type Corridor = { start: Point; end: Point; halfWidthM: number };

/** Whole-map index answering "does this circle sit on a road surface?". */
export type RoadCorridors = {
  isOnRoad(point: Point, radiusM: number): boolean;
  corridorCount(): number;
};

/** Bucket key for one cell coordinate. */
function cellKey(cellX: number, cellY: number): number {
  return cellX * CELL_KEY_STRIDE + cellY;
}

/** Visits the key of every cell `bounds` overlaps, flooring so the grid extends into negative coordinates. */
function forEachCorridorCell(bounds: Rect, visit: (key: number) => void): void {
  const minCellX = Math.floor(bounds.minX / CORRIDOR_CELL_M);
  const maxCellX = Math.floor(bounds.maxX / CORRIDOR_CELL_M);
  const minCellY = Math.floor(bounds.minY / CORRIDOR_CELL_M);
  const maxCellY = Math.floor(bounds.maxY / CORRIDOR_CELL_M);
  for (let cellY = minCellY; cellY <= maxCellY; cellY++)
    for (let cellX = minCellX; cellX <= maxCellX; cellX++)
      visit(cellKey(cellX, cellY));
}

/** The segment's bounding box grown by its own half-width. */
function corridorBounds(corridor: Corridor): Rect {
  return {
    minX: Math.min(corridor.start[0], corridor.end[0]) - corridor.halfWidthM,
    minY: Math.min(corridor.start[1], corridor.end[1]) - corridor.halfWidthM,
    maxX: Math.max(corridor.start[0], corridor.end[0]) + corridor.halfWidthM,
    maxY: Math.max(corridor.start[1], corridor.end[1]) + corridor.halfWidthM,
  };
}

/** One corridor per graph edge whose two endpoints both exist. */
function buildCorridors(graph: Pick<RoadGraph, "nodes" | "edges">): Corridor[] {
  const corridors: Corridor[] = [];
  for (const edge of graph.edges) {
    const start = graph.nodes[edge.a];
    const end = graph.nodes[edge.b];
    if (!start || !end) continue;
    corridors.push({
      start,
      end,
      halfWidthM: ROAD_WIDTH_M[edge.roadClass] / 2 + CORRIDOR_MARGIN_M,
    });
  }
  return corridors;
}

/** Buckets every corridor into each cell its inflated bounding box overlaps. */
function bucketCorridors(corridors: Corridor[]): Map<number, number[]> {
  const buckets = new Map<number, number[]>();
  corridors.forEach((corridor, index) => {
    forEachCorridorCell(corridorBounds(corridor), (key) => {
      const list = buckets.get(key);
      if (list) list.push(index);
      else buckets.set(key, [index]);
    });
  });
  return buckets;
}

/**
 * True when any bucketed corridor comes within `halfWidthM + radiusM` of `point`. Querying every
 * cell the probe box `point ± radiusM` touches is what makes the bounding-box bucketing exact:
 * a corridor within reach always has its inflated box overlapping at least one queried cell.
 */
function anyCorridorCovers(
  corridors: Corridor[],
  buckets: Map<number, number[]>,
  point: Point,
  radiusM: number,
): boolean {
  const probe: Rect = {
    minX: point[0] - radiusM,
    minY: point[1] - radiusM,
    maxX: point[0] + radiusM,
    maxY: point[1] + radiusM,
  };
  let covered = false;
  forEachCorridorCell(probe, (key) => {
    if (covered) return;
    for (const index of buckets.get(key) ?? []) {
      const corridor = corridors[index];
      const distance = distancePointToSegment(
        point,
        corridor.start,
        corridor.end,
      );
      if (distance <= corridor.halfWidthM + radiusM) {
        covered = true;
        return;
      }
    }
  });
  return covered;
}

/**
 * Builds the whole-map road-corridor index from the decoded road graph. Every edge becomes a
 * segment whose half-width is its class width from {@link ROAD_WIDTH_M} plus
 * {@link CORRIDOR_MARGIN_M}; the segments are bucketed into {@link CORRIDOR_CELL_M} cells so
 * `isOnRoad` answers in roughly constant time (1.54 corridors per cell on the shipped map).
 */
export function createRoadCorridors(
  graph: Pick<RoadGraph, "nodes" | "edges">,
): RoadCorridors {
  const corridors = buildCorridors(graph);
  const buckets = bucketCorridors(corridors);
  return {
    isOnRoad: (point, radiusM) =>
      anyCorridorCovers(corridors, buckets, point, radiusM),
    corridorCount: () => corridors.length,
  };
}
