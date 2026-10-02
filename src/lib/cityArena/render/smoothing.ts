import { SIM_STEP_S } from "../sim/player";
import type {
  ArenaPlayerState,
  ArenaState,
  BulletState,
  CopState,
  PedState,
  VehicleState,
} from "../sim/types";

/**
 * Where the world is drawn *between* two simulation ticks.
 *
 * The simulation runs a fixed 30 Hz step and has to: the host and every client replay the same
 * ticks, and a step that varied with the frame time would give them different worlds. A display
 * refreshes at 60 Hz or more, so drawing `state` exactly as the stepper left it holds each tick's
 * pose for two frames and then jumps — at a sedan's 28 m/s that is a frame of standing still
 * followed by 0.93 m at once, fifteen times a second. The camera eases every frame on the real
 * frame time, so the jump happens against a gliding background and reads as a stutter rather than
 * as a low frame rate. Driving shows it worst for the simple reason that a car covers thirty times
 * more ground per tick than a player on foot.
 *
 * The cure is render-only: the stepper keeps its fixed step, and every drawn entity is placed
 * `alpha` of the way from the previous tick's pose toward the current one, `alpha` being the
 * leftover time the stepper has not consumed yet. Nothing here is fed back into the simulation, so
 * determinism, the host's authority and the client's prediction are all untouched — this module
 * only ever produces pixels.
 *
 * That places the picture one tick — 33 ms — behind the simulation, because `alpha` 0 draws the
 * *previous* tick and `alpha` 1 the current one. The alternative is to draw `alpha` past the
 * current tick instead, which costs nothing in latency but guesses: a car that just hit a wall
 * would be drawn a frame's worth *into* the wall before being yanked back out. A third of a tick
 * of lag nobody can feel beats a visible overshoot every time something stops suddenly.
 */

/**
 * Movement in one tick beyond which an entity is drawn where the simulation put it instead of
 * being blended. The fastest kind of car covers 1.2 m per tick and the fastest bullet 5.3 m, so
 * anything past this is a teleport, a respawn, or a host snapshot that moved the entity somewhere
 * else; blending across that gap would draw it sliding through the buildings in between.
 */
export const SMOOTH_SNAP_DISTANCE_M = 8;

/** A whole turn in radians. */
const TURN_RAD = Math.PI * 2;

/** Anything the renderer places by id and position. */
type Positioned = { id: number; x: number; y: number };

/** Anything drawn facing a direction: players, pedestrians and officers all carry `facing`. */
type Facing = Positioned & { facing: number };

/**
 * How far between the last two ticks to draw, given the time the stepper has not consumed yet.
 *
 * @param leftoverS - Seconds still sitting in the stepper's accumulator.
 * @returns The blend factor, clamped to 0..1 so a stalled frame cannot extrapolate past the tick.
 */
export function smoothAlpha(leftoverS: number): number {
  return Math.min(1, Math.max(0, leftoverS / SIM_STEP_S));
}

/** The shortest signed way round from `from` to `to`, so a car crossing ±π turns the short way. */
function angleDelta(from: number, to: number): number {
  const raw = (to - from) % TURN_RAD;
  if (raw > Math.PI) return raw - TURN_RAD;
  if (raw < -Math.PI) return raw + TURN_RAD;
  return raw;
}

/** The angle `alpha` of the way from `from` to `to`, the short way round. */
function blendAngle(from: number, to: number, alpha: number): number {
  return from + angleDelta(from, to) * alpha;
}

/** The entities of the previous tick, by id. */
function byId<T extends Positioned>(entities: readonly T[]): Map<number, T> {
  return new Map(entities.map((entity) => [entity.id, entity]));
}

/** True when the entity moved too far in one tick to be anything but a jump. */
function jumped(from: Positioned, to: Positioned): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > SMOOTH_SNAP_DISTANCE_M;
}

/** The position `alpha` of the way from `from` to `to`. */
function blendPosition(
  from: Positioned,
  to: Positioned,
  alpha: number,
): { x: number; y: number } {
  return {
    x: from.x + (to.x - from.x) * alpha,
    y: from.y + (to.y - from.y) * alpha,
  };
}

