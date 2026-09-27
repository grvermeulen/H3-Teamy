/**
 * Where a sound sits for the one who hears it (immersion spec §6): a pure model that turns a
 * listener and a source position into a gain, a stereo pan and a low-pass cutoff. The sample
 * player and the synth route a placed voice through gain → low-pass → panner with these numbers;
 * nothing here touches Web Audio, so the rules can be tested with plain numbers.
 */

/** Where the ears are: sim metres (x east, y south) and the facing, sim radians (0 = east). */
export type Listener = { x: number; y: number; facing: number };

/** How one class of sound carries. */
export type SoundProfile = {
  /** Within this distance the sound plays at full level and is not panned all the way. */
  refDistanceM: number;
  /** Past this distance it is silent. */
  maxDistanceM: number;
  /** How fast the inverse-distance rolloff falls past the reference distance. */
  rolloff: number;
};

/** The classes of sound the arena places, each with its own reach. */
export type SoundClass =
  | "gunshot"
  | "explosion"
  | "impact"
  | "hit"
  | "door"
  | "pickup"
  | "footstep"
  | "engine"
  | "siren"
  | "chatter"
  | "spot"
  | "bell";

/** Ranges per class (spec §6: gunshot ≈ 150 m, explosion ≈ 300 m, steps 20 m, doors 30 m). */
export const SOUND_PROFILES: Readonly<Record<SoundClass, SoundProfile>> = {
  gunshot: { refDistanceM: 8, maxDistanceM: 150, rolloff: 1 },
  explosion: { refDistanceM: 15, maxDistanceM: 300, rolloff: 1 },
  impact: { refDistanceM: 6, maxDistanceM: 90, rolloff: 1 },
  hit: { refDistanceM: 4, maxDistanceM: 40, rolloff: 1 },
  door: { refDistanceM: 3, maxDistanceM: 30, rolloff: 1 },
  pickup: { refDistanceM: 3, maxDistanceM: 25, rolloff: 1 },
  footstep: { refDistanceM: 2, maxDistanceM: 20, rolloff: 1 },
  engine: { refDistanceM: 6, maxDistanceM: 90, rolloff: 1 },
  siren: { refDistanceM: 15, maxDistanceM: 220, rolloff: 1 },
  chatter: { refDistanceM: 2, maxDistanceM: 18, rolloff: 1 },
  spot: { refDistanceM: 5, maxDistanceM: 70, rolloff: 1 },
  bell: { refDistanceM: 60, maxDistanceM: 900, rolloff: 1 },
};

/** Result of placing a source for a listener. */
export type SpatialMix = { gain: number; pan: number; cutoffHz: number };

/** The low-pass cutoff of a sound close by: wide open, effectively no filter. */
export const OPEN_CUTOFF_HZ = 18000;
/** The cutoff a sound closes toward at the edge of hearing. */
const FAR_CUTOFF_HZ = 1500;
/** Hard left/right is never reached: a single ear playing alone sounds broken, not placed. */
export const MAX_PAN = 0.85;
/** A source straight behind the listener plays at this share of its level. */
const BEHIND_GAIN = 0.8;
/** …and with its cutoff at this share. */
const BEHIND_CUTOFF_SHARE = 0.55;
/** Below this gain a voice is not worth a node: it plays nothing. */
export const MIN_AUDIBLE_GAIN = 0.01;
/** The last share of a profile's reach over which the level fades linearly to silence. */
const EDGE_FADE_SHARE = 0.15;
/** In 2D the listener faces screen-up: north, −π/2 in sim angles (y points south). */
export const TOP_DOWN_FACING = -Math.PI / 2;

/** Clamps `value` to `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Level for a distance: full inside the reference, inverse rolloff past it, faded out at the edge. */
function distanceGain(distanceM: number, profile: SoundProfile): number {
  const { refDistanceM, maxDistanceM, rolloff } = profile;
  if (distanceM >= maxDistanceM) return 0;
  if (distanceM <= refDistanceM) return 1;
  const inverse =
    refDistanceM / (refDistanceM + rolloff * (distanceM - refDistanceM));
  const fadeFrom = maxDistanceM * (1 - EDGE_FADE_SHARE);
  if (distanceM <= fadeFrom) return inverse;
  return (inverse * (maxDistanceM - distanceM)) / (maxDistanceM - fadeFrom);
}

/** Cutoff for a distance: open at the reference, closing exponentially toward the far cutoff. */
function distanceCutoff(distanceM: number, profile: SoundProfile): number {
  const span = profile.maxDistanceM - profile.refDistanceM;
  const share = clamp((distanceM - profile.refDistanceM) / span, 0, 1);
  return OPEN_CUTOFF_HZ * (FAR_CUTOFF_HZ / OPEN_CUTOFF_HZ) ** share;
}

/**
 * Places a source for a listener: distance gain, pan from the bearing relative to the facing, and
 * a low-pass that closes with distance. A source behind is slightly quieter and duller; the
 * behind-ness eases in with the angle, so a car passing from front to back never steps.
 *
 * @param listener - Where the ears are and which way they face.
 * @param sourceX - The source's x, metres east.
 * @param sourceY - The source's y, metres south.
 * @param profile - How this class of sound carries.
 * @returns Gain 0…1, pan −{@link MAX_PAN}…{@link MAX_PAN} (right is +), and the cutoff in Hz.
 */
export function spatialMix(
  listener: Listener,
  sourceX: number,
  sourceY: number,
  profile: SoundProfile,
): SpatialMix {
  const dx = sourceX - listener.x;
  const dy = sourceY - listener.y;
  const distanceM = Math.hypot(dx, dy);
  // On top of the listener a source has no side yet: direction grows in over the reference.
  const presence = Math.min(1, distanceM / profile.refDistanceM);
  const relative = Math.atan2(dy, dx) - listener.facing;
  const behind = Math.max(0, -Math.cos(relative)) * presence;
  const pan = clamp(Math.sin(relative) * presence, -MAX_PAN, MAX_PAN);
  return {
    gain: distanceGain(distanceM, profile) * (1 - (1 - BEHIND_GAIN) * behind),
    pan: pan + 0,
    cutoffHz:
      distanceCutoff(distanceM, profile) *
      (1 - (1 - BEHIND_CUTOFF_SHARE) * behind),
  };
}

/**
 * The listener for a frame: at the local player (or the car they drive), facing the 3D camera's
 * yaw while 3D is on and screen-up in 2D.
 *
 * @param x - The listener's x, metres.
 * @param y - The listener's y, metres.
 * @param yaw3d - The 3D camera's yaw in sim radians, or `null` in 2D.
 * @returns The listener.
 */
export function listenerAt(
  x: number,
  y: number,
  yaw3d: number | null,
): Listener {
  return { x, y, facing: yaw3d ?? TOP_DOWN_FACING };
}
