/**
 * The 3D cast, synced every frame from the blended scene (spec §6.6–6.7): players, pedestrians
 * and officers as posed characters, cars as live vehicles, pickups floating over their spots.
 * Objects are pooled by entity (`player:<id>`, `ped:<id>`, `cop:<id>`, `car:<id>`,
 * `pickup:<id>` — one pool per kind, keyed by id); an entity not seen for a frame hands its object
 * back to a free list of its look or kind for the next one. In the steady state a frame allocates
 * nothing: every input goes through one reused scratch object.
 */
import { Group, Vector3, type Object3D } from "three";
import { playerLook } from "../render/drawEntities";
import type { Scene } from "../render/renderScene";
import type {
  ArenaPlayerState,
  CopState,
  EffectState,
  PedState,
  PickupKind,
  PickupState,
  VehicleKind,
  VehicleState,
  WeaponKind,
} from "../sim/types";
import { firesCannon, forwardSpeed, lengthOf } from "../sim/vehicle";
import { isMelee } from "../sim/weapons";
import { pedLookOf, type CharacterLook } from "./characterLooks";
import type { PoseInput } from "./characterPose";
import type { Character3d } from "./characters";
import { headingToRotationY, setWorldPosition } from "./coords";
import {
  createMotion,
  createSteerMemory,
  trackMotion,
  trackSteer,
  vestHueOf,
  type Motion,
  type SteerMemory,
  type SteerSample,
} from "./entityMotion";
import { createEntityPool, type EntityPool, type PoolSlot } from "./entityPool";
import {
  collectFreshMuzzles,
  createShotMemory,
  muzzleTickNear,
  registerShot,
  type ShotMemory,
} from "./entityShots";
import { createMuzzleMap, type MuzzleMap } from "./muzzleMap";
import type { Pickup3d } from "./pickups3d";
import type { Vehicle3d, Vehicle3dInput } from "./vehicles3d";

/** Characters farther than this from the camera focus are not drawn, metres. */
export const CHARACTER_DRAW_DISTANCE_M = 180;
/** Vehicles farther than this from the camera focus are not drawn, metres. */
export const VEHICLE_DRAW_DISTANCE_M = 320;
/** Pickups are as small as people, so they share the characters' draw distance, metres. */
export const PICKUP_DRAW_DISTANCE_M = CHARACTER_DRAW_DISTANCE_M;
/** Released objects kept per look or kind for reuse; more are disposed. */
export const FREE_LIST_CAP = 32;
/** Height of the tank's barrel: the turret ring (1.38 m) plus the barrel's axis above it. */
export const TANK_BARREL_HEIGHT_M = 1.73;
/** An officer raises the gun while a living player is this close, metres. */
export const COP_AIM_RANGE_M = 30;
/** Characters beyond this animate at a reduced rate (clip-playing ones), metres. */
export const FULL_RATE_ANIMATION_M = 40;
/** A detailed character turns simple only this much beyond the detail range, so none flickers. */
const DETAIL_HYSTERESIS = 1.1;

/**
 * Who a character is built for: the entity's id (a pedestrian's looks are drawn from it) and
 * whether it is far enough to be drawn simply. Borrowed for the call; do not keep it.
 */
export type CharacterWho = { id: number; simple: boolean };

/**
 * Builds the models; the real ones are the character factory, `createVehicle3d` and
 * `createPickup3d`. The character hooks are optional: without them a character's pool variant is
 * its look (a one-off for a vest hue) and a reused character needs no re-dressing.
 */
export type EntityFactories = {
  character(
    look: CharacterLook,
    vestHue?: number,
    who?: CharacterWho,
  ): Character3d;
  /**
   * The pool variant a character built now would be (say, a glTF model once they have loaded);
   * a kept character of another variant is rebuilt. Called every frame: must not allocate.
   */
  characterVariant?(
    look: CharacterLook,
    vestHue: number | undefined,
    who: CharacterWho,
  ): string | null;
  /** Re-dresses a pooled character for its new owner. */
  dressCharacter?(
    character: Character3d,
    look: CharacterLook,
    vestHue: number | undefined,
    who: CharacterWho,
  ): void;
  vehicle(kind: VehicleKind, colour: number): Vehicle3d;
  /**
   * The pool variant a vehicle built now would be (say, a Kit model once they have loaded); a kept
   * vehicle of another variant is rebuilt. Called every frame: must not allocate.
   */
  vehicleVariant?(kind: VehicleKind, colour: number): string;
  pickup(kind: PickupKind): Pickup3d;
};

