import { beforeEach, describe, expect, it, vi } from "vitest";
import { driveStep } from "../sim/driveInput";
import { createInputState } from "./inputState";
import { attachKeyboard, attachWheel } from "./keyboard";

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

describe("attachKeyboard panels and slots", () => {
  it("holds Tab as the scorebord, keeps it from the focus trap, and lets go on release or blur", () => {
    const onScoreboard = vi.fn();
    const trap = vi.fn();
    document.addEventListener("keydown", trap, true);
    const detach = attachKeyboard(window, createInputState(), undefined, {
      onScoreboard,
    });
    const down = new KeyboardEvent("keydown", {
      code: "Tab",
      cancelable: true,
      bubbles: true,
    });
    window.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(trap).not.toHaveBeenCalled();
    expect(onScoreboard).toHaveBeenLastCalledWith(true);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Tab", repeat: true }),
    );
    expect(onScoreboard).toHaveBeenCalledTimes(1);
    release("Tab");
    expect(onScoreboard).toHaveBeenLastCalledWith(false);
    press("Tab");
    window.dispatchEvent(new Event("blur"));
    expect(onScoreboard).toHaveBeenLastCalledWith(false);
    detach();
    document.removeEventListener("keydown", trap, true);
  });

  it("picks a weapon with 1, 2 and 3, once per press", () => {
    const onWeaponSlot = vi.fn();
    const detach = attachKeyboard(window, createInputState(), undefined, {
      onWeaponSlot,
    });
    press("Digit2");
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Digit2", repeat: true }),
    );
    press("Digit3");
    expect(onWeaponSlot.mock.calls.map(([slot]) => slot)).toEqual([2, 3]);
    detach();
  });

  it("switches the radio with R, once per press and not on repeat", () => {
    const onRadio = vi.fn();
    const onUserGesture = vi.fn();
    const detach = attachKeyboard(window, createInputState(), onUserGesture, {
      onRadio,
    });
    press("KeyR");
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyR", repeat: true }),
    );
    release("KeyR");
    press("KeyR");
    expect(onRadio).toHaveBeenCalledTimes(2);
    expect(onUserGesture).toHaveBeenCalled();
    detach();
    press("KeyR");
    expect(onRadio).toHaveBeenCalledTimes(2);
  });

  it("ignores every game key while a menu owns the keyboard", () => {
    const state = createInputState();
    const onScoreboard = vi.fn();
    let suspended = true;
    const detach = attachKeyboard(window, state, undefined, {
      onScoreboard,
      isSuspended: () => suspended,
    });
    press("KeyD");
    press("Tab");
    press("Space");
    expect(state.snapshot().move).toEqual([0, 0]);
    expect(state.snapshot().fire).toBe(false);
    expect(onScoreboard).not.toHaveBeenCalled();
    suspended = false;
    press("KeyD");
    expect(state.snapshot().move).toEqual([1, 0]);
    detach();
  });
});

describe("attachWheel", () => {
  it("cycles the weapon once per notch of travel, not once per trackpad tick", () => {
    const onCycle = vi.fn();
    const target = document.createElement("canvas");
    const detach = attachWheel(target, onCycle);
    const wheel = (deltaY: number): WheelEvent => {
      const event = new WheelEvent("wheel", { deltaY, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };
    expect(wheel(10).defaultPrevented).toBe(true);
    wheel(10);
    wheel(10);
    expect(onCycle).not.toHaveBeenCalled();
    wheel(10);
    expect(onCycle).toHaveBeenCalledTimes(1);
    wheel(-100);
    expect(onCycle).toHaveBeenCalledTimes(2);
    detach();
    wheel(100);
    expect(onCycle).toHaveBeenCalledTimes(2);
  });

  it("counts a wheel that reports lines in lines, three to the notch", () => {
    const onCycle = vi.fn();
    const target = document.createElement("canvas");
    const detach = attachWheel(target, onCycle);
    const line = (deltaY: number): void => {
      target.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode: 1 }));
    };
    line(1);
    line(1);
    expect(onCycle).not.toHaveBeenCalled();
    line(1);
    expect(onCycle).toHaveBeenCalledTimes(1);
    // A page is a notch on its own, and a change of unit starts the count over.
    target.dispatchEvent(new WheelEvent("wheel", { deltaY: 1, deltaMode: 2 }));
    expect(onCycle).toHaveBeenCalledTimes(2);
    detach();
  });
});
