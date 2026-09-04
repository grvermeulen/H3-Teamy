import type { AmmoState, WeaponKind } from "./types";

/** Ticks per second of the fixed step (mirrors `SIM_STEP_S`). */
const TICKS_PER_SECOND = 30;
/** Degrees to radians. */
const DEGREES_TO_RADIANS = Math.PI / 180;

/** Static weapon parameters; `spreadRad` is the half-angle, `magazine: null` is unlimited. */
export type WeaponSpec = {
  label: string;
  damage: number;
  shotsPerSecond: number;
  rangeM: number;
  speedMps: number;
  spreadRad: number;
  pellets: number;
  magazine: number | null;
};

/** Weapon table (spec §5) with Dutch labels; the fist is this plan's documented addition. */
export const WEAPONS: Record<WeaponKind, WeaponSpec> = {
  fist: {
    label: "Vuist",
    damage: 15,
    shotsPerSecond: 2,
    rangeM: 1.2,
    speedMps: 30,
    spreadRad: 0,
    pellets: 1,
    magazine: null,
  },
  pistol: {
    label: "Pistool",
    damage: 20,
    shotsPerSecond: 2.5,
    rangeM: 40,
    speedMps: 120,
    spreadRad: 0,
    pellets: 1,
    magazine: null,
  },
  uzi: {
    label: "Uzi",
    damage: 10,
    shotsPerSecond: 10,
    rangeM: 35,
    speedMps: 110,
    spreadRad: 4 * DEGREES_TO_RADIANS,
    pellets: 1,
    magazine: 60,
  },
  shotgun: {
    label: "Shotgun",
    damage: 12,
    shotsPerSecond: 1.2,
    rangeM: 15,
    speedMps: 90,
    spreadRad: 10 * DEGREES_TO_RADIANS,
    pellets: 5,
    magazine: 8,
  },
};

/** Cycling order of the Wapen button. */
export const WEAPON_ORDER: WeaponKind[] = ["fist", "pistol", "uzi", "shotgun"];

/** Ammo the player spawns with in this plan (scope decision 2). */
export const SPAWN_AMMO: AmmoState = { uzi: 60, shotgun: 8 };

/** Ticks between two shots: fist 15, pistol 12, Uzi 3, shotgun 25. */
export function cooldownTicks(kind: WeaponKind): number {
  return Math.round(TICKS_PER_SECOND / WEAPONS[kind].shotsPerSecond);
}

/** Rounds left for a weapon, or `null` when it is unlimited. */
export function ammoFor(ammo: AmmoState, kind: WeaponKind): number | null {
  if (kind === "uzi") return ammo.uzi;
  if (kind === "shotgun") return ammo.shotgun;
  return null;
}

/** True when the weapon can fire (unlimited, or rounds left). */
export function hasAmmo(ammo: AmmoState, kind: WeaponKind): boolean {
  const left = ammoFor(ammo, kind);
  return left === null || left > 0;
}

/** Ammo after one shot; unlimited weapons return the same object. */
export function consumeAmmo(ammo: AmmoState, kind: WeaponKind): AmmoState {
  if (kind === "uzi") return { ...ammo, uzi: Math.max(0, ammo.uzi - 1) };
  if (kind === "shotgun")
    return { ...ammo, shotgun: Math.max(0, ammo.shotgun - 1) };
  return ammo;
}

/** The next weapon in {@link WEAPON_ORDER} that still has ammo, wrapping around. */
export function nextWeapon(current: WeaponKind, ammo: AmmoState): WeaponKind {
  const start = WEAPON_ORDER.indexOf(current);
  for (let offset = 1; offset <= WEAPON_ORDER.length; offset++) {
    const candidate = WEAPON_ORDER[(start + offset) % WEAPON_ORDER.length];
    if (hasAmmo(ammo, candidate)) return candidate;
  }
  return current;
}

/** Dutch HUD label of a weapon. */
export function weaponLabel(kind: WeaponKind): string {
  return WEAPONS[kind].label;
}
