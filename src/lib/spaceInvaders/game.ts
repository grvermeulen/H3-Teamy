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
  LOOT_FALL_SPEED,
  LOOT_SPAWN_MAX,
  LOOT_SPAWN_MIN,
  MAX_SHIELD_CHARGES,
  MAX_WEAPON_LEVEL,
  WAVE_CLEAR_DURATION,
  PLAYER_BULLET_SPEED,
  PLAYER_H,
  PLAYER_SPEED,
  PLAYER_W,
  PLAYER_Y,
} from "./constants";
import type {
  AlienBullet,
  AlienWeaponKind,
  GameInput,
  GameState,
  LootDrop,
  LootKind,
  Particle,
  PlayerBullet,
  SerializedAlienBullet,
  SerializedGameV1,
} from "./types";

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
  return Math.max(0.18, 1.1 - wave * 0.082);
}

/** Downward speed scale (px/s), capped for fairness */
export function alienBulletSpeedForWave(wave: number): number {
  return Math.min(230, ALIEN_BULLET_SPEED + wave * 7.5);
}

/** How many bottom shooters fire on the same tick (different columns when possible) */
export function alienVolleyCountForWave(wave: number): number {
  if (wave >= 12) return 3;
  if (wave >= 6) return 2;
  return 1;
}

/**
 * Pick alien projectile type from wave, row (top → needle bias, bottom → heavy), and rng in [0,1).
 */
export function pickAlienWeaponKind(
  wave: number,
  row: number,
  rand01: number,
): AlienWeaponKind {
  const fromTop = row;
  const fromBottom = ALIEN_ROWS - 1 - row;
  /** 0 on wave 1 → bolt-only; ramps to 1 by ~wave 6 */
  const ramp = Math.min(1, Math.max(0, (wave - 1) / 5));
  const needleChance =
    ramp * Math.min(0.35, 0.05 + wave * 0.018 + fromTop * 0.04);
  const heavyChance =
    ramp * Math.min(0.22, Math.max(0, wave - 3) * 0.022 + fromBottom * 0.035);
  const plasmaChance =
    ramp * Math.min(0.28, Math.max(0, wave - 2) * 0.025 + 0.06);

  let r = rand01;
  if (r < needleChance) return "needle";
  r -= needleChance;
  if (r < heavyChance) return "heavy";
  r -= heavyChance;
  if (r < plasmaChance) return "plasma";
  return "bolt";
}

