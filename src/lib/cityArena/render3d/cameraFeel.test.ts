import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { DRUNK_SWAY_RAD, drunkSway } from "../render/renderScene";
import {
  applyCameraFeel,
  cameraFeelOf,
  SHAKE_METRES_PER_PX,
} from "./cameraFeel";

/** A tick a quarter into the drunk sway's 96-tick period, where its tilt peaks. */
const SWAY_PEAK_TICK = 24;

describe("cameraFeelOf", () => {
  it("moves the camera against the 2D shake, in metres, so the world jolts the same way", () => {
    const feel = cameraFeelOf({ shake: { x: 10, y: -5 }, tick: 3 });
    expect(feel.right).toBeCloseTo(-10 * SHAKE_METRES_PER_PX);
    expect(feel.up).toBeCloseTo(-5 * SHAKE_METRES_PER_PX);
    expect(feel.roll).toBe(0);
  });

  it("rolls by the 2D view's drunk tilt", () => {
    const feel = cameraFeelOf({ drunk: 1, tick: SWAY_PEAK_TICK });
    expect(feel.roll).toBe(drunkSway(1, SWAY_PEAK_TICK).tilt);
    expect(feel.roll).toBeCloseTo(DRUNK_SWAY_RAD);
  });

  it("keeps the camera steady under reduced motion, and when nothing shakes", () => {
    /** True when a feel neither nudges nor rolls (either zero sign counts). */
    const steady = (feel: ReturnType<typeof cameraFeelOf>): boolean =>
      feel.right === 0 && feel.up === 0 && feel.roll === 0;
    const reduced = cameraFeelOf({
      shake: { x: 10, y: 10 },
      drunk: 1,
      tick: SWAY_PEAK_TICK,
      reducedMotion: true,
    });
    expect(steady(reduced)).toBe(true);
    expect(steady(cameraFeelOf({ tick: SWAY_PEAK_TICK }))).toBe(true);
  });
});

describe("applyCameraFeel", () => {
  /** A camera at the origin looking north (−z in three.js). */
  function camera(): PerspectiveCamera {
    const placed = new PerspectiveCamera();
    placed.lookAt(0, 0, -1);
    return placed;
  }

  it("nudges along the camera's own axes and rolls about its view axis", () => {
    const shaken = camera();
    applyCameraFeel(shaken, { right: 0.2, up: 0.1, roll: 0.07 });
    expect(shaken.position.x).toBeCloseTo(0.2);
    expect(shaken.position.y).toBeCloseTo(0.1);
    const view = shaken.getWorldDirection(new Vector3());
    expect(view.z).toBeCloseTo(-1);
    const up = new Vector3(0, 1, 0).applyQuaternion(shaken.quaternion);
    expect(Math.atan2(-up.x, up.y)).toBeCloseTo(0.07);
  });

  it("leaves a steady camera untouched", () => {
    const steady = camera();
    const before = steady.quaternion.clone();
    applyCameraFeel(steady, { right: 0, up: 0, roll: 0 });
    expect(steady.position.toArray()).toEqual([0, 0, 0]);
    expect(steady.quaternion.equals(before)).toBe(true);
  });
});
