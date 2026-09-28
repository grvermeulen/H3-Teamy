import { describe, expect, it } from "vitest";
import {
  TOUCH_LOOK_RAD_PER_PX,
  createTouchCamera,
  createTouchLook,
  tiltedPitch,
  turnTouchCamera,
  type LookPointer,
} from "./touchLook";

/** A pointer event at `x`, `y` for finger `pointerId`. */
function finger(pointerId: number, x: number, y: number): LookPointer {
  return { pointerId, clientX: x, clientY: y };
}

/** A look whose yaw and pitch the test reads back. */
function fakeLook(yaw = 0, pitch = 0) {
  let current = yaw;
  return {
    yaw: () => current,
    pitch: () => pitch,
    setYaw: (value: number) => {
      current = value;
    },
  };
}

describe("createTouchLook", () => {
  it("turns the yaw by the rate for each pixel dragged right", () => {
    const look = createTouchLook(() => 1);
    look.onDown(finger(1, 200, 100));
    look.onMove(finger(1, 300, 100));
    expect(look.take().yaw).toBeCloseTo(100 * TOUCH_LOOK_RAD_PER_PX);
  });

  it("pitches up for a drag up and scales both by the sensitivity", () => {
    const look = createTouchLook(() => 2);
    look.onDown(finger(1, 200, 200));
    look.onMove(finger(1, 190, 150));
    const turn = look.take();
    expect(turn.yaw).toBeCloseTo(-10 * 2 * TOUCH_LOOK_RAD_PER_PX);
    expect(turn.pitch).toBeCloseTo(50 * 2 * TOUCH_LOOK_RAD_PER_PX);
  });

  it("accumulates moves between frames, and take() resets", () => {
    const look = createTouchLook(() => 1);
    look.onDown(finger(1, 0, 0));
    look.onMove(finger(1, 10, 0));
    look.onMove(finger(1, 30, 0));
    expect(look.take().yaw).toBeCloseTo(30 * TOUCH_LOOK_RAD_PER_PX);
    expect(look.take()).toEqual({ yaw: 0, pitch: 0 });
  });

  it("ignores a second finger while the first is down", () => {
    const look = createTouchLook(() => 1);
    look.onDown(finger(1, 0, 0));
    look.onDown(finger(2, 500, 500));
    look.onMove(finger(2, 700, 300));
    look.onUp(finger(2, 700, 300));
    look.onMove(finger(1, 20, 0));
    expect(look.take().yaw).toBeCloseTo(20 * TOUCH_LOOK_RAD_PER_PX);
  });

  it("hands the look to a finger that takes it over, such as the fire button's", () => {
    const look = createTouchLook(() => 1);
    look.onDown(finger(1, 0, 0));
    look.onDown(finger(2, 500, 500), true);
    look.onMove(finger(1, 40, 0));
    look.onMove(finger(2, 530, 500));
    expect(look.take().yaw).toBeCloseTo(30 * TOUCH_LOOK_RAD_PER_PX);
  });

  it("stops turning once the finger is lifted, and takes the next finger", () => {
    const look = createTouchLook(() => 1);
    look.onDown(finger(1, 0, 0));
    look.onUp(finger(1, 0, 0));
    look.onMove(finger(1, 80, 0));
    expect(look.take()).toEqual({ yaw: 0, pitch: 0 });
    look.onDown(finger(2, 0, 0));
    look.onMove(finger(2, 5, 0));
    expect(look.take().yaw).toBeCloseTo(5 * TOUCH_LOOK_RAD_PER_PX);
  });

  it("forgets a finger and an untaken turn on reset", () => {
    const look = createTouchLook(() => 1);
    look.onDown(finger(1, 0, 0));
    look.onMove(finger(1, 40, 0));
    look.reset();
    expect(look.take()).toEqual({ yaw: 0, pitch: 0 });
    look.onDown(finger(3, 0, 0));
    look.onMove(finger(3, 10, 0));
    expect(look.take().yaw).toBeCloseTo(10 * TOUCH_LOOK_RAD_PER_PX);
  });
});

describe("turnTouchCamera", () => {
  it("adds the pad's yaw to the look and reports it", () => {
    const pad = createTouchLook(() => 1);
    const camera = createTouchCamera(pad, [-0.6, 0.7]);
    const look = fakeLook(1);
    pad.onDown(finger(1, 0, 0));
    pad.onMove(finger(1, 50, 0));
    const turned = turnTouchCamera(camera, look, () => 1);
    expect(turned).toBeCloseTo(50 * TOUCH_LOOK_RAD_PER_PX);
    expect(look.yaw()).toBeCloseTo(1 + 50 * TOUCH_LOOK_RAD_PER_PX);
    expect(camera.engaged).toBe(true);
  });

  it("tilts the pitch on top of the look's, within the mode's range", () => {
    const pad = createTouchLook(() => 1);
    const camera = createTouchCamera(pad, [-0.6, 0.7]);
    const look = fakeLook(0, 0.1);
    pad.onDown(finger(1, 0, 0));
    pad.onMove(finger(1, 0, -10));
    turnTouchCamera(camera, look, () => 1);
    expect(tiltedPitch(camera, look.pitch())).toBeCloseTo(
      0.1 + 10 * TOUCH_LOOK_RAD_PER_PX,
    );
    pad.onMove(finger(1, 0, -10_000));
    turnTouchCamera(camera, look, () => 1);
    expect(tiltedPitch(camera, look.pitch())).toBeCloseTo(0.7);
    pad.onMove(finger(1, 0, -10_000 + 10));
    turnTouchCamera(camera, look, () => 1);
    expect(tiltedPitch(camera, look.pitch())).toBeCloseTo(
      0.7 - 10 * TOUCH_LOOK_RAD_PER_PX,
    );
  });

  it("scales the turn by the factor, and asks for it only when the pad turned", () => {
    const pad = createTouchLook(() => 1);
    const camera = createTouchCamera(pad, [-0.6, 0.7]);
    const look = fakeLook();
    let asked = 0;
    const factor = (): number => {
      asked += 1;
      return 0.5;
    };
    expect(turnTouchCamera(camera, look, factor)).toBe(0);
    expect(asked).toBe(0);
    expect(camera.engaged).toBe(false);
    pad.onDown(finger(1, 0, 0));
    pad.onMove(finger(1, 40, 0));
    expect(turnTouchCamera(camera, look, factor)).toBeCloseTo(
      20 * TOUCH_LOOK_RAD_PER_PX,
    );
    expect(asked).toBe(1);
  });

  it("keeps the pitch inside a narrower range once the mode changes", () => {
    const camera = createTouchCamera(
      createTouchLook(() => 1),
      [-0.6, 0.7],
    );
    camera.pitch = 0.65;
    camera.limits = [-0.5, 0.5];
    expect(tiltedPitch(camera, 0)).toBeCloseTo(0.5);
  });
});
