/**
 * Generates the car radio's tracks with ElevenLabs' Music API (Plan 7, Task 5).
 *
 * One request per planned track, instrumental, two minutes, written to
 * `public/arena/radio/tracks/<station>-<n>-<hash>.mp3` — the hash is the file's own, so a
 * regenerated track gets a new name and can never be shadowed by a cached one — and recorded in
 * the dial manifest (`src/lib/cityArena/audio/radio/stations.json`) and in
 * `public/arena/radio/CREDITS.md`, one row per file.
 *
 * Needs `ELEVENLABS_API_KEY` in the environment (`.env`, never the repo). Run:
 *
 *   npx tsx scripts/arena/generate-radio.ts         # every planned track that has no file yet
 *   npx tsx scripts/arena/generate-radio.ts rijn    # this station's tracks again, replacing them
 *
 * Each run spends credits on the owner's ElevenLabs plan, so nothing is regenerated unless named.
 */

import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  RadioManifestSchema,
  type RadioManifest,
  type RadioStation,
} from "../../src/lib/cityArena/audio/radio/stations";
import {
  RADIO_CREDITS_FILE,
  RADIO_MANIFEST_FILE,
  RADIO_TRACK_DIR,
} from "./check-radio";
import { creditRows, creditsFile, fileOfRow } from "./credits";
import { readIfPresent, writeAtomic } from "./files";

/** ElevenLabs' music endpoint; the format is a query parameter, the rest is the body. */
const ENDPOINT = "https://api.elevenlabs.io/v1/music";
/** Where the plan's credit counter is read, to report what a run cost. */
const SUBSCRIPTION_ENDPOINT = "https://api.elevenlabs.io/v1/user/subscription";
/** MP3, 44.1 kHz, 96 kbps: the floor for music, and ~0.7 MiB a minute. */
const OUTPUT_FORMAT = "mp3_44100_96";
/** The music model; `music_v1` is the fallback if the plan does not have this one. */
const MODEL_ID = "music_v2";
/** How long each track is asked to be. */
const TRACK_SECONDS = 120;
/** A pause between requests, so a run does not trip the API's own rate limit. */
const PAUSE_MS = 2000;
/** How much of the file's SHA-256 goes into its name. */
const HASH_CHARS = 8;
/** The part of the subscription answer the report reads. */
const SubscriptionSchema = z.object({ character_count: z.number() });

/** A station as planned: what it is called and what it should play. */
type PlannedStation = {
  id: string;
  name: string;
  tracks: { title: string; prompt: string }[];
};

/** What each station plays. Adding a track here and running the script generates it. */
const DIAL: PlannedStation[] = [
  {
    id: "grebbe",
    name: "Grebbe FM",
    tracks: [
      {
        title: "Nachtrit",
        prompt:
          "Upbeat retro synthwave driving track, 110 BPM, analog arpeggios, punchy gated drums, neon night drive, instrumental, no vocals, steady energy from start to end, clean ending",
      },
    ],
  },
  {
    id: "rijn",
    name: "Rijn FM",
    tracks: [
      {
        title: "Rijnkade",
        prompt:
          "Laid-back lo-fi hip-hop beat, 85 BPM, dusty drums, warm Rhodes chords, soft vinyl crackle, mellow instrumental, no vocals",
      },
    ],
  },
  {
    id: "cunera",
    name: "Cunera Klassiek",
    tracks: [
      {
        title: "Allegro voor de Cunera",
        prompt:
          "Bright baroque chamber orchestra piece, strings and harpsichord, lively allegro, instrumental, concert hall recording",
      },
    ],
  },
];

