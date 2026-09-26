import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InstancedMesh,
  Matrix4,
  Mesh,
  type BufferAttribute,
  type Group,
} from "three";
import { structureMaxHealth } from "../world/structureId";
import type { DecodedTile } from "../world/decode";
import { CELL_M, cellsWithin } from "./cellGrid";
import {
  FIXTURE_TILE_RECT,
  createTestMaterials,
  fixtureTile,
  fixtureTown,
  squareRing,
} from "./testing/cityFixture";
import { createWorldCells, type StructureView } from "./worldCells";

const ORIGIN = { x: 64, y: 64 };
const VIEW_M = 200;
const NO_STRUCTURES: StructureView[] = [];

/** The cell groups the world currently shows, by the corner they stand at. */
function cellCorners(group: Group): string[] {
  return group.children
    .map((child) => `${child.position.x},${child.position.z}`)
    .sort();
}

/** The merged walls mesh of the cell standing at a corner. */
function wallsAt(group: Group, x: number, z: number): Mesh | undefined {
  const cell = group.children.find(
    (child) => child.position.x === x && child.position.z === z,
  );
  return cell?.children.find(
    (child): child is Mesh =>
      child instanceof Mesh && Array.isArray(child.material),
  );
}

/** A tile holding one 10 m house in cell (0, 0). */
function oneHouse(): DecodedTile {
  return fixtureTile(
    { x: 2, y: 2, rect: FIXTURE_TILE_RECT },
    { buildings: [{ ring: squareRing(40, 40, 10), levels: 2 }] },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWorldCells", () => {
  it("builds one cell per update with no time budget, nearest first", () => {
    const world = createWorldCells(createTestMaterials());

    world.update(ORIGIN, [fixtureTown()], NO_STRUCTURES, VIEW_M, 0);
    expect(cellCorners(world.group)).toEqual(["0,0"]);

    world.update(ORIGIN, [fixtureTown()], NO_STRUCTURES, VIEW_M, 0);
    expect(world.group.children).toHaveLength(2);
  });

  it("builds every cell within the view distance given time", () => {
    const world = createWorldCells(createTestMaterials());

    world.update(ORIGIN, [fixtureTown()], NO_STRUCTURES, VIEW_M, Infinity);

    expect(world.group.children).toHaveLength(
      cellsWithin(64, 64, VIEW_M).length,
    );
  });

  it("stops building once the budget is spent", () => {
    const world = createWorldCells(createTestMaterials());
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 10));

    world.update(ORIGIN, [fixtureTown()], NO_STRUCTURES, VIEW_M, 25);

    expect(world.group.children.length).toBeGreaterThan(0);
    expect(world.group.children.length).toBeLessThan(4);
  });

  it("drops cells beyond 1.4 × the view distance and frees them", () => {
    const world = createWorldCells(createTestMaterials());
    world.update(ORIGIN, [fixtureTown()], NO_STRUCTURES, VIEW_M, Infinity);
    const home = world.group.children.find(
      (child) => child.position.x === 0 && child.position.z === 0,
    )!;
    const geometry = (home.children[0] as Mesh).geometry;
    const freed = vi.spyOn(geometry, "dispose");

    world.update(
      { x: 64 + 5 * CELL_M, y: 64 },
      [fixtureTown()],
      NO_STRUCTURES,
      VIEW_M,
      0,
    );

    expect(cellCorners(world.group)).not.toContain("0,0");
    expect(freed).toHaveBeenCalled();
    const farthest = Math.max(
      ...world.group.children.map((child) =>
        Math.hypot(
          child.position.x + CELL_M / 2 - (64 + 5 * CELL_M),
          child.position.z + CELL_M / 2 - 64,
        ),
      ),
    );
    expect(farthest).toBeLessThanOrEqual(1.4 * VIEW_M + CELL_M);
  });

  it("rebuilds a cell when one of its buildings is destroyed or rebuilt", () => {
    const world = createWorldCells(createTestMaterials());
    const tiles = [oneHouse()];
    const house = tiles[0].buildings[0].structureId;
    world.update(ORIGIN, tiles, NO_STRUCTURES, VIEW_M, 0);
    expect(wallsAt(world.group, 0, 0)).toBeDefined();

    world.update(
      ORIGIN,
      tiles,
      [{ id: house, damage: 999, destroyedAtTick: 40 }],
      VIEW_M,
      0,
    );
    expect(wallsAt(world.group, 0, 0)).toBeUndefined();

    world.update(ORIGIN, tiles, NO_STRUCTURES, VIEW_M, 0);
    expect(wallsAt(world.group, 0, 0)).toBeDefined();
  });

  it("scorches a damaged building by its share of health, and heals it", () => {
    const world = createWorldCells(createTestMaterials());
    const tiles = [oneHouse()];
    const house = tiles[0].buildings[0];
    const maxHealth = structureMaxHealth(house.ring, house.levels, false);
    world.update(ORIGIN, tiles, NO_STRUCTURES, VIEW_M, 0);
    const colour = (): number =>
      (
        wallsAt(world.group, 0, 0)!.geometry.getAttribute(
          "color",
        ) as BufferAttribute
      ).getX(0);

    world.update(
      ORIGIN,
      tiles,
      [{ id: house.structureId, damage: maxHealth / 2, destroyedAtTick: null }],
      VIEW_M,
      0,
    );
    expect(colour()).toBeCloseTo(0.6);

    world.update(ORIGIN, tiles, NO_STRUCTURES, VIEW_M, 0);
    expect(colour()).toBe(1);
  });

  it("fills in a cell when its tile arrives after it was built", () => {
    const world = createWorldCells(createTestMaterials());
    world.update(ORIGIN, [], NO_STRUCTURES, VIEW_M, 0);
    expect(wallsAt(world.group, 0, 0)).toBeUndefined();

    world.update(ORIGIN, [oneHouse()], NO_STRUCTURES, VIEW_M, 0);

    expect(wallsAt(world.group, 0, 0)).toBeDefined();
  });

  it("finds the furniture near a point in the built cells", () => {
    const world = createWorldCells(createTestMaterials());
    world.update(ORIGIN, [fixtureTown()], NO_STRUCTURES, VIEW_M, Infinity);

    const near = world.furnitureNear(30, 58, 2);

    expect(near.map((piece) => piece.kind)).toEqual(["bench"]);
    expect(world.furnitureNear(-500, -500, 5)).toEqual([]);
  });

  it("mirrors a knocked-over furniture proxy on the next update", () => {
    const materials = createTestMaterials();
    const world = createWorldCells(materials);
    world.update(ORIGIN, [fixtureTown()], NO_STRUCTURES, VIEW_M, Infinity);
    const [bench] = world.furnitureNear(30, 58, 2);
    const home = world.group.children.find(
      (child) => child.position.x === 0 && child.position.z === 0,
    )!;
    const benches = home.children.find(
      (child): child is InstancedMesh =>
        child instanceof InstancedMesh && child.material === materials.bench,
    )!;
    const before = new Matrix4();
    benches.getMatrixAt(0, before);

    bench.object.rotation.z = Math.PI / 2;
    world.update(ORIGIN, [fixtureTown()], NO_STRUCTURES, VIEW_M, 0);

    const after = new Matrix4();
    benches.getMatrixAt(0, after);
    expect(after.equals(before)).toBe(false);
  });

  it("frees everything on dispose", () => {
    const world = createWorldCells(createTestMaterials());
    world.update(ORIGIN, [fixtureTown()], NO_STRUCTURES, VIEW_M, Infinity);

    world.dispose();

    expect(world.group.children).toHaveLength(0);
    expect(world.furnitureNear(30, 58, 2)).toEqual([]);
  });
});
