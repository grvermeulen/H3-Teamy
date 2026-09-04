import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import {
  FADE_MS,
  MAX_VISIBLE_MS,
  MIN_VISIBLE_MS,
  SPLASH_SEEN_KEY,
  useSplashPhase,
} from "./useSplashPhase";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("useSplashPhase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    sessionStorage.clear();
  });

  afterEach(() => {
    // Drop any per-test override of document.readyState so later tests see the jsdom default.
    Reflect.deleteProperty(document, "readyState");
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts visible, fades after MIN_VISIBLE_MS once ready, then hides after FADE_MS", () => {
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "complete",
    });
    const { result } = renderHook(() => useSplashPhase());

    expect(result.current).toBe("visible");

    act(() => {
      vi.advanceTimersByTime(MIN_VISIBLE_MS);
    });
    expect(result.current).toBe("fading");

    act(() => {
      vi.advanceTimersByTime(FADE_MS);
    });
    expect(result.current).toBe("hidden");
  });

  it("is hidden right after mount when the session already saw the splash", () => {
    sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
    const { result } = renderHook(() => useSplashPhase());
    expect(result.current).toBe("hidden");
  });

  it("skips the fade and goes straight to hidden when the user prefers reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "complete",
    });
    const { result } = renderHook(() => useSplashPhase());

    act(() => {
      vi.advanceTimersByTime(MIN_VISIBLE_MS);
    });
    expect(result.current).toBe("hidden");
  });

  it("reports storage errors to Sentry and still starts visible", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    const { result } = renderHook(() => useSplashPhase());

    expect(result.current).toBe("visible");
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { area: "app-splash" } }),
    );
  });

  it("hides at MAX_VISIBLE_MS + FADE_MS when the load event never fires and readyState stays loading", () => {
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "loading",
    });
    const { result } = renderHook(() => useSplashPhase());

    act(() => {
      vi.advanceTimersByTime(MAX_VISIBLE_MS + FADE_MS);
    });
    expect(result.current).toBe("hidden");
  });
});
