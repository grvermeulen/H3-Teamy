import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Points,
  Vector3,
  type BufferAttribute,
  type Material,
  type Object3D,
} from "three";
import {
  MARKING_Y_M,
  PAVEMENT_Y_M,
  ROAD_Y_M,
  WATER_Y_M,
  buildCell,
  type CellInput,
} from "./buildCell";
import { CELL_M } from "./cellGrid";
import {
  FIXTURE_TILE_RECT,
  createTestMaterials,
  fixtureTile,
  fixtureTown,
  squareRing,
} from "./testing/cityFixture";
import { GROUND_RENDER_ORDER, type WorldMaterials } from "./worldMaterials";

const CHURCH_STYLES = new Map([["cunerakerk", { style: "church" as const }]]);

/** Builds cell (cx, cy) of the fixture town. */
function buildTownCell(
  materials: WorldMaterials,
  cx = 0,
  cy = 0,
  destroyed: ReadonlySet<number> = new Set(),
): ReturnType<typeof buildCell> {
  const input: CellInput = {
    cell: { cx, cy },
    tiles: [fixtureTown()],
    destroyed,
    materials,
    landmarks: CHURCH_STYLES,
  };
  return buildCell(input);
}

/** The direct children of the cell drawn with a material. */
function drawnWith(root: Object3D, material: Material): Object3D[] {
  return root.children.filter((child) => {
    const drawn = (child as Partial<Mesh>).material;
    return Array.isArray(drawn) ? drawn.includes(material) : drawn === material;
  });
}

/** The only mesh drawn with a material. */
function meshWith(root: Object3D, material: Material): Mesh {
  const found = drawnWith(root, material);
  expect(found).toHaveLength(1);
  return found[0] as Mesh;
}

/** Every vertex of a geometry's positions. */
function positions(geometry: BufferGeometry): Vector3[] {
  const attribute = geometry.getAttribute("position") as BufferAttribute;
  return Array.from({ length: attribute.count }, (_, index) =>
    new Vector3().fromBufferAttribute(attribute, index),
  );
}

