/**
 * `npm run arena:check-cars` — every car file the manifest names is packed under
 * `public/arena/cars/`, no stray `.glb` sits beside them, the set stays within its budget (spec §8:
 * 1.5 MB together), and `CREDITS.md` has exactly one row per file. Exits non-zero listing what is
 * wrong.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CarManifestSchema,
  type CarManifest,
} from "../../src/lib/cityArena/carManifest";
import type { AudioProblem } from "./check-audio";
import { readIfPresent } from "./files";
import { auditPack, reportPack, type PackFs } from "./packAudit";
import { CAR_OUT_DIR } from "./packCars";

/** The manifest the pack writes. */
export const CAR_MANIFEST_FILE = path.join(CAR_OUT_DIR, "manifest.json");
/** The credits table next to the files. */
export const CAR_CREDITS_FILE = path.join(CAR_OUT_DIR, "CREDITS.md");

/** One kibibyte. */
const KIB = 1024;
/** Every car file together may weigh this much (spec §8). */
export const CAR_BUDGET_BYTES = 1536 * KIB;

/**
 * Every file the manifest names.
 *
 * @param manifest - The parsed manifest.
 * @returns The file names, relative to the cars directory.
 */
export function carManifestFiles(manifest: CarManifest): string[] {
  return Object.values(manifest.cars).map((car) => car.file);
}

/**
 * Checks the packed files, the budget and the credits, and lists what is wrong.
 *
 * @param dir - The cars directory.
 * @param manifest - The parsed manifest.
 * @param credits - The contents of `CREDITS.md`, or null when it does not exist.
 * @param fs - Directory access; the filesystem unless a test says otherwise.
 * @returns The problems, empty when everything is in order.
 */
export async function auditCars(
  dir: string,
  manifest: CarManifest,
  credits: string | null,
  fs?: PackFs,
): Promise<AudioProblem[]> {
  return auditPack(
    {
      dir,
      files: carManifestFiles(manifest),
      credits,
      budgetBytes: CAR_BUDGET_BYTES,
    },
    fs,
  );
}

/** Runs the audit against the working tree and reports. */
async function main(): Promise<void> {
  const manifest = CarManifestSchema.parse(
    JSON.parse(await readFile(CAR_MANIFEST_FILE, "utf8")),
  );
  const credits = await readIfPresent(CAR_CREDITS_FILE);
  reportPack(
    await auditCars(CAR_OUT_DIR, manifest, credits),
    `arena cars: ${carManifestFiles(manifest).length} files present, credited and within budget.`,
  );
}

if (process.argv[1] && path.basename(process.argv[1]) === "check-cars.ts")
  void main();
