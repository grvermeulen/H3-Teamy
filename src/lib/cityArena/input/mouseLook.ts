/** Radians of yaw or pitch added per pixel of pointer-locked mouse movement (spec §6.3). */
export const MOUSE_SENSITIVITY_RAD_PER_PX = 0.0024;

/** Default pitch clamp (spec §6.3's third-person range, −35°…+40°) until a camera mode narrows it. */
const DEFAULT_PITCH_MIN_RAD = -0.6;
const DEFAULT_PITCH_MAX_RAD = 0.7;

/** `PointerEvent.button` for the primary (left) mouse button. */
const PRIMARY_BUTTON = 0;

/** Live yaw and pitch driven by pointer-locked mouse movement, and the camera-easing signal. */
export type MouseLook = {
  yaw(): number;
  pitch(): number;
  locked(): boolean;
  setYaw(yaw: number): void;
  setPitchLimits(min: number, max: number): void;
  /** Radians of yaw added since the last call — the chase camera eases only when this is 0 for a while. */
  takeYawDelta(): number;
  detach(): void;
};

/** Clamps `value` to the closed interval `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Binds mouse-look to `target` (spec §6.3): a primary-button click requests pointer lock and
 * reports the gesture; movement is only read while the pointer is locked to `target` itself, so
 * a stray mouse move over the canvas before the player has clicked in never turns the camera.
 *
 * @param target - The element to lock the pointer to (the playfield canvas).
 * @param onGesture - Called on the click that requests pointer lock, e.g. to unlock audio.
 * @returns The live yaw/pitch reader and its detach function.
 */
export function attachMouseLook(
  target: HTMLElement,
  onGesture?: () => void,
): MouseLook {
  let yaw = 0;
  let pitch = 0;
  let pitchMin = DEFAULT_PITCH_MIN_RAD;
  let pitchMax = DEFAULT_PITCH_MAX_RAD;
  let yawDelta = 0;
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse" || event.button !== PRIMARY_BUTTON)
      return;
    onGesture?.();
    target.requestPointerLock();
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (document.pointerLockElement !== target) return;
    const dYaw = event.movementX * MOUSE_SENSITIVITY_RAD_PER_PX;
    yaw += dYaw;
    yawDelta += dYaw;
    pitch = clamp(
      pitch - event.movementY * MOUSE_SENSITIVITY_RAD_PER_PX,
      pitchMin,
      pitchMax,
    );
  };
  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("pointermove", onPointerMove);
  return {
    yaw: () => yaw,
    pitch: () => pitch,
    locked: () => document.pointerLockElement === target,
    setYaw(value) {
      yaw = value;
    },
    setPitchLimits(min, max) {
      pitchMin = min;
      pitchMax = max;
      pitch = clamp(pitch, min, max);
    },
    takeYawDelta() {
      const delta = yawDelta;
      yawDelta = 0;
      return delta;
    },
    detach() {
      target.removeEventListener("pointerdown", onPointerDown);
      target.removeEventListener("pointermove", onPointerMove);
    },
  };
}
