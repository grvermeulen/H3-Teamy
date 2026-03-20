/** Logical game size (canvas scaled to fit UI). */
export const GAME_W = 360;
export const GAME_H = 520;

export const PLAYER_W = 36;
export const PLAYER_H = 14;
export const PLAYER_Y = GAME_H - 48;
export const PLAYER_SPEED = 220;

export const ALIEN_COLS = 8;
export const ALIEN_ROWS = 4;
export const ALIEN_W = 28;
export const ALIEN_H = 18;
export const ALIEN_GAP_X = 10;
export const ALIEN_GAP_Y = 8;

export const BULLET_W = 4;
export const BULLET_H = 10;
export const PLAYER_BULLET_SPEED = 320;
export const ALIEN_BULLET_SPEED = 140;

export const INITIAL_LIVES = 3;
export const ALIEN_SCORE_BASE = 10;

/** Brief pause before the next wave spawns (seconds) */
export const WAVE_CLEAR_DURATION = 1.55;

/** Seconds between player shots at weapon level 0 / 1 / 2 */
export const FIRE_INTERVAL: [number, number, number] = [0.42, 0.32, 0.22];

/** Base alien horizontal step (px) per move */
export const ALIEN_STEP_X = 8;
/** Drop when reversing at edge */
export const ALIEN_DROP_Y = 14;
