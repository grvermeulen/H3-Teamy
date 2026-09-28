import { describe, expect, it } from "vitest";
import { ROCKET_TIP, ROCKET_TUBE } from "./palette";
import { createFakeContext } from "./testing/fakeContext";
import { ROCKET_LAUNCHER_ITEM, itemArtFor, paintItem } from "./vectorItems";

describe("itemArtFor", () => {
  const rocketArt = {
    image: document.createElement("canvas"),
    lengthMetres: 1.1,
    widthMetres: 0.2,
  };

  it("stands the rocket launcher in with vector paths until its art has loaded", () => {
    expect(itemArtFor(undefined, "rocket")).toBe(ROCKET_LAUNCHER_ITEM);
    expect(itemArtFor({}, "rocket")).toBe(ROCKET_LAUNCHER_ITEM);
    expect(itemArtFor({ rocket: rocketArt }, "rocket")).toBe(rocketArt);
  });

  it("has no stand-in for an item that already has art, nor for an empty hand", () => {
    expect(itemArtFor(undefined, "pistol")).toBeUndefined();
    expect(itemArtFor(undefined, null)).toBeUndefined();
  });
});

describe("paintItem", () => {
  it("paints the launcher as an olive tube with a red tip at its front end", () => {
    const context = createFakeContext();
    paintItem(context, ROCKET_LAUNCHER_ITEM, -5, -1, 10, 2);
    expect(context.calls).toContain(`fill(${ROCKET_TUBE})`);
    expect(context.calls).toContain(`fill(${ROCKET_TIP})`);
    // The tip's point reaches the far end of the box, on its centre line.
    expect(context.calls).toContain("lineTo(5,0)");
    expect(context.calls.some((call) => call.startsWith("drawImage("))).toBe(
      false,
    );
  });

  it("draws loaded art as an image in the same box", () => {
    const image = document.createElement("canvas");
    const context = createFakeContext();
    paintItem(
      context,
      { image, lengthMetres: 1, widthMetres: 0.2 },
      -5,
      -1,
      10,
      2,
    );
    expect(context.calls).toEqual([`drawImage(${String(image)},-5,-1,10,2)`]);
  });
});
