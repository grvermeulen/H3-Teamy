# GTA H3 — Crossable Bridges, Steering That Behaves and Faster Movement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three "feel and correctness" problems the owner hit playing the merged game — bridges that cannot be crossed because the water underneath still blocks, touch steering that wanders like a drunk driver, and walking that is too slow for the phone's view — without rebuilding the committed map asset and without breaking a single existing arena test.

**Architecture:** Three independent, purely additive changes to the existing pure simulation. (1) A new whole-map **road-corridor index** (`world/roadCorridor.ts`) built once from the resident road graph answers `isOnRoad(point, radiusM)`; `createCollisionGrid` consults it and skips `kind: "water"` obstacles while the resolved circle's centre sits on a road surface, so a bridge deck is walkable and drivable while open water and every building still block. (2) The input snapshot gains a `moveIsAnalog` flag and the touch stick gains a per-axis dead zone; a new pure `sim/driveInput.ts` maps an analog stick onto **heading-seeking** car controls (the car steers toward the direction the stick points) with a rate-limited steer command, while keyboard input keeps Plan 4a's tank steering, and `vehicle.ts` gains a grip floor so low-speed steering answers. (3) `sim/player.ts` walks faster through a short acceleration ramp, `render/camera.ts` gains tighter zoom levels plus a hysteretic speed-based zoom-out, and `render/staticRaster.ts`'s adaptive budget is re-derived for the extra pixels per metre.

**Tech Stack:** Next.js 16 App Router (client components), React 19, TypeScript 6.0.3 `strict`, Tailwind v4 utilities, Canvas 2D, Vitest 4 (jsdom) with the `@/` alias, `@sentry/nextjs`.

**Spec:** `docs/superpowers/specs/2026-09-03-city-arena-design.md` — §4 (road widths), §5 (walk speed 4 m/s, car physics and the `clamp(v/6, 0, 1)` grip curve), §7 (input model, touch stick), §8 (camera, zoom levels, chunk raster budget). Three spec constants change here; Task 6 amends the spec so it stops disagreeing with the code.

---

## Owner report and decisions

The owner played the merged game (Plan 1 + 2 + 4a + 4b) on desktop and on a phone and reported, verbatim:

> "The game is still very rudimentary. Graphics super basic and movement feels slow. Cant cross bridges (probably due to water crossing restrictions) and controlling a car direction is like I'm driving drunk when on mobile."

Three of those four are this plan. **Graphics are explicitly out of scope** — a separate plan covers the renderer; nothing here touches `drawStatic.ts`, `drawEntities.ts`, `drawVehicles.ts` or the palette's colours.

### What the code actually does today (verified in this worktree)

- **Bridges.** `world/collisionGrid.ts`'s `buildObstaclesForTile` inserts every `tile.water` polygon as a blocking obstacle tagged `kind: "water"`, and the map pipeline never captured OSM `bridge`/`layer` tags, so a road deck over water is blocked by the water beneath it. Measured on the committed asset: **66 road edges have their midpoint inside a water polygon** across 488 water polygons — including `Nudestraat` at (2466, 1743), 141 m from the Wageningen zone centre; `Duivendaal` (238 m); `Bowlespark` (360 m); plus `Pompmolen` (9 edges), `Rietveen` (9), `Turfsteker` (8), `Legakker` (6), `Grebbeweg` and `Rondweg-Oost`.
- **Steering.** `sim/arena.ts`'s `controlsFromInput` maps the movement stick straight onto the car: `{ throttle: -input.move[1], steer: input.move[0] }`. `input/touchStick.ts` applies only a **radial** dead zone (`STICK_DEAD_ZONE = 0.15`) to the whole vector, so a thumb held forward at any small angle steers continuously and never returns to centre. `sim/vehicle.ts`'s `turnRate` multiplies the steer by `grip = min(1, speed / STEER_FULL_SPEED_MPS)` with `STEER_FULL_SPEED_MPS = 6`, so below 6 m/s the wheel barely answers and then snaps.
- **Movement.** `sim/player.ts` has `WALK_SPEED_MPS = 4` and sets the position straight from the stick with **no acceleration at all** (verified: `stepPlayer` derives the displacement from `input.move` and `WALK_SPEED_MPS` only; `player.speed` is an output, never an integrator). `render/camera.ts` has `ZOOM_LEVELS = [4, 6, 8]` and `PHONE_VIEW_METRES = 60`; a 390 px phone therefore picks zoom 6 and shows 65 m across, which takes 16 s to cross on foot.

### Tuning decisions, with the numbers

| #   | Decision                                                                  | Value                                                                                                                     | Why this number                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Bridges are fixed at **runtime**, never by rebuilding the asset           | —                                                                                                                         | Rebuilding costs an Overpass run and would break the 1.2 MB gzip budget. `roads.json` is fully resident (513 KB, 13 774 nodes, 15 119 edges, 644.4 km of road, average edge 42.6 m, longest 810.8 m), so a corridor index over it costs no network at all.                                                                                                                                                                                                                                                                                                                           |
| 2   | Corridor half-width                                                       | `ROAD_WIDTH_M[class] / 2 + CORRIDOR_MARGIN_M`, `CORRIDOR_MARGIN_M = PAVEMENT_WIDTH_M = 2 m`                               | The corridor must cover exactly what the renderer paints as walkable: the carriageway plus its pavements. A residential bridge is 6 m wide → 3 m + 2 m = 5 m of half-width, which covers a player walking the pavement of the deck.                                                                                                                                                                                                                                                                                                                                                  |
| 3   | Corridor cell size                                                        | 16 m, identical to `COLLISION_CELL_M`                                                                                     | Same bucketing as the collision grid that queries it. Measured over the whole asset: **192 278 cell entries across 125 084 distinct cells, 1.54 entries per cell** — the query is effectively constant-time. Keys are packed numbers, not strings, because this index covers the whole 14 × 10 km map rather than the ≤ 9 resident tiles the collision grid holds.                                                                                                                                                                                                                   |
| 4   | Water is skipped only while the **resolved circle's centre** is on a road | —                                                                                                                         | Per-circle, so a car half on a bridge only gets the exemption for the hull circle that is actually on the deck. Away from roads water still blocks, so you still cannot swim. Known and accepted cost: beside a quay road you can wade about `CORRIDOR_MARGIN_M` (2 m) into the water before the water pushes you back.                                                                                                                                                                                                                                                              |
| 5   | Analog steering is **heading-seeking**                                    | `steer = clamp(headingError / ANALOG_STEER_FULL_ERROR_RAD)`, `ANALOG_STEER_FULL_ERROR_RAD = π/4` (45°)                    | The stick direction is the desired heading; the command is the signed angle from the car's heading to the stick, so releasing to centre stops steering instead of holding a turn. 45° is deliberately wider than the AI's `STEER_FULL_ERROR_RAD = π/6` so a thumb wobble does not reach full lock.                                                                                                                                                                                                                                                                                   |
| 6   | Pointing the stick behind the car brakes and reverses                     | `ANALOG_REVERSE_ERROR_RAD = 3π/4` (135°)                                                                                  | Above 135° of error the intent is "go back", not "spin". Below it the car turns toward the stick. Without this branch a touch player could never reverse out of a wall.                                                                                                                                                                                                                                                                                                                                                                                                              |
| 7   | Steering-command rate limit                                               | `STEER_COMMAND_RATE_PER_S = 6` (command units per second)                                                                 | Centre → full lock takes 1/6 s ≈ 0.167 s = 5 ticks at 30 Hz: fast enough to feel direct, slow enough that a flicked thumb cannot snap the wheel. At full grip this is 6 × 2.6 = 15.6 rad/s² of turn-rate change. Applied to the analog path only — the keyboard keeps its instant tank steering so `A`/`D` behave exactly as before.                                                                                                                                                                                                                                                 |
| 8   | Per-axis stick dead zone                                                  | `STICK_AXIS_DEAD_ZONE = 0.2`                                                                                              | A vector component below 0.2 snaps to zero (the other axis is left alone, never renormalised). A thumb held forward with a 10° wobble is `(0.17, 0.98)` → `(0, 0.98)`: dead straight. A genuine 45° push `(0.707, 0.707)` is untouched.                                                                                                                                                                                                                                                                                                                                              |
| 9   | Grip floor                                                                | `STEER_GRIP_FLOOR = 0.45`, gated by `STEER_MIN_SPEED_MPS = 0.5`                                                           | `grip = 0.45 + 0.55 · min(1, v/6)` above 0.5 m/s, `0` below it. At 3 m/s the turn rate rises from 1.211 rad/s (69 °/s) to 1.738 rad/s (100 °/s) — a 44 % gain exactly where the old curve felt dead. At and above 6 m/s the grip is still 1, so nothing about fast cornering changes. The 0.5 m/s gate keeps a parked car from pivoting on the spot.                                                                                                                                                                                                                                 |
| 10  | Walking speed                                                             | `WALK_SPEED_MPS = 5.5` (was 4)                                                                                            | A GTA2-style jog: 19.8 km/h. Crossing the new 45 m phone view takes 45 / 5.5 = **8.2 s** against 65 / 4 = 16.3 s today. The slowest car (compact, 22 m/s) is still 4× faster, so cars keep their point.                                                                                                                                                                                                                                                                                                                                                                              |
| 11  | Acceleration ramp on foot                                                 | `WALK_RAMP_S = 0.15 s`, `WALK_ACCEL_MPS2 = 5.5 / 0.15 = 36.667 m/s²`                                                      | Full speed in 5 ticks. Ramp-up only: releasing the stick still stops immediately, because a release ramp would add input latency exactly when a player is dodging, and `PlayerState` carries no velocity direction to decelerate along (`facing` follows the aim on desktop, not the movement).                                                                                                                                                                                                                                                                                      |
| 12  | Foot cops keep their edge                                                 | `COP_RUN_SPEED_MPS = 4.5 → 6`                                                                                             | Cops are +0.5 m/s on the player today (4.5 vs 4); 6 vs 5.5 preserves that exactly. Fleeing pedestrians stay at `PED_FLEE_SPEED_MPS = 5.5` — they already outran the player and now merely match, which changes nothing about being able to catch one on foot (you cannot, and should shoot or drive instead).                                                                                                                                                                                                                                                                        |
| 13  | Zoom levels                                                               | `ZOOM_LEVELS = [4, 6, 8, 10, 12]`, `PHONE_VIEW_METRES = 60 → 45`                                                          | 390 px phone: 390/45 = 8.67 → zoom **8** → 48.75 m across (was zoom 6, 65 m). 360 px: → zoom 8, 45.0 m. 430 px: 9.56 → zoom **10**, 43 m. Desktop keeps `DESKTOP_VIEW_METRES = 120` but gains the finer steps: 1400 px goes 11.67 → zoom **12** → 116.7 m (was zoom 8 → 175 m, badly over target).                                                                                                                                                                                                                                                                                   |
| 14  | Speed-based zoom-out while driving                                        | out at `ZOOM_OUT_SPEED_MPS = 12`, back at `ZOOM_IN_SPEED_MPS = 9`, one step                                               | 12 m/s = 43 km/h, 9 m/s = 32 km/h: a 3 m/s hysteresis band no car crosses by accident. One step widens the phone view from 48.75 m to 65 m. Walking at 5.5 m/s is far below 9 m/s, so the on-foot camera never triggers it and needs no separate branch.                                                                                                                                                                                                                                                                                                                             |
| 15  | Raster budget                                                             | `RASTER_WORKING_SET_HEADROOM = 1.5 → 2.5`, new `RASTER_BUDGET_MAX_BYTES = 96 MiB`, budget never below one raw working set | A chunk is 128 m; its bytes are `(128 · zoom)² · 4`: 1 MiB at zoom 4, 2.25 at 6, 4 at 8, 6.25 at 10, **9 MiB at 12**. While driving, two zoom sets are live at once. Phone 390 × 844: zoom 8 needs 4 chunks = 16 MiB, zoom 6 needs 6 = 13.5 MiB, 29.5 MiB total — inside the unchanged 40 MiB floor. Desktop 1400 × 900: zoom 12 needs 4 = 36 MiB, zoom 10 needs 6 = 37.5 MiB, 73.5 MiB total; `36 × 2.5 = 90 MiB` covers it. 4K at zoom 12 needs 12 chunks = 113 MiB, above the 96 MiB cap, so the formula floors at the raw working set and returns 113 MiB rather than thrashing. |
| 16  | `moveIsAnalog` lives on `WorldInput`                                      | `boolean`, default `false`                                                                                                | The device kind, not a new control axis — the simulation still receives `{ move, aim, fire, enter, weaponNext }` as its controls. It is one extra boolean per Plan 3 input packet and it defaults to `false`, so every existing test, the `window.__arena` dispatch seam and the whole keyboard path keep Plan 4a's exact driving behaviour.                                                                                                                                                                                                                                         |

---

## Global Constraints

- Node.js 22, Next.js 16 App Router, React 19, TypeScript 6.0.3 `strict`; Tailwind v4; Vitest 4 (jsdom) with the `@/` alias for `src/`.
- All user-facing strings Dutch (NL); identifiers English.
- No inline `style` props anywhere — Tailwind utility classes exclusively.
- JSDoc (`/** ... */`) on every exported function, type, constant and component; CodeRabbit enforces 80 % docstring coverage.
- Explicit return types on every exported function.
- No `any`, no unsafe `as` casts, no non-null assertions; `const list: Foo[] = []`, never `[] as Foo[]`; `vi.mocked(fn)`, never `(fn as any)`.
- Every function under 50 lines (closures count); every file under 800 lines.
- Named constants instead of magic numbers; descriptive full-word identifiers — single letters only inside geometry maths.
- Every `catch (error: unknown)` calls `Sentry.captureException(error, { tags: { area: "arena", kind } })` or re-throws; never a silent catch.
- Tests co-located with the source; `beforeEach(() => { vi.clearAllMocks(); })` in every `describe` that uses mocks; `afterEach(() => { cleanup(); })` in component suites; precise assertions.
- Conventional Commits, subject ≤ 72 characters, imperative mood; every commit body ends with the trailer line `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- The pre-commit hook runs Prettier, `npm run check:merge-conflicts`, ESLint, `tsc --noEmit` and the full Vitest suite; run `npx prettier --write <files>` before committing so the hook does not rewrite the staged set.
- `npm run lint` must report **exactly 2 accepted warnings** (`src/components/EventList.tsx`, `src/types/ical.d.ts`). Any third warning is a regression.
- Work happens in the worktree `.claude/worktrees/city-arena-plan4b` on branch `feat/arena-feel-and-controls`, based on `origin/image` at `97799d3`. The PR targets `image`.
- The committed map asset under `public/arena/map/v1/` is **read-only for this plan**. No task regenerates it.

---

## File structure

| Path                                                              | Responsibility                                                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/lib/cityArena/world/roadCorridor.ts` (create)                | Whole-map road-corridor index over the decoded road graph: `createRoadCorridors(graph)` → `isOnRoad(point, radiusM)` |
| `src/lib/cityArena/world/roadCorridor.test.ts` (create)           | Unit tests for corridor widths, cell bucketing and the query margin                                                  |
| `src/lib/cityArena/world/collisionGrid.ts` (modify)               | `RoadCorridorTest` seam, `setRoadCorridors`, water skipped while the circle centre is on a road                      |
| `src/lib/cityArena/world/worldSession.ts` (modify)                | Builds the corridor index once, right after `decodeRoadGraph`, and hands it to the grid                              |
| `src/lib/cityArena/input/touchStick.ts` (modify)                  | Per-axis dead zone (`STICK_AXIS_DEAD_ZONE`) applied to the emitted vector                                            |
| `src/lib/cityArena/input/inputState.ts` (modify)                  | `snapshot()` reports `moveIsAnalog` (true only while the stick drives movement)                                      |
| `src/lib/cityArena/sim/types.ts` (modify)                         | `WorldInput.moveIsAnalog`, `EMPTY_INPUT`, `createInput`, `ArenaPlayerState.driveSteer`                               |
| `src/lib/cityArena/sim/driveInput.ts` (create)                    | Pure movement-input → `VehicleControls` mapping: digital tank steering, analog heading-seeking, reverse, rate limit  |
| `src/lib/cityArena/sim/driveInput.test.ts` (create)               | Unit tests for both mappings, the reverse branch and the rate limit                                                  |
| `src/lib/cityArena/sim/vehicle.ts` (modify)                       | `STEER_GRIP_FLOOR`, `STEER_MIN_SPEED_MPS`, `steerGrip` inside `turnRate`                                             |
| `src/lib/cityArena/sim/arena.ts` (modify)                         | `controlsFromInput` replaced by `driveStep`; `driveSteer` carried on the player                                      |
| `src/lib/cityArena/sim/player.ts` (modify)                        | `WALK_SPEED_MPS = 5.5`, `WALK_RAMP_S`, `WALK_ACCEL_MPS2`, ramped `stepPlayer`                                        |
| `src/lib/cityArena/sim/cops.ts` (modify)                          | `COP_RUN_SPEED_MPS = 6` so foot cops keep their edge                                                                 |
| `src/lib/cityArena/render/camera.ts` (modify)                     | `ZOOM_LEVELS = [4, 6, 8, 10, 12]`, `PHONE_VIEW_METRES = 45`, `widerZoom`, `speedZoomLevel`                           |
| `src/lib/cityArena/render/staticRaster.ts` (modify)               | `RASTER_WORKING_SET_HEADROOM = 2.5`, `RASTER_BUDGET_MAX_BYTES`, budget never below one working set                   |
| `src/components/cityArena/arenaRuntime.ts` (modify)               | `Runtime.baseZoom`; `followPlayer` applies the speed-based zoom                                                      |
| `docs/tech/arena/README.md` (modify)                              | New "Runtime (PR 5 — bridges, steering and pace)" section                                                            |
| `docs/superpowers/specs/2026-09-03-city-arena-design.md` (modify) | §5, §7 and §8 amended for the changed constants                                                                      |

