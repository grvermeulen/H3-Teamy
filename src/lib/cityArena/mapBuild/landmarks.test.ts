import { describe, expect, it } from "vitest";
import type { LandmarkConfig } from "./landmarks.config";
import { LANDMARKS } from "./landmarks.config";
import { elementCenter, matchLandmarks } from "./landmarks";
import type { OverpassJson } from "./osmTypes";
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
