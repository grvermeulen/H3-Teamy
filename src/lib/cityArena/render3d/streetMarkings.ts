/**
 * The street edges of a detailed cell: along both sides of every paved road, a raised bevelled
 * kerb at the carriageway's edge, a red cycle path (fietspad) on main roads, then the pavement — or
 * a grass verge where the road runs through grass, fields or woods with no building near. Zebra
 * crossings sit on the approaches to junctions of residential and bigger roads.
 *
 * A road's sides are cut into chunks of about {@link CHUNK_M}, each chunk decided on its own, so a
 * road leaving town turns from pavement to verge where the houses stop. Kerbs stop where another
 * road's carriageway crosses, so a side street's mouth stays open; a cycle path runs on across a
 * smaller road's mouth, painted red over it as Dutch side-road crossings are. Painted surfaces
 * (cycle paths, zebras) are flat and join the cell's paint layer; kerbs join its detail.
 */
import type { Vector3Tuple } from "three";
import type { Rect } from "../mapBuild/geometry";
import { PAVEMENT_WIDTH_M, ROAD_WIDTH_M } from "../render/palette";
import { seedFromString } from "../sim/rng";
import type { DecodedRoad } from "../world/decode";
import type { RoadClass } from "../world/mapTypes";
import type { Point } from "../world/projection";
import type { CellContext } from "./cellContext";
import type { SignKind } from "./clutterShapes";
import { pushDetailQuad, type DetailBuffers } from "./detailBuffers";
import { idUnit } from "./idHash";
import {
  UP,
  pushTriangleFacing,
  pushVertex,
  vertexCount,
  type MeshBuffers,
  type UvMapping,
} from "./meshBuffers";
import { distinctPoints, inRegion, mitre, type RoadPiece } from "./roadMesh";

/** Width of a cycle path, metres. */
export const CYCLE_PATH_M = 1.6;
/** Roads wide and busy enough for cycle paths alongside. */
export const CYCLE_PATH_CLASSES: readonly RoadClass[] = [
  "primary",
  "secondary",
];
/** Roads whose junction approaches get zebra crossings. */
const ZEBRA_CLASSES: readonly RoadClass[] = [
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
];
/** A road's sides are decided in chunks of about this length, metres. */
export const CHUNK_M = 10;
/** A side is a grass verge only with no building within this distance, metres. */
const VERGE_CLEAR_M = 15;
/**
 * How far past the pavement band the ground is looked at for a verge, metres: land-use polygons
 * stop a few metres short of the road, so the band's own middle often lies in the gap.
 */
const VERGE_PROBES_M: readonly number[] = [0, 4, 8];
/** The kerb: height, width and the bevel on its road-side top edge, metres. */
export const KERB = { height: 0.12, width: 0.16, bevel: 0.04 } as const;
/** A kerb stops this far inside another road's carriageway, metres. */
const KERB_JUNCTION_MARGIN_M = 0.4;
/** Near another road, a kerb is cut to the metre. */
const KERB_STEP_M = 1;
/** Half the widest carriageway, metres. */
const MAX_HALF_ROAD_M = Math.max(...Object.values(ROAD_WIDTH_M)) / 2;
/** Kerbstone grey, cycle-path red asphalt and zebra white, as they read at dusk. */
const KERB_COLOUR = 0x9d998f;
const CYCLE_PATH_COLOUR = 0x6e302b;
const ZEBRA_COLOUR = 0xc9c7bf;
/** A zebra: depth along the road, bar width and pitch, the clear margin at the edges, metres. */
const ZEBRA = { depth: 3, bar: 0.5, pitch: 1, edge: 0.4, setback: 1.2 };
/** Share of the junction approaches with a zebra. */
const ZEBRA_SHARE = 0.55;
/** Salt of the zebra choice. */
const ZEBRA_SALT = 0x81;
/** Junction nodes are matched on a grid this fine, metres. */
const NODE_KEY_STEP_M = 0.5;
/** Each road class's rank: a cycle path runs on across the mouth of a lower-ranked road. */
const ROAD_RANK: Record<RoadClass, number> = {
  motorway: 9,
  trunk: 8,
  primary: 7,
  secondary: 6,
  tertiary: 5,
  unclassified: 4,
  residential: 3,
  living_street: 2,
  pedestrian: 1,
  service: 1,
};

