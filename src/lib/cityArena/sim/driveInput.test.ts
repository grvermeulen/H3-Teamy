import { describe, expect, it } from "vitest";
import { createInputState } from "../input/inputState";
import {
  ANALOG_REVERSE_ERROR_RAD,
  ANALOG_STEER_FULL_ERROR_RAD,
  STEER_COMMAND_RATE_PER_S,
  driveStep,
} from "./driveInput";
import { createInput } from "./types";

const step = 1 / 30;

/** An analog input pointing the stick along `angle` at `magnitude` deflection. */
function stick(angle: number, magnitude = 1): ReturnType<typeof createInput> {
  return createInput({
    move: [Math.cos(angle) * magnitude, Math.sin(angle) * magnitude],
    moveIsAnalog: true,
  });
}

describe("driveStep constants", () => {
  it("reaches full lock at 45 degrees and reverses past 135", () => {
    expect(ANALOG_STEER_FULL_ERROR_RAD).toBeCloseTo(Math.PI / 4, 10);
    expect(ANALOG_REVERSE_ERROR_RAD).toBeCloseTo((Math.PI * 3) / 4, 10);
    expect(STEER_COMMAND_RATE_PER_S).toBe(6);
  });
});

describe("driveStep with digital input", () => {
  it("keeps tank steering: x steers, up is gas, down brakes", () => {
    expect(createInput({}).moveIsAnalog).toBe(false);
    expect(driveStep(createInput({ move: [0.5, -1] }), 0, 0, step)).toEqual({
      controls: { throttle: 1, steer: 0.5 },
      steer: 0.5,
    });
    expect(driveStep(createInput({ move: [-1, 1] }), 2.5, 0, step)).toEqual({
      controls: { throttle: -1, steer: -1 },
      steer: -1,
    });
  });

  it("ignores the rate limit so A and D still answer instantly", () => {
    expect(driveStep(createInput({ move: [1, 0] }), 0, -1, step).steer).toBe(1);
  });
});

describe("driveStep with analog input", () => {
  it("drives straight when the stick already points along the heading", () => {
    expect(driveStep(stick(0), 0, 0, step)).toEqual({
      controls: { throttle: 1, steer: 0 },
      steer: 0,
    });
  });

  it("throttles by the stick magnitude", () => {
    expect(driveStep(stick(0, 0.5), 0, 0, step).controls.throttle).toBeCloseTo(
      0.5,
      6,
    );
  });

  it("asks for full lock at ninety degrees but only moves 0.2 per tick", () => {
    const first = driveStep(stick(Math.PI / 2), 0, 0, step);
    expect(first.steer).toBeCloseTo(0.2, 6);
    expect(first.controls.steer).toBeCloseTo(0.2, 6);
    let steer = 0;
    for (let tick = 0; tick < 5; tick++)
      steer = driveStep(stick(Math.PI / 2), 0, steer, step).steer;
    expect(steer).toBeCloseTo(1, 6);
  });

  it("maps a half-lock error straight through when it is inside the rate limit", () => {
    expect(driveStep(stick(Math.PI / 8), 0, 0.4, step).steer).toBeCloseTo(
      0.5,
      6,
    );
  });

  it("cannot flick the wheel from one lock to the other", () => {
    expect(driveStep(stick(Math.PI / 2), 0, -1, step).steer).toBeCloseTo(
      -0.8,
      6,
    );
  });

  it("ramps the wheel back to centre when the stick is released", () => {
    const released = driveStep(
      createInput({ move: [0, 0], moveIsAnalog: true }),
      0,
      0.9,
      step,
    );
    expect(released.controls.throttle).toBe(0);
    expect(released.steer).toBeCloseTo(0.7, 6);
  });

  it("brakes and reverses straight when the stick points behind the car", () => {
    expect(driveStep(stick(Math.PI), 0, 0, step)).toEqual({
      controls: { throttle: -1, steer: 0 },
      steer: 0,
    });
  });

  it("backs the tail toward a stick held behind and to one side", () => {
    const backing = driveStep(stick(2.9), 0, 0.3, step);
    expect(backing.controls.throttle).toBeCloseTo(-1, 6);
    expect(backing.steer).toBeCloseTo(0.307607, 5);
  });

  it("measures the error against the car heading, not the world", () => {
    // Car heading south (π/2), stick pointing east: a −90° error asks for full
    // right-to-left lock, rate-limited to −0.2 in the first tick.
    expect(driveStep(stick(0), Math.PI / 2, 0, step).steer).toBeCloseTo(
      -0.2,
      6,
    );
  });
});

describe("driveStep after a real touch-stick release", () => {
  it("ramps a mid-turn steer command to centre over several ticks instead of snapping in one", () => {
    const state = createInputState();
    state.setStick([0.3, -0.4]); // the player was dragging the stick mid-turn
    state.setStick(null); // ...then lifted the finger — the normal touch-release gesture
    const released = state.snapshot();
    expect(released).toMatchObject({ move: [0, 0], moveIsAnalog: true });

    // previousSteer starts at 0.9, mirroring the review's mid-turn example. At this 30 Hz step
    // STEER_COMMAND_RATE_PER_S (6) limits each tick to 0.2, so reaching 0 takes five ticks.
    let steer = 0.9;
    for (const expected of [0.7, 0.5, 0.3, 0.1, 0]) {
      const result = driveStep(released, 0, steer, step);
      expect(result.controls.throttle).toBe(0);
      steer = result.steer;
      expect(steer).toBeCloseTo(expected, 6);
    }
  });
});
