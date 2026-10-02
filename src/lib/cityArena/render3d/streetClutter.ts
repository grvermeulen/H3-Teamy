/**
 * The street clutter of a detailed cell, placed from the map: bike racks full of bicycles and
 * planters in front of shops, wheelie bins, a bike against the wall and a clipped hedge along the
 * front garden of houses, a waste container's drop pillar by blocks of flats, bollards and a
 * crossing sign at zebras, and give-way and 30-zone signs where side streets meet main roads.
 *
 * Every choice is seeded by a building's id (and a wall's place in it) or a crossing's position,
 * so every device dresses the same street. Every piece is visual only and is checked clear of the
 * carriageways, cycle paths and building footprints before it goes down; a cell stops at
 * {@link MAX_CLUTTER_PER_CELL} pieces.
 */
import { polygonArea } from "../mapBuild/geometry";
import type { Point } from "../world/projection";
import type { LaidBuilding } from "./buildingMesh";
import type { CellContext } from "./cellContext";
import {
  pushBin,
  pushBollard,
  pushContainer,
  pushHedge,
  pushPlanter,
  pushRack,
  pushSign,
  type BikeSpot,
  type Placement,
} from "./clutterShapes";
import type { DetailBuffers } from "./detailBuffers";
import { idHash, idUnit } from "./idHash";
import {
  CYCLE_PATH_CLASSES,
  sideBands,
  type SignSite,
  type ZebraSite,
} from "./streetMarkings";
import type { WallEdge } from "./wallQuads";

/** The most clutter pieces one cell holds (a bicycle counts as one). */
export const MAX_CLUTTER_PER_CELL = 150;
/** Bicycle frame colours: mostly black, as Dutch bikes are, then blue, green, grey, red, cream. */
const BIKE_COLOURS: readonly number[] = [
  0x1c1c1e, 0x1c1c1e, 0x1c1c1e, 0x23365c, 0x2f4a33, 0x6b6f75, 0x7a1f1f,
  0xd8d0bc,
];
/** Wheelie bin lids: green (garden waste), grey, blue (paper), orange (plastic). */
const BIN_LIDS: readonly number[] = [0x2f6b2f, 0x55595c, 0x24479a, 0xc8641e];
/** Container pillar bands: grey (rest), green (garden waste), blue (paper). */
const CONTAINER_BANDS: readonly number[] = [0x74797d, 0x2f6b2f, 0x24479a];
/** A wall looks for the road it fronts this far out, metres. */
const FRONT_SEARCH_M = 30;
/** Walls shorter than this get no clutter, metres. */
const MIN_FRONT_M = 3;
/** A bike rack: bikes in it, their spacing, how far from the wall their middles stand, metres. */
const RACK_BIKES = { least: 3, extra: 4, spacing: 0.7, out: 0.95 };
/** Half a bicycle's length, metres: from its middle to the tip of its outer wheel. */
const BIKE_HALF_LENGTH_M = 0.87;
/** A rack bike's outer wheel may come this close to a cycle path or carriageway, metres. */
const TIP_CLEAR_M = 0.05;
/** A planter by a shop: its share, and how far out from the wall, metres. */
const PLANTER_SHARE = 0.35;
const PLANTER_OUT_M = 0.45;
/** Houses: the shares with bins and with a bike against the wall, and where those stand, metres. */
const BIN_SHARE = 0.45;
const WALL_BIKE_SHARE = 0.22;
const BIN_OUT_M = 0.55;
const BIN_CORNER_M = 0.9;
const BIN_GAP_M = 0.68;
const WALL_BIKE_OUT_M = 0.4;
/** A front garden needs this much room between wall and pavement for a hedge, metres. */
const HEDGE_MIN_GARDEN_M = 1.5;
/** The hedge stands this far inside the garden from the pavement, leaves this gap for the path, and keeps off the corners, metres. */
const HEDGE_INSET_M = 0.45;
const HEDGE_PATH_M = 1.4;
const HEDGE_END_M = 0.5;
/** Flats: the share with a container pillar, the garden room it needs, its distance from the wall, metres. */
const CONTAINER_SHARE = 0.45;
const CONTAINER_MIN_GARDEN_M = 2.4;
const CONTAINER_OUT_M = 1.4;
/** Footprints above this are blocks of flats or halls rather than houses, m². */
const HOUSE_MAX_AREA_M2 = 300;
/** Bollards at a zebra: how far along it from its middle, and past the kerb, metres. */
const BOLLARD_ALONG_M = 1.1;
const BOLLARD_PAST_KERB_M = 0.45;
/** The crossing sign stands this far before the zebra and past the kerb, metres. */
const CROSSING_SIGN_BEFORE_M = 2.2;
const CROSSING_SIGN_PAST_KERB_M = 0.6;
/** How much room each kind of piece needs round its spot, metres. */
const RADIUS = {
  bike: 0.3,
  planter: 0.35,
  bin: 0.3,
  wallBike: 0.25,
  hedge: 0.3,
  post: 0.1,
  container: 1,
};
/** A shop's bikes need this much of the wall, and keep this far from its corners, metres. */
const RACK_ROOM_M = 1;
const RACK_CORNER_M = 0.5;
/** The planter stands this far past the last bike, and this far from the wall's end, metres. */
const PLANTER_AFTER_M = 1.4;
const PLANTER_END_M = 0.8;
/** Bins by a house: how many, and how far from the wall's far corner a bike leans, metres. */
const BINS_PER_HOUSE = 2;
const WALL_BIKE_END_M = 1.3;
/** A wall needs this length for a bike to lean on it, and a hedge section this length, metres. */
const WALL_BIKE_MIN_M = 3;
const HEDGE_MIN_M = 1;

