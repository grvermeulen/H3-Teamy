import { describe, expect, it } from "vitest";
import {
  ADS_BACK_M,
  ADS_EASE_S,
  ADS_FOV_DEG,
  CHASE_MAX_BACK_M,
  SHOULDER_M,
  easeSights,
  scopeShare,
  sightsShare,
  THIRD_PERSON_BACK_M,
  THIRD_PERSON_UP_M,
  pitchLimitsFor,
  rigPose,
  type RigInput,
  type RigPose,
} from "./cameraRig";
import { COCKPITS } from "./cockpitSpecs";
import { EYE_HEIGHT_M, PERSON_CHEST_HEIGHT_M } from "./coords";

/** A sedan heading east. */
const SEDAN_EAST = { length: 4.2, heading: 0, kind: "sedan" } as const;

/** A rig input standing at the origin, looking east, alive and on foot. */
function input(overrides: Partial<RigInput> = {}): RigInput {
  return {
    mode: "third",
    yaw: 0,
    pitch: 0,
    target: { x: 0, y: 0 },
    driving: null,
    dead: false,
    deadSeconds: 0,
    dt: 1 / 60,
    ...overrides,
  };
}

/** The unit view direction of a pose. */
function viewDirection(pose: RigPose): [number, number, number] {
  const [px, py, pz] = pose.position;
  const [lx, ly, lz] = pose.lookAt;
  const length = Math.hypot(lx - px, ly - py, lz - pz);
  return [(lx - px) / length, (ly - py) / length, (lz - pz) / length];
}

/** Horizontal distance of the camera from the world point `(x, y)`. */
function horizontalDistance(pose: RigPose, x: number, y: number): number {
  return Math.hypot(pose.position[0] - x, pose.position[2] - y);
}

