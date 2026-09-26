import * as Sentry from "@sentry/nextjs";

/** Radians of yaw or pitch added per pixel of pointer-locked mouse movement (spec §6.3). */
export const MOUSE_SENSITIVITY_RAD_PER_PX = 0.0024;

/** Default pitch clamp (spec §6.3's third-person range, −35°…+40°) until a camera mode narrows it. */
const DEFAULT_PITCH_MIN_RAD = -0.6;
const DEFAULT_PITCH_MAX_RAD = 0.7;

/** `PointerEvent.button` for the primary (left) mouse button. */
const PRIMARY_BUTTON = 0;

/** Where mouse-look stands with the pointer lock. */
export type LockState = {
  /** The pointer is locked to the target. */
  locked: boolean;
  /**
   * The lock is unavailable (unsupported, or the last request was refused), so plain mouse moves
   * over the target turn the camera instead; the next click still tries the lock again.
   */
  lockFree: boolean;
};

/** Callbacks from {@link attachMouseLook}. */
export type MouseLookHooks = {
  /** The primary click on the target — a user gesture, e.g. to unlock audio. */
  onGesture?: () => void;
  /** The user let go of a held lock (Esc, focus loss); never fired by {@link MouseLook.detach}. */
  onLockLost?: () => void;
  /** The lock or the lock-free fallback turned on or off. */
  onLockChange?: (state: LockState) => void;
};

/** Live yaw and pitch driven by the mouse, and the camera-easing signal. */
export type MouseLook = {
  yaw(): number;
  pitch(): number;
  locked(): boolean;
  /** True while the lock-free fallback turns the camera on plain mouse moves. */
  lockFree(): boolean;
  /** True when a primary click now would only take the pointer lock, so it must not shoot. */
  claimsClick(): boolean;
  setYaw(yaw: number): void;
  setPitchLimits(min: number, max: number): void;
  /** Radians of yaw added since the last call — the chase camera eases only when this is 0 for a while. */
  takeYawDelta(): number;
  /** Unbinds, releasing the pointer lock if this target holds it (without {@link MouseLookHooks.onLockLost}). */
  detach(): void;
};

/** Clamps `value` to the closed interval `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The mutable angles and lock state behind a {@link MouseLook}. */
type LookState = LockState & {
  yaw: number;
  pitch: number;
  yawDelta: number;
  pitchMin: number;
  pitchMax: number;
};

/** An error's name (a `DOMException` is not an `Error` everywhere), else the value itself. */
function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String(error.name)
    : String(error);
}

/**
 * A refused pointer lock is expected (embedded browsers, sandboxed frames, a re-request right after
 * Esc), so it leaves a breadcrumb rather than an error and switches on the lock-free fallback.
 */
function lockRefused(
  state: LookState,
  hooks: MouseLookHooks,
  error: unknown,
): void {
  Sentry.addBreadcrumb({
    category: "arena",
    level: "info",
    message:
      "Pointer lock unavailable; mouse-look falls back to plain mouse moves",
    data: { error: errorName(error) },
  });
  state.lockFree = true;
  hooks.onLockChange?.({ locked: state.locked, lockFree: true });
}

/** Asks for the pointer lock; a refusal (a rejected promise or a throw) is {@link lockRefused}. */
function requestLock(
  target: HTMLElement,
  state: LookState,
  hooks: MouseLookHooks,
): void {
  try {
    // Older browsers return undefined instead of a promise; both settle the same way here.
    Promise.resolve(target.requestPointerLock()).catch((error: unknown) =>
      lockRefused(state, hooks, error),
    );
  } catch (error) {
    lockRefused(state, hooks, error);
  }
}

/** Turns the view by one pointer move. */
function turn(state: LookState, event: PointerEvent): void {
  const dYaw = event.movementX * MOUSE_SENSITIVITY_RAD_PER_PX;
  state.yaw += dYaw;
  state.yawDelta += dYaw;
  state.pitch = clamp(
    state.pitch - event.movementY * MOUSE_SENSITIVITY_RAD_PER_PX,
    state.pitchMin,
    state.pitchMax,
  );
}

/** The angle half of a {@link MouseLook}, reading and steering `state`. */
function angleReader(
  state: LookState,
): Pick<
  MouseLook,
  "yaw" | "pitch" | "setYaw" | "setPitchLimits" | "takeYawDelta"
> {
  return {
    yaw: () => state.yaw,
    pitch: () => state.pitch,
    setYaw(value) {
      state.yaw = value;
    },
    setPitchLimits(min, max) {
      state.pitchMin = min;
      state.pitchMax = max;
      state.pitch = clamp(state.pitch, min, max);
    },
    takeYawDelta() {
      const delta = state.yawDelta;
      state.yawDelta = 0;
      return delta;
    },
  };
}

/** The document-level lock listeners: lock gained or lost, and the older API's refusal event. */
function lockListeners(
  target: HTMLElement,
  state: LookState,
  hooks: MouseLookHooks,
): { onChange: () => void; onError: () => void } {
  return {
    onChange() {
      const locked = document.pointerLockElement === target;
      if (locked === state.locked) return;
      state.locked = locked;
      if (locked) state.lockFree = false;
      hooks.onLockChange?.({ locked, lockFree: state.lockFree });
      if (!locked) hooks.onLockLost?.();
    },
    onError: () => lockRefused(state, hooks, "pointerlockerror"),
  };
}

/**
 * Binds mouse-look to `target` (spec §6.3). A primary click asks for the pointer lock; movement
 * turns the camera while the pointer is locked to `target`. Where the lock is unsupported or
 * refused, plain mouse moves over `target` turn it instead (no button needed), and each click
 * tries the lock again. A stray move before the player has clicked in never turns the camera.
 *
 * @param target - The element to lock the pointer to (the playfield canvas).
 * @param hooks - The gesture, lock-lost and lock-state callbacks.
 * @returns The live yaw/pitch reader and its detach function.
 */
export function attachMouseLook(
  target: HTMLElement,
  hooks: MouseLookHooks = {},
): MouseLook {
  const state: LookState = {
    yaw: 0,
    pitch: 0,
    yawDelta: 0,
    pitchMin: DEFAULT_PITCH_MIN_RAD,
    pitchMax: DEFAULT_PITCH_MAX_RAD,
    locked: false,
    lockFree: typeof target.requestPointerLock !== "function",
  };
  const isLocked = (): boolean => document.pointerLockElement === target;
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse" || event.button !== PRIMARY_BUTTON)
      return;
    hooks.onGesture?.();
    if (!isLocked() && typeof target.requestPointerLock === "function")
      requestLock(target, state, hooks);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (isLocked() || (state.lockFree && event.pointerType === "mouse"))
      turn(state, event);
  };
  const lock = lockListeners(target, state, hooks);
  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerlockchange", lock.onChange);
  document.addEventListener("pointerlockerror", lock.onError);
  return {
    ...angleReader(state),
    locked: isLocked,
    lockFree: () => state.lockFree,
    claimsClick: () => !state.lockFree && !isLocked(),
    detach() {
      target.removeEventListener("pointerdown", onPointerDown);
      target.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerlockchange", lock.onChange);
      document.removeEventListener("pointerlockerror", lock.onError);
      if (isLocked()) document.exitPointerLock();
    },
  };
}
