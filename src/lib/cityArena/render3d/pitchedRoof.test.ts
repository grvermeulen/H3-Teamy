import { describe, expect, it } from "vitest";
import { Vector3, type BufferAttribute, type BufferGeometry } from "three";
import type { Point } from "../world/projection";
import { pitchedRoofGeometry } from "./pitchedRoof";

const EAVES_M = 8;
const RISE_M = 5;
/** A 30 × 10 m hall, its long side along x. */
const HALL: Point[] = [
  [0, 0],
  [30, 0],
  [30, 10],
  [0, 10],
];
/** An L: a 30 × 10 m nave with a 10 × 10 m wing, so the roof must not cover the notch. */
const ELL: Point[] = [
  [0, 0],
  [30, 0],
  [30, 20],
  [20, 20],
  [20, 10],
  [0, 10],
];

/** Every triangle of an indexed geometry as its three corners. */
function triangles(geometry: BufferGeometry): Vector3[][] {
  const position = geometry.getAttribute("position") as BufferAttribute;
  const index = geometry.getIndex()!;
  const corner = (at: number): Vector3 =>
    new Vector3().fromBufferAttribute(position, index.getX(at));
  return Array.from({ length: index.count / 3 }, (_, face) => [
    corner(face * 3),
    corner(face * 3 + 1),
    corner(face * 3 + 2),
  ]);
}

/** A triangle's area and unit normal (from its winding). */
function faceOf([a, b, c]: Vector3[]): { area: number; normal: Vector3 } {
  const cross = b.clone().sub(a).cross(c.clone().sub(a));
  return { area: cross.length() / 2, normal: cross.normalize() };
}

/** The total area of a geometry's triangles. */
function area(geometry: BufferGeometry): number {
  return triangles(geometry).reduce((sum, face) => sum + faceOf(face).area, 0);
}

describe("pitchedRoofGeometry", () => {
  it.each([false, true])(
    "pitches a hall's two slopes up to a ridge along its length (reversed %s)",
    (reversed) => {
      const ring = reversed ? [...HALL].reverse() : HALL;

      const { slopes } = pitchedRoofGeometry(ring, EAVES_M, RISE_M);

      const heights = triangles(slopes)
        .flat()
        .map((corner) => corner.y);
      expect(Math.min(...heights)).toBeCloseTo(EAVES_M);
      expect(Math.max(...heights)).toBeCloseTo(EAVES_M + RISE_M);
      for (const face of triangles(slopes)) {
        expect(faceOf(face).normal.y).toBeGreaterThan(0);
      }
      expect(area(slopes)).toBeCloseTo(2 * 30 * Math.hypot(5, RISE_M), 4);
    },
  );

  it("closes the hall's ends with two outward gable triangles", () => {
    const { gables } = pitchedRoofGeometry(HALL, EAVES_M, RISE_M);

    expect(area(gables)).toBeCloseTo(2 * ((10 * RISE_M) / 2), 4);
    for (const face of triangles(gables)) {
      const { normal } = faceOf(face);
      expect(Math.abs(normal.y)).toBeLessThan(1e-9);
      const middle = face[0].clone().add(face[1]).add(face[2]).divideScalar(3);
      const outward = middle.sub(new Vector3(15, 0, 5)).setY(0);
      expect(normal.dot(outward)).toBeGreaterThan(0);
    }
  });

  it("keeps an L's roof inside its footprint, walls closing the notch", () => {
    const { slopes, gables } = pitchedRoofGeometry(ELL, EAVES_M, RISE_M);

    for (const corner of triangles(slopes).flat()) {
      const inNave = corner.z <= 10 + 1e-6;
      const inWing = corner.x >= 20 - 1e-6;
      expect(inNave || inWing).toBe(true);
      expect(corner.y).toBeGreaterThanOrEqual(EAVES_M - 1e-6);
    }
    for (const face of triangles(slopes))
      expect(faceOf(face).normal.y).toBeGreaterThan(0);
    const footprintArea = 30 * 10 + 10 * 10;
    const planArea = triangles(slopes).reduce((sum, [a, b, c]) => {
      const flat = [a, b, c].map((v) => new Vector3(v.x, 0, v.z));
      return sum + faceOf(flat).area;
    }, 0);
    expect(planArea).toBeCloseTo(footprintArea, 4);
    expect(area(gables)).toBeGreaterThan(0);
  });
});
