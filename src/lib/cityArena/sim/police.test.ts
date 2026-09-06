import { describe, expect, it } from "vitest";
import type { MapIndex } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import {
  POLICE_CHASE_MPS,
  POLICE_COLOUR,
  POLICE_REPATH_TICKS,
  createPoliceCar,
  managePoliceCars,
  policeChase,
  policeDrivers,
  policeSpawnPoints,
  replanPolice,
} from "./police";
import { createRng } from "./rng";
import type { ArenaState, DriverState } from "./types";
import { createVehicle } from "./vehicle";

/** A tertiary road east from the origin with service and residential spurs. */
const graph = decodeRoadGraph({
  nodes: [
    0, 0, 200, 0, 400, 0, 600, 0, 800, 0, 1000, 0, 1200, 0, 0, 400, 0, -320,
  ],
  edges: [
    0, 1, 0, -1, 0, 200, 1, 2, 0, -1, 0, 200, 2, 3, 0, -1, 0, 200, 3, 4, 0, -1,
    0, 200, 4, 5, 0, -1, 0, 200, 5, 6, 0, -1, 0, 200, 0, 7, 1, -1, 0, 400, 0, 8,
    2, -1, 0, 320,
  ],
  classes: ["tertiary", "service", "residential"],
  names: [],
});
const emptyIndex: MapIndex = {
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

/** The player at the origin with `heat`. */
function playerWithHeat(heat: number): ArenaState {
  const state = createArenaState(
    { index: emptyIndex, graph, seed: 3, zone: null },
    createRng(3),
  );
  return { ...state, player: { ...state.player, heat, heatTick: 0 } };
}

function driverOf(vehicleId: number): DriverState {
  return {
    vehicleId,
    role: "police",
    cruiseMps: POLICE_CHASE_MPS,
    fromNode: null,
    path: [],
    repathTick: 0,
  };
}

describe("police helpers", () => {
  it("filters police drivers and turns the wanted player into a ram order", () => {
    const traffic: DriverState[] = [
      driverOf(1),
      { ...driverOf(2), role: "traffic" },
    ];
    expect(policeDrivers(traffic)).toEqual([driverOf(1)]);
    expect(policeChase(playerWithHeat(0))).toBeNull();
    expect(policeChase(playerWithHeat(80))).toEqual({
      point: [0, 0],
      rangeM: 25,
    });
  });

  it("spawns only on drivable road nodes 60–120 m away and out of view", () => {
    const points = policeSpawnPoints(graph, [0, 0], null, createRng(1));
    expect(points).toHaveLength(2);
    expect(points).toContainEqual([100, 0]);
    expect(points).toContainEqual([0, -80]);
    expect(points).not.toContainEqual([0, 100]);
    const eastInView = { minX: 50, minY: -50, maxX: 150, maxY: 50 };
    expect(policeSpawnPoints(graph, [0, 0], eastInView, createRng(1))).toEqual([
      [0, -80],
    ]);
  });

  it("creates a police car headed along the road with a fresh driver", () => {
    const car = createPoliceCar(900, graph, [100, 0], 7);
    expect(car.vehicle).toMatchObject({
      id: 900,
      kind: "police",
      x: 100,
      y: 0,
      colour: POLICE_COLOUR,
      velocityX: 0,
      velocityY: 0,
    });
    expect([0, Math.PI]).toContainEqual(expect.closeTo(car.vehicle.heading, 5));
    expect(car.driver).toEqual({
      vehicleId: 900,
      role: "police",
      cruiseMps: POLICE_CHASE_MPS,
      fromNode: 2,
      path: [],
      repathTick: 7,
    });
  });

  it("re-plans a road route to the target without service roads", () => {
    const vehicle = createVehicle(
      900,
      "police",
      [300, 0],
      Math.PI,
      POLICE_COLOUR,
    );
    const planned = replanPolice(driverOf(900), vehicle, [0, 0], graph, 10);
    expect(planned).toMatchObject({ fromNode: 6, path: [5, 4, 3, 2, 1, 0] });
    expect(planned.repathTick).toBe(10 + POLICE_REPATH_TICKS);
    expect(replanPolice(planned, vehicle, [0, 0], graph, 20)).toBe(planned);
    const toSpur = replanPolice(driverOf(900), vehicle, [0, 100], graph, 10);
    expect(toSpur.path).toEqual([]);
    const toHouse = replanPolice(driverOf(900), vehicle, [0, -80], graph, 10);
    expect(toHouse.path).toEqual([5, 4, 3, 2, 1, 0, 8]);
  });
});

describe("managePoliceCars", () => {
  it("spawns one car at two stars and two at three, routing every 30 ticks", () => {
    const twoStars = managePoliceCars(
      playerWithHeat(80),
      { graph },
      1,
      createRng(2),
    );
    expect(policeDrivers(twoStars.traffic)).toHaveLength(1);
    const [driver] = policeDrivers(twoStars.traffic);
    const car = twoStars.vehicles.find(
      (vehicle) => vehicle.id === driver.vehicleId,
    );
    expect(car?.kind).toBe("police");
    expect(Math.hypot(car?.x ?? 0, car?.y ?? 0)).toBeGreaterThanOrEqual(60);
    expect(twoStars.nextId).toBe(twoStars.vehicles.length + 1);
    const routed = managePoliceCars(twoStars, { graph }, 2, createRng(2));
    expect(policeDrivers(routed.traffic)[0].path.length).toBeGreaterThan(0);
    expect(policeDrivers(routed.traffic)[0].repathTick).toBe(
      2 + POLICE_REPATH_TICKS,
    );
    const threeStars = managePoliceCars(
      { ...routed, player: { ...routed.player, heat: 120 } },
      { graph },
      3,
      createRng(2),
    );
    expect(policeDrivers(threeStars.traffic)).toHaveLength(2);
    expect(
      threeStars.vehicles.filter((vehicle) => vehicle.kind === "police"),
    ).toHaveLength(2);
    const inView = { minX: -200, minY: -200, maxX: 400, maxY: 200 };
    expect(
      managePoliceCars(
        playerWithHeat(80),
        { graph, viewRect: inView },
        1,
        createRng(2),
      ).traffic,
    ).toEqual([]);
  });

  it("releases drivers at level 0 and tows far, unseen driverless police cars", () => {
    const calm = playerWithHeat(0);
    const far = createPoliceCar(900, graph, [300, 0], 0);
    const near = createPoliceCar(901, graph, [100, 0], 0);
    const patrol: ArenaState = {
      ...calm,
      vehicles: [far.vehicle, near.vehicle],
      traffic: [far.driver, near.driver],
    };
    const released = managePoliceCars(patrol, { graph }, 1, createRng(2));
    expect(released.traffic).toEqual([]);
    expect(released.vehicles.map((vehicle) => vehicle.id)).toEqual([901]);
    const watched = managePoliceCars(
      patrol,
      { graph, viewRect: { minX: 250, minY: -50, maxX: 350, maxY: 50 } },
      1,
      createRng(2),
    );
    expect(watched.vehicles.map((vehicle) => vehicle.id)).toEqual([900, 901]);
    const stolen: ArenaState = {
      ...patrol,
      traffic: [],
      player: { ...patrol.player, vehicleId: 900 },
    };
    expect(managePoliceCars(stolen, { graph }, 1, createRng(2))).toBe(stolen);
  });
});
