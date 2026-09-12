import { describe, expect, it } from "vitest";
import type { Point } from "../world/projection";
import {
  PLAYER_RADIUS_M,
  WALK_ACCEL_MPS2,
  WALK_SPEED_MPS,
  stepPlayer,
} from "./player";
import { createInput, type PlayerState } from "./types";

const free = { resolveCircle: (centre: Point): Point => centre };
const start: PlayerState = { x: 0, y: 0, facing: 0, speed: 0 };

describe("stepPlayer", () => {
  it("walks at 5.5 m/s scaled by the input magnitude and faces the movement direction", () => {
    const moved = stepPlayer(start, createInput({ move: [1, 0] }), 1, free);
    expect(moved.x).toBeCloseTo(WALK_SPEED_MPS);
    expect(moved.speed).toBeCloseTo(WALK_SPEED_MPS);
    const halfSpeed = stepPlayer(
      start,
      createInput({ move: [0, 0.5] }),
      1,
      free,
    );
    expect(halfSpeed.y).toBeCloseTo(2.75);
    expect(halfSpeed.facing).toBeCloseTo(Math.PI / 2);
  });

  it("ramps up to the walking speed instead of teleporting", () => {
    const step = 1 / 30;
    const first = stepPlayer(start, createInput({ move: [1, 0] }), step, free);
    expect(first.speed).toBeCloseTo(WALK_ACCEL_MPS2 * step, 6);
    expect(first.x).toBeCloseTo(WALK_ACCEL_MPS2 * step * step, 6);
    let walker = start;
    for (let tick = 0; tick < 5; tick++)
      walker = stepPlayer(walker, createInput({ move: [1, 0] }), step, free);
    expect(walker.speed).toBeCloseTo(WALK_SPEED_MPS, 6);
    expect(walker.x).toBeCloseTo(0.590741, 5);
  });

  it("never carries a car's speed into the first walking step", () => {
    const step = 1 / 30;
    const justOut = { x: 0, y: 0, facing: 0, speed: 20 };
    const walking = stepPlayer(
      justOut,
      createInput({ move: [1, 0] }),
      step,
      free,
    );
    expect(walking.speed).toBeCloseTo(WALK_SPEED_MPS, 6);
    expect(walking.x).toBeCloseTo(WALK_SPEED_MPS * step, 6);
  });

  it("clamps oversized debug input before applying displacement", () => {
    const moved = stepPlayer(start, createInput({ move: [2, 0] }), 1, free);
    expect(moved.x).toBeCloseTo(WALK_SPEED_MPS);
    expect(moved.speed).toBeCloseTo(WALK_SPEED_MPS);
  });

  it("keeps the last facing when standing still and ignores dead-zone noise", () => {
    const facingRight = stepPlayer(
      start,
      createInput({ move: [1, 0] }),
      0.1,
      free,
    );
    const still = stepPlayer(
      facingRight,
      createInput({ move: [0.01, 0.01] }),
      1,
      free,
    );
    expect(still.x).toBeCloseTo(facingRight.x);
    expect(still.facing).toBe(facingRight.facing);
    expect(still.speed).toBe(0);
  });

  it("faces the aim angle instead of the movement when an aim is given", () => {
    const aimed = stepPlayer(
      start,
      createInput({ move: [1, 0], aim: Math.PI }),
      1,
      free,
    );
    expect(aimed.x).toBeCloseTo(WALK_SPEED_MPS);
    expect(aimed.facing).toBeCloseTo(Math.PI);
    const still = stepPlayer(start, createInput({ aim: -1 }), 1, free);
    expect(still.facing).toBe(-1);
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
      createInput({ move: [1, 0] }),
      1,
      wall,
    );
    expect(blocked.x).toBeCloseTo(10 - PLAYER_RADIUS_M);
  });
});
