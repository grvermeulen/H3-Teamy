import { distance, pointInPolygon } from "../mapBuild/geometry";
import {
  nearestPointOnSegment,
  type CollisionGrid,
} from "../world/collisionGrid";
import type { MapIndex, ZoneKey } from "../world/mapTypes";
import { isPavementEdge, pavementOffsetM } from "../world/pavements";
import type { Point } from "../world/projection";
import { findPath, type RoadGraph } from "../world/roadGraph";
import {
  distanceToZoneEdge,
  findZoneByKey,
  landmarkCentreMetres,
} from "../world/zone";

/** A content anchor resolved against the shipped map before it is used in a mission. */
export type MissionAnchorDefinition = {
  id: string;
  zone: ZoneKey;
  landmark: string;
  offset: Point;
  mode: "foot" | "vehicle";
};

/** A reachable world location in metres, with its road graph attachment retained. */
export type MissionAnchor = {
  id: string;
  zone: ZoneKey;
  position: Point;
  roadNode: number;
  heading: number;
};

/** Chooses a clear pavement/road point inside the zone, refusing missing or isolated locations. */
export function resolveMissionAnchor(
  definition: MissionAnchorDefinition,
  index: MapIndex,
  graph: RoadGraph,
  collision: Pick<CollisionGrid, "resolveCircle" | "query">,
): MissionAnchor {
  const landmark = index.landmarks.find(
    (entry) => entry.key === definition.landmark,
  );
  const zone = findZoneByKey(index, definition.zone);
  if (!landmark || !zone)
    throw new Error(`Missieanker ${definition.id}: locatie of zone ontbreekt`);
  const centre = landmarkCentreMetres(landmark);
  const desired: Point = [
    centre[0] + definition.offset[0],
    centre[1] + definition.offset[1],
  ];
  const candidates: {
    position: Point;
    roadNode: number;
    heading: number;
    distance: number;
  }[] = [];
  for (const edge of graph.edges) {
    if (
      definition.mode === "foot"
        ? !isPavementEdge(edge)
        : ["pedestrian", "motorway", "trunk"].includes(edge.roadClass)
    )
      continue;
    const start = graph.nodes[edge.a];
    const end = graph.nodes[edge.b];
    const snapped = nearestPointOnSegment(desired, start, end);
    const heading = Math.atan2(end[1] - start[1], end[0] - start[0]);
    for (const side of definition.mode === "foot" ? [-1, 1] : [0]) {
      const offset =
        definition.mode === "foot" ? pavementOffsetM(edge.roadClass) * side : 0;
      const position: Point = [
        snapped[0] - Math.sin(heading) * offset,
        snapped[1] + Math.cos(heading) * offset,
      ];
      const gap = distance(desired, position);
      if (gap > 250 || distanceToZoneEdge(zone, position) > -8) continue;
      const clearance = definition.mode === "foot" ? 0.6 : 2;
      if (
        distance(collision.resolveCircle(position, clearance), position) > 0.05
      )
        continue;
      if (
        collision
          .query({
            minX: position[0] - clearance,
            minY: position[1] - clearance,
            maxX: position[0] + clearance,
            maxY: position[1] + clearance,
          })
          .some((obstacle) => pointInPolygon(position, obstacle.ring))
      )
        continue;
      const roadNode =
        distance(position, start) <= distance(position, end) ? edge.a : edge.b;
      candidates.push({ position, roadNode, heading, distance: gap });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.roadNode - b.roadNode);
  const spawnNodes = zone.spawnNodes.map(([x, y]): Point => [x / 4, y / 4]);
  for (const candidate of candidates) {
    const connected = spawnNodes.some((spawn) => {
      const node = graph.nearestNode(spawn, 100);
      return (
        node !== null &&
        findPath(graph, node, candidate.roadNode, {
          respectOneway: definition.mode === "vehicle",
          allowEdge: (edge) =>
            distanceToZoneEdge(zone, graph.nodes[edge.a]) <= -4 &&
            distanceToZoneEdge(zone, graph.nodes[edge.b]) <= -4 &&
            (definition.mode === "vehicle"
              ? edge.roadClass !== "pedestrian"
              : !["motorway", "trunk"].includes(edge.roadClass)),
        }) !== null
      );
    });
    if (connected)
      return {
        id: definition.id,
        zone: definition.zone,
        position: candidate.position,
        roadNode: candidate.roadNode,
        heading: candidate.heading,
      };
  }
  throw new Error(
    `Missieanker ${definition.id}: geen bereikbare vrije plek binnen de zone`,
  );
}