/** Room kept round a piece: from carriageways and cycle paths, and from footprints, metres. */
const ROAD_CLEAR_M = 0.35;
/** The farthest a cycle path's outer edge lies from its road's centre line, plus the clear room, metres. */
const CYCLE_SEARCH_M =
  Math.max(
    ...CYCLE_PATH_CLASSES.map((roadClass) => {
      const bands = sideBands(roadClass);
      return bands.edge + bands.cycle;
    }),
  ) + ROAD_CLEAR_M;
/** A wall fronts a road when its normal points this close to it (cosine). */
const FRONT_MIN_COS = 0.6;
const WALL_CLEAR_M = 0.05;
/** Salts naming each seeded choice. */
const SALTS = {
  rack: 0x91,
  bikes: 0x92,
  planter: 0x93,
  bins: 0x94,
  wallBike: 0x95,
  container: 0x96,
  colour: 0x97,
  lid: 0x98,
};
/** Walls are numbered within a building in steps of this, so their seeds do not overlap. */
const EDGE_SEED_STRIDE = 101;

/** What clutter goes down with: the cell's surroundings and detail buffers, and the running count. */
type Dressing = {
  detail: DetailBuffers;
  /** The bicycles placed so far, drawn instanced by the cell. */
  bikes: BikeSpot[];
  /** Every spot a piece went down on. */
  spots: Point[];
  context: CellContext;
  origin: Point;
  ground: number;
  count: number;
};

/** A wall that fronts a road: the wall, and the room between it and the pavement's outer edge. */
type Front = { edge: WallEdge; garden: number };

/** Whether a spot is clear for a piece of `radius`: off the carriageways, cycle paths and footprints. */
function clear(
  dressing: Dressing,
  point: Point,
  radius: number,
  roadClear = ROAD_CLEAR_M,
): boolean {
  const { context } = dressing;
  if (context.onCarriageway(point, radius + roadClear)) return false;
  if (context.inFootprint(point, radius + WALL_CLEAR_M)) return false;
  const cycle = context.nearestRoad(
    point,
    CYCLE_SEARCH_M + radius,
    (road) => sideBands(road.roadClass).cycle > 0,
  );
  if (!cycle) return true;
  const bands = sideBands(cycle.segment.road.roadClass);
  return cycle.distance > bands.edge + bands.cycle + radius + roadClear;
}

