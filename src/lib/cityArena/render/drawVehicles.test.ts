import { describe, expect, it } from "vitest";
import { createVehicle } from "../sim/vehicle";
import { createCamera } from "./camera";
import { drawVehicle, drawVehicles } from "./drawVehicles";
import { PLAYER_RING } from "./palette";
import type { VehicleSprite } from "./sprites";
import { createFakeContext } from "./testing/fakeContext";

const camera = createCamera([10, 10], 8);
const viewport = { width: 200, height: 100 };
/** A loaded car sprite; jsdom canvases are valid `CanvasImageSource` values. */
const sprite: VehicleSprite = {
  base: document.createElement("canvas"),
  tinted: [document.createElement("canvas")],
};

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

  it("paints an alternating light bar on intact police cars only", () => {
    const context = createFakeContext();
    drawVehicle(
      context,
      camera,
      viewport,
      createVehicle(3, "police", [10, 10], 0, 5),
      0,
      false,
    );
    expect(
      context.calls.filter((call) => call.startsWith("fillRect")).length,
    ).toBe(6);
    const wreckContext = createFakeContext();
    drawVehicle(
      wreckContext,
      camera,
      viewport,
      { ...createVehicle(4, "police", [10, 10], 0, 5), wrecked: true },
      0,
      false,
    );
    expect(
      wreckContext.calls.filter((call) => call.startsWith("fillRect")).length,
    ).toBe(1);
  });

  it("draws the sprite over the body's metre box instead of the vector body", () => {
    const context = createFakeContext();
    const car = createVehicle(1, "sedan", [10, 10], 0, 0);
    drawVehicle(context, camera, viewport, car, 0, false, sprite);
    // The art is drawn nose-up, so it takes a quarter turn onto the car frame's forward axis.
    expect(context.calls).toContain("rotate(1.57)");
    expect(
      context.calls.some((call) => call.endsWith(",-7.2,-16.8,14.4,33.6)")),
    ).toBe(true);
    expect(
      context.calls.filter((call) => call.startsWith("fillRect")),
    ).toHaveLength(0);
  });

  it("still flashes the light bars over a police car's sprite", () => {
    const context = createFakeContext();
    const police = createVehicle(2, "police", [10, 10], 0, 0);
    drawVehicle(context, camera, viewport, police, 0, false, sprite);
    expect(context.calls.some((call) => call.startsWith("drawImage"))).toBe(
      true,
    );
    expect(context.calls.filter((call) => call.startsWith("fillRect"))).toEqual(
      ["fillRect(11.2,-3,5.6,2)", "fillRect(11.2,1,5.6,2)"],
    );
  });

  it("keeps a wreck as one dark slab even once the sprite has loaded", () => {
    const context = createFakeContext();
    const wreck = {
      ...createVehicle(3, "sedan", [10, 10], 0, 0),
      wrecked: true,
    };
    drawVehicle(context, camera, viewport, wreck, 0, false, sprite);
    expect(context.calls.some((call) => call.startsWith("drawImage"))).toBe(
      false,
    );
    expect(context.calls.filter((call) => call.startsWith("fillRect"))).toEqual(
      ["fillRect(-16.8,-7.2,33.6,14.4)"],
    );
  });
});
