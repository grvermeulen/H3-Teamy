import { describe, expect, it } from "vitest";
import type { MapZone } from "../world/mapTypes";
import { createCamera } from "./camera";
import { drawPlayer, drawZoneRing } from "./drawEntities";
import { PLAYER_FILL, ZONE_RING } from "./palette";
import { createFakeContext } from "./testing/fakeContext";

describe("drawEntities", () => {
  it("draws the player as a ringed circle at its screen position with a facing tick", () => {
    const context = createFakeContext();
    drawPlayer(
      context,
      createCamera([10, 10], 8),
      { width: 200, height: 100 },
      { x: 12, y: 10, facing: 0, speed: 4 },
    );
    expect(context.calls).toContain("arc(116,50,6,0,6.28,false)");
    expect(context.calls).toContain(`fill(${PLAYER_FILL})`);
    expect(context.calls).toContain("lineTo(126,50)");
  });

  it("draws a dashed zone ring", () => {
    const zone: MapZone = {
      key: "campus",
      name: "WUR-campus",
      center: [0, 0],
      radius: 2000,
      spawnNodes: [],
      landmarks: [],
    };
    const context = createFakeContext();
    drawZoneRing(
      context,
      createCamera([0, 0], 4),
      { width: 200, height: 100 },
      zone,
    );
    expect(context.calls).toContain("arc(100,50,2000,0,6.28,false)");
    expect(context.calls).toContain(`stroke(${ZONE_RING},2)`);
    expect(context.calls).toContain("setLineDash(8,6)");
  });
});
