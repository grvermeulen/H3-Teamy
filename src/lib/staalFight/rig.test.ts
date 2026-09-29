import { describe, expect, it } from "vitest";
import { MOVES, samplePose, type MoveName } from "./moves";
import { RIGS, armIK, legIK, resolvePose, solveJoints } from "./rig";

describe("rig", () => {
  const rig = RIGS.staal;

  it("puts a foot where the leg IK was asked to", () => {
    const hip = 86;
    for (const target of [
      [36, 0],
      [-40, 0],
      [10, 30],
    ] as const) {
      const { h, k } = legIK(rig.thigh, rig.shin, rig.hipF, hip, target);
      const j = solveJoints(resolvePose({ hip, hF: h, kF: k }, rig), rig);
      expect(j.ankleF.x).toBeCloseTo(target[0], 3);
      expect(j.ankleF.y).toBeCloseTo(hip - target[1], 3);
      expect(k).toBeLessThanOrEqual(0);
    }
  });

  it("puts a hand where the arm IK was asked to, elbow bent the natural way", () => {
    const shoulder = { x: 20, y: -66 };
    const target = { x: 70, y: -80 };
    const { s, e } = armIK(rig.upperArm, rig.foreArm, shoulder, target);
    const a = (s * Math.PI) / 180;
    const b = ((s + e) * Math.PI) / 180;
    const hand = {
      x: shoulder.x + Math.sin(a) * rig.upperArm + Math.sin(b) * rig.foreArm,
      y: shoulder.y + Math.cos(a) * rig.upperArm + Math.cos(b) * rig.foreArm,
    };
    expect(hand.x).toBeCloseTo(target.x, 3);
    expect(hand.y).toBeCloseTo(target.y, 3);
    expect(e).toBeGreaterThanOrEqual(0);
  });

  it("stands both fighters on the floor in their stance", () => {
    for (const who of ["staal", "trump"] as const) {
      const r = RIGS[who];
      const pose = resolvePose({}, r);
      const j = solveJoints(pose, r);
      expect(j.ankleF.y).toBeCloseTo(pose.hip, 1);
      expect(j.ankleB.y).toBeCloseTo(pose.hip, 1);
      expect(j.head.y).toBeLessThan(j.neck.y);
    }
  });

  it("reaches the mouth when drinking", () => {
    const pose = resolvePose({ torso: -12, head: -36, reachF: "mouth" }, rig);
    const j = solveJoints(pose, rig);
    expect(Math.hypot(j.handF.x - j.head.x, j.handF.y - j.head.y)).toBeLessThan(
      rig.headR * 1.3,
    );
  });
});

describe("moves", () => {
  it("samples every move for both fighters without NaN", () => {
    for (const name of Object.keys(MOVES) as MoveName[])
      for (const who of ["staal", "trump"] as const)
        for (const u of [0, 0.25, 0.5, 0.75, 1]) {
          const pose = samplePose(name, RIGS[who], u, u * 0.8);
          for (const v of Object.values(pose))
            if (typeof v === "number")
              expect(Number.isFinite(v), `${name} ${who} ${u}`).toBe(true);
        }
  });

  it("brings strikes back to the guard", () => {
    const stance = resolvePose({}, RIGS.staal);
    for (const name of [
      "jab",
      "cross",
      "uppercut",
      "knee",
      "kickHigh",
      "sweep",
    ] as const) {
      const end = samplePose(name, RIGS.staal, 1, 0.4);
      expect(end.sF).toBeCloseTo(stance.sF);
      expect(end.hip).toBeCloseTo(stance.hip);
    }
  });
});
