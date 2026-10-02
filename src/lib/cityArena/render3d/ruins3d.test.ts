import { describe, expect, it, vi } from "vitest";
import type { DecodedTile } from "../world/decode";
import { structureIdOf } from "../world/structureId";
import { buildingHeight, facadeStyleOf } from "./buildingMesh";
import type { CollapseInput } from "./destruction3d";
import {
  RECENT_COLLAPSE_TICKS,
  createRuins3d,
  ruinOf,
  type RuinTarget,
} from "./ruins3d";
import {
  FIXTURE_TILE_RECT,
  fixtureTile,
  squareRing,
} from "./testing/cityFixture";
import { facadeWallColour } from "./textures";
import type { StructureView } from "./worldCells";

const NOW = 900;

/** Tile (2, 2) with a two-storey house and a five-storey block; tile (3, 2) east of it, empty. */
function town(): DecodedTile[] {
  return [
    fixtureTile(
      { x: 2, y: 2, rect: { ...FIXTURE_TILE_RECT, maxX: 100 } },
      {
        buildings: [
          { ring: squareRing(40, 40, 10), levels: 2 },
          { ring: squareRing(90, 60, 20), levels: 5 },
        ],
      },
    ),
    fixtureTile(
      { x: 3, y: 2, rect: { ...FIXTURE_TILE_RECT, minX: 100, maxX: 3000 } },
      {},
    ),
  ];
}

const HOUSE = structureIdOf(2, 2, 0);
const BLOCK = structureIdOf(2, 2, 1);

/** A destruction view that records what it was asked to do. */
function fakeTarget(): RuinTarget & {
  collapse: ReturnType<typeof vi.fn>;
  setRubble: ReturnType<typeof vi.fn>;
} {
  return { collapse: vi.fn(), setRubble: vi.fn() };
}

function destroyed(id: number, atTick: number): StructureView {
  return { id, damage: 999, destroyedAtTick: atTick };
}

/** The structure ids of the latest `setRubble` call. */
function rubbleIds(target: ReturnType<typeof fakeTarget>): number[] {
  const [entries] = target.setRubble.mock.lastCall as [CollapseInput[]];
  return entries.map((entry) => entry.structureId).sort();
}

describe("ruinOf", () => {
  it("finds the building a structure id names in its tile, with its height by storeys", () => {
    const tiles = town();
    const ruin = ruinOf(HOUSE, tiles);

    expect(ruin).toEqual({
      structureId: HOUSE,
      ring: squareRing(40, 40, 10),
      height: buildingHeight(2),
      colour: facadeWallColour(facadeStyleOf(tiles[0]!.buildings[0]!)),
    });
  });

  it("colours the stand-in like the walls it replaces: brick red, plaster pale, concrete grey", () => {
    const tiles = town();
    const block = tiles[0]!.buildings[1]!;

    expect(ruinOf(BLOCK, tiles)!.colour).toBe(
      facadeWallColour(facadeStyleOf(block)),
    );
    expect(facadeWallColour("brick")).toBe("#6d3b2c");
    expect(facadeWallColour("plaster")).toBe("#8f8878");
    expect(facadeWallColour("concrete")).toBe("#5f6368");
    expect(facadeWallColour("glass")).toBe("#2b3c4f");
  });

  it("cuts the footprint to its tile's own rectangle, as the city builds it", () => {
    const ruin = ruinOf(BLOCK, town())!;

    const xs = ruin.ring.map(([x]) => x);
    expect(Math.max(...xs)).toBe(100);
    expect(Math.min(...xs)).toBe(90);
    expect(ruin.height).toBeCloseTo(5 * 3.1);
  });

  it("is null for a tile that is not loaded or a position past the tile's list", () => {
    expect(ruinOf(structureIdOf(9, 9, 0), town())).toBeNull();
    expect(ruinOf(structureIdOf(2, 2, 7), town())).toBeNull();
  });
});

