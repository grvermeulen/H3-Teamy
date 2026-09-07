# Multi-player Simulation Implementation Plan (Plan 3a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the arena simulation from one player to N players, so the netcode in Plan 3b can run it as a host loop without touching gameplay rules.

**Architecture:** `ArenaState.player` becomes `players: ArenaPlayerState[]` and `stepArena` takes one `WorldInput` per player id instead of one for the world. The four helpers in `sim/players.ts` — written in Plan 4 as "the Plan 3 widening seam" — are the only place that knows how players are stored, so nine sim modules that already consume them (`cops`, `hits`, `peds`, `pickups`, `police`, `populate`, `traffic`, `wanted`, `zoneRule`) need no shape change, only a check that they handle more than one. Everything stays pure and deterministic: same inputs, same seed, same state.

**Tech Stack:** TypeScript 6.0.3 (pinned), Vitest 4, no new dependencies. No network code in this plan — Plan 3b adds the transport.

**Spec:** `docs/superpowers/specs/2026-09-03-city-arena-design.md` — §4 world model, §5 gameplay rules, §6 netcode (the consumer of this work), §12 testing.

## Global Constraints

- All user-facing strings in **Dutch (NL)**. This plan adds none; do not introduce any.
- Every exported function, type and component carries JSDoc (`.coderabbit.yaml` enforces ≥80% docstring coverage).
- No `any`, no unsafe casts. `catch (error: unknown)`. Explicit return types on exported functions.
- Functions stay under **50 lines**; files stay under **400 lines** (spec §13). `sim/arena.ts` is already 780 lines — Task 2 splits it rather than growing it.
- Every `catch` in production code calls `Sentry.captureException(error, { tags: { area: "arena", kind } })` or re-throws. The simulation itself must not throw in the normal path.
- The simulation is **pure and deterministic**: no `Date.now()`, no `Math.random()` — randomness arrives as the injected `random: () => number`.
- Tests are co-located (`foo.test.ts` next to `foo.ts`). Every `describe` using mocks gets `beforeEach(() => { vi.clearAllMocks(); })`.
- Conventional Commits, subject ≤72 chars, imperative mood.
- Verification loop before every push: `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

## Acceptance (replaces the descoped 4-player session)

The owner descoped spec §14's "one real 4-player session (two phones, two laptops)" on 2026-09-07. This plan's acceptance is therefore machine-checkable and stands on its own:

1. Every existing arena test passes unchanged in behaviour — one player still plays exactly as before.
2. A new deterministic **two-player** test drives 600 ticks of scripted input for two players and asserts the invariant checker (`sim/invariants.ts`) reports no violations.
3. `npm run build` green, and the game is still playable on one device (the owner's device check remains the merge gate for anything visible).

---

## File Structure

**Modified:**

- `src/lib/cityArena/sim/types.ts` — `ArenaState.players`, `ArenaPlayerState.held`, `ArenaInputs`.
- `src/lib/cityArena/sim/players.ts` — the seam: widened to the array, plus `addPlayer` / `removePlayer` / `nearestPlayerTo`.
- `src/lib/cityArena/sim/arena.ts` — `createArenaState`, `stepArena`, `occupiedVehicle`, `exitPosition`, `teleportArenaPlayer` fan out over players.
- `src/lib/cityArena/sim/freeRoam.ts`, `populate.ts`, `invariants.ts` — direct `state.player` reads.
- `src/lib/cityArena/render/renderScene.ts`, `render/radar.ts` — draw every player, highlight the local one.
- `src/components/cityArena/arenaRuntime.ts`, `arenaHud.ts`, `useArenaGame.ts` — read "my player" by id.

**Created:**

- `src/lib/cityArena/sim/playerStep.ts` — the per-player stages lifted out of `arena.ts` (weapon switch, enter/exit, fire, respawn, eject-if-dead), so `arena.ts` drops back under 400 lines.
- `src/lib/cityArena/sim/playerStep.test.ts`
- `src/lib/cityArena/sim/multiplayer.test.ts` — the two-player determinism and invariant test.

**Unchanged (they already go through the seam):** `cops.ts`, `hits.ts`, `peds.ts`, `pickups.ts`, `police.ts`, `traffic.ts`, `wanted.ts`, `zoneRule.ts` — Task 6 verifies each handles N players and adds tests, but their shape does not change.

---

### Task 1: Per-player button edges

`ArenaState.held` is one set of edge-triggered buttons for the whole world. With two players, one player's held Enter would swallow the other's press. Move it onto the player before anything else changes shape, so this task is provable on the current single-player state.

**Files:**

- Modify: `src/lib/cityArena/sim/types.ts` (`ArenaPlayerState`, `ArenaState`)
- Modify: `src/lib/cityArena/sim/arena.ts` (`createArenaPlayer`, `createArenaState`, `detectEdges`, `stepArena`)
- Test: `src/lib/cityArena/sim/arena.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `ArenaPlayerState.held: HeldButtons`; `detectEdges(player: ArenaPlayerState, input: WorldInput): { enterPressed: boolean; weaponPressed: boolean; held: HeldButtons }`. `ArenaState.held` is gone.

