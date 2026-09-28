/**
 * The 3D look pad on touch (spec §6): a drag on the right-hand side of the screen turns the camera
 * the way the mouse does, and never fires. Pure — pointer events in, a turn out — so the 3D frame
 * takes what accumulated since the last frame and applies it.
 */

/** Radians of yaw or pitch per CSS pixel of drag at a "Kijkgevoeligheid" of 1. */
export const TOUCH_LOOK_RAD_PER_PX = 0.008;

/** What the pad reads from a pointer event; a DOM and a React pointer event both fit. */
export type LookPointer = Pick<
  PointerEvent,
  "pointerId" | "clientX" | "clientY"
>;

/** A turn of the camera, radians: a positive yaw turns right, a positive pitch looks up. */
export type LookTurn = { yaw: number; pitch: number };

/** One finger at a time turns the camera; the frame takes the turn it added up. */
export type TouchLook = {
  /**
   * A finger goes down. It owns the pad unless another finger already does — or `takeOver` is
   * set, as for the fire button, whose drag must aim even with a thumb resting on the pad.
   */
  onDown(event: LookPointer, takeOver?: boolean): void;
  onMove(event: LookPointer): void;
  onUp(event: LookPointer): void;
  /** The turn accumulated since the last call, radians; the next call starts from zero. */
  take(): LookTurn;
  /** Forgets the finger and any untaken turn, for when the pad goes away mid-drag. */
  reset(): void;
};

/** The finger turning the camera and where it was at its last event. */
type Finger = { id: number; x: number; y: number };

/**
 * Creates a look pad. The first finger down owns it until lifted; a second finger (a pinch, a
 * thumb on a button) is ignored, unless it takes the pad over. Dragging right turns right and dragging up looks up, at
 * {@link TOUCH_LOOK_RAD_PER_PX} times `scale()` per pixel.
 *
 * @param scale - The "Kijkgevoeligheid" setting, read on every move.
 * @returns The pad.
 */
export function createTouchLook(scale: () => number): TouchLook {
  let finger: Finger | null = null;
  let yaw = 0;
  let pitch = 0;
  return {
    onDown(event, takeOver = false) {
      if (finger && !takeOver) return;
      finger = { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onMove(event) {
      if (finger?.id !== event.pointerId) return;
      const rate = TOUCH_LOOK_RAD_PER_PX * scale();
      yaw += (event.clientX - finger.x) * rate;
      pitch -= (event.clientY - finger.y) * rate;
      finger = { ...finger, x: event.clientX, y: event.clientY };
    },
    onUp(event) {
      if (finger?.id === event.pointerId) finger = null;
    },
    take() {
      const turn = { yaw, pitch };
      yaw = 0;
      pitch = 0;
      return turn;
    },
    reset() {
      finger = null;
      yaw = 0;
      pitch = 0;
    },
  };
}

/** The look pad as the 3D frame keeps it between frames. */
export type TouchCamera = {
  pad: TouchLook;
  /** Radians the pad has tilted the camera by, on top of mouse-look's pitch. */
  pitch: number;
  /** The camera mode's pitch range, radians; the tilted pitch stays inside it. */
  limits: readonly [number, number];
  /** The pad has turned the camera since the view started; from then on the walk no longer does. */
  engaged: boolean;
};

/**
 * A look pad for a freshly started 3D view: no tilt yet, not engaged.
 *
 * @param pad - The pad the touch surfaces feed.
 * @param limits - The camera mode's pitch range, radians.
 * @returns The camera state.
 */
export function createTouchCamera(
  pad: TouchLook,
  limits: readonly [number, number],
): TouchCamera {
  return { pad, pitch: 0, limits, engaged: false };
}

/** Clamps `value` to `[min, max]`. */
function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The camera pitch with the pad's tilt added, inside the mode's range.
 *
 * @param camera - The pad's state.
 * @param basePitch - Mouse-look's pitch, radians.
 * @returns The pitch to render with, radians.
 */
export function tiltedPitch(camera: TouchCamera, basePitch: number): number {
  return clamp(basePitch + camera.pitch, camera.limits);
}

/** The part of mouse-look the pad turns: the yaw is shared, the pitch only read. */
export type TurnableLook = {
  yaw(): number;
  pitch(): number;
  setYaw(yaw: number): void;
};

/**
 * Applies the pad's turn since the last frame: the yaw onto `look`, the pitch onto the pad's tilt,
 * both multiplied by `factor()` — aim assist's friction — which is asked only when the pad turned.
 *
 * @param camera - The pad's state; its tilt and `engaged` are updated.
 * @param look - Mouse-look, whose yaw the pad turns.
 * @param factor - The scale for this frame's turn.
 * @returns The yaw turned, radians.
 */
export function turnTouchCamera(
  camera: TouchCamera,
  look: TurnableLook,
  factor: () => number,
): number {
  const turn = camera.pad.take();
  if (turn.yaw === 0 && turn.pitch === 0) return 0;
  const scale = factor();
  const yaw = turn.yaw * scale;
  const base = look.pitch();
  look.setYaw(look.yaw() + yaw);
  camera.pitch =
    clamp(base + camera.pitch + turn.pitch * scale, camera.limits) - base;
  camera.engaged = true;
  return yaw;
}
