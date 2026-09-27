/**
 * One 128 m cell of the 3D city, built from the decoded map tiles that reach it: the ground in
 * the 2D map's layers (urban backdrop, fields, grass, woods, water, pavements, roads, centre
 * lines), the buildings with their roofs and landmark dressing, trees, and street furniture.
 *
 * Every piece of geometry has one owner so nothing is built twice: polygons and centre lines are
 * cut to the part of the cell each tile owns (a tile's own rectangle, not the 20 m overlap its
 * asset repeats), and buildings, trees and furniture belong to the cell holding their centre.
 * Geometry is merged per material and sits in the cell's frame, the group standing at the cell's
 * north-west corner.
 */
import {
  Group,
  Mesh,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import {
  clipPolygonToRect,
  clipPolylineToRect,
  distancePointToSegment,
  pointInPolygon,
  rectsIntersect,
  boundsOf,
  type Rect,
} from "../mapBuild/geometry";
import {
  CENTRE_LINE_CLASSES,
  PAVEMENT_CLASSES,
  PAVEMENT_WIDTH_M,
  ROAD_WIDTH_M,
} from "../render/palette";
import type {
  DecodedBuilding,
  DecodedRoad,
  DecodedTile,
} from "../world/decode";
import type { GroundKind, LandmarkStyle } from "../world/mapTypes";
import type { Point } from "../world/projection";
import {
  STRUCTURE_INDEX_STRIDE,
  STRUCTURE_TILE_STRIDE,
} from "../world/structureId";
import {
  buildBuildingGeometry,
  buildingHeight,
  type BuildingRange,
  type LaidBuilding,
} from "./buildingMesh";
import { createCellContext, type CellContext } from "./cellContext";
import type { CityDetail } from "./cityDetail";
import {
  createDetailBuffers,
  detailGeometry,
  detailVertexCount,
  type DetailBuffers,
} from "./detailBuffers";
import { planBuilding } from "./facadePlan";
import {
  CELL_M,
  cellKey,
  cellOf,
  cellRect,
  ownerCell,
  type CellCoord,
} from "./cellGrid";
import { disposeObject } from "./disposal";
import {
  buildFurnitureLayer,
  type FurnitureInstance,
  type PlacedFurniture,
} from "./furnitureMesh";
import { dressingReplacesRoof, landmarkDressing } from "./landmarkDressing";
import {
  createMeshBuffers,
  pushFlatPolygon,
  toGeometry,
  vertexCount,
  type MeshBuffers,
  type UvMapping,
} from "./meshBuffers";
import {
  LAMP_KERB_OFFSET_M,
  inRegion,
  lampsAlong,
  pushDashes,
  pushDisc,
  pushRibbon,
  type RoadPiece,
} from "./roadMesh";
import {
  lampRoadWidth,
  pushStreetSides,
  pushZebras,
  sideBands,
  signSites,
  zebraSites,
  type SignSite,
  type StreetLook,
  type StreetTargets,
  type ZebraSite,
} from "./streetMarkings";
import { pushStreetClutter } from "./streetClutter";
import { buildBikes } from "./clutterShapes";
import { TEXTURE_REPEAT_M } from "./textures";
import { tileBuildingsIn, tileRoadsIn } from "./tileIndex";
import {
  buildDetailedTreeLayer,
  buildTreeLayer,
  type TreeInput,
} from "./treeMesh";
import {
  GROUND_RENDER_ORDER,
  type GroundLayer,
  type WorldMaterials,
} from "./worldMaterials";

export type { FurnitureInstance } from "./furnitureMesh";

/** Height of the ground polygons and the urban backdrop, metres. */
export const GROUND_Y_M = 0;
/** Height of the water, a little under the ground, metres. */
export const WATER_Y_M = -0.05;
/** Height of the pavements, metres. */
export const PAVEMENT_Y_M = 0.015;
/** Height of the road surfaces, metres. */
export const ROAD_Y_M = 0.02;
/** Height of the centre-line markings, metres. */
export const MARKING_Y_M = 0.03;
/** Furniture this close to a road turns to face it, metres (as the map build aligns it). */
const FACE_ROAD_M = 30;
/** The farthest a street lamp stands from its road's centre line, metres: the widest road's half plus the kerb offset. */
const LAMP_REACH_M =
  Math.max(
    ...Object.values(ROAD_WIDTH_M),
    ...PAVEMENT_CLASSES.map(lampRoadWidth),
  ) /
    2 +
  LAMP_KERB_OFFSET_M;

/** Landmark styles by landmark key, e.g. the world session's landmark lookup. */
export type LandmarkStyles = ReadonlyMap<
  string,
  { readonly style: LandmarkStyle }
>;

/** What one cell is built from. */
export type CellInput = {
  cell: CellCoord;
  tiles: readonly DecodedTile[];
  /** Structure ids to leave out: the destroyed buildings. */
  destroyed: ReadonlySet<number>;
  materials: WorldMaterials;
  /** Landmark styles by key; without one a landmark is built as a plain building. */
  landmarks?: LandmarkStyles;
  /** How much detail to build (see `cityDetail.ts`); the first city's `basic` by default. */
  detail?: CityDetail;
};

/** A built cell. */
export type BuiltCell = {
  /** Everything the cell draws, standing at the cell's corner. */
  group: Group;
  /** Each built building's vertex range in {@link BuiltCell.walls}. */
  ranges: BuildingRange[];
  /** The merged walls (for damage shading), or null without buildings. */
  walls: BufferGeometry | null;
  furniture: FurnitureInstance[];
  /** Every building the cell owns as the map decodes it, destroyed ones included. */
  buildings: DecodedBuilding[];
  /**
   * Copies moved, turned or hidden furniture proxies into their instances: only `pieces` when
   * given (the ones handed out for a knock-over), else every piece of the cell.
   */
  syncFurniture(pieces?: Iterable<FurnitureInstance>): void;
  /** Frees the cell's own geometry and dressing; the shared materials are left alone. */
  dispose(): void;
};

/** The part of the cell one tile owns. */
type Region = { tile: DecodedTile; rect: Rect };

/** A building the cell owns: as decoded, and as built (cut to its tile's own rectangle). */
type OwnedBuilding = { original: DecodedBuilding; shape: DecodedBuilding };

/** Collects what a cell must free when it goes. */
type Ownership = { geometries: BufferGeometry[]; disposers: (() => void)[] };

/**
 * What a detailed build shares between its layers: the surroundings, the detail buffers, the
 * street paint and the zebra crossings around the cell.
 */
type DetailBuild = {
  context: CellContext;
  buffers: DetailBuffers;
  paint: DetailBuffers;
  zebras: ZebraSite[];
  signs: SignSite[];
};

/** The overlap of two rectangles, or null when they share no area. */
function overlap(a: Rect, b: Rect): Rect | null {
  const rect = {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  };
  return rect.minX < rect.maxX && rect.minY < rect.maxY ? rect : null;
}

/** The parts of the cell each tile owns. */
function cellRegions(cell: CellCoord, tiles: readonly DecodedTile[]): Region[] {
  const bounds = cellRect(cell);
  return tiles.flatMap((tile) => {
    const rect = overlap(bounds, tile.rect);
    return rect ? [{ tile, rect }] : [];
  });
}

/**
 * The tiles whose own rectangle shares area with a cell: exactly the tiles a cell is built from.
 *
 * @param cell - The cell.
 * @param tiles - The loaded tiles.
 * @returns Those reaching the cell, in the given order.
 */
export function tilesReaching(
  cell: CellCoord,
  tiles: readonly DecodedTile[],
): DecodedTile[] {
  return cellRegions(cell, tiles).map((region) => region.tile);
}

/** A rectangle as a ring. */
function rectRing(rect: Rect): Point[] {
  return [
    [rect.minX, rect.minY],
    [rect.maxX, rect.minY],
    [rect.maxX, rect.maxY],
    [rect.minX, rect.maxY],
  ];
}

/** Flat UVs: world metres / 8 from the cell corner (a whole number of repeats from the world's). */
function flatUv(origin: Point): UvMapping {
  return (x, y) => [
    (x - origin[0]) / TEXTURE_REPEAT_M,
    (y - origin[1]) / TEXTURE_REPEAT_M,
  ];
}

/** Adds a mesh of the buffers (when they hold anything) in a ground layer's paint order. */
function addLayer(
  group: Group,
  owned: Ownership,
  buffers: MeshBuffers,
  material: Material,
  layer: GroundLayer,
): void {
  if (vertexCount(buffers) === 0) return;
  const geometry = toGeometry(buffers);
  owned.geometries.push(geometry);
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = GROUND_RENDER_ORDER[layer];
  group.add(mesh);
}

/** The ground kinds drawn as their own layer; urban polygons join the backdrop. */
const GROUND_KINDS: readonly Exclude<GroundKind, "urban">[] = [
  "field",
  "grass",
  "forest",
];

/** A ground layer: the urban backdrop and polygons, a ground kind, or the water. */
type GroundBuffer = GroundKind | "water";

/** The urban backdrop, ground polygons and water of the regions, each cut to its region. */
function groundBuffers(
  regions: readonly Region[],
  origin: Point,
): Map<GroundBuffer, MeshBuffers> {
  const uv = flatUv(origin);
  const keys: GroundBuffer[] = ["urban", ...GROUND_KINDS, "water"];
  const layers = new Map(keys.map((key) => [key, createMeshBuffers()]));
  const fill = (key: GroundBuffer, ring: Point[], rect: Rect): void => {
    const clipped = clipPolygonToRect(ring, rect);
    const height = key === "water" ? WATER_Y_M : GROUND_Y_M;
    if (clipped.length >= 3) {
      pushFlatPolygon(layers.get(key)!, clipped, height, origin, uv);
    }
  };
  for (const { tile, rect } of regions) {
    fill("urban", rectRing(rect), rect);
    for (const area of tile.ground) {
      if (rectsIntersect(area.bounds, rect)) fill(area.kind, area.ring, rect);
    }
    for (const area of tile.water) {
      if (rectsIntersect(area.bounds, rect)) fill("water", area.ring, rect);
    }
  }
  return layers;
}

/** The urban backdrop, ground polygons and water, each in its paint-order layer. */
function addGround(
  group: Group,
  owned: Ownership,
  layers: Map<GroundBuffer, MeshBuffers>,
  materials: WorldMaterials,
): void {
  const { surfaces } = materials;
  addLayer(group, owned, layers.get("urban")!, surfaces.urban, "urban");
  for (const kind of GROUND_KINDS) {
    addLayer(group, owned, layers.get(kind)!, surfaces[kind], kind);
  }
  addLayer(group, owned, layers.get("water")!, surfaces.water, "water");
}

/** True when two points are the same point. */
function samePoint(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** A road's centre line cut to a region, each piece capped where it is one of the road's ends. */
function roadPieces(road: DecodedRoad, rect: Rect): RoadPiece[] {
  const ends = [road.points[0], road.points[road.points.length - 1]];
  const isEnd = (point: Point): boolean =>
    ends.some((end) => samePoint(end, point));
  return clipPolylineToRect(road.points, rect).map((points) => ({
    points,
    capStart: isEnd(points[0]),
    capEnd: isEnd(points[points.length - 1]),
  }));
}

/** The street layers' buffers. */
type StreetBuffers = {
  pavement: MeshBuffers;
  road: MeshBuffers;
  marking: MeshBuffers;
};

/** How a detailed cell builds its streets' sides: where they go and what they look at. */
type StreetDetail = { targets: StreetTargets; look: StreetLook };

/** A paved road piece's sides on a detailed cell, and a pavement disc at each of its own ends. */
function pushDetailedSides(
  buffers: StreetBuffers,
  road: DecodedRoad,
  piece: RoadPiece,
  street: StreetDetail,
): void {
  pushStreetSides(street.targets, road, piece, street.look);
  const bands = sideBands(road.roadClass);
  const radius = bands.edge + bands.cycle + bands.pavement;
  const { origin, uv } = street.look;
  const ends = [
    piece.capStart ? piece.points[0] : null,
    piece.capEnd ? piece.points[piece.points.length - 1] : null,
  ];
  for (const end of ends) {
    if (end) pushDisc(buffers.pavement, end, radius, PAVEMENT_Y_M, origin, uv);
  }
}

/** One road's pavement (or detailed sides), surface and centre line within a region. */
function pushRoad(
  buffers: StreetBuffers,
  road: DecodedRoad,
  rect: Rect,
  origin: Point,
  street: StreetDetail | null,
): void {
  const uv = flatUv(origin);
  const width = ROAD_WIDTH_M[road.roadClass];
  const paved = PAVEMENT_CLASSES.includes(road.roadClass);
  for (const piece of roadPieces(road, rect)) {
    if (paved && street) pushDetailedSides(buffers, road, piece, street);
    else if (paved) {
      const outer = width + 2 * PAVEMENT_WIDTH_M;
      pushRibbon(buffers.pavement, piece, outer, PAVEMENT_Y_M, origin, uv);
    }
    pushRibbon(buffers.road, piece, width, ROAD_Y_M, origin, uv);
  }
  if (CENTRE_LINE_CLASSES.includes(road.roadClass)) {
    pushDashes(buffers.marking, road.points, rect, MARKING_Y_M, origin, uv);
  }
}

/** The detailed street state of a cell, its verges going into the grass layer. */
function streetDetailOf(
  detailed: DetailBuild | null,
  pavement: MeshBuffers,
  verge: MeshBuffers,
  origin: Point,
): StreetDetail | null {
  if (!detailed) return null;
  return {
    targets: {
      pavement,
      verge,
      paint: detailed.paint,
      detail: detailed.buffers,
    },
    look: {
      context: detailed.context,
      origin,
      uv: flatUv(origin),
      heights: { pavement: PAVEMENT_Y_M, road: ROAD_Y_M, paint: MARKING_Y_M },
    },
  };
}

/**
 * The pavements, road surfaces and centre lines of every road through the regions; on a detailed
 * cell the kerbs, cycle paths, verges (into `verge`, the grass layer) and zebra crossings too.
 */
function addStreets(
  group: Group,
  owned: Ownership,
  regions: readonly Region[],
  input: { materials: WorldMaterials; origin: Point; verge: MeshBuffers },
  detailed: DetailBuild | null,
): void {
  const { materials, origin } = input;
  const buffers: StreetBuffers = {
    pavement: createMeshBuffers(),
    road: createMeshBuffers(),
    marking: createMeshBuffers(),
  };
  const street = streetDetailOf(
    detailed,
    buffers.pavement,
    input.verge,
    origin,
  );
  for (const { tile, rect } of regions) {
    for (const road of tileRoadsIn(tile, rect))
      pushRoad(buffers, road, rect, origin, street);
    if (detailed) {
      const look = { height: MARKING_Y_M, origin };
      pushZebras(detailed.paint, detailed.zebras, rect, look);
    }
  }
  addLayer(
    group,
    owned,
    buffers.pavement,
    materials.surfaces.pavement,
    "pavement",
  );
  addLayer(group, owned, buffers.road, materials.surfaces.road, "road");
  addLayer(group, owned, buffers.marking, materials.roadMarking, "marking");
}

/** True when a rectangle lies wholly inside another. */
function within(inner: Rect, outer: Rect): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.minY >= outer.minY &&
    inner.maxX <= outer.maxX &&
    inner.maxY <= outer.maxY
  );
}

