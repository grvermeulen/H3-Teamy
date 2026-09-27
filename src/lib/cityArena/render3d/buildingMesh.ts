/**
 * Buildings of the 3D city: footprints extruded to their storeys with walls from the façade
 * atlas, and roofs laid with the 2D roof art — tiles on small houses (with a low hip where the
 * footprint is a rectangle), gravel on the big and the tall, by exactly the 2D map's rule.
 *
 * A basic cell builds exactly the first city. A detailed cell gives each building its plan
 * (`facadePlan.ts`): ground floors with doors or shopfronts under awnings, windows centred on
 * every wall, balconies on flats, overhanging hips with fascia boards, chimneys and dormers, and a
 * stepped or bell gable on the street end of narrow terraced houses.
 */
import type { BufferAttribute, BufferGeometry } from "three";
import { polygonArea } from "../mapBuild/geometry";
import { roofKindOf } from "../render/drawRoofs";
import type { DecodedBuilding } from "../world/decode";
import type { Point } from "../world/projection";
import { createDetailBuffers, type DetailBuffers } from "./detailBuffers";
import { pushAwnings, pushBalconies } from "./facadeExtras";
import type { BuildingPlan } from "./facadePlan";
import {
  facadeFinishOf,
  facadeSheetOf,
  type FacadeFinish,
} from "./facadeSheets";
import { orientedBox } from "./footprint";
import { pushGableHouse } from "./gableHouse";
import {
  createMeshBuffers,
  pushFlatPolygon,
  toGeometry,
  vertexCount,
  type MeshBuffers,
} from "./meshBuffers";
import {
  ROOF_OVERHANG_M,
  hipRidgeHeight,
  pushChimney,
  pushDormer,
  pushFascia,
  pushHip,
  roofUv,
} from "./roofDetail";
import {
  STOREY_M,
  createWallBuffers,
  pushBasicWalls,
  pushDetailedWalls,
  wallGeometry,
  type WallBuffers,
} from "./wallQuads";

export { STOREY_M } from "./wallQuads";

/** The lowest a building stands, metres: a one-storey shed still reads as a building. */
export const MIN_BUILDING_HEIGHT_M = 3.5;

/** The most a fully damaged building's walls darken: to 20 % of their painted colour. */
const MAX_SCORCH = 0.8;
/** Footprints smaller than this (clipping slivers) are not built, square metres. */
const MIN_FOOTPRINT_M2 = 0.5;
/** A hip's chimney stands this share of the way from the middle to a ridge end. */
const HIP_CHIMNEY_SHARE = 0.55;
/** A gable house's chimney stands this far toward the back from its middle, metres. */
const GABLE_CHIMNEY_BACK_M = 1.5;

/**
 * A building's height from its storeys.
 *
 * @param levels - Storeys; anything below one counts as one.
 * @returns `levels × 3.1` m, at least 3.5 m.
 */
export function buildingHeight(levels: number): number {
  return Math.max(MIN_BUILDING_HEIGHT_M, Math.max(1, levels) * STOREY_M);
}

/** The vertices one building's walls occupy in the merged walls geometry. */
export type BuildingRange = {
  structureId: number;
  start: number;
  count: number;
};

/**
 * The wall finish a building gets: seeded by its id, weighted by its size and storeys — houses
 * brick or plaster, flats brick, panels or concrete, big halls and towers panels or concrete (big
 * towers half glass), landmarks brick. A collapsing building's stand-in and rubble take its colour.
 *
 * @param building - The building.
 * @returns Its façade finish.
 */
export function facadeStyleOf(building: DecodedBuilding): FacadeFinish {
  return facadeFinishOf(building);
}

/** A building's roof on a basic cell: a hip or a flat cap in tiles for a small house, gravel otherwise. */
function pushRoof(
  tiled: MeshBuffers,
  flat: MeshBuffers,
  building: DecodedBuilding,
  origin: Point,
): void {
  const eaves = buildingHeight(building.levels);
  const uvOf = roofUv(building.ring);
  if (roofKindOf(building) === "flat") {
    pushFlatPolygon(flat, building.ring, eaves, origin, uvOf);
  } else if (!pushHip(tiled, building.ring, eaves, origin)) {
    pushFlatPolygon(tiled, building.ring, eaves, origin, uvOf);
  }
}

