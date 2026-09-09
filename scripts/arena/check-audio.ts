/**
 * `npm run arena:check-audio` — every clip in the clip table has a file under
 * `public/arena/audio/`, the file is under the size cap, and `CREDITS.md` has a row for it
 * (Plan 6, Task 2). Exits non-zero listing what is missing; the repo is public, so an
 * unattributed clip is a licence problem, not a nit.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AUDIO_CLIPS, CLIP_NAMES } from "../../src/lib/cityArena/audio/clips";

/** Where the files live, relative to the repo root. */
const AUDIO_DIR = path.join("public", "arena", "audio");
/** The credits table next to the files. */
const CREDITS_FILE = path.join(AUDIO_DIR, "CREDITS.md");
/** The most one clip may weigh; a guardrail against an uncompressed export, not a design limit. */
export const MAX_CLIP_BYTES = 200 * 1024;

/** One problem with one clip. */
export type AudioProblem = { file: string; problem: string };

/**
 * Checks the files and the credits and lists what is wrong.
 *
 * @param dir - The audio directory.
 * @param credits - The contents of `CREDITS.md`, or null when it does not exist.
 * @returns The problems, empty when everything is in order.
 */
export async function auditAudio(
  dir: string,
  credits: string | null,
): Promise<AudioProblem[]> {
  const problems: AudioProblem[] = [];
  const credited = new Set(
    (credits ?? "")
      .split("\n")
      .filter((line) => line.startsWith("| ") && !line.startsWith("| ---"))
      .map((line) => line.split("|")[1]?.trim() ?? ""),
  );
  for (const clip of CLIP_NAMES) {
    const { file } = AUDIO_CLIPS[clip];
    try {
      const info = await stat(path.join(dir, file));
      if (info.size > MAX_CLIP_BYTES)
        problems.push({
          file,
          problem: `${Math.round(info.size / 1024)} KB, over the ${MAX_CLIP_BYTES / 1024} KB cap`,
        });
    } catch {
      problems.push({ file, problem: "no such file" });
    }
    if (!credited.has(file))
      problems.push({ file, problem: "no row in CREDITS.md" });
  }
  return problems;
}

/** Runs the audit against the working tree and reports. */
async function main(): Promise<void> {
  let credits: string | null = null;
  try {
    credits = await readFile(CREDITS_FILE, "utf8");
  } catch {
    credits = null;
  }
  const problems = await auditAudio(AUDIO_DIR, credits);
  if (problems.length === 0) {
    console.log(
      `arena audio: ${CLIP_NAMES.length} clips present and credited.`,
    );
    return;
  }
  for (const { file, problem } of problems)
    console.error(`${file}: ${problem}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.basename(process.argv[1]) === "check-audio.ts")
  void main();
