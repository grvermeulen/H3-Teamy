import { z } from "zod";

const playerBulletSaved = z.object({
  x: z.number(),
  y: z.number(),
  vx: z.number().optional(),
  vy: z.number().optional(),
});

const serializedAlienBulletSaved = z.object({
  x: z.number(),
  y: z.number(),
  kind: z.enum(["bolt", "plasma", "needle", "heavy"]).optional(),
  vx: z.number().optional(),
  vy: z.number().optional(),
});

const lootDropSaved = z.object({
  x: z.number(),
  y: z.number(),
  vy: z.number(),
  kind: z.enum(["weapon", "shield", "burst"]),
  phase: z.number(),
});

/**
 * Runtime-validatie voor localStorage save (`SerializedGameV1`).
 * Alleen gebruiken na `JSON.parse`; bij fout blijft loadSave `null`.
 */
export const SerializedGameV1Schema = z.object({
  v: z.union([z.literal(1), z.literal(2)]),
  wave: z.number(),
  lives: z.number(),
  score: z.number(),
  weaponLevel: z.number(),
  playerX: z.number(),
  alienGrid: z.array(z.array(z.boolean())),
  alienOriginX: z.number(),
  alienOriginY: z.number(),
  alienDir: z.union([z.literal(1), z.literal(-1)]),
  alienMoveAcc: z.number(),
  alienMoveEvery: z.number(),
  playerBullets: z.array(playerBulletSaved),
  alienBullets: z.array(serializedAlienBulletSaved),
  playerFireCooldown: z.number(),
  alienFireAcc: z.number(),
  alienFireEvery: z.number(),
  status: z.enum(["playing", "paused", "wave_clear"]),
  waveClearRemaining: z.number().optional(),
  shieldCharges: z.number().optional(),
  lootDrops: z.array(lootDropSaved).optional(),
  lootSpawnTimer: z.number().optional(),
});

/** Eén highscore-regel (`at` = ISO-8601 string, liefst UTC). */
export const HighScoreEntrySchema = z.object({
  score: z.number(),
  wave: z.number(),
  at: z.string().min(1),
});
