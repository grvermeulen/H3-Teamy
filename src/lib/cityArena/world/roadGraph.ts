import { ROAD_EDGE_STRIDE, type MapRoads, type RoadClass } from "./mapTypes";
import { fromUnits, type Point } from "./projection";

/** Decoded edge between two vertex indices; `length` in metres. */
export type RoadGraphEdge = {
  a: number;
  b: number;
  roadClass: RoadClass;
  name?: string;
  oneway: boolean;
  length: number;
};

/** Routing graph with a nearest-vertex lookup. */
export type RoadGraph = {
  nodes: Point[];
  edges: RoadGraphEdge[];
  adjacency: number[][];
  nearestNode(point: Point, maxDistance?: number): number | null;
};

const BUCKET_M = 50;

function decodeNodes(roads: MapRoads): Point[] {
  const nodes: Point[] = [];
  for (let index = 0; index + 1 < roads.nodes.length; index += 2) {
    nodes.push([
      fromUnits(roads.nodes[index]),
      fromUnits(roads.nodes[index + 1]),
    ]);
  }
  return nodes;
}

function decodeEdges(roads: MapRoads, nodeCount: number): RoadGraphEdge[] {
  if (roads.edges.length % ROAD_EDGE_STRIDE !== 0) {
    throw new Error(
      `roads.json edges length ${roads.edges.length} is not a multiple of the stride ${ROAD_EDGE_STRIDE}`,
    );
  }
  const edges: RoadGraphEdge[] = [];
  for (
    let offset = 0;
    offset < roads.edges.length;
    offset += ROAD_EDGE_STRIDE
  ) {
    const [a, b, classIndex, nameIndex, oneway, lengthUnits] =
      roads.edges.slice(offset, offset + ROAD_EDGE_STRIDE);
    if (a >= nodeCount || b >= nodeCount || a < 0 || b < 0)
      throw new Error(
        `roads.json edge references an unknown node index (${a}, ${b})`,
      );
    const roadClass = roads.classes[classIndex];
    if (!roadClass)
      throw new Error(
        `roads.json edge references an unknown class index ${classIndex}`,
      );
    edges.push({
      a,
      b,
      roadClass,
      name: nameIndex >= 0 ? roads.names[nameIndex] : undefined,
      oneway: oneway === 1,
      length: fromUnits(lengthUnits),
    });
  }
  return edges;
}

function buildBuckets(nodes: Point[]): Map<string, number[]> {
  const buckets = new Map<string, number[]>();
  nodes.forEach((node, index) => {
    const key = `${Math.floor(node[0] / BUCKET_M)}:${Math.floor(node[1] / BUCKET_M)}`;
    const list = buckets.get(key) ?? [];
    list.push(index);
    buckets.set(key, list);
  });
  return buckets;
}

/** Decodes `roads.json` into a graph; throws on stride or index errors. */
export function decodeRoadGraph(roads: MapRoads): RoadGraph {
  const nodes = decodeNodes(roads);
  const edges = decodeEdges(roads, nodes.length);
  const adjacency: number[][] = nodes.map(() => []);
  edges.forEach((edge, index) => {
    adjacency[edge.a].push(index);
    adjacency[edge.b].push(index);
  });
  const buckets = buildBuckets(nodes);
  const nearestNode = (point: Point, maxDistance = 100): number | null => {
    const reach = Math.ceil(maxDistance / BUCKET_M);
    const baseX = Math.floor(point[0] / BUCKET_M);
    const baseY = Math.floor(point[1] / BUCKET_M);
    let best: number | null = null;
    let bestDistance = maxDistance;
    for (let by = baseY - reach; by <= baseY + reach; by++) {
      for (let bx = baseX - reach; bx <= baseX + reach; bx++) {
        for (const index of buckets.get(`${bx}:${by}`) ?? []) {
          const distance = Math.hypot(
            nodes[index][0] - point[0],
            nodes[index][1] - point[1],
          );
          if (distance <= bestDistance) {
            bestDistance = distance;
            best = index;
          }
        }
      }
    }
    return best;
  };
  return { nodes, edges, adjacency, nearestNode };
}

function reconstruct(cameFrom: Map<number, number>, current: number): number[] {
  const path = [current];
  let cursor = current;
  while (cameFrom.has(cursor)) {
    cursor = cameFrom.get(cursor) ?? cursor;
    path.push(cursor);
  }
  return path.reverse();
}

/** A* over the graph (one-way flags are ignored — pedestrians and cops may walk both ways). */
export function findPath(
  graph: RoadGraph,
  from: number,
  to: number,
): number[] | null {
  const heuristic = (index: number): number =>
    Math.hypot(
      graph.nodes[to][0] - graph.nodes[index][0],
      graph.nodes[to][1] - graph.nodes[index][1],
    );
  const open = new Set<number>([from]);
  const cameFrom = new Map<number, number>();
  const bestCost = new Map<number, number>([[from, 0]]);
  const estimate = new Map<number, number>([[from, heuristic(from)]]);
  while (open.size > 0) {
    let current = -1;
    let currentEstimate = Infinity;
    for (const candidate of open) {
      const value = estimate.get(candidate) ?? Infinity;
      if (value < currentEstimate) {
        currentEstimate = value;
        current = candidate;
      }
    }
    if (current === to) return reconstruct(cameFrom, current);
    open.delete(current);
    for (const edgeIndex of graph.adjacency[current]) {
      const edge = graph.edges[edgeIndex];
      const neighbour = edge.a === current ? edge.b : edge.a;
      const tentative = (bestCost.get(current) ?? Infinity) + edge.length;
      if (tentative >= (bestCost.get(neighbour) ?? Infinity)) continue;
      cameFrom.set(neighbour, current);
      bestCost.set(neighbour, tentative);
      estimate.set(neighbour, tentative + heuristic(neighbour));
      open.add(neighbour);
    }
  }
  return null;
}

/** Sum of edge lengths along a node path (0 for paths shorter than two nodes). */
export function pathLength(graph: RoadGraph, path: number[]): number {
  let total = 0;
  for (let index = 0; index + 1 < path.length; index++) {
    const edge = graph.edges.find(
      (candidate) =>
        (candidate.a === path[index] && candidate.b === path[index + 1]) ||
        (candidate.b === path[index] && candidate.a === path[index + 1]),
    );
    total += edge?.length ?? 0;
  }
  return total;
}
