import { describe, expect, it } from "vitest";
import {
  CHASE_IDLE_S,
  INITIAL_CAR_LOOK,
  angleDelta,
  easeYaw,
  nextCarYaw,
  stickTurnedYaw,
  stickWorldYaw,
  type CarYawInput,
} from "./cameraYaw";

/** A car-look step heading east with the mouse at rest and a fresh clock. */
function step(overrides: Partial<CarYawInput> = {}): CarYawInput {
  return {
    yaw: 0,
    yawDelta: 0,
    heading: 0,
    mode: "third",
    dt: 0.1,
    state: INITIAL_CAR_LOOK,
    ...overrides,
  };
}

describe("angleDelta", () => {
  it("takes the short way round", () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(angleDelta(4 * Math.PI, 0.5)).toBeCloseTo(0.5);
  });
});

describe("easeYaw", () => {
  it("closes part of the gap along the shortest arc and never overshoots", () => {
    const eased = easeYaw(Math.PI - 0.1, -Math.PI + 0.1, 2, 0.1);
    expect(angleDelta(Math.PI - 0.1, eased)).toBeGreaterThan(0);
    expect(angleDelta(Math.PI - 0.1, eased)).toBeLessThan(0.2);
    expect(easeYaw(0, 1, 1000, 1)).toBeCloseTo(1);
  });
});

describe("nextCarYaw", () => {
  it("leaves the yaw alone on foot and only counts the idle time", () => {
    const next = nextCarYaw(step({ yaw: 1, heading: null }));
    expect(next.yaw).toBe(1);
    expect(next.state).toEqual({ idleSeconds: 0.1, heading: null });
  });

  it("waits for the mouse to rest before easing the chase camera behind the car", () => {
    const fresh = nextCarYaw(step({ yaw: 1 }));
    expect(fresh.yaw).toBe(1);
    const idle = nextCarYaw(
      step({ yaw: 1, state: { idleSeconds: CHASE_IDLE_S, heading: 0 } }),
    );
    expect(idle.yaw).toBeLessThan(1);
    expect(idle.yaw).toBeGreaterThan(0);
  });

  it("restarts the idle clock whenever the mouse turns the camera", () => {
    const moved = nextCarYaw(
      step({
        yaw: 1,
        yawDelta: 0.05,
        state: { idleSeconds: CHASE_IDLE_S + 1, heading: 0 },
      }),
    );
    expect(moved.yaw).toBe(1);
    expect(moved.state.idleSeconds).toBe(0);
  });

  it("carries the first-person view round with the car and settles it faster", () => {
    const carried = nextCarYaw(
      step({
        mode: "first",
        yaw: 0.3,
        heading: 0.5,
        yawDelta: 0.01,
        state: { idleSeconds: 0, heading: 0.4 },
      }),
    );
    expect(carried.yaw).toBeCloseTo(0.4);
    const settle = (mode: "first" | "third"): number =>
      nextCarYaw(
        step({
          mode,
          yaw: 1,
          state: { idleSeconds: CHASE_IDLE_S, heading: 0 },
        }),
      ).yaw;
    expect(settle("first")).toBeLessThan(settle("third"));
  });
});

describe("stickWorldYaw", () => {
  it("reads a stick pushed up as the camera's forward and right as its right", () => {
    expect(stickWorldYaw(0.7, -Math.PI / 2)).toBeCloseTo(0.7);
    expect(stickWorldYaw(0.7, 0)).toBeCloseTo(0.7 + Math.PI / 2);
  });
});

describe("stickTurnedYaw", () => {
  const still = {
    aim: null,
    move: [0, 0] as [number, number],
    moveIsAnalog: true,
  };

  it("turns the camera toward a held aim stick", () => {
    const yaw = stickTurnedYaw(0, { ...still, aim: 0 }, false, 0.1);
    expect(yaw).toBeGreaterThan(0);
    expect(yaw).toBeLessThan(Math.PI / 2);
  });

  it("turns toward a lone movement stick on foot, more for a bigger push", () => {
    const right = (push: number): number =>
      stickTurnedYaw(0, { ...still, move: [push, 0] }, false, 0.1);
    expect(right(1)).toBeGreaterThan(right(0.3));
    expect(right(0.3)).toBeGreaterThan(0);
    // Up-left walks forward and to the left: the camera turns left (negative yaw).
    expect(
      stickTurnedYaw(0, { ...still, move: [-0.7, -0.7] }, false, 0.1),
    ).toBeLessThan(0);
  });

  it("never spins round for a walk backward, the keyboard, a car or a resting stick", () => {
    expect(stickTurnedYaw(1, { ...still, move: [0, 1] }, false, 0.1)).toBe(1);
    const keyboard = { ...still, move: [1, 0] as [number, number] };
    expect(
      stickTurnedYaw(1, { ...keyboard, moveIsAnalog: false }, false, 0.1),
    ).toBe(1);
    expect(stickTurnedYaw(1, keyboard, true, 0.1)).toBe(1);
    expect(stickTurnedYaw(1, still, false, 0.1)).toBe(1);
  });
});
