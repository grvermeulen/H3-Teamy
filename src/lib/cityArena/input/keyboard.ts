import type { ButtonName, InputState } from "./inputState";

/** The subset of `window` the keyboard binding needs (injectable in tests). */
export type KeyboardTarget = Pick<
  Window,
  "addEventListener" | "removeEventListener"
>;

/** Movement keys (WASD and arrows) and their unit vectors. */
const KEY_VECTORS: Partial<Record<string, [number, number]>> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/** Held buttons by key code (spec §7): Space fires, E/F/Enter enter or leave a car, Q cycles the weapon. */
const KEY_BUTTONS: Partial<Record<string, ButtonName>> = {
  Space: "fire",
  KeyE: "enter",
  KeyF: "enter",
  Enter: "enter",
  KeyQ: "weaponNext",
};

/** True for editable targets whose keystrokes must not steer the game. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/** Sum of the held movement keys, one unit per axis at most. */
function movementVector(pressed: Set<string>): [number, number] {
  let x = 0;
  let y = 0;
  for (const code of pressed) {
    const vector = KEY_VECTORS[code];
    if (!vector) continue;
    x += vector[0];
    y += vector[1];
  }
  return [Math.sign(x), Math.sign(y)];
}

/** Every button a key maps to; releases are published for each so no button sticks. */
const BOUND_BUTTONS: readonly ButtonName[] = ["fire", "enter", "weaponNext"];

/** Publishes each button as held while any of its key codes (E/F/Enter share "enter") is still down. */
function publishButtons(pressedButtons: Set<string>, state: InputState): void {
  const held = new Set<ButtonName>();
  for (const code of pressedButtons) {
    const button = KEY_BUTTONS[code];
    if (button) held.add(button);
  }
  for (const button of BOUND_BUTTONS) {
    state.setButton("keyboard", button, held.has(button));
  }
}

/** Binds WASD/arrows and the Space/E/F/Enter/Q buttons to the input state; returns the detach function. */
export function attachKeyboard(
  target: KeyboardTarget,
  state: InputState,
): () => void {
  const pressed = new Set<string>();
  const pressedButtons = new Set<string>();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) return;
    if (KEY_VECTORS[event.code]) {
      if (event.code.startsWith("Arrow")) event.preventDefault();
      pressed.add(event.code);
      state.setKeyboard(movementVector(pressed));
      return;
    }
    const button = KEY_BUTTONS[event.code];
    if (!button || event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    pressedButtons.add(event.code);
    publishButtons(pressedButtons, state);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (pressed.delete(event.code)) {
      state.setKeyboard(movementVector(pressed));
      return;
    }
    if (pressedButtons.delete(event.code)) {
      publishButtons(pressedButtons, state);
    }
  };
  const onBlur = (): void => {
    pressed.clear();
    pressedButtons.clear();
    state.clearKeyboard();
  };
  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);
  return () => {
    state.clearKeyboard();
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
    target.removeEventListener("blur", onBlur);
  };
}
