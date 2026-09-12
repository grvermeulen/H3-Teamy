// scripts/arena/build-map.ts
/**
 * Builds the committed map asset from OpenStreetMap via Overpass.
 *
 *   npm run arena:build-map            # fetch (cached), assemble, write public/arena/map/<version>/
 *   npm run arena:build-map:check      # validate + budget only, write nothing
 *   tsx scripts/arena/build-map.ts --refresh --out=public/arena/map/v2
 */
import { MAP_VERSION } from "../../src/lib/cityArena/constants";
import { MapBuildError } from "../../src/lib/cityArena/mapBuild/errors";
import { runBuild } from "./buildMap";

function readFlag(name: string): string | undefined {
  const prefixed = `--${name}=`;
  const entry = process.argv.find((argument) => argument.startsWith(prefixed));
  return entry ? entry.slice(prefixed.length) : undefined;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const refresh = process.argv.includes("--refresh");
  const outDir = readFlag("out") ?? `public/arena/map/${MAP_VERSION}`;
  await runBuild({ outDir, cacheDir: ".cache/arena", check, refresh });
}

main().catch((error: unknown) => {
  if (error instanceof MapBuildError) {
    console.error(`\n✖ Map build failed:\n${error.message}`);
  } else {
    console.error("\n✖ Unexpected error:", error);
  }
  process.exit(1);
});