describe("createRuins3d", () => {
  it("plays the collapse of a building that just fell, and leaves its mound", () => {
    const ruins = createRuins3d();
    const target = fakeTarget();
    const tiles = town();
    ruins.update([], tiles, NOW - 1, target);

    ruins.update([destroyed(HOUSE, NOW)], tiles, NOW, target);

    expect(target.collapse).toHaveBeenCalledTimes(1);
    expect(target.collapse).toHaveBeenCalledWith(ruinOf(HOUSE, tiles));
    expect(rubbleIds(target)).toEqual([HOUSE]);
  });

  it("plays a collapse up to about two seconds after the fall, when the view first sees it", () => {
    expect(RECENT_COLLAPSE_TICKS).toBe(60);
    const ruins = createRuins3d();
    const target = fakeTarget();

    ruins.update(
      [destroyed(HOUSE, NOW - RECENT_COLLAPSE_TICKS)],
      town(),
      NOW,
      target,
    );

    expect(target.collapse).toHaveBeenCalledTimes(1);
  });

  it("only lays the rubble of a building that fell longer ago", () => {
    const ruins = createRuins3d();
    const target = fakeTarget();

    ruins.update(
      [destroyed(HOUSE, NOW - RECENT_COLLAPSE_TICKS - 1)],
      town(),
      NOW,
      target,
    );

    expect(target.collapse).not.toHaveBeenCalled();
    expect(rubbleIds(target)).toEqual([HOUSE]);
  });

  it("never replays a fall stamped after the current tick, as after the tick count restarts", () => {
    const ruins = createRuins3d();
    const target = fakeTarget();

    ruins.update([destroyed(HOUSE, NOW + 5)], town(), NOW, target);

    expect(target.collapse).not.toHaveBeenCalled();
    expect(rubbleIds(target)).toEqual([HOUSE]);
  });

  it("collapses each fall once, however many frames list it", () => {
    const ruins = createRuins3d();
    const target = fakeTarget();
    const tiles = town();

    for (let frame = 0; frame < 4; frame++) {
      ruins.update([destroyed(HOUSE, NOW)], [...tiles], NOW + frame, target);
    }

    expect(target.collapse).toHaveBeenCalledTimes(1);
    expect(target.setRubble).toHaveBeenCalledTimes(1);
  });

  it("takes the mound away when the building is rebuilt, and collapses it again if it falls again", () => {
    const ruins = createRuins3d();
    const target = fakeTarget();
    const tiles = town();
    ruins.update(
      [destroyed(HOUSE, NOW), destroyed(BLOCK, 10)],
      tiles,
      NOW,
      target,
    );
    expect(rubbleIds(target)).toEqual([HOUSE, BLOCK].sort());

    const rebuilt = { id: HOUSE, damage: 0, destroyedAtTick: null };
    ruins.update([rebuilt, destroyed(BLOCK, 10)], tiles, NOW + 1, target);
    expect(rubbleIds(target)).toEqual([BLOCK]);

    ruins.update(
      [destroyed(HOUSE, NOW + 2), destroyed(BLOCK, 10)],
      tiles,
      NOW + 2,
      target,
    );
    expect(target.collapse).toHaveBeenCalledTimes(2);
    expect(rubbleIds(target)).toEqual([HOUSE, BLOCK].sort());
  });

  it("drops the mound of a structure that leaves the list", () => {
    const ruins = createRuins3d();
    const target = fakeTarget();
    ruins.update([destroyed(HOUSE, 10)], town(), NOW, target);

    ruins.update([], town(), NOW + 1, target);

    expect(rubbleIds(target)).toEqual([]);
  });

  it("lays the rubble of a building whose tile loads after it fell", () => {
    const ruins = createRuins3d();
    const target = fakeTarget();
    const [, east] = town();
    ruins.update([destroyed(HOUSE, NOW)], [east], NOW, target);
    expect(target.collapse).not.toHaveBeenCalled();
    expect(rubbleIds(target)).toEqual([]);

    ruins.update([destroyed(HOUSE, NOW)], town(), NOW + 1, target);

    expect(rubbleIds(target)).toEqual([HOUSE]);
  });

  it("asks for nothing while the structures and tiles stay the same", () => {
    const ruins = createRuins3d();
    const target = fakeTarget();
    const tiles = town();
    ruins.update([destroyed(HOUSE, 10)], tiles, NOW, target);
    target.setRubble.mockClear();

    ruins.update([destroyed(HOUSE, 10)], [...tiles], NOW + 1, target);
    ruins.update(
      [{ id: BLOCK, damage: 40, destroyedAtTick: null }, destroyed(HOUSE, 10)],
      tiles,
      NOW + 2,
      target,
    );

    expect(target.setRubble).not.toHaveBeenCalled();
    expect(target.collapse).not.toHaveBeenCalled();
  });
});
