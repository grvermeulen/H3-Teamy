# World Enrichment Implementation Plan (Plan 9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fuller city — nine kinds of car that look and drive differently, six looks of pedestrian, two more weapons, trees and street furniture on the map, and denser ambient life — without breaking the simulation's determinism, the 8 KB snapshot, or the frame budget.

**Architecture:** Every addition rides an extension point that already exists: vehicle kinds are a table (`sim/vehicle.ts`) whose index goes on the wire; pedestrians get a look derived from their id, so nothing new crosses the wire; weapons are a table plus a widened ammo record; trees are a tile layer baked into the chunk raster like buildings, so they cost nothing per frame; sprites are manifest keys the loader already treats as optional (a missing file falls back to today's art). Art is generated with SpriteCook (the owner's plan), packed by the existing `arena:build-sprites` script, and every asset has a size budget and a credit row. The plan is two pull requests: **9a** (vehicles, pedestrians, weapons, density) touches the simulation; **9b** (trees and furniture) touches the map build. Either can ship first.

**Tech Stack:** TypeScript, Zod, Canvas 2D, the OSM Overpass pipeline (`mapBuild/`), SpriteCook MCP (`gpt-image-2`, 1024 px), ElevenLabs Sound Effects for two clips, Vitest 5. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-03-city-arena-design.md` — §3 map, §5 vehicles and weapons, §8 rendering budgets, §6.4 wire format. §1 lists "more weapons" as slice 3+; the owner asked for this on 2026-09-10, so Task 10 amends §1 and §5 with the date, as earlier amendments were.

## Global Constraints

- All user-facing strings in **Dutch (NL)**. New copy: **Bestelbus**, **Pick-up**, **Bus**, **Oldtimer**, **Trekker**, **Knuppel**, **Geweer**.
- JSDoc on every exported symbol; no `any`; `catch (error: unknown)` reporting to Sentry with `{ area: "arena", kind }`.
- Functions under **50 lines**, files under **400 lines** — new kinds go in tables, not branches.
- **Determinism:** every spawn choice comes from the seeded rng (`sim/rng.ts`); a look, a kind or a colour derived from an id is derived arithmetically. `sim/invariants.ts` is extended for every new cap and asserted in the 600-tick acceptance run.
- **Wire:** `VEHICLE_KINDS` and `WEAPON_ORDER` are wire indices — **append, never reorder**. `MAX_SNAPSHOT_BYTES = 8192` stays; `net/wire.test.ts` proves an 8-player world at the new caps fits.
- **Budgets (spec §8):** draw ≤ 6 ms/frame, ≤ 1 chunk raster/frame, host tick ≤ 4 ms. Map gzip budget 4 MB total / 512 KB per tile — raise rather than thin (owner, 2026-09-07).
- **Art:** every sprite has a row in `public/arena/sprites/CREDITS.md` (new; the SpriteCook licence), a source PNG under `assets/arena/sprites/`, and the packed PNG under 64 KB unless the plan says otherwise; `npm run arena:check-audio` grows a sprite audit or a sibling `arena:check-sprites`.
- Verification loop before every push: `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `npm run arena:check-audio`, `npm run arena:build-map` for 9b (the tiles are committed).

## What exists today (from the 2026-09-10 survey)

| Area        | Today                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vehicles    | 4 kinds (`compact 6/22`, `sedan 8/28`, `sport 11/36`, `police 9/30` m/s² / m/s), one 4.2 × 1.8 m body, one health (100), one sprite tinted 6 colours, kind never changes the look |
| Spawns      | 30 parked per zone (all four zones at boot), traffic 6–10 per zone topped up to `MAX_TRAFFIC 12`, `MAX_VEHICLES 140`, police 0/0/1/2 by wanted level                              |
| Pedestrians | one look, flat circles, `PEDS_PER_ZONE 25`, `MAX_PEDS 40`; cops the same in blue; both 6 ints on the wire per body                                                                |
| Weapons     | fist, pistol, uzi, shotgun; `AmmoState { uzi, shotgun }`; `MAX_PICKUPS 10` = exactly today's 6 + 4                                                                                |
| Sprites     | manifest with closed `vehicles: { sedan }` and `people: { player }`; 9 PNGs, 218 KB; one pack script `scripts/generate-arena-sprites.js`; SpriteCook driven by hand               |
| Map         | roads, buildings, water, ground areas (grass/field/forest fills); **no trees, no furniture**; 35 tiles, 1.14 MB gz of a 4 MB budget                                               |

