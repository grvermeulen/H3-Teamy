import { describe, expect, it } from "vitest";
import { SIM_STEP_S } from "@/lib/cityArena/sim/player";
import type { ArenaState, VehicleState } from "@/lib/cityArena/sim/types";
import { createVehicle, stepVehicle } from "@/lib/cityArena/sim/vehicle";
import {
  createCamera,
  worldToScreen,
  type Camera,
} from "@/lib/cityArena/render/camera";
import { smoothAlpha, smoothFrame } from "@/lib/cityArena/render/smoothing";
import { createCollisionGrid } from "@/lib/cityArena/world/collisionGrid";
import { nextCamera } from "./arenaRuntime";

/**
 * The bug this file guards, end to end: driving used to stutter rather than flow.
 *
 * The unit tests in `render/smoothing.test.ts` check the blend in world metres. This one runs the
 * real vehicle sim through the real camera and asks the only question that matters — where does
 * the car land *on screen*, frame after frame — because that is what the eye judges. The camera
 * eases on the real frame time while the simulation steps at 30 Hz, so a car drawn straight from
 * the tick slides backwards and forwards against the road under it.
 */

const collision = createCollisionGrid();
const viewport = { width: 1280, height: 720 };
/** A sport car flat out through a gentle bend: the fastest kind, and steering to rule out a straight line. */
const CONTROLS = { throttle: 1, steer: 0.12 };
const ZOOM = 8;

/** A world holding just the car being driven. */
function stateWith(tick: number, vehicle: VehicleState): ArenaState {
  return {
    tick,
    seed: 1,
    nextId: 9,
    players: [],
    vehicles: [vehicle],
    bullets: [],
    effects: [],
    zoneKey: null,
    peds: [],
    cops: [],
    pickups: [],
    traffic: [],
    events: [],
    activeZoneKey: null,
    zoneEnforced: false,
  };
}

/**
 * Drives for three seconds and returns the car's horizontal position on screen each frame.
 *
 * @param smooth - True for the current renderer; false reproduces the pre-fix one, which drew the
 *   tick's pose as it stood.
 * @param fps - The display's refresh rate.
 * @returns The on-screen x of the car, one entry per frame.
 */
function driveOnScreen(smooth: boolean, fps: number): number[] {
  let car = createVehicle(1, "sport", [0, 0], 0, 0);
  let previous: ArenaState | null = null;
  let current = stateWith(0, car);
  let camera: Camera = createCamera([0, 0], ZOOM);
  let accumulator = 0;
  const dt = 1 / fps;
  const screenX: number[] = [];
  for (let frame = 0; frame < fps * 3; frame++) {
    accumulator += dt;
    while (accumulator >= SIM_STEP_S) {
      car = stepVehicle(car, CONTROLS, SIM_STEP_S, collision).vehicle;
      previous = current;
      current = stateWith(current.tick + 1, car);
      accumulator -= SIM_STEP_S;
    }
    const drawn = smooth
      ? smoothFrame(previous, current, smoothAlpha(accumulator)).vehicles[0]!
      : current.vehicles[0]!;
    camera = nextCamera(
      camera,
      ZOOM,
      [drawn.x, drawn.y],
      [car.velocityX, car.velocityY],
      dt,
      true,
    );
    screenX.push(worldToScreen(camera, viewport, [drawn.x, drawn.y])[0]);
  }
  return screenX;
}

/**
 * How unsteady a run of on-screen positions is: the mean frame-to-frame change in how far the car
 * moved, in pixels. Even motion — however fast, and however curved — changes little between one
 * frame and the next, so this is near zero; a car that lurches scores high.
 *
 * @param series - On-screen positions, one per frame.
 * @returns Mean absolute change in per-frame movement, in pixels.
 */
function unsteadinessPx(series: number[]): number {
  const steps = series.slice(1).map((value, index) => value - series[index]!);
  // Past the first second, so the camera's ease has settled and is not itself the thing measured.
  const settled = steps.slice(30);
  const changes = settled
    .slice(1)
    .map((value, index) => Math.abs(value - settled[index]!));
  return changes.reduce((sum, value) => sum + value, 0) / changes.length;
}

describe("driving on a display faster than the simulation", () => {
  for (const fps of [60, 120, 144]) {
    it(`moves the car evenly on screen at ${fps} Hz`, () => {
      const smoothed = unsteadinessPx(driveOnScreen(true, fps));
      // Well under a pixel of wobble per frame: what is left is the real curve of the bend and the
      // camera's ease, not the tick showing through.
      expect(smoothed).toBeLessThan(0.5);
    });

    it(`is far steadier than drawing the tick's pose at ${fps} Hz`, () => {
      const raw = unsteadinessPx(driveOnScreen(false, fps));
      const smoothed = unsteadinessPx(driveOnScreen(true, fps));
      // The bug: whole pixels of lurch every frame, an order of magnitude worse than the fix.
      expect(raw).toBeGreaterThan(1);
      expect(raw / smoothed).toBeGreaterThan(10);
    });
  }
});
