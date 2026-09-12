# GTA H3 Plan 4b — Pedestrians, Cops, Pickups, Zone, Radar and Sound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the single-player slice of GTA H3 that Plan 4a left playable: pedestrians on the pavements that flee gunfire and can be run over, a heat/wanted mechanic that sends cops on foot and police cars after the player, weapon and health pickups (so the spawn loadout drops to pistol + fist), ambient traffic and kerb-side parked cars, the 500 m zone rule with its countdown, a 90 px radar, and synthesised sound effects behind a "Geluid" setting — all inside the same pure, deterministic `stepArena` so Plan 3's host loop can run it unchanged.

**Architecture:** Every new system is a pure entity module under `src/lib/cityArena/sim/` (`pickups`, `peds`, `traffic` + `driver`, `wanted`, `cops`, `police`, `zoneRule`, `populate`, `hits`) that takes the immutable `ArenaState`, the injected world (collision grid, map index, **road graph**, optional camera rect) and the seeded `random`, and returns a new state; `stepArena` only composes them. The state gains an `events` list (cleared at the start of every tick) that the runtime forwards to the sound module and that Plan 3 will forward over the wire. World helpers grow a binary-heap A\* (`world/binaryHeap`), pavement rails offset from residential roads (`world/pavements`) and path following (`world/pathFollow`). Rendering adds painters for people, pickups and police cars plus a pure radar painter on a second small canvas; audio is a from-scratch Web Audio synth (`audio/sound`) with an injectable context factory and a fake context for tests. React stays thin: the hook forwards events to the sound, unlocks audio on the first interaction, persists "Geluid", and the HUD shows wanted stars, the zone countdown and the radar.

**Tech Stack:** Next.js 16 App Router (client components), React 19, TypeScript 6 strict, Tailwind v4 utilities, Canvas 2D, Web Audio API (oscillator/noise voices, no assets), Zod 4, Vitest + Testing Library, `@sentry/nextjs`.

**Spec:** `docs/superpowers/specs/2026-09-03-city-arena-design.md` §4 (road graph uses: traffic, cops, pavement paths), §5 (pedestrians, wanted level, pickups, zone, HUD radar + SFX, parked-car kerb placement and ambient traffic), §7 (settings "Geluid" only — haptics and feedback effects are Plan 6), §8 (frame order pickups → cars → peds/cops/players → bullets; radar as a second small canvas; HUD at 10 Hz; budgets), §12.A3–A4 (`window.__arena` extension, invariant caps), §13 (file layout: `sim/peds · cops · pickups`, `render/radar`), §16 (glossary: "Gezocht (sterren)", "Terug naar het strijdgebied!", "Geluid"). This is PR 4 of 8 in the owner's reordered roadmap; it consumes the merged Plan 4a runtime at `image` b4d0374 (`src/lib/cityArena/{world,sim,input,render}/**`, `src/components/cityArena/**`).

**Scope decisions for this plan (recorded so nobody re-litigates them):**

1. Single-player still; every new entity system (`peds`, `cops`, `pickups`, `zone`, `traffic`) is written per entity and reads `state.player` through one accessor so Plan 3 can lift it into `players`. Rounds, scoring, kill feed, timer and remote players stay Plan 3; haptics, feedback effects, twin-stick aim and settings UI beyond the "Geluid" toggle stay Plan 6; bots and the session log stay Plan 7.
2. Spawn loadout becomes pistol + fist only (`SPAWN_AMMO` → 0 Uzi, 0 shotgun); Uzi and Shotgun come from pickups (60 rounds / 8 shells per pickup, capped at the weapon's magazine maximum defined as named constants), health pickups give +50 up to 100. Pickups per zone: 6 weapon spots (up to 4 at landmarks — using the zone's landmark centres — the rest at seeded spawn nodes; alternating Uzi/Shotgun) and 4 health spots at seeded spawn nodes; a taken pickup respawns after 20 s (600 ticks).
3. Pedestrians: ≈ 25 per zone inside the zone disc + 100 m, walking on pavement polylines derived from the residential-class road polylines offset to the kerb (reusing the renderer's pavement offset constants), random turns at road ends; flee at 5.5 m/s away from gunfire/explosions within 25 m for 4 s; dead bodies persist 8 s; killing one adds heat and scores nothing. They are hit by bullets (circle radius 0.4) and run over by cars at > 5 m/s (damage = 5 × speed) using the existing collision/damage helpers.
4. Wanted level exactly per spec §5: heat pedestrian kill +30, cop kill +60, shooting within 15 m of a cop +10, ramming a police car +20; decays 5/s after 8 quiet seconds; level = min(3, ⌊heat / 40⌋); the player's death resets heat to 0. Level 1: two cops on foot spawn 60–120 m away out of view (outside the camera's visible rect) and A\* to the player, pistol at ≤ 20 m (1.5/s, 15° inaccuracy). Level 2: plus one police car that chases and rams. Level 3: four cops, two cars, shotguns. Cops are killable (health 100), drop nothing. `roadGraph`'s A\* gets a binary-heap open set in this plan (the Plan 2 review deferred it "until cops").
5. Ambient traffic per spec: 6–10 cars per zone following the road graph at 8–12 m/s, stopping for obstacles (cars, peds, the player) ahead within a named look-ahead; parked cars move from "8 per zone on spawn nodes" to "≈ 1 per 40 m along residential roads offset to the kerb" (with a per-zone cap as a named constant so the entity counts stay bounded). Police cars use the same AI driver with a chase target.
6. Zone rule: 500 m disc around the zone centre; leaving it shows the HUD countdown "Terug naar het strijdgebied! 5…" and then applies 10 damage/s until back. Because there is no lobby/match yet, the rule is gated by `state.zoneEnforced` (default `false` in free-roam so exploring stays pleasant; the debug seam can flip it; Plan 3 sets it during matches), and the countdown/damage logic is fully unit-tested through the sim.
7. Radar: a 90 px second canvas in the HUD (React component owning its own canvas, painted at 10 Hz from the same snapshot as the HUD): road lines, the player dot, pickups, cops/police cars as blue dots (small extension for the wanted mechanic), zone edge; north-up, centred on the player, fixed scale as a named constant.
8. SFX: synth-only Web Audio (no assets): shots per weapon, explosion, engine pitch by speed while driving, pickup, hit; audio context unlocked on the first pointer/key interaction; "Geluid" toggle persisted in the existing arena settings storage (default on) and shown in the overlay's HUD bar. Sound is driven from simulation events (an `events` list on the state, cleared at the start of each tick, so the runtime can play them — designed so Plan 3 can forward the same events).
9. Entity caps are named constants and checked by `checkInvariants` (peds ≤ 40, cops ≤ 8, traffic ≤ 12, pickups ≤ 10 per zone), so the 30 Hz step stays under budget on a phone; every new step function is pure and deterministic (seeded RNG only, no Date/DOM).
10. HUD additions in this plan: wanted stars ("Gezocht", 0–3 stars as accessible text), the zone countdown, the radar, the "Geluid" toggle. Kills/timer/kill feed wait for Plan 3.

Documented choices where the spec is silent (all named constants in the code): NPCs, pickups and traffic are populated for the **active zone** only (the zone nearest the player, `state.activeZoneKey`); when the player moves to another zone the old population is dropped and the new zone's is spawned, which is what keeps the caps of decision 9 per zone. Parked cars are placed in every zone at session start (they are static until driven and cost nothing while asleep). Pedestrian health 40 (two pistol rounds, one shotgun shell, run over at ≥ 8 m/s); pedestrians and cops on foot spawn ≥ 30 m from the player; cop run speed 4.5 m/s; cops re-path every 30 ticks and walk straight at the player within 25 m; cop bullets never hurt other cops or pedestrians (they are absorbed); cops' fire rate is the spec's 1.5/s for both weapons; at wanted level 0 cops stand down and vanish once out of view or > 80 m away, police cars lose their driver and stay parked; police cars chase at 18 m/s and ignore the player as an obstacle (that is the ram); ambient traffic keeps to through-roads (primary/secondary/tertiary/unclassified — every zone of the shipped map has ≥ 600 m of them, the campus 5 km) in a right-hand lane max(road width / 4, 1.7 m) from the centre line so two AI lanes clear the 1.6 m car-body circle, look-ahead 10 m × ±2.2 m; parked cars straddle the kerb (centre 0.3 m beyond the kerb line) of residential and service roads only, so police cars driving the centre line of a residential street pass them; the AI never routes over service or pedestrian roads; a pickup is only taken when it helps (health < 100, ammo below the cap) and an Uzi/Shotgun pickup arms that weapon when the player holds the fist or pistol; landmark pickups sit on the road node nearest the landmark centre (≤ 80 m) so they are never inside a building; explosions kill pedestrians/cops in the 3 m blast without heat attribution; the radar shows 150 m around the player at 0.3 px/m.

## Global Constraints

- Node.js 22, Next.js 16 App Router, React 19, TypeScript 6 `strict` (pinned 6.0.3); Tailwind v4; Vitest 4 (jsdom, `vitest.setup.ts` mocks `@sentry/nextjs`) with `@/` alias for `src/`.
- Dutch user-facing strings (spec §16 glossary; this plan adds "Gezocht", "Terug naar het strijdgebied!", "Geluid", "Radar", "voetgangers", "agenten", "verkeer"); identifiers English; the UI title is "GTA H3".
- No inline `style` props (Tailwind only; arbitrary values allowed, e.g. `h-[90px]`); the canvas elements set no styles beyond Tailwind classes.
- JSDoc on every export; explicit return types on exports; no `any`, no unsafe `as` casts, no non-null assertions; `const list: Foo[] = []` never `[] as Foo[]`.
- Every function under 50 lines (closures count); files under 800 lines (split by responsibility — new files in this plan stay under 400); named constants instead of magic numbers; full-word identifiers (single letters only in geometry maths).
- Every `catch (error: unknown)` → `Sentry.captureException(error, { tags: { area: "arena", kind } })`; storage failures never propagate.
- Tests co-located with `beforeEach(() => { vi.clearAllMocks(); })` where mocks are used and `afterEach(() => { cleanup(); })` in component suites; precise assertions (`toHaveBeenCalledTimes`, exact values); `vi.mocked(fn)`; `vi.stubEnv`/`vi.unstubAllEnvs` for env; never `fireEvent`/`userEvent` inside `waitFor`; no bare date-only strings.
- Conventional Commits with subjects ≤ 72 chars, imperative, ending with the trailer line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; run `npx prettier --write <files>` before committing; the pre-commit hook runs Prettier, ESLint, `tsc --noEmit` and the full Vitest suite; `npm run lint` currently reports exactly 2 accepted warnings (`src/components/EventList.tsx`, `src/types/ical.d.ts`).
- Asset facts (verbatim from PR 1): `roads.json = { nodes: number[] (flat units), edges: number[] (stride 6: a, b, classIndex, nameIndex (−1 unnamed), oneway, lengthUnits), classes: RoadClass[], names: string[] }` decoded by `decodeRoadGraph` into metres (13 756 nodes, 15 101 edges in the shipped build; shape points every ≥ 20 m are graph nodes, so every edge is a straight segment); `index.json` zones `{ key, name, center, radius: 2000 (units = 500 m), spawnNodes, landmarks }`, landmarks `{ key, name, style, center, tile }`; 4 units = 1 m; north = negative y.
- Renderer facts reused (verbatim from `render/palette.ts`): `ROAD_WIDTH_M` residential/unclassified 6, living_street 5, tertiary 7, secondary 8, primary 9; `PAVEMENT_WIDTH_M = 2`; `VEHICLE_WIDTH_M = 1.8`, `VEHICLE_LENGTH_M = 4.2`; `PLAYER_RADIUS_M = 0.4`; `SIM_STEP_S = 1/30`; `CAR_BODY_RADIUS_M = 1.6`; `RUN_OVER_MIN_SPEED_MPS = 5`, `RUN_OVER_DAMAGE_PER_MPS = 5`; `EXPLOSION_RADIUS_M = 3`, `EXPLOSION_DAMAGE = 80`; `MAX_BULLETS = 64`, `MAX_EFFECTS = 64`; `RESPAWN_DELAY_TICKS = 90`, `INVULNERABLE_TICKS = 60`.
- Gameplay values of this plan (verbatim from spec §5 / decisions above): pedestrians 25 per zone, walk 1.4 m/s, flee 5.5 m/s within 25 m for 120 ticks, body 240 ticks; heat +30/+60/+10/+20, quiet 240 ticks, decay 5/s, 40 heat per level, max 3; cops per level `[0, 2, 2, 4]`, police cars per level `[0, 0, 1, 2]`, shotguns from level 3, spawn 60–120 m out of view, pistol at ≤ 20 m at 1.5/s (20-tick cooldown) with ±15° inaccuracy, cop health 100; pickups 6 weapon (≤ 4 at landmarks) + 4 health per zone, respawn 600 ticks, +50 health, 60 rounds / 8 shells, caps Uzi 120 / shotgun 16; traffic 6–10 per zone at 8–12 m/s (police cars chase at 18 m/s, ram within 25 m); parked cars every 40 m along residential and service roads, cap 30 per zone, ≥ 12 m apart, ≥ 8 m from the player; zone 500 m disc, 150-tick (5 s) countdown then 10 damage/s; radar 90 px, 150 m range; caps peds 40, cops 8, traffic 12, pickups 10, events 128 per tick, vehicles 140.
- Work happens in the worktree `.claude/worktrees/city-arena-plan4b` on branch `feat/city-arena-plan4b` (based on `image` at b4d0374, the merged PR 3). Nothing here touches netcode, persistence or the map asset.

---

## File structure

| Path                                                      | Responsibility                                                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/cityArena/sim/types.ts` (modify)                 | `ArenaPlayerState` heat/zone fields, `PickupState`, `RailPosition`, `PedState`, `CopState`, `DriverState`, `ArenaEvent`, `ArenaState` |
| `src/lib/cityArena/sim/limits.ts`                         | Entity caps (`MAX_PEDS` … `MAX_VEHICLES`, `MAX_EVENTS`)                                                                               |
| `src/lib/cityArena/sim/events.ts`                         | `pushEvent` (capped), `eventsOfKind`                                                                                                  |
| `src/lib/cityArena/sim/players.ts`                        | The player accessor seam: `playersOf`, `playerById`, `replacePlayer`, `driverPlayer`                                                  |
| `src/lib/cityArena/sim/weapons.ts` (modify)               | `SPAWN_AMMO` → pistol only, `MAX_AMMO`, `addAmmo`                                                                                     |
| `src/lib/cityArena/sim/invariants.ts` (modify)            | Caps, heat, unique ids across entities, driver/vehicle consistency, pickup timers                                                     |
| `src/lib/cityArena/world/binaryHeap.ts`                   | Min-heap used as the A\* open set                                                                                                     |
| `src/lib/cityArena/world/roadGraph.ts` (modify)           | `findPath` on the heap (same signature and results)                                                                                   |
| `src/lib/cityArena/world/pavements.ts`                    | Pavement/kerb offsets from the palette, rails on residential edges, random turns, nearest rail                                        |
| `src/lib/cityArena/world/pathFollow.ts`                   | `pathTo`, `nextWaypoint`, `moveToward`                                                                                                |
| `src/lib/cityArena/mapBuild/geometry.ts` (modify)         | `pointInRect`                                                                                                                         |
| `src/lib/cityArena/sim/pickups.ts`                        | Placement at landmarks/spawn nodes, take rules, respawn timer, `stepPickups`                                                          |
| `src/lib/cityArena/sim/populate.ts`                       | Active-zone population: `populateZone`, `applyPopulation`, `topUpPeds`                                                                |
| `src/lib/cityArena/sim/peds.ts`                           | Pedestrian walk/flee/dead, spawning, fright sources, run-over, blast                                                                  |
| `src/lib/cityArena/sim/hits.ts`                           | Bullet hits on pedestrians and cops (damage only from players, `hit`/`kill` events)                                                   |
| `src/lib/cityArena/sim/collisions.ts` (modify)            | `resolveVehicleAgainstCircle` shared by players, peds and cops                                                                        |
| `src/lib/cityArena/sim/driver.ts`                         | The AI control law: lane targets, steering, obstacle look-ahead, throttle                                                             |
| `src/lib/cityArena/sim/traffic.ts`                        | Ambient traffic spawning, wandering, `stepDrivers` (traffic and police roles)                                                         |
| `src/lib/cityArena/sim/spawn.ts` (modify)                 | Kerb-side parked cars every 40 m along residential/service edges (cap 30 per zone)                                                    |
| `src/lib/cityArena/sim/wanted.ts`                         | Heat bookkeeping, decay, level, `wantedTarget`, `applyWanted`                                                                         |
| `src/lib/cityArena/sim/cops.ts`                           | Cops on foot: spawn points out of view, pathing, shooting with inaccuracy, bodies, `manageCops`                                       |
| `src/lib/cityArena/sim/police.ts`                         | Police cars: spawn, chase target with A\*, ram range, `managePoliceCars`                                                              |
| `src/lib/cityArena/sim/zoneRule.ts`                       | Countdown and out-of-bounds damage behind `zoneEnforced`, `zoneSecondsLeft`                                                           |
| `src/lib/cityArena/sim/arena.ts` (modify)                 | `createArenaState`/`stepArena` composition, controls map for AI cars, sleeping parked cars, impact events, entity hit dispatch        |
| `src/lib/cityArena/render/palette.ts` (modify)            | Pedestrian, cop, pickup, police-car and radar colours                                                                                 |
| `src/lib/cityArena/render/drawPeople.ts`                  | Pedestrians, cops and their bodies                                                                                                    |
| `src/lib/cityArena/render/drawPickups.ts`                 | Bobbing pickup diamonds with the kind colour, a cross for health                                                                      |
| `src/lib/cityArena/render/drawVehicles.ts` (modify)       | Police livery with a blinking light bar                                                                                               |
| `src/lib/cityArena/render/renderScene.ts` (modify)        | `Scene` gains peds/cops/pickups; order world → zone → pickups → cars → bodies → people → bullets → effects → player → crosshair       |
| `src/lib/cityArena/render/radar.ts`                       | `RadarSnapshot`, `radarRoads`, `drawRadar`, `EMPTY_RADAR_SNAPSHOT`                                                                    |
| `src/lib/cityArena/audio/sound.ts`                        | `ArenaSound` synth: unlock, master gain, shot/explosion/pickup/hit voices, engine pitch                                               |
| `src/lib/cityArena/audio/testing/fakeAudioContext.ts`     | Recording fake `AudioContextLike` for unit tests                                                                                      |
| `src/lib/cityArena/schemas.ts` (modify)                   | `ArenaSettingsSchema` gains `sound` (default `true`)                                                                                  |
| `src/lib/cityArena/test/hooks.ts` (modify)                | `window.__arena` gains `setZoneEnforced`, `addHeat`                                                                                   |
| `src/components/cityArena/ArenaRadar.tsx`                 | The 90 px radar canvas painted from the HUD snapshot                                                                                  |
| `src/components/cityArena/ArenaWanted.tsx`                | "Gezocht" stars with accessible text                                                                                                  |
| `src/components/cityArena/ArenaZoneWarning.tsx`           | "Terug naar het strijdgebied! 5…" banner                                                                                              |
| `src/components/cityArena/ArenaSoundToggle.tsx`           | The "Geluid" checkbox                                                                                                                 |
| `src/components/cityArena/arenaHud.ts`                    | `ArenaHud`, `computeHud`, `buildRadarSnapshot` (moved out of `arenaRuntime.ts` to keep it under 800 lines)                            |
| `src/components/cityArena/arenaRuntime.ts` (modify)       | Runtime holds the sound; world gets graph + view rect; events → sound; engine per frame; debug counts                                 |
| `src/components/cityArena/useArenaGame.ts` (modify)       | Audio unlock, `sound`/`setSound`, hooks extension, options `audioContextFactory`                                                      |
| `src/components/cityArena/ArenaDebugOverlay.tsx` (modify) | Second entity line (voetgangers · agenten · verkeer · pickups · gezocht)                                                              |
| `src/components/cityArena/CityArenaOverlay.tsx` (modify)  | Wanted stars, radar and "Geluid" in the HUD bar; zone warning over the playfield                                                      |
| `docs/tech/arena/README.md` (modify)                      | Runtime (PR 4) section                                                                                                                |

Coordinates: **metres** everywhere (`Point = [x, y]`, north = negative y); angles in radians, `0` = east, positive turns clockwise on screen (y grows south). The right-hand perpendicular of a heading θ is `(−sin θ, cos θ)` — the same convention as `localToWorld`'s `[forward, right]` frame — so "the right kerb" of an eastbound road lies south of it. Ticks are 30 Hz (`SIM_STEP_S`).

Final tick order of `stepArena` after Task 8 (each phase is a pure function of the state): clear events → `applyPopulation` (zone change / pedestrian top-up) → `applyRespawn` → `stepPickups` → `applyWeaponSwitch` → `applyEnterExit` → `moveEntities` (AI drivers → cars → the player; impact events) → `applyFire` → `stepCops` (cops run, shoot and get run over) → `stepPeds` (react to this tick's shots, the cops' included) → `advanceBullets` (hits on cars, players, peds, cops) → `applyExplosions` → `applyZoneRule` → `applyWanted` → `manageCops` → `managePoliceCars` → `ejectIfDead` → prune effects and re-read the zone.

---

### Task 1: State types, events, the player accessor, pistol-only spawn ammo and the invariant caps

**Files:**

- Modify: `src/lib/cityArena/sim/types.ts`
- Create: `src/lib/cityArena/sim/limits.ts`
- Create: `src/lib/cityArena/sim/events.ts`
- Create: `src/lib/cityArena/sim/players.ts`
- Modify: `src/lib/cityArena/sim/weapons.ts`
- Modify: `src/lib/cityArena/sim/invariants.ts`
- Modify: `src/lib/cityArena/sim/arena.ts`
- Modify: `src/components/cityArena/arenaRuntime.ts` (one line: the world literal gains `graph`)
- Test: `src/lib/cityArena/sim/events.test.ts`, `src/lib/cityArena/sim/players.test.ts`, `src/lib/cityArena/sim/weapons.test.ts` (replace), `src/lib/cityArena/sim/invariants.test.ts` (replace), `src/lib/cityArena/sim/arena.test.ts` (modify), `src/lib/cityArena/sim/collisions.test.ts` (modify), `src/lib/cityArena/sim/damage.test.ts` (modify)

**Interfaces:**

- Consumes: `ZoneKey` (`../world/mapTypes`); `RoadGraph` (`../world/roadGraph`); `Rect` (`../mapBuild/geometry`); existing `ArenaState`, `ArenaPlayerState`, `AmmoState`, `WeaponKind`, `createArenaPlayer`, `createArenaState`, `stepArena`, `nearestZone`, `checkInvariants`.
- Produces: `PickupKind`, `PickupState`, `RailPosition`, `PedMode`, `PedState`, `CopWeapon`, `CopState`, `DriverRole`, `DriverState`, `HitTargetKind`, `ArenaEvent`; `ArenaPlayerState` gains `heat: number; heatTick: number; outsideSinceTick: number | null`; `ArenaState` gains `peds: PedState[]; cops: CopState[]; pickups: PickupState[]; traffic: DriverState[]; events: ArenaEvent[]; activeZoneKey: ZoneKey | null; zoneEnforced: boolean`; `MAX_PEDS = 40`, `MAX_COPS = 8`, `MAX_TRAFFIC = 12`, `MAX_PICKUPS = 10`, `MAX_EVENTS = 128`, `MAX_VEHICLES = 140`; `pushEvent(events, event): ArenaEvent[]`, `eventsOfKind(events, kind)`; `playersOf(state): ArenaPlayerState[]`, `playerById(state, id): ArenaPlayerState | null`, `replacePlayer(state, player): ArenaState`, `driverPlayer(state, vehicleId): ArenaPlayerState | null`; `SPAWN_AMMO = { uzi: 0, shotgun: 0 }`, `MAX_AMMO = { uzi: 120, shotgun: 16 }`, `addAmmo(ammo, kind, rounds): AmmoState`; `ArenaWorld = { collision; index; graph: RoadGraph; viewRect?: Rect }`; `stepArena` clears `events` at the start of every tick and emits `shot` and `explosion` events; `checkInvariants` enforces the caps.

- [x] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/sim/events.test.ts
import { describe, expect, it } from "vitest";
import { eventsOfKind, pushEvent } from "./events";
import { MAX_EVENTS } from "./limits";
import type { ArenaEvent } from "./types";

const shot: ArenaEvent = {
  kind: "shot",
  weapon: "pistol",
  ownerId: 0,
  x: 1,
  y: 2,
};
const boom: ArenaEvent = { kind: "explosion", x: 5, y: 6 };

describe("events", () => {
  it("appends events and filters them by kind", () => {
    const events = pushEvent(pushEvent([], shot), boom);
    expect(events).toEqual([shot, boom]);
    expect(eventsOfKind(events, "shot")).toEqual([shot]);
    expect(eventsOfKind(events, "explosion")[0].x).toBe(5);
    expect(eventsOfKind(events, "pickup")).toEqual([]);
  });

  it("keeps the oldest events once the per-tick cap is reached", () => {
    let events: ArenaEvent[] = [];
    for (let index = 0; index < MAX_EVENTS + 5; index++)
      events = pushEvent(events, { ...shot, x: index });
    expect(events).toHaveLength(MAX_EVENTS);
    expect(events[MAX_EVENTS - 1]).toMatchObject({ x: MAX_EVENTS - 1 });
  });
});
```

```ts
// src/lib/cityArena/sim/players.test.ts
import { describe, expect, it } from "vitest";
import type { MapIndex } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import { driverPlayer, playerById, playersOf, replacePlayer } from "./players";
import { createRng } from "./rng";

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};
const graph = decodeRoadGraph({ nodes: [], edges: [], classes: [], names: [] });

describe("player accessors", () => {
  it("lists, finds and replaces the local player by id", () => {
    const state = createArenaState(
      { index, graph, seed: 1, zone: null },
      createRng(1),
    );
    expect(playersOf(state)).toEqual([state.player]);
    expect(playerById(state, 0)).toBe(state.player);
    expect(playerById(state, 7)).toBeNull();
    const moved = replacePlayer(state, { ...state.player, x: 42 });
    expect(moved.player.x).toBe(42);
    expect(replacePlayer(state, { ...state.player, id: 9, x: 1 })).toBe(state);
  });

  it("finds the player driving a car", () => {
    const state = createArenaState(
      { index, graph, seed: 1, zone: null },
      createRng(1),
    );
    const seated = replacePlayer(state, { ...state.player, vehicleId: 5 });
    expect(driverPlayer(seated, 5)).toBe(seated.player);
    expect(driverPlayer(seated, 6)).toBeNull();
    expect(driverPlayer(state, 5)).toBeNull();
  });
});
```

```ts
// src/lib/cityArena/sim/weapons.test.ts  (replaces the Plan 4a file)
import { describe, expect, it } from "vitest";
import type { AmmoState } from "./types";
import {
  MAX_AMMO,
  SPAWN_AMMO,
  WEAPONS,
  addAmmo,
  ammoFor,
  consumeAmmo,
  cooldownTicks,
  hasAmmo,
  nextWeapon,
  weaponLabel,
} from "./weapons";

const FULL_AMMO: AmmoState = { uzi: 60, shotgun: 8 };

describe("weapons", () => {
  it("carries the spec values and Dutch labels", () => {
    expect(WEAPONS.pistol).toMatchObject({
      damage: 20,
      rangeM: 40,
      speedMps: 120,
      magazine: null,
    });
    expect(WEAPONS.shotgun.pellets).toBe(5);
    expect(WEAPONS.uzi.spreadRad).toBeCloseTo(0.0698, 4);
    expect(weaponLabel("pistol")).toBe("Pistool");
    expect(weaponLabel("fist")).toBe("Vuist");
  });

  it("derives cooldowns in ticks from the fire rates", () => {
    expect(cooldownTicks("fist")).toBe(15);
    expect(cooldownTicks("pistol")).toBe(12);
    expect(cooldownTicks("uzi")).toBe(3);
    expect(cooldownTicks("shotgun")).toBe(25);
  });

  it("spawns with the pistol and fist only and tracks ammo for the magazine weapons", () => {
    expect(SPAWN_AMMO).toEqual({ uzi: 0, shotgun: 0 });
    expect(ammoFor(FULL_AMMO, "pistol")).toBeNull();
    expect(ammoFor(FULL_AMMO, "uzi")).toBe(60);
    expect(consumeAmmo(FULL_AMMO, "uzi")).toEqual({ uzi: 59, shotgun: 8 });
    expect(consumeAmmo(FULL_AMMO, "pistol")).toBe(FULL_AMMO);
    expect(hasAmmo(SPAWN_AMMO, "uzi")).toBe(false);
    expect(hasAmmo(SPAWN_AMMO, "fist")).toBe(true);
  });

  it("adds pickup rounds up to the magazine caps", () => {
    expect(MAX_AMMO).toEqual({ uzi: 120, shotgun: 16 });
    expect(addAmmo(SPAWN_AMMO, "uzi", 60)).toEqual({ uzi: 60, shotgun: 0 });
    expect(addAmmo({ uzi: 100, shotgun: 0 }, "uzi", 60)).toEqual({
      uzi: 120,
      shotgun: 0,
    });
    expect(addAmmo({ uzi: 0, shotgun: 12 }, "shotgun", 8)).toEqual({
      uzi: 0,
      shotgun: 16,
    });
    expect(addAmmo(FULL_AMMO, "pistol", 5)).toBe(FULL_AMMO);
  });

  it("cycles to the next weapon that has ammo and wraps around", () => {
    expect(nextWeapon("pistol", FULL_AMMO)).toBe("uzi");
    expect(nextWeapon("pistol", { uzi: 0, shotgun: 8 })).toBe("shotgun");
    expect(nextWeapon("shotgun", FULL_AMMO)).toBe("fist");
    expect(nextWeapon("pistol", SPAWN_AMMO)).toBe("fist");
    expect(nextWeapon("fist", SPAWN_AMMO)).toBe("pistol");
  });
});
```

```ts
// src/lib/cityArena/sim/invariants.test.ts  (replaces the Plan 4a file)
import { describe, expect, it } from "vitest";
import { createArenaPlayer } from "./arena";
import { createShots } from "./bullets";
import { checkInvariants } from "./invariants";
import { MAX_PEDS } from "./limits";
import type { ArenaState, PedState } from "./types";
import { createVehicle } from "./vehicle";
import { WEAPONS } from "./weapons";

const healthy: ArenaState = {
  tick: 10,
  seed: 1,
  nextId: 3,
  player: createArenaPlayer([5, 5], 0),
  vehicles: [createVehicle(1, "sedan", [20, 0], 0, 0)],
  bullets: [],
  effects: [],
  held: { enter: false, weaponNext: false },
  zoneKey: null,
  peds: [],
  cops: [],
  pickups: [],
  traffic: [],
  events: [],
  activeZoneKey: null,
  zoneEnforced: false,
};

function pedAt(id: number, x: number): PedState {
  return {
    id,
    x,
    y: 0,
    facing: 0,
    health: 40,
    mode: "walk",
    modeUntilTick: 0,
    rail: null,
    fleeX: 0,
    fleeY: 0,
  };
}

describe("checkInvariants", () => {
  it("accepts a healthy state", () => {
    expect(checkInvariants(healthy)).toEqual([]);
  });

  it("reports broken health, positions, references and stale projectiles", () => {
    expect(
      checkInvariants({
        ...healthy,
        player: { ...healthy.player, health: 150 },
      }),
    ).toContain("player.health 150 out of range");
    expect(
      checkInvariants({
        ...healthy,
        player: { ...healthy.player, x: Number.NaN },
      }),
    ).toContain("player position is not finite");
    expect(
      checkInvariants({
        ...healthy,
        player: { ...healthy.player, vehicleId: 999 },
      }),
    ).toContain("player.vehicleId points to a missing or wrecked car");
    expect(
      checkInvariants({
        ...healthy,
        player: { ...healthy.player, health: 0, diedAtTick: 4, vehicleId: 1 },
      }),
    ).toContain("dead player must be on foot with zero health");
    const [stale] = createShots(
      WEAPONS.pistol,
      "pistol",
      [0, 0],
      0,
      { ownerId: 0, ignoreVehicleId: null, firstId: 9 },
      () => 0,
    );
    expect(
      checkInvariants({ ...healthy, bullets: [{ ...stale, rangeLeftM: 0 }] }),
    ).toContain("bullet 9 expired or not finite");
    expect(
      checkInvariants({
        ...healthy,
        effects: [
          {
            id: 2,
            kind: "impact",
            x: 0,
            y: 0,
            angle: 0,
            bornTick: 0,
            ttlTicks: 6,
          },
        ],
      }),
    ).toContain("effect 2 expired");
  });

  it("reports negative heat, entity caps, duplicate ids and drivers without a car", () => {
    expect(
      checkInvariants({ ...healthy, player: { ...healthy.player, heat: -1 } }),
    ).toContain("player heat negative or not finite");
    const crowd = Array.from({ length: MAX_PEDS + 1 }, (_, index) =>
      pedAt(100 + index, index),
    );
    expect(checkInvariants({ ...healthy, peds: crowd })).toContain(
      "too many pedestrians",
    );
    expect(checkInvariants({ ...healthy, peds: [pedAt(1, 0)] })).toContain(
      "duplicate entity id 1",
    );
    expect(
      checkInvariants({
        ...healthy,
        peds: [{ ...pedAt(50, 0), health: 0 }],
      }),
    ).toContain("ped 50 death and health disagree");
    expect(
      checkInvariants({
        ...healthy,
        traffic: [
          {
            vehicleId: 42,
            role: "traffic",
            cruiseMps: 10,
            fromNode: null,
            path: [],
            repathTick: 0,
          },
        ],
      }),
    ).toContain("driver of vehicle 42 has no intact car");
    expect(
      checkInvariants({
        ...healthy,
        pickups: [{ id: 60, kind: "uzi", x: 0, y: 0, takenAtTick: 11 }],
      }),
    ).toContain("pickup 60 taken in the future");
  });
});
```

Edit `src/lib/cityArena/sim/collisions.test.ts` and `src/lib/cityArena/sim/damage.test.ts`: add `heat: 0, heatTick: 0, outsideSinceTick: null,` after `invulnerableUntilTick: 0,` in both `walker` literals (nothing else changes).

Edit `src/lib/cityArena/sim/arena.test.ts`:

1. Extend the `./types` import with `type AmmoState` and add, below `SPAWN_XS`: `const FULL_AMMO: AmmoState = { uzi: 60, shotgun: 8 };`
2. `const world: ArenaWorld = { collision: createCollisionGrid(), index, graph };`
3. In "spawns the player on a spawn node with the loadout and parks cars away from them" change the player expectation to `ammo: { uzi: 0, shotgun: 0 }` and append before `expect(boot(4)).toEqual(boot(4));`:

```ts
expect(state.player).toMatchObject({ heat: 0, outsideSinceTick: null });
expect(state).toMatchObject({
  peds: [],
  cops: [],
  pickups: [],
  traffic: [],
  events: [],
  activeZoneKey: "campus",
  zoneEnforced: false,
});
```

4. Replace the weapon-cycling test:

```ts
it("cycles the weapon on a rising edge only, skipping empty magazines", () => {
  const pressed = run(boot(), createInput({ weaponNext: true }), 5);
  expect(pressed.player.weapon).toBe("fist");
  const released = run(pressed, createInput({}), 1);
  const armed = run(
    { ...released, player: { ...released.player, ammo: FULL_AMMO } },
    createInput({ weaponNext: true }),
    1,
  );
  expect(armed.player.weapon).toBe("pistol");
  const releasedAgain = run(armed, createInput({}), 1);
  expect(
    run(releasedAgain, createInput({ weaponNext: true }), 1).player.weapon,
  ).toBe("uzi");
});
```

5. In "spends Uzi rounds at 10 per second and shotgun shells five pellets at a time" replace the first three lines with:

```ts
const state = boot();
const withUzi: ArenaState = {
  ...state,
  player: { ...state.player, weapon: "uzi", ammo: FULL_AMMO },
};
const uzi = run(withUzi, createInput({ fire: true }), 30);
expect(uzi.player.weapon).toBe("uzi");
expect(uzi.player.ammo.uzi).toBe(50);
```

and change `armed` to `{ ...state.player, weapon: "shotgun", ammo: FULL_AMMO }` (delete the duplicate `const state = boot();` that followed).

6. In "caps a shotgun pull at the live-bullet limit" change `armed` to `{ ...state.player, weapon: "shotgun", ammo: FULL_AMMO }`.
7. In "kills the occupant of an exploding car …" change the respawn expectation to `ammo: { uzi: 0, shotgun: 0 }` and add `heat: 0,` to the same `toMatchObject`.
8. Append to the `"stepArena firing and death"` describe:

```ts
it("records shot and explosion events for one tick only and resets heat on death", () => {
  const state = boot();
  const fired = run(state, createInput({ fire: true }), 1);
  expect(fired.events).toEqual([
    {
      kind: "shot",
      weapon: "pistol",
      ownerId: 0,
      x: state.player.x,
      y: state.player.y,
    },
  ]);
  expect(run(fired, createInput({ fire: true }), 1).events).toEqual([]);
  const fragile = {
    ...createVehicle(
      501,
      "compact",
      [state.player.x + 6, state.player.y],
      0,
      0,
    ),
    health: 20,
  };
  const boom = run(
    { ...state, vehicles: [fragile] },
    createInput({ fire: true, aim: 0 }),
    1,
  );
  expect(boom.events.map((event) => event.kind)).toEqual(["shot", "explosion"]);
  const heated: ArenaState = {
    ...state,
    player: { ...state.player, heat: 80, health: 0, diedAtTick: state.tick },
  };
  expect(run(heated, EMPTY_INPUT, RESPAWN_DELAY_TICKS).player.heat).toBe(0);
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim`
Expected: FAIL — `./events`, `./players`, `./limits` not found; `MAX_AMMO`/`addAmmo` not exported; `SPAWN_AMMO` still `{ uzi: 60, shotgun: 8 }`; `ArenaState` literals reject `peds`; `tsc` errors on the missing `graph` in `ArenaWorld`.

- [x] **Step 3: Extend the types and add the limits, events and players modules**

```ts
// src/lib/cityArena/sim/types.ts
import type { ZoneKey } from "../world/mapTypes";

/**
 * Device-agnostic input (spec §7): a movement vector with length ≤ 1 (x east, y south), an
 * aim angle in radians or `null` to fire along the facing, and three held buttons.
 */
export type WorldInput = {
  move: [number, number];
  aim: number | null;
  fire: boolean;
  enter: boolean;
  weaponNext: boolean;
};

/** An input with nothing pressed. */
export const EMPTY_INPUT: WorldInput = {
  move: [0, 0],
  aim: null,
  fire: false,
  enter: false,
  weaponNext: false,
};

/** Builds a full input from the fields a test or a debug dispatch cares about. */
export function createInput(partial: Partial<WorldInput>): WorldInput {
  return {
    move: partial.move ?? [0, 0],
    aim: partial.aim ?? null,
    fire: partial.fire ?? false,
    enter: partial.enter ?? false,
    weaponNext: partial.weaponNext ?? false,
  };
}

/** The local player on foot; `facing` in radians, `speed` in m/s. */
export type PlayerState = {
  x: number;
  y: number;
  facing: number;
  speed: number;
};

/** Single-player free-roam session state (Plan 2; kept for the walking tests). */
export type FreeRoamState = {
  tick: number;
  player: PlayerState;
  zoneKey: ZoneKey | null;
};

/** Weapons in Wapen-button cycling order (spec §5 plus the fist). */
export type WeaponKind = "fist" | "pistol" | "uzi" | "shotgun";

/** Car kinds (spec §5). */
export type VehicleKind = "compact" | "sedan" | "sport" | "police";

/** A car; `heading` in radians, velocity in world m/s, `colour` indexes the render palette. */
export type VehicleState = {
  id: number;
  kind: VehicleKind;
  x: number;
  y: number;
  heading: number;
  velocityX: number;
  velocityY: number;
  health: number;
  wrecked: boolean;
  colour: number;
};

/** A projectile (or fist reach) travelling along a unit direction until its range runs out. */
export type BulletState = {
  id: number;
  ownerId: number;
  ignoreVehicleId: number | null;
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  speedMps: number;
  rangeLeftM: number;
  damage: number;
  weapon: WeaponKind;
};

/** Kinds of short-lived visual effects. */
export type EffectKind = "muzzle" | "impact" | "explosion";

/** A render-only effect; it expires once `tick - bornTick >= ttlTicks`. */
export type EffectState = {
  id: number;
  kind: EffectKind;
  x: number;
  y: number;
  angle: number;
  bornTick: number;
  ttlTicks: number;
};

/** Rounds left for the magazine weapons; pistol and fist are unlimited. */
export type AmmoState = { uzi: number; shotgun: number };

/**
 * The player with everything the arena adds to walking. `heat` drives the wanted level and
 * `heatTick` is the tick heat last rose (decay waits for 8 quiet seconds); `outsideSinceTick`
 * is set while the player is outside an enforced zone (spec §5).
 */
export type ArenaPlayerState = PlayerState & {
  id: number;
  health: number;
  weapon: WeaponKind;
  ammo: AmmoState;
  vehicleId: number | null;
  boardingTicksLeft: number;
  nextShotTick: number;
  diedAtTick: number | null;
  invulnerableUntilTick: number;
  heat: number;
  heatTick: number;
  outsideSinceTick: number | null;
};

/** Buttons whose previous held state the simulation remembers for edge detection. */
export type HeldButtons = { enter: boolean; weaponNext: boolean };

/** Kinds of pickups (spec §5): ammo for the two magazine weapons, or health. */
export type PickupKind = "uzi" | "shotgun" | "health";

/** A pickup spot; `takenAtTick` is set while it waits for its respawn. */
export type PickupState = {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  takenAtTick: number | null;
};

/**
 * A place on a pavement: a road-graph edge walked in `direction` (a→b is 1, b→a is −1),
 * progress `edgeT` in 0..1 along that direction, on the `side` to the right (1) or left (−1)
 * of the direction of travel.
 */
export type RailPosition = {
  edge: number;
  direction: 1 | -1;
  edgeT: number;
  side: 1 | -1;
};

/** What a pedestrian is doing. */
export type PedMode = "walk" | "flee" | "dead";

/**
 * A pedestrian: walking its rail, fleeing freely along the unit vector `fleeX/fleeY` until
 * `modeUntilTick`, or lying dead until `modeUntilTick` (spec §5).
 */
export type PedState = {
  id: number;
  x: number;
  y: number;
  facing: number;
  health: number;
  mode: PedMode;
  modeUntilTick: number;
  rail: RailPosition | null;
  fleeX: number;
  fleeY: number;
};

/** Weapons cops carry (spec §5: pistols, shotguns at level 3). */
export type CopWeapon = "pistol" | "shotgun";

/** A police officer on foot walking `path` (upcoming road-graph nodes) toward the wanted player. */
export type CopState = {
  id: number;
  x: number;
  y: number;
  facing: number;
  health: number;
  weapon: CopWeapon;
  path: number[];
  repathTick: number;
  nextShotTick: number;
  diedAtTick: number | null;
};

/** Who drives an AI car. */
export type DriverRole = "traffic" | "police";

/** An AI driver bound to a car: `fromNode` is the road-graph node just passed, `path` the nodes ahead. */
export type DriverState = {
  vehicleId: number;
  role: DriverRole;
  cruiseMps: number;
  fromNode: number | null;
  path: number[];
  repathTick: number;
};

/** What a bullet struck, for the hit event. */
export type HitTargetKind = "player" | "ped" | "cop" | "vehicle";

/** Something that happened this tick, played as sound now and forwarded over the wire by Plan 3 (spec §6.3). */
export type ArenaEvent =
  | { kind: "shot"; weapon: WeaponKind; ownerId: number; x: number; y: number }
  | { kind: "hit"; target: HitTargetKind; x: number; y: number }
  | {
      kind: "impact";
      vehicleId: number;
      otherVehicleId: number | null;
      impactSpeed: number;
    }
  | { kind: "explosion"; x: number; y: number }
  | {
      kind: "pickup";
      pickupKind: PickupKind;
      playerId: number;
      x: number;
      y: number;
    }
  | {
      kind: "kill";
      victim: "ped" | "cop";
      killerId: number | null;
      x: number;
      y: number;
    }
  | { kind: "wanted"; playerId: number; level: number };

/**
 * Full arena simulation state: plain, JSON-serialisable data. `activeZoneKey` is the zone whose
 * pedestrians, traffic and pickups are populated (the one nearest the player) and the zone the
 * out-of-bounds rule applies to while `zoneEnforced` is on; `events` holds this tick's events.
 */
export type ArenaState = {
  tick: number;
  seed: number;
  nextId: number;
  player: ArenaPlayerState;
  vehicles: VehicleState[];
  bullets: BulletState[];
  effects: EffectState[];
  held: HeldButtons;
  zoneKey: ZoneKey | null;
  peds: PedState[];
  cops: CopState[];
  pickups: PickupState[];
  traffic: DriverState[];
  events: ArenaEvent[];
  activeZoneKey: ZoneKey | null;
  zoneEnforced: boolean;
};
```

```ts
// src/lib/cityArena/sim/limits.ts
/** Most pedestrians (alive plus bodies) in the state (Plan 4b decision 9). */
export const MAX_PEDS = 40;
/** Most cops on foot (alive plus bodies). */
export const MAX_COPS = 8;
/** Most AI drivers (ambient traffic plus police cars). */
export const MAX_TRAFFIC = 12;
/** Most pickups (one zone is populated at a time). */
export const MAX_PICKUPS = 10;
/** Most events recorded in one tick; later events are dropped. */
export const MAX_EVENTS = 128;
/** Most cars (four zones of parked cars plus the driven ones). */
export const MAX_VEHICLES = 140;
```

```ts
// src/lib/cityArena/sim/events.ts
import { MAX_EVENTS } from "./limits";
import type { ArenaEvent } from "./types";

/** Appends an event unless the per-tick cap is reached; the oldest events are the ones kept. */
export function pushEvent(
  events: ArenaEvent[],
  event: ArenaEvent,
): ArenaEvent[] {
  return events.length >= MAX_EVENTS ? events : [...events, event];
}

/** The events of one kind, narrowed to that member of the union. */
export function eventsOfKind<Kind extends ArenaEvent["kind"]>(
  events: ArenaEvent[],
  kind: Kind,
): Extract<ArenaEvent, { kind: Kind }>[] {
  return events.filter(
    (event): event is Extract<ArenaEvent, { kind: Kind }> =>
      event.kind === kind,
  );
}
```

```ts
// src/lib/cityArena/sim/players.ts
import type { ArenaPlayerState, ArenaState } from "./types";

/**
 * The seam Plan 3 widens: every entity system reads players through these functions, so
 * lifting `state.player` into a list touches this file only.
 */

/** Every player in the state (one, until Plan 3). */
export function playersOf(state: ArenaState): ArenaPlayerState[] {
  return [state.player];
}

/** The player with `id`, or `null`. */
export function playerById(
  state: ArenaState,
  id: number,
): ArenaPlayerState | null {
  return state.player.id === id ? state.player : null;
}

/** The state with `player` written back by id; unchanged when no player has that id. */
export function replacePlayer(
  state: ArenaState,
  player: ArenaPlayerState,
): ArenaState {
  return state.player.id === player.id ? { ...state, player } : state;
}

/** The player sitting in the car `vehicleId`, or `null`. */
export function driverPlayer(
  state: ArenaState,
  vehicleId: number,
): ArenaPlayerState | null {
  return state.player.vehicleId === vehicleId ? state.player : null;
}
```

- [x] **Step 4: Change the spawn ammo, add the caps and extend the invariants**

In `src/lib/cityArena/sim/weapons.ts` replace the `SPAWN_AMMO` block with:

```ts
/** Ammo the player spawns with: pistol and fist only; Uzi and shotgun come from pickups (Plan 4b decision 2). */
export const SPAWN_AMMO: AmmoState = { uzi: 0, shotgun: 0 };

/** Most rounds a player can carry per magazine weapon (two pickups' worth). */
export const MAX_AMMO: AmmoState = { uzi: 120, shotgun: 16 };

/** Ammo after picking up `rounds` for a magazine weapon, capped at {@link MAX_AMMO}; unlimited weapons return the same object. */
export function addAmmo(
  ammo: AmmoState,
  kind: WeaponKind,
  rounds: number,
): AmmoState {
  if (kind === "uzi")
    return { ...ammo, uzi: Math.min(MAX_AMMO.uzi, ammo.uzi + rounds) };
  if (kind === "shotgun")
    return {
      ...ammo,
      shotgun: Math.min(MAX_AMMO.shotgun, ammo.shotgun + rounds),
    };
  return ammo;
}
```

```ts
// src/lib/cityArena/sim/invariants.ts
import { MAX_BULLETS } from "./bullets";
import { PLAYER_MAX_HEALTH } from "./damage";
import { MAX_EFFECTS } from "./effects";
import {
  MAX_COPS,
  MAX_EVENTS,
  MAX_PEDS,
  MAX_PICKUPS,
  MAX_TRAFFIC,
  MAX_VEHICLES,
} from "./limits";
import type { ArenaState } from "./types";
import { VEHICLE_MAX_HEALTH } from "./vehicle";

/** Records `message` when `condition` is false. */
function check(
  violations: string[],
  condition: boolean,
  message: string,
): void {
  if (!condition) violations.push(message);
}

/** True when every value is a finite number. */
function finite(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

/** Records an entity id, flagging one that another entity already uses. */
function registerId(violations: string[], ids: Set<number>, id: number): void {
  check(violations, !ids.has(id), `duplicate entity id ${id}`);
  ids.add(id);
}

/** Player health, ammo, heat, position and car reference. */
function checkPlayer(state: ArenaState, violations: string[]): void {
  const { player } = state;
  check(
    violations,
    finite(player.x, player.y, player.facing, player.speed),
    "player position is not finite",
  );
  check(
    violations,
    player.health >= 0 && player.health <= PLAYER_MAX_HEALTH,
    `player.health ${player.health} out of range`,
  );
  check(
    violations,
    player.ammo.uzi >= 0 && player.ammo.shotgun >= 0,
    "player ammo negative",
  );
  check(
    violations,
    finite(player.heat) && player.heat >= 0,
    "player heat negative or not finite",
  );
  check(
    violations,
    player.vehicleId === null ||
      state.vehicles.some(
        (vehicle) => vehicle.id === player.vehicleId && !vehicle.wrecked,
      ),
    "player.vehicleId points to a missing or wrecked car",
  );
  check(
    violations,
    player.diedAtTick === null ||
      (player.vehicleId === null && player.health === 0),
    "dead player must be on foot with zero health",
  );
  check(
    violations,
    player.diedAtTick === null || player.diedAtTick <= state.tick,
    "diedAtTick lies in the future",
  );
}

/** Car positions, health and unique ids. */
function checkVehicles(
  state: ArenaState,
  violations: string[],
  ids: Set<number>,
): void {
  check(violations, state.vehicles.length <= MAX_VEHICLES, "too many vehicles");
  for (const vehicle of state.vehicles) {
    check(
      violations,
      finite(
        vehicle.x,
        vehicle.y,
        vehicle.heading,
        vehicle.velocityX,
        vehicle.velocityY,
      ),
      `vehicle ${vehicle.id} is not finite`,
    );
    check(
      violations,
      vehicle.health >= 0 && vehicle.health <= VEHICLE_MAX_HEALTH,
      `vehicle ${vehicle.id} health out of range`,
    );
    registerId(violations, ids, vehicle.id);
  }
}

/** Bullet and effect caps and expiry. */
function checkProjectiles(state: ArenaState, violations: string[]): void {
  check(violations, state.bullets.length <= MAX_BULLETS, "too many bullets");
  check(violations, state.effects.length <= MAX_EFFECTS, "too many effects");
  for (const bullet of state.bullets)
    check(
      violations,
      finite(bullet.x, bullet.y) && bullet.rangeLeftM > 0,
      `bullet ${bullet.id} expired or not finite`,
    );
  for (const effect of state.effects)
    check(
      violations,
      state.tick - effect.bornTick < effect.ttlTicks,
      `effect ${effect.id} expired`,
    );
}

/** Pedestrians and cops: caps, finite positions, death and health agreeing, unique ids. */
function checkPeople(
  state: ArenaState,
  violations: string[],
  ids: Set<number>,
): void {
  check(violations, state.peds.length <= MAX_PEDS, "too many pedestrians");
  check(violations, state.cops.length <= MAX_COPS, "too many cops");
  for (const ped of state.peds) {
    check(
      violations,
      finite(ped.x, ped.y, ped.facing),
      `ped ${ped.id} is not finite`,
    );
    check(
      violations,
      (ped.mode === "dead") === (ped.health === 0),
      `ped ${ped.id} death and health disagree`,
    );
    registerId(violations, ids, ped.id);
  }
  for (const cop of state.cops) {
    check(
      violations,
      finite(cop.x, cop.y, cop.facing),
      `cop ${cop.id} is not finite`,
    );
    check(
      violations,
      (cop.diedAtTick !== null) === (cop.health === 0),
      `cop ${cop.id} death and health disagree`,
    );
    registerId(violations, ids, cop.id);
  }
}

/** Pickups, AI drivers and the per-tick event list. */
function checkPopulation(
  state: ArenaState,
  violations: string[],
  ids: Set<number>,
): void {
  check(violations, state.pickups.length <= MAX_PICKUPS, "too many pickups");
  check(violations, state.traffic.length <= MAX_TRAFFIC, "too many drivers");
  check(violations, state.events.length <= MAX_EVENTS, "too many events");
  for (const pickup of state.pickups) {
    check(
      violations,
      pickup.takenAtTick === null || pickup.takenAtTick <= state.tick,
      `pickup ${pickup.id} taken in the future`,
    );
    registerId(violations, ids, pickup.id);
  }
  const driven = new Set<number>();
  for (const driver of state.traffic) {
    check(
      violations,
      state.vehicles.some(
        (vehicle) => vehicle.id === driver.vehicleId && !vehicle.wrecked,
      ),
      `driver of vehicle ${driver.vehicleId} has no intact car`,
    );
    check(
      violations,
      !driven.has(driver.vehicleId) &&
        driver.vehicleId !== state.player.vehicleId,
      `vehicle ${driver.vehicleId} has more than one driver`,
    );
    driven.add(driver.vehicleId);
  }
}

/** Every broken invariant of a state (empty when healthy); pure, so tests run it after each step. */
export function checkInvariants(state: ArenaState): string[] {
  const violations: string[] = [];
  const ids = new Set<number>();
  check(
    violations,
    Number.isInteger(state.tick) && state.tick >= 0,
    "tick must be a non-negative integer",
  );
  checkPlayer(state, violations);
  checkVehicles(state, violations, ids);
  checkProjectiles(state, violations);
  checkPeople(state, violations, ids);
  checkPopulation(state, violations, ids);
  return violations;
}
```

- [x] **Step 5: Thread the graph, the new fields and the events through `arena.ts`**

In `src/lib/cityArena/sim/arena.ts`:

Add the imports `import type { Rect } from "../mapBuild/geometry";`, `import type { RoadGraph } from "../world/roadGraph";` and `import { pushEvent } from "./events";`, then replace `ArenaWorld`, `createArenaPlayer` and `createArenaState`:

```ts
/** What the arena step reads from the world; `viewRect` (metres) is the camera's visible area when known, so spawns can stay out of view. */
export type ArenaWorld = {
  collision: Pick<CollisionGrid, "resolveCircle" | "query">;
  index: MapIndex;
  graph: RoadGraph;
  viewRect?: Rect;
};

/** A player standing at `position` with the spawn loadout, no heat and no zone timer, ready to fire from `tick`. */
export function createArenaPlayer(
  position: Point,
  tick: number,
): ArenaPlayerState {
  return {
    id: LOCAL_PLAYER_ID,
    x: position[0],
    y: position[1],
    facing: -Math.PI / 2,
    speed: 0,
    health: PLAYER_MAX_HEALTH,
    weapon: "pistol",
    ammo: SPAWN_AMMO,
    vehicleId: null,
    boardingTicksLeft: 0,
    nextShotTick: tick,
    diedAtTick: null,
    invulnerableUntilTick: tick,
    heat: 0,
    heatTick: tick,
    outsideSinceTick: null,
  };
}

/** A fresh session: the player on a spawn node of `zone` (the map origin without one), parked cars in every zone, the zone rule off. */
export function createArenaState(
  setup: ArenaSetup,
  random: () => number,
): ArenaState {
  const spawn: Point = setup.zone
    ? chooseSpawnNode(setup.zone, [], random)
    : [0, 0];
  const vehicles = spawnParkedCars(
    setup.index,
    setup.graph,
    random,
    [spawn],
    FIRST_ENTITY_ID,
  );
  const activeZone = setup.zone ?? nearestZone(setup.index, spawn);
  return {
    tick: 0,
    seed: setup.seed,
    nextId: FIRST_ENTITY_ID + vehicles.length,
    player: createArenaPlayer(spawn, 0),
    vehicles,
    bullets: [],
    effects: [],
    held: { enter: false, weaponNext: false },
    zoneKey: findZone(setup.index, spawn)?.key ?? null,
    peds: [],
    cops: [],
    pickups: [],
    traffic: [],
    events: [],
    activeZoneKey: activeZone?.key ?? null,
    zoneEnforced: false,
  };
}
```

In `applyFire` add the shot event (the return statement becomes):

```ts
return {
  ...state,
  nextId,
  bullets: [...state.bullets, ...shots],
  effects,
  events: pushEvent(state.events, {
    kind: "shot",
    weapon: state.player.weapon,
    ownerId: state.player.id,
    x: state.player.x,
    y: state.player.y,
  }),
  player: afterShot(state.player, tick),
};
```

In `explodeVehicle` add `events: pushEvent(state.events, { kind: "explosion", x: vehicle.x, y: vehicle.y }),` to the returned object (after `effects`).

In `stepArena` change the first assignment to clear the events: `let next: ArenaState = { ...state, tick, held: edges.held, events: [] };`.

In `src/components/cityArena/arenaRuntime.ts` (`advanceSimulation`) the world literal becomes:

```ts
const world: ArenaWorld = {
  collision: runtime.session.collision,
  index: runtime.session.index(),
  graph: runtime.session.graph(),
};
```

- [x] **Step 6: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run src/lib/cityArena src/components/cityArena`
Expected: `tsc` clean; PASS — events 2, players 2, weapons 5, invariants 3, arena 1 + 2 + 5 + 2 + 10, collisions 5, damage 4, and every unchanged suite (the Plan 4a `useArenaGame` debug test still compares the switched weapon with `nextWeapon("pistol", SPAWN_AMMO)`, which is now `"fist"` on both sides). Worked numbers: with `{ uzi: 0, shotgun: 0 }` the Wapen order pistol → fist → pistol → (with full ammo) uzi; the pistol fires on tick 1 only within 2 ticks, so the second tick's `events` is empty; a compact with 20 health explodes on the first 20-damage hit (the bullet's first 4 m sweep reaches the body edge at 3.9 m), giving the events `["shot", "explosion"]` in one tick.

- [x] **Step 7: Commit**

```bash
npx prettier --write src/lib/cityArena/sim src/components/cityArena/arenaRuntime.ts
git add src/lib/cityArena/sim src/components/cityArena/arenaRuntime.ts
git commit -m "feat(arena): add 4b state types, events, player accessor and ammo caps

Extends ArenaState with pedestrians, cops, pickups, AI drivers, a per-tick
event list and the active-zone/zone-enforced fields, drops the spawn
loadout to pistol + fist, caps pickup ammo, and teaches checkInvariants
the entity caps and id uniqueness.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Heap-backed A\*, pavement rails and path following

**Files:**

- Create: `src/lib/cityArena/world/binaryHeap.ts`
- Modify: `src/lib/cityArena/world/roadGraph.ts` (`findPath` only)
- Create: `src/lib/cityArena/world/pavements.ts`
- Create: `src/lib/cityArena/world/pathFollow.ts`
- Modify: `src/lib/cityArena/mapBuild/geometry.ts` (`pointInRect`)
- Test: `src/lib/cityArena/world/binaryHeap.test.ts`, `src/lib/cityArena/world/roadGraph.test.ts` (extend), `src/lib/cityArena/world/pavements.test.ts`, `src/lib/cityArena/world/pathFollow.test.ts`, `src/lib/cityArena/mapBuild/geometry.test.ts` (extend)

**Interfaces:**

- Consumes: `RoadGraph`, `RoadGraphEdge`, `decodeRoadGraph`, `pathLength` (`./roadGraph`); `RailPosition` (`../sim/types`, Task 1); `ROAD_WIDTH_M`, `PAVEMENT_WIDTH_M` (`../render/palette`); `distancePointToSegment`, `Rect` (`../mapBuild/geometry`); `Point`; `RoadClass`.
- Produces: `BinaryHeap<T> = { push(item, priority): void; pop(): T | null; size(): number }`, `createBinaryHeap<T>()`; `PathOptions = { respectOneway?: boolean; allowEdge?: (edge: RoadGraphEdge) => boolean }`, `findPath(graph, from, to, options?: PathOptions)` (same results as before when `allowEdge` is absent); `PAVEMENT_ROAD_CLASSES`, `PARKING_ROAD_CLASSES = ["residential", "service"]`, `PARKED_KERB_OVERHANG_M = 0.3`, `RailGraph = Pick<RoadGraph, "nodes" | "edges" | "adjacency" | "nearestNode">`, `pavementOffsetM(roadClass): number`, `kerbOffsetM(roadClass): number` (road half-width + 0.3), `isPavementEdge(edge): boolean`, `railEnds(graph, rail): [Point, Point]`, `railEndNode(graph, rail): number`, `railHeading(graph, rail): number`, `edgeLengthM(graph, edgeIndex): number`, `railPoint(graph, rail, offsetM): Point`, `nextPavementEdge(graph, node, arriving, random): number | null`, `advanceRail(graph, rail, distanceM, random): RailPosition`, `pavementEdgesWithin(graph, centre, radiusM): number[]`, `randomRail(graph, edges, random): RailPosition`, `nearestRail(graph, point, maxDistanceM, random): RailPosition | null`; `PathProgress = { path: number[]; target: Point | null }`, `nextWaypoint(graph, path, position, reachM): PathProgress`, `pathTo(graph, from, to, snapM, options?): number[] | null`, `moveToward(position, target, distanceM): Point`; `pointInRect(point, rect): boolean`.

- [x] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/world/binaryHeap.test.ts
import { describe, expect, it } from "vitest";
import { createBinaryHeap } from "./binaryHeap";

describe("createBinaryHeap", () => {
  it("pops items in ascending priority order", () => {
    const heap = createBinaryHeap<string>();
    heap.push("five", 5);
    heap.push("one", 1);
    heap.push("three", 3);
    heap.push("two", 2);
    expect(heap.size()).toBe(4);
    expect(heap.pop()).toBe("one");
    expect(heap.pop()).toBe("two");
    heap.push("zero", 0);
    expect(heap.pop()).toBe("zero");
    expect(heap.pop()).toBe("three");
    expect(heap.pop()).toBe("five");
    expect(heap.pop()).toBeNull();
    expect(heap.size()).toBe(0);
  });

  it("keeps a long shuffled sequence sorted", () => {
    const heap = createBinaryHeap<number>();
    const values = Array.from(
      { length: 200 },
      (_, index) => (index * 37) % 101,
    );
    for (const value of values) heap.push(value, value);
    const popped: number[] = [];
    for (let item = heap.pop(); item !== null; item = heap.pop())
      popped.push(item);
    expect(popped).toEqual([...values].sort((left, right) => left - right));
  });
});
```

Append to `src/lib/cityArena/world/roadGraph.test.ts` (inside the existing `describe("findPath")`, reusing its imports):

```ts
it("finds a shortest lattice path with the heap open set", () => {
  const size = 20;
  const nodes: number[] = [];
  const edges: number[] = [];
  for (let row = 0; row < size; row++)
    for (let column = 0; column < size; column++) {
      nodes.push(column * 40, row * 40);
      const index = row * size + column;
      if (column + 1 < size) edges.push(index, index + 1, 0, -1, 0, 40);
      if (row + 1 < size) edges.push(index, index + size, 0, -1, 0, 40);
    }
  const lattice = decodeRoadGraph({
    nodes,
    edges,
    classes: ["residential"],
    names: [],
  });
  const path = findPath(lattice, 0, size * size - 1);
  expect(path).toHaveLength(2 * size - 1);
  expect(path?.[0]).toBe(0);
  expect(path?.at(-1)).toBe(size * size - 1);
  expect(pathLength(lattice, path ?? [])).toBe(380);
  for (let index = 0; index + 1 < (path?.length ?? 0); index++) {
    const step = (path?.[index + 1] ?? 0) - (path?.[index] ?? 0);
    expect([1, size]).toContain(step);
  }
});

it("skips edges the allowEdge filter rejects", () => {
  const graph = decodeRoadGraph(roads);
  expect(findPath(graph, 0, 4)).toEqual([0, 1, 4]);
  expect(
    findPath(graph, 0, 4, {
      allowEdge: (edge) => edge.roadClass !== "service",
    }),
  ).toBeNull();
  expect(
    findPath(graph, 0, 2, {
      allowEdge: (edge) => edge.roadClass !== "service",
    }),
  ).toEqual([0, 1, 2]);
});

it("prefers three short hops over one long declared edge", () => {
  const detour = decodeRoadGraph({
    nodes: [0, 0, 200, 0, 400, 0, 600, 0],
    edges: [
      0, 1, 0, -1, 0, 200, 1, 2, 0, -1, 0, 200, 2, 3, 0, -1, 0, 200, 0, 2, 0,
      -1, 0, 1200,
    ],
    classes: ["residential"],
    names: [],
  });
  const path = findPath(detour, 0, 3);
  expect(path).toEqual([0, 1, 2, 3]);
  expect(pathLength(detour, path ?? [])).toBe(150);
});
```

```ts
// src/lib/cityArena/world/pavements.test.ts
import { describe, expect, it } from "vitest";
import type { RailPosition } from "../sim/types";
import type { MapRoads } from "./mapTypes";
import {
  advanceRail,
  edgeLengthM,
  isPavementEdge,
  kerbOffsetM,
  nearestRail,
  nextPavementEdge,
  pavementEdgesWithin,
  pavementOffsetM,
  railHeading,
  railPoint,
  randomRail,
} from "./pavements";
import { decodeRoadGraph } from "./roadGraph";

/** A 100 m residential square 0-1-2-3-0 (edges 0..3) plus a service spur 1-4 east (edge 4). */
const square: MapRoads = {
  nodes: [0, 0, 400, 0, 400, 400, 0, 400, 800, 0],
  edges: [
    0, 1, 0, -1, 0, 400, 1, 2, 0, -1, 0, 400, 2, 3, 0, -1, 0, 400, 3, 0, 0, -1,
    0, 400, 1, 4, 1, -1, 0, 400,
  ],
  classes: ["residential", "service"],
  names: [],
};
const graph = decodeRoadGraph(square);
/** One lone residential edge 0-1 of 100 m. */
const single = decodeRoadGraph({
  nodes: [0, 0, 400, 0],
  edges: [0, 1, 0, -1, 0, 400],
  classes: ["residential"],
  names: [],
});
const east: RailPosition = { edge: 0, direction: 1, edgeT: 0.25, side: 1 };

describe("pavement offsets", () => {
  it("derives the pavement centre and the kerb from the renderer's road widths", () => {
    expect(pavementOffsetM("residential")).toBe(4);
    expect(pavementOffsetM("living_street")).toBe(3.5);
    expect(pavementOffsetM("primary")).toBe(5.5);
    expect(kerbOffsetM("residential")).toBeCloseTo(3.3);
    expect(kerbOffsetM("service")).toBeCloseTo(2.3);
    expect(isPavementEdge(graph.edges[0])).toBe(true);
    expect(isPavementEdge(graph.edges[4])).toBe(false);
    expect(edgeLengthM(graph, 1)).toBe(100);
  });
});

describe("rails", () => {
  it("places a rail point on the right or left pavement in the walking direction", () => {
    expect(railPoint(graph, east, 4)).toEqual([25, 4]);
    expect(railPoint(graph, { ...east, side: -1 }, 4)).toEqual([25, -4]);
    const west = railPoint(graph, { ...east, direction: -1 }, 4);
    expect(west[0]).toBeCloseTo(75);
    expect(west[1]).toBeCloseTo(-4);
    expect(railHeading(graph, east)).toBe(0);
    expect(railHeading(graph, { ...east, direction: -1 })).toBeCloseTo(Math.PI);
  });

  it("advances along the edge and turns onto a pavement edge at the end", () => {
    const walked = advanceRail(graph, east, 30, () => 0);
    expect(walked).toMatchObject({ edge: 0, direction: 1, side: 1 });
    expect(walked.edgeT).toBeCloseTo(0.55);
    const turned = advanceRail(graph, east, 80, () => 0);
    expect(turned).toMatchObject({ edge: 1, direction: 1, side: 1 });
    expect(turned.edgeT).toBeCloseTo(0.05);
  });

  it("turns around at a dead end and picks the next pavement edge with the seed", () => {
    const nearEnd: RailPosition = {
      edge: 0,
      direction: 1,
      edgeT: 0.9,
      side: 1,
    };
    const back = advanceRail(single, nearEnd, 20, () => 0);
    expect(back).toMatchObject({ edge: 0, direction: -1, side: 1 });
    expect(back.edgeT).toBeCloseTo(0.1);
    expect(nextPavementEdge(graph, 1, 0, () => 0)).toBe(1);
    expect(nextPavementEdge(graph, 0, 0, () => 0.99)).toBe(3);
    expect(nextPavementEdge(single, 1, 0, () => 0)).toBe(0);
    expect(nextPavementEdge(graph, 4, 4, () => 0)).toBeNull();
  });

  it("lists pavement edges around a point and draws a seeded rail on them", () => {
    expect(pavementEdgesWithin(graph, [50, 50], 60)).toEqual([0, 1, 2, 3]);
    expect(pavementEdgesWithin(graph, [50, 50], 40)).toEqual([]);
    expect(randomRail(graph, [0, 1, 2, 3], () => 0.5)).toEqual({
      edge: 2,
      direction: 1,
      edgeT: 0.5,
      side: 1,
    });
  });

  it("projects a point onto the nearest pavement edge, keeping its side", () => {
    const eastbound = nearestRail(graph, [30, 6], 60, () => 0.9);
    expect(eastbound).toMatchObject({ edge: 0, direction: 1, side: 1 });
    expect(eastbound?.edgeT).toBeCloseTo(0.3);
    const westbound = nearestRail(graph, [30, 6], 60, () => 0);
    expect(westbound).toMatchObject({ edge: 0, direction: -1, side: -1 });
    expect(westbound?.edgeT).toBeCloseTo(0.7);
    expect(nearestRail(graph, [500, 500], 60, () => 0)).toBeNull();
    expect(nearestRail(graph, [200, 1], 60, () => 0)).toBeNull();
  });
});
```

```ts
// src/lib/cityArena/world/pathFollow.test.ts
import { describe, expect, it } from "vitest";
import { moveToward, nextWaypoint, pathTo } from "./pathFollow";
import { decodeRoadGraph } from "./roadGraph";

const graph = decodeRoadGraph({
  nodes: [0, 0, 400, 0, 400, 400, 0, 400],
  edges: [
    0, 1, 0, -1, 0, 400, 1, 2, 0, -1, 0, 400, 2, 3, 0, -1, 0, 400, 3, 0, 0, -1,
    0, 400,
  ],
  classes: ["residential"],
  names: [],
});

describe("pathFollow", () => {
  it("drops reached nodes and targets the next one", () => {
    expect(nextWaypoint(graph, [0, 1, 2], [1, 0], 2)).toEqual({
      path: [1, 2],
      target: [100, 0],
    });
    expect(nextWaypoint(graph, [0], [0, 0], 2)).toEqual({
      path: [],
      target: null,
    });
    expect(nextWaypoint(graph, [], [0, 0], 2)).toEqual({
      path: [],
      target: null,
    });
  });

  it("routes between the nodes nearest two points", () => {
    const path = pathTo(graph, [1, 1], [99, 101], 60);
    expect(path).toHaveLength(3);
    expect(path?.[0]).toBe(0);
    expect(path?.at(-1)).toBe(2);
    expect(pathTo(graph, [500, 500], [0, 0], 60)).toBeNull();
  });

  it("steps toward a target without overshooting it", () => {
    expect(moveToward([0, 0], [10, 0], 3)).toEqual([3, 0]);
    expect(moveToward([0, 0], [1, 0], 3)).toEqual([1, 0]);
    expect(moveToward([4, 4], [4, 4], 3)).toEqual([4, 4]);
  });
});
```

Append to `src/lib/cityArena/mapBuild/geometry.test.ts` (add `pointInRect` to the `./geometry` import):

```ts
describe("pointInRect", () => {
  it("treats the edges as inside", () => {
    const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(pointInRect([5, 5], rect)).toBe(true);
    expect(pointInRect([10, 10], rect)).toBe(true);
    expect(pointInRect([11, 5], rect)).toBe(false);
    expect(pointInRect([5, -1], rect)).toBe(false);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/world src/lib/cityArena/mapBuild/geometry.test.ts`
Expected: FAIL — `./binaryHeap`, `./pavements`, `./pathFollow` not found; `pointInRect` is not exported (the lattice test passes on the old linear-scan A\* — it is a regression guard for Step 3).

- [x] **Step 3: Implement the heap and put `findPath` on it**

```ts
// src/lib/cityArena/world/binaryHeap.ts
/** A min-heap keyed by a numeric priority. */
export type BinaryHeap<T> = {
  push(item: T, priority: number): void;
  pop(): T | null;
  size(): number;
};

/** Swaps two slots of the parallel item/priority arrays. */
function swap<T>(
  items: T[],
  priorities: number[],
  first: number,
  second: number,
): void {
  [items[first], items[second]] = [items[second], items[first]];
  [priorities[first], priorities[second]] = [
    priorities[second],
    priorities[first],
  ];
}

/** Moves the item at `index` up until its parent has a smaller or equal priority. */
function siftUp<T>(items: T[], priorities: number[], index: number): void {
  let current = index;
  while (current > 0) {
    const parent = (current - 1) >> 1;
    if (priorities[parent] <= priorities[current]) return;
    swap(items, priorities, parent, current);
    current = parent;
  }
}

/** Moves the item at `index` down until both children have larger or equal priorities. */
function siftDown<T>(items: T[], priorities: number[], index: number): void {
  let current = index;
  for (;;) {
    const left = 2 * current + 1;
    const right = left + 1;
    let smallest = current;
    if (left < items.length && priorities[left] < priorities[smallest])
      smallest = left;
    if (right < items.length && priorities[right] < priorities[smallest])
      smallest = right;
    if (smallest === current) return;
    swap(items, priorities, smallest, current);
    current = smallest;
  }
}

/** Creates an empty min-heap. */
export function createBinaryHeap<T>(): BinaryHeap<T> {
  const items: T[] = [];
  const priorities: number[] = [];
  return {
    push(item, priority) {
      items.push(item);
      priorities.push(priority);
      siftUp(items, priorities, items.length - 1);
    },
    pop() {
      if (items.length === 0) return null;
      const top = items[0];
      const last = items.length - 1;
      items[0] = items[last];
      priorities[0] = priorities[last];
      items.pop();
      priorities.pop();
      if (items.length > 0) siftDown(items, priorities, 0);
      return top;
    },
    size: () => items.length,
  };
}
```

In `src/lib/cityArena/world/roadGraph.ts` add `import { createBinaryHeap, type BinaryHeap } from "./binaryHeap";` and replace `findPath` (keep `reconstruct` and `pathLength` as they are):

```ts
/** Search options: honour one-way edges, and/or skip edges the predicate rejects (AI cars keep off service and pedestrian roads). */
export type PathOptions = {
  respectOneway?: boolean;
  allowEdge?: (edge: RoadGraphEdge) => boolean;
};

/** Bookkeeping of one A* run. */
type Search = {
  open: BinaryHeap<number>;
  cameFrom: Map<number, number>;
  bestCost: Map<number, number>;
  closed: Set<number>;
};

/** Relaxes every edge out of `current`, pushing improved neighbours onto the open heap. */
function relaxNeighbours(
  graph: RoadGraph,
  current: number,
  options: PathOptions,
  heuristic: (index: number) => number,
  search: Search,
): void {
  const currentCost = search.bestCost.get(current) ?? Infinity;
  for (const edgeIndex of graph.adjacency[current]) {
    const edge = graph.edges[edgeIndex];
    const neighbour = edge.a === current ? edge.b : edge.a;
    if (options.respectOneway && edge.oneway && edge.a !== current) continue;
    if (options.allowEdge && !options.allowEdge(edge)) continue;
    if (search.closed.has(neighbour)) continue;
    const tentative = currentCost + edge.length;
    if (tentative >= (search.bestCost.get(neighbour) ?? Infinity)) continue;
    search.cameFrom.set(neighbour, current);
    search.bestCost.set(neighbour, tentative);
    search.open.push(neighbour, tentative + heuristic(neighbour));
  }
}

/**
 * A* over the graph with a binary-heap open set (stale heap entries are skipped once a node is
 * closed). By default one-way flags are ignored (pedestrians and cops may walk both ways); pass
 * `{ respectOneway: true }` to restrict traversal to the defined direction and `allowEdge` to
 * keep the route on a subset of road classes.
 */
export function findPath(
  graph: RoadGraph,
  from: number,
  to: number,
  options: PathOptions = {},
): number[] | null {
  const heuristic = (index: number): number =>
    Math.hypot(
      graph.nodes[to][0] - graph.nodes[index][0],
      graph.nodes[to][1] - graph.nodes[index][1],
    );
  const search: Search = {
    open: createBinaryHeap<number>(),
    cameFrom: new Map<number, number>(),
    bestCost: new Map<number, number>([[from, 0]]),
    closed: new Set<number>(),
  };
  search.open.push(from, heuristic(from));
  for (
    let current = search.open.pop();
    current !== null;
    current = search.open.pop()
  ) {
    if (current === to) return reconstruct(search.cameFrom, current);
    if (search.closed.has(current)) continue;
    search.closed.add(current);
    relaxNeighbours(graph, current, options, heuristic, search);
  }
  return null;
}
```

- [x] **Step 4: Implement the pavement rails, path following and `pointInRect`**

```ts
// src/lib/cityArena/world/pavements.ts
import { distancePointToSegment } from "../mapBuild/geometry";
import { PAVEMENT_WIDTH_M, ROAD_WIDTH_M } from "../render/palette";
import type { RailPosition } from "../sim/types";
import type { RoadClass } from "./mapTypes";
import type { Point } from "./projection";
import type { RoadGraph, RoadGraphEdge } from "./roadGraph";

/** Road classes whose pavements pedestrians walk — the "residential-class" roads of spec §5. */
export const PAVEMENT_ROAD_CLASSES: RoadClass[] = [
  "residential",
  "living_street",
  "unclassified",
];
/**
 * Road classes cars are parked along: residential streets (spec §5) plus the service roads of
 * car parks, so the campus zone (which has no residential roads in the shipped map) gets parked
 * cars too. Through-roads stay clear for ambient traffic.
 */
export const PARKING_ROAD_CLASSES: RoadClass[] = ["residential", "service"];
/**
 * How far a parked car's centre sits beyond the kerb line (two wheels on the pavement): the road
 * half-width plus this clears the 1.6 m car-body circle of a car driving the centre line
 * (documented choice).
 */
export const PARKED_KERB_OVERHANG_M = 0.3;
/** Edge hops one rail advance may take (guards against chains of zero-length edges). */
const MAX_RAIL_HOPS = 4;
/** Below this random draw a coin flip lands on the negative side. */
const COIN_FLIP = 0.5;

/** The part of the road graph rails need. */
export type RailGraph = Pick<
  RoadGraph,
  "nodes" | "edges" | "adjacency" | "nearestNode"
>;

/** Distance from the road centre line to the middle of the pavement: the renderer's road half-width plus half a pavement. */
export function pavementOffsetM(roadClass: RoadClass): number {
  return ROAD_WIDTH_M[roadClass] / 2 + PAVEMENT_WIDTH_M / 2;
}

/** Distance from the road centre line to the centre of a car parked half on the kerb (residential 3.3 m, service 2.3 m). */
export function kerbOffsetM(roadClass: RoadClass): number {
  return ROAD_WIDTH_M[roadClass] / 2 + PARKED_KERB_OVERHANG_M;
}

/** True for edges of a class that has pavements. */
export function isPavementEdge(edge: RoadGraphEdge): boolean {
  return PAVEMENT_ROAD_CLASSES.includes(edge.roadClass);
}

/** Start and end node positions of a rail in its walking direction. */
export function railEnds(graph: RailGraph, rail: RailPosition): [Point, Point] {
  const edge = graph.edges[rail.edge];
  const from = rail.direction === 1 ? edge.a : edge.b;
  const to = rail.direction === 1 ? edge.b : edge.a;
  return [graph.nodes[from], graph.nodes[to]];
}

/** The node a rail walks toward. */
export function railEndNode(graph: RailGraph, rail: RailPosition): number {
  const edge = graph.edges[rail.edge];
  return rail.direction === 1 ? edge.b : edge.a;
}

/** Heading of a rail in radians. */
export function railHeading(graph: RailGraph, rail: RailPosition): number {
  const [from, to] = railEnds(graph, rail);
  return Math.atan2(to[1] - from[1], to[0] - from[0]);
}

/** Straight-line length of an edge in metres (graph edges are straight segments). */
export function edgeLengthM(graph: RailGraph, edgeIndex: number): number {
  const edge = graph.edges[edgeIndex];
  return Math.hypot(
    graph.nodes[edge.b][0] - graph.nodes[edge.a][0],
    graph.nodes[edge.b][1] - graph.nodes[edge.a][1],
  );
}

/** The position on a rail shifted `offsetM` to its side (right of travel is positive). */
export function railPoint(
  graph: RailGraph,
  rail: RailPosition,
  offsetM: number,
): Point {
  const [from, to] = railEnds(graph, rail);
  const heading = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const shift = offsetM * rail.side;
  return [
    from[0] + (to[0] - from[0]) * rail.edgeT - Math.sin(heading) * shift,
    from[1] + (to[1] - from[1]) * rail.edgeT + Math.cos(heading) * shift,
  ];
}

/** A pavement edge at `node` other than `arriving` (seeded choice); the arriving edge itself at a dead end; `null` when no pavement edge meets there. */
export function nextPavementEdge(
  graph: RailGraph,
  node: number,
  arriving: number | null,
  random: () => number,
): number | null {
  const candidates = graph.adjacency[node].filter(
    (edgeIndex) =>
      edgeIndex !== arriving && isPavementEdge(graph.edges[edgeIndex]),
  );
  if (candidates.length > 0)
    return candidates[
      Math.min(candidates.length - 1, Math.floor(random() * candidates.length))
    ];
  return arriving !== null && isPavementEdge(graph.edges[arriving])
    ? arriving
    : null;
}

/** Walks `distanceM` along the rail, turning onto a seeded pavement edge at every node it passes. */
export function advanceRail(
  graph: RailGraph,
  rail: RailPosition,
  distanceM: number,
  random: () => number,
): RailPosition {
  let current = rail;
  let left = distanceM;
  for (let hop = 0; hop < MAX_RAIL_HOPS; hop++) {
    const length = edgeLengthM(graph, current.edge);
    const remaining = (1 - current.edgeT) * length;
    if (left < remaining)
      return { ...current, edgeT: current.edgeT + left / length };
    left -= remaining;
    const node = railEndNode(graph, current);
    const next = nextPavementEdge(graph, node, current.edge, random);
    if (next === null) return { ...current, edgeT: 1 };
    current = {
      edge: next,
      direction: graph.edges[next].a === node ? 1 : -1,
      edgeT: 0,
      side: current.side,
    };
  }
  return current;
}

/** Pavement-class edges whose midpoint lies within `radiusM` of `centre`. */
export function pavementEdgesWithin(
  graph: RailGraph,
  centre: Point,
  radiusM: number,
): number[] {
  const edges: number[] = [];
  graph.edges.forEach((edge, index) => {
    if (!isPavementEdge(edge)) return;
    const middleX = (graph.nodes[edge.a][0] + graph.nodes[edge.b][0]) / 2;
    const middleY = (graph.nodes[edge.a][1] + graph.nodes[edge.b][1]) / 2;
    if (Math.hypot(middleX - centre[0], middleY - centre[1]) <= radiusM)
      edges.push(index);
  });
  return edges;
}

/** A seeded rail somewhere on one of `edges` (which must be non-empty): edge, direction, progress, side. */
export function randomRail(
  graph: RailGraph,
  edges: number[],
  random: () => number,
): RailPosition {
  const edge =
    edges[Math.min(edges.length - 1, Math.floor(random() * edges.length))];
  const direction = random() < COIN_FLIP ? -1 : 1;
  const edgeT = random();
  const side = random() < COIN_FLIP ? -1 : 1;
  return { edge, direction, edgeT, side };
}

/** Clamped projection parameter of `point` onto the segment start→end. */
function projectT(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return 0;
  const t =
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
  return Math.max(0, Math.min(1, t));
}

/** Which side of the directed segment the point lies on: right of travel is 1 (on the line counts as right). */
function sideOf(point: Point, start: Point, end: Point): 1 | -1 {
  const cross =
    (end[0] - start[0]) * (point[1] - start[1]) -
    (end[1] - start[1]) * (point[0] - start[0]);
  return cross < 0 ? -1 : 1;
}

/** The pavement edge at `node` whose segment lies closest to `point`, or `null` when the node has none. */
function closestPavementEdgeAt(
  graph: RailGraph,
  node: number,
  point: Point,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const edgeIndex of graph.adjacency[node]) {
    const edge = graph.edges[edgeIndex];
    if (!isPavementEdge(edge)) continue;
    const distance = distancePointToSegment(
      point,
      graph.nodes[edge.a],
      graph.nodes[edge.b],
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = edgeIndex;
    }
  }
  return best;
}

/** The rail on the pavement edge nearest to `point` (through the nearest node within `maxDistanceM`), projected onto it with a seeded direction and the point's own side; `null` when no pavement is near. */
export function nearestRail(
  graph: RailGraph,
  point: Point,
  maxDistanceM: number,
  random: () => number,
): RailPosition | null {
  const node = graph.nearestNode(point, maxDistanceM);
  if (node === null) return null;
  const edge = closestPavementEdgeAt(graph, node, point);
  if (edge === null) return null;
  const direction = random() < COIN_FLIP ? -1 : 1;
  const [start, end] = railEnds(graph, { edge, direction, edgeT: 0, side: 1 });
  return {
    edge,
    direction,
    edgeT: projectT(point, start, end),
    side: sideOf(point, start, end),
  };
}
```

```ts
// src/lib/cityArena/world/pathFollow.ts
import type { Point } from "./projection";
import { findPath, type RoadGraph } from "./roadGraph";

/** A path being walked and the point to head for next. */
export type PathProgress = { path: number[]; target: Point | null };

/** Drops the leading nodes already within `reachM` of `position`; the target is the first remaining node's position. */
export function nextWaypoint(
  graph: Pick<RoadGraph, "nodes">,
  path: number[],
  position: Point,
  reachM: number,
): PathProgress {
  let start = 0;
  while (
    start < path.length &&
    Math.hypot(
      graph.nodes[path[start]][0] - position[0],
      graph.nodes[path[start]][1] - position[1],
    ) <= reachM
  )
    start += 1;
  const remaining = start === 0 ? path : path.slice(start);
  return {
    path: remaining,
    target: remaining.length > 0 ? graph.nodes[remaining[0]] : null,
  };
}

/** Node path from the graph node nearest `from` to the one nearest `to` (both within `snapM`), or `null`. */
export function pathTo(
  graph: RoadGraph,
  from: Point,
  to: Point,
  snapM: number,
  options: PathOptions = {},
): number[] | null {
  const start = graph.nearestNode(from, snapM);
  const goal = graph.nearestNode(to, snapM);
  if (start === null || goal === null) return null;
  return findPath(graph, start, goal, options);
}

/** `position` moved `distanceM` toward `target`, landing on it rather than overshooting. */
export function moveToward(
  position: Point,
  target: Point,
  distanceM: number,
): Point {
  const dx = target[0] - position[0];
  const dy = target[1] - position[1];
  const distance = Math.hypot(dx, dy);
  if (distance <= distanceM || distance === 0) return [target[0], target[1]];
  return [
    position[0] + (dx / distance) * distanceM,
    position[1] + (dy / distance) * distanceM,
  ];
}
```

Append to `src/lib/cityArena/mapBuild/geometry.ts` (after `rectsIntersect`):

```ts
/** True when `point` lies inside `rect` (edges inclusive). */
export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point[0] >= rect.minX &&
    point[0] <= rect.maxX &&
    point[1] >= rect.minY &&
    point[1] <= rect.maxY
  );
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/world src/lib/cityArena/mapBuild src/components/cityArena/useArenaGame.test.tsx`
Expected: PASS — binaryHeap 2, roadGraph 5 + 6 + 2, pavements 6, pathFollow 3, geometry (existing + 1), and the hook suite (its debug route length still uses `findPath`). Worked numbers: residential pavement centre 6/2 + 2/2 = 4 m, kerb 3 + 0.3 = 3.3 m (service 2 + 0.3 = 2.3 m); the fixture's only route from node 0 to node 4 uses the service spur 1–4, so rejecting service edges makes it unreachable while 0 → 2 still runs over the residential square; eastbound heading 0 has its right side at +y, so `railPoint` with side 1 lands at (25, 4) and the westbound rail (heading π, right side −y) at (75, −4); advancing 80 m from t = 0.25 leaves 5 m after the 75 m to node 1, and at node 1 the only pavement edge other than edge 0 is edge 1 (the spur is `service`), whose `a` is node 1, so the new rail runs a→b with t = 5/100; for the point (30, 6) the cross product of the eastbound segment (100, 0) with (30, 6) is +600 (right side), and the westbound projection is 0.7 from (100, 0) on the left side; the lattice's corner-to-corner path takes 38 hops of 10 m.

- [x] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/world src/lib/cityArena/mapBuild/geometry.ts src/lib/cityArena/mapBuild/geometry.test.ts
git add src/lib/cityArena/world src/lib/cityArena/mapBuild/geometry.ts src/lib/cityArena/mapBuild/geometry.test.ts
git commit -m "feat(arena): heap-backed A*, pavement rails and path following

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Pickups — placement, taking, respawn and the active-zone population seam

**Files:**

- Create: `src/lib/cityArena/sim/pickups.ts`
- Create: `src/lib/cityArena/sim/populate.ts`
- Modify: `src/lib/cityArena/sim/spawn.ts` (export `farFromAll`)
- Modify: `src/lib/cityArena/sim/arena.ts` (`createArenaState`, `stepArena`)
- Test: `src/lib/cityArena/sim/pickups.test.ts`, `src/lib/cityArena/sim/populate.test.ts`, `src/lib/cityArena/sim/arena.test.ts` (extend)

**Interfaces:**

- Consumes: `PickupKind`, `PickupState`, `ArenaPlayerState`, `ArenaState` (Task 1); `MAX_AMMO`, `addAmmo` (Task 1); `pushEvent` (Task 1); `playersOf`, `replacePlayer` (Task 1); `PLAYER_MAX_HEALTH`, `isDead` (`./damage`); `shuffle`, `nearestZone`, `SpawnGraph` (`./spawn`); `landmarkCentreMetres` (`../world/zone`); `fromUnits`, `Point`; `MapIndex`, `MapZone`; `RoadGraph`; `Rect`.
- Produces: `WEAPON_PICKUPS_PER_ZONE = 6`, `LANDMARK_WEAPON_PICKUPS = 4`, `HEALTH_PICKUPS_PER_ZONE = 4`, `PICKUP_TAKE_RANGE_M = 1.2`, `PICKUP_RESPAWN_TICKS = 600`, `HEALTH_PICKUP_AMOUNT = 50`, `PICKUP_ROUNDS = { uzi: 60, shotgun: 8 }`, `MIN_PICKUP_TO_PLAYER_M = 8`, `PickupGraph = Pick<RoadGraph, "nodes" | "nearestNode">`, `isPickupActive(pickup): boolean`, `canTakePickup(player, pickup): boolean`, `applyPickupToPlayer(player, pickup): ArenaPlayerState`, `placePickups(index, zone, graph, random, avoid: Point[], firstId): PickupState[]`, `stepPickups(state, tick): ArenaState`; `farFromAll(point, others, minimum): boolean` (now exported from `spawn.ts`); `PopulationWorld = { index: MapIndex; graph: SpawnGraph; viewRect?: Rect }`, `populateZone(state, zone, index, graph, random): ArenaState`, `applyPopulation(state, world, random): ArenaState`.

- [x] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/sim/pickups.test.ts
import { describe, expect, it } from "vitest";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import {
  applyPickupToPlayer,
  canTakePickup,
  placePickups,
  stepPickups,
} from "./pickups";
import { createRng } from "./rng";
import type { ArenaState, PickupState } from "./types";

/** Spawn nodes every 50 m from 0 to 350 m along y = 0; landmarks on the 50 m and 250 m nodes. */
const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [700, 0],
  radius: 2000,
  spawnNodes: Array.from({ length: 8 }, (_, index): [number, number] => [
    index * 200,
    0,
  ]),
  landmarks: ["kerk", "cafe"],
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [zone],
  landmarks: [
    {
      key: "kerk",
      name: "Kerk",
      style: "church",
      center: [200, 0],
      tile: { x: 0, y: 0 },
    },
    {
      key: "cafe",
      name: "Café",
      style: "cafe",
      center: [1000, 0],
      tile: { x: 0, y: 0 },
    },
  ],
};
/** Road nodes on the same eight spots, joined by residential edges. */
const graph = decodeRoadGraph({
  nodes: zone.spawnNodes.flat(),
  edges: Array.from({ length: 7 }, (_, edge) => [
    edge,
    edge + 1,
    0,
    -1,
    0,
    200,
  ]).flat(),
  classes: ["residential"],
  names: [],
});
const emptyIndex: MapIndex = { ...index, zones: [], landmarks: [] };

function pickupAt(kind: PickupState["kind"], x: number): PickupState {
  return { id: 900, kind, x, y: 0, takenAtTick: null };
}

/** A state with nothing populated and the player at the map origin. */
function lonePlayer(): ArenaState {
  return createArenaState(
    { index: emptyIndex, graph, seed: 3, zone: null },
    createRng(3),
  );
}

describe("placePickups", () => {
  it("puts weapons on the landmarks first, alternates the kinds and fills health spots from the nodes", () => {
    const pickups = placePickups(index, zone, graph, createRng(7), [], 100);
    expect(pickups).toHaveLength(8);
    expect(pickups.map((pickup) => pickup.kind)).toEqual([
      "uzi",
      "shotgun",
      "uzi",
      "shotgun",
      "uzi",
      "shotgun",
      "health",
      "health",
    ]);
    expect(pickups.map((pickup) => pickup.id)).toEqual([
      100, 101, 102, 103, 104, 105, 106, 107,
    ]);
    expect(pickups[0]).toMatchObject({ x: 50, y: 0, takenAtTick: null });
    expect(pickups[1]).toMatchObject({ x: 250, y: 0 });
    const xs = pickups.map((pickup) => pickup.x);
    expect(new Set(xs).size).toBe(8);
    for (const x of xs) expect(x % 50).toBe(0);
    expect(placePickups(index, zone, graph, createRng(7), [], 100)).toEqual(
      pickups,
    );
  });

  it("keeps pickups off the player's spawn and copes with few nodes", () => {
    const avoided = placePickups(
      index,
      zone,
      graph,
      createRng(7),
      [[100, 0]],
      1,
    );
    expect(avoided).toHaveLength(7);
    expect(avoided.some((pickup) => pickup.x === 100)).toBe(false);
    const fourNodes: MapZone = {
      ...zone,
      landmarks: [],
      spawnNodes: zone.spawnNodes.slice(0, 4),
    };
    const few = placePickups(index, fourNodes, graph, createRng(1), [], 1);
    expect(few.map((pickup) => pickup.kind)).toEqual([
      "uzi",
      "shotgun",
      "uzi",
      "shotgun",
    ]);
  });
});

describe("taking pickups", () => {
  it("only helps when it changes something and arms a magazine weapon over the fist or pistol", () => {
    const { player } = lonePlayer();
    expect(canTakePickup(player, pickupAt("uzi", 0))).toBe(true);
    expect(canTakePickup(player, pickupAt("health", 0))).toBe(false);
    expect(
      canTakePickup(
        { ...player, ammo: { uzi: 120, shotgun: 0 } },
        pickupAt("uzi", 0),
      ),
    ).toBe(false);
    const armed = applyPickupToPlayer(player, pickupAt("shotgun", 0));
    expect(armed).toMatchObject({
      weapon: "shotgun",
      ammo: { uzi: 0, shotgun: 8 },
    });
    const kept = applyPickupToPlayer(
      { ...armed, weapon: "shotgun" },
      pickupAt("uzi", 0),
    );
    expect(kept).toMatchObject({
      weapon: "shotgun",
      ammo: { uzi: 60, shotgun: 8 },
    });
    expect(
      applyPickupToPlayer({ ...player, health: 30 }, pickupAt("health", 0))
        .health,
    ).toBe(80);
  });

  it("takes an active pickup within 1.2 m on foot, records the event and respawns it after 600 ticks", () => {
    const state: ArenaState = {
      ...lonePlayer(),
      pickups: [pickupAt("uzi", 0.5)],
    };
    const taken = stepPickups(state, 5);
    expect(taken.player).toMatchObject({
      weapon: "uzi",
      ammo: { uzi: 60, shotgun: 0 },
    });
    expect(taken.pickups[0].takenAtTick).toBe(5);
    expect(taken.events).toEqual([
      { kind: "pickup", pickupKind: "uzi", playerId: 0, x: 0.5, y: 0 },
    ]);
    const away = { ...taken, player: { ...taken.player, x: 50 } };
    expect(stepPickups(away, 604).pickups[0].takenAtTick).toBe(5);
    expect(stepPickups(away, 605).pickups[0].takenAtTick).toBeNull();
  });

  it("ignores pickups out of reach, from a car, while dead or when full", () => {
    const base = lonePlayer();
    const far: ArenaState = { ...base, pickups: [pickupAt("uzi", 1.3)] };
    expect(stepPickups(far, 1).player.ammo.uzi).toBe(0);
    const seated: ArenaState = {
      ...base,
      pickups: [pickupAt("uzi", 0.5)],
      player: { ...base.player, vehicleId: 4 },
    };
    expect(stepPickups(seated, 1).pickups[0].takenAtTick).toBeNull();
    const dead: ArenaState = {
      ...base,
      pickups: [pickupAt("health", 0.5)],
      player: { ...base.player, health: 0, diedAtTick: 0 },
    };
    expect(stepPickups(dead, 1).player.health).toBe(0);
    const full: ArenaState = { ...base, pickups: [pickupAt("health", 0.5)] };
    expect(stepPickups(full, 1).pickups[0].takenAtTick).toBeNull();
    expect(stepPickups(full, 1).events).toEqual([]);
  });
});
```

```ts
// src/lib/cityArena/sim/populate.test.ts
import { describe, expect, it } from "vitest";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import { applyPopulation, populateZone } from "./populate";
import { createRng } from "./rng";

/** Two zones 3 km apart with three spawn nodes each. */
const west: MapZone = {
  key: "wageningen",
  name: "Wageningen centrum",
  center: [0, 0],
  radius: 2000,
  spawnNodes: [
    [0, 0],
    [400, 0],
    [800, 0],
  ],
  landmarks: [],
};
const east: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [12000, 0],
  radius: 2000,
  spawnNodes: [
    [12000, 0],
    [12400, 0],
    [12800, 0],
  ],
  landmarks: [],
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [west, east],
  landmarks: [],
};
const graph = decodeRoadGraph({
  nodes: [0, 0, 800, 0, 12000, 0, 12800, 0],
  edges: [0, 1, 0, -1, 0, 800, 2, 3, 0, -1, 0, 800],
  classes: ["residential"],
  names: [],
});

describe("population", () => {
  it("populates the start zone and re-populates when the player moves to another zone", () => {
    const state = createArenaState(
      { index, graph, seed: 5, zone: west },
      createRng(5),
    );
    expect(state.activeZoneKey).toBe("wageningen");
    expect(state.pickups).toHaveLength(2);
    for (const pickup of state.pickups) expect(pickup.x).toBeLessThan(1000);
    const random = createRng(9);
    expect(applyPopulation(state, { index, graph }, random)).toBe(state);
    const moved = { ...state, player: { ...state.player, x: 3050, y: 0 } };
    const repopulated = applyPopulation(moved, { index, graph }, random);
    expect(repopulated.activeZoneKey).toBe("campus");
    expect(repopulated.pickups).toHaveLength(3);
    for (const pickup of repopulated.pickups)
      expect(pickup.x).toBeGreaterThanOrEqual(3000);
    expect(repopulated.nextId).toBe(state.nextId + 3);
  });

  it("keeps the player's car when a zone is repopulated", () => {
    const state = createArenaState(
      { index, graph, seed: 5, zone: west },
      createRng(5),
    );
    const car = state.vehicles[0];
    const seated = { ...state, player: { ...state.player, vehicleId: car.id } };
    const repopulated = populateZone(seated, east, index, graph, createRng(2));
    expect(repopulated.vehicles.map((vehicle) => vehicle.id)).toContain(car.id);
    expect(repopulated.activeZoneKey).toBe("campus");
  });
});
```

Extend `src/lib/cityArena/sim/arena.test.ts`:

1. In "spawns the player on a spawn node with the loadout …" drop `pickups: [],` from the `toMatchObject` that Task 1 added, and replace `expect(state.nextId).toBe(1 + state.vehicles.length);` with:

```ts
expect(state.pickups.map((pickup) => pickup.kind)).toEqual([
  "uzi",
  "shotgun",
  "uzi",
]);
for (const pickup of state.pickups)
  expect(Math.abs(pickup.x - state.player.x)).toBeGreaterThanOrEqual(8);
expect(state.nextId).toBe(1 + state.vehicles.length + state.pickups.length);
```

2. Append a new describe:

```ts
describe("stepArena pickups", () => {
  it("takes a pickup on the way past and respawns it 600 ticks later", () => {
    const state = boot();
    const [pickup] = state.pickups;
    const beside: ArenaState = {
      ...state,
      player: { ...state.player, x: pickup.x + 0.5, y: pickup.y },
    };
    const taken = run(beside, EMPTY_INPUT, 1);
    expect(taken.player.ammo.uzi).toBe(60);
    expect(taken.player.weapon).toBe("uzi");
    expect(taken.pickups[0].takenAtTick).toBe(1);
    expect(taken.events).toEqual([
      {
        kind: "pickup",
        pickupKind: "uzi",
        playerId: 0,
        x: pickup.x,
        y: pickup.y,
      },
    ]);
    const away: ArenaState = {
      ...taken,
      player: { ...taken.player, x: pickup.x + 50 },
    };
    expect(run(away, EMPTY_INPUT, 599).pickups[0].takenAtTick).toBe(1);
    expect(run(away, EMPTY_INPUT, 600).pickups[0].takenAtTick).toBeNull();
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim/pickups.test.ts src/lib/cityArena/sim/populate.test.ts src/lib/cityArena/sim/arena.test.ts`
Expected: FAIL — `./pickups` and `./populate` not found; `state.pickups` is empty after `createArenaState`.

- [x] **Step 3: Implement pickups.ts and export `farFromAll`**

In `src/lib/cityArena/sim/spawn.ts` change the private helper to an export (its body stays):

```ts
/** True when `point` is at least `minimum` metres from every point in `others`. */
export function farFromAll(
  point: Point,
  others: Point[],
  minimum: number,
): boolean {
  return others.every(
    (other) => Math.hypot(other[0] - point[0], other[1] - point[1]) >= minimum,
  );
}
```

```ts
// src/lib/cityArena/sim/pickups.ts
import type { MapIndex, MapZone } from "../world/mapTypes";
import { fromUnits, type Point } from "../world/projection";
import type { RoadGraph } from "../world/roadGraph";
import { landmarkCentreMetres } from "../world/zone";
import { PLAYER_MAX_HEALTH, isDead } from "./damage";
import { pushEvent } from "./events";
import { playersOf, replacePlayer } from "./players";
import { farFromAll, shuffle } from "./spawn";
import type {
  ArenaPlayerState,
  ArenaState,
  PickupKind,
  PickupState,
} from "./types";
import { MAX_AMMO, addAmmo } from "./weapons";

/** Weapon pickup spots per zone (spec §5). */
export const WEAPON_PICKUPS_PER_ZONE = 6;
/** Weapon spots placed at landmarks before the seeded spawn nodes (spec §5: up to 4). */
export const LANDMARK_WEAPON_PICKUPS = 4;
/** Health pickup spots per zone (spec §5). */
export const HEALTH_PICKUPS_PER_ZONE = 4;
/** Distance from the player's centre within which a pickup is taken. */
export const PICKUP_TAKE_RANGE_M = 1.2;
/** Ticks a taken pickup stays away (spec §5: 20 s). */
export const PICKUP_RESPAWN_TICKS = 600;
/** Health restored by a health pickup (spec §5). */
export const HEALTH_PICKUP_AMOUNT = 50;
/** Rounds granted per weapon pickup (spec §5: one magazine). */
export const PICKUP_ROUNDS: Record<"uzi" | "shotgun", number> = {
  uzi: 60,
  shotgun: 8,
};
/** Pickups keep this distance from the player's spawn so a fresh spawn never lands on one. */
export const MIN_PICKUP_TO_PLAYER_M = 8;
/** Landmark pickups snap to the nearest road node within this distance so they never sit inside the building. */
const LANDMARK_SNAP_M = 80;
/** Minimum distance between two pickups. */
const MIN_PICKUP_SPACING_M = 15;
/** Weapon kinds in placement order (alternating). */
const WEAPON_KINDS: PickupKind[] = ["uzi", "shotgun"];

/** The part of the road graph pickup placement reads. */
export type PickupGraph = Pick<RoadGraph, "nodes" | "nearestNode">;

/** True while the pickup can be taken. */
export function isPickupActive(pickup: PickupState): boolean {
  return pickup.takenAtTick === null;
}

/** True when the pickup would change something: health below full, or ammo below the cap. */
export function canTakePickup(
  player: ArenaPlayerState,
  pickup: PickupState,
): boolean {
  if (pickup.kind === "health") return player.health < PLAYER_MAX_HEALTH;
  return player.ammo[pickup.kind] < MAX_AMMO[pickup.kind];
}

/** The player after a pickup: +50 health, or a magazine of rounds that arms the weapon when the player holds the fist or pistol. */
export function applyPickupToPlayer(
  player: ArenaPlayerState,
  pickup: PickupState,
): ArenaPlayerState {
  if (pickup.kind === "health")
    return {
      ...player,
      health: Math.min(PLAYER_MAX_HEALTH, player.health + HEALTH_PICKUP_AMOUNT),
    };
  const ammo = addAmmo(player.ammo, pickup.kind, PICKUP_ROUNDS[pickup.kind]);
  const rearm = player.weapon === "fist" || player.weapon === "pistol";
  return { ...player, ammo, weapon: rearm ? pickup.kind : player.weapon };
}

/** The zone's landmark centres snapped to the nearest road node (≤ 80 m), at most four, in the zone's own order. */
function landmarkSpots(
  index: MapIndex,
  zone: MapZone,
  graph: PickupGraph,
): Point[] {
  const spots: Point[] = [];
  for (const key of zone.landmarks) {
    const landmark = index.landmarks.find((candidate) => candidate.key === key);
    if (!landmark) continue;
    const centre = landmarkCentreMetres(landmark);
    const node = graph.nearestNode(centre, LANDMARK_SNAP_M);
    spots.push(node === null ? centre : graph.nodes[node]);
  }
  return spots.slice(0, LANDMARK_WEAPON_PICKUPS);
}

/** Up to `count` candidates in order, each ≥ 15 m from `placed`, the avoid points and each other. */
function takeSpaced(
  candidates: Point[],
  placed: Point[],
  avoid: Point[],
  count: number,
): Point[] {
  const chosen: Point[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= count) break;
    if (!farFromAll(candidate, avoid, MIN_PICKUP_TO_PLAYER_M)) continue;
    if (!farFromAll(candidate, [...placed, ...chosen], MIN_PICKUP_SPACING_M))
      continue;
    chosen.push(candidate);
  }
  return chosen;
}

/** Spec §5 placement for one zone: 6 weapon spots (landmarks first, then seeded spawn nodes; alternating Uzi/Shotgun) and 4 health spots on seeded spawn nodes, all away from `avoid`. */
export function placePickups(
  index: MapIndex,
  zone: MapZone,
  graph: PickupGraph,
  random: () => number,
  avoid: Point[],
  firstId: number,
): PickupState[] {
  const nodes = shuffle(
    zone.spawnNodes.map(([x, y]): Point => [fromUnits(x), fromUnits(y)]),
    random,
  );
  const landmarks = takeSpaced(
    landmarkSpots(index, zone, graph),
    [],
    avoid,
    LANDMARK_WEAPON_PICKUPS,
  );
  const weaponSpots = [
    ...landmarks,
    ...takeSpaced(
      nodes,
      landmarks,
      avoid,
      WEAPON_PICKUPS_PER_ZONE - landmarks.length,
    ),
  ];
  const healthSpots = takeSpaced(
    nodes,
    weaponSpots,
    avoid,
    HEALTH_PICKUPS_PER_ZONE,
  );
  const weapons: PickupState[] = weaponSpots.map((point, offset) => ({
    id: firstId + offset,
    kind: WEAPON_KINDS[offset % WEAPON_KINDS.length],
    x: point[0],
    y: point[1],
    takenAtTick: null,
  }));
  const health: PickupState[] = healthSpots.map((point, offset) => ({
    id: firstId + weapons.length + offset,
    kind: "health",
    x: point[0],
    y: point[1],
    takenAtTick: null,
  }));
  return [...weapons, ...health];
}

/** A taken pickup becomes active again once its 600 ticks are up. */
function respawnPickup(pickup: PickupState, tick: number): PickupState {
  if (
    pickup.takenAtTick === null ||
    tick - pickup.takenAtTick < PICKUP_RESPAWN_TICKS
  )
    return pickup;
  return { ...pickup, takenAtTick: null };
}

/** The first living player on foot within reach whom the pickup helps, or `null`. */
function findTaker(
  state: ArenaState,
  pickup: PickupState,
): ArenaPlayerState | null {
  for (const player of playersOf(state)) {
    if (isDead(player) || player.vehicleId !== null) continue;
    if (
      Math.hypot(player.x - pickup.x, player.y - pickup.y) > PICKUP_TAKE_RANGE_M
    )
      continue;
    if (canTakePickup(player, pickup)) return player;
  }
  return null;
}

/** Respawns pickups whose time is up, then hands every active pickup within 1.2 m to a living player on foot whom it helps. */
export function stepPickups(state: ArenaState, tick: number): ArenaState {
  let next = state;
  const pickups: PickupState[] = [];
  for (const pickup of state.pickups) {
    const fresh = respawnPickup(pickup, tick);
    const taker = isPickupActive(fresh) ? findTaker(next, fresh) : null;
    if (!taker) {
      pickups.push(fresh);
      continue;
    }
    next = replacePlayer(next, applyPickupToPlayer(taker, fresh));
    next = {
      ...next,
      events: pushEvent(next.events, {
        kind: "pickup",
        pickupKind: fresh.kind,
        playerId: taker.id,
        x: fresh.x,
        y: fresh.y,
      }),
    };
    pickups.push({ ...fresh, takenAtTick: tick });
  }
  return { ...next, pickups };
}
```

- [x] **Step 4: Implement populate.ts and wire both into `arena.ts`**

```ts
// src/lib/cityArena/sim/populate.ts
import type { Rect } from "../mapBuild/geometry";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { placePickups } from "./pickups";
import { playersOf } from "./players";
import { nearestZone, type SpawnGraph } from "./spawn";
import type { ArenaState } from "./types";

/** What population reads from the world. */
export type PopulationWorld = {
  index: MapIndex;
  graph: SpawnGraph;
  viewRect?: Rect;
};

/** Drops the population of the previous zone: pickups, pedestrians, cops and AI-driven cars (never the player's car). */
function clearPopulation(state: ArenaState): ArenaState {
  const driven = new Set(state.traffic.map((driver) => driver.vehicleId));
  const vehicles = state.vehicles.filter(
    (vehicle) =>
      !driven.has(vehicle.id) || vehicle.id === state.player.vehicleId,
  );
  return { ...state, vehicles, peds: [], cops: [], pickups: [], traffic: [] };
}

/** Makes `zone` the active zone: clears the old population and places the zone's pickups away from the players. */
export function populateZone(
  state: ArenaState,
  zone: MapZone,
  index: MapIndex,
  graph: SpawnGraph,
  random: () => number,
): ArenaState {
  const cleared = clearPopulation(state);
  const avoid = playersOf(cleared).map((player): [number, number] => [
    player.x,
    player.y,
  ]);
  const pickups = placePickups(
    index,
    zone,
    graph,
    random,
    avoid,
    cleared.nextId,
  );
  return {
    ...cleared,
    activeZoneKey: zone.key,
    pickups,
    nextId: cleared.nextId + pickups.length,
  };
}

/** Re-populates when the zone nearest the player is no longer the active one. */
export function applyPopulation(
  state: ArenaState,
  world: PopulationWorld,
  random: () => number,
): ArenaState {
  const [player] = playersOf(state);
  const zone = nearestZone(world.index, [player.x, player.y]);
  if (!zone || zone.key === state.activeZoneKey) return state;
  return populateZone(state, zone, world.index, world.graph, random);
}
```

In `src/lib/cityArena/sim/arena.ts` add `import { stepPickups } from "./pickups";` and `import { applyPopulation, populateZone } from "./populate";`, then replace the tail of `createArenaState` and the whole `stepArena`:

```ts
  const activeZone = setup.zone ?? nearestZone(setup.index, spawn);
  const base: ArenaState = {
    tick: 0,
    seed: setup.seed,
    nextId: FIRST_ENTITY_ID + vehicles.length,
    player: createArenaPlayer(spawn, 0),
    vehicles,
    bullets: [],
    effects: [],
    held: { enter: false, weaponNext: false },
    zoneKey: findZone(setup.index, spawn)?.key ?? null,
    peds: [],
    cops: [],
    pickups: [],
    traffic: [],
    events: [],
    activeZoneKey: null,
    zoneEnforced: false,
  };
  return activeZone
    ? populateZone(base, activeZone, setup.index, setup.graph, random)
    : base;
}
```

```ts
/** One fixed step of the arena: the single simulation entry point. */
export function stepArena(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  random: () => number,
): ArenaState {
  const tick = state.tick + 1;
  const edges = detectEdges(state.held, input);
  let next: ArenaState = { ...state, tick, held: edges.held, events: [] };
  next = applyPopulation(next, world, random);
  next = applyRespawn(next, world, tick, random);
  next = stepPickups(next, tick);
  next = applyWeaponSwitch(next, edges.weaponPressed);
  next = applyEnterExit(next, edges.enterPressed, world);
  next = moveEntities(next, input, dt, world, tick);
  next = applyFire(next, input, tick, random);
  next = advanceBullets(next, dt, world, tick);
  next = applyExplosions(next, world, tick);
  next = ejectIfDead(next, world);
  const zone = findZone(world.index, [next.player.x, next.player.y]);
  return {
    ...next,
    effects: pruneEffects(next.effects, tick),
    zoneKey: zone?.key ?? null,
  };
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run src/lib/cityArena src/components/cityArena`
Expected: `tsc` clean; PASS — pickups 5, populate 2, arena (+1), and every other suite: the hook test index has no zones (nothing is populated) and the overlay test's zones have a single spawn node under the player, which the 8 m avoid rule excludes. Worked numbers: with landmarks on the 50 m and 250 m nodes the six weapon spots are those two plus four of the six remaining nodes (all ≥ 50 m apart), leaving two nodes for health; avoiding (100, 0) drops one node so seven remain; in the arena test the zone has four nodes of which the player's is avoided, so three weapon pickups (uzi, shotgun, uzi) and no health spot exist and `nextId` counts them; the taken pickup at tick 1 is back at tick 601 (600 ticks later) but not at tick 600.

- [x] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/sim
git add src/lib/cityArena/sim
git commit -m "feat(arena): place, take and respawn weapon and health pickups

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Pedestrians — walking rails, fleeing, dying, bullets and run-overs

**Files:**

- Create: `src/lib/cityArena/sim/peds.ts`
- Create: `src/lib/cityArena/sim/hits.ts`
- Modify: `src/lib/cityArena/sim/collisions.ts` (`resolveVehicleAgainstCircle`)
- Modify: `src/lib/cityArena/sim/populate.ts` (pedestrians, top-up)
- Modify: `src/lib/cityArena/sim/arena.ts` (`advanceBullets`, `applyHit`, `explodeVehicle`, `stepArena`)
- Test: `src/lib/cityArena/sim/peds.test.ts`, `src/lib/cityArena/sim/hits.test.ts`, `src/lib/cityArena/sim/collisions.test.ts` (extend), `src/lib/cityArena/sim/populate.test.ts` (extend), `src/lib/cityArena/sim/arena.test.ts` (extend)

**Interfaces:**

- Consumes: `PedState`, `RailPosition`, `ArenaEvent`, `EffectState`, `VehicleState` (Task 1); `advanceRail`, `nearestRail`, `pavementEdgesWithin`, `pavementOffsetM`, `railHeading`, `railPoint`, `randomRail`, `RailGraph` (Task 2); `moveToward` (Task 2); `pointInRect` (Task 2); `eventsOfKind`, `pushEvent` (Task 1); `driverPlayer`, `playerById`, `playersOf` (Task 1); `farFromAll`, `nearestZone`, `SpawnGraph` (`./spawn`); `EXPLOSION_DAMAGE`, `inBlastRadius` (`./damage`); `PLAYER_RADIUS_M`; `zoneCentreMetres`, `zoneRadiusMetres`; `BulletHit`, `PlayerTarget` (`./bullets`); `MAX_PEDS` (Task 1).
- Produces: `PEDS_PER_ZONE = 25`, `PED_WALK_SPEED_MPS = 1.4`, `PED_FLEE_SPEED_MPS = 5.5`, `PED_FLEE_RADIUS_M = 25`, `PED_FLEE_TICKS = 120`, `PED_BODY_TICKS = 240`, `PED_MAX_HEALTH = 40`, `PED_RADIUS_M = 0.4`, `PED_SPAWN_MARGIN_M = 100`, `PED_SPAWN_MIN_FROM_PLAYER_M = 30`, `PED_REJOIN_SNAP_M = 60`, `PED_RESPAWN_INTERVAL_TICKS = 30`, `PED_RESPAWN_BATCH = 5`, `PedWorld = { graph: RailGraph; collision: Pick<CollisionGrid, "resolveCircle">; viewRect?: Rect }`, `createPed(id, graph, rail): PedState`, `alivePeds(peds): PedState[]`, `spawnPeds(zone, graph, random, avoid, viewRect, firstId, count): PedState[]`, `damagePed(ped, amount, tick): PedState`, `frightenPeds(peds, sources, tick): PedState[]`, `threatSources(events, effects, tick): Point[]`, `stepPed(ped, world, dt, tick, random): PedState | null`, `stepPeds(state, world, dt, tick, random): ArenaState`, `blastPeds(peds, vehicle, tick): { peds: PedState[]; killed: PedState[] }`; `CircleContact = { point: Point; damage: number; touched: boolean }`, `resolveVehicleAgainstCircle(vehicle, point): CircleContact`; `applyEntityHit(state, hit, tick): ArenaState | null`; `topUpPeds(state, zone, world, random): ArenaState`, `applyPopulation(state, world, tick, random): ArenaState` (now takes `tick`).

- [x] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/sim/peds.test.ts
import { describe, expect, it } from "vitest";
import type { MapIndex, MapZone } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import {
  PED_BODY_TICKS,
  PED_FLEE_TICKS,
  alivePeds,
  blastPeds,
  createPed,
  damagePed,
  frightenPeds,
  spawnPeds,
  stepPed,
  stepPeds,
  threatSources,
  type PedWorld,
} from "./peds";
import { createRng } from "./rng";
import type { ArenaState, PedState, RailPosition } from "./types";
import { createVehicle } from "./vehicle";

/** A 100 m residential square 0-1-2-3-0. */
const graph = decodeRoadGraph({
  nodes: [0, 0, 400, 0, 400, 400, 0, 400],
  edges: [
    0, 1, 0, -1, 0, 400, 1, 2, 0, -1, 0, 400, 2, 3, 0, -1, 0, 400, 3, 0, 0, -1,
    0, 400,
  ],
  classes: ["residential"],
  names: [],
});
const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [200, 200],
  radius: 2000,
  spawnNodes: [[0, 0]],
  landmarks: [],
};
const emptyIndex: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};
const free = { resolveCircle: (centre: Point): Point => centre };
const world: PedWorld = { graph, collision: free };
const east: RailPosition = { edge: 0, direction: 1, edgeT: 0.25, side: 1 };
const step = 1 / 30;

function walkerAt(x: number, y: number): PedState {
  return { ...createPed(7, graph, east), x, y };
}

/** A pedestrian with no rail, so it stays put until something moves it. */
function standingAt(id: number, x: number, y: number): PedState {
  return { ...walkerAt(x, y), id, rail: null };
}

function steps(ped: PedState, ticks: number, random = () => 0): PedState {
  let current: PedState | null = ped;
  for (let tick = 1; tick <= ticks && current; tick++)
    current = stepPed(current, world, step, tick, random);
  if (!current) throw new Error("pedestrian vanished");
  return current;
}

function lonePlayer(): ArenaState {
  return createArenaState(
    { index: emptyIndex, graph, seed: 3, zone: null },
    createRng(3),
  );
}

describe("pedestrian spawning", () => {
  it("creates a pedestrian on the pavement facing along its rail", () => {
    expect(createPed(7, graph, east)).toEqual({
      id: 7,
      x: 25,
      y: 4,
      facing: 0,
      health: 40,
      mode: "walk",
      modeUntilTick: 0,
      rail: east,
      fleeX: 0,
      fleeY: 0,
    });
  });

  it("spawns seeded pedestrians on rails away from the players and out of view", () => {
    const peds = spawnPeds(zone, graph, createRng(2), [[0, 0]], null, 100, 5);
    expect(peds.map((ped) => ped.id)).toEqual([100, 101, 102, 103, 104]);
    for (const ped of peds) {
      expect(ped.rail).not.toBeNull();
      expect(Math.hypot(ped.x, ped.y)).toBeGreaterThanOrEqual(30);
    }
    expect(
      spawnPeds(zone, graph, createRng(2), [[0, 0]], null, 100, 5),
    ).toEqual(peds);
    const everything = { minX: -10, minY: -10, maxX: 110, maxY: 110 };
    expect(
      spawnPeds(zone, graph, createRng(2), [], everything, 100, 5),
    ).toEqual([]);
    expect(alivePeds([peds[0], { ...peds[1], mode: "dead" }])).toEqual([
      peds[0],
    ]);
  });
});

describe("stepPed", () => {
  it("walks the rail at 1.4 m/s and first walks back to a rail it strayed from", () => {
    const walked = steps(createPed(7, graph, east), 30);
    expect(walked.x).toBeCloseTo(26.4);
    expect(walked.y).toBeCloseTo(4);
    expect(walked.rail?.edgeT).toBeCloseTo(0.264);
    const strayed = steps(walkerAt(25, 10), 1);
    expect(strayed.y).toBeCloseTo(10 - 1.4 / 30);
    expect(strayed.facing).toBeCloseTo(-Math.PI / 2);
    const back = steps(walkerAt(25, 10), 200);
    expect(back.y).toBeCloseTo(4);
    expect(back.rail?.edgeT ?? 0).toBeGreaterThan(0.25);
  });

  it("flees straight away from the nearest source at 5.5 m/s for 120 ticks, then rejoins a pavement", () => {
    const [scared] = frightenPeds(
      [walkerAt(10, 4)],
      [
        [0, 4],
        [90, 4],
      ],
      50,
    );
    expect(scared).toMatchObject({
      mode: "flee",
      modeUntilTick: 50 + PED_FLEE_TICKS,
      fleeX: 1,
      fleeY: 0,
      facing: 0,
    });
    expect(frightenPeds([walkerAt(10, 4)], [[50, 4]], 50)[0].mode).toBe("walk");
    const ran = steps(scared, 30);
    expect(ran.x).toBeCloseTo(15.5);
    expect(ran.mode).toBe("flee");
    const rejoined = stepPed(
      { ...ran, x: 32, y: 4 },
      world,
      step,
      scared.modeUntilTick,
      () => 0.9,
    );
    expect(rejoined?.mode).toBe("walk");
    expect(rejoined?.rail).toMatchObject({ edge: 0, direction: 1, side: 1 });
    expect(rejoined?.rail?.edgeT).toBeCloseTo(0.32);
  });

  it("dies at zero health, keeps the body for 240 ticks and ignores further damage", () => {
    const ped = walkerAt(25, 4);
    expect(damagePed(ped, 15, 10)).toMatchObject({ health: 25, mode: "walk" });
    const dead = damagePed(ped, 40, 10);
    expect(dead).toMatchObject({
      health: 0,
      mode: "dead",
      modeUntilTick: 10 + PED_BODY_TICKS,
      rail: null,
    });
    expect(damagePed(dead, 10, 11)).toBe(dead);
    expect(stepPed(dead, world, step, 249, () => 0)).toBe(dead);
    expect(stepPed(dead, world, step, 250, () => 0)).toBeNull();
  });

  it("lists gunfire and fresh explosions as things to run from", () => {
    const sources = threatSources(
      [{ kind: "shot", weapon: "pistol", ownerId: 0, x: 1, y: 2 }],
      [
        {
          id: 1,
          kind: "explosion",
          x: 5,
          y: 6,
          angle: 0,
          bornTick: 9,
          ttlTicks: 18,
        },
        {
          id: 2,
          kind: "explosion",
          x: 7,
          y: 8,
          angle: 0,
          bornTick: 8,
          ttlTicks: 18,
        },
        {
          id: 3,
          kind: "muzzle",
          x: 9,
          y: 9,
          angle: 0,
          bornTick: 10,
          ttlTicks: 2,
        },
      ],
      10,
    );
    expect(sources).toEqual([
      [1, 2],
      [5, 6],
    ]);
  });
});

describe("stepPeds", () => {
  it("lets a fast car push, hurt and kill pedestrians, crediting the driving player", () => {
    const base = lonePlayer();
    const car = { ...createVehicle(40, "sedan", [0, 0], 0, 0), velocityX: 10 };
    const state: ArenaState = {
      ...base,
      vehicles: [car],
      peds: [standingAt(70, 1.5, 0), standingAt(71, 50, 0)],
    };
    const hit = stepPeds(state, world, step, 5, () => 0);
    expect(hit.peds[0]).toMatchObject({ mode: "dead", health: 0 });
    expect(hit.peds[0].x).toBeCloseTo(2.5);
    expect(hit.peds[1].mode).toBe("walk");
    expect(hit.events).toEqual([
      { kind: "kill", victim: "ped", killerId: null, x: 1.5, y: 0 },
    ]);
    const driving: ArenaState = {
      ...state,
      player: { ...state.player, vehicleId: 40 },
    };
    expect(stepPeds(driving, world, step, 5, () => 0).events[0]).toMatchObject({
      killerId: 0,
    });
    const slow: ArenaState = { ...state, vehicles: [{ ...car, velocityX: 3 }] };
    const nudged = stepPeds(slow, world, step, 5, () => 0);
    expect(nudged.peds[0]).toMatchObject({ mode: "walk", health: 40 });
    expect(nudged.peds[0].x).toBeCloseTo(2);
    expect(nudged.events).toEqual([]);
  });

  it("frightens pedestrians with this tick's shots and drops expired bodies", () => {
    const base = lonePlayer();
    const state: ArenaState = {
      ...base,
      events: [{ kind: "shot", weapon: "pistol", ownerId: 0, x: 0, y: 4 }],
      peds: [
        walkerAt(10, 4),
        { ...damagePed(walkerAt(60, 4), 40, 0), modeUntilTick: 5 },
      ],
    };
    const next = stepPeds(state, world, step, 5, () => 0);
    expect(next.peds).toHaveLength(1);
    expect(next.peds[0].mode).toBe("flee");
    expect(next.peds[0].x).toBeCloseTo(10 + 5.5 / 30);
  });

  it("kills pedestrians inside a blast and leaves the rest alone", () => {
    const blast = blastPeds(
      [standingAt(72, 1, 0), standingAt(73, 5, 0)],
      { x: 0, y: 0 },
      3,
    );
    expect(blast.peds[0]).toMatchObject({ mode: "dead", modeUntilTick: 243 });
    expect(blast.peds[1].mode).toBe("walk");
    expect(blast.killed).toEqual([blast.peds[0]]);
  });
});
```

```ts
// src/lib/cityArena/sim/hits.test.ts
import { describe, expect, it } from "vitest";
import type { MapIndex } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import type { BulletHit } from "./bullets";
import { applyEntityHit } from "./hits";
import { createRng } from "./rng";
import type { ArenaState, BulletState, PedState } from "./types";

const emptyIndex: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};
const graph = decodeRoadGraph({ nodes: [], edges: [], classes: [], names: [] });
const ped: PedState = {
  id: 300,
  x: 5,
  y: 0,
  facing: 0,
  health: 40,
  mode: "walk",
  modeUntilTick: 0,
  rail: null,
  fleeX: 0,
  fleeY: 0,
};

function bulletFrom(ownerId: number, damage: number): BulletState {
  return {
    id: 1,
    ownerId,
    ignoreVehicleId: null,
    x: 4,
    y: 0,
    directionX: 1,
    directionY: 0,
    speedMps: 120,
    rangeLeftM: 30,
    damage,
    weapon: "pistol",
  };
}

function hitOn(targetId: number, bullet: BulletState): BulletHit {
  return {
    bullet,
    point: [4.6, 0],
    target: { kind: "player", playerId: targetId },
  };
}

function withPed(): ArenaState {
  const state = createArenaState(
    { index: emptyIndex, graph, seed: 1, zone: null },
    createRng(1),
  );
  return { ...state, peds: [ped] };
}

describe("applyEntityHit", () => {
  it("hurts a pedestrian with a player's bullet, then kills it with a kill event", () => {
    const hurt = applyEntityHit(withPed(), hitOn(300, bulletFrom(0, 20)), 4);
    expect(hurt?.peds[0]).toMatchObject({ health: 20, mode: "walk" });
    expect(hurt?.events).toEqual([
      { kind: "hit", target: "ped", x: 4.6, y: 0 },
    ]);
    const killed = applyEntityHit(withPed(), hitOn(300, bulletFrom(0, 40)), 4);
    expect(killed?.peds[0]).toMatchObject({ health: 0, mode: "dead" });
    expect(killed?.events).toEqual([
      { kind: "hit", target: "ped", x: 4.6, y: 0 },
      { kind: "kill", victim: "ped", killerId: 0, x: 5, y: 0 },
    ]);
  });

  it("absorbs a non-player's bullet without damage and ignores other targets", () => {
    const absorbed = applyEntityHit(
      withPed(),
      hitOn(300, bulletFrom(77, 40)),
      4,
    );
    expect(absorbed?.peds[0].health).toBe(40);
    expect(absorbed?.events).toEqual([
      { kind: "hit", target: "ped", x: 4.6, y: 0 },
    ]);
    expect(
      applyEntityHit(withPed(), hitOn(0, bulletFrom(77, 40)), 4),
    ).toBeNull();
    expect(
      applyEntityHit(
        withPed(),
        {
          bullet: bulletFrom(0, 20),
          point: [4.6, 0],
          target: { kind: "building" },
        },
        4,
      ),
    ).toBeNull();
  });
});
```

Append to `src/lib/cityArena/sim/collisions.test.ts` (add `resolveVehicleAgainstCircle` to the `./collisions` import):

```ts
describe("resolveVehicleAgainstCircle", () => {
  it("reports whether a person-sized circle touched the car, its push-out and the run-over damage", () => {
    const fast = { ...createVehicle(1, "sport", [0, 0], 0, 0), velocityX: 12 };
    expect(resolveVehicleAgainstCircle(fast, [1, 0])).toEqual({
      point: [2.5, 0],
      damage: 60,
      touched: true,
    });
    expect(resolveVehicleAgainstCircle(fast, [5, 0])).toEqual({
      point: [5, 0],
      damage: 0,
      touched: false,
    });
  });
});
```

Append to `src/lib/cityArena/sim/populate.test.ts` (imports: `PEDS_PER_ZONE` from `./peds`, `topUpPeds` from `./populate`; the `west`/`east` graph gains no edges, so give the file's `graph` a residential edge per zone — replace the `graph` constant with):

```ts
const graph = decodeRoadGraph({
  nodes: [0, 0, 800, 0, 12000, 0, 12800, 0],
  edges: [0, 1, 0, -1, 0, 800, 2, 3, 0, -1, 0, 800],
  classes: ["residential"],
  names: [],
});
```

(it already has those two residential edges — keep it) and add:

```ts
it("spawns the zone's pedestrians on population and tops them up in batches", () => {
  const state = createArenaState(
    { index, graph, seed: 5, zone: west },
    createRng(5),
  );
  expect(state.peds).toHaveLength(PEDS_PER_ZONE);
  for (const ped of state.peds) {
    expect(Math.abs(ped.y)).toBeCloseTo(4);
    expect(
      Math.hypot(ped.x - state.player.x, ped.y - state.player.y),
    ).toBeGreaterThanOrEqual(30);
  }
  const thinned = { ...state, peds: state.peds.slice(0, 10) };
  const random = createRng(8);
  expect(applyPopulation(thinned, { index, graph }, 29, random)).toBe(thinned);
  const topped = applyPopulation(thinned, { index, graph }, 30, random);
  expect(topped.peds).toHaveLength(15);
  expect(topUpPeds(topped, west, { index, graph }, random).peds).toHaveLength(
    20,
  );
  expect(topUpPeds(state, west, { index, graph }, random)).toBe(state);
});
```

Also change the two existing `applyPopulation(state, { index, graph }, random)` calls in that file to `applyPopulation(state, { index, graph }, 1, random)` and `applyPopulation(moved, { index, graph }, 1, random)`, and in "populates the start zone …" change `expect(repopulated.nextId).toBe(state.nextId + 3);` to `expect(repopulated.nextId).toBe(state.nextId + 3 + repopulated.peds.length);`.

Extend `src/lib/cityArena/sim/arena.test.ts`: add `type ArenaEvent, type PedState` to the `./types` import and `PED_BODY_TICKS` from `./peds`; in "spawns the player on a spawn node …" drop `peds: [],` from Task 1's `toMatchObject` and add before the `nextId` expectation:

```ts
expect(state.peds).toHaveLength(25);
for (const ped of state.peds) {
  expect(Math.abs(ped.y)).toBeCloseTo(4);
  expect(
    Math.hypot(ped.x - state.player.x, ped.y - state.player.y),
  ).toBeGreaterThanOrEqual(30);
}
```

and change that expectation to `expect(state.nextId).toBe(1 + state.vehicles.length + state.pickups.length + state.peds.length);`. Then append:

```ts
/** Runs `ticks` steps and concatenates every tick's events. */
function runCollecting(
  state: ArenaState,
  input: WorldInput,
  ticks: number,
): { state: ArenaState; events: ArenaEvent[] } {
  const random = createRng(99);
  let current = state;
  const events: ArenaEvent[] = [];
  for (let index = 0; index < ticks; index++) {
    current = stepArena(current, input, step, world, random);
    events.push(...current.events);
  }
  return { state: current, events };
}

function pedAt(id: number, x: number, y: number): PedState {
  return {
    id,
    x,
    y,
    facing: 0,
    health: 40,
    mode: "walk",
    modeUntilTick: 0,
    rail: null,
    fleeX: 0,
    fleeY: 0,
  };
}

describe("stepArena pedestrians", () => {
  it("shoots a fleeing pedestrian dead, credits the player and keeps the body 240 ticks", () => {
    const state = boot();
    const armed: ArenaState = {
      ...state,
      vehicles: [],
      traffic: [],
      peds: [pedAt(900, state.player.x + 5, state.player.y)],
    };
    const { state: shot, events } = runCollecting(
      armed,
      createInput({ fire: true, aim: 0 }),
      20,
    );
    const victim = shot.peds.find((ped) => ped.id === 900);
    expect(victim).toMatchObject({ mode: "dead", health: 0 });
    expect(events.filter((event) => event.kind === "hit")).toHaveLength(2);
    const kills = events.filter((event) => event.kind === "kill");
    expect(kills).toHaveLength(1);
    expect(kills[0]).toMatchObject({ victim: "ped", killerId: 0 });
    const bodyGone = (victim?.modeUntilTick ?? 0) - shot.tick;
    expect(bodyGone).toBe(PED_BODY_TICKS - 6);
    const hasBody = (state: ArenaState): boolean =>
      state.peds.some((ped) => ped.id === 900);
    expect(hasBody(run(shot, EMPTY_INPUT, bodyGone - 1))).toBe(true);
    expect(hasBody(run(shot, EMPTY_INPUT, bodyGone))).toBe(false);
  });

  it("makes nearby pedestrians run from a shot and lets the player's car run one over", () => {
    const state = boot();
    const bystander: ArenaState = {
      ...state,
      vehicles: [],
      traffic: [],
      peds: [pedAt(901, state.player.x + 10, state.player.y + 3)],
    };
    const fired = run(bystander, createInput({ fire: true }), 1);
    expect(fired.peds[0].mode).toBe("flee");
    const seated = run(withCar(state, 3), createInput({ enter: true }), 1);
    const driving: ArenaState = {
      ...seated,
      peds: [pedAt(902, seated.vehicles[0].x + 12, seated.vehicles[0].y)],
    };
    const { events } = runCollecting(
      driving,
      createInput({ move: [0, -1] }),
      90,
    );
    expect(events.filter((event) => event.kind === "kill")).toEqual([
      expect.objectContaining({ victim: "ped", killerId: 0 }),
    ]);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim`
Expected: FAIL — `./peds` and `./hits` not found; `resolveVehicleAgainstCircle` not exported; `applyPopulation` rejects the fourth argument; `state.peds` is empty after `createArenaState`.

- [x] **Step 3: Share the car–circle contact and implement peds.ts**

In `src/lib/cityArena/sim/collisions.ts` add `import type { Point } from "../world/projection";`, then replace `resolveVehicleAgainstPlayer` with the pair below:

```ts
/** Contact of a car with a person-sized circle at `point`: the pushed-out point, run-over damage and whether they touched. */
export type CircleContact = { point: Point; damage: number; touched: boolean };

/** Pushes a person-sized circle clear of a car and reports run-over damage (5 × speed above 5 m/s). */
export function resolveVehicleAgainstCircle(
  vehicle: VehicleState,
  point: Point,
): CircleContact {
  const dx = point[0] - vehicle.x;
  const dy = point[1] - vehicle.y;
  const distance = Math.hypot(dx, dy);
  const minimum = CAR_BODY_RADIUS_M + PLAYER_RADIUS_M;
  if (distance >= minimum) return { point, damage: 0, touched: false };
  const normalX = distance === 0 ? 1 : dx / distance;
  const normalY = distance === 0 ? 0 : dy / distance;
  const speed = Math.hypot(vehicle.velocityX, vehicle.velocityY);
  const damage =
    speed > RUN_OVER_MIN_SPEED_MPS ? RUN_OVER_DAMAGE_PER_MPS * speed : 0;
  // A parked/slow car pushes to exactly `minimum` so the next tick starts contact-free
  // without oscillating; a moving car that hurt them gets the extra clearance.
  const clearance = damage > 0 ? minimum + RUN_OVER_CLEARANCE_M : minimum;
  return {
    point: [vehicle.x + normalX * clearance, vehicle.y + normalY * clearance],
    damage,
    touched: true,
  };
}

/** Pushes a player on foot clear of a car and reports run-over damage (5 × speed above 5 m/s). */
export function resolveVehicleAgainstPlayer(
  vehicle: VehicleState,
  player: ArenaPlayerState,
): { player: ArenaPlayerState; damage: number } {
  const contact = resolveVehicleAgainstCircle(vehicle, [player.x, player.y]);
  if (!contact.touched) return { player, damage: 0 };
  return {
    player: { ...player, x: contact.point[0], y: contact.point[1] },
    damage: contact.damage,
  };
}
```

```ts
// src/lib/cityArena/sim/peds.ts
import { pointInRect, type Rect } from "../mapBuild/geometry";
import type { CollisionGrid } from "../world/collisionGrid";
import type { MapZone } from "../world/mapTypes";
import { moveToward } from "../world/pathFollow";
import {
  advanceRail,
  nearestRail,
  pavementEdgesWithin,
  pavementOffsetM,
  railHeading,
  railPoint,
  randomRail,
  type RailGraph,
} from "../world/pavements";
import type { Point } from "../world/projection";
import { zoneCentreMetres, zoneRadiusMetres } from "../world/zone";
import { resolveVehicleAgainstCircle } from "./collisions";
import { EXPLOSION_DAMAGE, inBlastRadius } from "./damage";
import { eventsOfKind, pushEvent } from "./events";
import { PLAYER_RADIUS_M } from "./player";
import { driverPlayer } from "./players";
import { farFromAll } from "./spawn";
import type {
  ArenaEvent,
  ArenaState,
  EffectState,
  PedState,
  RailPosition,
  VehicleState,
} from "./types";

/** Living pedestrians kept per zone (spec §5: ≈ 25). */
export const PEDS_PER_ZONE = 25;
/** Walking speed on the pavement. */
export const PED_WALK_SPEED_MPS = 1.4;
/** Speed away from gunfire and explosions (spec §5). */
export const PED_FLEE_SPEED_MPS = 5.5;
/** Threats within this distance frighten (spec §5). */
export const PED_FLEE_RADIUS_M = 25;
/** Ticks of fleeing (spec §5: 4 s). */
export const PED_FLEE_TICKS = 120;
/** Ticks a body stays (spec §5: 8 s). */
export const PED_BODY_TICKS = 240;
/** Pedestrian health: two pistol rounds, one shotgun shell, run over at ≥ 8 m/s. */
export const PED_MAX_HEALTH = 40;
/** Collision radius; the same circle as a player (spec §5). */
export const PED_RADIUS_M = PLAYER_RADIUS_M;
/** Pedestrians live inside the zone disc plus this margin (spec §5: + 100 m). */
export const PED_SPAWN_MARGIN_M = 100;
/** Fresh pedestrians keep this distance from every player. */
export const PED_SPAWN_MIN_FROM_PLAYER_M = 30;
/** How far a fleeing pedestrian looks for a pavement to rejoin. */
export const PED_REJOIN_SNAP_M = 60;
/** Every this many ticks missing pedestrians are replaced. */
export const PED_RESPAWN_INTERVAL_TICKS = 30;
/** Most pedestrians replaced per top-up. */
export const PED_RESPAWN_BATCH = 5;
/** Explosion effects at most this old still frighten (they are born after the pedestrian step of their tick). */
const EXPLOSION_FRIGHT_TICKS = 1;
/** Within this distance of its rail point a pedestrian walks the rail; farther away it first walks back to it. */
const RAIL_SNAP_M = 0.5;
/** Spawn attempts per wanted pedestrian before giving up. */
const SPAWN_ATTEMPTS = 20;

/** What the pedestrian step reads from the world. */
export type PedWorld = {
  graph: RailGraph;
  collision: Pick<CollisionGrid, "resolveCircle">;
  viewRect?: Rect;
};

/** Pavement offset of the rail's road class. */
function railOffset(graph: RailGraph, rail: RailPosition): number {
  return pavementOffsetM(graph.edges[rail.edge].roadClass);
}

/** A healthy pedestrian standing on its rail, facing along it. */
export function createPed(
  id: number,
  graph: RailGraph,
  rail: RailPosition,
): PedState {
  const [x, y] = railPoint(graph, rail, railOffset(graph, rail));
  return {
    id,
    x,
    y,
    facing: railHeading(graph, rail),
    health: PED_MAX_HEALTH,
    mode: "walk",
    modeUntilTick: 0,
    rail,
    fleeX: 0,
    fleeY: 0,
  };
}

/** Pedestrians that are not dead. */
export function alivePeds(peds: PedState[]): PedState[] {
  return peds.filter((ped) => ped.mode !== "dead");
}

/** Up to `count` seeded pedestrians on pavement rails inside the zone disc + 100 m, ≥ 30 m from `avoid` and outside `viewRect`. */
export function spawnPeds(
  zone: MapZone,
  graph: RailGraph,
  random: () => number,
  avoid: Point[],
  viewRect: Rect | null,
  firstId: number,
  count: number,
): PedState[] {
  const edges = pavementEdgesWithin(
    graph,
    zoneCentreMetres(zone),
    zoneRadiusMetres(zone) + PED_SPAWN_MARGIN_M,
  );
  const peds: PedState[] = [];
  if (edges.length === 0) return peds;
  const attempts = count * SPAWN_ATTEMPTS;
  for (let attempt = 0; attempt < attempts && peds.length < count; attempt++) {
    const ped = createPed(
      firstId + peds.length,
      graph,
      randomRail(graph, edges, random),
    );
    const point: Point = [ped.x, ped.y];
    if (!farFromAll(point, avoid, PED_SPAWN_MIN_FROM_PLAYER_M)) continue;
    if (viewRect && pointInRect(point, viewRect)) continue;
    peds.push(ped);
  }
  return peds;
}

/** Applies damage; at zero health the pedestrian dies and its body stays for 240 ticks. */
export function damagePed(
  ped: PedState,
  amount: number,
  tick: number,
): PedState {
  if (amount <= 0 || ped.mode === "dead") return ped;
  const health = Math.max(0, ped.health - amount);
  if (health > 0) return { ...ped, health };
  return {
    ...ped,
    health: 0,
    mode: "dead",
    modeUntilTick: tick + PED_BODY_TICKS,
    rail: null,
  };
}

/** Sends a pedestrian running from the nearest source within 25 m (along its facing when standing on it); unchanged when none is near. */
function frighten(ped: PedState, sources: Point[], tick: number): PedState {
  let nearest: Point | null = null;
  let nearestDistance = PED_FLEE_RADIUS_M;
  for (const source of sources) {
    const distance = Math.hypot(ped.x - source[0], ped.y - source[1]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = source;
    }
  }
  if (!nearest) return ped;
  const awayX = ped.x - nearest[0];
  const awayY = ped.y - nearest[1];
  const length = Math.hypot(awayX, awayY);
  const fleeX = length === 0 ? Math.cos(ped.facing) : awayX / length;
  const fleeY = length === 0 ? Math.sin(ped.facing) : awayY / length;
  return {
    ...ped,
    mode: "flee",
    modeUntilTick: tick + PED_FLEE_TICKS,
    fleeX,
    fleeY,
    facing: Math.atan2(fleeY, fleeX),
  };
}

/** Every living pedestrian within 25 m of a source runs away from the nearest one for 4 s (an already fleeing one restarts its timer). */
export function frightenPeds(
  peds: PedState[],
  sources: Point[],
  tick: number,
): PedState[] {
  if (sources.length === 0) return peds;
  return peds.map((ped) =>
    ped.mode === "dead" ? ped : frighten(ped, sources, tick),
  );
}

/** Gunfire this tick and explosions born this or the previous tick, as points to run from. */
export function threatSources(
  events: ArenaEvent[],
  effects: EffectState[],
  tick: number,
): Point[] {
  const points: Point[] = eventsOfKind(events, "shot").map((shot) => [
    shot.x,
    shot.y,
  ]);
  for (const effect of effects)
    if (
      effect.kind === "explosion" &&
      tick - effect.bornTick <= EXPLOSION_FRIGHT_TICKS
    )
      points.push([effect.x, effect.y]);
  return points;
}

/** Walks the rail at 1.4 m/s, first walking back to the rail point when the pedestrian strayed from it. */
function walk(
  ped: PedState,
  graph: RailGraph,
  dt: number,
  random: () => number,
): PedState {
  if (!ped.rail) return ped;
  const target = railPoint(graph, ped.rail, railOffset(graph, ped.rail));
  if (Math.hypot(target[0] - ped.x, target[1] - ped.y) > RAIL_SNAP_M) {
    const [x, y] = moveToward([ped.x, ped.y], target, PED_WALK_SPEED_MPS * dt);
    return {
      ...ped,
      x,
      y,
      facing: Math.atan2(target[1] - ped.y, target[0] - ped.x),
    };
  }
  const rail = advanceRail(graph, ped.rail, PED_WALK_SPEED_MPS * dt, random);
  const [x, y] = railPoint(graph, rail, railOffset(graph, rail));
  return { ...ped, rail, x, y, facing: railHeading(graph, rail) };
}

/** Runs along the flee direction at 5.5 m/s, pushed out of buildings. */
function flee(
  ped: PedState,
  collision: Pick<CollisionGrid, "resolveCircle">,
  dt: number,
): PedState {
  const [x, y] = collision.resolveCircle(
    [
      ped.x + ped.fleeX * PED_FLEE_SPEED_MPS * dt,
      ped.y + ped.fleeY * PED_FLEE_SPEED_MPS * dt,
    ],
    PED_RADIUS_M,
  );
  return { ...ped, x, y };
}

/** Back to walking on the nearest pavement (none within 60 m leaves the pedestrian standing). */
function rejoinPavement(
  ped: PedState,
  graph: RailGraph,
  random: () => number,
): PedState {
  const rail = nearestRail(graph, [ped.x, ped.y], PED_REJOIN_SNAP_M, random);
  return { ...ped, mode: "walk", rail };
}

/** One tick of a pedestrian: walking, fleeing, or lying dead; `null` once the body's time is up. */
export function stepPed(
  ped: PedState,
  world: PedWorld,
  dt: number,
  tick: number,
  random: () => number,
): PedState | null {
  if (ped.mode === "dead") return tick >= ped.modeUntilTick ? null : ped;
  if (ped.mode === "flee")
    return tick >= ped.modeUntilTick
      ? rejoinPavement(ped, world.graph, random)
      : flee(ped, world.collision, dt);
  return walk(ped, world.graph, dt, random);
}

/** One car's effect on one living pedestrian: pushed clear, hurt above 5 m/s, and whether this contact killed it. */
function hitPedWithVehicle(
  ped: PedState,
  vehicle: VehicleState,
  tick: number,
): { ped: PedState; killed: boolean } {
  const contact = resolveVehicleAgainstCircle(vehicle, [ped.x, ped.y]);
  if (!contact.touched) return { ped, killed: false };
  const moved = { ...ped, x: contact.point[0], y: contact.point[1] };
  const hurt = damagePed(moved, contact.damage, tick);
  return { ped: hurt, killed: hurt.mode === "dead" };
}

/** Every moving car pushes and possibly kills the living pedestrians it touches; a kill by a player's car is credited to that player. */
function runOverPeds(state: ArenaState, tick: number): ArenaState {
  let peds = state.peds;
  let events = state.events;
  for (const vehicle of state.vehicles) {
    if (vehicle.velocityX === 0 && vehicle.velocityY === 0) continue;
    const killerId = driverPlayer(state, vehicle.id)?.id ?? null;
    const next: PedState[] = [];
    for (const ped of peds) {
      const hit =
        ped.mode === "dead"
          ? { ped, killed: false }
          : hitPedWithVehicle(ped, vehicle, tick);
      if (hit.killed)
        events = pushEvent(events, {
          kind: "kill",
          victim: "ped",
          killerId,
          x: ped.x,
          y: ped.y,
        });
      next.push(hit.ped);
    }
    peds = next;
  }
  return { ...state, peds, events };
}

/** Frightens with this tick's threats, steps every pedestrian, drops expired bodies, then lets moving cars run them over. */
export function stepPeds(
  state: ArenaState,
  world: PedWorld,
  dt: number,
  tick: number,
  random: () => number,
): ArenaState {
  const sources = threatSources(state.events, state.effects, tick);
  const peds: PedState[] = [];
  for (const ped of frightenPeds(state.peds, sources, tick)) {
    const next = stepPed(ped, world, dt, tick, random);
    if (next) peds.push(next);
  }
  return runOverPeds({ ...state, peds }, tick);
}

/** Blast damage to the living pedestrians inside an exploding car's radius; returns them and the ones it killed. */
export function blastPeds(
  peds: PedState[],
  vehicle: Pick<VehicleState, "x" | "y">,
  tick: number,
): { peds: PedState[]; killed: PedState[] } {
  const killed: PedState[] = [];
  const blasted = peds.map((ped) => {
    if (ped.mode === "dead" || !inBlastRadius(vehicle, [ped.x, ped.y]))
      return ped;
    const hurt = damagePed(ped, EXPLOSION_DAMAGE, tick);
    if (hurt.mode === "dead") killed.push(hurt);
    return hurt;
  });
  return { peds: blasted, killed };
}
```

- [x] **Step 4: Implement hits.ts, extend populate.ts and wire arena.ts**

```ts
// src/lib/cityArena/sim/hits.ts
import type { BulletHit } from "./bullets";
import { pushEvent } from "./events";
import { damagePed } from "./peds";
import { playerById } from "./players";
import type { ArenaState } from "./types";

/** A pedestrian hit: damage only from a player's bullet (others are absorbed), a hit event, and a kill event with the shooter when it died. */
function hitPed(
  state: ArenaState,
  index: number,
  hit: BulletHit,
  tick: number,
): ArenaState {
  const ped = state.peds[index];
  const fromPlayer = playerById(state, hit.bullet.ownerId) !== null;
  const damaged = fromPlayer ? damagePed(ped, hit.bullet.damage, tick) : ped;
  let events = pushEvent(state.events, {
    kind: "hit",
    target: "ped",
    x: hit.point[0],
    y: hit.point[1],
  });
  if (damaged.mode === "dead" && ped.mode !== "dead")
    events = pushEvent(events, {
      kind: "kill",
      victim: "ped",
      killerId: hit.bullet.ownerId,
      x: ped.x,
      y: ped.y,
    });
  return {
    ...state,
    events,
    peds: state.peds.map((candidate, position) =>
      position === index ? damaged : candidate,
    ),
  };
}

/** Applies a bullet hit whose target id belongs to a pedestrian; `null` when the target is something else. */
export function applyEntityHit(
  state: ArenaState,
  hit: BulletHit,
  tick: number,
): ArenaState | null {
  if (hit.target.kind !== "player") return null;
  const targetId = hit.target.playerId;
  const pedIndex = state.peds.findIndex((ped) => ped.id === targetId);
  if (pedIndex >= 0) return hitPed(state, pedIndex, hit, tick);
  return null;
}
```

```ts
// src/lib/cityArena/sim/populate.ts
import type { Rect } from "../mapBuild/geometry";
import type { MapIndex, MapZone } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { MAX_PEDS } from "./limits";
import {
  PEDS_PER_ZONE,
  PED_RESPAWN_BATCH,
  PED_RESPAWN_INTERVAL_TICKS,
  alivePeds,
  spawnPeds,
} from "./peds";
import { placePickups } from "./pickups";
import { playersOf } from "./players";
import { nearestZone, type SpawnGraph } from "./spawn";
import type { ArenaState } from "./types";

/** What population reads from the world. */
export type PopulationWorld = {
  index: MapIndex;
  graph: SpawnGraph;
  viewRect?: Rect;
};

/** Where the players stand, for the spawn avoid lists. */
function playerPoints(state: ArenaState): Point[] {
  return playersOf(state).map((player) => [player.x, player.y]);
}

/** Drops the population of the previous zone: pickups, pedestrians, cops and AI-driven cars (never the player's car). */
function clearPopulation(state: ArenaState): ArenaState {
  const driven = new Set(state.traffic.map((driver) => driver.vehicleId));
  const vehicles = state.vehicles.filter(
    (vehicle) =>
      !driven.has(vehicle.id) || vehicle.id === state.player.vehicleId,
  );
  return { ...state, vehicles, peds: [], cops: [], pickups: [], traffic: [] };
}

/** Makes `zone` the active zone: clears the old population, places the zone's pickups and spawns its pedestrians away from the players. */
export function populateZone(
  state: ArenaState,
  zone: MapZone,
  index: MapIndex,
  graph: SpawnGraph,
  random: () => number,
): ArenaState {
  const cleared = clearPopulation(state);
  const avoid = playerPoints(cleared);
  const pickups = placePickups(
    index,
    zone,
    graph,
    random,
    avoid,
    cleared.nextId,
  );
  const peds = spawnPeds(
    zone,
    graph,
    random,
    avoid,
    null,
    cleared.nextId + pickups.length,
    PEDS_PER_ZONE,
  );
  return {
    ...cleared,
    activeZoneKey: zone.key,
    pickups,
    peds,
    nextId: cleared.nextId + pickups.length + peds.length,
  };
}

/** Replaces missing pedestrians in batches of at most 5, staying under the caps and out of view. */
export function topUpPeds(
  state: ArenaState,
  zone: MapZone,
  world: PopulationWorld,
  random: () => number,
): ArenaState {
  const room = Math.min(
    PEDS_PER_ZONE - alivePeds(state.peds).length,
    MAX_PEDS - state.peds.length,
    PED_RESPAWN_BATCH,
  );
  if (room <= 0) return state;
  const fresh = spawnPeds(
    zone,
    world.graph,
    random,
    playerPoints(state),
    world.viewRect ?? null,
    state.nextId,
    room,
  );
  if (fresh.length === 0) return state;
  return {
    ...state,
    peds: [...state.peds, ...fresh],
    nextId: state.nextId + fresh.length,
  };
}

/** Re-populates when the zone nearest the player is no longer the active one; otherwise tops up pedestrians every 30 ticks. */
export function applyPopulation(
  state: ArenaState,
  world: PopulationWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const [player] = playersOf(state);
  const zone = nearestZone(world.index, [player.x, player.y]);
  if (!zone) return state;
  if (zone.key !== state.activeZoneKey)
    return populateZone(state, zone, world.index, world.graph, random);
  if (tick % PED_RESPAWN_INTERVAL_TICKS !== 0) return state;
  return topUpPeds(state, zone, world, random);
}
```

In `src/lib/cityArena/sim/arena.ts`: add the imports `import { applyEntityHit } from "./hits";`, `import { alivePeds, blastPeds, stepPeds } from "./peds";`, add `type PlayerTarget` to the `./bullets` import and `type HitTargetKind` to the `./types` import, then replace `applyHit`, `advanceBullets` and `explodeVehicle` and update `stepArena`:

```ts
/** The state with a hit event on an entity at `point`. */
function withHitEvent(
  state: ArenaState,
  target: HitTargetKind,
  point: Point,
): ArenaState {
  return {
    ...state,
    events: pushEvent(state.events, {
      kind: "hit",
      target,
      x: point[0],
      y: point[1],
    }),
  };
}

/** Applies one bullet hit: a pedestrian or cop, a car, or a player on foot (never the shooter); hits on entities are recorded as events. */
function applyHit(state: ArenaState, hit: BulletHit, tick: number): ArenaState {
  const entity = applyEntityHit(state, hit, tick);
  if (entity) return entity;
  if (hit.target.kind === "vehicle") {
    const vehicleId = hit.target.vehicleId;
    const vehicles = state.vehicles.map((vehicle) =>
      vehicle.id === vehicleId
        ? damageVehicle(vehicle, hit.bullet.damage)
        : vehicle,
    );
    return withHitEvent({ ...state, vehicles }, "vehicle", hit.point);
  }
  if (hit.target.kind === "player" && hit.target.playerId === state.player.id)
    return withHitEvent(
      { ...state, player: damagePlayer(state.player, hit.bullet.damage, tick) },
      "player",
      hit.point,
    );
  return state;
}

/** Every circle a bullet can hit this tick: the player on foot and the living pedestrians (all 0.4 m). */
function bulletTargets(state: ArenaState): PlayerTarget[] {
  const { player } = state;
  const targets: PlayerTarget[] =
    !isDead(player) && player.vehicleId === null
      ? [{ id: player.id, x: player.x, y: player.y }]
      : [];
  for (const ped of alivePeds(state.peds))
    targets.push({ id: ped.id, x: ped.x, y: ped.y });
  return targets;
}

/** Sweeps the bullets, applies their hits and spawns an impact effect per hit. */
function advanceBullets(
  state: ArenaState,
  dt: number,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  const swept = stepBullets(state.bullets, dt, {
    collision: world.collision,
    vehicles: state.vehicles,
    players: bulletTargets(state),
  });
  let next: ArenaState = { ...state, bullets: swept.bullets };
  for (const hit of swept.hits) {
    const struck = applyHit(next, hit, tick);
    next = {
      ...struck,
      nextId: struck.nextId + 1,
      effects: addEffect(struck.effects, {
        id: struck.nextId,
        kind: "impact",
        x: hit.point[0],
        y: hit.point[1],
        angle: 0,
        bornTick: tick,
      }),
    };
  }
  return next;
}

/** Wrecks one car that reached 0 health: explosion effect and event, blast damage to the player, pedestrians and cars nearby. */
function explodeVehicle(
  state: ArenaState,
  vehicle: VehicleState,
  tick: number,
): ArenaState {
  const vehicles = state.vehicles.map((other) => {
    if (other.id === vehicle.id)
      return { ...other, wrecked: true, velocityX: 0, velocityY: 0 };
    return inBlastRadius(vehicle, [other.x, other.y])
      ? damageVehicle(other, EXPLOSION_DAMAGE)
      : other;
  });
  const blast = blastPeds(state.peds, vehicle, tick);
  let events = pushEvent(state.events, {
    kind: "explosion",
    x: vehicle.x,
    y: vehicle.y,
  });
  for (const ped of blast.killed)
    events = pushEvent(events, {
      kind: "kill",
      victim: "ped",
      killerId: null,
      x: ped.x,
      y: ped.y,
    });
  return {
    ...state,
    vehicles,
    peds: blast.peds,
    events,
    nextId: state.nextId + 1,
    player: blastPlayer(state.player, vehicle, tick),
    effects: addEffect(state.effects, {
      id: state.nextId,
      kind: "explosion",
      x: vehicle.x,
      y: vehicle.y,
      angle: 0,
      bornTick: tick,
    }),
  };
}
```

```ts
/** One fixed step of the arena: the single simulation entry point. */
export function stepArena(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  random: () => number,
): ArenaState {
  const tick = state.tick + 1;
  const edges = detectEdges(state.held, input);
  let next: ArenaState = { ...state, tick, held: edges.held, events: [] };
  next = applyPopulation(next, world, tick, random);
  next = applyRespawn(next, world, tick, random);
  next = stepPickups(next, tick);
  next = applyWeaponSwitch(next, edges.weaponPressed);
  next = applyEnterExit(next, edges.enterPressed, world);
  next = moveEntities(next, input, dt, world, tick);
  next = applyFire(next, input, tick, random);
  next = stepPeds(next, world, dt, tick, random);
  next = advanceBullets(next, dt, world, tick);
  next = applyExplosions(next, world, tick);
  next = ejectIfDead(next, world);
  const zone = findZone(world.index, [next.player.x, next.player.y]);
  return {
    ...next,
    effects: pruneEffects(next.effects, tick),
    zoneKey: zone?.key ?? null,
  };
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run src/lib/cityArena src/components/cityArena`
Expected: `tsc` clean; PASS — peds 8, hits 2, collisions 6, populate 3, arena (+2), and every other suite (the overlay test's single residential edge gets 25 pedestrians ≥ 30 m from the player; the hook test's empty graph gets none). Worked numbers: 30 ticks at 1.4 m/s move the rail by 1.4 m (t 0.25 → 0.264); the frightened pedestrian at (10, 4) is 10 m from (0, 4) and 80 m from (90, 4), so it runs east and covers 5.5 m in 30 ticks; at (32, 4) the westbound-or-eastbound projection onto edge 0 is 0.32 with the point on the eastbound right side; a sedan at 10 m/s deals 5 × 10 = 50 ≥ 40 and pushes the pedestrian at 1.5 m to 1.6 + 0.4 + 0.5 = 2.5 m, while at 3 m/s it only pushes to 2.0 m; in the arena test the pistol's second round (tick 13, sweeping 4–8 m on tick 14) reaches the fleeing pedestrian's 0.4 m circle inside 20 ticks, so two hit events and one kill event are collected, and the body leaves exactly `modeUntilTick − tick` ticks later; the sedan driven from rest for 90 ticks covers ≈ 28 m at up to 6 m/s — above the 5 m/s run-over threshold when it reaches the pedestrian parked 12 m ahead.

- [x] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/sim
git add src/lib/cityArena/sim
git commit -m "feat(arena): pedestrians that walk, flee, die and get run over

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: AI driver, ambient traffic and kerb-side parking

**Files:**

- Create: `src/lib/cityArena/sim/driver.ts`
- Create: `src/lib/cityArena/sim/traffic.ts`
- Modify: `src/lib/cityArena/sim/spawn.ts` (kerb parking replaces node parking)
- Modify: `src/lib/cityArena/sim/populate.ts` (traffic in `populateZone`, wrecks dropped on zone change, `topUpTraffic`)
- Modify: `src/lib/cityArena/sim/arena.ts` (`enterVehicle` carjacks, `stepVehicles` with AI controls, sleeping cars and impact events, `moveEntities`)
- Test: `src/lib/cityArena/sim/driver.test.ts`, `src/lib/cityArena/sim/traffic.test.ts`, `src/lib/cityArena/sim/spawn.test.ts` (replace the parking test), `src/lib/cityArena/sim/populate.test.ts` (extend), `src/lib/cityArena/sim/arena.test.ts` (modify two tests, extend one, add one describe)

**Interfaces:**

- Consumes: `DriverState`, `DriverRole`, `RailPosition`, `VehicleState`, `VehicleKind`, `ArenaEvent`, `ArenaState` (Task 1); `pushEvent` (Task 1); `driverPlayer`, `playersOf` (Task 1); `MAX_TRAFFIC`, `MAX_VEHICLES` (Task 1); `PARKING_ROAD_CLASSES`, `kerbOffsetM`, `edgeLengthM`, `railPoint`, `railHeading`, `railEndNode`, `RailGraph` (Task 2); `pointInRect`, `Rect` (Task 2); `alivePeds` (Task 4); `farFromAll`, `shuffle`, `MIN_CAR_SPACING_M`, `MIN_CAR_TO_PLAYER_M`, `PARKED_CAR_KINDS`, `SpawnGraph` (`./spawn`); `CAR_BODY_RADIUS_M`, `resolveVehiclePairs` (`./collisions`); `IMPACT_DAMAGE_THRESHOLD_MPS`, `impactDamage`, `damageVehicle`, `isDead` (`./damage`); `VEHICLE_LENGTH_M`, `VEHICLE_COLOUR_COUNT`, `NO_CONTROLS`, `createVehicle`, `forwardSpeed`, `stepVehicle`, `worldToLocal`, `VehicleControls` (`./vehicle`); `ROAD_WIDTH_M` (`../render/palette`); `zoneCentreMetres`, `zoneRadiusMetres` (`../world/zone`); `RoadGraph`, `RoadGraphEdge`; `RoadClass`, `MapZone`; `Point`.
- Produces: `LANE_CLEARANCE_M = 0.1`, `STEER_FULL_ERROR_RAD = π/6`, `TURN_SLOW_ERROR_RAD = π/4`, `TURN_SPEED_MPS = 5`, `THROTTLE_GAIN_MPS = 3`, `BRAKE_GAP_MPS = 1`, `STOP_SPEED_MPS = 0.3`, `wrapAngle(angle): number`, `laneOffsetM(roadClass): number`, `laneTarget(graph, from, to, laneM): Point`, `headingError(vehicle, target): number`, `obstacleAhead(vehicle, points, lookAheadM, halfWidthM): boolean`, `desiredSpeed(error, cruiseMps, blocked): number`, `throttleFor(forwardMps, targetMps): number`, `driveControls(vehicle, target, cruiseMps, blocked): VehicleControls`; `TRAFFIC_ROAD_CLASSES`, `AI_ROAD_CLASSES`, `TRAFFIC_MIN_PER_ZONE = 6`, `TRAFFIC_MAX_PER_ZONE = 10`, `TRAFFIC_MIN_SPEED_MPS = 8`, `TRAFFIC_MAX_SPEED_MPS = 12`, `TRAFFIC_LOOK_AHEAD_M = 10`, `TRAFFIC_LOOK_AHEAD_HALF_WIDTH_M = 2.2`, `NODE_REACH_M = 4`, `TRAFFIC_PATH_AHEAD = 2`, `TRAFFIC_SPAWN_MIN_FROM_PLAYER_M = 30`, `TRAFFIC_KINDS`, `DriverWorld = { graph: RoadGraph; viewRect?: Rect }`, `DrivenCar = { vehicle: VehicleState; driver: DriverState }`, `DriverStep = { traffic: DriverState[]; controls: Map<number, VehicleControls> }`, `isTrafficEdge(edge): boolean`, `isAiEdge(edge): boolean`, `trafficEdgesWithin(graph, centre, radiusM): number[]`, `nextTrafficNode(graph, node, arrivedFrom, random): number | null`, `extendPath(graph, driver, random): DriverState`, `laneOffsetBetween(graph, from, to): number`, `driverTarget(graph, driver): Point | null`, `advanceDriver(graph, driver, vehicle): DriverState`, `createTrafficCar(id, graph, rail, kind, colour, cruiseMps): DrivenCar`, `spawnTraffic(zone, graph, random, avoid, occupied, viewRect, firstId, count): DrivenCar[]`, `obstaclePoints(state, driver): Point[]`, `ChaseTarget = { point: Point; rangeM: number }`, `stepDrivers(state, world, random, chase: ChaseTarget | null): DriverStep` (police cars within `rangeM` of `point` drive straight at it); `TRAFFIC_TOP_UP_INTERVAL_TICKS = 150`; `PARKED_CARS_PER_ZONE = 30` (now a cap), `PARKING_INTERVAL_M = 40`, `ParkingSpot = { point: Point; heading: number }`, `isParkingEdge(edge): boolean`, `edgeParkingSpots(graph, edgeIndex, random): ParkingSpot[]`, `zoneParkingSpots(graph, zone, random): ParkingSpot[]`, `spawnParkedCars(index, graph, random, avoid, firstId): VehicleState[]` (same signature, kerb placement); `topUpTraffic(state, zone, world, random): ArenaState`; `stepArena` emits `impact` events, AI cars drive, boarding a driven car removes its driver.

- [x] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/sim/driver.test.ts
import { describe, expect, it } from "vitest";
import {
  desiredSpeed,
  driveControls,
  headingError,
  laneOffsetM,
  laneTarget,
  obstacleAhead,
  throttleFor,
  wrapAngle,
} from "./driver";
import { createVehicle } from "./vehicle";

const graph = {
  nodes: [[0, 0] as [number, number], [100, 0] as [number, number]],
};
const eastbound = createVehicle(1, "sedan", [0, 0], 0, 0);

describe("lanes", () => {
  it("keeps the right lane a car-body circle clear of oncoming traffic on narrow roads", () => {
    expect(laneOffsetM("residential")).toBeCloseTo(1.7);
    expect(laneOffsetM("unclassified")).toBeCloseTo(1.7);
    expect(laneOffsetM("tertiary")).toBeCloseTo(1.75);
    expect(laneOffsetM("secondary")).toBeCloseTo(2);
    expect(laneOffsetM("primary")).toBeCloseTo(2.25);
    expect(laneOffsetM("motorway")).toBeCloseTo(3);
  });

  it("shifts the next node to the right of the direction of travel", () => {
    expect(laneTarget(graph, 0, 1, 1.7)).toEqual([100, 1.7]);
    const westbound = laneTarget(graph, 1, 0, 1.7);
    expect(westbound[0]).toBeCloseTo(0);
    expect(westbound[1]).toBeCloseTo(-1.7);
    expect(laneTarget(graph, 0, 1, 0)).toEqual([100, 0]);
  });
});

describe("steering", () => {
  it("measures the signed heading error wrapped into −π..π", () => {
    expect(wrapAngle(4)).toBeCloseTo(4 - 2 * Math.PI);
    expect(headingError(eastbound, [10, 10])).toBeCloseTo(Math.PI / 4);
    expect(headingError(eastbound, [-10, 0])).toBeCloseTo(Math.PI);
    expect(
      headingError({ ...eastbound, heading: 3 }, [Math.cos(-3), Math.sin(-3)]),
    ).toBeCloseTo(2 * Math.PI - 6);
  });

  it("sees obstacles only in the box in front of the bumper", () => {
    expect(obstacleAhead(eastbound, [[5, 0]], 10, 2.2)).toBe(true);
    expect(obstacleAhead(eastbound, [[6, -2]], 10, 2.2)).toBe(true);
    expect(obstacleAhead(eastbound, [[1, 0]], 10, 2.2)).toBe(false);
    expect(obstacleAhead(eastbound, [[13, 0]], 10, 2.2)).toBe(false);
    expect(obstacleAhead(eastbound, [[6, 2.5]], 10, 2.2)).toBe(false);
    expect(obstacleAhead(eastbound, [], 10, 2.2)).toBe(false);
    const southbound = { ...eastbound, heading: Math.PI / 2 };
    expect(obstacleAhead(southbound, [[0, 5]], 10, 2.2)).toBe(true);
    expect(obstacleAhead(southbound, [[5, 0]], 10, 2.2)).toBe(false);
  });
});

describe("speed", () => {
  it("holds the cruise speed, slows for sharp turns and stops when blocked", () => {
    expect(desiredSpeed(0, 10, false)).toBe(10);
    expect(desiredSpeed(Math.PI / 3, 10, false)).toBe(5);
    expect(desiredSpeed(Math.PI / 3, 3, false)).toBe(3);
    expect(desiredSpeed(0.1, 4, false)).toBe(4);
    expect(desiredSpeed(0, 10, true)).toBe(0);
  });

  it("maps the speed gap to throttle and brake", () => {
    expect(throttleFor(0, 10)).toBe(1);
    expect(throttleFor(9, 10)).toBeCloseTo(1 / 3);
    expect(throttleFor(10, 10)).toBe(0);
    expect(throttleFor(10.5, 10)).toBe(0);
    expect(throttleFor(12, 10)).toBe(-1);
    expect(throttleFor(5, 0)).toBe(-1);
    expect(throttleFor(0.2, 0)).toBe(0);
  });

  it("combines steering and throttle into car controls", () => {
    expect(driveControls(eastbound, [10, 10], 10, false)).toEqual({
      throttle: 1,
      steer: 1,
    });
    const gentle = driveControls(eastbound, [10, -1], 10, false);
    expect(gentle.throttle).toBe(1);
    expect(gentle.steer).toBeCloseTo(-0.19, 2);
    const rolling = { ...eastbound, velocityX: 8 };
    expect(driveControls(rolling, [50, 0], 10, true)).toEqual({
      throttle: -1,
      steer: 0,
    });
  });
});
```

```ts
// src/lib/cityArena/sim/traffic.test.ts
import { describe, expect, it } from "vitest";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import { createRng } from "./rng";
import {
  TRAFFIC_MAX_SPEED_MPS,
  TRAFFIC_MIN_SPEED_MPS,
  advanceDriver,
  createTrafficCar,
  driverTarget,
  extendPath,
  isAiEdge,
  isTrafficEdge,
  laneOffsetBetween,
  nextTrafficNode,
  obstaclePoints,
  spawnTraffic,
  stepDrivers,
  trafficEdgesWithin,
} from "./traffic";
import type { ArenaState, DriverState, PedState } from "./types";
import { createVehicle, forwardSpeed } from "./vehicle";

/** A 100 m tertiary square 0-1-2-3-0 (edges 0..3) plus a service spur 1-4 east (edge 4). */
const graph = decodeRoadGraph({
  nodes: [0, 0, 400, 0, 400, 400, 0, 400, 800, 0],
  edges: [
    0, 1, 0, -1, 0, 400, 1, 2, 0, -1, 0, 400, 2, 3, 0, -1, 0, 400, 3, 0, 0, -1,
    0, 400, 1, 4, 1, -1, 0, 400,
  ],
  classes: ["tertiary", "service"],
  names: [],
});
/** One lone tertiary edge 0-1 of 100 m. */
const single = decodeRoadGraph({
  nodes: [0, 0, 400, 0],
  edges: [0, 1, 0, -1, 0, 400],
  classes: ["tertiary"],
  names: [],
});
/** The same edge, one-way from 0 to 1. */
const oneway = decodeRoadGraph({
  nodes: [0, 0, 400, 0],
  edges: [0, 1, 0, -1, 1, 400],
  classes: ["tertiary"],
  names: [],
});
const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [200, 200],
  radius: 2000,
  spawnNodes: [[0, 0]],
  landmarks: [],
};
const emptyIndex: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};

function driverOf(fromNode: number | null, path: number[]): DriverState {
  return {
    vehicleId: 600,
    role: "traffic",
    cruiseMps: 10,
    fromNode,
    path,
    repathTick: 0,
  };
}

function lonePlayer(): ArenaState {
  return createArenaState(
    { index: emptyIndex, graph, seed: 3, zone: null },
    createRng(3),
  );
}

function standingPed(id: number, x: number, y: number): PedState {
  return {
    id,
    x,
    y,
    facing: 0,
    health: 40,
    mode: "walk",
    modeUntilTick: 0,
    rail: null,
    fleeX: 0,
    fleeY: 0,
  };
}

describe("traffic roads", () => {
  it("classifies edges and lists the through-roads around a point", () => {
    expect(isTrafficEdge(graph.edges[0])).toBe(true);
    expect(isTrafficEdge(graph.edges[4])).toBe(false);
    expect(isAiEdge(graph.edges[4])).toBe(false);
    expect(isAiEdge(graph.edges[0])).toBe(true);
    expect(trafficEdgesWithin(graph, [50, 50], 60)).toEqual([0, 1, 2, 3]);
    expect(trafficEdgesWithin(graph, [50, 50], 40)).toEqual([]);
  });

  it("wanders with seeded turns, never back the way it came unless at a dead end, and honours one-way edges", () => {
    expect(nextTrafficNode(graph, 1, 0, () => 0)).toBe(2);
    expect(nextTrafficNode(graph, 1, 0, () => 0.99)).toBe(2);
    expect(nextTrafficNode(graph, 0, null, () => 0)).toBe(1);
    expect(nextTrafficNode(graph, 0, null, () => 0.99)).toBe(3);
    expect(nextTrafficNode(single, 1, 0, () => 0)).toBe(0);
    expect(nextTrafficNode(oneway, 1, 0, () => 0)).toBeNull();
    expect(extendPath(graph, driverOf(0, [1]), () => 0).path).toEqual([1, 2]);
    expect(extendPath(graph, driverOf(0, []), () => 0).path).toEqual([1, 2]);
    const full = driverOf(0, [1, 2]);
    expect(extendPath(graph, full, () => 0)).toBe(full);
    expect(extendPath(oneway, driverOf(0, [1]), () => 0).path).toEqual([1]);
  });

  it("targets the lane-shifted next node and advances past reached nodes", () => {
    expect(laneOffsetBetween(graph, 0, 1)).toBeCloseTo(1.75);
    expect(laneOffsetBetween(graph, 1, 4)).toBe(0);
    const target = driverTarget(graph, driverOf(0, [1, 2]));
    expect(target?.[0]).toBeCloseTo(100);
    expect(target?.[1]).toBeCloseTo(1.75);
    expect(driverTarget(graph, driverOf(0, []))).toBeNull();
    const nearNode = createVehicle(600, "sedan", [97, 1.75], 0, 0);
    expect(advanceDriver(graph, driverOf(0, [1, 2]), nearNode)).toEqual(
      driverOf(1, [2]),
    );
    const farAway = createVehicle(600, "sedan", [50, 1.75], 0, 0);
    const driver = driverOf(0, [1, 2]);
    expect(advanceDriver(graph, driver, farAway)).toBe(driver);
  });
});

describe("traffic cars", () => {
  it("creates a rolling car in the right lane of its edge with its driver", () => {
    const car = createTrafficCar(
      600,
      graph,
      { edge: 0, direction: 1, edgeT: 0.25, side: 1 },
      "sedan",
      2,
      10,
    );
    expect(car.vehicle).toMatchObject({ id: 600, kind: "sedan", colour: 2 });
    expect(car.vehicle.x).toBeCloseTo(25);
    expect(car.vehicle.y).toBeCloseTo(1.75);
    expect(car.vehicle.heading).toBeCloseTo(0);
    expect(forwardSpeed(car.vehicle)).toBeCloseTo(10);
    expect(car.driver).toEqual(driverOf(0, [1]));
    const back = createTrafficCar(
      601,
      graph,
      { edge: 0, direction: -1, edgeT: 0.25, side: 1 },
      "compact",
      0,
      8,
    );
    expect(back.vehicle.x).toBeCloseTo(75);
    expect(back.vehicle.y).toBeCloseTo(-1.75);
    expect(back.driver).toEqual({
      ...driverOf(1, [0]),
      vehicleId: 601,
      cruiseMps: 8,
    });
  });

  it("spawns seeded traffic on the zone's through-roads, spaced, away from the player and out of view", () => {
    const cars = spawnTraffic(
      zone,
      graph,
      createRng(4),
      [[0, 0]],
      [],
      null,
      700,
      5,
    );
    expect(cars.map((car) => car.vehicle.id)).toEqual([
      700, 701, 702, 703, 704,
    ]);
    for (const car of cars) {
      expect(car.driver).toMatchObject({
        vehicleId: car.vehicle.id,
        role: "traffic",
      });
      expect(car.driver.cruiseMps).toBeGreaterThanOrEqual(
        TRAFFIC_MIN_SPEED_MPS,
      );
      expect(car.driver.cruiseMps).toBeLessThanOrEqual(TRAFFIC_MAX_SPEED_MPS);
      expect(Math.hypot(car.vehicle.x, car.vehicle.y)).toBeGreaterThanOrEqual(
        30,
      );
      expect(forwardSpeed(car.vehicle)).toBeCloseTo(car.driver.cruiseMps);
    }
    for (const first of cars)
      for (const second of cars) {
        if (first === second) continue;
        expect(
          Math.hypot(
            first.vehicle.x - second.vehicle.x,
            first.vehicle.y - second.vehicle.y,
          ),
        ).toBeGreaterThanOrEqual(12);
      }
    expect(
      spawnTraffic(zone, graph, createRng(4), [[0, 0]], [], null, 700, 5),
    ).toEqual(cars);
    const everything = { minX: -10, minY: -10, maxX: 110, maxY: 110 };
    expect(
      spawnTraffic(zone, graph, createRng(4), [], [], everything, 700, 5),
    ).toEqual([]);
    expect(
      spawnTraffic(zone, single, createRng(4), [], [], null, 700, 3),
    ).toHaveLength(3);
    const occupied = cars.map((car): [number, number] => [
      car.vehicle.x,
      car.vehicle.y,
    ]);
    for (const car of spawnTraffic(
      zone,
      graph,
      createRng(5),
      [],
      occupied,
      null,
      800,
      3,
    ))
      for (const point of occupied)
        expect(
          Math.hypot(car.vehicle.x - point[0], car.vehicle.y - point[1]),
        ).toBeGreaterThanOrEqual(12);
  });

  it("lists other cars, living pedestrians and players on foot as obstacles; police ignore the players", () => {
    const base = lonePlayer();
    const own = createVehicle(600, "sedan", [10, 0], 0, 0);
    const other = createVehicle(601, "sedan", [20, 0], 0, 0);
    const state: ArenaState = {
      ...base,
      vehicles: [own, other],
      peds: [
        standingPed(70, 30, 0),
        { ...standingPed(71, 40, 0), mode: "dead", health: 0 },
      ],
    };
    expect(obstaclePoints(state, driverOf(0, [1]))).toEqual([
      [20, 0],
      [30, 0],
      [base.player.x, base.player.y],
    ]);
    const police: DriverState = { ...driverOf(0, [1]), role: "police" };
    expect(obstaclePoints(state, police)).toEqual([
      [20, 0],
      [30, 0],
    ]);
    const seated: ArenaState = {
      ...state,
      player: { ...state.player, vehicleId: 601 },
    };
    expect(obstaclePoints(seated, police)).toEqual([[30, 0]]);
    expect(obstaclePoints(seated, driverOf(0, [1]))).toEqual([
      [20, 0],
      [30, 0],
    ]);
  });

  it("steps every driver: controls for cars with a target, none for a finished path, dropped without a car", () => {
    const base = lonePlayer();
    const car = createTrafficCar(
      600,
      graph,
      { edge: 0, direction: 1, edgeT: 0.5, side: 1 },
      "sedan",
      0,
      10,
    );
    const stuck: DriverState = { ...driverOf(null, []), vehicleId: 601 };
    const orphan: DriverState = { ...driverOf(0, [1]), vehicleId: 602 };
    const state: ArenaState = {
      ...base,
      vehicles: [
        car.vehicle,
        createVehicle(601, "compact", [50, -1.75], Math.PI, 0),
      ],
      traffic: [car.driver, stuck, orphan],
    };
    const step = stepDrivers(state, { graph }, () => 0, null);
    expect(step.traffic.map((driver) => driver.vehicleId)).toEqual([600, 601]);
    expect(step.traffic[0].path).toEqual([1, 2]);
    expect(step.traffic[1].path).toEqual([]);
    expect(step.controls.get(600)).toEqual({ throttle: 0, steer: 0 });
    expect(step.controls.has(601)).toBe(false);
    const blocked: ArenaState = { ...state, peds: [standingPed(70, 58, 1.75)] };
    expect(
      stepDrivers(blocked, { graph }, () => 0, null).controls.get(600),
    ).toEqual({
      throttle: -1,
      steer: 0,
    });
    const police: ArenaState = {
      ...state,
      traffic: [{ ...car.driver, role: "police" }],
    };
    const chased = stepDrivers(police, { graph }, () => 0, {
      point: [50, 40],
      rangeM: 60,
    });
    expect(chased.controls.get(600)).toEqual({ throttle: -1, steer: 1 });
    const farChase = stepDrivers(police, { graph }, () => 0, {
      point: [50, 40],
      rangeM: 30,
    });
    expect(farChase.controls.get(600)).toEqual({ throttle: 0, steer: 0 });
    expect(farChase.traffic[0].path).toEqual([1]);
  });
});
```

Replace the parking test in `src/lib/cityArena/sim/spawn.test.ts` ("parks up to eight seeded cars per zone on spawn nodes …") with the three tests below, and extend the `./spawn` import with `edgeParkingSpots, zoneParkingSpots` (keep `PARKED_CARS_PER_ZONE`):

```ts
it("lays parking spots every 40 m along an edge on a seeded kerb, cars facing their direction of travel", () => {
  const leftKerb = edgeParkingSpots(graph, 0, () => 0);
  expect(leftKerb).toHaveLength(3);
  expect(leftKerb[0].point[0]).toBeCloseTo(0);
  expect(leftKerb[0].point[1]).toBeCloseTo(-3.3);
  expect(leftKerb[1].point[0]).toBeCloseTo(40);
  expect(leftKerb[2].point[0]).toBeCloseTo(80);
  for (const spot of leftKerb) expect(spot.heading).toBeCloseTo(Math.PI);
  const rightKerb = edgeParkingSpots(graph, 0, () => 0.99);
  expect(rightKerb).toHaveLength(2);
  expect(rightKerb[0].point[0]).toBeCloseTo(39.6);
  expect(rightKerb[0].point[1]).toBeCloseTo(3.3);
  expect(rightKerb[1].point[0]).toBeCloseTo(79.6);
  for (const spot of rightKerb) expect(spot.heading).toBeCloseTo(0);
});

it("collects the spots of every residential edge inside the zone disc", () => {
  const spots = zoneParkingSpots(graph, zone, () => 0);
  expect(spots).toHaveLength(9);
  expect(spots[3].point[0]).toBeCloseTo(100);
  expect(spots[3].point[1]).toBeCloseTo(-3.3);
  expect(spots[6].point[0]).toBeCloseTo(96.7);
  expect(spots[6].point[1]).toBeCloseTo(0);
  expect(spots[6].heading).toBeCloseTo(Math.PI / 2);
  expect(zoneParkingSpots(graph, otherZone, () => 0)).toEqual([]);
});

it("parks seeded cars along the kerbs, capped, spaced apart and away from the player", () => {
  const avoid: [number, number] = [0, 0];
  const cars = spawnParkedCars(index, graph, createRng(11), [avoid], 50);
  expect(cars.length).toBeGreaterThanOrEqual(3);
  expect(cars.length).toBeLessThanOrEqual(Math.min(9, PARKED_CARS_PER_ZONE));
  expect(cars.map((car) => car.id)).toEqual(
    cars.map((_, offset) => 50 + offset),
  );
  for (const car of cars) {
    const onKerb =
      Math.abs(Math.abs(car.y) - 3.3) < 1e-6 ||
      Math.abs(Math.abs(car.x - 100) - 3.3) < 1e-6;
    expect(onKerb).toBe(true);
    expect(
      Math.hypot(car.x - avoid[0], car.y - avoid[1]),
    ).toBeGreaterThanOrEqual(8);
    expect(["compact", "sedan", "sport"]).toContain(car.kind);
    expect(car.colour).toBeLessThan(6);
  }
  for (const first of cars) {
    for (const second of cars) {
      if (first === second) continue;
      expect(
        Math.hypot(first.x - second.x, first.y - second.y),
      ).toBeGreaterThanOrEqual(12);
    }
  }
  expect(cars.filter((car) => car.x >= 1000)).toHaveLength(0);
  expect(spawnParkedCars(index, graph, createRng(11), [avoid], 50)).toEqual(
    cars,
  );
});
```

Append to `src/lib/cityArena/sim/populate.test.ts` (imports: `TRAFFIC_MAX_PER_ZONE`, `TRAFFIC_MIN_PER_ZONE` from `./traffic`, `forwardSpeed` from `./vehicle`, `topUpTraffic` from `./populate`):

```ts
/** The residential graph plus a 100 m tertiary square east of the west zone's nodes. */
const withThroughRoads = decodeRoadGraph({
  nodes: [
    0, 0, 800, 0, 12000, 0, 12800, 0, 1200, 0, 1600, 0, 1600, 400, 1200, 400,
  ],
  edges: [
    0, 1, 0, -1, 0, 800, 2, 3, 0, -1, 0, 800, 4, 5, 1, -1, 0, 400, 5, 6, 1, -1,
    0, 400, 6, 7, 1, -1, 0, 400, 7, 4, 1, -1, 0, 400,
  ],
  classes: ["residential", "tertiary"],
  names: [],
});

describe("traffic population", () => {
  it("spawns 6–10 rolling traffic cars on the through-roads and tops them up to the minimum", () => {
    const state = createArenaState(
      { index, graph: withThroughRoads, seed: 5, zone: west },
      createRng(5),
    );
    expect(state.traffic.length).toBeGreaterThanOrEqual(TRAFFIC_MIN_PER_ZONE);
    expect(state.traffic.length).toBeLessThanOrEqual(TRAFFIC_MAX_PER_ZONE);
    for (const driver of state.traffic) {
      const car = state.vehicles.find(
        (vehicle) => vehicle.id === driver.vehicleId,
      );
      expect(car).toBeDefined();
      expect(driver.role).toBe("traffic");
      expect(forwardSpeed(car ?? state.vehicles[0])).toBeCloseTo(
        driver.cruiseMps,
      );
      expect(car?.x ?? 0).toBeGreaterThanOrEqual(300 - 2);
      expect(
        Math.hypot(
          (car?.x ?? 0) - state.player.x,
          (car?.y ?? 0) - state.player.y,
        ),
      ).toBeGreaterThanOrEqual(30);
    }
    const thinned = { ...state, traffic: state.traffic.slice(0, 3) };
    const world = { index, graph: withThroughRoads };
    const random = createRng(8);
    expect(applyPopulation(thinned, world, 149, random)).toBe(thinned);
    const topped = applyPopulation(thinned, world, 150, random);
    expect(topped.traffic).toHaveLength(4);
    expect(topped.vehicles).toHaveLength(state.vehicles.length + 1);
    expect(topUpTraffic(state, west, world, random)).toBe(state);
  });

  it("drops wrecks and AI cars but keeps parked cars and the player's car on a zone change", () => {
    const state = createArenaState(
      { index, graph: withThroughRoads, seed: 5, zone: west },
      createRng(5),
    );
    const wreckId = state.traffic[0].vehicleId;
    const wrecked = {
      ...state,
      vehicles: state.vehicles.map((vehicle) =>
        vehicle.id === wreckId
          ? { ...vehicle, wrecked: true, health: 0 }
          : vehicle,
      ),
      traffic: state.traffic.slice(1),
    };
    const moved = populateZone(
      wrecked,
      east,
      index,
      withThroughRoads,
      createRng(2),
    );
    expect(moved.vehicles.some((vehicle) => vehicle.id === wreckId)).toBe(
      false,
    );
    for (const driver of state.traffic)
      expect(
        moved.vehicles.some((vehicle) => vehicle.id === driver.vehicleId),
      ).toBe(false);
    expect(moved.traffic).toEqual([]);
  });
});
```

Edit `src/lib/cityArena/sim/arena.test.ts`:

1. Add `eventsOfKind` from `./events`, `createTrafficCar` from `./traffic`, `forwardSpeed` to the `./vehicle` import, `PedState` is already imported (Task 4). Add below `graph`:

```ts
/** The same road as a 300 m tertiary through-road: traffic drives it, nobody parks or walks on it. */
const throughGraph = decodeRoadGraph({
  nodes: [0, 0, 1200, 0],
  edges: [0, 1, 0, -1, 0, 1200],
  classes: ["tertiary"],
  names: [],
});
const throughWorld: ArenaWorld = {
  collision: createCollisionGrid(),
  index,
  graph: throughGraph,
};
```

2. In "spawns the player on a spawn node with the loadout and parks cars away from them" replace the vehicle expectations with:

```ts
expect(state.vehicles.length).toBeGreaterThanOrEqual(6);
expect(state.vehicles.length).toBeLessThanOrEqual(8);
for (const car of state.vehicles) {
  expect(Math.abs(car.y)).toBeCloseTo(3.3);
  expect(
    Math.hypot(car.x - state.player.x, car.y - state.player.y),
  ).toBeGreaterThanOrEqual(8);
}
```

3. Replace "keeps respawns off parked cars" with:

```ts
it("keeps respawns off parked cars", () => {
  const state = boot();
  const freeX = state.player.x;
  const dying: ArenaState = {
    ...state,
    vehicles: SPAWN_XS.filter((x) => x !== freeX).map((x, index) =>
      createVehicle(500 + index, "compact", [x, 0], 0, 0),
    ),
    player: { ...state.player, health: 0, diedAtTick: state.tick },
  };
  const respawned = run(dying, EMPTY_INPUT, RESPAWN_DELAY_TICKS);
  expect(respawned.player.diedAtTick).toBeNull();
  expect(respawned.player.x).toBe(freeX);
  expect(respawned.player.y).toBe(0);
});
```

4. In "deals impactDamage to both cars in a head-on collision above the threshold" append:

```ts
const [impact] = eventsOfKind(crashed.events, "impact");
expect(impact).toMatchObject({ vehicleId: 701, otherVehicleId: 702 });
expect(impact.impactSpeed).toBeCloseTo(8);
expect(eventsOfKind(crashed.events, "impact")).toHaveLength(1);
```

5. Append a new describe:

```ts
/** Steps `state` on the through-road world. */
function runThrough(
  state: ArenaState,
  input: WorldInput,
  ticks: number,
): ArenaState {
  const random = createRng(99);
  let current = state;
  for (let index = 0; index < ticks; index++)
    current = stepArena(current, input, step, throughWorld, random);
  return current;
}

describe("stepArena traffic", () => {
  it("drives a traffic car along its lane at cruise speed and stops it short of a pedestrian", () => {
    const state = boot();
    const car = createTrafficCar(
      600,
      throughGraph,
      { edge: 0, direction: 1, edgeT: 0.1, side: 1 },
      "sedan",
      0,
      10,
    );
    const rolling: ArenaState = {
      ...state,
      player: { ...state.player, x: 150, y: 60 },
      vehicles: [car.vehicle],
      traffic: [car.driver],
      peds: [],
    };
    const driven = runThrough(rolling, EMPTY_INPUT, 60);
    expect(driven.vehicles[0].x).toBeCloseTo(50, 0);
    expect(driven.vehicles[0].y).toBeCloseTo(1.75, 1);
    expect(forwardSpeed(driven.vehicles[0])).toBeCloseTo(10, 0);
    expect(driven.traffic[0].fromNode).toBe(0);
    const pedestrian = { ...rolling, peds: [pedAt(900, 50, 1.75)] };
    const stopped = runThrough(pedestrian, EMPTY_INPUT, 60);
    expect(forwardSpeed(stopped.vehicles[0])).toBeLessThan(0.5);
    expect(stopped.vehicles[0].x).toBeLessThan(45);
    expect(stopped.vehicles[0].x).toBeGreaterThan(38);
    expect(stopped.peds[0]).toMatchObject({ mode: "walk", health: 40 });
  });

  it("removes the AI driver when the player boards its car", () => {
    const state = boot();
    const car = createTrafficCar(
      600,
      throughGraph,
      { edge: 0, direction: 1, edgeT: 0.5, side: 1 },
      "sedan",
      0,
      10,
    );
    const parkedInLane = { ...car.vehicle, velocityX: 0, velocityY: 0 };
    const beside: ArenaState = {
      ...state,
      player: { ...state.player, x: parkedInLane.x, y: parkedInLane.y - 2.3 },
      vehicles: [parkedInLane],
      traffic: [car.driver],
      peds: [],
    };
    const boarded = runThrough(beside, createInput({ enter: true }), 1);
    expect(boarded.player.vehicleId).toBe(600);
    expect(boarded.traffic).toEqual([]);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim`
Expected: FAIL — `./driver` and `./traffic` not found; `edgeParkingSpots`/`zoneParkingSpots` not exported; parked cars still sit on spawn nodes (`Math.abs(car.y)` is 0, not 3.3); `state.traffic` stays empty; the head-on crash records no `impact` event; boarding leaves the driver in place.

- [x] **Step 3: Implement the driver control law and the traffic module**

```ts
// src/lib/cityArena/sim/driver.ts
import { ROAD_WIDTH_M } from "../render/palette";
import type { RoadClass } from "../world/mapTypes";
import type { Point } from "../world/projection";
import type { RoadGraph } from "../world/roadGraph";
import { CAR_BODY_RADIUS_M } from "./collisions";
import type { VehicleState } from "./types";
import {
  VEHICLE_LENGTH_M,
  forwardSpeed,
  worldToLocal,
  type VehicleControls,
} from "./vehicle";

/** Gap between a lane centre and the car-body circle of oncoming traffic, so two AI lanes never touch. */
export const LANE_CLEARANCE_M = 0.1;
/** Heading error at which the steering reaches full lock. */
export const STEER_FULL_ERROR_RAD = Math.PI / 6;
/** Heading errors beyond this slow the car to the turning speed. */
export const TURN_SLOW_ERROR_RAD = Math.PI / 4;
/** Speed held through sharp turns. */
export const TURN_SPEED_MPS = 5;
/** Speed shortfall that maps to full throttle. */
export const THROTTLE_GAIN_MPS = 3;
/** Excess speed over the target that triggers braking instead of coasting. */
export const BRAKE_GAP_MPS = 1;
/** Below this speed a stopping car releases the brake (a held brake would reverse it). */
export const STOP_SPEED_MPS = 0.3;

/** Clamps a control value to −1..1. */
function clampControl(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** The angle wrapped into −π..π. */
export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Distance from the road centre line to the centre of the right-hand lane: a quarter of the road width, never less than a car-body circle plus clearance. */
export function laneOffsetM(roadClass: RoadClass): number {
  return Math.max(
    ROAD_WIDTH_M[roadClass] / 4,
    CAR_BODY_RADIUS_M + LANE_CLEARANCE_M,
  );
}

/** The node `to` shifted `laneM` to the right of the direction from→to (0 keeps the centre line). */
export function laneTarget(
  graph: Pick<RoadGraph, "nodes">,
  from: number,
  to: number,
  laneM: number,
): Point {
  const [fromX, fromY] = graph.nodes[from];
  const [toX, toY] = graph.nodes[to];
  const heading = Math.atan2(toY - fromY, toX - fromX);
  return [toX - Math.sin(heading) * laneM, toY + Math.cos(heading) * laneM];
}

/** Signed angle from the car's heading to the direction of `target`, in −π..π. */
export function headingError(vehicle: VehicleState, target: Point): number {
  return wrapAngle(
    Math.atan2(target[1] - vehicle.y, target[0] - vehicle.x) - vehicle.heading,
  );
}

/** True when any point lies in the box from the front bumper to `lookAheadM` beyond it, `halfWidthM` to either side. */
export function obstacleAhead(
  vehicle: VehicleState,
  points: Point[],
  lookAheadM: number,
  halfWidthM: number,
): boolean {
  const bumper = VEHICLE_LENGTH_M / 2;
  return points.some((point) => {
    const [forward, right] = worldToLocal(vehicle, point);
    return (
      forward > bumper &&
      forward <= bumper + lookAheadM &&
      Math.abs(right) <= halfWidthM
    );
  });
}

/** The speed to hold: 0 when blocked, the turning speed through sharp turns, else the cruise speed. */
export function desiredSpeed(
  error: number,
  cruiseMps: number,
  blocked: boolean,
): number {
  if (blocked) return 0;
  return Math.abs(error) > TURN_SLOW_ERROR_RAD
    ? Math.min(cruiseMps, TURN_SPEED_MPS)
    : cruiseMps;
}

/** Throttle for a speed gap: proportional up to full throttle, brake when clearly too fast, and release the brake once nearly stopped. */
export function throttleFor(forwardMps: number, targetMps: number): number {
  if (targetMps === 0) return forwardMps > STOP_SPEED_MPS ? -1 : 0;
  const gap = targetMps - forwardMps;
  if (gap > 0) return Math.min(1, gap / THROTTLE_GAIN_MPS);
  return gap < -BRAKE_GAP_MPS ? -1 : 0;
}

/** Controls that steer the car toward `target` at `cruiseMps`, stopping while `blocked`. */
export function driveControls(
  vehicle: VehicleState,
  target: Point,
  cruiseMps: number,
  blocked: boolean,
): VehicleControls {
  const error = headingError(vehicle, target);
  const targetSpeed = desiredSpeed(error, cruiseMps, blocked);
  return {
    throttle: throttleFor(forwardSpeed(vehicle), targetSpeed),
    steer: clampControl(error / STEER_FULL_ERROR_RAD),
  };
}
```

```ts
// src/lib/cityArena/sim/traffic.ts
import { pointInRect, type Rect } from "../mapBuild/geometry";
import type { MapZone, RoadClass } from "../world/mapTypes";
import {
  railEndNode,
  railHeading,
  railPoint,
  type RailGraph,
} from "../world/pavements";
import type { Point } from "../world/projection";
import type { RoadGraph, RoadGraphEdge } from "../world/roadGraph";
import { zoneCentreMetres, zoneRadiusMetres } from "../world/zone";
import { isDead } from "./damage";
import {
  driveControls,
  laneOffsetM,
  laneTarget,
  obstacleAhead,
} from "./driver";
import { alivePeds } from "./peds";
import { driverPlayer, playersOf } from "./players";
import { MIN_CAR_SPACING_M, farFromAll } from "./spawn";
import type {
  ArenaState,
  DriverState,
  RailPosition,
  VehicleKind,
  VehicleState,
} from "./types";
import {
  VEHICLE_COLOUR_COUNT,
  createVehicle,
  type VehicleControls,
} from "./vehicle";

/** Road classes ambient traffic drives: through-roads ≥ 6 m wide that never get kerb-parked cars, so two lanes fit. */
export const TRAFFIC_ROAD_CLASSES: RoadClass[] = [
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
];
/** Road classes any AI driver may route over (police chases); service and pedestrian roads are off limits. */
export const AI_ROAD_CLASSES: RoadClass[] = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
];
/** Fewest ambient cars a populated zone gets (spec §5: 6–10). */
export const TRAFFIC_MIN_PER_ZONE = 6;
/** Most ambient cars a populated zone gets. */
export const TRAFFIC_MAX_PER_ZONE = 10;
/** Slowest cruise speed (spec §5: 8–12 m/s). */
export const TRAFFIC_MIN_SPEED_MPS = 8;
/** Fastest cruise speed. */
export const TRAFFIC_MAX_SPEED_MPS = 12;
/** How far beyond the bumper a driver watches for obstacles. */
export const TRAFFIC_LOOK_AHEAD_M = 10;
/** Half-width of the obstacle box: a lane's worth either side of the car's axis. */
export const TRAFFIC_LOOK_AHEAD_HALF_WIDTH_M = 2.2;
/** Within this distance of its lane target a driver moves on to the next node. */
export const NODE_REACH_M = 4;
/** Nodes a traffic driver keeps planned ahead. */
export const TRAFFIC_PATH_AHEAD = 2;
/** Fresh traffic keeps this distance from every player. */
export const TRAFFIC_SPAWN_MIN_FROM_PLAYER_M = 30;
/** Kinds ambient traffic is drawn from. */
export const TRAFFIC_KINDS: VehicleKind[] = ["compact", "sedan", "sport"];
/** Spawn attempts per wanted car before giving up. */
const SPAWN_ATTEMPTS = 20;
/** Below this random draw a two-way edge is driven b→a. */
const COIN_FLIP = 0.5;

/** What the AI drivers read from the world. */
export type DriverWorld = { graph: RoadGraph; viewRect?: Rect };

/** A car with its AI driver. */
export type DrivenCar = { vehicle: VehicleState; driver: DriverState };

/** One tick of the AI drivers: their updated bookkeeping and the controls per vehicle id. */
export type DriverStep = {
  traffic: DriverState[];
  controls: Map<number, VehicleControls>;
};

/** A ram order for police cars: the point to charge, for cars within `rangeM` of it. */
export type ChaseTarget = { point: Point; rangeM: number };

/** True for through-road edges ambient traffic drives. */
export function isTrafficEdge(edge: RoadGraphEdge): boolean {
  return TRAFFIC_ROAD_CLASSES.includes(edge.roadClass);
}

/** True for edges any AI car may route over. */
export function isAiEdge(edge: RoadGraphEdge): boolean {
  return AI_ROAD_CLASSES.includes(edge.roadClass);
}

/** The end of an edge that is not `node`. */
function otherEnd(edge: RoadGraphEdge, node: number): number {
  return edge.a === node ? edge.b : edge.a;
}

/** True when a car may leave `node` along `edge` (one-way edges only from their `a` end). */
function leavesNode(edge: RoadGraphEdge, node: number): boolean {
  return edge.a === node || !edge.oneway;
}

/** Traffic-class edges whose midpoint lies within `radiusM` of `centre`. */
export function trafficEdgesWithin(
  graph: RailGraph,
  centre: Point,
  radiusM: number,
): number[] {
  const edges: number[] = [];
  graph.edges.forEach((edge, index) => {
    if (!isTrafficEdge(edge)) return;
    const middleX = (graph.nodes[edge.a][0] + graph.nodes[edge.b][0]) / 2;
    const middleY = (graph.nodes[edge.a][1] + graph.nodes[edge.b][1]) / 2;
    if (Math.hypot(middleX - centre[0], middleY - centre[1]) <= radiusM)
      edges.push(index);
  });
  return edges;
}

/** A seeded next node for a car at `node`: along a traffic edge it may leave by, not back to `arrivedFrom` unless that is the only way; `null` when nothing leaves. */
export function nextTrafficNode(
  graph: RailGraph,
  node: number,
  arrivedFrom: number | null,
  random: () => number,
): number | null {
  const leaving = graph.adjacency[node].filter((edgeIndex) => {
    const edge = graph.edges[edgeIndex];
    return isTrafficEdge(edge) && leavesNode(edge, node);
  });
  const onward = leaving.filter(
    (edgeIndex) => otherEnd(graph.edges[edgeIndex], node) !== arrivedFrom,
  );
  const options = onward.length > 0 ? onward : leaving;
  if (options.length === 0) return null;
  const pick =
    options[
      Math.min(options.length - 1, Math.floor(random() * options.length))
    ];
  return otherEnd(graph.edges[pick], node);
}

/** The node passed before the last node of `path`: the previous path node, else `fromNode`, else unknown. */
function nodeBefore(path: number[], fromNode: number): number | null {
  if (path.length > 1) return path[path.length - 2];
  return path.length === 1 ? fromNode : null;
}

/** Extends a traffic driver's path with seeded turns until TRAFFIC_PATH_AHEAD nodes lie ahead; a driver with an unknown `fromNode` is left alone. */
export function extendPath(
  graph: RailGraph,
  driver: DriverState,
  random: () => number,
): DriverState {
  if (driver.fromNode === null) return driver;
  const path = [...driver.path];
  while (path.length < TRAFFIC_PATH_AHEAD) {
    const last = path.length > 0 ? path[path.length - 1] : driver.fromNode;
    const next = nextTrafficNode(
      graph,
      last,
      nodeBefore(path, driver.fromNode),
      random,
    );
    if (next === null) break;
    path.push(next);
  }
  return path.length === driver.path.length ? driver : { ...driver, path };
}

/** Lane offset of the traffic edge joining `from` and `to`; 0 (the centre line) when no traffic-class edge joins them. */
export function laneOffsetBetween(
  graph: RailGraph,
  from: number,
  to: number,
): number {
  for (const edgeIndex of graph.adjacency[from]) {
    const edge = graph.edges[edgeIndex];
    if (otherEnd(edge, from) === to && isTrafficEdge(edge))
      return laneOffsetM(edge.roadClass);
  }
  return 0;
}

/** The point a driver steers for: the next path node shifted into the lane, or `null` with nothing ahead. */
export function driverTarget(
  graph: RailGraph,
  driver: DriverState,
): Point | null {
  if (driver.fromNode === null || driver.path.length === 0) return null;
  const next = driver.path[0];
  return laneTarget(
    graph,
    driver.fromNode,
    next,
    laneOffsetBetween(graph, driver.fromNode, next),
  );
}

/** Drops the path nodes the car has reached (within NODE_REACH_M of their lane target); each becomes the new `fromNode`. */
export function advanceDriver(
  graph: RailGraph,
  driver: DriverState,
  vehicle: VehicleState,
): DriverState {
  let current = driver;
  for (;;) {
    const target = driverTarget(graph, current);
    if (!target) return current;
    if (Math.hypot(target[0] - vehicle.x, target[1] - vehicle.y) > NODE_REACH_M)
      return current;
    current = {
      ...current,
      fromNode: current.path[0],
      path: current.path.slice(1),
    };
  }
}

/** A traffic car in the right lane of `rail`'s edge, facing along it and already rolling at `cruiseMps`, with its driver. */
export function createTrafficCar(
  id: number,
  graph: RailGraph,
  rail: RailPosition,
  kind: VehicleKind,
  colour: number,
  cruiseMps: number,
): DrivenCar {
  const edge = graph.edges[rail.edge];
  const heading = railHeading(graph, rail);
  const lane = railPoint(
    graph,
    { ...rail, side: 1 },
    laneOffsetM(edge.roadClass),
  );
  const vehicle: VehicleState = {
    ...createVehicle(id, kind, lane, heading, colour),
    velocityX: Math.cos(heading) * cruiseMps,
    velocityY: Math.sin(heading) * cruiseMps,
  };
  const driver: DriverState = {
    vehicleId: id,
    role: "traffic",
    cruiseMps,
    fromNode: rail.direction === 1 ? edge.a : edge.b,
    path: [railEndNode(graph, rail)],
    repathTick: 0,
  };
  return { vehicle, driver };
}

/** A seeded rail on one of `edges`: driven a→b when the edge is one-way, by a coin flip otherwise. */
function trafficRail(
  graph: RailGraph,
  edges: number[],
  random: () => number,
): RailPosition {
  const edge =
    edges[Math.min(edges.length - 1, Math.floor(random() * edges.length))];
  const direction: 1 | -1 =
    graph.edges[edge].oneway || random() >= COIN_FLIP ? 1 : -1;
  return { edge, direction, edgeT: random(), side: 1 };
}

/** Up to `count` seeded traffic cars on the zone's through-roads, ≥ 30 m from `avoid`, ≥ 12 m from `occupied` and each other, outside `viewRect`; ids count up from `firstId`. */
export function spawnTraffic(
  zone: MapZone,
  graph: RailGraph,
  random: () => number,
  avoid: Point[],
  occupied: Point[],
  viewRect: Rect | null,
  firstId: number,
  count: number,
): DrivenCar[] {
  const edges = trafficEdgesWithin(
    graph,
    zoneCentreMetres(zone),
    zoneRadiusMetres(zone),
  );
  const cars: DrivenCar[] = [];
  if (edges.length === 0) return cars;
  const placed: Point[] = [...occupied];
  const attempts = count * SPAWN_ATTEMPTS;
  for (let attempt = 0; attempt < attempts && cars.length < count; attempt++) {
    const rail = trafficRail(graph, edges, random);
    const kind = TRAFFIC_KINDS[Math.floor(random() * TRAFFIC_KINDS.length)];
    const colour = Math.floor(random() * VEHICLE_COLOUR_COUNT);
    const cruise =
      TRAFFIC_MIN_SPEED_MPS +
      random() * (TRAFFIC_MAX_SPEED_MPS - TRAFFIC_MIN_SPEED_MPS);
    const car = createTrafficCar(
      firstId + cars.length,
      graph,
      rail,
      kind,
      colour,
      cruise,
    );
    const point: Point = [car.vehicle.x, car.vehicle.y];
    if (!farFromAll(point, avoid, TRAFFIC_SPAWN_MIN_FROM_PLAYER_M)) continue;
    if (!farFromAll(point, placed, MIN_CAR_SPACING_M)) continue;
    if (viewRect && pointInRect(point, viewRect)) continue;
    cars.push(car);
    placed.push(point);
  }
  return cars;
}

/** Points an AI driver must not drive into: other cars, living pedestrians and cops, and — for traffic — players on foot; police ignore the players and their car (that is the ram). */
export function obstaclePoints(
  state: ArenaState,
  driver: DriverState,
): Point[] {
  const points: Point[] = [];
  for (const vehicle of state.vehicles) {
    if (vehicle.id === driver.vehicleId) continue;
    if (driver.role === "police" && driverPlayer(state, vehicle.id)) continue;
    points.push([vehicle.x, vehicle.y]);
  }
  for (const ped of alivePeds(state.peds)) points.push([ped.x, ped.y]);
  for (const cop of state.cops)
    if (cop.diedAtTick === null) points.push([cop.x, cop.y]);
  if (driver.role === "police") return points;
  for (const player of playersOf(state))
    if (!isDead(player) && player.vehicleId === null)
      points.push([player.x, player.y]);
  return points;
}

/** The car a driver sits in, when it still exists and is intact. */
function drivenVehicle(
  state: ArenaState,
  driver: DriverState,
): VehicleState | null {
  const vehicle = state.vehicles.find(
    (candidate) => candidate.id === driver.vehicleId,
  );
  return vehicle && !vehicle.wrecked ? vehicle : null;
}

/** The ram point for a police car within the chase range, else `null`. */
function ramPoint(
  driver: DriverState,
  vehicle: VehicleState,
  chase: ChaseTarget | null,
): Point | null {
  if (driver.role !== "police" || !chase) return null;
  const distance = Math.hypot(
    chase.point[0] - vehicle.x,
    chase.point[1] - vehicle.y,
  );
  return distance <= chase.rangeM ? chase.point : null;
}

/** One tick of every AI driver: drivers whose car is gone or wrecked are dropped, paths advance (traffic extends them with seeded turns), and each car with a target gets controls; police cars within the chase range head straight for its point. */
export function stepDrivers(
  state: ArenaState,
  world: DriverWorld,
  random: () => number,
  chase: ChaseTarget | null,
): DriverStep {
  const traffic: DriverState[] = [];
  const controls = new Map<number, VehicleControls>();
  for (const driver of state.traffic) {
    const vehicle = drivenVehicle(state, driver);
    if (!vehicle) continue;
    let next = advanceDriver(world.graph, driver, vehicle);
    if (next.role === "traffic") next = extendPath(world.graph, next, random);
    traffic.push(next);
    const target =
      ramPoint(next, vehicle, chase) ?? driverTarget(world.graph, next);
    if (!target) continue;
    const blocked = obstacleAhead(
      vehicle,
      obstaclePoints(state, next),
      TRAFFIC_LOOK_AHEAD_M,
      TRAFFIC_LOOK_AHEAD_HALF_WIDTH_M,
    );
    controls.set(
      vehicle.id,
      driveControls(vehicle, target, next.cruiseMps, blocked),
    );
  }
  return { traffic, controls };
}
```

- [x] **Step 4: Replace node parking by kerb parking, populate traffic and wire the drivers into `arena.ts`**

`src/lib/cityArena/sim/spawn.ts` becomes (the spawn-node choice functions are unchanged; `pickParkingNodes` goes away):

```ts
// src/lib/cityArena/sim/spawn.ts
import type { MapIndex, MapZone } from "../world/mapTypes";
import {
  PARKING_ROAD_CLASSES,
  edgeLengthM,
  kerbOffsetM,
  railHeading,
  railPoint,
} from "../world/pavements";
import { fromUnits, type Point } from "../world/projection";
import type { RoadGraph, RoadGraphEdge } from "../world/roadGraph";
import {
  distanceToZoneEdge,
  pickSpawn,
  zoneCentreMetres,
  zoneRadiusMetres,
} from "../world/zone";
import { CAR_BODY_RADIUS_M } from "./collisions";
import { PLAYER_RADIUS_M } from "./player";
import type { RailPosition, VehicleKind, VehicleState } from "./types";
import { VEHICLE_COLOUR_COUNT, createVehicle } from "./vehicle";

/** Most parked cars per zone (documented cap, so four zones stay under the vehicle limit). */
export const PARKED_CARS_PER_ZONE = 30;
/** Spacing of parking spots along a kerb (spec §5: ≈ 1 per 40 m). */
export const PARKING_INTERVAL_M = 40;
/** Minimum distance between two parked cars. */
export const MIN_CAR_SPACING_M = 12;
/** Minimum distance between a parked car and a point in the avoid list (the player spawn). */
export const MIN_CAR_TO_PLAYER_M = 8;
/** Extra room beyond bare contact between a respawning player and a parked car (m). */
const RESPAWN_CAR_MARGIN_M = 1;
/** Minimum distance a respawn point keeps from any intact vehicle, so players cannot respawn on a car. */
export const RESPAWN_CAR_CLEARANCE_M =
  CAR_BODY_RADIUS_M + PLAYER_RADIUS_M + RESPAWN_CAR_MARGIN_M;
/** Kinds parked cars are drawn from; police cars arrive with the wanted level. */
export const PARKED_CAR_KINDS: VehicleKind[] = ["compact", "sedan", "sport"];
/** Search radius when snapping a spawn node to the road graph for its heading. */
const ROAD_SNAP_M = 30;
/** Candidate scores within this distance of the best count as ties for the seeded tie-break. */
const TIE_TOLERANCE_M = 1;
/** Below this random draw an edge's cars park on its left kerb, facing b→a. */
const COIN_FLIP = 0.5;

/** The part of the road graph the spawner reads. */
export type SpawnGraph = Pick<
  RoadGraph,
  "nodes" | "edges" | "adjacency" | "nearestNode"
>;

/** A kerb-side parking spot: the car centre and the heading it faces. */
export type ParkingSpot = { point: Point; heading: number };

/** Fisher–Yates shuffle driven by the seeded generator; returns a new array. */
export function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

/** Heading of the first road edge at the node nearest to `point`; east when no road is within reach. */
export function roadHeadingAt(graph: SpawnGraph, point: Point): number {
  const node = graph.nearestNode(point, ROAD_SNAP_M);
  if (node === null || graph.adjacency[node].length === 0) return 0;
  const edge = graph.edges[graph.adjacency[node][0]];
  const other = edge.a === node ? edge.b : edge.a;
  return Math.atan2(
    graph.nodes[other][1] - graph.nodes[node][1],
    graph.nodes[other][0] - graph.nodes[node][0],
  );
}

/** Spawn nodes of a zone in metres. */
function spawnNodesMetres(zone: MapZone): Point[] {
  return zone.spawnNodes.map(([x, y]) => [fromUnits(x), fromUnits(y)]);
}

/** True when `point` is at least `minimum` metres from every point in `others`. */
export function farFromAll(
  point: Point,
  others: Point[],
  minimum: number,
): boolean {
  return others.every(
    (other) => Math.hypot(other[0] - point[0], other[1] - point[1]) >= minimum,
  );
}

/** True for edges of a class cars park along. */
export function isParkingEdge(edge: RoadGraphEdge): boolean {
  return PARKING_ROAD_CLASSES.includes(edge.roadClass);
}

/** Parking spots along one edge: a seeded kerb (left kerb ⇒ cars face b→a) and start offset, then one every 40 m; each car faces its own direction of travel. */
export function edgeParkingSpots(
  graph: SpawnGraph,
  edgeIndex: number,
  random: () => number,
): ParkingSpot[] {
  const roadClass = graph.edges[edgeIndex].roadClass;
  const length = edgeLengthM(graph, edgeIndex);
  const direction: 1 | -1 = random() < COIN_FLIP ? -1 : 1;
  const start = random() * PARKING_INTERVAL_M;
  const spots: ParkingSpot[] = [];
  for (let along = start; along < length; along += PARKING_INTERVAL_M) {
    const progress = along / length;
    const rail: RailPosition = {
      edge: edgeIndex,
      direction,
      edgeT: direction === 1 ? progress : 1 - progress,
      side: 1,
    };
    spots.push({
      point: railPoint(graph, rail, kerbOffsetM(roadClass)),
      heading: railHeading(graph, rail),
    });
  }
  return spots;
}

/** Every parking spot of a zone: along each parking-class edge whose midpoint lies inside the zone disc, in edge order. */
export function zoneParkingSpots(
  graph: SpawnGraph,
  zone: MapZone,
  random: () => number,
): ParkingSpot[] {
  const centre = zoneCentreMetres(zone);
  const radius = zoneRadiusMetres(zone);
  const spots: ParkingSpot[] = [];
  graph.edges.forEach((edge, index) => {
    if (!isParkingEdge(edge)) return;
    const middleX = (graph.nodes[edge.a][0] + graph.nodes[edge.b][0]) / 2;
    const middleY = (graph.nodes[edge.a][1] + graph.nodes[edge.b][1]) / 2;
    if (Math.hypot(middleX - centre[0], middleY - centre[1]) > radius) return;
    spots.push(...edgeParkingSpots(graph, index, random));
  });
  return spots;
}

/** Up to PARKED_CARS_PER_ZONE of a zone's spots in seeded order, ≥ 12 m apart and ≥ 8 m from `avoid`. */
function pickParkingSpots(
  graph: SpawnGraph,
  zone: MapZone,
  random: () => number,
  avoid: Point[],
): ParkingSpot[] {
  const chosen: ParkingSpot[] = [];
  for (const spot of shuffle(zoneParkingSpots(graph, zone, random), random)) {
    if (chosen.length >= PARKED_CARS_PER_ZONE) break;
    if (!farFromAll(spot.point, avoid, MIN_CAR_TO_PLAYER_M)) continue;
    const taken = chosen.map((candidate) => candidate.point);
    if (!farFromAll(spot.point, taken, MIN_CAR_SPACING_M)) continue;
    chosen.push(spot);
  }
  return chosen;
}

/** Parks seeded cars half on the kerbs of every zone's residential and service roads, facing their direction of travel; ids count up from `firstId`. */
export function spawnParkedCars(
  index: MapIndex,
  graph: SpawnGraph,
  random: () => number,
  avoid: Point[],
  firstId: number,
): VehicleState[] {
  const cars: VehicleState[] = [];
  for (const zone of index.zones) {
    for (const spot of pickParkingSpots(graph, zone, random, avoid)) {
      const kind =
        PARKED_CAR_KINDS[Math.floor(random() * PARKED_CAR_KINDS.length)];
      const colour = Math.floor(random() * VEHICLE_COLOUR_COUNT);
      cars.push(
        createVehicle(
          firstId + cars.length,
          kind,
          spot.point,
          spot.heading,
          colour,
        ),
      );
    }
  }
  return cars;
}

/** Smallest distance from `point` to any threat. */
function nearestThreatDistance(point: Point, threats: Point[]): number {
  return Math.min(
    ...threats.map((threat) =>
      Math.hypot(threat[0] - point[0], threat[1] - point[1]),
    ),
  );
}

/**
 * Spec §5 spawn choice: the node maximising the minimum distance to `threats`, ties (within
 * 1 m) broken by the seed; a seeded random node when there are no threats.
 */
export function chooseSpawnNode(
  zone: MapZone,
  threats: Point[],
  random: () => number,
): Point {
  const nodes = spawnNodesMetres(zone);
  if (threats.length === 0 || nodes.length === 0)
    return pickSpawn(zone, random);
  const scores = nodes.map((node) => nearestThreatDistance(node, threats));
  const best = Math.max(...scores);
  const ties = nodes.filter(
    (_, index) => scores[index] >= best - TIE_TOLERANCE_M,
  );
  return ties[Math.min(ties.length - 1, Math.floor(random() * ties.length))];
}

/**
 * Spawn node for a respawn: a seeded random node, skipping any within
 * `RESPAWN_CAR_CLEARANCE_M` of a point in `blockedBy` (spec §5: never respawn on a car) so a
 * respawning player cannot land on a parked or driven vehicle. Falls back to
 * {@link chooseSpawnNode}'s unfiltered pick when every node is blocked.
 */
export function chooseRespawnNode(
  zone: MapZone,
  blockedBy: Point[],
  random: () => number,
): Point {
  const clear = spawnNodesMetres(zone).filter((node) =>
    farFromAll(node, blockedBy, RESPAWN_CAR_CLEARANCE_M),
  );
  if (clear.length === 0) return chooseSpawnNode(zone, [], random);
  return clear[Math.min(clear.length - 1, Math.floor(random() * clear.length))];
}

/** The zone whose edge is nearest to `point`; used to respawn after dying outside every disc. */
export function nearestZone(index: MapIndex, point: Point): MapZone | null {
  let best: MapZone | null = null;
  let bestDistance = Infinity;
  for (const zone of index.zones) {
    const distance = distanceToZoneEdge(zone, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = zone;
    }
  }
  return best;
}
```

`src/lib/cityArena/sim/populate.ts` becomes:

```ts
// src/lib/cityArena/sim/populate.ts
import type { Rect } from "../mapBuild/geometry";
import type { MapIndex, MapZone } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { MAX_PEDS, MAX_TRAFFIC, MAX_VEHICLES } from "./limits";
import {
  PEDS_PER_ZONE,
  PED_RESPAWN_BATCH,
  PED_RESPAWN_INTERVAL_TICKS,
  alivePeds,
  spawnPeds,
} from "./peds";
import { placePickups } from "./pickups";
import { playersOf } from "./players";
import { nearestZone, type SpawnGraph } from "./spawn";
import {
  TRAFFIC_MAX_PER_ZONE,
  TRAFFIC_MIN_PER_ZONE,
  spawnTraffic,
  type DrivenCar,
} from "./traffic";
import type { ArenaState } from "./types";

/** Every this many ticks wrecked or stolen ambient traffic is replaced, one car at a time. */
export const TRAFFIC_TOP_UP_INTERVAL_TICKS = 150;
/** Traffic cars replaced per top-up. */
const TRAFFIC_TOP_UP_BATCH = 1;

/** What population reads from the world. */
export type PopulationWorld = {
  index: MapIndex;
  graph: SpawnGraph;
  viewRect?: Rect;
};

/** Where the players stand, for the spawn avoid lists. */
function playerPoints(state: ArenaState): Point[] {
  return playersOf(state).map((player) => [player.x, player.y]);
}

/** Where the cars stand, so fresh traffic never spawns on one. */
function vehiclePoints(state: ArenaState): Point[] {
  return state.vehicles.map((vehicle) => [vehicle.x, vehicle.y]);
}

/** Drops the population of the previous zone: pickups, pedestrians, cops, AI-driven cars and wrecks (never the player's car). */
function clearPopulation(state: ArenaState): ArenaState {
  const driven = new Set(state.traffic.map((driver) => driver.vehicleId));
  const vehicles = state.vehicles.filter(
    (vehicle) =>
      vehicle.id === state.player.vehicleId ||
      (!driven.has(vehicle.id) && !vehicle.wrecked),
  );
  return { ...state, vehicles, peds: [], cops: [], pickups: [], traffic: [] };
}

/** The state with `cars` added as vehicles plus drivers. */
function addDrivenCars(state: ArenaState, cars: DrivenCar[]): ArenaState {
  if (cars.length === 0) return state;
  return {
    ...state,
    vehicles: [...state.vehicles, ...cars.map((car) => car.vehicle)],
    traffic: [...state.traffic, ...cars.map((car) => car.driver)],
    nextId: state.nextId + cars.length,
  };
}

/** The zone's ambient traffic: a seeded count of 6–10 cars on the through-roads, away from the players and the parked cars. */
function spawnZoneTraffic(
  state: ArenaState,
  zone: MapZone,
  graph: SpawnGraph,
  random: () => number,
): ArenaState {
  const span = TRAFFIC_MAX_PER_ZONE - TRAFFIC_MIN_PER_ZONE + 1;
  const count = TRAFFIC_MIN_PER_ZONE + Math.floor(random() * span);
  return addDrivenCars(
    state,
    spawnTraffic(
      zone,
      graph,
      random,
      playerPoints(state),
      vehiclePoints(state),
      null,
      state.nextId,
      count,
    ),
  );
}

/** Makes `zone` the active zone: clears the old population, places the zone's pickups and spawns its pedestrians and traffic away from the players. */
export function populateZone(
  state: ArenaState,
  zone: MapZone,
  index: MapIndex,
  graph: SpawnGraph,
  random: () => number,
): ArenaState {
  const cleared = clearPopulation(state);
  const avoid = playerPoints(cleared);
  const pickups = placePickups(
    index,
    zone,
    graph,
    random,
    avoid,
    cleared.nextId,
  );
  const peds = spawnPeds(
    zone,
    graph,
    random,
    avoid,
    null,
    cleared.nextId + pickups.length,
    PEDS_PER_ZONE,
  );
  const populated: ArenaState = {
    ...cleared,
    activeZoneKey: zone.key,
    pickups,
    peds,
    nextId: cleared.nextId + pickups.length + peds.length,
  };
  return spawnZoneTraffic(populated, zone, graph, random);
}

/** Replaces missing pedestrians in batches of at most 5, staying under the caps and out of view. */
export function topUpPeds(
  state: ArenaState,
  zone: MapZone,
  world: PopulationWorld,
  random: () => number,
): ArenaState {
  const room = Math.min(
    PEDS_PER_ZONE - alivePeds(state.peds).length,
    MAX_PEDS - state.peds.length,
    PED_RESPAWN_BATCH,
  );
  if (room <= 0) return state;
  const fresh = spawnPeds(
    zone,
    world.graph,
    random,
    playerPoints(state),
    world.viewRect ?? null,
    state.nextId,
    room,
  );
  if (fresh.length === 0) return state;
  return {
    ...state,
    peds: [...state.peds, ...fresh],
    nextId: state.nextId + fresh.length,
  };
}

/** Replaces missing ambient traffic one car per top-up, up to the zone minimum and under the caps, out of view. */
export function topUpTraffic(
  state: ArenaState,
  zone: MapZone,
  world: PopulationWorld,
  random: () => number,
): ArenaState {
  const ambient = state.traffic.filter(
    (driver) => driver.role === "traffic",
  ).length;
  if (
    ambient >= TRAFFIC_MIN_PER_ZONE ||
    state.traffic.length >= MAX_TRAFFIC ||
    state.vehicles.length >= MAX_VEHICLES
  )
    return state;
  return addDrivenCars(
    state,
    spawnTraffic(
      zone,
      world.graph,
      random,
      playerPoints(state),
      vehiclePoints(state),
      world.viewRect ?? null,
      state.nextId,
      TRAFFIC_TOP_UP_BATCH,
    ),
  );
}

/** Re-populates when the zone nearest the player is no longer the active one; otherwise tops up pedestrians every 30 ticks and traffic every 150. */
export function applyPopulation(
  state: ArenaState,
  world: PopulationWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const [player] = playersOf(state);
  const zone = nearestZone(world.index, [player.x, player.y]);
  if (!zone) return state;
  if (zone.key !== state.activeZoneKey)
    return populateZone(state, zone, world.index, world.graph, random);
  let next = state;
  if (tick % PED_RESPAWN_INTERVAL_TICKS === 0)
    next = topUpPeds(next, zone, world, random);
  if (tick % TRAFFIC_TOP_UP_INTERVAL_TICKS === 0)
    next = topUpTraffic(next, zone, world, random);
  return next;
}
```

In `src/lib/cityArena/sim/arena.ts`: add `IMPACT_DAMAGE_THRESHOLD_MPS` to the `./damage` import, `import { stepDrivers } from "./traffic";`, and `type ArenaEvent` to the `./types` import; then replace `enterVehicle`, `stepVehicles` and `moveEntities`, and update `stepArena`:

```ts
/** Instappen: board the nearest intact car whose body is within reach; an AI driver sitting in it is thrown out. */
function enterVehicle(state: ArenaState): ArenaState {
  const at: Point = [state.player.x, state.player.y];
  let best: VehicleState | null = null;
  let bestDistance = ENTER_RANGE_M;
  for (const vehicle of state.vehicles) {
    if (vehicle.wrecked) continue;
    const distance = distanceToVehicle(vehicle, at);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = vehicle;
    }
  }
  if (!best) return state;
  const boarded = best.id;
  return {
    ...state,
    traffic: state.traffic.filter((driver) => driver.vehicleId !== boarded),
    player: {
      ...state.player,
      vehicleId: boarded,
      boardingTicksLeft: BOARDING_TICKS,
      x: best.x,
      y: best.y,
      facing: best.heading,
      speed: 0,
    },
  };
}
```

```ts
/** True for a car nobody drives that is standing still: it skips the physics until something moves it. */
function isAsleep(
  vehicle: VehicleState,
  controls: VehicleControls | undefined,
): boolean {
  return (
    controls === undefined && vehicle.velocityX === 0 && vehicle.velocityY === 0
  );
}

/** The events plus an impact event when the approach speed is above the damage threshold. */
function withImpactEvent(
  events: ArenaEvent[],
  vehicleId: number,
  otherVehicleId: number | null,
  impactSpeed: number,
): ArenaEvent[] {
  if (impactSpeed <= IMPACT_DAMAGE_THRESHOLD_MPS) return events;
  return pushEvent(events, {
    kind: "impact",
    vehicleId,
    otherVehicleId,
    impactSpeed,
  });
}

/** Cars and events after one tick of physics. */
type VehiclesStep = { vehicles: VehicleState[]; events: ArenaEvent[] };

/** Steps every awake car with its driver's controls (the player's or an AI's), then applies building and car–car impact damage and records the impacts. */
function stepVehicles(
  state: ArenaState,
  playerControls: VehicleControls,
  dt: number,
  world: ArenaWorld,
  aiControls: Map<number, VehicleControls>,
): VehiclesStep {
  let events = state.events;
  const stepped = state.vehicles.map((vehicle) => {
    const controls =
      vehicle.id === state.player.vehicleId
        ? playerControls
        : aiControls.get(vehicle.id);
    if (isAsleep(vehicle, controls)) return vehicle;
    const result = stepVehicle(
      vehicle,
      controls ?? NO_CONTROLS,
      dt,
      world.collision,
    );
    events = withImpactEvent(events, vehicle.id, null, result.impactSpeed);
    return damageVehicle(result.vehicle, impactDamage(result.impactSpeed));
  });
  const pairs = resolveVehiclePairs(stepped);
  const damaged = [...pairs.vehicles];
  for (const impact of pairs.impacts) {
    const amount = impactDamage(impact.impactSpeed);
    damaged[impact.first] = damageVehicle(damaged[impact.first], amount);
    damaged[impact.second] = damageVehicle(damaged[impact.second], amount);
    events = withImpactEvent(
      events,
      damaged[impact.first].id,
      damaged[impact.second].id,
      impact.impactSpeed,
    );
  }
  return { vehicles: damaged, events };
}

/** Moves the AI drivers, the cars and the player for one tick. */
function moveEntities(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const driving = occupiedVehicle(state);
  const canDrive =
    driving !== null &&
    !isDead(state.player) &&
    state.player.boardingTicksLeft === 0;
  const controls = canDrive ? controlsFromInput(input) : NO_CONTROLS;
  const drivers = stepDrivers(state, world, random, null);
  const moved = stepVehicles(state, controls, dt, world, drivers.controls);
  const next: ArenaState = {
    ...state,
    traffic: drivers.traffic,
    vehicles: moved.vehicles,
    events: moved.events,
  };
  if (driving) {
    const ridden =
      moved.vehicles.find((vehicle) => vehicle.id === driving.id) ?? driving;
    return { ...next, player: ridePlayer(state.player, ridden) };
  }
  return {
    ...next,
    player: walkPlayer(state, input, dt, world, moved.vehicles, tick),
  };
}
```

```ts
/** One fixed step of the arena: the single simulation entry point. */
export function stepArena(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  random: () => number,
): ArenaState {
  const tick = state.tick + 1;
  const edges = detectEdges(state.held, input);
  let next: ArenaState = { ...state, tick, held: edges.held, events: [] };
  next = applyPopulation(next, world, tick, random);
  next = applyRespawn(next, world, tick, random);
  next = stepPickups(next, tick);
  next = applyWeaponSwitch(next, edges.weaponPressed);
  next = applyEnterExit(next, edges.enterPressed, world);
  next = moveEntities(next, input, dt, world, tick, random);
  next = applyFire(next, input, tick, random);
  next = stepPeds(next, world, dt, tick, random);
  next = advanceBullets(next, dt, world, tick);
  next = applyExplosions(next, world, tick);
  next = ejectIfDead(next, world);
  const zone = findZone(world.index, [next.player.x, next.player.y]);
  return {
    ...next,
    effects: pruneEffects(next.effects, tick),
    zoneKey: zone?.key ?? null,
  };
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run src/lib/cityArena src/components/cityArena`
Expected: `tsc` clean; PASS — driver 6, traffic 7, spawn 7 (the parking test became three), populate 5, arena (+2, two rewritten), and every other suite: the overlay test's single residential edge now carries up to three kerb-parked cars at y = ±3.3 (none of its assertions count cars) and the hook test's empty graph parks nothing. Worked numbers: lanes are max(width/4, 1.6 + 0.1) = 1.7 m on 6 m roads and 1.75 m on a 7 m tertiary, so two AI lanes sit 3.4–3.5 m apart, clear of the 3.2 m car–car contact distance; a parked car at 3.3 m on a residential street clears a centre-line driver by 0.1 m; the eastbound car at (0, 0) sees a point 5 m ahead because 5 > 2.1 (half a car length) and 13 m is beyond 2.1 + 10; a car rolling 10 m/s with a 5 m/s turn target has a −5 gap, which is below −1, so it brakes; with `() => 0` the 100 m edge parks on its left kerb (y = −3.3, facing west) at 0, 40 and 80 m, with `() => 0.99` on the right kerb from 39.6 m; the spawn-test zone yields 3 + 3 + 3 = 9 spots and the 300 m arena road 7 or 8 spots, of which at most one lies within 8 m of the player's node (hypot(dx, 3.3) < 8 ⇔ |dx| < 7.3 m), giving 6–8 parked cars; the head-on crash approaches at 8.0 m/s after one tick of rolling deceleration (8.1 − 3/30), above the 4 m/s threshold, so exactly one `impact` event carries both ids; the traffic car starting 20 m short of the pedestrian sees it once it is within 12.1 m (after 7.9 m at 10 m/s ≈ 24 ticks), brakes at 14 m/s² over 3.6 m and stops at x ≈ 41.7, inside (38, 45), 8 m short of the pedestrian; unblocked it holds 10 m/s (the throttle alternates between 0 and a proportional creep) and covers ≈ 20 m in 60 ticks.

- [x] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/sim
git add src/lib/cityArena/sim
git commit -m "feat(arena): AI drivers, ambient traffic and kerb-side parking

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Heat, the wanted level and the zone rule

**Files:**

- Create: `src/lib/cityArena/sim/wanted.ts`
- Create: `src/lib/cityArena/sim/zoneRule.ts`
- Modify: `src/lib/cityArena/sim/types.ts` (`ArenaEvent` gains the `zone` kind)
- Modify: `src/lib/cityArena/sim/arena.ts` (`stepArena` gains `applyZoneRule` and `applyWanted`)
- Test: `src/lib/cityArena/sim/wanted.test.ts`, `src/lib/cityArena/sim/zoneRule.test.ts`, `src/lib/cityArena/sim/arena.test.ts` (extend)

**Interfaces:**

- Consumes: `ArenaEvent`, `ArenaPlayerState`, `ArenaState`, `CopState`, `DriverState` (Task 1); `eventsOfKind`, `pushEvent` (Task 1); `playersOf`, `replacePlayer` (Task 1); `damagePlayer`, `isDead` (`./damage`); `SIM_STEP_S` (`./player`); `distanceToZoneEdge`, `findZoneByKey` (`../world/zone`); `MapIndex`, `MapZone`.
- Produces: `ArenaEvent` gains `{ kind: "zone"; playerId: number; phase: "warning" | "damage" }`; `HEAT_PED_KILL = 30`, `HEAT_COP_KILL = 60`, `HEAT_SHOT_NEAR_COP = 10`, `HEAT_RAM_POLICE = 20`, `HEAT_NEAR_COP_M = 15`, `HEAT_QUIET_TICKS = 240`, `HEAT_DECAY_PER_S = 5`, `HEAT_PER_LEVEL = 40`, `MAX_WANTED_LEVEL = 3`, `wantedLevel(heat): number`, `addHeat(player, amount, tick): ArenaPlayerState`, `decayHeat(player, tick): ArenaPlayerState`, `heatFromEvents(events, player, cops, traffic): number`, `wantedTarget(state): ArenaPlayerState | null`, `currentWantedLevel(state): number`, `applyWanted(state, tick): ArenaState`; `ZONE_WARNING_TICKS = 150`, `ZONE_DAMAGE_PER_S = 10`, `ZONE_DAMAGE_INTERVAL_TICKS = 30`, `zoneSecondsLeft(player, tick): number | null`, `applyZoneRule(state, index, tick): ArenaState`; `stepArena` runs `applyZoneRule` then `applyWanted` after the explosions.

- [x] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/sim/wanted.test.ts
import { describe, expect, it } from "vitest";
import type { MapIndex } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import { createRng } from "./rng";
import type { ArenaEvent, ArenaState, CopState, DriverState } from "./types";
import {
  HEAT_QUIET_TICKS,
  addHeat,
  applyWanted,
  currentWantedLevel,
  decayHeat,
  heatFromEvents,
  wantedLevel,
  wantedTarget,
} from "./wanted";

const emptyIndex: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};
const graph = decodeRoadGraph({ nodes: [], edges: [], classes: [], names: [] });

function lonePlayer(): ArenaState {
  return createArenaState(
    { index: emptyIndex, graph, seed: 1, zone: null },
    createRng(1),
  );
}

function copAt(
  id: number,
  x: number,
  diedAtTick: number | null = null,
): CopState {
  return {
    id,
    x,
    y: 0,
    facing: 0,
    health: diedAtTick === null ? 100 : 0,
    weapon: "pistol",
    path: [],
    repathTick: 0,
    nextShotTick: 0,
    diedAtTick,
  };
}

function policeDriver(vehicleId: number): DriverState {
  return {
    vehicleId,
    role: "police",
    cruiseMps: 18,
    fromNode: null,
    path: [],
    repathTick: 0,
  };
}

const pedKill: ArenaEvent = {
  kind: "kill",
  victim: "ped",
  killerId: 0,
  x: 1,
  y: 1,
};
const copKill: ArenaEvent = {
  kind: "kill",
  victim: "cop",
  killerId: 0,
  x: 2,
  y: 2,
};
const strangerKill: ArenaEvent = {
  kind: "kill",
  victim: "ped",
  killerId: 7,
  x: 3,
  y: 3,
};
const blastKill: ArenaEvent = {
  kind: "kill",
  victim: "ped",
  killerId: null,
  x: 4,
  y: 4,
};
const nearShot: ArenaEvent = {
  kind: "shot",
  weapon: "pistol",
  ownerId: 0,
  x: 0,
  y: 0,
};
const farShot: ArenaEvent = {
  kind: "shot",
  weapon: "pistol",
  ownerId: 0,
  x: 100,
  y: 0,
};
const strangerShot: ArenaEvent = {
  kind: "shot",
  weapon: "uzi",
  ownerId: 5,
  x: 0,
  y: 0,
};
const ram: ArenaEvent = {
  kind: "impact",
  vehicleId: 4,
  otherVehicleId: 9,
  impactSpeed: 6,
};
const rammed: ArenaEvent = {
  kind: "impact",
  vehicleId: 9,
  otherVehicleId: 4,
  impactSpeed: 6,
};
const wall: ArenaEvent = {
  kind: "impact",
  vehicleId: 4,
  otherVehicleId: null,
  impactSpeed: 6,
};
const fenderBender: ArenaEvent = {
  kind: "impact",
  vehicleId: 4,
  otherVehicleId: 8,
  impactSpeed: 6,
};

describe("heat bookkeeping", () => {
  it("turns heat into stars: one per 40, at most three", () => {
    expect(wantedLevel(0)).toBe(0);
    expect(wantedLevel(39)).toBe(0);
    expect(wantedLevel(40)).toBe(1);
    expect(wantedLevel(79)).toBe(1);
    expect(wantedLevel(80)).toBe(2);
    expect(wantedLevel(120)).toBe(3);
    expect(wantedLevel(500)).toBe(3);
  });

  it("adds heat with its tick and decays 5 per second after 240 quiet ticks", () => {
    const { player } = lonePlayer();
    expect(addHeat(player, 30, 10)).toMatchObject({ heat: 30, heatTick: 10 });
    expect(addHeat(player, 0, 10)).toBe(player);
    const heated = { ...player, heat: 30, heatTick: 10 };
    expect(decayHeat(heated, 10 + HEAT_QUIET_TICKS - 1)).toBe(heated);
    expect(decayHeat(heated, 10 + HEAT_QUIET_TICKS).heat).toBeCloseTo(
      30 - 1 / 6,
      4,
    );
    expect(decayHeat({ ...player, heat: 0.1, heatTick: 0 }, 300).heat).toBe(0);
    expect(decayHeat(player, 1000)).toBe(player);
  });

  it("sums this tick's heat sources for one player only", () => {
    const { player } = lonePlayer();
    const driver = { ...player, vehicleId: 4 };
    const cops = [copAt(50, 10)];
    const traffic = [
      policeDriver(9),
      { ...policeDriver(8), role: "traffic" as const },
    ];
    const events: ArenaEvent[] = [
      pedKill,
      copKill,
      strangerKill,
      blastKill,
      nearShot,
      farShot,
      strangerShot,
      ram,
      rammed,
      wall,
      fenderBender,
    ];
    expect(heatFromEvents(events, driver, cops, traffic)).toBe(140);
    expect(heatFromEvents(events, player, cops, traffic)).toBe(100);
    expect(heatFromEvents([nearShot], player, [copAt(50, 10, 3)], [])).toBe(0);
    expect(heatFromEvents([nearShot], player, [copAt(50, 15.1)], [])).toBe(0);
    expect(heatFromEvents([], driver, cops, traffic)).toBe(0);
  });

  it("names the wanted player and the level in force", () => {
    const state = lonePlayer();
    expect(wantedTarget(state)).toBeNull();
    expect(currentWantedLevel(state)).toBe(0);
    const wanted: ArenaState = {
      ...state,
      player: { ...state.player, heat: 40 },
    };
    expect(wantedTarget(wanted)).toBe(wanted.player);
    expect(currentWantedLevel(wanted)).toBe(1);
    const dead: ArenaState = {
      ...state,
      player: { ...state.player, heat: 80, health: 0, diedAtTick: 3 },
    };
    expect(wantedTarget(dead)).toBeNull();
  });
});

describe("applyWanted", () => {
  it("applies the sources, records level changes and leaves a quiet state untouched", () => {
    const state = lonePlayer();
    expect(applyWanted(state, 5)).toBe(state);
    const first = applyWanted({ ...state, events: [pedKill] }, 5);
    expect(first.player).toMatchObject({ heat: 30, heatTick: 5 });
    expect(first.events).toEqual([pedKill]);
    const second = applyWanted({ ...first, events: [pedKill] }, 6);
    expect(second.player.heat).toBe(60);
    expect(second.events).toEqual([
      pedKill,
      { kind: "wanted", playerId: 0, level: 1 },
    ]);
  });

  it("decays heat, drops a star when it crosses 40 and zeroes it on death", () => {
    const state = lonePlayer();
    const hot: ArenaState = {
      ...state,
      player: { ...state.player, heat: 60, heatTick: 0 },
    };
    const cooled = applyWanted(hot, HEAT_QUIET_TICKS);
    expect(cooled.player.heat).toBeCloseTo(60 - 1 / 6, 4);
    expect(cooled.events).toEqual([]);
    const edge: ArenaState = {
      ...state,
      player: { ...state.player, heat: 40.1, heatTick: 0 },
    };
    expect(applyWanted(edge, HEAT_QUIET_TICKS).events).toEqual([
      { kind: "wanted", playerId: 0, level: 0 },
    ]);
    const dead: ArenaState = {
      ...state,
      player: { ...state.player, heat: 80, health: 0, diedAtTick: 9 },
    };
    const zeroed = applyWanted(dead, 9);
    expect(zeroed.player.heat).toBe(0);
    expect(zeroed.events).toEqual([{ kind: "wanted", playerId: 0, level: 0 }]);
    expect(applyWanted(zeroed, 10)).toBe(zeroed);
  });
});
```

```ts
// src/lib/cityArena/sim/zoneRule.test.ts
import { describe, expect, it } from "vitest";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import { createRng } from "./rng";
import type { ArenaState } from "./types";
import { ZONE_WARNING_TICKS, applyZoneRule, zoneSecondsLeft } from "./zoneRule";

/** A 500 m zone around the origin with its only spawn node at the centre. */
const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [0, 0],
  radius: 2000,
  spawnNodes: [[0, 0]],
  landmarks: [],
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [zone],
  landmarks: [],
};
const graph = decodeRoadGraph({ nodes: [], edges: [], classes: [], names: [] });

/** The player standing at `x` on the zone's east–west line, with the rule on. */
function enforcedAt(x: number): ArenaState {
  const state = createArenaState({ index, graph, seed: 1, zone }, createRng(1));
  return { ...state, zoneEnforced: true, player: { ...state.player, x } };
}

describe("zoneSecondsLeft", () => {
  it("counts the whole seconds down from 5 and stays at 0 while the damage runs", () => {
    const outside = { outsideSinceTick: 10 };
    expect(zoneSecondsLeft({ outsideSinceTick: null }, 10)).toBeNull();
    expect(zoneSecondsLeft(outside, 10)).toBe(5);
    expect(zoneSecondsLeft(outside, 40)).toBe(4);
    expect(zoneSecondsLeft(outside, 159)).toBe(1);
    expect(zoneSecondsLeft(outside, 160)).toBe(0);
    expect(zoneSecondsLeft(outside, 400)).toBe(0);
  });
});

describe("applyZoneRule", () => {
  it("does nothing while the rule is off", () => {
    const off: ArenaState = { ...enforcedAt(600), zoneEnforced: false };
    expect(applyZoneRule(off, index, 5)).toBe(off);
  });

  it("starts the countdown on leaving, with a warning event, and clears it on returning", () => {
    const left = applyZoneRule(enforcedAt(600), index, 10);
    expect(left.player.outsideSinceTick).toBe(10);
    expect(left.events).toEqual([
      { kind: "zone", playerId: 0, phase: "warning" },
    ]);
    expect(zoneSecondsLeft(left.player, 10)).toBe(5);
    const stillOut = applyZoneRule({ ...left, events: [] }, index, 20);
    expect(stillOut.player.outsideSinceTick).toBe(10);
    expect(stillOut.events).toEqual([]);
    const back: ArenaState = {
      ...stillOut,
      player: { ...stillOut.player, x: 499 },
    };
    const home = applyZoneRule(back, index, 30);
    expect(home.player.outsideSinceTick).toBeNull();
    expect(home.events).toEqual([]);
    const inside = enforcedAt(100);
    expect(applyZoneRule(inside, index, 5)).toBe(inside);
  });

  it("lands 10 damage when the countdown ends and every 30 ticks after, never through the shield", () => {
    const base = enforcedAt(600);
    const outside: ArenaState = {
      ...base,
      player: { ...base.player, outsideSinceTick: 10 },
    };
    const lastSecond = 10 + ZONE_WARNING_TICKS - 1;
    expect(applyZoneRule(outside, index, lastSecond)).toBe(outside);
    const first = applyZoneRule(outside, index, 10 + ZONE_WARNING_TICKS);
    expect(first.player.health).toBe(90);
    expect(first.events).toEqual([
      { kind: "zone", playerId: 0, phase: "damage" },
    ]);
    expect(
      applyZoneRule(outside, index, 10 + ZONE_WARNING_TICKS + 29).player.health,
    ).toBe(100);
    expect(
      applyZoneRule(outside, index, 10 + ZONE_WARNING_TICKS + 30).player.health,
    ).toBe(90);
    const weak: ArenaState = {
      ...outside,
      player: { ...outside.player, health: 10 },
    };
    const fallen = applyZoneRule(weak, index, 10 + ZONE_WARNING_TICKS);
    expect(fallen.player).toMatchObject({
      health: 0,
      diedAtTick: 10 + ZONE_WARNING_TICKS,
    });
    const shielded: ArenaState = {
      ...outside,
      player: { ...outside.player, invulnerableUntilTick: 1000 },
    };
    expect(applyZoneRule(shielded, index, 10 + ZONE_WARNING_TICKS)).toBe(
      shielded,
    );
  });

  it("ignores dead players and clears timers when no zone is active", () => {
    const base = enforcedAt(600);
    const dead: ArenaState = {
      ...base,
      player: {
        ...base.player,
        health: 0,
        diedAtTick: 5,
        outsideSinceTick: 10,
      },
    };
    const cleared = applyZoneRule(dead, index, 200);
    expect(cleared.player).toMatchObject({ health: 0, outsideSinceTick: null });
    expect(cleared.events).toEqual([]);
    const homeless: ArenaState = {
      ...base,
      activeZoneKey: null,
      player: { ...base.player, outsideSinceTick: 10 },
    };
    expect(
      applyZoneRule(homeless, index, 200).player.outsideSinceTick,
    ).toBeNull();
  });
});
```

Extend `src/lib/cityArena/sim/arena.test.ts` (add `ZONE_WARNING_TICKS` from `./zoneRule` and `HEAT_QUIET_TICKS` from `./wanted` to the imports) with a new describe:

```ts
describe("stepArena wanted level and zone rule", () => {
  it("earns heat for a pedestrian kill, reaches one star at 40 and decays after eight quiet seconds", () => {
    const state = boot();
    const warm: ArenaState = {
      ...state,
      vehicles: [],
      traffic: [],
      peds: [pedAt(900, state.player.x + 5, state.player.y)],
      player: { ...state.player, heat: 30, heatTick: 0 },
    };
    const { state: shot, events } = runCollecting(
      warm,
      createInput({ fire: true, aim: 0 }),
      20,
    );
    expect(shot.player.heat).toBe(60);
    expect(events.filter((event) => event.kind === "wanted")).toEqual([
      { kind: "wanted", playerId: 0, level: 1 },
    ]);
    const cooling: ArenaState = {
      ...state,
      vehicles: [],
      traffic: [],
      peds: [],
      player: { ...state.player, heat: 39, heatTick: 0 },
    };
    expect(run(cooling, EMPTY_INPUT, HEAT_QUIET_TICKS - 1).player.heat).toBe(
      39,
    );
    expect(
      run(cooling, EMPTY_INPUT, HEAT_QUIET_TICKS + 1).player.heat,
    ).toBeCloseTo(39 - 2 / 6, 4);
  });

  it("zeroes heat the tick the player dies", () => {
    const state = boot();
    const dying: ArenaState = {
      ...state,
      player: { ...state.player, heat: 80, health: 0, diedAtTick: state.tick },
    };
    const dead = run(dying, EMPTY_INPUT, 1);
    expect(dead.player.heat).toBe(0);
    expect(dead.events).toEqual([{ kind: "wanted", playerId: 0, level: 0 }]);
  });

  it("warns, then hurts a player who leaves an enforced zone until they are back", () => {
    const state = boot();
    const outside: ArenaState = {
      ...state,
      zoneEnforced: true,
      player: { ...state.player, x: 700, y: 0 },
    };
    const warned = run(outside, EMPTY_INPUT, 1);
    expect(warned.player.outsideSinceTick).toBe(1);
    expect(warned.events).toContainEqual({
      kind: "zone",
      playerId: 0,
      phase: "warning",
    });
    expect(run(outside, EMPTY_INPUT, ZONE_WARNING_TICKS).player.health).toBe(
      100,
    );
    const hurt = run(outside, EMPTY_INPUT, ZONE_WARNING_TICKS + 1);
    expect(hurt.player.health).toBe(90);
    expect(hurt.events).toContainEqual({
      kind: "zone",
      playerId: 0,
      phase: "damage",
    });
    expect(
      run(outside, EMPTY_INPUT, ZONE_WARNING_TICKS + 31).player.health,
    ).toBe(80);
    const back: ArenaState = { ...hurt, player: { ...hurt.player, x: 100 } };
    expect(run(back, EMPTY_INPUT, 1).player.outsideSinceTick).toBeNull();
    expect(
      run(
        { ...outside, zoneEnforced: false },
        EMPTY_INPUT,
        ZONE_WARNING_TICKS + 1,
      ).player.health,
    ).toBe(100);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim`
Expected: FAIL — `./wanted` and `./zoneRule` not found; `tsc` rejects the `zone` event literal; in the arena suite heat stays 30 after the kill, a dead player keeps heat 80, and the player outside the zone keeps 100 health.

- [x] **Step 3: Add the `zone` event and implement `wanted.ts`**

In `src/lib/cityArena/sim/types.ts` the event union becomes:

```ts
/** Something that happened this tick, played as sound now and forwarded over the wire by Plan 3 (spec §6.3). */
export type ArenaEvent =
  | { kind: "shot"; weapon: WeaponKind; ownerId: number; x: number; y: number }
  | { kind: "hit"; target: HitTargetKind; x: number; y: number }
  | {
      kind: "impact";
      vehicleId: number;
      otherVehicleId: number | null;
      impactSpeed: number;
    }
  | { kind: "explosion"; x: number; y: number }
  | {
      kind: "pickup";
      pickupKind: PickupKind;
      playerId: number;
      x: number;
      y: number;
    }
  | {
      kind: "kill";
      victim: "ped" | "cop";
      killerId: number | null;
      x: number;
      y: number;
    }
  | { kind: "wanted"; playerId: number; level: number }
  | { kind: "zone"; playerId: number; phase: "warning" | "damage" };
```

```ts
// src/lib/cityArena/sim/wanted.ts
import { isDead } from "./damage";
import { eventsOfKind, pushEvent } from "./events";
import { SIM_STEP_S } from "./player";
import { playersOf, replacePlayer } from "./players";
import type {
  ArenaEvent,
  ArenaPlayerState,
  ArenaState,
  CopState,
  DriverState,
} from "./types";

/** Heat for killing a pedestrian (spec §5). */
export const HEAT_PED_KILL = 30;
/** Heat for killing a cop (spec §5). */
export const HEAT_COP_KILL = 60;
/** Heat for firing within 15 m of a cop (spec §5). */
export const HEAT_SHOT_NEAR_COP = 10;
/** Heat for ramming a police car (spec §5). */
export const HEAT_RAM_POLICE = 20;
/** A shot this close to a living cop adds heat (spec §5). */
export const HEAT_NEAR_COP_M = 15;
/** Ticks without new heat before it decays (spec §5: 8 s). */
export const HEAT_QUIET_TICKS = 240;
/** Heat lost per second once decaying (spec §5). */
export const HEAT_DECAY_PER_S = 5;
/** Heat per wanted star (spec §5). */
export const HEAT_PER_LEVEL = 40;
/** Most stars (spec §5). */
export const MAX_WANTED_LEVEL = 3;
/** Heat lost per tick once decaying. */
const HEAT_DECAY_PER_TICK = HEAT_DECAY_PER_S * SIM_STEP_S;

/** A car–car or car–building impact event. */
type ImpactEvent = Extract<ArenaEvent, { kind: "impact" }>;

/** Stars for a heat value: min(3, ⌊heat / 40⌋). */
export function wantedLevel(heat: number): number {
  return Math.min(MAX_WANTED_LEVEL, Math.floor(heat / HEAT_PER_LEVEL));
}

/** The player with `amount` more heat, remembering the tick so decay waits eight quiet seconds. */
export function addHeat(
  player: ArenaPlayerState,
  amount: number,
  tick: number,
): ArenaPlayerState {
  if (amount <= 0) return player;
  return { ...player, heat: player.heat + amount, heatTick: tick };
}

/** Decays heat by 5/s once 240 ticks have passed without new heat. */
export function decayHeat(
  player: ArenaPlayerState,
  tick: number,
): ArenaPlayerState {
  if (player.heat === 0 || tick - player.heatTick < HEAT_QUIET_TICKS)
    return player;
  return { ...player, heat: Math.max(0, player.heat - HEAT_DECAY_PER_TICK) };
}

/** True when a living cop stands within 15 m of the point. */
function nearLivingCop(cops: CopState[], x: number, y: number): boolean {
  return cops.some(
    (cop) =>
      cop.diedAtTick === null &&
      Math.hypot(cop.x - x, cop.y - y) <= HEAT_NEAR_COP_M,
  );
}

/** True when the vehicle id belongs to a car with a police driver. */
function isPoliceCar(
  traffic: DriverState[],
  vehicleId: number | null,
): boolean {
  return (
    vehicleId !== null &&
    traffic.some(
      (driver) => driver.role === "police" && driver.vehicleId === vehicleId,
    )
  );
}

/** True when the impact is between the player's car and a police car. */
function rammedPoliceCar(
  impact: ImpactEvent,
  player: ArenaPlayerState,
  traffic: DriverState[],
): boolean {
  if (player.vehicleId === null) return false;
  if (impact.vehicleId === player.vehicleId)
    return isPoliceCar(traffic, impact.otherVehicleId);
  if (impact.otherVehicleId === player.vehicleId)
    return isPoliceCar(traffic, impact.vehicleId);
  return false;
}

/** Heat one player earns from this tick's events: 30 per pedestrian kill, 60 per cop kill, 10 per shot within 15 m of a living cop, 20 per impact with a police car. */
export function heatFromEvents(
  events: ArenaEvent[],
  player: ArenaPlayerState,
  cops: CopState[],
  traffic: DriverState[],
): number {
  let heat = 0;
  for (const kill of eventsOfKind(events, "kill")) {
    if (kill.killerId !== player.id) continue;
    heat += kill.victim === "cop" ? HEAT_COP_KILL : HEAT_PED_KILL;
  }
  for (const shot of eventsOfKind(events, "shot"))
    if (shot.ownerId === player.id && nearLivingCop(cops, shot.x, shot.y))
      heat += HEAT_SHOT_NEAR_COP;
  for (const impact of eventsOfKind(events, "impact"))
    if (rammedPoliceCar(impact, player, traffic)) heat += HEAT_RAM_POLICE;
  return heat;
}

/** The living player with the most heat at one star or more — whom the cops hunt; `null` when nobody is wanted. */
export function wantedTarget(state: ArenaState): ArenaPlayerState | null {
  let target: ArenaPlayerState | null = null;
  for (const player of playersOf(state)) {
    if (isDead(player) || wantedLevel(player.heat) === 0) continue;
    if (!target || player.heat > target.heat) target = player;
  }
  return target;
}

/** The wanted level in force: the target's stars, or 0. */
export function currentWantedLevel(state: ArenaState): number {
  const target = wantedTarget(state);
  return target ? wantedLevel(target.heat) : 0;
}

/** One player's heat after this tick: zero when dead, else plus this tick's heat and minus decay. */
function updateHeat(
  state: ArenaState,
  player: ArenaPlayerState,
  tick: number,
): ArenaPlayerState {
  if (isDead(player))
    return player.heat === 0 ? player : { ...player, heat: 0 };
  const earned = heatFromEvents(
    state.events,
    player,
    state.cops,
    state.traffic,
  );
  return decayHeat(addHeat(player, earned, tick), tick);
}

/** Applies this tick's heat sources and decay to every player and records a `wanted` event when a level changes. */
export function applyWanted(state: ArenaState, tick: number): ArenaState {
  let next = state;
  for (const player of playersOf(state)) {
    const updated = updateHeat(state, player, tick);
    if (updated === player) continue;
    next = replacePlayer(next, updated);
    const level = wantedLevel(updated.heat);
    if (level === wantedLevel(player.heat)) continue;
    next = {
      ...next,
      events: pushEvent(next.events, {
        kind: "wanted",
        playerId: player.id,
        level,
      }),
    };
  }
  return next;
}
```

- [x] **Step 4: Implement `zoneRule.ts` and compose both into `stepArena`**

```ts
// src/lib/cityArena/sim/zoneRule.ts
import type { MapIndex, MapZone } from "../world/mapTypes";
import { distanceToZoneEdge, findZoneByKey } from "../world/zone";
import { damagePlayer, isDead } from "./damage";
import { pushEvent } from "./events";
import { SIM_STEP_S } from "./player";
import { playersOf, replacePlayer } from "./players";
import type { ArenaPlayerState, ArenaState } from "./types";

/** Ticks of warning after leaving the zone before the damage starts (spec §5: the "5…" countdown). */
export const ZONE_WARNING_TICKS = 150;
/** Damage per second outside the zone once the countdown is over (spec §5). */
export const ZONE_DAMAGE_PER_S = 10;
/** Ticks between two damage lumps outside the zone. */
export const ZONE_DAMAGE_INTERVAL_TICKS = 30;
/** Ticks per second of the fixed step. */
const TICKS_PER_SECOND = Math.round(1 / SIM_STEP_S);

/** Whole seconds left on a player's countdown (0 once the damage runs), or `null` inside the zone. */
export function zoneSecondsLeft(
  player: Pick<ArenaPlayerState, "outsideSinceTick">,
  tick: number,
): number | null {
  if (player.outsideSinceTick === null) return null;
  const left = player.outsideSinceTick + ZONE_WARNING_TICKS - tick;
  return Math.max(0, Math.ceil(left / TICKS_PER_SECOND));
}

/** True on the tick the countdown ends and on every whole second after it. */
function damageDue(player: ArenaPlayerState, tick: number): boolean {
  if (player.outsideSinceTick === null) return false;
  const elapsed = tick - player.outsideSinceTick - ZONE_WARNING_TICKS;
  return elapsed >= 0 && elapsed % ZONE_DAMAGE_INTERVAL_TICKS === 0;
}

/** The state with the player's countdown cleared (unchanged when it was not running). */
function withoutTimer(state: ArenaState, player: ArenaPlayerState): ArenaState {
  if (player.outsideSinceTick === null) return state;
  return replacePlayer(state, { ...player, outsideSinceTick: null });
}

/** The state with a zone event for the player. */
function withZoneEvent(
  state: ArenaState,
  playerId: number,
  phase: "warning" | "damage",
): ArenaState {
  return {
    ...state,
    events: pushEvent(state.events, { kind: "zone", playerId, phase }),
  };
}

/** One living player outside the zone: start the countdown with a warning, then land 10 damage on the due ticks (never through the respawn shield). */
function applyOutside(
  state: ArenaState,
  player: ArenaPlayerState,
  tick: number,
): ArenaState {
  if (player.outsideSinceTick === null)
    return withZoneEvent(
      replacePlayer(state, { ...player, outsideSinceTick: tick }),
      player.id,
      "warning",
    );
  if (!damageDue(player, tick)) return state;
  const damaged = damagePlayer(player, ZONE_DAMAGE_PER_S, tick);
  if (damaged === player) return state;
  return withZoneEvent(replacePlayer(state, damaged), player.id, "damage");
}

/** The zone the rule applies to: the active zone, only while the rule is on. */
function enforcedZone(state: ArenaState, index: MapIndex): MapZone | null {
  if (!state.zoneEnforced || state.activeZoneKey === null) return null;
  return findZoneByKey(index, state.activeZoneKey);
}

/** Spec §5 zone rule behind `zoneEnforced`: living players outside the active zone's disc get a 5 s countdown, then 10 damage per second until they are back; dead players and an unenforced state carry no timer. */
export function applyZoneRule(
  state: ArenaState,
  index: MapIndex,
  tick: number,
): ArenaState {
  const zone = enforcedZone(state, index);
  let next = state;
  for (const player of playersOf(state)) {
    const inside =
      zone === null || distanceToZoneEdge(zone, [player.x, player.y]) <= 0;
    if (inside || isDead(player)) {
      next = withoutTimer(next, player);
      continue;
    }
    next = applyOutside(next, player, tick);
  }
  return next;
}
```

In `src/lib/cityArena/sim/arena.ts` add `import { applyWanted } from "./wanted";` and `import { applyZoneRule } from "./zoneRule";`, then replace `stepArena`:

```ts
/** One fixed step of the arena: the single simulation entry point. */
export function stepArena(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  random: () => number,
): ArenaState {
  const tick = state.tick + 1;
  const edges = detectEdges(state.held, input);
  let next: ArenaState = { ...state, tick, held: edges.held, events: [] };
  next = applyPopulation(next, world, tick, random);
  next = applyRespawn(next, world, tick, random);
  next = stepPickups(next, tick);
  next = applyWeaponSwitch(next, edges.weaponPressed);
  next = applyEnterExit(next, edges.enterPressed, world);
  next = moveEntities(next, input, dt, world, tick, random);
  next = applyFire(next, input, tick, random);
  next = stepPeds(next, world, dt, tick, random);
  next = advanceBullets(next, dt, world, tick);
  next = applyExplosions(next, world, tick);
  next = applyZoneRule(next, world.index, tick);
  next = applyWanted(next, tick);
  next = ejectIfDead(next, world);
  const zone = findZone(world.index, [next.player.x, next.player.y]);
  return {
    ...next,
    effects: pruneEffects(next.effects, tick),
    zoneKey: zone?.key ?? null,
  };
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run src/lib/cityArena src/components/cityArena`
Expected: `tsc` clean; PASS — wanted 6, zoneRule 5, arena (+3), and every other suite (nothing else emits or reads heat or zone timers yet; the hook and overlay tests boot with `zoneEnforced: false`, so their players never see a countdown). Worked numbers: the event list of the sources test is worth 30 + 60 + 10 (the cop at (10, 0) is within 15 m of the shot at the origin, the one at (100, 0) is not) + 20 + 20 (both orderings of the ram against police car 9) = 140, and 100 for a player on foot; decay is 5/30 ≈ 0.1667 heat per tick from the 240th quiet tick, so 60 → 59.8333 and 40.1 → 39.93 (dropping from one star to none); a dead player's heat goes straight to 0 (two stars → none); the countdown shows ⌈(150 − elapsed)/30⌉ seconds: 5 on the tick of leaving, 1 on tick 159 and 0 from tick 160, when the first 10 damage lands, with the next lumps 30 ticks apart, so a player who left on tick 1 has 100 health after 150 ticks, 90 after 151 and 80 after 181; in the arena test the pistol's two rounds (20 + 20 damage) kill the 40-health pedestrian inside 20 ticks, taking the player from 30 to 60 heat and one star.

- [x] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/sim
git add src/lib/cityArena/sim
git commit -m "feat(arena): heat, wanted stars and the zone countdown

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Cops on foot — spawning out of view, pursuit, inaccurate fire, bodies and heat

**Files:**

- Create: `src/lib/cityArena/sim/cops.ts`
- Modify: `src/lib/cityArena/sim/hits.ts` (bullet hits on cops)
- Modify: `src/lib/cityArena/sim/arena.ts` (`bulletTargets`, `explodeVehicle`, `stepArena`)
- Test: `src/lib/cityArena/sim/cops.test.ts`, `src/lib/cityArena/sim/hits.test.ts` (extend), `src/lib/cityArena/sim/arena.test.ts` (extend)

**Interfaces:**

- Consumes: `CopState`, `CopWeapon`, `ArenaState`, `ArenaPlayerState`, `VehicleState` (Task 1); `pushEvent` (Task 1); `driverPlayer`, `playerById`, `playersOf` (Task 1); `MAX_COPS` (Task 1); `pointInRect`, `Rect` (Task 2); `moveToward`, `nextWaypoint`, `pathTo` (Task 2); `farFromAll`, `shuffle` (`./spawn`); `resolveVehicleAgainstCircle` (Task 4); `wantedTarget`, `currentWantedLevel` (Task 6); `MAX_BULLETS`, `createShots`, `BulletHit` (`./bullets`); `EXPLOSION_DAMAGE`, `inBlastRadius` (`./damage`); `addEffect` (`./effects`); `PLAYER_RADIUS_M` (`./player`); `WEAPONS` (`./weapons`); `RoadGraph`; `CollisionGrid`; `Point`.
- Produces: `COPS_PER_LEVEL = [0, 2, 2, 4]`, `COP_MAX_HEALTH = 100`, `COP_RUN_SPEED_MPS = 4.5`, `COP_SPAWN_MIN_M = 60`, `COP_SPAWN_MAX_M = 120`, `COP_FIRE_RANGE_M = 20`, `COP_COOLDOWN_TICKS = 20`, `COP_INACCURACY_RAD = 15°`, `COP_REPATH_TICKS = 30`, `COP_CLOSE_RANGE_M = 25`, `COP_STAND_DOWN_DISTANCE_M = 80`, `COP_BODY_TICKS = 240`, `COP_RADIUS_M = 0.4`, `COP_SHOTGUN_LEVEL = 3`, `COP_PATH_SNAP_M = 60`, `COP_REACH_M = 1.5`, `CopWorld = { graph: RoadGraph; collision: Pick<CollisionGrid, "resolveCircle">; viewRect?: Rect }`, `copWeaponForLevel(level): CopWeapon`, `aliveCops(cops): CopState[]`, `createCop(id, position, weapon, tick): CopState`, `nodesWithin(graph, centre, minM, maxM): number[]`, `spawnPointsAround(graph, around, viewRect, random): Point[]`, `damageCop(cop, amount, tick): CopState`, `copAim(cop, target, random): number`, `stepCop(cop, target, world, dt, tick): CopState`, `stepCops(state, world, dt, tick, random): ArenaState`, `blastCops(cops, vehicle, tick): { cops: CopState[]; killed: CopState[] }`, `manageCops(state, world, tick, random): ArenaState`; `applyEntityHit` also resolves cops (`hit` target `"cop"`, `kill` victim `"cop"`); `stepArena` runs `stepCops` before `stepPeds` and `manageCops` after `applyWanted`; cops are bullet targets and blast victims.

- [x] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/sim/cops.test.ts
import { describe, expect, it } from "vitest";
import type { MapIndex } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import {
  COP_BODY_TICKS,
  COP_COOLDOWN_TICKS,
  aliveCops,
  blastCops,
  copAim,
  copWeaponForLevel,
  createCop,
  damageCop,
  manageCops,
  nodesWithin,
  spawnPointsAround,
  stepCop,
  stepCops,
  type CopWorld,
} from "./cops";
import { createRng } from "./rng";
import type { ArenaState, CopState } from "./types";
import { createVehicle } from "./vehicle";

/** A road east from the origin with nodes every 50 m up to 200 m, plus a spur north to (0, 80). */
const graph = decodeRoadGraph({
  nodes: [0, 0, 200, 0, 400, 0, 600, 0, 800, 0, 0, -320],
  edges: [
    0, 1, 0, -1, 0, 200, 1, 2, 0, -1, 0, 200, 2, 3, 0, -1, 0, 200, 3, 4, 0, -1,
    0, 200, 0, 5, 0, -1, 0, 320,
  ],
  classes: ["residential"],
  names: [],
});
const emptyIndex: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};
const free = { resolveCircle: (centre: Point): Point => centre };
const world: CopWorld = { graph, collision: free };
const step = 1 / 30;

/** The player at the origin with `heat`. */
function playerWithHeat(heat: number): ArenaState {
  const state = createArenaState(
    { index: emptyIndex, graph, seed: 3, zone: null },
    createRng(3),
  );
  return { ...state, player: { ...state.player, heat, heatTick: 0 } };
}

function copAt(id: number, x: number, y: number): CopState {
  return createCop(id, [x, y], "pistol", 0);
}

function walk(cop: CopState, target: Point, ticks: number): CopState {
  let current = cop;
  for (let tick = 1; tick <= ticks; tick++)
    current = stepCop(current, target, world, step, tick);
  return current;
}

describe("cop basics", () => {
  it("creates a cop, arms it by level and tracks its health and body", () => {
    expect(createCop(5, [100, 0], "pistol", 3)).toEqual({
      id: 5,
      x: 100,
      y: 0,
      facing: 0,
      health: 100,
      weapon: "pistol",
      path: [],
      repathTick: 3,
      nextShotTick: 3,
      diedAtTick: null,
    });
    expect(copWeaponForLevel(1)).toBe("pistol");
    expect(copWeaponForLevel(2)).toBe("pistol");
    expect(copWeaponForLevel(3)).toBe("shotgun");
    const cop = copAt(5, 100, 0);
    expect(damageCop(cop, 20, 4)).toMatchObject({
      health: 80,
      diedAtTick: null,
    });
    const dead = damageCop({ ...cop, path: [1, 0] }, 100, 4);
    expect(dead).toMatchObject({ health: 0, diedAtTick: 4, path: [] });
    expect(damageCop(dead, 10, 5)).toBe(dead);
    expect(aliveCops([cop, dead])).toEqual([cop]);
  });

  it("finds seeded spawn nodes 60–120 m away and out of view", () => {
    expect(nodesWithin(graph, [0, 0], 60, 120)).toEqual([2, 5]);
    const points = spawnPointsAround(graph, [0, 0], null, createRng(1));
    expect(points).toHaveLength(2);
    expect(points).toContainEqual([100, 0]);
    expect(points).toContainEqual([0, -80]);
    expect(spawnPointsAround(graph, [0, 0], null, createRng(1))).toEqual(
      points,
    );
    const northInView = { minX: -50, minY: -100, maxX: 50, maxY: 50 };
    expect(spawnPointsAround(graph, [0, 0], northInView, createRng(1))).toEqual(
      [[100, 0]],
    );
  });

  it("aims at the target with up to 15° of error", () => {
    const cop = copAt(5, 0, 0);
    expect(copAim(cop, [10, 0], () => 0.5)).toBeCloseTo(0);
    expect(copAim(cop, [10, 0], () => 1)).toBeCloseTo((15 * Math.PI) / 180);
    expect(copAim(cop, [10, 0], () => 0)).toBeCloseTo((-15 * Math.PI) / 180);
    expect(copAim(cop, [0, 10], () => 0.5)).toBeCloseTo(Math.PI / 2);
  });
});

describe("stepCop", () => {
  it("follows the road toward a distant target at 4.5 m/s, re-planning without walking back", () => {
    const one = stepCop(copAt(5, 100, 0), [0, 0], world, step, 1);
    expect(one.x).toBeCloseTo(99.85);
    expect(one.y).toBeCloseTo(0);
    expect(one.facing).toBeCloseTo(Math.PI);
    expect(one.path).toEqual([1, 0]);
    expect(one.repathTick).toBe(31);
    expect(walk(copAt(5, 100, 0), [0, 0], 60).x).toBeCloseTo(91);
    const sideways = walk(copAt(5, 100, 0), [0, -80], 60);
    expect(sideways.x).toBeCloseTo(91);
    expect(sideways.path).toEqual([1, 0, 5]);
  });

  it("walks straight at a close target, stands still without one and lies still when dead", () => {
    const close = stepCop(copAt(5, 20, 0), [0, 0], world, step, 1);
    expect(close.x).toBeCloseTo(19.85);
    expect(close.path).toEqual([]);
    const dead = damageCop(copAt(5, 20, 0), 100, 1);
    expect(stepCop(dead, [0, 0], world, step, 2)).toBe(dead);
  });
});

describe("stepCops", () => {
  it("shoots the wanted player within 20 m at 1.5 shots per second with a shot event and a muzzle flash", () => {
    const wanted: ArenaState = {
      ...playerWithHeat(40),
      cops: [copAt(5, 15, 0)],
    };
    const fired = stepCops(wanted, world, step, 1, () => 0.5);
    expect(fired.cops[0]).toMatchObject({
      nextShotTick: 1 + COP_COOLDOWN_TICKS,
    });
    expect(fired.cops[0].x).toBeCloseTo(14.85);
    expect(fired.bullets).toHaveLength(1);
    expect(fired.bullets[0]).toMatchObject({
      ownerId: 5,
      damage: 20,
      weapon: "pistol",
    });
    expect(fired.bullets[0].directionX).toBeCloseTo(-1);
    expect(fired.bullets[0].directionY).toBeCloseTo(0);
    expect(fired.effects.map((effect) => effect.kind)).toEqual(["muzzle"]);
    expect(fired.events).toEqual([
      { kind: "shot", weapon: "pistol", ownerId: 5, x: fired.cops[0].x, y: 0 },
    ]);
    expect(fired.nextId).toBe(wanted.nextId + 2);
    const cooling = stepCops(
      { ...fired, events: [] },
      world,
      step,
      2,
      () => 0.5,
    );
    expect(cooling.bullets).toHaveLength(1);
    expect(cooling.events).toEqual([]);
    const again = stepCops(
      { ...fired, events: [] },
      world,
      step,
      1 + COP_COOLDOWN_TICKS,
      () => 0.5,
    );
    expect(again.bullets).toHaveLength(2);
    const shotgun: ArenaState = {
      ...wanted,
      cops: [{ ...copAt(5, 15, 0), weapon: "shotgun" }],
    };
    expect(stepCops(shotgun, world, step, 1, () => 0.5).bullets).toHaveLength(
      5,
    );
  });

  it("holds fire and stands still when nobody is wanted or the target is out of range", () => {
    const calm: ArenaState = { ...playerWithHeat(0), cops: [copAt(5, 15, 0)] };
    const idle = stepCops(calm, world, step, 1, () => 0.5);
    expect(idle.cops[0].x).toBe(15);
    expect(idle.bullets).toEqual([]);
    const far: ArenaState = { ...playerWithHeat(40), cops: [copAt(5, 30, 0)] };
    const approaching = stepCops(far, world, step, 1, () => 0.5);
    expect(approaching.cops[0].x).toBeCloseTo(29.85);
    expect(approaching.bullets).toEqual([]);
  });

  it("lets a fast car run cops over, crediting the driving player", () => {
    const base = playerWithHeat(0);
    const car = { ...createVehicle(40, "sedan", [0, 0], 0, 0), velocityX: 21 };
    const state: ArenaState = {
      ...base,
      vehicles: [car],
      cops: [copAt(5, 1.5, 0)],
    };
    const hit = stepCops(state, world, step, 5, () => 0.5);
    expect(hit.cops[0]).toMatchObject({ health: 0, diedAtTick: 5 });
    expect(hit.cops[0].x).toBeCloseTo(2.5);
    expect(hit.events).toEqual([
      { kind: "kill", victim: "cop", killerId: null, x: 1.5, y: 0 },
    ]);
    const driving: ArenaState = {
      ...state,
      player: { ...state.player, vehicleId: 40 },
    };
    expect(
      stepCops(driving, world, step, 5, () => 0.5).events[0],
    ).toMatchObject({ killerId: 0 });
    const slow: ArenaState = {
      ...state,
      vehicles: [{ ...car, velocityX: 10 }],
    };
    expect(stepCops(slow, world, step, 5, () => 0.5).cops[0]).toMatchObject({
      health: 50,
      diedAtTick: null,
    });
  });

  it("hurts cops inside a blast and kills the weak ones", () => {
    const blast = blastCops(
      [copAt(5, 1, 0), { ...copAt(6, 2, 0), health: 50 }, copAt(7, 5, 0)],
      { x: 0, y: 0 },
      3,
    );
    expect(blast.cops[0]).toMatchObject({ health: 20, diedAtTick: null });
    expect(blast.cops[1]).toMatchObject({ health: 0, diedAtTick: 3 });
    expect(blast.cops[2].health).toBe(100);
    expect(blast.killed).toEqual([blast.cops[1]]);
  });
});

describe("manageCops", () => {
  it("spawns the level's cops out of view, arms them by level and upgrades to shotguns at three stars", () => {
    const oneStar = manageCops(playerWithHeat(40), world, 1, createRng(2));
    expect(oneStar.cops).toHaveLength(2);
    expect(oneStar.cops.map((cop) => cop.id)).toEqual([
      oneStar.nextId - 2,
      oneStar.nextId - 1,
    ]);
    for (const cop of oneStar.cops) {
      expect(cop.weapon).toBe("pistol");
      expect(Math.hypot(cop.x, cop.y)).toBeGreaterThanOrEqual(60);
      expect(Math.hypot(cop.x, cop.y)).toBeLessThanOrEqual(120);
    }
    expect(manageCops(oneStar, world, 2, createRng(2))).toEqual(oneStar);
    const threeStars = manageCops(
      { ...oneStar, player: { ...oneStar.player, heat: 120 } },
      world,
      3,
      createRng(2),
    );
    expect(threeStars.cops).toHaveLength(4);
    for (const cop of threeStars.cops) expect(cop.weapon).toBe("shotgun");
    const inView = { minX: -200, minY: -200, maxX: 200, maxY: 200 };
    expect(
      manageCops(
        playerWithHeat(40),
        { ...world, viewRect: inView },
        1,
        createRng(2),
      ).cops,
    ).toEqual([]);
  });

  it("stands cops down at level 0 when far or out of view, expires bodies and respects the cap", () => {
    const calm = playerWithHeat(0);
    const spread: ArenaState = {
      ...calm,
      cops: [copAt(5, 90, 0), copAt(6, 30, 0)],
    };
    expect(
      manageCops(spread, world, 1, createRng(2)).cops.map((cop) => cop.id),
    ).toEqual([6]);
    const view = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
    const hidden: ArenaState = {
      ...calm,
      cops: [copAt(5, 60, 0), copAt(6, 30, 0)],
    };
    expect(
      manageCops(
        hidden,
        { ...world, viewRect: view },
        1,
        createRng(2),
      ).cops.map((cop) => cop.id),
    ).toEqual([6]);
    const body = damageCop(copAt(7, 10, 0), 100, 0);
    expect(
      manageCops(
        { ...calm, cops: [body] },
        world,
        COP_BODY_TICKS - 1,
        createRng(2),
      ).cops,
    ).toEqual([body]);
    expect(
      manageCops({ ...calm, cops: [body] }, world, COP_BODY_TICKS, createRng(2))
        .cops,
    ).toEqual([]);
    expect(manageCops(calm, world, 1, createRng(2))).toBe(calm);
    const bodies = Array.from({ length: 6 }, (_, index) =>
      damageCop(copAt(10 + index, 10, 0), 100, 0),
    );
    const capped: ArenaState = {
      ...playerWithHeat(120),
      cops: [...bodies, copAt(20, 100, 0), copAt(21, 100, 0)],
    };
    expect(manageCops(capped, world, 1, createRng(2)).cops).toHaveLength(8);
  });
});
```

Append to `src/lib/cityArena/sim/hits.test.ts` (import `createCop` from `./cops`):

```ts
describe("applyEntityHit on cops", () => {
  it("hurts and kills a cop with a player's bullet and absorbs anyone else's", () => {
    const state = {
      ...withPed(),
      peds: [],
      cops: [createCop(300, [5, 0], "pistol", 0)],
    };
    const hurt = applyEntityHit(state, hitOn(300, bulletFrom(0, 20)), 4);
    expect(hurt?.cops[0]).toMatchObject({ health: 80, diedAtTick: null });
    expect(hurt?.events).toEqual([
      { kind: "hit", target: "cop", x: 4.6, y: 0 },
    ]);
    const killed = applyEntityHit(state, hitOn(300, bulletFrom(0, 100)), 4);
    expect(killed?.cops[0]).toMatchObject({ health: 0, diedAtTick: 4 });
    expect(killed?.events).toEqual([
      { kind: "hit", target: "cop", x: 4.6, y: 0 },
      { kind: "kill", victim: "cop", killerId: 0, x: 5, y: 0 },
    ]);
    const absorbed = applyEntityHit(state, hitOn(300, bulletFrom(77, 100)), 4);
    expect(absorbed?.cops[0].health).toBe(100);
    expect(absorbed?.events).toEqual([
      { kind: "hit", target: "cop", x: 4.6, y: 0 },
    ]);
  });
});
```

Extend `src/lib/cityArena/sim/arena.test.ts` (import `createCop` from `./cops`) with a new describe:

```ts
describe("stepArena cops", () => {
  it("lets a cop shoot the wanted player, dies to five pistol rounds and hands out heat", () => {
    const state = boot();
    const hunted: ArenaState = {
      ...state,
      player: { ...state.player, heat: 40, heatTick: 0 },
      cops: [
        createCop(950, [state.player.x + 10, state.player.y], "pistol", 0),
      ],
    };
    const exactAim = (): number => 0.5;
    const shot = run(hunted, EMPTY_INPUT, 3, exactAim);
    expect(shot.player.health).toBe(80);
    expect(shot.events).toContainEqual({
      kind: "hit",
      target: "player",
      x: expect.any(Number),
      y: expect.any(Number),
    });
    let current = hunted;
    const events: ArenaEvent[] = [];
    for (let index = 0; index < 60; index++) {
      current = stepArena(
        current,
        createInput({ fire: true, aim: 0 }),
        step,
        world,
        exactAim,
      );
      events.push(...current.events);
    }
    const cop = current.cops.find((candidate) => candidate.id === 950);
    expect(cop).toMatchObject({ health: 0 });
    expect(cop?.diedAtTick).toBe(49);
    expect(events.filter((event) => event.kind === "kill")).toEqual([
      {
        kind: "kill",
        victim: "cop",
        killerId: 0,
        x: expect.any(Number),
        y: expect.any(Number),
      },
    ]);
    expect(current.player.heat).toBe(140);
    expect(events.filter((event) => event.kind === "wanted")).toEqual([
      { kind: "wanted", playerId: 0, level: 2 },
      { kind: "wanted", playerId: 0, level: 3 },
    ]);
    expect(current.player.health).toBe(40);
    expect(checkInvariants(current)).toEqual([]);
  });

  it("stands cops down once the heat is gone", () => {
    const state = boot();
    const calm: ArenaState = {
      ...state,
      cops: [
        createCop(951, [state.player.x + 90, state.player.y], "pistol", 0),
      ],
    };
    expect(run(calm, EMPTY_INPUT, 1).cops).toEqual([]);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim`
Expected: FAIL — `./cops` not found; `applyEntityHit` returns `null` for a cop id; in the arena suite the player keeps 100 health and the cop is never hurt.

- [x] **Step 3: Implement `cops.ts`**

```ts
// src/lib/cityArena/sim/cops.ts
import { pointInRect, type Rect } from "../mapBuild/geometry";
import type { CollisionGrid } from "../world/collisionGrid";
import { moveToward, nextWaypoint, pathTo } from "../world/pathFollow";
import type { Point } from "../world/projection";
import type { RoadGraph } from "../world/roadGraph";
import { MAX_BULLETS, createShots } from "./bullets";
import { resolveVehicleAgainstCircle } from "./collisions";
import { EXPLOSION_DAMAGE, inBlastRadius } from "./damage";
import { addEffect } from "./effects";
import { pushEvent } from "./events";
import { MAX_COPS } from "./limits";
import { PLAYER_RADIUS_M } from "./player";
import { driverPlayer, playersOf } from "./players";
import { shuffle } from "./spawn";
import type {
  ArenaPlayerState,
  ArenaState,
  CopState,
  CopWeapon,
  VehicleState,
} from "./types";
import { currentWantedLevel, wantedTarget } from "./wanted";
import { WEAPONS } from "./weapons";

/** Cops on foot per wanted level (spec §5: two at one and two stars, four at three). */
export const COPS_PER_LEVEL: readonly number[] = [0, 2, 2, 4];
/** Cop health (spec §5). */
export const COP_MAX_HEALTH = 100;
/** Running speed of a cop on foot (documented choice). */
export const COP_RUN_SPEED_MPS = 4.5;
/** Cops spawn at least this far from the wanted player (spec §5). */
export const COP_SPAWN_MIN_M = 60;
/** Cops spawn at most this far from the wanted player (spec §5). */
export const COP_SPAWN_MAX_M = 120;
/** Cops shoot within this distance (spec §5). */
export const COP_FIRE_RANGE_M = 20;
/** Ticks between two cop shots (spec §5: 1.5/s). */
export const COP_COOLDOWN_TICKS = 20;
/** Half-angle of a cop's aim error (spec §5: 15°). */
export const COP_INACCURACY_RAD = (15 * Math.PI) / 180;
/** Cops re-plan their road route every this many ticks (documented choice). */
export const COP_REPATH_TICKS = 30;
/** Within this distance a cop walks straight at the player instead of following the roads. */
export const COP_CLOSE_RANGE_M = 25;
/** At level 0 cops farther than this from the player vanish. */
export const COP_STAND_DOWN_DISTANCE_M = 80;
/** Ticks a cop's body stays (as long as a pedestrian's). */
export const COP_BODY_TICKS = 240;
/** Collision radius of a cop: the same circle as a player. */
export const COP_RADIUS_M = PLAYER_RADIUS_M;
/** From this wanted level cops carry shotguns (spec §5). */
export const COP_SHOTGUN_LEVEL = 3;
/** How far a cop looks for a road node when routing. */
export const COP_PATH_SNAP_M = 60;
/** Within this distance of a path node it counts as reached. */
export const COP_REACH_M = 1.5;

/** What the cop step reads from the world. */
export type CopWorld = {
  graph: RoadGraph;
  collision: Pick<CollisionGrid, "resolveCircle">;
  viewRect?: Rect;
};

/** Pistols below three stars, shotguns from there (spec §5). */
export function copWeaponForLevel(level: number): CopWeapon {
  return level >= COP_SHOTGUN_LEVEL ? "shotgun" : "pistol";
}

/** Cops that are not dead. */
export function aliveCops(cops: CopState[]): CopState[] {
  return cops.filter((cop) => cop.diedAtTick === null);
}

/** A healthy cop at `position`, ready to plan and shoot from `tick`. */
export function createCop(
  id: number,
  position: Point,
  weapon: CopWeapon,
  tick: number,
): CopState {
  return {
    id,
    x: position[0],
    y: position[1],
    facing: 0,
    health: COP_MAX_HEALTH,
    weapon,
    path: [],
    repathTick: tick,
    nextShotTick: tick,
    diedAtTick: null,
  };
}

/** Graph nodes between `minM` and `maxM` from `centre`, in node order. */
export function nodesWithin(
  graph: Pick<RoadGraph, "nodes">,
  centre: Point,
  minM: number,
  maxM: number,
): number[] {
  const nodes: number[] = [];
  graph.nodes.forEach((node, index) => {
    const distance = Math.hypot(node[0] - centre[0], node[1] - centre[1]);
    if (distance >= minM && distance <= maxM) nodes.push(index);
  });
  return nodes;
}

/** Seeded spawn points for cops and police cars: road nodes 60–120 m from `around`, outside `viewRect`. */
export function spawnPointsAround(
  graph: Pick<RoadGraph, "nodes">,
  around: Point,
  viewRect: Rect | null,
  random: () => number,
): Point[] {
  const points = nodesWithin(graph, around, COP_SPAWN_MIN_M, COP_SPAWN_MAX_M)
    .map((node) => graph.nodes[node])
    .filter((point) => !viewRect || !pointInRect(point, viewRect));
  return shuffle(points, random);
}

/** Applies damage; at zero health the cop dies, drops its route and leaves a body for 240 ticks. */
export function damageCop(
  cop: CopState,
  amount: number,
  tick: number,
): CopState {
  if (amount <= 0 || cop.diedAtTick !== null) return cop;
  const health = Math.max(0, cop.health - amount);
  if (health > 0) return { ...cop, health };
  return { ...cop, health: 0, diedAtTick: tick, path: [] };
}

/** A cop's aim at `target`: the true bearing plus a uniform error within ±15°. */
export function copAim(
  cop: CopState,
  target: Point,
  random: () => number,
): number {
  const bearing = Math.atan2(target[1] - cop.y, target[0] - cop.x);
  return bearing + (random() * 2 - 1) * COP_INACCURACY_RAD;
}

/** Distance from a cop to a point. */
function distanceTo(cop: CopState, point: Point): number {
  return Math.hypot(point[0] - cop.x, point[1] - cop.y);
}

/** Drops leading path nodes that are farther from the target than the cop already is, so a re-plan never walks it back. */
function trimBehind(
  graph: Pick<RoadGraph, "nodes">,
  path: number[],
  cop: CopState,
  target: Point,
): number[] {
  const copDistance = distanceTo(cop, target);
  let start = 0;
  while (start < path.length - 1) {
    const node = graph.nodes[path[start]];
    if (Math.hypot(node[0] - target[0], node[1] - target[1]) <= copDistance)
      break;
    start += 1;
  }
  return start === 0 ? path : path.slice(start);
}

/** The cop's route refreshed when due: a road path toward the target (both ends snapped within 60 m), else none. */
function refreshPath(
  cop: CopState,
  target: Point,
  graph: RoadGraph,
  tick: number,
): CopState {
  if (tick < cop.repathTick && cop.path.length > 0) return cop;
  const planned = pathTo(graph, [cop.x, cop.y], target, COP_PATH_SNAP_M) ?? [];
  return {
    ...cop,
    path: trimBehind(graph, planned, cop, target),
    repathTick: tick + COP_REPATH_TICKS,
  };
}

/** Runs the cop 4.5 m/s toward `goal`, pushed out of buildings, facing the target. */
function runTo(
  cop: CopState,
  goal: Point,
  target: Point,
  collision: Pick<CollisionGrid, "resolveCircle">,
  dt: number,
): CopState {
  const [x, y] = collision.resolveCircle(
    moveToward([cop.x, cop.y], goal, COP_RUN_SPEED_MPS * dt),
    COP_RADIUS_M,
  );
  return { ...cop, x, y, facing: Math.atan2(target[1] - y, target[0] - x) };
}

/** One tick of a cop: a close target is charged directly, a distant one along the roads; dead cops lie still and a cop without a target waits. */
export function stepCop(
  cop: CopState,
  target: Point | null,
  world: CopWorld,
  dt: number,
  tick: number,
): CopState {
  if (cop.diedAtTick !== null || !target) return cop;
  if (distanceTo(cop, target) <= COP_CLOSE_RANGE_M)
    return runTo({ ...cop, path: [] }, target, target, world.collision, dt);
  const routed = refreshPath(cop, target, world.graph, tick);
  const progress = nextWaypoint(
    world.graph,
    routed.path,
    [routed.x, routed.y],
    COP_REACH_M,
  );
  return runTo(
    { ...routed, path: progress.path },
    progress.target ?? target,
    target,
    world.collision,
    dt,
  );
}

/** True when the cop may fire now: the target within 20 m, the cooldown over and room under the bullet cap. */
function canFire(
  state: ArenaState,
  cop: CopState,
  target: Point,
  tick: number,
): boolean {
  return (
    distanceTo(cop, target) <= COP_FIRE_RANGE_M &&
    tick >= cop.nextShotTick &&
    state.bullets.length < MAX_BULLETS
  );
}

/** The state and cop after one trigger pull: pellets (trimmed to the bullet cap), a muzzle flash, a shot event and the cooldown. */
function fireCop(
  state: ArenaState,
  cop: CopState,
  target: Point,
  tick: number,
  random: () => number,
): { state: ArenaState; cop: CopState } {
  const angle = copAim(cop, target, random);
  const capacity = Math.max(0, MAX_BULLETS - state.bullets.length);
  const shots = createShots(
    WEAPONS[cop.weapon],
    cop.weapon,
    [cop.x, cop.y],
    angle,
    { ownerId: cop.id, ignoreVehicleId: null, firstId: state.nextId },
    random,
  ).slice(0, capacity);
  const muzzleId = state.nextId + shots.length;
  return {
    state: {
      ...state,
      bullets: [...state.bullets, ...shots],
      effects: addEffect(state.effects, {
        id: muzzleId,
        kind: "muzzle",
        x: cop.x,
        y: cop.y,
        angle,
        bornTick: tick,
      }),
      events: pushEvent(state.events, {
        kind: "shot",
        weapon: cop.weapon,
        ownerId: cop.id,
        x: cop.x,
        y: cop.y,
      }),
      nextId: muzzleId + 1,
    },
    cop: { ...cop, facing: angle, nextShotTick: tick + COP_COOLDOWN_TICKS },
  };
}

/** One car's effect on the living cops: pushed clear, hurt above 5 m/s; a kill by a player's car is credited to that player. */
function runOverWith(
  state: ArenaState,
  vehicle: VehicleState,
  tick: number,
): ArenaState {
  const killerId = driverPlayer(state, vehicle.id)?.id ?? null;
  let events = state.events;
  const cops = state.cops.map((cop) => {
    if (cop.diedAtTick !== null) return cop;
    const contact = resolveVehicleAgainstCircle(vehicle, [cop.x, cop.y]);
    if (!contact.touched) return cop;
    const hurt = damageCop(
      { ...cop, x: contact.point[0], y: contact.point[1] },
      contact.damage,
      tick,
    );
    if (hurt.diedAtTick !== null)
      events = pushEvent(events, {
        kind: "kill",
        victim: "cop",
        killerId,
        x: cop.x,
        y: cop.y,
      });
    return hurt;
  });
  return { ...state, cops, events };
}

/** Every moving car pushes, hurts and possibly kills the cops it touches. */
function runOverCops(state: ArenaState, tick: number): ArenaState {
  let next = state;
  for (const vehicle of state.vehicles) {
    if (vehicle.velocityX === 0 && vehicle.velocityY === 0) continue;
    next = runOverWith(next, vehicle, tick);
  }
  return next;
}

/** Moves every living cop after the wanted player and lets those in range shoot; then the cars run them over. */
export function stepCops(
  state: ArenaState,
  world: CopWorld,
  dt: number,
  tick: number,
  random: () => number,
): ArenaState {
  const target = wantedTarget(state);
  const point: Point | null = target ? [target.x, target.y] : null;
  let next = state;
  const cops: CopState[] = [];
  for (const cop of state.cops) {
    const moved = stepCop(cop, point, world, dt, tick);
    if (
      !point ||
      moved.diedAtTick !== null ||
      !canFire(next, moved, point, tick)
    ) {
      cops.push(moved);
      continue;
    }
    const fired = fireCop(next, moved, point, tick, random);
    next = fired.state;
    cops.push(fired.cop);
  }
  return runOverCops({ ...next, cops }, tick);
}

/** Blast damage to the living cops inside an exploding car's radius; returns them and the ones it killed. */
export function blastCops(
  cops: CopState[],
  vehicle: Pick<VehicleState, "x" | "y">,
  tick: number,
): { cops: CopState[]; killed: CopState[] } {
  const killed: CopState[] = [];
  const blasted = cops.map((cop) => {
    if (cop.diedAtTick !== null || !inBlastRadius(vehicle, [cop.x, cop.y]))
      return cop;
    const hurt = damageCop(cop, EXPLOSION_DAMAGE, tick);
    if (hurt.diedAtTick !== null) killed.push(hurt);
    return hurt;
  });
  return { cops: blasted, killed };
}

/** True when a cop at level 0 may vanish: out of the camera's view, or more than 80 m from the player. */
function standsDown(
  cop: CopState,
  player: ArenaPlayerState,
  viewRect: Rect | null,
): boolean {
  if (viewRect && !pointInRect([cop.x, cop.y], viewRect)) return true;
  return distanceTo(cop, [player.x, player.y]) > COP_STAND_DOWN_DISTANCE_M;
}

/** Bodies expire after 240 ticks; at level 0 living cops stand down when far or unseen; otherwise they carry the level's weapon. */
function retireCops(
  state: ArenaState,
  level: number,
  viewRect: Rect | null,
  tick: number,
): CopState[] {
  const [player] = playersOf(state);
  const kept: CopState[] = [];
  for (const cop of state.cops) {
    if (cop.diedAtTick !== null) {
      if (tick < cop.diedAtTick + COP_BODY_TICKS) kept.push(cop);
      continue;
    }
    if (level === 0) {
      if (!standsDown(cop, player, viewRect)) kept.push(cop);
      continue;
    }
    const weapon = copWeaponForLevel(level);
    kept.push(weapon === cop.weapon ? cop : { ...cop, weapon });
  }
  return kept;
}

/** True when both lists hold the same cop objects in the same order. */
function sameCops(first: CopState[], second: CopState[]): boolean {
  return (
    first.length === second.length &&
    first.every((cop, index) => cop === second[index])
  );
}

/** Spawns the cops the level still lacks at seeded road nodes 60–120 m from the wanted player, out of view, under MAX_COPS. */
function spawnMissingCops(
  state: ArenaState,
  target: ArenaPlayerState,
  level: number,
  world: CopWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const missing = COPS_PER_LEVEL[level] - aliveCops(state.cops).length;
  const room = Math.min(missing, MAX_COPS - state.cops.length);
  if (room <= 0) return state;
  const points = spawnPointsAround(
    world.graph,
    [target.x, target.y],
    world.viewRect ?? null,
    random,
  ).slice(0, room);
  if (points.length === 0) return state;
  const fresh = points.map((point, offset) =>
    createCop(state.nextId + offset, point, copWeaponForLevel(level), tick),
  );
  return {
    ...state,
    cops: [...state.cops, ...fresh],
    nextId: state.nextId + fresh.length,
  };
}

/** Keeps the cops in line with the wanted level: retires, re-arms and spawns as needed; the state is returned untouched when nothing changes. */
export function manageCops(
  state: ArenaState,
  world: CopWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const level = currentWantedLevel(state);
  const cops = retireCops(state, level, world.viewRect ?? null, tick);
  const retired = sameCops(cops, state.cops) ? state : { ...state, cops };
  const target = wantedTarget(retired);
  if (!target) return retired;
  return spawnMissingCops(retired, target, level, world, tick, random);
}
```

- [x] **Step 4: Resolve bullet hits on cops and wire the cops into `arena.ts`**

`src/lib/cityArena/sim/hits.ts` becomes:

```ts
// src/lib/cityArena/sim/hits.ts
import type { BulletHit } from "./bullets";
import { damageCop } from "./cops";
import { pushEvent } from "./events";
import { damagePed } from "./peds";
import { playerById } from "./players";
import type { ArenaState } from "./types";

/** A pedestrian hit: damage only from a player's bullet (others are absorbed), a hit event, and a kill event with the shooter when it died. */
function hitPed(
  state: ArenaState,
  index: number,
  hit: BulletHit,
  tick: number,
): ArenaState {
  const ped = state.peds[index];
  const fromPlayer = playerById(state, hit.bullet.ownerId) !== null;
  const damaged = fromPlayer ? damagePed(ped, hit.bullet.damage, tick) : ped;
  let events = pushEvent(state.events, {
    kind: "hit",
    target: "ped",
    x: hit.point[0],
    y: hit.point[1],
  });
  if (damaged.mode === "dead" && ped.mode !== "dead")
    events = pushEvent(events, {
      kind: "kill",
      victim: "ped",
      killerId: hit.bullet.ownerId,
      x: ped.x,
      y: ped.y,
    });
  return {
    ...state,
    events,
    peds: state.peds.map((candidate, position) =>
      position === index ? damaged : candidate,
    ),
  };
}

/** A cop hit: damage only from a player's bullet (cops never hurt each other), a hit event, and a kill event with the shooter when it died. */
function hitCop(
  state: ArenaState,
  index: number,
  hit: BulletHit,
  tick: number,
): ArenaState {
  const cop = state.cops[index];
  const fromPlayer = playerById(state, hit.bullet.ownerId) !== null;
  const damaged = fromPlayer ? damageCop(cop, hit.bullet.damage, tick) : cop;
  let events = pushEvent(state.events, {
    kind: "hit",
    target: "cop",
    x: hit.point[0],
    y: hit.point[1],
  });
  if (damaged.diedAtTick !== null && cop.diedAtTick === null)
    events = pushEvent(events, {
      kind: "kill",
      victim: "cop",
      killerId: hit.bullet.ownerId,
      x: cop.x,
      y: cop.y,
    });
  return {
    ...state,
    events,
    cops: state.cops.map((candidate, position) =>
      position === index ? damaged : candidate,
    ),
  };
}

/** Applies a bullet hit whose target id belongs to a pedestrian or a cop; `null` when the target is something else. */
export function applyEntityHit(
  state: ArenaState,
  hit: BulletHit,
  tick: number,
): ArenaState | null {
  if (hit.target.kind !== "player") return null;
  const targetId = hit.target.playerId;
  const pedIndex = state.peds.findIndex((ped) => ped.id === targetId);
  if (pedIndex >= 0) return hitPed(state, pedIndex, hit, tick);
  const copIndex = state.cops.findIndex((cop) => cop.id === targetId);
  if (copIndex >= 0) return hitCop(state, copIndex, hit, tick);
  return null;
}
```

In `src/lib/cityArena/sim/arena.ts` add `import { aliveCops, blastCops, manageCops, stepCops } from "./cops";`, then replace `bulletTargets`, `explodeVehicle` and `stepArena`:

```ts
/** Every circle a bullet can hit this tick: the player on foot, the living pedestrians and the living cops (all 0.4 m). */
function bulletTargets(state: ArenaState): PlayerTarget[] {
  const { player } = state;
  const targets: PlayerTarget[] =
    !isDead(player) && player.vehicleId === null
      ? [{ id: player.id, x: player.x, y: player.y }]
      : [];
  for (const ped of alivePeds(state.peds))
    targets.push({ id: ped.id, x: ped.x, y: ped.y });
  for (const cop of aliveCops(state.cops))
    targets.push({ id: cop.id, x: cop.x, y: cop.y });
  return targets;
}

/** The events plus a kill event without a killer for every victim of a blast. */
function withBlastKills(
  events: ArenaEvent[],
  victim: "ped" | "cop",
  killed: { x: number; y: number }[],
): ArenaEvent[] {
  let next = events;
  for (const body of killed)
    next = pushEvent(next, {
      kind: "kill",
      victim,
      killerId: null,
      x: body.x,
      y: body.y,
    });
  return next;
}

/** Wrecks one car that reached 0 health: explosion effect and event, blast damage to the player, pedestrians, cops and cars nearby. */
function explodeVehicle(
  state: ArenaState,
  vehicle: VehicleState,
  tick: number,
): ArenaState {
  const vehicles = state.vehicles.map((other) => {
    if (other.id === vehicle.id)
      return { ...other, wrecked: true, velocityX: 0, velocityY: 0 };
    return inBlastRadius(vehicle, [other.x, other.y])
      ? damageVehicle(other, EXPLOSION_DAMAGE)
      : other;
  });
  const pedBlast = blastPeds(state.peds, vehicle, tick);
  const copBlast = blastCops(state.cops, vehicle, tick);
  let events = pushEvent(state.events, {
    kind: "explosion",
    x: vehicle.x,
    y: vehicle.y,
  });
  events = withBlastKills(events, "ped", pedBlast.killed);
  events = withBlastKills(events, "cop", copBlast.killed);
  return {
    ...state,
    vehicles,
    peds: pedBlast.peds,
    cops: copBlast.cops,
    events,
    nextId: state.nextId + 1,
    player: blastPlayer(state.player, vehicle, tick),
    effects: addEffect(state.effects, {
      id: state.nextId,
      kind: "explosion",
      x: vehicle.x,
      y: vehicle.y,
      angle: 0,
      bornTick: tick,
    }),
  };
}
```

```ts
/** One fixed step of the arena: the single simulation entry point. */
export function stepArena(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  random: () => number,
): ArenaState {
  const tick = state.tick + 1;
  const edges = detectEdges(state.held, input);
  let next: ArenaState = { ...state, tick, held: edges.held, events: [] };
  next = applyPopulation(next, world, tick, random);
  next = applyRespawn(next, world, tick, random);
  next = stepPickups(next, tick);
  next = applyWeaponSwitch(next, edges.weaponPressed);
  next = applyEnterExit(next, edges.enterPressed, world);
  next = moveEntities(next, input, dt, world, tick, random);
  next = applyFire(next, input, tick, random);
  next = stepCops(next, world, dt, tick, random);
  next = stepPeds(next, world, dt, tick, random);
  next = advanceBullets(next, dt, world, tick);
  next = applyExplosions(next, world, tick);
  next = applyZoneRule(next, world.index, tick);
  next = applyWanted(next, tick);
  next = manageCops(next, world, tick, random);
  next = ejectIfDead(next, world);
  const zone = findZone(world.index, [next.player.x, next.player.y]);
  return {
    ...next,
    effects: pruneEffects(next.effects, tick),
    zoneKey: zone?.key ?? null,
  };
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run src/lib/cityArena src/components/cityArena`
Expected: `tsc` clean; PASS — cops 10, hits 3, arena (+2), and every other suite (nothing else creates cops; at heat 0 `manageCops` returns the state untouched, so the hook, overlay and earlier arena tests are unaffected). Worked numbers: from the origin only the nodes at (100, 0) and (0, −80) lie 60–120 m away; a cop 100 m out follows the road at 4.5 m/s, 0.15 m per tick, and the re-plan on tick 31 drops the node 4.5 m behind it, so 60 ticks cover exactly 9 m; ±15° is ±0.2618 rad; the cop at 15 m steps to 14.85 m, fires along π with the centred draw 0.5, and its next shot waits 20 ticks; a 21 m/s car deals 5 × 21 = 105 ≥ 100, a 10 m/s car 50; the 80-damage blast leaves a full-health cop with 20 and kills one at 50; in the arena test the cop 10 m east fires on tick 1 from 9.85 m and its 120 m/s round (4 m per tick) enters the player's 0.4 m circle on tick 3 (80 health), then again on ticks 22 and 41 (40 health), while the player's pistol rounds of ticks 1, 13, 25, 37 and 49 each land on the closing cop (the last one 2.65 m away on the tick it is fired), killing it on tick 49; heat 40 → +10 for the first four shots within 15 m of a living cop (80 = two stars) → +60 for the kill (140 = three stars), the fifth shot counting nothing because the cop is already dead when the heat is tallied.

- [x] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/sim
git add src/lib/cityArena/sim
git commit -m "feat(arena): cops on foot that hunt, shoot and fall

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Police cars, escalation, the final `stepArena` composition and the entity invariants

**Files:**

- Create: `src/lib/cityArena/sim/police.ts`
- Modify: `src/lib/cityArena/sim/invariants.ts` (cop health, police drivers, body and pickup timers)
- Modify: `src/lib/cityArena/sim/arena.ts` (`moveEntities` passes the ram order; `managePoliceCars` in `stepArena`)
- Test: `src/lib/cityArena/sim/police.test.ts`, `src/lib/cityArena/sim/invariants.test.ts` (extend), `src/lib/cityArena/sim/arena.test.ts` (extend)

**Interfaces:**

- Consumes: `DriverState`, `VehicleState`, `ArenaState`, `ArenaPlayerState` (Task 1); `MAX_TRAFFIC`, `MAX_VEHICLES` (Task 1); `playersOf`, `driverPlayer` (Task 1); `pointInRect`, `Rect` (Task 2); `pathTo` (Task 2); `nodesWithin`, `COP_SPAWN_MIN_M`, `COP_SPAWN_MAX_M`, `COP_MAX_HEALTH`, `COP_BODY_TICKS` (Task 7); `isAiEdge`, `stepDrivers`, `ChaseTarget`, `DrivenCar`, `DriverWorld` (Task 5); `farFromAll`, `shuffle`, `roadHeadingAt`, `MIN_CAR_SPACING_M`, `SpawnGraph` (`./spawn`); `wantedTarget`, `currentWantedLevel` (Task 6); `PED_BODY_TICKS` (Task 4); `PICKUP_RESPAWN_TICKS` (Task 3); `createVehicle` (`./vehicle`); `RoadGraph`; `Point`.
- Produces: `POLICE_CARS_PER_LEVEL = [0, 0, 1, 2]`, `POLICE_CHASE_MPS = 18`, `POLICE_RAM_RANGE_M = 25`, `POLICE_REPATH_TICKS = 30`, `POLICE_PATH_SNAP_M = 80`, `POLICE_TOW_DISTANCE_M = 150`, `POLICE_COLOUR = 5`, `PoliceWorld = { graph: RoadGraph; viewRect?: Rect }`, `policeDrivers(traffic): DriverState[]`, `policeChase(state): ChaseTarget | null`, `policeSpawnPoints(graph, around, viewRect, random): Point[]`, `createPoliceCar(id, graph, position, tick): DrivenCar`, `replanPolice(driver, vehicle, target, graph, tick): DriverState`, `managePoliceCars(state, world, tick, random): ArenaState`; `checkInvariants` also reports cop health out of range, police drivers on non-police cars, expired pedestrian and cop bodies and overdue pickups; the final `stepArena` order is the one in the File structure section.

- [x] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/sim/police.test.ts
import { describe, expect, it } from "vitest";
import type { MapIndex } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createArenaState } from "./arena";
import {
  POLICE_CHASE_MPS,
  POLICE_COLOUR,
  POLICE_REPATH_TICKS,
  createPoliceCar,
  managePoliceCars,
  policeChase,
  policeDrivers,
  policeSpawnPoints,
  replanPolice,
} from "./police";
import { createRng } from "./rng";
import type { ArenaState, DriverState } from "./types";
import { createVehicle } from "./vehicle";

/** A tertiary road east from the origin with nodes every 50 m up to 300 m, a service spur at (0, 100) and a residential spur at (0, −80). */
const graph = decodeRoadGraph({
  nodes: [
    0, 0, 200, 0, 400, 0, 600, 0, 800, 0, 1000, 0, 1200, 0, 0, 400, 0, -320,
  ],
  edges: [
    0, 1, 0, -1, 0, 200, 1, 2, 0, -1, 0, 200, 2, 3, 0, -1, 0, 200, 3, 4, 0, -1,
    0, 200, 4, 5, 0, -1, 0, 200, 5, 6, 0, -1, 0, 200, 0, 7, 1, -1, 0, 400, 0, 8,
    2, -1, 0, 320,
  ],
  classes: ["tertiary", "service", "residential"],
  names: [],
});
const emptyIndex: MapIndex = {
  version: 1,
  generatedAt: "2026-09-05T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};

/** The player at the origin with `heat`. */
function playerWithHeat(heat: number): ArenaState {
  const state = createArenaState(
    { index: emptyIndex, graph, seed: 3, zone: null },
    createRng(3),
  );
  return { ...state, player: { ...state.player, heat, heatTick: 0 } };
}

function driverOf(vehicleId: number): DriverState {
  return {
    vehicleId,
    role: "police",
    cruiseMps: POLICE_CHASE_MPS,
    fromNode: null,
    path: [],
    repathTick: 0,
  };
}

describe("police helpers", () => {
  it("filters police drivers and turns the wanted player into a ram order", () => {
    const traffic: DriverState[] = [
      driverOf(1),
      { ...driverOf(2), role: "traffic" },
    ];
    expect(policeDrivers(traffic)).toEqual([driverOf(1)]);
    expect(policeChase(playerWithHeat(0))).toBeNull();
    expect(policeChase(playerWithHeat(80))).toEqual({
      point: [0, 0],
      rangeM: 25,
    });
  });

  it("spawns only on nodes with a drivable road, 60–120 m away and out of view", () => {
    const points = policeSpawnPoints(graph, [0, 0], null, createRng(1));
    expect(points).toHaveLength(2);
    expect(points).toContainEqual([100, 0]);
    expect(points).toContainEqual([0, -80]);
    expect(points).not.toContainEqual([0, 100]);
    const eastInView = { minX: 50, minY: -50, maxX: 150, maxY: 50 };
    expect(policeSpawnPoints(graph, [0, 0], eastInView, createRng(1))).toEqual([
      [0, -80],
    ]);
  });

  it("creates a police car headed along the road with a fresh driver", () => {
    const car = createPoliceCar(900, graph, [100, 0], 7);
    expect(car.vehicle).toMatchObject({
      id: 900,
      kind: "police",
      x: 100,
      y: 0,
      colour: POLICE_COLOUR,
      velocityX: 0,
      velocityY: 0,
    });
    expect([0, Math.PI]).toContainEqual(expect.closeTo(car.vehicle.heading, 5));
    expect(car.driver).toEqual({
      vehicleId: 900,
      role: "police",
      cruiseMps: POLICE_CHASE_MPS,
      fromNode: 2,
      path: [],
      repathTick: 7,
    });
  });

  it("re-plans a road route to the target when due, keeping off service roads", () => {
    const vehicle = createVehicle(
      900,
      "police",
      [300, 0],
      Math.PI,
      POLICE_COLOUR,
    );
    const planned = replanPolice(driverOf(900), vehicle, [0, 0], graph, 10);
    expect(planned).toMatchObject({ fromNode: 6, path: [5, 4, 3, 2, 1, 0] });
    expect(planned.repathTick).toBe(10 + POLICE_REPATH_TICKS);
    expect(replanPolice(planned, vehicle, [0, 0], graph, 20)).toBe(planned);
    const toSpur = replanPolice(driverOf(900), vehicle, [0, 100], graph, 10);
    expect(toSpur.path).toEqual([]);
    const toHouse = replanPolice(driverOf(900), vehicle, [0, -80], graph, 10);
    expect(toHouse.path).toEqual([5, 4, 3, 2, 1, 0, 8]);
  });
});

describe("managePoliceCars", () => {
  it("spawns one car at two stars and two at three, re-planning their routes every 30 ticks", () => {
    const twoStars = managePoliceCars(
      playerWithHeat(80),
      { graph },
      1,
      createRng(2),
    );
    expect(policeDrivers(twoStars.traffic)).toHaveLength(1);
    const [driver] = policeDrivers(twoStars.traffic);
    const car = twoStars.vehicles.find(
      (vehicle) => vehicle.id === driver.vehicleId,
    );
    expect(car?.kind).toBe("police");
    expect(Math.hypot(car?.x ?? 0, car?.y ?? 0)).toBeGreaterThanOrEqual(60);
    expect(twoStars.nextId).toBe(twoStars.vehicles.length + 1);
    const routed = managePoliceCars(twoStars, { graph }, 2, createRng(2));
    expect(policeDrivers(routed.traffic)[0].path.length).toBeGreaterThan(0);
    expect(policeDrivers(routed.traffic)[0].repathTick).toBe(
      2 + POLICE_REPATH_TICKS,
    );
    const threeStars = managePoliceCars(
      { ...routed, player: { ...routed.player, heat: 120 } },
      { graph },
      3,
      createRng(2),
    );
    expect(policeDrivers(threeStars.traffic)).toHaveLength(2);
    expect(
      threeStars.vehicles.filter((vehicle) => vehicle.kind === "police"),
    ).toHaveLength(2);
    const inView = { minX: -200, minY: -200, maxX: 400, maxY: 200 };
    expect(
      managePoliceCars(
        playerWithHeat(80),
        { graph, viewRect: inView },
        1,
        createRng(2),
      ).traffic,
    ).toEqual([]);
  });

  it("releases the drivers at level 0 and tows driverless police cars that are far and unseen", () => {
    const calm = playerWithHeat(0);
    const far = createPoliceCar(900, graph, [300, 0], 0);
    const near = createPoliceCar(901, graph, [100, 0], 0);
    const patrol: ArenaState = {
      ...calm,
      vehicles: [far.vehicle, near.vehicle],
      traffic: [far.driver, near.driver],
    };
    const released = managePoliceCars(patrol, { graph }, 1, createRng(2));
    expect(released.traffic).toEqual([]);
    expect(released.vehicles.map((vehicle) => vehicle.id)).toEqual([901]);
    const watched = managePoliceCars(
      patrol,
      { graph, viewRect: { minX: 250, minY: -50, maxX: 350, maxY: 50 } },
      1,
      createRng(2),
    );
    expect(watched.vehicles.map((vehicle) => vehicle.id)).toEqual([900, 901]);
    const stolen: ArenaState = {
      ...patrol,
      traffic: [],
      player: { ...patrol.player, vehicleId: 900 },
    };
    expect(managePoliceCars(stolen, { graph }, 1, createRng(2))).toBe(stolen);
  });
});
```

Extend `src/lib/cityArena/sim/invariants.test.ts` (imports: `createCop` from `./cops`, `PED_BODY_TICKS` from `./peds`, `COP_BODY_TICKS` from `./cops`):

```ts
it("reports cop health, police drivers without a police car, expired bodies and overdue pickups", () => {
  const cop = createCop(5, [0, 0], "pistol", 0);
  expect(
    checkInvariants({ ...healthy, cops: [{ ...cop, health: 150 }] }),
  ).toContain("cop 5 health out of range");
  expect(
    checkInvariants({
      ...healthy,
      traffic: [
        {
          vehicleId: 1,
          role: "police",
          cruiseMps: 18,
          fromNode: null,
          path: [],
          repathTick: 0,
        },
      ],
    }),
  ).toContain("driver of vehicle 1 is not in a police car");
  const staleBody = {
    ...pedAt(50, 0),
    health: 0,
    mode: "dead" as const,
    modeUntilTick: healthy.tick,
  };
  expect(checkInvariants({ ...healthy, peds: [staleBody] })).toContain(
    "ped 50 body expired",
  );
  const staleCop = {
    ...cop,
    health: 0,
    diedAtTick: healthy.tick - COP_BODY_TICKS,
  };
  expect(checkInvariants({ ...healthy, cops: [staleCop] })).toContain(
    "cop 5 body expired",
  );
  const freshBody = {
    ...staleBody,
    modeUntilTick: healthy.tick + PED_BODY_TICKS,
  };
  expect(checkInvariants({ ...healthy, peds: [freshBody] })).toEqual([]);
  expect(
    checkInvariants({
      ...healthy,
      tick: 700,
      pickups: [{ id: 60, kind: "uzi", x: 0, y: 0, takenAtTick: 100 }],
    }),
  ).toContain("pickup 60 overdue for its respawn");
});
```

Extend `src/lib/cityArena/sim/arena.test.ts` (imports: `POLICE_COLOUR`, `policeDrivers` from `./police`):

```ts
/** A 300 m tertiary chain with nodes every 50 m, so police cars can route and spawn 60–120 m out. */
const chaseGraph = decodeRoadGraph({
  nodes: [0, 0, 200, 0, 400, 0, 600, 0, 800, 0, 1000, 0, 1200, 0],
  edges: [
    0, 1, 0, -1, 0, 200, 1, 2, 0, -1, 0, 200, 2, 3, 0, -1, 0, 200, 3, 4, 0, -1,
    0, 200, 4, 5, 0, -1, 0, 200, 5, 6, 0, -1, 0, 200,
  ],
  classes: ["tertiary"],
  names: [],
});
const chaseWorld: ArenaWorld = {
  collision: createCollisionGrid(),
  index,
  graph: chaseGraph,
};

/** Steps `state` on the chase world. */
function runChase(
  state: ArenaState,
  input: WorldInput,
  ticks: number,
): ArenaState {
  const random = createRng(99);
  let current = state;
  for (let index = 0; index < ticks; index++)
    current = stepArena(current, input, step, chaseWorld, random);
  return current;
}

describe("stepArena police cars", () => {
  it("sends a police car after a two-star player and rams them", () => {
    const state = boot();
    const wanted: ArenaState = {
      ...state,
      vehicles: [],
      traffic: [],
      peds: [],
      player: { ...state.player, x: 200, y: 0, heat: 80, heatTick: 0 },
    };
    const dispatched = runChase(wanted, EMPTY_INPUT, 1);
    const [driver] = policeDrivers(dispatched.traffic);
    expect(driver).toMatchObject({ role: "police", cruiseMps: 18 });
    const car = dispatched.vehicles.find(
      (vehicle) => vehicle.id === driver.vehicleId,
    );
    expect(car).toMatchObject({ kind: "police", colour: POLICE_COLOUR, y: 0 });
    expect(Math.abs((car?.x ?? 0) - 200)).toBe(100);
    const chased = runChase(wanted, EMPTY_INPUT, 150);
    const rammed =
      chased.player.health < 100 || chased.player.diedAtTick !== null;
    expect(rammed).toBe(true);
    expect(checkInvariants(chased)).toEqual([]);
  });

  it("gives 20 heat for ramming a police car and hurts both cars", () => {
    const state = boot();
    const own = {
      ...createVehicle(600, "compact", [state.player.x, state.player.y], 0, 0),
      velocityX: 8,
    };
    const police = createVehicle(
      601,
      "police",
      [state.player.x + 3.5, state.player.y],
      Math.PI,
      POLICE_COLOUR,
    );
    const driver: DriverState = {
      vehicleId: 601,
      role: "police",
      cruiseMps: 18,
      fromNode: null,
      path: [],
      repathTick: 0,
    };
    const ramming: ArenaState = {
      ...state,
      vehicles: [own, police],
      traffic: [driver],
      peds: [],
      player: {
        ...state.player,
        vehicleId: 600,
        boardingTicksLeft: 0,
        heat: 40,
        heatTick: 0,
      },
    };
    const { state: crashed, events } = runCollecting(ramming, EMPTY_INPUT, 3);
    expect(crashed.player.heat).toBe(60);
    expect(crashed.vehicles[1].health).toBeCloseTo(86.8);
    expect(crashed.vehicles[0].health).toBeCloseTo(86.8);
    const [impact] = eventsOfKind(events, "impact");
    expect(impact).toMatchObject({ vehicleId: 600, otherVehicleId: 601 });
    expect(impact.impactSpeed).toBeCloseTo(8.4);
  });

  it("escalates to two police cars and shotgun cops at three stars and keeps the invariants busy", () => {
    const state = boot();
    const hunted: ArenaState = {
      ...state,
      vehicles: [],
      traffic: [],
      peds: [],
      zoneEnforced: true,
      player: { ...state.player, x: 200, y: 0, heat: 120, heatTick: 0 },
    };
    const escalated = runChase(hunted, EMPTY_INPUT, 2);
    expect(policeDrivers(escalated.traffic)).toHaveLength(2);
    expect(
      escalated.vehicles.filter((vehicle) => vehicle.kind === "police"),
    ).toHaveLength(2);
    expect(escalated.cops).toHaveLength(4);
    for (const cop of escalated.cops) expect(cop.weapon).toBe("shotgun");
    const busy = runChase(
      hunted,
      createInput({
        move: [0.7, -0.7],
        fire: true,
        enter: true,
        weaponNext: true,
      }),
      300,
    );
    expect(checkInvariants(busy)).toEqual([]);
  });

  it("releases police drivers and tows far cars once the heat is gone", () => {
    const state = boot();
    const police = createVehicle(
      601,
      "police",
      [state.player.x + 200, state.player.y],
      0,
      POLICE_COLOUR,
    );
    const driver: DriverState = {
      vehicleId: 601,
      role: "police",
      cruiseMps: 18,
      fromNode: null,
      path: [],
      repathTick: 0,
    };
    const calm: ArenaState = {
      ...state,
      vehicles: [police],
      traffic: [driver],
    };
    const released = run(calm, EMPTY_INPUT, 1);
    expect(released.traffic).toEqual([]);
    expect(released.vehicles).toEqual([]);
  });
});
```

Add `type DriverState` to the `./types` import of `arena.test.ts`.

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim`
Expected: FAIL — `./police` not found; the four new invariant messages are never produced; in the arena suite no police car appears, ramming a police car earns no heat and the far police car is neither released nor towed.

- [x] **Step 3: Implement `police.ts`**

```ts
// src/lib/cityArena/sim/police.ts
import { pointInRect, type Rect } from "../mapBuild/geometry";
import { pathTo } from "../world/pathFollow";
import type { Point } from "../world/projection";
import type { RoadGraph } from "../world/roadGraph";
import { COP_SPAWN_MAX_M, COP_SPAWN_MIN_M, nodesWithin } from "./cops";
import { MAX_TRAFFIC, MAX_VEHICLES } from "./limits";
import { driverPlayer, playersOf } from "./players";
import {
  MIN_CAR_SPACING_M,
  farFromAll,
  roadHeadingAt,
  shuffle,
  type SpawnGraph,
} from "./spawn";
import { isAiEdge, type ChaseTarget, type DrivenCar } from "./traffic";
import type {
  ArenaPlayerState,
  ArenaState,
  DriverState,
  VehicleState,
} from "./types";
import { createVehicle } from "./vehicle";
import { currentWantedLevel, wantedTarget } from "./wanted";

/** Police cars per wanted level (spec §5: one at two stars, two at three). */
export const POLICE_CARS_PER_LEVEL: readonly number[] = [0, 0, 1, 2];
/** Chase speed of a police car (documented choice). */
export const POLICE_CHASE_MPS = 18;
/** Within this distance a police car drives straight at the wanted player to ram (documented choice). */
export const POLICE_RAM_RANGE_M = 25;
/** Police cars re-plan their route every this many ticks. */
export const POLICE_REPATH_TICKS = 30;
/** How far a police car looks for a road node when routing. */
export const POLICE_PATH_SNAP_M = 80;
/** A driverless police car farther than this from every player, and out of view, is towed away. */
export const POLICE_TOW_DISTANCE_M = 150;
/** Body colour index of police cars: white in `CAR_BODY_COLOURS`. */
export const POLICE_COLOUR = 5;

/** What the police manager reads from the world. */
export type PoliceWorld = { graph: RoadGraph; viewRect?: Rect };

/** The police drivers among the AI drivers. */
export function policeDrivers(traffic: DriverState[]): DriverState[] {
  return traffic.filter((driver) => driver.role === "police");
}

/** The ram order for police cars: charge the wanted player within 25 m; `null` when nobody is wanted. */
export function policeChase(state: ArenaState): ChaseTarget | null {
  const target = wantedTarget(state);
  return target
    ? { point: [target.x, target.y], rangeM: POLICE_RAM_RANGE_M }
    : null;
}

/** True when a road an AI car may drive meets the node. */
function hasDrivableRoad(graph: RoadGraph, node: number): boolean {
  return graph.adjacency[node].some((edgeIndex) =>
    isAiEdge(graph.edges[edgeIndex]),
  );
}

/** Seeded spawn points for police cars: drivable road nodes 60–120 m from `around`, outside `viewRect`. */
export function policeSpawnPoints(
  graph: RoadGraph,
  around: Point,
  viewRect: Rect | null,
  random: () => number,
): Point[] {
  const points = nodesWithin(graph, around, COP_SPAWN_MIN_M, COP_SPAWN_MAX_M)
    .filter((node) => hasDrivableRoad(graph, node))
    .map((node) => graph.nodes[node])
    .filter((point) => !viewRect || !pointInRect(point, viewRect));
  return shuffle(points, random);
}

/** A police car at rest at `position`, headed along the nearest road, with a driver that plans from `tick`. */
export function createPoliceCar(
  id: number,
  graph: SpawnGraph,
  position: Point,
  tick: number,
): DrivenCar {
  const vehicle = createVehicle(
    id,
    "police",
    position,
    roadHeadingAt(graph, position),
    POLICE_COLOUR,
  );
  const driver: DriverState = {
    vehicleId: id,
    role: "police",
    cruiseMps: POLICE_CHASE_MPS,
    fromNode: graph.nearestNode(position, POLICE_PATH_SNAP_M),
    path: [],
    repathTick: tick,
  };
  return { vehicle, driver };
}

/** A police driver's route refreshed when due: the road path (drivable roads only, one-way honoured) from the node nearest its car to the target, without that first node. */
export function replanPolice(
  driver: DriverState,
  vehicle: VehicleState,
  target: Point,
  graph: RoadGraph,
  tick: number,
): DriverState {
  if (tick < driver.repathTick && driver.path.length > 0) return driver;
  const at: Point = [vehicle.x, vehicle.y];
  const fromNode = graph.nearestNode(at, POLICE_PATH_SNAP_M);
  const route =
    pathTo(graph, at, target, POLICE_PATH_SNAP_M, {
      respectOneway: true,
      allowEdge: isAiEdge,
    }) ?? [];
  return {
    ...driver,
    fromNode,
    path: route[0] === fromNode ? route.slice(1) : route,
    repathTick: tick + POLICE_REPATH_TICKS,
  };
}

/** Every police driver's route refreshed toward the target; the state is untouched when no route changed. */
function replanAll(
  state: ArenaState,
  target: ArenaPlayerState,
  graph: RoadGraph,
  tick: number,
): ArenaState {
  let changed = false;
  const traffic = state.traffic.map((driver) => {
    if (driver.role !== "police") return driver;
    const vehicle = state.vehicles.find(
      (candidate) => candidate.id === driver.vehicleId,
    );
    if (!vehicle) return driver;
    const planned = replanPolice(
      driver,
      vehicle,
      [target.x, target.y],
      graph,
      tick,
    );
    if (planned !== driver) changed = true;
    return planned;
  });
  return changed ? { ...state, traffic } : state;
}

/** The AI drivers without the police; their cars stay where they are. */
function releaseDrivers(state: ArenaState): ArenaState {
  const traffic = state.traffic.filter((driver) => driver.role !== "police");
  return traffic.length === state.traffic.length
    ? state
    : { ...state, traffic };
}

/** True when a police car may be towed: nobody drives it, it is outside the view and more than 150 m from every player. */
function towable(
  state: ArenaState,
  vehicle: VehicleState,
  viewRect: Rect | null,
): boolean {
  if (vehicle.kind !== "police" || driverPlayer(state, vehicle.id))
    return false;
  if (state.traffic.some((driver) => driver.vehicleId === vehicle.id))
    return false;
  if (viewRect && pointInRect([vehicle.x, vehicle.y], viewRect)) return false;
  return playersOf(state).every(
    (player) =>
      Math.hypot(player.x - vehicle.x, player.y - vehicle.y) >
      POLICE_TOW_DISTANCE_M,
  );
}

/** Removes the towable police cars. */
function towPoliceCars(state: ArenaState, viewRect: Rect | null): ArenaState {
  const vehicles = state.vehicles.filter(
    (vehicle) => !towable(state, vehicle, viewRect),
  );
  return vehicles.length === state.vehicles.length
    ? state
    : { ...state, vehicles };
}

/** Spawns the police cars the level still lacks at drivable nodes 60–120 m from the target, out of view, clear of other cars and under the traffic and vehicle caps. */
function spawnMissingPoliceCars(
  state: ArenaState,
  target: ArenaPlayerState,
  level: number,
  world: PoliceWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const missing =
    POLICE_CARS_PER_LEVEL[level] - policeDrivers(state.traffic).length;
  const room = Math.min(
    missing,
    MAX_TRAFFIC - state.traffic.length,
    MAX_VEHICLES - state.vehicles.length,
  );
  if (room <= 0) return state;
  const occupied: Point[] = state.vehicles.map((vehicle) => [
    vehicle.x,
    vehicle.y,
  ]);
  const cars: DrivenCar[] = [];
  const points = policeSpawnPoints(
    world.graph,
    [target.x, target.y],
    world.viewRect ?? null,
    random,
  );
  for (const point of points) {
    if (cars.length >= room) break;
    if (!farFromAll(point, occupied, MIN_CAR_SPACING_M)) continue;
    cars.push(
      createPoliceCar(state.nextId + cars.length, world.graph, point, tick),
    );
    occupied.push(point);
  }
  if (cars.length === 0) return state;
  return {
    ...state,
    vehicles: [...state.vehicles, ...cars.map((car) => car.vehicle)],
    traffic: [...state.traffic, ...cars.map((car) => car.driver)],
    nextId: state.nextId + cars.length,
  };
}

/** Keeps the police cars in line with the wanted level: routes and spawns while someone is wanted; otherwise releases the drivers and tows far, unseen cars. The state is returned untouched when nothing changes. */
export function managePoliceCars(
  state: ArenaState,
  world: PoliceWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const target = wantedTarget(state);
  if (!target)
    return towPoliceCars(releaseDrivers(state), world.viewRect ?? null);
  const level = currentWantedLevel(state);
  const routed = replanAll(state, target, world.graph, tick);
  return spawnMissingPoliceCars(routed, target, level, world, tick, random);
}
```

- [x] **Step 4: Extend the invariants and finish `arena.ts`**

In `src/lib/cityArena/sim/invariants.ts` add the imports `import { COP_BODY_TICKS, COP_MAX_HEALTH } from "./cops";`, `import { PED_BODY_TICKS } from "./peds";` and `import { PICKUP_RESPAWN_TICKS } from "./pickups";` (keep `PED_BODY_TICKS` even though the check below derives the expiry from `modeUntilTick`; it documents the bound in the message), then replace `checkPeople` and `checkPopulation`:

```ts
/** Pedestrians and cops: caps, finite positions, death and health agreeing, bodies not overdue, cop health in range, unique ids. */
function checkPeople(
  state: ArenaState,
  violations: string[],
  ids: Set<number>,
): void {
  check(violations, state.peds.length <= MAX_PEDS, "too many pedestrians");
  check(violations, state.cops.length <= MAX_COPS, "too many cops");
  for (const ped of state.peds) {
    check(
      violations,
      finite(ped.x, ped.y, ped.facing),
      `ped ${ped.id} is not finite`,
    );
    check(
      violations,
      (ped.mode === "dead") === (ped.health === 0),
      `ped ${ped.id} death and health disagree`,
    );
    check(
      violations,
      ped.mode !== "dead" || ped.modeUntilTick > state.tick,
      `ped ${ped.id} body expired`,
    );
    registerId(violations, ids, ped.id);
  }
  for (const cop of state.cops) {
    check(
      violations,
      finite(cop.x, cop.y, cop.facing),
      `cop ${cop.id} is not finite`,
    );
    check(
      violations,
      cop.health >= 0 && cop.health <= COP_MAX_HEALTH,
      `cop ${cop.id} health out of range`,
    );
    check(
      violations,
      (cop.diedAtTick !== null) === (cop.health === 0),
      `cop ${cop.id} death and health disagree`,
    );
    check(
      violations,
      cop.diedAtTick === null || cop.diedAtTick + COP_BODY_TICKS > state.tick,
      `cop ${cop.id} body expired`,
    );
    registerId(violations, ids, cop.id);
  }
}

/** One AI driver: its car exists, is intact and unshared; police drivers sit in police cars. */
function checkDriver(
  state: ArenaState,
  driver: ArenaState["traffic"][number],
  driven: Set<number>,
  violations: string[],
): void {
  const vehicle = state.vehicles.find(
    (candidate) => candidate.id === driver.vehicleId,
  );
  check(
    violations,
    vehicle !== undefined && !vehicle.wrecked,
    `driver of vehicle ${driver.vehicleId} has no intact car`,
  );
  check(
    violations,
    driver.role !== "police" ||
      vehicle === undefined ||
      vehicle.kind === "police",
    `driver of vehicle ${driver.vehicleId} is not in a police car`,
  );
  check(
    violations,
    !driven.has(driver.vehicleId) &&
      driver.vehicleId !== state.player.vehicleId,
    `vehicle ${driver.vehicleId} has more than one driver`,
  );
  driven.add(driver.vehicleId);
}

/** Pickups, AI drivers and the per-tick event list. */
function checkPopulation(
  state: ArenaState,
  violations: string[],
  ids: Set<number>,
): void {
  check(violations, state.pickups.length <= MAX_PICKUPS, "too many pickups");
  check(violations, state.traffic.length <= MAX_TRAFFIC, "too many drivers");
  check(violations, state.events.length <= MAX_EVENTS, "too many events");
  for (const pickup of state.pickups) {
    check(
      violations,
      pickup.takenAtTick === null || pickup.takenAtTick <= state.tick,
      `pickup ${pickup.id} taken in the future`,
    );
    check(
      violations,
      pickup.takenAtTick === null ||
        state.tick - pickup.takenAtTick < PICKUP_RESPAWN_TICKS,
      `pickup ${pickup.id} overdue for its respawn`,
    );
    registerId(violations, ids, pickup.id);
  }
  const driven = new Set<number>();
  for (const driver of state.traffic)
    checkDriver(state, driver, driven, violations);
}
```

(The `PED_BODY_TICKS` import is only used by the test; drop it from `invariants.ts` if ESLint flags it as unused — the check itself reads `modeUntilTick`, which `damagePed` sets to the death tick plus `PED_BODY_TICKS`.)

In `src/lib/cityArena/sim/arena.ts` add `import { managePoliceCars, policeChase } from "./police";`, change the `stepDrivers` call in `moveEntities` to `const drivers = stepDrivers(state, world, random, policeChase(state));`, and replace `stepArena` with its final form:

```ts
/** One fixed step of the arena: the single simulation entry point. */
export function stepArena(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  random: () => number,
): ArenaState {
  const tick = state.tick + 1;
  const edges = detectEdges(state.held, input);
  let next: ArenaState = { ...state, tick, held: edges.held, events: [] };
  next = applyPopulation(next, world, tick, random);
  next = applyRespawn(next, world, tick, random);
  next = stepPickups(next, tick);
  next = applyWeaponSwitch(next, edges.weaponPressed);
  next = applyEnterExit(next, edges.enterPressed, world);
  next = moveEntities(next, input, dt, world, tick, random);
  next = applyFire(next, input, tick, random);
  next = stepCops(next, world, dt, tick, random);
  next = stepPeds(next, world, dt, tick, random);
  next = advanceBullets(next, dt, world, tick);
  next = applyExplosions(next, world, tick);
  next = applyZoneRule(next, world.index, tick);
  next = applyWanted(next, tick);
  next = manageCops(next, world, tick, random);
  next = managePoliceCars(next, world, tick, random);
  next = ejectIfDead(next, world);
  const zone = findZone(world.index, [next.player.x, next.player.y]);
  return {
    ...next,
    effects: pruneEffects(next.effects, tick),
    zoneKey: zone?.key ?? null,
  };
}
```

Also change `chaseWorld` in `arena.test.ts` to carry a camera window that hides the node at 150 m, so the police car of the ram test can only spawn at the node 60 m from the player (append `viewRect: { minX: 130, minY: -50, maxX: 170, maxY: 50 }` to the literal) and move that test's player to `x: 240`; the escalation test keeps `x: 200` (its two candidate nodes at 100 m and 300 m lie outside that window). The expectation `Math.abs((car?.x ?? 0) - 200)` in the ram test becomes `Math.abs((car?.x ?? 0) - 240)` with the value `60`.

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run src/lib/cityArena src/components/cityArena`
Expected: `tsc` clean; PASS — police 6, invariants 4, arena (+4), and every other suite; `npm run lint` still reports only the two accepted warnings. Worked numbers: from the origin the nodes at (100, 0), (0, 100) and (0, −80) lie 60–120 m out, but (0, 100) only meets a service road, so two spawn points remain; the route from the car at (300, 0) is nodes 6 → 0 with its own node dropped, six nodes long, and the service spur makes (0, 100) unreachable while the residential spur adds node 8; at two stars one car is wanted, at three stars two, and a re-plan is due 30 ticks after the last; with the camera on node 150 the ram test's only spawn point is 60 m from the player at 240 m, so the police car (9 m/s², 18 m/s top speed: 18 m in the first 2 s, then 18 m/s) closes 60 m in about 4.3 s ≈ 130 ticks and rams the player on foot at more than 5 m/s inside 150 ticks; the ramming player's compact rolls from 8 to 7.8 m/s over two ticks (0.263 + 0.26 m) while the police car, ordered to charge the player 3.5 m behind it, accelerates to 0.6 m/s and creeps 0.03 m, so contact comes on tick 2 at an approach speed of 7.8 + 0.6 = 8.4 m/s: (8.4 − 4) × 3 = 13.2 damage to both (86.8 health) and +20 heat (40 → 60, still one star); a police car 200 m out at heat 0 loses its driver and, being farther than 150 m and unseen, is towed the same tick.

- [x] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/sim
git add src/lib/cityArena/sim
git commit -m "feat(arena): police cars, wanted escalation and entity invariants

Adds the police module (spawn out of view, road routing, ramming within
25 m, release and towing at level 0), the final stepArena composition and
invariant checks for cops, drivers, bodies and pickup timers.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Part 1 to Part 2 handoff

Part 1 owns the deterministic simulation. Part 2 must consume its snapshots and events without
adding gameplay rules to React or Canvas painters. Before starting Task 9, confirm the following
contract is present in the working tree:

- `ArenaState` contains `peds`, `cops`, `pickups`, `traffic`, `events`, `activeZoneKey` and
  `zoneEnforced`; `ArenaPlayerState` contains `heat`, `heatTick` and `outsideSinceTick`.
- `ArenaWorld` carries the decoded `RoadGraph` and the optional camera `viewRect`; the runtime
  passes both on every fixed step.
- `stepArena` clears events at the beginning of a tick, keeps entity caps enforced, and emits
  only serialisable events. The sound layer must treat the list as a per-tick batch.
- `Scene` is a render snapshot, not the simulation state. The renderer receives immutable entity
  arrays and never mutates them, calls `Date`, reads `window`, or performs collision checks.
- `computeHud` and `buildRadarSnapshot` are pure projections. React may throttle their updates to
  10 Hz, but the Canvas frame may continue at display refresh.

If Part 1 is implemented in separate commits, run the Part 1 command before beginning each Part 2
task. Do not rewrite the simulation to make a painter or component easier to use; adapt at the
boundary with a named projection function.

## Part 2: Rendering, radar, sound, HUD wiring and documentation

Part 2 starts from the committed Part 1 simulation and produces the complete playable single-player
slice. It does not add multiplayer transport, rounds, scoring, kill feed, haptics, feedback effects,
bots or persistence. Those remain the later roadmap slices.

### Task 9: People, pickups, police paint and the 90 px radar

**Files:**

- Create: `src/lib/cityArena/render/drawPeople.ts`
- Create: `src/lib/cityArena/render/drawPickups.ts`
- Create: `src/lib/cityArena/render/radar.ts`
- Create: `src/lib/cityArena/render/radar.test.ts`
- Create: `src/lib/cityArena/render/drawPeople.test.ts`
- Create: `src/lib/cityArena/render/drawPickups.test.ts`
- Modify: `src/lib/cityArena/render/palette.ts`
- Modify: `src/lib/cityArena/render/drawVehicles.ts`
- Modify: `src/lib/cityArena/render/renderScene.ts`
- Modify: `src/lib/cityArena/render/renderScene.test.ts`

**Rendering rules:**

- Keep all coordinates in metres until the existing `worldToScreen`/camera transform. Use the same
  culling margin as cars and skip entities outside `visibleRect` plus 5 m.
- Draw pickups before cars: weapon pickups are rotating/bobbing diamonds in the weapon colour,
  health is a green diamond with a white cross, and taken pickups are omitted. Bobbing is a pure
  function of `tick` and pickup id, so screenshots and tests are deterministic.
- Draw cars before people. Add a small police light bar and alternating blue/red blink to police
  vehicles; the blink is derived from `tick`, not wall-clock time. Wrecked police cars keep the
  existing wreck painter and lose the light bar.
- Draw pedestrians and cops after cars and before bullets. Living people have a facing-based body,
  a readable colour distinction, and a small health cue only when damaged. Dead bodies remain as a
  muted, short-lived shape. Cops have a visible badge/blue accent but remain recognisable at the
  phone zoom level.
- Preserve the existing order for bullets, effects, player and crosshair. The final order is
  world -> zone -> pickups -> vehicles -> people/cops -> bullets -> effects -> player -> crosshair.
- Do not draw wanted stars, zone text or the radar inside `renderScene`; those belong to the HUD
  layer and must remain accessible HTML.

**Radar interfaces:**

```ts
export type RadarSnapshot = {
  player: Point;
  roads: Array<readonly [Point, Point]>;
  pickups: Array<{ point: Point; kind: PickupKind }>;
  police: Array<Point>;
  zoneCentre: Point | null;
  zoneRadiusM: number | null;
};

export const RADAR_SIZE_PX = 90;
export const RADAR_RANGE_M = 150;
export const EMPTY_RADAR_SNAPSHOT: RadarSnapshot = {
  player: [0, 0],
  roads: [],
  pickups: [],
  police: [],
  zoneCentre: null,
  zoneRadiusM: null,
};

export function radarRoads(
  roads: MapRoads,
  centre: Point,
  rangeM: number,
): Array<readonly [Point, Point]>;

export function drawRadar(
  context: RasterContext,
  snapshot: RadarSnapshot,
  size: number,
): void;
```

The radar is north-up, centred on the player and scaled to 0.3 px/m. Clip to a circular 90 px
disc, draw a dark background, road lines, the zone edge, pickups and blue police/cops dots, then
the player dot last. Translate world points relative to `snapshot.player`; never rotate with the
player. Clamp the zone circle to the radar bounds rather than drawing an unbounded arc. Add tests
for the scale, translation, culling to 150 m, null zone, pickup colours and the draw order.

- [x] **Step 1: Write the failing painter and radar tests**
- [x] **Step 2: Run the focused tests and record the expected failures**
- [x] **Step 3: Implement the pure painters and palette constants**
- [x] **Step 4: Extend `Scene` and compose the render order**
- [x] **Step 5: Implement and test `radar.ts`**
- [x] **Step 6: Run `npx tsc --noEmit && npx vitest run src/lib/cityArena/render`**
- [x] **Step 7: Commit**

Commit subject:

```text
feat(arena): render pedestrians pickups police and radar
```

### Task 10: Synthesised sound and the persisted "Geluid" setting

**Files:**

- Create: `src/lib/cityArena/audio/sound.ts`
- Create: `src/lib/cityArena/audio/testing/fakeAudioContext.ts`
- Create: `src/lib/cityArena/audio/sound.test.ts`
- Modify: `src/lib/cityArena/schemas.ts`
- Modify: `src/lib/cityArena/storage.ts` only if the schema default requires a migration-safe read

Use a narrow `AudioContextLike` interface instead of casting the browser `AudioContext` throughout
the game. `createArenaSound(factory, enabled)` returns an `ArenaSound` with `unlock`, `setEnabled`,
`handleEvents`, `updateEngine` and `dispose`; the factory is injected in tests and defaults to the
browser context in the hook. The implementation must be a no-op when `window` or Web Audio is not
available, and every storage/audio failure must be contained and tagged `area: "arena"`.

**Sound mapping:**

- `shot`: short oscillator/noise voice per pistol, Uzi and shotgun; use the event position only for
  the event's own gain/pitch calculation, not for spatial audio.
- `explosion`: descending noise burst; `pickup`: two-note confirmation; `hit`: short click.
- `updateEngine(speedMps, active)` keeps one engine oscillator alive while driving and changes its
  frequency through a clamped speed curve. It stops it when the player exits or the car is wrecked.
- `unlock` resumes the context after the first real pointer or keyboard interaction. It must be
  idempotent and must never start an audio context during server render.
- `setEnabled(false)` immediately mutes the master gain and prevents future voices; turning it on
  does not replay old events.
- `handleEvents` ignores unknown/future event kinds and processes at most `MAX_EVENTS` events.

Extend `ArenaSettingsSchema` with `sound: z.boolean().default(true)`. Parsing old settings must
produce `sound: true`, while an invalid blob still follows the existing safe-default path. Add fake
nodes that record oscillator type/frequency, gain values, connect/disconnect and resume calls.
Tests must prove no voice is created while disabled, unlock is idempotent, old settings gain the new
default, engine cleanup is complete, and event handling never leaks a timer or a node.

- [x] **Step 1: Write the schema, fake-context and sound contract tests**
- [x] **Step 2: Run the focused tests and record the expected failures**
- [x] **Step 3: Implement the injected Web Audio synth and safe no-op fallback**
- [x] **Step 4: Add the `sound` settings default and storage coverage**
- [x] **Step 5: Run `npx tsc --noEmit && npx vitest run src/lib/cityArena/audio src/lib/cityArena/storage.test.ts`**
- [x] **Step 6: Commit**

Commit subject:

```text
feat(arena): add synthesised sound setting and event voices
```

### Task 11: Pure HUD projections and accessible arena HUD components

**Files:**

- Create: `src/components/cityArena/arenaHud.ts`
- Create: `src/components/cityArena/ArenaRadar.tsx`
- Create: `src/components/cityArena/ArenaWanted.tsx`
- Create: `src/components/cityArena/ArenaZoneWarning.tsx`
- Create: `src/components/cityArena/ArenaSoundToggle.tsx`
- Create: component tests for all four new components and `arenaHud.test.ts`
- Modify: `src/components/cityArena/arenaRuntime.ts`
- Modify: `src/components/cityArena/ArenaVitals.tsx` only if the HUD needs a shared label primitive

Move the growing HUD projection out of `arenaRuntime.ts` before wiring it. `computeHud` keeps the
existing zone/street/vitals fields and adds:

```ts
export type ArenaHud = {
  zoneName: string | null;
  zoneKey: ZoneKey | null;
  street: string | null;
  health: number;
  weapon: WeaponKind;
  ammo: AmmoState;
  speedMps: number | null;
  inVehicle: boolean;
  wantedLevel: number;
  zoneSecondsLeft: number | null;
  zoneWarning: boolean;
  soundEnabled: boolean;
};

export function buildRadarSnapshot(
  state: ArenaState,
  zone: MapZone | null,
): RadarSnapshot;
export function zoneWarningText(secondsLeft: number | null): string | null;
```

`ArenaWanted` renders accessible Dutch text (`Gezocht: 0 sterren` through `Gezocht: 3 sterren`)
and decorative stars with `aria-hidden`. `ArenaZoneWarning` uses a live region only while the player
is outside an enforced zone; it displays `Terug naar het strijdgebied! 5…` with a numeric countdown
and does not announce every simulation tick when the value has not changed. `ArenaSoundToggle` is a
real labelled checkbox, calls a supplied callback, and exposes the persisted state without reading
localStorage itself.

`ArenaRadar` owns a 90 px canvas and paints a snapshot at the HUD refresh cadence. It sets the
backing dimensions for device-pixel ratio, has `aria-label="Radar"`, and exposes a short adjacent
text summary for screen readers (zone and number of visible pickups/police). It must not run a
requestAnimationFrame loop of its own.

Tests cover: exact Dutch labels, 0/3-star boundaries, no warning when `zoneEnforced` is false, the
5-second and damage states, checkbox persistence callback, canvas resizing, and radar repaint when
the snapshot changes. Keep the components presentational and avoid inline style props.

- [x] **Step 1: Write pure projection and component tests**
- [x] **Step 2: Run the focused tests and record the expected failures**
- [x] **Step 3: Extract `arenaHud.ts` and implement the four components**
- [x] **Step 4: Add the radar canvas resize/paint helper and test it with a fake 2D context**
- [x] **Step 5: Run `npx tsc --noEmit && npx vitest run src/components/cityArena`**
- [x] **Step 6: Commit**

Commit subject:

```text
feat(arena): add wanted zone radar and sound HUD
```

### Task 12: Wire events, audio, radar and debug data through the runtime

**Files:**

- Modify: `src/components/cityArena/arenaRuntime.ts`
- Modify: `src/components/cityArena/useArenaGame.ts`
- Modify: `src/components/cityArena/CityArenaOverlay.tsx`
- Modify: `src/components/cityArena/ArenaDebugOverlay.tsx`
- Modify: `src/components/cityArena/useArenaGame.test.tsx`
- Modify: `src/components/cityArena/CityArenaOverlay.test.tsx`
- Modify: `src/lib/cityArena/test/hooks.ts` and its tests

Keep the fixed-step loop authoritative. Add an `ArenaSound` to `Runtime`, created once during boot
with an injected `audioContextFactory` option for tests. After each `stepArena`, pass the returned
events to `sound.handleEvents`, then update engine pitch from the post-step occupied vehicle. Do not
play events from React state effects: that would duplicate voices when React rerenders or when a HUD
snapshot is delayed. Call `sound.unlock()` from the existing keyboard/pointer interaction path and
from touch-button input, guarded by the enabled setting.

Pass `viewRect` to `ArenaWorld` from the current camera in `advanceSimulation`, so cop spawning and
police visibility use the same frame as rendering. Build one HUD snapshot per 100 ms containing the
radar projection; pass it to the overlay while the Canvas continues at display refresh. Dispose the
sound object in the boot cleanup before disposing the world session.

Extend `useArenaGame` with `sound` state and `setSound(enabled)`, load it from `loadArenaSettings`
before the first HUD snapshot, and save only on explicit toggle changes. `INITIAL_HUD` must remain
fully populated for the loading phase. Preserve cancellation guards so a late boot cannot update
state or create an audio context after unmount.

Update `CityArenaOverlay` as follows:

1. The top HUD keeps zone/street and vitals, then shows `ArenaWanted` and `ArenaSoundToggle`.
2. The playfield gets `ArenaZoneWarning` over the main canvas and `ArenaRadar` in a fixed HUD corner;
   the radar remains visible while the death overlay is shown but is dimmed by existing layers.
3. The close button and zone picker keep their existing keyboard behaviour and remain reachable
   above the new HUD elements.
4. Touch controls do not duplicate the sound toggle and do not steal focus from the checkbox.

Extend the debug snapshot with counts for peds, cops, traffic and pickups, wanted level, zone
seconds, and current event count. Add `window.__arena.setZoneEnforced(boolean)` and
`window.__arena.addHeat(number)` only behind the existing debug flag. The hooks must be test-only
seams and must not add production controls or bypass the fixed-step simulation.

Add tests for one sound call per event batch, engine updates while driving, disposal on unmount,
settings round-trip, HUD refresh throttling, radar snapshot freshness, zone-warning transitions,
debug hook mutations and the existing cancellation/teleport paths. Verify a zero-event tick does
not call any sound voice method.

- [x] **Step 1: Write runtime and overlay wiring tests**
- [x] **Step 2: Run focused tests and capture failures before implementation**
- [x] **Step 3: Thread the sound object and camera view rectangle through the frame loop**
- [x] **Step 4: Add throttled HUD/radar projections and the overlay layout**
- [x] **Step 5: Extend debug hooks and entity counters**
- [x] **Step 6: Run `npx tsc --noEmit && npx vitest run src/components/cityArena src/lib/cityArena`**
- [ ] **Step 7: Run the browser-facing arena smoke checks with the feature flag enabled**
- [x] **Step 8: Commit**

Commit subject:

```text
feat(arena): wire simulation events into the playable HUD
```

### Task 13: Documentation, final verification and PR handoff

**Files:**

- Modify: `docs/tech/arena/README.md`
- Modify: `docs/superpowers/specs/2026-09-03-city-arena-design.md` only for factual drift found
- Modify: `docs/_generated/routes.md` only if route generation changes
- Add/update the Part 4b plan checkboxes as each task is completed

Add a `Runtime (PR 4 — pedestrians, cops, pickups and audio)` section to the arena runbook. Document:

- the active-zone population and entity caps;
- the wanted heat values, levels, cop escalation and police-car release behaviour;
- the 500 m zone rule and the `zoneEnforced` free-roam/match seam;
- pickup placement/respawn and pistol-plus-fist spawn loadout;
- the 90 px north-up radar scale and the Dutch accessibility labels;
- the sound setting key, default, Web Audio fallback and browser-unlock behaviour;
- the debug hooks, how to force heat/zone enforcement, and the invariant counters;
- the exact verification commands and the intentional external-service skips.

Do not describe planned multiplayer transport as shipped. Keep the existing ODbL attribution and map
licensing language unchanged. Run `npm run docs:generate` only if an API route changed; this slice
should not add an API route.

**Verification loop:**

1. `npx prettier --write` on every changed TS/TSX/MD file.
2. `npx tsc --noEmit`.
3. `npm run lint` and confirm only the two accepted existing warnings remain.
4. `npx vitest run src/lib/cityArena src/components/cityArena`.
5. Run the tests listed in `enabled_tests.txt` for the coverage report; do not count disabled or
   external-service suites. If coverage is reported, use the repository's `coverage_report.md`
   format.
6. `npm run build`.
7. Run the repository security/merge-marker checks and inspect `git diff --check`.
8. Start the app with the launcher feature flag, open `?debug=1`, and manually verify: radar north
   orientation, pickups, pedestrian flee/run-over, wanted stars, cop pursuit, zone countdown,
   police-car escalation, sound toggle persistence, death/respawn and no console errors.
9. Review the diff for narration comments, redundant defensive checks, unsafe casts, accidental
   API-route changes, English user-facing strings and generated/build files.
10. Update every completed checkbox in this plan, then commit the docs and code together only after
    the full loop is green.

Final commit subject:

```text
feat(arena): ship pedestrians wanted gameplay and radar audio
```

The PR description must list the simulation, rendering, audio, HUD and verification changes, state
that Plan 3 netcode and Plan 6 feedback effects are intentionally out of scope, and include the
test/build results. Before opening or updating the PR, confirm the worktree contains no unrelated
admin/branding changes and that the Plan 4a parent remains the only base dependency.

## Part 2 completion checklist

- [x] Tasks 1-8 implemented, tested and committed from Part 1.
- [x] Task 9 painters, police livery and radar implemented with pure render tests.
- [x] Task 10 Web Audio synth, fake context and settings migration implemented.
- [x] Task 11 accessible Dutch HUD components and pure projections implemented.
- [x] Task 12 runtime, overlay, debug hooks and cleanup wired without duplicate event playback.
- [ ] Task 13 runbook updated and the complete verification loop passed.
- [x] Final diff reviewed for scope, slop, unsafe casts, magic numbers and unrelated files.

### Post-merge verification status — 2026-09-06

- The `image` branch post-merge workflow passed, including its read-only HTTP and
  Playwright smoke checks: [run 34035378318](https://github.com/grvermeulen/H3-Teamy/actions/runs/34035378318).
- Those repository smoke checks cover the homepage and login page, not the arena
  interaction path. The arena-specific browser smoke in Task 13 Step 7 remains open
  because no local browser provider was available during verification.
- Local merged-branch verification after regenerating the Prisma client: TypeScript
  passed, the arena suite passed (`86 files`, `425 tests`), lint passed with the two
  existing warnings, and merge-marker checks passed.
