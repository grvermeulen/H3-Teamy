# Immersion track 4 — city and vehicle detail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Geometry builders get unit tests (counts, bounds, determinism, quality gating); every task ends with a browser screenshot judged against its acceptance line.

**Goal:** The 3D city stops looking like blocks: varied Dutch façades with gables, shopfronts and balconies; kerbs, cycle paths and zebra crossings; bikes, bins and bollards along the pavements; three kinds of trees; smoother cars with lights and yellow plates; stars, a moon and pools of lamplight.

**Architecture:** Everything stays procedural, deterministic per structure/feature id (`idHash.ts`), built into the streamed cells (`buildCell.ts` → `worldCells.ts`) with merged or instanced geometry, and gated by render quality so "laag" keeps today's cost.

**Tech Stack:** three.js 0.186, canvas-painted textures (`textures.ts`), TypeScript 6.0.3, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-27-arena-immersion-design.md` §8, §10.

## Global Constraints

- JSDoc + explicit return types on exports; functions ≤ 50 lines; named constants; Sentry on every `catch`; commit subjects ≤ 72 chars; no inline `style`.
- `render3d/` imported by value only inside `render3d/` and `view3d/`. three.js stays `^0.186`. No new runtime dependencies; no downloaded assets (textures are painted on canvas or come from the existing `public/arena/sprites/` art).
- No simulation/collision changes: new clutter is visual only and must stay out of roads' carriageways and building footprints.
- Quality gating: new detail at "auto" and "hoog" only (and near-camera detail within `DETAIL_RADIUS_M`); "laag" draws what it draws today. Dense-cell draw calls at "auto" grow ≤ 30 % (instancing/merging); cell build still fits `WORLD_BUILD_BUDGET_MS`.
- Branch `feat/arena-city-detail` from `feat/arena-immersion-base`; PR against `image`; no version bump.
- Vehicles: track 1 hides your own car in first person and adds `cockpit3d.ts`; do **not** touch `entities.ts`, `cast3d.ts`, `viewModelPass.ts`, `viewmodel.ts`, `tracers.ts`, `projectiles3d.ts`, `bursts.ts`, `characters*.ts` (other tracks own them).

## File map

| File | Change |
| --- | --- |
| `render3d/textures.ts` | more façade styles and palettes; shopfront and door textures; normal-ish shading baked in |
| `render3d/buildingMesh.ts` (+ new `facadeDetail.ts`) | gable fronts, shopfront bands with awnings, balconies, sills/frames, roof overhangs |
| `render3d/pitchedRoof.ts` / new `roofDetail.ts` | chimneys, dormers |
| `render3d/roadMesh.ts` (+ new `streetMarkings.ts`) | raised kerbs, red cycle paths, zebra crossings |
| new `render3d/streetClutter.ts` | instanced bikes + racks, bins, bollards, signs, planters, hedges |
| `render3d/treeMesh.ts` | three species, per-instance variation |
| `render3d/vehicleShapes.ts`, `vehicleShapesHeavy.ts`, `vehicleParts.ts`, `vehicles3d.ts` | bevels, arches, lights (brake glow), plates, mirrors, darker glass |
| `render3d/sky.ts`, new `lampPools.ts` | stars, moon, light pools under lamps |
| `render3d/buildCell.ts`, `worldCells.ts`, `renderer3d.ts` | wiring + quality gating |
| `docs/tech/arena/3D-MODE.md` | "City detail" section, module map, before/after screenshots |

---

### Task 0: Baseline

- [ ] Start the dev server (below), take **before** screenshots at three fixed spots (Rhenen centre near the Cunera church, a Wageningen residential street, a road through fields) in third person and one from a car; save to the scratchpad and later into the PR. Record draw calls (`renderer.info.render.calls`) and frame time at each spot at "auto".

### Task 1: Façades and building silhouettes

- [ ] Façade styles: add at least brick in 4 colourways (red, brown, yellow, grey-blue), plaster in 5 tones, and a modern panel style; windows get frames, sills, occasional shutters/curtain tints; ground floors of buildings along main roads (`roadClass` primary/secondary/tertiary within ~12 m) or near landmarks get a **shopfront** band (large lit windows, a door, a sign strip) and an awning on ≈ 40 %; other ground floors get doors per module. Deterministic by structure id.
- [ ] Geometry: narrow terraced houses (footprint front ≤ 8 m, ≤ 3 floors) get a stepped or bell **gable** (trapgevel/klokgevel) rising above the eaves on the street-facing short side on ≈ 50 %; flats (≥ 4 floors) get balcony slabs with railings on ≈ 50 %; pitched roofs overhang 0.25 m and get chimneys (≈ 60 %) and dormers (≈ 30 % on roofs ≥ 8 m long). Near-camera only (within `DETAIL_RADIUS_M` ≈ 120 m, rebuilt when a cell enters/leaves that ring — reuse the cell rebuild path) or at "hoog" everywhere; decide by measured cost.
- [ ] Tests: style choice deterministic and spread over all styles; gables only on narrow short-sided footprints; shopfronts only near main roads/landmarks; "laag" builds exactly today's geometry (vertex count equal to a snapshot of the old builder for the fixture city in `testing/cityFixture.ts`).
- [ ] Screenshot at the three spots; commit `feat(arena): Dutch façades, gables and shopfronts`.

### Task 2: Streets

- [ ] Raised kerbs (0.12 m, bevelled) along every pavement edge; red cycle paths (1.6 m, `#8c3a33`-ish asphalt tone matched to the dusk palette) along primary/secondary roads wide enough, between carriageway and pavement; zebra crossings at junction approaches of residential+ roads; grass verges where the ground kind is grass beside a road. Markings stay decals on the road surface (`MARKING_Y_M`).
- [ ] Tests: kerb segments follow the pavement polylines; cycle paths only on qualifying roads; zebras only near junction nodes and never on motorways; determinism.
- [ ] Screenshot; commit `feat(arena): kerbs, cycle paths and zebra crossings`.

