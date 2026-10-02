/**
 * Everything in flight (spec §6.8): gun rounds as tracers, rockets as a body trailing smoke, and the
 * tank's shell as a glowing slug with a faint trail. Rocket and shell models are pooled by bullet
 * id; trails are laid by distance flown, so they look the same at 30 or 144 frames per second.
 * Everything a shooter fires is drawn out of their muzzle and converges onto its flat line over
 * the first metres (`muzzleBlend.ts`); the local shooter's rounds and rockets climb or dip toward
 * the height of what their crosshair covered (`roundAims.ts`).
 */
import { Group, Vector3 } from "three";
import type { BulletState } from "../sim/types";
import { isMelee } from "../sim/weapons";
import { PERSON_CHEST_HEIGHT_M, headingToRotationY } from "./coords";
import { emitPuff, type PuffSpec, type Rng } from "./fxEmit";
import { blendedRoundPoint, roundFlownM, type RoundAim } from "./muzzleBlend";
import type { MuzzlePoints } from "./muzzleMap";
import { createRng } from "../sim/rng";
import type { ParticleSystem } from "./particles";
import {
  createProjectileKit,
  type ProjectileKit,
  type ProjectileLook,
} from "./projectileModels";
import { createRoundAims, type ShooterAim } from "./roundAims";
import { createTracers } from "./tracers";

export { ROCKET_LENGTH_M } from "./projectileModels";
export { TRACER_LENGTH_M } from "./tracers";

/** Seed of the trails' jitter. */
const TRAIL_SEED = 0x7a11;
/** Most trail steps one projectile lays per frame, so a teleport never floods the pool. */
const MAX_STEPS_PER_FRAME = 12;

/**
 * One kind of puff a trail lays: whether it glows (fire) or hangs (smoke), and on which steps —
 * every step, every second step, …
 */
type TrailPuff = { additive: boolean; spec: PuffSpec; every: number };

/** A trail: a step every `spacing` metres flown, each laying the puffs due on it. */
type Trail = { spacing: number; puffs: readonly TrailPuff[] };

/** Grey exhaust hanging in the air behind a rocket. */
const ROCKET_SMOKE: PuffSpec = {
  scatter: 0.12,
  lift: [-0.08, 0.08],
  outward: [0, 0.5],
  rise: [-0.1, 0.5],
  life: [1.1, 1.7],
  size: [0.6, 0.85],
  colours: [0xa8a8a2, 0xb8b6b0, 0x96948e],
  gravity: -0.25,
  drag: 1.2,
};

/** Sparks from the rocket's motor, bright at the head of the trail. */
const ROCKET_SPARK: PuffSpec = {
  scatter: 0,
  lift: [0, 0],
  outward: [0, 0.6],
  rise: [-0.3, 0.3],
  life: [0.08, 0.14],
  size: [0.45, 0.6],
  colours: [0xffa040, 0xffc060],
  gravity: 0,
  drag: 0,
};

/** The faint glowing streak behind a tank shell. */
const SHELL_GLOW: PuffSpec = {
  scatter: 0,
  lift: [0, 0],
  outward: [0, 0.2],
  rise: [-0.1, 0.1],
  life: [0.14, 0.22],
  size: [0.25, 0.35],
  colours: [0xff9a4a],
  gravity: 0,
  drag: 0,
};

/** A wisp of propellant smoke behind a tank shell. */
const SHELL_SMOKE: PuffSpec = {
  scatter: 0.03,
  lift: [0, 0],
  outward: [0, 0.2],
  rise: [0, 0.2],
  life: [0.45, 0.75],
  size: [0.16, 0.24],
  colours: [0xc9c4bc],
  gravity: -0.2,
  drag: 1.5,
};

const TRAILS: Record<ProjectileLook, Trail> = {
  rocket: {
    spacing: 0.25,
    puffs: [
      { additive: true, spec: ROCKET_SPARK, every: 1 },
      { additive: false, spec: ROCKET_SMOKE, every: 2 },
    ],
  },
  shell: {
    spacing: 0.45,
    puffs: [
      { additive: true, spec: SHELL_GLOW, every: 1 },
      { additive: false, spec: SHELL_SMOKE, every: 2 },
    ],
  },
};

