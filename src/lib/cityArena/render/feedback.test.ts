import { describe, expect, it } from "vitest";
import { createArenaPlayer } from "../sim/roster";
import type { ArenaEvent, ArenaPlayerState } from "../sim/types";
import {
  HIT_MARKER_TICKS,
  INITIAL_FEEDBACK,
  LOW_HEALTH,
  SHAKE_EXPLOSION_PX,
  SHAKE_HIT_PX,
  SHAKE_RADIUS_M,
  VIGNETTE_TICKS,
  drawFeedback,
  shakeOffset,
  stepFeedback,
  type FeedbackFrame,
  type FeedbackState,
} from "./feedback";
import { createFakeContext } from "./testing/fakeContext";

/** This client's player at the origin. */
function me(overrides: Partial<ArenaPlayerState> = {}): ArenaPlayerState {
  return { ...createArenaPlayer([0, 0], 0), id: 7, ...overrides };
}

/** One tick with nothing happening unless overridden. */
function frame(overrides: Partial<FeedbackFrame> = {}): FeedbackFrame {
  return { tick: 1, events: [], me: me(), reducedMotion: false, ...overrides };
}

/** The state after a first, quiet tick at full health. */
function settled(): FeedbackState {
  return stepFeedback(INITIAL_FEEDBACK, frame());
}

/** Runs `ticks` quiet ticks from `state`. */
function quiet(state: FeedbackState, ticks: number): FeedbackState {
  let next = state;
  for (let index = 0; index < ticks; index += 1)
    next = stepFeedback(next, frame({ tick: 2 + index }));
  return next;
}

const SIZE = { width: 300, height: 200 };

describe("stepFeedback", () => {
  it("is all zero when nothing has happened", () => {
    expect(settled()).toEqual({
      health: 100,
      vignette: 0,
      shake: 0,
      hitMarkerTicks: 0,
      throb: 0,
    });
  });

  it("flashes the vignette on damage and fades it out over twelve ticks", () => {
    const hurt = stepFeedback(settled(), frame({ me: me({ health: 70 }) }));
    expect(hurt.vignette).toBe(1);
    expect(hurt.shake).toBe(SHAKE_HIT_PX);
    const later = quiet(hurt, VIGNETTE_TICKS - 1);
    expect(later.vignette).toBeGreaterThan(0);
    expect(quiet(hurt, VIGNETTE_TICKS).vignette).toBe(0);
  });

  it("does not read a respawn as damage", () => {
    const dead = stepFeedback(settled(), frame({ me: me({ health: 0 }) }));
    const respawned = stepFeedback(
      quiet(dead, VIGNETTE_TICKS),
      frame({ me: me({ health: 100 }) }),
    );
    expect(respawned.vignette).toBe(0);
    expect(respawned.shake).toBe(0);
  });

  it("shakes ten pixels for a nearby explosion, four for a hit, and decays", () => {
    const near: ArenaEvent = { kind: "explosion", x: 5, y: 5 };
    const far: ArenaEvent = { kind: "explosion", x: SHAKE_RADIUS_M + 5, y: 0 };
    expect(stepFeedback(settled(), frame({ events: [far] })).shake).toBe(0);
    const shaken = stepFeedback(settled(), frame({ events: [near] }));
    expect(shaken.shake).toBe(SHAKE_EXPLOSION_PX);
    const next = stepFeedback(shaken, frame({ tick: 2 }));
    expect(next.shake).toBeLessThan(SHAKE_EXPLOSION_PX);
    expect(next.shake).toBeGreaterThan(0);
    expect(quiet(shaken, 20).shake).toBe(0);
  });

  it("never shakes under reduced motion, though the vignette still plays", () => {
    const near: ArenaEvent = { kind: "explosion", x: 5, y: 5 };
    const state = stepFeedback(
      settled(),
      frame({ events: [near], me: me({ health: 60 }), reducedMotion: true }),
    );
    expect(state.shake).toBe(0);
    expect(state.vignette).toBe(1);
  });

  it("shows the hit marker for a few ticks when one of my shots lands", () => {
    const mine: ArenaEvent = {
      kind: "hit",
      target: "ped",
      ownerId: 7,
      x: 0,
      y: 0,
    };
    const theirs: ArenaEvent = {
      kind: "hit",
      target: "ped",
      ownerId: 2,
      x: 0,
      y: 0,
    };
    const car: ArenaEvent = {
      kind: "hit",
      target: "vehicle",
      ownerId: 7,
      x: 0,
      y: 0,
    };
    expect(
      stepFeedback(settled(), frame({ events: [theirs, car] })).hitMarkerTicks,
    ).toBe(0);
    const landed = stepFeedback(settled(), frame({ events: [mine] }));
    expect(landed.hitMarkerTicks).toBe(HIT_MARKER_TICKS);
    expect(quiet(landed, HIT_MARKER_TICKS).hitMarkerTicks).toBe(0);
  });

  it("throbs while health is low, and not otherwise", () => {
    const low = (tick: number) =>
      stepFeedback(
        settled(),
        frame({ tick, me: me({ health: LOW_HEALTH - 1 }) }),
      );
    const values = [0, 6, 12, 18].map((tick) => low(tick).throb);
    expect(values[0]).toBeCloseTo(0);
    expect(values[2]).toBeCloseTo(1);
    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(
      stepFeedback(settled(), frame({ me: me({ health: LOW_HEALTH }) })).throb,
    ).toBe(0);
  });
});

describe("shakeOffset", () => {
  it("is nothing without shake, and the same offset for the same tick", () => {
    expect(shakeOffset(INITIAL_FEEDBACK, 5)).toEqual({ x: 0, y: 0 });
    const state = { ...INITIAL_FEEDBACK, shake: 10 };
    const first = shakeOffset(state, 5);
    expect(shakeOffset(state, 5)).toEqual(first);
    expect(Math.abs(first.x)).toBeLessThanOrEqual(10);
    expect(Math.abs(first.y)).toBeLessThanOrEqual(10);
    expect(shakeOffset(state, 6)).not.toEqual(first);
  });
});

describe("drawFeedback", () => {
  it("draws nothing at all for a quiet state", () => {
    const context = createFakeContext();
    drawFeedback(context, SIZE, INITIAL_FEEDBACK);
    expect(context.calls).toEqual([]);
  });

  it("paints the red frame for a vignette and the marker for a landed shot", () => {
    const context = createFakeContext();
    drawFeedback(context, SIZE, {
      ...INITIAL_FEEDBACK,
      vignette: 1,
      hitMarkerTicks: 3,
    });
    expect(context.calls.some((call) => call.startsWith("fillRect("))).toBe(
      true,
    );
    expect(context.calls.some((call) => call.startsWith("stroke("))).toBe(true);
    expect(context.calls.at(-1)).toBe("restore()");
  });

  it("paints the heartbeat on its own, without a marker", () => {
    const context = createFakeContext();
    drawFeedback(context, SIZE, { ...INITIAL_FEEDBACK, throb: 0.5 });
    expect(context.calls.some((call) => call.startsWith("fillRect("))).toBe(
      true,
    );
    expect(context.calls.some((call) => call.startsWith("stroke("))).toBe(
      false,
    );
  });
});
