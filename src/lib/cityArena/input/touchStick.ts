/** Maximum knob travel from the origin, in CSS pixels. */
export const STICK_RADIUS_PX = 48;

/** Fraction of the radius that counts as "not moving". */
export const STICK_DEAD_ZONE = 0.15;

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

/** Creates a stick; `radiusPx` and `deadZone` default to the spec values. */
export function createStick(
  radiusPx = STICK_RADIUS_PX,
  deadZone = STICK_DEAD_ZONE,
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
        vector: [unitX * magnitude, unitY * magnitude],
      };
    },
    end(pointerId) {
      if (current.pointerId !== pointerId) return;
      current = { pointerId: null, origin: null, knob: null, vector: [0, 0] };
    },
    state: () => current,
  };
}