- [ ] **Step 1: Write the failing test**

In `src/lib/cityArena/sim/arena.test.ts`, inside the existing top-level `describe`:

```ts
it("keeps one player's held Enter from swallowing another's press", () => {
  const state = createArenaState(setup, seededRandom(1));
  const holding: WorldInput = { ...NEUTRAL_INPUT, enter: true };
  const first = stepArena(state, holding, DT, world, seededRandom(2));
  expect(first.players[0].held.enter).toBe(true);
  expect(first.players[0].held.weaponNext).toBe(false);
});
```

`NEUTRAL_INPUT`, `setup`, `world`, `DT` and `seededRandom` already exist in this file — reuse them, do not redefine.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/cityArena/sim/arena.test.ts -t "swallowing"`
Expected: FAIL — `players` is undefined (the array arrives in Task 2; for this task assert on `first.player.held` instead and change the assertion to `players[0]` in Task 2's step 1).

- [ ] **Step 3: Move the field onto the player**

In `types.ts`, add to `ArenaPlayerState`:

```ts
/** Edge-triggered buttons this player held last tick, so a hold is not a fresh press. */
held: HeldButtons;
```

and delete `held: HeldButtons;` from `ArenaState`.

- [ ] **Step 4: Seed it and read it per player**

In `arena.ts`, `createArenaPlayer` returns `held: { enter: false, weaponNext: false }` in its object literal; delete `held:` from the `base` literal in `createArenaState`; change `detectEdges` to take the player:

```ts
/** Rising edges of the edge-triggered buttons plus the held state to remember. */
function detectEdges(
  player: ArenaPlayerState,
  input: WorldInput,
): { enterPressed: boolean; weaponPressed: boolean; held: HeldButtons } {
  return {
    enterPressed: input.enter && !player.held.enter,
    weaponPressed: input.weaponNext && !player.held.weaponNext,
    held: { enter: input.enter, weaponNext: input.weaponNext },
  };
}
```

In `stepArena`, replace `const edges = detectEdges(state.held, input);` with `const edges = detectEdges(state.player, input);` and write the result onto the player instead of the state: the line `let next: ArenaState = { ...state, tick, held: edges.held, events: [] };` becomes

```ts
let next: ArenaState = {
  ...state,
  tick,
  player: { ...state.player, held: edges.held },
  events: [],
};
```

- [ ] **Step 5: Fix every other reader**

Run `grep -rn "\.held" src --include="*.ts" --include="*.tsx"` and update each hit. Expect hits in `arena.test.ts` fixtures and any state factory in `src/lib/cityArena/test/`.

- [ ] **Step 6: Verify**

Run: `npx vitest run src/lib/cityArena && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cityArena
git commit -m "refactor(arena): move button edges onto the player"
```

---

### Task 2: The players array

**Files:**

- Modify: `src/lib/cityArena/sim/types.ts` (`ArenaState`)
- Modify: `src/lib/cityArena/sim/players.ts` (all four helpers)
- Modify: `src/lib/cityArena/sim/arena.ts` (32 `state.player` reads)
- Test: `src/lib/cityArena/sim/players.test.ts`

**Interfaces:**

- Consumes: Task 1's `ArenaPlayerState.held`.
- Produces:
  - `ArenaState.players: ArenaPlayerState[]` (join order; `players[0]` is the only player in single-player play). `ArenaState.player` no longer exists.
  - `playersOf(state: ArenaState): ArenaPlayerState[]`
  - `playerById(state: ArenaState, id: number): ArenaPlayerState | null`
  - `replacePlayer(state: ArenaState, player: ArenaPlayerState): ArenaState`
  - `driverPlayer(state: ArenaState, vehicleId: number): ArenaPlayerState | null`
  - `localPlayer(state: ArenaState): ArenaPlayerState` — `players[0]`, throws when empty; the single-player convenience the runtime uses until Plan 3b passes a real id.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/cityArena/sim/players.test.ts`:

