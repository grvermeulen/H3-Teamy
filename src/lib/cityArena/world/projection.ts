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

const ORIGIN_LATITUDE_RADIANS = (MAP_ORIGIN.lat * Math.PI) / 180;

/**
 * Metres per degree of latitude at {@link MAP_ORIGIN}, from the WGS84 ellipsoid series (not
 * the equatorial value): `111132.954 − 559.822·cos(2φ) + 1.175·cos(4φ)`.
 */
const METRES_PER_DEGREE_LATITUDE_AT_ORIGIN =
  111_132.954 -
  559.822 * Math.cos(2 * ORIGIN_LATITUDE_RADIANS) +
  1.175 * Math.cos(4 * ORIGIN_LATITUDE_RADIANS);

/**
 * Metres per degree of longitude at {@link MAP_ORIGIN}, from the same WGS84 series:
 * `111412.84·cos(φ) − 93.5·cos(3φ) + 0.118·cos(5φ)`.
 */
const METRES_PER_DEGREE_LONGITUDE_AT_ORIGIN =
  111_412.84 * Math.cos(ORIGIN_LATITUDE_RADIANS) -
  93.5 * Math.cos(3 * ORIGIN_LATITUDE_RADIANS) +
  0.118 * Math.cos(5 * ORIGIN_LATITUDE_RADIANS);

/**
 * Equirectangular projection around {@link MAP_ORIGIN}: x grows east, y grows south, both in
 * metres, using WGS84 degree lengths evaluated at the origin latitude (not the equatorial
 * values). Over this ~13 km region the residual local scale error of this fixed-scale
 * projection stays below 0.1% (under 0.5 m over a 500 m zone), and the absolute position
 * error is at most about 7 m at the bbox corners.
 */
export function projectLonLat(lon: number, lat: number): Point {
  const x = (lon - MAP_ORIGIN.lon) * METRES_PER_DEGREE_LONGITUDE_AT_ORIGIN;
  const y = -(lat - MAP_ORIGIN.lat) * METRES_PER_DEGREE_LATITUDE_AT_ORIGIN;
  return [x + 0, y + 0];
}

/** Inverse of {@link projectLonLat}. */
export function unprojectXY(
  x: number,
  y: number,
): { lon: number; lat: number } {
  return {
    lon: MAP_ORIGIN.lon + x / METRES_PER_DEGREE_LONGITUDE_AT_ORIGIN,
    lat: MAP_ORIGIN.lat - y / METRES_PER_DEGREE_LATITUDE_AT_ORIGIN,
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