## Design decisions

- **Nine vehicle kinds.** The existing four plus `van` (Bestelbus, 5.0 × 2.0 m, 5 / 24, health 140), `pickup` (Pick-up, 5.2 × 1.9 m, 7 / 27, health 120), `bus` (Stadsbus, 12 × 2.5 m, 3 / 18, health 220, main roads only), `oldtimer` (4.4 × 1.7 m, 5 / 20, health 70), `tractor` (Trekker, 4.0 × 2.2 m, 2 / 8, health 180, countryside roads only). `VehicleSpec` grows `lengthM`, `widthM`, `healthMax`, `steerRateRadS`, `massT`; the collision hull becomes circles along the length (one per ~2 m) so a bus is a bus. Mass weights car-on-car impulses (a bus shoves a compact, not the reverse). Each kind has its own top-down sprite at 32 px/m; a kind whose art has not landed draws the sedan's, as today.
- **Ten body colours** instead of six; police fixed as now. Colour stays `colour % palette.length`, so the wire is untouched.
- **Where kinds appear.** Parked: compact, sedan, oldtimer, van, pickup. Traffic by road class: residential/service → compact, sedan, oldtimer, van; tertiary and up → plus pickup, bus; roads through `field`/`farmland` ground → tractor with probability 0.3. Sport cars are never ambient traffic (they are the prize) but stay parked as today.
- **Six pedestrian looks**, `look = id % PED_LOOKS`, zero wire cost; cops get a uniform strip; players keep the player strip. Peds render through the same strip painter players use; `drawPeople` loses its circles. The `PERSON_RADIUS_M 0.35` vs `PED_RADIUS_M 0.4` split and the hard-coded ped health in the painter are fixed on the way.
- **Two weapons.** `bat` (Knuppel: melee, 30 damage, 1.5/s, 1.6 m) and `rifle` (Geweer: 45 damage, 0.8/s, 70 m, 160 m/s, no spread, magazine 10, max 30, pickup 10). `AmmoState` gains `rifle`; the `p` wire row gains one int (16 → 17); `WEAPON_ORDER` becomes `fist, bat, pistol, uzi, shotgun, rifle` (appended in wire order, displayed in that order); keys 1–6. Pickups: weapon pickups per zone 6 → 9 rotating uzi/shotgun/rifle, bats at 2 per zone, `MAX_PICKUPS 10 → 18`. Two clips: `bat` (swing and thud) and `rifle` (crack) via `arena:generate-audio`; the bat also gets a synth fallback.
- **Density.** `TRAFFIC_MAX_PER_ZONE 10 → 16`, `MAX_TRAFFIC 12 → 20`, `PEDS_PER_ZONE 25 → 35`, `MAX_PEDS 40 → 60`. Worst case on the wire: 140 × 10 + 60 × 6 + 8 × 5 + 64 × 7 + 18 + 8 × 17 ≈ 2.4 K ints — under 8 KB in the current varint packing; the wire test proves it at the caps.
- **Trees are a tile layer, baked.** Overpass: `natural=tree` nodes, `natural=tree_row` ways (a tree every 8 m along), plus procedural trees inside `wood`/`forest`/`scrub` polygons at one per 80 m² and inside `park` at one per 400 m², seeded from the tile id so a rebuild is stable. Each tree is `[x, y, size]` with size 0 (6 m canopy) or 1 (10 m). Painted after buildings and before labels in `paintChunk` with a canopy sprite over a soft shadow disc; **trunks are solid** (a 0.35 m square in the collision grid) so cars crash into them. Cap 4000 trees per tile; the tile budget rises to 768 KB if a tile needs it.
- **Furniture** is decorative and non-solid: `highway=street_lamp`, `amenity=bench`, `highway=bus_stop` nodes as `[x, y, kind]` in the same layer, tiny sprites (lamp 0.4 m, bench 1.8 m, bus stop 2 m), painted with the trees. No collision, no wire.
- **Art comes from SpriteCook** through the MCP already connected to this workspace: `generate_game_art` for top-down vehicle cut-outs (one per kind, 1024 px, "nose up", flat orthographic light, no shadow, transparent background), `generate_character` for the six pedestrian looks and the cop (front-facing cut-outs the pack script turns into walk strips), `generate_game_art` in `mode: "texture"` for the two canopies and the three furniture pieces. Prompts are in the task steps. Every generation is a credit spend, so each task generates once and commits the sources.
- **Cyclists (Fietsers)** would be the most Dutch addition of all and are **deferred to a Task 9 stretch**: a pedestrian mode that follows roads at 5 m/s needs traffic's path-following on a ped, which is new behaviour, not new content.

