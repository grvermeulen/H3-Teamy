/** Where the fight's clips are served from (`public/arena/fight/`). */
export const FIGHT_AUDIO_DIR = "/arena/fight/";

/**
 * Every recorded clip the fight plays, by name → file. All were generated with ElevenLabs
 * (sound effects and music) and are credited in `public/arena/fight/CREDITS.md`.
 */
export const FIGHT_CLIPS = {
  "punch-light": "punch-light.mp3",
  "punch-heavy": "punch-heavy.mp3",
  kick: "kick.mp3",
  whoosh: "whoosh.mp3",
  block: "block.mp3",
  slam: "slam.mp3",
  "super-charge": "super-charge.mp3",
  "super-hit": "super-hit.mp3",
  slowmo: "slowmo.mp3",
  rush: "rush.mp3",
  crowd: "crowd.mp3",
  bell: "bell.mp3",
  "can-open": "can-open.mp3",
  gulp: "gulp.mp3",
  aah: "aah.mp3",
  "can-crush": "can-crush.mp3",
  "can-bonk": "can-bonk.mp3",
  parry: "parry.mp3",
  projectile: "projectile.mp3",
  "vs-sting": "vs-sting.mp3",
  kiai: "kiai.mp3",
  oof: "oof.mp3",
  dizzy: "dizzy.mp3",
  victory: "victory.mp3",
  teleport: "teleport.mp3",
  music: "music.mp3",
} as const;

/** A clip name. */
export type FightClip = keyof typeof FIGHT_CLIPS;

/** Every clip name, in table order. */
export const FIGHT_CLIP_NAMES = Object.keys(FIGHT_CLIPS) as FightClip[];

/**
 * The URL a clip is fetched from.
 *
 * @param name - The clip.
 * @returns Its path under `public/`.
 */
export function fightClipUrl(name: FightClip): string {
  return FIGHT_AUDIO_DIR + FIGHT_CLIPS[name];
}