function velocityForAlienWeapon(
  kind: AlienWeaponKind,
  wave: number,
  needleVxSeed: number,
): { vx: number; vy: number } {
  const base = alienBulletSpeedForWave(wave);
  switch (kind) {
    case "bolt":
      return { vx: 0, vy: base };
    case "plasma":
      return { vx: 0, vy: base * 0.82 };
    case "needle":
      return {
        vx: (needleVxSeed - 0.5) * 95,
        vy: base * 1.22,
      };
    case "heavy":
      return { vx: 0, vy: base * 0.68 };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function createAlienBullet(
  x: number,
  y: number,
  wave: number,
  row: number,
  randKind: number,
  randNeedle: number,
): AlienBullet {
  const kind = pickAlienWeaponKind(wave, row, randKind);
  const { vx, vy } = velocityForAlienWeapon(kind, wave, randNeedle);
  return { x, y, kind, vx, vy };
}

function alienBulletHitSize(kind: AlienWeaponKind): { w: number; h: number } {
  switch (kind) {
    case "needle":
      return { w: BULLET_W * 0.78, h: BULLET_H * 1.05 };
    case "plasma":
      return { w: BULLET_W * 1.55, h: BULLET_H * 1.22 };
    case "heavy":
      return { w: BULLET_W * 1.72, h: BULLET_H * 1.48 };
    case "bolt":
      return { w: BULLET_W, h: BULLET_H };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function alienBulletHitRect(b: AlienBullet) {
  const { w, h } = alienBulletHitSize(b.kind);
  return {
    left: b.x - w / 2,
    top: b.y,
    right: b.x + w / 2,
    bottom: b.y + h,
  };
}

function sampleWithoutReplacement<T>(items: T[], count: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const j = Math.floor(Math.random() * pool.length);
    out.push(pool[j]!);
    pool.splice(j, 1);
  }
  return out;
}

function normalizeAlienBullet(
  b: SerializedAlienBullet,
  wave: number,
): AlienBullet {
  const kind = b.kind ?? "bolt";
  if (typeof b.vx === "number" && typeof b.vy === "number") {
    return { x: b.x, y: b.y, kind, vx: b.vx, vy: b.vy };
  }
  return {
    x: b.x,
    y: b.y,
    kind,
    ...velocityForAlienWeapon(kind, wave, 0.5),
  };
}

function randomBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function newLootSpawnTimer(): number {
  return randomBetween(LOOT_SPAWN_MIN, LOOT_SPAWN_MAX);
}

export function createBurst(
  x: number,
  y: number,
  count: number,
  hueBase: number,
  speedMin = 52,
  speedMax = 175,
  lifeMin = 0.26,
  lifeMax = 0.68,
): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = randomBetween(speedMin, speedMax);
    const life = randomBetween(lifeMin, lifeMax);
    out.push({
      x,
      y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life,
      maxLife: life,
      hue: hueBase + randomBetween(-40, 40),
      size: randomBetween(1.5, 4.8),
    });
  }
  return out;
}

function clampWeapon(w: number): number {
  return Math.max(0, Math.min(MAX_WEAPON_LEVEL, Math.floor(w)));
}

function pushParticles(state: GameState, burst: Particle[]): GameState {
  const cap = 240;
  const combined = [...state.particles, ...burst].slice(-cap);
  return { ...state, particles: combined };
}

function tickParticles(state: GameState, dt: number): GameState {
  const particles = state.particles
    .map((p) => ({
      ...p,
      x: p.x + p.vx * dt,
      y: p.y + p.vy * dt,
      vy: p.vy + 28 * dt,
      life: p.life - dt,
    }))
    .filter((p) => p.life > 0);
  return { ...state, particles };
}

function randomLootKind(): LootKind {
  const r = Math.random();
  if (r < 0.36) return "weapon";
  if (r < 0.68) return "shield";
  return "burst";
}

function spawnLootDrop(x: number, y: number, kind: LootKind): LootDrop {
  return {
    x,
    y,
    vy: LOOT_FALL_SPEED + randomBetween(-8, 14),
    kind,
    phase: Math.random() * Math.PI * 2,
  };
}

function rollLootOnKill(cx: number, cy: number): LootDrop | null {
  const r = Math.random();
  if (r < 0.12) return spawnLootDrop(cx, cy, "weapon");
  if (r < 0.22) return spawnLootDrop(cx, cy, "shield");
  if (r < 0.28) return spawnLootDrop(cx, cy, "burst");
  return null;
}

export function createInitialState(): GameState {
  const wave = 1;
  return {
    status: "playing",
    wave,
    lives: INITIAL_LIVES,
    score: 0,
    weaponLevel: weaponLevelForWave(wave),
    shieldCharges: 0,
    lootDrops: [],
    particles: [],
    lootSpawnTimer: newLootSpawnTimer(),
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
    waveClearRemaining: 0,
  };
}

export function spawnWave(state: GameState): GameState {
  const wave = state.wave;
  const wx = state.playerX;
  const wy = PLAYER_Y;
  const celebrate = createBurst(wx, wy, 28, 210, 30, 120, 0.4, 0.9);
  return pushParticles(
    {
      ...state,
      alienGrid: emptyGrid(),
      alienOriginX: 24,
      alienOriginY: 56,
      alienDir: 1,
      alienMoveAcc: 0,
      alienMoveEvery: alienMoveEveryForWave(wave),
      alienFireAcc: 0,
      alienFireEvery: alienFireEveryForWave(wave),
      playerFireCooldown: 0,
      weaponLevel: Math.max(
        weaponLevelForWave(wave),
        clampWeapon(state.weaponLevel),
      ),
      playerBullets: [],
      alienBullets: [],
      lootDrops: [],
      status: "playing",
      waveClearRemaining: 0,
    },
    celebrate,
  );
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

const LOOT_BOX = 20;

function lootRect(d: LootDrop) {
  return {
    left: d.x - LOOT_BOX / 2,
    top: d.y - LOOT_BOX / 2,
    right: d.x + LOOT_BOX / 2,
    bottom: d.y + LOOT_BOX / 2,
  };
}

function tickPlayerMovementFireAndBullets(
  state: GameState,
  dt: number,
  input: GameInput,
): GameState {
  let next = state;
  if (input.moveLeft) {
    next = {
      ...next,
      playerX: Math.max(PLAYER_W / 2 + 4, next.playerX - PLAYER_SPEED * dt),
    };
  }
  if (input.moveRight) {
    next = {
      ...next,
      playerX: Math.min(
        GAME_W - PLAYER_W / 2 - 4,
        next.playerX + PLAYER_SPEED * dt,
      ),
    };
  }
  next = {
    ...next,
    playerFireCooldown: Math.max(0, next.playerFireCooldown - dt),
  };
  const lvl = clampWeapon(next.weaponLevel);
  const fireInterval = FIRE_INTERVAL[lvl] ?? FIRE_INTERVAL[0];
  if (input.fire && next.playerFireCooldown <= 0) {
    const px = next.playerX;
    const py = PLAYER_Y - 4;
    const burstMuzzle = createBurst(px, py + 4, 4, 145, 20, 55, 0.08, 0.16);
    next = pushParticles(next, burstMuzzle);
    const shots: PlayerBullet[] = [];
    if (lvl === 0) {
      shots.push({ x: px, y: py });
    } else if (lvl === 1) {
      shots.push({ x: px - 10, y: py }, { x: px + 10, y: py });
    } else if (lvl === 2) {
      shots.push(
        { x: px - 14, y: py },
        { x: px, y: py },
        { x: px + 14, y: py },
      );
    } else if (lvl === 3) {
      shots.push(
        { x: px - 16, y: py },
        { x: px - 8, y: py },
        { x: px, y: py },
        { x: px + 8, y: py },
        { x: px + 16, y: py },
      );
    } else {
      const spread = [-100, -52, 0, 52, 100];
      for (const vx of spread) {
        shots.push({ x: px, y: py, vx });
      }
    }
    next = {
      ...next,
      playerBullets: [...next.playerBullets, ...shots],
      playerFireCooldown: fireInterval,
    };
  }
  return {
    ...next,
    playerBullets: next.playerBullets
      .map((b) => ({
        ...b,
        x: b.x + (b.vx ?? 0) * dt,
        y: b.y - (b.vy ?? PLAYER_BULLET_SPEED) * dt,
      }))
      .filter((b) => b.y > -BULLET_H && b.x > -12 && b.x < GAME_W + 12),
  };
}

function tickAlienMotionFireAndAlienBullets(
  state: GameState,
  dt: number,
): GameState {
  let next = state;
  next = { ...next, alienMoveAcc: next.alienMoveAcc + dt };
  let steps = 0;
  while (next.alienMoveAcc >= next.alienMoveEvery && steps < 4) {
    next = { ...next, alienMoveAcc: next.alienMoveAcc - next.alienMoveEvery };
    next = stepAliens(next);
    steps += 1;
  }
  next = { ...next, alienFireAcc: next.alienFireAcc + dt };
  if (next.alienFireAcc >= next.alienFireEvery) {
    next = { ...next, alienFireAcc: 0 };
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
      const volley = alienVolleyCountForWave(next.wave);
      const picked = sampleWithoutReplacement(shooters, volley);
      const spawned: AlienBullet[] = [];
      for (const pick of picked) {
        const rect = alienRect(next, pick.row, pick.col);
        if (rect) {
          spawned.push(
            createAlienBullet(
              (rect.left + rect.right) / 2,
              rect.bottom + 2,
              next.wave,
              pick.row,
              Math.random(),
              Math.random(),
            ),
          );
        }
      }
      next = { ...next, alienBullets: [...next.alienBullets, ...spawned] };
    }
  }
  return {
    ...next,
    alienBullets: next.alienBullets
      .map((b) => ({
        ...b,
        x: b.x + b.vx * dt,
        y: b.y + b.vy * dt,
      }))
      .filter((b) => b.y < GAME_H + 36 && b.x > -24 && b.x < GAME_W + 24),
  };
}

function tickLootSpawnAndMove(state: GameState, dt: number): GameState {
  let next = state;
  next = { ...next, lootSpawnTimer: next.lootSpawnTimer - dt };
  if (next.lootSpawnTimer <= 0) {
    next = { ...next, lootSpawnTimer: newLootSpawnTimer() };
    const lx = randomBetween(36, GAME_W - 36);
    next = {
      ...next,
      lootDrops: [...next.lootDrops, spawnLootDrop(lx, -10, randomLootKind())],
    };
    next = pushParticles(next, createBurst(lx, 8, 10, 280, 15, 45, 0.35, 0.55));
  }
  return {
    ...next,
    lootDrops: next.lootDrops
      .map((d) => ({
        ...d,
        y: d.y + d.vy * dt,
        phase: d.phase + dt * 5,
      }))
      .filter((d) => d.y < GAME_H + 24),
  };
}

function resolvePlayerBulletsVsAliens(state: GameState): GameState {
  const grid = state.alienGrid.map((row) => [...row]);
  let score = state.score;
  let next = state;
  const pBullets: PlayerBullet[] = [];
  for (const bullet of state.playerBullets) {
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
          const cx = (ar.left + ar.right) / 2;
          const cy = (ar.top + ar.bottom) / 2;
          next = pushParticles(
            next,
            createBurst(cx, cy, 16, 32 + r * 14, 55, 190),
          );
          const drop = rollLootOnKill(cx, cy);
          if (drop) {
            next = { ...next, lootDrops: [...next.lootDrops, drop] };
            next = pushParticles(
              next,
              createBurst(
                cx,
                cy,
                22,
                drop.kind === "weapon" ? 48 : 175,
                40,
                140,
              ),
            );
          }
          hit = true;
        }
      }
    }
    if (!hit) pBullets.push(bullet);
  }
  return {
    ...next,
    alienGrid: grid,
    score,
    playerBullets: pBullets,
  };
}

