import { describe, expect, it } from "vitest";
import type { SnapshotPlayer } from "./snapshotWire";
import {
  MAX_EXTRAPOLATION_MS,
  interpolatePlayers,
  type SnapshotFrame,
} from "./interpolate";

/** A snapshot player row with only the fields interpolation reads set meaningfully. */
function player(id: number, x: number, facing = 0): SnapshotPlayer {
  return {
    id,
    x,
    y: 0,
    facing,
    speed: 0,
    health: 100,
    weapon: "pistol",
    ammo: { uzi: 0, shotgun: 0 },
    vehicleId: null,
    boardingTicksLeft: 0,
    nextShotTick: 0,
    diedAtTick: null,
    invulnerableUntilTick: 0,
    heat: 0,
    driveSteer: 0,
  };
}

/** Two frames 100 ms apart, with player 1 walking from x=0 to x=10. */
const FRAMES: SnapshotFrame[] = [
  { serverTimeMs: 1000, players: [player(1, 0)] },
  { serverTimeMs: 1100, players: [player(1, 10)] },
];

describe("interpolatePlayers", () => {
  it("has nothing to draw with no frames", () => {
    expect(interpolatePlayers([], 0).size).toBe(0);
  });

  it("draws the only frame it has", () => {
    const poses = interpolatePlayers([FRAMES[0]!], 5000);
    expect(poses.get(1)?.x).toBe(0);
  });

  it("blends between the two frames bracketing the moment", () => {
    expect(interpolatePlayers(FRAMES, 1050).get(1)?.x).toBeCloseTo(5, 5);
    expect(interpolatePlayers(FRAMES, 1025).get(1)?.x).toBeCloseTo(2.5, 5);
  });

  it("lands exactly on a frame's own position at its own time", () => {
    expect(interpolatePlayers(FRAMES, 1000).get(1)?.x).toBeCloseTo(0, 5);
    expect(interpolatePlayers(FRAMES, 1100).get(1)?.x).toBeCloseTo(10, 5);
  });

  it("holds at the oldest frame when asked for a moment before it", () => {
    expect(interpolatePlayers(FRAMES, 500).get(1)?.x).toBe(0);
  });

  it("extrapolates a starved client forward, but only briefly", () => {
    const halfway = interpolatePlayers(FRAMES, 1100 + MAX_EXTRAPOLATION_MS / 2);
    expect(halfway.get(1)?.x).toBeCloseTo(15, 5);
    const capped = interpolatePlayers(FRAMES, 1100 + MAX_EXTRAPOLATION_MS);
    expect(capped.get(1)?.x).toBeCloseTo(20, 5);
  });

  it("freezes rather than running away when snapshots stop for good", () => {
    const capped = interpolatePlayers(FRAMES, 1100 + MAX_EXTRAPOLATION_MS);
    const muchLater = interpolatePlayers(FRAMES, 1100 + 60_000);
    expect(muchLater.get(1)?.x).toBeCloseTo(capped.get(1)!.x, 5);
  });

  it("turns the short way round rather than the long way", () => {
    const frames: SnapshotFrame[] = [
      { serverTimeMs: 0, players: [player(1, 0, 0.1)] },
      { serverTimeMs: 100, players: [player(1, 0, Math.PI * 2 - 0.1)] },
    ];
    const facing = interpolatePlayers(frames, 50).get(1)!.facing;
    expect(Math.abs(facing)).toBeLessThan(0.1);
  });

  it("draws a player who appears only in the newer frame", () => {
    const frames: SnapshotFrame[] = [
      { serverTimeMs: 1000, players: [player(1, 0)] },
      { serverTimeMs: 1100, players: [player(1, 10), player(2, 40)] },
    ];
    expect(interpolatePlayers(frames, 1050).get(2)?.x).toBe(40);
  });

  it("keeps drawing a player who is only in the older frame", () => {
    const frames: SnapshotFrame[] = [
      { serverTimeMs: 1000, players: [player(1, 0), player(2, 40)] },
      { serverTimeMs: 1100, players: [player(1, 10)] },
    ];
    expect(interpolatePlayers(frames, 1050).get(2)?.x).toBe(40);
  });
});
