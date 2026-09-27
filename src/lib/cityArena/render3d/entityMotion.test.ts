import { describe, expect, it } from "vitest";
import { VEHICLE_SPECS } from "../sim/vehicle";
import {
  TELEPORT_M,
  createMotion,
  createSteerMemory,
  trackMotion,
  trackSteer,
  vestHueOf,
} from "./entityMotion";

const FRAME_S = 1 / 60;

/** Feeds `frames` samples of a walk along +x at `speed` m/s, starting at the origin. */
function walk(frames: number, speed: number): ReturnType<typeof createMotion> {
  const motion = createMotion();
  for (let frame = 0; frame <= frames; frame += 1)
    trackMotion(motion, frame * speed * FRAME_S, 0, FRAME_S, null);
  return motion;
}

describe("trackMotion", () => {
  it("measures speed from the distance moved per frame, smoothed", () => {
    const motion = walk(120, 6);
    expect(motion.speed).toBeCloseTo(6, 3);
  });

  it("eases into a new speed instead of jumping", () => {
    const motion = walk(2, 6);
    expect(motion.speed).toBeGreaterThan(0);
    expect(motion.speed).toBeLessThan(6);
  });

  it("stands still at speed 0 and starts from rest on the first sample", () => {
    const motion = createMotion();
    trackMotion(motion, 40, 50, FRAME_S, null);
    expect(motion.speed).toBe(0);
    for (let frame = 0; frame < 30; frame += 1)
      trackMotion(motion, 40, 50, FRAME_S, null);
    expect(motion.speed).toBe(0);
    expect(motion.phaseM).toBe(0);
  });

  it("walks the gait phase by the distance covered", () => {
    const motion = walk(600, 2);
    // Ten seconds at 2 m/s, less the brief ease-in from rest.
    expect(motion.phaseM).toBeGreaterThan(19.5);
    expect(motion.phaseM).toBeLessThan(20);
  });

  it("follows a measured speed when the simulation has one", () => {
    const motion = createMotion();
    for (let frame = 0; frame < 120; frame += 1)
      trackMotion(motion, 0, 0, FRAME_S, 3);
    expect(motion.speed).toBeCloseTo(3, 3);
  });

  it("treats a jump longer than a teleport as a respawn, not a sprint", () => {
    const motion = walk(60, 1.5);
    const before = motion.speed;
    trackMotion(motion, motion.x + TELEPORT_M + 1, 0, FRAME_S, null);
    expect(motion.speed).toBeCloseTo(before, 6);
  });

  it("changes nothing but the position when no time passed", () => {
    const motion = walk(60, 1.5);
    const { speed, phaseM } = motion;
    trackMotion(motion, motion.x + 1, 0, 0, null);
    expect(motion.speed).toBe(speed);
    expect(motion.phaseM).toBe(phaseM);
  });
});

describe("vestHueOf", () => {
  it("gives the same player the same hue every time", () => {
    expect(vestHueOf(7)).toBe(vestHueOf(7));
    expect(vestHueOf(7)).toBeGreaterThanOrEqual(0);
    expect(vestHueOf(7)).toBeLessThan(1);
  });

  it("spreads a full match's players around the colour wheel", () => {
    const hues = [1, 2, 3, 4, 5, 6, 7, 8].map(vestHueOf).sort((a, b) => a - b);
    const gaps = hues.map((hue, index) =>
      index === 0 ? hue + 1 - hues[hues.length - 1]! : hue - hues[index - 1]!,
    );
    expect(Math.min(...gaps)).toBeGreaterThan(0.08);
  });
});

describe("trackSteer", () => {
  const sedan = VEHICLE_SPECS.sedan.steerRateRadS;

  /** Steers a sedan through `frames` frames turning at `rate` rad/s at `forward` m/s. */
  function turn(rate: number, forward: number, frames = 60): number {
    const memory = createSteerMemory();
    let steer = 0;
    for (let frame = 0; frame <= frames; frame += 1)
      steer = trackSteer(memory, {
        heading: frame * rate * FRAME_S,
        forward,
        kind: "sedan",
        dt: FRAME_S,
        driverSteer: null,
      });
    return steer;
  }

  it("uses the driver's own steering when a player drives", () => {
    const memory = createSteerMemory();
    const input = {
      heading: 0,
      forward: 10,
      kind: "sedan" as const,
      dt: FRAME_S,
      driverSteer: -0.4,
    };
    expect(trackSteer(memory, input)).toBe(-0.4);
  });

  it("reads the wheel angle from how fast the heading turns", () => {
    expect(turn(sedan * 0.5, 10)).toBeCloseTo(0.5, 2);
    expect(turn(-sedan * 0.25, 10)).toBeCloseTo(-0.25, 2);
  });

  it("mirrors the wheels in reverse, clamps a spin to full lock and centres a parked car", () => {
    expect(turn(sedan * 0.5, -5)).toBeCloseTo(-0.5, 2);
    const spin = turn(sedan * 3, 10, 180);
    expect(spin).toBeCloseTo(1, 4);
    expect(spin).toBeLessThanOrEqual(1);
    expect(turn(sedan * 0.5, 0)).toBe(0);
  });

  it("takes the short way round when the heading wraps past ±π", () => {
    const memory = createSteerMemory();
    const input = {
      heading: Math.PI - 0.01,
      forward: 10,
      kind: "sedan" as const,
      dt: FRAME_S,
      driverSteer: null,
    };
    trackSteer(memory, input);
    const steer = trackSteer(memory, { ...input, heading: -Math.PI + 0.01 });
    expect(steer).toBeGreaterThan(0);
    expect(steer).toBeLessThan(1);
  });
});
