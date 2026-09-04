import { boundsOf, type Rect } from "../mapBuild/geometry";
import type { GroundKind, MapIndex, MapTile, RoadClass } from "./mapTypes";
import { fromUnits, type Point } from "./projection";

/** Road centre line in metres with its bounding rectangle. */
export type DecodedRoad = {
  points: Point[];
  roadClass: RoadClass;
  name?: string;
  bounds: Rect;
};

/** Building footprint in metres. */
export type DecodedBuilding = {
  ring: Point[];
  bounds: Rect;
  levels: number;
  landmark?: string;
};

/** Ground polygon in metres. */
export type DecodedGround = { ring: Point[]; bounds: Rect; kind: GroundKind };

/** Water polygon in metres. */
export type DecodedWater = { ring: Point[]; bounds: Rect };

/** A tile converted to metres, with its own (non-overlapping) rectangle. */
export type DecodedTile = {
  x: number;
  y: number;
  rect: Rect;
  roads: DecodedRoad[];
  buildings: DecodedBuilding[];
  ground: DecodedGround[];
  water: DecodedWater[];
};

/** Converts a flat `[x0, y0, x1, y1, …]` unit array to metre points. */
export function flatUnitsToPoints(flat: number[]): Point[] {
  const points: Point[] = [];
  for (let index = 0; index + 1 < flat.length; index += 2) {
    points.push([fromUnits(flat[index]), fromUnits(flat[index + 1])]);
  }
  return points;
}

/** The tile's own 2 km rectangle in metres (the asset's geometry extends 20 m beyond it). */
export function tileRectMetres(x: number, y: number, index: MapIndex): Rect {
  const size = fromUnits(index.tileSize);
  const minX = fromUnits(index.bounds.minX) + x * size;
  const minY = fromUnits(index.bounds.minY) + y * size;
  return { minX, minY, maxX: minX + size, maxY: minY + size };
}

/** Decodes a raw tile payload into metre geometry with precomputed bounds. */
export function decodeTile(tile: MapTile, index: MapIndex): DecodedTile {
  const roads: DecodedRoad[] = tile.roads.map((road) => {
    const points = flatUnitsToPoints(road.points);
    return {
      points,
      roadClass: road.roadClass,
      name: road.name,
      bounds: boundsOf(points),
    };
  });
  const buildings: DecodedBuilding[] = tile.buildings.map((building) => {
    const ring = flatUnitsToPoints(building.points);
    return {
      ring,
      bounds: boundsOf(ring),
      levels: building.levels,
      landmark: building.landmark,
    };
  });
  const ground: DecodedGround[] = tile.ground.map((area) => {
    const ring = flatUnitsToPoints(area.points);
    return { ring, bounds: boundsOf(ring), kind: area.kind };
  });
  const water: DecodedWater[] = tile.water.map((area) => {
    const ring = flatUnitsToPoints(area.points);
    return { ring, bounds: boundsOf(ring) };
  });
  return {
    x: tile.x,
    y: tile.y,
    rect: tileRectMetres(tile.x, tile.y, index),
    roads,
    buildings,
    ground,
    water,
  };
}