/** The buildings whose centre (cut to their tile's own rectangle) lies in the cell. */
function ownedBuildings(
  cell: CellCoord,
  regions: readonly Region[],
): OwnedBuilding[] {
  const key = cellKey(cell);
  const bounds = cellRect(cell);
  return regions.flatMap(({ tile }) =>
    tileBuildingsIn(tile, bounds).flatMap((original) => {
      const ring = within(original.bounds, tile.rect)
        ? original.ring
        : clipPolygonToRect(original.ring, tile.rect);
      if (ring.length < 3) return [];
      const shape =
        ring === original.ring
          ? original
          : { ...original, ring, bounds: boundsOf(ring) };
      return cellKey(ownerCell(shape.bounds)) === key
        ? [{ original, shape }]
        : [];
    }),
  );
}

/** The landmark style a building is dressed in, if it is a known landmark. */
function landmarkStyleOf(
  building: DecodedBuilding,
  input: CellInput,
): LandmarkStyle | undefined {
  return building.landmark
    ? input.landmarks?.get(building.landmark)?.style
    : undefined;
}

/** The ids of the buildings whose dressing brings its own roof. */
function rooflessIds(
  shapes: readonly DecodedBuilding[],
  input: CellInput,
): Set<number> {
  const ids = new Set<number>();
  for (const shape of shapes) {
    const style = landmarkStyleOf(shape, input);
    if (style && dressingReplacesRoof(style)) ids.add(shape.structureId);
  }
  return ids;
}

