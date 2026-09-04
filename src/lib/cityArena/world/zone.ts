import type { MapIndex, MapZone, ZoneKey } from "./mapTypes";
import { fromUnits, type Point } from "./projection";

/** Zone centre in metres. */
export function zoneCentreMetres(zone: MapZone): Point {
  return [fromUnits(zone.center[0]), fromUnits(zone.center[1])];
}

/** Zone radius in metres. */
export function zoneRadiusMetres(zone: MapZone): number {
  return fromUnits(zone.radius);
}

/** Signed distance to the zone edge: negative inside, positive outside. */
export function distanceToZoneEdge(zone: MapZone, point: Point): number {
  const [cx, cy] = zoneCentreMetres(zone);
  return Math.hypot(point[0] - cx, point[1] - cy) - zoneRadiusMetres(zone);
}

/** The zone whose disc contains the point, or `null` in the countryside. */
export function findZone(index: MapIndex, point: Point): MapZone | null {
  return (
    index.zones.find((zone) => distanceToZoneEdge(zone, point) <= 0) ?? null
  );
}

/** Zone by key. */
export function findZoneByKey(index: MapIndex, key: ZoneKey): MapZone | null {
  return index.zones.find((zone) => zone.key === key) ?? null;
}

/** A random spawn node (metres); the zone centre when the zone has none. */
export function pickSpawn(zone: MapZone, random: () => number): Point {
  if (zone.spawnNodes.length === 0) return zoneCentreMetres(zone);
  const index = Math.min(
    zone.spawnNodes.length - 1,
    Math.floor(random() * zone.spawnNodes.length),
  );
  const [x, y] = zone.spawnNodes[index];
  return [fromUnits(x), fromUnits(y)];
}
