import { MAP_UNITS_PER_METRE } from "./mapTypes";

/** A point in metres (or units when stated), `[x, y]`, north = negative y. */
export type Point = [number, number];

/** Projection origin: the centre of the region. */
export const MAP_ORIGIN = { lat: 51.98, lon: 5.625 } as const;

/** Region bounding box in degrees (south, west, north, east). */
export const MAP_BBOX = {
  south: 51.94,
  west: 5.53,
  north: 52.02,
  east: 5.72,
} as const;

const METRES_PER_DEGREE_LATITUDE = 110_574;
const METRES_PER_DEGREE_LONGITUDE_AT_ORIGIN =
  111_320 * Math.cos((MAP_ORIGIN.lat * Math.PI) / 180);

/**
 * Equirectangular projection around {@link MAP_ORIGIN}: x grows east, y grows south, both in
 * metres. Distortion across the 13 km region stays below one metre.
 */
export function projectLonLat(lon: number, lat: number): Point {
  const x = (lon - MAP_ORIGIN.lon) * METRES_PER_DEGREE_LONGITUDE_AT_ORIGIN;
  const y = -(lat - MAP_ORIGIN.lat) * METRES_PER_DEGREE_LATITUDE;
  return [x + 0, y + 0];
}

/** Inverse of {@link projectLonLat}. */
export function unprojectXY(
  x: number,
  y: number,
): { lon: number; lat: number } {
  return {
    lon: MAP_ORIGIN.lon + x / METRES_PER_DEGREE_LONGITUDE_AT_ORIGIN,
    lat: MAP_ORIGIN.lat - y / METRES_PER_DEGREE_LATITUDE,
  };
}

/** Metres → integer asset units (0.25 m). */
export function toUnits(metres: number): number {
  return Math.round(metres * MAP_UNITS_PER_METRE);
}

/** Asset units → metres. */
export function fromUnits(units: number): number {
  return units / MAP_UNITS_PER_METRE;
}
