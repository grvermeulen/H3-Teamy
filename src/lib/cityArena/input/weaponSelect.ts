/**
 * Picking a weapon directly (spec §7: 1/2/3 and the mouse wheel) on top of an input model that
 * only knows "next weapon".
 *
 * The simulation switches weapons on the rising edge of `weaponNext`, and the wire carries that
 * one bit, so a direct pick is made here on the client: press and release `weaponNext` a tick at
 * a time until the player is holding what was asked for, and give up after a full lap so a
 * weapon with no ammo — which the simulation skips — cannot leave the player cycling forever.
 */

import type { WeaponKind, WorldInput } from "../sim/types";

/** The number keys, and what they reach for. */
export type WeaponSlot = 1 | 2 | 3 | 4 | 5;

/** Which weapon each slot picks; fists are what you have when the rest is empty, not a pick. */
export const SLOT_WEAPONS: Record<WeaponSlot, WeaponKind> = {
  1: "pistol",
  2: "uzi",
  3: "shotgun",
  4: "rifle",
  5: "bat",
};

/** Presses a request may take before it is given up on: two laps of the six-weapon rack. */
const MAX_PRESSES = 12;

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
  let presses = 0;
  let pressing = false;

  return {
    request(weapon: WeaponKind): void {
      if (target === weapon) return;
      target = weapon;
      presses = MAX_PRESSES;
    },
    cycle(): void {
      // Notches add up, but a notch on top of a pending pick replaces it: the wheel is the
      // later instruction, and eight leftover presses would spin the rack past everything.
      presses = target === null ? presses + 1 : 1;
      target = null;
    },
    apply(input: WorldInput, held: WeaponKind): WorldInput {
      if (target !== null && held === target) {
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
