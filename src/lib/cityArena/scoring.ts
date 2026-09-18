/** Versioned inputs shared by the game and result validation. */
export type ArenaScore = { kills: number; deaths: number; cashEarned?: number };

/** Current rules award one point per earned euro and 250 per player kill. */
export function arenaScore(row: ArenaScore, version = 2): number {
  return version === 1 ? row.kills : row.kills * 250 + (row.cashEarned ?? 0);
}

/** Equal score and deaths share a place; caller-specific IDs only stabilize display order. */
export function compareArenaScores(
  a: ArenaScore,
  b: ArenaScore,
  version = 2,
): number {
  return arenaScore(b, version) - arenaScore(a, version) || a.deaths - b.deaths;
}

/** A zero-point round has no winner under either rules version. */
export function isArenaWinner(
  row: ArenaScore,
  best: ArenaScore,
  version = 2,
): boolean {
  return (
    arenaScore(best, version) > 0 &&
    compareArenaScores(row, best, version) === 0
  );
}
