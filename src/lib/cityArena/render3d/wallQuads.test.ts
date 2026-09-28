import { describe, expect, it } from "vitest";
import { Vector3, type BufferAttribute } from "three";
import { boundsOf } from "../mapBuild/geometry";
import type { DecodedBuilding } from "../world/decode";
import { BLOCK_MODULES, facadeBlockRect } from "./facadeAtlas";
import { squareRing } from "./testing/cityFixture";
import { FACADE_MODULE_M } from "./textures";
import {
  STOREY_M,
  centredStart,
  createWallBuffers,
  pushDetailedWalls,
  wallEdges,
  wallGeometry,
} from "./wallQuads";

/** A square two-storey house of `side` metres at the origin. */
function house(side: number, id = 5): DecodedBuilding {
  const ring = squareRing(0, 0, side);
  return { structureId: id, ring, bounds: boundsOf(ring), levels: 2 };
}

/** Half a window's width with its frame and sill, and the least room kept from a corner, metres. */
const WINDOW_HALF_M = 0.75;
const CORNER_CLEAR_M = 0;

/** Where the window centres of a wall laid out from `start` fall along it, metres. */
function windowCentres(start: number, length: number): number[] {
  const centres: number[] = [];
  for (
    let moduleIndex = Math.floor(start) - 1;
    moduleIndex <= start + length / FACADE_MODULE_M + 1;
    moduleIndex++
  ) {
    for (const bay of [0.25, 0.75]) {
      const along = (moduleIndex + bay - start) * FACADE_MODULE_M;
      if (along + WINDOW_HALF_M > 0 && along - WINDOW_HALF_M < length)
        centres.push(along);
    }
  }
  return centres;
}

describe("centredStart", () => {
  it.each([
    1.2, 1.4, 1.55, 1.6, 1.8, 2, 3.5, 4.2, 5, 6.2, 7, 7.9, 9.4, 12, 13.1, 18,
    25.7,
  ])(
    "keeps every window of a %s m wall whole and clear of its corners, centred",
    (length) => {
      const centres = windowCentres(centredStart(length), length);

      for (const centre of centres) {
        expect(centre - WINDOW_HALF_M).toBeGreaterThanOrEqual(
          CORNER_CLEAR_M - 1e-9,
        );
        expect(centre + WINDOW_HALF_M).toBeLessThanOrEqual(
          length - CORNER_CLEAR_M + 1e-9,
        );
      }
      if (centres.length > 0) {
        const middle = (centres[0] + centres[centres.length - 1]) / 2;
        expect(middle).toBeCloseTo(length / 2, 6);
      }
    },
  );

  it("fits a window on any wall long enough for one", () => {
    expect(windowCentres(centredStart(1.8), 1.8)).toHaveLength(1);
    expect(windowCentres(centredStart(1.55), 1.55)).toHaveLength(1);
    expect(windowCentres(centredStart(1.4), 1.4)).toHaveLength(0);
    expect(windowCentres(centredStart(7.9), 7.9).length).toBeGreaterThanOrEqual(
      2,
    );
  });
});

describe("pushDetailedWalls", () => {
  it("splits every wall at the first floor, the ground storey in its own block", () => {
    const buffers = createWallBuffers();
    const building = house(10);

    const edges = pushDetailedWalls(
      buffers,
      building,
      { sheet: 2, shopEdges: new Set() },
      6.2,
      [0, 0],
    );

    const geometry = wallGeometry(buffers);
    const position = geometry.getAttribute("position") as BufferAttribute;
    const blocks = geometry.getAttribute("facadeBlock") as BufferAttribute;
    expect(edges).toHaveLength(4);
    expect(position.count).toBe(4 * 8);
    const ground = facadeBlockRect("ground", 2);
    const upper = facadeBlockRect("upper", 2);
    for (let vertex = 0; vertex < position.count; vertex++) {
      const lowQuad = Math.floor(vertex / 4) % 2 === 0;
      const block = lowQuad ? ground : upper;
      expect(blocks.getX(vertex)).toBeCloseTo(block[0], 6);
      expect(blocks.getY(vertex)).toBeCloseTo(block[1], 6);
      const y = new Vector3().fromBufferAttribute(position, vertex).y;
      const tolerance = 1e-5;
      expect(
        lowQuad ? y <= STOREY_M + tolerance : y >= STOREY_M - tolerance,
      ).toBe(true);
    }
  });

  it("puts a shopfront on the ground storey of the planned walls only", () => {
    const buffers = createWallBuffers();
    const building = house(12);
    const shopEdge = wallEdges(building)[1].index;

    const edges = pushDetailedWalls(
      buffers,
      building,
      { sheet: 0, shopEdges: new Set([shopEdge]) },
      6.2,
      [0, 0],
    );

    const blocks = wallGeometry(buffers).getAttribute(
      "facadeBlock",
    ) as BufferAttribute;
    const shop = facadeBlockRect("shop", 0);
    const shopVertices = Array.from(
      { length: blocks.count },
      (_, vertex) => vertex,
    ).filter(
      (vertex) =>
        Math.abs(blocks.getX(vertex) - shop[0]) < 1e-6 &&
        Math.abs(blocks.getY(vertex) - shop[1]) < 1e-6,
    );
    expect(shopVertices).toHaveLength(4);
    expect(edges.filter((edge) => edge.shop).map((edge) => edge.index)).toEqual(
      [shopEdge],
    );
  });

  it("shows one whole shopfront on a shop wall shorter than a module", () => {
    const buffers = createWallBuffers();
    const building = house(5);
    const shopEdge = wallEdges(building)[1].index;
    pushDetailedWalls(
      buffers,
      building,
      { sheet: 0, shopEdges: new Set([shopEdge]) },
      6.2,
      [0, 0],
    );

    const geometry = wallGeometry(buffers);
    const blocks = geometry.getAttribute("facadeBlock") as BufferAttribute;
    const uvs = geometry.getAttribute("uv") as BufferAttribute;
    const shop = facadeBlockRect("shop", 0);
    const us = Array.from({ length: blocks.count }, (_, vertex) => vertex)
      .filter(
        (vertex) =>
          Math.abs(blocks.getX(vertex) - shop[0]) < 1e-6 &&
          Math.abs(blocks.getY(vertex) - shop[1]) < 1e-6,
      )
      .map((vertex) => uvs.getX(vertex) * BLOCK_MODULES.shop[0]);
    const [low, high] = [Math.min(...us), Math.max(...us)];

    expect(us).toHaveLength(4);
    expect(Math.floor(low)).toBe(Math.floor(high - 1e-9));
    expect((low + high) / 2 - Math.floor(low)).toBeCloseTo(0.5);
  });

  it("points every edge's normal out of the building, whichever way the ring runs", () => {
    for (const ring of [
      squareRing(0, 0, 8),
      [...squareRing(0, 0, 8)].reverse(),
    ]) {
      const building: DecodedBuilding = {
        structureId: 1,
        ring,
        bounds: boundsOf(ring),
        levels: 2,
      };
      for (const edge of wallEdges(building)) {
        const middle = [
          (edge.from[0] + edge.to[0]) / 2 - 4,
          (edge.from[1] + edge.to[1]) / 2 - 4,
        ];
        expect(
          edge.outward[0] * middle[0] + edge.outward[1] * middle[1],
        ).toBeGreaterThan(0);
      }
    }
  });
});
