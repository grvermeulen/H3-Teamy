import { MeshLambertMaterial, PointsMaterial } from "three";
import { boundsOf, type Rect } from "../../mapBuild/geometry";
import type {
  DecodedBuilding,
  DecodedFurniture,
  DecodedGround,
  DecodedRoad,
  DecodedTile,
  DecodedTree,
} from "../../world/decode";
import type { GroundKind, RoadClass, TreeSize } from "../../world/mapTypes";
import type { Point } from "../../world/projection";
import { structureIdOf } from "../../world/structureId";
import { SURFACE_KEYS, type SurfaceKey } from "../textures";
import type { WorldMaterials } from "../worldMaterials";

/**
 * A full set of world materials without textures, so geometry tests need no canvas: every slot is
 * its own plain material, the lamp glow a points material.
 *
 * @returns The materials.
 */
export function createTestMaterials(): WorldMaterials {
  const plain = (): MeshLambertMaterial => new MeshLambertMaterial();
  const surfaces = Object.fromEntries(
    SURFACE_KEYS.map((key) => [key, plain()]),
  ) as Record<SurfaceKey, MeshLambertMaterial>;
  return {
    surfaces,
    facade: new MeshLambertMaterial({ vertexColors: true }),
    detail: new MeshLambertMaterial({ vertexColors: true }),
    roadMarking: plain(),
    streetPaint: new MeshLambertMaterial({ vertexColors: true }),
    treeTrunk: plain(),
    canopies: [plain(), plain()],
    canopy: new MeshLambertMaterial({ vertexColors: true }),
    lampPole: plain(),
    lampHead: plain(),
    lampGlow: new PointsMaterial(),
    bench: plain(),
    shelterGlass: plain(),
  };
}

/** A square ring with its corner at (x, y). */
export function squareRing(x: number, y: number, side: number): Point[] {
  return [
    [x, y],
    [x + side, y],
    [x + side, y + side],
    [x, y + side],
  ];
}

/** Everything a fixture tile may hold, as plain lists. */
export type TileContents = {
  roads?: { points: Point[]; roadClass: RoadClass }[];
  buildings?: { ring: Point[]; levels: number; landmark?: string }[];
  ground?: { ring: Point[]; kind: GroundKind }[];
  water?: Point[][];
  trees?: { point: Point; size: TreeSize }[];
  furniture?: DecodedFurniture[];
};

/**
 * A decoded tile with the given contents: bounds computed, building ids from the tile and each
 * building's position, exactly as `decodeTile` gives them.
 *
 * @param tile - The tile's column and row and its own rectangle.
 * @param contents - What it holds.
 * @returns The tile.
 */
export function fixtureTile(
  tile: { x: number; y: number; rect: Rect },
  contents: TileContents,
): DecodedTile {
  const roads: DecodedRoad[] = (contents.roads ?? []).map((road) => ({
    ...road,
    bounds: boundsOf(road.points),
  }));
  const buildings: DecodedBuilding[] = (contents.buildings ?? []).map(
    (building, index) => ({
      ...building,
      structureId: structureIdOf(tile.x, tile.y, index),
      bounds: boundsOf(building.ring),
    }),
  );
  const ground: DecodedGround[] = (contents.ground ?? []).map((area) => ({
    ...area,
    bounds: boundsOf(area.ring),
  }));
  const trees: DecodedTree[] = (contents.trees ?? []).map((tree) => ({
    ...tree,
    bounds: boundsOf([tree.point]),
  }));
  return {
    ...tile,
    roads,
    buildings,
    ground,
    water: (contents.water ?? []).map((ring) => ({
      ring,
      bounds: boundsOf(ring),
    })),
    trees,
    furniture: contents.furniture ?? [],
  };
}

/** The own rectangle of the fixture's main tile: 2 km around the origin. */
export const FIXTURE_TILE_RECT: Rect = {
  minX: -1000,
  minY: -1000,
  maxX: 1000,
  maxY: 1000,
};

/** What the fixture town holds; see {@link fixtureTown}. */
const TOWN: TileContents = {
  ground: [
    { ring: squareRing(4, 4, 30), kind: "grass" },
    { ring: squareRing(20, 20, 20), kind: "forest" },
    {
      ring: [
        [-300, 100],
        [300, 100],
        [300, 300],
        [-300, 300],
      ],
      kind: "field",
    },
  ],
  water: [squareRing(70, 84, 12)],
  roads: [
    {
      points: [
        [-50, 64],
        [200, 64],
      ],
      roadClass: "residential",
    },
    {
      points: [
        [110, -50],
        [110, 40],
        [112, 200],
      ],
      roadClass: "primary",
    },
  ],
  buildings: [
    { ring: squareRing(20, 72, 10), levels: 2 },
    {
      ring: [
        [40, 90],
        [64, 90],
        [64, 112],
        [40, 112],
      ],
      levels: 4,
    },
    {
      ring: [
        [40, 6],
        [70, 6],
        [70, 24],
        [40, 24],
      ],
      levels: 3,
      landmark: "cunerakerk",
    },
    {
      ring: [
        [120, 20],
        [150, 20],
        [150, 30],
        [120, 30],
      ],
      levels: 1,
    },
  ],
  trees: [
    { point: [5, 50], size: 0 },
    { point: [15, 120], size: 1 },
    { point: [8, 124], size: 0 },
    { point: [130, 5], size: 0 },
  ],
  furniture: [
    { point: [60, 70], kind: "lamp", heading: 0 },
    { point: [30, 58], kind: "bench", heading: 0 },
    { point: [90, 57], kind: "busStop", heading: Math.PI },
    { point: [140, 60], kind: "bench", heading: 0 },
  ],
};

/**
 * A small town in and around cell (0, 0): grass, a wood, a field reaching over several cells, a
 * pond, a residential street (pavements) and a primary road (centre line), a house, a block of
 * flats, a church, a shed whose centre lies in cell (1, 0), trees and one of each furniture kind.
 *
 * @returns The tile, tile (1, 1) of the grid.
 */
export function fixtureTown(): DecodedTile {
  return fixtureTile({ x: 1, y: 1, rect: FIXTURE_TILE_RECT }, TOWN);
}
