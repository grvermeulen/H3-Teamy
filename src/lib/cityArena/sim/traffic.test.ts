import { describe, expect, it } from "vitest";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import { createRng } from "./rng";
import {
  TRAFFIC_MAX_SPEED_MPS,
  TRAFFIC_MIN_SPEED_MPS,
  TRAFFIC_SPAWN_RADIUS_M,
  advanceDriver,
  createTrafficCar,
  driverTarget,
  extendPath,
  isAiEdge,
  isTrafficEdge,
  nextTrafficNode,
  obstaclePoints,
  spawnTraffic,
  stepDrivers,
  trafficEdgesWithin,
  pickTrafficKind,
} from "./traffic";
import type { ArenaState, DriverState, PedState } from "./types";
import { createVehicle, forwardSpeed } from "./vehicle";
import type { RoadClass } from "../world/mapTypes";

const graph = decodeRoadGraph({
  nodes: [0, 0, 400, 0, 400, 400, 0, 400, 800, 0],
  edges: [
    0, 1, 0, -1, 0, 400, 1, 2, 0, -1, 0, 400, 2, 3, 0, -1, 0, 400, 3, 0, 0, -1,
    0, 400, 1, 4, 1, -1, 0, 400,
  ],
  classes: ["tertiary", "service"],
  names: [],
});
const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [200, 200],
  radius: 2000,
  spawnNodes: [[0, 0]],
  landmarks: [],
};
const emptyIndex: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};

function driverOf(fromNode: number | null, path: number[]): DriverState {
  return {
    vehicleId: 600,
    role: "traffic",
    cruiseMps: 10,
    fromNode,
    path,
    repathTick: 0,
  };
}

function standingPed(id: number, x: number, y: number): PedState {
  return {
    id,
    x,
    y,
    facing: 0,
    health: 40,
    mode: "walk",
    modeUntilTick: 0,
    rail: null,
    fleeX: 0,
    fleeY: 0,
  };
}

describe("traffic drivers", () => {
  it("classifies roads, chooses seeded turns and targets a shifted lane", () => {
    expect(isTrafficEdge(graph.edges[0])).toBe(true);
    expect(isTrafficEdge(graph.edges[4])).toBe(false);
    expect(isAiEdge(graph.edges[4])).toBe(false);
    expect(nextTrafficNode(graph, 1, 0, () => 0)).toBe(2);
    expect(nextTrafficNode(graph, 1, 0, () => 0.99)).toBe(2);
    expect(extendPath(graph, driverOf(0, [1]), () => 0).path).toEqual([1, 2]);
    expect(driverTarget(graph, driverOf(0, [1, 2]))?.[1]).toBeCloseTo(1.75);
    const car = createVehicle(600, "sedan", [97, 1.75], 0, 0);
    expect(advanceDriver(graph, driverOf(0, [1, 2]), car)).toEqual(
      driverOf(1, [2]),
    );
  });

  it("spawns deterministic rolling traffic on through-roads", () => {
    expect(trafficEdgesWithin(graph, [50, 50], 60)).toEqual([0, 1, 2, 3]);
    const cars = spawnTraffic(
      zone,
      graph,
      createRng(4),
      [[0, 0]],
      [],
      null,
      700,
      5,
    );
    expect(cars.map((car) => car.vehicle.id)).toEqual([
      700, 701, 702, 703, 704,
    ]);
    for (const car of cars) {
      expect(car.driver.role).toBe("traffic");
      expect(car.driver.cruiseMps).toBeGreaterThanOrEqual(
        TRAFFIC_MIN_SPEED_MPS,
      );
      expect(car.driver.cruiseMps).toBeLessThanOrEqual(TRAFFIC_MAX_SPEED_MPS);
      expect(forwardSpeed(car.vehicle)).toBeCloseTo(car.driver.cruiseMps);
    }
    expect(
      spawnTraffic(zone, graph, createRng(4), [[0, 0]], [], null, 700, 5),
    ).toEqual(cars);
  });

  it("spawns traffic around the players when asked", () => {
    /** A 2 km tertiary road: 0–1000 m and 1000–2000 m. */
    const road = decodeRoadGraph({
      nodes: [0, 0, 4000, 0, 8000, 0],
      edges: [0, 1, 0, -1, 0, 4000, 1, 2, 0, -1, 0, 4000],
      classes: ["tertiary"],
      names: [],
    });
    const wide: MapZone = { ...zone, center: [4000, 0], radius: 8000 };
    const cars = spawnTraffic(
      wide,
      road,
      createRng(6),
      [[1000, 0]],
      [],
      null,
      700,
      6,
      [[1000, 0]],
    );
    expect(cars).toHaveLength(6);
    for (const car of cars) {
      const distance = Math.hypot(car.vehicle.x - 1000, car.vehicle.y);
      expect(distance).toBeGreaterThanOrEqual(30);
      expect(distance).toBeLessThanOrEqual(TRAFFIC_SPAWN_RADIUS_M + 5);
    }
  });

  it("lists obstacles and produces controls for active drivers", () => {
    const base = createArenaState(
      { index: emptyIndex, graph, seed: 3, zone: null },
      createRng(3),
    );
    const car = createTrafficCar(
      600,
      graph,
      { edge: 0, direction: 1, edgeT: 0.5, side: 1 },
      "sedan",
      0,
      10,
    );
    const state: ArenaState = {
      ...base,
      vehicles: [car.vehicle],
      traffic: [car.driver],
      peds: [standingPed(70, 60, 1.75)],
    };
    expect(obstaclePoints(state, car.driver)).toContainEqual([60, 1.75]);
    expect(
      stepDrivers(state, { graph }, () => 0, null).controls.get(600),
    ).toEqual({
      throttle: -1,
      steer: 0,
    });
  });
});

describe("pickTrafficKind", () => {
  const kindsOn = (roadClass: RoadClass): Set<string> =>
    new Set(
      Array.from({ length: 200 }, (_, index) =>
        pickTrafficKind(roadClass, () => (index % 100) / 100),
      ),
    );

  it("keeps buses to through-roads and never sends a sport car out as traffic", () => {
    expect(kindsOn("primary").has("bus")).toBe(true);
    expect(kindsOn("tertiary").has("bus")).toBe(true);
    expect(kindsOn("unclassified").has("bus")).toBe(false);
    for (const roadClass of [
      "primary",
      "secondary",
      "tertiary",
      "unclassified",
    ] as const)
      expect(kindsOn(roadClass).has("sport")).toBe(false);
  });

  it("sends a tractor down an unclassified road three times in ten, and nowhere else", () => {
    expect(pickTrafficKind("unclassified", () => 0.29)).toBe("tractor");
    expect(pickTrafficKind("unclassified", () => 0.3)).not.toBe("tractor");
    expect(pickTrafficKind("primary", () => 0.1)).not.toBe("tractor");
  });
});
