import { afterEach, describe, expect, it, vi } from "vitest";
import { AdditiveBlending, Texture } from "three";
import { createFakeContext } from "../render/testing/fakeContext";
import { LAMP_GLOW } from "./palette3d";
import { FACADE_STYLES, SURFACE_KEYS } from "./textures";
import {
  FACADE_VARIANTS,
  createWorldMaterials,
  disposeWorldMaterials,
} from "./worldMaterials";

/** Stubs jsdom's canvas with recording fakes; façade textures paint on 2D canvases. */
function stubCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    // jsdom's getContext returns null; the fake implements only the RasterContext subset the
    // painter uses, so the cast is unavoidable here (test file only).
    () => createFakeContext() as unknown as CanvasRenderingContext2D,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWorldMaterials", () => {
  it("builds one material per surface from the loaded textures", () => {
    stubCanvas();
    const load = vi.fn((_url: string) => new Texture());

    const materials = createWorldMaterials(load);

    expect(Object.keys(materials.surfaces).sort()).toEqual(
      [...SURFACE_KEYS].sort(),
    );
    expect(load).toHaveBeenCalledTimes(SURFACE_KEYS.length);
  });

  it("gives every façade style a few distinct seeded variants", () => {
    stubCanvas();

    const { facades } = createWorldMaterials(() => new Texture());

    for (const style of FACADE_STYLES) {
      expect(facades[style]).toHaveLength(FACADE_VARIANTS);
      expect(new Set(facades[style]).size).toBe(FACADE_VARIANTS);
      for (const material of facades[style]) {
        expect(material.emissiveMap).not.toBeNull();
      }
    }
  });

  it("makes the lamp head glow in the lamp colour", () => {
    stubCanvas();

    const materials = createWorldMaterials(() => new Texture());

    expect(materials.lampHead.emissive.getHex()).toBe(LAMP_GLOW);
    expect(materials.lampGlow.blending).toBe(AdditiveBlending);
    expect(materials.lampGlow.depthWrite).toBe(false);
    expect(materials.lampGlow.map).not.toBeNull();
  });

  it("gives trees two different canopy greens", () => {
    stubCanvas();

    const { canopies } = createWorldMaterials(() => new Texture());

    expect(canopies).toHaveLength(2);
    expect(canopies[0].color.getHex()).not.toBe(canopies[1].color.getHex());
  });

  it("makes the bus shelter glass see-through", () => {
    stubCanvas();

    const { shelterGlass } = createWorldMaterials(() => new Texture());

    expect(shelterGlass.transparent).toBe(true);
    expect(shelterGlass.opacity).toBeLessThan(1);
  });
});

describe("disposeWorldMaterials", () => {
  it("disposes every material and its textures", () => {
    stubCanvas();
    const materials = createWorldMaterials(() => new Texture());
    const grass = vi.spyOn(materials.surfaces.grass, "dispose");
    const grassMap = vi.spyOn(materials.surfaces.grass.map!, "dispose");
    const brick = materials.facades.brick[0];
    const brickGlow = vi.spyOn(brick.emissiveMap!, "dispose");
    const glowMap = vi.spyOn(materials.lampGlow.map!, "dispose");
    const bench = vi.spyOn(materials.bench, "dispose");

    disposeWorldMaterials(materials);

    expect(grass).toHaveBeenCalledTimes(1);
    expect(grassMap).toHaveBeenCalledTimes(1);
    expect(brickGlow).toHaveBeenCalledTimes(1);
    expect(glowMap).toHaveBeenCalledTimes(1);
    expect(bench).toHaveBeenCalledTimes(1);
  });
});