function waveClearIfAllAliensDead(state: GameState): GameState | null {
  const aliveCount = state.alienGrid.flat().filter(Boolean).length;
  if (aliveCount !== 0) return null;
  return pushParticles(
    {
      ...state,
      status: "wave_clear",
      wave: state.wave + 1,
      waveClearRemaining: WAVE_CLEAR_DURATION,
      alienGrid: emptyGrid(),
      playerBullets: [],
      alienBullets: [],
      lootDrops: [],
      alienMoveAcc: 0,
      alienFireAcc: 0,
    },
    createBurst(GAME_W / 2, GAME_H * 0.35, 40, 300, 60, 200),
  );
}

function collectLootPickups(state: GameState): GameState {
  const pr = playerRect(state);
  const pickupPad = 6;
  const prWide = {
    left: pr.left - pickupPad,
    top: pr.top - pickupPad,
    right: pr.right + pickupPad,
    bottom: pr.bottom + pickupPad,
  };
  let next = state;
  let score = next.score;
  const keptLoot: LootDrop[] = [];
  for (const d of next.lootDrops) {
    if (overlap(lootRect(d), prWide)) {
      const cx = d.x;
      const cy = d.y;
      next = pushParticles(next, createBurst(cx, cy, 36, 52, 70, 220));
      if (d.kind === "weapon") {
        next = {
          ...next,
          weaponLevel: clampWeapon(next.weaponLevel + 1),
        };
        next = pushParticles(
          next,
          createBurst(cx, cy, 24, 38, 80, 240, 0.2, 0.45),
        );
      } else if (d.kind === "shield") {
        next = {
          ...next,
          shieldCharges: Math.min(MAX_SHIELD_CHARGES, next.shieldCharges + 1),
        };
        next = pushParticles(next, createBurst(cx, cy, 20, 200, 50, 160));
      } else {
        score += 65 + next.wave * 8;
        next = pushParticles(next, createBurst(cx, cy, 30, 45, 90, 260));
      }
      next = { ...next, score };
    } else {
      keptLoot.push(d);
    }
  }
  return { ...next, lootDrops: keptLoot };
}

