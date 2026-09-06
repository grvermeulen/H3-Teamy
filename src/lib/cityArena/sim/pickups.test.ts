import { describe, expect, it } from "vitest";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import {
  applyPickupToPlayer,
  canTakePickup,
  placePickups,
  stepPickups,
} from "./pickups";
import { createRng } from "./rng";
import type { ArenaState, PickupState } from "./types";

const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [700, 0],
  radius: 2000,
  spawnNodes: Array.from({ length: 8 }, (_, index): [number, number] => [
    index * 200,
    0,
  ]),
  landmarks: ["kerk", "cafe"],
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [zone],
  landmarks: [
    {
      key: "kerk",
      name: "Kerk",
      style: "church",
      center: [200, 0],
      tile: { x: 0, y: 0 },
    },
    {
      key: "cafe",
      name: "Cafe",
      style: "cafe",
      center: [1000, 0],
      tile: { x: 0, y: 0 },
    },
  ],
};
const graph = decodeRoadGraph({
  nodes: zone.spawnNodes.flat(),
  edges: Array.from({ length: 7 }, (_, edge) => [
    edge,
    edge + 1,
    0,
    -1,
    0,
    200,
  ]).flat(),
  classes: ["residential"],
  names: [],
});
const emptyIndex: MapIndex = { ...index, zones: [], landmarks: [] };

function pickupAt(kind: PickupState["kind"], x: number): PickupState {
  return { id: 900, kind, x, y: 0, takenAtTick: null };
}

function lonePlayer(): ArenaState {
  return createArenaState(
    { index: emptyIndex, graph, seed: 3, zone: null },
    createRng(3),
  );
}

describe("placePickups", () => {
  it("prioritises landmarks and alternates weapon kinds", () => {
    const pickups = placePickups(index, zone, graph, createRng(7), [], 100);
    expect(pickups).toHaveLength(8);
    expect(pickups.map((pickup) => pickup.kind)).toEqual([
      "uzi",
      "shotgun",
      "uzi",
      "shotgun",
      "uzi",
      "shotgun",
      "health",
      "health",
    ]);
    expect(pickups.map((pickup) => pickup.id)).toEqual([
      100, 101, 102, 103, 104, 105, 106, 107,
    ]);
    expect(pickups[0]).toMatchObject({ x: 50, y: 0, takenAtTick: null });
    expect(pickups[1]).toMatchObject({ x: 250, y: 0 });
    expect(new Set(pickups.map((pickup) => pickup.x)).size).toBe(8);
    expect(placePickups(index, zone, graph, createRng(7), [], 100)).toEqual(
      pickups,
    );
  });

  it("avoids the player and copes with few nodes", () => {
    const avoided = placePickups(
      index,
      zone,
      graph,
      createRng(7),
      [[100, 0]],
      1,
    );
    expect(avoided).toHaveLength(7);
    expect(avoided.some((pickup) => pickup.x === 100)).toBe(false);
    const fourNodes: MapZone = {
      ...zone,
      landmarks: [],
      spawnNodes: zone.spawnNodes.slice(0, 4),
    };
    const few = placePickups(index, fourNodes, graph, createRng(1), [], 1);
    expect(few.map((pickup) => pickup.kind)).toEqual([
      "uzi",
      "shotgun",
      "uzi",
      "shotgun",
    ]);
  });
});

describe("taking pickups", () => {
  it("only takes pickups that help and rearms magazine weapons", () => {
    const { player } = lonePlayer();
    expect(canTakePickup(player, pickupAt("uzi", 0))).toBe(true);
    expect(canTakePickup(player, pickupAt("health", 0))).toBe(false);
    expect(
      canTakePickup(
        { ...player, ammo: { uzi: 120, shotgun: 0 } },
        pickupAt("uzi", 0),
      ),
    ).toBe(false);
    const armed = applyPickupToPlayer(player, pickupAt("shotgun", 0));
    expect(armed).toMatchObject({
      weapon: "shotgun",
      ammo: { uzi: 0, shotgun: 8 },
    });
    const kept = applyPickupToPlayer(
      { ...armed, weapon: "shotgun" },
      pickupAt("uzi", 0),
    );
    expect(kept).toMatchObject({
      weapon: "shotgun",
      ammo: { uzi: 60, shotgun: 8 },
    });
    expect(
      applyPickupToPlayer({ ...player, health: 30 }, pickupAt("health", 0))
        .health,
    ).toBe(80);
  });

  it("takes an active pickup and respawns it after 600 ticks", () => {
    const state: ArenaState = {
      ...lonePlayer(),
      pickups: [pickupAt("uzi", 0.5)],
    };
    const taken = stepPickups(state, 5);
    expect(taken.player).toMatchObject({
      weapon: "uzi",
      ammo: { uzi: 60, shotgun: 0 },
    });
    expect(taken.pickups[0].takenAtTick).toBe(5);
    expect(taken.events).toEqual([
      { kind: "pickup", pickupKind: "uzi", playerId: 0, x: 0.5, y: 0 },
    ]);
    const away = { ...taken, player: { ...taken.player, x: 50 } };
    expect(stepPickups(away, 604).pickups[0].takenAtTick).toBe(5);
    expect(stepPickups(away, 605).pickups[0].takenAtTick).toBeNull();
  });

  it("ignores out-of-reach, seated, dead and full pickups", () => {
    const base = lonePlayer();
    expect(
      stepPickups({ ...base, pickups: [pickupAt("uzi", 1.3)] }, 1).player.ammo
        .uzi,
    ).toBe(0);
    const seated: ArenaState = {
      ...base,
      pickups: [pickupAt("uzi", 0.5)],
      player: { ...base.player, vehicleId: 4 },
    };
    expect(stepPickups(seated, 1).pickups[0].takenAtTick).toBeNull();
    const dead: ArenaState = {
      ...base,
      pickups: [pickupAt("health", 0.5)],
      player: { ...base.player, health: 0, diedAtTick: 0 },
    };
    expect(stepPickups(dead, 1).player.health).toBe(0);
    const full: ArenaState = { ...base, pickups: [pickupAt("health", 0.5)] };
    expect(stepPickups(full, 1).pickups[0].takenAtTick).toBeNull();
    expect(stepPickups(full, 1).events).toEqual([]);
  });
});