/** How the camera sees this frame. */
export type EntityView = {
  /** First person: the local player's own body is hidden while alive (the view model shows). */
  firstPerson: boolean;
  /** The local player's aim, radians — a tank they drive turns its turret to it. */
  aim: number;
  /** Characters beyond this distance are drawn simply (the "laag" quality); unset: all detailed. */
  characterDetailM?: number;
};

/** The car the local player drives, as the first-person cockpit needs it. */
export type LocalVehicle = {
  id: number;
  kind: VehicleKind;
  colour: number;
  /** The steering its front wheels show, −1…1, positive to the right. */
  steer: number;
  /** Speed along the heading, m/s; negative in reverse. */
  speedMps: number;
  heading: number;
  /** World metres. */
  x: number;
  y: number;
  siren: boolean;
  wrecked: boolean;
};

/** The local player as the first-person view model needs it, rewritten by every update. */
export type LocalCharacter = {
  /** In the scene, alive and on foot: the only time the hands show. */
  onFoot: boolean;
  weapon: WeaponKind;
  /** Tick of the latest shot or swing, or `null` before the first. */
  firedTick: number | null;
  /** Smoothed ground speed, m/s. */
  speed: number;
  /** The car the player drives while alive, drawn or not; `null` on foot or dead. */
  vehicle: LocalVehicle | null;
};

/** The 3D cast. */
export type EntitySync = {
  /**
   * Places, poses and updates every entity within its draw distance of `cameraFocus`, and frees
   * the objects of those gone or out of range.
   *
   * @param scene - The frame's blended scene.
   * @param dt - Seconds since the previous frame.
   * @param cameraFocus - Where the camera looks from, world metres.
   * @param view - First person or not, and the local aim.
   */
  update(
    scene: Scene,
    dt: number,
    cameraFocus: { x: number; y: number },
    view: EntityView,
  ): void;
  /** Add to the scene once. */
  group: Object3D;
  /**
   * Every shooter's muzzle this frame by owner id — players', officers' and a tank's barrel for
   * its driver — written by `update` after posing; the cast may overwrite your own with the view
   * model's.
   */
  muzzles: MuzzleMap;
  /** The local player for the view model; read after `update`. */
  local: Readonly<LocalCharacter>;
  /** Disposes every model, in use or free; detach `group` yourself. */
  dispose(): void;
};

/** What a character remembers between frames. */
type CharacterState = {
  look: CharacterLook;
  motion: Motion;
  shots: ShotMemory;
  /** A player's next-shot tick last frame; a swing moves it on without a muzzle flash. */
  nextShotTick: number | null;
  /** Built to be drawn simply (beyond the detail range). */
  simple: boolean;
};

/** What a vehicle remembers between frames. */
type VehicleSlotState = {
  kind: VehicleKind;
  colour: number;
  steer: SteerMemory;
};

type CharacterPool = EntityPool<Character3d, CharacterState>;
type CharacterSlot = PoolSlot<Character3d, CharacterState>;

/** One pool per kind of entity. */
type Pools = {
  players: CharacterPool;
  peds: CharacterPool;
  cops: CharacterPool;
  vehicles: EntityPool<Vehicle3d, VehicleSlotState>;
  pickups: EntityPool<Pickup3d, { kind: PickupKind }>;
};