```ts
it("finds, replaces and lists more than one player", () => {
  const first = createArenaPlayer([0, 0], 0);
  const second = { ...createArenaPlayer([10, 0], 0), id: first.id + 1 };
  const state = { ...baseState, players: [first, second] };
  expect(playersOf(state)).toHaveLength(2);
  expect(playerById(state, second.id)).toBe(second);
  const hurt = { ...second, health: 10 };
  expect(playersOf(replacePlayer(state, hurt))[1].health).toBe(10);
  expect(playerById(state, 999)).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/cityArena/sim/players.test.ts`
Expected: FAIL — `players` is not a property of `ArenaState`.

- [ ] **Step 3: Widen the state and the seam**

`types.ts`: replace `player: ArenaPlayerState;` with

```ts
  /** Every player the host simulates, in join order; `players[0]` is the only one offline. */
  players: ArenaPlayerState[];
```

`players.ts`:

```ts
/** Returns the players in the state, in join order. */
export function playersOf(state: ArenaState): ArenaPlayerState[] {
  return state.players;
}

/** Returns the player with `id`, or `null` when it is not present. */
export function playerById(
  state: ArenaState,
  id: number,
): ArenaPlayerState | null {
  return state.players.find((player) => player.id === id) ?? null;
}

/** Replaces the matching player, or returns the same state for an unknown id. */
export function replacePlayer(
  state: ArenaState,
  player: ArenaPlayerState,
): ArenaState {
  const index = state.players.findIndex((other) => other.id === player.id);
  if (index === -1) return state;
  const players = [...state.players];
  players[index] = player;
  return { ...state, players };
}

/** Returns the player sitting in `vehicleId`, or `null`. */
export function driverPlayer(
  state: ArenaState,
  vehicleId: number,
): ArenaPlayerState | null {
  return state.players.find((player) => player.vehicleId === vehicleId) ?? null;
}

/**
 * The player this client drives while the game is single-player. Plan 3b replaces the callers
 * with an explicit id; until then `players[0]` is that player.
 */
export function localPlayer(state: ArenaState): ArenaPlayerState {
  const player = state.players[0];
  if (!player) throw new Error("Arena state has no players");
  return player;
}
```

- [ ] **Step 4: Fix `arena.ts`**

`createArenaState`: `player: createArenaPlayer(spawn, 0),` becomes `players: [createArenaPlayer(spawn, 0)],`.

Then replace each remaining `state.player` / `next.player`. Two patterns cover all 32:

- reading "the player" for a whole-world decision (zone lookup, camera anchor) → `localPlayer(state)`;
- reading or writing one player inside a stage → the stage takes a `player` parameter and returns the updated one, and the caller uses `replacePlayer`.

Run `grep -n "state\.player\|next\.player" src/lib/cityArena/sim/arena.ts` and work top to bottom until it prints nothing.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/lib/cityArena/sim/players.test.ts && npx tsc --noEmit`
Expected: PASS for the new test; `tsc` now lists every other file that reads `.player` — those are Tasks 3, 5 and 7. Fix only `sim/` here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cityArena/sim
git commit -m "refactor(arena): hold players in an array"
```

---

### Task 3: One input per player

**Files:**

- Modify: `src/lib/cityArena/sim/types.ts` (`ArenaInputs`)
- Modify: `src/lib/cityArena/sim/arena.ts` (`stepArena`)
- Create: `src/lib/cityArena/sim/playerStep.ts`
- Test: `src/lib/cityArena/sim/playerStep.test.ts`

**Interfaces:**

- Consumes: Task 2's `players` array and seam.
- Produces:
  - `type ArenaInputs = ReadonlyMap<number, WorldInput>`
  - `NEUTRAL_INPUT: WorldInput` exported from `sim/playerStep.ts`
  - `stepArena(state: ArenaState, inputs: ArenaInputs, dt: number, world: ArenaWorld, random: () => number): ArenaState`
  - `stepPlayers(state, inputs, dt, world, tick, random): ArenaState` in `playerStep.ts` — runs weapon switch, enter/exit, movement and fire for every player, in ascending id order so the result does not depend on join order.