/** Where {@link buildBuildingGeometry} builds, how much detail, and which roofs it leaves out. */
export type BuildingGeometryOptions = {
  origin?: Point;
  roofless?: ReadonlySet<number>;
  /**
   * Plans each building's detail; without it every building is built as on a basic cell (the
   * first city's geometry exactly).
   */
  plan?: (building: DecodedBuilding) => BuildingPlan;
  /** Where a detailed build's small detail goes; fresh buffers by default. */
  detail?: DetailBuffers;
};

/** The buffers one set of buildings is built into. */
type BuildingBuffers = {
  walls: WallBuffers;
  tiled: MeshBuffers;
  flat: MeshBuffers;
  detail: DetailBuffers;
};

/** The buildings to build: not skipped, not slivers. */
function buildable(
  buildings: readonly DecodedBuilding[],
  skip: ReadonlySet<number>,
): DecodedBuilding[] {
  return buildings.filter(
    (building) =>
      !skip.has(building.structureId) &&
      building.ring.length >= 3 &&
      polygonArea(building.ring) >= MIN_FOOTPRINT_M2,
  );
}

/** A detailed hip: overhanging, with fascia boards, and a chimney and dormer where planned. */
function pushDetailedHip(
  buffers: BuildingBuffers,
  building: DecodedBuilding,
  plan: BuildingPlan,
  origin: Point,
): boolean {
  const eaves = buildingHeight(building.levels);
  if (!pushHip(buffers.tiled, building.ring, eaves, origin, ROOF_OVERHANG_M))
    return false;
  const box = orientedBox(building.ring);
  const ridge = hipRidgeHeight(building.ring, eaves);
  const edge = eaves - ROOF_OVERHANG_M * ((ridge - eaves) / (box.width / 2));
  pushFascia(
    buffers.detail,
    box,
    { long: true, ends: true },
    { colour: plan.fascia, overhang: ROOF_OVERHANG_M, edge, origin },
  );
  const heights = { eaves, ridge };
  const ridgeHalf = Math.max(0, box.length / 2 - box.width / 2);
  if (plan.chimney)
    pushChimney(
      buffers.detail,
      box,
      heights,
      origin,
      ridgeHalf * HIP_CHIMNEY_SHARE,
    );
  if (plan.dormer) pushDormer(buffers.detail, box, heights, origin, 1);
  return true;
}

/** A detailed building's roof: gable house, overhanging hip, or a flat cap. */
function pushDetailedRoof(
  buffers: BuildingBuffers,
  building: DecodedBuilding,
  plan: BuildingPlan,
  origin: Point,
): void {
  const eaves = buildingHeight(building.levels);
  if (plan.gable) {
    const ridge = pushGableHouse(buffers, building, plan.gable, {
      eaves,
      sheet: plan.sheet,
      fascia: plan.fascia,
      origin,
    });
    const back = -plan.gable.end * GABLE_CHIMNEY_BACK_M;
    if (plan.chimney)
      pushChimney(
        buffers.detail,
        orientedBox(building.ring),
        { eaves, ridge },
        origin,
        back,
      );
    return;
  }
  if (roofKindOf(building) === "flat") {
    pushFlatPolygon(
      buffers.flat,
      building.ring,
      eaves,
      origin,
      roofUv(building.ring),
    );
  } else if (!pushDetailedHip(buffers, building, plan, origin)) {
    pushFlatPolygon(
      buffers.tiled,
      building.ring,
      eaves,
      origin,
      roofUv(building.ring),
    );
  }
}

