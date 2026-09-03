"use client";

import { useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/nextjs";

/** Visibility phase of the app splash screen. */
export type SplashPhase = "visible" | "fading" | "hidden";

/** `sessionStorage` key that marks the splash screen as already shown for this browser session. */
export const SPLASH_SEEN_KEY = "h3-splash-seen-v1";
/** Minimum time, in milliseconds, the splash stays fully visible before it may start fading out. */
export const MIN_VISIBLE_MS = 1000;
/** Maximum time, in milliseconds, the splash stays visible before it fades out unconditionally. */
export const MAX_VISIBLE_MS = 4000;
/** Duration, in milliseconds, of the fade-out transition. */
export const FADE_MS = 400;

/**
 * Reports whether the user has requested reduced motion. jsdom (used in tests) has no
 * `matchMedia`, so this guards for its absence rather than assuming it exists.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Reads whether this browser session already saw the splash. `sessionStorage` throws in some
 * environments (e.g. Safari private mode); on failure this reports to Sentry and treats the
 * session as unseen.
 */
function readSeenFlag(): boolean {
  try {
    return sessionStorage.getItem(SPLASH_SEEN_KEY) !== null;
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "app-splash" } });
    return false;
  }
}

/**
 * Marks this browser session as having seen the splash, so it will not show again until the
 * session storage is cleared. Reports to Sentry if `sessionStorage` throws (e.g. Safari private
 * mode); the current page load still shows the splash either way.
 */
function markSeen(): void {
  try {
    sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
  } catch (error) {
    Sentry.captureException(error, { tags: { area: "app-splash" } });
  }
}

/**
 * Drives the once-per-session app splash screen's visibility.
 *
 * Starts at `"visible"` so the server-rendered first paint shows the splash. On mount it checks
 * `sessionStorage` for {@link SPLASH_SEEN_KEY}: if the session already saw the splash it hides
 * immediately, otherwise it marks the session as seen and stays visible for at least
 * {@link MIN_VISIBLE_MS} and until the page finishes loading, capped at {@link MAX_VISIBLE_MS}.
 * It then fades to `"fading"` for {@link FADE_MS} before settling on `"hidden"` (skipped when the
 * user prefers reduced motion, which goes straight to `"hidden"`). The show/skip decision is made
 * exactly once per component instance via a ref, so it survives React Strict Mode's simulated
 * mount -> cleanup -> remount in development. Every timer and listener is cleared on unmount.
 */
export function useSplashPhase(): SplashPhase {
  const [phase, setPhase] = useState<SplashPhase>("visible");
  const decisionRef = useRef<"show" | "skip" | null>(null);

  useEffect(() => {
    const alreadySeen = readSeenFlag();
    if (decisionRef.current === null) {
      decisionRef.current = alreadySeen ? "skip" : "show";
      if (!alreadySeen) markSeen();
    }
    if (decisionRef.current === "skip") {
      setPhase("hidden");
      return;
    }

    let minVisibleElapsed = false;
    let pageReady = document.readyState === "complete";
    let settled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function finish(): void {
      if (settled) return;
      settled = true;
      if (prefersReducedMotion()) {
        setPhase("hidden");
        return;
      }
      setPhase("fading");
      timers.push(setTimeout(() => setPhase("hidden"), FADE_MS));
    }
    function maybeFinish(): void {
      if (minVisibleElapsed && pageReady) finish();
    }
    function onLoad(): void {
      pageReady = true;
      maybeFinish();
    }

    timers.push(
      setTimeout(() => {
        minVisibleElapsed = true;
        maybeFinish();
      }, MIN_VISIBLE_MS),
    );
    timers.push(setTimeout(finish, MAX_VISIBLE_MS));
    if (!pageReady) window.addEventListener("load", onLoad);

    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("load", onLoad);
    };
  }, []);

  return phase;
}