Coordinates are **metres** everywhere (`Point = [x, y]`, x east, y south); angles are radians with `0` = east and positive turning clockwise on screen; ticks are 30 Hz (`SIM_STEP_S = 1/30`). A car's local frame has x forward and y to the driver's right.

Task order matters: Task 1 → 2 (corridors before the grid consumes them), Task 3 → 4 (the flag before the mapping reads it). Task 5 is independent of Tasks 1–4, and Task 6 closes out all of them.

---

### Task 1: Road-corridor index

**Files:**

- Create: `src/lib/cityArena/world/roadCorridor.ts`
- Test: `src/lib/cityArena/world/roadCorridor.test.ts`

**Interfaces:**

- Consumes: `ROAD_WIDTH_M: Record<RoadClass, number>` and `PAVEMENT_WIDTH_M: number` from `../render/palette`; `distancePointToSegment(point: Point, a: Point, b: Point): number` and `type Rect = { minX; minY; maxX; maxY }` from `../mapBuild/geometry`; `COLLISION_CELL_M: number` from `./collisionGrid`; `type Point = [number, number]` from `./projection`; `type RoadGraph = { nodes: Point[]; edges: RoadGraphEdge[]; … }` and `type RoadGraphEdge = { a: number; b: number; roadClass: RoadClass; name?: string; oneway: boolean; length: number }` from `./roadGraph`.
- Produces: `CORRIDOR_CELL_M: number`, `CORRIDOR_MARGIN_M: number`, `type RoadCorridors = { isOnRoad(point: Point, radiusM: number): boolean; corridorCount(): number }`, `createRoadCorridors(graph: Pick<RoadGraph, "nodes" | "edges">): RoadCorridors`.

**Note on the signature.** The index is built from the **decoded** graph (`Pick<RoadGraph, "nodes" | "edges">`, metres) rather than from raw `MapRoads` (flat units), because `worldSession.loadReady` already calls `decodeRoadGraph(roads)` and decoding twice would double the work for no benefit. This mirrors `render/radar.ts`'s `createRadarRoadIndex(nodes, edges)`, which takes the same decoded shape.

- [ ] **Step 1: Write the failing test**

Create `src/lib/cityArena/world/roadCorridor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Point } from "./projection";
import type { RoadGraph } from "./roadGraph";
import {
  CORRIDOR_CELL_M,
  CORRIDOR_MARGIN_M,
  createRoadCorridors,
} from "./roadCorridor";

/** Two roads: a 6 m residential bar east along y = 0 and a 9 m primary bar south along x = 200. */
function graphFixture(): Pick<RoadGraph, "nodes" | "edges"> {
  const nodes: Point[] = [
    [0, 0],
    [100, 0],
    [200, 0],
    [200, 400],
  ];
  return {
    nodes,
    edges: [
      { a: 0, b: 1, roadClass: "residential", oneway: false, length: 100 },
      { a: 1, b: 2, roadClass: "residential", oneway: false, length: 100 },
      { a: 2, b: 3, roadClass: "primary", oneway: false, length: 400 },
    ],
  };
}

describe("createRoadCorridors", () => {
  it("matches the collision grid's cell size and the pavement margin", () => {
    expect(CORRIDOR_CELL_M).toBe(16);
    expect(CORRIDOR_MARGIN_M).toBe(2);
  });

  it("covers the carriageway plus its pavements and nothing beyond", () => {
    const corridors = createRoadCorridors(graphFixture());
    expect(corridors.corridorCount()).toBe(3);
    // residential: 6 m wide → half-width 3 m + 2 m margin = 5 m for a point radius of 0.
    expect(corridors.isOnRoad([50, 0], 0)).toBe(true);
    expect(corridors.isOnRoad([50, 4.9], 0)).toBe(true);
    expect(corridors.isOnRoad([50, 5.1], 0)).toBe(false);
    // primary: 9 m wide → half-width 4.5 m + 2 m margin = 6.5 m.
    expect(corridors.isOnRoad([206.4, 200], 0)).toBe(true);
    expect(corridors.isOnRoad([206.6, 200], 0)).toBe(false);
  });

  it("adds the query radius to the corridor half-width", () => {
    const corridors = createRoadCorridors(graphFixture());
    // 5 m half-width + 0.95 m car hull radius = 5.95 m of reach.
    expect(corridors.isOnRoad([50, 5.9], 0.95)).toBe(true);
    expect(corridors.isOnRoad([50, 6.0], 0.95)).toBe(false);
  });

  it("finds corridors bucketed in a neighbouring cell", () => {
    const corridors = createRoadCorridors(graphFixture());
    // y = 5.4 sits in cell row 0 while the segment's own centre line is on the row
    // boundary; the query box must still reach it. 5 m + 0.5 m radius = 5.5 m.
    expect(corridors.isOnRoad([CORRIDOR_CELL_M * 3 + 1, 5.4], 0.5)).toBe(true);
    expect(corridors.isOnRoad([CORRIDOR_CELL_M * 3 + 1, 5.6], 0.5)).toBe(false);
  });

  it("reports no road far from every segment and off the ends", () => {
    const corridors = createRoadCorridors(graphFixture());
    expect(corridors.isOnRoad([50, 40], 0.4)).toBe(false);
    expect(corridors.isOnRoad([-20, 0], 0.4)).toBe(false);
    expect(corridors.isOnRoad([2000, 2000], 0.4)).toBe(false);
  });

  it("skips edges whose endpoints are missing and still indexes the rest", () => {
    const broken: Pick<RoadGraph, "nodes" | "edges"> = {
      nodes: [
        [0, 0],
        [100, 0],
      ],
      edges: [
        { a: 0, b: 1, roadClass: "residential", oneway: false, length: 100 },
        { a: 0, b: 9, roadClass: "residential", oneway: false, length: 100 },
      ],
    };
    const corridors = createRoadCorridors(broken);
    expect(corridors.corridorCount()).toBe(1);
    expect(corridors.isOnRoad([50, 0], 0)).toBe(true);
  });

  it("returns false for an empty graph", () => {
    const corridors = createRoadCorridors({ nodes: [], edges: [] });
    expect(corridors.corridorCount()).toBe(0);
    expect(corridors.isOnRoad([0, 0], 1)).toBe(false);
  });
});
```

Worked numbers behind those assertions, all from `ROAD_WIDTH_M` in `render/palette.ts` and `CORRIDOR_MARGIN_M = PAVEMENT_WIDTH_M = 2`:

- `residential` is 6 m → half-width `6 / 2 + 2 = 5.0` m. With radius 0 the boundary is at `|y| = 5.0`; 4.9 is inside, 5.1 outside.
- `primary` is 9 m → half-width `9 / 2 + 2 = 6.5` m. The bar runs along `x = 200`, so the boundary is at `x = 206.5`; 206.4 is inside, 206.6 outside.
- With the car hull radius `HULL_CIRCLE_RADIUS_M = 0.95` the reach is `5.0 + 0.95 = 5.95` m; 5.9 is inside, 6.0 outside.
- The neighbouring-cell case uses `x = 3 · 16 + 1 = 49`, a point in cell `(3, 0)`, at `y = 5.4` with radius 0.5: reach `5.0 + 0.5 = 5.5` m, so 5.4 passes and 5.6 fails. It only passes if the query visits every cell the probe box `[48.5, 49.5] × [4.9, 5.9]` touches.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/cityArena/world/roadCorridor.test.ts`
Expected: FAIL — `Failed to resolve import "./roadCorridor"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/cityArena/world/roadCorridor.ts`:

```ts
import { distancePointToSegment, type Rect } from "../mapBuild/geometry";
import { PAVEMENT_WIDTH_M, ROAD_WIDTH_M } from "../render/palette";
import { COLLISION_CELL_M } from "./collisionGrid";
import type { Point } from "./projection";
import type { RoadGraph } from "./roadGraph";

/** Cell size of the corridor index; identical to {@link COLLISION_CELL_M} so both bucket world space alike. */
export const CORRIDOR_CELL_M = COLLISION_CELL_M;

/**
 * Extra half-width beyond the painted carriageway. A bridge deck also carries the pavements the
 * renderer draws beside the road, so a player walking the pavement of a bridge must still count
 * as being on it.
 */
export const CORRIDOR_MARGIN_M = PAVEMENT_WIDTH_M;

/**
 * Multiplier packing a cell's x coordinate into a numeric bucket key. The map spans roughly
 * 900 × 650 cells, far inside the ±500 000 the stride allows, and numeric keys keep this
 * whole-map index (125 084 cells) several megabytes lighter than string keys would.
 */
const CELL_KEY_STRIDE = 1_000_000;

/** One road segment with the half-width of the drivable surface around its centre line. */
type Corridor = { start: Point; end: Point; halfWidthM: number };

/** Whole-map index answering "does this circle sit on a road surface?". */
export type RoadCorridors = {
  isOnRoad(point: Point, radiusM: number): boolean;
  corridorCount(): number;
};

/** Bucket key for one cell coordinate. */
function cellKey(cellX: number, cellY: number): number {
  return cellX * CELL_KEY_STRIDE + cellY;
}

/** Visits the key of every cell `bounds` overlaps, flooring so the grid extends into negative coordinates. */
function forEachCorridorCell(bounds: Rect, visit: (key: number) => void): void {
  const minCellX = Math.floor(bounds.minX / CORRIDOR_CELL_M);
  const maxCellX = Math.floor(bounds.maxX / CORRIDOR_CELL_M);
  const minCellY = Math.floor(bounds.minY / CORRIDOR_CELL_M);
  const maxCellY = Math.floor(bounds.maxY / CORRIDOR_CELL_M);
  for (let cellY = minCellY; cellY <= maxCellY; cellY++)
    for (let cellX = minCellX; cellX <= maxCellX; cellX++)
      visit(cellKey(cellX, cellY));
}

/** The segment's bounding box grown by its own half-width. */
function corridorBounds(corridor: Corridor): Rect {
  return {
    minX: Math.min(corridor.start[0], corridor.end[0]) - corridor.halfWidthM,
    minY: Math.min(corridor.start[1], corridor.end[1]) - corridor.halfWidthM,
    maxX: Math.max(corridor.start[0], corridor.end[0]) + corridor.halfWidthM,
    maxY: Math.max(corridor.start[1], corridor.end[1]) + corridor.halfWidthM,
  };
}

/** One corridor per graph edge whose two endpoints both exist. */
function buildCorridors(graph: Pick<RoadGraph, "nodes" | "edges">): Corridor[] {
  const corridors: Corridor[] = [];
  for (const edge of graph.edges) {
    const start = graph.nodes[edge.a];
    const end = graph.nodes[edge.b];
    if (!start || !end) continue;
    corridors.push({
      start,
      end,
      halfWidthM: ROAD_WIDTH_M[edge.roadClass] / 2 + CORRIDOR_MARGIN_M,
    });
  }
  return corridors;
}

/** Buckets every corridor into each cell its inflated bounding box overlaps. */
function bucketCorridors(corridors: Corridor[]): Map<number, number[]> {
  const buckets = new Map<number, number[]>();
  corridors.forEach((corridor, index) => {
    forEachCorridorCell(corridorBounds(corridor), (key) => {
      const list = buckets.get(key);
      if (list) list.push(index);
      else buckets.set(key, [index]);
    });
  });
  return buckets;
}

/**
 * True when any bucketed corridor comes within `halfWidthM + radiusM` of `point`. Querying every
 * cell the probe box `point ± radiusM` touches is what makes the bounding-box bucketing exact:
 * a corridor within reach always has its inflated box overlapping at least one queried cell.
 */
function anyCorridorCovers(
  corridors: Corridor[],
  buckets: Map<number, number[]>,
  point: Point,
  radiusM: number,
): boolean {
  const probe: Rect = {
    minX: point[0] - radiusM,
    minY: point[1] - radiusM,
    maxX: point[0] + radiusM,
    maxY: point[1] + radiusM,
  };
  let covered = false;
  forEachCorridorCell(probe, (key) => {
    if (covered) return;
    for (const index of buckets.get(key) ?? []) {
      const corridor = corridors[index];
      const distance = distancePointToSegment(
        point,
        corridor.start,
        corridor.end,
      );
      if (distance <= corridor.halfWidthM + radiusM) {
        covered = true;
        return;
      }
    }
  });
  return covered;
}

/**
 * Builds the whole-map road-corridor index from the decoded road graph. Every edge becomes a
 * segment whose half-width is its class width from {@link ROAD_WIDTH_M} plus
 * {@link CORRIDOR_MARGIN_M}; the segments are bucketed into {@link CORRIDOR_CELL_M} cells so
 * `isOnRoad` answers in roughly constant time (1.54 corridors per cell on the shipped map).
 */
