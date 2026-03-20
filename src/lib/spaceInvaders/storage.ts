import { deserializeGame, serializeGame } from "./game";
import type { GameState, HighScoreEntry, SerializedGameV1 } from "./types";

export const SAVE_KEY = "h3-space-invaders-save-v1";
export const SCORES_KEY = "h3-space-invaders-scores-v1";
/** First-run mobile touch hint (dismiss persists) */
export const TOUCH_TIP_KEY = "h3-space-invaders-touch-tip-v1";
export const MAX_HIGH_SCORES = 10;

export function loadSave(): GameState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SerializedGameV1;
    if (data?.v !== 1) return null;
    return deserializeGame(data);
  } catch {
    return null;
  }
}

export function saveGameToStorage(state: GameState): void {
  if (typeof window === "undefined") return;
  const s = serializeGame(state);
  if (s) localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  else localStorage.removeItem(SAVE_KEY);
}

export function clearSave(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SAVE_KEY);
}

export function loadHighScores(): HighScoreEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as HighScoreEntry[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (e) =>
          e &&
          typeof e.score === "number" &&
          typeof e.wave === "number" &&
          typeof e.at === "string",
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_HIGH_SCORES);
  } catch {
    return [];
  }
}

/** Pure merge for tests and deterministic ranking */
export function mergeHighScores(
  existing: HighScoreEntry[],
  entry: HighScoreEntry,
  max = MAX_HIGH_SCORES,
): HighScoreEntry[] {
  return [...existing, entry].sort((a, b) => b.score - a.score).slice(0, max);
}

export function addHighScore(entry: HighScoreEntry): HighScoreEntry[] {
  const list = mergeHighScores(loadHighScores(), entry);
  if (typeof window !== "undefined") {
    localStorage.setItem(SCORES_KEY, JSON.stringify(list));
  }
  return list;
}
