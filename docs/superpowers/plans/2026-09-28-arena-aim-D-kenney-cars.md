# Aim round track D — Kenney cars — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Pure logic test-first; visual tasks end with a browser screenshot.

**Goal:** Traffic and player cars are real car shapes (Kenney Car Kit, CC0) instead of slab assemblies, keeping every live behaviour (wheels, steering, colours, police lights, lamps, brake lights, plates, wrecks); the bus, oldtimer and tank get rounder procedural bodies.

**Architecture:** Like the glTF characters (`characterAssets.ts`, `scripts/arena/pack-characters.ts`): a pinned download, a pack script to `public/arena/cars/` with a manifest, a lazy loader, and `buildVehicleModel` swapping in the glTF body when ready, with the procedural model as fallback.

**Spec:** `docs/superpowers/specs/2026-09-28-arena-aim-drive-cars-design.md` §3, §8, §9.

## Global Constraints

- Dutch strings; no inline `style`; JSDoc + explicit return types; functions ≤ 50 lines; named constants; Sentry on every `catch` (a transient network failure fetching a car file is a breadcrumb per AGENTS.md); commit subjects ≤ 72 chars; every message ends with a separate `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer line in its body, never in the subject.
- **Download approval covers exactly** `https://kenney.nl/media/pages/assets/car-kit/1a312ec241-1775131960/kenney_car-kit.zip` (≈ 4.8 MB, CC0). Nothing else. Cache in `.cache/arena/cars/` (gitignored); pin the zip's sha256 in the script on first download; only packed files are committed. Budget ≤ 1.5 MB packed.
- `@gltf-transform/core` + `functions` are already devDependencies (#746). Unzipping: use a small dependency-free approach (e.g. Node's `zlib.inflateRawSync` over the zip's central directory) or an existing devDependency — ask nobody for new runtime deps; a new devDependency only if unavoidable, stated in the report.
- No sim/wire changes; the sim footprint (`lengthOf × widthOf`) and heights (`VEHICLE_HEIGHT_M`) stay the truth — models are scaled to them. `render3d/` by value only inside `render3d/`/`view3d/`. Stay out of tracks A–C's files (`entities.ts`, `cockpit3d.ts`, `aimProbe.ts`, touch files); `vehicles3d.ts`, `vehicleModels.ts`, `vehicleShapes*.ts`, `vehicleParts.ts`, `vehicleLamps.ts`, `vehicleTrim.ts`, `sharedAssets.ts` are yours.
- Branch `feat/arena-kenney-cars` from the foundation; PR against `image`; no version bump.

### Task 1: Download, probe, pack

- [ ] `scripts/arena/pack-cars.ts` (+ pure `packCars.ts` with tests, injectable fetch/fs like `scripts/arena/files.ts`): download + sha256 pin; `--probe` lists every GLB in the zip (meshes, materials, textures, bounds, whether wheels are separate nodes). Record the findings in the report.
- [ ] Mapping (adjust after the probe, report it): compact → `hatchback-sports`/hatchback, sedan → `sedan`, sport → `sedan-sports` or `race`, police → `police`, van → `van`/`delivery`, pickup → `truck` (or the kit's pickup), tractor → `tractor`; bus/oldtimer/tank: none.
- [ ] Pack per kind: body without wheels (or wheels split into a separate node per axle side), dedup/prune/weld, one file per kind `public/arena/cars/<kind>.glb` + one shared wheel model if the kit has one; `manifest.json` (Zod schema in `src/lib/cityArena/carManifest.ts`, dependency-free like `characterManifest.ts`): per kind file, source name, native bounds, wheel positions (axle x, track z, radius), paint material/texture region, lamp anchors (head/tail/brake), plate anchors; `CREDITS.md`; `npm run arena:check-cars` + CI step next to `arena:check-characters`.
- [ ] Commit `feat(arena): pack the Kenney Car Kit for the 3D view`.

### Task 2: Load and build glTF cars

**Files:** create `render3d/carAssets.ts`, `render3d/gltfVehicle.ts` (+ tests); modify `render3d/vehicleModels.ts`, `render3d/vehicles3d.ts`, `render3d/sharedAssets.ts`.

- `buildVehicleModel(kind, colour)` keeps its `VehicleModel` contract (`root`, `wheels: WheelRig[]`, `lightBar`, `turret`): for a mapped kind with assets ready, the body is the cloned glTF, scaled non-uniformly to `lengthOf × widthOf × VEHICLE_HEIGHT_M`, facing +X, origin at the footprint centre on the ground; wheels are rigs at the manifest's axle positions with the kit's wheel geometry (spin/steer as today); body colour: tint the paint material (or its atlas region) to `bodyColour(kind, colour)` — one cached material per colour; police: livery colours + our light-bar lenses on the roof; lamps/brake glow/plates (#748's `vehicleLamps.ts`/`vehicleTrim.ts`) placed at the manifest anchors; wreck: materials swap to the charred colour.
- Before assets load (or on failure) the procedural model is built — and an entity pool variant change swaps a car once when the assets land (as the characters do: pool variant `gltf:<kind>`), keeping its steer memory.
- [ ] Tests (synthetic glTF fixture, no network): model fits the footprint within 2 %; wheels spin with speed and the front pair steers; colour tint changes the paint only; police has a light bar; wreck turns charred; dispose frees clones not shared assets; fallback before load.
- [ ] Browser check: traffic at "auto" and "laag", police chase lights, a wreck; screenshots `3d-cars-street.jpg`, `3d-cars-police.jpg`; draw calls per car ≤ today's.
- [ ] Commit `feat(arena): real car models from the Kenney Car Kit`.

### Task 3: Rounder bus, oldtimer and tank

- [ ] Smooth the three procedural kinds: rounded roof edges and front, wheel arches cut into the body line, curved windscreen (bus), running boards and round wings (oldtimer), sloped glacis and round turret (tank) — via more segments/bevels in `vehicleShapesHeavy.ts`/`vehicleShapes.ts`. Tests: footprint and heights unchanged; vertex budget ≤ 2× today's.
- [ ] Commit `feat(arena): rounder bus, oldtimer and tank`.

### Task 4: Docs, verification, report

- [ ] `3D-MODE.md`: "Cars" section (pipeline, manifest, mapping, fallback), module map, known limitations, screenshots; `public/arena/cars/CREDITS.md` (Kenney, CC0, kenney.nl link).
- [ ] `tsc`, `lint`, `vitest run`, de-slop. **Do not push or open a PR** — report back.

## Browser checks

Port **3024**, preview DB, `trainer@example.test` / `preview123`, `/arena/spelen?debug=1`, "Stad verkennen", 3D. Own tab (`tabs_create`), pass its `tabId`. `next dev --webpack`.
