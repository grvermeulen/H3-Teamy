import * as Sentry from "@sentry/nextjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARENA_SETTINGS_KEY,
  loadArenaSettings,
  saveArenaSettings,
} from "./storage";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

describe("arena settings storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadArenaSettings()).toEqual({ lastZone: "wageningen" });
  });

  it("round-trips a patch", () => {
    saveArenaSettings({ lastZone: "rhenen" });
    expect(
      JSON.parse(localStorage.getItem(ARENA_SETTINGS_KEY) ?? "{}"),
    ).toEqual({ lastZone: "rhenen" });
    expect(loadArenaSettings().lastZone).toBe("rhenen");
  });

  it("falls back to defaults and reports invalid JSON", () => {
    localStorage.setItem(ARENA_SETTINGS_KEY, "{ not json");
    expect(loadArenaSettings()).toEqual({ lastZone: "wageningen" });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { area: "arena", kind: "settings-load" },
      }),
    );
  });

  it("reports storage failures on save without throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveArenaSettings({ lastZone: "campus" })).not.toThrow();
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { area: "arena", kind: "settings-save" },
      }),
    );
  });
});
