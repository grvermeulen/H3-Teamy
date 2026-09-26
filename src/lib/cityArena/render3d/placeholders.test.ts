import { Box3, Group, Mesh, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import type { Scene as ArenaScene } from "../render/renderScene";
import type { DecodedBuilding, DecodedTile } from "../world/decode";
import {
  buildingGeometry,
  createMeshPool,
  createPlaceholderEntities,
  createPlaceholderWorld,
} from "./placeholders";

/** A square building of `side` metres with its north-west corner at `(x, y)`. */
function square(
  structureId: number,
  x: number,
  y: number,
  side = 10,
  levels = 2,
): DecodedBuilding {
  return {
    structureId,
    ring: [
      [x, y],
      [x + side, y],
      [x + side, y + side],
      [x, y + side],
    ],
    bounds: { minX: x, minY: y, maxX: x + side, maxY: y + side },
    levels,
  };
}

/** A tile holding only `buildings`. */
function tileWith(buildings: DecodedBuilding[]): DecodedTile {
  return {
    x: 0,
    y: 0,
    rect: { minX: -2000, minY: -2000, maxX: 2000, maxY: 2000 },
    roads: [],
    buildings,
    ground: [],
    water: [],
    trees: [],
    furniture: [],
  };
}

/** Meshes under `root` that are drawn. */
function visibleMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverseVisible((node) => {
    if (node instanceof Mesh) meshes.push(node);
  });
  return meshes;
}

