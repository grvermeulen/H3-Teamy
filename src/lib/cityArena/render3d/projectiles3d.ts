/**
 * Everything in flight (spec §6.8): gun rounds as tracers, rockets as a body trailing smoke, and the
 * tank's shell as a glowing slug with a faint trail. Rocket and shell models are pooled by bullet
 * id; trails are laid by distance flown, so they look the same at 30 or 144 frames per second.
 */
import { Group } from "three";
import type { BulletState } from "../sim/types";
import { isMelee } from "../sim/weapons";
import { PERSON_CHEST_HEIGHT_M, headingToRotationY } from "./coords";
import { emitPuff, type Emitter, type PuffSpec, type Rng } from "./fxEmit";
import { createRng } from "../sim/rng";
import type { ParticleSystem } from "./particles";
import {
  createProjectileKit,
  type ProjectileKit,
  type ProjectileLook,
} from "./projectileModels";
import { createTracers } from "./tracers";

export { ROCKET_LENGTH_M } from "./projectileModels";
export { TRACER_LENGTH_M } from "./tracers";

/** Seed of the trails' jitter. */
const TRAIL_SEED = 0x7a11;
/** Most trail steps one projectile lays per frame, so a teleport never floods the pool. */
const MAX_STEPS_PER_FRAME = 12;

/**
 * Whether a round is the rocket launcher's. Ruling 2: the simulation's weapon union gains
 * `"rocket"` on another track, so the comparison is on the string until the tracks merge.
 *
 * @param weapon - The round's weapon.
 * @returns True for a rocket.
 */
export function isRocket(weapon: string): boolean {
  return weapon === "rocket";
}

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
};

/** Rounds, rockets and shells in flight. */
export type Projectiles3d = {
  /** Add to the scene once. */
  object: Group;
  /** Draws this frame's rounds and lays the trails; call once per frame with the scene's bullets. */
  sync(bullets: readonly BulletState[]): void;
  /** Frees the geometry and materials; detach `object` yourself. */
  dispose(): void;
};

/** Where a flying projectile's trail puffs go. */
type TrailSink = { fire: ParticleSystem; smoke: ParticleSystem; rng: Rng };

/** The point on a trail a puff is laid at; reused so laying a trail allocates nothing. */
const trailPoint: Emitter = { x: 0, y: PERSON_CHEST_HEIGHT_M, z: 0 };

/** Lays a flight's trail along the stretch it flew since the last frame. */
function layTrail(sink: TrailSink, flight: Flight, bullet: BulletState): void {
  const trail = TRAILS[flight.look];
  const dx = bullet.x - flight.lastX;
  const dy = bullet.y - flight.lastY;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return;
  let along = trail.spacing - flight.carry;
  let laid = 0;
  while (along <= distance && laid < MAX_STEPS_PER_FRAME) {
    const share = along / distance;
    trailPoint.x = flight.lastX + dx * share;
    trailPoint.z = flight.lastY + dy * share;
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

function place(body: Group, bullet: BulletState): void {
  body.visible = true;
  body.position.set(bullet.x, PERSON_CHEST_HEIGHT_M, bullet.y);
  body.rotation.y = headingToRotationY(
    Math.atan2(bullet.directionY, bullet.directionX),
  );
}

/** The projectile models in flight by bullet id, and the spare ones by look. */
type Fleet = {
  /** Starts a frame: every flight counts as gone until `fly` sees it again. */
  begin(): void;
  /** The flight of a bullet, launched from the spare models on its first frame. */
  fly(bullet: BulletState, look: ProjectileLook): Flight;
  /** Ends a frame: hides the models of bullets no longer in flight and keeps them for reuse. */
  land(): void;
};

function createFleet(parent: Group, kit: ProjectileKit): Fleet {
  const flights = new Map<number, Flight>();
  const spare: Record<ProjectileLook, Group[]> = { rocket: [], shell: [] };
  const launch = (bullet: BulletState, look: ProjectileLook): Flight => {
    const reused = spare[look].pop();
    const body = reused ?? kit.build(look);
    if (!reused) parent.add(body);
    const flight = {
      look,
      body,
      lastX: bullet.x,
      lastY: bullet.y,
      carry: 0,
      steps: 0,
      seen: true,
    };
    flights.set(bullet.id, flight);
    return flight;
  };
  return {
    begin() {
      for (const flight of flights.values()) flight.seen = false;
    },
    fly(bullet, look) {
      const flight = flights.get(bullet.id) ?? launch(bullet, look);
      flight.seen = true;
      return flight;
    },
    land() {
      for (const [id, flight] of flights) {
        if (flight.seen) continue;
        flight.body.visible = false;
        spare[flight.look].push(flight.body);
        flights.delete(id);
      }
    },
  };
}

/** What a bullet looks like in flight: a model with a trail, a tracer, or nothing (melee). */
function lookOf(bullet: BulletState): ProjectileLook | "tracer" | null {
  if (isRocket(bullet.weapon)) return "rocket";
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
  return {
    object,
    sync(bullets) {
      fleet.begin();
      tracers.begin();
      for (const bullet of bullets) {
        const look = lookOf(bullet);
        if (look === "tracer") tracers.add(bullet);
        if (look !== "rocket" && look !== "shell") continue;
        const flight = fleet.fly(bullet, look);
        place(flight.body, bullet);
        layTrail(sink, flight, bullet);
      }
      tracers.commit();
      fleet.land();
    },
    dispose() {
      tracers.dispose();
      kit.dispose();
    },
  };
}