/** One sync's factories, pools and reused scratch, plus the frame being synced. */
type Frame = {
  readonly factories: EntityFactories;
  readonly pools: Pools;
  readonly local: LocalCharacter;
  /** Reused for `local.vehicle` while the local player drives. */
  readonly localVehicle: LocalVehicle;
  readonly muzzles: EffectState[];
  /** Where each shooter's gun points from, this frame. */
  readonly muzzleMap: MuzzleMap;
  /** Receives one character's muzzle before it is recorded. */
  readonly muzzlePoint: Vector3;
  readonly pose: PoseInput;
  readonly vehicleInput: Vehicle3dInput;
  readonly steerSample: SteerSample;
  readonly pickupInput: { taken: boolean; tick: number };
  /** Who the character being synced is for, rewritten per character. */
  readonly who: CharacterWho;
  dt: number;
  /** The scene's tick. */
  tick: number;
  focus: { x: number; y: number };
  view: EntityView;
};

/** True when `(x, y)` lies within `distance` of the focus. */
function within(
  focus: { x: number; y: number },
  x: number,
  y: number,
  distance: number,
): boolean {
  const dx = x - focus.x;
  const dy = y - focus.y;
  return dx * dx + dy * dy <= distance * distance;
}

/** Guns are raised to aim; fists, the bat and the tank's cannon are not. */
function holdsGun(weapon: WeaponKind): boolean {
  return !isMelee(weapon) && weapon !== "cannon";
}

/** True when a living player stands within `range` of `(x, y)`. */
function livingPlayerWithin(
  players: readonly ArenaPlayerState[],
  x: number,
  y: number,
  range: number,
): boolean {
  for (const player of players)
    if (player.diedAtTick === null && within(player, x, y, range)) return true;
  return false;
}

/** The player driving `vehicleId`, if any. */
function driverOf(
  players: readonly ArenaPlayerState[],
  vehicleId: number,
): ArenaPlayerState | undefined {
  for (const player of players)
    if (player.vehicleId === vehicleId) return player;
  return undefined;
}

/** The pool variant of a character for `frame.who`: the factory's, else its look (a vest hue: none). */
function variantOf(
  frame: Frame,
  look: CharacterLook,
  vestHue?: number,
): string | null {
  const { factories } = frame;
  if (factories.characterVariant)
    return factories.characterVariant(look, vestHue, frame.who);
  return vestHue === undefined ? look : null;
}

/**
 * Sets `frame.who` for an entity at `(x, y)`: simple beyond the view's detail range, with a
 * little slack before a detailed character turns simple.
 */
function aimWho(
  frame: Frame,
  id: number,
  kept: CharacterSlot | undefined,
  entity: { x: number; y: number },
): void {
  frame.who.id = id;
  const range = frame.view.characterDetailM;
  if (range === undefined) {
    frame.who.simple = false;
    return;
  }
  const reach =
    kept?.state.simple === false ? range * DETAIL_HYSTERESIS : range;
  frame.who.simple = !within(frame.focus, entity.x, entity.y, reach);
}

/** True when a kept character still fits: the same look and the variant the factory would build. */
function fits(
  frame: Frame,
  kept: CharacterSlot,
  look: CharacterLook,
  vestHue?: number,
): boolean {
  return (
    kept.state.look === look && kept.variant === variantOf(frame, look, vestHue)
  );
}

/**
 * A new character slot for `frame.who`: a freed model of its variant (re-dressed for this owner),
 * or a fresh one. A rebuilt entity keeps its motion and shots. A vest hue belongs to one player
 * only, so without a factory variant a hued model is a one-off, disposed when that player leaves.
 */
function claimCharacter(
  frame: Frame,
  pool: CharacterPool,
  look: CharacterLook,
  vestHue?: number,
  previous?: CharacterState,
): CharacterSlot {
  const { factories, who } = frame;
  const state: CharacterState = {
    look,
    motion: previous?.motion ?? createMotion(),
    shots: previous?.shots ?? createShotMemory(),
    nextShotTick: previous?.nextShotTick ?? null,
    simple: who.simple,
  };
  let built = false;
  const slot = pool.claim(
    who.id,
    variantOf(frame, look, vestHue),
    () => {
      built = true;
      return factories.character(look, vestHue, who);
    },
    state,
  );
  if (!built) factories.dressCharacter?.(slot.item, look, vestHue, who);
  return slot;
}

