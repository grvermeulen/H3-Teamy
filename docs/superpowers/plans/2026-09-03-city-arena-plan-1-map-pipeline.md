# GTA H3 (formerly Stadsstrijd) Plan 1 — Real-World Map Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the committed, versioned map asset (`public/arena/map/v1/`) for the Rhenen–Wageningen–Bennekom region from OpenStreetMap, with a tested build script, validated landmarks and zones, a size budget, and immutable cache headers.

**Architecture:** Pure, type-checked transform code lives in `src/lib/cityArena/mapBuild/` (geometry, Overpass query builders, landmark matching, road graph, area extraction, zones, tiling, assembly) and is unit-tested with Vitest. A thin Node CLI in `scripts/arena/` does the I/O: fetch Overpass with disk caching and retries, run the assembly, write JSON files, enforce the gzip budget. Shared runtime types (`world/mapTypes.ts`, `world/projection.ts`) are what Plan 2's loader will consume.

**Tech Stack:** Node 22, TypeScript 6 (strict), `tsx` for the CLI, Vitest, `osm2geojson-lite@2.0.1` (multipolygon assembly), Node built-in `fetch` and `zlib`, Next.js 16 `headers()`.

**Spec:** `docs/superpowers/specs/2026-09-03-city-arena-design.md` §3, §4 (types only), §9.4, §13, §14 (PR 1). This plan is PR 1 of the eight-PR stack; Plans 2–7 are written after this one lands, against the interfaces this plan produces.

**Deviations from the spec, decided here (spec updated in Task 13):**

1. Pure pipeline logic lives in `src/lib/cityArena/mapBuild/` instead of `scripts/arena/transform.ts`, because `tsconfig.json` excludes `scripts/**` from `tsc --noEmit`; this way the transform code is type-checked and coverage-counted. `scripts/arena/` keeps only I/O.
2. `waterway` **lines** (streams) are dropped in slice 1; only water **polygons** (`natural=water`, riverbanks) are kept. Buffering lines into polygons is not worth its complexity for the Nederrijn region, where rivers are already polygons.
3. Polygons keep their **outer ring only** (holes dropped) — courtyards and river islands are acceptable losses for a top-down arcade map.

## Global Constraints

- Node.js 22, Next.js 16 App Router, React 19, TypeScript 6 `strict`; `moduleResolution: "Bundler"`, `esModuleInterop: true`.
- No `any`, no unsafe casts; `catch (err: unknown)`; explicit return types on all exported functions; `const list: Foo[] = []` never `[] as Foo[]`.
- Every exported function, class, type-bearing constant and component in `**/*.{ts,tsx}` has a JSDoc `/** ... */` block (CodeRabbit docstring threshold 80 %).
- Descriptive full-word identifiers (`dayOfMonth`, not `d`); guard clauses over nesting; minimal comments, only for non-obvious rationale.
- Tests co-located (`foo.test.ts` beside `foo.ts`); `vi.mocked(fn)` never `(fn as any)`; every `describe` using mocks has `beforeEach(() => { vi.clearAllMocks(); })`; `vi.stubEnv`/`vi.unstubAllEnvs` for env; no bare date-only strings.
- Never the word "GTA" in code, comments, assets or UI. Working title is "Stadsstrijd"; code namespace `cityArena`.
- Map constants (verbatim from spec): bbox `51.94,5.53 → 52.02,5.72`; origin `lat0 = 51.98, lon0 = 5.625`; equirectangular `x = (lon − lon0) · cos(lat0) · 111 320`, `y = −(lat − lat0) · 110 574`; quantisation 0.25 m (4 units per metre); Douglas-Peucker 0.5 m; tiles 2 km × 2 km with 20 m overlap; buildings ≥ 30 m² within 1.5 km of a zone centre; zone radius 500 m; shape points every ≥ 20 m; spawn nodes ≥ 8 m from buildings and ≥ 6 m from water; connectivity ≥ 95 % of edges in the largest component per zone; total asset ≤ 900 KB gzipped; each landmark matches exactly one OSM element.
- Cache header for `/arena/map/:path*`: `public, max-age=31536000, immutable`.
- Conventional Commits, subject ≤ 72 chars, imperative; every commit ends with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Pre-commit runs Prettier, ESLint, `tsc --noEmit` and `vitest run` — run `npx prettier --write <files>` before each commit so the hook does not reject formatting.
- Work happens on branch `feat/city-arena` (already exists, contains the spec).

---

## File structure

| Path                                                  | Responsibility                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/lib/cityArena/constants.ts`                      | `MAP_VERSION`, `MAP_BASE_PATH` (runtime + script)                           |
| `src/lib/cityArena/world/mapTypes.ts`                 | Asset schema types and stride constants shared by build and runtime         |
| `src/lib/cityArena/world/projection.ts`               | Lon/lat ↔ metres, metres ↔ units, bbox/origin constants                     |
| `src/lib/cityArena/mapBuild/geometry.ts`              | Area, centroid, point-in-polygon, distances, Douglas-Peucker, rect clipping |
| `src/lib/cityArena/mapBuild/osmTypes.ts`              | Overpass JSON element types                                                 |
| `src/lib/cityArena/mapBuild/overpassQueries.ts`       | Pure Overpass QL string builders                                            |
| `src/lib/cityArena/mapBuild/landmarks.config.ts`      | The landmark table (§3.2)                                                   |
| `src/lib/cityArena/mapBuild/landmarks.ts`             | Exactly-one landmark matching + lon/lat centres                             |
| `src/lib/cityArena/mapBuild/roads.ts`                 | Road way parsing, class mapping, road graph, flat encoding                  |
| `src/lib/cityArena/mapBuild/areas.ts`                 | Buildings / water / ground extraction via osm2geojson-lite                  |
| `src/lib/cityArena/mapBuild/zones.ts`                 | Zone centres, spawn nodes, connectivity check                               |
| `src/lib/cityArena/mapBuild/tiles.ts`                 | Bounds, tile grid, clipping geometry into tiles, quantisation               |
| `src/lib/cityArena/mapBuild/assemble.ts`              | Pure orchestration: Overpass JSON in → `{ index, roads, tiles }` out        |
| `src/lib/cityArena/mapBuild/fixtures/overpassMini.ts` | Tiny synthetic Overpass payload for tests                                   |
| `scripts/arena/overpass.ts`                           | Fetch with disk cache + retry (I/O)                                         |
| `scripts/arena/buildMap.ts`                           | `runBuild()` — stages, file writing, gzip budget                            |
| `scripts/arena/build-map.ts`                          | CLI entry (`--check`, `--refresh`, `--out`)                                 |
| `public/arena/map/v1/*.json`                          | Committed asset                                                             |
| `next.config.js`                                      | `headers()` for immutable caching                                           |
| `docs/tech/arena/README.md`                           | Feature doc + runbook                                                       |

Coordinates convention everywhere: **metres** as `[x, y]` tuples in pipeline code (`Point`), **units** (integers, 0.25 m) only inside the emitted JSON. North is negative `y`.

---

### Task 1: Shared types, constants and projection

**Files:**

- Create: `src/lib/cityArena/constants.ts`
- Create: `src/lib/cityArena/world/mapTypes.ts`
- Create: `src/lib/cityArena/world/projection.ts`
- Test: `src/lib/cityArena/world/projection.test.ts`

**Interfaces:**

- Produces: `MAP_VERSION = "v1"`, `MAP_BASE_PATH = "/arena/map/v1"`; all `mapTypes.ts` types below (consumed by every later task and by Plan 2); `projectLonLat(lon, lat): Point`, `unprojectXY(x, y): { lon; lat }`, `toUnits(metres): number`, `fromUnits(units): number`, `MAP_ORIGIN`, `MAP_BBOX`.

- [ ] **Step 1: Write the failing projection test**

```ts
// src/lib/cityArena/world/projection.test.ts
import { describe, expect, it } from "vitest";
import {
  MAP_BBOX,
  MAP_ORIGIN,
  fromUnits,
  projectLonLat,
  toUnits,
  unprojectXY,
} from "./projection";

describe("projection", () => {
  it("maps the origin to (0, 0)", () => {
    expect(projectLonLat(MAP_ORIGIN.lon, MAP_ORIGIN.lat)).toEqual([0, 0]);
  });

  it("maps one hundredth of a degree north to about −1105.7 m (north is negative y)", () => {
    const [x, y] = projectLonLat(MAP_ORIGIN.lon, MAP_ORIGIN.lat + 0.01);
    expect(x).toBe(0);
    expect(Math.abs(y - -1105.74)).toBeLessThan(0.01);
  });

  it("scales longitude by cos(lat0)", () => {
    const [x] = projectLonLat(MAP_ORIGIN.lon + 0.01, MAP_ORIGIN.lat);
    expect(Math.abs(x - 685.9)).toBeLessThan(1);
  });

  it("round-trips through unprojectXY", () => {
    const [x, y] = projectLonLat(MAP_BBOX.east, MAP_BBOX.south);
    const { lon, lat } = unprojectXY(x, y);
    expect(Math.abs(lon - MAP_BBOX.east)).toBeLessThan(1e-9);
    expect(Math.abs(lat - MAP_BBOX.south)).toBeLessThan(1e-9);
  });

  it("quantises to 0.25 m units and back", () => {
    expect(toUnits(1)).toBe(4);
    expect(toUnits(0.3)).toBe(1);
    expect(toUnits(-0.6)).toBe(-2);
    expect(fromUnits(4)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/cityArena/world/projection.test.ts`
Expected: FAIL — `Cannot find module './projection'`.

- [ ] **Step 3: Create constants and types**

```ts
// src/lib/cityArena/constants.ts
/** Version segment of the committed map asset path; bump when regenerating the map. */
export const MAP_VERSION = "v1";

/** Public URL prefix of the map asset (served from `public/`). */
export const MAP_BASE_PATH = `/arena/map/${MAP_VERSION}`;
```

```ts
// src/lib/cityArena/world/mapTypes.ts
/** Integer map units per metre: the asset stores coordinates at 0.25 m resolution. */
export const MAP_UNITS_PER_METRE = 4;

/** Numbers per edge in `MapRoads.edges`: a, b, classIndex, nameIndex, oneway, lengthUnits. */
export const ROAD_EDGE_STRIDE = 6;

/** Keys of the four match zones. */
export type ZoneKey = "rhenen" | "wageningen" | "campus" | "bennekom";

/** Visual style a landmark building is drawn with. */
export type LandmarkStyle = "church" | "pool" | "campus" | "cafe";

/** Drivable road classes kept from OpenStreetMap (`*_link` collapsed onto the base class). */
export type RoadClass =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "unclassified"
  | "residential"
  | "living_street"
  | "pedestrian"
  | "service";

/** Ground fill categories derived from land use. */
export type GroundKind = "grass" | "field" | "forest" | "urban";

/** Axis-aligned bounds in map units. */
export type MapBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** One tile entry in the index. */
export type MapTileRef = { x: number; y: number; file: string; bytes: number };

/** A recognisable building or place, positioned in map units. */
export type MapLandmark = {
  key: string;
  name: string;
  style: LandmarkStyle;
  center: [number, number];
  tile: { x: number; y: number };
};

/** A match zone: disc centre/radius in units, spawn nodes, landmark keys inside it. */
export type MapZone = {
  key: ZoneKey;
  name: string;
  center: [number, number];
  radius: number;
  spawnNodes: [number, number][];
  landmarks: string[];
};

/** `index.json` — everything the runtime needs before loading tiles. */
export type MapIndex = {
  version: 1;
  generatedAt: string;
  origin: { lat: number; lon: number };
  unitsPerMetre: number;
  bounds: MapBounds;
  tileSize: number;
  tiles: MapTileRef[];
  zones: MapZone[];
  landmarks: MapLandmark[];
};

/**
 * `roads.json` — the drivable road graph. `nodes` is a flat `[x0, y0, x1, y1, …]` array in
 * units; `edges` is flat with {@link ROAD_EDGE_STRIDE} numbers per edge; `classes` and `names`
 * are lookup tables referenced by index (nameIndex −1 = unnamed).
 */
export type MapRoads = {
  nodes: number[];
  edges: number[];
  classes: RoadClass[];
  names: string[];
};

/** Road centre line inside a tile, flat `[x0, y0, …]` units. */
export type TileRoad = { pts: number[]; cls: RoadClass; name?: string };

/** Building footprint (outer ring, flat units, first point not repeated). */
export type TileBuilding = { pts: number[]; levels: number; landmark?: string };

/** Ground polygon with its fill kind. */
export type TileGround = { pts: number[]; kind: GroundKind };

/** Water polygon. */
export type TileWater = { pts: number[] };

/** `tile_x_y.json` — all static geometry inside one 2 km tile (plus 20 m overlap). */
export type MapTile = {
  x: number;
  y: number;
  roads: TileRoad[];
  buildings: TileBuilding[];
  ground: TileGround[];
  water: TileWater[];
};
```

- [ ] **Step 4: Implement the projection**

```ts
// src/lib/cityArena/world/projection.ts
import { MAP_UNITS_PER_METRE } from "./mapTypes";

/** A point in metres (or units when stated), `[x, y]`, north = negative y. */
export type Point = [number, number];

/** Projection origin: the centre of the region. */
export const MAP_ORIGIN = { lat: 51.98, lon: 5.625 } as const;

/** Region bounding box in degrees (south, west, north, east). */
export const MAP_BBOX = {
  south: 51.94,
  west: 5.53,
  north: 52.02,
  east: 5.72,
} as const;

const METRES_PER_DEGREE_LATITUDE = 110_574;
const METRES_PER_DEGREE_LONGITUDE_AT_ORIGIN =
  111_320 * Math.cos((MAP_ORIGIN.lat * Math.PI) / 180);

/**
 * Equirectangular projection around {@link MAP_ORIGIN}: x grows east, y grows south, both in
 * metres. Distortion across the 13 km region stays below one metre.
 */
export function projectLonLat(lon: number, lat: number): Point {
  const x = (lon - MAP_ORIGIN.lon) * METRES_PER_DEGREE_LONGITUDE_AT_ORIGIN;
  const y = -(lat - MAP_ORIGIN.lat) * METRES_PER_DEGREE_LATITUDE;
  return [x, y];
}

/** Inverse of {@link projectLonLat}. */
export function unprojectXY(
  x: number,
  y: number,
): { lon: number; lat: number } {
  return {
    lon: MAP_ORIGIN.lon + x / METRES_PER_DEGREE_LONGITUDE_AT_ORIGIN,
    lat: MAP_ORIGIN.lat - y / METRES_PER_DEGREE_LATITUDE,
  };
}

/** Metres → integer asset units (0.25 m). */
export function toUnits(metres: number): number {
  return Math.round(metres * MAP_UNITS_PER_METRE);
}

