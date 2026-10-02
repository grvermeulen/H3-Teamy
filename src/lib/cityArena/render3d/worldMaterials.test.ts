import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdditiveBlending,
  AlwaysDepth,
  LessEqualDepth,
  PointsMaterial,
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
import { SURFACE_KEYS } from "./textures";
import {
  GROUND_RENDER_ORDER,
  createWorldMaterials,
  disposeWorldMaterials,
  type GroundLayer,
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

  it("draws every wall through one atlas material that glows at its lit windows", () => {
    stubCanvas();

    const { facade, detail } = createWorldMaterials(() => new Texture());

    expect(facade.map).not.toBeNull();
    expect(facade.emissiveMap).not.toBeNull();
    expect(facade.vertexColors).toBe(true);
    expect(detail.vertexColors).toBe(true);
    expect(detail).not.toBe(facade);
  });

  it("makes the lamp head glow in the lamp colour", () => {
    stubCanvas();

    const materials = createWorldMaterials(() => new Texture());

    expect(materials.lampHead.emissive.getHex()).toBe(LAMP_GLOW);
    expect(materials.lampGlow.blending).toBe(AdditiveBlending);
    expect(materials.lampGlow.depthWrite).toBe(false);
    expect(materials.lampGlow.map).not.toBeNull();
  });

  it("paints the atlas and its glow map, lighting windows on both", () => {
    const contexts = stubCanvas();

    createWorldMaterials(() => new Texture());

    expect(contexts).toHaveLength(2);
    const [colourMap, glowMap] = contexts;
    const painted = new Set(litWindowFills(colourMap));
    const glowing = litWindowFills(glowMap);
    expect(glowing.length).toBeGreaterThan(20);
    for (const pane of glowing) expect(painted.has(pane)).toBe(true);
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

  it("draws each lamp halo as a sized, additive point sprite", () => {
    stubCanvas();

    const { lampGlow } = createWorldMaterials(() => new Texture());

    expect(lampGlow).toBeInstanceOf(PointsMaterial);
    expect(lampGlow.sizeAttenuation).toBe(true);
    expect(lampGlow.size).toBeGreaterThan(1);
  });

  it("paints the ground layers over each other instead of depth-testing them", () => {
    stubCanvas();

    const { surfaces, roadMarking } = createWorldMaterials(() => new Texture());

    const ground = [
      surfaces.urban,
      surfaces.field,
      surfaces.grass,
      surfaces.forest,
      surfaces.water,
      surfaces.pavement,
      surfaces.road,
      roadMarking,
    ];
    for (const material of ground) {
      expect(material.depthFunc).toBe(AlwaysDepth);
      expect(material.depthWrite).toBe(true);
    }
    expect(surfaces.roofTiles.depthFunc).toBe(LessEqualDepth);
    expect(surfaces.roofFlat.depthFunc).toBe(LessEqualDepth);
  });

  it("orders the ground layers as the 2D map paints them, below everything else", () => {
    const paintOrder: GroundLayer[] = [
      "urban",
      "field",
      "grass",
      "forest",
      "water",
      "pavement",
      "road",
      "marking",
    ];

    const orders = paintOrder.map((layer) => GROUND_RENDER_ORDER[layer]);

    expect([...orders].sort((left, right) => left - right)).toEqual(orders);
    expect(new Set(orders).size).toBe(orders.length);
    expect(Math.max(...orders)).toBeLessThan(0);
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
    const atlasGlow = vi.spyOn(materials.facade.emissiveMap!, "dispose");
    const atlas = vi.spyOn(materials.facade.map!, "dispose");
    const glowMap = vi.spyOn(materials.lampGlow.map!, "dispose");
    const bench = vi.spyOn(materials.bench, "dispose");

    disposeWorldMaterials(materials);

    expect(grass).toHaveBeenCalledTimes(1);
    expect(grassMap).toHaveBeenCalledTimes(1);
    expect(atlasGlow).toHaveBeenCalledTimes(1);
    expect(atlas).toHaveBeenCalledTimes(1);
    expect(glowMap).toHaveBeenCalledTimes(1);
    expect(bench).toHaveBeenCalledTimes(1);
  });
});
