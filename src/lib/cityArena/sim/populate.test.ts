import { localPlayer } from "./players";
import { describe, expect, it } from "vitest";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import { PEDS_PER_ZONE, PED_RECYCLE_DISTANCE_M } from "./peds";
import {
  applyPopulation,
  populateZone,
  populationAnchorZone,
  topUpPeds,
  topUpTraffic,
} from "./populate";
import { createRng } from "./rng";
import { TRAFFIC_RECYCLE_DISTANCE_M, TRAFFIC_SPAWN_RADIUS_M } from "./traffic";
import type { ArenaState } from "./types";

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
    expect(applyPopulation(state, { index, graph }, 1, random)).toBe(state);
    const moved = {
      ...state,
      players: [{ ...localPlayer(state), x: 3050, y: 0 }],
    };
    const repopulated = applyPopulation(moved, { index, graph }, 1, random);
    expect(repopulated.activeZoneKey).toBe("campus");
    expect(repopulated.pickups).toHaveLength(3);
    for (const pickup of repopulated.pickups)
      expect(pickup.x).toBeGreaterThanOrEqual(3000);
    expect(repopulated.nextId).toBe(state.nextId + 3 + repopulated.peds.length);
  });

  it("anchors on the enforced zone rather than on a player who wandered off", () => {
    const state = createArenaState(
      { index, graph, seed: 5, zone: west },
      createRng(5),
    );
    const wandered: ArenaState = {
      ...state,
      zoneEnforced: true,
      enforcedZoneKey: "wageningen",
      players: [{ ...localPlayer(state), x: 12000, y: 0 }],
    };
    expect(populationAnchorZone(wandered, index)?.key).toBe("wageningen");
  });

  it("follows the lowest-id living player while no zone is enforced", () => {
    const state = createArenaState(
      { index, graph, seed: 5, zone: west },
      createRng(5),
    );
    const first = localPlayer(state);
    const both: ArenaState = {
      ...state,
      players: [
        { ...first, x: 0, y: 0 },
        { ...first, id: first.id + 1, x: 12000, y: 0 },
      ],
    };
    expect(populationAnchorZone(both, index)?.key).toBe("wageningen");
    const firstDead: ArenaState = {
      ...both,
      players: [
        { ...both.players[0], health: 0, diedAtTick: 1 },
        both.players[1],
      ],
    };
    expect(populationAnchorZone(firstDead, index)?.key).toBe("campus");
  });

  it("spawns pedestrians and tops them up in batches", () => {
    const state = createArenaState(
      { index, graph, seed: 5, zone: west },
      createRng(5),
    );
    expect(state.peds).toHaveLength(PEDS_PER_ZONE);
    for (const ped of state.peds) {
      expect(Math.abs(ped.y)).toBeCloseTo(4);
      expect(
        Math.hypot(ped.x - localPlayer(state).x, ped.y - localPlayer(state).y),
      ).toBeGreaterThanOrEqual(30);
    }
    const thinned = { ...state, peds: state.peds.slice(0, 10) };
    const random = createRng(8);
    expect(applyPopulation(thinned, { index, graph }, 29, random)).toBe(
      thinned,
    );
    const topped = applyPopulation(thinned, { index, graph }, 30, random);
    expect(topped.peds).toHaveLength(15);
    expect(topUpPeds(topped, west, { index, graph }, random).peds).toHaveLength(
      20,
    );
    expect(topUpPeds(state, west, { index, graph }, random)).toBe(state);
  });

  it("recycles pedestrians the player left behind and puts them back nearby", () => {
    const state = createArenaState(
      { index, graph, seed: 5, zone: west },
      createRng(5),
    );
    const player = localPlayer(state);
    const farX = player.x + PED_RECYCLE_DISTANCE_M + 100;
    const [left, ...rest] = state.peds;
    const wandered: ArenaState = {
      ...state,
      peds: [{ ...left, x: farX }, ...rest],
    };
    const topped = topUpPeds(wandered, west, { index, graph }, createRng(9));
    expect(topped.peds).toHaveLength(PEDS_PER_ZONE);
    expect(topped.peds.map((ped) => ped.id)).not.toContain(left.id);
    expect(topped.peds.at(-1)?.id).toBe(state.nextId);
    for (const ped of topped.peds)
      expect(Math.hypot(ped.x - player.x, ped.y - player.y)).toBeLessThan(
        PED_RECYCLE_DISTANCE_M,
      );
    const viewRect = { minX: farX - 10, minY: -10, maxX: farX + 10, maxY: 10 };
    expect(
      topUpPeds(wandered, west, { index, graph, viewRect }, createRng(9)),
    ).toBe(wandered);
  });

  it("recycles ambient cars the player left behind, but not police, wrecks or occupied cars", () => {
    /** A 200 m tertiary road, so traffic can spawn. */
    const road = decodeRoadGraph({
      nodes: [0, 0, 800, 0],
      edges: [0, 1, 0, -1, 0, 800],
      classes: ["tertiary"],
      names: [],
    });
    const state = createArenaState(
      { index, graph: road, seed: 5, zone: west },
      createRng(5),
    );
    const player = localPlayer(state);
    const [gone, wreck, patrol, taxi] = state.traffic;
    expect(taxi).toBeDefined();
    const farX = player.x + TRAFFIC_RECYCLE_DISTANCE_M + 100;
    const moved = new Map([
      [gone.vehicleId, { x: farX, wrecked: false }],
      [wreck.vehicleId, { x: farX, wrecked: true }],
      [patrol.vehicleId, { x: farX, wrecked: false }],
      [taxi.vehicleId, { x: farX, wrecked: false }],
    ]);
    const wandered: ArenaState = {
      ...state,
      players: [{ ...player, vehicleId: taxi.vehicleId }],
      vehicles: state.vehicles.map((vehicle) => ({
        ...vehicle,
        ...moved.get(vehicle.id),
      })),
      traffic: state.traffic.map((driver) =>
        driver === patrol ? { ...driver, role: "police" } : driver,
      ),
    };
    const topped = topUpTraffic(
      wandered,
      west,
      { index, graph: road },
      createRng(9),
    );
    const vehicleIds = topped.vehicles.map((vehicle) => vehicle.id);
    const driverIds = topped.traffic.map((driver) => driver.vehicleId);
    expect(vehicleIds).not.toContain(gone.vehicleId);
    expect(driverIds).not.toContain(gone.vehicleId);
    for (const kept of [wreck, patrol, taxi]) {
      expect(vehicleIds).toContain(kept.vehicleId);
      expect(driverIds).toContain(kept.vehicleId);
    }
    const fresh = topped.vehicles.find(
      (vehicle) => vehicle.id === wandered.nextId,
    );
    expect(fresh).toBeDefined();
    expect(Math.hypot((fresh?.x ?? 0) - player.x, fresh?.y ?? 0)).toBeLessThan(
      TRAFFIC_SPAWN_RADIUS_M + 5,
    );
    const viewRect = { minX: farX - 10, minY: -10, maxX: farX + 10, maxY: 10 };
    const seen = topUpTraffic(
      wandered,
      west,
      { index, graph: road, viewRect },
      createRng(9),
    );
    expect(seen.vehicles.map((vehicle) => vehicle.id)).toContain(
      gone.vehicleId,
    );
  });

  it("keeps the player's car when changing zones", () => {
    const state = createArenaState(
      { index, graph, seed: 5, zone: west },
      createRng(5),
    );
    const car = state.vehicles[0];
    const seated = {
      ...state,
      players: [{ ...localPlayer(state), vehicleId: car.id }],
    };
    const repopulated = populateZone(seated, east, index, graph, createRng(2));
    expect(repopulated.vehicles.map((vehicle) => vehicle.id)).toContain(car.id);
    expect(repopulated.activeZoneKey).toBe("campus");
  });
});
