import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SpriteManifest } from "../../src/lib/cityArena/render/sprites";
import { SPRITE_LIMITS, auditSprites } from "./check-sprites";
import { creditsFile } from "./credits";

const SURFACE = {
  file: "/arena/sprites/road.png",
  tileMetres: 8,
  tilePixels: 128,
};
const MANIFEST: SpriteManifest = {
  version: 1,
  surfaces: {
    road: SURFACE,
    pavement: { ...SURFACE, file: "/arena/sprites/pavement.png" },
    water: { ...SURFACE, file: "/arena/sprites/water.png" },
    grass: { ...SURFACE, file: "/arena/sprites/grass.png" },
    field: { ...SURFACE, file: "/arena/sprites/field.png" },
    forest: { ...SURFACE, file: "/arena/sprites/forest.png" },
    urban: { ...SURFACE, file: "/arena/sprites/urban.png" },
    roofTiles: { ...SURFACE, file: "/arena/sprites/roof-tiles.png" },
    roofFlat: { ...SURFACE, file: "/arena/sprites/roof-flat.png" },
  },
  vehicles: {
    sedan: {
      file: "/arena/sprites/car-sedan.png",
      lengthMetres: 4.2,
      widthMetres: 1.8,
      pixelWidth: 58,
      pixelHeight: 134,
      tint: true,
    },
    bus: {
      file: "/arena/sprites/vehicle-bus.png",
      lengthMetres: 12,
      widthMetres: 2.5,
      pixelWidth: 80,
      pixelHeight: 384,
      tint: false,
    },
  },
  people: {
    player: {
      file: "/arena/sprites/person-player.png",
      radiusMetres: 0.4,
      pixelSize: 51,
      frames: 8,
    },
  },
  props: {
    treeLarge: {
      file: "/arena/sprites/tree-large.png",
      lengthMetres: 10,
      widthMetres: 10,
      pixelWidth: 160,
      pixelHeight: 160,
    },
  },
  items: {
    bat: {
      file: "/arena/sprites/item-bat.png",
      lengthMetres: 0.85,
      widthMetres: 0.08,
      pixelWidth: 128,
      pixelHeight: 12,
    },
  },
  landmarks: {
    brewery: {
      file: "/arena/sprites/landmark-brewery.png",
      lengthMetres: 16,
      widthMetres: 4.5,
      pixelWidth: 256,
      pixelHeight: 72,
    },
  },
};
const FILES = [
  ...Object.values(MANIFEST.surfaces),
  ...Object.values(MANIFEST.vehicles),
  ...Object.values(MANIFEST.people),
  ...Object.values(MANIFEST.props),
  ...Object.values(MANIFEST.items),
  ...Object.values(MANIFEST.landmarks),
].flatMap((entry) => (entry ? [path.basename(entry.file)] : []));

/** A credits table naming every file given. */
function creditsFor(files: string[]): string {
  return creditsFile(
    "Sprite credits",
    "test",
    files.map((file) => `| ${file} | somewhere | someone | CC0 | https://x |`),
  );
}

describe("auditSprites", () => {
  let dir = "";
  let spriteDir = "";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "arena-sprites-"));
    spriteDir = path.join(dir, "arena", "sprites");
    await mkdir(spriteDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is quiet when every file is there, small and credited", async () => {
    for (const file of FILES)
      await writeFile(path.join(spriteDir, file), "PNG");
    expect(await auditSprites(dir, MANIFEST, creditsFor(FILES))).toEqual([]);
  });

  it("names a missing file, an uncredited one and one over its cap, with the bus's own cap", async () => {
    for (const file of FILES)
      if (file !== "water.png")
        await writeFile(path.join(spriteDir, file), "PNG");
    await writeFile(
      path.join(spriteDir, "vehicle-bus.png"),
      Buffer.alloc(SPRITE_LIMITS.vehicleBytes + 1),
    );
    await writeFile(
      path.join(spriteDir, "car-sedan.png"),
      Buffer.alloc(SPRITE_LIMITS.vehicleBytes + 1),
    );
    const problems = await auditSprites(
      dir,
      MANIFEST,
      creditsFor(FILES.filter((file) => file !== "person-player.png")),
    );
    expect(problems).toContainEqual({
      file: "water.png",
      problem: "no such file",
    });
    expect(problems).toContainEqual({
      file: "person-player.png",
      problem: "no row in CREDITS.md",
    });
    expect(problems).toContainEqual({
      file: "car-sedan.png",
      problem: expect.stringContaining("over the"),
    });
    expect(problems.filter((p) => p.file === "vehicle-bus.png")).toEqual([]);
    expect(problems).toHaveLength(3);
  });

  it("treats a missing credits file as nothing credited", async () => {
    for (const file of FILES)
      await writeFile(path.join(spriteDir, file), "PNG");
    const problems = await auditSprites(dir, MANIFEST, null);
    expect(problems).toHaveLength(FILES.length);
  });

  it("lets a filesystem error other than a missing file through", async () => {
    for (const file of FILES)
      await writeFile(path.join(spriteDir, file), "PNG");
    const denied = async (): Promise<{ size: number }> => {
      throw Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
    };
    await expect(
      auditSprites(dir, MANIFEST, creditsFor(FILES), SPRITE_LIMITS, denied),
    ).rejects.toThrow("EACCES");
  });
});
