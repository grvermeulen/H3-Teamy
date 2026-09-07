import type { ZoneKey } from "../world/mapTypes";

/**
 * Device-agnostic input (spec §7): a movement vector with length ≤ 1 (x east, y south), an
 * aim angle in radians or `null` to fire along the facing, and three held buttons.
 * `moveIsAnalog` is the device kind, not a control: it selects the heading-seeking car steering
 * in `driveInput.ts` whenever a touch stick was the last source to move the player — including
 * the tick a released stick reports a zero vector, so the steer command ramps back to centre
 * instead of snapping. Keyboard and replayed/debug inputs leave it false and keep the original
 * tank steering.
 */
export type WorldInput = {
  move: [number, number];
  moveIsAnalog: boolean;
  aim: number | null;
  fire: boolean;
  enter: boolean;
  weaponNext: boolean;
};

/** An input with nothing pressed. */
export const EMPTY_INPUT: WorldInput = {
  move: [0, 0],
  moveIsAnalog: false,
  aim: null,
  fire: false,
  enter: false,
  weaponNext: false,
};

/**
 * One input per player id for a single tick. A player with no entry is stepped with
 * {@link EMPTY_INPUT}: offline that never happens, but a hosted match drops late packets and a
 * silent client must not freeze the tick.
 */
export type ArenaInputs = ReadonlyMap<number, WorldInput>;

/** Builds a full input from the fields a test or a debug dispatch cares about. */
export function createInput(partial: Partial<WorldInput>): WorldInput {
  return {
    move: partial.move ?? [0, 0],
    moveIsAnalog: partial.moveIsAnalog ?? false,
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
  heat: number;
  heatTick: number;
  outsideSinceTick: number | null;
  /** Rate-limited steering command (−1..1) of the car being driven; 0 while on foot. */
  driveSteer: number;
  /**
   * Edge-triggered buttons this player held last tick. It lives on the player rather than on
   * the world so one player holding Enter cannot swallow another player's press.
   */
  held: HeldButtons;
};

/** Buttons whose previous held state the simulation remembers for edge detection. */
export type HeldButtons = { enter: boolean; weaponNext: boolean };

/** Kinds of pickups: magazine ammunition or health. */
export type PickupKind = "uzi" | "shotgun" | "health";

/** A pickup spot; taken pickups wait for their respawn timer. */
export type PickupState = {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  takenAtTick: number | null;
};

/** A pavement rail position used by pedestrian path following. */
export type RailPosition = {
  edge: number;
  direction: 1 | -1;
  edgeT: number;
  side: 1 | -1;
};

/** Current pedestrian behaviour. */
export type PedMode = "walk" | "flee" | "dead";

/** A pedestrian walking, fleeing or waiting as a body. */
export type PedState = {
  id: number;
  x: number;
  y: number;
  facing: number;
  health: number;
  mode: PedMode;
  modeUntilTick: number;
  rail: RailPosition | null;
  fleeX: number;
  fleeY: number;
};

/** Weapons available to police officers. */
export type CopWeapon = "pistol" | "shotgun";

/** A police officer pursuing the wanted player. */
export type CopState = {
  id: number;
  x: number;
  y: number;
  facing: number;
  health: number;
  weapon: CopWeapon;
  path: number[];
  repathTick: number;
  nextShotTick: number;
  diedAtTick: number | null;
};

/** The role of an AI car driver. */
export type DriverRole = "traffic" | "police";

/** AI driver state bound to one vehicle. */
export type DriverState = {
  vehicleId: number;
  role: DriverRole;
  cruiseMps: number;
  fromNode: number | null;
  path: number[];
  repathTick: number;
};

/** Entity kinds that can be hit by a projectile. */
export type HitTargetKind = "player" | "ped" | "cop" | "vehicle";

/** A serialisable simulation event consumed by audio and future netcode. */
export type ArenaEvent =
  | { kind: "shot"; weapon: WeaponKind; ownerId: number; x: number; y: number }
  | { kind: "hit"; target: HitTargetKind; x: number; y: number }
  | {
      kind: "impact";
      vehicleId: number;
      otherVehicleId: number | null;
      impactSpeed: number;
    }
  | { kind: "explosion"; x: number; y: number }
  | {
      kind: "pickup";
      pickupKind: PickupKind;
      playerId: number;
      x: number;
      y: number;
    }
  | {
      kind: "kill";
      victim: "ped" | "cop";
      killerId: number | null;
      x: number;
      y: number;
    }
  | { kind: "wanted"; playerId: number; level: number }
  | { kind: "zone"; playerId: number; phase: "warning" | "damage" };

/** Full arena simulation state: plain, JSON-serialisable data. */
export type ArenaState = {
  tick: number;
  seed: number;
  nextId: number;
  /** Every player the simulation steps, in join order; offline play has exactly one. */
  players: ArenaPlayerState[];
  vehicles: VehicleState[];
  bullets: BulletState[];
  effects: EffectState[];
  zoneKey: ZoneKey | null;
  peds: PedState[];
  cops: CopState[];
  pickups: PickupState[];
  traffic: DriverState[];
  events: ArenaEvent[];
  activeZoneKey: ZoneKey | null;
  /** Zone selected when the out-of-zone rule was enabled; population may move independently. */
  enforcedZoneKey?: ZoneKey | null;
  zoneEnforced: boolean;
};
