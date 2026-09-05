# GTA H3 (formerly Stadsstrijd) Plan 2 — World Model, Renderer and Free-Roam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the real map playable alone: a launcher card under Space Invaders opens a full-screen overlay in which a logged-in member walks around Rhenen, Wageningen, the WUR campus and Bennekom on phone or desktop, with tiles streamed around the player, buildings and water as obstacles, street names on the map, a loading screen, an OpenStreetMap attribution footer and a `?debug=1` metrics overlay.

**Architecture:** Runtime code lives in `src/lib/cityArena/{world,sim,input,render}/` as pure, injectable modules (a `MapLoader` with an LRU of decoded tiles, a `CollisionGrid`, a decoded `RoadGraph` with A\*, a `StaticRaster` of 128 m chunk canvases behind a byte budget, a `Camera`, and a 30 Hz fixed-step `freeRoam` simulation). React components in `src/components/cityArena/` are thin: the launcher card, the overlay that owns the `requestAnimationFrame` loop, a floating touch stick, a loading screen and the debug overlay. Everything that touches the DOM, `fetch` or canvases is injected so Vitest tests run in jsdom with fakes.

**Tech Stack:** Next.js 16 App Router (client components, `next/dynamic`), React 19, TypeScript 6 strict, Tailwind v4 utilities, Canvas 2D (`OffscreenCanvas` when available), Zod 4, Vitest + Testing Library, `@sentry/nextjs`.

**Spec:** `docs/superpowers/specs/2026-09-03-city-arena-design.md` §2 (placement/flow), §4 (runtime world model), §5 "Players on foot" only, §7 keyboard movement + single floating stick only, §8 (rendering/performance), §9.3 (settings key), §11 (errors), §13 (file layout). This is PR 2 of 8; it consumes the PR 1 asset (`public/arena/map/v1/`, types in `src/lib/cityArena/world/mapTypes.ts`).

**Scope decisions for this plan (recorded so nobody re-litigates them):**

1. Walk-only free-roam, one local player, no NPCs, no cars, no weapons, no multiplayer, no radar, no sound. Those are Plans 3–4.
2. Input is keyboard (WASD/arrows) and ONE floating joystick on the left 45 % of coarse-pointer screens. Twin-stick aim, buttons, haptics and settings UI are Plan 6.
3. The overlay's loading screen shows the landscape artwork from `public/branding/splash-game-landscape.{webp,jpg}` (delivered by PR #621). If the image 404s (PR #621 not merged yet on the branch), the loading screen simply shows the dark background and progress text — never a broken image.
4. Zone choice happens on the launcher card ("Startpunt") and inside the overlay ("Ga naar…" teleports to another zone's spawn). The last choice is persisted in `localStorage["h3-arena-settings-v1"]`.
5. A\* on the road graph is implemented and tested now (Plan 4's cops need it) but only used by the debug overlay in this plan (route length to the nearest landmark).
6. Chunk canvases are cached by bytes (≤ 40 MB) rather than by count, because a 128 m chunk at 8 px/m is 4 MB; a phone view needs ≈ 6 chunks.
7. Runtime code imports the pure helpers `pointInPolygon`, `distancePointToSegment`, `boundsOf`, `rectsIntersect` from `src/lib/cityArena/mapBuild/geometry.ts` (they have no Node dependencies) instead of duplicating them.

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
- Conventional Commits, subject ≤ 72 chars, imperative; every commit ends with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; run `npx prettier --write <files>` before committing (the pre-commit hook runs Prettier, ESLint, `tsc --noEmit` and the full Vitest suite).
- Work happens in the worktree `.claude/worktrees/city-arena-plan2` on branch `feat/city-arena-plan2` (stacked on `feat/city-arena`; rebase onto `image` once PR 1 merges).

---

## File structure

| Path                                               | Responsibility                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/lib/cityArena/schemas.ts`                     | Zod schema for `index.json` and the settings blob; structural guard for tiles                 |
| `src/lib/cityArena/storage.ts`                     | `loadArenaSettings` / `saveArenaSettings` (localStorage, Zod, Sentry)                         |
| `src/lib/cityArena/world/decode.ts`                | Units → metres, `DecodedTile` with precomputed bounds and tile rect                           |
| `src/lib/cityArena/world/lru.ts`                   | Generic cost-bounded LRU used for tiles (count) and chunks (bytes)                            |
| `src/lib/cityArena/world/mapLoader.ts`             | Fetch index/roads/tiles with retries, in-flight dedupe, proximity selection, change listeners |
| `src/lib/cityArena/world/collisionGrid.ts`         | 16 m cell grid of building/water obstacles; circle push-out                                   |
| `src/lib/cityArena/world/roadGraph.ts`             | Decode `roads.json`, nearest node via bucket grid, A\*                                        |
| `src/lib/cityArena/world/nearestRoad.ts`           | Nearest named road piece to a point (HUD street name)                                         |
| `src/lib/cityArena/world/zone.ts`                  | Zone lookup, edge distance, spawn selection                                                   |
| `src/lib/cityArena/world/worldSession.ts`          | Glue: loader + collision + raster kept in sync around a centre                                |
| `src/lib/cityArena/sim/rng.ts`                     | `mulberry32` seeded PRNG                                                                      |
| `src/lib/cityArena/sim/types.ts`                   | `WorldInput`, `PlayerState`, `FreeRoamState`                                                  |
| `src/lib/cityArena/sim/player.ts`                  | `stepPlayer` — walking + collision resolution                                                 |
| `src/lib/cityArena/sim/freeRoam.ts`                | Free-roam state machine (tick, zone tracking, teleport)                                       |
| `src/lib/cityArena/input/inputState.ts`            | Merges keyboard and stick vectors into one clamped `WorldInput`                               |
| `src/lib/cityArena/input/keyboard.ts`              | WASD/arrow key mapping attached to `window`                                                   |
| `src/lib/cityArena/input/touchStick.ts`            | Floating joystick math (origin, knob, vector, dead zone)                                      |
| `src/lib/cityArena/render/palette.ts`              | Colours, road widths, landmark styles                                                         |
| `src/lib/cityArena/render/camera.ts`               | Camera state, follow/look-ahead, zoom quantisation, world↔screen                              |
| `src/lib/cityArena/render/streetLabels.ts`         | Label placement along road pieces                                                             |
| `src/lib/cityArena/render/canvasTypes.ts`          | Structural `RasterContext`/`CanvasFactory` types so tests can inject fakes                    |
| `src/lib/cityArena/render/drawStatic.ts`           | Paints one chunk: ground → water → roads → pavements → buildings → labels                     |
| `src/lib/cityArena/render/staticRaster.ts`         | Chunk cache (byte budget), needed-chunk planning, one raster per frame                        |
| `src/lib/cityArena/render/drawWorld.ts`            | Blits visible chunks, hatches missing areas                                                   |
| `src/lib/cityArena/render/drawEntities.ts`         | Player sprite, zone ring                                                                      |
| `src/lib/cityArena/render/renderScene.ts`          | `renderScene(ctx, viewport, scene)` — the TV-ready entry point                                |
| `src/lib/cityArena/debugMetrics.ts`                | Frame/draw/sim timing ring buffer with p50/p95                                                |
| `src/components/cityArena/CityArenaLaunchIcon.tsx` | Small inline SVG icon for the card                                                            |
| `src/components/cityArena/CityArenaLauncher.tsx`   | Card under Space Invaders: pitch, Startpunt select, Spelen / Log in                           |
| `src/components/cityArena/ArenaLoadingScreen.tsx`  | Landscape splash + _"Kaart laden… n/m"_                                                       |
| `src/components/cityArena/ArenaDebugOverlay.tsx`   | `?debug=1` metrics panel                                                                      |
| `src/components/cityArena/TouchStick.tsx`          | Left-half pointer surface drawing the floating stick                                          |
| `src/components/cityArena/CityArenaOverlay.tsx`    | The game overlay: loop, HUD, input wiring, attribution                                        |
| `src/components/EventList.tsx`                     | Mount `<CityArenaLauncher />` after `<SpaceInvadersLauncher />`                               |
| `docs/tech/arena/README.md`                        | Runtime section added                                                                         |

Coordinates: **metres** everywhere at runtime (`Point = [x, y]` from `world/projection.ts`, north = negative y); the asset's integer units are converted once in `decode.ts`.

---

### Task 1: Schemas, settings storage and tile decoding

**Files:**

- Create: `src/lib/cityArena/schemas.ts`
- Create: `src/lib/cityArena/storage.ts`
- Create: `src/lib/cityArena/world/decode.ts`
- Test: `src/lib/cityArena/schemas.test.ts`, `src/lib/cityArena/storage.test.ts`, `src/lib/cityArena/world/decode.test.ts`

**Interfaces:**

- Consumes: `MapIndex`, `MapTile`, `MapBounds`, `ZoneKey`, `RoadClass`, `GroundKind` from `./world/mapTypes`; `Point`, `fromUnits` from `./world/projection`; `boundsOf`, `Rect` from `./mapBuild/geometry`.
- Produces: `MapIndexSchema` (Zod), `parseMapIndex(value: unknown): MapIndex`, `isMapTile(value: unknown): value is MapTile`, `ArenaSettingsSchema`, `ArenaSettings = { lastZone: ZoneKey }`, `DEFAULT_ARENA_SETTINGS`; `ARENA_SETTINGS_KEY = "h3-arena-settings-v1"`, `loadArenaSettings(): ArenaSettings`, `saveArenaSettings(patch: Partial<ArenaSettings>): void`; `DecodedRoad`, `DecodedBuilding`, `DecodedGround`, `DecodedWater`, `DecodedTile`, `flatUnitsToPoints(flat: number[]): Point[]`, `tileRectMetres(x: number, y: number, index: MapIndex): Rect`, `decodeTile(tile: MapTile, index: MapIndex): DecodedTile`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/schemas.test.ts
import { describe, expect, it } from "vitest";
import { ArenaSettingsSchema, isMapTile, parseMapIndex } from "./schemas";

const validIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [{ x: 0, y: 0, file: "tile_0_0.json", bytes: 10 }],
  zones: [
    {
      key: "wageningen",
      name: "Wageningen centrum",
      center: [10349, 6683],
      radius: 2000,
      spawnNodes: [[10000, 6000]],
      landmarks: ["grote-kerk-wageningen"],
    },
  ],
  landmarks: [
    {
      key: "grote-kerk-wageningen",
      name: "Grote Kerk",
      style: "church",
      center: [10349, 6683],
      tile: { x: 4, y: 3 },
    },
  ],
};

describe("parseMapIndex", () => {
  it("accepts a valid index", () => {
    expect(parseMapIndex(validIndex).zones[0].key).toBe("wageningen");
  });

  it("rejects a wrong version or a malformed zone", () => {
    expect(() => parseMapIndex({ ...validIndex, version: 2 })).toThrow();
    expect(() =>
      parseMapIndex({ ...validIndex, zones: [{ key: "mars" }] }),
    ).toThrow();
  });
});

describe("isMapTile", () => {
  it("guards the tile shape structurally", () => {
    expect(
      isMapTile({
        x: 1,
        y: 2,
        roads: [],
        buildings: [],
        ground: [],
        water: [],
      }),
    ).toBe(true);
    expect(isMapTile({ x: 1, y: 2, roads: [] })).toBe(false);
    expect(isMapTile(null)).toBe(false);
  });
});

describe("ArenaSettingsSchema", () => {
  it("fills defaults and rejects unknown zones", () => {
    expect(ArenaSettingsSchema.parse({})).toEqual({ lastZone: "wageningen" });
    expect(ArenaSettingsSchema.safeParse({ lastZone: "mars" }).success).toBe(
      false,
    );
  });
});
```

```ts
// src/lib/cityArena/storage.test.ts
import * as Sentry from "@sentry/nextjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARENA_SETTINGS_KEY,
  loadArenaSettings,
  saveArenaSettings,
} from "./storage";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

describe("arena settings storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadArenaSettings()).toEqual({ lastZone: "wageningen" });
  });

  it("round-trips a patch", () => {
    saveArenaSettings({ lastZone: "rhenen" });
    expect(
      JSON.parse(localStorage.getItem(ARENA_SETTINGS_KEY) ?? "{}"),
    ).toEqual({ lastZone: "rhenen" });
    expect(loadArenaSettings().lastZone).toBe("rhenen");
  });

  it("falls back to defaults and reports invalid JSON", () => {
    localStorage.setItem(ARENA_SETTINGS_KEY, "{ not json");
    expect(loadArenaSettings()).toEqual({ lastZone: "wageningen" });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { area: "arena", kind: "settings-load" },
      }),
    );
  });

  it("reports storage failures on save without throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveArenaSettings({ lastZone: "campus" })).not.toThrow();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { area: "arena", kind: "settings-save" },
      }),
    );
  });
});
```

```ts
// src/lib/cityArena/world/decode.test.ts
import { describe, expect, it } from "vitest";
import type { MapIndex, MapTile } from "./mapTypes";
import { decodeTile, flatUnitsToPoints, tileRectMetres } from "./decode";

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};

describe("decode", () => {
  it("converts flat units to metre points", () => {
    expect(flatUnitsToPoints([0, 0, 4, -8])).toEqual([
      [0, 0],
      [1, -2],
    ]);
  });

  it("computes a tile's own rectangle in metres from the index grid", () => {
    expect(tileRectMetres(0, 0, index)).toEqual({
      minX: -6513.75,
      minY: -4423,
      maxX: -4513.75,
      maxY: -2423,
    });
    expect(tileRectMetres(4, 2, index).minX).toBeCloseTo(1486.25);
  });

  it("decodes geometry with bounds", () => {
    const tile: MapTile = {
      x: 4,
      y: 2,
      roads: [
        {
          points: [8000, 8000, 8400, 8000],
          roadClass: "residential",
          name: "Dorpsstraat",
        },
      ],
      buildings: [
        {
          points: [8000, 8000, 8040, 8000, 8040, 8040, 8000, 8040],
          levels: 3,
          landmark: "grote-kerk-wageningen",
        },
      ],
      ground: [{ points: [0, 0, 400, 0, 400, 400], kind: "grass" }],
      water: [{ points: [0, 0, 40, 0, 40, 40] }],
    };
    const decoded = decodeTile(tile, index);
    expect(decoded.x).toBe(4);
    expect(decoded.roads[0].points).toEqual([
      [2000, 2000],
      [2100, 2000],
    ]);
    expect(decoded.roads[0].bounds).toEqual({
      minX: 2000,
      minY: 2000,
      maxX: 2100,
      maxY: 2000,
    });
    expect(decoded.buildings[0]).toMatchObject({
      levels: 3,
      landmark: "grote-kerk-wageningen",
    });
    expect(decoded.buildings[0].ring).toHaveLength(4);
    expect(decoded.ground[0].kind).toBe("grass");
    expect(decoded.water[0].ring[2]).toEqual([10, 10]);
    expect(decoded.rect).toEqual(tileRectMetres(4, 2, index));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/schemas.test.ts src/lib/cityArena/storage.test.ts src/lib/cityArena/world/decode.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement schemas.ts**

```ts
// src/lib/cityArena/schemas.ts
import { z } from "zod";
import type { MapIndex, MapTile, ZoneKey } from "./world/mapTypes";

const zoneKeys = ["rhenen", "wageningen", "campus", "bennekom"] as const;
const unitPoint = z.tuple([z.number().int(), z.number().int()]);

/** Zod schema for `index.json`; runtime validation happens once per session. */
export const MapIndexSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  origin: z.object({ lat: z.number(), lon: z.number() }),
  unitsPerMetre: z.literal(4),
  bounds: z.object({
    minX: z.number(),
    minY: z.number(),
    maxX: z.number(),
    maxY: z.number(),
  }),
  tileSize: z.number().int().positive(),
  tiles: z.array(
    z.object({
      x: z.number().int(),
      y: z.number().int(),
      file: z.string(),
      bytes: z.number().int(),
    }),
  ),
  zones: z.array(
    z.object({
      key: z.enum(zoneKeys),
      name: z.string(),
      center: unitPoint,
      radius: z.number().int().positive(),
      spawnNodes: z.array(unitPoint),
      landmarks: z.array(z.string()),
    }),
  ),
  landmarks: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      style: z.enum(["church", "pool", "campus", "cafe"]),
      center: unitPoint,
      tile: z.object({ x: z.number().int(), y: z.number().int() }),
    }),
  ),
});

/** Parses and validates an `index.json` payload; throws a ZodError on mismatch. */
export function parseMapIndex(value: unknown): MapIndex {
  return MapIndexSchema.parse(value);
}

function isFlatNumberArray(value: unknown): boolean {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "number")
  );
}

function isGeometryList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        isFlatNumberArray((entry as { points?: unknown }).points),
    )
  );
}

/** Cheap structural guard for a tile payload (full Zod validation would be too slow at 10 Hz loads). */
export function isMapTile(value: unknown): value is MapTile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.x === "number" &&
    typeof candidate.y === "number" &&
    isGeometryList(candidate.roads) &&
    isGeometryList(candidate.buildings) &&
    isGeometryList(candidate.ground) &&
    isGeometryList(candidate.water)
  );
}

/** Persisted player preferences (extended by later plans). */
export const ArenaSettingsSchema = z.object({
  lastZone: z.enum(zoneKeys).default("wageningen"),
});

/** Parsed settings type. */
export type ArenaSettings = { lastZone: ZoneKey };

/** Defaults used when nothing valid is stored. */
export const DEFAULT_ARENA_SETTINGS: ArenaSettings = { lastZone: "wageningen" };
```

- [ ] **Step 4: Implement storage.ts**

```ts
// src/lib/cityArena/storage.ts
import * as Sentry from "@sentry/nextjs";
import {
  ArenaSettingsSchema,
  DEFAULT_ARENA_SETTINGS,
  type ArenaSettings,
} from "./schemas";

/** localStorage key of the arena settings blob. */
export const ARENA_SETTINGS_KEY = "h3-arena-settings-v1";

/** Reads settings; any failure yields the defaults and is reported. */
export function loadArenaSettings(): ArenaSettings {
  if (typeof window === "undefined") return DEFAULT_ARENA_SETTINGS;
  try {
    const raw = localStorage.getItem(ARENA_SETTINGS_KEY);
    if (!raw) return DEFAULT_ARENA_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    const result = ArenaSettingsSchema.safeParse(parsed);
    if (!result.success) {
      Sentry.captureException(result.error, {
        tags: { area: "arena", kind: "settings-invalid" },
      });
      return DEFAULT_ARENA_SETTINGS;
    }
    return result.data;
  } catch (error: unknown) {
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "settings-load" },
    });
    return DEFAULT_ARENA_SETTINGS;
  }
}

/** Merges a patch into the stored settings; storage failures are reported, never thrown. */
export function saveArenaSettings(patch: Partial<ArenaSettings>): void {
  if (typeof window === "undefined") return;
  try {
    const next: ArenaSettings = { ...loadArenaSettings(), ...patch };
    localStorage.setItem(ARENA_SETTINGS_KEY, JSON.stringify(next));
  } catch (error: unknown) {
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "settings-save" },
    });
  }
}
```

- [ ] **Step 5: Implement decode.ts**

```ts
// src/lib/cityArena/world/decode.ts
import { boundsOf, type Rect } from "../mapBuild/geometry";
import type { GroundKind, MapIndex, MapTile, RoadClass } from "./mapTypes";
import { fromUnits, type Point } from "./projection";

/** Road centre line in metres with its bounding rectangle. */
export type DecodedRoad = {
  points: Point[];
  roadClass: RoadClass;
  name?: string;
  bounds: Rect;
};

/** Building footprint in metres. */
export type DecodedBuilding = {
  ring: Point[];
  bounds: Rect;
  levels: number;
  landmark?: string;
};

/** Ground polygon in metres. */
export type DecodedGround = { ring: Point[]; bounds: Rect; kind: GroundKind };

/** Water polygon in metres. */
export type DecodedWater = { ring: Point[]; bounds: Rect };

/** A tile converted to metres, with its own (non-overlapping) rectangle. */
export type DecodedTile = {
  x: number;
  y: number;
  rect: Rect;
  roads: DecodedRoad[];
  buildings: DecodedBuilding[];
  ground: DecodedGround[];
  water: DecodedWater[];
};

/** Converts a flat `[x0, y0, x1, y1, …]` unit array to metre points. */
export function flatUnitsToPoints(flat: number[]): Point[] {
  const points: Point[] = [];
  for (let index = 0; index + 1 < flat.length; index += 2) {
    points.push([fromUnits(flat[index]), fromUnits(flat[index + 1])]);
  }
  return points;
}

/** The tile's own 2 km rectangle in metres (the asset's geometry extends 20 m beyond it). */
export function tileRectMetres(x: number, y: number, index: MapIndex): Rect {
  const size = fromUnits(index.tileSize);
  const minX = fromUnits(index.bounds.minX) + x * size;
  const minY = fromUnits(index.bounds.minY) + y * size;
  return { minX, minY, maxX: minX + size, maxY: minY + size };
}

