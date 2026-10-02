import { describe, expect, it } from "vitest";
import type { BulletState } from "../sim/types";
import { WEAPONS } from "../sim/weapons";
import { createRoundAims } from "./roundAims";

/** Player 3's round 10 m out of (0, 0), flying east. */
const ROUND: BulletState = {
  id: 1,
  ownerId: 3,
  ignoreVehicleId: null,
  x: 10,
  y: 0,
  directionX: 1,
  directionY: 0,
  speedMps: WEAPONS.pistol.speedMps,
  rangeLeftM: WEAPONS.pistol.rangeM - 10,
  damage: WEAPONS.pistol.damage,
  weapon: "pistol",
};

const AIM = { ownerId: 3, x: 30, y: 0, height: 4 };

/** One frame over `rounds`, returning each one's aim. */
function frame(
  aims: ReturnType<typeof createRoundAims>,
  rounds: BulletState[],
  aim: typeof AIM | null,
) {
  aims.begin();
  const found = rounds.map((round) => aims.of(round, round.x, aim));
  aims.end();
  return found;
}

describe("createRoundAims", () => {
  it("captures a local round's aim once, measured from where it was fired", () => {
    const aims = createRoundAims();
    const [first] = frame(aims, [ROUND], AIM);
    expect(first).toEqual(expect.objectContaining({ height: 4, distance: 30 }));
    const [later] = frame(aims, [{ ...ROUND, x: 20 }], { ...AIM, height: 0 });
    expect(later).toBe(first);
    expect(later!.height).toBe(4);
  });

  it("leaves everyone else's rounds, and rounds fired at the shooter's feet, unaimed", () => {
    const aims = createRoundAims();
    expect(frame(aims, [{ ...ROUND, ownerId: 8 }], AIM)).toEqual([null]);
    expect(frame(aims, [ROUND], { ...AIM, x: 0.5 })).toEqual([null]);
    expect(frame(aims, [ROUND], AIM)).toEqual([null]);
  });

  it("forgets a round once it has gone and reuses its entry", () => {
    const aims = createRoundAims();
    const [first] = frame(aims, [ROUND], AIM);
    frame(aims, [], AIM);
    const [next] = frame(aims, [{ ...ROUND, id: 2 }], { ...AIM, height: 9 });
    expect(next).toBe(first);
    expect(next!.height).toBe(9);
  });
});
