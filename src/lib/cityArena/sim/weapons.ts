import type { Blast } from "./blast";
import type {
  AmmoState,
  MagazineWeapon,
  WeaponKind,
  WorldInput,
} from "./types";

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
  // Plan 9's two: a bat that hits like a fist and a half and wears out, and a rifle that reaches
  // twice as far as anything else, slowly.
  bat: {
    label: "Knuppel",
    damage: 30,
    shotsPerSecond: 1.5,
    rangeM: 1.6,
    speedMps: 30,
    spreadRad: 0,
    pellets: 1,
    magazine: 20,
  },
  rifle: {
    label: "Geweer",
    damage: 45,
    shotsPerSecond: 0.8,
    rangeM: 70,
    speedMps: 160,
    spreadRad: 0,
    pellets: 1,
    magazine: 10,
  },
  // The tank's gun: one shell wrecks any car but a bus, every two seconds, and it never runs dry.
  // It is not in WEAPON_ORDER — nobody carries it; the tank fires it (sim/combat.ts).
  cannon: {
    label: "Kanon",
    damage: 150,
    shotsPerSecond: 0.5,
    rangeM: 80,
    speedMps: 90,
    spreadRad: 0,
    pellets: 1,
    magazine: null,
  },
  // What a player on foot brings to a building (spec §4): a slow rocket you can see coming and
  // dodge, four to a pickup; its blast (EXPLOSIVES) is what does the damage.
  rocket: {
    label: "Raketwerper",
    damage: 60,
    shotsPerSecond: 0.6,
    rangeM: 90,
    speedMps: 45,
    spreadRad: 0,
    pellets: 1,
    magazine: 4,
  },
};

/**
 * Blast for the weapons that detonate on impact (spec §3.3, §4) rather than just dealing direct
 * damage: the tank's shell and the rocket, which hits buildings harder.
 */
export const EXPLOSIVES: Partial<
  Record<WeaponKind, Omit<Blast, "x" | "y" | "ownerId">>
> = {
  cannon: {
    entityRadius: 4,
    entityDamage: 70,
    vehicleDamage: 90,
    structureRadius: 5,
    structureDamage: 320,
    entityFalloff: true,
  },
  rocket: {
    entityRadius: 4,
    entityDamage: 70,
    vehicleDamage: 90,
    structureRadius: 5,
    structureDamage: 420,
    entityFalloff: true,
  },
};

/**
 * True for a weapon that detonates on impact rather than just dealing direct damage.
 *
 * @param kind - The weapon.
 * @returns Whether `kind` has a blast in {@link EXPLOSIVES}.
 */
export function isExplosive(kind: WeaponKind): boolean {
  return kind in EXPLOSIVES;
}

/** Cycling order of the Wapen button: the melee pair, the guns by reach, then the rocket launcher. */
export const WEAPON_ORDER: WeaponKind[] = [
  "fist",
  "bat",
  "pistol",
  "uzi",
  "shotgun",
  "rifle",
  "rocket",
];

/** The weapons that hit what they touch rather than fire a round; they get no muzzle flash. */
const MELEE_WEAPONS: ReadonlySet<WeaponKind> = new Set(["fist", "bat"]);

/** Share of a spraying gun's cone left while aiming down the sights. */
export const ADS_SPREAD_FACTOR = 0.5;

/**
 * A weapon's spec as it fires: aiming down the sights narrows its cone by
 * {@link ADS_SPREAD_FACTOR}; otherwise the spec itself.
 *
 * @param spec - The weapon's spec.
 * @param ads - Whether the shooter aims down the sights.
 * @returns The spec to fire with.
 */
export function aimedSpec(spec: WeaponSpec, ads: boolean): WeaponSpec {
  if (!ads || spec.spreadRad === 0) return spec;
  return { ...spec, spreadRad: spec.spreadRad * ADS_SPREAD_FACTOR };
}

/**
 * True for a weapon swung rather than fired.
 *
 * @param kind - The weapon.
 * @returns Whether it is melee.
 */
export function isMelee(kind: WeaponKind): boolean {
  return MELEE_WEAPONS.has(kind);
}

/**
 * The input a walker holding `weapon` moves on: fists and the bat have no sights, so a held sights
 * button must not slow them (aim spec §3); with a gun the input is kept as it is.
 *
 * @param input - The tick's input.
 * @param weapon - The walker's weapon.
 * @returns `input`, or a copy with `ads` off for a melee weapon.
 */
export function walkingInput(
  input: WorldInput,
  weapon: WeaponKind,
): WorldInput {
  if (!input.ads || !isMelee(weapon)) return input;
  return { ...input, ads: false };
}

/** The weapons that carry rounds; the others never run out. */
export const MAGAZINE_WEAPONS: readonly MagazineWeapon[] = [
  "uzi",
  "shotgun",
  "rifle",
  "bat",
  "rocket",
];

/**
 * True for a weapon that carries rounds.
 *
 * @param kind - The weapon.
 * @returns Whether `kind` indexes the ammo state.
 */
export function isMagazineWeapon(kind: WeaponKind): kind is MagazineWeapon {
  return (MAGAZINE_WEAPONS as readonly WeaponKind[]).includes(kind);
}

/** Ammo the player spawns with: pistol and fist only. */
export const SPAWN_AMMO: AmmoState = {
  uzi: 0,
  shotgun: 0,
  rifle: 0,
  bat: 0,
  rocket: 0,
};

/** Maximum carried rounds for each magazine weapon. */
export const MAX_AMMO: AmmoState = {
  uzi: 120,
  shotgun: 16,
  rifle: 30,
  bat: 40,
  rocket: 12,
};

/** Adds magazine ammunition without exceeding the carried-round cap. */
export function addAmmo(
  ammo: AmmoState,
  kind: WeaponKind,
  rounds: number,
): AmmoState {
  if (!isMagazineWeapon(kind)) return ammo;
  return { ...ammo, [kind]: Math.min(MAX_AMMO[kind], ammo[kind] + rounds) };
}

/** Ticks between two shots: fist 15, pistol 12, Uzi 3, shotgun 25, bat 20, rifle 38, cannon 60, rocket 50. */
export function cooldownTicks(kind: WeaponKind): number {
  return Math.round(TICKS_PER_SECOND / WEAPONS[kind].shotsPerSecond);
}

/** Rounds left for a weapon, or `null` when it is unlimited. */
export function ammoFor(ammo: AmmoState, kind: WeaponKind): number | null {
  return isMagazineWeapon(kind) ? ammo[kind] : null;
}

/** True when the weapon can fire (unlimited, or rounds left). */
export function hasAmmo(ammo: AmmoState, kind: WeaponKind): boolean {
  const left = ammoFor(ammo, kind);
  return left === null || left > 0;
}

/** Ammo after one shot; unlimited weapons return the same object. */
export function consumeAmmo(ammo: AmmoState, kind: WeaponKind): AmmoState {
  if (!isMagazineWeapon(kind)) return ammo;
  return { ...ammo, [kind]: Math.max(0, ammo[kind] - 1) };
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
