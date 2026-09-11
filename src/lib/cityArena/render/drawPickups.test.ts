import { describe, expect, it } from "vitest";
import { createCamera } from "./camera";
import { drawPickups, pickupBob, pickupColour } from "./drawPickups";
import { PICKUP_BACKDROP, PICKUP_HEALTH, PICKUP_UZI } from "./palette";
import { createFakeContext } from "./testing/fakeContext";

const camera = createCamera([0, 0], 4);
const viewport = { width: 100, height: 100 };

describe("drawPickups", () => {
  it("uses deterministic bobbing and weapon colours while omitting taken pickups", () => {
    const uzi = { id: 1, kind: "uzi" as const, x: 0, y: 0, takenAtTick: null };
    const context = createFakeContext();
    expect(pickupBob(uzi, 10)).toBe(pickupBob(uzi, 10));
    expect(pickupColour("uzi")).toBe(PICKUP_UZI);
    drawPickups(
      context,
      camera,
      viewport,
      [uzi, { ...uzi, id: 2, takenAtTick: 1 }],
      10,
    );
    expect(context.calls).toContain(`fill(${PICKUP_UZI})`);
    expect(
      context.calls.filter((call) => call.startsWith("fill(")).length,
    ).toBe(1);
  });

  it("draws the item's art as a metre-long icon over a dark disc once it has loaded", () => {
    const image = document.createElement("canvas");
    const context = createFakeContext();
    drawPickups(
      context,
      camera,
      viewport,
      [{ id: 4, kind: "rifle", x: 0, y: 0, takenAtTick: null }],
      0,
      { rifle: { image, lengthMetres: 1.1, widthMetres: 0.22 } },
    );
    expect(context.calls).toContain(`fill(${PICKUP_BACKDROP})`);
    // A metre long at 4 px/m, the width in the art's own proportion.
    expect(context.calls).toContain(
      `drawImage(${String(image)},-2,-0.4,4,0.8)`,
    );
    expect(context.calls.filter((call) => call.startsWith("lineTo("))).toEqual(
      [],
    );
  });

  it("draws a health diamond and white cross", () => {
    const context = createFakeContext();
    drawPickups(
      context,
      camera,
      viewport,
      [{ id: 3, kind: "health", x: 0, y: 0, takenAtTick: null }],
      0,
    );
    expect(context.calls).toContain(`fill(${PICKUP_HEALTH})`);
    expect(
      context.calls.filter((call) => call.startsWith("fillRect(")).length,
    ).toBe(2);
  });
});