/** The bands along one side of a road, measured out from its centre line, metres. */
export type SideBands = { edge: number; cycle: number; pavement: number };

/**
 * The bands beside a road on a detailed cell: the carriageway's half width, then a cycle path on
 * main roads, then the pavement.
 *
 * @param roadClass - The road's class.
 * @returns The band widths.
 */
export function sideBands(roadClass: RoadClass): SideBands {
  return {
    edge: ROAD_WIDTH_M[roadClass] / 2,
    cycle: CYCLE_PATH_CLASSES.includes(roadClass) ? CYCLE_PATH_M : 0,
    pavement: PAVEMENT_WIDTH_M,
  };
}

/**
 * The width street lamps stand clear of on a detailed cell: the carriageway and any cycle paths,
 * so a lamp stands between the cycle path and the pavement, not in the red.
 *
 * @param roadClass - The road's class.
 * @returns Metres, both sides together.
 */
export function lampRoadWidth(roadClass: RoadClass): number {
  const bands = sideBands(roadClass);
  return 2 * (bands.edge + bands.cycle);
}

/** A piece of a centre line, with the mitred frame at each of its points. */
type Chunk = { points: Point[]; frames: ReturnType<typeof mitre>[] };

/**
 * The side normal of the segment `along` metres down a polyline whose segment lengths are known —
 * the mitre's convention, taken on the segment itself so a bend inside a chunk is followed.
 */
function normalAlong(
  points: readonly Point[],
  lengths: readonly number[],
  along: number,
): Point {
  let rest = along;
  let index = 0;
  while (index < lengths.length - 1 && rest > lengths[index]) {
    rest -= lengths[index];
    index += 1;
  }
  return mitre([points[index], points[index + 1]], 0).across;
}

