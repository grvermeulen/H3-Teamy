# Car Radio Implementation Plan (Plan 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Music in the cars — a dial of three stations that starts when you get in, pauses when you get out, and switches with `R`, a touch button or the menu — generated once with Eleven Music and shipped with its credits.

**Architecture:** The radio is one `<audio>` element per game, routed through Web Audio (`createMediaElementSource`) into the sound layer's master gain, so Geluid mutes it with everything else and the loud effects can duck it. It follows the same "in a car" signal the engine loop already gets (`updateEngine`'s `active`), so it never has its own idea of where the player is. Stations and tracks are a JSON manifest imported at build time; the files live under `public/arena/radio/tracks/` with content-hashed names and an immutable cache header. Nothing touches the simulation or the netcode.

**Tech Stack:** Web Audio (`MediaElementAudioSourceNode`), `HTMLAudioElement`, Zod for the manifest and the settings, ElevenLabs Music API (`POST /v1/music`) for the tracks, Vitest 5. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-03-city-arena-design.md` — §7 controls (the menu, the keyboard map, the touch buttons) and §9.3 client storage. The radio itself is not in the spec: it was agreed in conversation on 2026-09-09 ("Also think about radio music in the cars"; "Go with the plan"), so this plan carries the design and Task 6 writes it into the spec as a dated §7 amendment, the way the touch-stick steering was amended on 2026-09-06.

## Global Constraints

- All user-facing strings in **Dutch (NL)**; spec §16 is the glossary. New copy: **Radio**, **Zender**, the station names.
- JSDoc on every exported symbol (`.coderabbit.yaml` enforces ≥80% docstring coverage).
- No `any`, `catch (error: unknown)`, explicit return types on exports.
- Functions under **50 lines**, files under **400 lines**. `audio/sound.ts` is at 329 lines: the radio is its own module and `sound.ts` only forwards to it.
- Every `catch` calls `Sentry.captureException(error, { tags: { area: "arena", kind } })` or re-throws. **Audio failures never reach the caller**: a browser without `createMediaElementSource`, a refused `play()`, a track that will not load — the radio stays silent and the game is unchanged.
- No inline `style` props; Tailwind utilities only.
- Tests co-located; `beforeEach(() => vi.clearAllMocks())` in every mocked `describe`; `afterEach(cleanup)` in component suites.
- Conventional Commits, subject ≤72 chars.
- Verification loop before every push: `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `npm run arena:check-audio`.
- `ELEVENLABS_API_KEY` lives in the owner's `.env`, is read by name only, and is never printed or committed. The generator spends credits on the owner's Creator plan; it generates only what is missing unless told otherwise.

## Design decisions

- **Three stations, one track each to start**, ~120 s, instrumental, looping through the station's playlist: **Grebbe FM** (retro synthwave), **Rijn FM** (lo-fi hip-hop), **Cunera Klassiek** (baroque chamber music). The manifest allows more tracks per station; a later run of the generator adds them.
- **Files in the repo**, not a blob store: three tracks at 96 kbps weigh ~4.3 MB, next to the 3.8 MB map. Budget: **1.6 MiB per track, 8 MiB in all**, enforced by the checker in CI. Moving to Vercel Blob later is a change of `RADIO_TRACK_DIR` only.
- **Content-hashed file names** (`grebbe-1-3f9a1c2b.mp3`) under `/arena/radio/tracks/`, served `immutable` like the map tiles, so a regenerated track can never be shadowed by a cached one.
- **Position is kept**: getting out pauses, getting back in resumes; a station switch starts the new station from the top; a track that ends moves to the next in the playlist and wraps.
- **The radio follows the car, nothing else.** It plays while `updateEngine`'s `active` is true (in a car, not wrecked, boarding done). The countdown puts everyone on foot, so there is no separate countdown rule.
- **Ducking**: every shot and explosion dips the radio to 35 % for 0.3 s. Simple, and enough to keep the gunfight audible.
- **Autoplay policy**: the first gesture that unlocks audio also primes the element (a silent play-then-pause at gain 0), so later `play()` calls from the frame loop are allowed on iOS too. A `play()` refused anyway is retried on the next gesture, not reported.
- **Settings** (spec §9.3): `radio: boolean` (default `true`) and `radioStation?: string` (a station id; absent or unknown means the first station). Geluid off silences the radio as well.

## File Structure

