import { describe, expect, it } from "vitest";
import {
  createPose,
  poseFor,
  poseInto,
  RUN_STRIDE_M,
  WALK_STRIDE_M,
  type BoneRotations,
  type PoseInput,
} from "./characterPose";
import { PELVIS_HEIGHT_M, type BoneName } from "./characterRig";

/** Euler component that pitches a limb forward (+) or back about the body's side axis. */
const PITCH = 2;

const REST: PoseInput = {
  speed: 0,
  phaseM: 0,
  aiming: false,
  weapon: null,
  dead: false,
  tick: 0,
  recoil: 0,
};

const PAIRS: [BoneName, BoneName][] = [
  ["upperArmL", "upperArmR"],
  ["lowerArmL", "lowerArmR"],
  ["handL", "handR"],
  ["upperLegL", "upperLegR"],
  ["lowerLegL", "lowerLegR"],
  ["footL", "footR"],
];

const ZERO: [number, number, number] = [0, 0, 0];

function rotation(
  rotations: BoneRotations,
  bone: BoneName,
): [number, number, number] {
  return rotations[bone] ?? ZERO;
}

/** The rotation of a bone seen in a mirror across the body's midplane (z → −z). */
function mirrored([x, y, z]: [number, number, number]): number[] {
  return [-x, -y, z].map((value) => value + 0);
}

function expectClose(actual: number[], expected: number[]): void {
  actual.forEach((value, axis) => expect(value).toBeCloseTo(expected[axis], 6));
}

describe("poseFor at rest", () => {
  it.each([0, 17, 45])(
    "is left–right symmetric at speed 0 (tick %i)",
    (tick) => {
      const { rotations } = poseFor({ ...REST, tick });
      for (const [left, right] of PAIRS) {
        expectClose(
          rotation(rotations, left),
          mirrored(rotation(rotations, right)),
        );
      }
    },
  );

  it("stands on straight legs at pelvis height", () => {
    const pose = poseFor(REST);
    expect(pose.lying).toBe(false);
    expect(pose.pelvisHeight).toBeCloseTo(PELVIS_HEIGHT_M);
  });

  it("breathes: the chest moves with the tick", () => {
    const early = rotation(poseFor({ ...REST, tick: 0 }).rotations, "chest");
    const later = rotation(poseFor({ ...REST, tick: 25 }).rotations, "chest");
    expect(early).not.toEqual(later);
  });
});

describe("poseFor walking and running", () => {
  it.each([
    [1.4, WALK_STRIDE_M],
    [5.5, RUN_STRIDE_M],
  ])("mirrors the legs half a stride apart at %f m/s", (speed, stride) => {
    for (const phaseM of [0, stride / 8, stride / 4, stride / 3]) {
      const first = poseFor({ ...REST, speed, phaseM }).rotations;
      const second = poseFor({
        ...REST,
        speed,
        phaseM: phaseM + stride / 2,
      }).rotations;
      for (const [left, right] of PAIRS) {
        expectClose(rotation(first, left), mirrored(rotation(second, right)));
      }
    }
  });

  it("swings the legs ±0.6 rad and the arms against them", () => {
    const quarter = poseFor({
      ...REST,
      speed: 5.5,
      phaseM: RUN_STRIDE_M / 4,
    }).rotations;
    expect(rotation(quarter, "upperLegL")[PITCH]).toBeCloseTo(0.6);
    expect(rotation(quarter, "upperLegR")[PITCH]).toBeCloseTo(-0.6);
    expect(rotation(quarter, "upperArmL")[PITCH]).toBeLessThan(0);
    expect(rotation(quarter, "upperArmR")[PITCH]).toBeGreaterThan(0);
  });

  it("bends a knee only while its thigh swings back", () => {
    const quarter = poseFor({
      ...REST,
      speed: 1.4,
      phaseM: WALK_STRIDE_M / 4,
    }).rotations;
    const frontKnee = rotation(quarter, "lowerLegL")[PITCH];
    const backKnee = rotation(quarter, "lowerLegR")[PITCH];
    expect(backKnee).toBeLessThan(frontKnee - 0.3);
    expect(frontKnee).toBeLessThanOrEqual(0);
  });

  it("uses the longer running stride above 4 m/s", () => {
    const walk = poseFor({ ...REST, speed: 3.9, phaseM: WALK_STRIDE_M / 4 });
    const run = poseFor({ ...REST, speed: 4.1, phaseM: RUN_STRIDE_M / 4 });
    expect(rotation(walk.rotations, "upperLegL")[PITCH]).toBeCloseTo(0.6);
    expect(rotation(run.rotations, "upperLegL")[PITCH]).toBeCloseTo(0.6);
  });
});