/** A player's slot, rebuilt when they became or stopped being this client's own player. */
function playerSlot(
  frame: Frame,
  player: ArenaPlayerState,
  local: boolean,
): CharacterSlot {
  const look: CharacterLook = local ? "player" : "otherPlayer";
  const pool = frame.pools.players;
  const kept = pool.keep(player.id);
  const hue = local ? undefined : vestHueOf(player.id);
  aimWho(frame, player.id, kept, player);
  if (kept && fits(frame, kept, look, hue)) return kept;
  return claimCharacter(frame, pool, look, hue, kept?.state);
}

/** Records where a posed character's gun points from, if it holds one. */
function recordMuzzle(frame: Frame, item: Character3d, id: number): void {
  if (item.muzzleWorld(frame.muzzlePoint))
    frame.muzzleMap.set(id, frame.muzzlePoint);
}

/** Moves a character to `(x, y)`, turns it to `facing` and poses it with the scratch pose. */
function placeCharacter(
  frame: Frame,
  slot: CharacterSlot,
  tick: number,
  entity: { x: number; y: number; facing: number },
): void {
  const { pose } = frame;
  pose.speed = slot.state.motion.speed;
  pose.phaseM = slot.state.motion.phaseM;
  pose.recoil = slot.state.shots.recoil;
  pose.tick = tick;
  pose.dt = frame.dt;
  pose.far = !within(frame.focus, entity.x, entity.y, FULL_RATE_ANIMATION_M);
  const { object } = slot.item;
  setWorldPosition(object.position, entity.x, entity.y);
  object.rotation.y = headingToRotationY(entity.facing);
  slot.item.update(pose);
}

/**
 * The tick of a shot the player fired: their next-shot tick moving on (every trigger pull,
 * including a swing, which leaves no muzzle flash), else — for another player — a muzzle flash
 * at their gun. Your own shots are always read from your own next-shot tick, which this client
 * knows first hand: a flash near you may be the officer beside you, and must not kick your hands.
 * The dead fire nothing, and the memory restarts with them, since a respawn resets the tick.
 */
function playerShotTick(
  frame: Frame,
  state: CharacterState,
  player: ArenaPlayerState,
  local: boolean,
  dead: boolean,
): number | null {
  const previous = state.nextShotTick;
  state.nextShotTick = dead ? null : player.nextShotTick;
  if (dead) return null;
  if (previous !== null && player.nextShotTick > previous) return frame.tick;
  return local ? null : muzzleTickNear(frame.muzzles, player.x, player.y);
}

/** Copies the local player's weapon, last shot and speed for the view model. */
function describeLocal(
  local: LocalCharacter,
  player: ArenaPlayerState,
  state: CharacterState,
  dead: boolean,
): void {
  local.onFoot = !dead;
  local.weapon = player.weapon;
  local.firedTick = state.shots.firedTick;
  local.speed = state.motion.speed;
}

/** Syncs one player: hidden in a car, blinking while shielded, your own body hidden in first person. */
function syncPlayer(
  frame: Frame,
  scene: Scene,
  player: ArenaPlayerState,
): void {
  const look = playerLook(player, scene.tick);
  if (look === "hidden") return;
  if (!within(frame.focus, player.x, player.y, CHARACTER_DRAW_DISTANCE_M))
    return;
  const local = player.id === scene.localPlayerId;
  const slot = playerSlot(frame, player, local);
  const { state } = slot;
  const dead = look === "dead";
  trackMotion(
    state.motion,
    player.x,
    player.y,
    frame.dt,
    Math.abs(player.speed),
  );
  const fired = playerShotTick(frame, state, player, local, dead);
  registerShot(state.shots, fired, frame.dt);
  frame.pose.weapon = player.weapon;
  frame.pose.aiming = !dead && holdsGun(player.weapon);
  frame.pose.dead = dead;
  placeCharacter(frame, slot, scene.tick, player);
  if (!dead) recordMuzzle(frame, slot.item, player.id);
  const ownBody = local && frame.view.firstPerson && !dead;
  slot.item.object.visible = look !== "blink" && !ownBody;
  if (local) describeLocal(frame.local, player, state, dead);
}