export function createRoadCorridors(
  graph: Pick<RoadGraph, "nodes" | "edges">,
): RoadCorridors {
  const corridors = buildCorridors(graph);
  const buckets = bucketCorridors(corridors);
  return {
    isOnRoad: (point, radiusM) =>
      anyCorridorCovers(corridors, buckets, point, radiusM),
    corridorCount: () => corridors.length,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/cityArena/world/roadCorridor.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Type-check and lint the new file**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: no errors; `npm run lint` still reports exactly the 2 accepted warnings.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/world/roadCorridor.ts src/lib/cityArena/world/roadCorridor.test.ts
git add src/lib/cityArena/world/roadCorridor.ts src/lib/cityArena/world/roadCorridor.test.ts
git commit -m "feat(arena): index road corridors for bridge crossings

Buckets every road-graph edge into 16 m cells with its class width plus
the pavement margin, so the collision grid can ask whether a circle sits
on a road surface.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The collision grid lets road corridors cross water

**Files:**

- Modify: `src/lib/cityArena/world/collisionGrid.ts` (the `CollisionGrid` type, `resolveCircleAgainst`, `createCollisionGrid`)
- Modify: `src/lib/cityArena/world/worldSession.ts` (`loadReady`)
- Test: `src/lib/cityArena/world/collisionGrid.test.ts` (add one `describe`), `src/lib/cityArena/world/worldSession.test.ts` (add one `it`)

**Interfaces:**

- Consumes: `createRoadCorridors(graph: Pick<RoadGraph, "nodes" | "edges">): RoadCorridors` from Task 1; existing `Obstacle`, `pushCircleOutOfRing`, `COLLISION_CELL_M`; `HULL_CIRCLE_OFFSET_M = 1.1` and `HULL_CIRCLE_RADIUS_M = 0.95` from `../sim/vehicle` (test only).
- Produces: `type RoadCorridorTest = { isOnRoad(point: Point, radiusM: number): boolean }`; `CollisionGrid` gains `setRoadCorridors(corridors: RoadCorridorTest | null): void`; `createCollisionGrid(cellMetres?: number, corridors?: RoadCorridorTest | null): CollisionGrid`.

**Why a structural `RoadCorridorTest` instead of importing `RoadCorridors`.** `roadCorridor.ts` imports `COLLISION_CELL_M` from `collisionGrid.ts`. Declaring the capability the grid needs locally keeps the dependency one-way (`roadCorridor` → `collisionGrid`) with no import cycle at all, and lets tests pass a two-line stub.

**Why a setter rather than only a constructor argument.** `createWorldSessionState` builds the collision grid synchronously, before `ready()` has fetched `roads.json`. The corridors therefore have to be installed later. The constructor argument stays for tests and for any future caller that has the graph up front.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/cityArena/world/collisionGrid.test.ts` (the file's existing `tileWith(buildings, water, x, y)` helper already accepts water rings):

```ts
import { HULL_CIRCLE_OFFSET_M, HULL_CIRCLE_RADIUS_M } from "../sim/vehicle";
import { createRoadCorridors } from "./roadCorridor";
import type { RoadGraph } from "./roadGraph";

/** A river band y ∈ [−6, 6] spanning x ∈ [−100, 100]. */
const RIVER: Point[] = [
  [-100, -6],
  [100, -6],
  [100, 6],
  [-100, 6],
];

/** A hut inside the bridge's corridor, to prove buildings are never exempted. */
const HUT: Point[] = [
  [2, -30],
  [4, -30],
  [4, -28],
  [2, -28],
];

/**
 * A residential bridge running north–south along x = 0 across the river, and a residential quay
 * along y = 9 whose southern kerb (9 − 3 = 6) sits exactly on the north bank.
 */
function bridgeGraph(): Pick<RoadGraph, "nodes" | "edges"> {
  return {
    nodes: [
      [0, -40],
      [0, 40],
      [20, 9],
      [90, 9],
    ],
    edges: [
      { a: 0, b: 1, roadClass: "residential", oneway: false, length: 80 },
      { a: 2, b: 3, roadClass: "residential", oneway: false, length: 70 },
    ],
  };
}

describe("collision grid road corridors", () => {
  it("still blocks water on a bridge when no corridors are installed", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([], [RIVER]));
    const pushed = grid.resolveCircle([0, 2], 0.4);
    expect(pushed[0]).toBeCloseTo(0);
    expect(pushed[1]).toBeCloseTo(6.4);
  });

  it("lets a walker cross the bridge and pushes them out beside it", () => {
    const grid = createCollisionGrid();
    grid.setRoadCorridors(createRoadCorridors(bridgeGraph()));
    grid.insertTile(tileWith([], [RIVER]));
    expect(grid.resolveCircle([0, 2], 0.4)).toEqual([0, 2]);
    const beside = grid.resolveCircle([5.6, 2], 0.4);
    expect(beside[0]).toBeCloseTo(5.6);
    expect(beside[1]).toBeCloseTo(6.4);
  });

  it("carries both car hull circles across and stops the one that leaves the deck", () => {
    const grid = createCollisionGrid();
    grid.setRoadCorridors(createRoadCorridors(bridgeGraph()));
    grid.insertTile(tileWith([], [RIVER]));
    // Heading south: both circles sit on the centre line.
    for (const offset of [HULL_CIRCLE_OFFSET_M, -HULL_CIRCLE_OFFSET_M]) {
      expect(grid.resolveCircle([0, offset], HULL_CIRCLE_RADIUS_M)).toEqual([
        0,
        offset,
      ]);
    }
    // Heading east, centred 6.5 m off the deck: the rear circle is still on it.
    expect(grid.resolveCircle([5.4, 2], HULL_CIRCLE_RADIUS_M)).toEqual([
      5.4, 2,
    ]);
    const front = grid.resolveCircle([7.6, 2], HULL_CIRCLE_RADIUS_M);
    expect(front[0]).toBeCloseTo(7.6);
    expect(front[1]).toBeCloseTo(6.95);
  });

  it("still pushes a swimmer out of open water away from every road", () => {
    const grid = createCollisionGrid();
    grid.setRoadCorridors(createRoadCorridors(bridgeGraph()));
    grid.insertTile(tileWith([], [RIVER]));
    const pushed = grid.resolveCircle([-60, 2], 0.4);
    expect(pushed[0]).toBeCloseTo(-60);
    expect(pushed[1]).toBeCloseTo(6.4);
  });

  it("lets a quay road reach two metres into the water and no further", () => {
    const grid = createCollisionGrid();
    grid.setRoadCorridors(createRoadCorridors(bridgeGraph()));
    grid.insertTile(tileWith([], [RIVER]));
    expect(grid.resolveCircle([60, 5], 0.4)).toEqual([60, 5]);
    const pushed = grid.resolveCircle([60, 3.5], 0.4);
    expect(pushed[0]).toBeCloseTo(60);
    expect(pushed[1]).toBeCloseTo(6.4);
  });

  it("keeps buildings solid inside a road corridor", () => {
    const grid = createCollisionGrid();
    grid.setRoadCorridors(createRoadCorridors(bridgeGraph()));
    grid.insertTile(tileWith([HUT], [RIVER]));
    const pushed = grid.resolveCircle([1.8, -29], 0.4);
    expect(pushed[0]).toBeCloseTo(1.6);
    expect(pushed[1]).toBeCloseTo(-29);
  });
});
```

Worked numbers, all derived from the residential half-width `6 / 2 + 2 = 5.0` m:

- `[0, 2]` with radius 0.4: distance to the bridge centre line is 0, so the water is skipped and the point is returned untouched. Without corridors the centre is inside the river ring; the nearest boundary is `y = 6` (4 m away) against `y = −6` (8 m), so it is ejected to `6 + 0.4 = 6.4`.
- `[5.6, 2]` with radius 0.4: `5.6 > 5.0 + 0.4 = 5.4`, so the water blocks and the same ejection gives `6.4`.
- Car hull, `HULL_CIRCLE_RADIUS_M = 0.95`: reach is `5.0 + 0.95 = 5.95` m. `5.4 ≤ 5.95` → the rear circle passes; `7.6 > 5.95` → the front circle is ejected to `6 + 0.95 = 6.95`.
- `[-60, 2]`: 60 m from the bridge and 80.3 m from the quay's nearest endpoint `(20, 9)` — no corridor, so the swimmer is ejected to `6.4`.
- Quay at `y = 9`: the corridor reaches `9 − 5.0 = 4.0` (`9 − 5.4 = 3.6` for a 0.4 m circle) while the bank is at `y = 6`, which is the documented ≈ 2 m wade. `[60, 5]` is inside it and stays; `[60, 3.5]` is `5.5 > 5.4` away and is ejected to `6.4`.
- Hut at `x ∈ [2, 4]`, `y ∈ [−28, −30]`: `[1.8, −29]` is 0.2 m outside its west face, inside the bridge corridor, and is still pushed to `2 − 0.4 = 1.6`.

Append to `src/lib/cityArena/world/worldSession.test.ts`, inside the existing `describe("createWorldSession", …)`:

```ts
it("installs road corridors on ready so a bridge road crosses water", async () => {
  const bridgeFetch = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith("index.json"))
      return new Response(JSON.stringify(index), { status: 200 });
    if (url.endsWith("roads.json"))
      return new Response(
        JSON.stringify({
          nodes: [0, 0, 400, 0],
          edges: [0, 1, 0, -1, 0, 400],
          classes: ["residential"],
          names: [],
        }),
        { status: 200 },
      );
    const match = /tile_(\d+)_(\d+)\.json$/.exec(url);
    if (!match) return new Response("null", { status: 404 });
    const tileX = Number(match[1]);
    const tileY = Number(match[2]);
    const water =
      tileX === 1 && tileY === 1
        ? [{ points: [120, -80, 280, -80, 280, 80, 120, 80] }]
        : [];
    return new Response(
      JSON.stringify({
        x: tileX,
        y: tileY,
        roads: [],
        buildings: [],
        ground: [],
        water,
      }),
      { status: 200 },
    );
  });
  const session = createWorldSession({
    loader: createMapLoader({
      baseUrl: "/map",
      fetchImpl: bridgeFetch,
      sleep: async () => {},
    }),
    canvasFactory: (width, height) => createFakeTarget(width, height),
  });
  await session.ready();
  await session.update([0, 0]);
  expect(session.collision.obstacleCount()).toBe(1);
  expect(session.collision.resolveCircle([50, 0], 0.4)).toEqual([50, 0]);
  const pushed = session.collision.resolveCircle([50, 10], 0.4);
  expect(pushed[0]).toBeCloseTo(50);
  expect(pushed[1]).toBeCloseTo(20.4);
});
```

Worked numbers: the fixture's road runs from `(0, 0)` to `(100, 0)` metres (400 units / 4 units per metre) and is `residential`, so its corridor half-width is 5 m. The water ring `[120, −80, 280, −80, 280, 80, 120, 80]` units is the band `x ∈ [30, 70]`, `y ∈ [−20, 20]` metres. `[50, 0]` sits on the road and passes; `[50, 10]` is `10 > 5.4` off it, is inside the band, and its nearest edge is `y = 20` (10 m) against `y = −20` (30 m), `x = 30` (20 m) and `x = 70` (20 m), so it is ejected to `20 + 0.4 = 20.4`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/world/collisionGrid.test.ts src/lib/cityArena/world/worldSession.test.ts`
Expected: FAIL — `grid.setRoadCorridors is not a function`, and the bridge points are pushed instead of returned.

- [ ] **Step 3: Add the corridor seam to the collision grid**

In `src/lib/cityArena/world/collisionGrid.ts`, add the capability type next to `Obstacle`:

```ts
/**
 * The road-corridor test the grid consults before treating water as solid. Implemented by
 * `createRoadCorridors` in `roadCorridor.ts`; declared here so the dependency stays one-way.
 */
export type RoadCorridorTest = {
  isOnRoad(point: Point, radiusM: number): boolean;
};
```

Extend the `CollisionGrid` type with one member:

```ts
export type CollisionGrid = {
  insertTile(tile: DecodedTile): void;
  removeTile(x: number, y: number): void;
  query(rect: Rect): Obstacle[];
  resolveCircle(centre: Point, radius: number): Point;
  obstacleCount(): number;
  /** Installs (or clears with `null`) the corridors that make water crossable on a road. */
  setRoadCorridors(corridors: RoadCorridorTest | null): void;
};
```

Add the skip predicate above `resolveCircleAgainst`:

```ts
/**
 * True for a water obstacle this circle may ignore because its centre sits on a road surface —
 * the runtime stand-in for the OSM `bridge` tag the map asset never captured. Buildings are
 * never exempt, and water away from a road corridor still blocks, so swimming stays impossible.
 */
function crossesOnBridge(
  obstacle: Obstacle,
  centre: Point,
  radius: number,
  corridors: RoadCorridorTest | null,
): boolean {
  if (obstacle.kind !== "water" || corridors === null) return false;
  return corridors.isOnRoad(centre, radius);
}
```

Thread the corridors through `resolveCircleAgainst`:

```ts
function resolveCircleAgainst(
  index: SpatialIndex,
  centre: Point,
  radius: number,
  corridors: RoadCorridorTest | null,
): Point {
  let position: Point = [centre[0], centre[1]];
  for (let pass = 0; pass < MAX_RESOLVE_PASSES; pass++) {
    const probe: Rect = {
      minX: position[0] - radius,
      minY: position[1] - radius,
      maxX: position[0] + radius,
      maxY: position[1] + radius,
    };
    let moved = false;
    for (const obstacle of index.query(probe)) {
      if (crossesOnBridge(obstacle, position, radius, corridors)) continue;
      const pushed = pushCircleOutOfRing(position, radius, obstacle.ring);
      if (pushed) {
        position = pushed;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return position;
}
```

And let `createCollisionGrid` hold them:

```ts
/**
 * Creates an empty grid; tiles are inserted/removed as the loader streams them. Pass or install
 * road corridors to make water crossable wherever a road runs over it (see `roadCorridor.ts`);
 * without them every water polygon blocks, exactly as before.
 */
export function createCollisionGrid(
  cellMetres = COLLISION_CELL_M,
  corridors: RoadCorridorTest | null = null,
): CollisionGrid {
  if (!Number.isFinite(cellMetres) || cellMetres <= 0) {
    throw new Error(
      `cellMetres must be a finite number greater than 0, got ${cellMetres}`,
    );
  }
  const index = createSpatialIndex(cellMetres);
  let roadCorridors = corridors;
  return {
    insertTile: index.insertTile,
    removeTile: index.removeTile,
    query: index.query,
    resolveCircle: (centre, radius) =>
      resolveCircleAgainst(index, centre, radius, roadCorridors),
    obstacleCount: index.obstacleCount,
    setRoadCorridors: (next) => {
      roadCorridors = next;
    },
  };
}
```

- [ ] **Step 4: Build the corridors in the world session**

In `src/lib/cityArena/world/worldSession.ts`, add the import:

```ts
import { createRoadCorridors } from "./roadCorridor";
```

and install them inside `loadReady`'s `then`, right after the graph is decoded:

```ts
    .then(([index, roads]) => {
      const graph = decodeRoadGraph(roads);
      state.collision.setRoadCorridors(createRoadCorridors(graph));
      state.loadedIndex = index;
      state.loadedGraph = graph;
      for (const [key, info] of buildLandmarkLookup(index)) {
        state.landmarks.set(key, info);
      }
      return { index, graph };
    })
```

Extend the `WorldSession` doc comment so the ordering requirement is explicit:

```ts
/**
 * Owns one loaded map at runtime: keeps the collision grid and the raster cache consistent with
 * the tiles the loader currently holds resident, and exposes landmarks and loaded tile
 * rectangles for the renderer. Call {@link WorldSession.ready} before {@link WorldSession.update}
 * — `ready()` is also what installs the road corridors that let bridges cross water, so a grid
 * queried before it resolves treats every water polygon as solid.
 */
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/world`
Expected: PASS — the six new collision-grid cases, the new world-session case and every existing `world/` test, including `collisionGrid.test.ts`'s `resolveCircle` assertions (they build grids without corridors, so nothing about them changes).

- [ ] **Step 6: Run the whole arena suite**

Run: `npx vitest run src/lib/cityArena src/components/cityArena`
Expected: PASS. `sim/peds.ts`, `sim/cops.ts` and `sim/traffic.ts` all consume `Pick<CollisionGrid, "resolveCircle">` and their tests inject their own two-line stubs, so the widened `CollisionGrid` type does not reach them.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/cityArena/world/collisionGrid.ts src/lib/cityArena/world/collisionGrid.test.ts src/lib/cityArena/world/worldSession.ts src/lib/cityArena/world/worldSession.test.ts
git add src/lib/cityArena/world/collisionGrid.ts src/lib/cityArena/world/collisionGrid.test.ts src/lib/cityArena/world/worldSession.ts src/lib/cityArena/world/worldSession.test.ts
git commit -m "fix(arena): let roads cross water so bridges are passable

Water polygons stop blocking a circle whose centre sits on a road
corridor, on foot and per car hull circle. Buildings and open water are
unchanged, so swimming is still impossible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Analog movement flag and the stick's per-axis dead zone

**Files:**

- Modify: `src/lib/cityArena/sim/types.ts` (`WorldInput`, `EMPTY_INPUT`, `createInput`)
- Modify: `src/lib/cityArena/input/inputState.ts` (`snapshot`)
- Modify: `src/lib/cityArena/input/touchStick.ts` (`STICK_AXIS_DEAD_ZONE`, `createStick`)
- Test: `src/lib/cityArena/input/inputState.test.ts` (one assertion changes, one test is added), `src/lib/cityArena/input/touchStick.test.ts` (two tests added)

**Interfaces:**

- Consumes: existing `WorldInput`, `EMPTY_INPUT`, `createInput`, `InputState`, `StickController`, `STICK_RADIUS_PX = 48`, `STICK_DEAD_ZONE = 0.15`.
- Produces: `WorldInput` gains `moveIsAnalog: boolean`; `EMPTY_INPUT.moveIsAnalog === false`; `createInput` defaults it to `false`; `InputState.snapshot()` reports `moveIsAnalog === (stick !== null)`; `STICK_AXIS_DEAD_ZONE = 0.2`; `createStick(radiusPx?, deadZone?, axisDeadZone?)`.

**Where the flag comes from.** The only producer of analog movement is the floating touch stick, and it reaches the input state through exactly one call: `TouchStick → onVector → useArenaGame.setInputVector → InputState.setStick(vector | null)`. So `moveIsAnalog` is simply `stick !== null` inside `snapshot()` — no new plumbing, and **the keyboard path sets it false for free** because `attachKeyboard` only ever calls `setKeyboard`/`clearKeyboard`, never `setStick`. `window.__arena.dispatch(input, ticks)` takes `Partial<WorldInput>`, so a debug dispatch can now opt into the analog mapping by passing `moveIsAnalog: true`; omitting it keeps Plan 4a's tank steering.

