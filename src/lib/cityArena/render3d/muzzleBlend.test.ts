import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { BulletState } from "../sim/types";
import { WEAPONS } from "../sim/weapons";
import { PERSON_CHEST_HEIGHT_M } from "./coords";
import {
  CONVERGE_M,
  blendedRoundPoint,
  convergeShare,
  roundFlownM,
} from "./muzzleBlend";

/** A round flying east from (100, 50), `flown` metres out. */
function round(
  flown: number,
): Pick<BulletState, "x" | "y" | "directionX" | "directionY"> {
  return { x: 100 + flown, y: 50, directionX: 1, directionY: 0 };
}

/** A gun held a little ahead of, right of and above the shooter's chest-height line. */
const MUZZLE = new Vector3(100.6, 1.45, 50.25);

describe("convergeShare", () => {
  it("runs from 0 at the muzzle to 1 once the round has flown the convergence distance", () => {
    expect(CONVERGE_M).toBe(15);
    expect(convergeShare(0)).toBe(0);
    expect(convergeShare(CONVERGE_M)).toBe(1);
    expect(convergeShare(CONVERGE_M * 3)).toBe(1);
    expect(convergeShare(-2)).toBe(0);
    expect(convergeShare(CONVERGE_M / 2)).toBeCloseTo(0.5);
  });

  it("only ever grows, easing in and out", () => {
    let previous = convergeShare(0);
    for (let flown = 0.5; flown <= CONVERGE_M; flown += 0.5) {
      const share = convergeShare(flown);
      expect(share).toBeGreaterThan(previous);
      previous = share;
    }
    expect(convergeShare(1)).toBeLessThan(1 / CONVERGE_M);
  });
});

describe("blendedRoundPoint", () => {
  it("draws a round that has just left the barrel at the muzzle", () => {
    const out = blendedRoundPoint(round(0), 0, MUZZLE, new Vector3());
    expect(out.distanceTo(MUZZLE)).toBeCloseTo(0);
  });

  it("carries the round on from the muzzle at its true speed along its flight", () => {
    const out = blendedRoundPoint(round(1), 1, MUZZLE, new Vector3());
    const ahead = MUZZLE.clone().add(new Vector3(1, 0, 0));
    expect(out.distanceTo(ahead)).toBeLessThan(0.02);
  });

  it("puts a round on the simulation's flat line once it has flown the convergence distance", () => {
    for (const flown of [CONVERGE_M, 20, 60]) {
      const out = blendedRoundPoint(round(flown), flown, MUZZLE, new Vector3());
      expect(out.toArray()).toEqual([100 + flown, PERSON_CHEST_HEIGHT_M, 50]);
    }
  });

  it("draws exactly today's chest-height point without a muzzle", () => {
    const out = blendedRoundPoint(round(4), 4, null, new Vector3());
    expect(out.toArray()).toEqual([104, PERSON_CHEST_HEIGHT_M, 50]);
  });

  it("finds a point some metres behind the round, never back past the muzzle", () => {
    const tail = blendedRoundPoint(round(10), 10, MUZZLE, new Vector3(), 3);
    expect(
      tail.distanceTo(blendedRoundPoint(round(7), 7, MUZZLE, new Vector3())),
    ).toBeCloseTo(0);
    const early = blendedRoundPoint(round(1), 1, MUZZLE, new Vector3(), 3);
    expect(early.distanceTo(MUZZLE)).toBeCloseTo(0);
    const bare = blendedRoundPoint(round(1), 1, null, new Vector3(), 3);
    expect(bare.toArray()).toEqual([100, PERSON_CHEST_HEIGHT_M, 50]);
  });

  it("draws a round of an unknown weapon on its line, the tail at full length", () => {
    const out = blendedRoundPoint(round(9), Infinity, MUZZLE, new Vector3(), 3);
    expect(out.toArray()).toEqual([106, PERSON_CHEST_HEIGHT_M, 50]);
  });

  it("returns the target it wrote", () => {
    const target = new Vector3();
    expect(blendedRoundPoint(round(2), 2, MUZZLE, target)).toBe(target);
  });
});

describe("roundFlownM", () => {
  it("reads how far a round has flown from the range it has left", () => {
    expect(
      roundFlownM({ weapon: "pistol", rangeLeftM: WEAPONS.pistol.rangeM - 12 }),
    ).toBeCloseTo(12);
    expect(
      roundFlownM({ weapon: "rocket", rangeLeftM: WEAPONS.rocket.rangeM + 1 }),
    ).toBe(0);
  });
});
