/**
 * The plan of a building's detail, decided once per build from the map: which sheet its walls wear,
 * which ground-floor walls are shopfronts (along main roads and near landmarks) and whether they
 * get an awning, whether a narrow terraced house shows a stepped or bell gable to its street,
 * balconies on flats, chimneys, dormers and the colour of the fascia boards. Every choice is
 * seeded by the structure id, so every device plans the same town.
 */
import { polygonArea } from "../mapBuild/geometry";
import { roofKindOf } from "../render/drawRoofs";
import {
  PAVEMENT_CLASSES,
  PAVEMENT_WIDTH_M,
  ROAD_WIDTH_M,
} from "../render/palette";
import type { DecodedBuilding, DecodedRoad } from "../world/decode";
import type { RoadClass } from "../world/mapTypes";
import type { Point } from "../world/projection";
import type { CellContext } from "./cellContext";
import { facadeSheetOf, FACADE_SHEETS } from "./facadeSheets";
import { orientedBox } from "./footprint";
import { idUnit } from "./idHash";
import { wallEdges, type WallEdge } from "./wallQuads";

/** The two Dutch gable outlines: stepped (trapgevel) and bell (klokgevel). */
export type GableKind = "step" | "bell";

/** A street gable: the end of the footprint's long axis it stands on, and its outline. */
export type GablePlan = { end: 1 | -1; kind: GableKind };

/** What a building's detail is built from. */
export type BuildingPlan = {
  sheet: number;
  /** Ring edge indices whose ground floor is a shopfront. */
  shopEdges: ReadonlySet<number>;
  /** The awning canvas over the shopfronts, sRGB hex, or null for none. */
  awning: number | null;
  gable: GablePlan | null;
  balconies: boolean;
  chimney: boolean;
  dormer: boolean;
  /** The fascia boards under the eaves, sRGB hex. */
  fascia: number;
};

/** Road classes whose frontage is a shopping street. */
const MAIN_ROADS: readonly RoadClass[] = ["primary", "secondary", "tertiary"];
/** How far a shopfront may stand back from the pavement's outer edge, metres. */
const SHOP_SETBACK_M = 5;
/** How far from a wall's middle a shopping road's centre line is looked for, metres. */
const SHOP_SEARCH_M =
  Math.max(...Object.values(ROAD_WIDTH_M)) / 2 +
  PAVEMENT_WIDTH_M +
  SHOP_SETBACK_M;
/** Within this distance of a landmark, the streets are the old centre's shopping streets, metres. */
const LANDMARK_SHOP_M = 120;
/** A shopfront wall must be at least this long, metres. */
const SHOP_MIN_EDGE_M = 4;
/** Buildings bigger than this keep their plain ground floor (halls, supermarkets), m². */
const SHOP_MAX_AREA_M2 = 1500;
/** A wall faces a road when its normal points this close to the road (cosine). */
const FACING_MIN_COS = 0.6;
/** Share of the shop buildings with an awning. */
const AWNING_SHARE = 0.4;
/** Awning canvas colours: red, green, navy, orange, cream, bordeaux. */
const AWNING_COLOURS: readonly number[] = [
  0xa3262a, 0x2f6b3a, 0x22375f, 0xc8641e, 0xd9cfb4, 0x6a1f2e,
];
/** A gable house: at most this many storeys and this wide a street front, metres. */
const GABLE_MAX_LEVELS = 3;
const GABLE_MAX_FRONT_M = 8;
/** Its footprint is at least this much longer than wide, and this close to a rectangle. */
const GABLE_MIN_ASPECT = 1.2;
const GABLE_MIN_FILL = 0.9;
/** How far the street may be from a gable house's centre, metres. */
const GABLE_STREET_M = 30;
/** Shares of the eligible houses with a street gable, and of those whose gable is stepped. */
const GABLE_SHARE = 0.5;
const STEP_GABLE_SHARE = 0.5;
/** Balconies: flats of at least this many storeys, half of them. */
const BALCONY_MIN_LEVELS = 4;
const BALCONY_SHARE = 0.5;
/**
 * The map tags nearly every building two storeys, so a mid-size flat-roofed block (bigger than a
 * house, smaller than a hall) with no shops counts as flats too — a third of them get balconies.
 */
