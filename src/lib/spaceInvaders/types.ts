export type GameStatus = "playing" | "paused" | "gameover" | "wave_clear";

export type PlayerBullet = { x: number; y: number };
export type AlienBullet = { x: number; y: number };

export type GameState = {
  status: GameStatus;
  wave: number;
  lives: number;
  score: number;
  /** 0 = single, 1 = double spread, 2 = triple + faster (see FIRE_INTERVAL) */
  weaponLevel: number;
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
  v: 1;
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
};

export type HighScoreEntry = {
  score: number;
  wave: number;
  at: string;
};