/** The point `along` metres down a polyline whose segment lengths are known. */
function pointAlong(
  points: readonly Point[],
  lengths: readonly number[],
  along: number,
): Point {
  let rest = along;
  for (let index = 0; index < lengths.length; index++) {
    if (rest <= lengths[index] || index === lengths.length - 1) {
      const t = lengths[index] === 0 ? 0 : Math.min(1, rest / lengths[index]);
      const [a, b] = [points[index], points[index + 1]];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    rest -= lengths[index];
  }
  return points[points.length - 1];
}

/** A polyline's points and the lengths of its segments, repeats dropped. */
type Measured = {
  points: Point[];
  lengths: number[];
  starts: number[];
  total: number;
};

/** Measures a polyline. */
function measure(line: readonly Point[]): Measured {
  const points = distinctPoints(line);
  const lengths = points
    .slice(1)
    .map((point, index) =>
      Math.hypot(point[0] - points[index][0], point[1] - points[index][1]),
    );
  const starts = [0];
  lengths.forEach((length) => starts.push(starts[starts.length - 1] + length));
  return { points, lengths, starts, total: starts[starts.length - 1] };
}

/** The part of a measured polyline between two distances along it, as a chunk with its frames. */
function slice(line: Measured, from: number, to: number): Chunk {
  const { points, lengths, starts } = line;
  const inner = points.filter((_, at) => starts[at] > from && starts[at] < to);
  const chunk = distinctPoints([
    pointAlong(points, lengths, from),
    ...inner,
    pointAlong(points, lengths, to),
  ]);
  return { points: chunk, frames: chunk.map((_, at) => mitre(chunk, at)) };
}

/**
 * A polyline cut into chunks of about {@link CHUNK_M}, each keeping the polyline's own corners.
 *
 * @param line - The centre line.
 * @returns The chunks, in order, each with its mitred frames.
 */
export function chunksOf(line: readonly Point[]): Chunk[] {
  const measured = measure(line);
  if (measured.points.length < 2) return [];
  const count = Math.max(1, Math.round(measured.total / CHUNK_M));
  const step = measured.total / count;
  return Array.from({ length: count }, (_, index) =>
    slice(measured, index * step, (index + 1) * step),
  ).filter((chunk) => chunk.points.length >= 2);
}

/**
 * The runs of a chunk that pass `free`, tested every {@link KERB_STEP_M} at their middle points.
 *
 * @param chunk - The chunk.
 * @param free - Whether the chunk is free at a distance along it.
 * @returns The free runs, as chunks.
 */
function freeRuns(chunk: Chunk, free: (along: number) => boolean): Chunk[] {
  const measured = measure(chunk.points);
  const count = Math.max(1, Math.ceil(measured.total / KERB_STEP_M));
  const step = measured.total / count;
  const runs: Chunk[] = [];
  let start: number | null = null;
  for (let index = 0; index <= count; index++) {
    const open = index < count && free((index + 0.5) * step);
    if (open && start === null) start = index * step;
    if (!open && start !== null) {
      runs.push(slice(measured, start, index * step));
      start = null;
    }
  }
  return runs.filter((run) => run.points.length >= 2);
}

/** A chunk's point `at` pushed `offset` metres out to one side, along its mitre. */
function sidePoint(
  chunk: Chunk,
  at: number,
  offset: number,
  side: 1 | -1,
): Point {
  const { across, stretch } = chunk.frames[at];
  const reach = offset * stretch * side;
  const point = chunk.points[at];
  return [point[0] + across[0] * reach, point[1] + across[1] * reach];
}

/** The middle point of a chunk, pushed out to one side. */
function sideMiddle(chunk: Chunk, offset: number, side: 1 | -1): Point {
  const [a, b] = [
    sidePoint(chunk, 0, offset, side),
    sidePoint(chunk, chunk.points.length - 1, offset, side),
  ];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** A flat band of a chunk's side between two offsets, into textured ground buffers. */
function pushBand(
  buffers: MeshBuffers,
  chunk: Chunk,
  span: [number, number],
  look: { side: 1 | -1; height: number; origin: Point; uv: UvMapping },
): void {
  const { side, height, origin, uv } = look;
  const vertex = (point: Point): number =>
    pushVertex(
      buffers,
      [point[0] - origin[0], height, point[1] - origin[1]],
      UP,
      uv(point[0], point[1]),
    );
  for (let at = 0; at + 1 < chunk.points.length; at++) {
    const base = vertexCount(buffers);
    vertex(sidePoint(chunk, at, span[0], side));
    vertex(sidePoint(chunk, at + 1, span[0], side));
    vertex(sidePoint(chunk, at + 1, span[1], side));
    vertex(sidePoint(chunk, at, span[1], side));
    pushTriangleFacing(buffers, [base, base + 1, base + 2], UP);
    pushTriangleFacing(buffers, [base, base + 2, base + 3], UP);
  }
}

/** A flat painted band of a chunk's side between two offsets, into the paint buffers. */
function paintBand(
  paint: DetailBuffers,
  chunk: Chunk,
  span: [number, number],
  look: { side: 1 | -1; height: number; origin: Point; colour: number },
): void {
  const at3 = (point: Point): Vector3Tuple => [
    point[0] - look.origin[0],
    look.height,
    point[1] - look.origin[1],
  ];
  for (let at = 0; at + 1 < chunk.points.length; at++) {
    pushDetailQuad(
      paint,
      [
        at3(sidePoint(chunk, at, span[0], look.side)),
        at3(sidePoint(chunk, at + 1, span[0], look.side)),
        at3(sidePoint(chunk, at + 1, span[1], look.side)),
        at3(sidePoint(chunk, at, span[1], look.side)),
      ],
      UP,
      look.colour,
    );
  }
}

/** The kerb's cross-section, (out from the road edge, up), from its foot on the road over to its back. */
const KERB_PROFILE: readonly [number, number][] = [
  [0, 0],
  [0, KERB.height - KERB.bevel],
  [KERB.bevel, KERB.height],
  [KERB.width - KERB.bevel / 2, KERB.height],
  [KERB.width, KERB.height - KERB.bevel / 2],
  [KERB.width, 0],
];

/** A kerb along a chunk's side: the profile swept along the road edge, each face with its normal. */
function pushKerb(
  detail: DetailBuffers,
  chunk: Chunk,
  edge: number,
  look: { side: 1 | -1; base: number; origin: Point },
): void {
  const { side, base, origin } = look;
  for (let face = 0; face + 1 < KERB_PROFILE.length; face++) {
    const [[outA, upA], [outB, upB]] = [
      KERB_PROFILE[face],
      KERB_PROFILE[face + 1],
    ];
    const length = Math.hypot(outB - outA, upB - upA);
    const [normalOut, normalUp] = [
      -(upB - upA) / length,
      (outB - outA) / length,
    ];
    for (let at = 0; at + 1 < chunk.points.length; at++) {
      const across = chunk.frames[at].across;
      const normal: Vector3Tuple = [
        across[0] * side * normalOut,
        normalUp,
        across[1] * side * normalOut,
      ];
      const corner = (index: number, out: number, up: number): Vector3Tuple => {
        const point = sidePoint(chunk, index, edge + out, side);
        return [point[0] - origin[0], base + up, point[1] - origin[1]];
      };
      pushDetailQuad(
        detail,
        [
          corner(at, outA, upA),
          corner(at + 1, outA, upA),
          corner(at + 1, outB, upB),
          corner(at, outB, upB),
        ],
        normal,
        KERB_COLOUR,
      );
    }
  }
}

/** Where a street's detail goes, and what it is built with. */
export type StreetTargets = {
  pavement: MeshBuffers;
  verge: MeshBuffers;
  paint: DetailBuffers;
  detail: DetailBuffers;
};

/** How a street's sides are built: the cell's surroundings, heights, origin and UV mapping. */
export type StreetLook = {
  context: CellContext;
  origin: Point;
  uv: UvMapping;
  heights: { pavement: number; road: number; paint: number };
};

/** Whether a chunk's side is a grass verge: grass, fields or woods beside it, no building near. */
function isVerge(
  chunk: Chunk,
  bands: SideBands,
  side: 1 | -1,
  context: CellContext,
): boolean {
  const band = bands.edge + bands.cycle + bands.pavement / 2;
  const green = VERGE_PROBES_M.some(
    (beyond) =>
      context.groundAt(sideMiddle(chunk, band + beyond, side)) !== null,
  );
  return (
    green && !context.inFootprint(sideMiddle(chunk, band, side), VERGE_CLEAR_M)
  );
}

/** One chunk's side: pavement or verge, the cycle path, and the kerb where no other road crosses. */
function pushSide(
  targets: StreetTargets,
  road: DecodedRoad,
  chunk: Chunk,
  side: 1 | -1,
  look: StreetLook,
): void {
  const bands = sideBands(road.roadClass);
  const { context, origin, uv, heights } = look;
  const outer = bands.edge + bands.cycle;
  const verge = isVerge(chunk, bands, side, context);
  const band = verge ? targets.verge : targets.pavement;
  pushBand(band, chunk, [outer, outer + bands.pavement], {
    side,
    height: heights.pavement,
    origin,
    uv,
  });
  const rank = ROAD_RANK[road.roadClass];
  if (bands.cycle > 0) {
    const middle = sideMiddle(chunk, bands.edge + bands.cycle / 2, side);
    const crossed = context.onCarriageway(
      middle,
      0,
      (other) => other !== road && ROAD_RANK[other.roadClass] >= rank,
    );
    if (!crossed)
      paintBand(targets.paint, chunk, [bands.edge, outer], {
        side,
        height: heights.paint,
        origin,
        colour: CYCLE_PATH_COLOUR,
      });
  }
  if (verge && bands.cycle === 0) return;
  const kerbLook = { side, base: heights.road, origin };
  for (const run of kerbRuns(chunk, road, bands.edge, side, context))
    pushKerb(targets.detail, run, bands.edge, kerbLook);
}

/**
 * The runs of a chunk's side the kerb follows: all of it when no other road comes near, else the
 * metres whose kerb line stays off every other road's carriageway.
 */
function kerbRuns(
  chunk: Chunk,
  road: DecodedRoad,
  edge: number,
  side: 1 | -1,
  context: CellContext,
): Chunk[] {
  const other = (candidate: DecodedRoad): boolean => candidate !== road;
  const line = edge + KERB.width / 2;
  const middle = sideMiddle(chunk, line, side);
  const reach = CHUNK_M + MAX_HALF_ROAD_M + KERB_JUNCTION_MARGIN_M;
  if (!context.nearestRoad(middle, reach, other)) return [chunk];
  const measured = measure(chunk.points);
  return freeRuns(chunk, (along) => {
    const at = pointAlong(measured.points, measured.lengths, along);
    const direction = normalAlong(measured.points, measured.lengths, along);
    const probe: Point = [
      at[0] + direction[0] * line * side,
      at[1] + direction[1] * line * side,
    ];
    return !context.onCarriageway(probe, KERB_JUNCTION_MARGIN_M, other);
  });
}

/**
 * The detailed sides of one road piece: per chunk and side, pavement or verge, cycle path and kerb.
 *
 * @param targets - The pavement, verge, paint and detail buffers.
 * @param road - The road.
 * @param piece - Its centre line cut to the region.
 * @param look - The cell's surroundings, heights, origin and UVs.
 */
export function pushStreetSides(
  targets: StreetTargets,
  road: DecodedRoad,
  piece: RoadPiece,
  look: StreetLook,
): void {
  for (const chunk of chunksOf(piece.points)) {
    pushSide(targets, road, chunk, 1, look);
    pushSide(targets, road, chunk, -1, look);
  }
}

/** A zebra crossing: its middle, the road's direction there and the carriageway's width. */
export type ZebraSite = { centre: Point; direction: Point; width: number };

/** A point's key on the junction grid. */
function nodeKey([x, y]: Point): string {
  return `${Math.round(x / NODE_KEY_STEP_M)}:${Math.round(y / NODE_KEY_STEP_M)}`;
}

/**
 * The roads at one node, and its arms: a road ending there adds one, a road running through adds
 * two. A junction has at least {@link JUNCTION_ARMS}; two pieces of one street meeting end to end
 * — as the map build cuts every road at the tile seams — have two, and are no junction.
 */
type JunctionNode = { roads: Set<DecodedRoad>; arms: number };

/** Arms a node needs to be a junction: a T has three. */
const JUNCTION_ARMS = 3;

/** The roads meeting at every point of every road, by node key, with the node's arms. */
function junctionNodes(
  roads: readonly DecodedRoad[],
): Map<string, JunctionNode> {
  const nodes = new Map<string, JunctionNode>();
  for (const road of roads) {
    const last = road.points.length - 1;
    road.points.forEach((point, index) => {
      const key = nodeKey(point);
      const node = nodes.get(key) ?? { roads: new Set<DecodedRoad>(), arms: 0 };
      node.roads.add(road);
      node.arms += index === 0 || index === last ? 1 : 2;
      nodes.set(key, node);
    });
  }
  return nodes;
}

/** True when the node at `point` is a real junction, not a seam or a bend. */
function isJunctionAt(nodes: Map<string, JunctionNode>, point: Point): boolean {
  return (nodes.get(nodeKey(point))?.arms ?? 0) >= JUNCTION_ARMS;
}

/** Walks `distance` metres along a road from vertex `index` toward `step`; null past its end or another junction. */
function walk(
  road: DecodedRoad,
  index: number,
  step: 1 | -1,
  distance: number,
  nodes: Map<string, JunctionNode>,
): { at: Point; direction: Point } | null {
  let rest = distance;
  for (
    let at = index;
    at + step >= 0 && at + step < road.points.length;
    at += step
  ) {
    const [a, b] = [road.points[at], road.points[at + step]];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (at !== index && isJunctionAt(nodes, a)) return null;
    if (length > 0 && rest <= length) {
      const direction: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      return {
        at: [a[0] + direction[0] * rest, a[1] + direction[1] * rest],
        direction,
      };
    }
    rest -= length;
  }
  return null;
}

/** How far back from a junction's centre a zebra's middle stands on a road meeting others there. */
function zebraSetback(others: Iterable<DecodedRoad>): number {
  let reach = 0;
  for (const other of others) {
    const bands = sideBands(other.roadClass);
    reach = Math.max(reach, bands.edge + bands.cycle + bands.pavement);
  }
  return reach + ZEBRA.setback + ZEBRA.depth / 2;
}

/**
 * The zebra crossings of a set of roads: on the approaches of residential and bigger roads to the
 * nodes they share with another road, set back past the other road's pavement, on about half of
 * the approaches (seeded by the node and the road, so every device agrees).
 *
 * @param roads - The roads around a cell.
 * @returns The crossings.
 */
export function zebraSites(roads: readonly DecodedRoad[]): ZebraSite[] {
  const nodes = junctionNodes(roads);
  const sites: ZebraSite[] = [];
  roads.forEach((road) => {
    if (!ZEBRA_CLASSES.includes(road.roadClass)) return;
    road.points.forEach((point, index) => {
      const key = nodeKey(point);
      const meeting = nodes.get(key);
      if (!meeting || meeting.arms < JUNCTION_ARMS) return;
      const others = [...meeting.roads].filter((other) => other !== road);
      for (const step of [1, -1] as const) {
        const seed = seedFromString(
          `${key}:${nodeKey(road.points[0])}:${step}`,
        );
        if (idUnit(seed, ZEBRA_SALT) >= ZEBRA_SHARE) continue;
        const found = walk(road, index, step, zebraSetback(others), nodes);
        if (found)
          sites.push({
            centre: found.at,
            direction: found.direction,
            width: ROAD_WIDTH_M[road.roadClass],
          });
      }
    });
  });
  return sites;
}

/**
 * Paints the zebras whose middle lies in a region: white bars along the road, a bar every metre
 * across the carriageway, clear of its edges.
 *
 * @param paint - The paint buffers.
 * @param sites - The crossings.
 * @param region - The part of the world this cell owns.
 * @param look - Paint height and the cell origin.
 */
export function pushZebras(
  paint: DetailBuffers,
  sites: readonly ZebraSite[],
  region: Rect,
  look: { height: number; origin: Point },
): void {
  for (const { centre, direction, width } of sites) {
    if (!inRegion(centre, region)) continue;
    const across: Point = [-direction[1], direction[0]];
    const bars = Math.floor((width - 2 * ZEBRA.edge) / ZEBRA.pitch);
    for (let bar = 0; bar < bars; bar++) {
      const offset = (bar - (bars - 1) / 2) * ZEBRA.pitch;
      const corner = (along: number, side: number): Vector3Tuple => [
        centre[0] +
          direction[0] * along +
          across[0] * (offset + side) -
          look.origin[0],
        look.height,
        centre[1] +
          direction[1] * along +
          across[1] * (offset + side) -
          look.origin[1],
      ];
      const [half, halfBar] = [ZEBRA.depth / 2, ZEBRA.bar / 2];
      pushDetailQuad(
        paint,
        [
          corner(-half, -halfBar),
          corner(half, -halfBar),
          corner(half, halfBar),
          corner(-half, halfBar),
        ],
        UP,
        ZEBRA_COLOUR,
      );
    }
  }
}

/** A road sign by a junction: where its pole stands, the way its face looks, and which sign. */
export type SignSite = { at: Point; facing: Point; kind: SignKind };

/** Roads whose mouths onto a bigger road get a give-way sign. */
const GIVE_WAY_CLASSES: readonly RoadClass[] = [
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
];
/** Roads entered past a 30 km/h zone sign. */
const ZONE_CLASSES: readonly RoadClass[] = ["residential", "living_street"];
/** A sign stands this far past the bigger road's pavement, and this far out from the kerb, metres. */
const SIGN_SETBACK_M = 1.5;
const SIGN_KERB_M = 0.5;
/** The zone sign stands this much further into the side road than the give-way sign, metres. */
const ZONE_SIGN_STEP_M = 1.2;
/** Share of the side-road mouths that are signed. */
const SIGN_SHARE = 0.7;
/** Salt of the sign choice. */
const SIGN_SALT = 0x82;

/** The point to a traveller's right, `distance` metres from `at` (the map's y runs south). */
function rightOf(at: Point, travel: Point, distance: number): Point {
  return [at[0] - travel[1] * distance, at[1] + travel[0] * distance];
}

/** The biggest road among some, by rank. */
function biggest(roads: readonly DecodedRoad[]): DecodedRoad {
  return roads.reduce((best, road) =>
    ROAD_RANK[road.roadClass] > ROAD_RANK[best.roadClass] ? road : best,
  );
}

/** The signs on one side road's approach to a bigger road, from the node at `index`, going `step`. */
function approachSigns(
  road: DecodedRoad,
  index: number,
  step: 1 | -1,
  major: DecodedRoad,
  nodes: Map<string, JunctionNode>,
): SignSite[] {
  const bands = sideBands(major.roadClass);
  const setback = bands.edge + bands.cycle + bands.pavement + SIGN_SETBACK_M;
  const found = walk(road, index, step, setback, nodes);
  if (!found) return [];
  const away = found.direction;
  const toward: Point = [-away[0], -away[1]];
  const reach = ROAD_WIDTH_M[road.roadClass] / 2 + SIGN_KERB_M;
  const signs: SignSite[] = [
    { at: rightOf(found.at, toward, reach), facing: away, kind: "giveWay" },
  ];
  if (ZONE_CLASSES.includes(road.roadClass)) {
    const further: Point = [
      found.at[0] + away[0] * ZONE_SIGN_STEP_M,
      found.at[1] + away[1] * ZONE_SIGN_STEP_M,
    ];
    signs.push({
      at: rightOf(further, away, reach),
      facing: toward,
      kind: "zone",
    });
  }
  return signs;
}

/**
 * The give-way and zone signs where side roads meet bigger ones (tertiary and up): on the side
 * road's right as a driver approaches the junction, facing them, and a 30 km/h zone sign facing
 * traffic turning into a residential street — on about seven in ten mouths, seeded per node.
 *
 * @param roads - The roads around a cell.
 * @returns The signs.
 */
export function signSites(roads: readonly DecodedRoad[]): SignSite[] {
  const nodes = junctionNodes(roads);
  const sites: SignSite[] = [];
  for (const road of roads) {
    if (!GIVE_WAY_CLASSES.includes(road.roadClass)) continue;
    road.points.forEach((point, index) => {
      if (!isJunctionAt(nodes, point)) return;
      const meeting = [...(nodes.get(nodeKey(point))?.roads ?? [])];
      const bigger = meeting.filter(
        (other) =>
          ROAD_RANK[other.roadClass] > ROAD_RANK[road.roadClass] &&
          ROAD_RANK[other.roadClass] >= ROAD_RANK.tertiary,
      );
      if (bigger.length === 0) return;
      for (const step of [1, -1] as const) {
        const seed = seedFromString(
          `${nodeKey(point)}:${nodeKey(road.points[0])}:${step}`,
        );
        if (idUnit(seed, SIGN_SALT) >= SIGN_SHARE) continue;
        sites.push(...approachSigns(road, index, step, biggest(bigger), nodes));
      }
    });
  }
  return sites;
}
