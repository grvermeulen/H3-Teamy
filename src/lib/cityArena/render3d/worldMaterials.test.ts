import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdditiveBlending,
  SRGBColorSpace,
  Texture,
  type Color,
  type HSL,
} from "three";
import type { FakeContext } from "../render/testing/fakeContext";
import { LAMP_GLOW } from "./palette3d";
import {
  createColourRecordingContext,
  litWindowFills,
} from "./testing/recordingCanvas";
import { FACADE_STYLES, SURFACE_KEYS } from "./textures";
import {
  FACADE_VARIANTS,
  createWorldMaterials,
  disposeWorldMaterials,
} from "./worldMaterials";

/** Stubs jsdom's canvas with recording fakes, handed out in order; façades paint on 2D canvases. */
function stubCanvas(): FakeContext[] {
  const contexts: FakeContext[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    // jsdom's getContext returns null; the fake implements only the RasterContext subset the
    // painter uses, so the cast is unavoidable here (test file only).
    () => {
      const context = createColourRecordingContext();
      contexts.push(context);
      return context as unknown as CanvasRenderingContext2D;
    },
  );
  return contexts;
}

/** A colour's hue, saturation and lightness as seen on screen (sRGB). */
function hslOf(colour: Color): HSL {
  return colour.getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);
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

  it("lights at least two windows on every façade variant it seeds", () => {
    const contexts = stubCanvas();

    createWorldMaterials(() => new Texture());

    // Each façade material paints its colour map, then its glow map.
    const variants = FACADE_STYLES.length * FACADE_VARIANTS;
    expect(contexts).toHaveLength(variants * 2);
    const colourMaps = contexts.filter((_, index) => index % 2 === 0);
    for (const context of colourMaps) {
      expect(litWindowFills(context).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives trees a lighter yellow-green and a deeper blue-green canopy", () => {
    stubCanvas();

    const { canopies } = createWorldMaterials(() => new Texture());

    const [light, deep] = canopies.map((material) => hslOf(material.color));
    const degrees = 360;
    for (const green of [light, deep]) {
      expect(green.h * degrees).toBeGreaterThan(60);
      expect(green.h * degrees).toBeLessThan(180);
    }
    expect((deep.h - light.h) * degrees).toBeGreaterThan(40);
    expect(light.l - deep.l).toBeGreaterThan(0.08);
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