- [ ] **Step 1: Write the failing tests**

In `src/lib/cityArena/input/touchStick.test.ts`, extend the import and add two tests:

```ts
import {
  STICK_AXIS_DEAD_ZONE,
  STICK_RADIUS_PX,
  createStick,
} from "./touchStick";
```

```ts
it("zeroes a component inside the per-axis dead zone so a held thumb drives straight", () => {
  expect(STICK_AXIS_DEAD_ZONE).toBe(0.2);
  const stick = createStick();
  stick.begin(1, 0, 0);
  stick.move(1, 8, -47);
  // |x| would be 0.166 — a 9.6° thumb wobble — and snaps to zero, while y is
  // left exactly as it was rather than renormalised back up to 1.
  expect(stick.state().vector[0]).toBe(0);
  expect(stick.state().vector[1]).toBeCloseTo(-0.978, 3);
});

it("keeps both components of a genuine diagonal", () => {
  const stick = createStick();
  stick.begin(1, 0, 0);
  stick.move(1, 34, -34);
  expect(stick.state().vector[0]).toBeCloseTo(Math.SQRT1_2, 4);
  expect(stick.state().vector[1]).toBeCloseTo(-Math.SQRT1_2, 4);
});
```

Worked numbers for `move(1, 8, -47)` with `radiusPx = 48`, `deadZone = 0.15`, `axisDeadZone = 0.2`:

- `distance = hypot(8, 47) = 47.6760`; `clamped = min(1, 47.6760 / 48) = 0.993250`.
- `unitX = 8 / 47.6760 = 0.167797`; `unitY = −47 / 47.6760 = −0.985807`.
- `magnitude = (0.993250 − 0.15) / 0.85 = 0.992059`.
- Pre-snap vector `[0.166465, −0.978030]`; `|0.166465| < 0.2`, so x becomes `0`, y stays `−0.978030`.

For `move(1, 34, -34)`: `distance = 48.0833`, `clamped = 1`, `magnitude = (1 − 0.15) / 0.85 = 1`, `unitX = 34 / 48.0833 = 0.707107`, so the vector is `[0.707107, −0.707107]` and both components clear the 0.2 dead zone untouched.

In `src/lib/cityArena/input/inputState.test.ts`, change the one exhaustive assertion (line 22) and add a test:

```ts
expect(state.snapshot()).toEqual({
  move: [0, 0],
  moveIsAnalog: false,
  aim: null,
  fire: false,
  enter: false,
  weaponNext: false,
});
```

```ts
it("marks movement analog only while a finger owns the stick", () => {
  const state = createInputState();
  expect(state.snapshot().moveIsAnalog).toBe(false);
  state.setKeyboard([1, 0]);
  expect(state.snapshot().moveIsAnalog).toBe(false);
  state.setStick([0.3, -0.4]);
  expect(state.snapshot()).toMatchObject({
    move: [0.3, -0.4],
    moveIsAnalog: true,
  });
  state.setStick([0, 0]);
  expect(state.snapshot().moveIsAnalog).toBe(true);
  state.setStick(null);
  expect(state.snapshot()).toMatchObject({
    move: [1, 0],
    moveIsAnalog: false,
  });
});
```

A centred-but-held stick (`[0, 0]`) stays analog on purpose: the finger is still down, so the driving mapping must keep rate-limiting the steer command back toward zero rather than snapping to the keyboard's tank steering for one tick.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/input`
Expected: FAIL — `STICK_AXIS_DEAD_ZONE` is not exported, the snapshot has no `moveIsAnalog`, and `[0.166, −0.978]` is returned instead of `[0, −0.978]`.

- [ ] **Step 3: Add `moveIsAnalog` to the input model**

In `src/lib/cityArena/sim/types.ts`:

```ts
/**
 * Device-agnostic input (spec §7): a movement vector with length ≤ 1 (x east, y south), an
 * aim angle in radians or `null` to fire along the facing, and three held buttons.
 * `moveIsAnalog` is the device kind, not a control: it is true only while a touch stick drives
 * `move`, and it selects the heading-seeking car steering in `driveInput.ts`. Keyboard and
 * replayed/debug inputs leave it false and keep the original tank steering.
 */
export type WorldInput = {
  move: [number, number];
  moveIsAnalog: boolean;
  aim: number | null;
  fire: boolean;
  enter: boolean;
  weaponNext: boolean;
};

/** An input with nothing pressed. */
export const EMPTY_INPUT: WorldInput = {
  move: [0, 0],
  moveIsAnalog: false,
  aim: null,
  fire: false,
  enter: false,
  weaponNext: false,
};

/** Builds a full input from the fields a test or a debug dispatch cares about. */
export function createInput(partial: Partial<WorldInput>): WorldInput {
  return {
    move: partial.move ?? [0, 0],
    moveIsAnalog: partial.moveIsAnalog ?? false,
    aim: partial.aim ?? null,
    fire: partial.fire ?? false,
    enter: partial.enter ?? false,
    weaponNext: partial.weaponNext ?? false,
  };
}
```

- [ ] **Step 4: Report it from the input state**

In `src/lib/cityArena/input/inputState.ts`, the snapshot becomes:

```ts
    snapshot: () => ({
      ...EMPTY_INPUT,
      move: clampToUnit(stick ?? keyboard),
      moveIsAnalog: stick !== null,
      aim,
      fire: held("fire"),
      enter: held("enter"),
      weaponNext: held("weaponNext"),
    }),
```

and the type's doc comment gains the reason:

```ts
/**
 * Merges keyboard movement, the floating stick, held buttons and the aim into one
 * {@link WorldInput}; the stick wins over keyboard movement while a finger is down, and the
 * snapshot reports which of the two produced `move` so the car steering can pick its mapping.
 */
```

- [ ] **Step 5: Add the per-axis dead zone to the stick**

In `src/lib/cityArena/input/touchStick.ts`:

```ts
/**
 * Per-axis dead zone as a fraction of full deflection. A component smaller than this snaps to
 * zero while the other axis is left untouched (never renormalised), so a thumb held forward with
 * a small wobble reports dead-straight movement instead of a permanent small steering command.
 */
export const STICK_AXIS_DEAD_ZONE = 0.2;

/** Zeroes a component inside the per-axis dead zone. */
function snapAxis(component: number, axisDeadZone: number): number {
  return Math.abs(component) < axisDeadZone ? 0 : component;
}
```

`createStick` takes the third default and applies it where the vector is built:

```ts
/** Creates a stick; `radiusPx`, `deadZone` and `axisDeadZone` default to the spec values. */
export function createStick(
  radiusPx = STICK_RADIUS_PX,
  deadZone = STICK_DEAD_ZONE,
  axisDeadZone = STICK_AXIS_DEAD_ZONE,
): StickController {
```

```ts
current = {
  ...current,
  knob: [
    current.origin[0] + unitX * clamped * radiusPx,
    current.origin[1] + unitY * clamped * radiusPx,
  ],
  vector: [
    snapAxis(unitX * magnitude, axisDeadZone),
    snapAxis(unitY * magnitude, axisDeadZone),
  ],
};
```

The knob position is deliberately **not** snapped: the drawn knob keeps following the finger exactly, so the dead zone is invisible rather than jumpy.

- [ ] **Step 6: Run the input tests**

Run: `npx vitest run src/lib/cityArena/input`
Expected: PASS. The four pre-existing `touchStick` tests are unaffected — their vectors are `[0.412, 0]`, `[1, 0]`, `[0, −1]` and `[0, 0]`, and in each one the small component is already exactly `0`.

- [ ] **Step 7: Run the whole suite**

Run: `npx vitest run`
Expected: PASS. Every other producer of a `WorldInput` goes through `createInput` or `EMPTY_INPUT`, which now default `moveIsAnalog` to `false`; `keyboard.test.ts`, `pointerAim.test.ts`, `arena.test.ts`, `freeRoam.test.ts` and `player.test.ts` all use `toMatchObject` or `createInput`, so `inputState.test.ts:22` is the only assertion in the repository that had to change.

- [ ] **Step 8: Type-check, lint and commit**

```bash
npx tsc --noEmit
npm run lint
npx prettier --write src/lib/cityArena/sim/types.ts src/lib/cityArena/input/inputState.ts src/lib/cityArena/input/inputState.test.ts src/lib/cityArena/input/touchStick.ts src/lib/cityArena/input/touchStick.test.ts
git add src/lib/cityArena/sim/types.ts src/lib/cityArena/input/inputState.ts src/lib/cityArena/input/inputState.test.ts src/lib/cityArena/input/touchStick.ts src/lib/cityArena/input/touchStick.test.ts
git commit -m "feat(arena): flag analog movement and snap stick axes

The input snapshot now says whether the touch stick produced the move
vector, and a per-axis dead zone stops a thumb held forward from
reporting a permanent sideways component.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Heading-seeking steering, a steering-rate limit and a grip floor

**Files:**

- Create: `src/lib/cityArena/sim/driveInput.ts`
- Modify: `src/lib/cityArena/sim/vehicle.ts` (`turnRate` and two new constants)
- Modify: `src/lib/cityArena/sim/types.ts` (`ArenaPlayerState.driveSteer`)
- Modify: `src/lib/cityArena/sim/arena.ts` (`createArenaPlayer`, `enterVehicle`, `exitVehicle`, `ridePlayer`, `moveEntities`; `controlsFromInput` is deleted)
- Modify: `src/lib/cityArena/sim/invariants.ts` (`checkPlayer`)
- Test: `src/lib/cityArena/sim/driveInput.test.ts` (create), `src/lib/cityArena/sim/vehicle.test.ts` (one test rewritten), `src/lib/cityArena/sim/arena.test.ts` (one test added), `src/lib/cityArena/sim/invariants.test.ts` (one test added)

**Interfaces:**

- Consumes: `WorldInput` with `moveIsAnalog` (Task 3); `wrapAngle(angle: number): number` from `./driver`; `MOVE_DEAD_ZONE = 0.05` from `./player`; `type VehicleControls = { throttle: number; steer: number }` and `NO_CONTROLS` from `./vehicle`; `occupiedVehicle(state): VehicleState | null` from `./arena`.
- Produces: `ANALOG_STEER_FULL_ERROR_RAD: number`, `ANALOG_REVERSE_ERROR_RAD: number`, `STEER_COMMAND_RATE_PER_S: number`, `type DriveStep = { controls: VehicleControls; steer: number }`, `driveStep(input: WorldInput, heading: number, previousSteer: number, dt: number): DriveStep`; `STEER_GRIP_FLOOR: number` and `STEER_MIN_SPEED_MPS: number` from `vehicle.ts`; `ArenaPlayerState` gains `driveSteer: number`.

**Why a new module.** `sim/arena.ts` is already 770 lines against the 800-line file limit, so the mapping cannot live there. `driveInput.ts` is pure (no state, no world), which is also what makes the ten cases below unit-testable without booting an arena.

**Why the wheel position lives on the player.** The rate limit needs the previous command. `ArenaPlayerState.driveSteer` is the player's steering-wheel position: it is JSON-serialisable, it replicates with the player in Plan 3, it resets to `0` on entering and leaving a car, and — crucially — it keeps the limiter off the AI drivers. `driver.ts`'s `driveControls` already produces a smooth command from a continuous heading error; rate-limiting it too would slow every traffic and police corner and change `driver.test.ts`, `traffic` and `police.test.ts` expectations for no gain.

- [ ] **Step 1: Write the failing tests for the mapping**

Create `src/lib/cityArena/sim/driveInput.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ANALOG_REVERSE_ERROR_RAD,
  ANALOG_STEER_FULL_ERROR_RAD,
  STEER_COMMAND_RATE_PER_S,
  driveStep,
} from "./driveInput";
import { createInput } from "./types";

const step = 1 / 30;

/** An analog input pointing the stick along `angle` at `magnitude` deflection. */
function stick(angle: number, magnitude = 1): ReturnType<typeof createInput> {
  return createInput({
    move: [Math.cos(angle) * magnitude, Math.sin(angle) * magnitude],
    moveIsAnalog: true,
  });
}

describe("driveStep constants", () => {
  it("reaches full lock at 45 degrees and reverses past 135", () => {
    expect(ANALOG_STEER_FULL_ERROR_RAD).toBeCloseTo(Math.PI / 4, 10);
    expect(ANALOG_REVERSE_ERROR_RAD).toBeCloseTo((Math.PI * 3) / 4, 10);
    expect(STEER_COMMAND_RATE_PER_S).toBe(6);
  });
});

describe("driveStep with digital input", () => {
  it("keeps tank steering: x steers, up is gas, down brakes", () => {
    expect(createInput({}).moveIsAnalog).toBe(false);
    expect(driveStep(createInput({ move: [0.5, -1] }), 0, 0, step)).toEqual({
      controls: { throttle: 1, steer: 0.5 },
      steer: 0.5,
    });
    expect(driveStep(createInput({ move: [-1, 1] }), 2.5, 0, step)).toEqual({
      controls: { throttle: -1, steer: -1 },
      steer: -1,
    });
  });

  it("ignores the rate limit so A and D still answer instantly", () => {
    expect(driveStep(createInput({ move: [1, 0] }), 0, -1, step).steer).toBe(1);
  });
});

describe("driveStep with analog input", () => {
  it("drives straight when the stick already points along the heading", () => {
    expect(driveStep(stick(0), 0, 0, step)).toEqual({
      controls: { throttle: 1, steer: 0 },
      steer: 0,
    });
  });

  it("throttles by the stick magnitude", () => {
    expect(driveStep(stick(0, 0.5), 0, 0, step).controls.throttle).toBeCloseTo(
      0.5,
      6,
    );
  });

  it("asks for full lock at ninety degrees but only moves 0.2 per tick", () => {
    const first = driveStep(stick(Math.PI / 2), 0, 0, step);
    expect(first.steer).toBeCloseTo(0.2, 6);
    expect(first.controls.steer).toBeCloseTo(0.2, 6);
    let steer = 0;
    for (let tick = 0; tick < 5; tick++)
      steer = driveStep(stick(Math.PI / 2), 0, steer, step).steer;
    expect(steer).toBeCloseTo(1, 6);
  });

  it("maps a half-lock error straight through when it is inside the rate limit", () => {
    expect(driveStep(stick(Math.PI / 8), 0, 0.4, step).steer).toBeCloseTo(
      0.5,
      6,
    );
  });

  it("cannot flick the wheel from one lock to the other", () => {
    expect(driveStep(stick(Math.PI / 2), 0, -1, step).steer).toBeCloseTo(
      -0.8,
      6,
    );
  });

  it("ramps the wheel back to centre when the stick is released", () => {
    const released = driveStep(
      createInput({ move: [0, 0], moveIsAnalog: true }),
      0,
      0.9,
      step,
    );
    expect(released.controls.throttle).toBe(0);
    expect(released.steer).toBeCloseTo(0.7, 6);
  });

  it("brakes and reverses straight when the stick points behind the car", () => {
    expect(driveStep(stick(Math.PI), 0, 0, step)).toEqual({
      controls: { throttle: -1, steer: 0 },
      steer: 0,
    });
  });

  it("backs the tail toward a stick held behind and to one side", () => {
    const backing = driveStep(stick(2.9), 0, 0.3, step);
    expect(backing.controls.throttle).toBeCloseTo(-1, 6);
    expect(backing.steer).toBeCloseTo(0.307607, 5);
  });

  it("measures the error against the car heading, not the world", () => {
    // Car heading south (π/2), stick pointing east: a −90° error asks for full
    // right-to-left lock, rate-limited to −0.2 in the first tick.
    expect(driveStep(stick(0), Math.PI / 2, 0, step).steer).toBeCloseTo(
      -0.2,
      6,
    );
  });
});
```

Worked numbers, with `dt = 1/30` so the per-tick limit is `STEER_COMMAND_RATE_PER_S · dt = 6 / 30 = 0.2`:

- Digital `move: [0.5, −1]` → `throttle = −(−1) = 1`, `steer = 0.5`, and the heading is ignored entirely.
- Digital `move: [−1, 1]` → `throttle = −1`, `steer = −1`.
- Analog, stick along the heading → `error = 0` → `steer target 0`, `throttle = magnitude = 1`.
- Analog at 90°: `error = π/2 = 1.570796`; `target = clamp(1.570796 / 0.785398) = clamp(2) = 1`. From 0 the limiter gives `0.2`, then `0.4, 0.6, 0.8, 1.0` — the fifth step needs only `0.2`, so it lands exactly on 1.
- Analog at 22.5°: `error = π/8 = 0.392699`; `target = 0.392699 / 0.785398 = 0.5`. From `0.4` the change is `0.1 ≤ 0.2`, so the target passes through unclamped.
- Flick from `−1` to a target of `+1`: change 2 > 0.2 → `−1 + 0.2 = −0.8`.
- Release: `hypot(0, 0) = 0 < MOVE_DEAD_ZONE = 0.05` → `throttle 0`, and the wheel ramps `0.9 → 0.7`.
- Analog at 180°: `error = π = 3.141593 > ANALOG_REVERSE_ERROR_RAD = 2.356194` → reverse; `rearError = wrapAngle(π − sign(π)·π) = 0` → `steer 0`, `throttle = −1`.
- Analog at 2.9 rad: `error = 2.9 > 2.356194` → reverse; `rearError = wrapAngle(2.9 − π) = −0.241593`; `steer target = −(−0.241593) / 0.785398 = 0.307607`, within `0.2` of the previous `0.3`, so it passes through. While reversing, `turnRate` multiplies by `direction = −1`, so a **positive** steer rotates the heading negatively and swings the car's tail toward the stick — which is why the rear error is negated.
- Heading `π/2` with the stick east: `error = wrapAngle(0 − π/2) = −π/2` → `target = −1` → limited to `−0.2`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/cityArena/sim/driveInput.test.ts`
Expected: FAIL — `Failed to resolve import "./driveInput"`.

