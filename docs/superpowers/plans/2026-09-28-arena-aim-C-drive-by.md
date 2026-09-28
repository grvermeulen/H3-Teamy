# Aim round track C — drive-by animation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Pure logic test-first; visual tasks end with a browser screenshot.

**Goal:** Shooting from a car shows the gun held out of the window (or over the dash), and the shots leave that gun — for everyone in third person, and in the first-person cockpit.

**Architecture:** A pure pose function picks the window side and arm/gun transform from the car's heading and the aim; a small `driveBy3d` object (forearm + weapon model) is placed per armed driver by the entity sync; the cockpit swaps its right hand for a gun hand while shooting; the muzzle map gains drivers' muzzles.

**Spec:** `docs/superpowers/specs/2026-09-28-arena-aim-drive-cars-design.md` §7, §9.

## Global Constraints

- Dutch strings; no inline `style`; JSDoc + explicit return types; functions ≤ 50 lines; named constants; Sentry on every `catch`; commit subjects ≤ 72 chars ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No sim/wire changes. Place the arm as its own object from the car's transform (do **not** edit `vehicleModels.ts`/`vehicleShapes*.ts`/`vehicles3d.ts` — track D replaces the car bodies). Stay out of track A's and B's files; shared (`entities.ts`, `cast3d.ts`, `effects3d.ts`): small local edits.
- Branch `feat/arena-drive-by` from the foundation; PR against `image`; no version bump.

### Task 1: The drive-by pose

**Files:** create `render3d/driveByPose.ts` (+ test).

```ts
export type WindowSide = "left" | "right" | "front";
export const FRONT_CONE_RAD: number; // 35° either side of ahead
export function windowSideFor(heading: number, aim: number): WindowSide;
/** Where the shoulder pivot sits in car space for a kind and side (from `COCKPITS`), and the arm's yaw toward the aim. */
export function driveByPose(
  kind: VehicleKind,
  side: WindowSide,
  heading: number,
  aim: number,
): { shoulder: Vec3; yaw: number; pitch: number };
export const SHOWN_AFTER_SHOT_S: number; // 1.2
export function showsDriveBy(input: {
  holdsGun: boolean;
  secondsSinceShot: number | null;
  ads: boolean;
  kind: VehicleKind;
}): boolean;
```

Left = driver window (Dutch LHD); right = passenger window (arm across the cabin); front = over the dash through the windscreen. Tank never; bus: left only.

- [ ] Tests: aim 90° left of heading → left; right → right; 10° → front; a tank never shows; fists/bat never; shown for 1.2 s after a shot, and while ADS for the local player.
- [ ] Commit `feat(arena): work out a drive-by's window and aim`.

### Task 2: The arm and gun out of the window (third person, all clients)

**Files:** create `render3d/driveBy3d.ts` (+ test); modify `render3d/entities.ts` (per armed driver: claim/pose/free; shots via `nextShotTick`; local ADS via `EntityView`), `render3d/muzzleMap` usage (driver muzzle), `render3d/cast3d.ts`.

- Model: forearm + hand (reuse `viewmodel.ts`'s arm geometry, skin tone; other players' vest hue as sleeve) and `createWeaponModel(weapon)`; placed at the car's transform + shoulder, rotated to the aim; muzzle via the weapon tip (`muzzleTipOf`) → `localToWorld`.
- The muzzle map gets `driverId → gun muzzle` so flashes and tracers leave the gun outside the car (existing `shooterOf` body match already identifies the driver by the car position — keep that consistent: a driver's flash goes to the drive-by gun's muzzle).
- [ ] Tests: a local driver with a pistol firing gets an arm on the left when aiming left; none when unarmed; freed when the driver stops shooting or leaves; the muzzle map holds the gun tip outside the car's footprint.
- [ ] Browser check (third person): pistol, uzi, shotgun drive-by to both sides and forward; screenshot `3d-drive-by.jpg`.
- [ ] Commit `feat(arena): hold the gun out of the car window to shoot`.

### Task 3: The cockpit gun hand (first person)

**Files:** modify `render3d/cockpit3d.ts`, `render3d/viewModelPass.ts` (+ tests).

- While a drive-by shows for the local player: the right hand leaves the wheel (the left stays and turns it), and a gun hand appears at the window side reaching out (left/right/front as the pose says), pointing along the aim, with the recoil kick and the view model's muzzle flash; its tip is the first-person muzzle for the effects.
- [ ] Tests: the right hand hides while shooting and returns after; the gun hand's barrel points along the aim; the muzzle is outside the cockpit's glass line.
- [ ] Browser check (V, in a car, firing left/right/front): screenshot `3d-cockpit-drive-by.jpg`.
- [ ] Commit `feat(arena): shoot from the cockpit with the gun out of the window`.

### Task 4: Docs, verification, report

- [ ] `3D-MODE.md`: "Drive-bys" section, module map rows, screenshots.
- [ ] `tsc`, `lint`, `vitest run`, de-slop. **Do not push or open a PR** — report back.

## Browser checks

Port **3023**, preview DB, `trainer@example.test` / `preview123`, `/arena/spelen?debug=1`, "Stad verkennen", 3D; board a car with `window.__arena.dispatch({ enter: true }, 2)` near one, fire with `dispatch({ fire: true, aim }, ticks)`. Own tab (`tabs_create`), pass its `tabId`. `next dev --webpack`.