/** Walls and roofs of the owned buildings, and the dressing of their landmarks. */
function addBuildings(
  group: Group,
  owned: Ownership,
  buildings: readonly OwnedBuilding[],
  input: CellInput,
  origin: Point,
  detailed: DetailBuild | null,
): {
  ranges: BuildingRange[];
  walls: BufferGeometry | null;
  laid: LaidBuilding[];
} {
  const shapes = buildings.map((building) => building.shape);
  const built = buildBuildingGeometry(shapes, input.destroyed, {
    origin,
    roofless: rooflessIds(shapes, input),
    ...(detailed && {
      plan: (building: DecodedBuilding) =>
        planBuilding(building, detailed.context),
      detail: detailed.buffers,
    }),
  });
  const { surfaces } = input.materials;
  const parts: [BufferGeometry, Material][] = [
    [built.walls, input.materials.facade],
    [built.roofsTiled, surfaces.roofTiles],
    [built.roofsFlat, surfaces.roofFlat],
  ];
  for (const [geometry, material] of parts) {
    owned.geometries.push(geometry);
    if (geometry.getAttribute("position").count > 0)
      group.add(new Mesh(geometry, material));
  }
  addLandmarks(group, owned, shapes, input, origin);
  const hasWalls = built.walls.getAttribute("position").count > 0;
  return {
    ranges: built.ranges,
    walls: hasWalls ? built.walls : null,
    laid: built.laid,
  };
}

