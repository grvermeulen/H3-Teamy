import { pointInRect, type Rect } from "../mapBuild/geometry";
import type { CollisionGrid } from "../world/collisionGrid";
import { moveToward, nextWaypoint, pathTo } from "../world/pathFollow";
import type { Point } from "../world/projection";
import type { RoadGraph } from "../world/roadGraph";
import { MAX_BULLETS, createShots } from "./bullets";
import { resolveVehicleAgainstCircle } from "./collisions";
import { EXPLOSION_DAMAGE, inBlastRadius } from "./damage";
import { addEffect } from "./effects";
import { pushEvent } from "./events";
import { MAX_COPS } from "./limits";
import { PLAYER_RADIUS_M } from "./player";
import { driverPlayer, playersOf } from "./players";
import { farFromAll, shuffle } from "./spawn";
import type {
  ArenaPlayerState,
  ArenaState,
  CopState,
  CopWeapon,
  VehicleState,
} from "./types";
import { currentWantedLevel, wantedTarget } from "./wanted";
import { WEAPONS } from "./weapons";

/** Cops on foot per wanted level. */
export const COPS_PER_LEVEL: readonly number[] = [0, 2, 2, 4];
/** Cop health. */
export const COP_MAX_HEALTH = 100;
/** Cop running speed. */
export const COP_RUN_SPEED_MPS = 4.5;
/** Minimum cop spawn distance. */
export const COP_SPAWN_MIN_M = 60;
/** Maximum cop spawn distance. */
export const COP_SPAWN_MAX_M = 120;
/** Cop firing range. */
export const COP_FIRE_RANGE_M = 20;
/** Ticks between cop shots. */
export const COP_COOLDOWN_TICKS = 20;
/** Cop firing inaccuracy half-angle. */
export const COP_INACCURACY_RAD = (15 * Math.PI) / 180;
/** Cop path replan interval. */
export const COP_REPATH_TICKS = 30;
/** Distance at which cops walk directly at the player. */
export const COP_CLOSE_RANGE_M = 25;
/** Level-zero stand-down distance. */
export const COP_STAND_DOWN_DISTANCE_M = 80;
/** Cop body lifetime. */
export const COP_BODY_TICKS = 240;
/** Cop collision radius. */
export const COP_RADIUS_M = PLAYER_RADIUS_M;
/** Wanted level at which cops use shotguns. */
export const COP_SHOTGUN_LEVEL = 3;
/** Cop path node snap radius. */
export const COP_PATH_SNAP_M = 60;
/** Cop path node reach distance. */
export const COP_REACH_M = 1.5;

/** What the cop step reads from the world. */
export type CopWorld = {
  graph: RoadGraph;
  collision: Pick<CollisionGrid, "resolveCircle">;
  viewRect?: Rect;
};

/** Pistol below three stars, shotgun from three stars. */
export function copWeaponForLevel(level: number): CopWeapon {
  return level >= COP_SHOTGUN_LEVEL ? "shotgun" : "pistol";
}

/** Cops that are not dead. */
export function aliveCops(cops: CopState[]): CopState[] {
  return cops.filter((cop) => cop.diedAtTick === null);
}

/** Creates a healthy cop ready to plan and fire. */
export function createCop(
  id: number,
  position: Point,
  weapon: CopWeapon,
  tick: number,
): CopState {
  return {
    id,
    x: position[0],
    y: position[1],
    facing: 0,
    health: COP_MAX_HEALTH,
    weapon,
    path: [],
    repathTick: tick,
    nextShotTick: tick,
    diedAtTick: null,
  };
}

/** Returns graph nodes in an annulus around a point. */
export function nodesWithin(
  graph: RoadGraph,
  centre: Point,
  minM: number,
  maxM: number,
): number[] {
  return graph.nodes.flatMap((node, index) => {
    const drivable = graph.adjacency[index].some(
      (edgeIndex) =>
        graph.edges[edgeIndex].roadClass !== "service" &&
        graph.edges[edgeIndex].roadClass !== "pedestrian",
    );
    if (!drivable) return [];
    const distance = Math.hypot(node[0] - centre[0], node[1] - centre[1]);
    return distance >= minM && distance <= maxM ? [index] : [];
  });
}

