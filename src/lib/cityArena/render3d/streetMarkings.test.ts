import { describe, expect, it } from "vitest";
import type { DecodedRoad } from "../world/decode";
import type { GroundKind, RoadClass } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { createCellContext } from "./cellContext";
import { createDetailBuffers, type DetailBuffers } from "./detailBuffers";
import { createMeshBuffers } from "./meshBuffers";
import {
  CYCLE_PATH_M,
  KERB,
  lampRoadWidth,
  pushStreetSides,
  pushZebras,
  sideBands,
  zebraSites,
  type StreetTargets,
} from "./streetMarkings";
import {
  FIXTURE_TILE_RECT,
  fixtureTile,
  squareRing,
} from "./testing/cityFixture";

/** What a fixture street may hold besides its road along y = 0. */
type Extras = {
  roads?: { points: Point[]; roadClass: RoadClass }[];
  buildings?: { ring: Point[]; levels: number }[];
  ground?: { ring: Point[]; kind: GroundKind }[];
};

/** A street along y = 0 from x = −60 to 60, with optional side roads, houses and ground. */
function street(roadClass: RoadClass, extras: Extras = {}) {
  const tile = fixtureTile(
    { x: 0, y: 0, rect: FIXTURE_TILE_RECT },
    {
      roads: [
        {
          points: [
            [-60, 0],
            [60, 0],
          ],
          roadClass,
        },
        ...(extras.roads ?? []),
      ],
      buildings: extras.buildings,
      ground: extras.ground,
    },
  );
  const context = createCellContext(
    { minX: -64, minY: -64, maxX: 64, maxY: 64 },
    [tile],
    new Set(),
  );
  return { tile, context, road: tile.roads[0] };
}

/** Builds a road's detailed sides; returns the buffers. */
function sidesOf(
  road: DecodedRoad,
  context: ReturnType<typeof street>["context"],
): StreetTargets {
  const targets: StreetTargets = {
    pavement: createMeshBuffers(),
    verge: createMeshBuffers(),
    paint: createDetailBuffers(),
    detail: createDetailBuffers(),
  };
  const piece = { points: road.points, capStart: false, capEnd: false };
  pushStreetSides(targets, road, piece, {
    context,
    origin: [0, 0],
    uv: () => [0, 0],
    heights: { pavement: 0.015, road: 0.02, paint: 0.03 },
  });
  return targets;
}

/** Every vertex's (x, z) of detail or paint buffers. */
function flatPoints(buffers: DetailBuffers): Point[] {
  const points: Point[] = [];
  for (let index = 0; index < buffers.positions.length; index += 3)
    points.push([buffers.positions[index], buffers.positions[index + 2]]);
  return points;
}