| File                                                               | Responsibility                                                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `src/lib/cityArena/audio/radio/stations.json`                      | The manifest the generator writes: `{ version: 1, stations: [{ id, name, tracks: [{ file, title, seconds }] }] }` |
| `src/lib/cityArena/audio/radio/stations.ts`                        | Zod schema, `RADIO_STATIONS`, `trackUrl`, `stationById`, `nextStationAfter`                                       |
| `src/lib/cityArena/audio/radio/radio.ts`                           | `createRadio`, `browserRadio`, `MediaElementLike`, `RadioPlayer`                                                  |
| `src/lib/cityArena/audio/testing/fakeAudioContext.ts`              | + `createMediaElementSource` recording `mediaSources`                                                             |
| `src/lib/cityArena/audio/testing/fakeMediaElement.ts`              | `createFakeMediaElement()` for the radio tests                                                                    |
| `src/lib/cityArena/audio/sound.ts`                                 | `radio` factory parameter, `radio` on `ArenaSound`, forwarding of unlock / enabled / in-car / dispose, ducking    |
| `src/lib/cityArena/schemas.ts`                                     | `radio`, `radioStation` settings                                                                                  |
| `src/components/cityArena/ArenaSettingsSheet.tsx`                  | Radio switch, Zender select                                                                                       |
| `src/lib/cityArena/input/keyboard.ts`                              | `R` → `hooks.onRadio`                                                                                             |
| `src/components/cityArena/ArenaTouchButtons.tsx`                   | Radio tap button in a car                                                                                         |
| `src/components/cityArena/arenaHud.ts`                             | `radioStation` on the HUD                                                                                         |
| `src/components/cityArena/useArenaGame.ts`                         | `nextStation`, settings → radio, keyboard hook                                                                    |
| `src/components/cityArena/arenaRuntime.ts`                         | `createRuntime` builds the radio from the settings; HUD passes the station                                        |
| `src/components/cityArena/CityArenaOverlay.tsx`                    | HUD label, footer hint, wiring                                                                                    |
| `scripts/arena/generate-radio.ts`                                  | Eleven Music generation, manifest and credits writer                                                              |
| `scripts/arena/check-radio.ts`                                     | `auditRadio`: files, sizes, budget, credits, orphans                                                              |
| `scripts/arena/check-audio.ts`                                     | `main()` runs both audits                                                                                         |
| `public/arena/radio/tracks/*.mp3`, `public/arena/radio/CREDITS.md` | The tracks and their credits                                                                                      |
| `next.config.js`                                                   | Immutable cache header for `/arena/radio/tracks/:path*`                                                           |
| `docs/tech/arena/README.md`, the spec                              | Plan 7 section; §7 amendment; §16 glossary                                                                        |

---

### Task 1: The station manifest and its types

**Files:**

- Create: `src/lib/cityArena/audio/radio/stations.json`
- Create: `src/lib/cityArena/audio/radio/stations.ts`
- Test: `src/lib/cityArena/audio/radio/stations.test.ts`

**Interfaces:**

- Produces: `RadioTrack = { file: string; title: string; seconds: number }`, `RadioStation = { id: string; name: string; tracks: RadioTrack[] }`, `RadioManifestSchema`, `RADIO_STATIONS: RadioStation[]`, `RADIO_TRACK_DIR = "/arena/radio/tracks"`, `trackUrl(track): string`, `stationById(id: string | undefined, stations = RADIO_STATIONS): RadioStation | null`, `nextStationAfter(id: string, stations = RADIO_STATIONS): RadioStation | null`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/cityArena/audio/radio/stations.test.ts
import { describe, expect, it } from "vitest";
import manifest from "./stations.json";
import {
  RADIO_STATIONS,
  RadioManifestSchema,
  nextStationAfter,
  stationById,
  trackUrl,
  type RadioStation,
} from "./stations";

const DIAL: RadioStation[] = [
  {
    id: "a",
    name: "A FM",
    tracks: [{ file: "a-1-00000000.mp3", title: "Een", seconds: 120 }],
  },
  {
    id: "b",
    name: "B FM",
    tracks: [{ file: "b-1-00000000.mp3", title: "Twee", seconds: 120 }],
  },
];

