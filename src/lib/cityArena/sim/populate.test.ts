import { describe, expect, it } from "vitest";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import { applyPopulation, populateZone } from "./populate";
import { createRng } from "./rng";

const west: MapZone = {
  key: "wageningen",
  name: "Wageningen centrum",
  center: [0, 0],
  radius: 2000,
  spawnNodes: [
    [0, 0],
    [400, 0],
    [800, 0],
  ],
  landmarks: [],
};
const east: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [12000, 0],
  radius: 2000,
  spawnNodes: [
    [12000, 0],
    [12400, 0],
    [12800, 0],
  ],
  landmarks: [],
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [west, east],
  landmarks: [],
};
const graph = decodeRoadGraph({
  nodes: [0, 0, 800, 0, 12000, 0, 12800, 0],
  edges: [0, 1, 0, -1, 0, 800, 2, 3, 0, -1, 0, 800],
  classes: ["residential"],
  names: [],
});

describe("population", () => {
  it("populates the start zone and repopulates after a zone change", () => {
    const state = createArenaState(
      { index, graph, seed: 5, zone: west },
      createRng(5),
    );
    expect(state.activeZoneKey).toBe("wageningen");
    expect(state.pickups).toHaveLength(2);
    for (const pickup of state.pickups) expect(pickup.x).toBeLessThan(1000);
    const random = createRng(9);
    expect(applyPopulation(state, { index, graph }, random)).toBe(state);
    const moved = { ...state, player: { ...state.player, x: 3050, y: 0 } };
    const repopulated = applyPopulation(moved, { index, graph }, random);
    expect(repopulated.activeZoneKey).toBe("campus");
    expect(repopulated.pickups).toHaveLength(3);
    for (const pickup of repopulated.pickups)
      expect(pickup.x).toBeGreaterThanOrEqual(3000);
    expect(repopulated.nextId).toBe(state.nextId + 3);
  });

  it("keeps the player's car when changing zones", () => {
    const state = createArenaState(
      { index, graph, seed: 5, zone: west },
      createRng(5),
    );
    const car = state.vehicles[0];
    const seated = { ...state, player: { ...state.player, vehicleId: car.id } };
    const repopulated = populateZone(seated, east, index, graph, createRng(2));
    expect(repopulated.vehicles.map((vehicle) => vehicle.id)).toContain(car.id);
    expect(repopulated.activeZoneKey).toBe("campus");
  });
});
