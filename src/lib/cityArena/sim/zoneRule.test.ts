import { describe, expect, it } from "vitest";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import { createRng } from "./rng";
import type { ArenaState } from "./types";
import { ZONE_WARNING_TICKS, applyZoneRule, zoneSecondsLeft } from "./zoneRule";

const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [0, 0],
  radius: 2000,
  spawnNodes: [[0, 0]],
  landmarks: [],
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [zone],
  landmarks: [],
};
const graph = decodeRoadGraph({ nodes: [], edges: [], classes: [], names: [] });

function enforcedAt(x: number): ArenaState {
  const state = createArenaState({ index, graph, seed: 1, zone }, createRng(1));
  return { ...state, zoneEnforced: true, player: { ...state.player, x } };
}

describe("zone rule", () => {
  it("counts down five seconds after leaving", () => {
    expect(zoneSecondsLeft({ outsideSinceTick: null }, 10)).toBeNull();
    expect(zoneSecondsLeft({ outsideSinceTick: 10 }, 10)).toBe(5);
    expect(zoneSecondsLeft({ outsideSinceTick: 10 }, 159)).toBe(1);
    expect(zoneSecondsLeft({ outsideSinceTick: 10 }, 160)).toBe(0);
  });

  it("warns, then applies ten damage per second, and clears on return", () => {
    const left = applyZoneRule(enforcedAt(600), index, 10);
    expect(left.player.outsideSinceTick).toBe(10);
    expect(left.events).toEqual([
      { kind: "zone", playerId: 0, phase: "warning" },
    ]);
    expect(applyZoneRule(left, index, 10 + ZONE_WARNING_TICKS - 1)).toBe(left);
    const hurt = applyZoneRule(
      { ...left, events: [] },
      index,
      10 + ZONE_WARNING_TICKS,
    );
    expect(hurt.player.health).toBe(90);
    expect(hurt.events).toEqual([
      { kind: "zone", playerId: 0, phase: "damage" },
    ]);
    const back = { ...hurt, player: { ...hurt.player, x: 499 } };
    expect(applyZoneRule(back, index, 200).player.outsideSinceTick).toBeNull();
  });

  it("does nothing when unenforced, dead or shielded", () => {
    const off = { ...enforcedAt(600), zoneEnforced: false };
    expect(applyZoneRule(off, index, 5)).toBe(off);
    const dead = {
      ...enforcedAt(600),
      player: {
        ...enforcedAt(600).player,
        health: 0,
        diedAtTick: 1,
        outsideSinceTick: 2,
      },
    };
    expect(applyZoneRule(dead, index, 200).player.outsideSinceTick).toBeNull();
    const shielded = {
      ...enforcedAt(600),
      player: { ...enforcedAt(600).player, invulnerableUntilTick: 1000 },
    };
    expect(
      applyZoneRule(
        { ...shielded, player: { ...shielded.player, outsideSinceTick: 10 } },
        index,
        160,
      ).player.health,
    ).toBe(100);
  });
});