## File Structure

| File                                                                                             | Responsibility                                                                 |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `src/lib/cityArena/sim/vehicle.ts`                                                               | `VehicleSpec` widened; nine kinds; hull from length; mass in impulses          |
| `src/lib/cityArena/sim/types.ts`                                                                 | `VehicleKind` union appended; `AmmoState.rifle`; `WeaponKind` + `bat`, `rifle` |
| `src/lib/cityArena/sim/spawn.ts`, `sim/traffic.ts`                                               | Kind pools by context; tractors on countryside roads; density constants        |
| `src/lib/cityArena/sim/peds.ts`, `sim/types.ts`                                                  | `PED_LOOKS`, `pedLook(id)`; caps                                               |
| `src/lib/cityArena/sim/weapons.ts`, `sim/pickups.ts`, `sim/limits.ts`                            | Two weapons; pickup rotation; caps                                             |
| `src/lib/cityArena/net/snapshotWire.ts`                                                          | `p` row 17 ints; kinds appended                                                |
| `src/lib/cityArena/render/sprites.ts`, `render/loadSprites.ts`                                   | Open `vehicles`/`people` records; `trees`, `furniture` keys                    |
| `src/lib/cityArena/render/drawVehicles.ts`, `drawPeople.ts`, `drawStatic.ts`                     | Per-kind sprite; strip-drawn peds and cops; canopy and furniture painting      |
| `src/lib/cityArena/render/palette.ts`                                                            | Ten body colours                                                               |
| `src/lib/cityArena/mapBuild/overpassQueries.ts`, `areas.ts`, `assemble.ts`                       | Trees and furniture extraction and procedural fill                             |
| `src/lib/cityArena/world/mapTypes.ts`, `schemas.ts`, `world/decode.ts`, `world/collisionGrid.ts` | The `trees`/`furniture` tile fields; trunk collision                           |
| `scripts/generate-arena-sprites.js`                                                              | New registry entries; walk strips for six looks and the cop                    |
| `scripts/arena/check-sprites.ts`                                                                 | Manifest keys have files, sizes under budget, credit rows                      |
| `public/arena/sprites/*`, `assets/arena/sprites/*`, `public/arena/sprites/CREDITS.md`            | The art                                                                        |
| `src/lib/cityArena/audio/clips.ts`, `scripts/arena/generate-audio.ts`                            | `bat`, `rifle` clips                                                           |
| `src/components/cityArena/ArenaVitals.tsx`, `input/weaponSelect.ts`                              | Labels, slots 1–6                                                              |
| `docs/tech/arena/README.md`, the spec                                                            | Plan 9 section; §1, §3, §5 amendments                                          |

---

## PR 9a — vehicles, pedestrians, weapons, density

### Task 1: Vehicle specs that differ in more than speed

**Files:** modify `sim/vehicle.ts`, `sim/types.ts`, `sim/invariants.ts`; test `sim/vehicle.test.ts`, `sim/damage.test.ts`, `net/wire.test.ts`.

**Interfaces:**

```ts
export type VehicleKind =
  | "compact"
  | "sedan"
  | "sport"
  | "police"
  | "van"
  | "pickup"
  | "bus"
  | "oldtimer"
  | "tractor"; // appended: wire order
export type VehicleSpec = {
  label: string; // Dutch
  accelMps2: number;
  maxSpeedMps: number;
  /** Turn rate at grip; a bus turns at 1.6 rad/s, a sport car at 2.9. */
  steerRateRadS: number;
  healthMax: number;
  lengthM: number;
  widthM: number;
  /** Tonnes; weights the impulse two cars trade in a collision. */
  massT: number;
};
export const VEHICLE_SPECS: Record<VehicleKind, VehicleSpec>;
/** Hull circles along the length: one per ~2 m, radius width/2 · 1.05. */
export function hullCircles(
  kind: VehicleKind,
): { offsetM: number; radiusM: number }[];
```

