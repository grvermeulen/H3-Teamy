import {
  ROAD_EDGE_STRIDE,
  type MapRoads,
  type RoadClass,
} from "../world/mapTypes";
import { projectLonLat, toUnits, type Point } from "../world/projection";
import { distance, simplifyPolyline } from "./geometry";
import { indexNodes, type OsmTags, type OverpassJson } from "./osmTypes";

/** A drivable OSM way with its node id chain. */
export type RoadWay = {
  id: number;
  roadClass: RoadClass;
  name?: string;
  oneway: boolean;
  nodeIds: number[];
};

/** Edge between two graph vertices (indices into `RoadGraph.nodes`), length in metres. */
export type RoadEdge = {
  a: number;
  b: number;
  roadClass: RoadClass;
  name?: string;
  oneway: boolean;
  length: number;
};

/** Road network for routing: vertices at junctions, endpoints and ≥ 20 m shape points. */
export type RoadGraph = { nodes: Point[]; edges: RoadEdge[] };

/** Full simplified centre line for drawing. */
export type RenderRoad = {
  points: Point[];
  roadClass: RoadClass;
  name?: string;
};

const ROAD_CLASSES: RoadClass[] = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "pedestrian",
  "service",
];

/** Maps an OSM `highway` value to a game road class (`*_link` → base class), or `null`. */
export function roadClassOf(tags: OsmTags): RoadClass | null {
  const highway = tags.highway;
  if (!highway) return null;
  const base = highway.endsWith("_link")
    ? highway.slice(0, -"_link".length)
    : highway;
  return ROAD_CLASSES.find((roadClass) => roadClass === base) ?? null;
}

/**
 * OSM `highway`/`junction` values that are one-way by convention even without an explicit
 * `oneway` tag (roundabouts and motorways carry traffic in one direction by design).
 */
const IMPLICIT_ONEWAY_HIGHWAYS: readonly string[] = [
  "motorway",
  "motorway_link",
];

/** True when a way is one-way by OSM convention, absent (or non-`no`) explicit tagging. */
function isImplicitOneway(tags: OsmTags): boolean {
  return (
    tags.junction === "roundabout" ||
    IMPLICIT_ONEWAY_HIGHWAYS.includes(tags.highway ?? "")
  );
}

/**
 * True when a way should be treated as one-way: an explicit `yes`/`1`/`-1` tag always wins;
 * otherwise an implicit one-way (roundabout, motorway, motorway link) applies unless the tag
 * explicitly says `no`.
 */
function isOneway(tags: OsmTags): boolean {
  const onewayTag = tags.oneway;
  if (onewayTag === "yes" || onewayTag === "1" || onewayTag === "-1")
    return true;
  return onewayTag !== "no" && isImplicitOneway(tags);
}

/** Extracts drivable ways; `oneway=-1` is normalised by reversing the node order. */
export function parseRoadWays(json: OverpassJson): RoadWay[] {
  const ways: RoadWay[] = [];
  for (const element of json.elements) {
    if (element.type !== "way" || !element.tags || element.nodes.length < 2)
      continue;
    const roadClass = roadClassOf(element.tags);
    if (!roadClass) continue;
    const reversed = element.tags.oneway === "-1";
    ways.push({
      id: element.id,
      roadClass,
      name: element.tags.name,
      oneway: isOneway(element.tags),
      nodeIds: reversed ? [...element.nodes].reverse() : [...element.nodes],
    });
  }
  return ways;
}

/** Projects every node in the response to metres, keyed by OSM node id. */
export function projectNodeCoordinates(json: OverpassJson): Map<number, Point> {
  const coordinates = new Map<number, Point>();
  for (const [id, node] of indexNodes(json)) {
    coordinates.set(id, projectLonLat(node.lon, node.lat));
  }
  return coordinates;
}

function wayPoints(
  way: RoadWay,
  nodeCoords: Map<number, Point>,
): Point[] | null {
  const points: Point[] = [];
  for (const nodeId of way.nodeIds) {
    const point = nodeCoords.get(nodeId);
    if (!point) return null;
    points.push(point);
  }
  return points;
}

