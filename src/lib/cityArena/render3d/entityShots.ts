/**
 * Who fired this frame, for the recoil of the 3D characters and the first-person view model. The
 * simulation spawns a `muzzle` effect where a gun goes off, at the shooter's position; a fresh one
 * within {@link MUZZLE_MATCH_M} of a character's gun means that character fired. Pure and
 * allocation-free.
 */
import type { EffectState } from "../sim/types";

/** A fresh muzzle flash this close to a character's gun means it fired, metres. */
export const MUZZLE_MATCH_M = 1.2;
/**
 * A flash counts as fresh this many ticks after it was born: the renderer can skip a 30 Hz tick
 * when a frame runs long, and one late frame should not lose the shot.
 */
export const MUZZLE_FRESH_TICKS = 1;
/** A body's kick (or a swing's follow-through) has eased back to rest after this long, seconds. */
export const RECOIL_RECOVERY_S = 0.25;

/**
 * Collects the frame's fresh muzzle flashes into `out`, emptied first so one list serves every
 * frame.
 *
 * @param effects - The scene's effects.
 * @param tick - The scene's tick.
 * @param out - The reused list to fill.
 * @returns `out`, holding the muzzle flashes born within {@link MUZZLE_FRESH_TICKS} of `tick`.
 */
export function collectFreshMuzzles(
  effects: readonly EffectState[],
  tick: number,
  out: EffectState[],
): EffectState[] {
  out.length = 0;
  for (const effect of effects) {
    const age = tick - effect.bornTick;
    if (effect.kind === "muzzle" && age >= 0 && age <= MUZZLE_FRESH_TICKS)
      out.push(effect);
  }
  return out;
}

/**
 * The newest muzzle flash of a gun at `(x, y)`: the flashes within {@link MUZZLE_MATCH_M}.
 *
 * @param muzzles - The frame's fresh muzzle flashes.
 * @param x - The shooter, metres east (the simulation fires from the body's position, or from
 *   a driver's seat).
 * @param y - Metres south.
 * @returns The newest matching flash — its `angle` is the shot's aim — or `null` when none is near.
 */
export function newestMuzzleNear(
  muzzles: readonly EffectState[],
  x: number,
  y: number,
): EffectState | null {
  let newest: EffectState | null = null;
  const reach = MUZZLE_MATCH_M * MUZZLE_MATCH_M;
  for (const muzzle of muzzles) {
    const dx = muzzle.x - x;
    const dy = muzzle.y - y;
    if (dx * dx + dy * dy > reach) continue;
    if (newest === null || muzzle.bornTick > newest.bornTick) newest = muzzle;
  }
  return newest;
}

/**
 * The tick of the newest shot fired from a gun at `(x, y)`, judged by the muzzle flashes within
 * {@link MUZZLE_MATCH_M}.
 *
 * @param muzzles - The frame's fresh muzzle flashes.
 * @param x - The character's gun, metres east (the simulation fires from the body's position).
 * @param y - Metres south.
 * @returns The newest matching flash's birth tick, or `null` when none is near.
 */
export function muzzleTickNear(
  muzzles: readonly EffectState[],
  x: number,
  y: number,
): number | null {
  return newestMuzzleNear(muzzles, x, y)?.bornTick ?? null;
}

/** A body that may have fired a muzzle flash: a player's or an officer's. */
export type ShooterBody = { readonly x: number; readonly y: number };

/** True when no body but `shooter` stands nearer the flash: the simulation lights it at its shooter. */
function litBy(
  muzzle: EffectState,
  shooter: ShooterBody,
  bodies: readonly ShooterBody[],
): boolean {
  const own = (muzzle.x - shooter.x) ** 2 + (muzzle.y - shooter.y) ** 2;
  for (const body of bodies) {
    if (body === shooter) continue;
    if ((muzzle.x - body.x) ** 2 + (muzzle.y - body.y) ** 2 < own) return false;
  }
  return true;
}

/**
 * The newest muzzle flash `shooter` fired: within {@link MUZZLE_MATCH_M} of them and nearer to them
 * than to any other body — an officer firing beside a car never counts as its driver's shot.
 *
 * @param muzzles - The frame's fresh muzzle flashes.
 * @param shooter - The shooter, one of `bodies` (compared by reference).
 * @param bodies - Everyone who can fire this frame.
 * @returns The newest such flash, or `null`.
 */
export function newestOwnMuzzle(
  muzzles: readonly EffectState[],
  shooter: ShooterBody,
  bodies: readonly ShooterBody[],
): EffectState | null {
  let newest: EffectState | null = null;
  const reach = MUZZLE_MATCH_M * MUZZLE_MATCH_M;
  for (const muzzle of muzzles) {
    const dx = muzzle.x - shooter.x;
    const dy = muzzle.y - shooter.y;
    if (dx * dx + dy * dy > reach || !litBy(muzzle, shooter, bodies)) continue;
    if (newest === null || muzzle.bornTick > newest.bornTick) newest = muzzle;
  }
  return newest;
}

/** A character's shooting memory. */
export type ShotMemory = {
  /** Tick of the latest shot or swing, or `null` before the first. */
  firedTick: number | null;
  /** 0…1: 1 as a shot fires, easing back to 0. */
  recoil: number;
};

/**
 * A fresh shooting memory: never fired, at rest.
 *
 * @returns A memory to pass to {@link registerShot} every frame.
 */
export function createShotMemory(): ShotMemory {
  return { firedTick: null, recoil: 0 };
}

/**
 * Advances a character's recoil by one frame: a shot newer than the last one kicks it to 1, and
 * otherwise it eases back to rest over {@link RECOIL_RECOVERY_S}. A shot is kicked once however
 * many frames still see its flash.
 *
 * @param memory - The character's memory, updated in place.
 * @param firedTick - The tick of a shot seen this frame, or `null`.
 * @param dt - Seconds since the previous frame.
 */
export function registerShot(
  memory: ShotMemory,
  firedTick: number | null,
  dt: number,
): void {
  if (
    firedTick !== null &&
    (memory.firedTick === null || firedTick > memory.firedTick)
  ) {
    memory.firedTick = firedTick;
    memory.recoil = 1;
    return;
  }
  memory.recoil = Math.max(0, memory.recoil - dt / RECOIL_RECOVERY_S);
}