/** The cell's merged detail and its street paint, each one vertex-coloured mesh when it holds anything. */
function addDetail(
  group: Group,
  owned: Ownership,
  detailed: DetailBuild | null,
  materials: WorldMaterials,
): void {
  if (!detailed) return;
  if (detailVertexCount(detailed.buffers) > 0) {
    const geometry = detailGeometry(detailed.buffers);
    owned.geometries.push(geometry);
    group.add(new Mesh(geometry, materials.detail));
  }
  if (detailVertexCount(detailed.paint) === 0) return;
  const paint = detailGeometry(detailed.paint);
  owned.geometries.push(paint);
  const mesh = new Mesh(paint, materials.streetPaint);
  mesh.renderOrder = GROUND_RENDER_ORDER.paint;
  group.add(mesh);
}

/** The dressing of every standing landmark among the buildings. */
function addLandmarks(
  group: Group,
  owned: Ownership,
  shapes: readonly DecodedBuilding[],
  input: CellInput,
  origin: Point,
): void {
  for (const shape of shapes) {
    const style = landmarkStyleOf(shape, input);
    if (!style || input.destroyed.has(shape.structureId)) continue;
    const dressing = landmarkDressing(
      style,
      shape.ring,
      buildingHeight(shape.levels),
    );
    dressing.position.x -= origin[0];
    dressing.position.z -= origin[1];
    group.add(dressing);
    owned.disposers.push(() => disposeObject(dressing));
  }
}

