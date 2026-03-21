import { describe, expect, it } from "vitest";
import {
  alienBulletSpeedForWave,
  alienFireEveryForWave,
  alienMoveEveryForWave,
  alienVolleyCountForWave,
  createBurst,
  createInitialState,
  deserializeGame,
  pickAlienWeaponKind,
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
  it("alien fire interval has a low floor on late waves", () => {
    expect(alienFireEveryForWave(1)).toBeGreaterThan(0.18);
    expect(alienFireEveryForWave(99)).toBe(0.18);
  });
  it("alien bullet speed increases with wave then caps", () => {
    expect(alienBulletSpeedForWave(2)).toBeGreaterThan(
      alienBulletSpeedForWave(1),
    );
    expect(alienBulletSpeedForWave(30)).toBe(230);
    expect(alienBulletSpeedForWave(30)).toBe(alienBulletSpeedForWave(100));
  });
  it("volley count steps at waves 6 and 12", () => {
    expect(alienVolleyCountForWave(1)).toBe(1);
    expect(alienVolleyCountForWave(5)).toBe(1);
    expect(alienVolleyCountForWave(6)).toBe(2);
    expect(alienVolleyCountForWave(11)).toBe(2);
    expect(alienVolleyCountForWave(12)).toBe(3);
  });
});

describe("pickAlienWeaponKind", () => {
  it("wave 1 is always bolt", () => {
    for (let row = 0; row < ALIEN_ROWS; row++) {
      expect(pickAlienWeaponKind(1, row, 0)).toBe("bolt");
      expect(pickAlienWeaponKind(1, row, 0.999)).toBe("bolt");
    }
  });
  it("high wave + top row + low rand favors needle", () => {
    expect(pickAlienWeaponKind(12, 0, 0)).toBe("needle");
  });
  it("high wave + bottom row can yield heavy after needle band", () => {
    expect(pickAlienWeaponKind(20, ALIEN_ROWS - 1, 0.37)).toBe("heavy");
  });
});

describe("deserializeGame alien bullets", () => {
  it("defaults kind and velocity for legacy saves", () => {
    const base = createInitialState();
    const data = {
      v: 2 as const,
      wave: 4,
      lives: base.lives,
      score: base.score,
      weaponLevel: base.weaponLevel,
      playerX: base.playerX,
      alienGrid: base.alienGrid,
      alienOriginX: base.alienOriginX,
      alienOriginY: base.alienOriginY,
      alienDir: base.alienDir,
      alienMoveAcc: base.alienMoveAcc,
      alienMoveEvery: base.alienMoveEvery,
      playerBullets: [],
      alienBullets: [{ x: 50, y: 80 }],
      playerFireCooldown: 0,
      alienFireAcc: 0,
      alienFireEvery: base.alienFireEvery,
      status: "playing" as const,
      shieldCharges: 0,
      lootDrops: [],
      lootSpawnTimer: base.lootSpawnTimer,
    };
    const s = deserializeGame(data);
    expect(s.alienBullets).toHaveLength(1);
    const b = s.alienBullets[0]!;
    expect(b.kind).toBe("bolt");
    expect(b.vy).toBeGreaterThan(0);
    expect(b.vx).toBe(0);
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
  it("resets grid and preserves weapon above wave floor", () => {
    const cleared = {
      ...createInitialState(),
      wave: 4,
      score: 999,
      weaponLevel: 3,
    };
    const next = spawnWave(cleared);
    expect(next.wave).toBe(4);
    expect(next.weaponLevel).toBe(3);
    expect(next.alienGrid.flat().every(Boolean)).toBe(true);
  });

  it("bumps weapon to at least wave floor when behind", () => {
    const cleared = {
      ...createInitialState(),
      wave: 5,
      weaponLevel: 0,
    };
    const next = spawnWave(cleared);
    expect(next.weaponLevel).toBe(weaponLevelForWave(5));
  });
});

describe("createBurst", () => {
  it("returns the requested particle count", () => {
    const p = createBurst(100, 200, 7, 120);
    expect(p.length).toBe(7);
    expect(p[0]!.life).toBeGreaterThan(0);
  });
});
