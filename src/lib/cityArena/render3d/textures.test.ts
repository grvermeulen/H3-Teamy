import { afterEach, describe, expect, it, vi } from "vitest";
import { RepeatWrapping, SRGBColorSpace, Texture, type Wrapping } from "three";
import manifestJson from "../../../../public/arena/sprites/manifest.json";
import { parseSpriteManifest } from "../render/sprites";
import { FACADE_FINISHES } from "./facadeSheets";
import {
  PAVEMENT_DUSK_SHADE,
  SURFACE_KEYS,
  TEXTURE_REPEAT_M,
  createSurfaceMaterials,
  facadeWallColour,
  surfaceUrl,
} from "./textures";

const manifest = parseSpriteManifest(manifestJson);

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

  it("shades the light pavement slabs down to concrete at dusk, and no other surface", () => {
    const materials = createSurfaceMaterials(() => new Texture());

    expect(PAVEMENT_DUSK_SHADE).toBe(0.55);
    expect(materials.pavement.color.toArray()).toEqual([0.55, 0.55, 0.55]);
    for (const key of SURFACE_KEYS.filter((other) => other !== "pavement"))
      expect(materials[key].color.toArray()).toEqual([1, 1, 1]);
  });
});

describe("facadeWallColour", () => {
  it("gives every finish its own wall colour", () => {
    const colours = FACADE_FINISHES.map(facadeWallColour);

    expect(new Set(colours).size).toBe(FACADE_FINISHES.length);
    for (const colour of colours) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
  });
});