/** A stable id for the n-th tree or piece of furniture of a tile, packed like a structure id. */
function featureId(tile: DecodedTile, index: number): number {
  return (
    (tile.y * STRUCTURE_TILE_STRIDE + tile.x) * STRUCTURE_INDEX_STRIDE + index
  );
}

/** True when a world point lies in the cell. */
function inCell(point: Point, cell: CellCoord): boolean {
  const at = cellOf(point[0], point[1]);
  return at.cx === cell.cx && at.cy === cell.cy;
}

/** The trees standing in the cell. */
function ownedTrees(cell: CellCoord, regions: readonly Region[]): TreeInput[] {
  return regions.flatMap(({ tile }) =>
    tile.trees.flatMap((tree, index) =>
      inCell(tree.point, cell)
        ? [{ point: tree.point, size: tree.size, id: featureId(tile, index) }]
        : [],
    ),
  );
}

/** The nearest point on any road within {@link FACE_ROAD_M} of a point, or null. */
function nearestRoadPoint(
  point: Point,
  regions: readonly Region[],
): Point | null {
  let best: { at: Point; distance: number } | null = null;
  const around = grown(
    { minX: point[0], minY: point[1], maxX: point[0], maxY: point[1] },
    FACE_ROAD_M,
  );
  for (const { tile } of regions) {
    for (const road of tileRoadsIn(tile, around)) {
      for (let index = 0; index + 1 < road.points.length; index++) {
        const [a, b] = [road.points[index], road.points[index + 1]];
        const distance = distancePointToSegment(point, a, b);
        if (distance < FACE_ROAD_M && (!best || distance < best.distance)) {
          best = { at: closestOnSegment(point, a, b), distance };
        }
      }
    }
  }
  return best?.at ?? null;
}