- [ ] **Step 1: Write the failing tests** — `VEHICLE_KINDS` lists nine in the stated order and the wire index of `police` is unchanged (3); `hullCircles("bus")` has six circles spanning ±5 m and `hullCircles("compact")` two; a bus at rest takes more damage than a compact from the same bullet count? no — health: `createVehicle(…, "bus")` starts at 220 health and a compact at 100; a head-on between a bus at 10 m/s and a compact at rest leaves the compact moving faster than the bus (mass ratio); the 8-player snapshot at the new caps stays under `MAX_SNAPSHOT_BYTES`.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement** — the table (values in Design decisions; the four existing kinds gain `steerRateRadS 2.6`, `healthMax 100`, `lengthM 4.2`, `widthM 1.8`, `massT 1.2` (sport 1.3, police 1.6)); `VEHICLE_MAX_HEALTH` becomes a per-kind read (`healthMaxOf(kind)`), `SMOKE_HEALTH` a fraction (0.4) of it; collision impulse split by `massT` ratio; the boarding, kerb and spawn code that reads `VEHICLE_LENGTH_M` reads `lengthOf(kind)`. The wire row is unchanged: sizes are derived from `kind` on both sides.
- [ ] **Step 4: Run the tests, lint, `tsc`; commit** — `feat(arena): nine vehicle kinds with their own size, mass and health`.

### Task 2: Where each kind appears, and more of them

**Files:** modify `sim/spawn.ts`, `sim/traffic.ts`, `sim/populate.ts`, `sim/limits.ts`; test `sim/spawn.test.ts`, `sim/traffic.test.ts`, `sim/invariants.ts`.

- [ ] **Step 1: Write the failing tests** — parked cars are drawn from `PARKED_KINDS` only; traffic on a residential edge never spawns a bus; traffic on a primary edge can; a road whose midpoint lies in a `field` area spawns a tractor for a seeded rng that rolls under 0.3 and not otherwise; the caps (`MAX_TRAFFIC 20`, `MAX_PEDS 60`, `MAX_VEHICLES 140`) hold over 600 ticks in the acceptance run.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement** — `PARKED_KINDS`, `TRAFFIC_KINDS_BY_CLASS` (a `Record<RoadClass, VehicleKind[]>`), `TRACTOR_CHANCE = 0.3` with `groundKindAt(point)` from the tile's areas (the ground index already exists for painting), `TRAFFIC_MAX_PER_ZONE 16`, `MAX_TRAFFIC 20`, `PEDS_PER_ZONE 35`, `MAX_PEDS 60`.
- [ ] **Step 4: Run the tests; commit** — `feat(arena): each vehicle kind where it belongs, and busier streets`.

### Task 3: Vehicle art

**Files:** create `assets/arena/sprites/vehicle-{van,pickup,bus,oldtimer,tractor,police}.png` (1024 px SpriteCook sources), `public/arena/sprites/CREDITS.md`, `scripts/arena/check-sprites.ts` (+ test); modify `scripts/generate-arena-sprites.js`, `render/sprites.ts`, `render/loadSprites.ts`, `render/drawVehicles.ts`, `render/palette.ts`, `package.json` (`arena:check-sprites`), `.github/workflows/agentic-ci.yml`.

- [ ] **Step 1: Write the failing tests** — the manifest schema accepts `vehicles: Record<VehicleKind, …>` with any subset present; `spriteForVehicle(sprites, kind, colour)` returns the kind's tinted sprite, the sedan's when the kind has none, `null` when neither loaded; the palette has ten body colours and `colour % 10` covers them; `auditSprites` flags a manifest key without a file, a file over 64 KB (vehicles) / 96 KB (the bus), and a file without a credit row.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Generate the art** — one `generate_game_art` call per kind, 1024 px, transparent background, prompt: `"top-down orthographic view of a <kind description>, nose pointing up, flat even lighting, no shadow, no ground, centered, game sprite, realistic proportions, <colour> body"` with descriptions: van "white Dutch delivery van (Volkswagen Transporter style)", pickup "double-cab pickup truck", bus "12-metre city bus, white with a blue stripe", oldtimer "1970s classic saloon car with chrome bumpers", tractor "green farm tractor with large rear wheels", police "Dutch police car: white with orange-and-blue striping, roof light bar". Neutral grey bodies for the tinted kinds (the script tints them); the bus, tractor and police keep their own colours (`tint: false` in the registry). Save sources; run `npm run arena:build-sprites`.
- [ ] **Step 4: Wire the loader and painter** — registry entries with `pxPerMetre 32` and each kind's length; `vehicles` open record; `drawVehicles` picks by kind, stretching onto `lengthOf(kind) × widthOf(kind)`; police keeps its vector light bar on top of its own sprite only when the sprite is missing.
- [ ] **Step 5: Verify (the checker, a screenshot of each kind in the dev server), commit** — `feat(arena): a sprite for every vehicle kind`.

