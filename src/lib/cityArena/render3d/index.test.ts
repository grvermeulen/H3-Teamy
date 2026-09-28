import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scene as ArenaScene } from "../render/renderScene";
import { createView3d, focusOf } from "./index";
import { WebGl2UnavailableError, isWebGl2Unavailable } from "../webgl2";
import { pixelRatioFor, viewDistanceFor } from "./renderer3d";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createView3d", () => {
  it("throws a clear error when the device has no WebGL2, which is the fallback's signal", () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    const start = (): unknown => createView3d(document.createElement("canvas"));
    expect(start).toThrow(WebGl2UnavailableError);
    expect(start).toThrow("WebGL2 is not available on this device");
    expect(isWebGl2Unavailable(new WebGl2UnavailableError())).toBe(true);
    expect(isWebGl2Unavailable(new Error("other"))).toBe(false);
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
    expect(viewDistanceFor("low", 1280)).toBe(260);
    expect(viewDistanceFor("auto", 1280)).toBe(380);
    expect(viewDistanceFor("high", 1280)).toBe(520);
  });

  it("draws less far at 'auto' on a narrow screen, as the 2D view lowers its quality there", () => {
    expect(viewDistanceFor("auto", 767)).toBe(260);
    expect(viewDistanceFor("auto", 768)).toBe(380);
    expect(viewDistanceFor("high", 390)).toBe(520);
    expect(viewDistanceFor("low", 2560)).toBe(260);
  });
});
