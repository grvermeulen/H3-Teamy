/**
 * Where the 3D camera stands and what it looks at (spec §6.3): over the right shoulder, behind the
 * car, behind the eyes, or rising over a body — and how it zooms while aiming down the sights (aim
 * spec §5). Pure maths on plain tuples; only {@link applyRigPose} touches a three.js camera, and
 * only through the object it is handed.
 */
import type { PerspectiveCamera, Vector3Tuple } from "three";
import type { ArenaSettings } from "../schemas";
import type { VehicleKind, WeaponKind } from "../sim/types";
import { seatOffset } from "./cockpitSpecs";
import {
  AIM_PROJECT_DISTANCE_M,
  EYE_HEIGHT_M,
  PERSON_CHEST_HEIGHT_M,
} from "./coords";

/** Behind the shoulder, or behind the eyes — the settings' `camera3d`. */
export type CameraMode = ArenaSettings["camera3d"];

/** What the rig needs to place the camera for one frame. */
export type RigInput = {
  mode: CameraMode;
  /** The camera's world heading, radians (`0` = east). */
  yaw: number;
  /** Radians above the horizon. */
  pitch: number;
  /** The followed player (or their car), world metres. */
  target: { x: number; y: number };
  /** The car being driven, or `null` on foot: its kind picks the driver's seat. */
  driving: { length: number; heading: number; kind: VehicleKind } | null;
  dead: boolean;
  /** Seconds since death; ignored while alive. */
  deadSeconds: number;
  /** Frame time in seconds; the rig is stateless and places the camera from scratch each frame. */
  dt: number;
  /** How far the sights are up, 0 (at the hip, the default) … 1 ({@link sightsShare}). */
  sights?: number;
  /** The weapon held: its sights pick the first-person zoom ({@link ADS_FOV_DEG}). */
  weapon?: WeaponKind;
};

/** A camera placement in three.js coordinates. */
export type RigPose = {
  position: Vector3Tuple;
  lookAt: Vector3Tuple;
  /** Vertical field of view, degrees. */
  fovDeg: number;
  /**
   * How much the sights narrow the view: `tan(fov / 2)` over the unzoomed `tan(fov / 2)` — what
   * mouse-look scales its turn by, so a zoomed view does not whip. 1 at the hip.
   */
  zoom: number;
};

/** Third person: metres behind the player. */
export const THIRD_PERSON_BACK_M = 3.6;
/** Third person: camera height at level pitch, metres. */
export const THIRD_PERSON_UP_M = 1.9;
/** Third person: metres to the player's right, so the view looks past the shoulder. */
export const SHOULDER_M = 0.55;
/** The chase camera sits at least this far behind a car, metres (spec §6.3). */
export const CHASE_MIN_BACK_M = 7;
/** …and at most this far, however long the vehicle. */
export const CHASE_MAX_BACK_M = 10;
/** Chase camera height at level pitch, metres. */
const CHASE_UP_M = 2.8;
/** Share of the boom length the camera drops (looking up) or climbs (looking down) by `sin(pitch)`. */
const BOOM_TILT = 0.5;
/** The camera never dips below this height, metres. */
const MIN_CAMERA_HEIGHT_M = 0.35;
/** How far ahead of the eye a first-person look target is placed; only its direction matters. */
const FIRST_PERSON_LOOK_M = 10;
/** The death camera starts this high and climbs by {@link DEATH_RISE_M_PER_S} … */
const DEATH_START_UP_M = 2.4;
const DEATH_RISE_M_PER_S = 1.6;
/** … up to this many metres above its start. */
const DEATH_MAX_RISE_M = 6;
/** Horizontal distance of the death camera from the body, metres. */
const DEATH_ORBIT_RADIUS_M = 4.5;
/** How fast the death camera circles the body, radians per second. */
const DEATH_ORBIT_RAD_PER_S = 0.35;
/** The death camera looks at the body this far above the ground, metres. */
const BODY_HEIGHT_M = 0.3;
/** Vertical fields of view, degrees: over the shoulder, behind the eyes, and the car chase. */
const THIRD_PERSON_FOV_DEG = 60;
const FIRST_PERSON_FOV_DEG = 70;
const CHASE_FOV_DEG = 65;
/** Pitch clamps per mode, degrees (spec §6.3). */
const THIRD_PITCH_MIN_DEG = -35;
const THIRD_PITCH_MAX_DEG = 40;
const FIRST_PITCH_LIMIT_DEG = 30;

/**
 * Aiming down the sights (aim spec §5): the first-person field of view per weapon, degrees. A
 * weapon missing here has no sights: fists and the bat never zoom.
 */
