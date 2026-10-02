import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DecodedTile } from "../world/decode";
import { structureMaxHealth } from "../world/structureId";
import { buildCell } from "./buildCell";
import { shadeBuilding } from "./buildingMesh";
import { cellsWithin } from "./cellGrid";
import {
  FIXTURE_TILE_RECT,
  createTestMaterials,
  fixtureTile,
  squareRing,
} from "./testing/cityFixture";
import { createWorldCells, type StructureView } from "./worldCells";

vi.mock("./buildCell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./buildCell")>();
  return { ...actual, buildCell: vi.fn(actual.buildCell) };
});
vi.mock("./buildingMesh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./buildingMesh")>();
  return { ...actual, shadeBuilding: vi.fn(actual.shadeBuilding) };
});
vi.mock("./cellGrid", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cellGrid")>();
  return { ...actual, cellsWithin: vi.fn(actual.cellsWithin) };
});

const FOCUS = { x: 64, y: 64 };
const VIEW_M = 200;

/** The border between the two fixture tiles, inside cell (0, 0), so the cell is built from both. */
const TILE_BORDER_X = 100;

/** Two houses in cell (0, 0) on tile (2, 2), and tile (3, 2) east of x = 100. */
function town(): DecodedTile[] {
  return [
    fixtureTile(
      { x: 2, y: 2, rect: { ...FIXTURE_TILE_RECT, maxX: TILE_BORDER_X } },
      {
        buildings: [
          { ring: squareRing(40, 40, 10), levels: 2 },
          { ring: squareRing(70, 40, 10), levels: 2 },
        ],
      },
    ),
    fixtureTile(
      {
        x: 3,
        y: 2,
        rect: { ...FIXTURE_TILE_RECT, minX: TILE_BORDER_X, maxX: 3000 },
      },
      {},
    ),
  ];
}

/** A structure list damaging the first house by half its health. */
function halfDamaged(tiles: readonly DecodedTile[]): StructureView[] {
  const house = tiles[0].buildings[0];
  const health = structureMaxHealth(house.ring, house.levels, false);
  return [{ id: house.structureId, damage: health / 2, destroyedAtTick: null }];
}

describe("createWorldCells work per update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does no streaming, building or shading work when nothing changed", () => {
    const world = createWorldCells(createTestMaterials());
    const tiles = town();
    world.update(FOCUS, tiles, halfDamaged(tiles), VIEW_M, Infinity);
    expect(buildCell).toHaveBeenCalled();
    expect(shadeBuilding).toHaveBeenCalled();
    vi.clearAllMocks();

    world.update(FOCUS, [...tiles], halfDamaged(tiles), VIEW_M, Infinity);
    world.update({ x: 70, y: 60 }, tiles, halfDamaged(tiles), VIEW_M, 0);

    expect(buildCell).not.toHaveBeenCalled();
    expect(shadeBuilding).not.toHaveBeenCalled();
    expect(cellsWithin).not.toHaveBeenCalled();
  });

  it("rebuilds only the owning cell when the destroyed set changes", () => {
    const world = createWorldCells(createTestMaterials());
    const tiles = town();
    world.update(FOCUS, tiles, [], VIEW_M, Infinity);
    vi.clearAllMocks();
    const house = tiles[0].buildings[0].structureId;

    world.update(
      FOCUS,
      tiles,
      [{ id: house, damage: 900, destroyedAtTick: 7 }],
      VIEW_M,
      0,
    );

    expect(buildCell).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildCell).mock.calls[0][0].cell).toEqual({
      cx: 0,
      cy: 0,
    });
    expect(vi.mocked(buildCell).mock.calls[0][0].destroyed.has(house)).toBe(
      true,
    );
  });

  it("rebuilds every cell a building fell in within the same update, whatever the budget", () => {
    const world = createWorldCells(createTestMaterials());
    const tiles = [
      fixtureTile(
        { x: 2, y: 2, rect: FIXTURE_TILE_RECT },
        {
          buildings: [
            { ring: squareRing(40, 40, 10), levels: 2 },
            { ring: squareRing(180, 40, 10), levels: 2 },
          ],
        },
      ),
    ];
    world.update(FOCUS, tiles, [], VIEW_M, Infinity);
    vi.clearAllMocks();
    const fallen = tiles[0].buildings.map((building) => ({
      id: building.structureId,
      damage: 900,
      destroyedAtTick: 7,
    }));

    world.update(FOCUS, tiles, fallen, VIEW_M, 0);

    const rebuilt = vi.mocked(buildCell).mock.calls.map(([input]) => input);
    expect(rebuilt.map((input) => input.cell)).toEqual([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
    ]);
    expect(rebuilt.every((input) => input.destroyed.size === 2)).toBe(true);
  });

  it("shades again, without building, when only the damage changes", () => {
    const world = createWorldCells(createTestMaterials());
    const tiles = town();
    world.update(FOCUS, tiles, [], VIEW_M, Infinity);
    vi.clearAllMocks();

    world.update(FOCUS, tiles, halfDamaged(tiles), VIEW_M, 0);

    expect(shadeBuilding).toHaveBeenCalledTimes(1);
    expect(buildCell).not.toHaveBeenCalled();
  });

  it("does not rebuild for the same tiles in another order", () => {
    const world = createWorldCells(createTestMaterials());
    const tiles = town();
    world.update(FOCUS, tiles, [], VIEW_M, Infinity);
    vi.clearAllMocks();

    world.update(FOCUS, [...tiles].reverse(), [], VIEW_M, Infinity);

    expect(buildCell).not.toHaveBeenCalled();
  });

  it("looks for new cells once the focus has moved on far enough", () => {
    const world = createWorldCells(createTestMaterials());
    const tiles = town();
    world.update(FOCUS, tiles, [], VIEW_M, Infinity);
    vi.clearAllMocks();

    world.update({ x: FOCUS.x + 40, y: FOCUS.y }, tiles, [], VIEW_M, Infinity);

    expect(cellsWithin).toHaveBeenCalledTimes(1);
  });
});
