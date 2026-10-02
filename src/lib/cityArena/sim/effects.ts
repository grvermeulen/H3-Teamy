import type { EffectKind, EffectState } from "./types";

/** Lifetime of each effect kind in ticks. */
export const EFFECT_TTL_TICKS: Record<EffectKind, number> = {
  muzzle: 2,
  impact: 6,
  explosion: 18,
};

/** Hard cap on live effects; the oldest are dropped first. */
export const MAX_EFFECTS = 64;

/** Appends an effect with the ttl of its kind, dropping the oldest beyond the cap. */
export function addEffect(
  effects: EffectState[],
  effect: Omit<EffectState, "ttlTicks">,
): EffectState[] {
  const next = [
    ...effects,
    { ...effect, ttlTicks: EFFECT_TTL_TICKS[effect.kind] },
  ];
  return next.length > MAX_EFFECTS
    ? next.slice(next.length - MAX_EFFECTS)
    : next;
}

/** Effects still alive at `tick`. */
export function pruneEffects(
  effects: EffectState[],
  tick: number,
): EffectState[] {
  return effects.filter((effect) => tick - effect.bornTick < effect.ttlTicks);
}

/** Lifetime progress in 0..1 for the renderer. */
export function effectProgress(effect: EffectState, tick: number): number {
  return Math.min(1, Math.max(0, (tick - effect.bornTick) / effect.ttlTicks));
}
