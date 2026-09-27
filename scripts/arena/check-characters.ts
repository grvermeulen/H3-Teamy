/**
 * `npm run arena:check-characters` — every model and animation file the character manifest names
 * is packed under `public/arena/characters/`, no stray `.glb` sits beside them, the set stays
 * within its budget (spec §7: 3 MB together), and `CREDITS.md` has exactly one row per file.
 * Exits non-zero listing what is wrong; the repo is public, so an unattributed model is a licence
 * problem, not a nit.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  CharacterManifestSchema,
  type CharacterManifest,
} from "../../src/lib/cityArena/characterManifest";
import type { AudioProblem } from "./check-audio";
import { creditedFiles, creditedTwice } from "./credits";
import { isMissing, readIfPresent } from "./files";
import { CHARACTER_OUT_DIR } from "./packCharacters";

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
/** One kibibyte. */
const KIB = 1024;
/** Every character file together may weigh this much (spec §7). */
export const CHARACTER_BUDGET_BYTES = 3 * MIB;
/** The packed files' extension. */
const GLB = ".glb";

/** How the audit reads the directory; injectable so a test can fail it. */
export type CharacterFs = {
  stat(file: string): Promise<{ size: number }>;
  list(dir: string): Promise<string[]>;
};

/** The filesystem. */
const NODE_FS: CharacterFs = { stat, list: (dir) => readdir(dir) };

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

/** The size of each named file (missing files are reported and count as nothing). */
async function sizesOf(
  dir: string,
  files: readonly string[],
  fs: CharacterFs,
  problems: AudioProblem[],
): Promise<number> {
  let total = 0;
  for (const file of files) {
    try {
      total += (await fs.stat(path.join(dir, file))).size;
    } catch (error: unknown) {
      if (!isMissing(error)) throw error;
      problems.push({ file, problem: "no such file" });
    }
  }
  return total;
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
  fs: CharacterFs = NODE_FS,
): Promise<AudioProblem[]> {
  const problems: AudioProblem[] = [];
  const files = manifestFiles(manifest);
  const total = await sizesOf(dir, files, fs, problems);
  if (total > CHARACTER_BUDGET_BYTES)
    problems.push({
      file: path.basename(dir),
      problem: `${Math.round(total / KIB)} KB together, over the ${CHARACTER_BUDGET_BYTES / KIB} KB budget`,
    });
  const named = new Set(files);
  for (const file of await fs.list(dir))
    if (file.endsWith(GLB) && !named.has(file))
      problems.push({ file, problem: "not in manifest.json" });
  const credited = creditedFiles(credits);
  for (const file of files)
    if (!credited.has(file))
      problems.push({ file, problem: "no row in CREDITS.md" });
  for (const file of creditedTwice(credits))
    problems.push({ file, problem: "credited twice in CREDITS.md" });
  return problems;
}

/** Runs the audit against the working tree and reports. */
async function main(): Promise<void> {
  const manifest = CharacterManifestSchema.parse(
    JSON.parse(await readFile(CHARACTER_MANIFEST_FILE, "utf8")),
  );
  const credits = await readIfPresent(CHARACTER_CREDITS_FILE);
  const problems = await auditCharacters(CHARACTER_OUT_DIR, manifest, credits);
  if (problems.length === 0) {
    console.log(
      `arena characters: ${manifestFiles(manifest).length} files present, credited and within budget.`,
    );
    return;
  }
  for (const { file, problem } of problems)
    console.error(`${file}: ${problem}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.basename(process.argv[1]) === "check-characters.ts")
  void main();
