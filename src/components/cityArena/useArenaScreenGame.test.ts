import { describe, expect, it } from "vitest";
import { createArenaPlayer } from "@/lib/cityArena/sim/roster";
import type { ArenaState, StructureState } from "@/lib/cityArena/sim/types";
import { createStaticRaster } from "@/lib/cityArena/render/staticRaster";
import type { MapIndex } from "@/lib/cityArena/world/mapTypes";
import { buildScreenScene } from "./useArenaScreenGame";

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-13T10:00:00Z",
  origin: { lat: 52, lon: 5 },
  unitsPerMetre: 4,
  bounds: { minX: -8000, minY: -8000, maxX: 8000, maxY: 8000 },
  tileSize: 8000,
  tiles: [],
  landmarks: [],
  zones: [],
};

/** The session slice `buildScreenScene` reads, with no tiles or sprites loaded. */
function session(): Parameters<typeof buildScreenScene>[0] {
  return {
    index: () => index,
    raster: createStaticRaster(() => null),
    overhead: createStaticRaster(() => null),
    tiles: () => [],
    landmarks: () => new Map(),
    loadedTileRects: () => [],
    sprites: () => ({}),
  };
}

/** A minimal state with one structure entry. */
function stateWith(structures: StructureState[] | undefined): ArenaState {
  return {
    tick: 3,
    seed: 1,
    nextId: 1,
    players: [createArenaPlayer([0, 0], 0)],
    vehicles: [],
    bullets: [],
    effects: [],
    zoneKey: null,
    peds: [],
    cops: [],
    pickups: [],
    traffic: [],
    events: [],
    activeZoneKey: null,
    zoneEnforced: false,
    structures,
  };
}

describe("buildScreenScene", () => {
  it("carries the state's structures, so the TV view shows the same ruins as a 2D player", () => {
    const structures: StructureState[] = [
      {
        id: 1,
        damage: 200,
        destroyedAtTick: 5,
        lastHitTick: 5,
        x: 0,
        y: 0,
        radius: 7,
      },
    ];
    const scene = buildScreenScene(
      session(),
      stateWith(structures),
      null,
      false,
    );
    expect(scene.structures).toBe(structures);
  });

  it("leaves structures undefined when the state has none", () => {
    const scene = buildScreenScene(
      session(),
      stateWith(undefined),
      null,
      false,
    );
    expect(scene.structures).toBeUndefined();
  });
});
