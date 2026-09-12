/**
 * What the arena step reads from the world, what a session is created from, and the handful of
 * constants the other simulation modules share. Nothing here imports a sibling, so it can sit at
 * the bottom of the dependency order without risking a cycle.
 */
import type { Rect } from "../mapBuild/geometry";
import type { CollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import type { RoadGraph } from "../world/roadGraph";
import { CAR_BODY_RADIUS_M } from "./collisions";
import { PLAYER_RADIUS_M } from "./player";
import type { SpawnGraph } from "./spawn";

/** Distance from the car body within which Instappen works (spec §5). */
export const ENTER_RANGE_M = 1.5;

/** Ticks the driver needs to get in before the car answers the controls (spec §5: 0.6 s). */
export const BOARDING_TICKS = 18;

/** The local player's id; Plan 3 assigns real ids. */
export const LOCAL_PLAYER_ID = 0;

/** First id handed to entities (the player is 0). */
export const FIRST_ENTITY_ID = 1;

/** Gap between the player and the car body after stepping out (m); keeps the door within ENTER_RANGE_M. */
const EXIT_CLEARANCE_M = 0.2;

/** How far from the car centre a player stands after Uitstappen: just outside the car–player contact circle. */
export const EXIT_OFFSET_M =
  CAR_BODY_RADIUS_M + PLAYER_RADIUS_M + EXIT_CLEARANCE_M;

/** What the arena step reads from the world. */
export type ArenaWorld = {
  collision: Pick<CollisionGrid, "resolveCircle" | "query">;
  index: MapIndex;
  graph: RoadGraph;
  viewRect?: Rect;
};

/** What a session is created from. */
export type ArenaSetup = {
  index: MapIndex;
  graph: SpawnGraph;
  seed: number;
  zone: MapZone | null;
};
