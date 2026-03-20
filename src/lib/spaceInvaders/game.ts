import {
  ALIEN_BULLET_SPEED,
  ALIEN_COLS,
  ALIEN_DROP_Y,
  ALIEN_GAP_X,
  ALIEN_GAP_Y,
  ALIEN_H,
  ALIEN_ROWS,
  ALIEN_SCORE_BASE,
  ALIEN_STEP_X,
  ALIEN_W,
  BULLET_H,
  BULLET_W,
  FIRE_INTERVAL,
  GAME_H,
  GAME_W,
  INITIAL_LIVES,
  PLAYER_BULLET_SPEED,
  PLAYER_H,
  PLAYER_SPEED,
  PLAYER_W,
  PLAYER_Y,
} from "./constants";
import type { GameInput, GameState, SerializedGameV1 } from "./types";

function emptyGrid(): boolean[][] {
  return Array.from({ length: ALIEN_ROWS }, () =>
    Array.from({ length: ALIEN_COLS }, () => true),
  );
}

export function weaponLevelForWave(wave: number): number {
  if (wave >= 6) return 2;
  if (wave >= 3) return 1;
  return 0;
}

export function alienMoveEveryForWave(wave: number): number {
  return Math.max(0.22, 0.55 - wave * 0.035);
}

export function alienFireEveryForWave(wave: number): number {
  return Math.max(0.35, 1.1 - wave * 0.08);
}

export function createInitialState(): GameState {
  const wave = 1;
  return {
    status: "playing",
    wave,
    lives: INITIAL_LIVES,
    score: 0,
    weaponLevel: weaponLevelForWave(wave),
    playerX: GAME_W / 2,
    alienGrid: emptyGrid(),
    alienOriginX: 24,
    alienOriginY: 56,
    alienDir: 1,
    alienMoveAcc: 0,
    alienMoveEvery: alienMoveEveryForWave(wave),
    playerBullets: [],
    alienBullets: [],
    playerFireCooldown: 0,
    alienFireAcc: 0,
    alienFireEvery: alienFireEveryForWave(wave),
  };
}

export function spawnWave(state: GameState): GameState {
  const wave = state.wave;
  return {
    ...state,
    alienGrid: emptyGrid(),
    alienOriginX: 24,
    alienOriginY: 56,
    alienDir: 1,
    alienMoveAcc: 0,
    alienMoveEvery: alienMoveEveryForWave(wave),
    alienFireEvery: alienFireEveryForWave(wave),
    weaponLevel: weaponLevelForWave(wave),
    playerBullets: [],
    alienBullets: [],
    status: "playing",
  };
}

export function alienRect(
  state: GameState,
  row: number,
  col: number,
): { left: number; top: number; right: number; bottom: number } | null {
  if (!state.alienGrid[row]?.[col]) return null;
  const left = state.alienOriginX + col * (ALIEN_W + ALIEN_GAP_X);
  const top = state.alienOriginY + row * (ALIEN_H + ALIEN_GAP_Y);
  return { left, top, right: left + ALIEN_W, bottom: top + ALIEN_H };
}

function gridBounds(state: GameState): {
  minX: number;
  maxX: number;
  maxY: number;
} | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (let r = 0; r < ALIEN_ROWS; r++) {
    for (let c = 0; c < ALIEN_COLS; c++) {
      const rect = alienRect(state, r, c);
      if (!rect) continue;
      any = true;
      minX = Math.min(minX, rect.left);
      maxX = Math.max(maxX, rect.right);
      maxY = Math.max(maxY, rect.bottom);
    }
  }
  if (!any) return null;
  return { minX, maxX, maxY };
}

function stepAliens(state: GameState): GameState {
  const b = gridBounds(state);
  if (!b) return state;

  let { alienOriginX, alienOriginY, alienDir } = state;
  const step = ALIEN_STEP_X + Math.min(state.wave, 12) * 0.4;

  if (alienDir === 1 && b.maxX + step >= GAME_W - 4) {
    alienDir = -1;
    alienOriginY += ALIEN_DROP_Y;
  } else if (alienDir === -1 && b.minX - step <= 4) {
    alienDir = 1;
    alienOriginY += ALIEN_DROP_Y;
  } else {
    alienOriginX += alienDir * step;
  }

  return { ...state, alienOriginX, alienOriginY, alienDir };
}

