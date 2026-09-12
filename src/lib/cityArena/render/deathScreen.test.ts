import { describe, expect, it } from "vitest";
import { deathScreenPhase } from "./deathScreen";

describe("deathScreenPhase", () => {
  it("runs slow motion with a push-in for the first 0.3 s", () => {
    const phase = deathScreenPhase(0.1, false);
    expect(phase).toMatchObject({
      stage: "slowmo",
      timeScale: 0.25,
      artVisible: false,
      blackout: 0,
    });
    expect(phase.pushIn).toBeCloseTo(1.0267, 3);
    expect(deathScreenPhase(-1, false).stage).toBe("slowmo");
  });

  it("slams the artwork in from 1.15× with an overshoot and settles by 0.55 s", () => {
    expect(deathScreenPhase(0.3, false)).toMatchObject({
      stage: "art",
      timeScale: 1,
      pushIn: 1.08,
      artVisible: true,
    });
    expect(deathScreenPhase(0.3, false).artScale).toBeCloseTo(1.15);
    expect(deathScreenPhase(0.425, false).artScale).toBeCloseTo(0.947, 2);
    expect(deathScreenPhase(0.55, false).artScale).toBe(1);
    expect(deathScreenPhase(1.5, false).artScale).toBe(1);
  });

  it("fades to black between 2.6 s and 3.0 s and stays black", () => {
    const fade = deathScreenPhase(2.8, false);
    expect(fade).toMatchObject({
      stage: "fade",
    });
    expect(fade.blackout).toBeCloseTo(0.5);
    expect(deathScreenPhase(3, false)).toMatchObject({
      stage: "black",
      blackout: 1,
    });
    expect(deathScreenPhase(9, false)).toMatchObject({
      stage: "black",
      blackout: 1,
    });
  });

  it("skips slow motion, push-in and overshoot under reduced motion", () => {
    expect(deathScreenPhase(0.1, true)).toMatchObject({
      stage: "slowmo",
      timeScale: 1,
      pushIn: 1,
    });
    expect(deathScreenPhase(0.35, true)).toMatchObject({
      stage: "art",
      pushIn: 1,
      artScale: 1,
    });
  });
});
