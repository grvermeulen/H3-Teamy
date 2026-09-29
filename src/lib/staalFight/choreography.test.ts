import { describe, expect, it } from "vitest";
import { BAR_X, buildFightScript } from "./choreography";
import { FIGHT_CLIP_NAMES } from "./clips";
import { WORLD_W } from "./draw/stage";
import type { Vec } from "./math";
import type { Cue } from "./script";
import {
  TimeWarp,
  anchorAt,
  fighterAt,
  healthAt,
  maxCombo,
  meterAt,
  toWorld,
} from "./timeline";

const script = buildFightScript();
const finalBlow = script.hits.reduce((last, h) =>
  h.by === "staal" && h.dmg > 0 ? h : last,
);

/** Distance from a point to a segment. */
function toSegment(p: Vec, a: Vec, b: Vec): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)),
  );
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

describe("the Staal vs. Trump script", () => {
  it("ends with Trump knocked out and Staal barely scratched", () => {
    expect(healthAt(script, "trump", script.duration)).toBe(0);
    expect(healthAt(script, "staal", script.duration)).toBeGreaterThanOrEqual(
      80,
    );
  });

  it("keeps Trump standing until the slow-motion finisher, which does real damage", () => {
    expect(healthAt(script, "trump", finalBlow.t - 0.001)).toBeGreaterThan(0);
    expect(finalBlow.dmg).toBeGreaterThanOrEqual(5);
    expect(
      script.slowmos.some((s) => finalBlow.t >= s.t0 && finalBlow.t < s.t1),
    ).toBe(true);
    for (const h of script.hits) expect(h.dmg).toBeGreaterThanOrEqual(0);
  });

  it("lands every blow: the striking fist or foot touches the other fighter", () => {
    for (const h of script.hits) {
      if ("projectile" in h.at || h.kind === "block" || h.kind === "whip")
        continue;
      const p = anchorAt(script, h.at, h.t);
      const d = fighterAt(script, h.on, h.t);
      const j = d.joints;
      const w = (q: Vec): Vec => toWorld(d, q);
      const gap = Math.min(
        Math.hypot(p.x - w(j.head).x, p.y - w(j.head).y),
        toSegment(p, w(j.head), w(j.neck)),
        toSegment(p, w(j.neck), w(j.hip)),
        toSegment(p, w(j.hip), w(j.kneeF)),
        toSegment(p, w(j.kneeF), w(j.ankleF)),
        toSegment(p, w(j.hip), w(j.kneeB)),
        toSegment(p, w(j.kneeB), w(j.ankleB)),
      );
      expect(gap, `blow at ${h.t}`).toBeLessThan(45);
    }
  });

  it("keeps both fighters on the stage and on their own side", () => {
    for (let t = script.vsEnd; t < script.duration; t += 0.05) {
      const s = fighterAt(script, "staal", t);
      const tr = fighterAt(script, "trump", t);
      expect(s.x).toBeGreaterThan(0);
      expect(tr.x).toBeLessThanOrEqual(WORLD_W);
      expect(s.x, `at ${t.toFixed(2)}`).toBeLessThan(tr.x);
      for (const v of Object.values(s.pose))
        if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("sends Trump into the beach bar with the finisher", () => {
    const splat = script.clips.find((c) => c.move === "wallSplat");
    expect(splat).toBeDefined();
    expect(fighterAt(script, "trump", splat!.t).x).toBeCloseTo(BAR_X, 0);
  });

  it("writes the clips in time order", () => {
    for (let i = 1; i < script.clips.length; i++)
      expect(script.clips[i].t).toBeGreaterThanOrEqual(script.clips[i - 1].t);
  });

  it("fills the super meter before the super fires", () => {
    const superCue = script.cues.find((c) => c.kind === "superFreeze");
    expect(superCue).toBeDefined();
    expect(meterAt(script, superCue!.t - 0.01)).toBe(100);
    expect(meterAt(script, superCue!.t + 2)).toBe(0);
  });

  it("strings together a combo of twenty hits or more", () => {
    expect(maxCombo(script, "staal")).toBeGreaterThanOrEqual(20);
  });

  it("serves the beer only after the knockout, and it gets opened, drunk, crushed and tossed", () => {
    const ko = finalBlow.t;
    const staalAt = (t: number) => fighterAt(script, "staal", t);
    const drink = script.clips.find((c) => c.move === "drink");
    expect(drink && drink.t).toBeGreaterThan(ko);
    expect(staalAt(ko).props.can).toBe("none");
    expect(staalAt(drink!.t).props.can).toBe("open");
    expect(staalAt(drink!.t + drink!.dur * 0.5).props.canTilt).toBe(1);
    const toss = script.projectiles.find((p) => p.kind === "canToss");
    expect(toss).toBeDefined();
    expect(staalAt(toss!.t0 - 0.2).props.can).toBe("crushed");
    expect(staalAt(toss!.t0 + 0.1).props.can).toBe("none");
  });

  it("uses every recorded clip, and only those", () => {
    const sfx = script.cues.filter(
      (c): c is Extract<Cue, { kind: "sfx" }> => c.kind === "sfx",
    );
    const used = new Set<string>(sfx.map((c) => c.name));
    if (script.cues.some((c) => c.kind === "music" && c.action === "start"))
      used.add("music");
    expect([...used].sort()).toEqual([...FIGHT_CLIP_NAMES].sort());
  });

  it("lasts about a minute with the hit-stops and the slow motion", () => {
    const real = new TimeWarp(script).realAt(script.duration);
    expect(real).toBeGreaterThan(45);
    expect(real).toBeLessThan(75);
  });
});
