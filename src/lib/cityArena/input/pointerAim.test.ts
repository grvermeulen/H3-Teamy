import { fireEvent } from "@testing-library/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInputState } from "./inputState";
import { attachPointerAim } from "./pointerAim";

describe("attachPointerAim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forgets the position and releases fire on detach", () => {
    const canvas = document.createElement("canvas");
    const state = createInputState();
    const aim = attachPointerAim(canvas, state);
    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerType: "mouse",
        clientX: 10,
        clientY: 20,
        bubbles: true,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerType: "mouse",
        button: 0,
        clientX: 10,
        clientY: 20,
        bubbles: true,
      }),
    );
    expect(state.snapshot().fire).toBe(true);
    aim.detach();
    expect(aim.position()).toBeNull();
    expect(state.snapshot().fire).toBe(false);
  });

  it("does not preventDefault on a primary-button pointerdown, so focus can leave other elements", () => {
    const canvas = document.createElement("canvas");
    const state = createInputState();
    const aim = attachPointerAim(canvas, state);
    const event = new PointerEvent("pointerdown", {
      pointerType: "mouse",
      button: 0,
      clientX: 10,
      clientY: 20,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(state.snapshot().fire).toBe(true);
    aim.detach();
  });

  it("tracks the mouse on the canvas and holds fire while the left button is down", () => {
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 310,
      bottom: 220,
      width: 300,
      height: 200,
      toJSON: () => ({}),
    });
    const state = createInputState();
    const aim = attachPointerAim(canvas, state);
    expect(aim.position()).toBeNull();
    fireEvent.pointerMove(canvas, {
      pointerType: "mouse",
      clientX: 110,
      clientY: 70,
    });
    expect(aim.position()).toEqual([100, 50]);
    fireEvent.pointerDown(canvas, {
      pointerType: "mouse",
      button: 0,
      clientX: 110,
      clientY: 70,
    });
    expect(state.snapshot().fire).toBe(true);
    fireEvent.pointerUp(canvas, { pointerType: "mouse", button: 0 });
    expect(state.snapshot().fire).toBe(false);
    fireEvent.pointerLeave(canvas, { pointerType: "mouse" });
    expect(aim.position()).toBeNull();
    aim.detach();
    fireEvent.pointerMove(canvas, {
      pointerType: "mouse",
      clientX: 50,
      clientY: 50,
    });
    expect(aim.position()).toBeNull();
  });

  it("ignores touch pointers and the right button", () => {
    const canvas = document.createElement("canvas");
    const state = createInputState();
    const aim = attachPointerAim(canvas, state);
    fireEvent.pointerMove(canvas, {
      pointerType: "touch",
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerDown(canvas, { pointerType: "touch", button: 0 });
    fireEvent.pointerDown(canvas, { pointerType: "mouse", button: 2 });
    expect(aim.position()).toBeNull();
    expect(state.snapshot().fire).toBe(false);
    aim.detach();
  });
});
