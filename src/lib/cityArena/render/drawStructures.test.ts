import { describe, expect, it } from "vitest";
import type { StructureState } from "../sim/types";
import type { DecodedBuilding, DecodedTile } from "../world/decode";
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

function tileWith(buildings: DecodedBuilding[]): DecodedTile {
  return {
    x: 0,
    y: 0,
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
      [tileWith([house(1, -5, -5)])],
      [],
    );
    expect(context.calls).toHaveLength(0);
  });

  it("skips buildings whose bounds sit outside the view", () => {
    const context = createFakeContext();
    const tile = tileWith([house(1, 500, 500)]);
    drawStructureDamage(context, camera, viewport, [tile], [destroyedEntry(1)]);
    expect(context.calls).toHaveLength(0);
  });

  it("fills a destroyed footprint with rubble once and at least four rubble chunks, deterministically", () => {
    const tile = tileWith([house(1, -5, -5)]);
    const entry = destroyedEntry(1);
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
    const tile = tileWith([house(1, -5, -5)]);
    // maxHealth of a 10×10, one-storey footprint is 120 (area 100 × 1 level × 1.2); 60 is half.
    const entry: StructureState = {
      id: 1,
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
