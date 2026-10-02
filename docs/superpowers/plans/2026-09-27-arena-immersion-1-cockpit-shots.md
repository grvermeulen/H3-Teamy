# Immersion track 1 — cockpit and muzzle-origin shots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Pure logic is written test-first (superpowers:test-driven-development); visual tasks end with a browser screenshot checked against the acceptance line.

**Goal:** First person in a vehicle shows a real cockpit (wheel turning in both hands, dashboard, pillars, bonnet), and every shot, flash and rocket visibly leaves the weapon's muzzle.

**Architecture:** The cockpit is a per-kind model drawn in the existing view-model pass (own scene/camera, depth cleared), anchored in car space; the own car's exterior hides in first person. Shots keep the sim's flat line but are _drawn_ from a per-owner muzzle point that converges onto that line within `CONVERGE_M`.

**Tech Stack:** three.js 0.186, TypeScript 6.0.3, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-27-arena-immersion-design.md` §4, §5, §9, §10.

## Global Constraints

- Dutch user-facing strings; no inline `style`; JSDoc + explicit return types on exports; functions ≤ 50 lines; named constants; Sentry on every `catch`; commit subjects ≤ 72 chars.
- `render3d/` is imported by value only inside `render3d/` and `components/cityArena/view3d/`.
- No simulation, wire or netcode changes.
- Nothing allocated per frame in the steady state (reuse scratch vectors, as the existing code does).
- Branch `feat/arena-cockpit-shots` from `feat/arena-immersion-base`; PR against `image`; no version bump.

## File map

| File                                                                                     | Change                                                                                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/cityArena/render3d/cockpitSpecs.ts`                                             | **new** — `CockpitSpec`, `COCKPITS: Record<VehicleKind, CockpitSpec>`                                                       |
| `src/lib/cityArena/render3d/cockpit3d.ts`                                                | **new** — builds a kind's cockpit model (cached geometry per kind, per-colour bonnet), poses wheel/needle/hands/header glow |
| `src/lib/cityArena/render3d/cameraRig.ts`                                                | seat pose from `COCKPITS[kind]`; `RigInput.driving` gains `kind`                                                            |
| `src/lib/cityArena/render3d/index.ts`                                                    | `Focus.driving` gains `kind` (+ `focusOf`)                                                                                  |
| `src/lib/cityArena/render3d/entities.ts`                                                 | hides own vehicle in first person; `LocalCharacter.vehicle`; per-frame `muzzles` map                                        |
| `src/lib/cityArena/render3d/viewModelPass.ts`, `viewmodel.ts`                            | pass shows hands **or** cockpit; exposes the view-model muzzle in world space                                               |
| `src/lib/cityArena/render3d/cast3d.ts`                                                   | chooses hands/cockpit/none; hands the muzzle map to the effects                                                             |
| `src/lib/cityArena/render3d/muzzleBlend.ts`                                              | **new** — pure convergence maths shared by tracers and projectiles                                                          |
| `src/lib/cityArena/render3d/tracers.ts`, `projectiles3d.ts`, `bursts.ts`, `effects3d.ts` | draw from the muzzle                                                                                                        |
| `src/lib/cityArena/render3d/sharedAssets.ts`                                             | frees cockpit caches                                                                                                        |
| `docs/tech/arena/3D-MODE.md`                                                             | cockpit + muzzle sections, module-map rows, screenshots                                                                     |

---

### Task 1: Cockpit spec table and the seat pose

**Files:** create `render3d/cockpitSpecs.ts` (+ test); modify `cameraRig.ts`, `index.ts` (`Focus`, `focusOf`) and their tests.

**Interfaces — produces:**

