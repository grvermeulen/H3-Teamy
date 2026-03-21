import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "./game";
import {
  SAVE_KEY,
  SCORES_KEY,
  addHighScore,
  clearSave,
  loadHighScores,
  loadSave,
  mergeHighScores,
  saveGameToStorage,
} from "./storage";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("mergeHighScores", () => {
  it("merges and caps", () => {
    const a = mergeHighScores(
      [
        { score: 10, wave: 1, at: "a" },
        { score: 5, wave: 1, at: "b" },
      ],
      { score: 7, wave: 2, at: "c" },
      2,
    );
    expect(a).toEqual([
      { score: 10, wave: 1, at: "a" },
      { score: 7, wave: 2, at: "c" },
    ]);
  });
});

describe("localStorage persistence", () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k in store ? store[k]! : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loadSave returns null for corrupt JSON", () => {
    store[SAVE_KEY] = "{not json";
    expect(loadSave()).toBeNull();
  });

  it("loadSave returns null for wrong version", () => {
    store[SAVE_KEY] = JSON.stringify({ v: 0, wave: 1 });
    expect(loadSave()).toBeNull();
  });

  it("saveGameToStorage and loadSave round-trip", () => {
    const s = createInitialState();
    saveGameToStorage(s);
    const loaded = loadSave();
    expect(loaded).not.toBeNull();
    expect(loaded!.wave).toBe(s.wave);
    expect(loaded!.score).toBe(s.score);
  });

  it("clearSave removes key", () => {
    store[SAVE_KEY] = "{}";
    clearSave();
    expect(store[SAVE_KEY]).toBeUndefined();
  });

  it("loadHighScores returns empty for invalid JSON", () => {
    store[SCORES_KEY] = "x";
    expect(loadHighScores()).toEqual([]);
  });

  it("loadHighScores filters bad entries", () => {
    store[SCORES_KEY] = JSON.stringify([
      { score: 1, wave: 1, at: "a" },
      { score: "nope", wave: 1, at: "b" },
      null,
    ]);
    expect(loadHighScores()).toEqual([{ score: 1, wave: 1, at: "a" }]);
  });

  it("addHighScore persists sorted list", () => {
    const out = addHighScore({ score: 100, wave: 3, at: "t" });
    expect(out[0]).toEqual({ score: 100, wave: 3, at: "t" });
    const raw = JSON.parse(store[SCORES_KEY]!);
    expect(raw[0].score).toBe(100);
  });
});