/** Syncs one pedestrian: never armed, walking or fleeing by its measured speed. */
function syncPed(frame: Frame, scene: Scene, ped: PedState): void {
  if (!within(frame.focus, ped.x, ped.y, CHARACTER_DRAW_DISTANCE_M)) return;
  const { peds } = frame.pools;
  const look = pedLookOf(ped.id);
  const kept = peds.keep(ped.id);
  aimWho(frame, ped.id, kept, ped);
  const slot =
    kept && fits(frame, kept, look)
      ? kept
      : claimCharacter(frame, peds, look, undefined, kept?.state);
  trackMotion(slot.state.motion, ped.x, ped.y, frame.dt, null);
  frame.pose.weapon = null;
  frame.pose.aiming = false;
  frame.pose.dead = ped.mode === "dead";
  placeCharacter(frame, slot, scene.tick, ped);
  slot.item.object.visible = true;
}

/** Syncs one officer: the gun raised near a living player, kicked by its own muzzle flashes. */
function syncCop(frame: Frame, scene: Scene, cop: CopState): void {
  if (!within(frame.focus, cop.x, cop.y, CHARACTER_DRAW_DISTANCE_M)) return;
  const { cops } = frame.pools;
  const kept = cops.keep(cop.id);
  aimWho(frame, cop.id, kept, cop);
  const slot =
    kept && fits(frame, kept, "cop")
      ? kept
      : claimCharacter(frame, cops, "cop", undefined, kept?.state);
  const dead = cop.diedAtTick !== null;
  trackMotion(slot.state.motion, cop.x, cop.y, frame.dt, null);
  const fired = muzzleTickNear(frame.muzzles, cop.x, cop.y);
  registerShot(slot.state.shots, fired, frame.dt);
  frame.pose.weapon = cop.weapon;
  frame.pose.aiming =
    !dead && livingPlayerWithin(scene.players, cop.x, cop.y, COP_AIM_RANGE_M);
  frame.pose.dead = dead;
  placeCharacter(frame, slot, scene.tick, cop);
  if (!dead) recordMuzzle(frame, slot.item, cop.id);
  slot.item.object.visible = true;
}

/**
 * A car's slot, rebuilt when its kind or colour changed under the same id, or when the factory
 * would now build it as another variant (the Kit's models have landed) — then it keeps its
 * steering memory.
 */
function vehicleSlot(
  frame: Frame,
  car: VehicleState,
): PoolSlot<Vehicle3d, VehicleSlotState> {
  const { kind, colour } = car;
  const kept = frame.pools.vehicles.keep(car.id);
  const variant = frame.factories.vehicleVariant?.(kind, colour);
  const same = kept?.state.kind === kind && kept.state.colour === colour;
  if (kept && same && (variant === undefined || kept.variant === variant))
    return kept;
  return frame.pools.vehicles.claim(
    car.id,
    variant ?? `${kind}:${colour}`,
    () => frame.factories.vehicle(kind, colour),
    { kind, colour, steer: same ? kept.state.steer : createSteerMemory() },
  );
}

/** The front wheels' steering: the driver's command, or read from the car's turn. */
function steerOf(
  frame: Frame,
  memory: SteerMemory,
  car: VehicleState,
  forward: number,
  driver: ArenaPlayerState | undefined,
): number {
  const sample = frame.steerSample;
  sample.heading = car.heading;
  sample.forward = forward;
  sample.kind = car.kind;
  sample.dt = frame.dt;
  sample.driverSteer = driver ? driver.driveSteer : null;
  return trackSteer(memory, sample);
}

/** Where a tank's turret points: your aim when you drive it, another driver's facing, or ahead. */
function turretYawOf(
  frame: Frame,
  scene: Scene,
  car: VehicleState,
  driver: ArenaPlayerState | undefined,
): number | null {
  if (!driver || !firesCannon(car.kind)) return null;
  return driver.id === scene.localPlayerId ? frame.view.aim : driver.facing;
}

/**
 * Copies the car the local player drives into `local.vehicle`, from the input its model just got.
 * In first person its own body is hidden (the cockpit shows instead) unless it is a wreck.
 */
