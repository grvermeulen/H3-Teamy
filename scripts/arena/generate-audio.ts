/**
 * Generates the arena's sound clips with ElevenLabs' Sound Effects API (Plan 6, Task 2).
 *
 * One request per clip in the clip table, with the prompt below, written to
 * `public/arena/audio/<file>` in the format the table expects (mono-friendly MP3, 44.1 kHz,
 * 96 kbps) and recorded in `public/arena/audio/CREDITS.md`, one row per file. Loops (the engine,
 * the siren) are requested as seamless loops.
 *
 * Needs `ELEVENLABS_API_KEY` in the environment (`.env.local`, never the repo). Run:
 *
 *   npx tsx scripts/arena/generate-audio.ts            # every clip that has no file yet
 *   npx tsx scripts/arena/generate-audio.ts engine skid # these clips, replacing the files
 *
 * Each run spends credits on the owner's ElevenLabs plan, so nothing is regenerated unless named.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AUDIO_CLIPS,
  CLIP_NAMES,
  type ClipName,
} from "../../src/lib/cityArena/audio/clips";

/** Where the files go, relative to the repo root. */
const AUDIO_DIR = path.join("public", "arena", "audio");
/** The credits table next to the files. */
const CREDITS_FILE = path.join(AUDIO_DIR, "CREDITS.md");
/** ElevenLabs' sound-effects endpoint; the format is a query parameter, the rest is the body. */
const ENDPOINT = "https://api.elevenlabs.io/v1/sound-generation";
/** What the clip table expects: MP3, 44.1 kHz, 96 kbps. */
const OUTPUT_FORMAT = "mp3_44100_96";
/** How closely the model follows the prompt; higher is more literal, lower more creative. */
const PROMPT_INFLUENCE = 0.4;
/** A pause between requests, so a run of eleven does not trip the API's own rate limit. */
const PAUSE_MS = 1500;

/** What to ask for, and how long. Loops come from the table. */
const PROMPTS: Record<ClipName, { text: string; seconds: number }> = {
  pistol: {
    text: "single dry 9mm pistol gunshot, close up, short tail, no music, no voices",
    seconds: 0.7,
  },
  uzi: {
    text: "single submachine gun shot, snappy and mechanical, close up, short tail",
    seconds: 0.5,
  },
  shotgun: {
    text: "pump shotgun blast, heavy low thump, short room reverb",
    seconds: 1.0,
  },
  footstep: {
    text: "one footstep of a sneaker on asphalt, close, dry",
    seconds: 0.4,
  },
  engine: {
    text: "small car engine idling steadily, heard from inside the car, seamless loop, no revving",
    seconds: 4,
  },
  skid: {
    text: "car tyres squealing on asphalt during a skid, seamless loop",
    seconds: 2,
  },
  impact: {
    text: "car bumper hitting metal, dull heavy crunch, no glass, short",
    seconds: 0.8,
  },
  explosion: {
    text: "car exploding on a city street, deep boom with debris falling, medium tail",
    seconds: 2.5,
  },
  siren: {
    text: "European police car two-tone siren, steady, seamless loop",
    seconds: 4,
  },
  pickup: {
    text: "small bright arcade pickup chime, two quick notes rising",
    seconds: 0.5,
  },
  death: {
    text: "short dramatic low orchestral sting for a game over, no melody",
    seconds: 1.5,
  },
};

/** True when the file exists. */
async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/** Asks ElevenLabs for one clip and returns the MP3 bytes. */
async function generate(key: string, clip: ClipName): Promise<Uint8Array> {
  const prompt = PROMPTS[clip];
  const response = await fetch(`${ENDPOINT}?output_format=${OUTPUT_FORMAT}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: prompt.text,
      duration_seconds: prompt.seconds,
      loop: AUDIO_CLIPS[clip].loop,
      prompt_influence: PROMPT_INFLUENCE,
    }),
  });
  if (!response.ok)
    throw new Error(
      `ElevenLabs answered ${response.status} for ${clip}: ${await response.text()}`,
    );
  return new Uint8Array(await response.arrayBuffer());
}

/** The credits table with a row for `clip`, replacing any earlier row for the same file. */
function creditsWith(existing: string, clip: ClipName): string {
  const file = AUDIO_CLIPS[clip].file;
  const header = [
    "# Audio credits",
    "",
    "Every clip under `public/arena/audio/`, where it came from, and the licence it carries.",
    "",
    "| File | Source | Author | Licence | URL |",
    "| --- | --- | --- | --- | --- |",
  ];
  const row = `| ${file} | Generated with ElevenLabs Sound Effects (prompt: "${PROMPTS[clip].text}") | ElevenLabs, for H3-Teamy | ElevenLabs paid-plan commercial licence; not for redistribution as a standalone sample | https://elevenlabs.io/sound-effects |`;
  const rows = existing
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("| ") &&
        !line.startsWith("| File") &&
        !line.startsWith("| ---"),
    )
    .filter((line) => !line.startsWith(`| ${file} |`));
  return [...header, ...rows, row].join("\n") + "\n";
}

/** Generates the clips named on the command line, or every clip without a file. */
async function main(): Promise<void> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  const named = process.argv.slice(2) as ClipName[];
  for (const name of named)
    if (!(name in AUDIO_CLIPS)) throw new Error(`Unknown clip: ${name}`);
  await mkdir(AUDIO_DIR, { recursive: true });
  let credits = (await exists(CREDITS_FILE))
    ? await readFile(CREDITS_FILE, "utf8")
    : "";
  const wanted =
    named.length > 0
      ? named
      : (
          await Promise.all(
            CLIP_NAMES.map(async (clip) => ({
              clip,
              present: await exists(
                path.join(AUDIO_DIR, AUDIO_CLIPS[clip].file),
              ),
            })),
          )
        )
          .filter(({ present }) => !present)
          .map(({ clip }) => clip);
  if (wanted.length === 0) {
    console.log("Every clip has a file; name clips to regenerate them.");
    return;
  }
  for (const clip of wanted) {
    process.stdout.write(`${clip} … `);
    const bytes = await generate(key, clip);
    await writeFile(path.join(AUDIO_DIR, AUDIO_CLIPS[clip].file), bytes);
    credits = creditsWith(credits, clip);
    await writeFile(CREDITS_FILE, credits);
    console.log(`${Math.round(bytes.byteLength / 1024)} KB`);
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
