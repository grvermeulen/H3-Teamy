import { describe, expect, it } from "vitest";
import type { DecodedTile } from "../world/decode";
import { paintChunk, type LandmarkLookup } from "./drawStatic";
import {
  GROUND_FILL,
  LANDMARK_FILL,
  ROAD_CENTRE_LINE,
  ROAD_FILL,
  WATER_FILL,
} from "./palette";
import { createFakeContext } from "./testing/fakeContext";

const tile: DecodedTile = {
  x: 0,
  y: 0,
  rect: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
  roads: [
    {
      points: [
        [0, 64],
        [200, 64],
      ],
      roadClass: "primary",
      name: "Grebbeweg",
      bounds: { minX: 0, minY: 64, maxX: 200, maxY: 64 },
    },
  ],
  buildings: [
    {
      ring: [
        [10, 10],
        [30, 10],
        [30, 30],
        [10, 30],
      ],
      bounds: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
      levels: 4,
      landmark: "cunerakerk",
    },
    {
      ring: [
        [50, 10],
        [60, 10],
        [60, 20],
        [50, 20],
      ],
      bounds: { minX: 50, minY: 10, maxX: 60, maxY: 20 },
      levels: 2,
    },
  ],
  ground: [
    {
      ring: [
        [0, 0],
        [128, 0],
        [128, 128],
        [0, 128],
      ],
      bounds: { minX: 0, minY: 0, maxX: 128, maxY: 128 },
      kind: "grass",
    },
  ],
  water: [
    {
      ring: [
        [100, 100],
        [120, 100],
        [120, 120],
      ],
      bounds: { minX: 100, minY: 100, maxX: 120, maxY: 120 },
    },
  ],
};
const farTile: DecodedTile = {
  ...tile,
  x: 3,
  y: 3,
  rect: { minX: 6000, minY: 6000, maxX: 8000, maxY: 8000 },
  roads: [],
  buildings: [],
  ground: [
    {
      ring: [
        [6000, 6000],
        [6100, 6000],
        [6100, 6100],
      ],
      bounds: { minX: 6000, minY: 6000, maxX: 6100, maxY: 6100 },
      kind: "forest",
    },
  ],
  water: [],
};
const landmarks: LandmarkLookup = new Map([
  ["cunerakerk", { name: "Cunerakerk", style: "church" }],
]);

// Fixtures for the "keeps the layer order across two touching tiles" test below: tileWest only
// has water near the border, tileEast only has ground there. Painting "per tile" (tileWest's
// ground+water, then tileEast's ground+water) would still put tileEast's ground fill after
// tileWest's water fill in the recorded call order; painting each layer once across the union
// puts every ground fill before any water fill.
const tileWest: DecodedTile = {
  x: 0,
  y: 0,
  rect: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  roads: [
    {
      points: [
        [10, 50],
        [90, 50],
      ],
      roadClass: "primary",
      bounds: { minX: 10, minY: 50, maxX: 90, maxY: 50 },
    },
  ],
  buildings: [],
  ground: [],
  water: [
    {
      ring: [
        [10, 10],
        [20, 10],
        [20, 20],
        [10, 20],
      ],
      bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
    },
  ],
};
const tileEast: DecodedTile = {
  x: 1,
  y: 0,
  rect: { minX: 100, minY: 0, maxX: 200, maxY: 100 },
  roads: [
    {
      points: [
        [110, 50],
        [190, 50],
      ],
      roadClass: "service",
      bounds: { minX: 110, minY: 50, maxX: 190, maxY: 50 },
    },
  ],
  buildings: [],
  ground: [
    {
      ring: [
        [110, 10],
        [120, 10],
        [120, 20],
        [110, 20],
      ],
      bounds: { minX: 110, minY: 10, maxX: 120, maxY: 20 },
      kind: "grass",
    },
  ],
  water: [],
};

describe("paintChunk", () => {
  it("paints ground, water, roads and buildings in order and labels landmarks and streets", () => {
    const context = createFakeContext();
    paintChunk(
      context,
      { minX: 0, minY: 0, maxX: 128, maxY: 128 },
      6,
      [tile, farTile],
      landmarks,
    );
    const fills = context.calls.filter((call) => call.startsWith("fill("));
    expect(context.calls[1]).toBe("fillRect(0,0,128,128)");
    expect(fills[0]).toBe(`fill(${GROUND_FILL.grass})`);
    expect(fills[1]).toBe(`fill(${WATER_FILL})`);
    expect(fills).toContain(`fill(${LANDMARK_FILL.church})`);
    expect(
      context.calls.some((call) => call.startsWith(`stroke(${ROAD_FILL}`)),
    ).toBe(true);
    expect(context.calls).toContain("fillText(Grebbeweg,0,0)");
    expect(context.calls).toContain("fillText(Cunerakerk,0,0)");
    expect(
      context.calls
        .filter((call) => call.startsWith("translate("))
        .some((call) => call === "translate(100,64)"),
    ).toBe(true);
    expect(
      context.calls.some((call) =>
        call.startsWith(`fill(${GROUND_FILL.forest})`),
      ),
    ).toBe(false);
  });

  it("sets the world transform for the chunk", () => {
    const context = createFakeContext();
    paintChunk(
      context,
      { minX: 128, minY: 256, maxX: 256, maxY: 384 },
      4,
      [],
      landmarks,
    );
    expect(context.calls[0]).toBe("setTransform(4,0,0,4,-512,-1024)");
  });

  it("keeps the layer order across two touching tiles instead of per tile", () => {
    const context = createFakeContext();
    paintChunk(
      context,
      { minX: 0, minY: 0, maxX: 200, maxY: 100 },
      1,
      [tileWest, tileEast],
      landmarks,
    );

    const groundFillIndex = context.calls.indexOf(`fill(${GROUND_FILL.grass})`);
    const waterFillIndex = context.calls.indexOf(`fill(${WATER_FILL})`);
    expect(groundFillIndex).toBeGreaterThan(-1);
    expect(waterFillIndex).toBeGreaterThan(-1);
    expect(groundFillIndex).toBeLessThan(waterFillIndex);

    const roadFillStrokeIndices = context.calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.startsWith(`stroke(${ROAD_FILL},`))
      .map(({ index }) => index);
    const centreLineStrokeIndex = context.calls.findIndex((call) =>
      call.startsWith(`stroke(${ROAD_CENTRE_LINE},`),
    );
    expect(roadFillStrokeIndices).toHaveLength(2); // tileWest's road and tileEast's road
    expect(centreLineStrokeIndex).toBeGreaterThan(-1);
    expect(Math.max(...roadFillStrokeIndices)).toBeLessThan(
      centreLineStrokeIndex,
    );
  });
});
