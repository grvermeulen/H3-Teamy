/**
 * `npm run arena:check-characters` — every model and animation file the character manifest names
 * is packed under `public/arena/characters/`, no stray `.glb` sits beside them, the set stays
 * within its budget (spec §7: 3 MB together), and `CREDITS.md` has exactly one row per file.
 * Exits non-zero listing what is wrong; the repo is public, so an unattributed model is a licence
 * problem, not a nit.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CharacterManifestSchema,
  type CharacterManifest,
} from "../../src/lib/cityArena/characterManifest";
import type { AudioProblem } from "./check-audio";
import { readIfPresent } from "./files";
import { CHARACTER_OUT_DIR } from "./packCharacters";
import { auditPack, reportPack, type PackFs } from "./packAudit";

/** The manifest the pack writes. */
export const CHARACTER_MANIFEST_FILE = path.join(
  CHARACTER_OUT_DIR,
  "manifest.json",
);
/** The credits table next to the files. */
export const CHARACTER_CREDITS_FILE = path.join(
  CHARACTER_OUT_DIR,
  "CREDITS.md",
);

/** One mebibyte. */
const MIB = 1024 * 1024;
/** Every character file together may weigh this much (spec §7). */
export const CHARACTER_BUDGET_BYTES = 3 * MIB;

/** How the audit reads the directory; injectable so a test can fail it. */
export type CharacterFs = PackFs;

/**
 * Every file the manifest names: the models, then the rigs' animations.
 *
 * @param manifest - The parsed manifest.
 * @returns The file names, relative to the characters directory.
 */
export function manifestFiles(manifest: CharacterManifest): string[] {
  return [
    ...Object.values(manifest.models).map((model) => model.file),
    ...Object.values(manifest.animations).map((rig) => rig.file),
  ];
}

/**
 * Checks the packed files, the budget and the credits, and lists what is wrong.
 *
 * @param dir - The characters directory.
 * @param manifest - The parsed manifest.
 * @param credits - The contents of `CREDITS.md`, or null when it does not exist.
 * @param fs - Directory access; the filesystem unless a test says otherwise.
 * @returns The problems, empty when everything is in order.
 */
export async function auditCharacters(
  dir: string,
  manifest: CharacterManifest,
  credits: string | null,
  fs?: CharacterFs,
): Promise<AudioProblem[]> {
  return auditPack(
    {
      dir,
      files: manifestFiles(manifest),
      credits,
      budgetBytes: CHARACTER_BUDGET_BYTES,
    },
    fs,
  );
}

/** Runs the audit against the working tree and reports. */
async function main(): Promise<void> {
  const manifest = CharacterManifestSchema.parse(
    JSON.parse(await readFile(CHARACTER_MANIFEST_FILE, "utf8")),
  );
  const credits = await readIfPresent(CHARACTER_CREDITS_FILE);
  reportPack(
    await auditCharacters(CHARACTER_OUT_DIR, manifest, credits),
    `arena characters: ${manifestFiles(manifest).length} files present, credited and within budget.`,
  );
}

if (process.argv[1] && path.basename(process.argv[1]) === "check-characters.ts")
  void main();
