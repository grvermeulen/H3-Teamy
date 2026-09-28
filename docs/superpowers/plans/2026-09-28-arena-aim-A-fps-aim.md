# Aim round track A — shooter aiming on desktop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Pure logic is written test-first (superpowers:test-driven-development); visual tasks end with a browser screenshot.

**Goal:** In 3D the crosshair sits at the centre, what is under it is what you shoot, right mouse aims down the sights, the mouse feels like a shooter's, and `M` opens the map.

**Architecture:** A per-frame camera ray (`aimProbe.ts`) finds the aim point; the runtime turns it into the sim's flat aim heading; the local shooter's tracers converge onto that 3D point. ADS is the foundation's `ads` button (pointer source) plus presentation (FOV, view-model sights pose, over-the-shoulder zoom, sensitivity scaling).

**Spec:** `docs/superpowers/specs/2026-09-28-arena-aim-drive-cars-design.md` §4, §5, §9.

## Global Constraints

- Dutch strings; no inline `style`; JSDoc + explicit return types on exports; functions ≤ 50 lines; named constants; Sentry on every `catch`; commit subjects ≤ 72 chars, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No sim/wire changes (the foundation already carries `ads`). `render3d/` imported by value only inside `render3d/` and `view3d/`.
- Stay out of track B's files (touch: `touchStick.ts`, new touch look/aim-assist modules, `ArenaTouchButtons.tsx`, the touch parts of `CityArenaOverlay.tsx`), track C's (`driveBy*`, `cockpit3d.ts`, driver parts of `entities.ts`) and track D's (`vehicleModels.ts`, `vehicleShapes*.ts`, `vehicles3d.ts`, car assets). Shared files (`useView3d.ts`, `arenaRuntime.ts`, `CityArenaOverlay.tsx`, `muzzleBlend.ts`/`tracers.ts`): keep edits small and local.
- Branch `feat/arena-fps-aim` from the foundation; PR against `image`; no version bump.

### Task 1: Centred crosshair and the aim probe

**Files:** create `render3d/aimProbe.ts` (+ test); modify `render3d/overlay3d.ts`, `render3d/index.ts` (+ tests).

```ts
export type AimTarget = "character" | "vehicle" | "building" | "ground" | "sky";
export type AimPoint = {
  x: number;
  y: number;
  height: number;
  distance: number;
  target: AimTarget;
};
/** The nearest thing under the screen centre within `rangeM`. Allocates nothing per call. */
export function probeAim(
  camera: PerspectiveCamera,
  world: AimWorld,
  rangeM: number,
  out: AimPoint,
): AimPoint;
export type AimWorld = {
  characters: readonly { x: number; y: number; dead: boolean; self: boolean }[];
  vehicles: readonly {
    x: number;
    y: number;
    heading: number;
    length: number;
    width: number;
    height: number;
    own: boolean;
  }[];
  buildings: {
    query(minX, minY, maxX, maxY): readonly { ring: Point[]; height: number }[];
  };
};
```

Capsule radius 0.4 m, height 1.8 m (skip self, dead count as low boxes); vehicle oriented boxes (skip your own car); building prisms from the collision grid obstacles near the ray (walk the ray in 8 m steps, query the grid per step — never scan the whole map); ground plane y = 0. `View3dHandle.render` returns (or exposes via `aimPoint()`) the frame's aim point. The crosshair draws at the screen centre always (remove the projected-point placement); keep the dead/hidden rule.

- [ ] Tests: ray through a capsule 20 m ahead hits it at ~20 m; a wall in front of a person is hit first; aiming at the sky returns `sky` at range; pitch down hits the ground at the right distance for the camera height; your own body/car are ignored; no allocation in a loop of 1 000 probes (spy on `Vector3` constructor count, or reuse assertion).
- [ ] Commit `feat(arena): centre the crosshair and probe what lies under it`.

### Task 2: Aim where the crosshair points

