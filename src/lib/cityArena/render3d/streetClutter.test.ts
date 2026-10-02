import { describe, expect, it } from "vitest";
import {
  Box3,
  Color,
  Matrix4,
  MeshLambertMaterial,
  Vector3,
  type BufferAttribute,
} from "three";
import { distancePointToSegment, pointInPolygon } from "../mapBuild/geometry";
import type { RoadClass } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { buildBuildingGeometry } from "./buildingMesh";
import { createCellContext } from "./cellContext";
import { bikeGeometry, buildBikes } from "./clutterShapes";
import { createDetailBuffers } from "./detailBuffers";
import { planBuilding } from "./facadePlan";
import { MAX_CLUTTER_PER_CELL, pushStreetClutter } from "./streetClutter";
import { sideBands, signSites, zebraSites } from "./streetMarkings";
import { FIXTURE_TILE_RECT, fixtureTile } from "./testing/cityFixture";

/** A rectangle footprint from (x, y), `width` along x and `depth` along y. */
function rect(x: number, y: number, width: number, depth: number): Point[] {
  return [
    [x, y],
    [x + width, y],
    [x + width, y + depth],
    [x, y + depth],
  ];
}

/**
 * A street along y = 0 with a side road at x = 0 going north, shops along its south side, houses
 * with front gardens along its north side, and a block of flats.
 */
function town(roadClass: RoadClass = "primary") {
  const houses = Array.from({ length: 8 }, (_, index) => ({
    ring: rect(-100 + index * 11, 12, 9, 10),
    levels: 2,
  }));
  const shops = Array.from({ length: 10 }, (_, index) => ({
    ring: rect(-110 + index * 11, -18, 10, 10),
    levels: 2,
  }));
  const tile = fixtureTile(
    { x: 0, y: 0, rect: FIXTURE_TILE_RECT },
    {
      roads: [
        {
          points: [
            [-200, 0],
            [0, 0],
            [200, 0],
          ],
          roadClass,
        },
        {
          points: [
            [0, 0],
            [0, 120],
          ],
          roadClass: "residential",
        },
      ],
      buildings: [
        ...houses,
        ...shops,
        { ring: rect(20, 14, 30, 16), levels: 5 },
      ],
    },
  );
  const bounds = { minX: -128, minY: -64, maxX: 128, maxY: 64 };
  const context = createCellContext(bounds, [tile], new Set());
  return { tile, context };
}

/** Lays out a town's buildings in detail and dresses its streets. */
function dress(built: ReturnType<typeof town>) {
  const detail = createDetailBuffers();
  const { laid } = buildBuildingGeometry(built.tile.buildings, new Set(), {
    plan: (building) => planBuilding(building, built.context),
    detail: createDetailBuffers(),
  });
  const result = pushStreetClutter(detail, {
    context: built.context,
    buildings: laid,
    zebras: zebraSites(built.context.roads),
    signs: signSites(built.context.roads),
    owns: () => true,
    ground: 0.015,
    origin: [0, 0],
  });
  return { ...result, detail };
}

describe("pushStreetClutter", () => {
  it("dresses the street: bike racks at the shops, and more pieces round the houses and crossings", () => {
    const { count, bikes, spots } = dress(town());

    expect(bikes.filter((bike) => bike.at[1] < 0).length).toBeGreaterThan(2);
    expect(count).toBeGreaterThan(bikes.length);
    expect(spots.length).toBeGreaterThanOrEqual(count);
  });

  it("puts nothing on a carriageway, a cycle path or inside a building", () => {
    const built = town();
    const { spots } = dress(built);

    for (const spot of spots) {
      for (const road of built.tile.roads) {
        const bands = sideBands(road.roadClass);
        for (let index = 0; index + 1 < road.points.length; index++) {
          const distance = distancePointToSegment(
            spot,
            road.points[index],
            road.points[index + 1],
          );
          expect(distance).toBeGreaterThan(bands.edge + bands.cycle);
        }
      }
      for (const building of built.tile.buildings)
        expect(pointInPolygon(spot, building.ring)).toBe(false);
    }
  });

  it("stops at the cap however much the street offers", () => {
    const built = town("secondary");
    const many = {
      ...built,
      tile: { ...built.tile, buildings: [...built.tile.buildings] },
    };
    for (let copy = 0; copy < 6; copy++)
      many.tile.buildings.push(...built.tile.buildings);

    const { count } = dress(many);

    expect(count).toBeLessThanOrEqual(MAX_CLUTTER_PER_CELL);
  });

  it("dresses the same street every time", () => {
    const first = dress(town());
    const second = dress(town());

    expect(second.spots).toEqual(first.spots);
    expect(second.bikes).toEqual(first.bikes);
    expect(second.detail).toEqual(first.detail);
  });
});

describe("signSites", () => {
  it("signs side roads where they meet a bigger road, facing the drivers they speak to", () => {
    const { context } = town();

    const sites = signSites(context.roads);

    const giveWay = sites.filter((site) => site.kind === "giveWay");
    const zone = sites.filter((site) => site.kind === "zone");
    expect(giveWay.length).toBeGreaterThan(0);
    for (const site of giveWay) {
      expect(site.at[1]).toBeGreaterThan(0);
      expect(site.facing[1]).toBeCloseTo(1);
    }
    for (const site of zone) expect(site.facing[1]).toBeCloseTo(-1);
  });
});

/** The vertex-coloured material the bikes draw with. */
const DETAIL = new MeshLambertMaterial({ vertexColors: true });

describe("buildBikes", () => {
  it("stands each bike at its spot, front wheel along its direction, in its colour", () => {
    const bikes = [
      { at: [10, 20] as Point, direction: [1, 0] as Point, colour: 0x7a1f1f },
      { at: [30, 40] as Point, direction: [0, 1] as Point, colour: 0x23365c },
    ];

    const mesh = buildBikes(bikes, DETAIL, { ground: 0.015, origin: [0, 0] });

    expect(mesh?.count).toBe(2);
    const matrix = new Matrix4();
    mesh!.getMatrixAt(1, matrix);
    const front = new Vector3(1, 0, 0)
      .applyMatrix4(matrix)
      .sub(new Vector3().setFromMatrixPosition(matrix));
    expect(front.x).toBeCloseTo(0);
    expect(front.z).toBeCloseTo(1);
    const colour = new Color();
    mesh!.getColorAt(0, colour);
    expect(colour.getHex()).toBe(0x7a1f1f);
    expect(buildBikes([], DETAIL, { ground: 0, origin: [0, 0] })).toBeNull();
  });

  it("builds a bicycle the size of one", () => {
    const geometry = bikeGeometry();
    geometry.computeBoundingBox();
    const size = (geometry.boundingBox as Box3).getSize(new Vector3());
    const colours = geometry.getAttribute("color") as BufferAttribute;

    expect(size.x).toBeGreaterThan(1.6);
    expect(size.x).toBeLessThan(1.9);
    expect(size.y).toBeGreaterThan(0.9);
    expect(size.y).toBeLessThan(1.15);
    expect(Array.from(colours.array).some((channel) => channel === 1)).toBe(
      true,
    );
  });
});
