import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import type { VehicleState } from "./types";
import {
  HULL_CIRCLE_OFFSET_M,
  HULL_CIRCLE_RADIUS_M,
  NO_CONTROLS,
  VEHICLE_KINDS,
  VEHICLE_SPECS,
  createVehicle,
  distanceToVehicle,
  forwardSpeed,
  healthMaxOf,
  hullCircles,
  hullLayout,
  localToWorld,
  smokeHealthOf,
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

  it("keeps full authority above 6 m/s, floors the grip while rolling and never pivots parked", () => {
    const compact = createVehicle(1, "compact", [0, 0], 0, 0);
    const fast = stepVehicle(
      { ...compact, velocityX: 6 },
      { throttle: 1, steer: 1 },
      step,
      free,
    ).vehicle;
    expect(fast.heading).toBeCloseTo(0.07445, 4);
    // The grip floor is what this change buys: 0.03913 rad per tick before, 0.05795 after.
    const rolling = stepVehicle(
      { ...compact, velocityX: 3 },
      { throttle: 0, steer: 1 },
      step,
      free,
    ).vehicle;
    expect(rolling.heading).toBeCloseTo(0.05795, 4);
    const creeping = stepVehicle(
      { ...compact, velocityX: 0.4 },
      { throttle: 0, steer: 1 },
      step,
      free,
    ).vehicle;
    expect(creeping.heading).toBe(0);
    const parked = stepVehicle(
      compact,
      { throttle: 0, steer: 1 },
      step,
      free,
    ).vehicle;
    expect(parked.heading).toBe(0);
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

describe("vehicle kinds", () => {
  it("lists ten kinds in wire order, the four originals first", () => {
    expect(VEHICLE_KINDS.slice(0, 4)).toEqual([
      "compact",
      "sedan",
      "sport",
      "police",
    ]);
    expect(VEHICLE_KINDS).toHaveLength(10);
    expect(VEHICLE_KINDS.at(-1)).toBe("tank");
    for (const kind of VEHICLE_KINDS)
      expect(VEHICLE_SPECS[kind].label).toBeTruthy();
  });

  it("keeps the original kinds' hull, and gives a bus six circles along its length", () => {
    const sedan = hullLayout("sedan");
    expect(sedan.offsetsM.map((o) => Math.round(o * 100) / 100)).toEqual([
      HULL_CIRCLE_OFFSET_M,
      -HULL_CIRCLE_OFFSET_M,
    ]);
    expect(sedan.radiusM).toBeCloseTo(HULL_CIRCLE_RADIUS_M);
    const bus = hullLayout("bus");
    expect(bus.offsetsM).toHaveLength(6);
    expect(bus.offsetsM[0]).toBeCloseTo(5);
    expect(bus.offsetsM.at(-1)).toBeCloseTo(-5);
    expect(bus.radiusM).toBeGreaterThan(sedan.radiusM);
    const busCircles = hullCircles(createVehicle(1, "bus", [0, 0], 0, 0));
    expect(busCircles[0]?.[0]).toBeCloseTo(5);
    expect(busCircles[5]?.[0]).toBeCloseTo(-5);
  });

  it("spawns each kind with its own health and smokes at the same share of it", () => {
    expect(createVehicle(1, "bus", [0, 0], 0, 0).health).toBe(220);
    expect(createVehicle(2, "compact", [0, 0], 0, 0).health).toBe(100);
    expect(healthMaxOf("oldtimer")).toBe(70);
    expect(smokeHealthOf("bus")).toBeCloseTo(88);
    expect(smokeHealthOf("sedan")).toBeCloseTo(40);
  });

  it("turns a bus more slowly than a compact at the same speed", () => {
    const controls: VehicleControls = { throttle: 1, steer: 1 };
    const bus = drive(
      { ...createVehicle(1, "bus", [0, 0], 0, 0), velocityX: 8 },
      controls,
      15,
    );
    const compact = drive(
      { ...createVehicle(2, "compact", [0, 0], 0, 0), velocityX: 8 },
      controls,
      15,
    );
    expect(bus.heading).toBeLessThan(compact.heading * 0.75);
  });

  it("measures the body of a long kind from its own corners", () => {
    const bus = createVehicle(1, "bus", [0, 0], 0, 0);
    expect(vehicleCorners(bus)[0]?.[0]).toBeCloseTo(6);
    expect(distanceToVehicle(bus, [8, 0])).toBeCloseTo(2);
  });
});
