import type { ButtonName, InputState } from "./inputState";
import type { WeaponSlot } from "./weaponSelect";

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

/** The number keys that pick a weapon directly (spec §7). */
const SLOT_KEYS: Partial<Record<string, WeaponSlot>> = {
  Digit1: 1,
  Digit2: 2,
  Digit3: 3,
};

/** The keys beyond movement and the held buttons, and who owns the keyboard. */
export type KeyboardHooks = {
  /** Tab held shows the scorebord; released, it hides it. */
  onScoreboard?: (held: boolean) => void;
  /** 1, 2 and 3 pick a weapon directly. */
  onWeaponSlot?: (slot: WeaponSlot) => void;
  /** True while a menu owns the keyboard: game keys are ignored until it is closed. */
  isSuspended?: () => boolean;
};

/** The subset of the canvas the wheel binding needs (injectable in tests). */
export type WheelTarget = Pick<
  HTMLElement,
  "addEventListener" | "removeEventListener"
>;

/** Wheel travel that counts as one notch; a trackpad reports many small deltas per flick. */
const WHEEL_STEP_PX = 40;

/**
 * Tab, held, is the scorebord (spec §7). Bound in the capture phase on the window and stopped
 * there, so the dialog's focus trap — which listens on the document — never moves focus off the
 * game while Tab means "scorebord".
 */
function bindPanelKeys(
  target: KeyboardTarget,
  hooks: KeyboardHooks,
): () => void {
  const onDown = (event: KeyboardEvent): void => {
    if (event.code !== "Tab" || isTypingTarget(event.target)) return;
    if (hooks.isSuspended?.()) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) hooks.onScoreboard?.(true);
  };
  const onUp = (event: KeyboardEvent): void => {
    if (event.code === "Tab") hooks.onScoreboard?.(false);
  };
  const onBlur = (): void => hooks.onScoreboard?.(false);
  target.addEventListener("keydown", onDown, true);
  target.addEventListener("keyup", onUp, true);
  target.addEventListener("blur", onBlur);
  return () => {
    target.removeEventListener("keydown", onDown, true);
    target.removeEventListener("keyup", onUp, true);
    target.removeEventListener("blur", onBlur);
  };
}

/**
 * Binds the mouse wheel over the canvas to cycling the weapon (spec §7); returns the detach
 * function. Travel is summed so a trackpad flick is one notch, not twenty.
 */
export function attachWheel(
  target: WheelTarget,
  onCycle: () => void,
): () => void {
  let travelled = 0;
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    travelled += Math.abs(event.deltaY);
    if (travelled < WHEEL_STEP_PX) return;
    travelled = 0;
    onCycle();
  };
  target.addEventListener("wheel", onWheel, { passive: false });
  return () => target.removeEventListener("wheel", onWheel);
}

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

/**
 * Binds WASD/arrows, the Space/E/F/Enter/Q buttons, 1/2/3 and Tab to the input state and the
 * hooks; returns the detach function.
 */
export function attachKeyboard(
  target: KeyboardTarget,
  state: InputState,
  onUserGesture?: () => void,
  hooks: KeyboardHooks = {},
): () => void {
  const pressed = new Set<string>();
  const pressedButtons = new Set<string>();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target) || hooks.isSuspended?.()) return;
    const slot = SLOT_KEYS[event.code];
    if (slot) {
      event.preventDefault();
      if (event.repeat) return;
      onUserGesture?.();
      hooks.onWeaponSlot?.(slot);
      return;
    }
    if (KEY_VECTORS[event.code]) {
      if (event.code.startsWith("Arrow")) event.preventDefault();
      onUserGesture?.();
      pressed.add(event.code);
      state.setKeyboard(movementVector(pressed));
      return;
    }
    const button = KEY_BUTTONS[event.code];
    if (!button || event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    onUserGesture?.();
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
  const detachPanels = bindPanelKeys(target, hooks);
  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);
  return () => {
    detachPanels();
    state.clearKeyboard();
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
    target.removeEventListener("blur", onBlur);
  };
}
