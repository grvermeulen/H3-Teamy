import { describe, expect, it } from "vitest";
import {
  CHASE_MAX_BACK_M,
  SHOULDER_M,
  THIRD_PERSON_BACK_M,
  THIRD_PERSON_UP_M,
  pitchLimitsFor,
  rigPose,
  type RigInput,
  type RigPose,
} from "./cameraRig";
import { EYE_HEIGHT_M, PERSON_CHEST_HEIGHT_M } from "./coords";

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
      input({ driving: { length: 4.2, heading: 0 }, target: { x: 0, y: 0 } }),
    );
    expect(sedan.position[0]).toBeCloseTo(-(THIRD_PERSON_BACK_M + 4.2));
    expect(sedan.position[2]).toBeCloseTo(0);
    const bus = rigPose(input({ driving: { length: 12, heading: 0 } }));
    expect(horizontalDistance(bus, 0, 0)).toBeCloseTo(CHASE_MAX_BACK_M);
    expect(bus.fovDeg).toBeGreaterThan(rigPose(input()).fovDeg);
  });

  it("puts the first-person camera in the driver's seat, left of the car's centre line", () => {
    const pose = rigPose(
      input({ mode: "first", driving: { length: 4.2, heading: 0 } }),
    );
    // Heading east, the driver's (left) side is north, which is −z.
    expect(pose.position[2]).toBeLessThan(0);
    expect(pose.position[1]).toBeLessThan(EYE_HEIGHT_M);
    expect(viewDirection(pose)[0]).toBeCloseTo(1);
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
      input({ yaw: 123.4, pitch: -0.6, driving: { length: 7, heading: -2 } }),
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
