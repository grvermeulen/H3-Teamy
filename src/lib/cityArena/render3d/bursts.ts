/**
 * The one-off bursts the simulation's effects set off in 3D (spec §6.8): an explosion's fireball,
 * flash, smoke, flames, sparks and debris; a bullet impact's sparks; a muzzle flash. Every burst is
 * seeded by its effect id.
 */
import type { EffectState } from "../sim/types";
import { PERSON_CHEST_HEIGHT_M } from "./coords";
import type { DebrisPool } from "./debris";
import type { FlashPool } from "./flashes";
import {
  emitChunk,
  emitPuff,
  rngFor,
  type ChunkSpec,
  type Emitter,
  type PuffSpec,
  type Rng,
} from "./fxEmit";
import type { ParticleSystem } from "./particles";

/** Smoke puffs rising from an explosion (spec §6.8). */
export const EXPLOSION_SMOKE_COUNT = 24;
/** Debris chunks thrown by an explosion (spec §6.8). */
export const EXPLOSION_DEBRIS_COUNT = 12;
/** Sparks sprayed by a bullet impact (spec §6.8). */
export const IMPACT_SPARK_COUNT = 6;
/** Flames licking out of an explosion's fireball. */
const EXPLOSION_FLAME_COUNT = 10;
/** Hot sparks flung far out of an explosion. */
const EXPLOSION_SPARK_COUNT = 16;
/** Dust puffs knocked off whatever a bullet hit. */
const IMPACT_DUST_COUNT = 2;
/** Tongues of flame out of a muzzle, along the aim. */
const MUZZLE_TONGUE_COUNT = 2;
/** Height of an explosion's centre above the ground, metres. */
const EXPLOSION_HEIGHT_M = 1;
/** How far ahead of the shooter the muzzle is, metres. */
const MUZZLE_OFFSET_M = 0.7;

/** Dark smoke billowing up out of the blast. */
const EXPLOSION_SMOKE: PuffSpec = {
  scatter: 1.5,
  lift: [-0.5, 0.7],
  outward: [0.3, 2.2],
  rise: [1.5, 3.5],
  life: [2.5, 4],
  size: [1.8, 2.8],
  colours: [0x1f1d1b, 0x2a2724, 0x353230],
  gravity: -0.4,
  drag: 0.8,
};

/** Flames licking out of the fireball as it swells. */
const EXPLOSION_FLAME: PuffSpec = {
  scatter: 0.8,
  lift: [-0.3, 0.6],
  outward: [2, 6],
  rise: [1, 5],
  life: [0.25, 0.55],
  size: [1.2, 2],
  colours: [0xffb347, 0xff7a1f, 0xffd27a],
  gravity: -1,
  drag: 3,
};

/** Sparks flung far out, falling back to the street. */
const EXPLOSION_SPARK: PuffSpec = {
  scatter: 0.3,
  lift: [0, 0.5],
  outward: [6, 14],
  rise: [3, 10],
  life: [0.5, 1.1],
  size: [0.14, 0.24],
  colours: [0xffd27a, 0xffb347],
  gravity: 9.8,
  drag: 1.2,
};

/** Charred metal and stone thrown by the blast. */
const EXPLOSION_DEBRIS: ChunkSpec = {
  scatter: 0.5,
  lift: [-0.2, 0.4],
  outward: [3, 9],
  rise: [4, 11],
  life: [2.2, 3.2],
  size: [0.15, 0.4],
  colours: [0x4a423c, 0x5d544c, 0x6e665e, 0x3b3631],
  spin: [4, 12],
};

/** Sparks off a bullet hit. */
const IMPACT_SPARK: PuffSpec = {
  scatter: 0.05,
  lift: [0, 0],
  outward: [2, 6],
  rise: [0.5, 4],
  life: [0.2, 0.4],
  size: [0.08, 0.14],
  colours: [0xffe08a, 0xffc04a],
  gravity: 9.8,
  drag: 2,
};