function playerRect(state: GameState) {
  const left = state.playerX - PLAYER_W / 2;
  return {
    left,
    top: PLAYER_Y,
    right: left + PLAYER_W,
    bottom: PLAYER_Y + PLAYER_H,
  };
}

function overlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return !(
    a.right <= b.left ||
    a.left >= b.right ||
    a.bottom <= b.top ||
    a.top >= b.bottom
  );
}

export function tick(
  state: GameState,
  dt: number,
  input: GameInput,
): GameState {
  if (state.status !== "playing") return state;

  let next: GameState = { ...state };

  // Player movement
  if (input.moveLeft) {
    next.playerX = Math.max(PLAYER_W / 2 + 4, next.playerX - PLAYER_SPEED * dt);
  }
  if (input.moveRight) {
    next.playerX = Math.min(
      GAME_W - PLAYER_W / 2 - 4,
      next.playerX + PLAYER_SPEED * dt,
    );
  }

  // Fire cooldown
  next.playerFireCooldown = Math.max(0, next.playerFireCooldown - dt);

  const fireInterval = FIRE_INTERVAL[next.weaponLevel] ?? FIRE_INTERVAL[0];
  if (input.fire && next.playerFireCooldown <= 0) {
    const px = next.playerX;
    const py = PLAYER_Y - 4;
    const lvl = next.weaponLevel;
    if (lvl === 0) {
      next.playerBullets = [...next.playerBullets, { x: px, y: py }];
    } else if (lvl === 1) {
      next.playerBullets = [
        ...next.playerBullets,
        { x: px - 10, y: py },
        { x: px + 10, y: py },
      ];
    } else {
      next.playerBullets = [
        ...next.playerBullets,
        { x: px - 14, y: py },
        { x: px, y: py },
        { x: px + 14, y: py },
      ];
    }
    next.playerFireCooldown = fireInterval;
  }

  // Move player bullets up
  next.playerBullets = next.playerBullets
    .map((b) => ({ ...b, y: b.y - PLAYER_BULLET_SPEED * dt }))
    .filter((b) => b.y > -BULLET_H);

  // Alien stepping (cap steps per tick for stability on lag spikes)
  next.alienMoveAcc += dt;
  let steps = 0;
  while (next.alienMoveAcc >= next.alienMoveEvery && steps < 4) {
    next.alienMoveAcc -= next.alienMoveEvery;
    next = stepAliens(next);
    steps += 1;
  }

  // Alien fire (at most one shot per frame from accumulator)
  next.alienFireAcc += dt;
  if (next.alienFireAcc >= next.alienFireEvery) {
    next.alienFireAcc = 0;
    const shooters: { row: number; col: number }[] = [];
    for (let c = 0; c < ALIEN_COLS; c++) {
      for (let r = ALIEN_ROWS - 1; r >= 0; r--) {
        if (next.alienGrid[r][c]) {
          shooters.push({ row: r, col: c });
          break;
        }
      }
    }
    if (shooters.length > 0) {
      const pick = shooters[Math.floor(Math.random() * shooters.length)]!;
      const rect = alienRect(next, pick.row, pick.col);
      if (rect) {
        next.alienBullets = [
          ...next.alienBullets,
          {
            x: (rect.left + rect.right) / 2,
            y: rect.bottom + 2,
          },
        ];
      }
    }
  }

  // Move alien bullets down
  next.alienBullets = next.alienBullets
    .map((b) => ({ ...b, y: b.y + ALIEN_BULLET_SPEED * dt }))
    .filter((b) => b.y < GAME_H + 20);

  // Player bullets vs aliens
  const grid = next.alienGrid.map((row) => [...row]);
  let score = next.score;
  const pBullets: typeof next.playerBullets = [];
  for (const bullet of next.playerBullets) {
    const br = {
      left: bullet.x - BULLET_W / 2,
      top: bullet.y - BULLET_H,
      right: bullet.x + BULLET_W / 2,
      bottom: bullet.y,
    };
    let hit = false;
    for (let r = 0; r < ALIEN_ROWS && !hit; r++) {
      for (let c = 0; c < ALIEN_COLS && !hit; c++) {
        const ar = alienRect({ ...next, alienGrid: grid }, r, c);
        if (!ar) continue;
        if (overlap(br, ar)) {
          grid[r][c] = false;
          score += ALIEN_SCORE_BASE * next.wave;
          hit = true;
        }
      }
    }
    if (!hit) pBullets.push(bullet);
  }
  next = { ...next, alienGrid: grid, score, playerBullets: pBullets };

  // All aliens dead -> next wave
  const aliveCount = grid.flat().filter(Boolean).length;
  if (aliveCount === 0) {
    next = {
      ...next,
      wave: next.wave + 1,
    };
    next = spawnWave(next);
    return next;
  }

  // Alien bullets vs player
  const pr = playerRect(next);
  const prevLives = next.lives;
  let lives = next.lives;
  let tookHit = false;
  const aBullets: typeof next.alienBullets = [];
  for (const bullet of next.alienBullets) {
    const br = {
      left: bullet.x - BULLET_W / 2,
      top: bullet.y,
      right: bullet.x + BULLET_W / 2,
      bottom: bullet.y + BULLET_H,
    };
    if (!tookHit && overlap(br, pr)) {
      lives -= 1;
      tookHit = true;
    } else {
      aBullets.push(bullet);
    }
  }
  next = { ...next, alienBullets: aBullets, lives };

  if (lives < prevLives) {
    // Took damage: brief respite — clear incoming shots
    next = {
      ...next,
      lives,
      alienBullets: [],
      playerX: GAME_W / 2,
    };
  }

  if (lives <= 0) {
    return { ...next, status: "gameover" };
  }

  // Invaders reached player line
  const bounds = gridBounds(next);
  if (bounds && bounds.maxY >= PLAYER_Y - 4) {
    return { ...next, status: "gameover", lives: 0 };
  }

  return next;
}

