import type { WorldInput } from "../sim/types";

/** Scales a vector down to unit length when it is longer. */
export function clampToUnit(vector: [number, number]): [number, number] {
  const length = Math.hypot(vector[0], vector[1]);
  if (length <= 1) return [vector[0], vector[1]];
  return [vector[0] / length, vector[1] / length];
}

/** Merges keyboard and stick input; the stick wins while a finger is down. */
export type InputState = {
  setKeyboard(vector: [number, number]): void;
  setStick(vector: [number, number] | null): void;
  snapshot(): WorldInput;
};

/** Creates an empty input state. */
export function createInputState(): InputState {
  let keyboard: [number, number] = [0, 0];
  let stick: [number, number] | null = null;
  return {
    setKeyboard(vector) {
      keyboard = vector;
    },
    setStick(vector) {
      stick = vector;
    },
    snapshot: () => ({ move: clampToUnit(stick ?? keyboard) }),
  };
}