```ts
export type CockpitSpec = {
  /** Eye above the ground, metres. */
  eyeHeightM: number;
  /** Eye ahead (+) / behind (−) the footprint centre along the car, metres. */
  eyeForwardM: number;
  /** Eye left of the centre line (Dutch cars: wheel on the left), metres (positive = left). */
  eyeLeftM: number;
  /** Wheel: radius, distance ahead of the eye, drop below the eye, tilt back from vertical (rad). */
  wheel: {
    radiusM: number;
    aheadM: number;
    dropM: number;
    tiltRad: number;
  } | null;
  /** Dashboard top height above the ground and distance ahead of the eye, metres. */
  dash: { heightM: number; aheadM: number };
  /** Bonnet length ahead of the windscreen base; 0 for a flat-fronted bus/van cab. */
  bonnetM: number;
  /** Windscreen base and header heights, pillar half-spread, roof edge, metres. */
  glass: { baseM: number; headerM: number; pillarHalfM: number };
  /** "car" | "open" (tractor: frame, no roof) | "hatch" (tank: periscope frame, no wheel). */
  frame: "car" | "open" | "hatch";
};
export const COCKPITS: Readonly<Record<VehicleKind, CockpitSpec>>;
export function seatOffset(kind: VehicleKind): {
  forwardM: number;
  leftM: number;
  heightM: number;
};
```

`RigInput.driving` becomes `{ length: number; heading: number; kind: VehicleKind } | null`. `firstPersonPose` places the eye at the car centre + `forward·eyeForwardM` + `left·eyeLeftM` (left of heading `h` in sim coordinates is `(sin h, −cos h)` — keep the existing sign convention of `SEAT_SIDE_M`), height `eyeHeightM`; delete `SEAT_EYE_HEIGHT_M`/`SEAT_SIDE_M`.

- [ ] Write `cockpitSpecs.test.ts`: every `VEHICLE_KINDS` entry has a spec; the eye lies inside the kind's footprint (`|eyeForwardM| < lengthOf/2`, `eyeLeftM < widthOf/2`) and below `VEHICLE_HEIGHT_M`; bus/tractor/van eyes sit higher than the sedan's; the tank has `wheel: null` and `frame: "hatch"`; sedan `eyeLeftM > 0`.
- [ ] Run it, see it fail; write the table (start from the models in `vehicleShapes*.ts`: roof heights, windscreen positions) and `seatOffset`; pass.
- [ ] Extend `cameraRig.test.ts`: in first person driving a sedan heading 0 the camera sits at the spec's forward/left offset and height; a bus's eye is higher; on foot unchanged.
- [ ] Thread `kind` through `Focus`/`focusOf` (`index.ts`) and `placeCamera`; run `render3d` tests; commit `feat(arena): seat the first-person driver per vehicle kind`.

### Task 2: The cockpit model

**Files:** create `render3d/cockpit3d.ts` (+ test); modify `sharedAssets.ts`.

**Interfaces — produces:**

```ts
export type CockpitInput = {
  kind: VehicleKind;
  colour: number;
  steer: number;
  speedMps: number;
  siren: boolean;
  tick: number;
  dt: number;
};
export type Cockpit3d = {
  /** Root in car space: +X forward, +Y up, +Z right, origin at the footprint centre on the ground. */
  object: Object3D;
  update(input: CockpitInput): void;
  dispose(): void;
};
export function createCockpit3d(): Cockpit3d; // rebuilds its model when kind/colour change
export const WHEEL_TURN_RAD: number; // wheel angle at steer ±1 (≈ 2.1 rad)
export const SPEEDO_MAX_MPS: number; // needle end stop
export function disposeCockpitAssets(): void;
```

Build with `lowPoly.ts` `block`/`rod` + `mergeParts` in vertex colours and the existing lit character/vehicle materials (dark dash plastic, grey trim, body-colour bonnet via `bodyColour(kind, colour)`). Moving parts are separate objects: `wheelPivot` (rim torus-ish ring of rods + three spokes + hub, with both hands parented so they turn with it), `needle`, `headerGlow` (police). Hands: reuse `viewmodel.ts`'s arm geometry (export it as `armGeometry` if needed) gripping the rim at ten-to-two. Windscreen: a single quad with an additive faint sheen (`glowMaterial`-style, low opacity), frame and A-pillars as blocks. Open (tractor): side frame bars, no roof. Hatch (tank): a ring rim at eye height with two vision slits framed, grips instead of a wheel.

