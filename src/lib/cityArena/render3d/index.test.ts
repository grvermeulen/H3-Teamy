import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scene as ArenaScene } from "../render/renderScene";
import { createView3d, focusOf } from "./index";
import { pixelRatioFor, viewDistanceFor } from "./renderer3d";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createView3d", () => {
  it("throws a clear error when the device has no WebGL2, which is the fallback's signal", () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    expect(() => createView3d(document.createElement("canvas"))).toThrow(
      "WebGL2 is not available on this device",
    );
    expect(getContext).toHaveBeenCalledWith("webgl2", expect.any(Object));
  });
});

describe("focusOf", () => {
  const scene = (vehicleId: number | null): ArenaScene =>
    ({
      localPlayerId: 2,
      players: [
        { id: 1, x: 100, y: 100, vehicleId: null },
        { id: 2, x: 5, y: 6, vehicleId },
      ],
      vehicles: [{ id: 8, kind: "bus", x: 7, y: 9, heading: 1.2 }],
    }) as unknown as ArenaScene;

  it("follows the local player on foot", () => {
    expect(focusOf(scene(null))).toEqual({ x: 5, y: 6, driving: null });
  });

  it("follows the car, with its length and heading, while driving", () => {
    expect(focusOf(scene(8))).toEqual({
      x: 7,
      y: 9,
      driving: { length: 12, heading: 1.2 },
    });
  });
});

describe("render quality", () => {
  it("maps quality to pixel ratio and view distance (spec §6.5, §8)", () => {
    expect(pixelRatioFor("low", 3)).toBe(1);
    expect(pixelRatioFor("auto", 3)).toBe(1.5);
    expect(pixelRatioFor("auto", 1)).toBe(1);
    expect(pixelRatioFor("high", 3)).toBe(2);
    expect(pixelRatioFor("high", 0)).toBe(1);
    expect(viewDistanceFor("low")).toBe(260);
    expect(viewDistanceFor("auto")).toBe(380);
    expect(viewDistanceFor("high")).toBe(520);
  });
});
