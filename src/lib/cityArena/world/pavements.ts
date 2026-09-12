import { distancePointToSegment } from "../mapBuild/geometry";
import { PAVEMENT_WIDTH_M, ROAD_WIDTH_M } from "../render/palette";
import type { RailPosition } from "../sim/types";
import type { RoadClass } from "./mapTypes";
import type { Point } from "./projection";
import type { RoadGraph, RoadGraphEdge } from "./roadGraph";

/** Road classes whose pavements pedestrians use. */
export const PAVEMENT_ROAD_CLASSES: RoadClass[] = [
  "residential",
  "living_street",
  "unclassified",
];
/** Road classes where kerb-side parked cars may be placed. */
export const PARKING_ROAD_CLASSES: RoadClass[] = ["residential", "service"];
/** Distance a parked car centre sits beyond the kerb line. */
export const PARKED_KERB_OVERHANG_M = 0.3;
const MAX_RAIL_HOPS = 4;
const COIN_FLIP = 0.5;

/** The graph subset needed by pavement calculations. */
export type RailGraph = Pick<
  RoadGraph,
  "nodes" | "edges" | "adjacency" | "nearestNode"
>;

/** Distance from a road centre to the pavement centre. */
export function pavementOffsetM(roadClass: RoadClass): number {
  return ROAD_WIDTH_M[roadClass] / 2 + PAVEMENT_WIDTH_M / 2;
}

/** Distance from a road centre to the centre of a parked car. */
export function kerbOffsetM(roadClass: RoadClass): number {
  return ROAD_WIDTH_M[roadClass] / 2 + PARKED_KERB_OVERHANG_M;
}

/** Whether an edge has a pedestrian pavement. */
export function isPavementEdge(edge: RoadGraphEdge): boolean {
  return PAVEMENT_ROAD_CLASSES.includes(edge.roadClass);
}

/** Returns a rail's directed endpoint coordinates. */
export function railEnds(graph: RailGraph, rail: RailPosition): [Point, Point] {
  const edge = graph.edges[rail.edge];
  const from = rail.direction === 1 ? edge.a : edge.b;
  const to = rail.direction === 1 ? edge.b : edge.a;
  return [graph.nodes[from], graph.nodes[to]];
}

/** Returns the node a rail currently walks toward. */
export function railEndNode(graph: RailGraph, rail: RailPosition): number {
  const edge = graph.edges[rail.edge];
  return rail.direction === 1 ? edge.b : edge.a;
}

/** Returns the directed rail heading in radians. */
export function railHeading(graph: RailGraph, rail: RailPosition): number {
  const [from, to] = railEnds(graph, rail);
  return Math.atan2(to[1] - from[1], to[0] - from[0]);
}

/** Returns the straight-line length of one graph edge in metres. */
export function edgeLengthM(graph: RailGraph, edgeIndex: number): number {
  const edge = graph.edges[edgeIndex];
  return Math.hypot(
    graph.nodes[edge.b][0] - graph.nodes[edge.a][0],
    graph.nodes[edge.b][1] - graph.nodes[edge.a][1],
  );
}

/** Returns a rail point shifted to the left or right pavement. */
export function railPoint(
  graph: RailGraph,
  rail: RailPosition,
  offsetM: number,
): Point {
  const [from, to] = railEnds(graph, rail);
  const heading = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const shift = offsetM * rail.side;
  return [
    from[0] + (to[0] - from[0]) * rail.edgeT - Math.sin(heading) * shift,
    from[1] + (to[1] - from[1]) * rail.edgeT + Math.cos(heading) * shift,
  ];
}

