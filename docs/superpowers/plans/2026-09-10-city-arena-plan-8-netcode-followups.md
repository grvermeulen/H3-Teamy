# Netcode Follow-ups Implementation Plan (Plan 8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two netcode gaps left open by Plans 3b and 6 — the server refusing a migrated host, and a joiner's camera flying across the map on its first snapshot — and make the join code in the lobby easy to read out.

**Architecture:** The server stops guessing the host from presence alone: the acting host of a room is whoever published the room's latest snapshot recently, and presence election is only the fallback for a room that has not started stepping. That is exactly the rule the clients already live by (a host is someone you hear from), so the two sides agree during a migration. The joiner's jump becomes a cut: the camera snaps to the seat and the screen fades in from black over a few ticks, through the existing feedback fold, and the same cut serves the zone teleport and the lost-seat recovery. The lobby code becomes a display-size element with a copy button. Nothing in the simulation or the wire format changes.

**Tech Stack:** Ably REST (`presence.get`, `history`), the existing feedback fold (`render/feedback.ts`), Canvas 2D, Vitest 5. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-03-city-arena-design.md` — §6.3 lobby and rooms, §6.6 host election and migration, §8 camera. The server-side rule is an amendment to §6.6 that Task 4 writes in, dated.

## Global Constraints

- All user-facing strings in **Dutch (NL)**. New copy: **Kopieer** / **Gekopieerd**.
- JSDoc on every exported symbol; no `any`; `catch (error: unknown)` with `Sentry.captureException(error, { tags: { area: "arena", kind } })` or a re-throw.
- Functions under **50 lines**, files under **400 lines**; the route and the service stay small by moving the Ably reads into one helper module.
- No inline `style` props.
- Tests co-located; `beforeEach(() => vi.clearAllMocks())` in mocked suites; `afterEach(cleanup)` in component suites.
- Conventional Commits, subject ≤72 chars.
- Verification loop before every push: `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build` (revert the artefacts), `npm run arena:check-audio`.

## Design decisions

- **The acting host is the best-ranked present member heard from** — one with a snapshot within `ACTING_HOST_FRESH_MS = 10_000` ms; a lower-ranked member only while everyone above it is silent, which is when the clients re-elect too. A migrated host publishes within three seconds of taking over (spec §6.6's silence rule), so the server sees it before the old host's presence entry has timed out. When nobody has published in that window — a room that has not started stepping — the presence election (`electHost`) decides, as before. **Trust model, unchanged in strength:** the server already trusted self-declared roles for the election; a member who publishes forged state messages could now pass as host for the server, exactly as one who declared itself a `display` already could, and the clients ignore both (they accept snapshots from the elected host only). The service's header states this.
- **Ably history without persistence keeps two minutes of messages**, which is plenty for a ten-second window. One `history({ limit: 5, direction: "backwards" })` call per advertised room per listing (cached five seconds) and one per result posted.
- **A cut, not a pan.** The camera has an exponential ease with no distance cap; a joiner seated kilometres from where it was roaming gets a half-second fly-over of unrastered tiles. `cutTo(runtime, point)` snaps the camera and sets `feedback.cutFade = 1`, which `stepFeedback` walks down to 0 over `CUT_FADE_TICKS = 12` (0.4 s) while `drawFeedback` paints black at that alpha. The zone teleport and the lost-seat recovery get the same cut. Reduced motion keeps the fade: a fade is not motion.
- **The code is for reading out loud.** Display type, letter-spaced, amber, with **Kopieer** next to it when the Clipboard API exists; the zone name steps down to the second line.

## File Structure

| File                                       | Responsibility                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/lib/cityArena/net/election.ts`        | + `ACTING_HOST_FRESH_MS`, `SnapshotSighting`, `actingHost(members, latest, nowMs, freshMs)` |
| `src/lib/cityArena/net/roomHost.ts`        | Server-side reads over Ably REST: `presenceOf`, `latestSnapshotOf`, `resolveRoomHost`       |
| `src/app/api/arena/rooms/route.ts`         | `verifiedRooms` asks `resolveRoomHost`                                                      |
| `src/lib/services/arenaMatchService.ts`    | `recordMatch` asks `resolveRoomHost`; trust model restated                                  |
| `src/lib/cityArena/render/feedback.ts`     | + `cutFade`, `CUT_FADE_TICKS`, `withCut`, black overlay in `drawFeedback`                   |
| `src/components/cityArena/arenaRuntime.ts` | + `cutTo`; `applyTeleport` and `recoverSeat` use it                                         |
| `src/components/cityArena/useNetplay.ts`   | `adoptSeat` cuts to the seat                                                                |
| `src/components/cityArena/ArenaLobby.tsx`  | The code as a display element with **Kopieer**                                              |
| `docs/tech/arena/README.md`, the spec      | Plan 8 section; §6.6 amendment                                                              |

