/** Degrees to radians. */
export const DEG = Math.PI / 180;

/** A point in canvas space (y grows downwards). */
export type Vec = { x: number; y: number };

/** The easing curves a keyframe or a movement can use. */
export type Ease = "linear" | "in" | "out" | "inOut" | "snap" | "back";

/**
 * Linear interpolation.
 *
 * @param a - Value at `t = 0`.
 * @param b - Value at `t = 1`.
 * @param t - Progress, usually 0..1.
 * @returns The blended value.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Clamps `v` into `[lo, hi]`.
 *
 * @param v - The value.
 * @param lo - Lower bound.
 * @param hi - Upper bound.
 * @returns The clamped value.
 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Applies an easing curve to a 0..1 progress value. `snap` is a very fast ease-out for strikes:
 * the fist gets there almost at once and settles; `back` overshoots slightly.
 *
 * @param kind - The curve.
 * @param t - Progress, clamped to 0..1.
 * @returns Eased progress.
 */
export function ease(kind: Ease, t: number): number {
  const x = clamp(t, 0, 1);
  switch (kind) {
    case "linear":
      return x;
    case "in":
      return x * x * x;
    case "out":
      return 1 - (1 - x) ** 3;
    case "inOut":
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    case "snap":
      return 1 - (1 - x) ** 5;
    case "back": {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
    }
  }
}

/**
 * A small seeded PRNG (mulberry32), so particles land the same way on every replay.
 *
 * @param seed - Any integer.
 * @returns A function yielding floats in `[0, 1)`.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hermite smoothstep between two edges.
 *
 * @param a - Lower edge.
 * @param b - Upper edge.
 * @param x - Input.
 * @returns 0 below `a`, 1 above `b`, smooth in between.
 */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
