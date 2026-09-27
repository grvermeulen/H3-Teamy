/**
 * The 2D view's screen shake and drunk sway, carried over to the 3D camera (spec §6.8: the shake
 * comes from the existing feedback state). The scene hands both over in 2D terms — a shake in
 * screen pixels, a drunkenness the 2D view turns into a tilt — so this maps them to a small
 * camera-space nudge and a roll about the view axis, applied after the rig has placed the camera.
 */
import type { PerspectiveCamera } from "three";
import { drunkSway, type Scene } from "../render/renderScene";

/**
 * Metres the camera moves per pixel of 2D screen shake: an explosion's 10 px jolt nudges it about
 * 0.2 m, enough to feel without losing the crosshair.
 */
export const SHAKE_METRES_PER_PX = 0.02;

/** The camera-space nudge and roll for one frame. */
export type CameraFeel = {
  /** Metres along the camera's own right axis. */
  right: number;
  /** Metres along the camera's own up axis. */
  up: number;
  /** Radians about the view axis; positive tilts the world clockwise, as the 2D sway does. */
  roll: number;
};

/** No nudge and no roll. */
const STEADY: CameraFeel = { right: 0, up: 0, roll: 0 };

/**
 * The frame's camera nudge and roll from its scene. The 2D view shakes the world by
 * `scene.shake` pixels, so the camera moves the opposite way (screen y points down, camera up
 * points up); it rolls by the drunk sway's tilt. Reduced motion keeps the camera steady.
 *
 * @param scene - The frame's shake, drunkenness, tick and motion preference.
 * @returns The nudge and roll to apply after the rig pose.
 */
export function cameraFeelOf(
  scene: Pick<Scene, "shake" | "drunk" | "tick" | "reducedMotion">,
): CameraFeel {
  if (scene.reducedMotion) return STEADY;
  const shake = scene.shake ?? { x: 0, y: 0 };
  return {
    right: -shake.x * SHAKE_METRES_PER_PX,
    up: shake.y * SHAKE_METRES_PER_PX,
    roll: drunkSway(scene.drunk ?? 0, scene.tick).tilt,
  };
}

/**
 * Nudges and rolls a camera the rig has just placed; the rig sets the pose afresh every frame, so
 * the offsets never accumulate.
 *
 * @param camera - The placed camera.
 * @param feel - From {@link cameraFeelOf}.
 */
export function applyCameraFeel(
  camera: PerspectiveCamera,
  feel: CameraFeel,
): void {
  if (feel.right === 0 && feel.up === 0 && feel.roll === 0) return;
  camera.translateX(feel.right);
  camera.translateY(feel.up);
  // Rolling the camera anticlockwise turns the world it sees clockwise.
  camera.rotateZ(feel.roll);
}
