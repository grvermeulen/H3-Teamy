import { describe, expect, it } from "vitest";
import type { DecodedTile } from "../world/decode";
import {
  CANOPY_LAYER,
  CANOPY_RESOLUTION,
  paintCanopies,
  paintTreeShadows,
} from "./drawScenery";
import { TREE_CANOPY_FILL, TREE_SHADOW } from "./palette";
import type { ArenaSprites } from "./sprites";
import { createFakeContext } from "./testing/fakeContext";

/** A tile with one small tree at (40, 40) and one large at (60, 60). */
const tile: DecodedTile = {
  x: 0,
  y: 0,
  rect: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
  roads: [],
  buildings: [],
  ground: [],
  water: [],
  trees: [
    {
      point: [40, 40],
      size: 0,
      bounds: { minX: 37, minY: 37, maxX: 43, maxY: 43 },
    },
    {
      point: [60, 60],
      size: 1,
      bounds: { minX: 55, minY: 55, maxX: 65, maxY: 65 },
    },
  ],
  furniture: [],
};
const chunk = { minX: 0, minY: 0, maxX: 128, maxY: 128 };
const image = document.createElement("canvas");
const sprites: ArenaSprites = {
  props: {
    treeSmall: { image, lengthMetres: 6, widthMetres: 6 },
    treeLarge: { image, lengthMetres: 10, widthMetres: 10 },
  },
};

describe("paintTreeShadows and paintCanopies", () => {
  it("paints only the shadows on the ground, and the canopies apart, flat without art", () => {
    const ground = createFakeContext();
    paintTreeShadows(ground, [tile], chunk);
    expect(
      ground.calls.filter((call) => call === `fill(${TREE_SHADOW})`),
    ).toHaveLength(2);
    expect(
      ground.calls.some((call) =>
        call.startsWith(`fill(${TREE_CANOPY_FILL[0]})`),
      ),
    ).toBe(false);
    const overhead = createFakeContext();
    paintCanopies(overhead, [tile], chunk, undefined);
    expect(overhead.calls).toContain(`fill(${TREE_CANOPY_FILL[0]})`);
    expect(overhead.calls).toContain(`fill(${TREE_CANOPY_FILL[1]})`);
    expect(overhead.calls.some((call) => call === `fill(${TREE_SHADOW})`)).toBe(
      false,
    );
  });

  it("draws the canopy art turned by the tree's own angle once it has loaded", () => {
    const context = createFakeContext();
    paintCanopies(context, [tile], chunk, sprites.props);
    const images = context.calls.filter((call) =>
      call.startsWith("drawImage("),
    );
    expect(images).toEqual([
      `drawImage(${String(image)},-3,-3,6,6)`,
      `drawImage(${String(image)},-5,-5,10,10)`,
    ]);
    expect(
      context.calls.filter((call) => call.startsWith("rotate(")),
    ).toHaveLength(2);
  });
});

describe("CANOPY_LAYER", () => {
  it("covers only chunks a canopy reaches into, paints at half resolution in world metres", () => {
    expect(CANOPY_LAYER.resolution).toBe(CANOPY_RESOLUTION);
    expect(CANOPY_LAYER.covers(chunk, [tile])).toBe(true);
    expect(
      CANOPY_LAYER.covers({ minX: 128, minY: 0, maxX: 256, maxY: 128 }, [tile]),
    ).toBe(false);
    expect(
      CANOPY_LAYER.covers({ minX: 43, minY: 0, maxX: 128, maxY: 128 }, [tile]),
    ).toBe(true);
    const context = createFakeContext();
    CANOPY_LAYER.paint(
      context,
      { minX: 128, minY: 256, maxX: 256, maxY: 384 },
      3,
      [tile],
      new Map(),
      sprites,
    );
    expect(context.calls[0]).toBe("setTransform(3,0,0,3,-384,-768)");
    expect(
      context.calls.filter((call) => call.startsWith("drawImage(")),
    ).toHaveLength(0);
    const near = createFakeContext();
    CANOPY_LAYER.paint(near, chunk, 3, [tile], new Map(), sprites);
    expect(
      near.calls.filter((call) => call.startsWith("drawImage(")),
    ).toHaveLength(2);
  });
});