/** A projectile model in flight, and where its trail left off. */
type Flight = {
  look: ProjectileLook;
  body: Group;
  lastX: number;
  lastY: number;
  /** Metres flown since the last step. */
  carry: number;
  /** Steps laid so far, which picks the puffs due on the next one. */
  steps: number;
  seen: boolean;
  /** Its shooter's muzzle when first seen, kept so the flight does not swing with the shooter. */
  muzzle: Vector3;
  /** Whether `muzzle` is known; without it the flight starts on its flat line. */
  fromMuzzle: boolean;
};

/** Rounds, rockets and shells in flight. */
export type Projectiles3d = {
  /** Add to the scene once. */
  object: Group;
  /**
   * Draws this frame's rounds and lays the trails; call once per frame with the scene's bullets.
   *
   * @param bullets - The scene's bullets.
   * @param muzzles - Every shooter's muzzle by owner id: rounds, rockets and shells are drawn out
   *   of their shooter's, converging onto their flat line.
   * @param aim - Where the local shooter's crosshair points: their rounds climb or dip toward it.
   */
  sync(
    bullets: readonly BulletState[],
    muzzles?: MuzzlePoints,
    aim?: Readonly<ShooterAim> | null,
  ): void;
  /** Frees the geometry and materials; detach `object` yourself. */
  dispose(): void;
};

/** Where a flying projectile's trail puffs go. */
type TrailSink = { fire: ParticleSystem; smoke: ParticleSystem; rng: Rng };

/** The point on a trail a puff is laid at; reused so laying a trail allocates nothing. */
const trailPoint = new Vector3();

/** No shooter's muzzle is known. */
const NO_MUZZLES: MuzzlePoints = new Map();

/** A flight's muzzle, or `null` when it starts on its flat line. */
function muzzleOf(flight: Flight): Readonly<Vector3> | null {
  return flight.fromMuzzle ? flight.muzzle : null;
}

/** Lays a flight's trail along the stretch it flew since the last frame. */
function layTrail(
  sink: TrailSink,
  flight: Flight,
  bullet: BulletState,
  flown: number,
  aim: RoundAim | null,
): void {
  const trail = TRAILS[flight.look];
  const distance = Math.hypot(bullet.x - flight.lastX, bullet.y - flight.lastY);
  if (distance === 0) return;
  let along = trail.spacing - flight.carry;
  let laid = 0;
  while (along <= distance && laid < MAX_STEPS_PER_FRAME) {
    blendedRoundPoint(
      bullet,
      flown,
      muzzleOf(flight),
      trailPoint,
      distance - along,
      aim,
    );
    for (const { additive, spec, every } of trail.puffs)
      if (flight.steps % every === 0)
        emitPuff(additive ? sink.fire : sink.smoke, sink.rng, spec, trailPoint);
    flight.steps += 1;
    along += trail.spacing;
    laid += 1;
  }
  flight.carry = Math.min(trail.spacing, distance - (along - trail.spacing));
  flight.lastX = bullet.x;
  flight.lastY = bullet.y;
}

/** How steeply an aimed flight climbs (radians, nose up), level once it runs along the ground. */
function climbOf(flight: Flight, aim: RoundAim | null): number {
  if (!aim || flight.body.position.y <= 0) return 0;
  const from = flight.fromMuzzle ? flight.muzzle.y : PERSON_CHEST_HEIGHT_M;
  return Math.atan((aim.height - from) / aim.distance);
}

/** Shows a flight's body where the round is drawn, turned along its flight and its climb. */
function place(
  flight: Flight,
  bullet: BulletState,
  flown: number,
  aim: RoundAim | null,
): void {
  const { body } = flight;
  body.visible = true;
  blendedRoundPoint(bullet, flown, muzzleOf(flight), body.position, 0, aim);
  body.rotation.y = headingToRotationY(
    Math.atan2(bullet.directionY, bullet.directionX),
  );
  body.rotation.z = climbOf(flight, aim);
}