/** The point of segment a–b closest to a point. */
function closestOnSegment(point: Point, a: Point, b: Point): Point {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));
  return [a[0] + clamped * dx, a[1] + clamped * dy];
}

/**
 * A piece's heading turned toward the nearest road: a lamp's arm points at it; a bench or shelter
 * keeps its long side along the road but turns its open front (local +Z) to it.
 */
function faceRoad(
  piece: PlacedFurniture,
  regions: readonly Region[],
): PlacedFurniture {
  const road = nearestRoadPoint([piece.x, piece.y], regions);
  if (!road) return piece;
  const [rx, ry] = [road[0] - piece.x, road[1] - piece.y];
  if (piece.kind === "lamp") {
    return Math.hypot(rx, ry) > 0
      ? { ...piece, heading: Math.atan2(ry, rx) }
      : piece;
  }
  const front = -Math.sin(piece.heading) * rx + Math.cos(piece.heading) * ry;
  return front < 0 ? { ...piece, heading: piece.heading + Math.PI } : piece;
}

/** The map's furniture standing in the cell, turned to face the road. */
function ownedFurniture(
  cell: CellCoord,
  regions: readonly Region[],
): PlacedFurniture[] {
  return regions.flatMap(({ tile }) =>
    tile.furniture.flatMap((piece) =>
      inCell(piece.point, cell)
        ? [
            faceRoad(
              {
                kind: piece.kind,
                x: piece.point[0],
                y: piece.point[1],
                heading: piece.heading,
              },
              regions,
            ),
          ]
        : [],
    ),
  );
}

/** A rectangle grown by a margin on every side. */
function grown(rect: Rect, margin: number): Rect {
  return {
    minX: rect.minX - margin,
    minY: rect.minY - margin,
    maxX: rect.maxX + margin,
    maxY: rect.maxY + margin,
  };
}

/**
 * The street lamps standing in the regions, from every paved road within a lamp's reach of them
 * (a lamp may stand in a neighbouring cell from its road's), clear of every footprint.
 */
function streetLamps(
  cell: CellCoord,
  regions: readonly Region[],
  detailed: boolean,
): PlacedFurniture[] {
  const bounds = cellRect(cell);
  const footprints = regions.flatMap(({ tile }) =>
    tileBuildingsIn(tile, bounds),
  );
  const clear = (point: Point): boolean =>
    !footprints.some(
      (building) =>
        inRegion(point, building.bounds) &&
        pointInPolygon(point, building.ring),
    );
  return regions.flatMap(({ tile, rect }) =>
    tileRoadsIn(tile, grown(rect, LAMP_REACH_M))
      .filter((road) => PAVEMENT_CLASSES.includes(road.roadClass))
      .flatMap((road) =>
        lampsAlong(
          road.points,
          detailed
            ? lampRoadWidth(road.roadClass)
            : ROAD_WIDTH_M[road.roadClass],
          rect,
        ),
      )
      .filter((lamp) => clear([lamp.x, lamp.y]))
      .map((lamp): PlacedFurniture => ({ kind: "lamp", ...lamp })),
  );
}

/** Trees and furniture, instanced. */
function addScenery(
  group: Group,
  owned: Ownership,
  regions: readonly Region[],
  input: CellInput,
  origin: Point,
): {
  furniture: FurnitureInstance[];
  sync: (pieces?: Iterable<FurnitureInstance>) => void;
} {
  const { cell } = input;
  const layer =
    input.detail === "full" ? buildDetailedTreeLayer : buildTreeLayer;
  const trees = layer(ownedTrees(cell, regions), input.materials, origin);
  const pieces = [
    ...ownedFurniture(cell, regions),
    ...streetLamps(cell, regions, input.detail === "full"),
  ];
  const furniture = buildFurnitureLayer(pieces, input.materials, origin, {
    pools: input.detail === "full",
  });
  for (const object of [...trees.meshes, ...furniture.objects])
    group.add(object);
  owned.disposers.push(trees.dispose, furniture.dispose);
  return { furniture: furniture.furniture, sync: furniture.sync };
}

