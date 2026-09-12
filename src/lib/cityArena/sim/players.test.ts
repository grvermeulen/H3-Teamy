import { describe, expect, it } from "vitest";
import type { MapIndex } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import {
  driverPlayer,
  localPlayer,
  playerById,
  playersOf,
  replacePlayer,
} from "./players";
import { createRng } from "./rng";

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};
const graph = decodeRoadGraph({ nodes: [], edges: [], classes: [], names: [] });

describe("player accessors", () => {
  it("lists, finds and replaces the local player by id", () => {
    const state = createArenaState(
      { index, graph, seed: 1, zone: null },
      createRng(1),
    );
    expect(playersOf(state)).toEqual([localPlayer(state)]);
    expect(playerById(state, 0)).toBe(localPlayer(state));
    expect(playerById(state, 7)).toBeNull();
    const moved = replacePlayer(state, { ...localPlayer(state), x: 42 });
    expect(localPlayer(moved).x).toBe(42);
    expect(replacePlayer(state, { ...localPlayer(state), id: 9, x: 1 })).toBe(
      state,
    );
  });

  it("finds the player driving a car", () => {
    const state = createArenaState(
      { index, graph, seed: 1, zone: null },
      createRng(1),
    );
    const seated = replacePlayer(state, {
      ...localPlayer(state),
      vehicleId: 5,
    });
    expect(driverPlayer(seated, 5)).toBe(localPlayer(seated));
    expect(driverPlayer(seated, 6)).toBeNull();
    expect(driverPlayer(state, 5)).toBeNull();
  });
});
