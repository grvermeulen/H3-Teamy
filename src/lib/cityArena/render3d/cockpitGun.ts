/**
 * The cockpit's gun hand (aim spec §7): in first person at the wheel, while your drive-by shows,
 * your right hand leaves the wheel and holds the gun out of the window — or over the dash — toward
 * the aim. It is the same arm the street sees (`driveBy3d.ts`), hung in the cockpit's own car
 * frame, with the view model's kick and muzzle flash at its barrel; its barrel end is your muzzle
 * in first person. A frame allocates nothing.
 */
import type { Object3D, Vector3 } from "three";
import type { VehicleKind, WeaponKind } from "../sim/types";
import { LOOKS } from "./characterLooks";
import { createDriveBy3d, type DriveByInput } from "./driveBy3d";
import type { WindowSide } from "./driveByPose";
import {
  FRESH_SHOT_TICKS,
  VIEW_FLASH_S,
  VIEW_RECOIL_RECOVERY_S,
  createFlashMesh,
  showFlash,
} from "./viewmodel";

/** Your gun out of the window while you drive and shoot or aim down the sights. */
export type CockpitDriveBy = {
  /** The window, from the entity sync's drive-by. */
  side: WindowSide;
  /** The car's world heading, radians. */
  heading: number;
  /** Your world aim, radians. */
  aim: number;
  weapon: WeaponKind;
  /** Tick of your latest shot, or `null` while only aiming. */
  firedTick: number | null;
};

/** The cockpit's gun hand. */
export type CockpitGun = {
  /** In the cockpit's car frame: add it to the cockpit's root. */
  object: Object3D;
  /**
   * Poses the gun hand out of the window, kicking and flashing on a fresh shot, or hides it.
   *
   * @param driveBy - Your drive-by, or `null` while both hands are on the wheel.
   * @param kind - The car's kind: its seat places the arm.
   * @param tick - The simulation tick, to tell a fresh shot from one seen late.
   * @param dt - Seconds since the previous frame.
   * @returns Whether the gun hand shows.
   */
  update(
    driveBy: CockpitDriveBy | null,
    kind: VehicleKind,
    tick: number,
    dt: number,
  ): boolean;
  /**
   * Where the gun's barrel ends in the world, as posed by the last `update`.
   *
   * @param target - Receives the world position; untouched while it hides.
   * @returns `false` unless the last `update` showed the gun.
   */
  muzzleWorld(target: Vector3): boolean;
  /** Detaches the gun hand and frees its flash. */
  dispose(): void;
};

/**
 * Share of a full shot kick the gun hand takes: this close to the eye the street's kick would
 * throw the gun half out of view.
 */
const COCKPIT_KICK_SHARE = 0.6;

/** The kick and flash between frames. */
type GunState = {
  lastFiredTick: number | null;
  /** 1 on a shot, falling to 0 over {@link VIEW_RECOIL_RECOVERY_S}. */
  kick: number;
  /** Seconds the flash still shows. */
  flash: number;
};

/** Starts the kick and flash when a new shot arrives fresh. */
function registerShot(
  state: GunState,
  firedTick: number | null,
  tick: number,
): void {
  if (firedTick === null || firedTick === state.lastFiredTick) return;
  state.lastFiredTick = firedTick;
  if (tick - firedTick > FRESH_SHOT_TICKS) return;
  state.kick = 1;
  state.flash = VIEW_FLASH_S;
}

/**
 * Creates the gun hand in your own skin, hidden until the first drive-by.
 *
 * @returns The gun hand; `update` it every frame the cockpit shows.
 */
export function createCockpitGun(): CockpitGun {
  const arm = createDriveBy3d(LOOKS.player.skin);
  arm.object.name = "cockpit-gun";
  arm.object.visible = false;
  const flash = createFlashMesh();
  arm.muzzle.add(flash);
  const state: GunState = { lastFiredTick: null, kick: 0, flash: 0 };
  const input: DriveByInput = {
    kind: "sedan",
    side: "front",
    heading: 0,
    aim: 0,
    weapon: "pistol",
    recoil: 0,
  };
  return {
    object: arm.object,
    update(driveBy, kind, tick, dt) {
      arm.object.visible = driveBy !== null;
      if (!driveBy) return false;
      registerShot(state, driveBy.firedTick, tick);
      input.kind = kind;
      input.side = driveBy.side;
      input.heading = driveBy.heading;
      input.aim = driveBy.aim;
      input.weapon = driveBy.weapon;
      input.recoil = state.kick * COCKPIT_KICK_SHARE;
      arm.update(input);
      showFlash(flash, state.flash);
      state.kick = Math.max(0, state.kick - dt / VIEW_RECOIL_RECOVERY_S);
      state.flash = Math.max(0, state.flash - dt);
      return true;
    },
    muzzleWorld: (target) => arm.object.visible && arm.muzzleWorld(target),
    dispose() {
      arm.dispose();
      flash.geometry.dispose();
      flash.material.dispose();
    },
  };
}
