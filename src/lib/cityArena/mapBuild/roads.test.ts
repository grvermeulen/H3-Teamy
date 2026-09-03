import { describe, expect, it } from "vitest";
import { ROAD_EDGE_STRIDE } from "../world/mapTypes";
import type { Point } from "../world/projection";
import type { OverpassJson } from "./osmTypes";
import {
  buildRoadGraph,
  encodeRoads,
  parseRoadWays,
  projectNodeCoordinates,
  renderRoads,
  roadClassOf,
} from "./roads";

const junctionJson: OverpassJson = {
  elements: [
    { type: "node", id: 1, lat: 51.98, lon: 5.625 },
    { type: "node", id: 2, lat: 51.98, lon: 5.626 },
    { type: "node", id: 3, lat: 51.98, lon: 5.627 },
    { type: "node", id: 4, lat: 51.981, lon: 5.626 },
    {
      type: "way",
      id: 10,
      nodes: [1, 2, 3],
      tags: { highway: "residential", name: "Dorpsstraat" },
    },
    {
      type: "way",
      id: 11,
      nodes: [2, 4],
      tags: { highway: "tertiary_link", oneway: "yes" },
    },
    { type: "way", id: 12, nodes: [3, 4], tags: { highway: "footway" } },
  ],
};

describe("roadClassOf", () => {
  it("collapses link roads and rejects non-drivable classes", () => {
    expect(roadClassOf({ highway: "primary_link" })).toBe("primary");
    expect(roadClassOf({ highway: "residential" })).toBe("residential");
    expect(roadClassOf({ highway: "footway" })).toBeNull();
    expect(roadClassOf({})).toBeNull();
  });
});

describe("parseRoadWays", () => {
  it("keeps drivable ways with class, name and oneway", () => {
    const ways = parseRoadWays(junctionJson);
    expect(ways.map((way) => way.id)).toEqual([10, 11]);
    expect(ways[0]).toMatchObject({
      roadClass: "residential",
      name: "Dorpsstraat",
      oneway: false,
    });
    expect(ways[1]).toMatchObject({ roadClass: "tertiary", oneway: true });
  });

  it("reverses node order for oneway=-1", () => {
    const json: OverpassJson = {
      elements: [
        {
          type: "way",
          id: 1,
          nodes: [1, 2, 3],
          tags: { highway: "residential", oneway: "-1" },
        },
      ],
    };
    expect(parseRoadWays(json)[0]).toMatchObject({
      nodeIds: [3, 2, 1],
      oneway: true,
    });
  });
});

describe("buildRoadGraph", () => {
  it("creates vertices at endpoints and junctions with one edge per span", () => {
    const coords = projectNodeCoordinates(junctionJson);
    const graph = buildRoadGraph(parseRoadWays(junctionJson), coords);
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(3);
    const lengths = graph.edges.map((edge) => Math.round(edge.length));
    expect(lengths[0]).toBe(69);
    expect(graph.edges[2]).toMatchObject({
      roadClass: "tertiary",
      oneway: true,
    });
  });

  it("inserts shape vertices every twenty metres along long straight ways", () => {
    const coords = new Map<number, Point>();
    const nodeIds: number[] = [];
    for (let index = 0; index <= 20; index++) {
      coords.set(index, [index * 5, 0]);
      nodeIds.push(index);
    }
    const graph = buildRoadGraph(
      [{ id: 1, roadClass: "residential", oneway: false, nodeIds }],
      coords,
    );
    expect(graph.nodes).toHaveLength(6);
    expect(graph.edges).toHaveLength(5);
    expect(graph.edges.every((edge) => Math.abs(edge.length - 20) < 1e-9)).toBe(
      true,
    );
  });
});

describe("renderRoads and encodeRoads", () => {
  it("simplifies render geometry and keeps class and name", () => {
    const coords = projectNodeCoordinates(junctionJson);
    const rendered = renderRoads(parseRoadWays(junctionJson), coords);
    expect(rendered).toHaveLength(2);
    expect(rendered[0].points).toHaveLength(2);
    expect(rendered[0].name).toBe("Dorpsstraat");
  });

  it("encodes the graph as flat unit arrays with lookup tables", () => {
    const coords = new Map<number, Point>([
      [1, [0, 0]],
      [2, [20, 0]],
    ]);
    const encoded = encodeRoads(
      buildRoadGraph(
        [
          {
            id: 1,
            roadClass: "primary",
            name: "N225",
            oneway: true,
            nodeIds: [1, 2],
          },
        ],
        coords,
      ),
    );
    expect(encoded.nodes).toEqual([0, 0, 80, 0]);
    expect(encoded.edges).toHaveLength(ROAD_EDGE_STRIDE);
    expect(encoded.edges).toEqual([0, 1, 0, 0, 1, 80]);
    expect(encoded.classes).toEqual(["primary"]);
    expect(encoded.names).toEqual(["N225"]);
  });
});
