import { describe, expect, it } from "vitest";
import { SLOWMO_RATE, cueRate } from "./audio";
import { FIGHT_CLIPS, FIGHT_CLIP_NAMES, fightClipUrl } from "./clips";

describe("fight audio", () => {
  it("plays a cue at its own rate, and deeper in slow motion", () => {
    expect(cueRate(undefined, false)).toBe(1);
    expect(cueRate(1.2, false)).toBe(1.2);
    expect(cueRate(1, true)).toBe(SLOWMO_RATE);
    expect(cueRate(0.5, true)).toBeCloseTo(0.5 * SLOWMO_RATE);
  });

  it("serves every clip from the fight's audio folder as an mp3", () => {
    for (const name of FIGHT_CLIP_NAMES) {
      expect(fightClipUrl(name)).toBe(`/arena/fight/${FIGHT_CLIPS[name]}`);
      expect(FIGHT_CLIPS[name]).toMatch(/\.mp3$/);
    }
  });
});
