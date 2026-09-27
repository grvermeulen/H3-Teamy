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
import { fileOfRow } from "./credits";

/** Where the files go, relative to the repo root. */
const AUDIO_DIR = path.join("public", "arena", "audio");
/** The credits table next to the files. */
const CREDITS_FILE = path.join(AUDIO_DIR, "CREDITS.md");
/** ElevenLabs' sound-effects endpoint; the format is a query parameter, the rest is the body. */
const ENDPOINT = "https://api.elevenlabs.io/v1/sound-generation";
/** What the clip table expects: MP3, 44.1 kHz, 96 kbps. */
const OUTPUT_FORMAT = "mp3_44100_96";
/**
 * The ambience beds are long, quiet noise-like loops mixed far under everything else: 64 kbps
 * keeps a 22 s loop under the per-clip size cap without anyone hearing the difference.
 */
const AMBIENCE_FORMAT = "mp3_44100_64";
/** Seconds of an ambience loop (spec §6: 20–30 s, so the repeat is not noticed). */
const AMBIENCE_SECONDS = 22;
/** How closely the model follows the prompt; higher is more literal, lower more creative. */
const PROMPT_INFLUENCE = 0.4;
/** For clips that must be one specific thing — a siren, a gunshot — the prompt is followed closely. */
const LITERAL_INFLUENCE = 0.7;
/** A pause between requests, so a run of eleven does not trip the API's own rate limit. */
const PAUSE_MS = 1500;

/** What to ask for, how long, and — for clips that must be one specific thing — how literally. */
const PROMPTS: Record<
  ClipName,
  { text: string; seconds: number; influence?: number; format?: string }
> = {
  pistol: {
    text: "single dry 9mm pistol gunshot, close up, short tail, no music, no voices",
    seconds: 0.7,
  },
  // The game plays one clip per round at ten rounds a second, so a single round must be punchy
  // on its own: the barrage is the game's, the punch is the clip's.
  uzi: {
    text: "single 9mm submachine gun round fired, loud sharp crack with a punchy low thump, close microphone, dry, very short tail, no reload, no voices",
    seconds: 0.5,
    influence: LITERAL_INFLUENCE,
  },
  shotgun: {
    text: "one 12-gauge pump shotgun shot fired outdoors, huge deep boom with a sharp crack, short echo off buildings, no pump action, no reload, no voices",
    seconds: 1.2,
    influence: LITERAL_INFLUENCE,
  },
  footstep: {
    text: "one footstep of a sneaker on asphalt, close, dry",
    // The API's floor is half a second; the step itself is shorter, the rest is silence.
    seconds: 0.5,
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
    text: "American police car siren, the classic electronic wail sweeping slowly up and down in pitch, one full sweep about every three seconds, loud, clean and close, seamless loop, no engine, no traffic, no horn, no voices",
    seconds: 6,
    influence: LITERAL_INFLUENCE,
  },
  pickup: {
    text: "small bright arcade pickup chime, two quick notes rising",
    seconds: 0.5,
  },
  death: {
    text: "short dramatic low orchestral sting for a game over, no melody",
    seconds: 1.5,
  },
  bat: {
    text: "one swing of a wooden baseball bat and a dull heavy thud as it lands on a body, close microphone, short, no voices",
    seconds: 0.6,
    influence: LITERAL_INFLUENCE,
  },
  rifle: {
    text: "single hunting rifle shot fired outdoors, sharp loud crack with a short echo off buildings, no reload, no voices",
    seconds: 1.2,
    influence: LITERAL_INFLUENCE,
  },
  "amb-traffic": {
    text: "evening city street ambience in a small Dutch town, steady distant traffic, cars passing at a moderate distance with soft tyre roll and engine hum, no horns, no sirens, no voices, no music, seamless loop",
    seconds: AMBIENCE_SECONDS,
    format: AMBIENCE_FORMAT,
  },
  "amb-crowd": {
    text: "small town square in the evening, many people strolling and talking softly at a distance, an indistinct murmur of voices and footsteps, no clear words, no music, seamless loop",
    seconds: AMBIENCE_SECONDS,
    format: AMBIENCE_FORMAT,
  },
  "amb-birds": {
    text: "evening birdsong in a quiet park with tall trees, blackbirds and robins singing, leaves rustling gently, no traffic, no voices, no music, seamless loop",
    seconds: AMBIENCE_SECONDS,
    format: AMBIENCE_FORMAT,
  },
  "amb-wind": {
    text: "steady wind blowing across open flat Dutch farmland, soft gusts and grass rustling, no birds, no traffic, no voices, no music, seamless loop",
    seconds: AMBIENCE_SECONDS,
    format: AMBIENCE_FORMAT,
  },
  "amb-water": {
    text: "a wide slow river flowing past a grassy riverbank, gentle lapping water, no boats, no birds, no voices, no music, seamless loop",
    seconds: AMBIENCE_SECONDS,
    format: AMBIENCE_FORMAT,
    influence: LITERAL_INFLUENCE,
  },
  // Chatter is murmur the game never has to own: no clear words, in any language.
  "chatter-1": {
    text: "two women talking quietly nearby in Dutch, indistinct murmur, no clear words, no music, outdoors",
    seconds: 3,
  },
  "chatter-2": {
    text: "a man and a woman chatting and laughing softly nearby in Dutch, indistinct murmur, no clear words, no music, outdoors",
    seconds: 3,
  },
  "chatter-3": {
    text: "a few teenagers talking and laughing nearby in Dutch, indistinct murmur, no clear words, no music, outdoors",
    seconds: 3,
  },
  "chatter-4": {
    text: "an older man saying a few words to a friend nearby in Dutch, indistinct low murmur, no clear words, no music, outdoors",
    seconds: 2.5,
  },
  "bike-bell": {
    text: "classic Dutch bicycle bell rung twice, bright metallic ring ring, outdoors, no traffic, no voices",
    seconds: 1.5,
    influence: LITERAL_INFLUENCE,
  },
  dog: {
    text: "a medium-sized dog barking twice in a quiet park, a little way off, no other sounds",
    seconds: 2,
  },
  horn: {
    text: "a small European car horn honking once, short, outdoors on a street, no voices",
    seconds: 1.2,
    influence: LITERAL_INFLUENCE,
  },
  "church-bell": {
    text: "single large church bell tolling three times, distant, reverberant, no other sounds",
    seconds: 5,
    influence: LITERAL_INFLUENCE,
  },
  scooter: {
    text: "a moped scooter passing by on a town street, two-stroke engine buzz rising and fading away, no horn, no voices",
    seconds: 4,
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
  const format = prompt.format ?? OUTPUT_FORMAT;
  const response = await fetch(`${ENDPOINT}?output_format=${format}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: prompt.text,
      duration_seconds: prompt.seconds,
      loop: AUDIO_CLIPS[clip].loop,
      prompt_influence: prompt.influence ?? PROMPT_INFLUENCE,
    }),
    // The key must never travel to wherever a redirect points.
    redirect: "error",
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
    .filter((line) => fileOfRow(line) !== file);
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