- [ ] **Step 1: Write the failing test**

`src/lib/cityArena/sim/playerStep.test.ts`:

```ts
it("moves each player by their own input and nobody else's", () => {
  const state = twoPlayerState();
  const inputs: ArenaInputs = new Map([
    [0, { ...NEUTRAL_INPUT, move: [100, 0], moveIsAnalog: false }],
    [1, NEUTRAL_INPUT],
  ]);
  const next = stepArena(state, inputs, DT, world, seededRandom(1));
  expect(next.players[0].x).toBeGreaterThan(state.players[0].x);
  expect(next.players[1].x).toBe(state.players[1].x);
});

it("leaves a player without an input standing still", () => {
  const state = twoPlayerState();
  const next = stepArena(state, new Map(), DT, world, seededRandom(1));
  expect(next.players[0].speed).toBe(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/cityArena/sim/playerStep.test.ts`
Expected: FAIL — `stepArena` still takes a single `WorldInput`.

- [ ] **Step 3: Lift the per-player stages into `playerStep.ts`**

Move `applyWeaponSwitch`, `applyEnterExit`, `applyFire`, `applyRespawn` and `ejectIfDead` out of `arena.ts` into `playerStep.ts` unchanged except that each takes the player it acts on and returns the new player (or the new state where it touches vehicles and bullets too). Export:

```ts
/** A player with no buttons and no movement; the input a silent client is stepped with. */
export const NEUTRAL_INPUT: WorldInput = {
  move: [0, 0],
  moveIsAnalog: false,
  aim: null,
  fire: false,
  enter: false,
  weaponNext: false,
};

/** Runs every per-player stage for each player, in ascending id order. */
export function stepPlayers(
  state: ArenaState,
  inputs: ArenaInputs,
  dt: number,
  world: ArenaWorld,
  tick: number,
  random: () => number,
): ArenaState {
  let next = state;
  const ids = playersOf(state)
    .map((player) => player.id)
    .sort((a, b) => a - b);
  for (const id of ids) {
    const input = inputs.get(id) ?? NEUTRAL_INPUT;
    next = stepOnePlayer(next, id, input, dt, world, tick, random);
  }
  return next;
}
```

`stepOnePlayer` is the body of the old per-player half of `stepArena`, reading its player with `playerById(next, id)` and skipping the tick when that returns `null` (a player who left mid-tick).

- [ ] **Step 4: Rewrite `stepArena` around it**

```ts
/** One fixed step of the arena: the single simulation entry point. */
export function stepArena(
  state: ArenaState,
  inputs: ArenaInputs,
  dt: number,
  world: ArenaWorld,
  random: () => number,
): ArenaState {
  const tick = state.tick + 1;
  let next: ArenaState = { ...state, tick, events: [] };
  next = applyPopulation(next, world, tick, random);
  next = stepPickups(next, tick);
  next = stepPlayers(next, inputs, dt, world, tick, random);
  next = stepCops(next, world, dt, tick, random);
  next = stepPeds(next, world, dt, tick, random);
  next = advanceBullets(next, dt, world, tick);
  next = applyExplosions(next, world, tick);
  next = applyZoneRule(next, world.index, tick);
  next = applyWanted(next, tick);
  next = manageCops(next, world, tick, random);
  next = managePoliceCars(next, world, tick, random);
  return {
    ...next,
    effects: pruneEffects(next.effects, tick),
    zoneKey: populationAnchorZone(next, world.index)?.key ?? null,
  };
}
```

`populationAnchorZone` arrives in Task 4. Until then keep the old `findZone(world.index, [localPlayer(next).x, localPlayer(next).y])` line so the task stays green on its own.

- [ ] **Step 5: Verify**

