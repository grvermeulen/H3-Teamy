import * as Sentry from "@sentry/nextjs";
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
    vi.clearAllMocks();
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

  it("loadSave returns null for wrong version (Zod)", () => {
    store[SAVE_KEY] = JSON.stringify({ v: 0, wave: 1 });
    expect(loadSave()).toBeNull();
  });

  it("loadSave returns null when shape fails Zod", () => {
    store[SAVE_KEY] = JSON.stringify({
      v: 2,
      wave: 1,
      alienGrid: "not-a-grid",
    });
    expect(loadSave()).toBeNull();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled();
  });

  it("loadSave returns null when SAVE_KEY missing", () => {
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

  it("saveGameToStorage removes key when serialize returns null (gameover)", () => {
    store[SAVE_KEY] = "should-remove";
    const dead = { ...createInitialState(), status: "gameover" as const };
    saveGameToStorage(dead);
    expect(store[SAVE_KEY]).toBeUndefined();
  });

  it("saveGameToStorage captures Sentry when setItem throws", () => {
    const stub = globalThis.localStorage as {
      setItem: (k: string, v: string) => void;
    };
    stub.setItem = () => {
      throw new Error("quota");
    };
    saveGameToStorage(createInitialState());
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled();
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

  it("loadHighScores returns empty for non-array JSON", () => {
    store[SCORES_KEY] = JSON.stringify({ not: "array" });
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

  it("addHighScore reports Sentry when setItem throws", () => {
    const stub = globalThis.localStorage as {
      setItem: (k: string, v: string) => void;
    };
    stub.setItem = () => {
      throw new Error("quota");
    };
    addHighScore({ score: 1, wave: 1, at: "x" });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled();
  });
});
