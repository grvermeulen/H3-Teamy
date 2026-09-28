import { describe, expect, it } from "vitest";
import { boundsOf } from "../mapBuild/geometry";
import type { DecodedTile } from "../world/decode";
import type { GroundKind, RoadClass } from "../world/mapTypes";
import type { Point } from "../world/projection";
import {
  AMBIENCE_EASE_S,
  AMBIENCE_LOOPS,
  SILENT_AMBIENCE,
  ambienceLevels,
  easeAmbience,
} from "./ambience";
import type { Listener } from "./spatial";
import {
  EMPTY_SURROUNDINGS,
  TRAFFIC_RADIUS_M,
  readSurroundings,
} from "./surroundings";
import type { TrafficSource } from "./trafficVoices";

const here: Listener = { x: 0, y: 0, facing: 0 };
const nobody = { peds: [], traffic: [] };

/** A 2 km tile around the origin holding `parts`. */
function tile(
  parts: Partial<DecodedTile>,
  rect = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
): DecodedTile {
  return {
    x: 0,
    y: 0,
    rect,
    roads: [],
    buildings: [],
    ground: [],
    water: [],
    trees: [],
    furniture: [],
    ...parts,
  };
}

/** A square ring `half` metres each way around (`x`, `y`). */
function square(half: number, x = 0, y = 0): Point[] {
  return [
    [x - half, y - half],
    [x + half, y - half],
    [x + half, y + half],
    [x - half, y + half],
  ];
}

/** A ground polygon of `kind` over the square. */
function ground(
  kind: GroundKind,
  ring: Point[],
): DecodedTile["ground"][number] {
  return { ring, bounds: boundsOf(ring), kind };
}

/** A straight road of `roadClass` from `from` to `to`. */
function road(
  roadClass: RoadClass,
  from: Point,
  to: Point,
): DecodedTile["roads"][number] {
  return { points: [from, to], roadClass, bounds: boundsOf([from, to]) };
}

/** `count` trees scattered within 40 m. */
function trees(count: number): DecodedTile["trees"] {
  return Array.from({ length: count }, (_, index) => {
    const point: Point = [Math.cos(index) * 30, Math.sin(index) * 30];
    return { point, size: "medium", bounds: boundsOf([point]) };
  });
}

/** `count` moving cars within 50 m. */
function cars(count: number): TrafficSource[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    x: 10 * id,
    y: 5,
    speedMps: 12,
    siren: false,
  }));
}

describe("readSurroundings", () => {
  it("counts only the road inside the 80 m circle, weighted by its class", () => {
    const through = tile({ roads: [road("residential", [-500, 0], [500, 0])] });
    expect(readSurroundings([through], nobody, here).roadM).toBeCloseTo(
      2 * TRAFFIC_RADIUS_M * 0.5,
    );
    const far = tile({ roads: [road("primary", [-500, 200], [500, 200])] });
    expect(readSurroundings([far], nobody, here).roadM).toBe(0);
  });

  it("finds the nearest point on a road", () => {
    const side = tile({ roads: [road("residential", [-50, 20], [50, 20])] });
    expect(readSurroundings([side], nobody, here).nearestRoad).toEqual({
      x: 0,
      y: 20,
    });
    expect(readSurroundings([tile({})], nobody, here).nearestRoad).toBeNull();
  });

  it("counts a road that two overlapping tiles both carry once", () => {
    const shared = road("primary", [-500, 0], [500, 0]);
    const west = tile(
      { roads: [shared] },
      { minX: -2000, minY: -1000, maxX: 0, maxY: 1000 },
    );
    const east = tile(
      { roads: [shared] },
      { minX: 0, minY: -1000, maxX: 2000, maxY: 1000 },
    );
    expect(readSurroundings([west, east], nobody, here).roadM).toBeCloseTo(
      2 * TRAFFIC_RADIUS_M * 2,
    );
  });

  it("reads the shares of green, field, water and buildings under the ground samples", () => {
    const park = readSurroundings(
      [tile({ ground: [ground("grass", square(200))] })],
      nobody,
      here,
    );
    expect(park.greenShare).toBe(1);
    const half = readSurroundings(
      [
        tile({
          water: [
            {
              ring: square(100, 100, 0),
              bounds: boundsOf(square(100, 100, 0)),
            },
          ],
        }),
      ],
      nobody,
      here,
    );
    expect(half.waterShare).toBeGreaterThan(0.4);
    expect(half.waterShare).toBeLessThan(0.7);
  });

  it("counts people within 30 m and moving cars within 80 m", () => {
    const scene = {
      peds: [
        { x: 5, y: 5 },
        { x: 40, y: 0 },
      ],
      traffic: [...cars(3), { id: 9, x: 5, y: 0, speedMps: 0, siren: false }],
    };
    const read = readSurroundings([tile({})], scene, here);
    expect(read.peds).toBe(1);
    expect(read.movingCars).toBe(3);
  });
});