/**
 * Whether a rack bike fits at a spot: its middle clear of everything, and the tip of its outer
 * wheel reaching no further than the edge of the pavement.
 */
function bikeFits(dressing: Dressing, edge: WallEdge, along: number): boolean {
  const middle = wallPoint(edge, along, RACK_BIKES.out);
  const tip = wallPoint(edge, along, RACK_BIKES.out + BIKE_HALF_LENGTH_M);
  return (
    clear(dressing, middle, RADIUS.bike) && clear(dressing, tip, 0, TIP_CLEAR_M)
  );
}

/** Puts one piece down if there is room and the cell is not full; says whether it did. */
function place(
  dressing: Dressing,
  point: Point,
  radius: number,
  draw: (at: Placement) => void,
  direction: Point,
): boolean {
  if (dressing.count >= MAX_CLUTTER_PER_CELL || !clear(dressing, point, radius))
    return false;
  draw({
    at: point,
    direction,
    ground: dressing.ground,
    origin: dressing.origin,
  });
  dressing.count += 1;
  dressing.spots.push(point);
  return true;
}

/** A point of a wall: `along` it from its start and `out` from its face. */
function wallPoint(edge: WallEdge, along: number, out: number): Point {
  return [
    edge.from[0] + edge.direction[0] * along + edge.outward[0] * out,
    edge.from[1] + edge.direction[1] * along + edge.outward[1] * out,
  ];
}

/** The road a wall fronts and the garden between it and the pavement, or null when it fronts none. */
function frontOf(edge: WallEdge, context: CellContext): Front | null {
  if (edge.length < MIN_FRONT_M) return null;
  const middle = wallPoint(edge, edge.length / 2, 0);
  const hit = context.nearestRoad(middle, FRONT_SEARCH_M);
  if (!hit) return null;
  const [dx, dy] = [hit.closest[0] - middle[0], hit.closest[1] - middle[1]];
  const length = Math.hypot(dx, dy);
  if (
    length === 0 ||
    (edge.outward[0] * dx + edge.outward[1] * dy) / length < FRONT_MIN_COS
  )
    return null;
  const bands = sideBands(hit.segment.road.roadClass);
  return {
    edge,
    garden: hit.distance - (bands.edge + bands.cycle + bands.pavement),
  };
}

/** A row of bicycles in hoops in front of a shop, their front wheels to the wall. */
function dressShop(dressing: Dressing, front: Front, seed: number): void {
  const { edge } = front;
  const bikes =
    RACK_BIKES.least + (idHash(seed, SALTS.bikes) % RACK_BIKES.extra);
  const span = (bikes - 1) * RACK_BIKES.spacing;
  if (span + RACK_ROOM_M > edge.length) return;
  const start =
    idUnit(seed, SALTS.rack) * (edge.length - span - RACK_ROOM_M) +
    RACK_CORNER_M;
  const toWall: Point = [-edge.outward[0], -edge.outward[1]];
  for (let bike = 0; bike < bikes; bike++) {
    const along = start + bike * RACK_BIKES.spacing;
    if (!bikeFits(dressing, edge, along)) continue;
    const at = wallPoint(edge, along, RACK_BIKES.out);
    const colour =
      BIKE_COLOURS[idHash(seed + bike, SALTS.colour) % BIKE_COLOURS.length];
    if (
      !place(
        dressing,
        at,
        0,
        (spot) =>
          dressing.bikes.push({
            at: spot.at,
            direction: spot.direction,
            colour,
          }),
        toWall,
      )
    )
      continue;
    pushRack(dressing.detail, {
      at: wallPoint(edge, along + RACK_BIKES.spacing / 2, RACK_BIKES.out),
      direction: toWall,
      ground: dressing.ground,
      origin: dressing.origin,
    });
  }
  if (idUnit(seed, SALTS.planter) < PLANTER_SHARE)
    dressPlanter(dressing, edge, start + span + PLANTER_AFTER_M);
}

