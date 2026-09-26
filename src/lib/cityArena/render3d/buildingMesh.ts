/**
 * Buildings of the 3D city: footprints extruded to their storeys with façade-textured walls, and
 * roofs laid with the 2D roof art — tiles on small houses (with a low hip where the footprint is
 * a rectangle), gravel on the big and the tall, by exactly the 2D map's rule.
 */
import type {
  BufferAttribute,
  BufferGeometry,
  MeshLambertMaterial,
  Vector3Tuple,
} from "three";
import { polygonArea } from "../mapBuild/geometry";
import {
  TILED_ROOF_MAX_AREA_M2,
  longestEdgeAngle,
  roofKindOf,
} from "../render/drawRoofs";
import type { DecodedBuilding } from "../world/decode";
import type { Point } from "../world/projection";
import { offsetPoint, orientedBox } from "./footprint";
import { idHash, idUnit } from "./idHash";
import {
  createMeshBuffers,
  pushFlatPolygon,
  pushTriangleFacing,
  pushVertex,
  toGeometry,
  vertexCount,
  type MeshBuffers,
  type UvMapping,
} from "./meshBuffers";
import {
  FACADE_MODULE_M,
  FACADE_STYLES,
  TEXTURE_REPEAT_M,
  type FacadeStyle,
} from "./textures";
import { FACADE_VARIANTS, type WorldMaterials } from "./worldMaterials";

/** Height of one storey, metres (a façade module is one storey tall). */
export const STOREY_M = 3.1;
/** The lowest a building stands, metres: a one-storey shed still reads as a building. */
export const MIN_BUILDING_HEIGHT_M = 3.5;
/** Wall materials in {@link facadeMaterials}' list: every style times its variants. */
export const FACADE_MATERIAL_COUNT = FACADE_STYLES.length * FACADE_VARIANTS;

/** The most a fully damaged building's walls darken: to 20 % of their painted colour. */
const MAX_SCORCH = 0.8;
/** Wall edges shorter than this are skipped, metres. */
const MIN_EDGE_M = 0.05;
/** Footprints smaller than this (clipping slivers) are not built, square metres. */
const MIN_FOOTPRINT_M2 = 0.5;
/** Modules across and storeys up on one façade texture; offsets shift the grid within it. */
const FACADE_GRID = 4;
/** From this many storeys a building is a tower: glass or concrete. */
const TOWER_MIN_LEVELS = 5;
/** A tower needs this footprint to be a glass office rather than a concrete block, m². */
const GLASS_MIN_AREA_M2 = 400;
/** Share of the big towers clad in glass. */
const GLASS_TOWER_SHARE = 0.5;
/** A low building this big is a shed, a hall or a shop box: concrete, m². */
const INDUSTRIAL_MIN_AREA_M2 = 1200;
/** From this many storeys a building bigger than a house is a block of flats. */
const FLATS_MIN_LEVELS = 3;
/** Share of the blocks of flats in brick; the rest are concrete. */
const FLATS_BRICK_SHARE = 0.5;
/** Share of the houses in brick; the rest are plastered, as in a Dutch street. */
const BRICK_HOUSE_SHARE = 0.65;
/** Salts naming each seeded choice about a building. */
const STYLE_SALT = 0x51;
const VARIANT_SALT = 0x52;
const MODULE_SALT = 0x53;
const STOREY_SALT = 0x54;
/** A footprint filling this share of its oriented rectangle gets a hip over that rectangle. */
const HIP_MIN_FILL = 0.9;
/** A hip's pitch as rise per run: 30°, a low Dutch roof. */
const HIP_SLOPE = Math.tan(Math.PI / 6);
/** The highest a hip rises above the eaves, metres. */
const HIP_MAX_RISE_M = 2.5;
/** Closer than this, two roof corners are one point, metres. */
const SAME_POINT_M = 1e-6;

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

/** The wall finish a building gets: seeded by its id, weighted by its size and storeys. */
function facadeStyleOf(building: DecodedBuilding): FacadeStyle {
  const pick = (share: number): boolean =>
    idUnit(building.structureId, STYLE_SALT) < share;
  if (building.landmark) return "brick";
  const area = polygonArea(building.ring);
  if (building.levels >= TOWER_MIN_LEVELS) {
    return area >= GLASS_MIN_AREA_M2 && pick(GLASS_TOWER_SHARE)
      ? "glass"
      : "concrete";
  }
  if (area >= INDUSTRIAL_MIN_AREA_M2) return "concrete";
  if (building.levels >= FLATS_MIN_LEVELS && area > TILED_ROOF_MAX_AREA_M2) {
    return pick(FLATS_BRICK_SHARE) ? "brick" : "concrete";
  }
  return pick(BRICK_HOUSE_SHARE) ? "brick" : "plaster";
}

/**
 * Which wall material a building is drawn with, as an index into {@link facadeMaterials}: its
 * style (houses brick or plaster, big low halls concrete, towers glass or concrete, landmarks
 * brick) and a variant, both seeded by its structure id.
 *
 * @param building - The building.
 * @returns An index in `[0, FACADE_MATERIAL_COUNT)`.
 */
