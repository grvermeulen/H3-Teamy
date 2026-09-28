import { describe, expect, it } from "vitest";
import { VEHICLE_KINDS, widthOf } from "../sim/vehicle";
import { COCKPITS } from "./cockpitSpecs";
import {
  ARM_SWING_RAD,
  FRONT_CONE_RAD,
  SHOWN_AFTER_SHOT_S,
  createDriveByPose,
  driveByPose,
  driveBySideFor,
  showsDriveBy,
  windowSideFor,
} from "./driveByPose";

const DEGREE = Math.PI / 180;

describe("windowSideFor", () => {
  it("picks the driver's window left of the heading, the passenger's right, the dash ahead", () => {
    for (const heading of [0, 1.2, -2.8, 3.1]) {
      expect(windowSideFor(heading, heading - 90 * DEGREE)).toBe("left");
      expect(windowSideFor(heading, heading + 90 * DEGREE)).toBe("right");
      expect(windowSideFor(heading, heading + 10 * DEGREE)).toBe("front");
      expect(windowSideFor(heading, heading - 10 * DEGREE)).toBe("front");
      expect(windowSideFor(heading, heading - 170 * DEGREE)).toBe("left");
    }
  });

  it("shoots over the dash within 35° either side of ahead", () => {
    expect(FRONT_CONE_RAD).toBeCloseTo(35 * DEGREE);
    expect(windowSideFor(0, 34 * DEGREE)).toBe("front");
    expect(windowSideFor(0, 36 * DEGREE)).toBe("right");
    expect(windowSideFor(0, -36 * DEGREE)).toBe("left");
  });

  it("keeps the last side across a boundary until the aim is clearly past it", () => {
    expect(windowSideFor(0, 37 * DEGREE, "front")).toBe("front");
    expect(windowSideFor(0, 45 * DEGREE, "front")).toBe("right");
    expect(windowSideFor(0, 33 * DEGREE, "right")).toBe("right");
    expect(windowSideFor(0, 178 * DEGREE, "left")).toBe("left");
    expect(windowSideFor(0, 178 * DEGREE)).toBe("right");
  });
});

describe("driveBySideFor", () => {
  it("leans out of the bus's driver window whatever the aim", () => {
    expect(driveBySideFor("bus", 0, 90 * DEGREE)).toBe("left");
    expect(driveBySideFor("bus", 0, 0)).toBe("left");
    expect(driveBySideFor("sedan", 0, 90 * DEGREE)).toBe("right");
  });
});

describe("showsDriveBy", () => {
  const armed = {
    holdsGun: true,
    secondsSinceShot: 0.5,
    ads: false,
    kind: "sedan" as const,
  };

  it("shows the gun for 1.2 s after a shot, then puts it away", () => {
    expect(SHOWN_AFTER_SHOT_S).toBe(1.2);
    expect(showsDriveBy(armed)).toBe(true);
    expect(showsDriveBy({ ...armed, secondsSinceShot: 1.2 })).toBe(true);
    expect(showsDriveBy({ ...armed, secondsSinceShot: 1.3 })).toBe(false);
    expect(showsDriveBy({ ...armed, secondsSinceShot: null })).toBe(false);
  });

  it("shows the gun while aiming down the sights, without a shot", () => {
    expect(showsDriveBy({ ...armed, secondsSinceShot: null, ads: true })).toBe(
      true,
    );
  });

  it("never shows fists or a bat, nor anything from a tank", () => {
    expect(showsDriveBy({ ...armed, holdsGun: false, ads: true })).toBe(false);
    expect(showsDriveBy({ ...armed, kind: "tank", ads: true })).toBe(false);
  });
});

describe("driveByPose", () => {
  it("rests the elbow in the aim side's window, above the belt line, or on the dash", () => {
    for (const kind of VEHICLE_KINDS) {
      const spec = COCKPITS[kind];
      const half = widthOf(kind) / 2;
      const left = driveByPose(kind, "left", 0, -90 * DEGREE).elbow;
      const right = driveByPose(kind, "right", 0, 90 * DEGREE).elbow;
      const front = driveByPose(kind, "front", 0, 0).elbow;
      expect(left[2], kind).toBeLessThan(-spec.eyeLeftM);
      expect(left[2], kind).toBeGreaterThan(-half);
      expect(right[2], kind).toBeGreaterThan(0);
      expect(right[2], kind).toBeLessThan(half);
      expect(left[1], kind).toBeGreaterThan(spec.glass.baseM);
      expect(left[1], kind).toBeLessThan(spec.eyeHeightM);
      expect(front[0], kind).toBeGreaterThan(spec.eyeForwardM);
      expect(front[1], kind).toBeGreaterThan(spec.dash.heightM);
    }
  });

  it("points the forearm and gun straight out of the window at an aim square to the car", () => {
    const pose = driveByPose("sedan", "left", 1, 1 - Math.PI / 2);
    expect(pose.yaw).toBeCloseTo(-Math.PI / 2);
    expect(pose.aimYaw).toBeCloseTo(-Math.PI / 2);
    expect(pose.pitch).toBeGreaterThan(0);
  });

  it("swings the forearm only so far from the window, turning the gun the rest of the way", () => {
    const pose = driveByPose("sedan", "left", 0, -175 * DEGREE);
    expect(pose.yaw).toBeCloseTo(-Math.PI / 2 - ARM_SWING_RAD);
    expect(pose.aimYaw).toBeCloseTo(-175 * DEGREE);
  });

  it("points the gun over the dash along the aim", () => {
    const pose = driveByPose("van", "front", 2, 2 + 20 * DEGREE);
    expect(pose.yaw).toBeCloseTo(20 * DEGREE);
    expect(pose.aimYaw).toBeCloseTo(20 * DEGREE);
  });

  it("never turns the bus driver's gun back into the bus", () => {
    const pose = driveByPose("bus", "left", 0, 90 * DEGREE);
    expect(Math.abs(pose.aimYaw - pose.yaw)).toBeLessThanOrEqual(
      Math.PI / 2 + 1e-9,
    );
  });

  it("writes into a reused pose and shares its joints between calls", () => {
    const out = createDriveByPose();
    const first = driveByPose("sedan", "right", 0, 1.4, out);
    const joints = first.elbow;
    const second = driveByPose("sedan", "right", 0.5, 2, out);
    expect(second).toBe(out);
    expect(second.elbow).toBe(joints);
    expect(second.shoulder[2]).toBeGreaterThan(-COCKPITS.sedan.eyeLeftM);
  });
});
