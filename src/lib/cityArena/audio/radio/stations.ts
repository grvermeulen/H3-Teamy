/**
 * The radio dial (Plan 7): which stations exist and which tracks they play, read from the
 * manifest `scripts/arena/generate-radio.ts` writes. Nothing else in the game knows a file name.
 */

import { z } from "zod";
import manifest from "./stations.json";

/** Where the tracks live, under `public/`; content-hashed names, cached forever. */
export const RADIO_TRACK_DIR = "/arena/radio/tracks";

/** One track: a hashed file name, a title for the credits, and the length that was asked for. */
export const RadioTrackSchema = z.object({
  file: z.string().regex(/^[a-z0-9]+-\d+-[0-9a-f]{8}\.mp3$/),
  title: z.string().min(1),
  seconds: z.number().positive(),
});

/** One station: an id the settings store, a name the HUD shows, and its playlist in order. */
export const RadioStationSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+$/),
  name: z.string().min(1),
  tracks: z.array(RadioTrackSchema),
});

/** The whole manifest. */
export const RadioManifestSchema = z.object({
  version: z.literal(1),
  stations: z.array(RadioStationSchema),
});

/** A track on a station's playlist. */
export type RadioTrack = z.infer<typeof RadioTrackSchema>;
/** A station on the dial. */
export type RadioStation = z.infer<typeof RadioStationSchema>;
/** The manifest as written by the generator. */
export type RadioManifest = z.infer<typeof RadioManifestSchema>;

/** The dial, in order; empty until the tracks land, and then the radio simply does not exist. */
export const RADIO_STATIONS: RadioStation[] =
  RadioManifestSchema.parse(manifest).stations;

/**
 * The URL a track is streamed from.
 *
 * @param track - The track.
 * @returns Its path under the site root.
 */
export function trackUrl(track: RadioTrack): string {
  return `${RADIO_TRACK_DIR}/${track.file}`;
}

/**
 * The station with this id, or the first station when the id is unknown or absent.
 *
 * @param id - The stored station id, if any.
 * @param stations - The dial; the manifest's unless a test supplies one.
 * @returns The station, or `null` when the dial is empty.
 */
export function stationById(
  id: string | undefined,
  stations: RadioStation[] = RADIO_STATIONS,
): RadioStation | null {
  return stations.find((station) => station.id === id) ?? stations[0] ?? null;
}

/**
 * The station after this one on the dial, wrapping; the first station when the id is unknown.
 *
 * @param id - The station tuned in now.
 * @param stations - The dial; the manifest's unless a test supplies one.
 * @returns The next station, or `null` when the dial is empty.
 */
export function nextStationAfter(
  id: string,
  stations: RadioStation[] = RADIO_STATIONS,
): RadioStation | null {
  if (stations.length === 0) return null;
  const index = stations.findIndex((station) => station.id === id);
  return stations[(index + 1) % stations.length] ?? null;
}