function resolveAlienBulletsAndEndgame(state: GameState): GameState {
  const pr = playerRect(state);
  const prevLives = state.lives;
  let next = state;
  let lives = next.lives;
  let shieldCharges = next.shieldCharges;
  let tookHit = false;
  const aBullets: AlienBullet[] = [];
  for (const bullet of next.alienBullets) {
    const br = alienBulletHitRect(bullet);
    if (overlap(br, pr)) {
      if (shieldCharges > 0) {
        shieldCharges -= 1;
        next = pushParticles(
          next,
          createBurst(
            (br.left + br.right) / 2,
            (br.top + br.bottom) / 2,
            14,
            195,
            30,
            110,
          ),
        );
      } else if (!tookHit) {
        lives -= 1;
        tookHit = true;
      }
    } else {
      aBullets.push(bullet);
    }
  }
  next = { ...next, alienBullets: aBullets, lives, shieldCharges };

  if (lives < prevLives) {
    next = pushParticles(
      next,
      createBurst(next.playerX, PLAYER_Y, 45, 0, 80, 220, 0.35, 0.75),
    );
    next = {
      ...next,
      lives,
      alienBullets: [],
      shieldCharges: 0,
      playerX: GAME_W / 2,
    };
  }

  if (lives <= 0) {
    return pushParticles(
      { ...next, status: "gameover" },
      createBurst(next.playerX, PLAYER_Y, 70, 12, 100, 280, 0.5, 1.0),
    );
  }

  const bounds = gridBounds(next);
  if (bounds && bounds.maxY >= PLAYER_Y - 4) {
    return pushParticles(
      { ...next, status: "gameover", lives: 0 },
      createBurst(GAME_W / 2, PLAYER_Y - 40, 55, 25, 90, 260),
    );
  }

  return next;
}

