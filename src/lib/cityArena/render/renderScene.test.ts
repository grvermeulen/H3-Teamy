import { describe, expect, it } from "vitest";
import { createCamera } from "./camera";
import type { LandmarkLookup } from "./drawStatic";
import { renderScene } from "./renderScene";
import { createStaticRaster } from "./staticRaster";
import { createFakeContext } from "./testing/fakeContext";

describe("renderScene", () => {
  it("clips to the viewport rect, draws the world and the player, and restores", () => {
    const landmarks: LandmarkLookup = new Map();
    const raster = createStaticRaster(() => null);
    const context = createFakeContext();
    const stats = renderScene(
      context,
      {
        rect: { x: 10, y: 20, width: 100, height: 50 },
        camera: createCamera([0, 0], 4),
      },
      {
        world: { raster, tiles: [], landmarks, loadedTileRects: [] },
        player: { x: 0, y: 0, facing: 0, speed: 0 },
        zone: null,
      },
    );
    expect(context.calls[0]).toBe("save()");
    expect(context.calls).toContain("rect(10,20,100,50)");
    expect(context.calls).toContain("clip()");
    expect(context.calls).toContain("translate(10,20)");
    expect(context.calls.some((call) => call.startsWith("arc(50,25,"))).toBe(
      true,
    );
    expect(context.calls[context.calls.length - 1]).toBe("restore()");
    expect(stats.missing).toBeGreaterThan(0);
  });
});
