import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import type { VehicleState } from "./types";
import {
  HULL_CIRCLE_RADIUS_M,
  NO_CONTROLS,
  createVehicle,
  distanceToVehicle,
  forwardSpeed,
  hullCircles,
  localToWorld,
  stepVehicle,
  vehicleCorners,
  type VehicleControls,
} from "./vehicle";

const free = { resolveCircle: (centre: Point): Point => centre };
const step = 1 / 30;

function drive(
  vehicle: VehicleState,
  controls: VehicleControls,
  ticks: number,
): VehicleState {
  let current = vehicle;
  for (let index = 0; index < ticks; index++)
    current = stepVehicle(current, controls, step, free).vehicle;
  return current;
}

describe("vehicle geometry", () => {
  it("creates a parked car and reads its forward speed", () => {
    const car = createVehicle(1, "compact", [10, 20], 0, 2);
    expect(car).toMatchObject({
      id: 1,
      kind: "compact",
      x: 10,
      y: 20,
      heading: 0,
      velocityX: 0,
      velocityY: 0,
      health: 100,
      wrecked: false,
      colour: 2,
    });
    expect(forwardSpeed({ ...car, velocityX: 3, velocityY: 4 })).toBe(3);
    expect(
      forwardSpeed({
        ...car,
        heading: Math.PI / 2,
        velocityX: 3,
        velocityY: 4,
      }),
    ).toBeCloseTo(4);
  });

  it("rotates local points, corners and hull circles with the heading", () => {
    const car = createVehicle(1, "sedan", [0, 0], Math.PI / 2, 0);
    const [frontLeftX, frontLeftY] = vehicleCorners(car)[0];
    expect(frontLeftX).toBeCloseTo(0.9);
    expect(frontLeftY).toBeCloseTo(2.1);
    expect(localToWorld(car, [1, 0])[1]).toBeCloseTo(1);
    const [front] = hullCircles(car);
    expect(front[0]).toBeCloseTo(0);
    expect(front[1]).toBeCloseTo(1.1);
  });

  it("measures the distance to the body, zero inside", () => {
    const car = createVehicle(1, "sedan", [0, 0], 0, 0);
    expect(distanceToVehicle(car, [5, 0])).toBeCloseTo(2.9);
    expect(distanceToVehicle(car, [0, 0])).toBe(0);
    expect(distanceToVehicle(car, [3, 3])).toBeCloseTo(2.2847, 3);
  });
});

describe("stepVehicle", () => {
  it("accelerates along the heading and caps at the top speed", () => {
    const car = createVehicle(1, "compact", [0, 0], 0, 0);
    const afterSecond = drive(car, { throttle: 1, steer: 0 }, 30);
    expect(afterSecond.velocityX).toBeCloseTo(6);
    expect(afterSecond.x).toBeCloseTo(3.1);
    expect(
      forwardSpeed(drive(car, { throttle: 1, steer: 0 }, 300)),
    ).toBeCloseTo(22);
  });

  it("brakes at 14 m/s², reverses up to 8 m/s and rolls out without throttle", () => {
    const rolling = {
      ...createVehicle(1, "compact", [0, 0], 0, 0),
      velocityX: 10,
    };
    expect(
      forwardSpeed(
        stepVehicle(rolling, { throttle: -1, steer: 0 }, step, free).vehicle,
      ),
    ).toBeCloseTo(9.5333, 3);
    expect(
      forwardSpeed(
        drive(
          createVehicle(1, "compact", [0, 0], 0, 0),
          { throttle: -1, steer: 0 },
          60,
        ),
      ),
    ).toBeCloseTo(-8);
    expect(
      forwardSpeed(stepVehicle(rolling, NO_CONTROLS, step, free).vehicle),
    ).toBeCloseTo(9.9);
  });

  it("turns faster with speed up to 6 m/s and slower again near the top speed", () => {
    const moving = {
      ...createVehicle(1, "compact", [0, 0], 0, 0),
      velocityX: 6,
    };
    const turned = stepVehicle(
      moving,
      { throttle: 1, steer: 1 },
      step,
      free,
    ).vehicle;
    expect(turned.heading).toBeCloseTo(0.07445, 4);
    const crawling = { ...moving, velocityX: 0 };
    expect(
      stepVehicle(crawling, { throttle: 0, steer: 1 }, step, free).vehicle
        .heading,
    ).toBe(0);
  });

  it("bleeds lateral velocity at 90 % per second", () => {
    const sliding = {
      ...createVehicle(1, "sport", [0, 0], 0, 0),
      velocityY: 4,
    };
    const settled = drive(sliding, NO_CONTROLS, 30);
    expect(settled.velocityY).toBeCloseTo(0.4, 2);
    expect(settled.velocityX).toBeCloseTo(0);
  });

  it("pushes out of a wall along the front hull circle, bounces with restitution 0.3 and reports the impact speed", () => {
    const wall = {
      resolveCircle: (centre: Point, radius: number): Point => [
        Math.min(centre[0], 10 - radius),
        centre[1],
      ],
    };
    const fast = { ...createVehicle(1, "sport", [8, 0], 0, 0), velocityX: 30 };
    const result = stepVehicle(fast, NO_CONTROLS, step, wall);
    expect(result.impactSpeed).toBeCloseTo(29.9);
    expect(result.vehicle.x).toBeCloseTo(7.95);
    expect(result.vehicle.velocityX).toBeCloseTo(-8.97);
  });

  it("resolves both hull circles when they need non-parallel push-outs (an inside corner)", () => {
    // Nosed into an inside corner: the front circle (x ≥ 0) overlaps a wall
    // to the south, the rear circle (x < 0) overlaps a different wall to the
    // west. Resolving only the longer of the two pushes would leave the
    // other circle still overlapping its own wall.
    const SOUTH_WALL_Y = 0.75;
    const WEST_WALL_X = -0.35;
    const corner = {
      resolveCircle: (centre: Point, radius: number): Point => {
        const [x, y] = centre;
        return x >= 0
          ? [x, Math.min(y, SOUTH_WALL_Y - radius)]
          : [Math.min(x, WEST_WALL_X - radius), y];
      },
    };
    const nosedIn = createVehicle(1, "sedan", [0, 0], 0, 0);
    const result = stepVehicle(nosedIn, NO_CONTROLS, step, corner);
    expect(result.vehicle.x).toBeCloseTo(-0.2);
    expect(result.vehicle.y).toBeCloseTo(-0.2);
    for (const circle of hullCircles(result.vehicle)) {
      const resolved = corner.resolveCircle(circle, HULL_CIRCLE_RADIUS_M);
      expect(resolved[0]).toBeCloseTo(circle[0]);
      expect(resolved[1]).toBeCloseTo(circle[1]);
    }
  });

  it("ignores the controls of a wreck", () => {
    const wreck = { ...createVehicle(1, "sedan", [0, 0], 0, 0), wrecked: true };
    const still = drive(wreck, { throttle: 1, steer: 1 }, 30);
    expect(still.x).toBe(0);
    expect(still.heading).toBe(0);
  });
});
