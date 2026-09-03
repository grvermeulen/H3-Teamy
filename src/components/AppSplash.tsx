"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";

/** `sessionStorage` key that marks the splash screen as already shown for this browser session. */
export const SPLASH_SEEN_KEY = "h3-splash-seen-v1";
/** Minimum time, in milliseconds, the splash stays fully visible before it may start fading out. */
export const MIN_VISIBLE_MS = 1000;
/** Maximum time, in milliseconds, the splash stays visible before it fades out unconditionally. */
export const MAX_VISIBLE_MS = 4000;
/** Duration, in milliseconds, of the fade-out transition. */
export const FADE_MS = 400;

type SplashPhase = "visible" | "fading" | "hidden";

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
 * Full-screen splash screen shown once per browser session while the app loads.
 *
 * Renders visible on the server so it is part of the first paint. On mount it checks
 * `sessionStorage` for {@link SPLASH_SEEN_KEY}: if the session already saw the splash it
 * hides immediately, otherwise it marks the session as seen and stays visible for at
 * least {@link MIN_VISIBLE_MS} and until the page finishes loading, capped at
 * {@link MAX_VISIBLE_MS}. It then fades out over {@link FADE_MS} (skipped when the user
 * prefers reduced motion) before unmounting itself.
 */
export default function AppSplash(): React.JSX.Element | null {
  const [phase, setPhase] = useState<SplashPhase>("visible");

  useEffect(() => {
    let alreadySeen = false;
    try {
      alreadySeen = sessionStorage.getItem(SPLASH_SEEN_KEY) !== null;
    } catch (error) {
      Sentry.captureException(error, { tags: { area: "app-splash" } });
      alreadySeen = false;
    }

    if (alreadySeen) {
      setPhase("hidden");
      return;
    }

    try {
      sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
    } catch (error) {
      Sentry.captureException(error, { tags: { area: "app-splash" } });
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
      if (minVisibleElapsed && pageReady) {
        finish();
      }
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

    if (!pageReady) {
      window.addEventListener("load", onLoad);
    }

    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("load", onLoad);
    };
  }, []);

  if (phase === "hidden") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="app-splash"
      className={`fixed inset-0 z-[4000] bg-[#0B1220] transition-opacity duration-[400ms] motion-reduce:transition-none ${phase === "fading" ? "opacity-0" : "opacity-100"}`}
    >
      <picture>
        <source srcSet="/branding/splash-app-portrait.webp" type="image/webp" />
        <img
          src="/branding/splash-app-portrait.jpg"
          alt=""
          decoding="async"
          fetchPriority="high"
          className="h-full w-full object-cover object-top"
        />
      </picture>
      <span className="sr-only">De Rijn H3 laden…</span>
    </div>
  );
}
