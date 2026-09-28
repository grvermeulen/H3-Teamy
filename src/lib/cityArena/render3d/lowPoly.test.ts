import { describe, expect, it } from "vitest";
import { Box3, Color, Vector3 } from "three";
import { block, mergeParts, rod, shade } from "./lowPoly";

function sizeOf(geometry: ReturnType<typeof block>): Vector3 {
  geometry.computeBoundingBox();
  return (geometry.boundingBox as Box3).getSize(new Vector3());
}

describe("block", () => {
  it("fills its box, centred where asked, with no index or uvs", () => {
    const geometry = block({
      size: [0.2, 0.4, 0.3],
      at: [1, 2, 3],
      colour: 0xff0000,
    });
    expect(geometry.index).toBeNull();
    expect(geometry.getAttribute("uv")).toBeUndefined();
    const box = new Box3().setFromBufferAttribute(
      geometry.getAttribute("position") as never,
    );
    expect(box.getCenter(new Vector3()).toArray()).toEqual([1, 2, 3]);
    const size = sizeOf(geometry).toArray();
    [0.2, 0.4, 0.3].forEach((extent, axis) =>
      expect(size[axis]).toBeCloseTo(extent),
    );
  });

  it("chamfers edges inward without leaving its box", () => {
    const plain = block({ size: [1, 1, 1], at: [0, 0, 0], colour: 0 });
    const chamfered = block({
      size: [1, 1, 1],
      at: [0, 0, 0],
      colour: 0,
      chamfer: 0.3,
    });
    const farthest = (geometry: typeof plain): number => {
      const position = geometry.getAttribute("position");
      let best = 0;
      for (let index = 0; index < position.count; index += 1) {
        best = Math.max(
          best,
          new Vector3().fromBufferAttribute(position, index).length(),
        );
      }
      return best;
    };
    expect(farthest(chamfered)).toBeLessThan(farthest(plain) - 0.1);
    expect(sizeOf(chamfered).x).toBeCloseTo(1);
  });

  it("tapers the bottom toward its axis", () => {
    const geometry = block({
      size: [0.2, 1, 0.2],
      at: [0, 0, 0],
      colour: 0,
      taper: 0.5,
    });
    const position = geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      if (position.getY(index) < -0.49) {
        expect(Math.abs(position.getX(index))).toBeLessThanOrEqual(0.0501);
      }
    }
  });

  it("paints every vertex, darker toward the bottom", () => {
    const geometry = block({
      size: [1, 1, 1],
      at: [0, 0, 0],
      colour: 0x808080,
      gradient: 0.2,
    });
    const position = geometry.getAttribute("position");
    const colour = geometry.getAttribute("color");
    expect(colour.count).toBe(position.count);
    const linear = new Color(0x808080).r;
    for (let index = 0; index < colour.count; index += 1) {
      const expected = position.getY(index) > 0 ? linear : linear * 0.8;
      expect(colour.getX(index)).toBeCloseTo(expected, 5);
    }
  });

  it("has flat normals, one per face", () => {
    const geometry = block({ size: [1, 1, 1], at: [0, 0, 0], colour: 0 });
    const normal = geometry.getAttribute("normal");
    for (let index = 0; index < normal.count; index += 3) {
      const first = new Vector3().fromBufferAttribute(normal, index);
      const third = new Vector3().fromBufferAttribute(normal, index + 2);
      expect(first.distanceTo(third)).toBeCloseTo(0);
    }
  });
});

describe("rod", () => {
  it("runs along the requested axis", () => {
    const geometry = rod({
      radius: 0.05,
      length: 1,
      at: [0, 0, 0],
      axis: "x",
      colour: 0,
    });
    const size = sizeOf(geometry);
    expect(size.x).toBeCloseTo(1);
    expect(size.y).toBeLessThanOrEqual(0.1001);
    expect(geometry.index).toBeNull();
  });
});

describe("mergeParts", () => {
  it("joins parts into one geometry", () => {
    const merged = mergeParts([
      block({ size: [1, 1, 1], at: [0, 0, 0], colour: 0 }),
      block({ size: [1, 1, 1], at: [3, 0, 0], colour: 0 }),
    ]);
    expect(sizeOf(merged).x).toBeCloseTo(4);
  });
});

describe("shade", () => {
  it("scales each channel and clamps", () => {
    expect(shade(0x804020, 0.5)).toBe(0x402010);
    expect(shade(0x808080, 4)).toBe(0xffffff);
  });
});
