# Arena (GTA H3)

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
- `tile_x_y.json` — roads (`points` centre line, `roadClass`, optional `name`), buildings (`points`
  outer ring, `levels`, optional `landmark`), ground (`points`, `kind`: `grass|field|forest`), water
  (`points`). Coordinates are integers in 0.25 m units; north is negative y.
- Source: OpenStreetMap via Overpass, licence ODbL. The asset is a derived database; the app shows
  "Kaart © OpenStreetMap-bijdragers".

## Runbook

1. `npm run arena:build-map` — downloads (cached in `.cache/arena/`, git-ignored), assembles and
   writes the asset. Takes a few minutes the first time; Overpass may answer 429/504 and is retried.
2. Landmark errors — the build prints `Landmark "<key>": N candidates …` with `way/…` ids and names.
   Pick the right one and add `osmId: "way/<id>"` to that entry in
   `src/lib/cityArena/mapBuild/landmarks.config.ts`, then rebuild. Zero candidates means the OSM
   name or tags differ from the config: search the cached landmark response for the name.
3. Budget errors — two independent caps, both in `scripts/arena/buildMap.ts`: total gzipped
   size ≤ 1.2 MB (`GZIP_BUDGET_BYTES`, "Asset exceeds gzip budget") and no single tile above
   256 KB gzipped (`TILE_GZIP_BUDGET_BYTES`, "Tile(s) exceed the ... per-tile gzip cap" — the
   build lists the offending tiles by name and size). Either one fails the build. Levers, all in
   `src/lib/cityArena/mapBuild/assemble.ts`: raise `MIN_BUILDING_AREA_M2` (drops small buildings)
   or lower `BUILDING_KEEP_RADIUS_M` (drops buildings far from a zone centre) — buildings are the
   larger contributor to tile size in the shipped build (measured per-layer gzip split, spec
   §3.4), not ground, so these two levers matter most; raising `TERRAIN_SIMPLIFY_TOLERANCE_M`
   (coarser ground/water polygons) helps less. Record the change in the spec.
4. Regenerating a shipped map — bump `MAP_VERSION` in `src/lib/cityArena/constants.ts`, build into the
   new folder, delete the old folder in the same PR.
5. `npm run arena:build-map:check` — validates and reports sizes without writing (used by the nightly
   map-freshness job planned for PR 7).

## Testing

- Unit tests co-located under `src/lib/cityArena/mapBuild/` and `scripts/arena/` run in the normal
  `vitest` suite; the network is never touched (injected `fetchImpl`, synthetic fixture
  `fixtures/overpassMini.ts`).

## Licence

The asset is a derived database of OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0
(https://www.openstreetmap.org/copyright).

## Runtime (PR 2 — free-roam)

- Feature toggle: hidden by default behind the admin-controlled `gtaH3Launcher` flag
  (`src/lib/featureFlags.ts`, toggled at `/admin` — see `docs/tech/admin/README.md`). `src/app/page.tsx`
  reads it server-side and passes `gtaH3Enabled` to `EventList`, which renders the launcher card only
  when true.
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
