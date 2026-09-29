import { describe, expect, it } from "vitest";
import { ScriptBuilder } from "./script";
import { COMBO_GAP, TimeWarp, comboAt, fighterAt, healthAt } from "./timeline";

/** A small fight: two blows with hit-stops, then slow motion. */
function tiny() {
  const b = new ScriptBuilder({ staal: 400, trump: 600 }, 0);
  b.clip("staal", 1, "jab", 0.25);
  b.hit(
    1.1,
    "staal",
    10,
    "light",
    { who: "staal", limb: "handF" },
    { stop: 0.1 },
  );
  b.hit(
    1.5,
    "staal",
    20,
    "heavy",
    { who: "staal", limb: "handF" },
    { stop: 0.2 },
  );
  b.hit(4, "staal", 5, "light", { who: "staal", limb: "handF" }, { stop: 0 });
  b.slowmo(2, 3, 0.25);
  return b.build(5);
}

describe("TimeWarp", () => {
  const warp = new TimeWarp(tiny());

  it("runs story time at real speed until the first hit-stop", () => {
    expect(warp.storyAt(0.5)).toBeCloseTo(0.5);
    expect(warp.storyAt(1.1)).toBeCloseTo(1.1);
  });

  it("freezes the story through a hit-stop, while effects keep running", () => {
    expect(warp.storyAt(1.15)).toBeCloseTo(1.1);
    expect(warp.storyAt(1.19)).toBeCloseTo(1.1);
    expect(warp.effectRateAt(1.15)).toBe(1);
    expect(warp.storyAt(1.3)).toBeCloseTo(1.2);
  });

  it("stretches slow motion and slows effects with it", () => {
    const r0 = warp.realAt(2);
    expect(warp.realAt(3) - r0).toBeCloseTo(4);
    expect(warp.storyAt(r0 + 2)).toBeCloseTo(2.5);
    expect(warp.inSlowmo(r0 + 1)).toBe(true);
    expect(warp.effectRateAt(r0 + 1)).toBeCloseTo(0.25);
    expect(warp.inSlowmo(warp.realAt(3.5))).toBe(false);
  });

  it("round-trips story → real → story and never runs backwards", () => {
    let prev = -1;
    for (let r = 0; r < 12; r += 0.013) {
      const s = warp.storyAt(r);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    for (const s of [0.3, 1.4, 2.2, 2.9, 4.5])
      expect(warp.storyAt(warp.realAt(s))).toBeCloseTo(s);
  });
});

describe("health and combos", () => {
  const script = tiny();

  it("takes damage as the blows land", () => {
    expect(healthAt(script, "trump", 1)).toBe(100);
    expect(healthAt(script, "trump", 1.1)).toBe(90);
    expect(healthAt(script, "trump", 4)).toBe(65);
    expect(healthAt(script, "staal", 4)).toBe(100);
  });

  it("counts blows close together as one combo and starts over after a pause", () => {
    expect(comboAt(script, "staal", 1.2).count).toBe(1);
    expect(comboAt(script, "staal", 1.6).count).toBe(2);
    expect(4 - 1.5).toBeGreaterThan(COMBO_GAP);
    expect(comboAt(script, "staal", 4.1).count).toBe(1);
  });
});

describe("fighterAt", () => {
  const script = tiny();

  it("idles at the start position before any clip and faces the other fighter", () => {
    const s = fighterAt(script, "staal", 0.5);
    const t = fighterAt(script, "trump", 0.5);
    expect(s.x).toBe(400);
    expect(s.facing).toBe(1);
    expect(t.facing).toBe(-1);
    expect(s.clip).toBeNull();
  });

  it("blends into a new clip instead of snapping", () => {
    const before = fighterAt(script, "staal", 0.999).pose.sF;
    const start = fighterAt(script, "staal", 1.001).pose.sF;
    expect(Math.abs(start - before)).toBeLessThan(5);
  });
});