export function tick(
  state: GameState,
  dt: number,
  input: GameInput,
): GameState {
  if (state.status === "wave_clear") {
    const t = state.waveClearRemaining - dt;
    let next: GameState = tickParticles(state, dt);
    if (t <= 0) {
      return spawnWave({
        ...next,
        status: "playing",
        waveClearRemaining: 0,
      });
    }
    return { ...next, waveClearRemaining: t };
  }

  if (state.status !== "playing") return state;

  let next: GameState = { ...state };
  next = tickParticles(next, dt);
  next = tickPlayerMovementFireAndBullets(next, dt, input);
  next = tickAlienMotionFireAndAlienBullets(next, dt);
  next = tickLootSpawnAndMove(next, dt);
  next = resolvePlayerBulletsVsAliens(next);
  const cleared = waveClearIfAllAliensDead(next);
  if (cleared) return cleared;
  next = collectLootPickups(next);
  next = resolveAlienBulletsAndEndgame(next);
  return next;
}

export function serializeGame(state: GameState): SerializedGameV1 | null {
  if (state.status === "gameover") return null;
  const status: SerializedGameV1["status"] =
    state.status === "paused"
      ? "paused"
      : state.status === "wave_clear"
        ? "wave_clear"
        : "playing";
  return {
    v: 2,
    wave: state.wave,
    lives: state.lives,
    score: state.score,
    weaponLevel: clampWeapon(state.weaponLevel),
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
    status,
    waveClearRemaining:
      state.status === "wave_clear" ? state.waveClearRemaining : undefined,
    shieldCharges: state.shieldCharges,
    lootDrops: state.lootDrops.map((d) => ({ ...d })),
    lootSpawnTimer: state.lootSpawnTimer,
  };
}

export function deserializeGame(data: SerializedGameV1): GameState {
  const status: GameState["status"] =
    data.status === "paused"
      ? "paused"
      : data.status === "wave_clear"
        ? "wave_clear"
        : "playing";
  const v = data.v === 2 ? 2 : 1;
  return {
    status,
    wave: data.wave,
    lives: data.lives,
    score: data.score,
    weaponLevel: clampWeapon(data.weaponLevel),
    playerX: data.playerX,
    alienGrid: data.alienGrid.map((r) => [...r]),
    alienOriginX: data.alienOriginX,
    alienOriginY: data.alienOriginY,
    alienDir: data.alienDir,
    alienMoveAcc: data.alienMoveAcc,
    alienMoveEvery: data.alienMoveEvery,
    playerBullets: data.playerBullets.map((b) => ({ ...b })),
    alienBullets: data.alienBullets.map((b) =>
      normalizeAlienBullet(b, data.wave),
    ),
    playerFireCooldown: data.playerFireCooldown,
    alienFireAcc: data.alienFireAcc,
    alienFireEvery: data.alienFireEvery,
    waveClearRemaining:
      data.status === "wave_clear"
        ? typeof data.waveClearRemaining === "number"
          ? data.waveClearRemaining
          : WAVE_CLEAR_DURATION
        : 0,
    shieldCharges:
      v === 2 && typeof data.shieldCharges === "number"
        ? Math.min(MAX_SHIELD_CHARGES, Math.max(0, data.shieldCharges))
        : 0,
    lootDrops:
      v === 2 && Array.isArray(data.lootDrops)
        ? data.lootDrops.map((d) => ({
            x: d.x,
            y: d.y,
            vy: d.vy,
            kind: d.kind,
            phase: typeof d.phase === "number" ? d.phase : 0,
          }))
        : [],
    particles: [],
    lootSpawnTimer:
      v === 2 && typeof data.lootSpawnTimer === "number"
        ? data.lootSpawnTimer
        : newLootSpawnTimer(),
  };
}