describe("poseFor with weapons", () => {
  it.each(["pistol", "uzi", "shotgun", "rifle"] as const)(
    "raises the right arm past 1.2 rad to aim the %s",
    (weapon) => {
      const { rotations } = poseFor({ ...REST, aiming: true, weapon });
      expect(rotation(rotations, "upperArmR")[PITCH]).toBeGreaterThan(1.2);
    },
  );

  it("shoulders the rocket launcher to aim: the forearm comes up to the shoulder", () => {
    const carried = poseFor({ ...REST, weapon: "rocket" }).rotations;
    const aimed = poseFor({
      ...REST,
      weapon: "rocket",
      aiming: true,
    }).rotations;
    const forearmPitch = (rotations: BoneRotations): number =>
      rotation(rotations, "upperArmR")[PITCH] +
      rotation(rotations, "lowerArmR")[PITCH];
    expect(forearmPitch(aimed)).toBeGreaterThan(Math.PI - 0.3);
    expect(rotation(aimed, "upperArmR")[PITCH]).toBeGreaterThan(
      rotation(carried, "upperArmR")[PITCH],
    );
  });

  it("turns the chest to blade the stance behind a long gun", () => {
    const { rotations } = poseFor({ ...REST, aiming: true, weapon: "rifle" });
    expect(rotation(rotations, "chest")[1]).toBeLessThan(-0.3);
    const gunYaw =
      rotation(rotations, "chest")[1] + rotation(rotations, "upperArmR")[1];
    expect(gunYaw).toBeCloseTo(0);
  });

  it("raises the left arm too for a two-handed gun, not for a pistol", () => {
    const rifle = poseFor({ ...REST, aiming: true, weapon: "rifle" }).rotations;
    const pistol = poseFor({
      ...REST,
      aiming: true,
      weapon: "pistol",
    }).rotations;
    expect(rotation(rifle, "upperArmL")[PITCH]).toBeGreaterThan(1.2);
    expect(rotation(pistol, "upperArmL")[PITCH]).toBeLessThan(0.5);
  });

  it("keeps an aimed gun level through the wrist", () => {
    const { rotations } = poseFor({ ...REST, aiming: true, weapon: "pistol" });
    const total =
      rotation(rotations, "upperArmR")[PITCH] +
      rotation(rotations, "lowerArmR")[PITCH] +
      rotation(rotations, "handR")[PITCH];
    expect(total).toBeCloseTo(0);
  });

  it("kicks the gun arm up on recoil", () => {
    const still = poseFor({ ...REST, aiming: true, weapon: "shotgun" });
    const kicked = poseFor({
      ...REST,
      aiming: true,
      weapon: "shotgun",
      recoil: 1,
    });
    expect(rotation(kicked.rotations, "upperArmR")[PITCH]).toBeGreaterThan(
      rotation(still.rotations, "upperArmR")[PITCH],
    );
  });

  it("winds a bat up over the shoulder and swings it through on recoil", () => {
    const windUp = poseFor({ ...REST, aiming: true, weapon: "bat" }).rotations;
    const swung = poseFor({
      ...REST,
      aiming: true,
      weapon: "bat",
      recoil: 1,
    }).rotations;
    expect(rotation(windUp, "upperArmR")[PITCH]).toBeGreaterThan(1.8);
    expect(rotation(swung, "upperArmR")[PITCH]).toBeLessThan(
      rotation(windUp, "upperArmR")[PITCH] - 0.5,
    );
    expect(rotation(swung, "chest")[1]).toBeGreaterThan(
      rotation(windUp, "chest")[1] + 0.5,
    );
  });

  it("raises both fists to guard when aiming unarmed and punches on recoil", () => {
    const guard = poseFor({ ...REST, aiming: true, weapon: "fist" }).rotations;
    const punch = poseFor({
      ...REST,
      aiming: true,
      weapon: "fist",
      recoil: 1,
    }).rotations;
    expect(rotation(guard, "lowerArmR")[PITCH]).toBeGreaterThan(1);
    expect(rotation(guard, "lowerArmL")[PITCH]).toBeGreaterThan(1);
    expect(rotation(punch, "lowerArmR")[PITCH]).toBeLessThan(0.3);
  });
});

describe("poseFor dead", () => {
  it("lies down whatever else is going on", () => {
    const pose = poseFor({
      ...REST,
      dead: true,
      speed: 5,
      aiming: true,
      weapon: "rifle",
    });
    expect(pose.lying).toBe(true);
    expect(pose.pelvisHeight).toBeCloseTo(PELVIS_HEIGHT_M);
  });
});

describe("poseInto", () => {
  const SEQUENCES: [string, PoseInput, PoseInput][] = [
    [
      "an aimed rifle, then rest",
      { ...REST, aiming: true, weapon: "rifle" },
      REST,
    ],
    [
      "dead, then walking",
      { ...REST, dead: true },
      { ...REST, speed: 1.4, phaseM: 0.5 },
    ],
    [
      "a bat mid-swing, then fists up",
      { ...REST, aiming: true, weapon: "bat", recoil: 0.5 },
      { ...REST, aiming: true, weapon: "fist" },
    ],
    [
      "a shouldered launcher, then dead",
      { ...REST, aiming: true, weapon: "rocket" },
      { ...REST, dead: true },
    ],
  ];

  it.each(SEQUENCES)("leaves nothing stale from %s", (_, first, second) => {
    const out = createPose();
    poseInto(first, out);
    expect(poseInto(second, out)).toBe(out);
    expect(out).toEqual(poseFor(second));
  });

  it("clears a bone the new pose does not set", () => {
    const out = createPose();
    poseInto({ ...REST, aiming: true, weapon: "rifle" }, out);
    expect(out.rotations.handL).not.toEqual([0, 0, 0]);
    poseInto(REST, out);
    expect(out.rotations.handL).toEqual([0, 0, 0]);
  });

  it("writes into the same rotation arrays every time", () => {
    const out = createPose();
    const chest = out.rotations.chest;
    const upperArmR = out.rotations.upperArmR;
    poseInto({ ...REST, speed: 5.5, phaseM: 1 }, out);
    poseInto({ ...REST, dead: true }, out);
    expect(out.rotations.chest).toBe(chest);
    expect(out.rotations.upperArmR).toBe(upperArmR);
  });
});
