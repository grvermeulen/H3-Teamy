import { describe, expect, it } from "vitest";
import type { BufferAttribute } from "three";
import { createDetailBuffers } from "./detailBuffers";
import { orientedBox } from "./footprint";
import { createMeshBuffers, toGeometry } from "./meshBuffers";
import {
  ROOF_OVERHANG_M,
  hipRidgeHeight,
  pushChimney,
  pushDormer,
  pushFascia,
  pushHip,
} from "./roofDetail";
import { squareRing } from "./testing/cityFixture";

/** The x and z extent and the lowest and highest point of a geometry. */
function extent(buffers: ReturnType<typeof createMeshBuffers>) {
  const position = toGeometry(buffers).getAttribute(
    "position",
  ) as BufferAttribute;
  const xs = Array.from({ length: position.count }, (_, at) =>
    position.getX(at),
  );
  const ys = Array.from({ length: position.count }, (_, at) =>
    position.getY(at),
  );
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

describe("pushHip", () => {
  const ring = squareRing(0, 0, 10).map(([x, y]): [number, number] => [
    x,
    y * 1.4,
  ]);

  it("reaches past the walls by its overhang, dropping with its pitch", () => {
    const plain = createMeshBuffers();
    const over = createMeshBuffers();

    pushHip(plain, ring, 6.2, [0, 0]);
    pushHip(over, ring, 6.2, [0, 0], ROOF_OVERHANG_M);

    const [a, b] = [extent(plain), extent(over)];
    expect(a.minX).toBeCloseTo(0, 5);
    expect(b.minX).toBeCloseTo(-ROOF_OVERHANG_M, 5);
    expect(b.maxY).toBeCloseTo(a.maxY, 5);
    expect(b.minY).toBeLessThan(a.minY);
    expect(plain.positions.length).toBe(over.positions.length);
  });
});

describe("roof detail", () => {
  const ring = squareRing(0, 0, 9).map(([x, y]): [number, number] => [
    x,
    y * 1.2,
  ]);
  const box = orientedBox(ring);
  const heights = { eaves: 6.2, ridge: hipRidgeHeight(ring, 6.2) };

  it("stands a chimney over the ridge", () => {
    const detail = createDetailBuffers();

    pushChimney(detail, box, heights, [0, 0], 0);

    const ys = detail.positions.filter((_, index) => index % 3 === 1);
    expect(Math.max(...ys)).toBeGreaterThan(heights.ridge);
  });

  it("keeps a dormer under the ridge and inside the footprint", () => {
    const detail = createDetailBuffers();

    pushDormer(detail, box, heights, [0, 0], 1);

    const ys = detail.positions.filter((_, index) => index % 3 === 1);
    expect(Math.max(...ys)).toBeLessThan(heights.ridge);
    const xs = detail.positions.filter((_, index) => index % 3 === 0);
    const zs = detail.positions.filter((_, index) => index % 3 === 2);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(-0.2);
    for (const z of zs) expect(z).toBeLessThanOrEqual(9 * 1.2 + 0.2);
  });

  it("boards every overhanging side: a fascia and a soffit each", () => {
    const detail = createDetailBuffers();

    pushFascia(
      detail,
      box,
      { long: true, ends: true },
      {
        colour: 0xffffff,
        overhang: ROOF_OVERHANG_M,
        edge: 6.1,
        origin: [0, 0],
      },
    );

    expect(detail.positions.length / 3).toBe(4 * 2 * 4);
  });
});