function describeLocalVehicle(
  frame: Frame,
  car: VehicleState,
  input: Vehicle3dInput,
): void {
  const vehicle = frame.localVehicle;
  vehicle.id = car.id;
  vehicle.kind = car.kind;
  vehicle.colour = car.colour;
  vehicle.steer = input.steer;
  vehicle.speedMps = input.speed;
  vehicle.heading = car.heading;
  vehicle.x = car.x;
  vehicle.y = car.y;
  vehicle.siren = input.siren;
  vehicle.wrecked = car.wrecked;
  frame.local.vehicle = vehicle;
}

/**
 * Records a tank's barrel as its driver's muzzle: where the simulation fires the shell from (half
 * the hull's length out along the aim), at the barrel's height.
 */
function recordBarrel(
  frame: Frame,
  car: VehicleState,
  driverId: number,
  aim: number,
): void {
  const reach = lengthOf(car.kind) / 2;
  frame.muzzlePoint.set(
    car.x + Math.cos(aim) * reach,
    TANK_BARREL_HEIGHT_M,
    car.y + Math.sin(aim) * reach,
  );
  frame.muzzleMap.set(driverId, frame.muzzlePoint);
}

/** True when the living local player drives `driver`'s car. */
function isLocalDriver(
  scene: Scene,
  driver: ArenaPlayerState | undefined,
): boolean {
  return driver?.id === scene.localPlayerId && driver.diedAtTick === null;
}

/**
 * Syncs one car; its hull is turned before `update`, which the tank's turret relies on. The local
 * player's own car hides in first person while it is whole: the cockpit is drawn instead.
 */
function syncVehicle(frame: Frame, scene: Scene, car: VehicleState): void {
  if (!within(frame.focus, car.x, car.y, VEHICLE_DRAW_DISTANCE_M)) return;
  const slot = vehicleSlot(frame, car);
  const driver = driverOf(scene.players, car.id);
  const forward = forwardSpeed(car);
  const { object } = slot.item;
  setWorldPosition(object.position, car.x, car.y);
  object.rotation.y = headingToRotationY(car.heading);
  const input = frame.vehicleInput;
  input.speed = forward;
  input.steer = steerOf(frame, slot.state.steer, car, forward, driver);
  input.wrecked = car.wrecked;
  input.siren = scene.sirenVehicleIds?.has(car.id) ?? false;
  input.tick = scene.tick;
  input.health = car.health;
  input.turretYaw = turretYawOf(frame, scene, car, driver);
  input.dt = frame.dt;
  slot.item.update(input);
  if (driver && input.turretYaw !== null && !car.wrecked)
    recordBarrel(frame, car, driver.id, input.turretYaw);
  const own = isLocalDriver(scene, driver);
  if (own) describeLocalVehicle(frame, car, input);
  object.visible = !(own && frame.view.firstPerson && !car.wrecked);
}

/** A pickup's slot, rebuilt when a different kind appears under the same id. */
function pickupSlot(
  frame: Frame,
  pickup: PickupState,
): PoolSlot<Pickup3d, { kind: PickupKind }> {
  const kept = frame.pools.pickups.keep(pickup.id);
  if (kept?.state.kind === pickup.kind) return kept;
  const { kind } = pickup;
  return frame.pools.pickups.claim(
    pickup.id,
    kind,
    () => frame.factories.pickup(kind),
    { kind },
  );
}

/** Syncs one pickup spot; the model hides itself while the pickup is taken. */
function syncPickup(frame: Frame, scene: Scene, pickup: PickupState): void {
  if (!within(frame.focus, pickup.x, pickup.y, PICKUP_DRAW_DISTANCE_M)) return;
  const slot = pickupSlot(frame, pickup);
  setWorldPosition(slot.item.object.position, pickup.x, pickup.y);
  frame.pickupInput.taken = pickup.takenAtTick !== null;
  frame.pickupInput.tick = scene.tick;
  slot.item.update(frame.pickupInput);
}

