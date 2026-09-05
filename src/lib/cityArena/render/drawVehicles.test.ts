import { describe, expect, it } from "vitest";
import { createVehicle } from "../sim/vehicle";
import { createCamera } from "./camera";
import { drawVehicle, drawVehicles } from "./drawVehicles";
import { PLAYER_RING } from "./palette";
import { createFakeContext } from "./testing/fakeContext";

const camera = createCamera([10, 10], 8);
const viewport = { width: 200, height: 100 };

describe("drawVehicles", () => {
  it("draws a rotated body with a window and two headlights", () => {
    const context = createFakeContext();
    const car = createVehicle(1, "sedan", [12, 10], Math.PI / 2, 2);
    drawVehicle(context, camera, viewport, car, 0, false);
    expect(context.calls).toContain("translate(116,50)");
    expect(context.calls).toContain("rotate(1.57)");
    expect(context.calls).toContain("fillRect(-16.8,-7.2,33.6,14.4)");
    expect(
      context.calls.filter((call) => call.startsWith("fillRect")),
    ).toHaveLength(4);
    expect(context.calls[context.calls.length - 1]).toBe("restore()");
  });

  it("draws a wreck as one dark slab and three smoke puffs on a damaged car", () => {
    const context = createFakeContext();
    const wreck = {
      ...createVehicle(1, "sedan", [10, 10], 0, 0),
      wrecked: true,
      health: 0,
    };
    drawVehicle(context, camera, viewport, wreck, 0, false);
    expect(
      context.calls.filter((call) => call.startsWith("fillRect")),
    ).toHaveLength(1);
    expect(context.calls.some((call) => call.startsWith("arc("))).toBe(false);
    const smokeContext = createFakeContext();
    const smoking = {
      ...createVehicle(2, "sedan", [10, 10], 0, 0),
      health: 30,
    };
    drawVehicle(smokeContext, camera, viewport, smoking, 5, false);
    expect(
      smokeContext.calls.filter((call) => call.startsWith("arc(")),
    ).toHaveLength(3);
  });

  it("rings the occupied car and skips cars far outside the view", () => {
    const context = createFakeContext();
    const cars = [
      createVehicle(1, "sedan", [10, 10], 0, 0),
      createVehicle(2, "sedan", [500, 500], 0, 0),
    ];
    drawVehicles(context, camera, viewport, cars, 0, 1);
    expect(
      context.calls.filter((call) => call.startsWith("translate(")),
    ).toHaveLength(1);
    expect(context.calls).toContain(`stroke(${PLAYER_RING},2)`);
  });
});
