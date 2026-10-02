import { describe, expect, it } from "vitest";
import type { ArenaState } from "../sim/types";
import {
  ASSIST_EYE_HEIGHT_M,
  ASSIST_FRICTION,
  ASSIST_RANGE_M,
  ASSIST_TARGET_HEIGHT_M,
  assistScale,
  assistTargets,
  type AssistCamera,
} from "./aimAssist";

/** Degrees to radians. */
const degrees = (value: number): number => (value * Math.PI) / 180;

/** A camera at the origin looking east (yaw 0), level. */
const camera: AssistCamera = {
  x: 0,
  y: 0,
  height: ASSIST_EYE_HEIGHT_M,
  yaw: 0,
  pitch: 0,
};

/** A character's chest `distance` metres away at `bearing` degrees off east. */
function targetAt(distance: number, bearing: number) {
  return {
    x: Math.cos(degrees(bearing)) * distance,
    y: Math.sin(degrees(bearing)) * distance,
    height: ASSIST_TARGET_HEIGHT_M,
  };
}

describe("assistScale", () => {
  it("slows the look with a target dead ahead", () => {
    expect(assistScale(camera, [targetAt(20, 0)])).toBe(ASSIST_FRICTION);
  });

  it("leaves the look alone 5° off a target", () => {
    expect(assistScale(camera, [targetAt(20, 5)])).toBe(1);
    expect(assistScale(camera, [targetAt(20, -5)])).toBe(1);
  });

  it("leaves the look alone with the target behind", () => {
    expect(assistScale(camera, [targetAt(20, 180)])).toBe(1);
  });

  it("leaves the look alone beyond range", () => {
    expect(assistScale(camera, [targetAt(ASSIST_RANGE_M + 1, 0)])).toBe(1);
  });

  it("leaves the look alone when it points at the sky over a target", () => {
    expect(
      assistScale({ ...camera, pitch: degrees(30) }, [targetAt(20, 0)]),
    ).toBe(1);
  });

  it("counts a close target's width, and any one target is enough", () => {
    expect(assistScale(camera, [targetAt(4, 6)])).toBe(ASSIST_FRICTION);
    expect(assistScale(camera, [targetAt(20, 90), targetAt(30, 1)])).toBe(
      ASSIST_FRICTION,
    );
    expect(assistScale(camera, [])).toBe(1);
  });
});

describe("assistTargets", () => {
  it("lists living other players, cops and peds, never yourself or the dead", () => {
    const state = {
      players: [
        { id: 0, x: 1, y: 1, health: 100, diedAtTick: null },
        { id: 1, x: 2, y: 2, health: 100, diedAtTick: null },
        { id: 2, x: 3, y: 3, health: 0, diedAtTick: 40 },
      ],
      cops: [
        { x: 4, y: 4, health: 60, diedAtTick: null },
        { x: 5, y: 5, health: 0, diedAtTick: 12 },
      ],
      peds: [
        { x: 6, y: 6, health: 30, mode: "walk" },
        { x: 7, y: 7, health: 30, mode: "flee" },
        { x: 8, y: 8, health: 0, mode: "dead" },
      ],
    } as unknown as ArenaState;
    const targets = assistTargets(state, 0);
    expect(targets.map((target) => target.x)).toEqual([2, 4, 6, 7]);
    expect(targets[0]!.height).toBe(ASSIST_TARGET_HEIGHT_M);
  });

  it("refills the list it is handed, reusing its targets, so a frame allocates nothing", () => {
    const crowd = {
      players: [],
      cops: [],
      peds: [
        { x: 6, y: 6, health: 30, mode: "walk" },
        { x: 7, y: 7, health: 30, mode: "walk" },
      ],
    } as unknown as ArenaState;
    const out: ReturnType<typeof assistTargets> = [];
    const first = assistTargets(crowd, 0, out);
    const reused = first[0];
    const fewer = assistTargets(
      { ...crowd, peds: crowd.peds.slice(0, 1) } as ArenaState,
      0,
      out,
    );
    expect(fewer).toBe(out);
    expect(fewer).toHaveLength(1);
    expect(fewer[0]).toBe(reused);
  });
});
