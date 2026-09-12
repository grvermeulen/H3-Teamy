import { pointInRect, type Rect } from "../mapBuild/geometry";
import type { CollisionGrid } from "../world/collisionGrid";
import type { MapZone } from "../world/mapTypes";
import { moveToward } from "../world/pathFollow";
import {
  advanceRail,
  nearestRail,
  pavementEdgesWithin,
  pavementOffsetM,
  railHeading,
  railPoint,
  randomRail,
  type RailGraph,
} from "../world/pavements";
import type { Point } from "../world/projection";
import { zoneCentreMetres, zoneRadiusMetres } from "../world/zone";
import { resolveVehicleAgainstCircle } from "./collisions";
import { EXPLOSION_DAMAGE, inBlastRadius } from "./damage";
import { eventsOfKind, pushEvent } from "./events";
import { PLAYER_RADIUS_M } from "./player";
import { driverPlayer } from "./players";
import { edgesNear, farFromAll, pickEdgeTNear } from "./spawn";
import type {
  ArenaEvent,
  ArenaState,
  EffectState,
  PedState,
  RailPosition,
  VehicleState,
} from "./types";

/** Living pedestrians kept around the players of the active zone. */
export const PEDS_PER_ZONE = 50;
/** New pedestrians appear within this distance of the player they are spawned around. */
export const PED_SPAWN_RADIUS_M = 150;
/** A living pedestrian farther than this from every player, and off screen, is recycled. */
export const PED_RECYCLE_DISTANCE_M = 250;
/** Walking speed on the pavement. */
export const PED_WALK_SPEED_MPS = 1.4;
/** Speed away from gunfire and explosions. */
export const PED_FLEE_SPEED_MPS = 5.5;
/** Threats within this distance frighten. */
export const PED_FLEE_RADIUS_M = 25;
/** Ticks of fleeing. */
export const PED_FLEE_TICKS = 120;
/** Ticks a body stays. */
export const PED_BODY_TICKS = 240;
/** Pedestrian health. */
export const PED_MAX_HEALTH = 40;
/** Collision radius; the same circle as a player. */
export const PED_RADIUS_M = PLAYER_RADIUS_M;
/** Pedestrians live inside the zone disc plus this margin. */
export const PED_SPAWN_MARGIN_M = 100;
/** Fresh pedestrians keep this distance from every player. */
export const PED_SPAWN_MIN_FROM_PLAYER_M = 30;
/** How far a fleeing pedestrian looks for a pavement to rejoin. */
export const PED_REJOIN_SNAP_M = 60;
/** Every this many ticks missing pedestrians are replaced. */
export const PED_RESPAWN_INTERVAL_TICKS = 30;
/** Most pedestrians replaced per top-up. */
export const PED_RESPAWN_BATCH = 5;
const EXPLOSION_FRIGHT_TICKS = 1;
const RAIL_SNAP_M = 0.5;
const SPAWN_ATTEMPTS = 20;
const COIN_FLIP = 0.5;

/** What the pedestrian step reads from the world. */
export type PedWorld = {
  graph: RailGraph;
  collision: Pick<CollisionGrid, "resolveCircle">;
  viewRect?: Rect;
};

function railOffset(graph: RailGraph, rail: RailPosition): number {
  return pavementOffsetM(graph.edges[rail.edge].roadClass);
}

/** A healthy pedestrian standing on its rail, facing along it. */
/** Looks a pedestrian can have; the art is `ped1`…`ped6` in the sprite manifest. */
export const PED_LOOKS = 6;

/**
 * The look of a pedestrian, derived from its id so it costs nothing on the wire and every client
 * agrees.
 *
 * @param id - The pedestrian's id.
 * @returns A look index in `0..PED_LOOKS - 1`.
 */
export function pedLook(id: number): number {
  return ((id % PED_LOOKS) + PED_LOOKS) % PED_LOOKS;
}

/**
 * The sprite manifest key of a pedestrian's look.
 *
 * @param id - The pedestrian's id.
 * @returns `ped1`…`ped6`.
 */
export function pedLookName(id: number): string {
  return `ped${pedLook(id) + 1}`;
}

export function createPed(
  id: number,
  graph: RailGraph,
  rail: RailPosition,
): PedState {
  const [x, y] = railPoint(graph, rail, railOffset(graph, rail));
  return {
    id,
    x,
    y,
    facing: railHeading(graph, rail),
    health: PED_MAX_HEALTH,
    mode: "walk",
    modeUntilTick: 0,
    rail,
    fleeX: 0,
    fleeY: 0,
  };
}

/** Pedestrians that are not dead. */
export function alivePeds(peds: PedState[]): PedState[] {
  return peds.filter((ped) => ped.mode !== "dead");
}

/** Pavement edges a pedestrian may spawn on, grouped by the point they are spawned around. */
type RailPool = { centre: Point | null; edges: number[] };

