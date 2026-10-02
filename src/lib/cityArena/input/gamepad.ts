import { clampToUnit } from "./inputState";
import type { WorldInput } from "../sim/types";

/** Standard controller dead zone suppresses stick drift while preserving full travel. */
export const GAMEPAD_DEAD_ZONE = 0.18;

function stick(x = 0, y = 0): [number, number] {
  const length = Math.hypot(x, y);
  if (length <= GAMEPAD_DEAD_ZONE) return [0, 0];
  const strength = Math.min(
    1,
    (length - GAMEPAD_DEAD_ZONE) / (1 - GAMEPAD_DEAD_ZONE),
  );
  return clampToUnit([(x / length) * strength, (y / length) * strength]);
}

/** Merges a standard pad with touch/keyboard input; disconnects never retain held controls. */
export function withGamepad(
  input: WorldInput,
  pad: Pick<Gamepad, "axes" | "buttons" | "connected" | "mapping"> | null,
): WorldInput {
  if (!pad?.connected || pad.mapping !== "standard") return input;
  const move = stick(pad.axes[0], pad.axes[1]);
  const aim = stick(pad.axes[2], pad.axes[3]);
  const pressed = (index: number): boolean =>
    (pad.buttons[index]?.value ?? 0) > 0.5;
  const moving = move[0] !== 0 || move[1] !== 0;
  const aiming = aim[0] !== 0 || aim[1] !== 0;
  return {
    ...input,
    move: moving ? move : input.move,
    moveIsAnalog: moving || input.moveIsAnalog,
    aim: aiming ? Math.atan2(aim[1], aim[0]) : input.aim,
    fire: input.fire || pressed(7) || pressed(0),
    enter: input.enter || pressed(1),
    weaponNext: input.weaponNext || pressed(3) || pressed(5),
  };
}

/** Reads the first standard gamepad exposed after a browser user gesture. */
export function readArenaGamepad(input: WorldInput): WorldInput {
  if (
    typeof navigator === "undefined" ||
    !navigator.getGamepads ||
    document.hidden
  )
    return input;
  const pad =
    [...navigator.getGamepads()].find(
      (candidate) => candidate?.connected && candidate.mapping === "standard",
    ) ?? null;
  return withGamepad(input, pad);
}