const LOW_FLATS_MIN_AREA_M2 = 300;
const LOW_FLATS_MAX_AREA_M2 = 1200;
const LOW_FLATS_BALCONY_SHARE = 0.35;
/** Those blocks have at least this many storeys, so a balcony has a floor to stand on. */
const LOW_FLATS_MIN_LEVELS = 2;
/** Shares of the tiled roofs with a chimney, and (when long enough) with a dormer. */
const CHIMNEY_SHARE = 0.6;
const DORMER_SHARE = 0.3;
/** A roof carries a dormer only from this length, metres. */
const DORMER_MIN_LENGTH_M = 8;
/** Fascia boards: white on most houses, else Dutch green or black. */
const FASCIA_COLOURS: readonly [number, number][] = [
  [0.6, 0xe8e4da],
  [0.8, 0x24452f],
  [1, 0x1c1c1e],
];
/** Salts naming each seeded choice. */
const SALTS = {
  awning: 0x61,
  awningColour: 0x62,
  gable: 0x63,
  gableKind: 0x64,
  balcony: 0x65,
  chimney: 0x66,
  dormer: 0x67,
  fascia: 0x68,
} as const;

/**
 * The plan of the first city: the sheet alone, no shops, gables or extras.
 *
 * @param building - The building.
 * @returns Its basic plan.
 */
export function basicPlan(building: DecodedBuilding): BuildingPlan {
  return {
    sheet: facadeSheetOf(building),
    shopEdges: new Set(),
    awning: null,
    gable: null,
    balconies: false,
    chimney: false,
    dormer: false,
    fascia: FASCIA_COLOURS[0][1],
  };
}

/** The middle of an edge. */
function middle(edge: WallEdge): Point {
  return [(edge.from[0] + edge.to[0]) / 2, (edge.from[1] + edge.to[1]) / 2];
}

/** Whether an edge's outward normal points at a road point. */
function faces(edge: WallEdge, at: Point, target: Point): boolean {
  const [dx, dy] = [target[0] - at[0], target[1] - at[1]];
  const length = Math.hypot(dx, dy);
  if (length === 0) return false;
  return (
    (edge.outward[0] * dx + edge.outward[1] * dy) / length >= FACING_MIN_COS
  );
}

/** Whether a road may carry shopfronts here: a main road, or any paved street near a landmark. */
function shoppingRoad(nearLandmark: boolean): (road: DecodedRoad) => boolean {
  return (road) =>
    MAIN_ROADS.includes(road.roadClass) ||
    (nearLandmark &&
      (PAVEMENT_CLASSES.includes(road.roadClass) ||
        road.roadClass === "pedestrian"));
}

/** Whether a building stands within {@link LANDMARK_SHOP_M} of a landmark. */
function nearLandmark(
  building: DecodedBuilding,
  context: CellContext,
): boolean {
  const { bounds } = building;
  const centre: Point = [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
  ];
  return context.landmarks.some(
    (landmark) =>
      Math.hypot(landmark[0] - centre[0], landmark[1] - centre[1]) <=
      LANDMARK_SHOP_M,
  );
}

/**
 * The ring edges of a building whose ground floor is a shopfront: long enough walls facing a main
 * road (or, near a landmark, any paved street) whose pavement they stand close to.
 *
 * @param building - The building.
 * @param context - The cell's roads and landmarks.
 * @returns Edge indices into the ring.
 */
export function shopEdgesOf(
  building: DecodedBuilding,
  context: CellContext,
): Set<number> {
  const edges = new Set<number>();
  if (building.landmark || polygonArea(building.ring) > SHOP_MAX_AREA_M2)
    return edges;
  const accept = shoppingRoad(nearLandmark(building, context));
  const reach = PAVEMENT_WIDTH_M + SHOP_SETBACK_M;
  for (const edge of wallEdges(building)) {
    if (edge.length < SHOP_MIN_EDGE_M) continue;
    const at = middle(edge);
    const hit = context.nearestRoad(at, SHOP_SEARCH_M, accept);
    if (!hit || hit.distance > hit.segment.halfWidth + reach) continue;
    if (faces(edge, at, hit.closest)) edges.add(edge.index);
  }
  return edges;
}

