import { describe, expect, it } from "vitest";
import {
  STICK_AXIS_DEAD_ZONE,
  STICK_RADIUS_PX,
  aimFromVector,
  createStick,
} from "./touchStick";

describe("createStick", () => {
  it("anchors at the first touch and reports a scaled vector", () => {
    const stick = createStick();
    stick.begin(7, 100, 200);
    expect(stick.state().origin).toEqual([100, 200]);
    stick.move(7, 100 + STICK_RADIUS_PX / 2, 200);
    expect(stick.state().vector[0]).toBeCloseTo((0.5 - 0.15) / 0.85);
    expect(stick.state().vector[1]).toBe(0);
  });

  it("clamps the knob to the radius, applies the dead zone and ignores other pointers", () => {
    const stick = createStick();
    stick.begin(1, 0, 0);
    stick.move(1, 500, 0);
    expect(stick.state().knob).toEqual([STICK_RADIUS_PX, 0]);
    expect(stick.state().vector).toEqual([1, 0]);
    stick.move(2, -500, 0);
    expect(stick.state().vector).toEqual([1, 0]);
    stick.move(1, 3, 0);
    expect(stick.state().vector).toEqual([0, 0]);
  });

  it("releases on end and only for the owning pointer", () => {
    const stick = createStick();
    stick.begin(1, 0, 0);
    stick.move(1, 0, -48);
    stick.end(2);
    expect(stick.state().vector).toEqual([0, -1]);
    stick.end(1);
    expect(stick.state()).toEqual({
      pointerId: null,
      origin: null,
      knob: null,
      vector: [0, 0],
    });
  });

  it("keeps the first pointer in control and ignores a second pointer's begin", () => {
    const stick = createStick();
    stick.begin(1, 0, 0);
    stick.begin(2, 500, 500);
    expect(stick.state().pointerId).toBe(1);
    expect(stick.state().origin).toEqual([0, 0]);
    stick.move(1, 0, -48);
    expect(stick.state().vector).toEqual([0, -1]);
    stick.end(1);
    expect(stick.state().pointerId).toBeNull();
  });

  it("zeroes a component inside the per-axis dead zone so a held thumb drives straight", () => {
    expect(STICK_AXIS_DEAD_ZONE).toBe(0.2);
    const stick = createStick();
    stick.begin(1, 0, 0);
    stick.move(1, 8, -47);
    // |x| would be 0.166 — a 9.6° thumb wobble — and snaps to zero, while y is
    // left exactly as it was rather than renormalised back up to 1.
    expect(stick.state().vector[0]).toBe(0);
    expect(stick.state().vector[1]).toBeCloseTo(-0.978, 3);
  });

  it("keeps both components of a genuine diagonal", () => {
    const stick = createStick();
    stick.begin(1, 0, 0);
    stick.move(1, 34, -34);
    expect(stick.state().vector[0]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(stick.state().vector[1]).toBeCloseTo(-Math.SQRT1_2, 4);
  });
});

describe("aimFromVector", () => {
  it("aims where the thumb points and not at all while the stick rests", () => {
    expect(aimFromVector(null)).toBeNull();
    expect(aimFromVector([0, 0])).toBeNull();
    expect(aimFromVector([1, 0])).toBeCloseTo(0);
    expect(aimFromVector([0, 1])).toBeCloseTo(Math.PI / 2);
    expect(aimFromVector([-0.5, 0])).toBeCloseTo(Math.PI);
  });
});
