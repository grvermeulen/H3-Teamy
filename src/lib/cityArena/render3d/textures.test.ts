import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  type Wrapping,
} from "three";
import manifestJson from "../../../../public/arena/sprites/manifest.json";
import { parseSpriteManifest } from "../render/sprites";
import {
  createFakeContext,
  type FakeContext,
} from "../render/testing/fakeContext";
import { WINDOW_COLD, WINDOW_DARK, WINDOW_WARM } from "./palette3d";
import {
  FACADE_STYLES,
  SURFACE_KEYS,
  TEXTURE_REPEAT_M,
  createFacadeMaterial,
  createFacadeTexture,
  createSurfaceMaterials,
  surfaceUrl,
} from "./textures";

const manifest = parseSpriteManifest(manifestJson);

/** A hex colour number as the CSS string the painter assigns to `fillStyle`. */
function css(colour: number): string {
  return `#${colour.toString(16).padStart(6, "0")}`;
}

const LIT_FILLS = [css(WINDOW_WARM), css(WINDOW_COLD)];

/** A fake context whose `fillRect` also logs the fill colour, so tests can see what was lit. */
function colourRecordingContext(): FakeContext {
  const context = createFakeContext();
  context.fillRect = (x: number, y: number, width: number, height: number) => {
    context.calls.push(
      `fillRect(${String(context.fillStyle)},${x},${y},${width},${height})`,
    );
  };
  return context;
}

/** Stubs jsdom's canvas so each `getContext` hands out a fresh recording context, in order. */
function stubCanvasContexts(): FakeContext[] {
  const contexts: FakeContext[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    // jsdom's getContext returns null; the fake implements only the RasterContext subset the
    // painter uses, so the cast is unavoidable here (test file only).
    () => {
      const context = colourRecordingContext();
      contexts.push(context);
      return context as unknown as CanvasRenderingContext2D;
    },
  );
  return contexts;
}

/** The fillRect calls that painted a lit (warm or cold) window. */
function litFills(context: FakeContext): string[] {
  return context.calls.filter((call) =>
    LIT_FILLS.some((fill) => call.startsWith(`fillRect(${fill},`)),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("surfaceUrl", () => {
  it("serves grass from the ground-grass texture", () => {
    expect(surfaceUrl("grass")).toMatch(/ground-grass\.png$/);
  });

  it("matches the sprite manifest's file for every surface", () => {
    expect([...SURFACE_KEYS].sort()).toEqual(
      Object.keys(manifest.surfaces).sort(),
    );
    for (const key of SURFACE_KEYS) {
      expect(surfaceUrl(key)).toBe(manifest.surfaces[key].file);
      expect(manifest.surfaces[key].tileMetres).toBe(TEXTURE_REPEAT_M);
    }
  });
});

describe("createSurfaceMaterials", () => {
  it("loads each surface once as a repeating sRGB map", () => {
    const load = vi.fn((_url: string) => new Texture());

    const materials = createSurfaceMaterials(load);

    expect(load).toHaveBeenCalledTimes(SURFACE_KEYS.length);
    for (const key of SURFACE_KEYS) {
      expect(load).toHaveBeenCalledWith(surfaceUrl(key));
      const map = materials[key].map;
      expect(map?.wrapS).toBe<Wrapping>(RepeatWrapping);
      expect(map?.wrapT).toBe<Wrapping>(RepeatWrapping);
      expect(map?.colorSpace).toBe(SRGBColorSpace);
    }
  });
});

describe("createFacadeTexture", () => {
  it("draws the same calls for the same seed", () => {
    const contexts = stubCanvasContexts();

    createFacadeTexture("brick", 7, 0.5);
    createFacadeTexture("brick", 7, 0.5);

    expect(contexts).toHaveLength(2);
    expect(contexts[0].calls.length).toBeGreaterThan(0);
    expect(contexts[1].calls).toEqual(contexts[0].calls);
  });

  it("varies the drawing with the seed", () => {
    const contexts = stubCanvasContexts();

    for (let seed = 0; seed < 8; seed++) {
      createFacadeTexture("brick", seed, 0.5);
    }

    const distinct = new Set(contexts.map((context) => context.calls.join()));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it.each(FACADE_STYLES)(
    "lights no window in %s at a lit share of 0",
    (style) => {
      const contexts = stubCanvasContexts();

      createFacadeTexture(style, 3, 0);

      expect(litFills(contexts[0])).toEqual([]);
      const dark = contexts[0].calls.filter((call) =>
        call.startsWith(`fillRect(${css(WINDOW_DARK)},`),
      );
      expect(dark).toHaveLength(2);
    },
  );

  it("lights both windows at a lit share of 1", () => {
    const contexts = stubCanvasContexts();

    createFacadeTexture("plaster", 11, 1);

    expect(litFills(contexts[0])).toHaveLength(2);
  });

  it("is a 256 × 132 repeating sRGB canvas texture", () => {
    stubCanvasContexts();

    const texture = createFacadeTexture("glass", 1, 0.35);

    expect(texture).toBeInstanceOf(CanvasTexture);
    expect(texture.image.width).toBe(256);
    expect(texture.image.height).toBe(132);
    expect(texture.wrapS).toBe<Wrapping>(RepeatWrapping);
    expect(texture.wrapT).toBe<Wrapping>(RepeatWrapping);
    expect(texture.colorSpace).toBe(SRGBColorSpace);
  });
});

describe("createFacadeMaterial", () => {
  it("glows through an emissive map that holds the lit windows only", () => {
    const contexts = stubCanvasContexts();

    const material = createFacadeMaterial("concrete", 5, 1);

    expect(material.map).toBeInstanceOf(CanvasTexture);
    expect(material.emissiveMap).toBeInstanceOf(CanvasTexture);
    expect(material.emissiveMap).not.toBe(material.map);
    expect(material.emissive.getHex()).toBe(0xffffff);
    const [map, glow] = contexts;
    expect(litFills(glow)).toEqual(litFills(map));
    expect(
      glow.calls.some((call) =>
        call.startsWith(`fillRect(${css(WINDOW_DARK)},`),
      ),
    ).toBe(false);
  });

  it("leaves the emissive map black at a lit share of 0", () => {
    const contexts = stubCanvasContexts();

    createFacadeMaterial("brick", 5, 0);

    expect(litFills(contexts[1])).toEqual([]);
  });

  it("takes vertex colours so a building's walls can be scorched", () => {
    stubCanvasContexts();

    expect(createFacadeMaterial("plaster", 2, 0.35).vertexColors).toBe(true);
  });
});
