# Immersion track 2 — city sound and spatial audio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Pure logic is written test-first (superpowers:test-driven-development).

**Goal:** The city is audible — traffic, crowds, birds, wind, water, chatter, bells, footsteps — and every sound sits where it happens: louder close by, panned left/right, muffled far away.

**Architecture:** A pure spatial model (`audio/spatial.ts`) turns listener + source into gain/pan/cutoff; the sample player routes a voice through gain → low-pass → stereo panner when given a placement. The sound layer gains a listener, a traffic/siren voice pool, an ambience mixer fed by a pure "surroundings" read of the map tiles and scene, and a spot-sound scheduler. Works identically in 2D and 3D (facing: camera yaw in 3D, north in 2D).

**Tech Stack:** Web Audio (through the injectable `AudioContextLike` contract), TypeScript 6.0.3, Vitest 5, ElevenLabs Sound Effects API via `scripts/arena/generate-audio.ts`.

**Spec:** `docs/superpowers/specs/2026-09-27-arena-immersion-design.md` §6, §10.

## Global Constraints

- Dutch user-facing strings; no inline `style`; JSDoc + explicit return types on exports; functions ≤ 50 lines; named constants; every `catch` → `Sentry.captureException` (audio errors keep the existing `reportAudioError` tags); commit subjects ≤ 72 chars.
- No simulation/wire changes. Audio never throws into the game loop.
- The existing fallback contract stays: a missing clip keeps its synth voice where one exists; ambience and spot sounds have none (silent).
- ≤ 24 simultaneous spatial one-shots; new audio files ≤ 2.5 MB in total.
- Branch `feat/arena-city-audio` from `feat/arena-immersion-base`; PR against `image`; no version bump.

## File map

| File                                                                                             | Change                                                                                   |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `src/lib/cityArena/audio/spatial.ts`                                                             | **new** — `Listener`, `SoundProfile`, `SOUND_PROFILES`, `spatialMix`                     |
| `src/lib/cityArena/audio/sound.ts`                                                               | listener, placed events, `updateWorld`, ambience + spot scheduling, footsteps/skid/death |
| `src/lib/cityArena/audio/samples.ts`                                                             | `play(clip, rate, gain, placement?)`; placed loops with `setPlacement`                   |
| `src/lib/cityArena/audio/testing/fakeAudioContext.ts`                                            | panner/filter fakes                                                                      |
| `src/lib/cityArena/audio/trafficVoices.ts`                                                       | **new** — nearest-N engine/siren voice assignment (pure)                                 |
| `src/lib/cityArena/audio/surroundings.ts`                                                        | **new** — pure read of tiles + scene around the listener                                 |
| `src/lib/cityArena/audio/ambience.ts`                                                            | **new** — pure loop levels from surroundings                                             |
| `src/lib/cityArena/audio/spotSounds.ts`                                                          | **new** — seeded scheduler of chatter/bell/bark/horn/church/scooter                      |
| `src/lib/cityArena/audio/clips.ts`                                                               | new clip names                                                                           |
| `scripts/arena/generate-audio.ts`, `public/arena/audio/*`, `CREDITS.md`                          | prompts + generated clips                                                                |
| `src/lib/cityArena/schemas.ts` (settings), `components/cityArena/ArenaSettingsSheet.tsx`         | `ambience` setting, "Omgevingsgeluid" switch                                             |
| `components/cityArena/arenaRuntime.ts`, `arenaFeel.ts`, `useArenaGame.ts`, `view3d/useView3d.ts` | listener + world updates per frame                                                       |
| `docs/tech/arena/README.md`                                                                      | "Geluid in de stad" section                                                              |

---

### Task 1: The spatial model

**Files:** create `audio/spatial.ts` (+ test).

