import { describe, expect, it } from "vitest";
import {
  clipMix,
  createClipMix,
  clipMixInto,
  isUpperBodyTrack,
  type ClipMix,
  type GaitStride,
} from "./characterAnimation";
import type { PoseInput } from "./characterPose";

const STRIDE: GaitStride = { walkM: 1.8, runM: 2.4 };

/** A pose at rest, with `changes` on top. */
function pose(changes: Partial<PoseInput> = {}): PoseInput {
  return {
    speed: 0,
    phaseM: 0,
    aiming: false,
    weapon: null,
    dead: false,
    tick: 0,
    recoil: 0,
    ...changes,
  };
}

/** The weight of a base clip. */
function weightOf(mix: ClipMix, role: string): number {
  return mix.base.find((entry) => entry.role === role)?.weight ?? 0;
}

describe("clipMix", () => {
  it("stands idle at speed 0", () => {
    const mix = clipMix(pose(), STRIDE);
    expect(weightOf(mix, "idle")).toBe(1);
    expect(weightOf(mix, "walk")).toBe(0);
    expect(weightOf(mix, "run")).toBe(0);
    expect(mix.upper).toBeNull();
    expect(mix.once).toBeNull();
  });

  it("walks at walking speed, faster cycles the faster it goes", () => {
    const slow = clipMix(pose({ speed: 1.2 }), STRIDE);
    const brisk = clipMix(pose({ speed: 1.8 }), STRIDE);
    expect(weightOf(slow, "walk")).toBeGreaterThan(weightOf(slow, "idle"));
    expect(weightOf(slow, "walk")).toBeGreaterThan(weightOf(slow, "run"));
    expect(brisk.cyclesPerSecond).toBeGreaterThan(slow.cyclesPerSecond);
    expect(slow.cyclesPerSecond).toBeCloseTo(1.2 / STRIDE.walkM);
  });

  it("runs when running", () => {
    const mix = clipMix(pose({ speed: 6 }), STRIDE);
    expect(weightOf(mix, "run")).toBe(1);
    expect(mix.cyclesPerSecond).toBeCloseTo(6 / STRIDE.runM);
  });

  it("keeps the base weights summing to one", () => {
    for (const speed of [0, 0.3, 0.9, 2, 3.7, 4.1, 9]) {
      const mix = clipMix(pose({ speed }), STRIDE);
      const total = mix.base.reduce((sum, entry) => sum + entry.weight, 0);
      expect(total).toBeCloseTo(1);
    }
  });

  it("plays only the death, once, when dead", () => {
    const mix = clipMix(
      pose({ dead: true, speed: 3, aiming: true, weapon: "pistol" }),
      STRIDE,
    );
    expect(mix.base.every((entry) => entry.weight === 0)).toBe(true);
    expect(mix.upper).toBeNull();
    expect(mix.once).toBe("death");
  });

  it("raises the gun with the upper body while aiming a pistol", () => {
    const mix = clipMix(
      pose({ aiming: true, weapon: "pistol", speed: 1.5 }),
      STRIDE,
    );
    expect(mix.upper).toEqual({ role: "gunIdle", weight: 1 });
    expect(weightOf(mix, "walk")).toBeGreaterThan(0);
  });

  it("fires the gun once on a fresh recoil", () => {
    expect(
      clipMix(pose({ aiming: true, weapon: "pistol", recoil: 1 }), STRIDE).once,
    ).toBe("gunShoot");
    expect(
      clipMix(pose({ aiming: true, weapon: "pistol", recoil: 0.6 }), STRIDE)
        .once,
    ).toBeNull();
  });

  it("throws a punch with fists and swings the bat", () => {
    expect(clipMix(pose({ weapon: "fist", recoil: 1 }), STRIDE).once).toBe(
      "punch",
    );
    expect(clipMix(pose({ weapon: null, recoil: 1 }), STRIDE).once).toBe(
      "punch",
    );
    expect(clipMix(pose({ weapon: "bat", recoil: 1 }), STRIDE).once).toBe(
      "swing",
    );
  });

  it("carries a gun lowered when not aiming", () => {
    expect(clipMix(pose({ weapon: "rifle" }), STRIDE).upper).toBeNull();
  });
});

describe("clipMixInto", () => {
  it("rewrites one mix in place", () => {
    const out = createClipMix();
    const base = out.base;
    clipMixInto(pose({ speed: 6 }), STRIDE, out);
    clipMixInto(pose({ aiming: true, weapon: "uzi" }), STRIDE, out);
    expect(out.base).toBe(base);
    expect(weightOf(out, "idle")).toBe(1);
    expect(out.upper?.role).toBe("gunIdle");
  });
});

describe("isUpperBodyTrack", () => {
  it("puts the spine above the waist, the arms and the head in the upper body", () => {
    for (const name of [
      "Chest.quaternion",
      "UpperArmR.quaternion",
      "Head.quaternion",
      "Index2L.quaternion",
    ])
      expect(isUpperBodyTrack(name)).toBe(true);
  });

  it("leaves the hips and legs to the gait", () => {
    for (const name of [
      "Hips.quaternion",
      "Body.position",
      "UpperLegL.quaternion",
      "FootR.quaternion",
      "Abdomen.quaternion",
    ])
      expect(isUpperBodyTrack(name)).toBe(false);
  });
});
