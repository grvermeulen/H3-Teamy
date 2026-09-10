/**
 * The clip table: which recorded sounds the arena can play, and how (Plan 6).
 *
 * The table is the contract between the sample player and whoever sources the files: a clip
 * listed here is fetched from `public/arena/audio/` by the file name given, and a clip that is
 * not there simply keeps its synthesised voice. Nothing else in the game knows a file name.
 */

/** The sounds the arena can play from a recording. */
export type ClipName =
  | "pistol"
  | "uzi"
  | "shotgun"
  | "footstep"
  | "engine"
  | "skid"
  | "impact"
  | "explosion"
  | "siren"
  | "pickup"
  | "death"
  | "bat"
  | "rifle";

/** How one clip plays: its file, its level relative to the master, and whether it loops. */
export type ClipSpec = {
  file: string;
  /** Gain applied to the clip; the master gain and the Geluid toggle still sit on top. */
  gain: number;
  /** True for a clip that runs until told to stop — the engine, the siren. */
  loop: boolean;
};

/** Where the clips live, under `public/`. */
export const AUDIO_CLIP_DIR = "/arena/audio";

/** Every clip the arena knows; the files themselves land separately, with their credits. */
export const AUDIO_CLIPS: Record<ClipName, ClipSpec> = {
  pistol: { file: "pistol.mp3", gain: 0.5, loop: false },
  uzi: { file: "uzi.mp3", gain: 0.4, loop: false },
  shotgun: { file: "shotgun.mp3", gain: 0.6, loop: false },
  footstep: { file: "footstep.mp3", gain: 0.2, loop: false },
  engine: { file: "engine.mp3", gain: 0.3, loop: true },
  skid: { file: "skid.mp3", gain: 0.35, loop: false },
  impact: { file: "impact.mp3", gain: 0.5, loop: false },
  explosion: { file: "explosion.mp3", gain: 0.8, loop: false },
  siren: { file: "siren.mp3", gain: 0.3, loop: true },
  pickup: { file: "pickup.mp3", gain: 0.4, loop: false },
  death: { file: "death.mp3", gain: 0.6, loop: false },
  bat: { file: "bat.mp3", gain: 0.5, loop: false },
  rifle: { file: "rifle.mp3", gain: 0.6, loop: false },
};

/** Every clip name, in table order. */
export const CLIP_NAMES = Object.keys(AUDIO_CLIPS) as ClipName[];

/**
 * The URL a clip is fetched from.
 *
 * @param clip - The clip.
 * @returns Its path under the site root.
 */
export function clipUrl(clip: ClipName): string {
  return `${AUDIO_CLIP_DIR}/${AUDIO_CLIPS[clip].file}`;
}
