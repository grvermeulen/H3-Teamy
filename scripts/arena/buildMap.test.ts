// @vitest-environment node
// scripts/arena/buildMap.test.ts
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MINI_LANDMARKS,
  overpassMini,
} from "../../src/lib/cityArena/mapBuild/fixtures/overpassMini";
import {
  type BuiltFile,
  GZIP_BUDGET_BYTES,
  TILE_GZIP_BUDGET_BYTES,
  findOversizedTiles,
  runBuild,
} from "./buildMap";

describe("runBuild", () => {
  let workDir = "";
  const fetchImpl = vi.fn(
    async () => new Response(JSON.stringify(overpassMini), { status: 200 }),
  );

  beforeEach(async () => {
    vi.clearAllMocks();
    workDir = await mkdtemp(join(tmpdir(), "arena-build-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("runs all four stages, writes the asset and reports sizes", async () => {
    const outDir = join(workDir, "out");
    const result = await runBuild({
      outDir,
      cacheDir: join(workDir, "cache"),
      check: false,
      refresh: false,
      fetchImpl,
      config: MINI_LANDMARKS,
      now: () => new Date("2026-09-03T12:00:00.000Z"),
      log: () => {},
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const files = await readdir(outDir);
    expect(files).toContain("index.json");
    expect(files).toContain("roads.json");
    expect(files.filter((name) => name.startsWith("tile_"))).not.toHaveLength(
      0,
    );
    const writtenIndex: unknown = JSON.parse(
      await readFile(join(outDir, "index.json"), "utf8"),
    );
    expect(writtenIndex).toEqual(result.index);
    expect(result.index.zones).toHaveLength(4);
    expect(result.index.tiles.every((tile) => tile.bytes > 0)).toBe(true);
    expect(result.totalGzipBytes).toBeGreaterThan(0);
    expect(result.totalGzipBytes).toBeLessThan(GZIP_BUDGET_BYTES);
    expect(result.files.map((file) => file.name)).toContain("roads.json");
    expect(
      result.files
        .filter((file) => file.name.startsWith("tile_"))
        .every((file) => file.gzipBytes <= TILE_GZIP_BUDGET_BYTES),
    ).toBe(true);
  });

  it("writes nothing in check mode but still validates", async () => {
    const outDir = join(workDir, "out-check");
    const result = await runBuild({
      outDir,
      cacheDir: join(workDir, "cache"),
      check: true,
      refresh: false,
      fetchImpl,
      config: MINI_LANDMARKS,
      log: () => {},
    });
    expect(result.index.zones).toHaveLength(4);
    await expect(readdir(outDir)).rejects.toThrow();
  });

  it("removes stale tiles from a previous build", async () => {
    const outDir = join(workDir, "out-stale");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "tile_99_99.json"), "{}");
    await runBuild({
      outDir,
      cacheDir: join(workDir, "cache"),
      check: false,
      refresh: false,
      fetchImpl,
      config: MINI_LANDMARKS,
      log: () => {},
    });
    expect(await readdir(outDir)).not.toContain("tile_99_99.json");
  });
});

describe("findOversizedTiles", () => {
  it("returns only tile files over the cap, ignoring non-tile files", () => {
    const capBytes = 150 * 1024;
    const files: BuiltFile[] = [
      { name: "tile_4_2.json", bytes: 400_000, gzipBytes: 160 * 1024 }, // tile, over
      { name: "tile_0_0.json", bytes: 20_000, gzipBytes: 8 * 1024 }, // tile, under
      { name: "roads.json", bytes: 500_000, gzipBytes: 200 * 1024 }, // over, not a tile
    ];
    expect(findOversizedTiles(files, capBytes)).toEqual([files[0]]);
  });
});