export const ADS_FOV_DEG: Readonly<Partial<Record<WeaponKind, number>>> = {
  pistol: 50,
  uzi: 50,
  shotgun: 50,
  rifle: 24,
  rocket: 45,
  cannon: 45,
};
/** The weapons that look through a scope rather than over iron sights. */
const SCOPED: ReadonlySet<WeaponKind> = new Set<WeaponKind>(["rifle"]);
/** How long the sights take to come up, or go down, seconds. */
export const ADS_EASE_S = 0.15;
/** Over the shoulder with the sights up the boom pulls in to this, metres … */
export const ADS_BACK_M = 1.9;
/** … and the view, like the chase camera's in a car, narrows to this, degrees. */
const THIRD_PERSON_ADS_FOV_DEG = 45;
/** The rifle's scope fades in over the last part of the ease, from this share of it on. */
const SCOPE_FROM_SHARE = 0.6;

/** Degrees to radians. */
function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Linear blend from `from` to `to` by `share`. */
function mix(from: number, to: number, share: number): number {
  return from + (to - from) * share;
}

/**
 * How far the sights are up after a frame: toward 1 while aiming a weapon that has sights, toward 0
 * otherwise, at a steady pace that covers the way in {@link ADS_EASE_S}.
 *
 * @param progress - How far they were up, 0 … 1.
 * @param aiming - Whether the player aims down the sights.
 * @param weapon - The weapon held.
 * @param dt - Seconds this frame.
 * @returns The new progress, 0 … 1.
 */
export function easeSights(
  progress: number,
  aiming: boolean,
  weapon: WeaponKind,
  dt: number,
): number {
  const target = aiming && ADS_FOV_DEG[weapon] !== undefined ? 1 : 0;
  const step = dt / ADS_EASE_S;
  return target > progress
    ? Math.min(target, progress + step)
    : Math.max(target, progress - step);
}

/**
 * The share of the sights pose a progress stands for: eased in and out (a smoothstep), so the
 * zoom and the hands start and settle gently.
 *
 * @param progress - From {@link easeSights}, 0 … 1.
 * @returns The share, 0 … 1.
 */
export function sightsShare(progress: number): number {
  const along = Math.min(1, Math.max(0, progress));
  return along * along * (3 - 2 * along);
}

/**
 * How opaque a scope is at a sights share: nothing until {@link SCOPE_FROM_SHARE}, then fading in
 * to fully up.
 *
 * @param share - The sights share, 0 … 1.
 * @returns The scope's opacity, 0 … 1.
 */
export function scopeShare(share: number): number {
  return Math.max(0, (share - SCOPE_FROM_SHARE) / (1 - SCOPE_FROM_SHARE));
}

/**
 * Whether a weapon looks through a scope when aimed: the rifle.
 *
 * @param weapon - The weapon.
 * @returns `true` for a scoped weapon.
 */
export function isScoped(weapon: WeaponKind): boolean {
  return SCOPED.has(weapon);
}

/** `tan(fov / 2)` over `tan(base / 2)`: how much a zoomed view narrows an unzoomed one. */
function zoomOf(fovDeg: number, baseDeg: number): number {
  if (fovDeg === baseDeg) return 1;
  return Math.tan(radians(fovDeg) / 2) / Math.tan(radians(baseDeg) / 2);
}

/** A field of view narrowed toward `aimedDeg` by the sights, and how much that zooms. */
function zoomed(
  input: RigInput,
  baseDeg: number,
  aimedDeg: number | undefined,
): { fovDeg: number; zoom: number } {
  const fovDeg = mix(baseDeg, aimedDeg ?? baseDeg, input.sights ?? 0);
  return { fovDeg, zoom: zoomOf(fovDeg, baseDeg) };
}

/**
 * The pitch range mouse-look may use in a camera mode: −35°…+40° over the shoulder, ±30° behind
 * the eyes (spec §6.3).
 *
 * @param mode - The camera mode.
 * @returns `[min, max]` in radians.
 */
export function pitchLimitsFor(mode: CameraMode): [number, number] {
  return mode === "third"
    ? [radians(THIRD_PITCH_MIN_DEG), radians(THIRD_PITCH_MAX_DEG)]
    : [radians(-FIRST_PITCH_LIMIT_DEG), radians(FIRST_PITCH_LIMIT_DEG)];
}

/**
 * A boom camera behind `target` at `yaw`, pushed `side` metres to the right, whose view converges
 * on the chest-height shot line {@link AIM_PROJECT_DISTANCE_M} ahead: at pitch 0 the crosshair
 * sits dead centre, and pitching up or down tilts the view, never the flat shot.
 */
function boomPose(
  input: RigInput,
  back: number,
  up: number,
  side: number,
  lens: { fovDeg: number; zoom: number },
): RigPose {
  const { yaw, pitch, target } = input;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const x = target.x - cos * back - sin * side;
  const y = target.y - sin * back + cos * side;
  const height = Math.max(
    MIN_CAMERA_HEIGHT_M,
    up - Math.sin(pitch) * back * BOOM_TILT,
  );
  const aimX = target.x + cos * AIM_PROJECT_DISTANCE_M;
  const aimY = target.y + sin * AIM_PROJECT_DISTANCE_M;
  const reach = Math.hypot(aimX - x, aimY - y);
  return {
    position: [x, height, y],
    lookAt: [aimX, PERSON_CHEST_HEIGHT_M + Math.tan(pitch) * reach, aimY],
    ...lens,
  };
}

