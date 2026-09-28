import { describe, expect, it } from "vitest";
import { Vector3, type BufferAttribute, type BufferGeometry } from "three";
import type { DecodedBuilding } from "../world/decode";
import type { Point } from "../world/projection";
import { boundsOf } from "../mapBuild/geometry";
import {
  FACADE_MATERIAL_COUNT,
  MIN_BUILDING_HEIGHT_M,
  STOREY_M,
  buildBuildingGeometry,
  buildingHeight,
  facadeMaterialIndex,
  shadeBuilding,
} from "./buildingMesh";
import { FACADE_MODULE_M } from "./textures";

/** A building fixture from a ring. */
function building(
  structureId: number,
  ring: Point[],
  levels: number,
  landmark?: string,
): DecodedBuilding {
  return { structureId, ring, bounds: boundsOf(ring), levels, landmark };
}

/** A square footprint of `side` metres with its corner at (x, y), counter-clockwise or not. */
function square(
  x: number,
  y: number,
  side: number,
  clockwise = false,
): Point[] {
  const ring: Point[] = [
    [x, y],
    [x + side, y],
    [x + side, y + side],
    [x, y + side],
  ];
  return clockwise ? ring.reverse() : ring;
}

/** Every vertex of an attribute as a Vector3. */
function vectors(attribute: BufferAttribute): Vector3[] {
  return Array.from({ length: attribute.count }, (_, index) =>
    new Vector3().fromBufferAttribute(attribute, index),
  );
}

/** The geometric normal of each indexed triangle. */
function faceNormals(geometry: BufferGeometry): Vector3[] {
  const position = geometry.getAttribute("position") as BufferAttribute;
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const vertex = (at: number): Vector3 =>
    new Vector3().fromBufferAttribute(position, index ? index.getX(at) : at);
  const normals: Vector3[] = [];
  for (let at = 0; at < count; at += 3) {
    const [a, b, c] = [vertex(at), vertex(at + 1), vertex(at + 2)];
    normals.push(b.clone().sub(a).cross(c.clone().sub(a)).normalize());
  }
  return normals;
}

/** True when no attribute of the geometry holds a NaN. */
function finite(geometry: BufferGeometry): boolean {
  return Object.values(geometry.attributes).every((attribute) =>
    Array.from((attribute as BufferAttribute).array).every(Number.isFinite),
  );
}

describe("buildingHeight", () => {
  it("stacks 3.1 m storeys but never goes below 3.5 m", () => {
    expect(buildingHeight(2)).toBeCloseTo(2 * STOREY_M);
    expect(buildingHeight(1)).toBe(MIN_BUILDING_HEIGHT_M);
    expect(buildingHeight(0)).toBe(MIN_BUILDING_HEIGHT_M);
  });
});

