# GTA H3 3D Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 2D/3D switch in GTA H3 whose 3D view (third and first person) renders the unchanged simulation with rich procedural characters and vehicles, plus networked destructible buildings and a rocket launcher shared by both views.

**Architecture:** The pure 2D simulation stays the single source of truth. Buildings gain identity and health in the sim (networked in the snapshot). A lazily imported three.js renderer (`src/lib/cityArena/render3d/`) draws the same `Scene` the 2D renderer draws into a WebGL canvas under the existing 2D canvas, which becomes the HUD layer; a pure input transform turns the camera's yaw into the sim's `move`/`aim`.

**Tech Stack:** Next.js 16 client components, TypeScript 6.0.3, three.js 0.186.1 (`three`, `@types/three` — already in `package.json` on this branch), Vitest 5 (jsdom), existing arena modules.

**Spec:** `docs/superpowers/specs/2026-09-26-arena-3d-mode-design.md` — read it before your task.

## Global Constraints

- All user-facing strings Dutch (NL); identifiers, comments and log messages English.
- Every exported symbol has a JSDoc and an explicit return type (CodeRabbit docstring coverage 80 %).
- Functions ≤ 50 lines; numbers with meaning are named constants (CodeRabbit flags both).
- Every `catch` calls `Sentry.captureException(error, { tags: { area: "arena", kind: "<kind>" } })` (use `reportArenaError` in `src/components/cityArena/arenaRuntime.ts` from components).
- No inline `style` props in React; Tailwind classes only.
- Tests: `vi.stubEnv` never raw `process.env`; `beforeEach(() => vi.clearAllMocks())` in describes that mock.
- Commit subjects ≤ 72 chars, conventional (`feat(arena): …`), ending the message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The pre-commit hook runs Prettier, ESLint, `tsc --noEmit` and the whole Vitest suite (~70 s). Let it run; never `--no-verify`.
- Coordinates: world metres, x east, y south, angles `atan2(dy, dx)`. three.js: `(x, y) → (x, height, y)`; see `render3d/coords.ts` (Task 0).
- `render3d/**` may import `three`; nothing outside `render3d/` and `components/cityArena/view3d/` may import `three` statically (bundle size — 3D is a dynamic import).
- The simulation stays deterministic and pure: no `Math.random`, no `Date.now` in `sim/**` (use the `random` argument and `tick`).
- Wire changes append only; an older row must still decode.

## Parallel tracks and worktrees

| Track                                 | Tasks         | Worktree / branch (from the Task 0 commit)                 |
| ------------------------------------- | ------------- | ---------------------------------------------------------- |
| Main (integration)                    | 0, 7–9, 16–18 | `.claude/worktrees/arena-3d` · `feat/arena-3d`             |
| S — sim, net, 2D                      | 1–6           | `.claude/worktrees/arena-3d-sim` · `feat/arena-3d-sim`     |
| W — 3D world                          | 10–11         | `.claude/worktrees/arena-3d-world` · `feat/arena-3d-world` |
| C — 3D characters, weapons, pickups   | 12–13         | `.claude/worktrees/arena-3d-chars` · `feat/arena-3d-chars` |
| V — 3D vehicles, effects, destruction | 14–15         | `.claude/worktrees/arena-3d-fx` · `feat/arena-3d-fx`       |

Tracks W, C and V only **create** files under `src/lib/cityArena/render3d/` (disjoint file sets
listed per task) and never edit files outside it, so they merge without conflicts. Track S edits the
sim, net and 2D render modules. Main merges each track branch when it is done.

Each worktree's `node_modules` is a directory junction to the main worktree's
(`cmd /c mklink /J node_modules ..\arena-3d\node_modules`), so `npx vitest`, `npx tsc` and the hook work.

---

## Task 0: Shared 3D foundation (Main)

**Files:**

- Create: `src/lib/cityArena/render3d/coords.ts`, `src/lib/cityArena/render3d/coords.test.ts`
- Create: `src/lib/cityArena/render3d/palette3d.ts`
- Create: `src/lib/cityArena/render3d/disposal.ts`, `src/lib/cityArena/render3d/disposal.test.ts`

**Interfaces — Produces:**

```ts
// coords.ts
export const PERSON_CHEST_HEIGHT_M = 1.3; // where bullets fly
export const EYE_HEIGHT_M = 1.65;
export function worldToThree(
  x: number,
  y: number,
  height?: number,
): Vector3Tuple; // [x, height, y]
export function headingToRotationY(heading: number): number; // -heading; local forward = +X
export function directionFromYawPitch(yaw: number, pitch: number): Vector3Tuple;
export function yawFromThreeDirection(dx: number, dz: number): number; // atan2(dz, dx)

// palette3d.ts — plain hex numbers, no three import
export const SKY_TOP = 0x0b1630;
export const SKY_HORIZON = 0x3a4a6b;
export const HORIZON_GLOW = 0xd08a52;
export const FOG_COLOUR = 0x26324c;
export const MOON_LIGHT = 0xb9c8ff;
export const AMBIENT_SKY = 0x5a6c9a;
export const AMBIENT_GROUND = 0x2a2420;
export const LAMP_GLOW = 0xffc46b;
export const WINDOW_WARM = 0xffcf7a;
export const WINDOW_COLD = 0xa9d2ff;
export const WINDOW_DARK = 0x1a1f2b;

// disposal.ts
export function disposeObject(root: Object3D): void; // geometries + materials (+ their textures) under root, once each
```

- [ ] Step 1: tests — `worldToThree(3, 4, 1)` → `[3, 1, 4]`; for heading `h` in `[0, π/2, π, -π/3]`, rotating `(1,0,0)` by `headingToRotationY(h)` about Y yields `(cos h, 0, sin h)` (use `new Vector3(1,0,0).applyAxisAngle(new Vector3(0,1,0), r)`); `directionFromYawPitch(0, 0)` → `[1, 0, 0]`, `(π/2, 0)` → `[0, 0, 1]`, `(0, π/2)` → `[0, 1, 0]` (≈); `yawFromThreeDirection` inverts `directionFromYawPitch` for pitch 0; `disposeObject` calls `dispose` once on a geometry and material shared by two meshes.
- [ ] Step 2: run `npx vitest run src/lib/cityArena/render3d` → FAIL (modules missing).
- [ ] Step 3: implement (≈60 lines total).
- [ ] Step 4: re-run → PASS.
- [ ] Step 5: commit `feat(arena): add shared 3D coordinate and palette helpers`.

---

## Task 1: Structure identity and the collision view (Track S)

**Files:**

