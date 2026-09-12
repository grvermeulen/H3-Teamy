/**
 * The radio side of `npm run arena:check-audio` (Plan 7, Task 5): every track in the manifest
 * has a file under `public/arena/radio/tracks/` and a row in `CREDITS.md`, no track is over the
 * per-track cap, the set is under the budget, and no file lies in the directory that the manifest
 * does not name — the repo carries the tracks, so an orphan is weight for nothing.
 */

import { stat } from "node:fs/promises";
import path from "node:path";
import type {
  RadioManifest,
  RadioTrack,
} from "../../src/lib/cityArena/audio/radio/stations";
import type { AudioProblem } from "./check-audio";
import { creditedFiles } from "./credits";
import { isMissing } from "./files";

/** Where the tracks live, relative to the repo root. */
export const RADIO_TRACK_DIR = path.join("public", "arena", "radio", "tracks");
/** The credits table next to the tracks. */
export const RADIO_CREDITS_FILE = path.join(
  "public",
  "arena",
  "radio",
  "CREDITS.md",
);
/** The manifest the dial is read from. */
export const RADIO_MANIFEST_FILE = path.join(
  "src",
  "lib",
  "cityArena",
  "audio",
  "radio",
  "stations.json",
);

/** One mebibyte. */
const MIB = 1024 * 1024;

/** The size caps: one track, and the whole set. */
export type RadioLimits = { trackBytes: number; totalBytes: number };

/**
 * A track at 96 kbps weighs ~0.7 MiB a minute; the set sits in git next to a 3.8 MB map. The
 * budget went from 8 to 16 MiB on 2026-09-10 for a dial of six stations — raise it again rather
 * than thin the dial.
 */
export const RADIO_LIMITS: RadioLimits = {
  trackBytes: 1.6 * MIB,
  totalBytes: 16 * MIB,
};

/** Every track of every station, in dial order. */
function tracksOf(manifest: RadioManifest): RadioTrack[] {
  return manifest.stations.flatMap((station) => station.tracks);
}

/** Checks one track's file; returns its size, or null when there is no file. */
async function auditTrack(
  dir: string,
  track: RadioTrack,
  limits: RadioLimits,
  problems: AudioProblem[],
): Promise<number | null> {
  try {
    const info = await stat(path.join(dir, track.file));
    if (info.size > limits.trackBytes)
      problems.push({
        file: track.file,
        problem: `${(info.size / MIB).toFixed(2)} MiB, over the ${(limits.trackBytes / MIB).toFixed(1)} MiB cap`,
      });
    return info.size;
  } catch (error: unknown) {
    if (!isMissing(error)) throw error;
    problems.push({ file: track.file, problem: "no such file" });
    return null;
  }
}

/**
 * Checks the tracks, the credits and the budget, and lists what is wrong.
 *
 * @param dir - The tracks directory.
 * @param manifest - The dial.
 * @param credits - The contents of the radio `CREDITS.md`, or null when it does not exist.
 * @param files - The file names actually in the directory.
 * @param limits - The size caps; the defaults unless a test lowers them.
 * @returns The problems, empty when everything is in order.
 */
export async function auditRadio(
  dir: string,
  manifest: RadioManifest,
  credits: string | null,
  files: string[],
  limits: RadioLimits = RADIO_LIMITS,
): Promise<AudioProblem[]> {
  const problems: AudioProblem[] = [];
  const credited = creditedFiles(credits);
  const listed = new Set<string>();
  let total = 0;
  for (const track of tracksOf(manifest)) {
    listed.add(track.file);
    total += (await auditTrack(dir, track, limits, problems)) ?? 0;
    if (!credited.has(track.file))
      problems.push({ file: track.file, problem: "no row in CREDITS.md" });
  }
  for (const file of files)
    if (!listed.has(file))
      problems.push({ file, problem: "not in stations.json" });
  if (total > limits.totalBytes)
    problems.push({
      file: "(all tracks)",
      problem: `${(total / MIB).toFixed(2)} MiB together, over the ${(limits.totalBytes / MIB).toFixed(1)} MiB budget`,
    });
  return problems;
}
