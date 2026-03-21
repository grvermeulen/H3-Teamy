export type GameStatus = "playing" | "paused" | "gameover" | "wave_clear";

/** Player shots; optional vx for spread / fan fire */
export type PlayerBullet = {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
};
export type AlienWeaponKind = "bolt" | "plasma" | "needle" | "heavy";

/** Alien projectiles — vx/vy in px/s (vy positive = downward) */
export type AlienBullet = {
  x: number;
  y: number;
  kind: AlienWeaponKind;
  vx: number;
  vy: number;
};

/** Persisted alien shot — optional fields for v1 / legacy saves */
export type SerializedAlienBullet = {
  x: number;
  y: number;
  kind?: AlienWeaponKind;
  vx?: number;
  vy?: number;
};

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

/**
 * Volledige runtime-state van één Space Invaders-sessie.
 *
 * **Levenscyclus:** ontstaat bij `createInitialState` / hervatten uit save; elke frame bij `tick`;
 * bij golf leeg → `wave_clear` → `spawnWave`; bij levens op of invasie → `gameover` (niet opgeslagen).
 *
 * - **status** — `playing` | `paused` | `gameover` | `wave_clear`
 * - **wave / lives / score** — voortgang en punten
 * - **weaponLevel** — 0 = enkel schot, hoger = meer spreiding (zie `FIRE_INTERVAL`)
 * - **playerX** — horizontale positie schip
 * - **alienGrid** — `alive[row][col]`
 * - **alienOriginX/Y, alienDir** — blokpositie en richting (1 rechts, -1 links)
 * - **alienMoveAcc / alienMoveEvery** — accumulator t.o.v. staptempo
 * - **playerBullets / alienBullets** — actieve projectielen
 * - **playerFireCooldown, alienFireAcc / alienFireEvery** — vuurtiming
 */
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

/**
 * Spelerinvoer voor één simulatiestap (`tick`).
 *
 * @property moveLeft — schip naar links (keyboard / touch “links”)
 * @property moveRight — schip naar rechts
 * @property fire — vuur ingedrukt (continu vuren zolang `true` en cooldown 0)
 */
export type GameInput = {
  moveLeft: boolean;
  moveRight: boolean;
  fire: boolean;
};

/**
 * Persistentieformaat voor localStorage (versie **1** of **2**).
 *
 * - **v** — schemaversie (loot/schild zit in v2)
 * - **wave … alienFireEvery** — speltoestand zoals in `GameState` (geen particles)
 * - **status** — nooit `gameover` in een save
 * - **waveClearRemaining** — alleen relevant bij `wave_clear`
 * - **shieldCharges, lootDrops, lootSpawnTimer** — optioneel / v2
 * - **alienBullets[]** — mag ontbrekende `kind`/`vx`/`vy` hebben (legacy → default in `deserializeGame`)
 *
 * Runtime-validatie: `SerializedGameV1Schema` in `schemas.ts`.
 */
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
  alienBullets: SerializedAlienBullet[];
  playerFireCooldown: number;
  alienFireAcc: number;
  alienFireEvery: number;
  status: "playing" | "paused" | "wave_clear";
  waveClearRemaining?: number;
  shieldCharges?: number;
  lootDrops?: LootDrop[];
  lootSpawnTimer?: number;
};

/**
 * Eén regel op het lokale scorebord.
 *
 * @property score — behaalde punten (getal)
 * @property wave — hoogste bereikte golf (getal)
 * @property at — tijdstip als **ISO-8601**-string, UTC (`new Date().toISOString()`), bv. `"2026-03-21T12:00:00.000Z"`
 */
export type HighScoreEntry = {
  score: number;
  wave: number;
  at: string;
};
