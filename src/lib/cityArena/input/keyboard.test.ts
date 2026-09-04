import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInputState } from "./inputState";
import { attachKeyboard } from "./keyboard";

describe("attachKeyboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps WASD and arrows to a movement vector and releases on keyup", () => {
    const state = createInputState();
    const detach = attachKeyboard(window, state);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp" }));
    expect(state.snapshot().move[0]).toBeCloseTo(Math.SQRT1_2);
    expect(state.snapshot().move[1]).toBeCloseTo(-Math.SQRT1_2);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" }));
    expect(state.snapshot()).toEqual({ move: [0, -1] });
    detach();
    expect(state.snapshot()).toEqual({ move: [0, 0] }); // detach zeroes the vector itself
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    expect(state.snapshot()).toEqual({ move: [0, 0] }); // and stops listening entirely
  });

  it("ignores keys typed into form fields and resets on blur", () => {
    const state = createInputState();
    const detach = attachKeyboard(window, state);
    const input = document.createElement("input");
    document.body.append(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }),
    );
    expect(state.snapshot()).toEqual({ move: [0, 0] });
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    expect(state.snapshot()).toEqual({ move: [0, -1] });
    window.dispatchEvent(new Event("blur"));
    expect(state.snapshot()).toEqual({ move: [0, 0] });
    detach();
    input.remove();
  });

  it("resets the movement vector to zero on detach", () => {
    const state = createInputState();
    const detach = attachKeyboard(window, state);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    expect(state.snapshot()).toEqual({ move: [0, -1] });
    detach();
    expect(state.snapshot()).toEqual({ move: [0, 0] });
  });
});