/**
 * Blends the cars, turning the body the short way round so a heading that wraps past ±π does not
 * spin the sprite the long way for one frame.
 */
function smoothVehicles(
  previous: readonly VehicleState[],
  current: readonly VehicleState[],
  alpha: number,
): VehicleState[] {
  const before = byId(previous);
  return current.map((vehicle) => {
    const from = before.get(vehicle.id);
    // No previous pose means the car was spawned this tick; draw it where it is.
    if (!from || jumped(from, vehicle)) return vehicle;
    return {
      ...vehicle,
      ...blendPosition(from, vehicle, alpha),
      heading: blendAngle(from.heading, vehicle.heading, alpha),
    };
  });
}

/** Blends everything that walks: the players, the pedestrians and the officers. */
function smoothFacing<T extends Facing>(
  previous: readonly T[],
  current: readonly T[],
  alpha: number,
): T[] {
  const before = byId(previous);
  return current.map((entity) => {
    const from = before.get(entity.id);
    if (!from || jumped(from, entity)) return entity;
    return {
      ...entity,
      ...blendPosition(from, entity, alpha),
      facing: blendAngle(from.facing, entity.facing, alpha),
    };
  });
}

/** Blends the projectiles, which carry their direction separately and never turn in flight. */
function smoothBullets(
  previous: readonly BulletState[],
  current: readonly BulletState[],
  alpha: number,
): BulletState[] {
  const before = byId(previous);
  return current.map((bullet) => {
    const from = before.get(bullet.id);
    if (!from || jumped(from, bullet)) return bullet;
    return { ...bullet, ...blendPosition(from, bullet, alpha) };
  });
}

/** The moving entities of one frame, placed between the last two ticks. */
export type SmoothedFrame = {
  players: ArenaPlayerState[];
  peds: PedState[];
  cops: CopState[];
  vehicles: VehicleState[];
  bullets: BulletState[];
};

/** The entities of `state` as they stand, for the frames that have nothing to blend against. */
function unsmoothed(state: ArenaState): SmoothedFrame {
  return {
    players: state.players,
    peds: state.peds,
    cops: state.cops,
    vehicles: state.vehicles,
    bullets: state.bullets,
  };
}

/**
 * The moving entities of `current`, each drawn `alpha` of the way from where `previous` had it.
 *
 * Only position and heading are blended. Everything the tick counts — the walk cycle, the siren
 * flash, the muzzle flashes, the screen shake — stays on `state.tick`, where two frames of one
 * tick are supposed to agree.
 *
 * @param previous - The state one tick back, or `null` when there is no safe pair to blend.
 * @param current - The state the stepper has just produced.
 * @param alpha - How far between the two to draw, 0..1, from {@link smoothAlpha}.
 * @returns The entity arrays to hand the renderer.
 */
export function smoothFrame(
  previous: ArenaState | null,
  current: ArenaState,
  alpha: number,
): SmoothedFrame {
  // Note there is no shortcut at alpha 0: that is not "no blend", it is the previous tick exactly,
  // and at a clean 60 Hz every other frame lands on it. Returning `current` there would draw the
  // world a whole tick ahead on those frames and undo the smoothing it is meant to provide.
  if (!previous || alpha >= 1) return unsmoothed(current);
  return {
    players: smoothFacing(previous.players, current.players, alpha),
    peds: smoothFacing(previous.peds, current.peds, alpha),
    cops: smoothFacing(previous.cops, current.cops, alpha),
    vehicles: smoothVehicles(previous.vehicles, current.vehicles, alpha),
    bullets: smoothBullets(previous.bullets, current.bullets, alpha),
  };
}

/**
 * The pose of one player in a blended frame, for the camera and the aim.
 *
 * @param frame - The blended frame.
 * @param playerId - The player to find.
 * @returns Their blended pose, or `null` when the frame does not carry them.
 */
export function smoothedPlayer(
  frame: SmoothedFrame,
  playerId: number,
): ArenaPlayerState | null {
  return frame.players.find((player) => player.id === playerId) ?? null;
}
