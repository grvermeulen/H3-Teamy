import { describe, expect, it } from "vitest";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createRng } from "./rng";
import {
  PARKED_CARS_PER_ZONE,
  chooseSpawnNode,
  nearestZone,
  roadHeadingAt,
  shuffle,
  spawnParkedCars,
} from "./spawn";

/** Twenty spawn nodes 10 m apart along y = 0 (40 units per node). */
const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [400, 0],
  radius: 2000,
  spawnNodes: Array.from({ length: 20 }, (_, index): [number, number] => [
    index * 40,
    0,
  ]),
  landmarks: [],
};
const otherZone: MapZone = {
  key: "rhenen",
  name: "Rhenen centrum",
  center: [40000, 0],
  radius: 2000,
  spawnNodes: [[40000, 0]],
  landmarks: [],
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [zone, otherZone],
  landmarks: [],
};
/** A road along y = 0 from x = 0 to 190 m with a spur north at x = 100 m (node coordinates in units). */
const graph = decodeRoadGraph({
  nodes: [0, 0, 760, 0, 400, 0, 400, -400],
  edges: [0, 2, 0, -1, 0, 400, 2, 1, 0, -1, 0, 360, 2, 3, 0, -1, 0, 400],
  classes: ["residential"],
  names: [],
});

describe("spawn", () => {
  it("shuffles deterministically for a seed without losing items", () => {
    const items = [1, 2, 3, 4, 5, 6];
    const first = shuffle(items, createRng(3));
    expect(first).toEqual(shuffle(items, createRng(3)));
    expect([...first].sort((left, right) => left - right)).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("reads the road heading at a point from the nearest node's first edge", () => {
    expect(roadHeadingAt(graph, [1, 1])).toBeCloseTo(0);
    expect(roadHeadingAt(graph, [189, 0])).toBeCloseTo(Math.PI);
    expect(roadHeadingAt(graph, [100, -99])).toBeCloseTo(Math.PI / 2);
    expect(roadHeadingAt(graph, [500, 500])).toBe(0);
  });

  it("parks up to eight seeded cars per zone on spawn nodes, spaced apart and away from the player", () => {
    const avoid: [number, number] = [0, 0];
    const cars = spawnParkedCars(index, graph, createRng(11), [avoid], 50);
    const campusCars = cars.filter((car) => car.x < 1000);
    expect(campusCars.length).toBeGreaterThanOrEqual(6);
    expect(campusCars.length).toBeLessThanOrEqual(PARKED_CARS_PER_ZONE);
    expect(cars.map((car) => car.id)).toEqual(
      cars.map((_, offset) => 50 + offset),
    );
    for (const car of campusCars) {
      expect(car.x % 10).toBe(0);
      expect(
        Math.hypot(car.x - avoid[0], car.y - avoid[1]),
      ).toBeGreaterThanOrEqual(8);
      expect(["compact", "sedan", "sport"]).toContain(car.kind);
      expect(car.colour).toBeLessThan(6);
    }
    for (const first of campusCars) {
      for (const second of campusCars) {
        if (first === second) continue;
        expect(
          Math.hypot(first.x - second.x, first.y - second.y),
        ).toBeGreaterThanOrEqual(12);
      }
    }
    expect(cars.filter((car) => car.x >= 1000)).toHaveLength(1);
    expect(spawnParkedCars(index, graph, createRng(11), [avoid], 50)).toEqual(
      cars,
    );
  });

  it("chooses a random node without threats and the farthest node from threats", () => {
    const free = chooseSpawnNode(zone, [], createRng(5));
    expect(free[1]).toBe(0);
    expect(free[0] % 10).toBe(0);
    expect(chooseSpawnNode(zone, [[0, 0]], createRng(5))).toEqual([190, 0]);
    expect([90, 100]).toContain(
      chooseSpawnNode(
        zone,
        [
          [0, 0],
          [190, 0],
        ],
        createRng(5),
      )[0],
    );
  });

  it("finds the nearest zone to a point outside every disc", () => {
    expect(nearestZone(index, [3000, 0])?.key).toBe("campus");
    expect(nearestZone(index, [9000, 0])?.key).toBe("rhenen");
    expect(nearestZone({ ...index, zones: [] }, [0, 0])).toBeNull();
  });
});
