/**
 * What each simulation event sounds like and where (Plan 6, immersion spec §6): the recorded clip
 * that voices it, the synthesised tones that stand in while the clip has not landed, the class of
 * sound it is placed as, and the point it is placed at. Pure tables and lookups; the sound layer
 * turns them into voices.
 */

import type { ArenaEvent, WeaponKind } from "../sim/types";
import type { ClipName } from "./clips";
import type { SoundClass } from "./spatial";

/** A synthesised tone: a pitch, optionally sliding to `endFrequency`, for `duration` seconds. */
export type Tone = {
  frequency: number;
  duration: number;
  type: string;
  gain: number;
  endFrequency?: number;
};

/** A point in sim metres. */
export type SoundPoint = { x: number; y: number };

/** What the sound layer needs to know about the world to voice a tick's events. */
export type EventSources = {
  /** The local player's id: only their own death plays the death sting. */
  selfId: number | null;
  /** Where a vehicle is, for the impacts that only name it; `null` when it is gone. */
  vehicleAt(id: number): SoundPoint | null;
};

/** Level of a synthesised melee swing, and of a synthesised shot. */
const MELEE_TONE_GAIN = 0.22;
const SHOT_TONE_GAIN = 0.275;

/**
 * The synthesised fallback voice per weapon, used when its clip has not landed. A table rather
 * than a chain so a new weapon cannot fall through to someone else's voice.
 */
const SHOT_TONES: Record<WeaponKind, Tone> = {
  fist: {
    frequency: 90,
    duration: 0.04,
    type: "triangle",
    gain: MELEE_TONE_GAIN,
  },
  pistol: {
    frequency: 180,
    duration: 0.08,
    type: "square",
    gain: SHOT_TONE_GAIN,
  },
  uzi: { frequency: 210, duration: 0.06, type: "square", gain: SHOT_TONE_GAIN },
  shotgun: {
    frequency: 120,
    duration: 0.16,
    type: "sawtooth",
    gain: SHOT_TONE_GAIN,
  },
  bat: {
    frequency: 70,
    duration: 0.05,
    type: "triangle",
    gain: MELEE_TONE_GAIN,
  },
  rifle: {
    frequency: 140,
    duration: 0.12,
    type: "sawtooth",
    gain: SHOT_TONE_GAIN,
  },
  cannon: {
    frequency: 55,
    duration: 0.3,
    type: "sawtooth",
    gain: SHOT_TONE_GAIN,
  },
  // The rocket's only voice, clips or not: a falling whoosh as it leaves the tube. The bang is
  // its detonation's explosion event, so the launch must not borrow the explosion clip.
  rocket: {
    frequency: 320,
    endFrequency: 70,
    duration: 0.4,
    type: "sawtooth",
    gain: SHOT_TONE_GAIN,
  },
};

/** The synthesised bang of an explosion or a collapse. */
const BLAST_TONE: Tone = {
  frequency: 95,
  endFrequency: 35,
  duration: 0.35,
  type: "sawtooth",
  gain: 0.35,
};
/** The two rising notes of a pickup or a beer. */
const PICKUP_TONES: Tone[] = [
  { frequency: 520, duration: 0.08, type: "sine", gain: 0.16 },
  { frequency: 780, duration: 0.12, type: "sine", gain: 0.14 },
];
/** A bullet landing. */
const HIT_TONE: Tone = {
  frequency: 260,
  duration: 0.035,
  type: "triangle",
  gain: 0.12,
};
/** A car door opening, a driver thrown out, a door closing. */
const DOOR_TONES: Record<"open" | "eject" | "close", Tone> = {
  open: {
    frequency: 420,
    endFrequency: 180,
    duration: 0.07,
    type: "triangle",
    gain: 0.1,
  },
  eject: {
    frequency: 160,
    endFrequency: 80,
    duration: 0.18,
    type: "sawtooth",
    gain: 0.1,
  },
  close: {
    frequency: 110,
    endFrequency: 40,
    duration: 0.08,
    type: "triangle",
    gain: 0.2,
  },
};

/** Gain boost on the explosion clip when it voices the tank's cannon. */
export const CANNON_CLIP_GAIN = 1.25;

