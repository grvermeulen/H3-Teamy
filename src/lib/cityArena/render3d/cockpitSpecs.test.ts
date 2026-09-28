import { describe, expect, it } from "vitest";
import { VEHICLE_KINDS, lengthOf, widthOf } from "../sim/vehicle";
import { COCKPITS, seatOffset } from "./cockpitSpecs";
import { VEHICLE_HEIGHT_M } from "./vehicleModels";

describe("COCKPITS", () => {
  it("seats the driver inside every kind's footprint and under its roof", () => {
    for (const kind of VEHICLE_KINDS) {
      const spec = COCKPITS[kind];
      expect(spec, kind).toBeDefined();
      expect(Math.abs(spec.eyeForwardM), kind).toBeLessThan(lengthOf(kind) / 2);
      expect(Math.abs(spec.eyeLeftM), kind).toBeLessThan(widthOf(kind) / 2);
      expect(spec.eyeHeightM, kind).toBeLessThan(VEHICLE_HEIGHT_M[kind]);
      expect(spec.eyeHeightM, kind).toBeGreaterThan(spec.dash.heightM);
    }
  });

  it("keeps the windscreen and bonnet inside the car, ahead of the eye", () => {
    for (const kind of VEHICLE_KINDS) {
      const { eyeForwardM, glass, bonnet } = COCKPITS[kind];
      const screenFoot = eyeForwardM + glass.aheadM;
      expect(glass.aheadM, kind).toBeGreaterThan(0);
      expect(screenFoot + bonnet.lengthM, kind).toBeLessThanOrEqual(
        lengthOf(kind) / 2,
      );
      expect(glass.headerM, kind).toBeGreaterThan(glass.baseM);
      expect(glass.pillarHalfM, kind).toBeLessThanOrEqual(widthOf(kind) / 2);
    }
  });

  it("sits bus, tractor and van drivers higher than a sedan's", () => {
    const sedan = COCKPITS.sedan.eyeHeightM;
    for (const kind of ["bus", "tractor", "van"] as const)
      expect(COCKPITS[kind].eyeHeightM, kind).toBeGreaterThan(sedan);
  });

  it("puts a Dutch car's wheel on the left, and gives the tank grips in a hatch", () => {
    expect(COCKPITS.sedan.eyeLeftM).toBeGreaterThan(0);
    expect(COCKPITS.sedan.wheel).not.toBeNull();
    expect(COCKPITS.tank.wheel).toBeNull();
    expect(COCKPITS.tank.frame).toBe("hatch");
    expect(COCKPITS.tractor.frame).toBe("open");
    expect(COCKPITS.sedan.frame).toBe("car");
  });

  it("gives the flat-fronted bus no bonnet and an upright screen", () => {
    expect(COCKPITS.bus.bonnet.lengthM).toBe(0);
    expect(COCKPITS.bus.glass.rakeM).toBe(0);
  });
});

describe("seatOffset", () => {
  it("reads the eye straight from the table, the same object every call", () => {
    for (const kind of VEHICLE_KINDS) {
      const spec = COCKPITS[kind];
      expect(seatOffset(kind)).toEqual({
        forwardM: spec.eyeForwardM,
        leftM: spec.eyeLeftM,
        heightM: spec.eyeHeightM,
      });
      expect(seatOffset(kind)).toBe(seatOffset(kind));
    }
  });
});
