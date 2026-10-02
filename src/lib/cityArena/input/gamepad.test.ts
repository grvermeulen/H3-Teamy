import { describe, expect, it } from "vitest";
import { EMPTY_INPUT } from "../sim/types";
import { withGamepad } from "./gamepad";

const pad = {
  connected: true,
  mapping: "standard" as GamepadMappingType,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 16 }, () => ({
    value: 0,
    pressed: false,
    touched: false,
  })),
};
describe("standard gamepad controls", () => {
  it("ignores drift without stealing touch movement", () => {
    const touch = {
      ...EMPTY_INPUT,
      move: [0, 1] as [number, number],
      moveIsAnalog: true,
    };
    expect(withGamepad(touch, { ...pad, axes: [0.1, 0.1, 0.05, 0] })).toEqual(
      touch,
    );
  });
  it("maps sticks and action buttons with a bounded diagonal", () => {
    const buttons = pad.buttons.map((button, index) => ({
      ...button,
      value: [1, 5, 7].includes(index) ? 1 : 0,
    }));
    const input = withGamepad(EMPTY_INPUT, {
      ...pad,
      axes: [1, 1, 0, -1],
      buttons,
    });
    expect(Math.hypot(...input.move)).toBeCloseTo(1);
    expect(input).toMatchObject({
      aim: -Math.PI / 2,
      moveIsAnalog: true,
      fire: true,
      enter: true,
      weaponNext: true,
    });
  });
  it("clears a disconnected pad and declines unmapped devices", () => {
    expect(
      withGamepad(EMPTY_INPUT, { ...pad, connected: false, axes: [1, 0] }),
    ).toEqual(EMPTY_INPUT);
    expect(
      withGamepad(EMPTY_INPUT, { ...pad, mapping: "", axes: [1, 0] }),
    ).toEqual(EMPTY_INPUT);
    expect(withGamepad(EMPTY_INPUT, null)).toEqual(EMPTY_INPUT);
  });
});
