import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import type { RenderRoad } from "./roads";
import {
  TILE_SIZE_M,
  buildTiles,
  flattenUnits,
  regionBoundsMetres,
  tileCoordFor,
  tileFileName,
  tileGridSize,
  tileRect,
  tilesCovering,
} from "./tiles";

const bounds = { minX: 0, minY: 0, maxX: 6000, maxY: 4000 };

describe("tile grid", () => {
  it("covers the region with a 7 × 5 grid of 2 km tiles", () => {
    const region = regionBoundsMetres();
    expect(region.maxX - region.minX).toBeGreaterThan(12_900);
    expect(region.maxX - region.minX).toBeLessThan(13_100);
    expect(region.maxY - region.minY).toBeGreaterThan(8_800);
    expect(region.maxY - region.minY).toBeLessThan(8_900);
    expect(tileGridSize(region)).toEqual({ columns: 7, rows: 5 });
  });

  it("computes the tile grid size from bounds", () => {
    expect(tileGridSize(bounds)).toEqual({ columns: 3, rows: 2 });
  });

  it("maps points to tile coordinates and expands tile rects by the overlap", () => {
    expect(tileCoordFor([10, 10], bounds)).toEqual({ x: 0, y: 0 });
    expect(tileCoordFor([2000, 3999], bounds)).toEqual({ x: 1, y: 1 });
    expect(tileRect({ x: 1, y: 0 }, bounds)).toEqual({
      minX: 1980,
      minY: -20,
      maxX: 4020,
      maxY: 2020,
    });
    expect(tileFileName({ x: 3, y: 1 })).toBe("tile_3_1.json");
  });

  it("lists every tile a rectangle touches, including via overlap", () => {
    expect(
      tilesCovering({ minX: 100, minY: 100, maxX: 200, maxY: 200 }, bounds),
    ).toEqual([{ x: 0, y: 0 }]);
    expect(
      tilesCovering({ minX: 1990, minY: 100, maxX: 1995, maxY: 200 }, bounds),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it("includes a tile whose expanded rect exactly touches the geometry bounds", () => {
    expect(
      tilesCovering({ minX: 4020, minY: 0, maxX: 5000, maxY: 100 }, bounds),
    ).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it("yields no tiles for geometry entirely outside the grid", () => {
    expect(
      tilesCovering({ minX: 6500, minY: 100, maxX: 9000, maxY: 200 }, bounds),
    ).toEqual([]);
  });

  it("clips geometry straddling the grid edge to the last valid tile", () => {
    expect(
      tilesCovering({ minX: 5900, minY: 100, maxX: 9000, maxY: 200 }, bounds),
    ).toEqual([{ x: 2, y: 0 }]);
  });

  it("flattens points to integer units", () => {
    expect(
      flattenUnits([
        [0.1, 0.3],
        [1, -2],
      ]),
    ).toEqual([0, 1, 4, -8]);
  });
});

describe("buildTiles", () => {
  const road: RenderRoad = {
    points: [
      [100, 100],
      [3900, 100],
    ],
    roadClass: "primary",
    name: "N225",
  };
  const building = {
    ring: [
      [1990, 500],
      [2010, 500],
      [2010, 520],
      [1990, 520],
    ] as Point[],
    levels: 3,
    landmark: "cunerakerk",
  };

  it("splits roads across tiles and clips buildings into each tile they touch", () => {
    const tiles = buildTiles(bounds, [road], [building], [], []);
    expect(tiles.map((tile) => [tile.x, tile.y])).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(tiles[0].roads[0]).toMatchObject({
      roadClass: "primary",
      name: "N225",
    });
    expect(tiles[0].roads[0].points).toEqual([400, 400, 8080, 400]);
    expect(tiles[0].buildings[0]).toMatchObject({
      levels: 3,
      landmark: "cunerakerk",
    });
    expect(tiles[0].buildings[0].points).toHaveLength(8);
    expect(tiles[1].buildings).toHaveLength(1);
  });

  it("omits empty tiles and keeps ground kind and water", () => {
    const tiles = buildTiles(
      bounds,
      [],
      [],
      [
        {
          ring: [
            [5000, 3000],
            [5100, 3000],
            [5100, 3100],
          ],
          kind: "forest",
        },
      ],
      [
        {
          ring: [
            [5000, 3200],
            [5100, 3200],
            [5100, 3300],
          ],
        },
      ],
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ x: 2, y: 1 });
    expect(tiles[0].ground[0].kind).toBe("forest");
    expect(tiles[0].water[0].points).toEqual([
      20000, 12800, 20400, 12800, 20400, 13200,
    ]);
  });
});
