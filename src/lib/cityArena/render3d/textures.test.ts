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
import type { FakeContext } from "../render/testing/fakeContext";
import { WINDOW_DARK } from "./palette3d";
import {
  createColourRecordingContext,
  cssColour,
  litWindowFills,
} from "./testing/recordingCanvas";
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

/** Windows on one façade canvas: 4 × 4 modules of two windows each. */
const WINDOWS_PER_CANVAS = 32;

/** Stubs jsdom's canvas so each `getContext` hands out a fresh recording context, in order. */
function stubCanvasContexts(): FakeContext[] {
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

/** The fills of dark window panes. */
function darkFills(context: FakeContext): string[] {
  return context.calls.filter((call) =>
    call.startsWith(`fillRect(${cssColour(WINDOW_DARK)},`),
  );
}

/** Each module's calls (between `save` and `restore`, without the move to its corner), joined. */
function moduleDrawings(context: FakeContext): string[] {
  const modules: string[][] = [];
  for (const call of context.calls) {
    if (call === "save()") modules.push([]);
    else if (!call.startsWith("translate(")) modules.at(-1)?.push(call);
  }
  return modules.map((calls) => calls.join(";"));
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

  it("paints 4 × 4 modules whose lit windows vary from module to module", () => {
    const contexts = stubCanvasContexts();

    // Plaster has no seeded wall detail, so modules differ only by their windows.
    createFacadeTexture("plaster", 7, 0.5);

    const modules = moduleDrawings(contexts[0]);
    expect(modules).toHaveLength(16);
    expect(new Set(modules).size).toBeGreaterThan(1);
  });

  it.each(FACADE_STYLES)(
    "lights no window in %s at a lit share of 0",
    (style) => {
      const contexts = stubCanvasContexts();

      createFacadeTexture(style, 3, 0);

      expect(litWindowFills(contexts[0])).toEqual([]);
      expect(darkFills(contexts[0])).toHaveLength(WINDOWS_PER_CANVAS);
    },
  );

  it("lights every window at a lit share of 1", () => {
    const contexts = stubCanvasContexts();

    createFacadeTexture("plaster", 11, 1);

    expect(litWindowFills(contexts[0])).toHaveLength(WINDOWS_PER_CANVAS);
  });

  it.each([0.01, 0.35])(
    "lights at least two windows for every seed at a lit share of %s",
    (litShare) => {
      const contexts = stubCanvasContexts();

      for (let seed = 0; seed < 64; seed++) {
        createFacadeTexture("glass", seed, litShare);
      }

      for (const context of contexts) {
        expect(litWindowFills(context).length).toBeGreaterThanOrEqual(2);
      }
    },
  );

  it("is a 1024 × 528 repeating sRGB canvas texture, a quarter per UV unit", () => {
    stubCanvasContexts();

    const texture = createFacadeTexture("glass", 1, 0.35);

    expect(texture).toBeInstanceOf(CanvasTexture);
    expect(texture.image.width).toBe(1024);
    expect(texture.image.height).toBe(528);
    expect(texture.repeat.x).toBe(0.25);
    expect(texture.repeat.y).toBe(0.25);
    expect(texture.wrapS).toBe<Wrapping>(RepeatWrapping);
    expect(texture.wrapT).toBe<Wrapping>(RepeatWrapping);
    expect(texture.colorSpace).toBe(SRGBColorSpace);
  });
});

describe("createFacadeMaterial", () => {
  it("glows through an emissive map that holds the lit windows only", () => {
    const contexts = stubCanvasContexts();

    const material = createFacadeMaterial("concrete", 5, 0.35);

    expect(material.map).toBeInstanceOf(CanvasTexture);
    expect(material.emissiveMap).toBeInstanceOf(CanvasTexture);
    expect(material.emissiveMap).not.toBe(material.map);
    expect(material.emissive.getHex()).toBe(0xffffff);
    const [map, glow] = contexts;
    expect(litWindowFills(map).length).toBeGreaterThanOrEqual(2);
    expect(litWindowFills(glow)).toEqual(litWindowFills(map));
    expect(darkFills(glow)).toEqual([]);
  });

  it("repeats the emissive map on the same grid as the colour map", () => {
    stubCanvasContexts();

    const material = createFacadeMaterial("brick", 9, 0.35);

    expect(material.emissiveMap?.repeat.x).toBe(0.25);
    expect(material.emissiveMap?.repeat.y).toBe(0.25);
    expect(material.emissiveMap?.wrapS).toBe<Wrapping>(RepeatWrapping);
    expect(material.emissiveMap?.wrapT).toBe<Wrapping>(RepeatWrapping);
  });

  it("leaves the emissive map black at a lit share of 0", () => {
    const contexts = stubCanvasContexts();

    createFacadeMaterial("brick", 5, 0);

    expect(litWindowFills(contexts[1])).toEqual([]);
  });

  it("takes vertex colours so a building's walls can be scorched", () => {
    stubCanvasContexts();

    expect(createFacadeMaterial("plaster", 2, 0.35).vertexColors).toBe(true);
  });
});
