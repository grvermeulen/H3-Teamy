# City Arena Netcode Implementation Plan (Plan 3b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the N-player simulation from Plan 3a behind a real transport, so several people on several devices play one match together.

**Architecture:** One member of the room is the **host**: it owns the simulation, steps it at 30 Hz from everyone's inputs, and publishes a full snapshot at 10 Hz. Every other member is a **client**: it predicts its own player locally with the same pure step functions, adopts the host's state for everything else, and replays its unacknowledged inputs on each snapshot. Ably carries the messages; a `RealtimeTransport` interface sits in front of it so the whole stack runs in Vitest against an in-memory transport with no network at all. Nothing in `sim/` changes — Plan 3a already made it N-player.

**Tech Stack:** TypeScript 6.0.3 (pinned), Vitest 5, Zod (already a dependency), `ably` (new). No new dependency beyond `ably`.

**Spec:** `docs/superpowers/specs/2026-09-03-city-arena-design.md` — §6 netcode (the whole of it), §9.2 routes, §10 play modes, §11 observability, §16 Dutch strings.

## Global Constraints

- All user-facing strings in **Dutch (NL)**, taken verbatim from spec §16 — this plan adds several, listed per task.
- Every exported function, type and component carries JSDoc (`.coderabbit.yaml` enforces ≥80% docstring coverage).
- No `any`, no unsafe casts. `catch (error: unknown)`. Explicit return types on exported functions.
- Functions stay under **50 lines**; files stay under **400 lines** (spec §13).
- Every `catch` in production code calls `Sentry.captureException(error, { tags: { area: "arena", kind } })` or re-throws.
- The simulation stays **pure and deterministic**. Netcode code may read the clock; `sim/` may not.
- Tests are co-located. Every `describe` using mocks gets `beforeEach(() => { vi.clearAllMocks(); })`.
- Conventional Commits, subject ≤72 chars, imperative mood.
- Verification before every push: `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

## Blocked on the owner

**Task 3 and Task 4 cannot be finished without an Ably account.** The repo has no `ABLY_API_KEY`, no `ably` dependency, and `scripts/check-preview-env.ts` does not know about one. The owner must create the Ably app and set `ABLY_API_KEY` in Vercel (preview and production) themselves — the key must never be pasted into the repo or into this session. Every other task, **including the acceptance test in Task 10**, runs entirely on `memoryTransport` and needs no account, so the plan is executable start to finish except for the two steps that talk to Ably for real.

## Acceptance: bots

The owner descoped spec §14's four-player session on 2026-09-07 and chose **bots** as this plan's acceptance on the same day. Concretely, Task 10 delivers:

- A host and **three headless bot clients** in one Vitest process, wired through `memoryTransport`, each driven by a scripted input pattern for 600 ticks.
- After the run, every bot's view of the world must **converge on the host's**: same tick, same player count, and each player's position within the interpolation tolerance of the host's own. Divergence beyond that fails the test.
- The invariant checker runs on the host state every tick and must stay empty, exactly as in Plan 3a's `multiplayer.test.ts`.
- A **packet-loss run**: the same match with the transport dropping 10 % of input messages, asserting the host still advances and no client desynchronises permanently.

This is the merge gate that replaces a human session. A device play-test remains the owner's to run before the feature is shown to anyone.

---

## File Structure

**Created — `src/lib/cityArena/net/`:**

- `transport.ts` — the `RealtimeTransport` interface and its supporting types. No implementation.
- `memoryTransport.ts` — an in-process transport: channels, presence, ordered delivery, optional loss/latency injection.
- `ablyTransport.ts` — the Ably implementation.
- `wire.ts` — `encodeInput`/`decodeInput`, `encodeSnapshot`/`decodeSnapshot`. Flat arrays, fixed-point.
- `messages.ts` — Zod schemas for `control` and `event` payloads.
- `hostLoop.ts` — the 30 Hz accumulator, input collection, 10 Hz snapshot publishing.
- `clientLoop.ts` — prediction, replay against snapshots, remote interpolation.
- `election.ts` — the priority sort, the 3 s silence rule, `hostChanged`.
- `room.ts` — 6-char codes, join/leave, capacity.
- Plus a co-located `.test.ts` for each.

**Created — API:**

- `src/app/api/arena/realtime-token/route.ts` — the Ably token endpoint.
- `src/lib/schemas/arena.ts` — request/response Zod schemas (spec §9.2).

**Created — UI:**

- `src/components/cityArena/ArenaLobby.tsx` — new/join a room, the active-potjes list.
- `src/components/cityArena/ConnectionBanner.tsx` — connection state in Dutch.

**Modified:**

- `src/components/cityArena/useArenaGame.ts` — run either the host loop or the client loop instead of stepping locally.
- `src/components/cityArena/arenaRuntime.ts` — "which player am I" comes from the transport's `clientId`, not `LOCAL_PLAYER_ID`.
- `scripts/check-preview-env.ts` — require `ABLY_API_KEY`.
- `package.json` — add `ably`.

**Unchanged:** everything in `src/lib/cityArena/sim/`. If a task finds itself editing `sim/`, that is a signal the design has drifted — stop and reconsider.

---

### Task 1: The transport interface and an in-memory implementation

Everything else in this plan is testable only because this exists first. `memoryTransport` is not a mock: it is a real implementation with real ordering and presence semantics, so the host and client loops are exercised for real in Vitest.

**Files:**

- Create: `src/lib/cityArena/net/transport.ts`
- Create: `src/lib/cityArena/net/memoryTransport.ts`
- Test: `src/lib/cityArena/net/memoryTransport.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `RealtimeTransport`, `TransportChannel`, `PresenceData`, `PresenceMember`, `PresenceEvent`, `ConnectionState`; `createMemoryTransport(hub: MemoryHub, clientId: string): RealtimeTransport` and `createMemoryHub(options?: { dropRate?: number; latencyTicks?: number; random?: () => number }): MemoryHub`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createMemoryHub, createMemoryTransport } from "./memoryTransport";

