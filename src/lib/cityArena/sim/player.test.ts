import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import { PLAYER_RADIUS_M, WALK_SPEED_MPS, stepPlayer } from "./player";
import type { PlayerState } from "./types";

const free = { resolveCircle: (centre: Point): Point => centre };
const start: PlayerState = { x: 0, y: 0, facing: 0, speed: 0 };

describe("stepPlayer", () => {
  it("walks at 4 m/s scaled by the input magnitude and faces the movement direction", () => {
    const moved = stepPlayer(start, { move: [1, 0] }, 1, free);
    expect(moved.x).toBeCloseTo(WALK_SPEED_MPS);
    expect(moved.speed).toBeCloseTo(4);
    const halfSpeed = stepPlayer(start, { move: [0, 0.5] }, 1, free);
    expect(halfSpeed.y).toBeCloseTo(2);
    expect(halfSpeed.facing).toBeCloseTo(Math.PI / 2);
  });

  it("keeps the last facing when standing still and ignores dead-zone noise", () => {
    const facingRight = stepPlayer(start, { move: [1, 0] }, 0.1, free);
    const still = stepPlayer(facingRight, { move: [0.01, 0.01] }, 1, free);
    expect(still.x).toBeCloseTo(facingRight.x);
    expect(still.facing).toBe(facingRight.facing);
    expect(still.speed).toBe(0);
  });

  it("resolves collisions with the grid using the player radius", () => {
    const wall = {
      resolveCircle: (centre: Point, radius: number): Point => [
        Math.min(centre[0], 10 - radius),
        centre[1],
      ],
    };
    const blocked = stepPlayer(
      { x: 9, y: 0, facing: 0, speed: 0 },
      { move: [1, 0] },
      1,
      wall,
    );
    expect(blocked.x).toBeCloseTo(10 - PLAYER_RADIUS_M);
  });
});
