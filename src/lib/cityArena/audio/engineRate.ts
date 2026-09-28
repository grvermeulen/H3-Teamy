/**
 * The engine loop's pitch from a car's speed: one rule for the player's own engine and for the
 * traffic heard around them.
 */

/** The engine clip's playback rate at a standstill. */
export const ENGINE_RATE_MIN = 0.7;
/** The engine clip's playback rate at {@link ENGINE_RATE_TOP_SPEED_MPS} and above. */
export const ENGINE_RATE_MAX = 2.2;
/** The speed at which the engine clip reaches its top rate. */
export const ENGINE_RATE_TOP_SPEED_MPS = 25;

/**
 * The engine clip's playback rate for a speed: idle at rest, rising to the top rate at 25 m/s.
 *
 * @param speedMps - The car's speed.
 * @returns The rate to play the loop at.
 */
export function engineRate(speedMps: number): number {
  const share = Math.max(0, Math.min(1, speedMps / ENGINE_RATE_TOP_SPEED_MPS));
  return ENGINE_RATE_MIN + share * (ENGINE_RATE_MAX - ENGINE_RATE_MIN);
}
