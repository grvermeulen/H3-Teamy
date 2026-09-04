import { EMPTY_INPUT, type WorldInput } from "../sim/types";

/** Scales a vector down to unit length when it is longer. */
export function clampToUnit(vector: [number, number]): [number, number] {
  const length = Math.hypot(vector[0], vector[1]);
  if (length <= 1) return [vector[0], vector[1]];
  return [vector[0] / length, vector[1] / length];
}

/** Buttons a device can hold down. */
export type ButtonName = "fire" | "enter" | "weaponNext";

/** Where a button press comes from; both sources are OR-ed together. */
export type InputSource = "keyboard" | "pointer";

/** Held state of the three buttons. */
export type ButtonState = Record<ButtonName, boolean>;

/**
 * Merges keyboard movement, the floating stick, held buttons and the aim into one
 * {@link WorldInput}; the stick wins over keyboard movement while a finger is down.
 */
export type InputState = {
  setKeyboard(vector: [number, number]): void;
  setStick(vector: [number, number] | null): void;
  setButton(source: InputSource, name: ButtonName, pressed: boolean): void;
  setAim(angle: number | null): void;
  clearKeyboard(): void;
  snapshot(): WorldInput;
};

const RELEASED: ButtonState = { fire: false, enter: false, weaponNext: false };

/** Creates an empty input state. */
export function createInputState(): InputState {
  let keyboard: [number, number] = [0, 0];
  let stick: [number, number] | null = null;
  let aim: number | null = null;
  const buttons: Record<InputSource, ButtonState> = {
    keyboard: { ...RELEASED },
    pointer: { ...RELEASED },
  };
  const held = (name: ButtonName): boolean =>
    buttons.keyboard[name] || buttons.pointer[name];
  return {
    setKeyboard(vector) {
      keyboard = vector;
    },
    setStick(vector) {
      stick = vector;
    },
    setButton(source, name, pressed) {
      buttons[source] = { ...buttons[source], [name]: pressed };
    },
    setAim(angle) {
      aim = angle;
    },
    clearKeyboard() {
      keyboard = [0, 0];
      buttons.keyboard = { ...RELEASED };
    },
    snapshot: () => ({
      ...EMPTY_INPUT,
      move: clampToUnit(stick ?? keyboard),
      aim,
      fire: held("fire"),
      enter: held("enter"),
      weaponNext: held("weaponNext"),
    }),
  };
}