- [ ] **Step 3: Write the mapping**

Create `src/lib/cityArena/sim/driveInput.ts`:

```ts
import { wrapAngle } from "./driver";
import { MOVE_DEAD_ZONE } from "./player";
import type { WorldInput } from "./types";
import type { VehicleControls } from "./vehicle";

/**
 * Heading error at which analog steering reaches full lock. Wider than the AI's
 * `STEER_FULL_ERROR_RAD` (π/6) on purpose, so a thumb wobble never asks for the whole wheel.
 */
export const ANALOG_STEER_FULL_ERROR_RAD = Math.PI / 4;

/**
 * Heading error beyond which the stick is read as "go back": the car brakes and then reverses
 * toward the stick instead of spinning on the spot to face it.
 */
export const ANALOG_REVERSE_ERROR_RAD = (Math.PI * 3) / 4;

/**
 * Largest change of the steer command (−1..1) per second. At 30 Hz that is 0.2 per tick, so
 * centre to full lock takes 1/6 s; a flicked thumb cannot snap the wheel across.
 */
export const STEER_COMMAND_RATE_PER_S = 6;

/** Controls for one tick plus the rate-limited steer command to carry into the next one. */
export type DriveStep = { controls: VehicleControls; steer: number };

/** Clamps a control value to −1..1. */
function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** Plan 4a's tank steering, kept verbatim for keyboards: x steers, up is gas, down brakes. */
function digitalStep(input: WorldInput): DriveStep {
  const steer = clampUnit(input.move[0]);
  return { controls: { throttle: clampUnit(-input.move[1]), steer }, steer };
}

/**
 * Throttle and the un-limited steer command for a stick pointing `stickAngle` while the car
 * heads `heading`. Inside {@link ANALOG_REVERSE_ERROR_RAD} the car drives forward and turns
 * toward the stick; beyond it the car reverses, and the error is re-measured from its tail and
 * negated because `turnRate` mirrors the steering while the forward speed is negative.
 */
function analogTarget(
  stickAngle: number,
  magnitude: number,
  heading: number,
): VehicleControls {
  const error = wrapAngle(stickAngle - heading);
  if (Math.abs(error) <= ANALOG_REVERSE_ERROR_RAD) {
    return {
      throttle: magnitude,
      steer: clampUnit(error / ANALOG_STEER_FULL_ERROR_RAD),
    };
  }
  const rearError = wrapAngle(error - Math.sign(error) * Math.PI);
  return {
    throttle: -magnitude,
    steer: clampUnit(-rearError / ANALOG_STEER_FULL_ERROR_RAD),
  };
}

/** Moves `previousSteer` toward `target` by at most {@link STEER_COMMAND_RATE_PER_S} per second. */
function rateLimit(previousSteer: number, target: number, dt: number): number {
  const maxChange = STEER_COMMAND_RATE_PER_S * dt;
  const change = target - previousSteer;
  if (Math.abs(change) <= maxChange) return target;
  return previousSteer + Math.sign(change) * maxChange;
}

/**
 * Maps one movement input onto car controls. Digital (keyboard) input keeps Plan 4a's tank
 * steering unchanged. An analog stick is heading-seeking: its direction is the heading the
 * driver wants, so the steer command is the signed angle from the car's heading to the stick
 * over {@link ANALOG_STEER_FULL_ERROR_RAD}, and letting go re-centres the wheel instead of
 * holding a turn. The returned `steer` is the rate-limited command the caller must remember.
 */
export function driveStep(
  input: WorldInput,
  heading: number,
  previousSteer: number,
  dt: number,
): DriveStep {
  if (!input.moveIsAnalog) return digitalStep(input);
  const magnitude = Math.min(1, Math.hypot(input.move[0], input.move[1]));
  if (magnitude < MOVE_DEAD_ZONE) {
    const centring = rateLimit(previousSteer, 0, dt);
    return { controls: { throttle: 0, steer: centring }, steer: centring };
  }
  const target = analogTarget(
    Math.atan2(input.move[1], input.move[0]),
    magnitude,
    heading,
  );
  const steer = rateLimit(previousSteer, target.steer, dt);
  return { controls: { throttle: target.throttle, steer }, steer };
}
```

- [ ] **Step 4: Run the mapping tests**

Run: `npx vitest run src/lib/cityArena/sim/driveInput.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Rewrite the grip-curve test in `vehicle.test.ts`**

Replace the existing test `"turns faster with speed up to 6 m/s and slower again near the top speed"` (it encodes the old `grip = min(1, v/6)` curve and must change deliberately) with:

```ts
it("keeps full authority above 6 m/s, floors the grip while rolling and never pivots parked", () => {
  const compact = createVehicle(1, "compact", [0, 0], 0, 0);
  const fast = stepVehicle(
    { ...compact, velocityX: 6 },
    { throttle: 1, steer: 1 },
    step,
    free,
  ).vehicle;
  expect(fast.heading).toBeCloseTo(0.07445, 4);
  // The grip floor is what this change buys: 0.03913 rad per tick before, 0.05795 after.
  const rolling = stepVehicle(
    { ...compact, velocityX: 3 },
    { throttle: 0, steer: 1 },
    step,
    free,
  ).vehicle;
  expect(rolling.heading).toBeCloseTo(0.05795, 4);
  const creeping = stepVehicle(
    { ...compact, velocityX: 0.4 },
    { throttle: 0, steer: 1 },
    step,
    free,
  ).vehicle;
  expect(creeping.heading).toBe(0);
  const parked = stepVehicle(
    compact,
    { throttle: 0, steer: 1 },
    step,
    free,
  ).vehicle;
  expect(parked.heading).toBe(0);
});
```

Worked numbers for the compact (`accelMps2 = 6`, `maxSpeedMps = 22`), `dt = 1/30`:

- `velocityX: 6`, `throttle 1` → `forward = min(22, 6 + 6/30) = 6.2`; `grip = 0.45 + 0.55 · min(1, 6.2/6) = 1` (identical to the old curve, which is why `0.07445` is unchanged); `highSpeedLoss = 1 − 0.5 · 6.2/22 = 0.859091`; `turnRate = 1 · 2.6 · 1 · 0.859091 = 2.233636`; `heading = 2.233636/30 = 0.074455`.
- `velocityX: 3`, `throttle 0` → `forward = 3 − ROLLING_DECEL_MPS2/30 = 3 − 0.1 = 2.9`; `grip = 0.45 + 0.55 · (2.9/6) = 0.715833`; `highSpeedLoss = 1 − 0.5 · 2.9/22 = 0.934091`; `turnRate = 2.6 · 0.715833 · 0.934091 = 1.738499`; `heading = 0.057950`. The old curve gave `grip = 0.483333`, `turnRate = 1.173840` and `heading = 0.039128`.
- `velocityX: 0.4` → `forward = 0.4 − 0.1 = 0.3 < STEER_MIN_SPEED_MPS = 0.5` → `grip 0` → heading exactly 0.
- Parked → `forward` rolls to exactly 0 → `grip 0` → heading exactly 0.

The three other `stepVehicle` tests are untouched: they use `steer: 0` or a wreck, and none of them crosses the 0.5 m/s gate with a non-zero steer.

- [ ] **Step 6: Run it to verify the grip floor is missing**

Run: `npx vitest run src/lib/cityArena/sim/vehicle.test.ts`
Expected: FAIL on `rolling.heading` — `expected 0.039128 to be close to 0.05795`.

- [ ] **Step 7: Add the grip floor to `vehicle.ts`**

Next to the other steering constants:

```ts
/**
 * Steering authority a rolling car has straight away, before speed adds the rest. Without it the
 * spec's `clamp(v/6, 0, 1)` curve leaves the wheel almost dead below walking pace and then snaps.
 */
export const STEER_GRIP_FLOOR = 0.45;
/** Below this speed the car does not turn at all, so a parked car never pivots on the spot. */
export const STEER_MIN_SPEED_MPS = 0.5;
```

Add the helper and use it in `turnRate`:

```ts
/**
 * Steering authority at `speed`: none while the car is effectively parked, {@link STEER_GRIP_FLOOR}
 * the moment it rolls, and a full 1 from {@link STEER_FULL_SPEED_MPS} upward — so nothing about
 * cornering at speed changes.
 */
function steerGrip(speed: number): number {
  if (speed < STEER_MIN_SPEED_MPS) return 0;
  return (
    STEER_GRIP_FLOOR +
    (1 - STEER_GRIP_FLOOR) * Math.min(1, speed / STEER_FULL_SPEED_MPS)
  );
}

/** Turn rate in rad/s: steer × 2.6 × {@link steerGrip} × (1 − 0.5·v/vmax), mirrored in reverse. */
function turnRate(forward: number, steer: number, spec: VehicleSpec): number {
  const speed = Math.abs(forward);
  const highSpeedLoss =
    1 - STEER_HIGH_SPEED_FACTOR * (speed / spec.maxSpeedMps);
  const direction = forward < 0 ? -1 : 1;
  return (
    steer * STEER_RATE_RAD_S * steerGrip(speed) * highSpeedLoss * direction
  );
}
```

- [ ] **Step 8: Carry the wheel position on the player**

In `src/lib/cityArena/sim/types.ts`, add the field to `ArenaPlayerState`:

```ts
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
  heat: number;
  heatTick: number;
  outsideSinceTick: number | null;
  /** Rate-limited steering command (−1..1) of the car being driven; 0 while on foot. */
  driveSteer: number;
};
```

In `src/lib/cityArena/sim/arena.ts`, replace the `controlsFromInput` import block and function. Remove:

```ts
/** Stick or keys to car controls: up is gas, down is brake/reverse, x steers. */
function controlsFromInput(input: WorldInput): VehicleControls {
  return { throttle: -input.move[1], steer: input.move[0] };
}
```

Add the import:

```ts
import { driveStep, type DriveStep } from "./driveInput";
```

`createArenaPlayer` gains the field (after `outsideSinceTick: null`):

```ts
    outsideSinceTick: null,
    driveSteer: 0,
```

`enterVehicle`'s player literal gains `driveSteer: 0` after `speed: 0`, and `exitVehicle`'s does the same, so the wheel is centred whenever the driver changes.

`ridePlayer` takes the new command:

```ts
/** The driver follows the car while the boarding countdown runs out. */
function ridePlayer(
  player: ArenaPlayerState,
  vehicle: VehicleState,
  driveSteer: number,
): ArenaPlayerState {
  return {
    ...player,
    x: vehicle.x,
    y: vehicle.y,
    facing: vehicle.heading,
    speed: Math.abs(forwardSpeed(vehicle)),
    boardingTicksLeft: Math.max(0, player.boardingTicksLeft - 1),
    driveSteer,
  };
}
```

and `moveEntities` builds the controls through `driveStep`:

```ts
const driving = occupiedVehicle(state);
const canDrive = !isDead(state.player) && state.player.boardingTicksLeft === 0;
const drive: DriveStep =
  driving && canDrive
    ? driveStep(input, driving.heading, state.player.driveSteer, dt)
    : { controls: NO_CONTROLS, steer: 0 };
const drivers = stepDrivers(state, world, random, policeChase(state));
const moved = stepVehicles(state, drive.controls, dt, world, drivers.controls);
```

with the ride branch passing it on:

```ts
if (driving) {
  const ridden =
    moved.vehicles.find((vehicle) => vehicle.id === driving.id) ?? driving;
  return { ...next, player: ridePlayer(state.player, ridden, drive.steer) };
}
```

Keep `arena.ts`'s existing `type VehicleControls` import: `isAsleep` and `stepVehicles` still take it. `NO_CONTROLS` stays imported too, for the not-driving branch.

- [ ] **Step 9: Add the invariant**

In `src/lib/cityArena/sim/invariants.ts`, at the end of `checkPlayer`:

```ts
check(
  violations,
  Number.isFinite(player.driveSteer) &&
    Math.abs(player.driveSteer) <= 1 &&
    (player.vehicleId !== null || player.driveSteer === 0),
  `player.driveSteer ${player.driveSteer} out of range or set on foot`,
);
```

and in `src/lib/cityArena/sim/invariants.test.ts`:

```ts
it("rejects a steering command out of range or held on foot", () => {
  expect(
    checkInvariants({
      ...healthy,
      player: { ...healthy.player, driveSteer: 0.5 },
    }),
  ).toEqual(["player.driveSteer 0.5 out of range or set on foot"]);
  expect(
    checkInvariants({
      ...healthy,
      player: { ...healthy.player, vehicleId: 1, driveSteer: 1.5 },
    }),
  ).toEqual(["player.driveSteer 1.5 out of range or set on foot"]);
});
```

`healthy` in that suite builds its player through `createArenaPlayer([5, 5], 0)`, so it already has `driveSteer: 0` and `vehicleId: null` and stays violation-free; its vehicle has id 1 and is not wrecked, so `vehicleId: 1` satisfies the existing car-reference invariant.

- [ ] **Step 10: Add the arena-level wiring test**

In `src/lib/cityArena/sim/arena.test.ts`, inside `describe("stepArena driving", …)` (or beside the other driving tests):

```ts
it("drives from an analog stick and re-centres the wheel on foot", () => {
  const boarded = run(withCar(boot(), 3), createInput({ enter: true }), 1);
  expect(boarded.player.driveSteer).toBe(0);
  expect(boarded.player.boardingTicksLeft).toBe(BOARDING_TICKS - 1);
  const ready = run(boarded, EMPTY_INPUT, BOARDING_TICKS - 1);
  expect(ready.player.boardingTicksLeft).toBe(0);
  // The car heads east; the stick points south, a 90° error asking for full
  // lock that the limiter releases at 6 / 30 = 0.2 per tick.
  const analog = createInput({ move: [0, 1], moveIsAnalog: true });
  expect(run(ready, analog, 1).player.driveSteer).toBeCloseTo(0.2, 6);
  const turning = run(ready, analog, 5);
  expect(turning.player.driveSteer).toBeCloseTo(1, 6);
  expect(turning.vehicles[0].heading).toBeGreaterThan(0);
  const out = run(turning, createInput({ enter: true }), 1);
  expect(out.player.vehicleId).toBeNull();
  expect(out.player.driveSteer).toBe(0);
});
```

`withCar` parks a compact at heading `0` (east) 3 m from the player, and `run` steps `stepArena` at 30 Hz. Over the five analog ticks the car accelerates `0.2, 0.4, 0.6, 0.8, 1.0` m/s (compact, 6 m/s²), so it crosses `STEER_MIN_SPEED_MPS = 0.5` on the third tick and the heading has grown by then. The pre-existing digital driving tests around it (`driving.player.speed` ≈ 6 after a second of `move: [0, −1]`, and the `stoppedNextToCar` sequence) are untouched, because `createInput` leaves `moveIsAnalog` false.

- [ ] **Step 11: Run the whole suite**

Run: `npx vitest run`
Expected: PASS. `driver.test.ts`, `traffic`, `police.test.ts` and `cops.test.ts` are unaffected — AI controls never pass through `driveStep`, and the grip floor only raises the turn rate between 0.5 and 6 m/s, which none of their assertions pins (`police.test.ts:102` asserts a spawn heading of 0 or π before any stepping).

- [ ] **Step 12: Type-check, lint and commit**

```bash
npx tsc --noEmit
npm run lint
npx prettier --write src/lib/cityArena/sim/driveInput.ts src/lib/cityArena/sim/driveInput.test.ts src/lib/cityArena/sim/vehicle.ts src/lib/cityArena/sim/vehicle.test.ts src/lib/cityArena/sim/types.ts src/lib/cityArena/sim/arena.ts src/lib/cityArena/sim/arena.test.ts src/lib/cityArena/sim/invariants.ts src/lib/cityArena/sim/invariants.test.ts
git add src/lib/cityArena/sim/driveInput.ts src/lib/cityArena/sim/driveInput.test.ts src/lib/cityArena/sim/vehicle.ts src/lib/cityArena/sim/vehicle.test.ts src/lib/cityArena/sim/types.ts src/lib/cityArena/sim/arena.ts src/lib/cityArena/sim/arena.test.ts src/lib/cityArena/sim/invariants.ts src/lib/cityArena/sim/invariants.test.ts
git commit -m "fix(arena): steer touch cars toward the stick direction