/** Puts a detailed cell's street clutter into its detail, and its bicycles in one instanced mesh. */
function dressStreets(
  group: Group,
  owned: Ownership,
  detailed: DetailBuild,
  input: {
    laid: readonly LaidBuilding[];
    cell: CellCoord;
    materials: WorldMaterials;
    origin: Point;
  },
): void {
  const { origin } = input;
  const { bikes } = pushStreetClutter(detailed.buffers, {
    context: detailed.context,
    buildings: input.laid,
    zebras: detailed.zebras,
    signs: detailed.signs,
    owns: (point) => inCell(point, input.cell),
    ground: PAVEMENT_Y_M,
    origin,
  });
  const mesh = buildBikes(bikes, input.materials.detail, {
    ground: PAVEMENT_Y_M,
    origin,
  });
  if (!mesh) return;
  group.add(mesh);
  owned.disposers.push(() => {
    mesh.geometry.dispose();
    mesh.dispose();
  });
}

/** The shared state of a detailed build, or null for a basic one. */
function detailBuildFor(input: CellInput): DetailBuild | null {
  if (input.detail !== "full") return null;
  const context = createCellContext(
    cellRect(input.cell),
    input.tiles,
    input.destroyed,
  );
  return {
    context,
    buffers: createDetailBuffers(),
    paint: createDetailBuffers(),
    zebras: zebraSites(context.roads),
    signs: signSites(context.roads),
  };
}

/** Freezes the matrices of a static subtree: nothing in a cell moves but furniture instances. */
function freeze(root: Object3D): void {
  root.traverse((node) => {
    node.updateMatrix();
    node.matrixAutoUpdate = false;
  });
}

/**
 * Builds one cell: ground layers painted in the 2D order (see `GROUND_RENDER_ORDER`) at heights
 * ground 0, water −0.05, pavement 0.015, road 0.02 and markings 0.03; roads as ribbons of
 * `ROAD_WIDTH_M` over pavements `2 × PAVEMENT_WIDTH_M` wider, centre lines on the classes 2D
 * draws them on; buildings (destroyed ones left out) with landmark dressing; instanced trees;
 * the map's furniture plus street lamps along every road with pavements.
 *
 * @param input - The cell, the loaded tiles, the destroyed ids and the shared materials.
 * @returns The built cell; add its group to the scene and dispose it when it goes.
 */
export function buildCell(input: CellInput): BuiltCell {
  const { cell } = input;
  const origin: Point = [cell.cx * CELL_M, cell.cy * CELL_M];
  const regions = cellRegions(cell, input.tiles);
  const group = new Group();
  group.position.set(origin[0], 0, origin[1]);
  const owned: Ownership = { geometries: [], disposers: [] };
  const detailed = detailBuildFor(input);
  const ground = groundBuffers(regions, origin);
  const verge = ground.get("grass")!;
  addStreets(
    group,
    owned,
    regions,
    { materials: input.materials, origin, verge },
    detailed,
  );
  addGround(group, owned, ground, input.materials);
  const buildings = ownedBuildings(cell, regions);
  const { ranges, walls, laid } = addBuildings(
    group,
    owned,
    buildings,
    input,
    origin,
    detailed,
  );
  const scenery = addScenery(group, owned, regions, input, origin);
  if (detailed) {
    const look = { laid, cell, materials: input.materials, origin };
    dressStreets(group, owned, detailed, look);
  }
  addDetail(group, owned, detailed, input.materials);
  freeze(group);
  return {
    group,
    ranges,
    walls,
    furniture: scenery.furniture,
    buildings: buildings.map((building) => building.original),
    syncFurniture: scenery.sync,
    dispose: disposerOf(group, owned),
  };
}

/** Frees a cell's own geometry and dressing once, however often it is called. */
function disposerOf(group: Group, owned: Ownership): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    for (const geometry of owned.geometries) geometry.dispose();
    for (const dispose of owned.disposers) dispose();
  };
}
