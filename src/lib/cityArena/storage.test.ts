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
    expect(loadArenaSettings()).toEqual({
      lastZone: "wageningen",
      sound: true,
      vibrate: true,
      twinStick: true,
    });
  });

  it("round-trips a patch", () => {
    saveArenaSettings({ lastZone: "rhenen" });
    expect(
      JSON.parse(localStorage.getItem(ARENA_SETTINGS_KEY) ?? "{}"),
    ).toEqual({
      lastZone: "rhenen",
      sound: true,
      vibrate: true,
      twinStick: true,
    });
    expect(loadArenaSettings().lastZone).toBe("rhenen");
  });

  it("falls back to defaults and reports invalid JSON", () => {
    localStorage.setItem(ARENA_SETTINGS_KEY, "{ not json");
    expect(loadArenaSettings()).toEqual({
      lastZone: "wageningen",
      sound: true,
      vibrate: true,
      twinStick: true,
    });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { area: "arena", kind: "settings-load" },
      }),
    );
  });

  it("falls back to defaults and reports valid JSON with an invalid shape", () => {
    localStorage.setItem(
      ARENA_SETTINGS_KEY,
      JSON.stringify({ lastZone: "onbekend" }),
    );
    expect(loadArenaSettings()).toEqual({
      lastZone: "wageningen",
      sound: true,
      vibrate: true,
      twinStick: true,
    });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { area: "arena", kind: "settings-invalid" },
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

  it("keeps a forced layout, and drops it again when set to nothing", () => {
    saveArenaSettings({ forceLayout: "mobile" });
    expect(loadArenaSettings().forceLayout).toBe("mobile");
    saveArenaSettings({ forceLayout: undefined });
    expect(loadArenaSettings().forceLayout).toBeUndefined();
  });

  it("falls back to the defaults, and reports, when a switch holds something else", () => {
    localStorage.setItem(
      ARENA_SETTINGS_KEY,
      JSON.stringify({ sound: false, vibrate: "ja", twinStick: 1 }),
    );
    expect(loadArenaSettings()).toEqual({
      lastZone: "wageningen",
      sound: true,
      vibrate: true,
      twinStick: true,
    });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
  });
});
