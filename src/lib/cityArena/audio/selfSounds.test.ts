import { describe, expect, it } from "vitest";
import { SIM_STEP_S } from "../sim/player";
import {
  RUN_STEP_M,
  SKID_COOLDOWN_S,
  WALK_STEP_M,
  createFootsteps,
  createSkidDetector,
  type SelfCue,
  type SelfMotion,
} from "./selfSounds";

const TICKS_PER_SECOND = Math.round(1 / SIM_STEP_S);
/** A full-lock turn at speed: 2.4 rad/s. */
const HARD_TURN_PER_TICK = 0.08;

/** On foot at `speedMps` on `tick`. */
function walking(tick: number, speedMps: number): SelfMotion {
  return { tick, onFoot: true, speedMps, car: null };
}

/** Driving at `forwardMps` with `heading` on `tick`. */
function driving(tick: number, forwardMps: number, heading = 0): SelfMotion {
  return {
    tick,
    onFoot: false,
    speedMps: 0,
    car: { forwardMps, heading },
  };
}

/** Metres walked at `speedMps` over `ticks` ticks, the first of which only starts the count. */
function metresIn(ticks: number, speedMps: number): number {
  return (ticks - 1) * SIM_STEP_S * speedMps;
}

/** A fast car turning hard for `ticks` ticks from `start`, then driving straight on; its cues. */
function slide(skid: SelfCue, start: number, ticks = 5): number {
  let cues = 0;
  for (let tick = 0; tick <= ticks + 1; tick++) {
    const heading = Math.min(tick, ticks) * HARD_TURN_PER_TICK;
    if (skid.step(driving(start + tick, 20, heading))) cues++;
  }
  return cues;
}

/** How many of `ticks` consecutive ticks make the cue sound. */
function countCues(
  cue: SelfCue,
  ticks: number,
  motionAt: (tick: number) => SelfMotion,
): number {
  let count = 0;
  for (let tick = 0; tick < ticks; tick++)
    if (cue.step(motionAt(tick))) count++;
  return count;
}

describe("createFootsteps", () => {
  it("lands a walking foot every 0.7 m and a running one every 1.1 m", () => {
    const ticks = TICKS_PER_SECOND * 10;
    const walk = countCues(createFootsteps(), ticks, (tick) =>
      walking(tick, 1.4),
    );
    expect(walk).toBe(Math.floor(metresIn(ticks, 1.4) / WALK_STEP_M));
    const run = countCues(createFootsteps(), ticks, (tick) =>
      walking(tick, 5.5),
    );
    expect(run).toBe(Math.floor(metresIn(ticks, 5.5) / RUN_STEP_M));
  });

  it("keeps the same cadence however many frames show the same tick", () => {
    const steps = createFootsteps();
    const ticks = TICKS_PER_SECOND * 10;
    let count = 0;
    for (let tick = 0; tick < ticks; tick++)
      for (let frame = 0; frame < 3; frame++)
        if (steps.step(walking(tick, 1.4))) count++;
    expect(count).toBe(Math.floor(metresIn(ticks, 1.4) / WALK_STEP_M));
  });

  it("is silent standing still and in a car", () => {
    expect(
      countCues(createFootsteps(), TICKS_PER_SECOND * 5, (tick) =>
        walking(tick, 0),
      ),
    ).toBe(0);
    expect(
      countCues(createFootsteps(), TICKS_PER_SECOND * 5, (tick) =>
        driving(tick, 12),
      ),
    ).toBe(0);
  });
});

describe("createSkidDetector", () => {
  it("squeals once when a fast car turns hard, not for every tick of the slide", () => {
    const skid = createSkidDetector();
    const count = countCues(skid, 20, (tick) =>
      driving(tick, 20, tick * HARD_TURN_PER_TICK),
    );
    expect(count).toBe(1);
  });

  it("squeals under hard braking but not under a crash stop or gentle driving", () => {
    const braking = countCues(createSkidDetector(), 20, (tick) =>
      driving(tick, 25 - tick * 0.5),
    );
    expect(braking).toBe(1);
    const crash = createSkidDetector();
    crash.step(driving(0, 25));
    expect(crash.step(driving(1, 0))).toBe(false);
    const cruise = countCues(createSkidDetector(), 60, (tick) =>
      driving(tick, 20, tick * 0.01),
    );
    expect(cruise).toBe(0);
  });

  it("stays quiet for a second slide within the cooldown, and squeals after it", () => {
    const skid = createSkidDetector();
    const cooldownTicks = Math.round(SKID_COOLDOWN_S / SIM_STEP_S);
    expect(slide(skid, 0)).toBe(1);
    expect(slide(skid, 10)).toBe(0);
    expect(slide(skid, 10 + cooldownTicks)).toBe(1);
  });

  it("is silent on foot and slow in a car", () => {
    expect(
      countCues(createSkidDetector(), 20, (tick) => walking(tick, 5)),
    ).toBe(0);
    expect(
      countCues(createSkidDetector(), 20, (tick) =>
        driving(tick, 5, tick * 0.2),
      ),
    ).toBe(0);
  });
});