/** A planter by a shop, `along` its wall (kept clear of the wall's far end). */
function dressPlanter(dressing: Dressing, edge: WallEdge, along: number): void {
  const at = wallPoint(
    edge,
    Math.min(edge.length - PLANTER_END_M, along),
    PLANTER_OUT_M,
  );
  place(
    dressing,
    at,
    RADIUS.planter,
    (spot) => pushPlanter(dressing.detail, spot),
    edge.direction,
  );
}

/** Bins by a house's front corner, maybe a bike against its wall, and a hedge along its garden. */
function dressHouse(dressing: Dressing, front: Front, seed: number): void {
  const { edge } = front;
  if (idUnit(seed, SALTS.bins) < BIN_SHARE) {
    const lid = (index: number): number =>
      BIN_LIDS[idHash(seed + index, SALTS.lid) % BIN_LIDS.length];
    for (let bin = 0; bin < BINS_PER_HOUSE; bin++) {
      const at = wallPoint(edge, BIN_CORNER_M + bin * BIN_GAP_M, BIN_OUT_M);
      place(
        dressing,
        at,
        RADIUS.bin,
        (spot) => pushBin(dressing.detail, spot, lid(bin)),
        edge.outward,
      );
    }
  }
  if (
    idUnit(seed, SALTS.wallBike) < WALL_BIKE_SHARE &&
    edge.length > WALL_BIKE_MIN_M
  ) {
    const colour =
      BIKE_COLOURS[idHash(seed, SALTS.colour) % BIKE_COLOURS.length];
    const at = wallPoint(edge, edge.length - WALL_BIKE_END_M, WALL_BIKE_OUT_M);
    place(
      dressing,
      at,
      RADIUS.wallBike,
      (spot) =>
        dressing.bikes.push({ at: spot.at, direction: spot.direction, colour }),
      edge.direction,
    );
  }
  if (front.garden >= HEDGE_MIN_GARDEN_M) dressGarden(dressing, front);
}

/** A clipped hedge along the front of a house's garden, a gap left for the path to its door. */
function dressGarden(dressing: Dressing, front: Front): void {
  const { edge } = front;
  const out = front.garden - HEDGE_INSET_M;
  const middle = edge.length / 2;
  const look = { ground: dressing.ground, origin: dressing.origin };
  for (const [from, to] of [
    [HEDGE_END_M, middle - HEDGE_PATH_M / 2],
    [middle + HEDGE_PATH_M / 2, edge.length - HEDGE_END_M],
  ]) {
    if (to - from < HEDGE_MIN_M || dressing.count >= MAX_CLUTTER_PER_CELL)
      continue;
    const [a, b] = [wallPoint(edge, from, out), wallPoint(edge, to, out)];
    const probe = wallPoint(edge, (from + to) / 2, out);
    if (
      !clear(dressing, probe, RADIUS.hedge) ||
      !clear(dressing, a, RADIUS.hedge) ||
      !clear(dressing, b, RADIUS.hedge)
    )
      continue;
    pushHedge(dressing.detail, a, b, look);
    dressing.count += 1;
    dressing.spots.push(a, probe, b);
  }
}

/** A waste container's drop pillar in front of a block of flats. */
function dressFlats(dressing: Dressing, front: Front, seed: number): void {
  if (
    front.garden < CONTAINER_MIN_GARDEN_M ||
    idUnit(seed, SALTS.container) >= CONTAINER_SHARE
  )
    return;
  const band =
    CONTAINER_BANDS[idHash(seed, SALTS.colour) % CONTAINER_BANDS.length];
  const at = wallPoint(front.edge, front.edge.length / 2, CONTAINER_OUT_M);
  place(
    dressing,
    at,
    1,
    (spot) => pushContainer(dressing.detail, spot, band),
    front.edge.direction,
  );
}