/**
 * Builds the routing graph. A node becomes a vertex when it is a way endpoint, is referenced by
 * more than one way (junction), or lies ≥ `shapeSpacingMetres` along the way since the previous
 * vertex. Ways with missing node coordinates are skipped.
 */
export function buildRoadGraph(
  ways: RoadWay[],
  nodeCoords: Map<number, Point>,
  shapeSpacingMetres = 20,
): RoadGraph {
  const referenceCount = new Map<number, number>();
  for (const way of ways) {
    for (const nodeId of way.nodeIds) {
      referenceCount.set(nodeId, (referenceCount.get(nodeId) ?? 0) + 1);
    }
  }
  const nodes: Point[] = [];
  const edges: RoadEdge[] = [];
  const vertexByNodeId = new Map<number, number>();
  const vertexFor = (nodeId: number, point: Point): number => {
    const existing = vertexByNodeId.get(nodeId);
    if (existing !== undefined) return existing;
    nodes.push(point);
    vertexByNodeId.set(nodeId, nodes.length - 1);
    return nodes.length - 1;
  };

  for (const way of ways) {
    const points = wayPoints(way, nodeCoords);
    if (!points) continue;
    let previousVertex = vertexFor(way.nodeIds[0], points[0]);
    let accumulated = 0;
    for (let index = 1; index < points.length; index++) {
      accumulated += distance(points[index - 1], points[index]);
      const nodeId = way.nodeIds[index];
      const isJunction = (referenceCount.get(nodeId) ?? 0) >= 2;
      const isEnd = index === points.length - 1;
      if (!isJunction && !isEnd && accumulated < shapeSpacingMetres) continue;
      const vertex = vertexFor(nodeId, points[index]);
      if (vertex !== previousVertex) {
        edges.push({
          a: previousVertex,
          b: vertex,
          roadClass: way.roadClass,
          name: way.name,
          oneway: way.oneway,
          length: accumulated,
        });
      }
      previousVertex = vertex;
      accumulated = 0;
    }
  }
  return { nodes, edges };
}

/** Simplified centre lines for tile rendering. */
export function renderRoads(
  ways: RoadWay[],
  nodeCoords: Map<number, Point>,
  toleranceMetres = 0.5,
): RenderRoad[] {
  const rendered: RenderRoad[] = [];
  for (const way of ways) {
    const points = wayPoints(way, nodeCoords);
    if (!points) continue;
    rendered.push({
      points: simplifyPolyline(points, toleranceMetres),
      roadClass: way.roadClass,
      name: way.name,
    });
  }
  return rendered;
}

/** Encodes the graph into the `roads.json` flat layout (units, lookup tables). */
export function encodeRoads(graph: RoadGraph): MapRoads {
  const classes: RoadClass[] = [];
  const names: string[] = [];
  const classIndex = (roadClass: RoadClass): number => {
    const existing = classes.indexOf(roadClass);
    if (existing !== -1) return existing;
    classes.push(roadClass);
    return classes.length - 1;
  };
  const nameIndex = (name: string | undefined): number => {
    if (!name) return -1;
    const existing = names.indexOf(name);
    if (existing !== -1) return existing;
    names.push(name);
    return names.length - 1;
  };
  const nodes: number[] = [];
  for (const [x, y] of graph.nodes) nodes.push(toUnits(x), toUnits(y));
  const edges: number[] = [];
  for (const edge of graph.edges) {
    edges.push(
      edge.a,
      edge.b,
      classIndex(edge.roadClass),
      nameIndex(edge.name),
      edge.oneway ? 1 : 0,
      toUnits(edge.length),
    );
  }
  if (edges.length % ROAD_EDGE_STRIDE !== 0) {
    throw new Error("encodeRoads produced a malformed edge array");
  }
  return { nodes, edges, classes, names };
}
