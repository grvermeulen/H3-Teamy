import { describe, expect, it } from "vitest";
import { resolveMissionAnchor, type MissionAnchorDefinition } from "./anchors";
import type { MapIndex } from "../world/mapTypes";
import type { RoadGraph } from "../world/roadGraph";

const definition: MissionAnchorDefinition = {
  id: "noor",
  zone: "rhenen",
  landmark: "gastland",
  offset: [0, 0],
  mode: "foot",
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-18T12:00:00",
  origin: { lat: 52, lon: 5 },
  unitsPerMetre: 4,
  bounds: { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 },
  tileSize: 8000,
  tiles: [],
  zones: [
    {
      key: "rhenen",
      name: "Rhenen",
      center: [0, 0],
      radius: 400,
      spawnNodes: [[0, 0]],
      landmarks: ["gastland"],
    },
  ],
  landmarks: [
    {
      key: "gastland",
      name: "Gastland",
      style: "pool",
      center: [40, 0],
      tile: { x: 0, y: 0 },
    },
  ],
};
const graph: RoadGraph = {
  nodes: [
    [0, 0],
    [50, 0],
  ],
  edges: [{ a: 0, b: 1, roadClass: "residential", oneway: false, length: 50 }],
  adjacency: [[0], [0]],
  nearestNode: () => 0,
};
const clear = {
  resolveCircle: (point: [number, number]) => point,
  query: () => [],
};

describe("mission anchor placement", () => {
  it("places a street contact on reachable pavement beside its landmark", () => {
    const anchor = resolveMissionAnchor(definition, index, graph, clear);
    expect(anchor.position[0]).toBe(10);
    expect(Math.abs(anchor.position[1])).toBeGreaterThan(2);
    expect(anchor.roadNode).toBe(0);
  });
  it("rejects missing landmarks, blocked pavement and out-of-zone destinations", () => {
    expect(() =>
      resolveMissionAnchor(
        { ...definition, landmark: "missing" },
        index,
        graph,
        clear,
      ),
    ).toThrow("locatie of zone ontbreekt");
    expect(() =>
      resolveMissionAnchor(definition, index, graph, {
        ...clear,
        resolveCircle: ([x, y]) => [x + 2, y],
      }),
    ).toThrow("geen bereikbare vrije plek");
    const outside = {
      ...graph,
      nodes: [
        [200, 0],
        [250, 0],
      ] as [number, number][],
    };
    expect(() =>
      resolveMissionAnchor(definition, index, outside, clear),
    ).toThrow("geen bereikbare vrije plek");
  });
  it("refuses an isolated street even when its geometry is clear", () => {
    expect(() =>
      resolveMissionAnchor(
        definition,
        index,
        { ...graph, nearestNode: () => null },
        clear,
      ),
    ).toThrow("geen bereikbare vrije plek");
  });
});
