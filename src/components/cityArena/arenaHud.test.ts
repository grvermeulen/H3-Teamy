import { describe, expect, it } from "vitest";
import { createArenaState } from "@/lib/cityArena/sim/arena";
import { createRng } from "@/lib/cityArena/sim/rng";
import { createVehicle } from "@/lib/cityArena/sim/vehicle";
import { buildRadarSnapshot, computeHud, zoneWarningText } from "./arenaHud";

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
      player: { ...state().player, heat: 120, outsideSinceTick: 0 },
    };
    const hud = computeHud(
      { index: () => index, tiles: () => [] },
      current,
      false,
    );
    expect(hud).toMatchObject({
      wantedLevel: 3,
      zoneSecondsLeft: 2,
      zoneWarning: true,
      soundEnabled: false,
    });
    expect(current.player.outsideSinceTick).toBe(0);
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
    const snapshot = buildRadarSnapshot(current, zone);
    expect(snapshot.pickups).toEqual([{ point: [10, 0], kind: "uzi" }]);
    expect(snapshot.police).toEqual([[12, 0]]);
    expect(snapshot.zoneCentre).toEqual([0, 0]);
    expect(snapshot.zoneRadiusM).toBe(1000);
  });

  it("formats the countdown only while active", () => {
    expect(zoneWarningText(null)).toBeNull();
    expect(zoneWarningText(5)).toBe("Terug naar het strijdgebied! 5…");
  });
});
