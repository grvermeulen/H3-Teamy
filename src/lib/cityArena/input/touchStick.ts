/** Maximum knob travel from the origin, in CSS pixels. */
export const STICK_RADIUS_PX = 48;

/** Fraction of the radius that counts as "not moving". */
export const STICK_DEAD_ZONE = 0.15;

/**
 * Per-axis dead zone as a fraction of full deflection. A component smaller than this snaps to
 * zero while the other axis is left untouched (never renormalised), so a thumb held forward with
 * a small wobble reports dead-straight movement instead of a permanent small steering command.
 */
export const STICK_AXIS_DEAD_ZONE = 0.2;

/** Current stick geometry for rendering and the resulting movement vector. */
export type StickState = {
  pointerId: number | null;
  origin: [number, number] | null;
  knob: [number, number] | null;
  vector: [number, number];
};

/** A floating joystick that appears wherever the first finger lands. */
export type StickController = {
  begin(pointerId: number, x: number, y: number): void;
  move(pointerId: number, x: number, y: number): void;
  end(pointerId: number): void;
  state(): StickState;
};

function scaleThroughDeadZone(deflection: number, deadZone: number): number {
  if (deflection <= deadZone) return 0;
  return (deflection - deadZone) / (1 - deadZone);
}

/** Zeroes a component inside the per-axis dead zone. */
function snapAxis(component: number, axisDeadZone: number): number {
  return Math.abs(component) < axisDeadZone ? 0 : component;
}

/** Creates a stick; `radiusPx`, `deadZone` and `axisDeadZone` default to the spec values. */
export function createStick(
  radiusPx = STICK_RADIUS_PX,
  deadZone = STICK_DEAD_ZONE,
  axisDeadZone = STICK_AXIS_DEAD_ZONE,
): StickController {
  let current: StickState = {
    pointerId: null,
    origin: null,
    knob: null,
    vector: [0, 0],
  };
  return {
    begin(pointerId, x, y) {
      if (current.pointerId !== null) return;
      current = { pointerId, origin: [x, y], knob: [x, y], vector: [0, 0] };
    },
    move(pointerId, x, y) {
      if (current.pointerId !== pointerId || !current.origin) return;
      const dx = x - current.origin[0];
      const dy = y - current.origin[1];
      const distance = Math.hypot(dx, dy);
      const clamped = Math.min(1, distance / radiusPx);
      const unitX = distance === 0 ? 0 : dx / distance;
      const unitY = distance === 0 ? 0 : dy / distance;
      const magnitude = scaleThroughDeadZone(clamped, deadZone);
      current = {
        ...current,
        knob: [
          current.origin[0] + unitX * clamped * radiusPx,
          current.origin[1] + unitY * clamped * radiusPx,
        ],
        vector: [
          snapAxis(unitX * magnitude, axisDeadZone),
          snapAxis(unitY * magnitude, axisDeadZone),
        ],
      };
    },
    end(pointerId) {
      if (current.pointerId !== pointerId) return;
      current = { pointerId: null, origin: null, knob: null, vector: [0, 0] };
    },
    state: () => current,
  };
}

/**
 * The aim a stick vector means: the direction the thumb is pushed, or nothing while it rests.
 *
 * Screen and world share their axes (y down, no rotation), so the screen angle is the world angle.
 *
 * @param vector - The stick's vector, or null once released.
 * @returns The angle in radians, or null when there is no direction to aim in.
 */
export function aimFromVector(vector: [number, number] | null): number | null {
  if (!vector || (vector[0] === 0 && vector[1] === 0)) return null;
  return Math.atan2(vector[1], vector[0]);
}
