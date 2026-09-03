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
