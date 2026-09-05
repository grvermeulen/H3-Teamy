import { describe, expect, it } from "vitest";
import type { MapIndex } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { createFreeRoamState, stepFreeRoam, teleportPlayer } from "./freeRoam";
import { createInput } from "./types";

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [
    {
      key: "campus",
      name: "WUR-campus",
      center: [0, 0],
      radius: 2000,
      spawnNodes: [],
      landmarks: [],
    },
  ],
  landmarks: [],
};
const world = {
  collision: { resolveCircle: (centre: Point): Point => centre },
  index,
};

describe("free roam", () => {
  it("starts at the spawn inside its zone and advances ticks", () => {
    const state = createFreeRoamState([10, 10], index);
    expect(state.player).toMatchObject({ x: 10, y: 10, speed: 0 });
    expect(state.zoneKey).toBe("campus");
    const next = stepFreeRoam(
      state,
      createInput({ move: [0, -1] }),
      1 / 30,
      world,
    );
    expect(next.tick).toBe(1);
    expect(next.player.y).toBeCloseTo(10 - 4 / 30);
  });

  it("leaves the zone when walking out of the disc and teleports back", () => {
    let state = createFreeRoamState([480, 0], index);
    for (let step = 0; step < 300; step++)
      state = stepFreeRoam(state, createInput({ move: [1, 0] }), 1 / 30, world);
    expect(state.player.x).toBeGreaterThan(500);
    expect(state.zoneKey).toBeNull();
    const back = teleportPlayer(state, [0, 0], index);
    expect(back.player).toMatchObject({ x: 0, y: 0, speed: 0 });
    expect(back.zoneKey).toBe("campus");
  });
});
