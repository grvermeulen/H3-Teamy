import type { ZoneKey } from "../world/mapTypes";

/**
 * Device-agnostic input (spec §7): a movement vector with length ≤ 1 (x east, y south), an
 * aim angle in radians or `null` to fire along the facing, and three held buttons.
 */
export type WorldInput = {
  move: [number, number];
  aim: number | null;
  fire: boolean;
  enter: boolean;
  weaponNext: boolean;
};

/** An input with nothing pressed. */
export const EMPTY_INPUT: WorldInput = {
  move: [0, 0],
  aim: null,
  fire: false,
  enter: false,
  weaponNext: false,
};

/** Builds a full input from the fields a test or a debug dispatch cares about. */
export function createInput(partial: Partial<WorldInput>): WorldInput {
  return {
    move: partial.move ?? [0, 0],
    aim: partial.aim ?? null,
    fire: partial.fire ?? false,
    enter: partial.enter ?? false,
    weaponNext: partial.weaponNext ?? false,
  };
}

/** The local player on foot; `facing` in radians, `speed` in m/s. */
export type PlayerState = {
  x: number;
  y: number;
  facing: number;
  speed: number;
};

/** Single-player free-roam session state (Plan 2; kept for the walking tests). */
export type FreeRoamState = {
  tick: number;
  player: PlayerState;
  zoneKey: ZoneKey | null;
};

/** Weapons in Wapen-button cycling order (spec §5 plus the fist). */
export type WeaponKind = "fist" | "pistol" | "uzi" | "shotgun";

/** Car kinds (spec §5). */
export type VehicleKind = "compact" | "sedan" | "sport" | "police";

/** A car; `heading` in radians, velocity in world m/s, `colour` indexes the render palette. */
export type VehicleState = {
  id: number;
  kind: VehicleKind;
  x: number;
  y: number;
  heading: number;
  velocityX: number;
  velocityY: number;
  health: number;
  wrecked: boolean;
  colour: number;
};

/** A projectile (or fist reach) travelling along a unit direction until its range runs out. */
export type BulletState = {
  id: number;
  ownerId: number;
  ignoreVehicleId: number | null;
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  speedMps: number;
  rangeLeftM: number;
  damage: number;
  weapon: WeaponKind;
};

/** Kinds of short-lived visual effects. */
export type EffectKind = "muzzle" | "impact" | "explosion";

/** A render-only effect; it expires once `tick - bornTick >= ttlTicks`. */
export type EffectState = {
  id: number;
  kind: EffectKind;
  x: number;
  y: number;
  angle: number;
  bornTick: number;
  ttlTicks: number;
};

/** Rounds left for the magazine weapons; pistol and fist are unlimited. */
export type AmmoState = { uzi: number; shotgun: number };

/** The player with everything the arena adds to walking. */
export type ArenaPlayerState = PlayerState & {
  id: number;
  health: number;
  weapon: WeaponKind;
  ammo: AmmoState;
  vehicleId: number | null;
  boardingTicksLeft: number;
  nextShotTick: number;
  diedAtTick: number | null;
  invulnerableUntilTick: number;
};

/** Buttons whose previous held state the simulation remembers for edge detection. */
export type HeldButtons = { enter: boolean; weaponNext: boolean };

/** Full arena simulation state: plain, JSON-serialisable data. */
export type ArenaState = {
  tick: number;
  seed: number;
  nextId: number;
  player: ArenaPlayerState;
  vehicles: VehicleState[];
  bullets: BulletState[];
  effects: EffectState[];
  held: HeldButtons;
  zoneKey: ZoneKey | null;
};