/**
 * The eye in three.js space: over the player on foot, or in the kind's driver's seat — its offset
 * along the car and to its left (`(sin h, −cos h)` for heading `h`) from the cockpit table.
 */
function eyePosition(input: RigInput): Vector3Tuple {
  const { target, driving } = input;
  if (!driving) return [target.x, EYE_HEIGHT_M, target.y];
  const seat = seatOffset(driving.kind);
  const cos = Math.cos(driving.heading);
  const sin = Math.sin(driving.heading);
  return [
    target.x + cos * seat.forwardM + sin * seat.leftM,
    seat.heightM,
    target.y + sin * seat.forwardM - cos * seat.leftM,
  ];
}

/**
 * Behind the eyes: on foot at eye height over the player, in a car in the driver's seat; the
 * sights zoom to the weapon's own field of view.
 */
function firstPersonPose(input: RigInput): RigPose {
  const { yaw, pitch } = input;
  const position = eyePosition(input);
  const flat = Math.cos(pitch) * FIRST_PERSON_LOOK_M;
  const aimed = input.weapon ? ADS_FOV_DEG[input.weapon] : undefined;
  return {
    position,
    lookAt: [
      position[0] + Math.cos(yaw) * flat,
      position[1] + Math.sin(pitch) * FIRST_PERSON_LOOK_M,
      position[2] + Math.sin(yaw) * flat,
    ],
    ...zoomed(input, FIRST_PERSON_FOV_DEG, aimed),
  };
}

/** Rising over the body and slowly circling it, starting from behind where the player looked. */
function deathPose(input: RigInput): RigPose {
  const { yaw, target, deadSeconds } = input;
  const angle = yaw + Math.PI + deadSeconds * DEATH_ORBIT_RAD_PER_S;
  const rise = Math.min(DEATH_MAX_RISE_M, deadSeconds * DEATH_RISE_M_PER_S);
  return {
    position: [
      target.x + Math.cos(angle) * DEATH_ORBIT_RADIUS_M,
      DEATH_START_UP_M + rise,
      target.y + Math.sin(angle) * DEATH_ORBIT_RADIUS_M,
    ],
    lookAt: [target.x, BODY_HEIGHT_M, target.y],
    fovDeg: THIRD_PERSON_FOV_DEG,
    zoom: 1,
  };
}

/**
 * Places the camera for one frame (spec §6.3). Third person sits {@link THIRD_PERSON_BACK_M}
 * behind and {@link SHOULDER_M} right of the player; in a car the chase camera pulls back by the
 * vehicle's length ({@link CHASE_MIN_BACK_M}…{@link CHASE_MAX_BACK_M}); first person sits at eye
 * height, or in the driver's seat. Dead, both modes use the rising, orbiting death camera. With
 * the sights up (aim spec §5) the first-person view zooms to the weapon's {@link ADS_FOV_DEG},
 * the shoulder camera pulls in to {@link ADS_BACK_M} and narrows, and the chase camera narrows.
 *
 * @param input - Mode, yaw, pitch, the followed pose, the death clock and the sights.
 * @returns Where the camera stands, what it looks at, its field of view and zoom.
 */
export function rigPose(input: RigInput): RigPose {
  if (input.dead) return deathPose(input);
  if (input.mode === "first") return firstPersonPose(input);
  if (!input.driving)
    return boomPose(
      input,
      mix(THIRD_PERSON_BACK_M, ADS_BACK_M, input.sights ?? 0),
      THIRD_PERSON_UP_M,
      SHOULDER_M,
      zoomed(input, THIRD_PERSON_FOV_DEG, THIRD_PERSON_ADS_FOV_DEG),
    );
  const back = Math.min(
    CHASE_MAX_BACK_M,
    Math.max(CHASE_MIN_BACK_M, THIRD_PERSON_BACK_M + input.driving.length),
  );
  return boomPose(
    input,
    back,
    CHASE_UP_M,
    0,
    zoomed(input, CHASE_FOV_DEG, THIRD_PERSON_ADS_FOV_DEG),
  );
}

/**
 * Moves a three.js camera to a rig pose, updating its projection only when the field of view
 * changed.
 *
 * @param camera - The camera to place.
 * @param pose - The pose from {@link rigPose}.
 */
export function applyRigPose(camera: PerspectiveCamera, pose: RigPose): void {
  camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
  camera.lookAt(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2]);
  if (camera.fov === pose.fovDeg) return;
  camera.fov = pose.fovDeg;
  camera.updateProjectionMatrix();
}