/** One building into the buffers, basic or detailed; its walls (and gables) stay in one range. */
function pushBuilding(
  buffers: BuildingBuffers,
  building: DecodedBuilding,
  options: BuildingGeometryOptions,
  origin: Point,
): void {
  const height = buildingHeight(building.levels);
  const withRoof = !options.roofless?.has(building.structureId);
  if (!options.plan) {
    pushBasicWalls(
      buffers.walls,
      building,
      facadeSheetOf(building),
      height,
      origin,
    );
    if (withRoof) pushRoof(buffers.tiled, buffers.flat, building, origin);
    return;
  }
  const plan = options.plan(building);
  const edges = pushDetailedWalls(
    buffers.walls,
    building,
    plan,
    height,
    origin,
  );
  const look = { id: building.structureId, origin };
  if (plan.balconies)
    pushBalconies(buffers.detail, edges, building.levels, look);
  if (plan.awning !== null)
    pushAwnings(buffers.detail, edges, { colour: plan.awning, origin });
  if (withRoof) pushDetailedRoof(buffers, building, plan, origin);
}

/**
 * Merged geometry for a set of buildings: walls with outward normals, textured through the façade
 * atlas (each vertex's block in `facadeBlock`, UVs in block units) with a white `color` attribute
 * for damage shading; roofs flat at the eaves (earcut via `ShapeUtils`, UVs world metres / 8 along
 * the longest edge), in tiles for houses — with a low hip where the footprint is a rectangle — and
 * gravel for the rest; and, on a detailed build, the vertex-coloured detail (into `options.detail`
 * when given). Each building's walls, gables included, occupy one vertex range.
 *
 * @param buildings - The footprints to build.
 * @param skip - Structure ids to leave out (destroyed buildings).
 * @param options - `origin`: the world point that is the geometry's local zero (a cell's corner,
 *   default the world origin); `roofless`: ids whose walls are built but whose roof is left to a
 *   landmark dressing; `plan`: plans each building's detail (a detailed build); `detail`: the
 *   buffers the detail goes into.
 * @returns The three geometries, the detail buffers and each built building's wall range.
 */
export function buildBuildingGeometry(
  buildings: readonly DecodedBuilding[],
  skip: ReadonlySet<number>,
  options: BuildingGeometryOptions = {},
): {
  walls: BufferGeometry;
  roofsTiled: BufferGeometry;
  roofsFlat: BufferGeometry;
  detail: DetailBuffers;
  ranges: BuildingRange[];
} {
  const buffers: BuildingBuffers = {
    walls: createWallBuffers(),
    tiled: createMeshBuffers(),
    flat: createMeshBuffers(),
    detail: options.detail ?? createDetailBuffers(),
  };
  const { origin = [0, 0] } = options;
  const ranges: BuildingRange[] = [];
  for (const building of buildable(buildings, skip)) {
    const start = vertexCount(buffers.walls);
    pushBuilding(buffers, building, options, origin);
    ranges.push({
      structureId: building.structureId,
      start,
      count: vertexCount(buffers.walls) - start,
    });
  }
  return {
    walls: wallGeometry(buffers.walls),
    roofsTiled: toGeometry(buffers.tiled),
    roofsFlat: toGeometry(buffers.flat),
    detail: buffers.detail,
    ranges,
  };
}

/**
 * Scorches one building's walls by its damage: sets its vertex colours to `1 − 0.8 · share` of
 * the unshaded white, so a destroyed-looking wall keeps a fifth of its paint. Calling it again
 * replaces the old shade rather than compounding it; only this range is re-uploaded.
 *
 * @param walls - The walls geometry from {@link buildBuildingGeometry}.
 * @param range - The building's range in it.
 * @param share - Damage as a share of the building's health, clamped to [0, 1].
 */
export function shadeBuilding(
  walls: BufferGeometry,
  range: BuildingRange,
  share: number,
): void {
  const colour = walls.getAttribute("color") as BufferAttribute;
  const shade = 1 - MAX_SCORCH * Math.min(1, Math.max(0, share));
  for (let vertex = range.start; vertex < range.start + range.count; vertex++) {
    colour.setXYZ(vertex, shade, shade, shade);
  }
  colour.addUpdateRange(range.start * 3, range.count * 3);
  colour.needsUpdate = true;
}