describe("ambienceLevels", () => {
  it("hears a busy road as full traffic and no birds", () => {
    const busy = readSurroundings(
      [tile({ roads: [road("primary", [-500, 0], [500, 0])] })],
      { peds: [], traffic: cars(4) },
      here,
    );
    const levels = ambienceLevels(busy);
    expect(levels["amb-traffic"]).toBeGreaterThan(0.8);
    expect(levels["amb-birds"]).toBeLessThan(0.1);
  });

  it("fills a park with trees with birdsong", () => {
    const park = readSurroundings(
      [tile({ ground: [ground("grass", square(200))], trees: trees(20) })],
      nobody,
      here,
    );
    expect(ambienceLevels(park)["amb-birds"]).toBeGreaterThan(0.8);
  });

  it("blows wind over open fields without buildings, and none among houses", () => {
    const fields = readSurroundings(
      [tile({ ground: [ground("field", square(300))] })],
      nobody,
      here,
    );
    expect(ambienceLevels(fields)["amb-wind"]).toBeGreaterThan(0.8);
    expect(
      ambienceLevels({
        ...EMPTY_SURROUNDINGS,
        fieldShare: 1,
        buildingShare: 0.5,
      })["amb-wind"],
    ).toBe(0);
  });

  it("runs water by the river", () => {
    const river = readSurroundings(
      [
        tile({
          water: [
            { ring: square(100, 60, 0), bounds: boundsOf(square(100, 60, 0)) },
          ],
        }),
      ],
      nobody,
      here,
    );
    expect(ambienceLevels(river)["amb-water"]).toBeGreaterThan(0.8);
  });

  it("keeps every level within 0…1, however crowded", () => {
    const extreme = {
      ...EMPTY_SURROUNDINGS,
      roadM: 1e6,
      movingCars: 1e3,
      peds: 1e3,
      trees: 1e3,
      greenShare: 1,
      fieldShare: 1,
      waterShare: 1,
    };
    for (const level of Object.values(ambienceLevels(extreme))) {
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
    expect(ambienceLevels(EMPTY_SURROUNDINGS)).toEqual(SILENT_AMBIENCE);
  });
});

describe("easeAmbience", () => {
  it("moves each level at most a full swing per 1.5 s, and settles on the target", () => {
    const full = { ...SILENT_AMBIENCE, "amb-birds": 1 };
    const half = easeAmbience(SILENT_AMBIENCE, full, AMBIENCE_EASE_S / 2);
    expect(half["amb-birds"]).toBeCloseTo(0.5);
    const settled = easeAmbience(half, full, AMBIENCE_EASE_S);
    expect(settled).toEqual(full);
    for (const loop of AMBIENCE_LOOPS)
      expect(easeAmbience(full, SILENT_AMBIENCE, 10)[loop]).toBe(0);
  });
});