/** A little dust knocked off what a bullet hit. */
const IMPACT_DUST: PuffSpec = {
  scatter: 0.1,
  lift: [0, 0.1],
  outward: [0, 0.6],
  rise: [0.2, 0.8],
  life: [0.5, 0.8],
  size: [0.3, 0.45],
  colours: [0x8a8278, 0x9a9288],
  gravity: -0.1,
  drag: 2,
};

/** The white-hot core of a muzzle flash: a small additive quad for a few frames. */
const MUZZLE_CORE: PuffSpec = {
  scatter: 0,
  lift: [0, 0],
  outward: [0, 0],
  rise: [0, 0],
  life: [0.05, 0.07],
  size: [0.6, 0.8],
  colours: [0xfff0b0],
  gravity: 0,
  drag: 0,
};

/** Tongues of flame out of the barrel, along the aim. */
const MUZZLE_TONGUE: PuffSpec = {
  scatter: 0,
  lift: [0, 0],
  outward: [5, 9],
  spread: 0.15,
  rise: [-0.2, 0.2],
  life: [0.04, 0.06],
  size: [0.25, 0.4],
  colours: [0xffc860, 0xffe0a0],
  gravity: 0,
  drag: 0,
};

/** Where bursts go. */
export type BurstTargets = {
  fire: ParticleSystem;
  smoke: ParticleSystem;
  debris: DebrisPool;
  flashes: FlashPool;
};

function repeat(times: number, emit: () => void): void {
  for (let index = 0; index < times; index++) emit();
}

function explode(targets: BurstTargets, rng: Rng, at: Emitter): void {
  const { fire, smoke, debris } = targets;
  targets.flashes.explode(at.x, at.y, at.z);
  repeat(EXPLOSION_FLAME_COUNT, () => emitPuff(fire, rng, EXPLOSION_FLAME, at));
  repeat(EXPLOSION_SPARK_COUNT, () => emitPuff(fire, rng, EXPLOSION_SPARK, at));
  repeat(EXPLOSION_SMOKE_COUNT, () =>
    emitPuff(smoke, rng, EXPLOSION_SMOKE, at),
  );
  repeat(EXPLOSION_DEBRIS_COUNT, () =>
    emitChunk(debris, rng, EXPLOSION_DEBRIS, at),
  );
}

function impact(targets: BurstTargets, rng: Rng, at: Emitter): void {
  repeat(IMPACT_SPARK_COUNT, () =>
    emitPuff(targets.fire, rng, IMPACT_SPARK, at),
  );
  repeat(IMPACT_DUST_COUNT, () =>
    emitPuff(targets.smoke, rng, IMPACT_DUST, at),
  );
}

function muzzle(
  targets: BurstTargets,
  rng: Rng,
  at: Emitter,
  aim: number,
): void {
  targets.flashes.muzzle(at.x, at.y, at.z);
  emitPuff(targets.fire, rng, MUZZLE_CORE, at);
  repeat(MUZZLE_TONGUE_COUNT, () =>
    emitPuff(targets.fire, rng, MUZZLE_TONGUE, at, aim),
  );
}

/**
 * Sets off the burst of one new simulation effect.
 *
 * @param targets - The particle pools, debris and flashes the burst goes into.
 * @param effect - The effect, seen for the first time.
 */
export function burst(targets: BurstTargets, effect: EffectState): void {
  const rng = rngFor(effect.kind, effect.id);
  if (effect.kind === "explosion") {
    explode(targets, rng, { x: effect.x, y: EXPLOSION_HEIGHT_M, z: effect.y });
    return;
  }
  if (effect.kind === "impact") {
    impact(targets, rng, {
      x: effect.x,
      y: PERSON_CHEST_HEIGHT_M,
      z: effect.y,
    });
    return;
  }
  const muzzleAt = {
    x: effect.x + Math.cos(effect.angle) * MUZZLE_OFFSET_M,
    y: PERSON_CHEST_HEIGHT_M,
    z: effect.y + Math.sin(effect.angle) * MUZZLE_OFFSET_M,
  };
  muzzle(targets, rng, muzzleAt, effect.angle);
}