- Modify: `src/lib/cityArena/world/decode.ts` (DecodedBuilding, decodeTile)
- Create: `src/lib/cityArena/world/structureId.ts` (+ `.test.ts`)
- Modify: `src/lib/cityArena/world/collisionGrid.ts` (Obstacle, buildObstaclesForTile, `resolveCircleSkipping`)
- Create: `src/lib/cityArena/world/collisionView.ts` (+ `.test.ts`)
- Modify: `src/lib/cityArena/world/raycast.ts` (`firstBuildingHitDetail`)
- Modify: `src/lib/cityArena/sim/bullets.ts` (building target carries `structureId`)

**Interfaces — Produces:**

```ts
// structureId.ts
export const STRUCTURE_TILE_STRIDE = 64;
export const STRUCTURE_INDEX_STRIDE = 65536;
/** Throws RangeError when tileX/tileY ∉ [0, 64) or index ∉ [0, 65536). */
export function structureIdOf(tileX: number, tileY: number, index: number): number;
export function structureTileOf(id: number): { tileX: number; tileY: number; index: number };
export const MIN_STRUCTURE_HEALTH = 120; export const MAX_STRUCTURE_HEALTH = 1800;
export const STRUCTURE_HEALTH_PER_M2_LEVEL = 1.2;
/** Infinity for a landmark; else clamp(area × max(1, levels) × 1.2, 120, 1800). */
export function structureMaxHealth(ring: readonly Point[], levels: number, landmark: boolean): number;

// decode.ts — DecodedBuilding gains
structureId: number;   // structureIdOf(tile.x, tile.y, positionInTile)

// collisionGrid.ts — Obstacle gains
structure?: { id: number; maxHealth: number };  // buildings only
// CollisionGrid gains
resolveCircleSkipping(centre: Point, radius: number, skip: (obstacle: Obstacle) => boolean): Point;

// collisionView.ts
export type CollisionView = Pick<CollisionGrid, "query" | "resolveCircle"> &
  Partial<Pick<CollisionGrid, "resolveCircleSkipping">>;
/** Returns `collision` itself when `destroyed` is empty; otherwise a view whose query drops
 * destroyed buildings and whose resolveCircle skips them (pass-through when the grid lacks
 * resolveCircleSkipping — test fakes). */
export function withoutStructures(collision: CollisionView, destroyed: ReadonlySet<number>): CollisionView;

// raycast.ts
export function firstBuildingHitDetail(
  collision: Pick<CollisionGrid, "query">, from: Point, to: Point,
): { point: Point; structureId: number | null } | null;   // firstBuildingHit now delegates to it

// bullets.ts
export type BulletTarget =
  | { kind: "building"; structureId: number | null }
  | { kind: "vehicle"; vehicleId: number }
  | { kind: "player"; playerId: number };
```

`ArenaWorld.collision` (in `sim/arenaWorld.ts`) changes its type to `CollisionView`.

- [ ] Step 1: failing tests —
  - `structureIdOf(3, 5, 17)` round-trips through `structureTileOf`; `structureIdOf(64, 0, 0)` and `structureIdOf(0, 0, 65536)` throw `RangeError`.
  - `structureMaxHealth(square10m, 2, false)` = 240; tiny ring → 120; huge → 1800; landmark → `Infinity`.
  - `decodeTile` on a two-building fixture yields ids `structureIdOf(x, y, 0)` and `(x, y, 1)`.
  - A grid with one 10 m building: `withoutStructures(grid, new Set([id])).query(rect)` is empty, and `.resolveCircle([5,5], 0.4)` returns `[5,5]` unchanged, while the raw grid pushes it out. With an empty set, `withoutStructures(grid, new Set())` is `grid` (`toBe`).
  - `firstBuildingHitDetail` returns the building's `structureId`; water never counts.
