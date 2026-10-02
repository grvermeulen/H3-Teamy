"use client";

import { useSplashPhase } from "./useSplashPhase";

export {
  SPLASH_SEEN_KEY,
  MIN_VISIBLE_MS,
  MAX_VISIBLE_MS,
  FADE_MS,
} from "./useSplashPhase";

/**
 * Full-screen splash screen shown once per browser session while the app loads.
 *
 * Rendering and accessibility only — the session/timer state machine that decides when to show,
 * fade and hide it lives in {@link useSplashPhase}. Renders visible on the server so it is part
 * of the first paint, then mirrors whatever phase the hook reports until it settles on `"hidden"`.
 */
export default function AppSplash(): React.JSX.Element | null {
  const phase = useSplashPhase();

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
