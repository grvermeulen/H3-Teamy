import { describe, expect, it } from "vitest";
import type { LandmarkConfig } from "./landmarks.config";
import { LANDMARKS } from "./landmarks.config";
import { elementCenter, elementFootprint, matchLandmarks } from "./landmarks";
import type {
  OverpassJson,
  OverpassNode,
  OverpassRelation,
  OverpassWay,
} from "./osmTypes";
import { indexNodes, indexWays } from "./osmTypes";

const worship: LandmarkConfig = {
  key: "test-kerk",
  name: "Testkerk",
  nameMatch: "kerk",
  style: "church",
  matchesTags: (tags) => tags.amenity === "place_of_worship",
};

function squareWay(
  id: number,
  lat: number,
  lon: number,
  tags: Record<string, string>,
): OverpassJson["elements"] {
  const half = 0.0002;
  const base = id * 10;
  return [
    { type: "node", id: base + 1, lat: lat - half, lon: lon - half },
    { type: "node", id: base + 2, lat: lat - half, lon: lon + half },
    { type: "node", id: base + 3, lat: lat + half, lon: lon + half },
    { type: "node", id: base + 4, lat: lat + half, lon: lon - half },
    {
      type: "way",
      id,
      nodes: [base + 1, base + 2, base + 3, base + 4, base + 1],
      tags,
    },
  ];
}

describe("matchLandmarks", () => {
  it("matches exactly one element case-insensitively and returns its centre", () => {
    const json: OverpassJson = {
      elements: [
        ...squareWay(1, 51.97, 5.66, {
          amenity: "place_of_worship",
          name: "Grote KERK",
        }),
        ...squareWay(2, 51.97, 5.67, { building: "yes", name: "Kerkstraat 1" }),
      ],
    };
    const result = matchLandmarks(json, [worship]);
    expect(result.errors).toEqual([]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].element.id).toBe(1);
    expect(result.matched[0].center.lat).toBeCloseTo(51.97, 5);
    expect(result.matched[0].center.lon).toBeCloseTo(5.66, 5);
  });

  it("reports zero matches as an error naming the key", () => {
    const result = matchLandmarks({ elements: [] }, [worship]);
    expect(result.matched).toEqual([]);
    expect(result.errors[0]).toContain("test-kerk");
    expect(result.errors[0]).toContain("no match");
  });

  it("reports ambiguous matches with candidate ids and names", () => {
    const json: OverpassJson = {
      elements: [
        ...squareWay(1, 51.97, 5.66, {
          amenity: "place_of_worship",
          name: "Oude Kerk",
        }),
        ...squareWay(2, 51.99, 5.67, {
          amenity: "place_of_worship",
          name: "Nieuwe Kerk",
        }),
      ],
    };
    const result = matchLandmarks(json, [worship]);
    expect(result.matched).toEqual([]);
    expect(result.errors[0]).toContain("way/1");
    expect(result.errors[0]).toContain("Nieuwe Kerk");
  });

  it("disambiguates with osmId and with a near filter", () => {
    const json: OverpassJson = {
      elements: [
        ...squareWay(1, 51.97, 5.66, {
          amenity: "place_of_worship",
          name: "Oude Kerk",
        }),
        ...squareWay(2, 51.99, 5.67, {
          amenity: "place_of_worship",
          name: "Nieuwe Kerk",
        }),
      ],
    };
    const byId = matchLandmarks(json, [{ ...worship, osmId: "way/2" }]);
    expect(byId.matched[0].element.id).toBe(2);
    const byNear = matchLandmarks(json, [
      { ...worship, near: { lat: 51.97, lon: 5.66, radiusM: 800 } },
    ]);
    expect(byNear.matched[0].element.id).toBe(1);
  });

  it("computes centres for nodes, ways and relations", () => {
    const json: OverpassJson = {
      elements: [
        { type: "node", id: 9, lat: 51.5, lon: 5.5, tags: { amenity: "cafe" } },
        ...squareWay(1, 51.97, 5.66, { building: "yes" }),
        {
          type: "relation",
          id: 3,
          members: [{ type: "way", ref: 1, role: "outer" }],
          tags: {},
        },
      ],
    };
    const nodes = indexNodes(json);
    const ways = indexWays(json);
    expect(elementCenter(json.elements[0], nodes, ways)).toEqual({
      lat: 51.5,
      lon: 5.5,
    });
    const wayCenter = elementCenter(json.elements[5], nodes, ways);
    expect(wayCenter?.lat).toBeCloseTo(51.97, 5);
    const relationCenter = elementCenter(json.elements[6], nodes, ways);
    expect(relationCenter?.lon).toBeCloseTo(5.66, 5);
  });
});

describe("elementFootprint", () => {
  it("returns a closed way's ring with the closing node removed", () => {
    const elements = squareWay(1, 51.97, 5.66, { building: "yes" });
    const nodes = indexNodes({ elements });
    const ways = indexWays({ elements });
    const footprint = elementFootprint(ways.get(1)!, nodes, ways);
    expect(footprint).toHaveLength(4);
  });

  it("returns null for an open way", () => {
    const openWay: OverpassWay = { type: "way", id: 2, nodes: [11, 12, 13] };
    const nodes = new Map<number, OverpassNode>([
      [11, { type: "node", id: 11, lat: 51.97, lon: 5.66 }],
      [12, { type: "node", id: 12, lat: 51.971, lon: 5.66 }],
      [13, { type: "node", id: 13, lat: 51.971, lon: 5.661 }],
    ]);
    expect(elementFootprint(openWay, nodes, new Map())).toBeNull();
  });

  it("returns null for a node", () => {
    const node: OverpassNode = { type: "node", id: 9, lat: 51.5, lon: 5.5 };
    expect(elementFootprint(node, new Map(), new Map())).toBeNull();
  });

  it("returns the first outer member way's footprint for a relation", () => {
    const elements = squareWay(1, 51.97, 5.66, { building: "yes" });
    const nodes = indexNodes({ elements });
    const ways = indexWays({ elements });
    const relation: OverpassRelation = {
      type: "relation",
      id: 5,
      members: [{ type: "way", ref: 1, role: "outer" }],
      tags: { type: "multipolygon" },
    };
    expect(elementFootprint(relation, nodes, ways)).toHaveLength(4);
  });

  it("returns null for a relation with no outer member", () => {
    const relation: OverpassRelation = {
      type: "relation",
      id: 6,
      members: [{ type: "way", ref: 999, role: "part" }],
      tags: { type: "building" },
    };
    expect(elementFootprint(relation, new Map(), new Map())).toBeNull();
  });
});

describe("ten configured landmarks", () => {
  it("ships the ten configured landmarks with four zone anchors", () => {
    expect(LANDMARKS).toHaveLength(10);
    const anchors = LANDMARKS.filter((landmark) => landmark.zoneAnchor).map(
      (landmark) => landmark.zoneAnchor,
    );
    expect(anchors.sort()).toEqual([
      "bennekom",
      "campus",
      "rhenen",
      "wageningen",
    ]);
  });
});
