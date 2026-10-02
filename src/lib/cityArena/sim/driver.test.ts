import { describe, expect, it } from "vitest";
import {
  desiredSpeed,
  driveControls,
  headingError,
  laneOffsetM,
  laneTarget,
  obstacleAhead,
  throttleFor,
  wrapAngle,
} from "./driver";
import { createVehicle } from "./vehicle";

const graph = {
  nodes: [[0, 0] as [number, number], [100, 0] as [number, number]],
};
const eastbound = createVehicle(1, "sedan", [0, 0], 0, 0);

describe("driver control law", () => {
  it("keeps the right lane clear of oncoming traffic", () => {
    expect(laneOffsetM("residential")).toBeCloseTo(1.7);
    expect(laneOffsetM("tertiary")).toBeCloseTo(1.75);
    expect(laneOffsetM("primary")).toBeCloseTo(2.25);
    expect(laneTarget(graph, 0, 1, 1.7)).toEqual([100, 1.7]);
    expect(laneTarget(graph, 1, 0, 1.7)[1]).toBeCloseTo(-1.7);
  });

  it("wraps heading errors and detects obstacles in the front box", () => {
    expect(wrapAngle(4)).toBeCloseTo(4 - 2 * Math.PI);
    expect(headingError(eastbound, [10, 10])).toBeCloseTo(Math.PI / 4);
    expect(obstacleAhead(eastbound, [[5, 0]], 10, 2.2)).toBe(true);
    expect(obstacleAhead(eastbound, [[1, 0]], 10, 2.2)).toBe(false);
    expect(obstacleAhead(eastbound, [[6, 2.5]], 10, 2.2)).toBe(false);
  });

  it("slows for turns, stops when blocked and maps speed gaps to controls", () => {
    expect(desiredSpeed(0, 10, false)).toBe(10);
    expect(desiredSpeed(Math.PI / 3, 10, false)).toBe(5);
    expect(desiredSpeed(0, 10, true)).toBe(0);
    expect(throttleFor(0, 10)).toBe(1);
    expect(throttleFor(9, 10)).toBeCloseTo(1 / 3);
    expect(throttleFor(12, 10)).toBe(-1);
    expect(throttleFor(0.2, 0)).toBe(0);
    expect(driveControls(eastbound, [10, 10], 10, false)).toEqual({
      throttle: 1,
      steer: 1,
    });
  });
});
