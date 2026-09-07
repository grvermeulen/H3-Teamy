import { beforeEach, describe, expect, it, vi } from "vitest";
import { driveStep } from "../sim/driveInput";
import { createInputState } from "./inputState";
import { attachKeyboard } from "./keyboard";

const step = 1 / 30;

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
    expect(state.snapshot().move).toEqual([0, 0]); // detach resets the keyboard vector
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

  it("notifies a user gesture before keyboard input reaches the simulation", () => {
    const state = createInputState();
    const unlock = vi.fn();
    const detach = attachKeyboard(window, state, unlock);
    press("KeyW");
    expect(unlock).toHaveBeenCalledTimes(1);
    detach();
  });

  it("keeps button held while any of its key aliases is pressed", () => {
    const state = createInputState();
    const detach = attachKeyboard(window, state);
    press("KeyE");
    press("KeyF");
    expect(state.snapshot().enter).toBe(true);
    release("KeyE");
    expect(state.snapshot().enter).toBe(true); // Still held by KeyF
    release("KeyF");
    expect(state.snapshot().enter).toBe(false);
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

  it("keeps tank steering instant even right after the touch stick was released", () => {
    const state = createInputState();
    state.setStick([0, 1]); // the player had been steering with the touch stick
    state.setStick(null); // ...then lifted the finger
    expect(state.snapshot().moveIsAnalog).toBe(true);
    const detach = attachKeyboard(window, state);
    press("KeyD");
    const snapshot = state.snapshot();
    expect(snapshot.moveIsAnalog).toBe(false);
    // previousSteer is still 0.9 from the touch turn a moment ago; tank steering must snap to
    // the digital command in one tick regardless, never ramping the way the analog path does.
    expect(driveStep(snapshot, 0, 0.9, step).steer).toBe(1);
    release("KeyD");
    detach();
  });
});