---

### Task 1: The server recognises the acting host

**Files:**

- Modify: `src/lib/cityArena/net/election.ts`
- Create: `src/lib/cityArena/net/roomHost.ts`, `src/lib/cityArena/net/roomHost.test.ts`
- Modify: `src/app/api/arena/rooms/route.ts`, `src/lib/services/arenaMatchService.ts`, `src/app/api/arena/realtime-token/route.ts` (doc comment only)
- Test: `src/lib/cityArena/net/election.test.ts`, `src/app/api/arena/rooms/route.test.ts`, `src/lib/services/arenaMatchService.test.ts`

**Interfaces:**

```ts
// election.ts
export const ACTING_HOST_FRESH_MS = 10_000;
export type SnapshotSighting = { clientId: string; timestamp: number };
/** The latest recent publisher who is present; else the presence election. */
export function actingHost(
  members: PresenceMember[],
  latest: SnapshotSighting | null,
  nowMs: number,
  freshMs?: number,
): string | null;

// roomHost.ts
export type RoomRest = Pick<Ably.Rest, "channels">;
export async function presenceOf(
  rest: RoomRest,
  channel: string,
): Promise<PresenceMember[]>;
export async function latestSnapshotOf(
  rest: RoomRest,
  channel: string,
): Promise<SnapshotSighting | null>;
export type RoomHost = { host: string | null; members: PresenceMember[] };
export async function resolveRoomHost(
  rest: RoomRest,
  roomCode: string,
  nowMs?: number,
): Promise<RoomHost>;
```

- [ ] **Step 1: Write the failing tests**

`election.test.ts`, in a new `describe("actingHost")`: a fresh sighting by a present member wins over the presence election even when that member entered last; a sighting older than the window falls back to `electHost`; a sighting by someone not present falls back; `null` for nobody present; a custom window is honoured.

`roomHost.test.ts`, with `channels.get` returning `{ presence: { get }, history }` fakes: `latestSnapshotOf` picks the newest message named `state` and skips other names, and returns `null` on an empty page or a message without a client id; `resolveRoomHost` returns the members and the acting host at the given time.

`rooms/route.test.ts`: the fake channel gains `history: async () => ({ items: historyByChannel.get(name) ?? [] })`. New case: "lists a room under its migrated host": "a" entered first and is still present, "b" advertises and published the latest `state` message a second ago → the room is listed with `hostName` from "b". Existing "forger" case unchanged (no history → presence election → "a", not "x").

`arenaMatchService.test.ts`: the mocked channel gains `history` (default: empty page). New cases: a migrated host — "guest" published the latest snapshot just now — records; a poster who is present but published nothing while "host" is the presence winner is refused as `not-host`.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement**

```ts
// election.ts — after electHost
/** A snapshot this old still names the acting host; a migrated host publishes well within it. */
export const ACTING_HOST_FRESH_MS = 10_000;

/** Who published a snapshot, and when the server received it. */
export type SnapshotSighting = { clientId: string; timestamp: number };

/**
 * The member actually hosting: whoever published the room's latest snapshot recently and is
 * still present, else the presence election. The server has no silence watch, and an old host's
 * presence entry outlives its tab by up to minutes; what it does have is the channel's history,
 * and a host is someone you hear from — the same rule the clients live by.
 */
export function actingHost(
  members: PresenceMember[],
  latest: SnapshotSighting | null,
  nowMs: number,
  freshMs: number = ACTING_HOST_FRESH_MS,
): string | null {
  if (
    latest &&
    nowMs - latest.timestamp <= freshMs &&
    members.some((member) => member.clientId === latest.clientId)
  )
    return latest.clientId;
  return electHost(members);
}
```

`roomHost.ts`: `presenceOf` is the function the route and the service each had, moved; `latestSnapshotOf` calls `rest.channels.get(channel).history({ limit: HISTORY_PAGE, direction: "backwards" })` with `HISTORY_PAGE = 5`, takes the first item whose `name === "state"` and has a `clientId` and a `timestamp`, else `null`; `resolveRoomHost` reads both for `roomChannelName(roomCode)` in parallel and returns `{ host: actingHost(members, latest, nowMs), members }`. The route's `verifiedRooms` becomes `(await resolveRoomHost(rest, room.roomCode)).host === advertiserByCode.get(room.roomCode)`; the service's `recordMatch` does `const { host, members } = await resolveRoomHost(new Ably.Rest({ key }), input.roomCode)` and refuses when `host !== posterUserId`. Rewrite the service header's first bullet and the token route's comment to state the rule.

- [ ] **Step 4: Run the tests, lint, `tsc`; commit** — `fix(arena): the server recognises a migrated host`.

---

### Task 2: A cut instead of a fly-over

**Files:**

