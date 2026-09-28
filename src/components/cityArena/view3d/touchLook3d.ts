"use client";
/**
 * The touch look pad in the 3D frame (spec §6): its turn since the last frame goes onto the
 * camera — the yaw onto mouse-look's, the pitch as a tilt on top of it — and the frame's pitch
 * includes that tilt.
 */
import { tiltedPitch, turnTouchCamera } from "@/lib/cityArena/input/touchLook";
import type { Runtime3d } from "./frame3d";

/**
 * Turns the 3D camera by what the look pad added up since the last frame.
 *
 * @param runtime - The 3D runtime; mouse-look's yaw and the pad's tilt are updated.
 * @returns The yaw the pad turned, radians (0 without a pad), so the car camera counts it as a
 * look like a mouse turn.
 */
export function applyTouchLook(runtime: Runtime3d): number {
  const camera = runtime.touchCamera;
  if (!camera) return 0;
  return turnTouchCamera(camera, runtime.look, () => 1);
}

/**
 * The camera pitch for a 3D frame: mouse-look's, tilted by the look pad within the mode's range.
 *
 * @param runtime - The 3D runtime.
 * @returns Radians above the horizon.
 */
export function lookPitch(runtime: Runtime3d): number {
  const base = runtime.look.pitch();
  return runtime.touchCamera ? tiltedPitch(runtime.touchCamera, base) : base;
}

/**
 * True once the look pad has turned the camera since the view started: from then on the camera
 * is the player's to turn, and a lone movement stick no longer swings it toward the walk.
 *
 * @param runtime - The 3D runtime.
 * @returns Whether the pad has taken over looking.
 */
export function lookPadEngaged(runtime: Runtime3d): boolean {
  return runtime.touchCamera?.engaged ?? false;
}
