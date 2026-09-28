/**
 * Drive-bys (aim spec §7): which window a driver shoots from, and how their arm and gun reach out
 * of it. Aiming left of the heading leans out of the driver's window (Dutch cars: the wheel is on
 * the left), right out of the passenger's — the driver reaching across the cabin — and within
 * {@link FRONT_CONE_RAD} of ahead over the dashboard through the (implied) open windscreen. The
 * driver always shoots with the right hand, so the left one stays on the wheel.
 *
 * Car space as for the cockpit (`cockpitSpecs.ts`): +X forward, +Y up, +Z right, metres, origin at
 * the footprint centre on the ground. Turns are car-relative and, like the simulation's, positive
 * to the right. Pure; {@link driveByPose} allocates nothing once a kind's joints are known.
 */
import { wrapAngle } from "../sim/driver";
import type { VehicleKind, WeaponKind } from "../sim/types";
import { widthOf } from "../sim/vehicle";
import { isMelee } from "../sim/weapons";
import { COCKPITS } from "./cockpitSpecs";
import type { Vec3 } from "./lowPoly";

/** The window a drive-by leans out of; `front` is over the dashboard. */
export type WindowSide = "left" | "right" | "front";

/** A drive-by goes over the dashboard while the aim is within this of ahead, radians (35°). */
export const FRONT_CONE_RAD = (35 * Math.PI) / 180;
/** A side is kept this far past its edge, so an aim on the line does not flip it, radians. */
export const SIDE_HYSTERESIS_RAD = (5 * Math.PI) / 180;
/** The gun stays out this long after a shot, seconds. */
export const SHOWN_AFTER_SHOT_S = 1.2;
/** The forearm swings at most this far from square out of its window, radians (40°). */
export const ARM_SWING_RAD = (40 * Math.PI) / 180;
/** The wrist turns the gun at most this far off the forearm, radians: never back into the car. */
export const WRIST_TURN_MAX_RAD = Math.PI / 2;

/** How far in from the body's side the elbow rests on the sill, metres. */
const SIDE_INSET_M = 0.3;
/** How far ahead of the eye the elbow rests on a side window's sill, metres. */
const SIDE_ELBOW_AHEAD_M = 0.1;
/** How far below the eye the elbow rests on a side window's sill, metres. */
const ELBOW_BELOW_EYE_M = 0.26;
/** How far the elbow sits back from the dashboard's near edge over the dash, metres. */
const DASH_ELBOW_BACK_M = 0.1;
/** How high over the dashboard the forearm lies, metres. */
const DASH_CLEARANCE_M = 0.06;
/** How far right of the eye the elbow sits over the dash: the right hand's side, metres. */
const FRONT_ELBOW_RIGHT_M = 0.22;
/** The driver's right shoulder: behind, below and right of the eye, metres. */
const SHOULDER_BEHIND_EYE_M = 0.05;
const SHOULDER_BELOW_EYE_M = 0.28;
const SHOULDER_RIGHT_OF_EYE_M = 0.2;
/** The forearm rises from the sill toward the hand, radians. */
const SIDE_RISE_RAD = 0.08;
/** Over the dash it rises a little more, to clear the bonnet, radians. */
const FRONT_RISE_RAD = 0.15;
/** Kinds whose driver never leans out: the tank fires its cannon. */
const NO_DRIVE_BY: ReadonlySet<VehicleKind> = new Set<VehicleKind>(["tank"]);
/** Kinds whose driver only reaches the driver's window: the bus. */
const DRIVER_WINDOW_ONLY: ReadonlySet<VehicleKind> = new Set<VehicleKind>([
  "bus",
]);

/** Where a window's forearm points when square out of it, car-relative, radians. */
const SQUARE_OUT: Readonly<Record<WindowSide, number>> = {
  left: -Math.PI / 2,
  right: Math.PI / 2,
  front: 0,
};

/** How the arm and gun reach out of a window. */
export type DriveByPose = {
  /** The driver's right shoulder, car space: where the upper arm starts. */
  shoulder: Vec3;
  /** Where the forearm rests: on the window's sill, or over the dashboard; car space. */
  elbow: Vec3;
  /** The forearm's turn from straight ahead, car-relative, positive to the right, radians. */
  yaw: number;
  /** The forearm's rise above level, radians. */
  pitch: number;
  /** The gun's turn from straight ahead, car-relative: the aim, as far as the wrist turns. */
  aimYaw: number;
};

/** A kind's joints for one window, made once. */
type Joints = { shoulder: Vec3; elbow: Vec3 };

const joints: Record<WindowSide, Map<VehicleKind, Joints>> = {
  left: new Map(),
  right: new Map(),
  front: new Map(),
};

/** True when `turn` (car-relative) lies within `side`, its edges widened by `slack`. */
function sideHolds(side: WindowSide, turn: number, slack: number): boolean {
  if (side === "front") return Math.abs(turn) <= FRONT_CONE_RAD + slack;
  const toward = side === "right" ? turn : -turn;
  return toward >= FRONT_CONE_RAD - slack || toward <= -(Math.PI - slack);
}

/**
 * The window a driver shoots from for an aim: the driver's (left) window left of the heading, the
 * passenger's right of it, the dashboard within {@link FRONT_CONE_RAD} of ahead.
 *
 * @param heading - The car's world heading, radians.
 * @param aim - The world aim, radians.
 * @param previous - Last frame's side: kept until the aim is {@link SIDE_HYSTERESIS_RAD} past it.
 * @returns The side.
 */
export function windowSideFor(
  heading: number,
  aim: number,
  previous?: WindowSide,
): WindowSide {
  const turn = wrapAngle(aim - heading);
  if (previous && sideHolds(previous, turn, SIDE_HYSTERESIS_RAD))
    return previous;
  if (Math.abs(turn) <= FRONT_CONE_RAD) return "front";
  return turn < 0 ? "left" : "right";
}

