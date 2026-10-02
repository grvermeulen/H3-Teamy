import { describe, expect, it } from "vitest";
import {
  MAX_PAN,
  OPEN_CUTOFF_HZ,
  SOUND_PROFILES,
  TOP_DOWN_FACING,
  listenerAt,
  spatialMix,
  type Listener,
} from "./spatial";

const EAST: Listener = { x: 0, y: 0, facing: 0 };
const NORTH_2D: Listener = { x: 0, y: 0, facing: TOP_DOWN_FACING };
const gunshot = SOUND_PROFILES.gunshot;

describe("spatialMix", () => {
  it("plays a sound at the listener in full, centred and unfiltered", () => {
    const mix = spatialMix(EAST, 0, 0, gunshot);
    expect(mix.gain).toBe(1);
    expect(mix.pan).toBeCloseTo(0);
    expect(mix.cutoffHz).toBe(OPEN_CUTOFF_HZ);
  });

  it("silences a gunshot past its 150 m reach", () => {
    expect(gunshot.maxDistanceM).toBe(150);
    expect(spatialMix(EAST, 151, 0, gunshot).gain).toBe(0);
    expect(spatialMix(EAST, 149, 0, gunshot).gain).toBeGreaterThan(0);
  });

  it("pans a source due south of an east-facing listener right, and due north left", () => {
    expect(spatialMix(EAST, 0, 30, gunshot).pan).toBeCloseTo(MAX_PAN);
    expect(spatialMix(EAST, 0, -30, gunshot).pan).toBeCloseTo(-MAX_PAN);
  });

  it("pans a source east of a top-down (north-up) listener right", () => {
    expect(spatialMix(NORTH_2D, 30, 0, gunshot).pan).toBeCloseTo(MAX_PAN);
    expect(spatialMix(NORTH_2D, -30, 0, gunshot).pan).toBeCloseTo(-MAX_PAN);
    expect(spatialMix(NORTH_2D, 0, -30, gunshot).pan).toBeCloseTo(0);
  });

  it("centres a source on top of the listener however it faces", () => {
    expect(Math.abs(spatialMix(EAST, 0, 1, gunshot).pan)).toBeLessThan(0.2);
  });

  it("gets strictly quieter and duller with distance beyond the reference", () => {
    const distances = [10, 20, 40, 80, 120, 140];
    const mixes = distances.map((metres) =>
      spatialMix(EAST, metres, 0, gunshot),
    );
    for (let index = 1; index < mixes.length; index++) {
      expect(mixes[index]!.gain).toBeLessThan(mixes[index - 1]!.gain);
      expect(mixes[index]!.cutoffHz).toBeLessThan(mixes[index - 1]!.cutoffHz);
    }
  });

  it("follows the inverse rolloff: a gunshot at 100 m plays at 8 % of full", () => {
    expect(spatialMix(EAST, 100, 0, gunshot).gain).toBeCloseTo(0.08);
  });

  it("closes the low-pass toward 1500 Hz at the edge of hearing", () => {
    expect(spatialMix(EAST, 149.9, 0, gunshot).cutoffHz).toBeLessThan(1600);
  });

  it("muffles a sound behind the listener: quieter and duller than the same one in front", () => {
    const front = spatialMix(EAST, 40, 0, gunshot);
    const behind = spatialMix(EAST, -40, 0, gunshot);
    expect(behind.gain).toBeLessThan(front.gain);
    expect(behind.gain).toBeCloseTo(front.gain * 0.8);
    expect(behind.cutoffHz).toBeLessThan(front.cutoffHz);
  });

  it("gives every profile a reach past its reference distance", () => {
    for (const profile of Object.values(SOUND_PROFILES))
      expect(profile.maxDistanceM).toBeGreaterThan(profile.refDistanceM);
  });
});

describe("listenerAt", () => {
  it("faces the 3D camera's yaw, and north (screen up) in 2D", () => {
    expect(listenerAt(3, 4, 1.2)).toEqual({ x: 3, y: 4, facing: 1.2 });
    expect(listenerAt(3, 4, null)).toEqual({
      x: 3,
      y: 4,
      facing: -Math.PI / 2,
    });
  });
});