- [ ] Tests: `createCockpit3d().update({kind:"sedan",…,steer:1})` turns the wheel pivot by `WHEEL_TURN_RAD` about its column axis and `steer:-1` the opposite way; the needle angle grows with speed and clamps at `SPEEDO_MAX_MPS`; the hands are children of the wheel pivot (they turn with it); switching kind rebuilds (object's model child replaced), same kind/colour does not; the bonnet part carries the body colour (vertex colour sample equals `bodyColour`); tank has no wheel pivot; police `siren:true` makes `headerGlow.visible` flip with the tick like `vehicles3d`'s light bar; geometry is shared between two cockpits of one kind; `disposeCockpitAssets` frees it.
- [ ] Implement, keeping each builder function ≤ 50 lines (one per frame kind + shared parts).
- [ ] Wire `disposeCockpitAssets` into `disposeSharedAssets` (+ its test).
- [ ] Commit `feat(arena): cockpit model with a turning wheel and dashboard`.

### Task 3: Show the cockpit, hide your own car

**Files:** modify `entities.ts`, `viewModelPass.ts`, `cast3d.ts` (+ tests).

**Interfaces:**

```ts
// entities.ts
export type LocalVehicle = {
  id: number;
  kind: VehicleKind;
  colour: number;
  steer: number;
  speedMps: number;
  heading: number;
  x: number;
  y: number;
  siren: boolean;
  wrecked: boolean;
};
export type LocalCharacter = {
  /* existing fields */ vehicle: LocalVehicle | null;
};
// EntityView gains nothing new: firstPerson already exists.

// viewModelPass.ts
export type ViewModelPass = {
  update(
    camera: PerspectiveCamera,
    input: ViewModelInput | null,
    cockpit?: CockpitPose | null,
  ): OverlayPass | null;
  muzzleWorld(target: Vector3): boolean; // see Task 4
  dispose(): void;
};
export type CockpitPose = CockpitInput & {
  x: number;
  y: number;
  heading: number;
};
```

- `syncVehicle`: when `view.firstPerson` and the car is the local player's (`driverOf(...)?.id === scene.localPlayerId`) and not wrecked, set its object invisible and fill `local.vehicle`; otherwise visible. The local player is still "hidden" in a car as today.
- `viewModelPass.update`: with a `cockpit` pose, hide the hands, place the cockpit root in the pass scene at `(x, 0, y)` rotated `headingToRotationY(heading)` (the pass camera copies the city camera, so car space lines up with the world), update it, return the pass. The pass camera's far plane must cover the bonnet: raise `VIEW_MODEL_FAR_M` to ≥ 8 m.
- `cast3d.update`: first person + `local.vehicle` (not wrecked, alive) → cockpit pose; first person on foot → hands (today); else null.
- [ ] Tests: entities — own car invisible in first person, visible in third person and for another player's car; `local.vehicle` carries the steer the wheels got. viewModelPass — cockpit pose shows the cockpit and hides the hands, `null` input + no cockpit returns `null`. cast3d — driving in first person asks for the cockpit, on foot for the hands, dead for neither.
- [ ] Browser check (see "Browser checks" below): enter a car, press V: wheel in both hands, dash, pillars, bonnet in the car's colour; steering turns the wheel; no car shell poking through; bus and tractor too. Screenshot `docs/tech/arena/img/3d/3d-cockpit.jpg`.
- [ ] Commit `feat(arena): drive from the cockpit in first person`.

### Task 4: Muzzle points per shooter

**Files:** create `render3d/muzzleBlend.ts` (+ test); modify `entities.ts`, `viewmodel.ts`, `viewModelPass.ts` (+ tests).

**Interfaces:**

```ts
// muzzleBlend.ts
/** Rounds are drawn from the muzzle and meet the sim's flat line after this many metres flown. */
export const CONVERGE_M = 15;
/** Eased share (0 at the muzzle … 1 on the line) for a distance flown. */
export function convergeShare(flownM: number): number; // smoothstep(0, CONVERGE_M)
/** Writes the drawn point of a round into `out` (three.js space). `muzzle` null = today's point. */
export function blendedRoundPoint(
  x: number,
  y: number,
  flownM: number,
  muzzle: Readonly<Vector3> | null,
  out: Vector3,
): Vector3;
// entities.ts
export type EntitySync = {
  /* existing */ muzzles: ReadonlyMap<number, Vector3>;
}; // ownerId → world muzzle
// viewmodel.ts
export type ViewModel = {
  /* existing */ muzzleWorld(target: Vector3): boolean;
};
```

- `entities`: after each player/cop `placeCharacter`, call `slot.item.muzzleWorld(scratch)`; keep one `Vector3` per owner id in a pooled map (reuse vectors; delete owners not seen this frame). Verify first that player ids and cop ids never collide (both come from the state's id counter — read `sim/players.ts`, `sim/cops.ts`); if they can, key by `"p:"|"c:"` prefix instead and adjust `ownerId` lookups accordingly (bullets carry the shooter id; `hits.ts`/`cops.ts` show which).
- First person on foot: your own entry comes from `hands.muzzleWorld` (view model holder's tip → `localToWorld`; valid because the pass camera sits at the city camera's world pose) and overrides the hidden body's.
- [ ] Tests: `convergeShare(0)=0`, `(CONVERGE_M)=1`, monotonic, clamped; `blendedRoundPoint` at 0 m equals the muzzle, at ≥ `CONVERGE_M` equals `(x, PERSON_CHEST_HEIGHT_M, y)`; entities map holds a cop's and another player's muzzle and drops owners gone; view-model muzzle for the pistol lies right of and below the camera centre, in front of it.
- [ ] Commit `feat(arena): know where every shooter's muzzle is`.

### Task 5: Tracers, flashes and rockets leave the muzzle

**Files:** modify `tracers.ts`, `projectiles3d.ts`, `bursts.ts`, `effects3d.ts`, `cast3d.ts` (+ tests).

- `Effects3d.sync(scene, focus, ownMuzzleHidden, muzzles?)`: pass the map through. Tracers: head = `blendedRoundPoint(bullet, flown, muzzles.get(ownerId))`; tail = the blended point `tail` metres back along the round, clamped so it never passes behind the muzzle (compute the tail with `flown − tail`, floor 0). Projectiles: body and trail points via the same blend. Muzzle effects (no owner on `EffectState`): the shooter is the character within `MUZZLE_MATCH_M` (reuse the `isOwnMuzzle` idea generalised to "nearest owner in the map whose body is within reach"); burst at that muzzle point when found, else today's. In first person your own world flash stays hidden (the view model flashes), but its point light moves to the view-model muzzle.
- [ ] Tests: a round 1 m out of a known muzzle is drawn within 0.2 m of the muzzle; at 20 m it is on the flat line; an owner missing from the map draws exactly as before (regression); the tail never extends behind the muzzle; a rocket's body starts at the muzzle; a muzzle effect bursts at the matching owner's muzzle.
- [ ] Browser check: first person pistol/uzi/rifle/rocket — tracers streak from the gun toward the crosshair; third person — from the hand; a cop shooting — from the cop's gun. Screenshot `3d-muzzle-tracers.jpg` (use `?debug=1` → `window.__arena.dispatch({ fire: true, … }, ticks)` to hold fire).
- [ ] Commit `feat(arena): draw shots, flashes and rockets from the muzzle`.

### Task 6: Docs, verification, PR

- [ ] `docs/tech/arena/3D-MODE.md`: new "Cockpit" and "Shots leave the weapon" sections, module-map rows (`cockpitSpecs.ts`, `cockpit3d.ts`, `muzzleBlend.ts`), update the "Bullets stay in the flat plane" limitation (drawn from the muzzle, converging in 15 m), screenshots.
- [ ] Full verification: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build` (revert regenerated `docs/**`, icons, `next-env.d.ts`).
- [ ] De-slop pass (AGENTS.md), then push and open the PR `feat(arena): cockpit view and shots from the muzzle` against `image`, body listing rulings made and screenshots. Do not merge.

## Browser checks

Dev server for this worktree on port **3011** (launch config `h3-immersion-cockpit`), preview DB, log in as `trainer@example.test` / `preview123`, open `/arena/spelen?debug=1`, "Stad verkennen", switch to 3D, V for first person. Use your **own browser tab** (`tabs_create`) and pass its `tabId` to every browser call — other tracks share the pane. Pointer lock is refused in the in-app browser; mouse-look falls back to lock-free.
