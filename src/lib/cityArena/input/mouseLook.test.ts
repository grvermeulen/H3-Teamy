import * as Sentry from "@sentry/nextjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    document.exitPointerLock = vi.fn();
  });

  afterEach(() => {
    stubPointerLock(null);
  });

  it("requests pointer lock and reports the gesture on a primary-button click", () => {
    const onGesture = vi.fn();
    const look = attachMouseLook(canvas, { onGesture });
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

/** A primary mouse click on `target`. */
function click(target: HTMLElement): void {
  target.dispatchEvent(
    new PointerEvent("pointerdown", { pointerType: "mouse", button: 0 }),
  );
}

/** Lets a rejected lock request settle. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("attachMouseLook without a pointer lock", () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    vi.clearAllMocks();
    canvas = document.createElement("canvas");
    stubPointerLock(null);
    document.exitPointerLock = vi.fn();
  });

  afterEach(() => {
    stubPointerLock(null);
  });

  it("treats a refused lock as expected: a breadcrumb, no Sentry error, and plain mouse moves turn the camera", async () => {
    const refusal = new DOMException(
      "The root document of this element is not valid for pointer lock.",
      "WrongDocumentError",
    );
    canvas.requestPointerLock = vi.fn(() => Promise.reject(refusal));
    const onLockChange = vi.fn();
    const look = attachMouseLook(canvas, { onLockChange });
    expect(look.claimsClick()).toBe(true);
    click(canvas);
    await settle();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "arena",
        data: { error: "WrongDocumentError" },
      }),
    );
    expect(onLockChange).toHaveBeenLastCalledWith({
      locked: false,
      lockFree: true,
    });
    expect(look.lockFree()).toBe(true);
    // Clicks shoot again, and moving the mouse turns the camera with no button held.
    expect(look.claimsClick()).toBe(false);
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { pointerType: "mouse", movementX: 100 }),
    );
    expect(look.yaw()).toBeCloseTo(100 * MOUSE_SENSITIVITY_RAD_PER_PX);
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { pointerType: "touch", movementX: 100 }),
    );
    expect(look.yaw()).toBeCloseTo(100 * MOUSE_SENSITIVITY_RAD_PER_PX);
    look.detach();
  });

  it("treats a request that throws the same way", () => {
    canvas.requestPointerLock = vi.fn(() => {
      throw new DOMException("no", "NotSupportedError");
    });
    const look = attachMouseLook(canvas);
    click(canvas);
    expect(look.lockFree()).toBe(true);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    look.detach();
  });

  it("starts lock-free where the browser has no pointer lock at all", () => {
    const look = attachMouseLook(canvas);
    expect(look.lockFree()).toBe(true);
    expect(look.claimsClick()).toBe(false);
    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerType: "mouse",
        movementY: -100,
      }),
    );
    expect(look.pitch()).toBeCloseTo(100 * MOUSE_SENSITIVITY_RAD_PER_PX);
    look.detach();
  });

  it("goes back to the lock once a later click gets it", async () => {
    canvas.requestPointerLock = vi.fn(() =>
      Promise.reject(new DOMException("too soon", "SecurityError")),
    );
    const look = attachMouseLook(canvas);
    click(canvas);
    await settle();
    expect(look.lockFree()).toBe(true);
    canvas.requestPointerLock = vi.fn(() => Promise.resolve());
    click(canvas);
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    stubPointerLock(canvas);
    document.dispatchEvent(new Event("pointerlockchange"));
    expect(look.lockFree()).toBe(false);
    expect(look.locked()).toBe(true);
    look.detach();
  });
});

describe("attachMouseLook losing the lock", () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    vi.clearAllMocks();
    canvas = document.createElement("canvas");
    canvas.requestPointerLock = vi.fn(() => Promise.resolve());
    stubPointerLock(null);
    document.exitPointerLock = vi.fn();
  });

  afterEach(() => {
    stubPointerLock(null);
  });

  it("reports a lock the user let go of, but not one released by detach", () => {
    const onLockLost = vi.fn();
    const onLockChange = vi.fn();
    const look = attachMouseLook(canvas, { onLockLost, onLockChange });
    stubPointerLock(canvas);
    document.dispatchEvent(new Event("pointerlockchange"));
    expect(onLockChange).toHaveBeenLastCalledWith({
      locked: true,
      lockFree: false,
    });
    expect(look.claimsClick()).toBe(false);
    stubPointerLock(null);
    document.dispatchEvent(new Event("pointerlockchange"));
    expect(onLockLost).toHaveBeenCalledTimes(1);
    stubPointerLock(canvas);
    document.dispatchEvent(new Event("pointerlockchange"));
    look.detach();
    expect(document.exitPointerLock).toHaveBeenCalledTimes(1);
    stubPointerLock(null);
    document.dispatchEvent(new Event("pointerlockchange"));
    expect(onLockLost).toHaveBeenCalledTimes(1);
  });

  it("does not ask for the lock again while it already holds it", () => {
    const look = attachMouseLook(canvas);
    stubPointerLock(canvas);
    click(canvas);
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    look.detach();
  });
});
