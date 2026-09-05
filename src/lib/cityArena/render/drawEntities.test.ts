import { describe, expect, it } from "vitest";
import { createArenaPlayer } from "../sim/arena";
import type { MapZone } from "../world/mapTypes";
import { createCamera } from "./camera";
import {
  DEAD_PLAYER_STYLE,
  drawPlayer,
  drawZoneRing,
  playerLook,
} from "./drawEntities";
import { PLAYER_DEAD_FILL, PLAYER_FILL, ZONE_RING } from "./palette";
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

  it("classifies the player look by car, death and the shield blink", () => {
    const player = createArenaPlayer([0, 0], 0);
    expect(playerLook(player, 10)).toBe("normal");
    expect(playerLook({ ...player, vehicleId: 3 }, 10)).toBe("hidden");
    expect(playerLook({ ...player, health: 0, diedAtTick: 5 }, 10)).toBe(
      "dead",
    );
    const shielded = { ...player, invulnerableUntilTick: 60 };
    expect(playerLook(shielded, 3)).toBe("normal");
    expect(playerLook(shielded, 4)).toBe("blink");
    expect(playerLook(shielded, 60)).toBe("normal");
  });

  it("draws a dead body in grey", () => {
    const context = createFakeContext();
    drawPlayer(
      context,
      createCamera([10, 10], 8),
      { width: 200, height: 100 },
      { x: 12, y: 10, facing: 0, speed: 0 },
      DEAD_PLAYER_STYLE,
    );
    expect(context.calls).toContain(`fill(${PLAYER_DEAD_FILL})`);
  });
});