An analog stick now sets the heading the car seeks, with a rate-limited
wheel and a grip floor so slow steering answers. Keyboard tank steering
is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Faster walking with a ramp, tighter zoom and a speed-based camera

**Files:**

- Modify: `src/lib/cityArena/sim/player.ts` (`WALK_SPEED_MPS`, `WALK_RAMP_S`, `WALK_ACCEL_MPS2`, `stepPlayer`)
- Modify: `src/lib/cityArena/sim/cops.ts` (`COP_RUN_SPEED_MPS`)
- Modify: `src/lib/cityArena/render/camera.ts` (`ZOOM_LEVELS`, `PHONE_VIEW_METRES`, `ZOOM_OUT_SPEED_MPS`, `ZOOM_IN_SPEED_MPS`, `widerZoom`, `speedZoomLevel`)
- Modify: `src/lib/cityArena/render/staticRaster.ts` (`RASTER_WORKING_SET_HEADROOM`, `RASTER_BUDGET_MAX_BYTES`, `rasterBudgetForViewport`)
- Modify: `src/components/cityArena/arenaRuntime.ts` (`Runtime.baseZoom`, `createRuntime`, new exported `nextCamera`, `followPlayer`)
- Test: `src/lib/cityArena/sim/player.test.ts` (three assertions change, two tests added), `src/lib/cityArena/sim/freeRoam.test.ts` (one assertion), `src/lib/cityArena/sim/arena.test.ts` (one assertion), `src/lib/cityArena/sim/cops.test.ts` (one assertion), `src/lib/cityArena/render/camera.test.ts` (one assertion set changes, one test added), `src/lib/cityArena/render/staticRaster.test.ts` (one test added), `src/components/cityArena/arenaRuntime.test.ts` (two tests added)

**Interfaces:**

- Consumes: existing `stepPlayer`, `PLAYER_RADIUS_M`, `MOVE_DEAD_ZONE`, `updateCamera`, `createCamera`, `LOOK_AHEAD_MAX_M = 15`, `DRIVING_LOOK_AHEAD_MAX_M = 30`, `zoomLevelForViewport`, `CHUNK_METRES = 128`, `RASTER_BUDGET_BYTES = 40 MiB`, `occupiedVehicle`.
- Produces: `WALK_SPEED_MPS = 5.5`, `WALK_RAMP_S = 0.15`, `WALK_ACCEL_MPS2 = WALK_SPEED_MPS / WALK_RAMP_S`; `ZOOM_LEVELS = [4, 6, 8, 10, 12] as const` (so `ZoomLevel = 4 | 6 | 8 | 10 | 12`), `PHONE_VIEW_METRES = 45`, `ZOOM_OUT_SPEED_MPS = 12`, `ZOOM_IN_SPEED_MPS = 9`, `widerZoom(level: ZoomLevel): ZoomLevel`, `speedZoomLevel(base: ZoomLevel, speedMps: number, current: ZoomLevel): ZoomLevel`; `RASTER_BUDGET_MAX_BYTES = 96 * 1024 * 1024`; `Runtime` gains `baseZoom: ZoomLevel`; `nextCamera(camera: Camera, baseZoom: ZoomLevel, target: Point, velocity: Point, dt: number, driving: boolean): Camera`.

**Why `nextCamera` is extracted.** `followPlayer` is private to the frame loop and `useArenaGame.test.tsx` has no seam for putting the player in a car at speed, so the zoom decision would otherwise be untested. Lifting the pure part out gives `arenaRuntime.test.ts` a fixture-free test and shrinks `followPlayer` to plain wiring.

- [ ] **Step 1: Write the failing walking tests**

In `src/lib/cityArena/sim/player.test.ts`, extend the import and change the three assertions that hard-coded 4 m/s:

```ts
import {
  PLAYER_RADIUS_M,
  WALK_ACCEL_MPS2,
  WALK_SPEED_MPS,
  stepPlayer,
} from "./player";
```

- Test `"walks at 4 m/s scaled by the input magnitude and faces the movement direction"` — rename to `"walks at 5.5 m/s scaled by the input magnitude and faces the movement direction"`; `expect(moved.speed).toBeCloseTo(4)` becomes `expect(moved.speed).toBeCloseTo(WALK_SPEED_MPS)`; `expect(halfSpeed.y).toBeCloseTo(2)` becomes `expect(halfSpeed.y).toBeCloseTo(2.75)` (half deflection over a full second: `0.5 × 5.5 = 2.75`).
- Test `"faces the aim angle instead of the movement when an aim is given"` — `expect(aimed.x).toBeCloseTo(4)` becomes `expect(aimed.x).toBeCloseTo(WALK_SPEED_MPS)`.
- The remaining two tests (`"clamps oversized debug input…"`, `"resolves collisions with the grid…"`) already assert against `WALK_SPEED_MPS` or a wall position and need no change; the `dt = 1` they use saturates the ramp in a single step.

Add two tests:

```ts
it("ramps up to the walking speed instead of teleporting", () => {
  const step = 1 / 30;
  const first = stepPlayer(start, createInput({ move: [1, 0] }), step, free);
  expect(first.speed).toBeCloseTo(WALK_ACCEL_MPS2 * step, 6);
  expect(first.x).toBeCloseTo(WALK_ACCEL_MPS2 * step * step, 6);
  let walker = start;
  for (let tick = 0; tick < 5; tick++)
    walker = stepPlayer(walker, createInput({ move: [1, 0] }), step, free);
  expect(walker.speed).toBeCloseTo(WALK_SPEED_MPS, 6);
  expect(walker.x).toBeCloseTo(0.590741, 5);
});

it("never carries a car's speed into the first walking step", () => {
  const step = 1 / 30;
  const justOut = { x: 0, y: 0, facing: 0, speed: 20 };
  const walking = stepPlayer(
    justOut,
    createInput({ move: [1, 0] }),
    step,
    free,
  );
  expect(walking.speed).toBeCloseTo(WALK_SPEED_MPS, 6);
  expect(walking.x).toBeCloseTo(WALK_SPEED_MPS * step, 6);
});
```

Worked numbers with `WALK_ACCEL_MPS2 = 5.5 / 0.15 = 36.666667` and `dt = 1/30`:

- One tick from rest: `speed = min(5.5, 36.666667/30) = 1.222222`; `x = 1.222222/30 = 0.040741`.
- Five ticks: speeds `1.222222, 2.444444, 3.666667, 4.888889, 5.500000` (the fifth is capped, since `6.111111 > 5.5`). Their sum is `17.722222`, so `x = 17.722222 / 30 = 0.590741`.
- Just out of a car at 20 m/s: the previous speed is clamped to `WALK_SPEED_MPS` before the ramp, so the first step is a plain `5.5/30 = 0.183333` in the stick direction rather than a 0.67 m lurch.

In `src/lib/cityArena/sim/freeRoam.test.ts`, add the import and change the single distance assertion:

```ts
import { WALK_ACCEL_MPS2 } from "./player";
```

```ts
const step = 1 / 30;
const next = stepFreeRoam(state, createInput({ move: [0, -1] }), step, world);
expect(next.tick).toBe(1);
expect(next.player.y).toBeCloseTo(10 - WALK_ACCEL_MPS2 * step * step, 6);
```

That is `10 − 0.040741 = 9.959259`, replacing the old `10 − 4/30 = 9.866667`. The suite's second test walks for 300 ticks and only asserts `player.x > 500` from a start of 480, which the faster speed satisfies more easily (≈ 534.6 m against the old 520 m).

In `src/lib/cityArena/sim/arena.test.ts`, the walking assertion in `"advances the tick and walks with the aim as facing"`:

```ts
expect(walked.player.x).toBeCloseTo(start.player.x + 5.174074, 5);
```

Thirty ticks of full deflection cover `5.174074` m — four ramp ticks contributing `12.222222/30` plus 26 full-speed ticks contributing `143/30` — replacing the old flat `4` m.

In `src/lib/cityArena/sim/cops.test.ts`, one assertion in `"aims within fifteen degrees and follows the road toward a distant target"`:

```ts
expect(moved.x).toBeCloseTo(99.8);
```

The cop starts at `x = 100` and moves `COP_RUN_SPEED_MPS × 1/30` toward the west; `6/30 = 0.2` replaces `4.5/30 = 0.15`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim`
Expected: FAIL — the ramp tests (`expected 4 to be close to 1.222222`), the free-roam distance, the arena distance and the cop distance.

- [ ] **Step 3: Speed up walking and add the ramp**

Replace the constants and `stepPlayer` in `src/lib/cityArena/sim/player.ts`:

```ts
/**
 * Walking speed at full stick deflection: a GTA2-style jog (19.8 km/h). Raised from the spec's
 * 4 m/s on 2026-09-06 because a phone view of ≈ 45 m took 16 s to cross on foot.
 */
export const WALK_SPEED_MPS = 5.5;

/** Seconds a standing start takes to reach {@link WALK_SPEED_MPS}: enough weight to feel, too short to lag. */
export const WALK_RAMP_S = 0.15;

/** Acceleration on foot, derived so the ramp lasts exactly {@link WALK_RAMP_S}. */
export const WALK_ACCEL_MPS2 = WALK_SPEED_MPS / WALK_RAMP_S;

/**
 * Speed after one `dt` of accelerating from `previous` toward `target`. Slowing down is instant
 * (a release ramp would add input latency exactly when a player is dodging), and the previous
 * speed is clamped to {@link WALK_SPEED_MPS} first so stepping out of a fast car cannot lurch.
 */
function rampSpeed(previous: number, target: number, dt: number): number {
  const from = Math.min(Math.max(0, previous), WALK_SPEED_MPS);
  if (from >= target) return target;
  return Math.min(target, from + WALK_ACCEL_MPS2 * dt);
}

/** Advances the player by `dt` seconds and resolves collisions; the aim angle, when given, wins over the movement direction for the facing. */
export function stepPlayer(
  player: PlayerState,
  input: WorldInput,
  dt: number,
  collision: Pick<CollisionGrid, "resolveCircle">,
): PlayerState {
  const inputMagnitude = Math.hypot(input.move[0], input.move[1]);
  const magnitude = Math.min(1, inputMagnitude);
  if (magnitude < MOVE_DEAD_ZONE)
    return { ...player, facing: input.aim ?? player.facing, speed: 0 };
  const speed = rampSpeed(player.speed, magnitude * WALK_SPEED_MPS, dt);
  const stepPerUnit = (speed * dt) / inputMagnitude;
  const [resolvedX, resolvedY] = collision.resolveCircle(
    [
      player.x + input.move[0] * stepPerUnit,
      player.y + input.move[1] * stepPerUnit,
    ],
    PLAYER_RADIUS_M,
  );
  return {
    x: resolvedX,
    y: resolvedY,
    facing: input.aim ?? Math.atan2(input.move[1], input.move[0]),
    speed,
  };
}
```

`stepPerUnit` reproduces the old displacement exactly once the ramp is saturated: dividing by `inputMagnitude` turns `input.move` into a unit direction, and multiplying by `speed · dt` gives `magnitude · WALK_SPEED_MPS · dt` of travel, which is what the previous `move[i] / max(1, |move|) · WALK_SPEED_MPS · dt` computed.

In `src/lib/cityArena/sim/cops.ts`:

```ts
/** Foot pursuit speed. Kept 0.5 m/s above `WALK_SPEED_MPS` so a wanted player cannot simply outrun a cop. */
export const COP_RUN_SPEED_MPS = 6;
```

- [ ] **Step 4: Run the simulation tests**

Run: `npx vitest run src/lib/cityArena/sim`
Expected: PASS. The other suites are unaffected: `peds.ts` keeps `PED_WALK_SPEED_MPS = 1.4` and `PED_FLEE_SPEED_MPS = 5.5` (a fleeing pedestrian now matches the player instead of outrunning them, which changes no assertion and no outcome — you still cannot run one down on foot), and the police-car chase uses `POLICE_CHASE_MPS = 18` with a stationary player.

- [ ] **Step 5: Write the failing camera and raster tests**

In `src/lib/cityArena/render/camera.test.ts`, extend the import and replace the zoom test:

```ts
import {
  ZOOM_IN_SPEED_MPS,
  ZOOM_OUT_SPEED_MPS,
  createCamera,
  DRIVING_LOOK_AHEAD_MAX_M,
  screenToWorld,
  speedZoomLevel,
  updateCamera,
  visibleRect,
  widerZoom,
  worldToScreen,
  zoomLevelForViewport,
} from "./camera";
```

```ts
it("quantises zoom so phones see about 45 m and desktops about 120 m", () => {
  expect(zoomLevelForViewport(300)).toBe(6);
  expect(zoomLevelForViewport(360)).toBe(8);
  expect(zoomLevelForViewport(390)).toBe(8);
  expect(zoomLevelForViewport(430)).toBe(10);
  expect(zoomLevelForViewport(800)).toBe(6);
  expect(zoomLevelForViewport(1400)).toBe(12);
});

