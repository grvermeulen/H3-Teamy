// scripts/arena/buildMap.ts
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { assembleMap } from "../../src/lib/cityArena/mapBuild/assemble";
import { MapBuildError } from "../../src/lib/cityArena/mapBuild/errors";
import {
  LANDMARKS,
  type LandmarkConfig,
} from "../../src/lib/cityArena/mapBuild/landmarks.config";
import { matchLandmarks } from "../../src/lib/cityArena/mapBuild/landmarks";
import {
  osmElementId,
  type LatLon,
} from "../../src/lib/cityArena/mapBuild/osmTypes";
import {
  buildAreasQuery,
  buildBuildingsQuery,
  buildLandmarkQuery,
  buildRoadsQuery,
} from "../../src/lib/cityArena/mapBuild/overpassQueries";
import type { MapIndex } from "../../src/lib/cityArena/world/mapTypes";
import { fetchOverpass } from "./overpass";

/** Hard ceiling for the gzipped size of all asset files together (a repo/CDN figure). */
export const GZIP_BUDGET_BYTES = 1200 * 1024;

/**
 * Hard ceiling for any single tile's gzipped size. A player only downloads the ≤ 9 tiles
 * around them, so this — not the total — is what bounds their actual download time.
 * Owner decision 2026-09-04: 256 KB comfortably covers a complete town core within the
 * 1.2 km building-keep radius (the Wageningen–campus tile, the largest, is ≈ 203 KB).
 */
export const TILE_GZIP_BUDGET_BYTES = 256 * 1024;

/** Options for {@link runBuild}. */
export type RunBuildOptions = {
  outDir: string;
  cacheDir: string;
  check: boolean;
  refresh: boolean;
  fetchImpl?: typeof fetch;
  config?: LandmarkConfig[];
  now?: () => Date;
  log?: (line: string) => void;
};

/** Size report for one written (or would-be-written) file. */
export type BuiltFile = { name: string; bytes: number; gzipBytes: number };

/** Result of a build or check run. */
export type RunBuildResult = {
  totalGzipBytes: number;
  files: BuiltFile[];
  index: MapIndex;
};

function measure(name: string, json: string): BuiltFile {
  const buffer = Buffer.from(json, "utf8");
  return {
    name,
    bytes: buffer.byteLength,
    gzipBytes: gzipSync(buffer).byteLength,
  };
}

/** Tile files (`name` starting with `tile_`) whose gzipped size exceeds `capBytes`. */
export function findOversizedTiles(
  files: BuiltFile[],
  capBytes: number,
): BuiltFile[] {
  return files.filter(
    (file) => file.name.startsWith("tile_") && file.gzipBytes > capBytes,
  );
}

/** Fetches, assembles, validates and (unless `check`) writes the map asset. */
export async function runBuild(
  options: RunBuildOptions,
): Promise<RunBuildResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const config = options.config ?? LANDMARKS;
  const fetchOptions = {
    cacheDir: options.cacheDir,
    refresh: options.refresh,
    fetchImpl: options.fetchImpl,
    log,
  };

  log("Stage 1/4: landmarks");
  const landmarkOsm = await fetchOverpass(
    buildLandmarkQuery(config.map((landmark) => landmark.nameMatch)),
    fetchOptions,
  );
  const match = matchLandmarks(landmarkOsm, config);
  if (match.errors.length > 0) throw new MapBuildError(match.errors.join("\n"));
  const anchorCentres: LatLon[] = match.matched
    .filter((matched) => matched.config.zoneAnchor)
    .map((matched) => matched.center);
  if (anchorCentres.length !== 4) {
    throw new MapBuildError(
      `Expected 4 zone anchors, found ${anchorCentres.length}`,
    );
  }
  const landmarkElementIds = match.matched.map((matched) =>
    osmElementId(matched.element),
  );

  log("Stage 2/4: roads, areas and buildings");
  const [roadsOsm, areasOsm, buildingsOsm] = await Promise.all([
    fetchOverpass(buildRoadsQuery(anchorCentres), fetchOptions),
    fetchOverpass(buildAreasQuery(), fetchOptions),
    fetchOverpass(
      buildBuildingsQuery(anchorCentres, landmarkElementIds),
      fetchOptions,
    ),
  ]);

  log("Stage 3/4: assemble");
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const assembled = assembleMap({
    landmarkOsm,
    roadsOsm,
    areasOsm,
    buildingsOsm,
    config,
    generatedAt,
  });

  log("Stage 4/4: serialise and check budget");
  const tileJson = new Map<string, string>();
  for (const tile of assembled.tiles) {
    const ref = assembled.index.tiles.find(
      (candidate) => candidate.x === tile.x && candidate.y === tile.y,
    );
    const json = JSON.stringify(tile);
    if (ref) ref.bytes = Buffer.byteLength(json, "utf8");
    tileJson.set(ref?.file ?? `tile_${tile.x}_${tile.y}.json`, json);
  }
  const indexJson = JSON.stringify(assembled.index);
  const roadsJson = JSON.stringify(assembled.roads);
  const files: BuiltFile[] = [
    measure("index.json", indexJson),
    measure("roads.json", roadsJson),
    ...[...tileJson.entries()].map(([name, json]) => measure(name, json)),
  ];
  const totalGzipBytes = files.reduce(
    (total, file) => total + file.gzipBytes,
    0,
  );
  for (const file of files) {
    log(
      `  ${file.name.padEnd(20)} ${String(file.bytes).padStart(9)} B  ${String(file.gzipBytes).padStart(8)} B gz`,
    );
  }
  log(
    `Total gzipped: ${(totalGzipBytes / 1024).toFixed(1)} KB (budget ${(GZIP_BUDGET_BYTES / 1024).toFixed(0)} KB, tile cap ${(TILE_GZIP_BUDGET_BYTES / 1024).toFixed(0)} KB)`,
  );
  const oversizedTiles = findOversizedTiles(files, TILE_GZIP_BUDGET_BYTES);
  if (oversizedTiles.length > 0) {
    throw new MapBuildError(
      `Tile(s) exceed the ${(TILE_GZIP_BUDGET_BYTES / 1024).toFixed(0)} KB per-tile gzip cap: ${oversizedTiles
        .map(
          (file) => `${file.name} (${(file.gzipBytes / 1024).toFixed(1)} KB)`,
        )
        .join(", ")}`,
    );
  }
  if (totalGzipBytes > GZIP_BUDGET_BYTES) {
    throw new MapBuildError(
      `Asset exceeds gzip budget: ${totalGzipBytes} > ${GZIP_BUDGET_BYTES} bytes`,
    );
  }
  if (options.check) {
    log("Check mode: nothing written");
    return { totalGzipBytes, files, index: assembled.index };
  }

  await mkdir(options.outDir, { recursive: true });
  for (const existing of await readdir(options.outDir)) {
    if (existing.startsWith("tile_") && existing.endsWith(".json"))
      await rm(join(options.outDir, existing));
  }
  await writeFile(join(options.outDir, "index.json"), indexJson);
  await writeFile(join(options.outDir, "roads.json"), roadsJson);
  for (const [name, json] of tileJson)
    await writeFile(join(options.outDir, name), json);
  log(`Wrote ${files.length} files to ${options.outDir}`);
  return { totalGzipBytes, files, index: assembled.index };
}
