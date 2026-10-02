/**
 * A read-only narrowing of a collision grid that hides destroyed buildings, so the parts of the
 * simulation that only look up or resolve against obstacles (bullets, movement) never see rubble
 * as solid. Built once per tick from the grid and the current set of destroyed structure ids
 * (spec §3.5); the grid itself is never mutated.
 */
import type { Rect } from "../mapBuild/geometry";
import type { CollisionGrid, Obstacle } from "./collisionGrid";
import type { Point } from "./projection";

/** The subset of a collision grid a destructible-aware caller needs. */
export type CollisionView = Pick<CollisionGrid, "query" | "resolveCircle"> &
  Partial<Pick<CollisionGrid, "resolveCircleSkipping">>;

/** True for a building obstacle whose structure id is in `destroyed`. */
function isDestroyedBuilding(
  obstacle: Obstacle,
  destroyed: ReadonlySet<number>,
): boolean {
  return (
    obstacle.structure !== undefined && destroyed.has(obstacle.structure.id)
  );
}

/**
 * A view of `collision` with every destroyed building removed from queries and skipped when
 * resolving a circle. Returns `collision` itself when `destroyed` is empty, so a tick with no
 * collapsed buildings pays no extra cost. When `collision` has no `resolveCircleSkipping` (a
 * minimal test fake), `resolveCircle` simply falls through to the underlying one — such a fake
 * has no obstacles to skip in the first place.
 */
export function withoutStructures(
  collision: CollisionView,
  destroyed: ReadonlySet<number>,
): CollisionView {
  if (destroyed.size === 0) return collision;
  return {
    query: (rect: Rect) =>
      collision
        .query(rect)
        .filter((obstacle) => !isDestroyedBuilding(obstacle, destroyed)),
    resolveCircle: (centre: Point, radius: number) =>
      collision.resolveCircleSkipping
        ? collision.resolveCircleSkipping(centre, radius, (obstacle) =>
            isDestroyedBuilding(obstacle, destroyed),
          )
        : collision.resolveCircle(centre, radius),
  };
}
