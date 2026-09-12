import { ROAD_EDGE_STRIDE, type MapRoads, type RoadClass } from "./mapTypes";
import { fromUnits, type Point } from "./projection";
import { createBinaryHeap, type BinaryHeap } from "./binaryHeap";

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
  if (roads.nodes.length % 2 !== 0) {
    throw new Error(
      `roads.json nodes length ${roads.nodes.length} is odd; must be even`,
    );
  }
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
    if (nameIndex >= 0 && nameIndex >= roads.names.length) {
      throw new Error(
        `roads.json edge references an unknown name index ${nameIndex}`,
      );
    }
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

/** Search options for one-way handling and road-class filtering. */
export type PathOptions = {
  respectOneway?: boolean;
  allowEdge?: (edge: RoadGraphEdge) => boolean;
};

type Search = {
  open: BinaryHeap<number>;
  cameFrom: Map<number, number>;
  bestCost: Map<number, number>;
  closed: Set<number>;
};

function relaxNeighbours(
  graph: RoadGraph,
  current: number,
  options: PathOptions,
  heuristic: (index: number) => number,
  search: Search,
): void {
  const currentCost = search.bestCost.get(current) ?? Infinity;
  for (const edgeIndex of graph.adjacency[current]) {
    const edge = graph.edges[edgeIndex];
    const neighbour = edge.a === current ? edge.b : edge.a;
    if (options.respectOneway && edge.oneway && edge.a !== current) continue;
    if (options.allowEdge && !options.allowEdge(edge)) continue;
    if (search.closed.has(neighbour)) continue;
    const tentative = currentCost + edge.length;
    if (tentative >= (search.bestCost.get(neighbour) ?? Infinity)) continue;
    search.cameFrom.set(neighbour, current);
    search.bestCost.set(neighbour, tentative);
    search.open.push(neighbour, tentative + heuristic(neighbour));
  }
}

/** A* over the graph with a binary-heap open set. */
export function findPath(
  graph: RoadGraph,
  from: number,
  to: number,
  options: PathOptions = {},
): number[] | null {
  const heuristic = (index: number): number =>
    Math.hypot(
      graph.nodes[to][0] - graph.nodes[index][0],
      graph.nodes[to][1] - graph.nodes[index][1],
    );
  const search: Search = {
    open: createBinaryHeap<number>(),
    cameFrom: new Map<number, number>(),
    bestCost: new Map<number, number>([[from, 0]]),
    closed: new Set<number>(),
  };
  search.open.push(from, heuristic(from));
  for (
    let current = search.open.pop();
    current !== null;
    current = search.open.pop()
  ) {
    if (current === to) return reconstruct(search.cameFrom, current);
    if (search.closed.has(current)) continue;
    search.closed.add(current);
    relaxNeighbours(graph, current, options, heuristic, search);
  }
  return null;
}

/** Sum of edge lengths along a node path (0 for paths shorter than two nodes). When multiple edges connect the same pair of nodes, uses the shortest. */
export function pathLength(graph: RoadGraph, path: number[]): number {
  let total = 0;
  for (let index = 0; index + 1 < path.length; index++) {
    const currentNode = path[index];
    const nextNode = path[index + 1];
    let minLength = Infinity;
    for (const edgeIndex of graph.adjacency[currentNode]) {
      const edge = graph.edges[edgeIndex];
      if (
        (edge.a === currentNode && edge.b === nextNode) ||
        (edge.b === currentNode && edge.a === nextNode)
      ) {
        minLength = Math.min(minLength, edge.length);
      }
    }
    total += minLength !== Infinity ? minLength : 0;
  }
  return total;
}