/** Asset units → metres. */
export function fromUnits(units: number): number {
  return units / MAP_UNITS_PER_METRE;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/cityArena/world/projection.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena
git add src/lib/cityArena
git commit -m "feat(arena): add map asset types, constants and projection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Geometry primitives — area, centroid, containment, distances

**Files:**

- Create: `src/lib/cityArena/mapBuild/geometry.ts`
- Test: `src/lib/cityArena/mapBuild/geometry.test.ts`

**Interfaces:**

- Consumes: `Point` from `../world/projection`.
- Produces: `Rect`, `polygonArea(ring)`, `polygonCentroid(ring)`, `pointInPolygon(point, ring)`, `distancePointToSegment(point, a, b)`, `distancePointToPolygon(point, ring)`, `boundsOf(points): Rect`, `distance(a, b)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/mapBuild/geometry.test.ts
import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import {
  boundsOf,
  distance,
  distancePointToPolygon,
  distancePointToSegment,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
} from "./geometry";

const unitSquare: Point[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

describe("geometry primitives", () => {
  it("computes area regardless of winding", () => {
    expect(polygonArea(unitSquare)).toBe(1);
    expect(polygonArea([...unitSquare].reverse())).toBe(1);
  });

  it("computes the centroid of a square", () => {
    const [x, y] = polygonCentroid(unitSquare);
    expect(x).toBeCloseTo(0.5);
    expect(y).toBeCloseTo(0.5);
  });

  it("falls back to the vertex average for a degenerate polygon", () => {
    const [x, y] = polygonCentroid([
      [0, 0],
      [2, 0],
      [4, 0],
    ]);
    expect(x).toBe(2);
    expect(y).toBe(0);
  });

  it("tests point containment", () => {
    expect(pointInPolygon([0.5, 0.5], unitSquare)).toBe(true);
    expect(pointInPolygon([2, 2], unitSquare)).toBe(false);
  });

  it("measures distance to a segment including beyond its ends", () => {
    expect(distancePointToSegment([0, 4], [-1, 0], [1, 0])).toBe(4);
    expect(distancePointToSegment([5, 0], [0, 0], [1, 0])).toBe(4);
    expect(distancePointToSegment([3, 4], [0, 0], [0, 0])).toBe(5);
  });

  it("measures distance to a polygon (zero inside)", () => {
    expect(distancePointToPolygon([0.5, 0.5], unitSquare)).toBe(0);
    expect(distancePointToPolygon([2, 0.5], unitSquare)).toBe(1);
  });

  it("computes bounds and euclidean distance", () => {
    expect(boundsOf(unitSquare)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
    });
    expect(distance([0, 0], [3, 4])).toBe(5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/mapBuild/geometry.test.ts`
Expected: FAIL — `Cannot find module './geometry'`.

- [ ] **Step 3: Implement the primitives**

```ts
// src/lib/cityArena/mapBuild/geometry.ts
import type { Point } from "../world/projection";

/** Axis-aligned rectangle in the same unit as the points it is used with. */
export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

/** Euclidean distance between two points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Bounding rectangle of a non-empty point list. */
export function boundsOf(points: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Signed shoelace sum (twice the signed area). */
function shoelace(ring: Point[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length; index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

/** Absolute polygon area for a ring whose first point is not repeated. */
export function polygonArea(ring: Point[]): number {
  return Math.abs(shoelace(ring)) / 2;
}

/** Area-weighted centroid; falls back to the vertex average when the area is ~0. */
export function polygonCentroid(ring: Point[]): Point {
  const twiceArea = shoelace(ring);
  if (Math.abs(twiceArea) < 1e-9) {
    const sumX = ring.reduce((total, [x]) => total + x, 0);
    const sumY = ring.reduce((total, [, y]) => total + y, 0);
    return [sumX / ring.length, sumY / ring.length];
  }
  let centroidX = 0;
  let centroidY = 0;
  for (let index = 0; index < ring.length; index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    centroidX += (x1 + x2) * cross;
    centroidY += (y1 + y2) * cross;
  }
  const factor = 1 / (3 * twiceArea);
  return [centroidX * factor, centroidY * factor];
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(point: Point, ring: Point[]): boolean {
  const [px, py] = point;
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    const crossesRay = y1 > py !== y2 > py;
    if (!crossesRay) continue;
    const intersectX = ((x2 - x1) * (py - y1)) / (y2 - y1) + x1;
    if (px < intersectX) inside = !inside;
  }
  return inside;
}

/** Distance from a point to the closest point on segment a–b. */
export function distancePointToSegment(
  point: Point,
  a: Point,
  b: Point,
): number {
  const segmentX = b[0] - a[0];
  const segmentY = b[1] - a[1];
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) return distance(point, a);
  const projection =
    ((point[0] - a[0]) * segmentX + (point[1] - a[1]) * segmentY) /
    lengthSquared;
  const clamped = Math.max(0, Math.min(1, projection));
  return distance(point, [
    a[0] + clamped * segmentX,
    a[1] + clamped * segmentY,
  ]);
}

/** Distance from a point to a polygon: 0 when inside, else the nearest edge distance. */
export function distancePointToPolygon(point: Point, ring: Point[]): number {
  if (pointInPolygon(point, ring)) return 0;
  let nearest = Infinity;
  for (let index = 0; index < ring.length; index++) {
    const edgeDistance = distancePointToSegment(
      point,
      ring[index],
      ring[(index + 1) % ring.length],
    );
    if (edgeDistance < nearest) nearest = edgeDistance;
  }
  return nearest;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/mapBuild/geometry.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/cityArena/mapBuild
git add src/lib/cityArena/mapBuild
git commit -m "feat(arena): add polygon area, centroid, containment and distance helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Geometry — Douglas-Peucker simplification and rectangle clipping

**Files:**

- Modify: `src/lib/cityArena/mapBuild/geometry.ts` (append)
- Test: `src/lib/cityArena/mapBuild/geometry.test.ts` (append)

**Interfaces:**

- Produces: `simplifyPolyline(points, toleranceMetres): Point[]`, `simplifyRing(ring, toleranceMetres): Point[]`, `clipPolygonToRect(ring, rect): Point[]` (empty when nothing remains), `clipPolylineToRect(points, rect): Point[][]`, `rectsIntersect(a, b): boolean`.

- [ ] **Step 1: Append the failing tests**

```ts
// append to src/lib/cityArena/mapBuild/geometry.test.ts
import {
  clipPolygonToRect,
  clipPolylineToRect,
  rectsIntersect,
  simplifyPolyline,
  simplifyRing,
} from "./geometry";

describe("simplification and clipping", () => {
  it("collapses a nearly straight line to its endpoints", () => {
    const wobbly: Point[] = [
      [0, 0],
      [1, 0.001],
      [2, -0.002],
      [3, 0],
    ];
    expect(simplifyPolyline(wobbly, 0.5)).toEqual([
      [0, 0],
      [3, 0],
    ]);
  });

  it("keeps a corner that exceeds the tolerance", () => {
    const corner: Point[] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    expect(simplifyPolyline(corner, 0.5)).toEqual(corner);
  });

  it("simplifies a ring but never below three points", () => {
    const ring: Point[] = [
      [0, 0],
      [5, 0.01],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(simplifyRing(ring, 0.5)).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const triangle: Point[] = [
      [0, 0],
      [1, 0],
      [0, 1],
    ];
    expect(simplifyRing(triangle, 100)).toEqual(triangle);
  });

  it("clips a polygon to a rectangle", () => {
    const square: Point[] = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ];
    const clipped = clipPolygonToRect(square, {
      minX: 1,
      minY: -1,
      maxX: 3,
      maxY: 3,
    });
    expect(polygonArea(clipped)).toBeCloseTo(2);
    expect(
      clipPolygonToRect(square, { minX: 5, minY: 5, maxX: 6, maxY: 6 }),
    ).toEqual([]);
  });

  it("clips a polyline into pieces", () => {
    const rect = { minX: 0, minY: 0, maxX: 2, maxY: 1 };
    expect(
      clipPolylineToRect(
        [
          [-1, 0.5],
          [3, 0.5],
        ],
        rect,
      ),
    ).toEqual([
      [
        [0, 0.5],
        [2, 0.5],
      ],
    ]);
    const twoPasses: Point[] = [
      [-1, 0.5],
      [1, 0.5],
      [1, 5],
      [1.5, 5],
      [1.5, 0.5],
      [3, 0.5],
    ];
    expect(clipPolylineToRect(twoPasses, rect)).toHaveLength(2);
    expect(
      clipPolylineToRect(
        [
          [5, 5],
          [6, 6],
        ],
        rect,
      ),
    ).toEqual([]);
  });

  it("detects rectangle overlap", () => {
    expect(
      rectsIntersect(
        { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        { minX: 1, minY: 1, maxX: 2, maxY: 2 },
      ),
    ).toBe(true);
    expect(
      rectsIntersect(
        { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        { minX: 2, minY: 2, maxX: 3, maxY: 3 },
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/mapBuild/geometry.test.ts`
Expected: FAIL — `simplifyPolyline is not a function` (or missing export).

- [ ] **Step 3: Append the implementation**

```ts
// append to src/lib/cityArena/mapBuild/geometry.ts

/** True when two rectangles overlap or touch. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
  );
}

/** Douglas-Peucker simplification; endpoints are always kept. */
export function simplifyPolyline(
  points: Point[],
  toleranceMetres: number,
): Point[] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const pending: Array<[number, number]> = [[0, points.length - 1]];
  while (pending.length > 0) {
    const range = pending.pop();
    if (!range) break;
    const [start, end] = range;
    let farthestDistance = 0;
    let farthestIndex = -1;
    for (let index = start + 1; index < end; index++) {
      const candidate = distancePointToSegment(
        points[index],
        points[start],
        points[end],
      );
      if (candidate > farthestDistance) {
        farthestDistance = candidate;
        farthestIndex = index;
      }
    }
    if (farthestIndex === -1 || farthestDistance <= toleranceMetres) continue;
    keep[farthestIndex] = true;
    pending.push([start, farthestIndex], [farthestIndex, end]);
  }
  return points.filter((_, index) => keep[index]);
}

/** Simplifies a closed ring (first point not repeated); returns the input when < 3 points would remain. */
export function simplifyRing(ring: Point[], toleranceMetres: number): Point[] {
  if (ring.length <= 3) return ring.slice();
  const closed = simplifyPolyline([...ring, ring[0]], toleranceMetres);
  const open = closed.slice(0, -1);
  return open.length >= 3 ? open : ring.slice();
}

function intersectVertical(a: Point, b: Point, x: number): Point {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}

function intersectHorizontal(a: Point, b: Point, y: number): Point {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), y];
}

type ClipEdge = {
  inside: (point: Point) => boolean;
  intersect: (a: Point, b: Point) => Point;
};

/** Sutherland-Hodgman clipping of a ring against a rectangle; `[]` when nothing remains. */
export function clipPolygonToRect(ring: Point[], rect: Rect): Point[] {
  const edges: ClipEdge[] = [
    {
      inside: (p) => p[0] >= rect.minX,
      intersect: (a, b) => intersectVertical(a, b, rect.minX),
    },
    {
      inside: (p) => p[0] <= rect.maxX,
      intersect: (a, b) => intersectVertical(a, b, rect.maxX),
    },
    {
      inside: (p) => p[1] >= rect.minY,
      intersect: (a, b) => intersectHorizontal(a, b, rect.minY),
    },
    {
      inside: (p) => p[1] <= rect.maxY,
      intersect: (a, b) => intersectHorizontal(a, b, rect.maxY),
    },
  ];
  let output = ring;
  for (const edge of edges) {
    if (output.length === 0) return [];
    const input = output;
    output = [];
    for (let index = 0; index < input.length; index++) {
      const current = input[index];
      const previous = input[(index + input.length - 1) % input.length];
      const currentInside = edge.inside(current);
      const previousInside = edge.inside(previous);
      if (currentInside) {
        if (!previousInside) output.push(edge.intersect(previous, current));
        output.push(current);
      } else if (previousInside) {
        output.push(edge.intersect(previous, current));
      }
    }
  }
  return output.length >= 3 ? output : [];
}

/** Liang-Barsky clip of one segment; `null` when fully outside. */
function clipSegmentToRect(
  a: Point,
  b: Point,
  rect: Rect,
): [Point, Point] | null {
  const deltaX = b[0] - a[0];
  const deltaY = b[1] - a[1];
  let tEnter = 0;
  let tExit = 1;
  const checks: Array<[number, number]> = [
    [-deltaX, a[0] - rect.minX],
    [deltaX, rect.maxX - a[0]],
    [-deltaY, a[1] - rect.minY],
    [deltaY, rect.maxY - a[1]],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const ratio = q / p;
    if (p < 0) {
      if (ratio > tExit) return null;
      if (ratio > tEnter) tEnter = ratio;
    } else {
      if (ratio < tEnter) return null;
      if (ratio < tExit) tExit = ratio;
    }
  }
  const start: Point =
    tEnter === 0 ? a : [a[0] + tEnter * deltaX, a[1] + tEnter * deltaY];
  const end: Point =
    tExit === 1 ? b : [a[0] + tExit * deltaX, a[1] + tExit * deltaY];
  return [start, end];
}

/** Clips a polyline to a rectangle, returning the pieces that remain inside (each ≥ 2 points). */
export function clipPolylineToRect(points: Point[], rect: Rect): Point[][] {
  const pieces: Point[][] = [];
  let current: Point[] = [];
  for (let index = 0; index + 1 < points.length; index++) {
    const clipped = clipSegmentToRect(points[index], points[index + 1], rect);
    if (!clipped) {
      if (current.length >= 2) pieces.push(current);
      current = [];
      continue;
    }
    const [start, end] = clipped;
    if (current.length === 0) {
      current.push(start);
    } else {
      const last = current[current.length - 1];
      const continuous = last[0] === start[0] && last[1] === start[1];
      if (!continuous) {
        pieces.push(current);
        current = [start];
      }
    }
    current.push(end);
  }
  if (current.length >= 2) pieces.push(current);
  return pieces;
}
```

Also add `polygonArea` to the test file's first import if it is not already imported (it is, from Task 2).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/mapBuild/geometry.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/cityArena/mapBuild
git add src/lib/cityArena/mapBuild
git commit -m "feat(arena): add Douglas-Peucker simplification and rectangle clipping

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Overpass element types and query builders

**Files:**

- Create: `src/lib/cityArena/mapBuild/osmTypes.ts`
- Create: `src/lib/cityArena/mapBuild/overpassQueries.ts`
- Test: `src/lib/cityArena/mapBuild/overpassQueries.test.ts`

**Interfaces:**

- Consumes: `MAP_BBOX` from `../world/projection`.
- Produces: `OsmTags`, `OverpassNode`, `OverpassWay`, `OverpassRelation`, `OverpassElement`, `OverpassJson`, `LatLon`, `indexNodes(json): Map<number, OverpassNode>`, `indexWays(json): Map<number, OverpassWay>`, `osmElementId(element): string`; `OVERPASS_BBOX`, `DRIVABLE_HIGHWAY_REGEX`, `BUILDING_RADIUS_M = 1500`, `SERVICE_ROAD_RADIUS_M = 500`, `buildLandmarkQuery(nameMatches: string[]): string`, `buildRoadsQuery(serviceCentres: LatLon[]): string`, `buildAreasQuery(): string`, `buildBuildingsQuery(centres: LatLon[], extraElementIds: string[]): string`.

Ground note: `landuse=residential|industrial` are **not** fetched — they map to the default `urban` ground kind, which the renderer paints wherever no ground polygon exists (Task 7 stores only `grass`, `field`, `forest`).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/mapBuild/overpassQueries.test.ts
import { describe, expect, it } from "vitest";
import {
  BUILDING_RADIUS_M,
  OVERPASS_BBOX,
  buildAreasQuery,
  buildBuildingsQuery,
  buildLandmarkQuery,
  buildRoadsQuery,
} from "./overpassQueries";

describe("overpass query builders", () => {
  it("uses the region bbox in south,west,north,east order", () => {
    expect(OVERPASS_BBOX).toBe("51.94,5.53,52.02,5.72");
  });

  it("builds a case-insensitive name union for landmarks and escapes regex characters", () => {
    const query = buildLandmarkQuery(["Cunera", "'t Gastland (bad)"]);
    expect(query.startsWith("[out:json]")).toBe(true);
    expect(query).toContain(`nwr["name"~"Cunera",i](${OVERPASS_BBOX});`);
    expect(query).toContain(
      `nwr["name"~"'t Gastland \\\\(bad\\\\)",i](${OVERPASS_BBOX});`,
    );
    expect(query.trim().endsWith("out skel qt;")).toBe(true);
  });

  it("builds the roads query with drivable classes and service roads around each centre", () => {
    const query = buildRoadsQuery([
      { lat: 51.96, lon: 5.57 },
      { lat: 51.97, lon: 5.66 },
    ]);
    expect(query).toContain('way["highway"~"^(motorway|trunk|primary|');
    expect(query).toContain("living_street|pedestrian|motorway_link");
    expect(query.match(/\["highway"="service"\]\(around:500,/g)).toHaveLength(
      2,
    );
    expect(query).toContain("(around:500,51.96,5.57)");
  });

  it("builds the areas query for water and ground polygons only", () => {
    const query = buildAreasQuery();
    expect(query).toContain('nwr["natural"="water"]');
    expect(query).toContain(
      'nwr["landuse"~"^(grass|meadow|farmland|forest)$"]',
    );
    expect(query).toContain('nwr["leisure"~"^(park|pitch)$"]');
    expect(query).toContain('nwr["natural"~"^(wood|scrub)$"]');
    expect(query).not.toContain("residential");
  });

  it("builds the buildings query around centres plus explicit landmark elements", () => {
    const query = buildBuildingsQuery(
      [{ lat: 51.96, lon: 5.57 }],
      ["way/123", "way/456", "relation/7"],
    );
    expect(query).toContain(
      `nwr["building"](around:${BUILDING_RADIUS_M},51.96,5.57);`,
    );
    expect(query).toContain("way(id:123,456);");
    expect(query).toContain("relation(id:7);");
    expect(query).not.toContain("node(id:");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/mapBuild/overpassQueries.test.ts`
Expected: FAIL — `Cannot find module './overpassQueries'`.

- [ ] **Step 3: Create the element types**

```ts
// src/lib/cityArena/mapBuild/osmTypes.ts
/** Free-form OSM tag map. */
export type OsmTags = Record<string, string>;

/** A geographic coordinate in degrees. */
export type LatLon = { lat: number; lon: number };

/** Overpass `node` element (coordinates present with `out body`/`out skel`). */
export type OverpassNode = {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: OsmTags;
};

/** Overpass `way` element: ordered node ids. */
export type OverpassWay = {
  type: "way";
  id: number;
  nodes: number[];
  tags?: OsmTags;
};

/** Member of a relation. */
export type OverpassRelationMember = {
  type: "node" | "way" | "relation";
  ref: number;
  role: string;
};

/** Overpass `relation` element (multipolygons, etc.). */
export type OverpassRelation = {
  type: "relation";
  id: number;
  members: OverpassRelationMember[];
  tags?: OsmTags;
};

/** Any Overpass element. */
export type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

/** Top-level Overpass JSON response. */
export type OverpassJson = {
  version?: number;
  generator?: string;
  elements: OverpassElement[];
};

/** Indexes nodes by id for coordinate lookups. */
export function indexNodes(json: OverpassJson): Map<number, OverpassNode> {
  const nodes = new Map<number, OverpassNode>();
  for (const element of json.elements) {
    if (element.type === "node") nodes.set(element.id, element);
  }
  return nodes;
}

/** Indexes ways by id for relation member lookups. */
export function indexWays(json: OverpassJson): Map<number, OverpassWay> {
  const ways = new Map<number, OverpassWay>();
  for (const element of json.elements) {
    if (element.type === "way") ways.set(element.id, element);
  }
  return ways;
}

/** Canonical `"type/id"` string, matching osm2geojson-lite feature ids. */
export function osmElementId(element: OverpassElement): string {
  return `${element.type}/${element.id}`;
}
```

- [ ] **Step 4: Create the query builders**

```ts
// src/lib/cityArena/mapBuild/overpassQueries.ts
import { MAP_BBOX } from "../world/projection";
import type { LatLon } from "./osmTypes";

/** Overpass bbox filter argument: south,west,north,east. */
export const OVERPASS_BBOX = `${MAP_BBOX.south},${MAP_BBOX.west},${MAP_BBOX.north},${MAP_BBOX.east}`;

/** Highway classes the game treats as drivable (cycle and foot paths are excluded). */
export const DRIVABLE_HIGHWAY_REGEX =
  "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$";

/** Buildings are fetched within this radius of each zone centre. */
export const BUILDING_RADIUS_M = 1500;

/** Service roads (parking access) are fetched within this radius of each zone centre. */
export const SERVICE_ROAD_RADIUS_M = 500;

const HEADER = "[out:json][timeout:300];";
const OUTPUT = "out body;\n>;\nout skel qt;";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&");
}

function aroundClause(radiusMetres: number, centre: LatLon): string {
  return `(around:${radiusMetres},${centre.lat},${centre.lon})`;
}

function wrapUnion(statements: string[]): string {
  return `${HEADER}\n(\n${statements.map((statement) => `  ${statement}`).join("\n")}\n);\n${OUTPUT}\n`;
}

/** Everything in the bbox whose name contains one of the given fragments (case-insensitive). */
export function buildLandmarkQuery(nameMatches: string[]): string {
  return wrapUnion(
    nameMatches.map(
      (fragment) =>
        `nwr["name"~"${escapeRegex(fragment)}",i](${OVERPASS_BBOX});`,
    ),
  );
}

/** Drivable roads in the bbox plus service roads near each zone centre. */
export function buildRoadsQuery(serviceCentres: LatLon[]): string {
  return wrapUnion([
    `way["highway"~"${DRIVABLE_HIGHWAY_REGEX}"](${OVERPASS_BBOX});`,
    ...serviceCentres.map(
      (centre) =>
        `way["highway"="service"]${aroundClause(SERVICE_ROAD_RADIUS_M, centre)};`,
    ),
  ]);
}

/** Water and ground polygons for the whole bbox. */
export function buildAreasQuery(): string {
  return wrapUnion([
    `nwr["natural"="water"](${OVERPASS_BBOX});`,
    `nwr["landuse"~"^(grass|meadow|farmland|forest)$"](${OVERPASS_BBOX});`,
    `nwr["leisure"~"^(park|pitch)$"](${OVERPASS_BBOX});`,
    `nwr["natural"~"^(wood|scrub)$"](${OVERPASS_BBOX});`,
  ]);
}

/** Buildings near each zone centre plus explicitly listed landmark ways/relations. */
export function buildBuildingsQuery(
  centres: LatLon[],
  extraElementIds: string[],
): string {
  const wayIds: number[] = [];
  const relationIds: number[] = [];
  for (const elementId of extraElementIds) {
    const [type, rawId] = elementId.split("/");
    const id = Number(rawId);
    if (type === "way") wayIds.push(id);
    if (type === "relation") relationIds.push(id);
  }
  const statements = centres.map(
    (centre) => `nwr["building"]${aroundClause(BUILDING_RADIUS_M, centre)};`,
  );
  if (wayIds.length > 0) statements.push(`way(id:${wayIds.join(",")});`);
  if (relationIds.length > 0)
    statements.push(`relation(id:${relationIds.join(",")});`);
  return wrapUnion(statements);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/mapBuild/overpassQueries.test.ts`
Expected: PASS (5 tests). Backslash note: the produced query text must contain `\(` and `\)` (two backslashes) — Overpass QL unescapes string literals once, so the regex engine receives `(`. `escapeRegex` therefore emits two backslashes, and the test's template literal spells that as four.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/mapBuild
git add src/lib/cityArena/mapBuild
git commit -m "feat(arena): add Overpass element types and query builders

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Landmark configuration and exactly-one matching

**Files:**

- Create: `src/lib/cityArena/mapBuild/landmarks.config.ts`
- Create: `src/lib/cityArena/mapBuild/landmarks.ts`
- Test: `src/lib/cityArena/mapBuild/landmarks.test.ts`

**Interfaces:**

- Consumes: `OverpassJson`, `OverpassElement`, `LatLon`, `OsmTags`, `indexNodes`, `osmElementId` (Task 4); `projectLonLat`, `unprojectXY` (Task 1); `polygonCentroid`, `distance` (Task 2); `LandmarkStyle`, `ZoneKey` (Task 1).
- Produces: `LandmarkConfig`, `LANDMARKS: LandmarkConfig[]`, `MatchedLandmark = { config: LandmarkConfig; element: OverpassElement; center: LatLon }`, `LandmarkMatchResult = { matched: MatchedLandmark[]; errors: string[] }`, `elementCenter(element, nodesById, waysById): LatLon | null`, `matchLandmarks(json, config): LandmarkMatchResult`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/mapBuild/landmarks.test.ts
import { describe, expect, it } from "vitest";
import type { LandmarkConfig } from "./landmarks.config";
import { LANDMARKS } from "./landmarks.config";
import { elementCenter, matchLandmarks } from "./landmarks";
import type { OverpassJson } from "./osmTypes";
import { indexNodes, indexWays } from "./osmTypes";

const worship: LandmarkConfig = {
  key: "test-kerk",
  name: "Testkerk",
  nameMatch: "kerk",
  style: "church",
  matchesTags: (tags) => tags.amenity === "place_of_worship",
};

function squareWay(
  id: number,
  lat: number,
  lon: number,
  tags: Record<string, string>,
): OverpassJson["elements"] {
  const half = 0.0002;
  const base = id * 10;
  return [
    { type: "node", id: base + 1, lat: lat - half, lon: lon - half },
    { type: "node", id: base + 2, lat: lat - half, lon: lon + half },
    { type: "node", id: base + 3, lat: lat + half, lon: lon + half },
    { type: "node", id: base + 4, lat: lat + half, lon: lon - half },
    {
      type: "way",
      id,
      nodes: [base + 1, base + 2, base + 3, base + 4, base + 1],
      tags,
    },
  ];
}

describe("matchLandmarks", () => {
  it("matches exactly one element case-insensitively and returns its centre", () => {
    const json: OverpassJson = {
      elements: [
        ...squareWay(1, 51.97, 5.66, {
          amenity: "place_of_worship",
          name: "Grote KERK",
        }),
        ...squareWay(2, 51.97, 5.67, { building: "yes", name: "Kerkstraat 1" }),
      ],
    };
    const result = matchLandmarks(json, [worship]);
    expect(result.errors).toEqual([]);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].element.id).toBe(1);
    expect(result.matched[0].center.lat).toBeCloseTo(51.97, 5);
    expect(result.matched[0].center.lon).toBeCloseTo(5.66, 5);
  });

  it("reports zero matches as an error naming the key", () => {
    const result = matchLandmarks({ elements: [] }, [worship]);
    expect(result.matched).toEqual([]);
    expect(result.errors[0]).toContain("test-kerk");
    expect(result.errors[0]).toContain("no match");
  });

  it("reports ambiguous matches with candidate ids and names", () => {
    const json: OverpassJson = {
      elements: [
        ...squareWay(1, 51.97, 5.66, {
          amenity: "place_of_worship",
          name: "Oude Kerk",
        }),
        ...squareWay(2, 51.99, 5.67, {
          amenity: "place_of_worship",
          name: "Nieuwe Kerk",
        }),
      ],
    };
    const result = matchLandmarks(json, [worship]);
    expect(result.matched).toEqual([]);
    expect(result.errors[0]).toContain("way/1");
    expect(result.errors[0]).toContain("Nieuwe Kerk");
  });

  it("disambiguates with osmId and with a near filter", () => {
    const json: OverpassJson = {
      elements: [
        ...squareWay(1, 51.97, 5.66, {
          amenity: "place_of_worship",
          name: "Oude Kerk",
        }),
        ...squareWay(2, 51.99, 5.67, {
          amenity: "place_of_worship",
          name: "Nieuwe Kerk",
        }),
      ],
    };
    const byId = matchLandmarks(json, [{ ...worship, osmId: "way/2" }]);
    expect(byId.matched[0].element.id).toBe(2);
    const byNear = matchLandmarks(json, [
      { ...worship, near: { lat: 51.97, lon: 5.66, radiusM: 800 } },
    ]);
    expect(byNear.matched[0].element.id).toBe(1);
  });

  it("computes centres for nodes, ways and relations", () => {
    const json: OverpassJson = {
      elements: [
        { type: "node", id: 9, lat: 51.5, lon: 5.5, tags: { amenity: "cafe" } },
        ...squareWay(1, 51.97, 5.66, { building: "yes" }),
        {
          type: "relation",
          id: 3,
          members: [{ type: "way", ref: 1, role: "outer" }],
          tags: {},
        },
      ],
    };
    const nodes = indexNodes(json);
    const ways = indexWays(json);
    expect(elementCenter(json.elements[0], nodes, ways)).toEqual({
      lat: 51.5,
      lon: 5.5,
    });
    const wayCenter = elementCenter(json.elements[5], nodes, ways);
    expect(wayCenter?.lat).toBeCloseTo(51.97, 5);
    const relationCenter = elementCenter(json.elements[6], nodes, ways);
    expect(relationCenter?.lon).toBeCloseTo(5.66, 5);
  });

  it("ships the ten configured landmarks with four zone anchors", () => {
    expect(LANDMARKS).toHaveLength(10);
    const anchors = LANDMARKS.filter((landmark) => landmark.zoneAnchor).map(
      (l) => l.zoneAnchor,
    );
    expect(anchors.sort()).toEqual([
      "bennekom",
      "campus",
      "rhenen",
      "wageningen",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/mapBuild/landmarks.test.ts`
Expected: FAIL — `Cannot find module './landmarks.config'`.

- [ ] **Step 3: Write the landmark configuration**

```ts
// src/lib/cityArena/mapBuild/landmarks.config.ts
import type { LandmarkStyle, ZoneKey } from "../world/mapTypes";
import type { LatLon, OsmTags } from "./osmTypes";

/**
 * One recognisable place. `nameMatch` is a case-insensitive substring of the OSM `name`;
 * `matchesTags` narrows by tags; `near` restricts to a disc; `osmId` ("way/123") pins an exact
 * element when the build reports ambiguity. Exactly one element must match.
 */
export type LandmarkConfig = {
  key: string;
  name: string;
  nameMatch: string;
  style: LandmarkStyle;
  matchesTags: (tags: OsmTags) => boolean;
  zoneAnchor?: ZoneKey;
  near?: LatLon & { radiusM: number };
  osmId?: string;
};

const isPlaceOfWorship = (tags: OsmTags): boolean =>
  tags.amenity === "place_of_worship" || tags.building === "church";
const isPool = (tags: OsmTags): boolean =>
  tags.leisure === "sports_centre" || tags.leisure === "swimming_pool";
const isUniversity = (tags: OsmTags): boolean =>
  tags.amenity === "university" || tags.building === "university";
const isCafe = (tags: OsmTags): boolean =>
  ["cafe", "bar", "pub", "restaurant"].includes(tags.amenity ?? "");

const WAGENINGEN_MARKT: LatLon = { lat: 51.9693, lon: 5.6656 };
const BENNEKOM_DORPSSTRAAT: LatLon = { lat: 51.9993, lon: 5.676 };

/** The landmark table from the design spec §3.2. */
export const LANDMARKS: LandmarkConfig[] = [
  {
    key: "cunerakerk",
    name: "Cunerakerk",
    nameMatch: "Cunera",
    style: "church",
    matchesTags: isPlaceOfWorship,
    zoneAnchor: "rhenen",
  },
  {
    key: "gastland",
    name: "Zwembad 't Gastland",
    nameMatch: "Gastland",
    style: "pool",
    matchesTags: isPool,
  },
  {
    key: "grote-kerk-wageningen",
    name: "Grote Kerk",
    nameMatch: "Grote Kerk",
    style: "church",
    matchesTags: isPlaceOfWorship,
    zoneAnchor: "wageningen",
    near: { ...WAGENINGEN_MARKT, radiusM: 800 },
  },
  {
    key: "onder-de-linden",
    name: "Café Onder de Linden",
    nameMatch: "Onder de Linden",
    style: "cafe",
    matchesTags: isCafe,
  },
  {
    key: "de-bongerd",
    name: "Zwembad De Bongerd",
    nameMatch: "Bongerd",
    style: "pool",
    matchesTags: isPool,
  },
  {
    key: "wur-forum",
    name: "WUR Forum",
    nameMatch: "Forum",
    style: "campus",
    matchesTags: isUniversity,
    zoneAnchor: "campus",
  },
  {
    key: "wur-orion",
    name: "WUR Orion",
    nameMatch: "Orion",
    style: "campus",
    matchesTags: isUniversity,
  },
  {
    key: "wur-atlas",
    name: "WUR Atlas",
    nameMatch: "Atlas",
    style: "campus",
    matchesTags: isUniversity,
  },
  {
    key: "oude-kerk-bennekom",
    name: "Oude Kerk",
    nameMatch: "Oude Kerk",
    style: "church",
    matchesTags: isPlaceOfWorship,
    zoneAnchor: "bennekom",
    near: { ...BENNEKOM_DORPSSTRAAT, radiusM: 800 },
  },
  {
    key: "vrije-slag",
    name: "Zwembad De Vrije Slag",
    nameMatch: "Vrije Slag",
    style: "pool",
    matchesTags: isPool,
  },
];
```

- [ ] **Step 4: Write the matcher**

```ts
// src/lib/cityArena/mapBuild/landmarks.ts
import { projectLonLat, unprojectXY, type Point } from "../world/projection";
import { distance, polygonCentroid } from "./geometry";
import type { LandmarkConfig } from "./landmarks.config";
import {
  indexNodes,
  indexWays,
  osmElementId,
  type LatLon,
  type OverpassElement,
  type OverpassJson,
  type OverpassNode,
  type OverpassWay,
} from "./osmTypes";

/** A landmark resolved to one OSM element. */
export type MatchedLandmark = {
  config: LandmarkConfig;
  element: OverpassElement;
  center: LatLon;
};

/** Result of matching every configured landmark. */
export type LandmarkMatchResult = {
  matched: MatchedLandmark[];
  errors: string[];
};

function wayCoordinates(
  way: OverpassWay,
  nodesById: Map<number, OverpassNode>,
): LatLon[] {
  const coordinates: LatLon[] = [];
  for (const nodeId of way.nodes) {
    const node = nodesById.get(nodeId);
    if (node) coordinates.push({ lat: node.lat, lon: node.lon });
  }
  return coordinates;
}

function centroidOf(coordinates: LatLon[]): LatLon | null {
  if (coordinates.length === 0) return null;
  const projected: Point[] = coordinates.map((c) =>
    projectLonLat(c.lon, c.lat),
  );
  const [x, y] =
    projected.length >= 3 ? polygonCentroid(projected) : projected[0];
  return unprojectXY(x, y);
}

/** Representative centre: the node itself, a way's centroid, or a relation's member centroid. */
export function elementCenter(
  element: OverpassElement,
  nodesById: Map<number, OverpassNode>,
  waysById: Map<number, OverpassWay>,
): LatLon | null {
  if (element.type === "node") return { lat: element.lat, lon: element.lon };
  if (element.type === "way") {
    const ring = wayCoordinates(element, nodesById);
    const isClosed =
      ring.length > 1 &&
      element.nodes[0] === element.nodes[element.nodes.length - 1];
    return centroidOf(isClosed ? ring.slice(0, -1) : ring);
  }
  const memberCoordinates: LatLon[] = [];
  for (const member of element.members) {
    if (member.type === "node") {
      const node = nodesById.get(member.ref);
      if (node) memberCoordinates.push({ lat: node.lat, lon: node.lon });
    }
    if (member.type === "way") {
      const way = waysById.get(member.ref);
      if (way) memberCoordinates.push(...wayCoordinates(way, nodesById));
    }
  }
  if (memberCoordinates.length === 0) return null;
  const sumLat = memberCoordinates.reduce((total, c) => total + c.lat, 0);
  const sumLon = memberCoordinates.reduce((total, c) => total + c.lon, 0);
  return {
    lat: sumLat / memberCoordinates.length,
    lon: sumLon / memberCoordinates.length,
  };
}

function metresBetween(a: LatLon, b: LatLon): number {
  return distance(projectLonLat(a.lon, a.lat), projectLonLat(b.lon, b.lat));
}

function describeCandidate(element: OverpassElement, center: LatLon): string {
  const name = element.tags?.name ?? "(naamloos)";
  return `${osmElementId(element)} "${name}" @ ${center.lat.toFixed(5)},${center.lon.toFixed(5)}`;
}

/** Resolves each landmark to exactly one element; every failure becomes a human-readable error. */
export function matchLandmarks(
  json: OverpassJson,
  config: LandmarkConfig[],
): LandmarkMatchResult {
  const nodesById = indexNodes(json);
  const waysById = indexWays(json);
  const matched: MatchedLandmark[] = [];
  const errors: string[] = [];

  for (const landmark of config) {
    const fragment = landmark.nameMatch.toLowerCase();
    const candidates: MatchedLandmark[] = [];
    for (const element of json.elements) {
      const tags = element.tags;
      if (!tags) continue;
      if (landmark.osmId && osmElementId(element) !== landmark.osmId) continue;
      if (!landmark.osmId) {
        const name = tags.name?.toLowerCase() ?? "";
        if (!name.includes(fragment) || !landmark.matchesTags(tags)) continue;
      }
      const center = elementCenter(element, nodesById, waysById);
      if (!center) continue;
      if (
        landmark.near &&
        metresBetween(center, landmark.near) > landmark.near.radiusM
      )
        continue;
      candidates.push({ config: landmark, element, center });
    }
    if (candidates.length === 1) {
      matched.push(candidates[0]);
      continue;
    }
    if (candidates.length === 0) {
      errors.push(
        `Landmark "${landmark.key}": no match for name ~ "${landmark.nameMatch}"`,
      );
      continue;
    }
    const listing = candidates
      .map((c) => describeCandidate(c.element, c.center))
      .join("; ");
    errors.push(
      `Landmark "${landmark.key}": ${candidates.length} candidates, add osmId to pin one: ${listing}`,
    );
  }
  return { matched, errors };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/mapBuild/landmarks.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/mapBuild
git add src/lib/cityArena/mapBuild
git commit -m "feat(arena): add landmark table and exactly-one OSM matching

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Road ways, road graph and flat encoding

**Files:**

- Create: `src/lib/cityArena/mapBuild/roads.ts`
- Test: `src/lib/cityArena/mapBuild/roads.test.ts`

**Interfaces:**

- Consumes: `RoadClass`, `MapRoads`, `ROAD_EDGE_STRIDE` (Task 1); `projectLonLat`, `toUnits`, `Point` (Task 1); `distance`, `simplifyPolyline` (Tasks 2–3); `OsmTags`, `OverpassJson`, `indexNodes` (Task 4).
- Produces: `RoadWay = { id; cls: RoadClass; name?: string; oneway: boolean; nodeIds: number[] }`, `roadClassOf(tags): RoadClass | null`, `parseRoadWays(json): RoadWay[]`, `projectNodeCoordinates(json): Map<number, Point>`, `RoadGraph = { nodes: Point[]; edges: RoadEdge[] }`, `RoadEdge = { a; b; cls; name?; oneway; length }`, `buildRoadGraph(ways, nodeCoords, shapeSpacingMetres = 20): RoadGraph`, `RenderRoad = { points: Point[]; cls: RoadClass; name?: string }`, `renderRoads(ways, nodeCoords, toleranceMetres = 0.5): RenderRoad[]`, `encodeRoads(graph): MapRoads`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/mapBuild/roads.test.ts
import { describe, expect, it } from "vitest";
import { ROAD_EDGE_STRIDE } from "../world/mapTypes";
import type { Point } from "../world/projection";
import type { OverpassJson } from "./osmTypes";
import {
  buildRoadGraph,
  encodeRoads,
  parseRoadWays,
  projectNodeCoordinates,
  renderRoads,
  roadClassOf,
} from "./roads";

const junctionJson: OverpassJson = {
  elements: [
    { type: "node", id: 1, lat: 51.98, lon: 5.625 },
    { type: "node", id: 2, lat: 51.98, lon: 5.626 },
    { type: "node", id: 3, lat: 51.98, lon: 5.627 },
    { type: "node", id: 4, lat: 51.981, lon: 5.626 },
    {
      type: "way",
      id: 10,
      nodes: [1, 2, 3],
      tags: { highway: "residential", name: "Dorpsstraat" },
    },
    {
      type: "way",
      id: 11,
      nodes: [2, 4],
      tags: { highway: "tertiary_link", oneway: "yes" },
    },
    { type: "way", id: 12, nodes: [3, 4], tags: { highway: "footway" } },
  ],
};

describe("roadClassOf", () => {
  it("collapses link roads and rejects non-drivable classes", () => {
    expect(roadClassOf({ highway: "primary_link" })).toBe("primary");
    expect(roadClassOf({ highway: "residential" })).toBe("residential");
    expect(roadClassOf({ highway: "footway" })).toBeNull();
    expect(roadClassOf({})).toBeNull();
  });
});

describe("parseRoadWays", () => {
  it("keeps drivable ways with class, name and oneway", () => {
    const ways = parseRoadWays(junctionJson);
    expect(ways.map((way) => way.id)).toEqual([10, 11]);
    expect(ways[0]).toMatchObject({
      cls: "residential",
      name: "Dorpsstraat",
      oneway: false,
    });
    expect(ways[1]).toMatchObject({ cls: "tertiary", oneway: true });
  });

  it("reverses node order for oneway=-1", () => {
    const json: OverpassJson = {
      elements: [
        {
          type: "way",
          id: 1,
          nodes: [1, 2, 3],
          tags: { highway: "residential", oneway: "-1" },
        },
      ],
    };
    expect(parseRoadWays(json)[0]).toMatchObject({
      nodeIds: [3, 2, 1],
      oneway: true,
    });
  });
});

describe("buildRoadGraph", () => {
  it("creates vertices at endpoints and junctions with one edge per span", () => {
    const coords = projectNodeCoordinates(junctionJson);
    const graph = buildRoadGraph(parseRoadWays(junctionJson), coords);
    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(3);
    const lengths = graph.edges.map((edge) => Math.round(edge.length));
    expect(lengths[0]).toBe(69);
    expect(graph.edges[2]).toMatchObject({ cls: "tertiary", oneway: true });
  });

  it("inserts shape vertices every twenty metres along long straight ways", () => {
    const coords = new Map<number, Point>();
    const nodeIds: number[] = [];
    for (let index = 0; index <= 20; index++) {
      coords.set(index, [index * 5, 0]);
      nodeIds.push(index);
    }
    const graph = buildRoadGraph(
      [{ id: 1, cls: "residential", oneway: false, nodeIds }],
      coords,
    );
    expect(graph.nodes).toHaveLength(6);
    expect(graph.edges).toHaveLength(5);
    expect(graph.edges.every((edge) => Math.abs(edge.length - 20) < 1e-9)).toBe(
      true,
    );
  });
});

describe("renderRoads and encodeRoads", () => {
  it("simplifies render geometry and keeps class and name", () => {
    const coords = projectNodeCoordinates(junctionJson);
    const rendered = renderRoads(parseRoadWays(junctionJson), coords);
    expect(rendered).toHaveLength(2);
    expect(rendered[0].points).toHaveLength(2);
    expect(rendered[0].name).toBe("Dorpsstraat");
  });

  it("encodes the graph as flat unit arrays with lookup tables", () => {
    const coords = new Map<number, Point>([
      [1, [0, 0]],
      [2, [20, 0]],
    ]);
    const encoded = encodeRoads(
      buildRoadGraph(
        [
          {
            id: 1,
            cls: "primary",
            name: "N225",
            oneway: true,
            nodeIds: [1, 2],
          },
        ],
        coords,
      ),
    );
    expect(encoded.nodes).toEqual([0, 0, 80, 0]);
    expect(encoded.edges).toHaveLength(ROAD_EDGE_STRIDE);
    expect(encoded.edges).toEqual([0, 1, 0, 0, 1, 80]);
    expect(encoded.classes).toEqual(["primary"]);
    expect(encoded.names).toEqual(["N225"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/mapBuild/roads.test.ts`
Expected: FAIL — `Cannot find module './roads'`.

- [ ] **Step 3: Implement roads.ts**

```ts
// src/lib/cityArena/mapBuild/roads.ts
import {
  ROAD_EDGE_STRIDE,
  type MapRoads,
  type RoadClass,
} from "../world/mapTypes";
import { projectLonLat, toUnits, type Point } from "../world/projection";
import { distance, simplifyPolyline } from "./geometry";
import { indexNodes, type OsmTags, type OverpassJson } from "./osmTypes";

/** A drivable OSM way with its node id chain. */
export type RoadWay = {
  id: number;
  cls: RoadClass;
  name?: string;
  oneway: boolean;
  nodeIds: number[];
};

/** Edge between two graph vertices (indices into `RoadGraph.nodes`), length in metres. */
export type RoadEdge = {
  a: number;
  b: number;
  cls: RoadClass;
  name?: string;
  oneway: boolean;
  length: number;
};

/** Road network for routing: vertices at junctions, endpoints and ≥ 20 m shape points. */
export type RoadGraph = { nodes: Point[]; edges: RoadEdge[] };

/** Full simplified centre line for drawing. */
export type RenderRoad = { points: Point[]; cls: RoadClass; name?: string };

const ROAD_CLASSES: RoadClass[] = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "pedestrian",
  "service",
];

/** Maps an OSM `highway` value to a game road class (`*_link` → base class), or `null`. */
export function roadClassOf(tags: OsmTags): RoadClass | null {
  const highway = tags.highway;
  if (!highway) return null;
  const base = highway.endsWith("_link")
    ? highway.slice(0, -"_link".length)
    : highway;
  return ROAD_CLASSES.find((cls) => cls === base) ?? null;
}

/** Extracts drivable ways; `oneway=-1` is normalised by reversing the node order. */
export function parseRoadWays(json: OverpassJson): RoadWay[] {
  const ways: RoadWay[] = [];
  for (const element of json.elements) {
    if (element.type !== "way" || !element.tags || element.nodes.length < 2)
      continue;
    const cls = roadClassOf(element.tags);
    if (!cls) continue;
    const onewayTag = element.tags.oneway;
    const reversed = onewayTag === "-1";
    const oneway = reversed || onewayTag === "yes" || onewayTag === "1";
    ways.push({
      id: element.id,
      cls,
      name: element.tags.name,
      oneway,
      nodeIds: reversed ? [...element.nodes].reverse() : [...element.nodes],
    });
  }
  return ways;
}

/** Projects every node in the response to metres, keyed by OSM node id. */
export function projectNodeCoordinates(json: OverpassJson): Map<number, Point> {
  const coordinates = new Map<number, Point>();
  for (const [id, node] of indexNodes(json)) {
    coordinates.set(id, projectLonLat(node.lon, node.lat));
  }
  return coordinates;
}

function wayPoints(
  way: RoadWay,
  nodeCoords: Map<number, Point>,
): Point[] | null {
  const points: Point[] = [];
  for (const nodeId of way.nodeIds) {
    const point = nodeCoords.get(nodeId);
    if (!point) return null;
    points.push(point);
  }
  return points;
}

/**
 * Builds the routing graph. A node becomes a vertex when it is a way endpoint, is referenced by
 * more than one way (junction), or lies ≥ `shapeSpacingMetres` along the way since the previous
 * vertex. Ways with missing node coordinates are skipped.
 */
export function buildRoadGraph(
  ways: RoadWay[],
  nodeCoords: Map<number, Point>,
  shapeSpacingMetres = 20,
): RoadGraph {
  const referenceCount = new Map<number, number>();
  for (const way of ways) {
    for (const nodeId of way.nodeIds) {
      referenceCount.set(nodeId, (referenceCount.get(nodeId) ?? 0) + 1);
    }
  }
  const nodes: Point[] = [];
  const edges: RoadEdge[] = [];
  const vertexByNodeId = new Map<number, number>();
  const vertexFor = (nodeId: number, point: Point): number => {
    const existing = vertexByNodeId.get(nodeId);
    if (existing !== undefined) return existing;
    nodes.push(point);
    vertexByNodeId.set(nodeId, nodes.length - 1);
    return nodes.length - 1;
  };

  for (const way of ways) {
    const points = wayPoints(way, nodeCoords);
    if (!points) continue;
    let previousVertex = vertexFor(way.nodeIds[0], points[0]);
    let accumulated = 0;
    for (let index = 1; index < points.length; index++) {
      accumulated += distance(points[index - 1], points[index]);
      const nodeId = way.nodeIds[index];
      const isJunction = (referenceCount.get(nodeId) ?? 0) >= 2;
      const isEnd = index === points.length - 1;
      if (!isJunction && !isEnd && accumulated < shapeSpacingMetres) continue;
      const vertex = vertexFor(nodeId, points[index]);
      if (vertex !== previousVertex) {
        edges.push({
          a: previousVertex,
          b: vertex,
          cls: way.cls,
          name: way.name,
          oneway: way.oneway,
          length: accumulated,
        });
      }
      previousVertex = vertex;
      accumulated = 0;
    }
  }
  return { nodes, edges };
}

/** Simplified centre lines for tile rendering. */
export function renderRoads(
  ways: RoadWay[],
  nodeCoords: Map<number, Point>,
  toleranceMetres = 0.5,
): RenderRoad[] {
  const rendered: RenderRoad[] = [];
  for (const way of ways) {
    const points = wayPoints(way, nodeCoords);
    if (!points) continue;
    rendered.push({
      points: simplifyPolyline(points, toleranceMetres),
      cls: way.cls,
      name: way.name,
    });
  }
  return rendered;
}

/** Encodes the graph into the `roads.json` flat layout (units, lookup tables). */
export function encodeRoads(graph: RoadGraph): MapRoads {
  const classes: RoadClass[] = [];
  const names: string[] = [];
  const classIndex = (cls: RoadClass): number => {
    const existing = classes.indexOf(cls);
    if (existing !== -1) return existing;
    classes.push(cls);
    return classes.length - 1;
  };
  const nameIndex = (name: string | undefined): number => {
    if (!name) return -1;
    const existing = names.indexOf(name);
    if (existing !== -1) return existing;
    names.push(name);
    return names.length - 1;
  };
  const nodes: number[] = [];
  for (const [x, y] of graph.nodes) nodes.push(toUnits(x), toUnits(y));
  const edges: number[] = [];
  for (const edge of graph.edges) {
    edges.push(
      edge.a,
      edge.b,
      classIndex(edge.cls),
      nameIndex(edge.name),
      edge.oneway ? 1 : 0,
      toUnits(edge.length),
    );
  }
  if (edges.length % ROAD_EDGE_STRIDE !== 0) {
    throw new Error("encodeRoads produced a malformed edge array");
  }
  return { nodes, edges, classes, names };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/mapBuild/roads.test.ts`
Expected: PASS (8 tests). The `69` metre expectation is the projected distance of 0.001° longitude at 51.98° N (≈ 68.6 m rounded); if it reads 68, change the assertion to accept 68 or 69 — the point of the test is one edge per span, not the metre.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/cityArena/mapBuild
git add src/lib/cityArena/mapBuild
git commit -m "feat(arena): build the drivable road graph from OSM ways

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Area extraction (buildings, water, ground) via osm2geojson-lite

**Files:**

- Modify: `package.json` (devDependency `osm2geojson-lite@2.0.1`), `package-lock.json`
- Create: `src/lib/cityArena/mapBuild/areas.ts`
- Test: `src/lib/cityArena/mapBuild/areas.test.ts`

**Interfaces:**

- Consumes: `GroundKind` (Task 1); `OsmTags`, `LatLon`, `OverpassJson` (Task 4).
- Produces: `AreaFeature = { id: string; tags: OsmTags; ring: LatLon[] }` (outer ring, closing point removed), `GroundArea = AreaFeature & { kind: Exclude<GroundKind, "urban"> }`, `ExtractedAreas = { buildings: AreaFeature[]; water: AreaFeature[]; ground: GroundArea[] }`, `groundKindOf(tags): Exclude<GroundKind, "urban"> | null`, `extractAreas(json): ExtractedAreas`.

- [ ] **Step 1: Install the converter**

Run: `npm install --save-dev osm2geojson-lite@2.0.1`
Expected: `package.json` devDependencies gains `"osm2geojson-lite": "2.0.1"` (pin exactly; edit the caret away if npm adds one) and `package-lock.json` updates. Verify with `node -e "console.log(require('osm2geojson-lite/package.json').version)"` → `2.0.1`.

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/cityArena/mapBuild/areas.test.ts
import { describe, expect, it } from "vitest";
import { extractAreas, groundKindOf } from "./areas";
import type { OverpassJson } from "./osmTypes";

const sample: OverpassJson = {
  elements: [
    { type: "node", id: 1, lat: 51.98, lon: 5.625 },
    { type: "node", id: 2, lat: 51.98, lon: 5.6253 },
    { type: "node", id: 3, lat: 51.9802, lon: 5.6253 },
    { type: "node", id: 4, lat: 51.9802, lon: 5.625 },
    {
      type: "way",
      id: 100,
      nodes: [1, 2, 3, 4, 1],
      tags: { building: "yes", "building:levels": "3", name: "Grote Kerk" },
    },
    {
      type: "node",
      id: 5,
      lat: 51.9801,
      lon: 5.6251,
      tags: { amenity: "cafe", name: "Café Onder de Linden" },
    },
    { type: "node", id: 6, lat: 51.981, lon: 5.625 },
    { type: "way", id: 101, nodes: [4, 6], tags: { highway: "residential" } },
    { type: "node", id: 10, lat: 51.99, lon: 5.63 },
    { type: "node", id: 11, lat: 51.99, lon: 5.631 },
    { type: "node", id: 12, lat: 51.991, lon: 5.631 },
    { type: "node", id: 13, lat: 51.991, lon: 5.63 },
    { type: "way", id: 200, nodes: [10, 11, 12, 13, 10] },
    { type: "node", id: 20, lat: 51.9903, lon: 5.6303 },
    { type: "node", id: 21, lat: 51.9903, lon: 5.6306 },
    { type: "node", id: 22, lat: 51.9906, lon: 5.6306 },
    { type: "node", id: 23, lat: 51.9906, lon: 5.6303 },
    { type: "way", id: 201, nodes: [20, 21, 22, 23, 20] },
    {
      type: "relation",
      id: 300,
      members: [
        { type: "way", ref: 200, role: "outer" },
        { type: "way", ref: 201, role: "inner" },
      ],
      tags: { type: "multipolygon", natural: "water", name: "Plas" },
    },
    { type: "node", id: 30, lat: 51.95, lon: 5.6 },
    { type: "node", id: 31, lat: 51.95, lon: 5.601 },
    { type: "node", id: 32, lat: 51.951, lon: 5.601 },
    {
      type: "way",
      id: 400,
      nodes: [30, 31, 32, 30],
      tags: { landuse: "farmland" },
    },
    {
      type: "way",
      id: 401,
      nodes: [30, 31, 32, 30],
      tags: { building: "no", landuse: "grass" },
    },
  ],
};

describe("groundKindOf", () => {
  it("maps land use to ground kinds and ignores the rest", () => {
    expect(groundKindOf({ landuse: "grass" })).toBe("grass");
    expect(groundKindOf({ leisure: "park" })).toBe("grass");
    expect(groundKindOf({ landuse: "farmland" })).toBe("field");
    expect(groundKindOf({ landuse: "meadow" })).toBe("field");
    expect(groundKindOf({ landuse: "forest" })).toBe("forest");
    expect(groundKindOf({ natural: "wood" })).toBe("forest");
    expect(groundKindOf({ landuse: "residential" })).toBeNull();
  });
});

describe("extractAreas", () => {
  it("extracts building, water (outer ring only) and ground polygons; skips points and lines", () => {
    const areas = extractAreas(sample);
    expect(areas.buildings).toHaveLength(1);
    expect(areas.buildings[0]).toMatchObject({
      id: "way/100",
      tags: { "building:levels": "3" },
    });
    expect(areas.buildings[0].ring).toHaveLength(4);
    expect(areas.water).toHaveLength(1);
    expect(areas.water[0].id).toBe("relation/300");
    expect(areas.water[0].ring).toHaveLength(4);
    expect(areas.ground.map((ground) => ground.kind).sort()).toEqual([
      "field",
      "grass",
    ]);
  });

  it("treats building=no as not a building", () => {
    const areas = extractAreas(sample);
    expect(areas.buildings.some((building) => building.id === "way/401")).toBe(
      false,
    );
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/mapBuild/areas.test.ts`
Expected: FAIL — `Cannot find module './areas'`.

- [ ] **Step 4: Implement areas.ts**

```ts
// src/lib/cityArena/mapBuild/areas.ts
import osm2geojson from "osm2geojson-lite";
import type { GroundKind } from "../world/mapTypes";
import type { LatLon, OsmTags, OverpassJson } from "./osmTypes";

/** A polygon feature reduced to its outer ring (closing point removed) and its tags. */
export type AreaFeature = { id: string; tags: OsmTags; ring: LatLon[] };

/** Ground polygon with a non-default fill kind. */
export type GroundArea = AreaFeature & { kind: Exclude<GroundKind, "urban"> };

/** Buildings, water and ground polygons extracted from one Overpass response. */
export type ExtractedAreas = {
  buildings: AreaFeature[];
  water: AreaFeature[];
  ground: GroundArea[];
};

type GeoFeature = ReturnType<typeof osm2geojson>["features"][number];

/** Land-use → ground kind; `null` for the implicit `urban` default and unrelated tags. */
export function groundKindOf(
  tags: OsmTags,
): Exclude<GroundKind, "urban"> | null {
  if (
    tags.landuse === "grass" ||
    tags.leisure === "park" ||
    tags.leisure === "pitch"
  )
    return "grass";
  if (tags.landuse === "farmland" || tags.landuse === "meadow") return "field";
  if (
    tags.landuse === "forest" ||
    tags.natural === "wood" ||
    tags.natural === "scrub"
  )
    return "forest";
  return null;
}

function tagsFromProperties(properties: unknown): OsmTags {
  const tags: OsmTags = {};
  if (typeof properties !== "object" || properties === null) return tags;
  for (const [key, value] of Object.entries(properties)) {
    if (key === "id") continue;
    if (typeof value === "string") tags[key] = value;
  }
  return tags;
}

function ringFromPositions(positions: number[][]): LatLon[] {
  const ring: LatLon[] = positions.map(([lon, lat]) => ({ lat, lon }));
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && first.lat === last.lat && first.lon === last.lon)
    ring.pop();
  return ring;
}

function outerRings(feature: GeoFeature): number[][][] {
  const geometry = feature.geometry;
  if (geometry.type === "Polygon") return [geometry.coordinates[0]];
  if (geometry.type === "MultiPolygon")
    return geometry.coordinates.map((polygon) => polygon[0]);
  return [];
}

/** Converts an Overpass response to classified outer-ring polygons. */
export function extractAreas(json: OverpassJson): ExtractedAreas {
  const collection = osm2geojson(json, {
    completeFeature: true,
    renderTagged: true,
    excludeWay: true,
  });
  const areas: ExtractedAreas = { buildings: [], water: [], ground: [] };
  for (const feature of collection.features) {
    const rings = outerRings(feature);
    if (rings.length === 0) continue;
    const tags = tagsFromProperties(feature.properties);
    const baseId =
      typeof feature.id === "string"
        ? feature.id
        : String(feature.id ?? "unknown");
    rings.forEach((positions, index) => {
      const ring = ringFromPositions(positions);
      if (ring.length < 3) return;
      const id = rings.length === 1 ? baseId : `${baseId}#${index}`;
      const area: AreaFeature = { id, tags, ring };
      if (tags.building && tags.building !== "no") {
        areas.buildings.push(area);
        return;
      }
      if (
        tags.natural === "water" ||
        tags.landuse === "reservoir" ||
        tags.landuse === "basin"
      ) {
        areas.water.push(area);
        return;
      }
      const kind = groundKindOf(tags);
      if (kind) areas.ground.push({ ...area, kind });
    });
  }
  return areas;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/mapBuild/areas.test.ts`
Expected: PASS (3 tests). If TypeScript complains that `geometry.coordinates` is not on `GeometryObject`, narrow with `if (geometry.type === "Polygon")` exactly as written — the discriminated union in the bundled GeoJSON types narrows on `type`.

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
npx prettier --write src/lib/cityArena/mapBuild package.json
git add package.json package-lock.json src/lib/cityArena/mapBuild
git commit -m "feat(arena): extract building, water and ground polygons from OSM

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Zones — centres from anchors, spawn nodes, connectivity

**Files:**

- Create: `src/lib/cityArena/mapBuild/errors.ts`
- Create: `src/lib/cityArena/mapBuild/zones.ts`
- Test: `src/lib/cityArena/mapBuild/zones.test.ts`

**Interfaces:**

- Consumes: `MapZone`, `ZoneKey` (Task 1); `toUnits`, `Point` (Task 1); `boundsOf`, `distance`, `distancePointToPolygon`, `rectsIntersect`, `Rect` (Tasks 2–3); `RoadGraph` (Task 6).
- Produces: `MapBuildError` (class), `ZONE_RADIUS_M = 500`, `ZONE_NAMES: Record<ZoneKey, string>`, `ZONE_ORDER: ZoneKey[]`, `ZoneCentre = { key: ZoneKey; center: Point }`, `ProjectedLandmark = { key: string; center: Point; zoneAnchor?: ZoneKey }`, `ObstaclePolygon = { ring: Point[]; bounds: Rect }`, `indexObstacles(rings: Point[][]): ObstaclePolygon[]`, `zoneCentresFromLandmarks(landmarks): ZoneCentre[]`, `computeSpawnNodes(graph, center, radiusMetres, buildings, water): Point[]`, `checkZoneConnectivity(graph, center, radiusMetres): { ok: boolean; largestShare: number; edgeCount: number }`, `buildZones(centres, graph, landmarks, buildings, water): MapZone[]` (units).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/mapBuild/zones.test.ts
import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import { MapBuildError } from "./errors";
import type { RoadGraph } from "./roads";
import {
  ZONE_RADIUS_M,
  buildZones,
  checkZoneConnectivity,
  computeSpawnNodes,
  indexObstacles,
  zoneCentresFromLandmarks,
  type ProjectedLandmark,
} from "./zones";

const anchors: ProjectedLandmark[] = [
  { key: "cunerakerk", center: [-4000, 2000], zoneAnchor: "rhenen" },
  {
    key: "grote-kerk-wageningen",
    center: [2700, 1150],
    zoneAnchor: "wageningen",
  },
  { key: "wur-forum", center: [2650, -600], zoneAnchor: "campus" },
  { key: "oude-kerk-bennekom", center: [3500, -2150], zoneAnchor: "bennekom" },
];

function lineGraph(points: Point[]): RoadGraph {
  const edges = points.slice(1).map((_, index) => ({
    a: index,
    b: index + 1,
    cls: "residential" as const,
    oneway: false,
    length: 20,
  }));
  return { nodes: points, edges };
}

describe("zoneCentresFromLandmarks", () => {
  it("returns the four anchors in canonical order", () => {
    const centres = zoneCentresFromLandmarks(anchors);
    expect(centres.map((zone) => zone.key)).toEqual([
      "rhenen",
      "wageningen",
      "campus",
      "bennekom",
    ]);
    expect(centres[0].center).toEqual([-4000, 2000]);
  });

  it("throws a MapBuildError naming missing anchors", () => {
    expect(() => zoneCentresFromLandmarks(anchors.slice(0, 2))).toThrow(
      MapBuildError,
    );
    expect(() => zoneCentresFromLandmarks(anchors.slice(0, 2))).toThrow(
      /campus.*bennekom|bennekom.*campus/,
    );
  });
});

describe("computeSpawnNodes", () => {
  it("keeps road nodes inside the disc that are clear of buildings and water", () => {
    const graph = lineGraph([
      [0, 0],
      [20, 0],
      [40, 0],
      [900, 0],
    ]);
    const buildings = indexObstacles([
      [
        [15, 3],
        [25, 3],
        [25, 13],
        [15, 13],
      ],
    ]);
    const water = indexObstacles([
      [
        [38, -3],
        [42, -3],
        [42, -8],
        [38, -8],
      ],
    ]);
    expect(
      computeSpawnNodes(graph, [0, 0], ZONE_RADIUS_M, buildings, water),
    ).toEqual([[0, 0]]);
  });
});

describe("checkZoneConnectivity", () => {
  it("passes for one connected component", () => {
    const graph = lineGraph([
      [0, 0],
      [20, 0],
      [40, 0],
    ]);
    expect(checkZoneConnectivity(graph, [0, 0], 500)).toEqual({
      ok: true,
      largestShare: 1,
      edgeCount: 2,
    });
  });

  it("fails when the network inside the disc is split in half", () => {
    const graph: RoadGraph = {
      nodes: [
        [0, 0],
        [20, 0],
        [100, 100],
        [120, 100],
      ],
      edges: [
        { a: 0, b: 1, cls: "residential", oneway: false, length: 20 },
        { a: 2, b: 3, cls: "residential", oneway: false, length: 20 },
      ],
    };
    const result = checkZoneConnectivity(graph, [0, 0], 500);
    expect(result.ok).toBe(false);
    expect(result.largestShare).toBe(0.5);
  });
});

describe("buildZones", () => {
  it("emits zones in units with landmark keys inside the disc", () => {
    const graph = lineGraph([
      [-4000, 2000],
      [-3980, 2000],
    ]);
    const landmarks: ProjectedLandmark[] = [
      ...anchors,
      { key: "gastland", center: [-3700, 2100] },
      { key: "far-away", center: [9000, 9000] },
    ];
    const zones = buildZones(
      zoneCentresFromLandmarks(anchors),
      graph,
      landmarks,
      [],
      [],
      {
        requireConnectivity: false,
      },
    );
    expect(zones[0]).toMatchObject({
      key: "rhenen",
      name: "Rhenen centrum",
      center: [-16000, 8000],
      radius: 2000,
    });
    expect(zones[0].landmarks.sort()).toEqual(["cunerakerk", "gastland"]);
    expect(zones[0].spawnNodes).toEqual([
      [-16000, 8000],
      [-15920, 8000],
    ]);
  });

  it("throws when a zone's road network is not connected enough", () => {
    const graph: RoadGraph = {
      nodes: [
        [-4000, 2000],
        [-3980, 2000],
        [-3900, 2100],
        [-3880, 2100],
      ],
      edges: [
        { a: 0, b: 1, cls: "residential", oneway: false, length: 20 },
        { a: 2, b: 3, cls: "residential", oneway: false, length: 20 },
      ],
    };
    expect(() =>
      buildZones(zoneCentresFromLandmarks(anchors), graph, anchors, [], []),
    ).toThrow(/rhenen.*connected/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/mapBuild/zones.test.ts`
Expected: FAIL — `Cannot find module './errors'`.

- [ ] **Step 3: Implement errors.ts and zones.ts**

```ts
// src/lib/cityArena/mapBuild/errors.ts
/** A validation failure in the map build; the message is meant for the terminal. */
export class MapBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapBuildError";
  }
}
```

```ts
// src/lib/cityArena/mapBuild/zones.ts
import type { MapZone, ZoneKey } from "../world/mapTypes";
import { toUnits, type Point } from "../world/projection";
import { MapBuildError } from "./errors";
import {
  boundsOf,
  distance,
  distancePointToPolygon,
  rectsIntersect,
  type Rect,
} from "./geometry";
import type { RoadGraph } from "./roads";

/** Match zone radius in metres. */
export const ZONE_RADIUS_M = 500;

/** Spawn nodes must keep this distance from building footprints. */
export const SPAWN_MIN_BUILDING_DISTANCE_M = 8;

/** Spawn nodes must keep this distance from water. */
export const SPAWN_MIN_WATER_DISTANCE_M = 6;

/** Minimum share of in-zone edges that must belong to the largest connected component. */
export const MIN_CONNECTED_EDGE_SHARE = 0.95;

/** Dutch display names of the zones. */
export const ZONE_NAMES: Record<ZoneKey, string> = {
  rhenen: "Rhenen centrum",
  wageningen: "Wageningen centrum",
  campus: "WUR-campus",
  bennekom: "Bennekom",
};

/** Canonical zone order for the index and the UI. */
export const ZONE_ORDER: ZoneKey[] = [
  "rhenen",
  "wageningen",
  "campus",
  "bennekom",
];

/** Zone centre in metres. */
export type ZoneCentre = { key: ZoneKey; center: Point };

/** A landmark projected to metres. */
export type ProjectedLandmark = {
  key: string;
  center: Point;
  zoneAnchor?: ZoneKey;
};

/** A polygon obstacle with a precomputed bounding rectangle for cheap rejection. */
export type ObstaclePolygon = { ring: Point[]; bounds: Rect };

/** Options for {@link buildZones}. */
export type BuildZonesOptions = { requireConnectivity?: boolean };

/** Precomputes bounds for obstacle rings. */
export function indexObstacles(rings: Point[][]): ObstaclePolygon[] {
  return rings.map((ring) => ({ ring, bounds: boundsOf(ring) }));
}

/** Zone centres are the centroids of their anchor landmarks; every zone needs one. */
export function zoneCentresFromLandmarks(
  landmarks: ProjectedLandmark[],
): ZoneCentre[] {
  const centres: ZoneCentre[] = [];
  const missing: ZoneKey[] = [];
  for (const key of ZONE_ORDER) {
    const anchor = landmarks.find((landmark) => landmark.zoneAnchor === key);
    if (!anchor) {
      missing.push(key);
      continue;
    }
    centres.push({ key, center: anchor.center });
  }
  if (missing.length > 0) {
    throw new MapBuildError(`Zone anchors missing for: ${missing.join(", ")}`);
  }
  return centres;
}

function isClearOf(
  point: Point,
  obstacles: ObstaclePolygon[],
  minimumDistance: number,
): boolean {
  const probe: Rect = {
    minX: point[0] - minimumDistance,
    minY: point[1] - minimumDistance,
    maxX: point[0] + minimumDistance,
    maxY: point[1] + minimumDistance,
  };
  for (const obstacle of obstacles) {
    if (!rectsIntersect(probe, obstacle.bounds)) continue;
    if (distancePointToPolygon(point, obstacle.ring) < minimumDistance)
      return false;
  }
  return true;
}

/** Road-graph vertices inside the disc that are clear of buildings and water. */
export function computeSpawnNodes(
  graph: RoadGraph,
  center: Point,
  radiusMetres: number,
  buildings: ObstaclePolygon[],
  water: ObstaclePolygon[],
): Point[] {
  const spawns: Point[] = [];
  for (const node of graph.nodes) {
    if (distance(node, center) > radiusMetres) continue;
    if (!isClearOf(node, buildings, SPAWN_MIN_BUILDING_DISTANCE_M)) continue;
    if (!isClearOf(node, water, SPAWN_MIN_WATER_DISTANCE_M)) continue;
    spawns.push(node);
  }
  return spawns;
}

class UnionFind {
  private readonly parent = new Map<number, number>();

  find(item: number): number {
    let root = item;
    while ((this.parent.get(root) ?? root) !== root)
      root = this.parent.get(root) ?? root;
    let current = item;
    while (current !== root) {
      const next = this.parent.get(current) ?? current;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

/** Share of in-disc edges (either endpoint inside) that belong to the largest component. */
export function checkZoneConnectivity(
  graph: RoadGraph,
  center: Point,
  radiusMetres: number,
): { ok: boolean; largestShare: number; edgeCount: number } {
  const inDisc = (vertex: number): boolean =>
    distance(graph.nodes[vertex], center) <= radiusMetres;
  const edges = graph.edges.filter((edge) => inDisc(edge.a) || inDisc(edge.b));
  if (edges.length === 0) return { ok: false, largestShare: 0, edgeCount: 0 };
  const components = new UnionFind();
  for (const edge of edges) components.union(edge.a, edge.b);
  const sizes = new Map<number, number>();
  for (const edge of edges) {
    const root = components.find(edge.a);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }
  const largest = Math.max(...sizes.values());
  const largestShare = largest / edges.length;
  return {
    ok: largestShare >= MIN_CONNECTED_EDGE_SHARE,
    largestShare,
    edgeCount: edges.length,
  };
}

/** Assembles `MapZone`s in asset units; throws when a zone's roads are too fragmented. */
export function buildZones(
  centres: ZoneCentre[],
  graph: RoadGraph,
  landmarks: ProjectedLandmark[],
  buildings: ObstaclePolygon[],
  water: ObstaclePolygon[],
  options: BuildZonesOptions = {},
): MapZone[] {
  const requireConnectivity = options.requireConnectivity ?? true;
  return centres.map((zone) => {
    if (requireConnectivity) {
      const connectivity = checkZoneConnectivity(
        graph,
        zone.center,
        ZONE_RADIUS_M,
      );
      if (!connectivity.ok) {
        throw new MapBuildError(
          `Zone ${zone.key}: road network not connected enough (largest component ${(connectivity.largestShare * 100).toFixed(1)} % of ${connectivity.edgeCount} edges)`,
        );
      }
    }
    const spawnNodes = computeSpawnNodes(
      graph,
      zone.center,
      ZONE_RADIUS_M,
      buildings,
      water,
    );
    const landmarkKeys = landmarks
      .filter(
        (landmark) => distance(landmark.center, zone.center) <= ZONE_RADIUS_M,
      )
      .map((landmark) => landmark.key);
    return {
      key: zone.key,
      name: ZONE_NAMES[zone.key],
      center: [toUnits(zone.center[0]), toUnits(zone.center[1])],
      radius: toUnits(ZONE_RADIUS_M),
      spawnNodes: spawnNodes.map(
        ([x, y]) => [toUnits(x), toUnits(y)] as [number, number],
      ),
      landmarks: landmarkKeys,
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/mapBuild/zones.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/cityArena/mapBuild
git add src/lib/cityArena/mapBuild
git commit -m "feat(arena): derive match zones, spawn nodes and connectivity checks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Tiling — bounds, tile grid, clipping and quantisation

**Files:**

- Create: `src/lib/cityArena/mapBuild/tiles.ts`
- Test: `src/lib/cityArena/mapBuild/tiles.test.ts`

**Interfaces:**

- Consumes: `GroundKind`, `MapBounds`, `MapTile` (Task 1); `MAP_BBOX`, `projectLonLat`, `toUnits`, `Point` (Task 1); `boundsOf`, `clipPolygonToRect`, `clipPolylineToRect`, `rectsIntersect`, `Rect` (Tasks 2–3); `RenderRoad` (Task 6).
- Produces: `TILE_SIZE_M = 2000`, `TILE_OVERLAP_M = 20`, `TileCoord = { x; y }`, `ProjectedBuilding = { ring: Point[]; levels: number; landmark?: string }`, `ProjectedGround = { ring: Point[]; kind: Exclude<GroundKind, "urban"> }`, `ProjectedWater = { ring: Point[] }`, `regionBoundsMetres(): Rect`, `boundsToUnits(bounds): MapBounds`, `tileCoordFor(point, bounds): TileCoord`, `tileRect(coord, bounds, overlapMetres?): Rect`, `tilesCovering(rect, bounds): TileCoord[]`, `tileFileName(coord): string`, `flattenUnits(points): number[]`, `buildTiles(bounds, roads, buildings, ground, water): MapTile[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/cityArena/mapBuild/tiles.test.ts
import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import type { RenderRoad } from "./roads";
import {
  TILE_SIZE_M,
  buildTiles,
  flattenUnits,
  regionBoundsMetres,
  tileCoordFor,
  tileFileName,
  tileRect,
  tilesCovering,
} from "./tiles";

const bounds = { minX: 0, minY: 0, maxX: 6000, maxY: 4000 };

describe("tile grid", () => {
  it("covers the region with a 7 × 5 grid of 2 km tiles", () => {
    const region = regionBoundsMetres();
    expect(region.maxX - region.minX).toBeGreaterThan(12_900);
    expect(region.maxX - region.minX).toBeLessThan(13_100);
    expect(region.maxY - region.minY).toBeGreaterThan(8_800);
    expect(region.maxY - region.minY).toBeLessThan(8_900);
    expect(Math.ceil((region.maxX - region.minX) / TILE_SIZE_M)).toBe(7);
    expect(Math.ceil((region.maxY - region.minY) / TILE_SIZE_M)).toBe(5);
  });

  it("maps points to tile coordinates and expands tile rects by the overlap", () => {
    expect(tileCoordFor([10, 10], bounds)).toEqual({ x: 0, y: 0 });
    expect(tileCoordFor([2000, 3999], bounds)).toEqual({ x: 1, y: 1 });
    expect(tileRect({ x: 1, y: 0 }, bounds)).toEqual({
      minX: 1980,
      minY: -20,
      maxX: 4020,
      maxY: 2020,
    });
    expect(tileFileName({ x: 3, y: 1 })).toBe("tile_3_1.json");
  });

  it("lists every tile a rectangle touches, including via overlap", () => {
    expect(
      tilesCovering({ minX: 100, minY: 100, maxX: 200, maxY: 200 }, bounds),
    ).toEqual([{ x: 0, y: 0 }]);
    expect(
      tilesCovering({ minX: 1990, minY: 100, maxX: 1995, maxY: 200 }, bounds),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it("flattens points to integer units", () => {
    expect(
      flattenUnits([
        [0.1, 0.3],
        [1, -2],
      ]),
    ).toEqual([0, 1, 4, -8]);
  });
});

describe("buildTiles", () => {
  const road: RenderRoad = {
    points: [
      [100, 100],
      [3900, 100],
    ],
    cls: "primary",
    name: "N225",
  };
  const building = {
    ring: [
      [1990, 500],
      [2010, 500],
      [2010, 520],
      [1990, 520],
    ] as Point[],
    levels: 3,
    landmark: "cunerakerk",
  };

  it("splits roads across tiles and clips buildings into each tile they touch", () => {
    const tiles = buildTiles(bounds, [road], [building], [], []);
    expect(tiles.map((tile) => [tile.x, tile.y])).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(tiles[0].roads[0]).toMatchObject({ cls: "primary", name: "N225" });
    expect(tiles[0].roads[0].pts).toEqual([400, 400, 8080, 400]);
    expect(tiles[0].buildings[0]).toMatchObject({
      levels: 3,
      landmark: "cunerakerk",
    });
    expect(tiles[0].buildings[0].pts).toHaveLength(8);
    expect(tiles[1].buildings).toHaveLength(1);
  });

  it("omits empty tiles and keeps ground kind and water", () => {
    const tiles = buildTiles(
      bounds,
      [],
      [],
      [
        {
          ring: [
            [5000, 3000],
            [5100, 3000],
            [5100, 3100],
          ],
          kind: "forest",
        },
      ],
      [
        {
          ring: [
            [5000, 3200],
            [5100, 3200],
            [5100, 3300],
          ],
        },
      ],
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ x: 2, y: 1 });
    expect(tiles[0].ground[0].kind).toBe("forest");
    expect(tiles[0].water[0].pts).toEqual([
      20000, 12800, 20400, 12800, 20400, 13200,
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/mapBuild/tiles.test.ts`
Expected: FAIL — `Cannot find module './tiles'`.

- [ ] **Step 3: Implement tiles.ts**

```ts
// src/lib/cityArena/mapBuild/tiles.ts
import type { GroundKind, MapBounds, MapTile } from "../world/mapTypes";
import {
  MAP_BBOX,
  projectLonLat,
  toUnits,
  type Point,
} from "../world/projection";
import {
  boundsOf,
  clipPolygonToRect,
  clipPolylineToRect,
  rectsIntersect,
  type Rect,
} from "./geometry";
import type { RenderRoad } from "./roads";

/** Tile edge length in metres. */
export const TILE_SIZE_M = 2000;

/** Geometry is clipped to tiles expanded by this margin so seams never show. */
export const TILE_OVERLAP_M = 20;

/** Grid coordinate of a tile (0-based from the north-west corner of the bounds). */
export type TileCoord = { x: number; y: number };

/** Building footprint in metres with its render attributes. */
export type ProjectedBuilding = {
  ring: Point[];
  levels: number;
  landmark?: string;
};

/** Ground polygon in metres. */
export type ProjectedGround = {
  ring: Point[];
  kind: Exclude<GroundKind, "urban">;
};

/** Water polygon in metres. */
export type ProjectedWater = { ring: Point[] };

/** Region bounds in metres derived from the bbox corners (north is the smaller y). */
export function regionBoundsMetres(): Rect {
  const [minX] = projectLonLat(MAP_BBOX.west, MAP_BBOX.south);
  const [maxX] = projectLonLat(MAP_BBOX.east, MAP_BBOX.south);
  const [, minY] = projectLonLat(MAP_BBOX.west, MAP_BBOX.north);
  const [, maxY] = projectLonLat(MAP_BBOX.west, MAP_BBOX.south);
  return { minX, minY, maxX, maxY };
}

/** Converts metre bounds to asset units. */
export function boundsToUnits(bounds: Rect): MapBounds {
  return {
    minX: toUnits(bounds.minX),
    minY: toUnits(bounds.minY),
    maxX: toUnits(bounds.maxX),
    maxY: toUnits(bounds.maxY),
  };
}

/** Tile containing a point. */
export function tileCoordFor(point: Point, bounds: Rect): TileCoord {
  return {
    x: Math.floor((point[0] - bounds.minX) / TILE_SIZE_M),
    y: Math.floor((point[1] - bounds.minY) / TILE_SIZE_M),
  };
}

/** Rectangle of a tile expanded by the overlap margin. */
export function tileRect(
  coord: TileCoord,
  bounds: Rect,
  overlapMetres = TILE_OVERLAP_M,
): Rect {
  const minX = bounds.minX + coord.x * TILE_SIZE_M;
  const minY = bounds.minY + coord.y * TILE_SIZE_M;
  return {
    minX: minX - overlapMetres,
    minY: minY - overlapMetres,
    maxX: minX + TILE_SIZE_M + overlapMetres,
    maxY: minY + TILE_SIZE_M + overlapMetres,
  };
}

/** All tiles whose expanded rectangle intersects `rect`, row-major. */
export function tilesCovering(rect: Rect, bounds: Rect): TileCoord[] {
  const first = tileCoordFor(
    [rect.minX - TILE_OVERLAP_M, rect.minY - TILE_OVERLAP_M],
    bounds,
  );
  const last = tileCoordFor(
    [rect.maxX + TILE_OVERLAP_M, rect.maxY + TILE_OVERLAP_M],
    bounds,
  );
  const coords: TileCoord[] = [];
  for (let y = Math.max(0, first.y); y <= last.y; y++) {
    for (let x = Math.max(0, first.x); x <= last.x; x++) {
      const coord = { x, y };
      if (rectsIntersect(rect, tileRect(coord, bounds))) coords.push(coord);
    }
  }
  return coords;
}

/** File name of a tile inside the asset directory. */
export function tileFileName(coord: TileCoord): string {
  return `tile_${coord.x}_${coord.y}.json`;
}

/** Flattens points to `[x0, y0, x1, y1, …]` in integer units. */
export function flattenUnits(points: Point[]): number[] {
  const flat: number[] = [];
  for (const [x, y] of points) flat.push(toUnits(x), toUnits(y));
  return flat;
}

/** Distributes all geometry into non-empty tiles, clipping to each tile's expanded rectangle. */
export function buildTiles(
  bounds: Rect,
  roads: RenderRoad[],
  buildings: ProjectedBuilding[],
  ground: ProjectedGround[],
  water: ProjectedWater[],
): MapTile[] {
  const tiles = new Map<string, MapTile>();
  const tileFor = (coord: TileCoord): MapTile => {
    const key = `${coord.x}:${coord.y}`;
    const existing = tiles.get(key);
    if (existing) return existing;
    const created: MapTile = {
      x: coord.x,
      y: coord.y,
      roads: [],
      buildings: [],
      ground: [],
      water: [],
    };
    tiles.set(key, created);
    return created;
  };

  for (const road of roads) {
    if (road.points.length < 2) continue;
    for (const coord of tilesCovering(boundsOf(road.points), bounds)) {
      for (const piece of clipPolylineToRect(
        road.points,
        tileRect(coord, bounds),
      )) {
        tileFor(coord).roads.push({
          pts: flattenUnits(piece),
          cls: road.cls,
          name: road.name,
        });
      }
    }
  }
  for (const building of buildings) {
    for (const coord of tilesCovering(boundsOf(building.ring), bounds)) {
      const clipped = clipPolygonToRect(building.ring, tileRect(coord, bounds));
      if (clipped.length === 0) continue;
      tileFor(coord).buildings.push({
        pts: flattenUnits(clipped),
        levels: building.levels,
        ...(building.landmark ? { landmark: building.landmark } : {}),
      });
    }
  }
  for (const area of ground) {
    for (const coord of tilesCovering(boundsOf(area.ring), bounds)) {
      const clipped = clipPolygonToRect(area.ring, tileRect(coord, bounds));
      if (clipped.length > 0)
        tileFor(coord).ground.push({
          pts: flattenUnits(clipped),
          kind: area.kind,
        });
    }
  }
  for (const area of water) {
    for (const coord of tilesCovering(boundsOf(area.ring), bounds)) {
      const clipped = clipPolygonToRect(area.ring, tileRect(coord, bounds));
      if (clipped.length > 0)
        tileFor(coord).water.push({ pts: flattenUnits(clipped) });
    }
  }

  return [...tiles.values()].sort(
    (left, right) => left.y - right.y || left.x - right.x,
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/mapBuild/tiles.test.ts`
Expected: PASS (6 tests). The road in tile 0 is clipped at the expanded edge `x = 2020` → `8080` units; the building at x 1990–2010 lands in both tiles because tile 1's expanded rect starts at 1980.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/cityArena/mapBuild
git add src/lib/cityArena/mapBuild
git commit -m "feat(arena): tile map geometry into 2 km tiles with overlap

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Synthetic fixture and pure assembly

**Files:**

- Create: `src/lib/cityArena/mapBuild/fixtures/overpassMini.ts`
- Create: `src/lib/cityArena/mapBuild/assemble.ts`
- Test: `src/lib/cityArena/mapBuild/assemble.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–9 (`matchLandmarks`, `extractAreas`, `parseRoadWays`, `projectNodeCoordinates`, `buildRoadGraph`, `renderRoads`, `encodeRoads`, `zoneCentresFromLandmarks`, `buildZones`, `indexObstacles`, `regionBoundsMetres`, `boundsToUnits`, `buildTiles`, `tileCoordFor`, `tileFileName`, `TILE_SIZE_M`, `simplifyRing`, `polygonArea`, `polygonCentroid`, `pointInPolygon`, `distancePointToPolygon`, `distance`, `projectLonLat`, `toUnits`, `MAP_ORIGIN`, `MAP_UNITS_PER_METRE`, `osmElementId`, `MapBuildError`).
- Produces: `overpassMini: OverpassJson`, `MINI_LANDMARKS: LandmarkConfig[]` (fixture); `AssembleInput = { landmarkOsm; roadsOsm; areasOsm; buildingsOsm; config: LandmarkConfig[]; generatedAt: string }`, `AssembledMap = { index: MapIndex; roads: MapRoads; tiles: MapTile[] }`, `MIN_BUILDING_AREA_M2 = 30`, `BUILDING_KEEP_RADIUS_M = 1500`, `LANDMARK_ATTACH_DISTANCE_M = 15`, `DEFAULT_BUILDING_LEVELS = 2`, `assembleMap(input): AssembledMap`.

- [ ] **Step 1: Write the fixture**

```ts
// src/lib/cityArena/mapBuild/fixtures/overpassMini.ts
import type { LandmarkConfig } from "../landmarks.config";
import type { OsmTags, OverpassElement, OverpassJson } from "../osmTypes";

const DEGREES_PER_METRE_LAT = 1 / 110_574;
const DEGREES_PER_METRE_LON = 1 / (111_320 * Math.cos((51.98 * Math.PI) / 180));

/** A closed square way of `sideMetres` centred on (lat, lon); node ids are `wayId * 10 + n`. */
export function squareWay(
  wayId: number,
  lat: number,
  lon: number,
  sideMetres: number,
  tags?: OsmTags,
): OverpassElement[] {
  const halfLat = (sideMetres / 2) * DEGREES_PER_METRE_LAT;
  const halfLon = (sideMetres / 2) * DEGREES_PER_METRE_LON;
  const base = wayId * 10;
  const way: OverpassElement = {
    type: "way",
    id: wayId,
    nodes: [base + 1, base + 2, base + 3, base + 4, base + 1],
    ...(tags ? { tags } : {}),
  };
  return [
    { type: "node", id: base + 1, lat: lat - halfLat, lon: lon - halfLon },
    { type: "node", id: base + 2, lat: lat - halfLat, lon: lon + halfLon },
    { type: "node", id: base + 3, lat: lat + halfLat, lon: lon + halfLon },
    { type: "node", id: base + 4, lat: lat + halfLat, lon: lon - halfLon },
    way,
  ];
}

/** A road of consecutive nodes offset east of (lat, lon) by `spacingMetres` each. */
export function roadWay(
  wayId: number,
  lat: number,
  lon: number,
  nodeCount: number,
  spacingMetres: number,
  tags: OsmTags,
): OverpassElement[] {
  const base = wayId * 10;
  const nodes: OverpassElement[] = [];
  const ids: number[] = [];
  for (let index = 0; index < nodeCount; index++) {
    ids.push(base + index);
    nodes.push({
      type: "node",
      id: base + index,
      lat,
      lon: lon + index * spacingMetres * DEGREES_PER_METRE_LON,
    });
  }
  return [...nodes, { type: "way", id: wayId, nodes: ids, tags }];
}

const RHENEN = { lat: 51.958, lon: 5.569 };
const WAGENINGEN = { lat: 51.9693, lon: 5.6656 };
const CAMPUS = { lat: 51.9855, lon: 5.664 };
const BENNEKOM = { lat: 51.9993, lon: 5.676 };

/**
 * One payload that serves every build stage: four anchor buildings, a café inside a building,
 * one short road per zone, a shed (too small), a far building (outside 1.5 km), water and farmland.
 */
export const overpassMini: OverpassJson = {
  elements: [
    ...squareWay(1, RHENEN.lat, RHENEN.lon, 30, {
      amenity: "place_of_worship",
      building: "church",
      name: "Cunerakerk",
      "building:levels": "4",
    }),
    ...squareWay(2, WAGENINGEN.lat, WAGENINGEN.lon, 30, {
      amenity: "place_of_worship",
      building: "church",
      name: "Grote Kerk",
    }),
    ...squareWay(3, CAMPUS.lat, CAMPUS.lon, 40, {
      amenity: "university",
      building: "yes",
      name: "Forum",
    }),
    ...squareWay(4, BENNEKOM.lat, BENNEKOM.lon, 30, {
      amenity: "place_of_worship",
      building: "church",
      name: "Oude Kerk",
    }),
    ...squareWay(5, WAGENINGEN.lat + 0.001, WAGENINGEN.lon, 20, {
      building: "yes",
    }),
    {
      type: "node",
      id: 500,
      lat: WAGENINGEN.lat + 0.001,
      lon: WAGENINGEN.lon,
      tags: { amenity: "cafe", name: "Café Onder de Linden" },
    },
    ...squareWay(6, WAGENINGEN.lat, WAGENINGEN.lon + 0.002, 4, {
      building: "shed",
    }),
    ...squareWay(7, 51.945, 5.6, 20, { building: "yes", name: "Ver weg" }),
    ...roadWay(11, RHENEN.lat + 0.0005, RHENEN.lon, 3, 40, {
      highway: "residential",
      name: "Herenstraat",
    }),
    ...roadWay(12, WAGENINGEN.lat + 0.0005, WAGENINGEN.lon, 3, 40, {
      highway: "residential",
      name: "Dorpsstraat",
    }),
    ...roadWay(13, CAMPUS.lat + 0.0005, CAMPUS.lon, 3, 40, {
      highway: "tertiary",
      name: "Droevendaalsesteeg",
    }),
    ...roadWay(14, BENNEKOM.lat + 0.0005, BENNEKOM.lon, 3, 40, {
      highway: "residential",
      name: "Dorpsstraat",
    }),
    ...squareWay(20, 51.95, 5.62, 200, { natural: "water", name: "Plas" }),
    ...squareWay(21, 51.99, 5.6, 300, { landuse: "farmland" }),
  ],
};

/** Landmark subset matching the fixture (the four anchors plus the café). */
export const MINI_LANDMARKS: LandmarkConfig[] = [
  {
    key: "cunerakerk",
    name: "Cunerakerk",
    nameMatch: "Cunera",
    style: "church",
    matchesTags: (tags) => tags.amenity === "place_of_worship",
    zoneAnchor: "rhenen",
  },
  {
    key: "grote-kerk-wageningen",
    name: "Grote Kerk",
    nameMatch: "Grote Kerk",
    style: "church",
    matchesTags: (tags) => tags.amenity === "place_of_worship",
    zoneAnchor: "wageningen",
  },
  {
    key: "wur-forum",
    name: "WUR Forum",
    nameMatch: "Forum",
    style: "campus",
    matchesTags: (tags) => tags.amenity === "university",
    zoneAnchor: "campus",
  },
  {
    key: "oude-kerk-bennekom",
    name: "Oude Kerk",
    nameMatch: "Oude Kerk",
    style: "church",
    matchesTags: (tags) => tags.amenity === "place_of_worship",
    zoneAnchor: "bennekom",
  },
  {
    key: "onder-de-linden",
    name: "Café Onder de Linden",
    nameMatch: "Onder de Linden",
    style: "cafe",
    matchesTags: (tags) => tags.amenity === "cafe",
  },
];
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/cityArena/mapBuild/assemble.test.ts
import { describe, expect, it } from "vitest";
import { assembleMap } from "./assemble";
import { MapBuildError } from "./errors";
import { MINI_LANDMARKS, overpassMini } from "./fixtures/overpassMini";

const input = {
  landmarkOsm: overpassMini,
  roadsOsm: overpassMini,
  areasOsm: overpassMini,
  buildingsOsm: overpassMini,
  config: MINI_LANDMARKS,
  generatedAt: "2026-09-03T12:00:00.000Z",
};

describe("assembleMap", () => {
  it("produces an index with four ordered zones and all landmarks", () => {
    const { index } = assembleMap(input);
    expect(index.version).toBe(1);
    expect(index.generatedAt).toBe("2026-09-03T12:00:00.000Z");
    expect(index.zones.map((zone) => zone.key)).toEqual([
      "rhenen",
      "wageningen",
      "campus",
      "bennekom",
    ]);
    expect(index.landmarks.map((landmark) => landmark.key).sort()).toEqual([
      "cunerakerk",
      "grote-kerk-wageningen",
      "onder-de-linden",
      "oude-kerk-bennekom",
      "wur-forum",
    ]);
    expect(index.zones[1].landmarks.sort()).toEqual([
      "grote-kerk-wageningen",
      "onder-de-linden",
    ]);
    expect(index.tileSize).toBe(8000);
    expect(index.tiles.length).toBeGreaterThan(0);
  });

  it("keeps large nearby buildings, drops sheds and far buildings, and attaches landmarks", () => {
    const { tiles } = assembleMap(input);
    const buildings = tiles.flatMap((tile) => tile.buildings);
    expect(buildings).toHaveLength(5);
    const church = buildings.find(
      (building) => building.landmark === "cunerakerk",
    );
    expect(church?.levels).toBe(4);
    expect(
      buildings.find((building) => building.landmark === "onder-de-linden"),
    ).toBeDefined();
    expect(buildings.filter((building) => building.levels === 2)).toHaveLength(
      4,
    );
  });

  it("encodes the road graph and copies street names into tiles", () => {
    const { roads, tiles } = assembleMap(input);
    expect(roads.names).toContain("Dorpsstraat");
    expect(roads.names).toContain("Droevendaalsesteeg");
    expect(roads.edges.length % 6).toBe(0);
    const tileRoadNames = tiles.flatMap((tile) =>
      tile.roads.map((road) => road.name),
    );
    expect(tileRoadNames).toContain("Herenstraat");
  });

  it("places water and ground polygons", () => {
    const { tiles } = assembleMap(input);
    expect(tiles.some((tile) => tile.water.length > 0)).toBe(true);
    expect(
      tiles.some((tile) =>
        tile.ground.some((ground) => ground.kind === "field"),
      ),
    ).toBe(true);
  });

  it("throws a MapBuildError listing landmark problems", () => {
    const broken = {
      ...input,
      config: [
        ...MINI_LANDMARKS,
        {
          key: "ghost",
          name: "Ghost",
          nameMatch: "Spookhuis",
          style: "cafe" as const,
          matchesTags: () => true,
        },
      ],
    };
    expect(() => assembleMap(broken)).toThrow(MapBuildError);
    expect(() => assembleMap(broken)).toThrow(/ghost/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cityArena/mapBuild/assemble.test.ts`
Expected: FAIL — `Cannot find module './assemble'`.

- [ ] **Step 4: Implement assemble.ts**

```ts
// src/lib/cityArena/mapBuild/assemble.ts
import {
  MAP_UNITS_PER_METRE,
  type MapIndex,
  type MapLandmark,
  type MapRoads,
  type MapTile,
} from "../world/mapTypes";
import {
  MAP_ORIGIN,
  projectLonLat,
  toUnits,
  type Point,
} from "../world/projection";
import { extractAreas, type AreaFeature } from "./areas";
import { MapBuildError } from "./errors";
import {
  distance,
  distancePointToPolygon,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  simplifyRing,
} from "./geometry";
import type { LandmarkConfig } from "./landmarks.config";
import { matchLandmarks } from "./landmarks";
import { osmElementId, type LatLon, type OverpassJson } from "./osmTypes";
import {
  buildRoadGraph,
  encodeRoads,
  parseRoadWays,
  projectNodeCoordinates,
  renderRoads,
} from "./roads";
import {
  TILE_SIZE_M,
  boundsToUnits,
  buildTiles,
  regionBoundsMetres,
  tileCoordFor,
  tileFileName,
  type ProjectedBuilding,
  type ProjectedGround,
  type ProjectedWater,
} from "./tiles";
import {
  buildZones,
  indexObstacles,
  zoneCentresFromLandmarks,
  type ProjectedLandmark,
} from "./zones";

/** Overpass responses for the four query stages plus configuration. */
export type AssembleInput = {
  landmarkOsm: OverpassJson;
  roadsOsm: OverpassJson;
  areasOsm: OverpassJson;
  buildingsOsm: OverpassJson;
  config: LandmarkConfig[];
  generatedAt: string;
};

/** Everything the writer needs; `index.tiles[].bytes` is filled in by the writer. */
export type AssembledMap = {
  index: MapIndex;
  roads: MapRoads;
  tiles: MapTile[];
};

/** Buildings smaller than this are dropped (sheds, garages). */
export const MIN_BUILDING_AREA_M2 = 30;

/** Non-landmark buildings are kept only within this distance of a zone centre. */
export const BUILDING_KEEP_RADIUS_M = 1500;

/** A landmark point attaches to the building containing it or within this distance. */
export const LANDMARK_ATTACH_DISTANCE_M = 15;

/** `building:levels` fallback. */
export const DEFAULT_BUILDING_LEVELS = 2;

const RING_SIMPLIFY_TOLERANCE_M = 0.5;

type StyledLandmark = ProjectedLandmark & {
  name: string;
  style: MapLandmark["style"];
};

function ringToMetres(ring: LatLon[]): Point[] {
  return simplifyRing(
    ring.map((coordinate) => projectLonLat(coordinate.lon, coordinate.lat)),
    RING_SIMPLIFY_TOLERANCE_M,
  );
}

function levelsOf(tags: Record<string, string>): number {
  const parsed = Number.parseInt(tags["building:levels"] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_BUILDING_LEVELS;
}

function projectBuildings(
  features: AreaFeature[],
  zoneCentres: Point[],
  landmarkElementIds: Set<string>,
): ProjectedBuilding[] {
  const buildings: ProjectedBuilding[] = [];
  for (const feature of features) {
    const ring = ringToMetres(feature.ring);
    if (ring.length < 3) continue;
    const isLandmark = landmarkElementIds.has(feature.id.split("#")[0]);
    if (!isLandmark) {
      if (polygonArea(ring) < MIN_BUILDING_AREA_M2) continue;
      const centroid = polygonCentroid(ring);
      const nearZone = zoneCentres.some(
        (centre) => distance(centroid, centre) <= BUILDING_KEEP_RADIUS_M,
      );
      if (!nearZone) continue;
    }
    buildings.push({ ring, levels: levelsOf(feature.tags) });
  }
  return buildings;
}

function attachLandmarks(
  buildings: ProjectedBuilding[],
  landmarks: StyledLandmark[],
): void {
  for (const landmark of landmarks) {
    let best: ProjectedBuilding | null = null;
    let bestDistance = Infinity;
    for (const building of buildings) {
      if (building.landmark) continue;
      const separation = pointInPolygon(landmark.center, building.ring)
        ? 0
        : distancePointToPolygon(landmark.center, building.ring);
      if (separation < bestDistance) {
        bestDistance = separation;
        best = building;
      }
    }
    if (best && bestDistance <= LANDMARK_ATTACH_DISTANCE_M)
      best.landmark = landmark.key;
  }
}

/** Pure end-to-end transform from Overpass responses to the asset structures. */
export function assembleMap(input: AssembleInput): AssembledMap {
  const match = matchLandmarks(input.landmarkOsm, input.config);
  if (match.errors.length > 0) throw new MapBuildError(match.errors.join("\n"));

  const landmarks: StyledLandmark[] = match.matched.map((matched) => ({
    key: matched.config.key,
    name: matched.config.name,
    style: matched.config.style,
    center: projectLonLat(matched.center.lon, matched.center.lat),
    zoneAnchor: matched.config.zoneAnchor,
  }));
  const landmarkElementIds = new Set(
    match.matched.map((matched) => osmElementId(matched.element)),
  );
  const zoneCentres = zoneCentresFromLandmarks(landmarks);

  const areas = extractAreas(input.areasOsm);
  const buildingAreas = extractAreas(input.buildingsOsm);
  const buildings = projectBuildings(
    buildingAreas.buildings,
    zoneCentres.map((zone) => zone.center),
    landmarkElementIds,
  );
  attachLandmarks(buildings, landmarks);
  const water: ProjectedWater[] = areas.water
    .map((feature) => ({ ring: ringToMetres(feature.ring) }))
    .filter((feature) => feature.ring.length >= 3);
  const ground: ProjectedGround[] = areas.ground
    .map((feature) => ({
      ring: ringToMetres(feature.ring),
      kind: feature.kind,
    }))
    .filter((feature) => feature.ring.length >= 3);

  const ways = parseRoadWays(input.roadsOsm);
  const nodeCoords = projectNodeCoordinates(input.roadsOsm);
  const graph = buildRoadGraph(ways, nodeCoords);
  const roads = encodeRoads(graph);

  const zones = buildZones(
    zoneCentres,
    graph,
    landmarks,
    indexObstacles(buildings.map((building) => building.ring)),
    indexObstacles(water.map((feature) => feature.ring)),
  );

  const bounds = regionBoundsMetres();
  const tiles = buildTiles(
    bounds,
    renderRoads(ways, nodeCoords),
    buildings,
    ground,
    water,
  );

  const index: MapIndex = {
    version: 1,
    generatedAt: input.generatedAt,
    origin: { lat: MAP_ORIGIN.lat, lon: MAP_ORIGIN.lon },
    unitsPerMetre: MAP_UNITS_PER_METRE,
    bounds: boundsToUnits(bounds),
    tileSize: toUnits(TILE_SIZE_M),
    tiles: tiles.map((tile) => ({
      x: tile.x,
      y: tile.y,
      file: tileFileName(tile),
      bytes: 0,
    })),
    zones,
    landmarks: landmarks.map((landmark) => ({
      key: landmark.key,
      name: landmark.name,
      style: landmark.style,
      center: [toUnits(landmark.center[0]), toUnits(landmark.center[1])],
      tile: tileCoordFor(landmark.center, bounds),
    })),
  };
  return { index, roads, tiles };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cityArena/mapBuild/assemble.test.ts`
Expected: PASS (5 tests). The five kept buildings are the four anchors plus the café's 20 m building; the 4 m shed and the far "Ver weg" building are dropped. If the connectivity check fails for a fixture zone, the `roadWay` helper produced only one edge chain — that is a single component, so check that `roadWay` node ids do not collide with `squareWay` ids (they use different id ranges by construction: 110–142 vs 11–74).

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/cityArena/mapBuild
git add src/lib/cityArena/mapBuild
git commit -m "feat(arena): assemble index, roads and tiles from Overpass responses

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Overpass fetch with disk cache and retries

**Files:**

- Create: `scripts/arena/overpass.ts`
- Test: `scripts/arena/overpass.test.ts`
- Modify: `.gitignore` (add `.cache/`)

**Interfaces:**

- Consumes: `OverpassJson` (Task 4).
- Produces: `OVERPASS_ENDPOINT`, `FetchOverpassOptions = { cacheDir: string; refresh?: boolean; fetchImpl?: typeof fetch; endpoint?: string; retries?: number; sleep?: (ms: number) => Promise<void>; log?: (line: string) => void }`, `overpassCacheKey(query): string`, `fetchOverpass(query, options): Promise<OverpassJson>`.

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment node
// scripts/arena/overpass.test.ts
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOverpass, overpassCacheKey } from "./overpass";

const payload = {
  version: 0.6,
  elements: [{ type: "node", id: 1, lat: 51.98, lon: 5.625 }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchOverpass", () => {
  let cacheDir = "";
  const sleep = vi.fn(async () => {});

  beforeEach(async () => {
    vi.clearAllMocks();
    cacheDir = await mkdtemp(join(tmpdir(), "arena-overpass-"));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("hashes the query into a stable cache key", () => {
    expect(overpassCacheKey("a")).toBe(overpassCacheKey("a"));
    expect(overpassCacheKey("a")).not.toBe(overpassCacheKey("b"));
    expect(overpassCacheKey("a")).toMatch(/^[0-9a-f]{40}$/);
  });

  it("posts the query as form data and caches the response on disk", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(payload));
    const first = await fetchOverpass("[out:json];node(1);out;", {
      cacheDir,
      fetchImpl,
      sleep,
    });
    const second = await fetchOverpass("[out:json];node(1);out;", {
      cacheDir,
      fetchImpl,
      sleep,
    });
    expect(first.elements).toHaveLength(1);
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.method).toBe("POST");
    expect(String(init.body)).toBe(
      `data=${encodeURIComponent("[out:json];node(1);out;")}`,
    );
    expect(await readdir(cacheDir)).toHaveLength(1);
  });

  it("bypasses the cache with refresh", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(payload));
    await fetchOverpass("q", { cacheDir, fetchImpl, sleep });
    await fetchOverpass("q", { cacheDir, fetchImpl, sleep, refresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 and 5xx with backoff, then succeeds", async () => {
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse({ error: "busy" }, 429))
      .mockResolvedValueOnce(jsonResponse({ error: "gateway" }, 504))
      .mockResolvedValueOnce(jsonResponse(payload));
    const result = await fetchOverpass("q", { cacheDir, fetchImpl, sleep });
    expect(result.elements).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up after the configured retries and reports the status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "busy" }, 429));
    await expect(
      fetchOverpass("q", { cacheDir, fetchImpl, sleep, retries: 2 }),
    ).rejects.toThrow(/429/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects responses without an elements array", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ remark: "runtime error" }),
    );
    await expect(
      fetchOverpass("q", { cacheDir, fetchImpl, sleep }),
    ).rejects.toThrow(/elements/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/arena/overpass.test.ts`
Expected: FAIL — `Cannot find module './overpass'`.

- [ ] **Step 3: Implement overpass.ts and ignore the cache directory**

```ts
// scripts/arena/overpass.ts
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OverpassJson } from "../../src/lib/cityArena/mapBuild/osmTypes";

/** Public Overpass API endpoint. */
export const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

/** Options for {@link fetchOverpass}; `fetchImpl`/`sleep` exist for tests. */
export type FetchOverpassOptions = {
  cacheDir: string;
  refresh?: boolean;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  retries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  log?: (line: string) => void;
};

const DEFAULT_RETRIES = 3;
const BACKOFF_BASE_MS = 2000;

/** SHA-1 of the query text, used as the cache file name. */
export function overpassCacheKey(query: string): string {
  return createHash("sha1").update(query).digest("hex");
}

function isOverpassJson(value: unknown): value is OverpassJson {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { elements?: unknown }).elements)
  );
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Fetches an Overpass query, caching the JSON under `cacheDir/<sha1>.json`. */
export async function fetchOverpass(
  query: string,
  options: FetchOverpassOptions,
): Promise<OverpassJson> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const log = options.log ?? (() => {});
  const retries = options.retries ?? DEFAULT_RETRIES;
  const cacheFile = join(options.cacheDir, `${overpassCacheKey(query)}.json`);

  if (!options.refresh) {
    try {
      const cached: unknown = JSON.parse(await readFile(cacheFile, "utf8"));
      if (isOverpassJson(cached)) {
        log(`Overpass cache hit ${cacheFile}`);
        return cached;
      }
    } catch (error: unknown) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
    }
  }

  let attempt = 0;
  for (;;) {
    attempt += 1;
    let response: Response | null = null;
    let failure: string | null = null;
    try {
      response = await fetchImpl(options.endpoint ?? OVERPASS_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });
    } catch (error: unknown) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (response && response.ok) {
      const parsed: unknown = await response.json();
      if (!isOverpassJson(parsed)) {
        throw new Error(
          `Overpass response has no elements array: ${JSON.stringify(parsed).slice(0, 300)}`,
        );
      }
      await mkdir(options.cacheDir, { recursive: true });
      await writeFile(cacheFile, JSON.stringify(parsed));
      log(`Overpass fetched ${parsed.elements.length} elements → ${cacheFile}`);
      return parsed;
    }
    const status = response?.status ?? 0;
    const retryable = response ? isRetryable(status) : true;
    if (!retryable || attempt > retries) {
      const body = response
        ? (await response.text()).slice(0, 300)
        : (failure ?? "network error");
      throw new Error(
        `Overpass request failed with status ${status} after ${attempt} attempt(s): ${body}`,
      );
    }
    log(`Overpass attempt ${attempt} failed (${status || failure}); retrying`);
    await sleep(BACKOFF_BASE_MS * attempt);
  }
}
```

Append to `.gitignore` under `# Temporary files`:

```
# Overpass download cache (scripts/arena)
.cache/
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/arena/overpass.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
npx prettier --write scripts/arena
git add scripts/arena .gitignore
git commit -m "feat(arena): fetch Overpass queries with disk cache and retries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Build runner, CLI and npm scripts

**Files:**

- Create: `scripts/arena/buildMap.ts`
- Create: `scripts/arena/build-map.ts`
- Test: `scripts/arena/buildMap.test.ts`
- Modify: `package.json` (`scripts`)

**Interfaces:**

- Consumes: `fetchOverpass` (Task 11); `buildLandmarkQuery`, `buildRoadsQuery`, `buildAreasQuery`, `buildBuildingsQuery` (Task 4); `matchLandmarks` (Task 5); `assembleMap` (Task 10); `LANDMARKS`, `LandmarkConfig` (Task 5); `MapBuildError` (Task 8); `osmElementId`, `LatLon` (Task 4); `MAP_VERSION` (Task 1); `MapIndex` (Task 1).
- Produces: `GZIP_BUDGET_BYTES = 900 * 1024`, `RunBuildOptions = { outDir; cacheDir; check: boolean; refresh: boolean; fetchImpl?: typeof fetch; config?: LandmarkConfig[]; now?: () => Date; log?: (line: string) => void }`, `RunBuildResult = { totalGzipBytes: number; files: { name: string; bytes: number; gzipBytes: number }[]; index: MapIndex }`, `runBuild(options): Promise<RunBuildResult>`; npm scripts `arena:build-map`, `arena:build-map:check`.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
// scripts/arena/buildMap.test.ts
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MINI_LANDMARKS,
  overpassMini,
} from "../../src/lib/cityArena/mapBuild/fixtures/overpassMini";
import type { MapIndex } from "../../src/lib/cityArena/world/mapTypes";
import { GZIP_BUDGET_BYTES, runBuild } from "./buildMap";

describe("runBuild", () => {
  let workDir = "";
  const fetchImpl = vi.fn(
    async () => new Response(JSON.stringify(overpassMini), { status: 200 }),
  );

  beforeEach(async () => {
    vi.clearAllMocks();
    workDir = await mkdtemp(join(tmpdir(), "arena-build-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("runs all four stages, writes the asset and reports sizes", async () => {
    const outDir = join(workDir, "out");
    const result = await runBuild({
      outDir,
      cacheDir: join(workDir, "cache"),
      check: false,
      refresh: false,
      fetchImpl,
      config: MINI_LANDMARKS,
      now: () => new Date("2026-09-03T12:00:00.000Z"),
      log: () => {},
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const files = await readdir(outDir);
    expect(files).toContain("index.json");
    expect(files).toContain("roads.json");
    expect(files.filter((name) => name.startsWith("tile_"))).not.toHaveLength(
      0,
    );
    const index = JSON.parse(
      await readFile(join(outDir, "index.json"), "utf8"),
    ) as MapIndex;
    expect(index.zones).toHaveLength(4);
    expect(index.tiles.every((tile) => tile.bytes > 0)).toBe(true);
    expect(result.totalGzipBytes).toBeGreaterThan(0);
    expect(result.totalGzipBytes).toBeLessThan(GZIP_BUDGET_BYTES);
    expect(result.files.map((file) => file.name)).toContain("roads.json");
  });

  it("writes nothing in check mode but still validates", async () => {
    const outDir = join(workDir, "out-check");
    const result = await runBuild({
      outDir,
      cacheDir: join(workDir, "cache"),
      check: true,
      refresh: false,
      fetchImpl,
      config: MINI_LANDMARKS,
      log: () => {},
    });
    expect(result.index.zones).toHaveLength(4);
    await expect(readdir(outDir)).rejects.toThrow();
  });

  it("removes stale tiles from a previous build", async () => {
    const outDir = join(workDir, "out-stale");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "tile_99_99.json"), "{}");
    await runBuild({
      outDir,
      cacheDir: join(workDir, "cache"),
      check: false,
      refresh: false,
      fetchImpl,
      config: MINI_LANDMARKS,
      log: () => {},
    });
    expect(await readdir(outDir)).not.toContain("tile_99_99.json");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run scripts/arena/buildMap.test.ts`
Expected: FAIL — `Cannot find module './buildMap'`.

- [ ] **Step 3: Implement buildMap.ts**

```ts
// scripts/arena/buildMap.ts
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { assembleMap } from "../../src/lib/cityArena/mapBuild/assemble";
import { MapBuildError } from "../../src/lib/cityArena/mapBuild/errors";
import {
  LANDMARKS,
  type LandmarkConfig,
} from "../../src/lib/cityArena/mapBuild/landmarks.config";
import { matchLandmarks } from "../../src/lib/cityArena/mapBuild/landmarks";
import {
  osmElementId,
  type LatLon,
} from "../../src/lib/cityArena/mapBuild/osmTypes";
import {
  buildAreasQuery,
  buildBuildingsQuery,
  buildLandmarkQuery,
  buildRoadsQuery,
} from "../../src/lib/cityArena/mapBuild/overpassQueries";
import type { MapIndex } from "../../src/lib/cityArena/world/mapTypes";
import { fetchOverpass } from "./overpass";

/** Hard ceiling for the gzipped size of all asset files together. */
export const GZIP_BUDGET_BYTES = 900 * 1024;

/** Options for {@link runBuild}. */
export type RunBuildOptions = {
  outDir: string;
  cacheDir: string;
  check: boolean;
  refresh: boolean;
  fetchImpl?: typeof fetch;
  config?: LandmarkConfig[];
  now?: () => Date;
  log?: (line: string) => void;
};

/** Size report for one written (or would-be-written) file. */
export type BuiltFile = { name: string; bytes: number; gzipBytes: number };

/** Result of a build or check run. */
export type RunBuildResult = {
  totalGzipBytes: number;
  files: BuiltFile[];
  index: MapIndex;
};

function measure(name: string, json: string): BuiltFile {
  const buffer = Buffer.from(json, "utf8");
  return {
    name,
    bytes: buffer.byteLength,
    gzipBytes: gzipSync(buffer).byteLength,
  };
}

/** Fetches, assembles, validates and (unless `check`) writes the map asset. */
export async function runBuild(
  options: RunBuildOptions,
): Promise<RunBuildResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const config = options.config ?? LANDMARKS;
  const fetchOptions = {
    cacheDir: options.cacheDir,
    refresh: options.refresh,
    fetchImpl: options.fetchImpl,
    log,
  };

  log("Stage 1/4: landmarks");
  const landmarkOsm = await fetchOverpass(
    buildLandmarkQuery(config.map((landmark) => landmark.nameMatch)),
    fetchOptions,
  );
  const match = matchLandmarks(landmarkOsm, config);
  if (match.errors.length > 0) throw new MapBuildError(match.errors.join("\n"));
  const anchorCentres: LatLon[] = match.matched
    .filter((matched) => matched.config.zoneAnchor)
    .map((matched) => matched.center);
  if (anchorCentres.length !== 4) {
    throw new MapBuildError(
      `Expected 4 zone anchors, found ${anchorCentres.length}`,
    );
  }
  const landmarkElementIds = match.matched.map((matched) =>
    osmElementId(matched.element),
  );

  log("Stage 2/4: roads, areas and buildings");
  const [roadsOsm, areasOsm, buildingsOsm] = await Promise.all([
    fetchOverpass(buildRoadsQuery(anchorCentres), fetchOptions),
    fetchOverpass(buildAreasQuery(), fetchOptions),
    fetchOverpass(
      buildBuildingsQuery(anchorCentres, landmarkElementIds),
      fetchOptions,
    ),
  ]);

  log("Stage 3/4: assemble");
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const assembled = assembleMap({
    landmarkOsm,
    roadsOsm,
    areasOsm,
    buildingsOsm,
    config,
    generatedAt,
  });

  log("Stage 4/4: serialise and check budget");
  const tileJson = new Map<string, string>();
  for (const tile of assembled.tiles) {
    const ref = assembled.index.tiles.find(
      (candidate) => candidate.x === tile.x && candidate.y === tile.y,
    );
    const json = JSON.stringify(tile);
    if (ref) ref.bytes = Buffer.byteLength(json, "utf8");
    tileJson.set(ref?.file ?? `tile_${tile.x}_${tile.y}.json`, json);
  }
  const indexJson = JSON.stringify(assembled.index);
  const roadsJson = JSON.stringify(assembled.roads);
  const files: BuiltFile[] = [
    measure("index.json", indexJson),
    measure("roads.json", roadsJson),
    ...[...tileJson.entries()].map(([name, json]) => measure(name, json)),
  ];
  const totalGzipBytes = files.reduce(
    (total, file) => total + file.gzipBytes,
    0,
  );
  for (const file of files) {
    log(
      `  ${file.name.padEnd(20)} ${String(file.bytes).padStart(9)} B  ${String(file.gzipBytes).padStart(8)} B gz`,
    );
  }
  log(
    `Total gzipped: ${(totalGzipBytes / 1024).toFixed(1)} KB (budget ${(GZIP_BUDGET_BYTES / 1024).toFixed(0)} KB)`,
  );
  if (totalGzipBytes > GZIP_BUDGET_BYTES) {
    throw new MapBuildError(
      `Asset exceeds gzip budget: ${totalGzipBytes} > ${GZIP_BUDGET_BYTES} bytes`,
    );
  }
  if (options.check) {
    log("Check mode: nothing written");
    return { totalGzipBytes, files, index: assembled.index };
  }

  await mkdir(options.outDir, { recursive: true });
  for (const existing of await readdir(options.outDir)) {
    if (existing.startsWith("tile_") && existing.endsWith(".json"))
      await rm(join(options.outDir, existing));
  }
  await writeFile(join(options.outDir, "index.json"), indexJson);
  await writeFile(join(options.outDir, "roads.json"), roadsJson);
  for (const [name, json] of tileJson)
    await writeFile(join(options.outDir, name), json);
  log(`Wrote ${files.length} files to ${options.outDir}`);
  return { totalGzipBytes, files, index: assembled.index };
}
```

- [ ] **Step 4: Implement the CLI entry**

```ts
// scripts/arena/build-map.ts
/**
 * Builds the committed map asset from OpenStreetMap via Overpass.
 *
 *   npm run arena:build-map            # fetch (cached), assemble, write public/arena/map/<version>/
 *   npm run arena:build-map:check      # validate + budget only, write nothing
 *   tsx scripts/arena/build-map.ts --refresh --out=public/arena/map/v2
 */
import { MAP_VERSION } from "../../src/lib/cityArena/constants";
import { MapBuildError } from "../../src/lib/cityArena/mapBuild/errors";
import { runBuild } from "./buildMap";

function readFlag(name: string): string | undefined {
  const prefixed = `--${name}=`;
  const entry = process.argv.find((argument) => argument.startsWith(prefixed));
  return entry ? entry.slice(prefixed.length) : undefined;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const refresh = process.argv.includes("--refresh");
  const outDir = readFlag("out") ?? `public/arena/map/${MAP_VERSION}`;
  await runBuild({ outDir, cacheDir: ".cache/arena", check, refresh });
}

main().catch((error: unknown) => {
  if (error instanceof MapBuildError) {
    console.error(`\n✖ Map build failed:\n${error.message}`);
  } else {
    console.error("\n✖ Unexpected error:", error);
  }
  process.exit(1);
});
```

Add to `package.json` `scripts` (after `"db:seed:preview"`):

```json
"arena:build-map": "tsx scripts/arena/build-map.ts",
"arena:build-map:check": "tsx scripts/arena/build-map.ts --check",
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run scripts/arena/buildMap.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the whole suite, lint and type-check**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all green (the only lint warning allowed is the pre-existing `src/types/ical.d.ts` one).

- [ ] **Step 7: Commit**

```bash
npx prettier --write scripts/arena package.json
git add scripts/arena package.json
git commit -m "feat(arena): add map build runner and CLI with gzip budget

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Immutable cache headers, feature docs, spec alignment

**Files:**

- Modify: `next.config.js`
- Create: `docs/tech/arena/README.md`
- Modify: `docs/superpowers/specs/2026-09-03-city-arena-design.md` (§3.1, §3.4 note, §13)
- Modify (generated): `docs/specs/functional.md` via `npm run docs:generate`

**Interfaces:**

- Consumes: `MAP_VERSION`/`MAP_BASE_PATH` semantics (Task 1) — the header source pattern must cover `/arena/map/<any version>/…`.
- Produces: HTTP `Cache-Control: public, max-age=31536000, immutable` on `/arena/map/:path*`; the feature README that `docs:generate` lists.

- [ ] **Step 1: Add the headers to `next.config.js`**

Inside `nextConfig` (after the `env` block):

```js
  /** Map tiles are content-versioned by path (`/arena/map/v1/...`), so they can be cached forever. */
  async headers() {
    return [
      {
        source: "/arena/map/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
```

- [ ] **Step 2: Verify the header locally**

Run (two terminals, or background the first):

```bash
npm run dev
```

```bash
mkdir -p public/arena/map/v1 && echo '{"probe":true}' > public/arena/map/v1/probe.json && curl -sI http://localhost:3000/arena/map/v1/probe.json | grep -i cache-control; rm public/arena/map/v1/probe.json
```

Expected: `cache-control: public, max-age=31536000, immutable`. Stop the dev server afterwards.

- [ ] **Step 3: Write `docs/tech/arena/README.md`**

```markdown
# Arena (Stadsstrijd)

## Summary

Top-down multiplayer arena game on the real map of Rhenen, Wageningen and Bennekom.
This document covers the **map pipeline** (PR 1). Gameplay, netcode and persistence are
documented as their PRs land. Design: `docs/superpowers/specs/2026-09-03-city-arena-design.md`.

## Entry Points

- Build script: `scripts/arena/build-map.ts` (`npm run arena:build-map`, `npm run arena:build-map:check`)
- Pure pipeline: `src/lib/cityArena/mapBuild/**` (type-checked, unit-tested)
- Shared runtime types: `src/lib/cityArena/world/mapTypes.ts`, `src/lib/cityArena/world/projection.ts`
- Asset: `public/arena/map/<MAP_VERSION>/` (`index.json`, `roads.json`, `tile_x_y.json`), served with
  `Cache-Control: public, max-age=31536000, immutable` (see `next.config.js`)

## Data Model

- `index.json` — bounds, tile grid, four zones (centre/radius/spawn nodes/landmark keys), landmarks.
- `roads.json` — drivable road graph: flat node coordinates, edges with stride 6
  (`a, b, classIndex, nameIndex, oneway, lengthUnits`), class and name lookup tables.
- `tile_x_y.json` — roads (centre lines with class/name), buildings (outer ring, levels, landmark),
  ground (`grass|field|forest`), water. Coordinates are integers in 0.25 m units; north is negative y.
- Source: OpenStreetMap via Overpass, licence ODbL. The asset is a derived database; the app shows
  "Kaart © OpenStreetMap-bijdragers".

## Runbook

1. `npm run arena:build-map` — downloads (cached in `.cache/arena/`, git-ignored), assembles and
   writes the asset. Takes a few minutes the first time; Overpass may answer 429/504 and is retried.
2. Landmark errors — the build prints `Landmark "<key>": N candidates …` with `way/…` ids and names.
   Pick the right one and add `osmId: "way/<id>"` to that entry in
   `src/lib/cityArena/mapBuild/landmarks.config.ts`, then rebuild. Zero candidates means the OSM
   name or tags differ from the config: search the cached landmark response for the name.
3. Budget errors (`Asset exceeds gzip budget`) — raise `MIN_BUILDING_AREA_M2` or lower
   `BUILDING_KEEP_RADIUS_M` in `src/lib/cityArena/mapBuild/assemble.ts`; record the change in the spec.
4. Regenerating a shipped map — bump `MAP_VERSION` in `src/lib/cityArena/constants.ts`, build into the
   new folder, delete the old folder in the same PR.
5. `npm run arena:build-map:check` — validates and reports sizes without writing (used by the nightly
   map-freshness job).

## Testing

- Unit tests co-located under `src/lib/cityArena/mapBuild/` and `scripts/arena/` run in the normal
  `vitest` suite; the network is never touched (injected `fetchImpl`, synthetic fixture
  `fixtures/overpassMini.ts`).
```

- [ ] **Step 4: Align the spec with the decisions taken in this plan**

In `docs/superpowers/specs/2026-09-03-city-arena-design.md`:

1. §3.1 table, Water row: replace `` `natural=water`, `waterway` ∈ river, canal, stream (as buffered lines when no polygon) `` with `` `natural=water` polygons (plus `landuse` ∈ reservoir, basin); waterway *lines* are not used ``.
2. §3.1 table, Ground row: replace the OSM filter text with `` `landuse` ∈ grass, meadow, farmland, forest; `leisure` ∈ park, pitch; `natural` ∈ wood, scrub `` and the note with `Mapped to `grass`, `field`, `forest`; `urban` is the implicit default and is not stored`.
3. §3.4, after the tile bullet, add: `Polygons store their outer ring only; holes (courtyards, river islands) are dropped.`
4. §13 file layout: replace the `scripts/arena/` line with
   `scripts/arena/                build-map.ts · buildMap.ts · overpass.ts (I/O only)` and add under
   `src/lib/cityArena/` the line
   `  mapBuild/  geometry · osmTypes · overpassQueries · landmarks.config · landmarks · roads · areas · zones · tiles · assemble · errors · fixtures/overpassMini`.

- [ ] **Step 5: Regenerate the docs index and commit**

```bash
npm run docs:generate
npx prettier --write next.config.js docs/tech/arena/README.md docs/superpowers/specs/2026-09-03-city-arena-design.md docs/specs/functional.md
git add next.config.js docs
git commit -m "docs(arena): map pipeline runbook, immutable tile caching, spec alignment

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: `docs/specs/functional.md` now lists `| arena | docs/tech/arena/README.md |` inside the AUTOGEN block.

---

### Task 14: Run the real build, commit the asset, verify, open PR 1

**Files:**

- Create: `public/arena/map/v1/index.json`, `public/arena/map/v1/roads.json`, `public/arena/map/v1/tile_*.json`
- Possibly modify: `src/lib/cityArena/mapBuild/landmarks.config.ts` (`osmId` pins), `src/lib/cityArena/mapBuild/assemble.ts` (budget constants), `src/lib/cityArena/mapBuild/zones.ts` (`MIN_CONNECTED_EDGE_SHARE`)

**Interfaces:**

- Produces: the committed asset that Plan 2's `MapLoader` reads via `MAP_BASE_PATH`.

- [ ] **Step 1: Run the build against live Overpass**

```bash
npm run arena:build-map
```

Expected: four stage lines, a size table and `Wrote N files to public/arena/map/v1`. First run takes 1–5 minutes; responses are cached in `.cache/arena/`. If it fails, apply exactly one of the decision rules below and rerun:

- **Landmark has several candidates** → read the printed `way/…`/`relation/…` list, choose by name and coordinates (Cunerakerk ≈ 51.958, 5.569; Grote Kerk ≈ 51.969, 5.666; Forum ≈ 51.985, 5.664; Oude Kerk ≈ 51.999, 5.676; 't Gastland is the sports complex in Rhenen; De Bongerd is the pool at Bornsesteeg, Wageningen; De Vrije Slag is the open-air pool in Bennekom), and add `osmId` to that entry in `landmarks.config.ts`.
- **Landmark has zero candidates** → `grep -o '"name":"[^"]*"' .cache/arena/*.json | sort -u | grep -i <fragment>` to see how OSM spells it; adjust `nameMatch` or `matchesTags` (for example a pool tagged `leisure=swimming_pool` on a `building` way) — never loosen a filter so far that two elements match.
- **Zone not connected enough** → if the printed share is ≥ 85 %, set `MIN_CONNECTED_EDGE_SHARE = 0.85` in `zones.ts`, update the spec (§3.3) to 85 %, and note why in the PR. If lower, exclude `service` roads from the _graph_ (keep them for rendering): in `assemble.ts` pass `ways.filter((way) => way.cls !== "service")` to `buildRoadGraph` and keep the unfiltered `ways` for `renderRoads`; add a unit test in `assemble.test.ts` asserting `roads.classes` does not contain `"service"`.
- **Gzip budget exceeded** → set `MIN_BUILDING_AREA_M2 = 40`; if still over, set `BUILDING_KEEP_RADIUS_M = 1200`; update the spec (§3.1) with the values that shipped.

- [ ] **Step 2: Inspect the result**

```bash
node -e "const i=require('./public/arena/map/v1/index.json');console.log(i.tiles.length,'tiles');for(const z of i.zones)console.log(z.key,'spawns',z.spawnNodes.length,'landmarks',z.landmarks.join(','));console.log(i.landmarks.map(l=>l.key+'@'+l.tile.x+','+l.tile.y).join(' '))"
```

Expected: 20–35 tiles; every zone has ≥ 30 spawn nodes; each zone lists its anchor landmark; all ten landmarks present. If a zone has fewer than 30 spawn nodes, report the number in the PR description — Plan 2 can still spawn, but fewer than 10 is a defect: check that `roads.json` contains `residential` edges near that centre.

- [ ] **Step 3: Verify the header on the real asset**

```bash
npm run dev
```

```bash
curl -sI http://localhost:3000/arena/map/v1/index.json | grep -iE "HTTP|cache-control|content-type"
```

Expected: `HTTP/1.1 200`, `cache-control: public, max-age=31536000, immutable`, `content-type: application/json`. Stop the dev server.

- [ ] **Step 4: Run the verification loop**

```bash
npm run lint && npx tsc --noEmit && npx vitest run && npm run build
```

Expected: all green. `npm run build` must succeed with the asset in `public/` (Next copies it as-is).

- [ ] **Step 5: Commit the asset (and any config pins)**

```bash
npx prettier --write src/lib/cityArena docs
git add public/arena/map/v1 src/lib/cityArena docs
git commit -m "feat(arena): commit generated Rhenen-Wageningen-Bennekom map asset v1

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

The JSON files are compact (no whitespace); do **not** run Prettier on `public/arena/map/**` (add `public/arena/map/` to `.prettierignore` if the pre-commit hook tries to format them — create the file with that single line if it does not exist).

- [ ] **Step 6: Open PR 1 of 8**

```bash
git push -u origin feat/city-arena
gh pr create --base image --title "feat(arena): real-world map pipeline and committed asset (1/8)" --body "$(cat <<'EOF'
## Summary

First PR of the Stadsstrijd (city arena) stack — design in `docs/superpowers/specs/2026-09-03-city-arena-design.md`, plan in `docs/superpowers/plans/2026-09-03-city-arena-plan-1-map-pipeline.md`.

- Pure, type-checked map pipeline in `src/lib/cityArena/mapBuild/` (geometry, Overpass queries, landmark matching with an exactly-one rule, road graph, area extraction via `osm2geojson-lite`, zones with spawn nodes and connectivity checks, 2 km tiling)
- Thin Node CLI `npm run arena:build-map` with disk cache, retries and a 900 KB gzip budget
- Committed asset `public/arena/map/v1/` (index, road graph, tiles) generated from OpenStreetMap (ODbL, attribution added in-game in PR 2)
- Immutable `Cache-Control` for `/arena/map/:path*`
- Feature doc `docs/tech/arena/README.md` with runbook

## Verification

- `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build` green locally
- Header verified with `curl -sI` against `next dev`
- Build summary: <paste the size table and zone/spawn summary from Task 14 steps 1–2>

## Notes for reviewers

- No runtime code paths change yet; the asset is static and unused until PR 2 (world model + renderer).
- Decision rules applied during the real build (landmark pins, budget constants): <list or "none">

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then follow the `loop-on-ci` workflow: watch checks, fix failures, address CodeRabbit comments and resolve their threads.

---

## Roadmap: Plans 2–7 (written after Plan 1 lands)

Each plan produces working, testable software and consumes the interfaces of the previous ones.

> Reordered on 2026-09-04 (owner decision): gameplay ships before multiplayer. Plan 4 is split into 4a
> (cars, weapons, bullets, damage, death screen, HUD) and 4b (pedestrians, cops, pickups, zone, radar, SFX),
> both on the local simulation; Plan 3 (netcode) follows and adds rounds and the scoreboard. PR numbering
> continues in delivery order (4a = 3/8, 4b = 4/8, netcode = 5/8, …).

| Plan | PR        | Deliverable                                                                                                                                                                                                           | Depends on                     |
| ---- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 2    | 2/8       | `MapLoader`, `StaticRaster` chunk renderer, `CollisionGrid`, `RoadGraph` A\*, `Zone`; single-player free-roam (walk only) behind `CityArenaLauncher` + `CityArenaOverlay`; OSM attribution footer; `?debug=1` overlay | Plan 1 asset and `mapTypes.ts` |
| 3    | 5/8       | `RealtimeTransport` + `ablyTransport` + `memoryTransport`; token route; host election; `hostLoop`/`clientLoop` with prediction and interpolation; Lobby, rooms API, `arena:lobby` registry; `ConnectionBanner`        | Plan 2 world model             |
| 4    | 3/8 + 4/8 | Cars, weapons, bullets, pedestrians, cops/wanted, pickups, zone out-of-bounds, rounds, scoreboard, HUD, radar, SFX, death screen (spec §7 artwork overlay)                                                            | Plan 3 netcode                 |
| 5    | 6/8       | Prisma migration `add_arena_match`, `arenaService`, matches + leaderboard routes, launcher lists (active rooms, leaderboard), pending-results queue                                                                   | Plan 4 round results           |
| 6    | 7/8       | Twin-stick touch controls, mouse aim + keyboard map, haptics, feedback effects, settings storage, first-run tip                                                                                                       | Plan 4 input model             |
| 7    | 8/8       | Test seams (`window.__arena`, invariants, bots, session log), `wsRelayTransport` + relay, Playwright hermetic config + DSL + budgets, CI jobs (`arena-e2e`, `arena-nightly`), `docs/tech/arena/TESTING.md`            | Plans 3–6                      |

Slice 2 (TV mode) gets its own spec addendum and plans after 8/8 ships.
