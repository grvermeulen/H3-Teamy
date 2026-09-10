/**
 * `npm run arena:check-sprites` — every sprite the manifest lists has a packed file under
 * `public/arena/sprites/`, the file is under its cap, and `CREDITS.md` there has a row for it
 * (Plan 9). Exits non-zero listing what is missing; the repo is public, so an unattributed image
 * is a licence problem, not a nit.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  parseSpriteManifest,
  type SpriteManifest,
} from "../../src/lib/cityArena/render/sprites";
import type { AudioProblem } from "./check-audio";
import { creditedFiles } from "./credits";
import { isMissing, readIfPresent } from "./files";

/** Where the packed sprites live, relative to the repo root. */
export const SPRITE_DIR = path.join("public", "arena", "sprites");
/** The manifest the pack script writes. */
export const SPRITE_MANIFEST_FILE = path.join(SPRITE_DIR, "manifest.json");
/** The credits table next to the sprites. */
export const SPRITE_CREDITS_FILE = path.join(SPRITE_DIR, "CREDITS.md");

/** One kibibyte. */
const KIB = 1024;

/** Size caps by asset kind; guardrails against an unpacked export, not design limits. */
export type SpriteLimits = {
  surfaceBytes: number;
  vehicleBytes: number;
  longVehicleBytes: number;
  personBytes: number;
};

/** A 128 px tile, a car, a bus, an eight-cell strip. */
export const SPRITE_LIMITS: SpriteLimits = {
  surfaceBytes: 64 * KIB,
  vehicleBytes: 64 * KIB,
  longVehicleBytes: 96 * KIB,
  personBytes: 48 * KIB,
};

/** Vehicles at least this long get the longer cap. */
export const LONG_VEHICLE_M = 8;

/** One file the manifest names, with the cap that applies to it. */
type SpriteEntry = { file: string; cap: number };

/** Every file the manifest names, with its cap. */
function entriesOf(
  manifest: SpriteManifest,
  limits: SpriteLimits,
): SpriteEntry[] {
  const surfaces = Object.values(manifest.surfaces).map((entry) => ({
    file: entry.file,
    cap: limits.surfaceBytes,
  }));
  const vehicles = Object.values(manifest.vehicles).map((entry) => ({
    file: entry.file,
    cap:
      entry.lengthMetres >= LONG_VEHICLE_M
        ? limits.longVehicleBytes
        : limits.vehicleBytes,
  }));
  const people = Object.values(manifest.people).map((entry) => ({
    file: entry.file,
    cap: limits.personBytes,
  }));
  return [...surfaces, ...vehicles, ...people];
}

/**
 * Checks the packed files and the credits and lists what is wrong.
 *
 * @param publicDir - The directory the manifest's `/arena/sprites/...` paths are served from.
 * @param manifest - The parsed manifest.
 * @param credits - The contents of `CREDITS.md`, or null when it does not exist.
 * @param limits - The size caps; the defaults unless a test lowers them.
 * @returns The problems, empty when everything is in order.
 */
export async function auditSprites(
  publicDir: string,
  manifest: SpriteManifest,
  credits: string | null,
  limits: SpriteLimits = SPRITE_LIMITS,
): Promise<AudioProblem[]> {
  const problems: AudioProblem[] = [];
  const credited = creditedFiles(credits);
  for (const entry of entriesOf(manifest, limits)) {
    const name = path.basename(entry.file);
    try {
      const info = await stat(path.join(publicDir, entry.file));
      if (info.size > entry.cap)
        problems.push({
          file: name,
          problem: `${Math.round(info.size / KIB)} KB, over the ${entry.cap / KIB} KB cap`,
        });
    } catch (error: unknown) {
      if (!isMissing(error)) throw error;
      problems.push({ file: name, problem: "no such file" });
    }
    if (!credited.has(name))
      problems.push({ file: name, problem: "no row in CREDITS.md" });
  }
  return problems;
}

/** Runs the audit against the working tree and reports. */
async function main(): Promise<void> {
  const manifest = parseSpriteManifest(
    JSON.parse(await readFile(SPRITE_MANIFEST_FILE, "utf8")),
  );
  const credits = await readIfPresent(SPRITE_CREDITS_FILE);
  const problems = await auditSprites("public", manifest, credits);
  const count = entriesOf(manifest, SPRITE_LIMITS).length;
  if (problems.length === 0) {
    console.log(`arena sprites: ${count} files present and credited.`);
    return;
  }
  for (const { file, problem } of problems)
    console.error(`${file}: ${problem}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.basename(process.argv[1]) === "check-sprites.ts")
  void main();
