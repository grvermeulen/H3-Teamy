# Polish Implementation Plan (Plan 6): sound, feel and controls

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the arena _feel_ like a game: recorded sound instead of oscillator tones, haptics, damage and hit feedback, the twin-stick touch layout the spec designed, and the settings that switch it all off.

**Architecture:** Nothing here changes the simulation. Sound gains a sample player that sits in front of the existing synthesiser and falls back to it clip by clip, so the game sounds exactly as it does today until audio files land and improves the moment they do. Haptics and feedback are new leaf modules read by the frame loop. Controls extend the existing `input/` modules rather than replacing them.

**Tech Stack:** Web Audio (`decodeAudioData`), `navigator.vibrate`, Canvas 2D, Zod for settings, Vitest 4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-03-city-arena-design.md` — §7 controls and feedback, §9.3 client storage, §14 delivery (this is PR 6 of the stack).

## Global Constraints

- All user-facing strings in **Dutch (NL)**: this plan adds a settings menu, so it adds copy. Spec §16 is the glossary.
- JSDoc on every exported symbol (`.coderabbit.yaml` enforces ≥80% docstring coverage).
- No `any`, `catch (error: unknown)`, explicit return types on exports.
- Functions under **50 lines**, files under **400 lines**.
- Every `catch` calls `Sentry.captureException(error, { tags: { area: "arena", kind } })` or re-throws. **Audio and haptics failures must never reach the caller** — a browser that refuses to decode, or a device with no vibration motor, loses the effect and nothing else. This is the same rule `kv.ts` follows for cache writes.
- No inline `style` props; Tailwind utilities only.
- Tests co-located; `vi.stubEnv` for env vars; `beforeEach(() => vi.clearAllMocks())` in every mocked `describe`.
- Conventional Commits, subject ≤72 chars.
- Verification loop before every push: `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

## What already exists

Read this before planning any task around it — several spec §7 items shipped in earlier PRs:

