import { describe, expect, it } from "vitest";
import {
  Box3,
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
} from "three";
import type { Point } from "../world/projection";
import { rngFor } from "./fxEmit";
import {
  footprint,
  prismGeometry,
  RUBBLE_HEIGHT_M,
  RUBBLE_JITTER_M,
  rubbleGeometry,
} from "./ruinGeometry";

/** A 10 × 6 m block with its south-east corner at (110, 206), closed like OSM rings. */
const RING: Point[] = [
  [100, 200],
  [110, 200],
  [110, 206],
  [100, 206],
  [100, 200],
];

function bounds(geometry: BufferGeometry): Box3 {
  return new Box3().setFromBufferAttribute(
    geometry.getAttribute("position") as BufferAttribute,
  );
}

/** Each non-degenerate triangle: its middle and its (unnormalised) winding normal. */
function faces(
  geometry: BufferGeometry,
): { middle: Vector3; normal: Vector3 }[] {
  const position = geometry.getAttribute("position") as BufferAttribute;
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const corner = (at: number): Vector3 =>
    new Vector3().fromBufferAttribute(position, index ? index.getX(at) : at);
  const found: { middle: Vector3; normal: Vector3 }[] = [];
  for (let at = 0; at < count; at += 3) {
    const [a, b, c] = [corner(at), corner(at + 1), corner(at + 2)];
    const normal = new Vector3()
      .subVectors(b, a)
      .cross(new Vector3().subVectors(c, a));
    if (normal.lengthSq() < 1e-12) continue;
    found.push({ middle: a.clone().add(b).add(c).divideScalar(3), normal });
  }
  return found;
}

/** Every triangle's normal points away from `inside`. */
function facesOutward(geometry: BufferGeometry, inside: Vector3): boolean {
  return faces(geometry).every(
    ({ middle, normal }) => normal.dot(middle.sub(inside)) > 0,
  );
}

/** No triangle faces down: a mound has no underside, so an inside-out one would. */
function facesUp(geometry: BufferGeometry): boolean {
  return faces(geometry).every(({ normal }) => normal.y > 0);
}

describe("footprint", () => {
  it("centres a closed ring and drops its repeated last corner", () => {
    const { centre, outline } = footprint(RING);

    expect(centre).toEqual([105, 203]);
    expect(outline).toHaveLength(4);
    expect(outline[0]).toEqual([-5, -3]);
  });
});

describe("prismGeometry", () => {
  it("extrudes the footprint from the ground to the roof, mapping world y to three z", () => {
    const { outline } = footprint(RING);

    const size = bounds(prismGeometry(outline, 12)).getSize(new Vector3());
    const box = bounds(prismGeometry(outline, 12));

    expect(size.x).toBeCloseTo(10);
    expect(size.z).toBeCloseTo(6);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(12);
  });

  it("faces its walls and roof outward", () => {
    const geometry = prismGeometry(footprint(RING).outline, 12);

    expect(facesOutward(geometry, new Vector3(0, 6, 0))).toBe(true);
  });
});

describe("rubbleGeometry", () => {
  it("heaps a low mound over the whole footprint", () => {
    const { outline } = footprint(RING);

    const box = bounds(rubbleGeometry(outline, rngFor("rubble", 1)));

    expect(RUBBLE_HEIGHT_M).toBe(0.8);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeGreaterThan(RUBBLE_HEIGHT_M - RUBBLE_JITTER_M);
    expect(box.max.y).toBeLessThan(RUBBLE_HEIGHT_M * 3);
    expect(box.min.x).toBeCloseTo(-5, 1);
    expect(box.max.z).toBeCloseTo(3, 1);
  });

  it("faces the mound's slopes and top up and out", () => {
    const geometry = rubbleGeometry(footprint(RING).outline, rngFor("r", 2));

    expect(facesUp(geometry)).toBe(true);
  });

  it("jitters the top the same way for the same seed, differently for another", () => {
    const { outline } = footprint(RING);
    const positions = (seed: number): number[] =>
      Array.from(
        rubbleGeometry(outline, rngFor("rubble", seed)).getAttribute("position")
          .array,
      );

    expect(positions(7)).toEqual(positions(7));
    expect(positions(7)).not.toEqual(positions(8));
  });

  it("keeps the same shape for a ring wound the other way", () => {
    const { outline } = footprint(RING);

    const geometry = rubbleGeometry([...outline].reverse(), rngFor("r", 3));

    expect(facesUp(geometry)).toBe(true);
  });
});
