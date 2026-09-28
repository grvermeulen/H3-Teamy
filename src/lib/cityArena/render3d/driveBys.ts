/**
 * Every armed driver's drive-by in view (aim spec §7), for the entity sync: remembers each
 * driver's shots and aim, holds their gun out of the window while a shot is fresh (or, for you,
 * while aiming down the sights) and records the gun's muzzle, so the flashes and rounds of a
 * drive-by leave the gun rather than the middle of the car.
 *
 * A driver's shots are read like a player's on foot: their next-shot tick moving on, else — for
 * another player — a fresh muzzle flash at their seat. The simulation keeps a driver's `facing`
 * on the car's heading, so another driver's aim is read from their latest muzzle flash's angle;
 * yours is the frame's aim. The arms are pooled per driver; a frame allocates nothing.
 */
import type { Object3D, Vector3 } from "three";
import { SIM_STEP_S } from "../sim/player";
import type { ArenaPlayerState, EffectState, VehicleState } from "../sim/types";
import { LOOKS, vestColour } from "./characterLooks";
import {
  createDriveBy3d,
  standAtCar,
  type DriveBy3d,
  type DriveByInput,
} from "./driveBy3d";
import {
  driveBySideFor,
  hasDriveBy,
  holdsGun,
  showsDriveBy,
  type WindowSide,
} from "./driveByPose";
import { vestHueOf } from "./entityMotion";
import { createEntityPool, type EntityPool, type PoolSlot } from "./entityPool";
import {
  createShotMemory,
  newestOwnMuzzle,
  registerShot,
  type ShooterBody,
  type ShotMemory,
} from "./entityShots";
import type { MuzzleMap } from "./muzzleMap";

/** What a drive-by reads from the entity sync's frame; its `Frame` fits. */
export type DriveByContext = {
  readonly tick: number;
  /** Seconds since the previous frame. */
  readonly dt: number;
  /** The frame's fresh muzzle flashes. */
  readonly muzzles: readonly EffectState[];
  /** Everyone who can fire this frame: a flash counts only for the body nearest to it. */
  readonly shooters: readonly ShooterBody[];
  /** Receives each shown gun's muzzle by driver id. */
  readonly muzzleMap: MuzzleMap;
  /** Scratch for one muzzle before it is recorded. */
  readonly muzzlePoint: Vector3;
  /** First person, your aim, and whether you aim down the sights. */
  readonly view: {
    readonly firstPerson: boolean;
    readonly aim: number;
    readonly ads?: boolean;
  };
};

/** A driver whose gun is out: the window, and their latest shot for the cockpit's kick. */
export type DriveByShown = {
  side: WindowSide;
  /** Tick of the latest shot, or `null` while only aiming. */
  firedTick: number | null;
};

/** What a driver's arm remembers between frames. */
type DriverMemory = {
  local: boolean;
  shots: ShotMemory;
  /** Next-shot tick last frame; moving on means a shot. */
  nextShotTick: number | null;
  /** The latest aim seen, radians; `null` until one is. */
  aim: number | null;
  /** The window last frame, for the hysteresis; unset while the gun is away. */
  side: WindowSide | undefined;
  shown: DriveByShown;
  input: DriveByInput;
};

/** Every driver's drive-by. */
export type DriveBys = {
  /** Starts a frame: every driver must be synced again to keep an arm. */
  begin(): void;
  /**
   * Remembers `driver`'s shots and aim, and while the drive-by shows poses their arm out of
   * `car`'s window and records the gun's muzzle.
   *
   * @param context - The frame.
   * @param driver - A living player at the wheel of `car`.
   * @param car - Their car.
   * @param local - The driver is you.
   * @returns The window and last shot while the gun is out; `null` while it is away. Valid until
   *   the next `sync` of this driver.
   */
  sync(
    context: DriveByContext,
    driver: ArenaPlayerState,
    car: VehicleState,
    local: boolean,
  ): Readonly<DriveByShown> | null;
  /** Ends a frame: frees the arms of drivers not synced since `begin`. */
  end(): void;
  /** Disposes every arm, in use or free. */
  dispose(): void;
};

/** Arms kept for reuse: only yours is pooled, since another player's sleeve is theirs alone. */
const FREE_ARMS = 1;
/** The pool variant of your arm; another player's is a one-off in their vest colour. */
const LOCAL_VARIANT = "local";

type ArmSlot = PoolSlot<DriveBy3d, DriverMemory>;

