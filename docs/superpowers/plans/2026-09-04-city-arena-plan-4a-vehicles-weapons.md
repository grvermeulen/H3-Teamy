# GTA H3 Plan 4a — Vehicles, Weapons and the Death Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the free-roam walk of Plan 2 into a playable single-player slice of GTA H3: parked cars you can enter and drive (arcade physics, damage, smoke, explosions), four weapons with bullets that stop at buildings and damage cars, 100 hp with death, a 3 s respawn and blinking invulnerability, the owner's "wasted" artwork as the death screen, a HUD with health/weapon/ammo/speed, touch buttons next to the floating stick, mouse aim on desktop, and a `window.__arena` debug seam with an invariant checker — all driven by one pure, deterministic `stepArena` that a later host-authoritative loop (Plan 3) can run unchanged.

**Architecture:** The simulation stays a pure fixed-step function of data: `stepArena(state, input, dt, world, random)` takes an immutable `ArenaState` (player with health/weapon/ammo/vehicle, vehicles, bullets, effects, tick, held-button edges), a device-agnostic `WorldInput`, the injected world (collision grid + map index) and a seeded `random`, and returns a new state — no DOM, no timers, no globals. It is composed from small entity modules in `src/lib/cityArena/sim/` (`weapons`, `vehicle`, `bullets`, `collisions`, `damage`, `effects`, `spawn`, `arena`, `invariants`) plus a `world/raycast` helper. Rendering adds `drawVehicles`/`drawProjectiles` to the existing viewport renderer (world → zone ring → cars → bullets → effects → player → crosshair) and a pure `deathScreenPhase(elapsedS, reducedMotion)` that both the frame loop (time scale, push-in) and the `DeathOverlay` component (artwork beats) read. React stays thin: `useArenaGame` swaps `FreeRoamState` for `ArenaState`, wires mouse aim, touch buttons, the HUD vitals and the death overlay, and installs the debug hooks behind `?debug=1`.

**Tech Stack:** Next.js 16 App Router (client components, `next/dynamic`), React 19, TypeScript 6 strict, Tailwind v4 utilities, Canvas 2D (`OffscreenCanvas` when available), Zod 4, Vitest + Testing Library, `@sentry/nextjs`.

**Spec:** `docs/superpowers/specs/2026-09-03-city-arena-design.md` §5 (weapons table, cars, health/death/respawn, spawn selection), §7 (desktop keys, touch buttons, input model, **death screen**), §8 (frame order, camera look-ahead), §12.A3–A4 (`window.__arena`, invariants — minimal subset), §13 (file layout), §16 (glossary). This is PR 3 of 7 in the owner's reordered roadmap (gameplay before multiplayer); it consumes the Plan 2 runtime (`src/lib/cityArena/{world,sim,input,render}/**`, `src/components/cityArena/**`).

**Scope decisions for this plan (recorded so nobody re-litigates them):**

1. Single-player only. `ArenaState` has one `player` (id `0`); every entity-level function (`stepVehicle`, `stepBullets`, `damagePlayer`, `resolveVehicleAgainstPlayer`) is written per entity so Plan 3 can lift `player` into `players` without touching the physics. Rounds, scoreboards and remote players are Plan 3; pedestrians, cops, pickups, zone enforcement, radar and SFX are Plan 4b.
2. Until pickups exist (Plan 4b) the player spawns with the full arsenal — pistol (∞), Uzi 60 rounds, shotgun 8 shells, fist — so the weapons are playable and testable now. Plan 4b changes the spawn loadout to pistol-only. The fist is modelled as a weapon whose "bullet" travels 1.2 m (no separate melee code).
3. Cars are parked on road-graph spawn nodes (8 per zone, ≥ 12 m apart, headed along the nearest road edge); the spec's "≈ 1 per 40 m along residential roads, offset to the kerb" placement and ambient traffic move to Plan 4b together with pedestrians.
4. Input model per spec §7 without `seq` (`{ move, aim: angle | null, fire, enter, weaponNext }`); Plan 3 wraps it in a sequenced envelope. `aim === null` means "fire in the facing direction" (touch in this plan; twin-stick is Plan 6). Enter/exit and weapon-next are edge-triggered inside the simulation (`state.held`), so a host receiving 10 Hz held-flags behaves the same as the local loop.
5. Randomness is injected: the runtime creates `createRng(seed)` once per session and passes it to `createArenaState`/`stepArena`; `state.seed` records the seed. Spread, car placement, colours and the respawn tie-break are the only consumers.
6. Slow motion on death is applied in the single-player loop by scaling the simulation `dt` by `deathScreenPhase().timeScale` for the first 0.3 s; the respawn timer is tick-based (90 ticks), so the artwork's fade-to-black holds until the simulation respawns. Plan 3 moves the time scale into the interpolation layer (the host is never slowed).
7. Camera zoom stays quantised (4/6/8 px/m) while driving; only the look-ahead cap grows (15 m → 30 m). Zooming out at speed is Plan 6 polish.
8. The desaturation of the death screen is a `backdrop-*` filter layer of the overlay (no class toggling on the canvas); the camera push-in is a canvas transform in `renderScene` (`Scene.pushIn`). Both keep the renderer viewport-based for TV mode.

## Global Constraints

- Node.js 22, Next.js 16 App Router, React 19, TypeScript 6 `strict`; Tailwind v4; Vitest (jsdom) with `@/` alias for `src/`.
- No `any`, no unsafe casts, no non-null assertions; `catch (error: unknown)`; explicit return types on every exported function; `const list: Foo[] = []` never `[] as Foo[]`.
- Every exported function, class, type-bearing constant and component has a JSDoc `/** ... */` block.
- Every function under 50 lines (a reviewer bot enforces it); descriptive full-word identifiers — `x`, `y`, `dx`, `dy`, `a`, `b`, `t` allowed only inside geometry/camera math helpers.
- Every `catch` in production code calls `Sentry.captureException(error, { tags: { area: "arena", kind } })` or re-throws; cache/storage failures never propagate.
- All user-facing strings Dutch (glossary in spec §16); identifiers English; the UI title is "GTA H3" (owner ruling 2026-09-04; the earlier never-"GTA" rule is withdrawn).
- No inline `style` props in new components — Tailwind utilities only (arbitrary values allowed, e.g. `z-[3200]`); the one exception is the canvas element, which sets no styles at all.
- Tests co-located; `vi.mocked(fn)`; every `describe` using mocks has `beforeEach(() => { vi.clearAllMocks(); })`; `vi.stubEnv`/`vi.unstubAllEnvs` for env; never `fireEvent`/`userEvent` inside `waitFor`; no bare date-only strings.
- Asset facts (verbatim from PR 1): `MAP_BASE_PATH = "/arena/map/v1"`; `index.json` fields `version: 1, origin, unitsPerMetre: 4, bounds (units), tileSize: 8000 (units = 2 000 m), tiles[{x,y,file,bytes}], zones[{key,name,center,radius: 2000,spawnNodes,landmarks}], landmarks[{key,name,style,center,tile}]`; `roads.json = { nodes: number[] (flat units), edges: number[] (stride 6: a, b, classIndex, nameIndex (−1 unnamed), oneway, lengthUnits), classes: RoadClass[], names: string[] }`; tiles `{ x, y, roads[{points, roadClass, name?}], buildings[{points, levels, landmark?}], ground[{points, kind}], water[{points}] }` with flat integer `points` in units; tile rects overlap by 20 m; the grid is 7 × 5 anchored at the north-west corner (y grows south); 4 units = 1 m.
- Spec values (verbatim): walk speed 4 m/s × stick magnitude, player radius 0.4 m; fixed simulation step 30 Hz; camera look-ahead 0.4 s × velocity capped at 15 m, eased; zoom levels 4/6/8 px/m, phones ≈ 60 m across, desktops ≈ 120 m; chunk 128 m; ≤ 1 chunk rasterised per frame; ≤ 9 tiles resident; chunk cache ≤ 40 MB; tile fetch 3 retries with backoff then _"Kaart kon niet volledig laden"_ and hatched ground; overlay `fixed inset-0 z-[3200]` with `pt-safe pb-safe-bottom-bar pl-safe pr-safe`; street names on named segments ≥ 40 m, one label per 120 m, rotated with the road and flipped when upside down; road widths primary 9 m, secondary 8, tertiary 7, residential/unclassified 6, living*street 5, pedestrian/service 4; landmark styles church/pool/campus/cafe; attribution *"Kaart © OpenStreetMap-bijdragers"\_ on every overlay screen; settings key `h3-arena-settings-v1`.
- Gameplay values (verbatim from spec §5/§7/§8, this plan): health 100, no regen; respawn after 3 s (90 ticks) at the spawn node maximising the minimum distance to alive enemies (seeded tie-break), 2 s (60 ticks) blinking invulnerability; Pistool 20 dmg · 2.5/s · 40 m · 120 m/s · ∞; Uzi 10 · 10/s · 35 m · 110 m/s · ±4° · 60; Shotgun 5 × 12 · 1.2/s · 15 m · 90 m/s · 20° cone · 8; cars compact 6 m/s² / 22 m/s, sedan 8 / 28, sport 11 / 36, police 9 / 30; enter within 1.5 m, 0.6 s boarding; brake 14 m/s², reverse ≤ 8 m/s, angular velocity = steer × 2.6 rad/s × clamp(v/6, 0, 1) × (1 − 0.5·v/vmax), lateral velocity decays 90 %/s; collisions restitution 0.3, damage = max(0, impact speed − 4) × 3 to both cars, buildings take none; car health 100, smoke below 40, explosion at 0 (3 m radius, 80 damage, kills the occupant); run over at > 5 m/s: damage = 5 × speed; drive-by fires toward the aim; death screen beats 0–0.3 s slow motion (0.25×), 0.3 s artwork slam 1.15× → 1× with overshoot, 2.6–3.0 s fade to black, reduced motion skips slow-mo/push-in/overshoot. Documented choices where the spec is silent: fist 15 dmg · 2/s · 1.2 m reach; rolling deceleration 3 m/s²; car hull = two circles r 0.95 m at ±1.1 m for buildings, one circle r 1.6 m for car–car and car–player; run-over clearance 0.5 m; effects ttl muzzle 2 · impact 6 · explosion 18 ticks, ≤ 64 effects, ≤ 64 bullets; driving look-ahead cap 30 m; 8 parked cars per zone ≥ 12 m apart and ≥ 8 m from the player spawn.
- Conventional Commits, subject ≤ 72 chars, imperative; every commit ends with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; run `npx prettier --write <files>` before committing (the pre-commit hook runs Prettier, ESLint, `tsc --noEmit` and the full Vitest suite).
- Work happens in a new worktree `.claude/worktrees/city-arena-plan4a` on branch `feat/city-arena-plan4a` (stacked on `feat/city-arena-plan2` after its fix round is committed; rebase onto `image` once PR 2 merges). The code below targets the post-fix-round Plan 2 tree (`ArenaHud` already has `zoneKey`, `WorldSession.update` accepts `onProgress`, `useArenaGame.ts` exports `nearestLandmarkTo`).

---

## File structure

| Path                                                      | Responsibility                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/cityArena/sim/types.ts` (modify)                 | Extended `WorldInput`, `createInput`, `WeaponKind`, `VehicleKind`, `VehicleState`, `BulletState`, `EffectState`, `ArenaPlayerState`, `ArenaState` |
| `src/lib/cityArena/sim/weapons.ts`                        | Weapon table (spec §5 values), Dutch labels, cooldown ticks, ammo bookkeeping, weapon cycling                                                     |
| `src/lib/cityArena/sim/player.ts` (modify)                | `stepPlayer` honours `input.aim` for the facing                                                                                                   |
| `src/lib/cityArena/sim/vehicle.ts`                        | Car specs, OBB geometry, arcade physics, two-circle building collision                                                                            |
| `src/lib/cityArena/world/raycast.ts`                      | Segment intersection, first building hit through the collision grid                                                                               |
| `src/lib/cityArena/sim/bullets.ts`                        | Shot creation (pellets, spread), swept-segment hit tests (buildings, cars, players), bullet stepping                                              |
| `src/lib/cityArena/sim/collisions.ts`                     | Car–car circle resolution with restitution, car–player push-out and run-over damage                                                               |
| `src/lib/cityArena/sim/damage.ts`                         | Impact damage formula, player/vehicle damage with death, invulnerability, explosion constants                                                     |
| `src/lib/cityArena/sim/effects.ts`                        | Short-lived render effects (muzzle, impact, explosion) with ttl and a cap                                                                         |
| `src/lib/cityArena/sim/spawn.ts`                          | Parked-car placement on spawn nodes, road heading, respawn node choice, nearest zone                                                              |
| `src/lib/cityArena/sim/arena.ts`                          | `createArenaState`, `stepArena`, `teleportArenaPlayer` — the single entry point                                                                   |
| `src/lib/cityArena/sim/invariants.ts`                     | `checkInvariants(state): string[]`                                                                                                                |
| `src/lib/cityArena/input/inputState.ts` (modify)          | Buttons from keyboard and pointer sources, aim angle, `clearKeyboard`                                                                             |
| `src/lib/cityArena/input/keyboard.ts` (modify)            | Space fire, E/F/Enter enter, Q weapon                                                                                                             |
| `src/lib/cityArena/input/pointerAim.ts`                   | Mouse position on the canvas + left button fire                                                                                                   |
| `src/lib/cityArena/render/camera.ts` (modify)             | Look-ahead cap parameter, `DRIVING_LOOK_AHEAD_MAX_M`                                                                                              |
| `src/lib/cityArena/render/palette.ts` (modify)            | Car, bullet, effect, crosshair and dead-player colours                                                                                            |
| `src/lib/cityArena/render/drawVehicles.ts`                | Rotated car bodies with windows, headlights, smoke, wreck, occupant ring                                                                          |
| `src/lib/cityArena/render/drawProjectiles.ts`             | Bullet tracers, muzzle/impact/explosion effects, crosshair                                                                                        |
| `src/lib/cityArena/render/drawEntities.ts` (modify)       | `drawPlayer` takes a `PlayerStyle`; `playerLook` (normal/dead/hidden/blink)                                                                       |
| `src/lib/cityArena/render/renderScene.ts` (modify)        | Scene gains vehicles, bullets, effects, tick, aim, push-in; fixed draw order                                                                      |
| `src/lib/cityArena/render/deathScreen.ts`                 | `deathScreenPhase(elapsedS, reducedMotion)` — pure beat function                                                                                  |
| `src/lib/cityArena/test/hooks.ts`                         | `window.__arena` install/uninstall                                                                                                                |
| `src/components/cityArena/DeathOverlay.tsx`               | Artwork slam, vignette/desaturation backdrop, fade to black                                                                                       |
| `src/components/cityArena/ArenaVitals.tsx`                | Health bar, weapon + ammo, speed                                                                                                                  |
| `src/components/cityArena/ArenaTouchButtons.tsx`          | Schieten / Instappen–Uitstappen / Wapen buttons                                                                                                   |
| `src/components/cityArena/ArenaDebugOverlay.tsx` (modify) | Entity counts and invariant violations line                                                                                                       |
| `src/components/cityArena/useArenaGame.ts` (modify)       | `ArenaState` runtime, aim, buttons, death, time scale, hooks                                                                                      |
| `src/components/cityArena/CityArenaOverlay.tsx` (modify)  | Vitals, touch buttons, death overlay, mouse aim, footer hints                                                                                     |
| `src/app/globals.css` (modify)                            | `arena-wasted-slam` keyframes                                                                                                                     |
| `docs/tech/arena/README.md` (modify)                      | Runtime (PR 3) section                                                                                                                            |

Coordinates: **metres** everywhere (`Point = [x, y]`, north = negative y); angles in radians, `0` = east, positive turns clockwise on screen (y grows south); ticks are 30 Hz (`SIM_STEP_S`). A car's local frame has x forward and y to the right of the driver.

---

### Task 1: Simulation types, the weapon table and the extended input model

**Files:**

- Modify: `src/lib/cityArena/sim/types.ts`
- Create: `src/lib/cityArena/sim/weapons.ts`
- Modify: `src/lib/cityArena/sim/player.ts`
- Modify: `src/lib/cityArena/input/inputState.ts`
- Test: `src/lib/cityArena/sim/weapons.test.ts`, `src/lib/cityArena/sim/player.test.ts` (modify), `src/lib/cityArena/input/inputState.test.ts` (modify), `src/lib/cityArena/sim/freeRoam.test.ts` (modify), `src/lib/cityArena/input/keyboard.test.ts` (modify)

**Interfaces:**

- Consumes: `ZoneKey` (`../world/mapTypes`); `CollisionGrid` (`../world/collisionGrid`, `resolveCircle` only); existing `PlayerState`, `FreeRoamState`, `WALK_SPEED_MPS`, `PLAYER_RADIUS_M`, `SIM_STEP_S`, `MOVE_DEAD_ZONE`, `clampToUnit`.
- Produces: `WorldInput = { move: [number, number]; aim: number | null; fire: boolean; enter: boolean; weaponNext: boolean }`, `EMPTY_INPUT`, `createInput(partial: Partial<WorldInput>): WorldInput`, `WeaponKind`, `VehicleKind`, `VehicleState`, `BulletState`, `EffectKind`, `EffectState`, `AmmoState`, `ArenaPlayerState`, `HeldButtons`, `ArenaState`; `WeaponSpec`, `WEAPONS`, `WEAPON_ORDER`, `SPAWN_AMMO`, `cooldownTicks(kind): number`, `ammoFor(ammo, kind): number | null`, `hasAmmo(ammo, kind): boolean`, `consumeAmmo(ammo, kind): AmmoState`, `nextWeapon(current, ammo): WeaponKind`, `weaponLabel(kind): string`; `ButtonName`, `InputSource`, `ButtonState`, `InputState` gains `setButton(source, name, pressed)`, `setAim(angle | null)`, `clearKeyboard()`; `stepPlayer` uses `input.aim` for the facing.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/sim/weapons.test.ts
import { describe, expect, it } from "vitest";
import {
  SPAWN_AMMO,
  WEAPONS,
  ammoFor,
  consumeAmmo,
  cooldownTicks,
  hasAmmo,
  nextWeapon,
  weaponLabel,
} from "./weapons";

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

  it("tracks ammo only for the magazine weapons", () => {
    expect(ammoFor(SPAWN_AMMO, "pistol")).toBeNull();
    expect(ammoFor(SPAWN_AMMO, "uzi")).toBe(60);
    expect(consumeAmmo(SPAWN_AMMO, "uzi")).toEqual({ uzi: 59, shotgun: 8 });
    expect(consumeAmmo(SPAWN_AMMO, "pistol")).toBe(SPAWN_AMMO);
    expect(hasAmmo({ uzi: 0, shotgun: 0 }, "uzi")).toBe(false);
    expect(hasAmmo({ uzi: 0, shotgun: 0 }, "fist")).toBe(true);
  });

  it("cycles to the next weapon that has ammo and wraps around", () => {
    expect(nextWeapon("pistol", SPAWN_AMMO)).toBe("uzi");
    expect(nextWeapon("pistol", { uzi: 0, shotgun: 8 })).toBe("shotgun");
    expect(nextWeapon("shotgun", SPAWN_AMMO)).toBe("fist");
    expect(nextWeapon("pistol", { uzi: 0, shotgun: 0 })).toBe("fist");
  });
});
```

```ts
// src/lib/cityArena/input/inputState.test.ts  (replaces the Plan 2 file)
import { describe, expect, it } from "vitest";
import { clampToUnit, createInputState } from "./inputState";

describe("input state", () => {
  it("clamps vectors to unit length", () => {
    expect(clampToUnit([3, 4])).toEqual([0.6, 0.8]);
    expect(clampToUnit([0.3, 0])).toEqual([0.3, 0]);
  });

  it("prefers the stick while it is active, otherwise the keyboard", () => {
    const state = createInputState();
    state.setKeyboard([1, 1]);
    expect(state.snapshot().move[0]).toBeCloseTo(Math.SQRT1_2);
    state.setStick([0, -0.5]);
    expect(state.snapshot().move).toEqual([0, -0.5]);
    state.setStick(null);
    expect(state.snapshot().move[1]).toBeCloseTo(Math.SQRT1_2);
  });

  it("ORs buttons from the keyboard and pointer sources and carries the aim", () => {
    const state = createInputState();
    expect(state.snapshot()).toEqual({
      move: [0, 0],
      aim: null,
      fire: false,
      enter: false,
      weaponNext: false,
    });
    state.setButton("keyboard", "fire", true);
    state.setButton("pointer", "fire", false);
    state.setAim(1.5);
    expect(state.snapshot()).toMatchObject({ fire: true, aim: 1.5 });
    state.setButton("keyboard", "fire", false);
    state.setButton("pointer", "enter", true);
    expect(state.snapshot()).toMatchObject({ fire: false, enter: true });
  });

  it("clears keyboard movement and buttons together on blur", () => {
    const state = createInputState();
    state.setKeyboard([1, 0]);
    state.setButton("keyboard", "weaponNext", true);
    state.setButton("pointer", "fire", true);
    state.clearKeyboard();
    expect(state.snapshot()).toMatchObject({
      move: [0, 0],
      weaponNext: false,
      fire: true,
    });
  });
});
```

```ts
// src/lib/cityArena/sim/player.test.ts  (replaces the Plan 2 file)
import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import { PLAYER_RADIUS_M, WALK_SPEED_MPS, stepPlayer } from "./player";
import { createInput, type PlayerState } from "./types";

const free = { resolveCircle: (centre: Point): Point => centre };
const start: PlayerState = { x: 0, y: 0, facing: 0, speed: 0 };

describe("stepPlayer", () => {
  it("walks at 4 m/s scaled by the input magnitude and faces the movement direction", () => {
    const moved = stepPlayer(start, createInput({ move: [1, 0] }), 1, free);
    expect(moved.x).toBeCloseTo(WALK_SPEED_MPS);
    expect(moved.speed).toBeCloseTo(4);
    const halfSpeed = stepPlayer(
      start,
      createInput({ move: [0, 0.5] }),
      1,
      free,
    );
    expect(halfSpeed.y).toBeCloseTo(2);
    expect(halfSpeed.facing).toBeCloseTo(Math.PI / 2);
  });

  it("keeps the last facing when standing still and ignores dead-zone noise", () => {
    const facingRight = stepPlayer(
      start,
      createInput({ move: [1, 0] }),
      0.1,
      free,
    );
    const still = stepPlayer(
      facingRight,
      createInput({ move: [0.01, 0.01] }),
      1,
      free,
    );
    expect(still.x).toBeCloseTo(facingRight.x);
    expect(still.facing).toBe(facingRight.facing);
    expect(still.speed).toBe(0);
  });

  it("faces the aim angle instead of the movement when an aim is given", () => {
    const aimed = stepPlayer(
      start,
      createInput({ move: [1, 0], aim: Math.PI }),
      1,
      free,
    );
    expect(aimed.x).toBeCloseTo(4);
    expect(aimed.facing).toBeCloseTo(Math.PI);
    const still = stepPlayer(start, createInput({ aim: -1 }), 1, free);
    expect(still.facing).toBe(-1);
    expect(still.speed).toBe(0);
  });

  it("resolves collisions with the grid using the player radius", () => {
    const wall = {
      resolveCircle: (centre: Point, radius: number): Point => [
        Math.min(centre[0], 10 - radius),
        centre[1],
      ],
    };
    const blocked = stepPlayer(
      { x: 9, y: 0, facing: 0, speed: 0 },
      createInput({ move: [1, 0] }),
      1,
      wall,
    );
    expect(blocked.x).toBeCloseTo(10 - PLAYER_RADIUS_M);
  });
});
```

Two existing test files only need their input literals adapted to the wider `WorldInput`:

- `src/lib/cityArena/sim/freeRoam.test.ts`: add `import { createInput } from "./types";` and replace `{ move: [0, -1] }` with `createInput({ move: [0, -1] })` and `{ move: [1, 0] }` with `createInput({ move: [1, 0] })` (two call sites).
- `src/lib/cityArena/input/keyboard.test.ts`: replace every `expect(state.snapshot()).toEqual({ move: V })` with `expect(state.snapshot().move).toEqual(V)` (five assertions: `[0, -1]`, `[0, -1]`, `[0, 0]`, `[0, -1]`, `[0, 0]`). Task 8 rewrites this file completely when the buttons are bound.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim src/lib/cityArena/input`
Expected: FAIL — `./weapons` not found; `createInput` is not exported from `./types`; `setButton is not a function`.

- [ ] **Step 3: Implement the types**

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

/** The player with everything the arena adds to walking. */
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
};

/** Buttons whose previous held state the simulation remembers for edge detection. */
export type HeldButtons = { enter: boolean; weaponNext: boolean };

/** Full arena simulation state: plain, JSON-serialisable data. */
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
};
```

- [ ] **Step 4: Implement weapons.ts**

```ts
// src/lib/cityArena/sim/weapons.ts
import type { AmmoState, WeaponKind } from "./types";

/** Ticks per second of the fixed step (mirrors `SIM_STEP_S`). */
const TICKS_PER_SECOND = 30;
/** Degrees to radians. */
const DEGREES_TO_RADIANS = Math.PI / 180;

/** Static weapon parameters; `spreadRad` is the half-angle, `magazine: null` is unlimited. */
export type WeaponSpec = {
  label: string;
  damage: number;
  shotsPerSecond: number;
  rangeM: number;
  speedMps: number;
  spreadRad: number;
  pellets: number;
  magazine: number | null;
};

/** Weapon table (spec §5) with Dutch labels; the fist is this plan's documented addition. */
export const WEAPONS: Record<WeaponKind, WeaponSpec> = {
  fist: {
    label: "Vuist",
    damage: 15,
    shotsPerSecond: 2,
    rangeM: 1.2,
    speedMps: 30,
    spreadRad: 0,
    pellets: 1,
    magazine: null,
  },
  pistol: {
    label: "Pistool",
    damage: 20,
    shotsPerSecond: 2.5,
    rangeM: 40,
    speedMps: 120,
    spreadRad: 0,
    pellets: 1,
    magazine: null,
  },
  uzi: {
    label: "Uzi",
    damage: 10,
    shotsPerSecond: 10,
    rangeM: 35,
    speedMps: 110,
    spreadRad: 4 * DEGREES_TO_RADIANS,
    pellets: 1,
    magazine: 60,
  },
  shotgun: {
    label: "Shotgun",
    damage: 12,
    shotsPerSecond: 1.2,
    rangeM: 15,
    speedMps: 90,
    spreadRad: 10 * DEGREES_TO_RADIANS,
    pellets: 5,
    magazine: 8,
  },
};

/** Cycling order of the Wapen button. */
export const WEAPON_ORDER: WeaponKind[] = ["fist", "pistol", "uzi", "shotgun"];

/** Ammo the player spawns with in this plan (scope decision 2). */
export const SPAWN_AMMO: AmmoState = { uzi: 60, shotgun: 8 };

/** Ticks between two shots: fist 15, pistol 12, Uzi 3, shotgun 25. */
export function cooldownTicks(kind: WeaponKind): number {
  return Math.round(TICKS_PER_SECOND / WEAPONS[kind].shotsPerSecond);
}

/** Rounds left for a weapon, or `null` when it is unlimited. */
export function ammoFor(ammo: AmmoState, kind: WeaponKind): number | null {
  if (kind === "uzi") return ammo.uzi;
  if (kind === "shotgun") return ammo.shotgun;
  return null;
}

/** True when the weapon can fire (unlimited, or rounds left). */
export function hasAmmo(ammo: AmmoState, kind: WeaponKind): boolean {
  const left = ammoFor(ammo, kind);
  return left === null || left > 0;
}

/** Ammo after one shot; unlimited weapons return the same object. */
export function consumeAmmo(ammo: AmmoState, kind: WeaponKind): AmmoState {
  if (kind === "uzi") return { ...ammo, uzi: Math.max(0, ammo.uzi - 1) };
  if (kind === "shotgun")
    return { ...ammo, shotgun: Math.max(0, ammo.shotgun - 1) };
  return ammo;
}

/** The next weapon in {@link WEAPON_ORDER} that still has ammo, wrapping around. */
export function nextWeapon(current: WeaponKind, ammo: AmmoState): WeaponKind {
  const start = WEAPON_ORDER.indexOf(current);
  for (let offset = 1; offset <= WEAPON_ORDER.length; offset++) {
    const candidate = WEAPON_ORDER[(start + offset) % WEAPON_ORDER.length];
    if (hasAmmo(ammo, candidate)) return candidate;
  }
  return current;
}

/** Dutch HUD label of a weapon. */
export function weaponLabel(kind: WeaponKind): string {
  return WEAPONS[kind].label;
}
```

- [ ] **Step 5: Let the walking step honour the aim, and extend the input state**

```ts
// src/lib/cityArena/sim/player.ts  (only stepPlayer changes; constants stay)
/** Advances the player by `dt` seconds and resolves collisions; the aim angle, when given, wins over the movement direction for the facing. */
export function stepPlayer(
  player: PlayerState,
  input: WorldInput,
  dt: number,
  collision: Pick<CollisionGrid, "resolveCircle">,
): PlayerState {
  const magnitude = Math.min(1, Math.hypot(input.move[0], input.move[1]));
  if (magnitude < MOVE_DEAD_ZONE)
    return { ...player, facing: input.aim ?? player.facing, speed: 0 };
  const [resolvedX, resolvedY] = collision.resolveCircle(
    [
      player.x + input.move[0] * WALK_SPEED_MPS * dt,
      player.y + input.move[1] * WALK_SPEED_MPS * dt,
    ],
    PLAYER_RADIUS_M,
  );
  return {
    x: resolvedX,
    y: resolvedY,
    facing: input.aim ?? Math.atan2(input.move[1], input.move[0]),
    speed: magnitude * WALK_SPEED_MPS,
  };
}
```

