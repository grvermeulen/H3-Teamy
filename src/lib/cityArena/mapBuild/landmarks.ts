import { projectLonLat, unprojectXY, type Point } from "../world/projection";
import { distance, polygonCentroid } from "./geometry";
import type { LandmarkConfig } from "./landmarks.config";
import {
  indexNodes,
  indexWays,
  osmElementId,
  type LatLon,
  type OverpassElement,
  type OverpassJson,
  type OverpassNode,
  type OverpassWay,
} from "./osmTypes";

/** A landmark resolved to one OSM element. */
export type MatchedLandmark = {
  config: LandmarkConfig;
  element: OverpassElement;
  center: LatLon;
};

/** Result of matching every configured landmark. */
export type LandmarkMatchResult = {
  matched: MatchedLandmark[];
  errors: string[];
};

function wayCoordinates(
  way: OverpassWay,
  nodesById: Map<number, OverpassNode>,
): LatLon[] {
  const coordinates: LatLon[] = [];
  for (const nodeId of way.nodes) {
    const node = nodesById.get(nodeId);
    if (node) coordinates.push({ lat: node.lat, lon: node.lon });
  }
  return coordinates;
}

function centroidOf(coordinates: LatLon[]): LatLon | null {
  if (coordinates.length === 0) return null;
  const projected: Point[] = coordinates.map((coordinate) =>
    projectLonLat(coordinate.lon, coordinate.lat),
  );
  const [x, y] =
    projected.length >= 3 ? polygonCentroid(projected) : projected[0];
  return unprojectXY(x, y);
}

/** Representative centre: the node itself, a way's centroid, or a relation's member centroid. */
export function elementCenter(
  element: OverpassElement,
  nodesById: Map<number, OverpassNode>,
  waysById: Map<number, OverpassWay>,
): LatLon | null {
  if (element.type === "node") return { lat: element.lat, lon: element.lon };
  if (element.type === "way") {
    const ring = wayCoordinates(element, nodesById);
    const isClosed =
      ring.length > 1 &&
      element.nodes[0] === element.nodes[element.nodes.length - 1];
    return centroidOf(isClosed ? ring.slice(0, -1) : ring);
  }
  const memberCoordinates: LatLon[] = [];
  for (const member of element.members) {
    if (member.type === "node") {
      const node = nodesById.get(member.ref);
      if (node) memberCoordinates.push({ lat: node.lat, lon: node.lon });
    }
    if (member.type === "way") {
      const way = waysById.get(member.ref);
      if (way) {
        const ring = wayCoordinates(way, nodesById);
        const isClosed =
          ring.length > 1 && way.nodes[0] === way.nodes[way.nodes.length - 1];
        memberCoordinates.push(...(isClosed ? ring.slice(0, -1) : ring));
      }
    }
  }
  if (memberCoordinates.length === 0) return null;
  const sumLat = memberCoordinates.reduce(
    (total, coordinate) => total + coordinate.lat,
    0,
  );
  const sumLon = memberCoordinates.reduce(
    (total, coordinate) => total + coordinate.lon,
    0,
  );
  return {
    lat: sumLat / memberCoordinates.length,
    lon: sumLon / memberCoordinates.length,
  };
}

function metresBetween(a: LatLon, b: LatLon): number {
  return distance(projectLonLat(a.lon, a.lat), projectLonLat(b.lon, b.lat));
}

function describeCandidate(element: OverpassElement, center: LatLon): string {
  const name = element.tags?.name ?? "(naamloos)";
  return `${osmElementId(element)} "${name}" @ ${center.lat.toFixed(5)},${center.lon.toFixed(5)}`;
}

/** Resolves each landmark to exactly one element; every failure becomes a human-readable error. */
export function matchLandmarks(
  json: OverpassJson,
  config: LandmarkConfig[],
): LandmarkMatchResult {
  const nodesById = indexNodes(json);
  const waysById = indexWays(json);
  const matched: MatchedLandmark[] = [];
  const errors: string[] = [];

  for (const landmark of config) {
    const fragment = landmark.nameMatch.toLowerCase();
    const candidates: MatchedLandmark[] = [];
    for (const element of json.elements) {
      const tags = element.tags;
      if (!tags) continue;
      if (landmark.osmId && osmElementId(element) !== landmark.osmId) continue;
      if (!landmark.osmId) {
        const name = tags.name?.toLowerCase() ?? "";
        if (!name.includes(fragment) || !landmark.matchesTags(tags)) continue;
      }
      const center = elementCenter(element, nodesById, waysById);
      if (!center) continue;
      if (
        landmark.near &&
        metresBetween(center, landmark.near) > landmark.near.radiusM
      )
        continue;
      candidates.push({ config: landmark, element, center });
    }
    if (candidates.length === 1) {
      matched.push(candidates[0]);
      continue;
    }
    if (candidates.length === 0) {
      errors.push(
        `Landmark "${landmark.key}": no match for name ~ "${landmark.nameMatch}"`,
      );
      continue;
    }
    const listing = candidates
      .map((candidate) =>
        describeCandidate(candidate.element, candidate.center),
      )
      .join("; ");
    errors.push(
      `Landmark "${landmark.key}": ${candidates.length} candidates, add osmId to pin one: ${listing}`,
    );
  }
  return { matched, errors };
}
