/**
 * The 3D view's effects (spec §6.8): bursts for the simulation's muzzle, impact and explosion
 * effects, tracers, rockets and shells for the bullets in flight, and smoke from wrecked and
 * damaged cars. The simulation runs at 30 Hz and the renderer at display rate, so `sync` sees each
 * effect over several frames: it bursts an effect the first frame its id appears and forgets the id
 * once the effect has left the scene. Given the shooters' muzzles, shots, flashes and rockets
 * leave the weapon rather than the body (immersion spec §5).
 */
import { Group, type Object3D, type Vector3 } from "three";
import type { Scene } from "../render/renderScene";
import { burst, type BurstTargets } from "./bursts";
import { MUZZLE_MATCH_M } from "./entityShots";
import type { MuzzlePoints } from "./muzzleMap";
import { createDebrisPool } from "./debris";
import { createFlashPool } from "./flashes";
import { createParticleSystem, type ParticleSystem } from "./particles";
import { createProjectiles3d } from "./projectiles3d";
import { createSeenIds } from "./seenIds";
import { createVehicleSmoke } from "./vehicleSmoke";

/** Share of the particle budget that goes to fire, sparks and embers; smoke and dust get the rest. */
const FIRE_SHARE = 0.35;
/** Debris chunks alive at once: four explosions' worth. */
const DEBRIS_CAPACITY = 48;

/** What the effects read from a frame's scene. */
export type EffectsScene = Pick<
  Scene,
  "effects" | "bullets" | "vehicles" | "players" | "localPlayerId"
> &
  Partial<Pick<Scene, "cops">>;

/** The 3D effects. */
export type Effects3d = {
  /** Add to the scene once. */
  object: Object3D;
  /**
   * The normal-blended particle pool (smoke, dust). Lend it to `createDestruction3d` so collapses
   * share the budget; `update` here moves it, so do not update it again.
   */
  smoke: ParticleSystem;
  /**
   * Reads a frame's scene: bursts effects seen for the first time, draws the bullets in flight and
   * lets smoking vehicles puff. Call once per frame, before `update`.
   *
   * @param scene - The frame's scene.
   * @param focus - The camera focus in world metres, for the vehicle smoke's range; defaults to the
   *   local player's position.
   * @param ownMuzzleHidden - First person: your own muzzle flashes light the street but draw no
   *   flame — at chest height just ahead of the eye it would fill the view, and the view model
   *   flashes at its own barrel instead.
   * @param muzzles - Every shooter's muzzle by owner id (yours the view model's in first
   *   person): flashes and their light go there, and rounds and rockets start there.
   */
  sync(
    scene: EffectsScene,
    focus?: { x: number; y: number },
    ownMuzzleHidden?: boolean,
    muzzles?: MuzzlePoints,
  ): void;
  /** Advances every particle, chunk, fireball and flash light by `dt` seconds. */
  update(dt: number): void;
  /** Frees every geometry and material; detach `object` yourself. */
  dispose(): void;
};

/** The local player's position, or `null` when this client has no player in the scene. */
function localFocus(scene: EffectsScene): { x: number; y: number } | null {
  const own = scene.players.find((player) => player.id === scene.localPlayerId);
  return own ? { x: own.x, y: own.y } : null;
}

/** A body a muzzle flash may have been lit at: a player's or an officer's. */
type Body = { id: number; x: number; y: number };

/** The nearer of `best` and `body` to `(x, y)`, when `body` is within {@link MUZZLE_MATCH_M}. */
function nearerBody(
  best: { id: number | null; reach: number },
  body: Body,
  x: number,
  y: number,
): void {
  const dx = x - body.x;
  const dy = y - body.y;
  const reach = dx * dx + dy * dy;
  if (reach > best.reach) return;
  best.id = body.id;
  best.reach = reach;
}

/**
 * Who lit a muzzle flash: the simulation lights it at the shooter's body, so it is the nearest
 * player or officer within {@link MUZZLE_MATCH_M} — never simply you because you stand close to
 * someone firing.
 *
 * @returns The shooter's id, or `null` when no body is that near (a rocket tube, a tank barrel).
 */