describe("radio stations", () => {
  it("ships a manifest that parses, and the parsed dial is what the game reads", () => {
    expect(RadioManifestSchema.parse(manifest).stations).toEqual(
      RADIO_STATIONS,
    );
  });

  it("rejects a file name that is not a hashed mp3", () => {
    const bad = {
      version: 1,
      stations: [
        {
          id: "a",
          name: "A",
          tracks: [{ file: "../x.mp3", title: "t", seconds: 1 }],
        },
      ],
    };
    expect(RadioManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("builds the track URL under the tracks directory", () => {
    expect(trackUrl(DIAL[0].tracks[0])).toBe(
      "/arena/radio/tracks/a-1-00000000.mp3",
    );
  });

  it("falls back to the first station for an unknown or absent id, and to null with no dial", () => {
    expect(stationById("b", DIAL)?.id).toBe("b");
    expect(stationById("zzz", DIAL)?.id).toBe("a");
    expect(stationById(undefined, DIAL)?.id).toBe("a");
    expect(stationById("a", [])).toBeNull();
  });

  it("cycles the dial and wraps", () => {
    expect(nextStationAfter("a", DIAL)?.id).toBe("b");
    expect(nextStationAfter("b", DIAL)?.id).toBe("a");
    expect(nextStationAfter("zzz", DIAL)?.id).toBe("a");
    expect(nextStationAfter("a", [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail** — `npx vitest run src/lib/cityArena/audio/radio` → cannot resolve `./stations`.

- [ ] **Step 3: Implement**

`stations.json` starts empty — the tracks land in Task 5:

```json
{ "version": 1, "stations": [] }
```

```ts
// src/lib/cityArena/audio/radio/stations.ts
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

export type RadioTrack = z.infer<typeof RadioTrackSchema>;
export type RadioStation = z.infer<typeof RadioStationSchema>;
export type RadioManifest = z.infer<typeof RadioManifestSchema>;

/** The dial, in order; empty until the tracks land, and then the radio simply does not exist. */
export const RADIO_STATIONS: RadioStation[] =
  RadioManifestSchema.parse(manifest).stations;

/** The URL a track is streamed from. */
export function trackUrl(track: RadioTrack): string {
  return `${RADIO_TRACK_DIR}/${track.file}`;
}

/** The station with this id, or the first station when the id is unknown or absent. */
export function stationById(
  id: string | undefined,
  stations: RadioStation[] = RADIO_STATIONS,
): RadioStation | null {
  return stations.find((station) => station.id === id) ?? stations[0] ?? null;
}

/** The station after this one on the dial, wrapping; the first station when the id is unknown. */
export function nextStationAfter(
  id: string,
  stations: RadioStation[] = RADIO_STATIONS,
): RadioStation | null {
  if (stations.length === 0) return null;
  const index = stations.findIndex((station) => station.id === id);
  return stations[(index + 1) % stations.length] ?? null;
}
```

- [ ] **Step 4: Run the tests** — `npx vitest run src/lib/cityArena/audio/radio` → PASS.

- [ ] **Step 5: Commit** — `feat(arena): the radio dial manifest and its types`.

---

### Task 2: The radio player, and the sound layer that owns it

**Files:**

- Create: `src/lib/cityArena/audio/radio/radio.ts`, `src/lib/cityArena/audio/testing/fakeMediaElement.ts`
- Modify: `src/lib/cityArena/audio/sound.ts` (`AudioContextLike`, `ArenaSound`, `createArenaSound`), `src/lib/cityArena/audio/testing/fakeAudioContext.ts`
- Test: `src/lib/cityArena/audio/radio/radio.test.ts`, `src/lib/cityArena/audio/sound.test.ts`

**Interfaces:**

- Consumes: Task 1's `RadioStation`, `stationById`, `nextStationAfter`, `trackUrl`; `AudioContextLike`, `AudioNodeLike`, `GainNodeLike` from `sound.ts`.
- Produces:

```ts
/** The slice of an `<audio>` element the radio drives; a fake in tests. */
export type MediaElementLike = {
  src: string;
  currentTime: number;
  preload: string;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: "ended", listener: () => void): void;
  removeEventListener(type: "ended", listener: () => void): void;
};

/** What the settings say about the radio when the runtime is built. */
export type RadioSettings = { enabled: boolean; stationId?: string };

export type RadioOptions = {
  context: AudioContextLike;
  /** The node the radio plays into — the sound layer's master gain. */
  destination: AudioNodeLike;
  element: MediaElementLike;
  /** The element's node in the graph (`createMediaElementSource(element)`). */
  source: AudioNodeLike;
  stations: RadioStation[];
  stationId?: string;
  enabled: boolean;
};

export type RadioPlayer = {
  /** From a gesture: primes the element silently so later plays are allowed, and retries a refused play. */
  unlock(): void;
  /** Plays while true, pauses — keeping the position — while false. */
  setInCar(inCar: boolean): void;
  /** The Radio setting. Off pauses and loads nothing. */
  setEnabled(enabled: boolean): void;
  /** The Geluid setting, forwarded by the sound layer. */
  setSoundEnabled(enabled: boolean): void;
  /** Tunes to a station by id (unknown: the first); a change starts it from the top. */
  tune(stationId: string): RadioStation | null;
  /** The next station on the dial, from the top. */
  nextStation(): RadioStation | null;
  station(): RadioStation | null;
  /** True while a track is audible: in a car, Radio on, Geluid on, a dial to play. */
  playing(): boolean;
  /** Dips the volume under a loud effect and ramps it back. */
  duck(): void;
  dispose(): void;
};

export const RADIO_GAIN = 0.5;
export const DUCK_LEVEL = 0.35;
export const DUCK_S = 0.3;
export function createRadio(options: RadioOptions): RadioPlayer;
/** The radio for a browser context, or null where media cannot be attached to Web Audio. */
export function browserRadio(
  context: AudioContextLike,
  destination: AudioNodeLike,
  settings: RadioSettings,
): RadioPlayer | null;
/** How a radio is attached to the sound layer, mirroring `SamplePlayerFactory`. */
export type RadioFactory = (
  context: AudioContextLike,
  destination: AudioNodeLike,
) => RadioPlayer | null;
```

`sound.ts`: `AudioContextLike` gains `createMediaElementSource?(element: HTMLMediaElement): AudioNodeLike;`; `ArenaSound` gains `radio: RadioPlayer | null`; `createArenaSound(factory, initiallyEnabled, samples?, radio?: RadioFactory)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/audio/testing/fakeMediaElement.ts
import type { MediaElementLike } from "../radio/radio";

/** A fake `<audio>`: records plays and pauses, lets a test end the track or refuse a play. */
export type FakeMediaElement = MediaElementLike & {
  playCalls: number;
  pauseCalls: number;
  paused: boolean;
  /** The error the next `play()` rejects with, if any. */
  refuseWith: Error | null;
  /** Fires `ended`, as the element does when the track runs out. */
  end(): void;
};

/** Creates the fake. `src` assignment resets `currentTime`, as the real element does on load. */
export function createFakeMediaElement(): FakeMediaElement {
  const listeners = new Set<() => void>();
  let src = "";
  const element: FakeMediaElement = {
    get src() {
      return src;
    },
    set src(value: string) {
      src = value;
      element.currentTime = 0;
    },
    currentTime: 0,
    preload: "auto",
    playCalls: 0,
    pauseCalls: 0,
    paused: true,
    refuseWith: null,
    play() {
      element.playCalls += 1;
      if (element.refuseWith) {
        const error = element.refuseWith;
        element.refuseWith = null;
        return Promise.reject(error);
      }
      element.paused = false;
      return Promise.resolve();
    },
    pause() {
      element.pauseCalls += 1;
      element.paused = true;
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    end() {
      element.paused = true;
      for (const listener of listeners) listener();
    },
  };
  return element;
}
```

```ts
// src/lib/cityArena/audio/radio/radio.test.ts
import * as Sentry from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAudioContext } from "../testing/fakeAudioContext";
import { createFakeMediaElement } from "../testing/fakeMediaElement";
import { DUCK_LEVEL, RADIO_GAIN, createRadio } from "./radio";
import type { RadioStation } from "./stations";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const DIAL: RadioStation[] = [
  {
    id: "a",
    name: "A FM",
    tracks: [
      { file: "a-1-00000000.mp3", title: "Een", seconds: 120 },
      { file: "a-2-00000000.mp3", title: "Twee", seconds: 120 },
    ],
  },
  {
    id: "b",
    name: "B FM",
    tracks: [{ file: "b-1-00000000.mp3", title: "Drie", seconds: 120 }],
  },
];

/** A radio over fakes; the gain node is the last one the context created. */
function setup(
  overrides: {
    stations?: RadioStation[];
    stationId?: string;
    enabled?: boolean;
  } = {},
) {
  const { context } = createFakeAudioContext();
  const element = createFakeMediaElement();
  const radio = createRadio({
    context,
    destination: context.destination,
    element,
    source: context.createMediaElementSource({} as HTMLMediaElement),
    stations: overrides.stations ?? DIAL,
    stationId: overrides.stationId,
    enabled: overrides.enabled ?? true,
  });
  const gain = context.gains[context.gains.length - 1];
  return { context, element, radio, gain };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createRadio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("plays the tuned station's first track in a car and pauses, keeping the position, on the way out", async () => {
    const { element, radio, gain } = setup({ stationId: "b" });
    expect(radio.station()?.id).toBe("b");
    expect(radio.playing()).toBe(false);
    radio.setInCar(true);
    await flush();
    expect(element.src).toBe("/arena/radio/tracks/b-1-00000000.mp3");
    expect(element.paused).toBe(false);
    expect(gain.gain.value).toBe(RADIO_GAIN);
    expect(radio.playing()).toBe(true);
    element.currentTime = 42;
    radio.setInCar(false);
    expect(element.paused).toBe(true);
    expect(gain.gain.value).toBe(0);
    radio.setInCar(true);
    await flush();
    expect(element.currentTime).toBe(42);
    expect(element.src).toBe("/arena/radio/tracks/b-1-00000000.mp3");
  });

  it("moves to the next track when one ends, and wraps", async () => {
    const { element, radio } = setup({ stationId: "a" });
    radio.setInCar(true);
    await flush();
    element.end();
    await flush();
    expect(element.src).toBe("/arena/radio/tracks/a-2-00000000.mp3");
    expect(element.paused).toBe(false);
    element.end();
    await flush();
    expect(element.src).toBe("/arena/radio/tracks/a-1-00000000.mp3");
  });

  it("cycles the dial from the top of the new station and tunes by id", async () => {
    const { element, radio } = setup();
    radio.setInCar(true);
    await flush();
    element.currentTime = 30;
    expect(radio.nextStation()?.id).toBe("b");
    await flush();
    expect(element.src).toBe("/arena/radio/tracks/b-1-00000000.mp3");
    expect(element.currentTime).toBe(0);
    expect(radio.nextStation()?.id).toBe("a");
    expect(radio.tune("b")?.id).toBe("b");
    expect(radio.tune("b")?.id).toBe("b");
    expect(radio.tune("nope")?.id).toBe("a");
  });

  it("is silent with Radio off or Geluid off, and loads nothing while off", async () => {
    const { element, radio } = setup({ enabled: false });
    radio.setInCar(true);
    await flush();
    expect(element.src).toBe("");
    expect(element.playCalls).toBe(0);
    radio.setEnabled(true);
    await flush();
    expect(element.paused).toBe(false);
    radio.setSoundEnabled(false);
    expect(element.paused).toBe(true);
    expect(radio.playing()).toBe(false);
    radio.setSoundEnabled(true);
    await flush();
    expect(element.paused).toBe(false);
  });

  it("primes the element silently on unlock and retries a play the browser refused", async () => {
    const { element, radio, gain } = setup();
    radio.unlock();
    await flush();
    expect(element.playCalls).toBe(1);
    expect(element.paused).toBe(true);
    expect(gain.gain.value).toBe(0);
    const refused = new Error("gesture needed");
    refused.name = "NotAllowedError";
    element.refuseWith = refused;
    radio.setInCar(true);
    await flush();
    expect(element.paused).toBe(true);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    radio.unlock();
    await flush();
    expect(element.paused).toBe(false);
  });

  it("reports a play that fails for another reason, once", async () => {
    const { element, radio } = setup();
    element.refuseWith = new Error("decode");
    radio.setInCar(true);
    await flush();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("ducks under a loud effect and ramps back", async () => {
    const { radio, gain } = setup();
    radio.setInCar(true);
    await flush();
    radio.duck();
    const ops = gain.operations.filter(
      (op) => op.kind === "set" || op.kind === "ramp",
    );
    expect(ops.at(-2)).toMatchObject({
      kind: "set",
      value: RADIO_GAIN * DUCK_LEVEL,
    });
    expect(ops.at(-1)).toMatchObject({ kind: "ramp", value: RADIO_GAIN });
  });

  it("does nothing without a dial", async () => {
    const { element, radio } = setup({ stations: [] });
    radio.unlock();
    radio.setInCar(true);
    await flush();
    expect(radio.station()).toBeNull();
    expect(radio.nextStation()).toBeNull();
    expect(element.playCalls).toBe(0);
  });

  it("disposes: pauses, disconnects and ignores later calls", async () => {
    const { element, radio, gain } = setup();
    radio.setInCar(true);
    await flush();
    radio.dispose();
    expect(element.paused).toBe(true);
    expect(gain.operations.some((op) => op.kind === "disconnect")).toBe(true);
    radio.setInCar(true);
    await flush();
    expect(element.playCalls).toBe(1);
  });
});
```

`sound.test.ts` gains one test with a fake radio (`vi.fn()` for every method, `playing: () => true`, `station: () => null`): `createArenaSound(factory, true, undefined, () => radio)` → `unlock()` calls `radio.unlock`; `setEnabled(false)` calls `radio.setSoundEnabled(false)`; `updateEngine(3, true)` calls `radio.setInCar(true)` and `updateEngine(0, false)` calls `radio.setInCar(false)`; a `shot` event calls `radio.duck` once and a `pickup` event does not; `dispose()` calls `radio.dispose`; and `sound.radio` is the radio.

- [ ] **Step 2: Run them and watch them fail** — `npx vitest run src/lib/cityArena/audio`.

- [ ] **Step 3: Implement `radio.ts`**

State: `stations`, `current: RadioStation | null` (from `stationById`), `trackIndex`, `loaded: string | null` (the URL in the element), `inCar`, `enabled`, `soundOn = true`, `primed`, `disposed`. Graph built once: `source.connect(gain)`, `gain.connect(destination)`, gain at 0.

```ts
const wantsPlay = (): boolean =>
  !disposed &&
  inCar &&
  enabled &&
  soundOn &&
  current !== null &&
  current.tracks.length > 0;

/** Points the element at the current track when it is not already there. */
function load(): void {
  const track = current?.tracks[trackIndex];
  if (!track) return;
  const url = trackUrl(track);
  if (loaded === url) return;
  element.src = url;
  loaded = url;
}

/** Plays; a refusal before a gesture waits for the next unlock, a pause mid-start is routine. */
function play(): void {
  element.play().catch((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") return;
    if (error instanceof Error && error.name === "NotAllowedError") return;
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "radio-play" },
    });
  });
}

/** Makes the element match what the radio wants right now. */
function apply(): void {
  if (disposed) return;
  if (!wantsPlay()) {
    setParam(gain.gain, 0, context.currentTime);
    element.pause();
    return;
  }
  load();
  setParam(gain.gain, RADIO_GAIN, context.currentTime);
  play();
}
```

`unlock()`: `if (disposed || primed || !enabled || !current) return; primed = true; load(); element.play().then(() => { if (!wantsPlay()) element.pause(); }).catch(() => undefined);` then `apply()` (which retries a refused play now that a gesture is in the call stack). `tune(id)`: `const station = stationById(id, stations); if (!station || station === current) return station ?? null; current = station; trackIndex = 0; loaded = null; apply(); return station;`. `nextStation()`: `current ? tune(nextStationAfter(current.id, stations)?.id ?? "") : null`. `ended` listener (attached in the factory): `trackIndex = (trackIndex + 1) % current.tracks.length; loaded = null; apply();`. `duck()`: when `wantsPlay()`, `setParam(gain.gain, RADIO_GAIN * DUCK_LEVEL, now)` then `rampParam(gain.gain, RADIO_GAIN, now + DUCK_S)`. `dispose()`: `disposed = true; element.pause(); element.removeEventListener("ended", onEnded); source.disconnect(); gain.disconnect();` in a try/catch reporting `kind: "radio-dispose"`. Copy `setParam`/`rampParam` from `sound.ts` into `radio.ts` (they are four lines each; exporting them from `sound.ts` would create an import cycle through the factory type — keep the radio's own copies).

`browserRadio(context, destination, settings)`: `if (typeof document === "undefined" || !context.createMediaElementSource) return null; try { const element = document.createElement("audio"); element.preload = "none"; const source = context.createMediaElementSource(element); return createRadio({ context, destination, element, source, stations: RADIO_STATIONS, stationId: settings.stationId, enabled: settings.enabled }); } catch (error: unknown) { Sentry.captureException(error, { tags: { area: "arena", kind: "radio-init" } }); return null; }`.

- [ ] **Step 4: Wire `sound.ts`** — `let radioPlayer: RadioPlayer | null = null;` set inside the existing `try` after the sample player: `radioPlayer = radio?.(context, master) ?? null;`. Forward: in `unlock()` after `preloadSamples()` → `radioPlayer?.unlock()`; in `setEnabled(next)` → `radioPlayer?.setSoundEnabled(next)` before the early return; in `updateEngine(speed, active)` after the `!context` guard → `radioPlayer?.setInCar(active)`; in `handleEvent` first line → `if (event.kind === "shot" || event.kind === "explosion") radioPlayer?.duck();`; in `dispose()` before `stopEngine()` → `radioPlayer?.dispose()`. Expose `radio: radioPlayer` on the returned object. Add `createMediaElementSource(element)` to the fake context: pushes a recording node onto `mediaSources` and returns it.

- [ ] **Step 5: Run the tests, then commit** — `npx vitest run src/lib/cityArena/audio` → PASS; `feat(arena): a car radio behind the master gain`.

---

### Task 3: The settings and the menu

**Files:**

- Modify: `src/lib/cityArena/schemas.ts:108-131`, `src/components/cityArena/ArenaSettingsSheet.tsx`, `src/components/cityArena/useArenaGame.ts` (`applySettings`, `bootSession`), `src/components/cityArena/arenaRuntime.ts` (`createRuntime`)
- Test: `src/lib/cityArena/storage.test.ts`, `src/lib/cityArena/schemas.test.ts`, `src/components/cityArena/ArenaSettingsSheet.test.tsx`

**Interfaces:**

- Consumes: Task 2's `browserRadio`, `RadioSettings`, `RadioPlayer.setEnabled/tune`; Task 1's `RADIO_STATIONS`, `stationById`.
- Produces: `ArenaSettings.radio: boolean`, `ArenaSettings.radioStation?: string`; `createRuntime(session, index, zone, viewportWidthPx, reducedMotion, soundEnabled, audioContextFactory, radioSettings: RadioSettings = { enabled: true })`; sheet labels `RADIO_LABEL = "Radio"`, `STATION_LABEL = "Zender"`.

- [ ] **Step 1: Write the failing tests**

`storage.test.ts`: the defaults now include `radio: true` and no `radioStation` (extend the three existing default assertions). `schemas.test.ts`: `ArenaSettingsSchema.parse({ radio: false, radioStation: "rijn" })` keeps both; `parse({})` gives `radio: true` and `radioStation` undefined. `ArenaSettingsSheet.test.tsx`, with `vi.mock("@/lib/cityArena/audio/radio/stations", ...)` serving two stations (`a` "A FM", `b` "B FM") and a `stationById` that behaves like the real one:

```tsx
it("has a Radio switch and a Zender select that patch the settings", () => {
  const handlers = renderSheet();
  expect(screen.getByLabelText("Radio")).toBeChecked();
  fireEvent.click(screen.getByLabelText("Radio"));
  expect(handlers.onChange).toHaveBeenLastCalledWith({ radio: false });
  expect(screen.getByLabelText("Zender")).toHaveValue("a");
  fireEvent.change(screen.getByLabelText("Zender"), {
    target: { value: "b" },
  });
  expect(handlers.onChange).toHaveBeenLastCalledWith({ radioStation: "b" });
});
```

The empty-dial branch (no Zender select) is covered by the overlay test, which renders the sheet against the real manifest — still empty until Task 5 — and, after that, by the sheet test asserting the select lists exactly the mocked names.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement** — schema:

```ts
  /** "Radio": music in the car (Plan 7). */
  radio: z.boolean().default(true),
  /** The station tuned in, by id; absent or unknown, the first station plays. */
  radioStation: z.string().optional(),
```

`DEFAULT_ARENA_SETTINGS` gains `radio: true`. Sheet: after the Trillen switch, `<SettingSwitch label={RADIO_LABEL} checked={settings.radio} onChange={(radio) => onChange({ radio })} />` and, when `RADIO_STATIONS.length > 0`, a `StationSelect` component: a `<label>`/`<select aria-label={STATION_LABEL}>` styled like Indeling's, `value={stationById(settings.radioStation)?.id ?? ""}`, options `RADIO_STATIONS.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)`, `onChange={(event) => onChange({ radioStation: event.target.value })}`. `applySettings` in `useArenaGame.ts`:

```ts
runtime.sound.radio?.setEnabled(settings.radio);
runtime.sound.radio?.tune(settings.radioStation ?? "");
```

`bootSession` passes `{ enabled: settingsRef.current.radio, stationId: settingsRef.current.radioStation }` as `createRuntime`'s new last argument; `createRuntime` builds the sound with `(context, master) => browserRadio(context, master, radioSettings)`.

- [ ] **Step 4: Run the tests, then commit** — `feat(arena): Radio and Zender in the settings`.

---

### Task 4: `R`, the touch button, the HUD label and the footer

**Files:**

- Modify: `src/lib/cityArena/input/keyboard.ts`, `src/components/cityArena/ArenaTouchButtons.tsx`, `src/components/cityArena/arenaHud.ts`, `src/components/cityArena/useArenaGame.ts`, `src/components/cityArena/arenaRuntime.ts` (the `computeHud` call), `src/components/cityArena/CityArenaOverlay.tsx`
- Test: `src/lib/cityArena/input/keyboard.test.ts`, `src/components/cityArena/ArenaTouchButtons.test.tsx`, `src/components/cityArena/arenaHud.test.ts` (if present; else the overlay test), `src/components/cityArena/CityArenaOverlay.test.tsx`

**Interfaces:**

- Consumes: `RadioPlayer.nextStation/playing/station`.
- Produces: `KeyboardHooks.onRadio?: () => void` (`RADIO_KEY = "KeyR"`); `ArenaTouchButtonsProps.onRadio?: () => void` and `RADIO_LABEL = "Radio"` (exported from `ArenaTouchButtons.tsx`; the sheet has its own constant of the same text); `ArenaHud.radioStation: string | null`; `computeHud(session, state, player, soundEnabled = true, radioStation: string | null = null)`; `ArenaGame.nextStation(): void`.

- [ ] **Step 1: Write the failing tests**

`keyboard.test.ts`:

```ts
it("R cycles the radio once per press and never on repeat", () => {
  const onRadio = vi.fn();
  const detach = attachKeyboard(window, createInputState(), undefined, {
    onRadio,
  });
  press("KeyR");
  window.dispatchEvent(
    new KeyboardEvent("keydown", { code: "KeyR", repeat: true }),
  );
  release("KeyR");
  expect(onRadio).toHaveBeenCalledTimes(1);
  detach();
});
```

`ArenaTouchButtons.test.tsx`: with `inVehicle` and `onRadio`, a "Radio" button exists and a click calls `onRadio` once; on foot there is no "Radio" button. Overlay test: the desktop footer hint contains "R radio". HUD: `computeHud(..., true, "Grebbe FM").radioStation === "Grebbe FM"` and defaults to `null`.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement** — `keyboard.ts`, in `onKeyDown` right after the slot block:

```ts
if (event.code === RADIO_KEY) {
  event.preventDefault();
  if (event.repeat) return;
  onUserGesture?.();
  hooks.onRadio?.();
  return;
}
```

`ArenaTouchButtons`: `{inVehicle && onRadio ? <button type="button" className={TOUCH_BUTTON_CLASS} onClick={onRadio} onContextMenu={(event) => event.preventDefault()}>{RADIO_LABEL}</button> : null}` above the Wapen button. `arenaHud.ts`: the field, the parameter, `radioStation` in the returned object. `arenaRuntime.ts`, where `computeHud` is called with `runtime.soundEnabled`: pass `runtime.sound.radio?.playing() ? (runtime.sound.radio.station()?.name ?? null) : null`. `useArenaGame.ts`: `INITIAL_HUD.radioStation = null`; `useKeyboardBindings` takes `onRadio: () => void` and passes it in the hooks; `useArenaInput` threads it; in `useArenaGame`, `const nextStationRef = useRef<() => void>(() => undefined)` is what `useArenaInput` receives (`() => nextStationRef.current()`), and after `updateSettings` exists:

```ts
const nextStation = useCallback(() => {
  const station = runtimeRef.current?.sound.radio?.nextStation();
  if (station) updateSettings({ radioStation: station.id });
}, [runtimeRef, updateSettings]);
nextStationRef.current = nextStation;
```

returned as `nextStation`. Overlay: `<ArenaTouchButtons ... onRadio={game.nextStation} />`; the HUD bar shows `{hud.radioStation ? <span className="muted truncate text-xs">{`Radio · ${hud.radioStation}`}</span> : null}` after the wanted stars; `controlsHint` desktop text gains ` · R radio` before ` · Tab scorebord`.

- [ ] **Step 4: Run the tests, then commit** — `feat(arena): switch the radio with R, a button and the menu`.

---

### Task 5: The tracks, their credits, the checker, the cache header

**Files:**

- Create: `scripts/arena/generate-radio.ts`, `scripts/arena/check-radio.ts`, `scripts/arena/checkRadio.test.ts`, `public/arena/radio/CREDITS.md`, `public/arena/radio/tracks/*.mp3`
- Modify: `scripts/arena/check-audio.ts` (`main`), `src/lib/cityArena/audio/radio/stations.json`, `package.json` (`arena:generate-radio`), `next.config.js` (headers)

**Interfaces:**

- Consumes: Task 1's `RadioManifestSchema`, `RadioManifest`, `RADIO_TRACK_DIR`.
- Produces: `auditRadio(dir: string, manifest: RadioManifest, credits: string | null, files: string[], limits = RADIO_LIMITS): Promise<AudioProblem[]>` with `RADIO_LIMITS = { trackBytes: 1.6 * 1024 * 1024, totalBytes: 8 * 1024 * 1024 }`.

- [ ] **Step 1: Write the failing test** — `checkRadio.test.ts`, a temp dir like `checkAudio.test.ts`: quiet when every track has a file under the cap and a credit row; names a missing file, an uncredited track, an oversized track, a file in the directory that no station lists ("not in stations.json"), and a set over the total budget (two files just over half the total, with the per-track cap raised through `limits`).

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement the checker** and call it from `check-audio.ts`'s `main()` (reads the manifest with `RadioManifestSchema.parse(JSON.parse(...))`, lists the tracks directory — absent means no files); the success line becomes `arena audio: 11 clips and N radio tracks present and credited.`. `next.config.js`: a second headers entry, `source: "/arena/radio/tracks/:path*"`, same immutable value, with the JSDoc `/** Radio tracks carry a content hash in their name, so they can be cached forever too. */`.

- [ ] **Step 4: Write the generator**

```ts
// scripts/arena/generate-radio.ts — the shape; prompts in full in the file
const ENDPOINT = "https://api.elevenlabs.io/v1/music";
const OUTPUT_FORMAT = "mp3_44100_96";
const MODEL_ID = "music_v2";
const TRACK_SECONDS = 120;
const PAUSE_MS = 2000;
const HASH_CHARS = 8;
/** What each station plays. Adding a track here and running the script generates it. */
const DIAL: {
  id: string;
  name: string;
  tracks: { title: string; prompt: string }[];
}[] = [
  {
    id: "grebbe",
    name: "Grebbe FM",
    tracks: [
      {
        title: "Nachtrit",
        prompt:
          "Upbeat retro synthwave driving track, 110 BPM, analog arpeggios, punchy gated drums, neon night drive, instrumental, no vocals, steady energy, clean ending",
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
```

For each station and track index: skip when the manifest already has a track at that index for that station (unless the station id is named on the command line); otherwise `POST ${ENDPOINT}?output_format=${OUTPUT_FORMAT}` with `{ prompt, music_length_ms: TRACK_SECONDS * 1000, model_id: MODEL_ID, force_instrumental: true }`, name the file `${id}-${index + 1}-${sha256(bytes).slice(0, HASH_CHARS)}.mp3`, delete the file it replaces, write it, update the manifest (`{ file, title, seconds: TRACK_SECONDS }`) and `CREDITS.md` (`| file | Generated with Eleven Music (prompt: "…") | ElevenLabs, for H3-Teamy | ElevenLabs paid-plan commercial licence; not for redistribution as a standalone track | https://elevenlabs.io/music |`, rows matched by the trimmed first cell as the SFX writer does). Print each track's size and, at the end, the credits the run cost (`character_count` from `GET /v1/user/subscription` before and after). Wire `"arena:generate-radio": "tsx scripts/arena/generate-radio.ts"`.

- [ ] **Step 5: Generate** — `npx dotenv -e .env -- npm run -s arena:generate-radio` from the repo root (a worktree points `-e` at the root's `.env`), then `ffprobe` each file (mp3, 44.1 kHz, ~120 s) and `npm run -s arena:check-audio`. If the API answers 4xx about the model, set `MODEL_ID` to `music_v1` and rerun; if it refuses the plan, stop and report — the code paths are all tested against a fake dial and merge without tracks.

- [ ] **Step 6: Commit** — `feat(arena): three radio stations, generated with Eleven Music`.

---

### Task 6: Documentation, verification and the PR

**Files:**

- Modify: `docs/tech/arena/README.md`, `docs/superpowers/specs/2026-09-03-city-arena-design.md` (§7, §16)

- [ ] **Step 1: README** — a `## Runtime (Plan 7 — car radio)` section after the Plan 6 one: the dial and the manifest, the element behind the master gain, the in-car signal, position kept, ducking, priming on the first gesture, the settings, the controls, the file budget and the generator, the credits.
- [ ] **Step 2: Spec** — after the "Universal feedback" paragraph of §7: `**Car radio (Plan 7, added 2026-09-09).** …` three or four sentences; §16: `PR 7 additions: Radio · Zender · Grebbe FM · Rijn FM · Cunera Klassiek.`
- [ ] **Step 3: Verify** — `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build` (revert the artefacts it regenerates), `npm run arena:check-audio`.
- [ ] **Step 4: Open the PR** against `image`, `watch-pr.sh`, address CodeRabbit if it reviews, merge on green.
- [ ] **Step 5: Listening check** — the owner's: drive each station on a phone and a desktop; the levels (`RADIO_GAIN`, `DUCK_LEVEL`) are the knobs.

## Self-review

- **Coverage.** Stations and tracks (T1, T5), playback and routing (T2), settings and menu (T3), `R`/touch/HUD/footer (T4), budget and credits and CI (T5), docs (T6). Hosting decision, cache header, autoplay priming, ducking: T2/T5.
- **Placeholders.** The generator's prompts and the checker's rules are spelled out; the `sound.ts` forwarding names each call site.
- **Types.** `RadioPlayer` methods are named the same in T2 (definition), T3 (`setEnabled`, `tune`), T4 (`nextStation`, `playing`, `station`) and `sound.ts` (`unlock`, `setSoundEnabled`, `setInCar`, `duck`, `dispose`). `computeHud`'s fifth parameter is `radioStation` in T4 and in `arenaRuntime.ts`. `RadioSettings` is defined once, in `radio.ts`, and used by `createRuntime` and `browserRadio`.
