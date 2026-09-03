import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import { MapBuildError } from "./errors";
import type { RoadGraph } from "./roads";
import {
  ZONE_RADIUS_M,
  buildZones,
  checkZoneConnectivity,
  computeSpawnNodes,
  indexObstacles,
  zoneCentresFromLandmarks,
  type ProjectedLandmark,
} from "./zones";

const anchors: ProjectedLandmark[] = [
  { key: "cunerakerk", center: [-4000, 2000], zoneAnchor: "rhenen" },
  {
    key: "grote-kerk-wageningen",
    center: [2700, 1150],
    zoneAnchor: "wageningen",
  },
  { key: "wur-forum", center: [2650, -600], zoneAnchor: "campus" },
  { key: "oude-kerk-bennekom", center: [3500, -2150], zoneAnchor: "bennekom" },
];

function lineGraph(points: Point[]): RoadGraph {
  const edges = points.slice(1).map((_, index) => ({
    a: index,
    b: index + 1,
    roadClass: "residential" as const,
    oneway: false,
    length: 20,
  }));
  return { nodes: points, edges };
}

describe("zoneCentresFromLandmarks", () => {
  it("returns the four anchors in canonical order", () => {
    const centres = zoneCentresFromLandmarks(anchors);
    expect(centres.map((zone) => zone.key)).toEqual([
      "rhenen",
      "wageningen",
      "campus",
      "bennekom",
    ]);
    expect(centres[0].center).toEqual([-4000, 2000]);
  });

  it("throws a MapBuildError naming missing anchors", () => {
    expect(() => zoneCentresFromLandmarks(anchors.slice(0, 2))).toThrow(
      MapBuildError,
    );
    expect(() => zoneCentresFromLandmarks(anchors.slice(0, 2))).toThrow(
      /campus.*bennekom|bennekom.*campus/,
    );
  });
});

describe("computeSpawnNodes", () => {
  it("keeps road nodes inside the disc that are clear of buildings and water", () => {
    const graph = lineGraph([
      [0, 0],
      [20, 0],
      [40, 0],
      [900, 0],
    ]);
    const buildings = indexObstacles([
      [
        [15, 3],
        [25, 3],
        [25, 13],
        [15, 13],
      ],
    ]);
    const water = indexObstacles([
      [
        [38, -3],
        [42, -3],
        [42, -8],
        [38, -8],
      ],
    ]);
    expect(
      computeSpawnNodes(graph, [0, 0], ZONE_RADIUS_M, buildings, water),
    ).toEqual([[0, 0]]);
  });
});

describe("checkZoneConnectivity", () => {
  it("passes for one connected component", () => {
    const graph = lineGraph([
      [0, 0],
      [20, 0],
      [40, 0],
    ]);
    expect(checkZoneConnectivity(graph, [0, 0], 500)).toEqual({
      ok: true,
      largestShare: 1,
      edgeCount: 2,
    });
  });

  it("fails when the network inside the disc is split in half", () => {
    const graph: RoadGraph = {
      nodes: [
        [0, 0],
        [20, 0],
        [100, 100],
        [120, 100],
      ],
      edges: [
        { a: 0, b: 1, roadClass: "residential", oneway: false, length: 20 },
        { a: 2, b: 3, roadClass: "residential", oneway: false, length: 20 },
      ],
    };
    const result = checkZoneConnectivity(graph, [0, 0], 500);
    expect(result.ok).toBe(false);
    expect(result.largestShare).toBe(0.5);
  });
});

describe("buildZones", () => {
  it("emits zones in units with landmark keys inside the disc", () => {
    const graph = lineGraph([
      [-4000, 2000],
      [-3980, 2000],
    ]);
    const landmarks: ProjectedLandmark[] = [
      ...anchors,
      { key: "gastland", center: [-3700, 2100] },
      { key: "far-away", center: [9000, 9000] },
    ];
    const zones = buildZones(
      zoneCentresFromLandmarks(anchors),
      graph,
      landmarks,
      [],
      [],
      {
        requireConnectivity: false,
      },
    );
    expect(zones[0]).toMatchObject({
      key: "rhenen",
      name: "Rhenen centrum",
      center: [-16000, 8000],
      radius: 2000,
    });
    expect(zones[0].landmarks.sort()).toEqual(["cunerakerk", "gastland"]);
    expect(zones[0].spawnNodes).toEqual([
      [-16000, 8000],
      [-15920, 8000],
    ]);
  });

  it("throws when a zone's road network is not connected enough", () => {
    const graph: RoadGraph = {
      nodes: [
        [-4000, 2000],
        [-3980, 2000],
        [-3900, 2100],
        [-3880, 2100],
      ],
      edges: [
        { a: 0, b: 1, roadClass: "residential", oneway: false, length: 20 },
        { a: 2, b: 3, roadClass: "residential", oneway: false, length: 20 },
      ],
    };
    expect(() =>
      buildZones(zoneCentresFromLandmarks(anchors), graph, anchors, [], []),
    ).toThrow(/rhenen.*connected/);
  });
});
