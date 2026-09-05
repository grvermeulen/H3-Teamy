import { describe, expect, it } from "vitest";
import { addEffect, effectProgress, pruneEffects } from "./effects";
import type { EffectState } from "./types";

describe("effects", () => {
  it("adds effects with the ttl of their kind and prunes them when expired", () => {
    const effects = addEffect([], {
      id: 1,
      kind: "explosion",
      x: 0,
      y: 0,
      angle: 0,
      bornTick: 10,
    });
    expect(effects[0].ttlTicks).toBe(18);
    expect(pruneEffects(effects, 27)).toHaveLength(1);
    expect(pruneEffects(effects, 28)).toEqual([]);
    expect(effectProgress(effects[0], 19)).toBeCloseTo(0.5);
  });

  it("keeps only the newest 64 effects", () => {
    let effects: EffectState[] = [];
    for (let id = 0; id < 70; id++)
      effects = addEffect(effects, {
        id,
        kind: "impact",
        x: 0,
        y: 0,
        angle: 0,
        bornTick: 0,
      });
    expect(effects).toHaveLength(64);
    expect(effects[0].id).toBe(6);
  });
});
