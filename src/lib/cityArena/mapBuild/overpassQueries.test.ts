import { describe, expect, it } from "vitest";
import {
  BUILDING_RADIUS_M,
  OVERPASS_BBOX,
  buildAreasQuery,
  buildBuildingsQuery,
  buildLandmarkQuery,
  buildRoadsQuery,
} from "./overpassQueries";

describe("overpass query builders", () => {
  it("uses the region bbox in south,west,north,east order", () => {
    expect(OVERPASS_BBOX).toBe("51.94,5.53,52.02,5.72");
  });

  it("builds a case-insensitive name union for landmarks and escapes regex characters", () => {
    const query = buildLandmarkQuery(["Cunera", "'t Gastland (bad)"]);
    expect(query.startsWith("[out:json]")).toBe(true);
    expect(query).toContain(`nwr["name"~"Cunera",i](${OVERPASS_BBOX});`);
    expect(query).toContain(
      `nwr["name"~"'t Gastland \\\\(bad\\\\)",i](${OVERPASS_BBOX});`,
    );
    expect(query.trim().endsWith("out skel qt;")).toBe(true);
  });

  it("builds the roads query with drivable classes and service roads around each centre", () => {
    const query = buildRoadsQuery([
      { lat: 51.96, lon: 5.57 },
      { lat: 51.97, lon: 5.66 },
    ]);
    expect(query).toContain('way["highway"~"^(motorway|trunk|primary|');
    expect(query).toContain("living_street|pedestrian|motorway_link");
    expect(query.match(/\["highway"="service"\]\(around:500,/g)).toHaveLength(
      2,
    );
    expect(query).toContain("(around:500,51.96,5.57)");
  });

  it("builds the areas query for water and ground polygons only", () => {
    const query = buildAreasQuery();
    expect(query).toContain('nwr["natural"="water"]');
    expect(query).toContain(
      `nwr["landuse"~"^(reservoir|basin)$"](${OVERPASS_BBOX});`,
    );
    expect(query).toContain(
      'nwr["landuse"~"^(grass|meadow|farmland|forest)$"]',
    );
    expect(query).toContain('nwr["leisure"~"^(park|pitch)$"]');
    expect(query).toContain('nwr["natural"~"^(wood|scrub)$"]');
    expect(query).not.toContain("residential");
  });

  it("builds the buildings query around centres plus explicit landmark elements", () => {
    const query = buildBuildingsQuery(
      [{ lat: 51.96, lon: 5.57 }],
      ["way/123", "way/456", "relation/7"],
    );
    expect(query).toContain(
      `nwr["building"](around:${BUILDING_RADIUS_M},51.96,5.57);`,
    );
    expect(query).toContain("way(id:123,456);");
    expect(query).toContain("relation(id:7);");
    expect(query).not.toContain("node(id:");
  });
});