/** The y component of every indexed triangle's geometric normal. */
function faceNormalYs(geometry: BufferGeometry): number[] {
  const vertices = positions(geometry);
  const index = geometry.getIndex()!;
  const ys: number[] = [];
  for (let at = 0; at < index.count; at += 3) {
    const [a, b, c] = [0, 1, 2].map(
      (offset) => vertices[index.getX(at + offset)],
    );
    ys.push(b.clone().sub(a).cross(c.clone().sub(a)).y);
  }
  return ys;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildCell", () => {
  it("builds a child for every layer the cell has", () => {
    const materials = createTestMaterials();

    const { group } = buildTownCell(materials);

    const layers: Material[] = [
      materials.surfaces.urban,
      materials.surfaces.grass,
      materials.surfaces.forest,
      materials.surfaces.field,
      materials.surfaces.water,
      materials.surfaces.pavement,
      materials.surfaces.road,
      materials.roadMarking,
      materials.surfaces.roofTiles,
      materials.surfaces.roofFlat,
      materials.treeTrunk,
      ...materials.canopies,
      materials.lampPole,
      materials.lampHead,
      materials.lampGlow,
      materials.bench,
      materials.shelterGlass,
    ];
    for (const material of layers)
      expect(drawnWith(group, material).length).toBeGreaterThan(0);
    const walls = group.children.filter(
      (child) => child instanceof Mesh && Array.isArray(child.material),
    );
    expect(walls).toHaveLength(1);
    const dressing = group.children.filter((child) => child.type === "Group");
    expect(dressing).toHaveLength(1);
  });

  it("stands at its cell's corner with geometry in local metres", () => {
    const { group } = buildTownCell(createTestMaterials(), 0, 1);

    expect(group.position.toArray()).toEqual([0, 0, CELL_M]);
  });

  it("lays each flat layer at its height, facing up, painted in 2D order", () => {
    const materials = createTestMaterials();
    const { group } = buildTownCell(materials);
    const layers: [Material, number, number][] = [
      [materials.surfaces.urban, 0, GROUND_RENDER_ORDER.urban],
      [materials.surfaces.grass, 0, GROUND_RENDER_ORDER.grass],
      [materials.surfaces.water, WATER_Y_M, GROUND_RENDER_ORDER.water],
      [materials.surfaces.pavement, PAVEMENT_Y_M, GROUND_RENDER_ORDER.pavement],
      [materials.surfaces.road, ROAD_Y_M, GROUND_RENDER_ORDER.road],
      [materials.roadMarking, MARKING_Y_M, GROUND_RENDER_ORDER.marking],
    ];

    for (const [material, height, order] of layers) {
      const mesh = meshWith(group, material);
      expect(mesh.renderOrder).toBe(order);
      for (const vertex of positions(mesh.geometry))
        expect(vertex.y).toBeCloseTo(height, 6);
      for (const y of faceNormalYs(mesh.geometry)) expect(y).toBeGreaterThan(0);
    }
  });

  it("covers the whole cell with urban ground and clips big polygons to it", () => {
    const materials = createTestMaterials();
    const { group } = buildTownCell(materials);

    const base = positions(meshWith(group, materials.surfaces.urban).geometry);
    expect(Math.min(...base.map((v) => v.x))).toBe(0);
    expect(Math.max(...base.map((v) => v.z))).toBe(CELL_M);
    const field = positions(meshWith(group, materials.surfaces.field).geometry);
    for (const vertex of field) {
      expect(vertex.x).toBeGreaterThanOrEqual(0);
      expect(vertex.x).toBeLessThanOrEqual(CELL_M);
      expect(vertex.z).toBeGreaterThanOrEqual(100);
    }
  });

  it("builds each building in exactly one cell", () => {
    const materials = createTestMaterials();
    const town = fixtureTown();

    const home = buildTownCell(materials, 0, 0);
    const east = buildTownCell(materials, 1, 0);

    const homeIds = home.ranges.map((range) => range.structureId);
    const eastIds = east.ranges.map((range) => range.structureId);
    expect(homeIds.sort()).toEqual(
      town.buildings
        .slice(0, 3)
        .map((b) => b.structureId)
        .sort(),
    );
    expect(eastIds).toEqual([town.buildings[3].structureId]);
    expect(home.buildings.map((b) => b.structureId).sort()).toEqual(homeIds);
  });

  it("builds a building cut by a tile edge once, from each tile's own side", () => {
    const materials = createTestMaterials();
    const west = fixtureTile(
      { x: 0, y: 0, rect: { minX: -2000, minY: 0, maxX: 100, maxY: 2000 } },
      {
        buildings: [
          {
            ring: [
              [80, 10],
              [115, 10],
              [115, 20],
              [80, 20],
            ],
            levels: 2,
          },
        ],
      },
    );
    const east = fixtureTile(
      { x: 1, y: 0, rect: { minX: 100, minY: 0, maxX: 2000, maxY: 2000 } },
      {
        buildings: [
          {
            ring: [
              [80, 10],
              [115, 10],
              [115, 20],
              [80, 20],
            ],
            levels: 2,
          },
        ],
      },
    );

    const { walls, ranges } = buildCell({
      cell: { cx: 0, cy: 0 },
      tiles: [west, east],
      destroyed: new Set(),
      materials,
    });

    expect(ranges).toHaveLength(2);
    const xs = positions(walls!).map((vertex) => vertex.x);
    expect(Math.min(...xs)).toBeCloseTo(80);
    expect(Math.max(...xs)).toBeCloseTo(115);
    const [first, second] = ranges
      .map((range) =>
        positions(walls!)
          .slice(range.start, range.start + range.count)
          .map((v) => v.x),
      )
      .sort((left, right) => Math.min(...left) - Math.min(...right));
    expect(Math.max(...first)).toBeCloseTo(100);
    expect(Math.min(...second)).toBeCloseTo(100);
  });

  it("leaves a destroyed building out but still lists it for its health", () => {
    const town = fixtureTown();
    const house = town.buildings[0].structureId;

    const built = buildTownCell(createTestMaterials(), 0, 0, new Set([house]));

    expect(built.ranges.map((range) => range.structureId)).not.toContain(house);
    expect(built.buildings.map((building) => building.structureId)).toContain(
      house,
    );
  });

  it("instances trees by owner cell, two greens by id parity", () => {
    const materials = createTestMaterials();
    const { group } = buildTownCell(materials);

    const trunks = meshWith(group, materials.treeTrunk) as InstancedMesh;
    expect(trunks.count).toBe(3);
    const greens = materials.canopies.map(
      (canopy) => (meshWith(group, canopy) as InstancedMesh).count,
    );
    expect(greens).toEqual([2, 1]);
  });

  it("sets out furniture facing the road, and street lamps along the pavements", () => {
    const { furniture } = buildTownCell(createTestMaterials());

    const kinds = furniture.map((piece) => piece.kind);
    expect(kinds.filter((kind) => kind === "bench")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "busStop")).toHaveLength(1);
    const shelter = furniture.find((piece) => piece.kind === "busStop")!;
    expect(Math.cos(shelter.heading)).toBeCloseTo(1);
    const lamps = furniture.filter((piece) => piece.kind === "lamp");
    expect(lamps.length).toBeGreaterThan(4);
    const dataLamp = lamps.find((lamp) => lamp.x === 60 && lamp.y === 70)!;
    expect(Math.sin(dataLamp.heading)).toBeCloseTo(-1);
    const streetLamps = lamps.filter(
      (lamp) => Math.abs(lamp.y - 64) < 5 && lamp.x < 100,
    );
    for (const lamp of streetLamps)
      expect(Math.abs(lamp.y - 64)).toBeCloseTo(3.6);
  });

  it("copies a furniture proxy's pose into its instances on sync", () => {
    const materials = createTestMaterials();
    const built = buildTownCell(materials);
    const bench = built.furniture.find((piece) => piece.kind === "bench")!;
    const benches = meshWith(built.group, materials.bench) as InstancedMesh;
    const before = new Matrix4();
    benches.getMatrixAt(0, before);

    bench.object.rotation.x = Math.PI / 2;
    built.syncFurniture();

    const after = new Matrix4();
    benches.getMatrixAt(0, after);
    expect(after.equals(before)).toBe(false);
    const up = new Vector3(0, 1, 0).transformDirection(after);
    expect(Math.abs(up.y)).toBeLessThan(1e-6);
    const standsAt = new Vector3().setFromMatrixPosition(after);
    expect(standsAt.x).toBeCloseTo(30);
    expect(standsAt.z).toBeCloseTo(58);
  });

  it("hides a lamp whose proxy is hidden, halo and all", () => {
    const materials = createTestMaterials();
    const built = buildTownCell(materials);
    const lamps = built.furniture.filter((piece) => piece.kind === "lamp");
    const poles = drawnWith(built.group, materials.lampPole).find(
      (mesh) => (mesh as InstancedMesh).count === lamps.length,
    ) as InstancedMesh;
    const halos = meshWith(
      built.group,
      materials.lampGlow,
    ) as unknown as Points;

    lamps[0].object.visible = false;
    built.syncFurniture();

    const pose = new Matrix4();
    poles.getMatrixAt(0, pose);
    expect(new Vector3(1, 1, 1).transformDirection(pose).length()).toBe(0);
    const glow = halos.geometry.getAttribute("position") as BufferAttribute;
    expect(glow.getY(0)).toBeLessThan(-1);
    expect(glow.getY(1)).toBeGreaterThan(4);
  });

  it("frees every geometry it made but none of the shared materials", () => {
    const materials = createTestMaterials();
    const built = buildTownCell(materials);
    const geometries = new Set<BufferGeometry>();
    built.group.traverse((node) => {
      const geometry = (node as Partial<Mesh>).geometry;
      if (geometry) geometries.add(geometry);
    });
    const spies = [...geometries].map((geometry) =>
      vi.spyOn(geometry, "dispose"),
    );
    const shared = [
      ...Object.values(materials.surfaces),
      ...Object.values(materials.facades).flat(),
      materials.roadMarking,
      materials.treeTrunk,
      ...materials.canopies,
      materials.lampPole,
      materials.lampHead,
      materials.lampGlow,
      materials.bench,
      materials.shelterGlass,
    ].map((material) => vi.spyOn(material, "dispose"));
    const instanced = built.group.children.filter(
      (child) => child instanceof InstancedMesh,
    );
    const instanceSpies = instanced.map((mesh) =>
      vi.spyOn(mesh as InstancedMesh, "dispose"),
    );

    built.dispose();

    expect(spies.length).toBeGreaterThan(15);
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    for (const spy of instanceSpies) expect(spy).toHaveBeenCalled();
    for (const spy of shared) expect(spy).not.toHaveBeenCalled();
  });

  it("builds nothing for a cell no tile reaches", () => {
    const built = buildTownCell(createTestMaterials(), 40, 40);

    expect(built.group.children).toHaveLength(0);
    expect(built.walls).toBeNull();
    expect(built.furniture).toEqual([]);
  });

  it("keeps the ground inside the map where a cell hangs over its edge", () => {
    const materials = createTestMaterials();
    const edge = fixtureTile(
      { x: 0, y: 0, rect: { ...FIXTURE_TILE_RECT, maxX: 64 } },
      { ground: [{ ring: squareRing(0, 0, 200), kind: "grass" }] },
    );

    const { group } = buildCell({
      cell: { cx: 0, cy: 0 },
      tiles: [edge],
      destroyed: new Set(),
      materials,
    });

    for (const material of [
      materials.surfaces.urban,
      materials.surfaces.grass,
    ]) {
      const xs = positions(meshWith(group, material).geometry).map((v) => v.x);
      expect(Math.max(...xs)).toBe(64);
    }
    expect(
      group.children.filter((child) => child instanceof Points),
    ).toHaveLength(0);
  });
});
