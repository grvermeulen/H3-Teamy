import { describe, expect, it } from "vitest";
import { clampToUnit, createInputState } from "./inputState";

describe("input state", () => {
  it("clamps vectors to unit length", () => {
    expect(clampToUnit([3, 4])).toEqual([0.6, 0.8]);
    expect(clampToUnit([0.3, 0])).toEqual([0.3, 0]);
  });

  it("prefers the stick while it is active, otherwise the keyboard", () => {
    const state = createInputState();
    state.setKeyboard([1, 1]);
    expect(state.snapshot().move[0]).toBeCloseTo(Math.SQRT1_2);
    state.setStick([0, -0.5]);
    expect(state.snapshot().move).toEqual([0, -0.5]);
    state.setStick(null);
    expect(state.snapshot().move[1]).toBeCloseTo(Math.SQRT1_2);
  });

  it("ORs buttons from the keyboard and pointer sources and carries the aim", () => {
    const state = createInputState();
    expect(state.snapshot()).toEqual({
      move: [0, 0],
      aim: null,
      fire: false,
      enter: false,
      weaponNext: false,
    });
    state.setButton("keyboard", "fire", true);
    state.setButton("pointer", "fire", false);
    state.setAim(1.5);
    expect(state.snapshot()).toMatchObject({ fire: true, aim: 1.5 });
    state.setButton("keyboard", "fire", false);
    state.setButton("pointer", "enter", true);
    expect(state.snapshot()).toMatchObject({ fire: false, enter: true });
  });

  it("clears keyboard movement and buttons together on blur", () => {
    const state = createInputState();
    state.setKeyboard([1, 0]);
    state.setButton("keyboard", "weaponNext", true);
    state.setButton("pointer", "fire", true);
    state.clearKeyboard();
    expect(state.snapshot()).toMatchObject({
      move: [0, 0],
      weaponNext: false,
      fire: true,
    });
  });

  it("keeps an on-screen button held when the mouse releases the same button", () => {
    const state = createInputState();
    state.setButton("buttons", "fire", true);
    state.setButton("pointer", "fire", true);
    state.setButton("pointer", "fire", false);
    expect(state.snapshot().fire).toBe(true);
    state.setButton("buttons", "fire", false);
    expect(state.snapshot().fire).toBe(false);
  });
});
