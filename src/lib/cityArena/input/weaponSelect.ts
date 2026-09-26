/**
 * Picking a weapon directly (spec §7: the number keys 1–6 and the mouse wheel) on top of an input
 * model that only knows "next weapon".
 *
 * The simulation switches weapons on the rising edge of `weaponNext`, and the wire carries that
 * one bit, so a direct pick is made here on the client: press and release `weaponNext` a tick at
 * a time until the player is holding what was asked for. A weapon with no ammo is skipped by the
 * simulation, so a pick for one gives up as soon as the cycle comes back round to the weapon held
 * when it started: the player ends where they began, not wherever a fixed press count stops.
 */

import type { WeaponKind, WorldInput } from "../sim/types";
import { WEAPON_ORDER } from "../sim/weapons";

/** The number keys, and what they reach for. */
export type WeaponSlot = 1 | 2 | 3 | 4 | 5 | 6;

/** Which weapon each slot picks; fists are what you have when the rest is empty, not a pick. */
export const SLOT_WEAPONS: Record<WeaponSlot, WeaponKind> = {
  1: "pistol",
  2: "uzi",
  3: "shotgun",
  4: "rifle",
  5: "bat",
  6: "rocket",
};

/**
 * Backstop on the presses one pick may take, two laps of the rack: it only ends a pick whose held
 * weapon never comes back round, e.g. a player who cannot switch at all.
 */
const MAX_PRESSES = WEAPON_ORDER.length * 2;

/** Turns picks and wheel notches into the `weaponNext` edges the simulation understands. */
export type WeaponSelector = {
  /** Asks for a weapon; a request for the one already held is nothing. */
  request(weapon: WeaponKind): void;
  /** Asks for the next weapon, once, as the wheel or the Wapen button would. */
  cycle(): void;
  /**
   * The input to step with this tick: `input` itself while nothing is pending, otherwise `input`
   * with `weaponNext` pressed on one tick and released on the next.
   *
   * @param input - The live input.
   * @param held - The weapon the player holds right now.
   */
  apply(input: WorldInput, held: WeaponKind): WorldInput;
};

/**
 * Creates a selector.
 *
 * @returns The selector, idle.
 */
export function createWeaponSelector(): WeaponSelector {
  let target: WeaponKind | null = null;
  /** The weapon held when the pending pick started, captured on its first tick. */
  let origin: WeaponKind | null = null;
  /** Whether the cycle has moved off `origin` since the pick started. */
  let left = false;
  let presses = 0;
  let pressing = false;

  /** True once the pick is over: the target is in hand, or the cycle is back where it began. */
  function pickDone(held: WeaponKind): boolean {
    if (target === null) return false;
    origin ??= held;
    if (held !== origin) left = true;
    return held === target || (left && held === origin);
  }

  return {
    request(weapon: WeaponKind): void {
      if (target === weapon) return;
      target = weapon;
      origin = null;
      left = false;
      presses = MAX_PRESSES;
    },
    cycle(): void {
      // Notches add up, but a notch on top of a pending pick replaces it: the wheel is the
      // later instruction, and eight leftover presses would spin the rack past everything.
      presses = target === null ? presses + 1 : 1;
      target = null;
    },
    apply(input: WorldInput, held: WeaponKind): WorldInput {
      if (pickDone(held)) {
        target = null;
        presses = 0;
        pressing = false;
      }
      if (presses <= 0 && !pressing) return input;
      if (!pressing) {
        pressing = true;
        return { ...input, weaponNext: true };
      }
      pressing = false;
      presses -= 1;
      return { ...input, weaponNext: false };
    },
  };
}