describe("rigPose", () => {
  it("sits over the right shoulder behind a player facing east and looks forward", () => {
    const pose = rigPose(input());
    expect(pose.position[0]).toBeCloseTo(-THIRD_PERSON_BACK_M);
    expect(pose.position[1]).toBeCloseTo(THIRD_PERSON_UP_M);
    // East is +x and south is +z, so the right shoulder of an east-facing player is +z.
    expect(pose.position[2]).toBeCloseTo(SHOULDER_M);
    expect(viewDirection(pose)[0]).toBeGreaterThan(0.99);
  });

  it("follows the yaw round the player", () => {
    const pose = rigPose(input({ yaw: Math.PI / 2, target: { x: 10, y: 20 } }));
    // Facing south (+z): behind is −z, the right shoulder is −x.
    expect(pose.position[0]).toBeCloseTo(10 - SHOULDER_M);
    expect(pose.position[2]).toBeCloseTo(20 - THIRD_PERSON_BACK_M);
    expect(viewDirection(pose)[2]).toBeGreaterThan(0.99);
  });

  it("converges the third-person view on the chest-height shot line", () => {
    const pose = rigPose(input());
    expect(pose.lookAt[1]).toBeCloseTo(PERSON_CHEST_HEIGHT_M);
    expect(pose.lookAt[2]).toBeCloseTo(0);
  });

  it("drops the boom when looking up and raises it when looking down, never below the ground", () => {
    const up = rigPose(input({ pitch: 0.7 }));
    const down = rigPose(input({ pitch: -0.6 }));
    expect(up.position[1]).toBeLessThan(THIRD_PERSON_UP_M);
    expect(up.position[1]).toBeGreaterThan(0);
    expect(down.position[1]).toBeGreaterThan(THIRD_PERSON_UP_M);
    expect(viewDirection(up)[1]).toBeGreaterThan(viewDirection(down)[1]);
  });

  it("sits at eye height on the player in first person and looks along yaw and pitch", () => {
    const pose = rigPose(input({ mode: "first", target: { x: 3, y: 4 } }));
    expect(pose.position).toEqual([3, EYE_HEIGHT_M, 4]);
    expect(viewDirection(pose)[0]).toBeCloseTo(1);
    const lookingUp = rigPose(input({ mode: "first", pitch: 0.4 }));
    expect(viewDirection(lookingUp)[1]).toBeCloseTo(Math.sin(0.4));
  });

  it("pulls the chase camera back by the vehicle's length, within its range", () => {
    const sedan = rigPose(
      input({ driving: SEDAN_EAST, target: { x: 0, y: 0 } }),
    );
    expect(sedan.position[0]).toBeCloseTo(-(THIRD_PERSON_BACK_M + 4.2));
    expect(sedan.position[2]).toBeCloseTo(0);
    const bus = rigPose(
      input({ driving: { length: 12, heading: 0, kind: "bus" } }),
    );
    expect(horizontalDistance(bus, 0, 0)).toBeCloseTo(CHASE_MAX_BACK_M);
    expect(bus.fovDeg).toBeGreaterThan(rigPose(input()).fovDeg);
  });

  it("puts the first-person camera in the driver's seat, left of the car's centre line", () => {
    const pose = rigPose(input({ mode: "first", driving: SEDAN_EAST }));
    // Heading east, the driver's (left) side is north, which is −z.
    expect(pose.position[2]).toBeLessThan(0);
    expect(pose.position[1]).toBeLessThan(EYE_HEIGHT_M);
    expect(viewDirection(pose)[0]).toBeCloseTo(1);
  });

  it("seats the first-person driver where the kind's cockpit puts the eye", () => {
    const seat = COCKPITS.sedan;
    const pose = rigPose(
      input({ mode: "first", driving: SEDAN_EAST, target: { x: 10, y: 20 } }),
    );
    expect(pose.position[0]).toBeCloseTo(10 + seat.eyeForwardM);
    expect(pose.position[1]).toBeCloseTo(seat.eyeHeightM);
    expect(pose.position[2]).toBeCloseTo(20 - seat.eyeLeftM);
    const south = rigPose(
      input({
        mode: "first",
        driving: { ...SEDAN_EAST, heading: Math.PI / 2 },
        target: { x: 10, y: 20 },
      }),
    );
    // Heading south (+z), forward is +z and the driver's left is east, +x.
    expect(south.position[0]).toBeCloseTo(10 + seat.eyeLeftM);
    expect(south.position[2]).toBeCloseTo(20 + seat.eyeForwardM);
  });

  it("sits a bus driver higher than a sedan's, and leaves the eye on foot alone", () => {
    const sedan = rigPose(input({ mode: "first", driving: SEDAN_EAST }));
    const bus = rigPose(
      input({
        mode: "first",
        driving: { length: 12, heading: 0, kind: "bus" },
      }),
    );
    expect(bus.position[1]).toBeCloseTo(COCKPITS.bus.eyeHeightM);
    expect(bus.position[1]).toBeGreaterThan(sedan.position[1]);
    const onFoot = rigPose(input({ mode: "first", target: { x: 3, y: 4 } }));
    expect(onFoot.position).toEqual([3, EYE_HEIGHT_M, 4]);
  });

  it("raises the death camera over time and slowly orbits the body", () => {
    const early = rigPose(input({ dead: true, deadSeconds: 0.2 }));
    const late = rigPose(input({ dead: true, deadSeconds: 3 }));
    expect(late.position[1]).toBeGreaterThan(early.position[1]);
    const angle = (pose: RigPose): number =>
      Math.atan2(pose.position[2], pose.position[0]);
    expect(angle(late)).not.toBeCloseTo(angle(early));
    expect(late.lookAt[0]).toBeCloseTo(0);
    expect(late.lookAt[2]).toBeCloseTo(0);
    expect(late.lookAt[1]).toBeLessThan(1);
  });

  it("uses the death camera in first person too", () => {
    const pose = rigPose(input({ mode: "first", dead: true, deadSeconds: 1 }));
    expect(pose.position[1]).toBeGreaterThan(EYE_HEIGHT_M);
    expect(horizontalDistance(pose, 0, 0)).toBeGreaterThan(1);
  });

  it("never produces NaN", () => {
    const pose = rigPose(
      input({
        yaw: 123.4,
        pitch: -0.6,
        driving: { length: 7, heading: -2, kind: "tank" },
      }),
    );
    for (const value of [...pose.position, ...pose.lookAt, pose.fovDeg])
      expect(Number.isFinite(value)).toBe(true);
  });
});

