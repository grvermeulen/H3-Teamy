import { describe, expect, it } from "vitest";
import {
  createCamera,
  DRIVING_LOOK_AHEAD_MAX_M,
  screenToWorld,
  updateCamera,
  visibleRect,
  worldToScreen,
  zoomLevelForViewport,
} from "./camera";

describe("camera", () => {
  it("quantises zoom so phones see about 60 m and desktops about 120 m", () => {
    expect(zoomLevelForViewport(390)).toBe(6);
    expect(zoomLevelForViewport(300)).toBe(4);
    expect(zoomLevelForViewport(800)).toBe(6);
    expect(zoomLevelForViewport(1400)).toBe(8);
  });

  it("maps between world and screen around the camera centre", () => {
    const camera = createCamera([100, 200], 8);
    const viewport = { width: 400, height: 300 };
    expect(worldToScreen(camera, viewport, [100, 200])).toEqual([200, 150]);
    expect(worldToScreen(camera, viewport, [110, 190])).toEqual([280, 70]);
    expect(screenToWorld(camera, viewport, [280, 70])).toEqual([110, 190]);
    expect(visibleRect(camera, viewport)).toEqual({
      minX: 75,
      minY: 181.25,
      maxX: 125,
      maxY: 218.75,
    });
  });

  it("eases toward the target with a capped look-ahead", () => {
    let camera = createCamera([0, 0], 6);
    for (let step = 0; step < 300; step++)
      camera = updateCamera(camera, [50, 0], [4, 0], 1 / 60);
    expect(camera.x).toBeCloseTo(51.6, 1);
    expect(camera.y).toBeCloseTo(0);
    let fast = createCamera([0, 0], 6);
    for (let step = 0; step < 300; step++)
      fast = updateCamera(fast, [0, 0], [1000, 0], 1 / 60);
    expect(fast.x).toBeCloseTo(15, 1);
  });

  it("leads further ahead when driving asks for the larger cap", () => {
    let camera = createCamera([0, 0], 6);
    for (let step = 0; step < 300; step++)
      camera = updateCamera(
        camera,
        [0, 0],
        [1000, 0],
        1 / 60,
        DRIVING_LOOK_AHEAD_MAX_M,
      );
    expect(camera.x).toBeCloseTo(30, 1);
  });
});
