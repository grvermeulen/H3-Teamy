export type GameStatus = "playing" | "paused" | "gameover" | "wave_clear";

/** Player shots; optional vx for spread / fan fire */
export type PlayerBullet = {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
};
export type AlienBullet = { x: number; y: number };

export type LootKind = "weapon" | "shield" | "burst";

/** Falling power-up */
export type LootDrop = {
  x: number;
  y: number;
  vy: number;
  kind: LootKind;
  phase: number;
};

/** Short-lived visual particle */
export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
};

export type GameState = {
  status: GameStatus;
  wave: number;
  lives: number;
  score: number;
  /** 0–4 — fan fire at high tiers; floor from wave + pickups (see FIRE_INTERVAL) */
  weaponLevel: number;
  /** Extra hits absorbed (alien bullets) before life loss */
  shieldCharges: number;
  lootDrops: LootDrop[];
  particles: Particle[];
  /** Seconds until a random bonus crate may spawn from the sky */
  lootSpawnTimer: number;
  playerX: number;
  /** alive[r][c] */
  alienGrid: boolean[][];
  alienOriginX: number;
  alienOriginY: number;
  alienDir: 1 | -1;
  /** Accumulator; when >= threshold, aliens step */
  alienMoveAcc: number;
  alienMoveEvery: number;
  playerBullets: PlayerBullet[];
  alienBullets: AlienBullet[];
  playerFireCooldown: number;
  alienFireAcc: number;
  alienFireEvery: number;
  /** Seconds remaining for wave-clear interstitial; 0 when not active */
  waveClearRemaining: number;
};

export type GameInput = {
  moveLeft: boolean;
  moveRight: boolean;
  fire: boolean;
};

export type SerializedGameV1 = {
  v: 1 | 2;
  wave: number;
  lives: number;
  score: number;
  weaponLevel: number;
  playerX: number;
  alienGrid: boolean[][];
  alienOriginX: number;
  alienOriginY: number;
  alienDir: 1 | -1;
  alienMoveAcc: number;
  alienMoveEvery: number;
  playerBullets: PlayerBullet[];
  alienBullets: AlienBullet[];
  playerFireCooldown: number;
  alienFireAcc: number;
  alienFireEvery: number;
  status: "playing" | "paused" | "wave_clear";
  waveClearRemaining?: number;
  shieldCharges?: number;
  lootDrops?: LootDrop[];
  lootSpawnTimer?: number;
};

export type HighScoreEntry = {
  score: number;
  wave: number;
  at: string;
};