describe("buildingGeometry", () => {
  it("extrudes a footprint upward by its storeys, lying where the 2D map has it", () => {
    const geometry = buildingGeometry(square(1, 100, 200, 10, 2))!;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.min.x).toBeCloseTo(100);
    expect(box.max.x).toBeCloseTo(110);
    expect(box.min.z).toBeCloseTo(200);
    expect(box.max.z).toBeCloseTo(210);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(6.2);
  });

  it("gives a one-storey shed the minimum height and skips a degenerate ring", () => {
    const shed = buildingGeometry(square(1, 0, 0, 3, 1))!;
    shed.computeBoundingBox();
    expect(shed.boundingBox!.max.y).toBeCloseTo(3.5);
    expect(
      buildingGeometry({
        ...square(2, 0, 0),
        ring: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toBeNull();
  });
});

describe("createPlaceholderWorld", () => {
  it("builds only the buildings within 200 m and drops them once the player walks away", () => {
    const world = createPlaceholderWorld();
    const tiles = [tileWith([square(1, 20, 20), square(2, 600, 0)])];
    world.update({ x: 0, y: 0 }, tiles, [], 380, 100);
    expect(world.buildingCount()).toBe(1);
    world.update({ x: 650, y: 0 }, [...tiles], [], 380, 100);
    expect(world.buildingCount()).toBe(1);
    const box = new Box3().setFromObject(world.group.children[1]!);
    expect(box.min.x).toBeGreaterThan(500);
    world.dispose();
  });

  it("builds at least one queued building per frame, however small the budget", () => {
    const world = createPlaceholderWorld();
    const tiles = [
      tileWith([square(1, 0, 0), square(2, 30, 0), square(3, 60, 0)]),
    ];
    world.update({ x: 0, y: 0 }, tiles, [], 380, 0);
    expect(world.buildingCount()).toBe(1);
    world.update({ x: 0, y: 0 }, tiles, [], 380, 0);
    expect(world.buildingCount()).toBe(2);
    world.dispose();
  });

  it("removes a destroyed building and never builds it again", () => {
    const world = createPlaceholderWorld();
    const tiles = [tileWith([square(7, 0, 0)])];
    world.update({ x: 0, y: 0 }, tiles, [], 380, 100);
    expect(world.buildingCount()).toBe(1);
    const ruins = [{ id: 7, damage: 500, destroyedAtTick: 40 }];
    world.update({ x: 0, y: 0 }, tiles, ruins, 380, 100);
    world.update({ x: 0, y: 0 }, tiles, [...ruins], 380, 100);
    expect(world.buildingCount()).toBe(0);
    world.dispose();
  });

  it("keeps the ground plane under the player and its grid fixed to the world", () => {
    const world = createPlaceholderWorld();
    world.update({ x: 43, y: -26 }, [], [], 380, 1);
    const [ground, , grid] = world.group.children;
    expect(ground!.position.x).toBe(43);
    expect(ground!.position.z).toBe(-26);
    // Snapped to whole grid cells, so the lines stay put as the player moves.
    expect(grid!.position.x).toBe(40);
    expect(grid!.position.z).toBe(-30);
    world.dispose();
  });
});

describe("createMeshPool", () => {
  it("hides the meshes of entities that are gone and hands them to the next one", () => {
    const parent = new Group();
    const pool = createMeshPool(parent, () => new Mesh());
    pool.begin();
    pool.acquire(1);
    const second = pool.acquire(2);
    pool.end();
    pool.begin();
    const first = pool.acquire(1);
    pool.end();
    expect(second.visible).toBe(false);
    expect(first.visible).toBe(true);
    pool.begin();
    expect(pool.acquire(1)).toBe(first);
    expect(pool.acquire(3)).toBe(second);
    pool.end();
    expect(pool.created()).toBe(2);
    expect(parent.children).toHaveLength(2);
  });
});

/** A scene with the local player 0 on foot, player 1 driving car 9, a pedestrian and an officer. */
function castScene(): ArenaScene {
  const player = (id: number, vehicleId: number | null) => ({
    id,
    x: id * 3,
    y: 0,
    facing: 0,
    vehicleId,
    diedAtTick: null,
  });
  return {
    localPlayerId: 0,
    players: [player(0, null), player(1, 9)],
    peds: [{ id: 4, x: 5, y: 5, facing: 1, mode: "walk" }],
    cops: [{ id: 5, x: -5, y: 5, facing: 2, diedAtTick: 30 }],
    vehicles: [
      {
        id: 9,
        kind: "bus",
        x: 10,
        y: 10,
        heading: 0.5,
        colour: 3,
        wrecked: false,
      },
    ],
  } as unknown as ArenaScene;
}

describe("createPlaceholderEntities", () => {
  it("draws people as capsules and cars as boxes at their kind's size", () => {
    const entities = createPlaceholderEntities();
    entities.update(castScene(), { x: 0, y: 0 }, { hideLocalPlayer: false });
    const meshes = visibleMeshes(entities.group);
    // You, the pedestrian, the officer (lying down) and the bus; the driver sits inside it.
    expect(meshes).toHaveLength(4);
    const bus = meshes.find((mesh) => mesh.scale.x > 1)!;
    expect(bus.scale.x).toBeCloseTo(12);
    expect(bus.scale.z).toBeCloseTo(2.5);
    expect(bus.rotation.y).toBeCloseTo(-0.5);
    const lying = meshes.filter((mesh) => mesh.rotation.z !== 0);
    expect(lying).toHaveLength(1);
    entities.dispose();
  });

  it("hides the local player in first person and reuses meshes frame to frame", () => {
    const entities = createPlaceholderEntities();
    entities.update(castScene(), { x: 0, y: 0 }, { hideLocalPlayer: false });
    const before = entities.group.children.length;
    entities.update(castScene(), { x: 0, y: 0 }, { hideLocalPlayer: true });
    expect(visibleMeshes(entities.group)).toHaveLength(3);
    expect(entities.group.children).toHaveLength(before);
    entities.dispose();
  });

  it("skips entities beyond the draw distance", () => {
    const entities = createPlaceholderEntities();
    entities.update(castScene(), { x: 5000, y: 0 }, { hideLocalPlayer: false });
    expect(visibleMeshes(entities.group)).toHaveLength(0);
    entities.dispose();
  });
});