describe("pitchLimitsFor", () => {
  it("clamps −35°…+40° in third person and ±30° in first person", () => {
    const [thirdMin, thirdMax] = pitchLimitsFor("third");
    const [firstMin, firstMax] = pitchLimitsFor("first");
    expect((thirdMin * 180) / Math.PI).toBeCloseTo(-35);
    expect((thirdMax * 180) / Math.PI).toBeCloseTo(40);
    expect((firstMin * 180) / Math.PI).toBeCloseTo(-30);
    expect((firstMax * 180) / Math.PI).toBeCloseTo(30);
  });
});

describe("aiming down the sights", () => {
  const FRAME_S = 1 / 60;

  /** How far the sights are up after holding (or letting go) for `seconds`. */
  function held(
    seconds: number,
    aiming: boolean,
    weapon: Parameters<typeof easeSights>[2],
    from = 0,
  ): number {
    let progress = from;
    for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += FRAME_S)
      progress = easeSights(progress, aiming, weapon, FRAME_S);
    return progress;
  }

  it("zooms each gun to its own field of view; fists and the bat have no sights", () => {
    expect(ADS_FOV_DEG).toEqual({
      pistol: 50,
      uzi: 50,
      shotgun: 50,
      rifle: 24,
      rocket: 45,
      cannon: 45,
    });
    expect(held(1, true, "fist")).toBe(0);
    expect(held(1, true, "bat")).toBe(0);
  });

  it("brings the sights up over 0.15 s and takes them down as fast", () => {
    expect(ADS_EASE_S).toBe(0.15);
    expect(easeSights(0, true, "pistol", ADS_EASE_S / 2)).toBeCloseTo(0.5);
    expect(held(ADS_EASE_S, true, "pistol")).toBeCloseTo(1);
    expect(held(ADS_EASE_S, false, "pistol", 1)).toBeCloseTo(0);
  });

  it("eases the first-person view to the weapon's field of view, and fists not at all", () => {
    const aimed = (weapon: Parameters<typeof easeSights>[2]): RigPose =>
      rigPose(
        input({
          mode: "first",
          weapon,
          sights: sightsShare(held(ADS_EASE_S, true, weapon)),
        }),
      );
    expect(aimed("pistol").fovDeg).toBeCloseTo(50);
    expect(aimed("rifle").fovDeg).toBeCloseTo(24);
    expect(aimed("rocket").fovDeg).toBeCloseTo(45);
    expect(aimed("fist").fovDeg).toBeCloseTo(70);
    const halfway = rigPose(
      input({ mode: "first", weapon: "rifle", sights: 0.5 }),
    );
    expect(halfway.fovDeg).toBeCloseTo(47);
  });

  it("pulls the shoulder camera in to 1.9 m at 45°, and zooms the chase camera", () => {
    const pose = rigPose(input({ weapon: "pistol", sights: 1 }));
    expect(ADS_BACK_M).toBe(1.9);
    expect(pose.position[0]).toBeCloseTo(-ADS_BACK_M);
    expect(pose.position[2]).toBeCloseTo(SHOULDER_M);
    expect(pose.fovDeg).toBeCloseTo(45);
    const chase = rigPose(
      input({ weapon: "pistol", sights: 1, driving: SEDAN_EAST }),
    );
    expect(chase.fovDeg).toBeCloseTo(45);
    expect(chase.position[0]).toBeCloseTo(-(THIRD_PERSON_BACK_M + 4.2));
  });

  it("reports how much the sights narrow the view, for the mouse to slow by", () => {
    const halfTan = (degrees: number): number =>
      Math.tan((degrees * Math.PI) / 360);
    expect(rigPose(input()).zoom).toBe(1);
    expect(
      rigPose(input({ mode: "first", weapon: "rifle", sights: 1 })).zoom,
    ).toBeCloseTo(halfTan(24) / halfTan(70));
    expect(rigPose(input({ weapon: "pistol", sights: 1 })).zoom).toBeCloseTo(
      halfTan(45) / halfTan(60),
    );
  });

  it("shapes the ease and fades the rifle's scope in over its last stretch", () => {
    expect(sightsShare(0)).toBe(0);
    expect(sightsShare(1)).toBe(1);
    expect(sightsShare(0.25)).toBeLessThan(0.25);
    expect(scopeShare(0.5)).toBe(0);
    expect(scopeShare(1)).toBe(1);
    expect(scopeShare(0.8)).toBeGreaterThan(0);
  });
});