/**
 * The street gable of a narrow terraced house, or null: a near-rectangular tiled house of at most
 * three storeys, at most 8 m across and clearly longer than wide, whose street lies off one of its
 * short ends — half of those, stepped or bell-shaped at random.
 *
 * @param building - The building.
 * @param context - The cell's roads.
 * @returns The gable, or null.
 */
export function gableOf(
  building: DecodedBuilding,
  context: CellContext,
): GablePlan | null {
  if (building.landmark || building.levels > GABLE_MAX_LEVELS) return null;
  if (roofKindOf(building) !== "tiles") return null;
  if (idUnit(building.structureId, SALTS.gable) >= GABLE_SHARE) return null;
  const box = orientedBox(building.ring);
  if (box.fill < GABLE_MIN_FILL || box.width > GABLE_MAX_FRONT_M) return null;
  if (box.length < box.width * GABLE_MIN_ASPECT) return null;
  const hit = context.nearestRoad(box.centre, GABLE_STREET_M);
  if (!hit) return null;
  const [dx, dy] = [
    hit.closest[0] - box.centre[0],
    hit.closest[1] - box.centre[1],
  ];
  const along = dx * box.long[0] + dy * box.long[1];
  const across = dx * box.across[0] + dy * box.across[1];
  if (Math.abs(along) <= Math.abs(across)) return null;
  const kind =
    idUnit(building.structureId, SALTS.gableKind) < STEP_GABLE_SHARE
      ? "step"
      : "bell";
  return { end: along > 0 ? 1 : -1, kind };
}

/** The fascia colour a building's hash picks. */
function fasciaOf(building: DecodedBuilding): number {
  const roll = idUnit(building.structureId, SALTS.fascia);
  return (FASCIA_COLOURS.find(([share]) => roll < share) ??
    FASCIA_COLOURS[0])[1];
}

/** Whether a building gets balconies: most flats, a third of the mid-size blocks without shops. */
function hasBalconies(
  building: DecodedBuilding,
  finish: string,
  shops: boolean,
): boolean {
  if (finish === "glass") return false;
  const roll = idUnit(building.structureId, SALTS.balcony);
  if (building.levels >= BALCONY_MIN_LEVELS) return roll < BALCONY_SHARE;
  const area = polygonArea(building.ring);
  const block = area > LOW_FLATS_MIN_AREA_M2 && area < LOW_FLATS_MAX_AREA_M2;
  return (
    block &&
    !shops &&
    building.levels >= LOW_FLATS_MIN_LEVELS &&
    roll < LOW_FLATS_BALCONY_SHARE
  );
}

/** The awning colour over a shop building's fronts, or null. */
function awningOf(building: DecodedBuilding, shops: boolean): number | null {
  if (!shops || idUnit(building.structureId, SALTS.awning) >= AWNING_SHARE)
    return null;
  const pick = Math.floor(
    idUnit(building.structureId, SALTS.awningColour) * AWNING_COLOURS.length,
  );
  return AWNING_COLOURS[pick];
}

/**
 * The full plan of a building for a detailed cell.
 *
 * @param building - The building.
 * @param context - The cell's roads and landmarks.
 * @returns Its plan.
 */
export function planBuilding(
  building: DecodedBuilding,
  context: CellContext,
): BuildingPlan {
  const plan = basicPlan(building);
  const tiled = roofKindOf(building) === "tiles";
  const shopEdges = shopEdgesOf(building, context);
  const finish = FACADE_SHEETS[plan.sheet].finish;
  const roll = (salt: number): number => idUnit(building.structureId, salt);
  return {
    ...plan,
    shopEdges,
    awning: awningOf(building, shopEdges.size > 0),
    gable: gableOf(building, context),
    balconies: hasBalconies(building, finish, shopEdges.size > 0),
    chimney: tiled && roll(SALTS.chimney) < CHIMNEY_SHARE,
    dormer:
      tiled &&
      orientedBox(building.ring).length >= DORMER_MIN_LENGTH_M &&
      roll(SALTS.dormer) < DORMER_SHARE,
    fascia: fasciaOf(building),
  };
}
