import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import {
  boundsOf,
  distance,
  distancePointToPolygon,
  distancePointToSegment,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  clipPolygonToRect,
  clipPolylineToRect,
  rectsIntersect,
  simplifyPolyline,
  simplifyRing,
} from "./geometry";

const unitSquare: Point[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

describe("geometry primitives", () => {
  it("computes area regardless of winding", () => {
    expect(polygonArea(unitSquare)).toBe(1);
    expect(polygonArea([...unitSquare].reverse())).toBe(1);
  });

  it("computes the centroid of a square", () => {
    const [x, y] = polygonCentroid(unitSquare);
    expect(x).toBeCloseTo(0.5);
    expect(y).toBeCloseTo(0.5);
  });

  it("falls back to the vertex average for a degenerate polygon", () => {
    const [x, y] = polygonCentroid([
      [0, 0],
      [2, 0],
      [4, 0],
    ]);
    expect(x).toBe(2);
    expect(y).toBe(0);
  });

  it("tests point containment", () => {
    expect(pointInPolygon([0.5, 0.5], unitSquare)).toBe(true);
    expect(pointInPolygon([2, 2], unitSquare)).toBe(false);
  });

  it("measures distance to a segment including beyond its ends", () => {
    expect(distancePointToSegment([0, 4], [-1, 0], [1, 0])).toBe(4);
    expect(distancePointToSegment([5, 0], [0, 0], [1, 0])).toBe(4);
    expect(distancePointToSegment([3, 4], [0, 0], [0, 0])).toBe(5);
  });

  it("measures distance to a polygon (zero inside)", () => {
    expect(distancePointToPolygon([0.5, 0.5], unitSquare)).toBe(0);
    expect(distancePointToPolygon([2, 0.5], unitSquare)).toBe(1);
  });

  it("computes bounds and euclidean distance", () => {
    expect(boundsOf(unitSquare)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
    });
    expect(distance([0, 0], [3, 4])).toBe(5);
  });
});

describe("simplification and clipping", () => {
  it("collapses a nearly straight line to its endpoints", () => {
    const wobbly: Point[] = [
      [0, 0],
      [1, 0.001],
      [2, -0.002],
      [3, 0],
    ];
    expect(simplifyPolyline(wobbly, 0.5)).toEqual([
      [0, 0],
      [3, 0],
    ]);
  });

  it("keeps a corner that exceeds the tolerance", () => {
    const corner: Point[] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    expect(simplifyPolyline(corner, 0.5)).toEqual(corner);
  });

  it("simplifies a ring but never below three points", () => {
    const ring: Point[] = [
      [0, 0],
      [5, 0.01],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(simplifyRing(ring, 0.5)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const triangle: Point[] = [
      [0, 0],
      [1, 0],
      [0, 1],
    ];
    expect(simplifyRing(triangle, 100)).toEqual(triangle);
  });

  it("clips a polygon to a rectangle", () => {
    const square: Point[] = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ];
    const clipped = clipPolygonToRect(square, {
      minX: 1,
      minY: -1,
      maxX: 3,
      maxY: 3,
    });
    expect(polygonArea(clipped)).toBeCloseTo(2);
    expect(
      clipPolygonToRect(square, { minX: 5, minY: 5, maxX: 6, maxY: 6 }),
    ).toEqual([]);
  });

  it("clips a polyline into pieces", () => {
    const rect = { minX: 0, minY: 0, maxX: 2, maxY: 1 };
    expect(
      clipPolylineToRect(
        [
          [-1, 0.5],
          [3, 0.5],
        ],
        rect,
      ),
    ).toEqual([
      [
        [0, 0.5],
        [2, 0.5],
      ],
    ]);
    const twoPasses: Point[] = [
      [-1, 0.5],
      [1, 0.5],
      [1, 5],
      [1.5, 5],
      [1.5, 0.5],
      [3, 0.5],
    ];
    expect(clipPolylineToRect(twoPasses, rect)).toHaveLength(2);
    expect(
      clipPolylineToRect(
        [
          [5, 5],
          [6, 6],
        ],
        rect,
      ),
    ).toEqual([]);
  });

  it("detects rectangle overlap", () => {
    expect(
      rectsIntersect(
        { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        { minX: 1, minY: 1, maxX: 2, maxY: 2 },
      ),
    ).toBe(true);
    expect(
      rectsIntersect(
        { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        { minX: 2, minY: 2, maxX: 3, maxY: 3 },
      ),
    ).toBe(false);
  });
});