```ts
/** Where the ears are: sim metres (x east, y south) and the facing, sim radians (0 = east). */
export type Listener = { x: number; y: number; facing: number };
/** How one class of sound carries. */
export type SoundProfile = {
  refDistanceM: number;
  maxDistanceM: number;
  rolloff: number;
};
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
export const SOUND_PROFILES: Readonly<Record<SoundClass, SoundProfile>>;
/** Result of placing a source for a listener. */
export type SpatialMix = { gain: number; pan: number; cutoffHz: number };
export const OPEN_CUTOFF_HZ = 18000;
export function spatialMix(
  listener: Listener,
  sourceX: number,
  sourceY: number,
  profile: SoundProfile,
): SpatialMix;
```

Rules: `d = distance`; `gain = 1` for `d ≤ ref`; inverse rolloff `ref / (ref + rolloff·(d − ref))`; faded linearly to 0 over the last 15 % before `max` and 0 beyond. `pan = sin(atan2(dy, dx) − facing)` scaled by `min(1, d / ref)` (a source on top of you is centred), clamped to ±`MAX_PAN` 0.85. Behind the listener (`cos(bearing − facing) < 0`) the gain is × `BEHIND_GAIN` 0.8 and the cutoff lower. `cutoffHz` falls from `OPEN_CUTOFF_HZ` at `ref` toward ≈ 1500 Hz at `max` (exponential in distance share).

- [ ] Tests with numbers: at the listener gain 1, pan 0; 150 m gunshot silent past its max; a source due south of an east-facing listener pans right (+), due north pans left (−); in 2D (`facing = −π/2`, screen up) a source east pans right; gain strictly decreasing with distance; cutoff decreasing; behind is quieter than in front at the same distance.
- [ ] Implement; commit `feat(arena): spatial mix for positioned sounds`.

### Task 2: Placed voices through the context contract

**Files:** modify `audio/sound.ts` (types), `audio/samples.ts`, `audio/testing/fakeAudioContext.ts` (+ tests).

- `AudioContextLike` gains optional `createStereoPanner?(): StereoPannerLike` and `createBiquadFilter?(): BiquadFilterLike` (`{ type, frequency: AudioParamLike }`). `SamplePlayer.play(clip, rate?, gainScale?, placement?: SpatialMix)`; a placed voice is source → gain(clip gain × scale × placement.gain) → lowpass(cutoff) → panner(pan) → destination; when the context lacks panner/filter, skip that node. `startLoop(clip, placement?)` returns a `LoopHandle` with `setPlacement(mix)` (ramped ≈ 0.1 s) besides `setRate`/`stop`.
- `ArenaSound` gains `setListener(listener: Listener): void`. `handleEvents` places every event that has a position (`shot`/`hit`/`explosion`/`collapse`/`door`/`pickup`/`hijack`; `impact` at its vehicle — pass positions in via a lookup the runtime supplies, or skip placement when unknown) with its class profile; a mix with `gain < MIN_AUDIBLE_GAIN` (0.01) plays nothing. The synth fallback voices get the same gain/pan (route oscillator → gain → panner). Cap live one-shots at 24 (drop the quietest new one when full). Your own shots/footsteps are placed at your position (centred, full).
- [ ] Tests (fake context): a far shot plays with lower gain than a near one; a shot east of a north-facing 2D listener pans right; beyond max nothing plays; missing panner support still plays; loop `setPlacement` ramps gain and pan; the 25th simultaneous voice is refused.
- [ ] Commit `feat(arena): place every sound around the listener`.

### Task 3: Listener wiring, footsteps, skid, death

**Files:** modify `arenaRuntime.ts`, `arenaFeel.ts`, `useArenaGame.ts` / `view3d/useView3d.ts` (wherever the 3D yaw lives), `sound.ts` (+ tests).

