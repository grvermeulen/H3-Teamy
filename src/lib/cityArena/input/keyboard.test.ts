import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInputState } from "./inputState";
import { attachKeyboard } from "./keyboard";

function press(code: string, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
}

function release(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keyup", { code }));
}

describe("attachKeyboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps WASD and arrows to a movement vector and releases on keyup", () => {
    const state = createInputState();
    const detach = attachKeyboard(window, state);
    press("KeyD");
    press("ArrowUp");
    expect(state.snapshot().move[0]).toBeCloseTo(Math.SQRT1_2);
    expect(state.snapshot().move[1]).toBeCloseTo(-Math.SQRT1_2);
    release("KeyD");
    expect(state.snapshot().move).toEqual([0, -1]);
    detach();
    press("KeyA");
    expect(state.snapshot().move).toEqual([0, -1]);
  });

  it("holds Space as fire, E/F/Enter as enter and Q as weapon", () => {
    const state = createInputState();
    const detach = attachKeyboard(window, state);
    press("Space");
    press("KeyE");
    press("KeyQ");
    expect(state.snapshot()).toMatchObject({
      fire: true,
      enter: true,
      weaponNext: true,
    });
    release("Space");
    release("KeyE");
    expect(state.snapshot()).toMatchObject({
      fire: false,
      enter: false,
      weaponNext: true,
    });
    press("KeyF");
    expect(state.snapshot().enter).toBe(true);
    release("KeyF");
    release("KeyQ");
    press("Enter");
    expect(state.snapshot().enter).toBe(true);
    detach();
  });

  it("ignores keys typed into form fields or pressed on a focused button, and resets on blur", () => {
    const state = createInputState();
    const detach = attachKeyboard(window, state);
    const input = document.createElement("input");
    const button = document.createElement("button");
    document.body.append(input, button);
    press("KeyW", input);
    press("Space", button);
    expect(state.snapshot()).toMatchObject({ move: [0, 0], fire: false });
    press("KeyW");
    press("Space");
    expect(state.snapshot()).toMatchObject({ move: [0, -1], fire: true });
    window.dispatchEvent(new Event("blur"));
    expect(state.snapshot()).toMatchObject({ move: [0, 0], fire: false });
    detach();
    input.remove();
    button.remove();
  });
});