function railPools(
  zone: MapZone,
  graph: RailGraph,
  around: Point[],
): RailPool[] {
  const zoneEdges = pavementEdgesWithin(
    graph,
    zoneCentreMetres(zone),
    zoneRadiusMetres(zone) + PED_SPAWN_MARGIN_M,
  );
  if (around.length === 0) return [{ centre: null, edges: zoneEdges }];
  return around
    .map((centre) => ({
      centre,
      edges: edgesNear(graph, zoneEdges, centre, PED_SPAWN_RADIUS_M),
    }))
    .filter((pool) => pool.edges.length > 0);
}

function railFromPool(
  graph: RailGraph,
  pool: RailPool,
  random: () => number,
): RailPosition | null {
  if (pool.centre === null) return randomRail(graph, pool.edges, random);
  const near = pickEdgeTNear(
    graph,
    pool.edges,
    pool.centre,
    PED_SPAWN_RADIUS_M,
    random,
  );
  if (!near) return null;
  const direction = random() < COIN_FLIP ? -1 : 1;
  const side = random() < COIN_FLIP ? -1 : 1;
  // `edgeT` on a rail runs from the directed start, so a reversed rail mirrors the fraction.
  return {
    edge: near.edge,
    edgeT: direction === 1 ? near.edgeT : 1 - near.edgeT,
    direction,
    side,
  };
}

/**
 * Up to `count` seeded pedestrians on pavement rails inside the zone, at least 30 m from every
 * `avoid` point and outside the visible rect. With `around` given, each pedestrian appears within
 * {@link PED_SPAWN_RADIUS_M} of one of those points — the players — so the crowd is where the
 * action is rather than thinned over the whole 500 m zone disc.
 */
export function spawnPeds(
  zone: MapZone,
  graph: RailGraph,
  random: () => number,
  avoid: Point[],
  viewRect: Rect | null,
  firstId: number,
  count: number,
  around: Point[] = [],
): PedState[] {
  const pools = railPools(zone, graph, around);
  const peds: PedState[] = [];
  if (pools.length === 0) return peds;
  for (let attempt = 0; attempt < count * SPAWN_ATTEMPTS; attempt++) {
    if (peds.length >= count) break;
    const pool =
      pools[Math.min(pools.length - 1, Math.floor(random() * pools.length))];
    const rail = railFromPool(graph, pool, random);
    if (!rail) continue;
    const ped = createPed(firstId + peds.length, graph, rail);
    const point: Point = [ped.x, ped.y];
    if (!farFromAll(point, avoid, PED_SPAWN_MIN_FROM_PLAYER_M)) continue;
    if (viewRect && pointInRect(point, viewRect)) continue;
    peds.push(ped);
  }
  return peds;
}

/**
 * Drops living pedestrians farther than {@link PED_RECYCLE_DISTANCE_M} from every `anchor` and
 * outside `viewRect`, so the top-up can place them near the players again. Bodies stay until
 * they fade; nobody sees a pedestrian vanish.
 */
export function recyclePeds(
  peds: PedState[],
  anchors: Point[],
  viewRect: Rect | null,
): PedState[] {
  if (anchors.length === 0) return peds;
  const kept = peds.filter((ped) => {
    if (ped.mode === "dead") return true;
    const point: Point = [ped.x, ped.y];
    if (viewRect && pointInRect(point, viewRect)) return true;
    return !farFromAll(point, anchors, PED_RECYCLE_DISTANCE_M);
  });
  return kept.length === peds.length ? peds : kept;
}

/** Applies damage; at zero health the pedestrian becomes a body for 240 ticks. */
export function damagePed(
  ped: PedState,
  amount: number,
  tick: number,
): PedState {
  if (amount <= 0 || ped.mode === "dead") return ped;
  const health = Math.max(0, ped.health - amount);
  if (health > 0) return { ...ped, health };
  return {
    ...ped,
    health: 0,
    mode: "dead",
    modeUntilTick: tick + PED_BODY_TICKS,
    rail: null,
  };
}

function frighten(ped: PedState, sources: Point[], tick: number): PedState {
  let nearest: Point | null = null;
  let nearestDistance = PED_FLEE_RADIUS_M;
  for (const source of sources) {
    const distance = Math.hypot(ped.x - source[0], ped.y - source[1]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = source;
    }
  }
  if (!nearest) return ped;
  const awayX = ped.x - nearest[0];
  const awayY = ped.y - nearest[1];
  const length = Math.hypot(awayX, awayY);
  const fleeX = length === 0 ? Math.cos(ped.facing) : awayX / length;
  const fleeY = length === 0 ? Math.sin(ped.facing) : awayY / length;
  return {
    ...ped,
    mode: "flee",
    modeUntilTick: tick + PED_FLEE_TICKS,
    fleeX,
    fleeY,
    facing: Math.atan2(fleeY, fleeX),
  };
}

/** Makes living pedestrians flee from the nearest nearby gunfire or explosion. */
export function frightenPeds(
  peds: PedState[],
  sources: Point[],
  tick: number,
): PedState[] {
  if (sources.length === 0) return peds;
  return peds.map((ped) =>
    ped.mode === "dead" ? ped : frighten(ped, sources, tick),
  );
}