### Task 3: Street clutter and hedges

- [ ] `streetClutter.ts`: instanced parked bicycles (several colours; groups at bike racks near shops/stations, singles against façades), bins/containers, bollards at crossings, traffic signs (round/triangular on poles, a few Dutch types), planters; hedges along residential front gardens (between façade and pavement where the gap ≥ 1.5 m). Placement from tile data (roads, buildings, furniture) with id-seeded jitter; never in carriageways or footprints; ≤ `MAX_CLUTTER_PER_CELL`. One instanced mesh per clutter kind per cell.
- [ ] Tests: none inside building footprints or road carriageways (use the fixture city); counts capped; deterministic; nothing at "laag".
- [ ] Screenshot; commit `feat(arena): bikes, bins, bollards and hedges on the streets`.

### Task 4: Trees

- [ ] Three species chosen per tree id (round broadleaf with 3–5 lobed canopy clusters, tall narrow poplar, conifer cone stack), per-instance scale ±20 %, yaw, and canopy tint from a palette of evening greens; trunks tapered. Keep instancing (one instanced mesh per species part per cell).
- [ ] Tests: species spread, determinism, instance counts equal tree counts, "laag" keeps today's two-green look.
- [ ] Screenshot (a wood near Bennekom); commit `feat(arena): three tree species with varied canopies`.

### Task 5: Vehicles

- [ ] Bodies: bevelled slabs (chamfer the existing `slab` primitive or add `roundedSlab`), wheel arches (darker cut-outs over the wheels), side mirrors, door lines, darker tinted glass with the existing gloss; **lights**: emissive headlights (warm white) and taillights (red) on every passenger kind, brake lights brighter while decelerating (add `braking: boolean` to `Vehicle3dInput`, computed in `vehicles3d.ts` from the speed it already receives frame to frame — do not edit `entities.ts`), dark when wrecked; yellow Dutch plates front and back. Heavy kinds (bus, tractor, tank) get lights/plates where fitting.
- [ ] Tests: every passenger kind has light meshes; brake glow rises on deceleration and not at steady speed; wrecks have no glow; draw calls per vehicle ≤ today's + 2.
- [ ] Screenshot of traffic at night; commit `feat(arena): smoother cars with lights and Dutch plates`.

### Task 6: Sky and lamplight

- [ ] `sky.ts`: a star field (points, fading toward the horizon glow) and a moon disc aligned with the moon light's direction in `renderer3d.ts`. `lampPools.ts`: soft additive radial decals on the pavement under each street lamp (instanced quads, `depthWrite: false`, fog on), strength by quality.
- [ ] Tests: stars never below the horizon; one pool per lamp in the cell; none at "laag".
- [ ] Screenshot; commit `feat(arena): stars, moon and pools of lamplight`.

### Task 7: Budget, docs, verification, PR

- [ ] Measure draw calls and frame time at the Task 0 spots (auto + laag); if "auto" grew > 30 % in calls, merge/instance further or move detail to "hoog". Record before/after numbers in the PR body.
- [ ] `docs/tech/arena/3D-MODE.md`: "City detail" section, module map rows, performance notes updated, before/after screenshots in `docs/tech/arena/img/3d/`.
- [ ] Full verification (`tsc`, `lint`, `vitest run`, `build`), de-slop, push, PR `feat(arena): richer 3D city — façades, streets, trees and cars` against `image`, listing rulings. Do not merge.

## Browser checks

Port **3014** (launch config `h3-immersion-city`), preview DB, `trainer@example.test` / `preview123`, `/arena/spelen?debug=1`, "Stad verkennen", 3D, render quality set in the Menu. Use your **own browser tab** (`tabs_create`) and pass its `tabId` to every call.
