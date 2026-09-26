import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOUSE_SENSITIVITY_RAD_PER_PX, attachMouseLook } from "./mouseLook";

/** Stubs `document.pointerLockElement`, which jsdom does not implement. */
function stubPointerLock(target: HTMLElement | null): void {
  Object.defineProperty(document, "pointerLockElement", {
    configurable: true,
    get: () => target,
  });
}

describe("attachMouseLook", () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    vi.clearAllMocks();
    canvas = document.createElement("canvas");
    canvas.requestPointerLock = vi.fn(() => Promise.resolve());
    stubPointerLock(null);
  });

  it("requests pointer lock and reports the gesture on a primary-button click", () => {
    const onGesture = vi.fn();
    const look = attachMouseLook(canvas, onGesture);
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { pointerType: "mouse", button: 0 }),
    );
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(onGesture).toHaveBeenCalledTimes(1);
    look.detach();
  });

  it("ignores touch pointers and non-primary buttons", () => {
    const look = attachMouseLook(canvas);
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { pointerType: "touch", button: 0 }),
    );
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { pointerType: "mouse", button: 2 }),
    );
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    look.detach();
  });

  it("ignores movement while not pointer-locked to this target", () => {
    const look = attachMouseLook(canvas);
    canvas.dispatchEvent(new MouseEvent("pointermove", { movementX: 100 }));
    expect(look.yaw()).toBe(0);
    expect(look.locked()).toBe(false);
    look.detach();
  });

  it("adds movementX × sensitivity to yaw while pointer-locked to this target", () => {
    const look = attachMouseLook(canvas);
    stubPointerLock(canvas);
    canvas.dispatchEvent(new MouseEvent("pointermove", { movementX: 100 }));
    expect(look.yaw()).toBeCloseTo(100 * MOUSE_SENSITIVITY_RAD_PER_PX);
    expect(look.yaw()).toBeCloseTo(0.24);
    expect(look.locked()).toBe(true);
    look.detach();
  });

  it("reports the accumulated yaw delta since the last call, then resets it", () => {
    stubPointerLock(canvas);
    const look = attachMouseLook(canvas);
    canvas.dispatchEvent(new MouseEvent("pointermove", { movementX: 50 }));
    canvas.dispatchEvent(new MouseEvent("pointermove", { movementX: 50 }));
    expect(look.takeYawDelta()).toBeCloseTo(100 * MOUSE_SENSITIVITY_RAD_PER_PX);
    expect(look.takeYawDelta()).toBe(0);
    look.detach();
  });

  it("subtracts movementY from pitch and clamps to the default limits", () => {
    stubPointerLock(canvas);
    const look = attachMouseLook(canvas);
    canvas.dispatchEvent(
      new MouseEvent("pointermove", { movementY: 1_000_000 }),
    );
    expect(look.pitch()).toBeCloseTo(-0.6);
    canvas.dispatchEvent(
      new MouseEvent("pointermove", { movementY: -1_000_000 }),
    );
    expect(look.pitch()).toBeCloseTo(0.7);
    look.detach();
  });

  it("narrows the pitch clamp with setPitchLimits, e.g. for first person", () => {
    stubPointerLock(canvas);
    const look = attachMouseLook(canvas);
    look.setPitchLimits(-0.3, 0.3);
    canvas.dispatchEvent(
      new MouseEvent("pointermove", { movementY: 1_000_000 }),
    );
    expect(look.pitch()).toBeCloseTo(-0.3);
    look.detach();
  });

  it("lets the caller set yaw directly, e.g. to sync with a vehicle heading", () => {
    const look = attachMouseLook(canvas);
    look.setYaw(1.5);
    expect(look.yaw()).toBe(1.5);
    look.detach();
  });

  it("stops reacting to movement once detached", () => {
    stubPointerLock(canvas);
    const look = attachMouseLook(canvas);
    look.detach();
    canvas.dispatchEvent(new MouseEvent("pointermove", { movementX: 100 }));
    expect(look.yaw()).toBe(0);
  });
});