/** Asks ElevenLabs for one track and returns the MP3 bytes. */
async function generate(key: string, prompt: string): Promise<Uint8Array> {
  const response = await fetch(`${ENDPOINT}?output_format=${OUTPUT_FORMAT}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      music_length_ms: TRACK_SECONDS * 1000,
      model_id: MODEL_ID,
      force_instrumental: true,
    }),
    // The key must never travel to wherever a redirect points.
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      `ElevenLabs answered ${response.status}: ${await response.text()}`,
    );
  return new Uint8Array(await response.arrayBuffer());
}

/** The plan's credit counter, or null when it cannot be read; a report, never a gate. */
async function creditsUsed(key: string): Promise<number | null> {
  try {
    const response = await fetch(SUBSCRIPTION_ENDPOINT, {
      headers: { "xi-api-key": key },
      redirect: "error",
    });
    if (!response.ok) return null;
    const parsed = SubscriptionSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.character_count : null;
  } catch {
    return null;
  }
}

/** `<station>-<n>-<hash>.mp3`, the hash being the file's own. */
function fileNameFor(id: string, index: number, bytes: Uint8Array): string {
  const hash = createHash("sha256").update(bytes).digest("hex");
  return `${id}-${index + 1}-${hash.slice(0, HASH_CHARS)}.mp3`;
}

/** The manifest on disk, or an empty dial when there is none; one that will not parse stops the run. */
async function readManifest(): Promise<RadioManifest> {
  const raw = await readIfPresent(RADIO_MANIFEST_FILE);
  if (raw === null) return { version: 1, stations: [] };
  return RadioManifestSchema.parse(JSON.parse(raw));
}

/** The manifest's entry for a planned station, created in dial order when it is new. */
function stationEntry(
  manifest: RadioManifest,
  planned: PlannedStation,
): RadioStation {
  const existing = manifest.stations.find((s) => s.id === planned.id);
  if (existing) {
    existing.name = planned.name;
    return existing;
  }
  const created: RadioStation = {
    id: planned.id,
    name: planned.name,
    tracks: [],
  };
  manifest.stations.push(created);
  return created;
}

/** The credits row for one track. */
function rowFor(file: string, prompt: string): string {
  return `| ${file} | Generated with Eleven Music (prompt: "${prompt}") | ElevenLabs, for H3-Teamy | ElevenLabs paid-plan commercial licence; not for redistribution as a standalone track | https://elevenlabs.io/music |`;
}

/** Writes the manifest and a credits file holding exactly the manifest's tracks, each atomically. */
async function persist(
  manifest: RadioManifest,
  existingCredits: string,
  freshRows: Map<string, string>,
): Promise<void> {
  const known = new Map(
    creditRows(existingCredits).map((row) => [fileOfRow(row), row] as const),
  );
  for (const [file, row] of freshRows) known.set(file, row);
  const rows = manifest.stations
    .flatMap((station) => station.tracks)
    .map((track) => known.get(track.file))
    .filter((row): row is string => row !== undefined);
  await writeAtomic(
    RADIO_MANIFEST_FILE,
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await writeAtomic(
    RADIO_CREDITS_FILE,
    creditsFile(
      "Radio credits",
      "Every track under `public/arena/radio/tracks/`, where it came from, and the licence it carries.",
      rows,
    ),
  );
}

/**
 * Generates one track and records it in the station; returns its credits row and the file it
 * supersedes, which the caller deletes once the metadata is safely written.
 */
async function produce(
  key: string,
  station: RadioStation,
  index: number,
  planned: { title: string; prompt: string },
): Promise<{ row: string; superseded: string | null }> {
  const bytes = await generate(key, planned.prompt);
  const file = fileNameFor(station.id, index, bytes);
  await writeAtomic(path.join(RADIO_TRACK_DIR, file), bytes);
  const previous = station.tracks[index];
  station.tracks[index] = {
    file,
    title: planned.title,
    seconds: TRACK_SECONDS,
  };
  console.log(`${Math.round(bytes.byteLength / 1024)} KB → ${file}`);
  return {
    row: rowFor(file, planned.prompt),
    superseded: previous && previous.file !== file ? previous.file : null,
  };
}

/** Generates the tracks of the stations named, or every planned track without a file. */
async function main(): Promise<void> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  const named = process.argv.slice(2);
  for (const id of named)
    if (!DIAL.some((station) => station.id === id))
      throw new Error(`Unknown station: ${id}`);
  const manifest = await readManifest();
  const existingCredits = (await readIfPresent(RADIO_CREDITS_FILE)) ?? "";
  const before = await creditsUsed(key);
  const freshRows = new Map<string, string>();
  let made = 0;
  for (const planned of DIAL) {
    // A targeted run touches the stations named and nothing else — every track costs credits.
    if (named.length > 0 && !named.includes(planned.id)) continue;
    const station = stationEntry(manifest, planned);
    for (const [index, track] of planned.tracks.entries()) {
      if (station.tracks[index] && named.length === 0) continue;
      process.stdout.write(`${planned.name} · ${track.title} … `);
      const { row, superseded } = await produce(key, station, index, track);
      freshRows.set(fileOfRow(row), row);
      await persist(manifest, existingCredits, freshRows);
      // Only now, with the manifest pointing at the new file, is the old one surplus.
      if (superseded)
        await rm(path.join(RADIO_TRACK_DIR, superseded), { force: true });
      made += 1;
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    }
  }
  if (made === 0) {
    console.log(
      "Every planned track has a file; name stations to regenerate them.",
    );
    return;
  }
  const after = await creditsUsed(key);
  if (before !== null && after !== null)
    console.log(`${made} track(s); credits used: ${after - before}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
