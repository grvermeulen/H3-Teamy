import { describe, expect, it } from "vitest";
import { BASKETBALL_COURT_CENTRE } from "../world/basketballCourt";
import { createFakeContext } from "./testing/fakeContext";
import { drawBasketball } from "./drawBasketball";

describe("the Bellefleur basketball scene", () => {
  it("does no drawing when the house is off camera", () => {
    const ctx = createFakeContext();
    drawBasketball(
      ctx,
      { x: 0, y: 0, zoom: 12 },
      { width: 480, height: 320 },
      1,
    );
    expect(ctx.calls).toEqual([]);
  });
  it("draws the supplied Oranje duo at the house", () => {
    const ctx = createFakeContext();
    const [x, y] = BASKETBALL_COURT_CENTRE;
    drawBasketball(ctx, { x, y, zoom: 12 }, { width: 480, height: 320 }, 9, {
      image: document.createElement("canvas"),
      lengthMetres: 4,
      widthMetres: 2.5,
    });
    expect(ctx.calls).toContain("translate(240,160)");
    expect(
      ctx.calls.filter((call) => call.startsWith("drawImage(")),
    ).toHaveLength(1);
  });
});
