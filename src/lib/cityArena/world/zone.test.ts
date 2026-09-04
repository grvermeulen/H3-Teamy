import { describe, expect, it } from "vitest";
import type { MapIndex, MapLandmark, MapZone } from "./mapTypes";
import {
  distanceToZoneEdge,
  findZone,
  findZoneByKey,
  landmarkCentreMetres,
  pickSpawn,
  zoneCentreMetres,
  zoneRadiusMetres,
} from "./zone";

const wageningen: MapZone = {
  key: "wageningen",
  name: "Wageningen centrum",
  center: [10349, 6683],
  radius: 2000,
  spawnNodes: [
    [10000, 6000],
    [10400, 6800],
  ],
  landmarks: ["grote-kerk-wageningen"],
};
const groteKerk: MapLandmark = {
  key: "grote-kerk-wageningen",
  name: "Grote Kerk",
  style: "church",
  center: [10349, 6683],
  tile: { x: 1, y: 1 },
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [wageningen],
  landmarks: [],
};

describe("zone helpers", () => {
  it("converts centre and radius to metres", () => {
    expect(zoneCentreMetres(wageningen)).toEqual([2587.25, 1670.75]);
    expect(zoneRadiusMetres(wageningen)).toBe(500);
  });

  it("converts a landmark centre to metres", () => {
    expect(landmarkCentreMetres(groteKerk)).toEqual([2587.25, 1670.75]);
  });

  it("finds the zone containing a point and signs the edge distance", () => {
    expect(findZone(index, [2600, 1700])?.key).toBe("wageningen");
    expect(findZone(index, [4000, 1700])).toBeNull();
    expect(distanceToZoneEdge(wageningen, [2587.25, 1670.75])).toBe(-500);
    expect(distanceToZoneEdge(wageningen, [3687.25, 1670.75])).toBe(600);
    expect(findZoneByKey(index, "rhenen")).toBeNull();
  });

  it("returns null when the index has no zones", () => {
    expect(findZone({ ...index, zones: [] }, [0, 0])).toBeNull();
  });

  it("picks a spawn node deterministically and falls back to the centre", () => {
    expect(pickSpawn(wageningen, () => 0)).toEqual([2500, 1500]);
    expect(pickSpawn(wageningen, () => 0.999)).toEqual([2600, 1700]);
    expect(pickSpawn({ ...wageningen, spawnNodes: [] }, () => 0.5)).toEqual([
      2587.25, 1670.75,
    ]);
  });
});