function shooterOf(
  scene: EffectsScene,
  effect: EffectsScene["effects"][number],
): number | null {
  const best = { id: null as number | null, reach: MUZZLE_MATCH_M ** 2 };
  for (const player of scene.players)
    nearerBody(best, player, effect.x, effect.y);
  for (const cop of scene.cops ?? []) nearerBody(best, cop, effect.x, effect.y);
  return best.id;
}

/** A muzzle flash within this reach (in the ground plane) of a shooter's muzzle is theirs, metres. */
export const MUZZLE_OWNER_REACH_M = 1.5;
/** No shooter's muzzle is known. */
const NO_MUZZLES: MuzzlePoints = new Map();

/**
 * Where a muzzle flash's flame and light go: its shooter's muzzle when the shooter is known — or
 * nowhere special when that shooter holds none in view (out of draw distance), never someone
 * else's gun nearby. Only a flash lit away from every body — a rocket's tube or a tank's barrel
 * end — goes to the nearest muzzle within {@link MUZZLE_OWNER_REACH_M}.
 */
function flashMuzzle(
  effect: EffectsScene["effects"][number],
  shooter: number | null,
  muzzles: MuzzlePoints,
): Readonly<Vector3> | null {
  if (shooter !== null) return muzzles.get(shooter) ?? null;
  let nearest: Readonly<Vector3> | null = null;
  let best = MUZZLE_OWNER_REACH_M * MUZZLE_OWNER_REACH_M;
  for (const point of muzzles.values()) {
    const dx = point.x - effect.x;
    const dz = point.z - effect.y;
    const reach = dx * dx + dz * dz;
    if (reach > best) continue;
    best = reach;
    nearest = point;
  }
  return nearest;
}

/** Bursts an effect seen for the first time; a muzzle flash at its shooter's muzzle. */
function burstEffect(
  targets: BurstTargets,
  scene: EffectsScene,
  effect: EffectsScene["effects"][number],
  ownMuzzleHidden: boolean,
  muzzles: MuzzlePoints,
): void {
  if (effect.kind !== "muzzle") {
    burst(targets, effect);
    return;
  }
  const shooter = shooterOf(scene, effect);
  const flame = !(ownMuzzleHidden && shooter === scene.localPlayerId);
  burst(targets, effect, flame, flashMuzzle(effect, shooter, muzzles));
}

function createTargets(maxParticles: number): BurstTargets {
  const fireCapacity = Math.round(maxParticles * FIRE_SHARE);
  return {
    fire: createParticleSystem(fireCapacity, true),
    smoke: createParticleSystem(maxParticles - fireCapacity, false),
    debris: createDebrisPool(DEBRIS_CAPACITY),
    flashes: createFlashPool(),
  };
}

/**
 * Creates the 3D effects.
 *
 * @param options - `maxParticles`: the particle budget over fire and smoke together.
 * @returns The effects; each frame call `sync` with the scene and then `update`.
 */
export function createEffects3d(options: { maxParticles: number }): Effects3d {
  const targets = createTargets(options.maxParticles);
  const { fire, smoke, debris, flashes } = targets;
  const projectiles = createProjectiles3d(fire, smoke);
  const vehicleSmoke = createVehicleSmoke(fire, smoke);
  const seen = createSeenIds();
  const object = new Group();
  object.name = "effects";
  // Glowing sparks draw after the smoke, so embers shine through a column instead of behind it.
  fire.object.renderOrder = 1;
  object.add(
    smoke.object,
    fire.object,
    debris.object,
    flashes.object,
    projectiles.object,
  );
  let clock = 0;
  return {
    object,
    smoke,
    sync(scene, focus, ownMuzzleHidden = false, muzzles = NO_MUZZLES) {
      for (const effect of scene.effects)
        if (seen.firstSeen(effect.id))
          burstEffect(targets, scene, effect, ownMuzzleHidden, muzzles);
      seen.endFrame();
      projectiles.sync(scene.bullets, muzzles);
      vehicleSmoke.sync(scene.vehicles, focus ?? localFocus(scene), clock);
    },
    update(dt) {
      clock += dt;
      fire.update(dt);
      smoke.update(dt);
      debris.update(dt);
      flashes.update(dt);
    },
    dispose() {
      fire.dispose();
      smoke.dispose();
      debris.dispose();
      flashes.dispose();
      projectiles.dispose();
    },
  };
}