```ts
// src/lib/cityArena/input/inputState.ts
import { EMPTY_INPUT, type WorldInput } from "../sim/types";

/** Scales a vector down to unit length when it is longer. */
export function clampToUnit(vector: [number, number]): [number, number] {
  const length = Math.hypot(vector[0], vector[1]);
  if (length <= 1) return [vector[0], vector[1]];
  return [vector[0] / length, vector[1] / length];
}

/** Buttons a device can hold down. */
export type ButtonName = "fire" | "enter" | "weaponNext";

/** Where a button press comes from; both sources are OR-ed together. */
export type InputSource = "keyboard" | "pointer";

/** Held state of the three buttons. */
export type ButtonState = Record<ButtonName, boolean>;

/**
 * Merges keyboard movement, the floating stick, held buttons and the aim into one
 * {@link WorldInput}; the stick wins over keyboard movement while a finger is down.
 */
export type InputState = {
  setKeyboard(vector: [number, number]): void;
  setStick(vector: [number, number] | null): void;
  setButton(source: InputSource, name: ButtonName, pressed: boolean): void;
  setAim(angle: number | null): void;
  clearKeyboard(): void;
  snapshot(): WorldInput;
};

const RELEASED: ButtonState = { fire: false, enter: false, weaponNext: false };

/** Creates an empty input state. */
export function createInputState(): InputState {
  let keyboard: [number, number] = [0, 0];
  let stick: [number, number] | null = null;
  let aim: number | null = null;
  const buttons: Record<InputSource, ButtonState> = {
    keyboard: { ...RELEASED },
    pointer: { ...RELEASED },
  };
  const held = (name: ButtonName): boolean =>
    buttons.keyboard[name] || buttons.pointer[name];
  return {
    setKeyboard(vector) {
      keyboard = vector;
    },
    setStick(vector) {
      stick = vector;
    },
    setButton(source, name, pressed) {
      buttons[source] = { ...buttons[source], [name]: pressed };
    },
    setAim(angle) {
      aim = angle;
    },
    clearKeyboard() {
      keyboard = [0, 0];
      buttons.keyboard = { ...RELEASED };
    },
    snapshot: () => ({
      ...EMPTY_INPUT,
      move: clampToUnit(stick ?? keyboard),
      aim,
      fire: held("fire"),
      enter: held("enter"),
      weaponNext: held("weaponNext"),
    }),
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/sim src/lib/cityArena/input`
Expected: PASS — weapons 4, inputState 4, player 4, freeRoam 2, keyboard 2, touchStick 3, rng 2. `cooldownTicks("shotgun")` = `Math.round(30 / 1.2)` = 25; the Uzi half-angle 4° = 0.0698 rad.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/cityArena/sim src/lib/cityArena/input
git add src/lib/cityArena/sim src/lib/cityArena/input
git commit -m "feat(arena): extend the input model with aim and buttons, add weapons

Adds the arena state types (player vitals, vehicles, bullets, effects),
the spec §5 weapon table with Dutch labels and cooldown ticks, and lets
the input state carry an aim angle and OR-ed buttons from keyboard and
pointer sources.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Cars — specs, body geometry, arcade physics and building collision

**Files:**

- Create: `src/lib/cityArena/sim/vehicle.ts`
- Test: `src/lib/cityArena/sim/vehicle.test.ts`

**Interfaces:**

- Consumes: `VehicleKind`, `VehicleState` (Task 1); `Point` (`../world/projection`); `CollisionGrid` (`../world/collisionGrid`, `resolveCircle` only).
- Produces: `VehicleSpec = { label: string; accelMps2: number; maxSpeedMps: number }`, `VEHICLE_SPECS`, `VEHICLE_LENGTH_M = 4.2`, `VEHICLE_WIDTH_M = 1.8`, `BRAKE_MPS2 = 14`, `REVERSE_MAX_MPS = 8`, `STEER_RATE_RAD_S = 2.6`, `STEER_FULL_SPEED_MPS = 6`, `STEER_HIGH_SPEED_FACTOR = 0.5`, `LATERAL_KEEP_PER_S = 0.1`, `ROLLING_DECEL_MPS2 = 3`, `HULL_CIRCLE_OFFSET_M = 1.1`, `HULL_CIRCLE_RADIUS_M = 0.95`, `RESTITUTION = 0.3`, `VEHICLE_MAX_HEALTH = 100`, `SMOKE_HEALTH = 40`, `VEHICLE_COLOUR_COUNT = 6`, `VehicleControls = { throttle: number; steer: number }`, `NO_CONTROLS`, `createVehicle(id, kind, position: Point, heading, colour): VehicleState`, `forwardSpeed(vehicle): number`, `localToWorld(vehicle, local: Point): Point`, `worldToLocal(vehicle, point: Point): Point`, `vehicleCorners(vehicle): Point[]`, `distanceToVehicle(vehicle, point): number`, `hullCircles(vehicle): Point[]`, `VehicleStepResult = { vehicle: VehicleState; impactSpeed: number }`, `stepVehicle(vehicle, controls, dt, collision): VehicleStepResult`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/sim/vehicle.test.ts
import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import type { VehicleState } from "./types";
import {
  NO_CONTROLS,
  createVehicle,
  distanceToVehicle,
  forwardSpeed,
  hullCircles,
  localToWorld,
  stepVehicle,
  vehicleCorners,
  type VehicleControls,
} from "./vehicle";

const free = { resolveCircle: (centre: Point): Point => centre };
const step = 1 / 30;

function drive(
  vehicle: VehicleState,
  controls: VehicleControls,
  ticks: number,
): VehicleState {
  let current = vehicle;
  for (let index = 0; index < ticks; index++)
    current = stepVehicle(current, controls, step, free).vehicle;
  return current;
}

describe("vehicle geometry", () => {
  it("creates a parked car and reads its forward speed", () => {
    const car = createVehicle(1, "compact", [10, 20], 0, 2);
    expect(car).toMatchObject({
      id: 1,
      kind: "compact",
      x: 10,
      y: 20,
      heading: 0,
      velocityX: 0,
      velocityY: 0,
      health: 100,
      wrecked: false,
      colour: 2,
    });
    expect(forwardSpeed({ ...car, velocityX: 3, velocityY: 4 })).toBe(3);
    expect(
      forwardSpeed({
        ...car,
        heading: Math.PI / 2,
        velocityX: 3,
        velocityY: 4,
      }),
    ).toBeCloseTo(4);
  });

  it("rotates local points, corners and hull circles with the heading", () => {
    const car = createVehicle(1, "sedan", [0, 0], Math.PI / 2, 0);
    const [frontLeftX, frontLeftY] = vehicleCorners(car)[0];
    expect(frontLeftX).toBeCloseTo(0.9);
    expect(frontLeftY).toBeCloseTo(2.1);
    expect(localToWorld(car, [1, 0])[1]).toBeCloseTo(1);
    const [front] = hullCircles(car);
    expect(front[0]).toBeCloseTo(0);
    expect(front[1]).toBeCloseTo(1.1);
  });

  it("measures the distance to the body, zero inside", () => {
    const car = createVehicle(1, "sedan", [0, 0], 0, 0);
    expect(distanceToVehicle(car, [5, 0])).toBeCloseTo(2.9);
    expect(distanceToVehicle(car, [0, 0])).toBe(0);
    expect(distanceToVehicle(car, [3, 3])).toBeCloseTo(2.2847, 3);
  });
});

