import { describe, expect, it } from "vitest";
import type { StructureState } from "../sim/types";
import type { DecodedBuilding, DecodedTile } from "../world/decode";
import { structureIdOf } from "../world/structureId";
import { createCamera } from "./camera";
import {
  DAMAGE_SHADE_MAX_ALPHA,
  RUBBLE_CHUNK,
  RUBBLE_FILL,
  drawStructureDamage,
} from "./drawStructures";
import { createFakeContext } from "./testing/fakeContext";

/** A 10×10 m square footprint at the given corner, one storey (`structureMaxHealth` = 120). */
function house(structureId: number, x: number, y: number): DecodedBuilding {
  return {
    structureId,
    ring: [
      [x, y],
      [x + 10, y],
      [x + 10, y + 10],
      [x, y + 10],
    ],
    bounds: { minX: x, minY: y, maxX: x + 10, maxY: y + 10 },
    levels: 1,
  };
}

/** A tile at grid `(tileX, tileY)` holding `buildings`, its own rectangle wide enough for any fixture. */
function tileAt(
  tileX: number,
  tileY: number,
  buildings: DecodedBuilding[],
): DecodedTile {
  return {
    x: tileX,
    y: tileY,
    rect: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
    roads: [],
    buildings,
    ground: [],
    water: [],
    trees: [],
    furniture: [],
  };
}

const camera = createCamera([0, 0], 4);
const viewport = { width: 200, height: 200 };

/** The id of the first (only) building in this suite's one resident tile, `(0, 0)`. */
const STRUCTURE_ID = structureIdOf(0, 0, 0);

function destroyedEntry(id: number): StructureState {
  return {
    id,
    damage: 200,
    destroyedAtTick: 5,
    lastHitTick: 5,
    x: 0,
    y: 0,
    radius: 7,
  };
}

describe("drawStructureDamage", () => {
  it("draws nothing when there are no structure entries", () => {
    const context = createFakeContext();
    drawStructureDamage(
      context,
      camera,
      viewport,
      [tileAt(0, 0, [house(STRUCTURE_ID, -5, -5)])],
      [],
    );
    expect(context.calls).toHaveLength(0);
  });

  it("skips an entry whose tile is not resident, or whose index is stale", () => {
    const context = createFakeContext();
    const tile = tileAt(0, 0, [house(STRUCTURE_ID, -5, -5)]);
    const unresidentTile = destroyedEntry(structureIdOf(3, 3, 0));
    const staleIndex = destroyedEntry(structureIdOf(0, 0, 5));
    drawStructureDamage(
      context,
      camera,
      viewport,
      [tile],
      [unresidentTile, staleIndex],
    );
    expect(context.calls).toHaveLength(0);
  });

  it("skips buildings whose bounds sit outside the view", () => {
    const context = createFakeContext();
    const tile = tileAt(0, 0, [house(STRUCTURE_ID, 500, 500)]);
    drawStructureDamage(
      context,
      camera,
      viewport,
      [tile],
      [destroyedEntry(STRUCTURE_ID)],
    );
    expect(context.calls).toHaveLength(0);
  });

  it("resolves a building directly by id, wherever it sits in its tile's list", () => {
    const other = house(structureIdOf(0, 0, 0), -50, -50);
    const target = house(structureIdOf(0, 0, 1), -5, -5);
    const tile = tileAt(0, 0, [other, target]);
    const entry = destroyedEntry(structureIdOf(0, 0, 1));
    const context = createFakeContext();
    drawStructureDamage(context, camera, viewport, [tile], [entry]);
    expect(context.calls).toContain(`fill(${RUBBLE_FILL})`);
  });

  it("fills a destroyed footprint with rubble once and at least four rubble chunks, deterministically", () => {
    const tile = tileAt(0, 0, [house(STRUCTURE_ID, -5, -5)]);
    const entry = destroyedEntry(STRUCTURE_ID);
    const first = createFakeContext();
    drawStructureDamage(first, camera, viewport, [tile], [entry]);
    const second = createFakeContext();
    drawStructureDamage(second, camera, viewport, [tile], [entry]);
    expect(first.calls).toEqual(second.calls);
    expect(
      first.calls.filter((call) => call === `fill(${RUBBLE_FILL})`),
    ).toHaveLength(1);
    expect(
      first.calls.filter((call) => call === `fill(${RUBBLE_CHUNK})`).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("shades a half-damaged, intact building at half the maximum alpha", () => {
    const tile = tileAt(0, 0, [house(STRUCTURE_ID, -5, -5)]);
    // maxHealth of a 10×10, one-storey footprint is 120 (area 100 × 1 level × 1.2); 60 is half.
    const entry: StructureState = {
      id: STRUCTURE_ID,
      damage: 60,
      destroyedAtTick: null,
      lastHitTick: 5,
      x: 0,
      y: 0,
      radius: 7,
    };
    const context = createFakeContext();
    drawStructureDamage(context, camera, viewport, [tile], [entry]);
    expect(context.calls).toContain(
      `fill(rgba(0,0,0,${DAMAGE_SHADE_MAX_ALPHA / 2}))`,
    );
    expect(context.calls).not.toContain(`fill(${RUBBLE_FILL})`);
  });
});
