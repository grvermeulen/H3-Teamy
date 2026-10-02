import type { Point } from "./projection";
import { findPath, type PathOptions, type RoadGraph } from "./roadGraph";

/** A remaining node path and its current target. */
export type PathProgress = { path: number[]; target: Point | null };

/** Drops path nodes already within reach and returns the next target. */
export function nextWaypoint(
  graph: Pick<RoadGraph, "nodes">,
  path: number[],
  position: Point,
  reachM: number,
): PathProgress {
  let start = 0;
  while (
    start < path.length &&
    Math.hypot(
      graph.nodes[path[start]][0] - position[0],
      graph.nodes[path[start]][1] - position[1],
    ) <= reachM
  )
    start += 1;
  const remaining = start === 0 ? path : path.slice(start);
  return {
    path: remaining,
    target: remaining.length > 0 ? graph.nodes[remaining[0]] : null,
  };
}

/** Routes between the graph nodes nearest two points, or returns null when either cannot snap. */
export function pathTo(
  graph: RoadGraph,
  from: Point,
  to: Point,
  snapM: number,
  options: PathOptions = {},
): number[] | null {
  const start = graph.nearestNode(from, snapM);
  const goal = graph.nearestNode(to, snapM);
  if (start === null || goal === null) return null;
  return findPath(graph, start, goal, options);
}

/** Moves toward a target without overshooting it. */
export function moveToward(
  position: Point,
  target: Point,
  distanceM: number,
): Point {
  const dx = target[0] - position[0];
  const dy = target[1] - position[1];
  const distance = Math.hypot(dx, dy);
  if (distance <= distanceM || distance === 0) return [target[0], target[1]];
  return [
    position[0] + (dx / distance) * distanceM,
    position[1] + (dy / distance) * distanceM,
  ];
}