- Modify: `src/lib/cityArena/render/feedback.ts`, `src/components/cityArena/arenaRuntime.ts`, `src/components/cityArena/useNetplay.ts`
- Test: `src/lib/cityArena/render/feedback.test.ts`, `src/components/cityArena/useNetplay.test.ts` (the seat-adoption case)

**Interfaces:**

```ts
// feedback.ts
export const CUT_FADE_TICKS = 12;
export type FeedbackState = { …; /** Black over the scene after a cut, 1 to 0. */ cutFade: number };
export function withCut(state: FeedbackState): FeedbackState; // { ...state, cutFade: 1 }
// arenaRuntime.ts
/** Snaps the camera to `point` and fades the scene in from black: the world changed under us. */
export function cutTo(runtime: Runtime, point: Point): void;
```

- [ ] **Step 1: Write the failing tests** — `stepFeedback` walks `cutFade` from 1 to 0 over twelve ticks and reduced motion does not skip it; `drawFeedback` fills the whole viewport black at `globalAlpha = cutFade` and still draws nothing for a quiet state; `withCut` sets 1 and keeps the rest. In `useNetplay.test.ts`, after a client adopts its seat: the runtime's camera sits on its player and `feedback.cutFade` is 1.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement** — `INITIAL_FEEDBACK.cutFade = 0`; in `stepFeedback`, `cutFade: Math.max(0, previous.cutFade - 1 / CUT_FADE_TICKS)`; in `drawFeedback`, after the hit marker, `if (state.cutFade > 0) { context.globalAlpha = state.cutFade; context.fillStyle = "#07090b"; context.fillRect(0, 0, size.width, size.height); }` and include `cutFade` in the quiet-state early return. `cutTo` in `arenaRuntime.ts`: `runtime.camera = createCamera(point, runtime.camera.zoom); runtime.feedback = withCut(runtime.feedback); runtime.lastTileSync = 0;` — `applyTeleport` calls it instead of its own two lines, `recoverSeat` calls it with the spawned player's position after `runtime.state = joined.state`, and `adoptSeat` in `useNetplay.ts` calls it with `myPlayer(runtime)`'s position after `runtime.netplay` is set.

- [ ] **Step 4: Run the tests, lint, `tsc`; commit** — `fix(arena): cut to the seat instead of flying the camera there`.

---

### Task 3: The join code you can read out

**Files:**

- Modify: `src/components/cityArena/ArenaLobby.tsx`
- Test: `src/components/cityArena/ArenaLobby.test.tsx`

**Interfaces:** `COPY_LABEL = "Kopieer"`, `COPIED_LABEL = "Gekopieerd"`, `COPIED_FOR_MS = 2000` exported from `ArenaLobby.tsx`; the code carries `data-testid="room-code"` and `aria-label="Code {roomCode}"`.

- [ ] **Step 1: Write the failing test** — replace the `"Room 7K4M2Q · Lobby"` assertion: the header shows `Lobby`, the code `7K4M2Q` (by test id), and the zone name; with `navigator.clipboard.writeText` mocked, clicking **Kopieer** writes the code and the button reads **Gekopieerd** until the timer runs out (fake timers); without a clipboard there is no button.

- [ ] **Step 2: Run it and watch it fail.**

- [ ] **Step 3: Implement** — a `CopyCodeButton({ code })` component (state `copied`, `setTimeout` cleared on unmount, `navigator.clipboard.writeText(code)` in a try/catch reporting `kind: "lobby-copy"`); the header's left column becomes: `<span className="arena-label block text-[var(--arena-dim)]">Lobby</span>`, a row with `<span data-testid="room-code" aria-label={`Code ${roomCode}`} className="arena-display text-4xl tracking-[0.2em] text-[var(--arena-amber)] sm:text-5xl">{roomCode}</span>` and the button, then the zone name as `<h2 className="arena-display mt-1 text-lg text-[var(--arena-text)] sm:text-xl">`.

- [ ] **Step 4: Run the tests, lint; commit** — `feat(arena): a join code you can read across the room`.

---

### Task 4: Documentation, verification and the PR

- [ ] **Step 1: README** — in the netcode section: the acting-host rule and the history read; in the Plan 6/7 area: the cut fade; the lobby code.
- [ ] **Step 2: Spec §6.6** — a dated line: the server's acting-host rule and its fallback; §8: the cut.
- [ ] **Step 3: Verify** — the full loop, artefacts reverted.
- [ ] **Step 4: PR** against `image`, watch, address CodeRabbit, merge on green.

## Self-review

- **Coverage:** item 1 (T1), item 2 (T2), the owner's lobby request (T3), docs (T4).
- **Types:** `SnapshotSighting` is defined in `election.ts` and used by `roomHost.ts`; `cutTo` takes a `Point` (`world/projection`), the same type `createCamera` takes; `withCut` is the only writer of `cutFade` outside the fold.
- **Placeholders:** none — the rule, the constants and the markup are spelled out.
