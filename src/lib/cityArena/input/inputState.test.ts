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
    expect(state.snapshot()).toEqual({ move: [0, -0.5] });
    state.setStick(null);
    expect(state.snapshot().move[1]).toBeCloseTo(Math.SQRT1_2);
  });
});