describe("memoryTransport", () => {
  it("delivers a published message to every other subscriber, in order", async () => {
    const hub = createMemoryHub();
    const first = createMemoryTransport(hub, "a");
    const second = createMemoryTransport(hub, "b");
    await first.connect();
    await second.connect();
    const seen: unknown[] = [];
    second.channel("room").subscribe("input", (msg) => seen.push(msg.data));
    await first.channel("room").publish("input", [1]);
    await first.channel("room").publish("input", [2]);
    hub.flush();
    expect(seen).toEqual([[1], [2]]);
  });

  it("reports presence members with the order they entered", async () => {
    const hub = createMemoryHub();
    const first = createMemoryTransport(hub, "a");
    const second = createMemoryTransport(hub, "b");
    await first.connect();
    await second.connect();
    await first.channel("room").presence.enter({
      name: "Ann",
      colour: "#f00",
      role: "player",
      device: "desktop",
    });
    await second.channel("room").presence.enter({
      name: "Bo",
      colour: "#0f0",
      role: "player",
      device: "mobile",
    });
    const members = await first.channel("room").presence.get();
    expect(members.map((member) => member.clientId)).toEqual(["a", "b"]);
    expect(members[0].timestamp).toBeLessThanOrEqual(members[1].timestamp);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/cityArena/net/memoryTransport.test.ts`
Expected: FAIL — cannot resolve `./memoryTransport`.

- [ ] **Step 3: Write `transport.ts`**

Copy the interface from spec §6.1 verbatim, adding JSDoc to every member and these supporting types:

```ts
/** How a member is taking part, which also sets their host priority (spec §6.6). */
export type PresenceRole = "player" | "controller" | "display";

/** What every member publishes about themselves into a channel's presence set. */
export type PresenceData = {
  name: string;
  colour: string;
  role: PresenceRole;
  device: "mobile" | "desktop";
  displayId?: string;
};

/** A member currently present, with the server-side timestamp that fixes join order. */
export type PresenceMember = {
  clientId: string;
  data: PresenceData;
  timestamp: number;
};

/** A presence change: someone entered, updated their data, or left. */
export type PresenceEvent = {
  action: "enter" | "update" | "leave";
  member: PresenceMember;
};

/** Connection states the UI reacts to (spec §16 gives the Dutch copy for each). */
export type ConnectionState =
  "connected" | "connecting" | "suspended" | "failed";
```

- [ ] **Step 4: Write `memoryTransport.ts`**

The hub owns the channels; a transport is one client's view of it. Deliver on `flush()` rather than synchronously inside `publish`, so tests control when messages land and the host loop can be stepped deterministically. Never deliver a message back to its publisher — Ably does not, and the host must not double-count its own input. `timestamp` is a monotonically increasing integer owned by the hub, never `Date.now()`, so presence order is deterministic in tests.

`dropRate` uses the injected `random`, so a loss test is reproducible.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/cityArena/net/memoryTransport.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cityArena/net
git commit -m "feat(arena): add the realtime transport seam and an in-memory one"
```

---

### Task 2: The wire format

Snapshots go out 10 times a second to up to 8 clients, so they are flat integer arrays, not objects. Getting this wrong is expensive and silent, so it is its own task with round-trip tests before anything publishes.

**Files:**

- Create: `src/lib/cityArena/net/wire.ts`
- Create: `src/lib/cityArena/net/messages.ts`
- Test: `src/lib/cityArena/net/wire.test.ts`, `src/lib/cityArena/net/messages.test.ts`

**Interfaces:**

- Consumes: `ArenaState`, `WorldInput` from `sim/types`.
- Produces: `encodeInput(seq: number, input: WorldInput): InputFrame`, `decodeInput(frame: InputFrame): { seq: number; input: WorldInput }`, `encodeSnapshot(state: ArenaState, serverTimeMs: number, lastInputSeqs: Record<number, number>): Snapshot`, `decodeSnapshot(snapshot: Snapshot): SnapshotView`; `ControlSchema`, `ArenaEventSchema` from `messages.ts`.

- [ ] **Step 1: Write the failing round-trip test**

```ts
import { describe, expect, it } from "vitest";
import { createInput } from "../sim/types";
import { decodeInput, encodeInput } from "./wire";

describe("input wire format", () => {
  it("round-trips a move, aim and the button flags", () => {
    const input = createInput({
      move: [1, -0.5],
      aim: Math.PI,
      fire: true,
      enter: true,
    });
    const { seq, input: back } = decodeInput(encodeInput(7, input));
    expect(seq).toBe(7);
    expect(back.move[0]).toBeCloseTo(1, 2);
    expect(back.move[1]).toBeCloseTo(-0.5, 2);
    expect(back.aim).toBeCloseTo(Math.PI, 1);
    expect(back.fire).toBe(true);
    expect(back.enter).toBe(true);
    expect(back.weaponNext).toBe(false);
  });

  it("carries no aim as -1 rather than an angle", () => {
    const frame = encodeInput(1, createInput({ aim: null }));
    expect(frame[3]).toBe(-1);
    expect(decodeInput(frame).input.aim).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/cityArena/net/wire.test.ts`
Expected: FAIL — cannot resolve `./wire`.

- [ ] **Step 3: Write the codecs**

Per spec §6.3: move components are integers −100..100, `aim` is 0..255 (1/256 of a turn) or −1 for none, flags are a bitmask `fire=1, enter=2, weaponNext=4`. Positions in snapshots are 0.1 m integers, angles 1/256 turns. Name every scale factor:

```ts
/** Move components travel as hundredths, so the frame stays integers. */
const MOVE_SCALE = 100;
/** Angles travel as 1/256 of a turn (spec §6.3). */
const ANGLE_STEPS = 256;
/** Positions travel as decimetres. */
const POSITION_SCALE = 10;
/** No aim this tick. */
const NO_AIM = -1;
```

- [ ] **Step 4: Write `messages.ts`**

Zod schemas for the `control` messages (`start`, `zone`, `join`, `leave`) and the `event` union from spec §6.3. These are not hot-path, so they stay objects and are validated on receipt — a malformed control message from a peer must never throw into the loop.

- [ ] **Step 5: Add a snapshot round-trip test and a size assertion**

The size assertion is the point: build a state with 8 players, 25 peds, 16 cars and 20 bullets, encode it, and assert `JSON.stringify(snapshot).length` is under 8 KB — well inside Ably's 64 KB message limit, and a tripwire if someone adds a field to the hot path.

- [ ] **Step 6: Run, then commit**

```bash
git add src/lib/cityArena/net
git commit -m "feat(arena): encode inputs and snapshots as flat integer frames"
```

---

### Task 3: The Ably token endpoint

**Blocked on the owner for the live check** (see "Blocked on the owner"), but the handler and its tests are written and passing without a key: the tests stub the Ably REST client.

**Files:**

- Create: `src/app/api/arena/realtime-token/route.ts`
- Create: `src/lib/schemas/arena.ts`
- Modify: `scripts/check-preview-env.ts`
- Test: `src/app/api/arena/realtime-token/route.test.ts`

**Interfaces:**

- Consumes: `getActiveUser` from the existing auth helper.
- Produces: `GET /api/arena/realtime-token` returning `{ tokenRequest, clientId, displayName }`.

- [ ] **Step 1: Write the failing test**

Cover three cases: a signed-out request gets 401; a signed-in request gets a token request whose `clientId` is the user's id; and an Ably failure is reported to Sentry and returns 502 rather than throwing. Use `vi.stubEnv("ABLY_API_KEY", "test.key:secret")` and `vi.mock("ably")`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/api/arena/realtime-token/route.test.ts`
Expected: FAIL — the route does not exist.

- [ ] **Step 3: Write the route**

Follow `src/app/api/admin/features/route.ts` for shape: thin handler, Zod for anything parsed, `try`/`catch (error: unknown)` with `Sentry.captureException(error, { tags: { area: "arena", kind: "realtime-token" } })`. Capability and TTL come from spec §6.2:

```ts
/** One hour, matching spec §6.2; the client refreshes through its authCallback. */
const TOKEN_TTL_MS = 60 * 60 * 1000;
/** What a member may do: everything inside a room, read-only in the lobby. */
const ARENA_CAPABILITY = {
  "arena:room:*": ["publish", "subscribe", "presence"],
  "arena:lobby": ["subscribe", "presence"],
};
```

- [ ] **Step 4: Require the key in preview**

Add `ABLY_API_KEY` to the required list in `scripts/check-preview-env.ts`, so `npm run dev:preview` fails loudly with a readable message rather than at the first connection attempt.

- [ ] **Step 5: Run the tests, then commit**

```bash
git add src/app/api/arena src/lib/schemas/arena.ts scripts/check-preview-env.ts
git commit -m "feat(arena): issue Ably token requests for signed-in players"
```

- [ ] **Step 6: Owner checkpoint**

Stop here and ask the owner to create the Ably app and set `ABLY_API_KEY` in Vercel preview. Do not proceed to Task 4's live check without it; Tasks 5–10 do not need it and may continue in the meantime.

---

### Task 4: The Ably transport

**Files:**

- Create: `src/lib/cityArena/net/ablyTransport.ts`
- Test: `src/lib/cityArena/net/ablyTransport.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `RealtimeTransport` from Task 1.
- Produces: `createAblyTransport(options: { authUrl?: string }): RealtimeTransport`.

- [ ] **Step 1: Install the dependency**

```bash
npm install ably
```

- [ ] **Step 2: Write the failing test**

Mock the `ably` module and assert the adapter's contract, not Ably's: `connect()` resolves with the `clientId` from the token and a `serverTimeOffsetMs` derived from `client.time()`; `subscribe` returns an unsubscribe that actually detaches; a `suspended` connection state reaches the `onConnectionState` handler.

- [ ] **Step 3: Write the adapter**

`new Ably.Realtime({ authCallback })`, where the callback fetches `/api/arena/realtime-token`. Keep the adapter thin: it translates Ably's shapes into the interface and nothing else — no game logic, no retry policy beyond Ably's own.

- [ ] **Step 4: Run the tests, then commit**

```bash
git add package.json package-lock.json src/lib/cityArena/net
git commit -m "feat(arena): add the Ably realtime transport"
```

---

### Task 5: The host loop

**Files:**

- Create: `src/lib/cityArena/net/hostLoop.ts`
- Test: `src/lib/cityArena/net/hostLoop.test.ts`

**Interfaces:**

- Consumes: `stepArena`, `ArenaInputs` from `sim/`; `encodeSnapshot` from Task 2; `RealtimeTransport` from Task 1.
- Produces: `createHostLoop(options: HostLoopOptions): HostLoop` with `{ advance(elapsedMs: number): void; stop(): void; state(): ArenaState }`.

- [ ] **Step 1: Write the failing test**

The load-bearing assertions: the loop steps 30 times per simulated second regardless of how `advance` is chunked; it publishes a snapshot 10 times per second; a member's input reaches the right player id; and a player who has sent nothing is stepped with `EMPTY_INPUT` rather than freezing the tick.

```ts
it("steps 30 times and publishes 10 snapshots per simulated second", () => {
  const { loop, published } = hostOnMemoryHub();
  loop.advance(1000);
  expect(loop.state().tick).toBe(30);
  expect(published.filter((message) => message.name === "state")).toHaveLength(
    10,
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Write the loop**

An accumulator, not a timer: `advance(elapsedMs)` adds to a leftover and runs whole ticks, so the loop is a pure function of elapsed time and fully testable. `requestAnimationFrame` drives it in the browser; that wiring belongs in Task 9, not here. Clamp the catch-up (a backgrounded tab returning must not run 4 000 ticks at once): cap at 5 ticks per `advance`, and let election cover a host that falls further behind.

Per spec §6.6, a tick that throws is logged to Sentry and skipped; five consecutive failures stop publishing, so the silence rule re-elects someone else.

- [ ] **Step 4: Run, then commit**

```bash
git commit -m "feat(arena): step the match on the host and publish snapshots"
```

---

### Task 6: The client loop

**Files:**

- Create: `src/lib/cityArena/net/clientLoop.ts`
- Test: `src/lib/cityArena/net/clientLoop.test.ts`

**Interfaces:**

- Consumes: `decodeSnapshot` from Task 2, `stepArena` from `sim/`.
- Produces: `createClientLoop(options: ClientLoopOptions): ClientLoop` with `{ advance(elapsedMs: number): void; onSnapshot(snapshot: Snapshot): void; view(): ArenaState; stop(): void }`.

- [ ] **Step 1: Write the failing test**

Three behaviours, each its own test: prediction moves my player before any snapshot arrives; adopting a snapshot and replaying unacknowledged inputs lands within 0.1 m of predicting them locally; and a position error under 3 m is blended over 100 ms rather than snapped, while an error over 3 m snaps.

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write the loop**

The ring buffer keyed by `seq` is the heart of it. On each snapshot: take the host's state, overwrite my player with the host's version, then re-apply every buffered input with `seq > lastInputSeqs[me]` through the same `stepArena`. Health, ammo, kills, hits and pickups are host-only and are never predicted — spec §6.5 is explicit, and predicting them produces flicker.

Remote players render at `serverNow − 120 ms` between the two surrounding snapshots, extrapolating at most 100 ms when starved and then freezing.

Name every constant:

```ts
/** Remote entities render this far behind server time, so there are two snapshots to sit between. */
const INTERPOLATION_DELAY_MS = 120;
/** Beyond this the client stops extrapolating and freezes the entity. */
const MAX_EXTRAPOLATION_MS = 100;
/** Residual prediction error is blended out over this long. */
const RECONCILE_BLEND_MS = 100;
/** Above this the error is too large to hide; snap instead. */
const SNAP_DISTANCE_M = 3;
```

- [ ] **Step 4: Run, then commit**

```bash
git commit -m "feat(arena): predict locally and reconcile against host snapshots"
```

---

### Task 7: Host election and migration

**Files:**

- Create: `src/lib/cityArena/net/election.ts`
- Test: `src/lib/cityArena/net/election.test.ts`

**Interfaces:**

- Consumes: `PresenceMember` from Task 1.
- Produces: `electHost(members: PresenceMember[]): string | null`, `createHostWatch(options: { silenceMs: number }): HostWatch`.

- [ ] **Step 1: Write the failing test**

The sort is `(rolePriority, presenceTimestamp, clientId)` with `display 0, desktop player 1, mobile player 2, controller 3`. Test that it is a total order — two members identical but for `clientId` must still elect deterministically, because every member runs this independently and they must all agree.

```ts
it("elects the same host on every member, whatever order presence arrives in", () => {
  const members = [
    mobilePlayer("c", 3),
    desktopPlayer("a", 5),
    desktopPlayer("b", 5),
  ];
  expect(electHost(members)).toBe("a");
  expect(electHost([...members].reverse())).toBe("a");
});
```

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Write it**

`electHost` is pure. `createHostWatch` holds the 3 s silence rule: it is fed snapshot arrivals and elapsed time, and reports when the host has gone quiet long enough to re-elect. Keeping the clock out of it — elapsed time is passed in — keeps it testable without fake timers.

- [ ] **Step 4: Write the migration test**

The one that matters: run a host and two clients on `memoryTransport`, stop the host mid-match, and assert that a new host is elected, seeds from the last snapshot, publishes within one tick, and that the surviving client's player id and score survive the handover. Spec §6.6 accepts that AI memory such as pathing is rebuilt lazily — assert players and vehicles, not ped paths.

- [ ] **Step 5: Run, then commit**

```bash
git commit -m "feat(arena): elect a host and migrate when one goes quiet"
```

---

### Task 8: Rooms

**Files:**

- Create: `src/lib/cityArena/net/room.ts`
- Test: `src/lib/cityArena/net/room.test.ts`

**Interfaces:**

- Produces: `createRoomCode(random: () => number): string`, `joinRoom(transport, code, data): Promise<JoinResult>`, `ROOM_CAPACITY`.

- [ ] **Step 1: Write the failing test**

Codes are 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — the alphabet excludes I, O, 0 and 1 deliberately, so test that no generated code contains them. Joining a room with no present member fails with the reason that maps to _"Dit potje bestaat niet meer"_; joining a full room fails with the one that maps to _"Potje is vol"_.

The failure reasons are a typed union, not strings — the Dutch copy lives in the component (Task 9), so these stay testable without touching UI text.

- [ ] **Step 2: Run, write it, run again**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(arena): join rooms by code, with capacity and presence checks"
```

---

### Task 9: Lobby and connection UI

**Files:**

- Create: `src/components/cityArena/ArenaLobby.tsx`
- Create: `src/components/cityArena/ConnectionBanner.tsx`
- Modify: `src/components/cityArena/useArenaGame.ts`
- Modify: `src/components/cityArena/arenaRuntime.ts`
- Test: co-located `.test.tsx` for both components

**Dutch strings this task adds**, verbatim from spec §16: _Nieuw potje_, _Meedoen met code_, _Actieve potjes_, _Potje verlaten_, _Nieuwe host: {naam}_, _Verbinding verbroken… opnieuw verbinden_, _Kon geen verbinding maken, probeer het later opnieuw_, _Dit potje bestaat niet meer_, _Potje is vol_.

- [ ] **Step 1: Write the failing component tests**

`ConnectionBanner` renders nothing when connected, the reconnecting copy when `suspended`, and the failure copy when `failed`. `ArenaLobby` lists active potjes and calls its handler with the typed code when one is chosen. Assert on the Dutch strings — they are the contract.

- [ ] **Step 2: Run, watch them fail, write the components**

No inline `style` props (repo rule). Follow the existing arena components for structure.

- [ ] **Step 3: Wire the loops into `useArenaGame`**

This is the task's real work: `useArenaGame` currently steps the simulation locally. It now either drives a `hostLoop` or a `clientLoop` depending on the election, and swaps between them on `hostChanged` without dropping a frame. Offline free-roam keeps the local path untouched — a single-player game must not require a connection.

- [ ] **Step 4: "Which player am I" comes from the transport**

`arenaRuntime` reads `LOCAL_PLAYER_ID` today. It must read the id the host assigned to this `clientId`. **Audit this the way Plan 3a's Task 6 should have been audited**: grep every `LOCAL_PLAYER_ID` and every `localPlayer(` in `src/components/cityArena/`, and justify or fix each one. That is exactly the class of bug that survived Plan 3a.

- [ ] **Step 5: Run the full suite, then commit**

```bash
git commit -m "feat(arena): add the lobby, connection banner and networked loop"
```

---

### Task 10: The bot acceptance test

This is the plan's acceptance, replacing the descoped four-player session.

**Files:**

- Create: `src/lib/cityArena/net/botMatch.test.ts`
- Create: `src/lib/cityArena/net/testBots.ts` — the headless bot client, reusable and not test-only-shaped.

**Interfaces:**

- Produces: `createBotClient(options: { transport; code; script: (tick: number) => WorldInput }): BotClient`.

- [ ] **Step 1: Write the acceptance test**

```ts
it("converges three bots on the host's world over 600 ticks", () => {
  const hub = createMemoryHub();
  const match = startBotMatch(hub, { bots: 3, seed: 7 });
  const violations: string[] = [];
  for (let tick = 1; tick <= 600; tick += 1) {
    match.advance(STEP_MS);
    hub.flush();
    violations.push(...checkInvariants(match.hostState()));
  }
  expect(violations).toEqual([]);
  for (const bot of match.bots) {
    expect(bot.view().tick).toBe(match.hostState().tick);
    expect(playersOf(bot.view())).toHaveLength(4);
    expect(
      distanceBetweenViews(bot.view(), match.hostState(), bot.playerId),
    ).toBeLessThan(0.5);
  }
});
```

- [ ] **Step 2: Write `testBots.ts` and make it pass**

- [ ] **Step 3: Add the packet-loss run**

Same match with `createMemoryHub({ dropRate: 0.1, random: createRng(3) })`. Assert the host still reaches tick 600 and every bot ends within the snap distance of the host — dropped inputs cost responsiveness, never consistency.

- [ ] **Step 4: Add the migration run**

Reuse Task 7's scenario at match scale: kill the host at tick 300 and assert the match still reaches 600 with every surviving bot converged.

- [ ] **Step 5: Full verification and the PR**

```bash
npm run lint && npx tsc --noEmit && npx vitest run && npm run build
git push -u origin feat/city-arena-plan3b
gh pr create --base image --title "feat(arena): play one match across several devices"
```

The body states the acceptance results, and states plainly that the Ably path has been exercised only against the owner's preview key (or not at all, if the checkpoint in Task 3 is still open), while everything else is proven on `memoryTransport`.

- [ ] **Step 6: Follow `loop-on-ci`** until every check is green and every bot thread is resolved. Given Plan 3a's experience, treat a rate-limited CodeRabbit as **no review at all** and re-trigger it rather than merging on a green board.

---

## Self-review

**Spec coverage.** §6.1 transport → Task 1. §6.2 Ably wiring and token → Tasks 3 and 4. §6.3 channels and payloads → Tasks 1 and 2. §6.4 budget → Task 2's size assertion holds the snapshot inside it. §6.5 prediction and interpolation → Task 6. §6.6 election and migration → Task 7, exercised at match scale in Task 10. §6.7 rooms → Task 8. §16 Dutch copy → Task 9. Not covered here, by design: §9.1's `ArenaMatch` persistence and the leaderboard, which is its own plan; the TV/split-screen mode of §10, which is slice 2.

**Placeholders.** Tasks 1, 2, 5, 6, 7 and 10 carry their test code. Tasks 3, 4, 8 and 9 describe the cases and the shape rather than the full listing, because they follow an existing repo pattern that the executor should copy from the named file rather than from this document — each names that file.

**Type consistency.** `RealtimeTransport`, `PresenceData`, `PresenceMember`, `PresenceEvent` and `ConnectionState` are defined in Task 1 and used unchanged through Tasks 4, 7, 8 and 9. `encodeInput`/`decodeInput`/`encodeSnapshot`/`decodeSnapshot` are defined in Task 2 and used in Tasks 5 and 6. `electHost` is defined in Task 7 and used in Task 9.

**The risk this plan carries.** The host loop, the client loop and election are each testable in isolation, but their interaction is where netcode actually breaks. Task 10 is deliberately the largest test in the plan for that reason — and it is the acceptance, not an extra.