/** A fresh memory for a driver. */
function createMemory(local: boolean): DriverMemory {
  return {
    local,
    shots: createShotMemory(),
    nextShotTick: null,
    aim: null,
    side: undefined,
    shown: { side: "front", firedTick: null },
    input: {
      kind: "sedan",
      side: "front",
      heading: 0,
      aim: 0,
      weapon: "pistol",
      recoil: 0,
    },
  };
}

/** The driver's arm: the one kept since last frame, or a new one in their sleeve colour. */
function armOf(
  pool: EntityPool<DriveBy3d, DriverMemory>,
  driver: ArenaPlayerState,
  local: boolean,
): ArmSlot {
  const kept = pool.keep(driver.id);
  if (kept?.state.local === local) return kept;
  const sleeve = local ? LOOKS.player.skin : vestColour(vestHueOf(driver.id));
  return pool.claim(
    driver.id,
    local ? LOCAL_VARIANT : null,
    () => createDriveBy3d(sleeve),
    createMemory(local),
  );
}

/** Registers a shot from the next-shot tick moving on, else another driver's flash at the seat. */
function trackShot(
  context: DriveByContext,
  memory: DriverMemory,
  driver: ArenaPlayerState,
): void {
  const previous = memory.nextShotTick;
  memory.nextShotTick = driver.nextShotTick;
  let fired: number | null = null;
  if (previous !== null && driver.nextShotTick > previous) fired = context.tick;
  else if (!memory.local)
    fired =
      newestOwnMuzzle(context.muzzles, driver, context.shooters)?.bornTick ??
      null;
  registerShot(memory.shots, fired, context.dt);
}

/** Your aim, or another driver's latest shot's; the car's heading until one is known. */
function aimOf(
  context: DriveByContext,
  memory: DriverMemory,
  driver: ArenaPlayerState,
  car: VehicleState,
): number {
  if (memory.local) memory.aim = context.view.aim;
  else {
    const flash = newestOwnMuzzle(context.muzzles, driver, context.shooters);
    if (flash) memory.aim = flash.angle;
  }
  return memory.aim ?? car.heading;
}

/** Whether the gun is out this frame. */
function gunOut(
  context: DriveByContext,
  memory: DriverMemory,
  car: VehicleState,
): boolean {
  const fired = memory.shots.firedTick;
  return showsDriveBy({
    holdsGun: true,
    secondsSinceShot:
      fired === null ? null : (context.tick - fired) * SIM_STEP_S,
    ads: memory.local && context.view.ads === true,
    kind: car.kind,
  });
}

/** Poses the arm out of the car's window toward `aim` and records the gun's muzzle. */
function poseArm(
  context: DriveByContext,
  slot: ArmSlot,
  driver: ArenaPlayerState,
  car: VehicleState,
  aim: number,
): void {
  const { item, state } = slot;
  const side = driveBySideFor(car.kind, car.heading, aim, state.side);
  state.side = side;
  const { input } = state;
  input.kind = car.kind;
  input.side = side;
  input.heading = car.heading;
  input.aim = aim;
  input.weapon = driver.weapon;
  input.recoil = state.shots.recoil;
  standAtCar(item.object, car.x, car.y, car.heading);
  item.update(input);
  if (item.muzzleWorld(context.muzzlePoint))
    context.muzzleMap.set(driver.id, context.muzzlePoint);
  state.shown.side = side;
  state.shown.firedTick = state.shots.firedTick;
}

/**
 * The drive-bys of every armed driver in view.
 *
 * @param parent - Where the arms are shown: the cast's group.
 * @returns The drive-bys; call `begin`, `sync` per living driver, then `end` every frame.
 */
export function createDriveBys(parent: Object3D): DriveBys {
  const pool = createEntityPool<DriveBy3d, DriverMemory>(parent, FREE_ARMS);
  return {
    begin: () => pool.begin(),
    sync(context, driver, car, local) {
      if (!holdsGun(driver.weapon) || !hasDriveBy(car.kind)) return null;
      const slot = armOf(pool, driver, local);
      const memory = slot.state;
      trackShot(context, memory, driver);
      const aim = aimOf(context, memory, driver, car);
      const out = gunOut(context, memory, car);
      slot.item.object.visible = out && !(local && context.view.firstPerson);
      if (!out) {
        memory.side = undefined;
        return null;
      }
      poseArm(context, slot, driver, car, aim);
      return memory.shown;
    },
    end: () => pool.end(),
    dispose: () => pool.dispose(),
  };
}
