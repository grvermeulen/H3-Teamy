import {
  act,
  cleanup,
  configure,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppSplash, {
  FADE_MS,
  MAX_VISIBLE_MS,
  MIN_VISIBLE_MS,
  SPLASH_SEEN_KEY,
} from "./AppSplash";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

describe("AppSplash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    sessionStorage.clear();
  });

  afterEach(() => {
    // Drop any per-test override of document.readyState so later tests see the jsdom default.
    Reflect.deleteProperty(document, "readyState");
    vi.useRealTimers();
    cleanup();
  });

  it("renders the splash on first load and marks the session", () => {
    render(<AppSplash />);
    expect(screen.getByTestId("app-splash")).toBeInTheDocument();
    expect(sessionStorage.getItem(SPLASH_SEEN_KEY)).toBe("1");
  });

  it("starts fading once the page is ready and MIN_VISIBLE_MS elapsed, then hides after FADE_MS", () => {
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "complete",
    });
    render(<AppSplash />);

    act(() => {
      vi.advanceTimersByTime(MIN_VISIBLE_MS);
    });
    expect(screen.getByTestId("app-splash")).toHaveClass("opacity-0");

    act(() => {
      vi.advanceTimersByTime(FADE_MS);
    });
    expect(screen.queryByTestId("app-splash")).not.toBeInTheDocument();
  });

  it("does not render when the session already saw the splash", () => {
    sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
    render(<AppSplash />);
    expect(screen.queryByTestId("app-splash")).not.toBeInTheDocument();
  });

  it("hides at MAX_VISIBLE_MS + FADE_MS even when the load event never fires and readyState stays loading", () => {
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "loading",
    });
    render(<AppSplash />);

    act(() => {
      vi.advanceTimersByTime(MAX_VISIBLE_MS + FADE_MS);
    });
    expect(screen.queryByTestId("app-splash")).not.toBeInTheDocument();
  });

  it("keeps showing under React Strict Mode double effects", () => {
    configure({ reactStrictMode: true });
    try {
      Object.defineProperty(document, "readyState", {
        configurable: true,
        value: "complete",
      });
      render(<AppSplash />);
      expect(screen.getByTestId("app-splash")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(MIN_VISIBLE_MS - 1);
      });
      expect(screen.getByTestId("app-splash")).not.toHaveClass("opacity-0");

      act(() => {
        vi.advanceTimersByTime(1 + FADE_MS);
      });
      expect(screen.queryByTestId("app-splash")).not.toBeInTheDocument();
    } finally {
      configure({ reactStrictMode: false });
    }
  });
});
