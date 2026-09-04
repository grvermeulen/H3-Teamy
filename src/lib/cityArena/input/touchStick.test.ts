import { describe, expect, it } from "vitest";
import { STICK_RADIUS_PX, createStick } from "./touchStick";

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
});