it("widens one step above the driving threshold and returns with hysteresis", () => {
  expect(widerZoom(8)).toBe(6);
  expect(widerZoom(4)).toBe(4);
  expect(speedZoomLevel(8, 0, 8)).toBe(8);
  expect(speedZoomLevel(8, 5.5, 8)).toBe(8);
  expect(speedZoomLevel(8, ZOOM_OUT_SPEED_MPS, 8)).toBe(6);
  expect(speedZoomLevel(8, 10.5, 6)).toBe(6);
  expect(speedZoomLevel(8, 10.5, 8)).toBe(8);
  expect(speedZoomLevel(8, ZOOM_IN_SPEED_MPS, 6)).toBe(8);
  expect(speedZoomLevel(4, 20, 4)).toBe(4);
});
```

Worked numbers — `ideal = widthPx / targetMetres`, nearest level wins, first wins on a tie:

| width | target | ideal  | picked | view across |
| ----- | ------ | ------ | ------ | ----------- |
| 300   | 45 m   | 6.667  | 6      | 50.0 m      |
| 360   | 45 m   | 8.000  | 8      | 45.0 m      |
| 390   | 45 m   | 8.667  | 8      | 48.75 m     |
| 430   | 45 m   | 9.556  | 10     | 43.0 m      |
| 800   | 120 m  | 6.667  | 6      | 133.3 m     |
| 1400  | 120 m  | 11.667 | 12     | 116.7 m     |

The other three camera tests keep working: `createCamera([100, 200], 8)` still names a valid level, and the look-ahead tests never touch the zoom.

In `src/lib/cityArena/render/staticRaster.test.ts`, add to the `rasterBudgetForViewport` describe:

```ts
it("caps the adaptive budget but never below one raw working set", () => {
  const zoom = 12;
  const chunkPx = CHUNK_METRES * zoom;
  const ultraWideWorkingSet =
    (Math.ceil(3840 / chunkPx) + 1) *
    (Math.ceil(2160 / chunkPx) + 1) *
    chunkPx *
    chunkPx *
    4;

  expect(rasterBudgetForViewport({ width: 2560, height: 1440 }, zoom)).toBe(
    RASTER_BUDGET_MAX_BYTES,
  );
  expect(ultraWideWorkingSet).toBeGreaterThan(RASTER_BUDGET_MAX_BYTES);
  expect(rasterBudgetForViewport({ width: 3840, height: 2160 }, zoom)).toBe(
    ultraWideWorkingSet,
  );
});
```

with `RASTER_BUDGET_MAX_BYTES` added to the file's import. Worked numbers at zoom 12 (`chunkPx = 1536`, 9 437 184 bytes per chunk):

- 2560 × 1440: `(⌈2560/1536⌉ + 1) × (⌈1440/1536⌉ + 1) = 3 × 2 = 6` chunks = 56 623 104 B; `× 2.5 = 141 557 760` > the 100 663 296 B cap, and the cap is above the working set, so the cap is returned.
- 3840 × 2160: `4 × 3 = 12` chunks = 113 246 208 B, itself above the cap, so the working set is returned instead — capping below it would make the LRU evict a chunk it needs every frame.
- The two pre-existing tests are unchanged: `{360, 640}` at zoom 4 gives `2 × 3 × 1 048 576 = 6 291 456`, and `× 2.5 = 15 728 640` is still under the 41 943 040 B floor; `{2560, 1440}` at zoom 8 gives `4 × 3 × 4 194 304 = 50 331 648`, `× 2.5 = 125 829 120` caps to 100 663 296, which is still greater than both the floor and the raw working set.

In `src/components/cityArena/arenaRuntime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createCamera } from "@/lib/cityArena/render/camera";
import { canApplyRuntimeUpdate, nextCamera } from "./arenaRuntime";
```

```ts
describe("nextCamera", () => {
  it("holds the viewport zoom on foot and widens one step at driving speed", () => {
    const start = createCamera([0, 0], 8);
    const walking = nextCamera(start, 8, [10, 0], [5.5, 0], 1 / 30, false);
    expect(walking.zoom).toBe(8);
    expect(walking.x).toBeGreaterThan(0);
    expect(nextCamera(start, 8, [10, 0], [20, 0], 1 / 30, true).zoom).toBe(6);
  });

  it("leads further ahead while driving", () => {
    let onFoot = createCamera([0, 0], 8);
    let inCar = createCamera([0, 0], 8);
    for (let frame = 0; frame < 300; frame++) {
      onFoot = nextCamera(onFoot, 8, [0, 0], [1000, 0], 1 / 60, false);
      inCar = nextCamera(inCar, 8, [0, 0], [1000, 0], 1 / 60, true);
    }
    expect(onFoot.x).toBeCloseTo(15, 1);
    expect(inCar.x).toBeCloseTo(30, 1);
  });
});
```

The second test drives an unrealistic 1000 m/s on purpose — it saturates both look-ahead caps so the 15 m and 30 m limits are the only things the assertions can be measuring, exactly as the existing `camera.test.ts` look-ahead tests do.

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/lib/cityArena/render src/components/cityArena/arenaRuntime.test.ts`
Expected: FAIL — `zoomLevelForViewport(390)` is 6, `widerZoom`/`speedZoomLevel`/`RASTER_BUDGET_MAX_BYTES`/`nextCamera` do not exist.

- [ ] **Step 7: Extend the camera**

In `src/lib/cityArena/render/camera.ts`:

```ts
/**
 * Raster zoom levels in px per metre; intermediate zooms are not used. Extended past the spec's
 * 4/6/8 on 2026-09-06 so phones can hold a ≈ 45 m view and wide desktops stop overshooting 120 m.
 */
export const ZOOM_LEVELS = [4, 6, 8, 10, 12] as const;
```

```ts
/** Target width of the view in metres on phones. */
export const PHONE_VIEW_METRES = 45;
```

```ts
/** Speed (m/s) at or above which the camera drops one zoom step to show more road ahead. */
export const ZOOM_OUT_SPEED_MPS = 12;
/** Speed (m/s) at or below which it returns to the viewport zoom; the gap is the hysteresis band. */
export const ZOOM_IN_SPEED_MPS = 9;

/** One {@link ZOOM_LEVELS} step wider than `level`, or `level` itself when it is already the widest. */
export function widerZoom(level: ZoomLevel): ZoomLevel {
  return ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(level) - 1)];
}

/**
 * Zoom for the current speed: one step wider from {@link ZOOM_OUT_SPEED_MPS}, back to `base` at
 * {@link ZOOM_IN_SPEED_MPS}, and inside the band whatever `current` already is — the hysteresis
 * that stops the view flapping at a threshold. Walking never reaches the band, so the same rule
 * serves the on-foot camera unchanged.
 */
export function speedZoomLevel(
  base: ZoomLevel,
  speedMps: number,
  current: ZoomLevel,
): ZoomLevel {
  const wider = widerZoom(base);
  if (speedMps >= ZOOM_OUT_SPEED_MPS) return wider;
  if (speedMps <= ZOOM_IN_SPEED_MPS) return base;
  return current === wider ? wider : base;
}
```

Also update `zoomLevelForViewport`'s doc comment: `/** Nearest zoom level so that the viewport shows ≈ 45 m (phone) or ≈ 120 m (desktop). */`.

- [ ] **Step 8: Re-derive the raster budget**

In `src/lib/cityArena/render/staticRaster.ts`:

```ts
/**
 * Headroom multiplier applied to the visible chunk working set when sizing a viewport's budget.
 * 2.5 rather than 1.5 because the speed-based camera zoom keeps two zoom levels' chunks live
 * while driving, and a chunk's bytes grow with the square of the zoom (9 MiB at 12 px/m).
 */
export const RASTER_WORKING_SET_HEADROOM = 2.5;

/**
 * Ceiling on the adaptive budget, so a very wide viewport at a high zoom cannot ask for unbounded
 * canvas memory. Never applied below one raw working set — capping there would make the cache
 * evict a chunk it still needs on the very next frame.
 */
export const RASTER_BUDGET_MAX_BYTES = 96 * 1024 * 1024;
```

```ts
/**
 * Raster budget (bytes) that comfortably holds every chunk visible through a `viewport`-sized
 * canvas at `zoom`, so a wide desktop viewport is not squeezed by the fixed default budget while
 * a small one still gets that default. Never smaller than {@link RASTER_BUDGET_BYTES} or than the
 * raw working set, and never larger than {@link RASTER_BUDGET_MAX_BYTES} unless the working set
 * itself is.
 */
export function rasterBudgetForViewport(
  viewport: { width: number; height: number },
  zoom: ZoomLevel,
): number {
  const chunkPx = CHUNK_METRES * zoom;
  const chunksWide = chunksAcrossAxis(viewport.width, chunkPx);
  const chunksTall = chunksAcrossAxis(viewport.height, chunkPx);
  const workingSetBytes =
    chunksWide * chunksTall * chunkPx * chunkPx * BYTES_PER_PIXEL_RGBA;
  return Math.max(
    RASTER_BUDGET_BYTES,
    workingSetBytes,
    Math.min(
      RASTER_BUDGET_MAX_BYTES,
      workingSetBytes * RASTER_WORKING_SET_HEADROOM,
    ),
  );
}
```

Chunks are cached per zoom level (`chunkKey` is `zoom:chunkX:chunkY`), so switching zoom asks for a whole new set. `drawWorld` already handles that gracefully — it rasterises at most one chunk per frame and paints `PLACEHOLDER_FILL` under anything not yet cached — but a flat placeholder under the player would be very visible. Holding both sets in the budget is exactly what the 2.5 headroom buys: after the first zoom change in each direction, both sets stay cached and later changes are instant.

- [ ] **Step 9: Wire the runtime camera**

In `src/components/cityArena/arenaRuntime.ts`, extend the camera import:

```ts
import {
  DRIVING_LOOK_AHEAD_MAX_M,
  LOOK_AHEAD_MAX_M,
  createCamera,
  screenToWorld,
  speedZoomLevel,
  updateCamera,
  visibleRect,
  zoomLevelForViewport,
  type Camera,
  type Viewport,
  type ZoomLevel,
} from "@/lib/cityArena/render/camera";
```

Add the field to `Runtime` (beside `camera`):

```ts
camera: Camera;
/** Zoom the viewport width asks for; the live camera may sit one step wider while driving. */
baseZoom: ZoomLevel;
```

`createRuntime` computes it once and starts the camera there:

```ts
  const baseZoom = zoomLevelForViewport(viewportWidthPx);
  return {
    session,
    state,
    camera: createCamera([state.player.x, state.player.y], baseZoom),
    baseZoom,
    random,
```

Add the pure helper above `followPlayer`:

```ts
/**
 * The camera for the next frame: eased toward `target` with the driving or walking look-ahead
 * cap, then re-zoomed for the current speed. Pure so the zoom rule can be tested without booting
 * a runtime.
 */
export function nextCamera(
  camera: Camera,
  baseZoom: ZoomLevel,
  target: Point,
  velocity: Point,
  dt: number,
  driving: boolean,
): Camera {
  const eased = updateCamera(
    camera,
    target,
    velocity,
    dt,
    driving ? DRIVING_LOOK_AHEAD_MAX_M : LOOK_AHEAD_MAX_M,
  );
  const speedMps = Math.hypot(velocity[0], velocity[1]);
  return {
    ...eased,
    zoom: speedZoomLevel(baseZoom, speedMps, camera.zoom),
  };
}
```

and `followPlayer` becomes wiring only:

```ts
/** Eases the camera after the player or their car and re-zooms it for the speed. */
function followPlayer(runtime: Runtime, dt: number): void {
  const { player } = runtime.state;
  const car = occupiedVehicle(runtime.state);
  const velocity: Point = car
    ? [car.velocityX, car.velocityY]
    : [
        Math.cos(player.facing) * player.speed,
        Math.sin(player.facing) * player.speed,
      ];
  runtime.camera = nextCamera(
    runtime.camera,
    runtime.baseZoom,
    [player.x, player.y],
    velocity,
    dt,
    car !== null,
  );
}
```

`applyTeleport` already rebuilds the camera with `createCamera(target, runtime.camera.zoom)`, which keeps whatever level is live; nothing there needs to change. `useArenaGame.ts` needs no change either — its `rasterBudgetForCanvas` already sizes the budget from `zoomLevelForViewport(rect.width)`, which is exactly `baseZoom`. Recomputing `baseZoom` on a viewport resize is out of scope here, as it is today.

- [ ] **Step 10: Run the render and component tests**

Run: `npx vitest run src/lib/cityArena/render src/components/cityArena`
Expected: PASS.

- [ ] **Step 11: Run the whole suite, type-check and lint**

Run: `npx vitest run` then `npx tsc --noEmit` then `npm run lint`
Expected: PASS; lint reports exactly the 2 accepted warnings. Watch for `ZoomLevel` narrowing errors at any call site that stored a level in a wider `number` — there are none today, since `Camera.zoom` and `ChunkCoord.zoom` are both typed `ZoomLevel`.

- [ ] **Step 12: Commit**

```bash
npx prettier --write src/lib/cityArena/sim/player.ts src/lib/cityArena/sim/player.test.ts src/lib/cityArena/sim/cops.ts src/lib/cityArena/sim/cops.test.ts src/lib/cityArena/sim/freeRoam.test.ts src/lib/cityArena/sim/arena.test.ts src/lib/cityArena/render/camera.ts src/lib/cityArena/render/camera.test.ts src/lib/cityArena/render/staticRaster.ts src/lib/cityArena/render/staticRaster.test.ts src/components/cityArena/arenaRuntime.ts src/components/cityArena/arenaRuntime.test.ts
git add src/lib/cityArena/sim/player.ts src/lib/cityArena/sim/player.test.ts src/lib/cityArena/sim/cops.ts src/lib/cityArena/sim/cops.test.ts src/lib/cityArena/sim/freeRoam.test.ts src/lib/cityArena/sim/arena.test.ts src/lib/cityArena/render/camera.ts src/lib/cityArena/render/camera.test.ts src/lib/cityArena/render/staticRaster.ts src/lib/cityArena/render/staticRaster.test.ts src/components/cityArena/arenaRuntime.ts src/components/cityArena/arenaRuntime.test.ts
git commit -m "perf(arena): jog at 5.5 m/s and tighten the phone camera

Walking ramps to 5.5 m/s in 0.15 s, phones target a 45 m view with new
10 and 12 px/m zoom levels, and the camera pulls back one step above
12 m/s with hysteresis. The raster budget is re-derived for both.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Documentation, verification loop, device check and the PR

**Files:**

- Modify: `docs/tech/arena/README.md` (new section after "Runtime (PR 4 …)")
- Modify: `docs/superpowers/specs/2026-09-03-city-arena-design.md` (§5 twice, §7 once, §8 twice, §14 risk table once)

No code and no tests change in this task, so it can be reviewed on its own.

- [ ] **Step 1: Add the runtime section to `docs/tech/arena/README.md`**

The `## Runtime (PR 4 — pedestrians, cops, pickups and audio)` block is currently the last section of the file, so this goes at the end, immediately after it:

```markdown
## Runtime (PR 5 — bridges, steering and pace)

- Bridges: the map asset never captured OSM `bridge`/`layer` tags, so a road over water was
  blocked by the water beneath it (66 road edges on the shipped map, e.g. `Nudestraat` and
  `Duivendaal` in Wageningen). `world/roadCorridor.ts` builds a whole-map index of road corridors
  from the decoded road graph — one segment per edge, half-width `ROAD_WIDTH_M[class] / 2 + 2 m`
  (the pavements), bucketed into the collision grid's 16 m cells — and `worldSession.ready()`
  installs it on the grid. `resolveCircle` then skips a `kind: "water"` obstacle while the circle's
  centre is on a road, per circle, so both car hull circles are handled independently. Buildings
  are never exempt and water away from a road still blocks, so swimming stays impossible; beside a
  quay road a walker can wade about 2 m before the water pushes them back.
- Car steering: `input/touchStick.ts` adds a per-axis dead zone (`STICK_AXIS_DEAD_ZONE = 0.2`) so a
  thumb held forward reports no sideways component, and `InputState.snapshot()` reports
  `moveIsAnalog`. `sim/driveInput.ts` maps the movement input onto car controls: keyboards keep
  tank steering, an analog stick is heading-seeking (the steer command is the signed heading error
  over `ANALOG_STEER_FULL_ERROR_RAD = π/4`), pointing the stick more than 135° behind the car
  brakes and reverses toward it, and the command may move only
  `STEER_COMMAND_RATE_PER_S = 6` per second (0.2 per tick). The wheel position lives on
  `ArenaPlayerState.driveSteer` and resets to 0 on entering and leaving a car. `sim/vehicle.ts`
  adds a grip floor: `grip = 0.45 + 0.55 · min(1, v/6)` above 0.5 m/s and 0 below it, so a rolling
  car answers immediately (turn rate at 3 m/s: 1.738 rad/s against 1.211 before) while a parked one
  never pivots and fast cornering is unchanged.
- Pace: `WALK_SPEED_MPS` is 5.5 (was the spec's 4), reached through a `WALK_RAMP_S = 0.15 s`
  acceleration ramp; slowing down stays instant, and the previous speed is clamped to the walk
  speed first so stepping out of a fast car cannot lurch. `COP_RUN_SPEED_MPS` rises to 6 so foot
  cops keep their 0.5 m/s edge.
- Camera: `ZOOM_LEVELS` is `[4, 6, 8, 10, 12]` px/m and phones target ≈ 45 m across (a 390 px phone
  now picks 8 px/m and shows 48.75 m; a 1400 px desktop picks 12 and shows 116.7 m). While moving,
  `speedZoomLevel` drops one step at 12 m/s and returns at 9 m/s — a hysteresis band walking never
  reaches. `arenaRuntime.nextCamera` is the pure helper the frame loop calls.
- Raster budget: chunk bytes are `(128 · zoom)² · 4`, so 9 MiB at 12 px/m. Two zoom levels are live
  while driving, so `RASTER_WORKING_SET_HEADROOM` is 2.5 (was 1.5) with a
  `RASTER_BUDGET_MAX_BYTES = 96 MiB` ceiling that is never applied below one raw working set. A
  390 × 844 phone still lands on the 40 MiB floor and needs ≈ 30 MiB for both zoom sets.
- Verification: `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`. The arena
  tests use fake map/audio/canvas inputs and need no external services. The two existing lint
  warnings in `EventList.tsx` and `src/types/ical.d.ts` are unrelated.
```

