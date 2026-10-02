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
  | "rifle"
  | "amb-traffic"
  | "amb-crowd"
  | "amb-birds"
  | "amb-wind"
  | "amb-water"
  | "chatter-1"
  | "chatter-2"
  | "chatter-3"
  | "chatter-4"
  | "bike-bell"
  | "dog"
  | "horn"
  | "church-bell"
  | "scooter";

/** How one clip plays: its file, its level relative to the master, and whether it loops. */
export type ClipSpec = {
  file: string;
  /** Gain applied to the clip; the master gain and the Geluid toggle still sit on top. */
  gain: number;
  /** True for a clip that runs until told to stop — the engine, the siren, the ambience beds. */
  loop: boolean;
};

/** Where the clips live, under `public/`. */
export const AUDIO_CLIP_DIR = "/arena/audio";

/** Every clip the arena knows; the files themselves land separately, with their credits. */
export const AUDIO_CLIPS: Record<ClipName, ClipSpec> = {
  pistol: { file: "pistol.mp3", gain: 0.625, loop: false },
  uzi: { file: "uzi.mp3", gain: 0.5, loop: false },
  shotgun: { file: "shotgun.mp3", gain: 0.75, loop: false },
  footstep: { file: "footstep.mp3", gain: 0.2, loop: false },
  engine: { file: "engine.mp3", gain: 0.3, loop: true },
  skid: { file: "skid.mp3", gain: 0.35, loop: false },
  impact: { file: "impact.mp3", gain: 0.5, loop: false },
  explosion: { file: "explosion.mp3", gain: 0.8, loop: false },
  siren: { file: "siren.mp3", gain: 0.3, loop: true },
  pickup: { file: "pickup.mp3", gain: 0.4, loop: false },
  death: { file: "death.mp3", gain: 0.6, loop: false },
  bat: { file: "bat.mp3", gain: 0.5, loop: false },
  rifle: { file: "rifle.mp3", gain: 0.75, loop: false },
  // The ambient bed (immersion spec §6): quiet loops under everything, levelled by the surroundings.
  "amb-traffic": { file: "amb-traffic.mp3", gain: 0.35, loop: true },
  "amb-crowd": { file: "amb-crowd.mp3", gain: 0.3, loop: true },
  "amb-birds": { file: "amb-birds.mp3", gain: 0.3, loop: true },
  "amb-wind": { file: "amb-wind.mp3", gain: 0.3, loop: true },
  "amb-water": { file: "amb-water.mp3", gain: 0.3, loop: true },
  // Spot sounds (spec §6): short, placed where their source is.
  "chatter-1": { file: "chatter-1.mp3", gain: 0.35, loop: false },
  "chatter-2": { file: "chatter-2.mp3", gain: 0.35, loop: false },
  "chatter-3": { file: "chatter-3.mp3", gain: 0.35, loop: false },
  "chatter-4": { file: "chatter-4.mp3", gain: 0.35, loop: false },
  "bike-bell": { file: "bike-bell.mp3", gain: 0.4, loop: false },
  dog: { file: "dog.mp3", gain: 0.4, loop: false },
  horn: { file: "horn.mp3", gain: 0.45, loop: false },
  "church-bell": { file: "church-bell.mp3", gain: 0.7, loop: false },
  scooter: { file: "scooter.mp3", gain: 0.4, loop: false },
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
