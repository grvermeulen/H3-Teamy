import { distance } from "../mapBuild/geometry";
import type { Point } from "./projection";
import { findPath, type RoadGraph, type RoadGraphEdge } from "./roadGraph";

/** Local navigation state, never replicated to other players. Coordinates are metres. */
export type NavigationSnapshot = {
  destination: Point;
  points: Point[];
  distanceM: number;
  status: "navigating" | "unreachable" | "arrived";
};

type RoadSnap = { edgeIndex: number; point: Point; fraction: number };

function allowed(edge: RoadGraphEdge, driving: boolean): boolean {
  return driving
    ? edge.roadClass !== "pedestrian"
    : edge.roadClass !== "motorway" && edge.roadClass !== "trunk";
}

function snapToRoad(
  graph: RoadGraph,
  point: Point,
  driving: boolean,
): RoadSnap | null {
  let best: RoadSnap | null = null;
  let bestDistance = 100;
  graph.edges.forEach((edge, edgeIndex) => {
    if (!allowed(edge, driving)) return;
    const a = graph.nodes[edge.a];
    const b = graph.nodes[edge.b];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const squared = dx * dx + dy * dy;
    const fraction =
      squared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / squared,
            ),
          );
    const projected: Point = [a[0] + dx * fraction, a[1] + dy * fraction];
    const gap = distance(point, projected);
    if (gap <= bestDistance) {
      bestDistance = gap;
      best = { edgeIndex, point: projected, fraction };
    }
  });
  return best;
}

/** Splits only the selected edges, so destinations halfway along a street do not require a detour. */
function withEndpoints(
  graph: RoadGraph,
  start: RoadSnap,
  goal: RoadSnap,
): { graph: RoadGraph; start: number; goal: number } {
  const nodes = [...graph.nodes, start.point, goal.point];
  const edges = [...graph.edges];
  const adjacency = [...graph.adjacency, [], []];
  const snaps = [start, goal];
  const endpoints = snaps.map((snap, index) => {
    const edge = graph.edges[snap.edgeIndex];
    if (snap.fraction === 0) return edge.a;
    if (snap.fraction === 1) return edge.b;
    return graph.nodes.length + index;
  });
  for (const edgeIndex of new Set(snaps.map((snap) => snap.edgeIndex))) {
    const edge = graph.edges[edgeIndex];
    const cuts = snaps.flatMap((snap, index) =>
      snap.edgeIndex === edgeIndex && snap.fraction > 0 && snap.fraction < 1
        ? [{ node: graph.nodes.length + index, fraction: snap.fraction }]
        : [],
    );
    cuts.sort((a, b) => a.fraction - b.fraction);
    cuts.unshift({ node: edge.a, fraction: 0 });
    cuts.push({ node: edge.b, fraction: 1 });
    adjacency[edge.a] = adjacency[edge.a].filter((id) => id !== edgeIndex);
    adjacency[edge.b] = adjacency[edge.b].filter((id) => id !== edgeIndex);
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1];
      const b = cuts[i];
      const id = edges.length;
      edges.push({
        ...edge,
        a: a.node,
        b: b.node,
        length: edge.length * (b.fraction - a.fraction),
      });
      adjacency[a.node] = [...adjacency[a.node], id];
      adjacency[b.node] = [...adjacency[b.node], id];
    }
  }
  return {
    graph: { nodes, edges, adjacency, nearestNode: graph.nearestNode },
    start: endpoints[0],
    goal: endpoints[1],
  };
}

/** Plans along streets, respecting one-way roads in a vehicle and snapping the destination to a road. */
export function planNavigation(
  graph: RoadGraph,
  from: Point,
  destination: Point,
  driving: boolean,
): NavigationSnapshot {
  const start = snapToRoad(graph, from, driving);
  const goal = snapToRoad(graph, destination, driving);
  const unavailable: NavigationSnapshot = {
    destination: goal?.point ?? destination,
    points: [],
    distanceM: 0,
    status: "unreachable",
  };
  if (!start || !goal) return unavailable;
  const routing = withEndpoints(graph, start, goal);
  const path = findPath(routing.graph, routing.start, routing.goal, {
    respectOneway: driving,
    allowEdge: (edge) => allowed(edge, driving),
  });
  if (!path) return unavailable;
  const points = path
    .map((node) => routing.graph.nodes[node])
    .filter(
      (point, index, all) =>
        index === 0 || distance(point, all[index - 1]) > 0.01,
    );
  const distanceM = points.reduce(
    (total, point, i) =>
      total + distance(i === 0 ? from : points[i - 1], point),
    0,
  );
  return {
    destination: goal.point,
    points,
    distanceM,
    status: distanceM <= 12 ? "arrived" : "navigating",
  };
}

/** Stateful route planner with movement-based, at-most-once-per-second replanning. */
export type ArenaNavigation = {
  snapshot(): NavigationSnapshot | null;
  select(destination: Point | null, position: Point, driving: boolean): void;
  update(
    position: Point,
    driving: boolean,
    nowMs: number,
  ): NavigationSnapshot | null;
};

/** Creates a client-local destination that survives map closing and reroutes after moving or changing vehicles. */
export function createArenaNavigation(graph: RoadGraph): ArenaNavigation {
  let current: NavigationSnapshot | null = null;
  let target: Point | null = null;
  let lastPosition: Point = [0, 0];
  let lastDriving = false;
  let lastPlan = -Infinity;
  const plan = (position: Point, driving: boolean): void => {
    current = target ? planNavigation(graph, position, target, driving) : null;
    lastPosition = position;
    lastDriving = driving;
  };
  return {
    snapshot: () => current,
    select(destination, position, driving) {
      target = destination;
      plan(position, driving);
      lastPlan = -Infinity;
    },
    update(position, driving, nowMs) {
      if (!current || current.status === "arrived") return current;
      if (
        current.status === "navigating" &&
        current.distanceM <= 30 &&
        distance(position, current.destination) <= 12
      ) {
        current = { ...current, status: "arrived", distanceM: 0, points: [] };
        return current;
      }
      if (
        driving !== lastDriving ||
        (nowMs - lastPlan >= 1000 && distance(position, lastPosition) >= 5)
      ) {
        plan(position, driving);
        lastPlan = nowMs;
      }
      return current;
    },
  };
}

/** Dutch distance and route state for both the map and driving HUD. */
export function navigationLabel(route: NavigationSnapshot): string {
  if (route.status === "arrived") return "Bestemming bereikt";
  if (route.status === "unreachable")
    return "Geen route gevonden. Kies een andere straat.";
  const metres = Math.round(route.distanceM);
  const length =
    metres >= 1000
      ? `${(metres / 1000).toFixed(1).replace(".", ",")} km`
      : `${metres} m`;
  return `Volg de route · ${length}`;
}
