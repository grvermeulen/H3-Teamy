/**
 * The hot-path wire primitives and the input frame (spec §6.3).
 *
 * Inputs and snapshots travel as flat integer arrays, not objects, because a snapshot goes out ten
 * times a second to as many as eight clients. Everything here is an integer: positions are
 * decimetres, angles are 1/256 of a turn, and a missing value is a sentinel rather than `null`, so
 * a frame never carries a key or a float. The snapshot half lives in `snapshotWire.ts`, which
 * builds on the scales and helpers exported here.
 */

import type { WorldInput } from "../sim/types";

/** Move components travel as hundredths, so the frame stays integers. */
export const MOVE_SCALE = 100;
/** Angles travel as 1/256 of a turn (spec §6.3). */
const ANGLE_STEPS = 256;
/** Positions and speeds travel as decimetres. */
export const POSITION_SCALE = 10;
/** Steering (−1..1) travels as hundredths. */
export const STEER_SCALE = 100;
/** No aim this tick. */
const NO_AIM = -1;
/** Stands in for `null` in an integer field: no car, not dead, not taken. */
export const NONE = -1;
/** A whole turn in radians, the unit angles are converted from. */
const TURN_RAD = Math.PI * 2;

/** Button bits in an input frame. `moveIsAnalog` extends spec §6.3, which predates the field. */
const FLAG_FIRE = 1;
const FLAG_ENTER = 2;
const FLAG_WEAPON_NEXT = 4;
const FLAG_MOVE_ANALOG = 8;

/** One input as it travels: `[seq, moveX, moveY, aim, flags]`. */
export type InputFrame = number[];

/**
 * Rounds `value` onto `scale` as an integer, clamped to ±`limit`.
 *
 * @param value - The value to quantise.
 * @param scale - What to multiply by before rounding.
 * @param limit - The largest magnitude the field may carry.
 * @returns The integer to put on the wire.
 */
export function quantise(value: number, scale: number, limit: number): number {
  const scaled = Math.round(value * scale);
  return Math.max(-limit, Math.min(limit, scaled));
}

/**
 * Packs an angle as 1/256 of a turn.
 *
 * @param radians - The angle, which may be any real number.
 * @returns An integer 0..255.
 */
export function packAngle(radians: number): number {
  const turns = radians / TURN_RAD;
  const steps = Math.round(turns * ANGLE_STEPS);
  return ((steps % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
}

/**
 * Unpacks an angle.
 *
 * @param packed - An integer 0..255.
 * @returns The angle in radians.
 */
export function unpackAngle(packed: number): number {
  return (packed / ANGLE_STEPS) * TURN_RAD;
}

/**
 * Encodes `null` as {@link NONE}, so the field stays an integer.
 *
 * @param value - The number or `null`.
 * @returns The number, or `NONE`.
 */
export function packOptional(value: number | null): number {
  return value ?? NONE;
}

/**
 * Decodes {@link NONE} back to `null`.
 *
 * @param value - The integer from the wire.
 * @returns The number, or `null`.
 */
export function unpackOptional(value: number): number | null {
  return value === NONE ? null : value;
}

/**
 * The index of `value` in `table`, for enums that travel as a number.
 *
 * @param table - The wire order of the enum.
 * @param value - The value to look up.
 * @returns Its index, or 0 when it is not in the table.
 */
export function indexIn<T>(table: readonly T[], value: T): number {
  const at = table.indexOf(value);
  return at < 0 ? 0 : at;
}

/**
 * The entry of `table` at `index`, tolerating a value from a newer peer.
 *
 * @param table - The wire order of the enum.
 * @param index - The index from the wire.
 * @returns The entry, or the table's first entry when the index is out of range.
 */
export function entryAt<T>(table: readonly T[], index: number): T {
  return table[index] ?? table[0]!;
}

/**
 * Encodes one player input for the wire.
 *
 * @param seq - This client's monotonically increasing input sequence number.
 * @param input - The input to send.
 * @returns `[seq, moveX, moveY, aim, flags]`, all integers.
 */
export function encodeInput(seq: number, input: WorldInput): InputFrame {
  const flags =
    (input.fire ? FLAG_FIRE : 0) |
    (input.enter ? FLAG_ENTER : 0) |
    (input.weaponNext ? FLAG_WEAPON_NEXT : 0) |
    (input.moveIsAnalog ? FLAG_MOVE_ANALOG : 0);
  return [
    seq,
    quantise(input.move[0], MOVE_SCALE, MOVE_SCALE),
    quantise(input.move[1], MOVE_SCALE, MOVE_SCALE),
    input.aim === null ? NO_AIM : packAngle(input.aim),
    flags,
  ];
}

/**
 * Decodes one input frame.
 *
 * @param frame - A frame produced by {@link encodeInput}.
 * @returns The sequence number and the input it carried.
 */
/**
 * A frame element as an integer inside `[min, max]`, or `fallback` when it is not a finite number.
 *
 * Frames come from other clients. One that sends `NaN` for a move component would otherwise put
 * `NaN` into the shared world's positions, and every collision test after that is undefined.
 */
function safeInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function decodeInput(frame: InputFrame): {
  seq: number;
  input: WorldInput;
} {
  const [seq = 0, moveX = 0, moveY = 0, aim = NO_AIM, flags = 0] = frame;
  const packedAim =
    aim === NO_AIM ? NO_AIM : safeInt(aim, 0, ANGLE_STEPS - 1, NO_AIM);
  return {
    seq: safeInt(seq, 0, Number.MAX_SAFE_INTEGER, 0),
    input: {
      move: [
        safeInt(moveX, -MOVE_SCALE, MOVE_SCALE, 0) / MOVE_SCALE,
        safeInt(moveY, -MOVE_SCALE, MOVE_SCALE, 0) / MOVE_SCALE,
      ],
      moveIsAnalog: (flags & FLAG_MOVE_ANALOG) !== 0,
      aim: packedAim === NO_AIM ? null : unpackAngle(packedAim),
      fire: (flags & FLAG_FIRE) !== 0,
      enter: (flags & FLAG_ENTER) !== 0,
      weaponNext: (flags & FLAG_WEAPON_NEXT) !== 0,
    },
  };
}
