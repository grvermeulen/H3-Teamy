import type { InputState } from "./inputState";

/** The subset of `window` the keyboard binding needs (injectable in tests). */
export type KeyboardTarget = Pick<
  Window,
  "addEventListener" | "removeEventListener"
>;

const KEY_VECTORS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/** Binds WASD/arrow keys to the input state; returns the detach function. */
export function attachKeyboard(
  target: KeyboardTarget,
  state: InputState,
): () => void {
  const pressed = new Set<string>();
  const publish = (): void => {
    let x = 0;
    let y = 0;
    for (const code of pressed) {
      const [dx, dy] = KEY_VECTORS[code];
      x += dx;
      y += dy;
    }
    state.setKeyboard([Math.sign(x), Math.sign(y)]);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.code in KEY_VECTORS) || isTypingTarget(event.target)) return;
    if (event.code.startsWith("Arrow")) event.preventDefault();
    pressed.add(event.code);
    publish();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (!pressed.delete(event.code)) return;
    publish();
  };
  const onBlur = (): void => {
    pressed.clear();
    publish();
  };
  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);
  return () => {
    // Publish a zero vector before detaching: a still-held direction key's `keyup` will never
    // reach this binding again, and `useArenaGame.ts` reuses the same `InputState` across a
    // fresh `attachKeyboard`, so a stale non-zero vector would otherwise walk the player forever.
    pressed.clear();
    publish();
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
    target.removeEventListener("blur", onBlur);
  };
}