/** The pools, all showing their objects under `group`. */
function createPools(group: Group): Pools {
  return {
    players: createEntityPool(group, FREE_LIST_CAP),
    peds: createEntityPool(group, FREE_LIST_CAP),
    cops: createEntityPool(group, FREE_LIST_CAP),
    vehicles: createEntityPool(group, FREE_LIST_CAP),
    pickups: createEntityPool(group, FREE_LIST_CAP),
  };
}

/** The local player's reused records: on foot with bare fists, no car. */
function createLocal(): Pick<Frame, "local" | "localVehicle"> {
  return {
    local: {
      onFoot: false,
      weapon: "fist",
      firedTick: null,
      speed: 0,
      vehicle: null,
    },
    localVehicle: {
      id: 0,
      kind: "sedan",
      colour: 0,
      steer: 0,
      speedMps: 0,
      heading: 0,
      x: 0,
      y: 0,
      siren: false,
      wrecked: false,
    },
  };
}

/** A sync's frame with its scratch inputs, all reused every frame. */
function createFrame(factories: EntityFactories, group: Group): Frame {
  return {
    factories,
    pools: createPools(group),
    ...createLocal(),
    muzzles: [],
    muzzleMap: createMuzzleMap(),
    muzzlePoint: new Vector3(),
    pose: {
      speed: 0,
      phaseM: 0,
      aiming: false,
      weapon: null,
      dead: false,
      tick: 0,
      recoil: 0,
    },
    vehicleInput: {
      speed: 0,
      steer: 0,
      wrecked: false,
      siren: false,
      tick: 0,
      health: 0,
      turretYaw: null,
      dt: 0,
    },
    steerSample: {
      heading: 0,
      forward: 0,
      kind: "sedan",
      dt: 0,
      driverSteer: null,
    },
    pickupInput: { taken: false, tick: 0 },
    who: { id: 0, simple: false },
    dt: 0,
    tick: 0,
    focus: { x: 0, y: 0 },
    view: { firstPerson: false, aim: 0 },
  };
}

/** Runs one frame's sync over every kind of entity. */
function syncScene(frame: Frame, scene: Scene): void {
  collectFreshMuzzles(scene.effects, scene.tick, frame.muzzles);
  frame.local.onFoot = false;
  frame.local.vehicle = null;
  for (const player of scene.players) syncPlayer(frame, scene, player);
  for (const ped of scene.peds) syncPed(frame, scene, ped);
  for (const cop of scene.cops) syncCop(frame, scene, cop);
  for (const car of scene.vehicles) syncVehicle(frame, scene, car);
  for (const pickup of scene.pickups) syncPickup(frame, scene, pickup);
}

/**
 * The 3D cast from a scene (spec §6.6–6.7). Looks: you wear `player`, other players
 * `otherPlayer` with a vest hue by id, pedestrians their look by id, officers `cop`. Characters
 * are drawn within {@link CHARACTER_DRAW_DISTANCE_M} of the camera focus, vehicles within
 * {@link VEHICLE_DRAW_DISTANCE_M}; each entity keeps its model while seen and frees it to a free
 * list of its look or kind (at most {@link FREE_LIST_CAP}) once gone.
 *
 * @param factories - Builds the models; tests pass fakes.
 * @returns The sync; add its `group` to the scene and call `update` every frame.
 */
export function createEntitySync(factories: EntityFactories): EntitySync {
  const group = new Group();
  group.name = "entities";
  const frame = createFrame(factories, group);
  const { players, peds, cops, vehicles, pickups } = frame.pools;
  const pools = [players, peds, cops, vehicles, pickups];
  return {
    group,
    local: frame.local,
    muzzles: frame.muzzleMap,
    update(scene, dt, cameraFocus, view) {
      frame.dt = dt;
      frame.tick = scene.tick;
      frame.focus = cameraFocus;
      frame.view = view;
      for (const pool of pools) pool.begin();
      frame.muzzleMap.begin();
      syncScene(frame, scene);
      frame.muzzleMap.end();
      for (const pool of pools) pool.end();
    },
    dispose() {
      for (const pool of pools) pool.dispose();
    },
  };
}
