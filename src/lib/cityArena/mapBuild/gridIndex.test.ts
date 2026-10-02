import { describe, expect, it } from "vitest";
import { createGridIndex } from "./gridIndex";

describe("createGridIndex", () => {
  it("finds the items near a point, each once, and nothing far away", () => {
    const index = createGridIndex<string>(10);
    index.insert({ minX: 0, minY: 0, maxX: 25, maxY: 5 }, "wide");
    index.insert({ minX: 40, minY: 40, maxX: 42, maxY: 42 }, "far");
    expect(index.near([12, 2], 1)).toEqual(["wide"]);
    expect(index.near([26, 2], 2)).toEqual(["wide"]);
    expect(index.near([30, 30], 5)).toEqual([]);
    expect(index.near([41, 41], 1)).toEqual(["far"]);
  });

  it("works across negative coordinates", () => {
    const index = createGridIndex<number>(16);
    index.insert({ minX: -30, minY: -30, maxX: -20, maxY: -20 }, 1);
    expect(index.near([-25, -25], 1)).toEqual([1]);
    expect(index.near([-5, -5], 1)).toEqual([]);
  });
});