describe("buildBuildingGeometry", () => {
  it.each([false, true])(
    "walls a 10 m two-storey square with four outward quads (clockwise %s)",
    (clockwise) => {
      const house = building(7, square(0, 0, 10, clockwise), 2);

      const { walls, roofsTiled, roofsFlat, ranges } = buildBuildingGeometry(
        [house],
        new Set(),
      );

      const position = walls.getAttribute("position") as BufferAttribute;
      expect(position.count).toBe(16);
      expect(walls.getIndex()?.count).toBe(24);
      expect(Math.max(...vectors(position).map((v) => v.y))).toBeCloseTo(6.2);
      const centre = new Vector3(5, 0, 5);
      const normals = vectors(walls.getAttribute("normal") as BufferAttribute);
      vectors(position).forEach((vertex, index) => {
        expect(normals[index].y).toBe(0);
        const outward = vertex.clone().sub(centre).setY(0);
        expect(normals[index].dot(outward)).toBeGreaterThan(0);
      });
      for (const face of faceNormals(walls)) {
        expect(Math.abs(face.y)).toBeLessThan(1e-9);
      }
      expect(ranges).toEqual([{ structureId: 7, start: 0, count: 16 }]);
      expect(roofsTiled.getAttribute("position").count).toBeGreaterThan(0);
      expect(roofsFlat.getAttribute("position").count).toBe(0);
      for (const geometry of [walls, roofsTiled])
        expect(finite(geometry)).toBe(true);
    },
  );

  it("winds every wall triangle to face the way its normal points", () => {
    const { walls } = buildBuildingGeometry(
      [
        building(1, square(0, 0, 10), 2),
        building(2, square(30, 0, 10, true), 2),
      ],
      new Set(),
    );
    const normals = walls.getAttribute("normal") as BufferAttribute;
    const index = walls.getIndex()!;

    faceNormals(walls).forEach((face, triangle) => {
      const stored = new Vector3().fromBufferAttribute(
        normals,
        index.getX(triangle * 3),
      );
      expect(face.dot(stored)).toBeGreaterThan(0.99);
    });
  });

  it("runs wall u along the perimeter in 6 m modules and v up in storeys", () => {
    const { walls } = buildBuildingGeometry(
      [building(3, square(0, 0, 12), 2)],
      new Set(),
    );
    const uv = walls.getAttribute("uv") as BufferAttribute;
    const us = Array.from({ length: uv.count }, (_, at) => uv.getX(at));
    const vs = Array.from({ length: uv.count }, (_, at) => uv.getY(at));

    const spanU = Math.max(...us) - Math.min(...us);
    const spanV = Math.max(...vs) - Math.min(...vs);
    expect(spanU).toBeCloseTo((4 * 12) / FACADE_MODULE_M);
    expect(spanV).toBeCloseTo(buildingHeight(2) / STOREY_M);
    // Seeded offsets shift the grid by whole modules and storeys only.
    expect(Number.isInteger(Math.min(...us))).toBe(true);
    expect(Number.isInteger(Math.min(...vs))).toBe(true);
  });

  it("paints the walls white so façade vertex colours show as painted", () => {
    const { walls } = buildBuildingGeometry(
      [building(4, square(0, 0, 10), 2)],
      new Set(),
    );
    const colour = walls.getAttribute("color") as BufferAttribute;

    expect(colour.count).toBe(16);
    expect(Array.from(colour.array).every((channel) => channel === 1)).toBe(
      true,
    );
  });

  it.each([false, true])(
    "turns every roof face up (clockwise %s)",
    (clockwise) => {
      const { roofsTiled, roofsFlat } = buildBuildingGeometry(
        [
          building(5, square(0, 0, 10, clockwise), 2),
          building(6, square(50, 0, 40, clockwise), 4),
          building(
            7,
            [
              [100, 0],
              [112, 0],
              [112, 4],
              [104, 4],
              [104, 12],
              [100, 12],
            ],
            1,
          ),
        ],
        new Set(),
      );

      for (const roofs of [roofsTiled, roofsFlat]) {
        expect(faceNormals(roofs).length).toBeGreaterThan(0);
        for (const face of faceNormals(roofs))
          expect(face.y).toBeGreaterThan(0);
        const normals = vectors(
          roofs.getAttribute("normal") as BufferAttribute,
        );
        for (const normal of normals) expect(normal.y).toBeGreaterThan(0);
        expect(finite(roofs)).toBe(true);
      }
    },
  );

  it("puts a big or tall building's roof in the flat gravel set", () => {
    const { roofsTiled, roofsFlat } = buildBuildingGeometry(
      [building(8, square(0, 0, 20), 2), building(9, square(40, 0, 10), 4)],
      new Set(),
    );

    expect(roofsTiled.getAttribute("position").count).toBe(0);
    const heights = vectors(
      roofsFlat.getAttribute("position") as BufferAttribute,
    ).map((vertex) => vertex.y);
    expect(new Set(heights.map((height) => height.toFixed(2)))).toEqual(
      new Set([buildingHeight(2).toFixed(2), buildingHeight(4).toFixed(2)]),
    );
  });

  it("raises a low hip over a small rectangular house", () => {
    const { roofsTiled } = buildBuildingGeometry(
      [
        building(
          10,
          [
            [0, 0],
            [12, 0],
            [12, 7],
            [0, 7],
          ],
          2,
        ),
      ],
      new Set(),
    );
    const heights = vectors(
      roofsTiled.getAttribute("position") as BufferAttribute,
    ).map((vertex) => vertex.y);

    expect(Math.min(...heights)).toBeCloseTo(buildingHeight(2));
    expect(Math.max(...heights)).toBeGreaterThan(buildingHeight(2) + 1);
    expect(Math.max(...heights)).toBeLessThan(buildingHeight(2) + 3);
  });

  it("walls a roofless building but leaves its roof to its dressing", () => {
    const { walls, roofsTiled, roofsFlat, ranges } = buildBuildingGeometry(
      [building(12, square(0, 0, 10), 2), building(13, square(20, 0, 30), 2)],
      new Set(),
      { roofless: new Set([12, 13]) },
    );

    expect(ranges.map((range) => range.structureId).sort()).toEqual([12, 13]);
    expect(walls.getAttribute("position").count).toBe(32);
    expect(roofsTiled.getAttribute("position").count).toBe(0);
    expect(roofsFlat.getAttribute("position").count).toBe(0);
  });

  it("leaves out a skipped building entirely", () => {
    const { walls, roofsTiled, roofsFlat, ranges } = buildBuildingGeometry(
      [building(11, square(0, 0, 10), 2)],
      new Set([11]),
    );

    expect(walls.getAttribute("position").count).toBe(0);
    expect(roofsTiled.getAttribute("position").count).toBe(0);
    expect(roofsFlat.getAttribute("position").count).toBe(0);
    expect(ranges).toEqual([]);
  });

  it("groups the walls by façade material, each building's vertices in one range", () => {
    const buildings = Array.from({ length: 24 }, (_, index) =>
      building(
        100 + index,
        square(index * 20, 0, 10 + (index % 4) * 12),
        1 + (index % 7),
      ),
    );

    const { walls, ranges } = buildBuildingGeometry(buildings, new Set());

    const groups = walls.groups;
    expect(groups.length).toBeGreaterThan(1);
    const indexCount = walls.getIndex()!.count;
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(
      indexCount,
    );
    for (const group of groups) {
      expect(group.materialIndex).toBeGreaterThanOrEqual(0);
      expect(group.materialIndex).toBeLessThan(FACADE_MATERIAL_COUNT);
    }
    expect(new Set(groups.map((group) => group.materialIndex)).size).toBe(
      groups.length,
    );
    expect(ranges.map((range) => range.structureId).sort()).toEqual(
      buildings.map((entry) => entry.structureId).sort(),
    );
    const vertices = ranges.reduce((sum, range) => sum + range.count, 0);
    expect(vertices).toBe(walls.getAttribute("position").count);
  });
});