/**
 * The recorded clip for an event, or null for one that only the synthesiser voices.
 *
 * @param event - The event.
 * @returns The clip to try first, or `null`.
 */
export function clipFor(event: ArenaEvent): ClipName | null {
  if (event.kind === "shot") {
    if (event.weapon === "fist" || event.weapon === "rocket") return null;
    // The cannon has no recording of its own; the explosion clip is the bang it deserves.
    return event.weapon === "cannon" ? "explosion" : event.weapon;
  }
  // A building collapse gets the same bang as any other explosion (spec §5).
  if (event.kind === "explosion" || event.kind === "collapse")
    return "explosion";
  if (event.kind === "pickup" || event.kind === "beer") return "pickup";
  if (event.kind === "impact") return "impact";
  return null;
}

/**
 * The gain scale an event's clip plays at: the cannon's bang is louder than a car's.
 *
 * @param event - The event.
 * @returns The scale on top of the clip's own gain.
 */
export function clipGainFor(event: ArenaEvent): number {
  return event.kind === "shot" && event.weapon === "cannon"
    ? CANNON_CLIP_GAIN
    : 1;
}

/**
 * The synthesised tones standing in for an event whose clip has not landed.
 *
 * @param event - The event.
 * @returns The tones to play together, none for an event the synth does not voice.
 */
export function fallbackTones(event: ArenaEvent): readonly Tone[] {
  switch (event.kind) {
    case "shot":
      return [SHOT_TONES[event.weapon]];
    case "explosion":
    case "collapse":
      return [BLAST_TONE];
    case "pickup":
    case "beer":
      return PICKUP_TONES;
    case "hit":
      return [HIT_TONE];
    case "door":
      return [DOOR_TONES[event.phase]];
    default:
      return [];
  }
}

/** The sound class a shot is placed as: melee is close, the cannon carries like a blast. */
function shotClass(weapon: WeaponKind): SoundClass {
  if (weapon === "fist" || weapon === "bat") return "hit";
  return weapon === "cannon" ? "explosion" : "gunshot";
}

/** The sound class per event kind that is not a shot; absent kinds are never placed. */
const EVENT_CLASS: Partial<Record<ArenaEvent["kind"], SoundClass>> = {
  explosion: "explosion",
  collapse: "explosion",
  impact: "impact",
  hit: "hit",
  door: "door",
  hijack: "door",
  pickup: "pickup",
  beer: "pickup",
};

/**
 * The class of sound an event is placed as.
 *
 * @param event - The event.
 * @returns Its class, or `null` for an event that is not placed.
 */
export function soundClassFor(event: ArenaEvent): SoundClass | null {
  if (event.kind === "shot") return shotClass(event.weapon);
  return EVENT_CLASS[event.kind] ?? null;
}

/**
 * Where an event happens: its own position, or its vehicle's for an impact.
 *
 * @param event - The event.
 * @param sources - The world lookups; without them an impact has no position.
 * @returns The point, or `null` when the event has none that is known.
 */
export function eventPosition(
  event: ArenaEvent,
  sources: EventSources | undefined,
): SoundPoint | null {
  if (event.kind === "impact")
    return sources?.vehicleAt(event.vehicleId) ?? null;
  if ("x" in event && "y" in event) return { x: event.x, y: event.y };
  return null;
}

/**
 * True for the local player's own death, which plays the death sting.
 *
 * @param event - The event.
 * @param sources - Who the local player is.
 * @returns Whether this is their death.
 */
export function isOwnDeath(
  event: ArenaEvent,
  sources: EventSources | undefined,
): boolean {
  return (
    event.kind === "kill" &&
    event.victim === "player" &&
    sources?.selfId !== undefined &&
    sources.selfId !== null &&
    event.victimId === sources.selfId
  );
}

/**
 * True for the events loud enough to duck the car radio.
 *
 * @param event - The event.
 * @returns Whether it is a shot, an explosion or a collapse.
 */
export function ducksRadio(event: ArenaEvent): boolean {
  return (
    event.kind === "shot" ||
    event.kind === "explosion" ||
    event.kind === "collapse"
  );
}
