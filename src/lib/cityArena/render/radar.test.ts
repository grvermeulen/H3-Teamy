import { describe, expect, it } from "vitest";
import {
  createRadarRoadIndex,
  drawRadar,
  nearbyRadarRoads,
  radarRoads,
  RADAR_RANGE_M,
} from "./radar";
import { RADAR_BACKGROUND, RADAR_PLAYER } from "./palette";
import { createFakeContext } from "./testing/fakeContext";

describe("radar", () => {
  it("decodes and culls road segments to the requested range", () => {
    const roads = {
      nodes: [0, 0, 400, 0, 1200, 0, 2000, 0],
      edges: [0, 1, 0, -1, 0, 400, 2, 3, 0, -1, 0, 800],
      classes: ["tertiary" as const],
      names: [],
    };
    expect(radarRoads(roads, [0, 0], RADAR_RANGE_M)).toEqual([
      [
        [0, 0],
        [100, 0],
      ],
    ]);
  });

  it("uses a spatial index to return only nearby graph segments", () => {
    const index = createRadarRoadIndex(
      [
        [0, 0],
        [100, 0],
        [1000, 0],
        [1100, 0],
      ],
      [
        { a: 0, b: 1 },
        { a: 2, b: 3 },
      ],
    );
    expect(nearbyRadarRoads(index, [0, 0], 150)).toEqual([
      [
        [0, 0],
        [100, 0],
      ],
    ]);
  });

  it("draws dark background, roads, zone, pickups, police and player in order", () => {
    const context = createFakeContext();
    drawRadar(
      context,
      {
        player: [0, 0],
        roads: [
          [
            [0, 0],
            [10, 0],
          ],
        ],
        pickups: [{ point: [5, 0], kind: "health" }],
        police: [[-5, 0]],
        tanks: [],
        zoneCentre: [0, 0],
        zoneRadiusM: 20,
      },
      90,
    );
    expect(context.calls[0]).toBe("save()");
    expect(context.calls).toContain(`fill(${RADAR_BACKGROUND})`);
    const playerFill = context.calls.lastIndexOf(`fill(${RADAR_PLAYER})`);
    expect(playerFill).toBeGreaterThan(
      context.calls.indexOf("stroke(#60a5fa,1.5)"),
    );
    expect(context.calls[context.calls.length - 1]).toBe("restore()");
  });
});
