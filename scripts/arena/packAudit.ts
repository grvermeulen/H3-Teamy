/**
 * The audit the packed 3D asset sets share (`arena:check-characters`, `arena:check-cars`): every
 * file the manifest names is present, no stray `.glb` sits beside them, the set stays within its
 * budget, and `CREDITS.md` has exactly one row per file. The repo is public, so an unattributed
 * model is a licence problem, not a nit.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { AudioProblem } from "./check-audio";
import { creditedFiles, creditedTwice } from "./credits";
import { isMissing } from "./files";

/** How the audit reads the directory; injectable so a test can fail it. */
export type PackFs = {
  stat(file: string): Promise<{ size: number }>;
  list(dir: string): Promise<string[]>;
};

/** The filesystem. */
export const NODE_PACK_FS: PackFs = { stat, list: (dir) => readdir(dir) };

/** One kibibyte. */
const KIB = 1024;
/** The packed files' extension. */
const GLB = ".glb";

/** The size of each named file (missing files are reported and count as nothing). */
async function sizesOf(
  dir: string,
  files: readonly string[],
  fs: PackFs,
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

/** What one audit checks. */
export type PackAudit = {
  /** The directory the files are packed into. */
  dir: string;
  /** Every file the manifest names. */
  files: readonly string[];
  /** The contents of `CREDITS.md`, or null when it does not exist. */
  credits: string | null;
  /** The most the files may weigh together. */
  budgetBytes: number;
};

/**
 * Checks the packed files, the budget and the credits, and lists what is wrong.
 *
 * @param audit - The directory, the manifest's files, the credits and the budget.
 * @param fs - Directory access; the filesystem unless a test says otherwise.
 * @returns The problems, empty when everything is in order.
 */
export async function auditPack(
  audit: PackAudit,
  fs: PackFs = NODE_PACK_FS,
): Promise<AudioProblem[]> {
  const problems: AudioProblem[] = [];
  const { dir, files, credits, budgetBytes } = audit;
  const total = await sizesOf(dir, files, fs, problems);
  if (total > budgetBytes)
    problems.push({
      file: path.basename(dir),
      problem: `${Math.round(total / KIB)} KB together, over the ${budgetBytes / KIB} KB budget`,
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

/**
 * Prints an audit's outcome and sets a failing exit code when anything is wrong.
 *
 * @param problems - What the audit found.
 * @param allWell - The line to print when it found nothing.
 */
export function reportPack(
  problems: readonly AudioProblem[],
  allWell: string,
): void {
  if (problems.length === 0) {
    console.log(allWell);
    return;
  }
  for (const { file, problem } of problems)
    console.error(`${file}: ${problem}`);
  process.exitCode = 1;
}
