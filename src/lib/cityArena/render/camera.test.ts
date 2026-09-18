import { describe, expect, it } from "vitest";
import {
  createCamera,
  DRIVING_LOOK_AHEAD_MAX_M,
  screenToWorld,
  speedZoom,
  rasterZoomFor,
  updateSpeedCamera,
  updateCamera,
  visibleRect,
  worldToScreen,
  zoomLevelForViewport,
} from "./camera";

describe("camera", () => {
  it("quantises zoom so phones see about 45 m and desktops about 120 m", () => {
    expect(zoomLevelForViewport(300)).toBe(6);
    expect(zoomLevelForViewport(360)).toBe(8);
    expect(zoomLevelForViewport(390)).toBe(8);
    expect(zoomLevelForViewport(430)).toBe(10);
    expect(zoomLevelForViewport(800)).toBe(6);
    expect(zoomLevelForViewport(1400)).toBe(12);
  });

  it("opens the view continuously with speed, even below the smallest raster scale", () => {
    expect(speedZoom(8, 0)).toBeCloseTo(8.96);
    expect(speedZoom(8, 8)).toBe(8);
    expect(speedZoom(8, 18)).toBeCloseTo(6.56);
    expect(speedZoom(4, 36)).toBeCloseTo(2.48);
    expect(speedZoom(8, -8)).toBe(speedZoom(8, 8));
    expect(Math.abs(speedZoom(8, 11.99) - speedZoom(8, 12.01))).toBeLessThan(
      0.01,
    );
    expect(rasterZoomFor(7.1, 6)).toBe(6);
    expect(rasterZoomFor(7.3, 6)).toBe(8);
    expect(rasterZoomFor(6.9, 8)).toBe(8);
  });

  it("keeps fractional zoom aiming and visibility aligned", () => {
    const camera = createCamera([17, -40], 5.37);
    const viewport = { width: 390, height: 800 };
    const screen = worldToScreen(camera, viewport, [28, -60]);
    expect(screenToWorld(camera, viewport, screen)[0]).toBeCloseTo(28);
    expect(screenToWorld(camera, viewport, screen)[1]).toBeCloseTo(-60);
    expect(visibleRect(camera, viewport).maxX).toBeCloseTo(17 + 195 / 5.37);
  });

  it("smooths zoom at different frame rates and respects reduced motion", () => {
    const viewport = { width: 1200, height: 800 };
    const results = [30, 60, 120].map((fps) => {
      let camera = createCamera([0, 0], 8);
      for (let frame = 0; frame < fps * 3; frame++)
        camera = updateSpeedCamera(
          camera,
          8,
          [0, 0],
          [30, 0],
          1 / fps,
          true,
          viewport,
        );
      return camera;
    });
    for (const camera of results) {
      expect(camera.zoom).toBeCloseTo(5.44, 2);
      expect(camera.x).toBeCloseTo(results[0].x, 1);
    }
    let slow = createCamera([0, 0], 8);
    let fast = createCamera([0, 0], 8);
    for (let frame = 0; frame < 180; frame++) {
      slow = updateSpeedCamera(
        slow,
        8,
        [0, 0],
        [2, 0],
        1 / 60,
        true,
        viewport,
        false,
      );
      fast = updateSpeedCamera(
        fast,
        8,
        [0, 0],
        [36, 0],
        1 / 60,
        true,
        viewport,
        false,
      );
    }
    expect(slow.zoom).toBe(fast.zoom);
    expect(fast.x).toBeLessThanOrEqual(2);
  });

  it("filters reversal and bounds look-ahead to the phone viewport", () => {
    const viewport = { width: 390, height: 300 };
    let camera = createCamera([0, 0], 8);
    for (let frame = 0; frame < 180; frame++)
      camera = updateSpeedCamera(
        camera,
        8,
        [0, 0],
        [36, 0],
        1 / 60,
        true,
        viewport,
      );
    expect(camera.x).toBeLessThanOrEqual(300 / camera.zoom / 4);
    const reversed = updateSpeedCamera(
      camera,
      8,
      [0, 0],
      [-36, 0],
      1 / 60,
      true,
      viewport,
    );
    expect(Math.abs(reversed.x - camera.x)).toBeLessThan(0.1);
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
