/**
 * The 3D view's effects (spec §6.8): bursts for the simulation's muzzle, impact and explosion
 * effects, tracers, rockets and shells for the bullets in flight, and smoke from wrecked and
 * damaged cars. The simulation runs at 30 Hz and the renderer at display rate, so `sync` sees each
 * effect over several frames: it bursts an effect the first frame its id appears and forgets the id
 * once the effect has left the scene.
 */
import { Group, type Object3D } from "three";
import type { Scene } from "../render/renderScene";
import { burst, type BurstTargets } from "./bursts";
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
>;

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
   */
  sync(scene: EffectsScene, focus?: { x: number; y: number }): void;
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
    sync(scene, focus) {
      for (const effect of scene.effects)
        if (seen.firstSeen(effect.id)) burst(targets, effect);
      seen.endFrame();
      projectiles.sync(scene.bullets);
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
