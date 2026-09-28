/**
 * Deterministic variety for the 3D city: every "random" choice (a façade, a tree's turn and size)
 * is a hash of a stable id and a salt naming the choice, so every device builds the same town and
 * a rebuilt cell looks exactly as before.
 */

/** Multiplier of the first mixing round (the golden-ratio constant). */
const GOLDEN_GAMMA = 0x9e3779b1;
/** Multipliers of the finaliser rounds (MurmurHash3's fmix32, whose shifts are 16, 13, 16). */
const MIX_A = 0x85ebca6b;
const MIX_B = 0xc2b2ae35;
/** 2^32, to map a 32-bit hash to [0, 1). */
const UINT32_RANGE = 4294967296;

/**
 * A well-mixed 32-bit hash of an integer id and a salt.
 *
 * @param id - A non-negative integer below 2^32, such as a structure id.
 * @param salt - Names the choice, so one id gives independent values for different choices.
 * @returns An unsigned 32-bit integer.
 */
export function idHash(id: number, salt: number): number {
  let hash = Math.imul((id ^ salt) >>> 0, GOLDEN_GAMMA);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, MIX_A);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, MIX_B);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * {@link idHash} as a number in [0, 1).
 *
 * @param id - The id.
 * @param salt - Names the choice.
 * @returns A value in [0, 1).
 */
export function idUnit(id: number, salt: number): number {
  return idHash(id, salt) / UINT32_RANGE;
}
