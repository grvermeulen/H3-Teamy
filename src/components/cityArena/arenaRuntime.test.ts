import { describe, expect, it } from "vitest";
import { createCamera } from "@/lib/cityArena/render/camera";
import { canApplyRuntimeUpdate, nextCamera } from "./arenaRuntime";

describe("arena runtime async guards", () => {
  it("rejects callbacks after runtime disposal", () => {
    expect(canApplyRuntimeUpdate({ disposed: false })).toBe(true);
    expect(canApplyRuntimeUpdate({ disposed: true })).toBe(false);
  });
});

describe("nextCamera", () => {
  it("holds the viewport zoom on foot and widens one step at driving speed", () => {
    const start = createCamera([0, 0], 8);
    const walking = nextCamera(start, 8, [10, 0], [5.5, 0], 1 / 30, false);
    expect(walking.zoom).toBe(8);
    expect(walking.x).toBeGreaterThan(0);
    expect(nextCamera(start, 8, [10, 0], [20, 0], 1 / 30, true).zoom).toBe(6);
  });

  it("leads further ahead while driving", () => {
    let onFoot = createCamera([0, 0], 8);
    let inCar = createCamera([0, 0], 8);
    for (let frame = 0; frame < 300; frame++) {
      onFoot = nextCamera(onFoot, 8, [0, 0], [1000, 0], 1 / 60, false);
      inCar = nextCamera(inCar, 8, [0, 0], [1000, 0], 1 / 60, true);
    }
    expect(onFoot.x).toBeCloseTo(15, 1);
    expect(inCar.x).toBeCloseTo(30, 1);
  });
});