- Each rendered frame the runtime calls `sound.setListener({x, y, facing})`: your player (or car) position; facing = the 3D camera yaw while 3D is active (read it from the view's look state), else `−π/2`.
- Footsteps: `sound.updateSelf({ speedMps, onFoot, dt })` accumulates distance and plays `footstep` every stride (walk `WALK_STRIDE_M`, run `RUN_STRIDE_M` — import the constants' values from `characterPose.ts` by value only if that file is outside `render3d` rules; otherwise duplicate them as named audio constants with a comment), rate jittered ±6 %. Peds within a few metres get quieter footsteps of their own (spec §6), placed at the ped.
- Skid: when your car's lateral slip or deceleration passes a threshold (derive from `forwardSpeed` change and steer × speed), play `skid` once per slide with a cooldown.
- Death: your own `kill` event as victim plays `death`.
- [ ] Tests: listener facing follows 3D yaw and falls back to north in 2D; footsteps play at stride cadence and stop in a car; skid respects its cooldown; death plays only for your own death.
- [ ] Commit `feat(arena): footsteps, skids and the death sound`.

### Task 4: Traffic engines and sirens where the cars are

**Files:** create `audio/trafficVoices.ts` (+ test); modify `sound.ts`, `arenaRuntime.ts`.

```ts
export type TrafficSource = {
  id: number;
  x: number;
  y: number;
  speedMps: number;
  siren: boolean;
};
export const ENGINE_VOICES = 4;
export const SIREN_VOICES = 2;
/** Stable assignment: keeps a car on its voice while it stays among the nearest. */
export function assignVoices(
  previous: readonly (number | null)[],
  sources: readonly TrafficSource[],
  listener: Listener,
  count: number,
  filter: (s: TrafficSource) => boolean,
): (number | null)[];
```

- `sound.updateWorld(world: { traffic: TrafficSource[]; … })` (called per frame with the scene's moving, non-wrecked vehicles other than your own, plus other players' cars) keeps `ENGINE_VOICES` engine loops placed on the nearest cars (rate from `engineRate(speed)`, gain × speed share so parked cars are silent) and `SIREN_VOICES` siren loops on the nearest siren cars (`scene.sirenVehicleIds`). The old global `updateSiren` goes away (update `arenaRuntime.ts` and tests).
- [ ] Tests: nearest-first, stable when order jitters, releases a voice when a car leaves range, sirens only on siren cars, parked cars silent.
- [ ] Commit `feat(arena): hear traffic and sirens where they drive`.

### Task 5: Ambience from the surroundings

**Files:** create `audio/surroundings.ts`, `audio/ambience.ts` (+ tests); modify `sound.ts`, `clips.ts`.

```ts
export type Surroundings = {
  roadM: number;
  movingCars: number;
  peds: number;
  trees: number;
  greenShare: number;
  waterShare: number;
  buildingShare: number;
};
export function readSurroundings(
  tiles: readonly DecodedTile[],
  scene: { peds; vehicles },
  listener: Listener,
): Surroundings; // radii: roads/traffic 80 m, peds 30 m, trees/ground 60 m
export type AmbienceLoop =
  "amb-traffic" | "amb-crowd" | "amb-birds" | "amb-wind" | "amb-water";
export function ambienceLevels(s: Surroundings): Record<AmbienceLoop, number>; // 0…1 each
```

Sample the ground kind on a coarse grid (e.g. 9×9 over 120 m) with the tiles' ground polygons; count trees from tile `trees`; road length from road segments clipped to the radius. Levels: traffic from road length + moving cars; crowd from peds; birds from trees + green share, lowered by traffic; wind from open (low building share, high field share); water from water share. The sound layer re-reads surroundings at most every 0.5 s and ramps each loop's gain toward its level over ≈ 1.5 s; loops start on first need and stop when at 0 for 5 s. Respect the `ambience` setting (Task 7).

- [ ] Tests: a synthetic tile with a busy road → traffic high, birds low; a park tile with trees → birds high; a tile of fields with no buildings → wind high; near water → water high; levels in [0, 1].
- [ ] Commit `feat(arena): ambience that follows where you are`.

### Task 6: Spot sounds

**Files:** create `audio/spotSounds.ts` (+ test); modify `sound.ts`, `clips.ts`.

```ts
export type SpotKind =
  "chatter" | "bike-bell" | "dog" | "horn" | "church-bell" | "scooter";
export type SpotRequest = {
  kind: SpotKind;
  clip: ClipName;
  x: number;
  y: number;
};
export function createSpotScheduler(seed: number): {
  step(
    dt: number,
    listener: Listener,
    nearby: { peds: { x; y }[]; traffic: TrafficSource[] },
    landmarks: readonly { id: string; x: number; y: number }[],
  ): SpotRequest[];
};
```

Per kind a mean interval and a condition: chatter every ≈ 4–9 s from a random ped within 18 m (several chatter clips, pick at random); bike bell ≈ 25–60 s near roads; dog ≈ 40–90 s near green; horn ≈ 20–45 s from a moving car within 60 m; church bell every ≈ 3–5 min when within 700 m of the Cunera church (find its landmark id/position in the map/mission data, e.g. `landmarkDressing.ts` / missions JSON); scooter ≈ 30–70 s near roads (placed moving along a road is optional — a static placement near the nearest road point is fine). Deterministic given the seed (inject a PRNG).

- [ ] Tests with a fixed seed: chatter never fires with no ped nearby; fires within its interval when peds are near; church bell only near Cunera; requests carry the source's position.
- [ ] Commit `feat(arena): chatter, bells, dogs and horns around you`.

### Task 7: Clips, setting, docs, PR

- [ ] `clips.ts`: add `amb-traffic`, `amb-crowd`, `amb-birds`, `amb-wind`, `amb-water` (loops) and `chatter-1..4`, `bike-bell`, `dog`, `horn`, `church-bell`, `scooter` (one-shots) with gains. `generate-audio.ts`: prompts (loops: `loop: true`, 22–28 s, e.g. "evening city street ambience in a small Dutch town, distant traffic, no voices, seamless"; chatter: "a few people talking quietly in Dutch nearby, indistinct murmur, no clear words"; church bell: "single large church bell tolling three times, distant, reverberant"), `LITERAL_INFLUENCE` where literalness matters. Generate with the owner-approved key: `node node_modules/dotenv-cli/cli.js -e C:/Users/Guido/Projects/H3-Teamy/.env -- npx tsx scripts/arena/generate-audio.ts <names…>` (only the new names). Listen-proxy: check durations/sizes and that loops are ≥ 20 s; update `CREDITS.md` via the script; `npm run arena:check-audio` green (raise its budget constant only as far as needed, ≤ 2.5 MB new).
- [ ] Settings: `ambience: z.boolean().default(true)` in the arena settings schema + defaults; "Omgevingsgeluid" switch in `ArenaSettingsSheet.tsx` beside Geluid/Radio (Dutch label constant, test like the Geluid one); the sound layer mutes ambience, spot sounds and the peds' footsteps when off.
- [ ] Browser check: you cannot listen, so expose (non-production, `?debug=1`) `window.__arena.audio = { levels(), voices() }` and verify: walking in the centre raises traffic/crowd, a park raises birds, a cop's shot at 100 m is quieter and panned; screenshot not required. Confirm no console errors.
- [ ] `docs/tech/arena/README.md` audio section (listener, profiles, loops, spot sounds, setting, clip budget).
- [ ] Full verification (`tsc`, `lint`, `vitest run`, `build`, `arena:check-audio`), de-slop, push, PR `feat(arena): city ambience and spatial audio` against `image` with rulings listed. Do not merge.

## Browser checks

Port **3012** (launch config `h3-immersion-audio`), preview DB, `trainer@example.test` / `preview123`, `/arena/spelen?debug=1`, "Stad verkennen". Use your **own browser tab** (`tabs_create`) and pass its `tabId` to every call.