/**
 * The window a driver of `kind` shoots from: {@link windowSideFor}, but always the driver's window
 * of a bus, whose passenger side is its doors.
 *
 * @param kind - The vehicle kind.
 * @param heading - The car's world heading, radians.
 * @param aim - The world aim, radians.
 * @param previous - Last frame's side, for the hysteresis.
 * @returns The side.
 */
export function driveBySideFor(
  kind: VehicleKind,
  heading: number,
  aim: number,
  previous?: WindowSide,
): WindowSide {
  if (DRIVER_WINDOW_ONLY.has(kind)) return "left";
  return windowSideFor(heading, aim, previous);
}

/**
 * Whether a weapon is a gun a driver can hold out of the window: not fists, the bat or the tank's
 * cannon.
 *
 * @param weapon - The weapon.
 * @returns `true` for the pistol, uzi, shotgun, rifle and rocket launcher.
 */
export function holdsGun(weapon: WeaponKind): boolean {
  return !isMelee(weapon) && weapon !== "cannon";
}

/**
 * Whether a kind's driver ever leans out to shoot: all but the tank, which fires its cannon.
 *
 * @param kind - The vehicle kind.
 * @returns `false` for the tank.
 */
export function hasDriveBy(kind: VehicleKind): boolean {
  return !NO_DRIVE_BY.has(kind);
}

/** What decides whether a driver's gun is out of the window. */
export type DriveByShow = {
  /** A gun: not fists, the bat or the tank's cannon. */
  holdsGun: boolean;
  /** Seconds since the driver's latest shot, or `null` before one. */
  secondsSinceShot: number | null;
  /** The local player aims down the sights. */
  ads: boolean;
  kind: VehicleKind;
};

/**
 * Whether a driver holds their gun out of the window: armed, not in a tank, and within
 * {@link SHOWN_AFTER_SHOT_S} of a shot or (for you) while aiming down the sights.
 *
 * @param show - The driver's weapon, last shot, aiming and car.
 * @returns `true` while the drive-by shows.
 */
export function showsDriveBy(show: DriveByShow): boolean {
  if (!show.holdsGun || !hasDriveBy(show.kind)) return false;
  if (show.ads) return true;
  const since = show.secondsSinceShot;
  return since !== null && since >= 0 && since <= SHOWN_AFTER_SHOT_S;
}

/** Where the forearm rests for a kind and window. */
function elbowOf(kind: VehicleKind, side: WindowSide): Vec3 {
  const spec = COCKPITS[kind];
  if (side === "front")
    return [
      spec.eyeForwardM + spec.dash.aheadM - DASH_ELBOW_BACK_M,
      spec.dash.heightM + DASH_CLEARANCE_M,
      -spec.eyeLeftM + FRONT_ELBOW_RIGHT_M,
    ];
  const across = widthOf(kind) / 2 - SIDE_INSET_M;
  return [
    spec.eyeForwardM + SIDE_ELBOW_AHEAD_M,
    spec.eyeHeightM - ELBOW_BELOW_EYE_M,
    side === "left" ? -across : across,
  ];
}

/** A kind's joints for a window, made on first use. */
function jointsOf(kind: VehicleKind, side: WindowSide): Joints {
  const cached = joints[side].get(kind);
  if (cached) return cached;
  const spec = COCKPITS[kind];
  const made: Joints = {
    shoulder: [
      spec.eyeForwardM - SHOULDER_BEHIND_EYE_M,
      spec.eyeHeightM - SHOULDER_BELOW_EYE_M,
      -spec.eyeLeftM + SHOULDER_RIGHT_OF_EYE_M,
    ],
    elbow: elbowOf(kind, side),
  };
  joints[side].set(kind, made);
  return made;
}

/** `value` held within ±`limit`. */
function clampTurn(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * A pose to reuse with {@link driveByPose}.
 *
 * @returns A pose with the sedan's driver's-window joints, square out of it.
 */
export function createDriveByPose(): DriveByPose {
  return {
    ...jointsOf("sedan", "left"),
    yaw: SQUARE_OUT.left,
    pitch: SIDE_RISE_RAD,
    aimYaw: SQUARE_OUT.left,
  };
}

/**
 * How the arm and gun reach out of `side`'s window toward the aim: the forearm on the sill (or
 * over the dash) swings toward the aim but at most {@link ARM_SWING_RAD} from square out of the
 * window, and the wrist turns the gun the rest of the way — at most {@link WRIST_TURN_MAX_RAD}.
 *
 * @param kind - The vehicle kind: its seat and width place the joints.
 * @param side - The window, from {@link driveBySideFor}.
 * @param heading - The car's world heading, radians.
 * @param aim - The world aim, radians.
 * @param out - Receives the pose; a new one by default.
 * @returns `out`; its joints are shared per kind and window: never write to them.
 */
export function driveByPose(
  kind: VehicleKind,
  side: WindowSide,
  heading: number,
  aim: number,
  out: DriveByPose = createDriveByPose(),
): DriveByPose {
  const { shoulder, elbow } = jointsOf(kind, side);
  const square = SQUARE_OUT[side];
  const turn = wrapAngle(aim - heading);
  out.shoulder = shoulder;
  out.elbow = elbow;
  out.yaw = square + clampTurn(wrapAngle(turn - square), ARM_SWING_RAD);
  out.aimYaw =
    out.yaw + clampTurn(wrapAngle(turn - out.yaw), WRIST_TURN_MAX_RAD);
  out.pitch = side === "front" ? FRONT_RISE_RAD : SIDE_RISE_RAD;
  return out;
}