/** The projectile models in flight by bullet id, and the spare ones by look. */
type Fleet = {
  /** Starts a frame: every flight counts as gone until `fly` sees it again. */
  begin(): void;
  /** The flight of a bullet, launched from the spare flights on its first frame. */
  fly(
    bullet: BulletState,
    look: ProjectileLook,
    muzzle: Readonly<Vector3> | undefined,
  ): Flight;
  /** Ends a frame: hides the flights of bullets no longer in flight and keeps them for reuse. */
  land(): void;
};

/** A flight with a new model of `look`, shown under `parent`. */
function newFlight(
  parent: Group,
  kit: ProjectileKit,
  look: ProjectileLook,
): Flight {
  const body = kit.build(look);
  parent.add(body);
  return {
    look,
    body,
    lastX: 0,
    lastY: 0,
    carry: 0,
    steps: 0,
    seen: false,
    muzzle: new Vector3(),
    fromMuzzle: false,
  };
}

/** Starts a (new or reused) flight at a bullet, from its shooter's muzzle if known. */
function launch(
  flight: Flight,
  bullet: BulletState,
  muzzle: Readonly<Vector3> | undefined,
): Flight {
  flight.lastX = bullet.x;
  flight.lastY = bullet.y;
  flight.carry = 0;
  flight.steps = 0;
  flight.seen = true;
  flight.fromMuzzle = muzzle !== undefined;
  if (muzzle) flight.muzzle.copy(muzzle);
  return flight;
}

function createFleet(parent: Group, kit: ProjectileKit): Fleet {
  const flights = new Map<number, Flight>();
  const spare: Record<ProjectileLook, Flight[]> = { rocket: [], shell: [] };
  return {
    begin() {
      for (const flight of flights.values()) flight.seen = false;
    },
    fly(bullet, look, muzzle) {
      const flying = flights.get(bullet.id);
      if (flying) {
        flying.seen = true;
        return flying;
      }
      const flight = spare[look].pop() ?? newFlight(parent, kit, look);
      flights.set(bullet.id, flight);
      return launch(flight, bullet, muzzle);
    },
    land() {
      for (const [id, flight] of flights) {
        if (flight.seen) continue;
        flight.body.visible = false;
        spare[flight.look].push(flight);
        flights.delete(id);
      }
    },
  };
}

/** What a bullet looks like in flight: a model with a trail, a tracer, or nothing (melee). */
function lookOf(bullet: BulletState): ProjectileLook | "tracer" | null {
  if (bullet.weapon === "rocket") return "rocket";
  if (bullet.weapon === "cannon") return "shell";
  return isMelee(bullet.weapon) ? null : "tracer";
}

/**
 * Creates the projectiles view.
 *
 * @param fire - Additive particles for the motor's sparks and the shell's glow.
 * @param smoke - Normal-blended particles for the smoke trails.
 * @returns The view; call `sync` once per frame with the scene's bullets.
 */
export function createProjectiles3d(
  fire: ParticleSystem,
  smoke: ParticleSystem,
): Projectiles3d {
  const kit = createProjectileKit();
  const tracers = createTracers();
  const object = new Group();
  object.name = "projectiles";
  object.add(tracers.object);
  const sink: TrailSink = { fire, smoke, rng: createRng(TRAIL_SEED) };
  const fleet = createFleet(object, kit);
  const aims = createRoundAims();
  return {
    object,
    sync(bullets, muzzles = NO_MUZZLES, aim = null) {
      fleet.begin();
      tracers.begin();
      aims.begin();
      for (const bullet of bullets) {
        const look = lookOf(bullet);
        if (look === null) continue;
        const muzzle = muzzles.get(bullet.ownerId);
        const flown = roundFlownM(bullet);
        const aimed = aims.of(bullet, flown, aim);
        if (look === "tracer") {
          tracers.add(bullet, muzzle ?? null, aimed);
          continue;
        }
        const flight = fleet.fly(bullet, look, muzzle);
        place(flight, bullet, flown, aimed);
        layTrail(sink, flight, bullet, flown, aimed);
      }
      tracers.commit();
      fleet.land();
      aims.end();
    },
    dispose() {
      tracers.dispose();
      kit.dispose();
    },
  };
}