/** Picks another pavement edge at a node, or reverses at a dead end. */
export function nextPavementEdge(
  graph: RailGraph,
  node: number,
  arriving: number | null,
  random: () => number,
): number | null {
  const candidates = graph.adjacency[node].filter(
    (edgeIndex) =>
      edgeIndex !== arriving && isPavementEdge(graph.edges[edgeIndex]),
  );
  if (candidates.length > 0)
    return candidates[
      Math.min(candidates.length - 1, Math.floor(random() * candidates.length))
    ];
  return arriving !== null && isPavementEdge(graph.edges[arriving])
    ? arriving
    : null;
}

/** Advances a rail by distance and chooses seeded turns at reached nodes. */
export function advanceRail(
  graph: RailGraph,
  rail: RailPosition,
  distanceM: number,
  random: () => number,
): RailPosition {
  let current = rail;
  let left = distanceM;
  for (let hop = 0; hop < MAX_RAIL_HOPS; hop++) {
    const length = edgeLengthM(graph, current.edge);
    const remaining = (1 - current.edgeT) * length;
    if (left < remaining)
      return { ...current, edgeT: current.edgeT + left / length };
    left -= remaining;
    const node = railEndNode(graph, current);
    const next = nextPavementEdge(graph, node, current.edge, random);
    if (next === null) return { ...current, edgeT: 1 };
    current = {
      edge: next,
      direction: graph.edges[next].a === node ? 1 : -1,
      edgeT: 0,
      side: current.side,
    };
  }
  return current;
}

/** Returns pavement edges whose midpoint lies within a radius of a point. */
export function pavementEdgesWithin(
  graph: RailGraph,
  centre: Point,
  radiusM: number,
): number[] {
  const edges: number[] = [];
  graph.edges.forEach((edge, index) => {
    if (!isPavementEdge(edge)) return;
    const middleX = (graph.nodes[edge.a][0] + graph.nodes[edge.b][0]) / 2;
    const middleY = (graph.nodes[edge.a][1] + graph.nodes[edge.b][1]) / 2;
    if (Math.hypot(middleX - centre[0], middleY - centre[1]) <= radiusM)
      edges.push(index);
  });
  return edges;
}

/** Creates a seeded rail on one of the supplied edges. */
export function randomRail(
  graph: RailGraph,
  edges: number[],
  random: () => number,
): RailPosition {
  const edge =
    edges[Math.min(edges.length - 1, Math.floor(random() * edges.length))];
  const direction = random() < COIN_FLIP ? -1 : 1;
  const edgeT = random();
  const side = random() < COIN_FLIP ? -1 : 1;
  return { edge, direction, edgeT, side };
}

function projectT(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return 0;
  const projected =
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
  return Math.max(0, Math.min(1, projected));
}

function sideOf(point: Point, start: Point, end: Point): 1 | -1 {
  const cross =
    (end[0] - start[0]) * (point[1] - start[1]) -
    (end[1] - start[1]) * (point[0] - start[0]);
  return cross < 0 ? -1 : 1;
}

function closestPavementEdgeAt(
  graph: RailGraph,
  node: number,
  point: Point,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const edgeIndex of graph.adjacency[node]) {
    const edge = graph.edges[edgeIndex];
    if (!isPavementEdge(edge)) continue;
    const distance = distancePointToSegment(
      point,
      graph.nodes[edge.a],
      graph.nodes[edge.b],
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = edgeIndex;
    }
  }
  return best;
}

/** Projects a point onto the nearest pavement rail, or returns null when none is nearby. */
export function nearestRail(
  graph: RailGraph,
  point: Point,
  maxDistanceM: number,
  random: () => number,
): RailPosition | null {
  const node = graph.nearestNode(point, maxDistanceM);
  if (node === null) return null;
  const edge = closestPavementEdgeAt(graph, node, point);
  if (edge === null) return null;
  const direction = random() < COIN_FLIP ? -1 : 1;
  const [start, end] = railEnds(graph, {
    edge,
    direction,
    edgeT: 0,
    side: 1,
  });
  return {
    edge,
    direction,
    edgeT: projectT(point, start, end),
    side: sideOf(point, start, end),
  };
}