| Spec §7 item                                                                   | State                                                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Death screen, WASTED artwork, slow-motion beats                                | **Done** (Plan 4a)                                                                                  |
| Movement stick, per-axis dead zone, analog steering                            | **Done** (Plan 4b, PR 5)                                                                            |
| Instappen / Wapen touch buttons, Geluid toggle                                 | **Done** (Plan 4b)                                                                                  |
| Synthesised SFX + engine drone (`audio/sound.ts`, 254 lines, oscillators only) | **Done, and this plan replaces the front half**                                                     |
| Keyboard: WASD/arrows, Space, E/F/Enter, Q                                     | **Done** (`input/keyboard.ts`)                                                                      |
| Mouse aim + crosshair (`input/pointerAim.ts`)                                  | **Done**                                                                                            |
| Recorded audio, any sample playback                                            | **Missing** — no audio files exist in the repo                                                      |
| Haptics                                                                        | **Missing** — `vibrate` appears nowhere in `src/`                                                   |
| Damage vignette, screen shake, hit marker, low-health throb                    | **Missing** — no `render/feedback.ts`                                                               |
| Right-hand aim stick ("twin-stick", the spec's mobile default)                 | **Missing** — one stick plus buttons today                                                          |
| Settings beyond sound                                                          | **Missing** — `ArenaSettingsSchema` holds only `lastZone` and `sound`                               |
| First-run touch tip                                                            | **Missing** for the arena; `components/spaceInvaders/SpaceInvadersGame.tsx` has the pattern to copy |
| Keyboard: Tab scoreboard, Esc menu, 1/2/3, mouse wheel                         | **Missing**                                                                                         |

## The audio asset decision

Tasks 1 and 3 build the player and work with **no files present**. Task 2 is the only one that needs artwork, and it is blocked on the owner choosing a source:

- **CC0 packs** (Freesound, OpenGameArt) — free, hand-picked, quality varies, every file needs a credit row.
- **A paid pack** — consistent, one licence line, ~$20–50.
- **Generated audio** — no service is connected to this workspace today.

Whatever the source, the licence terms travel with the files: Task 2 writes `public/arena/audio/CREDITS.md` with one row per clip (file, source, author, licence, URL) and `npm run arena:check-audio` fails when a clip in the table has no file **or** no credit row. The repo is public; unattributed CC-BY audio is a licence breach, not a nit.

**Format:** mono MP3, 44.1 kHz, ≤ 96 kbps for one-shots — universally decodable by `decodeAudioData`, no fallback format needed. The engine loop must be seamless (equal start and end sample). Budget guardrail, not a design constraint: keep the whole set under ~500 KB, and raise it rather than thin the set if better audio needs the room (the owner's 2026-09-07 ruling on the map budget applies here too).

## Acceptance

1. **With no audio files in the repo**, every existing test passes and the game sounds exactly as it does today — the synthesiser handles every event. A test asserts this explicitly, so the branch is mergeable before the owner has sourced anything.
2. **With files present**, `npm run arena:check-audio` passes, and a test proves each event prefers its sample and falls back per clip when one is missing.
3. Haptics never fire when **Trillen** is off, and never more than one pulse per 80 ms.
4. Device check on a phone: sound, vibration, the damage vignette and screen shake all present; the settings sheet switches each off and the choice survives a reload.

---

## File Structure

**Created:**

- `src/lib/cityArena/audio/clips.ts` — the clip table: name → file, gain, whether it loops.
- `src/lib/cityArena/audio/samples.ts` + test — fetch, decode, cache, play.
- `src/lib/cityArena/input/haptics.ts` + test — the spec's patterns, rate limit and priority.
- `src/lib/cityArena/render/feedback.ts` + test — vignette, shake, hit marker, heartbeat.
- `src/components/cityArena/ArenaSettingsSheet.tsx` + test — the Dutch settings menu.
- `scripts/arena/check-audio.ts` — the clip/credit checker behind `npm run arena:check-audio`.
- `public/arena/audio/` — the files themselves plus `CREDITS.md` (Task 2).

**Modified:**

- `src/lib/cityArena/audio/sound.ts` — routes each event to a sample, else to the existing oscillator.
- `src/lib/cityArena/schemas.ts` — `ArenaSettingsSchema` gains `vibrate`, `twinStick`, `forceLayout`.
- `src/lib/cityArena/input/keyboard.ts` — Tab, Esc, 1/2/3, wheel.
- `src/components/cityArena/CityArenaOverlay.tsx` — the aim stick, the settings sheet, the first-run tip.
- `src/components/cityArena/arenaRuntime.ts` — feeds events to haptics and feedback.

---

### Task 1: A sample player that falls back to the synthesiser

**Files:**

- Create: `src/lib/cityArena/audio/clips.ts`, `src/lib/cityArena/audio/samples.ts`, `src/lib/cityArena/audio/samples.test.ts`
- Modify: `src/lib/cityArena/audio/sound.ts`

**Interfaces:**

- Produces:
  - `type ClipName = "pistol" | "uzi" | "shotgun" | "footstep" | "engine" | "skid" | "impact" | "explosion" | "siren" | "pickup" | "death"`
  - `AUDIO_CLIPS: Record<ClipName, { file: string; gain: number; loop: boolean }>`
  - `createSamplePlayer(context: AudioContextLike, fetchImpl?: typeof fetch): SamplePlayer`
  - `type SamplePlayer = { preload(): Promise<void>; play(clip: ClipName, rate?: number): boolean; startLoop(clip: ClipName): LoopHandle | null; has(clip: ClipName): boolean }`

`play` returning `false` is the whole fallback contract: the caller then does what it does today.

- [ ] **Step 1: Write the failing test**

```ts
it("reports every clip missing before anything decodes, so the synth keeps the sound", () => {
  const player = createSamplePlayer(fakeContext(), notFound());
  expect(player.has("pistol")).toBe(false);
  expect(player.play("pistol")).toBe(false);
});

it("plays a decoded clip once and reports it played", async () => {
  const context = fakeContext();
  const player = createSamplePlayer(context, servingOneClip("pistol"));
  await player.preload();
  expect(player.play("pistol")).toBe(true);
  expect(context.started).toHaveLength(1);
});
```

`fakeContext()` extends the existing `audio/testing/fakeAudioContext.ts` with `createBufferSource` and `decodeAudioData`; add those there rather than writing a second fake.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/cityArena/audio/samples.test.ts`
Expected: FAIL — `createSamplePlayer` is not exported.

- [ ] **Step 3: Implement**

`preload()` fetches every clip, decodes it, and keeps the successes; a clip that 404s or fails to decode is reported to Sentry **once** (`kind: "audio"`, `clip: name`) and left out of the map. `play` looks the clip up, returns `false` when absent, else starts a buffer source through a gain node at `AUDIO_CLIPS[clip].gain`.

- [ ] **Step 4: Route `sound.ts` through it**

`createArenaSound` takes an optional `samples: SamplePlayer`. Each event handler tries `samples?.play(clip)` first and runs its existing oscillator branch when that returns `false`. Do not delete a single oscillator path — they are the fallback, and Task 2 may never land for some clips.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/lib/cityArena/audio && npx tsc --noEmit`

```bash
git add src/lib/cityArena/audio
git commit -m "feat(arena): play sampled sound with a synth fallback"
```

---

### Task 2: The audio files and their credits

**Blocked on the owner choosing a source.** Everything else in this plan can land first.

**Files:**

- Create: `public/arena/audio/*.mp3`, `public/arena/audio/CREDITS.md`, `scripts/arena/check-audio.ts`
- Modify: `package.json` (`arena:check-audio`), `.github/workflows` verify job

- [ ] **Step 1: Drop the files in**, named exactly as `AUDIO_CLIPS` lists them.

- [ ] **Step 2: Write `CREDITS.md`** — a table with one row per file: file, source, author, licence, URL. A CC0 row still gets a row.

- [ ] **Step 3: Write the checker**

It reads `AUDIO_CLIPS`, asserts each file exists under `public/arena/audio/`, is under 200 KB, and appears in `CREDITS.md`; it exits non-zero listing what is missing. Wire it into `npm run arena:check-audio` and the CI verify job.

- [ ] **Step 4: Verify** — `npm run arena:check-audio`, then play the game and listen to each event.

- [ ] **Step 5: Commit** `feat(arena): ship the sound effects and their credits`.

---

### Task 3: The engine loop from a sample

**Files:** modify `src/lib/cityArena/audio/sound.ts`, `samples.ts`; test in `sound.test.ts`.

- [ ] **Step 1: Write the failing test** — driving raises `playbackRate` above idle, stopping the car stops the loop, and with no `engine` clip the oscillator drone still runs.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement** — `startLoop("engine")` returns a handle with `setRate(rate)` and `stop()`. Map speed to rate over `ENGINE_RATE_MIN = 0.7` … `ENGINE_RATE_MAX = 2.2` across 0 … 25 m/s, and ramp with `linearRampToValueAtTime` over 80 ms so the pitch does not step.
- [ ] **Step 4: Verify and commit** `feat(arena): drive the engine loop from the sample`.

---

### Task 4: Haptics

**Files:** create `src/lib/cityArena/input/haptics.ts` + test; modify `arenaRuntime.ts`.

**Interfaces:** `createHaptics(navigatorLike, enabled: () => boolean): { fire(kind: HapticKind): void }` with `HapticKind = "hit" | "carImpact" | "explosion" | "death" | "kill" | "pickup" | "wanted"`.

- [ ] **Step 1: Write the failing tests**

```ts
it("keeps pulses at least 80 ms apart and lets a stronger one pre-empt", () => {
  const vibrate = vi.fn();
  const haptics = createHaptics({ vibrate }, () => true);
  haptics.fire("pickup");
  haptics.fire("pickup");
  expect(vibrate).toHaveBeenCalledTimes(1);
  haptics.fire("death");
  expect(vibrate).toHaveBeenCalledTimes(2);
});

it("stays silent when Trillen is off and where the device cannot vibrate", () => {
  const vibrate = vi.fn();
  createHaptics({ vibrate }, () => false).fire("death");
  expect(vibrate).not.toHaveBeenCalled();
  expect(() => createHaptics({}, () => true).fire("death")).not.toThrow();
});
```

- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement** the spec §7 patterns: hit 25, car impact 40–90 by speed, explosion `[90, 40, 120]`, death `[120, 60, 220]`, kill `[15, 40, 15]`, pickup 12, wanted `[30, 30, 30]`; `HAPTIC_MIN_GAP_MS = 80`; each kind carries a priority and a higher one ignores the gap. Wrap the `vibrate` call in try/catch with Sentry — some browsers throw on a pattern they dislike. iOS gets nothing: the spec's checkbox-switch trick is explicitly "never relied upon", so leave it out rather than ship a hack that half works.
- [ ] **Step 4: Feed it from the runtime** — the same `state.events` loop that already drives `sound.handleEvents`.
- [ ] **Step 5: Verify and commit** `feat(arena): vibrate on hits, deaths and pickups`.

---

### Task 5: Damage vignette, screen shake and hit markers

**Files:** create `src/lib/cityArena/render/feedback.ts` + test; modify `renderScene.ts`, `arenaRuntime.ts`.

**Interfaces:** `feedbackAt(events, tick, health): FeedbackState` — pure, so it is a unit test, not a screenshot — and `drawFeedback(context, viewport, state)`.

- [ ] **Step 1: Write the failing test** — a damage event within the last 12 ticks gives a vignette alpha above 0 that decays to 0; an explosion gives a 10 px shake and a bullet hit 4 px; health below 25 gives a throb that oscillates; nothing at all gives an all-zero state.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** Shake is an offset applied to the scene transform, not to entity positions, and it is derived from the tick so it is deterministic. Under `prefers-reduced-motion` shake is skipped and the vignette alone plays — the death screen already follows that rule.
- [ ] **Step 4: Verify and commit** `feat(arena): flash, shake and throb on damage`.

---

### Task 6: Settings and the menu

**Files:** modify `schemas.ts`, `storage.ts`; create `ArenaSettingsSheet.tsx` + test; modify `CityArenaOverlay.tsx`.

- [ ] **Step 1: Write the failing test** — `loadArenaSettings()` defaults `vibrate` and `twinStick` to `true` and `forceLayout` to `undefined`; an unknown stored value falls back to the default rather than throwing.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Extend the schema**

```ts
export const ArenaSettingsSchema = z.object({
  lastZone: z.enum(zoneKeys).default(DEFAULT_ZONE),
  sound: z.boolean().default(true),
  vibrate: z.boolean().default(true),
  twinStick: z.boolean().default(true),
  forceLayout: z.enum(["mobile", "desktop"]).optional(),
});
```

- [ ] **Step 4: Build the sheet** — Dutch labels **Geluid**, **Trillen**, **Besturing** (with **Enkele stick**), **Potje verlaten**. Opened by Esc on desktop and a button on mobile; it does not pause anything. Reuse `useDialogFocusTrap`.
- [ ] **Step 5: Verify and commit** `feat(arena): settings for sound, vibration and controls`.

---

### Task 7: The aim stick and the first-run tip

**Files:** modify `TouchStick.tsx`, `CityArenaOverlay.tsx`, `input/touchStick.ts`; create the tip in the overlay.

- [ ] **Step 1: Write the failing test** — with `twinStick` on, a pointer down in the right 55% produces an aim angle and holds fire; releasing stops firing; with `twinStick` off, the same area shows a fire button and aim follows facing.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement** — pointer events keyed by `pointerId`, `touch-action: none` on the canvas, both orientations. The first-run tip copies `TOUCH_TIP_KEY` from `SpaceInvadersGame.tsx` under the arena's own key `h3-arena-touch-tip-v1` (spec §9.3).
- [ ] **Step 4: Verify and commit** `feat(arena): twin-stick aiming and a first-run tip`.

---

### Task 8: Finish the keyboard map

**Files:** modify `input/keyboard.ts` + test, `CityArenaOverlay.tsx`.

- [ ] **Step 1: Write the failing test** — `Tab` held reports the scoreboard as open and releasing closes it; `Escape` toggles the menu; `Digit1`/`Digit2`/`Digit3` select a weapon directly; a wheel event cycles. `Tab` must call `preventDefault` so focus does not leave the canvas.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement**, keeping the existing `WASD`/arrow and button maps untouched.
- [ ] **Step 4: Verify and commit** `feat(arena): scoreboard, menu and weapon keys`.

---

### Task 9: Documentation, verification and the PR

- [ ] **Step 1: Update `docs/tech/arena/README.md`** with a `## Runtime (PR 6 — polish)` section: the clip table and the fallback contract, where audio files and credits live, the haptic patterns and their rate limit, the feedback effects and the reduced-motion rule, the new settings keys, and the twin-stick layout.
- [ ] **Step 2: Run the full verification loop** — `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`, and `npm run arena:check-audio` if Task 2 landed.
- [ ] **Step 3: Device check on a phone** — sound, vibration, vignette, shake, both stick layouts, and the settings surviving a reload. This is the merge gate.
- [ ] **Step 4: Open the PR** against `image` and follow `loop-on-ci` until green with every bot thread resolved.

---

## Self-review

**Spec coverage.** §7 desktop keys → Task 8. §7 mobile twin-stick and the tip → Task 7. §7 haptics → Task 4. §7 universal feedback → Task 5. §9.3 settings keys → Task 6. Recorded audio → Tasks 1–3; the spec never actually promised samples, so this plan is where that promise is made. Not covered, deliberately: the scoreboard _contents_ (Plan 3b owns rounds and scores — Task 8 only opens and closes the panel), and iOS haptics.

**Placeholders.** Task 2 is blocked on an owner decision rather than under-specified: its steps are exact, only the files are missing.

**Type consistency.** `ClipName` and `AUDIO_CLIPS` are defined in Task 1 and used by Tasks 2 and 3. `SamplePlayer.play` returns `boolean` everywhere — that return is the fallback contract. `HapticKind` is defined in Task 4 and used only there and in the runtime.