### Task 4: Pedestrians with faces

**Files:** create `assets/arena/sprites/person-{ped1..ped6,cop}.png`; modify `sim/peds.ts` (`PED_LOOKS = 6`, `pedLook(id)`), `sim/cops.ts`, `render/drawPeople.ts`, `render/drawEntities.ts` (share the strip painter), `render/sprites.ts` (`people` open record), `scripts/generate-arena-sprites.js`; test `render/drawPeople.test.ts`, `sim/peds.test.ts`.

- [ ] **Step 1: Write the failing tests** — `pedLook(7) === 1` and every id maps into `0..5`; with a `people.ped3` sprite loaded, a ped with look 3 is drawn with that strip (the fake context records `drawImage` with its source), and with none loaded the circle is drawn as today; the cop draws `people.cop`; the painter's radius is `PED_RADIUS_M` and its health bar reads `PED_MAX_HEALTH`.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Generate** — seven `generate_character` calls: six civilians (`"full-body front view of a <description>, standing, arms at sides, flat lighting, transparent background, game character cut-out"` — a student with a backpack, an older man in a flat cap, a woman in a raincoat, a teenager in a hoodie, a man in a suit, a woman in sportswear) and one Dutch police officer (dark blue uniform, yellow reflective stripes). The pack script's `walkCycleFrame` makes the eight-frame strips at 64 px/m.
- [ ] **Step 4: Implement** the look and the shared strip painter; commit — `feat(arena): six pedestrian looks and a cop in uniform`.

### Task 5: A bat and a rifle

**Files:** modify `sim/types.ts`, `sim/weapons.ts`, `sim/pickups.ts`, `sim/limits.ts`, `sim/combat.ts`, `net/snapshotWire.ts`, `input/weaponSelect.ts`, `audio/clips.ts`, `audio/sound.ts`, `scripts/arena/generate-audio.ts`, `src/components/cityArena/ArenaVitals.tsx`, `CityArenaOverlay.tsx` (the hint: `1-6`); tests alongside each.

- [ ] **Step 1: Write the failing tests** — the two specs (values in Design decisions); the bat hits like the fist but for 30 at 1.6 m; a rifle shot travels 70 m; `AmmoState` round-trips `rifle` through the wire (`p` row of 17); pickups per zone rotate uzi/shotgun/rifle and two bats spawn; `MAX_PICKUPS 18` holds; key 6 selects the rifle and the rack cycles through six; the HUD labels read **Knuppel** and **Geweer**; the sound layer plays `rifle` for a rifle shot and falls back to a tone.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement**, appending in wire order; generate the two clips (`npx dotenv -e .env -- npm run -s arena:generate-audio bat rifle` after adding their prompts: bat `"baseball bat swing and a dull thud on a body, short"` 0.6 s, rifle `"single hunting rifle shot outdoors, sharp crack with a short echo"` 1.2 s).
- [ ] **Step 4: Verify, commit** — `feat(arena): a bat and a rifle`.

### Task 6: PR 9a — docs, verification, the PR

- [ ] README section, spec §5 amendment (nine kinds, six weapons, dated), §1 non-goals amended, `npm run build`, the checkers, PR against `image`, CodeRabbit, merge on green. A device check of the new sprites on a phone is the owner's.

---

## PR 9b — trees and street furniture

### Task 7: Trees and furniture in the map build

**Files:** modify `mapBuild/overpassQueries.ts`, `mapBuild/areas.ts` (or a new `mapBuild/vegetation.ts`), `mapBuild/assemble.ts`, `world/mapTypes.ts`, `lib/cityArena/schemas.ts`, `world/decode.ts`, `scripts/arena/buildMap.ts` (budgets and a tree count in the report); tests `mapBuild/vegetation.test.ts`, `world/decode.test.ts`, `schemas.test.ts`.

**Interfaces:**

```ts
/** A tree: position in world units and a size class (0: 6 m canopy, 1: 10 m). */
export type TileTree = [x: number, y: number, size: 0 | 1];
/** A piece of furniture: position and kind. */
export type TileFurniture = [x: number, y: number, kind: FurnitureKind];
export type FurnitureKind = "lamp" | "bench" | "busStop";
export type MapTile = { …; trees: TileTree[]; furniture: TileFurniture[] }; // both default [] on decode
export const MAX_TREES_PER_TILE = 4000;
export const TREE_ROW_SPACING_M = 8;
export const FOREST_TREE_AREA_M2 = 80;
export const PARK_TREE_AREA_M2 = 400;
export function placeTrees(areas: GroundArea[], tileSeed: number): TileTree[];
```

