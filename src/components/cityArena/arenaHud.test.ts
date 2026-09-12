import { localPlayer } from "@/lib/cityArena/sim/players";
import { describe, expect, it } from "vitest";
import { createArenaState } from "@/lib/cityArena/sim/arena";
import { createRng } from "@/lib/cityArena/sim/rng";
import { createVehicle } from "@/lib/cityArena/sim/vehicle";
import {
  buildRadarSnapshot,
  computeHud,
  radarZone,
  zoneWarningText,
} from "./arenaHud";

const zone = {
  key: "wageningen" as const,
  name: "Wageningen",
  center: [0, 0] as [number, number],
  radius: 4000,
  spawnNodes: [[0, 0] as [number, number]],
  landmarks: [],
};
const index = {
  version: 1 as const,
  generatedAt: "2026-09-05",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4 as const,
  bounds: { minX: -8000, minY: -8000, maxX: 8000, maxY: 8000 },
  tileSize: 8000,
  tiles: [],
  zones: [zone],
  landmarks: [],
};

function state() {
  return createArenaState(
    {
      index,
      graph: { nodes: [], edges: [], adjacency: [], nearestNode: () => null },
      seed: 1,
      zone,
    },
    createRng(1),
  );
}

describe("arena HUD projections", () => {
  it("adds wanted, zone warning and sound fields without mutating state", () => {
    const current = {
      ...state(),
      tick: 100,
      zoneEnforced: true,
      players: [{ ...localPlayer(state()), heat: 120, outsideSinceTick: 0 }],
    };
    const hud = computeHud(
      { index: () => index, tiles: () => [] },
      current,
      localPlayer(current),
      false,
      "Grebbe FM",
    );
    expect(hud).toMatchObject({
      wantedLevel: 3,
      zoneSecondsLeft: 2,
      zoneWarning: true,
      soundEnabled: false,
      radioStation: "Grebbe FM",
    });
    expect(localPlayer(current).outsideSinceTick).toBe(0);
    expect(
      computeHud(
        { index: () => index, tiles: () => [] },
        current,
        localPlayer(current),
      ).radioStation,
    ).toBeNull();
  });

  it("carries drunkenness and says when a press at the brewery orders a beer", () => {
    const brewery = {
      key: "klein-zwitserland",
      name: "Brouwerij Klein Zwitserland",
      style: "brewery" as const,
      center: [40, 0] as [number, number],
      tile: { x: 0, y: 0 },
    };
    const withBrewery = { ...index, landmarks: [brewery] };
    const current = {
      ...state(),
      players: [{ ...localPlayer(state()), x: 12, y: 0, drunk: 0.5 }],
    };
    const session = { index: () => withBrewery, tiles: () => [] };
    expect(computeHud(session, current, localPlayer(current))).toMatchObject({
      drunk: 0.5,
      canOrderBeer: true,
    });
    const away = {
      ...current,
      players: [{ ...localPlayer(current), x: -12 }],
    };
    expect(computeHud(session, away, localPlayer(away)).canOrderBeer).toBe(
      false,
    );
    // A car in reach wins the press, so the button must not promise a beer.
    const beside = {
      ...current,
      vehicles: [createVehicle(3, "sedan", [13, 0], 0, 0)],
    };
    expect(computeHud(session, beside, localPlayer(beside)).canOrderBeer).toBe(
      false,
    );
  });

  it("projects nearby pickups, police and zone geometry into the radar", () => {
    const current = {
      ...state(),
      pickups: [
        { id: 1, kind: "uzi" as const, x: 10, y: 0, takenAtTick: null },
      ],
      cops: [],
      vehicles: [createVehicle(2, "police", [12, 0], 0, 5)],
    };
    const snapshot = buildRadarSnapshot(current, localPlayer(current), zone);
    expect(snapshot.pickups).toEqual([{ point: [10, 0], kind: "uzi" }]);
    expect(snapshot.police).toEqual([[12, 0]]);
    expect(snapshot.zoneCentre).toEqual([0, 0]);
    expect(snapshot.zoneRadiusM).toBe(1000);
  });

  it("hands the tank's driver the cannon and marks living tanks on the radar", () => {
    const base = state();
    const me = localPlayer(base);
    const tank = createVehicle(3, "tank", [me.x, me.y], 0, 0);
    const wreck = {
      ...createVehicle(4, "tank", [me.x + 20, me.y], 0, 0),
      wrecked: true,
    };
    const current = {
      ...base,
      vehicles: [tank, wreck],
      players: [{ ...me, vehicleId: 3 }],
    };
    const hud = computeHud(
      { index: () => index, tiles: () => [] },
      current,
      localPlayer(current),
    );
    expect(hud).toMatchObject({ weapon: "cannon", inVehicle: true });
    expect(
      buildRadarSnapshot(current, localPlayer(current), zone).tanks,
    ).toEqual([[me.x, me.y]]);
  });

  it("keeps the radar ring on the enforced zone after population moves", () => {
    const other = {
      ...zone,
      key: "other" as const,
      center: [5000, 0] as [number, number],
    };
    const current = {
      ...state(),
      zoneKey: "other" as const,
      activeZoneKey: "other" as const,
      enforcedZoneKey: zone.key,
      zoneEnforced: true,
    };
    const selectedIndex = { ...index, zones: [zone, other] };
    expect(radarZone(selectedIndex, current, localPlayer(current))?.key).toBe(
      zone.key,
    );
  });

  it("formats the countdown only while active", () => {
    expect(zoneWarningText(null)).toBeNull();
    expect(zoneWarningText(5)).toBe("Terug naar het strijdgebied! 5…");
  });
});