/** Seeded cop spawn points outside the camera view. */
export function spawnPointsAround(
  graph: RoadGraph,
  around: Point,
  viewRect: Rect | null,
  random: () => number,
): Point[] {
  return shuffle(
    nodesWithin(graph, around, COP_SPAWN_MIN_M, COP_SPAWN_MAX_M)
      .map((index) => graph.nodes[index])
      .filter((point) => !viewRect || !pointInRect(point, viewRect)),
    random,
  );
}

/** Applies damage and turns a cop into a temporary body at zero health. */
export function damageCop(
  cop: CopState,
  amount: number,
  tick: number,
): CopState {
  if (amount <= 0 || cop.diedAtTick !== null) return cop;
  const health = Math.max(0, cop.health - amount);
  if (health > 0) return { ...cop, health };
  return {
    ...cop,
    health: 0,
    path: [],
    diedAtTick: tick,
  };
}

/** Aims from a cop to a target with seeded ±15 degree error. */
export function copAim(
  cop: CopState,
  target: Point,
  random: () => number,
): number {
  const base = Math.atan2(target[1] - cop.y, target[0] - cop.x);
  return base + (random() * 2 - 1) * COP_INACCURACY_RAD;
}

function isCopRoadClass(roadClass: string): boolean {
  return roadClass !== "service" && roadClass !== "pedestrian";
}

/** Advances one cop toward its target, routing on drivable graph edges outside close range. */
export function stepCop(
  cop: CopState,
  target: Point | null,
  world: CopWorld,
  dt: number,
  tick: number,
): CopState {
  if (cop.diedAtTick !== null || target === null) return cop;
  const distance = Math.hypot(target[0] - cop.x, target[1] - cop.y);
  if (distance <= COP_CLOSE_RANGE_M) {
    const position = moveToward([cop.x, cop.y], target, COP_RUN_SPEED_MPS * dt);
    return {
      ...cop,
      x: position[0],
      y: position[1],
      facing: Math.atan2(target[1] - cop.y, target[0] - cop.x),
      path: [],
    };
  }
  let next = cop;
  if (tick >= cop.repathTick || cop.path.length === 0) {
    const path = pathTo(world.graph, [cop.x, cop.y], target, COP_PATH_SNAP_M, {
      allowEdge: (edge) => isCopRoadClass(edge.roadClass),
    });
    next = {
      ...cop,
      path: path ? path.slice(1) : [],
      repathTick: tick + COP_REPATH_TICKS,
    };
  }
  const progress = nextWaypoint(
    world.graph,
    next.path,
    [next.x, next.y],
    COP_REACH_M,
  );
  if (!progress.target) return next;
  const position = moveToward(
    [next.x, next.y],
    progress.target,
    COP_RUN_SPEED_MPS * dt,
  );
  return {
    ...next,
    x: position[0],
    y: position[1],
    facing: Math.atan2(
      progress.target[1] - next.y,
      progress.target[0] - next.x,
    ),
    path: progress.path,
  };
}

function runOverCops(state: ArenaState, tick: number): ArenaState {
  let cops = state.cops;
  let events = state.events;
  for (const vehicle of state.vehicles) {
    if (vehicle.velocityX === 0 && vehicle.velocityY === 0) continue;
    const killerId = driverPlayer(state, vehicle.id)?.id ?? null;
    cops = cops.map((cop) => {
      if (cop.diedAtTick !== null) return cop;
      const contact = resolveVehicleAgainstCircle(vehicle, [cop.x, cop.y]);
      if (!contact.touched) return cop;
      const hurt = damageCop(
        { ...cop, x: contact.point[0], y: contact.point[1] },
        contact.damage,
        tick,
      );
      if (hurt.diedAtTick !== null)
        events = pushEvent(events, {
          kind: "kill",
          victim: "cop",
          killerId,
          x: cop.x,
          y: cop.y,
        });
      return hurt;
    });
  }
  return { ...state, cops, events };
}