Run: `npx vitest run src/lib/cityArena && npx tsc --noEmit`
Expected: PASS. Callers outside `sim/` (`arenaRuntime.ts`, `useArenaGame.ts`) now fail to typecheck — pass `new Map([[LOCAL_PLAYER_ID, input]])` at those two call sites to keep the app compiling; Task 7 tidies them properly.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cityArena src/components/cityArena
git commit -m "feat(arena): step every player from their own input"
```

---

### Task 4: Population follows the zone, not the player

With one player, `zoneKey` was "where the player is" and NPCs spawned around them. With N players spread over the map that rule spawns crowds around whoever happens to be `players[0]`. Spec §6.4: the host simulates NPCs inside the zone disc + 100 m.

**Files:**

- Modify: `src/lib/cityArena/sim/populate.ts`
- Modify: `src/lib/cityArena/sim/arena.ts` (`stepArena`'s trailing `zoneKey`)
- Test: `src/lib/cityArena/sim/populate.test.ts`

**Interfaces:**

- Produces: `populationAnchorZone(state: ArenaState, index: MapIndex): MapZone | null` — `activeZoneKey`'s zone when a match is running, else the zone containing the lowest-id living player, else `null`.

- [ ] **Step 1: Write the failing test**

```ts
it("anchors population on the match zone, not on a player who wandered off", () => {
  const state = {
    ...twoPlayerState(),
    activeZoneKey: "campus" as ZoneKey,
    players: [farAwayPlayer(0), farAwayPlayer(1)],
  };
  expect(populationAnchorZone(state, index)?.key).toBe("campus");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/cityArena/sim/populate.test.ts -t "anchors population"`
Expected: FAIL — `populationAnchorZone` is not exported.

- [ ] **Step 3: Implement**

```ts
/** The zone NPC population is kept around: the match zone, else the first living player's. */
export function populationAnchorZone(
  state: ArenaState,
  index: MapIndex,
): MapZone | null {
  if (state.activeZoneKey) return findZoneByKey(index, state.activeZoneKey);
  const alive = playersOf(state)
    .filter((player) => player.diedAtTick === null)
    .sort((a, b) => a.id - b.id);
  const anchor = alive[0] ?? playersOf(state)[0];
  return anchor ? findZone(index, [anchor.x, anchor.y]) : null;
}
```

- [ ] **Step 4: Use it**

Replace the trailing `zoneKey:` expression in `stepArena` with `populationAnchorZone(next, world.index)?.key ?? null`, and use the same helper wherever `applyPopulation` currently derives its zone.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/lib/cityArena && npx tsc --noEmit`

```bash
git add src/lib/cityArena/sim
git commit -m "feat(arena): anchor population on the match zone"
```

---

### Task 5: Join and leave

Spec §6.7: late joiners send `control:join`, the host spawns them; members who leave are removed on presence `leave`; capacity is 8.

**Files:**

- Modify: `src/lib/cityArena/sim/players.ts`
- Modify: `src/lib/cityArena/sim/limits.ts` (capacity constant)
- Test: `src/lib/cityArena/sim/players.test.ts`

**Interfaces:**

- Produces:
  - `MAX_ARENA_PLAYERS = 8` in `limits.ts`
  - `addArenaPlayer(state, world, tick, random): { state: ArenaState; player: ArenaPlayerState | null }` — `null` when full; spawns on a zone spawn node away from parked cars and pickups, exactly as respawn does.
  - `removeArenaPlayer(state: ArenaState, id: number): ArenaState` — drops the player and frees any car they were driving.

- [ ] **Step 1: Write the failing tests**

```ts
it("spawns a joiner inside the active zone and refuses the ninth", () => {
  let state = twoPlayerState();
  for (let index = 2; index < MAX_ARENA_PLAYERS; index += 1) {
    const result = addArenaPlayer(state, world, 0, seededRandom(index));
    expect(result.player).not.toBeNull();
    state = result.state;
  }
  expect(playersOf(state)).toHaveLength(MAX_ARENA_PLAYERS);
  expect(addArenaPlayer(state, world, 0, seededRandom(99)).player).toBeNull();
});

it("frees the car of a player who leaves", () => {
  const driving = { ...createArenaPlayer([0, 0], 0), id: 1, vehicleId: 42 };
  const state = { ...twoPlayerState(), players: [localOf(), driving] };
  const next = removeArenaPlayer(state, 1);
  expect(playerById(next, 1)).toBeNull();
  expect(driverPlayer(next, 42)).toBeNull();
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/cityArena/sim/players.test.ts`
Expected: FAIL — `addArenaPlayer` is not exported.

- [ ] **Step 3: Implement both, and give each new player the next free id**

Ids come from `state.nextId` (the same counter vehicles and bullets use), so a rejoining client never collides with a live entity. `addArenaPlayer` returns `{ state, player: null }` unchanged when `playersOf(state).length >= MAX_ARENA_PLAYERS`.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/lib/cityArena/sim/players.test.ts && npx tsc --noEmit`

```bash
git add src/lib/cityArena/sim
git commit -m "feat(arena): add and remove players at runtime"
```

---

### Task 6: NPCs cope with more than one player

The nine modules that already import the seam were written against a one-element array. Each needs checking for "assumes exactly one" — the common bug is `playersOf(state)[0]` where the rule is "the nearest player".

**Files:**

- Modify: whichever of `cops.ts`, `hits.ts`, `peds.ts`, `pickups.ts`, `police.ts`, `traffic.ts`, `wanted.ts`, `zoneRule.ts` the audit finds
- Modify: `src/lib/cityArena/sim/players.ts` (`nearestPlayerTo`)
- Test: the co-located test of every module changed

**Interfaces:**

- Produces: `nearestPlayerTo(state: ArenaState, point: Point, filter?: (player: ArenaPlayerState) => boolean): ArenaPlayerState | null` — ties broken by lowest id so the result is deterministic.

- [ ] **Step 1: Audit**

Run: `grep -rn "playersOf(" src/lib/cityArena --include="*.ts" | grep -v "\.test\."`
For each hit, write down the rule it should follow: _nearest_ (cops chasing, peds fleeing, police cars), _all_ (zone rule, wanted decay, hit detection), or _the owner_ (pickups).

- [ ] **Step 2: Write the failing tests, one per module you are changing**

For cops, in `cops.test.ts`:

```ts
it("chases the nearest player, not the first one", () => {
  const state = {
    ...twoPlayerState(),
    players: [playerAt(0, [500, 0]), playerAt(1, [10, 0])],
    cops: [copAt([0, 0])],
  };
  const next = stepCops(state, world, DT, 1, seededRandom(1));
  expect(next.cops[0].targetPlayerId).toBe(1);
});
```

If a module has no `targetPlayerId` on its state, assert on the observable instead — the cop's `x` moving toward the near player.

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run src/lib/cityArena/sim`
Expected: each new test FAILs against the `[0]` behaviour.

- [ ] **Step 4: Implement `nearestPlayerTo` and use it**

```ts
/** The living player closest to `point`, ties broken by lowest id; `null` when none match. */
export function nearestPlayerTo(
  state: ArenaState,
  point: Point,
  filter: (player: ArenaPlayerState) => boolean = () => true,
): ArenaPlayerState | null {
  let best: ArenaPlayerState | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (const player of playersOf(state)) {
    if (!filter(player)) continue;
    const distanceSq = (player.x - point[0]) ** 2 + (player.y - point[1]) ** 2;
    if (
      distanceSq < bestDistanceSq ||
      (distanceSq === bestDistanceSq && best && player.id < best.id)
    ) {
      best = player;
      bestDistanceSq = distanceSq;
    }
  }
  return best;
}
```

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/lib/cityArena && npx tsc --noEmit`

```bash
git add src/lib/cityArena/sim
git commit -m "feat(arena): point NPCs at the nearest player"
```

---

### Task 7: The client reads its own player by id

**Files:**

- Modify: `src/components/cityArena/arenaRuntime.ts`, `arenaHud.ts`, `useArenaGame.ts`
- Modify: `src/lib/cityArena/render/renderScene.ts`, `src/lib/cityArena/render/radar.ts`
- Test: the co-located tests of each

**Interfaces:**

- Consumes: `playerById`, `localPlayer`.
- Produces: `Scene.players: ArenaPlayerState[]` and `Scene.localPlayerId: number` replace `Scene.player`; `renderScene` draws every player, the local one with `DEFAULT_PLAYER_STYLE` and the others with a new `OTHER_PLAYER_STYLE` (fill `PLAYER_OTHER_FILL`, ring `PLAYER_OTHER_RING`, both added to `render/palette.ts`).

- [ ] **Step 1: Write the failing test**

In `renderScene.test.ts`:

```ts
it("draws every player and rings the local one differently", () => {
  const context = createFakeContext();
  renderScene(context, viewport, {
    ...scene,
    players: [playerAt(0, [0, 0]), playerAt(1, [8, 0])],
    localPlayerId: 0,
  });
  expect(context.calls.filter((call) => call.startsWith("arc("))).toHaveLength(
    2,
  );
  expect(context.calls).toContain(`fill(${PLAYER_FILL})`);
  expect(context.calls).toContain(`fill(${PLAYER_OTHER_FILL})`);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/cityArena/render/renderScene.test.ts -t "every player"`
Expected: FAIL — `Scene` has no `players`.

- [ ] **Step 3: Implement**

`drawPlayerLook` loops over `scene.players`, picking the style by `player.id === scene.localPlayerId` and passing the character sprite only for the local player (the remote ones read as coloured circles until Plan 3b gives them their own art). The radar plots every player, the local one last so it draws on top. `arenaHud` and `useArenaGame` read `playerById(state, localPlayerId) ?? localPlayer(state)`.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src && npx tsc --noEmit`

```bash
git add src
git commit -m "feat(arena): render every player, highlight your own"
```

---

### Task 8: The two-player acceptance test

**Files:**

- Create: `src/lib/cityArena/sim/multiplayer.test.ts`

- [ ] **Step 1: Write the test**

```ts
describe("two-player simulation", () => {
  it("runs 600 ticks of two scripted players without an invariant violation", () => {
    const random = seededRandom(7);
    let state = addArenaPlayer(
      createArenaState(setup, random),
      world,
      0,
      random,
    ).state;
    for (let tick = 1; tick <= 600; tick += 1) {
      const inputs: ArenaInputs = new Map([
        [state.players[0].id, scriptedInput(tick)],
        [state.players[1].id, scriptedInput(tick + 137)],
      ]);
      state = stepArena(state, inputs, DT, world, random);
      expect(checkInvariants(state, world)).toEqual([]);
    }
    expect(playersOf(state)).toHaveLength(2);
  });

  it("is deterministic: the same seed and inputs give the same state", () => {
    expect(runScripted(seededRandom(7))).toEqual(runScripted(seededRandom(7)));
  });
});
```

`scriptedInput(tick)` is a small local helper that walks, turns, fires every 30 ticks and presses Enter every 90 — it must not use `Math.random()`.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/lib/cityArena/sim/multiplayer.test.ts`
Expected: PASS. A failure here is a real bug from Tasks 2–6, not a test to relax.

- [ ] **Step 3: Commit**

```bash
git add src/lib/cityArena/sim/multiplayer.test.ts
git commit -m "test(arena): two-player determinism and invariants"
```

---

### Task 9: Documentation, verification loop and the PR

- [ ] **Step 1: Update `docs/tech/arena/README.md`**

Add a `## Runtime (PR 7 — multi-player simulation)` section: the state now holds `players[]`, `stepArena` takes `ArenaInputs` keyed by player id, per-player button edges, `populationAnchorZone`, join/leave with `MAX_ARENA_PLAYERS`, nearest-player NPC targeting, and the note that no network code exists yet.

- [ ] **Step 2: Run the full verification loop**

```bash
npm run lint
npx tsc --noEmit
npx vitest run
npm run build
```

All four must pass. The two pre-existing lint warnings in `EventList.tsx` and `src/types/ical.d.ts` are unrelated and expected.

- [ ] **Step 3: Device check**

Start the dev server for this worktree and play one round on a phone: walking, driving, shooting, dying and respawning must feel exactly as before. This is the merge gate.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/city-arena-plan3
gh pr create --base image --title "feat(arena): simulate more than one player"
```

Body: what changed, why (Plan 3b needs it), the acceptance criteria above and their results, and the note that the 4-player session was descoped by the owner on 2026-09-07.

- [ ] **Step 5: Follow `loop-on-ci`** until every check is green and every bot thread is resolved.

---

## Status

All nine tasks are complete on `feat/city-arena-plan3` (PR #658). What each task actually
produced, and where it differed from the text below, is in the deviations section.

## Deviations recorded while executing

- **`EMPTY_INPUT`, not `NEUTRAL_INPUT`.** `sim/types.ts` already exported exactly this constant; the plan invented a second name for it. Tasks 3 and 8 use the existing one.
- **Tasks 2 and 7's mechanical half landed together.** The state shape and every reader have to move in one commit: the pre-commit hook runs lint, `tsc` and the full suite, so a red tree cannot be committed in between. Task 7 keeps its semantic work — drawing every player, and a style for remote ones.
- **`playerStep.ts` is deferred to its own task (3b).** Task 3 fanned the stages out inside `arena.ts` instead. The file is 889 lines against the spec's 400-line target, but it was already 780 before this plan, and lifting the per-player half out means moving the shared helpers (`occupiedVehicle`, `exitPosition`, the boarding constants) too or accepting a cycle between the two modules. That is a self-contained move worth its own review, not a rider on a behaviour change.
- **`stepArena` runs the per-player stages in three passes**, not one: buttons/respawn/weapon/boarding for every player, then one vehicle step for the world, then firing. Movement has to sit between them because cars step once for everyone.
- **Task 4 anchors on the enforced match zone, not on `activeZoneKey`.** The plan's rule would have frozen free-roam repopulation: `activeZoneKey` is set the moment a zone is populated, so anchoring on it means the population never follows a player into a new zone again. Two neighbouring single-player assumptions came out with it — clearing a zone deleted any car it did not recognise as the local player's, and respawn read the state's one `zoneKey` rather than the zone the dying player was in.
- **Join and leave live in `arena.ts`, not `players.ts`.** They need the spawn helpers and `ArenaWorld`; putting them in the seam would have pulled world dependencies into a module that is deliberately nothing but state access.
- **Task 6 found the NPC rules already fit for several players — and stopped one step too soon.** The audit turned up no NPC rule that assumed one: they work off events and the most-wanted player rather than off "the" player, so pedestrians already flee the nearest gunfire and cops already chase whoever has the most heat. The only gap it found was `wantedTarget` resolving equal heat by array order, which is join order. `nearestPlayerTo` — added speculatively in Task 2 for targeting that turned out not to need it — was removed rather than left as an exported helper with no caller.

  **What that audit missed**, and CodeRabbit caught on the PR (49dc67b): it reasoned about the NPC rules instead of enumerating the readers of the widened field, so four paths in `arena.ts` still collapsed `players` to one element. `bulletTargets` offered only the local player as a bullet target and `applyHit` damaged a player only when the id matched the local one, which made remote players unshootable — while `playerCandidates` one layer down already excluded the shooter by `ownerId` and was N-correct all along, simply starved by its caller. `explodeVehicle` and `teleportArenaPlayer` each rebuilt `players` as a one-element array, deleting every other player from the state outright. And `stepArena` derived `zoneKey` through `localPlayer`, which throws once the last player leaves. The 600-tick acceptance script passed throughout: it never blew up a car, never crossed the two players' fire and never teleports.

  The lesson for Plan 3b, where the same widening happens to the _client's_ view of state: audit a widening by grepping every reader of the old field — every `players: [` literal, every `localPlayer(` call, every `[0]` index — and justify or fix each hit, rather than reasoning about which rules "feel" player-agnostic. The sim layer is now clean by that test; every surviving `localPlayer` call sits in `src/components/cityArena/`, where the local player is the right answer.

- **The radar stays local-only.** It is centred on this client's player; plotting other players is a Plan 3b feature, when there are remote players to plot.

## Self-review

**Spec coverage.** §6.7 join/leave/capacity → Task 5. §6.4 host simulates NPCs around the zone → Task 4. §6.5's "own player simulated locally from local inputs with the same pure step functions" → Task 3 makes those functions per-player, which is exactly what prediction replays. §10.3's "input pipeline decoupled from rendering" → Task 7 splits "which player am I" from "what do I draw". Not covered here, by design: the transport, host election, snapshots, prediction, lobby and rooms API — all Plan 3b.

**Placeholders.** None: every step names its files, and every code step carries the code.

**Type consistency.** `ArenaInputs` is defined in Task 3 and used in Tasks 3 and 8. `playersOf`/`playerById`/`replacePlayer`/`driverPlayer`/`localPlayer`/`nearestPlayerTo`/`addArenaPlayer`/`removeArenaPlayer` all live in `sim/players.ts` and keep those names throughout. `populationAnchorZone` is defined in Task 4 and referenced by Task 3's step 4, which is why that step keeps the old expression until Task 4 lands.

---

## What Plan 3b will cover

Written after this plan lands, against the same spec §6:

| Area      | Deliverable                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------- |
| Transport | `RealtimeTransport` interface, `memoryTransport` (Vitest), `ablyTransport`                               |
| Auth      | `GET /api/arena/realtime-token`, `ABLY_API_KEY`, `scripts/check-preview-env.ts`                          |
| Loops     | `hostLoop` (30 Hz accumulator, 10 Hz snapshots), `clientLoop` (prediction, replay, 120 ms interpolation) |
| Election  | Priority sort, 3 s silence rule, `hostChanged`, seeding from the last snapshot                           |
| Rooms     | 6-char codes, lobby presence, `GET /api/arena/rooms`, capacity and "Potje is vol"                        |
| UI        | Lobby, `ConnectionBanner`, Dutch copy from spec §16                                                      |
