# Aim round track B — touch controls in 3D — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Pure logic test-first; UI tasks with component tests (Testing Library) and a touch-emulated browser check.

**Goal:** On a phone in 3D you can look around without firing: a look pad, a hold-to-fire button you can drag to aim, an ADS toggle, and light aim assist.

**Architecture:** A touch look controller (pure, pointer-event driven) feeds camera yaw/pitch deltas like the mouse does; the fire button sets the `buttons` fire source; the ADS toggle holds the `buttons` source of the foundation's `ads` button; `aimAssist.ts` scales touch look speed near targets. 2D keeps the twin-stick.

**Spec:** `docs/superpowers/specs/2026-09-28-arena-aim-drive-cars-design.md` §4, §6, §9.

## Global Constraints

- Dutch strings (labels, aria-labels, tip); no inline `style` (Tailwind); JSDoc + explicit return types; functions/components ≤ 50 lines; named constants; Sentry on every `catch`; commit subjects ≤ 72 chars; every message ends with a separate `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer line in its body, never in the subject.
- No sim/wire changes. Stay out of track A's files (`mouseLook.ts`, `keyboard.ts`, `overlay3d.ts`, `aimProbe.ts`, `cameraRig.ts`, `viewmodel.ts`), track C's and track D's. Shared (`useView3d.ts`, `cameraYaw.ts`, `CityArenaOverlay.tsx`, `arenaRuntime.ts`): small local edits.
- Branch `feat/arena-touch-3d` from the foundation; PR against `image`; no version bump.

### Task 1: Look pad

**Files:** create `input/touchLook.ts` (+ test); modify `view3d/useView3d.ts` or `input/cameraYaw.ts` (where yaw/pitch deltas are applied), `CityArenaOverlay.tsx` (mount in 3D + touch).

```ts
export const TOUCH_LOOK_RAD_PER_PX: number; // base, × the "Kijkgevoeligheid" setting
export type TouchLook = {
  onDown(e: PointerEvent): void;
  onMove(e: PointerEvent): void;
  onUp(e: PointerEvent): void;
  take(): {
    yaw: number;
    pitch: number;
  } /* accumulated deltas since last take, radians */;
};
export function createTouchLook(scale: () => number): TouchLook;
```

One pointer id at a time; pinch/second finger ignored; deltas accumulate between frames.

- [ ] Tests: a 100 px drag right turns yaw by 100 × rate; a second finger is ignored; releasing stops; `take()` resets.
- [ ] In 3D on touch: the aim stick is not rendered; the look pad covers the right half minus the buttons; never sets `fire`.
- [ ] Commit `feat(arena): look around on touch without firing`.

### Task 2: Fire button and ADS toggle

**Files:** modify `ArenaTouchButtons.tsx` (+ test), `CityArenaOverlay.tsx`.

- Fire (large, bottom right, aria "Schieten"): pointerdown → `setButton("buttons","fire",true)`, up/cancel → false; a drag that starts on it also feeds the look controller.
- ADS toggle (scope icon, aria "Richten", pressed state visible): toggles `setButton("buttons","ads",on)`; switching weapon to fist/bat or entering the death screen turns it off.
- [ ] Tests (Testing Library): holding fire sets and releasing clears; dragging from fire also turns the look; the toggle flips `ads` and shows its pressed state; buttons render only in 3D touch mode.
- [ ] Commit `feat(arena): hold-to-fire and a sights toggle on touch`.

### Task 3: Aim assist (touch only)

**Files:** create `input/aimAssist.ts` (+ test); apply in the touch look path.

```ts
export const ASSIST_CONE_RAD: number; // ≈ 2°
export const ASSIST_FRICTION: number; // 0.45
export function assistScale(
  camera: { x: number; y: number; height: number; yaw: number; pitch: number },
  targets: readonly { x: number; y: number; height: number }[],
): number; // 1 or ASSIST_FRICTION
```

Targets: living other players, cops, peds within 60 m; never your own car or yourself. Only touch look is scaled; the mouse never.

- [ ] Tests: a target dead ahead → friction; 5° off → 1; behind → 1; beyond range → 1.
- [ ] Commit `feat(arena): light aim assist for touch look`.

### Task 4: Tip, settings, docs, verification

- "Kijkgevoeligheid" slider (setting `touchLookSensitivity`, default 1, 0.25–2.5) in the Menu (touch devices); a first-run tip for the 3D touch layout ("Sleep rechts om rond te kijken · houd de knop vast om te schieten · Richten zoomt in"), stored like the existing touch tip.
- [ ] Browser check with `resize_window` preset `mobile` (touch emulation), 3D: dragging looks without firing (`window.__arena.getState()` shows no new bullets), fire button fires, ADS zooms (track A adds the zoom; without it, check `ads` in the input), screenshot `3d-touch-layout.jpg`.
- [ ] `docs/tech/arena/README.md` touch section + `3D-MODE.md` Input/Touch updated.
- [ ] `tsc`, `lint`, `vitest run`, de-slop. **Do not push or open a PR** — report back.

## Browser checks

Port **3022**, preview DB, `trainer@example.test` / `preview123`, `/arena/spelen?debug=1`, "Stad verkennen", 3D. Own tab (`tabs_create`), pass its `tabId`. `next dev --webpack` (junctioned `node_modules`).
