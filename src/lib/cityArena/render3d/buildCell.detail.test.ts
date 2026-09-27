import { describe, expect, it, vi } from "vitest";
import {
  InstancedMesh,
  Mesh,
  Points,
  type BufferAttribute,
  type BufferGeometry,
  type Object3D,
} from "three";
import { buildCell, type CellInput } from "./buildCell";
import type { CityDetail } from "./cityDetail";
import { FACADE_BLOCK_ATTRIBUTE } from "./facadeAtlas";
import { CYCLE_PATH_M } from "./streetMarkings";
import { createTestMaterials, fixtureTown } from "./testing/cityFixture";
import { GROUND_RENDER_ORDER, type WorldMaterials } from "./worldMaterials";

const CHURCH_STYLES = new Map([["cunerakerk", { style: "church" as const }]]);

/**
 * Vertex counts of the fixture town's cells as the first city built them (merged meshes,
 * instances × their geometry, and halo points), recorded before any detail existed: a basic
 * cell must keep building exactly these.
 */
const FIRST_CITY_VERTICES: Record<string, [number, number, number]> = {
  "0,0": [381, 2208, 9],
  "1,0": [64, 636, 2],
  "0,1": [82, 200, 2],
  "-1,0": [34, 100, 1],
  "1,1": [8, 0, 0],
  "0,-1": [66, 100, 1],
};

/** Builds a cell of the fixture town at a detail level. */
function townCell(
  materials: WorldMaterials,
  [cx, cy]: [number, number],
  detail: CityDetail,
  destroyed: ReadonlySet<number> = new Set(),
): ReturnType<typeof buildCell> {
  const input: CellInput = {
    cell: { cx, cy },
    tiles: [fixtureTown()],
    destroyed,
    materials,
    landmarks: CHURCH_STYLES,
    detail,
  };
  return buildCell(input);
}

/** Merged-mesh, instanced and point vertex counts under a root. */
function vertices(root: Object3D): [number, number, number] {
  const total: [number, number, number] = [0, 0, 0];
  root.traverse((node) => {
    if (node instanceof InstancedMesh)
      total[1] += node.count * node.geometry.getAttribute("position").count;
    else if (node instanceof Mesh)
      total[0] += node.geometry.getAttribute("position").count;
    else if (node instanceof Points)
      total[2] += node.geometry.getAttribute("position").count;
  });
  return total;
}

/** The cell's walls mesh: the one carrying façade blocks. */
function wallsOf(root: Object3D): Mesh {
  const walls = root.children.find(
    (child): child is Mesh =>
      child instanceof Mesh &&
      child.geometry.getAttribute(FACADE_BLOCK_ATTRIBUTE) !== undefined,
  );
  if (!walls) throw new Error("no walls");
  return walls;
}

/** The meshes drawn with a material. */
function drawnWith(root: Object3D, material: unknown): Mesh[] {
  return root.children.filter(
    (child): child is Mesh =>
      child instanceof Mesh && child.material === material,
  );
}

describe("buildCell detail", () => {
  it.each(Object.entries(FIRST_CITY_VERTICES))(
    "builds basic cell %s with exactly the first city's geometry",
    (key, expected) => {
      const [cx, cy] = key.split(",").map(Number) as [number, number];

      const built = townCell(createTestMaterials(), [cx, cy], "basic");

      expect(vertices(built.group)).toEqual(expected);
      expect(drawnWith(built.group, createTestMaterials().detail)).toEqual([]);
    },
  );

  it("adds one vertex-coloured detail mesh and richer walls to a full cell", () => {
    const materials = createTestMaterials();

    const basic = townCell(materials, [0, 0], "basic");
    const full = townCell(materials, [0, 0], "full");

    expect(drawnWith(basic.group, materials.detail)).toHaveLength(0);
    const [detail] = drawnWith(full.group, materials.detail);
    expect(drawnWith(full.group, materials.detail)).toHaveLength(1);
    expect(detail.geometry.getAttribute("color")).toBeDefined();
    const count = (mesh: Mesh): number =>
      mesh.geometry.getAttribute("position").count;
    expect(count(wallsOf(full.group))).toBeGreaterThan(
      count(wallsOf(basic.group)),
    );
    expect(drawnWith(full.group, materials.facade)).toHaveLength(1);
  });

  it("paints cycle paths and zebras in one layer-ordered mesh on a full cell only", () => {
    const materials = createTestMaterials();

    const basic = townCell(materials, [0, 0], "basic");
    const full = townCell(materials, [0, 0], "full");

    expect(drawnWith(basic.group, materials.streetPaint)).toHaveLength(0);
    const paint = drawnWith(full.group, materials.streetPaint);
    expect(paint).toHaveLength(1);
    expect(paint[0].renderOrder).toBe(GROUND_RENDER_ORDER.paint);
    expect(paint[0].renderOrder).toBeGreaterThan(GROUND_RENDER_ORDER.marking);
  });

  it("moves the lamps of a road with cycle paths out past them on a full cell", () => {
    const materials = createTestMaterials();
    const lampsBy = (detail: CityDetail): number[] =>
      townCell(materials, [0, 0], detail)
        .furniture.filter(
          (piece) =>
            piece.kind === "lamp" &&
            Math.abs(piece.x - 110) < 12 &&
            piece.y > -40 &&
            piece.y < 30,
        )
        .map((piece) => Math.abs(piece.x - 110));

    const basic = lampsBy("basic");
    const full = lampsBy("full");

    expect(full.length).toBeGreaterThan(0);
    expect(Math.min(...full)).toBeGreaterThan(Math.max(...basic));
    for (const distance of full)
      expect(distance).toBeGreaterThan(4.5 + CYCLE_PATH_M);
  });

  it("builds the same full cell every time", () => {
    const materials = createTestMaterials();
    const positions = (): number[] => {
      const built = townCell(materials, [0, 0], "full");
      return [
        wallsOf(built.group),
        ...drawnWith(built.group, materials.detail),
      ].flatMap((mesh) =>
        Array.from(
          (mesh.geometry.getAttribute("position") as BufferAttribute).array,
        ),
      );
    };

    expect(positions()).toEqual(positions());
  });

  it("leaves a fallen building's detail out with its walls", () => {
    const materials = createTestMaterials();
    const town = fixtureTown();
    const standing = townCell(materials, [0, 0], "full");
    const fallen = townCell(
      materials,
      [0, 0],
      "full",
      new Set(town.buildings.map((b) => b.structureId)),
    );

    expect(fallen.walls).toBeNull();
    const detailOf = (built: typeof standing): number =>
      drawnWith(built.group, materials.detail).reduce(
        (sum, mesh) => sum + mesh.geometry.getAttribute("position").count,
        0,
      );
    expect(detailOf(fallen)).toBeLessThan(detailOf(standing));
  });

  it("frees the detail geometry with the cell", () => {
    const materials = createTestMaterials();
    const built = townCell(materials, [0, 0], "full");
    const [detail] = drawnWith(built.group, materials.detail);
    const dispose = vi.spyOn(detail.geometry as BufferGeometry, "dispose");

    built.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
