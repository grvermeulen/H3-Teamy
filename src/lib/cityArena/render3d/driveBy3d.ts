/**
 * A drive-by's arm and gun (aim spec §7): the driver's right forearm resting on the sill of the
 * window they shoot from — or over the dashboard — and the held gun pointing along the aim, with
 * the upper arm in the sleeve colour running back to the shoulder. The car's body is left alone:
 * the arm is an object of its own in the car's frame, placed from the car's position and heading
 * and the seat data (`driveByPose.ts`), so any car body wears it.
 *
 * {@link DriveBy3d.object} is the car's frame: stand it where the car is with {@link standAtCar},
 * or hang it in the cockpit, which already is that frame. The forearm and each sleeve colour's
 * upper arm are built once and shared until {@link disposeDriveByAssets}; a frame allocates
 * nothing.
 */
import { Group, Mesh, Object3D, Vector3, type BufferGeometry } from "three";
import type { VehicleKind, WeaponKind } from "../sim/types";
import { characterMaterials } from "./characterRig";
import { headingToRotationY, setWorldPosition } from "./coords";
import { createDriveByPose, driveByPose, type WindowSide } from "./driveByPose";
import { block } from "./lowPoly";
import { armGeometry } from "./viewmodel";
import { createWeaponModel, muzzleTipOf } from "./weapons3d";

/** What the arm follows each frame. */
export type DriveByInput = {
  kind: VehicleKind;
  /** The window, from `driveBySideFor`. */
  side: WindowSide;
  /** The car's world heading, radians. */
  heading: number;
  /** The world aim, radians. */
  aim: number;
  weapon: WeaponKind;
  /** 0…1: 1 as a shot fires, easing back to rest. */
  recoil: number;
};

/** A drive-by's arm and gun. */
export type DriveBy3d = {
  /** The car's frame: +X forward, +Y up, +Z right, origin at the footprint centre on the ground. */
  object: Object3D;
  /** A point on the gun's muzzle, moving with the gun's kick: hang a flash on it. */
  muzzle: Object3D;
  /** Poses the arm and gun out of the window toward the aim, swapping the gun if it changed. */
  update(input: DriveByInput): void;
  /**
   * Where the gun's barrel ends in the world, as posed by the last `update`.
   *
   * @param target - Receives the world position; untouched without a gun.
   * @returns `false` for fists and the bat.
   */
  muzzleWorld(target: Vector3): boolean;
  /** Detaches the arm; the shared geometry stays until {@link disposeDriveByAssets}. */
  dispose(): void;
};

/** From the elbow to the fist's centre along the forearm, metres (`armGeometry`'s length). */
export const FOREARM_M = 0.46;
/** How far a full kick tips the muzzle up, radians. */
const KICK_PITCH_RAD = 0.35;
/** How far a full kick pushes the gun back along the forearm, metres. */
const KICK_BACK_M = 0.05;
/** The upper arm's section, metres. */
const SLEEVE_THICKNESS_M = 0.11;
/** Rounded edges on the upper arm. */
const SLEEVE_CHAMFER = 0.5;

/** The shared forearm and upper arms by sleeve colour. */
let forearm: BufferGeometry | null = null;
const sleeves = new Map<number, BufferGeometry>();

/** The right forearm and fist, with the bead bracelet, built on first use. */
function forearmGeometry(): BufferGeometry {
  forearm ??= armGeometry("R");
  return forearm;
}

/** A unit-long upper arm along +Z in a sleeve colour, built on first use. */
function sleeveGeometry(colour: number): BufferGeometry {
  const cached = sleeves.get(colour);
  if (cached) return cached;
  const geometry = block({
    size: [SLEEVE_THICKNESS_M, SLEEVE_THICKNESS_M, 1],
    at: [0, 0, 0.5],
    colour,
    chamfer: SLEEVE_CHAMFER,
  });
  sleeves.set(colour, geometry);
  return geometry;
}

/**
 * Frees the shared forearm and upper arms and forgets them, so a view that has gone keeps none
 * (nor its renderer) reachable; the next arm builds them afresh.
 */
export function disposeDriveByAssets(): void {
  forearm?.dispose();
  forearm = null;
  for (const geometry of sleeves.values()) geometry.dispose();
  sleeves.clear();
}

/**
 * Stands a drive-by's frame where the car is, turned to its heading.
 *
 * @param object - The arm's {@link DriveBy3d.object}.
 * @param x - The car, metres east.
 * @param y - Metres south.
 * @param heading - The car's world heading, radians.
 */