/** Decodes a raw tile payload into metre geometry with precomputed bounds. */
export function decodeTile(tile: MapTile, index: MapIndex): DecodedTile {
  const roads: DecodedRoad[] = tile.roads.map((road) => {
    const points = flatUnitsToPoints(road.points);
    return {
      points,
      roadClass: road.roadClass,
      name: road.name,
      bounds: boundsOf(points),
    };
  });
  const buildings: DecodedBuilding[] = tile.buildings.map((building) => {
    const ring = flatUnitsToPoints(building.points);
    return {
      ring,
      bounds: boundsOf(ring),
      levels: building.levels,
      landmark: building.landmark,
    };
  });
  const ground: DecodedGround[] = tile.ground.map((area) => {
    const ring = flatUnitsToPoints(area.points);
    return { ring, bounds: boundsOf(ring), kind: area.kind };
  });
  const water: DecodedWater[] = tile.water.map((area) => {
    const ring = flatUnitsToPoints(area.points);
    return { ring, bounds: boundsOf(ring) };
  });
  return {
    x: tile.x,
    y: tile.y,
    rect: tileRectMetres(tile.x, tile.y, index),
    roads,
    buildings,
    ground,
    water,
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/schemas.test.ts src/lib/cityArena/storage.test.ts src/lib/cityArena/world/decode.test.ts`
Expected: PASS (3 + 4 + 3 tests). `tileRectMetres(0, 0)`: `-26055 / 4 = -6513.75`, `-17692 / 4 = -4423`.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/cityArena
git add src/lib/cityArena
git commit -m "feat(arena): add runtime schemas, settings storage and tile decoding

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Cost-bounded LRU and the MapLoader

**Files:**

- Create: `src/lib/cityArena/world/lru.ts`
- Create: `src/lib/cityArena/world/mapLoader.ts`
- Test: `src/lib/cityArena/world/lru.test.ts`, `src/lib/cityArena/world/mapLoader.test.ts`

**Interfaces:**

- Consumes: `parseMapIndex`, `isMapTile` (Task 1); `decodeTile`, `DecodedTile` (Task 1); `MapIndex`, `MapRoads`, `MapTileRef` (`mapTypes`); `MAP_BASE_PATH` (`../constants`); `Point` (`./projection`); `fromUnits`.
- Produces: `createLru<K, V>(options: { maxCost: number; costOf: (value: V) => number; onEvict?: (key: K, value: V) => void }): Lru<K, V>` with `get(key): V | undefined` (refreshes recency), `peek(key)`, `set(key, value)`, `has(key)`, `delete(key)`, `keys(): K[]`, `size`, `cost`; `MapLoader` = `{ loadIndex(): Promise<MapIndex>; loadRoads(): Promise<MapRoads>; ensureTilesAround(centre: Point, radiusTiles?: number): Promise<LoadProgress>; getTile(x, y): DecodedTile | undefined; getLoadedTiles(): DecodedTile[]; hasFailures(): boolean; onChange(listener: () => void): () => void; dispose(): void }`, `LoadProgress = { loaded: number; total: number }`, `createMapLoader(options?: MapLoaderOptions): MapLoader`, `MapLoaderOptions = { baseUrl?; fetchImpl?; maxTiles?; retries?; backoffMs?; sleep?; onError? }`, `tileCoordForMetres(point: Point, index: MapIndex): { x: number; y: number }`, `MAX_RESIDENT_TILES = 9`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/world/lru.test.ts
import { describe, expect, it, vi } from "vitest";
import { createLru } from "./lru";

describe("createLru", () => {
  it("evicts the least recently used entry when the cost limit is exceeded", () => {
    const evicted: string[] = [];
    const lru = createLru<string, number>({
      maxCost: 3,
      costOf: () => 1,
      onEvict: (key) => evicted.push(key),
    });
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);
    expect(lru.get("a")).toBe(1);
    lru.set("d", 4);
    expect(evicted).toEqual(["b"]);
    expect(lru.keys()).toEqual(["c", "a", "d"]);
  });

  it("tracks cost by value and evicts several entries for a large one", () => {
    const onEvict = vi.fn();
    const lru = createLru<string, number>({
      maxCost: 10,
      costOf: (value) => value,
      onEvict,
    });
    lru.set("small1", 4);
    lru.set("small2", 4);
    lru.set("big", 9);
    expect(onEvict).toHaveBeenCalledTimes(2);
    expect(lru.cost).toBe(9);
    expect(lru.peek("big")).toBe(9);
  });

  it("deletes entries and reports size", () => {
    const lru = createLru<number, string>({ maxCost: 2, costOf: () => 1 });
    lru.set(1, "x");
    expect(lru.has(1)).toBe(true);
    lru.delete(1);
    expect(lru.size).toBe(0);
  });
});
```

```ts
// src/lib/cityArena/world/mapLoader.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapIndex, MapTile } from "./mapTypes";
import { createMapLoader, tileCoordForMetres } from "./mapLoader";

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -8000, minY: -8000, maxX: 24000, maxY: 24000 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [],
};
for (let y = 0; y < 4; y++)
  for (let x = 0; x < 4; x++)
    index.tiles.push({ x, y, file: `tile_${x}_${y}.json`, bytes: 1 });

function tile(x: number, y: number): MapTile {
  return { x, y, roads: [], buildings: [], ground: [], water: [] };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function routedFetch(
  failures: Record<string, number> = {},
): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    const remaining = failures[url] ?? 0;
    if (remaining > 0) {
      failures[url] = remaining - 1;
      return jsonResponse({ error: "busy" }, 503);
    }
    if (url.endsWith("/index.json")) return jsonResponse(index);
    if (url.endsWith("/roads.json"))
      return jsonResponse({ nodes: [], edges: [], classes: [], names: [] });
    const match = /tile_(\d+)_(\d+)\.json$/.exec(url);
    if (match) return jsonResponse(tile(Number(match[1]), Number(match[2])));
    return jsonResponse({ error: "not found" }, 404);
  });
}

describe("tileCoordForMetres", () => {
  it("maps metres to tile coordinates using the index grid", () => {
    expect(tileCoordForMetres([-2000, -2000], index)).toEqual({ x: 0, y: 0 });
    expect(tileCoordForMetres([1999, 4000], index)).toEqual({ x: 1, y: 3 });
  });
});

describe("createMapLoader", () => {
  const sleep = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the index once and the 3 × 3 block around a point", async () => {
    const fetchImpl = routedFetch();
    const loader = createMapLoader({ baseUrl: "/map", fetchImpl, sleep });
    await loader.loadIndex();
    await loader.loadIndex();
    const progress = await loader.ensureTilesAround([0, 0]);
    expect(progress).toEqual({ loaded: 9, total: 9 });
    expect(loader.getLoadedTiles()).toHaveLength(9);
    expect(loader.getTile(1, 1)?.rect.minX).toBe(0);
    expect(
      fetchImpl.mock.calls.filter(([url]) =>
        String(url).endsWith("index.json"),
      ),
    ).toHaveLength(1);
  });

  it("keeps at most nine tiles, evicting the ones farthest from recent use", async () => {
    const loader = createMapLoader({
      baseUrl: "/map",
      fetchImpl: routedFetch(),
      sleep,
    });
    await loader.ensureTilesAround([0, 0]);
    await loader.ensureTilesAround([4000, 4000]);
    expect(loader.getLoadedTiles()).toHaveLength(9);
    expect(loader.getTile(0, 0)).toBeUndefined();
    expect(loader.getTile(3, 3)?.x).toBe(3);
  });

  it("retries transient failures, then marks the tile failed and notifies", async () => {
    const onError = vi.fn();
    const listener = vi.fn();
    const fetchImpl = routedFetch({ "/map/tile_0_0.json": 5 });
    const loader = createMapLoader({
      baseUrl: "/map",
      fetchImpl,
      sleep,
      retries: 2,
      onError,
    });
    loader.onChange(listener);
    const progress = await loader.ensureTilesAround([-2000, -2000], 0);
    expect(progress).toEqual({ loaded: 0, total: 1 });
    expect(loader.hasFailures()).toBe(true);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "tile_0_0.json");
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalled();
  });

  it("deduplicates concurrent requests for the same tile", async () => {
    const fetchImpl = routedFetch();
    const loader = createMapLoader({ baseUrl: "/map", fetchImpl, sleep });
    await Promise.all([
      loader.ensureTilesAround([0, 0], 0),
      loader.ensureTilesAround([0, 0], 0),
    ]);
    expect(
      fetchImpl.mock.calls.filter(([url]) =>
        String(url).endsWith("tile_1_1.json"),
      ),
    ).toHaveLength(1);
  });

  it("rejects malformed tiles without caching them", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("index.json")
        ? jsonResponse(index)
        : jsonResponse({ x: 1 }),
    );
    const loader = createMapLoader({
      baseUrl: "/map",
      fetchImpl,
      sleep,
      retries: 0,
    });
    const progress = await loader.ensureTilesAround([0, 0], 0);
    expect(progress.loaded).toBe(0);
    expect(loader.hasFailures()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/world/lru.test.ts src/lib/cityArena/world/mapLoader.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement lru.ts**

```ts
// src/lib/cityArena/world/lru.ts
/** Options for {@link createLru}. */
export type LruOptions<K, V> = {
  maxCost: number;
  costOf: (value: V) => number;
  onEvict?: (key: K, value: V) => void;
};

/** A least-recently-used cache bounded by a total cost (count, bytes, …). */
export type Lru<K, V> = {
  get(key: K): V | undefined;
  peek(key: K): V | undefined;
  set(key: K, value: V): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  keys(): K[];
  readonly size: number;
  readonly cost: number;
};

/** Creates an LRU whose entries are evicted oldest-first once `maxCost` is exceeded. */
export function createLru<K, V>(options: LruOptions<K, V>): Lru<K, V> {
  const entries = new Map<K, V>();
  let cost = 0;

  const evictUntilFits = (): void => {
    for (const [key, value] of entries) {
      if (cost <= options.maxCost) break;
      entries.delete(key);
      cost -= options.costOf(value);
      options.onEvict?.(key, value);
    }
  };

  return {
    get(key) {
      const value = entries.get(key);
      if (value === undefined) return undefined;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    peek: (key) => entries.get(key),
    set(key, value) {
      const previous = entries.get(key);
      if (previous !== undefined) {
        entries.delete(key);
        cost -= options.costOf(previous);
      }
      entries.set(key, value);
      cost += options.costOf(value);
      evictUntilFits();
    },
    has: (key) => entries.has(key),
    delete(key) {
      const value = entries.get(key);
      if (value === undefined) return false;
      entries.delete(key);
      cost -= options.costOf(value);
      return true;
    },
    keys: () => [...entries.keys()],
    get size() {
      return entries.size;
    },
    get cost() {
      return cost;
    },
  };
}
```

- [ ] **Step 4: Implement mapLoader.ts**

```ts
// src/lib/cityArena/world/mapLoader.ts
import { MAP_BASE_PATH } from "../constants";
import { isMapTile, parseMapIndex } from "../schemas";
import { decodeTile, type DecodedTile } from "./decode";
import { createLru } from "./lru";
import type { MapIndex, MapRoads, MapTileRef } from "./mapTypes";
import { fromUnits, type Point } from "./projection";

/** Tiles kept in memory (a 3 × 3 block around the player). */
export const MAX_RESIDENT_TILES = 9;

/** Loading progress of the last `ensureTilesAround` call. */
export type LoadProgress = { loaded: number; total: number };

/** Options for {@link createMapLoader}; everything with I/O is injectable. */
export type MapLoaderOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxTiles?: number;
  retries?: number;
  backoffMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onError?: (error: Error, file: string) => void;
};

/** Streams map tiles around a moving point. */
export type MapLoader = {
  loadIndex(): Promise<MapIndex>;
  loadRoads(): Promise<MapRoads>;
  ensureTilesAround(centre: Point, radiusTiles?: number): Promise<LoadProgress>;
  getTile(x: number, y: number): DecodedTile | undefined;
  getLoadedTiles(): DecodedTile[];
  hasFailures(): boolean;
  onChange(listener: () => void): () => void;
  dispose(): void;
};

/** Tile coordinate containing a point in metres. */
export function tileCoordForMetres(
  point: Point,
  index: MapIndex,
): { x: number; y: number } {
  const size = fromUnits(index.tileSize);
  return {
    x: Math.floor((point[0] - fromUnits(index.bounds.minX)) / size),
    y: Math.floor((point[1] - fromUnits(index.bounds.minY)) / size),
  };
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJsonWithRetries(
  url: string,
  options: Required<
    Pick<MapLoaderOptions, "fetchImpl" | "retries" | "backoffMs" | "sleep">
  >,
): Promise<unknown> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    let response: Response | null = null;
    try {
      response = await options.fetchImpl(url);
    } catch (error: unknown) {
      if (attempt > options.retries)
        throw error instanceof Error ? error : new Error(String(error));
    }
    if (response?.ok) return response.json();
    const retryable =
      response === null || response.status === 429 || response.status >= 500;
    if (!retryable || attempt > options.retries) {
      throw new Error(
        `Map request failed (${response?.status ?? "network"}): ${url}`,
      );
    }
    await options.sleep(options.backoffMs * attempt);
  }
}

/** Creates a loader bound to a base URL; tiles are decoded once and cached. */
export function createMapLoader(options: MapLoaderOptions = {}): MapLoader {
  const baseUrl = options.baseUrl ?? MAP_BASE_PATH;
  const retryOptions = {
    fetchImpl: options.fetchImpl ?? fetch,
    retries: options.retries ?? 3,
    backoffMs: options.backoffMs ?? 500,
    sleep: options.sleep ?? defaultSleep,
  };
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((listener) => listener());
  const tiles = createLru<string, DecodedTile>({
    maxCost: options.maxTiles ?? MAX_RESIDENT_TILES,
    costOf: () => 1,
    onEvict: () => notify(),
  });
  const inFlight = new Map<string, Promise<boolean>>();
  const failed = new Set<string>();
  let indexPromise: Promise<MapIndex> | null = null;
  let roadsPromise: Promise<MapRoads> | null = null;
  let disposed = false;

  const loadIndex = (): Promise<MapIndex> => {
    indexPromise ??= fetchJsonWithRetries(
      `${baseUrl}/index.json`,
      retryOptions,
    ).then(parseMapIndex);
    return indexPromise;
  };

  const loadRoads = (): Promise<MapRoads> => {
    roadsPromise ??= fetchJsonWithRetries(
      `${baseUrl}/roads.json`,
      retryOptions,
    ).then((value) => value as MapRoads);
    return roadsPromise;
  };

  const loadTile = (ref: MapTileRef, index: MapIndex): Promise<boolean> => {
    const existing = inFlight.get(ref.file);
    if (existing) return existing;
    const request = fetchJsonWithRetries(`${baseUrl}/${ref.file}`, retryOptions)
      .then((payload) => {
        if (!isMapTile(payload)) throw new Error(`Malformed tile ${ref.file}`);
        if (!disposed) tiles.set(ref.file, decodeTile(payload, index));
        return true;
      })
      .catch((error: unknown) => {
        failed.add(ref.file);
        options.onError?.(
          error instanceof Error ? error : new Error(String(error)),
          ref.file,
        );
        return false;
      })
      .finally(() => {
        inFlight.delete(ref.file);
        notify();
      });
    inFlight.set(ref.file, request);
    return request;
  };

  const neededRefs = (
    centre: Point,
    radiusTiles: number,
    index: MapIndex,
  ): MapTileRef[] => {
    const origin = tileCoordForMetres(centre, index);
    return index.tiles.filter(
      (ref) =>
        Math.abs(ref.x - origin.x) <= radiusTiles &&
        Math.abs(ref.y - origin.y) <= radiusTiles,
    );
  };

  return {
    loadIndex,
    loadRoads,
    async ensureTilesAround(centre, radiusTiles = 1) {
      const index = await loadIndex();
      const refs = neededRefs(centre, radiusTiles, index);
      const results = await Promise.all(
        refs.map((ref) =>
          tiles.get(ref.file) ? Promise.resolve(true) : loadTile(ref, index),
        ),
      );
      return { loaded: results.filter(Boolean).length, total: refs.length };
    },
    getTile: (x, y) => tiles.peek(`tile_${x}_${y}.json`),
    getLoadedTiles: () => tiles.keys().flatMap((key) => tiles.peek(key) ?? []),
    hasFailures: () => failed.size > 0,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
```

Note the single `value as MapRoads` in `loadRoads`: `roads.json` is a 180 KB flat-array payload, and validating it with Zod on every session would cost more than it protects; the road graph decoder (Task 4) checks array lengths and stride instead. Keep the cast and the comment explaining it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/world/lru.test.ts src/lib/cityArena/world/mapLoader.test.ts`
Expected: PASS (3 + 6 tests). In the eviction test the second `ensureTilesAround([4000, 4000])` touches tiles 1..3 × 1..3; the four tiles of the first block that are not in the second (`0,0 0,1 0,2 1,0 2,0`) are the oldest and get evicted first, so `0,0` is gone and `3,3` present.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/world
git add src/lib/cityArena/world
git commit -m "feat(arena): stream map tiles with a cost-bounded LRU loader

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Collision grid with circle push-out

**Files:**

- Create: `src/lib/cityArena/world/collisionGrid.ts`
- Test: `src/lib/cityArena/world/collisionGrid.test.ts`

**Interfaces:**

- Consumes: `DecodedTile` (Task 1); `pointInPolygon`, `distancePointToSegment`, `rectsIntersect`, `Rect` from `../mapBuild/geometry`; `Point` from `./projection`.
- Produces: `COLLISION_CELL_M = 16`, `Obstacle = { ring: Point[]; bounds: Rect; kind: "building" | "water" }`, `nearestPointOnSegment(point, a, b): Point`, `nearestPointOnRing(point, ring): { point: Point; distance: number }`, `pushCircleOutOfRing(centre: Point, radius: number, ring: Point[]): Point | null`, `CollisionGrid = { insertTile(tile: DecodedTile): void; removeTile(x: number, y: number): void; query(rect: Rect): Obstacle[]; resolveCircle(centre: Point, radius: number): Point; obstacleCount(): number }`, `createCollisionGrid(cellMetres?: number): CollisionGrid`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/world/collisionGrid.test.ts
import { describe, expect, it } from "vitest";
import type { Point } from "./projection";
import type { DecodedTile } from "./decode";
import {
  createCollisionGrid,
  nearestPointOnRing,
  nearestPointOnSegment,
  pushCircleOutOfRing,
} from "./collisionGrid";

const square: Point[] = [
  [10, 10],
  [20, 10],
  [20, 20],
  [10, 20],
];

function tileWith(
  buildings: Point[][],
  water: Point[][] = [],
  x = 0,
  y = 0,
): DecodedTile {
  const bounds = (ring: Point[]) => ({
    minX: Math.min(...ring.map((p) => p[0])),
    minY: Math.min(...ring.map((p) => p[1])),
    maxX: Math.max(...ring.map((p) => p[0])),
    maxY: Math.max(...ring.map((p) => p[1])),
  });
  return {
    x,
    y,
    rect: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
    roads: [],
    buildings: buildings.map((ring) => ({
      ring,
      bounds: bounds(ring),
      levels: 2,
    })),
    ground: [],
    water: water.map((ring) => ({ ring, bounds: bounds(ring) })),
  };
}

describe("nearest point helpers", () => {
  it("projects onto a segment and clamps to its ends", () => {
    expect(nearestPointOnSegment([5, 5], [0, 0], [10, 0])).toEqual([5, 0]);
    expect(nearestPointOnSegment([-3, 5], [0, 0], [10, 0])).toEqual([0, 0]);
  });

  it("finds the nearest boundary point of a ring", () => {
    const result = nearestPointOnRing([25, 15], square);
    expect(result.point).toEqual([20, 15]);
    expect(result.distance).toBe(5);
  });
});

describe("pushCircleOutOfRing", () => {
  it("returns null when the circle does not touch the ring", () => {
    expect(pushCircleOutOfRing([30, 15], 0.4, square)).toBeNull();
  });

  it("pushes a circle overlapping an edge outward", () => {
    const moved = pushCircleOutOfRing([20.2, 15], 0.4, square);
    expect(moved?.[0]).toBeCloseTo(20.4);
    expect(moved?.[1]).toBeCloseTo(15);
  });

  it("ejects a circle whose centre is inside through the nearest edge", () => {
    const moved = pushCircleOutOfRing([19.8, 15], 0.4, square);
    expect(moved?.[0]).toBeCloseTo(20.4);
    expect(moved?.[1]).toBeCloseTo(15);
  });
});

describe("createCollisionGrid", () => {
  it("indexes obstacles by cell and queries by rectangle", () => {
    const grid = createCollisionGrid();
    grid.insertTile(
      tileWith(
        [square],
        [
          [
            [100, 100],
            [110, 100],
            [110, 110],
          ],
        ],
      ),
    );
    expect(grid.obstacleCount()).toBe(2);
    expect(
      grid.query({ minX: 0, minY: 0, maxX: 30, maxY: 30 }).map((o) => o.kind),
    ).toEqual(["building"]);
    expect(
      grid
        .query({ minX: 95, minY: 95, maxX: 120, maxY: 120 })
        .map((o) => o.kind),
    ).toEqual(["water"]);
    expect(grid.query({ minX: 500, minY: 500, maxX: 510, maxY: 510 })).toEqual(
      [],
    );
  });

  it("resolves a walking circle against buildings and water, and forgets removed tiles", () => {
    const grid = createCollisionGrid();
    grid.insertTile(tileWith([square]));
    expect(grid.resolveCircle([50, 50], 0.4)).toEqual([50, 50]);
    const pushed = grid.resolveCircle([20.1, 15], 0.4);
    expect(pushed[0]).toBeCloseTo(20.4);
    grid.removeTile(0, 0);
    expect(grid.resolveCircle([20.1, 15], 0.4)).toEqual([20.1, 15]);
  });

  it("does not list the same obstacle twice when it spans several cells", () => {
    const grid = createCollisionGrid(4);
    grid.insertTile(tileWith([square]));
    expect(grid.query({ minX: 8, minY: 8, maxX: 22, maxY: 22 })).toHaveLength(
      1,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/world/collisionGrid.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement collisionGrid.ts**

```ts
// src/lib/cityArena/world/collisionGrid.ts
import {
  pointInPolygon,
  rectsIntersect,
  type Rect,
} from "../mapBuild/geometry";
import type { DecodedTile } from "./decode";
import type { Point } from "./projection";

/** Cell size of the uniform grid in metres. */
export const COLLISION_CELL_M = 16;

/** A solid polygon the player cannot enter. */
export type Obstacle = {
  ring: Point[];
  bounds: Rect;
  kind: "building" | "water";
};

/** Spatial index of obstacles from the loaded tiles. */
export type CollisionGrid = {
  insertTile(tile: DecodedTile): void;
  removeTile(x: number, y: number): void;
  query(rect: Rect): Obstacle[];
  resolveCircle(centre: Point, radius: number): Point;
  obstacleCount(): number;
};

/** Closest point to `point` on segment a–b. */
export function nearestPointOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return [a[0], a[1]];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared,
    ),
  );
  return [a[0] + t * dx, a[1] + t * dy];
}

/** Closest boundary point of a ring and its distance. */
export function nearestPointOnRing(
  point: Point,
  ring: Point[],
): { point: Point; distance: number } {
  let best: Point = ring[0];
  let bestDistance = Infinity;
  for (let index = 0; index < ring.length; index++) {
    const candidate = nearestPointOnSegment(
      point,
      ring[index],
      ring[(index + 1) % ring.length],
    );
    const distance = Math.hypot(
      candidate[0] - point[0],
      candidate[1] - point[1],
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return { point: best, distance: bestDistance };
}

/**
 * Moves a circle out of a ring: outside-but-overlapping circles slide away from the nearest
 * boundary point; circles whose centre is inside are ejected through the nearest edge.
 * Returns `null` when there is no overlap.
 */
export function pushCircleOutOfRing(
  centre: Point,
  radius: number,
  ring: Point[],
): Point | null {
  const inside = pointInPolygon(centre, ring);
  const nearest = nearestPointOnRing(centre, ring);
  if (!inside && nearest.distance >= radius) return null;
  const awayX = inside
    ? nearest.point[0] - centre[0]
    : centre[0] - nearest.point[0];
  const awayY = inside
    ? nearest.point[1] - centre[1]
    : centre[1] - nearest.point[1];
  const length = Math.hypot(awayX, awayY);
  const unitX = length === 0 ? 1 : awayX / length;
  const unitY = length === 0 ? 0 : awayY / length;
  return [nearest.point[0] + unitX * radius, nearest.point[1] + unitY * radius];
}

const MAX_RESOLVE_PASSES = 3;

/** Creates an empty grid; tiles are inserted/removed as the loader streams them. */
export function createCollisionGrid(
  cellMetres = COLLISION_CELL_M,
): CollisionGrid {
  const cells = new Map<string, Obstacle[]>();
  const obstaclesByTile = new Map<string, Obstacle[]>();
  const cellKey = (cx: number, cy: number): string => `${cx}:${cy}`;

  const forEachCell = (bounds: Rect, visit: (key: string) => void): void => {
    const minCx = Math.floor(bounds.minX / cellMetres);
    const maxCx = Math.floor(bounds.maxX / cellMetres);
    const minCy = Math.floor(bounds.minY / cellMetres);
    const maxCy = Math.floor(bounds.maxY / cellMetres);
    for (let cy = minCy; cy <= maxCy; cy++)
      for (let cx = minCx; cx <= maxCx; cx++) visit(cellKey(cx, cy));
  };

  const query = (rect: Rect): Obstacle[] => {
    const seen = new Set<Obstacle>();
    forEachCell(rect, (key) => {
      for (const obstacle of cells.get(key) ?? []) {
        if (rectsIntersect(rect, obstacle.bounds)) seen.add(obstacle);
      }
    });
    return [...seen];
  };

  return {
    insertTile(tile) {
      const obstacles: Obstacle[] = [
        ...tile.buildings.map((building) => ({
          ring: building.ring,
          bounds: building.bounds,
          kind: "building" as const,
        })),
        ...tile.water.map((water) => ({
          ring: water.ring,
          bounds: water.bounds,
          kind: "water" as const,
        })),
      ];
      obstaclesByTile.set(`${tile.x}:${tile.y}`, obstacles);
      for (const obstacle of obstacles) {
        forEachCell(obstacle.bounds, (key) => {
          const list = cells.get(key) ?? [];
          list.push(obstacle);
          cells.set(key, list);
        });
      }
    },
    removeTile(x, y) {
      const obstacles = obstaclesByTile.get(`${x}:${y}`) ?? [];
      obstaclesByTile.delete(`${x}:${y}`);
      const removed = new Set(obstacles);
      for (const obstacle of obstacles) {
        forEachCell(obstacle.bounds, (key) => {
          const remaining = (cells.get(key) ?? []).filter(
            (entry) => !removed.has(entry),
          );
          if (remaining.length === 0) cells.delete(key);
          else cells.set(key, remaining);
        });
      }
    },
    query,
    resolveCircle(centre, radius) {
      let position: Point = [centre[0], centre[1]];
      for (let pass = 0; pass < MAX_RESOLVE_PASSES; pass++) {
        const probe: Rect = {
          minX: position[0] - radius,
          minY: position[1] - radius,
          maxX: position[0] + radius,
          maxY: position[1] + radius,
        };
        let moved = false;
        for (const obstacle of query(probe)) {
          const pushed = pushCircleOutOfRing(position, radius, obstacle.ring);
          if (pushed) {
            position = pushed;
            moved = true;
          }
        }
        if (!moved) break;
      }
      return position;
    },
    obstacleCount: () =>
      [...obstaclesByTile.values()].reduce(
        (total, list) => total + list.length,
        0,
      ),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/world/collisionGrid.test.ts`
Expected: PASS (8 tests). Trace for the "inside" case: centre (19.8, 15) is inside the square; nearest boundary point is (20, 15) at 0.2 m; away vector points from the centre to the boundary → the circle lands at (20.4, 15).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/cityArena/world
git add src/lib/cityArena/world
git commit -m "feat(arena): add collision grid with circle push-out

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Road graph decode, nearest node, A\* and nearest road name

**Files:**

- Create: `src/lib/cityArena/world/roadGraph.ts`
- Create: `src/lib/cityArena/world/nearestRoad.ts`
- Test: `src/lib/cityArena/world/roadGraph.test.ts`, `src/lib/cityArena/world/nearestRoad.test.ts`

**Interfaces:**

- Consumes: `MapRoads`, `ROAD_EDGE_STRIDE`, `RoadClass` (`./mapTypes`); `fromUnits`, `Point` (`./projection`); `DecodedTile` (Task 1); `distancePointToSegment` (`../mapBuild/geometry`).
- Produces: `RoadGraphEdge = { a: number; b: number; roadClass: RoadClass; name?: string; oneway: boolean; length: number }`, `RoadGraph = { nodes: Point[]; edges: RoadGraphEdge[]; adjacency: number[][]; nearestNode(point: Point, maxDistance?: number): number | null }`, `decodeRoadGraph(roads: MapRoads): RoadGraph` (throws `Error` on a malformed stride/index), `findPath(graph: RoadGraph, from: number, to: number): number[] | null`, `pathLength(graph, path): number`; `nearestRoadName(tiles: DecodedTile[], point: Point, maxDistance?: number): string | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/world/roadGraph.test.ts
import { describe, expect, it } from "vitest";
import type { MapRoads } from "./mapTypes";
import { decodeRoadGraph, findPath, pathLength } from "./roadGraph";

// Square of four nodes (0..3) with a detour node 4 far away: 0-1-2-3-0 plus 1-4.
const roads: MapRoads = {
  nodes: [0, 0, 400, 0, 400, 400, 0, 400, 400, -4000],
  edges: [
    0, 1, 0, 0, 0, 400, 1, 2, 0, 0, 0, 400, 2, 3, 0, -1, 0, 400, 3, 0, 0, -1, 0,
    400, 1, 4, 1, -1, 1, 4000,
  ],
  classes: ["residential", "service"],
  names: ["Dorpsstraat"],
};

describe("decodeRoadGraph", () => {
  it("decodes nodes to metres and edges with adjacency", () => {
    const graph = decodeRoadGraph(roads);
    expect(graph.nodes).toHaveLength(5);
    expect(graph.nodes[1]).toEqual([100, 0]);
    expect(graph.edges[0]).toEqual({
      a: 0,
      b: 1,
      roadClass: "residential",
      name: "Dorpsstraat",
      oneway: false,
      length: 100,
    });
    expect(graph.edges[2].name).toBeUndefined();
    expect(graph.adjacency[1]).toEqual([0, 1, 4]);
  });

  it("rejects a malformed edge array", () => {
    expect(() =>
      decodeRoadGraph({ ...roads, edges: roads.edges.slice(0, 5) }),
    ).toThrow(/stride/);
    expect(() =>
      decodeRoadGraph({ ...roads, edges: [0, 9, 0, 0, 0, 1] }),
    ).toThrow(/node index/);
  });

  it("finds the nearest node within a distance limit", () => {
    const graph = decodeRoadGraph(roads);
    expect(graph.nearestNode([98, 3])).toBe(1);
    expect(graph.nearestNode([5000, 5000], 100)).toBeNull();
  });
});

describe("findPath", () => {
  it("returns the shortest node sequence and its length", () => {
    const graph = decodeRoadGraph(roads);
    const path = findPath(graph, 0, 2);
    expect(path).toEqual([0, 1, 2]);
    expect(pathLength(graph, path ?? [])).toBe(200);
  });

  it("returns a trivial path for the same node and null when unreachable", () => {
    const graph = decodeRoadGraph({ ...roads, edges: roads.edges.slice(0, 6) });
    expect(findPath(graph, 1, 1)).toEqual([1]);
    expect(findPath(graph, 0, 3)).toBeNull();
  });
});
```

```ts
// src/lib/cityArena/world/nearestRoad.test.ts
import { describe, expect, it } from "vitest";
import type { DecodedTile } from "./decode";
import { nearestRoadName } from "./nearestRoad";

const tile: DecodedTile = {
  x: 0,
  y: 0,
  rect: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
  roads: [
    { points: [[0, 0], [100, 0]], roadClass: "residential", name: "Herenstraat", bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 } },
    { points: [[0, 50], [100, 50]], roadClass: "service", bounds: { minX: 0, minY: 50, maxX: 100, maxY: 50 } },
    { points: [[0, 500], [100, 500]], roadClass: "primary", name: "Grebbeweg", bounds: { minX: 0, minY: 500, maxX: 100, maxY: 500 } },
  ],
  buildings: [],
  ground: [],
  water: [],
];

describe("nearestRoadName", () => {
  it("returns the closest named road within range, ignoring unnamed ones", () => {
    expect(nearestRoadName([tile], [50, 40])).toBe("Herenstraat");
    expect(nearestRoadName([tile], [50, 490], 30)).toBe("Grebbeweg");
    expect(nearestRoadName([tile], [50, 250], 30)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/world/roadGraph.test.ts src/lib/cityArena/world/nearestRoad.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement roadGraph.ts**

```ts
// src/lib/cityArena/world/roadGraph.ts
import { ROAD_EDGE_STRIDE, type MapRoads, type RoadClass } from "./mapTypes";
import { fromUnits, type Point } from "./projection";

/** Decoded edge between two vertex indices; `length` in metres. */
export type RoadGraphEdge = {
  a: number;
  b: number;
  roadClass: RoadClass;
  name?: string;
  oneway: boolean;
  length: number;
};

/** Routing graph with a nearest-vertex lookup. */
export type RoadGraph = {
  nodes: Point[];
  edges: RoadGraphEdge[];
  adjacency: number[][];
  nearestNode(point: Point, maxDistance?: number): number | null;
};

const BUCKET_M = 50;

function decodeNodes(roads: MapRoads): Point[] {
  const nodes: Point[] = [];
  for (let index = 0; index + 1 < roads.nodes.length; index += 2) {
    nodes.push([
      fromUnits(roads.nodes[index]),
      fromUnits(roads.nodes[index + 1]),
    ]);
  }
  return nodes;
}

function decodeEdges(roads: MapRoads, nodeCount: number): RoadGraphEdge[] {
  if (roads.edges.length % ROAD_EDGE_STRIDE !== 0) {
    throw new Error(
      `roads.json edges length ${roads.edges.length} is not a multiple of the stride ${ROAD_EDGE_STRIDE}`,
    );
  }
  const edges: RoadGraphEdge[] = [];
  for (
    let offset = 0;
    offset < roads.edges.length;
    offset += ROAD_EDGE_STRIDE
  ) {
    const [a, b, classIndex, nameIndex, oneway, lengthUnits] =
      roads.edges.slice(offset, offset + ROAD_EDGE_STRIDE);
    if (a >= nodeCount || b >= nodeCount || a < 0 || b < 0)
      throw new Error(
        `roads.json edge references an unknown node index (${a}, ${b})`,
      );
    const roadClass = roads.classes[classIndex];
    if (!roadClass)
      throw new Error(
        `roads.json edge references an unknown class index ${classIndex}`,
      );
    edges.push({
      a,
      b,
      roadClass,
      name: nameIndex >= 0 ? roads.names[nameIndex] : undefined,
      oneway: oneway === 1,
      length: fromUnits(lengthUnits),
    });
  }
  return edges;
}

function buildBuckets(nodes: Point[]): Map<string, number[]> {
  const buckets = new Map<string, number[]>();
  nodes.forEach((node, index) => {
    const key = `${Math.floor(node[0] / BUCKET_M)}:${Math.floor(node[1] / BUCKET_M)}`;
    const list = buckets.get(key) ?? [];
    list.push(index);
    buckets.set(key, list);
  });
  return buckets;
}

/** Decodes `roads.json` into a graph; throws on stride or index errors. */
export function decodeRoadGraph(roads: MapRoads): RoadGraph {
  const nodes = decodeNodes(roads);
  const edges = decodeEdges(roads, nodes.length);
  const adjacency: number[][] = nodes.map(() => []);
  edges.forEach((edge, index) => {
    adjacency[edge.a].push(index);
    adjacency[edge.b].push(index);
  });
  const buckets = buildBuckets(nodes);
  const nearestNode = (point: Point, maxDistance = 100): number | null => {
    const reach = Math.ceil(maxDistance / BUCKET_M);
    const baseX = Math.floor(point[0] / BUCKET_M);
    const baseY = Math.floor(point[1] / BUCKET_M);
    let best: number | null = null;
    let bestDistance = maxDistance;
    for (let by = baseY - reach; by <= baseY + reach; by++) {
      for (let bx = baseX - reach; bx <= baseX + reach; bx++) {
        for (const index of buckets.get(`${bx}:${by}`) ?? []) {
          const distance = Math.hypot(
            nodes[index][0] - point[0],
            nodes[index][1] - point[1],
          );
          if (distance <= bestDistance) {
            bestDistance = distance;
            best = index;
          }
        }
      }
    }
    return best;
  };
  return { nodes, edges, adjacency, nearestNode };
}

function reconstruct(cameFrom: Map<number, number>, current: number): number[] {
  const path = [current];
  let cursor = current;
  while (cameFrom.has(cursor)) {
    cursor = cameFrom.get(cursor) ?? cursor;
    path.push(cursor);
  }
  return path.reverse();
}

/** A* over the graph (one-way flags are ignored — pedestrians and cops may walk both ways). */
export function findPath(
  graph: RoadGraph,
  from: number,
  to: number,
): number[] | null {
  const heuristic = (index: number): number =>
    Math.hypot(
      graph.nodes[to][0] - graph.nodes[index][0],
      graph.nodes[to][1] - graph.nodes[index][1],
    );
  const open = new Set<number>([from]);
  const cameFrom = new Map<number, number>();
  const bestCost = new Map<number, number>([[from, 0]]);
  const estimate = new Map<number, number>([[from, heuristic(from)]]);
  while (open.size > 0) {
    let current = -1;
    let currentEstimate = Infinity;
    for (const candidate of open) {
      const value = estimate.get(candidate) ?? Infinity;
      if (value < currentEstimate) {
        currentEstimate = value;
        current = candidate;
      }
    }
    if (current === to) return reconstruct(cameFrom, current);
    open.delete(current);
    for (const edgeIndex of graph.adjacency[current]) {
      const edge = graph.edges[edgeIndex];
      const neighbour = edge.a === current ? edge.b : edge.a;
      const tentative = (bestCost.get(current) ?? Infinity) + edge.length;
      if (tentative >= (bestCost.get(neighbour) ?? Infinity)) continue;
      cameFrom.set(neighbour, current);
      bestCost.set(neighbour, tentative);
      estimate.set(neighbour, tentative + heuristic(neighbour));
      open.add(neighbour);
    }
  }
  return null;
}

/** Sum of edge lengths along a node path (0 for paths shorter than two nodes). */
export function pathLength(graph: RoadGraph, path: number[]): number {
  let total = 0;
  for (let index = 0; index + 1 < path.length; index++) {
    const edge = graph.edges.find(
      (candidate) =>
        (candidate.a === path[index] && candidate.b === path[index + 1]) ||
        (candidate.b === path[index] && candidate.a === path[index + 1]),
    );
    total += edge?.length ?? 0;
  }
  return total;
}
```

- [ ] **Step 4: Implement nearestRoad.ts**

```ts
// src/lib/cityArena/world/nearestRoad.ts
import { distancePointToSegment } from "../mapBuild/geometry";
import type { DecodedTile } from "./decode";
import type { Point } from "./projection";

/** Name of the closest named road piece within `maxDistance` metres, for the HUD. */
export function nearestRoadName(
  tiles: DecodedTile[],
  point: Point,
  maxDistance = 30,
): string | null {
  let bestName: string | null = null;
  let bestDistance = maxDistance;
  for (const tile of tiles) {
    for (const road of tile.roads) {
      if (!road.name) continue;
      if (
        point[0] < road.bounds.minX - maxDistance ||
        point[0] > road.bounds.maxX + maxDistance
      )
        continue;
      if (
        point[1] < road.bounds.minY - maxDistance ||
        point[1] > road.bounds.maxY + maxDistance
      )
        continue;
      for (let index = 0; index + 1 < road.points.length; index++) {
        const distance = distancePointToSegment(
          point,
          road.points[index],
          road.points[index + 1],
        );
        if (distance <= bestDistance) {
          bestDistance = distance;
          bestName = road.name;
        }
      }
    }
  }
  return bestName;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/world/roadGraph.test.ts src/lib/cityArena/world/nearestRoad.test.ts`
Expected: PASS (5 + 1 tests). `findPath(0, 2)` picks 0→1→2 (200 m) over 0→3→2 (also 200 m) because node 1's estimate is evaluated first — both are optimal; if the implementation returns `[0, 3, 2]` the test must still pass, so if it fails on ordering assert `pathLength` instead and accept either path.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/world
git add src/lib/cityArena/world
git commit -m "feat(arena): decode the road graph with nearest node, A* and road names

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Seeded RNG and zone helpers

**Files:**

- Create: `src/lib/cityArena/sim/rng.ts`
- Create: `src/lib/cityArena/world/zone.ts`
- Test: `src/lib/cityArena/sim/rng.test.ts`, `src/lib/cityArena/world/zone.test.ts`

**Interfaces:**

- Consumes: `MapIndex`, `MapZone`, `ZoneKey` (`./mapTypes`); `fromUnits`, `Point` (`./projection`).
- Produces: `createRng(seed: number): () => number` (mulberry32, values in `[0, 1)`), `seedFromString(text: string): number`; `zoneCentreMetres(zone): Point`, `zoneRadiusMetres(zone): number`, `findZone(index, point): MapZone | null`, `findZoneByKey(index, key: ZoneKey): MapZone | null`, `distanceToZoneEdge(zone, point): number` (negative inside), `pickSpawn(zone, random: () => number): Point`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/sim/rng.test.ts
import { describe, expect, it } from "vitest";
import { createRng, seedFromString } from "./rng";

describe("createRng", () => {
  it("is deterministic for a seed and stays within [0, 1)", () => {
    const first = createRng(42);
    const second = createRng(42);
    const sequence = Array.from({ length: 5 }, () => first());
    expect(sequence).toEqual(Array.from({ length: 5 }, () => second()));
    expect(sequence.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(createRng(43)()).not.toBe(sequence[0]);
  });

  it("hashes strings to stable seeds", () => {
    expect(seedFromString("wageningen")).toBe(seedFromString("wageningen"));
    expect(seedFromString("wageningen")).not.toBe(seedFromString("rhenen"));
  });
});
```

```ts
// src/lib/cityArena/world/zone.test.ts
import { describe, expect, it } from "vitest";
import type { MapIndex, MapZone } from "./mapTypes";
import {
  distanceToZoneEdge,
  findZone,
  findZoneByKey,
  pickSpawn,
  zoneCentreMetres,
  zoneRadiusMetres,
} from "./zone";

const wageningen: MapZone = {
  key: "wageningen",
  name: "Wageningen centrum",
  center: [10349, 6683],
  radius: 2000,
  spawnNodes: [
    [10000, 6000],
    [10400, 6800],
  ],
  landmarks: ["grote-kerk-wageningen"],
};
const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [wageningen],
  landmarks: [],
};

describe("zone helpers", () => {
  it("converts centre and radius to metres", () => {
    expect(zoneCentreMetres(wageningen)).toEqual([2587.25, 1670.75]);
    expect(zoneRadiusMetres(wageningen)).toBe(500);
  });

  it("finds the zone containing a point and signs the edge distance", () => {
    expect(findZone(index, [2600, 1700])?.key).toBe("wageningen");
    expect(findZone(index, [4000, 1700])).toBeNull();
    expect(distanceToZoneEdge(wageningen, [2587.25, 1670.75])).toBe(-500);
    expect(distanceToZoneEdge(wageningen, [3687.25, 1670.75])).toBe(600);
    expect(findZoneByKey(index, "rhenen")).toBeNull();
  });

  it("picks a spawn node deterministically and falls back to the centre", () => {
    expect(pickSpawn(wageningen, () => 0)).toEqual([2500, 1500]);
    expect(pickSpawn(wageningen, () => 0.999)).toEqual([2600, 1700]);
    expect(pickSpawn({ ...wageningen, spawnNodes: [] }, () => 0.5)).toEqual([
      2587.25, 1670.75,
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim/rng.test.ts src/lib/cityArena/world/zone.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement rng.ts and zone.ts**

```ts
// src/lib/cityArena/sim/rng.ts
/** mulberry32: a tiny deterministic PRNG returning floats in [0, 1). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (FNV-1a), usable as an RNG seed. */
export function seedFromString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
```

```ts
// src/lib/cityArena/world/zone.ts
import type { MapIndex, MapZone, ZoneKey } from "./mapTypes";
import { fromUnits, type Point } from "./projection";

/** Zone centre in metres. */
export function zoneCentreMetres(zone: MapZone): Point {
  return [fromUnits(zone.center[0]), fromUnits(zone.center[1])];
}

/** Zone radius in metres. */
export function zoneRadiusMetres(zone: MapZone): number {
  return fromUnits(zone.radius);
}

/** Signed distance to the zone edge: negative inside, positive outside. */
export function distanceToZoneEdge(zone: MapZone, point: Point): number {
  const [cx, cy] = zoneCentreMetres(zone);
  return Math.hypot(point[0] - cx, point[1] - cy) - zoneRadiusMetres(zone);
}

/** The zone whose disc contains the point, or `null` in the countryside. */
export function findZone(index: MapIndex, point: Point): MapZone | null {
  return (
    index.zones.find((zone) => distanceToZoneEdge(zone, point) <= 0) ?? null
  );
}

/** Zone by key. */
export function findZoneByKey(index: MapIndex, key: ZoneKey): MapZone | null {
  return index.zones.find((zone) => zone.key === key) ?? null;
}

/** A random spawn node (metres); the zone centre when the zone has none. */
export function pickSpawn(zone: MapZone, random: () => number): Point {
  if (zone.spawnNodes.length === 0) return zoneCentreMetres(zone);
  const index = Math.min(
    zone.spawnNodes.length - 1,
    Math.floor(random() * zone.spawnNodes.length),
  );
  const [x, y] = zone.spawnNodes[index];
  return [fromUnits(x), fromUnits(y)];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/sim/rng.test.ts src/lib/cityArena/world/zone.test.ts`
Expected: PASS (2 + 3 tests).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/cityArena
git add src/lib/cityArena/sim src/lib/cityArena/world
git commit -m "feat(arena): add seeded RNG and zone helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Walking simulation

**Files:**

- Create: `src/lib/cityArena/sim/types.ts`
- Create: `src/lib/cityArena/sim/player.ts`
- Create: `src/lib/cityArena/sim/freeRoam.ts`
- Test: `src/lib/cityArena/sim/player.test.ts`, `src/lib/cityArena/sim/freeRoam.test.ts`

**Interfaces:**

- Consumes: `CollisionGrid` (Task 3, only `resolveCircle`); `MapIndex`, `ZoneKey` (`../world/mapTypes`); `findZone` (Task 5); `Point` (`../world/projection`).
- Produces: `WorldInput = { move: [number, number] }`, `PlayerState = { x: number; y: number; facing: number; speed: number }`, `FreeRoamState = { tick: number; player: PlayerState; zoneKey: ZoneKey | null }`, `WALK_SPEED_MPS = 4`, `PLAYER_RADIUS_M = 0.4`, `SIM_STEP_S = 1 / 30`, `MOVE_DEAD_ZONE = 0.05`, `stepPlayer(player, input, dt, collision): PlayerState`, `createFreeRoamState(spawn: Point, index: MapIndex): FreeRoamState`, `stepFreeRoam(state, input, dt, world: { collision; index }): FreeRoamState`, `teleportPlayer(state, position: Point, index): FreeRoamState`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/sim/player.test.ts
import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import { PLAYER_RADIUS_M, WALK_SPEED_MPS, stepPlayer } from "./player";
import type { PlayerState } from "./types";

const free = { resolveCircle: (centre: Point): Point => centre };
const start: PlayerState = { x: 0, y: 0, facing: 0, speed: 0 };

describe("stepPlayer", () => {
  it("walks at 4 m/s scaled by the input magnitude and faces the movement direction", () => {
    const moved = stepPlayer(start, { move: [1, 0] }, 1, free);
    expect(moved.x).toBeCloseTo(WALK_SPEED_MPS);
    expect(moved.speed).toBeCloseTo(4);
    const halfSpeed = stepPlayer(start, { move: [0, 0.5] }, 1, free);
    expect(halfSpeed.y).toBeCloseTo(2);
    expect(halfSpeed.facing).toBeCloseTo(Math.PI / 2);
  });

  it("keeps the last facing when standing still and ignores dead-zone noise", () => {
    const facingRight = stepPlayer(start, { move: [1, 0] }, 0.1, free);
    const still = stepPlayer(facingRight, { move: [0.01, 0.01] }, 1, free);
    expect(still.x).toBeCloseTo(facingRight.x);
    expect(still.facing).toBe(facingRight.facing);
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
      { move: [1, 0] },
      1,
      wall,
    );
    expect(blocked.x).toBeCloseTo(10 - PLAYER_RADIUS_M);
  });
});
```

```ts
// src/lib/cityArena/sim/freeRoam.test.ts
import { describe, expect, it } from "vitest";
import type { MapIndex } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { createFreeRoamState, stepFreeRoam, teleportPlayer } from "./freeRoam";

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -26055, minY: -17692, maxX: 26055, maxY: 17692 },
  tileSize: 8000,
  tiles: [],
  zones: [
    {
      key: "campus",
      name: "WUR-campus",
      center: [0, 0],
      radius: 2000,
      spawnNodes: [],
      landmarks: [],
    },
  ],
  landmarks: [],
};
const world = {
  collision: { resolveCircle: (centre: Point): Point => centre },
  index,
};

describe("free roam", () => {
  it("starts at the spawn inside its zone and advances ticks", () => {
    const state = createFreeRoamState([10, 10], index);
    expect(state.player).toMatchObject({ x: 10, y: 10, speed: 0 });
    expect(state.zoneKey).toBe("campus");
    const next = stepFreeRoam(state, { move: [0, -1] }, 1 / 30, world);
    expect(next.tick).toBe(1);
    expect(next.player.y).toBeCloseTo(10 - 4 / 30);
  });

  it("leaves the zone when walking out of the disc and teleports back", () => {
    let state = createFreeRoamState([480, 0], index);
    for (let step = 0; step < 300; step++)
      state = stepFreeRoam(state, { move: [1, 0] }, 1 / 30, world);
    expect(state.player.x).toBeGreaterThan(500);
    expect(state.zoneKey).toBeNull();
    const back = teleportPlayer(state, [0, 0], index);
    expect(back.player).toMatchObject({ x: 0, y: 0, speed: 0 });
    expect(back.zoneKey).toBe("campus");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/sim/player.test.ts src/lib/cityArena/sim/freeRoam.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the simulation**

```ts
// src/lib/cityArena/sim/types.ts
import type { ZoneKey } from "../world/mapTypes";

/** Device-agnostic movement input: a vector with length ≤ 1 (x east, y south). */
export type WorldInput = { move: [number, number] };

/** The local player on foot; `facing` in radians, `speed` in m/s. */
export type PlayerState = {
  x: number;
  y: number;
  facing: number;
  speed: number;
};

/** Single-player free-roam session state. */
export type FreeRoamState = {
  tick: number;
  player: PlayerState;
  zoneKey: ZoneKey | null;
};
```

```ts
// src/lib/cityArena/sim/player.ts
import type { CollisionGrid } from "../world/collisionGrid";
import type { PlayerState, WorldInput } from "./types";

/** Walking speed at full stick deflection. */
export const WALK_SPEED_MPS = 4;

/** Collision radius of a person. */
export const PLAYER_RADIUS_M = 0.4;

/** Fixed simulation step (30 Hz). */
export const SIM_STEP_S = 1 / 30;

/** Input magnitudes below this are treated as "not moving". */
export const MOVE_DEAD_ZONE = 0.05;

/** Advances the player by `dt` seconds and resolves collisions. */
export function stepPlayer(
  player: PlayerState,
  input: WorldInput,
  dt: number,
  collision: Pick<CollisionGrid, "resolveCircle">,
): PlayerState {
  const magnitude = Math.min(1, Math.hypot(input.move[0], input.move[1]));
  if (magnitude < MOVE_DEAD_ZONE) return { ...player, speed: 0 };
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
    facing: Math.atan2(input.move[1], input.move[0]),
    speed: magnitude * WALK_SPEED_MPS,
  };
}
```

```ts
// src/lib/cityArena/sim/freeRoam.ts
import type { CollisionGrid } from "../world/collisionGrid";
import type { MapIndex } from "../world/mapTypes";
import type { Point } from "../world/projection";
import { findZone } from "../world/zone";
import { stepPlayer } from "./player";
import type { FreeRoamState, WorldInput } from "./types";

/** What the free-roam step needs from the world. */
export type FreeRoamWorld = {
  collision: Pick<CollisionGrid, "resolveCircle">;
  index: MapIndex;
};

/** A fresh session standing still at `spawn`. */
export function createFreeRoamState(
  spawn: Point,
  index: MapIndex,
): FreeRoamState {
  return {
    tick: 0,
    player: { x: spawn[0], y: spawn[1], facing: -Math.PI / 2, speed: 0 },
    zoneKey: findZone(index, spawn)?.key ?? null,
  };
}

/** One fixed step: move the player and re-evaluate which zone they are in. */
export function stepFreeRoam(
  state: FreeRoamState,
  input: WorldInput,
  dt: number,
  world: FreeRoamWorld,
): FreeRoamState {
  const player = stepPlayer(state.player, input, dt, world.collision);
  return {
    tick: state.tick + 1,
    player,
    zoneKey: findZone(world.index, [player.x, player.y])?.key ?? null,
  };
}

/** Moves the player instantly (zone picker), keeping the facing. */
export function teleportPlayer(
  state: FreeRoamState,
  position: Point,
  index: MapIndex,
): FreeRoamState {
  return {
    ...state,
    player: { ...state.player, x: position[0], y: position[1], speed: 0 },
    zoneKey: findZone(index, position)?.key ?? null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/sim/player.test.ts src/lib/cityArena/sim/freeRoam.test.ts`
Expected: PASS (3 + 2 tests).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/cityArena/sim
git add src/lib/cityArena/sim
git commit -m "feat(arena): add the walking simulation and free-roam state

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Input — merged state, keyboard mapping, floating stick math

**Files:**

- Create: `src/lib/cityArena/input/inputState.ts`
- Create: `src/lib/cityArena/input/keyboard.ts`
- Create: `src/lib/cityArena/input/touchStick.ts`
- Test: `src/lib/cityArena/input/inputState.test.ts`, `src/lib/cityArena/input/keyboard.test.ts`, `src/lib/cityArena/input/touchStick.test.ts`

**Interfaces:**

- Consumes: `WorldInput` (Task 6).
- Produces: `clampToUnit(vector: [number, number]): [number, number]`, `InputState = { setKeyboard(vector): void; setStick(vector | null): void; snapshot(): WorldInput }`, `createInputState(): InputState`; `KeyboardTarget = Pick<Window, "addEventListener" | "removeEventListener">`, `attachKeyboard(target, state): () => void`; `STICK_RADIUS_PX = 48`, `STICK_DEAD_ZONE = 0.15`, `StickState = { pointerId: number | null; origin: [number, number] | null; knob: [number, number] | null; vector: [number, number] }`, `StickController = { begin(pointerId, x, y): void; move(pointerId, x, y): void; end(pointerId): void; state(): StickState }`, `createStick(radiusPx?: number, deadZone?: number): StickController`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/input/inputState.test.ts
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
    expect(state.snapshot()).toEqual({ move: [0, -0.5] });
    state.setStick(null);
    expect(state.snapshot().move[1]).toBeCloseTo(Math.SQRT1_2);
  });
});
```

```ts
// src/lib/cityArena/input/keyboard.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInputState } from "./inputState";
import { attachKeyboard } from "./keyboard";

describe("attachKeyboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps WASD and arrows to a movement vector and releases on keyup", () => {
    const state = createInputState();
    const detach = attachKeyboard(window, state);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp" }));
    expect(state.snapshot().move[0]).toBeCloseTo(Math.SQRT1_2);
    expect(state.snapshot().move[1]).toBeCloseTo(-Math.SQRT1_2);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" }));
    expect(state.snapshot()).toEqual({ move: [0, -1] });
    detach();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
    expect(state.snapshot()).toEqual({ move: [0, -1] });
  });

  it("ignores keys typed into form fields and resets on blur", () => {
    const state = createInputState();
    const detach = attachKeyboard(window, state);
    const input = document.createElement("input");
    document.body.append(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }),
    );
    expect(state.snapshot()).toEqual({ move: [0, 0] });
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    expect(state.snapshot()).toEqual({ move: [0, -1] });
    window.dispatchEvent(new Event("blur"));
    expect(state.snapshot()).toEqual({ move: [0, 0] });
    detach();
    input.remove();
  });
});
```

```ts
// src/lib/cityArena/input/touchStick.test.ts
import { describe, expect, it } from "vitest";
import { STICK_RADIUS_PX, createStick } from "./touchStick";

describe("createStick", () => {
  it("anchors at the first touch and reports a scaled vector", () => {
    const stick = createStick();
    stick.begin(7, 100, 200);
    expect(stick.state().origin).toEqual([100, 200]);
    stick.move(7, 100 + STICK_RADIUS_PX / 2, 200);
    expect(stick.state().vector[0]).toBeCloseTo((0.5 - 0.15) / 0.85);
    expect(stick.state().vector[1]).toBe(0);
  });

  it("clamps the knob to the radius, applies the dead zone and ignores other pointers", () => {
    const stick = createStick();
    stick.begin(1, 0, 0);
    stick.move(1, 500, 0);
    expect(stick.state().knob).toEqual([STICK_RADIUS_PX, 0]);
    expect(stick.state().vector).toEqual([1, 0]);
    stick.move(2, -500, 0);
    expect(stick.state().vector).toEqual([1, 0]);
    stick.move(1, 3, 0);
    expect(stick.state().vector).toEqual([0, 0]);
  });

  it("releases on end and only for the owning pointer", () => {
    const stick = createStick();
    stick.begin(1, 0, 0);
    stick.move(1, 0, -48);
    stick.end(2);
    expect(stick.state().vector).toEqual([0, -1]);
    stick.end(1);
    expect(stick.state()).toEqual({
      pointerId: null,
      origin: null,
      knob: null,
      vector: [0, 0],
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/input`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the input modules**

```ts
// src/lib/cityArena/input/inputState.ts
import type { WorldInput } from "../sim/types";

/** Scales a vector down to unit length when it is longer. */
export function clampToUnit(vector: [number, number]): [number, number] {
  const length = Math.hypot(vector[0], vector[1]);
  if (length <= 1) return [vector[0], vector[1]];
  return [vector[0] / length, vector[1] / length];
}

/** Merges keyboard and stick input; the stick wins while a finger is down. */
export type InputState = {
  setKeyboard(vector: [number, number]): void;
  setStick(vector: [number, number] | null): void;
  snapshot(): WorldInput;
};

/** Creates an empty input state. */
export function createInputState(): InputState {
  let keyboard: [number, number] = [0, 0];
  let stick: [number, number] | null = null;
  return {
    setKeyboard(vector) {
      keyboard = vector;
    },
    setStick(vector) {
      stick = vector;
    },
    snapshot: () => ({ move: clampToUnit(stick ?? keyboard) }),
  };
}
```

```ts
// src/lib/cityArena/input/keyboard.ts
import type { InputState } from "./inputState";

/** The subset of `window` the keyboard binding needs (injectable in tests). */
export type KeyboardTarget = Pick<
  Window,
  "addEventListener" | "removeEventListener"
>;

const KEY_VECTORS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/** Binds WASD/arrow keys to the input state; returns the detach function. */
export function attachKeyboard(
  target: KeyboardTarget,
  state: InputState,
): () => void {
  const pressed = new Set<string>();
  const publish = (): void => {
    let x = 0;
    let y = 0;
    for (const code of pressed) {
      const [dx, dy] = KEY_VECTORS[code];
      x += dx;
      y += dy;
    }
    state.setKeyboard([Math.sign(x), Math.sign(y)]);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.code in KEY_VECTORS) || isTypingTarget(event.target)) return;
    if (event.code.startsWith("Arrow")) event.preventDefault();
    pressed.add(event.code);
    publish();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (!pressed.delete(event.code)) return;
    publish();
  };
  const onBlur = (): void => {
    pressed.clear();
    publish();
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
// src/lib/cityArena/input/touchStick.ts
/** Maximum knob travel from the origin, in CSS pixels. */
export const STICK_RADIUS_PX = 48;

/** Fraction of the radius that counts as "not moving". */
export const STICK_DEAD_ZONE = 0.15;

/** Current stick geometry for rendering and the resulting movement vector. */
export type StickState = {
  pointerId: number | null;
  origin: [number, number] | null;
  knob: [number, number] | null;
  vector: [number, number];
};

/** A floating joystick that appears wherever the first finger lands. */
export type StickController = {
  begin(pointerId: number, x: number, y: number): void;
  move(pointerId: number, x: number, y: number): void;
  end(pointerId: number): void;
  state(): StickState;
};

function scaleThroughDeadZone(deflection: number, deadZone: number): number {
  if (deflection <= deadZone) return 0;
  return (deflection - deadZone) / (1 - deadZone);
}

/** Creates a stick; `radiusPx` and `deadZone` default to the spec values. */
export function createStick(
  radiusPx = STICK_RADIUS_PX,
  deadZone = STICK_DEAD_ZONE,
): StickController {
  let current: StickState = {
    pointerId: null,
    origin: null,
    knob: null,
    vector: [0, 0],
  };
  return {
    begin(pointerId, x, y) {
      current = { pointerId, origin: [x, y], knob: [x, y], vector: [0, 0] };
    },
    move(pointerId, x, y) {
      if (current.pointerId !== pointerId || !current.origin) return;
      const dx = x - current.origin[0];
      const dy = y - current.origin[1];
      const distance = Math.hypot(dx, dy);
      const clamped = Math.min(1, distance / radiusPx);
      const unitX = distance === 0 ? 0 : dx / distance;
      const unitY = distance === 0 ? 0 : dy / distance;
      const magnitude = scaleThroughDeadZone(clamped, deadZone);
      current = {
        ...current,
        knob: [
          current.origin[0] + unitX * clamped * radiusPx,
          current.origin[1] + unitY * clamped * radiusPx,
        ],
        vector: [unitX * magnitude, unitY * magnitude],
      };
    },
    end(pointerId) {
      if (current.pointerId !== pointerId) return;
      current = { pointerId: null, origin: null, knob: null, vector: [0, 0] };
    },
    state: () => current,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/input`
Expected: PASS (2 + 2 + 3 tests). In the first stick test the knob is at half radius: `clamped = 0.5`, magnitude `(0.5 − 0.15) / 0.85 ≈ 0.4118`.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/cityArena/input
git add src/lib/cityArena/input
git commit -m "feat(arena): add keyboard and floating-stick movement input

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Palette, camera and street-label planning

**Files:**

- Create: `src/lib/cityArena/render/palette.ts`
- Create: `src/lib/cityArena/render/camera.ts`
- Create: `src/lib/cityArena/render/streetLabels.ts`
- Test: `src/lib/cityArena/render/camera.test.ts`, `src/lib/cityArena/render/streetLabels.test.ts`

**Interfaces:**

- Consumes: `GroundKind`, `RoadClass`, `LandmarkStyle` (`../world/mapTypes`); `Point` (`../world/projection`); `Rect` (`../mapBuild/geometry`); `DecodedRoad` (Task 1).
- Produces (palette): `GROUND_FILL: Record<GroundKind, string>`, `WATER_FILL`, `ROAD_FILL`, `ROAD_CENTRE_LINE`, `PAVEMENT_FILL`, `PAVEMENT_WIDTH_M = 2`, `ROAD_WIDTH_M: Record<RoadClass, number>`, `CENTRE_LINE_CLASSES: RoadClass[]`, `PAVEMENT_CLASSES: RoadClass[]`, `buildingFill(levels: number): string`, `BUILDING_STROKE`, `LANDMARK_FILL: Record<LandmarkStyle, string>`, `LABEL_FILL`, `LABEL_HALO`, `STREET_LABEL_PX = 11`, `LANDMARK_LABEL_PX = 13`, `HATCH_BACKGROUND`, `HATCH_LINE`, `PLACEHOLDER_FILL`, `PLAYER_FILL`, `PLAYER_RING`, `ZONE_RING`.
- Produces (camera): `ZOOM_LEVELS = [4, 6, 8]`, `ZoomLevel = 4 | 6 | 8`, `Viewport = { width: number; height: number }` (CSS px), `Camera = { x: number; y: number; zoom: ZoomLevel }`, `LOOK_AHEAD_S = 0.4`, `LOOK_AHEAD_MAX_M = 15`, `CAMERA_EASE_PER_S = 6`, `PHONE_VIEW_METRES = 60`, `DESKTOP_VIEW_METRES = 120`, `DESKTOP_MIN_WIDTH_PX = 768`, `zoomLevelForViewport(widthPx): ZoomLevel`, `createCamera(centre: Point, zoom: ZoomLevel): Camera`, `updateCamera(camera, target: Point, velocity: Point, dt: number): Camera`, `visibleRect(camera, viewport): Rect`, `worldToScreen(camera, viewport, point): [number, number]`, `screenToWorld(camera, viewport, point: [number, number]): Point`.
- Produces (labels): `LABEL_MIN_SEGMENT_M = 40`, `LABEL_SPACING_M = 120`, `StreetLabel = { text: string; x: number; y: number; angle: number }`, `planStreetLabels(road: DecodedRoad, ownRect: Rect): StreetLabel[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/render/camera.test.ts
import { describe, expect, it } from "vitest";
import {
  createCamera,
  screenToWorld,
  updateCamera,
  visibleRect,
  worldToScreen,
  zoomLevelForViewport,
} from "./camera";

describe("camera", () => {
  it("quantises zoom so phones see about 60 m and desktops about 120 m", () => {
    expect(zoomLevelForViewport(390)).toBe(6);
    expect(zoomLevelForViewport(300)).toBe(4);
    expect(zoomLevelForViewport(800)).toBe(6);
    expect(zoomLevelForViewport(1400)).toBe(8);
  });

  it("maps between world and screen around the camera centre", () => {
    const camera = createCamera([100, 200], 8);
    const viewport = { width: 400, height: 300 };
    expect(worldToScreen(camera, viewport, [100, 200])).toEqual([200, 150]);
    expect(worldToScreen(camera, viewport, [110, 190])).toEqual([280, 70]);
    expect(screenToWorld(camera, viewport, [280, 70])).toEqual([110, 190]);
    expect(visibleRect(camera, viewport)).toEqual({
      minX: 75,
      minY: 181.25,
      maxX: 125,
      maxY: 218.75,
    });
  });

  it("eases toward the target with a capped look-ahead", () => {
    let camera = createCamera([0, 0], 6);
    for (let step = 0; step < 300; step++)
      camera = updateCamera(camera, [50, 0], [4, 0], 1 / 60);
    expect(camera.x).toBeCloseTo(51.6, 1);
    expect(camera.y).toBeCloseTo(0);
    let fast = createCamera([0, 0], 6);
    for (let step = 0; step < 300; step++)
      fast = updateCamera(fast, [0, 0], [1000, 0], 1 / 60);
    expect(fast.x).toBeCloseTo(15, 1);
  });
});
```

```ts
// src/lib/cityArena/render/streetLabels.test.ts
import { describe, expect, it } from "vitest";
import type { DecodedRoad } from "../world/decode";
import { planStreetLabels } from "./streetLabels";

const own = { minX: 0, minY: 0, maxX: 2000, maxY: 2000 };
function road(points: [number, number][], name = "Dorpsstraat"): DecodedRoad {
  return {
    points,
    roadClass: "residential",
    name,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
}

describe("planStreetLabels", () => {
  it("places one centred label on a short road and none on very short or unnamed roads", () => {
    expect(
      planStreetLabels(
        road([
          [0, 10],
          [100, 10],
        ]),
        own,
      ),
    ).toEqual([{ text: "Dorpsstraat", x: 50, y: 10, angle: 0 }]);
    expect(
      planStreetLabels(
        road([
          [0, 10],
          [30, 10],
        ]),
        own,
      ),
    ).toEqual([]);
    expect(
      planStreetLabels(
        {
          ...road([
            [0, 10],
            [100, 10],
          ]),
          name: undefined,
        },
        own,
      ),
    ).toEqual([]);
  });

  it("repeats labels every 120 m and flips upside-down text", () => {
    const labels = planStreetLabels(
      road([
        [300, 10],
        [0, 10],
      ]),
      own,
    );
    expect(labels.map((label) => label.x)).toEqual([200, 100]);
    expect(labels.every((label) => label.angle === 0)).toBe(true);
    const diagonal = planStreetLabels(
      road([
        [0, 0],
        [100, 100],
      ]),
      own,
    );
    expect(diagonal[0].angle).toBeCloseTo(Math.PI / 4);
  });

  it("skips labels whose anchor lies outside the tile's own rectangle", () => {
    expect(
      planStreetLabels(
        road([
          [1990, 10],
          [2090, 10],
        ]),
        own,
      ),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/render`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement palette.ts**

```ts
// src/lib/cityArena/render/palette.ts
import type { GroundKind, LandmarkStyle, RoadClass } from "../world/mapTypes";

/** Ground fills; `urban` is also the chunk background where no polygon exists. */
export const GROUND_FILL: Record<GroundKind, string> = {
  grass: "#6f9f5a",
  field: "#b9ab6f",
  forest: "#3f6f43",
  urban: "#c8c2b4",
};
/** Water fill. */
export const WATER_FILL = "#5f9bd6";
/** Road surface. */
export const ROAD_FILL = "#f2eee6";
/** Dashed centre line on the bigger roads. */
export const ROAD_CENTRE_LINE = "#e0b64a";
/** Pavement colour drawn under zone roads. */
export const PAVEMENT_FILL = "#d8d2c6";
/** Pavement width on each side of the road, metres. */
export const PAVEMENT_WIDTH_M = 2;
/** Road widths in metres by class (spec §4). */
export const ROAD_WIDTH_M: Record<RoadClass, number> = {
  motorway: 12,
  trunk: 10,
  primary: 9,
  secondary: 8,
  tertiary: 7,
  unclassified: 6,
  residential: 6,
  living_street: 5,
  pedestrian: 4,
  service: 4,
};
/** Classes that get a dashed centre line. */
export const CENTRE_LINE_CLASSES: RoadClass[] = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
];
/** Classes that get pavements. */
export const PAVEMENT_CLASSES: RoadClass[] = [
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
];
/** Roof shade by number of levels. */
export function buildingFill(levels: number): string {
  if (levels <= 1) return "#a89886";
  if (levels === 2) return "#9a8878";
  if (levels <= 4) return "#8c7a6a";
  return "#7c6a5c";
}
/** Building outline. */
export const BUILDING_STROKE = "#4a3f36";
/** Landmark roof colours by style. */
export const LANDMARK_FILL: Record<LandmarkStyle, string> = {
  church: "#b8473f",
  pool: "#4aa3df",
  campus: "#5aa66f",
  cafe: "#d98b3a",
};
/** Label ink and halo. */
export const LABEL_FILL = "#1f1a16";
export const LABEL_HALO = "rgba(255,255,255,0.85)";
/** Street label size in screen pixels. */
export const STREET_LABEL_PX = 11;
/** Landmark label size in screen pixels. */
export const LANDMARK_LABEL_PX = 13;
/** Hatch pattern for areas without a loaded tile. */
export const HATCH_BACKGROUND = "#2a2f38";
export const HATCH_LINE = "#3b4250";
/** Flat colour shown while a chunk is still being rasterised. */
export const PLACEHOLDER_FILL = "#c8c2b4";
/** Player sprite colours. */
export const PLAYER_FILL = "#f5f5f5";
export const PLAYER_RING = "#e11d48";
/** Zone boundary ring. */
export const ZONE_RING = "rgba(29,78,216,0.7)";
```

- [ ] **Step 4: Implement camera.ts**

```ts
// src/lib/cityArena/render/camera.ts
import type { Rect } from "../mapBuild/geometry";
import type { Point } from "../world/projection";

/** Raster zoom levels in px per metre; intermediate zooms are not used. */
export const ZOOM_LEVELS = [4, 6, 8] as const;
/** One of {@link ZOOM_LEVELS}. */
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];
/** Canvas size in CSS pixels. */
export type Viewport = { width: number; height: number };
/** Camera centre in metres plus its zoom. */
export type Camera = { x: number; y: number; zoom: ZoomLevel };

/** Look-ahead time and cap (spec §8). */
export const LOOK_AHEAD_S = 0.4;
export const LOOK_AHEAD_MAX_M = 15;
/** Exponential easing rate per second. */
export const CAMERA_EASE_PER_S = 6;
/** Target width of the view in metres. */
export const PHONE_VIEW_METRES = 60;
export const DESKTOP_VIEW_METRES = 120;
/** Viewports at least this wide count as desktop. */
export const DESKTOP_MIN_WIDTH_PX = 768;

/** Nearest zoom level so that the viewport shows ≈ 60 m (phone) or ≈ 120 m (desktop). */
export function zoomLevelForViewport(widthPx: number): ZoomLevel {
  const targetMetres =
    widthPx < DESKTOP_MIN_WIDTH_PX ? PHONE_VIEW_METRES : DESKTOP_VIEW_METRES;
  const ideal = widthPx / targetMetres;
  let best: ZoomLevel = ZOOM_LEVELS[0];
  for (const level of ZOOM_LEVELS) {
    if (Math.abs(level - ideal) < Math.abs(best - ideal)) best = level;
  }
  return best;
}

/** A camera centred on `centre`. */
export function createCamera(centre: Point, zoom: ZoomLevel): Camera {
  return { x: centre[0], y: centre[1], zoom };
}

/** Eases the camera toward the target plus a velocity look-ahead capped at 15 m. */
export function updateCamera(
  camera: Camera,
  target: Point,
  velocity: Point,
  dt: number,
): Camera {
  let aheadX = velocity[0] * LOOK_AHEAD_S;
  let aheadY = velocity[1] * LOOK_AHEAD_S;
  const aheadLength = Math.hypot(aheadX, aheadY);
  if (aheadLength > LOOK_AHEAD_MAX_M) {
    aheadX *= LOOK_AHEAD_MAX_M / aheadLength;
    aheadY *= LOOK_AHEAD_MAX_M / aheadLength;
  }
  const ease = 1 - Math.exp(-CAMERA_EASE_PER_S * dt);
  return {
    x: camera.x + (target[0] + aheadX - camera.x) * ease,
    y: camera.y + (target[1] + aheadY - camera.y) * ease,
    zoom: camera.zoom,
  };
}

/** World rectangle visible through the viewport. */
export function visibleRect(camera: Camera, viewport: Viewport): Rect {
  const halfWidth = viewport.width / camera.zoom / 2;
  const halfHeight = viewport.height / camera.zoom / 2;
  return {
    minX: camera.x - halfWidth,
    minY: camera.y - halfHeight,
    maxX: camera.x + halfWidth,
    maxY: camera.y + halfHeight,
  };
}

/** Metres → CSS pixels. */
export function worldToScreen(
  camera: Camera,
  viewport: Viewport,
  point: Point,
): [number, number] {
  return [
    viewport.width / 2 + (point[0] - camera.x) * camera.zoom,
    viewport.height / 2 + (point[1] - camera.y) * camera.zoom,
  ];
}

/** CSS pixels → metres. */
export function screenToWorld(
  camera: Camera,
  viewport: Viewport,
  point: [number, number],
): Point {
  return [
    camera.x + (point[0] - viewport.width / 2) / camera.zoom,
    camera.y + (point[1] - viewport.height / 2) / camera.zoom,
  ];
}
```

- [ ] **Step 5: Implement streetLabels.ts**

```ts
// src/lib/cityArena/render/streetLabels.ts
import type { Rect } from "../mapBuild/geometry";
import type { DecodedRoad } from "../world/decode";

/** Roads shorter than this get no label. */
export const LABEL_MIN_SEGMENT_M = 40;
/** Distance between repeated labels along one road piece. */
export const LABEL_SPACING_M = 120;

/** A label anchor in metres with the text rotation in radians. */
export type StreetLabel = { text: string; x: number; y: number; angle: number };

function polylineLength(points: DecodedRoad["points"]): number {
  let total = 0;
  for (let index = 0; index + 1 < points.length; index++) {
    total += Math.hypot(
      points[index + 1][0] - points[index][0],
      points[index + 1][1] - points[index][1],
    );
  }
  return total;
}

function pointAlong(
  points: DecodedRoad["points"],
  distance: number,
): { x: number; y: number; angle: number } {
  let remaining = distance;
  for (let index = 0; index + 1 < points.length; index++) {
    const [ax, ay] = points[index];
    const [bx, by] = points[index + 1];
    const segment = Math.hypot(bx - ax, by - ay);
    if (remaining <= segment || index === points.length - 2) {
      const t = segment === 0 ? 0 : Math.min(1, remaining / segment);
      let angle = Math.atan2(by - ay, bx - ax);
      if (angle > Math.PI / 2 || angle <= -Math.PI / 2)
        angle += angle > 0 ? -Math.PI : Math.PI;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle };
    }
    remaining -= segment;
  }
  return { x: points[0][0], y: points[0][1], angle: 0 };
}

/** Label anchors for a named road piece, only where the anchor lies inside the tile's own rect. */
export function planStreetLabels(
  road: DecodedRoad,
  ownRect: Rect,
): StreetLabel[] {
  if (!road.name || road.points.length < 2) return [];
  const length = polylineLength(road.points);
  if (length < LABEL_MIN_SEGMENT_M) return [];
  const count = Math.max(1, Math.floor(length / LABEL_SPACING_M));
  const labels: StreetLabel[] = [];
  for (let index = 1; index <= count; index++) {
    const anchor = pointAlong(road.points, (length * index) / (count + 1));
    const inside =
      anchor.x >= ownRect.minX &&
      anchor.x < ownRect.maxX &&
      anchor.y >= ownRect.minY &&
      anchor.y < ownRect.maxY;
    if (inside)
      labels.push({
        text: road.name,
        x: anchor.x,
        y: anchor.y,
        angle: anchor.angle,
      });
  }
  return labels;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/render`
Expected: PASS (3 + 3 tests). Camera trace: at 4 m/s the look-ahead is 1.6 m, so the camera settles at 51.6; at 1000 m/s it is capped at 15 m.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/cityArena/render
git add src/lib/cityArena/render
git commit -m "feat(arena): add palette, camera and street-label planning

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Chunk painting and the byte-budgeted static raster

**Files:**

- Create: `src/lib/cityArena/render/canvasTypes.ts`
- Create: `src/lib/cityArena/render/testing/fakeContext.ts` (test helper)
- Create: `src/lib/cityArena/render/drawStatic.ts`
- Create: `src/lib/cityArena/render/staticRaster.ts`
- Test: `src/lib/cityArena/render/drawStatic.test.ts`, `src/lib/cityArena/render/staticRaster.test.ts`

**Interfaces:**

- Consumes: palette (Task 8), `planStreetLabels`, `ZoomLevel`; `DecodedTile`, `DecodedRoad` (Task 1); `rectsIntersect`, `Rect`, `polygonCentroid` (`../mapBuild/geometry`); `createLru` (Task 2); `LandmarkStyle` (`../world/mapTypes`); `Point`.
- Produces: `RasterContext` (structural 2D-context type incl. `rect`/`clip`/`setLineDash`/`strokeText`), `RasterTarget = { canvas: CanvasImageSource; ctx: RasterContext; width: number; height: number }`, `CanvasFactory = (widthPx, heightPx) => RasterTarget | null`, `createDomCanvasFactory(): CanvasFactory`; `LandmarkInfo = { name: string; style: LandmarkStyle }`, `LandmarkLookup = Map<string, LandmarkInfo>`, `paintChunk(ctx, chunkRect: Rect, zoom: number, tiles: DecodedTile[], landmarks: LandmarkLookup): void`; `CHUNK_METRES = 128`, `RASTER_BUDGET_BYTES = 40 * 1024 * 1024`, `ChunkCoord = { zoom: ZoomLevel; cx: number; cy: number }`, `chunkKey(coord): string`, `chunkRect(coord): Rect`, `chunksCovering(rect: Rect, zoom: ZoomLevel): ChunkCoord[]` (nearest to the rect centre first), `Chunk = { key: string; coord: ChunkCoord; rect: Rect; target: RasterTarget; bytes: number }`, `StaticRaster = { getChunk(coord): Chunk | undefined; ensureChunk(coord, tiles, landmarks): Chunk | null; rasterizeNext(needed: ChunkCoord[], tiles, landmarks): boolean; invalidateRect(rect: Rect): void; stats(): { chunks: number; bytes: number }; dispose(): void }`, `createStaticRaster(factory: CanvasFactory, budgetBytes?: number): StaticRaster`; test helpers `createFakeContext(): FakeContext` (records calls), `createFakeTarget(width, height)`.

- [ ] **Step 1: Write the recording fake context (test helper)**

```ts
// src/lib/cityArena/render/testing/fakeContext.ts
import type { RasterContext, RasterTarget } from "../canvasTypes";

/** A 2D context that records every call so tests can assert paint order. */
export type FakeContext = RasterContext & { calls: string[] };

/** Creates a fake context; each method appends `name(arg1,arg2,…)` to `calls`. */
export function createFakeContext(): FakeContext {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push(
        `${name}(${args.map((arg) => (typeof arg === "number" ? Math.round(arg * 100) / 100 : String(arg))).join(",")})`,
      );
    };
  const context = {
    calls,
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    font: "10px sans-serif",
    textAlign: "start" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    globalAlpha: 1,
    save: record("save"),
    restore: record("restore"),
    translate: record("translate"),
    scale: record("scale"),
    rotate: record("rotate"),
    setTransform: record("setTransform"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    closePath: record("closePath"),
    rect: record("rect"),
    clip: record("clip"),
    fill: (): void => calls.push(`fill(${String(context.fillStyle)})`),
    stroke: (): void =>
      calls.push(`stroke(${String(context.strokeStyle)},${context.lineWidth})`),
    fillRect: record("fillRect"),
    clearRect: record("clearRect"),
    fillText: (text: string, x: number, y: number): void =>
      calls.push(`fillText(${text},${Math.round(x)},${Math.round(y)})`),
    strokeText: (text: string, x: number, y: number): void =>
      calls.push(`strokeText(${text},${Math.round(x)},${Math.round(y)})`),
    drawImage: record("drawImage"),
    arc: record("arc"),
    setLineDash: record("setLineDash"),
  };
  return context;
}

/** A raster target backed by the fake context and a jsdom canvas element. */
export function createFakeTarget(
  width: number,
  height: number,
): RasterTarget & { ctx: FakeContext } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: createFakeContext(), width, height };
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/cityArena/render/drawStatic.test.ts
import { describe, expect, it } from "vitest";
import type { DecodedTile } from "../world/decode";
import { paintChunk, type LandmarkLookup } from "./drawStatic";
import { GROUND_FILL, LANDMARK_FILL, ROAD_FILL, WATER_FILL } from "./palette";
import { createFakeContext } from "./testing/fakeContext";

const tile: DecodedTile = {
  x: 0,
  y: 0,
  rect: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
  roads: [
    {
      points: [
        [0, 64],
        [200, 64],
      ],
      roadClass: "primary",
      name: "Grebbeweg",
      bounds: { minX: 0, minY: 64, maxX: 200, maxY: 64 },
    },
  ],
  buildings: [
    {
      ring: [
        [10, 10],
        [30, 10],
        [30, 30],
        [10, 30],
      ],
      bounds: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
      levels: 4,
      landmark: "cunerakerk",
    },
    {
      ring: [
        [50, 10],
        [60, 10],
        [60, 20],
        [50, 20],
      ],
      bounds: { minX: 50, minY: 10, maxX: 60, maxY: 20 },
      levels: 2,
    },
  ],
  ground: [
    {
      ring: [
        [0, 0],
        [128, 0],
        [128, 128],
        [0, 128],
      ],
      bounds: { minX: 0, minY: 0, maxX: 128, maxY: 128 },
      kind: "grass",
    },
  ],
  water: [
    {
      ring: [
        [100, 100],
        [120, 100],
        [120, 120],
      ],
      bounds: { minX: 100, minY: 100, maxX: 120, maxY: 120 },
    },
  ],
};
const farTile: DecodedTile = {
  ...tile,
  x: 3,
  y: 3,
  rect: { minX: 6000, minY: 6000, maxX: 8000, maxY: 8000 },
  roads: [],
  buildings: [],
  ground: [
    {
      ring: [
        [6000, 6000],
        [6100, 6000],
        [6100, 6100],
      ],
      bounds: { minX: 6000, minY: 6000, maxX: 6100, maxY: 6100 },
      kind: "forest",
    },
  ],
  water: [],
};
const landmarks: LandmarkLookup = new Map([
  ["cunerakerk", { name: "Cunerakerk", style: "church" }],
]);

describe("paintChunk", () => {
  it("paints ground, water, roads and buildings in order and labels landmarks and streets", () => {
    const ctx = createFakeContext();
    paintChunk(
      ctx,
      { minX: 0, minY: 0, maxX: 128, maxY: 128 },
      6,
      [tile, farTile],
      landmarks,
    );
    const fills = ctx.calls.filter((call) => call.startsWith("fill("));
    expect(ctx.calls[1]).toBe("fillRect(0,0,128,128)");
    expect(fills[0]).toBe(`fill(${GROUND_FILL.grass})`);
    expect(fills[1]).toBe(`fill(${WATER_FILL})`);
    expect(fills).toContain(`fill(${LANDMARK_FILL.church})`);
    expect(
      ctx.calls.some((call) => call.startsWith(`stroke(${ROAD_FILL}`)),
    ).toBe(true);
    expect(ctx.calls).toContain("fillText(Grebbeweg,0,0)");
    expect(ctx.calls).toContain("fillText(Cunerakerk,0,0)");
    expect(
      ctx.calls
        .filter((call) => call.startsWith("translate("))
        .some((call) => call === "translate(100,64)"),
    ).toBe(true);
    expect(
      ctx.calls.some((call) => call.startsWith(`fill(${GROUND_FILL.forest})`)),
    ).toBe(false);
  });

  it("sets the world transform for the chunk", () => {
    const ctx = createFakeContext();
    paintChunk(
      ctx,
      { minX: 128, minY: 256, maxX: 256, maxY: 384 },
      4,
      [],
      landmarks,
    );
    expect(ctx.calls[0]).toBe("setTransform(4,0,0,4,-512,-1024)");
  });
});
```

```ts
// src/lib/cityArena/render/staticRaster.test.ts
import { describe, expect, it } from "vitest";
import type { CanvasFactory } from "./canvasTypes";
import type { LandmarkLookup } from "./drawStatic";
import {
  CHUNK_METRES,
  chunkKey,
  chunkRect,
  chunksCovering,
  createStaticRaster,
} from "./staticRaster";
import { createFakeTarget } from "./testing/fakeContext";

const factory: CanvasFactory = (width, height) =>
  createFakeTarget(width, height);
const landmarks: LandmarkLookup = new Map();

describe("chunk geometry", () => {
  it("keys and rects chunks by zoom and coordinate", () => {
    expect(chunkKey({ zoom: 6, cx: -1, cy: 2 })).toBe("6:-1:2");
    expect(chunkRect({ zoom: 6, cx: -1, cy: 2 })).toEqual({
      minX: -128,
      minY: 256,
      maxX: 0,
      maxY: 384,
    });
  });

  it("lists covering chunks nearest to the centre first", () => {
    const coords = chunksCovering(
      { minX: 10, minY: 10, maxX: 300, maxY: 140 },
      4,
    );
    expect(coords).toHaveLength(6);
    expect(coords[0]).toEqual({ zoom: 4, cx: 1, cy: 0 });
    expect(coords.map((coord) => `${coord.cx}:${coord.cy}`)).toContain("2:1");
  });
});

describe("createStaticRaster", () => {
  it("rasterises a chunk once, sizes it by zoom and tracks bytes", () => {
    const raster = createStaticRaster(factory);
    const chunk = raster.ensureChunk({ zoom: 8, cx: 0, cy: 0 }, [], landmarks);
    expect(chunk?.target.width).toBe(CHUNK_METRES * 8);
    expect(chunk?.bytes).toBe(1024 * 1024 * 4);
    expect(raster.ensureChunk({ zoom: 8, cx: 0, cy: 0 }, [], landmarks)).toBe(
      chunk,
    );
    expect(raster.stats()).toEqual({ chunks: 1, bytes: 4194304 });
  });

  it("evicts the least recently used chunks beyond the byte budget", () => {
    const raster = createStaticRaster(factory, 2 * 512 * 512 * 4);
    raster.ensureChunk({ zoom: 4, cx: 0, cy: 0 }, [], landmarks);
    raster.ensureChunk({ zoom: 4, cx: 1, cy: 0 }, [], landmarks);
    raster.getChunk({ zoom: 4, cx: 0, cy: 0 });
    raster.ensureChunk({ zoom: 4, cx: 2, cy: 0 }, [], landmarks);
    expect(raster.getChunk({ zoom: 4, cx: 1, cy: 0 })).toBeUndefined();
    expect(raster.getChunk({ zoom: 4, cx: 0, cy: 0 })).toBeDefined();
    expect(raster.stats().chunks).toBe(2);
  });

  it("rasterises at most one needed chunk per call and drops chunks touching an invalidated rect", () => {
    const raster = createStaticRaster(factory);
    const needed = chunksCovering({ minX: 0, minY: 0, maxX: 200, maxY: 10 }, 4);
    expect(raster.rasterizeNext(needed, [], landmarks)).toBe(true);
    expect(raster.stats().chunks).toBe(1);
    expect(raster.rasterizeNext(needed, [], landmarks)).toBe(true);
    expect(raster.rasterizeNext(needed, [], landmarks)).toBe(false);
    raster.invalidateRect({ minX: 100, minY: 0, maxX: 300, maxY: 10 });
    expect(raster.stats().chunks).toBe(0);
  });

  it("returns null without crashing when the factory cannot create a context", () => {
    const raster = createStaticRaster(() => null);
    expect(
      raster.ensureChunk({ zoom: 4, cx: 0, cy: 0 }, [], landmarks),
    ).toBeNull();
    expect(
      raster.rasterizeNext([{ zoom: 4, cx: 0, cy: 0 }], [], landmarks),
    ).toBe(false);
  });

  it("disposes everything", () => {
    const raster = createStaticRaster(factory);
    raster.ensureChunk({ zoom: 4, cx: 0, cy: 0 }, [], landmarks);
    raster.dispose();
    expect(raster.stats()).toEqual({ chunks: 0, bytes: 0 });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/render/drawStatic.test.ts src/lib/cityArena/render/staticRaster.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement canvasTypes.ts**

```ts
// src/lib/cityArena/render/canvasTypes.ts
/** The subset of `CanvasRenderingContext2D` the renderer uses; tests inject recording fakes. */
export type RasterContext = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "translate"
  | "scale"
  | "rotate"
  | "setTransform"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "rect"
  | "clip"
  | "fill"
  | "stroke"
  | "fillRect"
  | "clearRect"
  | "fillText"
  | "strokeText"
  | "drawImage"
  | "arc"
  | "setLineDash"
> & {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
};

/** A drawable surface plus its context. */
export type RasterTarget = {
  canvas: CanvasImageSource;
  ctx: RasterContext;
  width: number;
  height: number;
};

/** Creates raster targets; returns `null` where 2D contexts are unavailable (jsdom, old browsers). */
export type CanvasFactory = (
  widthPx: number,
  heightPx: number,
) => RasterTarget | null;

/** Factory backed by `OffscreenCanvas` when available, else a detached `<canvas>`. */
export function createDomCanvasFactory(): CanvasFactory {
  return (widthPx, heightPx) => {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(widthPx, heightPx);
      const ctx = canvas.getContext("2d");
      return ctx ? { canvas, ctx, width: widthPx, height: heightPx } : null;
    }
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext("2d");
    return ctx ? { canvas, ctx, width: widthPx, height: heightPx } : null;
  };
}
```

- [ ] **Step 5: Implement drawStatic.ts**

```ts
// src/lib/cityArena/render/drawStatic.ts
import {
  polygonCentroid,
  rectsIntersect,
  type Rect,
} from "../mapBuild/geometry";
import type { DecodedRoad, DecodedTile } from "../world/decode";
import type { LandmarkStyle } from "../world/mapTypes";
import type { Point } from "../world/projection";
import type { RasterContext } from "./canvasTypes";
import {
  BUILDING_STROKE,
  CENTRE_LINE_CLASSES,
  GROUND_FILL,
  LABEL_FILL,
  LABEL_HALO,
  LANDMARK_FILL,
  LANDMARK_LABEL_PX,
  PAVEMENT_CLASSES,
  PAVEMENT_FILL,
  PAVEMENT_WIDTH_M,
  ROAD_CENTRE_LINE,
  ROAD_FILL,
  ROAD_WIDTH_M,
  STREET_LABEL_PX,
  WATER_FILL,
  buildingFill,
} from "./palette";
import { planStreetLabels } from "./streetLabels";

/** Display name and style of a landmark, keyed by landmark key (built from `index.landmarks`). */
export type LandmarkInfo = { name: string; style: LandmarkStyle };
/** Landmark lookup passed to the painter. */
export type LandmarkLookup = Map<string, LandmarkInfo>;

function tracePath(ctx: RasterContext, points: Point[], close: boolean): void {
  ctx.beginPath();
  points.forEach(([x, y], index) =>
    index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y),
  );
  if (close) ctx.closePath();
}

function fillRing(ctx: RasterContext, ring: Point[], fill: string): void {
  tracePath(ctx, ring, true);
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokePolyline(
  ctx: RasterContext,
  points: Point[],
  colour: string,
  widthMetres: number,
  dash: number[] = [],
): void {
  tracePath(ctx, points, false);
  ctx.strokeStyle = colour;
  ctx.lineWidth = widthMetres;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(dash);
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintTerrain(
  ctx: RasterContext,
  tile: DecodedTile,
  chunkRect: Rect,
): void {
  for (const area of tile.ground)
    if (rectsIntersect(area.bounds, chunkRect))
      fillRing(ctx, area.ring, GROUND_FILL[area.kind]);
  for (const area of tile.water)
    if (rectsIntersect(area.bounds, chunkRect))
      fillRing(ctx, area.ring, WATER_FILL);
}

function paintRoads(ctx: RasterContext, roads: DecodedRoad[]): void {
  for (const road of roads) {
    if (PAVEMENT_CLASSES.includes(road.roadClass))
      strokePolyline(
        ctx,
        road.points,
        PAVEMENT_FILL,
        ROAD_WIDTH_M[road.roadClass] + 2 * PAVEMENT_WIDTH_M,
      );
  }
  for (const road of roads)
    strokePolyline(ctx, road.points, ROAD_FILL, ROAD_WIDTH_M[road.roadClass]);
  for (const road of roads) {
    if (CENTRE_LINE_CLASSES.includes(road.roadClass))
      strokePolyline(ctx, road.points, ROAD_CENTRE_LINE, 0.3, [3, 3]);
  }
}

function paintBuildings(
  ctx: RasterContext,
  tile: DecodedTile,
  chunkRect: Rect,
  landmarks: LandmarkLookup,
): void {
  for (const building of tile.buildings) {
    if (!rectsIntersect(building.bounds, chunkRect)) continue;
    const style = building.landmark
      ? landmarks.get(building.landmark)?.style
      : undefined;
    fillRing(
      ctx,
      building.ring,
      style ? LANDMARK_FILL[style] : buildingFill(building.levels),
    );
    ctx.strokeStyle = BUILDING_STROKE;
    ctx.lineWidth = 0.3;
    ctx.setLineDash([]);
    ctx.stroke();
  }
}

function paintText(
  ctx: RasterContext,
  text: string,
  x: number,
  y: number,
  angle: number,
  sizePx: number,
  zoom: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = `${sizePx / zoom}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.strokeStyle = LABEL_HALO;
  ctx.lineWidth = 3 / zoom;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = LABEL_FILL;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function insideRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.minX && x < rect.maxX && y >= rect.minY && y < rect.maxY;
}

function paintLabels(
  ctx: RasterContext,
  tile: DecodedTile,
  chunkRect: Rect,
  zoom: number,
  landmarks: LandmarkLookup,
): void {
  for (const road of tile.roads) {
    for (const label of planStreetLabels(road, tile.rect)) {
      if (insideRect(label.x, label.y, chunkRect))
        paintText(
          ctx,
          label.text,
          label.x,
          label.y,
          label.angle,
          STREET_LABEL_PX,
          zoom,
        );
    }
  }
  for (const building of tile.buildings) {
    const info = building.landmark
      ? landmarks.get(building.landmark)
      : undefined;
    if (!info || !rectsIntersect(building.bounds, chunkRect)) continue;
    const [x, y] = polygonCentroid(building.ring);
    if (insideRect(x, y, tile.rect) && insideRect(x, y, chunkRect))
      paintText(ctx, info.name, x, y, 0, LANDMARK_LABEL_PX, zoom);
  }
}

/** Paints everything static inside `chunkRect` at `zoom` px/m into a context that maps metres to pixels. */
export function paintChunk(
  ctx: RasterContext,
  chunkRect: Rect,
  zoom: number,
  tiles: DecodedTile[],
  landmarks: LandmarkLookup,
): void {
  ctx.setTransform(
    zoom,
    0,
    0,
    zoom,
    -chunkRect.minX * zoom,
    -chunkRect.minY * zoom,
  );
  ctx.fillStyle = GROUND_FILL.urban;
  ctx.fillRect(
    chunkRect.minX,
    chunkRect.minY,
    chunkRect.maxX - chunkRect.minX,
    chunkRect.maxY - chunkRect.minY,
  );
  const overlapMargin = 20;
  const touching = tiles.filter((tile) =>
    rectsIntersect(
      {
        minX: tile.rect.minX - overlapMargin,
        minY: tile.rect.minY - overlapMargin,
        maxX: tile.rect.maxX + overlapMargin,
        maxY: tile.rect.maxY + overlapMargin,
      },
      chunkRect,
    ),
  );
  for (const tile of touching) paintTerrain(ctx, tile, chunkRect);
  for (const tile of touching)
    paintRoads(
      ctx,
      tile.roads.filter((road) => rectsIntersect(road.bounds, chunkRect)),
    );
  for (const tile of touching) paintBuildings(ctx, tile, chunkRect, landmarks);
  for (const tile of touching)
    paintLabels(ctx, tile, chunkRect, zoom, landmarks);
}
```

- [ ] **Step 6: Implement staticRaster.ts**

```ts
// src/lib/cityArena/render/staticRaster.ts
import { rectsIntersect, type Rect } from "../mapBuild/geometry";
import type { DecodedTile } from "../world/decode";
import { createLru } from "../world/lru";
import type { ZoomLevel } from "./camera";
import type { CanvasFactory, RasterTarget } from "./canvasTypes";
import { paintChunk, type LandmarkLookup } from "./drawStatic";

/** Chunk edge length in metres. */
export const CHUNK_METRES = 128;
/** Total canvas memory the chunk cache may hold. */
export const RASTER_BUDGET_BYTES = 40 * 1024 * 1024;

/** A chunk address. */
export type ChunkCoord = { zoom: ZoomLevel; cx: number; cy: number };
/** A rasterised chunk. */
export type Chunk = {
  key: string;
  coord: ChunkCoord;
  rect: Rect;
  target: RasterTarget;
  bytes: number;
};

/** Cache of rasterised chunks with a byte budget. */
export type StaticRaster = {
  getChunk(coord: ChunkCoord): Chunk | undefined;
  ensureChunk(
    coord: ChunkCoord,
    tiles: DecodedTile[],
    landmarks: LandmarkLookup,
  ): Chunk | null;
  rasterizeNext(
    needed: ChunkCoord[],
    tiles: DecodedTile[],
    landmarks: LandmarkLookup,
  ): boolean;
  invalidateRect(rect: Rect): void;
  stats(): { chunks: number; bytes: number };
  dispose(): void;
};

/** Cache key of a chunk. */
export function chunkKey(coord: ChunkCoord): string {
  return `${coord.zoom}:${coord.cx}:${coord.cy}`;
}

/** World rectangle of a chunk. */
export function chunkRect(coord: ChunkCoord): Rect {
  return {
    minX: coord.cx * CHUNK_METRES,
    minY: coord.cy * CHUNK_METRES,
    maxX: (coord.cx + 1) * CHUNK_METRES,
    maxY: (coord.cy + 1) * CHUNK_METRES,
  };
}

/** Chunks intersecting a world rectangle, nearest to its centre first. */
export function chunksCovering(rect: Rect, zoom: ZoomLevel): ChunkCoord[] {
  const coords: ChunkCoord[] = [];
  for (
    let cy = Math.floor(rect.minY / CHUNK_METRES);
    cy <= Math.floor(rect.maxY / CHUNK_METRES);
    cy++
  ) {
    for (
      let cx = Math.floor(rect.minX / CHUNK_METRES);
      cx <= Math.floor(rect.maxX / CHUNK_METRES);
      cx++
    )
      coords.push({ zoom, cx, cy });
  }
  const centreX = (rect.minX + rect.maxX) / 2;
  const centreY = (rect.minY + rect.maxY) / 2;
  const distance = (coord: ChunkCoord): number =>
    Math.hypot(
      (coord.cx + 0.5) * CHUNK_METRES - centreX,
      (coord.cy + 0.5) * CHUNK_METRES - centreY,
    );
  return coords.sort((left, right) => distance(left) - distance(right));
}

/** Creates the cache; chunks are painted with {@link paintChunk} on demand. */
export function createStaticRaster(
  factory: CanvasFactory,
  budgetBytes = RASTER_BUDGET_BYTES,
): StaticRaster {
  const chunks = createLru<string, Chunk>({
    maxCost: budgetBytes,
    costOf: (chunk) => chunk.bytes,
  });
  const ensureChunk = (
    coord: ChunkCoord,
    tiles: DecodedTile[],
    landmarks: LandmarkLookup,
  ): Chunk | null => {
    const existing = chunks.get(chunkKey(coord));
    if (existing) return existing;
    const sizePx = CHUNK_METRES * coord.zoom;
    const target = factory(sizePx, sizePx);
    if (!target) return null;
    const rect = chunkRect(coord);
    paintChunk(target.ctx, rect, coord.zoom, tiles, landmarks);
    const chunk: Chunk = {
      key: chunkKey(coord),
      coord,
      rect,
      target,
      bytes: sizePx * sizePx * 4,
    };
    chunks.set(chunk.key, chunk);
    return chunk;
  };
  return {
    getChunk: (coord) => chunks.get(chunkKey(coord)),
    ensureChunk,
    rasterizeNext(needed, tiles, landmarks) {
      const missing = needed.find((coord) => !chunks.has(chunkKey(coord)));
      if (!missing) return false;
      return ensureChunk(missing, tiles, landmarks) !== null;
    },
    invalidateRect(rect) {
      for (const key of chunks.keys()) {
        const chunk = chunks.peek(key);
        if (chunk && rectsIntersect(chunk.rect, rect)) chunks.delete(key);
      }
    },
    stats: () => ({ chunks: chunks.size, bytes: chunks.cost }),
    dispose() {
      for (const key of chunks.keys()) chunks.delete(key);
    },
  };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/render/drawStatic.test.ts src/lib/cityArena/render/staticRaster.test.ts`
Expected: PASS (2 + 7 tests). Labels are drawn after `translate(x, y)`, so the recorded `fillText` is at `(0, 0)` and the anchor shows up as `translate(100,64)`. In the eviction test the budget holds exactly two 512² chunks; touching chunk 0 before inserting chunk 2 makes chunk 1 the eviction victim.

- [ ] **Step 8: Commit**

```bash
npx prettier --write src/lib/cityArena/render
git add src/lib/cityArena/render
git commit -m "feat(arena): paint map chunks into a byte-budgeted raster cache

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Scene drawing (chunk blit, hatch, player, zone ring) and frame metrics

**Files:**

- Create: `src/lib/cityArena/render/drawWorld.ts`
- Create: `src/lib/cityArena/render/drawEntities.ts`
- Create: `src/lib/cityArena/render/renderScene.ts`
- Create: `src/lib/cityArena/debugMetrics.ts`
- Test: `src/lib/cityArena/render/drawWorld.test.ts`, `src/lib/cityArena/render/drawEntities.test.ts`, `src/lib/cityArena/render/renderScene.test.ts`, `src/lib/cityArena/debugMetrics.test.ts`

**Interfaces:**

- Consumes: `Camera`, `Viewport`, `visibleRect`, `worldToScreen` (Task 8); `StaticRaster`, `chunksCovering`, `CHUNK_METRES` (Task 9); `LandmarkLookup` (Task 9); `RasterContext` (Task 9); palette; `DecodedTile` (Task 1); `PlayerState` (Task 6); `MapZone` (`../world/mapTypes`); `zoneCentreMetres`, `zoneRadiusMetres` (Task 5); `rectsIntersect`, `Rect`; `PLAYER_RADIUS_M` (Task 6).
- Produces: `WorldDrawSource = { raster: StaticRaster; tiles: DecodedTile[]; landmarks: LandmarkLookup; loadedTileRects: Rect[] }`, `DrawStats = { missing: number; rasterised: boolean }`, `drawVisibleChunks(ctx, camera, viewport, source): DrawStats`; `drawPlayer(ctx, camera, viewport, player: PlayerState): void`, `drawZoneRing(ctx, camera, viewport, zone: MapZone): void`; `SceneViewport = { rect: { x: number; y: number; width: number; height: number }; camera: Camera }`, `Scene = { world: WorldDrawSource; player: PlayerState; zone: MapZone | null }`, `renderScene(ctx, viewport: SceneViewport, scene: Scene): DrawStats`; `FrameSample = { frameMs: number; drawMs: number; simMs: number }`, `MetricsSnapshot = { fps: number; frameP95Ms: number; drawP95Ms: number; simP95Ms: number; samples: number }`, `FrameMetrics = { record(sample: FrameSample): void; snapshot(): MetricsSnapshot }`, `createFrameMetrics(capacity?: number): FrameMetrics`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/render/drawWorld.test.ts
import { describe, expect, it } from "vitest";
import { createCamera } from "./camera";
import type { LandmarkLookup } from "./drawStatic";
import { drawVisibleChunks } from "./drawWorld";
import { HATCH_BACKGROUND, PLACEHOLDER_FILL } from "./palette";
import { createStaticRaster } from "./staticRaster";
import { createFakeContext, createFakeTarget } from "./testing/fakeContext";

const landmarks: LandmarkLookup = new Map();
const viewport = { width: 256, height: 128 };

describe("drawVisibleChunks", () => {
  it("rasterises one chunk per call, blits ready chunks and draws placeholders for the rest", () => {
    const raster = createStaticRaster((width, height) =>
      createFakeTarget(width, height),
    );
    const source = {
      raster,
      tiles: [],
      landmarks,
      loadedTileRects: [{ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }],
    };
    const camera = createCamera([0, 0], 4);
    const ctx = createFakeContext();
    const first = drawVisibleChunks(ctx, camera, viewport, source);
    expect(first.rasterised).toBe(true);
    expect(
      ctx.calls.filter((call) => call.startsWith("drawImage(")).length,
    ).toBe(1);
    expect(
      ctx.calls.filter((call) => call === `fill(${PLACEHOLDER_FILL})`).length,
    ).toBeGreaterThan(0);
    for (let step = 0; step < 4; step++)
      drawVisibleChunks(createFakeContext(), camera, viewport, source);
    const later = createFakeContext();
    const stats = drawVisibleChunks(later, camera, viewport, source);
    expect(stats).toEqual({ missing: 0, rasterised: false });
    expect(
      later.calls.filter((call) => call.startsWith("drawImage(")).length,
    ).toBe(4);
  });

  it("hatches areas where no tile is loaded", () => {
    const raster = createStaticRaster(() => null);
    const source = { raster, tiles: [], landmarks, loadedTileRects: [] };
    const ctx = createFakeContext();
    const stats = drawVisibleChunks(
      ctx,
      createCamera([0, 0], 4),
      viewport,
      source,
    );
    expect(stats.missing).toBe(4);
    expect(ctx.calls).toContain(`fill(${HATCH_BACKGROUND})`);
  });
});
```

```ts
// src/lib/cityArena/render/drawEntities.test.ts
import { describe, expect, it } from "vitest";
import type { MapZone } from "../world/mapTypes";
import { createCamera } from "./camera";
import { drawPlayer, drawZoneRing } from "./drawEntities";
import { PLAYER_FILL, ZONE_RING } from "./palette";
import { createFakeContext } from "./testing/fakeContext";

describe("drawEntities", () => {
  it("draws the player as a ringed circle at its screen position with a facing tick", () => {
    const ctx = createFakeContext();
    drawPlayer(
      ctx,
      createCamera([10, 10], 8),
      { width: 200, height: 100 },
      { x: 12, y: 10, facing: 0, speed: 4 },
    );
    expect(ctx.calls).toContain("arc(116,50,6,0,6.28,false)");
    expect(ctx.calls).toContain(`fill(${PLAYER_FILL})`);
    expect(ctx.calls).toContain("lineTo(126,50)");
  });

  it("draws a dashed zone ring", () => {
    const zone: MapZone = {
      key: "campus",
      name: "WUR-campus",
      center: [0, 0],
      radius: 2000,
      spawnNodes: [],
      landmarks: [],
    };
    const ctx = createFakeContext();
    drawZoneRing(
      ctx,
      createCamera([0, 0], 4),
      { width: 200, height: 100 },
      zone,
    );
    expect(ctx.calls).toContain("arc(100,50,2000,0,6.28,false)");
    expect(ctx.calls).toContain(`stroke(${ZONE_RING},2)`);
    expect(ctx.calls).toContain("setLineDash(8,6)");
  });
});
```

```ts
// src/lib/cityArena/render/renderScene.test.ts
import { describe, expect, it } from "vitest";
import { createCamera } from "./camera";
import type { LandmarkLookup } from "./drawStatic";
import { renderScene } from "./renderScene";
import { createStaticRaster } from "./staticRaster";
import { createFakeContext } from "./testing/fakeContext";

describe("renderScene", () => {
  it("clips to the viewport rect, draws the world and the player, and restores", () => {
    const landmarks: LandmarkLookup = new Map();
    const raster = createStaticRaster(() => null);
    const ctx = createFakeContext();
    const stats = renderScene(
      ctx,
      {
        rect: { x: 10, y: 20, width: 100, height: 50 },
        camera: createCamera([0, 0], 4),
      },
      {
        world: { raster, tiles: [], landmarks, loadedTileRects: [] },
        player: { x: 0, y: 0, facing: 0, speed: 0 },
        zone: null,
      },
    );
    expect(ctx.calls[0]).toBe("save()");
    expect(ctx.calls).toContain("rect(10,20,100,50)");
    expect(ctx.calls).toContain("clip()");
    expect(ctx.calls).toContain("translate(10,20)");
    expect(ctx.calls.some((call) => call.startsWith("arc(50,25,"))).toBe(true);
    expect(ctx.calls[ctx.calls.length - 1]).toBe("restore()");
    expect(stats.missing).toBeGreaterThan(0);
  });
});
```

```ts
// src/lib/cityArena/debugMetrics.test.ts
import { describe, expect, it } from "vitest";
import { createFrameMetrics } from "./debugMetrics";

describe("createFrameMetrics", () => {
  it("reports fps from the median frame time and p95 timings", () => {
    const metrics = createFrameMetrics(10);
    for (let index = 0; index < 20; index++)
      metrics.record({
        frameMs: index === 19 ? 100 : 16.67,
        drawMs: index === 19 ? 30 : 4,
        simMs: 1,
      });
    const snapshot = metrics.snapshot();
    expect(snapshot.samples).toBe(10);
    expect(snapshot.fps).toBe(60);
    expect(snapshot.frameP95Ms).toBe(100);
    expect(snapshot.drawP95Ms).toBe(30);
    expect(snapshot.simP95Ms).toBe(1);
  });

  it("is empty before any sample", () => {
    expect(createFrameMetrics().snapshot()).toEqual({
      fps: 0,
      frameP95Ms: 0,
      drawP95Ms: 0,
      simP95Ms: 0,
      samples: 0,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/render/drawWorld.test.ts src/lib/cityArena/render/drawEntities.test.ts src/lib/cityArena/render/renderScene.test.ts src/lib/cityArena/debugMetrics.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement drawWorld.ts**

```ts
// src/lib/cityArena/render/drawWorld.ts
import { rectsIntersect, type Rect } from "../mapBuild/geometry";
import type { DecodedTile } from "../world/decode";
import {
  visibleRect,
  worldToScreen,
  type Camera,
  type Viewport,
} from "./camera";
import type { RasterContext } from "./canvasTypes";
import type { LandmarkLookup } from "./drawStatic";
import { HATCH_BACKGROUND, HATCH_LINE, PLACEHOLDER_FILL } from "./palette";
import {
  CHUNK_METRES,
  chunksCovering,
  type ChunkCoord,
  type StaticRaster,
} from "./staticRaster";

/** Everything the world painter reads. */
export type WorldDrawSource = {
  raster: StaticRaster;
  tiles: DecodedTile[];
  landmarks: LandmarkLookup;
  loadedTileRects: Rect[];
};
/** Outcome of one world draw. */
export type DrawStats = { missing: number; rasterised: boolean };

const HATCH_SPACING_PX = 16;

function fillChunkArea(
  ctx: RasterContext,
  x: number,
  y: number,
  size: number,
  fill: string,
): void {
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.fillStyle = fill;
  ctx.fill();
}

function hatchChunkArea(
  ctx: RasterContext,
  x: number,
  y: number,
  size: number,
): void {
  fillChunkArea(ctx, x, y, size, HATCH_BACKGROUND);
  ctx.beginPath();
  for (let offset = -size; offset < size; offset += HATCH_SPACING_PX) {
    ctx.moveTo(x + offset, y + size);
    ctx.lineTo(x + offset + size, y);
  }
  ctx.strokeStyle = HATCH_LINE;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.stroke();
}

function chunkHasTile(coord: ChunkCoord, loadedTileRects: Rect[]): boolean {
  const rect: Rect = {
    minX: coord.cx * CHUNK_METRES,
    minY: coord.cy * CHUNK_METRES,
    maxX: (coord.cx + 1) * CHUNK_METRES,
    maxY: (coord.cy + 1) * CHUNK_METRES,
  };
  return loadedTileRects.some((tileRect) => rectsIntersect(tileRect, rect));
}

/** Blits the chunks covering the view (rasterising at most one), hatching areas without tiles. */
export function drawVisibleChunks(
  ctx: RasterContext,
  camera: Camera,
  viewport: Viewport,
  source: WorldDrawSource,
): DrawStats {
  const needed = chunksCovering(visibleRect(camera, viewport), camera.zoom);
  const rasterised = source.raster.rasterizeNext(
    needed,
    source.tiles,
    source.landmarks,
  );
  const sizePx = CHUNK_METRES * camera.zoom;
  let missing = 0;
  for (const coord of needed) {
    const [x, y] = worldToScreen(camera, viewport, [
      coord.cx * CHUNK_METRES,
      coord.cy * CHUNK_METRES,
    ]);
    const chunk = source.raster.getChunk(coord);
    if (chunk) {
      ctx.drawImage(chunk.target.canvas, x, y, sizePx, sizePx);
      continue;
    }
    missing += 1;
    if (chunkHasTile(coord, source.loadedTileRects))
      fillChunkArea(ctx, x, y, sizePx, PLACEHOLDER_FILL);
    else hatchChunkArea(ctx, x, y, sizePx);
  }
  return { missing, rasterised };
}
```

- [ ] **Step 4: Implement drawEntities.ts**

```ts
// src/lib/cityArena/render/drawEntities.ts
import { PLAYER_RADIUS_M } from "../sim/player";
import type { PlayerState } from "../sim/types";
import type { MapZone } from "../world/mapTypes";
import { zoneCentreMetres, zoneRadiusMetres } from "../world/zone";
import { worldToScreen, type Camera, type Viewport } from "./camera";
import type { RasterContext } from "./canvasTypes";
import { PLAYER_FILL, PLAYER_RING, ZONE_RING } from "./palette";

const MIN_PLAYER_RADIUS_PX = 6;
const FACING_TICK_PX = 4;

/** Draws the local player: a filled circle, a coloured ring and a facing tick. */
export function drawPlayer(
  ctx: RasterContext,
  camera: Camera,
  viewport: Viewport,
  player: PlayerState,
): void {
  const [x, y] = worldToScreen(camera, viewport, [player.x, player.y]);
  const radius = Math.max(MIN_PLAYER_RADIUS_PX, PLAYER_RADIUS_M * camera.zoom);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2, false);
  ctx.fillStyle = PLAYER_FILL;
  ctx.fill();
  ctx.strokeStyle = PLAYER_RING;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(
    x + Math.cos(player.facing) * (radius + FACING_TICK_PX),
    y + Math.sin(player.facing) * (radius + FACING_TICK_PX),
  );
  ctx.stroke();
}

/** Draws the dashed 500 m boundary of a zone. */
export function drawZoneRing(
  ctx: RasterContext,
  camera: Camera,
  viewport: Viewport,
  zone: MapZone,
): void {
  const [x, y] = worldToScreen(camera, viewport, zoneCentreMetres(zone));
  ctx.beginPath();
  ctx.arc(x, y, zoneRadiusMetres(zone) * camera.zoom, 0, Math.PI * 2, false);
  ctx.strokeStyle = ZONE_RING;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
}
```

- [ ] **Step 5: Implement renderScene.ts and debugMetrics.ts**

```ts
// src/lib/cityArena/render/renderScene.ts
import type { PlayerState } from "../sim/types";
import type { MapZone } from "../world/mapTypes";
import type { Camera } from "./camera";
import type { RasterContext } from "./canvasTypes";
import { drawPlayer, drawZoneRing } from "./drawEntities";
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
/** What to draw. */
export type Scene = {
  world: WorldDrawSource;
  player: PlayerState;
  zone: MapZone | null;
};

/** Renders one viewport: clip, world chunks, zone ring, player. */
export function renderScene(
  ctx: RasterContext,
  viewport: SceneViewport,
  scene: Scene,
): DrawStats {
  const { rect, camera } = viewport;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.translate(rect.x, rect.y);
  const size = { width: rect.width, height: rect.height };
  const stats = drawVisibleChunks(ctx, camera, size, scene.world);
  if (scene.zone) drawZoneRing(ctx, camera, size, scene.zone);
  drawPlayer(ctx, camera, size, scene.player);
  ctx.restore();
  return stats;
}
```

```ts
// src/lib/cityArena/debugMetrics.ts
/** One frame's timings in milliseconds. */
export type FrameSample = { frameMs: number; drawMs: number; simMs: number };
/** Aggregated timings over the ring buffer. */
export type MetricsSnapshot = {
  fps: number;
  frameP95Ms: number;
  drawP95Ms: number;
  simP95Ms: number;
  samples: number;
};
/** Ring buffer of frame samples. */
export type FrameMetrics = {
  record(sample: FrameSample): void;
  snapshot(): MetricsSnapshot;
};

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))
  ];
}

/** Creates a metrics buffer holding the last `capacity` frames (default 120 ≈ 2 s at 60 fps). */
export function createFrameMetrics(capacity = 120): FrameMetrics {
  const samples: FrameSample[] = [];
  return {
    record(sample) {
      samples.push(sample);
      if (samples.length > capacity) samples.shift();
    },
    snapshot() {
      const frames = samples.map((sample) => sample.frameMs);
      const medianFrame = percentile(frames, 0.5);
      return {
        fps: medianFrame > 0 ? Math.round(1000 / medianFrame) : 0,
        frameP95Ms: percentile(frames, 0.95),
        drawP95Ms: percentile(
          samples.map((sample) => sample.drawMs),
          0.95,
        ),
        simP95Ms: percentile(
          samples.map((sample) => sample.simMs),
          0.95,
        ),
        samples: samples.length,
      };
    },
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/render/drawWorld.test.ts src/lib/cityArena/render/drawEntities.test.ts src/lib/cityArena/render/renderScene.test.ts src/lib/cityArena/debugMetrics.test.ts`
Expected: PASS (2 + 2 + 1 + 2 tests). In the player test the camera is at (10, 10) with zoom 8: the player at (12, 10) lands at screen (100 + 16, 50) = (116, 50) with radius `max(6, 3.2) = 6` and a tick ending at x = 116 + 10.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/cityArena
git add src/lib/cityArena/render src/lib/cityArena/debugMetrics.ts src/lib/cityArena/debugMetrics.test.ts
git commit -m "feat(arena): render the scene with chunk blits, hatching and the player

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: World session — loader, collision grid and raster kept in sync

**Files:**

- Create: `src/lib/cityArena/world/worldSession.ts`
- Test: `src/lib/cityArena/world/worldSession.test.ts`

**Interfaces:**

- Consumes: `MapLoader`, `LoadProgress` (Task 2); `createCollisionGrid`, `CollisionGrid` (Task 3); `decodeRoadGraph`, `RoadGraph` (Task 4); `createStaticRaster`, `StaticRaster` (Task 9); `CanvasFactory` (Task 9); `LandmarkLookup` (Task 9); `DecodedTile` (Task 1); `MapIndex`; `Rect`; `Point`.
- Produces: `WorldSessionOptions = { loader: MapLoader; canvasFactory: CanvasFactory }`, `WorldReady = { index: MapIndex; graph: RoadGraph }`, `WorldSession = { ready(): Promise<WorldReady>; index(): MapIndex; graph(): RoadGraph; collision: CollisionGrid; raster: StaticRaster; landmarks(): LandmarkLookup; update(centre: Point): Promise<LoadProgress>; tiles(): DecodedTile[]; loadedTileRects(): Rect[]; hasFailures(): boolean; dispose(): void }`, `createWorldSession(options): WorldSession`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/cityArena/world/worldSession.test.ts
import { describe, expect, it, vi } from "vitest";
import { createFakeTarget } from "../render/testing/fakeContext";
import { createMapLoader } from "./mapLoader";
import type { MapIndex, MapTile } from "./mapTypes";
import { createWorldSession } from "./worldSession";

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -8000, minY: -8000, maxX: 24000, maxY: 24000 },
  tileSize: 8000,
  tiles: [],
  zones: [],
  landmarks: [
    {
      key: "cunerakerk",
      name: "Cunerakerk",
      style: "church",
      center: [0, 0],
      tile: { x: 1, y: 1 },
    },
  ],
};
for (let y = 0; y < 4; y++)
  for (let x = 0; x < 4; x++)
    index.tiles.push({ x, y, file: `tile_${x}_${y}.json`, bytes: 1 });

function tile(x: number, y: number): MapTile {
  const building =
    x === 1 && y === 1
      ? [{ points: [40, 40, 80, 40, 80, 80, 40, 80], levels: 2 }]
      : [];
  return { x, y, roads: [], buildings: building, ground: [], water: [] };
}

const fetchImpl = vi.fn<typeof fetch>(async (input) => {
  const url = String(input);
  const body = url.endsWith("index.json")
    ? index
    : url.endsWith("roads.json")
      ? {
          nodes: [0, 0, 400, 0],
          edges: [0, 1, 0, -1, 0, 400],
          classes: ["residential"],
          names: [],
        }
      : (() => {
          const match = /tile_(\d+)_(\d+)\.json$/.exec(url);
          return match ? tile(Number(match[1]), Number(match[2])) : null;
        })();
  return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
});

describe("createWorldSession", () => {
  it("loads index and roads, syncs tiles into collision and raster, and exposes landmarks", async () => {
    const loader = createMapLoader({
      baseUrl: "/map",
      fetchImpl,
      sleep: async () => {},
    });
    const session = createWorldSession({
      loader,
      canvasFactory: (width, height) => createFakeTarget(width, height),
    });
    const ready = await session.ready();
    expect(ready.index.tiles).toHaveLength(16);
    expect(ready.graph.edges).toHaveLength(1);
    expect(session.landmarks().get("cunerakerk")).toEqual({
      name: "Cunerakerk",
      style: "church",
    });
    const progress = await session.update([0, 0]);
    expect(progress).toEqual({ loaded: 9, total: 9 });
    expect(session.tiles()).toHaveLength(9);
    expect(session.collision.obstacleCount()).toBe(1);
    expect(session.loadedTileRects()).toHaveLength(9);
    const invalidate = vi.spyOn(session.raster, "invalidateRect");
    await session.update([4000, 4000]);
    expect(session.tiles()).toHaveLength(9);
    expect(session.collision.obstacleCount()).toBe(1);
    expect(invalidate).toHaveBeenCalled();
    session.dispose();
    expect(session.tiles()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/cityArena/world/worldSession.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement worldSession.ts**

```ts
// src/lib/cityArena/world/worldSession.ts
import type { Rect } from "../mapBuild/geometry";
import type { CanvasFactory } from "../render/canvasTypes";
import type { LandmarkLookup } from "../render/drawStatic";
import { createStaticRaster, type StaticRaster } from "../render/staticRaster";
import { createCollisionGrid, type CollisionGrid } from "./collisionGrid";
import type { DecodedTile } from "./decode";
import type { LoadProgress, MapLoader } from "./mapLoader";
import type { MapIndex } from "./mapTypes";
import type { Point } from "./projection";
import { decodeRoadGraph, type RoadGraph } from "./roadGraph";

/** Injected dependencies of a world session. */
export type WorldSessionOptions = {
  loader: MapLoader;
  canvasFactory: CanvasFactory;
};
/** Resolved once the index and the road graph are available. */
export type WorldReady = { index: MapIndex; graph: RoadGraph };

/** Keeps the collision grid and the raster cache consistent with the tiles the loader holds. */
export type WorldSession = {
  ready(): Promise<WorldReady>;
  index(): MapIndex;
  graph(): RoadGraph;
  collision: CollisionGrid;
  raster: StaticRaster;
  landmarks(): LandmarkLookup;
  update(centre: Point): Promise<LoadProgress>;
  tiles(): DecodedTile[];
  loadedTileRects(): Rect[];
  hasFailures(): boolean;
  dispose(): void;
};

function tileKey(tile: DecodedTile): string {
  return `${tile.x}:${tile.y}`;
}

/** Creates a session around a loader; call `ready()` before `update()`. */
export function createWorldSession(options: WorldSessionOptions): WorldSession {
  const collision = createCollisionGrid();
  const raster = createStaticRaster(options.canvasFactory);
  const synced = new Map<string, DecodedTile>();
  let readyPromise: Promise<WorldReady> | null = null;
  let loadedIndex: MapIndex | null = null;
  let loadedGraph: RoadGraph | null = null;
  const landmarkLookup: LandmarkLookup = new Map();

  const requireReady = <T>(value: T | null, what: string): T => {
    if (value === null) throw new Error(`World session not ready: ${what}`);
    return value;
  };

  const syncTiles = (): void => {
    const current = new Map(
      options.loader.getLoadedTiles().map((tile) => [tileKey(tile), tile]),
    );
    for (const [key, tile] of synced) {
      if (current.has(key)) continue;
      synced.delete(key);
      collision.removeTile(tile.x, tile.y);
      raster.invalidateRect(tile.rect);
    }
    for (const [key, tile] of current) {
      if (synced.has(key)) continue;
      synced.set(key, tile);
      collision.insertTile(tile);
      raster.invalidateRect(tile.rect);
    }
  };

  return {
    ready() {
      readyPromise ??= Promise.all([
        options.loader.loadIndex(),
        options.loader.loadRoads(),
      ]).then(([index, roads]) => {
        loadedIndex = index;
        loadedGraph = decodeRoadGraph(roads);
        for (const landmark of index.landmarks)
          landmarkLookup.set(landmark.key, {
            name: landmark.name,
            style: landmark.style,
          });
        return { index, graph: loadedGraph };
      });
      return readyPromise;
    },
    index: () => requireReady(loadedIndex, "index"),
    graph: () => requireReady(loadedGraph, "road graph"),
    collision,
    raster,
    landmarks: () => landmarkLookup,
    async update(centre) {
      const progress = await options.loader.ensureTilesAround(centre);
      syncTiles();
      return progress;
    },
    tiles: () => [...synced.values()],
    loadedTileRects: () => [...synced.values()].map((tile) => tile.rect),
    hasFailures: () => options.loader.hasFailures(),
    dispose() {
      for (const tile of synced.values()) collision.removeTile(tile.x, tile.y);
      synced.clear();
      raster.dispose();
      options.loader.dispose();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/cityArena/world/worldSession.test.ts`
Expected: PASS (1 test). After the second `update` the loader evicted the tiles left behind, `syncTiles` removed them from the grid and invalidated their raster rects; tile (1,1) with the building is still resident in both 3 × 3 blocks, so the obstacle count stays 1.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/cityArena/world
git add src/lib/cityArena/world
git commit -m "feat(arena): keep collision and raster in sync with streamed tiles

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Small components — touch stick surface, loading screen, debug overlay, debug flag

**Files:**

- Create: `src/lib/cityArena/debugFlag.ts`
- Create: `src/components/cityArena/TouchStick.tsx`
- Create: `src/components/cityArena/ArenaLoadingScreen.tsx`
- Create: `src/components/cityArena/ArenaDebugOverlay.tsx`
- Test: `src/lib/cityArena/debugFlag.test.ts`, `src/components/cityArena/TouchStick.test.tsx`, `src/components/cityArena/ArenaLoadingScreen.test.tsx`, `src/components/cityArena/ArenaDebugOverlay.test.tsx`

**Interfaces:**

- Consumes: `StickController`, `StickState`, `STICK_RADIUS_PX` (Task 7); `MetricsSnapshot` (Task 10); `Camera` (Task 8); `PlayerState` (Task 6).
- Produces: `isDebugEnabled(search: string, nodeEnv: string | undefined): boolean`; `<TouchStick stick onVector />` (props `{ stick: StickController; onVector: (vector: [number, number] | null) => void }`); `<ArenaLoadingScreen loaded total failed />`; `<ArenaDebugOverlay metrics chunks tiles camera player routeMetres />` (props `{ metrics: MetricsSnapshot; chunks: { chunks: number; bytes: number }; tiles: number; camera: Camera; player: PlayerState; routeMetres: number | null }`); constants `GAME_SPLASH_WEBP = "/branding/splash-game-landscape.webp"`, `GAME_SPLASH_JPG = "/branding/splash-game-landscape.jpg"`, `ATTRIBUTION_TEXT = "Kaart © OpenStreetMap-bijdragers"` exported from `ArenaLoadingScreen.tsx`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/debugFlag.test.ts
import { describe, expect, it } from "vitest";
import { isDebugEnabled } from "./debugFlag";

describe("isDebugEnabled", () => {
  it("is on only with ?debug=1 outside production", () => {
    expect(isDebugEnabled("?debug=1", "development")).toBe(true);
    expect(isDebugEnabled("?foo=1&debug=1", "test")).toBe(true);
    expect(isDebugEnabled("?debug=1", "production")).toBe(false);
    expect(isDebugEnabled("", "development")).toBe(false);
    expect(isDebugEnabled("?debug=0", undefined)).toBe(false);
  });
});
```

```tsx
// src/components/cityArena/TouchStick.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStick } from "@/lib/cityArena/input/touchStick";
import TouchStick from "./TouchStick";

describe("TouchStick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the base and knob where the finger lands and reports vectors until release", () => {
    const onVector = vi.fn();
    render(<TouchStick stick={createStick()} onVector={onVector} />);
    const surface = screen.getByTestId("touch-stick-surface");
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 50, clientY: 60 });
    expect(screen.getByTestId("touch-stick-base").getAttribute("cx")).toBe(
      "50",
    );
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 98, clientY: 60 });
    expect(onVector).toHaveBeenLastCalledWith([1, 0]);
    expect(screen.getByTestId("touch-stick-knob").getAttribute("cx")).toBe(
      "98",
    );
    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(onVector).toHaveBeenLastCalledWith(null);
    expect(screen.queryByTestId("touch-stick-base")).toBeNull();
  });
});
```

```tsx
// src/components/cityArena/ArenaLoadingScreen.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ArenaLoadingScreen, { ATTRIBUTION_TEXT } from "./ArenaLoadingScreen";

describe("ArenaLoadingScreen", () => {
  it("shows progress, the attribution and hides a broken splash image", () => {
    render(<ArenaLoadingScreen loaded={3} total={9} failed={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("Kaart laden… 3/9");
    expect(screen.getByText(ATTRIBUTION_TEXT)).toBeInTheDocument();
    const image = screen.getByTestId("game-splash-image");
    fireEvent.error(image);
    expect(screen.queryByTestId("game-splash-image")).toBeNull();
  });

  it("explains partial failures", () => {
    render(<ArenaLoadingScreen loaded={7} total={9} failed />);
    expect(
      screen.getByText("Kaart kon niet volledig laden"),
    ).toBeInTheDocument();
  });
});
```

```tsx
// src/components/cityArena/ArenaDebugOverlay.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ArenaDebugOverlay from "./ArenaDebugOverlay";

describe("ArenaDebugOverlay", () => {
  it("prints the metrics", () => {
    render(
      <ArenaDebugOverlay
        metrics={{
          fps: 58,
          frameP95Ms: 19.2,
          drawP95Ms: 5.1,
          simP95Ms: 0.4,
          samples: 120,
        }}
        chunks={{ chunks: 6, bytes: 12 * 1024 * 1024 }}
        tiles={9}
        camera={{ x: 2587.3, y: 1670.7, zoom: 6 }}
        player={{ x: 2588, y: 1671, facing: 0, speed: 4 }}
        routeMetres={412}
      />,
    );
    const panel = screen.getByTestId("arena-debug");
    expect(panel).toHaveTextContent("fps 58");
    expect(panel).toHaveTextContent("draw p95 5.1 ms");
    expect(panel).toHaveTextContent("chunks 6 (12.0 MB)");
    expect(panel).toHaveTextContent("tiles 9");
    expect(panel).toHaveTextContent("zoom 6");
    expect(panel).toHaveTextContent("route 412 m");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/debugFlag.test.ts src/components/cityArena`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement debugFlag.ts and TouchStick.tsx**

```ts
// src/lib/cityArena/debugFlag.ts
/** True when `?debug=1` is in the query string and the build is not a production build. */
export function isDebugEnabled(
  search: string,
  nodeEnv: string | undefined,
): boolean {
  if (nodeEnv === "production") return false;
  return new URLSearchParams(search).get("debug") === "1";
}
```

```tsx
// src/components/cityArena/TouchStick.tsx
"use client";

import { useCallback, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  STICK_RADIUS_PX,
  type StickController,
  type StickState,
} from "@/lib/cityArena/input/touchStick";

type Props = {
  stick: StickController;
  onVector: (vector: [number, number] | null) => void;
};

/** Floating joystick surface on the left part of the screen; draws the stick with SVG circles. */
export default function TouchStick({
  stick,
  onVector,
}: Props): React.JSX.Element {
  const [state, setState] = useState<StickState>(stick.state());

  const localPoint = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const [x, y] = localPoint(event);
      stick.begin(event.pointerId, x, y);
      if (typeof event.currentTarget.setPointerCapture === "function")
        event.currentTarget.setPointerCapture(event.pointerId);
      setState(stick.state());
    },
    [stick],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const [x, y] = localPoint(event);
      stick.move(event.pointerId, x, y);
      const next = stick.state();
      setState(next);
      if (next.pointerId === event.pointerId) onVector(next.vector);
    },
    [onVector, stick],
  );

  const onPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const owner = stick.state().pointerId;
      stick.end(event.pointerId);
      setState(stick.state());
      if (owner === event.pointerId) onVector(null);
    },
    [onVector, stick],
  );

  return (
    <div
      data-testid="touch-stick-surface"
      className="absolute inset-y-0 left-0 w-[45%] touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onContextMenu={(event) => event.preventDefault()}
    >
      <svg className="pointer-events-none h-full w-full" aria-hidden="true">
        {state.origin && state.knob ? (
          <>
            <circle
              data-testid="touch-stick-base"
              cx={state.origin[0]}
              cy={state.origin[1]}
              r={STICK_RADIUS_PX}
              className="fill-white/10 stroke-white/50 [stroke-width:2]"
            />
            <circle
              data-testid="touch-stick-knob"
              cx={state.knob[0]}
              cy={state.knob[1]}
              r={STICK_RADIUS_PX / 2}
              className="fill-white/70"
            />
          </>
        ) : null}
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: Implement ArenaLoadingScreen.tsx and ArenaDebugOverlay.tsx**

```tsx
// src/components/cityArena/ArenaLoadingScreen.tsx
"use client";

import { useState } from "react";

/** Landscape splash art (delivered by the branding PR); the screen degrades to plain text when absent. */
export const GAME_SPLASH_WEBP = "/branding/splash-game-landscape.webp";
export const GAME_SPLASH_JPG = "/branding/splash-game-landscape.jpg";
/** ODbL attribution shown on every overlay screen. */
export const ATTRIBUTION_TEXT = "Kaart © OpenStreetMap-bijdragers";

type Props = { loaded: number; total: number; failed: boolean };

/** Full-screen loading state: artwork, "Kaart laden…" progress and the attribution. */
export default function ArenaLoadingScreen({
  loaded,
  total,
  failed,
}: Props): React.JSX.Element {
  const [imageBroken, setImageBroken] = useState(false);
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-10 flex flex-col bg-[#0B1220]"
    >
      {imageBroken ? null : (
        <picture className="min-h-0 flex-1">
          <source srcSet={GAME_SPLASH_WEBP} type="image/webp" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            data-testid="game-splash-image"
            src={GAME_SPLASH_JPG}
            alt=""
            decoding="async"
            className="h-full w-full object-cover object-center"
            onError={() => setImageBroken(true)}
          />
        </picture>
      )}
      <div className="shrink-0 px-4 py-3 text-center text-sm text-[#c9d1d9]">
        <p className="font-semibold">
          Kaart laden… {loaded}/{total}
        </p>
        {failed ? (
          <p className="mt-1 text-[#f0b429]">Kaart kon niet volledig laden</p>
        ) : null}
        <p className="muted mt-2 text-xs">{ATTRIBUTION_TEXT}</p>
      </div>
    </div>
  );
}
```

```tsx
// src/components/cityArena/ArenaDebugOverlay.tsx
"use client";

import type { MetricsSnapshot } from "@/lib/cityArena/debugMetrics";
import type { Camera } from "@/lib/cityArena/render/camera";
import type { PlayerState } from "@/lib/cityArena/sim/types";

type Props = {
  metrics: MetricsSnapshot;
  chunks: { chunks: number; bytes: number };
  tiles: number;
  camera: Camera;
  player: PlayerState;
  routeMetres: number | null;
};

/** `?debug=1` panel with frame timings, cache sizes and positions. */
export default function ArenaDebugOverlay({
  metrics,
  chunks,
  tiles,
  camera,
  player,
  routeMetres,
}: Props): React.JSX.Element {
  const lines = [
    `fps ${metrics.fps} · frame p95 ${metrics.frameP95Ms.toFixed(1)} ms`,
    `draw p95 ${metrics.drawP95Ms.toFixed(1)} ms · sim p95 ${metrics.simP95Ms.toFixed(1)} ms`,
    `chunks ${chunks.chunks} (${(chunks.bytes / 1024 / 1024).toFixed(1)} MB) · tiles ${tiles}`,
    `camera ${camera.x.toFixed(1)}, ${camera.y.toFixed(1)} · zoom ${camera.zoom}`,
    `player ${player.x.toFixed(1)}, ${player.y.toFixed(1)} · ${player.speed.toFixed(1)} m/s`,
    `route ${routeMetres === null ? "—" : `${Math.round(routeMetres)} m`}`,
  ];
  return (
    <div
      data-testid="arena-debug"
      className="pointer-events-none absolute right-2 top-2 z-20 rounded bg-black/70 px-2 py-1 font-mono text-[11px] leading-4 text-white"
    >
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/debugFlag.test.ts src/components/cityArena`
Expected: PASS (1 + 1 + 2 + 1 tests). jsdom returns a zero rect from `getBoundingClientRect`, so local coordinates equal client coordinates in the stick test.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/debugFlag.ts src/lib/cityArena/debugFlag.test.ts src/components/cityArena
git add src/lib/cityArena/debugFlag.ts src/lib/cityArena/debugFlag.test.ts src/components/cityArena
git commit -m "feat(arena): add touch stick, loading screen and debug overlay components

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: The game overlay — boot, loop, HUD, input wiring

**Files:**

- Create: `src/components/cityArena/useDialogFocusTrap.ts`
- Create: `src/components/cityArena/useArenaGame.ts`
- Create: `src/components/cityArena/CityArenaOverlay.tsx`
- Test: `src/components/cityArena/useDialogFocusTrap.test.tsx`, `src/components/cityArena/CityArenaOverlay.test.tsx`

**Interfaces:**

- Consumes: everything from Tasks 1–12: `createMapLoader`, `createWorldSession`, `createDomCanvasFactory`, `findZoneByKey`, `findZone`, `pickSpawn`, `createRng`, `seedFromString`, `createFreeRoamState`, `stepFreeRoam`, `teleportPlayer`, `SIM_STEP_S`, `createInputState`, `attachKeyboard`, `createStick`, `createCamera`, `updateCamera`, `zoomLevelForViewport`, `renderScene`, `createFrameMetrics`, `nearestRoadName`, `findPath`, `pathLength`, `isDebugEnabled`, `loadArenaSettings`, `saveArenaSettings`, `ATTRIBUTION_TEXT`, components `TouchStick`, `ArenaLoadingScreen`, `ArenaDebugOverlay`; `ZoneKey`, `MapZone`.
- Produces: `useDialogFocusTrap(dialogRef: RefObject<HTMLDivElement | null>, onClose: () => void): void`; `ArenaPhase = "loading" | "playing" | "error"`, `ArenaHud = { zoneName: string | null; street: string | null }`, `useArenaGame(options: { zoneKey: ZoneKey; canvasRef: RefObject<HTMLCanvasElement | null>; debug: boolean }): { phase; progress: LoadProgress; failed: boolean; hud: ArenaHud; zones: MapZone[]; setInputVector(vector: [number, number] | null): void; teleportToZone(key: ZoneKey): void; debugSnapshot: DebugSnapshot | null }`, `DebugSnapshot = { metrics: MetricsSnapshot; chunks: { chunks: number; bytes: number }; tiles: number; camera: Camera; player: PlayerState; routeMetres: number | null }`; `<CityArenaOverlay zone onClose />` default export.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/cityArena/useDialogFocusTrap.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogFocusTrap } from "./useDialogFocusTrap";

function Dialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocusTrap(ref, onClose);
  return (
    <div ref={ref} role="dialog" tabIndex={-1}>
      <button type="button">Eerste</button>
      <button type="button">Laatste</button>
    </div>
  );
}

describe("useDialogFocusTrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("closes on Escape and wraps Tab between the first and last control", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    screen.getByText("Laatste").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("Eerste"));
    fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

```tsx
// src/components/cityArena/CityArenaOverlay.test.tsx
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapIndex, MapTile } from "@/lib/cityArena/world/mapTypes";
import {
  createFakeContext,
  createFakeTarget,
} from "@/lib/cityArena/render/testing/fakeContext";

const index: MapIndex = {
  version: 1,
  generatedAt: "2026-09-04T10:00:00.000Z",
  origin: { lat: 51.98, lon: 5.625 },
  unitsPerMetre: 4,
  bounds: { minX: -8000, minY: -8000, maxX: 24000, maxY: 24000 },
  tileSize: 8000,
  tiles: [],
  zones: [
    {
      key: "wageningen",
      name: "Wageningen centrum",
      center: [0, 0],
      radius: 2000,
      spawnNodes: [[0, 0]],
      landmarks: [],
    },
    {
      key: "campus",
      name: "WUR-campus",
      center: [8000, 8000],
      radius: 2000,
      spawnNodes: [[8000, 8000]],
      landmarks: [],
    },
  ],
  landmarks: [],
};
for (let y = 0; y < 4; y++)
  for (let x = 0; x < 4; x++)
    index.tiles.push({ x, y, file: `tile_${x}_${y}.json`, bytes: 1 });
const emptyTile = (x: number, y: number): MapTile => ({
  x,
  y,
  roads: [
    { points: [-40, 0, 40, 0], roadClass: "residential", name: "Hoogstraat" },
  ],
  buildings: [],
  ground: [],
  water: [],
});

const fetchImpl = vi.fn<typeof fetch>(async (input) => {
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
  return new Response(
    JSON.stringify(
      match ? emptyTile(Number(match[1]), Number(match[2])) : null,
    ),
    { status: match ? 200 : 404 },
  );
});

vi.mock("@/lib/cityArena/render/canvasTypes", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/cityArena/render/canvasTypes")>();
  return {
    ...original,
    createDomCanvasFactory: () => (width: number, height: number) =>
      createFakeTarget(width, height),
  };
});
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import CityArenaOverlay from "./CityArenaOverlay";

describe("CityArenaOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchImpl);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => createFakeContext() as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
      window.setTimeout(() => callback(performance.now()), 16),
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) =>
      window.clearTimeout(handle),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads the world, shows the HUD with the zone and street, teleports and closes", async () => {
    const onClose = vi.fn();
    render(<CityArenaOverlay zone="wageningen" onClose={onClose} />);
    expect(screen.getByRole("status")).toHaveTextContent("Kaart laden…");
    await waitFor(() =>
      expect(screen.getByTestId("arena-hud")).toHaveTextContent(
        "Wageningen centrum",
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("arena-hud")).toHaveTextContent("Hoogstraat"),
    );
    expect(
      screen.getAllByText("Kaart © OpenStreetMap-bijdragers").length,
    ).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Ga naar"), {
      target: { value: "campus" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("arena-hud")).toHaveTextContent("WUR-campus"),
    );
    await act(async () => {
      fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
    });
    expect(onClose).toHaveBeenCalled();
  });
});
```

The `createFakeContext() as unknown as CanvasRenderingContext2D` cast is the one place a cast is unavoidable: jsdom's `getContext` returns `null`, and the fake only implements the `RasterContext` subset. It lives in a test file and is explained by a comment above it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/cityArena/useDialogFocusTrap.test.tsx src/components/cityArena/CityArenaOverlay.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement useDialogFocusTrap.ts**

```ts
// src/components/cityArena/useDialogFocusTrap.ts
"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focuses the dialog on mount, keeps Tab inside it, closes on Escape and restores focus on unmount. */
export function useDialogFocusTrap(
  dialogRef: RefObject<HTMLDivElement | null>,
  onClose: () => void,
): void {
  useLayoutEffect(() => {
    dialogRef.current?.focus();
  }, [dialogRef]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === "Escape" || event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const nodes = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ];
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [dialogRef, onClose]);
}
```

- [ ] **Step 4: Implement useArenaGame.ts**

```ts
// src/components/cityArena/useArenaGame.ts
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
  type MetricsSnapshot,
} from "@/lib/cityArena/debugMetrics";
import { createInputState } from "@/lib/cityArena/input/inputState";
import { attachKeyboard } from "@/lib/cityArena/input/keyboard";
import {
  createCamera,
  updateCamera,
  zoomLevelForViewport,
  type Camera,
} from "@/lib/cityArena/render/camera";
import { createDomCanvasFactory } from "@/lib/cityArena/render/canvasTypes";
import { renderScene } from "@/lib/cityArena/render/renderScene";
import {
  createFreeRoamState,
  stepFreeRoam,
  teleportPlayer,
} from "@/lib/cityArena/sim/freeRoam";
import { SIM_STEP_S } from "@/lib/cityArena/sim/player";
import { createRng, seedFromString } from "@/lib/cityArena/sim/rng";
import type { FreeRoamState, PlayerState } from "@/lib/cityArena/sim/types";
import { saveArenaSettings } from "@/lib/cityArena/storage";
import {
  createMapLoader,
  type LoadProgress,
} from "@/lib/cityArena/world/mapLoader";
import type { MapZone, ZoneKey } from "@/lib/cityArena/world/mapTypes";
import { nearestRoadName } from "@/lib/cityArena/world/nearestRoad";
import { findPath, pathLength } from "@/lib/cityArena/world/roadGraph";
import {
  createWorldSession,
  type WorldSession,
} from "@/lib/cityArena/world/worldSession";
import { findZone, findZoneByKey, pickSpawn } from "@/lib/cityArena/world/zone";

/** Overlay lifecycle phase. */
export type ArenaPhase = "loading" | "playing" | "error";
/** Text shown in the HUD strip. */
export type ArenaHud = { zoneName: string | null; street: string | null };
/** Data for the debug panel. */
export type DebugSnapshot = {
  metrics: MetricsSnapshot;
  chunks: { chunks: number; bytes: number };
  tiles: number;
  camera: Camera;
  player: PlayerState;
  routeMetres: number | null;
};
/** Hook options. */
export type UseArenaGameOptions = {
  zoneKey: ZoneKey;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  debug: boolean;
};
/** Hook result consumed by the overlay. */
export type ArenaGame = {
  phase: ArenaPhase;
  progress: LoadProgress;
  failed: boolean;
  hud: ArenaHud;
  zones: MapZone[];
  setInputVector(vector: [number, number] | null): void;
  teleportToZone(key: ZoneKey): void;
  debugSnapshot: DebugSnapshot | null;
};

const TILE_REFRESH_MS = 500;
const HUD_REFRESH_MS = 250;
const DEBUG_REFRESH_MS = 500;
const MAX_FRAME_S = 0.1;

type Runtime = {
  session: WorldSession;
  state: FreeRoamState;
  camera: Camera;
  accumulator: number;
  lastTileSync: number;
  lastHud: number;
  lastDebug: number;
};

function reportArenaError(error: unknown, kind: string): void {
  Sentry.captureException(error, { tags: { area: "arena", kind } });
}

function paintCanvas(
  canvas: HTMLCanvasElement,
  runtime: Runtime,
  zone: MapZone | null,
): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (
    canvas.width !== Math.round(rect.width * dpr) ||
    canvas.height !== Math.round(rect.height * dpr)
  ) {
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const { session, state, camera } = runtime;
  renderScene(
    ctx,
    { rect: { x: 0, y: 0, width: rect.width, height: rect.height }, camera },
    {
      world: {
        raster: session.raster,
        tiles: session.tiles(),
        landmarks: session.landmarks(),
        loadedTileRects: session.loadedTileRects(),
      },
      player: state.player,
      zone,
    },
  );
}

function routeToNearestLandmark(runtime: Runtime): number | null {
  const index = runtime.session.index();
  const graph = runtime.session.graph();
  const from = graph.nearestNode([
    runtime.state.player.x,
    runtime.state.player.y,
  ]);
  if (from === null || index.landmarks.length === 0) return null;
  const nearest = index.landmarks
    .map((landmark) =>
      graph.nearestNode(
        [
          landmark.center[0] / index.unitsPerMetre,
          landmark.center[1] / index.unitsPerMetre,
        ],
        200,
      ),
    )
    .find((node): node is number => node !== null);
  if (nearest === undefined) return null;
  const path = findPath(graph, from, nearest);
  return path ? pathLength(graph, path) : null;
}

/** Owns the world session, the fixed-step loop, the camera and the HUD/debug state. */
export function useArenaGame({
  zoneKey,
  canvasRef,
  debug,
}: UseArenaGameOptions): ArenaGame {
  const [phase, setPhase] = useState<ArenaPhase>("loading");
  const [progress, setProgress] = useState<LoadProgress>({
    loaded: 0,
    total: 0,
  });
  const [failed, setFailed] = useState(false);
  const [hud, setHud] = useState<ArenaHud>({ zoneName: null, street: null });
  const [zones, setZones] = useState<MapZone[]>([]);
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot | null>(
    null,
  );
  const runtimeRef = useRef<Runtime | null>(null);
  const inputRef = useRef(createInputState());
  const metricsRef = useRef(createFrameMetrics());

  useEffect(() => {
    let cancelled = false;
    const loader = createMapLoader({
      onError: (error, file) => {
        reportArenaError(error, `tile-load:${file}`);
        setFailed(true);
      },
    });
    const session = createWorldSession({
      loader,
      canvasFactory: createDomCanvasFactory(),
    });
    session
      .ready()
      .then(async ({ index }) => {
        const zone = findZoneByKey(index, zoneKey) ?? index.zones[0];
        const spawn = zone
          ? pickSpawn(
              zone,
              createRng(seedFromString(`${zone.key}:${Date.now()}`)),
            )
          : [0, 0];
        const width = canvasRef.current?.getBoundingClientRect().width ?? 390;
        runtimeRef.current = {
          session,
          state: createFreeRoamState(spawn, index),
          camera: createCamera(spawn, zoomLevelForViewport(width)),
          accumulator: 0,
          lastTileSync: 0,
          lastHud: 0,
          lastDebug: 0,
        };
        setZones(index.zones);
        setProgress(await session.update(spawn));
        if (!cancelled) setPhase("playing");
      })
      .catch((error: unknown) => {
        reportArenaError(error, "world-boot");
        if (!cancelled) setPhase("error");
      });
    return () => {
      cancelled = true;
      session.dispose();
      runtimeRef.current = null;
    };
  }, [canvasRef, zoneKey]);

  useEffect(() => attachKeyboard(window, inputRef.current), []);

  useEffect(() => {
    if (phase !== "playing") return;
    let handle = 0;
    let lastTs: number | null = null;
    const frame = (timestamp: number): void => {
      const runtime = runtimeRef.current;
      const canvas = canvasRef.current;
      if (runtime && canvas) {
        const dt = Math.min(
          MAX_FRAME_S,
          lastTs === null ? SIM_STEP_S : (timestamp - lastTs) / 1000,
        );
        lastTs = timestamp;
        const simStart = performance.now();
        advanceSimulation(runtime, dt, inputRef.current.snapshot());
        const drawStart = performance.now();
        paintCanvas(
          canvas,
          runtime,
          runtime.state.zoneKey
            ? findZoneByKey(runtime.session.index(), runtime.state.zoneKey)
            : null,
        );
        const drawEnd = performance.now();
        metricsRef.current.record({
          frameMs: dt * 1000,
          drawMs: drawEnd - drawStart,
          simMs: drawStart - simStart,
        });
        refreshAsync(runtime, timestamp, {
          setProgress,
          setHud,
          setDebugSnapshot,
          debug,
          metrics: metricsRef.current,
        });
      }
      handle = window.requestAnimationFrame(frame);
    };
    handle = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(handle);
  }, [canvasRef, debug, phase]);

  const setInputVector = useCallback(
    (vector: [number, number] | null) => inputRef.current.setStick(vector),
    [],
  );

  const teleportToZone = useCallback((key: ZoneKey) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const zone = findZoneByKey(runtime.session.index(), key);
    if (!zone) return;
    const target = pickSpawn(
      zone,
      createRng(seedFromString(`${key}:${Date.now()}`)),
    );
    runtime.state = teleportPlayer(
      runtime.state,
      target,
      runtime.session.index(),
    );
    runtime.camera = createCamera(target, runtime.camera.zoom);
    runtime.lastTileSync = 0;
    saveArenaSettings({ lastZone: key });
    setHud({ zoneName: zone.name, street: null });
  }, []);

  return {
    phase,
    progress,
    failed,
    hud,
    zones,
    setInputVector,
    teleportToZone,
    debugSnapshot,
  };
}

function advanceSimulation(
  runtime: Runtime,
  dt: number,
  input: { move: [number, number] },
): void {
  runtime.accumulator += dt;
  const world = {
    collision: runtime.session.collision,
    index: runtime.session.index(),
  };
  while (runtime.accumulator >= SIM_STEP_S) {
    runtime.state = stepFreeRoam(runtime.state, input, SIM_STEP_S, world);
    runtime.accumulator -= SIM_STEP_S;
  }
  const { player } = runtime.state;
  const velocity: [number, number] = [
    Math.cos(player.facing) * player.speed,
    Math.sin(player.facing) * player.speed,
  ];
  runtime.camera = updateCamera(
    runtime.camera,
    [player.x, player.y],
    velocity,
    dt,
  );
}

type RefreshSinks = {
  setProgress: (progress: LoadProgress) => void;
  setHud: (hud: ArenaHud) => void;
  setDebugSnapshot: (snapshot: DebugSnapshot | null) => void;
  debug: boolean;
  metrics: { snapshot(): MetricsSnapshot };
};

function refreshAsync(
  runtime: Runtime,
  timestamp: number,
  sinks: RefreshSinks,
): void {
  const { player } = runtime.state;
  if (timestamp - runtime.lastTileSync >= TILE_REFRESH_MS) {
    runtime.lastTileSync = timestamp;
    runtime.session
      .update([player.x, player.y])
      .then(sinks.setProgress, (error: unknown) =>
        reportArenaError(error, "tile-sync"),
      );
  }
  if (timestamp - runtime.lastHud >= HUD_REFRESH_MS) {
    runtime.lastHud = timestamp;
    const zone = findZone(runtime.session.index(), [player.x, player.y]);
    sinks.setHud({
      zoneName: zone?.name ?? null,
      street: nearestRoadName(runtime.session.tiles(), [player.x, player.y]),
    });
  }
  if (sinks.debug && timestamp - runtime.lastDebug >= DEBUG_REFRESH_MS) {
    runtime.lastDebug = timestamp;
    sinks.setDebugSnapshot({
      metrics: sinks.metrics.snapshot(),
      chunks: runtime.session.raster.stats(),
      tiles: runtime.session.tiles().length,
      camera: runtime.camera,
      player,
      routeMetres: routeToNearestLandmark(runtime),
    });
  }
}
```

- [ ] **Step 5: Implement CityArenaOverlay.tsx**

```tsx
// src/components/cityArena/CityArenaOverlay.tsx
"use client";

import { useEffect, useMemo, useRef, useState, type ReactPortal } from "react";
import { createPortal } from "react-dom";
import { isDebugEnabled } from "@/lib/cityArena/debugFlag";
import { createStick } from "@/lib/cityArena/input/touchStick";
import type { ZoneKey } from "@/lib/cityArena/world/mapTypes";
import ArenaDebugOverlay from "./ArenaDebugOverlay";
import ArenaLoadingScreen, { ATTRIBUTION_TEXT } from "./ArenaLoadingScreen";
import TouchStick from "./TouchStick";
import { useArenaGame } from "./useArenaGame";
import { useDialogFocusTrap } from "./useDialogFocusTrap";

type Props = { zone: ZoneKey; onClose: () => void };

/** Full-screen free-roam session: loading screen, canvas, HUD strip, touch stick, attribution. */
export default function CityArenaOverlay({
  zone,
  onClose,
}: Props): ReactPortal | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stick = useMemo(() => createStick(), []);
  const [debug] = useState(
    () =>
      typeof window !== "undefined" &&
      isDebugEnabled(window.location.search, process.env.NODE_ENV),
  );
  const [showTouch, setShowTouch] = useState(true);
  const game = useArenaGame({ zoneKey: zone, canvasRef, debug });
  useDialogFocusTrap(dialogRef, onClose);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 768px), (pointer: coarse)");
    const apply = (): void => setShowTouch(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const overlay = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Stadsstrijd"
      tabIndex={-1}
      className="fixed inset-0 z-[3200] flex min-h-dvh flex-col touch-none select-none bg-[#0B1220] pt-safe pb-safe-bottom-bar pl-safe pr-safe [-webkit-user-select:none] [-webkit-touch-callout:none]"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        data-testid="arena-hud"
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#21262d] px-3 py-2 text-sm text-[#c9d1d9]"
      >
        <div className="flex min-w-0 flex-wrap gap-2.5">
          <span className="font-semibold">
            {game.hud.zoneName ?? "Vrij rondlopen"}
          </span>
          {game.hud.street ? (
            <span className="muted truncate">{game.hud.street}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            <span>Ga naar</span>
            <select
              aria-label="Ga naar"
              className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-sm text-[#c9d1d9]"
              value={
                game.hud.zoneName
                  ? (game.zones.find(
                      (candidate) => candidate.name === game.hud.zoneName,
                    )?.key ?? "")
                  : ""
              }
              onChange={(event) => {
                const chosen = game.zones.find(
                  (candidate) => candidate.key === event.target.value,
                );
                if (chosen) game.teleportToZone(chosen.key);
              }}
            >
              <option value="">Kies…</option>
              {game.zones.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onClose}>
            Sluiten
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          className="block h-full w-full touch-none"
          aria-label="Stadsstrijd speelveld"
        />
        {game.phase === "playing" && showTouch ? (
          <TouchStick stick={stick} onVector={game.setInputVector} />
        ) : null}
        {game.phase === "loading" ? (
          <ArenaLoadingScreen
            loaded={game.progress.loaded}
            total={game.progress.total}
            failed={game.failed}
          />
        ) : null}
        {game.phase === "error" ? (
          <div
            role="alert"
            className="absolute inset-0 flex items-center justify-center p-6 text-center text-[#c9d1d9]"
          >
            Kon geen verbinding maken, probeer het later opnieuw
          </div>
        ) : null}
        {debug && game.debugSnapshot ? (
          <ArenaDebugOverlay {...game.debugSnapshot} />
        ) : null}
      </div>
      <p className="muted mx-2 my-1 shrink-0 text-center text-xs">
        {showTouch
          ? "Sleep links op het scherm om te lopen."
          : "Toetsenbord: WASD of pijltjes om te lopen, Esc sluit."}{" "}
        {ATTRIBUTION_TEXT}
      </p>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
```

Note: `document.body.style.overflow` is not a React inline `style` prop — it mirrors the Space Invaders overlay and is allowed.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/cityArena/useDialogFocusTrap.test.tsx src/components/cityArena/CityArenaOverlay.test.tsx`
Expected: PASS (1 + 1 tests). If the overlay test times out waiting for "Hoogstraat", check that `nearestRoadName` receives decoded tiles (the fixture road runs through the spawn point at (0, 0) so its distance is 0) and that `HUD_REFRESH_MS` elapsed — the mocked `requestAnimationFrame` advances `performance.now()` for real, so wait a little longer via `waitFor`'s default 1 s timeout; raise it to 3 s if needed.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/components/cityArena
git add src/components/cityArena
git commit -m "feat(arena): add the free-roam game overlay with loop, HUD and input

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Launcher card under Space Invaders

**Files:**

- Modify: `src/lib/cityArena/constants.ts` (add `ZONE_OPTIONS`)
- Create: `src/components/cityArena/CityArenaLaunchIcon.tsx`
- Create: `src/components/cityArena/CityArenaLauncher.tsx`
- Modify: `src/components/EventList.tsx` (mount after `<SpaceInvadersLauncher />`, around line 465)
- Test: `src/components/cityArena/CityArenaLauncher.test.tsx`

**Interfaces:**

- Consumes: `useSession()` from `../SessionContext` (`{ loading, loggedIn }`); `loadArenaSettings`, `saveArenaSettings` (Task 1); `ZoneKey`; `CityArenaOverlay` (Task 13) via `next/dynamic`; `ATTRIBUTION_TEXT` (Task 12).
- Produces: `ZONE_OPTIONS: { key: ZoneKey; name: string }[]` (Rhenen centrum, Wageningen centrum, WUR-campus, Bennekom — the same names as `index.json`); `<CityArenaLaunchIcon size decorative className />`; `<CityArenaLauncher />` default export.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/cityArena/CityArenaLauncher.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARENA_SETTINGS_KEY } from "@/lib/cityArena/storage";
import CityArenaLauncher from "./CityArenaLauncher";

const sessionState = {
  loading: false,
  loggedIn: true,
  isAdmin: false,
  isTrainer: false,
  refresh: async () => {},
};
vi.mock("../SessionContext", () => ({ useSession: () => sessionState }));
vi.mock("next/dynamic", () => ({
  default: () => {
    const Stub = ({
      zone,
      onClose,
    }: {
      zone: string;
      onClose: () => void;
    }): React.JSX.Element => (
      <div data-testid="overlay-stub">
        {zone}
        <button type="button" onClick={onClose}>
          dicht
        </button>
      </div>
    );
    return Stub;
  },
}));

describe("CityArenaLauncher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionState.loggedIn = true;
  });

  it("offers the zone choice and opens the overlay for a logged-in member, remembering the zone", () => {
    render(<CityArenaLauncher />);
    expect(screen.getByText("Stadsstrijd")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Startpunt"), {
      target: { value: "rhenen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Spelen" }));
    expect(screen.getByTestId("overlay-stub")).toHaveTextContent("rhenen");
    expect(
      JSON.parse(localStorage.getItem(ARENA_SETTINGS_KEY) ?? "{}"),
    ).toEqual({ lastZone: "rhenen" });
    fireEvent.click(screen.getByText("dicht"));
    expect(screen.queryByTestId("overlay-stub")).toBeNull();
  });

  it("asks visitors to log in", () => {
    sessionState.loggedIn = false;
    render(<CityArenaLauncher />);
    expect(screen.queryByRole("button", { name: "Spelen" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Log in om mee te doen" }),
    ).toHaveAttribute("href", expect.stringContaining("/login"));
    expect(
      screen.getByText("Kaart © OpenStreetMap-bijdragers"),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/cityArena/CityArenaLauncher.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the zone options and the icon**

Append to `src/lib/cityArena/constants.ts`:

```ts
import type { ZoneKey } from "./world/mapTypes";

/** Match zones offered on the launcher card, in the same order and with the same names as `index.json`. */
export const ZONE_OPTIONS: { key: ZoneKey; name: string }[] = [
  { key: "rhenen", name: "Rhenen centrum" },
  { key: "wageningen", name: "Wageningen centrum" },
  { key: "campus", name: "WUR-campus" },
  { key: "bennekom", name: "Bennekom" },
];
```

(Put the `import type` line at the top of the file.)

```tsx
// src/components/cityArena/CityArenaLaunchIcon.tsx
type Props = { size?: number; decorative?: boolean; className?: string };

/** A small road-and-marker glyph for the launcher card. */
export function CityArenaLaunchIcon({
  size = 36,
  decorative = false,
  className,
}: Props): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : "Stadsstrijd"}
    >
      <rect
        x="4"
        y="4"
        width="40"
        height="40"
        rx="8"
        fill="#0d1117"
        stroke="#30363d"
        strokeWidth="2"
      />
      <path
        d="M8 34 C 18 30, 22 22, 40 18"
        stroke="#f2eee6"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M8 34 C 18 30, 22 22, 40 18"
        stroke="#e0b64a"
        strokeWidth="1"
        strokeDasharray="3 3"
        fill="none"
      />
      <circle
        cx="30"
        cy="14"
        r="5"
        fill="#e11d48"
        stroke="#fff"
        strokeWidth="2"
      />
    </svg>
  );
}
```

- [ ] **Step 4: Implement CityArenaLauncher.tsx and mount it**

```tsx
// src/components/cityArena/CityArenaLauncher.tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { ZONE_OPTIONS } from "@/lib/cityArena/constants";
import { loadArenaSettings, saveArenaSettings } from "@/lib/cityArena/storage";
import type { ZoneKey } from "@/lib/cityArena/world/mapTypes";
import { useSession } from "../SessionContext";
import { ATTRIBUTION_TEXT } from "./ArenaLoadingScreen";
import { CityArenaLaunchIcon } from "./CityArenaLaunchIcon";

/** Same full-screen layer as the overlay so the chunk load never shows inline in the page. */
function ChunkLoadingOverlay(): React.JSX.Element | null {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-[3200] flex items-center justify-center touch-none bg-[#0B1220] pt-safe pb-safe-bottom-bar pl-safe pr-safe"
    >
      <p className="muted p-4 text-center text-base">Spel laden…</p>
    </div>,
    document.body,
  );
}

const CityArenaOverlay = dynamic(
  () => import("./CityArenaOverlay").then((module) => module.default),
  { ssr: false, loading: () => <ChunkLoadingOverlay /> },
);

/** Card under Space Invaders: pick a start zone and open the free-roam overlay. */
export default function CityArenaLauncher(): React.JSX.Element {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [zone, setZone] = useState<ZoneKey>(() => loadArenaSettings().lastZone);

  const openOverlay = useCallback(() => {
    saveArenaSettings({ lastZone: zone });
    setOpen(true);
  }, [zone]);
  const closeOverlay = useCallback(() => setOpen(false), []);

  return (
    <>
      <div className="card mt-4">
        <div className="flex flex-wrap items-start gap-3">
          <CityArenaLaunchIcon size={52} decorative className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Stadsstrijd</div>
            <div className="muted mt-1 text-[13px]">
              Loop door Rhenen, Wageningen, de WUR-campus en Bennekom op de
              echte kaart — straten, gebouwen en herkenningspunten uit
              OpenStreetMap. Eerste versie: alleen rondlopen; auto&apos;s,
              tegenstanders en multiplayer volgen.
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted text-xs">Startpunt</span>
            <select
              aria-label="Startpunt"
              className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-sm text-[#c9d1d9]"
              value={zone}
              onChange={(event) =>
                setZone(
                  ZONE_OPTIONS.find(
                    (option) => option.key === event.target.value,
                  )?.key ?? zone,
                )
              }
            >
              {ZONE_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          {session.loggedIn ? (
            <button
              type="button"
              onClick={openOverlay}
              className="inline-flex items-center rounded-xl border border-cyan-500/50 bg-gradient-to-br from-cyan-900/95 via-[#0c1528] to-violet-900/95 px-4 py-2.5 text-sm font-semibold text-[#a5f3fc] shadow-[0_0_20px_-2px_rgba(34,211,238,0.55)] transition hover:border-cyan-400/70 active:scale-[0.98]"
            >
              Spelen
            </button>
          ) : (
            <Link
              href={{ pathname: "/login", query: { callbackUrl: "/" } }}
              className="inline-flex items-center rounded-xl border border-white/15 bg-[#111926] px-3 py-2.5 text-sm font-medium text-[#c9d7ee]"
            >
              Log in om mee te doen
            </Link>
          )}
        </div>
        <p className="muted mt-3 text-xs">{ATTRIBUTION_TEXT}</p>
      </div>
      {open ? <CityArenaOverlay zone={zone} onClose={closeOverlay} /> : null}
    </>
  );
}
```

In `src/components/EventList.tsx` add `import CityArenaLauncher from "./cityArena/CityArenaLauncher";` next to the Space Invaders import and render `<CityArenaLauncher />` on the line directly after `<SpaceInvadersLauncher />`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/cityArena/CityArenaLauncher.test.tsx src/components/EventList.test.tsx`
Expected: PASS (2 launcher tests; the existing EventList tests, if any, still pass — if `EventList.test.tsx` does not exist, run only the launcher test). If `next/link` complains about `typedRoutes` for `/login`, use `href={"/login?callbackUrl=%2F"}` instead.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/constants.ts src/components/cityArena src/components/EventList.tsx
git add src/lib/cityArena/constants.ts src/components/cityArena src/components/EventList.tsx
git commit -m "feat(arena): add the Stadsstrijd launcher card under Space Invaders

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Docs, device check, verification and PR 2

**Files:**

- Modify: `docs/tech/arena/README.md` (add a "Runtime (PR 2)" section)
- Modify: `docs/superpowers/specs/2026-09-03-city-arena-design.md` §13 (runtime file list now real)
- Modify (generated): `docs/specs/functional.md` only if `npm run docs:generate` works on your machine (it is broken on Windows — see plan 1; the `arena` row already exists, so skipping it is fine)

- [ ] **Step 1: Document the runtime**

Append to `docs/tech/arena/README.md`:

```markdown
## Runtime (PR 2 — free-roam)

- Launcher: `src/components/cityArena/CityArenaLauncher.tsx` (card under Space Invaders in `EventList`), overlay
  `CityArenaOverlay.tsx` (dynamic import), loop/HUD state in `useArenaGame.ts`.
- World: `src/lib/cityArena/world/` — `mapLoader` streams the 3 × 3 tiles around the player (≤ 9 resident),
  `worldSession` keeps `collisionGrid` (16 m cells, circle push-out) and the `render/staticRaster` chunk cache
  (128 m chunks, ≤ 40 MB) in sync; `roadGraph` decodes `roads.json` with A\* (used by the debug overlay now,
  by cops in PR 4); `zone` resolves discs and spawn nodes.
- Rendering: `render/renderScene` draws one viewport (chunk blits → zone ring → player); chunks are painted by
  `render/drawStatic` (ground → water → pavements → roads → centre lines → buildings → street/landmark labels).
- Input: WASD/arrows (`input/keyboard`), floating stick on coarse pointers (`input/touchStick` + `TouchStick`).
- Debug: open the overlay with `?debug=1` in the URL (non-production builds) for fps/p95, chunk and tile counts,
  camera/player positions and the route length to the nearest landmark.
- Settings: `localStorage["h3-arena-settings-v1"]` (`lastZone`).
```

In the spec's §13 file layout, replace the placeholder lines for `world/`, `sim/`, `input/`, `render/`, `src/components/cityArena/` with the files that now exist (the table in this plan's "File structure" section), leaving later-PR files (`net/`, `audio/`, `test/`, `Lobby`, `Hud`, `Scoreboard`, …) listed as planned.

- [ ] **Step 2: Manual device check (preview env)**

```bash
npx dotenv -e .env.preview.local -v NEXTAUTH_URL=http://localhost:3000 -- next dev -p 3000
```

Log in as `trainer@example.test` / `preview123`, open the events page, and check on **desktop Chrome**: card renders under Space Invaders; "Spelen" opens the overlay; loading screen shows the artwork (or the dark fallback) and progress; you can walk with WASD, cannot walk through buildings or into water, street names read correctly and flip, the HUD shows the zone and the street, "Ga naar" teleports, Esc closes and focus returns; `?debug=1` shows the panel with fps ≥ 50 on a laptop. Then **a phone on the same Wi-Fi** (`http://<laptop-ip>:3000`, or Chrome DevTools device mode as a fallback): the stick appears under the thumb on the left half, walking feels smooth, portrait and landscape both work, the page does not scroll or zoom while playing. Record the observations (fps from the debug panel, any stutter when tiles load) in the PR description.

- [ ] **Step 3: Verification loop**

```bash
npm run lint && npx tsc --noEmit && npx vitest run && npm run build
```

Expected: all green (only the pre-existing `src/types/ical.d.ts` lint warning); `npm run build` succeeds and lists `/` unchanged.

- [ ] **Step 4: Commit docs**

```bash
npx prettier --write docs/tech/arena/README.md docs/superpowers/specs/2026-09-03-city-arena-design.md
git add docs
git commit -m "docs(arena): describe the free-roam runtime and debug overlay

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: Open PR 2 (stacked on PR 1)**

The controller confirms with the owner before pushing. Then:

```bash
git push -u origin feat/city-arena-plan2
gh pr create --base feat/city-arena --title "feat(arena): free-roam world renderer on the real map (2/8)" --body "$(cat <<'EOF'
## Summary

PR 2 of the Stadsstrijd stack (design `docs/superpowers/specs/2026-09-03-city-arena-design.md`, plan `docs/superpowers/plans/2026-09-04-city-arena-plan-2-world-renderer.md`). Stacked on PR 1 (`feat/city-arena`); retarget to `image` once it merges.

- Launcher card "Stadsstrijd" under Space Invaders with a start-zone choice; overlay with loading screen (landscape artwork), HUD (zone, street, "Ga naar", Sluiten), attribution footer, `?debug=1` metrics panel.
- Runtime world: tile streaming (3 × 3 around the player, ≤ 9 resident), decoded road graph with A*, 16 m collision grid with circle push-out, 128 m chunk raster cache (≤ 40 MB) painting ground/water/roads/pavements/buildings/street names/landmarks, camera with look-ahead and quantised zoom.
- Walking simulation at 30 Hz with keyboard and a floating touch stick.

## Verification

- Vitest: <N> new tests (loader, LRU, collision, road graph, zones, sim, input, camera, labels, raster, scene, session, components); lint/tsc/build green.
- Manual: desktop Chrome + <phone model> — <fps>, <observations>.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Fill in the `<N>`, `<phone model>`, `<fps>` and `<observations>` fields from Steps 2–3 before creating the PR. Then run the `loop-on-ci` workflow on the PR.

---

## Roadmap after this plan

| Plan | PR  | Deliverable                                                                                                                                                                                                                            | Depends on                                                        |
| ---- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 3    | 5/8 | `RealtimeTransport` + `ablyTransport` + `memoryTransport`; token route; `arena:lobby` registry + rooms API; host election; `hostLoop`/`clientLoop` with prediction and interpolation; Lobby UI; `ConnectionBanner`; rounds, scoreboard | Plan 4a `stepArena` (players lifted to a map)                     |
| 4a   | 3/8 | Cars, weapons, bullets, damage/death + the death screen (spec §7 artwork overlay), HUD vitals, mouse aim, touch buttons                                                                                                                | Plan 2 world runtime (`renderScene`, `worldSession`, input state) |
| 4b   | 4/8 | Pedestrians, cops/wanted, pickups (spawn loadout back to pistol-only), zone out-of-bounds, radar, SFX                                                                                                                                  | Plan 4a                                                           |
| 5    | 6/8 | Prisma migration `add_arena_match`, `arenaService`, matches + leaderboard routes, launcher lists                                                                                                                                       | Plan 3 round results                                              |
| 6    | 7/8 | Twin-stick aim, buttons, haptics, feedback effects, settings UI, first-run tip                                                                                                                                                         | Plan 4b input model                                               |
| 7    | 8/8 | Test seams, relay transport, Playwright hermetic suite + DSL + budgets, CI jobs, TESTING.md                                                                                                                                            | Plans 3–6                                                         |