export function facadeMaterialIndex(building: DecodedBuilding): number {
  const style = FACADE_STYLES.indexOf(facadeStyleOf(building));
  const variant = idHash(building.structureId, VARIANT_SALT) % FACADE_VARIANTS;
  return style * FACADE_VARIANTS + variant;
}

/**
 * The wall materials in the order {@link facadeMaterialIndex} counts them: style by style,
 * variants within.
 *
 * @param materials - The shared set.
 * @returns {@link FACADE_MATERIAL_COUNT} materials, for a mesh over the walls' groups.
 */
export function facadeMaterials(
  materials: WorldMaterials,
): MeshLambertMaterial[] {
  return FACADE_STYLES.flatMap((style) => [...materials.facades[style]]);
}

/** Twice a ring's signed area: positive when it runs counter-clockwise in (x, y). */
function signedTwiceArea(ring: readonly Point[]): number {
  let sum = 0;
  ring.forEach(([x1, y1], index) => {
    const [x2, y2] = ring[(index + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  });
  return sum;
}

/** One wall edge with where it starts along the perimeter and the building's façade offsets. */
type WallEdge = {
  from: Point;
  to: Point;
  length: number;
  along: number;
  height: number;
  outward: 1 | -1;
  uOffset: number;
  vOffset: number;
};

/** A wall quad from ground to eaves along one edge, facing out. */
function pushWallQuad(
  buffers: MeshBuffers,
  edge: WallEdge,
  origin: Point,
): void {
  const [px, py] = [edge.from[0] - origin[0], edge.from[1] - origin[1]];
  const [qx, qy] = [edge.to[0] - origin[0], edge.to[1] - origin[1]];
  const dx = (qx - px) / edge.length;
  const dy = (qy - py) / edge.length;
  const normal: Vector3Tuple = [edge.outward * dy, 0, -edge.outward * dx];
  const u0 = edge.uOffset + edge.along / FACADE_MODULE_M;
  const u1 = edge.uOffset + (edge.along + edge.length) / FACADE_MODULE_M;
  const v1 = edge.vOffset + edge.height / STOREY_M;
  const base = pushVertex(buffers, [px, 0, py], normal, [u0, edge.vOffset]);
  pushVertex(buffers, [qx, 0, qy], normal, [u1, edge.vOffset]);
  pushVertex(buffers, [qx, edge.height, qy], normal, [u1, v1]);
  pushVertex(buffers, [px, edge.height, py], normal, [u0, v1]);
  pushTriangleFacing(buffers, [base, base + 1, base + 2], normal);
  pushTriangleFacing(buffers, [base, base + 2, base + 3], normal);
}

/** A building's walls: one outward quad per edge, u running on along the perimeter. */
function pushWalls(
  buffers: MeshBuffers,
  building: DecodedBuilding,
  origin: Point,
): void {
  const { ring, structureId } = building;
  const outward: 1 | -1 = signedTwiceArea(ring) > 0 ? 1 : -1;
  const height = buildingHeight(building.levels);
  const uOffset = idHash(structureId, MODULE_SALT) % FACADE_GRID;
  const vOffset = idHash(structureId, STOREY_SALT) % FACADE_GRID;
  let along = 0;
  ring.forEach((from, index) => {
    const to = ring[(index + 1) % ring.length];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length < MIN_EDGE_M) return;
    const edge = { from, to, length, along, height, outward, uOffset, vOffset };
    pushWallQuad(buffers, edge, origin);
    along += length;
  });
}

/**
 * Roof UVs as the 2D map lays its roof art: world metres / 8, turned to the longest edge and
 * anchored at the first corner, so the tile rows run along the building.
 */
function roofUv(ring: readonly Point[]): UvMapping {
  const angle = longestEdgeAngle([...ring]);
  const cos = Math.cos(angle) / TEXTURE_REPEAT_M;
  const sin = Math.sin(angle) / TEXTURE_REPEAT_M;
  const [ax, ay] = ring[0];
  return (x, y) => [
    (x - ax) * cos + (y - ay) * sin,
    (y - ay) * cos - (x - ax) * sin,
  ];
}

/** A roof corner: a world point and its height. */
type RoofCorner = { point: Point; height: number };

/** One planar roof face, its own vertices sharing its upward normal; fans from the first corner. */
function pushRoofFace(
  buffers: MeshBuffers,
  corners: readonly RoofCorner[],
  origin: Point,
  uvOf: UvMapping,
): void {
  const unique = corners.filter(
    (corner, index) =>
      index === 0 ||
      Math.hypot(
        corner.point[0] - corners[index - 1].point[0],
        corner.point[1] - corners[index - 1].point[1],
      ) > SAME_POINT_M,
  );
  const local = unique.map(({ point, height }): Vector3Tuple => [
    point[0] - origin[0],
    height,
    point[1] - origin[1],
  ]);
  const normal = upwardNormal(local[0], local[1], local[2]);
  const first = vertexCount(buffers);
  local.forEach((position, index) =>
    pushVertex(buffers, position, normal, uvOf(...unique[index].point)),
  );
  for (let index = 1; index + 1 < local.length; index++) {
    pushTriangleFacing(
      buffers,
      [first, first + index, first + index + 1],
      normal,
    );
  }
}

/** The unit normal of a triangle's plane, turned to point up. */
function upwardNormal(
  a: Vector3Tuple,
  b: Vector3Tuple,
  c: Vector3Tuple,
): Vector3Tuple {
  const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross: Vector3Tuple = [
    uy * vz - uz * vy,
    uz * vx - ux * vz,
    ux * vy - uy * vx,
  ];
  const sign = cross[1] < 0 ? -1 : 1;
  const length = Math.hypot(...cross) * sign;
  return [cross[0] / length, cross[1] / length, cross[2] / length];
}

/**
 * A low hip over a near-rectangular footprint: two sloping sides up to a ridge along the long
 * side and two hipped ends, the ridge `min(2.5, half width × tan 30°)` above the eaves.
 *
 * @returns False when the footprint is not rectangular enough for a hip.
 */
function pushHip(
  buffers: MeshBuffers,
  ring: readonly Point[],
  eaves: number,
  origin: Point,
): boolean {
  const box = orientedBox(ring);
  if (box.fill < HIP_MIN_FILL) return false;
  const half = box.width / 2;
  const ridge = eaves + Math.min(HIP_MAX_RISE_M, half * HIP_SLOPE);
  const corner = (along: number, side: number): RoofCorner => ({
    point: offsetPoint(
      box.centre,
      [box.long, (along * box.length) / 2],
      [box.across, side * half],
    ),
    height: eaves,
  });
  const ridgeEnd = (along: number): RoofCorner => ({
    point: offsetPoint(box.centre, [box.long, along * (box.length / 2 - half)]),
    height: ridge,
  });
  const [c00, c10, c11, c01] = [
    corner(-1, -1),
    corner(1, -1),
    corner(1, 1),
    corner(-1, 1),
  ];
  const [r0, r1] = [ridgeEnd(-1), ridgeEnd(1)];
  const uvOf = roofUv(ring);
  for (const face of [
    [c00, c10, r1, r0],
    [c11, c01, r0, r1],
    [c01, c00, r0],
    [c10, c11, r1],
  ]) {
    pushRoofFace(buffers, face, origin, uvOf);
  }
  return true;
}

/** A building's roof: a hip or a flat cap in tiles for a small house, gravel otherwise. */
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

/** A run of wall indices drawn with one façade material. */
type WallGroup = { start: number; count: number; materialIndex: number };

/** Extends the last group when it has this material, else opens a new one. */
function extendGroups(
  groups: WallGroup[],
  materialIndex: number,
  start: number,
  end: number,
): void {
  const last = groups[groups.length - 1];
  if (last && last.materialIndex === materialIndex)
    last.count = end - last.start;
  else groups.push({ start, count: end - start, materialIndex });
}

/**
 * Merged geometry for a set of buildings: walls with outward normals, u along the perimeter in
 * 6 m modules and v in storeys (shifted by whole modules and storeys, seeded per building), a
 * white `color` attribute for damage shading and one group per façade material (indices into
 * {@link facadeMaterials}); roofs flat at the eaves (earcut via `ShapeUtils`, UVs world metres / 8
 * along the longest edge), in tiles for houses — with a low hip where the footprint is a
 * rectangle — and gravel for the rest. Each building's walls occupy one vertex range.
 *
 * @param buildings - The footprints to build.
 * @param skip - Structure ids to leave out (destroyed buildings).
 * @param origin - The world point that is the geometry's local zero (a cell's corner).
 * @returns The three geometries and each built building's wall range.
 */
export function buildBuildingGeometry(
  buildings: readonly DecodedBuilding[],
  skip: ReadonlySet<number>,
  origin: Point = [0, 0],
): {
  walls: BufferGeometry;
  roofsTiled: BufferGeometry;
  roofsFlat: BufferGeometry;
  ranges: BuildingRange[];
} {
  const [walls, tiled, flat] = [
    createMeshBuffers(),
    createMeshBuffers(),
    createMeshBuffers(),
  ];
  const ranges: BuildingRange[] = [];
  const groups: WallGroup[] = [];
  const entries = buildings
    .filter(
      (building) =>
        !skip.has(building.structureId) &&
        building.ring.length >= 3 &&
        polygonArea(building.ring) >= MIN_FOOTPRINT_M2,
    )
    .map((building) => ({ building, material: facadeMaterialIndex(building) }))
    .sort((left, right) => left.material - right.material);
  for (const { building, material } of entries) {
    const [start, indexStart] = [vertexCount(walls), walls.indices.length];
    pushWalls(walls, building, origin);
    ranges.push({
      structureId: building.structureId,
      start,
      count: vertexCount(walls) - start,
    });
    extendGroups(groups, material, indexStart, walls.indices.length);
    pushRoof(tiled, flat, building, origin);
  }
  const wallGeometry = toGeometry(walls, true);
  for (const group of groups)
    wallGeometry.addGroup(group.start, group.count, group.materialIndex);
  return {
    walls: wallGeometry,
    roofsTiled: toGeometry(tiled),
    roofsFlat: toGeometry(flat),
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
