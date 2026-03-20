import { describe, expect, it } from "vitest";
import {
  alienFireEveryForWave,
  alienMoveEveryForWave,
  createInitialState,
  spawnWave,
  tick,
  weaponLevelForWave,
} from "./game";
import { ALIEN_COLS, ALIEN_ROWS, GAME_W } from "./constants";
import type { GameState } from "./types";

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

describe("wave_clear interstitial", () => {
  it("counts down and spawns next wave", () => {
    const emptyAliens = Array.from({ length: ALIEN_ROWS }, () =>
      Array.from({ length: ALIEN_COLS }, () => false),
    );
    let s: GameState = {
      ...createInitialState(),
      status: "wave_clear",
      wave: 2,
      waveClearRemaining: 0.15,
      alienGrid: emptyAliens,
      playerBullets: [],
      alienBullets: [],
    };
    s = tick(s, 0.2, { moveLeft: false, moveRight: false, fire: false });
    expect(s.status).toBe("playing");
    expect(s.wave).toBe(2);
    const alive = s.alienGrid.flat().filter(Boolean).length;
    expect(alive).toBeGreaterThan(0);
  });
});

describe("spawnWave", () => {
  it("resets grid and matches weapon to wave", () => {
    const cleared = {
      ...createInitialState(),
      wave: 4,
      score: 999,
    };
    const next = spawnWave(cleared);
    expect(next.wave).toBe(4);
    expect(next.weaponLevel).toBe(weaponLevelForWave(4));
    expect(next.alienGrid.flat().every(Boolean)).toBe(true);
  });
});