/** Gunfire this tick and fresh explosion effects, as points to run from. */
export function threatSources(
  events: ArenaEvent[],
  effects: EffectState[],
  tick: number,
): Point[] {
  const points: Point[] = eventsOfKind(events, "shot").map((shot) => [
    shot.x,
    shot.y,
  ]);
  for (const effect of effects)
    if (
      effect.kind === "explosion" &&
      tick - effect.bornTick <= EXPLOSION_FRIGHT_TICKS
    )
      points.push([effect.x, effect.y]);
  return points;
}

function walk(
  ped: PedState,
  graph: RailGraph,
  dt: number,
  random: () => number,
): PedState {
  if (!ped.rail) return ped;
  const target = railPoint(graph, ped.rail, railOffset(graph, ped.rail));
  if (Math.hypot(target[0] - ped.x, target[1] - ped.y) > RAIL_SNAP_M) {
    const [x, y] = moveToward([ped.x, ped.y], target, PED_WALK_SPEED_MPS * dt);
    return {
      ...ped,
      x,
      y,
      facing: Math.atan2(target[1] - ped.y, target[0] - ped.x),
    };
  }
  const rail = advanceRail(graph, ped.rail, PED_WALK_SPEED_MPS * dt, random);
  const [x, y] = railPoint(graph, rail, railOffset(graph, rail));
  return { ...ped, rail, x, y, facing: railHeading(graph, rail) };
}

function flee(
  ped: PedState,
  collision: Pick<CollisionGrid, "resolveCircle">,
  dt: number,
): PedState {
  const [x, y] = collision.resolveCircle(
    [
      ped.x + ped.fleeX * PED_FLEE_SPEED_MPS * dt,
      ped.y + ped.fleeY * PED_FLEE_SPEED_MPS * dt,
    ],
    PED_RADIUS_M,
  );
  return { ...ped, x, y };
}

function rejoinPavement(
  ped: PedState,
  graph: RailGraph,
  random: () => number,
): PedState {
  const rail = nearestRail(graph, [ped.x, ped.y], PED_REJOIN_SNAP_M, random);
  return { ...ped, mode: "walk", rail };
}

/** One tick of a pedestrian, or null once its body expires. */
export function stepPed(
  ped: PedState,
  world: PedWorld,
  dt: number,
  tick: number,
  random: () => number,
): PedState | null {
  if (ped.mode === "dead") return tick >= ped.modeUntilTick ? null : ped;
  if (ped.mode === "flee")
    return tick >= ped.modeUntilTick
      ? rejoinPavement(ped, world.graph, random)
      : flee(ped, world.collision, dt);
  return walk(ped, world.graph, dt, random);
}

function hitPedWithVehicle(
  ped: PedState,
  vehicle: VehicleState,
  tick: number,
): { ped: PedState; killed: boolean } {
  const contact = resolveVehicleAgainstCircle(vehicle, [ped.x, ped.y]);
  if (!contact.touched) return { ped, killed: false };
  const moved = { ...ped, x: contact.point[0], y: contact.point[1] };
  const hurt = damagePed(moved, contact.damage, tick);
  return { ped: hurt, killed: hurt.mode === "dead" };
}

function runOverPeds(state: ArenaState, tick: number): ArenaState {
  let peds = state.peds;
  let events = state.events;
  for (const vehicle of state.vehicles) {
    if (vehicle.velocityX === 0 && vehicle.velocityY === 0) continue;
    const killerId = driverPlayer(state, vehicle.id)?.id ?? null;
    const next: PedState[] = [];
    for (const ped of peds) {
      const hit =
        ped.mode === "dead"
          ? { ped, killed: false }
          : hitPedWithVehicle(ped, vehicle, tick);
      if (hit.killed)
        events = pushEvent(events, {
          kind: "kill",
          victim: "ped",
          victimId: ped.id,
          killerId,
          x: ped.x,
          y: ped.y,
        });
      next.push(hit.ped);
    }
    peds = next;
  }
  return { ...state, peds, events };
}

/** Steps pedestrians, handles fear, expires bodies, and resolves moving-car contacts. */
export function stepPeds(
  state: ArenaState,
  world: PedWorld,
  dt: number,
  tick: number,
  random: () => number,
): ArenaState {
  const sources = threatSources(state.events, state.effects, tick);
  const peds: PedState[] = [];
  for (const ped of frightenPeds(state.peds, sources, tick)) {
    const next = stepPed(ped, world, dt, tick, random);
    if (next) peds.push(next);
  }
  return runOverPeds({ ...state, peds }, tick);
}

/** Damages living pedestrians inside an exploding car's blast radius. */
export function blastPeds(
  peds: PedState[],
  vehicle: Pick<VehicleState, "x" | "y">,
  tick: number,
): { peds: PedState[]; killed: PedState[] } {
  const killed: PedState[] = [];
  const blasted = peds.map((ped) => {
    if (ped.mode === "dead" || !inBlastRadius(vehicle, [ped.x, ped.y]))
      return ped;
    const hurt = damagePed(ped, EXPLOSION_DAMAGE, tick);
    if (hurt.mode === "dead") killed.push(hurt);
    return hurt;
  });
  return { peds: blasted, killed };
}