/** Steps cop movement, fire and run-over contacts. */
export function stepCops(
  state: ArenaState,
  world: CopWorld,
  dt: number,
  tick: number,
  random: () => number,
): ArenaState {
  const target = wantedTarget(state);
  let next = state;
  const cops: CopState[] = [];
  for (const cop of state.cops) {
    const moved = stepCop(
      cop,
      target ? [target.x, target.y] : null,
      world,
      dt,
      tick,
    );
    if (
      moved.diedAtTick === null &&
      target &&
      Math.hypot(moved.x - target.x, moved.y - target.y) <= COP_FIRE_RANGE_M &&
      tick >= moved.nextShotTick &&
      next.bullets.length < MAX_BULLETS
    ) {
      const angle = copAim(moved, [target.x, target.y], random);
      const shots = createShots(
        WEAPONS[moved.weapon],
        moved.weapon,
        [moved.x, moved.y],
        angle,
        { ownerId: moved.id, ignoreVehicleId: null, firstId: next.nextId },
        random,
      ).slice(0, MAX_BULLETS - next.bullets.length);
      next = {
        ...next,
        nextId: next.nextId + shots.length + 1,
        bullets: [...next.bullets, ...shots],
        effects: addEffect(next.effects, {
          id: next.nextId + shots.length,
          kind: "muzzle",
          x: moved.x,
          y: moved.y,
          angle,
          bornTick: tick,
        }),
        events: pushEvent(next.events, {
          kind: "shot",
          weapon: moved.weapon,
          ownerId: moved.id,
          x: moved.x,
          y: moved.y,
        }),
      };
      cops.push({ ...moved, nextShotTick: tick + COP_COOLDOWN_TICKS });
    } else cops.push(moved);
  }
  return runOverCops({ ...next, cops }, tick);
}

/** Blast damage to cops, returning those killed by the blast. */
export function blastCops(
  cops: CopState[],
  vehicle: Pick<VehicleState, "x" | "y">,
  tick: number,
): { cops: CopState[]; killed: CopState[] } {
  const killed: CopState[] = [];
  const blasted = cops.map((cop) => {
    if (cop.diedAtTick !== null || !inBlastRadius(vehicle, [cop.x, cop.y]))
      return cop;
    const hurt = damageCop(cop, EXPLOSION_DAMAGE, tick);
    if (hurt.diedAtTick !== null) killed.push(hurt);
    return hurt;
  });
  return { cops: blasted, killed };
}

function retireCops(
  state: ArenaState,
  level: number,
  viewRect: Rect | null,
  tick: number,
): CopState[] {
  const target = wantedTarget(state);
  return state.cops.filter((cop) => {
    if (cop.diedAtTick !== null) return tick - cop.diedAtTick < COP_BODY_TICKS;
    if (level > 0) return true;
    if (!target) return false;
    const distance = Math.hypot(cop.x - target.x, cop.y - target.y);
    return (
      distance <= COP_STAND_DOWN_DISTANCE_M &&
      (!viewRect || pointInRect([cop.x, cop.y], viewRect))
    );
  });
}

function sameCops(left: CopState[], right: CopState[]): boolean {
  return (
    left.length === right.length &&
    left.every((cop, index) => cop === right[index])
  );
}

function spawnMissingCops(
  state: ArenaState,
  target: ArenaPlayerState,
  level: number,
  world: CopWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const missing = COPS_PER_LEVEL[level] - aliveCops(state.cops).length;
  const room = Math.min(missing, MAX_COPS - state.cops.length);
  if (room <= 0) return state;
  const points = spawnPointsAround(
    world.graph,
    [target.x, target.y],
    world.viewRect ?? null,
    random,
  ).filter((point) =>
    farFromAll(
      point,
      state.cops.map((cop) => [cop.x, cop.y]),
      30,
    ),
  );
  const fresh = points
    .slice(0, room)
    .map((point, offset) =>
      createCop(state.nextId + offset, point, copWeaponForLevel(level), tick),
    );
  if (fresh.length === 0) return state;
  return {
    ...state,
    cops: [...state.cops, ...fresh],
    nextId: state.nextId + fresh.length,
  };
}

/** Keeps cop count, equipment and bodies in line with the current wanted level. */
export function manageCops(
  state: ArenaState,
  world: CopWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const level = currentWantedLevel(state);
  const cops = retireCops(state, level, world.viewRect ?? null, tick).map(
    (cop) =>
      cop.diedAtTick === null
        ? { ...cop, weapon: copWeaponForLevel(level) }
        : cop,
  );
  const retired = sameCops(cops, state.cops) ? state : { ...state, cops };
  const target = wantedTarget(retired);
  return target
    ? spawnMissingCops(retired, target, level, world, tick, random)
    : retired;
}
