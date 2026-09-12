import { distancePointToSegment } from "../mapBuild/geometry";
import type { DecodedTile } from "./decode";
import type { Point } from "./projection";

/** Name of the closest named road piece within `maxDistance` metres, for the HUD. */
export function nearestRoadName(
  tiles: DecodedTile[],
  point: Point,
  maxDistance = 50,
): string | null {
  let bestName: string | null = null;
  let bestDistance = maxDistance;
  for (const tile of tiles) {
    for (const road of tile.roads) {
      if (!road.name) continue;
      if (
        point[0] < road.bounds.minX - maxDistance ||
        point[0] > road.bounds.maxX + maxDistance
      )
        continue;
      if (
        point[1] < road.bounds.minY - maxDistance ||
        point[1] > road.bounds.maxY + maxDistance
      )
        continue;
      for (let index = 0; index + 1 < road.points.length; index++) {
        const distance = distancePointToSegment(
          point,
          road.points[index],
          road.points[index + 1],
        );
        if (distance <= bestDistance) {
          bestDistance = distance;
          bestName = road.name;
        }
      }
    }
  }
  return bestName;
}