export function standAtCar(
  object: Object3D,
  x: number,
  y: number,
  heading: number,
): void {
  setWorldPosition(object.position, x, y);
  object.rotation.y = headingToRotationY(heading);
}

/** The arm's moving parts. */
type ArmParts = {
  sleeve: Mesh;
  /** At the elbow: turns the forearm toward the aim and lifts it. */
  elbow: Group;
  /** At the fist: turns the gun the rest of the way, level. */
  wrist: Group;
  /** Kicks on a shot; holds the gun and its muzzle. */
  holder: Group;
  muzzle: Object3D;
};

/** Builds the arm's hierarchy: sleeve, elbow → forearm and wrist → holder → gun and muzzle. */
function buildArm(object: Group, sleeve: number): ArmParts {
  const material = characterMaterials().body;
  const upper = new Mesh(sleeveGeometry(sleeve), material);
  upper.name = "drive-by-sleeve";
  const lower = new Mesh(forearmGeometry(), material);
  lower.name = "drive-by-forearm";
  lower.position.x = FOREARM_M;
  // The forearm runs back along the geometry's +Z: turned to run back along −X, to the elbow.
  lower.rotation.y = -Math.PI / 2;
  const elbow = new Group();
  const wrist = new Group();
  wrist.position.x = FOREARM_M;
  wrist.rotation.order = "ZYX";
  const holder = new Group();
  const muzzle = new Object3D();
  muzzle.name = "drive-by-muzzle";
  holder.add(muzzle);
  wrist.add(holder);
  elbow.add(lower, wrist);
  object.add(upper, elbow);
  return { sleeve: upper, elbow, wrist, holder, muzzle };
}

/** Along +Z, the upper arm's own length. */
const SLEEVE_AXIS = new Vector3(0, 0, 1);
/** Reused per frame: the shoulder, the elbow and the way between them. */
const shoulderAt = new Vector3();
const elbowAt = new Vector3();
const reach = new Vector3();

/** Stretches the upper arm from the shoulder to the elbow. */
function placeSleeve(sleeve: Mesh, shoulder: Vector3, elbow: Vector3): void {
  reach.subVectors(elbow, shoulder);
  const length = reach.length();
  sleeve.position.copy(shoulder);
  sleeve.quaternion.setFromUnitVectors(SLEEVE_AXIS, reach.normalize());
  sleeve.scale.set(1, 1, length);
}

/**
 * Creates a drive-by's arm in a sleeve colour: the player's own skin for you (shirtless), another
 * player's vest colour for them, so everyone sees whose arm it is.
 *
 * @param sleeve - sRGB hex colour of the upper arm.
 * @returns The arm; `update` it every frame it shows.
 */
export function createDriveBy3d(sleeve: number): DriveBy3d {
  const object = new Group();
  object.name = "drive-by";
  const parts = buildArm(object, sleeve);
  const pose = createDriveByPose();
  let weapon: WeaponKind | null = null;
  let gun: Object3D | null = null;
  let armed = false;
  const swapGun = (next: WeaponKind): void => {
    gun?.removeFromParent();
    weapon = next;
    gun = createWeaponModel(next);
    parts.holder.add(gun);
    const tip = muzzleTipOf(next);
    armed = tip !== null;
    if (tip) parts.muzzle.position.set(...tip);
  };
  return {
    object,
    muzzle: parts.muzzle,
    update(input) {
      if (input.weapon !== weapon) swapGun(input.weapon);
      const { side, heading, aim, kind } = input;
      driveByPose(kind, side, heading, aim, pose);
      placeSleeve(
        parts.sleeve,
        shoulderAt.set(...pose.shoulder),
        elbowAt.set(...pose.elbow),
      );
      parts.elbow.position.copy(elbowAt);
      parts.elbow.rotation.set(0, -pose.yaw, pose.pitch);
      parts.wrist.rotation.set(0, -(pose.aimYaw - pose.yaw), -pose.pitch);
      const kick = input.recoil * input.recoil;
      parts.holder.rotation.z = KICK_PITCH_RAD * kick;
      parts.holder.position.x = -KICK_BACK_M * kick;
    },
    muzzleWorld(target) {
      if (!armed) return false;
      parts.muzzle.getWorldPosition(target);
      return true;
    },
    dispose() {
      object.removeFromParent();
    },
  };
}
