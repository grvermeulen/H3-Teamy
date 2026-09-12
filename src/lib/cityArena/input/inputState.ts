import { EMPTY_INPUT, type WorldInput } from "../sim/types";

/** Scales a vector down to unit length when it is longer. */
export function clampToUnit(vector: [number, number]): [number, number] {
  const length = Math.hypot(vector[0], vector[1]);
  if (length <= 1) return [vector[0], vector[1]];
  return [vector[0] / length, vector[1] / length];
}

/** Buttons a device can hold down. */
export type ButtonName = "fire" | "enter" | "weaponNext";

/** Where a button press comes from (keys, the mouse, or the on-screen buttons); the sources are OR-ed together. */
export type InputSource = "keyboard" | "pointer" | "buttons";

/** Held state of the three buttons. */
export type ButtonState = Record<ButtonName, boolean>;

/**
 * Merges keyboard movement, the floating stick, held buttons and the aim into one
 * {@link WorldInput}; the stick wins over keyboard movement while a finger is down.
 * `moveIsAnalog` on the snapshot tracks which source last *moved* the player, not whether a
 * finger is on the glass right now: a stick vector (even a centred one) sets it, and only a
 * keyboard movement clears it. Releasing the stick (`setStick(null)`) therefore keeps the analog
 * mapping active with a zero-magnitude vector, so `driveStep` ramps the steer command back to
 * centre instead of snapping it to the keyboard's digital mapping in a single tick.
 */
export type InputState = {
  setKeyboard(vector: [number, number]): void;
  setStick(vector: [number, number] | null): void;
  setButton(source: InputSource, name: ButtonName, pressed: boolean): void;
  setAim(angle: number | null): void;
  /** Aim from the touch aim stick; while it is held it wins over the mouse. */
  setStickAim(angle: number | null): void;
  clearKeyboard(): void;
  snapshot(): WorldInput;
};

const RELEASED: ButtonState = { fire: false, enter: false, weaponNext: false };

/** Creates an empty input state. */
export function createInputState(): InputState {
  let keyboard: [number, number] = [0, 0];
  let stick: [number, number] | null = null;
  // Which source last moved the player, independent of whether a finger is down right now (see
  // the `InputState` doc comment above) — a released stick must keep taking the analog path.
  let stickIsSource = false;
  let aim: number | null = null;
  let stickAim: number | null = null;
  const buttons: Record<InputSource, ButtonState> = {
    keyboard: { ...RELEASED },
    pointer: { ...RELEASED },
    buttons: { ...RELEASED },
  };
  const held = (name: ButtonName): boolean =>
    buttons.keyboard[name] || buttons.pointer[name] || buttons.buttons[name];
  /** The vector of whichever source currently owns movement, so it always agrees with `moveIsAnalog`. */
  const movement = (): [number, number] => {
    if (!stickIsSource) return keyboard;
    return stick ?? [0, 0];
  };
  return {
    setKeyboard(vector) {
      keyboard = vector;
      stickIsSource = false;
    },
    setStick(vector) {
      stick = vector;
      if (vector !== null) stickIsSource = true;
      else if (keyboard[0] !== 0 || keyboard[1] !== 0) stickIsSource = false;
    },
    setButton(source, name, pressed) {
      buttons[source] = { ...buttons[source], [name]: pressed };
    },
    setAim(angle) {
      aim = angle;
    },
    setStickAim(angle) {
      stickAim = angle;
    },
    clearKeyboard() {
      keyboard = [0, 0];
      buttons.keyboard = { ...RELEASED };
    },
    snapshot: () => ({
      ...EMPTY_INPUT,
      move: clampToUnit(movement()),
      moveIsAnalog: stickIsSource,
      aim: stickAim ?? aim,
      fire: held("fire"),
      enter: held("enter"),
      weaponNext: held("weaponNext"),
    }),
  };
}