describe("stepVehicle", () => {
  it("accelerates along the heading and caps at the top speed", () => {
    const car = createVehicle(1, "compact", [0, 0], 0, 0);
    const afterSecond = drive(car, { throttle: 1, steer: 0 }, 30);
    expect(afterSecond.velocityX).toBeCloseTo(6);
    expect(afterSecond.x).toBeCloseTo(3.1);
    expect(
      forwardSpeed(drive(car, { throttle: 1, steer: 0 }, 300)),
    ).toBeCloseTo(22);
  });

  it("brakes at 14 m/s², reverses up to 8 m/s and rolls out without throttle", () => {
    const rolling = {
      ...createVehicle(1, "compact", [0, 0], 0, 0),
      velocityX: 10,
    };
    expect(
      forwardSpeed(
        stepVehicle(rolling, { throttle: -1, steer: 0 }, step, free).vehicle,
      ),
    ).toBeCloseTo(9.5333, 3);
    expect(
      forwardSpeed(
        drive(
          createVehicle(1, "compact", [0, 0], 0, 0),
          { throttle: -1, steer: 0 },
          60,
        ),
      ),
    ).toBeCloseTo(-8);
    expect(
      forwardSpeed(stepVehicle(rolling, NO_CONTROLS, step, free).vehicle),
    ).toBeCloseTo(9.9);
  });

  it("turns faster with speed up to 6 m/s and slower again near the top speed", () => {
    const moving = {
      ...createVehicle(1, "compact", [0, 0], 0, 0),
      velocityX: 6,
    };
    const turned = stepVehicle(
      moving,
      { throttle: 1, steer: 1 },
      step,
      free,
    ).vehicle;
    expect(turned.heading).toBeCloseTo(0.07445, 4);
    const crawling = { ...moving, velocityX: 0 };
    expect(
      stepVehicle(crawling, { throttle: 0, steer: 1 }, step, free).vehicle
        .heading,
    ).toBe(0);
  });

  it("bleeds lateral velocity at 90 % per second", () => {
    const sliding = {
      ...createVehicle(1, "sport", [0, 0], 0, 0),
      velocityY: 4,
    };
    const settled = drive(sliding, NO_CONTROLS, 30);
    expect(settled.velocityY).toBeCloseTo(0.4, 2);
    expect(settled.velocityX).toBeCloseTo(0);
  });

  it("pushes out of a wall along the front hull circle, bounces with restitution 0.3 and reports the impact speed", () => {
    const wall = {
      resolveCircle: (centre: Point, radius: number): Point => [
        Math.min(centre[0], 10 - radius),
        centre[1],
      ],
    };
    const fast = { ...createVehicle(1, "sport", [8, 0], 0, 0), velocityX: 30 };
    const result = stepVehicle(fast, NO_CONTROLS, step, wall);
    expect(result.impactSpeed).toBeCloseTo(29.9);
    expect(result.vehicle.x).toBeCloseTo(7.95);
    expect(result.vehicle.velocityX).toBeCloseTo(-8.97);
  });

  it("ignores the controls of a wreck", () => {
    const wreck = { ...createVehicle(1, "sedan", [0, 0], 0, 0), wrecked: true };
    const still = drive(wreck, { throttle: 1, steer: 1 }, 30);
    expect(still.x).toBe(0);
    expect(still.heading).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim/vehicle.test.ts`
Expected: FAIL — module `./vehicle` not found.

- [ ] **Step 3: Implement vehicle.ts**

```ts
// src/lib/cityArena/sim/vehicle.ts
import type { CollisionGrid } from "../world/collisionGrid";
import type { Point } from "../world/projection";
import type { VehicleKind, VehicleState } from "./types";

/** Static car parameters (spec §5). */
export type VehicleSpec = {
  label: string;
  accelMps2: number;
  maxSpeedMps: number;
};

/** Car table with Dutch labels. */
export const VEHICLE_SPECS: Record<VehicleKind, VehicleSpec> = {
  compact: { label: "Compact", accelMps2: 6, maxSpeedMps: 22 },
  sedan: { label: "Sedan", accelMps2: 8, maxSpeedMps: 28 },
  sport: { label: "Sportwagen", accelMps2: 11, maxSpeedMps: 36 },
  police: { label: "Politieauto", accelMps2: 9, maxSpeedMps: 30 },
};

/** Body length in metres. */
export const VEHICLE_LENGTH_M = 4.2;
/** Body width in metres. */
export const VEHICLE_WIDTH_M = 1.8;
/** Braking deceleration (spec §5). */
export const BRAKE_MPS2 = 14;
/** Top speed in reverse (spec §5). */
export const REVERSE_MAX_MPS = 8;
/** Full-lock turn rate at grip speed (spec §5). */
export const STEER_RATE_RAD_S = 2.6;
/** Speed at which the steering reaches full authority (spec §5: clamp(v/6)). */
export const STEER_FULL_SPEED_MPS = 6;
/** Steering loss at top speed (spec §5: 1 − 0.5·v/vmax). */
export const STEER_HIGH_SPEED_FACTOR = 0.5;
/** Fraction of the lateral velocity that survives one second (spec §5: decays 90 %/s). */
export const LATERAL_KEEP_PER_S = 0.1;
/** Deceleration when neither throttle nor brake is applied (documented choice). */
export const ROLLING_DECEL_MPS2 = 3;
/** Distance of the two hull circles from the centre along the body axis. */
export const HULL_CIRCLE_OFFSET_M = 1.1;
/** Radius of each hull circle used against buildings and water. */
export const HULL_CIRCLE_RADIUS_M = 0.95;
/** Bounce factor of collisions (spec §5). */
export const RESTITUTION = 0.3;
/** Car health at spawn (spec §5). */
export const VEHICLE_MAX_HEALTH = 100;
/** Below this health the car smokes (spec §5). */
export const SMOKE_HEALTH = 40;
/** Number of body colours the render palette offers; `colour` stays below it. */
export const VEHICLE_COLOUR_COUNT = 6;

/** Driver controls in −1..1: throttle (negative brakes/reverses) and steer (positive right). */
export type VehicleControls = { throttle: number; steer: number };

/** Controls of a car nobody is driving. */
export const NO_CONTROLS: VehicleControls = { throttle: 0, steer: 0 };

/** Outcome of one car step; `impactSpeed` is the approach speed lost against an obstacle (0 when none). */
export type VehicleStepResult = { vehicle: VehicleState; impactSpeed: number };

/** Pushes shorter than this are treated as no contact. */
const PUSH_EPSILON_M = 1e-6;

/** A parked, undamaged car. */
export function createVehicle(
  id: number,
  kind: VehicleKind,
  position: Point,
  heading: number,
  colour: number,
): VehicleState {
  return {
    id,
    kind,
    x: position[0],
    y: position[1],
    heading,
    velocityX: 0,
    velocityY: 0,
    health: VEHICLE_MAX_HEALTH,
    wrecked: false,
    colour,
  };
}

/** Velocity component along the heading (negative when reversing). */
export function forwardSpeed(vehicle: VehicleState): number {
  return (
    vehicle.velocityX * Math.cos(vehicle.heading) +
    vehicle.velocityY * Math.sin(vehicle.heading)
  );
}

/** Velocity component to the driver's right. */
function lateralSpeed(vehicle: VehicleState): number {
  return (
    -vehicle.velocityX * Math.sin(vehicle.heading) +
    vehicle.velocityY * Math.cos(vehicle.heading)
  );
}

/** Car-local `[forward, right]` metres to world metres. */
export function localToWorld(vehicle: VehicleState, local: Point): Point {
  const cos = Math.cos(vehicle.heading);
  const sin = Math.sin(vehicle.heading);
  return [
    vehicle.x + local[0] * cos - local[1] * sin,
    vehicle.y + local[0] * sin + local[1] * cos,
  ];
}

/** World metres to car-local `[forward, right]` metres. */
export function worldToLocal(vehicle: VehicleState, point: Point): Point {
  const cos = Math.cos(vehicle.heading);
  const sin = Math.sin(vehicle.heading);
  const dx = point[0] - vehicle.x;
  const dy = point[1] - vehicle.y;
  return [dx * cos + dy * sin, -dx * sin + dy * cos];
}

/** The four body corners: front-left, front-right, rear-right, rear-left. */
export function vehicleCorners(vehicle: VehicleState): Point[] {
  const halfLength = VEHICLE_LENGTH_M / 2;
  const halfWidth = VEHICLE_WIDTH_M / 2;
  const locals: Point[] = [
    [halfLength, -halfWidth],
    [halfLength, halfWidth],
    [-halfLength, halfWidth],
    [-halfLength, -halfWidth],
  ];
  return locals.map((local) => localToWorld(vehicle, local));
}

/** Distance from a point to the car body (0 inside). */
export function distanceToVehicle(vehicle: VehicleState, point: Point): number {
  const [forward, right] = worldToLocal(vehicle, point);
  const outsideForward = Math.max(0, Math.abs(forward) - VEHICLE_LENGTH_M / 2);
  const outsideRight = Math.max(0, Math.abs(right) - VEHICLE_WIDTH_M / 2);
  return Math.hypot(outsideForward, outsideRight);
}

/** Centres of the two collision circles along the body axis, front first. */
export function hullCircles(vehicle: VehicleState): Point[] {
  return [
    localToWorld(vehicle, [HULL_CIRCLE_OFFSET_M, 0]),
    localToWorld(vehicle, [-HULL_CIRCLE_OFFSET_M, 0]),
  ];
}

/** Clamps a control value to −1..1. */
function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** Forward speed after one tick of throttle, braking, reversing or rolling deceleration. */
function driveForward(
  forward: number,
  throttle: number,
  spec: VehicleSpec,
  dt: number,
): number {
  if (throttle > 0 && forward >= 0)
    return Math.min(spec.maxSpeedMps, forward + spec.accelMps2 * throttle * dt);
  if (throttle > 0) return Math.min(0, forward + BRAKE_MPS2 * dt);
  if (throttle < 0 && forward > 0)
    return Math.max(0, forward - BRAKE_MPS2 * dt);
  if (throttle < 0)
    return Math.max(-REVERSE_MAX_MPS, forward + spec.accelMps2 * throttle * dt);
  const rollOff = ROLLING_DECEL_MPS2 * dt;
  if (Math.abs(forward) <= rollOff) return 0;
  return forward - Math.sign(forward) * rollOff;
}

/** Turn rate in rad/s: steer × 2.6 × clamp(v/6, 0, 1) × (1 − 0.5·v/vmax), mirrored in reverse. */
function turnRate(forward: number, steer: number, spec: VehicleSpec): number {
  const speed = Math.abs(forward);
  const grip = Math.min(1, speed / STEER_FULL_SPEED_MPS);
  const highSpeedLoss =
    1 - STEER_HIGH_SPEED_FACTOR * (speed / spec.maxSpeedMps);
  const direction = forward < 0 ? -1 : 1;
  return steer * STEER_RATE_RAD_S * grip * highSpeedLoss * direction;
}

/** Applies the controls to velocity and heading; wrecks ignore their controls. */
function applyDrive(
  vehicle: VehicleState,
  controls: VehicleControls,
  dt: number,
): VehicleState {
  const spec = VEHICLE_SPECS[vehicle.kind];
  const throttle = vehicle.wrecked ? 0 : clampUnit(controls.throttle);
  const steer = vehicle.wrecked ? 0 : clampUnit(controls.steer);
  const forward = driveForward(forwardSpeed(vehicle), throttle, spec, dt);
  const lateral = lateralSpeed(vehicle) * Math.pow(LATERAL_KEEP_PER_S, dt);
  const heading = vehicle.heading + turnRate(forward, steer, spec) * dt;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  return {
    ...vehicle,
    heading,
    velocityX: forward * cos - lateral * sin,
    velocityY: forward * sin + lateral * cos,
  };
}

/** The largest push-out among the hull circles, or `null` when nothing overlaps. */
function hullPushOut(
  vehicle: VehicleState,
  collision: Pick<CollisionGrid, "resolveCircle">,
): Point | null {
  let best: Point = [0, 0];
  let bestLength = 0;
  for (const centre of hullCircles(vehicle)) {
    const resolved = collision.resolveCircle(centre, HULL_CIRCLE_RADIUS_M);
    const push: Point = [resolved[0] - centre[0], resolved[1] - centre[1]];
    const length = Math.hypot(push[0], push[1]);
    if (length > bestLength) {
      best = push;
      bestLength = length;
    }
  }
  return bestLength > PUSH_EPSILON_M ? best : null;
}

/** Moves the car by its velocity, pushes it out of obstacles and reflects the approach velocity with restitution. */
function moveAndCollide(
  vehicle: VehicleState,
  dt: number,
  collision: Pick<CollisionGrid, "resolveCircle">,
): VehicleStepResult {
  const moved: VehicleState = {
    ...vehicle,
    x: vehicle.x + vehicle.velocityX * dt,
    y: vehicle.y + vehicle.velocityY * dt,
  };
  const push = hullPushOut(moved, collision);
  if (!push) return { vehicle: moved, impactSpeed: 0 };
  const length = Math.hypot(push[0], push[1]);
  const normalX = push[0] / length;
  const normalY = push[1] / length;
  const impactSpeed = Math.max(
    0,
    -(moved.velocityX * normalX + moved.velocityY * normalY),
  );
  const bounce = (1 + RESTITUTION) * impactSpeed;
  return {
    vehicle: {
      ...moved,
      x: moved.x + push[0],
      y: moved.y + push[1],
      velocityX: moved.velocityX + normalX * bounce,
      velocityY: moved.velocityY + normalY * bounce,
    },
    impactSpeed,
  };
}

/** Advances one car by `dt` seconds under `controls`, resolving buildings and water. */
export function stepVehicle(
  vehicle: VehicleState,
  controls: VehicleControls,
  dt: number,
  collision: Pick<CollisionGrid, "resolveCircle">,
): VehicleStepResult {
  return moveAndCollide(applyDrive(vehicle, controls, dt), dt, collision);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/sim/vehicle.test.ts`
Expected: PASS (3 + 6 tests). Worked numbers: one second of full throttle in a compact = 30 semi-implicit steps → v = 6 m/s, x = 6/900 × (1 + 2 + … + 30) = 3.1 m; the turn test starts at 6 m/s, throttle raises it to 6.2 → 2.6 × 1 × (1 − 0.5 × 6.2/22) / 30 = 0.07445 rad; the wall test rolls 30 → 29.9 m/s first, the front circle at 10.097 m is pushed to 9.05 m so the car ends at 7.95 m and bounces to −8.97 m/s (= 29.9 − 1.3 × 29.9).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/cityArena/sim/vehicle.ts src/lib/cityArena/sim/vehicle.test.ts
git add src/lib/cityArena/sim/vehicle.ts src/lib/cityArena/sim/vehicle.test.ts
git commit -m "feat(arena): add car specs, body geometry and arcade driving physics

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Raycast helper and bullets

**Files:**

- Create: `src/lib/cityArena/world/raycast.ts`
- Create: `src/lib/cityArena/sim/bullets.ts`
- Test: `src/lib/cityArena/world/raycast.test.ts`, `src/lib/cityArena/sim/bullets.test.ts`

**Interfaces:**

- Consumes: `CollisionGrid` (`query`), `Obstacle` (`../world/collisionGrid`); `boundsOf` (`../mapBuild/geometry`); `Point`; `PLAYER_RADIUS_M` (`./player`); `BulletState`, `VehicleState`, `WeaponKind` (Task 1); `WeaponSpec` (Task 1); `worldToLocal`, `VEHICLE_LENGTH_M`, `VEHICLE_WIDTH_M` (Task 2).
- Produces: `segmentIntersection(a, b, c, d): Point | null`, `firstRingHit(from, to, ring): Point | null`, `firstBuildingHit(collision, from, to): Point | null`; `MAX_BULLETS = 64`, `ShotSource = { ownerId: number; ignoreVehicleId: number | null; firstId: number }`, `createShots(spec, weapon, origin, angle, source, random): BulletState[]`, `segmentHitsCircle(from, to, centre, radius): number | null`, `segmentHitsVehicle(from, to, vehicle): number | null`, `PlayerTarget = { id; x; y }`, `BulletTarget`, `BulletHit = { bullet; point; target }`, `BulletWorld = { collision; vehicles; players }`, `stepBullets(bullets, dt, world): { bullets: BulletState[]; hits: BulletHit[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/world/raycast.test.ts
import { describe, expect, it } from "vitest";
import { boundsOf } from "../mapBuild/geometry";
import { createCollisionGrid } from "./collisionGrid";
import type { DecodedTile } from "./decode";
import type { Point } from "./projection";
import { firstBuildingHit, firstRingHit, segmentIntersection } from "./raycast";

const square: Point[] = [
  [10, -5],
  [20, -5],
  [20, 5],
  [10, 5],
];
const pond: Point[] = [
  [0, 95],
  [30, 95],
  [30, 105],
];

function tileWith(buildings: Point[][], water: Point[][] = []): DecodedTile {
  return {
    x: 0,
    y: 0,
    rect: { minX: -100, minY: -100, maxX: 1900, maxY: 1900 },
    roads: [],
    buildings: buildings.map((ring) => ({
      ring,
      bounds: boundsOf(ring),
      levels: 2,
    })),
    ground: [],
    water: water.map((ring) => ({ ring, bounds: boundsOf(ring) })),
  };
}

describe("raycast", () => {
  it("intersects crossing segments and rejects parallel or disjoint ones", () => {
    expect(segmentIntersection([0, 0], [10, 0], [5, -5], [5, 5])).toEqual([
      5, 0,
    ]);
    expect(segmentIntersection([0, 0], [10, 0], [0, 1], [10, 1])).toBeNull();
    expect(segmentIntersection([0, 0], [10, 0], [15, -5], [15, 5])).toBeNull();
  });

  it("returns the ring crossing nearest to the start", () => {
    expect(firstRingHit([0, 0], [30, 0], square)).toEqual([10, 0]);
    expect(firstRingHit([30, 0], [0, 0], square)).toEqual([20, 0]);
    expect(firstRingHit([0, 10], [30, 10], square)).toBeNull();
  });

  it("finds the first building through the collision grid and lets bullets cross water", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([square], [pond]));
    expect(firstBuildingHit(grid, [0, 0], [30, 0])).toEqual([10, 0]);
    expect(firstBuildingHit(grid, [0, 100], [30, 100])).toBeNull();
  });
});
```

```ts
// src/lib/cityArena/sim/bullets.test.ts
import { describe, expect, it } from "vitest";
import { boundsOf } from "../mapBuild/geometry";
import { createCollisionGrid } from "../world/collisionGrid";
import type { DecodedTile } from "../world/decode";
import type { Point } from "../world/projection";
import {
  createShots,
  segmentHitsCircle,
  segmentHitsVehicle,
  stepBullets,
  type BulletHit,
  type BulletWorld,
  type ShotSource,
} from "./bullets";
import type { BulletState } from "./types";
import { createVehicle } from "./vehicle";
import { WEAPONS } from "./weapons";

const square: Point[] = [
  [10, -5],
  [20, -5],
  [20, 5],
  [10, 5],
];
const source: ShotSource = { ownerId: 0, ignoreVehicleId: null, firstId: 100 };
const step = 1 / 30;

function tileWith(buildings: Point[][]): DecodedTile {
  return {
    x: 0,
    y: 0,
    rect: { minX: -100, minY: -100, maxX: 1900, maxY: 1900 },
    roads: [],
    buildings: buildings.map((ring) => ({
      ring,
      bounds: boundsOf(ring),
      levels: 2,
    })),
    ground: [],
    water: [],
  };
}

function worldWith(partial: Partial<BulletWorld>): BulletWorld {
  return {
    collision: createCollisionGrid(),
    vehicles: [],
    players: [],
    ...partial,
  };
}

function pistolAt(x: number, y: number): BulletState[] {
  return createShots(WEAPONS.pistol, "pistol", [x, y], 0, source, () => 0.5);
}

describe("createShots", () => {
  it("fires one pistol bullet along the aim with the spec numbers", () => {
    const [bullet] = createShots(
      WEAPONS.pistol,
      "pistol",
      [1, 2],
      0,
      source,
      () => 0.5,
    );
    expect(bullet).toMatchObject({
      id: 100,
      ownerId: 0,
      ignoreVehicleId: null,
      x: 1,
      y: 2,
      directionX: 1,
      directionY: 0,
      speedMps: 120,
      rangeLeftM: 40,
      damage: 20,
      weapon: "pistol",
    });
  });

  it("spreads the Uzi by the seeded jitter and the shotgun into five pellets", () => {
    const [centre] = createShots(
      WEAPONS.uzi,
      "uzi",
      [0, 0],
      0,
      source,
      () => 0.5,
    );
    expect(centre.directionY).toBeCloseTo(0);
    const [edge] = createShots(WEAPONS.uzi, "uzi", [0, 0], 0, source, () => 1);
    expect(edge.directionY).toBeCloseTo(0.0698, 3);
    const pellets = createShots(
      WEAPONS.shotgun,
      "shotgun",
      [0, 0],
      0,
      source,
      () => 0,
    );
    expect(pellets).toHaveLength(5);
    expect(pellets.map((pellet) => pellet.id)).toEqual([
      100, 101, 102, 103, 104,
    ]);
    expect(pellets[0].directionY).toBeCloseTo(-0.1736, 3);
  });
});

describe("segment hit tests", () => {
  it("finds the entry parameter into a circle", () => {
    expect(segmentHitsCircle([0, 0], [10, 0], [5, 1], 0.4)).toBeNull();
    expect(segmentHitsCircle([0, 0], [10, 0], [5, 0.3], 0.4)).toBeCloseTo(
      0.4735,
      3,
    );
    expect(segmentHitsCircle([5, 0], [10, 0], [5, 0], 0.4)).toBe(0);
  });

  it("finds the entry parameter into a car body in its own frame", () => {
    const car = createVehicle(1, "sedan", [10, 0], 0, 0);
    expect(segmentHitsVehicle([0, 0], [20, 0], car)).toBeCloseTo(0.395);
    expect(segmentHitsVehicle([0, 2], [20, 2], car)).toBeNull();
    const turned = createVehicle(2, "sedan", [10, 0], Math.PI / 2, 0);
    expect(segmentHitsVehicle([0, 0], [20, 0], turned)).toBeCloseTo(0.455);
  });
});

describe("stepBullets", () => {
  it("moves bullets 4 m per tick at 120 m/s and drops them at the end of their range", () => {
    const world = worldWith({});
    const first = stepBullets(pistolAt(0, 0), step, world);
    expect(first.bullets[0].x).toBeCloseTo(4);
    expect(first.bullets[0].rangeLeftM).toBeCloseTo(36);
    expect(first.hits).toEqual([]);
    let bullets = first.bullets;
    for (let tick = 0; tick < 9; tick++)
      bullets = stepBullets(bullets, step, world).bullets;
    expect(bullets).toEqual([]);
  });

  it("stops at the first building outline", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([square]));
    const world = worldWith({ collision: grid });
    let bullets = pistolAt(0, 0);
    let lastHits: BulletHit[] = [];
    for (let tick = 0; tick < 3; tick++) {
      const result = stepBullets(bullets, step, world);
      bullets = result.bullets;
      lastHits = result.hits;
    }
    expect(lastHits[0]).toMatchObject({
      point: [10, 0],
      target: { kind: "building" },
    });
    expect(bullets).toEqual([]);
  });

  it("hits players and cars in sweep order, ignores the shooter's own car and never the shooter", () => {
    const car = createVehicle(7, "sedan", [6, 0], 0, 0);
    const withPlayer = worldWith({
      vehicles: [car],
      players: [
        { id: 0, x: 0, y: 0 },
        { id: 1, x: 2, y: 0 },
      ],
    });
    const playerHit = stepBullets(pistolAt(0, 0), step, withPlayer);
    expect(playerHit.hits[0]).toMatchObject({
      target: { kind: "player", playerId: 1 },
    });
    expect(playerHit.hits[0].point[0]).toBeCloseTo(1.6);
    const withCar = worldWith({
      vehicles: [car],
      players: [{ id: 0, x: 0, y: 0 }],
    });
    const carHit = stepBullets(pistolAt(0, 0), step, withCar);
    expect(carHit.hits[0]).toMatchObject({
      target: { kind: "vehicle", vehicleId: 7 },
    });
    expect(carHit.hits[0].point[0]).toBeCloseTo(3.9);
    const ownCar = createVehicle(8, "sedan", [5, 0], 0, 0);
    const driveBy = createShots(
      WEAPONS.pistol,
      "pistol",
      [5, 0],
      0,
      { ...source, ignoreVehicleId: 8 },
      () => 0.5,
    );
    const passed = stepBullets(
      driveBy,
      step,
      worldWith({ vehicles: [ownCar] }),
    );
    expect(passed.hits).toEqual([]);
    expect(passed.bullets[0].x).toBeCloseTo(9);
  });

  it("keeps the fist reach to 1.2 m", () => {
    const punch = createShots(
      WEAPONS.fist,
      "fist",
      [0, 0],
      0,
      source,
      () => 0.5,
    );
    const first = stepBullets(punch, step, worldWith({}));
    expect(first.bullets[0].x).toBeCloseTo(1);
    expect(first.bullets[0].rangeLeftM).toBeCloseTo(0.2);
    expect(stepBullets(first.bullets, step, worldWith({})).bullets).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/world/raycast.test.ts src/lib/cityArena/sim/bullets.test.ts`
Expected: FAIL — modules `./raycast` and `./bullets` not found.

- [ ] **Step 3: Implement raycast.ts**

```ts
// src/lib/cityArena/world/raycast.ts
import { boundsOf } from "../mapBuild/geometry";
import type { CollisionGrid } from "./collisionGrid";
import type { Point } from "./projection";

/** Crossing point of segments a–b and c–d, or `null` when they do not cross (parallel counts as no crossing). */
export function segmentIntersection(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): Point | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * rx, a[1] + t * ry];
}

/** The crossing of from→to with a ring's edges that lies closest to `from`, or `null`. */
export function firstRingHit(
  from: Point,
  to: Point,
  ring: Point[],
): Point | null {
  let best: Point | null = null;
  let bestDistance = Infinity;
  for (let index = 0; index < ring.length; index++) {
    const hit = segmentIntersection(
      from,
      to,
      ring[index],
      ring[(index + 1) % ring.length],
    );
    if (!hit) continue;
    const distance = Math.hypot(hit[0] - from[0], hit[1] - from[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = hit;
    }
  }
  return best;
}

/** First building outline crossed by from→to (water never stops bullets), or `null`. */
export function firstBuildingHit(
  collision: Pick<CollisionGrid, "query">,
  from: Point,
  to: Point,
): Point | null {
  let best: Point | null = null;
  let bestDistance = Infinity;
  for (const obstacle of collision.query(boundsOf([from, to]))) {
    if (obstacle.kind !== "building") continue;
    const hit = firstRingHit(from, to, obstacle.ring);
    if (!hit) continue;
    const distance = Math.hypot(hit[0] - from[0], hit[1] - from[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = hit;
    }
  }
  return best;
}
```

- [ ] **Step 4: Implement bullets.ts**

```ts
// src/lib/cityArena/sim/bullets.ts
import type { CollisionGrid } from "../world/collisionGrid";
import type { Point } from "../world/projection";
import { firstBuildingHit } from "../world/raycast";
import { PLAYER_RADIUS_M } from "./player";
import type { BulletState, VehicleState, WeaponKind } from "./types";
import { VEHICLE_LENGTH_M, VEHICLE_WIDTH_M, worldToLocal } from "./vehicle";
import type { WeaponSpec } from "./weapons";

/** Hard cap on live bullets (checked by the invariants). */
export const MAX_BULLETS = 64;

/** Who fires: the owner (never hit by its own bullets), the car it sits in (ignored by its bullets) and the first free id. */
export type ShotSource = {
  ownerId: number;
  ignoreVehicleId: number | null;
  firstId: number;
};

/** A player as a bullet target. */
export type PlayerTarget = { id: number; x: number; y: number };

/** What a bullet can hit. */
export type BulletTarget =
  | { kind: "building" }
  | { kind: "vehicle"; vehicleId: number }
  | { kind: "player"; playerId: number };

/** One bullet impact this tick. */
export type BulletHit = {
  bullet: BulletState;
  point: Point;
  target: BulletTarget;
};

/** What the bullet step reads from the world. */
export type BulletWorld = {
  collision: Pick<CollisionGrid, "query">;
  vehicles: VehicleState[];
  players: PlayerTarget[];
};

/** Creates the pellets of one trigger pull, each jittered uniformly inside the weapon's cone. */
export function createShots(
  spec: WeaponSpec,
  weapon: WeaponKind,
  origin: Point,
  angle: number,
  source: ShotSource,
  random: () => number,
): BulletState[] {
  const shots: BulletState[] = [];
  for (let pellet = 0; pellet < spec.pellets; pellet++) {
    const jitter =
      spec.spreadRad === 0 ? 0 : (random() * 2 - 1) * spec.spreadRad;
    const direction = angle + jitter;
    shots.push({
      id: source.firstId + pellet,
      ownerId: source.ownerId,
      ignoreVehicleId: source.ignoreVehicleId,
      x: origin[0],
      y: origin[1],
      directionX: Math.cos(direction),
      directionY: Math.sin(direction),
      speedMps: spec.speedMps,
      rangeLeftM: spec.rangeM,
      damage: spec.damage,
      weapon,
    });
  }
  return shots;
}

/** Parameter t in [0, 1] along from→to where the segment first enters a circle (0 when it starts inside), or `null`. */
export function segmentHitsCircle(
  from: Point,
  to: Point,
  centre: Point,
  radius: number,
): number | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const fx = from[0] - centre[0];
  const fy = from[1] - centre[1];
  const c = fx * fx + fy * fy - radius * radius;
  if (c < 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** Parameter t in [0, 1] where from→to enters the car body (slab test in the car frame), or `null`. */
export function segmentHitsVehicle(
  from: Point,
  to: Point,
  vehicle: VehicleState,
): number | null {
  const start = worldToLocal(vehicle, from);
  const end = worldToLocal(vehicle, to);
  const halfExtents: Point = [VEHICLE_LENGTH_M / 2, VEHICLE_WIDTH_M / 2];
  const axes: (0 | 1)[] = [0, 1];
  let entry = 0;
  let exit = 1;
  for (const axis of axes) {
    const delta = end[axis] - start[axis];
    if (delta === 0) {
      if (Math.abs(start[axis]) > halfExtents[axis]) return null;
      continue;
    }
    const near = (-halfExtents[axis] - start[axis]) / delta;
    const far = (halfExtents[axis] - start[axis]) / delta;
    entry = Math.max(entry, Math.min(near, far));
    exit = Math.min(exit, Math.max(near, far));
    if (entry > exit) return null;
  }
  return entry;
}

/** A possible hit along the sweep. */
type Candidate = { t: number; target: BulletTarget };

/** Cars the sweep enters, except the shooter's own. */
function vehicleCandidates(
  bullet: BulletState,
  from: Point,
  to: Point,
  vehicles: VehicleState[],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const vehicle of vehicles) {
    if (vehicle.id === bullet.ignoreVehicleId) continue;
    const t = segmentHitsVehicle(from, to, vehicle);
    if (t !== null)
      candidates.push({
        t,
        target: { kind: "vehicle", vehicleId: vehicle.id },
      });
  }
  return candidates;
}

/** Players the sweep enters, except the shooter. */
function playerCandidates(
  bullet: BulletState,
  from: Point,
  to: Point,
  players: PlayerTarget[],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const player of players) {
    if (player.id === bullet.ownerId) continue;
    const t = segmentHitsCircle(
      from,
      to,
      [player.x, player.y],
      PLAYER_RADIUS_M,
    );
    if (t !== null)
      candidates.push({ t, target: { kind: "player", playerId: player.id } });
  }
  return candidates;
}

/** The candidate closest to the sweep start. */
function nearestCandidate(candidates: Candidate[]): Candidate | null {
  return candidates.reduce<Candidate | null>(
    (best, candidate) =>
      best === null || candidate.t < best.t ? candidate : best,
    null,
  );
}

/** The bullet's sweep this tick, clipped to its remaining range. */
function sweep(
  bullet: BulletState,
  dt: number,
): { to: Point; travelled: number } {
  const travelled = Math.min(bullet.speedMps * dt, bullet.rangeLeftM);
  return {
    to: [
      bullet.x + bullet.directionX * travelled,
      bullet.y + bullet.directionY * travelled,
    ],
    travelled,
  };
}

/** Resolves one bullet for this tick: the survivor (or `null`) and the hit (or `null`). */
function resolveBullet(
  bullet: BulletState,
  dt: number,
  world: BulletWorld,
): { bullet: BulletState | null; hit: BulletHit | null } {
  const from: Point = [bullet.x, bullet.y];
  const { to, travelled } = sweep(bullet, dt);
  const building = firstBuildingHit(world.collision, from, to);
  const buildingT =
    building && travelled > 0
      ? Math.hypot(building[0] - from[0], building[1] - from[1]) / travelled
      : null;
  const entity = nearestCandidate([
    ...vehicleCandidates(bullet, from, to, world.vehicles),
    ...playerCandidates(bullet, from, to, world.players),
  ]);
  if (entity && (buildingT === null || entity.t <= buildingT)) {
    const point: Point = [
      from[0] + (to[0] - from[0]) * entity.t,
      from[1] + (to[1] - from[1]) * entity.t,
    ];
    return { bullet: null, hit: { bullet, point, target: entity.target } };
  }
  if (building)
    return {
      bullet: null,
      hit: { bullet, point: building, target: { kind: "building" } },
    };
  const rangeLeftM = bullet.rangeLeftM - travelled;
  if (rangeLeftM <= 0) return { bullet: null, hit: null };
  return { bullet: { ...bullet, x: to[0], y: to[1], rangeLeftM }, hit: null };
}

/** Sweeps every bullet by `dt`; bullets that hit something or run out of range are dropped. */
export function stepBullets(
  bullets: BulletState[],
  dt: number,
  world: BulletWorld,
): { bullets: BulletState[]; hits: BulletHit[] } {
  const survivors: BulletState[] = [];
  const hits: BulletHit[] = [];
  for (const bullet of bullets) {
    const result = resolveBullet(bullet, dt, world);
    if (result.bullet) survivors.push(result.bullet);
    if (result.hit) hits.push(result.hit);
  }
  return { bullets: survivors, hits };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/world/raycast.test.ts src/lib/cityArena/sim/bullets.test.ts`
Expected: PASS (3 + 7 tests). Worked numbers: a sedan at x = 10 spans 7.9–12.1, so a sweep 0→20 enters at t = 0.395; turned 90° it spans 9.1–10.9 on x, entry t = 0.455; the circle test solves (x − 5)² + 0.09 = 0.16 → x = 4.7354; the shotgun pellet with `random() = 0` is jittered by −10°, sin(−10°) = −0.1736.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/world/raycast.ts src/lib/cityArena/world/raycast.test.ts src/lib/cityArena/sim/bullets.ts src/lib/cityArena/sim/bullets.test.ts
git add src/lib/cityArena/world/raycast.ts src/lib/cityArena/world/raycast.test.ts src/lib/cityArena/sim/bullets.ts src/lib/cityArena/sim/bullets.test.ts
git commit -m "feat(arena): sweep bullets against buildings, cars and players

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Car–car and car–player collisions, damage and effects

**Files:**

- Create: `src/lib/cityArena/sim/collisions.ts`
- Create: `src/lib/cityArena/sim/damage.ts`
- Create: `src/lib/cityArena/sim/effects.ts`
- Test: `src/lib/cityArena/sim/collisions.test.ts`, `src/lib/cityArena/sim/damage.test.ts`, `src/lib/cityArena/sim/effects.test.ts`

**Interfaces:**

- Consumes: `ArenaPlayerState`, `VehicleState`, `EffectKind`, `EffectState` (Task 1); `PLAYER_RADIUS_M` (`./player`); `RESTITUTION`, `createVehicle` (Task 2); `Point`.
- Produces: `CAR_BODY_RADIUS_M = 1.6`, `RUN_OVER_MIN_SPEED_MPS = 5`, `RUN_OVER_DAMAGE_PER_MPS = 5`, `RUN_OVER_CLEARANCE_M = 0.5`, `PairImpact = { first: number; second: number; impactSpeed: number }`, `resolveVehiclePairs(vehicles): { vehicles; impacts: PairImpact[] }`, `resolveVehicleAgainstPlayer(vehicle, player): { player; damage: number }`; `PLAYER_MAX_HEALTH = 100`, `RESPAWN_DELAY_TICKS = 90`, `INVULNERABLE_TICKS = 60`, `EXPLOSION_RADIUS_M = 3`, `EXPLOSION_DAMAGE = 80`, `LETHAL_DAMAGE = 1000`, `impactDamage(impactSpeed): number`, `isDead(player): boolean`, `isInvulnerable(player, tick): boolean`, `damagePlayer(player, amount, tick): ArenaPlayerState`, `damageVehicle(vehicle, amount): VehicleState`, `inBlastRadius(vehicle, point): boolean`; `EFFECT_TTL_TICKS`, `MAX_EFFECTS = 64`, `addEffect(effects, effect: Omit<EffectState, "ttlTicks">): EffectState[]`, `pruneEffects(effects, tick): EffectState[]`, `effectProgress(effect, tick): number`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/sim/collisions.test.ts
import { describe, expect, it } from "vitest";
import { resolveVehicleAgainstPlayer, resolveVehiclePairs } from "./collisions";
import type { ArenaPlayerState } from "./types";
import { createVehicle } from "./vehicle";

const walker: ArenaPlayerState = {
  id: 0,
  x: 1,
  y: 0,
  facing: 0,
  speed: 0,
  health: 100,
  weapon: "pistol",
  ammo: { uzi: 60, shotgun: 8 },
  vehicleId: null,
  boardingTicksLeft: 0,
  nextShotTick: 0,
  diedAtTick: null,
  invulnerableUntilTick: 0,
};

describe("resolveVehiclePairs", () => {
  it("separates overlapping cars, exchanges approach velocity with restitution 0.3 and reports the impact", () => {
    const first = { ...createVehicle(1, "sedan", [0, 0], 0, 0), velocityX: 10 };
    const second = createVehicle(2, "sedan", [2, 0], 0, 0);
    const result = resolveVehiclePairs([first, second]);
    expect(result.vehicles[0].x).toBeCloseTo(-0.6);
    expect(result.vehicles[1].x).toBeCloseTo(2.6);
    expect(result.vehicles[0].velocityX).toBeCloseTo(3.5);
    expect(result.vehicles[1].velocityX).toBeCloseTo(6.5);
    expect(result.impacts).toEqual([{ first: 0, second: 1, impactSpeed: 10 }]);
  });

  it("leaves separated cars alone and only separates receding ones", () => {
    const parked = [
      createVehicle(1, "sedan", [0, 0], 0, 0),
      createVehicle(2, "sedan", [10, 0], 0, 0),
    ];
    expect(resolveVehiclePairs(parked)).toEqual({
      vehicles: parked,
      impacts: [],
    });
    const receding = [
      { ...createVehicle(1, "sedan", [0, 0], 0, 0), velocityX: -5 },
      createVehicle(2, "sedan", [2, 0], 0, 0),
    ];
    const result = resolveVehiclePairs(receding);
    expect(result.impacts).toEqual([]);
    expect(result.vehicles[0].velocityX).toBe(-5);
    expect(result.vehicles[0].x).toBeCloseTo(-0.6);
  });
});

describe("resolveVehicleAgainstPlayer", () => {
  it("pushes a player clear of a car and deals 5 × speed above 5 m/s", () => {
    const fast = { ...createVehicle(1, "sport", [0, 0], 0, 0), velocityX: 12 };
    const hit = resolveVehicleAgainstPlayer(fast, walker);
    expect(hit.player.x).toBeCloseTo(2.5);
    expect(hit.player.y).toBeCloseTo(0);
    expect(hit.damage).toBe(60);
  });

  it("pushes without hurting below 5 m/s and ignores players out of reach", () => {
    const slow = { ...createVehicle(1, "sport", [0, 0], 0, 0), velocityX: 3 };
    const nudged = resolveVehicleAgainstPlayer(slow, walker);
    expect(nudged.player.x).toBeCloseTo(2.5);
    expect(nudged.damage).toBe(0);
    const far = { ...walker, x: 5 };
    expect(resolveVehicleAgainstPlayer(slow, far)).toEqual({
      player: far,
      damage: 0,
    });
  });
});
```

```ts
// src/lib/cityArena/sim/damage.test.ts
import { describe, expect, it } from "vitest";
import {
  damagePlayer,
  damageVehicle,
  impactDamage,
  inBlastRadius,
  isDead,
  isInvulnerable,
} from "./damage";
import type { ArenaPlayerState } from "./types";
import { createVehicle } from "./vehicle";

const walker: ArenaPlayerState = {
  id: 0,
  x: 0,
  y: 0,
  facing: 0,
  speed: 0,
  health: 100,
  weapon: "pistol",
  ammo: { uzi: 60, shotgun: 8 },
  vehicleId: null,
  boardingTicksLeft: 0,
  nextShotTick: 0,
  diedAtTick: null,
  invulnerableUntilTick: 0,
};

describe("damage", () => {
  it("computes impact damage above the 4 m/s threshold", () => {
    expect(impactDamage(3)).toBe(0);
    expect(impactDamage(10)).toBe(18);
    expect(impactDamage(30)).toBe(78);
  });

  it("hurts the player, records the death tick and then ignores further damage", () => {
    const hurt = damagePlayer(walker, 30, 10);
    expect(hurt).toMatchObject({ health: 70, diedAtTick: null });
    const dead = damagePlayer(hurt, 80, 20);
    expect(dead).toMatchObject({ health: 0, diedAtTick: 20 });
    expect(isDead(dead)).toBe(true);
    expect(damagePlayer(dead, 10, 21)).toBe(dead);
  });

  it("respects invulnerability until the given tick", () => {
    const shielded = { ...walker, invulnerableUntilTick: 50 };
    expect(damagePlayer(shielded, 10, 40)).toBe(shielded);
    expect(damagePlayer(shielded, 10, 50).health).toBe(90);
    expect(isInvulnerable(shielded, 49)).toBe(true);
    expect(isInvulnerable(shielded, 50)).toBe(false);
  });

  it("damages cars down to zero, leaves wrecks alone and tests the blast radius", () => {
    const car = createVehicle(1, "sedan", [0, 0], 0, 0);
    expect(damageVehicle(car, 78).health).toBe(22);
    expect(damageVehicle({ ...car, health: 22 }, 78).health).toBe(0);
    const wreck = { ...car, wrecked: true, health: 0 };
    expect(damageVehicle(wreck, 10)).toBe(wreck);
    expect(inBlastRadius(car, [2, 2])).toBe(true);
    expect(inBlastRadius(car, [3, 1])).toBe(false);
  });
});
```

```ts
// src/lib/cityArena/sim/effects.test.ts
import { describe, expect, it } from "vitest";
import { addEffect, effectProgress, pruneEffects } from "./effects";
import type { EffectState } from "./types";

describe("effects", () => {
  it("adds effects with the ttl of their kind and prunes them when expired", () => {
    const effects = addEffect([], {
      id: 1,
      kind: "explosion",
      x: 0,
      y: 0,
      angle: 0,
      bornTick: 10,
    });
    expect(effects[0].ttlTicks).toBe(18);
    expect(pruneEffects(effects, 27)).toHaveLength(1);
    expect(pruneEffects(effects, 28)).toEqual([]);
    expect(effectProgress(effects[0], 19)).toBeCloseTo(0.5);
  });

  it("keeps only the newest 64 effects", () => {
    let effects: EffectState[] = [];
    for (let id = 0; id < 70; id++)
      effects = addEffect(effects, {
        id,
        kind: "impact",
        x: 0,
        y: 0,
        angle: 0,
        bornTick: 0,
      });
    expect(effects).toHaveLength(64);
    expect(effects[0].id).toBe(6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim/collisions.test.ts src/lib/cityArena/sim/damage.test.ts src/lib/cityArena/sim/effects.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement collisions.ts**

```ts
// src/lib/cityArena/sim/collisions.ts
import { PLAYER_RADIUS_M } from "./player";
import type { ArenaPlayerState, VehicleState } from "./types";
import { RESTITUTION } from "./vehicle";

/** Radius of the single circle that stands in for a car in car–car and car–player contacts. */
export const CAR_BODY_RADIUS_M = 1.6;
/** Cars slower than this do not hurt people (spec §5). */
export const RUN_OVER_MIN_SPEED_MPS = 5;
/** Damage per m/s of car speed when running someone over (spec §5). */
export const RUN_OVER_DAMAGE_PER_MPS = 5;
/** Extra clearance a hit player is pushed to, so the next tick starts contact-free. */
export const RUN_OVER_CLEARANCE_M = 0.5;

/** One car–car contact this tick, by index into the vehicle list. */
export type PairImpact = { first: number; second: number; impactSpeed: number };

/** Both cars after a contact plus their approach speed. */
type PairResolution = {
  first: VehicleState;
  second: VehicleState;
  impactSpeed: number;
};

/** Separates two overlapping cars equally and exchanges their approach velocity with restitution. */
function resolvePair(
  first: VehicleState,
  second: VehicleState,
): PairResolution | null {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const distance = Math.hypot(dx, dy);
  const minimum = CAR_BODY_RADIUS_M * 2;
  if (distance >= minimum || distance === 0) return null;
  const normalX = dx / distance;
  const normalY = dy / distance;
  const shift = (minimum - distance) / 2;
  const approach =
    (first.velocityX - second.velocityX) * normalX +
    (first.velocityY - second.velocityY) * normalY;
  const impulse = approach > 0 ? ((1 + RESTITUTION) * approach) / 2 : 0;
  return {
    first: {
      ...first,
      x: first.x - normalX * shift,
      y: first.y - normalY * shift,
      velocityX: first.velocityX - normalX * impulse,
      velocityY: first.velocityY - normalY * impulse,
    },
    second: {
      ...second,
      x: second.x + normalX * shift,
      y: second.y + normalY * shift,
      velocityX: second.velocityX + normalX * impulse,
      velocityY: second.velocityY + normalY * impulse,
    },
    impactSpeed: Math.max(0, approach),
  };
}

/** Resolves every overlapping car pair once per tick (cars are few, so the pair loop is cheap). */
export function resolveVehiclePairs(vehicles: VehicleState[]): {
  vehicles: VehicleState[];
  impacts: PairImpact[];
} {
  const resolved = [...vehicles];
  const impacts: PairImpact[] = [];
  for (let first = 0; first < resolved.length; first++) {
    for (let second = first + 1; second < resolved.length; second++) {
      const pair = resolvePair(resolved[first], resolved[second]);
      if (!pair) continue;
      resolved[first] = pair.first;
      resolved[second] = pair.second;
      if (pair.impactSpeed > 0)
        impacts.push({ first, second, impactSpeed: pair.impactSpeed });
    }
  }
  return { vehicles: resolved, impacts };
}

/** Pushes a player on foot clear of a car and reports run-over damage (5 × speed above 5 m/s). */
export function resolveVehicleAgainstPlayer(
  vehicle: VehicleState,
  player: ArenaPlayerState,
): { player: ArenaPlayerState; damage: number } {
  const dx = player.x - vehicle.x;
  const dy = player.y - vehicle.y;
  const distance = Math.hypot(dx, dy);
  const minimum = CAR_BODY_RADIUS_M + PLAYER_RADIUS_M;
  if (distance >= minimum) return { player, damage: 0 };
  const normalX = distance === 0 ? 1 : dx / distance;
  const normalY = distance === 0 ? 0 : dy / distance;
  const clearance = minimum + RUN_OVER_CLEARANCE_M;
  const speed = Math.hypot(vehicle.velocityX, vehicle.velocityY);
  const damage =
    speed > RUN_OVER_MIN_SPEED_MPS ? RUN_OVER_DAMAGE_PER_MPS * speed : 0;
  return {
    player: {
      ...player,
      x: vehicle.x + normalX * clearance,
      y: vehicle.y + normalY * clearance,
    },
    damage,
  };
}
```

- [ ] **Step 4: Implement damage.ts and effects.ts**

```ts
// src/lib/cityArena/sim/damage.ts
import type { Point } from "../world/projection";
import type { ArenaPlayerState, VehicleState } from "./types";

/** Health at spawn (spec §5). */
export const PLAYER_MAX_HEALTH = 100;
/** Ticks between death and respawn (spec §5: 3 s). */
export const RESPAWN_DELAY_TICKS = 90;
/** Ticks of blinking invulnerability after a respawn (spec §5: 2 s). */
export const INVULNERABLE_TICKS = 60;
/** Blast radius of an exploding car (spec §5). */
export const EXPLOSION_RADIUS_M = 3;
/** Damage dealt inside the blast radius (spec §5). */
export const EXPLOSION_DAMAGE = 80;
/** Damage that certainly kills a full-health player (the occupant of an exploding car). */
export const LETHAL_DAMAGE = 1000;
/** Impact speeds up to this deal no damage (spec §5). */
export const IMPACT_DAMAGE_THRESHOLD_MPS = 4;
/** Damage per m/s of impact speed above the threshold (spec §5). */
export const IMPACT_DAMAGE_PER_MPS = 3;

/** Spec §5: max(0, impact speed − 4) × 3. */
export function impactDamage(impactSpeed: number): number {
  return (
    Math.max(0, impactSpeed - IMPACT_DAMAGE_THRESHOLD_MPS) *
    IMPACT_DAMAGE_PER_MPS
  );
}

/** True while the player waits for a respawn. */
export function isDead(player: Pick<ArenaPlayerState, "diedAtTick">): boolean {
  return player.diedAtTick !== null;
}

/** True while the post-respawn shield is active. */
export function isInvulnerable(
  player: Pick<ArenaPlayerState, "invulnerableUntilTick">,
  tick: number,
): boolean {
  return tick < player.invulnerableUntilTick;
}

/** Applies damage unless the player is dead or shielded; reaching 0 records the death tick. */
export function damagePlayer(
  player: ArenaPlayerState,
  amount: number,
  tick: number,
): ArenaPlayerState {
  if (amount <= 0 || isDead(player) || isInvulnerable(player, tick))
    return player;
  const health = Math.max(0, player.health - amount);
  return { ...player, health, diedAtTick: health === 0 ? tick : null };
}

/** Applies damage to a car, clamping at 0; wrecking (the explosion) is the arena step's job. */
export function damageVehicle(
  vehicle: VehicleState,
  amount: number,
): VehicleState {
  if (amount <= 0 || vehicle.wrecked) return vehicle;
  return { ...vehicle, health: Math.max(0, vehicle.health - amount) };
}

/** True when `point` lies inside the blast radius around the car. */
export function inBlastRadius(
  vehicle: Pick<VehicleState, "x" | "y">,
  point: Point,
): boolean {
  return (
    Math.hypot(point[0] - vehicle.x, point[1] - vehicle.y) < EXPLOSION_RADIUS_M
  );
}
```

```ts
// src/lib/cityArena/sim/effects.ts
import type { EffectKind, EffectState } from "./types";

/** Lifetime of each effect kind in ticks. */
export const EFFECT_TTL_TICKS: Record<EffectKind, number> = {
  muzzle: 2,
  impact: 6,
  explosion: 18,
};

/** Hard cap on live effects; the oldest are dropped first. */
export const MAX_EFFECTS = 64;

/** Appends an effect with the ttl of its kind, dropping the oldest beyond the cap. */
export function addEffect(
  effects: EffectState[],
  effect: Omit<EffectState, "ttlTicks">,
): EffectState[] {
  const next = [
    ...effects,
    { ...effect, ttlTicks: EFFECT_TTL_TICKS[effect.kind] },
  ];
  return next.length > MAX_EFFECTS
    ? next.slice(next.length - MAX_EFFECTS)
    : next;
}

/** Effects still alive at `tick`. */
export function pruneEffects(
  effects: EffectState[],
  tick: number,
): EffectState[] {
  return effects.filter((effect) => tick - effect.bornTick < effect.ttlTicks);
}

/** Lifetime progress in 0..1 for the renderer. */
export function effectProgress(effect: EffectState, tick: number): number {
  return Math.min(1, Math.max(0, (tick - effect.bornTick) / effect.ttlTicks));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/sim/collisions.test.ts src/lib/cityArena/sim/damage.test.ts src/lib/cityArena/sim/effects.test.ts`
Expected: PASS (4 + 4 + 2 tests). Worked numbers: two sedans 2 m apart overlap by 1.2 m (2 × 1.6 − 2) and are shifted 0.6 m each; the approach speed 10 m/s yields an impulse of 1.3 × 10 / 2 = 6.5 m/s per car; a player 1 m from a car centre is pushed to 1.6 + 0.4 + 0.5 = 2.5 m.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/sim
git add src/lib/cityArena/sim/collisions.ts src/lib/cityArena/sim/collisions.test.ts src/lib/cityArena/sim/damage.ts src/lib/cityArena/sim/damage.test.ts src/lib/cityArena/sim/effects.ts src/lib/cityArena/sim/effects.test.ts
git commit -m "feat(arena): add car collisions, damage rules and render effects

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Parked-car placement and spawn-node choice

**Files:**

- Create: `src/lib/cityArena/sim/spawn.ts`
- Test: `src/lib/cityArena/sim/spawn.test.ts`

**Interfaces:**

- Consumes: `MapIndex`, `MapZone` (`../world/mapTypes`); `RoadGraph` (`../world/roadGraph`); `fromUnits`, `Point`; `pickSpawn`, `distanceToZoneEdge` (`../world/zone`); `VehicleKind`, `VehicleState` (Task 1); `createVehicle`, `VEHICLE_COLOUR_COUNT` (Task 2); `createRng` (tests).
- Produces: `PARKED_CARS_PER_ZONE = 8`, `MIN_CAR_SPACING_M = 12`, `MIN_CAR_TO_PLAYER_M = 8`, `PARKED_CAR_KINDS`, `SpawnGraph = Pick<RoadGraph, "nodes" | "edges" | "adjacency" | "nearestNode">`, `shuffle<T>(items, random): T[]`, `roadHeadingAt(graph, point): number`, `spawnParkedCars(index, graph, random, avoid: Point[], firstId): VehicleState[]`, `chooseSpawnNode(zone, threats: Point[], random): Point`, `nearestZone(index, point): MapZone | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/sim/spawn.test.ts
import { describe, expect, it } from "vitest";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import { createRng } from "./rng";
import {
  PARKED_CARS_PER_ZONE,
  chooseSpawnNode,
  nearestZone,
  roadHeadingAt,
  shuffle,
  spawnParkedCars,
} from "./spawn";

/** Twenty spawn nodes 10 m apart along y = 0 (40 units per node). */
const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [400, 0],
  radius: 2000,
  spawnNodes: Array.from({ length: 20 }, (_, index): [number, number] => [
    index * 40,
    0,
  ]),
  landmarks: [],
};
const otherZone: MapZone = {
  key: "rhenen",
  name: "Rhenen centrum",
  center: [40000, 0],
  radius: 2000,
  spawnNodes: [[40000, 0]],
  landmarks: [],
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [zone, otherZone],
  landmarks: [],
};
/** A road along y = 0 from x = 0 to 190 m with a spur north at x = 100 m (node coordinates in units). */
const graph = decodeRoadGraph({
  nodes: [0, 0, 760, 0, 400, 0, 400, -400],
  edges: [0, 2, 0, -1, 0, 400, 2, 1, 0, -1, 0, 360, 2, 3, 0, -1, 0, 400],
  classes: ["residential"],
  names: [],
});

describe("spawn", () => {
  it("shuffles deterministically for a seed without losing items", () => {
    const items = [1, 2, 3, 4, 5, 6];
    const first = shuffle(items, createRng(3));
    expect(first).toEqual(shuffle(items, createRng(3)));
    expect([...first].sort((left, right) => left - right)).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("reads the road heading at a point from the nearest node's first edge", () => {
    expect(roadHeadingAt(graph, [1, 1])).toBeCloseTo(0);
    expect(roadHeadingAt(graph, [189, 0])).toBeCloseTo(Math.PI);
    expect(roadHeadingAt(graph, [100, -99])).toBeCloseTo(Math.PI / 2);
    expect(roadHeadingAt(graph, [500, 500])).toBe(0);
  });

  it("parks up to eight seeded cars per zone on spawn nodes, spaced apart and away from the player", () => {
    const avoid: [number, number] = [0, 0];
    const cars = spawnParkedCars(index, graph, createRng(11), [avoid], 50);
    const campusCars = cars.filter((car) => car.x < 1000);
    expect(campusCars.length).toBeGreaterThanOrEqual(6);
    expect(campusCars.length).toBeLessThanOrEqual(PARKED_CARS_PER_ZONE);
    expect(cars.map((car) => car.id)).toEqual(
      cars.map((_, offset) => 50 + offset),
    );
    for (const car of campusCars) {
      expect(car.x % 10).toBe(0);
      expect(
        Math.hypot(car.x - avoid[0], car.y - avoid[1]),
      ).toBeGreaterThanOrEqual(8);
      expect(["compact", "sedan", "sport"]).toContain(car.kind);
      expect(car.colour).toBeLessThan(6);
    }
    for (const first of campusCars) {
      for (const second of campusCars) {
        if (first === second) continue;
        expect(
          Math.hypot(first.x - second.x, first.y - second.y),
        ).toBeGreaterThanOrEqual(12);
      }
    }
    expect(cars.filter((car) => car.x >= 1000)).toHaveLength(1);
    expect(spawnParkedCars(index, graph, createRng(11), [avoid], 50)).toEqual(
      cars,
    );
  });

  it("chooses a random node without threats and the farthest node from threats", () => {
    const free = chooseSpawnNode(zone, [], createRng(5));
    expect(free[1]).toBe(0);
    expect(free[0] % 10).toBe(0);
    expect(chooseSpawnNode(zone, [[0, 0]], createRng(5))).toEqual([190, 0]);
    expect([90, 100]).toContain(
      chooseSpawnNode(
        zone,
        [
          [0, 0],
          [190, 0],
        ],
        createRng(5),
      )[0],
    );
  });

  it("finds the nearest zone to a point outside every disc", () => {
    expect(nearestZone(index, [3000, 0])?.key).toBe("campus");
    expect(nearestZone(index, [9000, 0])?.key).toBe("rhenen");
    expect(nearestZone({ ...index, zones: [] }, [0, 0])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim/spawn.test.ts`
Expected: FAIL — module `./spawn` not found.

- [ ] **Step 3: Implement spawn.ts**

```ts
// src/lib/cityArena/sim/spawn.ts
import type { MapIndex, MapZone } from "../world/mapTypes";
import { fromUnits, type Point } from "../world/projection";
import type { RoadGraph } from "../world/roadGraph";
import { distanceToZoneEdge, pickSpawn } from "../world/zone";
import type { VehicleKind, VehicleState } from "./types";
import { VEHICLE_COLOUR_COUNT, createVehicle } from "./vehicle";

/** Parked cars placed per zone at session start (scope decision 3). */
export const PARKED_CARS_PER_ZONE = 8;
/** Minimum distance between two parked cars. */
export const MIN_CAR_SPACING_M = 12;
/** Minimum distance between a parked car and a point in the avoid list (the player spawn). */
export const MIN_CAR_TO_PLAYER_M = 8;
/** Kinds parked cars are drawn from; police cars arrive with the cops in Plan 4b. */
export const PARKED_CAR_KINDS: VehicleKind[] = ["compact", "sedan", "sport"];
/** Search radius when snapping a spawn node to the road graph for its heading. */
const ROAD_SNAP_M = 30;
/** Candidate scores within this distance of the best count as ties for the seeded tie-break. */
const TIE_TOLERANCE_M = 1;

/** The part of the road graph the spawner reads. */
export type SpawnGraph = Pick<
  RoadGraph,
  "nodes" | "edges" | "adjacency" | "nearestNode"
>;

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
function farFromAll(point: Point, others: Point[], minimum: number): boolean {
  return others.every(
    (other) => Math.hypot(other[0] - point[0], other[1] - point[1]) >= minimum,
  );
}

/** Up to PARKED_CARS_PER_ZONE nodes of one zone in seeded order, honouring spacing and the avoid list. */
function pickParkingNodes(
  zone: MapZone,
  random: () => number,
  avoid: Point[],
): Point[] {
  const chosen: Point[] = [];
  for (const node of shuffle(spawnNodesMetres(zone), random)) {
    if (chosen.length >= PARKED_CARS_PER_ZONE) break;
    if (!farFromAll(node, avoid, MIN_CAR_TO_PLAYER_M)) continue;
    if (!farFromAll(node, chosen, MIN_CAR_SPACING_M)) continue;
    chosen.push(node);
  }
  return chosen;
}

/** Parks seeded cars on spawn nodes of every zone, headed along the nearest road; ids count up from `firstId`. */
export function spawnParkedCars(
  index: MapIndex,
  graph: SpawnGraph,
  random: () => number,
  avoid: Point[],
  firstId: number,
): VehicleState[] {
  const cars: VehicleState[] = [];
  for (const zone of index.zones) {
    for (const node of pickParkingNodes(zone, random, avoid)) {
      const kind =
        PARKED_CAR_KINDS[Math.floor(random() * PARKED_CAR_KINDS.length)];
      const colour = Math.floor(random() * VEHICLE_COLOUR_COUNT);
      cars.push(
        createVehicle(
          firstId + cars.length,
          kind,
          node,
          roadHeadingAt(graph, node),
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/sim/spawn.test.ts`
Expected: PASS (5 tests). On a 20-node line 10 m apart, greedy selection with 12 m spacing always yields between 7 (the smallest maximal independent set of a 19-node path after the avoid rule) and the 8-car cap, and nodes sit at multiples of 10 m; with threats at both ends of the line the nodes at 90 m and 100 m tie at a 90 m score.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/cityArena/sim/spawn.ts src/lib/cityArena/sim/spawn.test.ts
git add src/lib/cityArena/sim/spawn.ts src/lib/cityArena/sim/spawn.test.ts
git commit -m "feat(arena): park seeded cars on spawn nodes and choose respawn nodes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The arena state and step — walking, driving, Instappen/Uitstappen, Wapen

**Files:**

- Create: `src/lib/cityArena/sim/arena.ts`
- Test: `src/lib/cityArena/sim/arena.test.ts`

**Interfaces:**

- Consumes: `CollisionGrid`; `MapIndex`, `MapZone`; `Point`; `findZone` (`../world/zone`); `resolveVehicleAgainstPlayer`, `resolveVehiclePairs`, `CAR_BODY_RADIUS_M`, `RUN_OVER_CLEARANCE_M` (Task 4); `PLAYER_MAX_HEALTH`, `damagePlayer`, `damageVehicle`, `impactDamage`, `isDead` (Task 4); `PLAYER_RADIUS_M`, `stepPlayer`; `chooseSpawnNode`, `spawnParkedCars`, `SpawnGraph` (Task 5); `ArenaPlayerState`, `ArenaState`, `HeldButtons`, `VehicleState`, `WorldInput` (Task 1); `NO_CONTROLS`, `distanceToVehicle`, `forwardSpeed`, `localToWorld`, `stepVehicle`, `VehicleControls` (Task 2); `SPAWN_AMMO`, `nextWeapon` (Task 1); `createRng` (tests).
- Produces: `ENTER_RANGE_M = 1.5`, `BOARDING_TICKS = 18`, `LOCAL_PLAYER_ID = 0`, `ArenaWorld = { collision: Pick<CollisionGrid, "resolveCircle" | "query">; index: MapIndex }`, `ArenaSetup = { index; graph: SpawnGraph; seed: number; zone: MapZone | null }`, `createArenaPlayer(position, tick): ArenaPlayerState`, `createArenaState(setup, random): ArenaState`, `occupiedVehicle(state): VehicleState | null`, `exitPosition(vehicle, collision): Point`, `stepArena(state, input, dt, world): ArenaState` (Task 7 adds the `random` parameter, firing, bullets, explosions and respawn), `teleportArenaPlayer(state, position, index): ArenaState`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/sim/arena.test.ts
import { describe, expect, it } from "vitest";
import { createCollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import { decodeRoadGraph } from "../world/roadGraph";
import {
  BOARDING_TICKS,
  createArenaState,
  stepArena,
  teleportArenaPlayer,
  type ArenaWorld,
} from "./arena";
import { createRng } from "./rng";
import { createInput, type ArenaState, type WorldInput } from "./types";
import { createVehicle } from "./vehicle";

/** One zone with spawn nodes at 0, 100, 200 and 300 m along y = 0. */
const zone: MapZone = {
  key: "campus",
  name: "WUR-campus",
  center: [600, 0],
  radius: 2000,
  spawnNodes: [
    [0, 0],
    [400, 0],
    [800, 0],
    [1200, 0],
  ],
  landmarks: [],
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [zone],
  landmarks: [],
};
const graph = decodeRoadGraph({
  nodes: [0, 0, 1200, 0],
  edges: [0, 1, 0, -1, 0, 1200],
  classes: ["residential"],
  names: [],
});
const world: ArenaWorld = { collision: createCollisionGrid(), index };
const step = 1 / 30;
const SPAWN_XS = [0, 100, 200, 300];

function boot(seed = 1): ArenaState {
  return createArenaState({ index, graph, seed, zone }, createRng(seed));
}

function run(state: ArenaState, input: WorldInput, ticks: number): ArenaState {
  let current = state;
  for (let index = 0; index < ticks; index++)
    current = stepArena(current, input, step, world);
  return current;
}

/** Replaces the parked cars by one compact `offsetX` metres east of the player. */
function withCar(
  state: ArenaState,
  offsetX: number,
  wrecked = false,
): ArenaState {
  const car = createVehicle(
    500,
    "compact",
    [state.player.x + offsetX, state.player.y],
    0,
    0,
  );
  return { ...state, vehicles: [{ ...car, wrecked }] };
}

describe("createArenaState", () => {
  it("spawns the player on a spawn node with the loadout and parks cars away from them", () => {
    const state = boot();
    expect(state.tick).toBe(0);
    expect(state.seed).toBe(1);
    expect(state.zoneKey).toBe("campus");
    expect(state.player).toMatchObject({
      id: 0,
      health: 100,
      weapon: "pistol",
      ammo: { uzi: 60, shotgun: 8 },
      vehicleId: null,
      diedAtTick: null,
    });
    expect(SPAWN_XS).toContain(state.player.x);
    expect(state.vehicles.length).toBeGreaterThanOrEqual(1);
    expect(state.vehicles.length).toBeLessThanOrEqual(3);
    for (const car of state.vehicles)
      expect(Math.abs(car.x - state.player.x)).toBeGreaterThanOrEqual(8);
    expect(state.nextId).toBe(1 + state.vehicles.length);
    expect(boot(4)).toEqual(boot(4));
  });
});

describe("stepArena on foot", () => {
  it("advances the tick and walks with the aim as facing", () => {
    const start = boot();
    const walked = run(start, createInput({ move: [1, 0], aim: Math.PI }), 30);
    expect(walked.tick).toBe(30);
    expect(walked.player.x).toBeCloseTo(start.player.x + 4);
    expect(walked.player.facing).toBeCloseTo(Math.PI);
    expect(walked.held).toEqual({ enter: false, weaponNext: false });
  });

  it("cycles the weapon on a rising edge only", () => {
    const pressed = run(boot(), createInput({ weaponNext: true }), 5);
    expect(pressed.player.weapon).toBe("uzi");
    const released = run(pressed, createInput({}), 1);
    expect(
      run(released, createInput({ weaponNext: true }), 1).player.weapon,
    ).toBe("shotgun");
  });
});

describe("stepArena driving", () => {
  it("enters a car within 1.5 m on a rising edge, boards for 18 ticks, then drives with the car", () => {
    const near = withCar(boot(), 3);
    const boarded = run(near, createInput({ enter: true }), 1);
    expect(boarded.player.vehicleId).toBe(500);
    expect(boarded.player.boardingTicksLeft).toBe(BOARDING_TICKS - 1);
    const stillBoarding = run(
      boarded,
      createInput({ enter: true, move: [0, -1] }),
      17,
    );
    expect(stillBoarding.player.vehicleId).toBe(500);
    expect(stillBoarding.player.boardingTicksLeft).toBe(0);
    expect(stillBoarding.vehicles[0].x).toBeCloseTo(near.vehicles[0].x);
    const driving = run(stillBoarding, createInput({ move: [0, -1] }), 30);
    expect(driving.vehicles[0].velocityX).toBeCloseTo(6);
    expect(driving.vehicles[0].x).toBeCloseTo(near.vehicles[0].x + 3.1);
    expect(driving.player.x).toBeCloseTo(driving.vehicles[0].x);
    expect(driving.player.speed).toBeCloseTo(6);
  });

  it("steps out beside a stopped car on the next rising edge", () => {
    const boarded = run(withCar(boot(), 3), createInput({ enter: true }), 1);
    const driven = run(boarded, createInput({ move: [0, -1] }), 60);
    const braked = run(driven, createInput({ move: [0, 1] }), 15);
    const stopped = run(braked, createInput({}), 30);
    expect(stopped.vehicles[0].velocityX).toBeCloseTo(0);
    const out = run(stopped, createInput({ enter: true }), 1);
    expect(out.player.vehicleId).toBeNull();
    expect(out.player.x).toBeCloseTo(stopped.vehicles[0].x);
    expect(out.player.y).toBeCloseTo(stopped.vehicles[0].y - 2.5);
    expect(out.player.speed).toBe(0);
  });

  it("refuses cars out of reach and wrecks", () => {
    expect(
      run(withCar(boot(), 5), createInput({ enter: true }), 1).player.vehicleId,
    ).toBeNull();
    expect(
      run(withCar(boot(), 3, true), createInput({ enter: true }), 1).player
        .vehicleId,
    ).toBeNull();
  });

  it("teleports out of the car to the target and is deterministic for a seed", () => {
    const boarded = run(withCar(boot(), 3), createInput({ enter: true }), 1);
    const moved = teleportArenaPlayer(boarded, [150, 0], index);
    expect(moved.player).toMatchObject({
      x: 150,
      y: 0,
      vehicleId: null,
      speed: 0,
    });
    expect(moved.zoneKey).toBe("campus");
    const input = createInput({ move: [0.5, -0.5], enter: true });
    expect(run(boot(3), input, 60)).toEqual(run(boot(3), input, 60));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim/arena.test.ts`
Expected: FAIL — module `./arena` not found.

- [ ] **Step 3: Implement arena.ts**

```ts
// src/lib/cityArena/sim/arena.ts
import type { CollisionGrid } from "../world/collisionGrid";
import type { MapIndex, MapZone } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { findZone } from "../world/zone";
import {
  CAR_BODY_RADIUS_M,
  RUN_OVER_CLEARANCE_M,
  resolveVehicleAgainstPlayer,
  resolveVehiclePairs,
} from "./collisions";
import {
  PLAYER_MAX_HEALTH,
  damagePlayer,
  damageVehicle,
  impactDamage,
  isDead,
} from "./damage";
import { PLAYER_RADIUS_M, stepPlayer } from "./player";
import { chooseSpawnNode, spawnParkedCars, type SpawnGraph } from "./spawn";
import type {
  ArenaPlayerState,
  ArenaState,
  HeldButtons,
  VehicleState,
  WorldInput,
} from "./types";
import {
  NO_CONTROLS,
  distanceToVehicle,
  forwardSpeed,
  localToWorld,
  stepVehicle,
  type VehicleControls,
} from "./vehicle";
import { SPAWN_AMMO, nextWeapon } from "./weapons";

/** Distance from the car body within which Instappen works (spec §5). */
export const ENTER_RANGE_M = 1.5;
/** Ticks the driver needs to get in before the car answers the controls (spec §5: 0.6 s). */
export const BOARDING_TICKS = 18;
/** The local player's id; Plan 3 assigns real ids. */
export const LOCAL_PLAYER_ID = 0;
/** First id handed to entities (the player is 0). */
const FIRST_ENTITY_ID = 1;
/** How far from the car centre a player stands after Uitstappen: just outside the car–player contact circle. */
const EXIT_OFFSET_M =
  CAR_BODY_RADIUS_M + PLAYER_RADIUS_M + RUN_OVER_CLEARANCE_M;

/** What the arena step reads from the world. */
export type ArenaWorld = {
  collision: Pick<CollisionGrid, "resolveCircle" | "query">;
  index: MapIndex;
};

/** What a session is created from. */
export type ArenaSetup = {
  index: MapIndex;
  graph: SpawnGraph;
  seed: number;
  zone: MapZone | null;
};

/** A player standing at `position` with the spawn loadout, ready to fire from `tick`. */
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
  };
}

/** A fresh session: the player on a spawn node of `zone` (the map origin without one) and parked cars in every zone. */
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
  };
}

/** Rising edges of the edge-triggered buttons plus the held state to remember. */
function detectEdges(
  held: HeldButtons,
  input: WorldInput,
): { enterPressed: boolean; weaponPressed: boolean; held: HeldButtons } {
  return {
    enterPressed: input.enter && !held.enter,
    weaponPressed: input.weaponNext && !held.weaponNext,
    held: { enter: input.enter, weaponNext: input.weaponNext },
  };
}

/** The car the player sits in, if any. */
export function occupiedVehicle(state: ArenaState): VehicleState | null {
  return (
    state.vehicles.find((vehicle) => vehicle.id === state.player.vehicleId) ??
    null
  );
}

/** Instappen: board the nearest intact car whose body is within reach. */
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
  return {
    ...state,
    player: {
      ...state.player,
      vehicleId: best.id,
      boardingTicksLeft: BOARDING_TICKS,
      x: best.x,
      y: best.y,
      facing: best.heading,
      speed: 0,
    },
  };
}

/** Where a player stands after leaving a car: beside the driver's door, pushed out of walls. */
export function exitPosition(
  vehicle: VehicleState,
  collision: Pick<CollisionGrid, "resolveCircle">,
): Point {
  const beside = localToWorld(vehicle, [0, -EXIT_OFFSET_M]);
  return collision.resolveCircle(beside, PLAYER_RADIUS_M);
}

/** Uitstappen (also used when the driver dies): the player steps out beside the car. */
function exitVehicle(state: ArenaState, world: ArenaWorld): ArenaState {
  const vehicle = occupiedVehicle(state);
  const [x, y] = vehicle
    ? exitPosition(vehicle, world.collision)
    : [state.player.x, state.player.y];
  return {
    ...state,
    player: {
      ...state.player,
      vehicleId: null,
      boardingTicksLeft: 0,
      x,
      y,
      facing: vehicle ? vehicle.heading : state.player.facing,
      speed: 0,
    },
  };
}

/** Handles the Instappen/Uitstappen edge for a living player. */
function applyEnterExit(
  state: ArenaState,
  pressed: boolean,
  world: ArenaWorld,
): ArenaState {
  if (!pressed || isDead(state.player)) return state;
  return state.player.vehicleId === null
    ? enterVehicle(state)
    : exitVehicle(state, world);
}

/** Handles the Wapen edge. */
function applyWeaponSwitch(state: ArenaState, pressed: boolean): ArenaState {
  if (!pressed || isDead(state.player)) return state;
  const weapon = nextWeapon(state.player.weapon, state.player.ammo);
  return { ...state, player: { ...state.player, weapon } };
}

/** Stick or keys to car controls: up is gas, down is brake/reverse, x steers. */
function controlsFromInput(input: WorldInput): VehicleControls {
  return { throttle: -input.move[1], steer: input.move[0] };
}

/** Steps every car (only the occupied one gets controls), then applies building and car–car impact damage. */
function stepVehicles(
  state: ArenaState,
  controls: VehicleControls,
  dt: number,
  world: ArenaWorld,
): VehicleState[] {
  const stepped = state.vehicles.map((vehicle) => {
    const own = vehicle.id === state.player.vehicleId ? controls : NO_CONTROLS;
    const result = stepVehicle(vehicle, own, dt, world.collision);
    return damageVehicle(result.vehicle, impactDamage(result.impactSpeed));
  });
  const pairs = resolveVehiclePairs(stepped);
  const damaged = [...pairs.vehicles];
  for (const impact of pairs.impacts) {
    const amount = impactDamage(impact.impactSpeed);
    damaged[impact.first] = damageVehicle(damaged[impact.first], amount);
    damaged[impact.second] = damageVehicle(damaged[impact.second], amount);
  }
  return damaged;
}

/** The driver follows the car while the boarding countdown runs out. */
function ridePlayer(
  player: ArenaPlayerState,
  vehicle: VehicleState,
): ArenaPlayerState {
  return {
    ...player,
    x: vehicle.x,
    y: vehicle.y,
    facing: vehicle.heading,
    speed: Math.abs(forwardSpeed(vehicle)),
    boardingTicksLeft: Math.max(0, player.boardingTicksLeft - 1),
  };
}

/** Walks a living player, then lets every car push (and, when fast, hurt) them. */
function walkPlayer(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  vehicles: VehicleState[],
  tick: number,
): ArenaPlayerState {
  let player = isDead(state.player)
    ? state.player
    : {
        ...state.player,
        ...stepPlayer(state.player, input, dt, world.collision),
      };
  for (const vehicle of vehicles) {
    const contact = resolveVehicleAgainstPlayer(vehicle, player);
    player = damagePlayer(contact.player, contact.damage, tick);
  }
  return player;
}

/** Moves the cars and the player for one tick. */
function moveEntities(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  const driving = occupiedVehicle(state);
  const canDrive =
    driving !== null &&
    !isDead(state.player) &&
    state.player.boardingTicksLeft === 0;
  const controls = canDrive ? controlsFromInput(input) : NO_CONTROLS;
  const vehicles = stepVehicles(state, controls, dt, world);
  if (driving) {
    const ridden =
      vehicles.find((vehicle) => vehicle.id === driving.id) ?? driving;
    return { ...state, vehicles, player: ridePlayer(state.player, ridden) };
  }
  return {
    ...state,
    vehicles,
    player: walkPlayer(state, input, dt, world, vehicles, tick),
  };
}

/** One fixed step of the arena (Task 7 adds firing, bullets, explosions and respawn). */
export function stepArena(
  state: ArenaState,
  input: WorldInput,
  dt: number,
  world: ArenaWorld,
): ArenaState {
  const tick = state.tick + 1;
  const edges = detectEdges(state.held, input);
  let next: ArenaState = { ...state, tick, held: edges.held };
  next = applyWeaponSwitch(next, edges.weaponPressed);
  next = applyEnterExit(next, edges.enterPressed, world);
  next = moveEntities(next, input, dt, world, tick);
  const zone = findZone(world.index, [next.player.x, next.player.y]);
  return { ...next, zoneKey: zone?.key ?? null };
}

/** Moves the player instantly (zone picker), leaving any car and in-flight bullets behind. */
export function teleportArenaPlayer(
  state: ArenaState,
  position: Point,
  index: MapIndex,
): ArenaState {
  return {
    ...state,
    player: {
      ...state.player,
      x: position[0],
      y: position[1],
      speed: 0,
      vehicleId: null,
      boardingTicksLeft: 0,
    },
    bullets: [],
    zoneKey: findZone(index, position)?.key ?? null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/sim/arena.test.ts`
Expected: PASS (1 + 2 + 4 tests). Walkthrough of the driving test: a compact 3 m east has its body edge 0.9 m away (≤ 1.5 m); the Instappen tick sets `boardingTicksLeft` to 18 and the same tick's ride decrements it to 17; 17 more held ticks reach 0 without the car answering the throttle; 30 ticks of gas then give 6 m/s and 3.1 m, exactly the Task 2 numbers. Uitstappen puts the player at `EXIT_OFFSET_M` = 1.6 + 0.4 + 0.5 = 2.5 m to the driver's left (negative local y = screen-up for heading 0), outside the car–player contact circle.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/cityArena/sim/arena.ts src/lib/cityArena/sim/arena.test.ts
git add src/lib/cityArena/sim/arena.ts src/lib/cityArena/sim/arena.test.ts
git commit -m "feat(arena): add the arena state with driving, boarding and weapon cycling

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Firing, bullet hits, explosions, death, respawn and the invariant checker

**Files:**

- Modify: `src/lib/cityArena/sim/arena.ts`
- Create: `src/lib/cityArena/sim/invariants.ts`
- Test: `src/lib/cityArena/sim/arena.test.ts` (extend), `src/lib/cityArena/sim/invariants.test.ts`

**Interfaces:**

- Consumes: everything Task 6 imports plus `MAX_BULLETS`, `createShots`, `stepBullets`, `BulletHit` (Task 3); `EXPLOSION_DAMAGE`, `INVULNERABLE_TICKS`, `LETHAL_DAMAGE`, `RESPAWN_DELAY_TICKS`, `inBlastRadius` (Task 4); `addEffect`, `pruneEffects`, `MAX_EFFECTS` (Task 4); `nearestZone` (Task 5); `findZoneByKey` (`../world/zone`); `WEAPONS`, `consumeAmmo`, `cooldownTicks`, `hasAmmo` (Task 1); `VEHICLE_MAX_HEALTH` (Task 2).
- Produces: the final `stepArena(state, input, dt, world, random): ArenaState`; `checkInvariants(state): string[]`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/cityArena/sim/arena.test.ts`, extend the imports and the `run` helper, then append the new `describe`:

```ts
// src/lib/cityArena/sim/arena.test.ts — changed imports and helper
import { checkInvariants } from "./invariants";
import {
  EMPTY_INPUT,
  createInput,
  type ArenaPlayerState,
  type ArenaState,
  type WorldInput,
} from "./types";

function run(
  state: ArenaState,
  input: WorldInput,
  ticks: number,
  random: () => number = createRng(99),
): ArenaState {
  let current = state;
  for (let index = 0; index < ticks; index++)
    current = stepArena(current, input, step, world, random);
  return current;
}
```

```ts
// src/lib/cityArena/sim/arena.test.ts — appended
describe("stepArena firing and death", () => {
  it("fires the pistol on the trigger with a 12-tick cooldown and a muzzle flash", () => {
    const fired = run(boot(), createInput({ fire: true }), 1);
    expect(fired.bullets).toHaveLength(1);
    expect(fired.effects.map((effect) => effect.kind)).toEqual(["muzzle"]);
    expect(fired.player.nextShotTick).toBe(13);
    expect(
      run(boot(), createInput({ fire: true }), 13).player.nextShotTick,
    ).toBe(25);
  });

  it("spends Uzi rounds at 10 per second and shotgun shells five pellets at a time", () => {
    const uzi = run(boot(), createInput({ weaponNext: true, fire: true }), 30);
    expect(uzi.player.weapon).toBe("uzi");
    expect(uzi.player.ammo.uzi).toBe(50);
    const state = boot();
    const armed: ArenaPlayerState = { ...state.player, weapon: "shotgun" };
    const blast = run(
      { ...state, player: armed },
      createInput({ fire: true }),
      1,
    );
    expect(blast.bullets).toHaveLength(5);
    expect(blast.player.ammo.shotgun).toBe(7);
  });

  it("falls back to the pistol when a magazine runs dry", () => {
    const state = boot();
    const lastShell: ArenaPlayerState = {
      ...state.player,
      weapon: "shotgun",
      ammo: { uzi: 0, shotgun: 1 },
    };
    const fired = run(
      { ...state, player: lastShell },
      createInput({ fire: true }),
      1,
    );
    expect(fired.player.ammo.shotgun).toBe(0);
    expect(fired.player.weapon).toBe("pistol");
  });

  it("wrecks a car after 100 damage and only hurts a player inside the 3 m blast", () => {
    const state = boot();
    const shot = run(
      withCar(state, 6),
      createInput({ fire: true, aim: 0 }),
      49,
    );
    expect(shot.vehicles[0]).toMatchObject({ health: 0, wrecked: true });
    expect(shot.effects.map((effect) => effect.kind)).toContain("explosion");
    expect(shot.player.health).toBe(100);
    const fragile = {
      ...createVehicle(
        501,
        "compact",
        [state.player.x, state.player.y + 2.5],
        0,
        0,
      ),
      health: 20,
    };
    const blasted = run(
      { ...state, vehicles: [fragile] },
      createInput({ fire: true, aim: Math.PI / 2 }),
      1,
    );
    expect(blasted.vehicles[0].wrecked).toBe(true);
    expect(blasted.player.health).toBe(20);
    expect(blasted.player.diedAtTick).toBeNull();
  });

  it("kills the occupant of an exploding car, ejects the body and respawns after 90 ticks with a shield", () => {
    const state = boot();
    const seated = run(withCar(state, 3), createInput({ enter: true }), 1);
    const doomed = {
      ...seated,
      vehicles: [{ ...seated.vehicles[0], health: 0 }],
    };
    const dead = run(doomed, EMPTY_INPUT, 1);
    expect(dead.player).toMatchObject({
      health: 0,
      vehicleId: null,
      diedAtTick: 2,
    });
    expect(dead.vehicles[0].wrecked).toBe(true);
    const waiting = run(
      dead,
      createInput({ move: [1, 0], fire: true, enter: true }),
      88,
    );
    expect(waiting.player).toMatchObject({
      diedAtTick: 2,
      x: dead.player.x,
      vehicleId: null,
    });
    expect(waiting.bullets).toEqual([]);
    const alive = run(waiting, EMPTY_INPUT, 2);
    expect(alive.tick).toBe(92);
    expect(alive.player).toMatchObject({
      health: 100,
      diedAtTick: null,
      weapon: "pistol",
      invulnerableUntilTick: 152,
      ammo: { uzi: 60, shotgun: 8 },
    });
    expect(SPAWN_XS).toContain(alive.player.x);
  });

  it("shields a respawned player from the blast", () => {
    const state = boot();
    const shielded: ArenaPlayerState = {
      ...state.player,
      invulnerableUntilTick: 60,
    };
    const fragile = {
      ...createVehicle(
        501,
        "compact",
        [state.player.x, state.player.y + 2.5],
        0,
        0,
      ),
      health: 20,
    };
    const blasted = run(
      { ...state, player: shielded, vehicles: [fragile] },
      createInput({ fire: true, aim: Math.PI / 2 }),
      1,
    );
    expect(blasted.player.health).toBe(100);
  });

  it("keeps the invariants across a busy run", () => {
    const busy = run(
      withCar(boot(), 3),
      createInput({
        move: [0.7, -0.7],
        fire: true,
        enter: true,
        weaponNext: true,
      }),
      200,
    );
    expect(checkInvariants(busy)).toEqual([]);
  });
});
```

```ts
// src/lib/cityArena/sim/invariants.test.ts
import { describe, expect, it } from "vitest";
import { createArenaPlayer } from "./arena";
import { createShots } from "./bullets";
import { checkInvariants } from "./invariants";
import type { ArenaState } from "./types";
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
};

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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim/arena.test.ts src/lib/cityArena/sim/invariants.test.ts`
Expected: FAIL — `./invariants` not found; `fired.bullets` has length 0 because the Task 6 step never fires.

- [ ] **Step 3: Extend arena.ts**

Merge these imports into the existing import lines of `arena.ts` (the `damage`, `spawn`, `weapons` and `zone` imports grow; `bullets` and `effects` are new):

```ts
// src/lib/cityArena/sim/arena.ts — imports to add
import { findZone, findZoneByKey } from "../world/zone";
import {
  MAX_BULLETS,
  createShots,
  stepBullets,
  type BulletHit,
} from "./bullets";
import {
  EXPLOSION_DAMAGE,
  INVULNERABLE_TICKS,
  LETHAL_DAMAGE,
  PLAYER_MAX_HEALTH,
  RESPAWN_DELAY_TICKS,
  damagePlayer,
  damageVehicle,
  impactDamage,
  inBlastRadius,
  isDead,
} from "./damage";
import { addEffect, pruneEffects } from "./effects";
import {
  chooseSpawnNode,
  nearestZone,
  spawnParkedCars,
  type SpawnGraph,
} from "./spawn";
import {
  SPAWN_AMMO,
  WEAPONS,
  consumeAmmo,
  cooldownTicks,
  hasAmmo,
  nextWeapon,
} from "./weapons";
```

Add these functions below `moveEntities` and replace the Task 6 `stepArena`:

```ts
// src/lib/cityArena/sim/arena.ts — added functions
/** Ammo, weapon and cooldown after one trigger pull; an emptied magazine falls back to the pistol. */
function afterShot(player: ArenaPlayerState, tick: number): ArenaPlayerState {
  const ammo = consumeAmmo(player.ammo, player.weapon);
  return {
    ...player,
    ammo,
    weapon: hasAmmo(ammo, player.weapon) ? player.weapon : "pistol",
    nextShotTick: tick + cooldownTicks(player.weapon),
  };
}

/** Fires while the trigger is held, the cooldown has passed and there is ammo; drive-bys fire from the car and ignore it. */
function applyFire(
  state: ArenaState,
  input: WorldInput,
  tick: number,
  random: () => number,
): ArenaState {
  const { player } = state;
  const ready =
    input.fire &&
    !isDead(player) &&
    tick >= player.nextShotTick &&
    hasAmmo(player.ammo, player.weapon) &&
    state.bullets.length < MAX_BULLETS;
  if (!ready) return state;
  const angle = input.aim ?? player.facing;
  const shots = createShots(
    WEAPONS[player.weapon],
    player.weapon,
    [player.x, player.y],
    angle,
    {
      ownerId: player.id,
      ignoreVehicleId: player.vehicleId,
      firstId: state.nextId,
    },
    random,
  );
  const muzzleId = state.nextId + shots.length;
  const effects =
    player.weapon === "fist"
      ? state.effects
      : addEffect(state.effects, {
          id: muzzleId,
          kind: "muzzle",
          x: player.x,
          y: player.y,
          angle,
          bornTick: tick,
        });
  return {
    ...state,
    nextId: muzzleId + 1,
    bullets: [...state.bullets, ...shots],
    effects,
    player: afterShot(player, tick),
  };
}

/** Applies one bullet hit: car damage, or damage to a player on foot (never the shooter). */
function applyHit(state: ArenaState, hit: BulletHit, tick: number): ArenaState {
  if (hit.target.kind === "vehicle") {
    const vehicleId = hit.target.vehicleId;
    return {
      ...state,
      vehicles: state.vehicles.map((vehicle) =>
        vehicle.id === vehicleId
          ? damageVehicle(vehicle, hit.bullet.damage)
          : vehicle,
      ),
    };
  }
  if (hit.target.kind === "player" && hit.target.playerId === state.player.id)
    return {
      ...state,
      player: damagePlayer(state.player, hit.bullet.damage, tick),
    };
  return state;
}

/** Sweeps the bullets, applies their hits and spawns an impact effect per hit. */
function advanceBullets(
  state: ArenaState,
  dt: number,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  const { player } = state;
  const onFoot = !isDead(player) && player.vehicleId === null;
  const swept = stepBullets(state.bullets, dt, {
    collision: world.collision,
    vehicles: state.vehicles,
    players: onFoot ? [{ id: player.id, x: player.x, y: player.y }] : [],
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

/** Blast damage to the player: lethal for the occupant, 80 inside the radius on foot. */
function blastPlayer(
  player: ArenaPlayerState,
  vehicle: VehicleState,
  tick: number,
): ArenaPlayerState {
  if (player.vehicleId === vehicle.id)
    return damagePlayer(player, LETHAL_DAMAGE, tick);
  if (player.vehicleId === null && inBlastRadius(vehicle, [player.x, player.y]))
    return damagePlayer(player, EXPLOSION_DAMAGE, tick);
  return player;
}

/** Wrecks one car that reached 0 health: explosion effect, blast damage to the player and to cars nearby. */
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
  return {
    ...state,
    vehicles,
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

/** Explodes every car whose health reached 0 this tick and throws its occupant out. */
function applyExplosions(
  state: ArenaState,
  world: ArenaWorld,
  tick: number,
): ArenaState {
  let next = state;
  for (const vehicle of state.vehicles) {
    if (vehicle.health > 0 || vehicle.wrecked) continue;
    next = explodeVehicle(next, vehicle, tick);
    if (next.player.vehicleId === vehicle.id) next = exitVehicle(next, world);
  }
  return next;
}

/** Safety net: a player who died while seated is placed beside the car. */
function ejectIfDead(state: ArenaState, world: ArenaWorld): ArenaState {
  if (!isDead(state.player) || state.player.vehicleId === null) return state;
  return exitVehicle(state, world);
}

/** After 90 ticks: full health and the spawn loadout on a node of the current (else nearest) zone, shielded for 60 ticks. */
function applyRespawn(
  state: ArenaState,
  world: ArenaWorld,
  tick: number,
  random: () => number,
): ArenaState {
  const { player } = state;
  if (
    player.diedAtTick === null ||
    tick < player.diedAtTick + RESPAWN_DELAY_TICKS
  )
    return state;
  const zone =
    (state.zoneKey ? findZoneByKey(world.index, state.zoneKey) : null) ??
    nearestZone(world.index, [player.x, player.y]);
  const spawn: Point = zone
    ? chooseSpawnNode(zone, [], random)
    : [player.x, player.y];
  return {
    ...state,
    player: {
      ...createArenaPlayer(spawn, tick),
      invulnerableUntilTick: tick + INVULNERABLE_TICKS,
    },
  };
}

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
  let next: ArenaState = { ...state, tick, held: edges.held };
  next = applyRespawn(next, world, tick, random);
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

- [ ] **Step 4: Implement invariants.ts**

```ts
// src/lib/cityArena/sim/invariants.ts
import { MAX_BULLETS } from "./bullets";
import { PLAYER_MAX_HEALTH } from "./damage";
import { MAX_EFFECTS } from "./effects";
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

/** Player health, ammo, position and car reference. */
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
function checkVehicles(state: ArenaState, violations: string[]): void {
  const ids = new Set<number>();
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
    check(
      violations,
      !ids.has(vehicle.id),
      `duplicate vehicle id ${vehicle.id}`,
    );
    ids.add(vehicle.id);
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

/** Every broken invariant of a state (empty when healthy); pure, so tests run it after each step. */
export function checkInvariants(state: ArenaState): string[] {
  const violations: string[] = [];
  check(
    violations,
    Number.isInteger(state.tick) && state.tick >= 0,
    "tick must be a non-negative integer",
  );
  checkPlayer(state, violations);
  checkVehicles(state, violations);
  checkProjectiles(state, violations);
  return violations;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/sim`
Expected: PASS — arena 7 + 7 tests, invariants 2, and every earlier sim suite. Worked numbers: pistol shots land on ticks 1, 13, 25, 37 and 49 (cooldown 12) for 5 × 20 = 100 damage, so the car at 6 m (body edge 3.9 m, inside the first 4 m sweep) is wrecked on tick 49; the Uzi fires on ticks 1, 4, …, 28 = 10 rounds in 30 ticks; the occupant dies on tick 2 and respawns on tick 92 = 2 + 90 with a shield until 152.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/sim
git add src/lib/cityArena/sim/arena.ts src/lib/cityArena/sim/arena.test.ts src/lib/cityArena/sim/invariants.ts src/lib/cityArena/sim/invariants.test.ts
git commit -m "feat(arena): fire weapons, explode cars, die and respawn in the arena step

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Keyboard buttons, mouse aim and the driving look-ahead

**Files:**

- Modify: `src/lib/cityArena/input/keyboard.ts`
- Create: `src/lib/cityArena/input/pointerAim.ts`
- Modify: `src/lib/cityArena/render/camera.ts`
- Test: `src/lib/cityArena/input/keyboard.test.ts` (replace), `src/lib/cityArena/input/pointerAim.test.ts`, `src/lib/cityArena/render/camera.test.ts` (extend)

**Interfaces:**

- Consumes: `InputState`, `ButtonName` (Task 1); `LOOK_AHEAD_MAX_M`, `LOOK_AHEAD_S`, `CAMERA_EASE_PER_S`, `Camera` (existing).
- Produces: `attachKeyboard(target, state): () => void` now also binds Space → `fire`, E/F/Enter → `enter`, Q → `weaponNext`; `PointerAimTarget`, `PointerAim = { position(): [number, number] | null; detach(): void }`, `attachPointerAim(target, state): PointerAim`; `DRIVING_LOOK_AHEAD_MAX_M = 30`, `updateCamera(camera, target, velocity, dt, maxLookAheadM = LOOK_AHEAD_MAX_M)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/input/keyboard.test.ts  (replaces the Plan 2 file)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInputState } from "./inputState";
import { attachKeyboard } from "./keyboard";

function press(code: string, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
}

function release(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keyup", { code }));
}

describe("attachKeyboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps WASD and arrows to a movement vector and releases on keyup", () => {
    const state = createInputState();
    const detach = attachKeyboard(window, state);
    press("KeyD");
    press("ArrowUp");
    expect(state.snapshot().move[0]).toBeCloseTo(Math.SQRT1_2);
    expect(state.snapshot().move[1]).toBeCloseTo(-Math.SQRT1_2);
    release("KeyD");
    expect(state.snapshot().move).toEqual([0, -1]);
    detach();
    press("KeyA");
    expect(state.snapshot().move).toEqual([0, -1]);
  });

  it("holds Space as fire, E/F/Enter as enter and Q as weapon", () => {
    const state = createInputState();
    const detach = attachKeyboard(window, state);
    press("Space");
    press("KeyE");
    press("KeyQ");
    expect(state.snapshot()).toMatchObject({
      fire: true,
      enter: true,
      weaponNext: true,
    });
    release("Space");
    release("KeyE");
    expect(state.snapshot()).toMatchObject({
      fire: false,
      enter: false,
      weaponNext: true,
    });
    press("KeyF");
    expect(state.snapshot().enter).toBe(true);
    release("KeyF");
    release("KeyQ");
    press("Enter");
    expect(state.snapshot().enter).toBe(true);
    detach();
  });

  it("ignores keys typed into form fields or pressed on a focused button, and resets on blur", () => {
    const state = createInputState();
    const detach = attachKeyboard(window, state);
    const input = document.createElement("input");
    const button = document.createElement("button");
    document.body.append(input, button);
    press("KeyW", input);
    press("Space", button);
    expect(state.snapshot()).toMatchObject({ move: [0, 0], fire: false });
    press("KeyW");
    press("Space");
    expect(state.snapshot()).toMatchObject({ move: [0, -1], fire: true });
    window.dispatchEvent(new Event("blur"));
    expect(state.snapshot()).toMatchObject({ move: [0, 0], fire: false });
    detach();
    input.remove();
    button.remove();
  });
});
```

```ts
// src/lib/cityArena/input/pointerAim.test.ts
import { fireEvent } from "@testing-library/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInputState } from "./inputState";
import { attachPointerAim } from "./pointerAim";

describe("attachPointerAim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tracks the mouse on the canvas and holds fire while the left button is down", () => {
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      right: 310,
      bottom: 220,
      width: 300,
      height: 200,
      toJSON: () => ({}),
    });
    const state = createInputState();
    const aim = attachPointerAim(canvas, state);
    expect(aim.position()).toBeNull();
    fireEvent.pointerMove(canvas, {
      pointerType: "mouse",
      clientX: 110,
      clientY: 70,
    });
    expect(aim.position()).toEqual([100, 50]);
    fireEvent.pointerDown(canvas, {
      pointerType: "mouse",
      button: 0,
      clientX: 110,
      clientY: 70,
    });
    expect(state.snapshot().fire).toBe(true);
    fireEvent.pointerUp(canvas, { pointerType: "mouse", button: 0 });
    expect(state.snapshot().fire).toBe(false);
    fireEvent.pointerLeave(canvas, { pointerType: "mouse" });
    expect(aim.position()).toBeNull();
    aim.detach();
    fireEvent.pointerMove(canvas, {
      pointerType: "mouse",
      clientX: 50,
      clientY: 50,
    });
    expect(aim.position()).toBeNull();
  });

  it("ignores touch pointers and the right button", () => {
    const canvas = document.createElement("canvas");
    const state = createInputState();
    const aim = attachPointerAim(canvas, state);
    fireEvent.pointerMove(canvas, {
      pointerType: "touch",
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerDown(canvas, { pointerType: "touch", button: 0 });
    fireEvent.pointerDown(canvas, { pointerType: "mouse", button: 2 });
    expect(aim.position()).toBeNull();
    expect(state.snapshot().fire).toBe(false);
    aim.detach();
  });
});
```

Append to `src/lib/cityArena/render/camera.test.ts` (add `DRIVING_LOOK_AHEAD_MAX_M` to the import):

```ts
it("leads further ahead when driving asks for the larger cap", () => {
  let camera = createCamera([0, 0], 6);
  for (let step = 0; step < 300; step++)
    camera = updateCamera(
      camera,
      [0, 0],
      [1000, 0],
      1 / 60,
      DRIVING_LOOK_AHEAD_MAX_M,
    );
  expect(camera.x).toBeCloseTo(30, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/input src/lib/cityArena/render/camera.test.ts`
Expected: FAIL — `./pointerAim` not found; `fire` stays `false` after Space; `DRIVING_LOOK_AHEAD_MAX_M` undefined.

- [ ] **Step 3: Implement the bindings and the camera parameter**

```ts
// src/lib/cityArena/input/keyboard.ts
import type { ButtonName, InputState } from "./inputState";

/** The subset of `window` the keyboard binding needs (injectable in tests). */
export type KeyboardTarget = Pick<
  Window,
  "addEventListener" | "removeEventListener"
>;

/** Movement keys (WASD and arrows) and their unit vectors. */
const KEY_VECTORS: Partial<Record<string, [number, number]>> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/** Held buttons by key code (spec §7): Space fires, E/F/Enter enter or leave a car, Q cycles the weapon. */
const KEY_BUTTONS: Partial<Record<string, ButtonName>> = {
  Space: "fire",
  KeyE: "enter",
  KeyF: "enter",
  Enter: "enter",
  KeyQ: "weaponNext",
};

/** True for editable targets whose keystrokes must not steer the game. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/** Sum of the held movement keys, one unit per axis at most. */
function movementVector(pressed: Set<string>): [number, number] {
  let x = 0;
  let y = 0;
  for (const code of pressed) {
    const vector = KEY_VECTORS[code];
    if (!vector) continue;
    x += vector[0];
    y += vector[1];
  }
  return [Math.sign(x), Math.sign(y)];
}

/** Binds WASD/arrows and the Space/E/F/Enter/Q buttons to the input state; returns the detach function. */
export function attachKeyboard(
  target: KeyboardTarget,
  state: InputState,
): () => void {
  const pressed = new Set<string>();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) return;
    if (KEY_VECTORS[event.code]) {
      if (event.code.startsWith("Arrow")) event.preventDefault();
      pressed.add(event.code);
      state.setKeyboard(movementVector(pressed));
      return;
    }
    const button = KEY_BUTTONS[event.code];
    if (!button || event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    state.setButton("keyboard", button, true);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (pressed.delete(event.code)) {
      state.setKeyboard(movementVector(pressed));
      return;
    }
    const button = KEY_BUTTONS[event.code];
    if (button) state.setButton("keyboard", button, false);
  };
  const onBlur = (): void => {
    pressed.clear();
    state.clearKeyboard();
  };
  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", onBlur);
  return () => {
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
    target.removeEventListener("blur", onBlur);
  };
}
```

```ts
// src/lib/cityArena/input/pointerAim.ts
import type { InputState } from "./inputState";

/** The subset of the canvas element the aim binding needs (injectable in tests). */
export type PointerAimTarget = Pick<
  HTMLElement,
  "addEventListener" | "removeEventListener" | "getBoundingClientRect"
>;

/** Live mouse position on the canvas in CSS pixels, plus the detach function. */
export type PointerAim = {
  position(): [number, number] | null;
  detach(): void;
};

/** `PointerEvent.button` of the left mouse button. */
const PRIMARY_BUTTON = 0;

/** Binds mouse movement (aim position) and the left button (fire) on the canvas; touch pointers belong to the stick and the buttons. */
export function attachPointerAim(
  target: PointerAimTarget,
  state: InputState,
): PointerAim {
  let position: [number, number] | null = null;
  const onMove = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    const rect = target.getBoundingClientRect();
    position = [event.clientX - rect.left, event.clientY - rect.top];
  };
  const onDown = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse" || event.button !== PRIMARY_BUTTON)
      return;
    event.preventDefault();
    onMove(event);
    state.setButton("pointer", "fire", true);
  };
  const onUp = (event: PointerEvent): void => {
    if (event.pointerType === "mouse")
      state.setButton("pointer", "fire", false);
  };
  const onLeave = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    position = null;
    state.setButton("pointer", "fire", false);
  };
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerdown", onDown);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", onUp);
  target.addEventListener("pointerleave", onLeave);
  return {
    position: () => position,
    detach() {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerdown", onDown);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      target.removeEventListener("pointerleave", onLeave);
    },
  };
}
```

In `src/lib/cityArena/render/camera.ts`, add the constant and the fifth parameter (the body only swaps `LOOK_AHEAD_MAX_M` for `maxLookAheadM`):

```ts
/** Look-ahead cap while driving; the on-foot cap stays spec §8's 15 m. */
export const DRIVING_LOOK_AHEAD_MAX_M = 30;

/** Eases the camera toward the target plus a velocity look-ahead capped at `maxLookAheadM`. */
export function updateCamera(
  camera: Camera,
  target: Point,
  velocity: Point,
  dt: number,
  maxLookAheadM: number = LOOK_AHEAD_MAX_M,
): Camera {
  let aheadX = velocity[0] * LOOK_AHEAD_S;
  let aheadY = velocity[1] * LOOK_AHEAD_S;
  const aheadLength = Math.hypot(aheadX, aheadY);
  if (aheadLength > maxLookAheadM) {
    aheadX *= maxLookAheadM / aheadLength;
    aheadY *= maxLookAheadM / aheadLength;
  }
  const ease = 1 - Math.exp(-CAMERA_EASE_PER_S * dt);
  return {
    x: camera.x + (target[0] + aheadX - camera.x) * ease,
    y: camera.y + (target[1] + aheadY - camera.y) * ease,
    zoom: camera.zoom,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/input src/lib/cityArena/render/camera.test.ts`
Expected: PASS — keyboard 3, pointerAim 2, inputState 4, touchStick 3, camera 4.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/cityArena/input src/lib/cityArena/render/camera.ts src/lib/cityArena/render/camera.test.ts
git add src/lib/cityArena/input src/lib/cityArena/render/camera.ts src/lib/cityArena/render/camera.test.ts
git commit -m "feat(arena): bind fire, enter and weapon keys, mouse aim and driving look-ahead

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Rendering cars, bullets, effects, the crosshair and the player looks

**Files:**

- Modify: `src/lib/cityArena/render/palette.ts`
- Create: `src/lib/cityArena/render/drawVehicles.ts`
- Create: `src/lib/cityArena/render/drawProjectiles.ts`
- Modify: `src/lib/cityArena/render/drawEntities.ts`
- Modify: `src/lib/cityArena/render/renderScene.ts`
- Test: `src/lib/cityArena/render/drawVehicles.test.ts`, `src/lib/cityArena/render/drawProjectiles.test.ts`, `src/lib/cityArena/render/drawEntities.test.ts` (extend), `src/lib/cityArena/render/renderScene.test.ts` (replace)

**Interfaces:**

- Consumes: `worldToScreen`, `visibleRect`, `Camera`, `Viewport`, `RasterContext`, `createFakeContext`, `drawVisibleChunks`, `WorldDrawSource`, `DrawStats`, `drawZoneRing`, `PLAYER_FILL`, `PLAYER_RING` (existing); `VehicleState`, `BulletState`, `EffectState`, `ArenaPlayerState`, `PlayerState` (Task 1); `VEHICLE_LENGTH_M`, `VEHICLE_WIDTH_M`, `SMOKE_HEALTH`, `createVehicle` (Task 2); `EXPLOSION_RADIUS_M`, `isDead`, `isInvulnerable` (Task 4); `effectProgress` (Task 4); `createArenaPlayer` (Task 6, tests).
- Produces: palette `CAR_BODY_COLOURS` (6), `CAR_WINDOW`, `CAR_HEADLIGHT`, `CAR_WRECK`, `CAR_SMOKE`, `BULLET_STROKE`, `MUZZLE_FILL`, `IMPACT_FILL`, `EXPLOSION_FILL`, `EXPLOSION_RING`, `CROSSHAIR_STROKE`, `PLAYER_DEAD_FILL`, `PLAYER_DEAD_RING`; `drawVehicle(context, camera, viewport, vehicle, tick, occupied)`, `drawVehicles(context, camera, viewport, vehicles, tick, occupiedId)`; `drawBullets(context, camera, viewport, bullets)`, `drawEffects(context, camera, viewport, effects, tick)`, `drawCrosshair(context, point)`; `PlayerStyle`, `DEFAULT_PLAYER_STYLE`, `DEAD_PLAYER_STYLE`, `PlayerLook`, `playerLook(player, tick)`, `drawPlayer(context, camera, viewport, player, style = DEFAULT_PLAYER_STYLE)`; `Scene = { world; zone; player: ArenaPlayerState; vehicles; bullets; effects; tick; aimScreen: [number, number] | null; pushIn: number }`, `renderScene` unchanged in signature.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/render/drawVehicles.test.ts
import { describe, expect, it } from "vitest";
import { createVehicle } from "../sim/vehicle";
import { createCamera } from "./camera";
import { drawVehicle, drawVehicles } from "./drawVehicles";
import { PLAYER_RING } from "./palette";
import { createFakeContext } from "./testing/fakeContext";

const camera = createCamera([10, 10], 8);
const viewport = { width: 200, height: 100 };

describe("drawVehicles", () => {
  it("draws a rotated body with a window and two headlights", () => {
    const context = createFakeContext();
    const car = createVehicle(1, "sedan", [12, 10], Math.PI / 2, 2);
    drawVehicle(context, camera, viewport, car, 0, false);
    expect(context.calls).toContain("translate(116,50)");
    expect(context.calls).toContain("rotate(1.57)");
    expect(context.calls).toContain("fillRect(-16.8,-7.2,33.6,14.4)");
    expect(
      context.calls.filter((call) => call.startsWith("fillRect")),
    ).toHaveLength(4);
    expect(context.calls[context.calls.length - 1]).toBe("restore()");
  });

  it("draws a wreck as one dark slab and three smoke puffs on a damaged car", () => {
    const context = createFakeContext();
    const wreck = {
      ...createVehicle(1, "sedan", [10, 10], 0, 0),
      wrecked: true,
      health: 0,
    };
    drawVehicle(context, camera, viewport, wreck, 0, false);
    expect(
      context.calls.filter((call) => call.startsWith("fillRect")),
    ).toHaveLength(1);
    expect(context.calls.some((call) => call.startsWith("arc("))).toBe(false);
    const smokeContext = createFakeContext();
    const smoking = {
      ...createVehicle(2, "sedan", [10, 10], 0, 0),
      health: 30,
    };
    drawVehicle(smokeContext, camera, viewport, smoking, 5, false);
    expect(
      smokeContext.calls.filter((call) => call.startsWith("arc(")),
    ).toHaveLength(3);
  });

  it("rings the occupied car and skips cars far outside the view", () => {
    const context = createFakeContext();
    const cars = [
      createVehicle(1, "sedan", [10, 10], 0, 0),
      createVehicle(2, "sedan", [500, 500], 0, 0),
    ];
    drawVehicles(context, camera, viewport, cars, 0, 1);
    expect(
      context.calls.filter((call) => call.startsWith("translate(")),
    ).toHaveLength(1);
    expect(context.calls).toContain(`stroke(${PLAYER_RING},2)`);
  });
});
```

```ts
// src/lib/cityArena/render/drawProjectiles.test.ts
import { describe, expect, it } from "vitest";
import type { BulletState } from "../sim/types";
import { createCamera } from "./camera";
import { drawBullets, drawCrosshair, drawEffects } from "./drawProjectiles";
import {
  BULLET_STROKE,
  CROSSHAIR_STROKE,
  EXPLOSION_RING,
  MUZZLE_FILL,
} from "./palette";
import { createFakeContext } from "./testing/fakeContext";

const camera = createCamera([10, 10], 8);
const viewport = { width: 200, height: 100 };
const bullet: BulletState = {
  id: 1,
  ownerId: 0,
  ignoreVehicleId: null,
  x: 12,
  y: 10,
  directionX: 1,
  directionY: 0,
  speedMps: 120,
  rangeLeftM: 10,
  damage: 20,
  weapon: "pistol",
};

describe("drawProjectiles", () => {
  it("draws tracers behind bullets", () => {
    const context = createFakeContext();
    drawBullets(context, camera, viewport, [bullet]);
    expect(context.calls).toContain("moveTo(109.6,50)");
    expect(context.calls).toContain("lineTo(116,50)");
    expect(context.calls).toContain(`stroke(${BULLET_STROKE},2)`);
  });

  it("draws a muzzle flash ahead of the shooter and a growing, fading explosion", () => {
    const context = createFakeContext();
    drawEffects(
      context,
      camera,
      viewport,
      [
        {
          id: 1,
          kind: "muzzle",
          x: 10,
          y: 10,
          angle: 0,
          bornTick: 0,
          ttlTicks: 2,
        },
        {
          id: 2,
          kind: "impact",
          x: 10,
          y: 10,
          angle: 0,
          bornTick: 0,
          ttlTicks: 6,
        },
        {
          id: 3,
          kind: "explosion",
          x: 10,
          y: 10,
          angle: 0,
          bornTick: 0,
          ttlTicks: 18,
        },
      ],
      9,
    );
    expect(context.calls).toContain("arc(104.8,50,2.8,0,6.28,false)");
    expect(context.calls).toContain(`fill(${MUZZLE_FILL})`);
    expect(context.calls).toContain("arc(100,50,12,0,6.28,false)");
    expect(context.calls).toContain(`stroke(${EXPLOSION_RING},3)`);
  });

  it("draws the crosshair at the pointer", () => {
    const context = createFakeContext();
    drawCrosshair(context, [50, 40]);
    expect(context.calls).toContain("arc(50,40,8,0,6.28,false)");
    expect(context.calls).toContain("moveTo(39,40)");
    expect(context.calls).toContain(`stroke(${CROSSHAIR_STROKE},1.5)`);
  });
});
```

Append to `src/lib/cityArena/render/drawEntities.test.ts` (imports: `createArenaPlayer` from `../sim/arena`, `DEAD_PLAYER_STYLE`, `playerLook` from `./drawEntities`, `PLAYER_DEAD_FILL` from `./palette`):

```ts
it("classifies the player look by car, death and the shield blink", () => {
  const player = createArenaPlayer([0, 0], 0);
  expect(playerLook(player, 10)).toBe("normal");
  expect(playerLook({ ...player, vehicleId: 3 }, 10)).toBe("hidden");
  expect(playerLook({ ...player, health: 0, diedAtTick: 5 }, 10)).toBe("dead");
  const shielded = { ...player, invulnerableUntilTick: 60 };
  expect(playerLook(shielded, 3)).toBe("normal");
  expect(playerLook(shielded, 4)).toBe("blink");
  expect(playerLook(shielded, 60)).toBe("normal");
});

it("draws a dead body in grey", () => {
  const context = createFakeContext();
  drawPlayer(
    context,
    createCamera([10, 10], 8),
    { width: 200, height: 100 },
    { x: 12, y: 10, facing: 0, speed: 0 },
    DEAD_PLAYER_STYLE,
  );
  expect(context.calls).toContain(`fill(${PLAYER_DEAD_FILL})`);
});
```

```ts
// src/lib/cityArena/render/renderScene.test.ts  (replaces the Plan 2 file)
import { describe, expect, it } from "vitest";
import { createArenaPlayer } from "../sim/arena";
import type { BulletState } from "../sim/types";
import { createVehicle } from "../sim/vehicle";
import { createCamera } from "./camera";
import type { LandmarkLookup } from "./drawStatic";
import {
  BULLET_STROKE,
  CROSSHAIR_STROKE,
  MUZZLE_FILL,
  PLAYER_FILL,
} from "./palette";
import { renderScene, type Scene } from "./renderScene";
import { createStaticRaster } from "./staticRaster";
import { createFakeContext } from "./testing/fakeContext";

const bullet: BulletState = {
  id: 2,
  ownerId: 0,
  ignoreVehicleId: null,
  x: 2,
  y: 0,
  directionX: 1,
  directionY: 0,
  speedMps: 120,
  rangeLeftM: 10,
  damage: 20,
  weapon: "pistol",
};

function sceneWith(partial: Partial<Scene>): Scene {
  const landmarks: LandmarkLookup = new Map();
  return {
    world: {
      raster: createStaticRaster(() => null),
      tiles: [],
      landmarks,
      loadedTileRects: [],
    },
    zone: null,
    player: createArenaPlayer([0, 0], 0),
    vehicles: [createVehicle(1, "sedan", [5, 0], 0, 0)],
    bullets: [bullet],
    effects: [
      { id: 3, kind: "muzzle", x: 0, y: 0, angle: 0, bornTick: 0, ttlTicks: 2 },
    ],
    tick: 1,
    aimScreen: [30, 20],
    pushIn: 1.05,
    ...partial,
  };
}

const viewport = {
  rect: { x: 10, y: 20, width: 100, height: 50 },
  camera: createCamera([0, 0], 4),
};

describe("renderScene", () => {
  it("clips, pushes in, draws world → cars → bullets → effects → player → crosshair and restores", () => {
    const context = createFakeContext();
    const stats = renderScene(context, viewport, sceneWith({}));
    const calls = context.calls;
    const order = [
      calls.findIndex((call) => call.startsWith("rotate(")),
      calls.indexOf(`stroke(${BULLET_STROKE},2)`),
      calls.indexOf(`fill(${MUZZLE_FILL})`),
      calls.indexOf(`fill(${PLAYER_FILL})`),
      calls.indexOf(`stroke(${CROSSHAIR_STROKE},1.5)`),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    expect(calls[0]).toBe("save()");
    expect(calls).toContain("rect(10,20,100,50)");
    expect(calls).toContain("clip()");
    expect(calls).toContain("scale(1.05,1.05)");
    expect(calls[calls.length - 1]).toBe("restore()");
    expect(stats.missing).toBeGreaterThan(0);
  });

  it("hides the player inside a car and skips the push-in at 1", () => {
    const context = createFakeContext();
    const player = { ...createArenaPlayer([5, 0], 0), vehicleId: 1 };
    renderScene(
      context,
      viewport,
      sceneWith({ player, pushIn: 1, aimScreen: null }),
    );
    expect(context.calls).not.toContain(`fill(${PLAYER_FILL})`);
    expect(context.calls.some((call) => call.startsWith("scale("))).toBe(false);
    expect(context.calls).not.toContain(`stroke(${CROSSHAIR_STROKE},1.5)`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/render`
Expected: FAIL — `./drawVehicles` and `./drawProjectiles` not found; `playerLook` and `DEAD_PLAYER_STYLE` are not exported; `renderScene` rejects the new scene fields.

- [ ] **Step 3: Extend the palette and add the vehicle painter**

Append to `src/lib/cityArena/render/palette.ts`:

```ts
/** Car body colours indexed by `VehicleState.colour` (six entries, matching `VEHICLE_COLOUR_COUNT`). */
export const CAR_BODY_COLOURS: string[] = [
  "#c0392b",
  "#2e86de",
  "#f1c40f",
  "#27ae60",
  "#8e44ad",
  "#ecf0f1",
];
/** Car window glass. */
export const CAR_WINDOW = "#1b2631";
/** Headlight lenses. */
export const CAR_HEADLIGHT = "#fff3b0";
/** Burnt-out wreck. */
export const CAR_WRECK = "#3d3d3d";
/** Smoke puffs of a damaged car. */
export const CAR_SMOKE = "rgba(90,90,90,0.55)";
/** Bullet tracer. */
export const BULLET_STROKE = "#fff8dc";
/** Muzzle flash. */
export const MUZZLE_FILL = "#ffd54a";
/** Impact dot. */
export const IMPACT_FILL = "#f5f5f5";
/** Explosion disc. */
export const EXPLOSION_FILL = "rgba(255,140,0,0.8)";
/** Explosion ring. */
export const EXPLOSION_RING = "#ff5722";
/** Mouse crosshair. */
export const CROSSHAIR_STROKE = "rgba(255,255,255,0.9)";
/** Body of a player waiting to respawn. */
export const PLAYER_DEAD_FILL = "#6b6b6b";
/** Outline of a dead body. */
export const PLAYER_DEAD_RING = "#3a3a3a";
```

```ts
// src/lib/cityArena/render/drawVehicles.ts
import type { VehicleState } from "../sim/types";
import {
  SMOKE_HEALTH,
  VEHICLE_LENGTH_M,
  VEHICLE_WIDTH_M,
} from "../sim/vehicle";
import {
  visibleRect,
  worldToScreen,
  type Camera,
  type Viewport,
} from "./camera";
import type { RasterContext } from "./canvasTypes";
import {
  CAR_BODY_COLOURS,
  CAR_HEADLIGHT,
  CAR_SMOKE,
  CAR_WINDOW,
  CAR_WRECK,
  PLAYER_RING,
} from "./palette";

/** Window glass size along the body, metres. */
const WINDOW_LENGTH_M = 1.4;
/** Window glass size across the body, metres. */
const WINDOW_WIDTH_M = 1.4;
/** Window centre offset toward the front, metres. */
const WINDOW_OFFSET_M = 0.3;
/** Headlight square size, metres. */
const HEADLIGHT_SIZE_M = 0.3;
/** Outline width of the occupied car, screen pixels. */
const OCCUPIED_RING_WIDTH_PX = 2;
/** Smoke puffs drawn behind a damaged car. */
const SMOKE_PUFFS = 3;
/** Base radius of a smoke puff, metres. */
const SMOKE_RADIUS_M = 0.6;
/** Spacing between puffs along the trail, metres. */
const SMOKE_SPACING_M = 0.9;
/** Ticks per drift cycle of the smoke trail. */
const SMOKE_DRIFT_TICKS = 20;
/** Cars within this margin outside the view are still drawn, metres. */
const CULL_MARGIN_M = 5;

/** Fills a car-local rectangle centred at (forward, right); the context is already in the car frame. */
function fillLocalRect(
  context: RasterContext,
  zoom: number,
  forward: number,
  right: number,
  length: number,
  width: number,
  fill: string,
): void {
  context.fillStyle = fill;
  context.fillRect(
    (forward - length / 2) * zoom,
    (right - width / 2) * zoom,
    length * zoom,
    width * zoom,
  );
}

/** Body, window and headlights of an intact car, or one dark slab for a wreck. */
function drawBody(
  context: RasterContext,
  vehicle: VehicleState,
  zoom: number,
): void {
  const fill = vehicle.wrecked
    ? CAR_WRECK
    : CAR_BODY_COLOURS[vehicle.colour % CAR_BODY_COLOURS.length];
  fillLocalRect(context, zoom, 0, 0, VEHICLE_LENGTH_M, VEHICLE_WIDTH_M, fill);
  if (vehicle.wrecked) return;
  fillLocalRect(
    context,
    zoom,
    WINDOW_OFFSET_M,
    0,
    WINDOW_LENGTH_M,
    WINDOW_WIDTH_M,
    CAR_WINDOW,
  );
  const front = VEHICLE_LENGTH_M / 2 - HEADLIGHT_SIZE_M / 2;
  const side = VEHICLE_WIDTH_M / 2 - HEADLIGHT_SIZE_M / 2;
  fillLocalRect(
    context,
    zoom,
    front,
    -side,
    HEADLIGHT_SIZE_M,
    HEADLIGHT_SIZE_M,
    CAR_HEADLIGHT,
  );
  fillLocalRect(
    context,
    zoom,
    front,
    side,
    HEADLIGHT_SIZE_M,
    HEADLIGHT_SIZE_M,
    CAR_HEADLIGHT,
  );
}

/** Grey puffs trailing behind a damaged car, drifting with the tick. */
function drawSmoke(context: RasterContext, zoom: number, tick: number): void {
  context.fillStyle = CAR_SMOKE;
  for (let puff = 0; puff < SMOKE_PUFFS; puff++) {
    const drift = ((tick + puff * 7) % SMOKE_DRIFT_TICKS) / SMOKE_DRIFT_TICKS;
    const forward = -VEHICLE_LENGTH_M / 2 - (puff + drift) * SMOKE_SPACING_M;
    context.beginPath();
    context.arc(
      forward * zoom,
      0,
      SMOKE_RADIUS_M * (1 + drift) * zoom,
      0,
      Math.PI * 2,
      false,
    );
    context.fill();
  }
}

/** Outline around the car the player sits in. */
function drawOccupiedRing(context: RasterContext, zoom: number): void {
  context.strokeStyle = PLAYER_RING;
  context.lineWidth = OCCUPIED_RING_WIDTH_PX;
  context.setLineDash([]);
  context.beginPath();
  context.rect(
    (-VEHICLE_LENGTH_M / 2) * zoom,
    (-VEHICLE_WIDTH_M / 2) * zoom,
    VEHICLE_LENGTH_M * zoom,
    VEHICLE_WIDTH_M * zoom,
  );
  context.stroke();
}

/** Draws one car in its own frame: body, smoke when damaged, and the occupant ring. */
export function drawVehicle(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  vehicle: VehicleState,
  tick: number,
  occupied: boolean,
): void {
  const [x, y] = worldToScreen(camera, viewport, [vehicle.x, vehicle.y]);
  context.save();
  context.translate(x, y);
  context.rotate(vehicle.heading);
  drawBody(context, vehicle, camera.zoom);
  if (!vehicle.wrecked && vehicle.health < SMOKE_HEALTH)
    drawSmoke(context, camera.zoom, tick);
  if (occupied) drawOccupiedRing(context, camera.zoom);
  context.restore();
}

/** Draws every car near the view; `occupiedId` gets the ring. */
export function drawVehicles(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  vehicles: VehicleState[],
  tick: number,
  occupiedId: number | null,
): void {
  const view = visibleRect(camera, viewport);
  for (const vehicle of vehicles) {
    const outside =
      vehicle.x < view.minX - CULL_MARGIN_M ||
      vehicle.x > view.maxX + CULL_MARGIN_M ||
      vehicle.y < view.minY - CULL_MARGIN_M ||
      vehicle.y > view.maxY + CULL_MARGIN_M;
    if (outside) continue;
    drawVehicle(
      context,
      camera,
      viewport,
      vehicle,
      tick,
      vehicle.id === occupiedId,
    );
  }
}
```

- [ ] **Step 4: Add the projectile painter**

```ts
// src/lib/cityArena/render/drawProjectiles.ts
import { EXPLOSION_RADIUS_M } from "../sim/damage";
import { effectProgress } from "../sim/effects";
import type { BulletState, EffectState } from "../sim/types";
import type { Point } from "../world/projection";
import { worldToScreen, type Camera, type Viewport } from "./camera";
import type { RasterContext } from "./canvasTypes";
import {
  BULLET_STROKE,
  CROSSHAIR_STROKE,
  EXPLOSION_FILL,
  EXPLOSION_RING,
  IMPACT_FILL,
  MUZZLE_FILL,
} from "./palette";

/** Tracer length behind a bullet, metres. */
const TRACER_LENGTH_M = 0.8;
/** Tracer line width, screen pixels. */
const TRACER_WIDTH_PX = 2;
/** Muzzle flash offset from the shooter along the aim, metres. */
const MUZZLE_OFFSET_M = 0.6;
/** Muzzle flash radius, metres. */
const MUZZLE_RADIUS_M = 0.35;
/** Impact dot radius at birth, metres. */
const IMPACT_RADIUS_M = 0.25;
/** Explosion ring width, screen pixels. */
const EXPLOSION_RING_WIDTH_PX = 3;
/** Crosshair circle radius, screen pixels. */
const CROSSHAIR_RADIUS_PX = 8;
/** Gap between the crosshair circle and its ticks, screen pixels. */
const CROSSHAIR_GAP_PX = 3;
/** Crosshair line width, screen pixels. */
const CROSSHAIR_WIDTH_PX = 1.5;

/** Short tracer lines trailing each bullet. */
export function drawBullets(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  bullets: BulletState[],
): void {
  if (bullets.length === 0) return;
  context.strokeStyle = BULLET_STROKE;
  context.lineWidth = TRACER_WIDTH_PX;
  context.setLineDash([]);
  context.beginPath();
  for (const bullet of bullets) {
    const [x, y] = worldToScreen(camera, viewport, [bullet.x, bullet.y]);
    const [tailX, tailY] = worldToScreen(camera, viewport, [
      bullet.x - bullet.directionX * TRACER_LENGTH_M,
      bullet.y - bullet.directionY * TRACER_LENGTH_M,
    ]);
    context.moveTo(tailX, tailY);
    context.lineTo(x, y);
  }
  context.stroke();
}

/** A filled circle at a world point with a radius in metres. */
function fillCircle(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  point: Point,
  radiusM: number,
  fill: string,
): void {
  const [x, y] = worldToScreen(camera, viewport, point);
  context.beginPath();
  context.arc(x, y, radiusM * camera.zoom, 0, Math.PI * 2, false);
  context.fillStyle = fill;
  context.fill();
}

/** Muzzle flash ahead of the shooter, a shrinking impact dot, or an expanding, fading explosion. */
function drawEffect(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  effect: EffectState,
  tick: number,
): void {
  const progress = effectProgress(effect, tick);
  if (effect.kind === "muzzle") {
    const flash: Point = [
      effect.x + Math.cos(effect.angle) * MUZZLE_OFFSET_M,
      effect.y + Math.sin(effect.angle) * MUZZLE_OFFSET_M,
    ];
    fillCircle(context, camera, viewport, flash, MUZZLE_RADIUS_M, MUZZLE_FILL);
    return;
  }
  if (effect.kind === "impact") {
    const radius = IMPACT_RADIUS_M * (1 - progress / 2);
    fillCircle(
      context,
      camera,
      viewport,
      [effect.x, effect.y],
      radius,
      IMPACT_FILL,
    );
    return;
  }
  context.save();
  context.globalAlpha = 1 - progress;
  const radius = EXPLOSION_RADIUS_M * progress;
  fillCircle(
    context,
    camera,
    viewport,
    [effect.x, effect.y],
    radius,
    EXPLOSION_FILL,
  );
  context.strokeStyle = EXPLOSION_RING;
  context.lineWidth = EXPLOSION_RING_WIDTH_PX;
  context.setLineDash([]);
  context.stroke();
  context.restore();
}

/** Draws every live effect. */
export function drawEffects(
  context: RasterContext,
  camera: Camera,
  viewport: Viewport,
  effects: EffectState[],
  tick: number,
): void {
  for (const effect of effects)
    drawEffect(context, camera, viewport, effect, tick);
}

/** Mouse crosshair at a screen point: a circle with four ticks. */
export function drawCrosshair(
  context: RasterContext,
  point: [number, number],
): void {
  const [x, y] = point;
  const outer = CROSSHAIR_RADIUS_PX + CROSSHAIR_GAP_PX;
  context.strokeStyle = CROSSHAIR_STROKE;
  context.lineWidth = CROSSHAIR_WIDTH_PX;
  context.setLineDash([]);
  context.beginPath();
  context.arc(x, y, CROSSHAIR_RADIUS_PX, 0, Math.PI * 2, false);
  context.moveTo(x - outer, y);
  context.lineTo(x - CROSSHAIR_GAP_PX, y);
  context.moveTo(x + CROSSHAIR_GAP_PX, y);
  context.lineTo(x + outer, y);
  context.moveTo(x, y - outer);
  context.lineTo(x, y - CROSSHAIR_GAP_PX);
  context.moveTo(x, y + CROSSHAIR_GAP_PX);
  context.lineTo(x, y + outer);
  context.stroke();
}
```

- [ ] **Step 5: Give the player a style and a look, and extend the scene**

In `src/lib/cityArena/render/drawEntities.ts` add the imports `isDead`, `isInvulnerable` from `../sim/damage`, `ArenaPlayerState` from `../sim/types`, `PLAYER_DEAD_FILL`, `PLAYER_DEAD_RING` from `./palette`, then add:

```ts
/** Colours of the player sprite. */
export type PlayerStyle = { fill: string; ring: string };
/** The living player. */
export const DEFAULT_PLAYER_STYLE: PlayerStyle = {
  fill: PLAYER_FILL,
  ring: PLAYER_RING,
};
/** A body waiting to respawn. */
export const DEAD_PLAYER_STYLE: PlayerStyle = {
  fill: PLAYER_DEAD_FILL,
  ring: PLAYER_DEAD_RING,
};
/** How the player is drawn this frame. */
export type PlayerLook = "normal" | "dead" | "hidden" | "blink";
/** Ticks per half-period of the invulnerability blink. */
const BLINK_HALF_PERIOD_TICKS = 4;

/** Hidden inside a car, a body while dead, invisible every other 4 ticks while shielded, else normal. */
export function playerLook(player: ArenaPlayerState, tick: number): PlayerLook {
  if (player.vehicleId !== null) return "hidden";
  if (isDead(player)) return "dead";
  const blinkPhase = Math.floor(tick / BLINK_HALF_PERIOD_TICKS) % 2;
  if (isInvulnerable(player, tick) && blinkPhase === 1) return "blink";
  return "normal";
}
```

and give `drawPlayer` a trailing `style: PlayerStyle = DEFAULT_PLAYER_STYLE` parameter, replacing `PLAYER_FILL` with `style.fill` and `PLAYER_RING` with `style.ring` in its body (the JSDoc becomes "Draws the local player: a filled circle, a coloured outline ring and a facing tick, in the given style.").

```ts
// src/lib/cityArena/render/renderScene.ts
import type {
  ArenaPlayerState,
  BulletState,
  EffectState,
  VehicleState,
} from "../sim/types";
import type { MapZone } from "../world/mapTypes";
import type { Camera, Viewport } from "./camera";
import type { RasterContext } from "./canvasTypes";
import {
  DEAD_PLAYER_STYLE,
  DEFAULT_PLAYER_STYLE,
  drawPlayer,
  drawZoneRing,
  playerLook,
} from "./drawEntities";
import { drawBullets, drawCrosshair, drawEffects } from "./drawProjectiles";
import { drawVehicles } from "./drawVehicles";
import {
  drawVisibleChunks,
  type DrawStats,
  type WorldDrawSource,
} from "./drawWorld";

/** A rectangle of the canvas (CSS px) rendered through one camera — several of these make a split screen. */
export type SceneViewport = {
  rect: { x: number; y: number; width: number; height: number };
  camera: Camera;
};

/** Everything drawn for one viewport; `pushIn` (1 = none) zooms around the centre for the death screen. */
export type Scene = {
  world: WorldDrawSource;
  zone: MapZone | null;
  player: ArenaPlayerState;
  vehicles: VehicleState[];
  bullets: BulletState[];
  effects: EffectState[];
  tick: number;
  aimScreen: [number, number] | null;
  pushIn: number;
};

/** Scales the viewport around its centre by `pushIn`. */
function applyPushIn(
  context: RasterContext,
  size: Viewport,
  pushIn: number,
): void {
  if (pushIn === 1) return;
  context.translate(size.width / 2, size.height / 2);
  context.scale(pushIn, pushIn);
  context.translate(-size.width / 2, -size.height / 2);
}

/** Draws the player unless hidden in a car or in the off half of the shield blink. */
function drawPlayerLook(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  scene: Scene,
): void {
  const look = playerLook(scene.player, scene.tick);
  if (look === "hidden" || look === "blink") return;
  const style = look === "dead" ? DEAD_PLAYER_STYLE : DEFAULT_PLAYER_STYLE;
  drawPlayer(context, camera, size, scene.player, style);
}

/**
 * Renders one viewport: clips to its rect, translates into its local space, applies the push-in,
 * then draws world chunks → zone ring → cars → bullets → effects → player → crosshair and restores.
 */
export function renderScene(
  context: RasterContext,
  viewport: SceneViewport,
  scene: Scene,
): DrawStats {
  const { rect, camera } = viewport;
  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
  context.translate(rect.x, rect.y);
  const size = { width: rect.width, height: rect.height };
  applyPushIn(context, size, scene.pushIn);
  const stats = drawVisibleChunks(context, camera, size, scene.world);
  if (scene.zone) drawZoneRing(context, camera, size, scene.zone);
  drawVehicles(
    context,
    camera,
    size,
    scene.vehicles,
    scene.tick,
    scene.player.vehicleId,
  );
  drawBullets(context, camera, size, scene.bullets);
  drawEffects(context, camera, size, scene.effects, scene.tick);
  drawPlayerLook(context, camera, size, scene);
  if (scene.aimScreen) drawCrosshair(context, scene.aimScreen);
  context.restore();
  return stats;
}
```

Keep the hook compiling until Task 12 rewrites it: in `src/components/cityArena/useArenaGame.ts` add `import { createArenaPlayer } from "@/lib/cityArena/sim/arena";` and change the scene literal inside `paintCanvas` to the interim shape below (the free-roam player is wrapped in a full `ArenaPlayerState`; the other fields are empty until the arena state arrives).

```ts
    {
      world: {
        raster: session.raster,
        tiles: session.tiles(),
        landmarks: session.landmarks(),
        loadedTileRects: session.loadedTileRects(),
      },
      zone,
      player: {
        ...createArenaPlayer([state.player.x, state.player.y], state.tick),
        facing: state.player.facing,
        speed: state.player.speed,
      },
      vehicles: [],
      bullets: [],
      effects: [],
      tick: state.tick,
      aimScreen: null,
      pushIn: 1,
    },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/render`
Expected: PASS — drawVehicles 3, drawProjectiles 3, drawEntities 4, renderScene 2, plus the unchanged raster/label/world suites. Worked numbers: at zoom 8 the 4.2 × 1.8 m body is `fillRect(-16.8,-7.2,33.6,14.4)`; the muzzle flash sits 0.6 m ahead → 100 + 4.8 px with radius 0.35 × 8 = 2.8 px; the explosion at tick 9 of 18 has progress 0.5 → 3 m × 0.5 × 8 = 12 px.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/cityArena/render
git add src/lib/cityArena/render
git commit -m "feat(arena): draw cars, bullets, effects, the crosshair and player looks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The death screen — pure beat function, `DeathOverlay` and the slam keyframes

**Files:**

- Create: `src/lib/cityArena/render/deathScreen.ts`
- Create: `src/components/cityArena/DeathOverlay.tsx`
- Modify: `src/app/globals.css` (two `@keyframes` blocks)
- Test: `src/lib/cityArena/render/deathScreen.test.ts`, `src/components/cityArena/DeathOverlay.test.tsx`

**Interfaces:**

- Consumes: nothing from the simulation — the beats are a function of wall-clock seconds since the death (spec §7).
- Produces: `DEATH_SLOWMO_END_S = 0.3`, `DEATH_SLAM_END_S = 0.55`, `DEATH_FADE_START_S = 2.6`, `DEATH_END_S = 3.0`, `DEATH_SLOWMO_TIME_SCALE = 0.25`, `DEATH_PUSH_IN_MAX = 1.08`, `DeathScreenStage = "slowmo" | "art" | "fade" | "black"`, `DeathScreenPhase = { stage; timeScale; pushIn; artVisible; artScale; blackout }`, `deathScreenPhase(elapsedS, reducedMotion): DeathScreenPhase`; `WASTED_WEBP`, `WASTED_JPG`, `WASTED_ALT = "Je bent uitgeschakeld"`, `DeathOverlayProps = { diedAtMs: number; reducedMotion: boolean; now?: () => number }`, `<DeathOverlay />` default export; CSS keyframes `arena-wasted-slam`, `arena-wasted-fade`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/render/deathScreen.test.ts
import { describe, expect, it } from "vitest";
import { deathScreenPhase } from "./deathScreen";

describe("deathScreenPhase", () => {
  it("runs slow motion with a push-in for the first 0.3 s", () => {
    const phase = deathScreenPhase(0.1, false);
    expect(phase).toMatchObject({
      stage: "slowmo",
      timeScale: 0.25,
      artVisible: false,
      blackout: 0,
    });
    expect(phase.pushIn).toBeCloseTo(1.0267, 3);
    expect(deathScreenPhase(-1, false).stage).toBe("slowmo");
  });

  it("slams the artwork in from 1.15× with an overshoot and settles by 0.55 s", () => {
    expect(deathScreenPhase(0.3, false)).toMatchObject({
      stage: "art",
      timeScale: 1,
      pushIn: 1.08,
      artVisible: true,
    });
    expect(deathScreenPhase(0.3, false).artScale).toBeCloseTo(1.15);
    expect(deathScreenPhase(0.425, false).artScale).toBeCloseTo(0.947, 2);
    expect(deathScreenPhase(0.55, false).artScale).toBe(1);
    expect(deathScreenPhase(1.5, false).artScale).toBe(1);
  });

  it("fades to black between 2.6 s and 3.0 s and stays black", () => {
    expect(deathScreenPhase(2.8, false)).toMatchObject({
      stage: "fade",
      blackout: 0.5,
    });
    expect(deathScreenPhase(3, false)).toMatchObject({
      stage: "black",
      blackout: 1,
    });
    expect(deathScreenPhase(9, false)).toMatchObject({
      stage: "black",
      blackout: 1,
    });
  });

  it("skips slow motion, push-in and overshoot under reduced motion", () => {
    expect(deathScreenPhase(0.1, true)).toMatchObject({
      stage: "slowmo",
      timeScale: 1,
      pushIn: 1,
    });
    expect(deathScreenPhase(0.35, true)).toMatchObject({
      stage: "art",
      pushIn: 1,
      artScale: 1,
    });
  });
});
```

```tsx
// src/components/cityArena/DeathOverlay.test.tsx
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeathOverlay, { WASTED_ALT } from "./DeathOverlay";

describe("DeathOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("walks through slow motion, the artwork slam, the fade and black", () => {
    render(
      <DeathOverlay
        diedAtMs={Date.now()}
        reducedMotion={false}
        now={() => Date.now()}
      />,
    );
    const overlay = screen.getByTestId("death-overlay");
    expect(overlay).toHaveAttribute("data-stage", "slowmo");
    expect(screen.queryByAltText(WASTED_ALT)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(overlay).toHaveAttribute("data-stage", "art");
    const artwork = screen.getByAltText(WASTED_ALT);
    expect(artwork).toHaveAttribute("src", "/branding/wasted-screen.jpg");
    expect(artwork.className).toContain("arena-wasted-slam");
    act(() => {
      vi.advanceTimersByTime(2450);
    });
    expect(overlay).toHaveAttribute("data-stage", "fade");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(overlay).toHaveAttribute("data-stage", "black");
  });

  it("fades the artwork in instead of slamming under reduced motion", () => {
    render(
      <DeathOverlay
        diedAtMs={Date.now()}
        reducedMotion
        now={() => Date.now()}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByAltText(WASTED_ALT).className).toContain(
      "arena-wasted-fade",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/render/deathScreen.test.ts src/components/cityArena/DeathOverlay.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the beat function**

```ts
// src/lib/cityArena/render/deathScreen.ts
/** Seconds of slow motion, desaturation and push-in before the artwork lands (spec §7). */
export const DEATH_SLOWMO_END_S = 0.3;
/** Seconds at which the slam (1.15× → 1× with overshoot) has settled. */
export const DEATH_SLAM_END_S = 0.55;
/** Seconds at which the fade to black starts (spec §7). */
export const DEATH_FADE_START_S = 2.6;
/** Seconds at which the screen is fully black; equals the respawn delay (spec §7). */
export const DEATH_END_S = 3.0;
/** Simulation time scale during the slow-motion beat (spec §7: 0.25×). */
export const DEATH_SLOWMO_TIME_SCALE = 0.25;
/** Camera push-in reached at the end of the slow-motion beat. */
export const DEATH_PUSH_IN_MAX = 1.08;
/** Starting scale of the artwork slam (spec §7: 1.15×). */
const SLAM_START_SCALE = 1.15;
/** Cosine turns over the slam: 1.5 turns dips 5 % below 1 at two thirds, then settles at 1. */
const SLAM_OVERSHOOT_TURNS = 1.5;

/** The four beats of the death screen. */
export type DeathScreenStage = "slowmo" | "art" | "fade" | "black";

/** Everything the frame loop and the overlay need for one instant of the death screen. */
export type DeathScreenPhase = {
  stage: DeathScreenStage;
  timeScale: number;
  pushIn: number;
  artVisible: boolean;
  artScale: number;
  blackout: number;
};

/** Artwork scale during the slam: 1.15 at 0.3 s, a 0.95 dip, 1 from 0.55 s; 1 throughout under reduced motion. */
function slamScale(elapsedS: number, reducedMotion: boolean): number {
  if (reducedMotion || elapsedS >= DEATH_SLAM_END_S) return 1;
  const progress =
    (elapsedS - DEATH_SLOWMO_END_S) / (DEATH_SLAM_END_S - DEATH_SLOWMO_END_S);
  return (
    1 +
    (SLAM_START_SCALE - 1) *
      (1 - progress) *
      Math.cos(SLAM_OVERSHOOT_TURNS * Math.PI * progress)
  );
}

/** Pure beat function of the seconds since the death tick (spec §7); negative input counts as 0. */
export function deathScreenPhase(
  elapsedS: number,
  reducedMotion: boolean,
): DeathScreenPhase {
  const elapsed = Math.max(0, elapsedS);
  if (elapsed < DEATH_SLOWMO_END_S) {
    const progress = elapsed / DEATH_SLOWMO_END_S;
    return {
      stage: "slowmo",
      timeScale: reducedMotion ? 1 : DEATH_SLOWMO_TIME_SCALE,
      pushIn: reducedMotion ? 1 : 1 + (DEATH_PUSH_IN_MAX - 1) * progress,
      artVisible: false,
      artScale: 1,
      blackout: 0,
    };
  }
  const pushIn = reducedMotion ? 1 : DEATH_PUSH_IN_MAX;
  const artScale = slamScale(elapsed, reducedMotion);
  if (elapsed < DEATH_FADE_START_S)
    return {
      stage: "art",
      timeScale: 1,
      pushIn,
      artVisible: true,
      artScale,
      blackout: 0,
    };
  if (elapsed < DEATH_END_S) {
    const blackout =
      (elapsed - DEATH_FADE_START_S) / (DEATH_END_S - DEATH_FADE_START_S);
    return {
      stage: "fade",
      timeScale: 1,
      pushIn,
      artVisible: true,
      artScale: 1,
      blackout,
    };
  }
  return {
    stage: "black",
    timeScale: 1,
    pushIn,
    artVisible: true,
    artScale: 1,
    blackout: 1,
  };
}
```

- [ ] **Step 4: Implement the overlay and its keyframes**

```tsx
// src/components/cityArena/DeathOverlay.tsx
"use client";

import { useEffect, useState } from "react";
import {
  deathScreenPhase,
  type DeathScreenStage,
} from "@/lib/cityArena/render/deathScreen";

/** WebP source of the death-screen artwork (spec §7). */
export const WASTED_WEBP = "/branding/wasted-screen.webp";
/** JPEG fallback of the death-screen artwork. */
export const WASTED_JPG = "/branding/wasted-screen.jpg";
/** Alternative text of the artwork (spec §16). */
export const WASTED_ALT = "Je bent uitgeschakeld";
/** How often the elapsed time is re-read while the overlay is up. */
const CLOCK_INTERVAL_MS = 50;
/** Milliseconds per second. */
const MS_PER_SECOND = 1000;
/** Slam-in keyframes for full motion (mirrors `deathScreenPhase().artScale`). */
const SLAM_ANIMATION = "animate-[arena-wasted-slam_250ms_ease-out_forwards]";
/** Fade-in keyframes under reduced motion. */
const FADE_ANIMATION = "animate-[arena-wasted-fade_300ms_ease-out_forwards]";

/** Props for {@link DeathOverlay}. */
export type DeathOverlayProps = {
  diedAtMs: number;
  reducedMotion: boolean;
  now?: () => number;
};

/** Default clock: the same performance clock the frame loop stamps `diedAtMs` with. */
function performanceNow(): number {
  return performance.now();
}

/** Seconds since `diedAtMs`, refreshed every 50 ms. */
function useElapsedSeconds(diedAtMs: number, now: () => number): number {
  const [elapsed, setElapsed] = useState(
    () => (now() - diedAtMs) / MS_PER_SECOND,
  );
  useEffect(() => {
    const handle = window.setInterval(
      () => setElapsed((now() - diedAtMs) / MS_PER_SECOND),
      CLOCK_INTERVAL_MS,
    );
    return () => window.clearInterval(handle);
  }, [diedAtMs, now]);
  return elapsed;
}

/** Props for {@link WastedArtwork}. */
type WastedArtworkProps = { reducedMotion: boolean };

/** The artwork shown complete (`object-contain`) over a blurred copy that fills the letterbox. */
function WastedArtwork({
  reducedMotion,
}: WastedArtworkProps): React.JSX.Element {
  const animation = reducedMotion ? FADE_ANIMATION : SLAM_ANIMATION;
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#050505]">
      <img
        src={WASTED_JPG}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
      />
      <picture>
        <source srcSet={WASTED_WEBP} type="image/webp" />
        <img
          src={WASTED_JPG}
          alt={WASTED_ALT}
          decoding="async"
          className={`absolute inset-0 h-full w-full object-contain ${animation}`}
        />
      </picture>
    </div>
  );
}

/** Classes of the black layer per stage: hidden, then a 400 ms fade, then solid. */
function blackoutClass(stage: DeathScreenStage): string {
  const base =
    "absolute inset-0 bg-black transition-opacity duration-[400ms] ease-in";
  return stage === "fade" || stage === "black"
    ? `${base} opacity-100`
    : `${base} opacity-0`;
}

/**
 * The dying player's own screen (spec §7): a desaturating, vignetted backdrop for 0.3 s, then the
 * artwork slams in, then a fade to black that holds until the simulation respawns and unmounts it.
 */
export default function DeathOverlay({
  diedAtMs,
  reducedMotion,
  now = performanceNow,
}: DeathOverlayProps): React.JSX.Element {
  const elapsed = useElapsedSeconds(diedAtMs, now);
  const phase = deathScreenPhase(elapsed, reducedMotion);
  return (
    <div
      data-testid="death-overlay"
      data-stage={phase.stage}
      role="presentation"
      className="pointer-events-none absolute inset-0 z-30 select-none"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(40,10,5,0.75)_100%)] backdrop-grayscale backdrop-sepia-[.35] backdrop-brightness-75" />
      {phase.artVisible ? (
        <WastedArtwork reducedMotion={reducedMotion} />
      ) : null}
      <div className={blackoutClass(phase.stage)} />
    </div>
  );
}
```

Append to `src/app/globals.css` (next to the existing `@keyframes space-invader-launch-pulse`):

```css
@keyframes arena-wasted-slam {
  0% {
    transform: scale(1.15);
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  66% {
    transform: scale(0.95);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes arena-wasted-fade {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/render/deathScreen.test.ts src/components/cityArena/DeathOverlay.test.tsx`
Expected: PASS (4 + 2 tests). The slam formula is `1 + 0.15 × (1 − p) × cos(1.5πp)`: 1.15 at p = 0, 0.947 at p = 0.5, a 0.95 dip at p = 2/3, 1 at p = 1; the overlay's 50 ms clock lands on 0.35 s, 2.8 s and 3.1 s in the test.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/render/deathScreen.ts src/lib/cityArena/render/deathScreen.test.ts src/components/cityArena/DeathOverlay.tsx src/components/cityArena/DeathOverlay.test.tsx src/app/globals.css
git add src/lib/cityArena/render/deathScreen.ts src/lib/cityArena/render/deathScreen.test.ts src/components/cityArena/DeathOverlay.tsx src/components/cityArena/DeathOverlay.test.tsx src/app/globals.css
git commit -m "feat(arena): add the death screen beats and the wasted artwork overlay

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: HUD vitals and the touch buttons

**Files:**

- Create: `src/components/cityArena/ArenaVitals.tsx`
- Create: `src/components/cityArena/ArenaTouchButtons.tsx`
- Test: `src/components/cityArena/ArenaVitals.test.tsx`, `src/components/cityArena/ArenaTouchButtons.test.tsx`

**Interfaces:**

- Consumes: `ammoFor`, `weaponLabel` (Task 1); `AmmoState`, `WeaponKind` (Task 1); `PLAYER_MAX_HEALTH` (Task 4); `ButtonName` (Task 1).
- Produces: `HEALTH_LABEL = "Gezondheid"`, `ArenaVitalsProps = { health; weapon; ammo; speedMps: number | null }`, `<ArenaVitals />`; `FIRE_LABEL = "Schieten"`, `ENTER_LABEL = "Instappen"`, `EXIT_LABEL = "Uitstappen"`, `WEAPON_LABEL = "Wapen"`, `ArenaTouchButtonsProps = { inVehicle: boolean; onButton: (name: ButtonName, pressed: boolean) => void }`, `<ArenaTouchButtons />`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/cityArena/ArenaVitals.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ArenaVitals, { HEALTH_LABEL } from "./ArenaVitals";

describe("ArenaVitals", () => {
  it("shows the health bar, the weapon with unlimited ammo and no speed on foot", () => {
    render(
      <ArenaVitals
        health={70}
        weapon="pistol"
        ammo={{ uzi: 60, shotgun: 8 }}
        speedMps={null}
      />,
    );
    expect(screen.getByLabelText(HEALTH_LABEL)).toHaveAttribute("value", "70");
    expect(screen.getByTestId("arena-weapon")).toHaveTextContent("Pistool ∞");
    expect(screen.queryByTestId("arena-speed")).toBeNull();
  });

  it("shows rounds left and the speed in km/u while driving", () => {
    render(
      <ArenaVitals
        health={20}
        weapon="uzi"
        ammo={{ uzi: 42, shotgun: 8 }}
        speedMps={12}
      />,
    );
    expect(screen.getByTestId("arena-weapon")).toHaveTextContent("Uzi 42");
    expect(screen.getByTestId("arena-speed")).toHaveTextContent("43 km/u");
    expect(screen.getByLabelText(HEALTH_LABEL).className).toContain(
      "animate-pulse",
    );
  });
});
```

```tsx
// src/components/cityArena/ArenaTouchButtons.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ArenaTouchButtons from "./ArenaTouchButtons";

describe("ArenaTouchButtons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports held buttons and releases them on pointer up", () => {
    const onButton = vi.fn();
    render(<ArenaTouchButtons inVehicle={false} onButton={onButton} />);
    const fire = screen.getByRole("button", { name: "Schieten" });
    fireEvent.pointerDown(fire, { pointerId: 1 });
    expect(onButton).toHaveBeenLastCalledWith("fire", true);
    fireEvent.pointerUp(fire, { pointerId: 1 });
    expect(onButton).toHaveBeenLastCalledWith("fire", false);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Wapen" }), {
      pointerId: 2,
    });
    expect(onButton).toHaveBeenLastCalledWith("weaponNext", true);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Instappen" }), {
      pointerId: 3,
    });
    expect(onButton).toHaveBeenLastCalledWith("enter", true);
  });

  it("labels the car button Uitstappen while driving", () => {
    render(<ArenaTouchButtons inVehicle onButton={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Uitstappen" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Instappen" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/cityArena/ArenaVitals.test.tsx src/components/cityArena/ArenaTouchButtons.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the components**

```tsx
// src/components/cityArena/ArenaVitals.tsx
"use client";

import { PLAYER_MAX_HEALTH } from "@/lib/cityArena/sim/damage";
import type { AmmoState, WeaponKind } from "@/lib/cityArena/sim/types";
import { ammoFor, weaponLabel } from "@/lib/cityArena/sim/weapons";

/** Accessible name of the health bar (spec §16). */
export const HEALTH_LABEL = "Gezondheid";
/** Shown instead of a count for unlimited weapons. */
const UNLIMITED_AMMO = "∞";
/** Health at or below which the bar turns red and pulses (spec §7: low-health throb below 25). */
const LOW_HEALTH = 25;
/** Metres per second to kilometres per hour. */
const KMH_PER_MPS = 3.6;
/** Bar classes shared by both colours. */
const BAR_BASE_CLASS =
  "h-2 w-24 overflow-hidden rounded [&::-webkit-progress-bar]:bg-white/15";
/** Bar classes when healthy. */
const BAR_OK_CLASS =
  "[&::-moz-progress-bar]:bg-[#22c55e] [&::-webkit-progress-value]:bg-[#22c55e]";
/** Bar classes when low: red and pulsing. */
const BAR_LOW_CLASS =
  "animate-pulse [&::-moz-progress-bar]:bg-[#e11d48] [&::-webkit-progress-value]:bg-[#e11d48]";

/** Props for {@link ArenaVitals}. */
export type ArenaVitalsProps = {
  health: number;
  weapon: WeaponKind;
  ammo: AmmoState;
  speedMps: number | null;
};

/** Health bar, weapon with ammo, and the speed while driving (`speedMps` is `null` on foot). */
export default function ArenaVitals({
  health,
  weapon,
  ammo,
  speedMps,
}: ArenaVitalsProps): React.JSX.Element {
  const rounds = ammoFor(ammo, weapon);
  const barClass = `${BAR_BASE_CLASS} ${health <= LOW_HEALTH ? BAR_LOW_CLASS : BAR_OK_CLASS}`;
  return (
    <div
      data-testid="arena-vitals"
      className="flex items-center gap-3 text-sm text-[#c9d1d9]"
    >
      <progress
        aria-label={HEALTH_LABEL}
        value={health}
        max={PLAYER_MAX_HEALTH}
        className={barClass}
      />
      <span data-testid="arena-weapon" className="font-semibold">
        {weaponLabel(weapon)}{" "}
        <span className="muted">
          {rounds === null ? UNLIMITED_AMMO : rounds}
        </span>
      </span>
      {speedMps === null ? null : (
        <span data-testid="arena-speed">
          {Math.round(speedMps * KMH_PER_MPS)} km/u
        </span>
      )}
    </div>
  );
}
```

```tsx
// src/components/cityArena/ArenaTouchButtons.tsx
"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { ButtonName } from "@/lib/cityArena/input/inputState";

/** Fire button label (spec §16). */
export const FIRE_LABEL = "Schieten";
/** Car button label while on foot (spec §16). */
export const ENTER_LABEL = "Instappen";
/** Car button label while driving (spec §16). */
export const EXIT_LABEL = "Uitstappen";
/** Weapon button label (spec §16). */
export const WEAPON_LABEL = "Wapen";
/** Same rules as Space Invaders' touch buttons: ≥ 58 px, `touch-manipulation`, nothing selectable. */
const TOUCH_BUTTON_CLASS =
  "min-h-[58px] min-w-[96px] touch-manipulation rounded-[10px] bg-white/10 px-3 text-base font-semibold text-white select-none active:bg-white/25 [-webkit-user-select:none] [-webkit-touch-callout:none]";

/** Props for {@link ArenaTouchButtons}. */
export type ArenaTouchButtonsProps = {
  inVehicle: boolean;
  onButton: (name: ButtonName, pressed: boolean) => void;
};

/** Props for {@link HoldButton}. */
type HoldButtonProps = {
  name: ButtonName;
  label: string;
  onButton: (name: ButtonName, pressed: boolean) => void;
};

/** A button that reports `pressed` while held and releases on up, leave or cancel. */
function HoldButton({
  name,
  label,
  onButton,
}: HoldButtonProps): React.JSX.Element {
  const press = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    onButton(name, true);
  };
  const release = (): void => onButton(name, false);
  return (
    <button
      type="button"
      className={TOUCH_BUTTON_CLASS}
      onPointerDown={press}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      {label}
    </button>
  );
}

/** Wapen, Instappen/Uitstappen and Schieten stacked at the bottom right, above the footer (spec §7). */
export default function ArenaTouchButtons({
  inVehicle,
  onButton,
}: ArenaTouchButtonsProps): React.JSX.Element {
  return (
    <div
      data-testid="arena-touch-buttons"
      className="absolute right-3 bottom-3 flex flex-col gap-2"
    >
      <HoldButton name="weaponNext" label={WEAPON_LABEL} onButton={onButton} />
      <HoldButton
        name="enter"
        label={inVehicle ? EXIT_LABEL : ENTER_LABEL}
        onButton={onButton}
      />
      <HoldButton name="fire" label={FIRE_LABEL} onButton={onButton} />
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/cityArena/ArenaVitals.test.tsx src/components/cityArena/ArenaTouchButtons.test.tsx`
Expected: PASS (2 + 2 tests); 12 m/s × 3.6 = 43.2 → "43 km/u".

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/cityArena/ArenaVitals.tsx src/components/cityArena/ArenaVitals.test.tsx src/components/cityArena/ArenaTouchButtons.tsx src/components/cityArena/ArenaTouchButtons.test.tsx
git add src/components/cityArena/ArenaVitals.tsx src/components/cityArena/ArenaVitals.test.tsx src/components/cityArena/ArenaTouchButtons.tsx src/components/cityArena/ArenaTouchButtons.test.tsx
git commit -m "feat(arena): add HUD vitals and the touch buttons

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: `useArenaGame` on the arena state — aim, buttons, death, slow motion and the debug seam

**Files:**

- Create: `src/lib/cityArena/test/hooks.ts`
- Modify: `src/components/cityArena/ArenaDebugOverlay.tsx`
- Modify: `src/components/cityArena/useArenaGame.ts`
- Test: `src/lib/cityArena/test/hooks.test.ts`, `src/components/cityArena/ArenaDebugOverlay.test.tsx` (extend), `src/components/cityArena/useArenaGame.test.tsx` (extend)

**Interfaces:**

- Consumes: `createArenaState`, `occupiedVehicle`, `stepArena`, `teleportArenaPlayer`, `ArenaWorld` (Tasks 6–7); `checkInvariants` (Task 7); `PLAYER_MAX_HEALTH`, `damagePlayer` (Task 4); `forwardSpeed` (Task 2); `SPAWN_AMMO` (Task 1); `createInput`, `ArenaState`, `ArenaPlayerState`, `WorldInput`, `AmmoState`, `WeaponKind` (Task 1); `ButtonName`, `InputState` (Task 1); `attachPointerAim`, `PointerAim` (Task 8); `DRIVING_LOOK_AHEAD_MAX_M`, `LOOK_AHEAD_MAX_M`, `screenToWorld`, `Viewport` (Task 8 / existing); `deathScreenPhase`, `DeathScreenPhase` (Task 10); `Scene`, `renderScene` (Task 9); `pickSpawn`, `findZone`, `findZoneByKey`; everything the Plan 2 hook already imports.
- Produces: `ArenaTestHooks = { getState(): ArenaState | null; dispatch(input: Partial<WorldInput>, ticks?: number): void; damage(amount: number): void; getViolations(): number }`, `ArenaHookHost = { __arena?: ArenaTestHooks }`, `installArenaHooks(host, hooks): () => void`, a global `Window.__arena?: ArenaTestHooks`; `EntityCounts = { vehicles; bullets; effects; violations }` and the `entities` prop of `ArenaDebugOverlay`; `ArenaHud` gains `health`, `weapon`, `ammo`, `speedMps: number | null`, `inVehicle`; `DebugSnapshot` gains `entities` and its `player` becomes `ArenaPlayerState`; `UseArenaGameOptions` gains `reducedMotion?: boolean` (default `false`, so the Plan 2 overlay keeps compiling until Task 13); `DeathInfo = { diedAtMs: number }`; `ArenaGame` gains `death: DeathInfo | null` and `setButton(name, pressed)`; exported pure helpers `computeHud(session, state): ArenaHud` and `aimAngle(camera, viewport, player: Point, pointer): number | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/test/hooks.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  installArenaHooks,
  type ArenaHookHost,
  type ArenaTestHooks,
} from "./hooks";

function fakeHooks(): ArenaTestHooks {
  return {
    getState: () => null,
    dispatch: vi.fn(),
    damage: vi.fn(),
    getViolations: () => 0,
  };
}

describe("installArenaHooks", () => {
  it("exposes the hooks on the host and removes only its own on uninstall", () => {
    const host: ArenaHookHost = {};
    const mine = fakeHooks();
    const uninstall = installArenaHooks(host, mine);
    expect(host.__arena).toBe(mine);
    const theirs = fakeHooks();
    host.__arena = theirs;
    uninstall();
    expect(host.__arena).toBe(theirs);
    installArenaHooks(host, mine)();
    expect(host.__arena).toBeUndefined();
  });
});
```

In `src/components/cityArena/ArenaDebugOverlay.test.tsx` add the prop `entities={{ vehicles: 8, bullets: 2, effects: 3, violations: 0 }}` to the render and `expect(panel).toHaveTextContent("auto's 8 · kogels 2 · effecten 3 · schendingen 0");`; change the `player` prop to `createArenaPlayer([2588, 1671], 0)` (import from `@/lib/cityArena/sim/arena`).

In `src/components/cityArena/useArenaGame.test.tsx` add `reducedMotion: false` to the options inside `renderArenaGame`, add the imports `createArenaState` (`@/lib/cityArena/sim/arena`), `createRng` (`@/lib/cityArena/sim/rng`), `createVehicle` (`@/lib/cityArena/sim/vehicle`), `createCamera` (`@/lib/cityArena/render/camera`) and `aimAngle`, `computeHud` from `./useArenaGame`, then append:

```tsx
// src/components/cityArena/useArenaGame.test.tsx — appended
describe("computeHud and aimAngle", () => {
  it("reports vitals on foot and the car speed while driving", () => {
    const state = createArenaState(
      { index: testIndex, graph: testGraph, seed: 1, zone: null },
      createRng(1),
    );
    const session = { index: () => testIndex, tiles: () => [] };
    expect(computeHud(session, state)).toMatchObject({
      zoneName: null,
      health: 100,
      weapon: "pistol",
      speedMps: null,
      inVehicle: false,
    });
    const car = { ...createVehicle(9, "sport", [0, 0], 0, 0), velocityX: 10 };
    const driving = {
      ...state,
      vehicles: [car],
      player: { ...state.player, vehicleId: 9 },
    };
    expect(computeHud(session, driving)).toMatchObject({
      speedMps: 10,
      inVehicle: true,
    });
  });

  it("aims from the player toward the mouse position", () => {
    const camera = createCamera([0, 0], 8);
    const viewport = { width: 200, height: 100 };
    expect(aimAngle(camera, viewport, [0, 0], null)).toBeNull();
    expect(aimAngle(camera, viewport, [0, 0], [100, 90])).toBeCloseTo(
      Math.PI / 2,
    );
    expect(aimAngle(camera, viewport, [0, 0], [180, 50])).toBeCloseTo(0);
  });
});

describe("debug hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("installs window.__arena in debug mode and removes it on unmount", async () => {
    const { session, resolveReady } = createControllableSession();
    mockCreateWorldSession.mockReturnValue(session);
    const { unmount } = renderHook(() =>
      useArenaGame({
        zoneKey: "wageningen",
        canvasRef: useRef<HTMLCanvasElement>(null),
        debug: true,
        reducedMotion: false,
      }),
    );
    await act(async () => {
      resolveReady(testReady);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.__arena?.getState()?.tick).toBe(0);
    window.__arena?.dispatch({ fire: true }, 2);
    expect(window.__arena?.getViolations()).toBe(0);
    unmount();
    expect(window.__arena).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/test src/components/cityArena/ArenaDebugOverlay.test.tsx src/components/cityArena/useArenaGame.test.tsx`
Expected: FAIL — `./hooks` not found; the debug panel lacks the entities line; `computeHud`/`aimAngle` are not exported; `window.__arena` is undefined.

- [ ] **Step 3: Implement the hooks module and the debug line**

```ts
// src/lib/cityArena/test/hooks.ts
import type { ArenaState, WorldInput } from "../sim/types";

/** The debug seam exposed as `window.__arena` behind `?debug=1` (spec §12.A3, minimal subset). */
export type ArenaTestHooks = {
  getState(): ArenaState | null;
  dispatch(input: Partial<WorldInput>, ticks?: number): void;
  damage(amount: number): void;
  getViolations(): number;
};

/** The object the hooks hang off: the window in the browser, a plain object in tests. */
export type ArenaHookHost = { __arena?: ArenaTestHooks };

declare global {
  interface Window {
    __arena?: ArenaTestHooks;
  }
}

/** Installs the hooks on `host`; the returned uninstaller only removes them while they are still ours. */
export function installArenaHooks(
  host: ArenaHookHost,
  hooks: ArenaTestHooks,
): () => void {
  host.__arena = hooks;
  return () => {
    if (host.__arena === hooks) delete host.__arena;
  };
}
```

In `src/components/cityArena/ArenaDebugOverlay.tsx`: change the `player` import to `ArenaPlayerState`, add

```tsx
/** Entity counts and invariant violations of the running simulation. */
export type EntityCounts = {
  vehicles: number;
  bullets: number;
  effects: number;
  violations: number;
};
```

add `entities: EntityCounts;` to `ArenaDebugOverlayProps`, destructure it in `debugLines` and append this line to the returned array:

```tsx
    `auto's ${entities.vehicles} · kogels ${entities.bullets} · effecten ${entities.effects} · schendingen ${entities.violations}`,
```

- [ ] **Step 4: Rewrite the top of `useArenaGame.ts` — imports, constants, types, runtime, scene**

Replace the import block, the `HUD_REFRESH_MS` constant, the type declarations, `Runtime`, `paintCanvas`, `randomSpawnPoint`, `applyTeleport`, `createRuntime` and `bootSession` with the code below. `reportArenaError`, `distanceBetween`, `nearestLandmarkTo`, `routeToNearestLandmark`, `createArenaSession`, `rasterBudgetForCanvas`, `IsCancelled`, `finishBoot`, `BootSetters`, `computeFrameDt`, `startFrameLoop` and `useFrameLoop` stay exactly as they are.

```ts
// src/components/cityArena/useArenaGame.ts — imports
"use client";

import * as Sentry from "@sentry/nextjs";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  createFrameMetrics,
  type FrameMetrics,
  type MetricsSnapshot,
} from "@/lib/cityArena/debugMetrics";
import {
  createInputState,
  type ButtonName,
  type InputState,
} from "@/lib/cityArena/input/inputState";
import { attachKeyboard } from "@/lib/cityArena/input/keyboard";
import {
  attachPointerAim,
  type PointerAim,
} from "@/lib/cityArena/input/pointerAim";
import {
  DRIVING_LOOK_AHEAD_MAX_M,
  LOOK_AHEAD_MAX_M,
  createCamera,
  screenToWorld,
  updateCamera,
  zoomLevelForViewport,
  type Camera,
  type Viewport,
} from "@/lib/cityArena/render/camera";
import { createDomCanvasFactory } from "@/lib/cityArena/render/canvasTypes";
import {
  deathScreenPhase,
  type DeathScreenPhase,
} from "@/lib/cityArena/render/deathScreen";
import { renderScene, type Scene } from "@/lib/cityArena/render/renderScene";
import { rasterBudgetForViewport } from "@/lib/cityArena/render/staticRaster";
import {
  createArenaState,
  occupiedVehicle,
  stepArena,
  teleportArenaPlayer,
  type ArenaWorld,
} from "@/lib/cityArena/sim/arena";
import { PLAYER_MAX_HEALTH, damagePlayer } from "@/lib/cityArena/sim/damage";
import { checkInvariants } from "@/lib/cityArena/sim/invariants";
import { SIM_STEP_S } from "@/lib/cityArena/sim/player";
import { createRng, seedFromString } from "@/lib/cityArena/sim/rng";
import {
  createInput,
  type AmmoState,
  type ArenaPlayerState,
  type ArenaState,
  type WeaponKind,
  type WorldInput,
} from "@/lib/cityArena/sim/types";
import { forwardSpeed } from "@/lib/cityArena/sim/vehicle";
import { SPAWN_AMMO } from "@/lib/cityArena/sim/weapons";
import { saveArenaSettings } from "@/lib/cityArena/storage";
import {
  installArenaHooks,
  type ArenaTestHooks,
} from "@/lib/cityArena/test/hooks";
import {
  createMapLoader,
  type LoadProgress,
} from "@/lib/cityArena/world/mapLoader";
import type {
  MapIndex,
  MapLandmark,
  MapZone,
  ZoneKey,
} from "@/lib/cityArena/world/mapTypes";
import { nearestRoadName } from "@/lib/cityArena/world/nearestRoad";
import type { Point } from "@/lib/cityArena/world/projection";
import { findPath, pathLength } from "@/lib/cityArena/world/roadGraph";
import {
  createWorldSession,
  type WorldSession,
} from "@/lib/cityArena/world/worldSession";
import {
  findZone,
  findZoneByKey,
  landmarkCentreMetres,
  pickSpawn,
} from "@/lib/cityArena/world/zone";
import type { EntityCounts } from "./ArenaDebugOverlay";
```

```ts
// src/components/cityArena/useArenaGame.ts — constants and types
/** How often (ms) the HUD is recomputed (spec §8: 10 Hz). */
const HUD_REFRESH_MS = 100;
/** Prefix of the per-session RNG seed string. */
const SESSION_SEED_PREFIX = "gta-h3";

/** Overlay lifecycle phase. */
export type ArenaPhase = "loading" | "playing" | "error";
/** Zone, street and vitals shown in the HUD strip. */
export type ArenaHud = {
  zoneName: string | null;
  zoneKey: ZoneKey | null;
  street: string | null;
  health: number;
  weapon: WeaponKind;
  ammo: AmmoState;
  speedMps: number | null;
  inVehicle: boolean;
};
/** HUD state before the first refresh runs. */
const INITIAL_HUD: ArenaHud = {
  zoneName: null,
  zoneKey: null,
  street: null,
  health: PLAYER_MAX_HEALTH,
  weapon: "pistol",
  ammo: SPAWN_AMMO,
  speedMps: null,
  inVehicle: false,
};
/** Data for the debug panel. */
export type DebugSnapshot = {
  metrics: MetricsSnapshot;
  chunks: { chunks: number; bytes: number };
  tiles: number;
  camera: Camera;
  player: ArenaPlayerState;
  routeMetres: number | null;
  entities: EntityCounts;
};
/** The local player's death, stamped with the frame clock, while the death screen is up. */
export type DeathInfo = { diedAtMs: number };
/** Hook options. */
export type UseArenaGameOptions = {
  zoneKey: ZoneKey;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  debug: boolean;
  reducedMotion?: boolean;
};
/** Hook result consumed by the overlay. */
export type ArenaGame = {
  phase: ArenaPhase;
  progress: LoadProgress;
  failed: boolean;
  hud: ArenaHud;
  zones: MapZone[];
  death: DeathInfo | null;
  setInputVector(vector: [number, number] | null): void;
  setButton(name: ButtonName, pressed: boolean): void;
  teleportToZone(key: ZoneKey): void;
  debugSnapshot: DebugSnapshot | null;
};

/** A debug input that replaces the live one for a number of steps. */
type InjectedInput = { input: WorldInput; ticksLeft: number };

/** Mutable per-frame state shared by the boot, input and frame-loop hooks. */
type Runtime = {
  session: WorldSession;
  state: ArenaState;
  camera: Camera;
  random: () => number;
  accumulator: number;
  lastTileSync: number;
  lastHud: number;
  lastDebug: number;
  diedAtMs: number | null;
  injected: InjectedInput | null;
  violations: number;
  reportedViolations: Set<string>;
  reducedMotion: boolean;
};
```

```ts
// src/components/cityArena/useArenaGame.ts — scene, paint, teleport, runtime, boot
/** The death-screen phase for this frame, or `null` while alive. */
function deathPhase(runtime: Runtime, nowMs: number): DeathScreenPhase | null {
  if (runtime.diedAtMs === null) return null;
  return deathScreenPhase(
    (nowMs - runtime.diedAtMs) / MS_PER_SECOND,
    runtime.reducedMotion,
  );
}

/** Everything the renderer draws this frame. */
function buildScene(
  runtime: Runtime,
  zone: MapZone | null,
  aimScreen: [number, number] | null,
  nowMs: number,
): Scene {
  const { session, state } = runtime;
  return {
    world: {
      raster: session.raster,
      tiles: session.tiles(),
      landmarks: session.landmarks(),
      loadedTileRects: session.loadedTileRects(),
    },
    zone,
    player: state.player,
    vehicles: state.vehicles,
    bullets: state.bullets,
    effects: state.effects,
    tick: state.tick,
    aimScreen,
    pushIn: deathPhase(runtime, nowMs)?.pushIn ?? 1,
  };
}

/** Resizes the canvas to its layout box (device-pixel aware) and paints the scene. */
function paintCanvas(
  canvas: HTMLCanvasElement,
  rect: DOMRect,
  camera: Camera,
  scene: Scene,
): void {
  const dpr = window.devicePixelRatio || 1;
  const targetWidth = Math.round(rect.width * dpr);
  const targetHeight = Math.round(rect.height * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  renderScene(
    ctx,
    { rect: { x: 0, y: 0, width: rect.width, height: rect.height }, camera },
    scene,
  );
}

/** Moves the player to a seeded spawn node of `zone` and remembers it as the last-visited zone. */
function applyTeleport(runtime: Runtime, zone: MapZone): void {
  const target = pickSpawn(zone, runtime.random);
  runtime.state = teleportArenaPlayer(
    runtime.state,
    target,
    runtime.session.index(),
  );
  runtime.camera = createCamera(target, runtime.camera.zoom);
  runtime.lastTileSync = 0;
  saveArenaSettings({ lastZone: zone.key });
}

/** Fresh runtime: an arena state seeded from the zone and the clock, the camera at the spawn, timers zeroed. */
function createRuntime(
  session: WorldSession,
  index: MapIndex,
  zone: MapZone | null,
  viewportWidthPx: number,
  reducedMotion: boolean,
): Runtime {
  const seed = seedFromString(
    `${SESSION_SEED_PREFIX}:${zone?.key ?? "none"}:${Date.now()}`,
  );
  const random = createRng(seed);
  const state = createArenaState(
    { index, graph: session.graph(), seed, zone },
    random,
  );
  return {
    session,
    state,
    camera: createCamera(
      [state.player.x, state.player.y],
      zoomLevelForViewport(viewportWidthPx),
    ),
    random,
    accumulator: 0,
    lastTileSync: 0,
    lastHud: 0,
    lastDebug: 0,
    diedAtMs: null,
    injected: null,
    violations: 0,
    reportedViolations: new Set<string>(),
    reducedMotion,
  };
}

/**
 * Awaits the session's index/graph, then builds the initial runtime at a seeded spawn node.
 * Returns `null` without touching `runtimeRef` when `isCancelled` reports true after the wait —
 * the boot effect's cleanup runs synchronously and unconditionally disposes `session` before any
 * later `await` in this function can resume, so a cancelled caller never needs to dispose again.
 */
async function bootSession(
  session: WorldSession,
  zoneKey: ZoneKey,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  runtimeRef: RefObject<Runtime | null>,
  reducedMotionRef: RefObject<boolean>,
  isCancelled: IsCancelled,
): Promise<{ index: MapIndex; spawn: Point } | null> {
  const { index } = await session.ready();
  if (isCancelled()) return null;
  const zone = findZoneByKey(index, zoneKey) ?? index.zones.at(0) ?? null;
  const width =
    canvasRef.current?.getBoundingClientRect().width ??
    DEFAULT_VIEWPORT_WIDTH_PX;
  const runtime = createRuntime(
    session,
    index,
    zone,
    width,
    reducedMotionRef.current,
  );
  runtimeRef.current = runtime;
  return { index, spawn: [runtime.state.player.x, runtime.state.player.y] };
}
```

`ArenaBootOptions` gains `reducedMotionRef: RefObject<boolean>`; `useArenaBoot` destructures it and passes it as the fifth argument of `bootSession` (its effect dependency list stays `[canvasRef, runtimeRef, zoneKey]` — the ref is stable, so a media-query change never re-boots).

- [ ] **Step 5: Rewrite the simulation, input, frame and hook functions**

Replace `useArenaInput`, `computeHud`, `buildDebugSnapshot`, `advanceSimulation`, `FrameLoopOptions`, `runFrame` and `useArenaGame` with the code below (`refreshThrottled` only changes its HUD line to `options.setHud(computeHud(runtime.session, runtime.state))`).

```ts
// src/components/cityArena/useArenaGame.ts — input, simulation, frame, hook
/** World angle from the player to the mouse on the canvas, or `null` without a mouse position. */
export function aimAngle(
  camera: Camera,
  viewport: Viewport,
  player: Point,
  pointer: [number, number] | null,
): number | null {
  if (!pointer) return null;
  const target = screenToWorld(camera, viewport, pointer);
  return Math.atan2(target[1] - player[1], target[0] - player[0]);
}

/** Attaches keyboard and mouse aim on mount; returns the setters the touch controls drive. */
function useArenaInput(
  inputRef: RefObject<InputState>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  pointerRef: RefObject<PointerAim | null>,
): {
  setInputVector(vector: [number, number] | null): void;
  setButton(name: ButtonName, pressed: boolean): void;
} {
  useEffect(() => attachKeyboard(window, inputRef.current), [inputRef]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const aim = attachPointerAim(canvas, inputRef.current);
    pointerRef.current = aim;
    return () => {
      aim.detach();
      pointerRef.current = null;
    };
  }, [canvasRef, inputRef, pointerRef]);
  const setInputVector = useCallback(
    (vector: [number, number] | null) => inputRef.current.setStick(vector),
    [inputRef],
  );
  const setButton = useCallback(
    (name: ButtonName, pressed: boolean) =>
      inputRef.current.setButton("pointer", name, pressed),
    [inputRef],
  );
  return { setInputVector, setButton };
}

/** Zone, street and vitals for the HUD from the current state. */
export function computeHud(
  session: Pick<WorldSession, "index" | "tiles">,
  state: ArenaState,
): ArenaHud {
  const { player } = state;
  const zone = findZone(session.index(), [player.x, player.y]);
  const car = occupiedVehicle(state);
  return {
    zoneName: zone?.name ?? null,
    zoneKey: zone?.key ?? null,
    street: nearestRoadName(session.tiles(), [player.x, player.y]),
    health: player.health,
    weapon: player.weapon,
    ammo: player.ammo,
    speedMps: car ? Math.abs(forwardSpeed(car)) : null,
    inVehicle: car !== null,
  };
}

/** Debug-panel snapshot: frame metrics, cache stats, camera/player, route distance and entity counts. */
function buildDebugSnapshot(
  runtime: Runtime,
  metrics: MetricsSnapshot,
): DebugSnapshot {
  return {
    metrics,
    chunks: runtime.session.raster.stats(),
    tiles: runtime.session.tiles().length,
    camera: runtime.camera,
    player: runtime.state.player,
    routeMetres: routeToNearestLandmark(runtime),
    entities: {
      vehicles: runtime.state.vehicles.length,
      bullets: runtime.state.bullets.length,
      effects: runtime.state.effects.length,
      violations: runtime.violations,
    },
  };
}

/** The input for the next step: an injected debug input while its ticks last, else the live one. */
function nextInput(runtime: Runtime, live: WorldInput): WorldInput {
  const injected = runtime.injected;
  if (!injected || injected.ticksLeft <= 0) {
    runtime.injected = null;
    return live;
  }
  runtime.injected = { ...injected, ticksLeft: injected.ticksLeft - 1 };
  return injected.input;
}

/** Runs the invariant checker (debug mode); each distinct message goes to Sentry once per session. */
function recordViolations(runtime: Runtime): void {
  const violations = checkInvariants(runtime.state);
  runtime.violations += violations.length;
  for (const message of violations) {
    if (runtime.reportedViolations.has(message)) continue;
    runtime.reportedViolations.add(message);
    Sentry.captureMessage(`Arena invariant: ${message}`, {
      level: "warning",
      tags: { area: "arena", kind: "invariant" },
    });
  }
}

/** Stamps a death with the frame clock and clears it on respawn; true when it changed. */
function trackDeath(runtime: Runtime, nowMs: number): boolean {
  const dead = runtime.state.player.diedAtTick !== null;
  if (dead === (runtime.diedAtMs !== null)) return false;
  runtime.diedAtMs = dead ? nowMs : null;
  return true;
}

/** Eases the camera after the player or their car, with the driving or walking look-ahead cap. */
function followPlayer(runtime: Runtime, dt: number): void {
  const { player } = runtime.state;
  const car = occupiedVehicle(runtime.state);
  const velocity: Point = car
    ? [car.velocityX, car.velocityY]
    : [
        Math.cos(player.facing) * player.speed,
        Math.sin(player.facing) * player.speed,
      ];
  runtime.camera = updateCamera(
    runtime.camera,
    [player.x, player.y],
    velocity,
    dt,
    car ? DRIVING_LOOK_AHEAD_MAX_M : LOOK_AHEAD_MAX_M,
  );
}

/** Absorbs `dt` (slowed by the death screen's time scale) in fixed steps, then follows the player. */
function advanceSimulation(
  runtime: Runtime,
  dt: number,
  input: WorldInput,
  nowMs: number,
  debug: boolean,
): void {
  runtime.accumulator += dt * (deathPhase(runtime, nowMs)?.timeScale ?? 1);
  const world: ArenaWorld = {
    collision: runtime.session.collision,
    index: runtime.session.index(),
  };
  let steps = 0;
  while (runtime.accumulator >= SIM_STEP_S && steps < MAX_SIM_STEPS_PER_FRAME) {
    const stepInput = nextInput(runtime, input);
    runtime.state = stepArena(
      runtime.state,
      stepInput,
      SIM_STEP_S,
      world,
      runtime.random,
    );
    runtime.accumulator -= SIM_STEP_S;
    steps += 1;
    if (debug) recordViolations(runtime);
  }
  followPlayer(runtime, dt);
}

/** Options threaded through the frame loop's per-frame and throttled-refresh helpers. */
type FrameLoopOptions = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  runtimeRef: RefObject<Runtime | null>;
  inputRef: RefObject<InputState>;
  pointerRef: RefObject<PointerAim | null>;
  metricsRef: RefObject<FrameMetrics>;
  debug: boolean;
  setProgress: (progress: LoadProgress) => void;
  setHud: (hud: ArenaHud) => void;
  setDeath: (death: DeathInfo | null) => void;
  setDebugSnapshot: (snapshot: DebugSnapshot | null) => void;
};

/** Aims, simulates, paints and records metrics for one frame, then runs the throttled refreshes. */
function runFrame(
  timestamp: number,
  dt: number,
  runtime: Runtime,
  canvas: HTMLCanvasElement,
  options: FrameLoopOptions,
): void {
  const simStart = performance.now();
  const rect = canvas.getBoundingClientRect();
  const size: Viewport = { width: rect.width, height: rect.height };
  const pointer = options.pointerRef.current?.position() ?? null;
  const { player } = runtime.state;
  options.inputRef.current.setAim(
    aimAngle(runtime.camera, size, [player.x, player.y], pointer),
  );
  advanceSimulation(
    runtime,
    dt,
    options.inputRef.current.snapshot(),
    timestamp,
    options.debug,
  );
  if (trackDeath(runtime, timestamp))
    options.setDeath(
      runtime.diedAtMs === null ? null : { diedAtMs: runtime.diedAtMs },
    );
  const drawStart = performance.now();
  const zone = runtime.state.zoneKey
    ? findZoneByKey(runtime.session.index(), runtime.state.zoneKey)
    : null;
  paintCanvas(
    canvas,
    rect,
    runtime.camera,
    buildScene(runtime, zone, pointer, timestamp),
  );
  const drawEnd = performance.now();
  options.metricsRef.current.record({
    frameMs: dt * MS_PER_SECOND,
    drawMs: drawEnd - drawStart,
    simMs: drawStart - simStart,
  });
  refreshThrottled(runtime, timestamp, options);
}

/** Builds the `window.__arena` seam over the runtime ref. */
function createTestHooks(
  runtimeRef: RefObject<Runtime | null>,
): ArenaTestHooks {
  return {
    getState: () => runtimeRef.current?.state ?? null,
    dispatch(input, ticks = 1) {
      const runtime = runtimeRef.current;
      if (runtime)
        runtime.injected = { input: createInput(input), ticksLeft: ticks };
    },
    damage(amount) {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const player = damagePlayer(
        runtime.state.player,
        amount,
        runtime.state.tick,
      );
      runtime.state = { ...runtime.state, player };
    },
    getViolations: () => runtimeRef.current?.violations ?? 0,
  };
}

/** Installs `window.__arena` while `debug` is on. */
function useArenaTestHooks(
  debug: boolean,
  runtimeRef: RefObject<Runtime | null>,
): void {
  useEffect(() => {
    if (!debug) return undefined;
    return installArenaHooks(window, createTestHooks(runtimeRef));
  }, [debug, runtimeRef]);
}

/** Keeps the reduced-motion preference on the boot ref and on the live runtime. */
function useReducedMotionSync(
  reducedMotion: boolean,
  reducedMotionRef: RefObject<boolean>,
  runtimeRef: RefObject<Runtime | null>,
): void {
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
    if (runtimeRef.current) runtimeRef.current.reducedMotion = reducedMotion;
  }, [reducedMotion, reducedMotionRef, runtimeRef]);
}

/** The zone-picker teleport: moves the player and refreshes the HUD at once. */
function useTeleport(
  runtimeRef: RefObject<Runtime | null>,
  setHud: (hud: ArenaHud) => void,
): (key: ZoneKey) => void {
  return useCallback(
    (key: ZoneKey) => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const zone = findZoneByKey(runtime.session.index(), key);
      if (!zone) return;
      applyTeleport(runtime, zone);
      setHud(computeHud(runtime.session, runtime.state));
    },
    [runtimeRef, setHud],
  );
}

/** Owns the world session, the fixed-step arena loop, the camera, the HUD and the death screen state. */
export function useArenaGame({
  zoneKey,
  canvasRef,
  debug,
  reducedMotion = false,
}: UseArenaGameOptions): ArenaGame {
  const runtimeRef = useRef<Runtime | null>(null);
  const inputRef = useRef(createInputState());
  const pointerRef = useRef<PointerAim | null>(null);
  const metricsRef = useRef(createFrameMetrics());
  const reducedMotionRef = useRef(reducedMotion);
  const [hud, setHud] = useState<ArenaHud>(INITIAL_HUD);
  const [death, setDeath] = useState<DeathInfo | null>(null);
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot | null>(
    null,
  );

  useReducedMotionSync(reducedMotion, reducedMotionRef, runtimeRef);
  const boot = useArenaBoot({
    zoneKey,
    canvasRef,
    runtimeRef,
    reducedMotionRef,
  });
  const { setInputVector, setButton } = useArenaInput(
    inputRef,
    canvasRef,
    pointerRef,
  );
  useArenaTestHooks(debug, runtimeRef);
  useFrameLoop(boot.phase, {
    canvasRef,
    runtimeRef,
    inputRef,
    pointerRef,
    metricsRef,
    debug,
    setProgress: boot.setProgress,
    setHud,
    setDeath,
    setDebugSnapshot,
  });
  const teleportToZone = useTeleport(runtimeRef, setHud);

  return {
    phase: boot.phase,
    progress: boot.progress,
    failed: boot.failed,
    hud,
    zones: boot.zones,
    death,
    setInputVector,
    setButton,
    teleportToZone,
    debugSnapshot,
  };
}
```

`useFrameLoop` destructures and forwards the two new options (`pointerRef`, `setDeath`) exactly like the existing ones, and its dependency array lists them. Remove the Task 9 interim `createArenaPlayer` import.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npx vitest run src/lib/cityArena/test src/components/cityArena`
Expected: `tsc` clean; PASS — hooks 1, ArenaDebugOverlay 1, useArenaGame 2 + 2 + 1, DeathOverlay 2, ArenaVitals 2, ArenaTouchButtons 2, TouchStick 1, ArenaLoadingScreen 2, CityArenaLauncher (unchanged), useDialogFocusTrap 2, CityArenaOverlay 4 (still on the Plan 2 wiring; Task 13 extends it). In the aim test the pointer at (100, 90) on a 200 × 100 viewport at 8 px/m is 5 m south of the centre, so the angle is π/2.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/cityArena/test src/components/cityArena/useArenaGame.ts src/components/cityArena/useArenaGame.test.tsx src/components/cityArena/ArenaDebugOverlay.tsx src/components/cityArena/ArenaDebugOverlay.test.tsx
git add src/lib/cityArena/test src/components/cityArena/useArenaGame.ts src/components/cityArena/useArenaGame.test.tsx src/components/cityArena/ArenaDebugOverlay.tsx src/components/cityArena/ArenaDebugOverlay.test.tsx
git commit -m "feat(arena): run the arena state in the game loop with aim, death and hooks

The frame loop now steps the full arena simulation, computes the mouse
aim per frame, slows time and pushes the camera in during the death
beats, tracks the death for the overlay, and exposes window.__arena
behind ?debug=1 with an invariant counter.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Overlay wiring — vitals, touch buttons, death overlay, mouse cursor, hints

**Files:**

- Modify: `src/components/cityArena/CityArenaOverlay.tsx`
- Test: `src/components/cityArena/CityArenaOverlay.test.tsx` (extend)

**Interfaces:**

- Consumes: `ArenaVitals`, `HEALTH_LABEL` (Task 11); `ArenaTouchButtons` (Task 11); `DeathOverlay` (Task 10); `useArenaGame`, `ArenaGame`, `ArenaHud` (Task 12); existing `ArenaZonePicker`, `ArenaErrorMessage`, `ArenaLoadingScreen`, `ArenaDebugOverlay`, `TouchStick`, `useDialogFocusTrap`, `useLockBodyScroll`, `useShowTouchControls`.
- Produces: `useReducedMotion(): boolean` (module-private hook); the overlay renders the vitals in the HUD bar, the touch buttons on coarse pointers, the death overlay while `game.death` is set, hides the native cursor over the canvas on fine pointers and explains the new controls in the footer.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/cityArena/CityArenaOverlay.test.tsx` (inside the existing `describe`; `HEALTH_LABEL` imported from `./ArenaVitals`):

```tsx
it("shows the vitals once playing and no death overlay or touch buttons on desktop", async () => {
  render(<CityArenaOverlay zone="wageningen" onClose={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getByTestId("arena-hud")).toHaveTextContent(
      "Wageningen centrum",
    ),
  );
  expect(screen.getByLabelText(HEALTH_LABEL)).toHaveAttribute("value", "100");
  expect(screen.getByTestId("arena-weapon")).toHaveTextContent("Pistool ∞");
  expect(screen.queryByTestId("death-overlay")).toBeNull();
  expect(screen.queryByTestId("arena-touch-buttons")).toBeNull();
  expect(screen.getByLabelText("GTA H3 speelveld").className).toContain(
    "cursor-none",
  );
});

it("shows the touch buttons next to the stick on coarse pointers", async () => {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: query.includes("pointer: coarse"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  render(<CityArenaOverlay zone="wageningen" onClose={vi.fn()} />);
  await waitFor(() =>
    expect(screen.getByTestId("arena-hud")).toHaveTextContent(
      "Wageningen centrum",
    ),
  );
  expect(screen.getByTestId("touch-stick-surface")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Schieten" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Instappen" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Wapen" })).toBeInTheDocument();
  expect(screen.getByText(/Sleep links/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/cityArena/CityArenaOverlay.test.tsx`
Expected: FAIL — no element labelled "Gezondheid"; the canvas class lacks `cursor-none`; no "Schieten" button.

- [ ] **Step 3: Wire the overlay**

Add the imports `ArenaTouchButtons from "./ArenaTouchButtons"`, `ArenaVitals from "./ArenaVitals"`, `DeathOverlay from "./DeathOverlay"`, then replace `ArenaHudBar`, `ArenaPlayfield`, `ArenaFooter` and the default export, and add `useReducedMotion`:

```tsx
// src/components/cityArena/CityArenaOverlay.tsx — changed parts
/** Media query of the user's reduced-motion preference (death screen beats, spec §7). */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** True while the user prefers reduced motion; updates when the preference changes. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const apply = (): void => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/** Top strip: zone/street, vitals, an optional load warning, the zone picker and the close button. */
function ArenaHudBar({
  hud,
  zones,
  pickerDisabled,
  showLoadWarning,
  onTeleport,
  onClose,
}: ArenaHudBarProps): React.JSX.Element {
  return (
    <div
      data-testid="arena-hud"
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#21262d] px-3 py-2 text-sm text-[#c9d1d9]"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <span className="font-semibold">
          {hud.zoneName ?? "Vrij rondlopen"}
        </span>
        {hud.street ? (
          <span className="muted truncate">{hud.street}</span>
        ) : null}
        <ArenaVitals
          health={hud.health}
          weapon={hud.weapon}
          ammo={hud.ammo}
          speedMps={hud.speedMps}
        />
        {showLoadWarning ? (
          <span className="text-xs text-[#f0b429]">
            {MAP_LOAD_FAILURE_TEXT}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ArenaZonePicker
          zones={zones}
          currentKey={hud.zoneKey ?? ""}
          disabled={pickerDisabled}
          onTeleport={onTeleport}
        />
        <button type="button" onClick={onClose}>
          Sluiten
        </button>
      </div>
    </div>
  );
}

/** Props for {@link ArenaPlayfield}. */
type ArenaPlayfieldProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  game: ArenaGame;
  debug: boolean;
  showTouch: boolean;
  reducedMotion: boolean;
  stick: StickController;
};

/** Canvas plus the loading, error, stick, buttons, death and debug layers drawn on top of it. */
function ArenaPlayfield({
  canvasRef,
  game,
  debug,
  showTouch,
  reducedMotion,
  stick,
}: ArenaPlayfieldProps): React.JSX.Element {
  const playing = game.phase === "playing";
  return (
    <div className="relative min-h-0 flex-1">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none [@media(pointer:fine)]:cursor-none"
        aria-label="GTA H3 speelveld"
      />
      {playing && showTouch ? (
        <TouchStick stick={stick} onVector={game.setInputVector} />
      ) : null}
      {playing && showTouch ? (
        <ArenaTouchButtons
          inVehicle={game.hud.inVehicle}
          onButton={game.setButton}
        />
      ) : null}
      {game.phase === "loading" ? (
        <ArenaLoadingScreen
          loaded={game.progress.loaded}
          total={game.progress.total}
          failed={game.failed}
        />
      ) : null}
      {game.phase === "error" ? <ArenaErrorMessage /> : null}
      {playing && game.death ? (
        <DeathOverlay
          diedAtMs={game.death.diedAtMs}
          reducedMotion={reducedMotion}
        />
      ) : null}
      {debug && game.debugSnapshot ? (
        <ArenaDebugOverlay {...game.debugSnapshot} />
      ) : null}
    </div>
  );
}

/** Bottom hint line: the active control scheme plus the OpenStreetMap attribution. */
function ArenaFooter({ showTouch }: ArenaFooterProps): React.JSX.Element {
  return (
    <p className="muted mx-2 my-1 shrink-0 text-center text-xs">
      <span>
        {showTouch
          ? "Sleep links op het scherm om te lopen of te sturen; rechts: Schieten, Instappen, Wapen."
          : "WASD of pijltjes lopen of sturen · muis richt en schiet · E instappen · Q wapen · Esc sluit."}
      </span>{" "}
      <span>{ATTRIBUTION_TEXT}</span>
    </p>
  );
}

/** `?debug=1` in a non-production build, read once on mount. */
function useDebugFlag(): boolean {
  const [debug] = useState(
    () =>
      typeof window !== "undefined" &&
      isDebugEnabled(window.location.search, process.env.NODE_ENV),
  );
  return debug;
}

/** Full-screen arena session: loading screen, canvas, HUD strip, touch controls, death screen, attribution. */
export default function CityArenaOverlay({
  zone,
  onClose,
}: CityArenaOverlayProps): ReactPortal | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stick = useMemo(() => createStick(), []);
  const debug = useDebugFlag();
  const showTouch = useShowTouchControls();
  const reducedMotion = useReducedMotion();
  const game = useArenaGame({ zoneKey: zone, canvasRef, debug, reducedMotion });
  useDialogFocusTrap(dialogRef, onClose);
  useLockBodyScroll();

  const overlay = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="GTA H3"
      tabIndex={-1}
      className="fixed inset-0 z-[3200] flex min-h-dvh flex-col touch-none select-none bg-[#0B1220] pt-safe pb-safe-bottom-bar pl-safe pr-safe [-webkit-user-select:none] [-webkit-touch-callout:none]"
      onContextMenu={(event) => event.preventDefault()}
    >
      <ArenaHudBar
        hud={game.hud}
        zones={game.zones}
        pickerDisabled={game.phase !== "playing"}
        showLoadWarning={game.phase === "playing" && game.failed}
        onTeleport={game.teleportToZone}
        onClose={onClose}
      />
      <ArenaPlayfield
        canvasRef={canvasRef}
        game={game}
        debug={debug}
        showTouch={showTouch}
        reducedMotion={reducedMotion}
        stick={stick}
      />
      <ArenaFooter showTouch={showTouch} />
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/cityArena/CityArenaOverlay.test.tsx`
Expected: PASS (6 tests). The Plan 2 assertions keep passing: the HUD still shows the zone, the street and "Ga naar"; the vitals add "Pistool ∞" and a `<progress>` labelled "Gezondheid".

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/components/cityArena/CityArenaOverlay.tsx src/components/cityArena/CityArenaOverlay.test.tsx
git add src/components/cityArena/CityArenaOverlay.tsx src/components/cityArena/CityArenaOverlay.test.tsx
git commit -m "feat(arena): show vitals, touch buttons and the death screen in the overlay

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Docs, spec updates, device check, verification and PR 3

**Files:**

- Modify: `docs/tech/arena/README.md` (add a "Runtime (PR 3)" section)
- Modify: `docs/superpowers/specs/2026-09-03-city-arena-design.md` §13 (files that now exist) and §16 (new UI strings)

- [ ] **Step 1: Document the runtime**

Append to `docs/tech/arena/README.md`:

```markdown
## Runtime (PR 3 — cars, weapons, death screen)

- Simulation: `src/lib/cityArena/sim/arena.ts` — `createArenaState(setup, random)` and one pure fixed-step
  `stepArena(state, input, dt, world, random)` (30 Hz, immutable `ArenaState`, seeded RNG injected, no DOM). Entity
  modules: `weapons` (spec §5 table + fist), `vehicle` (arcade physics, two-circle building collision), `bullets`
  (swept segments via `world/raycast`), `collisions` (car–car, car–player), `damage`, `effects`, `spawn` (8 parked
  cars per zone on spawn nodes, respawn node choice), `invariants` (`checkInvariants(state): string[]`).
- Rules: health 100, no regen; death → respawn after 90 ticks with a 60-tick blinking shield; Instappen within 1.5 m
  with a 0.6 s boarding delay; car health 100, smoke < 40, explosion at 0 (3 m, 80 damage, kills the occupant);
  the spawn loadout is pistol + Uzi 60 + shotgun 8 + fist until pickups arrive (Plan 4b).
- Input: `WorldInput = { move, aim: angle | null, fire, enter, weaponNext }`; keyboard WASD/arrows, Space, E/F/Enter, Q
  (`input/keyboard`), mouse aim + left button (`input/pointerAim`), floating stick + Schieten/Instappen/Wapen buttons on
  coarse pointers (`ArenaTouchButtons`). Enter/exit and weapon-next are edge-triggered inside the simulation.
- Rendering: `render/renderScene` draws world → zone ring → cars (`drawVehicles`) → bullets and effects
  (`drawProjectiles`) → player (`playerLook`: normal/dead/hidden/blink) → crosshair, with a `pushIn` transform for the
  death screen. `render/deathScreen.ts` is the pure beat function (slow-mo 0–0.3 s, slam at 0.3 s, fade 2.6–3.0 s);
  `components/cityArena/DeathOverlay.tsx` shows `public/branding/wasted-screen.{webp,jpg}`.
- HUD: `ArenaVitals` (health `<progress>`, weapon + ammo, km/u while driving) inside the HUD bar, refreshed at 10 Hz.
- Debug: `?debug=1` adds an entity/violation line to the panel and installs `window.__arena`
  (`getState()`, `dispatch(input, ticks)`, `damage(amount)`, `getViolations()`); invariant violations are also sent to
  Sentry as warnings (`kind: "invariant"`), once per distinct message per session.
```

In the spec's §13 file layout, move `vehicle · weapons · bullets · collisions · damage · effects · spawn · arena · invariants` out of the "(PR 4: …)" parenthesis of `sim/` into the real list, add `raycast` to `world/`, `pointerAim` to `input/`, `drawVehicles · drawProjectiles · deathScreen` to `render/`, `test/hooks` as real, and `DeathOverlay · ArenaVitals · ArenaTouchButtons` to `src/components/cityArena/`; leave `peds · cops · pickups · round · bots`, `radar · particles · feedback`, `haptics` and `Hud` as planned. In §16 append: "PR 3 additions: Gezondheid · Vuist · Pistool · Uzi · Shotgun · Compact · Sedan · Sportwagen · Politieauto · km/u · Je bent uitgeschakeld · Vrij rondlopen". Also note under §7's death screen paragraph that in single-player the slow motion scales the local simulation's `dt` (scope decision 6 of this plan) until Plan 3 moves it into the interpolation layer.

- [ ] **Step 2: Manual device check (preview env)**

```bash
npx dotenv -e .env.preview.local -v NEXTAUTH_URL=http://localhost:3000 -- next dev -p 3000
```

Log in as `trainer@example.test` / `preview123`, open the events page and play on **desktop Chrome**: parked cars stand on the streets of the chosen zone; walk to one, press E, the car takes 0.6 s to answer, W/S/A/D drive it, it bounces off buildings and never enters water, it smokes below 40 health and explodes when shot enough (5 pistol hits); the mouse crosshair aims, holding the left button auto-fires, Q cycles Vuist → Pistool → Uzi → Shotgun and the HUD ammo counts down; stand next to a car you are shooting to lose 80 health from the blast, then `window.__arena.damage(100)` in the console with `?debug=1` — the view desaturates and pushes in, the wasted artwork slams in at 0.3 s, fades to black at 2.6 s, and you respawn at a spawn node blinking for 2 s with full health; Esc still closes and focus returns; `?debug=1` shows the entity line and fps ≥ 50. Then on **a phone on the same Wi-Fi** (`http://<laptop-ip>:3000`): the stick is on the left, the three buttons are on the right above the footer and are ≥ 58 px, Schieten auto-fires in the facing direction, Instappen/Uitstappen toggles, driving with the stick works in portrait and landscape, the page never scrolls or zooms, and with "Reduce motion" enabled in the OS the artwork fades in without slow motion. Record fps, device model and observations in the PR description.

- [ ] **Step 3: Verification loop**

```bash
npm run lint && npx tsc --noEmit && npx vitest run && npm run build
```

Expected: all green (only the pre-existing `src/types/ical.d.ts` lint warning); `npm run build` succeeds with `/` unchanged.

- [ ] **Step 4: Commit docs**

```bash
npx prettier --write docs/tech/arena/README.md docs/superpowers/specs/2026-09-03-city-arena-design.md
git add docs
git commit -m "docs(arena): describe the cars, weapons and death-screen runtime

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: Open PR 3**

The controller confirms with the owner before pushing. Then:

```bash
git push -u origin feat/city-arena-plan4a
gh pr create --base image --title "feat(arena): cars, weapons and the death screen (3/7)" --body "$(cat <<'EOF'
## Summary

PR 3 of the GTA H3 stack (design `docs/superpowers/specs/2026-09-03-city-arena-design.md`, plan `docs/superpowers/plans/2026-09-04-city-arena-plan-4a-vehicles-weapons-death.md`). Gameplay lands before multiplayer per the owner's reordered roadmap; if PR 2 (`feat/city-arena-plan2`) has not merged yet, this PR is temporarily based on it and retargeted to `image` afterwards.

- Pure fixed-step `stepArena(state, input, dt, world, random)` with parked cars (enter/exit, arcade physics, damage, smoke, explosions), four weapons with swept bullets, 100 hp, death, 3 s respawn and a 2 s blinking shield, and an invariant checker.
- The owner's wasted artwork as the death screen: slow motion + push-in for 0.3 s, slam-in, fade to black, reduced-motion variant.
- HUD vitals, mouse aim with a crosshair, keyboard buttons, touch buttons next to the floating stick, `window.__arena` behind `?debug=1`.

## Verification

- Vitest: <N> new tests (weapons, vehicles, raycast, bullets, collisions, damage, effects, spawn, arena, invariants, input, render, death screen, components); lint/tsc/build green.
- Manual: desktop Chrome + <phone model> — <fps>, <observations>.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Fill in `<N>`, `<phone model>`, `<fps>` and `<observations>` from Steps 2–3 before creating the PR, then run the `loop-on-ci` workflow on it.

---

## Summary

| Task | Deliverable                                                                | New tests |
| ---- | -------------------------------------------------------------------------- | --------- |
| 1    | Input model with aim/buttons, arena types, weapon table, aim-aware walking | 12        |
| 2    | Car specs, body geometry, arcade physics, building collision               | 9         |
| 3    | Raycast helper, shot creation, swept bullet hits                           | 10        |
| 4    | Car–car and car–player collisions, damage rules, render effects            | 10        |
| 5    | Parked-car placement, road headings, respawn node choice                   | 5         |
| 6    | `createArenaState`, walking/driving, Instappen/Uitstappen, Wapen           | 7         |
| 7    | Firing, hits, explosions, death, respawn, invariants                       | 9         |
| 8    | Keyboard buttons, mouse aim, driving look-ahead                            | 6         |
| 9    | Car, bullet, effect and crosshair painters; player looks; scene order      | 10        |
| 10   | Death-screen beat function and `DeathOverlay`                              | 6         |
| 11   | HUD vitals and touch buttons                                               | 4         |
| 12   | `useArenaGame` on the arena state, `window.__arena`, debug line            | 6         |
| 13   | Overlay wiring                                                             | 2         |
| 14   | Docs, device check, verification, PR 3                                     | —         |

## Roadmap after this plan

| Plan | PR  | Deliverable                                                                                                                   | Depends on |
| ---- | --- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 4b   | 4/7 | Pedestrians, cops and wanted levels, pickups (spawn loadout back to pistol-only), zone out-of-bounds, radar, SFX              | This plan  |
| 3    | 5/7 | Transport, election, host loop running `stepArena` unchanged (players lifted to a map), prediction, lobby, rounds, scoreboard | This plan  |
| 5    | 6/7 | Persistence: migration, matches and leaderboard routes, launcher lists                                                        | Plan 3     |
| 6    | 7/7 | Twin-stick aim, haptics, feedback effects, settings UI, zoom-out while driving                                                | Plan 4b    |
| 7    | —   | Test seams beyond `window.__arena`, relay, Playwright DSL, CI jobs, TESTING.md                                                | Plans 3–6  |
