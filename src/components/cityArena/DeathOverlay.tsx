"use client";

import { useEffect, useState } from "react";
import {
  deathScreenPhase,
  type DeathScreenStage,
} from "@/lib/cityArena/render/deathScreen";

/** WebP source of the death-screen artwork (spec §7). */
export const WASTED_WEBP = "/branding/wasted-screen.webp";
/** JPEG fallback of the death-screen artwork. */
export const WASTED_JPG = "/branding/wasted-screen.jpg";
/** Alternative text of the artwork (spec §16). */
export const WASTED_ALT = "Je bent uitgeschakeld";
/** How often the elapsed time is re-read while the overlay is up. */
const CLOCK_INTERVAL_MS = 50;
/** Milliseconds per second. */
const MS_PER_SECOND = 1000;
/** Slam-in keyframes for full motion (mirrors `deathScreenPhase().artScale`). */
const SLAM_ANIMATION = "animate-[arena-wasted-slam_250ms_ease-out_forwards]";
/** Fade-in keyframes under reduced motion. */
const FADE_ANIMATION = "animate-[arena-wasted-fade_300ms_ease-out_forwards]";

/** Props for {@link DeathOverlay}. */
export type DeathOverlayProps = {
  diedAtMs: number;
  reducedMotion: boolean;
  now?: () => number;
};

/** Default clock: the same performance clock the frame loop stamps `diedAtMs` with. */
function performanceNow(): number {
  return performance.now();
}

/** Seconds since `diedAtMs`, refreshed every 50 ms. */
function useElapsedSeconds(diedAtMs: number, now: () => number): number {
  const [elapsed, setElapsed] = useState(
    () => (now() - diedAtMs) / MS_PER_SECOND,
  );
  useEffect(() => {
    const handle = window.setInterval(
      () => setElapsed((now() - diedAtMs) / MS_PER_SECOND),
      CLOCK_INTERVAL_MS,
    );
    return () => window.clearInterval(handle);
  }, [diedAtMs, now]);
  return elapsed;
}

/** Props for {@link WastedArtwork}. */
type WastedArtworkProps = { reducedMotion: boolean };

/** The artwork shown complete (`object-contain`) over a blurred copy that fills the letterbox. */
function WastedArtwork({
  reducedMotion,
}: WastedArtworkProps): React.JSX.Element {
  const animation = reducedMotion ? FADE_ANIMATION : SLAM_ANIMATION;
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#050505]">
      <img
        src={WASTED_JPG}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl"
      />
      <picture>
        <source srcSet={WASTED_WEBP} type="image/webp" />
        <img
          src={WASTED_JPG}
          alt={WASTED_ALT}
          decoding="async"
          className={`absolute inset-0 h-full w-full object-contain ${animation}`}
        />
      </picture>
    </div>
  );
}

/** Classes of the black layer per stage: hidden, then a 400 ms fade, then solid. */
function blackoutClass(stage: DeathScreenStage): string {
  const base =
    "absolute inset-0 bg-black transition-opacity duration-[400ms] ease-in";
  return stage === "fade" || stage === "black"
    ? `${base} opacity-100`
    : `${base} opacity-0`;
}

/**
 * The dying player's own screen (spec §7): a desaturating, vignetted backdrop for 0.3 s, then the
 * artwork slams in, then a fade to black that holds until the simulation respawns and unmounts it.
 */
export default function DeathOverlay({
  diedAtMs,
  reducedMotion,
  now = performanceNow,
}: DeathOverlayProps): React.JSX.Element {
  const elapsed = useElapsedSeconds(diedAtMs, now);
  const phase = deathScreenPhase(elapsed, reducedMotion);
  return (
    <div
      data-testid="death-overlay"
      data-stage={phase.stage}
      role="presentation"
      className="pointer-events-none absolute inset-0 z-30 select-none"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(40,10,5,0.75)_100%)] backdrop-grayscale backdrop-sepia-[.35] backdrop-brightness-75" />
      {phase.artVisible ? (
        <WastedArtwork reducedMotion={reducedMotion} />
      ) : null}
      <div className={blackoutClass(phase.stage)} />
    </div>
  );
}
