/**
 * How the 3D effects throw particles and chunks: every kind of puff, spark or chunk is a named spec
 * of ranges, and one function turns a spec into a particle with seeded jitter. Effects never call
 * `Math.random`: a burst is seeded by its effect or structure id, so a blast looks the same on every
 * screen. Emitting reuses one draft object, so it allocates nothing.
 */
import { createRng, seedFromString } from "../sim/rng";
import type { DebrisPool, DebrisSpawn } from "./debris";
import type { Particle, ParticleSystem } from "./particles";

/** A seeded source of floats in [0, 1). */
export type Rng = () => number;

/** An inclusive-exclusive range `[min, max)` a value is drawn from. */
export type Range = readonly [number, number];

/** A kind of particle: where around the emitter it starts, how it flies, looks and ages. */
export type PuffSpec = {
  /** Largest horizontal offset of the start from the emitter, metres. */
  scatter: number;
  /** Height added to the emitter's, metres. */
  lift: Range;
  /** Horizontal speed, m/s: along the heading when one is given, else in a random direction. */
  outward: Range;
  /** Largest turn off the heading, radians; ignored without a heading. */
  spread?: number;
  /** Vertical speed, m/s. */
  rise: Range;
  /** Seconds it lives. */
  life: Range;
  /** Diameter at birth, metres. */
  size: Range;
  /** sRGB colours it picks from. */
  colours: readonly number[];
  /** Downward acceleration, m/s²; negative rises. */
  gravity: number;
  /** Speed lost per second as a rate. */
  drag: number;
};

/** A kind of debris chunk; flies like a {@link PuffSpec}, then tumbles under gravity. */
export type ChunkSpec = Omit<PuffSpec, "gravity" | "drag"> & {
  /** Tumble rate, radians per second. */
  spin: Range;
};

/** A point in three.js space an effect emits from. */
export type Emitter = { x: number; y: number; z: number };

/** Largest turn off the heading when a spec gives none, radians. */
const DEFAULT_SPREAD_RAD = 0.5;
const FULL_TURN_RAD = Math.PI * 2;

/**
 * A seeded generator for one effect.
 *
 * @param kind - What the effect is, so a blast and a collapse with the same id differ.
 * @param id - The effect's or structure's id.
 * @returns A deterministic generator.
 */
export function rngFor(kind: string, id: number): Rng {
  return createRng(seedFromString(`${kind}:${id}`));
}

/**
 * A float drawn evenly from a range.
 *
 * @param rng - The generator.
 * @param range - `[min, max)`.
 * @returns The draw.
 */
export function within(rng: Rng, range: Range): number {
  return range[0] + (range[1] - range[0]) * rng();
}

/**
 * An entry drawn evenly from a list.
 *
 * @param rng - The generator.
 * @param options - A non-empty list.
 * @returns One of its entries.
 */
export function pick<T>(rng: Rng, options: readonly T[]): T {
  return options[Math.floor(rng() * options.length)];
}

const draft: Omit<Particle, "life"> = {
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  maxLife: 0,
  size: 0,
  colour: 0,
  gravity: 0,
  drag: 0,
};

const chunkDraft: DebrisSpawn = {
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  size: 0,
  colour: 0,
  spin: 0,
  maxLife: 0,
};

/** Fills the draft's place and velocity from a spec. */
function aim(
  rng: Rng,
  spec: Omit<PuffSpec, "gravity" | "drag">,
  at: Emitter,
  heading: number | undefined,
): void {
  const offset = rng() * FULL_TURN_RAD;
  const reach = spec.scatter * Math.sqrt(rng());
  draft.x = at.x + Math.cos(offset) * reach;
  draft.y = at.y + within(rng, spec.lift);
  draft.z = at.z + Math.sin(offset) * reach;
  const spread = spec.spread ?? DEFAULT_SPREAD_RAD;
  const angle =
    heading === undefined
      ? rng() * FULL_TURN_RAD
      : heading + (rng() * 2 - 1) * spread;
  const speed = within(rng, spec.outward);
  draft.vx = Math.cos(angle) * speed;
  draft.vy = within(rng, spec.rise);
  draft.vz = Math.sin(angle) * speed;
}

/**
 * Spawns one particle of a spec.
 *
 * @param system - The pool it goes into; dropped when the pool is full.
 * @param rng - The effect's generator.
 * @param spec - What kind of particle.
 * @param at - The emitter, in three.js space.
 * @param heading - World heading to throw it along; omitted throws it any way.
 */
export function emitPuff(
  system: ParticleSystem,
  rng: Rng,
  spec: PuffSpec,
  at: Emitter,
  heading?: number,
): void {
  aim(rng, spec, at, heading);
  draft.maxLife = within(rng, spec.life);
  draft.size = within(rng, spec.size);
  draft.colour = pick(rng, spec.colours);
  draft.gravity = spec.gravity;
  draft.drag = spec.drag;
  system.spawn(draft);
}

/**
 * Throws one debris chunk of a spec.
 *
 * @param pool - The chunk pool; dropped when it is full.
 * @param rng - The effect's generator.
 * @param spec - What kind of chunk.
 * @param at - The emitter, in three.js space.
 * @param heading - World heading to throw it along; omitted throws it any way.
 */
export function emitChunk(
  pool: DebrisPool,
  rng: Rng,
  spec: ChunkSpec,
  at: Emitter,
  heading?: number,
): void {
  aim(rng, spec, at, heading);
  chunkDraft.x = draft.x;
  chunkDraft.y = draft.y;
  chunkDraft.z = draft.z;
  chunkDraft.vx = draft.vx;
  chunkDraft.vy = draft.vy;
  chunkDraft.vz = draft.vz;
  chunkDraft.size = within(rng, spec.size);
  chunkDraft.colour = pick(rng, spec.colours);
  chunkDraft.spin = within(rng, spec.spin);
  chunkDraft.maxLife = within(rng, spec.life);
  pool.spawn(chunkDraft);
}