- [ ] Step 2: run `npx vitest run src/lib/cityArena/world` → FAIL.
- [ ] Step 3: implement. `resolveCircleSkipping` is `resolveCircleAgainst` with a `skip` predicate threaded into the obstacle loop (refactor `resolveCircleAgainst(index, centre, radius, corridors, skip = () => false)`). `buildObstaclesForTile` sets `structure: { id: building.structureId, maxHealth: structureMaxHealth(ring, levels, Boolean(landmark)) }`. Area via the shoelace formula in `structureId.ts` (or `polygonArea` if `mapBuild/geometry.ts` exports one — check first).
- [ ] Step 4: `npx vitest run src/lib/cityArena` and `npx tsc --noEmit` → PASS (fix every compile error the `BulletTarget` change surfaces; `applyHit`'s building branch keeps returning the state unchanged for now).
- [ ] Step 5: commit `feat(arena): give buildings structure ids and a collision view`.

---

## Task 2: Structure damage, collapse and rebuild (Track S)

**Files:**

- Create: `src/lib/cityArena/sim/structures.ts` (+ `.test.ts`)
- Modify: `src/lib/cityArena/sim/types.ts` (ArenaState.structures, ArenaEvent `collapse`)
- Modify: `src/lib/cityArena/sim/arena.ts` (collision view at step start; `stepStructures`)
- Modify: `src/lib/cityArena/sim/combat.ts` (bullet → building damage)
- Modify: `src/lib/cityArena/sim/invariants.ts` (structures ≤ cap, ids unique)

**Interfaces — Produces:**

```ts
// types.ts
export type StructureState = {
  id: number;
  damage: number;
  destroyedAtTick: number | null;
  lastHitTick: number;
  /** Footprint centre and circumradius, metres; 0 on a client that adopted the row from the wire. */
  x: number;
  y: number;
  radius: number;
};
// ArenaState gains:  structures?: StructureState[];
// ArenaEvent gains:  | { kind: "collapse"; structureId: number; x: number; y: number; killerId: number | null }

// structures.ts
export const MAX_STRUCTURES = 48;
export const STRUCTURE_HEAL_TICKS = 2700; // 90 s
export const STRUCTURE_REBUILD_TICKS = 7200; // 4 min
export const BULLET_STRUCTURE_FACTOR = 0.25;
export const CRUSH_PERSON_DAMAGE = 60;
export const CRUSH_VEHICLE_DAMAGE = 120;
export const CRUSH_MARGIN_M = 1.5;
export type StructureHit = {
  obstacle: Obstacle;
  amount: number;
  killerId: number | null;
};
export function destroyedStructureIds(
  state: Pick<ArenaState, "structures">,
): ReadonlySet<number>;
export function structureDamageShare(
  entry: StructureState | undefined,
  maxHealth: number,
): number; // 0..1
export function damageStructure(
  state: ArenaState,
  hit: StructureHit,
  tick: number,
): ArenaState;
export function stepStructures(state: ArenaState, tick: number): ArenaState;
```

Rules (spec §3): ignore landmarks (`maxHealth === Infinity`) and already destroyed entries;
accumulate `damage`, set `lastHitTick`; at `damage >= maxHealth` set `destroyedAtTick = tick`,
push `collapse`, crush (players on foot, peds, cops within the footprint or `CRUSH_MARGIN_M` of it
take `CRUSH_PERSON_DAMAGE`; cars whose centre is inside or within margin take
`CRUSH_VEHICLE_DAMAGE`), and push `kill` events attributed to `killerId` for each death it caused.
New entry when full: drop the intact entry with the least damage; if none, the oldest destroyed.
`stepStructures`: drop intact entries with `tick - lastHitTick >= STRUCTURE_HEAL_TICKS`; drop
destroyed entries with `tick - destroyedAtTick >= STRUCTURE_REBUILD_TICKS` unless a living
player, ped, cop or car centre lies within `radius` of `(x, y)` (skip the check when `radius` is 0).
Keep the list sorted by id (deterministic snapshots).

In `stepArena`: right after `let next = { ...state, tick, events: [] }` build
`const live: ArenaWorld = { ...world, collision: withoutStructures(world.collision, destroyedStructureIds(state)) }`
and pass `live` instead of `world` to every stage; call `next = stepStructures(next, tick)` after
`applyExplosions`. In `combat.ts` `applyHit`, a `building` target with a `structureId` looks up
its obstacle (`world.collision.query` around the point, match by `structure.id`) and calls
`damageStructure` with `hit.bullet.damage * BULLET_STRUCTURE_FACTOR` unless the weapon is melee
(`advanceBullets` already receives `world`; pass it to `applyHit`).

- [ ] Step 1: failing tests in `structures.test.ts` using a real `createCollisionGrid()` with a
      decoded fixture tile holding one 10 m × 10 m, 1-level building (maxHealth 120):
  - three 50-damage hits → destroyed at the third tick, one `collapse` event, entry has x/y = 5/5, radius ≈ 7.07.
  - a landmark building never gets an entry.
  - a ped standing 1 m outside the wall takes 60 when it collapses and dies at 60 health → `kill` with the killer id.
  - `stepStructures` heals an intact entry after 2700 ticks, keeps it at 2699; rebuilds a destroyed one after 7200 ticks, but not while a car sits at its centre.
  - cap: 49 hits on 49 distinct buildings keep 48 entries, dropping the least-damaged intact one.
  - integration via `stepArena`: a player at x=0 firing the pistol east at a building 5 m away for enough ticks destroys it; afterwards a bullet passes the footprint and `resolveCircle` no longer pushes the player out of it.
- [ ] Step 2: run → FAIL. Step 3: implement. Step 4: `npx vitest run src/lib/cityArena` + `npx tsc --noEmit` → PASS.
- [ ] Step 5: commit `feat(arena): damage, collapse and rebuild buildings in the sim`.

---

## Task 3: Explosive projectiles and attributed blasts (Track S)

**Files:**

- Create: `src/lib/cityArena/sim/blast.ts` (+ `.test.ts`)
- Modify: `src/lib/cityArena/sim/combat.ts` (explodeVehicle via applyBlast; detonate explosive bullets)
- Modify: `src/lib/cityArena/sim/bullets.ts` (`stepBullets` also returns `expired`)
- Modify: `src/lib/cityArena/sim/weapons.ts` (`isExplosive`, `EXPLOSIVES`)

**Interfaces — Produces:**

```ts
// blast.ts
export type Blast = {
  x: number; y: number;
  entityRadius: number; entityDamage: number;   // people on foot, peds, cops
  vehicleDamage: number;                        // cars whose centre is within entityRadius + 1 m
  structureRadius: number; structureDamage: number;
  ownerId: number | null;                        // kills are credited to it
};
export const BLAST_EDGE_FACTOR = 0.5;            // damage at the edge of a radius
export function blastFalloff(distance: number, radius: number): number; // 1 at 0 → 0.5 at radius, 0 beyond
export function applyBlast(state: ArenaState, blast: Blast, world: ArenaWorld, tick: number): ArenaState;
export const CAR_BLAST: Omit<Blast, "x" | "y" | "ownerId">;   // 3 m / 80 / 80 / 6 m / 260

// weapons.ts
export const EXPLOSIVES: Partial<Record<WeaponKind, Omit<Blast, "x" | "y" | "ownerId">>>;
//   cannon: 4 m / 70 / 90 / 5 m / 320;  rocket (Task 4 adds it): 4 m / 70 / 90 / 5 m / 420
export function isExplosive(kind: WeaponKind): boolean;

// bullets.ts
export function stepBullets(...): { bullets: BulletState[]; hits: BulletHit[]; expired: BulletState[] };
```

`applyBlast` emits one `explosion` event and one `explosion` effect at `(x, y)`, damages the
entities with `blastFalloff`, damages every structure whose footprint the `structureRadius`
circle overlaps (`damageStructure`, amount scaled by the falloff at the nearest footprint point),
and pushes `kill` events for deaths with `killerId: ownerId`. `explodeVehicle` keeps its occupant
rule (lethal) and calls `applyBlast` with `CAR_BLAST` and `ownerId: null` — existing car-explosion
tests must stay green (they assert 80 damage inside 3 m: with falloff, a victim at distance `d`
takes `80 × blastFalloff(d, 3)`; update the expectations in `combat`/`damage` tests only where they
measured a victim away from the centre, and say so in the commit body). In `advanceBullets`, a hit or
an `expired` bullet whose weapon `isExplosive` calls `applyBlast` at the hit point (or the bullet's
last position) with the bullet's `ownerId`; direct-hit damage still applies first.

- [ ] Step 1: failing tests — falloff values (0 → 1, r/2 → 0.75, r → 0.5, r+0.01 → 0); a cannon
      shell hitting a building 10 m away destroys a 120-health shed and credits the shooter with the
      ped it crushes; a cannon shell that runs out of range still explodes at its end point; a blast
      kills a player on foot and the `kill` event has `killerId` = shooter; a wrecked car's blast still
      records `killerId: null`.
- [ ] Step 2 → FAIL; Step 3 implement; Step 4 `npx vitest run src/lib/cityArena` + tsc → PASS.
- [ ] Step 5: commit `feat(arena): explode shells on impact with credited blasts`.

---

## Task 4: The rocket launcher (Track S)

**Files (audit every reader — `npx tsc --noEmit` lists most; also grep):**

- Modify: `sim/types.ts` (`WeaponKind`, `MagazineWeapon`, `PickupKind` += `"rocket"`)
- Modify: `sim/weapons.ts` (WEAPONS.rocket, WEAPON_ORDER, MAGAZINE_WEAPONS, SPAWN_AMMO, MAX_AMMO, EXPLOSIVES.rocket)
- Modify: `sim/pickups.ts` (PICKUP_ROUNDS.rocket = 4; `ROCKET_PICKUPS_PER_ZONE = 1`, placed after bats)
- Modify: `input/weaponSelect.ts` (slot 6), `input/keyboard.ts` (`Digit6`)
- Modify: `audio/sound.ts` (rocket shot = the cannon's sound path, a whoosh if a clip map exists)
- Modify: `render/sprites.ts` (`ITEM_KEYS` += rocket), `render/drawPickups.ts` + held-item drawing (vector fallback: olive tube with a red tip), `render/radar.ts` (pickup colour)
- Modify: `components/cityArena/arenaHud.ts`, `components/cityArena/ArenaVitals.tsx` (label "Raketwerper", ammo)
- Grep: `rg -n '"rifle"' src/lib/cityArena src/components/cityArena` — every list of weapons or pickups must decide about `rocket`.

**Spec values:** `rocket: { label: "Raketwerper", damage: 60, shotsPerSecond: 0.6, rangeM: 90, speedMps: 45, spreadRad: 0, pellets: 1, magazine: 4 }`; `MAX_AMMO.rocket = 12`; `SPAWN_AMMO.rocket = 0`.

- [ ] Step 1: failing tests — `nextWeapon("rifle", {…, rocket: 2})` → `"rocket"`; `cooldownTicks("rocket")` = 50; picking up a rocket pickup grants 4 and arms a pistol-holder; `placePickups` yields exactly one rocket pickup in a zone with enough spawn nodes; slot 6 selects the rocket; a fired rocket travels 1.5 m per tick.
- [ ] Step 2 → FAIL; Step 3 implement; Step 4 full arena tests + tsc → PASS.
- [ ] Step 5: commit `feat(arena): add the rocket launcher weapon and pickup`.

---

## Task 5: Structures and rockets on the wire (Track S)

**Files:**

- Modify: `net/snapshotWire.ts` — `WEAPONS` and `PICKUP_KINDS` append `"rocket"`; player row index 22 = `ammo.rocket`; bullet row index 7 = weapon index; new optional `z?: number[][]` rows `[id, damage, destroyedAtTick | NONE, lastHitTick]`, omitted when empty; `SnapshotView.structures: SnapshotStructure[]` (`[]` when absent); `SnapshotBullet.weapon`.
- Modify: `net/wireValidation.ts` — accept rows of the old and new lengths; `z` ≤ `MAX_STRUCTURES` rows of 4 finite integers; weapon/pickup indexes within the (longer) lists.
- Modify: `net/snapshotApply.ts` — `structures` adopted wholesale, keeping local `x/y/radius` for ids the client already has (else 0); `patchBullet` takes `row.weapon`.
- Modify: `net/snapshotDelta.ts` if it enumerates snapshot keys (check).
- Test: `net/snapshotWire.test.ts` (create if absent), `net/wireValidation.test.ts`, `net/snapshotApply.test.ts`, `net/botMatch.test.ts`.

- [ ] Step 1: failing tests — round-trip of a state with two structures (one destroyed) and a rocket bullet; decoding a player row of length 22 yields `ammo.rocket = 0`; a bullet row of length 7 decodes `weapon: "pistol"`; validation rejects 49 structure rows and a structure row of length 3; `snapshotBytes` of the existing max-size fixture plus 48 structures stays under `MAX_SNAPSHOT_BYTES`; bot acceptance: the host's player fires the tank cannon (or `damageStructure` is invoked on the host state between ticks) until a building collapses, and every bot client's view lists it as destroyed within 10 snapshots.
- [ ] Step 2 → FAIL; Step 3 implement; Step 4 `npx vitest run src/lib/cityArena/net` + full suite + tsc → PASS.
- [ ] Step 5: commit `feat(arena): carry structures and rockets in snapshots`.

---

## Task 6: Ruins, rockets and collapse feedback in 2D (Track S)

**Files:**

- Create: `src/lib/cityArena/render/drawStructures.ts` (+ `.test.ts` with `render/testing/fakeContext.ts`)
- Modify: `render/renderScene.ts` (Scene gains `structures?: readonly StructureState[]`; draw after chunks)
- Modify: `components/cityArena/arenaRuntime.ts` `buildScene` (pass `state.structures`)
- Modify: `render/drawProjectiles.ts` (rocket: 0.9 m olive body + 6 fading smoke puffs behind it)
- Modify: `components/cityArena/arenaFeel.ts` (a `collapse` event = explosion sound, heavy haptic, shake if within 60 m)

**Interfaces — Produces:**

```ts
export const RUBBLE_FILL = "#3b3631";
export const RUBBLE_CHUNK = "#27231f";
export const DAMAGE_SHADE_MAX_ALPHA = 0.55;
/** Draws rubble over destroyed footprints and a dark shade over damaged ones, for every decoded
 * building in view whose structureId has an entry. Pure canvas calls; no raster invalidation. */
export function drawStructureDamage(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  tiles: readonly DecodedTile[],
  structures: readonly StructureState[],
): void;
```

- [ ] Step 1: failing tests — with a fake context: a destroyed entry fills its ring once with `RUBBLE_FILL` and draws ≥ 4 chunk polygons seeded deterministically by id (same calls twice); a 50 % damaged entry fills with `rgba(0,0,0,0.275)`; buildings outside the view rect are skipped; no entries → no calls.
- [ ] Step 2 → FAIL; Step 3 implement; Step 4 → PASS (+ full suite, tsc).
- [ ] Step 5: commit `feat(arena): draw ruins, damage and rockets in the 2D view`.

---

## Task 7: View settings, toggles and the camera-relative input (Main)

**Files:**

- Modify: `src/lib/cityArena/schemas.ts` — `view: z.enum(["2d","3d"]).default("2d")`, `camera3d: z.enum(["third","first"]).default("third")`; `DEFAULT_ARENA_SETTINGS` gains both.
- Modify: `src/components/cityArena/ArenaSettingsSheet.tsx` — two segmented controls: "Weergave" (`2D` / `3D`) and "3D-camera" (`Derde persoon` / `Eerste persoon`, disabled in 2D).
- Modify: `src/components/cityArena/CityArenaOverlay.tsx` — HUD toggle button (`aria-label="Wissel naar 3D"` / `"Wissel naar 2D"`, text `3D`/`2D`).
- Create: `src/lib/cityArena/input/cameraInput.ts` (+ `.test.ts`)
- Create: `src/lib/cityArena/input/mouseLook.ts` (+ `.test.ts`)
- Modify: `src/lib/cityArena/input/keyboard.ts` — `onToggleCamera` hook on `KeyV`.

**Interfaces — Produces:**

```ts
// cameraInput.ts
/** Rotates screen-space movement into the camera's frame (W = along yaw) on foot and for an analog
 * stick in a car; a keyboard in a car keeps its tank steering. `aim` becomes `aimYaw`. */
export function cameraRelativeInput(
  input: WorldInput,
  yaw: number,
  driving: boolean,
  aimYaw: number | null,
): WorldInput;

// mouseLook.ts
export const MOUSE_SENSITIVITY_RAD_PER_PX = 0.0024;
export type MouseLook = {
  yaw(): number;
  pitch(): number;
  locked(): boolean;
  setYaw(yaw: number): void;
  setPitchLimits(min: number, max: number): void;
  /** Radians of yaw added since the last call — the chase camera eases only when this is 0 for a while. */
  takeYawDelta(): number;
  detach(): void;
};
export function attachMouseLook(
  target: HTMLElement,
  onGesture?: () => void,
): MouseLook;
```

Rotation maths: screen vector `[sx, sy]` with `sy = -1` meaning forward; forward `f = (cos yaw, sin yaw)`, right `r = (-sin yaw, cos yaw)`; `move = f·(−sy) + r·sx`.

- [ ] Step 1: failing tests — W with yaw 0 → move `[1, 0]`; W with yaw π/2 → `[0, 1]`; D with yaw 0 → `[0, 1]`; driving + keyboard leaves `move` untouched; driving + analog rotates; `aim` = `aimYaw`; mouse-look: a synthetic `pointermove` with `movementX: 100` while `document.pointerLockElement === target` adds `0.24` rad of yaw; pitch clamps to limits; settings schema parses `{}` to `view: "2d", camera3d: "third"`.
- [ ] Step 2 → FAIL; Step 3 implement; Step 4 → PASS.
- [ ] Step 5: commit `feat(arena): add 3D view settings and camera-relative input`.

---

## Task 8: Renderer skeleton, camera rig and runtime wiring (Main)

**Files:**

- Create: `src/lib/cityArena/render3d/cameraRig.ts` (+ `.test.ts`) — pure maths
- Create: `src/lib/cityArena/render3d/renderer3d.ts` — WebGL renderer, scene, sky, lights, fog
- Create: `src/lib/cityArena/render3d/overlay3d.ts` (+ `.test.ts`) — crosshair projection and drawing on the 2D context
- Create: `src/lib/cityArena/render3d/index.ts` — the dynamic-import entry
- Create: `src/components/cityArena/view3d/useView3d.ts` — owns the lazy import, the WebGL canvas ref, fallback toast
- Modify: `src/components/cityArena/arenaRuntime.ts` — `Runtime.view3d?: View3dHandle`; `runFrame` calls `paint3d` instead of `paintCanvas` when set (no split screen); input goes through `cameraRelativeInput`
- Modify: `src/components/cityArena/CityArenaOverlay.tsx` — WebGL `<canvas>` under the 2D canvas (`pointer-events-none absolute inset-0`), hint "Klik om te richten · V wisselt camera"

**Interfaces — Produces:**

```ts
// cameraRig.ts
export type CameraMode = "third" | "first";
export type RigInput = {
  mode: CameraMode;
  yaw: number;
  pitch: number;
  target: { x: number; y: number };
  driving: { length: number; heading: number } | null;
  dead: boolean;
  deadSeconds: number;
  dt: number;
};
export type RigPose = {
  position: Vector3Tuple;
  lookAt: Vector3Tuple;
  fovDeg: number;
};
export function rigPose(input: RigInput): RigPose;
export const THIRD_PERSON_BACK_M = 3.6;
export const THIRD_PERSON_UP_M = 1.9;
export const SHOULDER_M = 0.55;

// overlay3d.ts
export const AIM_PROJECT_DISTANCE_M = 25;
/** Screen point of the in-plane shot line 25 m ahead at chest height. */
export function crosshairScreen(
  camera: PerspectiveCamera,
  origin: { x: number; y: number },
  yaw: number,
  size: { width: number; height: number },
): [number, number] | null;

// index.ts (dynamically imported)
export type View3dFrame = {
  scene: Scene;
  tiles: readonly DecodedTile[];
  structures: readonly StructureState[];
  yaw: number;
  pitch: number;
  mode: CameraMode;
  dt: number;
  nowMs: number;
  deadSeconds: number | null;
  quality: "auto" | "low" | "high";
  size: { width: number; height: number };
};
export type View3dHandle = {
  render(frame: View3dFrame, overlay: CanvasRenderingContext2D): void;
  dispose(): void;
};
export function createView3d(canvas: HTMLCanvasElement): View3dHandle; // throws if WebGL is unavailable
```

Until Tracks W/C/V land, `index.ts` renders placeholders: ground plane, extruded grey boxes for
buildings of loaded tiles within 200 m, capsules for people, boxes for cars — enough to drive around.

- [ ] Step 1: failing tests — third person behind a player at yaw 0 sits at `x = -3.6` (+ shoulder offset on z) and looks forward; first person sits at eye height at the target; driving pulls back by `length`; death raises the camera over time; crosshair projection at pitch 0 lands on the screen's centre column.
- [ ] Step 2 → FAIL; Step 3 implement; Step 4 → PASS; browser check (Task 18 flow) that 3D renders and WASD + mouse drive it.
- [ ] Step 5: commit `feat(arena): render the arena in 3D behind a view switch`.

---

## Task 9: Entity sync (Main)

**Files:** Create `src/lib/cityArena/render3d/entities.ts` (+ `.test.ts`).

```ts
export type EntityFactories = {
  character(look: CharacterLook, vestHue?: number): Character3d; // Task 12
  vehicle(kind: VehicleKind, colour: number): Vehicle3d; // Task 14
  pickup(kind: PickupKind): Pickup3d; // Task 13
};
export type EntitySync = {
  update(scene: Scene, dt: number, cameraFocus: { x: number; y: number }): void;
  group: Object3D;
  dispose(): void;
};
export function createEntitySync(factories: EntityFactories): EntitySync;
export const CHARACTER_DRAW_DISTANCE_M = 180;
export const VEHICLE_DRAW_DISTANCE_M = 320;
```

Keyed pools by entity id (`player:<id>`, `ped:<id>`, `cop:<id>`, `car:<id>`, `pickup:<id>`); an
object unseen for a frame is released back to a per-look/per-kind free list; walking phase is the
accumulated distance per id. Tests use fake factories and assert creation, reuse after release,
distance culling and the local player hidden in first person.

- [ ] Steps: failing tests → implement → pass → commit `feat(arena): sync 3D entities from the scene`.

---

## Task 10: Surface and façade textures (Track W)

**Files:** Create `src/lib/cityArena/render3d/textures.ts` (+ `.test.ts`).

```ts
export const TEXTURE_REPEAT_M = 8;
export type SurfaceKey =
  "road" | "pavement" | "water" | GroundKind | "roofTiles" | "roofFlat";
/** URLs from the sprite manifest's `surfaces` (read `public/arena/sprites/manifest.json` shape via render/loadSprites.ts types). */
export function surfaceUrl(key: SurfaceKey): string;
export type FacadeStyle = "brick" | "plaster" | "concrete" | "glass";
/** A seeded canvas texture: one storey (3.1 m) tall, 6 m wide, windows lit by `litShare`. */
export function createFacadeTexture(
  style: FacadeStyle,
  seed: number,
  litShare: number,
): CanvasTexture;
export function createSurfaceMaterials(
  load: (url: string) => Texture,
): Record<SurfaceKey, MeshLambertMaterial>;
```

Façade canvas 256×132 px per storey-module: base colour per style (brick `#6d3b2c` with mortar
lines, plaster `#8f8878`, concrete `#5f6368`, glass `#2b3c4f` with mullions), two windows per module
with sill; each window lit with probability `litShare` (seeded mulberry32) in `WINDOW_WARM`/`WINDOW_COLD`,
else `WINDOW_DARK`. The facade material uses the texture as `map` and a second canvas (lit windows
only) as `emissiveMap` with `emissive: 0xffffff`, so windows glow at night. Tests (jsdom has no
canvas 2D; stub `HTMLCanvasElement.prototype.getContext` with `render/testing/fakeContext.ts`):
seed determinism (same draw calls), lit share 0 draws no warm/cold fills, `surfaceUrl("grass")`
ends with `ground-grass.png`.

- [ ] Steps: failing tests → implement → pass → commit `feat(arena): add 3D surface and facade textures`.

---

## Task 11: World cells — ground, roads, buildings, trees, furniture, landmarks (Track W)

**Files:** Create `src/lib/cityArena/render3d/cellGrid.ts`, `buildCell.ts`, `buildingMesh.ts`,
`landmarkDressing.ts`, `worldCells.ts` (each + `.test.ts`).

```ts
// cellGrid.ts
export const CELL_M = 128;
export type CellCoord = { cx: number; cy: number };
export function cellOf(x: number, y: number): CellCoord;
export function cellKey(cell: CellCoord): string;
export function cellsWithin(x: number, y: number, radius: number): CellCoord[]; // nearest first
/** The ring's owner cell = the cell holding its first vertex's bounds centre (no duplicates across cells). */
export function ownerCell(bounds: Rect): CellCoord;

// buildingMesh.ts
export const STOREY_M = 3.1;
export const MIN_BUILDING_HEIGHT_M = 3.5;
export function buildingHeight(levels: number): number;
export type BuildingRange = {
  structureId: number;
  start: number;
  count: number;
}; // vertex range in the merged walls
/** Walls (outward normals, u along the perimeter in metres / 6, v in storeys) + flat roof cap
 * (ShapeUtils triangulation, uv = world metres / 8) + a low hip on small houses. */
export function buildBuildingGeometry(
  buildings: readonly DecodedBuilding[],
  skip: ReadonlySet<number>,
): {
  walls: BufferGeometry;
  roofsTiled: BufferGeometry;
  roofsFlat: BufferGeometry;
  ranges: BuildingRange[];
};
/** Multiplies the wall colour attribute of one building by (1 − 0.8·share), scorching it. */
export function shadeBuilding(
  walls: BufferGeometry,
  range: BuildingRange,
  share: number,
): void;

// landmarkDressing.ts
export function landmarkDressing(
  style: LandmarkStyle,
  ring: readonly Point[],
  height: number,
): Object3D;
//   church: square tower at the ring's farthest-from-centroid vertex + spire; pool: translucent blue glass
//   hall; campus: glass band + roof fins; cafe: striped awning; brewery: chimney + copper kettle.

// buildCell.ts
export type CellInput = {
  cell: CellCoord;
  tiles: readonly DecodedTile[];
  destroyed: ReadonlySet<number>;
  materials: WorldMaterials;
};
export type BuiltCell = {
  group: Group;
  ranges: BuildingRange[];
  walls: BufferGeometry | null;
  furniture: FurnitureInstance[];
  dispose(): void;
};
export type FurnitureInstance = {
  kind: FurnitureKind;
  x: number;
  y: number;
  heading: number;
  object: Object3D;
};
export function buildCell(input: CellInput): BuiltCell;

// worldCells.ts
export type WorldCells = {
  group: Group;
  update(
    focus: { x: number; y: number },
    tiles: readonly DecodedTile[],
    structures: readonly StructureState[],
    viewDistance: number,
    budgetMs: number,
  ): void;
  furnitureNear(x: number, y: number, radius: number): FurnitureInstance[]; // for cosmetic knock-over
  dispose(): void;
};
export function createWorldCells(materials: WorldMaterials): WorldCells;
```

Geometry rules: ground polygons triangulated with `ShapeUtils.triangulateShape` at y = 0 (water at
−0.05); roads as ribbons of `ROAD_WIDTH_M[class]` at y = 0.02 with pavements `+2 × PAVEMENT_WIDTH_M`
at y = 0.015 (mitred joins, round caps are not needed); centre lines on the classes 2D draws them;
trees as two `InstancedMesh`es per cell (trunk cylinder 0.35 m × 2.4 m; canopy icosahedron radius
`TREE_CANOPY_M[size]/2`, height 2.4 + radius, two greens by id parity); furniture: lamp (pole 4.5 m +
emissive head `LAMP_GLOW` + additive glow sprite), bench, bus shelter (glass back panel). A cell
owns only geometry whose `ownerCell` it is; per cell, merge by material. `update` builds missing
cells nearest-first until `budgetMs` elapses (`performance.now()`), disposes cells beyond
1.4 × `viewDistance`, rebuilds a cell whose set of destroyed ids changed, and re-shades damaged
buildings when their share changes (compute `maxHealth` with `structureMaxHealth`).

Tests: `cellsWithin(0,0,200)` is sorted by distance and contains `(0,0)` first; ownerCell is unique
for a ring spanning two cells; `buildBuildingGeometry` of a 10×10 m, 2-level square: 4 wall quads
(24 vertices with non-indexed quads or 16 indexed), height 6.2, all normals horizontal and outward
(dot with centroid→vertex > 0), roof in `roofsTiled` (≤ 300 m², ≤ 3 levels), none `NaN`; a skipped
id produces no vertices; `shadeBuilding` at share 1 scales colours to 0.2; `buildCell` on a fixture
tile produces a group with ≥ 1 child per present layer and disposes all geometries; `worldCells.update`
with a 0 ms budget still builds one cell per call (progress guarantee).

- [ ] Steps: failing tests → implement → pass → commit `feat(arena): build the 3D city in streamed cells`.

---

## Task 12: Characters and the first-person view model (Track C)

**Files:** Create `src/lib/cityArena/render3d/characterRig.ts`, `characterLooks.ts`,
`characters.ts`, `characterPose.ts`, `viewmodel.ts` (each + `.test.ts`).

```ts
// characterLooks.ts
export type CharacterLook =
  | "player"
  | "otherPlayer"
  | "ped1"
  | "ped2"
  | "ped3"
  | "ped4"
  | "ped5"
  | "ped6"
  | "cop";
export function pedLookOf(pedId: number): CharacterLook; // `ped${(id % 6) + 1}` — matches 2D's pedLook = id % 6
export type LookSpec = {
  build: "broad" | "average" | "slim";
  skin: number;
  hair: HairStyle;
  top: Garment;
  bottom: Garment;
  shoes: number;
  extras: Extra[];
};
export const LOOKS: Record<CharacterLook, LookSpec>; // spec §6.6 table, colours sampled from the 2D sprites

// characterRig.ts
export const BONES = [
  "pelvis",
  "spine",
  "chest",
  "neck",
  "head",
  "upperArmL",
  "lowerArmL",
  "handL",
  "upperArmR",
  "lowerArmR",
  "handR",
  "upperLegL",
  "lowerLegL",
  "footL",
  "upperLegR",
  "lowerLegR",
  "footR",
] as const;
export type BoneName = (typeof BONES)[number];
/** One merged, rigidly skinned geometry for a look (cached per look + vest hue) and a fresh skeleton. */
export function buildCharacterMesh(
  look: LookSpec,
  vestHue?: number,
): SkinnedMesh;

// characterPose.ts — pure
export type HeldWeapon = WeaponKind;
export type PoseInput = {
  speed: number;
  phaseM: number;
  aiming: boolean;
  weapon: HeldWeapon | null;
  dead: boolean;
  tick: number;
  recoil: number;
};
export type BoneRotations = Partial<Record<BoneName, [number, number, number]>>;
export function poseFor(input: PoseInput): {
  rotations: BoneRotations;
  pelvisHeight: number;
  lying: boolean;
};

// characters.ts
export type Character3d = {
  object: Object3D;
  update(pose: PoseInput): void;
  dispose(): void;
};
export function createCharacter(
  look: CharacterLook,
  vestHue?: number,
): Character3d;

// weapons3d.ts (also this task)
export function createWeaponModel(kind: WeaponKind): Object3D; // pistol, uzi, shotgun, rifle, bat, rocket, fist → empty

// viewmodel.ts
export type ViewModel = {
  object: Object3D;
  update(input: {
    weapon: WeaponKind;
    firedTick: number | null;
    tick: number;
    speed: number;
    dt: number;
  }): void;
  dispose(): void;
};
export function createViewModel(): ViewModel; // hands in the player's skin tone + weapon, bob, recoil kick
```

Proportions (metres): total height 1.8 (player 1.85, broad shoulders 0.56 wide; average 0.44;
slim 0.38), head 0.24, pelvis at 0.95. Geometry from boxes with bevel-like chamfer (use
`BoxGeometry` then scale vertices toward the centre at edges — or simple boxes with 2 segments and a
slight taper); faces: eyes as two dark boxes, the player's red-lensed sunglasses (emissive red
tint 0x7a1010) and grey goatee, cop cap with a peak and neon-yellow bands (0xd7ff1f) on the torso and
sleeves, ped6's ponytail, ped2's flat cap, ped3's/ped4's hoods, ped1's backpack. Vertex colours carry
the palette; one `MeshLambertMaterial({ vertexColors: true })` shared by every character.

Poses: walk/run cycle from `phaseM` (stride 1.4 m walking, 2.2 m running above 4 m/s): legs swing
±0.6 rad, knees bend on the back swing, arms counter-swing; idle breathing on `tick`; aiming raises
the right arm (and left for two-handed guns) toward the forward axis; bat wind-up swings on recoil;
dead lies flat (`lying: true`, the object is rotated −π/2 about its forward axis and lowered).

Tests: 17 bones; every vertex's skin index in range with weight 1; the mesh's bounding box height is
within ±0.1 m of the look's height; `pedLookOf(7)` = `"ped2"`; pose at speed 0 is symmetric; at
phase 0 and phase stride/2 the legs mirror; `aiming` raises `upperArmR` pitch above 1.2 rad;
`createWeaponModel("rocket")` is longer than 0.9 m; `createWeaponModel("fist")` has no children;
view model recoil returns to rest within 0.3 s of simulated `dt`.

- [ ] Steps: failing tests → implement → pass → commit `feat(arena): add rigged 3D characters and weapons`.

---

## Task 13: Pickups (Track C)

**Files:** Create `src/lib/cityArena/render3d/pickups3d.ts` (+ `.test.ts`).

```ts
export type Pickup3d = {
  object: Object3D;
  update(input: { taken: boolean; tick: number }): void;
  dispose(): void;
};
export function createPickup3d(kind: PickupKind): Pickup3d;
```

A weapon model (or a white box with a red cross for health) floating at 1.0 m, spinning 1.2 rad/s,
bobbing 0.08 m; a glow disc on the ground (additive, colour per kind from `render/radar.ts`'s pickup
colours); hidden while taken. Tests: hidden when taken; rotation advances with tick; health has a
cross child.

- [ ] Steps: failing tests → implement → pass → commit `feat(arena): add 3D pickups`.

---

## Task 14: Vehicles (Track V)

**Files:** Create `src/lib/cityArena/render3d/vehicleModels.ts`, `vehicles3d.ts` (each + `.test.ts`).

```ts
export type Vehicle3dInput = {
  speed: number;
  steer: number;
  wrecked: boolean;
  siren: boolean;
  tick: number;
  health: number;
  turretYaw: number | null;
  dt: number;
};
export type Vehicle3d = {
  object: Object3D;
  update(input: Vehicle3dInput): void;
  dispose(): void;
};
export function createVehicle3d(kind: VehicleKind, colour: number): Vehicle3d;
export function vehicleHeight(kind: VehicleKind): number;
```

Every model at the simulation's exact `lengthOf(kind)` × `widthOf(kind)` (import from `sim/vehicle.ts`),
local forward +X, origin at the footprint centre on the ground. Parts: lower body (colour
`CAR_BODY_COLOURS[colour]`, police white with a blue band and orange stripe, tractor green, tank
olive), cabin with dark glass (`CAR_WINDOW`), four wheels (tractor: big rear), emissive headlights
(0xfff3c4) and tail lights (0xff2a2a), police light bar alternating blue/red at 4 Hz when `siren`,
bus with a window band and destination board "H3", oldtimer with rounded fenders (cylinders),
pickup with an open bed, van tall box, tank hull + turret (rotates to `turretYaw − heading`) + barrel.
Wheels spin `speed / wheelRadius` and the front pair steers `steer × 0.5 rad`. Wrecked: every
material swapped for a charred shared material (0x1a1512), lights off. Materials shared per colour.

Tests: for every kind the model's bounding box length/width match the sim within 5 %; height ≈
`vehicleHeight`; wheels rotate with speed; wrecked swaps materials; police bar colour alternates
with tick when siren is on and stays dark when off; tank turret yaw follows input.

- [ ] Steps: failing tests → implement → pass → commit `feat(arena): add 3D vehicle models`.

---

## Task 15: Effects and destruction visuals (Track V)

**Files:** Create `src/lib/cityArena/render3d/particles.ts`, `effects3d.ts`, `destruction3d.ts`
(each + `.test.ts`).

```ts
// particles.ts — one pooled Points system per blend mode
export type Particle = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  colour: number;
  gravity: number;
  drag: number;
};
export type ParticleSystem = {
  object: Points;
  spawn(p: Omit<Particle, "life">): void;
  update(dt: number): void;
  alive(): number;
  dispose(): void;
};
export function createParticleSystem(
  capacity: number,
  additive: boolean,
): ParticleSystem;

// effects3d.ts
export type Effects3d = {
  object: Object3D;
  sync(scene: Scene): void; // new muzzle/impact/explosion effects by id; tracers + rockets from bullets
  update(dt: number): void;
  dispose(): void;
};
export function createEffects3d(options: { maxParticles: number }): Effects3d;

// destruction3d.ts
export type CollapseInput = {
  structureId: number;
  ring: readonly Point[];
  height: number;
};
export type Destruction3d = {
  object: Object3D;
  collapse(input: CollapseInput): void; // 1.6 s sink + tilt of a one-off mesh, dust, chunks
  setRubble(entries: readonly CollapseInput[]): void; // mounds for every destroyed id (idempotent)
  knockOver(object: Object3D, fromX: number, fromY: number): void; // furniture falls away from the hit
  update(dt: number): void;
  dispose(): void;
};
export function createDestruction3d(particles: ParticleSystem): Destruction3d;
```

Explosion: additive fireball sphere scaling 0.5 → 4 m over 0.35 s fading, a `PointLight`
(0xffa040, intensity 40 → 0 over 0.25 s, pooled, max 4 lit), 24 smoke particles rising, 12 debris
chunks with gravity 9.8. Muzzle: small additive quad + light 0.05 s. Impact: 6 sparks. Tracer: a
thin additive line from the bullet position back 3 m along its direction at chest height. Rocket:
0.9 m body + smoke particle every frame. Collapse: the building's own extruded mesh (use
`buildBuildingGeometry` from Track W only through the `CollapseInput` ring/height you receive —
build a simple extruded prism here; do not import `buildingMesh.ts`) sinks by its height with ease-in
and tilts ≤ 8° about a random horizontal axis (seeded by id), 60 dust particles along the footprint
and 20 chunks; afterwards a rubble mound (low extruded footprint, 0.8 m, jittered top vertices seeded
by id, colour `0x4a4239`). Knock-over rotates the object 90° away from the hit over 0.5 s.