export function serializeGame(state: GameState): SerializedGameV1 | null {
  if (state.status === "gameover") return null;
  return {
    v: 1,
    wave: state.wave,
    lives: state.lives,
    score: state.score,
    weaponLevel: state.weaponLevel,
    playerX: state.playerX,
    alienGrid: state.alienGrid.map((r) => [...r]),
    alienOriginX: state.alienOriginX,
    alienOriginY: state.alienOriginY,
    alienDir: state.alienDir,
    alienMoveAcc: state.alienMoveAcc,
    alienMoveEvery: state.alienMoveEvery,
    playerBullets: state.playerBullets.map((b) => ({ ...b })),
    alienBullets: state.alienBullets.map((b) => ({ ...b })),
    playerFireCooldown: state.playerFireCooldown,
    alienFireAcc: state.alienFireAcc,
    alienFireEvery: state.alienFireEvery,
    status: state.status === "paused" ? "paused" : "playing",
  };
}

export function deserializeGame(data: SerializedGameV1): GameState {
  return {
    status: data.status === "paused" ? "paused" : "playing",
    wave: data.wave,
    lives: data.lives,
    score: data.score,
    weaponLevel: data.weaponLevel,
    playerX: data.playerX,
    alienGrid: data.alienGrid.map((r) => [...r]),
    alienOriginX: data.alienOriginX,
    alienOriginY: data.alienOriginY,
    alienDir: data.alienDir,
    alienMoveAcc: data.alienMoveAcc,
    alienMoveEvery: data.alienMoveEvery,
    playerBullets: data.playerBullets.map((b) => ({ ...b })),
    alienBullets: data.alienBullets.map((b) => ({ ...b })),
    playerFireCooldown: data.playerFireCooldown,
    alienFireAcc: data.alienFireAcc,
    alienFireEvery: data.alienFireEvery,
  };
}
