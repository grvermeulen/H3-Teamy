import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAYER_RADIUS_M } from "../sim/player";
import { ROAD_FILL } from "./palette";
import {
  NO_SPRITES,
  parseSpriteManifest,
  surfaceFill,
  hasOwnVehicleArt,
  itemKeyForWeapon,
  itemSpriteFor,
  vehicleSpriteFor,
  type SurfaceTexture,
  type VehicleSprite,
} from "./sprites";
import { createFakeContext } from "./testing/fakeContext";

/** The manifest `scripts/generate-arena-sprites.js` wrote, read from the committed build output. */
function generatedManifest(): unknown {
  const path = join(
    process.cwd(),
    "public",
    "arena",
    "sprites",
    "manifest.json",
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

/** A stand-in texture; jsdom canvases are valid `CanvasImageSource` values. */
function fakeTexture(tileMetres = 8, tilePixels = 128): SurfaceTexture {
  return { image: document.createElement("canvas"), tileMetres, tilePixels };
}

describe("parseSpriteManifest", () => {
  it("accepts the manifest the build script generates", () => {
    const manifest = parseSpriteManifest(generatedManifest());
    expect(manifest.surfaces.road.tileMetres).toBe(8);
    expect(manifest.surfaces.road.tilePixels).toBe(128);
    expect(manifest.surfaces.pavement.tileMetres).toBe(8);
    // Water and every ground kind are authored at the same metres-per-repeat as the road, so a
    // texture swapped between them keeps the world's scale.
    for (const name of [
      "water",
      "grass",
      "field",
      "forest",
      "urban",
    ] as const) {
      expect(manifest.surfaces[name].tileMetres).toBe(8);
      expect(manifest.surfaces[name].tilePixels).toBe(128);
    }
    expect(manifest.vehicles.sedan?.lengthMetres).toBe(4.2);
    expect(manifest.vehicles.sedan?.widthMetres).toBe(1.8);
    // The character art is packed onto the collision circle's box, so the two must not drift.
    expect(manifest.people.player.radiusMetres).toBe(PLAYER_RADIUS_M);
  });

  it("rejects a vehicle key that is no kind, and takes any subset of the kinds", () => {
    const manifest = parseSpriteManifest(generatedManifest());
    const sedan = manifest.vehicles.sedan;
    expect(() =>
      parseSpriteManifest({
        ...manifest,
        vehicles: { ...manifest.vehicles, buss: sedan },
      }),
    ).toThrow();
    expect(
      parseSpriteManifest({ ...manifest, vehicles: { police: sedan } })
        .vehicles,
    ).toEqual({ police: sedan });
  });

  it("rejects a manifest missing a surface", () => {
    const manifest = generatedManifest() as {
      surfaces: Record<string, unknown>;
    };
    delete manifest.surfaces.pavement;
    expect(() => parseSpriteManifest(manifest)).toThrow();
  });
});

describe("generated sprite art", () => {
  it("packs the car opaque, so the road cannot show through its bodywork", async () => {
    const sharp = (await import("sharp")).default;
    const manifest = parseSpriteManifest(generatedManifest());
    const { data, info } = await sharp(
      join(process.cwd(), "public", manifest.vehicles.sedan.file),
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const centre =
      (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) *
      info.channels;
    expect(info.width).toBe(manifest.vehicles.sedan.pixelWidth);
    expect(info.height).toBe(manifest.vehicles.sedan.pixelHeight);
    expect(data[centre + 3]).toBe(255);
    // The four corners sit outside the silhouette, so the cut-out must still be transparent.
    const lastRow = (info.height - 1) * info.width * info.channels;
    expect(data[3]).toBe(0);
    expect(data[lastRow + 3]).toBe(0);
  });

  it("packs the player as one square cell per animation frame", async () => {
    const sharp = (await import("sharp")).default;
    const manifest = parseSpriteManifest(generatedManifest());
    const { info } = await sharp(
      join(process.cwd(), "public", manifest.people.player.file),
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { pixelSize, frames } = manifest.people.player;
    expect(info.width).toBe(pixelSize * frames);
    expect(info.height).toBe(pixelSize);
  });
});

describe("surfaceFill", () => {
  it("returns the flat palette colour when the texture has not loaded", () => {
    const context = createFakeContext();
    expect(surfaceFill(context, undefined, ROAD_FILL)).toBe(ROAD_FILL);
    expect(context.calls).toHaveLength(0);
  });

  it("scales the pattern so one repeat covers its authored metre footprint", () => {
    const context = createFakeContext();
    const fill = surfaceFill(context, fakeTexture(), ROAD_FILL);
    expect(String(fill)).toBe("pattern(#0)");
    expect(context.calls).toEqual([
      "createPattern(repeat)",
      // 8 m over 128 px, so the caller's metre-space transform paints one tile per 8 m.
      "patternTransform(pattern(#0),0.0625)",
    ]);
  });

  it("keeps one repeat at 8 m when the texture ships at a different pixel size", () => {
    const context = createFakeContext();
    surfaceFill(context, fakeTexture(8, 256), ROAD_FILL);
    expect(context.calls).toContain("patternTransform(pattern(#0),0.03125)");
  });
});

describe("vehicleSpriteFor", () => {
  const tinted = [
    document.createElement("canvas"),
    document.createElement("canvas"),
  ];
  const sprite: VehicleSprite = {
    base: document.createElement("canvas"),
    tinted,
  };

  it("picks the tint for the car's colour, wrapping past the last one", () => {
    expect(vehicleSpriteFor({ car: sprite }, "sedan", 0)).toBe(tinted[0]);
    expect(vehicleSpriteFor({ car: sprite }, "sedan", 1)).toBe(tinted[1]);
    expect(vehicleSpriteFor({ car: sprite }, "sedan", 2)).toBe(tinted[0]);
  });

  it("falls back to the untinted art when no tint could be built", () => {
    const untinted: VehicleSprite = { base: sprite.base, tinted: [] };
    expect(vehicleSpriteFor({ car: untinted }, "sedan", 3)).toBe(sprite.base);
  });

  it("has nothing to draw when the sprite has not loaded", () => {
    expect(
      vehicleSpriteFor({ car: NO_SPRITES.car }, "sedan", 0),
    ).toBeUndefined();
  });
});

describe("vehicleSpriteFor by kind", () => {
  const own: VehicleSprite = {
    base: document.createElement("canvas"),
    tinted: [],
  };
  const sedan: VehicleSprite = {
    base: document.createElement("canvas"),
    tinted: [document.createElement("canvas")],
  };

  it("prefers a kind's own art, uncoloured when it keeps its own colours", () => {
    const art = { car: sedan, vehicles: { sedan, bus: own } };
    expect(vehicleSpriteFor(art, "bus", 3)).toBe(own.base);
    expect(hasOwnVehicleArt(art, "bus")).toBe(true);
  });

  it("borrows the sedan's tinted art for a kind without its own, and says so", () => {
    const art = { car: sedan, vehicles: { sedan } };
    expect(vehicleSpriteFor(art, "compact", 0)).toBe(sedan.tinted[0]);
    expect(hasOwnVehicleArt(art, "compact")).toBe(false);
    expect(vehicleSpriteFor(undefined, "compact", 0)).toBeUndefined();
  });
});

describe("itemKeyForWeapon and itemSpriteFor", () => {
  it("names every weapon's item but the fist, and finds the art once it has loaded", () => {
    expect(itemKeyForWeapon("fist")).toBeNull();
    expect(itemKeyForWeapon("uzi")).toBe("uzi");
    expect(itemKeyForWeapon("bat")).toBe("bat");
    const uzi = {
      image: document.createElement("canvas"),
      lengthMetres: 0.5,
      widthMetres: 0.4,
    };
    expect(itemSpriteFor({ uzi }, "uzi")).toBe(uzi);
    expect(itemSpriteFor({ uzi }, "rifle")).toBeUndefined();
    expect(itemSpriteFor({ uzi }, null)).toBeUndefined();
    expect(itemSpriteFor(undefined, "uzi")).toBeUndefined();
    const manifest = parseSpriteManifest(generatedManifest());
    expect(manifest.items.pistol?.lengthMetres).toBe(0.2);
    expect(manifest.surfaces.roofTiles.tileMetres).toBe(8);
  });
});