- [ ] **Step 1: Write the failing tests** — `placeTrees` puts ~`area / 80` trees in a forest polygon and ~`area / 400` in a park, all inside the polygon, none within 3 m of another, deterministic for a seed; a tree row of 40 m yields 6 trees; a tile with more than the cap keeps the first 4000 (rows and mapped trees before procedural ones); `decode` gives `[]` for a tile without the fields (the shipped v1 tiles until rebuilt); the Zod guard accepts the new fields.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Implement** — the Overpass query gains `node["natural"="tree"]`, `way["natural"="tree_row"]`, `node["highway"="street_lamp"]`, `node["amenity"="bench"]`, `node["highway"="bus_stop"]` within the building radius; procedural placement on the tile's `forest`/`grass`(park) areas; assembly writes the fields; the build report prints trees and furniture per tile and the gz sizes.
- [ ] **Step 4: Rebuild the map** (`npm run arena:build-map`, network) and commit the tiles if the budget holds; raise `TILE_GZIP_BUDGET_BYTES` to 768 KB first if a tile needs it — `feat(arena): trees and street furniture in the map tiles`.

### Task 8: Painting and hitting them

**Files:** create `assets/arena/sprites/tree-{small,large}.png`, `furniture-{lamp,bench,busstop}.png`; modify `scripts/generate-arena-sprites.js`, `render/sprites.ts`, `render/loadSprites.ts`, `render/drawStatic.ts` (a `paintTrees` and `paintFurniture` after buildings), `render/palette.ts` (canopy fallback colours), `world/collisionGrid.ts` (trunks), `sim/arenaWorld` collision callers if any assume buildings only; tests `render/drawStatic.test.ts`, `world/collisionGrid.test.ts`.

- [ ] **Step 1: Write the failing tests** — a chunk with two trees paints two shadow discs and two canopy images (or two flat discs without art); furniture paints in kind order; the collision grid reports a hit for a car crossing a trunk and none for a bench; the chunk raster of a 4000-tree tile stays under the 8 ms budget in a timed test with a generous ceiling (skip in CI if flaky).
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Generate** — `generate_game_art` `mode: "texture"`: `"top-down view of a single round deciduous tree canopy, summer green, soft leaf detail, transparent background, no shadow, no trunk visible"` at two sizes (the script scales), `"top-down view of a street lamp post, small dark grey circle head"`, `"top-down view of a wooden park bench"`, `"top-down view of a small bus shelter with a glass roof"`.
- [ ] **Step 4: Implement**, commit — `feat(arena): trees you can see and crash into`.

**As built (2026-09-10, PR 9b).** Furniture tuples carry a fourth element, the heading in whole
degrees from the nearest road within 30 m, so a bench sits along its street; the scatter is a
world-anchored jittered grid keyed by a hash of the cell (`cellNoise`) rather than a seeded random
walk, which makes overlapping and tile-cut polygons agree; scrub grows small trees at 1 per 160 m²;
furniture has its own cap (`MAX_FURNITURE_PER_TILE` 1500); the priority under the caps is mapped
first, then nearest a zone centre; the asset moved to `v2` because the tiles are served immutable;
no timed raster test (the fake context measures nothing). The cyclists of Task 9 were not built.

### Task 9 (stretch): Fietsers

- [ ] A `cycle` ped mode following roads at 5 m/s on `cycleway`/residential edges, a bike-and-rider strip, killable like a ped, fleeing off the bike. Only if 9a and 9b have merged and the owner still wants it; it is behaviour, not content.

### Task 10: PR 9b — docs, verification, the PR

- [ ] README map section (the layers, the caps, the budgets), spec §3 amendment, `npm run build`, the checkers, PR, CodeRabbit, merge on green.

## Self-review

- **Coverage:** cars (T1–T3), people (T4), weapons (T5), density (T2), trees and furniture (T7–T8), docs (T6, T10); cyclists deferred and said so.
- **Wire safety:** kinds and weapons appended; `p` row growth stated; the wire test at the new caps is in T1 and T5.
- **Placeholders:** prompts, numbers and file names are spelled out; the one open number is the tile budget, which the build report decides.
