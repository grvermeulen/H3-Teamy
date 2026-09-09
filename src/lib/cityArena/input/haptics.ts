/**
 * Haptics (spec §7): short vibration patterns for the moments that matter, rate limited so a
 * burst of hits does not turn the phone into a buzzer.
 *
 * Two halves. {@link hapticPulses} is pure: given one tick's events and this client's player it
 * says which pulses to fire, so it is unit-tested with plain data. {@link createHaptics} is the
 * device side: it knows the patterns, the gap and the priorities, and it never throws — a device
 * with no motor, or a browser that dislikes a pattern, loses the buzz and nothing else.
 */

import * as Sentry from "@sentry/nextjs";
import type { ArenaEvent, ArenaPlayerState } from "../sim/types";

/** The moments that vibrate. */
export type HapticKind =
  "hit" | "carImpact" | "explosion" | "death" | "kill" | "pickup" | "wanted";

/** One pulse to fire; `strength` scales the kinds that have a range (0 to 1, car impacts). */
export type HapticPulse = { kind: HapticKind; strength: number };

/** What the haptics need from `navigator`; `vibrate` is absent on iOS and on desktops. */
export type VibratorLike = {
  vibrate?: (pattern: number | number[]) => boolean;
};

/** The device side. */
export type Haptics = {
  /** Fires a pulse, unless Trillen is off, the gap has not passed, or the device cannot. */
  fire(kind: HapticKind, strength?: number): void;
};

/** Pulses closer together than this are dropped, unless the later one outranks the earlier. */
export const HAPTIC_MIN_GAP_MS = 80;
/** How close an explosion has to be to be felt. */
export const EXPLOSION_FEEL_RADIUS_M = 30;
/** The car impact speed that earns the longest pulse. */
const IMPACT_FULL_STRENGTH_MPS = 20;
/** Car impact pulse length at the gentlest and the hardest knock (spec §7: 40–90 ms). */
const CAR_IMPACT_MIN_MS = 40;
const CAR_IMPACT_MAX_MS = 90;

/** The pattern for each kind, and how it ranks when two want the motor at once. */
const PATTERNS: Record<
  HapticKind,
  { priority: number; pattern: (strength: number) => number | number[] }
> = {
  pickup: { priority: 0, pattern: () => 12 },
  hit: { priority: 1, pattern: () => 25 },
  wanted: { priority: 1, pattern: () => [30, 30, 30] },
  carImpact: {
    priority: 2,
    pattern: (strength) =>
      Math.round(
        CAR_IMPACT_MIN_MS + strength * (CAR_IMPACT_MAX_MS - CAR_IMPACT_MIN_MS),
      ),
  },
  kill: { priority: 2, pattern: () => [15, 40, 15] },
  explosion: { priority: 3, pattern: () => [90, 40, 120] },
  death: { priority: 4, pattern: () => [120, 60, 220] },
};

/** Clamps a strength into 0 to 1. */
function unit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * True when this player's health went down this tick. A respawn sends it up, so a fresh spawn is
 * not a hit.
 *
 * @param previousHealth - Health at the last tick, or null before the first.
 * @param health - Health now.
 * @returns Whether damage landed.
 */
export function tookDamage(
  previousHealth: number | null,
  health: number,
): boolean {
  return previousHealth !== null && health < previousHealth;
}

/** True when the point is within feeling range of this player. */
function nearMe(me: ArenaPlayerState, x: number, y: number): boolean {
  return Math.hypot(x - me.x, y - me.y) <= EXPLOSION_FEEL_RADIUS_M;
}

/** The pulse one event earns this player, or null when it is not theirs to feel. */
function pulseFor(event: ArenaEvent, me: ArenaPlayerState): HapticPulse | null {
  if (event.kind === "explosion" && nearMe(me, event.x, event.y))
    return { kind: "explosion", strength: 1 };
  if (event.kind === "impact" && me.vehicleId !== null) {
    const mine =
      event.vehicleId === me.vehicleId || event.otherVehicleId === me.vehicleId;
    if (mine)
      return {
        kind: "carImpact",
        strength: unit(event.impactSpeed / IMPACT_FULL_STRENGTH_MPS),
      };
  }
  if (event.kind === "kill" && event.victim === "player") {
    if (event.victimId === me.id) return { kind: "death", strength: 1 };
    if (event.killerId === me.id) return { kind: "kill", strength: 1 };
  }
  if (event.kind === "pickup" && event.playerId === me.id)
    return { kind: "pickup", strength: 1 };
  if (event.kind === "wanted" && event.playerId === me.id && event.level > 0)
    return { kind: "wanted", strength: 1 };
  return null;
}

/**
 * The pulses one tick earns this player.
 *
 * A bullet hit is read from health, not from the `hit` event: that event names the target's
 * kind, not who was hit, and health is what a hit actually changes.
 *
 * @param events - This tick's events.
 * @param me - This client's player, after the tick.
 * @param previousHealth - Their health before it, or null on the first tick.
 * @returns The pulses, in event order; the device side ranks them.
 */
export function hapticPulses(
  events: ArenaEvent[],
  me: ArenaPlayerState,
  previousHealth: number | null,
): HapticPulse[] {
  const pulses: HapticPulse[] = [];
  if (tookDamage(previousHealth, me.health))
    pulses.push({ kind: "hit", strength: 1 });
  for (const event of events) {
    const pulse = pulseFor(event, me);
    if (pulse) pulses.push(pulse);
  }
  return pulses;
}

/**
 * Creates the device side of haptics.
 *
 * @param device - Whatever has `vibrate`; `navigator` in the browser.
 * @param enabled - Read on every pulse, so the Trillen setting applies at once.
 * @param now - The clock the gap is measured on; injectable so tests need no fake timers.
 * @returns The haptics.
 */
export function createHaptics(
  device: VibratorLike,
  enabled: () => boolean,
  now: () => number = () => Date.now(),
): Haptics {
  let lastAt = Number.NEGATIVE_INFINITY;
  let lastPriority = Number.NEGATIVE_INFINITY;
  return {
    fire(kind: HapticKind, strength = 1): void {
      if (!enabled() || typeof device.vibrate !== "function") return;
      const { priority, pattern } = PATTERNS[kind];
      const at = now();
      if (at - lastAt < HAPTIC_MIN_GAP_MS && priority <= lastPriority) return;
      lastAt = at;
      lastPriority = priority;
      try {
        device.vibrate(pattern(unit(strength)));
      } catch (error: unknown) {
        Sentry.captureException(error, {
          tags: { area: "arena", kind: "haptics" },
        });
      }
    },
  };
}
