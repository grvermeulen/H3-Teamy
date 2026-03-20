import { describe, expect, it } from "vitest";
import {
  alienFireEveryForWave,
  alienMoveEveryForWave,
  createInitialState,
  tick,
  weaponLevelForWave,
} from "./game";
import { GAME_W } from "./constants";

describe("weaponLevelForWave", () => {
  it("ramps with wave", () => {
    expect(weaponLevelForWave(1)).toBe(0);
    expect(weaponLevelForWave(2)).toBe(0);
    expect(weaponLevelForWave(3)).toBe(1);
    expect(weaponLevelForWave(5)).toBe(1);
    expect(weaponLevelForWave(6)).toBe(2);
    expect(weaponLevelForWave(99)).toBe(2);
  });
});

describe("difficulty curves", () => {
  it("alien move interval decreases with wave", () => {
    expect(alienMoveEveryForWave(1)).toBeGreaterThan(alienMoveEveryForWave(10));
  });
  it("alien fire interval decreases with wave", () => {
    expect(alienFireEveryForWave(1)).toBeGreaterThan(alienFireEveryForWave(10));
  });
});

describe("tick", () => {
  it("moves player left when input.moveLeft", () => {
    let s = createInitialState();
    const x0 = s.playerX;
    for (let i = 0; i < 20; i++) {
      s = tick(s, 1 / 60, { moveLeft: true, moveRight: false, fire: false });
    }
    expect(s.playerX).toBeLessThan(x0);
  });

  it("clamps player to bounds", () => {
    let s = createInitialState();
    s = { ...s, playerX: 4 };
    for (let i = 0; i < 200; i++) {
      s = tick(s, 1 / 30, { moveLeft: true, moveRight: false, fire: false });
    }
    expect(s.playerX).toBeGreaterThan(0);
    expect(s.playerX).toBeLessThanOrEqual(GAME_W / 2);
  });
});
