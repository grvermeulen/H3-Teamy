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