- [ ] **Step 2: Amend the spec so it stops disagreeing with the code**

Five edits in `docs/superpowers/specs/2026-09-03-city-arena-design.md`. Each keeps the original sentence and appends the amendment, so the spec still reads as the original design plus a dated correction.

**§5, players on foot** — replace `speed = 4 m/s × stick magnitude` in the "**Players on foot.**" paragraph with:

```
speed = 5.5 m/s × stick magnitude, reached through a 0.15 s acceleration ramp
(amended 2026-09-06 from 4 m/s: the tighter phone view made 4 m/s feel slow);
```

**§5, car physics** — replace `angular velocity = steer × 2.6 rad/s × clamp(v/6, 0, 1) ×` `(1 − 0.5·v/vmax)` with:

```
angular velocity = steer × 2.6 rad/s × grip × (1 − 0.5·v/vmax) where
grip = 0 below 0.5 m/s and 0.45 + 0.55·min(1, v/6) above it (amended 2026-09-06:
the original clamp(v/6, 0, 1) left the wheel dead below walking pace);
```

**§7, mobile controls** — replace `floating joystick appears under the thumb (move; in a car y = throttle/brake, x = steer)` with:

```
floating joystick appears under the thumb (move; in a car the stick direction is the
heading the car steers toward and its magnitude is the throttle, with a stick held more
than 135° behind the car braking and reversing — amended 2026-09-06, the original
y = throttle/brake, x = steer mapping is kept for keyboards). A per-axis dead zone of
0.2 snaps a near-axis component to zero.
```

**§7, input model** — replace `{ seq, move: [x, y], aim: angle | null, fire, enter, weaponNext }` with:

```
{ seq, move: [x, y], moveIsAnalog, aim: angle | null, fire, enter, weaponNext }
```

and append to that paragraph:

```
`moveIsAnalog` is the device kind, not a control: it is true only while a touch stick
produced `move` and selects the heading-seeking car steering (added 2026-09-06).
```

**§8, camera** — replace `zoom level chosen from viewport width so phones show ≈ 60 m across, desktops ≈ 120 m.` with:

```
zoom level chosen from viewport width so phones show ≈ 45 m across, desktops ≈ 120 m,
and dropped one step while moving faster than 12 m/s (back at 9 m/s) — amended
2026-09-06 from ≈ 60 m.
```

**§8, StaticRaster** — replace `at one of three quantised zoom levels (4, 6, 8 px/m); LRU ≤ 24 chunks (≤ 40 MB).` with:

```
at one of five quantised zoom levels (4, 6, 8, 10, 12 px/m — amended 2026-09-06 from
three); LRU ≤ 24 chunks (≥ 40 MB, grown to hold the viewport's working set at both the
base and the driving zoom, capped at 96 MB unless one working set is larger).
```

**§14, risk table** — in the row `Real streets are irregular (not a GTA grid)`, replace `Zoom tuned to ≈ 60 m across on phones` with `Zoom tuned to ≈ 45 m across on phones`.

- [ ] **Step 3: Run the full verification loop**

```bash
npm run lint
npx tsc --noEmit
npx vitest run
npm run build
```

Expected:

- `npm run lint` — exactly 2 warnings, in `src/components/EventList.tsx` and `src/types/ical.d.ts`. A third warning is a regression to fix before continuing.
- `npx tsc --noEmit` — clean.
- `npx vitest run` — all green. The repo runs on the order of 458 tests in ~18 s; this plan adds roughly 30 and changes 7 existing assertions, so expect about 490.
- `npm run build` — succeeds.

- [ ] **Step 4: Walk the device check with the owner**

Run `npm run dev` and open `/` on a phone and on a desktop browser, then work through the list. Every item names what to do and what "fixed" looks like.

**Bridges (phone and desktop).**

1. Open the arena and pick **Wageningen centrum** in the zone picker.
2. Walk west along **Nudestraat**; its water crossing sits at roughly `(2466, 1743)` in world metres, about 140 m from the zone centre. Before this change the player stops dead at the water's edge; after it, they walk across.
3. Repeat in a car: steal one, drive over the same crossing, and check the car does not judder or stop half-way — both hull circles must clear.
4. **Duivendaal** (≈ `(2457, 1486)`) and **Bowlespark** (≈ `(2942, 1766)`) are two more crossings inside the same zone.
5. Walk off the bridge deck into the water beside it: you must be pushed back out. If you can swim, the corridor margin is too wide.
6. Walk into a building: it must still block.

**Steering (phone only — the mapping is analog-input specific).**

7. Drive forward and hold the thumb straight up with a small wobble. The car must track straight; before this change it drifted continuously to one side.
8. Point the stick at 45° and hold. The car swings to that heading and then holds it — it must not keep spinning past.
9. Release the stick mid-corner. The wheel returns to centre over about 5 ticks (a sixth of a second) rather than sticking.
10. Flick the thumb from full left to full right. The car must not snap; the turn should take about a sixth of a second to reverse.
11. At walking pace (3 m/s, just after pulling away) turn the stick 90°. The car must respond immediately — this is the grip floor.
12. Stop, then hold the stick straight behind the car. It should brake and then reverse, backing toward wherever the stick points, rather than spinning on the spot.
13. On desktop, drive with `W`/`A`/`S`/`D`. The feel must be exactly as before: `A`/`D` steer instantly, `S` brakes and reverses.

**Pace and camera.**

14. On the phone the view is noticeably tighter (≈ 48 m across on a 390 px screen instead of ≈ 65 m), and crossing it on foot takes about 8 s instead of 16 s.
15. Starting to walk shows a brief ramp rather than a snap to full speed; letting go stops immediately.
16. Accelerate a car past ≈ 43 km/h: the camera pulls back one zoom step. Slow to below ≈ 32 km/h and it returns. Sit right between the two and the zoom must not flicker.
17. Get a wanted level and let foot cops chase you: they must still gain on you.

If any item fails, that is a bug in this PR, not a follow-up.

- [ ] **Step 5: Commit the documentation**

```bash
npx prettier --write docs/tech/arena/README.md docs/superpowers/specs/2026-09-03-city-arena-design.md
git add docs/tech/arena/README.md docs/superpowers/specs/2026-09-03-city-arena-design.md
git commit -m "docs(arena): record the bridge, steering and pace tuning

Adds the PR 5 runtime section and amends spec sections 5, 7, 8 and 14
for the walk speed, grip curve, analog steering, zoom levels and raster
budget this PR changes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Open the pull request against `image`**

```bash
git push -u origin feat/arena-feel-and-controls
gh pr create --base image --title "fix(arena): crossable bridges, steering that behaves and faster movement" --body "$(cat <<'BODY'
Fixes the three feel-and-correctness problems from the owner's play-test of the merged game. Graphics are deliberately untouched — they are a separate plan.

## What the owner reported

> "The game is still very rudimentary. Graphics super basic and movement feels slow. Cant cross bridges (probably due to water crossing restrictions) and controlling a car direction is like I'm driving drunk when on mobile."

## Bridges

The map asset never captured OSM `bridge`/`layer` tags, so every road over water was blocked by the water beneath it — 66 road edges on the shipped map, including Nudestraat, Duivendaal and Bowlespark inside the Wageningen zone. Fixed at runtime rather than by rebuilding the asset (which costs an Overpass run and the 1.2 MB gzip budget): a new whole-map road-corridor index over `roads.json` lets `resolveCircle` skip water while the circle's centre is on a road surface, per circle, so both car hull circles are handled independently. Buildings still block, water away from a road still blocks, and beside a quay road you can wade about 2 m before being pushed back.

## Steering

The movement stick was mapped straight onto `{ throttle: -y, steer: x }` with only a radial dead zone, so a thumb held forward steered continuously. Now the touch stick snaps a near-axis component to zero, the input snapshot reports whether movement is analog, and analog input steers the car toward the direction the stick points, with the steer command rate-limited to 6 per second. Keyboards keep the original tank steering unchanged. `vehicle.ts` gains a grip floor so a car rolling at 3 m/s turns at 1.738 rad/s instead of 1.211, while a parked car still cannot pivot and fast cornering is untouched.

## Pace

Walking goes from 4 to 5.5 m/s through a 0.15 s acceleration ramp; foot cops go to 6 m/s so they keep their edge. Zoom levels become 4/6/8/10/12 px/m with phones targeting ≈ 45 m across, and the camera pulls back one step above 12 m/s with a 3 m/s hysteresis band. The adaptive raster budget is re-derived for the extra pixels per metre and given a 96 MB ceiling that never cuts below one working set.

## Verification

`npm run lint` (2 accepted warnings), `npx tsc --noEmit`, `npx vitest run`, `npm run build` all pass. Roughly 30 new tests; 7 existing assertions changed deliberately and each is called out in the plan.

Plan: `docs/superpowers/plans/2026-09-06-city-arena-feel-and-controls.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 7: Watch CI to green**

Use the `loop-on-ci` workflow: watch the checks, fix failures, address CodeRabbit comments, and resolve each review thread as soon as its comment is fixed in code.

---

## Self-review

### 1. Coverage of the owner's report

| Reported                                                               | Task | How                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Cant cross bridges (probably due to water crossing restrictions)"     | 1, 2 | Road-corridor index, then water skipped while the circle centre is on a road — on foot and per car hull circle, with a named crossing to check on a phone                                                   |
| "controlling a car direction is like I'm driving drunk when on mobile" | 3, 4 | Per-axis stick dead zone, `moveIsAnalog`, heading-seeking steering with a 45° full-lock angle, a 135° reverse branch, a 6-per-second rate limit and a grip floor                                            |
| "movement feels slow"                                                  | 5    | 4 → 5.5 m/s with a 0.15 s ramp, phone view 60 → 45 m across, new 10 and 12 px/m zoom levels                                                                                                                 |
| "Graphics super basic"                                                 | —    | **Deliberately out of scope**, recorded at the top of "Owner report and decisions"; a separate plan covers the renderer                                                                                     |
| Instant acceleration on foot (the correctness item to verify first)    | 5    | Verified: `stepPlayer` derived displacement straight from the stick with no integrator. `WALK_RAMP_S`, `WALK_ACCEL_MPS2` and `rampSpeed` added, with two tests including the "just out of a fast car" clamp |

Every spec constant this plan contradicts is amended in Task 6: §5 walk speed, §5 grip curve, §7 mobile stick mapping, §7 input model, §8 camera target, §8 zoom levels and raster budget, §14 risk table.

### 2. Placeholder scan

Searched the plan for `TBD`, `TODO`, "implement later", "fill in details", "Similar to Task", "appropriate error handling", "add validation", "handle edge cases" and "Write tests for the above" — none present. Every code step carries the full code, and every numeric assertion is derived from a constant the plan defines. Two conditional instructions were rewritten as definite ones during this review: `arena.ts` keeps its `type VehicleControls` import (`isAsleep` and `stepVehicles` still take it), and the README section goes at the end of the file because the PR 4 block is currently last.

### 3. Type consistency across tasks

- `createRoadCorridors(graph: Pick<RoadGraph, "nodes" | "edges">): RoadCorridors` — defined in Task 1, called in Task 2's grid tests and in `worldSession.loadReady`. The grid itself depends on the narrower `RoadCorridorTest` declared in `collisionGrid.ts`; `RoadCorridors` is structurally assignable to it (`isOnRoad` has the same signature), and the split is what keeps the imports one-way.
- `setRoadCorridors(corridors: RoadCorridorTest | null): void` — one name, used identically in the `CollisionGrid` type, `createCollisionGrid`, both test suites and `worldSession`.
- `moveIsAnalog: boolean` — added to `WorldInput`, `EMPTY_INPUT` and `createInput` in Task 3; read only by `driveStep` in Task 4. Never spelled `isAnalog` or `analogMove` anywhere.
- `driveStep(input, heading, previousSteer, dt): DriveStep` with `DriveStep = { controls: VehicleControls; steer: number }` — defined and tested in Task 4, called once in `arena.ts`'s `moveEntities`, with the returned `steer` stored as `ArenaPlayerState.driveSteer` and read back on the next tick. `driveSteer` is the same name in `types.ts`, `createArenaPlayer`, `enterVehicle`, `exitVehicle`, `ridePlayer`, `invariants.ts` and both test suites.
- `STEER_GRIP_FLOOR` / `STEER_MIN_SPEED_MPS` (Task 4) sit beside the existing `STEER_RATE_RAD_S`, `STEER_FULL_SPEED_MPS` and `STEER_HIGH_SPEED_FACTOR` and are consumed only by `steerGrip`. The analog input constants are named `ANALOG_STEER_FULL_ERROR_RAD` and `ANALOG_REVERSE_ERROR_RAD` so they cannot be confused with `driver.ts`'s existing `STEER_FULL_ERROR_RAD`, which stays π/6 for AI drivers.
- `ZoomLevel` widens from `4 | 6 | 8` to `4 | 6 | 8 | 10 | 12` when `ZOOM_LEVELS` grows (Task 5). Every consumer already types the value as `ZoomLevel` — `Camera.zoom`, `ChunkCoord.zoom`, `rasterBudgetForViewport`, `zoomLevelForViewport`, the new `widerZoom`/`speedZoomLevel` and `Runtime.baseZoom` — so no cast or narrowing is needed anywhere.
- `nextCamera(camera, baseZoom, target, velocity, dt, driving): Camera` is exported from `arenaRuntime.ts` and used by `followPlayer` and `arenaRuntime.test.ts` only. It reuses the existing `LOOK_AHEAD_MAX_M` / `DRIVING_LOOK_AHEAD_MAX_M` constants rather than redefining caps.
- `WALK_ACCEL_MPS2` is derived from `WALK_SPEED_MPS / WALK_RAMP_S`, so the three constants cannot drift apart; `player.test.ts`, `freeRoam.test.ts` and the plan's worked numbers all reference it rather than the literal 36.667.

### 4. Existing assertions that change, in one list

| File                          | Assertion                                                                 | Becomes                                                                                                                           | Task |
| ----------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `input/inputState.test.ts:22` | `toEqual({ move, aim, fire, enter, weaponNext })`                         | gains `moveIsAnalog: false`                                                                                                       | 3    |
| `sim/vehicle.test.ts`         | `"turns faster with speed up to 6 m/s…"`, `turned.heading` `0.07445` only | test rewritten; `0.07445` kept, plus `rolling.heading` `0.05795` (was `0.03913`), `creeping.heading` `0` and `parked.heading` `0` | 4    |
| `sim/player.test.ts`          | `expect(moved.speed).toBeCloseTo(4)`                                      | `toBeCloseTo(WALK_SPEED_MPS)`                                                                                                     | 5    |
| `sim/player.test.ts`          | `expect(halfSpeed.y).toBeCloseTo(2)`                                      | `toBeCloseTo(2.75)`                                                                                                               | 5    |
| `sim/player.test.ts`          | `expect(aimed.x).toBeCloseTo(4)`                                          | `toBeCloseTo(WALK_SPEED_MPS)`                                                                                                     | 5    |
| `sim/freeRoam.test.ts`        | `expect(next.player.y).toBeCloseTo(10 - 4 / 30)`                          | `toBeCloseTo(10 - WALK_ACCEL_MPS2 * step * step, 6)` = `9.959259`                                                                 | 5    |
| `sim/arena.test.ts`           | `expect(walked.player.x).toBeCloseTo(start.player.x + 4)`                 | `toBeCloseTo(start.player.x + 5.174074, 5)`                                                                                       | 5    |
| `sim/cops.test.ts`            | `expect(moved.x).toBeCloseTo(99.85)`                                      | `toBeCloseTo(99.8)`                                                                                                               | 5    |
| `render/camera.test.ts`       | `zoomLevelForViewport` 390→6, 300→4, 800→6, 1400→8                        | 300→6, 360→8, 390→8, 430→10, 800→6, 1400→12                                                                                       | 5    |

Nothing else in the repository asserts on these constants: `WALK_SPEED_MPS` appears only in `player.ts` and `player.test.ts`, `COP_RUN_SPEED_MPS` only in `cops.ts` and `cops.test.ts`, `ZOOM_LEVELS`/`zoomLevelForViewport` only in `camera.ts`, `camera.test.ts`, `arenaRuntime.ts` and `useArenaGame.ts`, and no test outside `vehicle.test.ts` pins the grip curve. `staticRaster.test.ts`'s two existing budget assertions were re-derived under the new headroom and cap and still hold unchanged.
