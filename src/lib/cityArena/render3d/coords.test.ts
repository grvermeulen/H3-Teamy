import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  directionFromYawPitch,
  headingToRotationY,
  worldToThree,
  yawFromThreeDirection,
} from "./coords";

describe("worldToThree", () => {
  it("puts the world's y on three's z and the height on three's y", () => {
    expect(worldToThree(3, 4, 1)).toEqual([3, 1, 4]);
    expect(worldToThree(-2, 7)).toEqual([-2, 0, 7]);
  });
});

describe("headingToRotationY", () => {
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 3])(
    "turns local +X to face heading %f",
    (heading) => {
      const forward = new Vector3(1, 0, 0).applyAxisAngle(
        new Vector3(0, 1, 0),
        headingToRotationY(heading),
      );
      expect(forward.x).toBeCloseTo(Math.cos(heading));
      expect(forward.y).toBeCloseTo(0);
      expect(forward.z).toBeCloseTo(Math.sin(heading));
    },
  );
});

describe("directionFromYawPitch", () => {
  it("looks east at yaw 0, south at a quarter turn and straight up at full pitch", () => {
    const [eastX, eastY, eastZ] = directionFromYawPitch(0, 0);
    expect([eastX, eastY, eastZ].map((value) => +value.toFixed(6))).toEqual([
      1, 0, 0,
    ]);
    const south = directionFromYawPitch(Math.PI / 2, 0);
    expect(south[0]).toBeCloseTo(0);
    expect(south[2]).toBeCloseTo(1);
    const up = directionFromYawPitch(0, Math.PI / 2);
    expect(up[1]).toBeCloseTo(1);
  });

  it("is inverted by yawFromThreeDirection on the horizontal plane", () => {
    for (const yaw of [0.3, -2.1, 3]) {
      const [x, , z] = directionFromYawPitch(yaw, 0);
      expect(yawFromThreeDirection(x, z)).toBeCloseTo(yaw);
    }
  });
});
