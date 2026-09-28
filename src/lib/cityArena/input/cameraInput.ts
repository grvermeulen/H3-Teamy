import type { WorldInput } from "../sim/types";

/**
 * Rotates a screen-space vector (`sy = -1` is "up"/forward, `sx = 1` is "right") into the
 * camera's frame at `yaw`: forward `f = (cos yaw, sin yaw)`, right `r = (-sin yaw, cos yaw)`,
 * `move = f·(−sy) + r·sx` (spec §6.4).
 */
function rotateToYaw(
  [sx, sy]: [number, number],
  yaw: number,
): [number, number] {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const x = cos * -sy + -sin * sx;
  const y = sin * -sy + cos * sx;
  // A cardinal direction at a cardinal yaw multiplies by exactly 0 somewhere in the sum above,
  // which can land on -0; +0 keeps the sign from surprising `toEqual` or a downstream renderer.
  return [x + 0, y + 0];
}

/**
 * Rotates a `WorldInput`'s movement into the camera's frame for the 3D view (spec §6.4): on
 * foot, and for the analog stick in a car, "forward" always means "along the camera"; a
 * keyboard driving a car keeps its tank steering (W gas, A/D steer) untouched. The flat sim's
 * `aim` angle — normally the direction from the player to the mouse on the 2D canvas — is
 * replaced by `aimYaw`, the camera's own look direction, since 3D has no such canvas point.
 *
 * @param input - The raw per-tick input from the keyboard or a stick, otherwise unchanged.
 * @param yaw - The camera's yaw in radians, `0` along world +x.
 * @param driving - Whether the player is currently in a vehicle.
 * @param aimYaw - The camera's look yaw to aim and shoot with, or `null` when there is none.
 * @returns A copy of `input` with `move` rotated (unless tank steering applies) and `aim` set
 * to `aimYaw`.
 */
export function cameraRelativeInput(
  input: WorldInput,
  yaw: number,
  driving: boolean,
  aimYaw: number | null,
): WorldInput {
  const tankSteering = driving && !input.moveIsAnalog;
  return {
    ...input,
    move: tankSteering ? input.move : rotateToYaw(input.move, yaw),
    aim: aimYaw,
  };
}