describe("facadeMaterialIndex", () => {
  it("is a pure function of the building", () => {
    const tower = building(12345, square(0, 0, 30), 8);

    expect(facadeMaterialIndex(tower)).toBe(facadeMaterialIndex({ ...tower }));
  });

  it("dresses houses in brick or plaster and towers in glass or concrete", () => {
    const styles = (levels: number, side: number): Set<number> =>
      new Set(
        Array.from({ length: 60 }, (_, id) =>
          Math.floor(
            facadeMaterialIndex(building(id, square(0, 0, side), levels)) / 3,
          ),
        ),
      );

    expect(styles(2, 9)).toEqual(new Set([0, 1]));
    expect(styles(9, 30)).toEqual(new Set([2, 3]));
    expect(styles(2, 60)).toEqual(new Set([2]));
  });
});

describe("shadeBuilding", () => {
  it("scorches one building's walls toward black by its damage share", () => {
    const { walls, ranges } = buildBuildingGeometry(
      [building(1, square(0, 0, 10), 2), building(2, square(20, 0, 10), 2)],
      new Set(),
    );
    const colour = walls.getAttribute("color") as BufferAttribute;
    const before = colour.version;
    const [first, second] = ranges;

    shadeBuilding(walls, first, 1);

    for (let at = first.start; at < first.start + first.count; at++) {
      expect(colour.getX(at)).toBeCloseTo(0.2);
      expect(colour.getZ(at)).toBeCloseTo(0.2);
    }
    for (let at = second.start; at < second.start + second.count; at++) {
      expect(colour.getY(at)).toBe(1);
    }
    expect(colour.version).toBeGreaterThan(before);
  });

  it("replaces an earlier shade instead of compounding it", () => {
    const { walls, ranges } = buildBuildingGeometry(
      [building(1, square(0, 0, 10), 2)],
      new Set(),
    );
    const colour = walls.getAttribute("color") as BufferAttribute;

    shadeBuilding(walls, ranges[0], 1);
    shadeBuilding(walls, ranges[0], 0.5);
    expect(colour.getX(ranges[0].start)).toBeCloseTo(0.6);
    shadeBuilding(walls, ranges[0], 0);
    expect(colour.getX(ranges[0].start)).toBe(1);
  });
});