**Files:** modify `components/cityArena/arenaRuntime.ts` / `view3d/useView3d.ts` (where `input3d`/the 3D aim override lives), `render3d/muzzleBlend.ts`, `render3d/tracers.ts`, `render3d/projectiles3d.ts` (+ tests).

- The sim aim in 3D = `atan2(aim.y − self.y, aim.x − self.x)` from the local player (or car centre when driving) to the aim point; the camera yaw when the point is within `MIN_AIM_REACH_M` 1 m. Touch aim sticks (track B) still override when used.
- Local shooter's rounds: blend from the muzzle toward the ray to the aim point: the drawn height interpolates from the muzzle's height to the aim point's height at the aim point's distance (beyond it, continue on that slope, clamped ≥ 0). Remote rounds unchanged.
- [ ] Tests: third-person camera offset right of the player, a target 30 m ahead slightly left: the sim aim points at the target, not along the camera yaw; a round's drawn height reaches the aim point's height at its distance; remote rounds unchanged (regression).
- [ ] Commit `feat(arena): shoot at what the crosshair covers`.

### Task 3: Aim down the sights

**Files:** modify `input/mouseLook.ts` (right button → `setButton("pointer","ads",…)`, suppress `contextmenu` on the playfield canvas, sensitivity × zoom), `render3d/cameraRig.ts` (ADS FOV/boom), `render3d/viewmodel.ts` (sights pose per weapon, eased), `render3d/overlay3d.ts` (rifle scope overlay: dark vignette ring + fine reticle on the HUD canvas), the frame plumbing that tells the renderer `ads` (+ tests).

- Per-weapon zoom table `ADS_FOV_DEG` (pistol/uzi/shotgun 50, rifle 24, rocket 45, fist/bat no ADS); ease 0.15 s in/out; third person boom `ADS_BACK_M` 1.9, FOV 45; sensitivity × `tan(adsFov/2)/tan(baseFov/2)`.
- [ ] Tests: holding the right button sets `ads` in the input snapshot and releasing clears it; `contextmenu` default is prevented only on the playfield; the rig's FOV eases to the weapon's ADS FOV; the view model's barrel line passes through screen centre in ADS (project the muzzle and a point 1 m ahead — both within 2 px of centre); fists do not zoom.
- [ ] Browser check: FP pistol ADS, rifle scope, third-person ADS; screenshots `3d-ads-pistol.jpg`, `3d-ads-rifle.jpg`.
- [ ] Commit `feat(arena): aim down the sights with the right mouse button`.

### Task 4: Mouse feel, `M` for the map

- `mouseSensitivity` setting (Zod, default 1, 0.25–2.5) + "Muisgevoeligheid" slider in `ArenaSettingsSheet.tsx`; `mouseLook` multiplies its rad/px by it (and by the ADS scale); no smoothing/acceleration on locked pointer deltas.
- `M` (`KeyM`) toggles the map dialog via the overlay's existing `openMap`/close; ignored while typing; documented in the controls hint line ("M kaart").
- [ ] Tests: sensitivity scales yaw per px; `M` opens and a second `M` closes; not while an input has focus.
- [ ] Commit `feat(arena): mouse sensitivity and M for the map`.

### Task 5: Docs, verification, report

- [ ] `docs/tech/arena/3D-MODE.md`: "Aiming" section (probe, sim aim, ADS table, sensitivity, M), update the "Bullets stay in the flat plane" limitation, screenshots.
- [ ] `tsc`, `lint`, `vitest run`, de-slop. **Do not push or open a PR** — report back.

## Browser checks

Port **3021**, preview DB, `trainer@example.test` / `preview123`, `/arena/spelen?debug=1`, "Stad verkennen", 3D. Own browser tab (`tabs_create`), pass its `tabId` everywhere. Turbopack refuses a junctioned `node_modules`: run the dev server with `next dev --webpack`.