Tests: particles expire after `maxLife` and the pool reuses slots; `sync` spawns one explosion per
new effect id and never twice for the same id; an explosion releases its light after 0.25 s;
collapse finishes (object removed) after 1.6 s and `setRubble` is idempotent; knock-over ends at
90° ± 1°.

- [ ] Steps: failing tests → implement → pass → commit `feat(arena): add 3D explosions, ruins and debris`.

---

## Task 16: Assemble the full 3D view (Main)

Merge tracks W, C, V into `feat/arena-3d` (`git merge --no-ff feat/arena-3d-world` etc.), then
replace the placeholders in `render3d/index.ts`: world cells (view distance by quality 260/380/520 m),
entity sync with the real factories, effects, destruction (collapse on `collapse` events in the frame's
events — carry `state.events` on the `View3dFrame`), furniture knock-over when a car within 1.5 m moves
faster than 3 m/s, view model in first person, sky dome (inverted sphere with a vertical gradient
shader material), moon light, hemisphere light, fog. Navigation route as a glowing ribbon 0.1 m above
the road; mission contact beacons as tall translucent cylinders (GTA-style); zone boundary as a
translucent wall; other players get a coloured diamond marker 2.6 m up and a vest hue by id.

- [ ] Browser check, screenshots, commit `feat(arena): assemble the 3D city, cast and effects`.

---

## Task 17: Merge Track S and connect destruction end to end (Main)

Merge `feat/arena-3d-sim`; pass `state.structures` and `state.events` into `View3dFrame`; the 3D
collapse and the 2D ruins must both follow a building destroyed by a rocket. Browser check both views.

- [ ] Commit `feat(arena): connect networked destruction to the 3D view`.

---

## Task 18: Docs, version, verification, PR (Main)

- `package.json` version bump (minor) and a matching `src/lib/changelog.ts` entry in Dutch
  ("GTA H3 in 3D: …", "Gebouwen kun je nu opblazen", "Raketwerper").
- `docs/tech/arena/` page `3d-mode.md`; README section for the arena controls (V, 6, click to aim).
- Verification loop: `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`
  (revert regenerated artefacts per the repo's habit), security scan of the diff, `git diff` review.
- Browser: `h3-arena-3d` launch entry (port 3005, this worktree), log in with the seeded preview
  trainer, play in 2D and 3D (third + first person), destroy a building with a rocket, screenshots.
- PR against `image`: title `feat(arena): 3D mode with destructible buildings`, body with
  screenshots, test counts, deviations, and `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
