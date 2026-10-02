import { describe, expect, it } from "vitest";
import type { RailPosition } from "../sim/types";
import type { MapRoads } from "./mapTypes";
import {
  advanceRail,
  edgeLengthM,
  isPavementEdge,
  kerbOffsetM,
  nearestRail,
  nextPavementEdge,
  pavementEdgesWithin,
  pavementOffsetM,
  railHeading,
  railPoint,
  randomRail,
} from "./pavements";
import { decodeRoadGraph } from "./roadGraph";

const square: MapRoads = {
  nodes: [0, 0, 400, 0, 400, 400, 0, 400, 800, 0],
  edges: [
    0, 1, 0, -1, 0, 400, 1, 2, 0, -1, 0, 400, 2, 3, 0, -1, 0, 400, 3, 0, 0, -1,
    0, 400, 1, 4, 1, -1, 0, 400,
  ],
  classes: ["residential", "service"],
  names: [],
};
const graph = decodeRoadGraph(square);
const single = decodeRoadGraph({
  nodes: [0, 0, 400, 0],
  edges: [0, 1, 0, -1, 0, 400],
  classes: ["residential"],
  names: [],
});
const east: RailPosition = { edge: 0, direction: 1, edgeT: 0.25, side: 1 };

describe("pavement offsets", () => {
  it("derives pavement and kerb offsets from renderer widths", () => {
    expect(pavementOffsetM("residential")).toBe(4);
    expect(pavementOffsetM("living_street")).toBe(3.5);
    expect(pavementOffsetM("primary")).toBe(5.5);
    expect(kerbOffsetM("residential")).toBeCloseTo(3.3);
    expect(kerbOffsetM("service")).toBeCloseTo(2.3);
    expect(isPavementEdge(graph.edges[0])).toBe(true);
    expect(isPavementEdge(graph.edges[4])).toBe(false);
    expect(edgeLengthM(graph, 1)).toBe(100);
  });
});

describe("rails", () => {
  it("places a rail on the right or left pavement", () => {
    expect(railPoint(graph, east, 4)).toEqual([25, 4]);
    expect(railPoint(graph, { ...east, side: -1 }, 4)).toEqual([25, -4]);
    const west = railPoint(graph, { ...east, direction: -1 }, 4);
    expect(west[0]).toBeCloseTo(75);
    expect(west[1]).toBeCloseTo(-4);
    expect(railHeading(graph, east)).toBe(0);
    expect(railHeading(graph, { ...east, direction: -1 })).toBeCloseTo(Math.PI);
  });

  it("advances along an edge and turns at a node", () => {
    const walked = advanceRail(graph, east, 30, () => 0);
    expect(walked).toMatchObject({ edge: 0, direction: 1, side: 1 });
    expect(walked.edgeT).toBeCloseTo(0.55);
    const turned = advanceRail(graph, east, 80, () => 0);
    expect(turned).toMatchObject({ edge: 1, direction: 1, side: 1 });
    expect(turned.edgeT).toBeCloseTo(0.05);
  });

  it("turns around at a dead end and picks seeded next edges", () => {
    const nearEnd: RailPosition = {
      edge: 0,
      direction: 1,
      edgeT: 0.9,
      side: 1,
    };
    const back = advanceRail(single, nearEnd, 20, () => 0);
    expect(back).toMatchObject({ edge: 0, direction: -1, side: 1 });
    expect(back.edgeT).toBeCloseTo(0.1);
    expect(nextPavementEdge(graph, 1, 0, () => 0)).toBe(1);
    expect(nextPavementEdge(graph, 0, 0, () => 0.99)).toBe(3);
    expect(nextPavementEdge(single, 1, 0, () => 0)).toBe(0);
    expect(nextPavementEdge(graph, 4, 4, () => 0)).toBeNull();
  });

  it("lists nearby edges and creates deterministic rails", () => {
    expect(pavementEdgesWithin(graph, [50, 50], 60)).toEqual([0, 1, 2, 3]);
    expect(pavementEdgesWithin(graph, [50, 50], 40)).toEqual([]);
    expect(randomRail(graph, [0, 1, 2, 3], () => 0.5)).toEqual({
      edge: 2,
      direction: 1,
      edgeT: 0.5,
      side: 1,
    });
  });

  it("projects a point onto the nearest pavement edge", () => {
    const eastbound = nearestRail(graph, [30, 6], 60, () => 0.9);
    expect(eastbound).toMatchObject({ edge: 0, direction: 1, side: 1 });
    expect(eastbound?.edgeT).toBeCloseTo(0.3);
    const westbound = nearestRail(graph, [30, 6], 60, () => 0);
    expect(westbound).toMatchObject({ edge: 0, direction: -1, side: -1 });
    expect(westbound?.edgeT).toBeCloseTo(0.7);
    expect(nearestRail(graph, [500, 500], 60, () => 0)).toBeNull();
    expect(nearestRail(graph, [200, 1], 60, () => 0)).toBeNull();
  });
});
