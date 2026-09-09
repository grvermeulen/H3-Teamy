/**
 * `npm run arena:check-audio` — every clip in the clip table has a file under
 * `public/arena/audio/`, the file is under the size cap, and `CREDITS.md` has a row for it
 * (Plan 6, Task 2); and the same for the radio's tracks and their manifest (Plan 7, Task 5,
 * `check-radio.ts`). Exits non-zero listing what is missing; the repo is public, so an
 * unattributed clip is a licence problem, not a nit.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { AUDIO_CLIPS, CLIP_NAMES } from "../../src/lib/cityArena/audio/clips";
import {
  RadioManifestSchema,
  type RadioManifest,
} from "../../src/lib/cityArena/audio/radio/stations";
import {
  RADIO_CREDITS_FILE,
  RADIO_MANIFEST_FILE,
  RADIO_TRACK_DIR,
  auditRadio,
} from "./check-radio";
import { creditedFiles } from "./credits";

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
  const credited = creditedFiles(credits);
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

/** The radio's inputs from the working tree: the dial, the files present, the credits. */
async function readRadio(): Promise<{
  manifest: RadioManifest;
  files: string[];
  credits: string | null;
}> {
  const manifest = RadioManifestSchema.parse(
    JSON.parse(await readFile(RADIO_MANIFEST_FILE, "utf8")),
  );
  const files = await readdir(RADIO_TRACK_DIR).catch(() => [] as string[]);
  const credits = await readFile(RADIO_CREDITS_FILE, "utf8").catch(() => null);
  return {
    manifest,
    files: files.filter((file) => file.endsWith(".mp3")),
    credits,
  };
}

/** Runs both audits against the working tree and reports. */
async function main(): Promise<void> {
  const credits = await readFile(CREDITS_FILE, "utf8").catch(() => null);
  const radio = await readRadio();
  const tracks = radio.manifest.stations.reduce(
    (count, station) => count + station.tracks.length,
    0,
  );
  const problems = [
    ...(await auditAudio(AUDIO_DIR, credits)),
    ...(await auditRadio(
      RADIO_TRACK_DIR,
      radio.manifest,
      radio.credits,
      radio.files,
    )),
  ];
  if (problems.length === 0) {
    console.log(
      `arena audio: ${CLIP_NAMES.length} clips and ${tracks} radio tracks present and credited.`,
    );
    return;
  }
  for (const { file, problem } of problems)
    console.error(`${file}: ${problem}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.basename(process.argv[1]) === "check-audio.ts")
  void main();