describe("pushStreetSides", () => {
  it("runs a kerb along both edges of the carriageway", () => {
    const { road, context } = street("residential");

    const { detail } = sidesOf(road, context);

    const edge = sideBands("residential").edge;
    const points = flatPoints(detail);
    expect(points.length).toBeGreaterThan(0);
    for (const [x, z] of points) {
      expect(Math.abs(z)).toBeGreaterThanOrEqual(edge - 1e-6);
      expect(Math.abs(z)).toBeLessThanOrEqual(edge + KERB.width + 1e-6);
      expect(Math.abs(x)).toBeLessThanOrEqual(60 + 1e-6);
    }
    const ys = detail.positions.filter((_, index) => index % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(0.02 + KERB.height, 5);
    expect(new Set(points.map(([, z]) => Math.sign(z)))).toEqual(
      new Set([1, -1]),
    );
  });

  it("paints cycle paths beside primary and secondary roads only", () => {
    for (const roadClass of ["primary", "secondary"] as const) {
      const { road, context } = street(roadClass);
      const { paint } = sidesOf(road, context);
      const edge = sideBands(roadClass).edge;
      expect(paint.positions.length).toBeGreaterThan(0);
      for (const [, z] of flatPoints(paint)) {
        expect(Math.abs(z)).toBeGreaterThanOrEqual(edge - 1e-6);
        expect(Math.abs(z)).toBeLessThanOrEqual(edge + CYCLE_PATH_M + 1e-6);
      }
    }
    for (const roadClass of [
      "tertiary",
      "residential",
      "living_street",
    ] as const) {
      const { road, context } = street(roadClass);
      expect(sidesOf(road, context).paint.positions).toHaveLength(0);
    }
  });

  it("stops the kerb at a side street's mouth but runs the cycle path across it", () => {
    const side = {
      points: [
        [0, 0],
        [0, 60],
      ] as Point[],
      roadClass: "residential" as const,
    };
    const { road, context } = street("primary", { roads: [side] });

    const { detail, paint } = sidesOf(road, context);

    const half = sideBands("residential").edge - 0.5;
    const atMouth = (points: Point[]): Point[] =>
      points.filter(([x, z]) => z > 0 && Math.abs(x) < half);
    expect(atMouth(flatPoints(detail))).toHaveLength(0);
    expect(atMouth(flatPoints(paint)).length).toBeGreaterThan(0);
  });

  it("lays a grass verge where the road runs through fields with no house near, pavement by houses", () => {
    const field = {
      ring: [
        [-100, 6],
        [100, 6],
        [100, 80],
        [-100, 80],
      ] as Point[],
      kind: "field" as const,
    };
    const houses = [{ ring: squareRing(-50, 12, 100), levels: 2 }];
    const open = street("residential", { ground: [field] });
    const built = street("residential", { ground: [field], buildings: houses });

    const openSides = sidesOf(open.road, open.context);
    const builtSides = sidesOf(built.road, built.context);

    expect(openSides.verge.positions.length).toBeGreaterThan(0);
    expect(builtSides.verge.positions).toHaveLength(0);
    expect(builtSides.pavement.positions.length).toBeGreaterThan(
      openSides.pavement.positions.length,
    );
  });

  it("builds the same street every time", () => {
    const { road, context } = street("primary");

    expect(sidesOf(road, context)).toEqual(sidesOf(road, context));
  });
});

/** A long road of `roadClass` with residential side roads every 80 m. */
function crossroads(roadClass: RoadClass): DecodedRoad[] {
  const roads: { points: Point[]; roadClass: RoadClass }[] = [
    {
      points: [
        [-200, 0],
        [-120, 0],
        [-40, 0],
        [40, 0],
        [120, 0],
        [200, 0],
      ],
      roadClass,
    },
  ];
  for (const x of [-120, -40, 40, 120])
    roads.push({
      points: [
        [x, 0],
        [x, 80],
      ],
      roadClass: "residential",
    });
  return fixtureTile({ x: 0, y: 0, rect: FIXTURE_TILE_RECT }, { roads }).roads;
}

/** How far a point is from the nearest junction of {@link crossroads}. */
function fromJunction([x, y]: Point): number {
  return Math.min(...[-120, -40, 40, 120].map((at) => Math.hypot(x - at, y)));
}

describe("zebraSites", () => {
  it("puts crossings only on approaches to junctions, set back past the other road", () => {
    const sites = zebraSites(crossroads("primary"));

    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect(fromJunction(site.centre)).toBeGreaterThan(3);
      expect(fromJunction(site.centre)).toBeLessThan(15);
    }
  });

  it("never marks a zebra on a motorway", () => {
    for (const site of zebraSites(crossroads("motorway")))
      expect(site.width).toBe(6);
  });

  it("is the same set of crossings every time", () => {
    expect(zebraSites(crossroads("primary"))).toEqual(
      zebraSites(crossroads("primary")),
    );
  });

  it("paints bars across the carriageway only for crossings in the region", () => {
    const [site] = zebraSites(crossroads("primary"));
    const world = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
    const elsewhere = { minX: 900, minY: 900, maxX: 1000, maxY: 1000 };
    const look = { height: 0.03, origin: [0, 0] as Point };
    const paint = createDetailBuffers();
    const none = createDetailBuffers();

    pushZebras(paint, [site], world, look);
    pushZebras(none, [site], elsewhere, look);

    expect(paint.positions.length).toBeGreaterThan(0);
    expect(none.positions).toHaveLength(0);
    const across: Point = [-site.direction[1], site.direction[0]];
    for (const [x, y] of flatPoints(paint)) {
      const offset =
        (x - site.centre[0]) * across[0] + (y - site.centre[1]) * across[1];
      expect(Math.abs(offset)).toBeLessThanOrEqual(site.width / 2);
    }
  });
});

describe("lampRoadWidth", () => {
  it("keeps lamps clear of the cycle paths", () => {
    expect(lampRoadWidth("primary")).toBeCloseTo(9 + 2 * CYCLE_PATH_M);
    expect(lampRoadWidth("residential")).toBe(6);
  });
});
