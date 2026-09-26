/**
 * The one mapping between the simulation's flat world and three.js space.
 *
 * The simulation measures metres with x east and y south, and angles as `atan2(dy, dx)`. three.js
 * has Y up, so world `(x, y)` lands on three's `(x, height, y)`: seen from above with the camera's
 * top toward −z, the 3D city lies exactly as the 2D map does, with no mirror to undo.
 */
import type { Vector3, Vector3Tuple } from "three";

/** Height above the ground at which the flat simulation's bullets travel, metres. */
export const PERSON_CHEST_HEIGHT_M = 1.3;

/** Eye height of a standing person, metres — the first-person camera sits here. */
export const EYE_HEIGHT_M = 1.65;

/**
 * The crosshair marks where the in-plane shot line is this many metres ahead, and the
 * third-person view converges there (spec §6.3).
 */
export const AIM_PROJECT_DISTANCE_M = 25;

/**
 * A world point in three.js coordinates.
 *
 * @param x - Metres east.
 * @param y - Metres south.
 * @param height - Metres above the ground.
 * @returns `[x, height, y]`.
 */
export function worldToThree(x: number, y: number, height = 0): Vector3Tuple {
  return [x, height, y];
}

/**
 * Moves a three.js position to a world point in place — {@link worldToThree} without the new
 * tuple, for code that places objects every frame.
 *
 * @param target - The position to overwrite, e.g. an `Object3D`'s `position`.
 * @param x - Metres east.
 * @param y - Metres south.
 * @param height - Metres above the ground.
 */
export function setWorldPosition(
  target: Pick<Vector3, "set">,
  x: number,
  y: number,
  height = 0,
): void {
  target.set(x, height, y);
}

/**
 * The `rotation.y` that turns an object whose local forward is +X to face a world heading.
 *
 * Rotating +X about +Y by θ gives `(cos θ, 0, −sin θ)`, and a heading `h` points along
 * `(cos h, 0, sin h)` in three's space, so θ = −h.
 *
 * @param heading - World heading in radians.
 * @returns The Y rotation in radians.
 */
export function headingToRotationY(heading: number): number {
  return -heading;
}

/**
 * The unit view direction for a camera yaw (a world heading) and pitch (up positive).
 *
 * @param yaw - World heading the camera faces, radians.
 * @param pitch - Radians above the horizon.
 * @returns A unit vector in three.js space.
 */
export function directionFromYawPitch(
  yaw: number,
  pitch: number,
): Vector3Tuple {
  const flat = Math.cos(pitch);
  return [Math.cos(yaw) * flat, Math.sin(pitch), Math.sin(yaw) * flat];
}

/**
 * The world heading of a horizontal three.js direction.
 *
 * @param dx - The direction's x component.
 * @param dz - The direction's z component (world y).
 * @returns The heading in radians.
 */
export function yawFromThreeDirection(dx: number, dz: number): number {
  return Math.atan2(dz, dx);
}
