import { describe, expect, it } from "vitest";
import { createInput } from "../sim/types";
import { cameraRelativeInput } from "./cameraInput";

describe("cameraRelativeInput", () => {
  it("rotates keyboard forward (W) to point along the camera's yaw", () => {
    const w = createInput({ move: [0, -1] });
    expect(cameraRelativeInput(w, 0, false, null).move).toEqual([1, 0]);
    const turned = cameraRelativeInput(w, Math.PI / 2, false, null).move;
    expect(turned[0]).toBeCloseTo(0);
    expect(turned[1]).toBeCloseTo(1);
  });

  it("rotates strafing (D) to the camera's right", () => {
    const d = createInput({ move: [1, 0] });
    expect(cameraRelativeInput(d, 0, false, null).move).toEqual([0, 1]);
  });

  it("keeps a keyboard driver's tank steering untouched", () => {
    const gas = createInput({ move: [0, -1], moveIsAnalog: false });
    expect(cameraRelativeInput(gas, Math.PI / 2, true, null).move).toEqual([
      0, -1,
    ]);
  });

  it("rotates the analog stick while driving, unlike the keyboard", () => {
    const stick = createInput({ move: [0, -1], moveIsAnalog: true });
    const turned = cameraRelativeInput(stick, Math.PI / 2, true, null).move;
    expect(turned[0]).toBeCloseTo(0);
    expect(turned[1]).toBeCloseTo(1);
  });

  it("rotates on foot regardless of moveIsAnalog", () => {
    const keyboardOnFoot = createInput({ move: [0, -1], moveIsAnalog: false });
    const turned = cameraRelativeInput(
      keyboardOnFoot,
      Math.PI / 2,
      false,
      null,
    ).move;
    expect(turned[0]).toBeCloseTo(0);
    expect(turned[1]).toBeCloseTo(1);
  });

  it("replaces the flat aim angle with the camera's look yaw", () => {
    const input = createInput({ aim: 1.23 });
    expect(cameraRelativeInput(input, 0, false, 2.5).aim).toBe(2.5);
    expect(cameraRelativeInput(input, 0, false, null).aim).toBeNull();
  });

  it("leaves the other fields (fire, enter, weaponNext) untouched", () => {
    const input = createInput({ fire: true, enter: true, weaponNext: true });
    expect(cameraRelativeInput(input, 0, false, null)).toMatchObject({
      fire: true,
      enter: true,
      weaponNext: true,
    });
  });
});
