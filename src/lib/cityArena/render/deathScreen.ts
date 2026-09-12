/** Seconds of slow motion, desaturation and push-in before the artwork lands (spec §7). */
export const DEATH_SLOWMO_END_S = 0.3;
/** Seconds at which the slam (1.15× → 1× with overshoot) has settled. */
export const DEATH_SLAM_END_S = 0.55;
/** Seconds at which the fade to black starts (spec §7). */
export const DEATH_FADE_START_S = 2.6;
/** Seconds at which the screen is fully black; equals the respawn delay (spec §7). */
export const DEATH_END_S = 3.0;
/** Simulation time scale during the slow-motion beat (spec §7: 0.25×). */
export const DEATH_SLOWMO_TIME_SCALE = 0.25;
/** Camera push-in reached at the end of the slow-motion beat. */
export const DEATH_PUSH_IN_MAX = 1.08;
/** Starting scale of the artwork slam (spec §7: 1.15×). */
const SLAM_START_SCALE = 1.15;
/** Cosine turns over the slam: 1.5 turns dips 5 % below 1 at two thirds, then settles at 1. */
const SLAM_OVERSHOOT_TURNS = 1.5;

/** The four beats of the death screen. */
export type DeathScreenStage = "slowmo" | "art" | "fade" | "black";

/** Everything the frame loop and the overlay need for one instant of the death screen. */
export type DeathScreenPhase = {
  stage: DeathScreenStage;
  timeScale: number;
  pushIn: number;
  artVisible: boolean;
  artScale: number;
  blackout: number;
};

/** Artwork scale during the slam: 1.15 at 0.3 s, a 0.95 dip, 1 from 0.55 s; 1 throughout under reduced motion. */
function slamScale(elapsedS: number, reducedMotion: boolean): number {
  if (reducedMotion || elapsedS >= DEATH_SLAM_END_S) return 1;
  const progress =
    (elapsedS - DEATH_SLOWMO_END_S) / (DEATH_SLAM_END_S - DEATH_SLOWMO_END_S);
  return (
    1 +
    (SLAM_START_SCALE - 1) *
      (1 - progress) *
      Math.cos(SLAM_OVERSHOOT_TURNS * Math.PI * progress)
  );
}

/** Pure beat function of the seconds since the death tick (spec §7); negative input counts as 0. */
export function deathScreenPhase(
  elapsedS: number,
  reducedMotion: boolean,
): DeathScreenPhase {
  const elapsed = Math.max(0, elapsedS);
  if (elapsed < DEATH_SLOWMO_END_S) {
    const progress = elapsed / DEATH_SLOWMO_END_S;
    return {
      stage: "slowmo",
      timeScale: reducedMotion ? 1 : DEATH_SLOWMO_TIME_SCALE,
      pushIn: reducedMotion ? 1 : 1 + (DEATH_PUSH_IN_MAX - 1) * progress,
      artVisible: false,
      artScale: 1,
      blackout: 0,
    };
  }
  const pushIn = reducedMotion ? 1 : DEATH_PUSH_IN_MAX;
  const artScale = slamScale(elapsed, reducedMotion);
  if (elapsed < DEATH_FADE_START_S)
    return {
      stage: "art",
      timeScale: 1,
      pushIn,
      artVisible: true,
      artScale,
      blackout: 0,
    };
  if (elapsed < DEATH_END_S) {
    const blackout =
      (elapsed - DEATH_FADE_START_S) / (DEATH_END_S - DEATH_FADE_START_S);
    return {
      stage: "fade",
      timeScale: 1,
      pushIn,
      artVisible: true,
      artScale: 1,
      blackout,
    };
  }
  return {
    stage: "black",
    timeScale: 1,
    pushIn,
    artVisible: true,
    artScale: 1,
    blackout: 1,
  };
}