/** The clutter along one building's fronts. */
function dressBuilding(dressing: Dressing, laid: LaidBuilding): void {
  const house = polygonArea(laid.building.ring) <= HOUSE_MAX_AREA_M2;
  let flatsDressed = false;
  for (const edge of laid.edges) {
    const front = frontOf(edge, dressing.context);
    if (!front) continue;
    const seed =
      (laid.building.structureId * EDGE_SEED_STRIDE + edge.index) >>> 0;
    if (edge.shop) dressShop(dressing, front, seed);
    else if (house) dressHouse(dressing, front, seed);
    else if (!flatsDressed) {
      dressFlats(dressing, front, seed);
      flatsDressed = true;
    }
  }
}

/** A point of a zebra: `along` the road from its middle and `across` it. */
function zebraPoint(site: ZebraSite, along: number, across: number): Point {
  const [dx, dy] = site.direction;
  return [
    site.centre[0] + dx * along - dy * across,
    site.centre[1] + dy * along + dx * across,
  ];
}

/** Bollards on both pavements at a zebra's ends, and its sign on the approach. */
function dressZebra(dressing: Dressing, site: ZebraSite): void {
  const kerb = site.width / 2 + BOLLARD_PAST_KERB_M;
  for (const side of [-1, 1])
    for (const along of [-BOLLARD_ALONG_M, BOLLARD_ALONG_M])
      place(
        dressing,
        zebraPoint(site, along, side * kerb),
        RADIUS.post,
        (spot) => pushBollard(dressing.detail, spot),
        site.direction,
      );
  const signAt = zebraPoint(
    site,
    -CROSSING_SIGN_BEFORE_M,
    site.width / 2 + CROSSING_SIGN_PAST_KERB_M,
  );
  const facing: Point = [-site.direction[0], -site.direction[1]];
  place(
    dressing,
    signAt,
    RADIUS.post,
    (spot) => pushSign(dressing.detail, spot, "crossing"),
    facing,
  );
}

/**
 * Dresses a detailed cell's streets: its buildings' fronts, then the zebras and junction signs
 * whose spots lie in the cell (`owns` tells), until {@link MAX_CLUTTER_PER_CELL} pieces are down.
 *
 * @param detail - The cell's detail buffers.
 * @param input - The cell's surroundings, laid-out buildings, crossings, signs, ownership test,
 *   ground height and origin.
 * @returns How many pieces went down, the bicycles among them (drawn instanced by the cell), and
 *   every spot a piece went down on.
 */
export function pushStreetClutter(
  detail: DetailBuffers,
  input: {
    context: CellContext;
    buildings: readonly LaidBuilding[];
    zebras: readonly ZebraSite[];
    signs: readonly SignSite[];
    owns: (point: Point) => boolean;
    ground: number;
    origin: Point;
  },
): { count: number; bikes: BikeSpot[]; spots: Point[] } {
  const dressing: Dressing = {
    detail,
    bikes: [],
    spots: [],
    context: input.context,
    origin: input.origin,
    ground: input.ground,
    count: 0,
  };
  for (const zebra of input.zebras)
    if (input.owns(zebra.centre)) dressZebra(dressing, zebra);
  for (const sign of input.signs)
    if (input.owns(sign.at))
      place(
        dressing,
        sign.at,
        RADIUS.post,
        (spot) => pushSign(detail, spot, sign.kind),
        sign.facing,
      );
  for (const laid of input.buildings) dressBuilding(dressing, laid);
  const { count, bikes, spots } = dressing;
  return { count, bikes, spots };
}
